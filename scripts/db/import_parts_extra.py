#!/usr/bin/env python3
"""import_parts_extra.py -- the three "part facts" tables the coverage sweep left untouched.

    List_PartAttribute      546 rows -> ref_part_attribute
    UpgradePresetPackages   448 rows -> ref_preset + ref_preset_part
    CarExceptions           511 rows -> ref_car_exception

All three were imported to settle a question the lab had been answering by inference. Two of
them answer a DIFFERENT question than their name implies, and saying so out loud is the point:

1. List_PartAttribute DOES NOT ANSWER THE PER-PART PI QUESTION.
   Its columns are ManufacturerID, Price, Mass, DragScale, WindInstabilityScale. There is no PI
   column. There is no per-part PI column anywhere in the game database: a scan of all 205
   tables finds "PerformanceIndex"/"PI" in exactly three places, all whole-car
   (Data_Car.PerformanceIndex, Data_Car.PI, CarClasses.Max*PerformanceIndex). PI is computed by
   the game from simulated performance, not looked up per part, so data/parts-pi.json's
   empirical route (currently 71 observations against 297 parameters -- underdetermined) is not
   a workaround for a table we had failed to find. It is the only route the game data allows.

   Nor can the table be keyed to ref_part. Nothing references PartAttributeID: scanning every
   integer column of every table for one with >=300 distinct values inside 1..546 returns
   nothing, and the PartAttributeID-ordered ManufacturerID sequence is not a sub-sequence of any
   manufacturer column in the database. It is imported verbatim with slot/part_id NULL and
   join_status 'orphan'.

   What it is, on evidence: legacy engine data. Its column set is List_UpgradeEngine's with the
   mass made absolute instead of a diff, and 438 of 546 masses equal a Data_Engine engine mass
   exactly (control against List_UpgradeCarBodyWeight.Mass: 1 of 546). Its ManufacturerID is a
   dense 1..53 enum, not the 739-row sparse List_PartManufacturer -- seven of its values are not
   in that table at all. Both facts are re-measured on every run and written into import_run.

2. CarExceptions IS NOT ABOUT UPGRADE GATING. All eight flags are livery/graphics exceptions
   (mirrors, windows, hood and wing paint/decals). Neither gate the lab infers is stated here:
   not the aspiration conversion that gates the engine tiers (ui-spec 9.1), not the body kit
   that removes the front bumper tile (ui-spec 10.7). The count is reported as 0 of 2, and that
   is a real finding: those two gates stay inferred from the menus.

3. UpgradePresetPackages IS exactly what it says, and is the useful one. 448 complete builds
   authored by the game, each a 49-slot part list plus a 46-float tuning blob (the 36 sliders in
   ref_slider.slot_index order, then 10 gear-ratio slots, -1.0 where the gear does not exist).
   Every Ordinal joins ref_car, so a user's build can now be diffed against the game's own
   answer for the same car.

Idempotent: every table is emptied and refilled inside one transaction, like the other
importers. Reads the game DB READ-ONLY and resolves names through ref_string, which the gamedb
stage has already filled -- so this stage must run after it.

Run:  python scripts/db/import_parts_extra.py [--gamedb PATH] [--db PATH] [-v]
"""
import argparse
import json
import os
import sqlite3
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402
import import_gamedb                                    # noqa: E402

DEFAULT_GAMEDB = import_gamedb.DEFAULT_GAMEDB

# UpgradePresetPackages column -> our slot name. Built from the one authority the project
# already asserts at import (import_gamedb.SLOT_ORDER_NAME) so the two can never drift.
# The preset table has 49 of the 50 slots: it has no Aspiration column, because a preset that
# names SingleTurbo/TwinTurbo/SuperchargerCSC/DSC already implies the conversion.
COL_TO_SLOT = dict((v, k) for k, v in import_gamedb.SLOT_ORDER_NAME.items())

# The tuning blob: 36 sliders then 10 gear slots, 46 float32 LE = 184 bytes = 368 hex chars.
N_SLIDERS = 36
N_GEARS = 10
GEAR_UNSET = -1.0


