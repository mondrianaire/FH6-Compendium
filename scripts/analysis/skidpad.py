#!/usr/bin/env python
"""SKIDPAD: read a build's grip ceiling off the tyre curve instead of estimating it from laps.

Jett, 2026-09-18: "lets do the skidpad runs".

WHY THIS BEATS EVERY ESTIMATE SO FAR. `CombinedSlip` is Forza's own normalised slip, per wheel, at 60 Hz,
and 1.0 IS the tyre's limit -- analyze_session already thresholds it to produce lap_point.grip, then throws
the continuous value away. So the ceiling was never something to infer from a high quantile of peaks. Plot
|lat_g| against CombinedSlip and the tyre curve appears, rises, PEAKS, and falls over the far side:

    car 3429, one capture, all driving   1.59 1.95 2.30 2.55 2.71 2.72 [2.78] 2.62 2.36 2.20
    the same rows, skidpad conditions    1.67 1.99 2.40 2.73 2.87 3.04 [3.08] 2.85 2.74 2.69
                        CombinedSlip      0.5  0.6  0.7  0.8  0.9  1.0   1.1  1.2  1.3  1.4

a_max is the peak of that curve, read off, not estimated -- and the peak sits exactly where Forza says the
limit is. "Skidpad conditions" is why the second row is cleaner: CombinedSlip mixes lateral and longitudinal
slip, so braking or driving hard out of a corner raises the slip without raising the lateral g and smears
the peak. Hold a steady speed on a steady radius and the slip is almost purely lateral.

WHY THE RUN IS STILL NEEDED, given that the archive already holds the channel. Jett asked the right
question -- "why do we suddenly need user input?" -- once CombinedSlip turned the ceiling into a reading.
It was worth checking before spending anyone's evening, so: the same build, six independent sessions, the
curve peak read off captures we already had.

    session        frames   front a_max   rear a_max
    165005         13903        2.506        2.448
    215226          1799        2.318        2.495
    225846          5068        2.480        2.404
    231118          3464        2.595        2.508
    235344           273        2.724          -        (too thin to weigh)
    022735          6238        2.230        2.313
    spread                       0.37 g       0.20 g     vs 0.259 g for the old lat_g p95 target

Equivocal, not a win: the rear is better than the old estimate, the front is worse. Scavenged frames come
from DIFFERENT CORNERS -- different radii, speeds, load transfers and steering inputs -- and the peak of the
curve moves with all of them. The front varies most, which fits: front slip is dominated by steering input,
wildly different corner to corner, while the rear mostly follows the car's attitude.

A circle holds radius, speed, steering and load transfer constant. That is the one thing 25 GB of archive
cannot supply after the fact, and it is exactly the variance in the table above. So the run is justified by
a measurement rather than by an assumption -- and the claim it has to beat is specific: collapse a
0.20-0.37 g spread toward the repeatability of a controlled test.

DO TWO BUILDS FIRST, both directions each -- about three minutes. If the two circles on one build agree to
within ~0.05 g the protocol works and the rest is worth driving; if they do not, that is cheap to find out.

THE RUN (about 90 seconds per build):
  1. Somewhere flat, open, dry and paved, with room for a circle 80-100 m across. An airfield apron or a
     large car park is ideal. It must be FLAT -- a camber adds or removes lateral g and would be read as grip.
  2. Hold a steady circle in one direction. Do not brake. Do not lift sharply.
  3. Wind the speed up a few mph at a time until the car will not hold the line any tighter, then STAY there
     for ten seconds or so, riding the limit. That plateau is the measurement.
  4. Repeat the other way. Both directions cancel any camber and any left/right asymmetry in the car, and
     the analyser reports them separately so a difference shows up rather than averaging away.
  Optional: split the stint (/new-run) and tag it "skidpad" so the run is trivially findable later; the
  detector below does not need the tag and will find the run anyway.

WHAT IT REPORTS, per run and per axle: the peak of the curve (a_max), the slip it peaked at, the radius and
speed held, and which axle peaked LOWER -- that axle is the one that gives up first, which is the balance
answer the a-priori model was only 77% right about, measured directly here.

Read-only over capture CSVs. Writes nothing unless --out is given.
"""
from __future__ import annotations
import argparse
import collections
import csv
import glob
import gzip
import json
import math
import os
import statistics as st

MPS = 0.44704
# what counts as skidpad conditions, frame by frame
LONG_G_MAX = 0.20       # neither braking nor driving hard: keep the friction circle almost purely lateral
BRAKE_MAX = 5           # the brake pedal at all is disqualifying
YAW_MIN = 8.0           # deg/s -- actually turning, not drifting down a straight
SPEED_MIN = 18.0        # mph
RUN_MIN_S = 4.0         # a run must be sustained; anything shorter is a corner, not a skidpad
RADIUS_COV = 0.25       # radius steady to within this over the run
SLIP_MAX = 2.2


def _rows(path):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt", newline="", encoding="utf-8", errors="replace") as f:
        yield from csv.DictReader(f)


