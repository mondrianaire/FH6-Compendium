#!/usr/bin/env python3
"""import_curves.py -- the two sampled curves the game ships and the lab never read.

    List_TorqueCurve        1,725 rows -> ref_torque_curve   (a real dyno for any build)
    List_TireFrictionCurve    738 rows -> ref_friction_curve (the model under every compound)

WHY THIS MATTERS. Until now an engine's output was known only where somebody had DRIVEN the car
and the telemetry had caught full throttle in a gear that held. This table is the game's own
answer, for every engine, at every camshaft level, whether or not the car exists in the garage.
The same for grip: ref_compound carried three peak-slip numbers per compound; this carries the
whole curve either side of the peak, which is what says how sharply a tyre lets go.

THE TWO SAMPLING RULES (established 2026-09-03; both exact, neither fitted)

  TORQUE.  Ownership is a bijection -- 1,706 camshaft parts + 19 electric motors = 1,725 curves,
  no id used twice, none orphaned. A curve belongs to a CAMSHAFT PART, not to an engine, which is
  what makes Race Cams change the dyno; the engine's own curve is the IsStock=1 row.
      rpm_i    = i * 100                       (TorqueCurveMaxRPM == 100*(N-1) on all 1,706)
      torque_i = v_i * TorqueScale  Nm         (v peaks at 1.0, so TorqueScale IS peak torque)
      hp       = Nm * rpm / 7120.54            (== lb-ft*rpm/5252)
  The final sample is NOT a dyno point: it is negative on 1,720 of 1,725 curves (-2.63 typical),
  the closed-throttle drag past the end of the table. It is stored as limiter_value and flagged
  limiter=1 in the view rather than being dropped where nobody can see it.

  The hp constant is not a convention picked here. Data_Car.SimPeakPower is watts/100, and on the
  naturally aspirated cars this arithmetic returns 150.0 / 300.0 / 375.0 hp exactly. And the
  project's boost rule survives contact: SimPeakTorque*100 == the stock curve's TorqueScale on
  313 of 314 NA cars, with the forced-induction ratio running 1.03..2.87.

  FRICTION.  Ownership is a bijection again -- 41 compounds x 9 channels = 369 multicurves = the
  whole of List_TireFrictionMultiCurve, x 2 curves each = 738, all distinct. So the chain
      List_TireCompound.FrictionMultiCurve<channel>ID
        -> List_TireFrictionMultiCurve.TireFrictionCurveID0/1
          -> List_TireFrictionCurve
  flattens onto the curve with nothing lost, and ref_friction_curve.compound_id joins straight to
  ref_compound.
      slip_i = i/(N-1) * MaxSlip               (N = 100; MaxSlip 49.5 deg lat, 1.1 ratio long)
      mu_i   = v_i * FrictionScale             (v peaks at 1.0, so FrictionScale IS peak mu)
  The two curves of a multicurve are the same channel at two LOADS -- 10.1972 kgf (100 N exactly)
  and 1000 kgf, blended by the tyre's normal load and clamped at 3500 kgf. That is the load
  sensitivity, and it is why one compound needs two curves.

  ref_compound's peaks are NOT derived from this table and do not contradict it: both come from
  List_TyreCurveDB, and this table is that row baked onto a 100-point grid (see the header block
  in db/schema.sql for the agreement figures). The authored peak is carried along on every row so
  the comparison never needs a second table.

Run:  python scripts/db/import_curves.py [--gamedb PATH] [--db PATH] [-v]
      python scripts/db/import_curves.py --dyno 733            # the helper: print an engine's dyno
      python scripts/db/import_curves.py --grip 13             # ... and a compound's friction
"""
import argparse
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

DEFAULT_GAMEDB = fh6db.GAMEDB_PATH

RPM_STEP = 100.0
HP_PER_NM_RPM = 7120.54          # hp = Nm * rpm / this  (== lb-ft*rpm/5252)
AUTHOR_SCALE = 49.5              # List_TyreCurveDB states every peak on this common scale

