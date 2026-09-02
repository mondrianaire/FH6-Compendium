#!/usr/bin/env python3
"""import_containers.py -- the tune_ and hw_ layers, from the game's save containers.

Reads every ``.../ContainersRoot/Tuning_<ordinal>_<stamp>/Data`` file (598 bytes) plus its
sibling ``header`` (the UTF-16 tune name) and writes, per container:

  tune_container  one row: identity, hashes, the resolved engine/drivetrain/body, the mass ledger
  tune_part       50 rows: part id AND the resolved name, tile, menu path -- so nothing downstream
                  has to resolve a name again
  tune_slider     36 rows: the raw 0..1 norm AND the physical value in the game's own unit,
                  with the band the fitted part supplied
  tune_gear       final drive + forward ratios

then groups containers into hw_package (distinct hardware) and setup (hardware + sliders).

**The game save is READ-ONLY.** This module only ever opens files under C:\\XboxGames for reading.

The decode itself is delegated to scripts/telemetry/fh6_tune_decode.py so there is exactly one
implementation of the 598-byte layout and of the hw/setup/tune hashes in the project.

Run:  python scripts/db/import_containers.py [--root DIR] [--db PATH] [--limit N] [-v]
"""
import argparse
import glob
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import fh6db                                            # noqa: E402
import fh6_tune_decode as td                            # noqa: E402

DIRNAME_RE = re.compile(r"Tuning_(\d+)_(\d{14})$")


def container_utc(stamp):
    """'20260901181414' -> '2026-09-01T18:14:14Z'.

    The folder stamp is UTC. Reading it as local time silently shifted every save by the
    timezone offset and mis-attributed laps to the wrong tune -- fixed once, never again.
    """
    return "%s-%s-%sT%s:%s:%sZ" % (stamp[0:4], stamp[4:6], stamp[6:8],
                                   stamp[8:10], stamp[10:12], stamp[12:14])


def tune_name(container_dir):
    """The display name from the sibling `header`: u32 char count at 0x04, UTF-16LE at 0x08."""
    try:
        with open(os.path.join(container_dir, "header"), "rb") as fh:
            h = fh.read()
        n = struct.unpack_from("<I", h, 4)[0]
        return h[8:8 + 2 * n].decode("utf-16-le").rstrip("\x00") if 0 < n < 512 else None
    except Exception:                                    # noqa: BLE001
        return None


def find_containers(root=None):
    root = root or td.find_containers_root()
    if not root:
        return [], None
    out = []
    for data in glob.glob(os.path.join(root, "Tuning_*", "Data")):
        d = os.path.dirname(data)
        m = DIRNAME_RE.search(os.path.basename(d))
        if not m:
            continue
        out.append((os.path.basename(d), int(m.group(1)), m.group(2), data, d))
    out.sort(key=lambda t: (t[1], t[2]))
    return out, root


class Ref:
    """The reference layer, loaded once: names, bands, menus."""

    def __init__(self, cx):
        self.slots = {r["slot"]: dict(r) for r in cx.execute("SELECT * FROM ref_slot")}
        self.slot_by_index = {r["slot_index"]: r["slot"] for r in cx.execute(
            "SELECT slot_index, slot FROM ref_slot")}
        self.part = {}
        for r in cx.execute("SELECT slot, part_id, key_id, level, is_stock, name, price, "
                            "mass_diff_kg, weight_dist_diff, tile, tile_count, confidence "
                            "FROM ref_part"):
            self.part[(r["slot"], r["part_id"])] = dict(r)
        self.bands = {}
        for r in cx.execute("SELECT slot, part_id, slider, def_value, min_value, max_value, "
                            "def_norm, locked FROM ref_part_slider"):
            self.bands[(r["slot"], r["part_id"], r["slider"])] = dict(r)
        self.slider = {r["slider"]: dict(r) for r in cx.execute("SELECT * FROM ref_slider")}
        self.car = {r["ordinal"]: dict(r) for r in cx.execute(
            "SELECT ordinal, class, pi, curb_weight_kg, weight_dist FROM ref_car")}
        self.body_variant = {r["carbody_id"]: r["variant"] for r in cx.execute(
            "SELECT carbody_id, variant FROM ref_car_body")}
        self.engine_mass = {r["engine_id"]: r["mass_kg"] for r in cx.execute(
            "SELECT engine_id, mass_kg FROM ref_engine")}
        self.classes = fh6db.load_classes(cx)

    def menu_path(self, slot):
        s = self.slots.get(slot) or {}
        area = s.get("menu_area")
        if not s.get("in_upgrade_shop"):
            return "Paint and Customize > %s" % (area or slot)
        return "Upgrade Shop > %s > %s" % (area or "?", s.get("part_name") or slot)


