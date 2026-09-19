#!/usr/bin/env python3
"""export_icons.py -- the game's own upgrade tile art, decoded once for the dashboard.

    python scripts/db/export_icons.py [--force] [--hires] [--out DIR]

WHY. The build sheet reproduces the in-game Upgrade Shop, and the game identifies every menu
and every tier with an ICON, not a word. Those icons ship with the game as BC7 textures in
``ui/textures/data_bound/Upgrade_Parts.zip`` (902 entries): one per part family
(``camshaft_Icon``), one per tier (``camshaft_1|2|3`` = Street/Sport/Race), one per shop
category (``aero_appearance_Icon``, ``conversion_*``), an ``_LG_`` variant of each for the
large panel, and 600 rim renders under ``Tire_Rims/Licensed_Rims`` named by the wheel's own
media name -- which is exactly ``ref_wheel.media_name``, so they join with no guessing.

Nothing here is generated art: every file is the game's pixels, decoded with
scripts/telemetry/fh6_swatchbin.py (pure-stdlib BC7) and saved as WebP.

RUN ONCE, not per rebuild: the game's files change only when the game updates, and the output
is ~600 small files. ``--force`` re-decodes; without it, existing files are kept.

Output:
    dashboard/v2/assets/upgrade/<stem>.webp          part / tier / category icons (200x200)
    dashboard/v2/assets/upgrade/lg/<stem>.webp       the large variants
    dashboard/v2/assets/upgrade/rims/<media>.webp    rim renders, keyed by ref_wheel.media_name
    dashboard/v2/api/icons.json                      the manifest the sheet reads
"""
import argparse
import io
import json
import os
import sqlite3
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))
import fh6_swatchbin as sw                                   # noqa: E402

GAME = r"C:\XboxGames\Forza Horizon 6\Content\media\ui\textures"
ZIP_STD = os.path.join(GAME, "data_bound", "Upgrade_Parts.zip")
ZIP_HIRES = os.path.join(GAME, "hires", "data_bound", "Upgrade_Parts.zip")
CLASS_ZIP = os.path.join(GAME, "data_bound", "Upgrade_Class.zip")

# Our slot name -> the icon family the game draws for it. 22 slots match by name; the rest are
# the game's own spelling of the same thing, or a family that covers several of our slots.
# Where the game splits a family by engine type (fuel system, ignition, pistons), the first
# entry is the one to draw when we cannot tell which applies.
SLOT_ICON = {
    "front_arb": "anti_roll_bars_front", "rear_arb": "anti_roll_bars_rear",
    "differential": "diff", "roll_cage": "chassis_reinforcement",
    "oil_cooling": "oil_cooling_system", "manifold": "manifold_throttle_body",
    "single_turbo": "turbo_single", "twin_turbo": "turbo_twin", "quad_turbo": "turbo_twin",
    "pos_supercharger": "pos_dis_supercharger",
    "fuel_system": "fuel_system_injection", "ignition": "ignition_electronic",
    "pistons": "pistons_compression_NA",
    # the conversions are their own family
    "engine": "conversion_engine", "drivetrain": "conversion_drivetrain",
    "aspiration": "conversion_aspiration", "car_body": "conversion_body",
    "motor_parts": "motorbattery",
    # tyres and rims: the game keeps these in Tire_Rims
    "tire_compound": "tire_compound", "front_tire_width": "tire_width",
    "rear_tire_width": "tire_width", "front_tire_profile": "tire_profile",
    "rear_tire_profile": "tire_profile", "front_rim_size": "rim_size",
    "rear_rim_size": "rim_size", "rim_style": "rim_style", "rear_rim_style": "rim_style",
    "front_track_width": "track_width", "rear_track_width": "track_width",
}
# the six Upgrade Shop categories, in the game's own order (docs/fh6-ui-spec.md 2)
AREA_ICON = {
    "Engine": "engine_power", "Platform and Handling": "platform_handling",
    "Drivetrain": "drivetrain", "Tires and Rims": "rim_style",
    "Aero and Appearance": "aero_appearance", "Body Kits and Conversions": "conversion",
    "Motor and Battery": "motorbattery",
}
ALT = {                       # families the game splits; the sheet picks by context
    "fuel_system": ["fuel_system_injection", "fuel_system_carburetor"],
    "ignition": ["ignition_electronic", "ignition_mechanical"],
    "pistons": ["pistons_compression_NA", "pistons_compression_FI"],
    "springs_dampers": ["springs_dampers", "springs_dampers_offroad"],
    "engine": ["conversion_engine", "diesel_engine", "wankel"],
}


