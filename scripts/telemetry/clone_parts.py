#!/usr/bin/env python3
"""Clone shopping list: the PARTS diff between a target tune and a stock (or part-built) car.

The workflow this serves: two identical cars, one carrying a downloaded tune, one stock. You copy the
target's hardware onto the stock car, then tune the sliders yourself. So this tool deliberately ignores
slider values -- only the 50-slot parts array matters.

Both cars share an ordinal, so the diff is byte-exact: no inference, no telemetry, no test battery.

Rows are grouped and ordered like the in-game upgrade menus (docs/fh6-ui-spec.md section 2), because
that is the order you actually walk the shop in.

HONESTY: the decoder's slot->menu-item labels are hand-assigned and NOT all verified. A row whose label
is unconfirmed is printed with a '?' marker, so you are never told a part name that we have not earned.
The INDEX is byte-exact either way. See data/part-index-vocabulary.json.

READ-ONLY: never writes to the game save.
"""
import argparse, glob, io, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fh6_tune_decode as T

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "..", "data"))

# Menu grouping + order, from docs/fh6-ui-spec.md section 2.
#
# The third field is LABEL CONFIDENCE, earned from evidence across all 532 tunes:
#   "proven" - the slot's identity is established. Either a gating test (the part unlocks a specific
#              tune slider, e.g. Race springs -> damping, 275/275 with zero exceptions), or a live
#              telemetry correlate (drivetrain swap moves DrivetrainType), or a named frame.
#   "group"  - the slot's MENU is proven but its exact item is not. Every engine-internal slot carries
#              the ENGINE's partset rather than the car's (519/519), which proves it is an engine part;
#              it does not prove which one. Mis-ordering within the group is still possible.
#   "guess"  - hand-assigned, no evidence either way.
#
# Slots deliberately omitted: "aspiration" and "quad_turbo" are NEVER populated in any of the 532 tunes
# (real aspiration lives in the mutually-exclusive single_turbo/twin_turbo/centrifugal/pos slots), and
# "motor"/"motor_parts" appear only in the 13 EV tunes -- the exact 13 that carry no engine family.
PROVEN, GROUP, GUESS = "proven", "group", "guess"
MENUS = [
    ("Body Kits and Conversions", [
        ("engine", "Engine Swap", PROVEN), ("drivetrain", "Drivetrain Swap", PROVEN),
        ("car_body", "Body Kit", PROVEN)]),
    ("Engine", [
        ("intake", "Intake", GROUP), ("manifold", "Intake Manifold", GROUP),
        ("fuel_system", "Fuel System", GROUP), ("ignition", "Ignition", GROUP),
        ("exhaust", "Exhaust", GROUP), ("camshaft", "Camshaft", GROUP),
        ("valves", "Valves", GROUP), ("displacement", "Displacement", GROUP),
        ("pistons", "Pistons / Compression", GROUP), ("oil_cooling", "Oil / Cooling", GROUP),
        ("flywheel", "Flywheel", GROUP), ("restrictor_plate", "Restrictor Plate", GROUP),
        ("single_turbo", "Single Turbo", GROUP), ("twin_turbo", "Twin Turbo", GROUP),
        ("centrifugal_supercharger", "Centrifugal Supercharger", PROVEN),
        ("pos_supercharger", "Positive-Displacement Supercharger", PROVEN),
        ("intercooler", "Intercooler", GROUP),
        ("motor", "Electric Motor (EV only)", GROUP),
        ("motor_parts", "Motor Parts (EV only)", GROUP)]),
    ("Platform and Handling", [
        ("brakes", "Brakes", PROVEN), ("springs_dampers", "Spring and Dampers", PROVEN),
        ("front_arb", "Front Anti-roll Bars", PROVEN), ("rear_arb", "Rear Anti-roll Bars", PROVEN),
        ("roll_cage", "Chassis Reinforcement / Roll Cage", GUESS),
        ("weight_reduction", "Weight Reduction", GUESS)]),
    ("Drivetrain", [
        ("clutch", "Clutch", GROUP), ("transmission", "Transmission", GROUP),
        ("driveline", "Driveline", GROUP), ("differential", "Differential", GROUP)]),
    ("Tires and Rims", [
        ("tire_compound", "Tire Compound", PROVEN),
        ("front_tire_width", "Front Tire Width", GUESS), ("rear_tire_width", "Rear Tire Width", GUESS),
        ("front_tire_profile", "Front Tire Profile", GUESS), ("rear_tire_profile", "Rear Tire Profile", GUESS),
        ("front_track_width", "Front Track Width", GUESS), ("rear_track_width", "Rear Track Width", GUESS),
        ("front_rim_size", "Front Rim Size", GUESS), ("rear_rim_size", "Rear Rim Size", GUESS),
        ("rim_style", "Rim Style", GUESS), ("rear_rim_style", "Rear Rim Style", GUESS)]),
    ("Aero and Appearance", [
        ("front_bumper", "Front Bumper", GUESS), ("rear_bumper", "Rear Bumper", GUESS),
        ("rear_wing", "Rear Wing", GUESS), ("hood", "Hood", GUESS),
        ("side_skirts", "Side Skirts", GUESS)]),
]
ENGINE_INTERNALS = {"camshaft", "valves", "displacement", "pistons", "fuel_system", "ignition",
                    "exhaust", "intake", "flywheel", "oil_cooling", "manifold", "restrictor_plate"}

