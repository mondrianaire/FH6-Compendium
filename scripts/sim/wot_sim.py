#!/usr/bin/env python3
"""WOT 0->top-speed longitudinal simulator, from catalogued values (prototype).

Verifies the claim that a car's behaviour is fully parameterised by decodable values by SIMULATING a
wide-open-throttle pull purely from the game DB (Data_Car chassis + List_TorqueCurve + the stock
transmission) and checking it against the game's OWN physics outputs (Data_Car.Sim*), which is the
strongest possible offline oracle: if our integrator reproduces the game's top speed and 0-60 / 0-100 /
quarter-mile across the fleet, the parameters really do determine behaviour.

The only non-catalogued terms are a small set of GLOBAL constants (drivetrain efficiency, a drag-unit
conversion, rolling resistance, rotating-inertia fraction) fitted ONCE, not per car. r_tire is derived
from the gearing + top speed (the car tops out at redline in top gear), then cross-checkable against
WheelRotSpeed/Speed in real telemetry.

    python scripts/sim/wot_sim.py                 # Sesto Elemento (ordinal 1392) vs the game's own numbers
    python scripts/sim/wot_sim.py --ordinal 1392
"""
import argparse
import math
import os
import sqlite3
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GAMEDB = r"C:\Users\mondr\Downloads\forza raw data files\FH6_Database.sqlite"

G = 9.80665
MPH = 2.2369362921  # m/s -> mph
QMILE_M = 402.336   # quarter mile in metres

# ---- GLOBAL constants ------------------------------------------------------------------------------
# PROVISIONAL: fitted to the Sesto Elemento's Sim* oracle (2026-09-18) as the first calibration point.
# These are meant to be GLOBAL (one set for the whole fleet), so the next step is to re-fit them across
# many cars at once and confirm they hold; GRIP_MULT in particular is high here because Traction_Road
# under-states launch grip vs the compound's friction-curve peak (a fleet fit may replace it with the
# friction curve directly). Run with --fit to re-fit for any one car.
DRIVE_EFF   = 0.87     # driveline efficiency (emergent in-game; fitted). AWD here.
DRAG_UNIT   = 0.0029   # F_drag = DRAG_UNIT * BodyAeroLongitudinalDrag * GameDragScale * v^2  (internal-unit -> N)
ROLL_CRR    = 0.013    # rolling-resistance coefficient
ROT_INERTIA = 0.05     # rotating-mass fraction added to inertial mass (lumped; refine per-gear from MomentInertia)
GRIP_MULT   = 1.84     # Traction_Road -> usable longitudinal mu multiplier (launch traction cap)
LAUNCH_RPM_FRAC = 1.0  # launch clamps engine to the peak-torque rpm until the real rpm passes it


def q1(cx, sql, args=()):
    r = cx.execute(sql, args).fetchone()
    return dict(r) if r else None


