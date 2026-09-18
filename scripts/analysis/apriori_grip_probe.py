"""Can a build's grip ceiling be predicted from the BUILD ALONE -- no laps driven?

Jett, 2026-09-18: "these are great but they are using historical data to build the data. Using only the raw
data from the upgrades and tuning information, can we build something similar?"

ANSWER SO FAR: the INPUTS are all there, the TARGET is sound, and this first-cut model DOES NOT YET WORK.
Kept as the experiment, not as a component -- nothing renders from it.

  INPUTS (all present, no telemetry needed)
    ref_friction_curve   the game's own lateral asphalt curves, two authored load bands per compound
                         (light 10.2 kgf peak mu 1.70 on a slick, heavy 1000 kgf 1.45) -- load sensitivity
                         modelled exactly as a tyre model would express it, clamped at 3500 kgf
    hw_package_part      the fitted tire_compound part -> ref_part.data.TireCompoundID -> the curves above
    tune_container       mass_kg, the BUILT mass as saved
    tune_slider          front_downforce / rear_downforce, in kgf (0-480 / 0-624 observed)

  TARGET is fair. The measured ceiling is a real, repeatable property of a build, not an artefact of where
  it was driven: the same build's lat_g p95 across three to eight different courses moves by 0.09, 0.14 and
  0.14 g for three of five builds (0.38 and 0.53 g for the other two). So ~0.15 g is the target's own noise.

  MODEL   a_lat_max = mu(load) * (m*g + downforce) / (m*g), load taken as m/4 per tyre.
  RESULT  leave-one-out, calibrating a constant per compound on that compound's other builds:
            mean |error| 0.314 g   vs   0.295 g for simply guessing the fleet median.
          No better than guessing. And the miss is ~2x the target's own noise, so something real is
          missing rather than the data being too dirty to fit.

  WHAT IS MISSING, in the order worth trying
    1. TYRE WIDTH. Ignored here entirely, and it is one of the biggest grip levers in the game. The
       front_tire_width / rear_tire_width parts are in every build already.
    2. TYRE PRESSURE. A tune slider, and it moves the curve.
    3. PER-AXLE, not average. Grip is limited by the weaker end and by the outer tyres under load
       transfer; m/4 understates the load exactly where the load-sensitivity curve bites hardest.
    4. The compound resolution for the worst-fitting group. Per-compound spread is tight for
       51_Modern_Rally (7%) and 11_DOT_Competition (4%) but 70% for 13_RacingSlick and 41% for
       48_Extreme_Off_road_Truck -- and an offroad-truck compound resolved onto a road build that pulls
       2.45 g deserves a second look before it is modelled.

Read-only. Prints a table and the leave-one-out score; renders nothing.
"""
import json
import math
import os
import sqlite3
import statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = os.path.join(ROOT, "data", "fh6.db")
ENV = os.path.join(ROOT, "data", "grip-envelope.json")
cx = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True)
cx.row_factory = sqlite3.Row

# --- the tyre model, straight from the game -----------------------------------------------------------
BANDS = {}
for r in cx.execute("""SELECT compound_id, load_band, load_kgf, load_clamp_kgf, friction_scale
                       FROM ref_friction_curve
                       WHERE channel='lat' AND surface='asphalt'"""):
    BANDS.setdefault(r["compound_id"], {})[r["load_band"]] = dict(r)


def mu_at(compound_id, load_kgf_per_tyre):
    b = BANDS.get(compound_id)
    if not b or 0 not in b or 1 not in b:
        return None
    lo, hi = b[0], b[1]
    clamp = hi["load_clamp_kgf"] or 3500.0
    L = min(max(load_kgf_per_tyre, lo["load_kgf"]), clamp)
    f = (L - lo["load_kgf"]) / (hi["load_kgf"] - lo["load_kgf"])
    # beyond the heavy curve's authored load the two-point blend keeps extrapolating; the game clamps the
    # BLEND at load_clamp, so hold the slope to there and no further
    return lo["friction_scale"] + (hi["friction_scale"] - lo["friction_scale"]) * f


# --- per-build inputs ---------------------------------------------------------------------------------
PART_COMPOUND = {}
for r in cx.execute("SELECT part_id, data FROM ref_part WHERE slot='tire_compound' AND data IS NOT NULL"):
    try:
        PART_COMPOUND[r["part_id"]] = json.loads(r["data"]).get("TireCompoundID")
    except Exception:
        pass
# the BUILT mass is saved with the tune itself -- no need to sum part deltas and hope the set is complete
BUILTKG = {}
for r in cx.execute("SELECT tune_hash, mass_kg FROM tune_container WHERE mass_kg IS NOT NULL"):
    BUILTKG.setdefault(r["tune_hash"], []).append(r["mass_kg"])
CARKG = {r["ordinal"]: r["curb_weight_kg"] for r in cx.execute(
    "SELECT ordinal, curb_weight_kg FROM ref_car WHERE curb_weight_kg IS NOT NULL")}

MASSDIFF = {(r["slot"], r["part_id"]): (r["mass_diff_kg"] or 0.0)
            for r in cx.execute("SELECT slot, part_id, mass_diff_kg FROM ref_part")}

env = json.load(open(ENV, encoding="utf-8"))
print(f"{'build':>18} {'cls':>3} {'compound':<22} {'kg':>6} {'DF kgf':>7} "
      f"{'mu@load':>7} {'pred no-DF':>10} {'measured':>9} {'ratio':>6}")
