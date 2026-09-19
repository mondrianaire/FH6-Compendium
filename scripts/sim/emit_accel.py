#!/usr/bin/env python3
"""Precompute the modeled WOT acceleration curve for every car -> dashboard/v2/api/accel.json.

Runs the fleet-calibrated simulator (scripts/sim/wot_sim.py) once per car in the STOCK configuration and
writes a compact record the dashboard renders as a per-car acceleration / top-speed chart. Keyed by ordinal.
Re-run after the sim is recalibrated (like build_web.py, this writes into the per-worktree api/).

    python scripts/sim/emit_accel.py

Each record: { trace:[[t_s, mph, gear], ...], top_mph, t60, t100, tqmile, trap_mph,
               ref:{top_mph, t60, t100, tqmile, trap_mph} }   (ref = the game's own Sim* numbers)
The trace stops once the car is within 1 mph of its modeled top speed (the drag-limited crawl is dropped).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wot_sim as W  # noqa: E402

MPH = W.MPH
OUT = os.path.join(W.REPO, "dashboard", "v2", "api", "accel.json")


def ordinals():
    import sqlite3
    fx = sqlite3.connect("file:%s?mode=ro" % os.path.join(W.REPO, "data", "fh6.db").replace("\\", "/"), uri=True)
    return [r[0] for r in fx.execute(
        "SELECT ordinal FROM ref_car WHERE stock_engine_id IS NOT NULL AND stock_drivetrain_id IS NOT NULL "
        "AND cylinders > 0 AND num_gears >= 3 ORDER BY ordinal")]


def one(car):
    sim = W.simulate(car, dt=0.004, tmax=45)
    top = W.top_speed_fast(car)
    top_mph = top * MPH
    trace = []
    for t, mph, gear, _rpm in sim["trace"]:
        trace.append([round(t, 2), round(mph, 1), gear])
        if mph >= top_mph * 0.97 and t > 2:           # within 3% of top -> stop; the last-few-mph crawl is a drag tail
            break
        if len(trace) >= 70:
            break
    return {
        "trace": trace,
        "top_mph": round(top_mph, 1),
        "t60": round(sim["t_60"], 2) if sim["t_60"] else None,
        "t100": round(sim["t_100"], 2) if sim["t_100"] else None,
        "tqmile": round(sim["t_qmile"], 2) if sim["t_qmile"] else None,
        "trap_mph": round((sim["v_qmile"] or 0) * MPH, 1) if sim["v_qmile"] else None,
        "ref": {
            "top_mph": round(car["sim_top_ms"] * MPH, 1) if car["sim_top_ms"] else None,
            "t60": round(car["sim_0_60_s"], 2) if car["sim_0_60_s"] else None,
            "t100": round(car["sim_0_100_s"], 2) if car["sim_0_100_s"] else None,
            "tqmile": round(car["sim_qmile_s"], 2) if car["sim_qmile_s"] else None,
            "trap_mph": round(car["sim_qmile_trap_ms"] * MPH, 1) if car["sim_qmile_trap_ms"] else None,
        },
    }


def main():
    out, n_ok, n_skip = {}, 0, 0
    for o in ordinals():
        try:
            car = W.load_car(o)
            if not (car["torque_scale"] and car["gears"] and max(car["curve"]) > 10 and car["sim_top_ms"]):
                n_skip += 1
                continue
            out[str(o)] = one(car)
            n_ok += 1
        except Exception:                                # EV / missing part / odd powertrain
            n_skip += 1
    doc = {"schema": 1, "config": "stock",
           "accuracy": "modeled from the game's physics values; ~6% top speed, ~16% 0-60 vs the game's own numbers",
           "cars": out}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp, OUT)
    print("wrote %s: %d cars (%d skipped), %.1f KB" % (OUT, n_ok, n_skip, os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
