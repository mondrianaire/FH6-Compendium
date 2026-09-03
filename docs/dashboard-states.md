# Dashboard v2 — workflow states and pane layout

The dashboard is one fixed-height instrument panel. It never scrolls; each pane fills its cell
and scrolls inside. What is on screen IS the current stage. This document is the source of truth
for which panes exist and what fills them in every reachable state.

## 1. The regions

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ HEADER   [THE RENDER 300px] Car · class PI · drive · cyl · STATUS            │acts │
│          engine (common names) · mass · gears · livery [thumb] by creator     │chips│
│          TUNE TITLE · by creator · own/downloaded · created/saved · one of N  │     │
│          description, when the author wrote one                              │     │
│          [ BUILD SHEET ▸ ]  [ SET TESTING BASELINE ]  (baseline only when ratified)│
│                                                          live · menu · save chips │
├──────────────────────────────────────────────────────────────────────────────────┤
│ TRACE    FIXED 240-px block, chart drawn at its own pixels. On a known course every│
│          lap on record; WHICH laps = preset vs the car you are in (all · this     │
│          class · this car · this build · same hardware [rim rule] · this tune),   │
│          then dimension filters from what is on screen, then lap chips (click to │
│          hide). A timed event on a known course selects "this class" by itself.  │
│          Your lap painted by grip/speed, fastest green, partial/void dashed and   │
│          struck, turns ticked by id, impacts marked, hover marks the map.         │
│          Off a course: the live run, painted by grip.                            │
├──────────────────────────────────────────────────────────────────────────────────┤
│ BANNER   one contextual strip: save prompt / ratify steps / which-save picker /   │
│          hardware-changed / sliders-changed → A/B offer.  Empty when nothing due.  │
├───────────────────────────────┬──────────────────────────────────────────────────┤
│ LEFT PANE                     │ RIGHT PANE                                       │
│ FREE:   whole world map, all  │ FREE:   general statistics — failure modes ranked│
│         169 routes, your laps │         by frequency × impact, per corner kind   │
│         painted where driven  │         (needs MORE samples than course mode)    │
│ COURSE: live course map, the  │ COURSE: [General statistics | Conclusions]       │
│         game centre-line under│         toggle; conclusions = ranked failures on │
│         your driven line,     │         THIS course's turns with the fix attached│
│         turns lit             │                                                  │
├───────────────────────────────┴──────────────────────────────────────────────────┤
│ DOCK     LIVE · value tiles (mph gear rpm lat/long g yaw hp tq boost · inputs ·   │
│          suspension travel · mode) · time trace: grip state per second, speed     │
│          line, every identified corner ▲ coloured by balance · 2/10/30 min spans  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ FOOTER   mode (free / course / decode) · why · baseline: <name or none> ·         │
│          data coverage meter: samples held vs samples required for this mode      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The BUILD SHEET button is always present once a car is identified, whatever the status. It opens
the floating sheet (in-page, draggable, pinnable, minimisable, position remembered — the same
pattern as the v1 decode float), laid out as the two in-game screens: Upgrade Shop by category
with the tile strip, and Tuning by tab with front/rear columns.

### The build sheet keeps the v1 identity
The rows and sliders are the v1 "TAKE TO GAME" surface (2026-08-22, unified on the daemon's
`deliverable` 08-27): menus in the game's own order, named levels with Street/Sport/Race pips,
PI-cost chips, engine sub-lines; tuning tabs with sections, absolute values + units, a slider
track with knob and pole labels. The v2 rewrite dropped that for a database-only sheet, which
drew a blank aspiration row (the database keeps the blower in its own slot) and printed gear
slider positions as if they were ratios. The sheet is now fed by the same `deliverable` the
panel fetches with the disk tune, and the database adds only what that surface never had — the
tile's position in the shop grid, and the checklist. With no save on disk it falls back to the
database's slot walk and says so.

### One instrument, not six cards
No rounded corners, no gaps between regions, no floating panels. Bands are divided by a single
1px rule and butt against each other, edge to edge; the header's three cells do the same. The
surface should read as an instrument panel that spends every pixel on a fact — which is what the
project claims to be.

### The last-action line
One accent-coloured rule, 20px, flush to the very top of the viewport with nothing above it,
carrying what the lab last did: importing, re-reading, a new save read with its part and slider
counts, or "database up to date" with the time. It never grows or wraps. The alerts strip below
keeps only what needs a decision (the which-save picker, the remaining ratification steps).

