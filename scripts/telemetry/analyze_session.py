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
    ("wiggle", "Steering pulses > 55 mph", 3, 0.5, "{n} more quick steering pulses at speed (experimental)"),
    ("dyno", "Dyno rpm coverage (WOT)", 1, 1.0, "full-throttle pulls through the rev range"),
    ("gears", "Gear ladder", 1, 1.0, "full-throttle time in every gear"),
    ("warm", "Tires warm (> 150 F) most of the run", 1, 0.5, "keep driving — tires still cold for most frames"),
]

def coverage_for(cid_, cars, corners, launches, braking, crests, pulses, top_pull, warm_frac):
    c = cars.get(cid_) or {}
    grip = [x for x in corners if x["car"] == cid_ and not x["drift"]]
    counts = {
        "hairpin": sum(1 for x in grip if x["mph_min"] < 45), "medium": sum(1 for x in grip if 45 <= x["mph_min"] <= 85), "fast": sum(1 for x in grip if x["mph_min"] > 85),
        "flick": sum(1 for a, b in zip(grip, grip[1:]) if a["dir"] != b["dir"] and 0 <= b["t0"] - a["t1"] <= 2.5),
        "launch": sum(1 for x in launches if x["car"] == cid_), "brake": sum(1 for x in braking if x["car"] == cid_ and x["mph_start"] >= 80),
        "crest": sum(1 for x in crests if x["car"] == cid_), "top": 1 if top_pull.get(cid_, 0) >= 5 else 0, "wiggle": sum(1 for x in pulses if x["car"] == cid_),
    }
    dyno = c.get("dyno") or []; lo = (c.get("idle_rpm") or 1000) + 1500; hi = c.get("max_rpm") or 0
    bins = int(max(0, (hi - lo)) // 250) or 1; counts["dyno"] = round(min(1.0, sum(1 for d in dyno if lo <= d["rpm"] <= hi) / bins), 2)
    g = c.get("gears") or []; mx = max([x["gear"] for x in g], default=0); counts["gears"] = round(len(g) / mx, 2) if mx else 0
    counts["warm"] = round(warm_frac.get(cid_, 0), 2)
    probes = []; num = 0; den = 0
    for key, label, req, wt, hint in PROBES:
        n = counts[key]; conf = min(1.0, (n / req) if key not in ("dyno", "gears", "warm") else float(n))
        if key == "warm": conf = 1.0 if n >= 0.6 else n / 0.6
        need = max(0, req - int(n)) if key not in ("dyno", "gears", "warm") else (0 if conf >= 1 else 1)
        probes.append({"key": key, "label": label, "count": n, "required": req, "confidence": round(conf, 2), "hint": hint.format(n=need) if conf < 1 else "done"})
        num += conf * wt; den += wt
    return {"overall": round(num / den, 2), "probes": probes}

def advice_for(cid_, cars, corners, launches, braking, bott, cov, temps_med):
    c = cars.get(cid_) or {}; out = []
    grip = [x for x in corners if x["car"] == cid_ and not x["drift"]]; n = len(grip)
    def add(key, text, sev, conf, ev): out.append({"key": key, "text": text, "severity": sev, "confidence": round(max(0, min(1, conf)), 2), "evidence": ev})
    fr1 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "front" and x["first_red"]["phase"] == 1)
    fr2 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "front" and x["first_red"]["phase"] == 2)
    fr3 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "front" and x["first_red"]["phase"] >= 3)
    rr = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "rear")
    rr4 = sum(1 for x in grip if x["first_red"] and x["first_red"]["axle"] == "rear" and x["first_red"]["phase"] == 4)
    usi = sorted(x["usi"] for x in grip); usim = usi[len(usi) // 2] if usi else None
    if n >= 2 and fr1 / n >= 0.3: add("brake-lockup", "Fronts saturate under braking before turn-in: brake pressure DOWN toward the knee, then balance 2-3% rearward.", 3, fr1 / 4, f"{fr1}/{n} corners red on the fronts in phase 1")
    if n >= 2 and fr2 / n >= 0.25: add("trail-brake", "Trail-brake understeer: finish more braking before steering; caster +0.5 for camber-in-turn.", 2, fr2 / 4, f"{fr2}/{n} corners red on the fronts at turn-in")
    if (n >= 3 and fr3 / n >= 0.3) or (usim is not None and n >= 4 and usim > 0.15): add("mid-understeer", "Mid-corner understeer: front ARB -2 clicks or front springs softer (mech balance up); if only in fast corners, aero balance forward instead.", 2, max(fr3, 1) / 4 if fr3 else (n / 8), f"USI median {usim:+.3f} over {n} corners; {fr3} mid-corner front reds")
    if n >= 2 and rr / n >= 0.3: add("rear-limited", "Rear-limited corners: rear ARB/springs softer; on throttle (phase 4) accel diff lock -10%.", 3, rr / 4, f"{rr}/{n} corners red on the rears ({rr4} on exit)")
    if usim is not None and n >= 4 and usim < -0.05: add("oversteer-balance", "Balance reads oversteer (negative USI): rear relatively softer or rear wing up.", 2, n / 8, f"USI median {usim:+.3f}")
    L = [x for x in launches if x["car"] == cid_]
    if L:
        prs = sorted(x["peak_slip_rear"] for x in L)[len(L) // 2]; pfs = sorted(x["peak_slip_front"] for x in L)[len(L) // 2]
        if prs > 1.5: add("launch-spin", "Launch wheelspin on the rears: accel diff lock down / taller 1st, or squeeze the throttle.", 2, len(L) / 2, f"median peak rear slip {prs:.2f} over {len(L)} launches")
        if pfs > 1.2 and c.get("drivetrain") == "AWD": add("launch-front-spin", "AWD fronts spinning at launch: center split more rearward / front accel diff down.", 2, len(L) / 2, f"median peak front slip {pfs:.2f}")
    B = [x for x in braking if x["car"] == cid_ and x["mph_start"] >= 60]
    if len(B) >= 2:
        fd = sorted(x["front_deficit"] for x in B)[len(B) // 2]; rd = sorted(x["rear_deficit"] for x in B)[len(B) // 2]
        if fd > 0.35 and rd > 0.35: add("brake-pressure", "Both axles lock under hard braking: brake pressure too high overall — bring it down to the knee.", 3, len(B) / 3, f"median deficit F {fd:.2f} / R {rd:.2f} over {len(B)} stops")
        elif fd > rd + 0.1: add("brake-balance-rear", "Fronts lock first: brake balance 2-4% rearward.", 2, len(B) / 3, f"median deficit F {fd:.2f} vs R {rd:.2f}")
        elif rd > fd + 0.1: add("brake-balance-front", "Rears lock first: brake balance forward, decel diff lock down.", 2, len(B) / 3, f"median deficit R {rd:.2f} vs F {fd:.2f}")
    tm = temps_med.get(cid_)
    if tm:
        fmed = (tm["FL"] + tm["FR"]) / 2; rmed = (tm["RL"] + tm["RR"]) / 2
        if fmed - rmed > 15: add("front-hot", "Fronts run 15 F+ hotter than rears: the understeer thermal signature — check pressures/camber on the HUD (Tires Misc + Heat).", 1, 0.7, f"median F {fmed:.0f} F vs R {rmed:.0f} F")
        if max(tm.values()) > 300: add("tires-cooking", "Tire temps past 300 F: pressures likely high and/or sustained wheelspin — HUD pressure check.", 1, 0.6, f"max median {max(tm.values()):.0f} F")
    nb = sum(1 for x in bott if x["car"] == cid_ and x["mph"] > 40)
    if nb >= 8: add("bottoming", "Suspension hits full compression at speed: ride height up a notch or springs stiffer (verify on the HUD Suspension page).", 1, min(1, nb / 20), f"{nb} bottoming frames above 40 mph (detector still coarse)")
    if cov and cov["overall"] < 0.35: add("more-data", "Low coverage: verdicts are provisional — see the probe bars for what to drive next.", 1, 1.0, f"coverage {cov['overall']:.0%}")
    out.sort(key=lambda a: -(a["severity"] * a["confidence"]))
    return out

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
    tags = {}
    tpath = os.path.join(ROOT, "data", "sessions", sid + ".tags.json")
    if os.path.exists(tpath):
        try:
            with open(tpath, encoding="utf-8") as f: tags = json.load(f).get("stints", {})
        except Exception: tags = {}
    stint_n = 0; zero_since = None; prev_cfg = None; stint_rows = defaultdict(list)
    for r in rows:
        if r["IsRaceOn"] == 1:
            k = cid(r)
            if prev_cfg is None or (zero_since is not None and r["t"] - zero_since >= 2.0) or k != prev_cfg: stint_n += 1
            zero_since = None; prev_cfg = k; r["stint"] = stint_n; stint_rows[stint_n].append(r)
        elif zero_since is None: zero_since = r["t"]
    sess = {"id": sid, "source": path, "frames": len(rows), "duration_s": round(dur, 1), "rate_pps": round(len(rows) / max(dur, 1e-9), 1), "live_frames": len(live)}
    NAMES = names_map()

    # ---- per-configuration entries + segments ----
    cars = {}; segments = []; cur = None
    for r in live:
        k = cid(r)
        if k != cur: segments.append({"id": k, "t0": round(r["t"], 1), "t1": round(r["t"], 1)}); cur = k
        else: segments[-1]["t1"] = round(r["t"], 1)
        c = cars.setdefault(k, {"id": k, "ordinal": r["CarOrdinal"], "pi": r["CarPI"], "class": CLASS.get(r["CarClass"], str(r["CarClass"])), "drivetrain": DRIVE.get(r["DrivetrainType"], "?"),
                                "cyl": r["NumCylinders"], "max_rpm": round(r["EngineMaxRpm"]), "idle_rpm": round(r["EngineIdleRpm"]), "car_group": r["CarGroup"],
                                "name": (NAMES.get(str(r["CarOrdinal"])) or {}).get("name"),
                                "live_frames": 0, "_gear": defaultdict(list), "_dyno": defaultdict(list), "_k": {w: [] for w in W}, "_boost": 0.0, "_mass": [], "temps_max_f": {w: 0 for w in W}})
        c["live_frames"] += 1; c["_boost"] = max(c["_boost"], r["Boost"])
        for w in W: c["temps_max_f"][w] = max(c["temps_max_f"][w], r["TireTempF" + w])
        if r["Accel"] > 230 and r["CurrentEngineRpm"] > 2500 and r["Speed"] > 5 and 1 <= r["Gear"] <= 10:
            c["_gear"][r["Gear"]].append(r["Speed"] / r["CurrentEngineRpm"])
            c["_dyno"][int(r["CurrentEngineRpm"] // 250) * 250].append((r["Power"] / 745.7, r["Torque"] * 0.7376))
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
        c["sig"] = {"boost_max": round(c["_boost"], 1), "hp_peak": pk["hp"] if pk else None, "rpm_at_peak": pk["rpm"] if pk else None,
                    "tq_peak": max((d["tq"] for d in c["dyno"]), default=None), "gear_count": len(lad), "ladder": [g["rel"] for g in lad],
                    "mass_idx": round(statistics.median(c["_mass"])) if len(c["_mass"]) >= 15 else None}
        key = f'{c["ordinal"]}|{c["drivetrain"]}|{c["cyl"]}|{c["pi"]}|{round(c["max_rpm"], -2)}|{len(lad)}|{",".join(f"{g["rel"]:.1f}" for g in lad)}|{round((c["sig"]["hp_peak"] or 0), -1)}'
        c["build_id"] = hashlib.md5(key.encode()).hexdigest()[:8]
        for k in ("_gear", "_dyno", "_k", "_boost", "_mass"): del c[k]
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
                corners.append({"t0": round(seg[0]["t"], 1), "t1": round(seg[-1]["t"], 1), "car": cid(seg[0]), "dir": "R" if sign > 0 else "L",
                                "mph_in": round(v_in), "mph_min": round(v_min), "lat_g_peak": round(peak, 2), "phases": phases, "first_red": first, "usi": round(usi, 3),
                                "drift": drift, "kink": v_min > 85 and peak < 0.9, "brake_max": max([r["Brake"] for r in pre + seg] or [0]), "hb": any(r["HandBrake"] > 0 for r in seg)})
            i = j
        else: i += 1
    sess["corners"] = corners

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
        st = {"n": sn, "id": k, "t0": round(rs[0]["t"], 1), "t1": round(rs[-1]["t"], 1), "live_s": round((rs[-1]["t"] - rs[0]["t"]), 1),
              "label": (tags.get(str(sn)) or {}).get("label") if isinstance(tags.get(str(sn)), dict) else tags.get(str(sn)),
              "corners": len(sc), "launches": len(sl), "braking": len(sb), "usi_med": med([c["usi"] for c in sc]), "first_red_front": sum(1 for c in sc if c["first_red"] and c["first_red"]["axle"] == "front"),
              "brake_fd_med": med([b["front_deficit"] for b in sb]), "brake_rd_med": med([b["rear_deficit"] for b in sb]), "launch_rear_slip": med([l["peak_slip_rear"] for l in sl]),
              "ladder": lad, "ladder_changed": None}
        prev = next((x for x in reversed(stints) if x["id"] == k and x["ladder"]), None)
        if prev and lad:
            common = [g for g in lad if g in prev["ladder"]]
            st["ladder_changed"] = (any(abs(lad[g] - prev["ladder"][g]) / prev["ladder"][g] > 0.04 for g in common) if common else None)
        stints.append(st)
    sess["stints"] = stints
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
        c["temps_med_f"] = {w: round(v) for w, v in temps_med.get(c["id"], {}).items()}
    sess["summary"] = {"cars": len(cars), "configs": len(segments), "stints": len(stints), "corners": len(corners), "launches": len(launches), "braking": len(braking), "bottoming": len(bott), "pulses": len(pulses), "impacts": len(impacts),
                       "front_limited_corners": sum(1 for c in corners if c["first_red"] and c["first_red"]["axle"] == "front" and not c["drift"]),
                       "rear_limited_corners": sum(1 for c in corners if c["first_red"] and c["first_red"]["axle"] == "rear" and not c["drift"]),
                       "drift_corners": sum(1 for c in corners if c["drift"])}
    out = os.path.join(outdir, sid + ".json")
    json.dump(sess, open(out, "w"), separators=(",", ":"))
    print(f"wrote {out}  ({os.path.getsize(out)//1024} KB)  cars={[(c['id'], c['name'], c['build_id']) for c in sess['cars']]}  summary={sess['summary']}")

if __name__ == "__main__":
    main()
