#!/usr/bin/env python3
"""
fh6_tune_decode.py  —  Read FH6 tunes straight off disk.

FH6 writes every tune as a fixed 598-byte plaintext binary at
    C:\\XboxGames\\GameSave\\pgs\\u_<id>\\<n>\\ContainersRoot\\Tuning_<ordinal>_<yyyymmddhhmmss>\\Data
No key, no decryption. Sliders are stored as NORMALISED 0..1 slider positions;
parts are U32 catalog IDs. This module maps the bytes to labelled tune values
and de-normalises the fixed-range sliders to real in-game numbers.

Field map: HDR gist 41426137a24ef83b3f391542ce51982d, validated byte-for-byte
against this machine's saves (2014 Golf R, ordinal 2142) vs the project's
footage-verified values in data/tuning-variables.json — caster 6.5/5.0,
brake balance 52, camber baseline -1.3, ride-height endpoints 6.9/8.1, and all
four damping channels converging on a fixed [1,20] scale. See
research/savefile-decode-2026-08-22.md.

stdlib only. READ-ONLY: never writes to the save; parse copies where possible.
"""
import struct, os, glob, json, argparse, re, hashlib

TUNE_FILE_SIZE = 598

# ---- byte layout (absolute offsets) -----------------------------------------
OFF_VERSION = 0x00      # U8  format version (observed 0x03)
OFF_LOCKED  = 0x01      # U8  0 = self-made, 1 = downloaded / locked in-UI
OFF_ORDINAL = 0x02      # U16 car ordinal

# Installed parts: 50 x U32 catalog IDs, 0x000E..0x00D2. 0xFFFFFFFF = empty slot.
PARTS = [
    "engine","drivetrain","car_body","motor","brakes","springs_dampers",
    "front_arb","rear_arb","tire_compound","rear_wing","front_rim_size","rear_rim_size",
    "camshaft","valves","displacement","pistons","fuel_system","ignition","exhaust",
    "intake","flywheel","manifold","restrictor_plate","oil_cooling","single_turbo",
    # slots 27/28: verified 2026-08-23 against the in-game menu (Exocet 2866 = centrifugal, sits in slot 27;
    # slot 28 holds the Jeep Trailcat / Hellcat roots blower) — the two supercharger labels were reversed.
    "twin_turbo","quad_turbo","centrifugal_supercharger","pos_supercharger","intercooler",
    "clutch","transmission","driveline","differential","front_bumper","rear_bumper","hood",
    "side_skirts","front_tire_width","rear_tire_width","weight_reduction","roll_cage",
    "motor_parts","rim_style","aspiration","front_track_width","rear_track_width",
    "front_tire_profile","rear_tire_profile","rear_rim_style",
]
OFF_PARTS = 0x000E
# 0x00D6..0x019D = padding, always 0xFFFFFFFF

# Tune sliders: F32 at 0x019E.. . (name, offset, min, max, unit, per_car, adjustable)
# per_car=True -> min/max are unknown per-chassis; we show normalised + pole %,
#                 and an absolute value only if a range is registered (PER_CAR_RANGES).
# min/max None on a fixed field means "leave as raw fraction".
_SL = lambda name,off,lo,hi,unit,per_car=False,adj=True: (name,off,lo,hi,unit,per_car,adj)
SLIDERS = [
    _SL("front_downforce", 0x019E, None,None,"df",  per_car=True),
    _SL("rear_downforce",  0x01A2, None,None,"df",  per_car=True),
    _SL("final_drive",     0x01A6, None,None,"ratio",per_car=True),
    _SL("brake_pressure",  0x01AA, 0,200,"%"),
    _SL("brake_balance",   0x01AE, 0,100,"% front"),
    _SL("handbrake",       0x01B2, 0,5.5,"", adj=False),      # static, ~1.0
    _SL("center_diff",     0x01B6, 0,100,"% rear"),
    _SL("_unk_01BA",       0x01BA, None,None,"", adj=False),
    _SL("_unk_01BE",       0x01BE, None,None,"", adj=False),
    _SL("tcs_slip",        0x01C2, None,None,"", adj=False),   # internal threshold
    _SL("_unk_01C6",       0x01C6, None,None,"", adj=False),
    _SL("_unk_01CA",       0x01CA, None,None,"", adj=False),
    _SL("front_tire_pressure", 0x01CE, 14,55,"psi"),
    _SL("front_camber",    0x01D2, -5,5,"deg"),
    _SL("front_toe",       0x01D6, -1,1,"deg"),
    _SL("front_caster",    0x01DA, 1,7,"deg"),
    _SL("front_spring",    0x01DE, None,None,"lb/in", per_car=True),
    _SL("front_arb",       0x01E2, 1,65,"scale"),
    _SL("front_ride_height",0x01E6, None,None,"in", per_car=True),
    _SL("front_bump",      0x01EA, 1,20,"scale"),
    _SL("front_rebound",   0x01EE, 1,20,"scale"),
    _SL("front_diff_accel",0x01F2, 0,100,"%"),
    _SL("front_diff_decel",0x01F6, 0,100,"%"),
    _SL("rear_tire_pressure",0x01FA, 14,55,"psi"),
    _SL("rear_camber",     0x01FE, -5,5,"deg"),
    _SL("rear_toe",        0x0202, -1,1,"deg"),
    _SL("rear_caster",     0x0206, 1,7,"deg", adj=False),      # not adjustable in-game
    _SL("rear_spring",     0x020A, None,None,"lb/in", per_car=True),
    _SL("rear_arb",        0x020E, 1,65,"scale"),
    _SL("rear_ride_height",0x0212, None,None,"in", per_car=True),
    _SL("rear_bump",       0x0216, 1,20,"scale"),
    _SL("rear_rebound",    0x021A, 1,20,"scale"),
    _SL("rear_diff_accel", 0x021E, 0,100,"%"),
    _SL("rear_diff_decel", 0x0222, 0,100,"%"),
    _SL("_unk_0226",       0x0226, None,None,"", adj=False),
    _SL("_unk_022A",       0x022A, None,None,"", adj=False),
]
GEARS_OFF = 0x022E       # 10 x F32, -1.0 = unused gear
N_GEARS = 10

# The 7 sliders whose absolute range is chassis-specific (everything else is game-fixed).
PER_CAR_FIELDS = ["front_spring", "rear_spring", "front_ride_height", "rear_ride_height",
                  "front_downforce", "rear_downforce", "final_drive"]

def _ranges_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "data", "car-tune-ranges.json"))

def _load_ranges_doc():
    try:
        with open(_ranges_path(), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"schema_version": "1.0.0", "ranges": {}, "points": {}}

def load_ranges():
    """Registered per-car ranges as {int ordinal: {field: [lo, hi]}} from data/car-tune-ranges.json."""
    doc = _load_ranges_doc()
    out = {}
    for ordn, fields in (doc.get("ranges") or {}).items():
        try:
            oi = int(ordn)
        except ValueError:
            continue
        for f, r in fields.items():
            if isinstance(r, dict) and "min" in r and "max" in r:
                out.setdefault(oi, {})[f] = [r["min"], r["max"]]
    return out


_GLOBAL_RANGES = None
def _global_ranges_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "data", "global-slider-ranges.json"))

def load_global_ranges():
    """Global (same-for-every-car) slider bands — gear + final drive — as {field: [lo, hi]}.
    These de-normalize sliders whose range is game-fixed (not per-chassis); see data/global-slider-ranges.json."""
    global _GLOBAL_RANGES
    if _GLOBAL_RANGES is None:
        try:
            with open(_global_ranges_path(), encoding="utf-8") as fh:
                doc = json.load(fh)
            _GLOBAL_RANGES = {f: [r["min"], r["max"]] for f, r in (doc.get("ranges") or {}).items()
                              if isinstance(r, dict) and "min" in r and "max" in r}
        except Exception:
            _GLOBAL_RANGES = {}
    return _GLOBAL_RANGES


def _spring_model():
    """The spring-rate frequency band (game-fixed) from data/global-slider-ranges.json."""
    try:
        with open(_global_ranges_path(), encoding="utf-8") as fh:
            return json.load(fh).get("spring_model")
    except Exception:
        return None


