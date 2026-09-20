#!/usr/bin/env python3
"""import_gamedb.py -- populate the whole ref_ layer from the game's own data.

Sources (both READ-ONLY):
  * FH6_Database.sqlite  -- the decrypted gameplay database, 205 tables
  * raw string values/*.str -- the 288 binary string tables (parsed by strparse.py)

The ref_ layer is rebuilt WHOLESALE every run: each table is emptied and refilled inside one
transaction. Nothing here is ever hand-edited, so a rebuild can never lose human work -- that
lives in the obs_ tables.

Name resolution follows the rule proved on 2026-09-02:

    reference = (H(stringTableName) << 32) | H(keyName),  H = fh6db.strhash
    keyName   = 'IDS_<ColumnName>_<row id>'

and a part's display name is

    Upgrades[(UpgradeTypes.id for the slot, IsStock ? 0 : row.Level)]

**Level, never the id's low digits.** The id tail happens to equal Level on the pure tier
ladders (springs, ARBs, camshaft ...) but not on transmission (27%), intercooler (39%),
the aero/visual slots (20-52%) or drivetrain (42%), which are dense per set.

Run:  python scripts/db/import_gamedb.py [--gamedb PATH] [--strdir PATH] [--db PATH] [-v]
"""
import argparse
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import fh6db                                            # noqa: E402
import strparse                                         # noqa: E402

DEFAULT_RAW = r"C:\Users\mondr\Downloads\forza raw data files"
DEFAULT_GAMEDB = os.path.join(DEFAULT_RAW, "FH6_Database.sqlite")
DEFAULT_STRDIR = os.path.join(DEFAULT_RAW, "raw string values")
DEFAULT_SWATCH = os.path.join(DEFAULT_RAW, "swatchbin")


# ---------------------------------------------------------------------------
# The 50 container slots, in SAVE-FILE order.
#
# This order is fh6_tune_decode.PARTS and equals Data_UpgradePartOrder(Id 0..49).Name.
# It is NOT Data_UpgradePart.Id order: that table permutes 42..49. Getting this wrong
# silently mislabels eight slots including both rim slots, so it is asserted at import.
# ---------------------------------------------------------------------------
SLOT_ORDER_NAME = {
    "engine": "Engine", "drivetrain": "Drivetrain", "car_body": "CarBody", "motor": "Motor",
    "brakes": "Brakes", "springs_dampers": "SpringDamper", "front_arb": "AntiSwayFront",
    "rear_arb": "AntiSwayRear", "tire_compound": "TireCompound", "rear_wing": "RearWing",
    "front_rim_size": "RimSizeFront", "rear_rim_size": "RimSizeRear", "camshaft": "Camshaft",
    "valves": "Valves", "displacement": "Displacement", "pistons": "PistonsCompression",
    "fuel_system": "FuelSystem", "ignition": "Ignition", "exhaust": "Exhaust", "intake": "Intake",
    "flywheel": "Flywheel", "manifold": "Manifold", "restrictor_plate": "RestrictorPlate",
    "oil_cooling": "OilCooling", "single_turbo": "SingleTurbo", "twin_turbo": "TwinTurbo",
    "quad_turbo": "QuadTurbo", "centrifugal_supercharger": "SuperchargerCSC",
    "pos_supercharger": "SuperchargerDSC", "intercooler": "Intercooler", "clutch": "Clutch",
    "transmission": "Transmission", "driveline": "Driveline", "differential": "Differential",
    "front_bumper": "FrontBumper", "rear_bumper": "RearBumper", "hood": "Hood",
    "side_skirts": "SideSkirts", "front_tire_width": "TireWidthFront",
    "rear_tire_width": "TireWidthRear", "weight_reduction": "WeightReduction",
    "roll_cage": "ChassisStiffness", "motor_parts": "MotorParts", "rim_style": "WheelStyle",
    "aspiration": "Aspiration", "front_track_width": "TrackSpacingFront",
    "rear_track_width": "TrackSpacingRear", "front_tire_profile": "FrontAspectRatio",
    "rear_tire_profile": "RearAspectRatio", "rear_rim_style": "WheelStyleRear",
}

# Slots whose menu tile is chosen by the car's own option list (manifest rank), not by a level.
VISUAL_SLOTS = {"car_body", "rear_wing", "front_bumper", "rear_bumper", "hood", "side_skirts"}
# Slots bought in Paint and Customize, not the Upgrade Shop.
CUSTOMIZE_SLOTS = {"hood", "side_skirts", "rear_bumper"}
RIM_SLOTS = {"rim_style", "rear_rim_style"}

# Where several UpgradeTypes share a PartName the lowest id is the petrol/default variant;
# the others are engine-conditioned (Diesel, Carburetor, Rotary). Recorded so the ambiguity is
# visible rather than silently resolved.
TYPE_ALTERNATES = {"FuelSystem": [44, 45], "Camshaft": [49], "WheelStyle": [31]}


