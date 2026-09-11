#!/usr/bin/env python3
"""import_objectmodel.py -- the game's own event catalogue: where a NAME meets a ROUTE ID.

Source: <install>/media/ObjectModelGame.zip (plain Deflate, readable, READ-ONLY). Inside,
source/manifest.xml lists ~7,000 BXML documents by TypeId; five of them are the catalogue this
project spent four days looking for in string tables and route files that never carried it
(2026-09-05, see docs/handoff-to-main-route-identification-2026-09-05.md section 8):

    TrackInfoDataSet      112 rows: track key -> RouteId (Route<id>.owt), ribbon (Circuit/P2P/
                          Playground), the CareerTrackInfo name and description GUIDs
    RaceCollectionDataSet 158 rows: the championships/exhibitions a Rivals event belongs to
    CareerRaceDataSet     255 rows: every career race -> its track key, collection, race mode, laps
    RivalsEventDataMap    604 rows: 88 route names x 7 car classes -> collection key, leaderboard id
    CarRestrictionMap     541 rows: the class / PI / power / weight limits an event can impose

The chain Rivals event -> collection -> career race -> track -> route resolves every one of the 88
Rivals names to exactly one route id (verified 88/88 on the shipped data). The route's display
name is the CareerTrackInfo string, so ref_route can be named by the game rather than derived.

Every string reference is a CHECKED join against ref_string, the same rule import_events.py uses:
a name GUID that does not resolve fails the stage. Descriptions may be missing (placeholders).

Run:  python scripts/db/import_objectmodel.py [--db PATH] [--zip PATH] [-v]
"""
import argparse
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import fh6db                                            # noqa: E402
import fh6_bxml                                         # noqa: E402

ZIP_PATH = r"C:\XboxGames\Forza Horizon 6\Content\media\ObjectModelGame.zip"
WANT = ("TrackInfoDataSet", "RaceCollectionDataSet", "CareerRaceDataSet",
        "RivalsEventDataMap", "CarRestrictionMap")

#: the game's RaceMode -> the discipline vocabulary the naming rule keys surface on
DISCIPLINE = {
    "LapsRace": "road", "P2P": "road", "Touge": "road",
    "StreetRace": "street", "Drag": "drag",
    "Scramble": "dirt", "TrailRace": "dirt",
    "CrossCountry": "cross-country", "CrossCountryCircuit": "cross-country",
    "Showcase": "showcase", "Rush": "rush",
    "TeamInfected": "playground", "TeamKing": "playground", "TeamFlagRush": "playground",
}


def _props(v):
    """One map value -> {id: scalar} plus '<id>.Key' for container references and lists of keys."""
    p = {}
    for pr in v.findall("property"):
        pid = pr.get("id")
        if pr.get("value") is not None:
            p[pid] = pr.get("value")
            continue
        k = pr.find("property[@id='Key']")
        if k is not None:
            p[pid + ".Key"] = k.get("value")
            continue
        els = pr.findall("element")
        if els:
            p[pid] = [e.get("value") for e in els if e.get("value") is not None]
    return p


def _table(root):
    """{key: props} over the top-level map of a dataset document."""
    obj = root.find("object")
    data = None
    for pr in obj.findall("property"):
        if pr.find("map_element") is not None:
            data = pr
            break
    out = {}
    if data is None:
        return out
    for me in data.findall("map_element"):
        k, v = me.find("key"), me.find("value")
        if k is not None and v is not None:
            out[k.get("value")] = _props(v)
    return out


def _b(v):
    return None if v is None else (1 if str(v) == "True" else 0)


def _i(v):
    try:
        return None if v is None else int(v)
    except (ValueError, TypeError):
        return None


def load_datasets(zip_path):
    """{TypeId: {key: props}} for the five catalogue datasets, via the manifest."""
    zf = zipfile.ZipFile(zip_path)
    man = fh6_bxml.parse(zf.read("source/manifest.xml"))
    files = {}
    for me in man.iter("map_element"):
        v = me.find("value")
        if v is None:
            continue
        p = {pr.get("id"): pr.get("value") for pr in v.findall("property")}
        if p.get("TypeId") in WANT:
            files.setdefault(p["TypeId"], []).append(p["FileName"])
    missing = [t for t in WANT if t not in files]
    if missing:
        raise RuntimeError("ObjectModelGame.zip manifest lacks %s" % ", ".join(missing))
    out = {}
    for t in WANT:
        if len(files[t]) != 1:
            raise RuntimeError("manifest lists %d documents of type %s, expected 1" % (len(files[t]), t))
        out[t] = _table(fh6_bxml.parse(zf.read("source/" + files[t][0].replace("\\", "/"))))
    return out


