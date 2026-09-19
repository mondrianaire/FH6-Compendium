#!/usr/bin/env python
"""Which measurement of "this build's grip ceiling" is the least noisy? -- and the answer is the one we had.

Jett, 2026-09-18: "yes, change the target to the steady-state ceiling and re-score."

The reasoning for changing it was: lat_g p95 is a PEAK over each 4 m point's raw frames, so a kerb or a
compression spikes it, and fitting a steady-state grip model to a transient measurement is a category error.
The sustained lateral acceleration a = v^2/r, from a point's own speed and its own driven radius, looked like
the honest target.

IT IS NOT. Measured as a noise floor -- how much the same build's number moves across DIFFERENT courses,
which is pure error because the ceiling is a property of the car:

    lat_g p95  (current)     0.259 g median cross-course spread   <- least noisy
    lat_g p90                0.261
    v^2/r p85                0.296
    v^2/r p90                0.328
    v^2/r p95                0.467
    v^2/r per-band p90       0.663
    v^2/r per-band p95       0.773

And re-scoring the v2 model on the same 25 builds against each target (leave-one-out, per-compound constant):

    target lat_g p95  (peak)    model 0.277 g   baseline 0.327 g   -15%
    target v^2/r p85  (steady)  model 0.300 g   baseline 0.212 g   +42%   -- worse than guessing

WHY, and it is worth keeping: v^2/r measures what the DRIVER did; peak lat_g measures what the CAR withstood.
The sustained value is mediated by how hard the corner was attacked, which is similar across builds -- note
the baseline is much better on that target (0.212), i.e. builds' sustained cornering is more alike than their
peak grip, so there is less about the build in it to predict.

THE REAL CONCLUSION. The v2 model's error (0.277 g) is now at the target's own noise floor (0.259 g). Model
form is no longer the bottleneck -- measurement precision is, and no amount of extra terms can be told apart
from noise on this data. To go further, the ceiling needs measuring better, not modelling better: more laps
per build, or one controlled constant-radius run per build, which would give a clean a_max directly and make
the whole prediction problem checkable to a tenth of a g.

Read-only. Prints the table; renders nothing.
"""
import collections
import os
import sqlite3
import statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import argparse
_ap = argparse.ArgumentParser(description="grip-ceiling target noise floor (read-only)")
_ap.add_argument("--db", default=os.path.join(ROOT, "data", "fh6.db"))
DB = _ap.parse_args().db
cx = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True)
cx.row_factory = sqlite3.Row
MPS, G = 0.44704, 9.80665
R_LO, R_HI, MPH_FLOOR = 15.0, 300.0, 15.0
EDGES = [15, 22, 32, 46, 66, 95, 140, 200, 300]


def q(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p * (len(v) - 1)))] if v else None


# per (build, course, lap) so "sustained" can look at consecutive points within one lap
laps = collections.defaultdict(list)
for r in cx.execute(f"""
    SELECT l.hw_hash hw, l.tune_hash tu, l.route_key rk, l.lap_id, p.i, p.mph, p.r_m, p.lat_g
    FROM lap l JOIN lap_point p ON p.lap_id = l.lap_id
    WHERE p.mph IS NOT NULL AND l.void = 0 AND p.grip <> 4 AND p.mph >= {MPH_FLOOR}
      AND l.hw_hash IS NOT NULL AND l.tune_hash IS NOT NULL
    ORDER BY l.lap_id, p.i"""):
    laps[(r["hw"], r["tu"], r["rk"], r["lap_id"])].append(r)

# build the per-(build, course) sample pools each candidate needs
pools = collections.defaultdict(lambda: {"peak": [], "ss": [], "sust": [], "bins": collections.defaultdict(list)})
for (hw, tu, rk, _), pts in laps.items():
    P = pools[((hw, tu), rk)]
    run = 0
    for i, p in enumerate(pts):
        if p["lat_g"] is not None:
            P["peak"].append(p["lat_g"])
        r_m = p["r_m"]
        if r_m is None or not (R_LO <= r_m <= R_HI):
            run = 0
            continue
        a = (p["mph"] * MPS) ** 2 / r_m / G
        if a > 5:
            run = 0
            continue
        P["ss"].append(a)
        for lo, hi in zip(EDGES, EDGES[1:]):
            if lo <= r_m < hi:
                P["bins"][lo].append(a)
                break
        # SUSTAINED: this point and the one before it are in the same corner, i.e. both curving and at a
        # similar radius. A ceiling read off a single isolated sample is reading a transient again.
        prev = pts[i - 1] if i else None
        if prev and prev["r_m"] and R_LO <= prev["r_m"] <= R_HI and \
                abs(r_m - prev["r_m"]) / max(r_m, prev["r_m"]) < 0.25:
            run += 1
            if run >= 2:
                P["sust"].append(a)
        else:
            run = 0


def by_bin(P, p):
    """high quantile within each radius band, then the median across bands -- robust to one odd band"""
    vals = [q(v, p) for k, v in P["bins"].items() if len(v) >= 30]
    return st.median(vals) if len(vals) >= 3 else None


CANDS = {
    "lat_g p95  (current)": lambda P: q(P["peak"], .95) if len(P["peak"]) >= 250 else None,
    "lat_g p90": lambda P: q(P["peak"], .90) if len(P["peak"]) >= 250 else None,
    "v^2/r p95": lambda P: q(P["ss"], .95) if len(P["ss"]) >= 250 else None,
    "v^2/r p90": lambda P: q(P["ss"], .90) if len(P["ss"]) >= 250 else None,
    "v^2/r p85": lambda P: q(P["ss"], .85) if len(P["ss"]) >= 250 else None,
    "v^2/r sustained p90": lambda P: q(P["sust"], .90) if len(P["sust"]) >= 200 else None,
    "v^2/r sustained p95": lambda P: q(P["sust"], .95) if len(P["sust"]) >= 200 else None,
    "v^2/r per-band p90": lambda P: by_bin(P, .90),
    "v^2/r per-band p95": lambda P: by_bin(P, .95),
}

print(f"{'target':<24} {'builds':>6} {'median spread':>14} {'mean spread':>12} {'level':>7}")
print("-" * 68)
res = {}
for name, fn in CANDS.items():
    byb = collections.defaultdict(list)
    for (k, rk), P in pools.items():
        v = fn(P)
        if v is not None:
            byb[k].append(v)
    spreads = [max(v) - min(v) for v in byb.values() if len(v) >= 3]
    levels = [st.median(v) for v in byb.values() if len(v) >= 3]
    if len(spreads) >= 5:
        res[name] = st.median(spreads)
        print(f"{name:<24} {len(spreads):6d} {st.median(spreads):14.3f} {st.mean(spreads):12.3f} "
              f"{st.median(levels):7.2f}")
print()
best = min(res, key=res.get)
print(f"least noisy target: {best}  ({res[best]:.3f} g median cross-course spread)")
