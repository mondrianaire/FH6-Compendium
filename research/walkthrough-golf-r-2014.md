# Tune Walkthrough — 2014 VW Golf R (B-class, road/touge, AWD)

Built from the in-game footage of this exact car (PI 589). Goes tab-by-tab in
the in-game order. Pole directions are screenshot-verified, so "move toward X"
is literally what the slider says.

**Status of your build:** Tires, Alignment, Springs, Damping are **unlocked**.
Gearing, Antiroll Bars, Aero, Brake, Differential are **🔒 locked** — they show
"UNLOCKED BY INSTALLING [race part]". You must install that part before those
values can be set. ⚠️ At 589 PI with ~11 to the 600 B-cap, you cannot unlock all
five and stay in B — see "Parts priority" at the end.

Legend: **Current → Target** (and which pole to move toward).

---

## 1. TIRES  ✅ unlocked
Section *Tire Pressure* · poles Low ↔ High · PSI

| Slider | Current | Target | Why |
|---|---|---|---|
| Front pressure | 27.0 | **27.0** (keep) | Aim ~31–33 **hot**. 27 cold is right; re-check after a hot lap. |
| Rear pressure | 27.0 | **27.0** (keep) | Equal F/R is fine for AWD road. |

---

## 2. GEARING  🔒 locked (needs Sport/Race transmission)
Section *Forward Gears* · poles Speed ↔ Acceleration · 6-speed
- **Tune LAST, while driving.** Toward **Acceleration** = shorter/quicker; toward **Speed** = taller/more top end.
- Touge/city: shorten **Final Drive** (toward Acceleration) so you pull hard out of hairpins. Highway zones: lengthen it.
- Set Final Drive so the top gear's line just reaches the right edge of the speed graph.

---

## 3. ALIGNMENT  ✅ unlocked
Sections *Camber* (Neg↔Pos) · *Toe* (In↔Out) · *Front Caster* (Low↔High) · degrees

| Slider | Current | Target | Why |
|---|---|---|---|
| Front camber | −2.0 | **−1.3** | −2.0 is too aggressive — the in-game note warns it cuts straight-line braking/accel. Recover braking grip. |
| Rear camber | −1.5 | **−1.0** | It's AWD; too much rear camber hurts corner-exit traction. |
| Front toe | 0.0 | **0.0** | Leave neutral. (Optional −0.1 *Out* for sharper turn-in.) |
| Rear toe | 0.0 | **0.0** | Leave neutral. (Optional +0.1 *In* if the rear feels nervous at speed.) |
| Front caster (Angle) | 5.0 | **6.5** (toward High) | Free win — sharper turn-in + self-centering, almost no downside. |

---

## 4. ANTIROLL BARS  🔒 locked (needs Race ARBs)
Section *Antiroll Bars* · poles Soft ↔ Stiff · scale ~1–65

| Slider | Install then set | Why |
|---|---|---|
| Front ARB | **~32** | Softer front lets the nose bite. |
| Rear ARB | **~38** (stiffer than front) | Stiffer rear rotates the car, fighting the AWD push. |

---

## 5. SPRINGS  ✅ unlocked
Sections *Springs* (Soft↔Stiff, LB/IN) · *Ride Height* (Low↔High, IN)

| Slider | Current | Target | Why |
|---|---|---|---|
| Front spring | 838.0 | **~800–838** (keep / soften slightly) | Already stiff & front-biased (good for tarmac). If it understeers, soften front ~5%. |
| Rear spring | 661.7 | **~680–700** (stiffen slightly) | Nudging rear up adds rotation. |
| **Front ride height** | **7.2** | **~5.0** (toward Low) | **Biggest change here.** 7.2" is tall — drop it for lower CG and much more road grip. |
| **Rear ride height** | **6.9** | **~5.0** (toward Low) | Same. Keep F ≈ R (or front a hair lower for turn-in). Stop just above where it bottoms out. |

---

## 6. DAMPING  ✅ unlocked
Sections *Rebound Stiffness* + *Bump Stiffness* · poles Soft ↔ Stiff · (1-decimal)

| Slider | Current | Target | Why |
|---|---|---|---|
| Front rebound | 13.2 | **13.2** (keep) | Rebound ≈ 1.6× bump already — a healthy ratio. |
| Rear rebound | 9.4 | **9.4** (keep) | Good. |
| Front bump | 8.3 | **8.3** (keep) | Leave. |
| Rear bump | 5.9 | **5.9** (keep) | Leave. |