def key_id_for(slot, pid, ref, ctx):
    """The row's owning key: needed only to sanity-check a part belongs to this car."""
    p = ref.part.get((slot, pid))
    return p["key_id"] if p else None


def run(cx, root=None, limit=None, verbose=False):
    ref = Ref(cx)
    containers, croot = find_containers(root)
    if limit:
        containers = containers[:limit]
    if not containers:
        raise RuntimeError("no Tuning_* containers found (root=%r)" % croot)

    crows, prows, srows, grows = [], [], [], []
    unknown_ids, failures = {}, []
    now = fh6db.utcnow()

    for cname, ordinal, stamp, data_path, cdir in containers:
        try:
            t = td.parse_tune(data_path, ordinal_hint=ordinal)
        except Exception as e:                           # noqa: BLE001
            failures.append("%s: %s" % (cname, e))
            continue
        parts = t["parts"]

        # --- the component ids the rest of the row keys off -----------------
        def comp(slot, col):
            pid = parts.get(slot)
            p = ref.part.get((slot, pid)) if pid is not None else None
            return p["key_id"] if p else None

        engine_id = comp("engine", "EngineID")
        drivetrain_id = comp("drivetrain", "DrivetrainID")
        carbody_id = comp("car_body", "CarBodyID")
        motor_id = comp("motor", "MotorID")
        variant = ref.body_variant.get(carbody_id)

        # --- the mass ledger -----------------------------------------------
        # base = the fitted weight-reduction part's absolute Mass (it REPLACES the curb weight,
        # it is not a delta), then every other slot's MassDiff. Falls back to the car's curb
        # weight when no weight part is fitted.
        car = ref.car.get(ordinal) or {}
        base = None
        wpid = parts.get("weight_reduction")
        if wpid is not None:
            wp = ref.part.get(("weight_reduction", wpid))
            if wp:
                try:
                    base = json.loads(cx.execute(
                        "SELECT data FROM ref_part WHERE slot='weight_reduction' AND part_id=?",
                        (wpid,)).fetchone()["data"]).get("Mass")
                except Exception:                        # noqa: BLE001
                    base = None
        if base is None:
            base = car.get("curb_weight_kg")
        mass = float(base) if base else None
        dist = car.get("weight_dist")
        if mass is not None:
            for slot, pid in parts.items():
                if pid is None or slot == "weight_reduction":
                    continue
                p = ref.part.get((slot, pid))
                if p and p.get("mass_diff_kg"):
                    mass += float(p["mass_diff_kg"])
                if p and p.get("weight_dist_diff") and dist is not None:
                    dist += float(p["weight_dist_diff"])

        n_parts = sum(1 for v in parts.values() if v is not None)
        gears = t.get("gears_norm") or []

        crows.append((
            cname, ordinal, container_utc(stamp), tune_name(cdir), 1 if t["locked"] else 0,
            "downloaded" if t["locked"] else "self",
            td.hw_hash(data_path), td.setup_hash(data_path), td.tune_hash(data_path),
            None, engine_id, drivetrain_id, carbody_id, motor_id, variant,
            None, car.get("class"), n_parts, len(gears),
            round(mass, 2) if mass is not None else None,
            round(dist * 100, 2) if dist is not None else None,
            data_path, os.path.getmtime(data_path), now))

        # --- parts ----------------------------------------------------------
        for i, slot in enumerate(td.PARTS):
            pid = parts.get(slot)
            p = ref.part.get((slot, pid)) if pid is not None else None
            if pid is not None and p is None:
                unknown_ids.setdefault(slot, set()).add(pid)
            prows.append((cname, i, slot, pid,
                          p["name"] if p else None,
                          p["level"] if p else None,
                          p["tile"] if p else None,
                          p["tile_count"] if p else None,
                          ref.menu_path(slot),
                          p["is_stock"] if p else None,
                          p["price"] if p else None,
                          p["mass_diff_kg"] if p else None,
                          (p["confidence"] if p else ("unknown" if pid is not None else None))))

        # --- sliders: norm AND the physical value ---------------------------
        for name, meta in ref.slider.items():
            ent = (t["sliders"] or {}).get(name)
            if ent is None:
                continue
            norm = ent.get("norm")
            if norm is None:
                continue
            src_slot = meta["source_slot"]
            src_pid = parts.get(src_slot) if src_slot else None
            band = ref.bands.get((src_slot, src_pid, name)) if src_pid is not None else None
            if meta["band_source"] == "fixed":
                mn, mx = meta["fixed_min"], meta["fixed_max"]
                def_norm = band["def_norm"] if band else None
                locked = 0
            elif band:
                mn, mx, def_norm = band["min_value"], band["max_value"], band["def_norm"]
                locked = band["locked"]
            else:
                mn = mx = def_norm = None
                locked = 0
            val = fh6db.slider_value(norm, mn, mx) if mn is not None and mx is not None else None
            srows.append((cname, name, norm, val, meta["unit"], mn, mx, locked,
                          1 if (def_norm is not None and abs(norm - def_norm) <= 0.005) else 0,
                          src_slot, src_pid))

        # --- gears ----------------------------------------------------------
        # gear 0 is the final drive; 1..N the forward ratios. The container's stored list
        # includes reverse, which is why a "10 ratio" transmission is a 9-speed.
        for gi, g in enumerate(gears):
            grows.append((cname, gi, g))

    with cx:
        cx.execute("PRAGMA defer_foreign_keys=ON")
        for tbl in ("tune_gear", "tune_slider", "tune_part", "tune_container",
                    "hw_package_part", "setup", "hw_package"):
            cx.execute("DELETE FROM %s" % tbl)
        n_c = fh6db.upsert_many(cx, "tune_container", [
            "container", "ordinal", "saved_utc", "tune_name", "locked", "source", "hw_hash",
            "setup_hash", "tune_hash", "parts_hash", "engine_id", "drivetrain_id", "carbody_id",
            "motor_id", "body_variant", "pi", "class", "n_parts", "gear_count", "mass_kg",
            "front_pct", "file_path", "file_mtime", "imported_at"], crows)
        n_p = fh6db.upsert_many(cx, "tune_part", [
            "container", "slot_index", "slot", "part_id", "name", "level", "tile", "tile_count",
            "menu_path", "is_stock", "price", "mass_diff_kg", "confidence"], prows, chunk=5000)
        n_s = fh6db.upsert_many(cx, "tune_slider", [
            "container", "slider", "norm", "value", "unit", "min_value", "max_value", "locked",
            "is_install_default", "source_slot", "source_part_id"], srows, chunk=5000)
        n_g = fh6db.upsert_many(cx, "tune_gear", ["container", "gear", "ratio"], grows, chunk=5000)

        # --- hardware packages ---------------------------------------------
        cx.execute("""
            INSERT INTO hw_package(hw_hash, ordinal, pi, class, engine_id, drivetrain_id,
                                   carbody_id, n_containers, first_seen_utc, last_seen_utc)
            SELECT hw_hash, MIN(ordinal), MAX(pi), MAX(class), MAX(engine_id), MAX(drivetrain_id),
                   MAX(carbody_id), COUNT(*), MIN(saved_utc), MAX(saved_utc)
            FROM tune_container GROUP BY hw_hash""")
        cx.execute("""
            INSERT INTO hw_package_part(hw_hash, slot_index, slot, part_id, name)
            SELECT c.hw_hash, p.slot_index, p.slot, p.part_id, p.name
            FROM tune_part p
            JOIN tune_container c ON c.container = p.container
            JOIN (SELECT hw_hash, MIN(container) AS rep FROM tune_container GROUP BY hw_hash) r
              ON r.hw_hash = c.hw_hash AND r.rep = c.container""")
        cx.execute("""
            INSERT INTO setup(setup_hash, hw_hash, ordinal, n_containers, first_seen_utc)
            SELECT setup_hash, MIN(hw_hash), MIN(ordinal), COUNT(*), MIN(saved_utc)
            FROM tune_container GROUP BY setup_hash""")

    counts = {
        "tune_container": n_c, "tune_part": n_p, "tune_slider": n_s, "tune_gear": n_g,
        "hw_package": cx.execute("SELECT COUNT(*) FROM hw_package").fetchone()[0],
        "setup": cx.execute("SELECT COUNT(*) FROM setup").fetchone()[0],
    }
    if verbose:
        for slot, ids in sorted(unknown_ids.items()):
            print("  unresolved %s: %d ids e.g. %s" % (slot, len(ids), sorted(ids)[:5]))
    return counts, unknown_ids, failures, croot


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=None, help="a folder holding Tuning_* dirs")
    ap.add_argument("--db", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    cx = fh6db.connect(a.db)
    if not cx.execute("SELECT COUNT(*) FROM ref_part").fetchone()[0]:
        print("ref_part is empty -- run import_gamedb.py first", file=sys.stderr)
        return 2
    rid = fh6db.run_begin(cx, "containers", a.root or "GameSave")
    try:
        counts, unknown, failures, croot = run(cx, a.root, a.limit, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    notes = json.dumps({"root": croot, "failures": failures[:20],
                        "unknown_ids": {k: len(v) for k, v in unknown.items()}})
    fh6db.run_end(cx, rid, sum(counts.values()), 1, notes)
    for k in sorted(counts):
        print("  %-18s %8d" % (k, counts[k]))
    if failures:
        print("  %d container(s) failed to decode" % len(failures))
        for f in failures[:5]:
            print("    !", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
