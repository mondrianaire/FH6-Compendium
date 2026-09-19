# Turn Recognition — Deep Dive

## Telos
Accurate, map-authoritative turn recognition feeding the dashboard's Turn-analysis view.

---

## 1. Current implementation — end to end

**Pipeline:** `detect_turns()` (session geometry) → `course_turn` / `ref_route_turn` (two independent data models) → live corner matching (render-time, geometric) → dashboard render (panel.js/app.js) → `audit_models.py` (read-only invariant checker).

### 1.1 The detector — `scripts/telemetry/analyze_session.py`

`curvature()` (531‑537) computes heading `th[i]=atan2(dz,dx)` between consecutive resampled path points, unwraps it, boxcar‑smooths over `win` samples, then takes a central difference → `K[i]` rad/m. `detect_turns()` (539‑594, `win=9`, `floor_r=600m`, `min_deg=30°`, `tight_r=90m`, `tight_deg=14°`, `bridge_m=25m`) then:

1. **Segments** same‑sign curvature runs above `floor=1/600m`, bridging sub‑floor gaps ≤25 m so a wobble mid‑corner doesn't split a turn (542‑554).
2. **Accepts** a run if its *integrated* heading sweep `deg=|Σk·step|` ≥30°, or it's genuinely tight (radius≤90m and deg≥14°) — radius never gates existence alone (556‑564).
3. **Merges** same‑sign runs within 60 m of span-adjacency *unless* the gap between them corresponds to a >300 m‑radius straight (`STRAIGHT_R`) — a hardcoded literal, not a parameter (565‑585).
4. **Places the apex** at the curvature‑weighted centroid of the final span, not the peak sample — "argmax… wanders with the racing line" (586‑593).

DET_VER = `"geo7-tol-from-map"` (134) stamps this generation; `better_map()` (168‑197) and persistence (3279‑3327) gate whether a stored course map can be superseded.

**Caller pipeline** (2371‑2557), *not* part of `detect_turns()` itself: grip data can only **split** a merged span at a real trough between two lat‑g peaks (2489‑2536) — never create/delete a turn. The apex is then re‑computed a **third** time as argmax|curvature| over the final span (2540‑2546), overriding the centroid. L/R sign is majority‑vote‑checked against behavioral corners (2547‑2556) and flipped session‑wide if net‑wrong. `_bind()` (3058‑3092) then binds these geometric candidates into the persistent registry using **tolerance derived from the map's own minimum turn spacing**: `_TOL = clamp(gapmin/2, 6..22)` — never a fixed constant (fh6-turn-identification-rule.md).

`turn_lab.py` is a **hand-duplicated** harness (58‑200) scoring 6+ candidate detectors by cross‑lap agreement/stability (203‑303) — it has drifted from production (no `STRAIGHT_R` guard, no grip pass, no L/R calibration) and its `"baseline(ships today)"` label is stale.

### 1.2 Two parallel turn models

