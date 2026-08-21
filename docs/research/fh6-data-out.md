# FH6 "Data Out" UDP telemetry — capabilities, implementation, and what it buys us

*Research dive, 2026-08-19. Four independent research angles + a verification pass over ~480 source fetches; one decoder-survey agent died mid-run, its ground is covered by the verify pass. Confidence tags: ✅ verified (official doc and/or ≥2 primary sources agree) · 🟡 probable · ❌ speculation.*

## Telos check
A FH6 tuning knowledge base + dashboard whose instruments currently depend on screen-recorded telemetry transcribed frame by frame; the decision is whether a Data Out capture pipeline replaces that, and what it unlocks.

## Scope
Researched: (A) the FH6 Data Out protocol — fields, format, setup, quirks; (B) capture/decode implementation and the tuning uses the community has built on it. Not researched: motion rigs, wheel hardware, third-party dashboard design, other games.

## Findings

### 1. FH6 has an official Data Out document, and the format is the FH4/FH5 one — byte for byte
- **Confidence:** ✅
- **Evidence:** Official Zendesk article 51744149102611 ("Forza Horizon 6 Data Out Documentation", 2026-05-15; HTML 403s but the JSON API serves it: `support.forza.net/api/v2/help_center/en-us/articles/51744149102611.json`). Fixed single format, **324 bytes**, little-endian, UDP one-way, **sent at the game's frame rate** (not a fixed 60 Hz — one user measured 128–140 pps uncapped, SimHub issue #2267), **only while actively driving** (not in menus, pauses, replays, rewinds, after finishing). Layout = 232-byte "Sled" + a 12-byte Horizon block (officially named now: `CarGroup` u32, `SmashableVelDiff` f32, `SmashableMass` f32) + the 79-byte dash tail at 244–322 + one undocumented trailing byte (always 0). Offsets empirically pinned against live FH6 captures by ClickClickMedia/Forza-6-telemetry (Speed at 256 == |Velocity| only at that offset), satyajiit's MOZA bridge, HorizonHaptics, 0x20F. Every FH5 parser works unchanged.
- **So what for the project:** No reverse-engineering needed — the decoder is a known 324-byte struct, and our scaffold ([scripts/telemetry/fh6_dataout_capture.py](../../scripts/telemetry/fh6_dataout_capture.py)) implements it with a self-check. Cost of acting: ~1 hour to first CSV. Cost of not acting: every future telemetry session stays a 4-agent frame-transcription job.

### 2. The field set: everything the Friction / Suspension / Body-Accel / General pages show — numerically, per frame
- **Confidence:** ✅
- **Evidence:** Per wheel (always FL, FR, RL, RR): `TireSlipRatio`, `TireSlipAngle`, `TireCombinedSlip` — *normalized*, "0 = 100% grip, |x| > 1.0 = loss of grip" (official); `WheelRotationSpeed` (rad/s); `NormalizedSuspensionTravel` (0 stretch … 1 compression) and `SuspensionTravelMeters`; `TireTemp` (one value per tire, °F on the wire — community consensus, never stated officially); `WheelOnRumbleStrip`, `WheelInPuddle`, `SurfaceRumble`. Whole-car: local-frame `Acceleration`/`Velocity` (X right, Y up, Z forward, m/s², m/s), `AngularVelocity` (X pitch, Y yaw, Z roll, rad/s), `Yaw/Pitch/Roll`, `Speed` (m/s), `Power` (W), `Torque` (Nm), `CurrentEngineRpm`/max/idle, `Boost` (psi), `Accel/Brake/Clutch/HandBrake` (0–255), `Gear` (u8; community: 0 = R), `Steer` (−127..127), `CarOrdinal`, `CarClass`, `CarPerformanceIndex`, `DrivetrainType` (0 FWD/1 RWD/2 AWD), lap/race times, `DistanceTraveled`, `PositionX/Y/Z`. Full offset table: see the appendix.
- **So what for the project:** The Friction page's Peak% is almost certainly `TireCombinedSlip × 100` (hypothesis — verify with one side-by-side capture); the Suspension page is `NormalizedSuspensionTravel`; Body Acceleration is `AccelerationX/Z`; General is the input/rpm/speed block. Four of our seven HUD pages become a CSV column set at 60–140 Hz instead of one reading per second from video.