#: compound column -> (channel, surface). 41 x 9 = 369 = every row of List_TireFrictionMultiCurve.
CHANNELS = [
    ("FrictionMultiCurveLateralID", "lat", "asphalt", "Asph_LatSlipPeak"),
    ("FrictionMultiCurveLongitudinalAccelID", "accel", "asphalt", "Asph_LongSlipPeak"),
    ("FrictionMultiCurveLongitudinalBrakeID", "brake", "asphalt", "Asph_BrkSlipPeak"),
    ("FrictionMultiCurveLateralID_Offroad", "lat", "offroad", "Off_LatSlipPeak"),
    ("FrictionMultiCurveLongitudinalAccelID_Offroad", "accel", "offroad", "Off_LongSlipPeak"),
    ("FrictionMultiCurveLongitudinalBrakeID_Offroad", "brake", "offroad", "Off_BrkSlipPeak"),
    ("FrictionMultiCurveLateralID_Snow", "lat", "snow", "Snow_LatSlipPeak"),
    ("FrictionMultiCurveLongitudinalAccelID_Snow", "accel", "snow", "Snow_LongSlipPeak"),
    ("FrictionMultiCurveLongitudinalBrakeID_Snow", "brake", "snow", "Snow_BrkSlipPeak"),
]


def log(v, *a):
    if v:
        print(*a)


def open_gamedb(path):
    p = os.path.abspath(path)
    if not os.path.exists(p):
        raise SystemExit("game DB not found: %s" % p)
    gx = sqlite3.connect("file:%s?mode=ro" % p.replace("\\", "/"), uri=True)
    gx.row_factory = sqlite3.Row
    return gx


def samples_of(row, n, prefix="v"):
    """The first n v-columns of a curve row, as a list of floats."""
    return [float(row["%s%d" % (prefix, i)] or 0.0) for i in range(n)]


def ensure_tables(cx):
    """Create this stage's tables on a database that predates them.

    fh6db.ensure_schema only runs db/schema.sql on a database that has no schema_meta yet, so a
    table added to the schema after the first build would never appear. The schema file is
    entirely CREATE ... IF NOT EXISTS, so replaying it is safe and is the honest fix: one file
    stays the definition of every table.
    """
    if fh6db.has_table(cx, "ref_torque_curve") and fh6db.has_table(cx, "ref_friction_curve"):
        return False
    with open(fh6db.SCHEMA_PATH, "r", encoding="utf-8") as fh:
        cx.executescript(fh.read())
    cx.execute("PRAGMA foreign_keys=ON")
    return True


# ---------------------------------------------------------------------------
# torque
# ---------------------------------------------------------------------------


def torque_rows(gx, verbose=False):
    curves = {r["TorqueCurveID"]: r for r in gx.execute("SELECT * FROM List_TorqueCurve")}
    owner, n_owners = {}, 0
    for kind, sql in (("camshaft", "SELECT * FROM List_UpgradeEngineCamshaft"),
                      ("motor", "SELECT * FROM Data_Motor")):
        for r in gx.execute(sql):
            n_owners += 1
            owner[r["TorqueCurveFullThrottleID"]] = (kind, r)

    # The bijection is the whole reason a curve can be flattened onto its owner. Assert it
    # rather than assume it: if a patch ever shares one curve between two camshafts, this
    # importer must be rewritten, not left silently keeping the last writer.
    if len(owner) != n_owners:
        raise SystemExit("%d camshafts/motors share only %d torque curves -- the 1:1 ownership "
                         "this importer flattens on is gone" % (n_owners, len(owner)))
    missing = [c for c in curves if c not in owner]
    if missing:
        raise SystemExit("%d torque curves belong to nothing (e.g. %r)" % (len(missing), missing[:5]))

    rows = []
    for cid, c in curves.items():
        kind, o = owner[cid]
        n = int(c["NumTorqueValues"] or 0)
        v = samples_of(c, n)
        scale = float(c["TorqueScale"] or 0.0)
        dyno = v[:max(0, n - 1)]                     # the last sample is the limiter, not a point
        pt_nm = pt_rpm = pp_hp = pp_rpm = None
        if dyno:
            m = max(dyno)
            pt_nm, pt_rpm = m * scale, dyno.index(m) * RPM_STEP
            pp_hp, pp_rpm = 0.0, 0.0
            for i, x in enumerate(dyno):
                hp = x * scale * (i * RPM_STEP) / HP_PER_NM_RPM
                if hp > pp_hp:
                    pp_hp, pp_rpm = hp, i * RPM_STEP
        if kind == "camshaft":
            eng, mot, pid = o["EngineID"], None, o["Id"]
            lvl, stock = o["Level"], 1 if o["IsStock"] else 0
            redline, stall = o["RedlineRPM"], o["StallRPM"]
            if int(o["NumRPMEntriesArray"] or 0) != n:
                raise SystemExit("curve %d: camshaft says %s samples, curve says %d"
                                 % (cid, o["NumRPMEntriesArray"], n))
            if abs(float(o["TorqueCurveMaxRPM"] or 0) - RPM_STEP * (n - 1)) > 1e-6:
                raise SystemExit("curve %d: max rpm %s is not %g*(n-1)"
                                 % (cid, o["TorqueCurveMaxRPM"], RPM_STEP))
        else:
            eng, mot, pid = None, o["MotorID"], None
            lvl, stock = None, 1
            redline, stall = o["RedlineRPM"], None
        rows.append((cid, kind, eng, mot, pid, lvl, stock, n, RPM_STEP, RPM_STEP * (n - 1),
                     redline, stall, scale, c["ZeroThrottleTorqueScale"], v[-1] if v else None,
                     pt_nm, pt_rpm, pp_hp, pp_rpm,
                     json.dumps([round(x, 7) for x in v], separators=(",", ":"))))
    log(verbose, "   torque: %d curves (%d camshaft, %d motor)"
        % (len(rows), sum(1 for r in rows if r[1] == "camshaft"),
           sum(1 for r in rows if r[1] == "motor")))
    return rows