_MASSES = None
def _masses_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "data", "car-mass.json"))

def load_masses():
    """Per-car {ordinal: {mass_lb, front_pct}} for spring derivation. Sources, in precedence order:
    (1) data/car-mass.json (explicit); (2) captured build records in data/builds/*.json (pane.weight_lb +
    pane.front_pct from the My Cars stats pane) — so springs self-complete the moment a build is captured."""
    global _MASSES
    if _MASSES is None:
        out = {}
        try:
            with open(_masses_path(), encoding="utf-8") as fh:
                for o, v in (json.load(fh).get("masses") or {}).items():
                    try:
                        out[int(o)] = v
                    except (ValueError, TypeError):
                        continue
        except Exception:
            pass
        try:
            bdir = os.path.join(os.path.dirname(_masses_path()), "builds")
            for fp in glob.glob(os.path.join(bdir, "*.json")):
                if os.path.basename(fp).startswith("_"):
                    continue
                try:
                    with open(fp, encoding="utf-8") as fh:
                        b = json.load(fh)
                except Exception:
                    continue
                o = b.get("car_ordinal"); pane = b.get("pane") or {}
                w = pane.get("weight_lb"); frac = pane.get("front_pct")
                if o and w and frac is not None and int(o) not in out:
                    out[int(o)] = {"mass_lb": w, "front_pct": frac, "source": "build-capture"}
        except Exception:
            pass
        _MASSES = out
    return _MASSES


_BUILDS = None
def _car_build(ordinal):
    """The captured build record's My-Cars 'pane' for one ordinal (displacement_l / power_hp / torque_lbft /
    compound), or None. Populated once from data/builds/*.json — the same shop-capture that feeds springs."""
    global _BUILDS
    if _BUILDS is None:
        _BUILDS = {}
        try:
            bdir = os.path.join(os.path.dirname(_masses_path()), "builds")
            for fp in glob.glob(os.path.join(bdir, "*.json")):
                if os.path.basename(fp).startswith("_"):
                    continue
                try:
                    with open(fp, encoding="utf-8") as fh:
                        b = json.load(fh)
                except Exception:
                    continue
                o = b.get("car_ordinal")
                if o:
                    _BUILDS[int(o)] = b.get("pane") or {}
        except Exception:
            pass
    return _BUILDS.get(int(ordinal))

def spring_rate_from_mass(ordinal, name, norm):
    """Derive a spring-rate slider's absolute value (lb/in) from car mass + the fixed frequency band.
    k = f^2 * W_axle / 19.56 (W_axle = total_lb * front-or-rear share); the slider is linear in k.
    Returns None unless this car has mass captured AND the band is configured."""
    m = load_masses().get(int(ordinal)); sm = _spring_model()
    if not (m and sm):
        return None
    total = m.get("mass_lb"); fp = m.get("front_pct")
    if not total or fp is None:
        return None
    if fp > 1:
        fp = fp / 100.0
    dist = fp if name == "front_spring" else (1.0 - fp)
    w_axle = total * dist
    fmin = sm.get("freq_min_hz"); fmax = sm.get("freq_max_hz")
    if not (fmin and fmax) or w_axle <= 0:
        return None
    kmin = fmin * fmin * w_axle / 19.56
    kmax = fmax * fmax * w_axle / 19.56
    return round(kmin + norm * (kmax - kmin), 1)

def back_solve(points):
    """Solve [min, max] from >=2 (norm, value) points via least squares (value = min + norm*(max-min))."""
    pts = [(float(n), float(v)) for n, v in points]
    norms = {round(n, 3) for n, _ in pts}
    if len(pts) < 2 or len(norms) < 2:
        return None
    n = len(pts); sx = sum(p[0] for p in pts); sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts); sxy = sum(p[0] * p[1] for p in pts)
    denom = n * sxx - sx * sx
    if abs(denom) < 1e-9:
        return None
    slope = (n * sxy - sx * sy) / denom          # = max - min
    intercept = (sy - slope * sx) / n            # = min
    return [round(intercept, 3), round(intercept + slope, 3)]

def register_range(ordinal, field, norm, value, unit=None):
    """Record a (norm, value) observation for ordinal+field; re-solve and persist the range if >=2 distinct norms.
    READ-modify-WRITE of data/car-tune-ranges.json (atomic). Returns the solved [lo,hi] or None (need another point)."""
    if field not in PER_CAR_FIELDS:
        raise ValueError(f"{field} is not a per-car range field")
    doc = _load_ranges_doc()
    key = f"{int(ordinal)}|{field}"
    pts = doc.setdefault("points", {}).setdefault(key, [])
    nr = round(float(norm), 4)
    # ONE value per position: a slider can't hold two different values at one norm. Collapse the set to last-value-per-
    # position (self-heals the contradictory duplicates a stale-norm capture left behind, e.g. [[1.0,406],[1.0,190]]),
    # then apply this capture. Two DISTINCT positions are what back_solve needs.
    bynorm = {}
    for p in pts:
        try: bynorm[round(float(p[0]), 3)] = [round(float(p[0]), 4), float(p[1])]
        except Exception: continue
    bynorm[round(nr, 3)] = [nr, float(value)]
    pts[:] = list(bynorm.values())
    solved = back_solve(pts)
    if solved and solved[0] is not None and solved[1] is not None and solved[0] < solved[1]:   # PLAUSIBILITY GATE: a solve with min >= max is a contradiction from bad points (e.g. rear_ride_height min 22.98 > max 3.8 was published as 'exact') — never publish it; keep the raw points for a future consistent solve
        r = doc.setdefault("ranges", {}).setdefault(str(int(ordinal)), {})
        r[field] = {"min": solved[0], "max": solved[1], "unit": unit or "", "source": f"back-solved from {len(pts)} points"}
    else:
        solved = None
    tmp = _ranges_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
    os.replace(tmp, _ranges_path())
    return solved

def range_points(ordinal, field):
    """(total points, distinct norms) captured so far for ordinal+field. Distinctness matches back_solve's rounding,
    so `distinct` is exactly how many independent positions we have toward the >=2 needed to lock the range."""
    doc = _load_ranges_doc()
    pts = (doc.get("points") or {}).get(f"{int(ordinal)}|{field}", [])
    distinct = len({round(float(p[0]), 3) for p in pts})
    return len(pts), distinct

# pole labels for the per-car / normalised fields (what "high" means)
POLES = {
    "front_downforce":"cornering","rear_downforce":"cornering","final_drive":"acceleration",
    "front_spring":"stiff","rear_spring":"stiff","front_ride_height":"high","rear_ride_height":"high",
}

_SANITISE = re.compile(r"[^A-Za-z0-9._-]+")


# ---- core parse -------------------------------------------------------------
def _f32(b, off):
    return struct.unpack_from("<f", b, off)[0]