def _f(r, k):
    v = r.get(k)
    if v in (None, "", "None"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def frames(path):
    """every frame that is in skidpad condition, with its radius and per-axle slip"""
    for r in _rows(path):
        if (_f(r, "IsRaceOn") or 0) < 1:
            continue
        lat, lg, spd, yaw = _f(r, "lat_g"), _f(r, "long_g"), _f(r, "speed_mph"), _f(r, "yaw_rate_dps")
        if None in (lat, lg, spd, yaw):
            continue
        if spd < SPEED_MIN or abs(lg) > LONG_G_MAX or abs(yaw) < YAW_MIN:
            continue
        if (_f(r, "Brake") or 0) > BRAKE_MAX:
            continue
        fl, fr, rl, rr = (_f(r, "CombinedSlip" + w) for w in ("FL", "FR", "RL", "RR"))
        if None in (fl, fr, rl, rr):
            continue
        t = _f(r, "t_mono")
        if t is None:
            continue
        omega = abs(yaw) * math.pi / 180.0
        if omega < 1e-3:
            continue
        yield {"t": t, "lat": abs(lat), "spd": spd, "dir": "L" if yaw > 0 else "R",
               "r": (spd * MPS) / omega,
               "sf": max(abs(fl), abs(fr)), "sr": max(abs(rl), abs(rr)),
               "car": r.get("CarOrdinal"), "pi": r.get("CarPI"), "cls": r.get("CarClass")}


def runs(fr):
    """group consecutive in-condition frames into runs: one direction, one steady radius, sustained"""
    out, cur = [], []
    for f in fr:
        if cur:
            gap = f["t"] - cur[-1]["t"]
            same = gap < 0.5 and f["dir"] == cur[-1]["dir"] and f["car"] == cur[-1]["car"]
            if not same:
                out.append(cur)
                cur = []
        cur.append(f)
    if cur:
        out.append(cur)
    keep = []
    for run in out:
        if len(run) < 30 or (run[-1]["t"] - run[0]["t"]) < RUN_MIN_S:
            continue
        rs = [x["r"] for x in run]
        m = st.median(rs)
        if m <= 0 or (st.pstdev(rs) / m) > RADIUS_COV:   # not a steady radius -- a corner, not a circle
            continue
        keep.append(run)
    return keep


def curve(samples, slip_key):
    """|lat_g| binned by that axle's CombinedSlip, and the peak of it -- the reading we came for"""
    by = collections.defaultdict(list)
    for s in samples:
        v = s[slip_key]
        if 0 < v <= SLIP_MAX:
            by[round(v, 1)].append(s["lat"])
    pts = [(k, st.median(v), len(v)) for k, v in sorted(by.items()) if len(v) >= 12]
    if len(pts) < 5:
        return None
    # the peak, smoothed over three neighbouring bins so one thin bin cannot become the answer
    best = None
    for i, (k, a, n) in enumerate(pts):
        w = pts[max(0, i - 1):i + 2]
        sm = sum(x[1] * x[2] for x in w) / sum(x[2] for x in w)
        if best is None or sm > best[1]:
            best = (k, sm, n)
    return {"peak": round(best[1], 3), "at_slip": best[0], "n": sum(p[2] for p in pts),
            "curve": [[k, round(a, 3), n] for k, a, n in pts]}


def main():
    ap = argparse.ArgumentParser(description="skidpad grip-ceiling reader (read-only)")
    ap.add_argument("captures", nargs="+", help="capture CSV or CSV.GZ paths, or globs")
    ap.add_argument("--out", help="write the runs as JSON here")
    ap.add_argument("--pooled", action="store_true",
                    help="pool every run of the same car+PI instead of listing them separately")
    args = ap.parse_args()

    paths = []
    for p in args.captures:
        paths.extend(sorted(glob.glob(p)) or [p])

    found = []
    for p in paths:
        fr = list(frames(p))
        for run in runs(fr):
            f0 = run[0]
            rec = {"capture": os.path.basename(p), "car": f0["car"], "pi": f0["pi"], "cls": f0["cls"],
                   "dir": f0["dir"], "s": round(run[-1]["t"] - run[0]["t"], 1),
                   "radius_m": round(st.median([x["r"] for x in run]), 1),
                   "mph": round(st.median([x["spd"] for x in run]), 1),
                   "front": curve(run, "sf"), "rear": curve(run, "sr")}
            if rec["front"] or rec["rear"]:
                found.append((rec, run))

    if not found:
        print("no skidpad runs found. The detector wants a steady radius held for 4 s or more, one "
              "direction, no braking and |long g| under 0.20 -- see the protocol at the top of this file.")
        return

    print(f"{'capture':<28} {'car':>5} {'PI':>4} {'dir':>3} {'s':>5} {'radius':>7} {'mph':>5} "
          f"{'front a_max':>11} {'rear a_max':>10}  gives up first")
    def cell(c):
        return f"{c['peak']:.2f} @{c['at_slip']:.1f}" if c else "-"
    for rec, _ in found:
        f_, r_ = rec["front"], rec["rear"]
        first = "-"
        if f_ and r_:
            first = "front (understeer)" if f_["peak"] < r_["peak"] else "rear (oversteer)"
        print(f"{rec['capture']:<28} {str(rec['car']):>5} {str(rec['pi']):>4} {rec['dir']:>3} "
              f"{rec['s']:5.1f} {rec['radius_m']:7.1f} {rec['mph']:5.1f} "
              f"{cell(f_):>11} {cell(r_):>10}  {first}")

    if args.pooled:
        print()
        byc = collections.defaultdict(list)
        for rec, run in found:
            byc[(rec["car"], rec["pi"])].append((rec, run))
        for (car, pi), g in byc.items():
            allf = [s for _, run in g for s in run]
            cf, cr = curve(allf, "sf"), curve(allf, "sr")
            dirs = {rec["dir"] for rec, _ in g}
            print(f"car {car} PI {pi}: {len(g)} runs, {''.join(sorted(dirs))}, "
                  f"front {cf['peak'] if cf else '—'} g, rear {cr['peak'] if cr else '—'} g")
            if len(dirs) < 2:
                print("    only one direction driven -- run the circle the other way too, so a camber or a "
                      "left/right asymmetry shows up instead of being read as grip")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump([rec for rec, _ in found], f, indent=1)
        print(f"\n{len(found)} runs -> {args.out}")


if __name__ == "__main__":
    main()
