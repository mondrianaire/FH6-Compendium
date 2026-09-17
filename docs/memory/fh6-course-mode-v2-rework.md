---
name: fh6-course-mode-v2-rework
description: "Course-mode v2 rework: build order steps 1-6 all BUILT (SCOPE band, Current lap, General statistics per-car redesign, map legend toggles, hero class-bar chart, confidence reframe, follow camera); STILL OPEN = build-panel three faces (deferred) + P2P arc / D3 gaps. Spec→code map: lab docs/course-mode-v2-prep.md"
metadata: 
  node_type: memory
  type: project
  originSessionId: 296a839f-0659-4c18-9615-67fefe7d7f71
  modified: 2026-09-17T01:03:39.152Z
---

Jett handed over an implementation spec on 2026-09-11 ("handoff-course-mode-v2", design source
`Course Mode - Redesign v2.dc.html`, which was NOT found on disk or in the artifact list). Scope: the
Current lap tab (`lapHTML`, key "lap") and General statistics tab (`courseStatsHTML`, key "stats"), plus
shared chrome: SCOPE band (replaces #coursefilter content), one PAINT state, map legend bar + layer
order, FOLLOW camera, three-face build panel. Single-turn analysis is the NEXT design pass, not this one.

Prep doc: lab `docs/course-mode-v2-prep.md` (committed 2026-09-11). Build order there: foundations
(scopeToken, rankVerdict, lapNo, stats onto activeLapSet, rate live turns on mph_min, build_web built_at)
→ SCOPE band → Current lap → General stats → chrome → follow camera.

**Why:** the design handoff (tracking session) showed verdicts without their basis ("★ best yet" on 15 of
18 rows was 0 of 18 fairly ranked). Rule 1 of the spec: rank + denominator + scope + confidence.

**Decided (Jett, 2026-09-11) — Q1–Q4 answered:**
- Q1 FOLLOW camera: **follow while a lap is live** only; the course view stays static otherwise (this
  narrows, not repeals, the 2026-09-06 static decision).
- Q2 design source: `C:\Users\mondr\Downloads\Course Mode - Redesign v2.dc.html` (130 KB canvas);
  extraction written to lab `docs/course-mode-v2-design-extract.md`.
- Q3 rank pool: **every lap in scope** (phaseObs min_mph), not only traced laps.
- Q4 trail paint: **selectable in the map legend's settings (key) panel** — built 2026-09-11 as
  "live trail: grip | speed", sharing TRACE_MODE with the speed trace's paint toggle.

**Built 2026-09-11 (this + the earlier session):** steps 1-3 (foundations, SCOPE band, Current-lap turn window)
per the handoff; then step 5 chrome — map legend layer toggles + layer-order fix (`9e5895a`), hero laps-by-class
BAR CHART with click-to-scope + hash table retired (`669d02a`), confidence reframed to "last build remembered" +
save-method tuning guarantee in `gateStrip` (`05c7166`), SCOPE band compacted 108→80px behind a `filters` toggle
(`2310d19`); step 6 follow camera `courseFollow()` (`4ed315f`, follow only while `LIVE.lap.live`). Conclusions tab
dropped from the list, plumbing kept (`25de39d`). The single-turn window (trace-through-corner, next/last, ladders,
rank table) was already built in step 3 — do NOT rebuild it. Step 4 General statistics rebuilt per-CAR (`7216ac2`):
basis header + most-driven/quickest headlines + laps×best scatter + fastest-first car table, scoped, honest about
laps that name no tune. **STILL OPEN:** the build-panel three faces (deferred; the tie face must never reintroduce
a pick-from-ties UI — [[fh6-tune-identification-equip-workflow]]), and the standing P2P trace arc-registration and
D3 (live grip typical-not-worst) gaps.

**Real-estate collapses (2026-09-11, "money square" = the whole portrait screenful; the map + its data must fit
comfortably there):** three panels compacted from UI/UX-audit specs. (1) `#hdr` vehicle band 224→120px (`4b0dc99`):
two columns, livery is a 240px image-only HERO tile (was a 17%-opacity wash), verdict folds into the gate ident,
evidence into a gstate micro-line, guarantee into an ⓘ tooltip; height fixed in every state so the course view can't
jitter. (2) Left course-info collapse (`b248f48`): `.pane>header` 70→38px (course mode only, via `:not(:has(.cpill
[data-state=course]))` so free-roam's world pill keeps 70px); the tall `.chero` split by new `courseHeroParts()`→
{facts,drawer} — `facts` is one compact line (flattened stats + click-to-scope class rail) above the map, the demoted
detail (shape glyph, laps-by-class bars, confidence, freshness) rides the pill's hover drawer; name+status are tier-1
and never shrink, provenance chips clip. Map now dominates the pane (~378px overhead → ~113px). (3) Turn-analysis
title bar (`d78122b`): identity/geometry ∪ the time summary (typical · available · fastest pass · most-time-in) ∪ the
5-phase budget bar, one compact bar in `turnStatsHTML`; the per-phase typical-vs-best table stays below the map as
drill-down. Reusable procedure saved: lab `docs/pane-audit-framework.md` (budget/duplication/minimum-viable-fields;
the fourth question — check for a CSS-forced height the content doesn't justify).

**Turn-analysis intelligence (2026-09-12) — the a_max grip-ceiling feature is BUILT + validated.** Grip overlay on the
corner map (`cf043c6`); schema-7 peak-lat-g pipeline + rating (see [[fh6-turn-analysis-data-model]] for the full detail
and calibration facts). A 5-agent validation audit ran and CAUGHT + fixed a critical cross-lap-mixing bug in the rating
(`dba36bf`: use ONE reference pass, disclose per-turn nLaps, mark thin <3-lap ratings). Also this session: the view-audit
small-fix batch (`014de78` — dead CHANGE chip, offline-button style, stuck highlight chip, PI-badge in by-car table,
`#hdr` flatten, hover-only→keyboard for lab-services + course-pill drawer, facts-line wrap); verbiage trim above the
corner map (`0f512f4`); backfill skips corrupt captures (`7786e4d`). NEXT PLANNED UPGRADE (theorycrafted, not built):
the FINDING ENGINE — "what your fast laps share, with the evidence" (correlate per-lap driving variables vs turn time,
own-card below the leaderboard, ranked-ρ + scatter, within-class, honesty-gated); its richest feed is grip-break
attribution (grip_state × pedal per phase — LIGHT pipeline, pedals already in lap_point, no reprocess). Deferred audit
items: shared covers-gate (turnAgg vs turnStatsHTML), map-primacy cap (turn table crowds map on 45-turn courses), unify
per-phase math, paint-toggle dedupe.

**Turn-map interaction upgrade (2026-09-16) — BUILT + verified on route:6001 (102 passes).** Three features in
`cornerMapHTML`/`turnStatsHTML` (panel.js) + styles.css: (1) the PHASES/LINES/MARKS legend + colour-mode filter
collapsed into a `.cm-legpop` pop-over behind a `legend ▸/▾` button on the map (`CM_LEG_OPEN`, localStorage `fh6CmLeg`,
**default collapsed** to reclaim height). (2) A `.cm-transport` bar (play/pause · scrub · ¼×/½×/1× rate · loop) that
animates a car marker through the turn. (3) **Ghost replay**: the leaderboard row select went single→**multi** (`LB_PICK`
→ `LB_SEL` Set; plain click toggles); selected passes (or the fastest, if none) animate as distinct-coloured dots with
live mph tags on a **shared real-time clock reconstructed from world-distance ÷ speed** (traces are distance-parameterised
— NO stored per-sample time; dt = Δmetres/(mph·0.44704), t=0 at each pass's first in-frame sample = "from entry", so the
faster line pulls ahead and the gap = time lost — v1 approx: entry is each line's own frame-crossing, not one shared
cross-line). Engine (`CM_ANIM` + `cmBuildMotion`/`cmAnimFrame`/`cmAnimDraw`) is module-level and **self-healing** — the
rAF re-finds the current `.tstat-cornersvg` and re-creates its `#cm-anim` group after paintRight's full rebuild (a live
`corner` SSE event repaints the pane). `pickTurn`/`stepTurn` clear the set + `cmAnimStop`. Colour: explicit compare set
gets a categorical palette (pace-rank green clusters and would make two fast passes look identical); auto single pass
keeps its rank colour. dashboard v2 now panel.js v238 / styles.css v180. Deferred: match the selected traces' own colour
to their ghost; a shared entry cross-line.

**Live-tab consolidation (2026-09-16, commit 48ddaaf) — the "only a handful of identified corners show live" fix.**
Root cause: both Current lap (`lapHTML`) and Live corners (`cornersHTML`) were DETECTION-driven — they iterated
`LIVE.corners` (raw output of the daemon's g-detector, `fh6_live_daemon.py:609`, start >0.35g / end <0.25g / ≥0.8s /
non-impact) and bound each to a turn, so fast/gentle/short/compound turns the detector never triggered silently vanished.
Jett's call: **one live tab + two analysis tabs.** So: **Live corners RETIRED in course mode** (`rightTabs()` course list
is now `["lap","matrix","stats"]`; free roam KEEPS `corners` as its only live view — no course to key turns to). **Current
lap became the whole-course spine**: it lists EVERY identified turn (`COURSE.turns`, driving order) with a per-turn state —
`taken` (detected pass, rated), `driven` (the car's own live-lap line passed the apex but the detector never fired — shows
min mph via `turnSlice`), `awaiting` (not reached this lap); driven/awaiting rows carry `data-turn` → click opens Turn
analysis. Keyed to the map by nearest apex (`turnAt`/`turnAtMatrix`, 40 m), NEVER by turn_id (course_turn ids churn every
rebuild). The empty-lap early return was removed so the whole course shows from load-in. Live corners' session front/rear
**balance tally moved to General statistics** (`courseStatsHTML`, car-filtered, labelled "this session, not the scope").
`cornersHTML` kept unchanged for free roam. panel.js v239 / styles.css v181. Verified on route:6001 (spine renders all
identified turns, correct seqs, no console errors). Same detection-vs-identified gap could still be applied to the free-roam
corners log, but there is no turn spine there to key to.

**Session + Single-lap tabs (2026-09-16, commit 2bbd5fa) — identity-scoped course-mode IA expansion.** Course tabs
now: Current lap · **Session laps** · **Single lap** · Turn analysis · General statistics (panel.js rightTabs).
KEY IDENTITY DECISION (Jett): the driving build identity = **(hw_hash, setup_hash)** — same pair = the SAME build,
nothing else (container/build_id/save-instance/downloaded-vs-tuned) separates them from driving. `setup_hash` is the
CONTENT slider hash (merges re-saves); `lap.tune_hash` is a per-save proxy (1:1 with container — WRONG for this, do
not use). `hw_hash` is shared across lap/tune_container spaces; `lap.hw_hash==tune_container.hw_hash`. build_web.py
lap SELECT now exports `hw`+`su` (LEFT JOIN tune_container for setup_hash; NULL for unsaved/downloaded). The "this
tune" SCOPE PRESET (presetTest) upgraded from container-keying to `l.hw===mb.hw && l.su===mb.su` (mb=MATCH.build,
which carries .hw/.su directly — no bridge). **Session laps** = `setupLapSet()` (the current build's identity scope,
independent of the SCOPE band) — fastest-first lap list + the turn table RELOCATED out of paintLeft (turnTableHTML,
map now owns its pane); click a lap → Single lap. **Single lap** = one lap turn-by-turn: each turn's min-speed scored
via `rankVerdict` against 4 pools **all/class/car/this-setup** (badge = rank/of, ★ pool-best, ☆ thin<5), PLUS the
progress-delta meta-score `progressDeltaHTML` — this lap's reconstructed elapsed vs a reference (session-best default;
overall-best/median selectable, DELTA_REF) across **% PROGRESS through the lap** (monotonic cumulative distance, NOT
raw arc which WRAPS on a loop — that was the bug), turn markers by nearest-apex, "ahead/behind at the line" verdict.
Honesty: reconstructed time (distance/speed), shape exact / absolute seconds approximate. panel.js v243 / styles.css
v182. SESSION-GRAIN = identity (route+car+build+tune), so Rivals continuity across the new-rival menu is AUTOMATIC
(no time/capture boundary involved). STILL TODO: daemon rival-beat detector (on-course-stationary winner screen, see
[[jett-no-ocr-rivals-detection]]) + live PB (BestLap/LastLap into compact()); drop the turn table's now-redundant grip
column (grip already in Turn analysis); the `last_lap_s` ground-truth column (see the reported-vs-computed finding).

