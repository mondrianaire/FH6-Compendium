# Telemetry Lab — goals, implementation status, milestones

_Analysis pass · 2026-08-21 · covers `scripts/telemetry/*`, `dashboard/app.js buildLab()`, `data/{sessions,courses,builds,reference-loops.json}`_

## 1 · What the tab is for (telos)

Turn FH6 **Data Out** (324-byte UDP, ~60–150 Hz) into three deliverables, **live while driving**, with honest confidence:

| # | Deliverable | One-line definition | Owner workflow |
|---|---|---|---|
| D1 | **Course tuning** | Know what a course *is* (geometry + demands), how you drive each turn, and which slider / line change fixes each turn | 🏟 Course |
| D2 | **Build clone** | From a locked/downloaded tune, a standardized upgrade sheet (actual shop menus) + the sliders that make a replica drive identically | 🧬 Decode |
| D3 | **Free tuning** | Whole-session advisor: probe coverage → ranked, evidence-backed suggestions, plus live instruments | 🛣 Free Tuning |

Cross-cutting requirements Jett stated during the build (each is a goal in §3): auto-detect the workflow from the game state · runs = unit of an A/B re-tune · confidence must be *earned* (asymptotic, never from one reading) · inconsistency flagged as "more testing needed" · absence of data is data (course profile) · visual-first (almost no paragraphs).

## 2 · Architecture as built

```
FH6 (Data Out, UDP 9876)
   │ 324-byte packets
   ▼
fh6_live_daemon.py  ── CSV (captures/) ──▶ analyze_session.py ──▶ data/sessions/<id>.json
   │ SSE :8765 /events (snapshot·frame·strip·corner·stint·tag·lap·loop·mode·analysis·session·reset·config·status)
   │ POST /car /build /tag /role /reset /route /mark-start /clear-loop /mode /new-run  ·  GET /session.json /analysis /cars-map /health
   ▼                                                         │ writes: data/courses/<route>.json (course model) · reads: data/builds/*.json, data/reference-loops.json, <id>.tags.json
dashboard (buildLab)  SOURCE [🔴 live | 📼 recording] × WORKFLOW [🏟 Course | 🧬 Decode | 🛣 Free] (+ 🧭 auto when live)
```

Per-session analysis output (`analyze_session.py`): `cars` (config-keyed: signature, dyno, gears, evidence, coverage, advice, **decode battery**, **clone sheet**, build_record, grip) · `stints` (runs; daemon-recorded boundaries authoritative; labels/roles) · `events` (timed modes + reference-loop laps) · `courses` (profile, laps, **turns** earned across laps, **geometry** from coordinates, corner identity with limiter + **ref/last/delta/advice**, scoped advice, decode battery) · `corners`, `launches`, `braking`, `bottoming`, `pulses`, `crests`, `strip`.

## 3 · Goal-by-goal status

Legend: ✅ done & validated on real data · 🟡 built, partially validated / known gaps · 🔴 not built · ⚪ blocked on input

