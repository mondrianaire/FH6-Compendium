#!/usr/bin/env python3
"""Build data/engine-swaps.json — the ENGINE-FAMILY catalog that lets the decode name an engine swap.

THE KEY INSIGHT (2026-08-23): the save's `engine` part slot is ALWAYS the car's own-ordinal family
(it only encodes the engine BUILD level, tier=id%1000) — so the old decode read it and called EVERY car
"Stock engine". The engine's real identity is the family shared UNIFORMLY by the engine-internal parts
(camshaft, valves, displacement, pistons, fuel_system, ignition, exhaust, intake, flywheel, oil_cooling)
and the aspiration slot. That family is a stable ENGINE-CATALOG id:

  * ~18% of families are the DONOR car's ordinal (F430 4.3 V8, 911 Turbo flat-6, M4 straight-six, ...).
  * A family used by >=2 distinct cars is unambiguously a SWAP (a stock engine is unique to its car).
  * The rest are catalog ids we name from their signature (aspiration + the Honda/etc cars that share them).

This tool mines every on-disk Data file + the ordinal roster and writes the catalog. Telemetry-measured fields
(cyl / displacement_l / redline / sample_hp / resulting_drivetrain / sample_pi) are left null here and filled
in over time by the live daemon as swapped cars are driven — that is the "PI / signature per part" accrual.
Re-runnable; merges onto any existing catalog without dropping daemon-learned fields."""
import json, os, sys, glob, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import fh6_tune_decode as T

INTERNALS = ["camshaft", "valves", "displacement", "pistons", "fuel_system", "ignition",
             "exhaust", "intake", "flywheel", "oil_cooling", "manifold", "restrictor_plate", "intercooler"]
ASP = ["pos_supercharger", "centrifugal_supercharger", "single_turbo", "twin_turbo", "quad_turbo"]
ASP_WORD = {"pos_supercharger": "Supercharged", "centrifugal_supercharger": "Centrifugal-Supercharged",
            "single_turbo": "Turbo", "twin_turbo": "Twin-Turbo", "quad_turbo": "Quad-Turbo"}


def engine_family(parts):
    """The engine's identity = the modal family across the engine-internal slots (they are ~always uniform).
    Returns (family, aspiration_slot) or (None, None) when there are no engine-internal parts."""
    fams = [parts[s] // 1000 for s in INTERNALS if parts.get(s) is not None]
    if not fams:
        return None, None
    fam = collections.Counter(fams).most_common(1)[0][0]
    asp = next((s for s in ASP if parts.get(s) is not None), None)
    return fam, asp


def brand_of(name):
    return (name or "").split()[1] if name and len(name.split()) > 1 else None


def main():
    roster = json.load(open(os.path.join(ROOT, "data", "car-ordinals.json"), encoding="utf-8"))["cars"]

    def car_name(o):
        c = roster.get(str(o))
        return c["name"] if c else None

    save_root = T.find_containers_root()
    fam_cars = collections.defaultdict(set)       # family -> {own ordinals}
    fam_asp = collections.defaultdict(collections.Counter)
    if save_root:
        for data in glob.glob(os.path.join(save_root, "Tuning_*", "Data")):
            try:
                t = T.parse_tune(data)
            except Exception:
                continue
            own = int(t["ordinal"])
            fam, asp = engine_family(t["parts"])
            if fam is None:
                continue
            fam_cars[fam].add(own)
            if asp:
                fam_asp[fam][asp] += 1

    families = {}
    for fam, owns in sorted(fam_cars.items()):
        cars_seen = {str(o): car_name(o) for o in sorted(owns)}
        donor_name = car_name(fam)
        shared = len(owns) > 1
        asp_mode = fam_asp[fam].most_common(1)[0][0] if fam_asp[fam] else None
        # brand guess: the marque shared by a MAJORITY (>=60%) of the cars that carry this family names the swap engine
        blist = [brand_of(n) for n in cars_seen.values() if brand_of(n)]
        brand = None
        if blist:
            b, bn = collections.Counter(blist).most_common(1)[0]
            if bn / len(blist) >= 0.6:
                brand = b
        # best human label — donor car if the family is a known ordinal, else a signature label
        if donor_name:
            label = f"{donor_name} engine swap"
        else:
            bits = []
            if asp_mode:
                bits.append(ASP_WORD.get(asp_mode, asp_mode))
            bits.append("engine")
            label = (f"{brand} " if brand else "") + " ".join(bits) + f" (family {fam})"
        families[str(fam)] = {
            "engine_family": fam,
            "donor_ordinal": fam if donor_name else None,
            "donor_name": donor_name,
            "brand_guess": brand,
            "label": label,
            "aspiration_slot": asp_mode,
            "aspiration": ASP_WORD.get(asp_mode) if asp_mode else "Naturally aspirated",
            "shared_swap": shared,
            "cars_seen": cars_seen,
            # telemetry-measured, filled by the daemon as these engines are driven (null until then):
            "cyl": None, "displacement_l": None, "redline": None,
            "sample_hp": None, "resulting_drivetrain": None, "sample_pi": None,
            "source": "save-mined",
        }

    out_path = os.path.join(ROOT, "data", "engine-swaps.json")
    # merge onto existing (keep any daemon-learned telemetry fields)
    prev = {}
    if os.path.exists(out_path):
        try:
            prev = json.load(open(out_path, encoding="utf-8")).get("families", {})
        except Exception:
            prev = {}
    for fam_k, rec in families.items():
        old = prev.get(fam_k) or {}
        for tf in ("cyl", "displacement_l", "redline", "sample_hp", "resulting_drivetrain", "sample_pi"):
            if old.get(tf) is not None:
                rec[tf] = old[tf]
                if rec["source"] == "save-mined":
                    rec["source"] = "save-mined+telemetry"

    doc = {
        "schema_version": "1.0.0",
        "purpose": "Engine-FAMILY catalog. The engine's identity in the save = the family shared by the engine-internal "
                   "parts + aspiration (NOT the `engine` slot, which is always the car's own ordinal). A family used by "
                   ">=2 distinct cars is a swap; families that are a car ordinal name the donor engine. cyl/displacement/"
                   "redline/hp/drivetrain/PI are measured live by the daemon as each swap is driven (per-part signature accrual).",
        "generated_by": "scripts/telemetry/build_engine_catalog.py",
        "family_count": len(families),
        "families": families,
    }
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    os.replace(tmp, out_path)
    named = sum(1 for r in families.values() if r["donor_name"])
    shared = sum(1 for r in families.values() if r["shared_swap"])
    print(f"wrote {os.path.relpath(out_path, ROOT)} — {len(families)} engine families "
          f"({named} named to a donor car, {shared} shared/confirmed swaps)")


if __name__ == "__main__":
    main()
