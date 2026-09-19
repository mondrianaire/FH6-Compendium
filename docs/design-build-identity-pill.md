# Build-identity pill — design spec

*Status: DESIGN (not yet built). Requested by Jett 2026-09-18. A dedicated build follows; coordinate with the
parallel session currently editing `dashboard/v2/panel.js`.*

## Purpose

One consistent, reusable visual **plug/pill** that communicates the identity of a build+tune — **not just its
PI** — so the "current filter / current build" reads the same everywhere in the project. It represents the car
(manufacturer, model, year), its class, and **any filters currently selected in the SCOPE pane**. Wherever the
app shows "what am I looking at right now," it shows this one box.

This is the visible face of the scope-pane-as-single-source-of-truth work (commit `04bedbe`): the SCOPE pane is
the filter authority, and this pill is how that selection is communicated as a single, recognizable identifier.

## What it contains

Left → right:

1. **Class · PI badge** — the established `.pib` class badge (colour = `piColor(class)`) carrying the PI number,
   e.g. `S2·841`. This is the ONE class vocabulary already used in hero / leaderboard / stats ([[fh6-turn-design-language]]),
   extended to also show PI. Never a bespoke class chip.
2. **Car identity** — `YEAR · MAKE · MODEL`, e.g. `2018 · Exomotive · Exocet Sport V8 XP-5`.
3. **Scope-filter chips** — one small chip per SCOPE dimension that is actually narrowing the set (drive / tune /
   build / traffic / racing). When nothing beyond the car narrows it, show the preset token instead
   (`ALL·30`, `CLASS A·11`). This is the "any other filters selected in the SCOPE pane" part.

Example, fully filtered:
```
[ S2·841 ]  2018 · Exomotive · Exocet Sport V8 XP-5   · RWD · tune "Hokubu 54.5" · build C · rivals
```
Example, no narrowing:
```
[ S1·773 ]  2021 · McLaren · 620R   · ALL·30
```

## Data sources (all present today)

- `dashboard/v2/api/cars.json` rows already carry structured `ordinal, name, make, model, year, class, pi, dt,
  cyl, cc, asp, gears` (verified live). **CARMAP** (`panel.js:238`) currently keeps only `{name, short}` — extend
  it to also cache `make, model, year, class, pi, dt` so the pill composes without re-fetching.
- Scope selection: `activeLapSet()` (`panel.js:3853`) → `{label, token, cls, n}`; the active dimension filters are
  `traceSel(COURSE).filters` over `TRACE_DIMS` (`class, dt, container→tune, solo→traffic, bid→build`), rendered
  with the existing `dimLab(dim, val)`. `RACING_ONLY` adds the `racing` chip.
- Class colour: `piColor(class)`; badge: reuse/extend `classPill(cls, n)` (`panel.js:2113`).

## API (proposed)

```js
// cid = "ordinal|dt|cyl|pi"; opts.compact = dense-cell variant; opts.scope = include the SCOPE filter chips
// (default true in the scope pane / laps header, false in per-lap rows where the row already carries the car).
function buildPill(cid, opts) → HTML string
```

- **full** (default): class·PI badge + `year · make · model` + scope chips.
- **compact**: class·PI badge + `make model` (shed year, `shedName`), no scope chips — for leaderboard/table cells.
- Colour: class-tinted left edge (`piColor`), mono type for identifiers, matching `.pib` / `.coursefilter` styling.

## Placement / rollout

1. **SCOPE pane** (`#coursefilter`, `paintCourseFilter` `panel.js:1038`) — the primary home: the pill IS the
   "current filter" representation. (The scope pane already visually stands out per `04bedbe`.)
2. **LAPS panel header** — replace the raw `lb-scope-tok` token with the pill (the read-only mirror becomes the
   pill). `lapBrowserHTML` (`panel.js:4702`).
3. **Header id-bar / `courseInfoPill` neighbourhood** — the current-car identity.
4. **Leaderboard / turn-analysis rows** — compact variant in place of the ad-hoc `classPill + carShort`.
5. **Build sheet header, A/B compare** (later) — the two builds being compared each get a pill.

## Design-language rules

- Class is ALWAYS the `.pib` badge (colour = `piColor` = the `.pib-<class>` palette). Never a grey chip.
- One function, one look: every surface calls `buildPill()`; no surface hand-rolls a car+class label again.
- Compact vs full is the only variance; both are the same component.
- Honours light/dark via the existing CSS tokens; no literal colours outside the class palette.

## Notes / coordination

- Another session landed **offline profile decrypt** (`fh6_local_decrypt`) + **auto-read on equip/save** (commits
  `d770476`, `85a01ea`, `8c70ebf`) and a Single-lap surface change (`b628cfd`) — all touching `panel.js`/daemon.
  Build the pill against the latest `panel.js`, and prefer additive helpers to reduce merge risk.
- The pill supersedes nothing structurally — it's a presentation layer over data + selection that already exist.
