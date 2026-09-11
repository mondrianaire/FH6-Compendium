# Design language — class pills, the 5-segment turn, grip states

The standard for three visual languages the dashboard uses everywhere: **performance class pills**,
the **5-segment turn model** (where in a turn), and **grip states** (what the tyres did). It records
what the code does today, names the one correct form of each, and lists every place the code still
deviates.

*Reconciled against the lab worktree (`forza-eliminator-tips-db-c512c3`) on 2026-09-11. Drafted in the
`recursing-bardeen` worktree and moved here into the lab's `docs/`, its home. The first three §5 items
(D5 class-colour tokens, the FH6 class bands, D6 Entry label) were applied in the lab — commit SHAs are
on each. The code constants are the source of truth and this file only names them — if the two disagree,
the constant wins and this file is a bug. All paths below are relative to the lab.*

---

## 0. Rules that apply to all three

1. **Three independent axes — never let one stand in for another.**
   - **Class** — *which car.* An identity attribute.
   - **Segment** (WHERE) — *which part of a turn.* A position.
   - **Grip state** (WHAT) — *what the tyres did.* An outcome.

   A segment colour must never signal grip, and a grip colour must never mark position. Mixing the
   two is exactly what confused the drift readout (§3.4).
2. **One helper per language.** Pills come from `piBadge` / `clsBadge` / `classPill`. Segments come
   from `SEG_ORDER` / `SEG_COL` / `SEG_LABEL`. Grip comes from one palette and one classifier. No
   hand-built markup, no hex literals at call sites.
3. **The game's own look first.** The class pill copies the in-game PI badge. It is the one
   intentionally rounded element in an otherwise square-cornered UI.
4. **Grip is reported as a distribution, never as the single worst moment** (hard rule, Jett
   2026-09-10). See §3.4.
5. **One colour, one meaning per surface.** Where a hue is already used for something else nearby,
   it can't be reused for a different idea on the same screen (§4, collisions).

---

## 1. Performance class pills

### 1.1 Anatomy

One rounded block with two cells, drawn in vector:

```
┌────┬─────┐
│ A  │ 700 │   <b> class letter on the class colour · <i> PI on near-black #0d0d0d
└────┴─────┘   heavy weight (800), tabular PI digits, 1px inner highlight
```

It is **drawn, not cropped** — a deliberate change from v1. The 42px PNG crops went soft above
about 40px and couldn't hold a two-character class (S1, S2) without stretching. A vector pill is
sharp in a 14px table row and at 40px in the header. The PNG `.pib-img` path is dead in v2
(`display:none`).

### 1.2 Classes and colours

| class | fill | letter ink | PI range (game `ref_class`, confirmed by telemetry) |
|---|---|---|---|
| D | `#45c8f1` | `#04222c` (dark) | ≤ 400 |
| C | `#f0c530` | `#231a00` (dark) | 401–500 |
| B | `#f0862d` | `#2a1400` (dark) | 501–600 |
| A | `#e5414e` | `#fff` | 601–700 |
| S1 | `#a468e8` | `#fff` | 701–800 |
| S2 | `#2f62e0` | `#fff` | 801–900 |
| R | `#e83c9e` | `#fff` | 901–998 |
| X | `#2fd05f` | `#04220f` (dark) | 999 |

Light fills (D, C, B, X) take dark letter ink so the letter meets contrast; the rest are white.

### 1.3 Variants

| variant | markup | meaning | used for |
|---|---|---|---|
| **solid** | `.pib .pib-<cls>` | the class is known / held | car header, build sheet, leaderboard rows |
| **negative** | `+ .pib--neg` | **offered, but no data yet** — black fill `#0b0d10`, letter in the class colour, 1px ring in the class colour | Rivals class lists on course tiles and pills |
| **with count** | `classPill(cls, n)` → `<i class="pib-n">n</i>` | laps held in that class | "laps by class" rows |
| **class chip** | `.clschip` with `--pc` = class colour | a filter control, not a badge: outline when off, solid when on | trace / course filter bars |

### 1.4 Sizes

| size | height / type | where |
|---|---|---|
| `pib--sm` | 16px / 10px | dense rows, build sheet title, tiles |
| default | 22px / 13px | inline |
| `.artpi` | 28px / 16px | the header's render |
| `pib--lg` | 34px / 20px | hero surfaces |
| `.tcls` | 8px type | miniature pills on course-browser tiles |
| `#leftHd .cpill-badges` | 9–9.5px type | the course pill badge row (count cell hidden there) |

