# Handoff to main — 2026-09-18: A/B groundwork, a confidence gate, and the deterministic detectors

Session worktree `gracious-dubinsky-2fd92e`, branch `claude/ab-testing-infrastructure-da06d8`,
pushed to `origin/claude/ab-testing-infrastructure-da06d8`. Six commits of my own plus a merge of
the lab branch. Suite is **129 tests, 0 failures** — green for the first time in this line of work.

| commit | what |
| --- | --- |
| `f3520f7` | repair `db/schema.sql` (the schema-9 `r_m` paste) — **duplicate, see below** |
| `0427312` | `confidence.py`, `findings.py`, `slider_sweep.py` + the sweep plan and checklist |
| `a601d50` | `deterministic.py`, the `deterministic` rebuild stage, `v_diag_by_course`, course-mode gearing card |
| `f67768a` | the scan's rebuild-in-flight guard, and stopping it blocking itself |
| `05cce70` | no denominator, no rate |
| `4cc29a6` | the sidecar corpus: 163 sessions, 17,753 findings |
| `b1982b1` | merge of `claude/forza-eliminator-tips-db-c512c3` |

The goal this serves is the A/B testing infrastructure. Before we can A/B a tuning change we have to
be able to say, honestly, that a driving behaviour got worse — and today the lab cannot, for two
separate reasons. This branch fixes both.

## The finding that shapes everything: the corpus cannot attribute a slider

Measured over 1,546 laps: **exactly one** cell of (route × car × `hw_hash` × `tune_hash`) holds two
tunes on identical hardware — route:6001, the Exocet at 700 PI — and those two tunes differ in
**seven sliders at once** (final drive, front downforce, both ride heights, front spring, front toe,
rear ARB). Every other repeat changes the build too: 31 route × car cells vary `hw_hash`.

So every apparent slider/behaviour correlation in the archive is confounded, and **no amount of
further free driving fixes it**, because normal play never holds 35 sliders still while moving one.
A transfer function has to be driven into existence deliberately.

`scripts/telemetry/slider_sweep.py` plans that drive: one car, one build pinned by `hw_hash`, one
course, one slider moved at a time. Current plan (`data/sweep-plan.json`,
`docs/slider-sweep-checklist.md`): **27 sliders, 64 cells, 174 laps**, Exocet on Edamame.

Three things about it that are not obvious:

- **The baseline is new, not an existing tune.** The "go kart" tune is at MAX on nine sliders
  (front ARB, both springs, both rebounds, both downforce, both ride heights), so sweeping "up" from
  it produces a level identical to the baseline. Cell 0 builds a fresh mid-range tune.
- **It reads the BUILT drivetrain, not `ref_car`.** `ref_car` says the Exocet is RWD; the pinned
  build carries `drivetrain_id 2102`, an AWD swap set, with a 10-speed box against the stock 6.
  Reading the stock field silently dropped three differential sliders the build actually has. This
  was a bug I shipped and then caught against the data — worth remembering for anything else that
  reaches for `ref_car.drivetype`.
- **Nothing is labelled by the driver.** Each level is saved as a tune and recovered from the
  decoded slider VALUES via `lap.tune_hash`. `status` refuses any lap whose `hw_hash` is not the
  pinned one.

**Not started: no sweep laps have been driven.** The plan and the tracking exist; the corpus does not.

## The confidence gate — `scripts/telemetry/confidence.py`

The second reason the lab cannot honestly call a behaviour bad: the typical fault is *intermittent*,
and everything is presented as though it were certain. Of the 45 (symptom, turn) pairs that fire on
the densest cell we own (Edamame, the Exocet, 61 clean laps on one build and one tune), **19 fire on
a tenth of laps or fewer and only one exceeds 70%**. They all render identically today.

Three laps of a turn that pushes a third of the time return 0/1/2/3 hits with probabilities
30/44/22/4 — every outcome ordinary, so no reading of three laps carries information.

Four verdicts, and only one of them is advice:

| verdict | meaning |
| --- | --- |
| `report` | cleared every gate; stated with the interval it was earned on |
| `watching` | shown as an observation, **never** as a recommendation |
| `insufficient` | we do not know yet; carries how many more laps would decide it |
| `not_recurrent` | we DO know: enough passes, too rare to be a tuning target |

The last two are the distinction the module exists to keep. "Twice in 61 passes" and "twice in 4
passes" are both below the floor and mean opposite things — the first is a settled negative that no
further driving will change, the second is ignorance. Collapsing them is over-claiming pointed the
other way: it hides a finished answer and sends the driver out for data that cannot change it.

Design points worth arguing with (all thresholds are declared at the top of the module):

- The claim is always the **Wilson lower bound**, never the point estimate. Not "T102 pushes 70% of
  the time" but "on at least 58% of passes, 95% confident".
- **The trial is a pass of a turn, not a lap.** Edamame has 11 turns, so three laps is three trials
  per turn, not thirty-three. Every "needs N more" is converted back into laps, because laps are
  what the driver actually does.