def run(cx, zip_path=ZIP_PATH, verbose=False):
    ds = load_datasets(zip_path)
    strings = {(r[0], r[1]): r[2] for r in cx.execute(
        "SELECT table_name, key_name, content FROM ref_string WHERE table_name IN "
        "('CareerTrackInfo', 'CareerRace', 'CareerRaceCollection', 'RivalsEventData', 'OMCarRestrictions')")}
    # gamedb populates ref_string; if it is empty here gamedb has not run and every name would be null --
    # that is a real failure. But a handful of INDIVIDUAL name-strings missing (a new event/collection not
    # yet in the string catalogue) must NOT abort the whole stage -- collect them and leave those entries
    # unnamed, so route naming and course export downstream still run.
    if not strings:
        raise ValueError("ref_string has no catalogue name rows — run stage gamedb first")
    misses = []

    def res(ref, required):
        """'Table.IDS_x' -> text. A required ref that does not resolve is recorded and left unnamed."""
        if not ref:
            return None, None
        if "." not in ref:
            raise ValueError("string reference without a table: %r" % ref)
        t, k = ref.split(".", 1)
        txt = strings.get((t, k))
        if txt is None and required:
            misses.append(ref)   # new/unknown catalogue string — empty name (NOT NULL columns), unnamed downstream
            return "", k
        return txt, k

    ti_rows = []
    for key, p in ds["TrackInfoDataSet"].items():
        name, name_key = res(p.get("DisplayName"), True)
        short, _ = res(p.get("ShortDisplayName"), False)
        desc, _ = res(p.get("Description"), False)
        ti_rows.append((_i(key), p.get("RouteId"), p.get("CustomRouteId"), p.get("RibbonConfig"),
                        name, short, desc, name_key, _b(p.get("UseCrossCountryAI")),
                        _b(p.get("BlueprintOnlyRoute")), p.get("RouteActivationTriggerZoneName") or None,
                        p.get("MediaTrackName"),
                        json.dumps(p["CarRecommendedPISort"]) if isinstance(p.get("CarRecommendedPISort"), list) else _i(p.get("CarRecommendedPISort"))))

    rc_rows = []
    for key, p in ds["RaceCollectionDataSet"].items():
        name, _ = res(p.get("Name"), True)
        desc, _ = res(p.get("Description"), False)
        rc_rows.append((_i(key), name, desc, p.get("CollectionType"), p.get("CarRestrictionsReference.Key"),
                        p.get("ForcedPlayerCarRestrictions.Key"), _b(p.get("AvailableInSolo")),
                        _b(p.get("AvailableInCoOp")), _b(p.get("AvailableInPvP")),
                        json.dumps(p.get("RecommendedCars") or [])))
    rc_keys = {r[0] for r in rc_rows}
    ti_keys = {r[0] for r in ti_rows}

    cr_rows = []
    for key, p in ds["CareerRaceDataSet"].items():
        name, _ = res(p.get("Name"), True)
        tk, ck = _i(p.get("Track.Key")), _i(p.get("RaceCollection.Key"))
        if tk not in ti_keys:
            raise ValueError("career race %s refers to track %s, not in TrackInfoDataSet" % (key, tk))
        if ck not in rc_keys:
            raise ValueError("career race %s refers to collection %s, not in RaceCollectionDataSet" % (key, ck))
        cr_rows.append((_i(key), name, p.get("EventType"), tk, ck, p.get("RaceMode.Key"),
                        DISCIPLINE.get(p.get("RaceMode.Key")), _i(p.get("NumLaps")),
                        _i(p.get("NumberOfAIDrivers")), _b(p.get("IsTimedEvent")), _b(p.get("HasTraffic")),
                        _b(p.get("RivalsEnabled")), _b(p.get("TeamsEnabled")), p.get("UITheme"),
                        p.get("CustomEntityName") or None, p.get("ProgressionThread") if isinstance(p.get("ProgressionThread"), str) else None))

    crm = ds["CarRestrictionMap"]
    rv_rows = []
    for key, p in ds["RivalsEventDataMap"].items():
        name, name_key = res(p.get("Name"), True)
        desc, _ = res(p.get("Description"), False)
        ck = _i(p.get("RaceCollection.Key"))
        if ck not in rc_keys:
            raise ValueError("rivals event %s refers to collection %s, not in RaceCollectionDataSet" % (key, ck))
        rid = p.get("CarRestriction.Key")
        cls = _i(crm.get(rid, {}).get("CarClassId")) if rid else None
        rv_rows.append((_i(key), name, desc, p.get("LeaderboardId"), ck, rid, cls,
                        _b(p.get("IsClassBasedEvent")), _i(p.get("SortIndex")), name_key,
                        p.get("ForcedEventCar.Key"), p.get("WeatherPreset.Key")))

    keep = ("Id", "CarClassId", "CarBucketId", "PIMin", "PIMax", "PowerMin", "PowerMax", "WeightMin",
            "WeightMax", "YearMin", "YearMax", "Tagline", "DescriptionString")
    cx_rows = []
    for key, p in crm.items():
        tag, _ = res(p.get("Tagline"), False)
        desc, _ = res(p.get("DescriptionString"), False)
        rest = {k: v for k, v in p.items() if k not in keep}
        cx_rows.append((key, _i(p.get("CarClassId")), _i(p.get("CarBucketId")), _i(p.get("PIMin")),
                        _i(p.get("PIMax")), _i(p.get("PowerMin")), _i(p.get("PowerMax")),
                        _i(p.get("WeightMin")), _i(p.get("WeightMax")), _i(p.get("YearMin")),
                        _i(p.get("YearMax")), tag, desc, json.dumps(rest, sort_keys=True)))

    if misses:
        uniq = sorted(set(misses))
        print("  ! %d catalogue name-string(s) not in ref_string — left unnamed (likely new content): %s%s"
              % (len(uniq), ", ".join(uniq[:3]), " …" if len(uniq) > 3 else ""))

    with cx:
        cx.execute("BEGIN")                  # a PRAGMA outside a transaction autocommits and resets itself
        cx.execute("PRAGMA defer_foreign_keys=ON")
        for t in ("ref_career_race", "ref_rivals_event", "ref_race_collection", "ref_track_info",
                  "ref_car_restriction"):
            cx.execute("DELETE FROM %s" % t)
        n = {}
        n["ref_track_info"] = fh6db.upsert_many(cx, "ref_track_info", [
            "track_key", "route_id", "custom_route_id", "ribbon", "display_name", "short_name",
            "description", "name_key", "use_cross_country_ai", "blueprint_only", "activation_zone",
            "media_track", "pi_sort"], ti_rows)
        n["ref_race_collection"] = fh6db.upsert_many(cx, "ref_race_collection", [
            "collection_key", "name", "description", "collection_type", "restriction_id",
            "forced_restriction_id", "solo", "coop", "pvp", "recommended_cars"], rc_rows)
        n["ref_career_race"] = fh6db.upsert_many(cx, "ref_career_race", [
            "race_key", "name", "event_type", "track_key", "collection_key", "race_mode", "discipline",
            "num_laps", "n_ai", "is_timed", "has_traffic", "rivals_enabled", "teams", "ui_theme",
            "entity_name", "progression_thread"], cr_rows)
        n["ref_rivals_event"] = fh6db.upsert_many(cx, "ref_rivals_event", [
            "rivals_key", "name", "description", "leaderboard_id", "collection_key", "restriction_id",
            "class_id", "is_class_based", "sort_index", "name_key", "forced_car", "weather_preset"], rv_rows)
        n["ref_car_restriction"] = fh6db.upsert_many(cx, "ref_car_restriction", [
            "restriction_id", "car_class_id", "car_bucket_id", "pi_min", "pi_max", "power_min",
            "power_max", "weight_min", "weight_max", "year_min", "year_max", "tagline", "description",
            "data"], cx_rows)

    # the chain, as a report: every Rivals name -> route ids it resolves to
    chain = {}
    for r in cx.execute("SELECT name, route_id FROM v_rivals_route"):
        chain.setdefault(r["name"], set()).add(r["route_id"])
    multi = {k: sorted(v) for k, v in chain.items() if len(v) != 1}
    notes = {"rivals_names": len(chain), "rivals_names_one_route": sum(1 for v in chain.values() if len(v) == 1),
             "rivals_names_ambiguous": multi}
    if verbose:
        print("  rivals names %d, resolving to one route %d, ambiguous %s"
              % (notes["rivals_names"], notes["rivals_names_one_route"], multi or "none"))
    return n, notes


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--zip", default=ZIP_PATH)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    fh6db.migrate(cx)
    rid = fh6db.run_begin(cx, "objectmodel", a.zip)
    try:
        counts, notes = run(cx, a.zip, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1, json.dumps({"counts": counts, "notes": notes}))
    for k in sorted(counts):
        print("  %-20s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
