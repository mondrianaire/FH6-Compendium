# FH6 — Upgrade & Tune UI Specification (reconciled)
**Car in every frame:** `1992 Honda NSX-R` · **Player:** `PwnyS1aystation` · frames `u_001`–`u_758` (1 fps).
All strings below are transcribed verbatim from a named frame. Anything nobody could read is marked **UNKNOWN** — nothing here is inferred from other Forza titles.

---

## 0. Global chrome (present on every menu screen)

**Top HUD bar** (left → right):
`[class letter tile][PI number]` · `1992 Honda NSX-R` (year in yellow, name in white) … right side: star glyph with `2` + purple pill `168` · `PwnyS1aystation` + small glyph · `|` · `CR 91,465,723`.
Second row, right: camera glyph · `LT` · `Advanced Camera` · off-toggle (upgrade screens only; **absent on Tune**).

- The header PI stayed `B 572` through the whole upgrade session (nothing committed at HUD level) and read `A 700` throughout the Tune session (u_396+).
- Credits: `CR 91,465,723` before install → `CR 91,355,473` on every Tune frame.

**Upgrade panel anatomy** (a narrow left-hand panel, car visible to the right — u_364, u_370):
1. Black title bar — the screen name (`Upgrade Shop`, `Engine`, `Tires and Rims`, `Rear Rim Size` …)
2. Tile grid (3 across; scrollbar on the right when the list is longer)
3. **Green name bar** — highlighted item's name, with the price right-aligned in the same bar when purchasable: `Sport Intake  CR 1,200`, `6.2L V8  CR 35,000`, `17 in Rear Rims  CR 1,800`. No price is drawn for an installed/owned part.
4. Either the **stats panel** (part screens) **or** the **description block** (category screens) — never both
5. Footer chips inside the panel: `CR <running basket total>` · wrench/basket chip `<part count>`
6. Screen-level button prompts below the panel

**Button prompts** (gamepad; keyboard variant in brackets)
- Category screens: `A Ok` · `B Back` · `Setup Manager` · `View Basket` · `RT Rev Engine`
- Part screen, purchasable: `A Buy and Install` · `B Back` · `Y Toggle` · `View Basket` · `Setup Manager` · `RT Rev Engine`
- Part screen, owned-but-not-fitted: `A Install` (u_231)
- Part screen, currently installed: the `A` entry is **absent**
- Root Upgrades list, keyboard: `Enter Select  Esc Back  X Restore Default Upgrades/Tuning` (u_001)
- Tune, keyboard: `Enter Apply  Esc Back  Backspace Setup Manager  Space Tune Browser` (u_400)

**Tile badges** — `INSTALLED` (green, top of tile), `OWNED` (green, top), small green check/basket glyph (top-right, item already in basket), and a bottom sub-label chip: **green = improvement**, **red = regression**. Observed sub-labels, verbatim: `POWER +8 hp`, `POWER +10 hp`, `POWER +142 hp`, `POWER -13 hp`, `POWER +2 hp`, `POWER +4 hp`, `POWER +6 hp`, `Weight -4 lb`, `Weight -362 lb`, `Weight +80 lb` (red), `Weight -8 lb`, `EFFICIENCY +33%`, `EFFICIENCY -13%`, `GRIP -0.13` (red), `RIDE HEIGHT -1.41 in`, `DIFFERENTIAL 2-WAY`, tire sizes (`205/50R15`, `225/45R15`, `245/40R15`, `255/40R15`, `225/50R16`, `265/40R16`, `285/40R16`, `315/35R16`, `345/35R16`, `325/20R20` (red), `345/30R17`, `345/25R18`, `205/30R18`, `225/30R18`), rear-wing badges `ADJUSTABLE` / `NONADJUSTABLE`.

**Yellow unlock banner** (right of the tile grid, padlock glyph + all-caps):
`UNLOCKS BRAKE TUNING` · `UNLOCKS SPRING, DAMPER, AND ALIGNMENT TUNING` · `UNLOCKS FRONT ANTI-ROLL BAR STIFFNESS TUNING` · `UNLOCKS FULL DIFFERENTIAL TUNING` · `UNLOCKS REAR WING DOWNFORCE TUNING`.

---

## 1. Entry points

**Pause menu → `CARS` tab** (u_572): tab strip `CAMPAIGN | CARS | MY HORIZON | ONLINE | CREATIVE HUB | STORE`; tiles include `Collection Journal`, `World Map`, `Change Car`, `Buy New & Used Cars`, `Car Mastery`, `Settings`, `Tune Car` ("Tune Your Car"), `Festival Playlist`, `Horizon Mascot Party`, `Treasure Cars`, `Barn Finds`, `Gift Drop`, `Car Horns`, `Exit Game`.

**`Upgrades` root list** (u_003), vertical, in order — no badges, no prices:
1. `Custom Upgrade` 2. `Auto Upgrade` 3. `Upgrade Presets` 4. `Custom Tuning` 5. `My Tuning Setups` 6. `Find Tuning Setups` 7. `Followed Players` 8. `Car Mastery`

---

## 2. UPGRADE MENU TREE (exact order the game presents)

