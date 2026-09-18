# The data inventory — every store this project holds

Generated 2026-09-03 from the live tree; row counts re-measured 2026-09-18 at `schema_version` **9**. **Rule: before saying a thing is not known, look here.**
Nothing in this project is ever "not available" until this file says so. When a store is added,
add it here in the same commit.

## 0. SOURCES AND COVERAGE — what exists, and how much of it we have imported

This section exists because the project repeatedly *rediscovered* data it already had. The cause
was structural: imports were written **demand-driven** (import what the next feature needs) and
the inventory listed what we HOLD, so anything unimported was invisible — never a row, never a
gap. These tables make the unimported visible.

### The decrypted game database (205 tables)

| state | tables | note |
|---|---|---|
| imported via `ref_slot.source_table` (the 50 upgrade slot tables) | 50 | **complete**: 87,655 rows in the game, 87,655 in `ref_part` — exact |
| imported by name (cars, engines, wheels, compounds, strings, classes…) | 33 | see `scripts/db/import_gamedb.py` |
| imported by `scripts/db/import_parts_extra.py` (2026-09-03) | 3 | `UpgradePresetPackages`, `CarExceptions`, `List_PartAttribute` — **read the next table before using them** |
| imported by `scripts/db/import_curves.py` (2026-09-03) | 3 | `List_TorqueCurve`, `List_TireFrictionCurve`, `List_TireFrictionMultiCurve` — the two sampled curves and the load blend that binds the second to a compound |
| **untouched** | 108 non-empty + 16 empty | listed below |

The largest untouched tables, and whether they matter:

| table | rows | worth importing? |
|---|---|---|
| `Livery_DecalsSortOrder` | 19,649 | livery editor data — not relevant |
| `CarPartPositions` | 2,413 | part positions on the model |
| `PlayerNames` | 1,709 | name filter list — not relevant |
| `Livery_VinylsDecals` | 1,442 | livery editor data — not relevant |
| `CarRarities` | 767 | rarity per car |
| `Livery_Decals` | 708 | livery editor data — not relevant |
| `Data_Car_Buckets` | 644 | car bucketing (class/PI banding inputs) |
| `CameraOverrides` | 641 | camera data — not relevant |
| `OnDiscContent` | 621 | packaging manifest — not relevant |
| `AIDrivingBehaviorObservationDefaults` | 209 | not yet assessed |

#### The two curve tables — imported 2026-09-03, and how they are keyed

Both are sampled curves stored one value per column (`v0..v245`, `v0..v99`), which is why they
read as noise until the sampling rule is known. Both rules are exact. Full derivation, with the
agreement figures, is in the `THE CURVES` header block of `db/schema.sql`.

| table | rows | lab table | keyed by | what it actually holds |
|---|---|---|---|---|
| `List_TorqueCurve` | 1,725 | `ref_torque_curve` (1,725) + view `v_torque_point` | **a camshaft part, not an engine**: 1,706 `List_UpgradeEngineCamshaft` rows + 19 `Data_Motor` rows = 1,725, no id shared, none orphaned | A real dyno for every engine at every camshaft level, driven or not. Sampling is uniform at **100 rpm** from 0 (`TorqueCurveMaxRPM == 100*(N-1)` on all 1,706); values are normalised with peak 1.0, so `torque_Nm = v * TorqueScale` and **`TorqueScale` IS peak torque**; `hp = Nm*rpm/7120.54`, which returns 150.0 / 300.0 / 375.0 hp exactly against the game's own `Data_Car.SimPeakPower` (that column is watts/100). The **last sample is not a dyno point** — it is negative on 1,720 of 1,725 curves (−2.63 typical), closed-throttle drag past the end of the table; kept as `limiter_value`, flagged `limiter=1` in the view. The project's boost rule survives: `SimPeakTorque*100` == the stock curve's `TorqueScale` on **313 of 314** naturally aspirated cars, and the ratio on forced-induction ones runs 1.03–2.87 (turbo median 1.46, twin 1.55, DSC 1.32, CSC 1.36). This is the **full-throttle base curve**; the per-part multipliers that scale it (e.g. a CSC's `ZeroRPMScale`/`RedlineRPMScale`) are already in `ref_part.data`. |
| `List_TireFrictionCurve` | 738 | `ref_friction_curve` (738) + view `v_friction_point` | **a (compound, channel, surface, load band)**: 41 compounds × 9 channel columns = 369 = the whole of `List_TireFrictionMultiCurve`, × 2 curves each = 738, all distinct — so `ref_friction_curve.compound_id` joins `ref_compound` with no indirection | The curve either side of the peak, which is what says how sharply a tyre lets go — `ref_compound` only ever carried the peak. Slip axis is uniform: `slip = i/(N−1) * MaxSlip`, N = 100, `MaxSlip` = 49.5 deg lateral / 1.1 slip ratio longitudinal. Values are normalised with peak 1.0, so **`FrictionScale` IS peak μ**. `ref_compound`'s peaks are **not** derived from this table and are not contradicted by it: both come from `List_TyreCurveDB`, and this is that row baked onto a 100-point grid (argmax recovers the authored peak within one grid step on 682 of 738 curves). |
| `List_TireFrictionMultiCurve` | 369 | flattened into `ref_friction_curve` | one row per (compound, channel) | Not a shape — a **load blend**. Its two curves are the same channel at two loads, `MinLoadCurve` = 10.1972 kgf (100 N exactly) and `MaxLoadCurve` = 1000 kgf, blended by the tyre's normal load and clamped at `LoadClamp` (3500 kgf; 10000 on one compound). That is the load sensitivity, and it is why one compound needs two curves per channel. |

