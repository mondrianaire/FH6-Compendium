#!/usr/bin/env python3
"""build_web.py -- generate the new dashboard's data files from data/fh6.db.

The old dashboard bundled forty JSON files into one 13 MB db.js that the browser re-parsed on
every page load, and it grew without bound. This writes small per-view files under
dashboard/v2/api/ that the page fetches only when a view needs them:

    index.json        counts, the car list, the course list, the package list  (loaded once)
    cars.json         660 reference cars
    packages.json     one row per distinct hardware package
    build/<hash>.json parts + sliders + gears for one package
    course/<key>.json geometry, turns, laps and traces for one course
    evidence.json     the obs_ layer with its provenance

Every field here comes from a COLUMN, not a computation: the point of the database was that the
browser should never re-derive a part name, a slider's physical value or a lap's coverage.

Run:  python scripts/db/build_web.py [--db PATH] [--out DIR]
"""
import argparse
import collections as _cl
import json
import math
import os
import re
import shutil
import sys

try:
    import numpy as _np                                   # trace arc re-anchoring (nearest-point projection)
except Exception:                                         # noqa: BLE001
    _np = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402
import export_options                                   # noqa: E402
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))
import fh6_tune_decode as _tune                         # noqa: E402  — parts_hash, to attach each build's DRIVEN class

OUT = os.path.join(ROOT, "dashboard", "v2", "api")


# ---- the tune's own render: every save folder carries Thumb.png — a WebP for your own saves and a
# ForzaTech texture (burG/TXCB, BC7, 670x376) for downloaded tunes. Both become api/thumb/<container>.webp,
# written once and only when the source is newer, so a rebuild costs nothing after the first pass.
def export_thumbs(cx, out):
    import struct, shutil
    tdir = os.path.join(out, "thumb"); os.makedirs(tdir, exist_ok=True)
    try:
        from PIL import Image                                          # noqa: WPS433
    except Exception:                                                  # noqa: BLE001
        Image = None
    done, n_new, n_skip = {}, 0, 0
    for r in cx.execute("SELECT container, file_path FROM tune_container"):
        src = os.path.join(os.path.dirname(r["file_path"] or ""), "Thumb.png")
        if not os.path.exists(src):
            continue
        dst = os.path.join(tdir, r["container"] + ".webp")
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            done[r["container"]] = "thumb/" + r["container"] + ".webp"; n_skip += 1; continue
        try:
            with open(src, "rb") as fh: b = fh.read()
            if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
                shutil.copyfile(src, dst)
            elif b[:4] == b"burG" and Image is not None:
                hlen = struct.unpack_from("<I", b, 8)[0]
                W, H = struct.unpack_from("<II", b, 76)                # 670, 376 in every file seen
                px = b[hlen:]
                flags = 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000
                pf = struct.pack("<II4sIIIII", 32, 0x4, b"DX10", 0, 0, 0, 0, 0)
                hdr = (b"DDS " + struct.pack("<IIIIIII", 124, flags, H, W, len(px), 0, 0) + b"\x00" * 44 + pf
                       + struct.pack("<IIIII", 0x1000, 0, 0, 0, 0) + struct.pack("<IIIII", 98, 3, 0, 1, 0))   # BC7_UNORM
                import io as _io
                im = Image.open(_io.BytesIO(hdr + px)); im.load()
                im.convert("RGBA").save(dst, "WEBP", quality=88, method=4)
            else:
                continue
            done[r["container"]] = "thumb/" + r["container"] + ".webp"; n_new += 1
        except Exception as e:                                         # noqa: BLE001
            print("  thumb %s: %s" % (r["container"], e))
    print("  thumbs: %d written, %d kept, %d without" % (n_new, n_skip, cx.execute("SELECT COUNT(*) FROM tune_container").fetchone()[0] - n_new - n_skip))
    return done


_WRITTEN = set()   # every api json path this run produced, for the stale-prune (see main's write-in-place note)


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(data)
        os.replace(tmp, path)                          # ATOMIC: a reader gets the old file or the new one, never a half-written one
    except OSError:
        # a key holding a char Windows forbids in a filename (a colon, e.g. "loop:test loop") can't take
        # the tmp+rename dance; fall back to a direct write, exactly as before. Such keys are edge cases and
        # were never atomically served anyway.
        try: os.remove(tmp)
        except OSError: pass
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(data)
    _WRITTEN.add(os.path.abspath(path))
    try: return os.path.getsize(path)
    except OSError: return len(data.encode("utf-8"))


def rows(cx, sql, *a):
    return [dict(r) for r in cx.execute(sql, a)]


def _route_arc(rpts):
    """Cumulative ROUTE arc (metres) at each ordered centre-line point. The segment spans in
    ref_route_turn are measured along this same arc, so this is the frame that maps a phase span
    back to world x/z for the map overlay."""
    arc = [0.0]
    for i in range(1, len(rpts)):
        arc.append(arc[-1] + math.hypot(rpts[i][0] - rpts[i - 1][0], rpts[i][1] - rpts[i - 1][1]))
    return arc


def _phase_geom(rpts, arc, seg_json):
    """Per-phase world polyline along the route centre-line, sliced from the turn's ROUTE-arc
    segment spans {phase:[a,b]}. Adjacent phases SHARE a boundary point (turn-in starts where
    braking ends) so the coloured overlay reads as one continuous corner; a span that wraps the
    start/finish (a>b, loop routes) is stitched across the seam. Coordinates only -- the raw arc
    spans never reach the client (the map draws in world x/z)."""
    try:
        segs = json.loads(seg_json)
    except Exception:                                     # noqa: BLE001
        return None
    n = len(rpts)
    if n < 2:
        return None

    def nearest(x):                                       # index of the point whose arc is closest to x
        lo, hi = 0, n - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if arc[mid] < x:
                lo = mid + 1
            else:
                hi = mid
        if lo > 0 and abs(arc[lo - 1] - x) <= abs(arc[lo] - x):
            return lo - 1
        return lo

    out = {}
    for name, ab in segs.items():
        a, b = ab[0], ab[1]
        i0, i1 = nearest(a), nearest(b)
        idx = list(range(i0, i1 + 1)) if a <= b else list(range(i0, n)) + list(range(0, i1 + 1))
        if len(idx) >= 2:
            out[name] = [[round(rpts[i][0], 1), round(rpts[i][1], 1)] for i in idx]
    return out or None