### `Upgrade Shop` — 3 across × 2 down
| # | Tile | Description text (verbatim, as displayed) |
|---|---|---|
| 1 | **Engine** | "Engine upgrades can improve your car's acceleration and speed. You can add a more aggressive cam, stiffer valve springs, improved intake, and exhaust systems as well as a turbo or supercharger to get more power out of your…" |
| 2 | **Platform and Handling** | "Platform and handling upgrades include better brakes and suspension. Combine several platform and handling upgrade types to get the most out of your chassis. These upgrades add up to better braking and cornering. But…" |
| 3 | **Drivetrain** | "Change how the engine's power gets to the wheels to improve your cars acceleration and speed. Upgrades to components such as the transmission, clutch, differentials, and driveline can improve shift time and enable fine-tuning of…" |
| 4 | **Tires and Rims** | "You cannot transmit your cars power and handling potential to the road without the right tires and rims. The stock tires on your car limit your track performance, no matter how you tweak your engine or suspension. Upgrading…" |
| 5 | **Aero and Appearance** | "Weight and aerodynamic upgrades can improve your cars acceleration, speed, downforce, and cornering, but to get ahead on the race track you have to balance your upgrades. A lightweight, streamlined car that is short on…" |
| 6 | **Body Kits and Conversions** | "Change major components of your car, altering its very nature.  Conversions affect the upgrades that are available in other categories." (note the double space) |

### 2.1 `Engine` — 3-across scrolling grid, 11 tiles for the fitted 6.2L V8 (u_299 / u_368 / u_370)
Order: 1 **Intake** · 2 UNKNOWN (intake-manifold/velocity-stack icon) · 3 UNKNOWN (fuel-injector icon) · 4 **Ignition** · 5 UNKNOWN (twin exhaust tips) · 6 UNKNOWN (twin turbo/blower) · 7 **Valves** · 8 **Displacement** · 9 UNKNOWN (pistons/con-rods) · 10 **Oil / Cooling** · 11 **Flywheel** (row 3 col 3 empty → the list is 11 long).
Descriptions captured: Intake — "Intake upgrades help the engine inhale more freely and provide a lot of bang for the buck. Less restrictive air filters and a tuned intake manifold allow more air into the engine, making more power." · Ignition — "Ignition upgrades help the engine burn fuel more efficiently to produce more power. Adding better coils, spark plugs, and ignition wiring can make a significant difference in engine power and car performance." · Valves — "Valves allow the air and fuel mixture to enter and exit the engine. Upgrading these allows for more air flow increasing power." · Displacement — "Displacement upgrades make the engine more durable and less damage-prone. They can also reduce friction/inertia and increase displacement/compression to make the engine more powerful and responsive." · Oil / Cooling — "Adding oil cooling keeps the engine's oil at the correct temperature, aiding efficiency and increasing power." · Flywheel — "For a stock car, the rotating mass of the flywheel smoothes and steadies the rotation of the driveshaft, but it decreases throttle response and acceleration. Upgrading to a lighter-weight flywheel allows the engine to respond to the…"

**Sub-menus captured**
- `Intake` — 4 tiles: `Stock Intake` (INSTALLED) · UNKNOWN · `Sport Intake  CR 1,200` (`POWER +6 hp`) · `Race Intake  CR 1,800` (`POWER +10 hp`)
- `Oil / Cooling` — 3 tiles: stock (INSTALLED) · `Sport Oil / Cooling  CR 1,400` (`POWER +4 hp`) · UNKNOWN third
- `Flywheel` — pre-swap 3 tiles: `Stock Flywheel` (INSTALLED) · UNKNOWN · `Race Flywheel  CR 2,400` (`Weight -4 lb`); post-swap the grid shows 4 tiles

> **Disagreement:** on the *stock* powertrain (u_037/u_044) the Engine list read `Intake, fuel injectors, ignition, exhaust, turbo, camshaft, engine block, pistons, drum, intercooler, Oil / Cooling, Flywheel` (12). Post-V8-swap it is 11 with an intake-manifold tile in slot 2. **The Engine list is engine-specific** — a deliverable must not hard-code one order across engines.

### 2.2 `Platform and Handling` — 6 tiles, 3 × 2 (u_055 / u_373)
1 **Brakes** · 2 **Spring and Dampers** · 3 **Front Anti-roll Bars** · 4 **Rear Anti-roll Bars** · 5 **Chassis Reinforcement / Roll Cage** · 6 **Weight Reduction**

| Sub-menu | Options in order |
|---|---|
| `Brakes` | `Stock Brakes` (INSTALLED/OWNED) · `Sport Brakes  CR 1,300` (`EFFICIENCY -13%` in the post-swap state) · `Race Brakes  CR 1,950` (`EFFICIENCY +33%`) — banner `UNLOCKS BRAKE TUNING` |
| `Spring and Dampers` | 4 tiles: `Stock Spring and Dampers` (INSTALLED) · `Race Spring and Dampers  CR 2,050` (`RIDE HEIGHT -0.9…`) · `Rally Spring and Dampers  CR 2,050` (`RIDE HEIGHT +0.9…`) · `Drift Spring and Dampers  CR 2,050` (`RIDE HEIGHT -1.41 in`) — banner `UNLOCKS SPRING, DAMPER, AND ALIGNMENT TUNING` |
| `Front Anti-roll Bars` | `Stock…` (INSTALLED) · `Race Front Anti-roll Bars  CR 1,900` — banner `UNLOCKS FRONT ANTI-ROLL BAR STIFFNESS TUNING` |
| `Rear Anti-roll Bars` | `Stock Rear Anti-roll Bar…` (INSTALLED; tail of the string ghosted at u_068 — **UNKNOWN** whether "Bar" or "Bars") · second tile UNKNOWN |
| `Chassis Reinforcement / Roll Cage` | `Stock Chassis Reinforcement / Roll Cage` (INSTALLED) · UNKNOWN strut-brace tile · `Race Chassis Reinforcement / Roll…` *(clipped by the panel edge)* `CR 2,100` (`Weight +80 lb`, red) |
| `Weight Reduction` | stock (INSTALLED) · UNKNOWN · `Race Weight Reduction  CR 2,350` (`Weight -362 lb`) |