### The map follows, like a satnav — DEFERRED to course optimisation
**Status: built, off by default, opt-in from the legend.** Adaptive zoom is right for a driver
working on line and timing on a track they already know, and wrong while a car is being built and
tested, where the map's job is orientation and a window that keeps changing scale costs more than
it gives. It is therefore reserved for a future COURSE OPTIMISATION mode — an established track,
the car settled, the session about the driver rather than the build. The mechanism below stays in
place for that mode.

One scale cannot serve a hairpin and a motorway. The map eases its window from what the frame
already says: lateral g over 0.55, under 45 mph, or within 90 m of a mapped turn gives a ~180 m
window with the turn ids legible; the middle band gives ~420 m; a straight pulls back to 900 m,
or 1600 m over 130 mph. Parked or in a menu it returns to the whole course. The bands overlap so
it cannot flap, the view is eased over about a second, and a `follow` toggle in the legend pins
it if you would rather it held still.

### The panes: map left, analysis right
The left pane is the map — the world, or the identified course, whose header carries the TRACK'S
OWN NAME with a RIVALS or EVENT badge before any measurement. The right pane is the corner
analysis. They sit side by side in both orientations; that arrangement is the original plan and
the one the eye expects.

### The map drawer: legend and filters, floated off the map
The map pane's job is the shape of the road, and a permanent colour key plus a row of filter
buttons were costing it real pixels — on a course, the map's svg was also sitting inside a boxed
`.panel` wrapper sized to a fixed 2:1 viewBox regardless of the course's own shape, so in the
tall portrait layout it filled barely half the pane. Both are fixed together: the svg is unwrapped
to a direct child of the pane body (so `width:100%;height:100%` actually applies) and its viewBox
now takes the course's own bounding-box aspect, the way the world map already sized itself to the
island. What used to be the inline legend — colour key, the `follow` toggle, the off-map toggle —
now lives in one `☰ legend & filters` drawer, closed by default and remembered per browser. On a
course, the same drawer also carries the trace's own preset chips (all · this class · this car ·
this build · same hardware · this tune) and dimension filters, reading and writing the identical
per-course `vc` view-store object the trace pane uses — filter from either pane and both redraw.

### No scrollbars, ever
**Hard rule (Jett, 2026-09-03): the dashboard has zero scrollbars.** All real estate is planned
and every relevant field is respected. A list that cannot fit its cell does not scroll: it shows
what fits and says "+N more — not shown, the cell is full" (`fitRows`), and the trace's lap chips
do the same sideways (`fitChips`). Regions clip; they never scroll. The floating BUILD SHEET is a
separate surface reproducing the game's own screens and keeps the game's scrolling.

