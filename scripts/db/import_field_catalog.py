#!/usr/bin/env python3
"""import_field_catalog.py -- the field-level knowledge catalogue, as data.

This is where the knowledge this project has spent real time earning stops living only in code
comments, one person's external memory, and a markdown document no SQL query can reach.

Three tables:
  ref_field             -- one row per (store, field) this project has profiled: domain, storage
                           type, enum source, join target. Populated from data/field-catalog.json,
                           itself generated from docs/data-field-catalog-2026-09-03.md (86 stores).
  ref_field_gate        -- the dependency graph: which field, when it changes, changes what
                           ANOTHER field's tier names, tile count, or availability even mean.
                           Verified 2026-09-03 findings, hand-entered here because this is a small,
                           precisely-known set, not something to bulk-parse.
  ref_field_reliability -- the reliability hierarchy (memory fh6-slider-value-reliability-hierarchy)
                           as rows: for a field, every tier of evidence that CAN produce a value,
                           ranked 0 (the game's own physics table) to 5 (an honest "position only").
                           Also hand-entered: this is the exact, fully-enumerated set of per-car
                           slider fields and their real code paths, not a summary of something larger.

If data/field-catalog.json does not exist yet (the parse that produces it can be slow), ref_field
is simply left empty and the other two tables still populate -- this stage does not fail, and is
safe to re-run once the file exists.

Run:  python scripts/db/import_field_catalog.py [--db PATH] [-v]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

DATA = os.path.join(ROOT, "data")
NOW = fh6db.utcnow()


# ---- ref_field_reliability: the hierarchy, fully enumerated -----------------
# (store, field, tier, tier_name, why, source_fn). store is always 'tune_slider' here -- every one
# of these is a PER_CAR_FIELDS slider (fh6_tune_decode.py), and tune_slider (populated by
# import_containers.py from ref_part_slider, the game's own physics table) is tier 0 for all of them.
_TIER = {
    0: "database",
    1: "2-point solve",
    2: "global band (field-proven)",
    3: "mass-derived formula",
    4: "single anchor",
    5: "position-only",
}
_RELIABILITY = [
    # (field, [tiers that can apply], per-tier why override or None for the default)
    ("front_spring", [0, 1, 3, 4, 5], {
        3: "compounds an assumed frequency band with a captured car mass keyed by ordinal only, "
           "not by build -- confirmed 2026-09-03 to silently reuse one build's mass for another",
    }),
    ("rear_spring", [0, 1, 3, 4, 5], {
        3: "same mass-formula risk as front_spring",
    }),
    ("front_ride_height", [0, 1, 4, 5], None),
    ("rear_ride_height", [0, 1, 4, 5], None),
    ("front_downforce", [0, 1, 4, 5], {
        4: "confirmed 2026-09-03: a stale, never-unit-converted anchor (kgf read as if already lb) "
           "stood over the correct database value until it was marked derived",
    }),
    ("rear_downforce", [0, 1, 4, 5], None),
    ("final_drive", [0, 2, 5], {
        2: "VERIFIED 2026-09-01 without driving: reproduces the game's own GEARING tab to 0.01 for "
           "every car from the save file alone -- for this field the global band IS ground truth, "
           "not a guess, because the physics genuinely is shared across every car",
    }),
]
_WHY_DEFAULT = {
    0: "the game's own physics table (ref_part_slider), resolved by the exact part fitted in this "
       "exact container -- ground truth, verified 2026-09-03 to reproduce the live game exactly",
    1: "two independently captured readings that cross-check each other, but still keyed by car "
       "ordinal only (data/car-tune-ranges.json), not by build -- the same scoping gap as tier 4, "
       "just with one internal consistency check tier 4 lacks",
    2: "a value shared across every car -- trustworthy ONLY when independently proven game-fixed for "
       "this specific field; do not reuse this tier for a field that actually varies per car",
    3: "a computed model (mass * frequency-band physics), not a measurement -- two stacked "
       "assumptions producing a number that reads as precise as a real measurement but isn't",
    4: "one hand-typed reading, no second point to cross-check it against, same ordinal-only "
       "scoping as tier 3/4's mass capture",
    5: "the honest floor: no absolute value claimed, just the raw slider position -- ranks ABOVE a "
       "confident wrong number from any tier above it",
}
_SOURCE_FN = {
    0: "fillFromDb() dashboard/v2/live.js:888, overriding any Python-derived value marked derived=True",
    1: "parse_tune() 'if per_car and rng:' fh6_tune_decode.py",
    2: "parse_tune() 'elif per_car and gband:' fh6_tune_decode.py",
    3: "spring_rate_from_mass() fh6_tune_decode.py",
    4: "parse_tune() 'elif per_car and anchor is not None:' fh6_tune_decode.py",
    5: "parse_tune() 'elif per_car:' (unknown absolute range) fh6_tune_decode.py",
}


def _reliability_rows():
    rows = []
    for field, tiers, overrides in _RELIABILITY:
        overrides = overrides or {}
        for t in tiers:
            why = overrides.get(t) or _WHY_DEFAULT[t]
            rows.append(("tune_slider", field, t, _TIER[t], why, _SOURCE_FN[t]))
    rows += _parts_reliability_rows()
    rows += _scoping_reliability_rows()
    return rows


# ---- parts naming confidence: the ALREADY-STORED taxonomy, verified 2026-09-03 against the live
# database rather than assumed from the display-layer conf strings (_part_view's "named"/"category"/
# "dim"/"cosmetic" are a different, request-time-only axis -- this is the persistent column).
_PARTS_TIERS = [
    (0, "proven", "a captured/verified name -- a saved setup, a verified catalogue pair, or a name "
        "read off the game's own name bar for THIS car -- clone_parts.resolve_name's top grade"),
    (1, "derived", "matched a catalogue base+tier pattern (Stock/Street/Sport/Race) with no direct "
        "per-car proof -- usually right, occasionally wrong on a dense-in-variant or renamed ladder "
        "(the exact class of bug fixed 2026-09-03 for weight_reduction/roll_cage)"),
    (2, "unknown", "no proof and no confident pattern match -- honest, not a failure: 8 of 87,655 "
        "ref_part rows, 6,186 of 25,240 tune_part rows (stock/empty slots, not failures)"),
]


def _parts_reliability_rows():
    rows = []
    for store in ("ref_part", "tune_part"):
        for tier, name, why in _PARTS_TIERS:
            rows.append((store, "confidence", tier, name, why,
                        "clone_parts.resolve_name() / _proven_name() fh6_tune_decode.py"))
    return rows


# ---- the ordinal-only scoping weakness, as an explicit flagged row rather than only a memory file.
# Confirmed 2026-09-03: car-mass.json's ONE captured mass for ordinal 2866 was screenshotted from an
# "S1 800 AWD build" and silently reused when decoding an unrelated "A 700" build of the same car.
_SCOPING_WEAKNESS = [
    ("data/car-mass.json", "masses", 4,
     "keyed by car ORDINAL only, no parts-fingerprint -- one historical screenshot of ONE build's "
     "mass gets reused for every other build of that car, confirmed wrong 2026-09-03. Structural gap, "
     "not yet fixed: fillFromDb() (see ref_field_reliability for tune_slider.front_spring) makes this "
     "harmless wherever the database has its own row for the field, but does not close the gap itself."),
    ("data/car-tune-ranges.json", "points", 4,
     "the single-anchor points store, keyed by (ordinal, field) only -- same build-scoping gap as "
     "car-mass.json's masses, for the same reason: nothing records which build a captured point came "
     "from, so a point from one build can silently stand in for an unrelated build of the same car."),
]


def _scoping_reliability_rows():
    return [(store, field, tier, "single anchor (unscoped)", why,
            "data/car-mass.json / data/car-tune-ranges.json, read by fh6_tune_decode.py")
            for store, field, tier, why in _SCOPING_WEAKNESS]


# ---- ref_field_gate: the dependency graph, hand-verified this session -------
_GATES = [
    ("tune_part", "car_body", "tune_part", "weight_reduction", "changes tier names",
     "2026-09-03 dense-in-variant finding: weight_reduction's tile NAME at a given index depends on "
     "this car's body-variant tile count, not a fixed Stock/Street/Sport/Race ladder"),
    ("tune_part", "car_body", "tune_part", "roll_cage", "changes tier names",
     "same dense-in-variant mechanism as weight_reduction"),
    ("tune_part", "car_body", "tune_part", "front_bumper", "removes tile",
     "docs/fh6-ui-spec.md:175 -- after the Rocket Bunny body kit the Front Bumper tile disappears "
     "from Aero and Appearance"),
    ("tune_part", "engine", "tune_part", "camshaft", "changes menu contents",
     "docs/fh6-ui-spec.md section 9.1 -- the Engine menu's tile count and contents depend on the "
     "fitted engine swap"),
    ("tune_part", "aspiration", "tune_part", "intercooler", "changes tile count",
     "docs/fh6-ui-spec.md 9.1/10.6 -- 8 Engine sub-menus with no forced-induction conversion, 12 "
     "once one is fitted (the aspirator's own tier tile plus Intercooler only exist then)"),
    ("tune_part", "drivetrain", "tune_part", "differential", "changes menu contents",
     "docs/fh6-ui-spec.md 9.2/2.6 -- Drivetrain Swap changes what the Drivetrain category even "
     "offers (AWD-specific parts appear only after the swap)"),
]


def run(cx, verbose=False):
    counts = {}
    with cx:
        cx.execute("PRAGMA defer_foreign_keys=ON")
        for t in ("ref_field", "ref_field_gate", "ref_field_reliability"):
            cx.execute("DELETE FROM %s" % t)

        field_rows = []
        cat_path = os.path.join(DATA, "field-catalog.json")
        if os.path.exists(cat_path):
            try:
                with open(cat_path, encoding="utf-8") as fh:
                    cat = json.load(fh)
                for r in cat:
                    field_rows.append((r.get("store"), r.get("field"), r.get("domain"),
                                       r.get("storage_type"), r.get("enum_source"),
                                       r.get("join_target"), r.get("notes")))
            except Exception as e:                        # noqa: BLE001
                if verbose:
                    print("  field-catalog.json unreadable, ref_field left empty: %r" % (e,))
        elif verbose:
            print("  data/field-catalog.json not found yet -- ref_field left empty, safe to re-run")
        counts["ref_field"] = fh6db.upsert_many(cx, "ref_field", [
            "store", "field", "domain", "storage_type", "enum_source", "join_target", "notes"],
            field_rows)

        counts["ref_field_gate"] = fh6db.upsert_many(cx, "ref_field_gate", [
            "gating_store", "gating_field", "gated_store", "gated_field", "mechanism", "evidence"],
            _GATES)

        counts["ref_field_reliability"] = fh6db.upsert_many(cx, "ref_field_reliability", [
            "store", "field", "tier", "tier_name", "why", "source_fn"], _reliability_rows())
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "field_catalog", DATA)
    try:
        counts = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1, json.dumps(counts))
    for k in sorted(counts):
        print("  %-24s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
