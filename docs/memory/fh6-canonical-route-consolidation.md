---
name: fh6-canonical-route-consolidation
description: Duplicate-road courses are collapsed by a DB consolidation stage; the two matchers still disagree at source by design
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-11T01:08:18.145Z
---

The game catalogues some physical roads twice (a base id + a parallel `30xxx` id whose
centre-lines are the same road to within a metre). Our two identity paths disagree on which id
to use — `analyze_session._catalogue_key` sets `route_key`, `import_course_match` sets
`course_route.route_id` — so one road appeared as several courses under several ids, sometimes
with the wrong catalogued name.

Fixed 2026-09-10 (commit e1b7c45) with a **consolidation layer**, NOT by unifying the two
matchers (that's the deferred Phase 3):
- `scripts/db/canon_routes.py` — `canonical_map(cx)` clusters `ref_route` by mutual geometry
  overlap (`fh6_owt.compare` both directions ≥ 0.90) → one canonical id per road. Canonical id
  is the **game catalogue's own authority** (Rivals binding > `is_race`/anchor > `game:trackinfo`
  name > non-30xxx > lowest id), never base-vs-30xxx numeric guessing. Reads only ref_route +
  catalogue, never our laps.
- `scripts/db/import_consolidate.py` — a rebuild stage AFTER `course_match`, BEFORE `route_names`.
  Canonicalises every `course_route.route_id` (partials too, so they get the right name), and
  MERGES only verified/probable whole-course drives into one survivor key `route:<canonical>`.
  Also does two hygiene steps (2026-09-10): **prunes empty artifacts** (0 laps AND no geometry
  path — a start detected but nothing driven) and **reattaches orphan fragments** (a course with
  laps but no centre-line — a grid-cell key the catalogue only partially matched, whose laps
  scattered so the model never aggregated a path). Reattach builds a trace from the orphan's
  longest lap's `lap_point` samples, matches it to the route centre-lines, and when it sits ON one
  road (mean ≤ 8 m, cov ≥ 0.60) whose `route:<id>` course exists, re-points the laps there via the
  same dedup machinery. Coverage gate leaves thin fragments alone. E.g. -4750_-1550 (12 Bandai
  Azuma laps, no geometry) → route:5191 (→31 laps).

**Why:** the twins double-recorded the same physical lap under both keys, inflating lap stats
(Edamame showed 371 laps for 239 real ones). Consolidate dedups on the same tuple the `lap`
UNIQUE uses (session_id/cid/t0 all present & equal) and drops the copy.

**How to apply:**
- HARD: never pool a `partial` course into the canonical course — part-laps + whole-laps corrupts
  lap times. Partials keep their own key, only their identity/name is canonicalised.
- The stage is idempotent and self-heals: telemetry may re-create a twin from a new capture, but
  every rebuild re-derives the map and re-merges. So do NOT be alarmed that the two matchers still
  disagree — consolidate is the intended collapse point. Don't "fix" the disagreement at source
  without accounting for this stage.
- `route_id` is stored as TEXT everywhere — compare as strings, never Python ints.
- `fh6_owt.verdict` has an ADDITIVE p95 branch (2026-09-10): a drive dead on one route but with a
  couple of off-route vertices (kerb clip / rewind / NaN) reads 9999 m on those points and the MEAN
  blows past the ≤8 gate while p95 stays tight — so identify by p95 when covered + length + clear.
  HARD LESSON: do NOT cap/clip the per-point distance to tame the outlier — the 9999 penalty is
  load-bearing (it rejects a candidate whose road genuinely DIVERGES); capping flipped Hakone onto
  an unnamed parallel route. p95 is robust to a lone blip but still catches real divergence.
- Deferred: Phase 3 (unify the matchers into one shared canonicalised compare) and any source-side
  `_catalogue_key` change. Not needed while consolidate runs in the cascade.

See [[fh6-course-keying-catalogue]], [[fh6-course-identity-stability-2026-09-07]],
[[fh6-course-identity-workflow]], [[fh6-turn-source-ref-route-turn]], [[fh6-rebuild-cascade]].
