#!/usr/bin/env python
"""THE UNDERSTEER GRADIENT, and the cornering measures that fall out of it.

Jett, 2026-09-20: "build the mode you need, we need to ensure that all cornering behavior characteristics
are fully understood and represented."

skidpad.py measures the grip CEILING and reports which axle is nearer its limit. That balance word is not
understeer in the sense of SAE J670 / ISO 8855, and this file is the thing that is. The standard defines the
understeer gradient K as the rate of change of the UNDERSTEER ANGLE with lateral acceleration, the understeer
angle being the steer beyond the Ackermann angle L/R:

    understeer angle = d - L/R          K = d(understeer angle) / d(a_y)
    K > 0 understeer      K = 0 neutral steer      K < 0 oversteer

WHY A DIFFERENT DRIVE FROM THE SKIDPAD. ISO 8855 gives three procedures -- constant radius, constant speed,
constant steer -- and warns that the answer depends on which was run. skidpad.py enforces a CONSTANT RADIUS
(radius CoV <= 25%), and on a constant-radius run 1/R cannot vary, so anything derived from its variation
comes out zero no matter what the car does. That was measured, not assumed: the Exocet's clean circles all
returned 0.0 +- 0.5 deg/g.

This mode runs CONSTANT STEER instead, and that choice is what makes the measurement possible at all. The
road-wheel steer angle is not in the telemetry -- `Steer` is a controller axis and SlipAngle* is normalised
like CombinedSlip, not degrees -- but on a constant-steer test the unknown angle is HELD, so it cancels:

    K = d(d - L/R)/d(a_y) = -L * d(1/R)/d(a_y)

Every term on the right is measured. `Steer` never needs calibrating to degrees; it only has to prove the
lock was held, which it does perfectly well as a raw axis.

WHAT FALLS OUT, once K and L are known (bicycle model, steady state):

    yaw velocity gain      r/d   = V / (L + K V^2)          1/s per radian of steer
    lateral accel gain     a_y/d = V^2 / (L + K V^2)        (m/s^2) per radian
    characteristic speed   sqrt(L/K)       understeer only: where d is twice the Ackermann angle
    critical speed         sqrt(-L/K)      oversteer only: where the gains go to infinity

THE RUN (about 60 seconds per direction)
  1. Same requirements as the skidpad: flat, paved, open, assists off. Space to run WIDE -- the whole point
     is that the circle grows, so leave twice the room a skidpad needs.
  2. Roll in at about 25 mph, wind on a moderate steering lock -- half lock is ideal -- and then DO NOT MOVE
     THE WHEEL AGAIN. Freezing the lock is the entire measurement; everything else is secondary.
  3. Squeeze the speed up smoothly and slowly, over fifteen or twenty seconds, until the car reaches its
     limit. Gentle throttle: hard acceleration eats the tyre's grip budget sideways and biases the fit.
  4. Let the line go where it wants. If the car understeers the circle will open out; that widening IS the
     signal. Fighting it with more lock destroys the run.
  5. Both directions, as ever.

Read-only over capture CSVs. Prints a gradient per run and the derived measures.
"""
from __future__ import annotations
import argparse
import glob
import math
import os
import sqlite3
import statistics as st
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skidpad as S                                                      # noqa: E402  (frames plumbing, _rows/_f)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MPS, G = 0.44704, 9.80665

STEER_MIN = 12.0          # of 127 -- below this the car is barely turning and 1/R is noise
# AND THE LOCK MUST NOT BE PINNED. At full lock the axis reads 127 no matter what the hands do, so it is
# trivially "constant" and the held-lock test passes for the wrong reason -- the first run of this mode
# matched eighteen skidpad circles that way, every one of them at 125-127. A real constant-steer sweep is
# driven at a moderate lock with room to move, so a saturated axis is rejected rather than trusted.
STEER_MAX = 120.0
LAT_G_MAX = 3.0           # above this it is a kerb or a wall, not cornering (matches the corner detector)
STEER_COV = 0.10          # the lock counts as HELD within this much of its own mean
AY_SWEEP_MIN = 0.45       # g of lateral sweep inside one run, or there is no gradient to fit
RUN_MIN_S = 5.0
R2_MIN = 0.70             # the fit must actually explain the curvature before a gradient is quoted
SPEED_MIN = 15.0


