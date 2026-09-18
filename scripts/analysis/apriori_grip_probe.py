#!/usr/bin/env python
"""Can a build's grip ceiling be predicted from the BUILD ALONE -- no laps driven?

Jett, 2026-09-18: "these are great but they are using historical data to build the data. Using only the raw
data from the upgrades and tuning information, can we build something similar?" -- then, after a first
attempt that went nowhere: "yes, take the next swing with tire width and per-axle load".

WHERE IT STANDS: a partial yes. The MAGNITUDE model beats guessing by 15% and is still missing most of the
signal; the BALANCE model gets the right answer 17 times in 22. Kept as the experiment, not as a component --
nothing in the dashboard renders from this.

  INPUTS, all present, no telemetry
    ref_friction_curve   the game's own lateral asphalt curves, TWO authored load bands per compound
                         (racing slick: mu 1.70 at 10.2 kgf, 1.45 at 1000 kgf, blend clamped at 3500) --
                         load sensitivity exactly as a tyre model expresses it
    hw_package_part      tire_compound -> ref_part.data.TireCompoundID -> those curves;
                         front/rear_tire_width -> ref_part.data.FrontTireWidth / RearTireWidth, in mm
    tune_container       mass_kg (the built mass) and front_pct (the built weight distribution)
    tune_slider          front_downforce / rear_downforce in kgf; tyre pressures in psi

  MODEL v2 -- two changes on v1, both physical rather than fitted:
    PER AXLE   each axle must make lateral force in proportion to the mass it carries, so the weaker one
               sets the limit:  N_a = m_a*g + DF_a,  a_a = mu_a * N_a / m_a,  a_max = min(a_f, a_r).
               Which axle comes out smaller is a prediction of understeer vs oversteer, testable by itself.
    WIDTH AS PRESSURE, not as a bonus. Load sensitivity is really about contact PRESSURE, so a wider tyre
               at the same load behaves like a narrower one at lower load: width enters the EXISTING curve
               lookup rather than adding a new term,  L_eff = (N_a/2) * (W_ref / W_a).

  ABLATION (leave-one-out; the per-compound constant is calibrated on that compound's OTHER builds only;
  25 builds; baseline = guess the fleet median, 0.327 g)
    v1  lump, no width             0.292 g   -11%
        lump + width               0.298 g    -9%   width alone does nothing
    v2  per-axle, no width         0.292 g   -11%   per axle alone does nothing either
        per-axle + width           0.277 g   -15%   only TOGETHER do they help
        per-axle + width + press   0.311 g    -5%   pressure HURTS: the contact-patch model for it is wrong
  W_ref has a real interior optimum (0.294 g at 150 mm, 0.277 at 350, 0.275 at 500, 0.387 at 800), so the
  width term is doing something beyond absorbing a global scale.

  BALANCE is the strongest result: the axle the model calls weaker is the axle that actually let go more
  often, on 17 of the 22 builds that have a clear observed bias.

  READ IT HONESTLY
    - 0.277 g of error against a target whose own noise is ~0.15 g: about half the signal is still missing.
    - That 0.277 was picked after sweeping 36 configurations over 25 builds, so it is an optimistic number.
    - The TARGET is now the likely problem. lat_g p95 is a peak over each 4 m window, not a steady-state
      cornering ceiling, and a steady-state model should be fitted to a steady-state measure -- the
      a = v^2/R implied by the envelope's own grip-limited arm. Change that before adding more terms.

Read-only. Prints the ablation; renders nothing.
"""
import json
import math
import os
import sqlite3
import statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import argparse

_ap = argparse.ArgumentParser(description="a-priori grip-ceiling probe (read-only)")
_ap.add_argument("--db", default=os.path.join(ROOT, "data", "fh6.db"))
_ap.add_argument("--env", default=os.path.join(ROOT, "data", "grip-envelope.json"),
                 help="the measured envelopes from grip_envelope.py, used only as the target to score against")
_args = _ap.parse_args()
DB, ENV = _args.db, _args.env
cx = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True)
cx.row_factory = sqlite3.Row

