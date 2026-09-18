#!/usr/bin/env python3
"""deterministic.py -- the faults a single lap can prove: gearing, brake lock, bottoming.

WHY THESE THREE ARE A CLASS OF THEIR OWN. Understeer is a tendency: one pass showing it proves
nothing, because the driver varies too, so it has to be argued out of a sample. These three are not
tendencies. The suspension was on its stop or it was not. Top gear was engaged on this course or it
never was. The wheels turned slower than the road at full pedal or they did not. The detector reads
a physical state, so ONE occurrence is the occurrence, and confidence.py lets them speak at n=1
(see its DETERMINISTIC class). They still report a RATE, because bottoming once over one kerb and
bottoming every lap call for differently sized fixes -- the class decides whether a fault may speak,
not how loudly.

WHY THE RAW CAPTURES AND NOT lap_point. lap_point carries 13 columns and none of them are gear, rpm
or wheel speed; pedals only arrived at schema 6 and were never backfilled. The raw captures carry
all 99 columns and have done since the first file on 2026-08-28, so every detector here runs over
the whole history rather than only over recent laps.

THE LAP BOUNDARIES ARE NOT RE-DERIVED HERE. Lap identity is canon and it lives in analyze_session
and lap_store -- rewinds, coverage, void, the official flag. This slices capture rows by lap.t0 and
lap.lap_s, which are on the same clock as (t_mono - first t_mono). Re-deriving laps from LapNumber
would quietly disagree with the canon on exactly the rewound laps the canon exists to settle.

TWO GAME FIELDS THAT CANNOT BE TRUSTED, AND WHAT IS USED INSTEAD.

  EngineMaxRpm is not the redline. Measured on fh6_20260911_154409: the field reads 7999.995 on the
  first on-row and 9999.995 elsewhere in the same session -- it moves because the session contains
  more than one car -- while actual WOT rpm reaches 9285. Gating "percent of redline" on it would
  compare a car against another car's ceiling. So the redline is OBSERVED per car: the high quantile
  of WOT rpm in the low gears, which are the gears that actually reach the limiter. EngineMaxRpm is
  kept only as a sanity cross-check and reported when it disagrees.

  SlipRatio is not a slip ratio in the [-1, 0] sense. Under full brake its per-wheel minimum reaches
  -14.4, which no physical slip ratio does, and its median sits at -0.86 -- close enough to "locked"
  that a naive gate would call almost every braking sample a lock. So lock is measured instead from
  WHEEL SPEED against ROAD SPEED, which is unambiguous: WheelRotSpeed x radius vs Speed.

  The radius is calibrated per car from the car's own coasting samples -- no brake, no throttle,
  straight, above 30 mph, where the wheel must be rolling free so radius = Speed / WheelRotSpeed.
  Measured on that session: FL 0.2570 m, FR 0.2566, RL 0.2543, RR 0.2539, inter-quartile spread
  under 6 mm. Self-calibrating beats reading a tyre size from the car table, because the build's
  wheels are not the car table's wheels.

GEARING IS JUDGED AGAINST THE COURSE, NEVER AGAINST IDENTITY. This asks one question only: does the
ladder fit this course. It never asks the driver for a top-speed pull or a WOT sweep -- that is a
standing hard rule, gears are a verified band from disk and identity never needs the gearbox. Every
figure here comes from laps already driven.

THRESHOLDS, STATED SO THEY CAN BE ARGUED WITH.
"""
import argparse
import csv
import gzip
import json
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "db"))
sys.path.insert(0, HERE)

import confidence as C                                   # noqa: E402
import fh6db                                             # noqa: E402

FULL_PEDAL = 230          # of 255. The same cut analyze_session uses for WOT (Accel > 230), kept identical
                          # so "full throttle" and "full brake" mean the same fraction of travel
LOCK_RATIO = 0.85         # wheel doing under 85% of road speed is past the peak of any mu-slip curve.
                          # This is where an EXCURSION starts being counted -- it is NOT the fault line
LOCK_FAULT_RATIO = 0.70   # ... the fault line. Measured over 201 excursions in one session: the largest
                          # single group (67, a third of them) is 3-5 samples at 0.70-0.85, i.e. brief and
                          # shallow, which is a tyre working near peak slip under hard braking and costs
                          # nothing. The distribution is a continuum, not two clusters, so the split has to
                          # be drawn on what a lock COSTS: past 30% slip the tyre has given up steering