# INSTALL ORDER. Not the same as the shop's own tile order, and the difference matters:
# docs/fh6-ui-spec.md 2.9 -- "Conversions affect the upgrades that are available in other categories",
# and 5.9 records two observed cases (the Rocket Bunny kit REMOVES the Front Bumper tile; the Front
# Tire Width grid grew 4 -> 7 tiles after the widebody/rim change). Our own decode shows the same
# thing numerically: body-dependent parts carry a variant in the hundreds digit that tracks car_body
# exactly, 532/532. So conversions must go in FIRST or the tiles you are shopping for do not exist yet.
# Engine internals go second because they belong to the engine block, not the car (519/519 carry the
# ENGINE's partset), so swapping the engine afterwards would discard them.
INSTALL_ORDER = ["Body Kits and Conversions", "Engine", "Drivetrain",
                 "Platform and Handling", "Tires and Rims", "Aero and Appearance"]

# Upgrade Shop tile number for each category (docs/fh6-ui-spec.md 2, the 3x2 grid), and the sub-menu
# tile number inside it where the spec names one. None = the spec never showed that tile highlighted.
SHOP_TILE = {"Engine": 1, "Platform and Handling": 2, "Drivetrain": 3,
             "Tires and Rims": 4, "Aero and Appearance": 5, "Body Kits and Conversions": 6}
SUB_TILE = {
    "engine": 1, "drivetrain": 2, "car_body": 4,                      # Body Kits and Conversions
    "brakes": 1, "springs_dampers": 2, "front_arb": 3, "rear_arb": 4,  # Platform and Handling
    "roll_cage": 5, "weight_reduction": 6,
    "transmission": 1, "driveline": 2, "differential": 3,              # Drivetrain
    "tire_compound": 1, "front_tire_width": 2, "rear_tire_width": 3,   # Tires and Rims
    "rim_style": 5, "front_rim_size": 7,
    "front_bumper": 1, "rear_wing": 2,                                 # Aero and Appearance
    "intake": 1, "ignition": 4, "valves": 7, "displacement": 8,        # Engine (spec 2.1)
    "oil_cooling": 10, "flywheel": 11,
}

_CACHE = {}


def _load(path, key=None):
    if path not in _CACHE:
        try:
            with open(path, encoding="utf-8") as fh:
                _CACHE[path] = json.load(fh)
        except Exception:
            _CACHE[path] = {}
    j = _CACHE[path]
    return j.get(key) if key else j


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
    """(index, human) for a part ID."""
    ps, idx = split_any(pid, ordinal)
    if idx is None:
        return None, (str(pid) if pid is not None else "-")
    nm = tier_name(slot, idx)
    var, tier = divmod(idx, 100)
    own = str(ps) == str(ordinal)
    txt = "idx %d" % idx
    if var:
        txt += " (body variant %d, tier %d)" % (var, tier)
    if not own:
        txt += " [set %s]" % ps
    return idx, ("%s = %s" % (txt, nm) if nm else txt)