# ---------------------------------------------------------------------------
# friction
# ---------------------------------------------------------------------------


def friction_rows(gx, verbose=False):
    curves = {r["FrictionCurveID"]: r for r in gx.execute("SELECT * FROM List_TireFrictionCurve")}
    multi = {r["FrictionMultiCurveID"]: r for r in gx.execute("SELECT * FROM List_TireFrictionMultiCurve")}
    authored = {r["TireCompoundID"]: r for r in gx.execute("SELECT * FROM List_TyreCurveDB")}

    rows, seen = [], {}
    for comp in gx.execute("SELECT * FROM List_TireCompound"):
        cmpid = comp["TireCompoundID"]
        auth = authored.get(cmpid)
        for col, channel, surface, peakcol in CHANNELS:
            mid = comp[col]
            m = multi.get(mid)
            if m is None:
                raise SystemExit("compound %d %s: multicurve %r missing" % (cmpid, col, mid))
            max_slip = float(m["MaxSlip"] or 0.0)
            unit = "deg" if max_slip > 10 else "ratio"
            for band in (0, 1):
                fid = m["TireFrictionCurveID%d" % band]
                f = curves.get(fid)
                if f is None:
                    raise SystemExit("multicurve %d band %d: curve %r missing" % (mid, band, fid))
                if fid in seen:
                    raise SystemExit("friction curve %d used twice: %r and %r"
                                     % (fid, seen[fid], (cmpid, channel, surface, band)))
                seen[fid] = (cmpid, channel, surface, band)
                n = int(f["NumCurveValues"] or 0)
                v = samples_of(f, n)
                peak_slip = (v.index(max(v)) / (n - 1.0) * max_slip) if n > 1 else None
                raw = auth["%s%d" % (peakcol, band)] if auth else None
                rows.append((fid, cmpid, mid, channel, surface, band,
                             m["MinLoadCurve"] if band == 0 else m["MaxLoadCurve"],
                             m["LoadClamp"], max_slip, unit, n, f["FrictionScale"], peak_slip,
                             (raw / AUTHOR_SCALE * max_slip) if raw is not None else None, raw,
                             json.dumps([round(x, 7) for x in v], separators=(",", ":"))))
    left = set(curves) - seen.keys()
    if left:
        raise SystemExit("%d friction curves reach no compound (e.g. %r)"
                         % (len(left), sorted(left)[:5]))
    log(verbose, "   friction: %d curves over %d compounds x %d channels"
        % (len(rows), len(set(r[1] for r in rows)), len(CHANNELS)))
    return rows


# ---------------------------------------------------------------------------
# the helper: read a curve back the way a consumer would
# ---------------------------------------------------------------------------