def load_car(ordinal):
    """Pull every physics input for one car from the game DB + our decode."""
    gx = sqlite3.connect("file:%s?mode=ro" % GAMEDB.replace("\\", "/"), uri=True)
    gx.row_factory = sqlite3.Row
    fx = sqlite3.connect("file:%s?mode=ro" % os.path.join(REPO, "data", "fh6.db").replace("\\", "/"), uri=True)
    fx.row_factory = sqlite3.Row

    car = q1(fx, "SELECT * FROM ref_car WHERE ordinal=?", (ordinal,))
    if not car:
        sys.exit("no ref_car for ordinal %d" % ordinal)
    dc = q1(gx, "SELECT * FROM Data_Car WHERE Id=?", (ordinal,))
    if not dc:
        sys.exit("no Data_Car for ordinal %d" % ordinal)

    # stock camshaft = lowest-Id camshaft for the engine (base part), its full-throttle torque curve
    eng = car["stock_engine_id"]
    cam = q1(gx, "SELECT * FROM List_UpgradeEngineCamshaft WHERE EngineID=? ORDER BY Id LIMIT 1", (eng,))
    tc = q1(gx, "SELECT * FROM List_TorqueCurve WHERE TorqueCurveID=?", (cam["TorqueCurveFullThrottleID"],))
    scale = tc["TorqueScale"]
    n = int(tc["NumTorqueValues"])
    # curve sampled uniformly at 100 rpm from 0; value is peak-normalised -> Nm = v*scale
    curve = [(tc["v%d" % i] or 0.0) * scale for i in range(n)]   # index i == i*100 rpm
    redline = cam["RedlineRPM"]

    # stock transmission = lowest-Id transmission for the drivetrain (base 6-speed here)
    tr = q1(gx, "SELECT * FROM List_UpgradeDrivetrainTransmission WHERE DrivetrainID=? ORDER BY Id LIMIT 1",
            (car["stock_drivetrain_id"],))
    fd = tr["FinalDriveRatio"]
    gears = [tr["GearRatio%d" % i] for i in range(1, 12)
             if ("GearRatio%d" % i) in tr and tr["GearRatio%d" % i] not in (None, -1.0)]
    shift_t = tr["GearShiftTime"]

    mass = dc["CurbWeight"] * 100.0          # kg/100 -> kg
    return {
        "name": car["display_name"], "ordinal": ordinal, "drivetype": car["drivetype"],
        "mass": mass, "weight_dist": dc["WeightDistribution"],
        "curve": curve, "torque_scale": scale, "redline": redline,
        "game_torque_scale": dc["GameTorqueScale"],
        "gears": gears, "final_drive": fd, "shift_t": shift_t,
        "drag": dc["BodyAeroLongitudinalDrag"], "game_drag_scale": dc["GameDragScale"],
        "df_front": dc["BodyAeroForwardDownforceFront"], "df_rear": dc["BodyAeroForwardDownforceRear"],
        "traction": dc["Traction_Road"],
        "rear_tire_mm": car["rear_tire_mm"], "rear_rim_in": car["rear_rim_in"],
        # the game's OWN physics outputs = our oracle
        "sim_top_ms": dc["SimTopSpeed"], "sim_qmile_s": dc["SimTimeQuarterMile"],
        "sim_qmile_trap_ms": dc["SimSpeedQuarterMile"],
        "sim_0_60_s": dc["SimTimeTo60MPH"], "sim_0_100_s": dc["SimTimeTo100MPH"],
    }


def torque_at(curve, rpm):
    """Linear-interpolated engine torque (Nm) at an rpm; 0 below 0 or above the table."""
    if rpm <= 0:
        return curve[0]
    f = rpm / 100.0
    i = int(f)
    if i >= len(curve) - 1:
        return curve[-1]
    return curve[i] + (curve[i + 1] - curve[i]) * (f - i)


def rolling_radius_from_topspeed(car):
    """The car tops out at redline in top gear, so r = v_top * (top_gear*FD) / redline_radps.
    This uses ONE oracle number (SimTopSpeed) to pin r, then everything else is validated."""
    top_ratio = car["gears"][-1] * car["final_drive"]
    redline_radps = car["redline"] * 2 * math.pi / 60.0
    return car["sim_top_ms"] * top_ratio / redline_radps


