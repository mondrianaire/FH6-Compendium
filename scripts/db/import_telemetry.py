#!/usr/bin/env python3
"""import_telemetry.py -- the session / course / lap layers.

Sources, all inside the repo:
  data/sessions/*.json   one file per capture session (cars, courses, summary)
  data/courses/*.json    the accumulated course models (geometry, canonical turns, speed traces)
  data/laps.db           lap_traces: the per-lap history the analyzer appends to

Two rules this importer enforces that the JSON stores could not:

  * **A fragment is not a lap.** coverage = arc_m / the course's own length; anything under 0.9
    is stored with is_partial = 1 and can never be crowned fastest. The old models kept whichever
    window a session called its best, so a session that only drove a quarter of a circuit saved
    the quarter and it outranked real laps.
  * **A turn wears its own id.** course_turn.turn_id is the canonical id (T3, T7 ...), never a
    positional index -- canonical ids are not contiguous, so position and identity disagree.

Trace samples become ROWS in lap_point rather than a JSON blob, so the analyzer and the
dashboard can ask questions of a trace in SQL instead of parsing 300-element arrays.

Run:  python scripts/db/import_telemetry.py [--db PATH] [-v]
"""
import argparse
import glob
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

DATA = os.path.join(ROOT, "data")
PARTIAL_BELOW = 0.9          # arc coverage under this is a fragment, not a lap


