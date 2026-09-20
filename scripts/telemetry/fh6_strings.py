#!/usr/bin/env python3
"""Forza Horizon 6 .str string tables -- the game's own ID -> name layer.

Location: <install>/Content/media/stripped/stringtables/<LANG>.zip (EN.zip: 288 tables, Deflate, readable).
Format (reverse-engineered 2026-09-01 from GameStrings.str, validated on every table in EN.zip):

  0x00   U8 0, U8 8, then the table name, zero-padded to 0x80
  0x82   U16 version (2)
  0x84   U32 (table-1 size field)
  0x88   U32 offset of table 2
  0x8C   TABLE 1 -- the localised VALUES
  <t2>   TABLE 2 -- the symbolic KEYS (IDS_...)
  table  := U32 x, U32 y, U32 N, N x (U32 hash, U32 off), then NUL-terminated UTF-8 strings at blob+off

Both tables are keyed by the same 32-bit hash, so zipping them gives {IDS_key: text}. The IDS numbers in
Upgrades.str are the part-definition indices, and they follow the tier ladder recovered from the save
(e.g. IDS_Name_43..46 = Stock/Street/Sport/Race Brakes).

READ-ONLY. Never writes to the game install.
"""
import os, sys, json, struct, zipfile

DEFAULT_ZIP = "C:/XboxGames/Forza Horizon 6/Content/media/stripped/stringtables/EN.zip"
NUL = bytes([0])


def _table(b, o):
    x, y, n = struct.unpack_from("<3I", b, o)
    recs = [struct.unpack_from("<II", b, o + 12 + 8 * i) for i in range(n)]
    blob = o + 12 + 8 * n
    d = {}
    for key, off in recs:
        e = b.find(NUL, blob + off)
        d[key] = b[blob + off:e].decode("utf-8", "replace")
    return d


def parse_str(b):
    """{IDS_key: text} for one .str blob."""
    t2 = struct.unpack_from("<I", b, 0x88)[0]
    vals = _table(b, 0x8C)
    keys = _table(b, t2)
    return {keys.get(k, "0x%08X" % k): v for k, v in vals.items()}


def table_names(zip_path=DEFAULT_ZIP):
    with zipfile.ZipFile(zip_path) as zf:
        return [n[:-4] for n in zf.namelist() if n.lower().endswith(".str")]


def load(name, zip_path=DEFAULT_ZIP):
    """Load one table by name ('Upgrades' or 'Upgrades.str')."""
    if not name.lower().endswith(".str"):
        name += ".str"
    with zipfile.ZipFile(zip_path) as zf:
        return parse_str(zf.read(name))


def numbered(d, prefix):
    """{int n: text} for keys shaped <prefix>_<n>, e.g. numbered(load('Upgrades'), 'IDS_Name')."""
    out = {}
    for k, v in d.items():
        if k.startswith(prefix + "_"):
            tail = k[len(prefix) + 1:]
            if tail.isdigit():
                out[int(tail)] = v
    return dict(sorted(out.items()))


EXPORT = ["Upgrades", "UpgradeTypes", "UpgradeAreas", "UpgradePresetPackages", "List_Aspiration",
          "List_PartManufacturer", "WheelCategories", "CarClasses", "Tuning", "Data_Car", "List_CarMake",
          "List_EngineConfig", "List_Cylinders", "List_DriveType", "Tracks", "RivalsEventData",
          "CareerTrackInfo", "Landmarks", "MapRegion", "PointsOfInterest", "Rivals", "TimeAttack"]

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.abspath(os.path.join(here, "..", "..", "data", "game-strings"))
    os.makedirs(outdir, exist_ok=True)
    index = {}
    for name in EXPORT:
        try:
            d = load(name)
        except KeyError:
            index[name] = "absent"
            continue
        with open(os.path.join(outdir, name + ".json"), "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=1, ensure_ascii=False, sort_keys=True)
        index[name] = len(d)
    with open(os.path.join(outdir, "_index.json"), "w", encoding="utf-8") as fh:
        json.dump({"source": DEFAULT_ZIP, "format": "see fh6_strings.py docstring", "tables": index}, fh, indent=1)
    for k, v in index.items():
        print("  %-24s %s" % (k, v))