**IA finalised (2026-09-16, commits c09dc2e + 6022f66) — session list to the LEFT pane, audit-driven restores.**
An audit of the 4 restructures (git-grounded, via a workflow) found genuine data losses; restored the 3 load-bearing:
(1) the **5-phase apex-mph median row** (existed only in the turn table) → a `.tsum-ph` chip strip in turnStatsHTML's
title bar; (2) **per-corner detection detail** (brake_on_m, throttle_on_m, lat_g_peak, first_red axle/phase, hb/drift/
hard-brake flags) → a `.lap-cdet` full-width sub-line under Current-lap TAKEN rows (from LIVE.corners `q.c`); (3) the
**"in a corner now" chip** → Current-lap header. Then the IA move: **session lap list now lives in the LEFT pane under
the map** (`sessionListHTML` injected in paintLeft, scoped to the identity "this setup", honest empty state when
unsettled), the **right "Session laps" tab RETIRED** (course tabs = Current lap · Single lap · Turn analysis · General
statistics), the **under-map turn table retired** (dead code left in place: sessionHTML + turnTableHTML — safe to delete
later). `pickSessionLap` couples selection: click a left-list lap → isolate its line on the course map (LB_SEL +
applyLapPick) + open Single-lap on the right = master-detail. **Identity gate (commit b379180):** setupLapSet requires
matchQuality(CUR.match).level==="ok" — the live cid (ordinal|drive|cyl|PI, no hw/tune hash) ties across saves, so
MATCH.build is exact[0] (first tied candidate, e.g. a downloaded A build reads as sibling "S1 Circuit Meta"); scoping
to that guess would track the WRONG tune. Resolvers: equip+save, drive a gear the ladder distinguishes, or pick.
panel.js v246 / styles.css v184. Deferred audit-LOST items accepted: the chronological corner log (superseded by the
spine), the "N unranked" prefix, seq==null taken row. Related: [[fh6-tune-identification-equip-workflow]].

**How to apply:** build in the prep doc's order; the camera follows only while `LIVE.lap.live`. Data facts measured on route 5411 (don't re-derive from the prototype): phaseObs
has per-lap min_mph and time_s for every lap; turns carry width/bank; turn.n is always null; tune
(container) is missing on 20 of 45 laps; P2P traces are not arc-registered to the route. Related:
[[fh6-turn-design-language]], [[fh6-dashboard-monitor-portrait]], [[jett-port-perfected-surfaces]], [[fh6-turn-analysis-data-model]].
