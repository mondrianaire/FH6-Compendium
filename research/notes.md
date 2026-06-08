# Research notes — FH6 tuning v1 (captured 2026-06-07)

## Telos
Build a local, expandable database of FH6 tuning variables + meta cars, and a
dashboard that turns it into **car & mod purchase decisions**. First project =
tuning. First scope = current top-meta cars (user-confirmed).

## Confidence policy
- ✅ **verified** — stated consistently by ≥2 independent guides.
- 🟡 **probable** — single early source or fast-moving community consensus.
- Game is 3 weeks old → most car rankings are 🟡 and WILL move with patches.

## Key findings
- **Release:** 2026-05-19 (Premium early access 05-15), Japan/Tokyo setting. ✅
- **Tuning variable set** matches prior Forza titles: tires, gearing, alignment
  (camber/toe/caster), ARBs, springs, ride height, damping (bump/rebound), aero,
  brakes, differential (accel/decel/center). ✅
- **Tune order:** tires → springs → ride height → alignment → ARBs → damping →
  brakes → diff → aero → gearing (gearing last, road-tuned). ✅
- **Upgrade philosophy:** grip/brakes/weight first, power LAST. Front tire WIDTH
  is a newly-valuable cheap grip fix. Weight reduction "rarely wasted PI." ✅
- **Drivetrain meta:** AWD dominates off-road; optional on road but safer online.
  Early consensus power split **30/70 F/R**. ✅/🟡
- **AWD circuit baseline:** ~28 psi F / ~27.5 psi R, diff 55% accel / 15% decel,
  center 70–80% rear. 🟡 (single guide; starting point only.)
- **Meta cars** (see meta-cars.json): GT-R NISMO (S1, 270k, free via Collection
  Journal), Gemera + AMG One (S2), GR Supra (A), WRX STI '04 (A dirt, 30k — best
  value), 22B / Evo / Focus RS (dirt), Viper FE + Can-Am + F-450 (cross country),
  GT-R Black Ed FE (drag, share codes running low-6s 1/4 mile).

## Data gaps to close on next pass
- Confirmed credit prices for most cars (only GT-R NISMO 270k, WRX 30k, BRZ FE
  450k verified). Many `price_credits: null`.
- Per-car exact tune sliders (current baselines are generic AWD-circuit, not
  car-specific). Pull from forzatune / community share databases once stable.
- B/C/D-class road meta and X-class. Drift discipline only partially covered.
- Verify TikTok share codes in-game (lowest-confidence source).

## Sources
See `data/sources.json`. Tier mix is mostly expert-guide + early community; no
source is authoritative on a settled meta yet.