def dyno(cx, engine_id, level=None, stock_only=True):
    """[(rpm, torque_nm, torque_lbft, power_hp)] for one engine, from the view."""
    sql = ("SELECT rpm, torque_nm, torque_lbft, power_hp FROM v_torque_point "
           "WHERE engine_id=? AND limiter=0")
    args = [engine_id]
    if level is not None:
        sql += " AND level=?"
        args.append(level)
    elif stock_only:
        sql += " AND is_stock=1"
    return [tuple(r) for r in cx.execute(sql + " ORDER BY rpm", args)]


def grip(cx, compound_id, channel="lat", surface="asphalt", band=0):
    """[(slip, mu)] for one compound's friction curve, from the view."""
    return [tuple(r) for r in cx.execute(
        "SELECT slip, mu FROM v_friction_point WHERE compound_id=? AND channel=? AND surface=? "
        "AND load_band=? ORDER BY slip", (compound_id, channel, surface, band))]


def print_dyno(cx, engine_id):
    head = cx.execute("SELECT * FROM ref_torque_curve WHERE engine_id=? AND is_stock=1",
                      (engine_id,)).fetchone()
    if head is None:
        raise SystemExit("no stock torque curve for engine %s" % engine_id)
    pts = dyno(cx, engine_id)
    print("engine %d, curve %d: %d points, 0..%g rpm, redline %g, peak %.1f Nm @ %g, %.1f hp @ %g"
          % (engine_id, head["curve_id"], len(pts), head["max_rpm"], head["redline_rpm"],
             head["peak_torque_nm"], head["peak_torque_rpm"],
             head["peak_power_hp"], head["peak_power_rpm"]))
    for rpm, nm, lbft, hp in pts:
        if rpm and rpm % 1000 == 0:
            print("   %6.0f rpm  %7.1f Nm  %7.1f lb-ft  %7.1f hp" % (rpm, nm, lbft, hp))


def print_grip(cx, compound_id):
    for r in cx.execute("SELECT * FROM ref_friction_curve WHERE compound_id=? "
                        "ORDER BY surface, channel, load_band", (compound_id,)):
        print("  %-8s %-6s band %d @ %8.4f kgf  curve %4d  peak mu %.3f at %.3f %s "
              "(authored %.3f)" % (r["surface"], r["channel"], r["load_band"], r["load_kgf"],
                                   r["curve_id"], r["friction_scale"], r["peak_slip"],
                                   r["slip_unit"], r["authored_peak_slip"]))


# ---------------------------------------------------------------------------


def run(cx, gamedb, verbose=False):
    gx = open_gamedb(gamedb)
    try:
        trows = torque_rows(gx, verbose)
        frows = friction_rows(gx, verbose)
    finally:
        gx.close()
    with cx:
        n_t = fh6db.replace_all(cx, "ref_torque_curve", [
            "curve_id", "source", "engine_id", "motor_id", "part_id", "level", "is_stock",
            "n_samples", "rpm_step", "max_rpm", "redline_rpm", "stall_rpm", "torque_scale",
            "zero_throttle_scale", "limiter_value", "peak_torque_nm", "peak_torque_rpm",
            "peak_power_hp", "peak_power_rpm", "samples"], trows, chunk=500)
        n_f = fh6db.replace_all(cx, "ref_friction_curve", [
            "curve_id", "compound_id", "multicurve_id", "channel", "surface", "load_band",
            "load_kgf", "load_clamp_kgf", "max_slip", "slip_unit", "n_samples", "friction_scale",
            "peak_slip", "authored_peak_slip", "authored_peak_raw", "samples"], frows, chunk=500)
    return {"ref_torque_curve": n_t, "ref_friction_curve": n_f}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--gamedb", default=DEFAULT_GAMEDB)
    ap.add_argument("--dyno", type=int, default=None, help="print one engine's dyno and exit")
    ap.add_argument("--grip", type=int, default=None, help="print one compound's curves and exit")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    if a.dyno is not None or a.grip is not None:
        cx = fh6db.connect(a.db, ro=True)
        if a.dyno is not None:
            print_dyno(cx, a.dyno)
        if a.grip is not None:
            print_grip(cx, a.grip)
        return 0

    cx = fh6db.connect(a.db)
    ensure_tables(cx)
    rid = fh6db.run_begin(cx, "curves", os.path.basename(a.gamedb))
    try:
        counts = run(cx, a.gamedb, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1, json.dumps(counts))
    for k in sorted(counts):
        print("  %-20s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