LOCK_FAULT_S = 0.25       # ... or shallower than that but held this long, which costs steering just the same.
                          # A deep-and-brief excursion and a shallow-and-long one are both faults; only
                          # shallow-and-brief is normal braking
LOCK_RUN = 3              # consecutive samples before a lock counts, matching import_diagnosis.GRIP_RUN.
                          # One sample is a bump or a kerb edge, not a locked wheel
LOCK_MIN_MPH = 25.0       # below this, WheelRotSpeed/Speed is numerically unstable and the ratio blows up
BOTTOM_GATE = 0.98        # normalised suspension travel at the stop. NOT an independent judgement: it is
                          # analyze_session.BOTTOM_GATE, where the max-NormSusp population cliff and the
                          # |AccelY| step both sit. Restated (as import_diagnosis does) rather than imported,
                          # because importing a 3,500-line analyzer for one float costs more than it saves --
                          # tests/test_deterministic.py asserts the three copies still agree
BOTTOM_MIN_MPH = 40.0     # analyze_session's own advice gate: bottoming below this is a kerb, not ride height
TOP_GEAR_REVS = 0.90      # top gear engaged but never taken past this fraction of the observed redline means
                          # the ladder is taller than the course can use
LIMITER = 0.98            # at or above this fraction of the observed redline is on the limiter
LIMITER_S = 0.5           # ... and this long in top gear means the ladder is too short for the course
REDLINE_Q = 0.995         # quantile of WOT rpm taken as the observed redline, so one spike cannot set it
MIN_COAST = 40            # coasting samples needed before a calibrated radius is trusted


def fnum(r, k):
    v = r.get(k)
    if v in (None, "", "None"):
        return 0.0
    try:
        return float(v)
    except ValueError:
        return 0.0