# ---------------------------------------------------------------------------
# The 36 sliders. band_source says where min/max come from:
#   part  -- the fitted part's physics row supplies Def/Min/Max
#   fixed -- the band is hard-coded in the game and not in any table
#   none  -- not a user-facing slider (padding / internal thresholds)
# ---------------------------------------------------------------------------
SLIDERS = [
    # slider, idx, group, display, unit, band_source, source_slot, fixed_min, fixed_max, formula
    ("front_downforce", 0, "Aero", "Front Downforce", "kgf", "part", "front_bumper", None, None,
     "Downforce0..Downforce1 of the front bumper's AeroPhysics row; install writes DefaultTuneSlider"),
    ("rear_downforce", 1, "Aero", "Rear Downforce", "kgf", "part", "rear_wing", None, None,
     "Downforce0..Downforce1 of the rear wing's AeroPhysics row; install writes DefaultTuneSlider"),
    ("final_drive", 2, "Gearing", "Final Drive", "ratio", "part", "transmission", None, None,
     "the transmission's FinalDriveRatio is the install default"),
    ("brake_pressure", 3, "Brake", "Braking Force", "%", "fixed", "brakes", 0.0, 200.0,
     "v = 200s %; the brake part supplies the default (BrakeTorqueSlider)"),
    ("brake_balance", 4, "Brake", "Brake Balance", "% front", "fixed", "brakes", 0.0, 100.0,
     "v = 100s % front; the brake part supplies the default (BrakeBiasSlider)"),
    ("handbrake", 5, None, None, None, "none", None, None, None, "static, not user-facing"),
    ("center_diff", 6, "Differential", "Center Balance", "% rear", "fixed", "differential", 0.0, 100.0,
     "v = 100s % to the rear; AWD only"),
    ("_unk_01BA", 7, None, None, None, "none", None, None, None, "unidentified"),
    ("_unk_01BE", 8, None, None, None, "none", None, None, None, "unidentified"),
    ("tcs_slip", 9, None, None, None, "none", None, None, None, "internal traction threshold"),
    ("_unk_01C6", 10, None, None, None, "none", None, None, None, "unidentified"),
    ("_unk_01CA", 11, None, None, None, "none", None, None, None, "unidentified"),
    # 15..55 psi, NOT 14..55: the stock NSX-R compound row is 31.0/33.0 psi and a fresh
    # install writes 0.400/0.450 -- 15 + 40*0.400 = 31.0 and 15 + 40*0.450 = 33.0 exactly.
    ("front_tire_pressure", 12, "Tires", "Front Tire Pressure", "psi", "fixed", "tire_compound", 15.0, 55.0,
     "v = 15 + 40s psi; the compound supplies the default (FrontTirePressure)"),
    ("front_camber", 13, "Alignment", "Front Camber", "deg", "fixed", "springs_dampers", -5.0, 5.0,
     "v = -5 + 10s deg; the spring kit's StaticCamber is the install default"),
    ("front_toe", 14, "Alignment", "Front Toe", "deg", "fixed", "springs_dampers", -5.0, 5.0,
     "v = -5 + 10s deg (probable); the spring kit's StaticToe is the install default"),
    ("front_caster", 15, "Alignment", "Front Caster", "deg", "fixed", "springs_dampers", 1.0, 7.0,
     "v = 1 + 6s deg; the spring kit's Caster is the install default"),
    ("front_spring", 16, "Springs", "Front Springs", "N/mm", "part", "springs_dampers", None, None,
     "Min/Max/DefSpringRate of the kit's front SpringDamperPhysics row"),
    ("front_arb", 17, "Antiroll Bars", "Front Antiroll Bar", "scale", "part", "front_arb", None, None,
     "Min/Max/DefSwaybarStiffness of the bar's AntiSwayPhysics row"),
    ("front_ride_height", 18, "Springs", "Front Ride Height", "m", "part", "springs_dampers", None, None,
     "Min/Max/DefRideHeight in metres; the game prints inches (x 39.3701)"),
    ("front_bump", 19, "Damping", "Front Bump Stiffness", "scale", "part", "springs_dampers", None, None,
     "Min/Max/DefDampenBumpRate of the kit's front row"),
    ("front_rebound", 20, "Damping", "Front Rebound Stiffness", "scale", "part", "springs_dampers", None, None,
     "Min/Max/DefDampenReboundRate of the kit's front row"),
    ("front_diff_accel", 21, "Differential", "Front Acceleration", "%", "fixed", "differential", 0.0, 100.0,
     "v = 100s %"),
    ("front_diff_decel", 22, "Differential", "Front Deceleration", "%", "fixed", "differential", 0.0, 100.0,
     "v = 100s %"),
    ("rear_tire_pressure", 23, "Tires", "Rear Tire Pressure", "psi", "fixed", "tire_compound", 15.0, 55.0,
     "v = 15 + 40s psi; the compound supplies the default (RearTirePressure)"),
    ("rear_camber", 24, "Alignment", "Rear Camber", "deg", "fixed", "springs_dampers", -5.0, 5.0,
     "v = -5 + 10s deg"),
    ("rear_toe", 25, "Alignment", "Rear Toe", "deg", "fixed", "springs_dampers", -5.0, 5.0,
     "v = -5 + 10s deg (probable)"),
    ("rear_caster", 26, "Alignment", "Rear Caster", "deg", "fixed", "springs_dampers", 1.0, 7.0,
     "not adjustable in-game; 15 of 527 downloaded tunes contradict the rear row's Caster"),
    ("rear_spring", 27, "Springs", "Rear Springs", "N/mm", "part", "springs_dampers", None, None,
     "Min/Max/DefSpringRate of the kit's rear SpringDamperPhysics row"),
    ("rear_arb", 28, "Antiroll Bars", "Rear Antiroll Bar", "scale", "part", "rear_arb", None, None,
     "Min/Max/DefSwaybarStiffness of the bar's AntiSwayPhysics row"),
    ("rear_ride_height", 29, "Springs", "Rear Ride Height", "m", "part", "springs_dampers", None, None,
     "Min/Max/DefRideHeight in metres; the game prints inches"),
    ("rear_bump", 30, "Damping", "Rear Bump Stiffness", "scale", "part", "springs_dampers", None, None,
     "Min/Max/DefDampenBumpRate of the kit's rear row"),
    ("rear_rebound", 31, "Damping", "Rear Rebound Stiffness", "scale", "part", "springs_dampers", None, None,
     "Min/Max/DefDampenReboundRate of the kit's rear row"),
    ("rear_diff_accel", 32, "Differential", "Rear Acceleration", "%", "fixed", "differential", 0.0, 100.0,
     "v = 100s %"),
    ("rear_diff_decel", 33, "Differential", "Rear Deceleration", "%", "fixed", "differential", 0.0, 100.0,
     "v = 100s %"),
    ("_unk_0226", 34, None, None, None, "none", None, None, None, "unidentified"),
    ("_unk_022A", 35, None, None, None, "none", None, None, None, "unidentified"),
]