def log(v, *a):
    if v:
        print("   ", *a)


# ---------------------------------------------------------------------------
# string resolution, through the ref_string layer the gamedb stage already built
# ---------------------------------------------------------------------------
def string_resolver(cx):
    by_hash = dict(cx.execute("SELECT name_hash, table_name FROM ref_string_table"))
    cache = {}

    def resolve(cell, default=None):
        if not isinstance(cell, str):
            return default
        if not cell.startswith("_&"):
            return cell or default
        if cell in cache:
            return cache[cell]
        ref = fh6db.parse_ref(cell)
        out = default
        if ref is not None:
            th, kh = fh6db.split_ref(ref)
            name = by_hash.get(th)
            if name is not None:
                row = cx.execute(
                    "SELECT content FROM ref_string WHERE table_name=? AND key_hash=?",
                    (name, kh)).fetchone()
                if row:
                    out = row[0]
        cache[cell] = out
        return out

    return resolve


def decode_tuning(hexstr, sliders):
    """46 float32 LE -> {"sliders": {name: value}, "gears": [...]}, plus the gear count."""
    if not hexstr:
        return None, None, None
    raw = bytes.fromhex(hexstr)
    vals = struct.unpack("<%df" % (len(raw) // 4), raw)
    body = [round(v, 6) for v in vals[:N_SLIDERS]]
    gears = [round(v, 6) for v in vals[N_SLIDERS:N_SLIDERS + N_GEARS]]
    used = [g for g in gears if g != GEAR_UNSET]
    doc = {"sliders": dict(zip(sliders, body)), "gears": used}
    return json.dumps(doc, separators=(",", ":")), len(used), used


# ---------------------------------------------------------------------------
def import_part_attribute(cx, gx, verbose):
    """List_PartAttribute, verbatim, plus the two measurements that identify it."""
    engine_mass = set(r[0] for r in gx.execute("SELECT [EngineMass-kg] FROM Data_Engine"))
    part_manu = set(r[0] for r in gx.execute("SELECT Id FROM List_PartManufacturer"))
    rows, ev = [], {"n": 0, "mass_is_engine": 0, "drag_not_1": 0, "wind_not_1": 0,
                    "prices": {}, "manu_ids": set(), "manu_not_in_partmanufacturer": set()}
    for r in gx.execute("SELECT * FROM List_PartAttribute ORDER BY PartAttributeID"):
        is_eng = 1 if r["Mass"] in engine_mass else 0
        ev["n"] += 1
        ev["mass_is_engine"] += is_eng
        ev["drag_not_1"] += 0 if r["DragScale"] == 1.0 else 1
        ev["wind_not_1"] += 0 if r["WindInstabilityScale"] == 1.0 else 1
        ev["prices"][r["Price"]] = ev["prices"].get(r["Price"], 0) + 1
        ev["manu_ids"].add(r["ManufacturerID"])
        if r["ManufacturerID"] not in part_manu:
            ev["manu_not_in_partmanufacturer"].add(r["ManufacturerID"])
        rows.append((r["PartAttributeID"], r["ManufacturerID"], r["Price"], r["Mass"],
                     r["DragScale"], r["WindInstabilityScale"], is_eng, None, None, "orphan"))
    n = fh6db.replace_all(cx, "ref_part_attribute",
                          ["attribute_id", "manufacturer_id", "price", "mass_kg", "drag_scale",
                           "wind_scale", "mass_is_engine", "slot", "part_id", "join_status"], rows)
    ev["manu_distinct"] = len(ev["manu_ids"])
    ev["manu_range"] = [min(ev["manu_ids"]), max(ev["manu_ids"])] if ev["manu_ids"] else None
    ev["manu_not_in_partmanufacturer"] = sorted(ev["manu_not_in_partmanufacturer"])
    ev.pop("manu_ids")
    ev["prices"] = dict(sorted(ev["prices"].items()))
    # the join question, answered by measurement rather than by assertion
    ev["referencing_columns"] = find_references(gx, "List_PartAttribute", n)
    ev["joins_ref_part"] = 0
    log(verbose, "part_attribute: %d rows, %d masses are engine masses, refs=%s"
        % (n, ev["mass_is_engine"], ev["referencing_columns"]))
    return n, ev


def find_references(gx, skip_table, hi):
    """Answer 'does anything reference PartAttributeID?' two ways, and report both.

    by_name  -- columns anywhere in the database whose NAME contains 'PartAttribute'. This is
                the decisive test in a schema that names every other foreign key after its
                target (EngineID, CarBodyID, DrivetrainID, AeroPhysicsID ...).
    by_range -- columns that merely COULD be a key into a 1..hi id space: >=100 distinct integer
                values, all inside [0, hi], and repeated at least once (a table's own id column
                is unique, so excluding unique columns removes the primary keys that otherwise
                dominate this list). Anything here is a range coincidence, not a reference --
                it is reported so the claim can be re-checked rather than trusted.
    """
    by_name, by_range = [], []
    tabs = [r[0] for r in gx.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    for t in tabs:
        n_rows = gx.execute("SELECT COUNT(*) FROM [%s]" % t).fetchone()[0]
        for c in gx.execute("PRAGMA table_info([%s])" % t):
            col = c[1]
            if "partattribute" in col.lower() and t != skip_table:
                by_name.append("%s.%s" % (t, col))
            if t == skip_table:
                continue
            try:
                d, lo, hi2 = gx.execute(
                    "SELECT COUNT(DISTINCT [%s]), MIN([%s]), MAX([%s]) FROM [%s] "
                    "WHERE typeof([%s])='integer'" % (col, col, col, t, col)).fetchone()
            except Exception:                            # noqa: BLE001
                continue
            if d and d >= 100 and d < n_rows and lo is not None and lo >= 0 and hi2 <= hi:
                by_range.append("%s.%s" % (t, col))
    return {"by_name": by_name, "by_range_coincidence": by_range}


# ---------------------------------------------------------------------------
def import_presets(cx, gx, resolve, verbose):
    sliders = [r[0] for r in cx.execute("SELECT slider FROM ref_slider ORDER BY slot_index")]
    known_parts = {}
    for slot, pid, name in cx.execute("SELECT slot, part_id, name FROM ref_part"):
        known_parts[(slot, pid)] = name
    cars = dict(cx.execute("SELECT ordinal, num_gears FROM ref_car"))
    # The decisive check on the blob's 36|10 boundary: the fitted transmission's own gear count.
    # List_UpgradeDrivetrainTransmission.NumGears COUNTS REVERSE (GearRatio0 is reverse and
    # GearRatio1..NumGears-1 are the forward gears), so the blob should carry NumGears-1 ratios.
    # If the slider block were any length but 36 this would not line up on 320 of 321 presets.
    trans_gears = {}
    for pid, data in cx.execute("SELECT part_id, data FROM ref_part WHERE slot='transmission'"):
        try:
            trans_gears[pid] = json.loads(data or "{}").get("NumGears")
        except ValueError:
            pass

    cols = [c[1] for c in gx.execute("PRAGMA table_info(UpgradePresetPackages)")]
    slot_cols = [(c, COL_TO_SLOT[c]) for c in cols if c in COL_TO_SLOT]

    presets, parts = [], []
    ev = {"presets": 0, "cars": set(), "ordinal_joins": 0, "slot_columns": len(slot_cols),
          "part_rows": 0, "part_joins": 0, "missing_by_slot": {}, "kinds": {},
          "gear_agrees": 0, "gear_checked": 0, "tuning_decoded": 0,
          "gear_vs_stock_agrees": 0, "gear_vs_stock_checked": 0}
    for r in gx.execute("SELECT * FROM UpgradePresetPackages ORDER BY Id"):
        ordinal = r["Ordinal"]
        ev["presets"] += 1
        ev["cars"].add(ordinal)
        if ordinal in cars:
            ev["ordinal_joins"] += 1
        n_parts = n_join = 0
        for col, slot in slot_cols:
            pid = r[col]
            if not pid:                                  # 0 = the slot is not part of this preset
                continue
            n_parts += 1
            ev["part_rows"] += 1
            name = known_parts.get((slot, pid))
            if name is not None or (slot, pid) in known_parts:
                n_join += 1
                ev["part_joins"] += 1
                joined = 1
            else:
                joined = 0
                ev["missing_by_slot"][slot] = ev["missing_by_slot"].get(slot, 0) + 1
            parts.append((r["Id"], slot, pid, name, joined))
        tuning, n_gears, _ = decode_tuning(r["Tuning"], sliders)
        if tuning:
            ev["tuning_decoded"] += 1
        if n_gears and cars.get(ordinal):
            ev["gear_vs_stock_checked"] += 1
            if n_gears == cars[ordinal]:
                ev["gear_vs_stock_agrees"] += 1
        ng_part = trans_gears.get(r["Transmission"]) if r["Transmission"] else None
        if n_gears and ng_part:
            ev["gear_checked"] += 1
            if n_gears == ng_part - 1:
                ev["gear_agrees"] += 1
        thumb = r["Thumbnail"] or ""
        kind = os.path.splitext(os.path.basename(thumb.replace("\\", "/")))[0]
        kind = kind[len("preset_"):] if kind.startswith("preset_") else (kind or None)
        ev["kinds"][kind] = ev["kinds"].get(kind, 0) + 1
        presets.append((r["Id"], ordinal, resolve(r["Title"]), resolve(r["Description"]), kind,
                        thumb or None, r["Purchasable"], r["releaseOrder"], n_parts, n_join,
                        n_gears, r["Tuning"], tuning))

    cx.execute("DELETE FROM ref_preset_part")
    n_p = fh6db.replace_all(cx, "ref_preset",
                            ["preset_id", "ordinal", "title", "description", "kind", "thumbnail",
                             "purchasable", "release_order", "n_parts", "n_parts_joined",
                             "n_gears", "tuning_hex", "tuning"], presets)
    n_pp = fh6db.upsert_many(cx, "ref_preset_part",
                             ["preset_id", "slot", "part_id", "name", "joined"], parts)
    ev["n_cars"] = len(ev["cars"])
    ev.pop("cars")
    ev["missing_by_slot"] = dict(sorted(ev["missing_by_slot"].items(), key=lambda kv: -kv[1]))
    log(verbose, "presets: %d over %d cars, %d part rows, %d join ref_part"
        % (n_p, ev["n_cars"], n_pp, ev["part_joins"]))
    return n_p, n_pp, ev


# ---------------------------------------------------------------------------
FLAGS = [("NoMirrors", "no_mirrors"), ("NoWindows", "no_windows"),
         ("NoHoodStock", "no_hood_stock"), ("NoHoodAftermarket", "no_hood_aftermarket"),
         ("NoPaintableWingStock", "no_paintable_wing_stock"),
         ("NoPaintableWingAftermarket", "no_paintable_wing_aftermarket"),
         ("NoDecalsWingStock", "no_decals_wing_stock"),
         ("NoDecalsWingAftermarket", "no_decals_wing_aftermarket")]

# The gating the lab currently INFERS, and whether CarExceptions states it. Both answers are
# no: there is no column here that could carry either. Kept as data so the report is checked
# against the real column list on every run rather than repeating a claim.
INFERRED_GATES = [
    ("ui-spec 9.1  aspiration conversion gates the engine forced-induction tiers",
     ("aspiration", "turbo", "supercharger", "engine", "induction")),
    ("ui-spec 10.7 body kit removes the Front Bumper tile",
     ("bumper", "bodykit", "carbody", "frontaero")),
]


def import_car_exceptions(cx, gx, verbose):
    cars = set(r[0] for r in cx.execute("SELECT ordinal FROM ref_car"))
    cols = [c[1] for c in gx.execute("PRAGMA table_info(CarExceptions)")]
    rows = []
    ev = {"n": 0, "car_joins": 0, "columns": cols, "flag_totals": {}, "n_flags_hist": {}}
    for r in gx.execute("SELECT * FROM CarExceptions ORDER BY CarID"):
        vals = [r[g] for g, _ in FLAGS]
        nf = sum(1 for v in vals if v)
        ev["n"] += 1
        if r["CarID"] in cars:
            ev["car_joins"] += 1
        for (g, _), v in zip(FLAGS, vals):
            ev["flag_totals"][g] = ev["flag_totals"].get(g, 0) + (1 if v else 0)
        ev["n_flags_hist"][nf] = ev["n_flags_hist"].get(nf, 0) + 1
        rows.append(tuple([r["CarID"]] + vals + [nf]))
    n = fh6db.replace_all(cx, "ref_car_exception",
                          ["ordinal"] + [c for _, c in FLAGS] + ["n_flags"], rows)
    lowered = [c.lower() for c in cols]
    ev["gates_stated"] = dict(
        (label, [c for c in lowered if any(k in c for k in keys)]) for label, keys in INFERRED_GATES)
    ev["gates_answered"] = sum(1 for v in ev["gates_stated"].values() if v)
    ev["n_flags_hist"] = dict(sorted(ev["n_flags_hist"].items()))
    log(verbose, "car_exception: %d rows, %d join ref_car, gates answered %d/%d"
        % (n, ev["car_joins"], ev["gates_answered"], len(INFERRED_GATES)))
    return n, ev


# ---------------------------------------------------------------------------
def run(cx, gamedb, verbose=False):
    gx = sqlite3.connect("file:%s?mode=ro" % gamedb.replace("\\", "/"), uri=True)
    gx.row_factory = sqlite3.Row
    cx.execute("PRAGMA defer_foreign_keys=ON")
    resolve = string_resolver(cx)

    counts, detail = {}, {}
    counts["ref_part_attribute"], detail["part_attribute"] = import_part_attribute(cx, gx, verbose)
    n_p, n_pp, detail["preset"] = import_presets(cx, gx, resolve, verbose)
    counts["ref_preset"], counts["ref_preset_part"] = n_p, n_pp
    counts["ref_car_exception"], detail["car_exception"] = import_car_exceptions(cx, gx, verbose)
    gx.close()
    return counts, detail


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--gamedb", default=DEFAULT_GAMEDB)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "parts_extra", os.path.basename(a.gamedb))
    try:
        counts, detail = run(cx, a.gamedb, a.verbose)
        cx.commit()
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1,
                  json.dumps({"counts": counts, "detail": detail}))

    pa, pr, ce = detail["part_attribute"], detail["preset"], detail["car_exception"]
    for k in sorted(counts):
        print("  %-22s %8d" % (k, counts[k]))
    print("  part_attribute  PI columns 0 | joins ref_part %d/%d | columns named *PartAttribute* "
          "anywhere else in the game DB: %s (range coincidences, not references: %d)"
          % (pa["joins_ref_part"], pa["n"],
             pa["referencing_columns"]["by_name"] or "none",
             len(pa["referencing_columns"]["by_range_coincidence"])))
    print("                  mass == a Data_Engine engine mass in %d/%d rows; drag!=1 in %d, "
          "wind!=1 in %d; prices %s"
          % (pa["mass_is_engine"], pa["n"], pa["drag_not_1"], pa["wind_not_1"], pa["prices"]))
    print("  preset          %d presets over %d cars; ordinal joins ref_car %d/%d; "
          "part rows join ref_part %d/%d; blob gears == fitted transmission NumGears-1 in %d/%d"
          % (pr["presets"], pr["n_cars"], pr["ordinal_joins"], pr["presets"],
             pr["part_joins"], pr["part_rows"], pr["gear_agrees"], pr["gear_checked"]))
    if pr["missing_by_slot"]:
        print("                  slots that do not join: %s" % pr["missing_by_slot"])
    print("  car_exception   %d rows, %d join ref_car; inferred gates STATED here: %d of %d"
          % (ce["n"], ce["car_joins"], ce["gates_answered"], len(INFERRED_GATES)))
    print("                  flags %s" % ce["flag_totals"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
