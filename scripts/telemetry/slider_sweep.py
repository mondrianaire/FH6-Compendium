#!/usr/bin/env python3
"""slider_sweep.py -- plan and track a one-slider-at-a-time sweep, so slider effects can be measured.

WHY THIS EXISTS. Nothing in the lap corpus can tell us what a slider does. Measured 2026-09-18 over
1,546 laps: exactly ONE cell of (route x car x hw_hash x tune_hash) holds two tunes on identical
hardware -- route:6001, the Exocet at 700 PI -- and those two tunes differ in SEVEN sliders at once
(final drive, front downforce, both ride heights, front spring, front toe, rear ARB). Every other
repeat changes the build too: 31 route x car cells vary hw_hash. So every apparent slider/behaviour
correlation in the archive is confounded, and no amount of further free driving fixes it, because
normal play never holds 35 sliders still while moving one.

A transfer function has to be DRIVEN into existence. One car, one build, one course, one slider
moved at a time, n laps per level. That is what this plans.

ATTRIBUTION IS AUTOMATIC. The driver labels nothing. Each level is saved as a tune, the save-tune
decode already reads all 36 sliders off disk, and `lap.tune_hash` already binds a lap to that exact
slider set. So `status` recovers which cell a lap belongs to by comparing decoded slider VALUES to
the plan -- never by a name typed in-game, which would be a human field and therefore wrong
eventually. A lap whose slider set matches no cell is reported as unattributed rather than
force-fitted to the nearest one.

THE BASELINE IS NEW, NOT AN EXISTING TUNE. Jett's tunes sit on the rails: the Exocet's "go kart"
(Tuning_2866_20260911191636) is at MAX on front ARB, both springs, both rebounds, both downforce
and both ride heights. Sweeping up from a rail produces a level identical to the baseline, so nine
of the sliders would contribute one usable level instead of two. The plan therefore emits its own
mid-range baseline as cell 0, and every other cell moves exactly one slider off it.

THE LEVELS ARE A JUDGEMENT, STATED HERE SO IT CAN BE ARGUED WITH. A blanket 10/50/90 percent of
each slider's range is right for the ones whose whole range is drivable (springs, ARB, damping,
downforce) and wrong for the ones whose range includes settings no one would ever run: 20% brake
pressure does not brake, +5 deg of toe does not drive, and a final drive at either stop spends the
whole lap in one gear and measures gearing rather than the slider. Those get hand-set ladders. See
LADDERS below; each entry says what it is in the slider's own unit.

DRIVETRAIN-INERT SLIDERS ARE SKIPPED -- BY THE BUILD'S DRIVETRAIN, NOT THE CAR'S. A RWD car has no
front differential and no centre differential, and sweeping front_diff_accel on one would spend six
laps measuring nothing. But the drivetrain that matters is the one BOLTED IN, not the one the car
left the factory with: ref_car says the Exocet is RWD, while the build this sweep pins
(hw b309f89c1c29de60) carries drivetrain_id 2102, an AWD swap set, and a 10-speed box against the
car's stock 6. Reading the stock field dropped three sliders the build actually has. The plan now
reads tune_container.drivetrain_id -> ref_drivetrain.drivetype and only falls back to ref_car when
the container decodes no drivetrain, and the checklist prints which of the two it used.

BASELINE RE-ANCHORING. Over a 130-lap protocol the driver gets faster, and that drift is larger
than most slider effects. The plan interleaves a baseline re-drive every RE_ANCHOR_EVERY cells, so
`status` can measure the drift and the analysis can subtract it instead of reading it as a result.

Run:
    python scripts/telemetry/slider_sweep.py plan --car 2866 --route route:6001 \
        --hw b309f89c1c29de60 --baseline-from Tuning_2866_20260911191636
    python scripts/telemetry/slider_sweep.py status
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "db"))

import fh6db                                            # noqa: E402

PLAN_PATH = os.path.join(ROOT, "data", "sweep-plan.json")

LAPS_PER_CELL = 3         # enough to see a median move; the driver can add more, never fewer
RE_ANCHOR_EVERY = 5       # cells between baseline re-drives, to measure driver drift
MATCH_TOL = 1e-3          # fraction of a slider's range; two decoded values closer than this are one setting

# Sliders that only exist on some drivetrains. Sweeping one the car does not have measures nothing.
DRIVETRAIN_ONLY = {
    "front_diff_accel": ("AWD", "FWD"),
    "front_diff_decel": ("AWD", "FWD"),
    "center_diff": ("AWD",),
    "rear_diff_accel": ("AWD", "RWD"),
    "rear_diff_decel": ("AWD", "RWD"),
}

# Never swept: not a tuning slider, or not independently settable in the FH tuning menu.
SKIP = {"handbrake", "tcs_slip", "rear_caster"}

# Level ladders. "frac" = fraction of the car's own min..max for this slider, which is right when the
# whole range is drivable. "abs" = values in the slider's own unit, for ranges whose ends are not.
LADDERS = {
    "front_spring":        ("frac", (0.10, 0.50, 0.90)),
    "rear_spring":         ("frac", (0.10, 0.50, 0.90)),
    "front_arb":           ("frac", (0.10, 0.50, 0.90)),
    "rear_arb":            ("frac", (0.10, 0.50, 0.90)),
    "front_bump":          ("frac", (0.10, 0.50, 0.90)),
    "rear_bump":           ("frac", (0.10, 0.50, 0.90)),
    "front_rebound":       ("frac", (0.10, 0.50, 0.90)),
    "rear_rebound":        ("frac", (0.10, 0.50, 0.90)),
    "front_downforce":     ("frac", (0.00, 0.50, 1.00)),   # the range IS the wing, both ends are raced
    "rear_downforce":      ("frac", (0.00, 0.50, 1.00)),
    "front_ride_height":   ("frac", (0.00, 0.50, 1.00)),   # already a narrow band in metres
    "rear_ride_height":    ("frac", (0.00, 0.50, 1.00)),
    "front_caster":        ("frac", (0.00, 0.50, 1.00)),
    "front_camber":        ("abs",  (-3.0, -1.0, 0.5)),    # deg; the tuned range, not the +-5 the slider allows
    "rear_camber":         ("abs",  (-3.0, -1.0, 0.5)),
    "front_toe":           ("abs",  (-0.5, 0.0, 0.5)),     # deg
    "rear_toe":            ("abs",  (-0.5, 0.0, 0.5)),
    "front_tire_pressure": ("abs",  (20.0, 30.0, 45.0)),   # psi
    "rear_tire_pressure":  ("abs",  (20.0, 30.0, 45.0)),
    "brake_pressure":      ("abs",  (80.0, 115.0, 165.0)), # %; below ~80 the car will not stop
    "brake_balance":       ("abs",  (40.0, 50.0, 60.0)),   # % front
    "final_drive":         ("frac", (0.25, 0.50, 0.75)),   # either stop pins the lap in one gear
    "front_diff_accel":    ("abs",  (10.0, 50.0, 90.0)),   # %
    "front_diff_decel":    ("abs",  (10.0, 50.0, 90.0)),
    "rear_diff_accel":     ("abs",  (10.0, 50.0, 90.0)),
    "rear_diff_decel":     ("abs",  (10.0, 50.0, 90.0)),
    "center_diff":         ("abs",  (30.0, 60.0, 90.0)),   # % rear
}

LEVEL_NAMES = ("low", "mid", "high")

# The order the FH tuning menu presents its tabs. Driving the sweep in menu order means the driver
# stays on one tab for a run of cells instead of walking the whole menu between every lap set.
MENU_ORDER = [
    "front_tire_pressure", "rear_tire_pressure",
    "final_drive",
    "front_camber", "rear_camber", "front_toe", "rear_toe", "front_caster",
    "front_arb", "rear_arb",
    "front_spring", "rear_spring", "front_ride_height", "rear_ride_height",
    "front_bump", "rear_bump", "front_rebound", "rear_rebound",
    "front_downforce", "rear_downforce",
    "brake_balance", "brake_pressure",
    "center_diff", "front_diff_accel", "front_diff_decel", "rear_diff_accel", "rear_diff_decel",
]


def menu_rank(slider):
    return MENU_ORDER.index(slider) if slider in MENU_ORDER else len(MENU_ORDER)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def ladder_for(slider, lo, hi):
    """The three values for one slider, in the slider's own unit, clamped to what the car allows."""
    kind, vals = LADDERS[slider]
    if kind == "frac":
        out = [lo + f * (hi - lo) for f in vals]
    else:
        out = [clamp(v, lo, hi) for v in vals]
    return [round(v, 4) for v in out]


