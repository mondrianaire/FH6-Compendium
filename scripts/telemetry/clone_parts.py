#!/usr/bin/env python3
"""Clone shopping list: the PARTS diff between a target tune and a stock (or part-built) car.

The workflow this serves: two identical cars, one carrying a downloaded tune, one stock. You copy the
target's hardware onto the stock car, then tune the sliders yourself. So this tool deliberately ignores
slider values -- only the 50-slot parts array matters.

Both cars share an ordinal, so the diff is byte-exact: no inference, no telemetry, no test battery.

Rows are grouped and ordered like the in-game upgrade menus (docs/fh6-ui-spec.md section 2), because
that is the order you actually walk the shop in.

HONESTY: every instruction is graded per (slot, index) from data/part-names.json, the per-car tile
maps (data/*-ladder-nsxr.json), the game's own per-car option lists (data/car-option-lists.json, from
each car's Manifest.xml) and this car's stored tunes, at run time. A proven name is printed as 'the
tile named X'; a proven per-car tile as 'tile T of N'; a visual slot as 'option R of M (manifest)';
a roll cage / weight reduction tile is NAMED only by this car's tile count (Stock/Sport/Race on three
tiles, Stock/Street/Sport/Race on four), never by the NSX-R's names; anything else says 'tile unknown:
identify by effect'. You are never told a name or a tile number that the data has not earned. The
INDEX is byte-exact either way.

Hood, side skirts and rear bumper are not Upgrade Shop tiles but they ARE purchases (Paint and
Customize, menu path unverified) unless they sit at the kit's own stock (variant N, tier 0).

Defaults: --target is the newest DOWNLOADED (locked) container; --source is the newest self-made save
newer than it (the replica's latest state), else the replica is modelled as fully stock.

READ-ONLY: never writes to the game save.
"""
import argparse, glob, io, json, os, re, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fh6_tune_decode as T

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "..", "data"))

# Menu grouping + order, from docs/fh6-ui-spec.md section 2. Each row is (slot, sub-menu name).
#
# There is deliberately NO confidence column any more. The old third field (proven/group/guess) was a
# hand-maintained constant that went stale the moment a capture session proved a slot: the 2026-09-02
# NSX-R session proved every Platform and Handling and Drivetrain tile while this table still called
# weight_reduction a "guess" and transmission a "group". Confidence is now derived per (slot, index)
# from data/part-names.json and the per-car tile maps at run time (pick_for): a proven named row or a
# proven tile is PROVEN, a catalogue row is DERIVED, anything else is UNKNOWN. It can only be as stale
# as the data file.
#
# "aspiration" and "quad_turbo" are never populated in any stored tune (real aspiration lives in the
# mutually-exclusive single_turbo/twin_turbo/centrifugal/pos slots); "motor"/"motor_parts" appear
# only in the 13 EV tunes, the exact 13 that carry no engine family.
PROVEN, DERIVED, UNKNOWN, READ = "proven", "derived", "unknown", "read"
MENUS = [
    ("Body Kits and Conversions", [
        ("engine", "Engine Swap"), ("drivetrain", "Drivetrain Swap"), ("car_body", "Body Kit"),
        # EV slots. No capture has ever shown the menu that sells these. The catalogue rows read
        # 'Stock Motor and Battery Swap' (314) and 'Stock..Race Motor and Battery Parts' (259-262),
        # i.e. a conversion plus its tiers, so they sit here with a 'menu unverified' warning.
        ("motor", "Motor and Battery Swap (EV)"), ("motor_parts", "Motor and Battery Parts (EV)")]),
    ("Engine", [
        ("intake", "Intake"), ("manifold", "Intake Manifold"),
        ("fuel_system", "Fuel System"), ("ignition", "Ignition"),
        ("exhaust", "Exhaust"), ("camshaft", "Camshaft"),
        ("valves", "Valves"), ("displacement", "Displacement"),
        ("pistons", "Pistons / Compression"), ("oil_cooling", "Oil / Cooling"),
        ("flywheel", "Flywheel"), ("restrictor_plate", "Restrictor Plate"),
        ("single_turbo", "Single Turbo"), ("twin_turbo", "Twin Turbo"), ("quad_turbo", "Quad Turbo"),
        ("centrifugal_supercharger", "Centrifugal Supercharger"),
        ("pos_supercharger", "Positive-Displacement Supercharger"),
        ("intercooler", "Intercooler")]),
    ("Platform and Handling", [
        ("brakes", "Brakes"), ("springs_dampers", "Spring and Dampers"),
        ("front_arb", "Front Anti-roll Bars"), ("rear_arb", "Rear Anti-roll Bars"),
        ("roll_cage", "Chassis Reinforcement / Roll Cage"),
        ("weight_reduction", "Weight Reduction")]),
    ("Drivetrain", [
        ("clutch", "Clutch"), ("transmission", "Transmission"),
        ("driveline", "Driveline"), ("differential", "Differential")]),
    ("Tires and Rims", [
        ("tire_compound", "Tire Compound"),
        ("front_tire_width", "Front Tire Width"), ("rear_tire_width", "Rear Tire Width"),
        ("front_tire_profile", "Front Tire Profile"), ("rear_tire_profile", "Rear Tire Profile"),
        ("front_track_width", "Front Track Width"), ("rear_track_width", "Rear Track Width"),
        ("front_rim_size", "Front Rim Size"), ("rear_rim_size", "Rear Rim Size"),
        ("rim_style", "Rim Style"), ("rear_rim_style", "Rear Rim Style")]),
    # Front Bumper IS a purchasable tile (spec 2.5 / 10.7): present on the stock car, removed while a
    # body kit is fitted, restored when the kit comes off. The slot keeps its value under the kit, so
    # a build carrying both was bought bumper first, kit second -- build() schedules it that way.
    ("Aero and Appearance", [
        ("front_bumper", "Front Bumper"), ("rear_wing", "Rear Wing")]),
]
MENU_OF = {slot: menu for menu, items in MENUS for slot, _ in items}
ITEM_OF = {slot: item for _, items in MENUS for slot, item in items}

# How each slot is PICKED in the shop. Established per slot and recorded (data/part-names.json and
# data/part-index-vocabulary.json 'scheme_must_be_established_per_slot'); never inferred from menu shape.
RIM_SLOTS = {"rim_style", "rear_rim_style"}       # flat catalogue ids, no partset: NEVER digit-split
SIZE_SLOTS = {"front_tire_width", "rear_tire_width", "front_rim_size", "rear_rim_size",
              "front_track_width", "rear_track_width", "front_tire_profile", "rear_tire_profile"}
EV_SLOTS = {"motor", "motor_parts"}
CONVERSION_SLOTS = {"engine", "drivetrain", "car_body"}   # never "auto": car_body 100 IS the purchase
DENSE_IN_VARIANT = {"roll_cage", "weight_reduction"}      # index = variant*100 + tile; NAME depends on the tile count
PER_CAR_NAMED = {"engine", "rear_wing"}                   # names live in named.<slot>._per_car[ordinal]
DRIVETRAIN_SLOTS = {"transmission", "differential", "driveline", "clutch"}
SWAPPED_DRIVETRAIN_SET = 2102   # every proven Drivetrain ladder was captured on this set (part-names.json drivetrain_partset_caveat)

# Dense-in-variant menus (Chassis Reinforcement / Roll Cage, Weight Reduction) are named by TILE COUNT,
# not by the NSX-R's names: 412100/101/102 = Stock/Sport/Race holds on a THREE-tile menu only. A car that
# sells a Street tier has four tiles and the same tier digit means a different tile name. The count is
# read per car (captured menu > stored tunes > Manifest.xml); a count from the corpus or the manifest is
# a LOWER bound and the name it selects is printed as derived, never proven.
VARIANT_LADDERS = {3: ["Stock", "Sport", "Race"], 4: ["Stock", "Street", "Sport", "Race"]}

# Visual slots whose option list comes from the game's own Manifest.xml (data/car-option-lists.json):
# the tile is the RANK of the target id inside the car's list for that body variant, which also covers
# non-dense lists (a kit-variant bumper list of 100/101/103 puts 103 on tile 3, not 4).
VISUAL_SLOTS = {"car_body", "rear_wing", "front_bumper", "rear_bumper", "hood", "side_skirts"}

# Hood, side skirts and rear bumper are not Upgrade Shop tiles, but they ARE purchases: a target whose
# value is not the kit's own stock for its body variant (variant N, tier 0) chose one. They are emitted
# under Paint and Customize with the manifest rank; the menu path itself has never been captured.
CUSTOMIZE_SLOTS = {"hood": "Front Customization", "side_skirts": "Side Customization",
                   "rear_bumper": "Back Customization"}
CUSTOMIZE_MENU = "Paint and Customize"
CUSTOMIZE_ITEM = {"hood": "Hood", "side_skirts": "Side Skirts", "rear_bumper": "Rear Bumper"}

# Size ladders proven tile-by-tile on the NSX-R clone frames (part-names.json size_slots._scheme); the
# other size slots follow the same dense rule by construction and print as derived.
SIZE_PROVEN = {(412, "rear_tire_width"), (412, "rear_rim_size"), (412, "front_rim_size")}
ENGINE_INTERNALS = {"camshaft", "valves", "displacement", "pistons", "fuel_system", "ignition",
                    "exhaust", "intake", "flywheel", "oil_cooling", "manifold", "restrictor_plate"}

# Forced induction is TWO steps, and conflating them sent a real clone attempt to the wrong menu:
#   1. Body Kits and Conversions > Aspiration  picks the TYPE (turbo / centrifugal / roots ...)
#   2. Upgrade Shop > Engine > <that type>     sells the TIER of it
# The save stores only the tier, in the slot named for the type -- so the TYPE is encoded by WHICH of
# these slots is populated, which is why the "aspiration" slot itself is empty in all 532 tunes.
# Until the conversion is installed the Engine menu has no such sub-menu at all, so this must be
# ordered before the Engine section.
ASPIRATION_SLOTS = {
    "single_turbo": "Single Turbo", "twin_turbo": "Twin Turbo", "quad_turbo": "Quad Turbo",
    "centrifugal_supercharger": "Centrifugal Supercharger",
    "pos_supercharger": "Positive-Displacement Supercharger",
}


def aspiration_type(parts):
    """Which forced-induction conversion is fitted, from which slot is populated. None = NA."""
    got = [ASPIRATION_SLOTS[k] for k in ASPIRATION_SLOTS if parts.get(k) is not None]
    return got[0] if len(got) == 1 else (" + ".join(got) if got else None)