def parse_tune(path, ordinal_hint=None):
    """Parse one Data file -> structured dict. READ-ONLY."""
    with open(path, "rb") as fh:
        b = fh.read()
    if len(b) != TUNE_FILE_SIZE:
        raise ValueError(f"{path}: expected {TUNE_FILE_SIZE} bytes, got {len(b)}")

    version = b[OFF_VERSION]
    locked  = bool(b[OFF_LOCKED])
    ordinal = struct.unpack_from("<H", b, OFF_ORDINAL)[0]
    if ordinal == 0 and ordinal_hint:      # some files zero the header ordinal
        ordinal = int(ordinal_hint)

    # parts
    raw_parts = struct.unpack_from(f"<{len(PARTS)}I", b, OFF_PARTS)
    parts = {}
    for name, val in zip(PARTS, raw_parts):
        parts[name] = None if val == 0xFFFFFFFF else val

    # sliders
    ranges = load_ranges().get(ordinal, {})
    _pts_doc = (_load_ranges_doc().get("points") or {})   # per (ordinal|field) calibration points, for the UI's progress dots
    sliders = {}
    for name, off, lo, hi, unit, per_car, adj in SLIDERS:
        if name.startswith("_"):
            continue                       # internal/static padding fields
        norm = _f32(b, off)
        entry = {"norm": round(norm, 4), "unit": unit, "adjustable": adj}
        rng = ranges.get(name)
        gband = load_global_ranges().get(name)
        # SINGLE-POINT ANCHOR: one user-entered exact value makes this slider exact AT ITS CURRENT POSITION right away
        # (no waiting for the 2-point range solve). Beats the global band — the user's read arbitrates a band error.
        anchor = None
        if per_car and not rng and ordinal is not None:
            for p in _pts_doc.get(f"{int(ordinal)}|{name}", []):
                try:
                    # float-rounding slack ONLY (norm round-trips at 4 decimals): a looser tolerance spans real slider
                    # notches on fine sliders, so a nudged slider would keep reporting the stale typed value as exact
                    if abs(float(p[0]) - norm) <= 0.0005:
                        anchor = float(p[1]); break
                except Exception:
                    continue
        if per_car and rng:
            lo2, hi2 = rng
            entry["value"] = round(lo2 + norm * (hi2 - lo2), 2)
            entry["range"] = rng
        elif per_car and anchor is not None:
            entry["value"] = round(anchor, 2)
            entry["anchored"] = True   # exact at this position (user-read); range still wants a 2nd position
        elif per_car and gband:
            lo2, hi2 = gband
            entry["value"] = round(lo2 + norm * (hi2 - lo2), 2)
            entry["range"] = gband
            entry["derived"] = True   # global band (game-fixed), not a per-chassis registration
        elif per_car and name in ("front_spring", "rear_spring") and spring_rate_from_mass(ordinal, name, norm) is not None:
            entry["value"] = spring_rate_from_mass(ordinal, name, norm)
            entry["derived"] = True   # from car mass + the spring frequency band
        elif per_car:
            # unknown absolute range: report position toward the pole
            entry["value"] = None
            entry["pole"] = POLES.get(name)
            entry["pole_pct"] = round(norm * 100, 1)
            entry["cal_points"] = (len({round(float(p[0]), 3) for p in _pts_doc.get(f"{int(ordinal)}|{name}", [])})
                                   if ordinal is not None else 0)   # distinct positions captured toward the 2 needed to lock this slider
        elif lo is not None:
            entry["value"] = round(lo + norm * (hi - lo), 2)
            entry["range"] = [lo, hi]
        else:
            entry["value"] = round(norm, 4)
        sliders[name] = entry

    # gears (drop unused -1.0)
    graw = struct.unpack_from(f"<{N_GEARS}f", b, GEARS_OFF)
    gears_norm = [round(g, 4) for g in graw if g >= 0]
    return {
        "version": version,
        "locked": locked,
        "ordinal": ordinal,
        "parts": parts,
        "sliders": sliders,
        "gears_norm": gears_norm,
        "gear_count": len(gears_norm),
    }


# ---- directory scan ---------------------------------------------------------
def _ordinal_from_dirname(d):
    m = re.search(r"Tuning_(\d+)_(\d+)", os.path.basename(d))
    if not m:
        return None, None
    return int(m.group(1)), m.group(2)     # ordinal, timestamp string

def find_containers_root(base=r"C:\XboxGames\GameSave\pgs"):
    """Locate the newest ContainersRoot under the GameSave tree.
    FH6_SAVE_ROOT overrides it (point straight at a folder holding Tuning_* dirs) — for a Steam/alt
    install or for testing without touching the real save."""
    env = os.environ.get("FH6_SAVE_ROOT")
    if env and os.path.isdir(env):
        return env
    hits = glob.glob(os.path.join(base, "u_*", "*", "ContainersRoot"))
    if not hits:
        return None
    return max(hits, key=lambda p: os.path.getmtime(p))

def tunes_for_ordinal(ordinal, containers_root=None):
    """Fast path — glob only ONE car's tune Data files (newest first). ~1ms vs a full scan."""
    root = containers_root or find_containers_root()
    if not root:
        return [], None
    pats = {f"Tuning_{int(ordinal):04d}_*", f"Tuning_{int(ordinal)}_*"}
    seen = set(); metas = []
    for pat in pats:
        for data in glob.glob(os.path.join(root, pat, "Data")):
            if data in seen:
                continue
            seen.add(data)
            _, ts = _ordinal_from_dirname(os.path.dirname(data))
            metas.append({"path": data, "ts": ts, "mtime": os.path.getmtime(data)})
    metas.sort(key=lambda m: m["mtime"], reverse=True)
    return metas, root


def tune_diff(prev, cur):
    """What changed between two saves of the same car: slider moves (exact or position) + part changes."""
    sliders = []
    for name, e in cur["sliders"].items():
        if name.startswith("_"):
            continue
        pe = prev["sliders"].get(name)
        if not pe:
            continue
        if e.get("value") is not None and pe.get("value") is not None:
            if abs(e["value"] - pe["value"]) > 1e-6:
                sliders.append({"field": name, "from": pe["value"], "to": e["value"], "unit": e.get("unit", "")})
        elif abs(e["norm"] - pe["norm"]) > 0.005:
            sliders.append({"field": name, "from_pct": round(pe["norm"] * 100, 1), "to_pct": round(e["norm"] * 100, 1), "pos": True})
    parts = [{"item": k, "from": prev["parts"].get(k), "to": v} for k, v in cur["parts"].items() if v != prev["parts"].get(k)]
    return {"sliders": sliders, "parts": parts, "gear_delta": cur["gear_count"] - prev["gear_count"]}


def scan_tunes(containers_root=None, newest_only=True):
    """Return {ordinal: [tune_meta,...]} newest-first. Each meta has path, ts, mtime."""
    root = containers_root or find_containers_root()
    if not root:
        return {}, None
    by_ord = {}
    for data in glob.glob(os.path.join(root, "Tuning_*", "Data")):
        d = os.path.dirname(data)
        ordn, ts = _ordinal_from_dirname(d)
        if ordn is None:
            continue
        by_ord.setdefault(ordn, []).append(
            {"path": data, "ts": ts, "mtime": os.path.getmtime(data)}
        )
    for ordn in by_ord:
        by_ord[ordn].sort(key=lambda m: m["mtime"], reverse=True)
        if newest_only:
            by_ord[ordn] = by_ord[ordn][:1]
    return by_ord, root


# ---- transform to the decode-section deliverable (Clone Sheet shape) --------
# Shop menus, in the order the decode section presents them. Each entry lists
# the part-slot keys that live under it.
SHOP_MENUS = [
    ("Engine & Power", ["engine","motor_parts","camshaft","valves","displacement",
        "pistons","fuel_system","ignition","exhaust","intake","flywheel","manifold",
        "restrictor_plate","oil_cooling","intercooler"]),
    ("Platform & Handling", ["brakes","springs_dampers","front_arb","rear_arb",
        "weight_reduction","roll_cage"]),
    ("Drivetrain", ["clutch","transmission","driveline","differential"]),
    ("Tires & Rims", ["tire_compound","front_tire_width","rear_tire_width","front_rim_size",
        "rear_rim_size","rim_style","rear_rim_style","front_tire_profile","rear_tire_profile",
        "front_track_width","rear_track_width"]),
    ("Aero & Appearance", ["car_body","front_bumper","rear_bumper","hood","side_skirts","rear_wing"]),
]
# Tune tabs, mapping the decode UI tabs to the slider keys that belong to each.
TUNE_TABS = [
    ("Tires",       ["front_tire_pressure","rear_tire_pressure"]),
    ("Springs",     ["front_spring","rear_spring","front_ride_height","rear_ride_height"]),
    ("Alignment",   ["front_camber","rear_camber","front_toe","rear_toe","front_caster"]),
    ("Anti-roll bars",["front_arb","rear_arb"]),
    ("Damping",     ["front_bump","rear_bump","front_rebound","rear_rebound"]),
    ("Aero",        ["front_downforce","rear_downforce"]),
    ("Brakes",      ["brake_balance","brake_pressure"]),
    ("Differential",["front_diff_accel","front_diff_decel","rear_diff_accel","rear_diff_decel","center_diff"]),
    ("Gearing",     ["final_drive"]),   # individual gears appended dynamically
]

