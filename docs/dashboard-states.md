# Dashboard v2 — workflow states and pane layout

The Dashboard is one fixed-height instrument panel. It never scrolls; each pane fills its cell and
clips. What is on screen IS the current stage. This document is the source of truth for which
regions exist and what fills them in every reachable state.

*Reconciled against the code on 2026-09-08 (ui v145). Where this file and the code disagree, the
code is right and this file is a bug.*

## 0. The Dashboard is one of six views

`app.js` routes on the hash across six top-level views — **Dashboard · Overview · Cars · Builds ·
Courses · Evidence**. Only the Dashboard gets `body.fixed`: it is the instrument panel described
below, sized to the viewport and clipped. Every other view is a **document** that scrolls normally.
The nav and the `ui v<N> · built <ts>` stamp sit above all of them, so two people looking at two
renders can settle which build they are arguing about.

## 1. The regions

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ LAST-ACTION  20px, flush to the top of the viewport, nothing above it: what the   │
│              lab last did (importing · re-reading · new save read · db up to date)│
├──────────────────────────────────────────────────────────────────────────────────┤
│ TICKER   24px. The alert STREAM lives here, not in a panel.                       │
├──────────────────────────────────────────────────────────────────────────────────┤
│ STATUS   one line: what the lab last did (left, click for the status history      │
│          dropdown) + a dot per service (right):                                   │
│          telemetry <pps> · save <read> · database <HH:MM> · auto-reload <on> ·    │
│          sessions <caught up | N unimported>                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ HEADER  224px, TWO columns: [ identity 470 ] [ evidence 1fr ]                     │
│  identity: PI badge · 🔒/caption · change chip                                    │
│            CAR  (make model year, small)                                          │
│            TUNE TITLE  (the SAVE's own name, large — never the car's)             │
│            verdict line, when the identity is contradicted                        │
│            GATE STRIP: [ state · detail ] → [ ONE action ] [ BUILD SHEET ]        │
│  evidence: the hardware→tune hash table (upgrade hashes, tunes under each)        │
│            one evidence line: how this identity was settled                       │
│  behind:   the save's own render, washed across the band at 17%                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ALERTS   only what still needs a DECISION — in practice the which-save picker     │
│          when saves tie. Empty and hidden otherwise. (The stream is the ticker.)  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ TRACE    240px. On a known course every lap on record; WHICH laps = preset vs the │
│          car you are in (all · this class · this car · this build · same hardware │
│          [rim rule] · this tune), then dimension filters, then lap chips (click   │
│          to hide). A timed event on a known course selects "this class" itself.   │
│          Your lap painted by grip/speed, fastest green, partial/void dashed and   │
│          struck, turns ticked by id, impacts marked, hover marks the map.         │
│          Off a course: the live run, painted by grip. Holds in a menu.            │
├───────────────────────────────┬──────────────────────────────────────────────────┤
│ LEFT PANE — the map           │ RIGHT PANE — tabbed, follows the context         │
│ FREE:   world map, every game │ FREE:   Live corners · General statistics ·      │
│         route, YOUR driven    │         Course Browser · Services                │
│         courses COLOURED BY   │ COURSE: Live corners · Turn analysis ·           │
│         COURSE TYPE           │         General statistics · Conclusions ·       │
│ COURSE: course map: centre-   │         Services                                 │
│         line + driven line +  │                                                  │
│         lit turns + live dot  │                                                  │
├───────────────────────────────┴──────────────────────────────────────────────────┤
│ DOCK     LIVE · value tiles (mph gear rpm lat/long g yaw hp tq boost · inputs ·   │
│          suspension travel · mode) · time trace: grip state per second, speed     │
│          line, every identified corner ▲ coloured by balance · 2/10/30 min spans  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FOOTER   mode (free / course / decode) · why · baseline: <name or none> ·         │
│          data coverage meter: samples held vs samples required for this mode      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

DOM order is `#hdr · #alerts · #trace · .panes · #dock · #ftr`, with `#lastact` and `.ticker`
outside the panel grid. **Alerts sit ABOVE the trace**, not below it.

