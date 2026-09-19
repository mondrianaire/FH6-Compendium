# Consistent turn identity from route geometry

## Telos check
One turn list per route, derived purely from the `.owt` route geometry, **byte-for-byte identical on
every pass** — the stable turn identity, retiring the per-lap telemetry-detected set (`course_turn`) as
the identity.

## Scope
Researched, primary-source (our code + the 169 real `.owt` files + `data/fh6.db`), four facets:
(A) determinism of the geometry derivation, (B) turn-id stability across re-derivation/param changes,
(C) robustness of the geo7 detector to its own parameters, (D) how to validate the result with no
ground-truth turn table. **Out of scope:** telemetry-based turn *existence* (already settled),
the live course matcher, PI/tuning, per-turn behavioural stats.

## Findings

### 1 — The derivation is ALREADY byte-for-byte pass-invariant. Nothing to build here.
- **✅ Verified.** `fh6_turns.py --all --json` run three times (twice plain, once `PYTHONHASHSEED=12345`)
  against the real install → identical md5 `a1e2bc33…`, 169 routes / 3810 turns each. Source audit: no
  `set()`/`random`/`time`/`os.environ`/threads; route order fixed by `sorted(glob.glob)`; the lone sort is
  a *stable* sort on `apex_arc_m`. `import_routes.py`'s DELETE+reinsert of `ref_route_turn` reruns
  byte-identical (3810 rows), and the table is `WITHOUT ROWID PRIMARY KEY (route_id, turn_id)` — storage
  order is PK-clustered regardless of insert order.
- **So what:** the determinism half of the telos is *already met*. Nothing blocks retiring `course_turn`
  as the identity on determinism grounds. Only optional add: a CI tripwire (`--all` twice, diff).

### 2 — The real churn is the NUMBERING scheme: positional rank cascades on any add/remove.
- **✅ Verified.** `turn_id = "T%d" % rank` by apex-arc order (`fh6_turns.py:190-193`), recomputed every
  run. A *bare* re-derive is stable — but a param change that adds/removes one turn **renumbers everything
  downstream**: reproduced on Route281, `MIN_DEG 11→10` added 3 turns and relabeled **10 of 17 unmoved
  corners** (T8..T17 → T10..T20). `course_turn` (telemetry, `analyze_session.py`) uses the same rank
  renumber and fires it on *every* capture session — worse, and currently live/uncommitted.
- **So what:** this is the actual instability the user feels. Fix is a one-formula change, not a rewrite.

### 3 — Fix: arc-anchored ids. Tested, zero collisions across the whole catalogue.
- **✅ Verified.** `turn_id = "T" + round(apex_arc_m)` (dir-letter suffix only on a same-metre collision).
  Re-running the Route281 `MIN_DEG` change relabeled **0 of 17** surviving corners (vs 10/17 today); only
  the 3 new turns got new ids. Collision scan across all 169 routes / 3810 turns: **0 collisions** — the
  suffix is never even needed today. Surgical: `fh6_turns.py:190-193`, `analyze_session.py:~3191`, the
  `import_telemetry.py:112` fallback; no schema migration (tables self-heal on next import).
- **So what:** this single change delivers the telos's "stable across passes" for the id layer.
  🟡 Residual: a `.owt` origin move would shift all ids uniformly (order-preserving, still better than
  today) — but `.owt` files are read-only game assets, origin never moves.

### 4 — The method is robust EXCEPT K_MIN, which must be pinned as a hard constant.
- **✅ Verified.** Params `K_MIN=1/260, MIN_DEG=11°, GAP_M=18m`. Sensitivity (±50% sweep): **K_MIN swings
  Route132's count 40→11 (3.6×)**; MIN_DEG ~half that; GAP_M safe (<20%). The swing concentrates in
  highway-style routes with many bends near the 260 m floor (Route132 0.53/km, Route281 2.4/km); tight
  technical loops (Route1211, Route30003 = 11 turns each) and the corner-dense Route5555 (303) are flat.
- **So what:** for a stable identity, **K_MIN can never be tuned or dynamically derived** (e.g. per
  road-class) without silently rewriting highway turn tables. Pin all three as documented constants;
  changing one is a deliberate, catalogue-wide re-version, not a tweak.

### 5 — The prior report's Priority 1 (score against `ref_route_turn`) is CIRCULAR — do not build it.
- **✅ Verified.** `ref_route_turn` *is* `fh6_turns.turns_for()`'s own output, upserted unfiltered
  (`import_routes.py:54,84`). Scoring the detector against it proves nothing. Also: `turn_lab.py`'s only
  current metric is cross-*lap* telemetry agreement (needs ≥3 laps, covers 30/105 courses) and **never
  runs `fh6_turns.py`** — it can't validate what we ship.
- **So what:** the earlier headline recommendation is dead. Replace it (Finding 6).

### 6 — Validate by parameter-perturbation self-consistency (ground-truth-free, discriminative).
- **✅ Verified.** Jitter `STEP_M`/`HEAD_WIN_M`/`SMOOTH_M`, re-derive from the *same* geometry, measure
  apex agreement: saturates ~100% on robust routes, drops to **73%** on borderline ones — it isolates
  threshold-artifact turns from real road features (the exact epistemic risk of a no-ground-truth
  detector). Secondary: forward-vs-reverse symmetry (~99%, catches code bugs — 5/42 loops <100%);
  triage: turns/km (mean 3.83, sd 1.55) flags 11 outliers incl. 3 zero-turn routes.
- **So what:** this is what belongs in `turn_lab.py` — a QA gate that runs on geometry alone, no laps.

## Recommendations

| Path | What | Effort | Serves telos | Risk |
|---|---|---|---|---|
| **A — Stable ids + pin params** | arc-anchored `turn_id` in the 3 sites; pin K_MIN/MIN_DEG/GAP_M as documented constants; make `ref_route_turn` (geometry) the identity, demote `course_turn` to measure-only | ~2–4 h | **directly** — this is the consistency fix | low (surgical, 0 collisions, self-healing tables) |
| **B — Self-consistency QA in `turn_lab.py`** | perturbation-agreement metric (primary) + fwd/rev symmetry + density triage, run over all 169 routes on geometry alone | ~2–3 h | guards A (catches artifacts/bugs) | low |
| **C — Vertical curvature (crest/dip)** | reuse `curvature()` on y(arc) for crests/dips; per-turn radius profile | ~3–4 h | no (adds turn *kinds*, not consistency) | med (new turn types churn ids again — do AFTER A) |

**Author's pick:** **A now, then B.** Determinism is already done, so the telos reduces almost entirely to
Path A's arc-anchored ids + pinned params — a small, tested, low-risk change that makes the turn identity
survive re-derivation and detector tweaks. B follows immediately to guard it (and to replace the circular
validation). C is a separate feature; sequence it last precisely because adding crest/dip turns would
re-churn ids unless A's arc-anchoring is already in place.

## Unknowns + stopping criteria
- **Not tested live:** a `.owt` origin-point move (no editable route file exists; reasoned from code — it's
  a uniform, order-preserving shift, strictly better than today's local cascade).
- **By design different domains:** a `T1452` in `ref_route_turn` (game-route arc) is not the same physical
  point as `T1452` in `course_turn` (learned-course arc) — arc-anchoring stabilises *within* each domain,
  not across; cross-domain matching stays geometric, as today.
- **Stopped because:** all four facets verified by experiment (not just reading), the telos reduces to a
  concrete, low-risk Path A, and the one prior lead (Priority 1) was disproven — 3-source/telos tests met.
