#!/usr/bin/env python3
"""Forza Horizon 6 car archives -> per-car upgrade OPTION LISTS (the game's own table).

Source: <install>/Content/media/cars/<CAR>.zip (660 archives, plain Deflate, readable). Every archive
carries one Manifest.xml whose direct children are the car's visual part slots:

  <NonUpgradeablePart PartEnum="Brakes"> ...Model rows... </NonUpgradeablePart>       fixed slot, no ids
  <UpgradeablePart PartEnum="RearWing" PartId="412002"> ...Model rows... </UpgradeablePart>

Each UpgradeablePart row is one shop OPTION of that slot: PartId = partset*1000 + index, partset = the
car's own ordinal for these slots, index = variant*100 + tier. variant 0 is the list the stock car shows;
variant 1+ (ids ..100+) is the list the same slot shows once a body kit is on -- the tile persists after
the kit with a different option set. The archive stem (HON_NSXR_92) is NOT the ordinal; the ordinal is
derived from the PartId prefix and checked for consistency across the archive.

What the table is NOT: the manifest is the ART pipeline's list, so an option with no mesh of its own is
absent (NSX-R ChassisStiffness lists 412000 + 412002 in each variant while the shop shows Stock/Sport/
Race -- the Sport cage has no model). For the body-kit slots every option is a mesh, so those lists are
complete; for roll_cage the list is a lower bound. 102 archives list every slot as NonUpgradeablePart
(no ids at all) -- those cars have no visual options and no ordinal can be derived from the archive.

READ-ONLY on the game install. stdlib only.

  python scripts/telemetry/fh6_manifest.py                 scan all archives -> data/car-option-lists.json
  python scripts/telemetry/fh6_manifest.py --car HON_NSXR_92   print one archive's parse
"""
import os, sys, json, argparse, zipfile, collections, datetime
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CARS_DIR = "C:/XboxGames/Forza Horizon 6/Content/media/cars"
OUT_PATH = os.path.join(ROOT, "data", "car-option-lists.json")
ORDINALS_PATH = os.path.join(ROOT, "data", "car-ordinals.json")

# PartEnum -> the container slot name used by fh6_tune_decode.PARTS. Unknown enums keep their raw name.
SLOT_NAMES = {
    "CarBody": "car_body",
    "RearWing": "rear_wing",
    "FrontBumper": "front_bumper",
    "RearBumper": "rear_bumper",
    "Hood": "hood",
    "SideSkirts": "side_skirts",
    "ChassisStiffness": "roll_cage",
    "WeightReduction": "weight_reduction",
}


def slot_name(part_enum):
    return SLOT_NAMES.get(part_enum, part_enum)