BANDS = {}
for r in cx.execute("""SELECT compound_id, load_band, load_kgf, load_clamp_kgf, friction_scale
                       FROM ref_friction_curve WHERE channel='lat' AND surface='asphalt'"""):
    BANDS.setdefault(r["compound_id"], {})[r["load_band"]] = dict(r)


def mu_at(cid, load_kgf):
    b = BANDS.get(cid)
    if not b or 0 not in b or 1 not in b:
        return None
    lo, hi = b[0], b[1]
    L = min(max(load_kgf, lo["load_kgf"]), hi["load_clamp_kgf"] or 3500.0)
    f = (L - lo["load_kgf"]) / (hi["load_kgf"] - lo["load_kgf"])
    return lo["friction_scale"] + (hi["friction_scale"] - lo["friction_scale"]) * f


PART = {}
for r in cx.execute("SELECT slot, part_id, data FROM ref_part WHERE data IS NOT NULL"):
    try:
        PART[(r["slot"], r["part_id"])] = json.loads(r["data"])
    except Exception:
        pass
BUILTKG, FRONTPCT = {}, {}
for r in cx.execute("SELECT tune_hash, mass_kg, front_pct FROM tune_container WHERE mass_kg IS NOT NULL"):
    BUILTKG.setdefault(r["tune_hash"], []).append(r["mass_kg"])
    if r["front_pct"]:
        FRONTPCT.setdefault(r["tune_hash"], []).append(r["front_pct"])
CAR = {r["ordinal"]: dict(r) for r in cx.execute(
    "SELECT ordinal, curb_weight_kg, weight_dist, front_tire_mm, rear_tire_mm FROM ref_car")}

env = json.load(open(ENV, encoding="utf-8"))
builds = []
for b in env["builds"]:
    hw, tune = b["hw"], b["tune"]
    ordinal = int(str(b["cid"]).split("|")[0])
    car = CAR.get(ordinal) or {}
    parts = {r["slot"]: r["part_id"] for r in cx.execute(
        "SELECT slot, part_id FROM hw_package_part WHERE hw_hash=?", (hw,))}
    cp = PART.get(("tire_compound", parts.get("tire_compound")))
    comp = cp.get("TireCompoundID") if cp else None
    kg = st.median(BUILTKG[tune]) if BUILTKG.get(tune) else car.get("curb_weight_kg")
    if comp is None or not kg:
        continue
    fp = (st.median(FRONTPCT[tune]) / 100.0) if FRONTPCT.get(tune) else (car.get("weight_dist") or 0.5)
    wf = (PART.get(("front_tire_width", parts.get("front_tire_width"))) or {}).get("FrontTireWidth") \
        or car.get("front_tire_mm")
    wr = (PART.get(("rear_tire_width", parts.get("rear_tire_width"))) or {}).get("RearTireWidth") \
        or car.get("rear_tire_mm")
    if not wf or not wr:
        continue
    df = cx.execute("""SELECT AVG(CASE WHEN s.slider='front_downforce' THEN s.value END) f,
                              AVG(CASE WHEN s.slider='rear_downforce'  THEN s.value END) r
                       FROM tune_slider s JOIN tune_container c ON c.container=s.container
                       WHERE c.tune_hash=? AND s.slider IN ('front_downforce','rear_downforce')""",
                    (tune,)).fetchone()
    dff, dfr = (df["f"] or 0.0), (df["r"] or 0.0)
    # which axle actually let go more often, from the driven envelope -- the balance check
    af = sum(x["axle"][0] for x in b["bins"])
    ar = sum(x["axle"][1] for x in b["bins"])
    builds.append({"hw": hw, "tune": tune, "cls": b["class"], "comp": comp, "kg": kg, "fp": fp,
                   "wf": wf, "wr": wr, "dff": dff, "dfr": dfr, "meas": b["aMaxP95"],
                   "obs_axle": "front" if af > ar * 1.2 else "rear" if ar > af * 1.2 else "even",
                   "name": cx.execute("SELECT internal_name FROM ref_compound WHERE compound_id=?",
                                      (comp,)).fetchone()[0]})