Your damping is well-judged. Only touch it after lowering the ride height: if the
car feels harsh/skippy over bumps, soften **bump** a point or two.

---

## 7. AERO  🔒 locked (needs race front bumper / rear wing)
Section *Downforce* · poles Speed ↔ Cornering

- Toward **Cornering** = more grip, less top speed; toward **Speed** = less drag.
- Touge: add rear downforce (toward Cornering). Watch the **Aero Balance** readout — target **~0.40–0.50** (FH6's new mechanic; don't just max the front).

---

## 8. BRAKE  🔒 locked (needs Race brakes)
Section *Braking Force* · Balance (Rear↔Front) · Pressure (Low↔High)

| Slider | Install then set | Why |
|---|---|---|
| Balance | **~52% toward Front** | Slight forward bias = stable braking. Move toward Rear for more trail-brake rotation. |
| Pressure | **100%** | Drop a few % only if you lock up with ABS off. |

---

## 9. DIFFERENTIAL  🔒 locked (needs Sport/Race diff) — AWD = 3 sections
*Front* (Accel/Decel, Low↔High) · *Rear* (Accel/Decel) · *CENTER* (Balance, Front↔Rear)

| Slider | Install then set | Why |
|---|---|---|
| Front accel | **~10–15%** | Keep front loose to avoid understeer on power. |
| Front decel | **0%** | No front lock off-throttle. |
| Rear accel | **~50%** | On-power traction without snapping. More if it spins on exit. |
| Rear decel | **~20%** | Light off-throttle stability. |
| **Center balance** | **~70% toward Rear** | This IS the "30/70 split" — rear-biased rotation with AWD launch. |

*(Accel/decel numbers are contested across sources — these are starting points; road-tune by feel.)*

---

## Parts priority (you can't unlock everything and stay in B)
With ~11 PI to the 600 cap, unlocking five race parts will blow the class. Rank:
1. **Race brakes** — cheap PI, big braking + rotation gain. Unlock first.
2. **Race ARBs** — unlocks rotation tuning; moderate PI.
3. **Sport/Race differential** — big handling lever for AWD.
4. **Sport transmission** (final drive) — only if gearing feels wrong for your routes.
5. **Race aero** — heaviest PI cost; skip unless on a grippy technical circuit.

To fit them you'll likely need to **drop power back** (re-check engine/turbo upgrades)
so the grip parts fit under 600. If you'd rather not cut power, build to **A-class
(700 cap)** instead and add all five.

