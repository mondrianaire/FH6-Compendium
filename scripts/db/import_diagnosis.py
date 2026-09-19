#!/usr/bin/env python3
"""import_diagnosis.py -- join the failure catalogue to the detectors, and place each on a turn.

Nothing here is new science. The symptom -> fix matrix has been in data/tuning-test-battery.json
since the v1 tuning tab, and the analyzer has been emitting the raw signals all along:

    bottoming   suspension travel at the stop, per wheel, with speed
    braking     front/rear grip deficit and which end locked
    crests      the g at a crest, so a negative one is air
    pulses      yaw peak and how long it took to decay
    lap_point   per-sample grip state: 0 calm, 1 front, 2 rear, 3 all four, 4 impact

What was missing was the join. This puts every occurrence on the turn it happened at, so the
question stops being "does this car understeer" and becomes "it pushes at T5 and T15, on 9 of
11 laps, and only since the spring change".

PLACEMENT. Grip symptoms come from lap samples, which already carry x/z, so they are placed in
space against the turn apexes. The analyzer's event lists carry a timestamp instead, so those are
placed by bracketing the time inside one of the session's own detected corners, then matching that
corner's apex to the nearest road turn. An event that falls in no corner is kept with a NULL turn:
"wanders at top speed" is a straight-line failure and hiding it would be a lie of omission.

SEVERITY is 0..1 and comparable only within one symptom. It is a ranking aid, not a physical unit.

Run:  python scripts/db/import_diagnosis.py [--db PATH] [-v]
"""
import argparse
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

DATA = os.path.join(ROOT, "data")

# Detector thresholds. Stated here rather than buried, because every one of them is a judgement
# and a reader deserves to argue with it.
BOTTOM_TRAVEL = 0.98      # on the stop: the max-NormSusp population cliff and the |AccelY| step both sit here (was 0.95, mid-distribution). Matches analyze_session.BOTTOM_GATE, so the severity scale and the evidence string derive from the real gate
GRIP_RUN = 3              # samples of one slip state in a row before it counts as a symptom
CREST_AIR_G = -0.35       # g at a crest below this means the car went light
PULSE_YAW = 28.0          # deg/s of yaw peak that counts as a wobble
PULSE_MPH = 110.0         # ... and only at speed does it mean "wanders at top speed"
BRAKE_DEFICIT = 0.30      # front/rear grip deficit under braking
BOTTOM_GAP_S  = 0.6       # bottoming rows for one wheel closer than this are one incident
PULSE_GAP_S   = 1.0       # ... same for yaw wobbles


def jload(p):
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:                                    # noqa: BLE001
        return None


def seed_symptoms(cx):
    """The v1 matrix, plus the ones our own detectors find that it never listed."""
    d = jload(os.path.join(DATA, "tuning-test-battery.json")) or {}
    rows = []
    DET = {
        "Understeer on entry (won't turn in)": "front-slip samples before the apex",
        "Understeer mid-corner (steady push)": "front-slip samples within a car length of the apex",
        "Understeer on exit (throttle push, AWD)": "front-slip samples after the apex on an AWD car",
        "Oversteer on entry (rear steps in on brake/lift)": "rear-slip samples before the apex",
        "Oversteer on exit (wheelspin slide)": "rear-slip samples after the apex",
        "Unstable under braking (tail wags)": "a braking event whose rear deficit exceeds the front, or that locked the rear",
        "Bouncy over rough surface": "suspension travel at the stop on a corner the analyzer called rough",
        "Floaty after crests, slow to settle": "a crest taken at negative g",
        "Wanders at top speed": "a yaw pulse above the threshold at speed, away from any turn",
        "Kerbs throw the car off line": "suspension bottoming coincident with an impact",
    }
    for r in (d.get("symptom_matrix") or []):
        s = r.get("symptom")
        if not s:
            continue
        rows.append((s, r.get("phase"), r.get("primary"), r.get("secondary"), r.get("tertiary"),
                     r.get("verify_test"), DET.get(s),
                     "data/tuning-test-battery.json symptom_matrix (v1 tuning tab)"))
    known = {r[0] for r in rows}
    # The deterministic detectors (scripts/telemetry/deterministic.py). None of these are in the v1
    # matrix, because v1 had no access to gear, rpm or wheel speed -- lap_point never carried them.
    # They read a physical state rather than estimate a tendency, which is what lets confidence.py
    # report them at n=1; see its DETERMINISTIC class.
    for sym, ph, p1, p2, p3, vt, det in DETERMINISTIC_SYMPTOMS:
        if sym not in known:
            rows.append((sym, ph, p1, p2, p3, vt, det,
                         "this project's own detector; scripts/telemetry/deterministic.py"))
            known.add(sym)
    # Bottoming is not in the v1 matrix and is the single easiest thing to fix, so it gets its
    # own row rather than being folded into "bouncy over rough surface".
    if "Bottoming out (suspension on the stop)" not in known:
        rows.append(("Bottoming out (suspension on the stop)", "any",
                     "front/rear ride height up", "bump stiffness up",
                     "springs stiffer", "bump-stop check",
                     "normalised suspension travel >= %.2f on any wheel" % BOTTOM_TRAVEL,
                     "this project's own detector; the v1 matrix does not list it"))
    fh6db.replace_all(cx, "ref_symptom", [
        "symptom", "phase", "primary_fix", "secondary_fix", "tertiary_fix", "verify_test",
        "detector", "source"], rows)
    return len(rows)


