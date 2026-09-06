#!/usr/bin/env python3
"""import_course_match.py -- how our courses map onto the game's routes, from the DB alone.

Reads ref_route/ref_route_point and course entirely from data/fh6.db -- no .owt files, no
data/courses/*.json globbing -- and writes course_route with the match evidence. Splitting
this out of import_routes.py (2026-09-05) is what makes course_route survive a telemetry
rerun: it now depends on the DB rows telemetry and routes left behind, not on the moment
either of those stages happened to run.

'partial' is a first-class verdict: it says our lap records belong to a stretch of that route,
which is true and useful, without claiming the lap times are times for the route. See
scripts/telemetry/fh6_owt.py (compare/verdict) for the matching rule itself.

Run:  python scripts/db/import_course_match.py [--db PATH] [-v]
      python scripts/db/import_course_match.py --selftest
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import fh6db                                            # noqa: E402
import fh6_owt                                          # noqa: E402

#: the kinds histogram a read-only reproduction gave on 2026-09-05, over 65 courses
EXPECTED_KINDS = {"partial": 34, "verified": 8, "none": 21, "probable": 2}
EXPECTED_N = sum(EXPECTED_KINDS.values())


def load_routes(cx):
    """[{route_id, length_m, is_loop, bbox, points}] from ref_route/ref_route_point.

    points are (x, y, z) triples, the 4 m decimated copy ref_route_point already holds --
    the matcher only reads x and z, but fh6_owt.compare() indexes a 3-tuple.
    """
    rows = list(cx.execute(
        "SELECT route_id, length_m, is_loop, bbox_x0, bbox_x1, bbox_z0, bbox_z1 FROM ref_route"))
    pts_by_route = {}
    for p in cx.execute("SELECT route_id, x, y, z FROM ref_route_point ORDER BY route_id, i"):
        pts_by_route.setdefault(p["route_id"], []).append((p["x"], p["y"], p["z"]))
    routes = []
    for r in rows:
        routes.append({
            "route_id": r["route_id"],
            "length_m": r["length_m"],
            "is_loop": None if r["is_loop"] is None else bool(r["is_loop"]),
            "bbox": [r["bbox_x0"], r["bbox_x1"], r["bbox_z0"], r["bbox_z1"]],
            "points": pts_by_route.get(r["route_id"], []),
        })
    return routes


def load_courses(cx):
    """[{route_key, name, geometry}] from `course`, geometry parsed back to a dict."""
    courses = []
    for c in cx.execute("SELECT route_key, name, geometry FROM course"):
        try:
            geo = json.loads(c["geometry"]) if c["geometry"] else {}
        except Exception:                                # noqa: BLE001
            geo = {}
        courses.append({"route_key": c["route_key"], "name": c["name"], "geometry": geo})
    return courses


def match(cx):
    """Run the matcher over the whole DB. -> (matched course rows, kinds histogram)."""
    routes = load_routes(cx)
    courses = load_courses(cx)
    matched = fh6_owt.match_courses(routes, courses=courses)
    kinds = {}
    for m in matched:
        kinds[fh6_owt.verdict(m)] = kinds.get(fh6_owt.verdict(m), 0) + 1
    return matched, kinds


def run(cx, verbose=False):
    matched, kinds = match(cx)
    now = fh6db.utcnow()
    mrows = []
    for m in matched:
        v = fh6_owt.verdict(m)
        mrows.append((m["route_key"], m["route_id"] if v != "none" else None, v,
                      m["mean_dev_m"], m["p95_dev_m"], m["covered"], m["len_ratio"],
                      m["runner_up"], now))
    matched_keys = [m["route_key"] for m in matched]

    with cx:
        cx.execute("BEGIN")                  # a PRAGMA outside a transaction autocommits and resets itself
        cx.execute("PRAGMA defer_foreign_keys=ON")
        cx.execute("CREATE TEMP TABLE IF NOT EXISTS _keep(route_key TEXT PRIMARY KEY)")
        cx.execute("DELETE FROM _keep")
        cx.executemany("INSERT INTO _keep(route_key) VALUES(?)", [(k,) for k in matched_keys])
        n_del = cx.execute(
            "DELETE FROM course_route WHERE route_key NOT IN (SELECT route_key FROM _keep)").rowcount or 0
        n_m = fh6db.upsert_many(cx, "course_route", [
            "route_key", "route_id", "match_kind", "mean_dev_m", "p95_dev_m", "covered",
            "len_ratio", "runner_up", "computed_utc"], mrows)
        # a course that matches a whole game route inherits the route's identity
        cx.execute("""UPDATE course SET length_m = COALESCE(length_m, (
              SELECT r.length_m FROM course_route cr JOIN ref_route r ON r.route_id = cr.route_id
               WHERE cr.route_key = course.route_key AND cr.match_kind IN ('verified','probable')))
            WHERE length_m IS NULL""")

    if verbose:
        print("  %d stale course_route row(s) removed" % n_del)
    return {"course_route": n_m}, kinds


def cmd_selftest(a):
    t0 = time.time()
    cx = fh6db.connect(a.db, ro=True)
    matched, kinds = match(cx)
    dt = time.time() - t0
    ok = kinds == EXPECTED_KINDS and len(matched) == EXPECTED_N
    print("%d courses matched in %.1fs" % (len(matched), dt))
    for k in sorted(set(kinds) | set(EXPECTED_KINDS)):
        got, want = kinds.get(k, 0), EXPECTED_KINDS.get(k, 0)
        print("  %-10s got=%-4d want=%-4d %s" % (k, got, want, "ok" if got == want else "FAIL"))
    if len(matched) != EXPECTED_N:
        print("  n            got=%-4d want=%-4d %s" % (
            len(matched), EXPECTED_N, "ok" if len(matched) == EXPECTED_N else "FAIL"))
    print("SELFTEST %s" % ("PASSED" if ok else "FAILED"))
    return 0 if ok else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--selftest", action="store_true",
                     help="match read-only and check the kinds histogram against 2026-09-05")
    a = ap.parse_args(argv)
    if a.selftest:
        return cmd_selftest(a)

    cx = fh6db.connect(a.db)
    fh6db.migrate(cx)
    rid = fh6db.run_begin(cx, "course_match", "db")
    try:
        counts, kinds = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1,
                  json.dumps({"counts": counts, "kinds": kinds}))
    for k in sorted(counts):
        print("  %-18s %8d" % (k, counts[k]))
    print("  matches: %s" % ", ".join(
        "%d %s" % (v, k) for k, v in sorted(kinds.items(), key=lambda t: -t[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
