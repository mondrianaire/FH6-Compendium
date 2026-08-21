#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Refresh data/car-ordinals.json from HDR's community-maintained FH6 ordinal table (gist, updated per game
patch; cross-verified against Mattkovic/ONYX-Drive-HUD asset-scan database). Player-confirmed entries
are preserved as overrides. Run after game updates that add cars.

  python scripts/telemetry/fetch_car_ordinals.py
"""
import json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "data", "car-ordinals.json")
SRC = "https://gist.githubusercontent.com/HDR/0659d1717bc61504bf83750628963f4f/raw/"   # {"YYYY Make Model": "ordinal"}
MIRROR = "https://raw.githubusercontent.com/mavanmanen/fh6-car-database/main/mapping.json"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fh6-tuning-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read().decode("utf-8"))

def main():
    try: raw = fetch(SRC); src = SRC
    except Exception as e:
        print("primary failed:", e); raw = fetch(MIRROR); src = MIRROR
    inv = {}
    for name, ordn in raw.items():
        try: o = str(int(str(ordn).strip()))
        except Exception: continue
        nm = " ".join(str(name).split())
        if nm.count("(") > nm.count(")"): nm += ")"   # known malformed key '(Forza Edition'
        inv[o] = nm
    obj = {"schema_version": "1.1.0", "cars": {}, "builds": {}}
    if os.path.exists(PATH):
        with open(PATH, encoding="utf-8") as f: obj = json.load(f)
    cars = obj.setdefault("cars", {})
    added = updated = 0
    for o, nm in inv.items():
        cur = cars.get(o)
        if cur and cur.get("confidence") == "player-confirmed": continue
        if cur is None: added += 1
        elif cur.get("name") != nm: updated += 1
        cars[o] = {"name": nm, "confidence": "community-table", "source": "HDR FH6 ordinal gist (cross-checked vs ONYX asset scan)"}
    obj["table_source"] = {"url": src, "fetched": time.strftime("%Y-%m-%d"), "entries": len(inv), "note": "years come from internal archive names and are occasionally off; a handful of names are codenames"}
    with open(PATH, "w", encoding="utf-8") as f: json.dump(obj, f, indent=2, ensure_ascii=False)
    print(f"table entries {len(inv)}  added {added}  updated {updated}  total {len(cars)}  -> {os.path.relpath(PATH, ROOT)}")
    for o in sys.argv[1:]: print(f"  {o} = {cars.get(str(o), {}).get('name')}")

if __name__ == "__main__":
    main()