### The header is an identity band, not a spec sheet
The header answers one question — *which build is this, and how sure are we* — and offers exactly
one action toward resolving it. It does **not** carry the engine/mass/gears spec rows any more;
those live in the BUILD SHEET, which is where someone reading a spec is going anyway.

* **The tune title is the SAVE's own name.** Every `Tuning_*` container carries length-prefixed
  UTF-16LE strings in its `header` — name, optional description, creator — and the daemon returns
  them as `tune_name` / `tune_desc` / `creator`. Measured over the corpus (2026-09-08): 663
  containers, **662 (99.8%) yield a usable name + creator**. Before this the header fell back to
  `disk.name`, which is the CAR's name from `names.json`, and printed the car twice on any car the
  database did not yet hold.
* **`resolutionState()`** reduces the whole picture to one of: `none · ambiguous · unsaved ·
  resolved`, with the count of distinct hardware hashes the cid matches and the slider hashes under
  them.
* **`gateStrip()`** turns that into the strip: the identity we have, an arrow whose weight reflects
  confidence, the single action that raises it, and the BUILD SHEET button (`filled` when the sheet
  unlocks something, `outline` when it is merely available, `dead` with a reason when it is not).

### The build sheet keeps the v1 identity
The rows and sliders are the v1 "TAKE TO GAME" surface (2026-08-22, unified on the daemon's
`deliverable` 08-27): menus in the game's own order, named levels with Street/Sport/Race pips,
PI-cost chips, engine sub-lines; tuning tabs with sections, absolute values + units, a slider
track with knob and pole labels. It is fed by the same `deliverable` the panel fetches with the
disk tune; the database adds only what that surface never had — the tile's position in the shop
grid, and the checklist. With no save on disk it falls back to the database's slot walk and says
so. The sheet is floating, draggable, pinnable, minimisable, position remembered.

### One instrument, not six cards
No rounded corners, no gaps between regions, no floating panels. Bands are divided by a single
1px rule and butt against each other, edge to edge. The surface should read as an instrument panel
that spends every pixel on a fact — which is what the project claims to be.

### The last-action line, the ticker, and the status strip are three different things
* **Last action** (20px, top of viewport): what the lab last DID. Never grows, never wraps.
* **Ticker** (24px): the alert STREAM. Alerts used to accumulate in a panel that had to be sized
  for its worst case; they now flow through the ticker and `#alerts` keeps only what needs a
  decision.
* **Status strip**: one line pairing what the lab last did with whether it is still connected —
  a dot per service, each naming ITSELF and its state, because a bare coloured dot was unreadable
  on a coloured band. Clicking it opens a **status history** dropdown: a persisted, deduped record
  of every status transition with its time, so "database up to date" carries *when*.

### Live updates pause for a menu, and resume the instant you're back
A menu frame (`IsRaceOn=0` — any menu, including a fast-travel loading screen) carries nothing
worth watching: CarOrdinal, CarPI and position all degrade to 0 on that same frame. Treating menu
dwell as an active data window (the dashboard used to re-poll the save every 4 s while one was
open) was itself the bug — the rigorous signal is the daemon's own re-read on the way OUT of a
menu (`fh6-menu-frames-are-dead-time`). `onFrame` debounces the on/off edge (350 ms — a loading
screen can blip) and, once a menu is committed, PAUSES: the dock tiles and the live trace hold at
their last on-track state instead of repainting from zeroed values, and no reread polls run during
the dwell. One repaint lands on each committed edge; the churn in between is what stops.

## 1a. The world map

**Course traces are coloured by course type.** Each driven course is its own `<g>` tinted by its
route's discipline from `world.json` — road · street · dirt · cross-country · playground · drag ·
showcase · rush. A course that has **not** reconciled to a catalogued route stays a dim neutral:
the colour asserts an identified type, so an unidentified trace must not make that claim. The
legend is generated from what is actually on the map, not hard-coded.

**Hover previews, click commits.** Mousing a trace highlights the matching Course Browser tile;
mousing a tile highlights the trace. Neither selects. Hover never writes `BROWSE_PICK`, never
touches the view store and never moves the map's target, so letting go leaves the view exactly as
it was; only a click goes through `browsePick()`. Every trace carries a transparent 10px hit-line
so a one-pixel road is still hoverable at island zoom.