### 2.3 `Drivetrain` — 3 tiles, one row (u_085 / u_108)
1 **Transmission** · 2 **Driveline** · 3 **Differential**
- `Differential` — 4 tiles: `Stock Diff` (INSTALLED) · `Race Diff  CR 2,500` · `Drift Diff  CR 2,500` · `Offroad Diff  CR 2,500`; the three purchasable tiles carry a marquee sub-label that scrolls `DIFFERENTIAL 2-WAY`. Banner `UNLOCKS FULL DIFFERENTIAL TUNING`. All three previewed identically in the stats panel.
- `Transmission`, `Driveline` sub-menus: never opened — **UNKNOWN**

### 2.4 `Tires and Rims` — 8 tiles, rows of 3 / 3 / 2 (9th cell empty) (u_342 / u_362)
1 **Tire Compound** · 2 **Front Tire Width** · 3 **Rear Tire Width** · 4 **UNKNOWN** (stack-of-bare-rim-barrels icon — never highlighted in any frame) · 5 **Front Rim Style** · 6 **UNKNOWN** (second 5-spoke rim icon — never highlighted) · 7 **Front Rim Size** · 8 **UNKNOWN** (darker wheel-pair icon — never highlighted, but a screen titled `Rear Rim Size` is reachable, u_347)

| Sub-menu (screen title as written) | Observed options |
|---|---|
| `Tire Compound` | 3×3 scrolling grid; stock tile badged `OWNED`. Captured names: `Rally Tire Compound` (in basket, no price shown) and `Snow Tire Compound  CR 10,000` (`GRIP -0.13`, red). Remaining compound names **UNKNOWN** |
| `Front Tire Width` | `205 mm Front Tires` (INSTALLED, `205/50R15`) · `225 mm Front Tires  CR 1,800` (`225/45R15`) · `245 mm Front Tires  CR 2,200` (`245/40R15`) · `255 mm Front Tires  CR 2,400` (`255/40R15`). Grid grew from 4 to 7 tiles after the widebody/rim changes; the extra 3 were never highlighted |
| `Rear Tire Width` | `225 mm Rear Tires` (INSTALLED, `225/50R16`) · `265 mm Rear Tires  CR 2,600` (`265/40R16`) · `285 mm Rear Tires  CR 3,000` (`285/40R16`) · later state also `315 mm Rear Tires  CR 3,000` (`315/35R16`) · `325 mm Rear Tires  CR 3,400` (`325/20R20`, red chip) · `345 mm Rear Tires  CR 3,800` (`345/35R16`) |
| **`Rim Style`** ← note: the *tile* says `Front Rim Style`, the *screen title* is `Rim Style` (u_321) | Paged 3×3 grid of rim thumbnails + a brand card to the right of the name bar. `5Zigen 5ZR Copse  CR 3,200` (brand card "5ZIGEN / Team") · `American Racing VF300  CR 3,300` (`Weight -8 lb`, brand card "American Racing / SINCE 1956") |
| `Front Rim Size` | `15 in Front Rims` (INSTALLED) · `18 in Front Rims  CR 2,000` (`205/30R18` post-swap, `225/30R18` pre-swap) |
| `Rear Rim Size` | stock (INSTALLED) · `17 in Rear Rims  CR 1,800` (`345/30R17`) · `18 in Rear Rims  CR 2,000` (`345/25R18`) |

### 2.5 `Aero and Appearance` (u_186 / u_241)
Before the body kit: 2 tiles — 1 **Front Bumper**, 2 **Rear Wing**. After the Rocket Bunny kit is fitted: **only `Rear Wing` remains**.
- `Front Bumper` description: "You can upgrade your front bumper to increase the load over the front wheels by increasing downforce. These upgrades allow higher cornering speeds. Note that Race upgrades make downforce adjustable."
- `Rear Wing` description: "Upgrading the rear wing on your car increases the load over the rear wheels by generating downforce to allow higher cornering speeds. Note that Race upgrades make downforce adjustable."
- `Rear Wing` options: `Honda - Stock Rear Wing` (INSTALLED → later OWNED; badge `NONADJUSTABLE`) · `Rocket Bunny - Race Rear Wing  CR 5,000` (`ADJUSTABLE`) · `Forza Horizon 6 - Race Rear Wing  CR 5,000` (`ADJUSTABLE`). Banner `UNLOCKS REAR WING DOWNFORCE TUNING`.

### 2.6 `Body Kits and Conversions` — 4 tiles, 3 + 1
1 **Engine Swap** · 2 **Drivetrain Swap** · 3 **Aspiration** · 4 **Body Kit**
- `Engine Swap` — 5 tiles: `Stock Powertrain Swap` (INSTALLED, no price) · `1.6L I4 - Turbo Rally  CR 25,000` (`POWER -13 hp`) · `2.0L I4-T  CR 25,000` (`POWER +2 hp`) · `3.2L I6  CR 25,000` (`POWER +8 hp`) · `6.2L V8  CR 35,000` (`POWER +142 hp`). A second panel headed `Performance` shows the dyno graph.
- `Drivetrain Swap` — 2 tiles: stock (OWNED) · `AWD Drivetrain  CR 10,000`
- `Aspiration` — tile 1 INSTALLED, its name rendered mid-crossfade only ("Stoc… …Aspiration") → **UNKNOWN**; other tiles UNKNOWN
- `Body Kit` — 2 tiles: `Honda - Stock Body` (INSTALLED) · `Rocket Bunny - Widebody Kit  CR 20,000` (tile face is the "Rocket Bunny" wordmark)

