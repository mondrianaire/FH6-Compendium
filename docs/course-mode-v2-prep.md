# Course mode v2 — implementation prep (Current lap + General statistics)

**Date:** 2026-09-11 · **Lab:** `forza-eliminator-tips-db-c512c3` · **Spec:** the `handoff-course-mode-v2`
implementation handoff (Jett, 2026-09-11; design source `Course Mode - Redesign v2.dc.html`).
**Status:** prep only. Nothing in this document is built yet except step 0 (grip palette, live lap buffer,
trail paint selector). All four blocking questions are answered (§1).

This maps every spec section to the code that exists today, lists what the data already supplies
(several of the spec's §8 "prototype approximations" are already real fields), names the decisions that
block a build, and fixes the build order. Line numbers drift; function names are the stable anchor.

---

## 0. Done before this pass

- **D1/D2 grip palette** — one `DGRIP` (`col` / `ink` / `word` / `tip`) + `GSTATE`, `gripOf()`, `gripInk()`
  in `panel.js`. Every surface the redesign touches (trace, map trail, corner windows, rank rows) must
  paint grip through these, never a hex literal.
- **Live lap buffer** — `LIVE.lap` / `LIVE.lapPrev` (`live.js lapSample()`): the whole lap on the game's
  lap clock, held as "last run". The FOLLOW camera trail and the Current-lap view should read it.

---

## 1. Decisions (Jett, 2026-09-11 — all four answered)

| # | Question | Decided |
|---|---|---|
| Q1 | FOLLOW camera vs the standing static course view (2026-09-06) | **Follow while a lap is live** (`LIVE.lap.live`). Static otherwise — a pause, the end-of-event menu, browsing and free roam keep the whole-course fit. The rig resets to the full course on the live → held edge. |
| Q2 | Design source | `C:\Users\mondr\Downloads\Course Mode - Redesign v2.dc.html`; its engineer-facing extraction is `docs/course-mode-v2-design-extract.md`. |
| Q3 | Rank pool | **Every lap in scope** — `turns[].phaseObs[..][2]` `min_mph` per lap, not only traced laps. |
| Q4 | Trail paint | **Selectable in the map legend's settings (key) panel.** Built 2026-09-11 (`6d43d5c`): `live trail: grip \| speed`, one state (`TRACE_MODE`) with the speed trace's paint toggle, speed on the course's own mph scale. The SCOPE band's PAINT control (spec §2) must bind to the same state, not add a third. |

---

## 2. Spec → today's code

### 2.1 SCOPE band (spec §2)

| Spec | Today | Gap |
|---|---|---|
| One band below the trace governing both panes | `#coursefilter` bar — `paintCourseFilter()`; chips from `traceFilterState()`; handlers in `wireTrace()` → `repaintFiltered()` | Position matches. Content is preset + dim chips; needs PI-badge class options with counts, the reading line, mismatch state. |
| Scope = one source of truth | `activeLapSet()` = `presetTest(sel.preset)` + `TRACE_DIMS` filters + `RACING_ONLY`, stored per course in `vcourse()` / `traceSel()` | **`courseStatsHTML()` does not use it** — it re-filters `COURSE.laps` inline and only reads `sel.filters.class`. Second consumer `mapFilterBar()` (map drawer). |
| Token `A·7` / `ALL·45` on every scoped count | none | New `scopeToken(ls)` helper; audit every count in hero, turn table, lap view, stats. |
| Mismatch state + "match my car" | none (`liveClass()` exists; preset `class` auto-selects in events) | New: compare `sel.filters.class` / preset against `liveClass()`; one-tap sets `vc.filters.class`. |
| PAINT (`grip`/`speed`) one state | `TRACE_MODE`: trace header `modeControls()` + map key `[data-trailpaint]` (both handlers repaint both panes) | Already one state across trace, map trail and map key. The band's control binds to it too (Q4). |

### 2.2 Course pane (spec §3) — `courseHeroHTML()`, `courseInfoPill()`

- Confidence is already three buckets (`strong` 13+, `weak`, `unmeasured` = catalogued − measured) via
  `turnLapCount(t, ls)` counting distinct lap ids in `phaseObs`. `turn.n` is **null for all 16 turns** on
  route 5411, so the spec's "`n_laps == null` never counts as needs more" is already how it behaves;
  wording must become `12 turns on 13+ laps · 0 timed on fewer · 4 catalogued, never timed`.
- Laps by class: counts exist; bar chart + click-to-scope is new.
- Route silhouette as background: today a separate glyph svg (`.ch-glyphsvg`). Note the live dot bug
  fixed 2026-09-11 — anything selecting "the map svg" must use `svg[data-x0]`.
- Freshness on the comparison: **no per-course build stamp exists** (`build_web.py` writes none). Only
  the global rebuild-service `RB.last.finished` and `sessions_pending` (`live.js`). Needs §3.4 below.

### 2.3 Course map + legend (spec §4.1–4.3) — `courseMap()` in `app.js`

- Box aspect: `courseMap` computes `W` from the route aspect at `H = 380`; the `.cmap` flex box stretches.
- Legend: today a floating pill (`.cmap-legend`, view toggle + key). Spec wants a 74 px bar under the map
  with four live layer toggles + basis lines. The `LIVE lap` chip and grip key added 2026-09-11 move into it.
- **Layer order is wrong for the spec today:** centre-line is painted FIRST (`line(theirs, …)` before
  `cmap-hist`). Spec §4.3: lap bundle → fastest → centre-line last (2.2 px, opaque) → phase ribbon → markers.
- `laps drawn` basis: every lap on route 5411 has a trace (45 of 45), so the prototype's "20 older laps
  have no stored line" does not apply to this route — compute, don't copy.

### 2.4 CURRENT LAP view (spec §5) — `lapHTML()`, tab key `"lap"`

| Spec | Today | Change |
|---|---|---|
| Turn window (nav, corner map, trace ribbon, two ladders) | none in this tab; the per-turn map + rail live in Turn analysis (`turnMap()` / `cornerMapHTML`, `turnStatsHTML`) | Build `turnWindowHTML(turn, lap, ls)`, reusing the corner-map + phase-rail code. |
| Bold middle number = the rated one (minimum) | row shows `c.mph_apex ?? c.mph_min` (peak-lat-g speed); history compares per-lap **min over phases** (`phaseObs[..][2]`) | **The §1 defect.** Rate and show `c.mph_min`; peak-g speed secondary. |
| `★ 1 of 6 / 6 traced in A·7`, never `best yet` | `rankLbl = !n ? "first pass here" : isBest ? "★ best yet" : pos of N` | New `rankVerdict()` (below). |
| Degenerate / thin / empty pools | none | `only lap`, `level · n`, hollow ☆ under 5, `no lap / none traced in A·7`. |
| Abandoned attempts collapsed | restarts share `lapn`; rows repeat T2–T4 | Group live corners by stint/run id — **verify the SSE corner event carries one** (handoff says the two attempts have different run ids). |
| One lap-number convention | `lapHTML` converts `LIVE.frame.lapn + 1`; the course pill / hero event chip shows raw `LAP 0` | New `lapNo(frame)` (1-based) used everywhere. |
| 4-row sortable table | full list of turns | Table component shared with §6. |

### 2.5 GENERAL STATISTICS view (spec §6) — `courseStatsHTML()`, tab key `"stats"`

- Today: per-class groups of builds (`bid || container`), best lap per build, totals over **all** laps.
- Spec: follows the scoped class; per **car** (ordinal from `cid`), most used + quickest, scatter
  (x laps, y best), 4-row car table, basis header that never states a total over rows that sum to less.
- Route 5411 data: 45 laps, all with class, `cid` and a trace; 11 cars. Tune (`container`) only on 25 —
  "laps per tune" must say `20 laps name no tune`, never drop them.

### 2.6 Build panel (spec §7)

Outside the two tabs but on the same screen. Partly started: `6ab46f1` added the persistent guaranteed
tune-ID workflow to the build-sheet header. The three distinct faces (downloaded / tie / held) and HELD as
a whole-identity state are not built.

---

## 3. What the data already supplies (spec §8, checked against `dashboard/v2/api/course/route_5411.json`)

| §8 # | Spec assumed | Actually present |
|---|---|---|
| 1 | phase spans approximated ±45 m | **present** — `turns[].seg` polylines from the DB's 80%-of-peak windows (`build_web.py _phase_geom`) |
| 2 | per-phase seconds scaled | **present** — `phaseObs[phase][i][5]` `time_s` per lap per phase (straight has no live obs) |
| 3 | trace `s` on a different origin | **still a gap** for point-to-point routes: traces are re-anchored to a common arc only for loops (`build_web.py` ~317–377). Route 5411 is P2P: the fastest trace ends at arc 2152 m, `len` is 2720, `route.length_m` is 3084.4 |
| 4 | per-lap save/tune attribution missing | **partial** — `laps[].container` (tune) on 25 of 45 laps; 20 carry none. `bid` (build) and `cid` on all 45 |
| 5 | class + tune not on lap lines | class on all 45 (S1 19 · B 10 · A 7 · C 6 · S2 2 · D 1, 11 cars); tune as row 4 |
| 6 | per-lap minima only for traced laps | **present for every lap** — `phaseObs[..][2]` `min_mph` |
| 7 | road width / banking omitted | **present** — `turns[].width`, `turns[].bank` |
| 8 | class counts from a capture | derive from `laps[]` |

**Real gaps to close in `scripts/db/build_web.py` (step 1):**
- per-course `built_at` and the `sid` set counted, so the view can say "history built 10:44 · this
  session: N laps not yet counted" (compare the live session id against the set).
- P2P trace arc registration onto the route centre-line (§8.3).

---

## 3b. Reading the design source — what overrides it

Full extraction: `docs/course-mode-v2-design-extract.md`. The canvas is **one** 1080 × 1751 artboard; the
tabs and the build-guard / held / mismatch states are props on it, not separate boards.

- **Band order** (flex `order`, not source order): status strip 20 · nav 24 · HELD/BUILD split ≥152 ·
  course identity + laps by class 78 · speed trace 405 · SCOPE 78 · two-pane body (left 452 px) · footer 30.
  Matches the handoff (car above course, SCOPE under the trace).
- **Grip colours: D1 overrides the canvas.** The canvas still paints trace/trail/ribbon lines with the old
  `TRACE_GRIP` (`#00d27a #4ea3ff #f0616d #c678dd`) and uses `GRIP` only for chrome. Build every grip line
  through `gripInk()` / `DGRIP`, including the turn-window driven line and the speed ribbon.
- **Speed paint:** the canvas's `SPEED_RAMP` (5 stops) differs from the shipped `GRAD` (6 stops) that the
  map trail and trace use since `6d43d5c`. Keep one ramp; pick at build time and change both together.
- **Right-pane tabs:** the canvas has three — Current lap · One turn · General statistics. Shipped has five
  (Current lap · Live corners · Turn analysis · General statistics · Conclusions). One turn is the next
  design pass; what happens to Live corners and Conclusions is **not decided** — keep them until it is.
- **Prototype artefacts, not rules:** the canvas ranks a turn's *median-index* pass as "current" (to avoid
  a best-by-construction demo); production ranks the pass actually driven. The abandoned-attempt row is
  static markup — production templates it from live corners grouped by stint id.