### 1.5 Rules

- **Never render PI as bare text** ("PI 700", "700 PI"). Always use a pill. Tooltips (`title=`) are
  the only exception.
- **Call the helper; never hand-build `.pib` markup.**
  - `piBadge(cls, pi[, sm])` when the PI is known (`dashboard/v2/app.js:32`)
  - `clsBadge(cls)` for the class alone
  - `classPill(cls, n)` for class plus a count (`panel.js:1681`)
- A **trace painted by class** uses the same fills (`PI_COLORS`). On the within-grip portion of a
  trace, the car's class colour replaces the green.

### 1.6 Where the code deviates

1. **Class colours are defined three times** — two CSS blocks (`styles.css:679–686` and `969–972`)
   and `PI_COLORS` in `panel.js:478`. They agree today, but nothing keeps them in step. **The D5 patch fixes this** (§5).
2. **The base `.pib` rule is declared four times** (`styles.css:672–689`, `885`, `960–975`). Only
   the `960` block is live by cascade order (22px, radius 3px); the earlier ones are dead code.
3. **Hand-built pills bypass `classPill`** at `panel.js:1829`, `1843` and `2224`. `classPill` needs
   a `neg` option so those three can call it.
4. **v1 and v2 are separate implementations.** v1's `piBadge` (`dashboard/app.js:25`) draws PNG
   art and derives the class from the PI when no class is passed; v2 draws vector and does not derive.
5. **Two docs still describe the retired PNG badge:** `docs/design-review/README.md` (constraint
   #4, "with its class tile art") and `docs/v1-lessons-audit.md` #38 ("v1's piBadge()/.pib over the
   shipped … badges art"). The vector pill is canonical; update both.
6. **`classForPi()` uses FH5's class bands** (`panel.js:483`: D ≤ 500, C ≤ 600, B ≤ 700, A ≤ 800,
   S1 ≤ 900, S2 ≤ 998, X ≥ 999, with "R is never derived"). FH6's bands are one class lower (§1.2),
   and telemetry confirms them. The build-sheet header derives its pill from this function
   (`panel.js:3574`), so a PI 700 car's sheet shows **B** instead of **A**, a PI 450 car shows **D**
   instead of **C**, and a PI 950 car shows **S2** instead of **R**. v1's `CLS_OF_PI` has the correct
   FH6 bands. **`class-bands-fh6.patch` fixes D–S2** (§5).

### 1.7 R and X — what the data says (D4, research open)

- **The game treats them as separate classes.** `ref_class`: class 6 = **R**, PI 901–998; class 7 =
  **X**, PI 999 only.
- **The lab labels class 6 as "X".** `CLASS = {…, 6: "X", 7: "X"}` in `analyze_session.py:42` and
  `fh6_live_daemon.py:30`, and `_CLS_ID = {…, 6: "X"}` in `build_web.py:584`. So every lap the lab
  calls X — all 12 of them, PI 912–998 — is an **R** car. There are no R-labelled laps and no laps at
  PI 999.
- **Rivals runs up to R.** `ref_rivals_event` has class_id 0–6, 86 events each; there are no X
  (class 7) events.
- **Telemetry confirms the bands.** The game reports class and PI independently, and the lab's own
  records match `ref_class` exactly: D 100–400, C 404–500, B 502–600, A 601–700, S1 702–800,
  S2 803–900, and 901–999 for the class-6/7 cars the lab labels X (`lap`, `session_car`).
- **Jett's position:** X is a very special R at PI 999, and probably no different for laps.

**Open research:** does the game ever separate X from R — Rivals leaderboards, event restrictions, PI
caps? Suggested working rule until that's answered: the display letter follows the PI (901–998 → R,
999 → X), and laps may pool R with X. Correcting the three mapping tables waits for the answer.

---

## 2. The 5-segment turn model (WHERE)

### 2.1 The five segments

Always in this order. Two are **connectors** between corners; three are **the corner itself**.

| key | label | colour | role | how it is bounded (geometry, `fh6_turns.py`) |
|---|---|---|---|---|
| `braking` | Braking | `#6c8cf0` | connector | from the turn's start back up to **45 m**, never past the previous turn's exit |
| `turn_in` | **Entry** (D6; the code still says "Turn-in") | `#45c8b0` | corner | turn start → start of mid |
| `mid` | Mid-corner | `#f0b429` | corner | the span where curvature is **≥ 80% of the turn's peak** |
| `exit` | Exit | `#63d19e` | corner | end of mid → turn end |
| `straight` | Straight / crest | `#8a95a5` | connector | from exit forward up to **45 m**, never past the next turn's start |