**The window is animated, the content is drawn once.** The SVG is rendered full-island at
centi-unit precision (~0.2 m) and the DISPLAYED window is the viewBox, eased toward a target: the
whole island by default, a picked course's bounding box when the browser has a selection. Wheel
zooms and drag pans; ~0.9 s after release it glides back to the target. Background routes are
drawn from a strided `_lo` path to keep the animation cheap; the focus route is dense.

**The two off-map circuits are ignored entirely.** Routes 102 and 103 are complete circuits parked
8–11 km beyond the north coast, outside the nav mesh, road-class 0 in every record — cut or
developer test content. `routeSplit()` separates them out so nothing draws them, fits to them, or
counts them. *There is no toggle* (Jett 2026-09-07); an earlier revision of this file said there
was.

### The map drawer: legend and filters, floated off the map
The colour key and filter buttons live in one `☰ legend & filters` drawer, closed by default and
remembered per browser. On a course the same drawer also carries the trace's preset chips and
dimension filters, reading and writing the identical per-course `vc` view-store object the trace
pane uses — filter from either pane and both redraw.

### The map follows, like a satnav — DEFERRED to course optimisation
**Status: built, off by default, opt-in from the legend.** Adaptive zoom is right for a driver
working on line and timing on a track they know, and wrong while a car is being built and tested,
where the map's job is orientation. Reserved for a future COURSE OPTIMISATION mode. The mechanism
stays in place: lateral g over 0.55, under 45 mph, or within 90 m of a mapped turn gives a ~180 m
window; the middle band ~420 m; a straight pulls back to 900 m, or 1600 m over 130 mph. Bands
overlap so it cannot flap.

## 1b. The Course Browser

A tab in the right pane listing the game's catalogued routes as tiles — name, length, loop/P2P,
laps held, the classes it is offered in (solid = we hold laps, hollow = offered only), and
race/rivals/career/discipline badges. Picking one highlights it on the map and glides the map to
it; picking it again releases.

**Filter chips**: All · Rivals · Race · Career · Free-roam, each carrying its own count.

**Not every catalogued route is a place.** Two kinds are hidden by default behind a `show dev N`
chip, both identified from the game's own data rather than a hand-written list:
* the game's five `IE …` drive sections (intro-experience/dev content, all flagged
  `use_cross_country_ai` in `ref_track_info`);
* any route known only by a NUMBER — no catalogue name at all, on the list purely because we drove
  over its geometry once.

Hidden, never dropped: *superfluous* is a judgement about screen space, not about the data. With
them hidden the list is 102 tiles; showing them gives 107.

## 1c. Background services

The lab is three processes and the dashboard can now see and drive all of them, from a **Services**
tab present in BOTH modes — which processes are up is never a per-course question, and the moment
you need the buttons is the moment something is down and the rest of the page is empty.

| service | port | what |
|---|---:|---|
| daemon | 8765 | telemetry daemon (UDP 9876 → 8765) |
| dashboard | 8000 | dashboard server — serves this page |
| rebuild | 8001 | import + regenerate service — hosts these controls |

`GET /services` reports each one's up/pid; `POST /service {name, action}` does start · stop ·
restart. The controls live in the rebuild service because it is the one that is neither the daemon
nor the page server, so it can restart either without cutting the branch it sits on. The service
definitions mirror `scripts/lab_up.ps1` exactly — same interpreter, args, working directory, log
files — so a service started from the dashboard is indistinguishable from a launcher-started one,
and the `lab_root` guard still applies. Two refusals on purpose:

* **the rebuild service will not stop itself** (HTTP 409) — it hosts the buttons, so stopping it
  would leave nothing to start anything again; its own restart goes through a detached relauncher
  that waits for 8001 to free. `lab_up.ps1` is the way back from a full stop.
* **stopping or restarting the dashboard asks first**, because it serves the page doing the asking.

