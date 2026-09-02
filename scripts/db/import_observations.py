#!/usr/bin/env python3
"""import_observations.py -- the obs_ layer and the plan_ deliverables.

The obs_ tables carry the knowledge a PERSON earned: menu tiles read off screenshots, PI steps
measured one part at a time, and the notes that accumulated in data/*.json. Every row names its
source, so a claim can always be traced back to the screenshot or session that produced it.

This is also where our own records get GRADED against the game's data now that we have it. Where
part-names.json disagrees with ref_part, the disagreement itself becomes an obs_evidence row --
the game's table is not silently overwritten onto our history, and our history is not silently
overwritten by the game. Both are kept, and the conflict is visible.

plan_readiness and plan_clone materialize the clone deliverables so the CLI and the dashboard
read identical rows instead of each running its own resolver.

Run:  python scripts/db/import_observations.py [--db PATH] [-v]
"""
import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

DATA = os.path.join(ROOT, "data")
NOW = fh6db.utcnow()


def jload(name):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:                                    # noqa: BLE001
        return None


def run(cx, verbose=False):
    ev, menu, pi = [], [], []
    counts = {}

    # ---------------- menu observations --------------------------------------
    LADDERS = [("tire-compound-ladder-nsxr.json", "compounds", "tire_compound", 412),
               ("transmission-ladder-nsxr.json", "transmissions", "transmission", 412),
               ("drivetrain-ladder-nsxr.json", "rows", "drivetrain", 412),
               ("platform-ladder-nsxr.json", "rows", "platform", 412)]
    for fn, key, slot, ordn in LADDERS:
        d = jload(fn)
        if not d:
            continue
        rows = d.get(key)
        if not isinstance(rows, list):
            rows = next((v for v in d.values() if isinstance(v, list)), [])
        src = "%s (%s)" % (fn, d.get("source") or d.get("captured") or "screenshot")
        for i, r in enumerate(rows):
            if not isinstance(r, dict):
                continue
            menu.append((None, ordn, r.get("slot") or slot, r.get("tile") or (i + 1), len(rows),
                         r.get("name") or r.get("label"), r.get("id") or r.get("part_id"),
                         src, d.get("captured")))

    rmo = jload("rim-menu-order.json")
    if rmo:
        for i, w in enumerate(rmo.get("wheels") or []):
            if not isinstance(w, dict):
                continue
            menu.append((None, w.get("ordinal"), "rim_style", w.get("tile") or (i + 1),
                         len(rmo["wheels"]), w.get("name"), w.get("id"),
                         rmo.get("source"), None))

    # ---------------- PI observations ----------------------------------------
    pio = jload("pi-observations.json") or {}
    for o in (pio.get("observations") or []):
        if not isinstance(o, dict):
            continue
        pi.append((None, o.get("ordinal"), o.get("container"), o.get("hw_hash"),
                   o.get("slot"), o.get("part_id") or o.get("pid"),
                   o.get("pi_before"), o.get("pi_after") or o.get("pi"),
                   o.get("delta"), o.get("source") or "pi-observations.json",
                   o.get("observed") or o.get("ts"), json.dumps(o)[:900]))
    ppi = (jload("parts-pi.json") or {}).get("parts_pi") or {}
    for slot, rows in ppi.items():
        if not isinstance(rows, dict):
            continue
        for tier, v in rows.items():
            d = v.get("pi") if isinstance(v, dict) else v
            pi.append((None, None, None, None, slot, None, None, None, d,
                       "parts-pi.json (single-part isolation)", None,
                       json.dumps({"tier": tier, "value": v})[:900]))

    # ---------------- evidence: the notes scattered through part-names.json ---
    pn = jload("part-names.json") or {}

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if k.startswith("_") and isinstance(v, str):
                    ev.append((None, path or "part-names", v, "read", "part-names.json:%s" % k,
                               pn.get("created"), None))
                elif k.startswith("_") and isinstance(v, dict):
                    ev.append((None, "%s/%s" % (path, k), json.dumps(v)[:1500], "read",
                               "part-names.json:%s" % k, pn.get("created"), None))
                else:
                    walk(v, "%s/%s" % (path, k) if path else k)
    walk(pn, "")

    # rim verdicts: ours (by eye) vs the game's table
    rim = jload("rim-id-matches.json") or {}
    wheels = {r["wheel_id"]: r for r in cx.execute(
        "SELECT wheel_id, full_name, mass_level FROM ref_wheel")}
    agree = disagree = 0
    for k, v in rim.items():
        if k.startswith("_") or not isinstance(v, dict):
            continue
        try:
            wid = int(k)
        except ValueError:
            continue
        w = wheels.get(wid)
        ours = v.get("name")
        if v.get("verdict") == "matched" and ours and w:
            same = ours.split()[-1].lower() in (w["full_name"] or "").lower()
            agree += 1 if same else 0
            disagree += 0 if same else 1
            ev.append((None, "rim:%d" % wid,
                       "by-eye render match read '%s'; the game's table says '%s'%s"
                       % (ours, w["full_name"], "" if same else "  -- DISAGREES"),
                       "verified" if same else "read",
                       "rim-id-matches.json (%s)" % (v.get("strength") or "?"), "2026-09-02", None))
    ev.append((None, "rim_style",
               "Render-matching by eye agreed with the game's own wheel table on %d of %d "
               "matched verdicts and disagreed on %d. The table is authoritative; the render "
               "match remains useful only as a way to find a tile quickly." % (agree, agree + disagree, disagree),
               "verified", "import_observations.py cross-check", NOW, None))

    # the differential ladder correction -- a rule generalised from one car
    ev.append((None, "differential",
               "The differential index ladder recorded from the NSX-R (5 Drift, 6 Offroad, "
               "7 probably Rally) does not generalise. The game's own rows give 5 Rally, "
               "6 Drift, 7 Offroad on essentially every drivetrain set; the two that deviate "
               "are 2102 and 2170, and 2102 is the NSX-R's own AWD swap set. Use ref_part.",
               "verified", "FH6_Database.sqlite List_UpgradeDrivetrainDifferential", NOW, None))
    ev.append((None, "transmission",
               "A transmission row's NumGears counts REVERSE, so it is one more than the speed "
               "count in the part's name: level 9 has NumGears 10 and is the 9-speed, level 10 "
               "has NumGears 11 and is the 10-speed. Use Level, or the container's own gear "
               "count (forward gears only) -- never NumGears -- to say how many speeds a "
               "gearbox has.",
               "verified", "List_UpgradeDrivetrainTransmission vs container gear rows", NOW, None))
    ev.append((None, "slider:tire_pressure",
               "The tire-pressure band is 15..55 psi, not 14..55: the stock compound row is "
               "31.0/33.0 psi and a fresh install writes 0.400/0.450, which 15 + 40s reproduces "
               "exactly. fh6_tune_decode.SLIDERS still carries 14 as the floor.",
               "verified", "List_UpgradeTireCompound vs container norms", NOW, None))
    ev.append((None, "car_universe",
               "The ONYX asset scan (638 cars) is a subset of the game's own Data_Car (660). "
               "Asset/media names agree on 638 of 638, so the ordinal->car mapping is confirmed "
               "independently; ONYX display names are cleaned from filenames and are worse "
               "(1992 Honda NSXR vs NSX-R), so ref_car keeps the localized string.",
               "verified", "ONYX car_database_generated_cleaned.json cross-check", NOW, None))

    # our proven names, graded against the game
    checked = mismatch = 0
    named = pn.get("named") or {}
    for slot, rows in named.items():
        if not isinstance(rows, dict):
            continue
        for k, v in rows.items():
            if k.startswith("_"):
                continue
            name = v if isinstance(v, str) else (v.get("name") if isinstance(v, dict) else None)
            if not name:
                continue
            try:
                idx = int(k)
            except ValueError:
                continue
            # OUR keys are the part id's TAIL (the number our decoder printed), the game's are
            # the catalogue Level. They coincide on the pure tier ladders and diverge badly on
            # transmission, intercooler and the visual slots. Comparing our index against the
            # game's Level would manufacture disagreements that are really just two different
            # keys, so the lookup goes through the id tail -- the thing we actually recorded.
            # Rim slots hold FLAT wheel ids, not key*1000+n, so the tail rule does not apply.
            where = "part_id=?" if slot in ("rim_style", "rear_rim_style") else "(part_id % 1000)=?"
            rows = cx.execute(
                "SELECT name, level, COUNT(*) n FROM ref_part"
                " WHERE slot=? AND %s AND name IS NOT NULL"
                " GROUP BY name ORDER BY n DESC" % where, (slot, idx)).fetchall()
            if not rows:
                continue
            hit = rows[0]
            checked += 1
            if (hit["name"] or "").strip().lower() != name.strip().lower():
                mismatch += 1
                # More than one name at the same index means the tile's name depends on the car
                # (a 3-tile cage menu reads Stock/Sport/Race, a 4-tile one Stock/Street/Sport/Race),
                # so our record may be right for the car it was read on and wrong as a global rule.
                spread = ("; the game uses %d different names at this index, so it depends on the "
                          "car's tile count" % len(rows)) if len(rows) > 1 else ""
                ev.append((None, "%s:%d" % (slot, idx),
                           "our recorded name for index %d is '%s'; the game's most common name "
                           "there is '%s' (catalogue level %s)%s"
                           % (idx, name, hit["name"], hit["level"], spread),
                           "read", "part-names.json named/%s/%s" % (slot, k), NOW, None))
    ev.append((None, "part_names",
               "Our screenshot-derived names were graded against the game's catalogue: %d checked, "
               "%d disagree. Every disagreement is recorded as its own row." % (checked, mismatch),
               "verified", "import_observations.py cross-check", NOW, None))

    # ---------------- plan_readiness ----------------------------------------
    ready_rows = []
    for c in cx.execute("SELECT container FROM tune_container"):
        cn = c["container"]
        bl = cx.execute("""SELECT slot, part_id, confidence FROM tune_part
                           WHERE container=? AND part_id IS NOT NULL
                             AND (name IS NULL OR confidence='unknown')""", (cn,)).fetchall()
        nder = cx.execute("""SELECT COUNT(*) n FROM tune_part
                             WHERE container=? AND part_id IS NOT NULL AND confidence='derived'""",
                          (cn,)).fetchone()["n"]
        ready_rows.append((cn, 1 if not bl else 0, len(bl), nder,
                           json.dumps([{"slot": b["slot"], "part_id": b["part_id"]} for b in bl]),
                           NOW))

    # ---------------- write --------------------------------------------------
    with cx:
        cx.execute("PRAGMA defer_foreign_keys=ON")
        for t in ("obs_menu", "obs_pi", "obs_evidence", "plan_clone_step", "plan_clone",
                  "plan_readiness"):
            cx.execute("DELETE FROM %s" % t)
        counts["obs_menu"] = fh6db.upsert_many(cx, "obs_menu", [
            "obs_id", "ordinal", "slot", "tile", "tile_count", "name", "part_id", "source",
            "observed_utc"], menu)
        counts["obs_pi"] = fh6db.upsert_many(cx, "obs_pi", [
            "obs_id", "ordinal", "container", "hw_hash", "slot", "part_id", "pi_before",
            "pi_after", "delta", "source", "observed_utc", "note"], pi)
        counts["obs_evidence"] = fh6db.upsert_many(cx, "obs_evidence", [
            "obs_id", "subject", "claim", "confidence", "source", "observed_utc",
            "superseded_by"], ev)
        counts["plan_readiness"] = fh6db.upsert_many(cx, "plan_readiness", [
            "container", "ready", "n_unknown", "n_derived", "blockers", "computed_utc"], ready_rows)
    counts["_name_checks"] = checked
    counts["_name_mismatch"] = mismatch
    counts["_rim_disagree"] = disagree
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "observations", DATA)
    try:
        counts = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(v for k, v in counts.items() if not k.startswith("_")), 1,
                  json.dumps(counts))
    for k in sorted(counts):
        print("  %-18s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