# In-game category name for each part slot (what the upgrade shop calls it).
CATEGORY_DISPLAY = {
    "engine": "Engine Block", "motor": "Engine Swap", "camshaft": "Camshaft", "valves": "Valves",
    "displacement": "Displacement", "pistons": "Pistons & Compression", "fuel_system": "Fuel System",
    "ignition": "Ignition", "exhaust": "Exhaust", "intake": "Intake", "flywheel": "Flywheel",
    "manifold": "Intake Manifold", "restrictor_plate": "Restrictor Plate", "oil_cooling": "Oil Cooling",
    "single_turbo": "Single Turbo", "twin_turbo": "Twin Turbo", "quad_turbo": "Quad Turbo",
    "pos_supercharger": "Supercharger", "centrifugal_supercharger": "Centrifugal Supercharger",
    "intercooler": "Intercooler", "aspiration": "Aspiration", "motor_parts": "Engine",
    "brakes": "Brakes", "springs_dampers": "Springs & Dampers", "front_arb": "Front Anti-roll Bar",
    "rear_arb": "Rear Anti-roll Bar", "weight_reduction": "Weight Reduction", "roll_cage": "Chassis Reinforcement",
    "drivetrain": "Drivetrain", "clutch": "Clutch", "transmission": "Transmission", "driveline": "Driveline",
    "differential": "Differential",
    "tire_compound": "Tire Compound", "front_tire_width": "Front Tire Width", "rear_tire_width": "Rear Tire Width",
    "front_rim_size": "Front Rim Size", "rear_rim_size": "Rear Rim Size", "rim_style": "Rim Style",
    "rear_rim_style": "Rear Rim Style", "front_tire_profile": "Front Tire Profile", "rear_tire_profile": "Rear Tire Profile",
    "front_track_width": "Front Track Width", "rear_track_width": "Rear Track Width",
    "car_body": "Body Kit", "front_bumper": "Front Bumper", "rear_bumper": "Rear Bumper", "hood": "Hood",
    "side_skirts": "Side Skirts", "rear_wing": "Rear Wing",
}
# Green-header section + directional pole labels + display label per slider (the FH tune-menu structure).
SLIDER_META = {
    "front_tire_pressure": ("Tire Pressure", ("Low", "High"), "Front tire pressure"),
    "rear_tire_pressure":  ("Tire Pressure", ("Low", "High"), "Rear tire pressure"),
    "front_spring": ("Springs", ("Soft", "Stiff"), "Front spring rate"),
    "rear_spring":  ("Springs", ("Soft", "Stiff"), "Rear spring rate"),
    "front_ride_height": ("Ride Height", ("Low", "High"), "Front ride height"),
    "rear_ride_height":  ("Ride Height", ("Low", "High"), "Rear ride height"),
    "front_camber": ("Camber", ("Negative", "Positive"), "Front camber"),
    "rear_camber":  ("Camber", ("Negative", "Positive"), "Rear camber"),
    "front_toe": ("Toe", ("In", "Out"), "Front toe"),
    "rear_toe":  ("Toe", ("In", "Out"), "Rear toe"),
    "front_caster": ("Front Caster", ("Low", "High"), "Front caster"),
    "front_arb": ("Antiroll Bars", ("Soft", "Stiff"), "Front ARB"),
    "rear_arb":  ("Antiroll Bars", ("Soft", "Stiff"), "Rear ARB"),
    "front_bump": ("Bump Stiffness", ("Soft", "Stiff"), "Front bump"),
    "rear_bump":  ("Bump Stiffness", ("Soft", "Stiff"), "Rear bump"),
    "front_rebound": ("Rebound Stiffness", ("Soft", "Stiff"), "Front rebound"),
    "rear_rebound":  ("Rebound Stiffness", ("Soft", "Stiff"), "Rear rebound"),
    "front_downforce": ("Downforce", ("Speed", "Cornering"), "Front downforce"),
    "rear_downforce":  ("Downforce", ("Speed", "Cornering"), "Rear downforce"),
    "brake_balance":  ("Braking Force (Balance)", ("Rear", "Front"), "Brake balance"),
    "brake_pressure": ("Braking Force (Pressure)", ("Low", "High"), "Brake pressure"),
    "front_diff_accel": ("Front Differential", ("Low", "High"), "Front acceleration"),
    "front_diff_decel": ("Front Differential", ("Low", "High"), "Front deceleration"),
    "rear_diff_accel":  ("Rear Differential", ("Low", "High"), "Rear acceleration"),
    "rear_diff_decel":  ("Rear Differential", ("Low", "High"), "Rear deceleration"),
    "center_diff": ("Center", ("Front", "Rear"), "Center balance"),
    "final_drive": ("Forward Gears", ("Speed", "Acceleration"), "Final drive"),
}
GEAR_POLES = ("Speed", "Acceleration")

TIER_NAMES = ["Stock", "Street", "Sport", "Race"]   # FH upgrade ladder by tier index (parts-effects.json / tuning-variables.json)
# Slots whose tier index is a DIMENSION step (mm / inch), not the Stock/Street/Sport/Race ladder.
DIM_SLOTS = {"front_tire_width", "rear_tire_width", "front_rim_size", "rear_rim_size",
             "front_track_width", "rear_track_width", "front_tire_profile", "rear_tire_profile",
             "rim_style", "rear_rim_style"}
# FH6 tire-compound list by index. Anchors are certain: 0 = Stock (66 cars, the no-upgrade default),
# 5 = Race (86 cars, the dominant competitive compound). idx 4 has ZERO cars on disk, corroborating that
# FH6 dropped FH5's standalone "Slick" — so the specialty compounds sit at 5+. Order below follows the FH6
# Tires guide (Stock/Street/Sport/Semi-Slick/Race/Rally/Off-Road/Snow/Drift) and is cross-checked against the
# on-disk distribution (idx 9 Drift x28 fits the heavy drift garage). Non-Stock names stay conf "compound"
# (best-effort). idx 11/12/15 are FH6 compounds we haven't pinned yet — shown as "Compound #N" until verified.
COMPOUND_NAMES = {0: "Stock", 1: "Street", 2: "Sport", 3: "Semi-Slick", 4: "Slick", 5: "Race",
                  6: "Rally", 7: "Off-Road", 8: "Snow", 9: "Drift", 10: "Drag"}
_TIER_VOCAB = None

def load_tier_vocab():
    """Names for the per-slot part INDEX, from data/part-index-vocabulary.json.

    A part ID is <partset><index>. The index is NOT the tile position in that car's menu -- the
    NSX-R's 2-tile Front Anti-roll Bars menu decodes to index 3 -- it is a position in a GLOBAL
    per-slot vocabulary that each car exposes a subset of, ascending. So ONE map names the tier
    slots on every car, exactly as data/tire-compounds.json already does for compounds.
    Returns {slot: {int index: name}}; a trailing '*' on a name marks an inferred position."""
    global _TIER_VOCAB
    if _TIER_VOCAB is None:
        _TIER_VOCAB = {}
        try:
            here = os.path.dirname(os.path.abspath(__file__))
            path = os.path.abspath(os.path.join(here, "..", "..", "data", "part-index-vocabulary.json"))
            with open(path, encoding="utf-8") as fh:
                j = json.load(fh)
            for slot, m in (j.get("tier_slots") or {}).items():
                if slot.startswith("_") or not isinstance(m, dict):
                    continue
                _TIER_VOCAB[slot] = {int(k): v for k, v in m.items() if k.isdigit()}
        except Exception:
            _TIER_VOCAB = {}
    return _TIER_VOCAB