def build(target, source, ordinal):
    """Rows are the ACTIONS needed on the replica. With no source container we model the stock car as
    tier 0 / variant 0 in every slot -- otherwise every populated slot looks like a change and a list
    of 'required upgrades' fills up with parts the stock car already has."""
    tp = target.get("parts") or {}
    sp = (source or {}).get("parts") or {}
    assume_stock = source is None
    rows = []
    for menu, items in MENUS:
        got = []
        for slot, item, confirmed in items:
            tv, sv = tp.get(slot), sp.get(slot)
            if tv is None and sv is None:
                continue
            ti, ttxt = describe(slot, tv, ordinal)
            if assume_stock:
                # a stock car sits at index 0 of whatever partset that slot uses
                if ti == 0:
                    continue
                si, stxt = 0, "stock (idx 0)"
            else:
                if tv == sv:
                    continue
                si, stxt = describe(slot, sv, ordinal)
            # tier 0 in a NON-zero variant is the stock part *for that conversion* -- fitting the body
            # kit sets it. It is a consequence, not something you buy, so it must not read as an action.
            auto = bool(ti is not None and ti >= 100 and ti % 100 == 0)
            got.append({"slot": slot, "item": item, "confirmed": confirmed,
                        "from": stxt, "to": ttxt, "from_idx": si, "to_idx": ti,
                        "auto": auto, "engine_part": slot in ENGINE_INTERNALS})
        if got:
            rows.append((menu, got))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ordinal", type=int, required=True, help="car ordinal (both cars share it)")
    ap.add_argument("--target", help="target container: index from --list, or a name substring (default: newest)")
    ap.add_argument("--source", help="source/stock container (default: assume fully stock)")
    ap.add_argument("--list", action="store_true", help="list this car's containers and exit")
    ap.add_argument("--json", action="store_true", help="emit JSON for the dashboard")
    ap.add_argument("--walkthrough", action="store_true",
                    help="menu-by-menu install route, in dependency order")
    a = ap.parse_args()

    out = io.TextIOWrapper(open(1, "wb", closefd=False), encoding="utf-8", errors="replace")
    fs = containers(a.ordinal)
    if not fs:
        print("  no tune containers for ordinal %d" % a.ordinal, file=out)
        out.flush()
        return 1

    def pick(sel):
        if sel is None:
            return fs[-1]
        if sel.isdigit() and int(sel) < len(fs):
            return fs[int(sel)]
        m = [f for f in fs if sel in f]
        return m[0] if m else None

    if a.list:
        print("  %d containers for ordinal %d (oldest first):" % (len(fs), a.ordinal), file=out)
        for i, f in enumerate(fs):
            d = T.parse_tune(f)
            n = len([v for v in (d.get("parts") or {}).values() if v is not None])
            fam = engine_family(d.get("parts") or {})
            print("    [%d] %-32s %-11s %2d parts  engine family %-6s %s"
                  % (i, os.path.basename(os.path.dirname(f)),
                     "downloaded" if d.get("locked") else "self-made", n,
                     fam or "-", family_label(fam) or ""), file=out)
        out.flush()
        return 0

    tf = pick(a.target)
    if not tf:
        print("  target not found; run with --list", file=out)
        out.flush()
        return 1
    td = T.parse_tune(tf)
    sf = pick(a.source) if a.source else None
    sd = T.parse_tune(sf) if sf else None

    rows = build(td, sd, a.ordinal)
    if a.json:
        print(json.dumps({"ordinal": a.ordinal,
                          "target": os.path.basename(os.path.dirname(tf)),
                          "source": os.path.basename(os.path.dirname(sf)) if sf else None,
                          "engine_family": engine_family(td.get("parts") or {}),
                          "menus": [{"menu": m, "rows": r} for m, r in rows]},
                         indent=2), file=out)
        out.flush()
        return 0

    car = td.get("car") or ("ordinal %d" % a.ordinal)
    fam = engine_family(td.get("parts") or {})
    print("", file=out)
    print("  CLONE SHOPPING LIST - %s" % car, file=out)
    print("  target : %s (%s)" % (os.path.basename(os.path.dirname(tf)),
                                  "downloaded/locked" if td.get("locked") else "self-made"), file=out)
    print("  source : %s" % (os.path.basename(os.path.dirname(sf)) if sf
                             else "assumed FULLY STOCK (no --source container given)"), file=out)
    if fam:
        print("  engine : family %s - %s" % (fam, family_label(fam) or "unnamed"), file=out)
    total = sum(len(r) for _, r in rows)
    print("  %d part change%s across %d menu%s" % (total, "" if total == 1 else "s",
                                                   len(rows), "" if len(rows) == 1 else "s"), file=out)
    print("", file=out)
    if total == 0:
        print("  CLONE EXACT - every one of the 50 part slots matches. Nothing left to install.", file=out)
        out.flush()
        return 0

    if a.walkthrough:
        order = {m: i for i, m in enumerate(INSTALL_ORDER)}
        step = 0
        for menu, got in sorted(rows, key=lambda kv: order.get(kv[0], 99)):
            print("  == %s  (Upgrade Shop tile %s) ==" % (menu.upper(), SHOP_TILE.get(menu, "?")), file=out)
            if menu == "Body Kits and Conversions":
                print("     do this menu FIRST - conversions change which tiles exist everywhere else", file=out)
            elif menu == "Engine":
                print("     engine internals belong to the BLOCK; swapping the engine later discards them", file=out)
            print("", file=out)
            for r in got:
                step += 1
                st = SUB_TILE.get(r["slot"])
                path = "Upgrade Shop > %s > %s" % (menu, r["item"])
                print("   %2d. %s" % (step, path), file=out)
                print("       sub-menu tile %s%s" % (st if st else "?  (spec never showed it highlighted)",
                                                     "" if st else ""), file=out)
                tier = r["to_idx"] % 100 if r["to_idx"] is not None else None
                nm = tier_name(r["slot"], r["to_idx"]) if r["to_idx"] is not None else None
                if nm:
                    print("       PICK: the tile named '%s %s'" % (nm, r["item"]), file=out)
                elif tier == 0:
                    print("       PICK: the STOCK tile (tier 0) - leave it alone if the car is stock", file=out)
                elif tier is not None:
                    print("       PICK: tier %d in the global ladder (0 Stock / 3 Race / 4 Rally / 5 Drift)" % tier, file=out)
                    print("             tier names above 5 and the 1/2 slots are NOT yet confirmed", file=out)
                else:
                    print("       PICK: part id %s - shared catalogue, not this car's own set" % r["to"], file=out)
                if r["to_idx"] is not None and r["to_idx"] >= 100:
                    print("       needs body variant %d - the Body Kit above must be on first"
                          % (r["to_idx"] // 100), file=out)
                print("       label confidence: %s" % r["confirmed"], file=out)
                print("", file=out)
        print("  %d step%s. After installing, save a setup on the replica and re-run with" % (step, "" if step == 1 else "s"), file=out)
        print("  --source <that container> - it prints CLONE EXACT when the builds match.", file=out)
        out.flush()
        return 0
    MARK = {PROVEN: "  ", GROUP: " ~", GUESS: " ?"}
    auto_rows = []
    for menu, got in rows:
        act = [r for r in got if not r["auto"]]
        auto_rows += [(menu, r) for r in got if r["auto"]]
        if not act:
            continue
        print("  %s" % menu.upper(), file=out)
        for r in act:
            line = "  %s %-36s %s" % (MARK[r["confirmed"]], r["item"], r["to"])
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
    acts = total - len(auto_rows)
    ng = sum(1 for _, g in rows for r in g if r["confirmed"] == GROUP and not r["auto"])
    nq = sum(1 for _, g in rows for r in g if r["confirmed"] == GUESS and not r["auto"])
    print("  %d PART%s TO INSTALL (+%d set automatically)" % (acts, "" if acts == 1 else "S", len(auto_rows)), file=out)
    print("  LABEL CONFIDENCE   (blank)=proven   ~=right menu, exact item unproven   ?=hand-assigned", file=out)
    print("  %d proven · %d group · %d guess" % (acts - ng - nq, ng, nq), file=out)
    print("", file=out)
    print("  The INDEX on every row is byte-exact; only the item NAME can be off. You do not have to", file=out)
    print("  trust the names: install, save a setup on the replica, then re-run with --source <that", file=out)
    print("  container>. The diff is a checksum - when it prints CLONE EXACT the build is identical,", file=out)
    print("  regardless of what any label said. Each single-part step also names one slot for good.", file=out)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