### Concrete cells
Every region has a fixed size and fixed columns: header 196 px ([art 300] [identity 1fr, five
fixed rows] [actions 340, a 2×2 button grid + chips]), trace 240 px, alerts 96 px (says "nothing
to act on" when empty), dock 216 px, footer 34 px; the two panes take what is left. Values
populate the cells and are clipped with an ellipsis when they overflow. A region never resizes
with its content.

### Blocks, not pills
Status and chips are square-cornered solid blocks in heavy uppercase type, the game's own badge
language; rounded pills did not carry emphasis. Sliders the daemon knows only by position read as
absolute values from the database's ranges, tagged `db`.

### The screen is portrait
The dashboard's home is a 4K portrait monitor at 200%: a **1080 × 1920 CSS-px** viewport. In
portrait the two panes stack (map above, statistics below) and the build sheet takes the width;
landscape keeps them side by side. Verify layout at 1080 × 1920, not at a landscape frame.

### The database follows the saves
The database is a snapshot; a new save leaves it behind. Import + regeneration take ~10 s
(7.8 s + 1.75 s on 578 containers, measured 2026-09-03), so they run **by themselves when a
re-read finds a save the database does not hold**, and on demand from IMPORT + REGENERATE (in
the status banner and the Build data tab). The trigger is a new save file, never a menu return.
The work runs in `scripts/rebuild_service.py` on port 8001, started from the worktree like the
daemon; the header chip reads "importing · N s", then "db · HH:MM".

### Live reload: the backend tells the page
The rebuild service also serves `GET /watch` (Server-Sent Events). It polls the dashboard's own
files once a second and pushes `code` when any changes (the `?v=` bump in index.html is how a
code change is announced) and `data` the moment a rebuild finishes or `api/identity.json` is
rewritten by anyone. The page reloads on `code` and re-reads identity, world, diagnosis and the
car on `data`. Nothing in the browser polls; nothing on ports 8000 or 8765 is involved.

### The ratification ladder is bounded, and the order is the game's
At most three manual steps, plus one the lab does itself: (1) clone onto a second copy of the
car — locked/downloaded tunes only; (2) save the clone with a name; (3) import + regenerate,
automatic on any save the database does not hold; (4) say which save is fitted — only when
saves tie on cylinders, drivetrain and PI, and only when the gear ladder cannot separate them
(`tune_gear` holds every save's ladder, the daemon matches it unit-free from its own WOT
accrual, and `_box_exercised` makes "no gear above N" evidence from the accumulated gear set).
Every other status is a subset: new build on disk = step 3 alone, hardware or slider change =
steps 2-3, downloaded = 1-3.

**Order matters, because the menus gate each other** (spec §9.1, §10.7): the aspiration
conversion must be installed before its forced-induction tier exists in the Engine list; an
engine or drivetrain swap changes which part sets exist at all; a body kit removes the Front
Bumper tile, so front aero comes first; a transmission, differential or spring kit REWRITES
its sliders on install, so every hardware step precedes every slider step. A clone route that
ignores this order sends the user to a menu that does not exist yet.

## 2. Modes

Mode comes from the daemon's `mode` event (`suggest`: free | course | decode, with `reason`),
which is sticky through menus so a pause mid-Rivals does not flap. Course mode is entered by a
timed event (Rivals / race / time trial) or by lapping a marked reference loop; everything else
is free. Decode mode (a donor/replica run flagged) keeps the course layout and swaps the right
pane to the clone verify view.

| | FREE | COURSE |
|---|---|---|
| left pane | world map fitted to the island: every reachable route centre-line, driven laps painted, live car dot; the two off-map circuits (Route102/103, cut content outside the nav mesh) only behind a toggle | course map: centre-line + driven line + lit turns + live dot |
| right pane | general statistics only | toggle: general statistics / conclusions |
| sample threshold | high — free driving is not race pace | low — every turn encounter is relevant |
| recommendations | world-wide, from `v_diag_by_setup` filtered to atomically-equal builds | course-specific, from `v_diag_by_turn` for this route |

### The header carries the save's own metadata
Every save folder holds `header` (title, description, creator gamertag and XUID, creation
time) and `Thumb.png` — the game's render of that exact tuned car (WebP for your saves, a BC7
texture for downloaded tunes). The importer reads the whole header record; `build_web.py`
exports the renders as `api/thumb/<container>.webp`; the header leads with the render and shows
the tune's title, author, source, date and description. Common names everywhere: the engine
line comes from the deliverable's Conversions rows.

