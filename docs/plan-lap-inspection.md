# Plan — lap inspection: a mini lap panel, hover-to-select, and X-axis speed-trace zoom

*2026-09-18. Requested by Jett. The course-mode surfaces answer "what is this COURSE" (the course info panel,
the map, the turn analysis). Nothing answers "what is THIS ONE LAP" as a first-class, always-visible surface —
you can foreground a lap, but its identity and numbers are scattered. This feature adds a lap-side mirror of the
course info panel, makes hovering any trace select a lap into it, and lets you zoom the speed trace along the
lap (X only) to read closely-spaced laps apart.*

## The three coupled pieces

They share ONE selection (`SELECTED_LAP`) so the map, the speed trace, the LAPS list and the new panel all point
at the same lap. Build order is (1) → (2) → (3); each is independently verifiable.

### 1. The mini lap info panel — the lap-side mirror of the course info panel

- **What it is.** The structural twin of `courseHeroParts()` (the course info panel: LENGTH / MEDIAN / BEST /
  turns / laps + the class rail). Where that panel is "everything about this COURSE," the lap panel is
  "everything about THIS LAP." Placed **directly across from** the course info panel in the portrait layout.
- **Content (lead with the answer):**
  - **identity** — the build's `class·PI` badge + car + tune name (reuse the `buildPill` design language,
    `docs/design-build-identity-pill.md`), so a lap reads the same as the car everywhere else.
  - **time + delta** — the lap's `lapTime()` and its gap to the course best (green ahead / red behind), the one
    number that matters most.
  - **honesty flags** — clean / void(contact) / rewound / coverage, using the same vocabulary as `cleanLap()`
    and the LAPS list (`lb-dirty`), so a dirty lap can never be mistaken for a clean benchmark.
  - **per-turn line** — a compact strip of this lap's apex mph / peak lat-g at each turn (from the lap's own
    trace points, the same data the turn analysis pane already reads), so the panel says HOW the lap was driven,
    not just its time.
- **State.** One module-global selection. Reuse `SINGLE_LAP` where possible (it already isolates a lap on the
  map + drives the Single-lap surface via `selectSingleLap()`); the mini panel renders from that same id, so
  "the selected lap" is one concept, not three.
- **Empty state.** No lap selected → a prompt ("hover a trace or pick a lap") rather than a blank box, matching
  the project's "show the region at rest" doctrine.

### 2. Hover-to-select — mousing a trace selects that lap

- **Signal.** Each lap's trace line already carries its lap id on the course map (`.cmap-lap[data-lap]`). Give
  the **speed-trace** lines the same `data-lap` group wrapper, then on pointer-move hit-test the nearest line
  under the cursor (distance-to-polyline, cheap) → set the selection → `selectSingleLap(id)`.
- **Effect.** Selecting drives everything at once (the existing `selectSingleLap` already moves the map + Single
  lap; extend it to also fill the mini panel and foreground the line on the speed trace). Hover is transient;
  a **click** pins it (so moving the mouse away doesn't lose the pick), mirroring the LAPS-row click.
- **Reuse.** `wireTrace()` already does point-hover on the trace (reads the sample, marks the map). This extends
  that handler; it does not add a second hover system.

### 3. Speed-trace X-axis zoom — read closely-spaced laps apart

- **X only.** The horizontal axis is distance (a course lap) or time (free roam); the vertical axis is speed and
  must NOT rescale — a zoom that squashed the speed axis would make the shape lie. So this is an `x0..x1` window
  (a fraction of the lap), NOT a raw SVG viewBox zoom (which would scale Y and the turn-tick labels too).
- **Mechanism.** The trace re-renders through `chart(W,H,...)`'s `px()`; feed it the `x0..x1` window so that
  window maps to `0..W`. Wheel = zoom the window around the cursor's fractional position; drag = pan it; the
  T-number ticks and the turn band re-space with the window. A "fit" reset mirrors the map's `mapfit` button and
  the manual-hold pattern (`CMAPVIEW.manual`) so a live repaint never eases the window back.
- **Interaction with hover.** At deep X-zoom the lines are further apart, so hover-to-select (2) becomes the
  precise way to pick one of many overlapping laps — the two features are designed to be used together.

## Files (anticipated)

- `dashboard/v2/panel.js` — `SELECTED_LAP`/reuse `SINGLE_LAP`; `lapInfoHTML()` (the mini panel, sibling of
  `courseHeroParts`); the trace-line `data-lap` wrapper + hover hit-test in `wireTrace`/`liveRun`/`courseTrace`;
  the X-window state + wheel/drag handlers on the trace; `paintLapInfo()`.
- `dashboard/v2/app.js` — if the panel is rendered on the app.js side alongside `courseHeroParts`.
- `dashboard/v2/styles.css` — the panel's layout (twin of the course info panel) + the trace-zoom "fit" button.
- `dashboard/v2/index.html` — the panel's DOM slot, across from the course info panel.

## Design-language rules to honour

- CLASS is always the `.pib` badge; the lap identity reuses `buildPill`/`classPill`, never a bespoke chip
  ([[fh6-turn-design-language]]).
- The lap's honesty flags use the SAME `cleanLap()` vocabulary and the lap-canon (`official` counts a rewound
  lap) as the LAPS list and the racing filter — one definition of "clean," not a second.
- Selection is ONE concept: the map, the speed trace, the LAPS list and this panel move together
  (`selectSingleLap` is the single entry point, as established 2026-09-18).
- Y (speed) never rescales on the trace zoom; the vertical scale is the course's fixed speed range so two views
  of one lap agree ([[fh6-turn-design-language]], the `courseSpeedRange` note).

## Verification

1. Panel: select a lap (LAPS row) → the mini panel shows its identity, time+delta, flags, per-turn line;
   deselect → empty prompt.
2. Hover: mouse a trace line → that lap fills the panel and foregrounds on map + trace; click → it pins.
3. Zoom: wheel over the trace zooms X only (speed axis unchanged, ticks re-space); drag pans; fit resets; a live
   repaint holds the window.
4. Console clean; the existing point-hover readout and the map's own pick still work.