rows = []
for b in env["builds"]:
    hw, tune = b["hw"], b["tune"]
    ordinal = int(str(b["cid"]).split("|")[0])
    parts = list(cx.execute("SELECT slot, part_id, name FROM hw_package_part WHERE hw_hash=?", (hw,)))
    if not parts:
        continue
    cpart = next((p for p in parts if p["slot"] == "tire_compound"), None)
    comp = PART_COMPOUND.get(cpart["part_id"]) if cpart else None
    if comp is None:
        continue
    kg = st.median(BUILTKG[tune]) if BUILTKG.get(tune) else CARKG.get(ordinal)
    if not kg:
        continue
    # the tune's downforce, from the sliders. A container belonging to this tune_hash.
    df = cx.execute("""SELECT SUM(CASE WHEN s.slider='front_downforce' THEN s.value ELSE 0 END) f,
                              SUM(CASE WHEN s.slider='rear_downforce'  THEN s.value ELSE 0 END) r
                       FROM tune_slider s JOIN tune_container c ON c.container = s.container
                       WHERE c.tune_hash = ? AND s.slider IN ('front_downforce','rear_downforce')""",
                    (tune,)).fetchone()
    dff, dfr = (df["f"] or 0.0, df["r"] or 0.0) if df else (0.0, 0.0)
    dftot = dff + dfr
    mu = mu_at(comp, kg / 4.0)
    if mu is None:
        continue
    name = next((r["internal_name"] for r in cx.execute(
        "SELECT internal_name FROM ref_compound WHERE compound_id=?", (comp,))), str(comp))
    meas = b["aMaxP95"]
    rows.append({"hw": hw, "cls": b["class"], "comp": comp, "name": name, "kg": kg,
                 "df": dftot, "mu": mu, "meas": meas})
    print(f"{hw[:8] + '/' + tune[:8]:>18} {b['class']:>3} {name[:22]:<22} {kg:6.0f} {dftot:7.0f} "
          f"{mu:7.3f} {mu:10.2f} {meas:9.2f} {meas / mu:6.2f}")

if len(rows) >= 6:
    print()
    ratios = [r["meas"] / r["mu"] for r in rows]
    print(f"measured / mu(no downforce): median {st.median(ratios):.2f}, range {min(ratios):.2f}-{max(ratios):.2f}")
    withdf = [r for r in rows if r["df"] > 20]
    nodf = [r for r in rows if r["df"] <= 20]
    print(f"  builds WITH downforce ({len(withdf)}): median ratio "
          f"{st.median([r['meas'] / r['mu'] for r in withdf]):.2f}" if withdf else "  none with downforce")
    print(f"  builds WITHOUT downforce ({len(nodf)}): median ratio "
          f"{st.median([r['meas'] / r['mu'] for r in nodf]):.2f}" if nodf else "  none without downforce")
    # solve the one free parameter: what fraction of the slider's kgf is acting when the ceiling is measured?
    print()
    for k in (0.0, 0.25, 0.5, 0.75, 1.0):
        errs = []
        for r in rows:
            pred = r["mu"] * (1 + k * r["df"] / r["kg"])
            errs.append(pred - r["meas"])
        print(f"  downforce acting at {k:4.0%} of slider kgf -> median error "
              f"{st.median(errs):+.2f} g, mean |error| {st.mean([abs(e) for e in errs]):.2f} g")

# --- is the gap STRUCTURED? If the ratio is tight WITHIN a compound, then one constant per compound --
# calibrated once from driven data -- predicts every future build on that compound without driving it.
print()
print("=== ratio (measured / predicted) grouped by tyre compound")
byc = {}
for r in rows:
    byc.setdefault((r["comp"], r["name"]), []).append(r)
for (cid_, nm), g in sorted(byc.items(), key=lambda kv: -len(kv[1])):
    rs = [x["meas"] / (x["mu"] * (1 + x["df"] / x["kg"])) for x in g]
    if len(g) >= 2:
        spread = (max(rs) - min(rs)) / st.median(rs)
        print(f"  {nm[:26]:<26} n={len(g):2d}  ratio median {st.median(rs):.2f}  "
              f"range {min(rs):.2f}-{max(rs):.2f}  spread {spread:.0%}")
    else:
        print(f"  {nm[:26]:<26} n={len(g):2d}  ratio {rs[0]:.2f}")

print()
print("=== leave-one-out: calibrate the constant on the OTHER builds of that compound, predict this one")
errs, base_errs = [], []
for r in rows:
    peers = [x for x in rows if x["comp"] == r["comp"] and x is not r]
    if not peers:
        continue
    k = st.median([x["meas"] / (x["mu"] * (1 + x["df"] / x["kg"])) for x in peers])
    pred = r["mu"] * (1 + r["df"] / r["kg"]) * k
    errs.append(abs(pred - r["meas"]))
    base_errs.append(abs(st.median([x["meas"] for x in rows]) - r["meas"]))
if errs:
    print(f"  {len(errs)} builds predicted from their compound's constant alone")
    print(f"  mean |error| {st.mean(errs):.3f} g   median |error| {st.median(errs):.3f} g")
    print(f"  baseline (just guess the fleet median a_max): mean |error| {st.mean(base_errs):.3f} g")
