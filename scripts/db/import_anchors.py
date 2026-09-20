#!/usr/bin/env python3
"""import_anchors.py -- the game's race-activation spheres -> route_anchor, ref_route.is_race.

Reads race_triggers.tz from the install (READ-ONLY) via scripts/telemetry/fh6_anchors.py and
stores one row per sphere whose rt<N> is a ref_route id. Runs after `routes` (the FK parent) and
before `course_match`, which uses the spheres to corroborate and tie-break its geometry verdicts.

An anchor is a route id at a world position -- the only shipped binding between the two. It is not
a name: see fh6_anchors.py for exactly what a sphere does and does not prove.

Run:  python scripts/db/import_anchors.py [--db PATH] [--tz PATH] [-v]
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
import fh6_anchors                                      # noqa: E402


def run(cx, tz_path=fh6_anchors.TZ_PATH, verbose=False):
    anchors = fh6_anchors.load(tz_path)
    if not anchors:
        raise RuntimeError("no race-activation spheres read from %r" % tz_path)
    known = {r[0] for r in cx.execute("SELECT route_id FROM ref_route")}
    rows, unknown = [], []
    for a in anchors:
        if a["route_id"] in known:
            rows.append((a["route_id"], a["x"], a["y"], a["z"], a["radius_m"], a["name"],
                         os.path.basename(tz_path)))
        else:
            unknown.append(a["route_id"])
    if verbose and unknown:
        print("  %d sphere(s) name a route id that is not in ref_route: %s" % (len(unknown), unknown))
    with cx:
        cx.execute("BEGIN")                  # a PRAGMA outside a transaction autocommits and resets itself
        cx.execute("PRAGMA defer_foreign_keys=ON")
        cx.execute("DELETE FROM route_anchor")
        n = fh6db.upsert_many(cx, "route_anchor", [
            "route_id", "x", "y", "z", "radius_m", "name", "source"], rows)
        cx.execute("UPDATE ref_route SET is_race = CASE WHEN route_id IN "
                   "(SELECT route_id FROM route_anchor) THEN 1 ELSE 0 END")
    return {"route_anchor": n, "unknown_route_ids": len(unknown)}, {"unknown": unknown}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--tz", default=fh6_anchors.TZ_PATH)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    fh6db.migrate(cx)
    rid = fh6db.run_begin(cx, "anchors", a.tz)
    try:
        counts, notes = run(cx, a.tz, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, counts["route_anchor"], 1, json.dumps({"counts": counts, "notes": notes}))
    for k in sorted(counts):
        print("  %-18s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