| | `ref_route_turn` (map) | `course_turn` (telemetry) |
|---|---|---|
| Source | `.owt` game centre‑line, `fh6_turns.py:124-194`, independent of driving | Driven laps, `analyze_session.py` DET_VER detector |
| Writer | `import_routes.py:33-89` (full DELETE+reinsert every run) | `import_telemetry.py:79-117` (canonical/established only) |
| Fields | 22 cols incl. `radius_m` (arc/sweep, *not* peak), `peak_radius_m`, `width_m`, `bank_deg`, `kind` (radius‑bucketed), 6 surface cols from `import_surface.py` | 10 cols: id/seq/arc/apex/radius/angle/**kind** (speed‑threshold vocabulary, 3rd distinct taxonomy)/n_obs |
| Fill rate | 100% geometry, 87‑92% surface (3,810 rows) | 1,513 rows, 77% NULL `kind` |
| ID stability | `T1..Tn` by apex‑arc order, fully renumbered every run | Positionally renumbered every rebuild — "100% id churn" (panel.js comment ~1724) |

**Reaches the dashboard:** `build_web.py:263-266,292-295` exports **only** `course_turn`'s 9 fields (`id,seq,s,x,z,r,deg,kind,n`) to `course/<key>.json`. `ref_route_turn`'s richer geometry (bank/width/surface/peak_radius/dir/length) reaches the UI **only** via a spatial re-join in `import_diagnosis.py:122-130` → `v_diag_by_turn` (schema.sql:1177‑1190) → `conclusionsHTML()` (panel.js:1925‑1934) — the *sole* place radius/width/bank render, and only for turns with a logged diag_event (61 of 3,810).

### 1.3 Live matching — never trusts a turn_id

`fh6_live_daemon.py:608-648` emits raw corner events (open at |lat_g|>0.35, close <0.25, 4‑phase pre/entry/hold/exit, USI, first_red) with **no turn identity**. `analyze_session.py` clusters these per‑course (2614‑2650), and matches every corner to the map by **nearest‑XZ, one‑to‑one** (`_bind`, 3075‑3092) — replacing earlier first‑in‑list‑order matching that mismatched pairs 19.2 m apart on an out‑and‑back road. The dashboard (`panel.js:1684-1754`, `turnAt`/`turnAtMatrix`) **re‑does this spatial match at every render** rather than trusting stored `turn_id` strings, because ids are documented to churn 100% across rebuilds.

### 1.4 Render — `dashboard/v2/app.js` + `panel.js`

One shared `courseMap()` (app.js:297‑332) draws all turn dots (id + radius tooltip only). `matrixHTML()` (panel.js:1773‑1824, the "Turn analysis" tab) shows `kind` beside id but **never** `deg`. The **5‑segment turn model** and **`kind`/`peak_radius_m`** named in the task brief are *not* products of `detect_turns()` at all:
- The 5‑phase behavioral model (Braking/Turn‑in/Mid‑corner/Exit) lives in a separate per‑pass detector (1505‑1554), and is capped at **4 of 5** phases live — "Straight/crest" only exists offline (`import_diagnosis.py` `CREST_AIR_G`) and never reaches the dashboard.
- `kind`/`peak_radius_m` exist only in `fh6_turns.py`'s independent `.owt` pipeline → `ref_route_turn`, imported by `import_routes.py:54,84-87` — not by `detect_turns()`.
- The 5‑state grip palette (`TRACE_GRIP`, panel.js:336‑337) is structurally capped to 3 states (calm/front/rear) in any per‑turn verdict, since `dGripUsi()` (593) can't emit 'both'/'impact'.

### 1.5 Audit — `audit_models.py` + `build_course_from_laps.py`

`audit_models.py` is a read‑only re‑derivation checker (not a detector) over every `data/courses/*.json`: merged‑map detection via `self_retrace` (64‑71), closed‑vs‑open road length ratchets (73‑139), stale‑DET_VER (142‑144), phantom‑turn (146‑154), and independently re‑derives which turns *should* be established (156‑217) — catching e.g. a model claiming 184 established turns over a 172‑turn map. `build_course_from_laps.py` is a top‑down alternative: accepts only laps the game's own metadata proves complete (105‑129), picks the **longest** such lap, and reuses `analyze_session.detect_turns()` directly (132‑159) rather than reimplementing it.

### Strengths

- Existence gated on *sustained direction change* (integrated sweep or tight‑radius override), not a fixed radius threshold — keeps long sweepers visible (539‑564).
- Two deliberate apex refinements past raw argmax, each with a measured rationale (centroid for lap‑to‑lap stability, then final tightest‑point after grip splits).
- Grip/slip strictly rescues/splits, never gates existence — avoids "turn count is a property of how it was driven."
- Match tolerance **derived from the map's own spacing**, not a guessed constant — fixed a real 20 m‑apart‑pair collapse ("Edamame").
- Turn identity for anything live is resolved geometrically at render time, with an explicit documented reason (id churn) and an ambiguity fallback (⚠, dashed outline) instead of silent guessing.
- `audit_models.py` is unusually self‑documenting — nearly every check cites the concrete measured failure it was written after.
- `radius_m` (map side) is deliberately arc/sweep, not peak curvature, specifically to reject single‑sample noise — with peak kept separately as `peak_radius_m`.

### Weaknesses

- **`turn_lab.py` has drifted from production** — missing the `STRAIGHT_R` guard and grip pass; its "ships today" baseline label is wrong (analyze_session.py:570‑585 vs turn_lab.py:109‑181).
- **Two `radius_m` definitions, same column name, different stores** — `detect_turns()`'s is single‑sample peak curvature; `fh6_turns.py`'s is arc/sweep. Anything comparing a driven turn's radius to its mapped counterpart is silently comparing different quantities.
- **`detect_turns()` produces no `kind` and no `peak_radius_m`** — those exist only in the separate `.owt` pipeline; nothing joins them to session‑derived turns except a fragile course_match‑gated path.
- **The 5‑segment model is a category error to attribute to `detect_turns()`** — it returns one span/one apex, no phases at all; phases live in a wholly separate behavioral detector, capped at 4/5 live.
- **6 of `ref_route_turn`'s 22 columns (all surface enrichment) never reach any dashboard JSON** despite being 87‑92% populated.
- **`course_turn.kind`'s schema comment doesn't match its own data** (hairpin/sweeper/kink/chicane documented vs NULL/fast/hairpin/medium actually written) — a third, undocumented taxonomy.
- **`bank_deg` has an unclamped, implausible outlier** (max 113.55° vs mean 4.82°, 3,810 rows) with nothing downstream flagging it.
- **60 m compound‑merge distance is a hardcoded literal** (analyze_session.py:578) even though `turn_lab.py` treats it as tunable — the two files can no longer stay experimentally linked.
- **Self‑crossing/out‑and‑back roads are explicitly unsolved** (`geo_near`, 2569‑2598: "a real piece of work and is not attempted here").
- **`corner_obs` has zero downstream readers** — computed, then never selected by `build_web.py` or `panel.js`.
- **~29% of learned courses have no `route_id`** (`match_kind`: none=25 of 87) — `ref_route_turn` geometry is unreachable for them by any path.

---

## 2. Options explored

### Detector generation history

| Generation | Approach | Outcome | Why |
|---|---|---|---|
| Gen 0 (11b4cc9) | Lat‑g > 0.35 threshold decides turn *existence* | superseded | Turn count moved with how hard you drove, not the road |
| 7d1aa77 | Curvature map added, but only annotates properties, not existence | superseded | Existence still behavioral |
| d388f0d / 1f834af / a3e2f3244 | Track‑presence ratios, 35 m merge, declared‑count promotion (patches on the behavioral foundation) | superseded | "Compensating for that wrong foundation" |
| **7dbaecd3** | **Paradigm flip**: existence ← curvature of driven path; behaviour demoted to add‑only | adopted | Smoothly‑driven turns were structurally invisible to lat‑g |
| **geo2**-centroid-m60 (f127461) | Permissive r<600m floor + sustained‑sweep accept (≥22°→30°); centroid apex; 60m merge; new `turn_lab.py` harness | adopted | 93% cross‑lap agreement vs 59% for old r<250m baseline |
| — | heading‑30 argmax variants, `det_baseline` (r<250m) | rejected | Beaten on agreement/orphans by centroid variant |
| **geo3**-straight-veto (1ae476f) | Grip-loss peaks *split* (never gate) curvature runs; apex = tightest point in final span | adopted | Cross‑lap agreement metric structurally rewards under‑segmentation; 12 grip peaks vs 7 detected turns |
| **geo4**-arcreg (99b6f45) | Registry matching switched Euclidean(40m)→arc‑length(±22m) | adopted | Hairpins pass near themselves; arc position is unambiguous |
| — | Lat‑g "rescue" adding brand‑new turns | rejected (reverted pre‑commit) | Duplicated existing turns (28 turns, pairs at identical positions) |
| **geo5**-latg-split (8426b06) | Union a lat‑g *trough* split with grip‑peak split (only ever adds) | adopted | Continuous‑curvature multi‑corner sequences never dip below the floor to split on |
| — | Add lat‑g runs as new turns / gate the bridge on lat‑g / replace grip split with trough test | rejected | Each destroyed more turns/duplicated more than it fixed |
| **geo6**-banked-latg (94293d0) | Lat‑g profile banked as running (sum,n) across *all* sessions, not just latest | adopted | A thin session built no profile → no split fired → turn count regressed 15→7 |
| **geo7**-tol-from-map (524a391) | One shared map‑derived tolerance across every match stage; behaviour‑only established turns demoted to no‑map fallback | adopted (current) | Fixed 40m stage re‑merged what map‑derived matchers had kept apart; first 3‑way agreement (geometry=registry=established=13) |
| Post‑geo7 (58205e0) | Persisted model supplies the turn *set*; session may only measure onto it or add if `det` matches | adopted | An older‑detector session drew 8 turns over a 13‑turn agreed model |
| Post‑geo7 (6bde1bd) | `detect_turns()`/`curvature()` promoted to module scope; odometer bug fix | adopted | Odometer under‑reported a 37,671m lap as 6,621m (5.7x short) |
| Post‑geo7 (a92797c) | Attempt to disambiguate self‑crossing apexes via corner record's `dist` field | rejected (reverted pre‑commit) | `dist` measured ≠ distance‑along‑lap; re‑picked the same wrong id in a new costume |
| Post‑geo7 (1bf6f13) | `better_map()` selection: point‑count → arc‑length | adopted | 500‑point downsample cap made a 24x‑longer map lose permanently (47,648m/491pts vs 1,966m/490pts) |

### Settled design decisions (rejected alternatives)

| Decision | Rejected in favor of | Why |
|---|---|---|
| Behavioral (lat‑g) existence | Geometric existence, behaviour as fallback only | "A turn is a property of the road, not of how hard you drove it" (analyze_session.py:3052‑3056) |
| Fixed tolerance (40m / 22m) | `clamp(gapmin/2, 6, 22)` from map's own spacing | Edamame's 20m‑apart pairs collapsed under any fixed constant |
| Tolerance from *this session's* fresh detections | Tolerance from the persisted authoritative map | Fresh/thin sessions regress to the pre‑fix constants on exactly the runs least able to afford them |
| First‑match‑in‑list binding | Nearest‑match, one‑to‑one (`_bind`) | Self‑crossing road mislabelled every return‑pass corner with the outbound id |
| Point‑count map selection | Arc‑length map selection | Saturates at the 500‑point downsample cap |
| Trust stored `est_by`/`geo_mapped` during migration | Recompute from geometric proximity | Two pre‑provenance models had no flags at all — one claimed 184 established turns over a 172‑turn map |
| Validate new detector against old detector's counts | Validate against the map (ref_route_turn) and cross‑session lap stability | Old generations were never trusted; re‑deriving Aug‑22 captures took one course 12→39 turns — "neither number is right until compared with the road" |
| Radius‑threshold existence gate (`det_baseline`) | Sign‑segmented, sweep‑angle‑gated existence | Radius alone made a 200m sweeper invisible and a hairpin twitch count |
| Argmax apex | Curvature‑weighted centroid | Argmax wandered tens of metres lap‑to‑lap |
| Tune merge distance on cross‑lap agreement alone | Fixed measured 60m + `STRAIGHT_R` veto | Agreement metric rewards merging; unconstrained tuning drove the gap to swallow real corners |
| Peak‑curvature radius as ground truth | Arc‑length/sweep‑angle radius (map side) | Peak curvature is a spike detector — a survey wobble gave a "4m hairpin" on a highway |
| Unified 5‑phase corner object | Left as a gap: live=4 phases, crest=separate mechanism | Crest detection (`CREST_AIR_G`) never unified into the phase numbering |
| Always‑on adaptive map zoom | Shipped off by default, deferred to a future mode | Right for a driver on a known track, wrong while building/testing a car |

---

## 3. Future options

### A. Fuller use of stored route‑geometry signals (map‑only, `fh6_turns.py`)

**Approach:** three additive changes, all reusing data already decoded:
- **(B) Vertical curvature (crest/dip):** `apex_y`/`ref_route_point.y` are computed and stored but read nowhere else. Re‑run the existing `resample()+curvature()` machinery on `y(arc)` instead of `heading(arc)` to run‑detect crests the same way corners are detected — closes the named design‑language gap where "Straight/crest" (segment 5) is currently only *reactive* (`CREST_AIR_G` after the car has already gone light).
- **(C) Per‑turn curvature profile:** `fh6_turns.py`'s `k[]` array is already computed once per turn then collapsed to two scalars (`radius_m`, `peak_radius_m`). Sample `1/|k|` at the first‑ and last‑quarter indices (already in the same loop) to add `radius_entry_m`/`radius_exit_m` — distinguishes a late‑apex tightening corner from a constant‑radius one.
- **(A) Banking‑aware severity + geometric racing‑line offset:** fold `bank_deg` into an effective radius before `kind_of()`, and use the centre‑line's own half‑width vector for a predicted racing line.

**Data available:** everything needed is already decoded and in memory/on disk — no new game‑file parsing.
**Feasibility:** high. **Effort:** C = 2‑4h, B = 0.5‑1 day, A = ~1 day (once gated).
**Benefit:** B retires a self‑documented gap (crest is currently un‑derived from geometry); C sharpens the 5‑segment vocabulary at near‑zero cost.
**Risks:** `bank_deg` already has a documented anomaly (values >90° in the corpus, flagged "suspect" in the data‑field catalog) — using it for severity before that's resolved risks shipping backwards advice on exactly the stunt/wall‑ride routes where banking matters most. B will fire on FH6's intentional ramps/skislopes unless gated by `road_profile`/`road_class`.
**Verdict:** **Pursue B and C now** (cheap, map‑only, no versioning gate needed since `import_routes.py` unconditionally rebuilds `ref_route_turn` every run). **Hold A** until the `bank_deg` sign convention is manually verified against 2‑3 known stunt/loop routes (a half‑day task).

### B. Telemetry‑driven QA/refinement layer (validate map turns against driven consensus — never assert existence)

**Approach**, in cost order:
1. **Apex‑position residual QA (near‑free):** `import_corners.py:69-83` already computes each pass's closest‑approach distance to the map apex, then discards it. Persist it (new column on `corner_obs`) and cluster by `turn_id` to flag turns whose driven‑consensus apex sits far from `ref_route_turn`'s stored apex — a diagnostic only, catching the exact bug class this project has hit before (312m drift, colon‑filename bug).
2. **Braking‑point clustering:** extend `turn_stats.py`'s existing arc/longitudinal‑g windowing to record *where* deceleration first crosses a threshold, clustered per turn — gives Jett's feedback a real driven fact to cite per corner (satisfies the feedback‑specificity hard rule) instead of relying on radius‑derived `kind` alone.
3. **Port the compound‑corner lat‑g trough test to catalogued routes:** currently only runs on the self‑built geometry path (analyze_session.py:2500‑2526), never on `fh6_turns.py`'s official output.

**Data available:** all three reuse fields already computed and discarded (import_corners.py, analyze_session.py's corner list, turn_stats.py's windowing) — no new capture, no Brake‑pedal channel needed for a first cut.
**Feasibility:** medium. **Effort:** (1) small, (3) medium‑large.
**Benefit:** turns a currently silent trust in `fh6_turns.py` into something checkable against 8,800+ laps, using the project's own proven pattern (gated, diagnostic‑only verdicts, never overriding the map).
**Risks:** must stay strictly read‑only w.r.t. `ref_route_turn`/`established` — this is precisely the failure mode geo0→geo7 spent 9 commits correcting away from. 53% of mapped turns already have zero usable traces; a "not enough data" verdict must be reported honestly, not as agreement.
**Verdict:** **Pursue later**, in order (1)→(3)→(2)-port, after the map‑anchored scoring in section D below is in place.

### C. External references (other racing sims / community FH tools)

**Approach:** GitHub‑first search for corner‑detection prior art (per project doctrine).
**Findings:** curvature‑threshold detection (this project's method) is the industry‑dominant approach (TUMFTM/global_racetrajectory_optimization and similar, via discrete Menger curvature — mathematically close but redundant here since `fh6_turns.py` already uniform‑resamples first). One sibling FH5 community tool (DDDGood/fh-wiki) uses lat‑g hysteresis on telemetry only, with no `.owt`‑equivalent ground truth. A close sibling project (Ojansen/co-driver) still lists "curvature‑based apex detection" as an **unbuilt wishlist item** — this project has already shipped it, from the game's own AI‑line file, which is stronger than any telemetry reconstruction. **No external FH `.owt`/corner dataset exists anywhere on GitHub** — this project's byte‑level decode of the AI line appears novel.
**Feasibility:** medium. **Effort:** small if pursued (15 min to check `NormDrivingLine` liveness; 1‑2h for a Menger‑curvature cross‑check).
**Benefit:** low‑to‑medium — could at best coherence‑check two already‑correct estimators against each other.
**Risks:** re‑solving an already‑solved problem; the one live loose end (`NormDrivingLine`/`NormAIBrakeDiff`) is a data‑verification question, not an algorithm question.
**Verdict:** **Not worth pursuing as a dedicated workstream.** Do a cheap opportunistic liveness check on `NormDrivingLine` later; skip adopting an external raceline optimizer — it solves a different problem (generating a novel line) than detecting corners in an already‑known centre‑line.

### D. Score candidate detectors against `ref_route_turn` (map‑anchored precision/recall, layered on `turn_lab.py`'s existing cross‑lap stability score)

**Approach:** add `score_vs_map()` to `turn_lab.py`. For each course with a verified/probable `route_id` (18 of the 23 courses that already qualify for `turn_lab.py`'s ≥3‑lap scoring), load `ref_route_turn` as ground truth; derive match tolerance via the **same** already‑established `clamp(gapmin/2, 6, 22)` rule; match detected apexes to ground truth by nearest‑XZ‑within‑tolerance (the identical spatial pattern `import_corners.py` already proves works, same coordinate frame, no transform needed). Report precision/recall/F1/median localization error/L‑R agreement beside the existing agreement/sd/orphans columns. **Acceptance gate for any future DET_VER bump: no regression on any metric, improvement on at least one** — prevents a detector from gaming stability at the cost of map‑accuracy or vice versa.
**Data available:** `ref_route_turn` ground truth for 35 routes already exists; 18 of 23 `turn_lab.py`-eligible courses already have verified/probable route binding — the eval set exists with zero new capture.
**Feasibility:** high. **Effort:** moderate, one new ~60‑80 line function reusing three already‑solved patterns (tolerance formula, spatial match, existing scaffolding).
**Benefit:** closes the actual hole in `turn_lab.py`'s design — cross‑lap agreement can only catch *noise* (self‑disagreement); it cannot catch systematic *bias* (a detector that always merges two corners, or reports the apex 40m early, scores perfect agreement today). This is the only way to actually prove one detector is more *correct*, not merely more self‑consistent.
**Risks:** `fh6_turns.turns_for()` is itself a thresholded algorithm on the true centre‑line, not a human‑verified label — valid as ground truth because it's driving‑independent, not because it's infallible. Self‑crossing routes have documented unresolved apex ambiguity — exclude them from the eval set. Filter to courses with ≥~95% arc coverage to avoid deflating recall on undriven road.
**Verdict:** **Pursue now.** This is the missing half of `turn_lab.py`'s own stated design, all needed data and matching machinery already exist and interoperate, and it directly satisfies the hard rule that any detector claim must be defensible against the road, not against itself.

---

## 4. Recommendation

**Priority 1 — Map-anchored scoring in `turn_lab.py` (avenue D).**
This is the cheapest, highest‑leverage move and the only one that turns "we improved the detector" into a falsifiable claim rather than a self‑consistency number. First concrete step: add `score_vs_map()` reusing the existing `_TOL = clamp(gapmin/2,6,22)` tolerance formula and `import_corners.py`'s proven nearest‑XZ spatial‑match pattern, run against the 18 courses that already have verified/probable `route_id` + ≥3 laps. **Validation:** report precision/recall/F1/localization‑error per course alongside the existing agreement/stability columns; adopt as a hard gate — any future DET_VER candidate must not regress any metric and must improve at least one, exactly as the hard rule requires ("never validate against old counts" — this validates against the independently‑derived `.owt` map, not against a prior detector generation's output).

**Priority 2 — Vertical curvature (crest/dip) + per‑turn radius profile in `fh6_turns.py` (avenue A, parts B+C).**
Both are map‑only, reuse machinery already proven (`resample()`/`curvature()`), require no versioning gate (routes are fully rebuilt every run), and close a gap already named in project memory (Straight/crest un‑derived from any geometry). First concrete step: copy `resample()+curvature()` to run on `y(arc)`, gated by `road_profile`/`road_class` to exclude intentional stunt geometry (skislope/dragstrip substrings), and add `radius_entry_m`/`radius_exit_m` by sampling the existing `k[]` array at quarter‑points inside `turns_for()`'s loop. **Validation:** rerun `python scripts/db/import_routes.py` (unconditional delete+reinsert), then manually spot‑check the new crest flags and entry/exit radii against 2‑3 known real‑road crest corners and 2‑3 known stunt loops to confirm the road_profile gate is excluding the right cases — no telemetry needed, since this is map‑authority-only.

**Not worth doing now:**
- **Banking‑aware severity/racing‑line (avenue A part A)** — hold until the `bank_deg` >90° sign‑convention anomaly is resolved (a half‑day check); shipping severity logic on a column the project's own audit already calls "suspect" risks misleading corner‑difficulty judgments before it helps them.
- **Adopting an external curvature/raceline algorithm (avenue C)** — this project's `.owt`‑derived ground truth is already stronger than anything an external heuristic could produce; no external FH corner dataset exists to validate against anyway.
- **Telemetry QA layer (avenue B)** — genuinely valuable but sequenced *after* Priority 1, since map‑anchored scoring is what would actually validate whether QA‑flagged discrepancies are map errors or telemetry noise.
- **Fixing `turn_lab.py`'s drift from production piecemeal** — better folded into the Priority‑1 work, since `score_vs_map()` will need the harness's detector list re‑synced with `detect_turns()` anyway.