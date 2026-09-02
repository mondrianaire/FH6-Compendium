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


def run(cx, aitracks, verbose=False):
    routes = fh6_owt.load_all(aitracks)
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

    matches = fh6_owt.match_courses(routes)
    known = {r[0] for r in cx.execute("SELECT route_key FROM course")}
    now = fh6db.utcnow()
    mrows = []
    for m in matches:
        if m["route_key"] not in known:
            continue
        v = fh6_owt.verdict(m)
        mrows.append((m["route_key"], m["route_id"] if v != "none" else None, v,
                      m["mean_dev_m"], m["p95_dev_m"], m["covered"], m["len_ratio"],
                      m["runner_up"], now))

    with cx:
        cx.execute("PRAGMA defer_foreign_keys=ON")
        for t in ("course_route", "ref_route_point", "ref_route"):
            cx.execute("DELETE FROM %s" % t)
        n_r = fh6db.upsert_many(cx, "ref_route", [
            "route_id", "name", "length_m", "n_points", "is_loop",
            "bbox_x0", "bbox_x1", "bbox_z0", "bbox_z1", "source"], rrows)
        n_p = fh6db.upsert_many(cx, "ref_route_point", ["route_id", "i", "x", "y", "z"],
                                prows, chunk=10000)
        n_m = fh6db.upsert_many(cx, "course_route", [
            "route_key", "route_id", "match_kind", "mean_dev_m", "p95_dev_m", "covered",
            "len_ratio", "runner_up", "computed_utc"], mrows)
        # a course that matches a whole game route inherits the route's identity
        cx.execute("""UPDATE course SET length_m = COALESCE(length_m, (
              SELECT r.length_m FROM course_route cr JOIN ref_route r ON r.route_id = cr.route_id
               WHERE cr.route_key = course.route_key AND cr.match_kind IN ('verified','probable')))
            WHERE length_m IS NULL""")

    kinds = {}
    for m in mrows:
        kinds[m[2]] = kinds.get(m[2], 0) + 1
    return {"ref_route": n_r, "ref_route_point": n_p, "course_route": n_m}, kinds


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
    print("  matches: %s" % ", ".join("%d %s" % (v, k) for k, v in sorted(kinds.items(), key=lambda t: -t[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