### 2.7 Modals on exit
- **`Modified Car`** (u_386) — body: "Would you like to install this setup?" (the word *install* in yellow). Options top-to-bottom: `Install Parts` · `Go to Basket` · `Abandon Setup` · 4th option motion-blurred → **UNKNOWN**
- **`Saving...`** (u_388/u_391) — "Saving content. Please do not turn off your device." + spinner

---

## 3. TUNE SCREEN

**Title block:** `Tune`. **PI badge:** `A 700`. No drivetrain chip, no Advanced Camera toggle, no CR/part chips.

**Tab strip, in order** (bumper hints `LB` … `RB` at the ends; with mouse/keyboard those ends render as ◀ / ▶ buttons):
`LB` › **`TIRES` | `GEARING` | `ALIGNMENT` | `ANTIROLL BARS` | `SPRINGS` | `DAMPING` | `AERO` | `BRAKE` | `DIFFERENTIAL`** › `RB`
*(Confirmed identical at u_396, u_411, u_426, u_496, u_500, u_505, u_540. The player did not visit them in strip order — visit order was TIRES → GEARING → SPRINGS → ALIGNMENT → ANTIROLL BARS → DAMPING → AERO → BRAKE → DIFFERENTIAL — which is why two scanners disagreed on the strip. The strip order above is what is drawn on screen.)*

**Three-column body:** left `Performance` · centre = the tab's panels · right `Description` (text is row-specific; GEARING also draws a gear graph under it, y-axis `RPM (x1000)` gridlines `3`/`7`, x-axis `mph` ticks `0 / 95 / 191`).

Each centre panel = a green header carrying **panel name (left) + low-end caption + high-end caption + optional unit chip (far right)**, then its rows. Sliders are magenta-filled with a round handle; some tracks carry a small hollow marker and/or a triangular default marker. **No numeric min/max is ever printed — only the two word captions.**

| Tab | Panel header | Low / High captions | Unit chip | Rows in order | Values seen |
|---|---|---|---|---|---|
| `TIRES` | `Tire Pressure` | `Low` / `High` | `PSI` | `Front`, `Rear` | 26.0 → 19.5 ; 28.0 (1 dp) |
| `GEARING` | `Forward Gears` | `Speed` / `Acceleration` | — | `Final Drive`, `1st`, `2nd`, `3rd`, `4th`, `5th`, `6th`, `7th`, `8th`, `9th` | 4.11 → 4.25 → 4.56 ; 4.17/4.15 ; 2.95/2.75 ; 2.31/2.13 ; 1.88/1.85/1.73 ; 1.58/1.47 ; 1.33/1.27 ; 1.13/1.10 ; 0.90/0.93 ; 0.75/0.78 (2 dp) |
| `ALIGNMENT` | `Camber` / `Toe` / `Front Caster` | `Negative`/`Positive` ; `In`/`Out` ; `Low`/`High` | — (° inline) | Camber `Front`,`Rear` ; Toe `Front`,`Rear` ; Front Caster `Angle` | −1.8°, −1.5° (→ −0.7°, −0.4°) ; 0.0°, 0.0° ; 5.0° → 6.3° (1 dp + `°`) |
| `ANTIROLL BARS` | `ANTIROLL BARS` *(all caps, unlike other panel headers)* | `Soft` / `Stiff` | — | `Front`, `Rear` | 31.70 → 5.80 ; 25.20 → 65.00 (2 dp) |
| `SPRINGS` | `Springs` then `Ride Height` | `Soft`/`Stiff` ; `Low`/`High` | `LB/IN` ; `IN` | Springs `Front`,`Rear` ; Ride Height `Front`,`Rear` | 602.4 → 799.4 ; 921.6 (1 dp) ‖ 4.0 ; 3.9 (1 dp) |
| `DAMPING` | `Rebound Stiffness` then `Bump Stiffness` | `Soft`/`Stiff` (both) | — | Rebound `Front`,`Rear` ; Bump `Front`,`Rear` | 9.6→11.9 ; 14.0→9.2 ‖ 6.0→2.0 ; 8.7→2.4 (1 dp) |
| `AERO` | `Downforce` | `Speed` / `Cornering` | `LB` | `Front`, `Rear` | 163 ; 245 (integer) |
| `BRAKE` | `Braking Force` then `Braking Force` *(the header text repeats)* | `Rear`/`Front` ; `Low`/`High` | — | `Balance` ; `Pressure` | **LOCKED** — padlock glyph at the right of each row, grey track, **no numeric value**; Description panel shows a yellow note: `UNLOCKED BY INSTALLING RACE BRAKE UPGRADES.` |
| `DIFFERENTIAL` | `Front`, `Rear`, `CENTER` *(CENTER all-caps)* | `Low`/`High` ; `Low`/`High` ; `Front`/`Rear` | — (% inline) | Front `Acceleration`,`Deceleration` ; Rear `Acceleration`,`Deceleration` ; CENTER `Balance` | 100%, 0% ; 83→100%, 3% ; 60→63% (integer + `%`) |

---

## 4. Stats panels

