---
name: fh6-slider-value-reliability-hierarchy
description: "HARD RULE (Jett, 2026-09-03, final) — the exact, enforced trust order for every mechanism that turns a save's raw slider byte into a real-world number; never let a weaker source stand over a stronger one, and never add a new source without placing it in this order"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T18:56:36.298Z
---

Jett's demand, verbatim, after the THIRD slider-value bug surfaced in one session (weight_reduction
naming, a downforce unit-conversion bug, and a spring-rate reading that looked wrong but turned out
correct): **"if you understand what we have solved, then there should be no reason to ever see it
again."** This is not a request to re-explain the mechanisms next time — it is a demand that the
correctness be ENFORCED IN CODE, not held as understanding in one conversation. This memory exists so
the reliability order is looked up, not re-derived, and so the code changes it describes are treated
as a standing invariant, not a one-off patch.

**Jett also rejected "single source of truth" as unrealistic**, given how many different approaches
this project has taken over the past year. The fix is NOT collapsing every mechanism into one code
path. It is an explicit, RANKED hierarchy across the mechanisms that already exist, consistently
enforced wherever they compete for the same field.

## The five tiers, most to least trustworthy

For any FH6 per-car slider field (`front_spring`, `rear_spring`, `front_ride_height`,
`rear_ride_height`, `front_downforce`, `rear_downforce`, `final_drive` — `PER_CAR_FIELDS` in
`fh6_tune_decode.py`):

1. **Database, `tune_slider`** (`data/fh6.db`, populated by `scripts/db/import_containers.py` from
   `ref_part_slider` — the game's OWN physics table, resolved by the EXACT part fitted in that exact
   container). Ground truth. Verified 2026-09-03: correctly resolves a different min/max band per
   installed `springs_dampers` tier, correctly interpolates, and reproduced the live game's downforce
   reading (184 kgf -> 405.7 lb) exactly. Surfaced to the dashboard only via `fillFromDb()`
   (`dashboard/v2/live.js:888`), which refuses to borrow another save's row (`dbTuneFor()`,
   `live.js:881` — matches on `CUR.disk.ts` exactly, no fallback to "the last tune held"; that
   fallback was itself a bug, fixed earlier the same day, see `docs/v1-lessons-audit.md` item 3).
2. **2-point back-solved per-car range** (`data/car-tune-ranges.json`'s `ranges`, from two
   independently captured readings at different slider positions that cross-check each other).
   Strong, but still keyed by car ORDINAL only, not by build/parts-fingerprint — the same scoping gap
   as tier 4 below, just with one internal consistency check tier 4 lacks.
3. **Global band** (`data/global-slider-ranges.json`'s `ranges`), but ONLY for fields independently
   PROVEN game-fixed and identical across every car — currently just `final_drive`/`gear`, verified
   2026-09-01 to reproduce the game's own GEARING tab to 0.01 without driving (see
   [[fh6-gear-ratios-never-need-driving]]). For any field where the physics genuinely is shared, this
   tier is AS GOOD AS ground truth. It would NOT be safe to reuse this tier for a field that varies
   per car (do not add new entries to this file casually).
4. **Mass-derived physics formula** (`spring_rate_from_mass()`, springs only: `k = freq^2 * axle_lb /
   19.56`). A COMPUTED MODEL, not a measurement — it compounds an assumed frequency band with a
   captured car mass (`data/car-mass.json`), and that mass is keyed by ordinal only, sourced from ONE
   historical screenshot of ONE specific build. Confirmed 2026-09-03: ordinal 2866's captured mass
   (1498 lb) was screenshotted from an "S1 800 AWD build" and silently reused for an unrelated "A 700"
   build of the same car — this is the WEAKEST-feeling case because the output number (615.58 lb/in)
   reads as precisely as a real measurement while resting on two stacked assumptions.
5. **Single-point anchor** (`data/car-tune-ranges.json`'s `points`, one hand-typed in-game reading at
   one slider position). Weakest real evidence — one point, nothing to cross-check it against, same
   ordinal-only scoping as tier 4. Confirmed 2026-09-03: `front_downforce`'s anchor (190.0, captured
   without unit conversion) stood uncorrected over the database's correct value (184 kgf = 405.7 lb)
   because it was never marked as needing DB corroboration — see "the actual bug" below.
6. **Position-only abstention** (`value: None`, reports the raw 0..1 slider position as a percentage).
   The HONEST floor when nothing above applies. Ranks above a confident wrong number from tiers 2-5,
   never below it.

## The actual bug, and the fix

Tiers 2-5 are all computed in `fh6_tune_decode.py`'s `parse_tune()` (~line 358-390) and are ALL
weaker than tier 1. The mechanism to let tier 1 override any of them already existed and was already
correct: `fillFromDb()` in `dashboard/v2/live.js` (~line 888) replaces a row's value with the
database's whenever `row.derived` is true. But three of the four Python branches set
`entry["derived"] = True` and one — the 2-point back-solve (tier 2, `if per_car and rng:`) — did not,
so it silently stood over the database whenever both existed for the same field. The single-point
anchor branch (tier 5) ALSO didn't set it until fixed 2026-09-03, which is what let the downforce bug
through. **Both are fixed now: every non-database branch in `parse_tune()` sets `derived = True`.**
The database is unconditionally preferred whenever it has a row for that container + field; a
Python-computed value is only ever the final answer when the database has nothing for that field.

## How to apply

- If a NEW per-car value source is ever added to `parse_tune()`, it must set `entry["derived"] =
  True` unless it is provably as strong as the database (in practice: never — nothing in this
  pipeline is). Do not add a fifth "except this one doesn't need it" case; that is exactly how the
  downforce bug happened.
- If a slider value looks wrong, check `entry.get("derived")` and whether `fillFromDb()` actually had
  a database row to correct it with (`tune_slider` for that exact `container`) BEFORE assuming the
  underlying mechanism is broken — the mass-derived spring "bug" investigated 2026-09-03 initially
  looked like a build-mismatch problem and the database DID have the right answer waiting; the real
  question was only ever whether the override fired, not whether the database was right.
- Comparing two different containers' raw slider values against each other for "does this look
  monotonic" is NOT a valid sanity check — different containers can have genuinely different parts
  fitted (confirmed: two Exocet saves had different `springs_dampers` tiers, each with a correct but
  different min/max band). Only compare values within the SAME container, or against the live game
  screen for THAT exact save.
- The deeper, not-yet-fixed structural gap: tiers 2, 4 and 5 are all keyed by car ORDINAL only, with
  no parts-fingerprint check, so a captured point/mass from one build can silently apply to an
  unrelated build of the same car. Deferring to the database (this fix) makes that gap harmless
  wherever the database covers the field — it does NOT fix the gap itself. If a field is ever found
  where the database has no row and tiers 2/4/5 disagree with the live game, THAT is the real
  remaining work: add a parts-fingerprint to `car-tune-ranges.json`'s points and `car-mass.json`'s
  masses, and refuse to apply either across a build mismatch.
