#!/usr/bin/env python3
"""export_options.py -- write dashboard/v2/api/options/<ordinal>.json: the WHOLE Upgrade Shop for
one car, as the game draws it.

One file per car that has at least one save in tune_container. The file is the shop tree:

    shop[]                 the Upgrade Shop root, the game's 3x2 grid, in the game's own order,
                           with the game's own area name and description
      .menus[]             the sub-menus of that area for THIS car, in the game's DisplayOrder,
                           with the context flags that gate them (aspiration, body kit)
        .tiles[]           every tile of the grid in tile order, named as the name bar writes it
    rims                   the Rim Style catalogue, by brand, with each rim's weight class
    index_scheme           how a save's index maps to a tile, per slot (spec 9.5)
    unknown[]              tiles whose name or position could not be established -- listed, never invented

WHERE EVERY FIELD COMES FROM (no field here is a guess dressed as a fact):

  area name / description   ref_string 'UpgradeAreas'  IDS_Name_<area>  / IDS_Description_<area>
                            -- the game's own strings; they reproduce docs/fh6-ui-spec.md section 2
                            verbatim, double space and all.
  menu title / description  ref_string 'UpgradeTypes'  IDS_Name_<type>  / IDS_Description_<type>
                            -- 'Oil / Cooling', 'Spring and Dampers', 'Chassis Reinforcement /
                            Roll Cage', 'Front Anti-roll Bars', 'Rim Style', 'Front Rim Style'
                            all come out of this table exactly as spec section 5.1 demands.
  menu order                ref_slot.menu_order == UpgradeTypes.DisplayOrder.
  area order                ref_slot.menu_area_order == UpgradeAreas.id; sorted, that IS the 3x2 grid.
  tiles                     ref_part rows for (slot, key), where the key is derived from the parts
                            the car's newest save actually carries (tune_part), never from
                            tune_container.engine_id (which is a copy of the ordinal).
  tile order                ref_part.tile, with the STOCK row pulled to tile 1. import_gamedb ranks
                            by Upgrades.SortOrder of the row's own Level, and a stock row whose Level
                            is not 0 (the 2102 Stock Diff is Level 5) sorts into the middle: the
                            AWD NSX-R Differential came out Race/Stock/Drift/Offroad where the game
                            draws Stock/Race/Drift/Offroad (spec 10.3). Every captured grid in the
                            spec puts the stock tile first, so that is the correction applied here.
  price / level / stock     ref_part.
  mass_lb                   ref_part.mass_diff_kg * 2.2046 (the part's OWN mass delta), except
                            weight_reduction, whose table carries an ABSOLUTE Mass: there the delta
                            is against the menu's stock row. NOTE this is not the game's green chip:
                            the chip is a delta against the INSTALLED part, which depends on the build.
  effect                    data/parts-effects.json, only where a measured delta exists for this car
                            and part. Three cars have any; everywhere else it is null, never invented.
  unlock                    the yellow banner, from spec section 0 / 5.8 / 10.2 / 10.4, applied per
                            slot; the rear wing's banner is decided by the DATA (ref_part_slider:
                            an unlocked rear_downforce band == the ADJUSTABLE chip).
  requires_aspiration       forced-induction tier menus exist only under their own conversion
                            (spec 9.1 / 10.5); Intercooler needs any forced induction; Intake
                            Manifold is the reverse -- the game's own description for UpgradeTypes 40
                            reads "Only available on naturally aspirated engines", which is why the
                            NSX-R Engine grid is 12 tiles with the supercharger (spec 10.4) and 11
                            with the naturally aspirated V8 (spec 2.1).
  removed_by_body_kit       front_bumper, spec 2.5 / 10.7 -- the tile disappears while a kit is on.
  rims                      ref_wheel / ref_wheel_category. A rim is a WEIGHT CLASS (spec 10.6):
                            mass_level 0 heaviest .. 4 lightest. mass_lb stays null on purpose --
                            the lb-per-level unit is a property of the car, not of the rim.

A menu is drawn only when its grid has more than one tile: the NSX-R's Drivetrain area shows
Transmission / Driveline / Differential and no Clutch tile even though the save carries a clutch id
(spec 10.3), and the clutch grid on that drivetrain set has exactly one row. Every menu suppressed
that way is still reported, under "hidden".

Run:  python scripts/db/export_options.py [--db PATH] [--out DIR] [--ordinal N] [--quiet]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                                          # noqa: E402

OUT = os.path.join(ROOT, "dashboard", "v2", "api", "options")
DATA = os.path.join(ROOT, "data")
KG_LB = 2.2046226

# ---------------------------------------------------------------------------
# Constants that are READ FROM THE SPEC, not from the database. Each carries the section it
# came from; nothing here is inferred from another Forza title.
# ---------------------------------------------------------------------------

# The yellow unlock banner, per slot. Text verbatim from spec 0 / 5.8 / 10.2 / 10.4.
# value: (predicate over a tile dict, banner text)
UNLOCK_BANNER = {
    "brakes":          ("race", "UNLOCKS BRAKE TUNING"),                     # spec 10.4: Race only
    "springs_dampers": ("nonstock", "UNLOCKS SPRING, DAMPER, AND ALIGNMENT TUNING"),
    "front_arb":       ("nonstock", "UNLOCKS FRONT ANTI-ROLL BAR STIFFNESS TUNING"),
    "rear_arb":        ("nonstock", "UNLOCKS REAR ANTIROLL BAR STIFFNESS TUNING"),   # sic, spec 10.4
    "differential":    ("nonstock", "UNLOCKS FULL DIFFERENTIAL TUNING"),
    "transmission":    ("nonstock", "UNLOCKS FULL GEAR RATIO TUNING"),       # spec 10.2
    "rear_wing":       ("adjustable", "UNLOCKS REAR WING DOWNFORCE TUNING"),  # spec 2.5 / 10.8
}

# Forced-induction tier slots. The TYPE is bought in Body Kits and Conversions > Aspiration, the
# TIER in Upgrade Shop > Engine > <that type> (spec 9.1). Order below is List_Aspiration's own
# AspirationID order, which is the order spec 10.7 read off the NSX-R's Aspiration menu.
FI_SLOTS = ["single_turbo", "twin_turbo", "quad_turbo", "pos_supercharger",
            "centrifugal_supercharger"]
ASPIRATION_TYPE_ID = 57            # UpgradeTypes 'Aspiration'
ASPIRATION_DISPLAY_ORDER = 30      # its DisplayOrder inside Body Kits and Conversions

# Rim Style is three tiles in Tires and Rims, not one: UpgradeTypes 30 'Rim Style' (both wheels,
# DisplayOrder 40), 31 'Front Rim Style' (42) and 32 'Rear Rim Style' (44). The container has only
# two rim fields, so ref_slot knows 30 and 32; 31 is added here from the same string table. This is
# what fills spec 2.4's unnamed tile 4 (the "stack-of-bare-rim-barrels" icon = rim_style_Icon_all).
RIM_MENUS = [(30, 40, "rim_style"), (31, 42, "rim_style"), (32, 44, "rear_rim_style")]

# Slots the shop sells but the container does not gate by tile count.
ALWAYS_SHOW = set()

# index scheme per slot (spec 9.5): conversions by POSITION, tiers by NAME.
CONVERSION_SLOTS = {"engine", "drivetrain", "car_body", "motor"}
SIZE_SLOTS = {"front_tire_width", "rear_tire_width", "front_rim_size", "rear_rim_size",
              "front_track_width", "rear_track_width", "front_tire_profile", "rear_tire_profile"}
DENSE_IN_VARIANT = {"roll_cage", "weight_reduction"}
RIM_SLOTS = {"rim_style", "rear_rim_style"}

ENGINE_INTERNALS = {"intake", "manifold", "fuel_system", "ignition", "exhaust", "camshaft",
                    "valves", "displacement", "pistons", "oil_cooling", "flywheel",
                    "restrictor_plate", "intercooler"} | set(FI_SLOTS)

# Engine-family menus whose title changes with the block (UpgradeTypes rows flagged IsException,
# each carrying its own "Only for ..." description).
ENGINE_TITLE_OVERRIDE = {"camshaft": [("Rotary", 49)],
                         "fuel_system": [("Diesel", 44), ("Carbureted", 45)]}


def lb(kg):
    return None if kg is None else round(kg * KG_LB, 1)


# ---------------------------------------------------------------------------
# strings
# ---------------------------------------------------------------------------
def load_strings(cx, table):
    """{key_name: content} for one of the game's string tables, as imported into ref_string."""
    return {r["key_name"]: r["content"] for r in cx.execute(
        "SELECT key_name, content FROM ref_string WHERE table_name = ? AND key_name IS NOT NULL",
        (table,))}