### 4.1 Upgrade-screen stats panel — **two modes, swapped with `Y Toggle`**
Mode A — performance ratings (default), 6 rows, always this order:
`Speed` · `Handling` · `Acceleration` · `Launch` · `Braking` · `Offroad` — one decimal, max observed 10.0.
Mode B — engineering figures, 6 rows, always this order:
`Power` `<n> hp` · `Torque` `<n> ft·lb` · `Weight` `<n,nnn> lb` · `Front` `<n>%` · `PWR` `<n.nn> hp/lb` · `Displacement` `<n,nnn>` *(no unit shown)*.
Both modes render, to the right of the rows, the **preview PI badge** (with a change arrow when it differs) and the **drivetrain chip** (`AWD` with an axle glyph; `RWD` on the stock powertrain).
**Arrows are quality markers, not direction markers:** green ▲ = better, red ▼ = worse (u_290 shows `Weight ▼ 2,924 lb` while weight went *up*). No arrows are drawn when the currently-installed part is selected.
On Engine/Engine-Swap screens a second panel headed `Performance` sits to the right: y-axis ticks `1,000 / 500 / 0`, x-axis `RPM (x1000)` ticks `0, 4, 8` (V8) or `0, 5, 10` (stock/I4/I6), legend chips magenta `Torque (ft·lb)` and yellow `Power (hp)`.

### 4.2 Tune-screen `Performance` panel — 4 groups, fixed order
- **`Braking Distance`** — `60 mph – 0` `<n.n> ft` · `100 mph – 0` `<nnn.n> ft`
- **`Lateral Gs`** — `60 mph` `<n.nn>` · `120 mph` `<n.nn>`
- **`Acceleration & Speed`** — `0 – 60 mph` `<n.nnn>s` (3 dp) · `0 – 100 mph` `<n.nnn>s` · `Top Speed` `<nnn.n> mph`
- **`Miscellaneous`** — `Mech. Balance` `<n.nn>` · `Aero Balance` `<n.nn>` · `Aero Efficiency` `<n.nnn>` (3 dp)
No up/down arrows here. While the sim re-runs after a slider move, every value except the one still cached is replaced by the literal text `SIMULATING...` (u_486, u_540).

---

## 5. What a deliverable MUST match

1. **Names, exactly as written** — `Spring and Dampers` (singular "Spring"), `Chassis Reinforcement / Roll Cage` (spaced slash), `Oil / Cooling`, `Front Anti-roll Bars` / `Rear Anti-roll Bars` (hyphenated, lower-case "roll") in the *upgrade* menu **but** `ANTIROLL BARS` (one word, all caps) as the *tune* tab and panel header. `Tires and Rims`, `Body Kits and Conversions`, `Aero and Appearance` all use the word "and", never "&".
2. **Tile label ≠ screen title in one place**: the tile reads `Front Rim Style`, the screen it opens is titled `Rim Style`.
3. **Ordering** — reproduce the Upgrade Shop 3×2 order and the Tune strip order exactly; do not reorder tune tabs into the sequence a tuner would work in.
4. **Units and their placement** — the unit is a chip on the panel header (`PSI`, `LB/IN`, `IN`, `LB`), *not* on each value; `°` and `%` are inline on the value; `ft·lb` uses the middle dot; `hp/lb`; speeds in `mph`; distances in `ft`.
5. **Value formatting** — tire pressure/springs/ride height/damping/caster/camber = 1 dp · gear ratios = 2 dp · antiroll bars = 2 dp · downforce and differential = integers (differential with `%`) · 0–60/0–100 = 3 dp with a trailing `s` · Aero Efficiency = 3 dp · weights and displacement use a thousands comma.
6. **Prices** — `CR ` prefix, thousands comma, no decimals (`CR 2,050`, `CR 35,000`). The green name bar carries the item price; the panel footer carries the *running basket total* + *part count*, which is a different number and must not be confused with it.
7. **Part naming pattern** — `Stock <part>` / `Sport <part>` / `Race <part>` / `Rally <part>` / `Drift <part>` / `Offroad <part>`; brand parts are `<Brand> - <Part>` (`Honda - Stock Body`, `Rocket Bunny - Widebody Kit`, `Forza Horizon 6 - Race Rear Wing`); tires and rims are sized, `<n> mm Front Tires`, `<n> mm Rear Tires`, `<n> in Front Rims`, `<n> in Rear Rims`; engines are `6.2L V8`, `3.2L I6`, `2.0L I4-T`, `1.6L I4 - Turbo Rally`; diffs are `Race Diff` / `Drift Diff` / `Offroad Diff` (abbreviated "Diff").
8. **Unlock chain** — say which purchase unlocks which tune tab, in the game's own wording: Race Brakes → `UNLOCKS BRAKE TUNING`; any Race/Rally/Drift Spring and Dampers → `UNLOCKS SPRING, DAMPER, AND ALIGNMENT TUNING`; Race Front Anti-roll Bars → `UNLOCKS FRONT ANTI-ROLL BAR STIFFNESS TUNING`; any race diff → `UNLOCKS FULL DIFFERENTIAL TUNING`; an `ADJUSTABLE` rear wing → `UNLOCKS REAR WING DOWNFORCE TUNING`. A locked tune row shows a padlock and **no value** (BRAKE tab, u_500) — the deliverable cannot quote a brake number for an un-upgraded car.
9. **Conversions gate other menus** — after the Rocket Bunny body kit the `Front Bumper` tile disappears from `Aero and Appearance`, and after an engine swap the `Engine` list and the running part count change (`CR 65,500 | 14` → `CR 95,400 | 12`).
10. **Two stats modes** — if the deliverable quotes stats it must say which `Y Toggle` mode they come from, and keep each mode's six rows in the order above.

---

## 6. Scanner disagreements, resolved

