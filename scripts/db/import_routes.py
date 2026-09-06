#!/usr/bin/env python3
"""import_routes.py -- the game's own route centre-lines, and how our courses map onto them.

Reads Route<id>.owt from the install (READ-ONLY) via scripts/telemetry/fh6_owt.py, stores every
centre-line as rows, then matches each learned course against them and stores the verdict WITH
its evidence.

The match is deliberately conservative. A game route and a learned course are the same thing
only when our path lies on the centre-line AND we have driven essentially all of it AND the
lengths agree. Routes share roads, so "we are within 3 m of it" alone identifies nothing --
that test alone made two different courses both come out as Route 2281.

'partial' is a first-class verdict: it says our lap records belong to a stretch of that route,
which is true and useful, without claiming the lap times are times for the route.

Run:  python scripts/db/import_routes.py [--db PATH] [--dir AITRACKS] [-v]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import fh6db                                            # noqa: E402
import fh6_owt                                          # noqa: E402
import fh6_turns                                        # noqa: E402


def run(cx, aitracks, verbose=False):
    # full=True keeps all 14 floats per point: the turn detector needs the lateral width vector
    # and the surface normal, not just the position the matcher uses.
    routes = fh6_owt.load_all(aitracks, full=True)
    if not routes:
        raise RuntimeError("no .owt centre-lines under %r" % aitracks)

    rrows, prows = [], []
    for r in routes:
        rrows.append((r["route_id"], None, r["length_m"], r["n"], 1 if r["is_loop"] else 0,
                      r["bbox"][0], r["bbox"][1], r["bbox"][2], r["bbox"][3], r["file"]))
        # store the centre-line decimated to ~4 m: the full 2 m resolution is 300k rows for no
        # gain, and every consumer draws or measures at coarser scale than that
        for i, p in enumerate(r["points"]):
            if i % 2:
                continue
            prows.append((r["route_id"], i, p[0], p[1], p[2]))

    # turns from the road itself: stable, ordered, and the same every run
    trows = []
    for r in routes:
        for t in fh6_turns.turns_for(r):
            trows.append((r["route_id"], t["turn_id"], t["seq"], t["arc_m"], t["apex_arc_m"],
                          t["apex_x"], t["apex_y"], t["apex_z"], t["radius_m"],
                          t["peak_radius_m"], t["angle_deg"], t["dir"], t["kind"],
                          t["length_m"], t["width_m"], t["bank_deg"]))

    # The course <-> route MATCH is no longer computed here (2026-09-05): stage course_match
    # (scripts/db/import_course_match.py) does it from the DB alone, after telemetry AND routes, so a
    # telemetry rerun cannot leave course_route empty. course_route is therefore NOT deleted below:
    # its route_id has no cascade, the same ids are re-inserted before the deferred check, and a
    # vanished .owt id is nulled first so the commit cannot fail on it.
    new_ids = {r[0] for r in rrows}
    with cx:
        # BEGIN first: Python's sqlite3 does not open a transaction for a PRAGMA, so a bare
        # defer_foreign_keys=ON autocommits and is OFF again by the first DELETE (review, 2026-09-05).
        cx.execute("BEGIN")
        cx.execute("PRAGMA defer_foreign_keys=ON")
        for stale in [r[0] for r in cx.execute("SELECT route_id FROM ref_route") if r[0] not in new_ids]:
            cx.execute("UPDATE course_route SET route_id=NULL, match_kind='none' WHERE route_id=?", (stale,))
            if fh6db.has_table(cx, "course_event"):
                cx.execute("UPDATE course_event SET route_id=NULL WHERE route_id=?", (stale,))
        for t in ("ref_route_turn", "ref_route_point", "ref_route"):
            cx.execute("DELETE FROM %s" % t)
        n_r = fh6db.upsert_many(cx, "ref_route", [
            "route_id", "name", "length_m", "n_points", "is_loop",
            "bbox_x0", "bbox_x1", "bbox_z0", "bbox_z1", "source"], rrows)
        n_p = fh6db.upsert_many(cx, "ref_route_point", ["route_id", "i", "x", "y", "z"],
                                prows, chunk=10000)
        n_t = fh6db.upsert_many(cx, "ref_route_turn", [
            "route_id", "turn_id", "seq", "arc_m", "apex_arc_m", "apex_x", "apex_y", "apex_z",
            "radius_m", "peak_radius_m", "angle_deg", "dir", "kind", "length_m", "width_m",
            "bank_deg"], trows, chunk=2000)

    return {"ref_route": n_r, "ref_route_point": n_p, "ref_route_turn": n_t}, {}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--dir", default=fh6_owt.AITRACKS)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "routes", a.dir)
    try:
        counts, kinds = run(cx, a.dir, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1, json.dumps({"counts": counts, "kinds": kinds}))
    for k in sorted(counts):
        print("  %-18s %8d" % (k, counts[k]))
    print("  (course <-> route matches are computed by stage course_match)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