**A unit correction this import forced**, worth knowing before reading `ref_compound`:
`List_TyreCurveDB` states *all* peaks on one 0–49.5 authoring scale. On the lateral channels that
scale is already degrees, so `ref_compound.lat_slip_peak` is a slip angle and reads correctly. On
the longitudinal ones it is **not** a percentage: `ref_compound.long_slip_peak` / `brake_slip_peak`
must be divided by 45 to become a slip ratio. The Slick Race compound's stored 3.25 is a **7.2%**
slip ratio, not 3.25%.

#### The three "part facts" tables — imported 2026-09-03, and what they turned out to be

Two of the three do **not** hold what their name suggests. Recorded here so the question is not
re-opened: the answers below are re-measured by `scripts/db/import_parts_extra.py` on every
rebuild and written into `import_run.notes`.

| table | rows | lab table | joins | what it actually holds |
|---|---|---|---|---|
| `UpgradePresetPackages` | 448 | `ref_preset` (448) + `ref_preset_part` (17,617) | ordinal → `ref_car` **448/448**; parts → `ref_part` **17,617/17,617** | Exactly what the name says, and the useful one. 448 complete builds over 268 cars: a 49-slot part list plus a 46-float tuning blob = the 36 `ref_slider` values in `slot_index` order then 10 gear-ratio slots (`-1.0` where the gear does not exist). The 36\|10 boundary is proven, not assumed: the `-1.0` tail starts at exactly `36 + (fitted transmission NumGears − 1)` on **320 of 321** presets that fit a transmission. Titles and descriptions resolve 448/448 through `ref_string`. |
| `CarExceptions` | 511 | `ref_car_exception` (511) | CarID → `ref_car` **511/511** | **Not upgrade gating — livery gating.** All eight flags are paint/graphics exceptions: `NoMirrors` (245), `NoWindows` (40), `NoHoodStock` (16), `NoHoodAftermarket` (70), `NoPaintableWingStock` (292), `NoPaintableWingAftermarket` (170), `NoDecalsWingStock` (253), `NoDecalsWingAftermarket` (227). Of the two upgrade gates the lab infers — aspiration conversion gating the engine tiers (ui-spec 9.1), body kit removing the Front Bumper tile (ui-spec 10.7) — this table states **0 of 2**, and has no column that could. Both stay inferred from the menus. |
| `List_PartAttribute` | 546 | `ref_part_attribute` (546) | **joins nothing** — `slot`/`part_id` NULL, `join_status` `orphan` | **Does not answer the per-part PI question and cannot be keyed to a part.** Its only measures are `Price` (0 or 5000, nothing else), `Mass`, `DragScale` and `WindInstabilityScale` — the last two are `1.0` in all 546 rows, so they carry no information. No column anywhere in the 205 tables is named `*PartAttribute*`, in a schema that names every other key after its target. On evidence it is legacy engine data: the column set is `List_UpgradeEngine`'s with the mass made absolute instead of a diff, 438/546 masses equal a `Data_Engine.[EngineMass-kg]` exactly (control against `List_UpgradeCarBodyWeight.Mass`: 1/546), and its `ManufacturerID` is a dense 1..53 enum that is not the sparse 739-row `List_PartManufacturer` (7 of its 52 values are absent there). |

**The PI question is closed on the game-data side.** `PerformanceIndex`/`PI` appears in exactly
three places in the whole game database, all whole-car: `Data_Car.PerformanceIndex`,
`Data_Car.PI` and `CarClasses.Max*PerformanceIndex`. There is no per-part PI row to find. PI is
computed by the game from simulated performance, so `data/parts-pi.json` and `obs_pi` — the
observation-driven route — are not a stopgap for a table we had failed to locate; they are the
only route the data allows. The presets are the new lever there: 448 fully-specified builds on
268 known cars are the largest block of complete, self-consistent part combinations the project
has, and the natural next input to the regression that is currently underdetermined (71
observations, 297 parameters).

### The game's UI texture archives (`media/ui/textures/data_bound`, 82 archives)

6 of 82 are read by the lab: `HUD.zip`, `Promo.zip`, `Rivals.zip`, `Telemetry.zip`, `Upgrade_Class.zip`, `Upgrade_Parts.zip`.
`Upgrade_Parts.zip` (902 entries) is the upgrade tile art — decoded 2026-09-03 by
`scripts/db/export_icons.py` into `dashboard/v2/assets/upgrade/` with a manifest at
`api/icons.json`: 79 icon families (38 with Street/Sport/Race tiers) and 528 rim renders, 505 of
which join `ref_wheel.media_name` exactly. The other 76 archives are catalogued but unused; the
ones plausibly worth a look are `Upgrade_Class.zip` (class badges), `WheelIcons.zip`,
`Drivetrain_Icons.zip`, `RaceType.zip`, `Badges.zip` and `UI_Symbols.zip`.

### Everything else