def split_part_id(ordinal, pid):
    """(partset, index) for a part ID, or (None, None) if it is not this car's own set.

    Shared components carry a donor set's ordinal (transmission 2102000 on both ord 2866 and 3852),
    so only split when the ID really belongs to this car's set.

    The index is a FIXED 3-digit field, so the test is arithmetic, not textual. A startswith() test
    mis-split one ID in 21,027: ord 3921's rear_track_width 392100 matched the prefix "3921" and
    decoded as index 0 -- a phantom Stock -- when the fixed-width rule reads (partset 392, index 100),
    which is exactly what that tune's fifteen sibling geometry slots carry."""
    if pid is None:
        return (None, None)
    try:
        o = int(ordinal)
    except (TypeError, ValueError):
        return (None, None)
    idx = int(pid) - o * 1000
    if 0 <= idx < 1000:
        return (o, idx)
    return (None, None)


def name_part(ordinal, slot, pid):
    """Best-effort name for an installed part, or None. Tier slots resolve globally; catalogue
    slots (engine, wings, rims, body) are car-specific and are left to their own stores."""
    _set, idx = split_part_id(ordinal, pid)
    if idx is None:
        return None
    return (load_tier_vocab().get(slot) or {}).get(idx)


_COMPOUND_OVERRIDE = None
_COMPOUND_VERIFIED = set()

def load_compound_names():
    """Merge data/tire-compounds.json 'names' over the code defaults. The compound index is a GLOBAL enum,
    so ONE tire-shop capture (read the compound list on any car) pins every car — put the names in that file
    and 11/12/15 resolve everywhere. Returns (names_dict, verified_set)."""
    global _COMPOUND_OVERRIDE, _COMPOUND_VERIFIED
    if _COMPOUND_OVERRIDE is None:
        merged = dict(COMPOUND_NAMES)
        try:
            here = os.path.dirname(os.path.abspath(__file__))
            path = os.path.abspath(os.path.join(here, "..", "..", "data", "tire-compounds.json"))
            with open(path, encoding="utf-8") as fh:
                j = json.load(fh)
            for k, v in (j.get("names") or {}).items():
                if v:
                    merged[int(k)] = v
            _COMPOUND_VERIFIED = set(int(x) for x in (j.get("verified") or []))
        except Exception:
            pass
        _COMPOUND_OVERRIDE = merged
    return _COMPOUND_OVERRIDE, _COMPOUND_VERIFIED

ASPIRATION_TYPE = {"single_turbo": "Single Turbo", "twin_turbo": "Twin Turbo", "quad_turbo": "Quad Turbo",
                   "pos_supercharger": "Positive-Displacement Supercharger", "centrifugal_supercharger": "Centrifugal Supercharger"}
RACE_TRANS_FAMILY = 2102   # verified: family 2102 = Race transmission; its tier encodes the speed count
COSMETIC_SLOTS = {"rim_style", "rear_rim_style"}

def _tier_word(idx):
    return TIER_NAMES[idx] if 0 <= idx < len(TIER_NAMES) else "Race"   # cap race-variant indices (>3) at "Race"


# ---- engine-type descriptor (Feature A) -------------------------------------
# The save holds NO engine specs (cylinders / redline / power). This composes a specific engine
# TYPE from signals we already own: aspiration (decoded), engine-internal build level (decoded),
# displacement (from a captured build's My-Cars pane), plus — when the daemon enriches a driven car —
# live cylinders / redline / peak dyno hp. A swapped engine's donor NAME is NEVER invented.
ENGINE_INTERNAL_SLOTS = ["camshaft", "valves", "displacement", "pistons", "fuel_system", "ignition",
                         "exhaust", "intake", "flywheel", "manifold", "restrictor_plate", "oil_cooling",
                         "intercooler", "motor_parts"]
_ASP_SHORT = {"single_turbo": "Turbo", "twin_turbo": "Twin-Turbo", "quad_turbo": "Quad-Turbo",
              "pos_supercharger": "Supercharged", "centrifugal_supercharger": "Centrifugal-Supercharged"}

def _aspiration_short(parts):
    """Short aspiration word from the decoded forced-induction slot, or None for naturally aspirated."""
    for slot in ASPIRATION_TYPE:
        if parts.get(slot) is not None:
            return _ASP_SHORT.get(slot)
    return None

def _engine_build_level(parts):
    """Highest bolt-on tier (0..3) across the engine-internal slots — a coarse 'how built' signal from the save."""
    mx = 0
    for slot in ENGINE_INTERNAL_SLOTS:
        v = parts.get(slot)
        if v is not None:
            mx = max(mx, min(v % 1000, 3))
    return mx

# The engine's IDENTITY is NOT the `engine` slot (always the car's own ordinal, tier = build level). It is the family
# shared uniformly by the engine-INTERNAL parts + aspiration. A family used by >=2 cars, or that is another car's
# ordinal, is a SWAP; data/engine-swaps.json names it. See scripts/telemetry/build_engine_catalog.py.
ENGINE_ID_SLOTS = ["camshaft", "valves", "displacement", "pistons", "fuel_system", "ignition",
                   "exhaust", "intake", "flywheel", "oil_cooling", "manifold", "restrictor_plate", "intercooler"]
_ASP_SLOTS_ID = ["pos_supercharger", "centrifugal_supercharger", "single_turbo", "twin_turbo", "quad_turbo"]

def engine_family_of(parts):
    """The engine's identity = the modal family across the engine-internal + aspiration slots (they are ~always
    uniform). Returns the family int, or None when no engine-internal part is present."""
    fams = [parts[s] // 1000 for s in (ENGINE_ID_SLOTS + _ASP_SLOTS_ID) if parts.get(s) is not None]
    if not fams:
        return None
    from collections import Counter
    return Counter(fams).most_common(1)[0][0]

_ENGINE_CATALOG = None
def _engine_catalog_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "data", "engine-swaps.json"))

def load_engine_catalog():
    """{str(family): {label, donor_name, brand_guess, aspiration, shared_swap, cyl, displacement_l, ...}}. Cached; missing -> {}."""
    global _ENGINE_CATALOG
    if _ENGINE_CATALOG is None:
        try:
            with open(_engine_catalog_path(), encoding="utf-8") as fh:
                _ENGINE_CATALOG = json.load(fh).get("families") or {}
        except Exception:
            _ENGINE_CATALOG = {}
    return _ENGINE_CATALOG

def compose_engine_type(asp_short=None, displacement_l=None, cyl=None, peak_hp=None,
                        redline=None, swapped=False, electric=False, build_level=0,
                        disp_from_build=False):
    """Build the engine-type descriptor string from whatever signals exist. The telemetry path passes
    cyl/peak_hp/redline (measured); the save-only path passes just asp_short/displacement/build_level.
    Never fabricates a donor name for a swap (only flags that it IS swapped)."""
    if electric:
        desc = "Electric powertrain"
        if peak_hp:
            desc += f" · {int(peak_hp)} hp"
    else:
        head = []
        if displacement_l:
            head.append(f"{displacement_l}L")
        if asp_short:
            head.append(asp_short)
        if cyl:
            head.append(f"{int(cyl)}-cyl")
        elif not peak_hp and build_level:          # save-only, unknown cylinders: fall back to build level
            head.append(f"{_tier_word(build_level)}-built engine")
        heads = " ".join(head) if head else "engine"
        tail = []
        if peak_hp and redline:
            tail.append(f"{int(peak_hp)} hp @ {int(redline)} rpm")
        elif peak_hp:
            tail.append(f"{int(peak_hp)} hp")
        desc = heads + (" · " + " · ".join(tail) if tail else "")
    if swapped:
        desc = "Swapped · " + desc
    if disp_from_build and displacement_l:
        desc += " (displacement from build capture)"
    return desc


# ---- per-part PI scaffolding (Feature B) ------------------------------------
# parts_tiers / parts_hash define the canonical config fingerprint shared by the daemon (which records
# observations) and the solver (which differences them). load_parts_pi / pi_for read the solved estimates;
# observed_car_pi reads back the exact CarPI for THIS config when it has been driven & recorded.
def parts_tiers(parts):
    """{slot: tier} for all 50 slots; tier = id%1000, or None for an empty slot. The canonical config vector."""
    return {name: (None if parts.get(name) is None else parts.get(name) % 1000) for name in PARTS}