# INSTALL ORDER. Not the same as the shop's own tile order, and the difference matters:
# docs/fh6-ui-spec.md 2.9 -- "Conversions affect the upgrades that are available in other categories",
# and 5.9 records two observed cases (the Rocket Bunny kit REMOVES the Front Bumper tile; the Front
# Tire Width grid grew 4 -> 7 tiles after the widebody/rim change). Our own decode shows the same
# thing numerically: body-dependent parts carry a variant in the hundreds digit that tracks car_body
# exactly, 532/532. So conversions must go in FIRST or the tiles you are shopping for do not exist yet.
# Engine internals go second because they belong to the engine block, not the car (519/519 carry the
# ENGINE's partset), so swapping the engine afterwards would discard them.
INSTALL_ORDER = ["Pre-conversion", "Body Kits and Conversions", "Engine", "Drivetrain",
                 "Platform and Handling", "Tires and Rims", "Aero and Appearance", CUSTOMIZE_MENU]

# Conversions do not only ADD tiles -- the widebody REMOVES the Front Bumper tile (spec 2.5/5.9), and
# the reasoning above only covered the adding case, so the route scheduled the bumper straight into a
# menu that no longer had it. A shop row whose target sits in variant 0, in a menu a fitted conversion
# prunes, must be bought FIRST. The kit's own re-stamp looks different (variant N, tier 0) and is
# already handled as "auto", so this only fires on a genuine pre-kit purchase.
PRUNED_BY_BODY_KIT = {"front_bumper"}

# Two index schemes share one field (docs/fh6-ui-spec.md 9.5). Conversions are per-car lists whose
# index IS the 0-based tile position -- the NSX-R Drivetrain Swap menu has 2 tiles and the target
# index is 1, the 2nd tile. Tier slots use the sparse GLOBAL ladder, where the index can exceed the
# tile count (index 3 in a 2-tile anti-roll-bar menu). Match conversions by POSITION, tiers by NAME.
# weight_reduction and rear_wing are dense too -- established by a completed clone and by this car
# using all three rear-wing indexes against a 3-tile menu. NOTE that brakes has an IDENTICAL 3-tile
# menu (Stock/Sport/Race) and is SPARSE: its Race decodes as index 3, impossible if dense. Menu
# shape does not predict the scheme -- it has to be established per slot and recorded.
def dense_slots():
    """Slots whose index IS the 0-based tile position. Read from data/part-names.json (dense_slots.slots)
    plus roll_cage (dense inside the body variant: 412100/101/102 = tiles 1/2/3, data/platform-ladder-
    nsxr.json), front_bumper (tile = idx + 1, spec 10.7) and motor (a dense conversion slot with per-car
    names, part-names.json named.motor: the catalogue must never name it). Anything not here and not on
    the ladder is UNKNOWN and is printed as such -- never as either scheme."""
    j = _load(os.path.join(DATA, "part-names.json")) or {}
    return set(((j.get("dense_slots") or {}).get("slots") or [])) | {"roll_cage", "front_bumper", "motor"}


# Upgrade Shop tile number for each category (docs/fh6-ui-spec.md 2, the 3x2 grid). Universal.
SHOP_TILE = {"Engine": 1, "Platform and Handling": 2, "Drivetrain": 3,
             "Tires and Rims": 4, "Aero and Appearance": 5, "Body Kits and Conversions": 6}

# CATEGORY GRIDS: which tile of a category a sub-menu sits on. Every grid below was read on ONE car,
# the 1992 Honda NSX-R (ordinal 412), so they are keyed by that ordinal and print '?' with an NSX-R
# hint for any other car. The Engine grid is worse: its length depends on the fitted engine AND the
# aspiration conversion (spec 2.1: 12 tiles stock vs 11 with the V8; 9.1: 8 tiles with no conversion
# vs 12 with the centrifugal supercharger), so it is keyed by (ordinal, engine family, aspiration)
# and never printed from another layout's numbers.
GRID_ORDINAL = 412
_GRID = {
    "Body Kits and Conversions": ["engine", "drivetrain", "_aspiration_conv", "car_body"],        # spec 2.6
    "Platform and Handling": ["brakes", "springs_dampers", "front_arb", "rear_arb",
                              "roll_cage", "weight_reduction"],                                    # spec 2.2 / 10.4
    "Drivetrain": ["transmission", "driveline", "differential"],                                   # spec 2.3 / 10.3: no Clutch tile
    "Tires and Rims": ["tire_compound", "front_tire_width", "rear_tire_width", None,
                       "rim_style", None, "front_rim_size", None],                                 # spec 2.4
}
_GRID_AERO = {False: ["front_bumper", "rear_wing"], True: ["rear_wing"]}                          # spec 2.5 / 10.8, by kit state
_GRID_ENGINE = {
    (412, "166", "Centrifugal Supercharger"): [                                                    # spec 10.4
        "intake", "fuel_system", "ignition", "exhaust", "camshaft", "valves", "displacement",
        "pistons", "centrifugal_supercharger", "intercooler", "oil_cooling", "flywheel"],
}
# Engine SUB-MENU tier -> tile, per (ordinal, engine family). Spec 10.5: on the NSX-R's stock block every
# family sells three tiles Stock/Sport/Race except Intercooler (four), and the installed tiles line up
# with the save ids on the global ladder (cams tile 2 = index 2, pistons/block/exhaust/supercharger
# tile 3 = index 3): the Street tier is absent, not renumbered. Not a rule for other engines -- spec 2.1
# saw a 4-tile Intake with the V8 fitted -- so a layout without a row here prints '?'.
ENGINE_TIER_TILES = {
    (412, "166"): {"_default": ({0: 1, 2: 2, 3: 3}, 3), "intercooler": ({}, 4)},
}


def grid_tile(menu, slot, ordinal, kit=0, fam=None, aspiration=None):
    """(tile, note) for the sub-menu's tile inside its category grid. (None, note) when no table covers
    this car's layout -- the sub-menu NAME is always printed, the number only when earned."""
    o = int(ordinal)
    if menu == "Engine":
        g = _GRID_ENGINE.get((o, str(fam), aspiration))
        if g and slot in g:
            return g.index(slot) + 1, "layout: NSX-R, engine family %s, %s fitted (spec 10.4)" % (fam, aspiration)
        return None, "the Engine grid is engine- and aspiration-specific (spec 2.1 / 9.1): find the tile by its name"
    if menu == "Aero and Appearance":
        g = _GRID_AERO[bool(kit) and slot != "front_bumper"]   # the bumper is bought BEFORE the kit
    else:
        g = _GRID.get(menu)
    if not g or slot not in g:
        return None, ""
    t = g.index(slot) + 1
    if o == GRID_ORDINAL:
        return t, ""
    return None, "NSX-R layout puts it on tile %d; not captured on this car" % t


def engine_tier_tile(ordinal, fam, slot, idx):
    """(tile, tile_count) inside an Engine sub-menu, from ENGINE_TIER_TILES; (None, None) without a table."""
    t = ENGINE_TIER_TILES.get((int(ordinal), str(fam)))
    if not t or idx is None:
        return None, None
    m, n = t.get(slot, t["_default"])
    return m.get(idx), n

_CACHE = {}
_CAT_CACHE = {}


def _load(path, key=None):
    if path not in _CACHE:
        try:
            with open(path, encoding="utf-8") as fh:
                _CACHE[path] = json.load(fh)
        except Exception:
            _CACHE[path] = {}
    j = _CACHE[path]
    return j.get(key) if key else j


def _pn():
    return _load(os.path.join(DATA, "part-names.json")) or {}


def _upgrades():
    """The game's own catalogue (EN.zip Upgrades.str) as {IDS number: name}; {} when the install is absent."""
    U = _CAT_CACHE.get("U")
    if U is None:
        try:
            import fh6_strings as _S
            U = _S.numbered(_S.load("Upgrades"), "IDS_Name")
        except Exception:
            U = {}
        _CAT_CACHE["U"] = U
    return U


def _row_name(row):
    """(name, confidence) from a named row. Bare strings were proven by a saved setup read back from the
    container (2026-09-02 capture session); dicts carry their own confidence. UNKNOWN rows give None."""
    if isinstance(row, str):
        nm = row.strip()
        if nm and not nm.startswith("UNKNOWN"):
            return (nm.split(" (")[0] if nm.startswith("Rally Tire Compound (") else nm), "proven"
    elif isinstance(row, dict) and row.get("name") and not str(row["name"]).startswith("UNKNOWN"):
        return row["name"], row.get("confidence") or "proven"
    return None, None


def _next_base(base):
    """The first catalogue base after this one: a family's rows stop there. Bounding base + tier by it is
    what keeps weight_reduction tier 3 (base 75, three rows) from reading row 78 = 'Stock Tire Compound'."""
    later = [b for b in ((_pn().get("catalogue") or {}).get("bases") or {}).values()
             if isinstance(b, int) and b > base]
    return min(later) if later else base + 4