| Goal (Jett's words, condensed) | Status | Evidence / what exists | Gap |
|---|---|---|---|
| Decode Data Out fully (layout, fields, meaning) | ✅ | 89-field decoder; Peak% ≡ \|combined slip\|×100 proven by cross-correlation; IsRaceOn semantics; gear 11 = shift | No TireWear / track ordinal / pressures in the stream (confirmed absent) |
| Live stream → dashboard, one-click backend | ✅ | daemon + SSE + `start_lab.cmd`; replay mode; outdated-daemon warning | — |
| Auto-identify cars, granularity between similar builds | ✅ | 660-ordinal map; config id `ordinal\|drivetrain\|cyl\|PI`; build signature; per-run ladder detects gearing changes | Tune-only changes are behaviour-only (by nature) |
| Reset live; differentiate back-to-back re-tunes | ✅ | `/reset`; runs; tags; ➕ new run; mode-aware split rule | — |
| Confidence that keeps refining (asymptotic), inconsistency flagged | ✅ | `strength()` 1−e^(−1.2 n/req); consistency weighting; open items with `needs` | Wiggle / bottoming detectors still uncalibrated |
| Track / game-mode detection | ✅ | event vs free roam vs menu; rivals/timed vs race; route family by start position; user-named routes | Race kind is a heuristic (position > 2) |
| Course mode with recognition of the same corner | ✅ | apex clustering → C1..Cn; per-run values; consistency; first-red | — |
| Course mode togglable → became **auto-detected workflow** | ✅ | daemon suggests course/decode/free; manual override; only manual pushes to daemon | — |
| Reference loops (free-roam circuits, many laps) | ✅ | `/mark-start`, lap counting, synthetic events, Course-only controls | Start radius fixed 60 m / min 250 m |
| Decode battery (tests needed to clone) · honest dyno band | ✅ | 10 tests; band idle+1750 → min(96% redline, measured upshift); names missing rpm bins | — |
| Course profile: absence is data; course-weighted advice | ✅ | heavy/moderate/light/ABSENT dims; priority; notes; "rarely used on this course" | — |
| Decode roles by button; pinned donor that survives everything | ✅ | `/role`; pin with carried data; unpin = un-donor | Pin lives in the browser's localStorage (per machine) |
| Driver-vs-tune per corner | ✅ | limiter tune/driver/mixed with single-turn message | — |
| Tab reorg: source × workflow | ✅ | reviewed by 25-agent adversarial pass; 11 fixes applied | — |
| Lap tracking + turn count earned across laps | ✅ | laps per event/loop; presence; fragments absorbed; possible turns; per-lap grid | — |
| Clone sheet = deliverable, confidence per item from repeated measurements | ✅ | evidence per row (pulls through peak, per-gear frames/spread, boost repeatability, mass IQR…); 83 % donor Exocet | — |
| **Individual upgrade components** | ⚪ | build-record pipeline built & self-tested (verified / consistent / captured / contradicted) | **Needs the donor's shop + pane + tune-tab screenshots** — the stream cannot name parts |
| Course learning vs training; transfer between cars | ✅ | persistent course models; car-specific references; predicted apex = √(a_lat g r) from measured grip | Radius = radius of the *driven* line, not road edges |
| Map corners from coordinates | ✅ | curvature-based turns (≥12°); map SVG with latest lap overlaid | Single reference lap; no multi-lap consensus path yet |
| Replica convergence (Bench ledger) | 🟡 | charts + 7-group ledger + turn-next | **Never exercised on a real donor+replica pair** |
| HUD-clip channels (pressures, camber) | 🟡 | slots + protocol documented | Not wired to a capture/ingest step |
| Surface detection | 🟡 | SurfaceRumble 0/0.6 proxy noted | Calibration drive (grass/gravel/water) not done |
| Corner detector on fast, low-lat-g circuits | 🟡 | works on tight tracks | **Under-fires on fast circuits** (Jett's Rivals: ~3 detections/lap over 6 laps) |

## 4 · Milestones

### Reached
- **M1 Stream** — decode, capture, replay, live daemon, launcher.
- **M2 Identity** — cars, builds, runs, tags, roles, names.
- **M3 Advisor** — coverage probes, asymptotic confidence, open items.
- **M4 Course** — events/routes, course mode, corner identity, profile, laps, earned turn count, driver-vs-tune.
- **M5 Decode** — battery, honest dyno band, clone sheet with evidence-backed confidence, deliverable mode, pinned donor.
- **M6 Lab structure** — source × workflow, auto-detected workflow, mode-aware run splitting, reviewed.
- **M7 Course learning/training** — persistent course models, geometric maps, SHOULD-vs-AM per turn, car-specific references + grip-based prediction.

### Next (proposed order; acceptance criteria in **bold**)
| # | Milestone | Acceptance | Needs |
|---|---|---|---|
| M8 | **Donor components** | Exocet donor sheet lists every component with ✅/✓/📷 status; **0 contradicted**; PI sums | Jett: ~9 screenshots (shop categories, pane, tune tabs) |
| M9 | **First real convergence** | Replica run vs donor: ledger goes green on gearing + engine + brakes; **lap delta on the test loop < 0.5 %** | Replica built; runs tagged 🔧 |
| M10 | **Fast-corner detector calibration** | On the -1850_1600 circuit, behavioural corners ≥ 80 % of mapped turns per lap | Use 202122 + 162805 captures; lat-g / duration / speed-scaled gates |
| M11 | **Consensus course path** | Course model path = median over all clean laps; radius from consensus; **map stable across sessions** | Multi-lap alignment by nearest point |
| M12 | **HUD channels** | Pressures/camber clip → values attached to the run (ShareX watcher or manual entry); sheet rows for tires/alignment | Clip ingest step |
| M13 | **Regression harness** | `python scripts/telemetry/selftest.py` re-analyses the captured CSVs and diffs key numbers (turn counts, sheet confidence, laps) against golden values | — |
| M14 | **Surface calibration** | SurfaceRumble/WheelInPuddle map for tarmac/grass/gravel/water; advisor excludes off-tarmac corners | One calibration drive |
| M15 | **Ledger confidence tiers** | Each Bench ledger light carries strength (n events) like the sheet rows | — |

## 5 · Honest limitations (by design or physics)
- The stream **cannot name shop parts** (outputs are degenerate) — components come from the donor car's shop/pane/tune tabs; telemetry verifies.
- Mass index is noisy (±17 %) — weight tier comes from the pane, not the stream.
- Turn radius is the radius of the **driven** reference lap, not the road.
- Wiggle (yaw-decay) and bottoming detectors are experimental / uncalibrated.
- Race vs Rivals kind is heuristic; route identity is start-position + length (no track ordinal exists).
- The pinned donor is per browser (localStorage).

## 6 · Tech-debt watch
- `buildLab()` ≈ 600 lines in one function; `analyze_session.py` ≈ 1,100 lines, single `main()` — fine for now, but M13 (regression harness) should land before further growth.
- Two connected dashboards share one daemon: only manual mode overrides are pushed (fixed); tags/roles are daemon-side (safe).
- Session JSON grows with geometry/paths (~1 MB per long session) — acceptable; consider trimming `strip` for recordings bundled into `db.js` if Pages size becomes an issue.