def parts_hash(ordinal, parts):
    """Stable 16-hex fingerprint of (ordinal + engine FAMILY + the 50 slot tiers) — the dedup / match key for
    observations. The family must be in the hash: tiers are id%1000, which ERASES the engine-swap identity
    (id//1000) — two configs differing only by swap hashed identically and their PI stamps collided."""
    tiers = parts_tiers(parts)
    fam = None
    try:
        fam = engine_family_of(parts)
    except Exception:
        pass
    payload = json.dumps({"o": int(ordinal), "f": fam, "p": {k: tiers[k] for k in sorted(tiers)}}, sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]

# The slider region runs from the first slider offset to the end of file, covering every slider AND the ten
# gear ratios — one contiguous block, so it hashes without decoding anything.
OFF_TUNE = 0x019E

def tune_hash(path_or_bytes):
    """Stable 16-hex fingerprint of the TUNE — every slider and gear value, nothing else.

    parts_hash answers "which build is this"; it deliberately excludes sliders, so two saves that differ only
    in tyre pressure hash identically. That is correct for build identity and useless for A/B: a slider-only
    change is currently invisible to every key the system has, and ordinal 3852 already carries four saves
    alternating A/B/A/B between two slider states with zero parts changed.

    Hashing RAW BYTES rather than decoded values is deliberate: it needs no decoder, so it covers slider fields
    that have never been mapped, and it works on LOCKED downloaded tunes that cannot be opened in-game.
    Verified: 6 saves on ordinal 2866 -> 6 distinct hashes.
    """
    b = path_or_bytes if isinstance(path_or_bytes, (bytes, bytearray)) else open(path_or_bytes, "rb").read()
    if len(b) != TUNE_FILE_SIZE:
        return None
    return hashlib.sha1(bytes(b[OFF_TUNE:])).hexdigest()[:16]


_PARTS_PI = None
def _parts_pi_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "data", "parts-pi.json"))

def load_parts_pi():
    """Solved per-(slot, tier) PI estimates: {slot: {str(tier): {pi_vs_stock, samples, confidence, ...}}}.
    Empty until fh6_pi_solve.py has enough single-part-diff observations. Cached; missing file -> {}."""
    global _PARTS_PI
    if _PARTS_PI is None:
        try:
            with open(_parts_pi_path(), encoding="utf-8") as fh:
                _PARTS_PI = json.load(fh).get("parts_pi") or {}
        except Exception:
            _PARTS_PI = {}
    return _PARTS_PI

def pi_for(slot, tier):
    """Estimated PI cost of (slot, tier) vs stock, or None if unknown (sparse observations)."""
    if slot is None or tier is None:
        return None
    e = load_parts_pi().get(slot, {}).get(str(tier))
    if not e:
        return None
    v = e.get("pi_vs_stock")
    return int(v) if isinstance(v, (int, float)) else None

_PI_OBS = None
def _pi_obs_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "data", "pi-observations.json"))

def load_pi_observations():
    """The raw decoded-config <-> CarPI observations (list). Cached; missing file -> []."""
    global _PI_OBS
    if _PI_OBS is None:
        try:
            with open(_pi_obs_path(), encoding="utf-8") as fh:
                _PI_OBS = json.load(fh).get("observations") or []
        except Exception:
            _PI_OBS = []
    return _PI_OBS

def observed_car_pi(ordinal, parts):
    """The exact CarPI recorded for THIS config (matching parts_hash), or None if never driven & recorded."""
    ph = parts_hash(ordinal, parts)
    for o in load_pi_observations():
        if o.get("parts_hash") == ph:
            return o.get("car_pi")
    return None

def _pi_slot_for(row, parts):
    """Map a deliverable row back to the real 50-slot key used in parts-pi/observations (Conversions rows are
    synthetic: powertrain -> engine/motor, aspiration -> the populated forced-induction slot, drivetrain -> drivetrain)."""
    item = row.get("item")
    if item == "powertrain":
        return "motor" if row.get("electric") else "engine"
    if item == "aspiration":
        raw = row.get("raw")
        return next((s for s in ASPIRATION_TYPE if parts.get(s) == raw), None) if raw is not None else None
    if item == "drivetrain":
        return "drivetrain"
    return item   # regular shop-menu rows already carry the real slot key

def _part_view(cat, val, ordinal, gear_count=None):
    """Human view of one part slot: the exact upgrade NAME to install.

    Both ordinal-scoped parts (car-specific tiers) and shared global parts encode the tier in the
    low 3 digits (id % 1000): 0=Stock, 1=Street, 2=Sport, 3=Race (race-variant indices cap at Race).
    Special cases: tire compound (index=compound type), dimension slots (mm/inch step), transmission
    (family 2102 = Race, tier = speed count), aspiration (named by slot + tier). `conf`: named (exact) |
    compound | dim | cosmetic | category (upgraded but tier ambiguous)."""
    disp = CATEGORY_DISPLAY.get(cat, cat.replace("_", " ").title())
    if val is None:
        return {"raw": None, "tier": None, "stock": None, "label": "—", "upgrade": None, "conf": None, "category": disp}
    idx = val % 1000
    fam = val // 1000

    def out(label, conf, stock=False, tier=idx):
        return {"raw": val, "tier": tier, "stock": stock, "label": label, "upgrade": label, "conf": conf, "category": disp}

    if cat in COSMETIC_SLOTS:
        return out("Stock", "named", stock=True) if idx == 0 else out(f"Custom · style {idx}", "cosmetic")
    if cat == "tire_compound":
        if idx == 0:
            return out("Stock", "named", stock=True)
        cnames, cverified = load_compound_names()
        nm = cnames.get(idx)   # global enum; names from data/tire-compounds.json override the best-effort defaults
        if not nm:
            # unmapped index (11/12/15): the compound NAME is unknown until anchored. The index is GLOBAL, so setting
            # this tyre on ANY one car + saving once maps it for every car that runs it.
            return out(f"Tyre compound {idx} — unmapped (set once in-game & save to name it for all cars)", "compound")
        return out((f"{nm} Compound" if idx in cverified else f"{nm} Compound (unverified)"), "named" if idx in cverified else "compound")
    if cat in DIM_SLOTS:
        return out("Stock", "named", stock=True) if idx == 0 else out(f"{disp} · level {idx}", "dim")
    if cat == "transmission" and fam == RACE_TRANS_FAMILY:
        n = gear_count
        return out(f"Race Transmission · {n}-speed" if n else "Race Transmission", "named")
    if cat in ASPIRATION_TYPE:
        typ = ASPIRATION_TYPE[cat]
        if idx == 0:
            return out(f"Stock {typ}", "named", stock=True)
        return out(f"{_tier_word(idx)} {typ}", "named" if idx <= 3 else "category")   # capped race-variant index is less certain
    if cat == "differential":
        # id%1000 is the diff TYPE (family is just namespace). DATA-VERIFIED (tire-compound cross-check + car
        # types): 0=Stock, 5=Race (64 cars, pairs w/ Race tires), 7=Off-Road (pairs w/ off-road tires; every idx-7
        # car drives its fronts). 3=Sport / 6=Rally are INFERRED from the FH6 guide only — both run Race tires and
        # the save can't derive drivetrain to split them, so they stay conf "category" (not asserted exact).
        if idx == 0:
            return out("Stock", "named", stock=True)
        _DIFF = {5: ("Race Differential", "named"), 7: ("Off-Road Differential", "named"),
                 6: ("Rally Differential", "category"), 3: ("Sport Differential", "category")}
        if idx in _DIFF:
            lbl, cf = _DIFF[idx]
            return out(lbl, cf)
        return out(f"Upgraded differential (tier {idx}) — type unverified", "category")
    if cat == "engine":
        # NOT a shop tile: the engine slot's family is always the car's own ordinal and its tier is the engine's
        # aggregate BUILD LEVEL — it moves as a CONSEQUENCE of installing the internals below (camshaft, valves,
        # pistons, …). Labelling it 'Sport Engine Block' sent people hunting for a part that doesn't exist.
        if idx == 0:
            return out("Stock", "named", stock=True)
        o = out(f"{_tier_word(idx)}-level engine build", "dim")
        o["note"] = "derived indicator — not a shop part; it reflects the engine internals installed below"
        o["derived_level"] = True
        return o
    # standard Stock/Street/Sport/Race ladder (brakes, ARB, springs, clutch, driveline, engine internals, weight, aero, …)
    if idx == 0:
        return out("Stock", "named", stock=True)
    conf = "named" if idx <= 3 else "category"   # a race-variant index we cap at "Race" is slightly less certain
    return out(f"{_tier_word(idx)} {disp}", conf)