| source | state |
|---|---|
| `EN.zip` string tables | **complete** — 287 of 288 entries imported, 58,722 strings |
| Horizon Rivals > Routes screen | **Road Racing only** — 23 of 88 Rivals routes captured with a length (`data/rivals-routes-road.json`); the other 65 are in `ref_event` name-only (from the game strings) so typed names check against them, but carry no `ref_event.length_m` and can never be named by length until their Routes screens are transcribed |
| `aitracks/Route*.owt` + `.nav` | **complete** — all 169 routes, points, width, banking, road class. Six files (Route132/281/351/1181/1281/8008) are SECTION GRAPHS, not one array: u32 at 0x20 = section count, 40-byte entries from 0x58 (start, 3 links, count, flags), point array 16-byte aligned after the table; flags high byte 1 = primary line, 2/4 = alternate line over the same road. `fh6_owt.parse` follows the primary chain (decoded 2026-09-06): Route132 The Colossus is 37,706 m closed and course `-3750_300` matches it verified (dev 4.4 m, covered 95%, len 0.998), where the fixed-0x60 read gave 3.1 km / bbox zero; the four 4-section circuits lost their alternate line and the 700 m jump onto it (Highway Circuit `-1700_-4450` went partial -> verified); Route1181 was all-x=0 before. Road class was EMPTY in the live DB from the 2026-09-02 rename until 2026-09-03 (KeyError on every rebuild, logged in `import_run` as ok=0); verify with `SELECT road_class, COUNT(*) FROM ref_route_turn GROUP BY 1`, not with this line |
| `freeroam/Brio_00.nav` | imported (road class); surface MATERIAL still unsolved |
| `…\media	racksrio	riggerzones	z_race_activations
ace_triggers.tz` | 14 KB plaintext XML: 36 spheres `race_trigger_zone_rt<route_id>`, radius 100 m, telemetry metre frame. Found by the 2026-09-05 data-audit session; read by `scripts/telemetry/fh6_anchors.py` → stage `anchors`. The sibling `tz_races/*.tz` are cutscene boxes; `tz_playground_games/*.tz` and `trackroutes/route*.nt` use ids that are not routes. |
| `…\media\sfsdata` (75 MB), `…\media\GameTunableSettings.zip` (`EventNames.xml`, `track_properties.xml`, `DataManager/TrackMetrics.xml`) | ENCRYPTED (method 22 / TransformIT). The only places left that can hold the event catalogue's route-id column: `CareerTrackInfo` is the per-route record set (112 display names = 88 Rivals + 24 others) and `CareerRace` carries placeholder names `CareerRaceRoute2091`, so the table exists. DVS-code/Forza-Crypto-Tool (GitHub) decrypts FH6 `.slt` and method-22 zips with server-side keys — Jett's call, never run from here. |
| save folders `Tuning_*` | **complete since 2026-09-03** — `Data`, `header` and `Thumb.png` all read (the header and render sat unread for weeks) |
| `Downloadsorza raw data files\*.csv` | ~70 exported CSVs; used for cross-checks, not systematically imported |
| telemetry sessions | 125 recordings on disk, 125 imported as sessions (2026-09-03; earlier figure of 221/107 was stale) |

**The rule this section enforces:** an import is not "done" because a feature works. A source is
done when every one of its tables or entries is either imported or has a row here saying why not.

Field-level catalogue of these tables (full column lists, row counts, and what every coded value means):
**`docs/handoff-data-structures.md`** — the written companion to the *FH6 Lab Database ERD* Eraser file.

## 1. The central database — `data/fh6.db` (107 MB)