- **Two evidence classes.** Deterministic detectors read a physical state, so one occurrence is the
  occurrence and they report at n=1 — this is the standing directive that bottoming raises the flag
  immediately, and it holds up because the detector is not estimating a rate. Statistical faults
  (understeer, oversteer, instability) are gated. A test enforces that the *class* is what earns the
  n=1 flag, so counts alone can never buy it.
- **The driver confound.** A fault whose passes carry systematically higher entry speed is a driving
  mistake, not a tune fault; recommending a spring change for it makes the car worse. Tagged
  `driver_linked` and demoted. On real data this fired on T102 understeer-on-entry at 0.94 SD.

`findings.py` applies the gate per cell, never pooling two tunes to reach a sample size. On the
densest cell: **45 pairs fired → 15 report, 7 watching, 6 need more laps, 17 ruled out.** Two thirds
of what the current diagnosis surfaces cannot be stated as advice.

It refuses outright to read a rebuild in flight, after a mid-rebuild read returned 8,126
`diag_event` rows against the 38,474 that run went on to write and reported zero fired pairs.

## The deterministic detectors — `scripts/telemetry/deterministic.py`

Gearing, brake lock, bottoming. They read the **raw captures**, not `lap_point`, which carries none
of gear, rpm or wheel speed and only got pedals at schema 6 with no backfill. The captures have
carried all 99 columns since 2026-08-28, so these run over the whole history. Lap boundaries come
from `lap.t0`/`lap_s`, so lap identity stays canon.

### Two game fields that cannot be trusted

**`EngineMaxRpm` is not the redline.** It reads 7999.995 on the first on-row and 9999.995 elsewhere
in the same session — it moves because a session holds several cars — while actual WOT rpm reaches
9285. Gating "percent of redline" on it compares one car against another's ceiling. The redline is
**observed per car** from WOT rpm in the LOW gears; a tall gear on a short course never reaches the
limiter, and including it would drag the ceiling down and then flag that same gear as under-revved.

**`SlipRatio` is not a slip ratio.** Under full brake its per-wheel minimum reaches −14.4 and its
median sits at −0.86, close enough to "locked" that a naive gate calls almost every braking sample a
lock. Lock is measured from **wheel speed against road speed**, with the radius self-calibrated per
car from that car's own coasting samples (FL 0.2570 m, RR 0.2539 m, IQR under 6 mm). The build's
wheels are not the car table's wheels.

### The lock gate is graded, not binary

Over 201 excursions the largest single group (67, a third) is 3–5 samples at 0.70–0.85 — a tyre
working near peak slip under hard braking, costing nothing. The distribution is a **continuum, not
two clusters**, so the line is drawn on what a lock costs: past 30% slip, or shallower but held
0.25 s. That took front lock from 49/53 laps to 26/53. Excluded excursions are counted and reported,
never hidden.

### Cross-validation

Two independent sessions, different days and different tunes: redline 9164 vs 9160 rpm, top-gear
peak **79% of redline in both**.

### Bottoming is deliberately not imported twice

It already reaches `diag_event` through the analyzer's path on the same 0.98 gate; a second import
would double every bottoming count in the rollups. The sidecar still carries it as a cross-check, and
a test asserts the gate agrees across all three modules that restate it.

## Wiring

`deterministic.py --scan` writes a `.det.json` sidecar per session beside the analyzer's own,
incrementally. `scripts/db/import_deterministic.py` is a stage wrapper so `rebuild` can call it, and
it runs **before** `diagnosis`, which reads the sidecars rather than 25 GB of CSV — a full rescan on
every session close would turn a seconds-long cascade into a half-hour one.

```
telemetry → course_match → consolidate → route_names → corners → deterministic → diagnosis
```

Six new `ref_symptom` rows. Braking faults get a wider placement window because braking happens
*before* the apex: of 66 lock incidents 36 fell outside the apex window, but their median distance to
the nearest apex was 22 m against windows of 18–27 m — they were the braking zones of the turns they
belong to. Doubled, capped at half the distance to the second-nearest apex so it can never reach into
the next turn. Placement went 29/62 → 56/62.

**Course mode.** `v_diag_by_turn` filters `turn_id IS NOT NULL`, so a whole-lap fault such as gearing
could never reach the dashboard. `v_diag_by_course` carries them — registered in `fh6db.V2_VIEWS` as
well as `schema.sql`, because `ensure_schema` only runs on a database with no `schema_meta`; a view
added to `schema.sql` alone would exist on fresh databases and silently not on the live one. **Schema
version is now 10.**

The verdict is computed in `build_web` and shipped with the row. A second implementation of the gate
in JS would drift, and the failure mode is the dashboard recommending a change the analysis already
refused. `courseGearingHTML()` renders the fix and the lower bound only for a cleared verdict.

## The scan corpus

**163 sessions, 1,294 laps, 17,753 findings**, all from one snapshot taken while no import was in
flight. 32 sessions have laps but no capture left on disk — absent, not errors. 151 cars calibrated.