_NAMES_CACHE = None
def _car_names():
    global _NAMES_CACHE
    if _NAMES_CACHE is None:
        here = os.path.dirname(os.path.abspath(__file__))
        try:
            _NAMES_CACHE = load_car_names(os.path.abspath(os.path.join(here, "..", "..")))
        except Exception:
            _NAMES_CACHE = {}
    return _NAMES_CACHE

def _conversion_rows(tune, ordinal):
    """The Conversions category — the swaps that GATE every other upgrade: engine swap, aspiration, drivetrain.
    Ordered first because installing/removing these changes what the rest of the menu even offers."""
    P = tune["parts"]; conv = []
    def row(item, cat, upgrade, conf, tier, stock, raw):
        return {"item": item, "category": cat, "value": upgrade, "upgrade": upgrade, "conf": conf,
                "tier": tier, "stock": stock, "raw": raw, "status": "measured", "confidence": 1.0}
    own = int(ordinal); engine = P.get("engine"); motor = P.get("motor"); build = _car_build(own)
    # ENGINE / POWERTRAIN. CRITICAL FIX (2026-08-23): the `engine` slot family (id//1000) is ALWAYS the car's OWN
    # ordinal — it encodes only the engine BUILD level (tier = id%1000), NEVER the swap. (The old "family != own =
    # swap" rule therefore fired for nobody and every car decoded as "Stock engine".) The engine's real identity is
    # the family shared by the engine-INTERNAL parts + aspiration — engine_family_of(). A family used by >=2 cars, or
    # that is another car's ordinal, is a SWAP; data/engine-swaps.json names it. cyl/redline/power still come live.
    efam = engine_family_of(P)
    cat = load_engine_catalog().get(str(efam)) if efam is not None else None
    if motor is not None:
        stock_ev = motor // 1000 == own
        er = row("powertrain", "Engine", "Stock electric powertrain" if stock_ev else "Motor swap (EV)",
                 "named" if stock_ev else "category", motor % 1000, stock_ev, motor)
        er["electric"] = True
    else:
        build_tier = (engine % 1000) if engine is not None else 0
        donor = cat.get("donor_name") if cat else None
        swap = bool(cat and (cat.get("shared_swap") or donor))   # confident swap: shared across cars, or a known donor engine
        if swap:
            nm = cat.get("label") or (f"{donor} engine swap" if donor else f"engine swap (family {efam})")
            er = row("powertrain", "Engine", f"Engine SWAP · {nm}", "named" if donor else "category", build_tier, False, engine)
        else:
            # family seen only on this car (or no catalog entry) — the car's own engine; do NOT assert a swap
            er = row("powertrain", "Engine", "Stock / OEM engine", "named", build_tier, True, engine)
        er["engine_family"] = efam
        if cat:
            er["engine_catalog"] = {k: cat.get(k) for k in ("label", "donor_name", "brand_guess", "aspiration",
                                                             "shared_swap", "cyl", "displacement_l", "redline",
                                                             "sample_hp", "resulting_drivetrain", "cars_seen")}
    # DISPLACEMENT (litres): a captured build's My-Cars pane first, else the engine-family catalog (learned from other
    # cars that share this engine) — so a swap's displacement shows even for a car never build-captured.
    disp_l = (build.get("displacement_l") if (build and not er.get("electric")) else None) or (cat.get("displacement_l") if cat else None)
    if disp_l and not er.get("electric"):
        er["value"] = er["upgrade"] = f"{er['value']} · {disp_l}L"
        er["displacement_l"] = disp_l
    # engine-type descriptor (Feature A): a specific TYPE from save-only signals now; the daemon upgrades this
    # to a telemetry-MEASURED string (cylinders / redline / peak hp) for a driven car. engine_bits carries the
    # decoded pieces so the daemon can recompose the measured descriptor without re-deriving them.
    if er.get("electric"):
        swapped = not er["stock"]
        er["engine_type"] = compose_engine_type(electric=True, swapped=swapped)
        er["engine_type_conf"] = "save-only"
        er["engine_bits"] = {"asp": None, "displacement_l": None, "swapped": swapped,
                             "electric": True, "build_level": 0, "disp_from_build": False}
    else:
        swapped = not er["stock"]
        bl = _engine_build_level(P)
        cyl0 = cat.get("cyl") if cat else None
        er["engine_type"] = compose_engine_type(asp_short=(_aspiration_short(P) or "Naturally aspirated"),
                                                displacement_l=disp_l, cyl=cyl0, build_level=bl, swapped=swapped,
                                                disp_from_build=bool(disp_l))
        er["engine_type_conf"] = "save-only"
        er["engine_bits"] = {"asp": _aspiration_short(P), "displacement_l": disp_l, "swapped": swapped,
                             "electric": False, "build_level": bl, "disp_from_build": bool(disp_l),
                             "engine_family": efam, "cat_label": (cat.get("label") if cat else None), "cat_cyl": cyl0}
    conv.append(er)
    # ASPIRATION — from the populated forced-induction slot (electric = none)
    if motor is not None:
        conv.append(row("aspiration", "Aspiration", "Electric (no aspiration)", "named", 0, True, None))
    else:
        asp = next((s for s in ASPIRATION_TYPE if P.get(s) is not None), None)
        if asp:
            av = P[asp]; t = av % 1000
            conv.append(row("aspiration", "Aspiration", (f"{_tier_word(t)} " if t else "") + ASPIRATION_TYPE[asp], "named", t, False, av))
        else:
            conv.append(row("aspiration", "Aspiration", "Naturally Aspirated", "named", 0, True, None))
    # Drivetrain — stock vs swapped (the slot isn't a Street/Sport/Race tier). The save can't know the RESULTING
    # layout, so resulting_drivetrain starts null; the daemon fills it from live DrivetrainType (FWD/RWD/AWD).
    dv = P.get("drivetrain")
    if dv is not None:
        t = dv % 1000
        dr = row("drivetrain", "Drivetrain", "Stock layout" if t == 0 else "Converted / swapped", "named", t, t == 0, dv)
        dr["resulting_drivetrain"] = None
        conv.append(dr)
    return conv