def resolve_name(slot, idx, pid=None, ordinal=None):
    """Common name for a part, from data/part-names.json -- the ID -> name layer.

    Order: an explicit per-slot row first (by index; by idx % 100 for the dense-in-variant slots; by raw
    id for rims; then the per-car list for engine / rear_wing). DENSE slots stop there -- their index is
    a per-car position and no global row can name it. Ladder slots fall through to the game's catalogue,
    bounded to the family's own rows, then to the tier ladder. Returns (name, confidence) with confidence
    proven / verified / derived, or (None, None). A name is NEVER invented from the number."""
    named = ((_pn().get("named") or {}).get(slot)) or {}
    if slot in DENSE_IN_VARIANT and idx is not None:
        # Named by the CAR'S TILE COUNT (VARIANT_LADDERS), never by the NSX-R's tier digit: a captured
        # ladder row is proven; a count-selected name is derived. Callers without an ordinal (the
        # dashboard passes the raw id) get it from the id, which carries the car's own set.
        if ordinal is None and pid is not None and int(pid) >= 1000:
            ordinal = int(pid) // 1000
        if ordinal is None:
            return None, None
        ent = (tile_maps().get(int(ordinal)) or {}).get(slot) or {}
        if int(idx) in (ent.get("names") or {}):
            return ent["names"][int(idx)], "proven"
        count, _basis, _exact = variant_tile_count(ordinal, slot)
        lad = VARIANT_LADDERS.get(count)
        if lad and idx % 100 < count:
            return "%s %s" % (lad[idx % 100], ITEM_OF.get(slot, slot)), "derived"
        return None, None
    keys = []
    if idx is not None:
        keys.append(str(idx))
    if pid is not None:
        keys.append(str(pid))
    for key in keys:
        nm, conf = _row_name(named.get(key))
        if nm:
            return nm, conf
    if ordinal is not None and idx is not None:
        per = ((named.get("_per_car") or {}).get(str(ordinal))) or {}
        nm, conf = _row_name(per.get(str(idx)))
        if nm:
            return nm, "proven"
    if slot in dense_slots() or slot in RIM_SLOTS or idx is None:
        return None, None
    cat = _pn().get("catalogue") or {}
    tier = idx % 100
    U = _upgrades() if cat else {}
    if U and slot not in ((cat.get("brand_slots") or {}).get("slots") or []):
        pair = (cat.get("pair_families") or {}).get(slot)
        if isinstance(pair, list):
            ids = pair[0] if tier == 0 else pair[1]
            if ids in U:
                return U[ids], "derived"
        pairs = cat.get("verified_pairs") or []
        # Later-added tiers (Rally/Drift/Offroad, the gear-count transmissions) sit at high IDS numbers:
        # explicit map, and only as verified as the file says that map is.
        ext = ((cat.get("extended_tiers") or {}).get(slot) or {}).get(str(tier))
        if ext is not None and ext in U:
            nm = U[ext]
            ec = str((cat.get("extended_confidence") or {}).get(slot) or "")
            return nm, ("verified" if ([slot, tier, nm] in pairs or ec.startswith("verified")) else "derived")
        base = (cat.get("bases") or {}).get(slot)
        if base is not None and tier < 4 and base + tier < _next_base(base) and (base + tier) in U:
            nm = U[base + tier]
            ok = slot in (cat.get("verified_slots") or []) or [slot, tier, nm] in pairs
            return nm, ("verified" if ok else "derived")
    lad = _pn().get("tier_ladder") or {}
    if slot in (lad.get("applies_to") or []):
        nm = lad.get(str(tier))
        if nm:
            return "%s %s" % (nm, _ITEM.get(slot, slot)), "derived"
    return None, None


_ITEM = {"brakes": "Brakes", "front_arb": "Front Anti-roll Bars", "rear_arb": "Rear Anti-roll Bars",
         "springs_dampers": "Spring and Dampers", "differential": "Diff", "clutch": "Clutch",
         "driveline": "Driveline"}

# PER-CAR TILE MAPS. Each row of these files is one saved setup read back from its container, so a
# tile from here is an exact instruction ('tile 8 of 11'), never a count-up of non-stock tiles.
LADDER_FILES = ("tire-compound-ladder-nsxr.json", "transmission-ladder-nsxr.json",
                "drivetrain-ladder-nsxr.json", "platform-ladder-nsxr.json")
_LADDER_LIST_KEYS = {"compounds": "tire_compound", "transmissions": "transmission"}


def tile_maps():
    """{ordinal: {slot: {"tiles": {index: tile}, "names": {index: name}, "count": n}}} from the ladder
    files. The ordinal is read from each file's own 'car' field; list keys map to slots via
    _LADDER_LIST_KEYS, dict entries with a 'tiles' list are keyed by slot already."""
    if "maps" in _CAT_CACHE:
        return _CAT_CACHE["maps"]
    out = {}
    for fn in LADDER_FILES:
        j = _load(os.path.join(DATA, fn)) or {}
        m = re.search(r"ordinal (\d+)", str(j.get("car") or ""))
        if not m:
            continue
        per = out.setdefault(int(m.group(1)), {})
        for key, val in j.items():
            if isinstance(val, list):
                rows, slot = val, _LADDER_LIST_KEYS.get(key, key)
            elif isinstance(val, dict) and isinstance(val.get("tiles"), list):
                rows, slot = val["tiles"], key
            else:
                continue
            ent = per.setdefault(slot, {"tiles": {}, "names": {}, "count": 0})
            for r in rows:
                if isinstance(r, dict) and "tile" in r and "index" in r:
                    ent["tiles"][int(r["index"])] = int(r["tile"])
                    if r.get("name"):
                        ent["names"][int(r["index"])] = r["name"]
            ent["count"] = max([ent["count"]] + list(ent["tiles"].values()))
    _CAT_CACHE["maps"] = out
    return out


def tile_for(ordinal, slot, idx):
    """(tile, tile_count) from the per-car map. (None, count) when the car's map exists but does not
    offer this index; (None, None) when there is no map for the car or slot."""
    ent = (tile_maps().get(int(ordinal)) or {}).get(slot)
    if not ent or idx is None:
        return None, None
    t = ent["tiles"].get(int(idx))
    return (t, ent["count"]) if t else (None, ent["count"])


# PER-CAR OPTION LISTS from the game's own Manifest.xml (data/car-option-lists.json). Each option is
# {id, variant, tier, rank, models}; the list order is the manifest order. roll_cage lists are a LOWER
# bound (a tier without its own mesh is absent: the NSX-R lists 412000/412002 while the shop sells
# Stock/Sport/Race), so they only ever raise a tile count, never fix one.
def car_options(ordinal):
    """{slot: [option, ...]} for the car, or {} when the file has no entry for it."""
    cars = (_load(os.path.join(DATA, "car-option-lists.json")) or {}).get("cars") or {}
    return ((cars.get(str(int(ordinal))) or {}).get("options")) or {}


