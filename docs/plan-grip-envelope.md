# Plan — the grip envelope: maximum cornering speed per radius, and which end goes first

*Drafted 2026-09-18, then revised after two adversarial audits (physics/statistics, codebase fit). Question it
answers: **for a corner of radius r, on this surface, in this car, how fast before the front or the rear lets
go?** Everything the audits changed is marked **[A1]**…**[A9]** so the reasoning stays visible.*

## 1. What already exists (do not rebuild it)

Schema 7 (2026-09-12) built a **per-class grip ceiling**: `a_max` = p90 of mid-phase peak `|lat_g|` per PI class,
bucketed into three apex-speed bands, n ≥ 20, computed in `build_web.py:286` and stamped on every course. The
dashboard shows "grip used" = best pass's g ÷ `a_max`, plus a speed headroom `√(a_max/g)` at a fixed line
(`panel.js:2294`, rendered at `panel.js:4341`).

**The gap.** It rates a corner you already drove; radius never enters, and front/rear are never separated.

**[A1] Which number is authoritative — decided now, not later.** Two g-numbers on one drill-down would be a
second source of truth, and the design language treats that block as one caption per concept. Therefore:

- **"grip used" (schema 7) stays the authority** for *how hard you drove this corner*. Unchanged.
- The envelope never uses the words "ceiling" or "grip limit" in the UI. Its vocabulary is **"radius envelope"**
  and **"envelope speed"** — a property of *corner shape + surface*, not a rating of your lap.
- Only if the envelope passes every gate below does a second decision get taken about merging them.

## 2. The physics, and the correction that makes it work

Steady-state: **v_max = √(a_lat · r)**, banking adding `g·sin θ`.

**`ref_route_turn.radius_m` is not the radius the car drives** — it is the road centre-line's fitted radius, and a
racing line straightens a corner. Across 7,527 mid-phase observations the implied `v²/r` misses recorded `lat_g`
by a median **0.39 g**, agreeing within 0.3 g only **26%** of the time (it reports 130 mph through a 62 m radius
= 5.5 g, not physical). Radius from the **driven path** drops the median error to **0.10 g**.

## 3. Data — all stored, no capture reprocess needed

`lap_point` (503,663 rows) carries `x`, `z`, `mph`, `lat_g` (389,958 rows), `grip`, and `thr`/`brk` **from
2026-09-11 only**; `ref_route_turn` carries radius, banking, `road_class`/`road_type`/`offroad`; `lap` carries
class, PI, `hw_hash`, `tune_hash`.

**[A2] Bins join through `ref_route_turn.turn_id` via the existing `corner_segment` rows — never `course_turn`.**
Verified: for route 5555, 104/104 `corner_segment` turn ids resolve in `ref_route_turn` and 1/104 in
`course_turn`. The two-namespace hard rule is satisfied by construction, and saying so makes it auditable.

**[A3] `docs/DATA-INVENTORY.md:123` says `lap_point` = 120,471 rows; the live store has 503,663.** The inventory
is stale by 4×. Not this plan's job to fix, but it must be corrected or dated before another agent trusts it.

## 4. Build

### Stage A — driven radius, computed in `import_corners.py`, **not persisted** [A4]

The first draft added `lap_point.r_m` as a schema-9 column. Dropped: `import_telemetry.py:270` does an
unconditional `DELETE FROM lap_point` and reinserts without that column, so `r_m` would be wiped by the next
telemetry import and only restored because `DOWNSTREAM["telemetry"]` re-runs `corners`. That is derived state
pretending to be durable, plus four schema touch-points (`schema.sql`, `V2_COLUMNS`, `SCHEMA_VERSION`, and the
`_lp_names` slice logic) for a value only one consumer reads.

`import_corners.py` already reads `x`/`z` for every sample. The radius is computed **in memory there** and fed
straight into the envelope aggregation. Zero schema migration for Stage A.

**[A5] Window by ARC DISTANCE, not point count.** The draft assumed a uniform 4 m grid. Measured: only **46.4%**
of consecutive gaps are exactly 4 m; ~43% are multiples (8/12/16/20/24/28/40 m) and **816 gaps exceed 100 m**
(one is 272 m). A ±3-point window would span 24 m to >800 m depending where it lands, and one straddling a
rewind/stitch boundary would fabricate a radius from two disconnected path segments. Therefore:

- window = **±12 m of `arc_m`**, not ±3 points;
- **void the window** if any consecutive gap inside it exceeds 8 m, or if it crosses a `lap_marker` (rewind /
  pause / gap / jump) boundary;
- radius = median of the triple-wise circumradii inside the surviving window; `NULL` above ~2,000 m (straight).