def tune_to_deliverable(tune, car_name=None):
    """Turn a parsed tune into the decode-section Clone Sheet deliverable.
    Every row is status 'measured' at confidence 1.0 — the on-disk file is exact
    (per-car sliders whose absolute range is unknown are 'measured-relative')."""
    ordn = tune["ordinal"]
    # parts organised into shop menus
    menus = []
    for menu_name, keys in SHOP_MENUS:
        rows = []
        for k in keys:
            if k not in tune["parts"]:
                continue
            pv = _part_view(k, tune["parts"][k], ordn, gear_count=tune["gear_count"])
            if pv["raw"] is None:
                continue   # empty slot — omit from the install list
            row_d = {"item": k, "category": pv["category"], "value": pv["label"],
                     "upgrade": pv["upgrade"], "conf": pv["conf"], "tier": pv["tier"],
                     "stock": pv["stock"], "raw": pv["raw"],
                     "status": "measured", "confidence": 1.0}
            if pv.get("note"): row_d["note"] = pv["note"]
            if pv.get("derived_level"): row_d["derived_level"] = True
            rows.append(row_d)
        if rows:
            menus.append({"menu": menu_name, "rows": rows})
    menus.insert(0, {"menu": "Conversions", "rows": _conversion_rows(tune, ordn)})   # gates every other option — engine swap, aspiration, drivetrain
    # tune tabs
    tabs = []
    for tab_name, keys in TUNE_TABS:
        rows = []
        for k in keys:
            e = tune["sliders"].get(k)
            if not e:
                continue
            sec, poles, label = SLIDER_META.get(k, (tab_name, ("", ""), k.replace("_", " ")))
            base = {"field": k, "label": label, "section": sec, "poles": list(poles), "fill": round(e["norm"], 4)}
            if e["value"] is not None:
                vr = {**base, "value": e["value"], "unit": e["unit"], "display": f"{e['value']} {e['unit']}".strip()}
                if e.get("anchored"):
                    vr.update({"anchored": True, "status": "measured-anchored", "confidence": 0.95})   # user-read exact at this position
                elif e.get("derived"):
                    vr.update({"derived": True, "status": "measured-derived", "confidence": 0.85})
                else:
                    vr.update({"status": "measured", "confidence": 1.0})
                rows.append(vr)
            else:
                rows.append({**base, "value": None, "norm": e["norm"], "unit": e["unit"], "per_car": True,
                             "display": f"{e['pole_pct']}% toward {e.get('pole', '?')}",
                             "cal_points": e.get("cal_points", 0),   # distinct calibration points captured (0/1) toward the 2 needed
                             "status": "measured-relative", "confidence": 0.6})
        if tab_name == "Gearing" and tune["gears_norm"]:
            gband = load_global_ranges().get("gear")
            ordn_word = {1: "1st", 2: "2nd", 3: "3rd"}
            for i, g in enumerate(tune["gears_norm"], 1):
                gr = {"field": f"gear_{i}", "label": f"{ordn_word.get(i, str(i)+'th')} gear",
                      "section": "Forward Gears", "poles": list(GEAR_POLES), "fill": round(g, 4)}
                if gband:
                    val = round(gband[0] + g * (gband[1] - gband[0]), 3)
                    gr.update({"value": val, "unit": ":1", "display": f"{val}:1", "derived": True,
                               "status": "measured-derived", "confidence": 0.85})
                else:
                    gr.update({"value": None, "norm": g, "display": f"{round(g*100,1)}% toward accel",
                               "status": "measured-relative", "confidence": 0.6})
                rows.append(gr)
        if rows:
            tabs.append({"tab": tab_name, "rows": rows})
    installed = sum(len(m["rows"]) for m in menus)
    abs_sliders = sum(1 for t in tabs for r in t["rows"] if r.get("value") is not None and not r.get("derived"))
    der_sliders = sum(1 for t in tabs for r in t["rows"] if r.get("value") is not None and r.get("derived"))
    rel_sliders = sum(1 for t in tabs for r in t["rows"] if r.get("value") is None)
    # PI scaffolding (Feature B): tag each installed non-stock row with its estimated PI cost (or null if
    # the solver hasn't isolated it yet), and roll up budget totals. Never blocks output — all-null when sparse.
    pi_total_parts = pi_known_parts = pi_attributed = 0
    for m in menus:
        for r in m["rows"]:
            if r.get("raw") is None or r.get("stock"):
                continue                       # stock / empty slots are not installed upgrades
            if r.get("derived_level"):
                continue                       # derived indicators (engine build level) are not installable — no PI of their own
            slot = _pi_slot_for(r, tune["parts"])
            pv = pi_for(slot, r.get("tier"))
            r["pi"] = pv                        # int estimate, or None when unknown
            pi_total_parts += 1
            if pv is not None:
                pi_known_parts += 1; pi_attributed += pv
    pi_total = observed_car_pi(ordn, tune["parts"])   # exact CarPI for THIS config, if driven & recorded
    _obs = load_pi_observations()   # progress signal for the "measuring PI" state (auto-accrue by driving)
    pi_obs_car = sum(1 for o in _obs if str(o.get("ordinal")) == str(ordn))
    pi_obs_total = len(_obs)
    return {
        "source": "disk",
        "ordinal": ordn,
        "car": car_name,
        "locked": tune["locked"],
        "gear_count": tune["gear_count"],
        "menus": menus,
        "tabs": tabs,
        "summary": {"parts_installed": installed, "sliders_absolute": abs_sliders + der_sliders,
                    "sliders_exact": abs_sliders, "sliders_derived": der_sliders,
                    "sliders_relative": rel_sliders,
                    "pi_total": pi_total,
                    "pi_attributed": (pi_attributed if pi_known_parts else None),
                    "pi_known_parts": pi_known_parts, "pi_total_parts": pi_total_parts,
                    "pi_obs_car": pi_obs_car, "pi_obs_total": pi_obs_total},
        # overall confidence: parts + disk-exact sliders count full; derived (global-band) ~0.85; relative discount
        "confidence": round((installed + abs_sliders + 0.85 * der_sliders + 0.6 * rel_sliders) /
                            max(1, installed + abs_sliders + der_sliders + rel_sliders), 3),
    }


# ---- car name lookup --------------------------------------------------------
def load_car_names(project_dir):
    path = os.path.join(project_dir, "data", "car-ordinals.json")
    try:
        with open(path, encoding="utf-8") as fh:
            cars = json.load(fh).get("cars", {})
    except Exception:
        return {}
    out = {}
    for k, v in cars.items():
        name = v.get("name") if isinstance(v, dict) else v
        out[int(k)] = name
    return out


# ---- CLI --------------------------------------------------------------------
def _project_dir():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", ".."))

def main():
    ap = argparse.ArgumentParser(description="Decode FH6 on-disk tunes")
    ap.add_argument("--ordinal", type=int, help="decode newest tune for this car ordinal")
    ap.add_argument("--file", help="decode a specific Data file")
    ap.add_argument("--list", action="store_true", help="list all cars with on-disk tunes")
    ap.add_argument("--root", help="ContainersRoot override")
    ap.add_argument("--json", action="store_true", help="raw JSON output")
    args = ap.parse_args()

    names = load_car_names(_project_dir())

    if args.file:
        tune = parse_tune(args.file)
        _print_tune(tune, names)
        return

    by_ord, root = scan_tunes(args.root)
    if not root:
        print("No ContainersRoot found under C:\\XboxGames\\GameSave\\pgs")
        return

    if args.list:
        print(f"ContainersRoot: {root}")
        print(f"{len(by_ord)} cars with on-disk tunes:\n")
        for ordn in sorted(by_ord, key=lambda o: names.get(o, "zzz")):
            metas = by_ord[ordn]
            print(f"  {ordn:>5}  {names.get(ordn,'(unknown)'):40s}  {len(metas)} tune(s)")
        return

    if args.ordinal:
        metas = by_ord.get(args.ordinal)
        if not metas:
            print(f"No on-disk tune for ordinal {args.ordinal}")
            return
        tune = parse_tune(metas[0]["path"], ordinal_hint=args.ordinal)
        if args.json:
            print(json.dumps(tune, indent=2))
        else:
            _print_tune(tune, names)
        return

    ap.print_help()

def _print_tune(tune, names):
    o = tune["ordinal"]
    lock = "LOCKED / downloaded" if tune["locked"] else "self-made"
    print(f"\n{names.get(o,'(unknown car)')}  [ordinal {o}]  · {lock} · {tune['gear_count']}-speed\n")
    print("  SLIDERS")
    for name, e in tune["sliders"].items():
        if e["value"] is not None:
            v = e["value"]; u = e["unit"]
            adj = "" if e["adjustable"] else "  (not adjustable)"
            print(f"    {name:22s} {v:>8}  {u}{adj}")
        else:
            print(f"    {name:22s} {e['pole_pct']:>7}%  toward {e.get('pole','?')}  (per-car range)")
    if tune["gears_norm"]:
        print("  GEARS (normalised):", tune["gears_norm"])
    installed = {k: v for k, v in tune["parts"].items() if v is not None}
    named = [(k, v, name_part(tune.get("ordinal"), k, v)) for k, v in installed.items()]
    n_named = sum(1 for _, _, nm in named if nm)
    print(f"  PARTS: {len(installed)} slots populated ({n_named} named)")
    for k, v, nm in named:
        if nm:
            print(f"    {k:22s} {v}  = {nm}")

if __name__ == "__main__":
    main()