### 3. What the stream does NOT carry — and why our hybrid workflow survives
- **Confidence:** ✅
- **Evidence:** No tire **pressure**, no **inner/middle/outer** temps (one bulk temp per tire), no **live camber**, no tire wear in Horizon (FM 2023 only), no brake temps, no damper velocity (derive by differentiating `SuspensionTravelMeters`), no slider values. Official field list + ClickClickMedia README ("what Data Out doesn't broadcast: tyre pressures, weather, per-tyre-zone temps, slider ranges") + co-driver DESIGN.md ("Forza only gives one temp per tire").
- **So what for the project:** The two dark-layer items we just extracted from the four favorite builds — **pressures and camber** — are exactly the ones that stay HUD-only. The right protocol is hybrid: Data Out for all dynamics, plus a 20-second HUD clip of Tires Misc + Heat for pressure/camber, aligned by `TimestampMS`. Transcription load drops from seven pages to two, and the two remaining are the static-reading ones (one frame each, not a timeline).

### 4. Setup and platform quirks
- **Confidence:** ✅ settings/ports/localhost; 🟡 Store-build loopback exemption
- **Evidence:** Settings › HUD and Gameplay (bottom): `Data Out` On/Off, `Data Out IP Address`, `Data Out IP Port` — three fields, no format selector, one destination (official; MOZA FH6 guide; DR Sim Manager). `127.0.0.1` is officially supported. **Avoid ports 5200–5300** ("the game binds its own outgoing socket to a port in this range" — official). Steam build: works at 127.0.0.1 with nothing extra (fh6-virtual_tcu, Steam forum reports). Microsoft Store/Game Pass build: package family `Microsoft.ForteBaseGame_8wekyb3d8bbwe`; the one documented Store user applied `CheckNetIsolation LoopbackExempt -a -n="Microsoft.ForteBaseGame_8wekyb3d8bbwe"` before packets arrived at localhost (SimHub #2267) — required by analogy with FH4/FH5, not proven necessary. Single destination means SimHub + our logger need a UDP mirror if both run.
- **So what for the project:** Pick a port outside 5200–5300 (scaffold default 9876). If Jett is on the Store build, run the exemption once; if Steam, nothing. Firewall must allow inbound UDP on the port (Private network).

### 5. The community already validated the analyses we care about — on this exact stream
- **Confidence:** ✅ that these methods exist in source; 🟡 that the thresholds generalize
- **Evidence:** ClickClickMedia/Forza-6-telemetry `laps.py`: **understeer index** = mean|front slip angle| − mean|rear slip angle| while cornering (gated on |lat g| ≥ 0.30, drift frames excluded via handbrake/steer/yaw rate; > 0.15 understeer, < −0.05 oversteer); wheelspin = slip ratio > 0.5 on driven wheels at throttle > 0.4; brake lock = wheel-speed deficit vs Speed (k calibrated from coasting frames); bottoming = normalized travel > 0.98 for ≥ 3 frames. Ojansen/co-driver: damper-velocity histograms and position×velocity scatter from differentiated travel. Multiple tools reconstruct gear ratios and dyno curves from WOT frames (speed/rpm per gear; power/torque vs rpm). ClickClickMedia also reports **no temperature→grip coupling found in FH6** over ~40 sessions (cold tires grip fine) — relevant to our cold-tire lab rule.
- **So what for the project:** Our whole Test Zero / test-battery dynamic layer becomes computable: the axle×phase diagnosis matrix (slip angle front vs rear by phase), the breakaway-margin test (combined slip trajectory), yaw-damping / the wiggle test (`AngularVelocityY` decay after a steering pulse), the braking-floor test (Brake + wheel-speed deficit + decel), launch (slip ratio vs time), and damper bump/rebound judgment (velocity histograms). Gear-ratio extraction from WOT frames recovers the **gearing tab directly** — a slider we could only bracket before. Dyno reconstruction verifies engine decodes against the donor's actual curve.

### 6. Recording practice and cost
- **Confidence:** ✅
- **Evidence:** ~250 MB/hour at 60 Hz CSV (ClickClickMedia); FH6 runs at frame rate so expect ~2× on an uncapped PC; sessions segmented by `IsRaceOn` + lap clock, closed after ~30 s stationary; lap fields populate in Rivals/Time Trial/races, not free-roam; `DistanceTraveled` is event-relative (negative behind a start line).
- **So what for the project:** Store raw CSV per session (cheap), keep a downsampled per-second sidecar for the dashboard. Lab runs are 30–120 s, so file size is a non-issue.

## Recommendations

| Path | Effort | Coverage | Risk |
|---|---|---|---|
| **A — Capture scaffold now** (done: `fh6_dataout_capture.py`): record CSV, layout self-check, quick-look stats, and settle the 5 empirical unknowns on the first run | 1 h (Jett: toggle setting + one drive) | Dynamics pages (Friction/Suspension/BodyAccel/General) | low — known struct, self-checking |
| **B — Analysis layer**: phase segmenter (brake/throttle/steer/lat-g), understeer index per phase, spin/lock/bottoming flags, damper-velocity histograms, gear-ratio + dyno extraction → writes into the Tune Lab `results_log` | 1–2 days | Automates the test battery's dynamic tests and gearing decode | med — thresholds need calibration on our lab venue |
| **C — Hybrid protocol + dashboard ingest**: Data Out session + 20 s HUD clip (pressure/camber) aligned by TimestampMS; session import into the dashboard (the refresh plan's MEASURE/VERIFY sections) | later phase | Full instrument coverage | low once A/B exist |

**Author's pick:** A immediately — it costs Jett one setting toggle and a drive, and the first CSV answers the open questions below empirically. Then B, because it turns the battery's hardest tests (yaw damping, breakaway margin, damper judgment) from "feel + video" into measured curves, and recovers the gearing tab outright.

## First live capture (2026-08-21, Xbox-app build) — results
- ✅ Loopback exemption on `Microsoft.ForteBaseGame_8wekyb3d8bbwe` + Data Out 127.0.0.1:9876 → packets at **~139 pps** (frame rate). Layout self-check **259/259**: the 324-byte struct is correct on this build.
- ✅ **IsRaceOn = 1 in free roam.** IsRaceOn = 0 frames ARE sent, fully zeroed (17,104 frames across menus/pauses/car swaps) — the stream never went silent (no gap > 0.25 s). The official "not sent during menus/pauses" is loose; detect non-driving by `IsRaceOn == 0`.
- 🟡 Gear: **0 = reverse and neutral/stationary** (frames seen reversing, stationary, and idle-rolling); **11 = shift-in-progress transient** (339 frames at 24 m/s / 7,556 rpm clustered at upshifts).
- ✅ CarClass enum is Horizon 0-based: an A 700 car reports 3 (D0 C1 B2 A3 S1 4 S2 5 X 6).
- ✅ Impact frames show as lat-g spikes (6–10 g) — discard `|lat g| > 3 g` or `SmashableVelDiff > 0` frames, mirroring the friction-page rule.
- ✅ Gear ratios recovered from WOT frames (1st→4th ratio ladder 1.00 / 1.42 / 1.84 / 2.36) — the gearing tab of a locked tune is now measurable.
- ✅ **Peak% == |TireCombinedSlip| × 100, instantaneous.** 38 Friction-page frames cross-correlated against the capture (offsets −60..+60 s, hold windows 0–3 s, three slip series): best fit combined slip / no hold / offset −26.4 s, median log-error 0.086; exact matches at stable moments (800/811 ↔ 803/812; 1,018/1,023 ↔ 1,019/1,002). Slip ratio and slip angle fit far worse. The red ring = combined slip > 1.0. The friction-diagnosis framework is fully computable from the stream.
- Alignment note: ShareX video mtime lagged the recording end by ~26 s — align HUD clips to captures by content, or start both on a visible event.
- Still open: `WheelInPuddle` type (no puddles driven), `CarGroup` semantics (47 seen on the A 700 car).

## Unknowns + stopping criteria
- **Unresolved, settle on first capture:** (1) `WheelInPuddle` wire type — official FH6 says s32 0/1, FM doc and every FH6 parser read f32 depth (same bytes; the scaffold logs it as f32 and prints the raw value); (2) `IsRaceOn` value in free roam (tools disagree 0 vs 1); (3) whether FH6 goes fully silent when paused or emits zeroed frames; (4) gear encoding (0 = R per one parser; neutral unknown); (5) actual packet rate on Jett's PC (tracks FPS cap?); (6) whether Peak% on the Friction page == `TireCombinedSlip × 100`; (7) `CarGroup` value semantics (FH5 community category table probably applies — ❌).
- **Could not verify:** the FM7 forum URL cited by one agent; "SimHub default port 5555" (it's DR Sim Manager's); nikidziuba parser; FH6 Tech's inference method (site unreachable). The official Forza forums closed July 2026 — the historic FH4/FH5 struct threads are gone except one Wayback capture.
- **Stopped because:** ≥3 independent primary sources agree on every claim that drives the recommendation (official doc + three decoder codebases with live-capture tests), and the remaining unknowns are empirical, not researchable.
- **Would change the recommendation:** if Jett's build is Store and the loopback exemption fails, run the listener on a second machine/phone on the LAN (point Data Out at its LAN IP) — same scaffold, different IP.

## Appendix — authoritative 324-byte layout (little-endian)

| Off | Type | Field | Unit / meaning |
|---:|---|---|---|
| 0 | s32 | IsRaceOn | 1 driving, 0 menus |
| 4 | u32 | TimestampMS | ms, can overflow |
| 8/12/16 | f32 | EngineMaxRpm / EngineIdleRpm / CurrentEngineRpm | rpm |
| 20/24/28 | f32 | AccelerationX/Y/Z | local; X right, Y up, Z fwd (m/s²) |
| 32/36/40 | f32 | VelocityX/Y/Z | local (m/s); \|V\| == Speed |
| 44/48/52 | f32 | AngularVelocityX/Y/Z | rad/s; X pitch, Y yaw, Z roll |
| 56/60/64 | f32 | Yaw / Pitch / Roll | radians |
| 68–80 | f32×4 | NormalizedSuspensionTravel FL/FR/RL/RR | 0 max stretch … 1 max compression |
| 84–96 | f32×4 | TireSlipRatio | normalized; \|x\|>1 = lost grip |
| 100–112 | f32×4 | WheelRotationSpeed | rad/s |
| 116–128 | s32×4 | WheelOnRumbleStrip | 1/0 |
| 132–144 | s32 (FH6 doc) / f32 (parsers) | WheelInPuddle | disputed — log raw |
| 148–160 | f32×4 | SurfaceRumble | FFB value |
| 164–176 | f32×4 | TireSlipAngle | normalized |
| 180–192 | f32×4 | TireCombinedSlip | normalized (Peak% candidate) |
| 196–208 | f32×4 | SuspensionTravelMeters | m |
| 212/216/220/224/228 | s32 | CarOrdinal / CarClass / CarPerformanceIndex / DrivetrainType / NumCylinders | class 0=D..; PI 100–999; 0 FWD 1 RWD 2 AWD |
| 232 | u32 | CarGroup | Horizon-only (FH6 named) |
| 236/240 | f32 | SmashableVelDiff / SmashableMass | m/s, kg; 0 outside collisions |
| 244/248/252 | f32 | PositionX/Y/Z | world m |
| 256/260/264 | f32 | Speed / Power / Torque | m/s, W, Nm |
| 268–280 | f32×4 | TireTemp FL/FR/RL/RR | °F (community) |
| 284/288/292 | f32 | Boost / Fuel / DistanceTraveled | psi, 0–1, m |
| 296/300/304/308 | f32 | BestLap / LastLap / CurrentLap / CurrentRaceTime | s |
| 312 | u16 | LapNumber | |
| 314–319 | u8 | RacePosition, Accel, Brake, Clutch, HandBrake, Gear | 0–255; gear 0 = R |
| 320/321/322 | s8 | Steer / NormalizedDrivingLine / NormalizedAIBrakeDifference | −127..127 |
| 323 | u8 | (undocumented) | always 0 |

Sources (primary): official FH6 doc (Zendesk 51744149102611), official FM 2023 doc (21742934024211), ClickClickMedia/Forza-6-telemetry (`app/packet.py`, `tests/test_packet.py`, `app/laps.py`), 0x20F/forza-telemetry (`src/decoder/formats.rs`, `units.rs`), grimsi/ForzaTelemetryReader, richstokes/Forza-data-tools (`FH4_packetformat.dat`), haritha99ch/HorizonHaptics, Ojansen/co-driver (`DESIGN.md`), satyajiit/forza-horizon-6-moza-bridge, SimHub issue #2267, MOZA FH6 support article, DR Sim Manager FH6 docs.
