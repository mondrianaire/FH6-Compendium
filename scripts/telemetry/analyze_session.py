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

Clocks: session ids (fh6_YYYYMMDD_HHMMSS) are LOCAL time; tune container stamps (Tuning_<ordinal>_<stamp>)
are UTC. Anything that matches a lap or a capture to a save goes through session_epoch / container_epoch so
both sit on one base -- parsing both as local put every save ~4 h late and NULLed 174 of 306 stored laps
(fixed 2026-09-02; scripts/telemetry/check_tune_clock.py asserts it against the containers on disk).
"""
import re
import calendar, csv, hashlib, json, math, os, sqlite3, statistics, sys, time
import lap_store
import fh6_tune_decode as TUNE   # tune_hash: which slider revision a lap was driven on
from collections import defaultdict

G = 9.80665
CLASS = {0: "D", 1: "C", 2: "B", 3: "A", 4: "S1", 5: "S2", 6: "X", 7: "X"}
DRIVE = {0: "FWD", 1: "RWD", 2: "AWD"}
W = ["FL", "FR", "RL", "RR"]
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
# Turn-detector generation. Persisted geometry is only replaced by a LONGER path, so without this stamp a
# course keeps serving turns computed by whatever detector first mapped it — an improved detector would never
# reach an already-mapped course. Bump this whenever detect_turns changes shape. (turn_lab.py scores candidates.)
DET_VER = "geo7-tol-from-map"


def self_retrace(path, tol=20.0):
    """Fraction of a path's second half that lies within tol metres of its first half.

    A lap drives each piece of road ONCE, so a real lap — closed circuit or not — scores near zero. A MERGED
    lap (the game missed a finish-line crossing, so two laps became one window) retraces itself and scores
    high. This is the only way to tell a genuinely long course from two laps of a short one: length alone
    cannot, and length alone is what crowned a 1923 m double lap as the reference for a 1024 m circuit."""
    if len(path) < 40:
        return 0.0
    h = len(path) // 2
    A = path[:h:2] or path[:h]
    B = path[h::2] or path[h:]
    t2 = tol * tol
    n = sum(1 for b in B if any((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 <= t2 for a in A))
    return n / max(1, len(B))


def _lat_bank_on_disk(route_key):
    """The course's banked lateral-g profile, read straight off its model file.

    The geometry block runs BEFORE `model` is loaded, so it cannot reach the bank through it — the same
    ordering that once had the turn registry seeded from a superseded map. Reading the file directly keeps the
    accumulation honest without moving the model load."""
    try:
        mp = os.path.join(ROOT, "data", "courses", re.sub(r"[^A-Za-z0-9_.-]+", "_", str(route_key)) + ".json")
        with open(mp, encoding="utf-8") as f:
            return dict(((json.load(f).get("geometry") or {}).get("lat_acc") or {}))
    except Exception:
        return {}


def better_map(fresh, stored):
    """Should this session's geometry become the course's map? ONE definition, used by both the turn registry
    and the model write — they used to decide separately, so the registry was seeded from the old map while the
    write adopted the new one, and every superseded corner stayed 'part of the road' forever."""
    if not (fresh and fresh.get("path")):
        return False
    if self_retrace(fresh["path"]) >= 0.4:
        return False                                              # never adopt a merged lap as the map
    sp = (stored or {}).get("path")
    if not sp:
        return True
    if self_retrace(sp) >= 0.4:
        return True                                               # the stored map IS a merged lap: replace it
    # ROAD, NOT POINT COUNT. This compared len(path) -- and down() caps every path at 500 points by striding,
    # so point count SATURATES and then oscillates: 3996 m of road resamples to 500 points and 4000 m to 334.
    # Across the live catalog 4200_-5450 holds 47,648 m in 491 points while -4750_-1550 holds 1,966 m in 490:
    # a 24x difference in road, one point apart. So a genuinely longer map loses, permanently -- every future
    # full lap of that course resamples to the same count and loses again.
    # Worse than losing: control then falls to the branch that keeps the STORED path but adopts the new turns,
    # whose coverage guard only bounds the new path from BELOW, so turns measured along the longer road get
    # written onto the shorter one. That is already on disk -- -1700_-4450 has 15 of 29 map turns sitting
    # 358-789 m off its own path, with s running to 6,584 m on a 3,852 m map -- and turns that far off the road
    # can never bind to a driven corner, because geo_near only matches within ~60 m of an apex.
    # merge_courses.merge_into was fixed for exactly this ("point count is a sampling artefact; arc length is
    # the thing being compared"); better_map was not.
    _fa, _sa = _arc_of(fresh["path"]), _arc_of(sp)
    if _fa >= _sa:
        return True
    # an older detector's map is not trustworthy, but only a session that really drove the course may re-map it
    return (stored or {}).get("det") != DET_VER and _fa >= 0.8 * _sa


def split_multilap(pts, close_m=35.0, min_lap_m=250.0):
    """Where did each lap actually end? Returns the indices that close a lap, or [] if this is a single lap.

    Laps are cut on the game's LapNumber, but it does not increment in free roam or on unregistered routes, so
    a whole multi-lap run arrives as ONE window. Geometry then reads two laps of a circuit as one road of twice
    the length with every corner counted twice — the fault behind three corrupted course maps, one of which had
    a single 'lap' holding five. The finish line is not in the telemetry, but the road says the same thing: the
    lap closed when the car came back to where it started.

    pts: [(t, x, z), ...]. A cut needs min_lap_m of travel first, so crawling around the grid cannot trigger one.
    """
    if len(pts) < 40:
        return []
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + math.hypot(pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]))
    cuts = []
    i0 = 0
    for i in range(1, len(pts)):
        if cum[i] - cum[i0] < min_lap_m:
            continue
        if math.hypot(pts[i][1] - pts[i0][1], pts[i][2] - pts[i0][2]) <= close_m:
            cuts.append(i)
            i0 = i
    # A SHORT TAIL IS NOT A LAP. A LapNumber window already ends AT the start line, so its final return is the
    # lap closing, not a new one beginning — accepting it turned every ordinary lap into a lap plus a stub and
    # doubled the lap count. Every interior piece is >= min_lap_m by construction; only the tail can be short.
    while cuts:
        pieces = [cum[b] - cum[a] for a, b in zip([0] + cuts, cuts)]
        typical = sorted(pieces)[len(pieces) // 2]
        if cum[-1] - cum[cuts[-1]] >= 0.5 * typical:
            break
        cuts.pop()
    return cuts
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


# PROMOTED TO MODULE SCOPE. Both are pure functions of a path — they need only math, smooth() and each other —
# but living nested inside the analysis meant the ONLY way to map a road was to re-run a whole session. A lap
# measured by hand (the 23.4 mi Colossus, closed to 7 m, that the windowing never offered as a course) could
# not be turned into a course map at all. Nothing about their behaviour changes; the nested calls resolve here.

def _arc_of(path):
    """Road length of a path, in metres, skipping the joins between disconnected pieces.

    Point count is a sampling artefact; this is the thing being compared. The break is found from the data --
    road is sampled at a near-constant step, so a segment far longer than the median is a discontinuity, not
    road -- which is the same rule audit_models.arc uses on the same paths.
    """
    p = path or []
    if len(p) < 2:
        return 0.0
    segs = [math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1)]
    med = sorted(segs)[len(segs) // 2]
    cut = max(150.0, med * 20.0) if med > 0 else float("inf")
    return sum(d for d in segs if d <= cut)



def _is_lap_boundary(prev_row, row):
    """Did the car just complete a LAP, as opposed to restarting? Ask the game, not the clock.

    Three tests have been tried here and the first two were both wrong, in opposite directions.
      * `previous CurrentLap > 30.0` -- too high, so Edamame's 29.4 s lap and loop_test_loop's 21.9 s lap
        could never register (22 of 208 stored laps are under 30 s); and too permissive, accepting 126 of
        135 drops on capture 134742 when only ~21 are laps, because a RESTART clears CurrentLap too.
      * `CurrentRaceTime kept climbing` -- better, but not sound: measured on 213928 it accepts 19 drops
        including two where LapNumber and LastLap are both unchanged, so the premise that the race clock
        always clears on a restart is simply false.

    The game states the answer directly. Completing a lap increments LapNumber on a lapped circuit, and on
    a single-lap Rivals run -- where LapNumber stays 0 throughout -- it publishes the time in LastLap.
    Either is the game saying "that was a lap"; a restart says neither, and zeroes LastLap.

    Corroborated rather than assumed: on 213928 this accepts exactly 11 boundaries, and every one of them
    is AT a start/finish line -- eight Edamame laps of 29.6-34.0 s clustered within 8 m of (-7348,-2110),
    and three Colossus laps of 372.0, 374.4 and 382.1 s within 3 m of (-3773,307). Nothing else is
    accepted, and no threshold on lap length is involved.
    """
    if not prev_row or not row:
        return False
    a, b = prev_row.get("CurrentLap"), row.get("CurrentLap")
    if a is None or b is None or not (a > 3.0 and b < 1.0):
        return False                                   # the lap timer did not clear: nothing happened
    na, nb = prev_row.get("LapNumber"), row.get("LapNumber")
    if na is not None and nb is not None and nb - na == 1:
        return True                                    # lapped circuit: the game counted another lap
    la, lb = prev_row.get("LastLap"), row.get("LastLap")
    return bool(lb and lb > 0 and (la is None or abs(lb - la) > 0.01))   # single-lap run: it published a time


def _globalise_arc(pcs):
    """Flatten resample() pieces with their running distance carried ACROSS the joins.

    resample restarts each piece's third element at 0, so the flat concatenation everything downstream uses
    has an arc that resets mid-trace. Turn `s` was fixed to run along the whole course; the trace arc it is
    compared against was not, and the two are read against each other constantly -- a turn tick is placed on
    the trace by arc, and a window's total length was taken as pts[-1][2], which on a multi-piece window is
    the LAST PIECE ONLY. One of the two had to move; this is the other half of that fix.
    """
    out, acc = [], 0.0
    for pc in pcs:
        for q in pc:
            r = list(q); r[2] = q[2] + acc; out.append(r)
        acc += (pc[-1][2] if pc else 0.0)
    return out



def curvature(P, step=4.0, win=7):
    th = [math.atan2(b[1] - a[1], b[0] - a[0]) for a, b in zip(P, P[1:])]
    for i_ in range(1, len(th)):
        while th[i_] - th[i_ - 1] > math.pi: th[i_] -= 2 * math.pi
        while th[i_] - th[i_ - 1] < -math.pi: th[i_] += 2 * math.pi
    ths = smooth(th, win) if len(th) >= win else th
    return [(ths[i_ + 1] - ths[i_ - 1]) / (2 * step) for i_ in range(1, len(ths) - 1)]   # rad/m at P[i_+1]

def detect_turns(P, step=4.0, win=9, floor_r=600.0, min_deg=30.0, tight_r=90.0, tight_deg=14.0, bridge_m=25.0):
    K = curvature(P, step, win)
    if not K: return []
    floor = 1.0 / floor_r; bridge = max(1, int(bridge_m / step))
    segs = []; cur = None; gap = 0
    for i_, k_ in enumerate(K):
        sg = 1 if k_ > 0 else -1
        if abs(k_) >= floor:
            if cur and cur["sgn"] == sg and gap <= bridge: cur["i1"] = i_ + 1; gap = 0
            else:
                if cur: segs.append(cur)
                cur = {"i0": i_, "i1": i_ + 1, "sgn": sg}; gap = 0
        elif cur:
            gap += 1
            if gap > bridge: segs.append(cur); cur = None
    if cur: segs.append(cur)
    out = []
    for t_ in segs:
        sl = K[t_["i0"]:t_["i1"]]
        if not sl: continue
        deg = abs(sum(sl) * step) * 180 / math.pi
        ia = t_["i0"] + max(range(len(sl)), key=lambda q: abs(sl[q]))
        rmin = 1 / max(1e-6, abs(K[ia]))
        if not (deg >= min_deg or (rmin <= tight_r and deg >= tight_deg)): continue
        out.append({"ia": ia + 1, "i0": t_["i0"] + 1, "i1": min(t_["i1"] + 1, len(P) - 1),
                    "sgn": t_["sgn"], "k": abs(K[ia]), "deg": round(deg), "radius_m": round(rmin)})
    # ONE CONTINUOUS CHANGE OF DIRECTION IS ONE TURN: same-direction segments whose spans nearly touch are
    # a double-apex / compound corner that a momentary curvature dip split in two. Merge on SPAN
    # adjacency, not apex distance — a compound corner's apexes sit ~90 m apart while its halves are
    # metres apart. 60 m is measured, not guessed: real compound halves here sit 36 m apart and genuinely
    # separate same-direction corners sit 148 m apart, so the threshold lands in an empty band.
    # NEVER MERGE ACROSS A STRAIGHT. Distance alone is the wrong test, and the metric that chose it was
    # biased: cross-lap agreement REWARDS merging (fewer, larger turns are trivially more consistent, and
    # merging the whole course into one turn would score 100%), so tuning the gap on agreement drove it
    # to 60 m and swallowed real corners. Two corners separated by actual straight road are two corners
    # however close they sit. Measured cost of getting this wrong: G1 became 173 deg over 236 m with a
    # 965 m-radius straight inside it, G7 244 deg over 260 m around an 849 m straight -- five distinct
    # curvature peaks each, one marker, and the merged apex landing between the real corners.
    STRAIGHT_R = 300.0                      # radius above which the road is not turning
    adj = max(1, int(60.0 / step)); mg = []
    for t_ in out:
        gap_k = [abs(x) for x in K[max(0, mg[-1]["i1"] - 1):max(0, t_["i0"] - 1)]] if mg else []
        straight = bool(gap_k) and (1.0 / max(1e-6, min(gap_k)) > STRAIGHT_R)   # touching segments: nothing between them, so merge
        if mg and t_["sgn"] == mg[-1]["sgn"] and (t_["i0"] - mg[-1]["i1"]) <= adj and not straight:
            m_ = mg[-1]; m_["i1"] = max(m_["i1"], t_["i1"]); m_["deg"] = m_["deg"] + t_["deg"]
            if t_["k"] > m_["k"]: m_["k"] = t_["k"]; m_["ia"] = t_["ia"]; m_["radius_m"] = t_["radius_m"]
        else: mg.append(dict(t_))
    # WHERE a turn IS = where its direction change is CONCENTRATED, not the single tightest sample. The
    # argmax of a smoothed derivative wanders with the racing line, so the same corner reported apexes
    # tens of metres apart from lap to lap; the curvature-weighted centroid is a property of the road.
    for t_ in mg:
        sl = [abs(x) for x in K[max(0, t_["i0"] - 1):max(0, t_["i1"] - 1)]]
        tot = sum(sl)
        if tot:
            t_["ia"] = min(len(P) - 1, max(0, int(round(t_["i0"] + sum(q * w for q, w in enumerate(sl)) / tot))))
    return mg

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

def shape_confidence(ref_path, laps):
    """How CONFIDENT are we in the auto-computed course SHAPE (the outline), as distinct from the turn COUNT.
    The outline is drawn from one reference lap; this scores whether the OTHER recorded laps trace the same shape.
    For each lap, the median nearest-point distance to the reference outline (meters) — small = same shape (even on a
    different racing line, a few m off), large = a genuinely different/broken outline (100s of m). Direction-agnostic
    (a reversed loop is the same shape) and alignment-free (nearest-neighbour, so start offset / sampling don't matter).
    Returns (conf 0..1, laps_agree, laps_compared, spread_m, tol_m) or None when there isn't enough to judge."""
    if not ref_path or len(ref_path) < 8 or not laps:
        return None
    xs = [p[0] for p in ref_path]; zs = [p[1] for p in ref_path]
    span = max(max(xs) - min(xs), max(zs) - min(zs))
    tol = min(30.0, max(10.0, 0.03 * span))   # "same outline" band: scales with course size, clamped 10-30 m
    R = ref_path[::max(1, len(ref_path) // 300)]   # thin the reference for the O(lap*ref) nearest-neighbour scan
    def med_dev(pts):
        ds = sorted(min((q[0] - r[0]) ** 2 + (q[1] - r[1]) ** 2 for r in R) ** 0.5 for q in pts)
        return ds[len(ds) // 2] if ds else None
    devs = []
    for lp in laps:
        pts = lp.get("pts") or []
        if len(pts) < 5:
            continue
        d = med_dev(pts)
        if d is not None:
            devs.append(d)
    if not devs:
        return None
    n_comp = len(devs)
    n_agree = sum(1 for d in devs if d <= tol)
    devs.sort(); spread = devs[len(devs) // 2]   # the typical lap's deviation from the outline
    conf = strength(n_agree, 3) * (n_agree / n_comp)   # enough agreeing laps AND most laps agree
    return round(conf, 2), n_agree, n_comp, round(spread, 1), round(tol, 1)

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

def general_tuning_for(cid_, corners, advice):
    """The GENERAL / all-around lane — the inverse of course tuning.

    Course tuning weights each diagnosis by how much THIS course uses it (course_weight),
    deliberately overfitting to one track. General tuning weights by BREADTH: how consistently
    the problem appears across every context the build has actually driven (corner-type x
    surface). It acts only on systematic weaknesses and never overfits to one track's quirk.
    If a car is surface- or speed-specific, that shows up as a split balance signature (and a
    'context_split' flag on the advisory) rather than a blanket slider change."""
    grip = [x for x in corners if x["car"] == cid_ and not x["drift"]]
    def med(a):
        a = sorted(a)
        return a[len(a) // 2] if a else None
    ctype = lambda c: "hairpin" if c["mph_min"] < 45 else "medium" if c["mph_min"] <= 85 else "fast"
    # context buckets = corner-type x surface
    buckets = {}
    for c in grip:
        buckets.setdefault((ctype(c), c.get("surface", "smooth")), []).append(c)
    def dom_axle(cs):
        cnt = {"front": 0, "rear": 0, "none": 0}
        for c in cs:
            cnt[(c["first_red"] or {}).get("axle", "none")] += 1
        return max(cnt, key=cnt.get)
    sig = []
    for (typ, surf), cs in buckets.items():
        if len(cs) < 2:
            continue
        u = med([c["usi"] for c in cs])
        sig.append({"type": typ, "surface": surf, "n": len(cs), "usi": round(u, 3), "axle": dom_axle(cs),
                    "bias": "understeer" if u > 0.1 else "oversteer" if u < -0.05 else "neutral"})
    sig.sort(key=lambda s: -s["n"])
    usis = [s["usi"] for s in sig]
    spread = (max(usis) - min(usis)) if len(usis) >= 2 else 0.0
    robustness = round(max(0.0, 1 - spread / 0.5), 2) if sig else None   # 0.5 USI spread across contexts => 0 robustness
    surfaces = sorted(set(s["surface"] for s in sig))
    surf_split = None
    if len(surfaces) >= 2:
        by_surf = {}
        for s in sig:
            by_surf.setdefault(s["surface"], []).append(s["usi"])
        sm, rg = med(by_surf.get("smooth", [])), med(by_surf.get("rough", []))
        if sm is not None and rg is not None and abs(sm - rg) > 0.2:
            surf_split = {"smooth": round(sm, 3), "rough": round(rg, 3)}
    # breadth per advisory = fraction of contexts exhibiting the problem (blanket -> ~1, one-context -> low)
    def exhibits(a, s):
        k = a["key"]
        if k in ("mid-understeer", "trail-brake", "brake-lockup"):
            return s["usi"] > 0.1 or s["axle"] == "front"
        if k == "oversteer-balance":
            return s["usi"] < -0.05 or s["axle"] == "rear"
        if k == "rear-limited":
            return s["axle"] == "rear"
        return None   # not corner-context dependent (launch / brake / temps / bottoming / meta)
    for a in advice:
        rel = [e for e in (exhibits(a, s) for s in sig) if e is not None]
        if not rel:
            a["breadth"] = 1.0 if a["key"] == "more-data" else 0.85   # broadly applicable, not tied to corner context
            continue
        present = sum(1 for e in rel if e)
        a["breadth"] = round(present / len(rel), 2)
        if 0 < present < len(rel):
            a["context_split"] = True     # some contexts, not others -> a balance issue, not a blanket change
    return {"balance": sig, "robustness": robustness, "buckets": len(sig),
            "surfaces": surfaces, "surface_split": surf_split, "corners": len(grip)}


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

# Confidence per decode `conf` grade (fh6_tune_decode._part_view). The BYTE is always exact; what varies is how
# well we can NAME what that byte means. named = the shop's own part name · dim/cosmetic = exact index, the shop's
# label for that level is not mapped · category = upgraded but the tier is ambiguous · compound = the tyre index is
# a global enum whose name is still best-effort (416/513 saves read "(unverified)"). Never assert a name we don't have.
DEC_CONF = {"named": 1.0, "dim": 0.9, "cosmetic": 0.9, "category": 0.8, "compound": 0.65}


# ---- one clock for save attribution ---------------------------------------------------------------------
# Two timestamps meet whenever a lap or a capture is matched to the tune save that was on the car, and they are
# written in DIFFERENT time bases:
#   * session ids (fh6_YYYYMMDD_HHMMSS) come from the daemon's time.strftime            -> LOCAL time
#   * tune container folders (Tuning_<ordinal>_<yyyymmddhhmmss>) are stamped by the game -> UTC
# Proven 2026-09-02: a save whose screenshot reads 2026-09-01 22:24:37 local sits in ...20260902022442 on a
# UTC-4 machine, and across all 574 containers the Data file's mtime trails the folder stamp by 2-178 s (median
# 13 s) when the stamp is read as UTC, versus ~4 h when it is read as local.
# Until this was fixed both were parsed with time.mktime (local), so every save appeared ~4 h LATER than it
# was; "newest save written before the lap" then rejected the save that was actually equipped, and 174 of 306
# lap rows in data/laps.db carried tune_hash NULL. Every comparison of the two goes through these helpers, so
# the conversion lives in exactly one place. scripts/telemetry/check_tune_clock.py asserts it against the disk.

def container_epoch(meta_or_ts):
    """Epoch seconds at which a tune container was saved. Accepts a tunes_for_ordinal meta or a bare stamp.
    The folder stamp is the primary source (UTC, written by the game at the save); the Data file's mtime is
    the fallback when the stamp is unparseable. None when neither is available."""
    ts = meta_or_ts.get("ts") if isinstance(meta_or_ts, dict) else meta_or_ts
    try:
        return float(calendar.timegm(time.strptime(str(ts)[:14], "%Y%m%d%H%M%S")))
    except Exception:
        pass
    if isinstance(meta_or_ts, dict) and meta_or_ts.get("mtime") is not None:
        try:
            return float(meta_or_ts["mtime"])
        except Exception:
            return None
    return None


def session_epoch(sid):
    """Epoch seconds at which a capture started. Session ids are fh6_YYYYMMDD_HHMMSS in LOCAL time (the daemon
    names the CSV with time.strftime), so mktime is the right conversion HERE and timegm would be the same bug
    in the other direction. None when the id carries no clock."""
    try:
        return float(time.mktime(time.strptime(str(sid)[4:19], "%Y%m%d_%H%M%S")))
    except Exception:
        return None


def newest_save_before(metas, t_epoch):
    """The newest tune save in `metas` written at or before t_epoch (None = no clock: simply the newest save).
    A save written after the moment in question cannot have been on the car at it."""
    for m_ in sorted(metas or [], key=lambda q: str(q.get("ts") or ""), reverse=True):
        ep_ = container_epoch(m_)
        if ep_ is None:
            continue
        if t_epoch is not None and ep_ > t_epoch:
            continue
        return m_
    return None


def tune_hash_for(cid, sid, t0, gears_seen):
    """Which TUNE REVISION was on the car for the lap starting t0 s into session sid. None unless VERIFIED.

    parts_hash says which build; it excludes sliders by design, so a slider-only change is invisible to every
    existing key and a spring A/B cannot be recorded at all. tune_hash closes that.

    Attribution is timestamp PROPOSES, telemetry DISPOSES: take the newest save for this ordinal written
    before the lap started, then require its gear count to match what the car actually did (`gears_seen` is
    the length of the measured ladder). Timestamp alone is not sound -- session fh6_20260828_001105 measured
    an 8-gear box while the newest save on ordinal 2866 was a 6-gear save from six days earlier, because an
    older tune had been re-applied. When they disagree, return None: an unattributed lap is honest, a wrongly
    attributed one poisons every comparison built on it.

    Module-level rather than a closure so backfill_laps.py --tune-hash re-runs the SAME rule on stored rows."""
    try:
        ordn = int(str(cid).split("|")[0])
    except Exception:
        return None
    try:
        metas, _ = TUNE.tunes_for_ordinal(ordn)
    except Exception:
        return None
    if not metas:
        return None
    se = session_epoch(sid)
    t_abs = (se + float(t0)) if se is not None else None   # no clock in the id: the newest save is the proposal
    best = newest_save_before(metas, t_abs)                # saved after this lap: cannot have been equipped
    if best is None:
        return None
    try:
        tn = TUNE.parse_tune(best["path"], ordinal_hint=ordn)
    except Exception:
        return None
    if gears_seen and tn.get("gear_count") and int(tn["gear_count"]) < gears_seen:
        return None   # the car used a gear this save's box does not have -- it is not what was equipped
    try:
        return TUNE.tune_hash(best["path"])
    except Exception:
        return None


def saved_build_for(cid_, sid_, gears_seen, boost_max, wot_frames):
    """The on-disk tune save that was EQUIPPED for this capture, as {slot: decoded row}. None when it cannot be proven.

    The 598-byte save carries every part slot byte-exact, which retires eleven clone-sheet rows that used to say
    "🔍 shop check" or assert an unmeasured "🟡 inferred" race part. But only if the RIGHT save is used: ordinal 2866
    alone holds six saves whose parts genuinely differ (Race vs Sport differential, three rim styles, two tyre
    widths), so a naive `metas[0]` would stamp ANOTHER build's parts into the deliverable at confidence 1.0 —
    strictly worse than an honest "needs a shop check".

    Same discipline as _tune_hash_for: TIMESTAMP PROPOSES, TELEMETRY DISPOSES.
      propose — the newest save for this ordinal written before the capture started (a save written after the
                drive cannot have been on the car during it)
      dispose — its gearbox must hold at least the gears the car actually used, and its aspiration must not
                contradict the measured boost
    Any doubt returns None and the caller keeps the old shop / inferred row. READ-ONLY: never writes to the save."""
    try:
        ordn = int(str(cid_).split("|")[0])
    except Exception:
        return None
    t_start = session_epoch(sid_)        # session ids are fh6_YYYYMMDD_HHMMSS in LOCAL time
    if t_start is None:
        return None                      # no capture clock means no sound attribution — say nothing
    try:
        metas, _ = TUNE.tunes_for_ordinal(ordn)
    except Exception:
        return None
    # container stamps are UTC; newest_save_before reads them through container_epoch, on the capture's clock
    best = newest_save_before(metas, t_start)   # saved after the capture began: cannot have been equipped for it
    if best is None:
        return None
    try:
        tn = TUNE.parse_tune(best["path"], ordinal_hint=ordn)
    except Exception:
        return None
    if gears_seen and tn.get("gear_count") and int(tn["gear_count"]) < gears_seen:
        return None                      # the car used a gear this save's box does not have — not what was fitted
    forced = any(tn["parts"].get(s) is not None for s in TUNE.ASPIRATION_TYPE)
    if (boost_max or 0) > 0.5 and not forced:
        return None                      # the stream measured boost and this save is naturally aspirated
    if forced and (boost_max or 0) <= 0.5 and (wot_frames or 0) >= 300:
        return None                      # plenty of full throttle and never a psi: not this save's charger
    try:
        dl = TUNE.tune_to_deliverable(tn)
    except Exception:
        return None
    by_slot = {r["item"]: r for m_ in dl.get("menus", []) for r in m_.get("rows", []) if r.get("value")}
    if not by_slot:
        return None
    ts_ = str(best.get("ts") or "")
    return {"parts": by_slot, "ts": ts_, "ordinal": ordn, "locked": bool(tn.get("locked")), "gear_count": tn.get("gear_count"),
            "when": (f"{ts_[0:4]}-{ts_[4:6]}-{ts_[6:8]} {ts_[8:10]}:{ts_[10:12]}" if len(ts_) >= 12 else ts_)}


def clone_sheet_for(c, bat, sid=None, ord_rebuilt=False):
    """The decode deliverable: a standardized upgrade sheet organized like the in-game upgrade shop menus. Each row carries what to install /
    match, a status (measured = stream fact OR byte-exact save decode · inferred = assumption · shop = needs a shop / HUD check) AND a
    confidence EARNED from evidence: how many independent measurements back the figure and how consistent they are — never a single reading."""
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
    # ---- PARTS OFF THE SAVE. Eleven rows below used to be un-earnable: seven "🔍 shop check" rows carry confidence
    # None by construction (see row(), above), so no amount of driving could ever satisfy them, and four "🟡 inferred"
    # rows ASSERTED race brakes / springs / ARBs / differential at 0.55 — on this very build the save reads Stock,
    # Stock, Stock, Race Differential, so three of the four assumptions were simply false. Every one of those slots is
    # byte-exact in the 598-byte save. Attribution is the whole risk (saved_build_for), so a failure there silently
    # keeps the old honest row rather than printing another build's parts as fact.
    # ord_rebuilt: this capture holds MORE THAN ONE configuration of the same car, so parts were changed mid-drive
    # (one AZ-1 capture ran configs at PI 342/600/700/800/899). The single pre-capture save can be right for at most
    # one of them and nothing here can say which, so none of them get it.
    dec = None
    try:
        dec = saved_build_for(c["id"], sid, len(lad), boost, wot) if (sid and not ord_rebuilt) else None
    except Exception:
        dec = None       # the deliverable must never fail because a save could not be read
    dec_ev = (f"tune save {dec['when']}" + (" (downloaded / locked)" if dec["locked"] else "") +
              f" · byte-exact · its {dec['gear_count']}-speed box matches the ladder measured at WOT") if dec else None
    def _pv_text(v):
        """One decoded slot's display text, minus the category name a dimension slot repeats ("Rear Tire Width · level 4" -> "level 4")."""
        s = str(v.get("value") or ""); cat = str(v.get("category") or "")
        return s[len(cat) + 3:] if (cat and s.startswith(cat + " · ")) else s
    def drow(item, slots, note=None):
        """A clone-sheet row read straight off the attributed save, or None when it cannot supply one (caller falls back)."""
        vs = [v for v in ((dec["parts"].get(s) if dec else None) for s in slots) if v]
        if not vs: return None
        confs = [v.get("conf") for v in vs]
        cv = min(DEC_CONF.get(x, 0.8) for x in confs)   # a combined row is only as good as its weakest slot
        val = " · ".join((_pv_text(v) if len(vs) == 1 else f"{v['category']}: {_pv_text(v)}") for v in vs)
        # the tyre INDEX is exact; its NAME is a global enum. One in-game set + save on any car names it for every car.
        nds = "name this tyre index once in-game on any car and save — scripts/telemetry/anchor_compound.py maps it for all cars" if "compound" in confs else None
        return {"item": item, "value": val, "status": "measured", "note": note, "gate": None, "pending": False,
                "confidence": round(cv, 2), "evidence": dec_ev + f" · {len(vs)} part slot{'s' if len(vs) != 1 else ''}", "needs": nds}
    menus = [
        {"menu": "Conversions", "items": [
            row("Engine", f"{c['cyl']}-cyl · redline {c['max_rpm']} rpm · idle {c['idle_rpm']}", "measured", "if this differs from the stock engine, an engine swap is installed — the shop's swap list + these specs identify which", None, const_conf, const_ev),
            row("Drivetrain", c["drivetrain"], "measured", "install the drivetrain swap only if the stock layout differs", None, const_conf, const_ev),
            row("Aspiration", asp_v, "measured", asp_n, "dyno" if boost <= 0.5 else None, asp_conf, asp_ev, asp_needs),
            drow("Body kit", ["car_body"], "invisible to telemetry — the save's body slot names it outright") or
            row("Body kit", None, "shop", "not visible in telemetry — check visually"),
        ]},
        {"menu": "Engine", "items": [
            row("Total output target", (f"{sig.get('hp_peak')} hp @ {sig.get('rpm_at_peak')} rpm · {sig.get('tq_peak')} lb-ft" if sig.get("hp_peak") else None), "measured",
                f"any bolt-on stack that reproduces this curve is functionally identical — and the parts list must sum to PI {c['pi']}", "dyno", eng_conf, eng_ev, eng_needs),
        ]},
        {"menu": "Platform & Handling", "items": [
            drow("Brakes", ["brakes"], "gates the brake tabs a tuned donor uses — this is the tier actually fitted, not the one we used to assume") or
            row("Brakes", "race brakes", "inferred", "assumed — required for the brake tabs a tuned donor uses; confirm in the shop"),
            drow("Springs & dampers", ["springs_dampers"], "gates the spring/damper tabs; the behaviour match still happens on the Bench") or
            row("Springs & dampers", "race springs", "inferred", "assumed — required for spring/damper tabs; behaviour match happens on the Bench"),
            drow("Anti-roll bars", ["front_arb", "rear_arb"], "gates the ARB tab — both bars are separate slots in the save") or
            row("Anti-roll bars", "race ARBs", "inferred", "assumed — required for the ARB tab"),
            row("Weight (mass index)", (f"~{sig.get('mass_idx')} (relative index)" if sig.get("mass_idx") else None), "inferred", "brackets the weight-reduction tier once compared against stock", "launch", mass_conf, mass_ev, mass_needs),
        ]},
        {"menu": "Drivetrain", "items": [
            row("Transmission", (f"{sig.get('gear_count')}-speed → race {sig.get('gear_count')}-speed" if sig.get("gear_count") else None), "measured", None, "gears", trans_conf, trans_ev, trans_needs),
            row("Gear ratios (tune)", lad_v, "measured", "tune-side: set final drive + per-gear until the WOT ladder matches these exactly", "gears", ratio_conf, ratio_ev, ratio_needs),
            drow("Differential", ["differential"], "gates the accel/decel lock tabs — the diff TYPE, not an assumed race unit") or
            row("Differential", "race differential", "inferred", "assumed — required for accel/decel lock tabs"),
            drow("Clutch / driveline", ["clutch", "driveline"], "no telemetry signature at all — both slots come straight off the save") or
            row("Clutch / driveline", None, "shop", "no telemetry signature — PI budget usually decides these"),
        ]},
        {"menu": "Tires & Rims", "items": [
            drow("Compound", ["tire_compound"], "the compound INDEX is byte-exact; its NAME is a global enum that has to be anchored once in-game") or
            row("Compound", None, "shop", "My Cars pane shows it — one screenshot, or the 20-s HUD clip"),
            drow("Front / rear width", ["front_tire_width", "rear_tire_width"], "per-axle width level — the Centenario lesson, without the screenshot") or
            row("Front / rear width", None, "shop", "shop INSTALLED tiles only — the Centenario lesson"),
            drow("Rims / track width", ["front_rim_size", "rear_rim_size", "rim_style", "rear_rim_style", "front_track_width", "rear_track_width"],
                 "rim style is cosmetic; track width moves the actual geometry") or
            row("Rims / track width", None, "shop", "rim style cosmetic; track width from shop tiles"),
        ]},
        {"menu": "Aero & Appearance", "items": [
            drow("Front aero", ["front_bumper"], "fast-sweeper balance only ever hinted at presence — the save names the part") or
            row("Front aero", None, "shop", "fast-sweeper balance hints presence, never the exact part — check shop/visual"),
            drow("Rear wing", ["rear_wing"], "speed-binned lat-g only ever hinted at presence — the save names the part") or
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
            # which save the parts rows were read from — null means attribution failed and those rows are still shop/inferred
            "save_attribution": ({"ts": dec["ts"], "when": dec["when"], "ordinal": dec["ordinal"], "locked": dec["locked"], "gear_count": dec["gear_count"]} if dec else None),
            "build_record": ({"label": rec.get("label"), "captured": rec.get("captured"), "source": rec.get("source"), "tune_share_code": rec.get("tune_share_code"), "file": rec.get("_file")} if rec else None),
            "pi_note": f"cross-check: every proposed parts list must sum to PI {c['pi']} — a mismatch means a missed part (usually widths or aero)"}

FAST_MAX_TURNS = 24   # stamped turns per course — a hard bound on turns x K x points
FAST_K = 3            # lines kept per turn
FAST_PTS = 12         # points drawn per line — on the 4 m lap grid that covers a 48 m corner at full resolution
FAST_MIN = 3          # fewer clean traversals than this and a median means nothing — emit no block at all
FAST_APEX_M = 25.0    # a clipped window whose nearest sample misses the apex by more is the WRONG piece of road
FAST_COVER = 0.9      # the window must span this much of the turn (0.95 fails on the 4 m grid: the edges fall between samples)
FAST_RATIO = 2.5      # a traversal this many times the median is a stopped car, not a lap


def _fast_pick(seg, n):
    """Evenly thin a window to n samples, endpoints kept — the line must still reach the turn's edges."""
    if len(seg) <= n:
        return seg
    last = len(seg) - 1
    return [seg[int(round(i * last / (n - 1)))] for i in range(n)]


def fast_lines(laps, turns):
    """Per turn, the fastest documented lines through it — precomputed so the dashboard only has to draw.

    Ranking is by TRAVERSAL TIME through the turn's own arc span, sum(delta_arc / speed). Whole-lap `lap_s`
    is corrupted by pause time, so a lap that is slow overall can still hold the fastest line through one
    corner — which is also why the caller must pass EVERY stored lap: the 107% competitive rule rides on
    that same broken lap_s and would delete the corner-fastest line in 7 of this course's 13 corners.

    Three rejections, in this order, because the one 91 s reading has two different causes:
      1. GEOMETRY — a partial lap carries a shifted arc origin, so clipping by arc alone measures the wrong
         piece of road. Such a window scores FALSELY FAST (it lands on a straight), so it cannot be left to
         a slow-side ratio test to catch.
      2. COVERAGE — a window that does not span the turn is not a traversal of it.
      3. RATIO — what remains is the car that stopped.
    There is deliberately NO fast-side ratio test. A line taken flat where the median lap brakes to half
    speed is exactly what this feature exists to find; only geometry may reject a fast reading.
    """
    # BOUND THE PAYLOAD. Cost is ~1.4 KB per stamped turn and the course model is read-modify-WRITTEN every
    # analysis cycle (20-90 s), so an over-detected model is the failure case: 4200_-5450 currently carries 172
    # turns and would add ~238 KB per rewrite. Stamp only the turns with the most time ACTUALLY available -- the
    # ones the feature exists for -- and never more than FAST_MAX_TURNS. Turns are scored first, then trimmed.
    made = 0
    for t in turns:
        t.pop("lines", None)   # a turn that no longer qualifies must lose its stale block, not keep it
        ax, s = t.get("apex"), t.get("s")
        if not ax or s is None:
            continue
        half = max(20.0, (t.get("len_m") or 40) / 2.0)
        s0, s1 = s - half, s + half
        cand, n_rej = [], 0
        for lp in laps:
            seg = [p for p in (lp.get("pts") or []) if len(p) >= 5 and s0 <= p[0] <= s1]
            if len(seg) < 4:
                continue   # this lap simply does not cover the turn — not a rejection
            if (seg[-1][0] - seg[0][0]) < FAST_COVER * (s1 - s0) or min(math.hypot(p[3] - ax[0], p[4] - ax[1]) for p in seg) > FAST_APEX_M:
                n_rej += 1
                continue
            tt = 0.0
            for a, b in zip(seg, seg[1:]):
                v = (a[1] + b[1]) * 0.5 * 0.44704   # mph -> m/s, trapezoid across the step
                if v <= 0.1:
                    tt = None
                    break
                tt += (b[0] - a[0]) / v
            if not tt:
                n_rej += 1
                continue
            cand.append((tt, lp, seg))
        if len(cand) < FAST_MIN:
            continue
        _ts = sorted(c[0] for c in cand)
        cut = FAST_RATIO * _ts[len(_ts) // 2]
        keep = sorted((c for c in cand if c[0] <= cut), key=lambda c: c[0])
        n_rej += len(cand) - len(keep)
        if len(keep) < FAST_MIN:
            continue
        _ts = [c[0] for c in keep]
        best, mid = _ts[0], _ts[len(_ts) // 2]
        fast = []
        for tt, lp, seg in keep[:FAST_K]:
            # "x,z,grip,x,z,grip,..." — one STRING, not an array. json.dump(indent=1) puts every array scalar on
            # its own line, so an honest [[x,z,grip],...] spends ~250 of its ~430 bytes per line on whitespace;
            # the string is the same integers, losslessly, at a third of the cost (+8.7% -> +4.6% on the model).
            pts = ",".join(str(v) for p in _fast_pick(seg, FAST_PTS)
                           for v in (int(round(p[3])), int(round(p[4])), int(p[2] or 0)))
            # lap_s is deliberately NOT carried: it is pause-corrupted, and a whole-lap time sitting next to a
            # corner time is an invitation to rank on the wrong one.
            fast.append({"t_s": round(tt, 2), "mph_min": round(min(p[1] for p in seg)), "cid": lp.get("cid"),
                         "build_id": lp.get("build_id"), "class": lp.get("class"), "session": lp.get("session"),
                         "void": bool(lp.get("void")), "pts": pts})
        t["lines"] = {"v": 1, "n_laps": len(keep), "n_rejected": n_rej, "cut_s": round(cut, 2),
                      "s_in": round(s0), "s_out": round(s1), "best_s": round(best, 2), "median_s": round(mid, 2),
                      "available_s": round(mid - best, 2), "fast": fast}
        made += 1
    if made > FAST_MAX_TURNS:
        ranked = sorted((t for t in turns if t.get("lines")),
                        key=lambda t: -(t["lines"].get("available_s") or 0))
        for t in ranked[FAST_MAX_TURNS:]:
            t.pop("lines", None)
        made = FAST_MAX_TURNS
    return made


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
                                "live_frames": 0, "_gear": defaultdict(list), "_fdgear": defaultdict(list), "_dyno": defaultdict(list), "_k": {w: [] for w in W}, "_boost": 0.0, "_mass": [], "_massclean": [], "_shift": [], "_prev": None, "_pull": None, "_pulls": [], "_boost_n": 0, "temps_max_f": {w: 0 for w in W}})
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
            _dw = ("FL", "FR") if r["DrivetrainType"] == 0 else ("RL", "RR") if r["DrivetrainType"] == 1 else W
            _wr = [r["WheelRotSpeed" + w] for w in _dw if r["WheelRotSpeed" + w] > 1.0]
            if _wr: c["_fdgear"][r["Gear"]].append(r["CurrentEngineRpm"] * 0.1047197551 / (sum(_wr) / len(_wr)))   # engine_rad_s / driven-wheel_rad_s = FD x gear (exact, tire-radius-free; holds through wheelspin)
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
        if (r["Gear"] >= 3 and 0.8 < r["AccelZ"] < 4.0 and 8 < r["Speed"] < 35 and abs(r["AccelX"]) < 1.0
                and r["Power"] > 3000 and max(abs(r["SlipRatio" + w]) for w in W) < 0.03):
            c["_massclean"].append(0.85 * r["Power"] / (r["Speed"] * r["AccelZ"]))   # wheelspin-free F=ma, driveline-corrected -> kg
        if r["Accel"] < 10 and r["Brake"] < 10 and r["Speed"] > 8:
            for w in W: c["_k"][w].append(r["WheelRotSpeed" + w] / r["Speed"])
    for c in cars.values():
        base = None; lad = []
        for g in sorted(c["_gear"]):
            if len(c["_gear"][g]) < 25: continue
            m = statistics.median(c["_gear"][g]); base = base or m
            _e = {"gear": g, "mps_per_krpm": round(m * 1000, 3), "rel": round(m / base, 3), "n": len(c["_gear"][g])}
            _fg = c["_fdgear"].get(g)
            if _fg and len(_fg) >= 10: _e["fd_gear"] = round(statistics.median(_fg), 4)   # EXACT final-drive x gear from WheelRotSpeed
            lad.append(_e)
        c["gears"] = lad
        c["dyno"] = [{"rpm": k, "hp": round(statistics.median([p for p, q in v])), "tq": round(statistics.median([q for p, q in v])), "n": len(v)} for k, v in sorted(c["_dyno"].items()) if len(v) >= 8]
        c["k_wheel"] = {w: (statistics.median(c["_k"][w]) if c["_k"][w] else None) for w in W}
        _mc = c["_massclean"]
        c["mass_measured"] = ({"lb": round(statistics.median(_mc) * 2.205), "kg": round(statistics.median(_mc)), "n": len(_mc)}
                              if len(_mc) >= 20 else {"n": len(_mc)})   # physics-battery mass probe (needs a clean roll-on maneuver)
        _kv = [v for v in c["k_wheel"].values() if v]   # k_wheel = WheelRotSpeed/Speed = 1/tyre_radius, so radius = 1/k
        c["tire_radius_m"] = round(1.0 / (sum(_kv) / len(_kv)), 3) if _kv else None   # EXACT rolling radius from telemetry (no user input)
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
        # _fdgear was missing from this list and nothing else was: it is 42.9 MB of the 86.3 MB of session
        # files on disk -- HALF of everything analyze_session has ever written -- and it rides into
        # dashboard/db.js, which the browser parses on every load. A per-car scratch accumulator, published
        # forever because one name was left out of a delete.
        for k in ("_gear", "_fdgear", "_dyno", "_k", "_boost", "_mass", "_massclean", "_shift", "_prev",
                  "_pull", "_pulls", "_boost_n"): c.pop(k, None)
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
                # surface the corner was taken on (road vs rough): sustained SurfaceRumble across the corner, not a one-frame kerb clip
                sr = [max(r["SurfaceRumbleFL"], r["SurfaceRumbleFR"], r["SurfaceRumbleRL"], r["SurfaceRumbleRR"]) for r in seg]
                rough_frac = round(sum(1 for x in sr if x > 0.1) / len(sr), 2) if sr else 0.0
                surface = "rough" if rough_frac > 0.35 else "smooth"
                corners.append({"t0": round(seg[0]["t"], 1), "t1": round(seg[-1]["t"], 1), "car": cid(seg[0]), "dir": "R" if sign > 0 else "L", "surface": surface, "rough_frac": rough_frac,
                                "ev": 1 if sum(1 for r in seg if r["CurrentLap"] > 0) > len(seg) / 2 else 0,   # J14: honest event flag (lap timer running) — free-roam corners must not steer course baselines. Majority vote across the corner's own rows, not one apex frame, to match the live daemon's identical hardening
                                "apex": [round(apx["PosX"]), round(apx["PosZ"])], "dist": round(apx["DistanceTraveled"]), "mph_apex": round(apx["speed_mph"]),
                                "mph_in": round(v_in), "mph_min": round(v_min), "mph_out": round(seg[-1]["speed_mph"]), "lat_g_peak": round(peak, 2), "phases": phases, "first_red": first, "usi": round(usi, 3),
                                "entry": [round(seg[0]["PosX"]), round(seg[0]["PosZ"])], "exit": [round(seg[-1]["PosX"]), round(seg[-1]["PosZ"])],
                                "brake_on_m": (round(apx["DistanceTraveled"] - brk["DistanceTraveled"]) if brk else None), "throttle_on_m": (round(thr["DistanceTraveled"] - apx["DistanceTraveled"]) if thr else None), "radius_m": radius,
                                "drift": drift, "kink": v_min > 85 and peak < 0.9, "brake_max": max([r["Brake"] for r in pre + seg] or [0]), "hb": any(r["HandBrake"] > 0 for r in seg)})
            i = j
        else: i += 1
    sess["corners"] = corners
    # each car's measured GRIP (90th-pct peak lateral g over its non-drift corners) — the car-dependent factor that lets course geometry transfer between cars
    car_grip = {}; car_grip_src = {}
    for k_ in cars:
        gs = sorted(x["lat_g_peak"] for x in corners if x["car"] == k_ and not x["drift"] and x.get("ev"))   # J14: grip from committed on-course corners — free-roam cruising drags the 90th percentile down
        _src = "ev"
        if len(gs) < 5: gs = sorted(x["lat_g_peak"] for x in corners if x["car"] == k_ and not x["drift"]); _src = "fallback"   # too few on-course samples yet — fall back to everything rather than report nothing
        if len(gs) >= 5: car_grip[k_] = round(gs[int(0.9 * (len(gs) - 1))], 2); car_grip_src[k_] = _src
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
        inev = r["CurrentLap"] > 0   # the LAP TIMER running is the honest event flag — RacePosition lingers > 0 in free roam after an event ends
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
    def attribute_route(sx, sz, hdg, dist, sample, has_line=False):
        best = None
        for k, R in routes.items():
            if k.startswith("loop:"): continue
            st = R.get("start")
            d0 = math.hypot(sx - st[0], sz - st[1]) if st else None
            mp = model_path_for(k); ov, cov = overlap(sample, mp)
            # 1) PATH match: this event runs along the known route's path in the same direction — the start can be ANYWHERE on it (a circuit resumed mid-lap, a fragment).
            # Needs only the MODEL path, so a route whose registry start was lost (older naming writes wiped it) stays matchable — skipping those minted duplicates.
            # LYING ON A ROUTE IS NOT BEING THAT ROUTE. Jett: "not all courses are independent. the colossus is
            # a giant course that involves segments that may be in other courses as well." FH6 has 25 road events
            # and this registry holds 23 keys, so drive an unregistered sprint whose tarmac is part of the
            # Colossus and ov = 1.00 against the Colossus: the sprint is filed under -3750_300 and can never mint
            # its own key. Its laps join the Colossus's history, its corners are measured as Colossus corners.
            # d0 was in this branch already, as a 0.01-per-metre TIEBREAK -- a line 3 km away cost 30 points
            # against a base of 200, which decides nothing. It is not a tiebreak, it is the whole question.
            # The anchor above makes it answerable: when this event completed a lap, sx/sz is the row where the
            # timer started, which IS the start/finish line, and it lands within a few metres on every attempt
            # (measured 3 m apart on the Colossus). Two drives that begin at DIFFERENT lines are different
            # courses however much tarmac they share, so a drive with a line of its own may only path-match a
            # route whose line is the same line.
            # Without a completed lap there is no line to compare -- sx/sz is wherever the window opened, the
            # very artefact this guard would be reading -- so a fragment keeps the old permissive behaviour and
            # is still absorbed by the road that contains it, which is what should happen to a fragment.
            # COVERING A ROUTE MEANS YOU ARE THAT ROUTE, wherever you joined it. cov is the share of the known
            # route this drive covered, and it was already computed here and used only by rule 2. Without it a
            # line gate alone blocked a drive with ov=0.95 and cov=1.00 -- one that traversed all of
            # -6800_-1100 -- purely because it entered 3366 m from the registered start, and minted a
            # geometry-less duplicate. A drive that covered the whole road is the same course entered
            # elsewhere; only a drive covering a SLIVER can be a different course sharing tarmac, and that is
            # exactly where the line has to decide. Measured on the same session: the two genuinely separate
            # drives scored cov=0.12 and cov=0.13 against the Colossus with their own line 3.4 km from its
            # line, so they mint their own keys, which is the whole point of the guard.
            # 600 m rather than 150: the anchor lands within metres when a real lap completes, but a partial
            # with a spurious timer reset anchors wherever it split, and two real start/finish lines are
            # kilometres apart -- so the threshold sits above that jitter and far below the real separation.
            _covers = cov is not None and cov >= 0.70
            _line_ok = _covers or (not has_line) or d0 is None or d0 <= 600
            if ov is not None and ov >= 0.7 and _line_ok and direction_agree(sample, mp[1]):
                cand = (200 + (d0 or 0) * 0.01, k)
                if best is None or cand[0] < best[0]: best = cand
                continue
            if d0 is None or d0 > 250: continue
            # 2) START match: close start + same heading; the known path (if any) must agree — either this event lies on it (ov) or it covers it (cov: the known path was a stub from an aborted attempt)
            hR = R.get("heading")
            if hR and hdg and (R.get("length_m") or 0) >= 200 and (hR[0] * hdg[0] + hR[1] * hdg[1]) < 0.3: continue   # heads the other way = a different (reversed) route
            path_ok = (ov is None) or ov >= 0.5 or (cov is not None and cov >= 0.8)
            if d0 <= 40 and (R.get("length_m") or 0) < 600: cand = (d0, k)   # the SAME start point and the registered route is only a stub (aborted attempts) — it is this route
            elif d0 <= 120 and path_ok: cand = (d0, k)
            # 0.55, not 0.7: two runs of ONE course that start ~200 m apart (a Rivals restart placing you
            # differently) share only ~60% of their sampled path, yet genuinely distinct routes score 0.00-0.05
            # — the margin is enormous, and 0.7 was re-minting a duplicate course on every re-analysis.
            elif d0 <= 250 and ov is not None and ov >= 0.55: cand = (d0 + 100, k)
            else: continue
            if best is None or cand[0] < best[0]: best = cand
        return best[1] if best else None
    def _is_rollup(sx, sz, sample):
        """The reverse run up to a Rivals start line is not a course. Returns True to DISCARD this event.

        Jett: "on circuits for rivals you dont do a standing start so when the match starts I automatically
        reverse and gain speed before the start/finish line", and "the u turns for rolling start at the
        beginning of a rivals track is not useful data (for this) and is distracting from the actual data".
        Measured, that is exactly what -3750_300_29 is: 836 m of road lying 100% on the Colossus, starting 15 m
        from the Colossus's own start/finish line, covering 2% of it, driven the other way. attribute_route
        rejects it on direction -- correctly, since a reversed route IS a different course in this game -- and it
        then mints its own key, which is how the Colossus keeps sprouting _29 / _30 / _32 siblings.

        COVERAGE IS WHAT SEPARATES A REVERSE VARIANT FROM A ROLL-UP. A real reverse route runs the whole road;
        a roll-up backs a few hundred metres off the line and turns around. So: lying almost wholly on a known
        route, beginning at THAT route's line, covering almost none of it, and heading the wrong way. All four,
        or it is a course and keeps its key.
        """
        for k, R in routes.items():
            if k.startswith("loop:"):
                continue
            st = R.get("start")
            if not st:
                continue
            # ASK THE WHOLE DRIVE, NOT ITS ANCHOR. This compared only sx/sz, the event's anchor -- and when no
            # lap completes the anchor falls back to the first row with DistanceTraveled >= 0, which on a
            # reverse roll-up is hundreds of metres down the road: measured 212 m past the Colossus line, so a
            # 4432 m roll-up sailed through this 120 m gate and minted -3550_400, a 31st course made entirely
            # of Colossus tarmac driven backwards. A roll-up BEGINS at the line and reverses away from it, so
            # the drive passes right by it whatever the anchor says; the closest approach is the honest test
            # and it does not depend on an anchor that only a completed lap makes trustworthy.
            _near_line = math.hypot(sx - st[0], sz - st[1])
            for _px, _pz in sample:
                _d = math.hypot(_px - st[0], _pz - st[1])
                if _d < _near_line:
                    _near_line = _d
                    if _near_line <= 120: break
            if _near_line > 120:
                continue                                  # the drive never comes near this route's line
            mp = model_path_for(k)
            if not mp:
                continue
            ov, cov = overlap(sample, mp)
            if ov is None or cov is None:
                continue
            if ov >= 0.90 and cov <= 0.15 and not direction_agree(sample, mp[1]):
                _rl = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(sample, sample[1:]))
                print("  [rollup] discarded %.0f m at %s's start line — lies %d%% on it, covers %d%% of it, "
                      "and runs the other way" % (_rl, k, round(100 * ov), round(100 * cov)))
                return True
        return False

    ev_out = []
    for ev in events:
        rs = ev["rows"]
        if rs[-1]["t"] - rs[0]["t"] < 5: continue
        start = next((q for q in rs if q["DistanceTraveled"] >= 0), rs[0])
        sx, sz = start["PosX"], start["PosZ"]; ex, ez = rs[-1]["PosX"], rs[-1]["PosZ"]
        # KEY THE ROUTE BY ITS START/FINISH LINE, NOT BY WHERE THE CAPTURE WINDOW OPENED.
        # rs[0] is wherever telemetry happened to start this event — after a reset, mid-drive to the grid, or
        # part-way round. On a short circuit that is close enough to the line to round into the same 50 m cell;
        # on a long one it is not, and every attempt keys somewhere different and mints its OWN course. That is
        # how three completed Colossus laps (372.00 / 374.39 / 382.09 s) became five loose A-to-B fragments —
        # -2650_-5300, -6350_-750, -6800_-1250, -1300_1600 and a -3750_300_32 — instead of one route.
        #
        # The line itself is observable: CurrentLap counts up and drops to ~0 for one packet as you cross it. So
        # when this event contains a completed lap, the crossing point IS the course's start/finish, and it is
        # the same place on every attempt. Measured on that session: crossings at [-3773,304] and [-3775,307],
        # 3 m apart, both of which round to the one key. Where no lap completed there is no line to find and the
        # window start stands, as before.
        # THE LAP STARTS WHERE THE TIMER STARTS. On a single-lap Rivals run the timer does not RESET mid-window —
        # it simply begins at the line and stops at it, so a reset-detector never fires and the anchor stayed at
        # whatever the window opened on: the approach, the turnaround, wherever the capture caught you. That is
        # why a complete 23.41 mi lap still minted a brand-new key (_29, then _30) anchored 5 km from the line,
        # and why the event measured 27.45 mi — approach plus lap — instead of the lap.
        # The 0 -> running transition IS the start line, and it is the same place on every attempt.
        # AN EVENT IS NOT A LAP — split it into laps FIRST, because both the anchor and the length need them.
        # Event rows are already gated on CurrentLap > 0 (:1177), so the approach's zero rows are gone; what is
        # still inside one event is MULTIPLE laps. Measured on the Colossus event: 66,721 rows / 27.44 mi that
        # split cleanly at the two timer resets into 1.40 mi (the roll-up), 23.41 mi (THE LAP), and 2.62 mi (a
        # partial after). Taking the whole event is what made a 23.41 mi road register as 27.45 mi.
        #
        # CurrentRaceTime distinguishes the two resets and is why this is unambiguous: it runs across a lap
        # completion (measured 421.6 s of race time when the 370.6 s lap finished — 51 s of roll-up before it)
        # and returns to 0 only on a RESTART. So a CurrentLap reset with race time still climbing is a lap
        # boundary, full stop.
        # COUNT THE CROSSINGS. `_lap_rows is not rs` was used below to mean "this event completed a lap", and it
        # cannot: _cur is a FRESH list appended unconditionally at the end, so with no reset at all _lap_rows is
        # a different object holding exactly the same rows, and the test is True for every event over 30 rows --
        # which the 5 s floor guarantees. Measured across three captures: every event reported has_line=True,
        # including dozens with zero resets. The line gate in attribute_route was therefore applied to
        # FRAGMENTS, which its own comment says must stay permissive, and two pieces of the Colossus -- 8812 m
        # and 24088 m, both lying 100% on it -- were blocked from their own road and minted as separate courses.
        # A count of actual crossings is the thing being asked about, so count them.
        _laps_in, _cur, _prow, _resets = [], [], None, 0
        for q in rs:
            if _prow is not None and _is_lap_boundary(_prow, q):
                _resets += 1
                if len(_cur) > 30: _laps_in.append(_cur)
                _cur = []
            _cur.append(q); _prow = q
        if len(_cur) > 30: _laps_in.append(_cur)
        _lap_rows = max(_laps_in, key=lambda L: len(L)) if _laps_in else rs   # the longest lap describes the road best
        # the lap's first row IS the line — the timer starts as you cross it, the same place on every attempt,
        # where the event's own first row is wherever the roll-up happened to begin
        if _resets and _lap_rows:
            start = _lap_rows[0]; sx, sz = start["PosX"], start["PosZ"]
        # The legacy crossing-detector lived here and OVERWROTE the anchor above. Its first test —
        # `_prev_cl <= 0.01 and _cl > 0` — was meant to catch the 0 -> running transition, but event rows are
        # already gated on CurrentLap > 0 and therefore BEGIN at ~0.01, so it matched the event's second row
        # every time, anchored on the roll-up, and broke out. That is why a 23.41 mi lap kept registering its
        # start 5 km from its own line.
        # Nothing replaces it: _lap_rows[0] is the first row of the timed lap, which IS the start/finish line,
        # and it is the same place on every attempt. The line is the firm anchor; length, turns and per-turn
        # statistics all extrapolate from it, so it is the one thing that must not be inferred loosely.
        # LENGTH FROM THE PATH, NOT FROM THE ODOMETER. DistanceTraveled under-reports badly on long routes —
        # measured on a complete 23.41 mi Colossus lap it read 6,621 m against a 37,671 m path, 5.7x short. That
        # value sets routes[key]["length_m"] and feeds attribute_route, so every attempt registered a 6.6 km route
        # where the road is 37.7 km and nothing could ever match anything: the lap WAS captured (last_lap 370.646)
        # and filed under yet another new key.
        # The path is corroborated independently: mean Speed x wall-clock gives 23.36 mi against the path's 23.41,
        # and CurrentLap, CurrentRaceTime and TimestampMS all agree on 370 s. Three sources against one outlier.
        # The odometer is still used as a floor, so a route whose path is fragmentary is not under-reported either.
        # ...and the same rule for the event's own LENGTH and ANCHOR. Geometry alone was not enough: `dist` still
        # summed every row, so a 23.41 mi lap reported 27.45 mi — lap plus approach plus U-turn — and that number
        # is what sets routes[key]["length_m"] and feeds attribute_route. Measure the LAP.
        # AN EVENT IS NOT A LAP. Event rows are already gated on CurrentLap > 0 (see :1177), so filtering them
        # again is a no-op — and it also means the 0 -> running transition is never visible inside one, because
        # the zero rows were dropped before the event was cut. What IS visible is the RESET: the timer running to
        # a peak and dropping to ~0 as you cross. Split there and an event resolves into its laps.
        # This matters because an event routinely spans more than one: the 23.41 mi Colossus lap sat in a 27.45 mi
        # event with the tail of the previous attempt in front of it, and that surplus was what set the route's
        # length and anchored its key 5 km from the line.
        _dp = [(q["PosX"], q["PosZ"]) for q in _lap_rows]
        _darc = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(_dp, _dp[1:])
                    if math.hypot(b[0] - a[0], b[1] - a[1]) < 150)   # skip teleports/respawns
        # NOT max() with the odometer. DistanceTraveled increments by a near-constant ~5,954 per lap regardless of
        # lap length — measured identical on a 1,036 m Edamame lap and a 37,671 m Colossus lap — so it is not a
        # distance in any usable sense, and max() would let it inflate a correctly-measured road.
        dist = _darc
        laps = max(q["LapNumber"] for q in rs)
        pos = [q["RacePosition"] for q in rs if q["RacePosition"] > 0]
        # MODE is INFERRED, never read: the 324-byte Data Out packet carries no game-mode field (verified —
        # Trailing323 is always 0, and NormAIBrakeDiff/NormDrivingLine are identical in both modes because the
        # driving-line assist runs in Rivals too). RacePosition is the only signal: it varies or exceeds 1 in a
        # race, and is a constant 1 in a solo time trial. The known hole is a race led wire-to-wire in P1, which
        # is why `solo_conf` is published — a course can be DECLARED Rivals (routes.json "rivals") to settle it.
        # `pos` EMPTY means RacePosition was 0 all event — no evidence either way. `not (pos and ...)` returned
        # True there, coercing absence of evidence into "confirmed solo", which then made those laps voidable.
        # Solo must be a positive finding: a position was reported, and it never varied and never exceeded 1.
        solo = bool(pos) and not (max(pos) > 1 or len(set(pos)) > 1)
        mode = "timed solo (Rivals / time trial)" if solo else "race"
        solo_conf = "inferred" if solo else "certain"   # upgraded to 'declared' at course level, where the route key is known
        if laps > 0: mode += " · lapped"
        # MEASURE THE HEADING OVER FORWARD MOTION ONLY. On a Rivals circuit there is no standing start: you
        # REVERSE back from the line and cross it already at speed. The window therefore opens with the car
        # travelling BACKWARDS along the route, and a heading measured from the first 100 m points the wrong way
        # down the road. attribute_route rejects a reversed heading as "a different (reversed) route" — by design,
        # since a course driven backwards genuinely is one — so the run fails to match and mints a duplicate.
        # Anchoring on the first sustained FORWARD motion costs nothing where the start is standing (the first
        # rows already qualify) and fixes the rolling case, which is every Rivals circuit attempt.
        _fwd = next((q for q in rs if (q.get("Gear") or 0) > 0 and q.get("speed_mph", 0) > 10), start)
        h0 = _fwd if _fwd.get("DistanceTraveled") is not None else start
        hx, hz = h0["PosX"], h0["PosZ"]
        h_row = next((q for q in rs if q["DistanceTraveled"] >= h0["DistanceTraveled"] + 100), rs[-1])
        hv = (h_row["PosX"] - hx, h_row["PosZ"] - hz); hn = math.hypot(*hv); hdg = [round(hv[0] / hn, 3), round(hv[1] / hn, 3)] if hn > 1 else None
        # SAMPLE BY DISTANCE, NOT BY COUNT. This took 200 points however long the event was — 5 m apart on a 1 km
        # circuit, but 220 m apart on a 44 km one. The overlap test that decides route identity buckets points on
        # a 40 m grid, so at 220 m spacing a long event registers on almost none of a known route's cells: it can
        # never match, and mints a fresh key EVERY analysis. That is the six identical -6800_-1100* routes —
        # same start to the metre, same heading to three decimals, differing only in the length they recorded.
        # Short courses were unaffected, which is why this survived: the bug needed a road long enough to expose it.
        _sstep = 25.0
        sample = []
        for q in rs:
            _pt = (q["PosX"], q["PosZ"])
            if not sample or math.hypot(_pt[0] - sample[-1][0], _pt[1] - sample[-1][1]) >= _sstep:
                sample.append(_pt)
            if len(sample) >= 4000:      # a hard ceiling so a pathological event cannot make matching quadratic
                break
        key = attribute_route(sx, sz, hdg, dist, sample, has_line=(_resets > 0))
        if key is None and _is_rollup(sx, sz, sample):
            continue
        if key is None:
            key = f"{int(round(sx / 50) * 50)}_{int(round(sz / 50) * 50)}"
            if key in routes and routes[key].get("start"): key = f"{key}_{len(routes)}"   # a genuinely different route that rounds to an occupied cell
            routes[key] = dict(routes.get(key) or {}, start=[round(sx), round(sz)], heading=hdg, length_m=round(dist), events=0, first_seen=sid)
        R = routes[key]; R["events"] = R.get("events", 0) + 1; R["length_m"] = max(R.get("length_m") or 0, round(dist)); R["last_seen"] = sid
        if not R.get("heading") and hdg: R["heading"] = hdg
        ev_out.append({"t0": round(rs[0]["t"], 1), "t1": round(rs[-1]["t"], 1), "car": cid(rs[0]), "stint": rs[0].get("stint"), "mode": mode, "solo": solo, "solo_conf": solo_conf, "laps": laps,
                       # BestLap is BEST-SO-FAR (0, then non-increasing): max() returned the FIRST lap's time and the
                       # improve-only track record latched it forever, misranking builds. min of positives = the real best.
                       # LastLap changes every lap, so max() was the SLOWEST lap labeled 'last' — take the final value.
                       "best_lap": round(min((q["BestLap"] for q in rs if q["BestLap"] > 0), default=0), 3) or None,
                       "last_lap": round(next((q["LastLap"] for q in reversed(rs) if q["LastLap"] > 0), 0), 3) or None,
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
            with open(rpath + ".tmp", "w", encoding="utf-8") as f: json.dump(out_r, f, indent=1, ensure_ascii=False)
            os.replace(rpath + ".tmp", rpath)
        except Exception as ex_: print("route registry not saved:", repr(ex_), file=sys.stderr)

    # ---- reference loops: user-defined free-roam test circuits. Each pass through the start point = one lap (a synthetic event). ----
    loops = {}
    try:
        with open(os.path.join(ROOT, "data", "reference-loops.json"), encoding="utf-8") as f: loops = json.load(f).get("loops", {})
    except Exception: loops = {}
    # THE SAME DRIVING MUST NOT BE FILED AS TWO COURSES. This scan walked every row in the capture, including
    # rows already inside an attributed route event, so whenever a reference-loop marker sits ON a course's road
    # -- which is exactly where it lands when it is dropped at a Rivals start -- each pass emitted a synthetic
    # "loop:<name>" event over driving that already belonged to the route. Measured on fh6_20260821_202122: two
    # Rivals events on -1850_1550 (t0 2440.4-2531.0 and 2682.2-2812.3, 6 laps, best 32.614 s) alongside FOURTEEN
    # loop events covering the identical span. One drive, two courses, and both carry laps and lap times.
    # Jett's premise again: courses share tarmac, and a marker on shared tarmac is not a second course.
    # A reference loop is for FREE ROAM -- "user-defined free-roam test circuits", per the heading above -- so
    # rows the game already accounted for as an event are not its business. Rows outside every attributed event
    # are still scanned, which is the case reference loops exist for.
    _claimed = [(e["t0"], e["t1"]) for e in ev_out if e.get("route_key")]
    _claimed_t = _claimed or []
    for lname, lp in loops.items():
        lx, lz = lp["start"]
        if abs(lx) < 5 and abs(lz) < 5: continue   # invalid origin-marked loop (a pre-race [0,0] capture) — the car never returns to the origin, so it never made a course
        R = lp.get("radius", 60); MIND = lp.get("min_dist", 250)
        # collect crossings: a lap = leave the radius (travel > MIND from start), then return within radius
        state = "start"; lap_rows = []; away_dist = 0; prev = None; passes = []
        for r in live:
            # RESET AT THE BOUNDARY, DO NOT SPLICE ACROSS IT. Filtering the claimed rows out of one flat list
            # left this integrator working across the hole: away_dist sums hypot() between CONSECUTIVE RETAINED
            # rows and the lap's distance and time come from its first and last, so a pass that began before an
            # attributed event and closed after it was not suppressed, it was STITCHED -- reporting a distance
            # and a duration covering driving the scanner never saw. Clearing the state machine at the boundary
            # means a lap can never span a claimed window, which is what "not its business" has to mean here.
            if _claimed_t and any(a <= r["t"] <= b for a, b in _claimed_t):
                state = "start"; lap_rows = []; away_dist = 0; prev = None
                continue
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
    # ordinals that appear under MORE THAN ONE configuration in this capture: parts changed mid-drive, so the one
    # pre-capture tune save cannot be attributed to any single config (see clone_sheet_for)
    _ord_seen = defaultdict(int)
    for _c in sess["cars"]: _ord_seen[str(_c["id"]).split("|")[0]] += 1
    for c in sess["cars"]:
        c["coverage"] = coverage_for(c["id"], cars, corners, launches, braking, crests, pulses, top_pull, warm_frac)
        c["advice"] = advice_for(c["id"], cars, corners, launches, braking, bott, c["coverage"], temps_med)
        c["general"] = general_tuning_for(c["id"], corners, c["advice"])   # all-around lane: breadth over every context (mutates advice to add breadth)
        c["decode"] = decode_battery_for(c["id"], cars, corners, launches, braking, crests, pulses, top_pull)
        c["clone_sheet"] = clone_sheet_for(c, c["decode"], sid, _ord_seen[str(c["id"]).split("|")[0]] > 1)   # sid carries the capture clock the save attribution is bound to
        c["temps_med_f"] = {w: round(v) for w, v in temps_med.get(c["id"], {}).items()}
    # ---- course mode: per route family, scope coverage + advice to the event windows, attach per-run lap times ----
    COURSE_PROBES = [("hairpin", "Hairpins", 3), ("medium", "Medium corners", 3), ("fast", "Fast sweepers", 3), ("flick", "Chicane flicks", 2), ("launch", "Standing starts", 2), ("brake", "Hard stops from 80+", 3), ("crest", "Crests", 2)]
    courses = {}
    for e in ev_out:
        if e["duration_s"] < 5 or e["distance_m"] < 100: continue   # only true instant-aborts are dropped; a short PARTIAL run (practising the first few turns, then a crash / restart) still carries cornering data and must contribute to the course
        co = courses.setdefault(e["route_key"], {"route_key": e["route_key"], "name": e["route"], "events": [], "cars": []})
        lab = next((st["label"] for st in stints if st["n"] == e.get("stint")), None)
        # solo/solo_conf must ride along: the course-scoped consumers below (Rivals scoping at ~:1735, and the
        # VOID verdict on every stored lap) read them off THIS dict, not off ev_out. Dropping them here made both
        # read None — every lap stored solo=0, and `rivals` could only ever be True by explicit declaration.
        # .get(): a synthetic reference-loop event (~:1049) has no solo at all, and unknown must stay unknown.
        co["events"].append({"t0": e["t0"], "t1": e["t1"], "car": e["car"], "stint": e.get("stint"), "label": lab, "laps": e["laps"], "best_lap": e["best_lap"], "last_lap": e["last_lap"], "duration_s": e["duration_s"], "distance_m": e["distance_m"], "mode": e["mode"], "solo": e.get("solo"), "solo_conf": e.get("solo_conf"), "pos_final": e["pos_final"]})
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
        if profile and cc:   # course-level SURFACE: mean rough fraction over this course's corners — persists with the profile (dirt/offroad course tag)
            rfs = [c.get("rough_frac", 0.0) for c in cc if c.get("rough_frac") is not None]
            if rfs: profile["rough_frac"] = round(sum(rfs) / len(rfs), 2); profile["rough_n"] = len(rfs)
        advice_by_car = {}
        for cid_ in co["cars"]:
            cov_stub = {"overall": round(num / den, 2) if den else 0.0, "probes": probes}
            advice_by_car[cid_] = advice_for(cid_, cars, cc, ll, bb, [x for x in bott if inwin(x["t"], evs)], cov_stub, temps_med, profile)
        # ---- lap bookkeeping: a LAP = one pass of the course. Loop passes / sprints = the event itself; lapped events split on LapNumber changes ----
        lap_windows = []
        for ei, ev in enumerate(evs):
            rows_ev = [r for r in loop_rows if ev["t0"] <= r["t"] <= ev["t1"]]
            # A LAP BOUNDARY IS NOT ALWAYS A LapNumber EDGE, BUT CUTTING ON THE LAP TIMER IS WORSE. LapNumber does
            # not increment on a single-lap Rivals run (every Colossus crossing reads 0->0), so cutting the window
            # at the CurrentLap reset looked like the missing boundary. Measured, it is a regression: session
            # 051952 went from 5 stored traces to 0. The reset is where the lap TIME is cleared, and the game
            # reports the completed LastLap on the far side of it — cut there and the window that drove the lap no
            # longer contains the lap's own time, so nothing downstream will accept it as a lap. The multi-lap case
            # is already handled below by split_multilap, which cuts on the road returning to itself and keeps the
            # time with the driving. (What sent me looking was a Colossus trace I believed was missing; it was in
            # the store the whole time, under -3750_300 from session 213928, 23.42 mi. Nothing needed fixing here.)
            k_ = 0; t_start = ev["t0"]; cur_lap = rows_ev[0]["LapNumber"] if rows_ev else None
            for r in rows_ev:
                if r["LapNumber"] != cur_lap:
                    k_ += 1; lap_windows.append({"ev": ei, "lap": k_, "t0": round(t_start, 1), "t1": round(r["t"], 1)}); t_start = r["t"]; cur_lap = r["LapNumber"]
            k_ += 1; lap_windows.append({"ev": ei, "lap": k_, "t0": round(t_start, 1), "t1": ev["t1"]})
        lw_full = [w for w in lap_windows if w["t1"] - w["t0"] >= 15]   # the stub after a finish line is not a lap
        lap_windows = lw_full or lap_windows
        # LapNumber does not increment in free roam or on unregistered routes, so a multi-lap run arrives as ONE
        # window. Cut it where the car returned to where the window started — the road's own finish line.
        _split = []
        for w in lap_windows:
            _p = [(r["t"], r["PosX"], r["PosZ"]) for r in loop_rows if w["t0"] <= r["t"] <= w["t1"]]
            _cuts = split_multilap(_p)
            if not _cuts:
                _split.append(w); continue
            _b = [0] + _cuts + [len(_p) - 1]
            for _a, _z in zip(_b, _b[1:]):
                if _z - _a >= 20: _split.append(dict(w, t0=round(_p[_a][0], 1), t1=round(_p[_z][0], 1), split=True))
        _split.sort(key=lambda x: x["t0"])
        for _i, _w in enumerate(_split, 1): _w["lap"] = _i
        lap_windows = _split or lap_windows
        total_laps = len(lap_windows)
        def lap_of(t):
            for li, w in enumerate(lap_windows):
                if w["t0"] - 0.05 <= t <= w["t1"] + 0.05: return li
            return None
        lapmap = {id(c): lap_of(c["t0"]) for c in cc}
        # ---- GEOMETRIC course learning from COORDINATES: the path IS the course. Resample the reference lap by arc length, heading -> curvature,
        #      turns = curvature peaks (radius, length, direction, apex/entry/exit) — independent of how hard you drove them. ----
        # GRIP STATE — the same alphabet the live strip uses (fh6_live_daemon ~line 254), so one vocabulary
        # describes a moment whether it is read live, in the strip, on the map or along a saved trace.
        # 0 calm · 1 front (understeer) · 2 rear (oversteer) · 3 both (drift/overdriven) · 4 impact
        def grip_code(r):
            try:
                if abs(r.get("lat_g") or 0) > 3.0 or (r.get("SmashableVelDiff") or 0) > 0: return 4
                fr = max(abs(r["CombinedSlipFL"]), abs(r["CombinedSlipFR"]))
                rr = max(abs(r["CombinedSlipRL"]), abs(r["CombinedSlipRR"]))
                return 3 if (fr > 1 and rr > 1) else 1 if fr > 1 else 2 if rr > 1 else 0
            except Exception:
                return 0
        def lap_pts(w, grip=False):
            # THE COURSE IS THE LAP, NOT THE WINDOW AROUND IT. Every row between t0 and t1 used to become course
            # geometry — including everything before the lap started. On a Rivals circuit there is no standing
            # start: you roll back past the line, turn around, and cross it already at speed, so that pre-lap
            # manoeuvre was being mapped as part of the road. It is why U-turns kept becoming "courses", why an
            # approach keyed a route 5 km from its own start line, and why one 23.4 mi lap measured 27.45 mi.
            #
            # CurrentLap > 0 is exactly and only "the lap timer is running", which this file already calls the
            # honest event flag elsewhere. Before the first crossing it is 0 and LastLap is 0 too — the game has
            # no completed lap to report — so pre-race driving is not merely excludable, it is self-identifying.
            # Rows without the field at all (older captures) are kept, so nothing regresses on historic data.
            rows_ = [r for r in loop_rows if w["t0"] <= r["t"] <= w["t1"]
                     and (r.get("CurrentLap") is None or r["CurrentLap"] > 0)]
            if len(rows_) < 30:      # nothing timed in this window: fall back rather than map an empty road
                rows_ = [r for r in loop_rows if w["t0"] <= r["t"] <= w["t1"]]
            # ...and START TO FINISH, one lap only. Dropping the pre-lap rows is not enough: a window can still
            # hold a whole lap plus the partial that followed it, and this feeds BOTH the course geometry and the
            # stored speed trace. A trace that runs past the line is not a lap of the course — it plots two
            # different stretches of road on one distance axis, so every comparison against it is against a
            # different thing. The lap boundary is the CurrentLap reset (race time keeps climbing across it), so
            # split there and keep the longest complete lap.
            _ls, _c2, _prow2 = [], [], None
            for r in rows_:
                if _prow2 is not None and _is_lap_boundary(_prow2, r):
                    if len(_c2) > 30: _ls.append(_c2)
                    _c2 = []
                _c2.append(r); _prow2 = r
            if len(_c2) > 30: _ls.append(_c2)
            if _ls: rows_ = max(_ls, key=lambda L: len(L))
            # 4th column rides through resample un-interpolated (a state is categorical); the 5th is ELEVATION,
            # which is continuous and interpolates like speed. PosY was in every capture and reached nothing —
            # a whole channel of the road (climbs, crests, compressions) that the lab could not draw.
            if grip: return [(r["PosX"], r["PosZ"], r["speed_mph"], grip_code(r), r.get("PosY", 0.0)) for r in rows_]
            return [(r["PosX"], r["PosZ"], r["speed_mph"]) for r in rows_]
        def resample(pts, step=4.0):   # -> list of PIECES; a jump > 150 m between consecutive rows (respawn / rewind / teleport) starts a new piece
            pieces = []; cur = [pts[0]] if pts else []
            for a_, b_ in zip(pts, pts[1:]):
                if math.hypot(b_[0] - a_[0], b_[1] - a_[1]) > 150:
                    if len(cur) >= 3: pieces.append(cur)
                    cur = [b_]
                else: cur.append(b_)
            if len(cur) >= 3: pieces.append(cur)
            out = []
            for pc in pieces:
                S = [0.0]
                for a_, b_ in zip(pc, pc[1:]): S.append(S[-1] + math.hypot(b_[0] - a_[0], b_[1] - a_[1]))
                if S[-1] < step * 5: continue
                P_ = []; j = 0; s_ = 0.0
                while s_ <= S[-1]:
                    while j < len(S) - 2 and S[j + 1] < s_: j += 1
                    seg_len = S[j + 1] - S[j]; f = (s_ - S[j]) / seg_len if seg_len > 0 else 0.0
                    _base = (pc[j][0] + (pc[j + 1][0] - pc[j][0]) * f, pc[j][1] + (pc[j + 1][1] - pc[j][1]) * f, s_, pc[j][2] + (pc[j + 1][2] - pc[j][2]) * f)
                    _cat = (max(pc[j][3], pc[j + 1][3]),) if len(pc[j]) > 3 and len(pc[j + 1]) > 3 else ()   # categorical: carry the WORSE of the bracketing states, never a blend
                    _ele = ((pc[j][4] + (pc[j + 1][4] - pc[j][4]) * f,) if len(pc[j]) > 4 and len(pc[j + 1]) > 4 else ())   # continuous: interpolate like speed
                    P_.append(_base + _cat + _ele)
                    s_ += step
                out.append(P_)
            return out
        def down(pcs, n=500):   # downsample pieces for drawing (<= n points in total)
            tot = sum(len(p) for p in pcs) or 1; k = max(1, -(-tot // n))
            return [[[round(p[0]), round(p[1])] for p in pc[::k]] for pc in pcs if len(pc[::k]) >= 2]
        # ═══ TURN DETECTION (validated in scripts/telemetry/turn_lab.py against cross-lap agreement) ═══
        # A turn is a SUSTAINED CHANGE OF DIRECTION, not a radius crossing a threshold. Segment the path by
        # curvature SIGN while |k| is above a permissive floor (r < 600 m, so long sweepers survive), bridging
        # short sub-floor gaps inside one turn, and accept a segment on the heading change it actually produces
        # (>= 30 deg) or on being genuinely tight (r <= 90 m and >= 14 deg). Radius never gates EXISTENCE — that
        # is what made a 200 m sweeper invisible while a twitch inside a hairpin counted as its own turn.
        # Measured vs the shipped detector: cross-lap agreement 70% vs 59%, count spread +/-0.6 vs +/-2.8 turns
        # per lap, orphan (one-lap-only) turns 4 vs 11.
        geo = None; lat_acc = None
        # a "lap" for GEOMETRY must be a lap: the 15 s rule admits aborted stubs (Edamame stored 48 lap paths,
        # only 2 of them whole), and a 500 m fragment as the reference lap is how the turn map lost turns.
        _cand_laps = [w for w in lap_windows if (w["t1"] - w["t0"]) >= 15]
        def _arc_of_win(w):
            _p = resample(lap_pts(w)); return sum(pc[-1][2] for pc in _p) if _p else 0
        _cand_arcs = {id(w): _arc_of_win(w) for w in _cand_laps}
        # A FULL LAP IS THE CONSENSUS LENGTH, NOT THE LONGEST. Measuring against the session maximum inverts the
        # filter the moment one lap window merges two laps (a missed finish-line crossing): the bar doubles, every
        # genuine lap is discarded as a "fragment", and the merged lap is crowned reference — which is how a
        # 1024 m circuit came to be mapped as a 1923 m road with its corners counted twice.
        # LOWER median: robust against the high outlier that causes the fault, and biased toward the short side,
        # where the coverage guard at the model write already prevents any damage.
        _vals = sorted(v for v in _cand_arcs.values() if v > 0)
        _med = _vals[(len(_vals) - 1) // 2] if _vals else 0
        full_laps = [w for w in _cand_laps if _med and 0.7 * _med <= _cand_arcs[id(w)] <= 1.45 * _med] or _cand_laps
        if full_laps:
            # ref lap = the FASTEST lap of TYPICAL length (median arc consensus). 'Most rows' picked the SLOWEST lap
            # — and a rejoin/crawl lap: its loop showed up as phantom mapped turns and crawl speed_ref values.
            def _rows_in(w): return sum(1 for r in loop_rows if w["t0"] <= r["t"] <= w["t1"])
            _cand = sorted(full_laps, key=lambda w: -_rows_in(w))[:8]
            _arcs = {}
            for w in _cand:
                pcs0 = resample(lap_pts(w)); _arcs[id(w)] = sum(pc[-1][2] for pc in pcs0) if pcs0 else 0
            _amed = sorted(_arcs.values())[len(_arcs) // 2] if _arcs else 0
            _typ = [w for w in _cand if _amed and abs(_arcs[id(w)] - _amed) <= 0.1 * _amed] or _cand
            ref_w = min(_typ, key=_rows_in)
            pieces = resample(lap_pts(ref_w)); P = [p for pc in pieces for p in pc]
            # A TURN'S ARC MUST BE ARC ALONG THE COURSE, NOT ALONG ITS PIECE. resample restarts each piece's
            # running distance at 0, and P is their flat concatenation, so P[i][2] is arc WITHIN the piece i
            # belongs to. Writing that as the turn's `s` makes two turns on different pieces incomparable:
            # measured on 2850_-200, pieces [326, 322, 1251] with a maximum turn s of 1196 -- under the largest
            # piece and nowhere near the 1899 m total. Everything that reads `s` as a position along the course
            # is then wrong on a multi-piece map: turn_stats.windows picks the wrong neighbours, and the
            # merged_turns ordering that decides T1..Tn numbers them across pieces as if the arcs were
            # comparable. _soff[i] is the road before i's piece, so P[i][2] + _soff[i] is arc along the course.
            _soff, _acc = [], 0.0
            for pc in pieces:
                _soff.extend([_acc] * len(pc))
                _acc += (pc[-1][2] if pc else 0.0)
            if len(P) >= 20:
                # Median |lat_g| per 8 m, pooled over every full lap. Straights here read 0.03-0.07 g against
                # 0.67-2.4 g in corners -- a 10x separation, so the threshold is not a judgement call.
                LG_ON = 0.25
                lg_prof = {}; lat_acc = None
                try:
                    _cell = {}
                    for _i, _p in enumerate(P): _cell.setdefault((int(_p[0] // 25), int(_p[1] // 25)), []).append(_i)
                    _spans = [(w_["t0"], w_["t1"]) for w_ in full_laps]
                    _acc = {}
                    for r_ in loop_rows:
                        _t = r_.get("t")
                        if not any(a <= _t <= b for a, b in _spans): continue
                        x_, z_ = r_.get("PosX"), r_.get("PosZ")
                        if x_ is None or z_ is None: continue
                        best_ = None; bd_ = 1e9
                        for dx in (-1, 0, 1):
                            for dz in (-1, 0, 1):
                                for _i in _cell.get((int(x_ // 25) + dx, int(z_ // 25) + dz), ()):
                                    d_ = (P[_i][0] - x_) ** 2 + (P[_i][1] - z_) ** 2
                                    if d_ < bd_: bd_ = d_; best_ = _i
                        if best_ is None or bd_ >= 400: continue
                        _acc.setdefault(int(P[best_][2] // 8.0), []).append(abs(r_.get("lat_g") or 0.0))
                    # ACCUMULATE ACROSS EVERY SESSION, not just this one. A course's corners are a property of the
                    # ROAD; deriving them from whichever laps you happened to drive today is what made the turn
                    # count move (Edamame 15 -> 7 on a thin session). laps.db stores [arc, mph, grip, x, z] with
                    # no lat_g, so the profile is banked in the course model as running (sum, n) per 8 m bucket
                    # and merged here — every session makes the map better and none makes it worse.
                    _sess = {b_: (sum(v), len(v)) for b_, v in _acc.items()}
                    _bank = _lat_bank_on_disk(key)
                    for b_, (sm, n_) in _sess.items():
                        pb = _bank.get(str(b_)) or [0.0, 0]
                        _bank[str(b_)] = [round(pb[0] + sm, 3), pb[1] + n_]
                    lat_acc = _bank
                    lg_prof = {int(b_): (v[0] / v[1]) for b_, v in _bank.items() if v[1] >= 10}
                except Exception:
                    lg_prof = {}; lat_acc = _lat_bank_on_disk(key)
                def _lgv(arc):
                    return lg_prof.get(int(arc // 8.0))
                gturns = []; off = 0; piece_of = {}
                for pi_, pc in enumerate(pieces):
                    for q in range(len(pc)): piece_of[off + q] = pi_
                    if len(pc) >= 12:
                        for t_ in detect_turns(pc):
                            gturns.append({"i0": off + t_["i0"], "i1": off + t_["i1"], "ia": off + t_["ia"],
                                           "k": t_["k"], "sgn": t_["sgn"], "deg": t_["deg"], "radius_m": t_["radius_m"]})
                    off += len(pc)
                merged = gturns   # the detector already bridges wobbles inside a turn; no second merge pass
                K_all = curvature(P, 4.0, 9)   # curvature over the whole reference lap: K_all[i-1] describes P[i]
                # ---- CURVATURE FINDS THE CORNER · GRIP RESCUES WHAT IT MISSED · GEOMETRY PLACES THE APEX -----
                # Grip can only ever ADD a corner, never gate one: corners 2 and 3 here are legitimate corners
                # taken flat out with no loss of grip, so a grip-gated detector would delete them. The road
                # bending IS a corner whether or not it costs you anything.
                # Curvature thresholds do miss gentle sweepers that still cost
                # grip (this course lost five that way, at s=128/168/904, 58-66% of samples past the limit). But
                # the racing line does NOT pass through the geometric apex -- grip peaks at turn-in and on exit --
                # so grip must never place the apex. It says THAT a corner is there and roughly WHERE; curvature
                # says where its apex is. Grip is an ENHANCEMENT: with no laps yet, curvature alone still stands.
                gl_prof = {}   # 8 m arc bucket -> share of samples past the limit, pooled over every full lap
                try:
                    _lb, _lt = {}, {}
                    for w_ in full_laps:
                        for pc_ in resample(lap_pts(w_, grip=True)):
                            for q_ in pc_:
                                b_ = int(q_[2] // 8.0)
                                _lt[b_] = _lt.get(b_, 0) + 1
                                if len(q_) > 4 and q_[4] in (1, 2, 3): _lb[b_] = _lb.get(b_, 0) + 1   # resample yields (x, z, arc, mph, grip)
                    gl_prof = {b_: _lb.get(b_, 0) / n_ for b_, n_ in _lt.items() if n_ >= 6}
                except Exception:
                    gl_prof = {}
                def _gl(arc):
                    return gl_prof.get(int(arc // 8.0), 0.0)
                if gl_prof:
                    # 1. RESCUE: a curvature candidate the acceptance rule dropped is a real corner if the car is
                    #    demonstrably loaded there. (Rescued below via the sub-threshold pass in detect_turns.)
                    # 2. SPLIT: a turn spanning two separated grip peaks is two corners the merge fused; its
                    #    centroid apex then lands in the gap between them, marking road where nothing happens.
                    out2 = []
                    for t_ in merged:
                        i0, i1 = t_["i0"], min(t_["i1"], len(P) - 1)
                        if i1 - i0 < 8: out2.append(t_); continue
                        pk = []   # local maxima of grip loss inside this turn, >= 30 m apart
                        for j in range(i0 + 2, i1 - 2):
                            f = _gl(P[j][2])
                            if f >= 0.55 and f >= _gl(P[j - 2][2]) and f >= _gl(P[j + 2][2]):
                                if not pk or (P[j][2] - P[pk[-1]][2]) >= 30: pk.append(j)
                        # UNION with lateral g. Curvature can run continuously through what are really two
                        # corners -- from s=64 to s=300 here the road never straightens, so nothing in the
                        # geometry can separate them -- but the car does: 0.67 g, dipping to 0.34 g, then 2.20 g.
                        # Two humps with a real trough are two corners. Added to the grip peaks, never replacing
                        # them: replacing lost more splits than it gained (13 turns -> 10) because through a
                        # continuous corner sequence lateral g stays high with only shallow dips.
                        lpk = []
                        for j in range(i0 + 2, i1 - 2):
                            v = _lgv(P[j][2])
                            if v is None or v < LG_ON: continue
                            a2, b2 = _lgv(P[j - 2][2]), _lgv(P[j + 2][2])
                            if a2 is None or b2 is None or not (v >= a2 and v >= b2): continue
                            if not lpk or (P[j][2] - P[lpk[-1]][2]) >= 30: lpk.append(j)
                            elif v > (_lgv(P[lpk[-1]][2]) or 0): lpk[-1] = j
                        if len(lpk) >= 2:
                            for a2, b2 in zip(lpk, lpk[1:]):
                                lo = min([(_lgv(P[q][2]) or 9) for q in range(a2, b2)] or [9])
                                hi = min(_lgv(P[a2][2]) or 0, _lgv(P[b2][2]) or 0)
                                if hi and lo <= 0.6 * hi:
                                    for j in (a2, b2):
                                        if all(abs(P[j][2] - P[q][2]) >= 25 for q in pk): pk.append(j)
                            pk.sort()
                        if len(pk) < 2: out2.append(t_); continue
                        bnds = [i0] + [ (a + b) // 2 for a, b in zip(pk, pk[1:]) ] + [i1]
                        for a, b in zip(bnds, bnds[1:]):
                            if b - a < 4: continue
                            sl = [abs(x) for x in K_all[max(0, a - 1):max(0, b - 1)]] or [t_["k"]]
                            ja = a + max(range(len(sl)), key=lambda q: sl[q])
                            out2.append(dict(t_, i0=a, i1=b, ia=min(ja, len(P) - 1), k=max(sl),
                                             radius_m=round(1.0 / max(1e-6, max(sl))),
                                             deg=round(t_["deg"] * (b - a) / max(1, i1 - i0))))
                    merged = out2
                # APEX = the TIGHTEST POINT OF THE ROAD inside the corner's own span -- the geometric apex, which
                # is what a driver aims at. The span is now anchored (by curvature, and split by grip where two
                # corners were fused), so this is stable in a way a free-floating argmax never was.
                for t_ in merged:
                    a_, b_ = max(0, t_["i0"] - 1), max(1, min(t_["i1"], len(P) - 1) - 1)
                    sl = [abs(x) for x in K_all[a_:b_]]
                    if sl:
                        ja = t_["i0"] + max(range(len(sl)), key=lambda q: sl[q])
                        t_["ia"] = min(max(ja, 0), len(P) - 1)
                        t_["k"] = max(sl); t_["radius_m"] = round(1.0 / max(1e-6, max(sl)))
                votes = 0   # calibrate the L/R sign convention against the behavioural corners (lat-g sign) by majority vote
                for g in merged:
                    ax, az = P[g["ia"]][0], P[g["ia"]][1]
                    for c in cc:
                        if c.get("apex") and math.hypot(c["apex"][0] - ax, c["apex"][1] - az) <= 40: votes += (1 if ((c["dir"] == "R") == (g["sgn"] > 0)) else -1)
                flip = votes < 0; gt_out = []
                # deg/radius come from the detector (integrated over the whole turn, not an endpoint difference)
                for n_, g in enumerate(merged, 1):
                    gt_out.append({"id": f"G{n_}", "apex": [round(P[g["ia"]][0]), round(P[g["ia"]][1])], "s": round(P[g["ia"]][2] + (_soff[g["ia"]] if g["ia"] < len(_soff) else 0.0)), "radius_m": round(1.0 / g["k"]), "dir": ("R" if (g["sgn"] > 0) != flip else "L"), "deg": g["deg"],
                                   "len_m": round((g["i1"] - g["i0"]) * 4.0), "entry": [round(P[g["i0"]][0]), round(P[g["i0"]][1])], "exit": [round(P[g["i1"]][0]), round(P[g["i1"]][1])], "speed_ref_lap": round(P[g["ia"]][3])})
                geo = {"length_m": round(sum(pc[-1][2] for pc in pieces)), "ref_lap": {"ev": ref_w["ev"], "lap": ref_w["lap"], "t0": ref_w["t0"], "t1": ref_w["t1"]}, "paths": down(pieces), "turns": gt_out, "pieces": len(pieces)}
                geo["path"] = [p for pc in geo["paths"] for p in pc]   # flat (overlap cells · atlas bounds); 'paths' are the drawable pieces
                lw_last = max(full_laps, key=lambda w: w["t1"]); PLs = resample(lap_pts(lw_last))
                if PLs: geo["last_paths"] = down(PLs); geo["last_path"] = [p for pc in geo["last_paths"] for p in pc]; geo["last_lap"] = {"ev": lw_last["ev"], "lap": lw_last["lap"], "t0": lw_last["t0"], "t1": lw_last["t1"]}
                # the COURSE LAYOUT: every lap / attempt recorded, drawn together — the spread of lines is the road; they accumulate in the course model across sessions
                lap_paths = []
                for w in full_laps[-32:]:
                    PPs = resample(lap_pts(w), step=8.0)
                    if PPs:
                        pc = max(PPs, key=len)   # the longest continuous piece of that lap (no teleport lines)
                        lap_paths.append({"session": sid, "ev": w["ev"], "lap": w["lap"], "pts": [[round(p[0]), round(p[1])] for p in pc[::max(1, -(-len(pc) // 160))]]})   # <= 160 pts
                geo["lap_paths"] = lap_paths   # merged into the course model below; stripped from the session entry afterwards (layout_paths carries them)
        def geo_near(x, z):
            """The NEAREST map turn to this corner, not the first one in list order.

            A course can cross its own road: -6800_-1100 is an out-and-back whose G1 (arc 508 m) and G9 (arc
            1756 m) sit 19.2 m apart in XZ because the road doubles back past itself. Taking the first match in
            geometry.turns order meant every corner detected on the RETURN pass was labelled with the id of the
            corner on the way out -- G9's driving published as G1's. That id is stamped on the session corner
            record and is what the dashboard matches a live corner against, so the wrong corner's evidence was
            being read back for the rest of the course's life. Same first-hit shape as the three matchers already
            replaced by _bind; these two were missed because they read as harmless lookups.
            """
            if not geo: return None
            cands = [(g, math.hypot(g["apex"][0] - x, g["apex"][1] - z)) for g in geo["turns"]]
            cands = [(g, d) for g, d in cands if d <= max(60, g["len_m"] / 2 + 20)]
            if not cands: return None
            # NEAREST, not first-in-list. Taking geometry.turns order meant a corner detected on the RETURN
            # pass of an out-and-back was labelled with the id of the corner on the way out -- on -6800_-1100,
            # G9 (arc 1756 m) published as G1 (arc 508 m), because their apexes are 19.2 m apart where the road
            # doubles back past itself. That id is stamped on the session corner record and is what the dashboard
            # matches a live corner against, so the wrong corner's evidence was read back for the rest of the
            # course's life. Same first-hit shape as the three matchers already replaced by _bind.
            #
            # STILL AMBIGUOUS WHERE A ROAD CROSSES ITSELF, and this does not pretend otherwise. Nearest-in-XZ
            # picks whichever apex is marginally closer, which on those three pairs is close to a coin flip.
            # The fix is to disambiguate by position ALONG THE LAP, and the corner record's `dist` field is not
            # it: measured, this course's corners span dist -175..6088 while its map spans s 3303..37037, so the
            # two are not the same quantity and comparing them just re-picks the lowest s -- the original bug in
            # a new costume. Naming the corner on a self-crossing road needs a monotonic sequence alignment of
            # detected corners against map turns, which is a real piece of work and is not attempted here.
            return min(cands, key=lambda gd: gd[1])[0]["id"]
        # ---- COURSE MODEL (persistent, data/courses/<route>.json): loaded BEFORE clustering so turn membership can use cross-session (track) presence ----
        mdir = os.path.join(ROOT, "data", "courses"); mpath = os.path.join(mdir, re.sub(r"[^A-Za-z0-9_.-]+", "_", key) + ".json")
        write_models = "_replay_analysis" not in os.path.abspath(outdir)
        model = {"route_key": key, "name": co["name"], "turns": [], "laps": 0, "sessions": [], "updated": None}
        try:
            if os.path.exists(mpath):
                with open(mpath, encoding="utf-8") as f: model = json.load(f)
        except Exception: pass
        def mturn_for(cl):   # NEAREST model turn within 40 m of this cluster's apex -- see geo_near: on a course
            best, bd = None, None                                    # that doubles back, first-in-list is the
            for t in model["turns"]:                                 # corner on the OTHER pass
                d2 = (t["pos"][0] - cl["x"]) ** 2 + (t["pos"][1] - cl["z"]) ** 2
                if d2 <= 40 ** 2 and (bd is None or d2 < bd):
                    best, bd = t, d2
            return best
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
        # a cluster is a real TURN if it shows up on most laps THIS session OR it is an established turn ACROSS sessions (track presence).
        # Deciding on track presence (not just this session) both promotes turns you take inconsistently AND stops the count changing every session.
        prior_laps = model.get("laps", 0)   # all track laps BEFORE this session (model is updated later)
        def track_pres(cl):
            mt_ = mturn_for(cl); t_ = (mt_ or {}).get("track") or {}
            add_seen = cl.get("laps_seen", 0); tot = prior_laps + total_laps
            pres = (t_.get("laps_seen", 0) + add_seen) / tot if tot else 0.0
            return pres, (t_.get("sessions", 0) + 1)
        def is_turn(cl):
            if cl["presence"] >= 0.5: return True
            tp, ts = track_pres(cl); return tp >= 0.4 and ts >= 2   # established across >= 2 sessions on >= 40% of all track laps
        strong = [cl for cl in clusters if is_turn(cl)]; weak = [cl for cl in clusters if not is_turn(cl)]; possible = []
        for cl in weak:   # a low-presence cluster within 80 m (POSITION) of a strong turn is a FRAGMENT of it — absorbed; otherwise a 'possible' turn.
            # POSITIONAL, not odometer: dist is cumulative ACROSS laps (and resets on restart), so median-dist deltas
            # encoded 'which lap', not 'where on the route' — same-corner fragments missed the 80 m gate on multi-lap
            # circuits and cross-lap coincidences absorbed fragments into distant corners.
            near = min(strong, key=lambda s_: (s_["x"] - cl["x"]) ** 2 + (s_["z"] - cl["z"]) ** 2, default=None)
            if near is not None and (near["x"] - cl["x"]) ** 2 + (near["z"] - cl["z"]) ** 2 <= 80 ** 2: near["members"] = near["members"] + cl["members"]; near["absorbed"] = near.get("absorbed", 0) + len(cl["members"])
            else: possible.append(cl)
        for cl in strong: lap_stats(cl)
        def _route_pos(cl):   # route order from the cluster's EARLIEST lap's odometer — cross-lap medians interleave wrongly
            lm = [(lapmap.get(id(m)), m["dist"]) for m in cl["members"] if lapmap.get(id(m)) is not None]
            if not lm: return med([m["dist"] for m in cl["members"]]) or 0
            l0 = min(x[0] for x in lm)
            return med([d for l, d in lm if l == l0]) or 0
        strong.sort(key=_route_pos); possible.sort(key=_route_pos)
        for i, cl in enumerate(strong, 1): cl["cid"] = f"C{i}"; cl["status"] = "turn"
        for i, cl in enumerate(possible, 1): cl["cid"] = f"?{i}"; cl["status"] = "possible"
        clusters = strong + possible
        per_lap_det = [sum(1 for c in cc if lapmap.get(id(c)) == li) for li in range(total_laps)]
        messy = [cl["cid"] for cl in strong if cl["multi"] >= 0.34]
        conf_laps = strength(total_laps, 3)   # 0.33 at 1 lap · 0.55 at 2 · 0.70 at 3 · 0.91 at 6
        agree = 1.0 - 0.5 * (len(possible) / max(1, len(strong) + len(possible))) - 0.3 * (sum(cl["multi"] for cl in strong) / max(1, len(strong)))
        turn_conf = round(conf_laps * max(0.3, agree), 2)
        expected = model.get("expected_turns")   # player-declared ground truth (data/courses/<route>.json "expected_turns") — the model converges toward it
        # headline count = the ESTABLISHED turns of the TRACK (>=40% of all track laps over >=2 sessions), not just what THIS session detected — so it is stable
        est_prior = sum(1 for t in model.get("turns", []) if ((t.get("track") or {}).get("sessions", 0)) >= 2 and prior_laps and ((t.get("track") or {}).get("laps_seen", 0) / prior_laps) >= 0.4)
        new_here = sum(1 for cl in strong if mturn_for(cl) is None)
        track_turns = max(est_prior + new_here, len(strong)) if len(model.get("sessions", [])) >= 2 else len(strong)
        detected_here = len(strong)
        turns_info = {"count": track_turns, "detected_here": detected_here, "possible": len(possible), "confidence": turn_conf, "laps": total_laps, "per_lap_detections": per_lap_det, "messy": messy, "expected": expected,
                      "note": ((f"you count {expected}; the track has {track_turns} established" + (" — match" if expected == track_turns else f", {'+' if track_turns > expected else ''}{track_turns - expected}" + (f" · {len(possible)} possible could close the gap — lap consistently" if track_turns < expected and possible else "")) + " · ") if expected else "") + (f"{track_turns} turns on record" + (f" · {detected_here} caught this session" if detected_here != track_turns else "") + " · " if len(model.get("sessions", [])) >= 2 else "") + (f"{total_laps} lap{'s' if total_laps != 1 else ''} — drive {max(0, 3 - total_laps)} more to confirm the turn count" if total_laps < 3 else "turn count confirmed across laps" if not possible else f"{len(possible)} possible turn{'s' if len(possible) != 1 else ''} seen on a minority of laps — keep lapping to confirm or drop them") + (f" · {', '.join(messy)} often split into several detections (taken inconsistently)" if messy else "")}
        laps_info = {"total": total_laps, "windows": lap_windows, "per_event": [sum(1 for w in lap_windows if w["ev"] == ei) for ei in range(len(evs))]}
        # ---- per-TUNE SPEED TRACES: each build's BEST full lap as a speed-vs-arclength curve, persisted with the
        #      course. Keyed by cid (the config identity — a PI change IS a different trace); build_id/class/pi ride
        #      along so the dashboard can badge the trace and gate the overlay to the viewer's class. Keep the 10 fastest.
        _trace_wins = {}
        for w in full_laps:
            _car_w = evs[w["ev"]]["car"] if 0 <= w["ev"] < len(evs) else None
            if _car_w: _trace_wins.setdefault(_car_w, []).append(w)
        speed_traces_new = {}
        # a candidate window must actually COVER the course: min-by-duration otherwise crowns an aborted partial
        # (shortest window!) as the tune's permanent trace. Reference = the longest arc any window covers this session.
        _win_arc = {}
        for cid_, wins in _trace_wins.items():
            for w in wins:
                pcs_ = resample(lap_pts(w, grip=True)); pts_all = _globalise_arc(pcs_)
                if len(pts_all) >= 30: _win_arc[id(w)] = (pts_all[-1][2], pts_all)
        _ref_arc = max((a for a, _ in _win_arc.values()), default=0)
        # THE COURSE IS THE REFERENCE, NOT THE SESSION. A session that only ever drove a fragment of a long course had
        # _ref_arc = that fragment, so the fragment passed the 70% / 90% gates below, was saved as the build's best
        # trace, and the course model kept it forever because 18.7 s beats 108 s. Highway Circuit, 2026-09-02: the
        # speed-trace panel crowned a quarter-lap 'fastest' and voided every real 108 s lap against it.
        _model_len = float(((model.get("geometry") or {}).get("length_m") or 0) or 0)
        if _model_len > 0:
            _ref_arc = max(_ref_arc, _model_len)
        def _tune_hash_for(cid_, w_):
            # The rule lives in module-level tune_hash_for (backfill_laps.py --tune-hash re-runs it on stored
            # rows); this closure only supplies what it knows -- the session id and the measured gear ladder.
            gears_seen = len((cars.get(cid_) or {}).get("gears") or [])   # `gears` is the per-gear ladder, so its LENGTH is the box size
            return tune_hash_for(cid_, sid, w_["t0"], gears_seen)
        def _game_lap_s(w_):
            """The lap's time on the GAME clock, which stops when you pause. None when it cannot be trusted.

            `t1 - t0` is WALL time. Pause rows are dropped by the IsRaceOn filter, so two surviving rows straddle
            the pause and the span swallows it whole -- which is why "pause after the finish line voids the next
            lap". Measured on one 9-lap capture: 2015 s of wall time, 290 s of game time, 1724 s (86%) frozen,
            and the frozen time is IsRaceOn=0 in 179,642 rows out of 179,642. So CurrentRaceTime is pause-immune
            by construction, and its span matched the game's own LastLap to 0.001-0.002 s on every lap checked.
            The store held a 79.40 s median on a ~30 s circuit, with implied average speeds down to 1.0 mph.

            LastLap is preferred (it IS the official time) but is NOT unconditionally reliable -- it has been seen
            latching 43840.992 s and 231307.938 s -- so it is only accepted when it agrees with the race-clock
            span. Returning None rather than a wrong number matters: lap_s gates the 107% competitive rule, and a
            bogus fast lap silently mis-rates every other lap on the course. A lap with no trustworthy time still
            keeps its trace: cornering and grip data never needed a lap time.
            """
            rs_ = [r for r in loop_rows if w_["t0"] <= r["t"] <= w_["t1"] and r.get("CurrentRaceTime") is not None]
            if len(rs_) < 20:
                return None
            span = rs_[-1]["CurrentRaceTime"] - rs_[0]["CurrentRaceTime"]
            if not (3.0 <= span <= 1800.0):
                return None
            ll = rs_[-1].get("LastLap") or 0.0
            if 3.0 <= ll <= 1800.0 and abs(ll - span) <= max(0.5, 0.05 * span):
                return round(ll, 3)          # the game's own official time, corroborated by its race clock
            return round(span, 3)
        def _impacts(pts_):   # grip 4 = the JOLT alphabet (|lat_g| > 3 or SmashableVelDiff > 0). Display only. Count BEFORE thinning.
            return sum(1 for p in pts_ if len(p) > 4 and p[4] == 4)
        def _contacts(w_):
            """TRUE CONTACT ONLY — a hit on a smashable object. grip_code 4 must NEVER decide a lap's validity:
            measured across five captures it fired 500 times on |lat_g| > 3.0 against 4 times on
            SmashableVelDiff, and the two arms never co-occur in a single frame. 73% of grip-4 points sit within
            40 m of a mapped turn, and this course's best CLEAN pass through T8 pulls 2.92 g against a 3.0 g
            gate — a 2.7% margin. So grip-4 is a hard-cornering detector wearing an impact's name, and voiding on
            it struck out five of the six fastest laps on record, moving the reference best 29.7 -> 30.4 s and
            heading for 34.0 s once every session re-analysed. Only a smashable hit is unambiguous."""
            return sum(1 for r in loop_rows if w_["t0"] <= r["t"] <= w_["t1"] and (r.get("SmashableVelDiff") or 0) > 0)
        def _thin(pts_, n):
            # Thin to ~n points but NEVER drop an impact: the map/trace draw their impact markers from these very
            # points, so a thinned-out hit would vanish from the map while the stored `impacts` count still claimed it.
            # (Latent today — every stored lap resamples to < 600 points — but a 10 km route strides by 8.)
            k = max(1, len(pts_) // n)
            if k == 1: return pts_
            keep = set(range(0, len(pts_), k)) | {i for i, p in enumerate(pts_) if len(p) > 4 and p[4] == 4}
            return [pts_[i] for i in sorted(keep)]
        # EVERY lap that covers the course goes to the append-only lap store — competitiveness (the 107% rule) is
        # judged at read time against each build's own best, so a later faster lap RE-RATES history instead of
        # deleting it. The model keeps only the best per tune (a compact summary; the store holds the record).
        _lap_rows = []
        for cid_, wins in _trace_wins.items():
            valid = [w for w in wins if id(w) in _win_arc and _win_arc[id(w)][0] >= 0.7 * _ref_arc]
            if not valid: continue
            _cr = cars.get(cid_) or {}
            for w in valid:
                arc_w, pts_w = _win_arc[id(w)]
                _ev = evs[w["ev"]] if 0 <= w["ev"] < len(evs) else {}
                # VOID: contact invalidates a TIMED lap, so the time is not a time at all. It must never become the
                # cid's reference best, because the 107% competitive rule is judged against that best — one void
                # 'fast' lap would silently mis-rate every other lap on the course. In a RACE contact is normal:
                # show the impacts, keep the time. Solo unknown => not voided (absence of evidence isn't evidence).
                # SOLO IS INFERRED FROM ABSENCE, SO CORROBORATE IT BEFORE VOIDING ON IT. A lap is called solo
                # when RacePosition was reported, never varied and never exceeded 1 -- which is exactly what a
                # race led from lights to flag looks like. Measured on fh6_20260901_042403: five events, four
                # of them plainly races (positions up to 5), and the fifth held position 1 for all 22,548
                # frames because it was won from the front. It was filed as a time trial, marked solo, and then
                # VOIDED for its 6 impacts -- while a sibling race lap in the same session kept its time with
                # 23. A 5.74 mi race the player won was discarded on absence of evidence, which the comment
                # above already says must not happen.
                # The session settles it: if any other event here saw an opponent, this player was racing, and
                # an event that merely never fell behind is not established as solo. A genuinely solo session
                # -- every event position-1 throughout, which is what Rivals looks like -- still voids on
                # contact, so the protection that matters is untouched.
                _sess_saw_rivals = any((e.get("solo") is False) for e in ev_out)
                _solo = 1 if (_ev.get("solo") and not _sess_saw_rivals) else 0
                _imp = _impacts(pts_w)
                _lap_s = _game_lap_s(w)
                _th = _tune_hash_for(cid_, w)
                # A LAP BELONGS TO THE COURSE WHOSE LINE IT CROSSED — not to whichever course this loop is on.
                # This wrote the outer `key`, so every window a car drove was filed under EVERY course that car
                # visited in the session: one 5,696 m lap appeared under both -6800_-1100 and -3750_300, and so
                # did four others. Duplicated laps inflate a course's history and, through the 107% rule, let a
                # lap set on one road define the reference best on another.
                # The event already carries the route its start/finish line identified; that is the answer.
                # File it under the line it crossed. Do NOT skip a lap whose route differs from this loop's
                # course: the first cut did, and the 23.41 mi Colossus lap vanished outright, because that route
                # has no course entry in this session for the loop to reach. Losing a lap is far worse than
                # filing one twice — and it cannot be filed twice anyway, since the store is UNIQUE on
                # (route_key, session, cid, t0), so a second write of the same lap is an idempotent upsert.
                _rk = _ev.get("route_key") or key
                _lap_rows.append({"route_key": _rk, "session": sid, "cid": cid_, "t0": round(w["t0"], 1),
                                  "lap_s": _lap_s, "arc_m": round(arc_w),
                                  "build_id": _cr.get("build_id"), "class": _cr.get("class"), "pi": _cr.get("pi"),
                                  "drivetrain": _cr.get("drivetrain"), "solo": _solo,
                                  "impacts": _imp, "void": 1 if (_contacts(w) and _solo) else 0,
                                  "tune_hash": _th,
                                  "pts": [[round(p[2]), round(p[3], 1), (p[4] if len(p) > 4 else 0), round(p[0]), round(p[1]), round(p[5], 1) if len(p) > 5 else None] for p in _thin(pts_w, 300)]})
            # A PARTIAL LAP IS NOT THIS BUILD'S BEST LAP. `valid` only requires 70% of the session's own
            # reference arc, so on a course driven in fragments the shortest window wins on wall-clock and
            # becomes the stored trace -- the backfill surfaced five courses whose trace covered under half the
            # longest. Require near-full coverage, and rank on the GAME clock, not the pause-inflated wall span.
            _full = [w for w in valid if _win_arc[id(w)][0] >= 0.9 * _ref_arc]
            if not _full:
                continue   # no window covered the course: the lap store keeps the partials, the model saves no best trace
            def _bw_key(w):
                g_ = _game_lap_s(w)
                return g_ if g_ is not None else (w["t1"] - w["t0"])
            bw = min(_full, key=_bw_key)
            lt = round(_bw_key(bw), 2)
            pts_all = _win_arc[id(bw)][1]
            carrec = cars.get(cid_) or {}
            # pts = [arc_m, mph, grip_code, x, z] — the state paints the trace, and x/z lets a hover on the trace
            # point at the exact spot on the course map (no arc-to-path alignment guesswork). Older 2-column
            # traces still render: every consumer treats columns 3-5 as optional.
            speed_traces_new[cid_] = {"lap_s": lt, "session": sid, "build_id": carrec.get("build_id"), "class": carrec.get("class"), "pi": carrec.get("pi"), "drivetrain": carrec.get("drivetrain"),
                                      "pts": [[round(p[2]), round(p[3], 1), (p[4] if len(p) > 4 else 0), round(p[0]), round(p[1]), round(p[5], 1) if len(p) > 5 else None] for p in _thin(pts_all, 300)]}
        # (course model + mturn_for were loaded above, before clustering)
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
            # FULL per-phase profile across this turn's passes (1=brake/approach, 2=turn-in, 3=mid, 4=exit) so the
            # course dashboard can show every phase of every turn, not just the dominant one. `first_n` = passes whose
            # FIRST grip loss was here (where the trouble STARTS); status = which axle gives up in this phase.
            phase_profile = []
            for pnum in (1, 2, 3, 4):
                ps = [p for m in ms for p in (m.get("phases") or []) if p.get("phase") == pnum]
                if not ps:
                    phase_profile.append({"phase": pnum, "n": 0, "status": "unseen"}); continue
                rfn = sum(1 for p in ps if p.get("red") in ("front", "both"))
                rrn = sum(1 for p in ps if p.get("red") in ("rear", "both"))
                st = "front" if rfn > rrn else "rear" if rrn > rfn else ("both" if rfn and rrn else "clean")
                phase_profile.append({"phase": pnum, "n": len(ps), "red_front": rfn, "red_rear": rrn,
                                      "clean": sum(1 for p in ps if p.get("red") == "none"), "first_n": ph.get(pnum, 0),
                                      "status": st, "front_slip": round(med([p["front"] for p in ps]), 2),
                                      "rear_slip": round(med([p["rear"] for p in ps]), 2)})
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
            if (ref is None or len(same) <= 1) and mb is None and mt and mt.get("radius_m") and car_grip.get(car_l) and car_grip_src.get(car_l) == "ev":   # cruise-fallback grip mints implausibly slow predicted refs a mediocre pass then 'beats' — predict only from committed on-course grip
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
                mt = {"id": f"T{len(model['turns']) + 1}", "pos": [round(cl["x"]), round(cl["z"])], "dir": None, "type": None, "radius_m": None, "n": 0, "best": None, "sessions": 0}
                if cl.get("status") == "turn": model["turns"].append(mt)   # 'possible' clusters no longer mint PERSISTENT model turns — noise accumulated forever and shifted later T-numbers; they persist only once they establish
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
            # ---- per-turn TRACK statistics: this turn's passes / presence / first-red / limiter accumulate across every session (keyed by session = idempotent) ----
            ms_ = mt.setdefault("by_session", {})   # ('sessions' on a model turn is the count)
            ms_[sid] = {"n": nn, "laps_seen": cl.get("laps_seen", 0), "laps": total_laps, "fr": fr, "lim": limiter, "multi": cl.get("multi"), "mph_min": med([m["mph_min"] for m in ms]), "usi": med(usis), "cars": sorted({m["car"] for m in ms})}
            fr_t = {"front": 0, "rear": 0, "none": 0}; lim_t = {"tune": 0, "driver": 0, "mixed": 0, "clean": 0}
            for v in ms_.values():
                for k2 in fr_t: fr_t[k2] += (v.get("fr") or {}).get(k2, 0)
                lim_t[v.get("lim") or "clean"] = lim_t.get(v.get("lim") or "clean", 0) + 1
            tot_n = sum(v["n"] for v in ms_.values()); tot_seen = sum(v["laps_seen"] for v in ms_.values())
            trk = {"passes": tot_n, "laps_seen": tot_seen, "sessions": len(ms_), "fr": fr_t, "lim": lim_t, "dominant": (max(fr_t, key=fr_t.get) if tot_n else None), "consistency": (round(max(fr_t.values()) / tot_n, 2) if tot_n else None),
                   "cars": sorted({c_ for v in ms_.values() for c_ in (v.get("cars") or [])})}
            mt["track"] = trk; mt["sessions"] = len(ms_)
            corner_out.append({"id": cl.get("cid", f"C{i}"), "status": cl.get("status", "turn"), "presence": cl.get("presence"), "laps_seen": cl.get("laps_seen"), "multi": cl.get("multi"), "per_lap": cl.get("per_lap"), "absorbed": cl.get("absorbed", 0),
                               "n": nn, "dir": max(("L", "R"), key=lambda d: sum(1 for m in ms if m["dir"] == d)), "pos": [round(cl["x"]), round(cl["z"])], "dist": med([m["dist"] for m in ms]),
                               "mph_min": med([m["mph_min"] for m in ms]), "mph_in": med([m["mph_in"] for m in ms]), "lat_g": med([m["lat_g_peak"] for m in ms]),
                               "first_red": fr, "dominant": dom, "dominant_phase": dom_ph, "phase_profile": phase_profile, "consistency": round(cons, 2), "usi": med(usis), "limiter": limiter, "note": note,
                               "model_id": mt["id"], "geo_id": geo_near(cl["x"], cl["z"]), "radius_m": mt.get("radius_m"), "ref": ref, "ref_src": ref_src, "ref_car": car_l, "last": last, "delta": delta, "advice": advice, "on_ref": on_ref, "track": dict(trk),
                               "usi_spread": round((sorted(usis)[int(0.75 * (nn - 1))] - sorted(usis)[int(0.25 * (nn - 1))]) if nn >= 2 else 0, 3), "runs": runs,
                               "type": "hairpin" if (med([m["mph_min"] for m in ms]) or 0) < 45 else "fast" if (med([m["mph_min"] for m in ms]) or 0) > 85 else "medium"})
        # persist the course model (never from replays); the session carries a compact summary
        # ---- TRACK RECORD: the track is the entity — cars and sessions are visits. Everything track-specific accumulates here on identification. ----
        ev_best = [(e["best_lap"], e["car"]) for e in evs if e.get("best_lap")]
        best_here = min(ev_best, key=lambda x: x[0]) if ev_best else None
        model.setdefault("best_laps", {}); model.setdefault("visits", []); model.setdefault("cars", {})
        for e in evs:
            cinfo = cars.get(e["car"]) or {}
            model["cars"][e["car"]] = {"name": cinfo.get("name"), "class": cinfo.get("class"), "pi": cinfo.get("pi"), "drivetrain": cinfo.get("drivetrain")}
            if e.get("best_lap"):
                cur_ = model["best_laps"].get(e["car"])
                if not cur_ or e["best_lap"] < cur_["best_lap"] or cur_.get("session") == sid and e["best_lap"] <= cur_["best_lap"]:
                    model["best_laps"][e["car"]] = {"best_lap": e["best_lap"], "session": sid, "name": cinfo.get("name"), "class": cinfo.get("class"), "pi": cinfo.get("pi"), "drivetrain": cinfo.get("drivetrain"),
                                                    "build_id": cinfo.get("build_id"), "hp": (cinfo.get("sig") or {}).get("hp_peak"), "gears": (cinfo.get("sig") or {}).get("gear_count")}   # the BEST BUILD that set the record
        if _lap_rows:
            try: lap_store.put_laps(ROOT, _lap_rows)     # EVERY covering lap — append-only, idempotent per (course, session, cid, t0)
            except Exception as _e: print(f"[laps] store write failed: {_e!r}")
        trm = model.setdefault("speed_traces", {})   # per-tune traces: a cid's saved trace only improves (faster lap replaces slower); the 10 fastest tunes kept
        for cid_, tr_ in speed_traces_new.items():
            prev_ = trm.get(cid_)
            if prev_ is None or (tr_.get("lap_s") or 9e9) < (prev_.get("lap_s") or 9e9) or prev_.get("session") == sid: trm[cid_] = tr_   # same-session re-analysis may REPAIR a bad trace (the escape best_laps already has)
        # RETIRE SHORT TRACES. A stored trace only improves on lap TIME, so a partial lap that once won the slot
        # keeps it forever — it is short, therefore quick, therefore never beaten. The backfill surfaced five
        # courses whose trace covered under half the longest. Coverage is judged against the course's own mapped
        # length (falling back to the longest trace on record), so no caller has to declare it.
        _clen = ((model.get("geometry") or {}).get("length_m") or 0) or max(
            [(t.get("pts") or [[0]])[-1][0] for t in trm.values() if t.get("pts")] or [0])
        # ...AND WIDE ONES, WHICH THIS DID NOT. Coverage was bounded below and not above, so a trace running far
        # PAST the line survived here even though promote_into -- in this same file, a few lines down -- rejects
        # anything at 1.45x or more, and the audit FAILs it as trace-too-wide. Two paths writing the same field
        # under different rules is how -1700_-4450 ended up holding a 6920 m trace on a 1920 m map, 3.60x.
        # One rule, both ends, stated once by promote_traces so the three places cannot drift apart again.
        # ONE RULE MEANS THE SAME MEASUREMENT AND THE SAME EXEMPTIONS. Two things were still this pass's own:
        # it measured a trace's span as pts[-1][0], where the other four places sum the increasing runs because
        # a trace stitched from pieces RESETS its arc mid-way -- so a real lap read short here and was deleted;
        # and it had no fragmented-map gate, while promote_into, the promoter's CLI, the repair tool and the
        # audit all stand down on a map of disconnected scraps. On such a map coverage means nothing, so this
        # pass was deleting the only trace those courses had on a measurement nobody else trusts.
        if _clen:
            try:
                import promote_traces as _ptb
                _lo, _hi, _span, _frag = _ptb.COVER, _ptb.WIDE, _ptb.span, _ptb.fragmented
            except Exception:
                _lo, _hi, _frag = 0.7, 1.45, (lambda _g: False)
                def _span(_p):
                    _t = 0.0; _pv = None; _st = None
                    for _q in _p or []:
                        _a = _q[0]
                        if _pv is None: _st = _a
                        elif _a < _pv: _t += _pv - _st; _st = _a
                        _pv = _a
                    return _t + (_pv - _st) if _pv is not None else 0.0
            if not _frag(model.get("geometry") or {}):
                for _k in [k for k, t in trm.items() if t.get("pts")
                           and not (_lo * _clen <= _span(t["pts"]) < _hi * _clen)]:
                    trm.pop(_k, None)
        if len(trm) > 10: model["speed_traces"] = trm = dict(sorted(trm.items(), key=lambda kv: kv[1].get("lap_s") or 9e9)[:10])
        model["visits"] = sorted([v for v in model["visits"] if v.get("session") != sid] + [{"session": sid, "laps": total_laps, "attempts": nev, "cars": co["cars"], "best_lap": best_here[0] if best_here else None, "best_car": best_here[1] if best_here else None}], key=lambda v: v["session"])[-40:]
        model["laps"] = sum(v.get("laps", 0) for v in model["visits"]); model["sessions"] = sorted({v["session"] for v in model["visits"]})   # idempotent under re-analysis
        mlaps = model["laps"] or 1
        # ---- MERGE model-turn fragments: the same physical corner detected at slightly different apex across sessions became separate model turns (bloated to 20+).
        #      Collapse turns within 35 m into one, recombine per-session detections, then keep a STABLE canonical set (established across the track). ----
        def _tpass(t): return (t.get("track") or {}).get("passes", 0)
        merged_turns = []
        for t in sorted(model.get("turns", []), key=lambda t: -_tpass(t)):
            hit = next((u for u in merged_turns if (u["pos"][0] - t["pos"][0]) ** 2 + (u["pos"][1] - t["pos"][1]) ** 2 <= 35 ** 2 and u.get("dir") == t.get("dir")), None)
            if hit:
                hbs = hit.setdefault("by_session", {})
                for s_, v in (t.get("by_session") or {}).items():
                    if s_ not in hbs or (v.get("n", 0) > (hbs[s_] or {}).get("n", 0)): hbs[s_] = v
                if t.get("radius_m") and (not hit.get("radius_m") or _tpass(t) > _tpass(hit) * 0): hit["radius_m"] = hit.get("radius_m") or t.get("radius_m")
                if not hit.get("best") and t.get("best"): hit["best"] = t["best"]
            else: merged_turns.append(t)
        for t in merged_turns:   # recompute each merged turn's track stats from its combined per-session detections
            bs = t.get("by_session") or {}; fr_t = {"front": 0, "rear": 0, "none": 0}; lim_t = {}
            for v in bs.values():
                for k2 in fr_t: fr_t[k2] += (v.get("fr") or {}).get(k2, 0)
                lim_t[v.get("lim") or "clean"] = lim_t.get(v.get("lim") or "clean", 0) + 1
            tn = sum(v.get("n", 0) for v in bs.values()); tseen = sum(v.get("laps_seen", 0) for v in bs.values())
            t["track"] = {"passes": tn, "laps_seen": tseen, "sessions": len(bs), "fr": fr_t, "lim": lim_t, "dominant": (max(fr_t, key=fr_t.get) if tn else None), "consistency": (round(max(fr_t.values()) / tn, 2) if tn else None),
                          "cars": sorted({c_ for v in bs.values() for c_ in (v.get("cars") or [])}), "laps_track": model["laps"], "presence": round(tseen / mlaps, 2)}
            t["sessions"] = len(bs)
        # order along the route (nearest point on the learned path) and renumber; the canonical set = turns established across the track
        gpath = ((model.get("geometry") or {}).get("path")) or [t["pos"] for t in merged_turns]
        # ARC, NOT A VERTEX INDEX. This returned the INDEX of the nearest path point, and the ordering below
        # mixes its result with turns that carry a real `s` in METRES -- 0..37037 on the Colossus against an
        # index 0..len(path). A turn with no arc of its own was therefore sorted as though its index were a
        # distance, landing it among turns hundreds of metres from where it is. Cumulative arc over the same
        # vertices puts both operands in the same unit; the sum is gap-aware so the jump between disconnected
        # map pieces is not counted as road, matching how length_m and audit_models measure the same path.
        _gcum = [0.0]
        for _i in range(1, len(gpath)):
            _d = math.hypot(gpath[_i][0] - gpath[_i - 1][0], gpath[_i][1] - gpath[_i - 1][1])
            _gcum.append(_gcum[-1] + (_d if _d <= 150.0 else 0.0))
        def route_s(pos):
            best_i = min(range(len(gpath)), key=lambda i: (gpath[i][0] - pos[0]) ** 2 + (gpath[i][1] - pos[1]) ** 2) if gpath else 0
            return _gcum[best_i] if best_i < len(_gcum) else 0.0
        # ═══ A TURN IS A PROPERTY OF THE ROAD, NOT OF HOW HARD YOU DROVE IT ═══
        # Turn EXISTENCE comes from geometry + geography: the curvature of the path you drove, which is
        # pace-independent. Tyre load (the 0.35 g behavioural detector) only describes HOW a turn was taken —
        # it can never decide whether the turn is there. Basing existence on load was the root cause of turns
        # that vanish when driven smoothly, and of every ratio/persistence patch built to compensate.
        # Geometry turns are merged across sessions positionally, the same way behavioural ones are.
        # THE MATCHER MUST NEVER MERGE TWO TURNS THE MAP CALLS DISTINCT. A fixed tolerance cannot know how close
        # a course's corners are: Edamame has two pairs only 20 m apart (G2/G3 and G8/G9), so a 22 m arc match
        # collapsed each pair and 13 mapped turns became 11 registry entries and 10 drawn markers. The map is the
        # authority on what a turn is, so the map sets the tolerance — half the closest gap it contains, capped
        # at the old value. Distinct turns then cannot collide however tightly a circuit is packed.
        # DERIVE THE TOLERANCE FROM THE MAP THAT WILL BE THE COURSE'S MAP, not from this session's fresh
        # detections. _ms read (geo or {}).get("turns") -- the session's own turns -- and fell back to a 44 m
        # default whenever a short capture produced fewer than two. That yields _TOL_S=22 / _TOL_XZ=18, exactly
        # the pre-fix constants this block exists to replace, on precisely the runs least able to afford them.
        _authoritative = ((geo.get("turns") if better_map(geo, model.get("geometry"))
                           else (model.get("geometry") or {}).get("turns")) or [])
        _ms = sorted(t.get("s") for t in _authoritative if t.get("s") is not None)
        _gapmin = min((b - a for a, b in zip(_ms, _ms[1:])), default=44)
        _TOL_S = max(6.0, min(22.0, _gapmin / 2.0))
        _TOL_XZ = max(6.0, min(18.0, _gapmin / 2.0))
        gseen = model.setdefault("geo_turns", {})       # stable key -> {pos, dir, radius_m, deg, sessions[]}

        def _bind(ap, _as, taken):
            """NEAREST registry entry inside the positional gate, one-to-one. Three faults lived in the `next(...)`
            this replaces: it returned the first DICT-ORDER hit rather than the closest; the `or` across the two
            tolerances let an 8 m arc match forgive a 49 m positional error, which is how two keys ended up
            holding physically opposite ends of the same course (~312 m adrift); and nothing stopped two map
            turns binding the same entry, so a pair 20 m apart collapsed into one. Arc is a TIEBREAK among
            candidates already inside the XZ gate, never an alternative to it."""
            best, bd = None, _TOL_XZ ** 2
            for k, v in gseen.items():
                if k in taken or not v.get("pos"):
                    continue
                d = (v["pos"][0] - ap[0]) ** 2 + (v["pos"][1] - ap[1]) ** 2
                if d > bd:
                    continue
                if d < bd or (best is not None and _as is not None and v.get("s") is not None
                              and abs(v["s"] - _as) < abs(gseen[best].get("s", 1e9) - _as)):
                    best, bd = k, d
            return best
        _taken = set()
        for g_ in ((geo or {}).get("turns") or []):
            ap = g_.get("apex")
            if not ap: continue
            _as = g_.get("s")
            hit_k = _bind(ap, _as, _taken)
            if hit_k: _taken.add(hit_k)
            rec = gseen.setdefault(hit_k or f"{round(ap[0])}_{round(ap[1])}",
                                   {"pos": [round(ap[0]), round(ap[1])], "s": g_.get("s"), "dir": g_.get("dir"), "radius_m": g_.get("radius_m"), "deg": g_.get("deg"), "sessions": []})
            if sid not in rec["sessions"]: rec["sessions"].append(sid)
            rec["sessions"] = rec["sessions"][-40:]
            # POSITION MUST TRACK THE MAP. pos was written once at creation and never again, while s refreshed --
            # so an entry whose apex the detector had since MOVED kept being drawn at the old place. That is the
            # phantom at 0.64 g sitting 40 m from any real corner: not a spurious turn, a real turn drawn stale.
            rec["pos"] = [round(ap[0]), round(ap[1])]
            for f_ in ("dir", "radius_m", "deg", "s"):
                if g_.get(f_) is not None: rec[f_] = g_[f_]
        # the model's PERSISTED geometry is the best map on record — a full mapped lap, already vetted. Every
        # turn in it is part of the road by definition, so it seeds the inventory at full standing.
        # REBUILT, never accumulated: this flag used to be set and never cleared, so a turn that appeared in any
        # map ever stayed established forever — a corrected map could remove a corner from the road and the
        # inventory would still carry it. It describes the CURRENT map or it describes nothing.
        for _v in gseen.values(): _v.pop("model_map", None)
        # ...and seed from the map that will actually BE the course's map after this session, not the one it was
        # replacing. Reading the stored map here while the write below adopted the fresh one is what kept a
        # superseded double lap's phantom corners standing at full geometric authority.
        _taken2 = set()
        for g_ in _authoritative:
            ap = g_.get("apex")
            if not ap: continue
            _as = g_.get("s")
            hit_k = _bind(ap, _as, _taken2)
            if hit_k: _taken2.add(hit_k)
            rec = gseen.setdefault(hit_k or f"{round(ap[0])}_{round(ap[1])}",
                                   {"pos": [round(ap[0]), round(ap[1])], "s": g_.get("s"), "dir": g_.get("dir"), "radius_m": g_.get("radius_m"), "deg": g_.get("deg"), "sessions": []})
            rec["model_map"] = True
            # refresh from the MAP it just bound to — an entry whose apex the detector moved must not keep
            # describing where the corner used to be (that is the ~312 m drift, and it is what a stale `pos`
            # then feeds to every downstream matcher).
            rec["pos"] = [round(ap[0]), round(ap[1])]
            for f_ in ("dir", "radius_m", "deg", "s"):
                if g_.get(f_) is not None: rec[f_] = g_[f_]
        # THE CURRENT MAP IS THE GEOMETRIC TRUTH. An entry not in it is a superseded apex, full stop. The old
        # rule also spared anything "seen this session", which meant every time the detector moved an apex the
        # PREVIOUS position survived beside the new one and they accumulated: one corner ended up drawn twice
        # (markers 1 and 2 both resolving to G1, 60 m and 4 m away), and a phantom sat at 0.64 g -- the lowest
        # of any drawn turn, 40 m from the nearest real corner -- on road where the car is not cornering at all.
        for k_ in [k for k, v in gseen.items() if not v.get("model_map")]:
            gseen.pop(k_, None)   # not in the course's own map = not part of the road
        # every geometric turn becomes a model turn (created if the behavioural pass never saw it)
        for t in merged_turns: t.pop("geo_mapped", None); t.pop("geo_sessions", None)   # re-derived from gseen below, never inherited from the file
        _bound = set()
        for k, v in gseen.items():
            # ...and the same map-derived tolerance here. A 40 m radius silently re-merged what the two matchers
            # above had just kept apart: 13 registry entries collapsed back to 10 model turns because Edamame
            # has pairs 20 m apart. Every stage that matches turns to turns must use the map's own spacing.
            # NEAREST AND ONE-TO-ONE, like the two above it. First-hit matching let two registry entries 20 m
            # apart both bind the same merged turn, so the pair the tolerance had just protected collapsed here
            # instead — one stage later, with the same result and no trace of which stage lost them.
            _cand = [(t, (t["pos"][0] - v["pos"][0]) ** 2 + (t["pos"][1] - v["pos"][1]) ** 2)
                     for t in merged_turns if id(t) not in _bound]
            _cand = [c for c in _cand if c[1] <= _TOL_XZ ** 2]
            hit = min(_cand, key=lambda c: c[1])[0] if _cand else None
            if hit is not None: _bound.add(id(hit))
            if hit is None:
                hit = {"id": "T?", "pos": list(v["pos"]), "dir": v.get("dir"), "type": None, "radius_m": v.get("radius_m"),
                       "n": 0, "best": None, "sessions": 0, "by_session": {}, "track": {}}
                merged_turns.append(hit)
            hit["geo_sessions"] = len(v.get("sessions") or [])
            hit["geo_mapped"] = bool(v.get("model_map"))
            hit["deg"] = v.get("deg")
            hit["s"] = v.get("s")                                     # the ARC the map measured for this corner
            if hit.get("radius_m") is None: hit["radius_m"] = v.get("radius_m")
            if hit.get("dir") is None: hit["dir"] = v.get("dir")
        # ORDER BY THE ARC THE MAP MEASURED, NOT BY THE NEAREST VERTEX IN SPACE. route_s is an unconstrained
        # global nearest-vertex search over the flat path, so where a course runs the same tarmac twice the two
        # passes are metres apart in XZ and the argmin picks a vertex on the WRONG pass -- on -6800_-1100 the
        # apexes of the corners at arc 508 m and 1756 m are 19.2 m apart. This sort decides the T1..Tn numbering
        # on the next line, so a corner on the return pass was numbered as if it were on the way out, and every
        # id downstream inherited that. The registry entry already carries the arc the map measured; it was
        # simply never copied onto the turn (the same omission rebind_map_turns had). Where a turn knows its own
        # arc that decides; route_s remains the fallback for a turn the map has no record of.
        merged_turns.sort(key=lambda t: (t["s"] if t.get("s") is not None else route_s(t["pos"])))
        for i, t in enumerate(merged_turns, 1): t["id"] = f"T{i}"
        _has_map = bool(((model.get("geometry") or {}).get("turns")) or ((geo or {}).get("turns")))
        def _established(t):
            # GEOMETRY first: a curve confirmed by the road on 2+ visits IS a turn, however gently you take it.
            # (One visit can carry a rejoin/crawl artefact, so two is the noise filter.)
            if t.get("geo_mapped"): return "geometry"           # in the course's own persisted map = part of the road
            if (t.get("geo_sessions") or 0) >= 2: return "geometry"
            tr = t.get("track") or {}
            # BEHAVIOUR IS A FALLBACK ONLY WHILE THERE IS NO MAP. It was a reasonable source when curvature
            # thresholds missed gentle corners, but the lateral-g split now folds those into the geometry — and
            # a behaviour-only turn depends on HOW YOU DROVE, so it reintroduces exactly the drift this course
            # kept showing: 13 mapped turns became 16 established because three grip clusters sat outside the
            # map. Where a map exists it is the authority on what a turn is; where none exists yet, behaviour
            # is still the only thing there is.
            if not _has_map and ((tr.get("sessions", 0) >= 2 and (tr.get("laps_seen", 0) / mlaps) >= 0.35)
                                 or (tr.get("passes", 0) >= 0.5 * mlaps)): return "behaviour"
            if (t.get("geo_sessions") or 0) >= 1 and (tr.get("passes") or 0) >= 1: return "geometry+driven"   # mapped once AND actually driven
            return None
        for t in merged_turns:
            _by = _established(t); t["established"] = bool(_by); t["est_by"] = _by; t["status"] = "turn" if _by else "possible"
        # THE DECLARED COUNT IS A TEST, NEVER AN INPUT. Promoting unestablished clusters just to reach a declared
        # total made the count self-fulfilling: it could no longer disagree, so it could no longer reveal a
        # detector fault. Record the discrepancy so the dashboard can flag it, and let the geometry stand.
        _exp = model.get("expected_turns")
        model["turn_count_delta"] = (len([t for t in merged_turns if t["established"]]) - _exp) if _exp else None
        model["turns"] = merged_turns
        canonical = [t for t in merged_turns if t["established"]]
        model["turn_count"] = len(canonical)
        # ---- TRACE-DERIVED PER-TURN STATISTICS, additive ----
        # A corner is only DETECTED at lat_g > 0.35 sustained 0.8 s, so a sweeper taken without lifting produces
        # no corner record and its turn reads "not driven" though the car went through it every lap. laps.db has
        # held the answer all along, keyed by position. This measures every MAP turn from every stored lap and
        # hangs the result in its own `traced` namespace — never overwriting `track`, which is the accumulated
        # BEHAVIOURAL record with a different denominator (this course counts 194 laps where the store holds 94,
        # and 53% of mapped turns lab-wide sit on routes with no usable traces at all).
        # It is also the retroactive method: move or insert a turn and the next run re-derives it from laps
        # already driven. Measured at ~0.1 s for a 13-turn course with 94 laps, so it runs every cycle.
        try:
            import turn_stats as _TS
            _tr = _TS.measure(ROOT, key, model)
            _gt = [g for g in ((model.get("geometry") or {}).get("turns") or []) if g.get("apex")]
            _byid = {g.get("id"): g.get("apex") for g in _gt}
            for t_ in merged_turns:
                t_.pop("traced", None)                     # re-derived every run, never inherited
                p_ = t_.get("pos")
                if not p_:
                    continue
                # NOT `best`. This loop sits in the course body, not in a function, and `best` there already
                # holds the course's best LAP TIME from the events pass -- which is written out 170 lines later
                # as course_out["best_lap"]. Clobbering it with a geometry turn id put strings like "G3", "G44"
                # and "G22" in that field on 6 of 22 session-courses, and the dashboard called .toFixed on them.
                # Mine, from the commit that wired traced turns in. A distinct name is the whole fix.
                _bg, _bgd = None, 45.0 ** 2
                for gid, ap_ in _byid.items():
                    if not ap_:
                        continue
                    d_ = (ap_[0] - p_[0]) ** 2 + (ap_[1] - p_[1]) ** 2
                    if d_ < _bgd:
                        _bg, _bgd = gid, d_
                if _bg and _tr.get(_bg):
                    t_["traced"] = _tr[_bg]
        except Exception as _e:
            print("  [traced] skipped: %r" % (_e,))
        # track-level presence per turn (over ALL track laps) and a track-level turn-count confidence — the turn identity is corroborated across sessions, not just this one
        for k_ in corner_out:
            t_ = k_.get("track") or {}
            if t_: t_["laps_track"] = model["laps"]; t_["presence"] = (round(t_.get("laps_seen", 0) / model["laps"], 2) if model["laps"] else None)
        turns_info["track_laps"] = model["laps"]; turns_info["track_sessions"] = len(model["sessions"])
        turns_info["track_confidence"] = round(strength(model["laps"], 3) * max(0.3, agree), 2)
        # canonical turn count: the player's declared count wins; else the merged, established set. This is what the card shows — stable across sessions.
        est_count = model.get("turn_count", detected_here)
        turns_info["established"] = est_count; turns_info["count"] = expected if expected else est_count
        est_turns = [t for t in model["turns"] if t.get("established")]
        if expected and len(est_turns) > expected:   # trust the declared count: keep the strongest N (by track presence), drop the weakest as fragments
            est_turns = sorted(est_turns, key=lambda t: -((t.get("track") or {}).get("presence") or 0))[:expected]
            est_turns.sort(key=lambda t: [tt["id"] for tt in model["turns"]].index(t["id"]))   # restore route order
        # the projection carries the model's OWN description (type, how it established, the track record's
        # dominant axle + limiter) so the client never has to re-derive a turn's identity from a session corner
        turns_info["canonical"] = [{"id": t["id"], "pos": t["pos"], "dir": t.get("dir"), "radius_m": t.get("radius_m"), "type": t.get("type"), "est_by": t.get("est_by"),
                                    "passes": (t.get("track") or {}).get("passes"), "presence": (t.get("track") or {}).get("presence"), "sessions": (t.get("track") or {}).get("sessions"),
                                    "dominant": (t.get("track") or {}).get("dominant"), "lim": (t.get("track") or {}).get("lim"), "consistency": (t.get("track") or {}).get("consistency")} for t in est_turns]
        turns_info["mapped"] = len(((model.get("geometry") or {}).get("turns")) or (geo or {}).get("turns") or [])
        near = [t for t in model["turns"] if not t.get("established") and ((t.get("track") or {}).get("presence") or 0) >= 0.25]
        turns_info["near"] = len(near)
        if expected:
            miss = est_count - expected
            turns_info["note"] = (f"you declared {expected} turns · {est_count} established across {model['laps']} laps/{len(model['sessions'])} sessions" + (" — match ✓" if miss == 0 else f" · {abs(miss)} {'extra detected — likely fragments, keep lapping to settle' if miss > 0 else 'still to confirm'}" + (f"; {len(near)} more nearly established" if miss < 0 and near else "")) + (f" · {', '.join(messy)} split into several detections (drive as one arc)" if messy else ""))
        # RIVALS scoping: a course is Rivals when the player DECLARED it (routes.json "rivals") or every timed
        # event on it ran solo. Rivals laps are the clean comparable ones — no traffic, no contact, a ghost only —
        # so tune-vs-tune comparison should lean on them; races stay in the record but are marked.
        _decl = bool((routes.get(key) or {}).get("rivals"))
        turns_info["rivals"] = _decl or (bool(evs) and all(e.get("solo") for e in evs))
        turns_info["rivals_src"] = "declared" if _decl else ("inferred" if turns_info["rivals"] else "race")
        _max_ev_d = max((e.get("distance_m") or 0) for e in evs) if evs else 0
        _geo_len = ((model.get("geometry") or {}).get("length_m") or 0)
        if profile and (not model.get("profile") or (total_laps >= (model.get("profile_laps") or 0) and (not _geo_len or _max_ev_d >= 0.6 * _geo_len))):
            model["profile"] = profile; model["profile_laps"] = total_laps; model["profile_session"] = sid   # sector-restart partials count as 'laps' — a session of stubs must not overwrite a full-run profile (distance guard)
        model["updated"] = sid; model["name"] = co["name"] or model.get("name")
        bl = model.get("best_laps") or {}; overall = (min(bl.values(), key=lambda b_: b_["best_lap"]) if bl else None)
        track = {"name": model.get("name"), "laps": model["laps"], "sessions": len(model["sessions"]), "attempts": sum(v.get("attempts", 0) for v in model["visits"]),
                 "cars": [dict(cid=k_, **v) for k_, v in (model.get("cars") or {}).items()], "best_laps": [dict(cid=k_, **v) for k_, v in sorted(bl.items(), key=lambda kv: kv[1]["best_lap"])], "best": overall,
                 "visits": model["visits"][-8:], "this_session_best": (best_here[0] if best_here else None), "this_session_best_car": (best_here[1] if best_here else None),
                 "delta_to_track_best": (round(best_here[0] - overall["best_lap"], 3) if (best_here and overall) else None), "profile_laps": model.get("profile_laps"), "profile_session": model.get("profile_session"), "file": os.path.relpath(mpath, ROOT)}
        if geo:
            mg = model.get("geometry") or {}
            prev_lp = [lp for lp in (mg.get("lap_paths") or []) if lp.get("session") != sid]   # re-analysis of this session replaces its own laps
            layout = sorted(prev_lp + (geo.get("lap_paths") or []), key=lambda lp: (lp.get("session") or "", lp.get("ev", 0), lp.get("lap", 0)))[-48:]   # chronological (session ids are timestamps) — the 48 most RECENT laps, whatever the analysis order
            # THE TURNS OF A CIRCUIT ARE A FIXED PROPERTY OF THE ROAD. They must not move because of what you
            # happened to drive today. The lateral-g split needs many laps to build its profile, so a thin
            # session produces no profile, no split, and fewer turns — Edamame went 15 -> 7 exactly that way,
            # then the registry drew 8. A map derived from 32 laps is strictly better evidence than one derived
            # from 3, so turns are kept unless the new derivation saw AT LEAST AS MANY laps. Improve-only.
            _n_new = len(full_laps)
            _n_old = int(mg.get("turns_n_laps") or 0)
            if better_map(geo, mg):
                _keep_turns = (mg.get("turns") and _n_old > _n_new and
                               len(mg.get("path") or []) == len(geo.get("path") or []))   # same road, better evidence
                model["geometry"] = {"length_m": geo["length_m"], "path": geo["path"], "paths": geo.get("paths"),
                                     "turns": (mg["turns"] if _keep_turns else geo["turns"]),
                                     "turns_n_laps": (_n_old if _keep_turns else _n_new),
                                     "session": sid, "lap_paths": layout, "det": DET_VER,
                                     "lat_acc": (lat_acc if lat_acc is not None else mg.get("lat_acc"))}   # the map persists with the course
                if _keep_turns: geo["turns"] = mg["turns"]                                  # and the session shows the same map
            elif (mg.get("turns") and _n_new > _n_old and geo.get("turns")
                  and _arc_of(geo.get("path")) >= 0.90 * _arc_of(mg.get("path"))):
                # keeping the stored PATH, but this session saw more laps than the one that derived its turns —
                # so re-derive the turns on the better evidence without disturbing the road.
                # MORE LAPS OF LESS ROAD IS NOT BETTER EVIDENCE. This gate counted laps only, so a session holding
                # six FRAGMENTS of the Colossus outranked the derivation that had walked the whole 37849 m circuit,
                # and the course went from 24 turns to 2 while its map sat there untouched — 117 turn records
                # stranded, 2 established. Turns detected on a fragment describe the fragment; they cannot replace
                # turns detected on the full road no matter how many times the fragment was driven. Coverage is the
                # precondition, lap count only breaks the tie after it — the same order the map itself is judged by.
                mg["turns"] = geo["turns"]; mg["turns_n_laps"] = _n_new; mg["det"] = DET_VER
                if lat_acc is not None: mg["lat_acc"] = lat_acc
                mg["lap_paths"] = layout; model["geometry"] = mg
            else:
                mg["lap_paths"] = layout
                if lat_acc is not None: mg["lat_acc"] = lat_acc   # the bank grows even when the map does not change
                model["geometry"] = mg
            # The session's map should show the BEST-KNOWN map of the track (a thin 3-lap session must not display
            # only the road it saw) — borrow the model's geometry when it covers MORE ROAD. This used to borrow
            # whichever had MORE TURNS, which is not a measure of coverage: turns are a function of the path, so a
            # superseded over-detecting map always won and re-infected every new session with its extra corners.
            # Coverage and detector output are NOT the same thing, and gating both on det stranded every thin session
            # on the 24 models still stamped det=None: they borrowed nothing and drew only the road they saw. A
            # superseded detector does not make the ROAD wrong, so the path/length is borrowed on coverage alone;
            # TURNS are the detector's output, so they stay behind the det gate — that was the real intent.
            bestg = model["geometry"]
            if len(bestg.get("path") or []) > len(geo.get("path") or []):
                geo["paths"] = bestg.get("paths"); geo["path"] = bestg.get("path"); geo["length_m"] = bestg.get("length_m"); geo["from_model"] = True
                if bestg.get("det") == DET_VER: geo["turns"] = bestg["turns"]
            # The turn list is only NOW final (the borrow above may have replaced it), so this is where the
            # fastest documented line through each corner gets stamped on. Wrapped whole: this is an extra,
            # and a lap store that is locked, empty or malformed must cost the analysis nothing.
            try:
                _flaps = lap_store.get_laps(ROOT, key, cls=None, competitive_only=False, limit=400)   # READ ONLY
                _mturns = ((model.get("geometry") or {}).get("turns")) or []
                fast_lines(_flaps, _mturns)
                _gturns = geo.get("turns") or []
                # usually the same list object; they diverge when the det-gated borrow did not fire, and each
                # then carries its OWN turn enumeration — so recompute rather than copy across by id.
                if _gturns is not _mturns: fast_lines(_flaps, _gturns)
            except Exception as ex_: print("fastest lines skipped:", repr(ex_), file=sys.stderr)
            geo["layout_paths"] = [{"session": lp.get("session"), "pts": lp["pts"]} for lp in layout]   # every recorded lap of this course (all sessions) for the layout drawing
            _sc = shape_confidence(geo.get("path"), layout)   # SHAPE confidence: do the recorded laps trace the same outline? (rides on turns -> reaches the live push, unlike geometry)
            if _sc:
                turns_info["shape_confidence"], turns_info["shape_laps_agree"], turns_info["shape_laps_compared"], turns_info["shape_spread_m"], turns_info["shape_tol_m"] = _sc
            for k_ in ("lap_paths", "last_path"): geo.pop(k_, None)   # session entry keeps the drawable pieces + layout only (path kept for the map shape)
        if write_models:
            # THE BEST COVERING LAP THE STORE HOLDS BECOMES THE COURSE'S TRACE, HERE, EVERY TIME. Every lap is
            # written to data/laps.db, but the dashboard draws model["speed_traces"], and only this function ever
            # moved one across -- so a lap could be in the store, verified, and still invisible. The Colossus was:
            # a confirmed 369.2 s lap over 23.38 mi, and the course showed no trace at all. Promotion runs on the
            # model in memory, before the atomic write, so the file lands complete rather than needing a second
            # pass afterwards; the rule is coverage first then time, bounded at both ends, identical to the audit's
            # and the repair tool's. Wrapped whole: a locked or malformed store must cost the analysis nothing.
            try:
                import promote_traces as _pt
                _cxp = sqlite3.connect(os.path.join(ROOT, "data", "laps.db")); _cxp.row_factory = sqlite3.Row
                _pt.promote_into(model, key, _cxp)
                _cxp.close()
            except Exception as ex_: print("[traces] promotion skipped:", repr(ex_), file=sys.stderr)
            try:
                os.makedirs(mdir, exist_ok=True); tmp_ = mpath + ".tmp"
                with open(tmp_, "w", encoding="utf-8") as f: json.dump(model, f, indent=1, ensure_ascii=False)
                os.replace(tmp_, mpath)   # atomic: a concurrent reader (build-db, the daemon) never sees a half-written model
            except Exception as ex_: print("course model not saved:", repr(ex_), file=sys.stderr)
        model_info = {"turns": len([t for t in model["turns"] if t.get("status", "turn") == "turn"]), "laps": model.get("laps", 0), "sessions": len(model.get("sessions", [])), "file": os.path.relpath(mpath, ROOT)}
        on_ref_n = sum(1 for k in corner_out if k.get("on_ref")); cmp_n = sum(1 for k in corner_out if k.get("delta") is not None)
        pred_n = sum(1 for k in corner_out if (k.get("ref") or {}).get("predicted")); own_n = sum(1 for k in corner_out if k.get("ref") and not (k.get("ref") or {}).get("predicted"))
        own_by_car = {}   # J17: "refs for this car" must count THIS build's refs — each corner's ref belongs to whichever build last drove it
        for k in corner_out:
            if k.get("ref") and not (k.get("ref") or {}).get("predicted") and k.get("ref_car"):
                own_by_car[k["ref_car"]] = own_by_car.get(k["ref_car"], 0) + 1
        if geo:   # mapped turns vs driven turns: a mapped turn with no behavioural corner is a turn you took flat / never loaded — it still exists
            # POSITIONAL, not id-string: geo_id strings are minted per session, and the geometry may be model-borrowed
            # from ANOTHER session's enumeration — comparing ids across the two spaces produced phantom not_driven turns.
            def _near_geo(gt):
                ax = gt.get("apex")
                return bool(ax and any(k.get("pos") and (k["pos"][0] - ax[0]) ** 2 + (k["pos"][1] - ax[1]) ** 2 <= 45 * 45 for k in corner_out))
            driven_g = [g["id"] for g in geo["turns"] if _near_geo(g)]
            geo["driven"] = len(driven_g); geo["not_driven"] = [g["id"] for g in geo["turns"] if g["id"] not in driven_g]
            turns_info["mapped"] = len(geo["turns"]); turns_info["mapped_driven"] = len(driven_g)   # (model geometry is persisted in the block above, before the flat copies are stripped)
        # COMPLETENESS (after the FINAL mapped count — the session geometry can be richer than the model's): consistency
        # of the detections that exist is NOT completeness against the road shape. A turn never detected leaves no
        # cluster and costs `agree` nothing — so confidence converged happily at N-minus-the-missed-turns while the
        # curvature map knew better. Cap both confidences by enumerated/mapped (+1 slack for extractor generosity).
        if turns_info.get("mapped"):
            # Denominator honesty (two escape hatches for a deadlocked gate):
            # 1. the player's DECLARED count is ground truth — when set, coverage measures against IT, not the extractor
            # 2. short shallow KINKS are mapped pace-free but the behavioral detector (0.8s over 0.25g) structurally
            #    cannot register them — 'take it at pace' shortens time-in-corner, a dead-end ask. Exempt them.
            if expected:
                _den = expected
            else:
                _subst = [g for g in ((geo or {}).get("turns") or (model.get("geometry") or {}).get("turns") or []) if (g.get("deg") or 99) >= 30 or (g.get("len_m") or 99) >= 40]
                _den = len(_subst) if _subst else turns_info["mapped"]
            _cover = min(1.0, (est_count + 1) / max(1, _den))
            turns_info["confidence"] = round(turns_info.get("confidence", 0) * _cover, 2)
            turns_info["track_confidence"] = round(turns_info.get("track_confidence", 0) * _cover, 2)
            turns_info["shape_coverage"] = round(_cover, 2)
        # STAMP THE GENERATION ON THE SESSION'S TURN SET. The dashboard used to let the session's canonical turns
        # replace the model's outright, on the reasoning that the session sees the model live and db.js is a
        # snapshot. That holds only while the analysis is CURRENT: an analysis produced by a superseded detector is
        # the STALER of the two, and Edamame duly rendered 8 turns from a stale session over a 13-turn model. The
        # client cannot judge which is fresher without knowing which detector each came from, so say so.
        turns_info["det"] = DET_VER
        course_out.append({"route_key": key, "name": co["name"], "cars": co["cars"], "runs": nev, "best_lap": best, "composition": counts, "corners": corner_out, "is_loop": key.startswith("loop:"), "decode": decode, "profile": profile, "laps": laps_info, "turns": turns_info, "speed_traces": model.get("speed_traces"),
                           "model": model_info, "track": track, "driving": {"compared": cmp_n, "on_reference": on_ref_n, "predicted": pred_n, "own_refs": own_n, "own_refs_by_car": own_by_car, "car_grip": {k_: car_grip.get(k_) for k_ in co["cars"]}}, "geometry": geo,
                           "coverage": {"overall": round(num / den, 2) if den else 0.0, "probes": probes}, "events": evs, "advice_by_car": advice_by_car, "last_t": max(e["t1"] for e in evs)})
    course_out.sort(key=lambda c: -c["last_t"])
    sess["courses"] = course_out
    sess["summary"] = {"cars": len(cars), "configs": len(segments), "stints": len(stints), "events": len(ev_out), "courses": len(course_out), "corners": len(corners), "launches": len(launches), "braking": len(braking), "bottoming": len(bott), "pulses": len(pulses), "impacts": len(impacts),
                       "front_limited_corners": sum(1 for c in corners if c["first_red"] and c["first_red"]["axle"] == "front" and not c["drift"]),
                       "rear_limited_corners": sum(1 for c in corners if c["first_red"] and c["first_red"]["axle"] == "rear" and not c["drift"]),
                       "drift_corners": sum(1 for c in corners if c["drift"])}
    out = os.path.join(outdir, sid + ".json")
    with open(out + ".tmp", "w") as f: json.dump(sess, f, separators=(",", ":"))
    os.replace(out + ".tmp", out)   # atomic
    print(f"wrote {out}  ({os.path.getsize(out)//1024} KB)  cars={[(c['id'], c['name'], c['build_id']) for c in sess['cars']]}  summary={sess['summary']}")

if __name__ == "__main__":
    main()