def frames(path):
    """frames of a constant-steer attempt: turning, not braking, with the steering axis recorded"""
    for r in S._rows(path):
        if (S._f(r, "IsRaceOn") or 0) < 1:
            continue
        lat, lg, spd, yaw = (S._f(r, k) for k in ("lat_g", "long_g", "speed_mph", "yaw_rate_dps"))
        steer, t = S._f(r, "Steer"), S._f(r, "t_mono")
        if None in (lat, lg, spd, yaw, steer, t):
            continue
        if spd < SPEED_MIN or abs(yaw) < 6 or not (STEER_MIN <= abs(steer) <= STEER_MAX):
            continue
        if abs(lat) > LAT_G_MAX:
            continue
        if (S._f(r, "Brake") or 0) > 5:
            continue
        # some longitudinal force is unavoidable -- the speed has to rise -- but it must stay a small part
        # of the friction circle or it biases the very curvature being measured
        if abs(lg) > max(0.30, 0.25 * abs(lat)):
            continue
        omega = abs(yaw) * math.pi / 180.0
        if omega < 1e-3:
            continue
        yield {"t": t, "lat": abs(lat), "spd": spd, "steer": steer, "car": r.get("CarOrdinal"),
               "pi": r.get("CarPI"), "dir": "L" if yaw > 0 else "R", "r": (spd * MPS) / omega}


def runs(fr):
    """contiguous stretches with the lock HELD and the lateral g sweeping"""
    out, cur = [], []
    for f in fr:
        if cur and not (f["t"] - cur[-1]["t"] < 0.5 and f["dir"] == cur[-1]["dir"]
                        and f["car"] == cur[-1]["car"]):
            out.append(cur)
            cur = []
        cur.append(f)
    if cur:
        out.append(cur)
    keep = []
    for run in out:
        if len(run) < 60 or (run[-1]["t"] - run[0]["t"]) < RUN_MIN_S:
            continue
        sv = [abs(x["steer"]) for x in run]
        m = st.mean(sv)
        if m <= 0 or st.pstdev(sv) / m > STEER_COV:        # the lock moved -- not a constant-steer run
            continue
        ay = [x["lat"] for x in run]
        if max(ay) - min(ay) < AY_SWEEP_MIN:               # no sweep -- nothing to take a gradient of
            continue
        keep.append(run)
    return keep


def gradient(run, L):
    """K = -L * d(1/R)/d(a_y), by least squares over the run. Returns rad per (m/s^2) and deg per g."""
    ay = [x["lat"] * G for x in run]                       # m/s^2
    inv = [1.0 / x["r"] for x in run]                      # 1/m
    mx, my = st.mean(ay), st.mean(inv)
    den = sum((a - mx) ** 2 for a in ay)
    if den <= 0:
        return None
    slope = sum((a - mx) * (b - my) for a, b in zip(ay, inv)) / den
    # how much of the curvature variation the fit actually explains -- a low r2 means the lock wandered
    # or the car was not in steady state, and the number should not be quoted
    ss_tot = sum((b - my) ** 2 for b in inv)
    ss_res = sum((b - (my + slope * (a - mx))) ** 2 for a, b in zip(ay, inv))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    K = -L * slope                                         # rad per (m/s^2)
    return {"K": K, "K_deg_g": K * (180.0 / math.pi) * G, "r2": r2,
            "ay_lo": min(x["lat"] for x in run), "ay_hi": max(x["lat"] for x in run)}