# ---------------------------------------------------------------------------
# measured shop-preview effects (data/parts-effects.json)
# ---------------------------------------------------------------------------
def load_effects(cx):
    """{(ordinal, part name): 'POWER +N hp'} from the measured captures. Only three cars have any;
    an entry whose car cannot be matched to an ordinal is skipped rather than guessed at."""
    path = os.path.join(DATA, "parts-effects.json")
    try:
        with open(path, encoding="utf-8") as fh:
            j = json.load(fh)
    except Exception:                                                  # noqa: BLE001
        return {}, []
    cars = [(r["ordinal"], (r["full_name"] or "").lower()) for r in cx.execute(
        "SELECT ordinal, full_name FROM ref_car")]
    out, unmatched = {}, []
    for eng in j.get("engines") or []:
        label = str(eng.get("car") or "")
        toks = [t for t in label.replace("(", " ").replace(")", " ").split() if len(t) > 2]
        hits = [o for o, nm in cars if toks and all(t.lower() in nm for t in toks)]
        if len(hits) != 1:
            unmatched.append(label)
            continue
        for _cat, parts in (eng.get("categories") or {}).items():
            if not isinstance(parts, list):
                continue
            for p in parts:
                if isinstance(p, dict) and p.get("part") and p.get("delta"):
                    d = p["delta"][0]
                    if not isinstance(d, (int, float)):
                        continue
                    out[(hits[0], p["part"])] = "POWER %s%d hp" % ("+" if d >= 0 else "", int(d))
    return out, unmatched