## Dirt/rally variant (if you switch disciplines)
Rally tires; raise ride height (don't lower it); soften springs + damping ~30%;
tire psi ~3 lower; raise rear diff **decel** lock for stability; center bias a bit
more rearward.

---
---

# BUILD A — "IN CLASS" (B, cap 600)

> **Data honesty:** part TIERS below are exact menu selections (game data). Exact
> PI per part is car-specific and only on the in-game bar — install in the order
> shown and **stop adding when the badge would flip from B**. Trust the PI bar over
> any total I estimate.

## B — Upgrade menu selections (Cars → Upgrades & Tuning)
Go category by category; select the listed tier:

**Conversion**
- Engine Swap: **Stock** (no swap)
- Drivetrain: **AWD** (stock — keep)
- Aspiration: **Single Turbo** (stock turbo — keep)
- Body Kit: **Stock** (a widebody costs PI you need for grip)

**Tires & Rims**
- Compound: **Sport** (Race compound is the single biggest grip gain but PI-heavy — only if the bar allows)
- Front tire width: **+1 step** (cheap front grip on this nose-heavy AWD)
- Rear tire width: **Stock** (save PI)
- Rims: lightweight optional (minor)

**Platform & Handling** — the grip core, install in this order:
1. Brakes: **Race** ⭐ unlocks Brake tab
2. Springs & Dampers: **Race** ✅ (already installed on your car)
3. Front Anti-roll Bar: **Race** ⭐ / Rear Anti-roll Bar: **Race** ⭐ unlocks ARB tab
4. Weight Reduction: **Sport** (Race if PI allows)
5. Chassis/roll cage: **Stock** (skip — weight + PI)

**Drivetrain**
- Differential: **Race** ⭐ unlocks Diff tab (or Sport to save a little PI)
- Transmission: **Stock** (skip unless gearing feels wrong; Sport = final-drive only)
- Clutch / Driveline: **Stock** (skip for B)

**Engine** (power LAST — keep minimal)
- Intake: **Race** (cheap power, per the ForzaFire B build)
- Everything else (exhaust, cam, valves, displacement, fuel, ignition, flywheel): **Stock**

**Aero & Appearance**
- Front bumper / Rear wing: **Stock** (race aero is the heaviest PI — skip on B)

### If the bar goes over 600, cut in this order:
Race compound → Sport · drop front tire width · Diff Race → Sport · Intake Race →
Street · Weight Race → Sport. Keep brakes + ARBs (they're the point).

## B — Tune (your unlocked tabs use YOUR real footage values)

| Screen | Setting | Value |
|---|---|---|
| Tires | F / R psi | 27.0 / 27.0 (≈31–33 hot) |
| Alignment | Camber F / R | −1.3 / −1.0 |
| | Toe F / R | 0.0 / 0.0 |
| | Caster | 6.5 |
| Springs | Spring F / R | ~800 / ~700 lb/in |
| | Ride height F / R | ~5.0 / ~5.0 in (down from 7.2/6.9) |
| Damping | Rebound F / R | 13.2 / 9.4 (keep) |
| | Bump F / R | 8.3 / 5.9 (keep) |
| Antiroll Bars *(after Race ARB)* | F / R | 37 / 39.5 — then nudge to put **Mech. Balance ≈ 0.60** (yours is 0.44 = understeer) |
| Brake *(after Race brakes)* | Balance / Pressure | 52% Front / 100% |
| Differential *(after Race diff)* | Front accel / decel | 23% / 13% |
| | Rear accel / decel | 68% / 28% |
| | Center balance | 60% Rear |

*(ARB & diff numbers are the ForzaFire community build for this platform — real FH6
data, but road-tune from there. Mech. Balance target 0.55–0.65 is a 🟡 community figure.)*

---

# BUILD B — "MAX / OPTIMAL" (lands A→S1, cap read in-game)

> "Optimal" = best performance regardless of class. Max the grip package, then add
> power until you hit the class you want to race (A = 700, S1 = 800). Watch the bar.

## MAX — Upgrade menu selections

**Conversion**
- Engine Swap: **Stock** (the 2.0T scales well; swap only if chasing S2+)
- Drivetrain: **AWD** (keep — it's the car's strength)
- Aspiration: **Single Turbo** (upgrade the turbo in Engine below)
- Body Kit: **Widebody** (wider track + allows max tire width = grip)

**Tires & Rims**
- Compound: **Race / Slick** (road) or **Rally** (mixed)
- Front + Rear tire width: **Max**
- Rims: lightweight, size to fit

**Platform & Handling** — all **Race**:
- Brakes **Race** · Springs & Dampers **Race** · Front ARB **Race** · Rear ARB **Race**
- Weight Reduction **Race** · Chassis/roll cage **Race**

**Drivetrain** — all **Race**:
- Differential **Race** · Transmission **Race** (unlocks up to 10 gears) · Clutch **Race** · Driveline **Race**

**Engine** — full build (add to target class):
- Intake, Exhaust, Camshaft, Valves, Displacement, Fuel, Ignition, Flywheel, Oil & Cooling, Turbo: **Race / max**
- Stop adding engine parts when the bar reaches your target (A 700 / S1 800).

**Aero & Appearance**
- Front bumper **Race** + Rear wing **Race** (unlocks both downforce sliders)

## MAX — Tune

| Screen | Setting | Value |
|---|---|---|
| Tires | F / R psi | 27–28 / 27–28 (target 31–33 hot) |
| Gearing *(Race trans)* | Final drive | road-tune; longer for top-speed tracks, shorter for technical |
| Alignment | Camber F / R | −1.3 / −1.0 |
| | Toe F / R | 0.0 / 0.0 (opt +0.1 rear In) |
| | Caster | 6.5 |
| Springs | Spring F / R | stiffer than B (toward Stiff; ~10–15% up) |
| | Ride height F / R | ~4.5–5.0 in (lowest without bottoming) |
| Damping | Rebound F / R | ~13–15 / ~10 |
| | Bump F / R | ~8–9 / ~6 |
| Antiroll Bars | F / R | 37 / 42 — tune to Mech. Balance ≈ 0.60 |
| Aero | Front / Rear downforce | toward **Cornering**; set Aero Balance ≈ 0.45 |
| Brake | Balance / Pressure | 52% Front / 100% |
| Differential | Front accel / decel | 20% / 10% |
| | Rear accel / decel | 60% / 25% |
| | Center balance | 65–70% Rear |

*(With more power than the B build, expect to stiffen the rear ARB and lean the
center diff slightly more rearward to keep rotation. Road-tune on your usual route.)*
