#!/usr/bin/env python3
"""import_consolidate.py -- collapse duplicate-road courses onto one canonical identity.

Runs after course_match (which resolves course_route.route_id) and before route_names (which
names courses from that id). Two jobs, both driven by canon_routes.canonical_map:

  1. CANONICALISE identity. Every course_route.route_id (and anchor_route_id) is rewritten to
     its canonical route id, so a course the matcher pinned to a twin (route:6001 -> 30006) now
     reads as the real catalogued road (6001), and route_names gives it the catalogued name.
     This applies to EVERY course, partials included -- it only fixes the label, never the laps.

  2. MERGE whole-course duplicates. Courses that each drove a WHOLE lap of the same canonical
     road (match_kind verified/probable) are the same course split by the keying glitch, so their
     laps are pooled: the losers' laps / events / diagnostics are re-pointed to one survivor key
     (route:<canonical> when present, else the most-driven key) and the loser course rows removed.

Only verified/probable members are pooled. A 'partial' course drove part of the road; pooling its
part-laps with whole laps would corrupt the lap-time record (fh6_owt.verdict is emphatic about
this), so a partial keeps its own key and only has its identity relabelled by job 1.

course_turn / course_event rows for a loser are DELETED, not re-pointed: course_turn's key is
(route_key, turn_id) so the survivor's own turns would collide, and corners / route_names rebuild
both downstream from the pooled laps. session_event / corner_* / diag_event carry route_key as a
plain column and are re-pointed in place.

Idempotent: telemetry may re-create a twin course from its capture on the next run, but this stage
re-derives the map and re-merges every rebuild, so the database converges back to one course per
road. Transactional with deferred foreign keys -- a collision rolls the whole pass back untouched.

Run:  python scripts/db/import_consolidate.py [--db PATH] [-v]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                             # noqa: E402
import canon_routes                                      # noqa: E402

MERGE_KINDS = ("verified", "probable")
#: tables carrying a denormalised route_key column, re-pointed in place after the lap dedup
REPOINT_TABLES = ("session_event", "corner_obs", "corner_segment", "diag_event")
#: tables whose (route_key, ...) primary key would collide on merge -- dropped, rebuilt downstream
DROP_TABLES = ("course_turn", "course_event")


def load_courses(cx):
    """{route_key: {route_id, anchor, match_kind, laps}} for every course."""
    out = {}
    for r in cx.execute(
            "SELECT c.route_key, cr.route_id, cr.anchor_route_id, cr.match_kind, "
            "(SELECT COUNT(*) FROM lap l WHERE l.route_key = c.route_key) AS laps "
            "FROM course c LEFT JOIN course_route cr ON cr.route_key = c.route_key"):
        out[r["route_key"]] = {"route_id": r["route_id"], "anchor": r["anchor_route_id"],
                               "match_kind": r["match_kind"], "laps": r["laps"] or 0}
    return out


def road_of(key, info, canon_of):
    """The canonical route id a course sits on, from its matched id or its route:<id> key."""
    rid = info["route_id"]
    if rid is None and key.startswith("route:"):
        cand = key.split(":", 1)[1]
        if cand in canon_of:
            rid = cand
    if rid is None:
        return None
    return canon_of.get(rid, rid)


def plan_merges(courses, canon_of):
    """{canonical route id: (survivor_key, [loser_keys])} for every road with >1 whole-course drive."""
    groups = {}
    for key, info in courses.items():
        if info["match_kind"] in MERGE_KINDS:
            road = road_of(key, info, canon_of)
            if road is not None:
                groups.setdefault(road, []).append(key)
    merges = {}
    for road, keys in groups.items():
        if len(keys) < 2:
            continue
        preferred = "route:%s" % road
        if preferred in keys:
            survivor = preferred
        else:
            survivor = max(keys, key=lambda k: (courses[k]["laps"], k))
        merges[road] = (survivor, sorted(k for k in keys if k != survivor))
    return merges


def run(cx, verbose=False):
    canon_of, cls, meta = canon_routes.canonical_map(cx)
    courses = load_courses(cx)
    merges = plan_merges(courses, canon_of)

    merged_rows = []
    for road, (survivor, losers) in sorted(merges.items()):
        merged_rows.append((road, survivor, losers))

    # empty artifacts: a course a session_event opened but nothing was driven on and no path was
    # captured -- 0 laps AND no geometry. (A 0-lap course that DOES have a centre-line, e.g. its
    # only laps were voided, keeps its identity and is left alone.)
    empties = [r["route_key"] for r in cx.execute(
        "SELECT c.route_key FROM course c WHERE "
        "(SELECT COUNT(*) FROM lap l WHERE l.route_key=c.route_key)=0 AND "
        "(json_array_length(json_extract(c.geometry,'$.path')) IS NULL OR "
        " json_array_length(json_extract(c.geometry,'$.path'))=0)")]

    n_dedup = n_repoint_laps = n_relabel = 0
    with cx:
        cx.execute("BEGIN")
        cx.execute("PRAGMA defer_foreign_keys=ON")

        # 1. merge whole-course duplicates into one survivor key
        for _road, survivor, losers in merged_rows:
            for lz in losers:
                # 1a. the twin glitch recorded the SAME physical lap under both keys; drop the copy
                #     that would collide with one already under the survivor (mirrors lap's UNIQUE:
                #     all of session_id/cid/t0 present and equal -- a NULL makes the row its own).
                n_dedup += cx.execute(
                    "DELETE FROM lap WHERE route_key=? AND session_id IS NOT NULL AND cid IS NOT NULL "
                    "AND EXISTS (SELECT 1 FROM lap s WHERE s.route_key=? AND s.session_id=lap.session_id "
                    "            AND s.cid=lap.cid AND s.t0=lap.t0)", (lz, survivor)).rowcount or 0
                # 1b. re-point the genuinely distinct laps (deleting the dups first frees the constraint)
                n_repoint_laps += cx.execute(
                    "UPDATE lap SET route_key=? WHERE route_key=?", (survivor, lz)).rowcount or 0
                # 1c. denormalised route_key columns follow the laps (the deleted dups' rows cascaded away)
                for tbl in REPOINT_TABLES:
                    cx.execute("UPDATE %s SET route_key=? WHERE route_key=?" % tbl, (survivor, lz))
                # 1d. keys that would collide on the survivor's turn/event PKs are rebuilt downstream
                for tbl in DROP_TABLES:
                    cx.execute("DELETE FROM %s WHERE route_key=?" % tbl, (lz,))
                cx.execute("DELETE FROM course_route WHERE route_key=?", (lz,))
                cx.execute("DELETE FROM course WHERE route_key=?", (lz,))

        # 2. canonicalise the identity of every surviving course_route row
        for r in cx.execute("SELECT route_key, route_id, anchor_route_id FROM course_route").fetchall():
            rid, anch = r["route_id"], r["anchor_route_id"]
            nrid = canon_of.get(rid, rid) if rid is not None else None
            nanch = canon_of.get(anch, anch) if anch is not None else None
            if nrid != rid or nanch != anch:
                cx.execute("UPDATE course_route SET route_id=?, anchor_route_id=? WHERE route_key=?",
                           (nrid, nanch, r["route_key"]))
                n_relabel += 1

        # 3. refresh the survivors' lap counts (name/length stay route_names' job, downstream)
        for _road, survivor, _losers in merged_rows:
            cx.execute("UPDATE course SET n_laps=(SELECT COUNT(*) FROM lap WHERE lap.route_key=course.route_key) "
                       "WHERE route_key=?", (survivor,))

        # 4. drop the empty artifacts (course_turn / course_route cascade; no laps to lose)
        for k in empties:
            cx.execute("DELETE FROM course WHERE route_key=?", (k,))

    if verbose:
        for _road, survivor, losers in merged_rows:
            n = cx.execute("SELECT n_laps FROM course WHERE route_key=?", (survivor,)).fetchone()
            print("  %-16s <- %-32s  now %s laps" % (survivor, " + ".join(losers), n[0] if n else "?"))
        if empties:
            print("  pruned %d empty course(s): %s" % (len(empties), ", ".join(empties)))
    return {"merged_courses": sum(len(l) for _r, _s, l in merged_rows),
            "duplicate_laps_dropped": n_dedup, "laps_repointed": n_repoint_laps,
            "relabelled": n_relabel, "empties_pruned": len(empties)}, merged_rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    cx = fh6db.connect(a.db)
    fh6db.migrate(cx)
    rid = fh6db.run_begin(cx, "consolidate", "db")
    try:
        counts, merged = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, counts["merged_courses"], 1, json.dumps({"counts": counts}))
    for k in ("merged_courses", "duplicate_laps_dropped", "laps_repointed", "relabelled", "empties_pruned"):
        print("  %-22s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