- **Tune tab order** — settled by re-reading u_396/u_411/u_426/u_500/u_505: the strip is TIRES, GEARING, ALIGNMENT, ANTIROLL BARS, SPRINGS, DAMPING, AERO, BRAKE, DIFFERENTIAL. Reports that implied SPRINGS precedes ALIGNMENT were describing *visit* order, not the strip.
- **`Front Rim Style` vs `Rim Style`** — both are right; tile vs screen title (u_363 vs u_321).
- **Engine list contents** — the two post-swap reports agree with each other and with u_370; the pre-swap report describes a different (stock-engine) list. Not a transcription error — the list is engine-dependent.
- **u_060 (`Spring and Dampers`)** — one scanner reported the highlight box on tile 4 while the name bar read `Stock Spring and Dampers` with no price. That frame is mid-crossfade; treat the tile-4 name as `Drift Spring and Dampers` per the clean frame u_059.
- **Front Tire Width tile count (4 vs 7)** — both correct at different points in the session; the option list expands after the widebody/rim changes.
- **Rear Wing tile 2** — reported once as unnamed and once as `Rocket Bunny - Race Rear Wing  CR 5,000` (u_201); the named reading is from the clearer frame and is adopted.

## 7. Still UNKNOWN (nobody could read these; do not invent them)
Engine tiles 2, 3, 5, 6, 9 · `Transmission` and `Driveline` sub-menus (never opened) · `Aspiration` part names · `Rear Anti-roll Bars` second option and the exact tail of `Stock Rear Anti-roll Bar…` · the middle option of `Brakes`, `Weight Reduction`, `Chassis Reinforcement / Roll Cage`, `Oil / Cooling`, `Intake` (tile 2) · `Tires and Rims` tiles 4 and 6 · all `Tire Compound` names except `Rally` and `Snow` · the full `Rim Style` catalogue · the 4th option of the `Modified Car` dialog · the `View Basket`, `Setup Manager` and `Tune Browser` screens (never opened on camera).
---

## 8. Provenance

Extracted 2026-09-01 from `forzahorizon6_KUSQ0FOtXb.mp4` (12.6 min, 1992 Honda NSX-R) by an 8-agent
workflow over 758 frames at 1 fps; 125 distinct screens; two scanners per region, disagreements
reconciled against named frames (section 6). Everything unreadable is left UNKNOWN in section 7 —
do not fill those from other Forza titles.

---

## 9. Contextual dependency, confirmed on camera (2026-09-01)

Recording `forzahorizon6_XtE0aSrdbE.mp4`, the stock 1992 Honda NSX-R (B 572), 1 fps.

**9.1 The Engine menu's length depends on the fitted aspiration.** Frame 090: stock block, no
aspiration conversion — `Engine` shows **8 tiles** (3/3/2) with `Displacement` at row 2 col 2, and
**no forced-induction sub-menu at all**. Section 2.1's capture of the same menu, taken with the 6.2L
V8 fitted, shows **11**. So forced induction is bought in two places: the TYPE from
`Body Kits and Conversions > Aspiration` (tile 3), then the TIER from `Upgrade Shop > Engine`. Until
the conversion is installed the tier is unreachable.

**9.2 `Drivetrain Swap` is a 2-tile menu.** Frame 020: tile 1 `INSTALLED` (Stock Drivetrain), tile 2
`OWNED` (AWD Drivetrain). Header B 572 / RWD. Confirms 2.6.

**9.3 `Weight Reduction` is a 3-tile menu.** Frame 040: tile 1 `INSTALLED` (Stock Weight Reduction),
tile 2 unnamed, tile 3 `OWNED`. Preview panel reads Speed 4.9 · Handling 6.0 · Acceleration 5.2 ·
Launch 4.2 · Braking 5.4 · Offroad 5.5, badge B 588, drivetrain chip AWD.

**9.4 `Platform and Handling` confirmed 6 tiles** with `Spring and Dampers` on tile 2 (frame 060),
matching 2.2 exactly.

**9.5 Two index schemes coexist.** Conversion slots (`drivetrain`, `car_body`, `engine`) are per-car
lists whose index IS the 0-based tile position — 9.2 shows a 2-tile menu and the target's drivetrain
index is 1. Tier slots (`brakes`, ARBs, `springs_dampers`, `tire_compound`) use the sparse global
ladder, where the index can exceed the tile count. Match conversions by POSITION and tiers by NAME.

## 10. Upgrade Shop stats panel: five Y-toggle pages (observed 2026-09-01, NSX-R, Tire Compound menu)

The panel under the lime name bar cycles with **Y / Toggle** through five pages. Every page previews the **highlighted** tile applied to the current build; on the INSTALLED tile the pages describe the current build itself. Red/green triangles mark the delta versus the installed part.

| # | Page | Rows (verbatim) | Example on the Stock tile (clone build, installed compound = index 5) |
|---|---|---|---|
| 1 | Ratings | Speed, Handling, Acceleration, Launch, Braking, Offroad; PI preview box; drivetrain chip | 6.2 · 6.7▼ · 8.9▼ · 8.3▼ · 6.2▲ · 5.5▼ · A 681 · AWD |
| 2 | Power / Weight | Power, Torque, Weight, Front, PWR, Displacement | 440 hp · 307 ft·lb · 2,547 lb · 45% · 0.17 hp/lb · 3,400 |
| 3 | Braking Distance / Lateral Gs | 60 mph – 0, 100 mph – 0; 60 mph, 120 mph | 81.1 ft · 189.1 ft · 1.22 · 1.49 |
| 4 | Acceleration & Speed | 0 – 60 mph, 0 – 100 mph, Top Speed | 2.950 s · 6.783 s · 170.0 mph |
| 5 | Aerodynamics / Chassis | Efficiency, Balance; Mech. Balance | 0.809 · 0.42 · 0.59 |

Consequences: page 2 supplies mass and front weight fraction for the spring-rate bands (the My Cars stats screen is no longer needed); page 3 gives a per-compound grip ladder from the game's own model; page 5 gives the aero and mechanical balance of any build. Tile chips (e.g. GRIP -0.16) appear on the highlighted tile only and are deltas versus the installed part.