def jload(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def iso_from_session_id(sid):
    """'fh6_20260902_005318' -> '2026-09-02T00:53:18Z' (the capture clock is local, but the
    session id is the only timestamp these files carry; stored as-is and flagged by suffix)."""
    try:
        _, d, t = sid.split("_")
        return "%s-%s-%sT%s:%s:%s" % (d[0:4], d[4:6], d[6:8], t[0:2], t[2:4], t[4:6])
    except Exception:                                    # noqa: BLE001
        return None


def run(cx, verbose=False, data_dir=None):
    """data_dir overrides DATA (routes.json, courses/, sessions/, laps.db) -- tests point it at a
    scratch directory so a run never reads or writes the real data/ tree."""
    counts = {}
    data_dir = data_dir or DATA

    # ---- courses -----------------------------------------------------------
    routes = {}
    rp = os.path.join(data_dir, "routes.json")
    if os.path.exists(rp):
        doc = jload(rp)
        routes = doc.get("routes") or doc if isinstance(doc, dict) else {}

    crows, trows = [], []
    models = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "courses", "*.json"))):
        if path.endswith(".tmp"):
            continue
        try:
            m = jload(path)
        except Exception as e:                           # noqa: BLE001
            if verbose:
                print("  !! %s: %s" % (os.path.basename(path), e))
            continue
        rk = m.get("route_key")
        if not rk:
            continue
        models[rk] = m
        geo = m.get("geometry") or {}
        rinfo = routes.get(rk) or {}
        # A course model's `turns` is a LIST of candidates: 90 on the Highway Circuit, of which
        # only the 24 marked established (status 'turn') are canonical and carry an identity laps
        # are scored against. The rest are 'possible' -- corners the detector saw but has not
        # confirmed. Only canonical turns become rows; the candidates stay in the geometry JSON.
        raw = m.get("turns")
        if isinstance(raw, dict):
            turns = raw.get("canonical") or []
        else:
            turns = [t for t in (raw or []) if t.get("established") or t.get("status") == "turn"]
        # COURSE NAMES (2026-09-05): what a person typed is recorded as declared_name with its source
        # (routes.json first -- the store the dashboard writes; the model's copy second). `name` is only a
        # placeholder here: stage route_names resolves it (declared wins) and sets name_source/confidence.
        if rinfo.get("name"):
            declared, declared_src = rinfo.get("name"), (rinfo.get("source") or "routes.json")
        elif m.get("name"):
            declared, declared_src = m.get("name"), "course model"
        else:
            declared, declared_src = None, None
        crows.append((rk, declared, declared, declared_src,
                      1 if (rinfo.get("rivals") or m.get("rivals")) else 0,
                      None, geo.get("length_m"), len(turns) or m.get("turn_count"),
                      m.get("laps"), len(m.get("sessions") or []) or m.get("sessions"),
                      (m.get("profile") or {}).get("confidence"),
                      m.get("updated"),
                      json.dumps(geo), json.dumps(m.get("profile") or {})))
        for seq, t in enumerate(sorted(turns, key=lambda x: (x.get("s") is None, x.get("s") or 0)), 1):   # 1-based: seq is the DISPLAY number T1..Tn (matches fh6_turns / ref_route_turn)
            pos = t.get("pos") or [None, None]
            trows.append((rk, t.get("id") or ("T%d" % round((t.get("s") if t.get("s") is not None else t.get("arc_m")) or 0)), seq,   # arc-anchored fallback id (2026-09-07)
                          t.get("s") if t.get("s") is not None else t.get("arc_m"),
                          pos[0], pos[1],
                          t.get("radius_m") or t.get("radius"),
                          t.get("deg") if t.get("deg") is not None else t.get("angle_deg"),
                          t.get("type") or t.get("kind"), t.get("n") or t.get("n_obs")))

    # ---- sessions ----------------------------------------------------------
    srows, scrows, erows = [], [], []
    for path in sorted(glob.glob(os.path.join(data_dir, "sessions", "*.json"))):
        if path.endswith(".tags.json"):
            continue
        try:
            s = jload(path)
        except Exception as e:                           # noqa: BLE001
            if verbose:
                print("  !! %s: %s" % (os.path.basename(path), e))
            continue
        sid = s.get("id") or os.path.splitext(os.path.basename(path))[0]
        srows.append((sid, iso_from_session_id(sid), s.get("duration_s"), s.get("frames"),
                      s.get("rate_pps"), s.get("source"), path, fh6db.utcnow(),
                      json.dumps(s.get("summary") or {})))
        for c in (s.get("cars") or []):
            cid = c.get("id") or c.get("cid")
            if not cid:
                continue
            ordn = None
            try:
                ordn = int(str(cid).split("|")[0])
            except Exception:                            # noqa: BLE001
                pass
            scrows.append((sid, str(cid), ordn, c.get("build_id"), None, c.get("name"),
                           c.get("class"), c.get("pi"), c.get("drivetrain"), c.get("cyl"),
                           c.get("live_s")))
        # ANCHORS (2026-09-05): every event with WHERE it started -- what course_match tests against
        # the game's race-activation spheres. The analyzer keys `start` on the start LINE when a lap
        # completed, else on the capture-window start; both are kept, the sphere test tolerates 100 m.
        for i, e in enumerate(s.get("events") or []):
            st, en = e.get("start") or [None, None], e.get("end") or [None, None]
            solo = e.get("solo")
            erows.append((sid, i, e.get("t0"), e.get("t1"), e.get("car"), e.get("mode"),
                          None if solo is None else (1 if solo else 0), e.get("laps"),
                          e.get("distance_m"), e.get("duration_s"), st[0], st[1], en[0], en[1],
                          e.get("route_key"), e.get("start_is_line")))

    # ---- laps: the history store first, then any saved trace it lacks ------
    lrows, prows, mrows = [], [], []
    seen = set()
    lap_id = 0
    # course length by route_key -- crows index 6 is geo length_m (index 4 is is_rivals, which is why
    # coverage/is_partial silently never populated: L was 0/1, so cov=arc/L was junk or a div-by-zero None).
    lengths = {c[0]: c[6] for c in crows}

    known_routes = {c[0] for c in crows}
    known_sessions = {s[0] for s in srows}
    orphan_route, orphan_session = {}, set()

    def add_lap(rk, sid, cid, t0, lap_s, pts, meta):
        nonlocal lap_id
        if not pts:
            return
        # A lap whose course model is gone cannot be attributed to anything: the route was
        # merged into another (fragment reunification) or retired. Count them, do not invent
        # a course row to hang them on.
        if rk not in known_routes:
            orphan_route[rk] = orphan_route.get(rk, 0) + 1
            return
        if sid is not None and sid not in known_sessions:
            orphan_session.add(sid)
            sid = None                       # keep the lap, drop the dangling reference
        arc = pts[-1][0] if pts and len(pts[-1]) else None
        L = lengths.get(rk) or 0
        cov = (arc / L) if (arc and L) else None
        lap_id += 1
        lrows.append((lap_id, rk, sid, cid, meta.get("container"), meta.get("hw_hash"),
                      t0, lap_s, arc, cov,
                      1 if (cov is not None and cov < PARTIAL_BELOW) else 0,
                      meta.get("build_id"), meta.get("class"), meta.get("pi"),
                      meta.get("drivetrain"), meta.get("tune_hash"),
                      meta.get("solo") or 0, meta.get("is_race"), meta.get("impacts") or 0, meta.get("void") or 0,
                      meta.get("lap_dist_m"), meta.get("rewinds") or 0, meta.get("pauses") or 0,
                      meta.get("pause_s") or 0.0, meta.get("stitched") or 0,
                      meta.get("official") or 0))
        for i, p in enumerate(pts):
            prows.append((lap_id, i,
                          p[0] if len(p) > 0 else None,
                          p[1] if len(p) > 1 else None,
                          p[2] if len(p) > 2 else None,
                          p[3] if len(p) > 3 else None,
                          p[4] if len(p) > 4 else None,
                          p[5] if len(p) > 5 else None,
                          p[6] if len(p) > 6 else None,
                          p[7] if len(p) > 7 else None,      # throttle % (schema 6; None on laps analysed before it)
                          p[8] if len(p) > 8 else None,      # brake %
                          p[9] if len(p) > 9 else None))     # peak |lat_g| in g (schema 7)
        mk = meta.get("markers")
        if isinstance(mk, str):
            try:
                mk = json.loads(mk)
            except Exception:                            # noqa: BLE001
                mk = None
        for i, m in enumerate(mk or []):
            mrows.append((lap_id, i, m.get("kind"), m.get("t"),
                          m.get("dur_s") if m.get("kind") != "rewind" else m.get("undone_s"),
                          m.get("race_s") if m.get("kind") != "rewind" else m.get("race_s_from"),
                          m.get("dist_m") if m.get("kind") != "rewind" else m.get("dist_from"),
                          (1 if m.get("over_line") else 0) if m.get("kind") == "rewind" else None,
                          json.dumps(m, separators=(",", ":"))))

    lp = os.path.join(data_dir, "laps.db")
    if os.path.exists(lp):
        lx = sqlite3.connect("file:%s?mode=ro" % lp.replace("\\", "/"), uri=True)
        lx.row_factory = sqlite3.Row
        # ROBUST COVERAGE LENGTH (Jett 2026-09-18): the course model's length_m is accumulated as the MAX measured
        # drive (analyze_session), so ONE long outlier (an out-lap, a stitched double lap) inflates it forever and
        # every normal full lap then reads < 0.9 coverage and is wrongly stamped 'partial' -- Shimanoyama's model
        # length was 1404 m against a ~1084 m median lap (and a 1100 m catalogued route), so 41 real laps greyed out.
        # Judge coverage against the MEDIAN lap arc instead -- the code's own stated rule ("the route's own median
        # arc IS the course length") -- which is immune to a single long outlier AND to a catalogued lead-in. Needs
        # a few laps for a stable median; a route with fewer keeps the model length.
        _arcs = {}
        for _r in lx.execute("SELECT route_key, arc_m FROM lap_traces WHERE arc_m IS NOT NULL AND arc_m > 0"):
            _arcs.setdefault(_r["route_key"], []).append(_r["arc_m"])
        for _rk, _a in _arcs.items():
            if _rk in lengths and len(_a) >= 3:
                _a.sort(); lengths[_rk] = _a[len(_a) // 2]   # median arc
        # DEAD KEYS ARE HISTORY, NOT RUBBISH (2026-09-18). The lap store keeps whatever route_key a lap was
        # filed under when it was driven. Consolidation later merges duplicate-road courses and deletes the
        # loser course rows, and old course models get pruned -- so a store key can name a course that no
        # longer exists. Those laps used to hit the course foreign key and vanish silently: 380 of them, 266
        # on one course (the 2026-08-21 Edamame sessions had NOTHING in the database).
        # Re-place them instead of dropping them, on TWO pieces of evidence that must agree:
        #   route:<id> keys -> the canonical id for that road (canon_routes), the same map consolidation uses.
        #   <x>_<z> start-cell keys -> the live course whose own start is nearest, accepted only when BOTH the
        #     key's coordinates AND the lap's first trace point sit within 100 m of it.
        # Anything that fails both tests is still dropped, and the count is reported rather than hidden.
        import re as _re, math as _math
        # The live set is the COURSES BEING IMPORTED THIS RUN (known_routes / models), never the table as it
        # stands: run() deletes every course not in this model set further down, so a snapshot of the table
        # includes courses that are about to disappear -- mapping a lap onto one of those fails the foreign
        # key at commit, which is exactly how the first version of this broke.
        _live = set(known_routes)
        _starts = []
        for _rk, _m in models.items():
            if _rk not in _live:
                continue
            try:
                _p = ((_m.get("geometry") or {}).get("path") or [])[0]
                if _p and len(_p) >= 2:
                    _starts.append((_rk, float(_p[0]), float(_p[1])))
            except Exception:                            # noqa: BLE001
                continue
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            import canon_routes as _canon
            _canon_of = _canon.canonical_map(cx)[0]
        except Exception:                                # noqa: BLE001
            _canon_of = {}
        _remap, _unplaced, _idents = {}, {}, set()

        def _resolve(rk, pts_):
            """A live route_key for a store key, or None. Cached per key."""
            if rk in _live:
                return rk
            if rk in _remap:
                return _remap[rk]
            out = None
            if rk.startswith("route:"):
                _cid2 = _canon_of.get(rk.split(":", 1)[1])
                if _cid2 and ("route:%s" % _cid2) in _live:
                    out = "route:%s" % _cid2
            else:
                m = _re.match(r"^(-?\d+)_(-?\d+)$", rk)
                if m and _starts:
                    kx, kz = float(m.group(1)), float(m.group(2))
                    best = min(_starts, key=lambda s: _math.hypot(s[1] - kx, s[2] - kz))
                    d_key = _math.hypot(best[1] - kx, best[2] - kz)
                    d_lap = None
                    try:
                        p0 = pts_[0]
                        d_lap = _math.hypot(best[1] - float(p0[3]), best[2] - float(p0[4]))
                    except Exception:                    # noqa: BLE001
                        d_lap = None
                    if d_key <= 100 and d_lap is not None and d_lap <= 100:
                        out = best[0]
            _remap[rk] = out
            return out

        for r in lx.execute("SELECT * FROM lap_traces"):
            try:
                pts = json.loads(r["pts"])
            except Exception:                            # noqa: BLE001
                continue
            _rk = _resolve(r["route_key"], pts)
            if _rk is None:
                _unplaced[r["route_key"]] = _unplaced.get(r["route_key"], 0) + 1
                continue
            # A REMAP CAN COLLIDE. Re-placing a dead key onto a live course can land on a lap already added
            # under that key (the store holds 378 laps filed under two keys by the old twin glitch). `lap` is
            # UNIQUE on (route_key, session_id, cid, t0) so the duplicate row is ignored -- but its trace
            # points are NOT, and they orphan onto a lap_id that was never inserted: FOREIGN KEY constraint
            # failed at commit, with lap_point -> lap as the violation. Dedupe on the real key, not on the
            # (route, cid, lap_s) shape `seen` uses for the model-trace pass.
            _ident = (_rk, r["session"], r["cid"], round(r["t0"], 1) if r["t0"] is not None else None)
            if _ident in _idents:
                continue
            _idents.add(_ident)
            key = (_rk, r["cid"], round(r["lap_s"], 3) if r["lap_s"] else None)   # thousandths: the game publishes 3 dp
            seen.add(key)
            add_lap(_rk, r["session"], r["cid"], r["t0"], r["lap_s"], pts, dict(r))
        for _old, _newk in sorted(_remap.items()):
            if _newk and verbose:
                print("  re-placed store key %s -> %s" % (_old, _newk))
        if _unplaced and verbose:
            print("  %d lap(s) under %d key(s) could not be placed: %s"
                  % (sum(_unplaced.values()), len(_unplaced), ", ".join(sorted(_unplaced)[:6])))
        lx.close()

    # saved traces in the course models: keep only laps the history store does not already hold
    for rk, m in models.items():
        for cid, t in (m.get("speed_traces") or {}).items():
            if not isinstance(t, dict):
                continue
            key = (rk, cid, round(t["lap_s"], 3) if t.get("lap_s") else None)
            if key in seen:
                continue
            seen.add(key)
            # a saved trace carries no start time; -1 * n is a sentinel meaning "no t0",
            # kept distinct so the (route, session, cid, t0) unique key still holds
            add_lap(rk, t.get("session"), cid, -float(lap_id + 1), t.get("lap_s"),
                    t.get("pts") or [], t)

    # ---- write -------------------------------------------------------------
    with cx:
        cx.execute("BEGIN")                  # a PRAGMA outside a transaction autocommits and resets itself
        cx.execute("PRAGMA defer_foreign_keys=ON")
        # `course` is a foreign-key PARENT (course_route, course_event cascade off it). It is MERGED, not
        # wiped: DELETE FROM course and INSERT OR REPLACE both fire ON DELETE CASCADE immediately --
        # defer_foreign_keys defers the checks, not the actions -- which is how course_route sat at 0 rows
        # from 2026-09-03 to 2026-09-05. Only courses that vanished from disk are deleted (intended cascade).
        for tbl in ("corner_obs", "lap_marker", "lap_point", "lap", "course_turn", "session_event", "session_car", "session"):
            cx.execute("DELETE FROM %s" % tbl)
        keys = [r[0] for r in crows]
        cx.execute("CREATE TEMP TABLE IF NOT EXISTS _keep(route_key TEXT PRIMARY KEY)")
        cx.execute("DELETE FROM _keep")
        cx.executemany("INSERT INTO _keep(route_key) VALUES(?)", [(k,) for k in keys])
        counts["_retired_courses"] = cx.execute(
            "DELETE FROM course WHERE route_key NOT IN (SELECT route_key FROM _keep)").rowcount or 0
        counts["course"] = fh6db.merge_many(cx, "course", [
            "route_key", "name", "declared_name", "declared_source", "is_rivals", "event_id", "length_m",
            "turn_count", "n_laps", "n_sessions", "confidence", "updated_utc", "geometry", "profile"],
            crows, key=("route_key",), coalesce=("name", "event_id", "length_m"))
        counts["course_turn"] = fh6db.upsert_many(cx, "course_turn", [
            "route_key", "turn_id", "seq", "arc_m", "apex_x", "apex_z", "radius_m", "angle_deg",
            "kind", "n_obs"], trows)
        counts["session"] = fh6db.upsert_many(cx, "session", [
            "session_id", "started_utc", "duration_s", "frames", "rate_pps", "source",
            "file_path", "imported_at", "summary"], srows)
        counts["session_car"] = fh6db.upsert_many(cx, "session_car", [
            "session_id", "cid", "ordinal", "build_id", "hw_hash", "name", "class", "pi",
            "drivetrain", "cyl", "live_s"], scrows)
        counts["session_event"] = fh6db.upsert_many(cx, "session_event", [
            "session_id", "i", "t0", "t1", "cid", "mode", "solo", "laps", "distance_m",
            "duration_s", "start_x", "start_z", "end_x", "end_z", "route_key", "start_is_line"], erows, chunk=2000)
        counts["lap"] = fh6db.upsert_many(cx, "lap", [
            "lap_id", "route_key", "session_id", "cid", "container", "hw_hash", "t0", "lap_s",
            "arc_m", "coverage", "is_partial", "build_id", "class", "pi", "drivetrain",
            "tune_hash", "solo", "is_race", "impacts", "void", "lap_dist_m", "rewinds", "pauses", "pause_s",
            "stitched", "official"], lrows, chunk=2000)
        # pedals ride along when the database has the schema-6 columns (rebuild.py migrates first); an older
        # database gets the same rows without them rather than a failed import
        _lp_cols = {r[1] for r in cx.execute("PRAGMA table_info(lap_point)")}
        _lp_ped = _lp_cols >= {"thr", "brk"}
        _lp_lat = _lp_cols >= {"thr", "brk", "lat_g"}   # schema 7: peak |lat_g| rides along too
        _lp_names = ["lap_id", "i", "arc_m", "mph", "grip", "x", "z", "elev_m", "dist_m"] \
            + (["thr", "brk"] if _lp_ped else []) + (["lat_g"] if _lp_lat else [])
        _lp_rows = prows if _lp_lat else ([r[:11] for r in prows] if _lp_ped else [r[:9] for r in prows])
        counts["lap_point"] = fh6db.upsert_many(cx, "lap_point", _lp_names, _lp_rows, chunk=10000)
        counts["lap_marker"] = fh6db.upsert_many(cx, "lap_marker", [
            "lap_id", "i", "kind", "t", "dur_s", "race_s", "dist_m", "over_line", "detail"], mrows, chunk=2000)

        # bind laps to the setup that drove them, where the tune hash identifies one
        cx.execute("""UPDATE lap SET container = (
              SELECT c.container FROM tune_container c
              WHERE c.tune_hash IS NOT NULL AND c.tune_hash = lap.tune_hash LIMIT 1)
            WHERE tune_hash IS NOT NULL AND container IS NULL""")
        cx.execute("""UPDATE lap SET hw_hash = (
              SELECT c.hw_hash FROM tune_container c WHERE c.container = lap.container)
            WHERE container IS NOT NULL AND hw_hash IS NULL""")
        # and the session-car row to the package its laps identified: the session file
        # never carries a hash, so before this the column was NULL on every row
        cx.execute("""UPDATE session_car SET hw_hash = (
              SELECT l.hw_hash FROM lap l
              WHERE l.session_id = session_car.session_id AND l.cid = session_car.cid
                AND l.hw_hash IS NOT NULL
              GROUP BY l.hw_hash ORDER BY COUNT(*) DESC LIMIT 1)
            WHERE hw_hash IS NULL""")
    if verbose:
        if orphan_route:
            print("  laps on routes with no model: %d rows across %d routes %s"
                  % (sum(orphan_route.values()), len(orphan_route), sorted(orphan_route)[:6]))
        if orphan_session:
            print("  laps referencing %d sessions not on disk (session_id set NULL)" % len(orphan_session))
    counts["_orphan_route_laps"] = sum(orphan_route.values())
    counts["_orphan_sessions"] = len(orphan_session)
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "telemetry", DATA)
    try:
        counts = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1, json.dumps(counts))
    for k in sorted(counts):
        print("  %-16s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