#: (symptom, phase, primary, secondary, tertiary, verify_test, detector) for the deterministic set.
#: The fault keys emitted by deterministic.py map onto these through DET_FAULT_SYMPTOM below.
DETERMINISTIC_SYMPTOMS = [
    ("Gearing too tall for the course (top gear never used)", "straight",
     "final drive shorter (raise the ratio)", "close the top ratios up",
     "accept it as a cruising gear this course does not need",
     "top gear engaged before the fastest point of the lap",
     "the build's top gear never engaged on a whole lap"),
    ("Gearing too tall for the course (top gear under-revved)", "straight",
     "final drive shorter (raise the ratio)", "close the top ratios up",
     "accept it as a cruising gear this course does not need",
     "top gear reaching the power band at the fastest point",
     "peak rpm in top gear under 90% of the car's observed redline"),
    ("Gearing too short for the course (limiter-bound in top gear)", "straight",
     "final drive longer (lower the ratio)", "lengthen the top ratio only",
     "taller final drive plus more downforce if it now spins",
     "top gear still pulling at the fastest point, off the limiter",
     "half a second or more at 98% of redline in top gear"),
    ("Brake lock at full pedal (front)", "braking",
     "brake pressure down a step", "brake balance rearward", "softer front bump",
     "full-pedal stop with the fronts still turning",
     "front wheel speed under 70% of road speed at full pedal, or under 85% held 0.25 s"),
    ("Brake lock at full pedal (rear)", "braking",
     "brake pressure down a step", "brake balance forward", "softer rear bump",
     "full-pedal stop with the rears still turning",
     "rear wheel speed under 70% of road speed at full pedal, or under 85% held 0.25 s"),
    ("Brake lock at full pedal (all four)", "braking",
     "brake pressure down a step", "softer bump both ends", "tyre compound up",
     "full-pedal stop with every wheel still turning",
     "every wheel under 70% of road speed at full pedal, or under 85% held 0.25 s"),
]

#: deterministic.py fault key -> ref_symptom. Bottoming is DELIBERATELY ABSENT: it already reaches
#: diag_event through the analyzer's own `bottoming` list above, on the same 0.98 gate, so importing
#: it a second time from the sidecar would double every bottoming count in the rollups. The sidecar
#: still carries it, and scripts/telemetry/deterministic.py reports it, as a cross-check on the path
#: that does the writing.
DET_FAULT_SYMPTOM = {
    "gear-never-reached": "Gearing too tall for the course (top gear never used)",
    "gear-under-revved": "Gearing too tall for the course (top gear under-revved)",
    "gear-limiter-bound": "Gearing too short for the course (limiter-bound in top gear)",
    "brake-lock-front": "Brake lock at full pedal (front)",
    "brake-lock-rear": "Brake lock at full pedal (rear)",
    "brake-lock-all-four": "Brake lock at full pedal (all four)",
}

UNDER_ENTRY = "Understeer on entry (won't turn in)"
UNDER_MID = "Understeer mid-corner (steady push)"
UNDER_EXIT = "Understeer on exit (throttle push, AWD)"
OVER_ENTRY = "Oversteer on entry (rear steps in on brake/lift)"
OVER_EXIT = "Oversteer on exit (wheelspin slide)"
BOTTOMING = "Bottoming out (suspension on the stop)"
ROUGH = "Bouncy over rough surface"
CRESTS = "Floaty after crests, slow to settle"
WANDER = "Wanders at top speed"
BRAKE = "Unstable under braking (tail wags)"
KERBS = "Kerbs throw the car off line"


