# FH6 data availability — the map for any agent

A general onboarding reference: what driving / telemetry / track / game data this project holds, *where it
comes from*, and *whether a "sanitized" branch keeps it*. Hand it to any new agent alongside
[`DATA-INVENTORY.md`](DATA-INVENTORY.md) (the exhaustive store index) — this doc is the **shape**, the inventory
is the **catalogue**.

**Visual (Eraser, team-shared):** https://app.eraser.io/workspace/Ex1bEXcuOL57kK2O5OQg — the diagram DSL is
mirrored in the appendix below so this file stands alone without Eraser access.

Living doc — add a row when a store or a live-decode call site changes. Grounded in a code audit (2026-09-12):
`fh6_live_daemon.py`, `fh6_tune_decode.py`, `fh6_anchors.py`, the `import_*.py` pipeline,
`fh6_dataout_capture.py`, `DATA-INVENTORY.md`, `schema.sql`. Every claim traces to a file:line.

The drift-scoring tool is **one example** consumer, not the frame — the map serves any improvement.

## The two axes

Every data node is tagged on both axes.

**Value type** — which game system the data describes / impacts:

| Tag | Value type |
|---|---|
| **ID** | car identification (which car + build) |
| **TEL** | driving telemetry (motion, slip, tyre, engine) |
| **CRS** | course / track / position |
| **TUN** | tuning / parts / sliders |
| **LAP** | lap history / race timing |
| **INP** | driver input (steer, pedals, gear, handbrake) |
| **STR** | reference strings / names |

**Provenance** — where the data comes from, and the sanitized-branch disposition (diagram group colour):

| Colour | Provenance | What it means | Sanitized branch |
|---|---|---|---|
| green | **official-feature** | The FH6 *Data Out* UDP telemetry — a developer-supplied, in-game feature (Settings ▸ HUD and Gameplay ▸ Data Out). No reverse-engineering. | **Keep** — the sanctioned live source |
| red | **live-decode** | Game private files decoded *on the fly while the daemon serves* | **The target** — minimize / cut / replace with a committed snapshot |
| blue | **decoded-once-committed** | Game files decoded **offline** by `rebuild.py`, then committed into `fh6.db`; game not touched at runtime | **Freeze** — ship the committed store, drop the runtime need |
| teal | **derived-ours** | Our own computation; no game data at all | **Keep** — already clean |

> The line (audit, verbatim): *a field present in the 324-byte Data Out packet is official and sanctioned;
> anything pulled from a decoded save, database, or BXML/zip artifact is derived and unofficial — no matter how
> thoroughly cross-verified.*

## Master matrix — every source & store

| Source / store | Location | Provenance | Value types | Live-decode? | Note |
|---|---|---|---|---|---|
| **FH6 Data Out UDP packet** | network | official-feature | TEL · ID · LAP · CRS · INP | yes (feature) | The **only** dev-supplied live feed; 324 B, ~60 Hz → `fh6_live_daemon` :8765 → SSE |
| `Tuning_*/Data` saves | game disk | live-decode **+** committed import | TUN · ID | **yes** | Live via `/disk-tune` + `disk_watcher` (1.5 s); also batch-imported by `import_containers` |
| Livery container + `Thumb.webp` | game disk | live-decode | STR · ID | **yes** | `/liveries`, `/livery-thumb`; raw header parse `_livery_strings` |
| `race_triggers.tz` | game disk | live-decode **+** committed import | CRS | **yes** | Re-parsed by every `analyze_session` subprocess; also committed → `route_anchor` |
| `FH6_Database.sqlite` (205 tbl) | game disk | committed | ID · TUN · STR | no | `import_gamedb` → `ref_*` |
| `ObjectModelGame.zip` (BXML) | game disk | committed | CRS · STR | no | `import_objectmodel` → `ref_track_info` …; 88/88 Rivals bound |
| `Route*.owt/.nav` + `Brio_00.nav` | game disk | committed | CRS | no | `import_surface` → `ref_route*` (169 centre-lines) |
| `EN.zip` string tables | game disk | committed | STR | no | → `ref_string` (58 722 strings) |
| `fh6.db` `ref_*` layer | our disk | committed | ID · TUN · STR · CRS | no | Rebuilt wholesale; never re-decoded live |
| `fh6.db` `hw_package`/`tune_*` | our disk | committed (grouping ours) | ID · TUN | no | Save decode resolved against `ref_*` at import; Car→Hardware→Tune hierarchy |
| `fh6.db` `lap`/`lap_point`/`corner_segment` | our disk | derived-ours | LAP · TEL · CRS | no | Computed from UDP captures (`analyze_session`/`import_telemetry`) |
| `fh6.db` `course`/`course_route` | our disk | derived (`ref_route*` committed) | CRS | no | Our start-cell model matched onto a `ref_route` id |
| `data/*.json` | our disk | derived-ours* | all | no | ~50 files; *exception:* `data/game-strings/` is committed from `EN.zip` |
| dashboard API JSON | our disk | derived-ours | ID · TUN · CRS · LAP | no | Generated **from** `fh6.db` by `build_web.py`; git-ignored |
| `laps.db` | our disk | derived-ours | LAP · TEL | no | v1 store, superseded, still read by v1 |

