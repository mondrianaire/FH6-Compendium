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
import struct, os, glob, json, argparse, re

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
    "twin_turbo","quad_turbo","pos_supercharger","centrifugal_supercharger","intercooler",
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
    pts.append([round(float(norm), 4), float(value)])
    solved = back_solve(pts)
    if solved:
        r = doc.setdefault("ranges", {}).setdefault(str(int(ordinal)), {})
        r[field] = {"min": solved[0], "max": solved[1], "unit": unit or "", "source": f"back-solved from {len(pts)} points"}
    tmp = _ranges_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
    os.replace(tmp, _ranges_path())
    return solved

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
    sliders = {}
    for name, off, lo, hi, unit, per_car, adj in SLIDERS:
        if name.startswith("_"):
            continue                       # internal/static padding fields
        norm = _f32(b, off)
        entry = {"norm": round(norm, 4), "unit": unit, "adjustable": adj}
        rng = ranges.get(name)
        if per_car and rng:
            lo2, hi2 = rng
            entry["value"] = round(lo2 + norm * (hi2 - lo2), 2)
            entry["range"] = rng
        elif per_car:
            # unknown absolute range: report position toward the pole
            entry["value"] = None
            entry["pole"] = POLES.get(name)
            entry["pole_pct"] = round(norm * 100, 1)
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
    """Locate the newest ContainersRoot under the GameSave tree."""
    hits = glob.glob(os.path.join(base, "u_*", "*", "ContainersRoot"))
    if not hits:
        return None
    return max(hits, key=lambda p: os.path.getmtime(p))

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
    ("Engine & Power", ["engine","motor","motor_parts","camshaft","valves","displacement",
        "pistons","fuel_system","ignition","exhaust","intake","flywheel","manifold",
        "restrictor_plate","oil_cooling","aspiration","single_turbo","twin_turbo","quad_turbo",
        "pos_supercharger","centrifugal_supercharger","intercooler"]),
    ("Platform & Handling", ["brakes","springs_dampers","front_arb","rear_arb",
        "weight_reduction","roll_cage"]),
    ("Drivetrain", ["drivetrain","clutch","transmission","driveline","differential"]),
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

def _part_view(cat, val, ordinal):
    """Human-ish view of one part slot value (tier index if ordinal-scoped, else global ID)."""
    if val is None:
        return {"raw": None, "tier": None, "label": "—", "stock": None}
    if val // 1000 == ordinal:
        idx = val % 1000
        return {"raw": val, "tier": idx, "stock": idx == 0,
                "label": "Stock" if idx == 0 else f"Upgraded · tier {idx}"}
    # global catalog id (shared swap part): show the id; stock cannot be inferred
    return {"raw": val, "tier": None, "stock": None, "label": f"catalog #{val}"}

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
            pv = _part_view(k, tune["parts"][k], ordn)
            if pv["raw"] is None:
                continue   # empty slot — omit from the install list
            rows.append({"item": k, "value": pv["label"], "tier": pv["tier"],
                         "stock": pv["stock"], "raw": pv["raw"],
                         "status": "measured", "confidence": 1.0})
        if rows:
            menus.append({"menu": menu_name, "rows": rows})
    # tune tabs
    tabs = []
    for tab_name, keys in TUNE_TABS:
        rows = []
        for k in keys:
            e = tune["sliders"].get(k)
            if not e:
                continue
            if e["value"] is not None:
                disp = f"{e['value']} {e['unit']}".strip()
                rows.append({"field": k, "value": e["value"], "unit": e["unit"],
                             "display": disp, "status": "measured", "confidence": 1.0})
            else:
                rows.append({"field": k, "value": None, "norm": e["norm"], "unit": e["unit"], "per_car": True,
                             "display": f"{e['pole_pct']}% toward {e.get('pole','?')}",
                             "status": "measured-relative", "confidence": 0.6})
        if tab_name == "Gearing" and tune["gears_norm"]:
            for i, g in enumerate(tune["gears_norm"], 1):
                rows.append({"field": f"gear_{i}", "value": None, "norm": g,
                             "display": f"gear {i}: {round(g*100,1)}% toward accel",
                             "status": "measured-relative", "confidence": 0.6})
        if rows:
            tabs.append({"tab": tab_name, "rows": rows})
    installed = sum(len(m["rows"]) for m in menus)
    abs_sliders = sum(1 for t in tabs for r in t["rows"] if r.get("value") is not None)
    rel_sliders = sum(1 for t in tabs for r in t["rows"] if r.get("value") is None)
    return {
        "source": "disk",
        "ordinal": ordn,
        "car": car_name,
        "locked": tune["locked"],
        "gear_count": tune["gear_count"],
        "menus": menus,
        "tabs": tabs,
        "summary": {"parts_installed": installed, "sliders_absolute": abs_sliders,
                    "sliders_relative": rel_sliders},
        # overall confidence: parts + absolute sliders are exact; relative sliders slightly discount
        "confidence": round((installed + abs_sliders + 0.6 * rel_sliders) /
                            max(1, installed + abs_sliders + rel_sliders), 3),
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
    print(f"  PARTS: {len(installed)} slots populated (U32 catalog IDs)")

if __name__ == "__main__":
    main()