| fault | findings |
| --- | ---: |
| bottoming | 8,200 |
| brake-lock-all-four | 6,166 |
| brake-lock-front | 2,019 |
| gear-never-reached | 563 |
| brake-lock-rear | 429 |
| gear-under-revved | 267 |
| gear-limiter-bound | 109 |

9,553 become `diag_event` rows across **102 routes**. Course-level rows: 1,975 → 473 report, 444
watching, 1,017 insufficient, 41 ruled out.

Gearing recommendations that clear the gate span seven courses, not just Edamame — Irokawa,
Shimanoyama, Highway, Daikoku, Hakone Nanamagari. Edamame shows *both* "too tall" and "too short" for
different builds, correctly separated by container rather than pooled.

## Two bugs I introduced and caught, worth reading

**The guard that blocked itself.** `import_deterministic` opens an `import_run` row before calling
the scanner, so the scanner's new "refuse if a rebuild is in flight" check saw its own run and
stopped — 195 sessions, nothing scanned, reported as "scanned 0 session(s)" with exit 0. Worse, the
refusal was a `sys.exit`, and `SystemExit` is not an `Exception`, so `run_end` never fired and the
run stayed open forever — one aborted scan would have blocked every later one permanently. It was
nearly missed entirely because the command was piped through `tail`, so the shell reported the
*pipe's* exit status. A refusal path needs the same testing as the success path.

**False certainty from a missing denominator.** Of 1,975 course rows, 356 resolve no lap count (320
carry a NULL container — laps that named no tune), and my fallback set `n = laps_affected`. That
makes k == n by construction, so all 356 emitted *"100% of laps, at least 89% confident"* —
manufactured out of a missing denominator, by the very layer built to prevent that. They now report
occurrences and explicitly decline the rate. I checked the other 1,173 k == n rows: those are
genuine, because a ladder too tall for a course is too tall on every lap of it.

## The merge, and a duplicated repair

`b1982b1` merges `claude/forza-eliminator-tips-db-c512c3`. One conflict, in
`tests/test_rebuild_cascade.py`: both branches had corrected the same stale assertion, the lab adding
`consolidate` and this branch adding `consolidate` AND `deterministic`. Resolved to this branch's
version (a strict superset), verified against the merged `rebuild.py` rather than assumed.

**`db/schema.sql` was repaired twice, independently and byte-identically** — `70c008a` on the lab
branch and `f3520f7` here. Two sessions reconstructed the same fix from the same pre-break commits
because neither checked whether the other was already on it. It auto-merged with no conflict and
nothing needs undoing, but only one of those commits was needed. If parallel sessions are going to be
run against one repo, whoever spawns them should say who owns a shared-file fix.

## Open / not done

- **No sweep laps driven.** The 174-lap protocol exists on paper only. Until it is driven there is
  still no slider→behaviour transfer function, and A/B proper cannot start.
- **`diag_event.container` is mis-attributed.** It comes from the analyzer's `ctx()`, which files
  every event under the FIRST lap's container for that car in the session, so a container can be
  credited with laps it never drove. 25 rows produce k > n outright; `confidence.wilson` is now total
  by construction and rows carry `denom_suspect`, but **the cause is unfixed** and it affects
  `v_diag_by_setup` too.
- **The deterministic sidecars live in this worktree only** until this branch merges. A rebuild in
  the lab worktree will find no sidecars and produce no deterministic events there.
- **Turn placement is absent on unmapped routes.** Globally only ~45% of lock incidents land on a
  turn, against 90% on Edamame, because `ref_route_turn` only exists for matched routes.
- **The statistical symptoms are not yet gated in the UI.** `by_setup` and `by_turn` still ship
  ungated and `panel.js` still uses the old crude `need = 5 / 20` lap threshold. Only `by_course`
  carries verdicts today.
- **Thresholds are judgements, not measurements.** `P_FLOOR` 0.20, `N_MIN_STATISTICAL` 8,
  `WIDTH_MAX` 0.40, `SMD_DRIVER` 0.80, `SEVERE` 0.85. They are declared at the top of
  `confidence.py` with reasoning; they have not been validated against outcomes.

## Files

New: `scripts/telemetry/confidence.py`, `scripts/telemetry/findings.py`,
`scripts/telemetry/deterministic.py`, `scripts/telemetry/slider_sweep.py`,
`scripts/db/import_deterministic.py`, `tests/test_confidence.py`, `tests/test_deterministic.py`,
`data/sweep-plan.json`, `docs/slider-sweep-checklist.md`, 163 × `data/sessions/*.det.json`.

Changed: `db/schema.sql`, `scripts/db/fh6db.py` (schema 10, `V2_VIEWS`),
`scripts/db/import_diagnosis.py`, `scripts/db/rebuild.py`, `scripts/db/build_web.py`,
`dashboard/v2/panel.js`, `tests/test_rebuild_cascade.py`.

Commands:

```bash
python scripts/telemetry/slider_sweep.py status
python scripts/telemetry/findings.py --route route:6001
python scripts/telemetry/deterministic.py --session <sid> --route <route_key>
python scripts/db/import_deterministic.py -v
```
