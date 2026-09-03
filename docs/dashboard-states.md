# Dashboard v2 — workflow states and pane layout

The dashboard is one fixed-height instrument panel. It never scrolls; each pane fills its cell
and scrolls inside. What is on screen IS the current stage. This document is the source of truth
for which panes exist and what fills them in every reachable state.

## 1. The regions

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ HEADER   [livery thumb] Car · class PI · drive · cyl · STATUS (car metadata) │ tune│
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

### Blocks, not pills
Status and chips are square-cornered solid blocks in heavy uppercase type, the game's own badge
language; rounded pills did not carry emphasis. Sliders the daemon knows only by position read as
absolute values from the database's ranges, tagged `db`.

### The screen is portrait
The dashboard's home is a 4K portrait monitor at 200%: a **1080 × 1920 CSS-px** viewport. In
portrait the two panes stack (map above, statistics below) and the build sheet takes the width;
landscape keeps them side by side. Verify layout at 1080 × 1920, not at a landscape frame.

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