def manifest_rank(ordinal, slot, idx):
    """(rank, count, in_list, ids) of the target id inside the car's option list. For car_body the whole
    list is the menu (every kit is one tile); for the other visual slots the menu is the list for the
    index's OWN body variant (a pre-kit front bumper sits in variant 0 even under the kit). Returns
    (None, None, None, []) when the car has no list for the slot; (None, count, False, ids) when the
    list exists but the id is not in it."""
    opts = car_options(ordinal).get(slot)
    if not opts or idx is None:
        return None, None, None, []
    if slot == "car_body":
        rows = list(opts)
    else:
        rows = [r for r in opts if int(r.get("variant") or 0) == idx // 100]
    ids = [int(r["id"]) for r in rows if "id" in r]
    pid = int(ordinal) * 1000 + int(idx)
    if pid in ids:
        return ids.index(pid) + 1, len(ids), True, ids
    return None, len(ids), False, ids


_CORPUS = {}


def corpus_parts(ordinal):
    """The parts dict of every stored container of this car (cached per run)."""
    o = int(ordinal)
    if o not in _CORPUS:
        got = []
        for f in containers(o):
            try:
                got.append(T.parse_tune(f).get("parts") or {})
            except Exception:
                continue
        _CORPUS[o] = got
    return _CORPUS[o]


def corpus_tier_max(ordinal, slot):
    """max(index % 100) this slot ever held in a stored tune of the car, across every body variant; None
    when no container populates it."""
    best = None
    for parts in corpus_parts(ordinal):
        _ps, i = split_any(parts.get(slot), ordinal)
        if i is not None:
            best = i % 100 if best is None else max(best, i % 100)
    return best


def variant_tile_count(ordinal, slot):
    """(count, basis, exact): how many tiles this car's dense-in-variant menu (roll cage / weight
    reduction) has. A captured menu (ladder file) is exact. Otherwise the larger of the corpus (highest
    stored tier + 1) and the manifest (highest listed tier + 1) -- both LOWER bounds, because a tier no
    stored tune bought, or a tier without its own mesh, is invisible to them."""
    ent = (tile_maps().get(int(ordinal)) or {}).get(slot)
    if ent and ent.get("count"):
        return ent["count"], "captured menu: %d tiles" % ent["count"], True
    cands = []
    m = corpus_tier_max(ordinal, slot)
    if m is not None:
        cands.append((m + 1, "stored tunes of this car reach tier %d" % m))
    opts = car_options(ordinal).get(slot) or []
    if opts:
        mt = max(int(r.get("tier") or 0) for r in opts)
        cands.append((mt + 1, "the manifest lists tier %d" % mt))
    if not cands:
        return None, "no stored tune or manifest row populates it on this car", False
    count, basis = max(cands)
    return count, "at least %d tiles: %s" % (count, basis), False


def kit_visual_evidence(ordinal, slot, body_pid):
    """{id: n} of a customisation slot over this car's stored tunes wearing the SAME car_body id. A slot
    that every such tune carries at one value was most likely set by the kit itself; one that varies
    was a choice."""
    c = {}
    for parts in corpus_parts(ordinal):
        if parts.get("car_body") != body_pid:
            continue
        v = parts.get(slot)
        if v is not None:
            c[v] = c.get(v, 0) + 1
    return c


def drivetrain_sets(parts, ordinal):
    """The partset(s) the four drivetrain slots carry -- one per container in practice: 2102 on a swapped
    drivetrain, a per-car set on the stock one (part-names.json drivetrain_partset_caveat)."""
    sets = set()
    for k in DRIVETRAIN_SLOTS:
        ps, _i = split_any(parts.get(k), ordinal)
        if ps is not None:
            sets.add(int(ps))
    return sorted(sets)


def size_name(ordinal, slot, idx):
    """(name, tile_count) for a size-grid tile from part-names.json size_slots.nsxr_<ordinal> -- the
    NSX-R tables, keyed by slot and body variant. (None, None) for a car without a table; (None, count)
    when the table has the row but no value for it ('?')."""
    tabs = ((_pn().get("size_slots") or {}).get("nsxr_%d" % int(ordinal))) or {}
    if not tabs:
        return None, None
    var, tier = divmod(int(idx), 100)
    ent = tabs.get("%s_%s" % (slot, "widebody" if var else "stock_body"), tabs.get(slot))
    if isinstance(ent, list):
        raw = ent[tier] if tier < len(ent) else None
        if not raw or str(raw).startswith("?"):
            return None, len(ent)
        val, _sep, rest = str(raw).partition(" (")
        side = "Front" if slot.startswith("front") else "Rear"
        return "%s mm %s Tires%s" % (val, side, (" (" + rest) if rest else ""), len(ent)
    if isinstance(ent, str):
        m = re.match(r"index (\d+) = (.+?) \(tile (\d+)\)", ent)
        if m and int(m.group(1)) == int(idx):
            return m.group(2), None
    return None, None


def tier_name(slot, idx):
    """Name for a tier-slot index, or None.

    Index 0 is deliberately NOT named: data/part-index-vocabulary.json records it as an unresolved
    anomaly (142 tunes read index 0 yet have tuning that index 0 should have left locked, and the
    split is disjoint by car). Naming it 'Stock' would be asserting more than we know."""
    if idx is None or idx == 0:
        return None
    v = _load(os.path.join(DATA, "part-index-vocabulary.json"), "tier_slots") or {}
    return (v.get(slot) or {}).get(str(idx % 100))


def engine_family(parts):
    """The engine's identity in the save is the partset shared by its internals; see
    data/engine-swaps.json ('The engine's identity in the save = the family shared by the engine')."""
    sets = set()
    for k in ENGINE_INTERNALS:
        v = parts.get(k)
        if v is None:
            continue
        s = str(v)
        if len(s) > 3:
            sets.add(s[:-3])
    return list(sets)[0] if len(sets) == 1 else None


def family_label(fam):
    if not fam:
        return None
    f = (_load(os.path.join(DATA, "engine-swaps.json"), "families") or {}).get(str(fam))
    return f.get("label") if f else None


def tune_name(container_dir):
    """The tune's display name, from the sibling `header` file: U32 count at 0x04 (in UTF-16 CHARACTERS,
    not bytes), string from 0x08. 534/534 Tuning headers decode. Reading this would have settled every
    'which container is on the car' question instantly -- the target read 'Top Meta Rival' all along."""
    try:
        h = open(os.path.join(container_dir, "header"), "rb").read()
        n = struct.unpack_from("<I", h, 4)[0]
        return h[8:8 + 2 * n].decode("utf-16-le").rstrip("\x00") if 0 < n < 512 else None
    except Exception:
        return None


# THE PROTOCOL, from the hardware-fingerprint study (90/90 same-hardware pairs verified):
#   identical hardware  <=>  A[0x02:0x04] == B[0x02:0x04]  and  A[0x0E:0x19E] == B[0x0E:0x19E]
# i.e. the car ordinal plus the FULL 100-slot part array -- the 50 named slots AND the 50 reserved ones.
# Comparing only the named 50 is a free false-positive hole. Everything else is excluded on purpose:
#   0x01 locked flag  -- differs between a downloaded target and your own save BY DEFINITION
#   0x019E..          -- sliders and gear ratios, which you set yourself
# NEVER normalise 0xFFFFFFFF (empty) to index 0 before comparing: that would call a naturally-aspirated
# car identical to a factory-turbo one. Empty is a hardware state on 15 conditional slots.
HW_ORD = (0x02, 0x04)
HW_PARTS = (0x0E, 0x19E)


def verify_hardware(path_a, path_b):
    """(verdict, diffs). verdict is MATCH, MATCH (rims differ: ...), DIFFER, DIFFER (different car), or
    CHECK-BY-EYE.

    MATCH (rims differ ...) fires when the ONLY differing slots are rim_style / rear_rim_style: rims are
    a weight class, not hardware (spec 10.6), and the id is a flat catalogue number nobody can shop for
    by name -- the replica needs a rim of the same class, read off the source car. Exit code 0 in --verify.
    CHECK-BY-EYE is the one residual the study could not close: intercooler is the only slot whose
    empty-vs-index-0 state is not determined by the rest of the build, so two hardware-identical cars
    could in principle differ only there. It fires only when intercooler is the sole difference and one
    side is empty."""
    A = open(path_a, "rb").read()
    B = open(path_b, "rb").read()
    if len(A) != 598 or len(B) != 598:
        return "INVALID (not 598 bytes)", []
    ord_eq = A[HW_ORD[0]:HW_ORD[1]] == B[HW_ORD[0]:HW_ORD[1]]
    if A[HW_PARTS[0]:HW_PARTS[1]] == B[HW_PARTS[0]:HW_PARTS[1]] and ord_eq:
        return "MATCH", []
    diffs = []
    for i in range(100):
        off = HW_PARTS[0] + 4 * i
        if A[off:off + 4] != B[off:off + 4]:
            name = T.PARTS[i] if i < len(T.PARTS) else "reserved_%d" % i
            diffs.append((name, struct.unpack_from("<I", A, off)[0], struct.unpack_from("<I", B, off)[0]))
    if not ord_eq:
        return "DIFFER (different car)", diffs
    only_ic = bool(diffs) and all(n == "intercooler" and 0xFFFFFFFF in (x, y) for n, x, y in diffs)
    only_rims = bool(diffs) and all(n in RIM_SLOTS for n, _x, _y in diffs)
    if only_rims:
        return "MATCH (rims differ: same weight class needed; read the source car's installed rim)", diffs
    return ("CHECK-BY-EYE" if only_ic else "DIFFER"), diffs


def containers(ordinal):
    root = T.find_containers_root()
    return sorted(glob.glob(os.path.join(root, "Tuning_%04d_*" % int(ordinal), "Data")),
                  key=os.path.getmtime)


def split_any(pid, ordinal):
    """(partset, index) for ANY part ID, not just this car's own set.

    Engine internals carry the ENGINE's partset and drivetrain parts carry a shared donor set, so
    keying only off the car's ordinal threw away a readable tier on 17 of the 50 slots. The index is
    the last three digits; the partset is what precedes them. Falls back to the ordinal-prefix split
    first so a car whose ordinal happens to end in a digit run is still read the established way."""
    if pid is None:
        return (None, None)
    ps, idx = T.split_part_id(ordinal, pid)
    if idx is not None:
        return (ps, idx)
    s = str(pid)
    if len(s) > 3:
        return (int(s[:-3]), int(s[-3:]))
    return (None, None)


def describe(slot, pid, ordinal):
    """(index, human) for a part ID. Rim ids are flat catalogue numbers and are never split."""
    if pid is None:
        return None, "-"
    if slot in RIM_SLOTS:
        nm, conf = resolve_name(slot, None, pid)
        return None, "rim id %d%s" % (pid, (" = %s" % nm) if nm and conf == "verified" else "")
    ps, idx = split_any(pid, ordinal)
    if idx is None:
        return None, str(pid)
    nm, conf = resolve_name(slot, idx, pid, ordinal)
    if nm is None:
        nm = tier_name(slot, idx)
        conf = None
    var, tier = divmod(idx, 100)
    own = str(ps) == str(ordinal)
    txt = "idx %d" % idx
    if var:
        txt += " (body variant %d, tier %d)" % (var, tier)
    if not own:
        txt += " [set %s]" % ps
    if nm:
        return idx, "%s = %s%s" % (txt, nm, "" if conf in (None, "proven", "verified") else " (%s)" % conf)
    return idx, txt


def kit_variant(parts, ordinal):
    """Body variant the build carries: from car_body (412001 -> 1, 2002100 -> 1), else from the hundreds
    digit of any body-dependent slot. 0 = stock body."""
    _p, ci = split_any(parts.get("car_body"), ordinal)
    if ci is not None:
        return ci // 100 if ci >= 100 else ci
    for s in ("front_tire_width", "rear_tire_width", "front_track_width", "rear_track_width",
              "front_tire_profile", "rear_tire_profile", "roll_cage", "weight_reduction"):
        _p, i = split_any(parts.get(s), ordinal)
        if i is not None and i >= 100:
            return i // 100
    return 0


EFFECT = "identify by effect (match the source car's Power/Weight and Braking/Lateral G pages)"


def ladder_slots():
    lad = _pn().get("tier_ladder") or {}
    return (set(lad.get("applies_to") or []) | {"transmission", "tire_compound", "intercooler"}
            | ENGINE_INTERNALS | set(ASPIRATION_SLOTS))


def pick_for(slot, idx, pid, ordinal, fam=None, kit=0):
    """The instruction for one slot -- HOW to find the tile -- graded by what the data has earned.

    pick_kind  named   a proven/verified name: 'the tile named X' (+ 'tile T of N' from a per-car map)
               dense   index is the 0-based tile position: 'tile T'. Roll cage / weight reduction: the
                       tile inside the body variant, NAMED by this car's tile count (3: Stock/Sport/Race,
                       4: Stock/Street/Sport/Race, else no name). Motor: 'tile T (EV layout unverified)'.
               manifest visual slot: 'option R of M (manifest)' -- the rank of the target id in the car's
                       own Manifest.xml list for that body variant (dense fallback when no list exists)
               ladder  global-ladder / catalogue slot: the exact tile when a per-car map has it, else
                       'index N, tile unknown: identify by effect' -- never 'count up the tiles'
               rim     flat id: read the source car's installed rim, fit the same weight class
               size    size grid (tire width / profile, rim size, track width): DENSE, tile = tier + 1
                       inside the body variant's list; NSX-R tiles carry their mm / inch name
               unknown no scheme established for the slot
    confirmed  proven / derived / unknown / read, from the same evidence (never from a constant)."""
    p = {"pick_kind": UNKNOWN, "tile": None, "tile_count": None, "name": None, "name_conf": None,
         "confirmed": UNKNOWN, "instruction": "", "notes": []}
    if slot in RIM_SLOTS:
        nm, conf = resolve_name(slot, None, pid)
        p.update(pick_kind="rim", confirmed=READ, name=nm if conf == "verified" else None)
        # data/rim-id-matches.json: the wheel in each build's WebP render matched BY EYE against the decoded
        # wheel icons. A hint for finding the tile faster, never proof -- it lives beside the name, not in it.
        rm = (_load(os.path.join(DATA, "rim-id-matches.json")) or {}).get(str(pid)) or {}
        hint = ""
        if not p["name"] and rm.get("verdict") == "matched" and rm.get("name"):
            p["render_name"] = rm["name"]
            p["render_strength"] = rm.get("strength") or "unrated"
            hint = " (the build render reads as '%s')" % rm["name"]
        p["instruction"] = ("rim id %s%s: read the installed rim on the source car and fit any rim of the "
                            "same weight class" % (pid, hint))
        if p["name"]:
            p["notes"].append("this id was read off a car as '%s'" % nm)
        elif p.get("render_name"):
            alts = rm.get("alternates") or []
            p["notes"].append("render match is by eye against the wheel icons (%s%s) - a hint for finding "
                              "the tile, not proof; the weight chip is what must agree"
                              % (p["render_strength"], ("; alternates " + ", ".join(alts)) if alts else ""))
        elif rm.get("verdict") == "ambiguous" and rm.get("candidates"):
            p["notes"].append("the build render narrows the design to %s (ambiguous by eye)"
                              % ", ".join(rm["candidates"]))
        p["notes"].append("rims differ only by weight class (spec 10.6); the lock hides sliders, "
                          "not the INSTALLED badge, and the Rim Style menu opens on the installed tile")
        return p
    if idx is None:
        p["instruction"] = "part id %s: not in this car's set and no scheme recorded - %s" % (pid, EFFECT)
        return p
    if slot in SIZE_SLOTS:
        return _pick_size(p, slot, idx, ordinal)
    if slot in VISUAL_SLOTS:
        return _pick_visual(p, slot, idx, pid, ordinal)
    if slot in DENSE_IN_VARIANT:
        return _pick_variant_dense(p, slot, idx, pid, ordinal)
    if slot == "motor":
        p.update(pick_kind="dense", tile=idx + 1, confirmed=DERIVED,
                 instruction="Motor and Battery Swap: tile %d (EV layout unverified)" % (idx + 1))
        p["notes"].append("dense conversion slot with per-car names (part-names.json named.motor): "
                          "no catalogue name is printed for it")
        p["notes"].append("menu unverified: no capture has shown where EV motor parts are sold; "
                          "try Body Kits and Conversions first")
        return p
    nm, conf = resolve_name(slot, idx, pid, ordinal)
    proven = conf in ("proven", "verified")
    tile, count = tile_for(ordinal, slot, idx)
    dense = slot in dense_slots()
    if tile is None and dense:
        tile = idx % 100 + 1
    if tile is None and (slot in ENGINE_INTERNALS or slot in ASPIRATION_SLOTS or slot == "intercooler"):
        tile, count = engine_tier_tile(ordinal, fam, slot, idx)
    p.update(tile=tile, tile_count=count, name=nm, name_conf=conf)
    where = ("tile %d of %d" % (tile, count)) if (tile and count) else ("tile %d" % tile if tile else None)
    if proven:
        p.update(pick_kind="named", confirmed=PROVEN,
                 instruction="the tile named '%s'%s" % (nm, (" - %s" % where) if where else ""))
    elif dense:
        p.update(pick_kind="dense", confirmed=PROVEN,
                 instruction="%s (dense: the index is the 0-based tile position)" % where)
        if nm:
            p["notes"].append("catalogue name '%s' (%s, unverified)" % (nm, conf))
    elif tile:
        p.update(pick_kind="ladder", confirmed=PROVEN, instruction=where)
        if nm:
            p["notes"].append("catalogue name '%s' (%s, unverified)" % (nm, conf))
    elif nm:
        p.update(pick_kind="ladder" if slot in ladder_slots() else UNKNOWN, confirmed=DERIVED,
                 instruction="index %d, tile unknown: catalogue name '%s' (%s, unverified) - confirm: %s"
                 % (idx, nm, conf, EFFECT))
    else:
        p.update(pick_kind="ladder" if slot in ladder_slots() else UNKNOWN,
                 instruction="index %d, tile unknown: %s" % (idx, EFFECT))
    if not proven:
        # Hints only, never the PICK: rows the data file itself files as unverified or hypothetical.
        named = ((_pn().get("named") or {}).get(slot)) or {}
        for key, label in (("_unverified", "unverified catalogue-order name"), ("_hypothesis", "hypothesis")):
            h = named.get(key) if isinstance(named.get(key), dict) else {}
            h = h.get(str(idx))
            if h and str(h).split(" (")[0].rstrip("?") != (nm or ""):
                p["notes"].append("%s: '%s'" % (label, h))
    if slot in EV_SLOTS:
        p["notes"].append("menu unverified: no capture has shown where EV motor parts are sold; "
                          "try Body Kits and Conversions first")
    if slot in DRIVETRAIN_SLOTS:
        # Every proven Drivetrain ladder was captured on the swapped-drivetrain set 2102. On the car's
        # own stock set the index digits look the same in the corpus, but that is a histogram, not a
        # capture: the name is printed, graded derived, and says so.
        ps, _i = split_any(pid, ordinal)
        if ps is not None and int(ps) != SWAPPED_DRIVETRAIN_SET and p["confirmed"] == PROVEN:
            p["confirmed"] = DERIVED
            p["notes"].append("name verified on drivetrain set %d (the swapped-drivetrain set) only; this "
                              "build uses set %s, the car's stock set" % (SWAPPED_DRIVETRAIN_SET, ps))
    return p


def _pick_size(p, slot, idx, ordinal):
    """Size grids are DENSE (part-names.json size_slots): tile = tier + 1 inside the current body
    variant's list. The NSX-R's rear tire width / rear rim size / front rim size were proven on the
    clone frames (345 mm = tile 7 of 7, 20 in = tile 5, 18 in = tile 4); every other (car, slot) is
    dense by construction and prints as derived, with the mm / inch name when a table has it."""
    var, tier = divmod(idx, 100)
    tile = tier + 1
    nm, count = size_name(ordinal, slot, idx)
    proven = (int(ordinal), slot) in SIZE_PROVEN
    where = ("tile %d of %d" % (tile, count)) if count else ("tile %d" % tile)
    p.update(pick_kind="size", tile=tile, tile_count=count, name=nm,
             name_conf=(("proven" if proven else "derived") if nm else None),
             confirmed=PROVEN if proven else DERIVED,
             instruction="%s (size grid)%s" % (where, (": %s" % nm) if nm else ""))
    p["notes"].append("size ladders are dense: tile = tier + 1 inside body variant %d's list%s"
                      % (var, "" if proven else " (proven on the NSX-R clone frames; dense by construction here)"))
    if not nm:
        p["notes"].append("size tiles are named by their mm / inch value; the source car's tire size "
                          "(Tires and Rims page) confirms the pick")
    return p


def _pick_visual(p, slot, idx, pid, ordinal):
    """Visual slots: the tile is the RANK of the target id in the car's Manifest.xml option list for the
    index's body variant (car_body: the whole kit list). Handles non-dense lists (100/101/103 -> tile 3).
    Dense fallback only when the car has no list; an id missing from an existing list is called out."""
    var_eff = (idx // 100 if idx >= 100 else idx) if slot == "car_body" else idx // 100
    item = ITEM_OF.get(slot) or CUSTOMIZE_ITEM.get(slot, slot)
    nm, conf = resolve_name(slot, idx, pid, ordinal)
    proven_nm = conf in ("proven", "verified")
    rank, count, ok, ids = manifest_rank(ordinal, slot, idx)
    dense_tile = (var_eff + 1) if slot == "car_body" else (idx % 100 + 1)
    if count is None:
        tile, where = dense_tile, "tile %d" % dense_tile
        grade = PROVEN if slot in dense_slots() else DERIVED
        p["notes"].append("no Manifest.xml option list for this car's %s: dense rule, tile = index + 1%s"
                          % (item, "" if slot in dense_slots() else " (unverified for this slot)"))
    elif not ok:
        tile, where = dense_tile, "tile %d" % dense_tile
        grade = UNKNOWN
        p["notes"].append("id %s is NOT in this car's manifest list for %s (%d option%s: %s): the dense "
                          "position is a guess - %s" % (pid, item, count, "" if count == 1 else "s",
                                                        ", ".join(str(i) for i in ids), EFFECT))
    else:
        tile, where = rank, "option %d of %d (manifest)" % (rank, count)
        grade = (PROVEN if (int(ordinal) == GRID_ORDINAL and slot in ("car_body", "rear_wing", "front_bumper"))
                 else DERIVED)
        p["notes"].append("tile = rank of the target id in this car's Manifest.xml %s (data/car-option-lists.json)%s"
                          % ("Body Kit list" if slot == "car_body" else "list for body variant %d" % (idx // 100),
                             "" if grade == PROVEN else "; menu order = manifest order verified on the NSX-R only"))
    p.update(pick_kind="manifest" if ok else "dense", tile=tile, tile_count=count if ok else None,
             name=nm, name_conf=conf, confirmed=grade)
    if slot == "car_body":
        p["instruction"] = "Body Kit: %s = body variant %d%s" % (where, var_eff,
                                                                (" - the tile named '%s'" % nm) if proven_nm else "")
        p["notes"].insert(0, "prerequisite: every step below that says 'needs body variant %d' needs this on first" % var_eff)
    elif proven_nm:
        p["instruction"] = "the tile named '%s' - %s" % (nm, where)
    else:
        p["instruction"] = where
        if nm:
            p["notes"].append("catalogue name '%s' (%s, unverified)" % (nm, conf))
    return p


def _pick_variant_dense(p, slot, idx, pid, ordinal):
    """Roll cage / weight reduction: dense inside the body variant (tile = tier + 1), NAMED by the car's
    tile count. A captured ladder row is proven; a count from the corpus / manifest is a lower bound and
    the name it selects is derived; with no usable count the tile is printed without a name."""
    tile = idx % 100 + 1
    count, basis, exact = variant_tile_count(ordinal, slot)
    nm, conf = resolve_name(slot, idx, pid, ordinal)
    p.update(pick_kind="named" if (nm and conf == "proven") else "dense", tile=tile, tile_count=count,
             name=nm, name_conf=conf)
    if nm and conf == "proven":
        p.update(confirmed=PROVEN, instruction="the tile named '%s' - tile %d of %d" % (nm, tile, count))
    elif nm:
        p.update(confirmed=DERIVED,
                 instruction="tile %d (of at least %d) - the tile named '%s' if the menu has %d tiles (%s); %s"
                 % (tile, count, nm, count, "/".join(VARIANT_LADDERS[count]), basis))
    else:
        p.update(confirmed=DERIVED,
                 instruction="tile %d (name depends on this car's tile count; %s)" % (tile, basis))
    p["notes"].append("dense inside the body variant: index = variant*100 + tile position (proven on the "
                      "NSX-R, part-names.json named.%s._scheme)" % slot)
    if not exact:
        p["notes"].append("the tile count is a lower bound: if the menu shows more tiles the names shift "
                          "(Street appears at tile 2) but the tile POSITION still holds")
    return p


def aspiration_menu(ordinal):
    """The car's captured Aspiration menu ({'tiles': [...], ...}) from part-names.json, or None."""
    return (((_pn().get("named") or {}).get("_aspiration_menu") or {}).get(str(ordinal))) or None


def stock_fi_evidence(ordinal, fam, slot, fs):
    """What this car's OTHER stored tunes on the same engine block say about its stock aspiration:
    'factory' if any carries the target's forced-induction slot at index 0, 'na' if any has every
    forced-induction slot empty, None when neither was ever stored."""
    if not fs or fam is None:
        return None
    factory = na = False
    for f in fs:
        try:
            p = T.parse_tune(f).get("parts") or {}
        except Exception:
            continue
        if engine_family(p) != fam:
            continue
        _ps, i = split_any(p.get(slot), ordinal)
        if i == 0:
            factory = True
        if all(p.get(k) is None for k in ASPIRATION_SLOTS):
            na = True
    return "factory" if factory else ("na" if na else None)


def aspiration_plan(tp, sp, ordinal, fam, fs=None):
    """Is the Aspiration CONVERSION a step? The conversion is injected ONLY when the source (or, with no
    source, the stock model of the car) has the target's forced-induction slot EMPTY and the target's
    slot is at tier >= 1. A target slot at index 0 is factory forced induction: nothing to convert, the
    tier is bought in Engine only. sp is the source's parts dict, or None when there is no source.

    Stock model, in order: the captured Aspiration menu (part-names.json _aspiration_menu: tile 1 reads
    'Stock - Naturally Aspirated' or 'Stock - <type>'), then this car's other stored tunes on the same
    block (stock_fi_evidence), else 'unknown' -- printed as a conditional, never as a certainty."""
    slots = [k for k in ASPIRATION_SLOTS if tp.get(k) is not None]
    if not slots:
        return None
    slot = slots[0]
    want = " + ".join(ASPIRATION_SLOTS[k] for k in slots)
    _p, idx = split_any(tp.get(slot), ordinal)
    plan = {"type": want, "slot": slot, "index": idx, "action": None, "basis": None, "have": None,
            "text": None, "tile": None, "tile_count": None, "confidence": UNKNOWN}
    menu = aspiration_menu(ordinal)
    tiles = list((menu or {}).get("tiles") or [])
    if want in tiles:
        plan["tile"], plan["tile_count"] = tiles.index(want) + 1, len(tiles)
    factory_txt = "factory forced induction: buy the tier in Engine only"
    fallback = ("if the Engine menu has no %s sub-menu after all, install the conversion first "
                "(Body Kits and Conversions > Aspiration)" % want)
    if idx == 0:
        plan.update(action="factory", basis="target's %s slot is at index 0" % slot, have=want,
                    text=factory_txt, confidence=PROVEN)
        return plan
    if sp is not None:
        if sp.get(slot) is None:
            plan.update(action="convert", basis="source has the %s slot empty" % slot,
                        have=aspiration_type(sp) or "naturally aspirated",
                        text="install the %s conversion" % want, confidence=PROVEN)
        else:
            plan.update(action="already", basis="source already carries %s" % want, have=want,
                        text="%s already fitted on the source: buy the tier in Engine only" % want,
                        confidence=PROVEN)
        return plan
    stock = tiles[0] if tiles else None
    if stock:
        if "Naturally Aspirated" in stock:
            plan.update(action="convert", basis="stock model: '%s' (captured Aspiration menu)" % stock,
                        have="naturally aspirated", text="install the %s conversion" % want, confidence=PROVEN)
        elif want in stock:
            plan.update(action="factory", basis="stock model: '%s' (captured Aspiration menu)" % stock,
                        have=want, text=factory_txt, confidence=PROVEN)
        else:
            plan.update(action="convert", basis="stock model: '%s', target wants %s" % (stock, want),
                        have=stock, text="install the %s conversion" % want, confidence=PROVEN)
        return plan
    # Corpus evidence is DERIVED, not proven: the catalogue carries a 'Naturally Aspirated' conversion
    # row (132), so a sibling tune with every forced-induction slot empty does not strictly prove the
    # block is NA from the factory, and an index-0 sibling is read as factory by the task's rule.
    ev = stock_fi_evidence(ordinal, fam, slot, fs)
    if ev == "factory":
        plan.update(action="factory", have=want, text="%s (%s)" % (factory_txt, fallback), confidence=DERIVED,
                    basis="a stored tune of this car on the same block carries %s at index 0" % slot)
    elif ev == "na":
        plan.update(action="convert", have="naturally aspirated", confidence=DERIVED,
                    text="install the %s conversion (skip if the Engine menu already shows a %s sub-menu)"
                         % (want, want),
                    basis="a stored tune of this car on the same block has no forced induction")
    else:
        plan.update(action="unknown", have="unknown", confidence=UNKNOWN,
                    basis="stock aspiration of this car / engine block unverified",
                    text="if the Engine menu already shows a %s sub-menu, skip this step; otherwise "
                         "install the %s conversion here" % (want, want))
    return plan


def build(target, source, ordinal, fs=None, meta=None):
    """Rows are the ACTIONS needed on the replica. With no source container we model the stock car as
    tier 0 / variant 0 in every slot (rims: empty = stock wheels) -- otherwise every populated slot
    looks like a change and a list of 'required upgrades' fills up with parts the stock car already has.

    Returns [(phase, rows)]; phases follow INSTALL_ORDER. Each row carries the pick fields from
    pick_for (pick_kind, tile, tile_count, name, name_conf, confirmed, instruction, notes), menu_path,
    variant (body variant it needs) and grid_tile / grid_note. `fs` (this car's containers) feeds the
    stock-aspiration evidence; `meta`, if given, receives kit / source_kit / aspiration / engine_family."""
    tp = target.get("parts") or {}
    sp = (source or {}).get("parts") or {}
    assume_stock = source is None
    fam = engine_family(tp)
    kit = kit_variant(tp, ordinal)
    src_kit = kit_variant(sp, ordinal) if not assume_stock else 0
    plan = aspiration_plan(tp, None if assume_stock else sp, ordinal, fam, fs)
    asp = plan["type"] if plan else None
    rows = []
    for menu, items in MENUS:
        got = []
        for slot, item in items:
            tv, sv = tp.get(slot), sp.get(slot)
            if tv is None and sv is None:
                continue
            ti, ttxt = describe(slot, tv, ordinal)
            if assume_stock:
                # a stock car sits at index 0 of whatever partset that slot uses; stock wheels are EMPTY
                if slot in RIM_SLOTS:
                    si, stxt = None, "stock wheels (empty slot)"
                elif ti == 0:
                    continue
                else:
                    si, stxt = 0, "stock (idx 0)"
            else:
                if tv == sv:
                    continue
                si, stxt = describe(slot, sv, ordinal)
            # tier 0 in a NON-zero variant is the stock part *for that conversion* -- fitting the body
            # kit sets it. It is a consequence, not something you buy, so it must not read as an action.
            # The conversions themselves are exempt: car_body 100 IS the kit purchase, not its echo.
            auto = bool(ti is not None and ti >= 100 and ti % 100 == 0 and slot not in CONVERSION_SLOTS)
            r = {"slot": slot, "item": item, "from": stxt, "to": ttxt, "from_idx": si, "to_idx": ti,
                 "auto": auto, "engine_part": slot in ENGINE_INTERNALS,
                 "variant": (ti // 100) if (ti is not None and ti >= 100 and slot not in CONVERSION_SLOTS) else 0,
                 "menu_path": "Upgrade Shop > %s > %s" % (menu, item)}
            r.update(pick_for(slot, ti, tv, ordinal, fam, kit))
            r["grid_tile"], r["grid_note"] = grid_tile(menu, slot, ordinal, kit, fam, asp)
            if slot == "transmission" and target.get("gear_count"):
                # The speed count is set-independent: it is the number of populated gear slots. It
                # corroborates (or refutes) a 'N Speed' name whatever drivetrain set the build carries.
                gc = int(target["gear_count"])
                r["notes"].append("the target's gear slots hold %d ratio%s: a %d-speed transmission"
                                  % (gc, "" if gc == 1 else "s", gc))
                m = re.search(r"(\d+) Speed", r.get("name") or "")
                if m and int(m.group(1)) != gc:
                    r["confirmed"] = UNKNOWN
                    r["notes"].append("WARNING: the name says %s Speed but the gear slots say %d - trust the "
                                      "gear slots and pick the %d-speed tile" % (m.group(1), gc, gc))
                elif m and r["confirmed"] == DERIVED and r.get("name_conf") in ("proven", "verified"):
                    r["confirmed"] = PROVEN
                    r["notes"].append("the gear count corroborates the name on this set")
            if slot in ASPIRATION_SLOTS and plan:
                if plan["action"] == "convert":
                    r["notes"].append("needs the Aspiration conversion step above first: without it the "
                                      "Engine menu has no %s sub-menu (spec 9.1)" % item)
                elif plan["action"] == "unknown":
                    r["notes"].append(plan["text"])
                else:
                    r["notes"].append(plan["text"])
            if slot == "intercooler":
                r["notes"].append("the Intercooler tile exists only while forced induction is fitted (spec 10.4)")
            got.append(r)
        if got:
            rows.append((menu, got))

    # The widebody REMOVES the Front Bumper tile (spec 2.5 / 10.7) and the slot keeps its pre-kit value,
    # so a target carrying both was bought bumper first. Schedule it before the kit. With no kit on the
    # target the bumper is an ordinary Aero and Appearance step and stays there.
    if kit:
        pre = []
        for i, (menu, got) in enumerate(rows):
            keep = []
            for r in got:
                if (r["slot"] in PRUNED_BY_BODY_KIT and not r["auto"]
                        and r["to_idx"] is not None and r["to_idx"] < 100):
                    r["notes"].insert(0, "buy BEFORE the body kit: the kit removes this tile and the slot "
                                         "keeps its value under the kit (spec 10.7)")
                    if src_kit:
                        r["notes"].insert(1, "the source car already wears the kit: remove kit -> buy this -> refit kit")
                    pre.append(r)
                else:
                    keep.append(r)
            rows[i] = (menu, keep)
        rows = [(m, g) for m, g in rows if g]
        if pre:
            rows.insert(0, ("Pre-conversion", pre))

    # The Aspiration CONVERSION step. Verified on camera 2026-09-01: on the stock block with no
    # conversion fitted the Engine menu shows 8 tiles and NO supercharger sub-menu at all, so the tier
    # cannot be bought until this is installed, and it belongs with the conversions, not the engine.
    if plan and plan["action"] in ("convert", "unknown"):
        where = ("tile %d of %d" % (plan["tile"], plan["tile_count"])) if plan["tile"] else None
        r = {"slot": "_aspiration_conv", "item": "Aspiration", "from": plan["have"],
             "to": "install the %s conversion" % plan["type"], "from_idx": None, "to_idx": None,
             "auto": False, "engine_part": False, "variant": 0,
             "menu_path": "Upgrade Shop > Body Kits and Conversions > Aspiration",
             "pick_kind": "named", "tile": plan["tile"], "tile_count": plan["tile_count"],
             "name": plan["type"], "name_conf": "proven" if plan["tile"] else None,
             "confirmed": plan["confidence"] if plan["action"] == "convert" else UNKNOWN,
             "instruction": "the tile named '%s'%s" % (plan["type"], (" - %s" % where) if where else ""),
             "notes": ["without this the Engine menu has NO %s sub-menu (spec 9.1)" % plan["type"],
                       "basis: %s" % plan["basis"]]}
        if plan["action"] == "unknown":
            r["notes"].insert(0, plan["text"])
        r["grid_tile"], r["grid_note"] = grid_tile("Body Kits and Conversions", "_aspiration_conv",
                                                   ordinal, kit, fam, asp)
        for i, (menu, got) in enumerate(rows):
            if menu == "Body Kits and Conversions":
                rows[i] = (menu, got + [r])
                break
        else:
            rows.insert(0, ("Body Kits and Conversions", [r]))
    # PAINT AND CUSTOMIZE. Hood, side skirts and rear bumper are not Upgrade Shop tiles, but a target
    # whose value is not the kit's own stock for its body variant (variant N, tier 0) chose one, and a
    # clone that skips it will not diff MATCH. They are emitted as steps of their own, with the manifest
    # rank; only the variant-N tier-0 echo stays 'set by the kit'. The menu path has never been captured.
    custom, kit_set = [], []
    body_pid = tp.get("car_body")
    for slot, sub in CUSTOMIZE_SLOTS.items():
        tv, sv = tp.get(slot), sp.get(slot)
        if tv is None and sv is None:
            continue
        ti, ttxt = describe(slot, tv, ordinal)
        if assume_stock:
            if ti in (None, 0):
                continue
            si, stxt = 0, "stock (idx 0)"
        else:
            if tv == sv:
                continue
            si, stxt = describe(slot, sv, ordinal)
        item = CUSTOMIZE_ITEM[slot]
        r = {"slot": slot, "item": item, "from": stxt, "to": ttxt, "from_idx": si, "to_idx": ti,
             "auto": False, "engine_part": False,
             "variant": (ti // 100) if (ti is not None and ti >= 100) else 0,
             "menu_path": "%s > %s > %s (menu path unverified)" % (CUSTOMIZE_MENU, sub, item),
             "grid_tile": None,
             "grid_note": "menu path unverified: no capture has shown the Paint and Customize grids"}
        if ti is not None and ti >= 100 and ti % 100 == 0:
            r.update(auto=True, set_by="kit", pick_kind="dense", tile=None, tile_count=None, name=None,
                     name_conf=None, confirmed=PROVEN, notes=[],
                     instruction="set by the body kit (variant %d, tier 0): nothing to buy" % (ti // 100))
            kit_set.append(r)
            continue
        r.update(pick_for(slot, ti, tv, ordinal, fam, kit))
        ev = kit_visual_evidence(ordinal, slot, body_pid)
        n_all, n_same = sum(ev.values()), ev.get(tv, 0)
        if kit and n_all >= 2 and n_same == n_all:
            r["notes"].insert(0, "probably set by the kit itself: %d/%d stored tunes of this car wearing this "
                                 "body kit carry this same id - check the INSTALLED badge before buying"
                              % (n_same, n_all))
        elif n_all >= 2 and len(ev) > 1:
            r["notes"].insert(0, "a real choice: stored tunes of this car with this body carry %d different "
                                 "ids for this slot (%d/%d carry the target's)" % (len(ev), n_same, n_all))
        custom.append(r)

    kit_tile = kit + 1
    for _m, got in rows:
        for r in got:
            if r["slot"] == "car_body" and r.get("tile"):
                kit_tile = r["tile"]
    if meta is not None:
        meta.update(kit=kit, source_kit=src_kit, aspiration=plan, engine_family=fam, kit_tile=kit_tile,
                    customize=custom, kit_set=kit_set, drivetrain_sets=drivetrain_sets(tp, ordinal),
                    gear_count=target.get("gear_count"))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ordinal", type=int, required=True, help="car ordinal (both cars share it)")
    ap.add_argument("--target", help="target container: index from --list, a timestamp or a tune-name substring "
                                     "(default: the newest DOWNLOADED/locked container, else the newest of all)")
    ap.add_argument("--source", help="source container: the replica's latest save (default: the newest self-made "
                                     "container newer than the target, else the replica is assumed fully stock; "
                                     "'stock' forces the stock model)")
    ap.add_argument("--list", action="store_true", help="list this car's containers and exit")
    ap.add_argument("--json", action="store_true", help="emit JSON for the dashboard")
    ap.add_argument("--verify", nargs=2, metavar=("A", "B"),
                    help="apply the hardware protocol to two containers (index or name substring) and exit")
    ap.add_argument("--walkthrough", action="store_true",
                    help="menu-by-menu install route, in dependency order")
    a = ap.parse_args()

    out = io.TextIOWrapper(open(1, "wb", closefd=False), encoding="utf-8", errors="replace")
    fs = containers(a.ordinal)
    if not fs:
        print("  no tune containers for ordinal %d" % a.ordinal, file=out)
        out.flush()
        return 1

    locked = {}
    for f in fs:
        try:
            locked[f] = bool(T.parse_tune(f).get("locked"))
        except Exception:
            locked[f] = False

    def default_target():
        """The newest DOWNLOADED (locked) container -- that is the tune being cloned. The newest of all
        only when the car has no download stored."""
        L = [f for f in fs if locked[f]]
        if L:
            return L[-1], "default: newest downloaded/locked container"
        return fs[-1], "default: newest container (no download stored for this car)"

    def default_source(tf):
        """The newest self-made save newer than the target = the replica's latest state; with none the
        replica is modelled as fully stock."""
        later = [f for f in fs if not locked[f] and os.path.getmtime(f) > os.path.getmtime(tf)]
        if later:
            return later[-1], "default: newest self-made save newer than the target"
        return None, "default: no self-made save newer than the target, so the replica is assumed FULLY STOCK"

    def pick(sel):
        """Index from --list, a path/timestamp substring, or the header tune name (case-insensitive,
        exact first then substring; newest wins) -- 'Top Meta Rival' works as well as '181414'."""
        if sel is None:
            return None
        if sel.isdigit() and int(sel) < len(fs):
            return fs[int(sel)]
        m = [f for f in fs if sel in f]
        if m:
            return m[0]
        low = sel.strip().lower()
        names = [(f, (tune_name(os.path.dirname(f)) or "").strip().lower()) for f in fs]
        m = [f for f, n in names if n == low] or [f for f, n in names if low and low in n]
        return m[-1] if m else None

    if a.verify:
        pa, pb = pick(a.verify[0]), pick(a.verify[1])
        if not pa or not pb:
            print("  container not found; run with --list", file=out); out.flush(); return 1
        v, diffs = verify_hardware(pa, pb)
        na, nb = tune_name(os.path.dirname(pa)), tune_name(os.path.dirname(pb))
        print("", file=out)
        print("  HARDWARE VERIFY  %r  vs  %r" % (na, nb), file=out)
        print("  compared: ordinal 0x02-0x03 + full 100-slot part array 0x0E-0x19D; excluded: locked flag, sliders, gears", file=out)
        print("  VERDICT: %s" % v, file=out)
        for n, x, y in diffs:
            fx = "empty" if x == 0xFFFFFFFF else str(x); fy = "empty" if y == 0xFFFFFFFF else str(y)
            print("     %-26s %-10s vs %s" % (n, fx, fy), file=out)
        if v == "CHECK-BY-EYE":
            print("  intercooler is the one slot whose empty-vs-0 state is not implied by the build; confirm it in the shop", file=out)
        if v.startswith("MATCH (rims"):
            print("  rims are a weight class (spec 10.6): open Rim Style on the source car, read the INSTALLED rim's name", file=out)
            print("  and weight chip, and fit any rim of the same class on the replica; the hardware is otherwise identical", file=out)
        out.flush(); return 0 if v.startswith("MATCH") else 2

    if a.list:
        dt, _how = default_target()
        ds, _how = default_source(dt)
        print("  %d containers for ordinal %d (oldest first):" % (len(fs), a.ordinal), file=out)
        for i, f in enumerate(fs):
            d = T.parse_tune(f)
            n = len([v for v in (d.get("parts") or {}).values() if v is not None])
            fam = engine_family(d.get("parts") or {})
            mark = "  <- default target" if f == dt else ("  <- default source" if f == ds else "")
            print("    [%d] %-32s %-11s %2d parts  fam %-5s  hw:%s setup:%s  %r%s"
                  % (i, os.path.basename(os.path.dirname(f)),
                     "downloaded" if d.get("locked") else "self-made", n,
                     fam or "-", T.hw_hash(f)[:8], T.setup_hash(f)[:8], tune_name(os.path.dirname(f)) or "?", mark), file=out)
        if ds is None:
            print("    (no self-made save newer than the default target: the replica is assumed fully stock)", file=out)
        out.flush()
        return 0

    if a.target:
        tf, how_t = pick(a.target), "--target %s" % a.target
    else:
        tf, how_t = default_target()
    if not tf:
        print("  target not found; run with --list (index, timestamp or tune name all work)", file=out)
        out.flush()
        return 1
    td = T.parse_tune(tf)
    if a.source and a.source.strip().lower() in ("stock", "none", "-"):
        sf, how_s = None, "--source stock: the replica is modelled as FULLY STOCK"
    elif a.source:
        sf, how_s = pick(a.source), "--source %s" % a.source
        if not sf:
            print("  source not found; run with --list (index, timestamp or tune name all work)", file=out)
            out.flush()
            return 1
    else:
        sf, how_s = default_source(tf)
    sd = T.parse_tune(sf) if sf else None

    meta = {}
    rows = build(td, sd, a.ordinal, fs, meta)
    plan = meta.get("aspiration")
    # Hood / side skirts / rear bumper: Paint and Customize purchases (custom) or the kit's own stock
    # (kit_set) -- classified in build(). Dropping them silently would read as "covered everything"
    # when three real differences went unmentioned; shopping for them in the Upgrade Shop sent a real
    # clone to a menu with one tile looking for five.
    custom = meta.get("customize") or []
    kit_set = meta.get("kit_set") or []
    auto_rows = [(m, r) for m, g in rows for r in g if r["auto"]]
    total = sum(len(r) for _, r in rows)
    acts = total - len(auto_rows)
    tname = tune_name(os.path.dirname(tf))
    sname = tune_name(os.path.dirname(sf)) if sf else None

    if a.json:
        print(json.dumps({"ordinal": a.ordinal,
                          "target": os.path.basename(os.path.dirname(tf)),
                          "target_name": tname,
                          "target_locked": bool(td.get("locked")),
                          "target_how": how_t,
                          "source": os.path.basename(os.path.dirname(sf)) if sf else None,
                          "source_name": sname,
                          "source_how": how_s,
                          "engine_family": meta.get("engine_family"),
                          "kit_variant": meta.get("kit"),
                          "kit_tile": meta.get("kit_tile"),
                          "drivetrain_sets": meta.get("drivetrain_sets"),
                          "gear_count": meta.get("gear_count"),
                          "aspiration": plan,
                          "steps": acts,
                          "customize_steps": len(custom),
                          "menus": [{"menu": m, "rows": r} for m, r in rows],
                          "customize": custom,
                          "not_in_shop": kit_set},
                         indent=2), file=out)
        out.flush()
        return 0

    car = td.get("car") or ("ordinal %d" % a.ordinal)
    fam = meta.get("engine_family")
    print("", file=out)
    print("  CLONE SHOPPING LIST - %s" % car, file=out)
    print("  target : %s (%s)  %r  [%s]" % (os.path.basename(os.path.dirname(tf)),
                                            "downloaded/LOCKED" if td.get("locked") else "self-made",
                                            tname or "?", how_t), file=out)
    print("  source : %s  [%s]" % (("%s (%s)  %r" % (os.path.basename(os.path.dirname(sf)),
                                                     "downloaded/LOCKED" if (sd or {}).get("locked") else "self-made",
                                                     sname or "?")) if sf else "replica assumed FULLY STOCK", how_s), file=out)
    if fam:
        print("  engine : family %s - %s" % (fam, family_label(fam) or "unnamed"), file=out)
    if meta.get("kit"):
        print("  body   : variant %d (Body Kit tile %d)" % (meta["kit"], meta.get("kit_tile") or meta["kit"] + 1), file=out)
    for s in meta.get("drivetrain_sets") or []:
        print("  drivetrain set %d : %s" % (s, "the swapped-drivetrain set (Drivetrain ladders proven on it)"
                                            if s == SWAPPED_DRIVETRAIN_SET else
                                            "this car's stock set (Drivetrain names verified on set %d only)" % SWAPPED_DRIVETRAIN_SET), file=out)
    if meta.get("gear_count"):
        print("  transmission : %d-speed (the target's gear slots hold %d ratio%s)"
              % (meta["gear_count"], meta["gear_count"], "" if meta["gear_count"] == 1 else "s"), file=out)
    if plan:
        print("  aspiration : %s at index %s - %s" % (plan["type"], plan["index"], plan["text"]), file=out)
    print("  %d part change%s across %d Upgrade Shop menu%s%s" % (
        total, "" if total == 1 else "s", len(rows), "" if len(rows) == 1 else "s",
        (" + %d Paint and Customize purchase%s" % (len(custom), "" if len(custom) == 1 else "s")) if custom else ""), file=out)
    print("", file=out)
    if total == 0 and not custom and not kit_set:
        print("  CLONE EXACT - every one of the 50 part slots matches. Nothing left to install.", file=out)
        out.flush()
        return 0

    if a.walkthrough:
        kit_tile = meta.get("kit_tile") or (meta.get("kit") or 0) + 1
        print("  == ROUTE: target %r (%s, %s) -> source: %s ==" % (
            tname or "?", os.path.basename(os.path.dirname(tf)),
            "downloaded/LOCKED" if td.get("locked") else "self-made (unlocked)",
            ("%r (%s, %s)" % (sname or "?", os.path.basename(os.path.dirname(sf)),
                              "downloaded/LOCKED" if (sd or {}).get("locked") else "self-made")) if sf
            else "replica assumed FULLY STOCK"), file=out)
        print("     target chosen by %s; source by %s" % (how_t, how_s), file=out)
        for s in meta.get("drivetrain_sets") or []:
            if s == SWAPPED_DRIVETRAIN_SET:
                print("     drivetrain set %d = the swapped-drivetrain set: Transmission / Differential / Driveline "
                      "ladders proven on this set" % s, file=out)
            else:
                print("     drivetrain set %d = this car's stock drivetrain set: Drivetrain tile names verified on "
                      "set %d only" % (s, SWAPPED_DRIVETRAIN_SET), file=out)
        if meta.get("gear_count"):
            print("     transmission: %d-speed (the target's gear slots hold %d ratio%s)"
                  % (meta["gear_count"], meta["gear_count"], "" if meta["gear_count"] == 1 else "s"), file=out)
        print("", file=out)
        order = {m: i for i, m in enumerate(INSTALL_ORDER)}
        step = 0
        for menu, got in sorted(rows, key=lambda kv: order.get(kv[0], 99)):
            # Honour the same flags the summary honours: both modes read the SAME rows.
            got = [r for r in got if not r["auto"]]
            if not got:
                continue
            if menu == "Pre-conversion":
                print("  == PRE-CONVERSION  (Upgrade Shop tile %s, Aero and Appearance) =="
                      % SHOP_TILE["Aero and Appearance"], file=out)
                print("     buy BEFORE the body kit: the kit removes the Front Bumper tile; the slot keeps its value", file=out)
            else:
                print("  == %s  (Upgrade Shop tile %s) ==" % (menu.upper(), SHOP_TILE.get(menu, "?")), file=out)
                if menu == "Body Kits and Conversions":
                    print("     do this menu FIRST - conversions change which tiles exist everywhere else", file=out)
                elif menu == "Engine":
                    print("     engine internals belong to the BLOCK; swapping the engine later discards them", file=out)
            print("", file=out)
            for r in got:
                step += 1
                print("   %2d. %s" % (step, r["menu_path"]), file=out)
                gt, gn = r.get("grid_tile"), r.get("grid_note") or ""
                print("       sub-menu: %s  (category grid tile %s)%s"
                      % (r["item"], gt if gt else "?", ("  - " + gn) if gn else ""), file=out)
                print("       PICK: %s" % r["instruction"], file=out)
                for n in r.get("notes") or []:
                    print("             %s" % n, file=out)
                if r.get("variant"):
                    print("       needs body variant %d - the Body Kit step (variant %d, tile %d) must be on first"
                          % (r["variant"], r["variant"], kit_tile), file=out)
                print("       confidence: %s" % r["confirmed"], file=out)
                print("", file=out)
        if custom:
            print("  == PAINT AND CUSTOMIZE  (outside the Upgrade Shop; menu path unverified) ==", file=out)
            print("     hood / side skirts / rear bumper are chosen here, not in the Upgrade Shop; the exact sub-menu", file=out)
            print("     has never been captured - the tile is the manifest rank inside that menu's option list", file=out)
            print("", file=out)
            for i, r in enumerate(custom, 1):
                print("   C%d. %s" % (i, r["menu_path"]), file=out)
                print("       PICK: %s" % r["instruction"], file=out)
                for n in r.get("notes") or []:
                    print("             %s" % n, file=out)
                if r.get("variant"):
                    print("       needs body variant %d - the Body Kit step (variant %d, tile %d) must be on first"
                          % (r["variant"], r["variant"], kit_tile), file=out)
                print("       confidence: %s" % r["confirmed"], file=out)
                print("", file=out)
        print("  %d Upgrade Shop step%s%s. After installing, save a setup on the replica and re-run with"
              % (step, "" if step == 1 else "s",
                 (" + %d Paint and Customize step%s" % (len(custom), "" if len(custom) == 1 else "s")) if custom else ""), file=out)
        print("  --source <that container> - it prints CLONE EXACT when the builds match.", file=out)
        if auto_rows:
            print("", file=out)
            print("  SET AUTOMATICALLY BY THE BODY KIT (tier 0 in body variant %d) - do not shop for these:"
                  % (auto_rows[0][1]["to_idx"] // 100), file=out)
            for _m, r in auto_rows:
                print("     %-36s %s" % (r["item"], r["to"]), file=out)
        if kit_set:
            print("", file=out)
            print("  SET BY THE KIT (body variant %d, tier 0) - not Upgrade Shop tiles, nothing to buy:"
                  % (kit_set[0]["to_idx"] // 100), file=out)
            for o in kit_set:
                print("     %-36s %s" % (o["item"], o["to"]), file=out)
        if plan and plan["action"] in ("factory", "already"):
            print("", file=out)
            print("  aspiration: %s (%s)" % (plan["text"], plan["basis"]), file=out)
        out.flush()
        return 0

    MARK = {PROVEN: "  ", DERIVED: " ~", UNKNOWN: " ?", READ: " @"}
    for menu, got in rows:
        act = [r for r in got if not r["auto"]]
        if not act:
            continue
        print("  %s" % ("PRE-CONVERSION - buy before the body kit (Aero and Appearance)"
                        if menu == "Pre-conversion" else menu.upper()), file=out)
        for r in act:
            line = "  %s %-36s %s" % (MARK.get(r["confirmed"], " ?"), r["item"], r["to"])
            if r["from"] != "-" and sd is not None:
                line += "   (was %s)" % r["from"]
            print(line, file=out)
        print("", file=out)
    if custom:
        print("  PAINT AND CUSTOMIZE - outside the Upgrade Shop (menu path unverified)", file=out)
        for r in custom:
            line = "  %s %-36s %s" % (MARK.get(r["confirmed"], " ?"), r["item"], r["to"])
            if r["from"] != "-" and sd is not None:
                line += "   (was %s)" % r["from"]
            print(line, file=out)
        print("", file=out)
    if auto_rows:
        print("  SET AUTOMATICALLY BY THE CONVERSION - do not shop for these", file=out)
        for menu, r in auto_rows:
            print("     %-36s %s" % (r["item"], r["to"]), file=out)
        print("     (tier 0 in body variant %s = the stock part FOR that conversion)"
              % (auto_rows[0][1]["to_idx"] // 100), file=out)
        print("", file=out)
    if kit_set:
        print("  NOT IN THE UPGRADE SHOP - the kit's own stock (body variant %d, tier 0), nothing to buy"
              % (kit_set[0]["to_idx"] // 100), file=out)
        for o in kit_set:
            print("     %-36s %s" % (o["item"], o["to"]), file=out)
        print("", file=out)
    counts = {}
    for _, g in rows:
        for r in g:
            if not r["auto"]:
                counts[r["confirmed"]] = counts.get(r["confirmed"], 0) + 1
    for r in custom:
        counts[r["confirmed"]] = counts.get(r["confirmed"], 0) + 1
    print("  %d PART%s TO INSTALL (+%d set automatically%s)"
          % (acts, "" if acts == 1 else "S", len(auto_rows),
             (", +%d Paint and Customize" % len(custom)) if custom else ""), file=out)
    print("  CONFIDENCE   (blank)=proven name or tile   ~=catalogue name, unverified   ?=tile unknown   @=read off the source car", file=out)
    print("  %d proven · %d derived · %d unknown · %d read" % (counts.get(PROVEN, 0), counts.get(DERIVED, 0),
                                                              counts.get(UNKNOWN, 0), counts.get(READ, 0)), file=out)
    print("", file=out)
    print("  The INDEX on every row is byte-exact; only the item NAME can be off. You do not have to", file=out)
    print("  trust the names: install, save a setup on the replica, then re-run with --source <that", file=out)
    print("  container>. The diff is a checksum - when it prints CLONE EXACT the build is identical,", file=out)
    print("  regardless of what any label said. Each single-part step also names one slot for good.", file=out)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