| table | rows | what it is |
|---|---|---|
| `corner_obs` | 17885 | per-corner history per lap — one row per lap × turn, across 1,475 laps. (It was empty until `course_match`+`corners` were rerun past the 2026-09-05 schema change; rebuild.py's I6 check guards that.) |
| `course` | 127 | columns: route_key, name, is_rivals, event_id, length_m, turn_count… |
| `course_event` | 84 | every course × candidate-event pairing `route_names` weighed — tier (game/map/length/declared) plus its evidence columns, `chosen`=1 on the winner. Filled by stage `route_names`. |
| `course_route` | 125 | columns: route_key, route_id, match_kind, mean_dev_m, p95_dev_m, covered… + `anchor_route_id`, `anchor_events`, `anchor_agree` (2026-09-05) — the sphere most of the course's events started in and whether it is the geometry's route. match_kind gained `anchored` (route_id stays NULL, identity in `anchor_route_id` only): a sphere holding a strict majority of the course's events, shape unverified, never reaches corners, the centre-line overlay or naming. Recomputed wholesale by stage `course_match`; one row per course with ≥12 geometry points. |
| `course_turn` | 2400 | the course's own turns (the namespace the map and the trace use). |
| `diag_event` | 48461 | every detected failure incident, placed on a turn. |
| `hw_package` | 671 | columns: hw_hash, ordinal, label, pi, class, engine_id… |
| `hw_package_part` | 33550 | columns: hw_hash, slot_index, slot, part_id, name |
| `import_run` | 12114 | columns: run_id, kind, source, started_utc, finished_utc, n_rows… |
| `lap` | 1572 | columns: lap_id, route_key, session_id, cid, container, hw_hash… + (schema 5, 2026-09-06) `lap_dist_m` (odometer over the game-timed lap), `rewinds`, `pauses`, `pause_s`, `stitched` (the lap's opening came from the previous capture file). A lap is what the GAME timed (CurrentLap start → LapNumber+1 / LastLap published); rows a rewind revoked are not in it. See `lap_marker`. + `official` (schema 8: the GAME published this lap time — 433 laps. An official lap counts even with a rewind in it; an unofficial one must clear the 0.97 coverage floor and carry no rewinds before it can be crowned). |
| `lap_marker` | — | (schema 5) every gap in a lap's final line, placed on the lap: `kind` rewind (`dur_s` = seconds of driving undone, `over_line` when the start/finish was re-crossed and the game re-timed the lap), pause (menu; game clock frozen), gap (telemetry dropout, clock ran), jump (respawn/teleport; lap intact, trace not continuous); `t` from lap start, `race_s`, `dist_m`, `detail` JSON (silence_s, pos_gap_m, on_line, race_rebase_s…). Written by `import_telemetry.py` from the session JSON's lap rows. |
| `lap_point` | 523003 | every lap's trace: arc, mph, grip state, x/z AND elev_m, + `dist_m` (schema 5: the odometer at the point, so a lap's points can be placed against the game's own distance, not just the resampled arc), + `thr` / `brk` (schema 6, 2026-09-11: throttle and brake 0-100 % from the capture's Accel / Brake, for the pedal paint; NULL on laps analysed before schema 6 until their capture is replayed with backfill_laps.py) + `lat_g` (schema 7) + `r_m` (schema 9, 2026-09-18: the DRIVEN radius `v/ω` from the capture's yaw rate — never the road's fitted `ref_route_turn.radius_m`; 192,995 points, and the same replay also stores `x`/`z` to one decimal instead of whole metres). |
| `obs_evidence` | 129 | columns: obs_id, subject, claim, confidence, source, observed_utc… |
| `obs_menu` | 92 | observed shop tiles (92 rows) — menu positions proven in game. |
| `obs_pi` | 223 | observed PI deltas per part (65 rows) — the empirical per-part PI store. |
| `plan_clone` | 0 | EMPTY — the clone plan tables exist but nothing writes them yet. |
| `plan_clone_step` | 0 | EMPTY — intended to hold the ORDERED clone route (phase, slot, menu_path, tile). |
| `plan_readiness` | 0 | EMPTY. |
| `ref_car` | 671 | all 660 cars incl. stock PI, pi_norm, ratings, in_autoshow, stock wheel level. |
| `ref_car_body` | 790 | columns: carbody_id, ordinal, variant, name, length_m, width_m… |
| `ref_class` | 8 | columns: class_id, name, norm_max, pi_max, norm_prev, pi_prev |
| `ref_compound` | 41 | all 41 tyre compounds with slip peaks and friction scales — the global grip ladder. |
| `ref_drivetrain` | 673 | columns: drivetrain_id, drivetype, shift_system, is_swap_set, n_cars, data |
| `ref_engine` | 681 | columns: engine_id, name, media_name, config, cylinders, displacement_cc… |
| `ref_track_info` | 112 | the game's own track table (ObjectModelGame.zip `TrackInfoDataSet`): track key -> `route_id` (= Route<id>.owt), ribbon Circuit/P2P/Playground, the CareerTrackInfo display name and description resolved through `ref_string`. THE name<->route binding (2026-09-05). Stage `objectmodel`. |
| `ref_race_collection` | 170 | championships/exhibitions (`RaceCollectionDataSet`): name, type, the car-restriction it imposes, recommended cars. Stage `objectmodel`. |
| `ref_career_race` | 291 | every career race (`CareerRaceDataSet`): name, track key, collection, race mode -> discipline, laps, AI count, flags. Stage `objectmodel`. |
| `ref_rivals_event` | 604 | the 88 Rivals names x 7 car classes (`RivalsEventDataMap`): leaderboard id, collection, restriction -> `class_id`. Stage `objectmodel`. |
| `ref_car_restriction` | 559 | every event car restriction (`CarRestrictionMap`): class, bucket, PI/power/weight/year bounds, tagline. Stage `objectmodel`. |
| `v_rivals_route` | view | Rivals name -> race -> track -> route id, flattened; 88/88 names resolve to exactly one route. |
| `ref_event` | 379 | the Rivals catalogue as displayed — name, length_m (a screen read, ±80 m), is_loop; filled by stage `events`: 23 Road routes with a length from `data/rivals-routes-road.json` + 65 name-only rows (length NULL, never matched by length) from the `RivalsEventData` strings, so a typed course name is a checked join, not an unknown string. |
| `ref_event_string` | 604+ | every `RivalsEventData` IDS_Name guid (604 across 88 names, 7 per route) plus the IDS_Description guids that match a Road route's description verbatim, joined live against `ref_string` so a name can never drift from the game's own string. Filled by stage `events`. |
| `ref_friction_curve` | 738 | the friction curve behind every compound: 41 compounds × 3 channels × 3 surfaces × 2 load bands. Explode it with `v_friction_point` (slip, μ). |
| `ref_motor` | 19 | columns: motor_id, name, media_name, mass_kg, battery_kwh, redline_rpm… |
| `ref_part` | 89033 | every option of every slot, with tile / tile_count / price / mass / requires_aspiration — the shop grid. |
| `ref_part_slider` | 66912 | per-part slider bands: what installing a part writes and what range it unlocks. The transmission/diff/spring rewrites live here. |
| `ref_region` | 91 | columns: region_id, name, map_x, map_y |
| `ref_route` | 170 | columns: route_id, name, length_m, n_points, is_loop, bbox_x0… `is_race` = 1 on the 36 routes the game ships a race-activation sphere for (stage `anchors`). |
| `route_anchor` | 36 | the game's race-activation spheres from `race_triggers.tz`: route_id + world position + 100 m radius — the ONLY populated route-id field in the shipped data. A session event that starts inside one began where that route's race begins. Corroborates and tie-breaks `course_route`; never names. Stage `anchors`. |
| `session_event` | 495+ | every analyzer event (race / timed run / reference-loop pass) per session with mode, laps, distance, its START and END position and `start_is_line` (1 = a detected lap-boundary crossing, 0 = only where the capture window opened, NULL = older session file) — what `course_match` tests against `route_anchor`. Stage `telemetry`. |
| `session_hit` | — | where the car bottomed out (`kind='bottoming'`, suspension at full compression) or hit a barrier/terrain (`kind='wall'`, one-frame speed loss) per session, with world `x`/`z`, `mph`, `hard`, `wheel` (bottoming) and `drop_mph` (wall). From `analyze_session`'s `bottoming`/`wall` detectors. `build_web` attributes each hit to a course by proximity to its driven line and clusters them into 🔧/💥 map markers (`course/<key>.json` → `hits`). Display only — a barrier scrape slows the car but NEVER voids the lap. Stage `telemetry`. |
| `ref_route_point` | 275737 | columns: route_id, i, x, y, z |
| `ref_route_surface` | 275737 | columns: route_id, i, road_class, road_type, road_profile, offroad… |
| `ref_route_turn` | 3878 | the MAP's turns with width_m and bank_deg (a DIFFERENT id namespace from course_turn — never join by id). |
| `ref_slider` | 36 | columns: slider, slot_index, group_name, display_name, unit, band_source… |
| `ref_slot` | 50 | THE MENU MAP: menu_area, menu_area_order, menu_order, in_upgrade_shop, category, key_column — the game's own upgrade tree. |
| `ref_string` | 59268 | the game's string tables (58,722 rows) — the ID → name layer. |
| `ref_string_table` | 290 | columns: table_name, name_hash, n_entries, has_csv |
| `ref_symptom` | 17 | the failure catalogue: primary/secondary/tertiary fix, verify_test, detector. |
| `ref_torque_curve` | 1752 | a dyno per camshaft part (1,706) and electric motor (19): peak torque/power precomputed, samples every 100 rpm. Explode it with `v_torque_point` (rpm, Nm, lb-ft, hp). |
| `ref_track` | 58 | columns: track_id, name, media_name, length_m, is_reverse, is_real_world… |
| `ref_wheel` | 1259 | every rim with mass and mass_level (rims are a weight class). |
| `ref_wheel_category` | 5 | columns: category_id, name, display_order |
| `schema_meta` | 2 | columns: key, value |
| `session` | 644 | columns: session_id, started_utc, duration_s, frames, rate_pps, source… |
| `session_car` | 1486 | columns: session_id, cid, ordinal, build_id, hw_hash, name… |
| `setup` | 691 | columns: setup_hash, hw_hash, ordinal, label, n_containers, first_seen_utc |
| `tune_container` | 763 | columns: container, ordinal, saved_utc, tune_name, locked, source… |
| `tune_gear` | 5287 | EVERY SAVE'S GEAR LADDER, exact from the save file — final drive + per-gear ratios. This is why identity rarely needs a pull. |
| `tune_part` | 38150 | columns: container, slot_index, slot, part_id, name, level… |
| `tune_slider` | 22890 | columns: container, slider, norm, value, unit, min_value… |

Views: `v_build_sheet`, `v_course_best`, `v_diag_by_setup`, `v_diag_by_turn`, `v_rim_equivalent`, `v_tune_sheet`.

## 2. Data files under `data/`

| file | size | what it is |
|---|---|---|
| `build-letters.json` | 5kB |  |
| `build-liveries.json` | 0kB |  |
| `car-mass.json` | 0kB |  |
| `car-option-lists.json` | 944kB | Manifest.xml UpgradeablePart rows per car (558 cars) — the game's own option lists with ranks. |
| `car-ordinals.json` | 117kB |  |
| `car-tune-ranges.json` | 2kB |  |
| `clone-coverage.json` | 4kB |  |
| `drift-guide.json` | 21kB |  |
| `drivetrain-ladder-nsxr.json` | 2kB | proven Differential and Driveline grids and their slider rewrites. |
| `eliminator-tips.json` | 32kB |  |
| `engine-swaps.json` | 72kB | engine swap catalogue. |
| `formulas.json` | 19kB | the derived formulas (spring rates, PI, display). |
| `game-assets.json` | 4kB |  |
| `game-strings/` | 433kB | 23 files decoded from `EN.zip` by `scripts/telemetry/fh6_strings.py` (2026-09-01); `RivalsEventData.json` alone carries 604 IDS_Name + 604 IDS_Description guids resolving to 88 distinct route names. |
| `global-slider-ranges.json` | 3kB | the solved slider ranges. |
| `identity-evidence.json` | 2kB | ACCUMULATED gear sets per car + declared picks — what makes "no gear above N" evidence. |
| `meta-cars.json` | 124kB | per-car meta / discipline data. |
| `owned-cars.json` | 64kB |  |
| `part-index-vocabulary.json` | 14kB | how a save's index maps to a menu position per slot family. |
| `part-names.json` | 30kB |  |
| `parts-effects.json` | 30kB | shop-preview readings (the only trustworthy negative-PI evidence). |
| `parts-pi.json` | 1kB |  |
| `pi-observations.json` | 92kB | config → live PI pairs (the PI solver's input). |
| `platform-ladder-nsxr.json` | 7kB | proven Platform and Handling grids with the sliders each kit rewrites. |
| `progression.json` | 15kB |  |
| `reference-loops.json` | 0kB |  |
| `rim-id-matches.json` | 66kB |  |
| `rim-menu-order.json` | 13kB | the Rim Style paged grid order. |
| `rivals-routes-road.json` | 13kB | the Rivals > Routes screen: name, Route Length (mi, 1 dp), description, 7 IDS_Name guids; read by `scripts/db/import_events.py`; the length is the naming key via stage `route_names`. |
| `rivals-tracks.json` | 69kB |  |
| `routes.json` | 13kB |  |
| `slider-baselines.json` | 2kB |  |
| `sources.json` | 42kB |  |
| `tire-compound-ladder-nsxr.json` | 4kB | proven 11-tile compound grid with indices and lat-G / braking per tile. |
| `tire-compounds.json` | 3kB |  |
| `touge-guide.json` | 26kB |  |
| `training-zone.json` | 84kB |  |
| `transmission-ladder-nsxr.json` | 4kB | proven transmission grid (6 tiles, indices, gear counts, default final drives). |
| `tune-codes.json` | 12kB |  |
| `tune-raw.json` | 1kB |  |
| `tuner-roster.json` | 10kB |  |
| `tuner-sheets.json` | 854kB |  |
| `tuners.json` | 4kB |  |
| `tuning-templates.json` | 11kB |  |
| `tuning-test-battery.json` | 107kB | the drive-test battery definitions. |
| `tuning-variables.json` | 39kB |  |
| `upgrade-strategy.json` | 2kB |  |
| `wheelspin-cars.json` | 13kB |  |
| `fh6.db` | 107344kB |  |
| `laps.db` | 3972kB | the v1 lap store (superseded by fh6.db, still read by v1). |

Plus `data/sessions/` (221 recordings) and `data/courses/` (62 course models).

## 3. The dashboard API — `dashboard/v2/api/` (generated; git-ignored)

| file | size | what it is |
|---|---|---|
| `cars.json` | 213kB | all 660 cars. |
| `courses.json` | 10kB | the course index. |
| `diag.json` | 191kB | failure statistics by setup and by turn, plus the symptom catalogue. |
| `evidence.json` | 53kB | the claim store. |
| `identity.json` | 536kB | every held build: hw/setup keys, part and slider fingerprints, name, creator, description, thumb. |
| `index.json` | 1kB | the build stamp. |
| `packages.json` | 114kB | hardware packages. |
| `world.json` | 1836kB | all 169 route centre-lines + the courses you have driven. |
| `build/` | 505 files | 8195kB |
| `course/` | 60 files | 6459kB |
| `thumb/` | 579 files | 25596kB |
| `options/` | 166 files | 12386kB |

## 4. The live daemon (port 8765)

**Endpoints:** `/analysis`, `/analyze`, `/build`, `/build-field`, `/build-livery`, `/car`, `/cars-map`, `/clear-loop`, `/clone-lock`, `/course-expected`, `/disk-tune`, `/disk-tunes`, `/events`, `/health`, `/laps`, `/liveries`, `/livery-thumb`, `/mark-start`, `/mode`, `/new-run`, `/reset`, `/role`, `/route`, `/shot`, `/shots`, `/tag`, `/tune-range`.

**SSE events:** `analysis`, `config`, `corner`, `disk`, `lap`, `loop`, `mode`, `reset`, `session`, `stint`, `strip`, `tag`.

**Frame fields:** `boost`, `brk`, `car`, `cid`, `cls`, `cyl`, `dist`, `drv`, `ev`, `gear`, `hb`, `hp`, `lapn`, `lapt`, `lat`, `lon`, `maxrpm`, `mph`, `on`, `pi`, `px`, `pz`, `rpm`, `rpos`, `slip`, `smash`, `steer`, `susp`, `t`, `temp`, `thr`, `tq`, `yaw`.

`slip` is per wheel `[ratio, angle, combined]`; `susp` and `temp` are per wheel. The rebuild
service (8001) adds `POST /rebuild`, `GET /status` and `GET /watch` (code + data events).

## 5. The game's own files

How and when each of these is refreshed after a game update (decryption, extraction, utilities, frequency):
**`docs/game-data-refresh.md`**.

Byte-level layout of every BINARY one of them (the tune blob, the Data Out packet, the CryptoContainer,
`.owt`, `.nav`, `.str`, BXML, `.swatchbin`) as runnable 010 Editor templates: **`docs/formats/`** —
8 templates, each verified against the real corpus by `scripts/tools/check_bt_template.py`.

| source | what it is |
|---|---|
| `C:\XboxGames\GameSave\pgs\…\ContainersRoot\User_<hex>\C_ProfileData` | READ-ONLY. **The profile save** — 820 kB encrypted, 3.6 MB decrypted (ForzaCryptoTool, server-assisted, approval-gated). Header + 714 typed properties + BXML (5,548 nodes) + interned string table (the CURRENT car's equipped `Tuning_`/`Livery_` refs) + 112 binary records + an embedded **SQLite career DB**: `Career_Garage` = 815 owned-car INSTANCES × 146 columns (per-instance `Guid`, equipped tune, every part, all 36 tune sliders as real values, PI/class, usage stats). Full enumeration: **`docs/format-c-profiledata.md`**; the decryption question: `docs/fh6-profile-crypto-mimicry.md`. Read by `scripts/telemetry/fh6_profile.py`. |
| `C:\XboxGames\GameSave\pgs\…\ContainersRoot\Tuning_<ordinal>_<stamp>\` | READ-ONLY. `Data` (598 B: parts, sliders, gears), `header` (title, description, creator, XUID, created), `Thumb.png` (the render: WebP own / BC7 `burG` downloaded). |
| `C:\XboxGames\Forza Horizon 6\Content\media\openworld\brio\aitracks\Route*.owt/.nav` | 169 route centre-lines with lane width, banking, road class. A file is a graph of 1-6 sections (primary chain + alternate lines); `ref_route` holds the primary chain, `fh6_owt.parse()['sections']` keeps the rest. |
| `…\media\ObjectModelGame.zip` | 30 MB, plain Deflate, READABLE: ~7,000 BXML documents (`source/ScribbleData/<id>.om.xml`, manifest by TypeId) — the game's object-model data. Five are the event catalogue (`TrackInfoDataSet`, `RaceCollectionDataSet`, `CareerRaceDataSet`, `RivalsEventDataMap`, `CarRestrictionMap`) that binds every route name to its route id; read by `scripts/telemetry/fh6_bxml.py` -> stage `objectmodel`. Was never encrypted; found 2026-09-05 after the string tables, route files and the decrypted `GameTunableSettings.zip` all proved to carry no such join. |
| `…\brio\freeroam\Brio_00.nav` | the world nav mesh (38,473 nodes) — what is drivable. |
| `…\media\stripped\stringtables\EN.zip` | the string tables. |
| `C:\Users\mondr\Downloads\forza raw data files\FH6_Database.sqlite` | the decrypted game DB, 205 tables. Tables in use: CarClasses, Data_Car, Data_Motor, Environments, List_AeroPhysics, List_AntiSwayPhysics, List_Aspiration, List_CarMake, List_Cylinders, List_DriveType, List_EnginePlacement, List_PartManufacturer, List_SpringDamperPhysics, List_TireCompound, List_TireFrictionCurve, List_TireFrictionMultiCurve, List_TorqueCurve, List_TyreCurveDB, List_UpgradeCarBody, List_UpgradeDrivetrain, List_UpgradeEngine, List_UpgradeTireCompound, List_Wheels, Tracks, Upgrades. NEVER run the .exe/.msi files in that folder. |

## 5b. THE DRIVING INSTRUCTIONS — `data/tuning-test-battery.json`

Direct, repeatable instructions the driver follows to produce tailored measurements. This is a
designed instrument, not a fallback: Rivals is the lab (fixed weather and time), one variable per
iteration, 3-lap medians, bisection to find a limit, and the Tune screen's own Performance panel
as a STATIC instrument that answers with zero driving. `test_zero` (the slider × readout
sensitivity sweep, executed 2026-08-11) is what turns unknown sliders into free static tests.

| kind | id | what it measures | sliders | instrument / venue |
|---|---|---|---|---|
| static | `aero-window` | Aero balance window | aero_front, aero_rear | Aero Balance readout (and Aero Efficiency) |
| static | `braking-floor` | Braking distance floor | brake_pressure, brake_balance | 60-0 and 100-0 readouts |
| static | `gearing-envelope` | Gearing envelope (final drive) | final_drive | Top Speed and 0-60/0-100 readouts |
| dynamic | `hot-pressure` | Hot tire pressure | tire_psi_front, tire_psi_rear | Any Rivals circuit, 3 minutes at race pace |
| dynamic | `camber-temp` | Camber by temperature spread | camber_front, camber_rear | Longest steady corner on the test course (or a roundabout at steady speed) |
| dynamic | `braking-stability` | Braking stability & true lockup | brake_pressure, brake_balance | Drag strip or straight with a fixed brake marker |
| dynamic | `rotation-entry` | Corner-entry rotation (understeer gate) | arb_front (down), caster (up), diff_decel (down), toe_out_front (tiny) | Benchmark hairpin (pick ONE per course and reuse it) |
| dynamic | `rotation-exit` | Corner-exit traction (oversteer gate) | diff_accel (down), arb_rear (down), rebound_rear (down), center_torque_forward (AWD) | Same benchmark hairpin, focus on throttle-on phase |
| dynamic | `compliance-kerbs` | Kerb & bump compliance | springs (down), bump (down), ride_height (up), rebound (mid) | Curb-heavy chicane or the course's roughest section |
| dynamic | `high-speed-stability` | High-speed stability | toe_in_rear (+0.1 to +0.3), aero_rear (up), rebound_front (up) | Fastest sweeper/straight on course, flat out |
| dynamic | `lap-supertest` | The lap supertest (every accepted change re-earns its place) | (whatever changed) | The target Rivals course |

Plus `symptom_matrix` (10 symptoms → primary / secondary / tertiary fix + the verify test —
the same catalogue as `ref_symptom`), `cornering_envelope` (latG(v) = a + b·v² fitted through the
panel's two lateral-G readouts, giving max corner speed for any radius), `course_fitting` and
`class_fitting`, and `results_log` for every limit found.

The daemon runs its own live battery for DECODE (launch · gears · dyno · top · brake · hairpin ·
medium · fast · crest · wiggle), reported as progress against what each test still needs.

## 6. The specifications and audits

| doc | what it settles |
|---|---|
| `docs/course-identity-and-names.md` | THE workflow for course id → geometry → common name (settled 2026-09-05): the three ids, the chain, the stages, the verification queries, the never-again list. Read before naming anything or asking for a capture. |
| `docs/fh6-ui-spec.md` | the in-game Upgrade & Tune UI, transcribed from 758 frames: names, order, units, precision, unlock chains, contextual gating. THE contract for any mimic. |
| `docs/v1-lessons-audit.md` | 40 ranked regressions from v1 → v2 with fixes and status. |
| `docs/dashboard-states.md` | the panel's regions, modes and status machine. |
| `docs/telemetry-lab-status.md`, `docs/tuning-page-refresh-plan.md` | earlier status and plan. |

## 7. Scripts

| script | lines | role |
|---|---|---|
| `scripts/db/build_web.py` | 348 lines | the database → the dashboard API. |
| `scripts/db/export_options.py` | 678 lines | per-car option lists → api/options/<ordinal>.json. |
| `scripts/db/fh6db.py` | 660 lines |  |
| `scripts/db/import_containers.py` | 355 lines |  |
| `scripts/db/import_anchors.py` | 70 lines | the race-activation spheres → `route_anchor`, `ref_route.is_race`. |
| `scripts/db/import_objectmodel.py` | 260 lines | the game's event catalogue out of ObjectModelGame.zip -> `ref_track_info`, `ref_race_collection`, `ref_career_race`, `ref_rivals_event`, `ref_car_restriction`. |
| `scripts/db/import_course_match.py` | 220 lines | how our courses map onto the game's routes — from the DB, no game files; corroborated and tie-broken by the spheres. |
| `scripts/db/import_diagnosis.py` | 325 lines |  |
| `scripts/db/import_events.py` | 165 lines | the Rivals catalogue as displayed: names, lengths, guids → ref_event. |
| `scripts/db/import_gamedb.py` | 716 lines |  |
| `scripts/db/import_observations.py` | 275 lines |  |
| `scripts/db/import_route_names.py` | 325 lines | derive course and route names from map identity + catalogue length; evidence in course_event. |
| `scripts/db/import_surface.py` | 383 lines |  |
| `scripts/db/import_telemetry.py` | 270 lines |  |
| `scripts/db/rebuild.py` | 101 lines | the whole import, stage by stage. |
| `scripts/telemetry/analyze_session.py` | 2985 lines | the session analyzer. |
| `scripts/telemetry/audit_models.py` | 465 lines |  |
| `scripts/telemetry/backfill_laps.py` | 296 lines |  |
| `scripts/telemetry/clone_parts.py` | 1534 lines | how a slot's tile grid is named and ordered — the clone route's authority. |
| `scripts/telemetry/fh6_live_daemon.py` | 2317 lines | the live daemon: telemetry, identity, deliverable, the ladder matcher. |
| `scripts/telemetry/fh6_manifest.py` | 263 lines | Manifest.xml option lists. |
| `scripts/telemetry/fh6_nav.py` | 430 lines | the nav mesh parser. |
| `scripts/telemetry/fh6_anchors.py` | 90 lines | the `race_triggers.tz` reader: parse / load / nearest / inside. |
| `scripts/telemetry/fh6_bxml.py` | 160 lines | Forza binary XML (BXML) <-> ElementTree, from Nenkai's MIT reference; `python scripts/telemetry/fh6_bxml.py <file.om.xml> [out.xml]`. |
| `scripts/telemetry/fh6_owt.py` | 306 lines | the route file parser. |
| `scripts/telemetry/fh6_pi_solve.py` | 299 lines | the per-part PI solver. |
| `scripts/telemetry/fh6_swatchbin.py` | 655 lines |  |
| `scripts/telemetry/fh6_tune_decode.py` | 1279 lines | the save-file parser. |
| `scripts/telemetry/fh6_turns.py` | 234 lines | geometry turns from a route. |
| `scripts/telemetry/merge_courses.py` | 504 lines |  |
| `scripts/telemetry/repair_persisted_state.py` | 329 lines |  |
| `scripts/telemetry/turn_lab.py` | 307 lines |  |
| `scripts/telemetry/turn_stats.py` | 398 lines |  |
| `scripts/telemetry/verify_workflow.py` | 476 lines | the assertion harness. |
| `scripts/rebuild_service.py` | 200 lines | the import + regenerate service and the live-reload channel (8001). |

`tests/` — the pipeline's test suite (`python -m unittest discover -s tests -t .`): the naming rule and its game tier, the events import, the object-model import, the cascade, course_route surviving telemetry, the anchors layer. 47 tests as of 2026-09-05.

## 8. Two rules this file exists to enforce

1. **Nothing is unknown until this file says so.** Before adding a capture step, a user ask, or
   a "we do not have that", search this inventory. Most gaps are a store that is already held
   and simply unread — the audit found columns exported and never rendered, and 2,546 corner
   observations no API file selects.
2. **A new store is added here in the same commit that creates it.**