### No scrollbars, ever
**Hard rule (Jett, 2026-09-03): the Dashboard has zero scrollbars.** A list that cannot fit its
cell does not scroll: it shows what fits and says "+N more — not shown, the cell is full"
(`fitRows`), and the trace's lap chips do the same sideways (`fitChips`). Regions clip. The
floating BUILD SHEET is a separate surface reproducing the game's own screens and keeps the game's
scrolling. *This rule binds the Dashboard only* — the other five views are documents and scroll.

### Concrete cells
Every region has a fixed size: header **224 px** (`470px | 1fr`), alerts 96 px (hidden when empty),
trace 240 px, dock and footer sized to content; the two panes take what is left. Values populate
the cells and are clipped with an ellipsis when they overflow. A region never resizes with its
content.

### Blocks, not pills
Status and chips are square-cornered solid blocks in heavy uppercase type, the game's own badge
language. Sliders the daemon knows only by position read as absolute values from the database's
ranges, tagged `db`.

### The screen is portrait
The Dashboard's home is a 4K portrait monitor at 200%: a **1080 × 1920 CSS-px** viewport. In
portrait the two panes stack (map above, analysis below); landscape keeps them side by side.
Verify layout at 1080 × 1920, not at a landscape frame.

### The database follows the saves
The database is a snapshot; a new save leaves it behind. Import + regeneration run **by themselves
when a re-read finds a save the database does not hold**, and on demand from IMPORT + REGENERATE.
The trigger is a new save file, never a menu return. Since 2026-09-06 **the daemon fires the import
itself** on a save, so a tune downloaded and applied with no dashboard open no longer sits
unimported. Scopes: `containers` (a save → parts/sliders/gears/packages, then `build_web.py`) and
`telemetry` (a session close → sessions/courses/laps/traces, cascading to course_match, route_names,
corners, diagnosis). `build_web` is deliberately NOT in the telemetry scope — it rewrites ~776 api
files over ~20 s and a session close fires every few minutes in menus.

### Live reload: the backend tells the page
The rebuild service serves `GET /watch` (Server-Sent Events). It polls the dashboard's own files
once a second and pushes `code` when any change (the `?v=` bump in index.html is how a code change
is announced) and `data` the moment a rebuild finishes or `api/identity.json` is rewritten. The
page reloads on `code` and re-reads identity, world, diagnosis and the car on `data`. Nothing in
the browser polls.

### The ratification ladder is bounded, and the order is the game's
At most three manual steps, plus one the lab does itself: (1) clone onto a second copy of the car —
locked/downloaded tunes only; (2) save the clone with a name; (3) import + regenerate, automatic on
any save the database does not hold; (4) say which save is fitted — only when saves tie on
cylinders, drivetrain and PI, and only when the gear ladder cannot separate them.

**Order matters, because the menus gate each other** (spec §9.1, §10.7): the aspiration conversion
must be installed before its forced-induction tier exists in the Engine list; an engine or
drivetrain swap changes which part sets exist at all; a body kit removes the Front Bumper tile, so
front aero comes first; a transmission, differential or spring kit REWRITES its sliders on install,
so every hardware step precedes every slider step.

## 2. Modes

Mode comes from the daemon's `mode` event (`suggest`: free | course | decode, with `reason`),
sticky through menus so a pause mid-Rivals does not flap. Course mode is entered by a timed event
or by lapping a marked reference loop; everything else is free. Decode mode keeps the course layout
and swaps the right pane to the clone verify view.

| | FREE | COURSE |
|---|---|---|
| left pane | world map fitted to the island: every reachable route centre-line, your driven courses coloured by course type, live car dot | course map: centre-line + driven line + lit turns + live dot |
| right pane | Live corners · General statistics · Course Browser · Services | Live corners · Turn analysis · General statistics · Conclusions · Services |
| sample threshold | high — free driving is not race pace | low — every turn encounter is relevant |
| recommendations | world-wide, from `v_diag_by_setup` filtered to atomically-equal builds | course-specific, from `v_diag_by_turn` for this route |

### The start/finish line names the map
In a timed event the course is **not a question**. The daemon crosses the S/F at event start and
matches that point to a route START (`_match_route_name`) — one route per start, so it is
unambiguous, unlike a whole-path position match. It arrives as the `loop` SSE event and
`adoptLoop()` takes it as the authoritative identity for the event, resolving to a learned course
(with laps) by name when we have one, else the catalogued route. Position matching
(`locateCourse` / `locateRouteInEvent`) is only the fallback for free roam and roads with no S/F
crossing, and `locateCourse` returns early while a `LOOP` is held.