def simulate(car, r_tire=None, dt=0.001, tmax=60.0, drag_unit=None, drive_eff=None, grip_mult=None):
    drag_unit = DRAG_UNIT if drag_unit is None else drag_unit
    drive_eff = DRIVE_EFF if drive_eff is None else drive_eff
    grip_mult = GRIP_MULT if grip_mult is None else grip_mult
    m = car["mass"]
    gs, fd, gts, ts = car["gears"], car["final_drive"], car["game_torque_scale"], car["torque_scale"]
    curve, redline = car["curve"], car["redline"]
    r = r_tire if r_tire else rolling_radius_from_topspeed(car)
    awd = (car["drivetype"] or "").upper() == "AWD"
    rwd = (car["drivetype"] or "").upper() == "RWD"
    # normal load fraction on the driven axle for the traction cap
    if awd:
        drive_frac = 1.0
    elif rwd:
        drive_frac = 1.0 - car["weight_dist"]
    else:
        drive_frac = car["weight_dist"]
    peak_torque_rpm = max(range(len(curve)), key=lambda i: curve[i]) * 100

    def rpm_of(v, g):
        return (v / r) * gs[g] * fd * 60.0 / (2 * math.pi)

    def engine_force(v, g):
        rpm = rpm_of(v, g)
        rpm = max(rpm, peak_torque_rpm * LAUNCH_RPM_FRAC if v < 3 else rpm)  # launch clamp
        if rpm > redline:
            return 0.0, rpm
        tq = torque_at(curve, min(rpm, redline)) * ts_scale
        return tq * gs[g] * fd * drive_eff / r, rpm

    ts_scale = gts  # GameTorqueScale multiplies the whole curve
    v = 0.0
    x = 0.0
    t = 0.0
    g = 0
    shifting = 0.0
    out = {"t_60": None, "t_100": None, "t_qmile": None, "v_qmile": None, "v_top": 0.0, "trace": []}
    v60, v100 = 60 / MPH, 100 / MPH
    last_v = 0.0
    steady = 0
    next_sample = 0.0
    while t < tmax:
        # downforce (N) scales with v^2 like drag; adds vertical load for the traction cap
        df = (car["df_front"] + car["df_rear"]) * car["game_drag_scale"] * drag_unit * v * v
        n_axle = (m * G + df) * drive_frac
        mu = car["traction"] * grip_mult
        f_traction = mu * n_axle

        if shifting > 0:
            f_drive = 0.0
            shifting -= dt
        else:
            f_eng, rpm = engine_force(v, g)
            if rpm >= redline and g < len(gs) - 1:      # upshift
                g += 1
                shifting = car["shift_t"]
                f_eng = 0.0
            f_drive = min(f_eng, f_traction)

        f_drag = drag_unit * car["drag"] * car["game_drag_scale"] * v * v
        f_roll = ROLL_CRR * m * G if v > 0.1 else 0.0
        m_eff = m * (1 + ROT_INERTIA)
        a = (f_drive - f_drag - f_roll) / m_eff

        v = max(0.0, v + a * dt)
        x += v * dt
        t += dt
        if out["t_60"] is None and v >= v60:
            out["t_60"] = t
        if out["t_100"] is None and v >= v100:
            out["t_100"] = t
        if out["t_qmile"] is None and x >= QMILE_M:
            out["t_qmile"] = t
            out["v_qmile"] = v
        if v > out["v_top"]:
            out["v_top"] = v
        if t >= next_sample:                                  # WOT curve sample: t, mph, gear, rpm
            out["trace"].append((t, v * MPH, g + 1, rpm_of(v, g)))
            next_sample += 0.5
        # terminal: acceleration negligible in top gear
        if g == len(gs) - 1 and abs(v - last_v) < 1e-4:
            steady += 1
            if steady > 200:
                break
        else:
            steady = 0
        last_v = v
    out["r_tire"] = r
    return out


def fmt(v, u):
    return "—" if v is None else ("%.2f %s" % (v, u))


def _err(car, s):
    """Combined %-error of a sim against the oracle on the accel metrics (top speed is r-derived)."""
    e = 0.0
    for got, want in ((s["t_60"], car["sim_0_60_s"]), (s["t_100"], car["sim_0_100_s"]),
                      (s["t_qmile"], car["sim_qmile_s"]),
                      ((s["v_qmile"] or 0), car["sim_qmile_trap_ms"])):
        if got and want:
            e += ((got - want) / want) ** 2
    return e