### A reload is a re-query, not a reset
Every value on screen is either re-derived from the stores it came from (api/*.json, the
daemon's snapshot) or, when it is the user's own choice, read back from ONE view store
(`localStorage.fh6view`, versioned) keyed by the context that owns it: the car (ordinal: pin,
baseline, dismissals, last live PI, the previous fingerprint and the change it produced), the
course (key: trace preset with an `auto` flag, filters, hidden laps, pinned right tab), the
build (hardware hash: the sheet checklist) or the page (dock span, off-map toggle, paint mode,
sheet position and open state). `sessionStorage.fh6ctx` seeds the live context (position,
course key, car, mode) with a freshness gate and is shown as **held** until a frame confirms it.
MODE has a third state — unknown until the daemon speaks — so a reload never asserts free roam.
Context hooks `onCarChange`, `onCourseChange` (with course hysteresis) and `onModeChange`
restore what the new context owns. The Build data pane derives **Since the previous save** from
the two newest held saves and lists the car's saves (click to pin); the corners tab binds each
corner to the course's own turn geometrically and ranks your passes this session.

### The right pane follows the context
| context | default tab | why |
|---|---|---|
| in a menu, or no frames yet | **Build data** (course mode: statistics) | a menu is where the build changes: the save's exact values, the union's asks, the steps to ratification |
| driving, free roam | **Live corners** | every corner as taken: in→apex→out, lat g, braking point, balance verdict, first axle over the limit |
| on a course with a baseline set | **Conclusions** | this course's turns, ranked, with the change attached |
A click on a tab pins it until the context class changes. Tabs in free mode: Live corners ·
General statistics · Build data; in course mode: Live corners · General statistics · Conclusions.

## 3. Build status — the inflection point

Five observable variables decide the status. Everything else is derived.

| variable | source | note |
|---|---|---|
| `hw_match` | live parts (from the fitted save) vs `identity.json`, **rim-tolerant** | see §4 |
| `tune_match` | slider fingerprint vs the same set | only knowable from a save |
| `in_db` | a matching container exists in our database | not the same as on disk |
| `locked` | the fitted save's lock flag | downloaded = locked |
| `saved` | the live car agrees with a save on disk | inferred: no PI drift, cyl/PI agree, daemon pick not held |

| status | hw_match | tune_match | locked | saved | meaning | header pill | banner |
|---|---|---|---|---|---|---|---|
| **downloaded / locked** | ✓ | ✓ | ✓ | ✓ | playing someone else's build; cannot progress without cloning | amber | "clone to an unlocked save to test or tune it" |
| **unknown / unsaved** | ✗ | ✗ | – | ✗ | no hardware we hold; truly new | red | "save this setup with a name to establish a baseline" |
| **variation** | ✓ | ✗ | ✗ | ✗ | same hardware as a held build, sliders moved; an A/B in progress | blue | "sliders differ from <base> by N — compare A/B" |
| **unsaved clone** | ✓ | ✓ | ✗ | ✗ | matches a LOCKED build, but this copy is unlocked and unsaved | blue | "save it — a clone is only comparable once saved" |
| **ratified** | ✓ | ✓ | ✗ | ✓ | your own saved, unlocked build | green | none; SET TESTING BASELINE is offered |
| ratified, other livery | ✓ | ✓ | ✗ | ✓ | duplicating an established build onto another car identity | green + note | "identical to <name> on <livery>" |

Non-ratified statuses show the steps to ratification in the banner. Ratified builds carry all
historical tuning, testing and time-trial data of every **atomically similar** build (§4).

### What is NOT observable, and must be said on screen rather than papered over
* The live packet carries only ordinal, drivetrain, cylinder count and PI. Two builds that agree
  on all four are indistinguishable at a standstill. The daemon breaks ties by watching the
  gearbox; until then the status is "one of N" and the which-save picker is shown.
* **Unsaved slider changes are invisible.** Sliders exist only in save files; telemetry never
  reports them. A slider-only change is detected the moment it is SAVED, never before. A hardware
  change is detected before saving, because it moves PI.

## 4. Atomic similarity — the rim rule

Two builds are the SAME hardware when every one of the 50 part slots agrees **except the two rim
slots, provided the rims agree in `mass_level`** (0 heaviest … 4 lightest). Rims differ only by
weight class; the game's own wheel table proves the rest is cosmetic. So the hardware fingerprint
used for `hw_match` is the 48 non-rim slots plus the two rims' mass levels, not their ids.

## 5. Testing baseline

* Only a **ratified** build can be set as the baseline.
* Setting it records `{container, hw_hash, setup_hash, set_utc}` and pins the which-save picker.
* The footer coverage meter then reads samples held for this baseline against the threshold for
  the current mode. Until the threshold is met the conclusions pane says how many more laps or
  minutes are needed rather than showing a recommendation.

## 6. Failure modes and their chartable variables (item 5/7 audit, to be filled)

Each symptom in `ref_symptom` must name the telemetry variables that move when it is present, so
the A/B overlay can chart the variable and not the label. The audit fills this table:

| symptom | chartable variables | threshold for "normal" |
|---|---|---|
| Bottoming out | suspension travel per wheel, rate per minute | a few per 10 min is normal operation |
| Understeer entry / mid / exit | front slip angle, lateral g, speed at apex | — |
| Oversteer entry / exit | rear slip, yaw rate, throttle at the moment | — |
| Unstable under braking | rear deficit, lock flag, decel g | — |
| Floaty after crests | vertical g, settle time | — |
| Wanders at top speed | yaw pulse amplitude at speed | — |

Multiple failure modes will coexist. They are ranked by confidence × frequency × impact, and a
mode that is within normal operation is shown as such, not as a fault.