# Which physics column feeds which slider, per source slot.
# (slider, physics_table_key, def_col, min_col, max_col) -- resolved per part below.
SPRING_BANDS = [
    ("spring", "DefSpringRate", "MinSpringRate", "MaxSpringRate"),
    ("ride_height", "DefRideHeight", "MinRideHeight", "MaxRideHeight"),
    ("bump", "DefDampenBumpRate", "MinDampenBumpRate", "MaxDampenBumpRate"),
    ("rebound", "DefDampenReboundRate", "MinDampenReboundRate", "MaxDampenReboundRate"),
]
# Alignment defaults live on the same row but have hard-coded bands.
ALIGN_DEFAULTS = [("camber", "StaticCamber", -5.0, 5.0),
                  ("toe", "StaticToe", -5.0, 5.0),
                  ("caster", "Caster", 1.0, 7.0)]


def log(v, *a):
    if v:
        print(*a)


class Strings:
    """The whole string layer, indexed the only safe way: by (table hash, key hash)."""

    def __init__(self, tables):
        self.by_name = tables                        # {table: {key_hash: (key_name, content)}}
        self.by_hash = {fh6db.strhash(n): rows for n, rows in tables.items()}

    def resolve(self, cell, default=None):
        """Resolve a '_&<u64>' cell through the table its HIGH 32 bits name.

        Resolving on the low 32 alone is a real bug, not a shortcut: 1,035 of 6,105 keys
        collide across tables, and Data_Car.MakeName would silently return a car model.
        A cell that is already plain text is passed through.
        """
        if isinstance(cell, str) and not cell.startswith("_&"):
            return cell or default
        ref = fh6db.parse_ref(cell)
        if ref is None:
            return default
        th, kh = fh6db.split_ref(ref)
        hit = self.by_hash.get(th)
        if hit is None:
            return default
        got = hit.get(kh)
        return got[1] if got else default

    def get(self, table, key, default=None):
        got = self.by_name.get(table, {}).get(fh6db.strhash(key))
        return got[1] if got else default


def load_strings(strdir, verbose=False):
    """{table_name: {key_hash: (key_name, content)}} plus per-table metadata."""
    tables, meta = {}, []
    for fn in sorted(os.listdir(strdir)):
        if not fn.lower().endswith(".str"):
            continue
        try:
            d = strparse.parse(os.path.join(strdir, fn))
        except Exception as e:                                  # noqa: BLE001
            log(verbose, "  !! %s: %s" % (fn, e))
            continue
        name = d["name"]
        tables[name] = {h: (k, c) for h, k, c in d["entries"]}
        meta.append((name, fh6db.strhash(name), len(tables[name])))
    return tables, meta


def cols_of(gx, table):
    try:
        return [r[1] for r in gx.execute("PRAGMA table_info(%s)" % table)]
    except sqlite3.DatabaseError:
        return []


def table_exists(gx, name):
    return gx.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def jdump(row, skip=()):
    return json.dumps({k: row[k] for k in row.keys() if k not in skip}, default=str)


# ---------------------------------------------------------------------------
# main import
# ---------------------------------------------------------------------------

