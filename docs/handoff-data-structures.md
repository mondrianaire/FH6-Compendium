# Handoff — every data structure and data value in the lab

The written companion to the **FH6 Lab Database ERD** Eraser file
(https://app.eraser.io/workspace/EV5zhW3hPU6v4Z7PiZoW). The ERD is the picture; this is the catalogue of
*values*: every store, every table with its full field list, and what the coded values in those fields
actually mean.

*Created 2026-09-18, re-measured 2026-09-18 at **schema_version 9**. Counts and enum values are measured
from the live `data/fh6.db` and the live stores on this machine — not copied from older docs. Re-measure them the way §9 describes.*

**Read alongside:**

| Doc | What it answers |
| --- | --- |
| `docs/DATA-INVENTORY.md` | Does store X exist at all, and how much of it is imported? (the index) |
| `docs/data-availability.md` + the *Data Availability Map* Eraser file | Where did it come from, and does a sanitized branch keep it? (provenance) |
| `docs/game-data-refresh.md` | How and when is each game-derived input refreshed? (routines) |
| **this doc** + the *Lab Database ERD* | What are the structures, and what do their values mean? |
| `docs/handoff-grip-envelope.md` | What does `lap_point.r_m` mean, how far can it be trusted, and where is it biased? |
| `docs/formats/` + the *Binary Source Formats* diagram | What do the raw bytes look like before they become a row? |

## 1. The seven places data lives

| # | Store | Form | Tracked in git? | Written by | Read by |
| --- | --- | --- | --- | --- | --- |
| 1 | `data/fh6.db` | SQLite, 67 tables, 162 MB | **no** (git-ignored, rebuildable) | `scripts/db/rebuild.py` | the dashboard build, the daemon, every analysis |
| 2 | `data/*.json` (48 files) | JSON | yes | mixed: generators + hand-curated | daemon, analyzer, clone tools, dashboard |
| 3 | `data/sessions/*.json` (445 + tag files) | JSON, one per capture | yes | `analyze_session.py` | stage `telemetry`, the dashboard |
| 4 | `data/courses/*.json` (143) | JSON, one per course model | yes | `analyze_session.py` | stage `telemetry`, course identity |
| 5 | `captures/*.csv.gz` (400) | gzipped CSV, one row per UDP frame | no | `fh6_live_daemon.py` | re-analysis, drift work |
| 6 | `dashboard/v2/api/*.json` | JSON, per view | **no** (generated per worktree) | `scripts/db/build_web.py` | dashboard v2 only |
| 7 | `data/laps.db` | SQLite, one table (`lap_traces`, 1,989 rows) | yes | v1 pipeline | v1 dashboard only — superseded by `fh6.db` |

The game's own files are a separate class: read-only inputs, never a lab store. They are catalogued in
`docs/game-data-refresh.md` §2 and `DATA-INVENTORY.md` §5.

## 2. `data/fh6.db` — every table, by layer

Row counts measured 2026-09-18. `primary key` is the real key; composite keys are listed in order.

### Reference layer — the game's own truth (`ref_*`, rebuilt wholesale, never hand-edited)

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `ref_string_table` | 290 | table_name | `table_name`, `name_hash`, `n_entries`, `has_csv` |
| `ref_string` | 59,268 | table_name, key_hash | `table_name`, `key_hash`, `key_name`, `content` |
| `ref_class` | 8 | class_id | `class_id`, `name`, `norm_max`, `pi_max`, `norm_prev`, `pi_prev` |
| `ref_car` | 671 | ordinal | `ordinal`, `year`, `make`, `model`, `display_name`, `full_name`, `media_name`, `class_id`, `class`, `pi`, `pi_norm`, `curb_weight_kg`, `weight_dist`, `drivetype`, `engine_placement`, `cylinders`, `displacement_cc`, `aspiration`, `num_gears`, `stock_engine_id`, `stock_drivetrain_id`, `stock_carbody_id`, `stock_wheel_id`, `stock_wheel_level`, `base_cost`, `rarity`, `rating_handling`, `rating_speed`, `rating_accel`, `rating_braking`, `rating_launch`, `rating_offroad`, `front_ride_height_m`, `rear_ride_height_m`, `front_tire_mm`, `rear_tire_mm`, `front_rim_in`, `rear_rim_in`, `is_drivable`, `in_autoshow`, `data` |
| `ref_engine` | 681 | engine_id | `engine_id`, `name`, `media_name`, `config`, `cylinders`, `displacement_cc`, `aspiration_stock`, `mass_kg`, `redline_rpm`, `data` |
| `ref_motor` | 19 | motor_id | `motor_id`, `name`, `media_name`, `mass_kg`, `battery_kwh`, `redline_rpm`, `data` |
| `ref_drivetrain` | 673 | drivetrain_id | `drivetrain_id`, `drivetype`, `shift_system`, `is_swap_set`, `n_cars`, `data` |
| `ref_car_body` | 790 | carbody_id | `carbody_id`, `ordinal`, `variant`, `name`, `length_m`, `width_m`, `height_m`, `wheelbase_m`, `data` |
| `ref_car_exception` | 515 | ordinal | `ordinal`, `no_mirrors`, `no_windows`, `no_hood_stock`, `no_hood_aftermarket`, `no_paintable_wing_stock`, `no_paintable_wing_aftermarket`, `no_decals_wing_stock`, `no_decals_wing_aftermarket`, `n_flags` |
| `ref_car_restriction` | 559 | restriction_id | `restriction_id`, `car_class_id`, `car_bucket_id`, `pi_min`, `pi_max`, `power_min`, `power_max`, `weight_min`, `weight_max`, `year_min`, `year_max`, `tagline`, `description`, `data` |
| `ref_slot` | 50 | slot_index | `slot_index`, `slot`, `part_name`, `source_table`, `category`, `key_column`, `upgrade_type_id`, `menu_area`, `menu_area_order`, `menu_order`, `is_visual`, `in_upgrade_shop` |
| `ref_part` | 89,033 | slot, part_id | `slot`, `part_id`, `key_id`, `level`, `is_stock`, `name`, `manufacturer`, `price`, `mass_diff_kg`, `weight_dist_diff`, `tile`, `tile_count`, `requires_aspiration`, `requires_graphics`, `confidence`, `data` |
| `ref_part_slider` | 66,912 | slot, part_id, slider | `slot`, `part_id`, `slider`, `def_value`, `min_value`, `max_value`, `def_norm`, `locked` |
| `ref_part_attribute` | 546 | attribute_id | `attribute_id`, `manufacturer_id`, `price`, `mass_kg`, `drag_scale`, `wind_scale`, `mass_is_engine`, `slot`, `part_id`, `join_status` |
| `ref_slider` | 36 | slider | `slider`, `slot_index`, `group_name`, `display_name`, `unit`, `band_source`, `source_slot`, `fixed_min`, `fixed_max`, `formula`, `confidence` |
| `ref_wheel_category` | 5 | category_id | `category_id`, `name`, `display_order` |
| `ref_wheel` | 1,259 | wheel_id | `wheel_id`, `name`, `manufacturer`, `full_name`, `media_name`, `mass`, `mass_level`, `price`, `is_stock`, `category_id`, `display_order`, `tile_row`, `tile_col` |
| `ref_compound` | 41 | compound_id | `compound_id`, `name`, `internal_name`, `lat_slip_peak`, `long_slip_peak`, `brake_slip_peak`, `lat_slip_peak_offroad`, `friction_scale`, `wear_scale`, `data` |
| `ref_preset` | 448 | preset_id | `preset_id`, `ordinal`, `title`, `description`, `kind`, `thumbnail`, `purchasable`, `release_order`, `n_parts`, `n_parts_joined`, `n_gears`, `tuning_hex`, `tuning` |
| `ref_preset_part` | 17,617 | preset_id, slot | `preset_id`, `slot`, `part_id`, `name`, `joined` |
| `ref_torque_curve` | 1,752 | curve_id | `curve_id`, `source`, `engine_id`, `motor_id`, `part_id`, `level`, `is_stock`, `n_samples`, `rpm_step`, `max_rpm`, `redline_rpm`, `stall_rpm`, `torque_scale`, `zero_throttle_scale`, `limiter_value`, `peak_torque_nm`, `peak_torque_rpm`, `peak_power_hp`, `peak_power_rpm`, `samples` |
| `ref_friction_curve` | 738 | curve_id | `curve_id`, `compound_id`, `multicurve_id`, `channel`, `surface`, `load_band`, `load_kgf`, `load_clamp_kgf`, `max_slip`, `slip_unit`, `n_samples`, `friction_scale`, `peak_slip`, `authored_peak_slip`, `authored_peak_raw`, `samples` |

### Game event catalogue (ObjectModelGame.zip BXML + Rivals screens)

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `ref_track` | 58 | track_id | `track_id`, `name`, `media_name`, `length_m`, `is_reverse`, `is_real_world`, `data` |
| `ref_track_info` | 112 | track_key | `track_key`, `route_id`, `custom_route_id`, `ribbon`, `display_name`, `short_name`, `description`, `name_key`, `use_cross_country_ai`, `blueprint_only`, `activation_zone`, `media_track`, `pi_sort` |
| `ref_event` | 379 | event_id | `event_id`, `kind`, `name`, `track_id`, `route_id`, `class_limit`, `pi_limit`, `region`, `data`, `discipline`, `length_m`, `is_loop`, `source` |
| `ref_event_string` | 898 | event_id, table_name, key_hash | `event_id`, `table_name`, `key_hash`, `key_name`, `role` |
| `ref_career_race` | 291 | race_key | `race_key`, `name`, `event_type`, `track_key`, `collection_key`, `race_mode`, `discipline`, `num_laps`, `n_ai`, `is_timed`, `has_traffic`, `rivals_enabled`, `teams`, `ui_theme`, `entity_name`, `progression_thread` |
| `ref_race_collection` | 170 | collection_key | `collection_key`, `name`, `description`, `collection_type`, `restriction_id`, `forced_restriction_id`, `solo`, `coop`, `pvp`, `recommended_cars` |
| `ref_rivals_event` | 604 | rivals_key | `rivals_key`, `name`, `description`, `leaderboard_id`, `collection_key`, `restriction_id`, `class_id`, `is_class_based`, `sort_index`, `name_key`, `forced_car`, `weather_preset` |
| `ref_region` | 91 | region_id | `region_id`, `name`, `map_x`, `map_y` |

### Game routes and road surface (`Route*.owt`, `Brio_00.nav`, `race_triggers.tz`)

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `ref_route` | 170 | route_id | `route_id`, `name`, `length_m`, `n_points`, `is_loop`, `bbox_x0`, `bbox_x1`, `bbox_z0`, `bbox_z1`, `source`, `road_class`, `pct_loose`, `road_class_known`, `road_class_mix`, `event_id`, `name_source`, `name_confidence`, `is_race` |
| `ref_route_point` | 275,737 | route_id, i | `route_id`, `i`, `x`, `y`, `z` |
| `ref_route_turn` | 3,878 | route_id, turn_id | `route_id`, `turn_id`, `seq`, `arc_m`, `apex_arc_m`, `apex_x`, `apex_y`, `apex_z`, `radius_m`, `peak_radius_m`, `angle_deg`, `dir`, `kind`, `length_m`, `width_m`, `bank_deg`, `road_class`, `road_type`, `road_profile`, `offroad`, `surface_src`, `surface_m`, `segments` |
| `ref_route_surface` | 275,737 | route_id, i | `route_id`, `i`, `road_class`, `road_type`, `road_profile`, `offroad`, `code`, `nav_m`, `src` |
| `route_anchor` | 36 | route_id | `route_id`, `x`, `y`, `z`, `radius_m`, `name`, `source` |

### Save layer — one row per container / part / slider / gear (`Tuning_*/Data`)

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `tune_container` | 763 | container | `container`, `ordinal`, `saved_utc`, `tune_name`, `locked`, `source`, `hw_hash`, `setup_hash`, `tune_hash`, `parts_hash`, `engine_id`, `drivetrain_id`, `carbody_id`, `motor_id`, `body_variant`, `pi`, `class`, `n_parts`, `gear_count`, `mass_kg`, `front_pct`, `file_path`, `file_mtime`, `imported_at`, `description`, `creator`, `creator_xuid`, `created_utc` |
| `tune_part` | 38,150 | container, slot_index | `container`, `slot_index`, `slot`, `part_id`, `name`, `level`, `tile`, `tile_count`, `menu_path`, `is_stock`, `price`, `mass_diff_kg`, `confidence` |
| `tune_slider` | 22,890 | container, slider | `container`, `slider`, `norm`, `value`, `unit`, `min_value`, `max_value`, `locked`, `is_install_default`, `source_slot`, `source_part_id` |
| `tune_gear` | 5,287 | container, gear | `container`, `gear`, `ratio` |

### Hardware-package tier — Car > Hardware package > Tune (ours)

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `hw_package` | 671 | hw_hash | `hw_hash`, `ordinal`, `label`, `pi`, `class`, `engine_id`, `drivetrain_id`, `carbody_id`, `n_containers`, `first_seen_utc`, `last_seen_utc`, `intent` |
| `hw_package_part` | 33,550 | hw_hash, slot_index | `hw_hash`, `slot_index`, `slot`, `part_id`, `name` |
| `setup` | 691 | setup_hash | `setup_hash`, `hw_hash`, `ordinal`, `label`, `n_containers`, `first_seen_utc` |

### Telemetry — sessions, courses, laps, corners (ours, from UDP captures)

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `session` | 645 | session_id | `session_id`, `started_utc`, `duration_s`, `frames`, `rate_pps`, `source`, `file_path`, `imported_at`, `summary` |
| `session_car` | 1,488 | session_id, cid | `session_id`, `cid`, `ordinal`, `build_id`, `hw_hash`, `name`, `class`, `pi`, `drivetrain`, `cyl`, `live_s` |
| `session_event` | 1,048 | session_id, i | `session_id`, `i`, `t0`, `t1`, `cid`, `mode`, `solo`, `laps`, `distance_m`, `duration_s`, `start_x`, `start_z`, `end_x`, `end_z`, `route_key`, `start_is_line` |
| `session_hit` | 26,871 | hit_id | `hit_id`, `session_id`, `kind`, `x`, `z`, `mph`, `hard`, `wheel`, `drop_mph` |
| `course` | 127 | route_key | `route_key`, `name`, `is_rivals`, `event_id`, `length_m`, `turn_count`, `n_laps`, `n_sessions`, `confidence`, `updated_utc`, `geometry`, `profile`, `declared_name`, `declared_source`, `name_source`, `name_confidence` |
| `course_turn` | 2,409 | route_key, turn_id | `route_key`, `turn_id`, `seq`, `arc_m`, `apex_x`, `apex_z`, `radius_m`, `angle_deg`, `kind`, `n_obs` |
| `course_route` | 125 | route_key | `route_key`, `route_id`, `match_kind`, `mean_dev_m`, `p95_dev_m`, `covered`, `len_ratio`, `runner_up`, `computed_utc`, `anchor_route_id`, `anchor_events`, `anchor_agree` |
| `course_event` | 84 | route_key, event_id | `route_key`, `event_id`, `tier`, `route_id`, `d_route_m`, `d_course_m`, `loop_ok`, `road_ok`, `declared_ok`, `chosen`, `computed_utc` |
| `lap` | 1,574 | lap_id | `lap_id`, `route_key`, `session_id`, `cid`, `container`, `hw_hash`, `t0`, `lap_s`, `arc_m`, `coverage`, `is_partial`, `build_id`, `class`, `pi`, `drivetrain`, `tune_hash`, `solo`, `impacts`, `void`, `lap_dist_m`, `rewinds`, `pauses`, `pause_s`, `stitched`, `is_race`, `official` |
| `lap_point` | 515,322 | lap_id, i | `lap_id`, `i`, `arc_m`, `mph`, `grip`, `x`, `z`, `elev_m`, `dist_m`, `thr`, `brk`, `lat_g`, `r_m` |
| `lap_marker` | 787 | lap_id, i | `lap_id`, `i`, `kind`, `t`, `dur_s`, `race_s`, `dist_m`, `over_line`, `detail` |
| `corner_obs` | 17,685 | lap_id, turn_id | `lap_id`, `turn_id`, `route_key`, `entry_mph`, `apex_mph`, `exit_mph`, `min_mph`, `grip_state`, `time_s`, `score` |
| `corner_segment` | 67,741 | lap_id, turn_id, segment | `lap_id`, `turn_id`, `route_key`, `segment`, `n_samples`, `entry_mph`, `exit_mph`, `min_mph`, `mean_mph`, `grip_state`, `time_s`, `grip_hist`, `peak_lat_g` |

### Observation layer — human evidence, every row names its source

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `obs_pi` | 223 | obs_id | `obs_id`, `ordinal`, `container`, `hw_hash`, `slot`, `part_id`, `pi_before`, `pi_after`, `delta`, `source`, `observed_utc`, `note` |
| `obs_menu` | 92 | obs_id | `obs_id`, `ordinal`, `slot`, `tile`, `tile_count`, `name`, `part_id`, `source`, `observed_utc` |
| `obs_evidence` | 129 | obs_id | `obs_id`, `subject`, `claim`, `confidence`, `source`, `observed_utc`, `superseded_by` |

### Field catalogue — knowledge as data

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `ref_field` | 2,007 | store, field | `store`, `field`, `domain`, `storage_type`, `enum_source`, `join_target`, `notes` |
| `ref_field_gate` | 6 | gating_store, gating_field, gated_store, gated_field | `gating_store`, `gating_field`, `gated_store`, `gated_field`, `mechanism`, `evidence` |
| `ref_field_reliability` | 37 | store, field, tier | `store`, `field`, `tier`, `tier_name`, `why`, `source_fn` |

### Diagnosis

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `ref_symptom` | 17 | symptom | `symptom`, `phase`, `primary_fix`, `secondary_fix`, `tertiary_fix`, `verify_test`, `detector`, `source` |
| `diag_event` | 49,067 | event_id | `event_id`, `symptom`, `session_id`, `cid`, `lap_id`, `container`, `hw_hash`, `route_key`, `turn_id`, `phase`, `t`, `mph`, `severity`, `detail`, `source` |

### Materialized deliverables

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `plan_clone` | 0 | plan_id | `plan_id`, `target_container`, `source_container`, `generated_utc`, `n_steps`, `n_customize`, `n_unknown`, `verdict` |
| `plan_clone_step` | 0 | plan_id, step_no | `plan_id`, `step_no`, `phase`, `slot`, `menu_path`, `part_id`, `name`, `tile`, `tile_count`, `confidence`, `note` |
| `plan_readiness` | 0 | container | `container`, `ready`, `n_unknown`, `n_derived`, `blockers`, `computed_utc` |

### Meta

| table | rows | primary key | columns |
| --- | ---: | --- | --- |
| `schema_meta` | 2 | key | `key`, `value` |
| `import_run` | 12,204 | run_id | `run_id`, `kind`, `source`, `started_utc`, `finished_utc`, `n_rows`, `ok`, `notes` |

_Tables covered: 67 of 67 in the live database._
### Views — the consumer contract (10)

`db/schema.sql`'s own convention: *"`v_*` Views. The dashboard bundle is generated from these; no
consumer re-derives."* A view is therefore not a convenience — it is the agreed shape a consumer reads,
and changing one changes the contract. `build_web.py` reads them; the CLI and the dashboard get identical
rows because neither recomputes.

Row counts measured 2026-09-19 on a verified-quiet database (no import stage in flight before or after
the read, `import_run` id stable across it — see the note below).

| View | Rows | Built from | What it answers |
| --- | ---: | --- | --- |
| `v_build_sheet` | 30,004 | `tune_container` × `tune_part` × `ref_car` | One row per container × installed part: the printable build sheet, with `menu_path` and `confidence` already resolved. |
| `v_tune_sheet` | 22,890 | `tune_container` × `tune_slider` × `ref_slider` | One row per container × slider with `norm` AND the de-normalised `value`, its `unit` and the `min`/`max` it was solved against. |
| `v_rim_equivalent` | 87,136 | `tune_part` × `ref_wheel` | Rims interchangeable with the one a container carries — same `mass_level`, per slot. The "swap the look, keep the physics" query. |
| `v_course_best` | 1,499 | `lap` × `course` | Best lap per course × class × car, pre-`rank`ed. The leaderboard the dashboard shows. |
| `v_rivals_route` | 604 | `ref_rivals_event` → `ref_career_race` → `ref_track_info` | One row per Rivals variant with the route it resolves to — the naming chain flattened. |
| `v_diag_by_turn` | 2,925 | `diag_event` × `ref_symptom` × `ref_route_turn` × `course_route` | Which corners cost the most and how often, with the turn's geometry attached. Filters `turn_id IS NOT NULL`. |
| `v_diag_by_course` | 2,396 | `diag_event` × `ref_symptom` × `course` | **Schema 10.** Faults belonging to the whole lap rather than a corner (gearing), which `v_diag_by_turn`'s `turn_id` filter could never surface. |
| `v_diag_by_setup` | 1,148 | `diag_event` × `ref_symptom` × `tune_container` × `ref_car` | What a given setup keeps doing wrong, wherever it happens. |
| `v_torque_point` | 153,282 | `ref_torque_curve` | The `samples` JSON blob expanded to one row per point: `rpm`, `torque_nm`, `torque_lbft`, `power_hp`, plus `limiter` and `past_redline` flags. |
| `v_friction_point` | 73,800 | `ref_friction_curve` | The friction `samples` blob expanded per point: `slip`, `mu_norm`, `mu`, keyed by compound × channel × surface × load band. |

The last two exist because the curve tables store their samples as a JSON blob — the view is what makes
a curve queryable with SQL instead of parsed in every consumer.

> **Measuring a view here is not like measuring a table.** `diag_event` is emptied and re-inserted by the
> `diagnosis` stage, so a count taken inside that window reads **0** and all three `v_diag_*` views look
> broken. That happened three times while writing this section. Gate any measurement on
> `check_db_docs.rebuild_in_flight()` and require the `import_run` id to be unchanged across the read.

## 3. The value catalogue — what the coded values mean

Every list below is the **measured distinct values** in the live DB with row counts, not a guess at what a
column could hold.

### Grip state — `lap_point.grip`, `corner_obs.grip_state`, `corner_segment.grip_state`

The per-sample grip verdict; the same code in all three tables.

| Code | Meaning | `lap_point` rows |
| --- | --- | ---: |
| `0` | calm — neither end sliding | 292,324 |
| `1` | front slipping (understeer) | 73,793 |
| `2` | rear slipping (oversteer) | 22,297 |
| `3` | all four slipping | 100,676 |
| `4` | impact / kerb strike | 22,908 |

### Corner phase — `corner_segment.segment`, `diag_event.phase`, `ref_symptom.phase`

The five-segment corner model; `corner_segment` holds one row per lap × turn × segment.

| Value | Meaning | rows |
| --- | --- | ---: |
| `braking` | the braking zone before turn-in | 18,004 |
| `turn_in` | initial steering input toward the apex | 11,294 |
| `mid` | apex / minimum-speed phase | 14,682 |
| `exit` | power-down out of the corner | 12,502 |
| `straight` | the straight between turns | 10,444 |

`diag_event.phase` uses the same words plus `any` (15,994 — the symptom is not phase-specific) and `entry`;
`ref_symptom.phase` adds `kerbs`.

### Course-to-route match — `course_route.match_kind`

How confidently a learned course maps onto a game route.

| Value | Meaning | courses |
| --- | --- | ---: |
| `verified` | our path lies on the centre-line, we drove essentially all of it, lengths agree | 41 |
| `probable` | strong but incomplete evidence | 11 |
| `partial` | our laps are a *stretch* of that route — true and useful, but the lap times are not route times | 47 |
| `none` | nothing matched | 26 |

### Course naming — `course.name_source` / `name_confidence`

Four tiers, in precedence order `declared > game > map > length`.

| `name_source` | Meaning | courses | paired `name_confidence` |
| --- | --- | ---: | --- |
| `derived:game` | the game's own catalogue named the matched route | 51 | `verified` |
| `declared` | a name we declared (`routes.json` 77, course model 3) | 28 | `read` |
| `derived:length` | identified by catalogue length alone | 1 | `derived` |
| `NULL` | unnamed | 47 | `NULL` |

`course_event.tier` records which evidence tier chose the event: `game` (51), `declared` (28), `map` (4),
`length` (1).

### Lap qualifiers — `lap`

| Field | Values | Meaning |
| --- | --- | --- |
| `official` | `0` (1,111) / `1` (433) | **schema 8.** The GAME published this lap time (`LastLap`), so it is the lap's time by definition. An official lap counts even when it holds a rewind — the game re-timed it. Laps without it must clear the coverage floor (0.97) and carry no rewinds before they may be crowned. |
| `is_partial` | `0` (1,400) / `1` (144) | coverage below 0.9 of the course; can never be crowned fastest |
| `void` | `0` (1,448) / `1` (96) | not comparable (rewind / pause / impact rules) |
| `stitched` | `0` (1,527) / `1` (17) | assembled across a capture gap |
| `is_race` | `NULL` (578) / `0` (639) / `1` (327) | race vs free roam; NULL = undetermined |
| `solo` | `0` (811) / `1` (733) | solo run vs traffic or AI present |

### Surface and barrier hits — `session_hit.kind`

Added 2026-09-18 (`82c6ed6`) to place bottoming and impacts on the course map. One row per detected
hit, keyed to the session rather than to a lap, so a hit outside a timed lap is still recorded.

| Value | Meaning | rows |
| --- | --- | ---: |
| `bottoming` | the floor grounded out; `wheel` names the corner, `drop_mph` the speed lost | 24,417 |
| `wall` | a wall or barrier strike | 2,005 |

`hard` is a 0/1 severity flag — `1` on 19,345 rows, `0` on 7,077.

**`hit_id` (2026-09-19) is a SURROGATE key and had to be.** 6,754 of 26,871 rows were exact
**full-row** duplicates of another row: the same car bottoms at the same spot at the same speed on a
later lap, and the table records no lap or timestamp to separate them. A natural key over any column
set would delete real observations and thin the map overlay, so `hit_id` makes a row addressable
without claiming the data is unique — nothing here can. `import_telemetry.py` wipes the table and
re-inserts, so there is no double-import a unique constraint would have caught anyway.

**`wheel` is NULL on exactly the 2,005 `wall` rows** and set on every `bottoming` row (RR 6,152,
RL 6,122, FR 6,105, FL 6,038). A wall strike has no single wheel, so NULL there is meaningful, not
missing data — do not "fix" it with a default.

`x`/`z` are in the telemetry metre frame, so a hit plots directly on the course map with no transform.

### Lap markers — `lap_marker.kind`

What interrupted a lap: `rewind` (392), `pause` (266), `jump` (50), `gap` (35). A rewind is a lap-clock
reversal, and the lap is cut at the landing lap clock.

### Session events — `session_event.mode`

Four values. The `lapped` variants were described in prose here but never written as literal values,
so nothing could check them:

| Value | Events |
| --- | ---: |
| `timed solo (Rivals / time trial)` | 488 |
| `race` | 380 |
| `timed solo (Rivals / time trial) · lapped` | 240 |
| `race · lapped` | 68 |

`solo` is `1` (728) or `0` (448).

### Road and turn vocabulary

| Field | Values (rows) |
| --- | --- |
| `ref_route_turn.kind` | `medium` (1,578), `fast` (1,126), `tight` (772), `hairpin` (278), `sweeper` (124) |
| `ref_route_turn.dir` | `L` (1,957), `R` (1,921) |
| `ref_route_turn.road_class`, `ref_route.road_class` | `paved` (2,976), `loose` (594), `NULL` (308) |
| `ref_route_surface.road_type` | `a` (118,097), `b` (80,542), `dirt` (28,970), `freeway` (12,373), `trail` (5,687), `hidden` (1,298), `shortcut` (724), `NULL` (28,046) |
| `ref_track_info.ribbon` | `P2P` (72), `Circuit` (31), `Playground` (9) |

### Car, part and tune vocabulary

| Field | Values (rows) |
| --- | --- |
| `ref_class.name` | `D`, `C`, `B`, `A`, `S1`, `S2`, `R`, `X` — eight classes (see the caveat below) |
| `ref_drivetrain.drivetype` | `RWD` (414), `AWD` (200), `FWD` (59) |
| `ref_part.confidence` | `proven` (81,459), `derived` (7,566), `unknown` (8) |
| `tune_part.confidence` | `proven` (25,120), `derived` (4,524), `NULL` (8,056) |
| `tune_container.source` | `downloaded` (692), `self` (62) |
| `ref_slider.band_source` | `fixed` (15), `part` (13), `none` (8) — where that slider's min/max comes from |
| `ref_slider.unit` | `scale`, `deg`, `%`, `psi`, `m`, `kgf`, `N/mm`, `ratio`, `% rear`, `% front`, `NULL` |
| `ref_slider.group_name` | `Alignment`, `Differential`, `Springs`, `Damping`, `Tires`, `Brake`, `Antiroll Bars`, `Aero`, `Gearing` |
| `ref_torque_curve.source` | `camshaft` (1,733), `motor` (19) |
| `ref_friction_curve.channel` × `surface` | `lat` / `brake` / `accel` × `asphalt` / `offroad` / `snow`, 246 curves each |
| `obs_evidence.confidence` | `read` (93 — read off a screen), `verified` (36 — measured) |

### Reliability tiers — `ref_field_reliability.tier_name`

The slider-value reliability hierarchy stored as data — `database` > `2-point solve` > `global band
(field-proven)` > `mass-derived formula` > `single anchor` > `position-only` / `unknown`. It matches the
standing rule: a DB row beats a 2-point solve, beats a band, beats a formula, beats an anchor, and
anything below a DB row is marked derived.

**`tier` is the ladder; `tier_name` is per-domain, and there are TWO vocabularies on it** — which the
prose above hid. 37 rows:

| tier | `tier_name` | fields |
| ---: | --- | ---: |
| 0 | `database` | 7 |
| 0 | `proven` | 2 |
| 1 | `2-point solve` | 6 |
| 1 | `derived` | 2 |
| 2 | `unknown` | 2 |
| 2 | `global band (field-proven)` | 1 |
| 3 | `mass-derived formula` | 2 |
| 4 | `single anchor` | 6 |
| 4 | `single anchor (unscoped)` | 2 |
| 5 | `position-only` | 7 |

- **Slider values** use the named hierarchy (`database`, `2-point solve`, `global band (field-proven)`,
  `mass-derived formula`, `single anchor`, `position-only`).
- **Part-name confidence** (`ref_part.confidence`, `tune_part.confidence`) reuses the same ladder with the
  confidence vocabulary: `proven` at 0, `derived` at 1, `unknown` at 2.
- **`single anchor (unscoped)`** is a WEAKER tier 4, for stores keyed by car ordinal alone with no parts
  fingerprint — `data/car-mass.json` masses and `data/car-tune-ranges.json` points. One historical
  screenshot of one build's mass gets reused for every build of that car. That build-scoping gap is the
  reason the variant exists; do not collapse it into plain `single anchor`.

Compare on `tier` when you need an ordering, never on `tier_name`.

### Event catalogue vocabulary

| Field | Values |
| --- | --- |
| `ref_event.kind` | `career` (291), `rivals` (88) |
| `ref_race_collection.collection_type` | `Exhibition` (101), `Championship` (60), `TeamKing` / `TeamInfected` / `FlagRush` (3 each) |
| `ref_career_race.discipline` | `road` (90), `dirt` (66), `street` (61), `cross-country` (57), `playground` (9), `rush` (3), `drag` (3), `showcase` (2) |
| `ref_career_race.race_mode` | `StreetRace`, `LapsRace`, `P2P`, `CrossCountry`, `TrailRace`, `Scramble`, `CrossCountryCircuit`, `Touge`, `TeamKing`, `TeamInfected`, `TeamFlagRush`, `Rush`, `Drag`, `Showcase` |
| `ref_event_string.role` | `name` (604), `description` (294) |
| `import_run.kind` | one value per rebuild stage: `gamedb`, `objectmodel`, `events`, `curves`, `parts_extra`, `containers`, `telemetry`, `routes`, `anchors`, `surface`, `course_match`, `consolidate`, `route_names`, `corners`, `observations`, `diagnosis`, `field_catalog` |

**Known caveat:** the game separates R (PI 901–998, class 6) from X (999, class 7), but the lab's class map
labels class 6 as `X`. Treat the top band as unresolved rather than authoritative.

## 4. Identity keys — what joins to what

| Key | Lives in | Identifies |
| --- | --- | --- |
| `ordinal` | `ref_car`, `tune_container`, `hw_package`, `session_car` | the **car model** (671 known) |
| `hw_hash` | `hw_package`, `tune_container`, `lap`, `diag_event` | the **upgrade set** — the only honest way to compare builds |
| `tune_hash` | `tune_container`, `lap` | the **slider set** |
| `setup_hash` | `setup`, `tune_container` | hardware plus tune together; the daemon's "is this a new save" key |
| `container` | `tune_*`, `lap`, `plan_*` | one save file on disk |
| `cid` | `session_car`, `lap`, `diag_event` | one car *within* one capture session |
| `route_key` | `course*`, `lap`, `corner_*` | **our** learned course (a start-cell key) |
| `route_id` | `ref_route*`, `route_anchor`, `course_route` | **the game's** route (e.g. `Route132`) |
| `turn_id` | `ref_route_turn` **and** `course_turn` | two separate namespaces — never join by id across them |

Two standing rules are encoded here. **Identity has two directions:** going forward (telemetry → build) may
lean on instant signals, but any compare, distinguish or A-B must use `hw_hash` plus `tune_hash`. And
**`course_turn` is not `ref_route_turn`:** displayed and identified turns come from `ref_route_turn`, while
`course_turn` is the older, roughly doubled driven set.

## 5. `data/*.json` — 48 committed files

**Generated from game data** (refresh them with `docs/game-data-refresh.md`): `car-ordinals.json`
(ordinal → name, projected from `ref_car`), `car-option-lists.json` (944 kB, per-car option lists from the
car archives), `engine-swaps.json` (the engine-family catalog), and `data/game-strings/` (23 tables from
EN.zip).

**Generated from the DB or from captures:** `field-catalog.json` (484 kB, feeds stage `field_catalog`),
`clone-coverage.json`, `identity-evidence.json`, `rivals-tracks.json`, `routes.json`.

**Hand-curated knowledge** — the project's own craft, which a rebuild never overwrites:
`tuning-test-battery.json` (107 kB, the driving instructions), `formulas.json`, `parts-effects.json`,
`parts-pi.json`, `pi-observations.json` (311 kB), `part-names.json`, `part-index-vocabulary.json`,
`slider-baselines.json`, `global-slider-ranges.json`, `car-tune-ranges.json`, `tire-compounds.json`,
`tuning-templates.json`, `tuning-variables.json`, `upgrade-strategy.json`, the four `*-ladder-nsxr.json`
files, `drift-guide.json`, `touge-guide.json`, `training-zone.json`, `progression.json`,
`reference-loops.json`, `meta-cars.json`, `owned-cars.json`, `wheelspin-cars.json`, `tune-codes.json`,
`tuner-sheets.json` (854 kB), `tuners.json`, `tuner-roster.json`, `sources.json`, `rim-id-matches.json`,
`rim-menu-order.json`, `build-letters.json`, `build-liveries.json`, `car-mass.json`, `game-assets.json`,
`tune-raw.json`, `rivals-routes-road.json`, `rivals-routes-dirt.json`, and `eliminator-tips.json` (out of
scope — Eliminator is not played for this project).

`data/builds/` holds build sheets, `data/logs/` holds watcher logs, and the `_backup_*` directories are
dated course and trace snapshots — history, not live inputs.

## 6. `data/sessions/*.json` and `data/courses/*.json`

**Session file** (one per capture, written by `analyze_session.py`). Top-level keys: `id`, `source`,
`frames`, `duration_s`, `rate_pps`, `live_frames`, `markers`, `revoked_frames`, `stitched`, `cars`,
`segments`, `impacts`, `zero_windows`, `strip`, `corners`, `launches`, `braking`, `bottoming`, `wall`,
`pulses`, `stints`, `events`, `crests`, `courses`, `summary`. `cars[]` carries the measured per-car identity
(`ordinal`, `pi`, `class`, `drivetrain`, `cyl`, `max_rpm`, `idle_rpm`, `gears`, `dyno`, `k_wheel`,
`mass_measured`, `tire_radius_m`); `events[]` is one driven event each (`mode`, `solo`, `laps`, `best_lap`,
`distance_m`, `route_key`); `stints[]` groups runs by build. A sibling `*.tags.json` carries `session`,
`stints` and `stint_starts`.

**Course model** (one per course). Keys: `route_key`, `name`, `turns`, `laps`, `sessions`, `updated`,
`best_laps`, `visits`, `cars`, `turn_count`, `profile`, `profile_laps`, `profile_session`, `geometry`,
`geo_turns`, `turn_count_delta`, `speed_traces`. `geometry` holds `length_m`, `path`, `paths`, `turns`,
`lap_paths` and `lat_acc`. Each entry in `turns[]` accumulates across visits (`n`, `best`, `sessions`,
`best_by_car`, `status`, `established`) — judge a new sample against this accumulated model, never the model
against one sample.

## 7. `captures/*.csv.gz` — the raw frames

One row per UDP frame, one file per session (400 on disk). The header begins `t_wall, t_mono, speed_mph,
lat_g, long_g, yaw_rate_dps, TireTempC{FL,FR,RL,RR}, IsRaceOn, TimestampMS, EngineMaxRpm, EngineIdleRpm,
CurrentEngineRpm, Accel{X,Y,Z}, Vel{X,Y,Z}, AngVel{X,Y,Z}, Yaw, Pitch, Roll, NormSusp{FL,FR,RL,RR},
SlipRatio{FL,FR,RL,RR}, WheelRotSpeed{…}, OnRumble…` — the whole 324-byte *Data Out* packet plus derived
columns.

**The persistence gap.** `lap_point` keeps only `arc_m`, `dist_m`, `mph`, `grip`, `lat_g`, `thr`, `brk`,
`r_m`, `x`, `z` and `elev_m`. Everything else — per-wheel slip, velocity components, yaw rate, handbrake — lives
**only** in these captures or in the live SSE stream. Work that needs body slip β = f(`VelX`, `VelZ`) reads
the capture, not the trace. Throttle and brake appear on lap points only from 2026-09-11 (schema 6) onward,
and there is no backfill by default — `backfill_laps.py` (optionally `--sessions FILE` for a targeted
subset) replays captures to fill them.

**`r_m` — the driven radius (schema 9, 2026-09-18).** The radius the car actually drove, `r = v/ω` from the
capture's yaw rate, not the road's fitted centre-line radius (`ref_route_turn.radius_m`, which is a
different thing and must never be substituted). Populated on 192,995 of 511,998 points — NULL on every lap
not re-analysed since 2026-09-18, which is also how you tell which rows carry sub-metre `x`/`z` (schema 9
stopped rounding coordinates to whole metres) from the older whole-metre rows. It reads systematically
tight where the car carries body slip; the measured per-band bias is in `docs/handoff-grip-envelope.md`.

The live frame the daemon serves over SSE (`:8765`) uses short names: `boost, brk, car, cid, cls, cyl,
dist, drv, ev, gear, hb, hp, lapn, lapt, lat, lon, maxrpm, mph, on, pi, px, pz, rpm, rpos, slip, smash,
steer, susp, t, temp, thr, tq, yaw`. `slip` is per wheel `[ratio, angle, combined]`; `susp` and `temp` are
per wheel. Full endpoint list: `DATA-INVENTORY.md` §4.

## 8. `dashboard/v2/api/` — the generated view layer

Written by `build_web.py` from `fh6.db` alone. It is git-ignored and per-worktree, so it exists only where a
build has run. The current build holds `index.json`, `cars.json`, `courses.json`, `packages.json`,
`identity.json`, `evidence.json`, `diag.json` and `world.json`, plus `build/` (664 files, one per hardware
package), `course/` (129), `options/` (196 — the whole Upgrade Shop per car) and `thumb/`. A DB change stays
invisible to the page until `build_web.py` runs; it is **not** a `rebuild.py` stage.

## 9. Keeping this document true

- **Row counts, field lists and enum values are measured**, so they go stale. Re-measure against a
  read-only connection to `data/fh6.db`: `pragma table_info(<table>)` for fields, `select count(*)` per
  table, and `select <col>, count(*) … group by 1` for each value list in §3.
- **The ERD** (file `EV5zhW3hPU6v4Z7PiZoW`, diagram *FH6 Lab Database*) needs a new entity whenever
  `db/schema.sql` gains a table. It shows the key fields per entity; the complete lists live here. The same
  file also holds a *Restructuring Risk Map* — the consolidation proposal, marking the string-matched links
  that carry no enforced foreign key.
- **When a store is added or removed**, update `DATA-INVENTORY.md` in the same commit (its standing rule),
  and add the row here.
- **After a game update**, follow `docs/game-data-refresh.md` and then re-measure: a title update moves row
  counts (671 cars and 290 string tables today) and can introduce new enum values.