def fit_globals(car, r):
    """Grid-search the three GLOBAL constants (grip, drive-eff, drag-unit) to the oracle. Coarse then fine."""
    best = None
    grid = [(gm, de, du)
            for gm in [1.0 + 0.1 * i for i in range(9)]        # 1.0 .. 1.8
            for de in [0.76 + 0.03 * i for i in range(7)]      # 0.76 .. 0.94
            for du in [0.0016 + 0.0003 * i for i in range(8)]]  # 0.0016 .. 0.0037
    for gm, de, du in grid:
        s = simulate(car, r_tire=r, dt=0.004, tmax=18, grip_mult=gm, drive_eff=de, drag_unit=du)
        e = _err(car, s)
        if best is None or e < best[0]:
            best = (e, gm, de, du)
    # refine around the coarse winner
    _, gm0, de0, du0 = best
    for gm in [gm0 + 0.02 * d for d in (-2, -1, 0, 1, 2)]:
        for de in [de0 + 0.01 * d for d in (-2, -1, 0, 1, 2)]:
            for du in [du0 + 0.0001 * d for d in (-2, -1, 0, 1, 2)]:
                s = simulate(car, r_tire=r, dt=0.003, tmax=18, grip_mult=gm, drive_eff=de, drag_unit=du)
                e = _err(car, s)
                if e < best[0]:
                    best = (e, gm, de, du)
    return best[1], best[2], best[3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ordinal", type=int, default=1392)
    ap.add_argument("--fit", action="store_true", help="fit the global constants to this car's oracle")
    ap.add_argument("--trace", action="store_true", help="print the WOT speed curve (time, mph, gear)")
    a = ap.parse_args()
    car = load_car(a.ordinal)
    r = rolling_radius_from_topspeed(car)
    gm, de, du = GRIP_MULT, DRIVE_EFF, DRAG_UNIT
    if a.fit:
        gm, de, du = fit_globals(car, r)
    sim = simulate(car, r_tire=r, grip_mult=gm, drive_eff=de, drag_unit=du)

    print("== %s (ordinal %d, %s) ==" % (car["name"], car["ordinal"], car["drivetype"]))
    print("   mass %.0f kg · %d gears %s · FD %.2f · redline %.0f · peak %.0f Nm · GTS %.2f · drag %.1f"
          % (car["mass"], len(car["gears"]), [round(x, 2) for x in car["gears"]], car["final_drive"],
             car["redline"], car["torque_scale"], car["game_torque_scale"], car["drag"]))
    print("   derived rolling radius: %.4f m" % r)
    print("   constants%s: grip x%.2f (mu=%.2f) · drive-eff %.2f · drag-unit %.5f · Crr %.3f · rot %.2f"
          % (" [FITTED]" if a.fit else "", gm, car["traction"] * gm, de, du, ROLL_CRR, ROT_INERTIA))
    print()
    rows = [
        ("top speed",   sim["v_top"] * MPH,           car["sim_top_ms"] * MPH,        "mph"),
        ("0-60 mph",    sim["t_60"],                  car["sim_0_60_s"],              "s"),
        ("0-100 mph",   sim["t_100"],                 car["sim_0_100_s"],             "s"),
        ("1/4 mile",    sim["t_qmile"],               car["sim_qmile_s"],             "s"),
        ("1/4 trap",    (sim["v_qmile"] or 0) * MPH,  car["sim_qmile_trap_ms"] * MPH, "mph"),
    ]
    print("   %-11s %12s %12s %9s" % ("metric", "SIM", "GAME(oracle)", "err"))
    for name, s, o, u in rows:
        err = "" if (s is None or not o) else ("%+.1f%%" % ((s - o) / o * 100))
        print("   %-11s %12s %12s %9s" % (name, fmt(s, u), fmt(o, u), err))
    if a.trace:
        print("\n   WOT curve (0.5 s):")
        print("    t(s)   mph  gear   rpm")
        last_g = None
        for t, mph, g, rpm in sim["trace"]:
            mark = "  << upshift" if last_g is not None and g != last_g else ""
            print("   %5.1f %5.0f    g%d %6.0f%s" % (t, mph, g, rpm, mark))
            last_g = g


if __name__ == "__main__":
    main()