def load_capture(path):
    """On-rows of one capture, as floats, with `t` on lap.t0's clock (t_mono minus the first t_mono)."""
    op = gzip.open if path.endswith(".gz") else open
    rows, t0 = [], None
    with op(path, "rt", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            if t0 is None:
                t0 = fnum(r, "t_mono")
            if r.get("IsRaceOn") != "1":
                continue
            r["t"] = fnum(r, "t_mono") - t0
            rows.append(r)
    return rows


def capture_path(session_id, captures_dir):
    for ext in (".csv", ".csv.gz"):
        p = os.path.join(captures_dir, session_id + ext)
        if os.path.exists(p):
            return p
    return None


# ---------------------------------------------------------------------------
# calibration: what this car's redline and wheel radii actually are
# ---------------------------------------------------------------------------

def observed_redline(rows):
    """The rpm ceiling this car actually reaches at WOT, and whether EngineMaxRpm agrees.

    Taken from the LOW gears. A tall gear on a short course never reaches the limiter, so including
    it would drag the ceiling down and then flag the same tall gear as under-revved -- the detector
    would be reading its own blind spot back to itself as a fault.
    """
    low = [fnum(r, "CurrentEngineRpm") for r in rows
           if fnum(r, "Accel") > FULL_PEDAL and 1 <= int(fnum(r, "Gear")) <= 3
           and fnum(r, "CurrentEngineRpm") > 0]
    if len(low) < 50:
        low = [fnum(r, "CurrentEngineRpm") for r in rows if fnum(r, "Accel") > FULL_PEDAL]
    if not low:
        return None, None
    low.sort()
    obs = low[min(len(low) - 1, int(REDLINE_Q * len(low)))]
    declared = max((fnum(r, "EngineMaxRpm") for r in rows), default=0.0) or None
    return obs, declared


def wheel_radii(rows):
    """{wheel: metres} from this car's own coasting samples. See the module docstring."""
    out = {}
    for w in ("FL", "FR", "RL", "RR"):
        rad = []
        for r in rows:
            if (fnum(r, "Brake") < 5 and fnum(r, "Accel") < 5 and fnum(r, "Speed") > 13.0
                    and abs(fnum(r, "WheelRotSpeed" + w)) > 1.0 and abs(fnum(r, "Steer")) < 20):
                rad.append(fnum(r, "Speed") / fnum(r, "WheelRotSpeed" + w))
        if len(rad) >= MIN_COAST:
            out[w] = st.median(rad)
    return out


# ---------------------------------------------------------------------------
# the three detectors. each returns a list of dicts, or [] when it has nothing to say
# ---------------------------------------------------------------------------

def detect_gearing(rows, redline, built_gears=None):
    """Does the ladder fit this course? Reads gear and rpm on laps already driven."""
    if not redline:
        return []
    gears = [int(fnum(r, "Gear")) for r in rows]
    used = sorted({g for g in gears if 1 <= g <= 10})
    if not used:
        return []
    top_used = max(used)
    top = built_gears if (built_gears and 1 <= built_gears <= 10) else top_used
    out = []

    if top_used < top:
        out.append({
            "fault": "gear-never-reached", "severity": min(1.0, (top - top_used) / 3.0),
            "detail": "gear %d never engaged (the build has %d); the ladder is taller than this "
                      "course can use" % (top, top),
            "fix": "shorten the final drive (raise the ratio) until top gear comes in before the "
                   "fastest point of the lap",
            "measure": {"top_gear_built": top, "top_gear_used": top_used},
        })
        return out

    in_top = [r for r in rows if int(fnum(r, "Gear")) == top]
    if not in_top:
        return out
    peak = max(fnum(r, "CurrentEngineRpm") for r in in_top)
    frac = peak / redline

    lim_s, prev = 0.0, None
    for r in in_top:
        if fnum(r, "CurrentEngineRpm") >= LIMITER * redline:
            if prev is not None:
                lim_s += max(0.0, min(0.2, r["t"] - prev))
        prev = r["t"]

    if lim_s >= LIMITER_S:
        out.append({
            "fault": "gear-limiter-bound", "severity": min(1.0, lim_s / 3.0),
            "detail": "%.1f s on the limiter in top gear (%.0f of %.0f rpm); the ladder runs out "
                      "before the course does" % (lim_s, peak, redline),
            "fix": "lengthen the final drive (lower the ratio) so top gear still pulls at the "
                   "fastest point",
            "measure": {"limiter_s": round(lim_s, 2), "peak_rpm": round(peak), "redline": round(redline)},
        })
    elif frac < TOP_GEAR_REVS:
        out.append({
            "fault": "gear-under-revved", "severity": min(1.0, (TOP_GEAR_REVS - frac) / 0.3),
            "detail": "top gear reached only %.0f%% of the %.0f rpm redline (peak %.0f); the gear "
                      "is carried but never used" % (frac * 100, redline, peak),
            "fix": "shorten the final drive (raise the ratio) so top gear reaches the power band, "
                   "or accept it as a cruising gear this course does not need",
            "measure": {"peak_rpm": round(peak), "redline": round(redline), "frac": round(frac, 3)},
        })
    return out


def detect_brake_lock(rows, radii):
    """Wheels turning slower than the road at full pedal. Physical, per axle."""
    if not radii:
        return []
    runs, cur = [], None
    for r in rows:
        v = fnum(r, "Speed")
        if fnum(r, "Brake") <= FULL_PEDAL or v * 2.23694 < LOCK_MIN_MPH:
            cur = None
            continue
        locked = {}
        for w, rad in radii.items():
            ratio = (fnum(r, "WheelRotSpeed" + w) * rad) / v if v > 0.1 else 1.0
            if ratio < LOCK_RATIO:
                locked[w] = ratio
        if not locked:
            cur = None
            continue
        if cur is None:
            cur = {"n": 0, "t0": r["t"], "t1": r["t"], "wheels": {}, "mph": v * 2.23694,
                   "x": fnum(r, "PosX"), "z": fnum(r, "PosZ")}
            runs.append(cur)
        cur["n"] += 1
        cur["t1"] = r["t"]
        for w, ratio in locked.items():
            cur["wheels"][w] = min(cur["wheels"].get(w, 1.0), ratio)

    out, shallow = [], 0
    for run in runs:
        if run["n"] < LOCK_RUN:
            continue
        ws = run["wheels"]
        dur = run["t1"] - run["t0"]
        # Shallow AND brief is hard braking, not a lock. Counted, never hidden, but not a fault.
        if min(ws.values()) > LOCK_FAULT_RATIO and dur < LOCK_FAULT_S:
            shallow += 1
            continue
        front = [ws[w] for w in ("FL", "FR") if w in ws]
        rear = [ws[w] for w in ("RL", "RR") if w in ws]
        end = "front" if front and not rear else "rear" if rear and not front else "all four"
        worst = min(ws.values())
        out.append({
            "fault": "brake-lock-" + end.replace(" ", "-"),
            "severity": min(1.0, (LOCK_RATIO - worst) / 0.5),
            "t": round(run["t0"], 2), "x": run.get("x"), "z": run.get("z"),
            "detail": "%s locked at full pedal, %d samples over %.2f s from %.0f mph; worst wheel "
                      "turning at %.0f%% of road speed" % (end, run["n"], dur,
                                                           run["mph"], worst * 100),
            "fix": ("brake pressure down a step" if end == "all four" else
                    "brake pressure down, and balance %s" % ("rearward" if end == "front" else "forward")),
            "measure": {"end": end, "worst_ratio": round(worst, 3), "samples": run["n"],
                        "held_s": round(dur, 3), "entry_mph": round(run["mph"], 1)},
        })
    # Attached after the loop, not inside it: mid-loop it would be a running count, so an early
    # incident would under-report and only the last one would be right.
    for f in out:
        f["shallow_excursions"] = shallow
    return out


def detect_bottoming(rows):
    """Suspension on its stop at speed. The gate is analyze_session's, not a new judgement."""
    out, last = [], {}
    for r in rows:
        mph = fnum(r, "Speed") * 2.23694
        if mph < BOTTOM_MIN_MPH:
            continue
        for w in ("FL", "FR", "RL", "RR"):
            ns = fnum(r, "NormSusp" + w)
            if ns < BOTTOM_GATE:
                continue
            if w in last and r["t"] - last[w] < 0.6:      # one incident, not one per sample
                continue
            last[w] = r["t"]
            out.append({
                "fault": "bottoming", "severity": min(1.0, (ns - BOTTOM_GATE) / 0.02 * 0.5 + 0.5),
                "t": round(r["t"], 2), "x": fnum(r, "PosX"), "z": fnum(r, "PosZ"),
                "detail": "%s suspension on the stop (travel %.3f) at %.0f mph" % (w, ns, mph),
                "fix": "%s ride height up a notch; if that costs too much PI, bump stiffness up first"
                       % ("front" if w[0] == "F" else "rear"),
                "measure": {"wheel": w, "travel": round(ns, 4), "mph": round(mph, 1)},
            })
    return out


def detect_lap(rows, redline, radii, built_gears=None):
    return (detect_gearing(rows, redline, built_gears)
            + detect_brake_lock(rows, radii)
            + detect_bottoming(rows))


# ---------------------------------------------------------------------------
# CLI: run over a session's canonical laps and gate the result through confidence.py
# ---------------------------------------------------------------------------

def run_session(cx, session_id, captures_dir, route=None, verbose=False):
    path = capture_path(session_id, captures_dir)
    if not path:
        sys.exit("no capture for %s under %s" % (session_id, captures_dir))
    rows = load_capture(path)
    if not rows:
        sys.exit("%s has no on-rows" % os.path.basename(path))

    q = """SELECT lap_id, t0, lap_s, cid, route_key, hw_hash, tune_hash, coverage,
                  coalesce(void,0) void FROM lap WHERE session_id=?"""
    args = [session_id]
    if route:
        q += " AND route_key=?"
        args.append(route)
    laps = cx.execute(q + " ORDER BY t0", args).fetchall()
    laps = [l for l in laps if not l["void"]]
    if not laps:
        sys.exit("no clean laps for %s%s" % (session_id, (" on " + route) if route else ""))

    gear_count = {}
    for r in cx.execute("SELECT tune_hash, gear_count FROM tune_container WHERE gear_count IS NOT NULL"):
        gear_count.setdefault(r["tune_hash"], r["gear_count"])

    # Calibrate per car, not per session: a session can hold several cars and each has its own
    # redline and its own wheels.
    by_car = {}
    for r in rows:
        by_car.setdefault(r.get("CarOrdinal"), []).append(r)
    cal = {}
    for ordinal, rs in by_car.items():
        obs, declared = observed_redline(rs)
        cal[ordinal] = {"redline": obs, "declared": declared, "radii": wheel_radii(rs)}

    print("%s -- %d on-rows, %d clean laps" % (os.path.basename(path), len(rows), len(laps)))
    for ordinal, c in cal.items():
        if c["redline"]:
            note = ""
            if c["declared"] and abs(c["declared"] - c["redline"]) > 0.08 * c["redline"]:
                note = "  (EngineMaxRpm says %.0f -- disagrees, observed wins)" % c["declared"]
            print("  car %s: redline %.0f rpm%s, radii %s" % (
                ordinal, c["redline"], note,
                ", ".join("%s %.3fm" % (w, v) for w, v in sorted(c["radii"].items())) or "none calibrated"))
    print()

    per_fault = {}
    for lp in laps:
        seg = [r for r in rows if lp["t0"] <= r["t"] <= lp["t0"] + (lp["lap_s"] or 0)]
        if not seg:
            continue
        ordinal = seg[len(seg) // 2].get("CarOrdinal")
        c = cal.get(ordinal) or {}
        fs = detect_lap(seg, c.get("redline"), c.get("radii") or {}, gear_count.get(lp["tune_hash"]))
        seen = {}
        for f in fs:
            k = f["fault"]
            seen[k] = max(seen.get(k, 0.0), f["severity"])
            per_fault.setdefault(k, {"laps": {}, "example": f})
        for k, sev in seen.items():
            per_fault[k]["laps"][lp["lap_id"]] = sev
        if verbose and fs:
            print("  lap %d (%.2fs): %s" % (lp["lap_id"], lp["lap_s"] or 0,
                                            ", ".join(sorted(seen))))

    n = len(laps)
    print("%d laps assessed. Deterministic faults gated through confidence.py:\n" % n)
    if not per_fault:
        print("  none fired.")
        return
    for k, v in sorted(per_fault.items(), key=lambda kv: -len(kv[1]["laps"])):
        sev = max(v["laps"].values())
        a = C.assess(len(v["laps"]), n, evidence_class="deterministic", severity=sev)
        tag = {C.REPORT: "REPORT  ", C.WATCHING: "WATCH   ",
               C.INSUFFICIENT: "MORE    ", C.NOT_RECURRENT: "RULEDOUT"}[a["verdict"]]
        print("  %s %-24s %2d/%-3d laps  %.0f-%.0f%%  peak severity %.2f"
              % (tag, k, a["k"], a["n"], a["lo"] * 100, a["hi"] * 100, sev))
        print("          %s" % v["example"]["detail"])
        if a["verdict"] == C.REPORT:
            print("          FIX: %s" % v["example"]["fix"])
        else:
            print("          (%s)" % a["why"])
        print()


def sidecar_path(session_id, db=None):
    """<repo>/data/sessions/<sid>.det.json -- beside the analyzer's own sidecars, deliberately.

    NOT derived from the database path. import_diagnosis reads this family from <repo>/data/sessions
    exactly as it reads the analyzer's .json and .tags.json, so deriving the writer's location from
    --db while the reader used the repo root would split the two apart the moment a rebuild passed a
    database elsewhere -- and the symptom would be silence, not an error: no sidecars found, no
    deterministic events, no complaint.
    """
    del db                                               # kept in the signature so callers read alike
    return os.path.join(ROOT, "data", "sessions", session_id + ".det.json")


def scan_session(cx, session_id, captures_dir, db=None):
    """Detect over one session's canonical laps and write its sidecar. Returns the finding count."""
    path = capture_path(session_id, captures_dir)
    if not path:
        return None
    rows = load_capture(path)
    if not rows:
        return None
    laps = cx.execute("""SELECT lap_id, t0, lap_s, cid, route_key, container, hw_hash, tune_hash
                         FROM lap WHERE session_id=? AND coalesce(void,0)=0
                         ORDER BY t0""", (session_id,)).fetchall()
    if not laps:
        return None
    gear_count = {r["tune_hash"]: r["gear_count"] for r in cx.execute(
        "SELECT tune_hash, gear_count FROM tune_container WHERE gear_count IS NOT NULL")}
    by_car, cal = {}, {}
    for r in rows:
        by_car.setdefault(r.get("CarOrdinal"), []).append(r)
    for ordinal, rs in by_car.items():
        obs, declared = observed_redline(rs)
        cal[ordinal] = {"redline": obs, "declared": declared, "radii": wheel_radii(rs)}

    out = []
    for lp in laps:
        seg = [r for r in rows if lp["t0"] <= r["t"] <= lp["t0"] + (lp["lap_s"] or 0)]
        if not seg:
            continue
        c = cal.get(seg[len(seg) // 2].get("CarOrdinal")) or {}
        for f in detect_lap(seg, c.get("redline"), c.get("radii") or {},
                            gear_count.get(lp["tune_hash"])):
            f["lap_id"] = lp["lap_id"]
            f["cid"] = lp["cid"]
            f["route_key"] = lp["route_key"]
            f["container"] = lp["container"]
            f["hw_hash"] = lp["hw_hash"]
            out.append(f)
    doc = {"session": session_id, "built_utc": fh6db.utcnow(),
           "capture": os.path.basename(path), "laps": len(laps), "findings": out,
           "calibration": {k: {"redline": v["redline"], "declared": v["declared"],
                               "radii": v["radii"]} for k, v in cal.items() if v.get("redline")}}
    sp = sidecar_path(session_id, db)
    os.makedirs(os.path.dirname(sp), exist_ok=True)
    tmp = sp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
    os.replace(tmp, sp)
    return len(out)


def scan_all(db=None, captures=None, force=False, verbose=False, ignore_run_id=None):
    """Every session with laps, skipping those whose sidecar is already newer than its capture.

    Incremental because it is not cheap: 441 captures at ~150k rows each. The stage sits in the
    rebuild cascade, so a full rescan on every session close would turn a seconds-long cascade into
    a half-hour one. After the first pass only the session just driven is rescanned.
    """
    cx = fh6db.connect(db, ro=True)
    # NEVER SCAN ACROSS A REBUILD. A sidecar is built from the lap rows for its session, and
    # import_consolidate repoints and deletes laps inside its run, so a scan that reads mid-rebuild
    # bakes a partial lap set into a sidecar that then looks finished -- the sidecar carries no sign
    # that it was built from half a table, and the next run skips it because its mtime is current.
    # Refusing costs a rerun; not refusing costs a wrong answer that never announces itself.
    # ignore_run_id is the CALLER'S OWN run. import_deterministic opens an import_run row before
    # it calls this, so without the exclusion the scanner refuses on the strength of the very run
    # that invoked it -- which is exactly what happened the first time this was run for real.
    r = cx.execute("""SELECT kind, started_utc FROM import_run
                      WHERE finished_utc IS NULL AND run_id IS NOT ?
                      ORDER BY run_id DESC LIMIT 1""", (ignore_run_id,)).fetchone()
    if r:
        raise RuntimeError("a '%s' import started %s has not finished -- rerun once the rebuild "
                           "settles" % (r["kind"], r["started_utc"]))
    cdir = os.path.abspath(captures or os.path.join(
        os.path.dirname(fh6db.db_path(db)), "..", "captures"))
    sids = [r["session_id"] for r in cx.execute(
        "SELECT DISTINCT session_id FROM lap WHERE session_id IS NOT NULL ORDER BY session_id")]
    done = skipped = missing = 0
    for sid in sids:
        cap = capture_path(sid, cdir)
        if not cap:
            missing += 1
            continue
        sp = sidecar_path(sid, db)
        if not force and os.path.exists(sp) and os.path.getmtime(sp) >= os.path.getmtime(cap):
            skipped += 1
            continue
        n = scan_session(cx, sid, cdir, db)
        if n is None:
            missing += 1
            continue
        done += 1
        if verbose:
            print("  %s: %d findings" % (sid, n))
    print("  scanned %d session(s), %d already current, %d without a usable capture"
          % (done, skipped, missing))
    return {"scanned": done, "current": skipped, "no_capture": missing}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--session", help="session id, e.g. fh6_20260911_154409")
    ap.add_argument("--route", help="limit to one route_key")
    ap.add_argument("--captures", default=None, help="captures dir (default <lab root>/captures)")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--scan", action="store_true",
                    help="write a .det.json sidecar for every session (incremental)")
    ap.add_argument("--force", action="store_true", help="with --scan, rescan even current sidecars")
    a = ap.parse_args()
    if a.scan:
        return scan_all(None, a.captures, a.force, a.verbose)
    if not a.session:
        sys.exit("--session is required unless --scan is given")
    cx = fh6db.connect(ro=True)
    cdir = a.captures or os.path.join(os.path.dirname(fh6db.db_path()), "..", "captures")
    run_session(cx, a.session, os.path.abspath(cdir), a.route, a.verbose)


if __name__ == "__main__":
    main()
