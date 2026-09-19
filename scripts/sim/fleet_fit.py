#!/usr/bin/env python3
"""Fleet calibration for the WOT simulator: fit the GLOBAL constants ONCE across many cars.

The per-car physics inputs are all catalogued (torque curve, gearing, mass, drag, tire geometry). Only a
handful of constants are not columns -- drivetrain efficiency, the drag-unit -> Newton conversion, rolling
resistance, the loaded-radius factor, and a launch-grip factor. They are meant to be GLOBAL (one set for the
whole fleet), so this fits them against the game's OWN physics outputs (Data_Car.Sim*) across a broad car
sample by coordinate descent, then reports the error distribution and the locked constants.

    python scripts/sim/fleet_fit.py                 # fit on a fleet sample, print locked constants
    python scripts/sim/fleet_fit.py --n 150         # bigger sample
"""
import argparse
import math
import os
import sqlite3
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wot_sim as W  # noqa: E402

MPH = W.MPH


def sample_ordinals(n):
    """A broad, deterministic sample across classes and drivetrains of cars with a usable stock powertrain."""
    fx = sqlite3.connect("file:%s?mode=ro" % os.path.join(W.REPO, "data", "fh6.db").replace("\\", "/"), uri=True)
    fx.row_factory = sqlite3.Row
    rows = fx.execute(
        "SELECT ordinal, class, drivetype FROM ref_car "
        "WHERE stock_engine_id IS NOT NULL AND stock_drivetrain_id IS NOT NULL "
        "AND cylinders > 0 AND num_gears >= 3 ORDER BY class, ordinal").fetchall()
    # even stride so every class/PI band is represented, not just the first N ordinals
    if len(rows) > n:
        step = len(rows) / n
        rows = [rows[int(i * step)] for i in range(n)]
    return [r["ordinal"] for r in rows]


def load_fleet(ordinals):
    fleet = []
    for o in ordinals:
        try:
            c = W.load_car(o)
        except Exception:                                    # EV / missing part / odd powertrain -> skip
            continue
        # sane, fittable combustion car with a real curve and the oracle numbers present
        if (c["torque_scale"] and c["gears"] and c["sim_top_ms"] and c["sim_0_60_s"]
                and c["sim_qmile_s"] and max(c["curve"]) > 10):
            fleet.append(c)
    return fleet


def car_errors(car, cst):
    """Signed fractional errors of the sim vs the oracle for one car under a constant set `cst`."""
    W.ROLL_CRR = cst["roll"]
    W.TIRE_LOAD = cst["tire_load"]
    de = cst["eff"].get(car["drivetype"], cst["eff_default"])
    sim = W.simulate(car, dt=0.006, tmax=14, drag_unit=cst["drag"], drive_eff=de, grip_mult=cst["grip"])
    top = W.top_speed_fast(car, drag_unit=cst["drag"], drive_eff=de)
    e = {}
    if car["sim_top_ms"]:
        e["top"] = (top - car["sim_top_ms"]) / car["sim_top_ms"]
    for key, got, want in (("t60", sim["t_60"], car["sim_0_60_s"]),
                           ("t100", sim["t_100"], car["sim_0_100_s"]),
                           ("qt", sim["t_qmile"], car["sim_qmile_s"]),
                           ("trap", sim["v_qmile"], car["sim_qmile_trap_ms"])):
        if got and want:
            e[key] = (got - want) / want
    return e


# Fit the global constants on the DRAG/POWER/GEARING metrics (which the model captures well); 0-60 / 0-100
# are launch-dominated and need a per-car friction-curve + weight-transfer launch model we don't have yet, so
# fitting on them would distort the good constants. They are still REPORTED, as the identified weak spot.
FIT_KEYS = ("top", "qt", "trap")


def fleet_cost(fleet, cst, keys=FIT_KEYS):
    """Median over cars of each car's RMS fractional error on `keys` -> robust to a few odd cars."""
    costs = []
    for car in fleet:
        e = {k: v for k, v in car_errors(car, cst).items() if k in keys}
        if e:
            costs.append(math.sqrt(sum(v * v for v in e.values()) / len(e)))
    return statistics.median(costs) if costs else 9e9