def read_ranges(cx, container):
    """Every slider's current value and the car's own min/max, from the decoded baseline tune."""
    rows = cx.execute("""SELECT slider, value, norm, min_value, max_value, unit, locked
                         FROM tune_slider WHERE container=? AND slider NOT LIKE '\\_unk%' ESCAPE '\\'
                         ORDER BY slider""", (container,)).fetchall()
    return {r["slider"]: dict(r) for r in rows}


def cmd_plan(args):
    cx = fh6db.connect(ro=True)
    car = cx.execute("""SELECT ordinal, display_name, drivetype, class, pi, num_gears
                        FROM ref_car WHERE ordinal=?""", (args.car,)).fetchone()
    if not car:
        sys.exit("no ref_car row for ordinal %s" % args.car)
    # The BUILT drivetrain and gearbox, not the stock ones. See the module docstring.
    built = cx.execute("""SELECT d.drivetype, c.gear_count, c.drivetrain_id
                          FROM tune_container c LEFT JOIN ref_drivetrain d
                            ON d.drivetrain_id = c.drivetrain_id
                          WHERE c.container=?""", (args.baseline_from,)).fetchone()
    course = cx.execute("SELECT name, length_m, turn_count FROM course WHERE route_key=?",
                        (args.route,)).fetchone()
    ranges = read_ranges(cx, args.baseline_from)
    if not ranges:
        sys.exit("no decoded sliders for container %s -- equip the build and save a tune first"
                 % args.baseline_from)

    drive = ((built["drivetype"] if built and built["drivetype"] else car["drivetype"]) or "").upper()
    drive_src = ("build (drivetrain_id %s)" % built["drivetrain_id"]) if (built and built["drivetype"])         else "ref_car stock drivetype -- the container decoded no drivetrain"
    gears = (built["gear_count"] if built and built["gear_count"] else car["num_gears"])
    swept, skipped = [], []
    for slider, r in sorted(ranges.items()):
        if slider in SKIP:
            skipped.append((slider, "not an independently settable tuning slider"))
            continue
        if slider in DRIVETRAIN_ONLY and drive not in DRIVETRAIN_ONLY[slider]:
            skipped.append((slider, "%s build has no such differential" % drive))
            continue
        if slider not in LADDERS:
            skipped.append((slider, "no ladder defined"))
            continue
        if r["locked"]:
            skipped.append((slider, "locked by the build"))
            continue
        lo, hi = r["min_value"], r["max_value"]
        if lo is None or hi is None or hi <= lo:
            skipped.append((slider, "no usable range decoded (%s..%s)" % (lo, hi)))
            continue
        swept.append((slider, r, ladder_for(slider, lo, hi)))
    swept.sort(key=lambda t: menu_rank(t[0]))

    # The baseline is every swept slider at its own mid level; anything not swept keeps the
    # value the reference tune already carries, so the car remains the one that was driven.
    baseline = {s: r["value"] for s, r in ranges.items() if r["value"] is not None}
    for slider, _r, vals in swept:
        baseline[slider] = vals[1]

    cells = [{
        "cell_id": "baseline",
        "slider": None, "level": "mid", "value": None, "unit": None,
        "laps_wanted": LAPS_PER_CELL,
        "note": "build this once and save it; every other cell is this tune with ONE slider moved",
    }]
    for slider, r, vals in swept:
        for li, lv in enumerate(LEVEL_NAMES):
            if li == 1:
                continue                                  # mid IS the baseline; driving it twice buys nothing
            cells.append({
                "cell_id": "%s:%s" % (slider, lv),
                "slider": slider, "level": lv,
                "value": vals[li], "unit": r["unit"],
                "baseline_value": vals[1],
                "range": [r["min_value"], r["max_value"]],
                "laps_wanted": LAPS_PER_CELL,
            })

    # Re-anchors: a baseline re-drive every RE_ANCHOR_EVERY cells, to measure driver drift.
    # A re-anchor is due every RE_ANCHOR_EVERY cells, but it is only TAKEN at a pair boundary:
    # splitting a slider's low from its high would put the drift correction inside the one
    # comparison it exists to protect.
    ordered, n, since = [], 0, 0
    for c in cells:
        ordered.append(c)
        if c["cell_id"] == "baseline":
            continue
        n += 1
        since += 1
        if since >= RE_ANCHOR_EVERY and c["level"] == "high":
            ordered.append({"cell_id": "baseline@%d" % n, "slider": None, "level": "mid",
                            "value": None, "unit": None, "laps_wanted": 1,
                            "note": "re-anchor: restore the baseline tune and drive one lap"})
            since = 0

    plan = {
        "schema": 1,
        "created_utc": fh6db.utcnow(),
        "car": {"ordinal": car["ordinal"], "name": car["display_name"], "drivetype": drive,
                "class": car["class"], "pi": car["pi"], "gears": gears,
                "stock_drivetype": car["drivetype"], "drivetrain_source": drive_src},
        "route_key": args.route,
        "course": {"name": course["name"] if course else None,
                   "length_m": course["length_m"] if course else None,
                   "turns": course["turn_count"] if course else None},
        "hw_hash": args.hw,
        "baseline_from": args.baseline_from,
        "laps_per_cell": LAPS_PER_CELL,
        "re_anchor_every": RE_ANCHOR_EVERY,
        "baseline_sliders": {k: round(v, 4) for k, v in sorted(baseline.items())},
        "swept": [s for s, _r, _v in swept],
        "skipped": [{"slider": s, "why": w} for s, w in skipped],
        "cells": ordered,
    }
    total_laps = sum(c["laps_wanted"] for c in ordered)
    plan["totals"] = {"cells": len(ordered), "sliders": len(swept), "laps": total_laps}

    if args.dry:
        json.dump(plan, sys.stdout, indent=1)
        print()
    else:
        with open(PLAN_PATH, "w", encoding="utf-8") as fh:
            json.dump(plan, fh, indent=1)
        print("wrote %s" % os.path.relpath(PLAN_PATH, ROOT))
    print("%s on %s: %d sliders, %d cells, %d laps (%d skipped sliders)"
          % (plan["car"]["name"], plan["course"]["name"] or args.route,
             len(swept), len(ordered), total_laps, len(skipped)))
    for s, w in skipped:
        print("  skipped %-20s %s" % (s, w))