def run(cx, verbose=False):
    # diag_event references ref_symptom, so the events must go before the catalogue is replaced.
    # Deferring the check to commit also lets the rebuild happen in any order inside the txn.
    cx.execute("PRAGMA defer_foreign_keys=ON")
    cx.execute("DELETE FROM diag_event")
    n_sym = seed_symptoms(cx)
    have = {r[0] for r in cx.execute("SELECT symptom FROM ref_symptom")}
    ev = []

    # ---- grip symptoms, straight off the lap samples --------------------------
    turns_by_route = {}
    for r in cx.execute("""SELECT cr.route_key, g.turn_id, g.apex_x, g.apex_z, g.radius_m, g.width_m
                           FROM ref_route_turn g
                           JOIN course_route cr ON cr.route_id = g.route_id"""):
        turns_by_route.setdefault(r["route_key"], []).append(dict(r))
    for t in (x for v in turns_by_route.values() for x in v):
        w = (t["width_m"] or 10.0) * 0.5 + 0.25 * (t["radius_m"] or 60.0)
        t["_w2"] = max(18.0, min(70.0, w)) ** 2

    laps = cx.execute("""SELECT l.lap_id, l.route_key, l.cid, l.container, l.hw_hash,
                                l.session_id, l.drivetrain
                         FROM lap l WHERE l.route_key IN (SELECT route_key FROM course_route
                                                          WHERE route_id IS NOT NULL)""").fetchall()
    for lp in laps:
        turns = turns_by_route.get(lp["route_key"]) or []
        if not turns:
            continue
        pts = cx.execute("""SELECT arc_m, mph, grip, x, z FROM lap_point
                            WHERE lap_id=? ORDER BY i""", (lp["lap_id"],)).fetchall()
        if len(pts) < 8:
            continue
        # nearest turn per sample, plus the distance, so entry/mid/exit can be split
        tagged = []
        for p in pts:
            if p["x"] is None:
                tagged.append((p, None, None)); continue
            best, bd = None, None
            for t in turns:
                d = (p["x"] - t["apex_x"]) ** 2 + (p["z"] - t["apex_z"]) ** 2
                if d <= t["_w2"] and (bd is None or d < bd):
                    best, bd = t, d
            tagged.append((p, best, bd))
        # apex sample index per turn = the closest approach
        apex_at = {}
        for i, (p, t, d) in enumerate(tagged):
            if t and (t["turn_id"] not in apex_at or d < apex_at[t["turn_id"]][1]):
                apex_at[t["turn_id"]] = (i, d)
        # runs of one slip state inside one turn
        i = 0
        while i < len(tagged):
            p, t, _ = tagged[i]
            g = p["grip"]
            if not t or g not in (1, 2, 3):
                i += 1; continue
            j = i
            while j + 1 < len(tagged) and tagged[j + 1][1] is t and tagged[j + 1][0]["grip"] == g:
                j += 1
            n = j - i + 1
            if n >= GRIP_RUN:
                ai = apex_at.get(t["turn_id"], (i, 0))[0]
                mid = (i + j) // 2
                where = "entry" if mid < ai - 1 else ("exit" if mid > ai + 1 else "mid")
                front = g in (1, 3)
                rear = g in (2, 3)
                sym = None
                if front and where == "entry":
                    sym = UNDER_ENTRY
                elif front and where == "mid":
                    sym = UNDER_MID
                elif front and where == "exit" and (lp["drivetrain"] or "").upper() == "AWD":
                    sym = UNDER_EXIT
                elif rear and where == "entry":
                    sym = OVER_ENTRY
                elif rear and where == "exit":
                    sym = OVER_EXIT
                if sym and sym in have:
                    mphs = [tagged[k][0]["mph"] for k in range(i, j + 1) if tagged[k][0]["mph"] is not None]
                    ev.append((sym, lp["session_id"], lp["cid"], lp["lap_id"], lp["container"],
                               lp["hw_hash"], lp["route_key"], t["turn_id"], where, None,
                               (sum(mphs) / len(mphs)) if mphs else None,
                               round(min(1.0, n / 12.0), 3),
                               "%d samples of %s slip" % (n, "front" if g == 1 else "rear" if g == 2 else "all four"),
                               "grip"))
            i = j + 1

    # ---- the analyzer's own event lists, placed by time then space -----------
    lap_by = {}
    for r in cx.execute("SELECT lap_id, session_id, cid, container, hw_hash, route_key FROM lap"):
        lap_by.setdefault((r["session_id"], r["cid"]), []).append(dict(r))

    for path in sorted(glob.glob(os.path.join(DATA, "sessions", "*.json"))):
        if path.endswith(".tags.json"):
            continue
        s = jload(path)
        if not s:
            continue
        sid = s.get("id") or os.path.splitext(os.path.basename(path))[0]
        corners = [c for c in (s.get("corners") or []) if isinstance(c, dict)]

        def place(t, cid):
            """time -> the session's own corner -> the road turn nearest that corner's apex."""
            for c in corners:
                if c.get("car") != cid:
                    continue
                if c.get("t0") is not None and c.get("t1") is not None and c["t0"] <= t <= c["t1"]:
                    ap = c.get("apex")
                    lps = lap_by.get((sid, cid)) or []
                    rk = lps[0]["route_key"] if lps else None
                    if ap and rk:
                        best, bd = None, None
                        for tt in (turns_by_route.get(rk) or []):
                            d = (ap[0] - tt["apex_x"]) ** 2 + (ap[1] - tt["apex_z"]) ** 2
                            if bd is None or d < bd:
                                best, bd = tt, d
                        if best is not None and bd is not None and bd <= 60.0 ** 2:
                            return rk, best["turn_id"], c
                    return rk, None, c
            return None, None, None

        def ctx(cid):
            lps = lap_by.get((sid, cid)) or []
            return (lps[0]["lap_id"], lps[0]["container"], lps[0]["hw_hash"]) if lps else (None, None, None)

        # ONE INCIDENT, NOT ONE FRAME. The analyzer emits a bottoming row per wheel per sample,
        # so a single compression over a crest produced dozens of rows and the rollup read
        # "990 occurrences on 5 laps" -- which sounds catastrophic and means nothing. Collapse
        # consecutive rows for the same wheel into one incident and keep its worst travel.
        bott, last = [], {}
        for b in sorted((s.get("bottoming") or []), key=lambda x: (x.get("car") or "", x.get("wheel") or "", x.get("t") or 0)):
            k = (b.get("car"), b.get("wheel"))
            prev = last.get(k)
            if prev is not None and (b.get("t") or 0) - (prev.get("t") or 0) <= BOTTOM_GAP_S:
                if (b.get("travel") or 0) > (prev.get("travel") or 0):
                    prev["travel"] = b.get("travel"); prev["mph"] = b.get("mph")
                continue
            rec = dict(b)
            bott.append(rec); last[k] = rec

        for b in bott:
            cid = b.get("car"); tv = b.get("travel")
            if not cid or tv is None or tv < BOTTOM_TRAVEL:
                continue
            rk, tid, c = place(b.get("t") or 0, cid)
            lap_id, cont, hw = ctx(cid)
            rough = bool(c and (c.get("rough_frac") or 0) > 0.2)
            sym = ROUGH if rough and ROUGH in have else BOTTOMING
            ev.append((sym, sid, cid, lap_id, cont, hw, rk, tid, "any", b.get("t"), b.get("mph"),
                       round(min(1.0, max(0.0, (tv - BOTTOM_TRAVEL) / (1.0 - BOTTOM_TRAVEL))), 3),
                       "%s travel %.3f" % (b.get("wheel"), tv), "bottoming"))

        for b in (s.get("braking") or []):
            cid = b.get("car")
            if not cid:
                continue
            rd, fd = b.get("rear_deficit") or 0, b.get("front_deficit") or 0
            lock = (b.get("lock") or "none")
            if rd < BRAKE_DEFICIT and lock != "rear":
                continue
            rk, tid, _ = place(b.get("t") or 0, cid)
            lap_id, cont, hw = ctx(cid)
            ev.append((BRAKE, sid, cid, lap_id, cont, hw, rk, tid, "braking", b.get("t"),
                       b.get("mph_start"), round(min(1.0, rd), 3),
                       "rear deficit %.2f vs front %.2f, lock=%s" % (rd, fd, lock), "braking"))

        for c0 in (s.get("crests") or []):
            cid = c0.get("car"); g = c0.get("g")
            if not cid or g is None or g > CREST_AIR_G:
                continue
            rk, tid, _ = place(c0.get("t") or 0, cid)
            lap_id, cont, hw = ctx(cid)
            ev.append((CRESTS, sid, cid, lap_id, cont, hw, rk, tid, "any", c0.get("t"),
                       c0.get("mph"), round(min(1.0, abs(g)), 3), "crest at %.2f g" % g, "crest"))

        for p0 in (s.get("pulses") or []):
            cid = p0.get("car"); y = p0.get("yaw_peak_dps") or 0; mph = p0.get("mph") or 0
            if not cid or y < PULSE_YAW or mph < PULSE_MPH:
                continue
            rk, tid, _ = place(p0.get("t") or 0, cid)
            if tid:
                continue                        # a wobble inside a corner is not "wanders at top speed"
            lap_id, cont, hw = ctx(cid)
            ev.append((WANDER, sid, cid, lap_id, cont, hw, rk, None, "straight", p0.get("t"),
                       mph, round(min(1.0, y / 90.0), 3), "yaw peak %.1f deg/s" % y, "pulse"))

    # ---- the deterministic detectors, from their per-session sidecars ---------
    # Written by `python scripts/telemetry/deterministic.py --scan`, which reads the raw captures.
    # Read from a sidecar rather than re-read 25 GB of CSV here, because this stage runs on every
    # session close and a full rescan would put half an hour into a cascade that is meant to be
    # seconds. A missing sidecar is not an error -- it means that session has not been scanned yet,
    # and the events simply are not there until it is.
    n_det, n_det_files = 0, 0
    for path in sorted(glob.glob(os.path.join(DATA, "sessions", "*.det.json"))):
        d = jload(path)
        if not d:
            continue
        n_det_files += 1
        sid = d.get("session") or os.path.basename(path).split(".")[0]
        for f in (d.get("findings") or []):
            sym = DET_FAULT_SYMPTOM.get(f.get("fault"))
            if not sym or sym not in have:
                continue                        # bottoming lands here: written by the analyzer path above
            rk = f.get("route_key")
            tid = None
            # Placed in SPACE against the turn apexes, the same way the grip symptoms are -- the
            # sidecar carries the incident's own x/z, so there is no need to bracket it into a
            # corner by time first. Gearing carries no position: it is a whole-lap fault and keeps
            # a NULL turn, exactly as "wanders at top speed" does.
            if f.get("x") is not None and rk:
                # A BRAKING fault sits BEFORE the apex by design, so the apex window that suits a
                # grip symptom is the wrong shape for it. Measured on Edamame: of 66 lock incidents,
                # 36 fell outside the window, but their median distance to the nearest apex was 22 m
                # against windows of 18-27 m, and the maximum was 50 m -- they are the braking zones
                # of the very turns they belong to. So braking faults get a doubled window, capped at
                # HALF the distance to the second-nearest apex, which makes it impossible for the
                # widening to reach into the next turn however tightly the course is wound.
                braking = "lock" in (f.get("fault") or "")
                ds = sorted(((f["x"] - tt["apex_x"]) ** 2 + (f["z"] - tt["apex_z"]) ** 2, tt)
                            for tt in (turns_by_route.get(rk) or []))
                if ds:
                    d0, t0 = ds[0]
                    lim2 = t0["_w2"]
                    if braking:
                        cap = (0.5 * math.sqrt(ds[1][0])) ** 2 if len(ds) > 1 else 4.0 * lim2
                        lim2 = min(4.0 * lim2, cap)
                    tid = t0["turn_id"] if d0 <= lim2 else None
            m = f.get("measure") or {}
            ev.append((sym, sid, f.get("cid"), f.get("lap_id"), f.get("container"), f.get("hw_hash"),
                       rk, tid, "braking" if "lock" in (f.get("fault") or "") else "straight",
                       f.get("t"), m.get("entry_mph") or m.get("mph"),
                       round(min(1.0, max(0.0, f.get("severity") or 0.0)), 3),
                       f.get("detail"), "deterministic"))
            n_det += 1
    if verbose:
        print("  deterministic sidecars: %d file(s), %d event(s)" % (n_det_files, n_det))

    with cx:
        cx.execute("DELETE FROM diag_event")
        n = fh6db.upsert_many(cx, "diag_event", [
            "symptom", "session_id", "cid", "lap_id", "container", "hw_hash", "route_key",
            "turn_id", "phase", "t", "mph", "severity", "detail", "source"], ev, chunk=5000)
    return {"ref_symptom": n_sym, "diag_event": n, "deterministic": n_det}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "diagnosis", "symptom matrix x analyzer events x lap grip")
    try:
        counts = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1, json.dumps(counts))
    for k in sorted(counts):
        print("  %-16s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
