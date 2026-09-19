#!/usr/bin/env python
"""Does every course's drawn path match the road the game says it is?

Jett, 2026-09-18, on the Horizon Festival Drag Strip: "still showing with a tail going to the right. are
other courses also misrepresented?"

RESULT, 2026-09-18, over 127 courses: the fleet is healthy and there are exactly two faults.

  100 of 101 bound courses track their catalogued road to within 30 m.

  route:4501  Horizon Festival Drag Strip   WRONG ROAD. Its route match was REJECTED (match_kind "none",
              mean deviation 3881 m, p95 9999) -- yet the course still carries route 4501's NAME, because
              the name is asserted from the key while the geometry match is not. So it is drawn as some
              other road under the drag strip's name. This is the one Jett saw.
  route:1201  Temple Cross Country          BOUND but 81% of its path sits off that road, worst 337 m;
              1074 m of path against a 7872 m route. A short fragment bound to a long route it is not on.
  route:1023  The Titan                     benign: never matched, but only because coverage is 6.7%. Its
              path is within 5 m of the road, so it is a fragment, not a wrong road.

The lesson worth keeping is the first one: a course can be NAMED after a route whose geometry was rejected,
and nothing downstream says so. The name and the match are separate facts and the export only carries one
of them clearly. Hence the second check below.

Every bound course can be checked the same way, because both halves exist: ref_route_point holds the game's
centre-line and the course JSON holds what we drew. For each point of OUR path this measures the distance to
the NEAREST point of the catalogued line -- not to a straight line, so a genuinely curved route is fine --
and reports:

    off%     share of our path that sits more than --tol metres off the catalogued road
    where    whether that off-road share is at the start, the end, or in the middle
             (a TAIL is an approach or a run-off absorbed into the course; a BULGE in the middle is
              usually a different road entirely, or two courses merged)
    len      our length against the catalogued length

A course can legitimately be shorter than its route (a fragment, only partly driven), so a low length ratio
alone is not a fault. Being far from the road is.

Read-only. Prints a ranked table; --json writes the full result.
"""
from __future__ import annotations
import argparse
import glob
import json
import math
import os
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def nearest_dists(pts, line, cell):
    """distance from each of pts to the nearest point of line, via a uniform grid (no numpy needed)"""
    grid = {}
    for x, z in line:
        grid.setdefault((int(x // cell), int(z // cell)), []).append((x, z))
    out = []
    for x, z in pts:
        gx, gy = int(x // cell), int(z // cell)
        best = None
        rings = 1
        while True:
            cand = []
            for i in range(gx - rings, gx + rings + 1):
                for j in range(gy - rings, gy + rings + 1):
                    cand.extend(grid.get((i, j), ()))
            if cand:
                best = min((x - a) ** 2 + (z - b) ** 2 for a, b in cand)
                # one more ring than the first hit, so a point near a cell edge cannot be missed
                if rings >= 2 or math.sqrt(best) <= (rings - 0.5) * cell:
                    break
            rings += 1
            if rings > 8:
                break
        out.append(math.sqrt(best) if best is not None else float("inf"))
    return out


def plen(p):
    return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "fh6.db"))
    ap.add_argument("--api", default=os.path.join(ROOT, "dashboard", "v2", "api", "course"))
    ap.add_argument("--tol", type=float, default=30.0, help="metres off the catalogued road before a point counts as off it")
    ap.add_argument("--json", help="write the full result here")
    args = ap.parse_args()

    cx = sqlite3.connect("file:" + args.db.replace("\\", "/") + "?mode=ro", uri=True)
    cx.row_factory = sqlite3.Row
    names = {str(r["route_id"]): r["display_name"] for r in cx.execute(
        "SELECT route_id, display_name FROM ref_track_info WHERE display_name IS NOT NULL")}

    rows, unmatched = [], []
    skipped = {"no route": 0, "no path": 0, "no centre-line": 0}
    for fp in sorted(glob.glob(os.path.join(args.api, "*.json"))):
        try:
            d = json.load(open(fp, encoding="utf-8"))
        except Exception:                                   # noqa: BLE001
            continue
        path = d.get("path") or []
        r = d.get("route") or {}
        rid = r.get("route_id")
        if not rid:
            # A COURSE CAN BE NAMED AFTER A ROUTE IT NEVER MATCHED. The key carries route:<id> and the name
            # is looked up from it, but the geometry match can have been REJECTED -- and nothing downstream
            # says so, which is how a drag strip ends up drawn as somebody else's road under the right name.
            # That is the fault worth catching, so it is reported rather than quietly skipped.
            key = str(d.get("key") or "")
            if key.startswith("route:"):
                unmatched.append({"key": key, "name": d.get("name") or "", "match": r.get("match_kind"),
                                  "mean_dev_m": r.get("mean_dev_m"), "p95_dev_m": r.get("p95_dev_m"),
                                  "covered": r.get("covered"), "laps": len(d.get("laps") or [])})
            else:
                skipped["no route"] += 1
            continue
        if len(path) < 8:
            skipped["no path"] += 1
            continue
        line = [(r["x"], r["z"]) for r in cx.execute(
            "SELECT x, z FROM ref_route_point WHERE route_id=? ORDER BY i", (rid,))]
        if len(line) < 8:
            skipped["no centre-line"] += 1
            continue
        dist = nearest_dists([(q[0], q[1]) for q in path], line, cell=60.0)
        off = [i for i, v in enumerate(dist) if v > args.tol]
        n = len(dist)
        share = len(off) / n
        # where does the off-road part sit? head / tail / middle, by the median index of the off points
        if off:
            mid = sorted(off)[len(off) // 2] / n
            where = "tail" if mid > 0.75 else "head" if mid < 0.25 else "middle"
        else:
            where = "-"
        rows.append({
            "file": os.path.basename(fp), "route": str(rid), "name": d.get("name") or names.get(str(rid)) or "",
            "off_share": share, "where": where, "worst_m": max(dist), "p95_m": sorted(dist)[int(0.95 * (n - 1))],
            "our_len": plen(path), "route_len": plen(line), "n": n,
        })

    rows.sort(key=lambda r: -r["off_share"])
    bad = [r for r in rows if r["off_share"] >= 0.05]
    print(f"{len(rows)} bound courses checked  ·  tolerance {args.tol:.0f} m off the catalogued road")
    print(f"skipped: " + ", ".join(f"{k} {v}" for k, v in skipped.items() if v))
    print(f"\n{len(bad)} course(s) with 5% or more of their path off the road:\n")
    print(f"{'route':>6} {'off%':>5} {'where':>6} {'worst':>7} {'p95':>6} {'ours m':>8} {'route m':>8}  name")
    for r in bad[:40]:
        print(f"{r['route']:>6} {r['off_share'] * 100:5.0f} {r['where']:>6} {r['worst_m']:7.0f} "
              f"{r['p95_m']:6.0f} {r['our_len']:8.0f} {r['route_len']:8.0f}  {r['name'][:44]}")
    if unmatched:
        print("")
        print(f"{len(unmatched)} course(s) NAMED after a route whose geometry never matched. The name is"
              f" asserted from the key while the")
        print("match was rejected, so the drawn road may be someone else's:")
        print("")
        print(f"{'key':<14} {'match':>6} {'mean dev':>9} {'p95 dev':>8} {'cover':>6} {'laps':>5}  name")
        for u in sorted(unmatched, key=lambda x: -(x["mean_dev_m"] or 0)):
            verdict = ("WRONG ROAD" if (u["mean_dev_m"] or 0) > 100
                       else "fragment -- on the road, too little of it to confirm")
            print(f"{u['key']:<14} {str(u['match']):>6} {round(u['mean_dev_m'] or 0):9} "
                  f"{round(u['p95_dev_m'] or 0):8} {u['covered']:6} {u['laps']:5}  {u['name'][:30]}  <- {verdict}")

    clean = len(rows) - len(bad)
    print(f"\n{clean} of {len(rows)} ({clean / max(1, len(rows)):.0%}) track their catalogued road to within {args.tol:.0f} m")
    if args.json:
        json.dump(rows, open(args.json, "w", encoding="utf-8"), indent=1)
        print(f"full result -> {args.json}")


if __name__ == "__main__":
    main()
