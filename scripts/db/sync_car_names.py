#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Project authoritative car names from ref_car (the decrypted game DB) into
data/car-ordinals.json — the ordinal->name map the live daemon (names_load) and several tools
(build_engine_catalog, clone_coverage, fh6_manifest, analyze_session) read.

Since 2026-09-02 the game DB (import_gamedb -> ref_car) is the authoritative ordinal->name
source. The old community gist (fetch_car_ordinals.py) was the PRE-DECRYPT bootstrap (created
2026-08-21, 12 days before the game-DB decode) and now only serves as a fallback for ordinals
the game DB lacks (traffic/AI cars — none for a normal player car).

Run this AFTER scripts/db/rebuild.py (it reads ref_car). The daemon re-reads the file per
request, so no restart is needed.

Rule: ref_car wins for every ordinal it has (name = "<year> <display_name>", confidence
game-db); any existing map entry whose ordinal is NOT in ref_car is preserved (fallback
coverage); schema/purpose/builds are preserved verbatim.
"""
import json, os, sqlite3, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DB = os.path.join(ROOT, "data", "fh6.db")
MAP = os.path.join(ROOT, "data", "car-ordinals.json")


def main():
    cx = sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)
    cx.row_factory = sqlite3.Row
    rows = cx.execute("SELECT ordinal, year, display_name FROM ref_car WHERE display_name IS NOT NULL").fetchall()
    try:
        with open(MAP, encoding="utf-8") as f:
            m = json.load(f)
    except Exception:
        m = {"schema_version": "1.0.0", "cars": {}, "builds": {}}
    old = m.get("cars", {})
    stamp = time.strftime("%Y-%m-%d")
    src = "ref_car (decrypted game DB) %s" % stamp
    cars, ref_ords = {}, set()
    added = refreshed = 0
    for r in rows:
        o = str(r["ordinal"]); ref_ords.add(o)
        dn = (r["display_name"] or "").strip()
        if not dn:
            continue
        name = ("%s %s" % (r["year"], dn)).strip() if r["year"] else dn
        prev = old.get(o)
        prev_name = (prev.get("name") if isinstance(prev, dict) else prev) if prev else None
        if prev is None:
            added += 1
        elif prev_name != name:
            refreshed += 1
        cars[o] = {"name": name, "confidence": "game-db", "source": src}
    # preserve any map-only ordinals the game DB lacks (fallback coverage, e.g. traffic/AI)
    kept = 0
    for o, v in old.items():
        if o not in ref_ords:
            cars[o] = v; kept += 1
    m["cars"] = {o: cars[o] for o in sorted(cars, key=lambda x: int(x) if str(x).lstrip("-").isdigit() else 0)}
    m["table_source"] = ("ref_car (decrypted game DB) — authoritative since 2026-09-02; "
                         "fetch_car_ordinals.py is a fallback for non-Data_Car ordinals only")
    tmp = MAP + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
    os.replace(tmp, MAP)
    print("car-ordinals.json: %d cars (%d added, %d name-refreshed, %d map-only kept)"
          % (len(m["cars"]), added, refreshed, kept))


if __name__ == "__main__":
    main()