def derived(K, L):
    """the measures the standard hangs off the gradient -- all of them are K and L and nothing else"""
    out = {}
    if K > 1e-6:
        out["characteristic_mph"] = math.sqrt(L / K) / MPS
    elif K < -1e-6:
        out["critical_mph"] = math.sqrt(-L / K) / MPS
    for mph in (40, 60, 80):
        V = mph * MPS
        den = L + K * V * V
        if den <= 0:                                       # past the critical speed the model diverges
            out[f"gain_{mph}"] = None
            continue
        out[f"gain_{mph}"] = {"yaw_per_rad": V / den, "ay_g_per_rad": (V * V / den) / G}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("captures", nargs="+")
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "fh6.db"))
    args = ap.parse_args()

    cx = sqlite3.connect("file:" + args.db.replace("\\", "/") + "?mode=ro", uri=True)

    def wheelbase(ordn):
        r = cx.execute("""SELECT b.wheelbase_m FROM ref_car c JOIN ref_car_body b
                          ON b.carbody_id = c.stock_carbody_id WHERE c.ordinal=?""", (ordn,)).fetchone()
        return r[0] if r and r[0] else None

    paths = []
    for p in args.captures:
        paths.extend(sorted(glob.glob(p)) or [p])

    found = {}
    for p in paths:
        for run in runs(list(frames(p))):
            found.setdefault(run[0]["car"], []).append(run)

    if not found:
        print("no constant-steer runs found.\n"
              "  This mode needs the STEERING LOCK HELD (within 10% of its own mean) while the lateral g\n"
              f"  sweeps at least {AY_SWEEP_MIN} g, for {RUN_MIN_S:.0f} s or more. A skidpad circle will not\n"
              "  qualify: chasing a fixed radius means moving the wheel. See the protocol at the top of\n"
              "  this file -- freeze the lock and let the line run wide.")
        return

    for car, rs in found.items():
        L = wheelbase(int(car))
        if not L:
            print(f"car {car}: no wheelbase on record, cannot compute a gradient")
            continue
        print(f"\ncar {car}  wheelbase {L:.2f} m  ({len(rs)} constant-steer run(s))")
        print(f"  {'dir':>3} {'s':>5} {'lock':>5} {'a_y sweep':>11} {'r2':>5}   K")
        good = []
        for run in rs:
            g = gradient(run, L)
            if not g:
                continue
            lock = st.mean([abs(x["steer"]) for x in run])
            flag = "" if g["r2"] >= R2_MIN else "   <- poor fit, not a steady constant-steer sweep"
            print(f"  {run[0]['dir']:>3} {run[-1]['t'] - run[0]['t']:5.1f} {lock:5.0f} "
                  f"{g['ay_lo']:4.2f}-{g['ay_hi']:4.2f} g {g['r2']:5.2f}   "
                  f"{g['K_deg_g']:+6.2f} deg/g{flag}")
            if g["r2"] >= R2_MIN:
                good.append(g["K"])
        if not good:
            print("  no run fit well enough to quote a gradient")
            continue
        K = st.median(good)
        Kd = K * (180.0 / math.pi) * G
        word = "UNDERSTEER" if Kd > 0.15 else "OVERSTEER" if Kd < -0.15 else "NEUTRAL STEER"
        print(f"  -> K = {Kd:+.2f} deg/g over {len(good)} run(s): {word}")
        d = derived(K, L)
        if "characteristic_mph" in d:
            print(f"     characteristic speed {d['characteristic_mph']:.0f} mph "
                  f"(where the steer needed is twice the Ackermann angle)")
        if "critical_mph" in d:
            print(f"     CRITICAL SPEED {d['critical_mph']:.0f} mph "
                  f"(an oversteer car is directionally unstable above this)")
        for mph in (40, 60, 80):
            gn = d.get(f"gain_{mph}")
            if gn:
                print(f"     at {mph:3d} mph: yaw gain {gn['yaw_per_rad']:6.2f} 1/s per rad, "
                      f"lateral gain {gn['ay_g_per_rad']:6.2f} g per rad")
            else:
                print(f"     at {mph:3d} mph: past the critical speed -- the steady-state model diverges")


if __name__ == "__main__":
    main()