### Stage B — the envelope, built inside the `corners` stage [A6]

The draft described "Stage B" as its own build step with no entry in `rebuild.py`'s `STAGES` / `DOWNSTREAM` —
a direct breach of the project's most-repeated hard rule. **The envelope is computed inside `import_corners.py`**,
so it inherits the `corners` stage's existing DOWNSTREAM membership (`telemetry`, `routes`, `anchors`,
`course_match`, `consolidate` all already cascade into `corners`). No new stage, no graph edit, and a routine
session import can never leave a stale envelope. A new `grip_envelope` table is declared in `schema.sql` +
`V2_TABLES` with the version bump the project uses for new tables, and `check_invariants()` gains an I-series
freshness/row-count check so `rebuild.py --check` catches staleness like every other store.

One row per `(scope, scope_key, surface, radius_band)`:

- **Scope: `class` only at launch.** [A7] The draft offered per-`hw_hash` envelopes. Measured: 123 builds exist,
  only **4 have ≥27 laps**; split across 7 radius bands × 2 surfaces that never clears n ≥ 20, so the scope would
  be dead code. `hw_hash` ships only if the coverage gate (§6.7) passes. Classes **D (17 laps) and X (16)** are
  below the sample gate before any split and are **unpublishable**, not "thin".
- Radius bands 15–30, 30–50, 50–80, 80–120, 120–200, 200–400, 400+ m.
- **`bias_g` + `bias_note` per row** (DECIDED 2026-09-19, see `handoff-grip-envelope.md` §5). The estimator
  reads optimistically where the car carries body slip — +0.21 g at 50–80 m — and Jett's call is to publish
  the band with that stated. It is a COLUMN so the UI cannot drop it or invent it, and it is MEASURED from
  the row's own samples (median implied `v²/r` − median recorded `|lat_g|`), never a literal: the figure
  moves with the sample filter, so a frozen constant would go quietly wrong.
- **`a_p50` / `a_p90` taken over RAW per-sample `|lat_g|` in the bin** [A8] — not a percentile of per-phase peaks.
  A peak-then-percentile is a percentile-of-maxima: upward-biased, and inflating with sample density, so two bins
  with identical true grip would report different numbers purely from how many samples composed each phase.
- **Sample filter:** `grip != 4` (impact) always excluded — of rows at ≥2.9 g, **50% are `grip = 4`**, so without
  this the "envelope" is partly a record of hitting walls. `grip = 3` (all four, 97,200 rows) is kept but
  reported separately, since it mixes genuine four-wheel drift with wheelspin.
- **Saturation:** `lat_g` is censored at 3.00 g. A bin with >2% of samples ≥2.9 g publishes no p90.
- `v_envelope_mph` = `√(a_p90 · r_mid)`, banking included where known.
- `n_samples`, `n_laps`, `n_builds`.

### Stage C — surfaces, last

One line in the turn drill-down using the §1 vocabulary, and optional course-map shading of driven speed ÷
envelope speed. Ships only after every gate passes.

## 5. Front vs rear — the plan's novel part, and the most compromised [A9]

The draft defined onset as the p50 of `|lat_g|` at `grip` transitions 0→1 (front) / 0→2 (rear). Measured, that is
mostly **not** a cornering statistic: of 16,061 front onsets, **62% occur at throttle > 80** and 25% under
braking; of 2,495 rear onsets, **55% at heavy throttle**, 35% under braking. Those are corner-entry/exit load
transfer and power-oversteer, not the mid-corner lateral limit.

Revised definition:

- onset samples must be **`brk = 0` and `thr ≤ 50`** — the same friction-circle control the envelope uses, which
  the draft applied to the envelope but not to the onset;
- **entry-phase and mid-phase onsets are reported separately**, never pooled;
- pedal channels exist only from 2026-09-11, so onset is a **pedal-era statistic**; earlier laps cannot contribute;
- cross-check the result against `corner_segment.grip_hist`, the existing per-phase grip-state histogram, which
  answers "which end typically breaks" from an independent path.

Whole-store context (uncontrolled): understeer mean 1.75 g, oversteer 1.07 g — the rear breaks at lower lateral
load. The controlled numbers will differ, and that is the point.

## 6. Validation gates — the plan fails if these fail