# ---- naming candidates: every event course_event considered for a route_key, closest match
# first (map beats length beats declared; then by how far off the length was) -- the chosen=1
# row IS the course's name when one exists, and the others are what else it could have been.
def course_candidates(cx):
    out = {}
    for r in cx.execute("""
        SELECT ce.route_key, ce.event_id, e.name, ce.tier, ce.chosen, ce.d_course_m, ce.d_route_m
        FROM course_event ce JOIN ref_event e ON e.event_id = ce.event_id
        ORDER BY ce.route_key, ce.chosen DESC,
                 CASE ce.tier WHEN 'game' THEN 0 WHEN 'map' THEN 1 WHEN 'length' THEN 2 WHEN 'declared' THEN 3 ELSE 9 END,
                 ABS(COALESCE(ce.d_course_m, 1e9))"""):
        out.setdefault(r["route_key"], []).append({
            "event_id": r["event_id"], "name": r["name"], "tier": r["tier"],
            "chosen": r["chosen"], "d_course_m": r["d_course_m"], "d_route_m": r["d_route_m"]})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db, ro=True)
    out = a.out
    # WRITE IN PLACE, never wipe (2026-09-06). This used to shutil.rmtree(out) first, which left every
    # api file GONE for the several seconds of a rebuild — and both rebuild scopes end with build_web and
    # fire on every save / session close, so a course page open during a rebuild loaded nothing and broke
    # (the Sekibe Scramble report). Each write() is atomic (tmp + os.replace), so a reader always gets a
    # complete file, old or new; stale files (a deleted course) are pruned at the end against what this run
    # wrote, so nothing is ever missing mid-rebuild.
    os.makedirs(out, exist_ok=True)
    _WRITTEN.clear()
    total = 0

    # ---- cars ---------------------------------------------------------------
    cars = rows(cx, """
        SELECT c.ordinal, c.full_name AS name, c.make, c.model, c.year, c.class, c.pi,
               c.curb_weight_kg AS kg, c.drivetype AS dt, c.cylinders AS cyl,
               c.displacement_cc AS cc, c.aspiration AS asp, c.num_gears AS gears,
               c.rating_handling AS h, c.rating_speed AS sp, c.rating_accel AS ac,
               c.rating_braking AS br, c.rating_launch AS la, c.rating_offroad AS orr,
               c.stock_wheel_level AS swl, c.base_cost AS cost, c.in_autoshow AS shop,
               (SELECT COUNT(*) FROM tune_container t WHERE t.ordinal = c.ordinal) AS builds,
               (SELECT COUNT(*) FROM lap l WHERE l.cid LIKE c.ordinal || '|%') AS laps
        FROM ref_car c ORDER BY c.ordinal""")
    total += write(os.path.join(out, "cars.json"), cars)

    # ---- hardware packages --------------------------------------------------
    packages = rows(cx, """
        SELECT p.hw_hash AS hw, p.ordinal, r.full_name AS car, p.n_containers AS n,
               p.first_seen_utc AS first, p.last_seen_utc AS last,
               (SELECT t.tune_name FROM tune_container t
                 WHERE t.hw_hash = p.hw_hash ORDER BY t.saved_utc DESC LIMIT 1) AS label,
               (SELECT MAX(t.locked) FROM tune_container t WHERE t.hw_hash = p.hw_hash) AS locked,
               (SELECT t.mass_kg FROM tune_container t
                 WHERE t.hw_hash = p.hw_hash LIMIT 1) AS kg,
               (SELECT t.front_pct FROM tune_container t
                 WHERE t.hw_hash = p.hw_hash LIMIT 1) AS front,
               (SELECT t.gear_count FROM tune_container t
                 WHERE t.hw_hash = p.hw_hash LIMIT 1) AS gears,
               (SELECT COUNT(*) FROM tune_part tp
                 JOIN tune_container t ON t.container = tp.container
                WHERE t.hw_hash = p.hw_hash AND tp.container =
                      (SELECT MIN(container) FROM tune_container WHERE hw_hash = p.hw_hash)
                  AND tp.part_id IS NOT NULL) AS n_parts
        FROM hw_package p JOIN ref_car r ON r.ordinal = p.ordinal
        ORDER BY p.ordinal, p.first_seen_utc""")
    total += write(os.path.join(out, "packages.json"), packages)

    # ---- one file per package: the build sheet and every tune on it ---------
    n_build = 0
    for p in packages:
        hw = p["hw"]
        parts = rows(cx, """
            SELECT tp.slot, tp.slot_index AS ix, tp.part_id AS pid, tp.name, tp.level AS lv,
                   tp.tile, tp.tile_count AS tiles, tp.menu_path AS menu, tp.is_stock AS stock,
                   tp.price, tp.mass_diff_kg AS dkg, tp.confidence AS conf,
                   s.menu_area AS area, s.in_upgrade_shop AS shop
            FROM tune_part tp
            JOIN ref_slot s ON s.slot = tp.slot
            WHERE tp.container = (SELECT MIN(container) FROM tune_container WHERE hw_hash = ?)
            ORDER BY s.menu_area_order, s.menu_order, tp.slot_index""", hw)
        tunes = rows(cx, """
            SELECT container, tune_name AS name, saved_utc AS saved, locked, source,
                   setup_hash AS setup, pi, mass_kg AS kg
            FROM tune_container WHERE hw_hash = ? ORDER BY saved_utc""", hw)
        for t in tunes:
            t["sliders"] = rows(cx, """
                SELECT s.slider, d.group_name AS grp, d.display_name AS label, s.norm, s.value AS v,
                       s.unit, s.min_value AS lo, s.max_value AS hi, s.locked,
                       s.is_install_default AS deflt
                FROM tune_slider s JOIN ref_slider d ON d.slider = s.slider
                WHERE s.container = ? AND d.group_name IS NOT NULL
                ORDER BY d.slot_index""", t["container"])
            t["gears"] = [r["ratio"] for r in cx.execute(
                "SELECT ratio FROM tune_gear WHERE container=? ORDER BY gear", (t["container"],))]
        total += write(os.path.join(out, "build", hw + ".json"),
                       {"hw": hw, "car": p["car"], "ordinal": p["ordinal"],
                        "parts": parts, "tunes": tunes})
        n_build += 1

    # ---- courses ------------------------------------------------------------
    courses = rows(cx, """
        SELECT c.route_key AS key, c.name, c.is_rivals AS rivals, c.length_m AS len,
               c.turn_count AS turns, c.n_laps AS laps, c.n_sessions AS sessions,
               c.confidence AS conf,
               c.name_source, c.name_confidence, c.declared_name, c.declared_source, c.event_id,
               (SELECT COUNT(*) FROM lap l WHERE l.route_key = c.route_key) AS lap_rows,
               (SELECT MIN(l.lap_s) FROM lap l WHERE l.route_key = c.route_key
                  AND l.void = 0 AND l.is_partial = 0 AND l.rewinds = 0) AS best,   -- a rewound lap's clock is invalid (lap-canon): never the course record
               cr.route_id, cr.match_kind AS match, cr.covered,
               cr.anchor_route_id, cr.anchor_events, cr.anchor_agree
        FROM course c LEFT JOIN course_route cr ON cr.route_key = c.route_key ORDER BY (c.name IS NULL), c.name, c.route_key""")
    cand_by_key = course_candidates(cx)
    for c in courses:
        c["candidates"] = cand_by_key.get(c["key"], [])
    # courses.json is written AFTER the course-detail loop below: Path B may replace a course's turn set with
    # the geometry set, and the loop rewrites c["turns"] to the displayed count, so the card matches the detail.

    # PER-CLASS GRIP CEILING (a_max, schema 7), SPEED-BANDED (2026-09-12): the tyres' lateral-grip limit per PI
    # class, as the 90th-percentile of mid-phase peak |lat_g|. Bucket by apex-speed band (apex = the mid phase's
    # min_mph) as a CORNER-MIX control -- so a slow corner is rated against the class's slow-corner grip, not its
    # fast-corner grip. (Partly aero: bands rise with speed for A/S1 but are non-monotonic for B/C -- 2026-09-12
    # validation -- so this is a corner-type separator, not a clean aero-downforce model.)
    # A per-class GLOBAL value stays as the fallback when a band is thin. n >= 20 per bucket or it isn't published.
    # It's a car+tune property (~course-independent), so compute ONCE and stamp on every course. p10 = the spread.
    _BANDS = [(0, 70), (70, 110), (110, 9999)]   # apex-mph bands: slow / medium / fast
    _cls_g = _cl.defaultdict(list)                                  # class -> all peaks (global fallback)
    _cls_band_g = _cl.defaultdict(lambda: _cl.defaultdict(list))    # class -> band index -> peaks
    if "peak_lat_g" in {r[1] for r in cx.execute("PRAGMA table_info(corner_segment)")}:
        for _cls, _pg, _mph in cx.execute(
                "SELECT l.class, cs.peak_lat_g, cs.min_mph FROM corner_segment cs JOIN lap l ON l.lap_id = cs.lap_id "
                "WHERE cs.segment='mid' AND cs.peak_lat_g > 0.1 AND cs.peak_lat_g <= 3.0 AND l.void=0 "   # >3 g = impact (dropped at source too); >0.1 excludes all-impact/empty phases
                "AND l.class IS NOT NULL AND l.class != '?'"):
            _cls_g[_cls].append(_pg)
            if _mph is not None:
                for _bi, (_lo, _hi) in enumerate(_BANDS):
                    if _lo <= _mph < _hi:
                        _cls_band_g[_cls][_bi].append(_pg)
                        break
    def _pctl(a, q):
        a = sorted(a)
        return a[int(q * (len(a) - 1))] if a else None
    class_grip = {}
    for _cls, _vals in _cls_g.items():
        if len(_vals) < 20:
            continue
        _entry = {"aMax": round(_pctl(_vals, 0.90), 3), "p10": round(_pctl(_vals, 0.10), 3), "n": len(_vals), "bands": []}
        for _bi, (_lo, _hi) in enumerate(_BANDS):
            _bv = _cls_band_g[_cls].get(_bi, [])
            if len(_bv) >= 20:
                _entry["bands"].append({"lo": _lo, "hi": (None if _hi >= 9999 else _hi),
                                        "aMax": round(_pctl(_bv, 0.90), 3), "p10": round(_pctl(_bv, 0.10), 3), "n": len(_bv)})
        class_grip[_cls] = _entry

    n_course = 0
    for c in courses:
        key = c["key"]
        geo = cx.execute("SELECT geometry FROM course WHERE route_key=?", (key,)).fetchone()
        geo = json.loads(geo["geometry"] or "{}") if geo else {}
        laps = rows(cx, """
            SELECT l.lap_id AS id, l.cid, l.container, l.lap_s AS t, l.arc_m AS arc,
                   ROUND(l.coverage, 3) AS cov, l.is_partial AS partial, l.void, l.impacts, l.rewinds,
                   l.class, l.pi, l.drivetrain AS dt, l.build_id AS bid, l.session_id AS sid, l.solo, l.is_race,
                   l.hw_hash AS hw, t.setup_hash AS su
            FROM lap l LEFT JOIN tune_container t ON l.container = t.container
            WHERE l.route_key = ? ORDER BY (l.void OR l.is_partial OR l.rewinds > 0), l.lap_s""", key)
        # THE DRIVING IDENTITY = hw_hash (upgrades) + setup_hash (sliders). Both ride along so the dashboard
        # can scope "this setup" (route+car+build+tune) and score a turn against the same-tune pool. setup_hash
        # (from tune_container) is CONTENT-based, so re-saves of identical sliders collapse to one identity —
        # unlike lap.tune_hash, which is 1:1 with the save. Two builds with the same (hw,su) are the SAME build
        # from a driving perspective (Jett 2026-09-16). NULL su for unsaved/downloaded laps (no container) —
        # those fall out of the identity pool honestly. hw_hash is shared across lap/tune_container spaces.
        # traces: NEVER CAP THE DATA FOR ONE CONSUMER'S BENEFIT (v1 lesson). The old cap kept one
        # lap per cid and dropped every void or partial lap, so an A/B pair on one car at one PI
        # collapsed to a single trace and the header's "N of N laps on record" reported the cap as
        # the truth. Now: the fastest CLEAN lap per SAVE (cid + container) first, then every other
        # lap (void and partial included — they are flagged in laps[], and their corners are
        # real), up to a generous ceiling, with the lap's own ordering preserved. Elevation rides
        # along as the sixth field for the trace's elevation paint.
        keep, seen = [], set()
        for l in laps:
            if l["void"] or l["partial"] or l["rewinds"]:      # a rewound lap's clock is invalid (lap-canon); kept & flagged below, never crowned the save's fastest
                continue
            k = (l["cid"], l["container"])
            if k in seen:
                continue
            seen.add(k); keep.append(l["id"])
        for l in laps:
            if l["id"] not in keep:
                keep.append(l["id"])
            if len(keep) >= 400:                          # draw all available (Jett 2026-09-10); ceiling only bounds a runaway
                break
        traces = {}
        # PEDALS (schema 6, Jett 2026-09-11): throttle / brake % ride as the 7th / 8th fields for the pedal paint.
        # Selected only when the columns exist, so a build against a not-yet-migrated database still runs.
        _ped = {r[1] for r in cx.execute("PRAGMA table_info(lap_point)")} >= {"thr", "brk"}
        _psel = "SELECT arc_m, mph, grip, x, z, elev_m" + (", thr, brk" if _ped else "") + " FROM lap_point WHERE lap_id=? ORDER BY i"
        for lid in keep:
            traces[lid] = [[r["arc_m"], r["mph"], r["grip"], r["x"], r["z"], r["elev_m"]] + ([r["thr"], r["brk"]] if _ped else [])
                           for r in cx.execute(_psel, (lid,))]
        # RE-ANCHOR TRACE ARC TO ONE COMMON FRAME (Jett 2026-09-10). Each lap's stored arc starts wherever
        # its recording began, so on a LOOP a free-roam lap sits half a lap off the Rivals laps and the
        # speed-trace overlay is incoherent (Irokawa: the S1 free-roam laps were ~900 m out of phase). A lap
        # ALREADY has a correct, monotonic internal arc -- only its ORIGIN differs -- so we find one circular
        # OFFSET to the longest lap (the same reference the turn ticks project onto) and shift the whole lap
        # by it. The offset is the MODAL per-point delta (ref_arc - own_arc) mod L, which is immune to the
        # nearest-point mis-projections that plague a loop where the road passes near itself. Then rotate each
        # lap to begin at the frame origin so its arc runs monotonically 0..L. Spatial; the turn/corner joins
        # never used trace arc, so they are unaffected.
        # ONE shared reference lap for arc alignment AND the Path-B turn-tick projection: the FASTEST CLEAN
        # FULL lap present in the traces, so the frame is a real racing loop, not a long or dirty out-lap
        # (which pushed a few Irokawa laps past the course length). `laps` is ordered clean-first then by
        # lap_s, so the first clean, full-coverage lap that has a trace is the fastest. Fall back to the
        # longest-by-points lap when none qualifies.
        _ref_id = None
        for _l in laps:
            if _l["id"] in traces and not _l["void"] and not _l["partial"] and not _l["rewinds"] \
                    and _l["t"] and (_l["cov"] or 0) >= 0.9:
                _ref_id = _l["id"]
                break
        if _ref_id is None and traces:
            _ref_id = max(traces, key=lambda k: len(traces[k]))
        # LOOPS ONLY. The offset-mod-L + rotate model re-phases laps around a start/finish seam -- it is
        # meaningless on a POINT-TO-POINT course, where every lap already shares the one start line and the
        # modulus would wrap an aligned 0..L lap into a scrambled order (Hakone, is_loop=0: 22/35 traces got
        # a ~full-length forward jump that drew a straight line across the chart). P2P laps keep their own
        # arc, which is already start-anchored. `route` isn't built until later, so read is_loop here.
        _lr = cx.execute("SELECT rr.is_loop FROM course_route cr JOIN ref_route rr ON rr.route_id = cr.route_id WHERE cr.route_key = ?", (key,)).fetchone()
        _is_loop = bool(_lr and _lr["is_loop"])
        if _np is not None and traces and _ref_id is not None and _is_loop:
            _ref = traces[_ref_id]
            _rp = [(p[0], p[3], p[4]) for p in _ref if p[3] is not None and p[4] is not None and p[0] is not None]
            _L = _rp[-1][0] if _rp else 0
            if len(_rp) >= 8 and _L > 1:
                _RA = _np.array([q[0] for q in _rp], float)
                _RX = _np.array([q[1] for q in _rp], float)
                _RZ = _np.array([q[2] for q in _rp], float)
                for lid, tr in traces.items():
                    ix = [k for k, p in enumerate(tr) if p[3] is not None and p[4] is not None and p[0] is not None]
                    if len(ix) < 12:
                        continue
                    PX = _np.array([tr[k][3] for k in ix], float)
                    PZ = _np.array([tr[k][4] for k in ix], float)
                    OWN = _np.array([tr[k][0] for k in ix], float)
                    nn = ((_RX[None, :] - PX[:, None]) ** 2 + (_RZ[None, :] - PZ[:, None]) ** 2).argmin(axis=1)
                    deltas = _np.mod(_RA[nn] - OWN, _L)                  # per-point origin offset (mod loop)
                    # modal offset: the delta with the most neighbours within a 60 m circular window,
                    # then the circular mean of that cluster -- robust to self-approach mis-projections
                    dl = deltas.tolist()
                    best_d, best_c = dl[0], -1
                    for d in dl:
                        cc = int(_np.sum(_np.mod(deltas - d, _L) < 60.0))
                        if cc > best_c:
                            best_c, best_d = cc, d
                    rel = _np.mod(deltas - best_d, _L)
                    off = (best_d + float(rel[rel < 60.0].mean())) % _L
                    for k in ix:
                        tr[k][0] = round(float((tr[k][0] + off) % _L), 1)
                    mi = min(ix, key=lambda k: tr[k][0])
                    if mi > 0:
                        traces[lid] = tr[mi:] + tr[:mi]
        turns = rows(cx, """
            SELECT turn_id AS id, seq, arc_m AS s, apex_x AS x, apex_z AS z, radius_m AS r,
                   angle_deg AS deg, kind, n_obs AS n
            FROM course_turn WHERE route_key = ? ORDER BY seq""", key)
        # The game's own centre-line for this course, when we could identify it. This is the
        # half our telemetry cannot supply: exactly where the track is, to the metre.
        cr = cx.execute("""SELECT route_id, match_kind, mean_dev_m, p95_dev_m, covered, len_ratio,
                                  anchor_route_id, anchor_events, anchor_agree
                           FROM course_route WHERE route_key=?""", (key,)).fetchone()
        route = dict(cr) if cr else None
        if route and route["route_id"] and route["match_kind"] in ("verified", "probable", "partial"):
            route["path"] = [[r["x"], r["z"]] for r in cx.execute(
                "SELECT x, z FROM ref_route_point WHERE route_id=? ORDER BY i",
                (route["route_id"],))]
            rr = cx.execute("SELECT length_m, is_loop FROM ref_route WHERE route_id=?",
                            (route["route_id"],)).fetchone()
            if rr:
                route["length_m"] = rr["length_m"]
                route["is_loop"] = rr["is_loop"]
        # DEFINITIONAL FALLBACK: a course keyed route:<id> IS game route <id> -- the catalogue matcher assigned
        # that key off the start/finish line + path, so the identity is already settled by the key. The owt
        # geometric re-match (course_route) gates its verdict on COVERAGE so it will not attach lap RECORDS to a
        # route we only part-drove -- e.g. The Gauntlet (route:2052), driven in ~2 km fragments, covers 7.5% of
        # its 30.7 km and scores 'none'. But the centre-line is the game's own track shape, and it is useful as
        # REFERENCE the moment we know which route it is. So when the match bound no path, fall back to the key's
        # own id when that route exists. Reference geometry only (reference_only=True); lap attribution still
        # rides the owt verdict (import_corners etc. keep gating on verified/probable/partial).
        # ...but ONLY when the drive demonstrably LIES ON that ref -- the owt "close" test (mean_dev <= 8 m)
        # with no gross local divergence (p95 <= 20 m). The Gauntlet fits tight (3.2 / 6.3) and only lacked
        # coverage, so it qualifies. Naruo (route:1211) fits at 8.07 / 24.85 -- its ref centre-line carries a
        # ~680 m straight lead-in the laps never touch -- so it does NOT, and binding it drew a spurious
        # straight chord across the map (Jett 2026-09-07: "could we have glitched on the actual line" -- yes).
        # A poor-fit ref is worse than none; the recorded laps still draw the real shape.
        _fit = bool(route and route["mean_dev_m"] is not None and route["mean_dev_m"] <= 8 and (route["p95_dev_m"] or 0) <= 20)
        if not (route and route.get("path")):
            _m = re.match(r"route:(\w+)$", key)
            if _m and _fit:
                _rid = _m.group(1)
                _pts = [[r["x"], r["z"]] for r in cx.execute(
                    "SELECT x, z FROM ref_route_point WHERE route_id=? ORDER BY i", (_rid,))]
                if _pts:
                    _rr = cx.execute("SELECT length_m, is_loop FROM ref_route WHERE route_id=?", (_rid,)).fetchone()
                    route = dict(route or {}, route_id=_rid, path=_pts, reference_only=True,
                                 match_kind=(route or {}).get("match_kind") or "id",
                                 length_m=(_rr["length_m"] if _rr else None),
                                 is_loop=(_rr["is_loop"] if _rr else None))
        # TRIM REF ARTIFACTS against the driven track. When a course is well-covered (>= 50 %), the recorded
        # laps ARE its real shape, so any ref centre-line point that strays far (> 60 m) from every lap point
        # is a bad segment in the game data -- e.g. Naruo's (route:1211) ~680 m straight lead-in the laps never
        # touch, which drew a straight chord across the map (Jett 2026-09-07). Drop those points; the gap they
        # leave is split by the dashboard's teleport-splitter, so no line is drawn across it. Under-covered
        # courses (the Gauntlet, 7.5 %) are left whole -- most of their ref is legitimately un-driven, not an
        # artifact -- and a clean ref (Goliath) loses nothing because none of it strays.
        if route and route.get("path") and (route.get("covered") or 0) >= 0.5 and traces:
            _tp = [(p[3], p[4]) for tr in traces.values() for p in tr if len(p) > 4]
            if _tp:
                _kept = [pt for pt in route["path"]
                         if any((pt[0] - tx) ** 2 + (pt[1] - tz) ** 2 <= 3600 for tx, tz in _tp)]
                if 2 <= len(_kept) < len(route["path"]):
                    route["path"] = _kept
        # ── PATH B (2026-09-07): the DISPLAYED turn identity is the game's OWN centre-line set (ref_route_turn --
        # deterministic, pass-invariant, whole-road, carrying width + banking), which DEMOTES the driven-path
        # course_turn to the measure-only behavioural record. Available only when the course is bound to a
        # catalogued route. Each geometry apex is projected onto the driven track for two things the route arc
        # can't give directly: `s`, the COURSE arc (the speed-trace x-axis), from the nearest driven lap point;
        # and a COVERED test -- an apex near no driven point is on an un-driven part of the route, so a fragment
        # shows only its driven turns and a reverse lap gets them re-sequenced in driven order. The pass count is
        # carried over from the nearest course_turn row (identity from geometry, behaviour from telemetry). No
        # route binding -> keep the driven-path set exactly as before. (Projection uses the single longest lap for
        # speed; a course driven as different fragments per lap would show that lap's fragment -- rare, and every
        # turn shown is still geometry-true.) See docs/turn-consistency-research-2026-09-07.md.
        _rid = route and route.get("route_id")
        if _rid and traces:
            grows = rows(cx, """SELECT turn_id AS id, turn_id, seq, apex_x AS x, apex_z AS z, radius_m AS r,
                                       angle_deg AS deg, kind, dir, width_m AS width, bank_deg AS bank, segments
                                FROM ref_route_turn WHERE route_id=? ORDER BY apex_arc_m""", _rid)
            _pl = traces[_ref_id] if _ref_id in traces else max(traces.values(), key=len)   # SAME reference as the arc re-anchor (fastest clean lap), so ticks and traces share one frame
            _lp = [(p[0], p[3], p[4]) for p in _pl if len(p) > 4 and p[3] is not None]
            if grows and len(_lp) >= 2:
                _drv = turns                                          # the driven-path course_turn rows, for behaviour
                _geo = []
                for g in grows:
                    if g["x"] is None:
                        continue
                    _ba, _bd = None, 1e18
                    for a, x, z in _lp:                               # nearest driven lap point -> course arc
                        d = (x - g["x"]) ** 2 + (z - g["z"]) ** 2
                        if d < _bd:
                            _bd, _ba = d, a
                    if _ba is None or _bd > 40 ** 2:                  # apex not on the driven track -> un-driven turn
                        continue
                    g["s"] = round(_ba, 1)
                    _bt, _btd = None, 35 ** 2                         # nearest driven course_turn -> its pass count
                    for t in _drv:
                        if t.get("x") is None:
                            continue
                        d = (t["x"] - g["x"]) ** 2 + (t["z"] - g["z"]) ** 2
                        if d < _btd:
                            _btd, _bt = d, t
                    g["n"] = _bt["n"] if _bt else None
                    _geo.append(g)
                if _geo:
                    _geo.sort(key=lambda t: t["s"])                   # driven order (handles reverse + fragments)
                    for i, t in enumerate(_geo, 1):
                        t["seq"] = i                                  # display index; turn_id stays the stable key
                    # PER-TURN PHASE GEOMETRY (2026-09-10): slice the route centre-line by each turn's
                    # stored ROUTE-arc segment spans into world polylines, so the Turn-analysis map can
                    # paint the 5 phases of a selected turn. Computed from the FULL centre-line (never the
                    # covered-trimmed route["path"]), since the spans are measured along the full route arc.
                    _fp = [(r["x"], r["z"]) for r in cx.execute(
                        "SELECT x, z FROM ref_route_point WHERE route_id=? ORDER BY i", (_rid,))]
                    _fa = _route_arc(_fp) if len(_fp) >= 2 else None
                    for t in _geo:
                        sj = t.pop("segments", None)
                        if _fa and sj:
                            sg = _phase_geom(_fp, _fa, sj)
                            if sg:
                                t["seg"] = sg
                    turns = _geo
        c["turns"] = len(turns)                                       # course-card count == what the detail view draws
        # PER-PHASE CORNER STRIP (2026-09-10): raw per-lap corner_segment observations per displayed turn,
        # phase -> [[lap_id, entry, min, exit, grip]...]. The client aggregates over whatever lap set the trace
        # preset (all / this class / this car / this build / this tune) is showing -- so the strip separates by
        # class, build and tune with the SAME filter as the map traces.
        # each phase row: [lap_id, entry, min, exit, grip_state, time_s, grip_hist, mean, peak_lat_g] -- time_s
        # powers the right-pane timing, grip_hist (5-state sample counts) the TRUE grip mix the client sums over
        # the active preset so a turn reads by its typical grip, not its single worst moment, mean the phase's
        # average speed, peak_lat_g (schema 7) the peak |lat_g| that lap in that phase -> the grip-ceiling rating.
        # New fields are APPEND-ONLY (mean at 7, peak_lat_g at 8) so the existing [0..6] indices never shift.
        #
        # EVERY DRIVEN PASS, not only whole clean laps (Jett 2026-09-11): the old gate here was per-LAP
        # (void=0 AND is_partial=0 AND rewinds=0), which on a course driven mostly in practice starved the
        # analysis to almost nothing -- route:311 kept 1 of 33 laps, so the leaderboard, grip mix and error
        # stats all ran on a single lap while the DB held 26-32 laps per turn. But corner validity is PER
        # CORNER, not per lap: corner_segment's speeds/grip are direct telemetry and its time_s is SPATIAL
        # (arc span / mean speed, import_corners.py), so a partial lap's corners, a rewound lap's corners
        # (lap_point is already canon-cut at the rewind) and even a contact lap's non-crash corners are all
        # real. So take every corner observation the course has; the client guards the fastest-pass TIMING by
        # requiring a pass to cover the turn's full phase set (a pass sampled in fewer phases sums a smaller
        # turnT and must not be crowned fastest), and a crash corner reads as impact grip + a slow, low rank.
        _seg = _cl.defaultdict(lambda: _cl.defaultdict(list))
        _cs_peakg = "peak_lat_g" in {r[1] for r in cx.execute("PRAGMA table_info(corner_segment)")}   # schema 7
        _pg = ", cs.peak_lat_g" if _cs_peakg else ""
        for sr in cx.execute("SELECT cs.turn_id, cs.segment, cs.entry_mph, cs.min_mph, cs.exit_mph, "
                             "cs.grip_state, cs.time_s, cs.grip_hist, cs.mean_mph, cs.lap_id" + _pg +
                             " FROM corner_segment cs WHERE cs.route_key = ?", (key,)):
            try:
                _gh = json.loads(sr["grip_hist"]) if sr["grip_hist"] else None
            except Exception:                                 # noqa: BLE001
                _gh = None
            _seg[sr["turn_id"]][sr["segment"]].append(
                [sr["lap_id"], sr["entry_mph"], sr["min_mph"], sr["exit_mph"], sr["grip_state"],
                 sr["time_s"], _gh, sr["mean_mph"], (sr["peak_lat_g"] if _cs_peakg else None)])
        for t in turns:
            po = _seg.get(t.get("id"))
            if po:
                t["phaseObs"] = {seg: v for seg, v in po.items()}
        naming = {
            "name_source": c["name_source"], "name_confidence": c["name_confidence"],
            "declared_name": c["declared_name"], "declared_source": c["declared_source"],
            "event_id": c["event_id"], "candidates": cand_by_key.get(key, []),
        }
        # Filename MUST match the dashboard's courseFile() sanitisation: String(key).replace(/[^A-Za-z0-9_-]/g,"_").
        # A route:<id> key kept its colon here (only "/" was replaced), and a colon is an illegal Windows filename
        # char -- so every "route:311.json" write collapsed onto an alternate data stream of a base file "route"
        # (0 bytes, unfetchable), 404ing the dashboard, which then fell back to a leftover grid-keyed course and
        # showed it as "unnamed". Sanitise the same way both sides do so course/route_311.json exists and loads.
        # how many turns the game catalogues for this route (ref_route_turn), so the course view can say
        # "N of M turns measured" and count the catalogued turns never driven. Measured = len(turns) here.
        _rid = route.get("route_id") if route else None
        n_cat = cx.execute("SELECT COUNT(*) FROM ref_route_turn WHERE route_id=?", (_rid,)).fetchone()[0] if _rid else None
        total += write(os.path.join(out, "course", re.sub(r"[^A-Za-z0-9_-]", "_", key) + ".json"),
                       {"key": key, "name": c["name"], "len": c["len"], "rivals": c["rivals"],
                        "path": geo.get("path") or [], "turns": turns, "laps": laps,
                        "traces": traces, "route": route, "naming": naming,
                        "n_turns_catalogued": n_cat, "classGrip": class_grip,
                        # when this history was built, so the course view can stamp the comparison it feeds
                        # ("history built 10:44") instead of leaving freshness to the status bar (handoff §3)
                        "built_at": fh6db.utcnow()})
        n_course += 1

    total += write(os.path.join(out, "courses.json"), courses)   # after the loop: card counts == Path B displayed turns

    # ---- evidence -----------------------------------------------------------
    ev = rows(cx, """SELECT subject, claim, confidence AS conf, source, observed_utc AS seen
                     FROM obs_evidence ORDER BY subject""")
    menu = rows(cx, """SELECT ordinal, slot, tile, tile_count AS tiles, name, part_id AS pid, source
                       FROM obs_menu ORDER BY slot, tile""")
    total += write(os.path.join(out, "evidence.json"), {"evidence": ev, "menu": menu})



    # ---- world map: every game route at FULL native density, for the FREE-mode left pane -----------
    # The .owt-derived centre-line is ~4 m point-to-point; ship ALL of it at 0.1 m precision so the SVG
    # paths stay smooth at any zoom. The old export kept every 4th point (~16 m) and rounded to a 1 m grid
    # -- "point-to-point data, no reason the paths should be low resolution; they should scale up gracefully
    # on all zoom" (Jett 2026-09-07). The dashboard derives a strided ~16 m copy ONCE at load for its
    # per-frame route matchers (loadWorld/strideLo), so the density costs drawing fidelity only, never match
    # time. ~275 k points over 169 routes -- a few MB of world.json, nothing on localhost.
    # Per-route MODE tags + discipline + spawn zone feed the free-mode Course Browser: modes come from
    # ref_event.kind (a route is used by rivals and/or career events), is_race is the world activation sphere,
    # disc is the route's dominant discipline, spawn is the activation-sphere centre (race routes only).
    _mode = _cl.defaultdict(set); _disc = _cl.defaultdict(_cl.Counter)
    for _rid, _kind, _d in cx.execute("SELECT route_id, kind, discipline FROM ref_event WHERE route_id IS NOT NULL"):
        if _kind: _mode[_rid].add(_kind)
        if _d: _disc[_rid][_d] += 1
    # data amount we hold per route (our own driven corpus), the performance CLASSES the route is OFFERED in
    # (a Rivals course runs one leaderboard per class), and the classes we actually have DATA for. Both use the
    # game telemetry taxonomy (class_id 6 is the top class, reported as X in a lap's CarClass -- ref_class names
    # it "R", but the driven data never carries R, so normalise offered to X to make offered vs data comparable).
    _CLASS_ORDER = ["D", "C", "B", "A", "S1", "S2", "X"]
    _CLS_ID = {0: "D", 1: "C", 2: "B", 3: "A", 4: "S1", 5: "S2", 6: "X"}
    _clsorder = {c: i for i, c in enumerate(_CLASS_ORDER)}
    _data = {rk: (nl or 0, ns or 0) for rk, nl, ns in cx.execute("SELECT route_key, n_laps, n_sessions FROM course")}
    _name_cls = _cl.defaultdict(set)
    for _nm, _cid in cx.execute("SELECT name, class_id FROM ref_rivals_event WHERE class_id IS NOT NULL"):
        _c = _CLS_ID.get(_cid)
        if _c: _name_cls[_nm].add(_c)
    _driven = _cl.defaultdict(set)   # route_key -> {classes we have laps in}, from the driven car's reported class
    for _rk, _c in cx.execute(
            "SELECT se.route_key, sc.class FROM session_event se "
            "JOIN session_car sc ON sc.session_id = se.session_id AND sc.cid = se.cid "
            "WHERE se.route_key LIKE 'route:%' AND sc.class IS NOT NULL AND sc.class != '?'"):
        _driven[_rk].add(_c)
    # QUICK COURSE-PANEL STATS (2026-09-09): real per-class and per-car LAP COUNTS for the world-map info
    # pill. Counts are of recorded laps (void=0). lap.class is denormalised on the row; the car comes from
    # the cid ordinal. The full course panel later cross-tabs car x class and adds per-turn analysis -- this
    # is the at-a-glance version, and it also gives an HONEST live lap total (course.n_laps is a stale cache).
    _carname = {}
    for _o, _mk, _md in cx.execute("SELECT ordinal, make, model FROM ref_car"):
        _carname[str(_o)] = (("%s %s" % (_mk or "", _md or "")).strip()) or ("car %s" % _o)
    _lap_cls = _cl.defaultdict(_cl.Counter)   # route_key -> Counter(class -> laps)
    _lap_car = _cl.defaultdict(_cl.Counter)   # route_key -> Counter("Make Model" -> laps)
    _lap_tot = _cl.Counter()                  # route_key -> live lap count (void=0)
    for _rk2, _lc2, _cid2 in cx.execute("SELECT route_key, class, cid FROM lap WHERE route_key LIKE 'route:%' AND void=0"):
        _lap_tot[_rk2] += 1
        if _lc2 and _lc2 != "?":
            _lap_cls[_rk2][_lc2] += 1
        _o2 = _cid2.split("|", 1)[0] if _cid2 else None
        if _o2:
            _lap_car[_rk2][_carname.get(_o2, "car %s" % _o2)] += 1
    _spawn = {}
    try:
        import sys as _sys
        _sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))
        import fh6_anchors as _fa
        for _a in _fa.load():
            _spawn[str(_a["route_id"])] = [round(_a["x"]), round(_a["z"])]   # key by str: ref_route.route_id comes back as text
    except Exception:                                    # noqa: BLE001  — no game install / no anchors: race tiles just omit the spawn dot
        pass
    world = {"routes": {}, "bbox": None}
    xs, zs = [], []
    # A game route the catalogue never names (an .owt route id with no ref_route.name) still deserves a
    # name in the browser when OUR learned course keyed route:<id> is named -- otherwise it shows as a bare
    # number (e.g. 30003 with laps but no name reads as "30003" instead of "Sekibe Scramble"). Fall back to
    # the course name for that key. (2026-09-07: fixes route numbers reappearing in the course browser.)
    _course_names = {row["route_key"]: row["name"] for row in
                     cx.execute("SELECT route_key, name FROM course WHERE name IS NOT NULL AND name != ''")}
    for r in cx.execute("SELECT route_id, length_m, is_loop, name, name_confidence, is_race FROM ref_route"):
        pts = [[round(p["x"], 1), round(p["z"], 1)] for p in cx.execute(
            "SELECT x, z FROM ref_route_point WHERE route_id=? ORDER BY i", (r["route_id"],))]
        if len(pts) < 3:
            continue
        rid = r["route_id"]
        _dc = _disc.get(rid)
        _laps, _sess = _data.get("route:%s" % rid, (0, 0))
        _rk = "route:%s" % rid
        _classes = sorted(_name_cls.get(r["name"], ()), key=lambda c: _clsorder.get(c, 99))
        _cdata = sorted(_driven.get(_rk, ()), key=lambda c: _clsorder.get(c, 99))
        _lc = _lap_cls.get(_rk) or {}        # per-class lap counts, ladder order then any off-ladder class
        _lap_by_cls = [[c, _lc[c]] for c in _CLASS_ORDER if c in _lc] + [[c, _lc[c]] for c in _lc if c not in _clsorder]
        _lap_by_car = _lap_car[_rk].most_common() if _rk in _lap_car else []
        world["routes"][rid] = {"len": r["length_m"], "loop": r["is_loop"],
                                "name": r["name"] or _course_names.get(_rk), "name_confidence": r["name_confidence"],
                                "is_race": bool(r["is_race"]), "modes": sorted(_mode.get(rid, ())),
                                "disc": (_dc.most_common(1)[0][0] if _dc else None),
                                "spawn": _spawn.get(str(rid)), "laps": _lap_tot.get(_rk, 0), "sessions": _sess,
                                "classes": _classes, "class_data": _cdata,
                                "lap_class": _lap_by_cls, "lap_car": _lap_by_car, "pts": pts}
        xs += [p[0] for p in pts]; zs += [p[1] for p in pts]
    if xs:
        world["bbox"] = [min(xs), max(xs), min(zs), max(zs)]
    # our own learned courses on the same map, so driven roads light up
    # full driven path (was [::3]) so the green "roads you have driven" overlay is as smooth on zoom as the
    # grey route layer; ~30-40 driven courses, so no decimation is needed to keep the payload or the match sane.
    world["courses"] = {c["route_key"]: {"name": c["name"], "path": (json.loads(c["geometry"] or "{}").get("path") or [])}
                        for c in cx.execute("SELECT route_key, name, geometry FROM course")}
    total += write(os.path.join(out, "world.json"), world)

    # ---- diagnosis rollups: what goes wrong, where, for whom ----------------------------
    diag = {
        "by_setup": rows(cx, "SELECT * FROM v_diag_by_setup"),
        "by_turn": rows(cx, "SELECT * FROM v_diag_by_turn"),
        "symptoms": rows(cx, "SELECT symptom, phase, primary_fix, secondary_fix, tertiary_fix, detector, source FROM ref_symptom"),
    }
    total += write(os.path.join(out, "diag.json"), diag)

    # ---- identity: how a LIVE car on screen is matched to a build we already hold ------
    # The daemon reports the car's 50 decoded part ids. Joining them in slot order gives a
    # hardware fingerprint the browser can compare directly, with no hashing and no guessing:
    # if the string matches, this is that build. The slider fingerprint does the same for a tune.
    slots = [r["slot"] for r in cx.execute("SELECT slot FROM ref_slot ORDER BY slot_index")]
    sliders_order = [r["slider"] for r in cx.execute(
        "SELECT slider FROM ref_slider ORDER BY slot_index")]
    ident = []
    thumbs = export_thumbs(cx, out)
    # THE DRIVEN CLASS per build (Jett 2026-09-06). tune_container stores the car's STOCK class on every
    # build and PI is null, so its class field cannot separate an A build from an S1 build of the same car.
    # The one exact per-build class is what the game reported the moment the build was DRIVEN, recorded in
    # pi-observations by (ordinal, parts_hash). Join it here so the header's similar-upgrades / tunes lists
    # can drop a build confirmed to be a DIFFERENT class. Undriven builds stay unclassed (dcls null) and are
    # never dropped; it self-fills as more builds are driven. ~14% of builds carry a driven class today.
    _obs = {}
    try:
        _doc = json.load(open(os.path.join(ROOT, "data", "pi-observations.json"), encoding="utf-8"))
        for _o in (_doc.get("observations") or []):
            _obs[(int(_o["ordinal"]), _o.get("parts_hash"))] = (_o.get("car_pi"), _o.get("car_class"))
    except Exception:
        _obs = {}

    def _driven(ordinal, parts):
        try:
            v = _obs.get((int(ordinal), _tune.parts_hash(ordinal, parts)))
        except Exception:
            v = None
        return (v[0], v[1]) if v else (None, None)
    for t in cx.execute("""SELECT container, ordinal, hw_hash, setup_hash, tune_name, locked,
                                  source, pi, class, mass_kg, front_pct, gear_count, saved_utc,
                                  description, creator, created_utc
                           FROM tune_container ORDER BY ordinal, saved_utc"""):
        pk = {r["slot"]: r["part_id"] for r in cx.execute(
            "SELECT slot, part_id FROM tune_part WHERE container=?", (t["container"],))}
        sk = {r["slider"]: r["norm"] for r in cx.execute(
            "SELECT slider, norm FROM tune_slider WHERE container=?", (t["container"],))}
        rims = {r["slot"]: r["ml"] for r in cx.execute("""
            SELECT tp.slot, json_extract(rp.data, '$.mass_level') AS ml
            FROM tune_part tp JOIN ref_part rp ON rp.slot = tp.slot AND rp.part_id = tp.part_id
            WHERE tp.container = ? AND tp.slot IN ('rim_style','rear_rim_style')""", (t["container"],))}
        ident.append({
            "c": t["container"], "o": t["ordinal"], "hw": t["hw_hash"], "su": t["setup_hash"],
            "rim_ml": [rims.get("rim_style"), rims.get("rear_rim_style")],
            "name": t["tune_name"], "locked": t["locked"], "src": t["source"], "pi": t["pi"],
            "cls": t["class"], "dpi": _driven(t["ordinal"], pk)[0], "dcls": _driven(t["ordinal"], pk)[1],
            "kg": t["mass_kg"], "front": t["front_pct"],
            "gears": t["gear_count"], "saved": t["saved_utc"],
            "desc": t["description"], "creator": t["creator"], "created": t["created_utc"],
            "thumb": thumbs.get(t["container"]),
            "pkey": ",".join("-" if pk.get(s) is None else str(pk[s]) for s in slots),
            "skey": ",".join(("%.4f" % sk[s]) if sk.get(s) is not None else "-"
                             for s in sliders_order),
        })
    total += write(os.path.join(out, "identity.json"),
                   {"slots": slots, "sliders": sliders_order, "builds": ident})

    # ---- index --------------------------------------------------------------
    counts = fh6db.table_counts(cx)
    runs = rows(cx, "SELECT kind, n_rows, finished_utc, ok FROM import_run "
                    "WHERE ok=1 GROUP BY kind HAVING MAX(run_id) ORDER BY kind")
    idx = {
        "built": fh6db.utcnow(),
        "counts": counts,
        "runs": runs,
        "totals": {
            "cars": len(cars), "packages": len(packages), "courses": len(courses),
            "containers": counts.get("tune_container", 0),
            "parts_named": cx.execute(
                "SELECT COUNT(*) FROM ref_part WHERE name IS NOT NULL").fetchone()[0],
            "parts": counts.get("ref_part", 0),
            "laps": counts.get("lap", 0),
            "trace_points": counts.get("lap_point", 0),
            "ready": cx.execute("SELECT SUM(ready) FROM plan_readiness").fetchone()[0],
        },
    }
    total += write(os.path.join(out, "index.json"), idx)

    # ---- the Upgrade Shop, per car -----------------------------------------
    # One api/options/<ordinal>.json per car that has a save: the whole shop tree, the game's own
    # order and strings. Cheap (well under a second for the whole set) and the whole api/ tree is
    # rebuilt from scratch above, so there is nothing to cache against.
    n_opt = export_options.export(cx, os.path.join(out, "options"))
    for fn in os.listdir(os.path.join(out, "options")):
        total += os.path.getsize(os.path.join(out, "options", fn))

    # STALE PRUNE, now that nothing is wiped up front. Remove only the per-key json this run did NOT
    # produce (a course or build that no longer exists), in the two dirs write() fully owns; thumb/ and
    # options/ manage their own files, and the top-level *.json are a fixed overwritten set. Done last so
    # the tree is only ever complete-old -> complete-new, never empty.
    n_pruned = 0
    for sub in ("course", "build"):
        d = os.path.join(out, sub)
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            p = os.path.join(d, fn)
            if fn.endswith(".json") and os.path.abspath(p) not in _WRITTEN:
                try: os.remove(p); n_pruned += 1
                except OSError: pass

    print("wrote %d files under %s%s" % (3 + n_build + n_course + 2 + n_opt, out,
                                         (" (pruned %d stale)" % n_pruned) if n_pruned else ""))
    print("  cars %d   packages %d (%d build files)   courses %d (%d files)   evidence %d"
          % (len(cars), len(packages), n_build, len(courses), n_course, len(ev)))
    print("  total %.1f MB  (the old dashboard/db.js is 12.6 MB)" % (total / 1048576.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