**What counts as a turn:** road tighter than a **260 m radius** (`K_MIN = 1/260`) that sweeps at
least **11°** (`MIN_DEG`), with same-direction runs less than **18 m** apart merged into one
(`GAP_M`), on a 2 m resample. The 80%-of-peak mid span is the geometric counterpart of the live
detector's 80%-of-peak-lateral-g phase.

**Overlaps:** a route point that falls in two spans (a straight is also the next turn's braking)
belongs to the higher-priority segment: `mid 3 > turn_in 2 = exit 2 > braking 1 > straight 0`
(`import_corners._SEG_PRI`). Corner segments always win over connectors.

**Constants:** `SEG_ORDER`, `SEG_COL`, `SEG_LABEL` at `dashboard/v2/panel.js:513–515`.

### 2.2 Data

- `ref_route_turn.segments` — JSON arc spans per turn, written by `fh6_turns.py` via
  `import_routes.py`.
- `corner_segment` — one row per lap × turn × segment: `n_samples`, `entry/exit/min/mean_mph`,
  `time_s`, `grip_state`, `grip_hist`. Today: 44,594 rows (braking 12,353 · mid 9,598 ·
  straight 7,824 · exit 7,732 · entry 7,087).

### 2.3 Three ways "phase" is derived — say which one you are showing

| derivation | segments | source | used by |
|---|---|---|---|
| **Geometry spans** (canonical) | all 5 | route curvature → arc spans → nearest route point per sample | recorded laps: corner strip, turn analysis, per-phase stats |
| **Live corner detector** | 4 (no straight) | lateral g: *braking* = 60 frames before \|lat\| > 0.35; *entry* = start to first frame ≥ 80% of peak; *mid* = the ≥ 80% window; *exit* = after it. The corner ends when \|lat\| < 0.25, must last ≥ 0.8 s, and is discarded if \|lat\| > 3 g | Live corners / Current lap tabs (`LIVE_PH`) |
| **Diagnosis symptoms** | entry / mid / exit | position relative to the apex (closest approach; *mid* = within one sample of it), plus separate braking and crest detectors (air when crest g < −0.35) | `import_diagnosis` symptom names, detected-error cards |

**"Straight / crest" is a geometric span.** It does not measure air itself; crests are detected
separately by diagnosis.

### 2.4 How segments relate to loss of grip

The segment says *where*; grip says *what happened there*. Every per-segment surface pairs them the
same way:

- **Colour = where you are, fill = what the tyres did** (the corner map's own caption). Structure —
  road bands, the turn line, phase dots, column headers — is painted in `SEG_COL` only.
- **Phase-time rail:** each cell's width is the median seconds spent in that segment; its fill is
  that segment's grip distribution (§3.4).
- **Detected-error cards** name **segment + grip state** together (e.g. *Mid-corner · understeer*).
  The segment is never implied by colour alone.
- **Reading loss of grip through a turn:** front loss while braking or in the entry segment is
  entry understeer; front loss at mid is a steady push; rear loss at braking is instability under braking; rear loss at exit
  is a power slide. That is the diagnosis vocabulary, organised by segment.

### 2.5 Where the code deviates

1. **Live has 4 phases; recorded laps have 5.** The live detector has no straight/crest, so live and
   recorded per-phase views can't be compared column for column.
2. **"Entry" is decided (D6).** `d6-entry-label.patch` renames the displayed label (§5).
   Diagnosis's *entry* still means everything before the apex rather than the entry segment, and
   still needs aligning. One knock-on to watch: a phase-cell tooltip now reads "entry" for the segment
   right beside "entry … mph" for entry speed.
3. `SEG_COL` exit `#63d19e` is close to within-grip green — keep them on separate channels
   (outline versus fill) on any surface that shows both.

---

## 3. Grip states (WHAT)

### 3.1 The classifier — one rule

For each sample:

- **front** = the larger `|CombinedSlip|` of the two front tyres
- **rear** = the larger `|CombinedSlip|` of the two rear tyres

Slip is **normalised**: above 1 means that tyre is past its limit.

```
impact  if |lateral g| > 3.0  or  a smashable object was hit
both    elif front > 1 and rear > 1
front   elif front > 1
rear    elif rear  > 1
calm    otherwise
```

| code | key | canonical word | axle wording (tooltips) | v1 icon |
|---:|---|---|---|---|
| 0 | `calm` | within grip | within grip | ✓ |
| 1 | `front` | understeer | fronts past the limit | ↔ |
| 2 | `rear` | oversteer | rears past the limit | ⟳ |
| 3 | `both` | drift / overdriven | all four past the limit | 🌀 |
| 4 | `impact` | impact / jolt | impact / jolt | ⚡ |
| — | `off` | not driving | not driving (display only) | · |

- **Severity order** (`GRIP_SEV`): both 4 = impact 4 > rear 3 > front 2 > calm 0.
- **Other signals map into the same five states, never a parallel set.** The understeer index maps
  to *front* above 0.15, *rear* below −0.05, otherwise *calm*. The first axle over the limit maps to
  front or rear. The drift flag maps to *both*.
- **Impact caveat:** the 3 g rule is display-only. A lap is invalidated only by a **smashable hit**,
  never by grip code 4 (`analyze_session.py:2750`).

The rule is implemented four times and must stay identical: `fh6_live_daemon.py:604`,
`analyze_session.py:1501` and `2320`, `build_course_from_laps.py:56`.

### 3.2 Palette

**Canonical (D1): `DGRIP`, identical to v1's `GRIP`.** Two palettes are still live in the code
(§3.5). Fills use `col`; lines and text use `ink`.

| key | fill `col` | line / text `ink` | note |
|---|---|---|---|
| calm | `#2a313c` | the car's class colour when known, else `#8b97a7` | recessive: within grip is the background, so departures stand out. Never green. |
| front | `#2f81f7` | `#2f81f7` | blue |
| rear | `#e5414e` | `#e5414e` | red |
| both | `#a371f7` | `#a371f7` | violet |
| impact | `#e3b341` | `#e3b341` | amber |
| off | `#0b0e12` | `#8b97a7` | near-black |

The ink rule exists because a `#2a313c` line would vanish against the `#0d1117` page background.

### 3.3 Data

- **Per sample:** trace points carry the grip code (`[arc_m, mph, grip, x, z]`).
- **Per lap × segment:** `corner_segment.grip_hist` = `[calm, front, rear, both, impact]` sample
  counts — **the source of truth**. `grip_state` is the **modal** (most common) state, not the
  maximum. Today's modal counts are calm 25,744 · both 9,207 · front 6,551 · impact 1,671 ·
  rear 1,421.
- **Per second (dock strip):** the worst state within each second.

### 3.4 The hard rule — typical, never worst

A segment's grip is the **distribution across the five states**, not a single worst-moment label.
It used to store `max()`, so any at-limit instant turned a whole phase into "drift", and every hard
phase read the same scary word.

- **Aggregate** equal-weight per lap: each lap's `grip_hist` is normalised to 1, then averaged →
  `mix`, and the headline state is `argmax(mix)` (`phaseAgg`, `panel.js:2808`). One long or messy
  lap can't dominate.
- **Render** as a stacked distribution bar (`gripBar`) with a plain-language reading (`gripRead`):
  *"62% within grip · oversteer 26%"*, or *"mostly within grip (N% of samples)"* when calm is ≥ 80%
  or no other state reaches 10%.
- **A lone grip swatch or word standing for a segment is the anti-pattern.**

### 3.5 Where the code deviates

1. **Two palettes, one alphabet.**

   | palette | calm | front | rear | both | impact | used by |
   |---|---|---|---|---|---|---|
   | `DGRIP` (`panel.js:983`) ≡ v1 `GRIP` | `#2a313c` | `#2f81f7` | `#e5414e` | `#a371f7` | `#e3b341` | dock strip, corner strip, grip bar, turn stats, balance legend, error cards, live per-phase grip |
   | `TRACE_GRIP` (`panel.js:474`) ≡ `GRIP` (`app.js:429`) | `#00d27a` | `#4ea3ff` | `#f0616d` | `#c678dd` | `#e3b341` | speed traces and their legend (calm shows the class colour when known) |

   The second palette is simply the app's status colours (`--acc`, `--acc2`, `--bad`, `--mag`,
   `--warn`). There are also hard-coded hexes at `panel.js:2789` (with a sixth calm, `#3a4250`),
   `2792` and `3239`. `v1-lessons-audit.md` #38 already called for one exported grip palette; it
   hasn't been done.
2. **Two word sets.** `DGRIP` says *understeer / oversteer / drift / overdriven / impact / jolt*;
   `TRACE_WORD` (`panel.js:494`) says *front slipping / rear slipping / all four / impact*.
3. **The typical-not-worst rule covers recorded laps only.** The **live corner detector's** phase
   state (`axle()` takes the **max** slip over the whole phase) and the **per-second dock strip**
   (max within each second) are still worst-moment reads. The live per-phase cells render them as
   single colours.
4. **The corner strip** (`phaseCells`) shows one modal colour per segment cell. That is typical, not
   worst, so it follows the rule's intent, but it is still a single swatch where the rule asks for a
   distribution. It needs either an explicit exception for compact rows or a mini distribution.

---

## 4. Colour collisions and open decisions

### 4.1 Collisions

| hue | meanings it carries today |
|---|---|
| green `#00d27a` | within grip (`TRACE_GRIP`) · success/accent (`--acc`) · **fastest** (pace-rank `rankColor`, speed gradient `spdColor`) |
| red `#f0616d` / `#e5414e` | rear slip · error (`--bad`) · **slowest** · class A fill (`#e5414e` is exactly `DGRIP` rear) |
| amber `#e3b341` | impact · warning (`--warn`) · mid-pace |
| green `#2fd05f` / `#63d19e` | class X · exit segment |
| orange `#f0862d` | class B fill · severity **major** (`SEVCOL`, `panel.js:3123`) |

The worst case is a speed trace painted by grip next to a corner map painted by pace: green means
"within grip" on one and "fastest" on the other. `design-review/upgrades-2026-09-11.md` already asks
whether there are too many colour languages. This table is the evidence for that question.

### 4.2 Decisions (Jett, 2026-09-11)

| # | question | decided |
|---|---|---|
| D1 | The one grip palette | **`DGRIP`.** Calm `#2a313c` recedes so departures stand out, and it stops competing with pace/speed green and the success colour. **Fill vs line:** fills (bars, cells, swatches) use each state's `col`; lines and text use its `ink`. On a trace, calm's ink is the car's class colour when known, otherwise `#8b97a7` — never green (§3.2). |
| D2 | The one word set | **`DGRIP` words** on screen — within grip · understeer · oversteer · drift / overdriven · impact / jolt. v1's axle wording goes in tooltips (understeer = fronts past the limit). `TRACE_WORD`'s "front slipping / rear slipping / all four" retires. |
| D3 | Live grip: typical or worst? | **Typical, live too.** A live phase reports the share of its samples in each state (a live `grip_hist`) and the modal state, not the max over the phase. The per-second dock strip reports the modal state of each second. |
| D4 | Class 6 vs 7 — R or X? | **Open, research needed.** Jett: X is a very special R at PI 999, and probably no different for laps. The data and the lab's mislabel are in §1.7. |
| D5 | One source for class colours | **CSS custom properties** `--pc-d … --pc-x` (plus `-ink` for the light fills) in `styles.css :root`; `PI_COLORS` is read from them. Built as a patch — see §5. |
| D6 | "Entry" vs "Turn-in" | **Entry.** The `turn_in` segment displays as **Entry**; the data key `turn_in` is unchanged. Diagnosis's "entry" should adopt the geometry segment rather than "anything before the apex". |

---

## 5. Making it true — checklist

- [x] **D5 — class colour tokens: applied in the lab at `699b990`.**
      `docs/patches/d5-class-colour-tokens.patch` (3 files, +34/−24). It moves the class
      fills into `--pc-d … --pc-x` (plus `-ink`) in `styles.css :root`, removes the dead duplicate fill
      block, points the solid and negative pills at the tokens, and turns `PI_COLORS` into a lazy read
      of those tokens (real colour strings, because SVG strokes can't resolve `var()`). It also bumps
      `styles.css` and `panel.js` versions. Checked against lab `6ab46f1`: `git apply --check` passes;
      the patched page loads with no console errors; all 8 classes give identical `piColor()` values
      and identical computed solid and negative pill colours on the patched and unpatched pages. Apply it
      **first** in the lab with `git apply <path-to-patch>`; the two patches below stack on it.
- [ ] One module exports `CLASS`, `SEG` and `GRIP` (colours, words, order). Everything else imports
      it; no hex literals at call sites.
- [ ] Delete the remaining dead `.pib` base rules (the early `.pib` / `.pib b` / `.pib i` block and the
      `border-radius:0` override).
- [ ] Give `classPill` a `neg` option; route `panel.js:1829`, `1843`, `2224` through it.
- [x] **D1/D2 — grip palette and words: applied in the lab 2026-09-11** (commit "Grip palette: one DGRIP").
      `DGRIP` (`panel.js`, beside the trace constants) carries `col` / `ink` / `word` / `tip`, with `GSTATE`
      and `gripOf()` / `gripInk()`. `TRACE_GRIP`, `TRACE_WORD`, `app.js GRIP` and the hard-coded grip hexes
      (incl. the sixth calm `#3a4250`) are gone; traces, the live map trail, the map key and the trace hover
      draw calm in the class colour, else `#8b97a7`; grip text uses `ink` (calm no longer green). One
      judgement call: a legend swatch that keys a LINE shows the line's ink, not the fill `col`.
- [ ] **D3 — typical grip live.** Live phases carry a sample histogram and modal state instead of the
      `axle()` max; the per-second dock strip reports the modal state.
- [x] **Class bands D–S2: applied in the lab at `10d594c`.** `docs/patches/class-bands-fh6.patch`
      (+9/−5). Applied **second**, after D5 (it edits lines the D5 patch uses as context).
      `classForPi()` now matches `ref_class` at every D–S2 boundary (tested at 100, 400, 401, 450, 500,
      501, 600, 601, 700, 701, 800, 801, 900). Above 900 it still returns X, matching the stored data.
- [x] **D6 — Entry label: applied in the lab at `75f93e2`.** `docs/patches/d6-entry-label.patch`
      (+10/−8). Applied **third**; asset versions stack 197 → 198 → 199. It renames `SEG_LABEL`, both
      `SHORT` maps, `PH_SHORT`, the corner-strip header, the phase-cell tooltip (now drawn from
      `SEG_LABEL`) and the "Entry oversteer" advice heading. It deliberately keeps "before turn-in" in
      the braking advice (the action, not the segment) and people's own tune names.
- [ ] **D6 follow-up.** Diagnosis's *entry* adopts the geometry segment instead of "before the apex".
- [ ] **D4 — R/X.** Once the research answers it, correct the class maps in `analyze_session.py:42`,
      `fh6_live_daemon.py:30` and `build_web.py:584` (they label class 6 as X) and give `classForPi()`
      its top band (901–998 R, 999 X).
- [ ] One grip classifier, imported everywhere — or a test asserting the four copies agree on
      shared fixtures.
- [ ] Update `docs/design-review/README.md` #4 and `docs/v1-lessons-audit.md` #38 to the vector pill.
- [ ] Move this file into the lab's `docs/`.

## 6. Source index

| thing | where |
|---|---|
| `piBadge`, `clsBadge`, `PI_CLASSES` | `dashboard/v2/app.js:24–43` |
| `classPill` | `dashboard/v2/panel.js:1681` |
| `PI_COLORS`, `piColor` | `dashboard/v2/panel.js:478–479` |
| pill CSS (live block) | `dashboard/v2/styles.css:956–975`, `1258–1273` |
| v1 `piBadge`, `CLS_OF_PI` | `dashboard/app.js:18–30` |
| `SEG_ORDER`, `SEG_COL`, `SEG_LABEL` | `dashboard/v2/panel.js:513–515` |
| segment geometry | `scripts/telemetry/fh6_turns.py:36–47`, `219–259` |
| segment assignment and priority | `scripts/db/import_corners.py:45–75` |
| live corner detector | `scripts/telemetry/fh6_live_daemon.py:609–640` |
| diagnosis entry/mid/exit | `scripts/db/import_diagnosis.py:144–185` |
| grip classifier (four copies) | `fh6_live_daemon.py:604`, `analyze_session.py:1501`, `2320`, `build_course_from_laps.py:56` |
| `DGRIP` | `dashboard/v2/panel.js:983` |
| `TRACE_GRIP`, `TRACE_WORD` | `dashboard/v2/panel.js:474`, `494` |
| `GRIP_SEV`, `GSTATE`, `phaseAgg`, `gripBar`, `gripRead` | `dashboard/v2/panel.js:2630`, `2800–2890` |
| v1 `GRIP` (richest vocabulary) | `dashboard/app.js:659–680` |
| pace/speed gradients | `dashboard/v2/panel.js:2896–2912` |

Line numbers drift; search for the name if a line has moved.