Tire Compound grid on the NSX-R: 9 tiles, scrollbar present. Tile 1 = "Stock Tire Compound (Street)" (catalogue row 78 is "Stock Tire Compound"; the class suffix is appended by the UI). INSTALLED badge on tile 8, whose save value is index 5.

### 10.1 Tire Compound grid, NSX-R, fully proven (2026-09-02)

Eleven tiles (three rows of three plus a fourth row of two; the scrollbar thumb is the only hint from the first screen). Index = save-file value, proven by one saved setup per tile.

| Tile | Name bar | Index | Lat G 60/120 | 60-0 / 100-0 ft | PI preview |
|---|---|---|---|---|---|
| 1 | Stock Tire Compound (Street) | 0 | 1.22 / 1.49 | 81.1 / 189.1 | A 681 |
| 2 | Street Tire Compound | 1 | 1.10 / 1.34 | 80.4 / 190.5 | A 684 |
| 3 | Sport Tire Compound | 2 | 1.12 / 1.37 | 79.5 / 185.8 | S1 701 |
| 4 | Semi-Slick Race Tire Compound | 3 | 1.32 / 1.62 | 76.4 / 181.0 | S1 727 |
| 5 | 'Horizon' Semi-Slick Race Tire Compound | 10 | 1.32 / 1.62 | 76.4 / 181.0 | S1 727 |
| 6 | Slick Race Tire Compound | 6 | 1.32 / 1.62 | 74.9 / 171.2 | S1 738 |
| 7 | Drift Tire Compound | 15 | 1.17 / 1.43 | 78.7 / 188.5 | S1 701 |
| 8 | Rally Tire Compound | 5 | 1.27 / 1.56 | 83.9 / 199.9 | S1 702 |
| 9 | Offroad Race Tire Compound | 7 | 1.05 / 1.29 | 80.1 / 192.5 | A 687 |
| 10 | Snow Tire Compound | 8 | 1.10 / 1.34 | 81.0 / 191.1 | A 684 |
| 11 | Drag Tire Compound | 9 | 1.10 / 1.35 | 83.9 / 205.4 | A 656 |

Menu order is not index order (tile 5 = 10, tile 7 = 15). A queued tile shows a small basket glyph in its corner and the INSTALLED badge leaves the current part while anything is queued; the footer CR shows the queued price. Installing a compound resets both tire-pressure sliders (0.400 F / 0.450 R normalised). Indices 4 and 11-14 are not offered on this car; catalogue rows 281, 300 and 303 remain unplaced.

Container folder timestamps (`Tuning_<ordinal>_<yyyymmddhhmmss>`) are UTC: the cmp6 save folder reads 20260902022442 while the matching screenshot is stamped 2026-09-01 22:24:37 local (UTC-4).

### 10.2 Transmission grid, NSX-R, proven (2026-09-02)

Six tiles. Every non-stock tile shows the yellow banner "UNLOCKS FULL GEAR RATIO TUNING". Index = save value minus 2102000, one saved setup per tile (trm1..trm6).

| Tile | Name bar | Index | 0-60 / 0-100 s | Top mph | Gear slots written | Default final drive |
|---|---|---|---|---|---|---|
| 1 | Stock Transmission | 0 | 3.000 / 6.900 | 150.8 | 6 | 3.40 |
| 2 | Race Transmission: 7 Speed | 4 | 2.967 / 6.900 | 169.4 | 7 | 3.63 |
| 3 | Race Transmission: 8 Speed | 5 | 2.933 / 6.883 | 169.3 | 8 | 3.86 |
| 4 | Race Transmission: 9 Speed | 6 | 2.900 / 6.833 | 169.3 | 9 | 4.11 |
| 5 | Race Transmission: 10 Speed | 7 | 2.950 / 6.800 | 170.0 | 10 | 4.41 |
| 6 | Drift Transmission: 4 Speed | 8 | 3.617 / 7.500 | 167.9 | 4 | 3.00 |

Installing a transmission rewrites all ten gear sliders and the final drive to that transmission's defaults; slots beyond its gear count become the -1.0 sentinel. Re-selecting the installed part writes nothing. Street, Sport, Race 6 Speed and Rally are not offered on this car (indices 1, 2, 3, 9 still unverified).

### 10.3 Differential and Driveline grids, NSX-R, proven (2026-09-02)

Differential: four tiles, banner "UNLOCKS FULL DIFFERENTIAL TUNING" on every non-stock tile. Driveline: two tiles.

| Menu | Tile | Name bar | Index | 0-60 / 0-100 s | Top mph | Slider defaults written on install |
|---|---|---|---|---|---|---|
| Differential | 1 | Stock Diff | 0 | 2.850 / 6.733 | 152.0 | center_diff 0.602, front_diff_accel 0.300, front_diff_decel 0.100, rear_diff_accel 0.550, rear_diff_decel 0.125 |
| Differential | 2 | Race Diff | 3 | 2.900 / 6.800 | 152.0 | unchanged from Stock values (no rewrite observed) |
| Differential | 3 | Drift Diff | 5 | 2.817 / 6.700 | 152.0 | front_diff_accel 0.100, front_diff_decel 0.000, rear_diff_accel 0.825, rear_diff_decel 0.025 |
| Differential | 4 | Offroad Diff | 6 | 3.000 / 6.883 | 150.8 | center_diff 0.500, front_diff_accel 1.000, front_diff_decel 1.000, rear_diff_accel 1.000, rear_diff_decel 1.000 |
| Driveline | 1 | Stock Driveline | 0 | 2.850 / 6.717 | 152.0 | none |
| Driveline | 2 | Race Driveline | 3 | 2.833 / 6.700 | 152.0 | none |