1. **Radius estimator — REVISED 2026-09-18 after measuring it.** Bias: median |implied `v²/r` − recorded
   `lat_g`| ≤ 0.15 g. **The old ≥60%-within-0.3 g half is withdrawn, and not because it was inconvenient:**
   the two quantities are not the same measurement. Stored `lat_g` is the PEAK over the frames a checkpoint
   spans, `r_m` is the MEDIAN radius over those same frames, and `lat_g` is a filtered channel carrying banking
   and combined effects. Comparing them per sample has irreducible spread — raw 60 Hz telemetry, with no
   estimator at all (`a = v·ω` straight from the capture), reaches only **42%** within 0.3 g. A gate no data
   can pass is a broken gate, not a high standard. Replaced by:
   **(1a)** bias ≤ 0.15 g — *measured −0.095 g on the yaw-rate radius, PASS*; and
   **(1b) bin-level agreement**: within each published radius band, the median implied `a` must track the median
   recorded `a` to ≤ 0.2 g. That is the level the envelope actually reports at, so it is the level to gate.
2. **Monotonicity.** `v_envelope` rises with radius inside a scope+surface.
3. **Hold-out.** Fit on 80% of laps, predict apex speed on the other 20%: median error ≤ 5 mph.
4. **Surface separation, directional.** Tarmac must exceed dirt by more than the bins' own spread. A backwards
   difference fails — the draft's gate would have passed on any large difference, including a physically absurd one.
5. **Impact/saturation exclusion audit.** ≤2% of a published bin's samples at ≥2.9 g, and zero `grip = 4`.
6. **Independence.** `n_laps ≥ 8` distinct laps per published bin — 20 correlated samples from one steady-state
   lap are not 20 trials.
7. **Scope coverage.** `hw_hash` scope ships only if ≥3 builds reach n ≥ 20 in ≥1 bin. Otherwise class-only.
8. **Onset contamination.** ≥70% of a bin's onset samples must survive the `brk`/`thr` filter, or the bin
   publishes no onset.
9. **Don't contradict the game.** Spot-check `a_p90` against `ref_friction_curve` for the build's compound.
   **Prerequisite:** confirm the join `hw_hash → tune_part/ref_part → compound → ref_friction_curve` actually
   resolves. If it does not, this gate is dropped and the plan says so rather than promising an uncheckable test.

## 7. Risks that remain after the fixes

- **Sample bias is unresolvable from the data.** Nothing records driver intent or remaining margin, so the
  envelope is bounded by the hardest anyone drove. It is a **lower bound**, never "the car's maximum" — and that
  wording ships in the UI verbatim, not just in this doc.
- **Aero is absorbed, not separated.** Radius and speed correlate; highest-g samples average 110 mph vs 97 mph
  overall, consistent with downforce inflating exactly the bins used to fit the envelope. No claim is made about
  separating aero. A wide-band monotonicity check (does `a_p90` still rise at 200–400 m+?) is the partial diagnostic.
- **Resampling smooths curvature** — points are interpolated, so tight hairpins read slightly wider than driven.
- **Derived state.** `r_m` and `grip_envelope` live entirely inside the `telemetry → corners` cascade and are
  rebuilt by it. Never treat them as durable outside a full `rebuild.py` run.

## 8. Not in scope

Predicting an envelope for a car never driven (that is the `ref_friction_curve` modelling path — theory, not
measurement); replacing schema-7 `a_max`; anything that writes to the game.

## 8b. Status — 2026-09-18

**Stage A is BUILT but not yet populated.** Radius now comes from the telemetry itself (`r = v/ω`, yaw rate at
full capture rate) rather than from stored geometry, because `lap_point.x/z` were rounded to whole metres and at
4 m spacing that is a ~14° heading error per step — a +3.33 g median error, enough to fabricate tight corners.
Alongside it, the analyzer stopped rounding x/z (one decimal now), so the quantisation is gone for everything
downstream, not just this feature.

Shipped: `lap_point.r_m` (schema 9), carried from `analyze_session` through `lap_store`'s JSON points and the
importer's column gating. Verified end to end on one re-analysed capture: 5,104 points carry a radius, x/z are
sub-metre, and gate 1a passes at −0.095 g.

**QUEUED: the full reprocess.** Only re-analysed captures carry `r_m`; the rest are NULL until
`scripts/telemetry/backfill_laps.py` runs again (~90 min). Jett's call to defer it. Stage B waits on that —
an envelope fitted on one capture would be a fit to one afternoon's driving.

## 9. Order of work

1. **Batch 2 lands** → re-verify gate 1 against the new `peak_lat_g`. *Gate this on an `import_run` row, not on
   memory* — "Batch 2" currently exists only in conversation and is not machine-checkable.
2. Stage A (driven radius, in-memory, arc-distance window) → gates 1, 2. **Stop if they fail.**
3. Stage B (envelope inside `corners`) → gates 3–9.
4. Stage C (UI) last, with the §1 vocabulary and the lower-bound wording.
5. Measure and record the added rebuild cost (expected sub-second over 503k rows; state the real number).