## The official feature — FH6 Data Out (what you get free)

Toggle in-game: **Settings ▸ HUD and Gameplay ▸ Data Out** (IP + port). A fixed **324-byte little-endian**
packet, layout in `scripts/telemetry/fh6_dataout_capture.py:20-44` (asserted `struct.calcsize == 324`). **The
sole non-reverse-engineered live source** — everything it carries arrives with zero decryption or file parsing:

| Channel · tag | Fields |
|---|---|
| car-ID · **ID** | `CarOrdinal`, `CarClass`, `CarPI`, `DrivetrainType`, `NumCylinders`, `CarGroup` |
| motion · **TEL** | `Accel XYZ`, `Vel XYZ`, `AngVel XYZ`, `Yaw/Pitch/Roll`, `Speed` |
| slip & tyre · **TEL** | per-wheel `SlipRatio`, `SlipAngle`, `CombinedSlip`, `NormSusp`, `SuspTravelM`, `TireTempF`, `OnRumble`, `InPuddle`, `SurfaceRumble`; `EngineRpm`, `Power`, `Torque`, `Boost`, `Fuel` |
| driver-input · **INP** | `Steer`, `Accel`(throttle), `Brake`, `Clutch`, `HandBrake`, `Gear` |
| position · **CRS** | `PosX/Y/Z`, `DistanceTraveled`, `NormDrivingLine` |
| lap & race timing · **LAP** | `IsRaceOn`, `BestLap`, `LastLap`, `CurrentLap`, `CurrentRaceTime`, `LapNumber`, `RacePosition` |

> **The persistence gap any live analysis must know:** `lap_point` persists only the grip *code* + peak `lat_g`.
> The raw per-point channels above (velocity, yaw, per-wheel slip, handbrake…) exist only in the **live SSE
> stream** or the **capture CSV** — not the stored trace. A drift tool wanting body-slip β = f(`VelX`,`VelZ`) taps
> the stream or the capture, not `lap_point`. In-menu frames carry nothing usable.

## The sanitization target — live-decode call sites

The runtime dependencies a "sanitized" branch would minimize (all read-only). Car-ID is the key lever: **it also
arrives on the official packet** (`CarOrdinal/Class/PI`), so most of this can go.

| Live-decode | Where (file:line) | Value types | Replace with |
|---|---|---|---|
| `Tuning_*/Data` tune decode | `fh6_tune_decode.parse_tune` L303-422; `fh6_live_daemon` `disk_watcher` L2518-2634 (1.5 s), `/disk-tune` L2041, `/disk-tunes` L2025, `_pick_meta` L1014, `_record_pi_observation` L2453 | TUN · ID | Cache decode by `(path, mtime)`; for identity, lean on UDP `CarOrdinal/PI` + committed `tune_*` snapshot |
| Livery header + `Thumb.webp` | `_livery_strings` L1791-1812; `/liveries` L2097, `/livery-thumb` L2117, `_auto_assoc_livery` L954 | STR · ID | Committed livery index refreshed only on dir-mtime change |
| `ContainersRoot` discovery | `find_containers_root` L429-446 (re-globs per call) | — | Cache the resolved root process-wide |
| `race_triggers.tz` re-parse | `fh6_anchors.load` via `analyze_session._anchor_at` L28-38, spawned every ~20 s driving / per lap | CRS | **`route_anchor` already holds this** — read the committed table |
| `build_web.py` build-time leak | `export_thumbs` L57-84 (`Thumb.png` from save path) + `fh6_anchors.load` L658-665 (`race_triggers.tz`) | ID · CRS | Committed thumb webp + `route_anchor` table (`build_web_reads_only_db = false` today) |