def _webp(raw, path, force):
    if os.path.exists(path) and not force:
        return 0
    png, w, h = sw.decode_to_png(raw)
    try:
        from PIL import Image                                # noqa: WPS433
        im = Image.open(io.BytesIO(png))
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=90, method=4)
        body = buf.getvalue()
    except Exception:                                        # noqa: BLE001 -- PNG is fine, just larger
        body, path = png, os.path.splitext(path)[0] + ".png"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(body)
    return len(body)


def export(db_path=None, out=None, force=False, hires=False, quiet=False):
    zpath = ZIP_HIRES if hires else ZIP_STD
    if not os.path.exists(zpath):
        print("no icon archive at %s -- is the game installed?" % zpath)
        return {}
    out = out or os.path.join(ROOT, "dashboard", "v2")
    adir = os.path.join(out, "assets", "upgrade")
    z = zipfile.ZipFile(zpath)
    entries = {n: n for n in z.namelist() if n.endswith(".swatchbin")}

    def stem(n):
        return os.path.splitext(os.path.basename(n))[0]

    # ---- part / tier / category icons -------------------------------------------------
    icons, n_new, n_bytes = {}, 0, 0
    for n in entries:
        if n.startswith("Tire_Rims/Licensed_Rims/"):
            continue
        s = stem(n)
        lg = "_LG_" in s or s.endswith("_LG")
        base = s.replace("_LG_", "_").replace("_LG", "")
        fam, _, tail = base.rpartition("_")
        if tail == "Icon":
            key, tier = fam or base, None
        elif tail.isdigit():
            key, tier = fam, int(tail)
        else:
            key, tier = base, None
        rel = ("lg/" if lg else "") + (key if tier is None else "%s_%d" % (key, tier)) + ".webp"
        wrote = _webp(z.read(n), os.path.join(adir, rel.replace("/", os.sep)), force)
        if wrote:
            n_new += 1
            n_bytes += wrote
        if not lg:
            e = icons.setdefault(key, {"icon": None, "tiers": {}})
            if tier is None:
                e["icon"] = "assets/upgrade/" + rel
            else:
                e["tiers"][str(tier)] = "assets/upgrade/" + rel

    # ---- rim renders, joined to ref_wheel.media_name ----------------------------------
    rims, matched = {}, 0
    db_path = db_path or os.path.join(ROOT, "data", "fh6.db")
    media = {}
    if os.path.exists(db_path):
        cx = sqlite3.connect("file:%s?mode=ro" % db_path.replace("\\", "/"), uri=True)
        media = {r[0]: r[1] for r in cx.execute(
            "SELECT media_name, wheel_id FROM ref_wheel WHERE media_name IS NOT NULL")}
        cx.close()
    for n in entries:
        if not n.startswith("Tire_Rims/Licensed_Rims/"):
            continue
        s = stem(n)
        wrote = _webp(z.read(n), os.path.join(adir, "rims", s + ".webp"), force)
        if wrote:
            n_new += 1
            n_bytes += wrote
        rims[s] = "assets/upgrade/rims/%s.webp" % s
        if s in media:
            matched += 1

    man = {
        "generated_from": os.path.basename(zpath),
        "note": "the game's own upgrade tile art, decoded from BC7; nothing here is drawn by us",
        "icons": icons,                       # family -> {icon, tiers{1,2,3}}
        "slot_icon": SLOT_ICON,               # our slot -> family (the rest match by name)
        "area_icon": AREA_ICON,               # the six shop categories
        "alt": ALT,                           # families the game splits by engine type
        "rims": rims,                         # media_name -> file (join ref_wheel.media_name)
        "rims_matched_to_ref_wheel": matched,
    }
    api = os.path.join(out, "api", "icons.json")
    os.makedirs(os.path.dirname(api), exist_ok=True)
    with open(api, "w", encoding="utf-8") as fh:
        json.dump(man, fh, separators=(",", ":"))
    if not quiet:
        print("  icons: %d families, %d rim renders (%d joined to ref_wheel), %d new files, %.1f MB"
              % (len(icons), len(rims), matched, n_new, n_bytes / 1e6))
    return man


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--force", action="store_true", help="re-decode files that already exist")
    ap.add_argument("--hires", action="store_true", help="use the hires archive")
    a = ap.parse_args(argv)
    export(a.db, a.out, a.force, a.hires)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