`locateCourse` measures to a course's **line** (point-to-segment), not its vertices: the world path
is a decimated centre-line sitting ~415 m between points on The Goliath, so the nearest VERTEX
could be 87 m away mid-course while the car was 2 m from the road.

### A reload is a re-query, not a reset
Every value on screen is either re-derived from its store (`api/*.json`, the daemon's snapshot) or,
when it is the user's own choice, read back from ONE view store (`localStorage.fh6view`, versioned)
keyed by the context that owns it: the car (ordinal: pin, baseline, dismissals, last live PI, the
previous fingerprint and the change it produced), the course (key: trace preset with an `auto`
flag, filters, hidden laps, pinned right tab), the build (hardware hash: the sheet checklist) or
the page (dock span, paint mode, browse pick, browse filter, **show-dev toggle**, sheet position
and open state). `sessionStorage.fh6ctx` seeds the live context with a freshness gate and is shown
as **held** until a frame confirms it. MODE has a third state — unknown until the daemon speaks —
so a reload never asserts free roam.

### The right pane follows the context
| context | default tab | why |
|---|---|---|
| in a menu, or no frames yet | **General statistics** | a menu is dead time; the world-wide ranking is the thing that is still true |
| driving, free roam | **Live corners** | every corner as taken: in→apex→out, lat g, braking point, balance verdict, first axle over the limit |
| on a course | **Turn analysis** | one row per course turn, this session |
| on a course with a baseline set | **Conclusions** | this course's turns, ranked, with the change attached |

A click on a tab pins it until the context class changes.

**Build data is disabled** (2026-09-03, Jett: "does not seem immediately useful to me"). It is NOT
deleted — `RT_LABEL.build` and `buildDataHTML()` are intact, it is simply not in the list
`rightTabs()` returns. Add `"build"` back to that array to re-enable it.

## 3. Build status — the inflection point

Five observable variables decide the status. Everything else is derived.

| variable | source | note |
|---|---|---|
| `hw_match` | live parts (from the fitted save) vs `identity.json`, **rim-tolerant** | see §4 |
| `tune_match` | slider fingerprint vs the same set | only knowable from a save |
| `in_db` | a matching container exists in our database | not the same as on disk |
| `locked` | the fitted save's lock flag | downloaded = locked |
| `saved` | the live car agrees with a save on disk | inferred: no PI drift, cyl/PI agree, daemon pick not held |

`buildStatus()` tests in this order, and **the order is the contract**:

| # | key | label | when |
|---|---|---|---|
| 1 | `none` | no car | no frame yet |
| 2 | `offline` | save not read | **the daemon could not be reached** |
| 3 | `unknown` | unknown / unsaved | no save on disk for this car |
| 4 | `unknown` | unknown / unsaved | live PI drifts from the identified save — hardware changed, unsaved |
| 5 | `unknown` | new build on disk **/** identified · importing for history | a save the database does not hold yet |
| 6 | `downloaded` | downloaded / locked | someone else's build |
| 7 | `variation` | variation | same hardware, different sliders — an A/B in progress |
| 8 | `clone` | unsaved clone | matches a LOCKED build, but this copy is unlocked and unsaved |
| 9 | `ratified` | ratified | your own saved, unlocked build |

**Transport is tested before the build.** A failed `/disk-tune` fetch sets `diskErr` AND leaves
`CUR.disk` null, so while the `offline` test sat below `!disk` it could never fire: an unreachable
daemon reported *"no save on disk for this car"* — a claim about the save file, made when nothing
about the save file was known. `offline` is a precondition like `no car`, not one of the build
statuses in the table above, which is why it is tested with them and not among them.

**Ambiguity outranks every status.** If the identity is ambiguous or contradicted, `headerCopy()`
overrides the headline: which build is on the car outranks what kind of build it is.

**A re-pick is not a change.** `CHANGE` is set only when the identified save's exact
(hardware+slider) match is empty. `identify()` runs on every car change, park, menu return and
re-read, and the daemon's identity flip-flops between a car's held builds — each flip hands over a
different save's parts, so a naive comparison fired "hardware changed" though nothing was touched.

### What is NOT observable, and must be said on screen rather than papered over
* The live packet carries only ordinal, drivetrain, cylinder count and PI. Two builds that agree on
  all four are indistinguishable at a standstill. The daemon breaks ties by watching the gearbox;
  until then the status is ambiguous and the which-save picker is shown.
* **Unsaved slider changes are invisible.** Sliders exist only in save files; telemetry never
  reports them. A slider-only change is detected the moment it is SAVED, never before. A hardware
  change is detected before saving, because it moves PI.
* **An ordinal is a car TYPE, not an instance.** Two owned copies of one model, identically built,
  are indistinguishable in every readable source. Livery association is the nearest proxy, and it
  is a proxy, not an id.

## 4. Atomic similarity — the rim rule

Two builds are the SAME hardware when every one of the 50 part slots agrees **except the two rim
slots, provided the rims agree in `mass_level`** (0 heaviest … 4 lightest). Rims differ only by
weight class; the game's own wheel table proves the rest is cosmetic. So the hardware fingerprint
used for `hw_match` is the 48 non-rim slots plus the two rims' mass levels, not their ids.

## 5. Testing baseline

* Only a **ratified** build can be set as the baseline.
* Setting it records `{container, hw_hash, setup_hash, set_utc}` and pins the which-save picker.
* The footer coverage meter then reads samples held for this baseline against the threshold for the
  current mode. Until the threshold is met the conclusions pane says how many more laps or minutes
  are needed rather than showing a recommendation.

## 6. Lap canon

**HARD RULE (2026-09-06): the game's own lap metadata is canon.** `CurrentLap` / `LapNumber` /
`LastLap` decide where a lap begins and ends. A rewind is a lap-clock REVERSAL and the lap is cut
at the landing lap clock; the race clock and the odometer are never axes; free-roam rewinds do not
matter. `lap` carries `rewinds`, `pauses`, `pause_s` and `stitched` so a lap's completeness is
legible: coverage (`arc_m ÷ route length`) on one axis, continuity (rewinds + pauses + stitched) on
the other. A lap that is complete and continuous is what the speed trace and the map traces want; a
fragment is still useful for turn data.

## 7. Failure modes and their chartable variables (item 5/7 audit, to be filled)

Each symptom in `ref_symptom` must name the telemetry variables that move when it is present, so
the A/B overlay can chart the variable and not the label.

| symptom | chartable variables | threshold for "normal" |
|---|---|---|
| Bottoming out | suspension travel per wheel (gate 0.98), rate per minute | build-level, not a fixed "normal": measured 0–98 events/session across 9 captures (~13/10 min mean); a smooth build logs zero. Rate should vary — do not anchor a threshold here |
| Understeer entry / mid / exit | front slip angle, lateral g, speed at apex | — |
| Oversteer entry / exit | rear slip, yaw rate, throttle at the moment | — |
| Unstable under braking | rear deficit, lock flag, decel g | — |
| Floaty after crests | vertical g, settle time | — |
| Wanders at top speed | yaw pulse amplitude at speed | — |

Multiple failure modes will coexist. They are ranked by confidence × frequency × impact, and a mode
that is within normal operation is shown as such, not as a fault.

**A note on units for whoever fills this in.** FH6's slip channels are **normalised, not degrees**:
`SlipAngle`, `SlipRatio` and `CombinedSlip` are all "0 = full grip, |x| > 1 = past the limit",
already scaled to each compound's own envelope (`|CombinedSlip| × 100` is the game's own Friction
page Peak%, verified to a median log-error of 0.086). There is no tyre-load channel and no ABS
flag; suspension is `NormSusp` 0–1 plus `SuspTravelM` in metres, and damper velocity is a
derivative of the latter at the packet's ~141 Hz. An absolute envelope test is not a filter —
`|CombinedSlip| > 1.0` is true of ~32% of cornering frames — so the discriminator is axle
ASYMMETRY, not level.