- **Camera (matches the handoff):** tick 45 ms, +0.25 sample per tick, pan k 0.12, zoom kz 0.07, centre
  0.45 bbox + 0.55 car, span `max(dx, dz·aspect, 110) × 1.3`, subject = first turn whose straight end is
  ahead, previous turn faded to 0.2 within 70 m. Production drives it from real frames (`LIVE.lap`), not a
  timer, and only while the lap is live (Q1).
- **S1 purple vs drift violet** (flagged by the extract) is already handled for lines by the ΔE guard in
  `gripInk()`; the S1 *badge* stays its class colour.

## 4. Build order

1. **Foundations (no visual change):** `scopeToken(ls)`; `courseStatsHTML` onto `activeLapSet()`;
   `lapNo()`; `rankVerdict(values, mine, ls)` returning `{rank, of, scopeTok, conf: strong|thin|only|level|empty}`;
   rate live turns on `mph_min`; `build_web.py` `built_at` + sid set; verify stint id on live corners.
2. **SCOPE band** replacing `#coursefilter` content; PAINT control moves in; mismatch state.
3. **Current lap view:** turn window + 4-row rank table + abandoned-attempt rows.
4. **General statistics view:** header basis, two headline answers, scatter, car table.
5. **Shared chrome:** map layer order + legend bar; hero freshness + class bars; build panel faces.
6. **FOLLOW camera** — active only while `LIVE.lap.live` (Q1); reads `LIVE.lap` for the trail and the car.

Each step ends with the spec's §9 checks that apply to it, verified in the Browser pane at 1080 × 1751
with synthetic frames on route 5411 (the harness used for the live-lap map: close the tab's `ES`, stub
`locateCourse`, `enterTempCourse(5411)`, feed a recorded trace through `onFrame` with `LIVE.lapT = 0`).