def run(cx, gamedb, strdir, swatchdir=None, verbose=False):
    gx = sqlite3.connect("file:%s?mode=ro" % gamedb.replace("\\", "/"), uri=True)
    gx.row_factory = sqlite3.Row
    counts = {}
    # The ref_ tables reference each other (car -> wheel, car_body -> car), so no single fill
    # order satisfies every constraint mid-flight. Defer the checks to COMMIT: they are still
    # enforced, just all at once, and a violation still rolls the whole import back.
    cx.execute("PRAGMA defer_foreign_keys=ON")

    # ---- strings -----------------------------------------------------------
    log(verbose, "strings ...")
    tables, meta = load_strings(strdir, verbose)
    S = Strings(tables)
    csv_names = set()
    rawdir = os.path.dirname(strdir)
    for fn in os.listdir(rawdir):
        if fn.lower().endswith(".csv"):
            csv_names.add(os.path.splitext(fn)[0])
    fh6db.replace_all(cx, "ref_string_table", ["table_name", "name_hash", "n_entries", "has_csv"],
                      [(n, h, c, 1 if n in csv_names else 0) for n, h, c in meta])
    rows = ((name, kh, kn, content)
            for name, tbl in tables.items() for kh, (kn, content) in tbl.items())
    cx.execute("DELETE FROM ref_string")
    counts["ref_string"] = fh6db.upsert_many(
        cx, "ref_string", ["table_name", "key_hash", "key_name", "content"], rows, chunk=5000)
    counts["ref_string_table"] = len(meta)
    log(verbose, "  %d tables, %d entries" % (len(meta), counts["ref_string"]))

    # ---- classes -----------------------------------------------------------
    crows = list(gx.execute("SELECT * FROM CarClasses ORDER BY MaxPerformanceIndex"))
    out = []
    prev_norm, prev_pi = 0.0, 99          # class D's lower anchor: one below the PI floor of 100
    for r in crows:
        out.append((r["Id"], S.resolve(r["DisplayName"], str(r["Id"])), r["MaxPerformanceIndex"],
                    r["MaxDisplayPerformanceIndex"], prev_norm, prev_pi))
        prev_norm, prev_pi = r["MaxPerformanceIndex"], r["MaxDisplayPerformanceIndex"]
    fh6db.replace_all(cx, "ref_class",
                      ["class_id", "name", "norm_max", "pi_max", "norm_prev", "pi_prev"], out)
    counts["ref_class"] = len(out)
    classes = fh6db.load_classes(cx)

    # ---- slots -------------------------------------------------------------
    order = {r["Name"]: r["Id"] for r in gx.execute("SELECT Id, Name FROM Data_UpgradePartOrder")}
    part_by_name = {r["PartName"]: r for r in gx.execute("SELECT * FROM Data_UpgradePart")}
    types = list(gx.execute("SELECT * FROM UpgradeTypes ORDER BY id"))
    type_by_partname = {}
    for t in types:
        type_by_partname.setdefault(t["PartName"], []).append(t)
    # menu areas
    area_name = {}
    for r in gx.execute("SELECT * FROM UpgradeAreas"):
        area_name[r["id"]] = S.resolve(r["Name"], "area %s" % r["id"])
    area_of_type = {}
    for r in gx.execute("SELECT * FROM UpgradeAreaForUpgradeType"):
        area_of_type.setdefault(r["UpgradeTypeId"], r["UpgradeAreaId"])

    slot_rows, slot_meta = [], {}
    for slot, oname in SLOT_ORDER_NAME.items():
        idx = order.get(oname)
        if idx is None:
            raise RuntimeError("slot %r: %r missing from Data_UpgradePartOrder" % (slot, oname))
        dp = part_by_name.get(oname)
        tlist = type_by_partname.get(oname, [])
        tid = tlist[0]["id"] if tlist else None
        aid = area_of_type.get(tid)
        src = dp["TableName"] if dp else None
        cat = dp["CategoryName"] if dp else None
        keycol = {"Car": "Ordinal", "Engine": "EngineID", "Drivetrain": "DrivetrainID",
                  "CarBody": "CarBodyID", "Motor": "MotorID"}.get(cat)
        if slot in RIM_SLOTS:
            src, cat, keycol = "List_Wheels", "Wheels", None
        slot_rows.append((idx, slot, oname, src, cat, keycol, tid,
                          area_name.get(aid), aid, tlist[0]["DisplayOrder"] if tlist else None,
                          1 if slot in VISUAL_SLOTS else 0,
                          0 if slot in CUSTOMIZE_SLOTS else 1))
        slot_meta[slot] = {"idx": idx, "table": src, "cat": cat, "keycol": keycol, "type_id": tid}
    fh6db.replace_all(cx, "ref_slot",
                      ["slot_index", "slot", "part_name", "source_table", "category", "key_column",
                       "upgrade_type_id", "menu_area", "menu_area_order", "menu_order",
                       "is_visual", "in_upgrade_shop"], slot_rows)
    counts["ref_slot"] = len(slot_rows)

    # ---- upgrade names: (TypeId, Level) -> text ----------------------------
    upname, upsort = {}, {}
    for r in gx.execute("SELECT id, TypeId, Level, Name, SortOrder FROM Upgrades"):
        key = (int(r["TypeId"]), r["Level"])
        txt = S.resolve(r["Name"])
        if txt:
            upname.setdefault(key, txt)
            upsort.setdefault(key, r["SortOrder"])

    def part_name_for(tid, level, is_stock):
        if tid is None:
            return None
        lv = 0 if is_stock else level
        return upname.get((tid, lv)) or upname.get((tid, level))

    # ---- manufacturers -----------------------------------------------------
    manu = {}
    for r in gx.execute("SELECT * FROM List_PartManufacturer"):
        manu[r["Id"]] = S.resolve(r["PartManufacturer"], None) or (
            r["PartManufacturer"] if not str(r["PartManufacturer"]).startswith("_&") else None)

    # ---- wheels ------------------------------------------------------------
    wcat = [(r["ID"], S.resolve(r["Name"], "cat %s" % r["ID"]), r["DisplayOrder"])
            for r in gx.execute("SELECT * FROM WheelCategories")]
    fh6db.replace_all(cx, "ref_wheel_category", ["category_id", "name", "display_order"], wcat)
    counts["ref_wheel_category"] = len(wcat)

    ann = {}
    for r in gx.execute("SELECT * FROM WheelAnnotations ORDER BY CategoryID, DisplayOrder, WheelID"):
        ann.setdefault(r["WheelID"], (r["CategoryID"], r["DisplayOrder"]))
    rank_in_cat = {}
    for wid, (cid, dorder) in sorted(ann.items(), key=lambda kv: (kv[1][0], kv[1][1], kv[0])):
        rank_in_cat.setdefault(cid, [])
        rank_in_cat[cid].append(wid)
    rank_of = {}
    for cid, wids in rank_in_cat.items():
        for i, wid in enumerate(wids):
            rank_of[wid] = i

    swatches = set()
    if swatchdir and os.path.isdir(swatchdir):
        swatches = {os.path.splitext(f)[0] for f in os.listdir(swatchdir)}

    wrows = []
    for r in gx.execute("SELECT * FROM List_Wheels"):
        wid = r["ID"]
        disp = r["DisplayName"]
        disp = None if disp in (None, "", "NULL") else disp
        mk = manu.get(r["PartManufacturerID"])
        full = " ".join(x for x in (mk, disp) if x) or (r["MediaName"] or str(wid))
        cid, dorder = ann.get(wid, (None, None))
        rk = rank_of.get(wid)
        wrows.append((wid, disp, mk, full, r["MediaName"], r["Mass"], r["MassLevel"], r["Price"],
                      r["IsStock"], cid, dorder,
                      (rk // 3 + 1) if rk is not None else None,
                      (rk % 3 + 1) if rk is not None else None))
    fh6db.replace_all(cx, "ref_wheel",
                      ["wheel_id", "name", "manufacturer", "full_name", "media_name", "mass",
                       "mass_level", "price", "is_stock", "category_id", "display_order",
                       "tile_row", "tile_col"], wrows)
    counts["ref_wheel"] = len(wrows)
    counts["_wheel_swatches"] = sum(1 for r in wrows if r[4] in swatches)

    # ---- engines / drivetrains / bodies / motors ---------------------------
    ecols = cols_of(gx, "Data_Engine")
    namecol = "EngineName" if "EngineName" in ecols else None
    erows = []
    for r in gx.execute("SELECT * FROM Data_Engine"):
        nm = r[namecol] if namecol else None
        if nm and str(nm).startswith("_&"):
            nm = S.resolve(nm)
        erows.append((r["EngineID"], nm, r["MediaName"], None, None, None, None,
                      r["EngineMass-kg"], None, jdump(r)))
    fh6db.replace_all(cx, "ref_engine",
                      ["engine_id", "name", "media_name", "config", "cylinders", "displacement_cc",
                       "aspiration_stock", "mass_kg", "redline_rpm", "data"], erows)
    counts["ref_engine"] = len(erows)

    dtypes = {r["ID"]: S.resolve(r["DisplayName"], r["DriveType"])
              for r in gx.execute("SELECT * FROM List_DriveType")}
    n_cars_per_dt = {}
    for r in gx.execute("SELECT DrivetrainID, COUNT(DISTINCT Ordinal) n FROM List_UpgradeDrivetrain GROUP BY DrivetrainID"):
        n_cars_per_dt[r["DrivetrainID"]] = r["n"]
    drows = []
    for r in gx.execute("SELECT * FROM Data_Drivetrain"):
        did = r["DrivetrainID"]
        n = n_cars_per_dt.get(did, 0)
        drows.append((did, dtypes.get(r["DrivetypeID"]), None, 1 if n > 1 else 0, n, jdump(r)))
    fh6db.replace_all(cx, "ref_drivetrain",
                      ["drivetrain_id", "drivetype", "shift_system", "is_swap_set", "n_cars", "data"], drows)
    counts["ref_drivetrain"] = len(drows)

    body_owner = {}
    for r in gx.execute("SELECT * FROM List_UpgradeCarBody"):
        body_owner[r["CarBodyID"]] = (r["Ordinal"], r["Level"],
                                      part_name_for(slot_meta["car_body"]["type_id"], r["Level"], r["IsStock"]))
    brows = []
    for r in gx.execute("SELECT * FROM Data_CarBody"):
        bid = r["Id"]
        own = body_owner.get(bid, (None, None, None))
        brows.append((bid, own[0], own[1], own[2], r["Length"], r["Width"], r["Height"],
                      r["Wheelbase"], jdump(r)))
    fh6db.replace_all(cx, "ref_car_body",
                      ["carbody_id", "ordinal", "variant", "name", "length_m", "width_m", "height_m",
                       "wheelbase_m", "data"], brows)
    counts["ref_car_body"] = len(brows)

    if table_exists(gx, "Data_Motor"):
        mrows = [(r["MotorID"], r["MotorName"], r["MediaName"], r["MotorMass-kg"],
                  r["BatteryCapacity"], r["RedlineRPM"], jdump(r))
                 for r in gx.execute("SELECT * FROM Data_Motor")]
        fh6db.replace_all(cx, "ref_motor",
                          ["motor_id", "name", "media_name", "mass_kg", "battery_kwh",
                           "redline_rpm", "data"], mrows)
        counts["ref_motor"] = len(mrows)

    # ---- cars --------------------------------------------------------------
    makes = {r["ID"]: S.resolve(r["DisplayName"], None)
             for r in gx.execute("SELECT * FROM List_CarMake")}
    cyl = {r["CylinderID"]: r["Number"] for r in gx.execute("SELECT * FROM List_Cylinders")}
    asp = {r["AspirationID"]: S.resolve(r["DisplayName"], r["Aspiration"])
           for r in gx.execute("SELECT * FROM List_Aspiration")}
    drv = dtypes
    place = {r["ID"]: S.resolve(r["DisplayName"], r["EnginePlacement"])
             for r in gx.execute("SELECT * FROM List_EnginePlacement")}
    wheel_level = {r[0]: r[1] for r in cx.execute("SELECT wheel_id, mass_level FROM ref_wheel")}
    stock_engine, stock_dt, stock_body = {}, {}, {}
    for r in gx.execute("SELECT Ordinal, EngineID FROM List_UpgradeEngine WHERE IsStock=1"):
        stock_engine.setdefault(r["Ordinal"], r["EngineID"])
    for r in gx.execute("SELECT Ordinal, DrivetrainID FROM List_UpgradeDrivetrain WHERE IsStock=1"):
        stock_dt.setdefault(r["Ordinal"], r["DrivetrainID"])
    for r in gx.execute("SELECT Ordinal, CarBodyID FROM List_UpgradeCarBody WHERE IsStock=1"):
        stock_body.setdefault(r["Ordinal"], r["CarBodyID"])

    class_name = {c[0]: c[1] for c in classes}
    crows2 = []
    unob = {r[0] for r in gx.execute("SELECT Ordinal FROM UnobtainableCars")} if table_exists(gx, "UnobtainableCars") else set()
    for r in gx.execute("SELECT * FROM Data_Car"):
        o = r["Id"]
        model = S.resolve(r["DisplayName"], None)
        make = makes.get(r["MakeID"])
        full = " ".join(str(x) for x in (r["Year"], make, model) if x)
        swid = r["StockWheelID"]
        crows2.append((
            o, r["Year"], make, model, " ".join(str(x) for x in (make, model) if x) or str(o), full,
            r["MediaName"], r["ClassID"], class_name.get(r["ClassID"]), r["PI"], r["PerformanceIndex"],
            (r["CurbWeight"] or 0) * 100.0, r["WeightDistribution"], drv.get(r["DriveTypeID"]),
            place.get(r["EnginePlacementID"]), cyl.get(r["CylinderID"]), r["Displacement"],
            asp.get(r["AspirationTypeId"]), r["NumGears"],
            stock_engine.get(o), stock_dt.get(o), stock_body.get(o), swid, wheel_level.get(swid),
            r["BaseCost"], r["BaseRarity"],
            r["HandlingRating"], r["SpeedRating"], r["AccelerationRating"], r["BrakingRating"],
            r["LaunchRating"], r["OffroadRating"],
            r["FrontStockRideHeight"], r["RearStockRideHeight"],
            r["FrontTireWidthMM"], r["RearTireWidthMM"], r["FrontWheelDiameterIN"], r["RearWheelDiameterIN"],
            r["IsDrivable"], 0 if (r["NotAvailableInAutoshow"] or o in unob) else 1,
            jdump(r)))
    fh6db.replace_all(cx, "ref_car",
                      ["ordinal", "year", "make", "model", "display_name", "full_name", "media_name",
                       "class_id", "class", "pi", "pi_norm", "curb_weight_kg", "weight_dist",
                       "drivetype", "engine_placement", "cylinders", "displacement_cc", "aspiration",
                       "num_gears", "stock_engine_id", "stock_drivetrain_id", "stock_carbody_id",
                       "stock_wheel_id", "stock_wheel_level", "base_cost", "rarity",
                       "rating_handling", "rating_speed", "rating_accel", "rating_braking",
                       "rating_launch", "rating_offroad", "front_ride_height_m", "rear_ride_height_m",
                       "front_tire_mm", "rear_tire_mm", "front_rim_in", "rear_rim_in",
                       "is_drivable", "in_autoshow", "data"], crows2)
    counts["ref_car"] = len(crows2)

    # ---- compounds ---------------------------------------------------------
    tyre = {r["TireCompoundID"]: r for r in gx.execute("SELECT * FROM List_TyreCurveDB")} \
        if table_exists(gx, "List_TyreCurveDB") else {}
    comp_name = {}
    for r in gx.execute("SELECT Ordinal, TireCompoundID, Level, IsStock FROM List_UpgradeTireCompound"):
        nm = part_name_for(slot_meta["tire_compound"]["type_id"], r["Level"], 0)
        if nm:
            comp_name.setdefault(r["TireCompoundID"], nm)
    comp = []
    for r in gx.execute("SELECT * FROM List_TireCompound"):
        cid = r["TireCompoundID"]
        t = tyre.get(cid)
        comp.append((cid, comp_name.get(cid), r["DisplayName"],
                     t["Asph_LatSlipPeak0"] if t else None,
                     t["Asph_LongSlipPeak0"] if t else None,
                     t["Asph_BrkSlipPeak0"] if t else None,
                     None, None, None, jdump(r)))
    fh6db.replace_all(cx, "ref_compound",
                      ["compound_id", "name", "internal_name", "lat_slip_peak", "long_slip_peak",
                       "brake_slip_peak", "lat_slip_peak_offroad", "friction_scale", "wear_scale",
                       "data"], comp)
    counts["ref_compound"] = len(comp)

    # ---- sliders -----------------------------------------------------------
    fh6db.replace_all(cx, "ref_slider",
                      ["slider", "slot_index", "group_name", "display_name", "unit", "band_source",
                       "source_slot", "fixed_min", "fixed_max", "formula", "confidence"],
                      [(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9],
                        "verified" if s[5] != "none" else "unknown") for s in SLIDERS])
    counts["ref_slider"] = len(SLIDERS)

    # ---- parts -------------------------------------------------------------
    prows, psrows = [], []
    engine_name = {r[0]: r[1] for r in cx.execute(
        "SELECT engine_id, name FROM ref_engine WHERE name IS NOT NULL")}
    motor_name = {r[0]: r[1] for r in cx.execute(
        "SELECT motor_id, name FROM ref_motor WHERE name IS NOT NULL")}
    dtype_of = {r[0]: r[1] for r in cx.execute(
        "SELECT drivetrain_id, drivetype FROM ref_drivetrain WHERE drivetype IS NOT NULL")}
    spring_phys = {r["SpringDamperPhysicsID"]: r for r in gx.execute("SELECT * FROM List_SpringDamperPhysics")}
    sway_phys = {r["AntiSwayPhysicsID"]: r for r in gx.execute("SELECT * FROM List_AntiSwayPhysics")}
    aero_phys = {r["AeroPhysicsID"]: r for r in gx.execute("SELECT * FROM List_AeroPhysics")}

    for slot, m in slot_meta.items():
        tbl, keycol, tid = m["table"], m["keycol"], m["type_id"]
        if slot in RIM_SLOTS or not tbl or not table_exists(gx, tbl):
            continue
        cs = cols_of(gx, tbl)
        if "Id" not in cs:
            continue
        has_level, has_stock = "Level" in cs, "IsStock" in cs
        # COLUMN NAMES ARE NOT CONSISTENTLY CASED IN THE GAME'S SCHEMA: the body-keyed tables
        # spell it CarBodyId, CarbodyId and CarBodyID in different places. A case-sensitive
        # lookup silently found none of them, so tile ranking fell into a single global bucket
        # and printed things like "tile 391 of 2227" instead of "tile 3 of 3".
        low = {c.lower(): c for c in cs}
        keyc = low.get((keycol or "").lower()) or low.get("ordinal")
        # bucket by key so tiles can be ranked within one car's menu
        buckets = {}
        for r in gx.execute("SELECT * FROM %s" % tbl):
            buckets.setdefault(r[keyc] if keyc else None, []).append(r)
        for key_id, rs in buckets.items():
            rs.sort(key=lambda r: (upsort.get((tid, r["Level"] if has_level else 0), 9999), r["Id"]))
            n = len(rs)
            for i, r in enumerate(rs):
                lvl = r["Level"] if has_level else None
                stock = r["IsStock"] if has_stock else 0
                nm = part_name_for(tid, lvl, stock)
                # THE THREE SWAP SLOTS DO NOT TAKE THEIR NAME FROM Upgrades. TypeId 1 (Engine)
                # only defines Levels -1/0 ("Stock/Street Powertrain Swap"), so every real swap
                # tile came out unnamed. The menu prints the swapped component's own name.
                if slot == "engine":
                    nm = engine_name.get(r["EngineID"]) or nm
                elif slot == "drivetrain":
                    dt = dtype_of.get(r["DrivetrainID"])
                    nm = ("%s Drivetrain" % dt) if dt else nm
                elif slot == "motor":
                    nm = motor_name.get(r["MotorID"]) or nm
                mk = manu.get(r["ManufacturerID"]) if "ManufacturerID" in cs else (
                    manu.get(r["ManufacturerId"]) if "ManufacturerId" in cs else None)
                conf = "proven" if nm else "unknown"
                if slot in VISUAL_SLOTS:
                    conf = "derived"          # tile comes from the car's option list, not the level
                prows.append((slot, r["Id"], key_id, lvl, stock, nm, mk,
                              r["Price"] if "Price" in cs else None,
                              r["MassDiff"] if "MassDiff" in cs else None,
                              r["WeightDistDiff"] if "WeightDistDiff" in cs else None,
                              i + 1, n, None,
                              r["RequiresGraphics"] if "RequiresGraphics" in cs else None,
                              conf, jdump(r)))

                # ---- the bands this part supplies -------------------------
                if slot == "springs_dampers":
                    for side, col in (("front", "FrontSpringDamperPhysicsID"),
                                      ("rear", "RearSpringDamperPhysicsID")):
                        ph = spring_phys.get(r[col]) if col in cs else None
                        if not ph:
                            continue
                        for nm2, dc, mnc, mxc in SPRING_BANDS:
                            d, mn, mx = ph[dc], ph[mnc], ph[mxc]
                            psrows.append((slot, r["Id"], "%s_%s" % (side, nm2), d, mn, mx,
                                           fh6db.install_norm(d, mn, mx),
                                           1 if fh6db.is_locked(mn, mx) else 0))
                        for nm2, dc, fmn, fmx in ALIGN_DEFAULTS:
                            d = ph[dc]
                            psrows.append((slot, r["Id"], "%s_%s" % (side, nm2), d, fmn, fmx,
                                           fh6db.install_norm(d, fmn, fmx), 0))
                elif slot in ("front_arb", "rear_arb"):
                    ph = sway_phys.get(r["AntiSwayPhysicsID"]) if "AntiSwayPhysicsID" in cs else None
                    if ph:
                        d, mn, mx = ph["DefSwaybarStiffness"], ph["MinSwaybarStiffness"], ph["MaxSwaybarStiffness"]
                        psrows.append((slot, r["Id"], slot, d, mn, mx,
                                       fh6db.install_norm(d, mn, mx),
                                       1 if fh6db.is_locked(mn, mx) else 0))
                elif slot in ("front_bumper", "rear_wing"):
                    ph = aero_phys.get(r["AeroPhysicsID"]) if "AeroPhysicsID" in cs else None
                    if ph:
                        sl = "front_downforce" if slot == "front_bumper" else "rear_downforce"
                        mn, mx = ph["Downforce0"], ph["Downforce1"]
                        d = mn + (ph["DefaultTuneSlider"] or 0.0) * (mx - mn)
                        psrows.append((slot, r["Id"], sl, d, mn, mx, ph["DefaultTuneSlider"],
                                       1 if fh6db.is_locked(mn, mx) else 0))
                elif slot == "brakes":
                    if "BrakeTorqueSlider" in cs:
                        psrows.append((slot, r["Id"], "brake_pressure",
                                       (r["BrakeTorqueSlider"] or 0) * 200.0, 0.0, 200.0,
                                       r["BrakeTorqueSlider"], 0))
                    if "BrakeBiasSlider" in cs:
                        psrows.append((slot, r["Id"], "brake_balance",
                                       (r["BrakeBiasSlider"] or 0) * 100.0, 0.0, 100.0,
                                       r["BrakeBiasSlider"], 0))
                elif slot == "tire_compound":
                    for sl, col in (("front_tire_pressure", "FrontTirePressure"),
                                    ("rear_tire_pressure", "RearTirePressure")):
                        if col in cs and r[col] is not None:
                            psrows.append((slot, r["Id"], sl, r[col], 15.0, 55.0,
                                           fh6db.install_norm(r[col], 15.0, 55.0), 0))
                elif slot == "transmission" and "FinalDriveRatio" in cs:
                    fd = r["FinalDriveRatio"]
                    psrows.append((slot, r["Id"], "final_drive", fd, 2.20, 6.10,
                                   fh6db.install_norm(fd, 2.20, 6.10), 0))

    # rims are parts too -- one ref_part row per wheel per rim slot, so tune_part joins uniformly
    for slot in RIM_SLOTS:
        for w in wrows:
            # mass_diff_kg stays NULL. List_Wheels.Mass is the wheel's ABSOLUTE mass, not a
            # delta against the stock rim: summing it into the build ledger added a whole wheel
            # per rim slot and made every build 76 kg heavy. A rim's weight effect is carried by
            # MassLevel (0 heaviest .. 4 lightest) against the car's stock rim level, and the
            # lb-per-level unit is a property of the BUILD, so it is never a constant here.
            prows.append((slot, w[0], None, None, w[8], w[3], w[2], w[7], None, None,
                          (w[11] - 1) * 3 + w[12] if w[11] and w[12] else None, None, None, None,
                          "proven", json.dumps({"mass_level": w[6], "mass": w[5],
                                                "category_id": w[9]})))

    fh6db.replace_all(cx, "ref_part",
                      ["slot", "part_id", "key_id", "level", "is_stock", "name", "manufacturer",
                       "price", "mass_diff_kg", "weight_dist_diff", "tile", "tile_count",
                       "requires_aspiration", "requires_graphics", "confidence", "data"], prows)
    counts["ref_part"] = len(prows)
    fh6db.replace_all(cx, "ref_part_slider",
                      ["slot", "part_id", "slider", "def_value", "min_value", "max_value",
                       "def_norm", "locked"], psrows)
    counts["ref_part_slider"] = len(psrows)

    # ---- regions -----------------------------------------------------------
    if table_exists(gx, "Environments"):
        rr = []
        for r in gx.execute("SELECT * FROM Environments"):
            rr.append((r["Id"], S.resolve(r["DisplayName"], r["Location"]), r["MapX"], r["MapY"]))
        fh6db.replace_all(cx, "ref_region", ["region_id", "name", "map_x", "map_y"], rr)
        counts["ref_region"] = len(rr)

    if table_exists(gx, "Tracks"):
        tr = []
        for r in gx.execute("SELECT * FROM Tracks"):
            tr.append((r["id"], S.resolve(r["DisplayName"], r["MediaName"]), r["MediaName"],
                       r["Length"], r["IsReverse"], r["IsRealWorld"], jdump(r)))
        fh6db.replace_all(cx, "ref_track",
                          ["track_id", "name", "media_name", "length_m", "is_reverse",
                           "is_real_world", "data"], tr)
        counts["ref_track"] = len(tr)

    gx.close()
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--gamedb", default=DEFAULT_GAMEDB)
    ap.add_argument("--strdir", default=DEFAULT_STRDIR)
    ap.add_argument("--swatchdir", default=DEFAULT_SWATCH)
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    cx = fh6db.connect(a.db)
    fh6db.ensure_schema(cx)
    rid = fh6db.run_begin(cx, "gamedb", a.gamedb)
    try:
        counts = run(cx, a.gamedb, a.strdir, a.swatchdir, a.verbose)
        cx.commit()
    except Exception as e:                                       # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    total = sum(v for k, v in counts.items() if not k.startswith("_"))
    fh6db.run_end(cx, rid, total, 1, json.dumps(counts))
    for k in sorted(counts):
        print("  %-24s %8d" % (k, counts[k]))
    print("gamedb import ok: %d rows" % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