def load_plan():
    if not os.path.exists(PLAN_PATH):
        sys.exit("no %s -- run `plan` first" % os.path.relpath(PLAN_PATH, ROOT))
    with open(PLAN_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def match_cell(plan, sliders):
    """Which cell is this decoded slider set? Exact by VALUE, never by the tune's name.

    A cell matches when every swept slider sits at its baseline except the one the cell moves,
    which sits at the cell's level. Anything else is unattributed and says so.
    """
    base = plan["baseline_sliders"]
    ranges = {}
    for c in plan["cells"]:
        if c.get("range") and c["slider"]:
            ranges[c["slider"]] = c["range"]

    def same(slider, a, b):
        if a is None or b is None:
            return a is b
        lo, hi = ranges.get(slider, (None, None))
        span = (hi - lo) if (lo is not None and hi is not None and hi > lo) else max(abs(b), 1.0)
        return abs(a - b) <= MATCH_TOL * span

    off = [s for s in plan["swept"] if not same(s, sliders.get(s), base.get(s))]
    if not off:
        return "baseline"
    if len(off) > 1:
        return None
    s = off[0]
    for c in plan["cells"]:
        if c["slider"] == s and same(s, sliders.get(s), c["value"]):
            return c["cell_id"]
    return None


def cmd_status(args):
    plan = load_plan()
    cx = fh6db.connect(ro=True)
    want = {}
    for c in plan["cells"]:
        cid = c["cell_id"].split("@")[0]                  # re-anchors fold into the baseline cell
        want[cid] = want.get(cid, 0) + c["laps_wanted"]

    # Every tune on the pinned hardware, decoded, mapped to a cell.
    cell_of = {}
    for tc in cx.execute("""SELECT container, tune_hash FROM tune_container WHERE hw_hash=?""",
                         (plan["hw_hash"],)):
        sl = {r["slider"]: r["value"] for r in
              cx.execute("SELECT slider, value FROM tune_slider WHERE container=?", (tc["container"],))}
        cid = match_cell(plan, sl)
        if cid:
            cell_of[tc["tune_hash"]] = cid

    laps = cx.execute("""SELECT tune_hash, hw_hash, lap_s, coalesce(void,0) void, coalesce(official,0) official
                         FROM lap WHERE route_key=? AND tune_hash IS NOT NULL""",
                      (plan["route_key"],)).fetchall()
    got, wrong_hw, unattributed = {}, 0, 0
    for lp in laps:
        if lp["void"]:
            continue
        if lp["hw_hash"] != plan["hw_hash"]:
            wrong_hw += 1                                 # the confound guard: a different build is not this sweep
            continue
        cid = cell_of.get(lp["tune_hash"])
        if not cid:
            unattributed += 1
            continue
        got.setdefault(cid, []).append(lp["lap_s"])

    print("%s on %s -- hw %s" % (plan["car"]["name"], plan["course"]["name"] or plan["route_key"],
                                 plan["hw_hash"]))
    done = sum(1 for cid in want if len(got.get(cid, [])) >= want[cid])
    print("cells complete: %d/%d   laps captured: %d   (%d on other hardware, %d unattributed)"
          % (done, len(want), sum(len(v) for v in got.values()), wrong_hw, unattributed))
    print()
    for c in plan["cells"]:
        cid = c["cell_id"]
        if "@" in cid:
            continue
        v = got.get(cid, [])
        mark = "[x]" if len(v) >= want[cid] else "[ ]"
        best = ("  best %.2fs" % min(v)) if v else ""
        val = "" if c["value"] is None else "  %s %s" % (c["value"], c["unit"] or "")
        print("%s %-28s %d/%d%s%s" % (mark, cid, len(v), want[cid], val, best))


def cmd_checklist(args):
    """The driving order, in the slider's own unit, as the tuning menu shows it.

    Generated rather than written, so it can never drift from the plan the status command scores
    against -- the failure mode where the paper says one thing and the analysis expects another.
    """
    plan = load_plan()
    out = [
        "# Slider sweep -- %s on %s" % (plan["car"]["name"], plan["course"]["name"] or plan["route_key"]),
        "",
        "*Generated by `scripts/telemetry/slider_sweep.py checklist` from `data/sweep-plan.json`.",
        "Do not hand-edit: `status` scores against the plan, not against this page.*",
        "",
        "%s **%s**, %s PI %s, %d gears - %s, %.0f m, %s turns - build pinned to `hw_hash %s`."
        % (plan["car"]["name"], plan["car"]["drivetype"], plan["car"]["class"], plan["car"]["pi"],
           plan["car"]["gears"] or 0, plan["course"]["name"] or plan["route_key"],
           plan["course"]["length_m"] or 0, plan["course"]["turns"], plan["hw_hash"]),
        "",
        "Drivetrain read from the %s; the car is **%s** stock. That is what decides which "
        "differential sliders are swept." % (plan["car"].get("drivetrain_source", "?"),
                                             plan["car"].get("stock_drivetype", "?")),
        "",
        "**%d sliders, %d cells, %d laps.** %d laps per cell, a baseline re-drive every %d cells."
        % (plan["totals"]["sliders"], plan["totals"]["cells"], plan["totals"]["laps"],
           plan["laps_per_cell"], plan["re_anchor_every"]),
        "",
        "## The rules that make it measurable",
        "",
        "1. **Never change the build.** Not one part, not the tyre compound. A different `hw_hash` is a",
        "   different experiment and `status` will refuse those laps.",
        "2. **One slider off baseline at a time.** Restore it before moving the next.",
        "3. **Save a tune for every cell.** The name does not matter - attribution reads the decoded",
        "   slider values, not the name. But an unsaved change is invisible to the lab and the laps are lost.",
        "4. **Drive the re-anchors.** They measure how much faster you got during the session, which is",
        "   otherwise indistinguishable from a slider working.",
        "5. Assists and driving line stay exactly as they are for the whole sweep.",
        "",
        "## Baseline tune (build once, cell 0)",
        "",
        "| slider | value |",
        "| --- | --- |",
    ]
    swept = set(plan["swept"])
    for k, v in plan["baseline_sliders"].items():
        if k.startswith("_unk") or k not in swept:
            continue
        out.append("| %s | %s |" % (k, v))
    out += ["", "Sliders not listed keep whatever `%s` already carries; they are not swept "
                "(see the plan's `skipped`)." % plan["baseline_from"], "",
            "## Cells, in driving order", "",
            "| # | cell | set | to | laps |", "| --- | --- | --- | --- | --- |"]
    for i, c in enumerate(plan["cells"], 1):
        if c["slider"] is None:
            out.append("| %d | **%s** | *restore the baseline tune* | - | %d |"
                       % (i, c["cell_id"], c["laps_wanted"]))
        else:
            out.append("| %d | %s | %s | **%s %s** (baseline %s) | %d |"
                       % (i, c["cell_id"], c["slider"], c["value"], c["unit"] or "",
                          c["baseline_value"], c["laps_wanted"]))
    out += ["", "## Progress", "", "```bash",
            "python scripts/telemetry/slider_sweep.py status", "```", ""]
    path = args.out or os.path.join(ROOT, "docs", "slider-sweep-checklist.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print("wrote %s (%d cells)" % (os.path.relpath(path, ROOT), len(plan["cells"])))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="emit the sweep plan")
    p.add_argument("--car", type=int, required=True, help="car ordinal")
    p.add_argument("--route", required=True, help="route_key, e.g. route:6001")
    p.add_argument("--hw", required=True, help="hw_hash to pin the build to")
    p.add_argument("--baseline-from", required=True, help="container whose decoded ranges seed the plan")
    p.add_argument("--dry", action="store_true", help="print the plan, write nothing")
    p.set_defaults(fn=cmd_plan)
    s = sub.add_parser("status", help="how much of the sweep is driven")
    s.set_defaults(fn=cmd_status)
    k = sub.add_parser("checklist", help="write the driving checklist from the plan")
    k.add_argument("--out", help="path (default docs/slider-sweep-checklist.md)")
    k.set_defaults(fn=cmd_checklist)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