Differential installs rewrite the five differential sliders to the part's defaults (the Race diff kept the Stock values). Index 7 is not offered here; across 544 stored tunes index 4 never occurs and 7 occurs only on AWD rally-type cars, so 7 is probably Rally Diff (prove on the 2014 Golf R). Stored-tune coverage: transmission 1/2/3 and differential 7 and clutch 2 all on the Golf R; differential 2 and driveline 2 on the 2004 WRX STi; clutch 1 and driveline 1 on the 1989 Golf Rallye; differential 1 on the Autozam AZ-1; transmission 9 on the 2024 Revuelto.

Drivetrain category on the NSX-R has three tiles only: Transmission, Driveline, Differential. There is no Clutch tile on this car even though the save carries a stock clutch id; the Clutch menu exists on other cars (Race clutch on 55 stored tunes).

### 10.4 Platform and Handling grids, NSX-R, proven (2026-09-02)

| Menu | Tile | Name bar | Index | 60-0 / 100-0 ft | Lat G 60/120 | Banner | Sliders rewritten |
|---|---|---|---|---|---|---|---|
| Brakes | 1 | Stock Brakes | 0 | 85.5 / 197.6 | 1.22 / 1.50 |  | none |
| Brakes | 2 | Sport Brakes | 2 | 73.6 / 170.0 | 1.22 / 1.50 |  | none |
| Brakes | 3 | Race Brakes | 3 | 66.9 / 151.9 | 1.22 / 1.51 | UNLOCKS BRAKE TUNING | none |
| Spring and Dampers | 1 | Stock Spring and Dampers | 0 | 85.8 / 198.0 | 1.22 / 1.50 |  | 12 suspension sliders |
| Spring and Dampers | 2 | Race Spring and Dampers | 3 | 84.7 / 196.8 | 1.22 / 1.50 | UNLOCKS SPRING, DAMPER, AND ALIGNMENT TUNING | 12 suspension sliders |
| Spring and Dampers | 3 | Rally Spring and Dampers | 4 | 85.6 / 197.6 | 1.22 / 1.49 | UNLOCKS SPRING, DAMPER, AND ALIGNMENT TUNING | 12 suspension sliders |
| Spring and Dampers | 4 | Drift Spring and Dampers | 5 | 86.8 / 203.1 | 1.22 / 1.50 | UNLOCKS SPRING, DAMPER, AND ALIGNMENT TUNING | 12 suspension sliders |
| Front Anti-roll Bars | 1 | Stock Front Anti-roll Bars | 0 | 85.5 / 197.6 | 1.22 / 1.50 |  | front_arb 0.500 |
| Front Anti-roll Bars | 2 | Race Front Anti-roll Bars | 3 | 85.7 / 197.9 | 1.22 / 1.50 | UNLOCKS FRONT ANTI-ROLL BAR STIFFNESS TUNING | front_arb 0.480 |
| Rear Anti-roll Bars | 1 | Stock Rear Anti-roll Bars | 0 | 85.5 / 197.6 | 1.22 / 1.50 |  | rear_arb 0.500 |
| Rear Anti-roll Bars | 2 | Race Rear Anti-roll Bars | 3 | 85.7 / 197.9 | 1.22 / 1.50 | UNLOCKS REAR ANTIROLL BAR STIFFNESS TUNING | rear_arb 0.378 |
| Chassis Reinforcement / Roll Cage | 1 | Stock Chassis Reinforcement / Roll Cage | 100 (dense, variant 1) | 85.8 / 197.9 | 1.22 / 1.50 |  | none |
| Chassis Reinforcement / Roll Cage | 2 | Sport Chassis Reinforcement / Roll Cage | 101 | 86.0 / 198.2 | 1.22 / 1.50 |  | none |
| Chassis Reinforcement / Roll Cage | 3 | Race Chassis Reinforcement / Roll Cage | 102 | 84.8 / 198.5 | 1.22 / 1.49 |  | none |
| Weight Reduction | 1 | Stock Weight Reduction | 100 (dense, variant 1) | 86.7 / 202.6 | 1.19 / 1.43 |  | none |
| Weight Reduction | 2 | Sport Weight Reduction | 101 | 86.6 / 200.8 | 1.20 / 1.45 |  | none |
| Weight Reduction | 3 | Race Weight Reduction | 102 | 85.7 / 197.9 | 1.22 / 1.50 |  | none |

Spring kits rewrite camber, caster (both fields, including rear_caster: 0.667 stock, 0.000 on the kits), springs, ride height, bump and rebound to per-kit defaults. Rally sets ride height 1.000 and Drift 0.000 (band anchors); Race sets 0.327. Stock resets everything to 0.500. Anti-roll bar installs rewrite their own slider (front_arb 0.480 -> 0.500 on the stock bar).

Platform and Handling category grid on the NSX-R: six tiles in this order: Brakes, Spring and Dampers, Front Anti-roll Bars, Rear Anti-roll Bars, Chassis Reinforcement / Roll Cage, Weight Reduction (brake-disc, coilover, front bar, rear bar, X-brace, tyre-plus-battery icons).

Engine category grid on the NSX-R with the centrifugal supercharger conversion: twelve tiles in this order: Intake, Fuel System, Ignition, Exhaust, Camshaft, Valves, Displacement, Pistons, Centrifugal Supercharger, Intercooler, Oil and Cooling, Flywheel. The Intercooler tile exists only because forced induction is fitted; the clone save holds intercooler = EMPTY.