def fit(fleet):
    # grip is fixed (it only moves the launch, which we do not fit on); the rest are fitted on FIT_KEYS
    cst = {"drag": 0.0026, "grip": 1.8, "roll": 0.012, "tire_load": 0.975,
           "eff": {}, "eff_default": 0.88}
    grids = {
        "drag": lambda x: [x * m for m in (0.80, 0.88, 0.94, 0.98, 1.0, 1.02, 1.06, 1.13, 1.25)],
        "roll": lambda x: [0.004, 0.007, 0.010, 0.013, 0.017, 0.022, 0.028],
        "tire_load": lambda x: [0.940, 0.950, 0.960, 0.968, 0.975, 0.982, 0.990, 0.998],
        "eff_default": lambda x: [0.80, 0.83, 0.86, 0.88, 0.90, 0.92, 0.94, 0.96],
    }
    order = ["drag", "tire_load", "eff_default", "roll"]
    for _round in range(4):
        for p in order:
            best_v, best_c = cst[p], fleet_cost(fleet, cst)
            for v in grids[p](cst[p]):
                cst[p] = v
                c = fleet_cost(fleet, cst)
                if c < best_c:
                    best_c, best_v = c, v
            cst[p] = best_v
    # NOTE: a per-drivetrain efficiency split was tried and dropped — it produced physically-backwards values
    # (AWD > RWD) by absorbing unrelated drag/part-ID errors on the heavy AWD GTs. A single global eff is honest.
    return cst


def pctiles(vals):
    v = sorted(abs(x) for x in vals)
    if not v:
        return (None, None, None)
    return (v[len(v) // 2], v[int(len(v) * 0.9)], v[-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=120)
    a = ap.parse_args()
    ords = sample_ordinals(a.n)
    fleet = load_fleet(ords)
    print("fleet sample: %d cars" % len(fleet))
    from collections import Counter
    print("  drivetrains:", dict(Counter(c["drivetype"] for c in fleet)))

    cst = fit(fleet)
    print("\n== LOCKED GLOBAL CONSTANTS ==")
    print("  DRAG_UNIT   = %.5f" % cst["drag"])
    print("  GRIP_MULT   = %.3f" % cst["grip"])
    print("  ROLL_CRR    = %.4f" % cst["roll"])
    print("  TIRE_LOAD   = %.4f" % cst["tire_load"])
    print("  DRIVE_EFF   = %.3f (default) · per-drivetrain %s"
          % (cst["eff_default"], {k: round(v, 3) for k, v in cst["eff"].items()}))

    # error distribution over the fleet
    per = {"top": [], "t60": [], "t100": [], "qt": [], "trap": []}
    for car in fleet:
        for k, v in car_errors(car, cst).items():
            per[k].append(v)
    print("\n== FLEET ERROR (|%%|: median / p90 / max) over %d cars ==" % len(fleet))
    labels = {"top": "top speed", "t60": "0-60 mph", "t100": "0-100 mph", "qt": "1/4 mile", "trap": "1/4 trap"}
    for k in ("top", "t60", "t100", "qt", "trap"):
        med, p90, mx = pctiles(per[k])
        if med is not None:
            print("  %-10s  %5.1f%%   %5.1f%%   %5.1f%%   (n=%d)"
                  % (labels[k], med * 100, p90 * 100, mx * 100, len(per[k])))
    # worst top-speed offenders: usually a wrong stock part picked by the "lowest Id" heuristic
    worst = sorted(fleet, key=lambda c: -abs(car_errors(c, cst).get("top", 0)))[:8]
    print("\n== worst top-speed cars (candidate stock-part-ID errors) ==")
    for c in worst:
        e = car_errors(c, cst).get("top", 0)
        print("  %+5.0f%%  %-26s %s  %dg %s FD%.2f redline%.0f"
              % (e * 100, c["name"][:26], c["drivetype"], len(c["gears"]),
                 [round(x, 2) for x in c["gears"]], c["final_drive"], c["redline"]))


if __name__ == "__main__":
    main()
