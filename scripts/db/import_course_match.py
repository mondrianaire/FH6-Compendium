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

ANCHORS (2026-09-05). After the geometry verdict, the game's race-activation spheres
(route_anchor, from race_triggers.tz) are consulted: for each course, the sphere most of its
session events STARTED in (session_event.start_x/z). The sphere is an observation -- "this run
began where route N's race begins" -- so it corroborates and tie-breaks geometry, and never
replaces a verdict geometry has evidence against:

  verified   anchor_agree = (anchor == route_id); the verdict stands either way (WARN on 0 in --check)
  probable   anchor in {route_id, runner_up} -> route_id = anchor, 'verified' (the sphere broke the tie)
  partial    anchor_agree recorded; the verdict stands (we still have not driven the whole route)
  none       'anchored', route_id stays NULL, the identity lives in anchor_route_id only: the course
             is identified by where its races start, its shape is unverified, and every consumer
             that gates on route_id (corners, the dashboard's centre-line, naming) must keep
             treating it as unidentified (33 of 36 spheres have another route's centre-line
             within 100 m -- see fh6_anchors.py).

A sphere may PROMOTE (probable -> verified, none -> anchored) only when it holds a strict majority
of ALL the course's events (at least 2, and more than half): a route_key can bundle drives that
began in different places, and an event whose start is the capture-window start rather than a
detected start line (session_event.start_is_line = 0) may lie anywhere on the road. Below the
majority the evidence is still recorded in anchor_route_id / anchor_events, nothing moves.

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
import fh6_anchors                                      # noqa: E402

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


def anchor_evidence(cx):
    """({route_key: {anchor route_id: n events that started inside its sphere}},
        {route_key: n events with a start position at all}) from session_event x route_anchor.
    A course's events are the ones the analyzer attributed to its route_key; the second dict is
    the denominator of the majority rule."""
    anchors = [dict(r) for r in cx.execute("SELECT route_id, x, z, radius_m FROM route_anchor")]
    hits, totals = {}, {}
    if not anchors:
        return hits, totals
    for e in cx.execute("SELECT route_key, start_x, start_z FROM session_event "
                        "WHERE route_key IS NOT NULL AND start_x IS NOT NULL AND start_z IS NOT NULL"):
        totals[e["route_key"]] = totals.get(e["route_key"], 0) + 1
        a = fh6_anchors.inside(anchors, e["start_x"], e["start_z"])
        if a is not None:
            d = hits.setdefault(e["route_key"], {})
            d[a["route_id"]] = d.get(a["route_id"], 0) + 1
    return hits, totals


def apply_anchors(route_key, route_id, kind, runner_up, hits, total=0):
    """(route_id, kind, anchor_route_id, anchor_events, anchor_agree) -- the rule in the docstring.
    `hits` is {anchor route_id: n events}, `total` the course's event count. An even split between
    two spheres is no anchor; a sphere promotes only with a strict majority of `total` (>= 2)."""
    if not hits:
        return route_id, kind, None, None, None
    best = sorted(hits.items(), key=lambda t: (-t[1], t[0]))
    if len(best) > 1 and best[0][1] == best[1][1]:
        return route_id, kind, None, sum(hits.values()), None
    aid, n = best[0]
    majority = n >= 2 and n * 2 > max(total, sum(hits.values()))
    if kind == "none":
        return None, ("anchored" if majority else "none"), aid, n, None
    if kind == "probable" and majority and aid in (route_id, runner_up):
        return aid, "verified", aid, n, 1
    return route_id, kind, aid, n, 1 if aid == route_id else 0


def run(cx, verbose=False):
    matched, kinds = match(cx)
    evidence, totals = anchor_evidence(cx) if fh6db.has_table(cx, "route_anchor") else ({}, {})
    now = fh6db.utcnow()
    mrows, kinds = [], {}
    for m in matched:
        v = fh6_owt.verdict(m)
        rid, v, aid, n_ev, agree = apply_anchors(
            m["route_key"], m["route_id"] if v != "none" else None, v, m["runner_up"],
            evidence.get(m["route_key"]), totals.get(m["route_key"], 0))
        kinds[v] = kinds.get(v, 0) + 1
        mrows.append((m["route_key"], rid, v,
                      m["mean_dev_m"], m["p95_dev_m"], m["covered"], m["len_ratio"],
                      m["runner_up"], now, aid, n_ev, agree))
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
            "len_ratio", "runner_up", "computed_utc", "anchor_route_id", "anchor_events",
            "anchor_agree"], mrows)
        # a course that matches a whole game route inherits the route's identity
        cx.execute("""UPDATE course SET length_m = COALESCE(length_m, (
              SELECT r.length_m FROM course_route cr JOIN ref_route r ON r.route_id = cr.route_id
               WHERE cr.route_key = course.route_key AND cr.match_kind IN ('verified','probable')))
            WHERE length_m IS NULL""")

    if verbose:
        print("  %d stale course_route row(s) removed" % n_del)
        n_anch = sum(1 for r in mrows if r[9] is not None)
        print("  %d course(s) with anchor evidence; %d anchored, %d disagree with geometry"
              % (n_anch, sum(1 for r in mrows if r[2] == "anchored"), sum(1 for r in mrows if r[11] == 0)))
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