## Sanitized branch — keep / freeze / cut

- **Keep (clean):** the Data Out feature, every `fh6.db` committed table and the API JSON, all `data/*.json`.
  Live build class/PI/ordinal comes straight off the packet.
- **Freeze:** the offline `rebuild.py` import stays as *tooling* — ship the built `fh6.db`; a runtime that never
  re-runs it needs no game install.
- **Cut / replace:** the five live-decode rows above. Four are pure caching / snapshot swaps; `race_triggers.tz`
  already has a committed twin (`route_anchor`).
- **Honest cost:** dropping live `/disk-tune` decode loses real-time identification of an **unsaved** tune (the
  newest-save 2-hour pick). A sanitized branch identifies the *car* live (packet) but the *tune* only from
  committed snapshots — an accepted tradeoff, not a silent loss.

## Value-type index

| Type | Primary source(s) | Where it lives |
|---|---|---|
| **ID** | Data Out packet (live) · save decode · `FH6_Database.sqlite` | `ref_car/engine/…`, `hw_package/tune_*`, packet `CarOrdinal/Class/PI` |
| **TEL** | Data Out packet | SSE stream, `captures/*.csv.gz`, `lap_point` (subset) |
| **CRS** | `Route*.owt`, `ObjectModelGame.zip`, `race_triggers.tz` | `ref_route*`, `route_anchor`, `ref_track_info`, `course*` |
| **TUN** | `Tuning_*` saves, `FH6_Database.sqlite` | `tune_*`, `ref_part/slot/slider`, `ref_*_curve` |
| **LAP** | Data Out packet → captures | `lap`, `lap_marker`, `corner_segment`, `laps.db` |
| **INP** | Data Out packet | SSE stream, `lap_point.thr/brk` (schema 6) |
| **STR** | `EN.zip`, `ObjectModelGame.zip` | `ref_string`, `ref_event_string` |

## Keeping this current

Update when a data store is added or removed, a runtime game-decode call site changes, the runtime layout /
ports change, or a hard rule is added. Keep the three copies in sync: this file, `CLAUDE.md` (the thin pointer),
and the Eraser diagram (edit via Eraser `update_diagram` / `update_document` on file `Ex1bEXcuOL57kK2O5OQg`).
A new store must also be added to `DATA-INVENTORY.md` in the same commit (its own standing rule).

## Appendix — Eraser diagram source (cloud-architecture DSL)

```
direction right

"1 — OFFICIAL FEATURE · FH6 Data Out"  (green)  — car-ID / motion / slip+tyre / driver-input / position / lap-timing channels → fh6_live_daemon (8765) → SSE + captures
"2 — LIVE-DECODE at RUNTIME"           (red)    — Tuning_*/Data decode · Livery header+Thumb · ContainersRoot discovery · race_triggers.tz re-parse · build_web.py leak
"3 — GAME INSTALL FILES → committed"   (blue)   — FH6_Database.sqlite · ObjectModelGame.zip · Route*.owt/.nav · race_triggers.tz · EN.zip  →  rebuild.py import stages  →  fh6.db ref_* layer
"4 — DERIVED (ours)"                   (teal)   — lap/lap_point/corner_segment · course/course_route · hw_package/setup · captures · data/*.json · dashboard API JSON · laps.db
"CONSUMERS"                            (black)  — dashboard v2 · future: DRIFT SCORING (video x telemetry) · future: SANITIZED branch

Full node/edge DSL is stored in the Eraser file (Ex1bEXcuOL57kK2O5OQg); this is the summary skeleton.
```
