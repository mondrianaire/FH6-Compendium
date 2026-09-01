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


def describe(slot, pid, ordinal):
    """(index, human) for a part ID. index is None when the ID is not this car's own partset --
    engine internals legitimately carry the ENGINE's partset, not the car's."""
    _set, idx = T.split_part_id(ordinal, pid)
    if idx is None:
        return None, (str(pid) if pid is not None else "-")
    nm = tier_name(slot, idx)
    var, tier = divmod(idx, 100)
    txt = "idx %d" % idx
    if var:
        txt += " (body variant %d, tier %d)" % (var, tier)
    return idx, ("%s = %s" % (txt, nm) if nm else txt)


def build(target, source, ordinal):
    tp = target.get("parts") or {}
    sp = (source or {}).get("parts") or {}
    rows = []
    for menu, items in MENUS:
        got = []
        for slot, item, confirmed in items:
            tv, sv = tp.get(slot), sp.get(slot)
            if tv == sv or (tv is None and sv is None):
                continue
            ti, ttxt = describe(slot, tv, ordinal)
            si, stxt = describe(slot, sv, ordinal)
            got.append({"slot": slot, "item": item, "confirmed": confirmed,
                        "from": stxt, "to": ttxt, "from_idx": si, "to_idx": ti,
                        "engine_part": slot in ENGINE_INTERNALS})
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
    MARK = {PROVEN: "  ", GROUP: " ~", GUESS: " ?"}
    for menu, got in rows:
        print("  %s" % menu.upper(), file=out)
        for r in got:
            line = "  %s %-36s %s" % (MARK[r["confirmed"]], r["item"], r["to"])
            if r["from"] != "-" and sd is not None:
                line += "   (was %s)" % r["from"]
            print(line, file=out)
        print("", file=out)
    ng = sum(1 for _, g in rows for r in g if r["confirmed"] == GROUP)
    nq = sum(1 for _, g in rows for r in g if r["confirmed"] == GUESS)
    print("  LABEL CONFIDENCE   (blank)=proven   ~=right menu, exact item unproven   ?=hand-assigned", file=out)
    print("  %d proven · %d group · %d guess" % (total - ng - nq, ng, nq), file=out)
    print("", file=out)
    print("  The INDEX on every row is byte-exact; only the item NAME can be off. You do not have to", file=out)
    print("  trust the names: install, save a setup on the replica, then re-run with --source <that", file=out)
    print("  container>. The diff is a checksum - when it prints CLONE EXACT the build is identical,", file=out)
    print("  regardless of what any label said. Each single-part step also names one slot for good.", file=out)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