PRESS = {}
for r in cx.execute("""SELECT c.tune_hash th,
        AVG(CASE WHEN s.slider='front_tire_pressure' THEN s.value END) f,
        AVG(CASE WHEN s.slider='rear_tire_pressure'  THEN s.value END) r
      FROM tune_slider s JOIN tune_container c ON c.container=s.container
      WHERE s.slider LIKE '%tire_pressure%' GROUP BY c.tune_hash"""):
    PRESS[r["th"]] = (r["f"], r["r"])

def pred(b, use_axle, use_width, use_press, wref=350.0, pref=30.0):
    if not use_axle:
        n = b["kg"] + b["dff"] + b["dfr"]
        w = (b["wf"] + b["wr"]) / 2
        L = n / 4 * ((wref / w) if use_width else 1.0)
        mu = mu_at(b["comp"], L)
        return (mu * n / b["kg"], None) if mu else (None, None)
    mf, mr = b["kg"] * b["fp"], b["kg"] * (1 - b["fp"])
    nf, nr = mf + b["dff"], mr + b["dfr"]
    pf, pr = PRESS.get(b["tune"], (None, None))
    # pressure as contact patch: higher pressure shrinks the patch, so the same load presses harder
    kf = (pf / pref) if (use_press and pf) else 1.0
    kr = (pr / pref) if (use_press and pr) else 1.0
    Lf = (nf / 2) * ((wref / b["wf"]) if use_width else 1.0) * kf
    Lr = (nr / 2) * ((wref / b["wr"]) if use_width else 1.0) * kr
    muf, mur = mu_at(b["comp"], Lf), mu_at(b["comp"], Lr)
    if muf is None or mur is None: return None, None
    af, ar = muf * nf / mf, mur * nr / mr
    return (af, "front") if af <= ar else (ar, "rear")

def loo(fn):
    errs = []
    for b in builds:
        ks = [p["meas"] / v for p in builds if p is not b and p["comp"] == b["comp"]
              for v, _ in [fn(p)] if v]
        v, _ = fn(b)
        if ks and v: errs.append(abs(v * st.median(ks) - b["meas"]))
    return (st.mean(errs), len(errs)) if errs else (None, 0)

base = st.mean([abs(st.median([x["meas"] for x in builds if x is not b]) - b["meas"]) for b in builds])
print(f"{len(builds)} builds.  BASELINE (fleet median) mean |error| {base:.3f} g\n")
rows = [
    ("v1  lump, no width          ", lambda b: pred(b, 0, 0, 0)),
    ("    lump + width            ", lambda b: pred(b, 0, 1, 0)),
    ("v2  per-axle, no width      ", lambda b: pred(b, 1, 0, 0)),
    ("    per-axle + width        ", lambda b: pred(b, 1, 1, 0)),
    ("    per-axle + width + press", lambda b: pred(b, 1, 1, 1)),
]
for name, fn in rows:
    m, n = loo(fn)
    if m: print(f"  {name}  mean |error| {m:.3f} g   vs baseline {base:.3f}   ({m/base-1:+.0%})")

print("\n  W_ref sweep, per-axle + width:")
for w in (150, 225, 350, 500, 800, 1500):
    m, _ = loo(lambda b, w=w: pred(b, 1, 1, 0, wref=w))
    print(f"    W_ref={w:5d}  {m:.3f} g")

# THE BALANCE, scored on its own. Magnitude and balance are different claims: the model can be wrong about
# how much grip a build has and still be right about which end runs out first, and that second answer is
# the one a tuner acts on. Compared against which axle actually let go more often in the driven envelope.
print("\n  balance: does the model pick the axle that actually let go first?")
ok = tot = 0
for b in builds:
    _, axle = pred(b, 1, 1, 0)
    if b["obs_axle"] == "even" or axle is None:
        continue
    tot += 1
    ok += (axle == b["obs_axle"])
print(f"    {ok}/{tot} builds with a clear observed bias called correctly "
      f"({ok / tot:.0%}; a coin flip would be ~50%)")
