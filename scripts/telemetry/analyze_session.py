#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Session analyzer v0.2 — turns a Data Out capture CSV (from fh6_dataout_capture.py / fh6_live_daemon.py)
into a compact session JSON for the dashboard's Telemetry Lab (Live / Lab Run / Decode Bench).

python scripts/telemetry/analyze_session.py captures/fh6_20260821_122523.csv [--out data/sessions/]

Identity is keyed by CONFIGURATION, not just car: id = "ordinal|drivetrain|cylinders|PI", so an engine
swap or drivetrain conversion mid-session becomes a new entry. Each entry carries a build signature
(max rpm, boost, dyno peak, gear count + ladder, mass index) and a short build_id hash; names come
from data/car-ordinals.json (learned map) when known.
"""
import re
import csv, hashlib, json, math, os, statistics, sys
from collections import defaultdict

G = 9.80665
CLASS = {0: "D", 1: "C", 2: "B", 3: "A", 4: "S1", 5: "S2", 6: "X", 7: "X"}
DRIVE = {0: "FWD", 1: "RWD", 2: "AWD"}
W = ["FL", "FR", "RL", "RR"]
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
INTS = ("IsRaceOn","Gear","Accel","Brake","Clutch","HandBrake","Steer","CarOrdinal","CarPI","CarClass","DrivetrainType","NumCylinders","CarGroup","LapNumber","RacePosition","Trailing323","NormDrivingLine","NormAIBrakeDiff")

def cid(r): return f'{r["CarOrdinal"]}|{r["DrivetrainType"]}|{r["NumCylinders"]}|{r["CarPI"]}'

def load(path):
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            try: rows.append({k: (int(float(v)) if k in INTS else float(v)) for k, v in r.items()})
            except Exception: continue
    return rows

def smooth(vals, n=5):
    out = []; s = 0; q = []
    for v in vals:
        q.append(v); s += v
        if len(q) > n: s -= q.pop(0)
        out.append(s / len(q))
    return out

def names_map():
    try:
        with open(os.path.join(ROOT, "data", "car-ordinals.json"), encoding="utf-8") as f: return json.load(f).get("cars", {})
    except Exception: return {}

# ---------------- coverage model + advisor ----------------
PROBES = [  # key, label, required count, weight, hint when incomplete
    ("hairpin", "Hairpins (< 45 mph)", 3, 1.0, "take {n} more tight corners under 45 mph"),
    ("medium", "Medium corners (45-85 mph)", 4, 1.0, "{n} more medium-speed corners"),
    ("fast", "Fast sweepers (> 85 mph)", 3, 1.0, "{n} more sweepers above 85 mph"),
    ("flick", "Chicane flicks (L-R within 2.5 s)", 2, 0.5, "{n} more quick direction changes"),
    ("launch", "Launches (0-60 from rest)", 2, 1.0, "{n} more standing launches"),
    ("brake", "Hard stops from > 80 mph", 3, 1.0, "{n} more hard stops from 80+ mph"),
    ("crest", "Crests / bumps (car goes light)", 2, 0.5, "{n} more crests at speed"),
    ("top", "Top-speed pull (WOT in top gear, 5 s)", 1, 0.5, "hold full throttle in top gear for 5 s"),
    ("wiggle", "Steering pulses > 55 mph", 8, 0.5, "{n} more quick steering pulses at speed (experimental)"),
    ("dyno", "Dyno rpm coverage (WOT)", 1, 1.0, "full-throttle pulls through the rev range"),
    ("gears", "Gear ladder", 1, 1.0, "full-throttle time in every gear"),
    ("warm", "Tires warm (> 150 F) most of the run", 1, 0.5, "keep driving — tires still cold for most frames"),
]

def dyno_band(c):
    """The honest WOT dyno band, in 250-rpm bins: from idle+1750 rounded UP (the lugging / boost-lag fringe below adds nothing to the curve
    match; WOT frames count from idle+1200 so every bin is reachable) up to 96% of redline OR the gearbox's measured upshift point, whichever
    is lower (an automatic never sits above its shift rpm except at top speed)."""
    lo = -(-((c.get("idle_rpm") or 1000) + 1750) // 250) * 250; hi = 0.96 * (c.get("max_rpm") or 0)
    if c.get("shift_rpm"): hi = min(hi, c["shift_rpm"] + 125)
    bins = [b for b in range(int(lo), int(hi), 250)] or [lo]
    return bins

def coverage_for(cid_, cars, corners, launches, braking, crests, pulses, top_pull, warm_frac):
    c = cars.get(cid_) or {}
    grip = [x for x in corners if x["car"] == cid_ and not x["drift"]]
    counts = {
        "hairpin": sum(1 for x in grip if x["mph_min"] < 45), "medium": sum(1 for x in grip if 45 <= x["mph_min"] <= 85), "fast": sum(1 for x in grip if x["mph_min"] > 85),
        "flick": sum(1 for a, b in zip(grip, grip[1:]) if a["dir"] != b["dir"] and 0 <= b["t0"] - a["t1"] <= 2.5),
        "launch": sum(1 for x in launches if x["car"] == cid_), "brake": sum(1 for x in braking if x["car"] == cid_ and x["mph_start"] >= 80),
        "crest": sum(1 for x in crests if x["car"] == cid_), "top": 1 if top_pull.get(cid_, 0) >= 5 else 0, "wiggle": sum(1 for x in pulses if x["car"] == cid_),
    }
    # dyno: practical WOT band from idle+1500 to 96% of redline (the top bin is the limiter you never sit on)
    dyno = c.get("dyno") or []; bins = dyno_band(c); have = {d["rpm"] for d in dyno}
    counts["dyno"] = round(sum(1 for b in bins if b in have) / len(bins), 2)
    g = c.get("gears") or []; mx = max([x["gear"] for x in g], default=0); counts["gears"] = round(len(g) / mx, 2) if mx else 0
    counts["warm"] = round(warm_frac.get(cid_, 0), 2)
    probes = []; num = 0; den = 0
    for key, label, req, wt, hint in PROBES:
        n = counts[key]; frac = key in ("dyno", "gears", "warm")
        if frac:
            conf = min(1.0, float(n) / (0.6 if key == "warm" else 1.0)); ready = conf >= 0.95
        else:
            conf = strength(n, req); ready = n >= req
        need = max(0, req - int(n)) if not frac else (0 if ready else 1)
        hint_txt = (hint.format(n=need) if not ready else ("saturated" if conf >= 0.97 else "verdict-ready — more sharpens it"))
        probes.append({"key": key, "label": label, "count": n, "required": req, "confidence": round(conf, 2), "ready": ready, "hint": hint_txt})
        num += conf * wt; den += wt
    return {"overall": round(num / den, 2), "probes": probes}

def strength(n, req):
    """Asymptotic evidence strength: 0.70 at the required count, ~0.91 at 2x, ~0.97 at 3x, -> 1.0."""
    return 1.0 - math.exp(-1.2 * float(n) / max(req, 1e-9))

def course_profile(loop_rows, corners_here, braking_here, launches_here, car0):
    """What the course DEMANDS — a usage histogram. Absence is information: no straight => gearing/top-end irrelevant here."""
    if not loop_rows: return None
    dt = []; prevt = None
    for r in loop_rows:
        if prevt is not None and 0 < r["t"] - prevt < 0.5: dt.append((r, r["t"] - prevt))
        prevt = r["t"]
    T = sum(d for _, d in dt) or 1e-9
    frac = {"low_corner": 0.0, "mid_corner": 0.0, "fast_corner": 0.0, "braking": 0.0, "straight": 0.0, "cruise": 0.0}
    gear_time = defaultdict(float); ys = []
    for r, d in dt:
        lat = abs(r["lat_g"]); sp = r["speed_mph"]; ys.append(r.get("PosY", 0.0))
        if r["Brake"] > 110 and sp > 35: frac["braking"] += d
        elif lat > 0.5 and sp < 45: frac["low_corner"] += d
        elif lat > 0.5 and sp <= 85: frac["mid_corner"] += d
        elif lat > 0.5: frac["fast_corner"] += d
        elif r["Accel"] > 190 and lat < 0.3 and sp > 55: frac["straight"] += d
        else: frac["cruise"] += d
        if r["Gear"] >= 1: gear_time[r["Gear"]] += d
    for k in frac: frac[k] = round(frac[k] / T, 3)
    def band(x): return "heavy" if x >= 0.22 else "moderate" if x >= 0.09 else "light" if x >= 0.02 else "absent"
    max_gear = max((g["gear"] for g in (car0.get("gears") or [])), default=0)
    gears_used = sorted(g for g, t in gear_time.items() if t / T >= 0.02)
    top_used = max(gears_used) if gears_used else 0
    ele_range = round(max(ys) - min(ys), 1) if ys else 0
    top_speed = round(max((r["speed_mph"] for r in loop_rows), default=0))
    dims = {
        "low_corner": {"frac": frac["low_corner"], "band": band(frac["low_corner"])},
        "mid_corner": {"frac": frac["mid_corner"], "band": band(frac["mid_corner"])},
        "fast_corner": {"frac": frac["fast_corner"], "band": band(frac["fast_corner"])},
        "braking": {"frac": frac["braking"], "band": band(frac["braking"])},
        "straight": {"frac": frac["straight"], "band": band(frac["straight"])},
        "elevation": {"frac": None, "band": "moderate" if ele_range > 25 else "light" if ele_range > 8 else "absent", "range_m": ele_range},
        "launch": {"frac": None, "band": "moderate" if launches_here else "absent"},
    }
    order = ["low_corner", "mid_corner", "fast_corner", "braking", "straight", "elevation"]
    lbl = {"low_corner": "low-speed corners", "mid_corner": "medium corners", "fast_corner": "fast sweepers", "braking": "heavy braking", "straight": "straights / top-end", "elevation": "elevation (crests)"}
    heavy = [lbl[k] for k in order if dims[k]["band"] == "heavy"]
    absent = [lbl[k] for k in order if dims[k]["band"] == "absent"]
    notes = []
    if dims["straight"]["band"] in ("absent", "light"): notes.append(f"no real straight (top speed only {top_speed} mph, gears used {gears_used or '—'}/{max_gear}) — top-end gearing & drag are irrelevant here; tune the gears you use")
    if dims["elevation"]["band"] == "absent": notes.append("flat (no crests) — spring/damper vertical behaviour isn't tested on this course")
    if dims["fast_corner"]["band"] == "absent": notes.append("no fast corners — understeer here is mechanical, not aero")
    return {"dims": dims, "heavy": heavy, "absent": absent, "gears_used": gears_used, "top_gear_used": top_used, "max_gear": max_gear, "top_speed": top_speed, "elevation_range_m": ele_range, "notes": notes, "priority": [lbl[k] for k in sorted(order, key=lambda k: -(dims[k]["frac"] or 0)) if dims[k]["band"] in ("heavy", "moderate")]}

# maps an advice key to the course dimension it depends on (for profile weighting)
ADV_DIM = {"brake-lockup": "braking", "trail-brake": "braking", "brake-pressure": "braking", "brake-balance-rear": "braking", "brake-balance-front": "braking",
           "mid-understeer": "corner", "rear-limited": "corner", "oversteer-balance": "corner", "front-hot": "corner", "tires-cooking": "corner",
           "launch-spin": "launch", "launch-front-spin": "launch", "bottoming": "elevation",
           "inconclusive-axle": "corner", "inconclusive-usi": "corner", "inconclusive-brake": "braking", "inconclusive-launch": "launch", "more-data": "meta"}

def advice_for(cid_, cars, corners, launches, braking, bott, cov, temps_med, profile=None):
    c = cars.get(cid_) or {}; out = []
    grip = [x for x in corners if x["car"] == cid_ and not x["drift"]]; n = len(grip)
    def add(key, text, sev, conf, ev): out.append({"key": key, "text": text, "severity": sev, "confidence": round(max(0, min(1, conf)), 2), "evidence": ev})
    # confidence = asymptotic evidence strength (more events keep sharpening it) x consistency (share of events that agree)
    agree = lambda k, tot, req=3: strength(k, req) * (0.5 + 0.5 * (k / tot if tot else 0))
    fr1 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "front" and x["first_red"]["phase"] == 1)
    fr2 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "front" and x["first_red"]["phase"] == 2)
    fr3 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "front" and x["first_red"]["phase"] >= 3)
    rr = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "rear")
    rr4 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "rear" and x["first_red"]["phase"] == 4)
    usi = sorted(x["usi"] for x in grip); usim = usi[len(usi) // 2] if usi else None
    if n >= 2 and fr1 / n >= 0.3: add("brake-lockup", "Fronts saturate under braking before turn-in: brake pressure DOWN toward the knee, then balance 2-3% rearward.", 3, agree(fr1, n), f"{fr1}/{n} corners red on the fronts in phase 1")
    if n >= 2 and fr2 / n >= 0.25: add("trail-brake", "Trail-brake understeer: finish more braking before steering; caster +0.5 for camber-in-turn.", 2, agree(fr2, n), f"{fr2}/{n} corners red on the fronts at turn-in")
    if (n >= 3 and fr3 / n >= 0.3) or (usim is not None and n >= 4 and usim > 0.15):
        u_over = sum(1 for u in usi if u > 0.15)
        add("mid-understeer", "Mid-corner understeer: front ARB -2 clicks or front springs softer (mech balance up); if only in fast corners, aero balance forward instead.", 2, max(agree(fr3, n), agree(u_over, n, 4)), f"USI median {usim:+.3f} over {n} corners ({u_over} understeer, {fr3} mid-corner front reds)")
    if n >= 2 and rr / n >= 0.3: add("rear-limited", "Rear-limited corners: rear ARB/springs softer; on throttle (phase 4) accel diff lock -10%.", 3, agree(rr, n), f"{rr}/{n} corners red on the rears ({rr4} on exit)")
    if usim is not None and n >= 4 and usim < -0.05:
        u_os = sum(1 for u in usi if u < -0.05); add("oversteer-balance", "Balance reads oversteer (negative USI): rear relatively softer or rear wing up.", 2, agree(u_os, n, 4), f"USI median {usim:+.3f} ({u_os}/{n} oversteer corners)")
    L = [x for x in launches if x["car"] == cid_]; k_r = k_f = 0
    if L:
        prs = sorted(x["peak_slip_rear"] for x in L)[len(L) // 2]; pfs = sorted(x["peak_slip_front"] for x in L)[len(L) // 2]
        k_r = sum(1 for x in L if x["peak_slip_rear"] > 1.5); k_f = sum(1 for x in L if x["peak_slip_front"] > 1.2)
        if prs > 1.5: add("launch-spin", "Launch wheelspin on the rears: accel diff lock down / taller 1st, or squeeze the throttle.", 2, agree(k_r, len(L), 2), f"median peak rear slip {prs:.2f}; {k_r}/{len(L)} launches spun")
        if pfs > 1.2 and c.get("drivetrain") == "AWD": add("launch-front-spin", "AWD fronts spinning at launch: center split more rearward / front accel diff down.", 2, agree(k_f, len(L), 2), f"median peak front slip {pfs:.2f}; {k_f}/{len(L)} launches")
    B = [x for x in braking if x["car"] == cid_ and x["mph_start"] >= 60]; both = fr_first = rr_first = 0; fd = rd = 0.0
    if len(B) >= 2:
        fd = sorted(x["front_deficit"] for x in B)[len(B) // 2]; rd = sorted(x["rear_deficit"] for x in B)[len(B) // 2]
        both = sum(1 for x in B if x["front_deficit"] > 0.35 and x["rear_deficit"] > 0.35); fr_first = sum(1 for x in B if x["front_deficit"] > x["rear_deficit"] + 0.1); rr_first = sum(1 for x in B if x["rear_deficit"] > x["front_deficit"] + 0.1)
        if fd > 0.35 and rd > 0.35: add("brake-pressure", "Both axles lock under hard braking: brake pressure too high overall — bring it down to the knee.", 3, agree(both, len(B)), f"median deficit F {fd:.2f} / R {rd:.2f}; {both}/{len(B)} stops locked both")
        elif fd > rd + 0.1: add("brake-balance-rear", "Fronts lock first: brake balance 2-4% rearward.", 2, agree(fr_first, len(B)), f"median deficit F {fd:.2f} vs R {rd:.2f}; {fr_first}/{len(B)} stops")
        elif rd > fd + 0.1: add("brake-balance-front", "Rears lock first: brake balance forward, decel diff lock down.", 2, agree(rr_first, len(B)), f"median deficit R {rd:.2f} vs F {fd:.2f}; {rr_first}/{len(B)} stops")
    # ---- inconsistency detectors: mixed evidence -> "further testing needed", naming the probe that resolves it ----
    def open_item(key, text, unc, ev, needs): out.append({"key": key, "text": text, "severity": 1, "confidence": round(max(0, min(1, unc)), 2), "evidence": ev, "needs": needs, "open": True})
    fr_all = fr1 + fr2 + fr3
    if n >= 3 and rr > 0 and fr_all > 0 and not (fr_all / n >= 0.65 or rr / n >= 0.65):
        open_item("inconclusive-axle", f"Mixed axle signal — {fr_all} front-limited vs {rr} rear-limited of {n} corners. Not enough agreement for a balance call: repeat the same corner type several times before changing anything.", 1 - abs(fr_all - rr) / n, f"{fr_all}F / {rr}R / {n - fr_all - rr} clean", ["hairpin", "medium", "fast"])
    if n >= 4:
        iqr = usi[int(0.75 * (len(usi) - 1))] - usi[int(0.25 * (len(usi) - 1))]
        if iqr > 0.2:
            by = {"hairpin": [x["usi"] for x in grip if x["mph_min"] < 45], "medium": [x["usi"] for x in grip if 45 <= x["mph_min"] <= 85], "fast": [x["usi"] for x in grip if x["mph_min"] > 85]}
            parts = [f"{k} {sorted(v)[len(v)//2]:+.2f} (n={len(v)})" for k, v in by.items() if v]
            thin = [k for k, v in by.items() if len(v) < 3]
            open_item("inconclusive-usi", f"Balance varies corner to corner (USI spread {iqr:.2f}) — likely speed-dependent (mechanical vs aero). Split the verdict by corner speed before tuning.", min(1, iqr), "by type: " + ", ".join(parts), thin or ["hairpin", "medium", "fast"])
    if len(B) >= 2:
        maj = max(both, fr_first, rr_first)
        if maj < 0.6 * len(B):
            open_item("inconclusive-brake", f"Brake-lock pattern inconsistent across {len(B)} stops ({both} both-axle, {fr_first} front-first, {rr_first} rear-first) — more hard stops from 80+ mph before touching balance.", 1 - maj / len(B), f"deficit medians F {fd:.2f} / R {rd:.2f}", ["brake"])
    if len(L) >= 2 and 0 < k_r < len(L):
        open_item("inconclusive-launch", f"Launch wheelspin only in {k_r}/{len(L)} launches — inconsistent (surface, temps or throttle?). Two more standing launches on the same surface.", 1 - abs(2 * k_r - len(L)) / len(L), f"rear slip peaks {sorted(round(x['peak_slip_rear'], 1) for x in L)}", ["launch"])
    tm = temps_med.get(cid_)
    if tm:
        fmed = (tm["FL"] + tm["FR"]) / 2; rmed = (tm["RL"] + tm["RR"]) / 2
        if fmed - rmed > 15: add("front-hot", "Fronts run 15 F+ hotter than rears: the understeer thermal signature — check pressures/camber on the HUD (Tires Misc + Heat).", 1, 0.7, f"median F {fmed:.0f} F vs R {rmed:.0f} F")
        if max(tm.values()) > 300: add("tires-cooking", "Tire temps past 300 F: pressures likely high and/or sustained wheelspin — HUD pressure check.", 1, 0.6, f"max median {max(tm.values()):.0f} F")
    nb = sum(1 for x in bott if x["car"] == cid_ and x["mph"] > 40)
    if nb >= 8: add("bottoming", "Suspension hits full compression at speed: ride height up a notch or springs stiffer (verify on the HUD Suspension page).", 1, min(1, nb / 20), f"{nb} bottoming frames above 40 mph (detector still coarse)")
    if cov and cov["overall"] < 0.35: add("more-data", "Low coverage: verdicts are provisional — see the probe bars for what to drive next.", 1, 1.0, f"coverage {cov['overall']:.0%}")
    if profile:
        BW = {"heavy": 1.0, "moderate": 0.85, "light": 0.5, "absent": 0.15}; dims = profile["dims"]
        for a in out:
            dim = ADV_DIM.get(a["key"], "meta")
            if dim == "meta": a["course_weight"] = 1.0
            elif dim == "corner": a["course_weight"] = max(BW[dims["low_corner"]["band"]], BW[dims["mid_corner"]["band"]], BW[dims["fast_corner"]["band"]])
            else: a["course_weight"] = BW[dims.get(dim, {}).get("band", "moderate")]
            if a["course_weight"] <= 0.2: a["minor_here"] = True
    wt = lambda a: a.get("course_weight", 1.0)
    firm = [a for a in out if not a.get("open")]; opn = [a for a in out if a.get("open")]
    firm.sort(key=lambda a: -(a["severity"] * a["confidence"] * wt(a))); opn.sort(key=lambda a: -(a["confidence"] * wt(a)))
    return firm + opn

def decode_battery_for(cid_, cars, corners, launches, braking, crests, pulses, top_pull):
    """DECODE progress = completeness of the tests needed to clone this build. Per car, session-wide:
    tests count wherever they were driven — the loop is a convenience, not a requirement."""
    c = cars.get(cid_) or {}
    grip = [x for x in corners if x["car"] == cid_ and not x["drift"]]
    gl = {g["gear"]: g["n"] for g in (c.get("gears") or [])}
    mx = max(gl, default=0)
    dyno = c.get("dyno") or []; dbins = dyno_band(c); have = {d["rpm"] for d in dyno}
    miss_bins = [b for b in dbins if b not in have]; miss_gears = [g for g in range(1, mx + 1) if gl.get(g, 0) < 15]
    dyno_detail = (f"missing rpm: {', '.join(str(b) for b in miss_bins)} — roll onto full throttle from low rpm in a tall gear for the low bins; hold WOT to the shift point for the high ones" if miss_bins else None)
    if c.get("shift_rpm"): dyno_detail = (dyno_detail or "") + f" · band capped at your gearbox's upshift point (~{int(c['shift_rpm'])} rpm)"
    TESTS = [
        ("launch", "Standing launch", sum(1 for x in launches if x["car"] == cid_), 1, "mass index · diff center split · accel spin", ["Weight (mass index)"]),
        ("gears", "Full gear ladder", sum(1 for g in gl if gl[g] >= 15), max(mx, 1), "WOT time in every gear" + (f" — missing gear {', '.join(map(str, miss_gears))}" if miss_gears and mx else ""), ["Transmission", "Gear ratios (tune)"]),
        ("dyno", "Dyno rev sweep", sum(1 for b in dbins if b in have), len(dbins), "full-throttle through the usable rev range" + (" — " + dyno_detail if dyno_detail else ""), ["Total output target", "Aspiration"]),
        ("top", "Top-speed pull", 1 if top_pull.get(cid_, 0) >= 5 else 0, 1, "hold top gear WOT 5 s", ["Gear ratios (tune)", "Aero presence hint"]),
        ("brake", "Hard stops from 80+", sum(1 for x in braking if x["car"] == cid_ and x["mph_start"] >= 80), 2, "threshold brake — balance / lock threshold", ["Brakes"]),
        ("hairpin", "Hairpin", sum(1 for x in grip if x["mph_min"] < 45), 1, "low-speed mechanical balance", ["Springs / ARBs (behaviour)"]),
        ("medium", "Medium corner", sum(1 for x in grip if 45 <= x["mph_min"] <= 85), 1, "mid-speed balance", ["Springs / ARBs (behaviour)"]),
        ("fast", "Fast sweeper", sum(1 for x in grip if x["mph_min"] > 85), 1, "high-speed / aero balance", ["Aero presence hint"]),
        ("crest", "Crest / bump", sum(1 for x in crests if x["car"] == cid_), 1, "spring & damper vertical behaviour", ["Dampers (behaviour)"]),
        ("wiggle", "Steering pulses", sum(1 for x in pulses if x["car"] == cid_), 3, "yaw damping (experimental)", ["Dampers (behaviour)"]),
    ]
    tests = [{"key": k, "label": lb, "have": hv, "need": nd, "ok": hv >= nd, "why": why, "unlocks": ul} for k, lb, hv, nd, why, ul in TESTS]
    ready = sum(1 for t in tests if t["ok"])
    return {"ready_n": ready, "total": len(tests), "pct": round(ready / len(tests), 2), "missing": [t["label"] for t in tests if not t["ok"]], "tests": tests}

def clone_sheet_for(c, bat):
    """The decode deliverable: a standardized upgrade sheet organized like the in-game upgrade shop menus. Each row carries what to install /
    match, a status (measured = stream fact · inferred = assumption · shop = needs a shop / HUD check) AND a confidence EARNED from evidence:
    how many independent measurements back the figure and how consistent they are — never a single reading."""
    ok = {t["key"]: t["ok"] for t in bat["tests"]}; gpct = {t["key"]: min(1.0, t["have"] / max(1, t["need"])) for t in bat["tests"]}
    sig = c.get("sig") or {}; ev = c.get("evidence") or {}
    def cons(iqr, scale): return 1.0 if iqr is None else max(0.0, 1.0 - min(1.0, iqr / scale))
    def row(item, value, status, note=None, gate=None, conf=None, evid=None, needs=None):
        pend = bool(gate) and not ok.get(gate, False)
        if status == "inferred" and conf is None: conf = 0.55
        cv = max(0.0, min(1.0, conf if conf is not None else 0.0))
        if pend: cv = cv * gpct.get(gate, 0.0)   # a pending row's confidence BUILDS toward its gate test instead of sitting at zero (the value stays hidden until the test passes)
        return {"item": item, "value": None if pend else value, "status": status, "note": note, "gate": gate, "pending": pend,
                "confidence": (None if status == "shop" else round(cv, 2)), "evidence": evid, "needs": needs}
    frames = ev.get("frames", 0); wot = ev.get("wot_frames", 0)
    const_conf = strength(frames, 300); const_ev = f"{frames:,} frames · constant across the run"   # header constants are confirmed on every frame
    boost = sig.get("boost_max") or 0
    if boost > 0.5:
        b_iqr = ev.get("boost_per_pull_iqr_pct"); asp_conf = strength(ev.get("boost_frames", 0), 150) * cons(b_iqr, 15)
        asp_v = f"forced induction — peak {boost} psi"; asp_ev = f"{ev.get('boost_frames', 0):,} boost-on frames · peak boost across {ev.get('pulls', 0)} pulls ±{b_iqr if b_iqr is not None else '—'}%"
        asp_needs = None if asp_conf >= 0.7 else "more full-throttle pulls so peak boost repeats"; asp_n = "boost ramp shape names the type: laggy = turbo, rpm-linear = centrifugal, flat = positive-displacement"
    else:
        asp_conf = strength(wot, 300); asp_v = "naturally aspirated (0 psi all session)"; asp_ev = f"{wot:,} WOT frames · boost never above 0.5 psi"
        asp_needs = None if asp_conf >= 0.7 else "more full-throttle time"; asp_n = "any NA power upgrades allowed; no turbo/supercharger installed"
    lad = c.get("gears") or []; gstats = ev.get("gears") or {}
    lad_v = " · ".join(f"g{g['gear']} {round(g['mps_per_krpm'] * 2.237, 1)}" for g in lad) + " mph/krpm" if lad else None
    lad_c = [g for g in lad if g["gear"] >= 2] or lad   # gear 1 is wheelspin-contaminated — it stays in the ladder but not in the confidence
    gconfs = {g["gear"]: strength((gstats.get(g["gear"]) or {}).get("n", 0), 60) * cons((gstats.get(g["gear"]) or {}).get("iqr_pct"), 5) for g in lad_c}
    weak_g = sorted((g for g, v in gconfs.items() if v < 0.7), key=lambda g: gconfs[g])
    ratio_conf = (sum(gconfs.values()) / len(gconfs)) if gconfs else 0.0
    gmin = min(gconfs, key=gconfs.get) if gconfs else None
    ratio_ev = (f"{len(lad)} gears · weakest gear {gmin}: {(gstats.get(gmin) or {}).get('n', 0)} WOT frames, spread ±{(gstats.get(gmin) or {}).get('iqr_pct')}%" + (" · gear 1 excluded (launch wheelspin)" if len(lad) > len(lad_c) else "") if gmin else None)
    ratio_needs = (f"hold full throttle longer in gear{'s' if len(weak_g) > 1 else ''} {', '.join(map(str, weak_g))}" if weak_g else None)
    tg = ev.get("top_gear"); tgf = ev.get("top_gear_frames", 0)
    trans_conf = strength(tgf, 40) * (1.0 if ok.get("top") else 0.75)
    trans_ev = f"{sig.get('gear_count')} gears seen · top gear {tg}: {tgf} WOT frames · top-speed pull {'✓' if ok.get('top') else '○'}"
    trans_needs = None if trans_conf >= 0.7 else ("hold top gear at full throttle for 5 s" if not ok.get("top") else "more WOT frames in top gear")
    ptp = ev.get("pulls_through_peak", 0); pk_iqr = ev.get("peak_hp_iqr_pct"); dyno_t = next((t for t in bat["tests"] if t["key"] == "dyno"), None)
    dyno_pct = (dyno_t["have"] / max(1, dyno_t["need"])) if dyno_t else 0.0
    eng_conf = strength(ptp, 3) * cons(pk_iqr, 10) * min(1.0, dyno_pct); peaks = ev.get("peak_hp_per_pull") or []
    eng_ev = f"{ptp} full pull{'s' if ptp != 1 else ''} through the peak · peak {min(peaks) if peaks else '—'}–{max(peaks) if peaks else '—'} hp (±{pk_iqr if pk_iqr is not None else '—'}%) · rpm bins {dyno_t['have'] if dyno_t else 0}/{dyno_t['need'] if dyno_t else 0}"
    eng_needs = None if eng_conf >= 0.7 else (f"{max(0, 3 - ptp)} more full-throttle pull{'s' if 3 - ptp != 1 else ''} that sweep through {sig.get('rpm_at_peak') or 'the peak'} rpm" if ptp < 3 else "peaks disagree across pulls — repeat clean pulls on flat road" if (pk_iqr or 0) > 5 else "finish the rpm sweep")
    mn = ev.get("mass_n", 0); m_iqr = ev.get("mass_iqr_pct"); mass_conf = strength(mn, 30) * cons(m_iqr, 25)
    mass_ev = f"{mn} clean-acceleration samples · spread ±{m_iqr if m_iqr is not None else '—'}%"; mass_needs = None if mass_conf >= 0.7 else "more gentle full-throttle starts (6–20 mph, no wheelspin)"
    menus = [
        {"menu": "Conversions", "items": [
            row("Engine", f"{c['cyl']}-cyl · redline {c['max_rpm']} rpm · idle {c['idle_rpm']}", "measured", "if this differs from the stock engine, an engine swap is installed — the shop's swap list + these specs identify which", None, const_conf, const_ev),
            row("Drivetrain", c["drivetrain"], "measured", "install the drivetrain swap only if the stock layout differs", None, const_conf, const_ev),
            row("Aspiration", asp_v, "measured", asp_n, "dyno" if boost <= 0.5 else None, asp_conf, asp_ev, asp_needs),
            row("Body kit", None, "shop", "not visible in telemetry — check visually"),
        ]},
        {"menu": "Engine", "items": [
            row("Total output target", (f"{sig.get('hp_peak')} hp @ {sig.get('rpm_at_peak')} rpm · {sig.get('tq_peak')} lb-ft" if sig.get("hp_peak") else None), "measured",
                f"any bolt-on stack that reproduces this curve is functionally identical — and the parts list must sum to PI {c['pi']}", "dyno", eng_conf, eng_ev, eng_needs),
        ]},
        {"menu": "Platform & Handling", "items": [
            row("Brakes", "race brakes", "inferred", "assumed — required for the brake tabs a tuned donor uses; confirm in the shop"),
            row("Springs & dampers", "race springs", "inferred", "assumed — required for spring/damper tabs; behaviour match happens on the Bench"),
            row("Anti-roll bars", "race ARBs", "inferred", "assumed — required for the ARB tab"),
            row("Weight (mass index)", (f"~{sig.get('mass_idx')} (relative index)" if sig.get("mass_idx") else None), "inferred", "brackets the weight-reduction tier once compared against stock", "launch", mass_conf, mass_ev, mass_needs),
        ]},
        {"menu": "Drivetrain", "items": [
            row("Transmission", (f"{sig.get('gear_count')}-speed → race {sig.get('gear_count')}-speed" if sig.get("gear_count") else None), "measured", None, "gears", trans_conf, trans_ev, trans_needs),
            row("Gear ratios (tune)", lad_v, "measured", "tune-side: set final drive + per-gear until the WOT ladder matches these exactly", "gears", ratio_conf, ratio_ev, ratio_needs),
            row("Differential", "race differential", "inferred", "assumed — required for accel/decel lock tabs"),
            row("Clutch / driveline", None, "shop", "no telemetry signature — PI budget usually decides these"),
        ]},
        {"menu": "Tires & Rims", "items": [
            row("Compound", None, "shop", "My Cars pane shows it — one screenshot, or the 20-s HUD clip"),
            row("Front / rear width", None, "shop", "shop INSTALLED tiles only — the Centenario lesson"),
            row("Rims / track width", None, "shop", "rim style cosmetic; track width from shop tiles"),
        ]},
        {"menu": "Aero & Appearance", "items": [
            row("Front aero", None, "shop", "fast-sweeper balance hints presence, never the exact part — check shop/visual"),
            row("Rear wing", None, "shop", "same — speed-binned lat-g hints presence only"),
        ]},
    ]
    # ---- INDIVIDUAL COMPONENTS from a build record (the donor car's shop INSTALLED tiles + pane + tune tabs), each VERIFIED against the stream where possible ----
    rec = c.get("build_record"); comp = []
    if rec:
        pane = rec.get("pane") or {}; tabs = [str(t).lower() for t in (rec.get("tune_tabs") or [])]
        def has_tab(*names): return any(any(n in t.replace("-", "").replace(" ", "") for n in names) for t in tabs)
        CONF = {"verified": 0.97, "consistent": 0.9, "captured": 0.85, "contradicted": 0.2}
        hp_m = sig.get("hp_peak"); tq_m = sig.get("tq_peak"); tot_ev = []
        if pane.get("power_hp") and hp_m: tot_ev.append(f"pane {pane['power_hp']} hp vs measured {hp_m} hp → {'match' if abs(pane['power_hp'] - hp_m) / max(1, pane['power_hp']) <= 0.04 else 'MISMATCH'}")
        if pane.get("torque_lbft") and tq_m: tot_ev.append(f"pane {pane['torque_lbft']} lb-ft vs measured {tq_m} → {'match' if abs(pane['torque_lbft'] - tq_m) / max(1, pane['torque_lbft']) <= 0.06 else 'MISMATCH'}")
        if pane.get("pi") is not None: tot_ev.append(f"PI {pane['pi']} {'==' if pane['pi'] == c['pi'] else '!='} measured {c['pi']}")
        totals_ok = (None if not tot_ev else all(("MISMATCH" not in e and "!=" not in e) for e in tot_ev))
        for menu, items in (rec.get("parts") or {}).items():
            rows_ = []
            for it in items or []:
                slot = str(it.get("slot") or ""); inst = it.get("installed")
                if inst is None: continue
                sl = slot.lower(); iv = str(inst).lower(); verdict, evid = "captured", "shop INSTALLED tile"
                if "transmission" in sl:
                    m_ = re.search(r"(\d+)\s*-?\s*speed", iv); gc = sig.get("gear_count")
                    if m_ and gc: verdict, evid = (("verified", f"shop tile · {gc} gears measured at WOT") if int(m_.group(1)) == gc else ("contradicted", f"tile says {m_.group(1)}-speed but the stream measured {gc} gears"))
                elif "aspiration" in sl or "turbo" in sl or "supercharger" in sl:
                    boosted = (sig.get("boost_max") or 0) > 0.5; na = any(k in iv for k in ("stock", "natural", "none"))
                    if na: verdict, evid = (("verified", "no boost in the stream") if not boosted else ("contradicted", f"stream shows {sig.get('boost_max')} psi boost"))
                    else: verdict, evid = (("consistent", f"stream shows {sig.get('boost_max')} psi — family present; the tier comes from the tile") if boosted else ("contradicted", "stream shows no boost"))
                elif menu == "Conversions" and sl.startswith("drivetrain"):
                    dv = c["drivetrain"]; verdict, evid = (("verified", f"stream drivetrain {dv}") if (dv.lower() in iv or "stock" in iv) else ("captured", f"stream drivetrain {dv} — make sure the swap tile matches"))
                elif menu == "Conversions" and sl.startswith("engine"):
                    verdict, evid = "consistent", f"stream: {c['cyl']}-cyl · redline {c['max_rpm']} rpm · idle {c['idle_rpm']} — the named engine must match these"
                elif menu == "Engine":
                    verdict, evid = (("consistent", "engine stack · " + "; ".join(tot_ev)) if totals_ok is True else ("contradicted", "engine stack totals · " + "; ".join(tot_ev)) if totals_ok is False else ("captured", "engine stack — capture the pane power/torque to cross-check the whole stack"))
                elif "brake" in sl: verdict, evid = (("verified", "Brakes tab present in the tune menu") if has_tab("brake") and "race" in iv else ("captured", "shop tile" + (" · no Brakes tab in the tune menu" if tabs and not has_tab("brake") else "")))
                elif "anti-roll" in sl or "antiroll" in sl or "arb" in sl: verdict, evid = (("verified", "Antiroll Bars tab present in the tune menu") if has_tab("antiroll", "arb") and "race" in iv else ("captured", "shop tile"))
                elif "differential" in sl: verdict, evid = (("verified", "Differential tab present in the tune menu") if has_tab("differential", "diff") and ("race" in iv or "sport" in iv) else ("captured", "shop tile"))
                elif "spring" in sl: verdict, evid = (("verified", f"pane suspension '{pane.get('suspension')}'") if pane.get("suspension") and str(pane.get("suspension")).lower() in iv else ("captured", "shop tile"))
                elif "compound" in sl: verdict, evid = (("verified", f"pane compound '{pane.get('compound')}'") if pane.get("compound") and str(pane.get("compound")).lower() in iv else ("captured", "shop tile"))
                elif "weight" in sl: verdict, evid = (("consistent", f"pane weight {pane.get('weight_lb')} lb") if pane.get("weight_lb") else ("captured", "shop tile"))
                rows_.append({"item": slot, "value": inst, "status": verdict, "note": it.get("note"), "gate": None, "pending": False, "confidence": CONF[verdict], "evidence": evid,
                              "needs": ("re-check the shop tile — the stream disagrees" if verdict == "contradicted" else None)})
            if rows_: comp.append({"menu": menu, "items": rows_})
        if comp: menus = comp + [{"menu": "Telemetry cross-check", "items": [it for m in menus for it in m["items"] if it["status"] == "measured"]}]
    counts = {"measured": 0, "inferred": 0, "shop": 0, "pending": 0}; num = den = 0.0; weak = []
    for m in menus:
        for it in m["items"]:
            k_ = "pending" if it["pending"] else it["status"]; counts[k_] = counts.get(k_, 0) + 1
            if it["confidence"] is not None:
                w = 1.0 if it["status"] in ("measured", "verified", "consistent", "captured", "contradicted") else 0.5
                if comp and it["status"] == "measured": w = 0.5   # with components present, telemetry rows are the cross-check, not the deliverable
                num += it["confidence"] * w; den += w
                if it["status"] in ("measured", "contradicted") and it["confidence"] < 0.7: weak.append({"item": it["item"], "confidence": it["confidence"], "needs": it["needs"] or (f"pending — needs the {it['gate']} test" if it["pending"] else None)})
    overall = round(num / den, 2) if den else 0.0
    return {"menus": menus, "counts": counts, "pi": c["pi"], "confidence": overall, "weak": weak, "complete": all(t["ok"] for t in bat["tests"]), "components": bool(comp),
            "build_record": ({"label": rec.get("label"), "captured": rec.get("captured"), "source": rec.get("source"), "tune_share_code": rec.get("tune_share_code"), "file": rec.get("_file")} if rec else None),
            "pi_note": f"cross-check: every proposed parts list must sum to PI {c['pi']} — a mismatch means a missed part (usually widths or aero)"}

def main():
    path = sys.argv[1]
    outdir = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(ROOT, "data", "sessions")
    until = float(sys.argv[sys.argv.index("--until") + 1]) if "--until" in sys.argv else None
    os.makedirs(outdir, exist_ok=True)
    rows = load(path)
    if until is not None: rows = [r for r in rows if r["t_mono"] - rows[0]["t_mono"] <= until]
    if not rows: print("no rows"); return
    t0 = rows[0]["t_mono"]
    for r in rows: r["t"] = r["t_mono"] - t0
    live = [r for r in rows if r["IsRaceOn"] == 1]
    sid = os.path.splitext(os.path.basename(path))[0]; dur = rows[-1]["t"]
    # ---- stints (runs): a new stint starts when driving resumes after >= 2 s off, or the configuration changes ----
    tags = {}; starts = {}
    tpath = os.path.join(ROOT, "data", "sessions", sid + ".tags.json")
    if os.path.exists(tpath):
        try:
            with open(tpath, encoding="utf-8") as f: _tg = json.load(f); tags = _tg.get("stints", {}); starts = _tg.get("stint_starts") or {}
        except Exception: tags = {}; starts = {}
    stint_n = 0; zero_since = None; prev_cfg = None; stint_rows = defaultdict(list)
    # run (stint) boundaries. The live daemon's recorded boundaries (tags file "stint_starts", absolute t_mono) are AUTHORITATIVE — they're
    # mode-aware (menus / fast travel only split a run in Course mode; Decode / Free split on build change, event start/finish, or ➕ new run).
    # Captures without them keep the original rule (build change, or driving resumes after >= 2 s off) so older tag files stay aligned.
    bounds = sorted((int(k), float(v) - rows[0]["t_mono"]) for k, v in starts.items()) if starts else None
    for r in rows:
        if r["IsRaceOn"] == 1:
            k = cid(r)
            if bounds:
                n = 0
                for bn, bt in bounds:
                    if r["t"] >= bt - 0.05: n = bn
                    else: break
                stint_n = n or 1
            elif prev_cfg is None or (zero_since is not None and r["t"] - zero_since >= 2.0) or k != prev_cfg: stint_n += 1
            zero_since = None; prev_cfg = k; r["stint"] = stint_n; stint_rows[stint_n].append(r)
        elif zero_since is None: zero_since = r["t"]
    sess = {"id": sid, "source": path, "frames": len(rows), "duration_s": round(dur, 1), "rate_pps": round(len(rows) / max(dur, 1e-9), 1), "live_frames": len(live)}
    NAMES = names_map()
    # BUILD RECORDS (data/builds/*.json): individual components read from the donor car's shop / pane / tune tabs — matched to a session car by cid
    BUILDS = []; bdir = os.path.join(ROOT, "data", "builds")
    if os.path.isdir(bdir):
        for fn in sorted(os.listdir(bdir)):
            if fn.endswith(".json") and not fn.startswith("_"):
                try:
                    with open(os.path.join(bdir, fn), encoding="utf-8") as f: b = json.load(f); b["_file"] = fn; BUILDS.append(b)
                except Exception: pass

    # ---- per-configuration entries + segments ----
    cars = {}; segments = []; cur = None
    for r in live:
        k = cid(r)
        if k != cur: segments.append({"id": k, "t0": round(r["t"], 1), "t1": round(r["t"], 1)}); cur = k
        else: segments[-1]["t1"] = round(r["t"], 1)
        c = cars.setdefault(k, {"id": k, "ordinal": r["CarOrdinal"], "pi": r["CarPI"], "class": CLASS.get(r["CarClass"], str(r["CarClass"])), "drivetrain": DRIVE.get(r["DrivetrainType"], "?"),
                                "cyl": r["NumCylinders"], "max_rpm": round(r["EngineMaxRpm"]), "idle_rpm": round(r["EngineIdleRpm"]), "car_group": r["CarGroup"],
                                "name": (NAMES.get(str(r["CarOrdinal"])) or {}).get("name"),
                                "live_frames": 0, "_gear": defaultdict(list), "_dyno": defaultdict(list), "_k": {w: [] for w in W}, "_boost": 0.0, "_mass": [], "_shift": [], "_prev": None, "_pull": None, "_pulls": [], "_boost_n": 0, "temps_max_f": {w: 0 for w in W}})
        c["live_frames"] += 1; c["_boost"] = max(c["_boost"], r["Boost"])
        if r["Boost"] > 0.5: c["_boost_n"] += 1
        for w in W: c["temps_max_f"][w] = max(c["temps_max_f"][w], r["TireTempF" + w])
        # gearbox upshift point (automatic): rpm of the last WOT frame before a gear change (gear 11 = shift transient)
        pv = c["_prev"]
        if pv is not None and pv["Accel"] > 230 and 1 <= pv["Gear"] <= 9 and (r["Gear"] == 11 or r["Gear"] == pv["Gear"] + 1) and pv["CurrentEngineRpm"] > 0.5 * pv["EngineMaxRpm"]: c["_shift"].append(pv["CurrentEngineRpm"])
        c["_prev"] = r
        # WOT frames for the dyno / ladder: anything above idle+1200 (the dyno band below starts at idle+1500, so every bin is reachable)
        if r["Accel"] > 230 and r["CurrentEngineRpm"] > r["EngineIdleRpm"] + 1200 and r["Speed"] > 5 and 1 <= r["Gear"] <= 10:
            c["_gear"][r["Gear"]].append(r["Speed"] / r["CurrentEngineRpm"])
            c["_dyno"][int(r["CurrentEngineRpm"] // 250) * 250].append((r["Power"] / 745.7, r["Torque"] * 0.7376))
            # independent WOT PULLS (gap > 0.7 s starts a new one): the engine figure must repeat across pulls, not come from one burst
            hp_ = r["Power"] / 745.7; rpm_ = r["CurrentEngineRpm"]; pl = c["_pull"]
            if pl is None or r["t"] - pl["t_last"] > 0.7:
                if pl is not None and pl["rpm_max"] - pl["rpm_min"] >= 1500: c["_pulls"].append(pl)
                pl = c["_pull"] = {"t0": r["t"], "t_last": r["t"], "hp_max": hp_, "rpm_at": rpm_, "rpm_min": rpm_, "rpm_max": rpm_, "boost_max": r["Boost"]}
            pl["t_last"] = r["t"]; pl["rpm_min"] = min(pl["rpm_min"], rpm_); pl["rpm_max"] = max(pl["rpm_max"], rpm_); pl["boost_max"] = max(pl["boost_max"], r["Boost"])
            if hp_ > pl["hp_max"]: pl["hp_max"] = hp_; pl["rpm_at"] = rpm_
            if 6 < r["Speed"] < 20 and r["AccelZ"] > 1.5 and all(abs(r["SlipRatio" + w]) < 0.3 for w in W) and r["Power"] > 10000:
                c["_mass"].append(r["Power"] / (r["Speed"] * r["AccelZ"]))   # kg-ish index (ignores drag/driveline loss)
        if r["Accel"] < 10 and r["Brake"] < 10 and r["Speed"] > 8:
            for w in W: c["_k"][w].append(r["WheelRotSpeed" + w] / r["Speed"])
    for c in cars.values():
        base = None; lad = []
        for g in sorted(c["_gear"]):
            if len(c["_gear"][g]) < 25: continue
            m = statistics.median(c["_gear"][g]); base = base or m
            lad.append({"gear": g, "mps_per_krpm": round(m * 1000, 3), "rel": round(m / base, 3), "n": len(c["_gear"][g])})
        c["gears"] = lad
        c["dyno"] = [{"rpm": k, "hp": round(statistics.median([p for p, q in v])), "tq": round(statistics.median([q for p, q in v])), "n": len(v)} for k, v in sorted(c["_dyno"].items()) if len(v) >= 8]
        c["k_wheel"] = {w: (statistics.median(c["_k"][w]) if c["_k"][w] else None) for w in W}
        c["live_s"] = round(c["live_frames"] / max(sess["rate_pps"], 1), 1)
        for w in W: c["temps_max_f"][w] = round(c["temps_max_f"][w])
        pk = max(c["dyno"], key=lambda d: d["hp"]) if c["dyno"] else None
        c["shift_rpm"] = round(statistics.median(c["_shift"]), -1) if len(c["_shift"]) >= 3 else None   # automatic's upshift point — caps the usable dyno band
        # ---- EVIDENCE for the clone sheet: how many independent measurements back each figure, and how consistent they are ----
        if c["_pull"] is not None and c["_pull"]["rpm_max"] - c["_pull"]["rpm_min"] >= 1500: c["_pulls"].append(c["_pull"])
        def iqr_pct(a, ref=None):
            a = sorted(x for x in a if x is not None)
            if len(a) < 2: return None
            q1 = a[int(0.25 * (len(a) - 1))]; q3 = a[int(0.75 * (len(a) - 1))]; m = ref if ref is not None else a[len(a) // 2]
            return round(abs(q3 - q1) / abs(m) * 100, 2) if m else None
        pk_rpm = pk["rpm"] if pk else None
        thr = [p for p in c["_pulls"] if pk_rpm is not None and p["rpm_min"] <= pk_rpm - 250 and p["rpm_max"] >= pk_rpm + 250]   # pulls that sweep THROUGH the peak
        peaks = sorted(p["hp_max"] for p in thr)
        c["evidence"] = {"frames": c["live_frames"], "wot_frames": sum(len(v) for v in c["_gear"].values()), "boost_frames": c["_boost_n"],
                         "pulls": len(c["_pulls"]), "pulls_through_peak": len(thr), "peak_hp_per_pull": [round(p) for p in peaks][-8:], "peak_hp_iqr_pct": iqr_pct(peaks),
                         "boost_per_pull_iqr_pct": iqr_pct([p["boost_max"] for p in c["_pulls"] if p["boost_max"] > 0.5]),
                         "shift_n": len(c["_shift"]), "shift_iqr_pct": iqr_pct(c["_shift"]), "mass_n": len(c["_mass"]), "mass_iqr_pct": iqr_pct(c["_mass"]),
                         "gears": {int(g): {"n": len(v), "iqr_pct": iqr_pct(v)} for g, v in c["_gear"].items() if len(v) >= 25},
                         "top_gear": (max(c["_gear"]) if c["_gear"] else None), "top_gear_frames": (len(c["_gear"][max(c["_gear"])]) if c["_gear"] else 0)}
        c["sig"] = {"boost_max": round(c["_boost"], 1), "hp_peak": pk["hp"] if pk else None, "rpm_at_peak": pk["rpm"] if pk else None,
                    "tq_peak": max((d["tq"] for d in c["dyno"]), default=None), "gear_count": len(lad), "ladder": [g["rel"] for g in lad],
                    "mass_idx": round(statistics.median(c["_mass"])) if len(c["_mass"]) >= 15 else None, "shift_rpm": c["shift_rpm"]}
        key = f'{c["ordinal"]}|{c["drivetrain"]}|{c["cyl"]}|{c["pi"]}|{round(c["max_rpm"], -2)}|{len(lad)}|{",".join(f"{g["rel"]:.1f}" for g in lad)}|{round((c["sig"]["hp_peak"] or 0), -1)}'
        c["build_id"] = hashlib.md5(key.encode()).hexdigest()[:8]
        c["build_record"] = next((b for b in BUILDS if b.get("cid") == c["id"] and (not b.get("build_id") or b.get("build_id") == c["build_id"])), None)
        for k in ("_gear", "_dyno", "_k", "_boost", "_mass", "_shift", "_prev", "_pull", "_pulls", "_boost_n"): del c[k]
    sess["cars"] = sorted(cars.values(), key=lambda c: -c["live_frames"]); sess["segments"] = segments

    # ---- impacts / zero windows ----
    impacts = sorted({round(r["t"], 1) for r in live if abs(r["lat_g"]) > 3.0 or r["SmashableVelDiff"] > 0})
    sess["impacts"] = impacts[:200]
    zw = []; cur = None
    for r in rows:
        if r["IsRaceOn"] == 0 and cur is None: cur = r["t"]
        if r["IsRaceOn"] == 1 and cur is not None: zw.append([round(cur, 1), round(r["t"], 1)]); cur = None
    if cur is not None: zw.append([round(cur, 1), round(rows[-1]["t"], 1)])
    sess["zero_windows"] = [z for z in zw if z[1] - z[0] > 0.5]

    # ---- per-second strip ----
    strip = []; bysec = defaultdict(list)
    for r in rows: bysec[int(r["t"])].append(r)
    for s in range(int(dur) + 1):
        rs = bysec.get(s, [])
        if not rs: continue
        on = [r for r in rs if r["IsRaceOn"] == 1]
        if len(on) < len(rs) / 2: strip.append({"t": s, "state": "off"}); continue
        fr = max(max(abs(r["CombinedSlipFL"]), abs(r["CombinedSlipFR"])) for r in on)
        rr = max(max(abs(r["CombinedSlipRL"]), abs(r["CombinedSlipRR"])) for r in on)
        imp = any(abs(r["lat_g"]) > 3.0 or r["SmashableVelDiff"] > 0 for r in on)
        st = "impact" if imp else ("both" if fr > 1 and rr > 1 else "front" if fr > 1 else "rear" if rr > 1 else "calm")
        strip.append({"t": s, "state": st, "car": cid(on[-1]), "mph": round(statistics.median([r["speed_mph"] for r in on])), "f": round(fr, 2), "r": round(rr, 2), "g": round(max(abs(r["lat_g"]) for r in on), 2)})
    sess["strip"] = strip

    # ---- corners ----
    import bisect
    T_all = [r["t"] for r in live]
    lat = smooth([r["lat_g"] for r in live], 7); corners = []; i = 0; n = len(live)
    while i < n:
        if abs(lat[i]) > 0.35:
            j = i
            while j < n and abs(lat[j]) > 0.25: j += 1
            seg = live[i:j]; L = lat[i:j]
            if seg[-1]["t"] - seg[0]["t"] >= 0.8 and not any(abs(r["lat_g"]) > 3.0 for r in seg):
                sign = 1 if statistics.median(L) > 0 else -1
                peak = max(abs(x) for x in L)
                k80 = [k for k in range(len(L)) if abs(L[k]) >= 0.8 * peak]; k2, k4 = k80[0], k80[-1]
                pre = [r for r in live[max(0, i - 200):i] if r["t"] >= seg[0]["t"] - 1.5]
                def axle(rs):
                    f = max((max(abs(r["CombinedSlipFL"]), abs(r["CombinedSlipFR"])) for r in rs), default=0)
                    b = max((max(abs(r["CombinedSlipRL"]), abs(r["CombinedSlipRR"])) for r in rs), default=0)
                    return round(f, 2), round(b, 2)
                parts = [(1, pre), (2, seg[:k2 + 1]), (3, seg[k2:k4 + 1]), (4, seg[k4:])]
                phases = []; first = None
                for ph, rs in parts:
                    f, b = axle(rs); who = "both" if f > 1 and b > 1 else "front" if f > 1 else "rear" if b > 1 else "none"
                    if who != "none" and first is None:
                        tf = next((r["t"] for r in rs if max(abs(r["CombinedSlipFL"]), abs(r["CombinedSlipFR"])) > 1), None)
                        tr = next((r["t"] for r in rs if max(abs(r["CombinedSlipRL"]), abs(r["CombinedSlipRR"])) > 1), None)
                        first = {"phase": ph, "axle": ("front" if (tf is not None and (tr is None or tf <= tr)) else "rear")}
                    phases.append({"phase": ph, "front": f, "rear": b, "red": who, "dur": round((rs[-1]["t"] - rs[0]["t"]) if rs else 0, 2)})
                mid = seg[k2:k4 + 1]
                usi = statistics.mean([(abs(r["SlipAngleFL"]) + abs(r["SlipAngleFR"])) / 2 - (abs(r["SlipAngleRL"]) + abs(r["SlipAngleRR"])) / 2 for r in mid]) if mid else 0
                drift = statistics.mean([max(abs(r["CombinedSlipRL"]), abs(r["CombinedSlipRR"])) for r in seg]) > 2.5
                v_in = seg[0]["speed_mph"]; v_min = min(r["speed_mph"] for r in seg)
                ipk = max(range(len(L)), key=lambda kk: abs(L[kk])); apx = seg[ipk]
                # how this pass was DRIVEN: braking point (m before apex), throttle-on point (m after apex, negative = before), entry/exit speed & position, radius
                brk = next((r for r in pre + seg if r["Brake"] > 40 and r["t"] <= apx["t"]), None)
                imin = min(range(len(seg)), key=lambda kk: seg[kk]["speed_mph"])
                thr = next((r for r in seg[imin:] if r["Accel"] > 100), None)
                v_ms = apx["speed_mph"] * 0.44704; radius = round(v_ms * v_ms / max(0.1, peak * 9.81))
                corners.append({"t0": round(seg[0]["t"], 1), "t1": round(seg[-1]["t"], 1), "car": cid(seg[0]), "dir": "R" if sign > 0 else "L",
                                "apex": [round(apx["PosX"]), round(apx["PosZ"])], "dist": round(apx["DistanceTraveled"]), "mph_apex": round(apx["speed_mph"]),
                                "mph_in": round(v_in), "mph_min": round(v_min), "mph_out": round(seg[-1]["speed_mph"]), "lat_g_peak": round(peak, 2), "phases": phases, "first_red": first, "usi": round(usi, 3),
                                "entry": [round(seg[0]["PosX"]), round(seg[0]["PosZ"])], "exit": [round(seg[-1]["PosX"]), round(seg[-1]["PosZ"])],
                                "brake_on_m": (round(apx["DistanceTraveled"] - brk["DistanceTraveled"]) if brk else None), "throttle_on_m": (round(thr["DistanceTraveled"] - apx["DistanceTraveled"]) if thr else None), "radius_m": radius,
                                "drift": drift, "kink": v_min > 85 and peak < 0.9, "brake_max": max([r["Brake"] for r in pre + seg] or [0]), "hb": any(r["HandBrake"] > 0 for r in seg)})
            i = j
        else: i += 1
    sess["corners"] = corners
    # each car's measured GRIP (90th-pct peak lateral g over its non-drift corners) — the car-dependent factor that lets course geometry transfer between cars
    car_grip = {}
    for k_ in cars:
        gs = sorted(x["lat_g_peak"] for x in corners if x["car"] == k_ and not x["drift"])
        if len(gs) >= 5: car_grip[k_] = round(gs[int(0.9 * (len(gs) - 1))], 2)
    for k_, c_ in cars.items(): c_["grip_g"] = car_grip.get(k_)

    # ---- launches ----
    launches = []; i = 0
    while i < n - 10:
        r = live[i]
        if r["Speed"] < 0.8 and r["Accel"] > 200:
            j = i; t60 = None; trace = []; last_t = -1; k0 = cid(r)
            while j < n and live[j]["t"] - r["t"] < 12 and cid(live[j]) == k0:
                q = live[j]
                if q["t"] - last_t >= 0.1:
                    trace.append([round(q["t"] - r["t"], 2), round(q["SlipRatioFL"], 2), round(q["SlipRatioFR"], 2), round(q["SlipRatioRL"], 2), round(q["SlipRatioRR"], 2), round(q["speed_mph"], 1)]); last_t = q["t"]
                if t60 is None and q["speed_mph"] >= 60: t60 = q["t"] - r["t"]
                if q["Accel"] < 100 and q["speed_mph"] < 20: break
                j += 1
            if t60 or (trace and trace[-1][5] > 40):
                mv = [x for x in trace if x[5] > 5] or trace   # measure slip once rolling (> 5 mph); slip ratio explodes at v~0
                launches.append({"t": round(r["t"], 1), "car": k0, "zero60_s": round(t60, 2) if t60 else None,
                                 "peak_slip_rear": round(max(max(abs(x[3]), abs(x[4])) for x in mv), 2), "peak_slip_front": round(max(max(abs(x[1]), abs(x[2])) for x in mv), 2), "trace": trace[:120]})
            i = j + 1
        else: i += 1
    sess["launches"] = launches

    # ---- braking events (wheel-speed deficit) ----
    braking = []; i = 0
    while i < n:
        r = live[i]
        if r["Brake"] > 128 and r["speed_mph"] > 45:
            j = i; ev = []; k0 = cid(r)
            while j < n and live[j]["Brake"] > 60 and cid(live[j]) == k0: ev.append(live[j]); j += 1
            if ev and ev[-1]["t"] - ev[0]["t"] > 0.6:
                k = (cars.get(k0) or {}).get("k_wheel", {}); d = {w: 0.0 for w in W}
                for q in ev:
                    if q["Speed"] > 3:
                        for w in W:
                            kk = k.get(w)
                            if kk: d[w] = max(d[w], min(1.0, max(0.0, 1 - q["WheelRotSpeed" + w] / (kk * q["Speed"]))))
                fd = max(d["FL"], d["FR"]); rd = max(d["RL"], d["RR"])
                braking.append({"t": round(ev[0]["t"], 1), "car": k0, "mph_start": round(ev[0]["speed_mph"]), "mph_end": round(ev[-1]["speed_mph"]), "dur_s": round(ev[-1]["t"] - ev[0]["t"], 2),
                                "decel_g_peak": round(max(-q["long_g"] for q in ev), 2), "front_deficit": round(fd, 2), "rear_deficit": round(rd, 2),
                                "lock": "front" if fd > 0.35 and fd >= rd else "rear" if rd > 0.35 else "none"})
            i = j + 1
        else: i += 1
    sess["braking"] = braking

    # ---- bottoming / pulses ----
    bott = []
    for r in live:
        for w in W:
            if r["NormSusp" + w] > 0.95 and (not bott or r["t"] - bott[-1]["t"] > 1.0 or bott[-1]["wheel"] != w):
                bott.append({"t": round(r["t"], 1), "car": cid(r), "wheel": w, "travel": round(r["NormSusp" + w], 3), "mph": round(r["speed_mph"])})
    sess["bottoming"] = bott[:200]
    pulses = []; i = 0
    while i < n - 50:
        r = live[i]
        if r["speed_mph"] > 55 and abs(r["Steer"]) > 30 and r["Brake"] < 20:
            j = i
            while j < n and abs(live[j]["Steer"]) > 8 and live[j]["t"] - r["t"] < 1.0: j += 1
            if j < n and live[j]["t"] - r["t"] < 1.0:
                yr0 = abs(live[j]["yaw_rate_dps"]); k = j; tdec = None
                while k < n and live[k]["t"] - live[j]["t"] < 4 and abs(live[k]["Steer"]) < 12:
                    if abs(live[k]["yaw_rate_dps"]) < max(2.0, 0.2 * yr0): tdec = live[k]["t"] - live[j]["t"]; break
                    k += 1
                if yr0 > 8: pulses.append({"t": round(r["t"], 1), "car": cid(r), "mph": round(r["speed_mph"]), "yaw_peak_dps": round(yr0, 1), "decay_s": round(tdec, 2) if tdec is not None else None})
                i = k + 1; continue
        i += 1
    sess["pulses"] = pulses

    # ---- per-stint signatures (A/B between re-tunes of the same configuration) ----
    for ev_list in (corners, launches, braking):
        for ev in ev_list:
            i = bisect.bisect_left(T_all, ev.get("t0", ev.get("t")))
            ev["stint"] = live[min(i, n - 1)]["stint"] if n else None
    stints = []
    for sn in sorted(stint_rows):
        rs = stint_rows[sn]; k = cid(rs[0])
        gl = defaultdict(list)
        for r in rs:
            if r["Accel"] > 230 and r["CurrentEngineRpm"] > 2500 and r["Speed"] > 5 and 1 <= r["Gear"] <= 10: gl[r["Gear"]].append(r["Speed"] / r["CurrentEngineRpm"])
        lad = {}   # gear -> m/s per krpm (absolute; 1st is too noisy to be a reference)
        for g in sorted(gl):
            if len(gl[g]) < 30 or g == 1: continue
            lad[str(g)] = round(statistics.median(gl[g]) * 1000, 3)
        sc = [c for c in corners if c.get("stint") == sn and not c["drift"]]; sb = [b for b in braking if b.get("stint") == sn and b["mph_start"] >= 60]; sl = [l for l in launches if l.get("stint") == sn]
        med = lambda a: (sorted(a)[len(a) // 2] if a else None)
        _tg = tags.get(str(sn)) if isinstance(tags.get(str(sn)), dict) else ({"label": tags.get(str(sn))} if tags.get(str(sn)) else {})
        st = {"n": sn, "id": k, "t0": round(rs[0]["t"], 1), "t1": round(rs[-1]["t"], 1), "live_s": round((rs[-1]["t"] - rs[0]["t"]), 1),
              "label": _tg.get("label"), "role": _tg.get("role"),
              "corners": len(sc), "launches": len(sl), "braking": len(sb), "usi_med": med([c["usi"] for c in sc]), "first_red_front": sum(1 for c in sc if c["first_red"] and c["first_red"]["axle"] == "front"),
              "brake_fd_med": med([b["front_deficit"] for b in sb]), "brake_rd_med": med([b["rear_deficit"] for b in sb]), "launch_rear_slip": med([l["peak_slip_rear"] for l in sl]),
              "ladder": lad, "ladder_changed": None}
        prev = next((x for x in reversed(stints) if x["id"] == k and x["ladder"]), None)
        if prev and lad:
            common = [g for g in lad if g in prev["ladder"]]
            st["ladder_changed"] = (any(abs(lad[g] - prev["ladder"][g]) / prev["ladder"][g] > 0.04 for g in common) if common else None)
        stints.append(st)
    sess["stints"] = stints
    # ---- events (timed modes) + route keys: CurrentLap>0 marks races / Rivals / time trials; free roam otherwise ----
    routes = {}
    try:
        with open(os.path.join(ROOT, "data", "routes.json"), encoding="utf-8") as f: routes = json.load(f).get("routes", {})
    except Exception: routes = {}
    events = []; cur_ev = None; last_t = None
    for r in live:
        inev = r["CurrentLap"] > 0 or r["RacePosition"] > 0
        if inev:
            if cur_ev is None or (last_t is not None and r["t"] - last_t > 2.0):
                if cur_ev: events.append(cur_ev)
                cur_ev = {"rows": [r]}
            else: cur_ev["rows"].append(r)
            last_t = r["t"]
        elif cur_ev is not None and last_t is not None and r["t"] - last_t > 2.0:
            events.append(cur_ev); cur_ev = None
    if cur_ev: events.append(cur_ev)
    # re-join fragments of ONE event split by a pause / menu gap: the lap counter and the odometer CONTINUE across the gap; a restart resets both
    joined = []
    for ev in events:
        if joined:
            pl = joined[-1]["rows"][-1]; nf = ev["rows"][0]; gap = nf["t"] - pl["t"]; dd = nf["DistanceTraveled"] - pl["DistanceTraveled"]
            # same attempt iff the odometer CONTINUES across the gap (a pause / menu / checkpoint respawn keeps it; a restart or a new event resets it to ~0) and the lap counter didn't reset
            lapped_cont = nf["LapNumber"] > 0 and nf["LapNumber"] >= pl["LapNumber"]   # a lapped circuit keeps counting laps — the car may have kept lapping while the flag dropped
            if cid(nf) == cid(pl) and nf["LapNumber"] >= pl["LapNumber"] and (-50 <= dd <= 150 or (lapped_cont and -50 <= dd <= max(150.0, 25.0 * gap))):
                joined[-1]["rows"].extend(ev["rows"]); continue
        joined.append(ev)
    events = joined
    # ---- ROUTE ATTRIBUTION: a route is identified by where it starts, which way it heads and how long it is — never by a rounded grid cell.
    #      Restarts a few metres apart, different grid slots and slightly different start triggers are the SAME route (the registry persists in data/routes.json).
    write_side = "_replay_analysis" not in os.path.abspath(outdir)
    _mp_cache = {}
    def model_path_for(k):
        if k in _mp_cache: return _mp_cache[k]
        p = os.path.join(ROOT, "data", "courses", re.sub(r"[^A-Za-z0-9_.-]+", "_", k) + ".json"); pts = None
        try:
            if os.path.exists(p):
                with open(p, encoding="utf-8") as f: pts = ((json.load(f).get("geometry") or {}).get("path")) or None
        except Exception: pts = None
        if pts:
            cells = {}
            for x, z in pts: cells.setdefault((int(x // 30), int(z // 30)), []).append((x, z))
            _mp_cache[k] = (cells, pts)
        else: _mp_cache[k] = None
        return _mp_cache[k]
    def direction_agree(sample, pts):   # do consecutive event samples advance ALONG the route path (same direction) or against it (a reversed route)?
        if not pts or len(sample) < 6: return True
        n = len(pts); idx = []
        for x, z in sample[:: max(1, len(sample) // 60)]:
            j = min(range(n), key=lambda i_: (pts[i_][0] - x) ** 2 + (pts[i_][1] - z) ** 2)
            if (pts[j][0] - x) ** 2 + (pts[j][1] - z) ** 2 <= 60 ** 2: idx.append(j)
        if len(idx) < 4: return True
        fwd = back = 0
        for a, b in zip(idx, idx[1:]):
            d = ((b - a + n // 2) % n) - n // 2
            if d > 0: fwd += 1
            elif d < 0: back += 1
        return fwd >= 1.5 * back
    def _near(x, z, cells):
        cx, cz = int(x // 30), int(z // 30)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for px, pz in cells.get((cx + dx, cz + dz), ()):
                    if (px - x) ** 2 + (pz - z) ** 2 <= 30 ** 2: return True
        return False
    def overlap(sample, mp):   # (ov, cov): share of this event's samples on the known path · share of the known path covered by this event
        if not mp or not sample: return None, None
        cells, pts = mp
        ov = sum(1 for x, z in sample if _near(x, z, cells)) / len(sample)
        scells = {}
        for x, z in sample: scells.setdefault((int(x // 30), int(z // 30)), []).append((x, z))
        cov = sum(1 for x, z in pts if _near(x, z, scells)) / max(1, len(pts))
        return ov, cov
    def attribute_route(sx, sz, hdg, dist, sample):
        best = None
        for k, R in routes.items():
            if k.startswith("loop:") or not R.get("start"): continue
            d0 = math.hypot(sx - R["start"][0], sz - R["start"][1])
            mp = model_path_for(k); ov, cov = overlap(sample, mp)
            # 1) PATH match: this event runs along the known route's path in the same direction — the start can be ANYWHERE on it (a circuit resumed mid-lap, a fragment)
            if ov is not None and ov >= 0.7 and direction_agree(sample, mp[1]):
                cand = (200 + d0 * 0.01, k)
                if best is None or cand[0] < best[0]: best = cand
                continue
            if d0 > 250: continue
            # 2) START match: close start + same heading; the known path (if any) must agree — either this event lies on it (ov) or it covers it (cov: the known path was a stub from an aborted attempt)
            hR = R.get("heading")
            if hR and hdg and (R.get("length_m") or 0) >= 200 and (hR[0] * hdg[0] + hR[1] * hdg[1]) < 0.3: continue   # heads the other way = a different (reversed) route
            path_ok = (ov is None) or ov >= 0.5 or (cov is not None and cov >= 0.8)
            if d0 <= 40 and (R.get("length_m") or 0) < 600: cand = (d0, k)   # the SAME start point and the registered route is only a stub (aborted attempts) — it is this route
            elif d0 <= 120 and path_ok: cand = (d0, k)
            elif d0 <= 250 and ov is not None and ov >= 0.7: cand = (d0 + 100, k)
            else: continue
            if best is None or cand[0] < best[0]: best = cand
        return best[1] if best else None
    ev_out = []
    for ev in events:
        rs = ev["rows"]
        if rs[-1]["t"] - rs[0]["t"] < 5: continue
        start = next((q for q in rs if q["DistanceTraveled"] >= 0), rs[0])
        sx, sz = start["PosX"], start["PosZ"]; ex, ez = rs[-1]["PosX"], rs[-1]["PosZ"]
        dvals = [q["DistanceTraveled"] for q in rs]; dist = max(dvals) - max(0.0, min(dvals)); laps = max(q["LapNumber"] for q in rs)   # odometer may be cumulative — length = what THIS event covered
        pos = [q["RacePosition"] for q in rs if q["RacePosition"] > 0]
        mode = "race" if (pos and (max(pos) > 1 or len(set(pos)) > 1)) else "timed solo (Rivals / time trial)"
        if laps > 0: mode += " · lapped"
        h_row = next((q for q in rs if q["DistanceTraveled"] >= start["DistanceTraveled"] + 100), rs[-1])
        hv = (h_row["PosX"] - sx, h_row["PosZ"] - sz); hn = math.hypot(*hv); hdg = [round(hv[0] / hn, 3), round(hv[1] / hn, 3)] if hn > 1 else None
        sample = [(q["PosX"], q["PosZ"]) for q in rs[::max(1, len(rs) // 200)]]
        key = attribute_route(sx, sz, hdg, dist, sample)
        if key is None:
            key = f"{int(round(sx / 50) * 50)}_{int(round(sz / 50) * 50)}"
            if key in routes and routes[key].get("start"): key = f"{key}_{len(routes)}"   # a genuinely different route that rounds to an occupied cell
            routes[key] = dict(routes.get(key) or {}, start=[round(sx), round(sz)], heading=hdg, length_m=round(dist), events=0, first_seen=sid)
        R = routes[key]; R["events"] = R.get("events", 0) + 1; R["length_m"] = max(R.get("length_m") or 0, round(dist)); R["last_seen"] = sid
        if not R.get("heading") and hdg: R["heading"] = hdg
        ev_out.append({"t0": round(rs[0]["t"], 1), "t1": round(rs[-1]["t"], 1), "car": cid(rs[0]), "stint": rs[0].get("stint"), "mode": mode, "laps": laps,
                       "best_lap": round(max((q["BestLap"] for q in rs), default=0), 3) or None, "last_lap": round(max((q["LastLap"] for q in rs), default=0), 3) or None,
                       "distance_m": round(dist), "duration_s": round(rs[-1]["t"] - rs[0]["t"], 1), "pos_final": pos[-1] if pos else None,
                       "start": [round(sx), round(sz)], "end": [round(ex), round(ez)], "route_key": key, "route": (routes.get(key) or {}).get("name")})
    # persist the route registry (names on disk win — the dashboard / daemon may have named a route while this analysis ran)
    if write_side:
        try:
            rpath = os.path.join(ROOT, "data", "routes.json"); cur = {}
            if os.path.exists(rpath):
                with open(rpath, encoding="utf-8") as f: cur = json.load(f)
            disk = cur.get("routes", {}) if isinstance(cur, dict) else {}
            for k, v in routes.items():
                base = dict(disk.get(k) or {})
                for kk, vv in v.items():
                    if kk != "name": base[kk] = vv
                if v.get("name") and not base.get("name"): base["name"] = v["name"]
                disk[k] = base
            out_r = {"schema_version": "1.1.0", "purpose": "Route registry. A route = canonical start [x,z] + heading + length (+ its course model path once learned). New events are ATTRIBUTED to the nearest known route when the start is within ~120 m (250 m with path overlap), the heading agrees (a reversed circuit is a different route) and the length fits — so restarts and grid-slot offsets never split a route. Name a route once from the dashboard.", "routes": disk}
            with open(rpath, "w", encoding="utf-8") as f: json.dump(out_r, f, indent=1, ensure_ascii=False)
        except Exception as ex_: print("route registry not saved:", repr(ex_), file=sys.stderr)

    # ---- reference loops: user-defined free-roam test circuits. Each pass through the start point = one lap (a synthetic event). ----
    loops = {}
    try:
        with open(os.path.join(ROOT, "data", "reference-loops.json"), encoding="utf-8") as f: loops = json.load(f).get("loops", {})
    except Exception: loops = {}
    for lname, lp in loops.items():
        lx, lz = lp["start"]; R = lp.get("radius", 60); MIND = lp.get("min_dist", 250)
        # collect crossings: a lap = leave the radius (travel > MIND from start), then return within radius
        state = "start"; lap_rows = []; away_dist = 0; prev = None; passes = []
        for r in live:
            d0 = math.hypot(r["PosX"] - lx, r["PosZ"] - lz)
            if state == "start":
                if d0 <= R: lap_rows = [r]; state = "in"; away_dist = 0
            elif state == "in":
                lap_rows.append(r)
                if prev is not None: away_dist += math.hypot(r["PosX"] - prev["PosX"], r["PosZ"] - prev["PosZ"])
                if away_dist > MIND and d0 <= R:   # completed a loop
                    passes.append(lap_rows); lap_rows = [r]; away_dist = 0
                elif r["t"] - lap_rows[0]["t"] > 600:   # safety: abandon a stuck lap
                    lap_rows = [r]; away_dist = 0
            prev = r
        for i, rs in enumerate(passes, 1):
            if rs[-1]["t"] - rs[0]["t"] < 5: continue
            ev_out.append({"t0": round(rs[0]["t"], 1), "t1": round(rs[-1]["t"], 1), "car": cid(rs[0]), "stint": rs[0].get("stint"),
                           "mode": "reference loop", "laps": 1, "lap_index": i,
                           "best_lap": round(rs[-1]["t"] - rs[0]["t"], 3), "last_lap": round(rs[-1]["t"] - rs[0]["t"], 3),
                           "distance_m": round(sum(math.hypot(rs[j]["PosX"] - rs[j - 1]["PosX"], rs[j]["PosZ"] - rs[j - 1]["PosZ"]) for j in range(1, len(rs)))),
                           "duration_s": round(rs[-1]["t"] - rs[0]["t"], 1), "pos_final": None,
                           "start": [round(rs[0]["PosX"]), round(rs[0]["PosZ"])], "end": [round(rs[-1]["PosX"]), round(rs[-1]["PosZ"])],
                           "route_key": "loop:" + lname, "route": lname})
    sess["events"] = ev_out
    # ---- crests, top-speed pull, warm tires, temps medians, coverage + advice per config ----
    crests = []; top_pull = defaultdict(float); warm_n = defaultdict(int); temps_acc = defaultdict(lambda: {w: [] for w in W})
    prev_t = None
    for r in live:
        k = cid(r)
        if r["AccelY"] < -0.5 * G and r["speed_mph"] > 50 and (not crests or r["t"] - crests[-1]["t"] > 1.5 or crests[-1]["car"] != k):
            crests.append({"t": round(r["t"], 1), "car": k, "mph": round(r["speed_mph"]), "g": round(r["AccelY"] / G, 2)})
        c = cars.get(k)
        if c and c["gears"] and r["Gear"] == max(g["gear"] for g in c["gears"]) and r["Accel"] > 230 and prev_t is not None: top_pull[k] += max(0.0, min(0.2, r["t"] - prev_t))
        if all(r["TireTempF" + w] > 150 for w in W): warm_n[k] += 1
        for w in W: temps_acc[k][w].append(r["TireTempF" + w])
        prev_t = r["t"]
    sess["crests"] = crests[:100]
    warm_frac = {k: warm_n[k] / max(1, c["live_frames"]) for k, c in cars.items()}
    temps_med = {k: {w: statistics.median(v[w]) for w in W} for k, v in temps_acc.items() if v["FL"]}
    for c in sess["cars"]:
        c["coverage"] = coverage_for(c["id"], cars, corners, launches, braking, crests, pulses, top_pull, warm_frac)
        c["advice"] = advice_for(c["id"], cars, corners, launches, braking, bott, c["coverage"], temps_med)
        c["decode"] = decode_battery_for(c["id"], cars, corners, launches, braking, crests, pulses, top_pull)
        c["clone_sheet"] = clone_sheet_for(c, c["decode"])
        c["temps_med_f"] = {w: round(v) for w, v in temps_med.get(c["id"], {}).items()}
    # ---- course mode: per route family, scope coverage + advice to the event windows, attach per-run lap times ----
    COURSE_PROBES = [("hairpin", "Hairpins", 3), ("medium", "Medium corners", 3), ("fast", "Fast sweepers", 3), ("flick", "Chicane flicks", 2), ("launch", "Standing starts", 2), ("brake", "Hard stops from 80+", 3), ("crest", "Crests", 2)]
    courses = {}
    for e in ev_out:
        if e["duration_s"] < 15 or e["distance_m"] < 300: continue   # aborted starts / restarts don't make a course
        co = courses.setdefault(e["route_key"], {"route_key": e["route_key"], "name": e["route"], "events": [], "cars": []})
        lab = next((st["label"] for st in stints if st["n"] == e.get("stint")), None)
        co["events"].append({"t0": e["t0"], "t1": e["t1"], "car": e["car"], "stint": e.get("stint"), "label": lab, "laps": e["laps"], "best_lap": e["best_lap"], "last_lap": e["last_lap"], "duration_s": e["duration_s"], "distance_m": e["distance_m"], "mode": e["mode"], "pos_final": e["pos_final"]})
        if e["car"] not in co["cars"]: co["cars"].append(e["car"])
    def inwin(t, evs): return any(ev["t0"] <= t <= ev["t1"] for ev in evs)
    course_out = []
    for key, co in courses.items():
        evs = co["events"]; nev = len(evs)
        cc = [c for c in corners if inwin(c["t0"], evs) and not c["drift"]]; ll = [l for l in launches if inwin(l["t"], evs)]; bb = [b for b in braking if inwin(b["t"], evs)]; cr = [x for x in crests if inwin(x["t"], evs)]
        counts = {"hairpin": sum(1 for c in cc if c["mph_min"] < 45), "medium": sum(1 for c in cc if 45 <= c["mph_min"] <= 85), "fast": sum(1 for c in cc if c["mph_min"] > 85),
                  "flick": sum(1 for a, b in zip(cc, cc[1:]) if a["dir"] != b["dir"] and 0 <= b["t0"] - a["t1"] <= 2.5), "launch": len(ll), "brake": sum(1 for b in bb if b["mph_start"] >= 80), "crest": len(cr)}
        probes = []; num = den = 0.0
        for k, label, req in COURSE_PROBES:
            nk = counts[k]; present = (nk / max(nev, 1)) >= 0.5 or nk >= 2
            if present:
                conf = strength(nk, req); ready = nk >= req
                probes.append({"key": k, "label": label, "count": nk, "required": req, "confidence": round(conf, 2), "ready": ready, "present": True, "hint": (f"{max(0, req - nk)} more on this course" if not ready else ("saturated" if conf >= 0.97 else "verdict-ready — more laps sharpen it"))})
                num += conf; den += 1
            else:
                probes.append({"key": k, "label": label, "count": nk, "required": req, "confidence": None, "ready": False, "present": False, "hint": "not on this course"})
        best = min((e["best_lap"] for e in evs if e["best_lap"]), default=None)
        for e in evs: e["delta_s"] = round(e["best_lap"] - best, 3) if (best and e["best_lap"]) else None
        # ---- decode battery: the full set of telemetry tests a build decode needs, scoped to this course's windows ----
        loop_rows = [r for r in live if inwin(r["t"], evs)]
        car0 = cars.get(co["cars"][0]) if co["cars"] else {}
        gl = defaultdict(int); rpm_bins = set(); top_s = 0.0; prevt = None; wig = 0
        for r in loop_rows:
            if r["Accel"] > 230 and r["CurrentEngineRpm"] > r["EngineIdleRpm"] + 1200 and r["Speed"] > 5 and 1 <= r["Gear"] <= 10:
                gl[r["Gear"]] += 1; rpm_bins.add(int(r["CurrentEngineRpm"] // 250) * 250)
                if car0.get("gears") and r["Gear"] == max((g["gear"] for g in car0["gears"]), default=99) and prevt is not None: top_s += max(0.0, min(0.2, r["t"] - prevt))
            prevt = r["t"]
        pulses_here = [p for p in pulses if inwin(p["t"], evs) and p["car"] in co["cars"]]; wig = len(pulses_here)
        mx = max((g["gear"] for g in (car0.get("gears") or [])), default=0)
        dbins = dyno_band(car0)
        DB_TESTS = [
            ("launch", "Standing launch", counts["launch"], 1, "launch → mass, diff center split, accel spin"),
            ("gears", "Full gear ladder", sum(1 for g in gl if gl[g] >= 15), max(mx, 1), "WOT time in every gear → gearing tab"),
            ("dyno", "Dyno rev sweep", sum(1 for b in dbins if b in rpm_bins), len(dbins), "full-throttle through the rev range → engine/aspiration curve"),
            ("top", "Top-speed pull", 1 if top_s >= 4 else 0, 1, "hold top gear WOT 5 s → drag / final drive"),
            ("brake", "Hard stop 80+", counts["brake"], 2, "threshold brake → balance, lock, decel diff"),
            ("hairpin", "Hairpin", counts["hairpin"], 1, "low-speed mech balance"),
            ("medium", "Medium corner", counts["medium"], 1, "mid-speed balance"),
            ("fast", "Fast sweeper", counts["fast"], 1, "high-speed / aero balance"),
            ("crest", "Crest / bump", counts["crest"], 1, "spring & damper behaviour"),
            ("wiggle", "Steering pulse", wig, 3, "yaw damping (experimental)"),
        ]
        db = []; ready = 0
        for k, label, have, need, why in DB_TESTS:
            ok_ = have >= need; ready += 1 if ok_ else 0
            db.append({"key": k, "label": label, "have": have, "need": need, "ok": ok_, "why": why})
        decode = {"ready_n": ready, "total": len(DB_TESTS), "pct": round(ready / len(DB_TESTS), 2), "missing": [t["label"] for t in db if not t["ok"]], "tests": db}
        profile = course_profile(loop_rows, cc, bb, ll, car0)
        advice_by_car = {}
        for cid_ in co["cars"]:
            cov_stub = {"overall": round(num / den, 2) if den else 0.0, "probes": probes}
            advice_by_car[cid_] = advice_for(cid_, cars, cc, ll, bb, [x for x in bott if inwin(x["t"], evs)], cov_stub, temps_med, profile)
        # ---- lap bookkeeping: a LAP = one pass of the course. Loop passes / sprints = the event itself; lapped events split on LapNumber changes ----
        lap_windows = []
        for ei, ev in enumerate(evs):
            rows_ev = [r for r in loop_rows if ev["t0"] <= r["t"] <= ev["t1"]]
            k_ = 0; t_start = ev["t0"]; cur_lap = rows_ev[0]["LapNumber"] if rows_ev else None
            for r in rows_ev:
                if r["LapNumber"] != cur_lap:
                    k_ += 1; lap_windows.append({"ev": ei, "lap": k_, "t0": round(t_start, 1), "t1": round(r["t"], 1)}); t_start = r["t"]; cur_lap = r["LapNumber"]
            k_ += 1; lap_windows.append({"ev": ei, "lap": k_, "t0": round(t_start, 1), "t1": ev["t1"]})
        lw_full = [w for w in lap_windows if w["t1"] - w["t0"] >= 15]   # the stub after a finish line is not a lap
        lap_windows = lw_full or lap_windows
        total_laps = len(lap_windows)
        def lap_of(t):
            for li, w in enumerate(lap_windows):
                if w["t0"] - 0.05 <= t <= w["t1"] + 0.05: return li
            return None
        lapmap = {id(c): lap_of(c["t0"]) for c in cc}
        # ---- GEOMETRIC course learning from COORDINATES: the path IS the course. Resample the reference lap by arc length, heading -> curvature,
        #      turns = curvature peaks (radius, length, direction, apex/entry/exit) — independent of how hard you drove them. ----
        def lap_pts(w): return [(r["PosX"], r["PosZ"], r["speed_mph"]) for r in loop_rows if w["t0"] <= r["t"] <= w["t1"]]
        def resample(pts, step=4.0):
            if len(pts) < 3: return []
            S = [0.0]
            for a, b in zip(pts, pts[1:]): S.append(S[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
            if S[-1] < step * 5: return []
            out = []; j = 0; s_ = 0.0
            while s_ <= S[-1]:
                while j < len(S) - 2 and S[j + 1] < s_: j += 1
                seg_len = S[j + 1] - S[j]; f = (s_ - S[j]) / seg_len if seg_len > 0 else 0.0
                out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f, s_, pts[j][2] + (pts[j + 1][2] - pts[j][2]) * f))
                s_ += step
            return out
        def curvature(P, step=4.0, win=7):
            th = [math.atan2(b[1] - a[1], b[0] - a[0]) for a, b in zip(P, P[1:])]
            for i_ in range(1, len(th)):
                while th[i_] - th[i_ - 1] > math.pi: th[i_] -= 2 * math.pi
                while th[i_] - th[i_ - 1] < -math.pi: th[i_] += 2 * math.pi
            ths = smooth(th, win) if len(th) >= win else th
            return [(ths[i_ + 1] - ths[i_ - 1]) / (2 * step) for i_ in range(1, len(ths) - 1)]   # rad/m at P[i_+1]
        geo = None
        full_laps = [w for w in lap_windows if (w["t1"] - w["t0"]) >= 15]
        if full_laps:
            ref_w = max(full_laps, key=lambda w: sum(1 for r in loop_rows if w["t0"] <= r["t"] <= w["t1"]))
            P = resample(lap_pts(ref_w))
            if len(P) >= 20:
                K = curvature(P); thr = 1.0 / 250.0; gturns = []; i_ = 0
                while i_ < len(K):
                    if abs(K[i_]) > thr:
                        j_ = i_
                        while j_ < len(K) and abs(K[j_]) > thr * 0.6: j_ += 1
                        if (j_ - i_) >= 4:
                            ia = max(range(i_, j_), key=lambda q: abs(K[q])); gturns.append({"i0": i_ + 1, "i1": min(j_, len(P) - 1), "ia": ia + 1, "k": abs(K[ia]), "sgn": 1 if K[ia] > 0 else -1})
                        i_ = j_
                    else: i_ += 1
                merged = []
                for g in gturns:   # merge near-contiguous same-direction pieces (a wobble inside one turn)
                    if merged and g["i0"] - merged[-1]["i1"] <= 3 and g["sgn"] == merged[-1]["sgn"]:
                        m_ = merged[-1]; m_["i1"] = g["i1"]
                        if g["k"] > m_["k"]: m_["k"] = g["k"]; m_["ia"] = g["ia"]
                    else: merged.append(dict(g))
                votes = 0   # calibrate the L/R sign convention against the behavioural corners (lat-g sign) by majority vote
                for g in merged:
                    ax, az = P[g["ia"]][0], P[g["ia"]][1]
                    for c in cc:
                        if c.get("apex") and math.hypot(c["apex"][0] - ax, c["apex"][1] - az) <= 40: votes += (1 if ((c["dir"] == "R") == (g["sgn"] > 0)) else -1)
                flip = votes < 0; gt_out = []
                def heading(i_): a, b = P[max(0, i_ - 1)], P[min(len(P) - 1, i_ + 1)]; return math.atan2(b[1] - a[1], b[0] - a[0])
                for g in merged:
                    dth = heading(g["i1"]) - heading(g["i0"])
                    while dth > math.pi: dth -= 2 * math.pi
                    while dth < -math.pi: dth += 2 * math.pi
                    g["deg"] = round(abs(math.degrees(dth)))
                merged = [g for g in merged if g["deg"] >= 12]   # a gentle bend (< 12° of heading change) is not a turn
                for n_, g in enumerate(merged, 1):
                    gt_out.append({"id": f"G{n_}", "apex": [round(P[g["ia"]][0]), round(P[g["ia"]][1])], "s": round(P[g["ia"]][2]), "radius_m": round(1.0 / g["k"]), "dir": ("R" if (g["sgn"] > 0) != flip else "L"), "deg": g["deg"],
                                   "len_m": round((g["i1"] - g["i0"]) * 4.0), "entry": [round(P[g["i0"]][0]), round(P[g["i0"]][1])], "exit": [round(P[g["i1"]][0]), round(P[g["i1"]][1])], "speed_ref_lap": round(P[g["ia"]][3])})
                sd_ = max(1, len(P) // 500)
                geo = {"length_m": round(P[-1][2]), "ref_lap": {"ev": ref_w["ev"], "lap": ref_w["lap"], "t0": ref_w["t0"], "t1": ref_w["t1"]}, "path": [[round(p[0]), round(p[1])] for p in P[::sd_]], "turns": gt_out}
                lw_last = max(full_laps, key=lambda w: w["t1"]); PL = resample(lap_pts(lw_last))
                if PL: geo["last_path"] = [[round(p[0]), round(p[1])] for p in PL[::max(1, len(PL) // 500)]]; geo["last_lap"] = {"ev": lw_last["ev"], "lap": lw_last["lap"], "t0": lw_last["t0"], "t1": lw_last["t1"]}
        def geo_near(x, z):
            if not geo: return None
            return next((g["id"] for g in geo["turns"] if math.hypot(g["apex"][0] - x, g["apex"][1] - z) <= max(60, g["len_m"] / 2 + 20)), None)   # anywhere within the turn's span
        # corner identity: cluster this course's corners by apex position (40 m), order along the route, aggregate per physical corner
        clusters = []
        for c in sorted(cc, key=lambda c: c["t0"]):
            ax, az = c.get("apex", [None, None])
            if ax is None: continue
            hit = next((cl for cl in clusters if (cl["x"] - ax) ** 2 + (cl["z"] - az) ** 2 <= 40 ** 2), None)
            if hit: hit["members"].append(c); k_ = len(hit["members"]); hit["x"] += (ax - hit["x"]) / k_; hit["z"] += (az - hit["z"]) / k_
            else: clusters.append({"x": ax, "z": az, "members": [c]})
        def med(a): a = sorted(a); return a[len(a) // 2] if a else None
        clusters.sort(key=lambda cl: med([m["dist"] for m in cl["members"]]) or 0)
        # ---- turn count that EARNS confidence across laps. A badly taken turn often fragments into 2-3 detections; a real turn shows up on most laps.
        def lap_stats(cl):
            lh = defaultdict(int)
            for m in cl["members"]:
                li = lapmap.get(id(m))
                if li is not None: lh[li] += 1
            cl["laps_seen"] = len(lh); cl["presence"] = round(len(lh) / total_laps, 2) if total_laps else 0.0
            cl["multi"] = round(sum(1 for v in lh.values() if v >= 2) / max(1, len(lh)), 2)   # share of its laps where this turn was detected MORE than once = taken messily
            cl["per_lap"] = [lh.get(li, 0) for li in range(total_laps)]
        for cl in clusters: lap_stats(cl)
        strong = [cl for cl in clusters if cl["presence"] >= 0.5]; weak = [cl for cl in clusters if cl["presence"] < 0.5]; possible = []
        for cl in weak:   # a low-presence cluster within 80 m (along the route) of a strong turn is a FRAGMENT of it — absorbed; otherwise a 'possible' turn
            d_cl = med([m["dist"] for m in cl["members"]]) or 0
            near = min(strong, key=lambda s_: abs((med([m["dist"] for m in s_["members"]]) or 0) - d_cl), default=None)
            if near is not None and abs((med([m["dist"] for m in near["members"]]) or 0) - d_cl) <= 80: near["members"] = near["members"] + cl["members"]; near["absorbed"] = near.get("absorbed", 0) + len(cl["members"])
            else: possible.append(cl)
        for cl in strong: lap_stats(cl)
        strong.sort(key=lambda cl: med([m["dist"] for m in cl["members"]]) or 0); possible.sort(key=lambda cl: med([m["dist"] for m in cl["members"]]) or 0)
        for i, cl in enumerate(strong, 1): cl["cid"] = f"C{i}"; cl["status"] = "turn"
        for i, cl in enumerate(possible, 1): cl["cid"] = f"?{i}"; cl["status"] = "possible"
        clusters = strong + possible
        per_lap_det = [sum(1 for c in cc if lapmap.get(id(c)) == li) for li in range(total_laps)]
        messy = [cl["cid"] for cl in strong if cl["multi"] >= 0.34]
        conf_laps = strength(total_laps, 3)   # 0.33 at 1 lap · 0.55 at 2 · 0.70 at 3 · 0.91 at 6
        agree = 1.0 - 0.5 * (len(possible) / max(1, len(strong) + len(possible))) - 0.3 * (sum(cl["multi"] for cl in strong) / max(1, len(strong)))
        turn_conf = round(conf_laps * max(0.3, agree), 2)
        turns_info = {"count": len(strong), "possible": len(possible), "confidence": turn_conf, "laps": total_laps, "per_lap_detections": per_lap_det, "messy": messy,
                      "note": (f"{total_laps} lap{'s' if total_laps != 1 else ''} — drive {max(0, 3 - total_laps)} more to confirm the turn count" if total_laps < 3 else "turn count confirmed across laps" if not possible else f"{len(possible)} possible turn{'s' if len(possible) != 1 else ''} seen on a minority of laps — keep lapping to confirm or drop them") + (f" · {', '.join(messy)} often split into several detections (taken inconsistently)" if messy else "")}
        laps_info = {"total": total_laps, "windows": lap_windows, "per_event": [sum(1 for w in lap_windows if w["ev"] == ei) for ei in range(len(evs))]}
        # ---- COURSE MODEL (persistent, data/courses/<route>.json): what each turn IS — geometry + the best clean execution ever seen on it, across sessions ----
        mdir = os.path.join(ROOT, "data", "courses"); mpath = os.path.join(mdir, re.sub(r"[^A-Za-z0-9_.-]+", "_", key) + ".json")
        write_models = "_replay_analysis" not in os.path.abspath(outdir)
        model = {"route_key": key, "name": co["name"], "turns": [], "laps": 0, "sessions": [], "updated": None}
        try:
            if os.path.exists(mpath):
                with open(mpath, encoding="utf-8") as f: model = json.load(f)
        except Exception: pass
        def mturn_for(cl):   # model turn within 40 m of this cluster's apex
            return next((t for t in model["turns"] if (t["pos"][0] - cl["x"]) ** 2 + (t["pos"][1] - cl["z"]) ** 2 <= 40 ** 2), None)
        def pass_view(m):
            return {"mph_in": m["mph_in"], "mph_min": m["mph_min"], "mph_out": m.get("mph_out"), "brake_on_m": m.get("brake_on_m"), "throttle_on_m": m.get("throttle_on_m"), "lat_g": m["lat_g_peak"], "apex": m.get("apex"), "t0": m["t0"], "stint": m.get("stint"), "first_red": (m["first_red"]["axle"] + " ph" + str(m["first_red"]["phase"])) if m.get("first_red") else None, "session": sid}
        def best_pass(ms):   # the reference execution: fastest apex among COMMITTED (near this car's grip) CLEAN passes; a cruise through the turn is never a reference
            if not ms: return None
            g_car = car_grip.get(ms[0]["car"])
            committed = [m for m in ms if g_car is None or m["lat_g_peak"] >= 0.6 * g_car] or ms
            clean = [m for m in committed if not m.get("first_red") and not m.get("drift")]
            pool = clean or committed
            return max(pool, key=lambda m: (m["mph_min"], -(m.get("brake_on_m") or 0))) if pool else None
        corner_out = []
        for i, cl in enumerate(clusters, 1):
            ms = cl["members"]; nn = len(ms)
            fr = {"front": 0, "rear": 0, "none": 0}; ph = defaultdict(int)
            for m in ms:
                if m["first_red"]: fr[m["first_red"]["axle"]] += 1; ph[m["first_red"]["phase"]] += 1
                else: fr["none"] += 1
            dom = max(fr, key=fr.get); cons = fr[dom] / nn
            dom_ph = max(ph, key=ph.get) if ph else None
            usis = [m["usi"] for m in ms]
            per_run = defaultdict(list)
            for m in ms: per_run[m.get("stint")].append(m)
            runs = [{"stint": sn, "n": len(v), "mph_min": med([m["mph_min"] for m in v]), "usi": med([m["usi"] for m in v]), "first_red": max(["front", "rear", "none"], key=lambda a: sum(1 for m in v if (m["first_red"]["axle"] if m["first_red"] else "none") == a)), "lat_g": med([m["lat_g_peak"] for m in v])} for sn, v in sorted(per_run.items(), key=lambda kv: (kv[0] is None, kv[0]))]
            # ---- driver vs tune: does this corner wash out because it's over-driven, or on every clean lap? ----
            sat = [m for m in ms if m["first_red"]]; clean = [m for m in ms if not m["first_red"]]
            limiter = "clean"; note = None
            if sat:
                over_by = (med([m["mph_in"] for m in sat]) - med([m["mph_in"] for m in clean])) if clean else None
                hard_brake = sum(1 for m in sat if m.get("brake_max", 0) > 200 and (m["first_red"] or {}).get("phase") in (1, 2))
                sat_share = len(sat) / nn
                dom_ax = "front" if fr["front"] >= fr["rear"] else "rear"
                if clean and over_by is not None and over_by >= 4:
                    limiter = "driver"; note = f"washes out on the laps you carry ~{round(over_by)} mph more into it — brake earlier / slower entry, it's speed not setup"
                elif sat_share >= 0.7 and cons >= 0.6:
                    limiter = "tune"; note = (f"{dom_ax} gives up on essentially every lap at the same entry speed — {'front softer / mech balance up' if dom_ax == 'front' else 'rear softer / accel diff down'}")
                elif hard_brake >= max(1, len(sat) // 2) and dom_ax == "front":
                    limiter = "driver"; note = "front locks when you overlap brake + steering — release the brakes as you turn in (trail off)"
                else:
                    limiter = "mixed"; note = f"{dom_ax}-limited but inconsistent — drive it a few more times cleanly to separate technique from setup"
            worst = limiter in ("tune", "driver", "mixed")
            # ---- SHOULD vs AM: reference (best clean execution, from the course model if it is better) vs your LATEST pass through this turn ----
            center = (cl["x"], cl["z"]); core = [m for m in ms if m.get("apex") and math.hypot(m["apex"][0] - center[0], m["apex"][1] - center[1]) <= 60] or ms   # absorbed fragments far from the apex don't define the turn
            last_m = max(core, key=lambda m: m["t0"]); car_l = last_m["car"]; same = [m for m in core if m["car"] == car_l] or core   # references are CAR-SPECIFIC
            medv = med([m["mph_min"] for m in same]) or 0; medg = med([m["lat_g_peak"] for m in same]) or 0
            plaus = [m for m in same if m["mph_min"] <= medv * 1.3 + 3 and m["lat_g_peak"] >= 0.5 * medg] or same   # an implausibly fast 'pass' is a different line / fragment, never a reference
            sb = best_pass(plaus); mt = mturn_for(cl); ref_src = "this session · same car"
            ref = pass_view(sb) if sb else None
            mb = ((mt or {}).get("best_by_car") or {}).get(car_l)
            if mb and (ref is None or (mb.get("mph_min") or 0) >= (ref.get("mph_min") or 0)) and mb.get("session") != sid: ref = mb; ref_src = f"session {mb.get('session')} · same car"
            predicted = False
            if (ref is None or len(same) <= 1) and mb is None and mt and mt.get("radius_m") and car_grip.get(car_l):
                v = math.sqrt(car_grip[car_l] * 9.81 * mt["radius_m"]) * 2.237   # course LEARNING transfers geometry; the apex speed is predicted from THIS car's measured grip
                ref = {"mph_in": None, "mph_min": round(v), "mph_out": None, "brake_on_m": None, "throttle_on_m": None, "apex": mt.get("pos"), "predicted": True, "session": None}
                ref_src = f"predicted — course geometry (r≈{mt['radius_m']} m) × this car's grip ({car_grip[car_l]} g)"; predicted = True
            last = pass_view(last_m)
            delta = None; advice = None; on_ref = None
            if predicted and ref and last:
                d_min = last["mph_min"] - ref["mph_min"]; delta = {"mph_in": None, "mph_min": d_min, "mph_out": None, "brake_on_m": None, "throttle_on_m": None, "line_m": None}
                advice = f"no reference for this car here yet — predicted apex ≈ {ref['mph_min']} mph (course geometry × your grip); you did {last['mph_min']} ({'+' if d_min >= 0 else ''}{d_min})" + (" — carry more speed" if d_min <= -4 else " — at / above the prediction; this pass becomes the reference")
            elif ref and last and not (ref.get("t0") == last.get("t0") and ref.get("session") == sid and len(same) == 1):
                d_in = last["mph_in"] - ref["mph_in"]; d_min = last["mph_min"] - ref["mph_min"]; d_out = (last["mph_out"] - ref["mph_out"]) if (last.get("mph_out") is not None and ref.get("mph_out") is not None) else None
                d_brk = (last["brake_on_m"] - ref["brake_on_m"]) if (last.get("brake_on_m") is not None and ref.get("brake_on_m") is not None) else None   # negative = you braked LATER (closer to the apex) than the reference
                d_thr = (last["throttle_on_m"] - ref["throttle_on_m"]) if (last.get("throttle_on_m") is not None and ref.get("throttle_on_m") is not None) else None   # negative = you got on the power EARLIER
                line = round(math.hypot(last["apex"][0] - ref["apex"][0], last["apex"][1] - ref["apex"][1])) if (last.get("apex") and ref.get("apex")) else None
                delta = {"mph_in": d_in, "mph_min": d_min, "mph_out": d_out, "brake_on_m": d_brk, "throttle_on_m": d_thr, "line_m": line}
                fr_last = last.get("first_red") or ""
                if fr_last.startswith("front") and d_in >= 3: advice = f"too much entry speed: {last['mph_in']} mph in vs your reference {ref['mph_in']} (+{d_in}) — brake earlier" + (f" (you braked {abs(d_brk)} m later)" if d_brk is not None and d_brk < -8 else "") + "; the front can't take it"
                elif fr_last.startswith("rear") and d_thr is not None and d_thr <= -10: advice = f"on the power too early: throttle {abs(d_thr)} m before your reference point — the rear lets go; wait for the apex"
                elif fr_last.startswith("front") and fr_last.endswith("ph1") and d_brk is not None and d_brk < -10: advice = f"braking {abs(d_brk)} m later than your reference and locking the fronts — brake at your reference point"
                elif not fr_last and d_min <= -4: advice = f"over-slowing: apex {last['mph_min']} mph vs your reference {ref['mph_min']} ({d_min}) — carry more speed" + (f"; you brake {d_brk} m earlier than needed" if d_brk is not None and d_brk > 10 else "")
                elif not fr_last and d_out is not None and d_out <= -4 and abs(d_min) < 4: advice = f"slow exit: {last['mph_out']} mph out vs {ref['mph_out']} — earlier / more throttle from the apex"
                elif line is not None and line >= 10 and abs(d_min) >= 2: advice = f"off your reference line by {line} m at the apex ({'slower' if d_min < 0 else 'faster'} by {abs(d_min)} mph) — re-find the apex"
                elif abs(d_in) < 3 and abs(d_min) < 3 and (d_brk is None or abs(d_brk) < 12): advice = "✓ on your reference — this turn is consistent"; on_ref = True
                else: advice = f"entry {'+' if d_in >= 0 else ''}{d_in} · apex {'+' if d_min >= 0 else ''}{d_min} mph vs reference" + (f" · braked {abs(d_brk)} m {'later' if d_brk < 0 else 'earlier'}" if d_brk is not None and abs(d_brk) >= 8 else "")
                if limiter == "tune" and advice and not on_ref: advice += " · (tune-limited here — see the limiter note)"
            elif ref and len(same) == 1: advice = "first pass of this car here — becomes its reference; drive it again to compare"
            # update the persistent model with this session's turn
            if mt is None:
                mt = {"id": f"T{len(model['turns']) + 1}", "pos": [round(cl["x"]), round(cl["z"])], "dir": None, "type": None, "radius_m": None, "n": 0, "best": None, "sessions": 0}; model["turns"].append(mt)
            mt["pos"] = [round(cl["x"]), round(cl["z"])]; mt["dir"] = max(("L", "R"), key=lambda d: sum(1 for m in ms if m["dir"] == d)); mt["n"] = mt.get("n", 0) + nn
            mt["type"] = "hairpin" if (med([m["mph_min"] for m in ms]) or 0) < 45 else "fast" if (med([m["mph_min"] for m in ms]) or 0) > 85 else "medium"
            mt["radius_m"] = med([m.get("radius_m") for m in ms if m.get("radius_m")]) or mt.get("radius_m")
            if sb and (not mt.get("best") or (pass_view(sb)["mph_min"] or 0) > (mt["best"].get("mph_min") or 0) or mt["best"].get("session") == sid): mt["best"] = pass_view(sb)
            if sb:   # references are kept PER CAR CONFIG — execution does not transfer between cars, geometry does
                bbc = mt.setdefault("best_by_car", {}); cur_b = bbc.get(car_l)
                if not cur_b or (pass_view(sb)["mph_min"] or 0) > (cur_b.get("mph_min") or 0) or cur_b.get("session") == sid: bbc[car_l] = pass_view(sb)
            mt.setdefault("cars", [])
            if car_l not in mt["cars"]: mt["cars"].append(car_l)
            mt["status"] = cl.get("status", "turn")
            corner_out.append({"id": cl.get("cid", f"C{i}"), "status": cl.get("status", "turn"), "presence": cl.get("presence"), "laps_seen": cl.get("laps_seen"), "multi": cl.get("multi"), "per_lap": cl.get("per_lap"), "absorbed": cl.get("absorbed", 0),
                               "n": nn, "dir": max(("L", "R"), key=lambda d: sum(1 for m in ms if m["dir"] == d)), "pos": [round(cl["x"]), round(cl["z"])], "dist": med([m["dist"] for m in ms]),
                               "mph_min": med([m["mph_min"] for m in ms]), "mph_in": med([m["mph_in"] for m in ms]), "lat_g": med([m["lat_g_peak"] for m in ms]),
                               "first_red": fr, "dominant": dom, "dominant_phase": dom_ph, "consistency": round(cons, 2), "usi": med(usis), "limiter": limiter, "note": note,
                               "model_id": mt["id"], "geo_id": geo_near(cl["x"], cl["z"]), "radius_m": mt.get("radius_m"), "ref": ref, "ref_src": ref_src, "last": last, "delta": delta, "advice": advice, "on_ref": on_ref,
                               "usi_spread": round((sorted(usis)[int(0.75 * (nn - 1))] - sorted(usis)[int(0.25 * (nn - 1))]) if nn >= 2 else 0, 3), "runs": runs,
                               "type": "hairpin" if (med([m["mph_min"] for m in ms]) or 0) < 45 else "fast" if (med([m["mph_min"] for m in ms]) or 0) > 85 else "medium"})
        # persist the course model (never from replays); the session carries a compact summary
        if sid not in model["sessions"]: model["sessions"].append(sid); model["laps"] = model.get("laps", 0) + total_laps
        model["updated"] = sid; model["name"] = co["name"] or model.get("name")
        if geo and (not model.get("geometry") or len(geo["path"]) >= len((model.get("geometry") or {}).get("path") or [])): model["geometry"] = {"length_m": geo["length_m"], "path": geo["path"], "turns": geo["turns"], "session": sid}   # the map persists with the course
        if write_models:
            try:
                os.makedirs(mdir, exist_ok=True)
                with open(mpath, "w", encoding="utf-8") as f: json.dump(model, f, indent=1, ensure_ascii=False)
            except Exception: pass
        model_info = {"turns": len([t for t in model["turns"] if t.get("status", "turn") == "turn"]), "laps": model.get("laps", 0), "sessions": len(model.get("sessions", [])), "file": os.path.relpath(mpath, ROOT)}
        on_ref_n = sum(1 for k in corner_out if k.get("on_ref")); cmp_n = sum(1 for k in corner_out if k.get("delta") is not None)
        pred_n = sum(1 for k in corner_out if (k.get("ref") or {}).get("predicted")); own_n = sum(1 for k in corner_out if k.get("ref") and not (k.get("ref") or {}).get("predicted"))
        if geo:   # mapped turns vs driven turns: a mapped turn with no behavioural corner is a turn you took flat / never loaded — it still exists
            driven_ids = {k.get("geo_id") for k in corner_out if k.get("geo_id")}
            geo["driven"] = len(driven_ids); geo["not_driven"] = [g["id"] for g in geo["turns"] if g["id"] not in driven_ids]
            turns_info["mapped"] = len(geo["turns"]); turns_info["mapped_driven"] = len(driven_ids)
            if not model.get("geometry") or len(geo["path"]) >= len((model.get("geometry") or {}).get("path") or []): model["geometry"] = {"length_m": geo["length_m"], "path": geo["path"], "turns": geo["turns"], "session": sid}
        course_out.append({"route_key": key, "name": co["name"], "cars": co["cars"], "runs": nev, "best_lap": best, "composition": counts, "corners": corner_out, "is_loop": key.startswith("loop:"), "decode": decode, "profile": profile, "laps": laps_info, "turns": turns_info,
                           "model": model_info, "driving": {"compared": cmp_n, "on_reference": on_ref_n, "predicted": pred_n, "own_refs": own_n, "car_grip": {k_: car_grip.get(k_) for k_ in co["cars"]}}, "geometry": geo,
                           "coverage": {"overall": round(num / den, 2) if den else 0.0, "probes": probes}, "events": evs, "advice_by_car": advice_by_car, "last_t": max(e["t1"] for e in evs)})
    course_out.sort(key=lambda c: -c["last_t"])
    sess["courses"] = course_out
    sess["summary"] = {"cars": len(cars), "configs": len(segments), "stints": len(stints), "events": len(ev_out), "courses": len(course_out), "corners": len(corners), "launches": len(launches), "braking": len(braking), "bottoming": len(bott), "pulses": len(pulses), "impacts": len(impacts),
                       "front_limited_corners": sum(1 for c in corners if c["first_red"] and c["first_red"]["axle"] == "front" and not c["drift"]),
                       "rear_limited_corners": sum(1 for c in corners if c["first_red"] and c["first_red"]["axle"] == "rear" and not c["drift"]),
                       "drift_corners": sum(1 for c in corners if c["drift"])}
    out = os.path.join(outdir, sid + ".json")
    json.dump(sess, open(out, "w"), separators=(",", ":"))
    print(f"wrote {out}  ({os.path.getsize(out)//1024} KB)  cars={[(c['id'], c['name'], c['build_id']) for c in sess['cars']]}  summary={sess['summary']}")

if __name__ == "__main__":
    main()