def parse_manifest(zip_path):
    """-> {ordinal, stem, parts: {PartEnum: [ids...]}, models: {PartEnum: {id: n_models}},
           fixed: [PartEnum...], anomalies: [str...]}.
    ordinal is None when the archive has no UpgradeablePart row. Ids keep manifest order (which is
    ascending within each PartEnum block on every archive checked)."""
    stem = os.path.splitext(os.path.basename(zip_path))[0]
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n.lower() == "manifest.xml"]
        if not names:
            raise ValueError(f"{stem}: no Manifest.xml")
        root = ET.fromstring(z.read(names[0]))
    parts = collections.OrderedDict()
    models = {}
    fixed = []
    anomalies = []
    for el in root:
        if el.tag == "NonUpgradeablePart":
            fixed.append(el.attrib.get("PartEnum"))
        elif el.tag == "UpgradeablePart":
            enum = el.attrib.get("PartEnum")
            pid = el.attrib.get("PartId")
            if enum is None or pid is None:
                anomalies.append(f"row without PartEnum/PartId: {el.attrib}")
                continue
            pid = int(pid)
            lst = parts.setdefault(enum, [])
            if pid in lst:
                anomalies.append(f"{enum} {pid} listed twice")
            lst.append(pid)
            models.setdefault(enum, {})[pid] = sum(1 for k in el if k.tag == "Model")
    # ordinal = the id prefix; the CarBody rows carry it when present, else the majority prefix.
    ordinal = None
    if parts:
        pool = parts.get("CarBody") or [pid for ids in parts.values() for pid in ids]
        ordinal = collections.Counter(pid // 1000 for pid in pool).most_common(1)[0][0]
        for enum, ids in parts.items():
            for pid in ids:
                if pid // 1000 != ordinal:
                    anomalies.append(f"{enum} {pid}: prefix {pid // 1000} != ordinal {ordinal}")
    return {"ordinal": ordinal, "stem": stem, "parts": parts, "models": models,
            "fixed": fixed, "anomalies": anomalies}


def option_rows(ordinal, ids, model_counts):
    """[{id, variant, tier, rank, models}] -- rank = 1-based manifest position within the same variant."""
    rows = []
    per_variant = collections.Counter()
    for pid in ids:
        index = pid - ordinal * 1000
        if not 0 <= index < 1000:          # prefix anomaly (one known: MIN_CooperS_65 16620016)
            index = pid % 1000
        variant, tier = divmod(index, 100)
        per_variant[variant] += 1
        rows.append({"id": pid, "variant": variant, "tier": tier,
                     "rank": per_variant[variant], "models": model_counts.get(pid, 0)})
    return rows


def is_dense(tiers):
    """True when the tier list is exactly 0..N-1."""
    return sorted(tiers) == list(range(len(tiers)))


def load_names():
    try:
        with open(ORDINALS_PATH, encoding="utf-8") as f:
            return {k: v.get("name") for k, v in json.load(f).get("cars", {}).items()}
    except (OSError, ValueError):
        return {}


def scan(cars_dir=CARS_DIR):
    names = load_names()
    cars = {}
    no_list = []
    errors = []
    enum_rows = collections.Counter()
    enum_cars = collections.Counter()
    n_archives = 0
    for fn in sorted(os.listdir(cars_dir), key=str.lower):
        if not fn.lower().endswith(".zip"):
            continue
        n_archives += 1
        path = os.path.join(cars_dir, fn)
        try:
            m = parse_manifest(path)
        except Exception as e:                     # bad zip / bad xml -- record, keep going
            errors.append({"stem": os.path.splitext(fn)[0], "error": f"{type(e).__name__}: {e}"})
            continue
        if m["ordinal"] is None:
            no_list.append({"stem": m["stem"], "fixed_slots": [slot_name(e) for e in m["fixed"]]})
            continue
        for enum, ids in m["parts"].items():
            enum_rows[enum] += len(ids)
            enum_cars[enum] += 1
        key = str(m["ordinal"])
        if key in cars:
            m["anomalies"].append(f"ordinal {key} already claimed by {cars[key]['stem']}")
        cars[key] = {
            "stem": m["stem"],
            "name": names.get(key),
            "options": {slot_name(e): option_rows(m["ordinal"], ids, m["models"].get(e, {}))
                        for e, ids in m["parts"].items()},
            "fixed_slots": [slot_name(e) for e in m["fixed"]],
            "anomalies": m["anomalies"],
        }
    cars = dict(sorted(cars.items(), key=lambda kv: int(kv[0])))
    return cars, no_list, errors, n_archives, enum_rows, enum_cars


def summarize(cars, no_list, errors, n_archives, enum_rows, enum_cars):
    slots = sorted({s for c in cars.values() for s in c["options"]})
    tiles_v0 = {s: collections.Counter() for s in slots}       # tiles the stock car sees
    ids_all = {s: collections.Counter() for s in slots}        # every id incl. kit variants
    kit_cars = collections.Counter()                           # cars with a variant-1+ list
    non_dense_v0 = collections.Counter()                       # variant-0 tiers not 0..N-1
    non_dense_examples = collections.defaultdict(list)
    for key, c in cars.items():
        for s, rows in c["options"].items():
            v0 = [r["tier"] for r in rows if r["variant"] == 0]
            tiles_v0[s][str(len(v0))] += 1
            ids_all[s][str(len(rows))] += 1
            if any(r["variant"] > 0 for r in rows):
                kit_cars[s] += 1
            if v0 and not is_dense(v0):
                non_dense_v0[s] += 1
                if len(non_dense_examples[s]) < 8:
                    non_dense_examples[s].append({"ordinal": int(key), "stem": c["stem"], "tiers": v0})
    unnamed = [int(k) for k, c in cars.items() if not c["name"]]
    return {
        "archives_scanned": n_archives,
        "archives_parsed": n_archives - len(errors),
        "cars_with_lists": len(cars),
        "archives_without_lists": len(no_list),
        "cars_with_anomalies": sorted(int(k) for k, c in cars.items() if c["anomalies"]),
        "ordinals_not_in_car_ordinals": unnamed,
        "part_enums": {e: {"slot": slot_name(e), "rows": enum_rows[e], "cars": enum_cars[e]}
                       for e in sorted(enum_rows, key=lambda e: -enum_rows[e])},
        "tiles_per_slot_variant0": {s: dict(sorted(tiles_v0[s].items(), key=lambda kv: int(kv[0])))
                                    for s in slots},
        "ids_per_slot_all_variants": {s: dict(sorted(ids_all[s].items(), key=lambda kv: int(kv[0])))
                                      for s in slots},
        "cars_with_kit_variant_lists": {s: kit_cars.get(s, 0) for s in slots},
        "cars_with_non_dense_variant0": {s: non_dense_v0.get(s, 0) for s in slots},
        "non_dense_variant0_examples": dict(non_dense_examples),
        "no_list_archives": no_list,
        "errors": errors,
    }


CAVEATS = [
    "The manifest is the art pipeline's part list: an option with no mesh of its own is absent. "
    "For roll_cage the list is a LOWER BOUND (NSX-R shop shows Stock/Sport/Race; manifest lists tiers 0 and 2). "
    "For the body-kit slots (bumpers, wing, hood, skirts, car_body) every option is a mesh, so those lists are complete.",
    "variant 0 = the list the stock car shows; variant 1+ (ids ..100+) = the list the same slot shows after a body kit. "
    "rank = 1-based manifest position within the variant; tier = id % 100 is the shop's own index and can be sparse.",
    "tier is a position in the slot's GLOBAL vocabulary (data/part-index-vocabulary.json), not the tile position: "
    "rally cars list front_bumper/hood/side_skirts tier 20-21 beside 0..4 (PEU_207Super2000_07, TOY_CelicaST205_94, "
    "VOL_242Turbo_83), and roll_cage lists [0,2] on 3-tile cars and [0,3] on 4-tile cars (the meshed top cage only).",
    "car_body ids 100/200/300 mark body kits; the other slots' variant-N lists are the options shown with that kit "
    "(2005 BMW M3 E46: car_body [0,1,200,300] <-> front_bumper [0,1,2,3,200,300], hood [0,1,200,300]).",
    "Archives listed under no_list_archives declare every slot NonUpgradeablePart: no ids, so no ordinal can be "
    "derived from the archive and the car has no visual options.",
    "ordinal = PartId // 1000 (CarBody rows preferred, else the majority prefix); any id whose prefix disagrees is "
    "kept, decoded as id % 1000, and recorded under anomalies.",
]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cars-dir", default=CARS_DIR)
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--car", help="print one archive's parse (stem or path) and exit")
    a = ap.parse_args(argv)
    if a.car:
        path = a.car if os.path.exists(a.car) else os.path.join(a.cars_dir, a.car + ".zip")
        m = parse_manifest(path)
        print(json.dumps({"ordinal": m["ordinal"], "stem": m["stem"],
                          "options": {slot_name(e): option_rows(m["ordinal"], ids, m["models"].get(e, {}))
                                      for e, ids in m["parts"].items()} if m["ordinal"] is not None else {},
                          "fixed_slots": [slot_name(e) for e in m["fixed"]],
                          "anomalies": m["anomalies"]}, indent=1))
        return 0
    cars, no_list, errors, n_archives, enum_rows, enum_cars = scan(a.cars_dir)
    summary = summarize(cars, no_list, errors, n_archives, enum_rows, enum_cars)
    doc = {
        "schema_version": "1.0.0",
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "generated_by": "scripts/telemetry/fh6_manifest.py",
        "source": a.cars_dir,
        "purpose": "Per-car upgrade option lists for the visual/chassis slots, read from each car archive's "
                   "Manifest.xml. Keyed by ordinal; option = {id, variant, tier, rank, models}.",
        "caveats": CAVEATS,
        "slot_names": SLOT_NAMES,
        "cars": cars,
        "summary": summary,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    s = summary
    print(f"{a.out}: {s['archives_parsed']}/{s['archives_scanned']} archives parsed, "
          f"{s['cars_with_lists']} cars with lists, {s['archives_without_lists']} without, "
          f"{len(s['errors'])} errors")
    for e, d in s["part_enums"].items():
        print(f"  {e:18s} -> {d['slot']:16s} {d['rows']:5d} rows on {d['cars']:3d} cars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
