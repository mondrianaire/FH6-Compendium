#!/usr/bin/env python3
"""Precompute modeled WOT acceleration curves -> dashboard/v2/api/accel.json.

Runs the fleet-calibrated simulator (scripts/sim/wot_sim.py) and writes a compact record the dashboard
renders as an acceleration / top-speed chart. Two layers:

  cars[ordinal]      -- the STOCK car, with `ref` = the game's OWN Sim* figures (the validation oracle).
  tunes[container]   -- a SAVED TUNE's gearing + mass + aero applied on top of the stock car (the engine
                        stays stock for now), with `ref` = the stock MODELED numbers, so the dashboard can
                        show "this tune vs stock". Only tunes that carry gearing (tune_gear) are emitted.

Re-run after the sim is recalibrated or tunes change (like build_web.py, writes into the per-worktree api/).
    python scripts/sim/emit_accel.py
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wot_sim as W  # noqa: E402

MPH = W.MPH
OUT = os.path.join(W.REPO, "dashboard", "v2", "api", "accel.json")


def fh6():
    return sqlite3.connect("file:%s?mode=ro" % os.path.join(W.REPO, "data", "fh6.db").replace("\\", "/"), uri=True)


def sim_record(car, ref=None, extra=None):
    sim = W.simulate(car, dt=0.004, tmax=45)
    top_mph = W.top_speed_fast(car) * MPH
    trace = []
    for t, mph, gear, _rpm in sim["trace"]:
        trace.append([round(t, 2), round(mph, 1), gear])
        if (mph >= top_mph * 0.97 and t > 2) or len(trace) >= 70:
            break
    rec = {
        "trace": trace, "top_mph": round(top_mph, 1),
        "t60": round(sim["t_60"], 2) if sim["t_60"] else None,
        "t100": round(sim["t_100"], 2) if sim["t_100"] else None,
        "tqmile": round(sim["t_qmile"], 2) if sim["t_qmile"] else None,
        "trap_mph": round((sim["v_qmile"] or 0) * MPH, 1) if sim["v_qmile"] else None,
    }
    if ref:
        rec["ref"] = ref
    if extra:
        rec.update(extra)
    return rec


def game_ref(car):
    r = lambda v, m=1.0: round(v * m, 2) if v else None
    return {"top_mph": r(car["sim_top_ms"], MPH), "t60": r(car["sim_0_60_s"]), "t100": r(car["sim_0_100_s"]),
            "tqmile": r(car["sim_qmile_s"]), "trap_mph": r(car["sim_qmile_trap_ms"], MPH), "src": "game"}


def stock_ref(rec):
    return {"top_mph": rec["top_mph"], "t60": rec["t60"], "t100": rec["t100"],
            "tqmile": rec["tqmile"], "trap_mph": rec["trap_mph"], "src": "stock"}


def usable(car):
    return (car["torque_scale"] and car["gears"] and max(car["curve"]) > 10 and car["sim_top_ms"]
            and car["final_drive"] and car["gears"][-1] and min(car["gears"]) > 0)


def main():
    fx = fh6(); fx.row_factory = sqlite3.Row
    ords = [r[0] for r in fx.execute(
        "SELECT ordinal FROM ref_car WHERE stock_engine_id IS NOT NULL AND stock_drivetrain_id IS NOT NULL "
        "AND cylinders > 0 AND num_gears >= 3 ORDER BY ordinal")]
    cars, base_cache = {}, {}
    n_car = n_skip = 0
    for o in ords:
        try:
            car = W.load_car(o)
        except Exception:
            n_skip += 1; continue
        if not usable(car):
            n_skip += 1; continue
        try:
            cars[str(o)] = sim_record(car, ref=game_ref(car))
        except Exception:
            n_skip += 1; continue
        base_cache[o] = car
        n_car += 1

    # per-tune: every saved tune that carries gearing, applied on the stock car
    tunes = {}
    n_tune = 0
    conts = fx.execute("""SELECT tc.container, tc.ordinal FROM tune_container tc
        WHERE tc.ordinal IS NOT NULL AND EXISTS (SELECT 1 FROM tune_gear g WHERE g.container = tc.container)""").fetchall()
    for row in conts:
        base = base_cache.get(row["ordinal"])
        if base is None:
            continue
        try:
            tc = W.tune_car(base, row["container"], fx)
            if not usable(tc):
                continue
            stock = cars[str(row["ordinal"])]
            rec = sim_record(tc, ref=stock_ref(stock), extra={
                "final_drive": round(tc["final_drive"], 3), "stock_fd": round(base["final_drive"], 3),
                "df_kgf": round(tc.get("_tune_df_kgf", 0.0), 1)})
        except Exception:
            continue
        tunes[row["container"]] = rec
        n_tune += 1

    doc = {"schema": 2, "config": "stock + tune-aware gearing/aero (engine stock)",
           "accuracy": "modeled from the game's physics values; ~6% top speed, ~16% 0-60 vs the game's own numbers. "
                       "Tunes apply their gearing, mass and aero; the engine torque curve is still stock.",
           "cars": cars, "tunes": tunes}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp, OUT)
    print("wrote %s: %d cars, %d tunes (%d skipped), %.1f KB"
          % (OUT, n_car, n_tune, n_skip, os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