# ---------------------------------------------------------------------------
# context: which key each slot family is read with, for one car
# ---------------------------------------------------------------------------
def context_for(cx, ordinal, container):
    """The keys the shop is drawn with, derived from the parts the save actually carries.

    tune_container.engine_id / drivetrain_id / carbody_id are copies of the ordinal on every row in
    this database, so they are deliberately not used. The engine's identity is the partset shared by
    its internals; the drivetrain's is the set shared by clutch/transmission/driveline/differential;
    the body's is the fitted car_body part id, which IS List_UpgradeCarBody.CarBodyID.
    """
    parts = {r["slot"]: r["part_id"] for r in cx.execute(
        "SELECT slot, part_id FROM tune_part WHERE container = ? AND part_id IS NOT NULL",
        (container,))}
    def setof(slots):
        s = {parts[k] // 1000 for k in slots if parts.get(k) and parts[k] >= 1000}
        return sorted(s)
    eng = setof(ENGINE_INTERNALS - set(FI_SLOTS)) or setof(FI_SLOTS)
    dt = setof({"clutch", "transmission", "driveline", "differential"})
    body = parts.get("car_body")
    if body is None:
        row = cx.execute("SELECT stock_carbody_id FROM ref_car WHERE ordinal = ?", (ordinal,)).fetchone()
        body = row["stock_carbody_id"] if row else None
    fi = [s for s in FI_SLOTS if parts.get(s) is not None]
    return {
        "container": container,
        "engine_key": eng[0] if len(eng) == 1 else (eng[0] if eng else None),
        "engine_keys_seen": eng,
        "drivetrain_key": dt[0] if dt else None,
        "drivetrain_keys_seen": dt,
        "carbody_key": body,
        "motor_key": (parts["motor_parts"] // 1000) if parts.get("motor_parts") else None,
        "body_variant": None,
        "aspiration": fi[0] if len(fi) == 1 else (" + ".join(fi) if fi else None),
        "engine_swap_part": parts.get("engine"),
        "parts": parts,
    }


def key_for(cat, ctx, ordinal):
    return {"Car": ordinal, "Engine": ctx["engine_key"], "Drivetrain": ctx["drivetrain_key"],
            "CarBody": ctx["carbody_key"], "Motor": ctx["motor_key"]}.get(cat)


# ---------------------------------------------------------------------------
# tiles
# ---------------------------------------------------------------------------
_PARTS = {}


def part_index(cx):
    """{(slot, key_id): [row, ...]} -- the whole of ref_part, read once.

    ref_part is WITHOUT ROWID on (slot, part_id), so a per-car "WHERE slot=? AND key_id=?" scans
    every row of that slot: 9,400 such queries cost 3.3 s of the 6.3 s run. One scan of 87k rows
    costs about a tenth of that, and the export is read-only so an index cannot be added instead.
    """
    if "rows" in _PARTS:
        return _PARTS["rows"]
    out = {}
    for r in cx.execute(
            "SELECT slot, part_id, key_id, level, is_stock, name, manufacturer, price, "
            "       mass_diff_kg, tile, tile_count, confidence, data FROM ref_part"):
        out.setdefault((r["slot"], r["key_id"]), []).append(dict(r))
    _PARTS["rows"] = out
    return out


def tiles_for(cx, slot, key, effects, ordinal, car_make):
    """The grid for one (slot, key), in the game's tile order. Stock first (see the module docstring),
    then ref_part's own ranking, which is Upgrades.SortOrder."""
    rows = list(part_index(cx).get((slot, key)) or ())
    if not rows:
        return [], []
    rows.sort(key=lambda r: (0 if r["is_stock"] else 1, r["tile"] or 999, r["part_id"]))

    # weight_reduction carries an ABSOLUTE Mass, not a delta: the delta is against the stock row.
    base_mass = None
    if slot == "weight_reduction":
        for r in rows:
            d = json.loads(r["data"] or "{}")
            if r["is_stock"] and d.get("Mass") is not None:
                base_mass = d["Mass"]
                break

    unlock_kind, unlock_txt = UNLOCK_BANNER.get(slot, (None, None))
    adjustable = set()
    if unlock_kind == "adjustable":
        adjustable = {r["part_id"] for r in cx.execute(
            "SELECT part_id FROM ref_part_slider WHERE slot = ? AND locked = 0", (slot,))}

    out, unknown = [], []
    for i, r in enumerate(rows):
        name = r["name"]
        brand = r["manufacturer"]
        if slot in ("car_body", "rear_wing", "front_bumper", "rear_bumper", "hood", "side_skirts"):
            # spec 5.7: brand parts read '<Brand> - <Part>' ('Honda - Stock Body',
            # 'Rocket Bunny - Widebody Kit', 'Forza Horizon 6 - Race Rear Wing'). A row with no
            # manufacturer, or the placeholder 'Stock', is the car maker's own part.
            b = brand if brand and brand != "Stock" else car_make
            if name and b:
                name = "%s - %s" % (b, name)
        elif slot == "engine" and r["is_stock"]:
            # The swap menu's tile 1 is not the engine's name: spec 2.6 and 10.7 both read
            # 'Stock Powertrain Swap' (Upgrades TypeId 1, Level 0).
            name = "Stock Powertrain Swap"
        d = json.loads(r["data"] or "{}")
        if slot == "tire_compound" and r["is_stock"] and d.get("TireCompoundID") is not None:
            # spec 10.1: tile 1 reads 'Stock Tire Compound (Street)' -- the catalogue row is
            # 'Stock Tire Compound' and the UI appends the fitted compound's own class.
            cr = cx.execute("SELECT name FROM ref_compound WHERE compound_id = ?",
                            (d["TireCompoundID"],)).fetchone()
            cls = (cr["name"] or "").replace(" Tire Compound", "") if cr else ""
            if cls and cls != "Stock":
                name = "%s (%s)" % (name, cls)
        # size grids are named by their measurement, not by the catalogue row (spec 2.4 / 5.7)
        for col, fmt in (("FrontTireWidth", "%d mm Front Tires"), ("RearTireWidth", "%d mm Rear Tires"),
                         ("FrontWheelDiameter", "%d in Front Rims"), ("RearWheelDiameter", "%d in Rear Rims")):
            if d.get(col) is not None:
                name = fmt % int(d[col])
        mass_lb = lb(r["mass_diff_kg"])
        if slot == "weight_reduction" and base_mass is not None and d.get("Mass") is not None:
            mass_lb = lb(d["Mass"] - base_mass)
        t = {
            "pos": i + 1,
            "pid": r["part_id"],
            "level": r["level"],
            "name": name,
            "price": r["price"],
            "stock": bool(r["is_stock"]),
            "mass_lb": mass_lb,
            "effect": effects.get((ordinal, r["name"])),
            "unlock": None,
            "conf": r["confidence"],
        }
        if brand:
            t["brand"] = brand
        if unlock_txt:
            hit = (unlock_kind == "nonstock" and not r["is_stock"]) or \
                  (unlock_kind == "race" and str(r["name"] or "").startswith("Race")) or \
                  (unlock_kind == "adjustable" and r["part_id"] in adjustable)
            if hit:
                t["unlock"] = unlock_txt
        if unlock_kind == "adjustable":
            t["adjustable"] = r["part_id"] in adjustable
        if name is None:
            t["unknown"] = True
            unknown.append("%s tile %d (part %s): the catalogue has no name for it"
                           % (slot, i + 1, r["part_id"]))
        out.append(t)

    # Intercooler: the catalogue sells Street/Sport/Race with no stock row on a naturally aspirated
    # block, yet the menu shows FOUR tiles (spec 10.5) and the clone save holds intercooler = EMPTY.
    # The missing tile is that empty state, drawn first like every other stock tile.
    if slot == "intercooler" and not any(t["stock"] for t in out):
        out.insert(0, {"pos": 1, "pid": None, "level": None, "name": "Stock Intercooler",
                       "price": 0, "stock": True, "mass_lb": 0.0, "effect": None, "unlock": None,
                       "conf": "derived", "empty_state": True,
                       "basis": "spec 10.5: the menu shows 4 tiles for 3 catalogue rows and the "
                                "save's empty value is the installed one; name from Upgrades "
                                "(TypeId 11, Level 0)"})
        for i, t in enumerate(out):
            t["pos"] = i + 1
    return out, unknown


def aspiration_tiles(cx, ctx, engine_row, type_names):
    """The Body Kits and Conversions > Aspiration grid: the stock state plus one tile per
    forced-induction family the fitted block has parts for, in List_Aspiration order. On the NSX-R
    that is Stock - Naturally Aspirated / Twin Turbo / Positive Displacement Supercharger /
    Centrifugal Supercharger and no Single Turbo, which is spec 10.7 exactly."""
    ek = ctx["engine_key"]
    stock_asp = None
    if engine_row and engine_row["data"]:
        stock_asp = json.loads(engine_row["data"]).get("AspirationID_Stock")
    tiles, unknown = [], []
    if stock_asp == 1:
        nm, conf = "Stock - Naturally Aspirated", "proven"      # spec 10.7, verbatim
    elif stock_asp:
        nm, conf = None, "unknown"
    else:
        nm, conf = None, "unknown"
    tiles.append({"pos": 1, "pid": None, "level": None, "name": nm, "price": 0, "stock": True,
                  "mass_lb": None, "effect": None, "unlock": None, "conf": conf,
                  "slot": None, "basis": "AspirationID_Stock = %s" % stock_asp})
    if nm is None:
        tiles[0]["unknown"] = True
        unknown.append("aspiration tile 1: the block's stock aspiration is %s and no capture has "
                       "shown what that tile reads" % stock_asp)
    for s in FI_SLOTS:
        fam = part_index(cx).get((s, ek)) or []
        if not fam:
            continue
        rows = {"n": len(fam), "p": min((r["price"] for r in fam if r["price"] is not None),
                                        default=None)}
        tid = cx.execute("SELECT upgrade_type_id FROM ref_slot WHERE slot = ?", (s,)).fetchone()
        nm2 = type_names.get("IDS_Name_%d" % tid["upgrade_type_id"]) if tid and tid["upgrade_type_id"] else None
        tiles.append({"pos": len(tiles) + 1, "pid": None, "level": None, "name": nm2,
                      "price": rows["p"], "stock": False, "mass_lb": None, "effect": None,
                      "unlock": None, "conf": "derived", "slot": s,
                      "basis": "the block has %d %s parts; the conversion's own price is the "
                               "entry tier's" % (rows["n"], s)})
    return tiles, unknown


# ---------------------------------------------------------------------------
# rims
# ---------------------------------------------------------------------------
_RIMS = {}


def rim_catalogue(cx):
    """The Rim Style catalogue, built once per run.

    Returns (brands, full). `brands` is the compact form that goes into every car file -- the shape
    the data contract asks for, four fields per rim. `full` is the same catalogue with the menu's
    own paging (category, rank, row/col) and is written once, to options/_rims.json, because the
    catalogue is identical on every car and inlining the paging 165 times costs 17 MB for nothing.
    """
    if "cat" in _RIMS:
        return _RIMS["cat"]
    cats = {r["category_id"]: dict(r) for r in cx.execute("SELECT * FROM ref_wheel_category")}
    brands, full = {}, {}
    for r in cx.execute("""SELECT wheel_id, name, manufacturer, full_name, mass_level, price,
                                  category_id, display_order, tile_row, tile_col
                           FROM ref_wheel WHERE is_stock = 0 AND name IS NOT NULL
                           ORDER BY category_id, display_order, wheel_id"""):
        b = r["manufacturer"] or "(no brand)"
        brands.setdefault(b, []).append({
            "pid": r["wheel_id"], "name": r["name"],
            "mass_level": r["mass_level"], "mass_lb": None,
        })
        full.setdefault(b, []).append({
            "pid": r["wheel_id"], "name": r["name"], "full_name": r["full_name"],
            "mass_level": r["mass_level"], "mass_lb": None, "price": r["price"],
            "category": (cats.get(r["category_id"]) or {}).get("name"),
            "page_rank": r["display_order"], "row": r["tile_row"], "col": r["tile_col"],
        })
    out = ([{"brand": b, "rims": v} for b, v in sorted(brands.items())],
           [{"brand": b, "rims": v} for b, v in sorted(full.items())])
    _RIMS["cat"] = out
    return out


# ---------------------------------------------------------------------------
# the export
# ---------------------------------------------------------------------------
def index_scheme(slots):
    sch = {}
    for s in slots:
        if s == "aspiration":
            # the save has no aspiration field: the TYPE is encoded by which forced-induction
            # tier slot is populated (spec 9.1), so there is no index to map at all
            sch[s] = "type_by_populated_slot"
        elif s in CONVERSION_SLOTS:
            sch[s] = "position"
        elif s in RIM_SLOTS:
            sch[s] = "catalogue_id"
        elif s in SIZE_SLOTS:
            sch[s] = "dense"
        elif s in DENSE_IN_VARIANT:
            sch[s] = "dense_in_variant"
        elif s in ("front_bumper", "rear_bumper", "hood", "side_skirts", "rear_wing"):
            sch[s] = "manifest"
        else:
            sch[s] = "ladder"
    return sch


def build_car(cx, ordinal, meta, effects):
    car = cx.execute("SELECT ordinal, full_name, make, model, year, class, pi, stock_wheel_id, "
                     "stock_wheel_level FROM ref_car WHERE ordinal = ?", (ordinal,)).fetchone()
    if car is None:
        return None
    conts = [dict(r) for r in cx.execute(
        "SELECT container, tune_name, saved_utc, source, locked FROM tune_container "
        "WHERE ordinal = ? ORDER BY saved_utc DESC", (ordinal,))]
    if not conts:
        return None
    ctx = context_for(cx, ordinal, conts[0]["container"])
    body_row = cx.execute("SELECT variant FROM ref_car_body WHERE carbody_id = ?",
                          (ctx["carbody_key"],)).fetchone()
    ctx["body_variant"] = body_row["variant"] if body_row else None
    engine_row = cx.execute("SELECT engine_id, name, data FROM ref_engine WHERE engine_id = ?",
                            (ctx["engine_key"],)).fetchone()
    ctx["engine_name"] = engine_row["name"] if engine_row else None
    edata = json.loads(engine_row["data"]) if (engine_row and engine_row["data"]) else {}
    has_fi = ctx["aspiration"] is not None
    n_bodies = len(part_index(cx).get(("car_body", ordinal)) or ())

    unknown, hidden, areas = [], [], {}
    slot_kinds = []
    for s in meta["slots"]:
        slot, cat = s["slot"], s["category"]
        if not s["in_upgrade_shop"] or s["menu_area"] is None:
            continue
        if slot in RIM_SLOTS:
            continue                                  # handled by RIM_MENUS below
        key = key_for(cat, ctx, ordinal)
        if cat and key is None:
            continue
        tiles, unk = tiles_for(cx, slot, key, effects, ordinal, car["make"])
        if len(tiles) < 2 and slot not in ALWAYS_SHOW:
            if tiles:
                why = ("a body kit is fitted; the Front Bumper tile disappears (spec 2.5 / 10.7)"
                       if (slot == "front_bumper" and ctx["body_variant"]) else
                       "one tile only: nothing to buy, so the game draws no tile for it "
                       "(spec 10.3: the NSX-R has no Clutch tile)")
                hidden.append({"slot": slot, "area": s["menu_area"], "tiles": len(tiles),
                               "removed_by_body_kit": bool(slot == "front_bumper" and ctx["body_variant"]),
                               "why": why})
            continue
        slot_kinds.append(slot)
        title = meta["type_name"].get("IDS_Name_%d" % (s["upgrade_type_id"] or -1))
        for flag, alt_tid in ENGINE_TITLE_OVERRIDE.get(slot, []):
            if edata.get(flag):
                title = meta["type_name"].get("IDS_Name_%d" % alt_tid, title)
        desc = meta["type_desc"].get("IDS_Description_%d" % (s["upgrade_type_id"] or -1))
        req, shown, why = None, True, None
        if slot in FI_SLOTS:
            req, shown = slot, (ctx["aspiration"] == slot)
            why = None if shown else "the %s conversion is not installed (spec 9.1)" % slot
        elif slot == "intercooler":
            req, shown = "forced_induction", has_fi
            why = None if shown else "no forced induction fitted (spec 10.5)"
        elif slot == "manifold":
            req, shown = "naturally_aspirated", not has_fi
            why = None if shown else ("UpgradeTypes 40: \"Only available on naturally aspirated "
                                      "engines\"; forced induction is fitted")
        removed = False
        if slot == "front_bumper":
            removed = n_bodies > 1
            if ctx["body_variant"]:
                shown, why = False, "a body kit is fitted; the Front Bumper tile disappears (spec 2.5 / 10.7)"
        a = areas.setdefault(s["menu_area_order"], [])
        a.append({"slot": slot, "title": title, "tile_label": title, "desc": desc,
                  "menu_order": s["menu_order"], "requires_aspiration": req,
                  "removed_by_body_kit": removed, "shown_in_context": shown, "hidden_because": why,
                  "key_id": key, "tile_count": len(tiles), "tiles": tiles})
        unknown.extend(unk)

    # --- Aspiration: a conversion menu with no container slot of its own -------------------
    if ctx["engine_key"] is not None:
        atiles, aunk = aspiration_tiles(cx, ctx, engine_row, meta["type_name"])
        if len(atiles) > 1:
            areas.setdefault(8, []).append({
                "slot": "aspiration", "title": meta["type_name"].get("IDS_Name_57"),
                "tile_label": meta["type_name"].get("IDS_Name_57"),
                "desc": meta["type_desc"].get("IDS_Description_57"),
                "menu_order": ASPIRATION_DISPLAY_ORDER, "requires_aspiration": None,
                "removed_by_body_kit": False, "shown_in_context": True, "hidden_because": None,
                "key_id": ctx["engine_key"], "tile_count": len(atiles), "tiles": atiles,
                "note": "picks the forced-induction TYPE; the TIER is bought in Upgrade Shop > "
                        "Engine > <that type> (spec 9.1)"})
            unknown.extend(aunk)
            slot_kinds.append("aspiration")

    # --- the three Rim Style tiles --------------------------------------------------------
    rims, _full = rim_catalogue(cx)
    n_rims = sum(len(b["rims"]) for b in rims)
    for tid, order, container_slot in RIM_MENUS:
        areas.setdefault(4, []).append({
            "slot": container_slot, "rim_menu_type": tid,
            "title": meta["type_name"].get("IDS_Name_%d" % tid),
            "tile_label": meta["type_name"].get("IDS_Name_%d" % tid),
            "desc": meta["type_desc"].get("IDS_Description_%d" % tid),
            "menu_order": order, "requires_aspiration": None, "removed_by_body_kit": False,
            "shown_in_context": True, "hidden_because": None, "key_id": None,
            "tile_count": n_rims + 1, "tiles": [],
            "note": "paged grid; the tiles are in \"rims\" (a rim is a weight class, spec 10.6). "
                    "Tile 1 is this car's stock rim, wheel id %s (mass level %s)."
                    % (car["stock_wheel_id"], car["stock_wheel_level"])})
    slot_kinds.extend(sorted(RIM_SLOTS))

    # --- assemble the 3x2 root ------------------------------------------------------------
    # The root is a FIXED grid: the same six areas in the same places on every car (spec 2). An
    # area with nothing to buy is still emitted, empty, so that Body Kits and Conversions is tile 6
    # on a car whose Aero and Appearance sells nothing, not tile 5.
    root = [a for a in meta["areas"] if a != 9] + ([9] if 9 in areas else [])
    shop = []
    for pos, aid in enumerate(root, start=1):
        menus = sorted(areas.get(aid, []), key=lambda m: (m["menu_order"], m["slot"]))
        # forced-induction tier menus share one DisplayOrder: they are one grid cell, mutually
        # exclusive, so they must not each consume a position.
        cell, last_order = 0, None
        for m in menus:
            if m["shown_in_context"]:
                if m["menu_order"] != last_order:
                    cell += 1
                    last_order = m["menu_order"]
                m["pos"] = cell
            else:
                m["pos"] = None
        shop.append({
            "area": meta["area_name"].get("IDS_Name_%d" % aid) or ("area %d" % aid),
            "area_id": aid, "pos": pos,
            "desc": meta["area_desc"].get("IDS_Description_%d" % aid) or None,
            "tile_count": cell,
            "menus": menus,
        })

    return {
        "ordinal": ordinal,
        "name": car["full_name"],
        "class": car["class"],
        "stock_pi": car["pi"],
        "generated": fh6db.utcnow(),
        "context": {k: ctx[k] for k in ("container", "engine_key", "engine_name",
                                        "drivetrain_key", "carbody_key", "body_variant",
                                        "aspiration", "engine_swap_part")},
        "context_note": "the grids are the ones this car shows with the hardware of the save named "
                        "above; a different engine, drivetrain set or body kit draws different "
                        "grids (spec 2.1 / 9.1 / 10.7)",
        "containers": [{"container": c["container"], "name": c["tune_name"],
                        "saved": c["saved_utc"], "source": c["source"], "locked": c["locked"]}
                       for c in conts],
        "shop": shop,
        "rims": {"stock_wheel_id": car["stock_wheel_id"],
                 "stock_mass_level": car["stock_wheel_level"],
                 "mass_lb_note": "a rim changes weight only; the lb per mass_level step is a "
                                 "property of the CAR, not of the rim (spec 10.6), so mass_lb is "
                                 "left null rather than invented",
                 "paging": "_rims.json",
                 "brands": rims},
        "index_scheme": index_scheme(sorted(set(slot_kinds))),
        "hidden": hidden,
        "unknown": unknown,
    }


def load_meta(cx):
    return {
        "slots": [dict(r) for r in cx.execute(
            "SELECT slot, category, upgrade_type_id, menu_area, menu_area_order, menu_order, "
            "       in_upgrade_shop, is_visual FROM ref_slot ORDER BY menu_area_order, menu_order")],
        "area_name": load_strings(cx, "UpgradeAreas"),
        "area_desc": load_strings(cx, "UpgradeAreas"),
        "type_name": load_strings(cx, "UpgradeTypes"),
        "type_desc": load_strings(cx, "UpgradeTypes"),
        # UpgradeAreas ids 1,2,3,4,5,8 -- sorted, that is the Upgrade Shop's 3x2 grid (spec 2).
        # 9 (Motor and Battery) only exists on EVs and is appended per car when it has menus.
        "areas": sorted({r["menu_area_order"] for r in cx.execute(
            "SELECT DISTINCT menu_area_order FROM ref_slot "
            "WHERE in_upgrade_shop = 1 AND menu_area_order IS NOT NULL")}),
    }


def export(cx, out, ordinals=None, quiet=False):
    os.makedirs(out, exist_ok=True)
    meta = load_meta(cx)
    effects, unmatched = load_effects(cx)
    _compact, full_rims = rim_catalogue(cx)
    with open(os.path.join(out, "_rims.json"), "w", encoding="utf-8") as fh:
        json.dump({"generated": fh6db.utcnow(),
                   "note": "the Rim Style catalogue with the menu's own paging (category, rank, "
                           "row/col). Identical on every car -- each car file carries the compact "
                           "four-field form and points here for the paging.",
                   "brands": full_rims}, fh, separators=(",", ":"), ensure_ascii=False)
    if ordinals is None:
        ordinals = [r["ordinal"] for r in cx.execute(
            "SELECT DISTINCT ordinal FROM tune_container ORDER BY ordinal")]
    n, bytes_out, n_unknown, n_menus, n_hidden = 0, 0, 0, 0, 0
    for o in ordinals:
        doc = build_car(cx, o, meta, effects)
        if doc is None:
            continue
        blob = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
        with open(os.path.join(out, "%d.json" % o), "w", encoding="utf-8") as fh:
            fh.write(blob)
        n += 1
        bytes_out += len(blob.encode("utf-8"))
        n_unknown += len(doc["unknown"])
        n_hidden += len(doc["hidden"])
        n_menus += sum(len(a["menus"]) for a in doc["shop"])
    if not quiet:
        print("  options: %d cars, %d menus, %d unknown tiles, %d single-tile menus hidden, %.1f MB"
              % (n, n_menus, n_unknown, n_hidden, bytes_out / 1048576.0))
        if unmatched:
            print("  options: parts-effects entries with no ordinal match: %s" % ", ".join(unmatched))
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--ordinal", type=int, action="append",
                    help="export one car (repeatable); default is every car with a save")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db, ro=True)
    t0 = time.time()
    n = export(cx, a.out, a.ordinal, a.quiet)
    if not a.quiet:
        print("wrote %d option files under %s in %.2fs" % (n, a.out, time.time() - t0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
