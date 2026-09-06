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
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402
import export_options                                   # noqa: E402

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


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False)
    return os.path.getsize(path)


def rows(cx, sql, *a):
    return [dict(r) for r in cx.execute(sql, a)]


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
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out, exist_ok=True)
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
                  AND l.void = 0 AND l.is_partial = 0) AS best,
               cr.route_id, cr.match_kind AS match, cr.covered,
               cr.anchor_route_id, cr.anchor_events, cr.anchor_agree
        FROM course c LEFT JOIN course_route cr ON cr.route_key = c.route_key ORDER BY (c.name IS NULL), c.name, c.route_key""")
    cand_by_key = course_candidates(cx)
    for c in courses:
        c["candidates"] = cand_by_key.get(c["key"], [])
    total += write(os.path.join(out, "courses.json"), courses)

    n_course = 0
    for c in courses:
        key = c["key"]
        geo = cx.execute("SELECT geometry FROM course WHERE route_key=?", (key,)).fetchone()
        geo = json.loads(geo["geometry"] or "{}") if geo else {}
        laps = rows(cx, """
            SELECT lap_id AS id, cid, container, lap_s AS t, arc_m AS arc,
                   ROUND(coverage, 3) AS cov, is_partial AS partial, void, impacts,
                   class, pi, drivetrain AS dt, build_id AS bid, session_id AS sid, solo
            FROM lap WHERE route_key = ? ORDER BY (void OR is_partial), lap_s""", key)
        # traces: NEVER CAP THE DATA FOR ONE CONSUMER'S BENEFIT (v1 lesson). The old cap kept one
        # lap per cid and dropped every void or partial lap, so an A/B pair on one car at one PI
        # collapsed to a single trace and the header's "N of N laps on record" reported the cap as
        # the truth. Now: the fastest CLEAN lap per SAVE (cid + container) first, then every other
        # lap (void and partial included — they are flagged in laps[], and their corners are
        # real), up to a generous ceiling, with the lap's own ordering preserved. Elevation rides
        # along as the sixth field for the trace's elevation paint.
        keep, seen = [], set()
        for l in laps:
            if l["void"] or l["partial"]:
                continue
            k = (l["cid"], l["container"])
            if k in seen:
                continue
            seen.add(k); keep.append(l["id"])
        for l in laps:
            if l["id"] not in keep:
                keep.append(l["id"])
            if len(keep) >= 40:
                break
        traces = {}
        for lid in keep:
            traces[lid] = [[r["arc_m"], r["mph"], r["grip"], r["x"], r["z"], r["elev_m"]]
                           for r in cx.execute(
                               "SELECT arc_m, mph, grip, x, z, elev_m FROM lap_point WHERE lap_id=? ORDER BY i",
                               (lid,))]
        turns = rows(cx, """
            SELECT turn_id AS id, seq, arc_m AS s, apex_x AS x, apex_z AS z, radius_m AS r,
                   angle_deg AS deg, kind, n_obs AS n
            FROM course_turn WHERE route_key = ? ORDER BY seq""", key)
        # The game's own centre-line for this course, when we could identify it. This is the
        # half our telemetry cannot supply: exactly where the track is, to the metre.
        cr = cx.execute("""SELECT route_id, match_kind, mean_dev_m, covered, len_ratio,
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
        naming = {
            "name_source": c["name_source"], "name_confidence": c["name_confidence"],
            "declared_name": c["declared_name"], "declared_source": c["declared_source"],
            "event_id": c["event_id"], "candidates": cand_by_key.get(key, []),
        }
        total += write(os.path.join(out, "course", key.replace("/", "_") + ".json"),
                       {"key": key, "name": c["name"], "len": c["len"], "rivals": c["rivals"],
                        "path": geo.get("path") or [], "turns": turns, "laps": laps,
                        "traces": traces, "route": route, "naming": naming})
        n_course += 1

    # ---- evidence -----------------------------------------------------------
    ev = rows(cx, """SELECT subject, claim, confidence AS conf, source, observed_utc AS seen
                     FROM obs_evidence ORDER BY subject""")
    menu = rows(cx, """SELECT ordinal, slot, tile, tile_count AS tiles, name, part_id AS pid, source
                       FROM obs_menu ORDER BY slot, tile""")
    total += write(os.path.join(out, "evidence.json"), {"evidence": ev, "menu": menu})



    # ---- world map: every game route, decimated, for the FREE-mode left pane ------------
    # ~8 m spacing keeps 169 routes under a megabyte and is still finer than the map can draw.
    world = {"routes": {}, "bbox": None}
    xs, zs = [], []
    for r in cx.execute("SELECT route_id, length_m, is_loop, name, name_confidence FROM ref_route"):
        pts = [[round(p["x"]), round(p["z"])] for p in cx.execute(
            "SELECT x, z FROM ref_route_point WHERE route_id=? AND (i % 4)=0 ORDER BY i", (r["route_id"],))]
        if len(pts) < 3:
            continue
        world["routes"][r["route_id"]] = {"len": r["length_m"], "loop": r["is_loop"],
                                           "name": r["name"], "name_confidence": r["name_confidence"],
                                           "pts": pts}
        xs += [p[0] for p in pts]; zs += [p[1] for p in pts]
    if xs:
        world["bbox"] = [min(xs), max(xs), min(zs), max(zs)]
    # our own learned courses on the same map, so driven roads light up
    world["courses"] = {c["route_key"]: {"name": c["name"], "path": (json.loads(c["geometry"] or "{}").get("path") or [])[::3]}
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
            "cls": t["class"], "kg": t["mass_kg"], "front": t["front_pct"],
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

    print("wrote %d files under %s" % (3 + n_build + n_course + 2 + n_opt, out))
    print("  cars %d   packages %d (%d build files)   courses %d (%d files)   evidence %d"
          % (len(cars), len(packages), n_build, len(courses), n_course, len(ev)))
    print("  total %.1f MB  (the old dashboard/db.js is 12.6 MB)" % (total / 1048576.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
