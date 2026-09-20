# FH6 Field-Level Infrastructure Catalog — 2026-09-03

This catalog documents every FH6-relevant data store at the field/column/key level — types, join
targets, enum ranges, and what each value means — across all 86 of 86 locations identified by the
companion location-level sweep, `docs/data-source-census-2026-09-03.md`. Where that census answers
*where data lives and whether it's accessible*, this document answers *what's actually in it*, one
field at a time. Content below is grouped by physical location, not by topic.

## Project database (fh6.db)

### `db-car-world` — Car, Body, Class, Region & Track Reference

**Key structure:** Six independently-keyed tables in `data/fh6.db`, no composite or filename-embedded keys. `ref_car` PK=`ordinal` (INTEGER, =`Data_Car.Id`, 247–4342, non-contiguous) is the hub; `ref_car_body` PK=`carbody_id` (=`ordinal*1000` for stock, `+N` for kit variants); `ref_car_exception` PK=`ordinal` (FK, sparse — only 511/660 cars have a row); `ref_class` PK=`class_id` (0–7); `ref_region` PK=`region_id` (sparse dev/QA ids); `ref_track` PK=`track_id` (sparse). `ref_region`/`ref_track` are independent lookups with weak/unverified links back to `ref_car`.

**Scale:** `fh6.db` file 115,101,696 bytes total (all tables, not isolable per-table — no `dbstat`). Rows: `ref_car` 660, `ref_car_body` 779, `ref_car_exception` 511, `ref_class` 8, `ref_region` 91, `ref_track` 58.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| ref_car.ordinal | int PK | ref_car_body.ordinal, ref_car_exception.ordinal | 247–4342, 660 distinct | = `Data_Car.Id`; hub key |
| ref_car.year | int | — | 1932–2554 | display year, not a reliable calendar date |
| ref_car.make / model / display_name / full_name | text ×4 | — | 90 makes | display_name="Make Model", full_name="Year Make Model" |
| ref_car.media_name | text | asset zip filenames (external) | — | internal asset code, e.g. `HON_NSXR_92` |
| ref_car.class_id / class | int FK + text | ref_class.class_id | 0–6 present (7=X unused) | class text fully redundant with ref_class.name |
| ref_car.pi / pi_norm | int / float | — | pi_norm 0–1 | stock display PI / normalized PI |
| ref_car.curb_weight_kg | float | — | 140.6–9500.0 | stock curb weight |
| ref_car.weight_dist | float | — | 0–1 | front weight fraction |
| ref_car.drivetype | enum | — | AWD, FWD, RWD | stock drivetrain layout |
| ref_car.engine_placement | enum | — | Front/Mid/Rear-engine | engine location |
| ref_car.cylinders | int | — | 0,1,2,3,4,5,6,8,10,12 | 0 = electric/non-piston |
| ref_car.displacement_cc | int | — | — | engine displacement |
| ref_car.aspiration | enum | — | 6 values incl. N/A | induction type |
| ref_car.num_gears | int | — | 1–10 | stock gear count |
| ref_car.stock_engine_id | int FK | ref_engine.engine_id | — | 18/660 null (electrics/specials) |
| ref_car.stock_drivetrain_id | int FK | ref_drivetrain.drivetrain_id | — | never null, 0 orphans |
| ref_car.stock_carbody_id | int FK, derived | ref_car_body.carbody_id | always ordinal×1000 | fully redundant with ordinal |
| ref_car.stock_wheel_id / stock_wheel_level | int FK / int | ref_wheel.wheel_id | — | level mirrors ref_wheel.mass_level (0 heaviest..4 lightest) |
| ref_car.base_cost | int | — | 0–70,000,000 cr | Autoshow price; 0 = non-purchasable |
| ref_car.rarity | float | — | 0.0, 3.0–10.0 (47 vals) | wheelspin rarity tier |
| ref_car.rating_handling/speed/accel/braking/launch/offroad | float ×6 | — | ~0–10 | in-game stat-bar ratings |
| ref_car.front/rear_ride_height_m | float ×2 | — | — | stock ride height |
| ref_car.front/rear_tire_mm | int ×2 | — | — | stock tire width |
| ref_car.front/rear_rim_in | int ×2 | — | — | stock rim diameter |
| ref_car.is_drivable | bool | — | always 1 | table pre-filtered to drivable cars |
| ref_car.in_autoshow | bool | — | 0(171)/1(489) | purchasable in Autoshow |
| ref_car.data | JSON, uniform 150-key | — | — | Sim* physics, `_&hash` string refs, handling constants; RegionID/CountryID look like FKs to ref_region but are NOT reliable |
| ref_car_body.carbody_id | int PK | — | — | = ordinal×1000 (+ kit suffix) |
| ref_car_body.ordinal | int FK | ref_car.ordinal | — | owning car; 779 rows / 660 cars |
| ref_car_body.variant | int | — | 0(660),1(115),10/11(4) | 0 = stock; nonzero = installable kit |
| ref_car_body.name | text | — | 'Stock Body', 'Widebody Kit'... | display name of body variant |
| ref_car_body.length/width/height/wheelbase_m | float ×4 | — | — | body dimensions |
| ref_car_body.data | JSON, uniform | — | — | ModelFrontTrackOuter etc.; PristineBoundingBox often zeroed placeholder |
| ref_car_exception.ordinal | int PK/FK | ref_car.ordinal | — | only 511/660 cars have a row at all |
| ref_car_exception.no_mirrors…no_decals_wing_aftermarket | bool ×8 | — | 0/1 | livery/graphics exceptions only — NOT upgrade-rule gates |
| ref_car_exception.n_flags | int | — | 0–8 | count of set flags |
| ref_class.class_id | int PK | — | 0=D..7=X | PI class enum id |
| ref_class.name | text UNIQUE | — | D,C,B,A,S1,S2,R,X | class code |
| ref_class.norm_max / pi_max | float / int | — | — | class ceiling (normalized / displayed) |
| ref_class.norm_prev / pi_prev | float / int | — | — | class floor anchor |
| ref_region.region_id | int PK | — | sparse | dev/QA-heavy id set |
| ref_region.name | text | — | can be '' | mostly internal dev/QA/test-tooling labels, not real map regions |
| ref_region.map_x/map_y | float ×2 | — | only 3 distinct pairs across 91 rows | NOT real coordinates — dev-tool placeholder anchors |
| ref_track.track_id | int PK | — | sparse | 58 rows |
| ref_track.name / media_name | text ×2 | — | 30/58 contain "Test" | dev/QA placeholder track labels |
| ref_track.length_m | float | — | 57/58 = 5954.0 | templated placeholder, not measured |
| ref_track.is_reverse | bool | — | — | reverse-direction ribbon flag |
| ref_track.is_real_world | bool | — | 1(57)/0(1) | flag name unreliable given content |
| ref_track.data | JSON uniform, 49 keys | — | — | DisplayName as `_&hash` refs; nearly all textures point at generic placeholder |

---

### `db-engine-parts` — Engine, Motor, Drivetrain & Upgrade-Part Catalog

**Key structure:** `ref_engine` PK=`engine_id`; `ref_motor` PK=`motor_id`; `ref_drivetrain` PK=`drivetrain_id`; `ref_part` composite PK (`slot`,`part_id`) WITHOUT ROWID — `slot` FK to `ref_slot`, `part_id` a per-slot id (usually `parent_key*1000+Level`, but `rim_style`/`rear_rim_style` use flat non-level ids); `ref_part_attribute` PK=`attribute_id` (fully orphaned — FK to ref_part never populated); `ref_part_slider` composite PK (`slot`,`part_id`,`slider`) WITHOUT ROWID, FKs to both `ref_part` and `ref_slider`.

**Scale:** `fh6.db` 115,101,696 bytes total (77 tables). Rows: `ref_engine` 670, `ref_motor` 19, `ref_drivetrain` 662, `ref_part` 87,655 (47 of 49 slots populated), `ref_part_attribute` 546 (fully orphaned), `ref_part_slider` 65,864 (22 slider names).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| ref_engine.engine_id | int PK | ref_part.key_id (Engine-category slots) | — | one physics profile per engine variant |
| ref_engine.name | text | — | — | e.g. '2.0L I6' |
| ref_engine.media_name | text | car/livery asset (informal) | — | asset code of stock-fitment car model |
| ref_engine.config | text | — | — | **DEAD** — 0/670 non-null, superseded by data.ConfigID |
| ref_engine.cylinders | int | — | — | **DEAD** — 0/670 non-null |
| ref_engine.displacement_cc | int | — | — | **DEAD** — 0/670, no JSON equivalent either |
| ref_engine.aspiration_stock | text | — | — | **DEAD** — 0/670 non-null |
| ref_engine.mass_kg | real | — | 22.0–1156.0 | engine block mass |
| ref_engine.redline_rpm | real | — | — | **DEAD** — no source anywhere in this table |
| ref_engine.data | JSON, 24 keys, uniform | — | — | ConfigID enum (1=V,2=W,3=Inline,4=Rotary,5=Flat), CylinderID rank-enum, Compression, boost, fuel/inertia constants, EngineName |
| ref_motor.motor_id | int PK | ref_part.key_id (Motor category) | — | one profile per EV motor (19 total) |
| ref_motor.name | text | — | always '' | MotorName unpopulated in source DB |
| ref_motor.media_name | text | — | — | car-model asset code |
| ref_motor.mass_kg | real | — | 155.0–1776.0 | motor mass |
| ref_motor.battery_kwh | real | — | 13.8–212.7 | battery capacity |
| ref_motor.redline_rpm | real | — | 7500–21000 | (populated, unlike ref_engine's) |
| ref_motor.data | JSON, 12 keys | — | — | torque/power graphing, ConfigID=6 (Electric, extends engine enum) |
| ref_drivetrain.drivetrain_id | int PK | ref_part.key_id (Drivetrain category) | — | car's own set or shared swap-set id |
| ref_drivetrain.drivetype | text enum | — | FWD/RWD/AWD | resolved from DrivetypeID |
| ref_drivetrain.shift_system | text | — | — | **DEAD** — superseded by data.ShiftSystemID |
| ref_drivetrain.is_swap_set | bool | — | 0/1 | 1 only for 3 shared swap sets (455/235/3-car fanout) |
| ref_drivetrain.n_cars | int | — | 1–455 | fanout of cars reaching this drivetrain |
| ref_drivetrain.data | JSON, 4 keys | — | — | DrivetypeID, EngineMountingDirection, ShiftSystemID (unresolved id maps) |
| ref_part.slot | text FK | ref_slot.slot | 47 populated of 50 defined | which upgrade-menu category |
| ref_part.part_id | int (composite PK) | — | — | per-slot id, verified = data.Id |
| ref_part.key_id | int | ref_car/engine/drivetrain/carbody/motor (by category) | — | parent entity scope; NULL for rim slots |
| ref_part.level | int | — | 0..N | upgrade tier; NULL for rim_style/rear_rim_style |
| ref_part.is_stock | bool | — | 0(57481)/1(30174) | default part for its (slot,key_id) |
| ref_part.name | text | — | — | resolved display name; 8/87655 unresolved |
| ref_part.manufacturer | text | unnamed manufacturer lookup | — | NULL both when absent and when ManufacturerID=0 |
| ref_part.price | int | — | — | credits cost |
| ref_part.mass_diff_kg | real | — | — | part's own mass delta |
| ref_part.weight_dist_diff | real | — | — | weight-distribution shift |
| ref_part.tile / tile_count | int / int | — | — | menu position |
| ref_part.requires_aspiration | text | — | — | **DEAD** — 0/87655 non-null |
| ref_part.requires_graphics | bool | — | 0/1/NULL | present only on ~13 visual-adjacent slots |
| ref_part.confidence | text enum | — | proven(80181)/derived(7466)/unknown(8) | sourcing confidence |
| ref_part.data | JSON, 47 distinct per-slot shapes | — | — | slot-specific physics row; common core: Id, Level, IsStock, Price, MassDiff, ManufacturerID |
| ref_part_attribute.attribute_id | int PK | — | — | = List_PartAttribute.PartAttributeID |
| ref_part_attribute.manufacturer_id | int enum | — | 1–53 | DIFFERENT numbering space than ref_part.data ManufacturerID |
| ref_part_attribute.price | int enum | — | 0(342)/5000(204) | only two values occur |
| ref_part_attribute.mass_kg | real | — | — | absolute mass (not diff) |
| ref_part_attribute.drag_scale / wind_scale | real / real | — | constant 1.0 | no-op fields |
| ref_part_attribute.mass_is_engine | bool | — | 0(108)/1(438) | mass matches a ref_engine.mass_kg |
| ref_part_attribute.slot / part_id | text/int | ref_part (declared) | — | **ALWAYS NULL** — orphaned |
| ref_part_attribute.join_status | text enum | — | always 'orphan' | documents the orphan state |
| ref_part_slider.slot/part_id | text+int FK | ref_part(slot,part_id) | — | which fitted part contributes the band |
| ref_part_slider.slider | text FK | ref_slider.slider | 22 distinct | which tuning slider |
| ref_part_slider.def/min/max_value | real ×3 | — | — | physical band this part contributes |
| ref_part_slider.def_norm | real | — | 0–1 | normalized default position |
| ref_part_slider.locked | bool | — | 0/1 | 1 when min==max |

---

### `db-sliders-tires-presets` — Sliders, Slots, Compounds, Wheels & Presets

**Key structure:** `ref_slider` PK=`slider` (text, 36 rows — one per tuning-blob slot; 8 unidentified `_unk_*` stubs). `ref_slot` PK=`slot_index` (int, 50 rows, secondary unique key `slot`). `ref_compound` PK=`compound_id` (41 rows). `ref_wheel` PK=`wheel_id` (1248 rows). `ref_wheel_category` PK=`category_id` (5 rows). `ref_preset` PK=`preset_id` (448 rows, each tied to exactly one car via `ordinal`). `ref_preset_part` composite PK (`preset_id`,`slot`) WITHOUT ROWID (17,617 rows). `ref_slider.slot_index` and `ref_slot.slot_index` are parallel-but-distinct positional namespaces — must not be joined to each other.

**Scale:** `fh6.db` 115,101,696 bytes total. Rows: ref_slider 36, ref_slot 50, ref_compound 41, ref_wheel 1248, ref_wheel_category 5, ref_preset 448, ref_preset_part 17,617.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| ref_slider.slider | text PK | — | 36 fixed | stable tuning-blob slot name; 8 unidentified `_unk_*` stubs |
| ref_slider.slot_index | int | — | 0–35 | position in 46-float tuning blob (offset = 0x19E+4×i) |
| ref_slider.group_name | text, nullable | — | Aero, Gearing, Brake, Diff, Tires, Alignment, Springs, ARB, Damping, NULL | UI tab group |
| ref_slider.display_name | text, nullable | — | — | in-game label |
| ref_slider.unit | text, nullable | — | psi, in, N/mm, deg, kgf, %, ratio, m, scale, NULL | display unit |
| ref_slider.band_source | enum | — | part(17)/fixed(11)/none(8) | where min/max come from |
| ref_slider.source_slot | text FK, nullable | ref_slot.slot | — | supplying installed-part slot |
| ref_slider.fixed_min/max | real, nullable | — | camber −5..5°, toe −5..5°, caster 1..7°, tire 15..55psi etc | hardcoded range when band_source='fixed' |
| ref_slider.formula | text | — | — | UI conversion note / provenance caveat |
| ref_slider.confidence | enum, default verified | — | verified(28)/unknown(8) | semantics confirmed? |
| ref_slot.slot_index | int PK | — | 0–49 | position in part-selection container |
| ref_slot.slot | text UNIQUE | — | 50 distinct | stable join name (e.g. engine, tire_compound, rim_style) |
| ref_slot.part_name | text | — | — | game's own PartName |
| ref_slot.source_table | text, nullable/empty | FH6_Database.sqlite List_Upgrade* | — | source table; empty for aspiration |
| ref_slot.category | enum | — | Car(12)/Engine(18)/Drivetrain(4)/CarBody(12)/Motor(1)/Wheels(2)/''(1) | which car sub-object |
| ref_slot.key_column | text, nullable | — | Ordinal/EngineID/DrivetrainID/CarBodyID/MotorID/NULL | FK column used |
| ref_slot.upgrade_type_id | int FK, nullable | UpgradeTypes.id (raw DB) | — | NULL only for quad_turbo |
| ref_slot.menu_area/menu_area_order | text/int, nullable | — | 7 shop tabs | shop tab and order |
| ref_slot.menu_order | int, nullable | — | — | tile order within tab |
| ref_slot.is_visual | bool, default 0 | — | 0/1 | cosmetic slot (6 rows: body/wing/bumpers/hood/skirts) |
| ref_slot.in_upgrade_shop | bool, default 1 | — | 0/1 | 0 = Paint-and-Customize only (3 rows) |
| ref_compound.compound_id | int PK | ref_part(slot='tire_compound') part_id values | 41 rows, ids 1–53 sparse | = List_TireCompound.TireCompoundID |
| ref_compound.name | text, nullable | — | — | tier group name; NULL for 11 classic/niche rows |
| ref_compound.internal_name | text | — | '<id>_<slug>' | raw DisplayName slug |
| ref_compound.lat/long/brake_slip_peak | real ×3 | — | ~4.0–9.0° | asphalt grip cutoff thresholds |
| ref_compound.lat_slip_peak_offroad/friction_scale/wear_scale | real, nullable | — | — | **DEAD** — always NULL; real data only in `data` JSON |
| ref_compound.data | JSON, 122 keys | curve tables not in fh6.db | — | full friction/slip/heat/wear physics row |
| ref_wheel.wheel_id | int PK | ref_part(slot in rim_style/rear_rim_style) | 1248 rows, ids sparse 1–99107 | = List_Wheels.ID |
| ref_wheel.name/manufacturer | text, nullable | — | — | NULL for 511/516 stock rows |
| ref_wheel.full_name | text | — | — | concatenated name-bar string |
| ref_wheel.media_name | text | — | — | asset/texture key |
| ref_wheel.mass | real | — | — | NOT the performance attribute — reference only |
| ref_wheel.mass_level | int enum | — | 0(153)/1(226)/2(311)/3(401)/4(157) | the actual weight class used |
| ref_wheel.price | int | — | 0 for stock | credit cost |
| ref_wheel.is_stock | bool | — | 1(656)/0(592) | OEM vs aftermarket |
| ref_wheel.category_id | int FK, nullable | ref_wheel_category.category_id | NULL(721),2(226),3(130),4(171) | shop category; 65 aftermarket rows lack it too |
| ref_wheel.display_order | int, nullable | — | — | Upgrade Shop tile order |
| ref_wheel.tile_row/tile_col | int, nullable | — | — | derived grid position |
| ref_wheel_category.category_id | int PK | — | — | 5 rows |
| ref_wheel_category.name | text | — | Stock, Sport, Multi Piece, Specialized, All Rim Styles | category tab label |
| ref_wheel_category.display_order | int | — | 1–5 | tab order |
| ref_preset.preset_id | int PK | UpgradePresetPackages.Id | — | one of 448 pre-built packages |
| ref_preset.ordinal | int FK | ref_car.ordinal | 268 cars, 249–4341 | which car this preset targets |
| ref_preset.title/description | text | — | — | resolved display copy |
| ref_preset.kind | enum | — | forza(357), offroad, race, muscle, libertywalk, rocketbunny, rwb, ~13 brand kits | tuning style category |
| ref_preset.thumbnail | text | — | — | texture path source of `kind` |
| ref_preset.purchasable | bool | — | 0(330)/1(118) | needs credits |
| ref_preset.release_order | int | — | constant 0 | dead in practice |
| ref_preset.n_parts/n_parts_joined | int | — | 28–42 | slots set / resolved (always equal today) |
| ref_preset.n_gears | int | — | 0,1,3–10 | active gear-array entries |
| ref_preset.tuning_hex | text hex | — | 368 hex chars = 184 bytes | raw Tuning blob (36 sliders+10 gears) |
| ref_preset.tuning | JSON | — | — | decoded {sliders, gears} |
| ref_preset_part.preset_id | int FK (composite) | ref_preset.preset_id | — | owning preset |
| ref_preset_part.slot | text FK (composite) | ref_slot.slot | 48/50 slots appear | slot filled |
| ref_preset_part.part_id | int | — | 314–16620016 | installed part id |
| ref_preset_part.name | text, nullable | — | — | resolved part name |
| ref_preset_part.joined | bool, default 0 | — | constant 1 | join-success flag, currently uninformative |

---

### `db-curves-strings-diag` — Torque/Friction Curves, Symptom Rulebook, String Tables & Empty Event Table

**Key structure:** `ref_torque_curve.curve_id` (int PK, 1725 rows; motor rows follow `motor_id*100+100`, camshaft rows use arbitrary game ids). `ref_friction_curve.curve_id` (int PK, 1–738 sequential). `ref_symptom.symptom` (text PK, 11-row hand-curated rulebook). `ref_string` composite PK (`table_name`,`key_hash`) WITHOUT ROWID — `key_hash` alone NOT unique (1,346/56,096 collide across tables). `ref_string_table.table_name` (text PK, 287 rows). `ref_event.event_id` (text PK per schema; 0 rows — never populated).

**Scale:** `fh6.db` 115,101,696 bytes total (~40 tables). Rows: ref_torque_curve 1,725; ref_friction_curve 738; ref_symptom 11; ref_string 58,722; ref_string_table 287; ref_event 0.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| ref_torque_curve.curve_id | int PK | — | 1000–4487004, 1725 distinct | camshaft or motor dyno curve id |
| ref_torque_curve.source | enum | — | camshaft(1706)/motor(19) | which upgrade path produced curve |
| ref_torque_curve.engine_id | int FK | ref_engine.engine_id | — | NULL on motor rows |
| ref_torque_curve.motor_id | int FK | ref_motor.motor_id | — | NULL on camshaft rows |
| ref_torque_curve.part_id | int FK, NOT globally unique | ref_part(slot='camshaft',part_id) | — | must filter by slot — id reused across 16 slots |
| ref_torque_curve.level | int enum | — | 0–3 | camshaft tier |
| ref_torque_curve.is_stock | bool | — | 689=1/1036=0 | factory-matching curve; NOT simply level==0 |
| ref_torque_curve.n_samples | int | — | 91 typical, up to 171 | last sample = limiter cut, not a real point |
| ref_torque_curve.rpm_step | float | — | constant 100.0 | sample spacing |
| ref_torque_curve.max_rpm | float | — | 9000–17000 | =100×(n_samples−1) |
| ref_torque_curve.redline_rpm/stall_rpm | float | — | — | curve's own redline / idle |
| ref_torque_curve.torque_scale | float | — | — | Nm at normalized 1.0 (peak) |
| ref_torque_curve.zero_throttle_scale | float | — | 65–100 | closed-throttle engine-braking scale |
| ref_torque_curve.limiter_value | float | — | −2.6..−13.7 | excluded final sample |
| ref_torque_curve.peak_torque_nm/rpm, peak_power_hp/rpm | float ×4 | — | — | derived peaks |
| ref_torque_curve.samples | JSON array | — | — | n_samples normalized torque values |
| ref_friction_curve.curve_id | int PK | — | 1–738 | List_TireFrictionCurve.FrictionCurveID |
| ref_friction_curve.compound_id | int FK | ref_compound.compound_id | 41 distinct | tire compound |
| ref_friction_curve.multicurve_id | int FK | List_TireFrictionMultiCurve (raw) | 369 distinct | groups load_band=0/1 pair |
| ref_friction_curve.channel | enum | — | lat/accel/brake, 246 each | force axis modeled |
| ref_friction_curve.surface | enum | — | asphalt/offroad/snow, 246 each | authored surface |
| ref_friction_curve.load_band | enum(int) | — | 0(369)/1(369) | light (~10.2kgf) vs heavy (~1000kgf) |
| ref_friction_curve.load_kgf/load_clamp_kgf | float | — | clamp 3500.0 | authoring load |
| ref_friction_curve.max_slip | float | — | 49.5°(lat) / 1.1(accel/brake) | full-scale slip span |
| ref_friction_curve.slip_unit | enum | — | deg(246)/ratio(492) | unit for max_slip/peak_slip |
| ref_friction_curve.n_samples | int | — | constant 100 | — |
| ref_friction_curve.friction_scale | float | — | — | peak mu multiplier |
| ref_friction_curve.peak_slip | float | — | — | curve's own argmax |
| ref_friction_curve.authored_peak_slip/authored_peak_raw | float | — | — | pre/post unit conversion |
| ref_friction_curve.samples | JSON array | — | — | 100 normalized mu values |
| ref_symptom.symptom | text PK | — | 11 rows | handling-symptom description |
| ref_symptom.phase | enum | — | entry/mid/exit/braking/straight/kerbs/any | corner phase |
| ref_symptom.primary/secondary/tertiary_fix | text | — | — | ranked tuning-change advice (prose) |
| ref_symptom.verify_test | text (loose FK) | tuning-test-battery.json | 7 named tests | confirms fix |
| ref_symptom.detector | text | — | — | how analyzer recognizes symptom |
| ref_symptom.source | text | — | 10 rows: symptom_matrix; 1: own note | provenance of fix ranking |
| ref_string.table_name | text (composite PK) | ref_string_table.table_name | — | source .str table |
| ref_string.key_hash | int (composite PK) | — | 113867–4294958667 | rotl32 hash of key_name; NOT unique alone |
| ref_string.key_name | text | — | — | original key; 0/58,722 currently NULL despite schema comment |
| ref_string.content | text | — | 0–995 chars, mean 40.6 | resolved display string |
| ref_string_table.table_name | text PK | — | 287 rows | e.g. Data_Car, Dialogue |
| ref_string_table.name_hash | int UNIQUE | — | — | hi32 of every ref into this table |
| ref_string_table.n_entries | int | — | 0–6963 | row contribution; sums to exactly 58,722 |
| ref_string_table.has_csv | bool | — | 1(69)/0(218) | CSV mirror existed at import |
| ref_event.event_id | text PK | — | — | **0 rows** — never implemented, no importer |
| ref_event.kind | enum, open-ended | — | rivals, career, drift_zone, … (comment trails off) | intended event mode |
| ref_event.name/track_id/route_id/class_limit/pi_limit/region/data | mixed | ref_track.track_id | — | intended event fields, all unpopulated |
| course.event_id (external) | text FK | ref_event.event_id | — | only column that references ref_event; always NULL today |

---

### `db-tune-hardware` — Save-File Tune, Hardware Package & Setup Tables

**Key structure:** `tune_container.container` (text PK) = save-folder name `Tuning_<ordinal>_<yyyymmddhhmmss>`. Three content-derived SHA1[:16] hash keys computed from fixed byte ranges of the 598-byte save: `hw_hash` (ordinal+100 part slots → hardware only), `setup_hash` (+ full slider/gear region → hardware+sliders+gears), `tune_hash` (slider/gear region alone). `hw_hash`/`setup_hash` double as PKs of rollup tables `hw_package` and `setup`. Child tables: `tune_part` composite PK (`container`,`slot_index`, 50 rows/container); `tune_slider` composite PK (`container`,`slider`, 30 rows/container); `tune_gear` composite PK (`container`,`gear`, variable rows); `hw_package_part` composite PK (`hw_hash`,`slot_index`, snapshot from one representative container).

**Scale:** `fh6.db` 115,101,696 bytes total. Rows: tune_container 580, tune_part 29,000, tune_slider 17,400, tune_gear 4,075, hw_package 506, hw_package_part 25,300, setup 513.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| tune_container.container | text PK | — | `Tuning_<ordinal>_<ts>` | save-container folder name |
| tune_container.ordinal | int FK | ref_car.ordinal | — | car identity |
| tune_container.saved_utc | text | — | — | parsed save timestamp |
| tune_container.tune_name | text | — | — | UTF-16 name, never null |
| tune_container.locked | bool | — | 0(49 self)/1(531 downloaded) | downloaded tunes cannot be starting points |
| tune_container.source | text enum | — | downloaded(531)/self(49) | derived 1:1 from `locked` |
| tune_container.hw_hash | text 16-hex FK | hw_package.hw_hash | — | hardware fingerprint |
| tune_container.setup_hash | text 16-hex FK | setup.setup_hash | — | hardware+sliders+gears fingerprint |
| tune_container.tune_hash | text 16-hex | — | — | sliders+gears only; no rollup table exists |
| tune_container.parts_hash | text | — | — | **DEAD** — always NULL, function exists but never called |
| tune_container.engine_id/drivetrain_id/carbody_id/motor_id | int FK ×4 | ref_engine/ref_drivetrain/ref_car_body/ref_motor | — | resolved fitted parts; motor_id null except EV (13/567 nulls resp.) |
| tune_container.body_variant | int enum | — | 0(469)/1(111) | stock vs kit body |
| tune_container.pi | int | — | — | **DEAD** — always NULL |
| tune_container.class | text enum | — | D,C,B,A,S1,S2,R | copied from ref_car.class (stock, not recomputed) |
| tune_container.n_parts | int | — | ~30–45 | populated slots |
| tune_container.gear_count | int | — | 1,4–10 | populated gear slots |
| tune_container.mass_kg | float | — | — | precomputed mass ledger, verified to −1.4% vs in-game |
| tune_container.front_pct | float | — | 0–100 | front weight-distribution % |
| tune_container.file_path/file_mtime | text/float | — | — | source Data-file location & mtime |
| tune_container.imported_at | text | — | — | last rebuild time (shared across rows) |
| tune_container.description | text, nullable | — | — | 349/580 null |
| tune_container.creator/creator_xuid/created_utc | text/int/text | — | — | gamertag, XUID, original creation time |
| tune_part.container | text FK (composite) | tune_container.container | — | owning build |
| tune_part.slot_index | int (composite PK) | — | 0–49 | fixed slot position |
| tune_part.slot | text FK | ref_slot.slot | 50 distinct | slot name |
| tune_part.part_id | int FK | ref_part(slot,part_id) | — | NULL = empty slot (never 0) |
| tune_part.name/level/tile/tile_count | text/int×3 | ref_part fields | — | resolved display metadata |
| tune_part.menu_path | text | — | — | human breadcrumb |
| tune_part.is_stock | bool | — | 0(9222)/1(13643)/NULL(6135) | stock vs upgraded |
| tune_part.price | int | — | — | shop price |
| tune_part.mass_diff_kg | float | — | — | part's mass contribution |
| tune_part.confidence | text enum | — | proven(19385)/derived(3480)/NULL(6135) | resolution reliability |
| tune_slider.container/slider | text+text (composite PK) | tune_container / ref_slider | 30 of 36 defined | slider reading id |
| tune_slider.norm | float | — | 0–1 | raw F32 from save |
| tune_slider.value | float, nullable | — | — | de-normalized physical value; 1160/17400 null |
| tune_slider.unit | text enum, nullable | — | %, N/mm, deg, kgf, m, psi, ratio, scale | physical unit |
| tune_slider.min/max_value | float, nullable | — | — | band supplied by fitted part |
| tune_slider.locked | bool | — | 0(15770)/1(1630) | non-adjustable band |
| tune_slider.is_install_default | bool | — | 0(9561)/1(7839) | untouched from install default |
| tune_slider.source_slot/source_part_id | text/int FK | ref_slot/ref_part | — | which fitted part supplied band |
| tune_gear.container/gear | text+int (composite PK) | tune_container | 0(final)–9 | gear-ratio slot |
| tune_gear.ratio | float | — | 0–1 | raw normalized F32, NOT de-normalized |
| hw_package.hw_hash | text PK | — | — | one row per distinct hardware fingerprint (506) |
| hw_package.ordinal | int FK | ref_car.ordinal | — | MIN(ordinal) of members |
| hw_package.label | text | — | — | **DEAD** — always NULL |
| hw_package.pi | int | — | — | **DEAD** — always NULL |
| hw_package.class | text enum | — | A(86),B(125),C(19),D(80),R(24),S1(110),S2(62) | MAX(class) of members |
| hw_package.engine_id/drivetrain_id/carbody_id | int FK | ref_engine/ref_drivetrain/ref_car_body | — | MAX() of members |
| hw_package.n_containers | int | — | 1–7 | saves sharing this hardware |
| hw_package.first/last_seen_utc | text ×2 | — | — | MIN/MAX saved_utc of members |
| hw_package.intent | text enum | — | course/general/drift/drag (documented, unpopulated) | **DEAD** — always NULL, tuning-lane classifier never written |
| hw_package_part.hw_hash/slot_index | text+int (composite PK) | hw_package.hw_hash | 0–49 | snapshot key |
| hw_package_part.slot/part_id/name | text/int/text | ref_part | — | snapshot from one representative container |
| setup.setup_hash | text PK | — | — | 513 distinct full setups |
| setup.hw_hash | text FK | hw_package.hw_hash | — | owning hardware package |
| setup.ordinal | int FK | ref_car.ordinal | — | MIN(ordinal) of members |
| setup.label | text | — | — | **DEAD** — always NULL |
| setup.n_containers | int | — | 1–7 | saves sharing this exact setup |
| setup.first_seen_utc | text | — | — | MIN(saved_utc) |

---

### `db-courses-routes` — Driven Courses & Game Route Geometry

**Key structure:** Driven side: `course` PK=`route_key` (text, `<x>_<z>` start-cell key, also the `data/courses/<route_key>.json` basename); `course_route` PK=`route_key` (FK, 1 match-attempt/course); `course_turn` composite PK (`route_key`,`turn_id`) WITHOUT ROWID, `turn_id`='T'+digit in arc order (distinct from geometry JSON's 'G'+digit drive-order ids). Game-authored side: `ref_route` PK=`route_id` (text, parsed from `.owt` filename); `ref_route_point`/`ref_route_surface` composite PK (`route_id`,`i`) WITHOUT ROWID — `i` is only the EVEN half of the original polyline (uniform 2× decimation, verified on all 169 routes); `ref_route_turn` composite PK (`route_id`,`turn_id`). The two sides bridge only via `course_route.route_id → ref_route.route_id` (fuzzy match, quality-tagged).

**Scale:** course 62, course_route 57, course_turn 900, ref_route 169, ref_route_point 284,208, ref_route_surface 284,208 (1:1 with points), ref_route_turn 3,812. `fh6.db` 115,101,696 bytes total.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| course.route_key | text PK | course_route/course_turn/corner_obs.route_key | `-?\d+_-?\d+` | map-cell key of course start point |
| course.name | text, nullable | — | — | display name; only 4/62 set |
| course.is_rivals | bool | — | 0(61)/1(1) | Rivals leaderboard event |
| course.event_id | text FK, nullable | ref_event.event_id | — | 0/62 populated; ref_event is empty so never resolves |
| course.length_m | float | — | 276–49,076 | derived course length |
| course.turn_count | int | — | 0–172 | detected turn count |
| course.n_laps / n_sessions | int ×2 | — | 1–211 / 1–39 | contributing laps / sessions |
| course.confidence | float | — | — | **DEAD** — always NULL |
| course.updated_utc | text | session.session_id | — | NOT a timestamp — holds a session_id |
| course.geometry | JSON | — | — | path/paths, turns[] (G-ids), lat_acc, det tag, session |
| course.geometry.turns[] | array<obj> | — | dir L/R | apex/entry/exit, radius_m, deg, len_m, speed_ref_lap |
| course.profile | JSON | — | — | dims, heavy/absent, gears_used, top_speed, rough_frac |
| course.profile.dims | obj, 7 fixed keys | — | band: absent/light/moderate/heavy | low/mid/fast_corner, braking, straight, elevation, launch |
| course_route.route_key | text PK/FK | course.route_key | — | 57/62 courses have a match attempt |
| course_route.route_id | text FK, nullable | ref_route.route_id | — | NULL iff match_kind='none' |
| course_route.match_kind | enum | — | none(17), partial(31), probable(2), verified(7) | match confidence tier |
| course_route.mean_dev_m / p95_dev_m | float ×2 | — | up to 8738/9999 (sentinel on 'none') | lateral deviation |
| course_route.covered | float | — | 0–1 | fraction of route covered |
| course_route.len_ratio | float | — | 0.027–3.994 | driven length / route length |
| course_route.runner_up | text | ref_route.route_id | — | second-best candidate, always populated |
| course_route.computed_utc | text ISO | — | single value across all rows | one batch re-match run |
| course_turn.route_key+turn_id | text+text (composite PK) | course.route_key; corner_obs | 'T'+digit | one canonical turn |
| course_turn.seq / arc_m | int/float | — | — | arc-order position |
| course_turn.apex_x/apex_z | float ×2 | — | — | apex world coords |
| course_turn.radius_m | float | — | 3.0–1241.0 | turn radius |
| course_turn.angle_deg | float | — | 10.0–730.0 | turn angle |
| course_turn.kind | enum, nullable | — | NULL(632), fast(115), hairpin(39), medium(114) | severity — comment mismatches own data |
| course_turn.n_obs | int, nullable | — | 1–2171 | observation count backing classification |
| ref_route.route_id | text PK | — | 169 rows | parsed from `Route<id>.owt` |
| ref_route.name | text, nullable | — | always NULL | unfilled placeholder |
| ref_route.length_m | float | — | 170.2–85,272.9 | route length |
| ref_route.n_points | int | — | — | ORIGINAL point count (≠ stored ref_route_point rows) |
| ref_route.is_loop | bool | — | 0(132)/1(37) | closed loop |
| ref_route.bbox_x0/x1/z0/z1 | float ×4 | — | — | bounding box |
| ref_route.source | text | — | `Route<id>.owt` | source filename |
| ref_route.road_class | enum, nullable | — | paved(111), mixed(39), loose(3), NULL(16) | dominant surface |
| ref_route.pct_loose / road_class_known | float, nullable | — | 0–1 | loose fraction / classified fraction |
| ref_route.road_class_mix | JSON obj, nullable | — | keys: a,b,dirt,freeway,hidden,loose,paved,shortcut,trail | per-type fraction breakdown |
| ref_route_point.route_id+i | text+int (composite PK) | ref_route.route_id | i even only | one polyline vertex — 2× decimated |
| ref_route_point.x/z | float ×2 | — | x −8053..11023, z −9492..20163 | world coords |
| ref_route_point.y | float | — | mostly ±100,000; route 132 corrupted to ±3.4e38 | elevation |
| ref_route_surface.route_id+i | text+int (composite PK) | ref_route_point.(route_id,i) 1:1 | — | surface classification per point |
| ref_route_surface.road_class | enum, nullable | — | paved(207222), loose(34759), NULL(42227) | coarse surface |
| ref_route_surface.road_type | enum, nullable | — | a,b,dirt,trail,freeway,hidden,shortcut, NULL | finer road-network category |
| ref_route_surface.road_profile | enum, nullable | — | 27 values e.g. urban_a_..., ld_rural_road_a | nav-mesh material/width tag (inferred) |
| ref_route_surface.offroad | bool, nullable | — | matches road_class=NULL | offroad flag |
| ref_route_surface.code | int | — | 0–32767 | raw terrain/segment code, meaning varies by `src` |
| ref_route_surface.nav_m | float, nullable | — | 0.0–25.0 | distance to matched nav-mesh segment |
| ref_route_surface.src | enum | — | nav(237688), owt_code(4293), none(42227) | classification provenance |
| ref_route_turn.route_id+turn_id | text+text (composite PK) | ref_route.route_id | 'T'+digit | canonical game-route turn |
| ref_route_turn.seq/arc_m/apex_arc_m | int/float/float | — | — | arc-order position |
| ref_route_turn.apex_x/y/z | float ×3 | — | — | apex incl. elevation |
| ref_route_turn.radius_m/peak_radius_m | float ×2 | — | 3.2–261.3 / 3.2–243.8 | sweep vs peak-curvature radius |
| ref_route_turn.angle_deg | float | — | 11.0–732.8 | total turn angle |
| ref_route_turn.dir | enum | — | L(1918)/R(1894) | direction |
| ref_route_turn.kind | enum | — | fast(1110), hairpin(286), medium(1539), sweeper(118), tight(759) | severity — matches own comment |
| ref_route_turn.length_m/width_m | float ×2 | — | 8–840 / 0–42 | turn length / road width at apex |
| ref_route_turn.bank_deg | float | NULL on Route30106 (43) | −11.16–31.13 (2026-09-20) | SIGNED camber at the apex: + banked into the turn, − off-camber. Was acos(n_y) = total tilt (grade+camber, unsigned, max 139.69°) until 2026-09-20 — see `fh6_turns.py` BANKING |
| ref_route_turn.road_class/road_type/road_profile/offroad/surface_src | mixed | — | — | surface at apex |
| ref_route_turn.surface_m | float, nullable | — | 0.0–24.9 | mislabeled comment — actually nav-distance, not tilt |

---

### `db-sessions-laps` — Telemetry Session/Lap/Corner/Diagnostic Tables

**Key structure:** `session` PK=`session_id` (text, `fh6_YYYYMMDD_HHMMSS`). `session_car` composite PK (`session_id`,`cid`) — `cid` synthetic "ordinal|drivetrain|cyl|PI". `lap` PK=`lap_id` (autoincrement) + UNIQUE(`route_key`,`session_id`,`cid`,`t0`). `lap_point` composite PK (`lap_id`,`i`) WITHOUT ROWID. `corner_obs` composite PK (`lap_id`,`turn_id`) WITHOUT ROWID. `diag_event` PK=`event_id` (autoincrement). `build_id` is a finer-grained physics-build fingerprint, distinct from `cid` and looser than `hw_hash`/`container`/`tune_hash`.

**Scale:** session 125, session_car 398, lap 334, lap_point 124,422, corner_obs 2,666, diag_event 8,931. `fh6.db` 115,101,696 bytes total (all tables); a live `-shm`/`-wal` pair confirms an open writer.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| session.session_id | text PK | — | `fh6_YYYYMMDD_HHMMSS` | capture identifier |
| session.started_utc | text | — | — | capture start |
| session.duration_s | float | — | 447.6–2860 (sample) | wall-clock span incl. dead time |
| session.frames | int | — | — | total telemetry packets |
| session.rate_pps | float | — | ~64–130 | effective capture rate = frames/duration |
| session.source | text | captures/*.csv(.gz) | — | raw capture path |
| session.file_path | text | data/sessions/*.json | — | intermediate session JSON |
| session.imported_at | text | — | — | import time |
| session.summary | JSON, fixed 14-key shape | — | — | denormalized aggregate counters, re-derivable from children |
| session_car.session_id+cid | text+text (composite PK) | session.session_id | 'ordinal\|drive\|cyl\|pi' | one car-config within a session |
| session_car.ordinal | int | ref_car.ordinal | 0 unmatched | decoded from cid |
| session_car.build_id | text | — | — | physics-build fingerprint; one cid can carry dozens |
| session_car.hw_hash | text, nullable | hw_package.hw_hash | 320/398 null | bound only once corroborated against a save |
| session_car.name | text | ref_car.full_name (fuzzy) | — | captured display name |
| session_car.class/pi/drivetrain/cyl | mixed | — | S1,B,A,S2,X,D,C / 100–999 / FWD,RWD,AWD / 0–12 | build attributes at capture |
| session_car.live_s | float | — | — | seconds actively driven |
| lap.lap_id | int PK | — | — | autoincrement |
| lap.route_key | text | course.route_key | 0 unmatched | clustered course |
| lap.session_id | text | session.session_id | — | owning session |
| lap.cid | text | session_car.cid | — | car driven |
| lap.container/hw_hash/tune_hash | text ×3, nullable | tune_container/hw_package | 61/334 co-null | resolved identity, all-or-nothing per lap |
| lap.t0 | float | — | −334.0–29649.4 | start time; can be negative (back-referenced) |
| lap.lap_s | float, nullable | — | 3.06–963.7, 29 null | lap duration |
| lap.arc_m | float | — | 152–37,686 | arc-length covered |
| lap.coverage | float, nullable | — | 0.029–1.56 | arc_m/course length; <0.9 = fragment |
| lap.is_partial | bool | — | default 0 | derived fragment flag |
| lap.build_id | text, nullable | session_car.build_id (soft) | 35/332 unmatched | physics-build fingerprint |
| lap.class/pi/drivetrain | mixed | — | A,B,C,S1,S2 (no D/X) | PI class at lap time |
| lap.solo | bool | — | 1(271)/0(63) | inferred no-traffic run |
| lap.impacts | int | — | 0–881 | grip=4 frame count |
| lap.void | bool | — | 0/1 | invalidated (crash-voided avg 2× impacts) |
| lap_point.lap_id+i | int+int (composite PK) | lap.lap_id | — | sample index within lap |
| lap_point.arc_m | float | — | — | cumulative distance, monotonic |
| lap_point.mph | float | — | 0.0–275.3 | instantaneous speed |
| lap_point.grip | enum | — | 0 calm(63%),1 front(12%),2 rear(6%),3 both(14%),4 impact(5%) | traction state |
| lap_point.x/z | float ×2 | — | x −8050..6380, z −9499..8078 | world position |
| lap_point.elev_m | float, nullable | — | 93.7–832.6 | ~33% null |
| corner_obs.lap_id+turn_id | int+text (composite PK) | lap.lap_id; course_turn(route_key,turn_id) | — | one lap's pass through one turn |
| corner_obs.route_key | text | course.route_key | — | denormalized copy |
| corner_obs.entry/apex/exit/min_mph | float ×4 | — | — | speed at each phase |
| corner_obs.grip_state | enum | — | 0(419),1(556),2(109),3(1361),4(221) | dominant grip condition |
| corner_obs.time_s | float, nullable | — | — | traversal time |
| corner_obs.score | float | — | — | **DEAD** — always NULL |
| diag_event.event_id | int PK | — | — | autoincrement |
| diag_event.symptom | enum | ref_symptom.symptom | 10 of 11 defined | diagnosed handling issue |
| diag_event.session_id/cid | text ×2 | session/session_car (soft) | — | owning session & car |
| diag_event.lap_id | int, nullable | lap.lap_id CASCADE | 2671/8931 null | lap the event occurred in |
| diag_event.container/hw_hash | text, nullable | tune_container/hw_package | 3886 co-null | resolved build identity |
| diag_event.route_key | text, nullable | course.route_key | 6282/8931 null | matched course |
| diag_event.turn_id | text, nullable | course_turn | 7072/8931 null | specific corner |
| diag_event.phase | enum | — | any(46%), straight(29%), mid, exit, entry, braking | detected driving phase |
| diag_event.t | float, nullable | — | null on exactly 1477 rows = source='grip' | timestamp within timeline |
| diag_event.mph | float | — | — | speed at event |
| diag_event.severity | float | — | 0.0–1.0, avg 0.545 | comparable only within one symptom |
| diag_event.detail | text | — | — | free-text measurement, shape depends on source |
| diag_event.source | enum | — | bottoming(2116), braking(755), crest(1990), grip(1477), pulse(2593) | detector algorithm |

---

### `db-obs-plan-meta` — Observation, Clone-Plan & Pipeline Metadata Tables

**Key structure:** `obs_evidence`/`obs_menu`/`obs_pi` each PK=autoincrement `obs_id` (rowid, no natural key). `plan_clone` PK=`plan_id` (autoincrement, 0 rows). `plan_clone_step` composite PK (`plan_id`,`step_no`) WITHOUT ROWID (0 rows, child of empty parent). `plan_readiness` PK=`container` (TEXT, FK to `tune_container.container`, 1:1, fully populated). `import_run` PK=`run_id` (autoincrement, append-only log). `schema_meta` PK=`key` (2-row kv table).

**Scale:** `fh6.db` 115,101,696 bytes total. Rows: obs_evidence 129, obs_menu 92, obs_pi 73, plan_clone 0, plan_clone_step 0, plan_readiness 580, import_run 95, schema_meta 2.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| obs_evidence.obs_id | int PK | — | — | autoincrement, sole key |
| obs_evidence.subject | text, 94 distinct | rim:\<id\> loosely → ref_part/obs_menu | 'named/\<slot\>'(67), 'rim:\<id\>'(41), singletons | what the observation is about |
| obs_evidence.claim | text, free prose | — | 15/129 embedded JSON | the evidence statement itself |
| obs_evidence.confidence | text enum | — | read(93)/verified(36) | only 2 of a richer possible vocabulary used |
| obs_evidence.source | text, 41 distinct | — | mostly part-names.json:\<section\> | provenance string |
| obs_evidence.observed_utc | text, date-only | — | '2026-09-01' style | recorded date |
| obs_evidence.superseded_by | int, self-FK | obs_evidence.obs_id | — | **DEAD** — always NULL, retraction chain unused |
| obs_menu.obs_id | int PK | — | — | autoincrement |
| obs_menu.ordinal | int, nullable | ref_car.ordinal | only value 412 or NULL | 71/92 NULL (rim_style rows from debug clip) |
| obs_menu.slot | text enum | ref_slot.slot (by name) | drivetrain(4), rim_style(71), tire_compound(11), transmission(6) | menu category captured |
| obs_menu.tile/tile_count | int | — | tile_count constant per slot | 1-based menu position |
| obs_menu.name | text | — | — | exact in-game display string |
| obs_menu.part_id | int, nullable FK | ref_part.part_id | only populated for transmission | 86/92 NULL |
| obs_menu.source | text enum, 4 values | — | — | capture file/session |
| obs_menu.observed_utc | text, nullable | — | '2026-09-02' or NULL | capture date |
| obs_pi.obs_id | int PK | — | — | autoincrement |
| obs_pi.ordinal | int, nullable | ref_car.ordinal | 37 distinct | which car instance |
| obs_pi.container | text, nullable FK | tune_container.container | — | **DEAD** — never populated |
| obs_pi.hw_hash | text, nullable | — | — | **DEAD** — never populated |
| obs_pi.slot | text, nullable | — | only 2 rows: centrifugal_supercharger, rim_style | single-part-isolation slot |
| obs_pi.part_id/pi_before/pi_after/delta | int, nullable ×4 | ref_part.part_id | — | **DEAD** — always NULL (real data lives in `note` JSON) |
| obs_pi.source | text enum | — | pi-observations.json(71), parts-pi.json(2) | upstream file |
| obs_pi.observed_utc | text | — | epoch-decimal string for 71 rows | inconsistent format vs other `_utc` cols |
| obs_pi.note | JSON, TRUNCATED for 71/73 rows | — | — | truncated to 900 chars — parts_hash + 5 keys silently lost |
| plan_clone.plan_id | int PK | — | — | **0 rows** — feature never run |
| plan_clone.target_container | text FK, NOT NULL | tune_container.container CASCADE | — | clone target |
| plan_clone.source_container | text, nullable | — | NULL = from stock | clone source |
| plan_clone.generated_utc/n_steps/n_customize/n_unknown/verdict | mixed | — | verdict: CLONE EXACT / MATCH (rims differ) / DIFFER (per comment) | plan metadata — unconfirmed, 0 rows |
| plan_clone_step.(plan_id,step_no) | int+int (composite PK) | plan_clone.plan_id CASCADE | — | **0 rows** |
| plan_clone_step.phase/slot/menu_path/part_id/name/tile/tile_count/confidence/note | mixed | ref_part (inferred) | phase: shop/customize/conversion | step detail — unconfirmed, 0 rows |
| plan_readiness.container | text PK/FK | tune_container.container CASCADE | — | 1:1 with tune_container (580 rows) |
| plan_readiness.ready | bool | — | all rows = 1 | fully resolvable build |
| plan_readiness.n_unknown | int | — | constant 0 | unresolved slot count |
| plan_readiness.n_derived | int | — | constant 6 | inference-resolved slot count |
| plan_readiness.blockers | JSON array | — | always '[]' | reasons not ready (never exercised) |
| plan_readiness.computed_utc | text | — | single shared value | one batch pass |
| import_run.run_id | int PK | — | — | autoincrement, append-only |
| import_run.kind | text enum, NOT NULL | — | containers(18), corners(7), curves(3), diagnosis(8), gamedb(9), observations(10), parts_extra(9), road_class(7), routes(7), surface(8), telemetry(9) | pipeline that produced this run — inline comment is stale |
| import_run.source | text, nullable | — | — | path/description read |
| import_run.started_utc/finished_utc | text ISO ×2 | — | 0/95 finished NULL despite nullable | run window |
| import_run.n_rows | int | — | 0–288,246 | rows written/affected |
| import_run.ok | bool | — | 1(83)/0(12) | success flag |
| import_run.notes | JSON or error text | — | — | per-kind result summary OR raw exception string |
| schema_meta.key | text PK | — | created_utc, schema_version | 2-row config table |
| schema_meta.value | text NOT NULL | — | schema_version='1' | value for key |

---

### `db-schema-sql` — schema.sql Design Document

**Key structure:** Not a row store — a DDL file organized under a documented 7-tier prefix taxonomy (`ref_`/`tune_`/`hw_`/`session_,course_,lap_`/`obs_`/`plan_`/`v_`). 30 of 53 tables use a single-column PK; 18 use a composite PK via WITHOUT ROWID over 2–3 columns; a few use a PK that is itself an FK to a 1:1 parent.

**Scale:** File 1,095 lines / 57,243 bytes, defining 53 tables + 8 views + 21 indexes + 2 PRAGMAs. As executed: `data/fh6.db` 115,101,696 bytes with exactly 61 live objects matching the DDL 1:1. Row counts span 0 (ref_event, plan_clone, plan_clone_step) to 284,208 (ref_route_point/surface, tied).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| prefix_taxonomy | design convention | — | ref_(29), tune_(4), hw_(2), session_/course_/lap_(8), obs_(3), plan_(3), v_(8) | documented layer system; 5 tables (schema_meta, import_run, corner_obs, diag_event, setup) fall outside it |
| global_conventions | design convention | — | confidence: proven\|verified\|derived\|read\|unknown | UTC times; 0xFFFFFFFF part id → SQL NULL; JSON = "not yet promoted" marker |
| pragmas | design convention | — | journal_mode=WAL, foreign_keys=ON | both confirmed live (wal/shm sidecars exist; FKs enforced) |
| without_rowid_pattern | design convention | — | 18 of 53 tables | applied wherever PK is already a covering composite key |
| layer_ordering_as_lineage | design convention | — | ref_→tune_/hw_→session_/course_/lap_→obs_→plan_→v_ | explicit anti-duplication rationale for the layer stack |
| schema_meta | table, TEXT PK | — | key/value | config kv (schema_version, game_build, gamedb_md5, created_utc) |
| import_run | table, INT PK | — | kind: gamedb\|strings\|containers\|sessions\|courses\|derive (doc) | provenance log |
| ref_string_table | table, TEXT PK | — | 287 rows | .str table catalog |
| ref_string | table, composite PK (table_name,key_hash) WITHOUT ROWID | ref_string_table.table_name | — | localization layer |
| ref_class | table, INT PK | — | 0=D..7=X | PI class boundaries |
| ref_car | table, ~38 cols+JSON, INT PK, 2 idx | ref_class.class_id; ref_wheel.wheel_id | drivetype: FWD\|RWD\|AWD | car master table, 660 rows |
| ref_engine / ref_drivetrain / ref_car_body / ref_motor | tables, INT PK+data | ref_car.stock_* (implicit); ref_torque_curve | — | engine/drivetrain/body/motor catalogs |
| ref_slot | table (10 cols), INT PK | — | category: Car\|Engine\|Drivetrain\|CarBody\|Motor\|Wheels\|'' | fixed 50-slot catalog |
| ref_part | table (14 cols+data) WITHOUT ROWID, composite PK (slot,part_id) | ref_slot.slot | confidence: proven\|derived\|unknown | 87,655-row upgrade-part catalog |
| ref_part_slider | table (7 cols) WITHOUT ROWID, composite PK | ref_part.(slot,part_id); ref_slider.slider | — | per-part slider band |
| ref_slider | table (10 cols), TEXT PK | — | band_source live: part\|fixed\|none (comment says 'gear' — stale) | fixed 36-slider catalog |
| ref_wheel_category / ref_wheel | tables, INT PK | ref_wheel_category.category_id; ref_car.stock_wheel_id | — | rim category & catalog |
| ref_compound | table (9 cols+data), INT PK | ref_friction_curve.compound_id | — | 41 tire compounds |
| ref_part_attribute | table (9 cols), INT PK | declared ref_part FK, never populated | join_status always 'orphan' | proven unjoinable legacy table |
| ref_preset / ref_preset_part | tables, INT PK / composite PK | ref_car.ordinal; ref_slot.slot | kind: 19 live values | 448 game-authored builds |
| ref_car_exception | table (10 cols), INT PK==FK | ref_car.ordinal (1:1) | — | LIVERY exceptions only, not upgrade gates |
| ref_track / ref_event / ref_region | tables | ref_event.track_id; ref_event.region (undeclared) | kind (event, per comment, unconfirmed) | ref_event DEFINED BUT EMPTY |
| ref_route / ref_route_point / ref_route_turn / ref_route_surface | tables, TEXT/composite PK | ref_route.route_id | road_class: paved\|mixed\|loose\|NULL | game route/centre-line/turn/surface catalog |
| ref_torque_curve | table (15 cols), INT PK | ref_engine/ref_motor/ref_part(camshaft) | — | 1,725-row dyno table |
| ref_friction_curve | table (14 cols), INT PK | ref_compound.compound_id | channel: lat\|accel\|brake; surface: asphalt\|offroad\|snow | 738-row tyre-grip dyno |
| tune_container | table (~30 cols), TEXT PK | ref_car.ordinal | source: downloaded\|self | one row per save container |
| tune_part / tune_slider / tune_gear | tables WITHOUT ROWID, composite PK | tune_container CASCADE | grip enum on tune_part n/a | per-slot/slider/gear detail |
| hw_package / hw_package_part / setup | tables | ref_car.ordinal; hw_package.hw_hash | intent: course\|general\|drift\|drag (documented, 0 rows populated) | hardware & setup rollups |
| session / session_car | tables | — | — | telemetry session & per-car records |
| course / course_turn | tables, TEXT PK / composite PK | ref_event.event_id; course_route | kind: hairpin\|sweeper\|kink\|chicane (per comment) | learned course model |
| lap / lap_point / corner_obs | tables, INT PK / composite PK | course CASCADE; lap CASCADE | grip: 0 calm..4 impact | per-lap trace & per-corner analyzer output |
| course_route | table, TEXT PK | course.route_key; ref_route.route_id | match_kind: verified\|probable\|partial\|none | bridge between learned & authored routes |
| obs_pi / obs_menu / obs_evidence | tables, INT PK | — | confidence (obs_evidence): verified\|read | human-recorded observation layer |
| plan_clone / plan_clone_step / plan_readiness | tables | tune_container CASCADE | verdict (per comment, unconfirmed live) | clone-planning feature — schema-complete, empty |
| diag_event | table (14 cols), INT PK, 2 idx | ref_symptom.symptom; lap.lap_id CASCADE | source live: grip\|bottoming\|braking\|crest\|pulse | the tuning-failure fact table |
| v_build_sheet / v_tune_sheet / v_rim_equivalent | views | tune_container/tune_part/tune_slider/ref_wheel | — | flattened per-part / per-slider / rim-swap views |
| v_course_best / v_diag_by_turn / v_diag_by_setup | views | lap/course; diag_event/ref_symptom | — | leaderboard & failure-rollup views |
| v_torque_point / v_friction_point | views over json_each(samples) | ref_torque_curve; ref_friction_curve | — | unpacked per-rpm / per-slip dyno rows |

---

### `laps-db-v1` (lap_traces table, data/laps.db) — Legacy v1 Lap Trace Store

**Key structure:** Composite natural key `UNIQUE(route_key, session, cid, t0)` — target of the upsert. Separate technical PK `id` (SQLite rowid) has 10 gaps across ids 1–401 for 335 live rows, evidence of past deletion/repair despite the module's "append-only" self-description.

**Scale:** `data/laps.db` 4,132,864 bytes (~3.94 MiB), single table `lap_traces` (+2 indexes). 335 rows, 124,641 trace points across `pts` blobs (avg ~372/lap). Three `.bak-*` siblings exist (15-column pre-`tune_hash` schema): `.bak-172823` (41 rows), `.bak-20260828-162302` (39 rows), `.bak-tunehash` (150 rows).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| id | int PK | — | 1–401 (335 present, gapped) | SQLite rowid, unstable across delete+reinsert |
| route_key | text NOT NULL | data/courses/\<route_key\>.json | 49 distinct | grid-snapped course id; 1 orphan key has no course file |
| session | text NOT NULL | data/sessions/\<session\>.json | 59 distinct | capture session, exact filename match |
| cid | text, composite | 1st segment→car catalog | 36 distinct | 'CarOrdinal\|DrivetrainType\|NumCylinders\|CarPI' |
| t0 | float NOT NULL | — | 0.0–29,649.4 | seconds into session recording the lap began |
| lap_s | float, nullable | — | 3.062–963.729 | lap time, computed-at-read (30/335 null) |
| arc_m | float, nullable | — | 152.0–37,686.0 | full-resolution odometer distance |
| build_id | text, nullable | data/builds/\<cid\>.json | — | md5-fingerprint of measured physical spec (2/335 null) |
| class | enum, nullable | — | A(142),S1(158),B(25),C(5),S2(3) | PI class letter |
| pi | int NOT NULL | — | 487–899, 8 distinct | Performance Index |
| drivetrain | enum, nullable | — | AWD(244),RWD(87),FWD(2) | decoded drivetrain |
| solo | bool, default 0 | — | 1(273)/0(62) | Rivals/time-trial run flag |
| pts | JSON array of tuples, NOT NULL | — | — | resampled trace, ≤300pts/lap (impact points protected) |
| pts[].arc_m (idx 0) | float | — | — | cumulative lap-local distance |
| pts[].mph (idx 1) | float | — | — | instantaneous speed |
| pts[].grip (idx 2) | enum(int) | — | 0 calm(78813), 1 front(14476), 2 rear(7283), 3 both(17159), 4 impact(6910) | grip state; 4 is display-only hard-cornering, NOT what sets `void` |
| pts[].x/z (idx 3/4) | int ×2 | — | — | rounded world position |
| pts[].elev_m (idx 5, optional) | float | — | 93.7–832.6 | absent on 41,044/124,641 older points |
| impacts | int, default 0 | — | 0–881 | grip-4 count in FULL trace (pre-thin) |
| void | bool, default 0 | — | 1(91)/0(244) | genuine-contact time invalidation |
| tune_hash | text, nullable | Xbox save 'Data' files | — | newest column; absent entirely in all .bak-* snapshots; 58/335 null |

---

## Project data/*.json stores

### `sessions-raw` — Raw Per-Session Capture JSON (`data/sessions/*.json`)

**Key structure:** Filename = key (`fh6_<YYYYMMDD>_<HHMMSS>.json`), mirrored by top-level `id`. Nested collections carry local keys: `cars[]` by composite text `id` = 'ordinal|drivetrain(0/1/2)|cyl|PI' (a per-BUILD identity, reused as FK throughout); `stints[]` by int `n` (1-based sequential); `courses[]` by `route_key` (shared with data/routes.json and data/courses/*.json).

**Scale:** 129 files, 77.6 MB total, 28KB–7.23MB/file, avg ~616KB. 409 total car-config records (avg 3.2/session). Top-level key set (21 keys) identical across all 129 files.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| id | text | filename | `fh6_YYYYMMDD_HHMMSS` | session identifier |
| source | text | captures/fh6_\<ts\>.csv.gz | — | upstream raw capture path |
| frames / duration_s / rate_pps / live_frames | int/float/float/int | — | — | packet count, wall-clock span, measured rate, live-only frames |
| cars[].id | text composite | self-referential FK throughout | 'ordinal\|drive\|cyl\|pi' | per-build (not per-car-instance) identity |
| cars[].ordinal/pi/class/drivetrain/cyl | mixed | ref_car.ordinal; build-letters.json | D..X / FWD,RWD,AWD | decoded from id |
| cars[].max_rpm/idle_rpm/car_group/name | mixed | ref_car (name, by ordinal) | — | engine & display metadata |
| cars[].live_frames/live_s | int/float | — | — | frames & seconds this config was driven |
| cars[].shift_rpm/grip_g | float, nullable | — | — | median auto-shift rpm; 90th-pct peak lat-g |
| cars[].build_id | text 8-hex | data/build-letters.json.letters[ordinal] | — | measured-build content hash |
| cars[].build_record | object, always null | data/builds/*.json (never resolves) | — | designed-but-dormant join |
| cars[].tire_radius_m | float, nullable | — | ~0.22–0.55 normal, rare garbage outliers | v2-schema-only exact rolling radius |
| cars[].mass_measured | object | — | {lb,kg,n} or {n} only | v2-schema-only roll-on mass probe |
| cars[].temps_max_f/temps_med_f | obj{FL,FR,RL,RR} ×2 | — | — | tire temps |
| cars[].k_wheel | obj{FL,FR,RL,RR}, nullable | — | — | wheel-speed/vehicle-speed ratio |
| cars[].gears[] | array<obj> | — | — | {gear, mps_per_krpm, rel, n, fd_gear?} |
| cars[].dyno[] | array<obj> | — | — | {rpm(250-bin), hp, tq, n} |
| cars[].evidence | object | — | — | sample counts/IQR backing each clone-sheet figure |
| cars[].sig | object | — | — | compact build signature (boost, hp_peak, ladder, mass_idx) |
| cars[].coverage | obj{overall, probes[]} | — | — | data-sufficiency gauge, 12 probes |
| cars[].advice[] | array<obj> | — | 18 keys, e.g. bottoming, rear-limited | course-agnostic tuning advisories |
| cars[].general | object, v2-only | — | — | breadth/all-around lane, often empty |
| cars[].decode | obj{ready_n,total=10,pct,missing,tests} | — | — | physics-decode progress |
| cars[].clone_sheet | object | — | — | tunable-item worksheet, 6 fixed menus |
| cars[].clone_sheet.menus[].items[] | array<obj> | — | status: measured\|inferred\|shop | 18 item names, e.g. Compound, Differential |
| segments[] | array{id,t0,t1} | cars[].id | — | coarse config-active time windows |
| impacts[] | array<float>, capped 200 | — | — | collision timestamps — summary.impacts is true total |
| zero_windows[] | array<[t0,t1]> | — | — | IsRaceOn=0 dead-time windows |
| strip[] | array<obj>, per-second | cars[].id | state: off,calm,front,rear,both,impact | session timeline |
| corners[] | array<obj> | cars[].id | dir: L/R | every detected cornering event, chronological |
| corners[].phases[] | array<obj> len=4 | — | red: none,front,rear,both | 4-phase slip breakdown |
| corners[].first_red / usi | obj / float | — | axle: front/rear | primary understeer/oversteer diagnostic |
| corners[].drift/kink/hb/ev/surface/rough_frac | mixed | — | surface: smooth/rough (v2-only) | corner classification flags |
| launches[] | array<obj> | — | — | standing-start events; zero60_s, peak_slip_front/rear, trace[] |
| braking[] | array<obj> | — | lock: front,rear,none | hard-braking zones, deficits |
| bottoming[] | array<obj>, capped 200 | — | wheel: FL,FR,RL,RR | suspension-full-compression events — summary.bottoming is true total |
| pulses[] | array<obj> | — | — | steering-wiggle yaw-damping probe |
| stints[] | array<obj> | cars[].id | — | contiguous drive segments, n=sequential |
| stints[].label/role | text/enum, nullable | data/sessions/\<id\>.tags.json | role: replica,donor,null | manual annotation from tags file |
| events[] | array<obj> | data/courses/{route_key}.json | mode: race, timed solo, reference loop | timed/reference events |
| crests[] | array<obj>, capped 100 | — | — | going-light-over-crest moments, no true-count field |
| courses[] | array<obj> | data/courses/{route_key}.json | — | richest nested object, session-scoped mirror |
| courses[].composition | obj{7 int keys} | — | — | corner/event archetype counts |
| courses[].corners[] | array<obj> | — | status: turn,possible; limiter: driver,mixed,tune,clean | deduped named turns 'C1'.. |
| courses[].decode/profile | object | — | band: light,moderate,heavy,absent | route-scoped decode battery & shape profile |
| courses[].laps | obj{total,windows,per_event} | — | — | lap accounting |
| courses[].turns | object | — | — | turn-detection registry/confidence |
| courses[].turns.canonical[] | array<obj> | — | — | persistent cross-session turn registry |
| courses[].model | obj{turns,laps,sessions,file} | data/courses/{route_key}.json | — | pointer to persistent per-route model |
| courses[].track | object | — | — | cross-session leaderboard rollup |
| courses[].geometry | object | — | — | length_m, paths, layout_paths (all-session) |
| courses[].coverage | obj{overall,probes[]} | — | — | route+session probe scoring |
| courses[].advice_by_car | obj{car_id: array} | cars[].id | — | per-car advisories with course_weight |
| courses[].speed_traces | obj{car_id: obj}, 124/129 files | data/courses/{route_key}.json | — | up to 10 fastest tunes' speed-vs-distance traces |
| summary | object | — | — | session-wide TRUE counts, authoritative when arrays truncated |

---

### `sessions-tags` — Session Stint Tag Files (`data/sessions/*.tags.json`)

**Key structure:** Filename = key, `data/sessions/fh6_<ts>.tags.json`; stub repeated as top-level `session`. Single-blob-per-session store, optional 1:1 companion to the raw session file. Within a file, both `stints` and `stint_starts` are keyed by stint-number string ("1".."N"); natural composite key if normalized would be `(session_id, stint_n)`.

**Scale:** 108 files, 57,558 bytes total, avg 533B/file. 21 of 129 raw sessions have no matching tags file (zero orphans the other way). 100/108 files have empty `stints={}`; only 8 files carry a role tag.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| session | text | session.session_id (db); data/sessions/\<session\>.json | `fh6_YYYYMMDD_HHMMSS` | equals filename stub, verified identical in all 108 |
| stints | JSON obj, sparse | — | 0–3 populated entries/file | manually-tagged stints only, strict subset of stint_starts keys |
| stints.\<n\>.role | enum | — | donor(7)/replica(1) | A/B clone-testing role; daemon enforces at-most-one-per-session-per-value |
| stints.\<n\>.label | text, free-form | — | 1 instance: "DONOR" | unconstrained (80-char cap), predates `role` |
| stints.\<n\>.t0 | float, monotonic sec | — | — | time.monotonic() at tag time, stamped once (setdefault) |
| stint_starts | JSON obj (map n→float) | scripts/telemetry/analyze_session.py; NOT imported into fh6.db | 0–65+ entries/file, ~0.005–15,262s | authoritative, dense run-boundary index; mode-aware split rules |

---

### `courses-json` — Per-Route Course Model Files (`data/courses/*.json`)

**Key structure:** File key = `route_key + ".json"` (basename equals route_key, except "loop:"→"loop_" and spaces→"_"). `route_key` value form (a) `"{x}_{z}"` (rounded 50m start cell, optional `_NN` collision-disambiguation suffix — arbitrary counter, not meaningful) or (b) `"loop:{name}"` for custom loops. `route_key` is also the declared PK of the `course` table in `db/schema.sql`, already populated (62 rows) via `rebuild.py`.

**Scale:** 64 files, 12,151,016 bytes total (~11.6MB), 1,637B–1,705,474B/file, avg ~190KB. `course` table in fh6.db holds 62 rows (~97% mirrored).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| route_key | text | db course.route_key (PK); course_turn/lap.route_key | grid form or 'loop:' form | primary key, duplicated inside file |
| name | text, nullable | — | free text, null in 60/64 | human/game-assigned course name |
| laps | int | — | 1–67+ | total accumulated laps across sessions |
| sessions | array\<text\> | data/sessions/\<id\>.json/.tags.json; db session.session_id | `fh6_YYYYMMDD_HHMMSS` | contributing sessions |
| updated | text | data/sessions/\<id\>.json | — | session_id of most recent write |
| turn_count | int | — | 0–24+ | established-turn count |
| turn_count_delta | int, nullable | — | small signed int or null | drift vs prior baseline |
| merged_from | array\<text\>, optional | retired route_keys | 1–11 entries | fragment-course merge provenance |
| profile_laps / profile_session | int / text | data/sessions/\<id\>.json | — | coverage gate for `profile` snapshot |
| turns[] | array\<obj\> | best_by_car/track.cars → car_key | dir L/R; type fast,hairpin,medium,null; status turn,possible | canonical per-turn model, ordered by arc |
| turns[].best / best_by_car[cid] | obj | session→data/sessions | first_red: {front,rear}×{ph1-4} or null | best-pass snapshot per turn (overall / per car) |
| turns[].by_session[sid] | obj | cars[]→car_key | lim: clean,driver,tune,mixed | per-session turn stats |
| turns[].track | obj | cars[]→car_key | dominant: front,rear,none,null | aggregate across all sessions |
| turns[].traced | obj, optional | — | verdict: small closed set of templates | braking/lift-point forensic analysis |
| best_laps | obj\<car_key,obj\> | build_id→build-letters.json; loosely db lap.build_id | class D..X | per-car PB, often empty {} |
| visits[] | array\<obj\> | session; cars[]→car_key | — | per-session visit record |
| speed_traces | obj\<car_key,obj\> | build_id; session | grip_code 0-4 | best-lap telemetry trace per car config, ≤300pts, ≤10 kept |
| turn_count | int | — | — | established (status='turn') count |
| profile | obj | — | band: absent,light,moderate,heavy | course-demand usage histogram (dims, gears_used, top_speed, notes) |
| profile.dims.\{7 keys\} | obj ×7 | — | — | low/mid/fast_corner, braking, straight, elevation, launch |
| geometry | obj, absent in 4/64 files | session→data/sessions | det: geo4-arcreg, geo5-latg-split, geo7-tol-from-map | reference map (path, paths, turns, lap_paths) |
| geometry.lat_acc | obj\<bucket,[sum,n]\> | — | 8m arc buckets | running lateral-G accumulator, never resets |
| geometry.turns[] (id 'G') | array\<obj\> | — | dir L/R | geometry-detected turns, distinct id space from top-level turns[] |
| geometry.turns[].lines | obj, subset only | cid→car_key; session; build_id | — | racing-line/braking-line analysis |
| geo_turns | obj\<pos_key,obj\> | sessions[] | dir L/R | purely geometry-detected turns, model_map=true survives rewrite |
| car_key (dict-key scheme) | composite text | ordinal→ref_car.ordinal | 'ordinal\|drive_int\|cyl\|pi' | build variant identity, same ordinal can recur at multiple keys |
| world coords [x,z] | float pair | — | x ≈[-8000,6500], z ≈[-9500,8600] | PosX/PosZ everywhere in this store; same space as route_key grid |

---

### `course-backups` — Historical Course Snapshot Directories

**Key structure:** Two-level composite. Outer = backup directory name (timestamp-stamped snapshot id — either `_backup_courses_YYYYMMDD_HHMMSS`, or one of three one-off manually-named dirs). Inner = `route_key` (filename stem within that directory), identical scheme to `courses-json`. One record = `(snapshot_dir, route_key)`.

**Scale:** 466 files, 13 top-level directories, 89,071,135 bytes (~84.94MB). 88 distinct route_key stems appear somewhere (vs 64 live) — 24 retired/merged only survive here. One dir additionally holds a `laps.db` snapshot (46 rows, 397KB — live `data/laps.db` has since grown to 336 rows/4.1MB).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| \<backup_dir_name\>/ | directory | — | `_backup_courses_*`(10), 3 one-off named dirs | one point-in-time snapshot of data/courses/ |
| route_key (filename stem) | text | data/courses/\<route_key\>.json; data/routes.json | `{X}_{Z}` (+optional `_NN`) | filename key, matches live naming |
| route_key (field) | text | — | never null | self-identifying key inside file |
| name | text, nullable | — | usually null early on | operator-assigned course name |
| laps / sessions / updated | int / array\<text\> / text | data/sessions/\<id\>.json | — | totals, contributing sessions, last-write session id |
| turns | array\<obj\> | — | status turn,possible; type hairpin,medium,fast | persistent per-turn model, same shape as courses-json |
| cars | obj (composite key) | CarOrdinal→ref_car | class D..X | every distinct car config driven |
| best_laps | obj (car_key keyed) | — | — | fastest verified lap per car config |
| visits[] | array\<obj\> | — | — | per-session visit record |
| speed_traces | obj (car_key keyed) | — | grip_code 0-4 | best-lap trace cache |
| turn_count / turn_count_delta | int / int\|null | — | — | established turn count & drift vs prior |
| profile | obj | — | band thresholds: heavy≥0.22, moderate≥0.09, light≥0.02 | course-demand histogram |
| profile_laps / profile_session | int / text | — | — | snapshot provenance |
| geometry | obj | — | — | length_m, path, paths, turns (id 'G'), lap_paths |
| geo_turns | obj (position-keyed) | — | model_map bool | canonical geometric-turn inventory |
| merged_from | array\<text\>, rare (2/466) | retired route_keys | — | course-merge provenance marker |
| routes.json (sibling, 1 dir only) | obj | — | — | snapshot of separate route registry — proves this dir is a targeted pre-fix backup |
| laps.db (sibling, 1 dir only) | SQLite file, table lap_traces | route_key; cid; session | — | 46-row snapshot of the live append-only lap archive (now 336 rows) — otherwise uncatalogued elsewhere |

---

### `build-records` — Hand-Transcribed Build Sheets (`data/builds/*.json`)

**Key structure:** Filename-embedded key `<ordinal>-<short-label>.json` (`_template.json` excluded from ingestion by glob). Semantic join key at read time = `(cid[, build_id])` matched against a live session car. Only 1 real file exists — no collision/uniqueness ever tested.

**Scale:** 2 files: `2866-exocet-awd-s1800.json` 1,091B (13 keys, no `parts`/`tune_tabs` populated), `_template.json` 3,820B (14 keys incl. `_purpose`, fully skeleton `parts`). 0 rows in fh6.db — never ingested by `rebuild.py`; read only by `analyze_session.py`.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| schema_version | text semver | — | "1.0.0" | build-record format version |
| car_ordinal | int | ref_car.ordinal; data/car-ordinals.json | — | game car ID |
| car | text | — | — | free-text "YYYY Make Model", redundant with ordinal |
| cid | text, nullable | session_car.cid / analyzer's cid() | 'ordinal\|drivetrain\|cyl\|PI' | match key; NULL in the one real record |
| build_id | text 8-hex, nullable | session_car.build_id/lap.build_id | — | optional disambiguator, null in both files |
| label | text | — | — | short human description |
| tune_share_code | text, nullable | — | — | in-game share code; null in both files |
| captured | text date | — | — | screenshot capture date |
| source | text | — | — | capture method description |
| pane | obj, fixed shape | — | class D..X | 'My Cars' pane readout: pi, power_hp, torque_lbft, weight_lb, front_pct, compound, displacement_l |
| tune_tabs | array\<text\> | has_tab() substring match | — | visible tune-menu tabs; ABSENT from the real record |
| parts | obj, 6 fixed menu categories | — | — | core payload — ABSENT from the real record entirely |
| parts.\<menu\>[].slot | text enum | — | 30 slots across 6 menus | fixed shop terminology |
| parts.\<menu\>[].installed | text or null | fuzzy match to part naming | — | exact upgrade tier name; null = not transcribed |
| parts.\<menu\>[].note | text, template-only | — | — | transcription guidance |
| _purpose | text, template-only | — | — | doc field, absent from real records |
| drivetrain | text enum, real-record-only | — | FWD/RWD/AWD | NOT a template field |
| ratings | obj, real-record-only | — | speed, handling, accel, launch, braking, offroad (0-10) | NOT a template field |
| notes | text, real-record-only | — | — | free-text caveats, NOT a template field |

---

### `identity-1` — Build Letters, Livery Association & Identity Evidence

**Key structure:** Three small JSON docs. `build-letters.json` and `build-liveries.json` share a real composite key `(car_ordinal, build_sig)` where `build_sig` is an 8-hex SHA1 of a tune's parts dict, recomputed on the fly (never stored raw elsewhere). `identity-evidence.json` is keyed by `car_ordinal` alone across two independent sub-tables (`picked`, `gears`).

**Scale:** build-letters.json 5,838B, 47 ordinals, 234 (ordinal,build_sig)→letter entries. build-liveries.json 372B, 3 ordinals, 4 entries. identity-evidence.json 3,165B, `picked` empty, `gears` 31 ordinals.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| build-letters.json:schema_version | text | — | "1.0.0" | doc version |
| build-letters.json:letters | nested obj (2-level map) | — | — | letters[ordinal][build_sig] = letter |
| letters.\<ordinal\> (key) | text (numeric) | data/car-ordinals.json#cars.\<ordinal\> | 47 ordinals, not zero-padded | car identity |
| letters.\<ordinal\>.\<build_sig\> (key) | text 8-hex | data/build-liveries.json#assoc.\<ordinal\>.\<build_sig\> (verified match) | — | SHA1 of sorted non-null `parts` items |
| letters.\<ordinal\>.\<build_sig\> (value) | enum(text) | — | A–Z, then Z26,Z27,... unbounded | permanent, first-seen-wins build label |
| build-liveries.json:schema_version | text | — | "1.0.0" | doc version |
| build-liveries.json:assoc | nested obj | — | — | assoc[ordinal][build_sig] = livery pin |
| assoc.\<ordinal\> (key) | text (numeric) | data/car-ordinals.json | only 3 ordinals present | car identity |
| assoc.\<ordinal\>.\<build_sig\> (key) | text 8-hex | build-letters.json#letters (byte-identical) | — | shared fingerprint |
| assoc.\<ordinal\>.\<build_sig\> (value) | union text\|obj | livery container dir name (ordinal there IS zero-padded — join gotcha) | source(obj form): only "auto" | manual pin (bare string) or auto-inferred {dir,source} |
| identity-evidence.json:schema_version | text | — | "1.0.0" | doc version |
| picked | nested obj, keyed by ordinal | data/car-ordinals.json | currently empty {} | confirmed active save per car |
| picked.\<ordinal\>.ts | text 14-digit | save container Tuning_\<ordinal\>_\<ts\> | — | picked save's timestamp |
| picked.\<ordinal\>.at | float epoch | — | — | when pick was recorded (2h honor window) |
| gears | nested obj, keyed by ordinal | data/car-ordinals.json | 31 of ~660 ordinals | accumulated engaged-gear evidence |
| gears.\<ordinal\>.cid | text\|null | — | 'ordinal\|drive\|cyl\|pi' | build/engine-state signature, scopes the evidence |
| gears.\<ordinal\>.g | array\<int\>, ascending | — | 1-based gear numbers | forward gears physically engaged at speed |

---

### `identity-2` — Car Ordinals, Part-Index Vocabulary & Rim-ID Matches

**Key structure:** Three different shapes. `car-ordinals.json` is a 5-key envelope; the per-record key is `cars.<ordinal>` (verified exact 1:1 match to fh6.db ref_car.ordinal). `part-index-vocabulary.json` has NO repeating key — a single hand-authored findings document, 17 named top-level keys. `rim-id-matches.json`'s top-level key is the numeric rim/wheel-style ID (NOT "container number" — a census correction), matching `ref_wheel.wheel_id`.

**Scale:** car-ordinals.json 120,348B, 660 car records + empty `builds` registry. part-index-vocabulary.json 15,154B, 17 top-level findings. rim-id-matches.json 67,859B, 63 top-level keys (1 `_summary` + 62 rim records) covering 62 of 1,248 wheel_ids.

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| cars (wrapper) | nested obj | — | — | 5-key envelope: schema_version, purpose, cars, builds, table_source |
| cars.\<ordinal\> | int key | fh6.db ref_car.ordinal (verified exact 660-set match) | 660 keys, 247–4342 | one car identity; upstream import source for ref_car names |
| cars.\<ordinal\>.name | text | — | — | e.g. "1969 Toyota 2000 GT"; cosmetic spacing drift vs ref_car |
| cars.\<ordinal\>.confidence | enum | — | community-table \| player-confirmed | provenance strength |
| cars.\<ordinal\>.source | text | — | 4 distinct strings | citation |
| cars.builds | obj, empty | — | — | scaffolded, never written registry |
| tier_slots | nested obj | index integers = decoded save part IDs | brakes,front_arb,rear_arb,springs_dampers (0–3/0–5) | global tier vocabulary: index→{Stock..Drift}; index 0 flagged unreliable |
| catalogue_slots | nested obj | data/engine-swaps.json (for 'engine') | engine, rear_wing, rim_style, front_bumper, car_body, aspiration | car-specific catalogue slots (item differs per car) |
| unresolved.hundreds_grouped_slots | array+prose | — | weight_reduction, roll_cage, front/rear_tire_width | flags a second undecoded index dimension |
| validation | nested obj | — | — | unlock-gating proof (n=531 tunes) + open index-0 anomaly |
| index_is_dense_or_sparse | nested obj | — | sparse: brakes,arb,springs,tire_compound; dense: drivetrain,car_body,engine | core namespacing rule |
| aspiration_is_two_steps | prose | — | — | aspiration slot always empty by design; type recorded via which turbo/SC slot is populated |
| names_read_from_basket_2026_09_01 | nested obj | — | — | one capture session's 19 verbatim basket reads (NSX-R) |
| transmission_index_is_NOT_the_gear_count | nested obj | — | idx 4→7g..idx 8→4g(Drift) | correction: gears=index+3 for Race family, n=532 tunes |
| cams_and_valves_resolved | obj (was/now) | — | — | one shop purchase writes only the camshaft slot |
| sub_label_chips_are_deltas | text caution | — | — | UI chip deltas are relative to basket state, not fixed |
| weight_reduction_is_dense_not_ladder | nested obj | — | — | corrects an earlier wrong reading; dense 0-based, 3-tile |
| scheme_must_be_established_per_slot | text, master index | — | DENSE: drivetrain,car_body,engine,rear_wing,weight_reduction; SPARSE: brakes,arb,springs,differential,clutch,driveline | terminal per-slot classification |
| rim_catalogue_correction | nested obj | rim ids ↔ rim-id-matches.json / ref_wheel.wheel_id | 638=verified, 701=stale-UNKNOWN, 4294967295=empty sentinel | corrects a circular-reasoning error; rim_style has NO partset |
| rim-id-matches.json (whole file) | nested obj, keyed by ID | ref_wheel.wheel_id (all 62 confirmed present, already named) | 63 keys | **superseded** by ref_wheel — 30/62 (48%) disagree outright |
| _summary | nested obj | — | matched(41)/ambiguous(17)/no-match(4) | run metadata for the whole matching pass |
| \<id\>.renders | array\<text\> | tune_container.container (verified match) | — | container names whose render showed this rim id |
| \<id\>.n_wheels / .wheels | int / array\<obj\> | — | k: 4–16 | crop count; per-crop container/wheel-side/spoke-count |
| \<id\>.top3 / .top10 | array\<obj\> / array\<text\> | ref_wheel.media_name (verified) | scores 0.50–0.70 typical | matcher's ranked candidates |
| \<id\>.verdict | enum | — | matched(41), ambiguous(17), no-match(4) | human-eye outcome |
| \<id\>.stem / .name | text or null | ref_wheel.media_name / .full_name (may disagree) | — | winning candidate, present only if matched |
| \<id\>.confidence | enum | — | looked(58)/ranked-only(4) | whether a human actually verdicted it |
| \<id\>.strength / .alternates | enum / array, matched-only | — | anchor-confirmed, high, moderate-high, moderate | human confidence tier + rejected runners-up |
| \<id\>.candidates / .candidate_names | parallel arrays, ambiguous-only | — | — | 2-3 undistinguished stems |
| \<id\>.note | text | — | — | visual description backing the verdict |

---

### `engine-swaps` — Engine Family / Swap Catalog (`data/engine-swaps.json`)

**Key structure:** Single JSON object, 5 top-level keys. `families` is a dict keyed by **engine_family id** (string digits), always equal to the record's own `engine_family` field (0/134 mismatches) — the sole PK. Secondary non-unique lookup: `cars_seen` keyed by car ordinal (FK→ref_car.ordinal), no inverse index stored.

**Scale:** 134 engine-family records, 74,444 bytes, 227 total cars_seen (ordinal,name) pairs (1–15 cars/family).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| [top-level] schema_version / purpose / generated_by / family_count | text/text/text/int | — | "1.0.0" | file metadata; family_count=len(families), verified equal |
| families | nested obj, keyed by engine_family | — | 134 entries | the record collection |
| families{}.engine_family | int PK | self (=dict key) | — | always equals dict key, 0 mismatches |
| families{}.donor_ordinal | int, nullable FK | ref_car.ordinal | 25/134 non-null | donor car when known; always equals engine_family when present |
| families{}.donor_name | text, nullable | ref_car.full_name (cache) | 25/134 non-null | snapshot label — should re-derive, not trust |
| families{}.brand_guess | text, nullable, low-trust | none reliable (ref_car.make is correct source) | ~38 distinct incl. typos | mechanically = 2nd token of first cars_seen name — reflects RECIPIENT brand, not donor's |
| families{}.label | text | — | 2 templates | derived display label |
| families{}.aspiration_slot | enum, nullable | conceptually ref_car.aspiration domain | twin_turbo(42),single_turbo(38),centrifugal_sc(19),pos_sc(10),null(25=NA) | machine-readable induction slug |
| families{}.aspiration | enum | — | Twin-Turbo(42),Turbo(38),Naturally aspirated(25),Centrifugal-SC(19),Supercharged(10) | human-readable induction type, always present |
| families{}.shared_swap | bool | — | true(29)/false(105) | derived: len(cars_seen)≥2 |
| families{}.cars_seen | nested obj (ordinal→name) | keys→ref_car.ordinal | 105 families=1 car, 27=2-6, 3 outliers 9/11/15 | swap recipients, excludes donor's own car; name cache 48% stale |
| families{}.cyl | int, nullable | — | 1,3,4,5,6,8,10,12 | telemetry-measured cylinder count, 30/134 non-null |
| families{}.displacement_l | float, nullable | — | 1/134 non-null | almost entirely unimplemented |
| families{}.redline | int, nullable | comparable to ref_engine.redline_rpm | 8000–16500 | telemetry-measured redline, 30/134 |
| families{}.sample_hp | int, nullable | — | 127–2787, 25/134 non-null | single observed HP sample (independent of source flag) |
| families{}.resulting_drivetrain | enum, nullable | ref_car.drivetype domain | AWD(21)/RWD(9), 30/134 | drivetrain of sampled build |
| families{}.sample_pi | int, nullable | comparable to ref_car.pi | 500–930, 14 distinct, 30/134 | PI of sampled telemetry build |
| families{}.source | enum | — | save-mined(104), save-mined+telemetry(30) | gates the 5 telemetry fields (except sample_hp inconsistently) |

---

### `tuning-ranges-1` — Slider Ranges, Baselines, Formulas & Tuning Variables (5 files)

**Key structure:** 5 files, no single cross-store key. `global-slider-ranges.json`: config blob, `ranges` dict keyed by slider-name (2 entries). `slider-baselines.json`: 3 inner dicts keyed by enum (drivetrain/class/compound-label). `car-tune-ranges.json`: `ranges` keyed by ordinal→field→{min,max}; `points` keyed by composite `<ordinal>|<field>` — the closest real PK in the store. `formulas.json`: `functions[]` keyed by `id` (12 slugs). `tuning-variables.json`: `categories[]` keyed by `id` (9), nested `variables[]` keyed by `id` (28 slugs) — the field most analogous to `ref_slider.slider`.

**Scale:** 5 files, 89,813 bytes total. global-slider-ranges 3,751B; slider-baselines 2,228B; car-tune-ranges 2,970B (2 cars, partial); formulas.json 19,949B (12 functions); tuning-variables.json 40,915B (largest — 9 categories, 28 variables).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| global-slider-ranges.json: schema_version/created/purpose/method/confidence_note | text ×5 | — | "1.0.0" | file metadata |
| ranges.\<slider_name\> | nested obj | ref_slider.slider ('final_drive' exact; 'gear' has no ref_slider row) | final_drive, gear | game-FIXED band {min,max,confidence,source} |
| spring_model | nested obj, 11 keys | needs data/car-mass.json | confidence: verified/provisional | spring-frequency band (Hz) → spring rate formula |
| slider-baselines.json: schema_version/created/purpose/sources | text ×4 | — | "1.0.0" | file metadata + prose bibliography |
| constants | flat obj, 10 floats | — | — | game-wide generic baselines (damping, brake_bias, camber, etc.) |
| by_drivetrain.\<FWD/RWD/AWD\> | nested obj | ref_drivetrain.drivetype (exact string match) | FWD,RWD,AWD | diff accel/decel baseline % by drivetrain |
| mech_balance_by_class.\<class\> | flat obj+note | ref_class.name (exact match) | S2,S1,A,B,C,D (6/8 classes; R,X absent) | front weight-transfer target by class |
| psi_by_compound.\<label\> | flat obj+note | translation-only vs ref_compound.name (no direct match) | 12 hand-written labels | baseline cold PSI by compound |
| car-tune-ranges.json: schema_version/purpose/fields | text+array\[7\] | matches fh6_tune_decode.py PER_CAR_FIELDS exactly | 7 names | per-chassis (not game-fixed) slider fields |
| ranges.\<ordinal\>.\<field\> | nested obj | fh6.db ref_car.ordinal | unit: in, lb/in | back-solved absolute band; SPARSE — only 2 ordinals, partial |
| points."\<ordinal\>\|\<field\>" | flat obj, composite key | decomposes to ref_car.ordinal + 1 of 7 fields | norm 0.0–1.0 | raw (norm,value) calibration pairs feeding back_solve() |
| formulas.json: schema_version/created/purpose/why | text ×4 | — | "1.0.0" | NOT a slider store — a physics/heuristic function registry |
| notation.convention/symbols | text/array\[14\] | — | — | shared symbol glossary |
| functions[] | array\[12\] of obj | — | id: latg_fit, cornering_envelope, aero_brake_index, grip_per_thrust, balance_gap, aero_balance_ratio, slip_curve_model, spring_mass_scaling, cold_from_hot_psi, chassis_quadrant, breakaway_margin, pi_ledger | tier: physics(4)/fitted(1)/heuristic(6)/refuted(1) |
| housekeeping | obj, 2 keys | — | — | governance rule + why the refuted function is kept |
| tuning-variables.json: schema_version(2.1.0)/game/game_released/captured/structure_codified | text ×5 | duplicated verbatim into dashboard/db.js | — | file metadata — schema_version diverges from the other 4 files' "1.0.0" |
| ui_verification | nested obj, 5 keys | — | confidence_legend: fh6_confirmed, fh6_single, needs_ingame | how the tab/slider structure was footage-confirmed |
| observed_build | nested obj, 6 keys | conceptually ref_car by name (no ordinal) | — | the single reference build (2014 Golf R, PI 589) |
| tabs[] | array\[9\] | — | Tires, Gearing, Alignment, ARB, Springs, Damping, Aero, Brake, Differential | canonical footage-verified tab bar |
| tuning_order[] | array\[10\] | — | tires..gearing, this exact order | recommended tuning SEQUENCE (not tab order) |
| non_slider_tuning_fh6 | obj, 3 text keys | — | — | tire width & compound — parts-menu levers, not sliders |
| categories[] | array\[9\] of obj | — | id matches tuning_order/tabs | per-tab metadata: section_headers, gating, principle, phases |
| categories[].variables[] | array of obj, 28 total | STRONG but not exact match to ref_slider.slider (inverted axis-affix + 1 rename) | 28 ids e.g. tire_pressure_front, final_drive, diff_rear_decel | THE per-slider catalog: axis, unit, typical_min/max, poles, effect{down,up} |
| situational_model | nested obj, 8 keys, added 2026-07-27 | — | phase_map: 5 phases (Braking..Straights/crests/bumps) | WHEN each slider acts, orthogonal to per-slider catalog |
| build_phase | nested obj, 6 keys, added 2026-07-27 | — | — | "build before you tune" doctrine + gearbox_rule finding |

---

### `tuning-ranges-2` — NSX-R Menu Ladders & Tire-Compound Enum (5 files)

**Key structure:** Two schemes. The four `*-ladder-nsxr.json` files (drivetrain, platform, transmission, tire-compound) have NO primary key — single-car (ordinal 412), single-session blobs; identity is positional `(menu-category, tile)`, with `setup` (save-slot nickname) the closest designed-but-unstable key. `tire-compounds.json` IS genuinely keyed by `idx` (string int 0–15), the global tire-compound catalog position embedded in the save's `tire_compound` field — confirmed DISTINCT from `ref_compound.compound_id` (name-joinable only).

**Scale:** 5 files, 21,410 bytes total. drivetrain-ladder 2,315B (6 tiles); platform-ladder 7,493B (17 tiles/6 sub-menus); transmission-ladder 4,317B (6 tiles+ratio_bands); tire-compound-ladder 4,129B (11 tiles); tire-compounds.json 3,156B (16-slot enum, 11 proven).

**Confidence:** verified

| Field | Type | Join Target | Enum / Range | Meaning |
|---|---|---|---|---|
| car / captured / source / banner | text | ref_car.ordinal (412) | — | file-level: car identity, capture date, menu path/setup scheme, unlock-banner text |
| side_effect / note / scheme / menu / _complete / hypothesis | text | — | — | researcher annotations, never structured data |
| tile | int | ref_part.tile (verified exact match) | 1-based | position in car's Upgrade-Shop grid |
| name | text | ref_part.name | — | display name read off tile |
| index | int | ref_part.level (with caveat) | — | = part_id mod 1000; **mismatches ref_part.level on 2/4 differential tiles** (Drift/Offroad off-by-one) |
| part_id | int, transmission-only | ref_part.part_id / ref_drivetrain.drivetrain_id=2102 | 2102000–2102008 | full save-file id; under a DIFFERENT drivetrain_id family than this car's own stock_drivetrain_id (165) |
| price_cr | int | ref_part.price (usually, not always) | — | credits shown; Race Diff shows an ~11% unreconciled delta |
| installed / owned_before | bool, sparse | — | — | equipped-at-capture / already-owned flags |
| setup | text | — | unique within file | save-slot nickname used for capture, not stored in fh6.db |
| t0_60_s / t0_100_s / top_mph | float, sparse | — | — | 0-60/0-100/top-speed stat-preview values |
| brake_60_ft / brake_100_ft / latg_60 / latg_120 | float, sparse | — | — | stat-preview braking distance & lateral-G (HIGHLIGHTED-tile preview model, not a pure physics constant) |
| brake_60_ft_reread / brake_100_ft_reread | float, essentially unique | — | — | one-off duplicate read for display-stability check |
| grip_chip | float, sparse (3/11) | — | −0.16..+0.36 | GRIP badge delta, formula/sign not derived |
| pi_preview / pi_class | int / enum | ref_class.name (verified band match) | 681–738 / A,S1 | per-part-preview PI, distinct from ref_car.pi |
| weight_lb / front_pct | float/int | — | constant 2547lb/45% across tiles | describes the CAR at capture, not the tire |
| default_front_arb / default_rear_arb | float 0–1 | ref_part_slider.def_norm | Stock 0.5, Race 0.48/0.378 | normalized install-write value |
| defaults | nested obj OR text (inconsistent) | ref_slider.slider (keys match); ref_part_slider.def_norm | — | per-slider install-write values; one tile stores a literal string instead of an object |
| differential[] / driveline[] | array\<obj\> | — | 4 + 2 tiles | drivetrain-ladder's two top-level arrays |
| brakes/springs_dampers/front_arb/rear_arb/roll_cage/weight_reduction | obj{menu,side_effect,tiles} | ref_car_body.carbody_id family (roll_cage/weight_reduction); ref_part.level (others) | — | platform-ladder's 6 sub-menus; last 2 use a DENSE per-body-variant scheme |
| gear_count | int | — | 4,6,7,8,9,10 | forward gear count of that transmission tile |
| gear_positions[] / gear_ratios_default[] | array\[float\] | — | 0–1 / real ratio | normalized position → ratio, VERIFIED formula match |
| final_drive_position / final_drive_default | float | — | 0–1 / real ratio | same pair for final drive, VERIFIED |
| ratio_bands | obj{gear:[min,max], final_drive:[min,max]} | ref_slider (group_name='Gearing', band_source='gear') | gear 0.48–6.0, final_drive 2.2–6.1 | empirical global slider clamp — primary evidence, not a copy |
| names | obj, keys '0'–'15' | ref_compound.name (string-only, lossy) | 11/16 populated | THE tire-compound index→name enum; idx = tire_compound field mod 1000, a GLOBAL space distinct from ref_compound.compound_id |
| names_confidence / verified | obj / array\[int\] | — | same 11 indices, redundant encodings | proof status per index |
| observed_fh6_menu_compounds | obj{source,note,roster,not_seen_on_this_car} | — | roster: 8 names, grid order (not index order) | separate corroboration from a different car (Exocet, 2866) |
| index_map_status / unmapped_pending_anchor | text / obj | — | idx '11','12' | to-do list embedded in the store |
| _superseded_names_2026_08_29 | obj, historical, 10 entries | — | disagrees on idx 5/6 (swapped) | dead prior version — evidence the two names were originally swapped |

---

### `pi-parts-effects` — PI/Parts-Effects Cluster (5 files)

**Scale:** 5 files under `data/`: parts-pi.json (1,077 B, 2 resolved part-tiers), pi-observations.json (97,082 B, 72 obs / 37 distinct car ordinals), parts-effects.json (31,275 B, 3 engine case studies / ~65 measured part rows), upgrade-strategy.json (2,950 B, 6 steps + 3 rule blocks), clone-coverage.json (4,419 B, 50 slot counters + 7 gap rows). None represented by name in `db/schema.sql`; only pi-observations.json/parts-pi.json flow into `obs_pi` via `scripts/db/import_observations.py`, and that import is broken.

**Confidence:** verified

**Key structure:** Five independent JSON documents, no shared PK across files. (1) parts-pi.json — `parts_pi[slot][tier_string]`, tier_string = `str(id % 1000)` or `"None"`. (2) pi-observations.json — `observations[]` flat array, de-facto key (ordinal, parts_hash); ordinal repeats (up to 9x). (3) parts-effects.json — `engines[].id` slug; within an engine, `categories` is a dict keyed by free-text name whose value is EITHER a list of part rows OR a nested dict of sub-groups. (4) upgrade-strategy.json — single fixed-shape doc, `upgrade_order[].step` (1–6) the closest key. (5) clone-coverage.json — `per_slot` keyed by the 50 canonical slot names; `gaps[]` keyed by (slot, key).

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| parts-pi.json: schema_version | text | — | "1.0.0" | Fixed version tag |
| parts-pi.json: generated | text | — | timestamp | Local timestamp of last solver run |
| parts-pi.json: method | text | — | — | Free-text: two-stage solve (isolation, then regression fallback) |
| parts_pi.\<slot\> | text (enum-like) | ref_slot.slot | 50 canonical slot names | Top-level key; only slots with ≥1 resolved tier appear (2/50 today) |
| ...tier (\<slot\>.\<tier\>) | text key → nested obj | — | `str(part_id % 1000)` | NOT catalogue Level — raw installed id's low 3 digits |
| ...tier.pi_vs_stock | int, nullable | — | — | Estimated PI delta vs slot's reference tier |
| ...tier.ref_tier | text | — | tier number or "None" | Stock/anchor tier the delta is measured against |
| ...tier.samples | int | — | — | Total observation-pair count backing the estimate |
| ...tier.confidence | text enum | — | measured-direct \| measured-chain \| regression \| unresolved | Direct pair observed vs chain-inferred vs regression fallback |
| ...tier.edges | nested map | — | "\<from\>->\<to\>" → {median_delta,samples} | Every observed same-ordinal single-part-change pair landing on this tier |
| coverage.* | mixed | — | — | Run diagnostics: slots_with_estimates, part_tiers_seen/resolved, by_confidence, regression status, observations, ordinals, single_part_pairs |
| pi-observations.json: schema_version/purpose | text | — | "1.0.0" | Solver-input file role, written by fh6_live_daemon.py |
| observations[].ordinal | int | ref_car.ordinal | — | Car of this snapshot; 37 distinct across 72 rows |
| observations[].ts | float (unix epoch, 1dp) | — | 1787467408.1–1788453189.3 | Capture time (~11.4 days of sessions) |
| observations[].car_pi | int | — | 100–999 (obs 487–930) | Live CarPI at exact config — the regression target |
| observations[].car_class | text enum | ref_class.name | D,C,B,A,S1,S2,R,X | PI class band; observed A(29) S1(16) B(11) S2(10) C(5) X(1) |
| observations[].parts | nested obj, 50 keys | ref_slot.slot (name); ref_part.slot+id (value, caveat) | int\|null | One key per canonical slot; value = installed_part_id % 1000, NOT catalogue Level |
| parts.\<50 slot names\> | shape ×50, int\|null | — | — | See profile for full 50-name list; two slots always null; rim_style/rear_rim_style hold true wheel ids (only pair where stored value = true part id) |
| observations[].parts_hash | text, 16-hex | — | — | sha1(ordinal+swap-family+sorted 50-slot dict)[:16], dedup/match key |
| parts-effects.json: schema_version/created/purpose/method | text | — | — | Metadata; capture-start 2026-08-10; shop-preview-panel reading method |
| display_rules | array of text (7) | — | — | Caveats on reading the shop preview panel |
| engines[] | array, 3 heterogeneous objs | — | — | One per case study: id, car, engine, stock_output, measurement_base, captured, categories, optional donor_solution |
| engines[].categories.\<name\> | array OR nested dict | — | — | Heterogeneous per engine; some categories are dict-of-subgroups with 'finding'+'options' shape |
| ...category[].part | text | — | — | Exact in-game shop menu label |
| ...category[].hp / torque | int, nullable | — | — | Absolute hp/torque shown with part installed |
| ...category[].delta / hp_delta / delta_pi / delta_weight | int or [int,int], nullable | — | — | Inconsistent delta encoding vs category base |
| ...category[].weight_lb / front_pct | int, nullable | — | — | Weight and front-% with part installed |
| ...category[].pi | int OR text (mixed) | — | — | Occasionally free text embedding measurement context |
| ...category[].cost_cr / displacement_cc / badge / note / weight_note | mixed, optional | — | — | Price, block displacement, badge text, annotations |
| pi_efficiency_stars | array of text (10) | — | — | Prose headline findings (PI-negative/free parts); not structured data |
| upgrade-strategy.json: schema_version/captured/confidence/note | text | — | — | v1.0.0, 2026-06-07, file confidence 'probable', thesis note |
| upgrade_order[] | array of 6 objs | — | step 1–6; confidence verified(5)/probable(1) | Ordered upgrade-priority list |
| drivetrain_rules | fixed obj | — | — | 3 prose fields (road, off-road/XC, power-split meta) + confidence |
| engine_swap_notes | fixed obj | — | — | 2 prose fields + confidence |
| build_principles | array of text (4) | — | — | General build maxims |
| clone-coverage.json: containers | int | — | 575 | Total locked-tune containers scanned |
| clone_ready | int | — | 426 | Containers where every populated slot resolves cleanly |
| by_blocker_kind | dict text→int | — | ready, derived, unknown, "derived+unknown" | Histogram of unresolved-slot-class combos |
| per_slot.\<slot\> | map slot→dict | ref_slot.slot | proven/verified/derived/unknown/brand/rim/rim-proven | Per-slot resolution-class counts across 575 containers |
| gaps[] | array, 7 rows | ref_slot.slot | — | Unresolved (slot,tier/id) still blocking clone-readiness |
| ready_examples | array of text (20) | — | — | Sample display names of first 20 clone-ready containers |

---

### `routes-tracks-json` — Routes/Tracks Cluster (4 files)

**Scale:** routes.json 14,098 B, v1.1.0, 64 records (63 coord-keyed + 1 loop), events sum 6,737. rivals-tracks.json 70,745 B, v2.0.0, 25 tracks (5 analyzed/20 scaffold, 2/25 with class_analyses). rivals-routes-road.json 13,585 B, v1.0.0, 23 routes (order 1–23, from 49 video frames). reference-loops.json 180 B, v1.0.0, 1 loop record.

**Confidence:** verified

**Key structure:** Four structurally distinct files. (1) routes.json — dict keyed by `"{x}_{z}"` world-coord bin (63) + one `"loop:{name}"` key; every coord key has a verified 1:1 filename join to `data/courses/<key>.json`. (2) rivals-tracks.json — JSON ARRAY of 25 objects, real key = each object's own `id` slug. (3) rivals-routes-road.json — JSON ARRAY of 23 objects keyed by `order` (in-game scroll position); despite the shared field name "routes," structurally unrelated to (1). (4) reference-loops.json — dict `loops` keyed by free-typed loop name (1 key today), written by dashboard's mark-start endpoint.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| routes{key} | dict (64 entries) | data/courses/\<key\>.json (verified 63/63 + loop) | `"{x}_{z}"` or `"loop:{name}"` | Top-level route registry, coord-bin PK |
| routes[k].start | array[int,int] | — | ±9000 both axes | World X,Z of canonical start |
| routes[k].heading | array[float,float] | — | unit vector, mag 0.9995–1.0005 | Travel direction at start; present 52/64 |
| routes[k].length_m | int | — | 173–109159 | Lap length; 109159 outlier (Edamame Circuit) likely aggregation defect |
| routes[k].events | int | — | 2–1796 | Count of attributed session events; present 52/64 |
| routes[k].first_seen / last_seen | text | data/sessions/\<value\>.json | `fh6_YYYYMMDD_HHMMSS` | Earliest/latest attributed event |
| routes[k].mode | text\|null | — | "race" \| "timed solo (Rivals/time trial)" \| "reference loop" \| null | Player-declared race-mode; present 3/64 |
| routes[k].name | text | rivals-tracks.json[].name; rivals-routes-road.json.routes[].name | freeform | User-typed display name; present 3/64 |
| routes[k].rivals | bool | — | true only | Manual "running under Rivals rules" flag; present 1/64 |
| routes[k].source | text | — | `"dashboard {YYYY-MM-DD}"` | Provenance stamp; present 3/64 |
| loops{name} | dict (1 entry) | routes.json's `"loop:{name}"` key (different record, same feature) | — | Free-roam test-circuit registry; read every analysis pass |
| loops[name].start | array[int,int] | — | — | Rounded world X,Z at mark-start press |
| loops[name].radius | int | — | default/observed 60 | Meters; return-to-start lap-completion radius |
| loops[name].min_dist | int | — | default/observed 250 | Meters; min travel before a return counts as a lap |
| tracks[] | array (25) | — | — | NOT dict-keyed; real key = tracks[].id |
| tracks[].id | text PK | — | 25 unique slugs | Kebab-case identifier |
| tracks[].name/location/region | text | name → rivals-routes-road.json.routes[].name (22/23) & routes.json name | region: 10 distinct | Display name, place, map region |
| tracks[].format | enum(text) | — | circuit\|sprint\|endurance\|drag | Race format |
| tracks[].discipline / template_ref | enum(text) | template_ref → tuning-templates.json | road\|drag | Coarse approach; tuning template pointer |
| tracks[].character / character_confidence | text/enum | — | verified\|probable | Researched driving character + confidence |
| tracks[].status | enum(text) | — | scaffold(20)\|analyzed(5) | Whether real leaderboard data exists |
| tracks[].speed_profile / drivetrain_bias | enum(text), sparse | — | 8 speed_profile values; RWD\|AWD\|either | Track character/winning-drivetrain lean |
| tracks[].length | text (freeform) | rivals-routes-road.json.length_mi (conceptual only) | — | Human-written distance/lap description, not numeric |
| tracks[].strip_bias / drag_playbook | text/nested obj | — | 3 long-text values | Drag-only fields (launch/topspeed classification, playbook) |
| tracks[].research | nested obj, 21/25 | — | verdict CONFIRMED\|PLAUSIBLE\|REFUTED | Verification metadata for inferred fields |
| tracks[].class_analyses[] | array, non-empty 2/25 | leaderboard_snapshot.top[].car (name only, no id) | class: A observed | Per-PI-class leaderboard analysis from screenshot |
| rivals-routes-road routes[] | array (23) | — | — | Keyed by `order`; unrelated structurally to routes.json |
| routes[].order | int PK | — | 1–23 | In-game scroll position |
| routes[].name | text | rivals-tracks.json[].id (slug, 22/23); routes.json name | — | Official in-game route name |
| routes[].length_mi | float | data/laps.db geometry.length_m (unverified to exist) | 0.7–53.1 | Official "Route Length" stat, clean numeric |
| routes[].description | text | game-strings/RivalsEventData.json IDS_Description_\<guid\> (structural, not re-verified) | — | Official in-game blurb |
| routes[].ids_name_guids | array[text], len 7 | game-strings/RivalsEventData.json `IDS_Name_<guid>` (verified) | 32-hex | 7 localization GUIDs for this route's name |
| routes[].frames | array[text], 1–4 | source video only | `r_006`..`r_049` | Source-video frame ids, provenance |

---

### `game-strings-1` — Data_Car / CareerTrackInfo / RivalsEventData / UpgradePresetPackages / List_CarMake / List_Aspiration / List_Cylinders / _index

**Scale:** 8 files examined (of 23 in `data/game-strings/`). Data_Car.json 56,697 B/1,320 keys (660×2). CareerTrackInfo.json 43,962 B/448 keys (4×112 independent pools). RivalsEventData.json 138,342 B/1,208 keys (2×604 independent pools). UpgradePresetPackages.json 75,834 B/896 keys (448×2, id 2–10002 sparse). List_CarMake.json 6,468 B/180 keys (90×2, id 1–262 sparse). List_Aspiration.json 617 B/16 keys (8×2, id 1–8). List_Cylinders.json 518 B/14 keys (14×1). _index.json 676 B manifest.

**Confidence:** verified

**Key structure:** Flat `{IDS_<Kind>_<idsuffix>: string}` dumps of `.str` tables (source EN.zip). PATTERN A (numeric idsuffix: Data_Car, UpgradePresetPackages, List_CarMake, List_Aspiration, List_Cylinders) — idsuffix = real PK of a FH6_Database.sqlite table; different field-kinds for the same idsuffix describe the same record (100% id-set overlap verified). PATTERN B (32-hex GUID idsuffix: CareerTrackInfo, RivalsEventData) — idsuffix is a resource hash with NO cross-field relationship (0% id-set overlap between field-kinds); join target to any table is genuinely UNKNOWN. _index.json: `{source, format, tables:{TableName:count|"absent"}}`.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| Data_Car.json / IDS_DisplayName_\<carId\> | text | carId = Data_Car.Id = ref_car.ordinal (verified) | — | Short model name only (e.g. "2000GT") |
| Data_Car.json / IDS_ModelShort_\<carId\> | text | same carId | — | Counter-intuitively holds FULL "Make Model" string — field names effectively swapped |
| CareerTrackInfo / IDS_DisplayName_\<guid\> | text | UNKNOWN (no matching sqlite table; NewProfile_CareerRaces has right-shaped cols but 0 rows) | 112 present | Career track/event full name |
| CareerTrackInfo / IDS_ShortDisplayName_\<guid\> | text | unknown, different GUID pool than above | 112 present | Shorter UI variant, not pairable to DisplayName |
| CareerTrackInfo / IDS_ShortDisplayNameAllCaps_\<guid\> | text | unknown | 112 present | All-caps HUD variant, independent GUID pool |
| CareerTrackInfo / IDS_Description_\<guid\> | text | unknown | 112 present | One-line flavor description, independent pool |
| RivalsEventData / IDS_Name_\<guid\> | text | UNKNOWN; census "event-name lead" for empty ref_event has no found join key | 604 (518 unique) | Rivals event name; 86 dup values across GUIDs |
| RivalsEventData / IDS_Description_\<guid\> | text | unknown, independent pool from Name | 604 | One-sentence event blurb/tip |
| UpgradePresetPackages / IDS_Title_\<presetId\> | text | presetId = UpgradePresetPackages.Id = ref_preset.preset_id (verified; already imported) | 448, id 2–10002 sparse | Preset display title |
| UpgradePresetPackages / IDS_Description_\<presetId\> | text | same presetId; mirrored into ref_preset.description | — | Preset marketing blurb |
| List_CarMake / IDS_DisplayName_\<makeId\> | text | makeId = List_CarMake.ID = Data_Car.MakeID | 90, id 1–262 sparse | Manufacturer display name |
| List_CarMake / IDS_Profile_\<makeId\> | text | same makeId | — | Manufacturer marketing paragraph; 51/90 empty, several unfinished placeholders |
| List_Aspiration / IDS_DisplayName_\<id 1-8\> | enum(text) | id = Data_Car.AspirationTypeId (verified) | 1=NA...6=Centrifugal SC, 7=empty, 8=N/A | Full aspiration-type name |
| List_Aspiration / IDS_ShortDisplayName_\<id 1-8\> | enum(text) | same id space | NA,T,TT,QT,PDSC,CSC,empty,N/A | Abbreviation |
| List_Cylinders / IDS_Description_\<id 1-14\> | enum(text) | id = Data_Car.CylinderID (verified) | 14 values, non-monotonic order | Cylinder/rotor configuration description |
| _index.json / source | text | — | single path string | Absolute path to source EN.zip |
| _index.json / format | text | — | — | Pointer: "see fh6_strings.py docstring" |
| _index.json / tables.\<TableName\> | int or "absent" | TableName+".json" sibling file | 22 tables listed | Flat key count for that table (2×/4× real record count) |

---

### `game-strings-2` — List_DriveType / List_EngineConfig / List_PartManufacturer / Tracks / Tuning / Upgrades / UpgradeTypes / UpgradeAreas

**Scale:** 8 files, 96,606 B total. List_DriveType.json 93 B/3 keys. List_EngineConfig.json 385 B/9 keys. List_PartManufacturer.json 31,675 B/739 keys. Tracks.json 12,147 B/232 keys (58×4). Tuning.json 16,829 B/131 keys. Upgrades.json 17,680 B/496 keys (248×2). UpgradeTypes.json 15,274 B/106 keys (53×2). UpgradeAreas.json 2,523 B/22 keys (11×2). All row counts cross-checked exactly against live `SELECT COUNT(*)` on FH6_Database.sqlite and `_index.json`.

**Confidence:** verified

**Key structure:** 7 of 8 are ROW-KEYED: `"IDS_<Purpose>_<id>"` where id = a verified sqlite table's PK (List_DriveType.ID, List_EngineConfig.ConfigID, List_PartManufacturer.Id, Tracks.id, Upgrades.id, UpgradeTypes.id, UpgradeAreas.id). Where the sqlite table has multiple string columns, the JSON carries one key-prefix per column, all sharing the id space — so (id, column-purpose) is the true composite key for Tracks/Upgrades/UpgradeTypes/UpgradeAreas. Tuning.json is the exception: keys are literal, stable semantic labels (IDS_Camber, IDS_1st...) naming UI elements directly — no numeric id space, no sqlite table, pure UI-copy bundle.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| List_DriveType / IDS_DisplayName_\<id\> | text | List_DriveType.ID (dense PK 1–3) | 1=FWD,2=RWD,3=AWD | Drive-type display name |
| List_EngineConfig / IDS_DisplayName_\<id\> | text | List_EngineConfig.ConfigID (1–9), referenced by Data_Engine.ConfigID | 9 configs (V/W/Inline/Rotary/Flat/Electric/3 hybrid types) | Engine layout name; schema.sql's ref_engine.config exists but importer hardcodes NULL — this file is a ready, unused fix |
| List_PartManufacturer / IDS_PartManufacturer_\<id\> | text | List_PartManufacturer.Id (row count matches 739=739) | 739 populated, sparse 1–845 | Manufacturer/brand or livery-decal-set name; ALREADY imported via a separate independent resolver into ref_wheel.manufacturer |
| Tracks / IDS_DisplayName / ShortDisplayName / ShortDisplayNameAllCaps / Description _\<id\> | text ×4 | Tracks.id = ref_track.track_id (live table) | 58 ids, sparse, 201–2100 | Full/short/allcaps/description track strings; only DisplayName is imported — the other 3 field-groups sit unresolved in ref_track.data |
| Tuning / \<literal keys\> | text (UI copy) | none — presentational only, unconsumed by any import | 131 distinct keys | Exact in-game Tuning-screen wording: slider labels, help paragraphs, dialog text, gear ordinals IDS_1st..IDS_10th |
| Upgrades / IDS_Name_\<id\> | text | Upgrades.id / composite (TypeId,Level); already resolved via independent resolver into ref_part.name | 248, sparse 1–315 | Upgrade-tier shop-tile label |
| Upgrades / IDS_Description_\<id\> | text | same id | — | VERIFIED DEAD: 248/248 empty string, nothing to import |
| UpgradeTypes / IDS_Name_\<id\> | text | UpgradeTypes.id == ref_slot.upgrade_type_id | 53, sparse 1–63 | Upgrade-category label (e.g. "Camshaft"); CONFIRMED GAP — never imported |
| UpgradeTypes / IDS_Description_\<id\> | text | same id | 1/53 empty | Full explanatory paragraph; CONFIRMED GAP |
| UpgradeAreas / IDS_Name_\<id\> | text | UpgradeAreas.id (junction via UpgradeAreaForUpgradeType); Name already imported into ref_slot.menu_area | 11 ids: 1=Engine...13=Wheel Customization (gaps at 6,7) | Shop menu-tile label |
| UpgradeAreas / IDS_Description_\<id\> | text | same id | 4/11 empty (the 4 *_Customization areas) | Long shop-tile paragraph; unimported gap |

---

### `game-strings-3` — CarClasses / WheelCategories / Landmarks / MapRegion / PointsOfInterest / TimeAttack

**Scale:** 6 files, 156 entries, 10,540 B. CarClasses.json 1,611 B/16 keys. WheelCategories.json 1,244 B/10 keys. Landmarks.json 4,930 B/81 keys. MapRegion.json 1,289 B/20 keys. PointsOfInterest.json 834 B/19 keys. TimeAttack.json 632 B/10 keys. Counts match `_index.json` tallies and raw `.str` source files exactly.

**Confidence:** verified

**Key structure:** Six independent flat JSON objects, each keyed by symbolic `IDS_<Category>_<suffix>` string, no numeric column. Three suffix shapes: (1) small sequential int (CarClasses n=0–7, WheelCategories n=1–5); (2) free-text slug (Landmarks, PointsOfInterest); (3) 32-hex-char GUID, no dashes (MapRegion, TimeAttack). A handful of keys per file are fixed singleton UI-microcopy strings with no per-record suffix at all. Upstream hashing scheme (strhash/rotl32) was already discarded at export time for these files.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| CarClasses / IDS_Description_\<n\> | text | row order = CarClasses (ORDER BY MaxPI) = ref_class.class_id | n=0..7 | Long-form class blurb; 6/8 share boilerplate tail |
| CarClasses / IDS_DisplayName_\<n\> | text | same n | 0=D...7=X | Short class-letter label |
| WheelCategories / IDS_Description_\<n\> | text | WheelCategories.ID / ref_wheel_category.category_id (imported, but keyed by DisplayOrder ≠ this n) | n=1..5 | Rim-category shop blurb; 4/5 share boilerplate |
| WheelCategories / IDS_Name_\<n\> | text | same | 1=Stock..5=All Rim Styles | Rim-category tab label |
| Landmarks / IDS_Area_Discovered_\<slug\> | text | UNKNOWN — no matching sqlite table; likely a live-install landmark-trigger file | 75 slugs | Landmark/area display name for the "Area Discovered" popup |
| Landmarks / fixed UI-microcopy keys | text | none | 6 fixed keys | Shared discovery-HUD microcopy, not per-landmark |
| MapRegion / IDS_Name_\<guid\> | text | UNKNOWN direct FK; NOT List_Region (false-cognate: different table-hash) | 10 GUIDs = 10 map regions | Full region display name |
| MapRegion / IDS_ShortName_\<guid\> | text | unknown; own GUID differs from IDS_Name's GUID for same region | 10 GUIDs, 1:1 with Name set | Abbreviated region label |
| PointsOfInterest / IDS_POI_\<slug\> | text | NONE in FH6 | 19 slugs | FLAGGED: all 19 are real Australian (FH3) place names — shared-engine leftover, not live FH6 content |
| TimeAttack / IDS_DisplayName_\<guid\> | text | UNKNOWN; region-name overlap with MapRegion/CareerTrackInfo suggests indirect tie, GUIDs don't match directly | 6 GUIDs (Sekibe, Soni, Hokubu, Brio 01, Legend Island, Edamame) | Per-event Time Attack title |
| TimeAttack / fixed UI-microcopy keys | text | none | 4 fixed keys | Shared mode HUD text; IDS_Time_Attack_Wrong_Dir is verified empty string |

---

### `part-vocab-misc` — part-names / rim-menu-order / game-assets / car-mass / car-option-lists (5 files)

**Scale:** part-names.json 30,785 B (19 named slots, 7-entry tier ladder, rim_style only 4/148 named). rim-menu-order.json 13,375 B (71 wheel rows + 1 id pairing). game-assets.json 5,030 B (7 telemetry pages + 9 badges + ~19 unindexed source bundles). car-mass.json 806 B (1 row vs 558-car universe). car-option-lists.json 967,241 B (660 archives scanned; 558 in `cars{}`, 102 in `no_list_archives[]`; totals FrontBumper 1,550/518cars, RearWing 1,384/510, ChassisStiffness 1,382/500, Hood 755/217, SideSkirts 582/203, RearBumper 568/218, CarBody 232/109, WeightReduction 4/1).

**Confidence:** verified

**Key structure:** No single row key across the five files. part-names.json: documentation tree, semantic path `named.<slot>["<tier>"]` or `named.<slot>._per_car["<ordinal>"]["<index>"]`. rim-menu-order.json: `wheels[]` keyed by `n` (1-based capture sequence, not a stable id); `known_ids{}` keyed by numeric rim id. game-assets.json: whole-file blob, nearest key `live_assets.<category>.files[]` by page/filename. car-mass.json: `masses{}` keyed by car ordinal. car-option-lists.json: `cars{}` PK = car ordinal; within a car, `options.<slot>[]` id = ordinal*1000+variant*100+tier; cars with no option list live only in `summary.no_list_archives[]` keyed by archive stem, no ordinal.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| part-names: tier_ladder | nested obj, keys "0"–"6" | named.\<slot\> entries | 0=Stock..6=Offroad | Global tier-name ladder for 'sparse' slots |
| part-names: dense_slots | nested obj | — | 5 slots + 8 size-slot notes | Documents slots where save index IS the shop-tile position directly |
| part-names: named.\<slot\> (10 tier-ladder slots) | mixed prose+numeric | tier_ladder / catalogue.extended_tiers | numeric key = tier index | Global-ladder name lookups per slot |
| part-names: named.tire_compound | nested obj | — | index "0"-"9", sparse (4 gap) | Global compound enum; `_menu_order_nsxr` proves menu order ≠ index order |
| part-names: named.rim_style | nested obj, ids are real part ids | rim-menu-order.json known_ids (638 confirmed identical) | ids 326–14670 | Flat global wheel catalogue; only 4/148 ids resolved |
| part-names: named._per_car sub-tables | nested obj, keyed by ordinal | ordinal → car-option-lists.json / car-mass.json | — | Per-car dense index→name tables; populated for 1/558 cars (ordinal 412) |
| part-names: gaps | obj, slot-name→text | — | — | Explicit incompleteness list per area |
| part-names: catalogue | nested obj | catalogue.bases → game-strings/Upgrades.json | 46 slot bases; 12 verified_pairs | Derivation rule: name = Upgrades[base(slot)+tier] |
| part-names: fallback_identification | nested obj | — | — | Match-by-measured-delta method when a tile can't be named |
| part-names: size_slots | nested obj | overlaps catalogue.bases | 8 slots, 3–8 rows each | Tire/rim/track size catalogues; worked example for 1 car |
| part-names: drivetrain_partset_caveat | text | — | 313/574 on set 2102 | Transmission/diff/driveline/clutch share ONE 'partset' id per container, not the car's ordinal |
| rim-menu-order: source/note/category_order | text/text/array(5) | — | [Stock,Sport,Multi Piece,Specialized,All Rim Styles] | Capture provenance + shop tab order |
| rim-menu-order: known_ids | obj, id→text | part-names.json named.rim_style | 1 entry (638) | Only confirmed id↔name pairing |
| rim-menu-order: wheels[] | array, 71 rows | — | list A(21,Sport)/B(50) | {n,list,category,name,price_cr,weight_lb,frames}; no part id except known_ids' 1 |
| game-assets: schema/generated/purpose | text | — | — | Curated UI-asset manifest metadata |
| game-assets: live_assets.telemetry_pages | obj {dir,source,files[7],used_by} | — | 7 HUD pages | Captured telemetry-page stills |
| game-assets: live_assets.class_badges | obj {dir,source,files[9],used_by} | — | D,C,B,A,S1,S2,R,X,strip | PI-class badge images |
| game-assets: source_library | obj of obj, free text | — | ~19 bundles | Unindexed raw video/screenshot evidence catalogue |
| car-mass: schema/created/purpose/note | text | — | formula: k=f²·W/19.56 | Physics formula used downstream |
| car-mass: masses | obj, keyed by ordinal | ordinal → car-option-lists.json cars key (confirmed 2866 match) | 1/558 populated | {mass_lb, front_pct, source} |
| car-option-lists: schema/generated/generated_by/source/purpose | text | — | — | Generator = fh6_manifest.py |
| car-option-lists: caveats | array(5) text | — | — | Semantics rules (variant/tier/rank meaning, no_list_archives) |
| car-option-lists: slot_names | obj, 8 entries | PartEnum → internal slot-key | 8 fixed | Complete crosswalk (CarBody, RearWing, FrontBumper, RearBumper, Hood, SideSkirts, ChassisStiffness, WeightReduction) |
| car-option-lists: cars.\<ordinal\>.stem / .name | text/text | — | — | Archive folder name; display name |
| car-option-lists: cars.\<ordinal\>.options.\<slot\>[] | array of objs | id decomposes to ordinal + tier (→part-names.json catalogue.bases) | id=ordinal*1000+variant*100+tier | {id,variant,tier,rank,models} |
| car-option-lists: cars.\<ordinal\>.fixed_slots | array enum text | — | 8 slots + Brakes + WheelStyle | NonUpgradeablePart slots; Brakes/WheelStyle never captured as option lists anywhere |
| car-option-lists: cars.\<ordinal\>.anomalies | array text | — | 1/558 cars | id-prefix disagreements |
| car-option-lists: summary.* | mixed ints/dicts | — | — | Aggregate stats: archives_scanned/parsed, part_enums, histograms |
| car-option-lists: summary.no_list_archives | array, 102 objs {stem, fixed_slots} | — | — | Cars with zero options; no ordinal key anywhere in this store |

---

### `tuner-guides-1` — tuner-sheets / tuners / tuner-roster / tuning-templates (4 files)

**Scale:** tuner-sheets.json 875,449 B — 1,659 tunes + 580 kleis_recommendations + 5 sources; raw 2,344 verified = sum(sources[].rawTunes). tuners.json 4,321 B, 13 records. tuner-roster.json 10,396 B, 147 gamertags + 11-category index + 6 tools. tuning-templates.json 11,365 B, 5 discipline records.

**Confidence:** verified

**Key structure:** (1) tuner-sheets.json: `tunes[]` (1,659) keyed by `code` (9-digit share code, verified unique); `kleis_recommendations[]` (580) has NO code field, natural composite key (car,tuner) not guaranteed unique; `sources[]` (5) keyed by `tuner`. (2) tuners.json: `tuners[]` (13) keyed by `name`. (3) tuner-roster.json: `gamertags[]` (147, all unique) keyed by `gt`. (4) tuning-templates.json: `templates[]` (5) keyed by `id` (== `discipline`, always identical).

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| tunes[].car | text | ref_car.display_name/full_name (fuzzy, ~68% exact) | 747 distinct strings | Free-text vehicle name, inconsistent formatting |
| tunes[].class | enum(text) | ref_class (uncertain for 'R') | D,C,B,A,S1,S2,X,R | PI class letter; 'R' is non-canonical sheet shorthand |
| tunes[].code | text | — | `NNN NNN NNN`, all 1,659 unique | In-game share code — the record's natural key |
| tunes[].creator | text | tuner-roster.json gamertags[].gt (58/108 exact match) | 108 distinct | Gamertag of tune's maker; some rows CSV-merge 2–3 names |
| tunes[].focus | text (tag) | — | 965 distinct | Free-text build-style descriptor |
| tunes[].drivetrain | enum(text) | loosely ref_car.drivetype | AWD(1076) RWD(333) FWD(70) blank(180) | Self-reported drivetrain |
| tunes[].discipline | enum(text) | different vocab than tuning-templates | road(901) dirt/offroad(525) drift(41) drag(1) blank(191) | Coarse driving-surface category |
| tunes[].tire | enum(text) | ref_compound.name (wording unverified) | 15 values, blank 1298 | Tire compound; only LogikJ rows (361) |
| tunes[].engine | text | possibly data/engine-swaps.json | 44 distinct | Engine-swap donor label; same 361 rows as tire |
| tunes[].build | text | — | 92 distinct | Cosmetic/aero loadout descriptor |
| tunes[].date | text (unparsed) | — | 140 distinct raw strings, 3 mixed formats | Not machine-sortable as-is |
| tunes[].notes | text | — | 92% non-empty | Tuner commentary/warning |
| tunes[].source | enum(text) | tuner-sheets.json sources[].tuner; tuners.json tuners[].name | 5 values | Which sheet the row came from |
| tunes[].tab | enum(text) | — | 6 distinct | Spreadsheet tab within source |
| tunes[].also_in | array(text), optional | drawn from `source` enum | present 333/1659 | Dedup trail: which other sources had the same code |
| kleis_recommendations[].car | text | — | 137 distinct | No `code` field exists (Sheets hyperlink codes unscrapeable) |
| kleis_recommendations[].tuner | text | tuner-roster.json gt (fuzzy) | 109 distinct | Recommender gamertag |
| kleis_recommendations[].desc | text | — | — | Free-text build summary |
| kleis_recommendations[].discipline | enum(text) | different vocab than tunes[].discipline | Road(415) Dirt/CC(165) | Surface category |
| kleis_recommendations[].drivetrain | enum(text) | — | AWD(373) RWD(162) FWD(45), no blanks | Drivetrain |
| kleis_recommendations[].livery_by / livery | text/text | — | 161/580 both | Livery-maker gamertag; livery search name |
| kleis_recommendations[].tag | text, sometimes multi | — | 28 raw strings, blank(377) | Style/bodykit label(s) |
| sources[].tuner/id/tabs/rawTunes | nested obj (5) | tuners.json tuners[].name/.sheet_url | rawTunes sum=2,344 exact | Per-sheet ingestion ledger; K1Z Gray shares LogikJ's doc id |
| counts.{raw,unique,kleis} | int ×3 | — | 2344/1659/580, all verified | File-level tallies |
| tuners.json: tuners[].name/kind/specialty/sheet_url/confidence | text/enum/text/text\|null/enum | sheet_url → tuner-sheets sources[].id | kind: sheet(7)\|gamertag(6); confidence: verified(1)\|probable(12) | Roster of 13 trusted sources, broader than the 5 actually ingested |
| tuner-roster: gamertags[].gt/team/notes | text/opt/opt | tunes[].creator / kleis[].tuner (fuzzy ~54%) | team 53.7%, notes 45.6% present | 147 unique gamertag roster |
| tuner-roster: specialty_index | obj, 11 enum keys→array(text) | gamertags[].gt (formatting drift) | drift,drag,pr_stunt,offroad_dirt,powerbuilds,seasonal,fwd,road_street,prolific,wheel_players | Category→gamertag index |
| tuner-roster: tools_and_communities[] | array {name,kind,platform?,by?,note} | — | kind: tool/discord/community/youtube | External references |
| tuning-templates: templates[].id/.discipline | text PK | — | drag,road,touge,dirt_rally,cross_country (3rd distinct vocab) | id always == discipline (redundant column) |
| templates[].convergence | enum(text) | convergence_scale (same file) | high(1)/medium(2)/low(2) | Bespoke-tuning-vs-universal-formula |
| templates[].template | nested obj, shape varies per row | — | 5–9 keys per row | Slider-category→prose recommendation, not numeric |
| templates[].key_variables/.variants/.car_selection/.split_note/.sources/.confidence | mixed | sources[] → probable data/sources.json ids (unverified) | confidence verified(1)/probable(4) | Factor list, named sub-styles, citations |

---

### `tuner-guides-2` — sources.json / tune-codes.json / tune-raw.json

**Scale:** 3 files, 58,068 B / 924 lines, zero shared schema, zero script consumption (grep confirmed), zero `db/schema.sql` table. sources.json 43,793 B/752 lines: 97 bibliography records (19 primary/28 expert/50 community) + 4 methodology objects + 1 blacklist. tune-codes.json 12,507 B/142 lines: 3 class buckets (B/A/S1), 117 car-tune rows (29/42/46). tune-raw.json 1,768 B/30 lines: 1 tune record, 30-field slider object.

**Confidence:** verified

**Key structure:** sources.json: `sources[].id` looks like a PK but is NOT unique (2 collisions: "forzatune" cited twice identically; "dexerto" same id/two urls) — true identity = array position or (id,url). tune-codes.json: `classes[].cars[]`, no key field; `code` is closest natural key (unique among 116 populated); 9/117 legit repeats (same car, different class), 1 within-class dup. tune-raw.json: `tunes[]`, future natural key (match_car,class,code), code nullable.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| sources.json: captured / hierarchy_note | text | — | 2026-06-07 | Bibliography start date; tiering methodology prose |
| sources.json: fh6_ui_structure_pass / fh6_ui_screenshot_pass / verification_pass | nested obj, singleton ×3 | — | — | Dated research-pass reports with rejected sources, corrections lists |
| sources.json: distrusted_copyclusters | nested obj | — | 15 domains | SEO/AI content-farm blacklist |
| sources[].id | text | NOT reliably unique | 97 rows, 95 distinct | Citation slug |
| sources[].tier | enum(text) | — | primary(19)\|expert(28)\|community(50) | Trust tier |
| sources[].title | text | — | 17–86 chars | Human label, often with reliability parenthetical |
| sources[].url | text | — | 7/97 not real URLs ("n/a — screenshot...") | Source URL; 3 dup-cited across ids |
| sources[].used_for | text | — | 52/97 carry informal prefix tags (VERIFICATION:, GAP FILL:, RETRACTED:, etc.) | Justification of claim(s) backed |
| sources[].reliability_note | text, optional | — | present 4/97 | Extra low-trust caveat |
| tune-codes.json: schema_version/captured/source/source_url/disclaimer/legend | text/text/text/text/text/nested | — | disclaimer='sourced-unverified' | Transcribed-by-eye caveat; B=600/A=700/S1=800 class caps corroborated |
| classes[].class/.cap | enum(text)/int | ref_class.name (probable) | B\|A\|S1 (only 3 of full ladder) | Class letter + display-PI ceiling |
| classes[].cars[].car | text | ref_car.full_name/display_name — token-reorder needed | 117 rows/108 distinct | Car id as transcribed ("Make Year Model" order) |
| classes[].cars[].code | text | — | `^\d{3} \d{3} \d{3}$`, unique/116 | Tune share code; 1 blank (illegible) |
| classes[].cars[].note | text | — | 55/117 empty | Build style/update-log annotation |
| classes[].cars[].tag | enum(text), optional | legend keys | meta(9)\|favorite(7)\|road(5) | Curator's pick category; absent 96/117 |
| tune-raw.json: schema_version/captured/note/inference_legend | text | — | — | Scope: raw sliders only where tuner published them; inferFocus() spec |
| tunes[].match_car | text | ref_car (loose, deliberately fuzzy) | — | Car name, no year |
| tunes[].class | enum(text) | ref_class.name domain | B (only value seen) | PI class letter |
| tunes[].code | text\|null | — | null in sample | Share code if published |
| tunes[].source/url | text | — | — | Attribution |
| tunes[].surface | enum(text) | — | 'road' (only value seen) | Intended surface |
| tunes[].raw.tire_psi_f/r | float | — | 26.0/26.0 | Tire tab cold pressure |
| tunes[].raw.final_drive | float | — | 3.81 | Gearing tab |
| tunes[].raw.gears | array float | should track ref_car.num_gears | len 7 in sample | Per-gear ratios descending |
| tunes[].raw.camber_f/r, toe_f/r, caster | float | — | caster single value | Alignment tab, degrees |
| tunes[].raw.arb_f/r | float | — | domain 1–65 | Antiroll Bars tab |
| tunes[].raw.spring_f/r | float | — | LB/IN | Springs tab |
| tunes[].raw.ride_f/r | float | — | inches | Ride height (nested in Springs tab) |
| tunes[].raw.bump_f/r, rebound_f/r | float | — | unitless 1dp Soft↔Stiff | Damping tab (NOT FH5 1-20 scale) |
| tunes[].raw.df_f/r | int | — | unit unconfirmed | Aero tab downforce |
| tunes[].raw.brake_bal / brake_press | int | — | % | Brake tab |
| tunes[].raw.diff_accel_f/decel_f/accel_r/decel_r | int | — | % | Differential tab |
| tunes[].raw.diff_center | int | — | % | AWD center split ("the 30/70 split") |
| tunes[].raw.drivetrain | enum(text) | ref_car.drivetype domain | AWD\|RWD\|FWD | As-tuned drivetrain |
| tunes[].raw.aspiration | text | probable ref_car.aspiration domain | 'Single Turbo' in sample | As-tuned forced induction |

---

### `progression-1` — owned-cars / meta-cars / progression / training-zone (4 files)

**Scale:** owned-cars.json 66,539 B, 285 cars + 26 owned_meta_ids. meta-cars.json 127,425 B, 53 cars (39 with tunes[], 153 sources[] refs/30 slugs, 21 also_viable_in, 1 real share_codes entry, 1 slider_ranges capture). progression.json 16,070 B, 5 roadmap phases, 6 methods, 1 exclusion, 4 multiplier rows. training-zone.json 86,974 B, 5 corner_types→10 phases→12 leaf entries (33 ratio pairs, 25 telemetry refs) + 5 singleton doctrine sections incl. a 36-tick friction timeline.

**Confidence:** verified

**Key structure:** Four different keying schemes. owned-cars.json cars[]: no id field, natural composite (manufacturer,model,year) verified unique/285; owned_meta_ids[] separate FK list. meta-cars.json cars[]: explicit PK `id` slug, unique/53. progression.json: mostly singleton blocks; row arrays are methods[] (PK id) and roadmap[] (PK phase 1–5). training-zone.json: deep nested content tree, no overarching key; small internal lists key on id (corner_types[].id etc.), most of the file is singleton doctrine addressed by JSON path only.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| owned-cars.json: $.schema_version/.captured/.owner/.total_in_game/.source/.ratification_note/.count_reconciliation | mixed text/int | — | total_in_game=337 | File metadata; 337 in-game vs 285 unique (52 = dup copies) |
| cars[] .manufacturer/.model/.year | text/text/int | (manufacturer,model,year)→ref_car / meta-cars.json cars[].name+year (no explicit FK) | year 1955–2024 | Natural composite key, verified unique/285 |
| cars[].class | enum(text)\|null | same domain as meta-cars/pi_classes | D,C,B,A,S1,S2,R,X, null(2) | PI class badge as shown in-game |
| cars[].pi | text (numeric string!) | same PI scale, type mismatch vs meta-cars int fields | '100'–'998', null(2) | PI value AS TEXT, not int |
| cars[].rarity | enum(text) | — | 13 raw values incl. suffix clauses | In-game rarity tier, ad hoc free text |
| cars[].fe / .multiple_copies | bool/bool | — | — | Forza Edition flag; multiple-copies flag |
| cars[].added / .note | text opt/opt | — | added 38/285, note 8/285 | Append-log date; disambiguation note |
| $.owned_meta_ids[] | array text (26) | meta-cars.json $.cars[].id (26/26 verified resolve) | — | Which meta picks this player owns |
| meta-cars.json: 16 doctrine top-level keys | mixed | — | — | pi_classes = authoritative D–X band table (int-range strings); disciplines master enum (7); acquisition_difficulty_scale; tune_sourcing_policy (4-level confidence enum); one-off write-ups |
| cars[].id (PK) | text kebab-slug | referenced by owned-cars owned_meta_ids | 53 unique | Unique car identifier |
| cars[].name/.year/.class | text/int\|null/enum | class→$.pi_classes | class incl. compound 'D-B','A-S2' (not clean enum) | Display name, model year (null 5/53), PI class |
| cars[].disciplines[] | array enum(text) | $.disciplines master list | subset of 7; road 31 dominant | Which disciplines this pick targets |
| cars[].drivetrain_stock/.recommended_drivetrain/.power_split | text/text/text | — | power_split present 35/53 (AWD) | Factory vs recommended drivetrain, often w/ embedded doctrine text |
| cars[].price_credits/.price_note | int\|null/opt text | — | null 18/53 | Autoshow price; disputed-price note 5/53 |
| cars[].acquisition/.acquisition_difficulty/.acquisition_disputed | text/enum/bool opt | — | easy(36) medium(12) premium(4) hard(1) | Path to obtain + tier + 1 contested flag |
| cars[].tier/.value_rating/.confidence | enum/int/enum | — | tier S(27)A(24)B(2); rating 3–10; confidence verified(40)probable(10)contested(3) | Meta ranking, value score, corroboration level |
| cars[].upgrade_priority[] | array text (~3/car) | — | free text | Ordered upgrade-first list, prose |
| cars[].tune_baseline{} | nested obj\|null | — | non-null 7/53 | Small starting-tune slider subset |
| cars[].slider_ranges{} | nested obj, 1/53 | corroborates project's slider-range doctrine | — | Full [min,max] per slider, ONE car (gr-supra-2020) |
| cars[].why/.use_case/... 8 note fields | text, sparse | easy_alternative names another car informally (not FK) | — | Sales pitch, one-liner, ad hoc caveats |
| cars[].sources[] | array text (30 slugs, 153 refs) | VERIFIED FK → data/sources.json $.sources[].id | avg 2.9/car | Coarse car-level citation list |
| cars[].tunes[] (39 cars) | array nested obj | source is free text, NOT an FK (finer-grained than sources[]) | confidence: sourced-unverified(33)/method(5)/suspect(1) | Per-tune {code,surface,source,confidence,note,method,player_verified,class,source_url,checked} |
| cars[].share_codes[] / .share_codes_retracted{} | array/dict — VESTIGIAL | — | 1 real entry project-wide | Legacy citation slot, superseded by tunes[] |
| cars[].also_viable_in[] | array {class,discipline,evidence} | class/discipline → headline enums | 21 entries/10 cars | Secondary competitive class/discipline combos |
| cars[].autoshow/.stock_pi/.beginner_pick/.tune_meta | bool/int opt/bool opt/enum opt | — | stock_pi 2/53; beginner_pick 2/53 | Purchasable flag; factory PI; 2 flagged beginner picks; tag {meta,favorite,road} |
| progression.json: $.exclusions[] | array {what,why_excluded,confidence} | — | confidence=verified | Excluded methods (credit-dup glitches) |
| $.roadmap[] | array (5), PK phase | — | phase 1–5 | 5-phase progression roadmap, 17 action bullets |
| $.credit_multiplier_stack{} | nested singleton | — | bonus_pct 10–15 | CONTESTED modifier stack, ~50% approx total |
| $.methods[] | array (6), PK id | — | type: active/passive/modifier/weekly | Core progression methods w/ yield, rate, requirements |
| methods[].setup{} | nested, no fixed shape | — | — | Per-method config bag (cars, perks_priority, eventlab_codes, etc.) |
| training-zone.json: $.tab_order[] | array enum (9) | canonical for rack.primary/secondary, ratio_doctrine.pairs.tab | TIRES..DIFFERENTIAL | 9 in-game tune tabs |
| $.ratio_doctrine.pairs[] | array (13) {tab,pair,ratio,magnitude} | tab→$.tab_order | — | Front:rear pair; what ratio vs magnitude controls |
| $.spectrum.stations[] / $.conditions.checks[] | array(3)/array(4) | — | ids fixed | Grip↔slide framework; pre-drive condition checks |
| $.corner_types[]→.phases[]→.entries[] | 5-level nested tree, 5→10→12 | rack.primary/secondary→$.tab_order | visual.loose∈{rear,all,front,none,limit} etc. | Deepest content: feeling/mechanism/visual-diagram/slider-fix per corner-phase lesson |
| $.grip_science/.controllability/.chassis_character/.braking_science/.friction_diagnosis | 5 large singleton doctrine sections | your_run.timeline conceptually same domain as daemon SSE frames, not sourced from it | your_run.timeline state∈{calm,rear,spike,front,both} | Deep physics-coaching content; friction_diagnosis holds a captured 36-tick per-wheel timeline |

---

### `progression-2` — wheelspin-cars / touge-guide / drift-guide / eliminator-tips (4 files)

**Scale:** 138,382 B total. wheelspin-cars.json 14,173 B/50 records (10 FE + 40 wheelspin). touge-guide.json 26,803 B/12 sections (meta_cars 16, events.list 5, build_attributes 9, codes.attributed_unverified 6, sources 13). drift-guide.json 22,215 B/14 sections (scoring_mechanics.mechanics 12, drift_tuning.slider_map 13, test_queue 11, meta_cars 5, player_zone_log 1). eliminator-tips.json 33,191 B/12 sections (tips 19, mechanics 12, car_levels.levels 10 w/ 3 band-placeholders, playbook.steps 9, patch_history 4, retracted 3).

**Confidence:** verified

**Key structure:** No global PK — 4 independent whole-file objects with named sections. mechanics[]/tips[] (eliminator) and scoring_mechanics.mechanics (drift) carry a stable text-slug `id` as real PK. meta_cars[] arrays have no id — natural key = (manufacturer,model,year) or just (name) for drift-guide. car_levels.levels[] keys on `level` int but 3/10 are band-placeholders. Most small guidance arrays have no id at all, positional only.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| wheelspin-cars.json: \_note/rarity_note/fe_count_estimate | text | — | — | Membership-verification methodology; verified FE canon=8, garage holds 10 |
| sources (top-level array) | array text (6) | — | — | Full URLs, file-level not per-record |
| forza_edition[]/wheelspin_exclusive[].manufacturer/.model/.year | text/text/int | candidate FK by composite, no numeric id present | year 1968–2021 | Car identity |
| forza_edition[].rarity | enum(text) | — | always 'Forza Edition' (10/10) | Constant tier |
| wheelspin_exclusive[].rarity | enum(text) | — | Legendary(13) Epic(25) Rare(2) | RNG pool rarity |
| .meta_note / .confidence | text/enum | — | verified/probable (FE 8/2; wheelspin 27/13) | Class/PI notability note + trust |
| touge-guide.json: confidence_legend/overview | nested obj | — | verified,probable,inference,flag-unverified | 4-value vocab; mode definition + leaderboard caveats |
| events.list[] (5) | array | region candidate FK to a map store | class∈{B×2,A,S1,S2} | Named touge pass: name/region/class/cap/length_mi/laps/direction/character/unlock/lean/lean_confidence |
| meta_cars[] (16) | array | (manufacturer,model,year) join key | class∈{A,B,S1,S2} | Per-class recommended cars, no numeric id |
| build_attributes[] (9) | array {attribute,guidance,why,confidence} | — | 9 fixed subsystems | Touge-specific slider guidance, numeric ranges embedded in prose |
| technique[]/overtaking[]/settings[]/mistakes[] | arrays 6/3/6/4 | — | mistakes[] has NO confidence field | Phase tips, passing tips, assist settings, symptom→cause→fix |
| codes.attributed_unverified[] (6) | array {car,class,code,tuner,why,confidence} | — | code = `### ### ###` or search-string | Community-sourced, single-source/untested share codes |
| drivetrain_verdict/community_consensus/research_state | text/text/{as_of,next_actions[]} | shared shape w/ eliminator's research_state | — | Synthesis + open TODOs |
| sources (13, full URLs) | array text | — | — | Unlike eliminator's short tags |
| drift-guide.json: concept/scoring/failure_modes/settings_checklist/practice_drill/tune | mixed | — | formula = descriptive text, not computable | Physics explainer, scoring formula, 2 failure modes (no confidence field), 5 checklist strings |
| meta_cars[] (5) | array | — | class∈{S1,A,B}; get∈{easy,medium} | Single combined `name` (not split mfr/model); price_credits+acquisition unique to this file |
| scoring_mechanics.mechanics[] (12) | array {id,name,tier,facts} | — | 7-value tier vocab (corroborated, contested, etc.) | Deep mechanics dive, dated 2026-08-10 |
| drift_tuning.slider_map[] (13) | array {slider,setting,phases[],why,tier} | phases⊂{initiation,angle,hold,transition,exit} | 13 fixed slider names | Which drift phase each slider matters in |
| drift_tuning.awd_drifting / .parts | nested obj (singleton) | — | — | AWD build guidance; per-part free-text notes |
| player_zone_log[] (1) | {date,zone,car,score,video_findings,coaching,doctrine_link} | — | — | First-hand play-session log entry |
| eliminator-tips.json: confidence_legend/mode_overview | nested | — | verified,probable,contested (3-value) | Per-sub-fact confidence tagging inside dicts |
| mechanics[] (12) | array {id,name,detail,confidence,sources[],note?} | — | id = stable slug | Mode mechanics; sources[] are short tags not URLs |
| car_levels{note,confidence,levels[10]} | array | — | levels 4,6,8 = band placeholders | Level 1-10 drop ladder; must band-collapse {3,4}{5,6}{7,8}{9,10} |
| tips[] (19) | array {id,phase,tip,why,confidence,sources[]} | — | phase: early/mid/general/h2h/final(5 values) | Phased strategy tips, largest array in store |
| patch_history[] (4) | array {date,event,confidence,sources[]} | — | all confidence=verified | Dated changelog |
| retracted[] (3) | array {what,why} | — | no id/confidence at all | Debunked claims log |
| where_to_drop{verdict,usable_guidance[4]} | text/array | CROSS-STORE: unresolved by `tracks/brio/trackroutes/eliminator_locators.nt` (100 numbered live-install drop points, not cross-referenced) | — | "VERIFIED NEGATIVE" — no public source names a drop spawn |
| playbook{note,steps[9]} | array {phase,action,confidence} | — | phase = mixed clock/stage labels | One timed match run-through |
| research_state | {as_of,next_actions[4]} | shared shape w/ touge | — | Open in-game-verification TODOs |

---

### `tuning-test-battery.json`

**Scale:** 110,047 B, 18 top-level sections. Populated: static_tests=3, dynamic_tests=8, instrumentation=4, symptom_matrix=10, course_fitting.archetypes=5, class_fitting.rules=3, build_forensics.instruments=5, build_forensics case studies=4, telemetry_case_files.cases=4, results_log.rows=0 (empty).

**Confidence:** verified

**Key structure:** No single PK for the whole file — a hand-authored document read/written wholesale. Four islands carry real per-record keys: static_tests[].id (3), dynamic_tests[].id (8), instrumentation[].id (4), build_forensics.instruments[].id (5) — short kebab-case strings. telemetry_case_files.cases is dict-keyed by a car+tune slug (4 keys). results_log designed to be keyed (car+slider+date) but currently 0 rows. build_forensics.case_study/_2/_3/_4 keyed only by ordinal-suffixed dict key, no field inside doubles as key. symptom_matrix, course_fitting.archetypes, class_fitting.rules have no key at all.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| schema_version/created/purpose/confidence (top) | text | — | — | Mission statement; battery is method-designed but untested as a whole |
| lab_conditions | nested obj, 7 fixed fields | — | — | Testing-discipline paragraphs (rivals_is_the_lab, one_variable, bisection, etc.) |
| instrumentation[] (4) | array {id,what,status,use,sample_data} | referenced only informally in prose | id∈{perf-panel,telemetry,rivals-ghost,drag-times} | 4 measurement instruments; sample_data only on 'telemetry' |
| test_zero | nested singleton | — | EXECUTED 2026-08-11 | Sensitivity sweep: panel_VISIBLE[6]/panel_INVISIBLE[4] partition + bonus_rows |
| static_tests[] (3) | array {id,name,sliders[],measure,procedure,pass,fail_symptom,confidence} | sliders[]→probable tuning-variables.json (unvalidated) | id∈{aero-window,braking-floor,gearing-envelope} | Zero-driving tests from Performance panel |
| dynamic_tests[] (8) | array, same family + venue,limit_finding | sliders[] direction-annotated, same probable FK | id∈{hot-pressure,camber-temp,braking-stability,rotation-entry,rotation-exit,compliance-kerbs,high-speed-stability,lap-supertest} | Rivals-driving bisection tests |
| symptom_matrix[] (10) | array | verify_test → static/dynamic_tests[].id, sometimes compound "+" refs | phase∈{entry,mid,exit,braking,any,straight,kerbs} | Feel→primary/secondary/tertiary slider fix |
| course_fitting | {note,archetypes[5]} | dominant_tests[]→test ids (loosely, some annotated) | 5 archetypes | Which tests dominate per course type |
| class_fitting | {note,rules[3]} | — | PI band baked into prose | How PI class biases test-window placement |
| cornering_envelope | nested singleton | — | model: latG(v)=a+b·v² | Converts panel's 2 lateral-G readouts into full corner-speed curve |
| capture_protocol | nested singleton | — | core_3[3] | Minimum-screenshot build-reconstruction protocol |
| results_log | {instructions,example_row,rows:[]} | example_row.test→test ids; .slider→tuning-variables.json | rows[] EMPTY (0) | Designed deliverable sink; currently unused — real findings live only as prose elsewhere |
| build_forensics (~15 flat doctrine fields) | text paragraphs | — | — | Half the file's bytes; no shared schema across fields |
| build_forensics.instruments[] (5) | array {id,priority,when,what,status} | — | priority mixed int/float incl. 2.5 | Data sources for reconstructing a locked tune |
| build_forensics.case_study.._4 (4) | non-uniform nested obj | — | — | 4 real-car replication diaries (Viper GTS ACR, Alfa 4C, Viper ACR 2016, Centenario); NOT normalized |
| ...targets{} | nested obj, numerically clean | — | pi,power_hp,torque_ftlb,weight_lb,top_speed,zero_sixty,front_pct,mech_balance,aero_balance,latG,radar{6} | Panel readouts per case, one clean numeric family |
| ...sliders{} | nested obj, mixed types | probable tuning-variables.json FK | diff_front/rear=[accel%,decel%] pairs | Axle-paired slider readouts; some values are annotated TEXT not numbers (data-quality flag) |
| telemetry_case_files | {date,method,cross_build_discovery,cases{}} | cases keys: 4 car-build slugs | — | Batch telemetry diagnosis; numeric deltas live in prose, not fields |
| data_out_instrument | nested doc | — | — | Live FH6 UDP telemetry integration spec |
| ...first_capture.CarClass | text | — | D=0,C=1,B=2,A=3(confirmed),S1=4,S2=5,X=6 | Decoded CarClass int from observed frame |
| ...first_capture.cars_seen{} | dict, key=CarOrdinal string | probable FK to Data_Car (unconfirmed by this store alone) | 3 entries | Cars driven during first capture |
| ...peak_percent_proof.result | text | — | Peak%=|CombinedSlip|×100 | Verified formula for Friction page readout |

---

### `rebuild-logs`

**Scale:** rebuild_service.log 3,015 B / 62 lines (1 banner + 57 [watch] + 4 [rebuild]). rebuild_service.err 0 B / 0 lines. Both born 2026-09-03 03:23:18; log still being appended past its last embedded time (05:26:06) as of mtime 11:54:46. Physically under `data/logs/`, alongside the JSON stores documented above — the only non-JSON member of this group.

**Confidence:** verified

**Key structure:** No key at all — append-only unstructured stdout capture, not a record store. Nearest thing to a key: (a) line-append order (only fully reliable ordering), (b) for [rebuild] lines only, the embedded HH:MM:SS. Verified by reading `scripts/rebuild_service.py` end to end, every `print()` matched 1:1 to a line shape present.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| line_type | enum | — | startup_banner(1)\|watch_change(57)\|rebuild_result(4) | Which of 3 fixed line shapes, discriminated by literal prefix |
| startup_banner.port | int | — | observed 8001 | Bound TCP port |
| startup_banner.root | text (abs path) | — | — | Worktree root operating on |
| startup_banner.endpoints | text (fixed) | — | constant | "(POST /rebuild · GET /status · GET /watch)" |
| watch_change.files | array text | filenames present in dashboard/v2/ at poll time | *.{html,js,css} | Symmetric-diff of (filename,mtime) sets between poll ticks — fires per changed tick, not per-save |
| watch_change.timestamp | MISSING | — | n/a | No embedded time at all for [watch] lines — genuine gap |
| rebuild_result.why | text, freeform, ≤80 chars | echoes JSON POST `why`; UI only sends 'manual' or "(downloaded tune\|new save) \<ts\>" | observed 4 values don't match either UI form | All 4 observed rows are dev-loop manual-curl noise, not real triggers |
| rebuild_result.rc | int | — | 0=success (all 4 observed=0); nonzero=failing step's exit code | Combined 2-step pipeline return code |
| rebuild_result.wall_s | float, 1dp | — | observed 4.1–31.6 (doc estimate ~9.5) | Wall-clock duration; real runs vary well beyond documented estimate |
| rebuild_result.hhmmss | text, local time | — | HH:MM:SS, no date/tz | The ONLY timestamp field in this store; finish time of the run |

---

## Raw corpus

### `RAW-01-gamedb` — FH6_Database.sqlite

**Scale:** 13,328,384 B (13.3 MB), 205 tables, 137,772 total rows. 32 tables empty. Largest: List_UpgradeDrivetrainTransmission 4,986, List_UpgradeTireCompound 6,590, List_SpringDamperPhysics 5,414. Zero BLOB columns anywhere — all scalars.

**Confidence:** verified

**Key structure:** No SQL-level keys anywhere (0 indexes/triggers/views/declared PKs — flat CSV-like export). Every table has a de-facto key by convention (spot-checked: COUNT(*)==COUNT(DISTINCT key)). `Data_Car.Id` (660 rows, 247–4342) = the car ordinal used project-wide as `ref_car.ordinal`, reappearing under different column names in ~150 tables. `Data_UpgradePart.TableName` + `Data_UpgradePartCategory.FieldName` together say which column in each of 46 List_Upgrade* tables is the FK back to Car/Engine/Drivetrain/CarBody/Motor — itself data, not schema.

| Table | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| Data_Car | table (151 cols) | MakeID→List_CarMake.ID; ClassID→CarClasses.Id; FamilyModelID/FamilyBodyID; StockWheelID→List_Wheels.ID | ClassID 0–7 | Central car table; CurbWeight stored ÷100 scale (verified); no direct engine/drivetrain/body FK, found via List_Upgrade* WHERE key=Id AND IsStock=1 |
| Data_CarBody | table (19 cols) | targeted by ~15 List_UpgradeCarBody* tables (casing inconsistent) | — | Body/chassis geometry, meters |
| Data_CarBody_DummyAxle | table (3 cols, 5 rows) | — | — | Per-body axle-position overrides |
| Data_Engine | table (24 cols, 670 rows) | ConfigID→List_EngineConfig; CylinderID→List_Cylinders; VariableTimingID; AspirationID_Stock→List_Aspiration | — | Engine catalog, literal EngineName |
| Data_Drivetrain | table (4 cols, 662 rows) | DrivetypeID→List_DriveType.ID; ShiftSystemID→List_ShiftSystem | DrivetypeID 1,2,3 | Minimal drivetrain shell |
| Data_Motor | table (12 cols, 19 rows) | TorqueCurveFullThrottleID→List_TorqueCurve | — | EV/hybrid motor catalog, only 19 rows total |
| Powertrains | table (6 cols, 8 rows) | DrivetrainId; EnginePlacementId→List_EnginePlacement | — | 8 UI powertrain-layout archetypes |
| CarClasses | table (11 cols, 8 rows) | — | Id 0–7=D..X | VERIFIED full class ladder incl. MaxDisplayPerformanceIndex 400–999 |
| CarRarities | table (2 cols, 767 rows) | CarID→Data_Car.Id (partial) | — | Rarity tier; more rows than Data_Car |
| CarDetails | table (10 cols, 33 rows) | — | — | UI metadata for 33 sortable car-list columns |
| CarBuckets | table (4 cols, 49 rows) | self-ref ParentBucketId | — | Named car groupings/hierarchy |
| Data_Car_Buckets | table (3 cols, 644 rows) | CarId→Data_Car.Id; CarBucket→CarBuckets.Id | — | Membership join |
| CarTrackOffsets | table (5 cols, 77 rows) | — | — | Track-width visual offset deltas |
| CarPartNames | table (2 cols, 6 rows) | — | 6 slots | VERIFIED literal exterior part-slot lookup |
| CarPartPositions | table (6 cols, 2413 rows) | Ordinal→Data_Car.Id; PartId→CarPartNames.ID | ID=Ordinal*1000+PartId | 3D scene-anchor placement |
| CarExceptions | table (9 cols, 511 rows) | CarID→Data_Car.Id | — | Visual customization exclusion bools |
| CarColorTypeExceptions | table (5 cols, 0 rows) | — | — | Empty template (all TEXT-typed, no sample rows) |
| CarInvalidDefaultParts / CarInvalidUpgradePackage / CarUpgradeExceptions / CarVouchersExclusions / CarsDropParts / CarListFilters | small tables (1–9 cols, 0–6 rows) | mostly Data_Car.Id | — | Small per-car exception/blacklist tables |
| List_CarMake | table (8 cols, 90 rows) | CountryID→List_Country | — | 90 manufacturers, literal ManufacturerCode |
| List_CarType | table (2 cols, 3 rows) | — | — | 3-value enum, name unresolved |
| List_FamilyBody/Model/Special | 3 tables (2 cols, 46/36/5 rows) | targeted by Data_Car | — | Body/model/special family groupings |
| List_Country / List_Region | 2 tables (4/30, 2/3) | Country.RegionID→Region.Id | — | Country/region lookups |
| List_AeroStaticSystem | table (11 cols, 2 rows) | CarId | — | Active-aero exception, 2 exotic cars |
| List_DragWallSettingsOverride | table (6 cols, 2 rows) | CarId | — | Drag-limiter speed-wall override |
| AutoSteerOverrides/InAirBehaviourOverride/FreeRevOverrides/BackfireLevels/List_CarAudioEvents | small tables | Data_Car.AutoSteerOverrideID; Ordinal | — | Per-car physics/audio exception profiles |
| VoiceOfCarTriggers | table (4 cols, 60 rows) | CarId; MakeId | — | VERIFIED Forzavista showroom voice-line triggers |
| CameraOverrides | table (30 cols, 641 rows) | CarId→Data_Car.Id | — | Per-car camera-rig offsets, all modes |
| AllIECars/BarnfindCars/PrizeCars/RentalCars/TrafficCars/MidnightCars/UnobtainableCars/FeaturedTilesOfflineCars/FixedLiveryCars/RecommendedCars | 9 tables | Data_Car.Id/Ordinal | 118/12/102/12/15/0/24/1/0/29 rows | Acquisition/gameplay-pool membership lists |
| HorizonRecommends | table (2 cols, 12 rows) | CarBuckets | — | Bucket→Anthem-event links |
| NewProfile_* (7 tables) | mostly 0 rows | — | — | New-save seed/reset schema templates (unpopulated) |
| Data_UpgradePart | table (8 cols, 50 rows) | TableName names another table; PartName→UpgradeTypes.PartName | — | VERIFIED routing table for all 46 List_Upgrade* tables |
| Data_UpgradePartCategory | table (8 cols, 5 rows) | — | Car/Engine/Drivetrain/CarBody/Motor | The 5 category archetypes + key-column names |
| Data_UpgradePartOrder | table (2 cols, 50 rows) | — | — | Canonical upgrade-slot ordering list |
| UpgradeAreas/UpgradeAreaForUpgradeType/DisplayScenarioForUpgradeArea | 3 tables (11/75/11 rows) | — | — | Shop-tab hierarchy and menu layout |
| UpgradeTypes | table (9 cols, 53 rows) | — | 53 PartName values | VERIFIED full upgrade-part-type list |
| Upgrades | table (10 cols, 248 rows) | TypeId→UpgradeTypes.id | — | VERIFIED (TypeId,Level)→display-name lookup |
| UpgradeEverymanOptions/UpgradeWizardParts/PartsRemoval/PowerRemoval | 4 tables (1/87/30/17 rows) | — | — | Auto-tune-to-PI wizard config |
| UpgradePresetPackages | table (57 cols, 448 rows) | Ordinal→Data_Car | ~48 int cols, one per UpgradeTypes.PartName | Named preset builds; per-slot target Level |
| List_PartManufacturer | table (3 cols, 739 rows) | referenced by ManufacturerID across upgrade tables | — | Aftermarket brand catalog |
| List_PartAttribute | table (6 cols, 546 rows) | — | — | Generic (manufacturer,attribute) pricing/mass table |
| List_PartsStrings | table (2 cols, 136 rows) | referenced by PartsStringID | — | VERIFIED literal (not StringID) short labels |
| HydraulicCarGroups | table (3 cols, 11 rows) | CarId | — | Hydraulics feature groups |
| List_Upgrade* family | 46 tables, shared shape | key col→Data_Car/Engine/Drivetrain/CarBody/Motor; physics FKs→physics-band tables | Levels -1/0..N | The bulk of the upgrade system, one row per purchasable tile |
| List_SpringDamperPhysics | table (46 cols, 5414 rows) | targeted by List_UpgradeSpringDamper | — | Suspension min/def/max physics bands |
| List_AntiSwayPhysics | table (7 cols, 3072 rows) | targeted by List_UpgradeAntiSway* | — | Sway-bar stiffness band |
| List_AeroPhysics | table (24 cols, 1726 rows) | targeted by RearWing/CarBodyFrontBumper | — | Drag/downforce slider endpoints |
| List_BrakeProfile/List_BrakeType | 2 tables (35/5 rows) | targeted by List_UpgradeBrakes | Drum/Disc/Drilled/Slotted/Carbon | Brake physics + VERIFIED 5-value type enum |
| List_SuspensionPhysicsType/List_SuspensionType | 2 tables (94/6 rows) | SpringDamperPhysics.SuspensionPhysicsTypeID | Leaf,Torsion,Strut,Wishbone,Multilink,Trailing | VERIFIED 6-value suspension type enum |
| List_SteeringSettings/List_RearSteeringSettings | 2 tables (7/9 rows) | — | — | Steering-response curve profiles |
| List_ThirdSpringElement/List_PreloadAndDroopDamper | 2 tables (9 rows each) | targeted by List_UpgradeSpringDamper | — | Rare heave-spring/droop-clamp rigs |
| List_TractionControl | table (41 cols, 10 rows) | — | — | 10 TC profiles by drivetrain/surface |
| List_DamageModDef | table (13 cols, 11 rows) | — | — | 11 damage-model profiles |
| List_DrivingMode | table (38 cols, 13 rows) | — | — | 13 named drive-mode presets, physics preset layer above tune sliders |
| List_VariableTiming | table (2 cols, 3 rows) | Data_Engine.VariableTimingID | None,VTEC,Variable Timing | VERIFIED 3-value enum |
| Combo_TireBrandCompound/List_UpgradeTireCompoundFictionModOverride | 2 tables (30/4 rows) | — | — | Brand×compound multipliers; 4-row friction override |
| List_TireCompound | table (123 cols, 41 rows) | FrictionMultiCurve*ID/AffectCurve*ID→curve tables | — | VERIFIED deepest single physics table — friction/wear/heat model |
| List_TyreCurveDB | table (95 cols, 41 rows) | TireCompoundID | — | Second per-compound physics table, 1:1 w/ List_TireCompound, relationship unresolved |
| List_TireFrictionCurve/MultiCurve/AffectCurve/List_TorqueCurve | 4 curve tables | MultiCurve.CurveID0/1→FrictionCurve; TorqueCurve targeted by Data_Motor/List_UpgradeEngineCamshaft | v0..vN sample points | Flattened variable-length curve storage; TorqueCurve already imported |
| List_Wheels | table (17 cols, 1248 rows) | — | — | VERIFIED rim catalog; Mass is ABSOLUTE not delta (documented gotcha) |
| WheelCategories/WheelAnnotations | 2 tables (5/1054 rows) | WheelAnnotations.WheelID→List_Wheels.ID | 5 shop tabs | Rim shop-tab placement |
| WheelNormOffsets | table (2 cols, 111 rows) | — | — | Per-rim-diameter visual offset |
| WheelLayouts/ControllerLayouts | 2 tables (5/16 rows) | — | — | NOT car wheels — input-peripheral button mappings |
| List_ColorClass/ColorFinish/MaterialType/SpecialColors/LiveryMaterials | 5 tables | — | ColorFinish: Normal,Metallic,CarbonFiber | Paint/livery material catalogs |
| LicensePlateCharacters | table (8 cols, 60 rows) | — | — | 60-glyph plate character set |
| LiveryStripes/Categories/Decals/DecalsSortOrder/VinylNames/VinylsDecals/MismatchedLiveryImportVinylsAndDecals | 7 tables, 2–19,649 rows | DecalsSortOrder.MakeID→List_CarMake.ID | — | Full paint/decal asset catalog; DecalsSortOrder is largest table in DB |
| PaintableGroups | table (10 cols, 40 rows) | Ordinal→Data_Car | — | Named paintable-zone definitions |
| TeamColors/AIPlayerColors | 2 tables (4/25 rows) | — | — | MP team + Drivatar AI paint colors |
| AIDrivingBehaviorObservation* family (5 tables) | Bayesian model shape | AIPlayerId (likely distinct id space) | — | Drivatar learned-behavior model + Bayesian belief params |
| AIDynamicLineObservations/AILineChoices/AIMistakeScales_*/AITemperaments | 5 small tables | CarClassId/TurnTypeId | — | AI line-choice/mistake-probability tuning |
| DrivatarTestingAIPlayers/ObservationDefaults | 2 tables (88/89 rows) | — | — | VERIFIED QA test-harness AI roster |
| Tracks | table (47 cols, 58 rows) | EnvironmentId→Environments | — | 58 circuits/routes |
| Environments | table (20 cols, 91 rows) | targeted by Tracks.EnvironmentId; CountryId | MapX/MapY REAL | 91 map regions, world-map pin coords |
| CareerRaceCollectionTypes/EventBlueprintFlyer*/EventBlueprintHorizonSpecials/List_HopperBackgroundImages/List_HopperEventIcon | 7 tables (0–35 rows) | — | — | Event/UI metadata |
| ContentOffers/ContentOffersMapping/OnDiscContent/XboxMusicSettings | 4 tables (1–621 rows) | — | — | DLC/store catalog; confirms cross-platform (Steam) build |
| SkillTypes | table (2 cols, 88 rows) | — | 88 literal values | VERIFIED full stunt/skill-score enum, zero downstream consumers |
| List_Unlocks | table (2 cols, 4 rows) | — | — | Tiny progression-gate enum |
| PlayerCharacters/PlayerNames | 2 tables (14/1709 rows) | — | — | Avatar presets + Drivatar/NPC name bank (no real PII) |
| VersionInfo | table (1 col, 1 row) | — | — | Export/schema version stamp |

---

### `RAW-02-gamedb-dup` — "full forza DB - Copy.db"

**Scale:** 13,328,384 B, identical to RAW-01. 205 tables, 137,772 rows, identical distribution. SQLite pragmas identical (page_size=4096, page_count=3254, freelist_count=0).

**Confidence:** verified

**Key structure:** No independent key structure — full-file duplicate of RAW-01; same PK/FK list per table.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| (entire database — all 205 tables/columns) | nested obj, identical to RAW-01 | RAW-01-gamedb — same keys, joins throughout | 205 tables, 137,772 rows | Byte-for-byte content identical via full-hash match; ONE differing byte in the whole file (offset 44, schema-cookie: 205 vs 1) — no page reorganization, just a header stamp from a re-save tool |

---

### `RAW-03-forzatech` — ForzaTech.Studio.zip

**Scale:** 29,319,712 B, 141 zip entries (126 Deflate + 15 Store/dir-markers), 89,175,098 B uncompressed. root 32/libs 62/docs 16/Materials/examples 20 (empty)/Assets 6/Presets 5. LightHashMap JSON row counts: FH3=95, FH4=73, FH5=101, FH6=73 (342 total). App: "ForzaTech Studio" v0.9.2.2, .NET9/win-x64, WinUI3, dev D3FEKT.

**Confidence:** probable

**Key structure:** No relational key at top level — the whole zip is one record. Per-entry key = zip path (e.g. `libs/SharpDX.dll`). Inside `Presets/LightHashMap_<Game>.json`, effective key = `Name` (modelbin filename); `Hash` (32-bit hex) exists only in FH5/FH6 files, absent entirely in FH3/FH4.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| zip_entry.filename | text | none, internal only | 141 entries | Relative archive path |
| zip_entry.file_size / compress_size | int | — | 0–24,877,600 | Uncompressed/compressed byte lengths |
| zip_entry.compress_type | enum(int) | — | 0=Store(15,dirs) 8=Deflate(126) | Compression method |
| zip_entry.date_time | datetime | — | 2024-11-11 to 2026-06-26 | Packaging timestamp |
| zip_entry.CRC32 | int | — | — | Integrity checksum |
| root_app_runtime (32 entries) | blob group | — | — | Exe, WinUI3/.NET9 runtime, Xbox codec DLLs (granny2/xcompress64/xg) |
| libs/ (62 entries) | blob group | — | — | .NET assemblies + first-party ForzaTools.Bundles.dll/ForzaTools.Shared.dll (the real parsers) |
| docs/*.md (16 files) | text (Markdown) | — | — | Tool's own manual — where the real format schemas live |
| Assets/ (6) | blob group | — | — | UI chrome only |
| Materials/examples/ (20) | empty dirs + .gitkeep | — | — | Scaffolded, unpopulated feature |
| Presets/LightHashMap.Name | text | soft filename-convention match to .carbin model paths | — | Target modelbin filename |
| Presets/LightHashMap.Hash | text hex | same scheme as .str Hash ID, unconfirmed | FH5/FH6 only | Runtime lookup hash |
| Presets/LightHashMap.RawBytes | text (hex bytes), opaque | writes into LightPresets.bin (present, undecoded) | ~80 B observed | Preset payload, undecoded byte layout |
| deps.json | nested obj | — | 177 library entries | Build/dependency manifest |
| runtimeconfig.json | small obj | — | — | Runtime/framework config |
| DOC: .str v0x0800 (FH6) | fixed binary layout | Hash ID scheme likely shared w/ LightHashMap.Hash | 0x0400 (older)/0x0800 (FH6) | Header→Table Block(Hash,Offset)→packed strings; explains project's game-strings/*.json origin |
| DOC: physicsdefinition.bin | fixed binary layout | matches raw-corpus physicsdefinition.bin (undecoded) | Type∈{Vehicle,Prop,Debris} | Collision geometry definition |
| DOC: .carbin CarScene | fixed binary layout | CCarPartsEnum plausible vs this project's UpgradeAreas/Types (unchecked) | 46 named enum values 0–45 | Header + StandardParts[]/UpgradableParts[] w/ Level/CarBodyID/BoundingBox |
| DOC: .swatchbin/.pb TXCB | fixed binary layout (Grub) | — | 19 named Encoding codes (BC1..Procedural) | Texture blob container |
| DOC: .minizip/PGZP header | fixed binary layout, explicit offsets | — | Flags: 0=Store,8=Deflate,21=LZX,22=Deflate+TFIT(unsupported) | NEW: full byte-offset spec; confirms method 22 unsupported even by author |
| DOC: MiniZipResourceType enum | enum(1 byte) | — | 0=pgeo..27=reserved | Asset-type/virtual-extension identifier |

---

### `RAW-04-importer` — importer/importer/ corpus

**Scale:** 39 files, 2,546,748 B: 22 .bt templates, 13 .py scripts, 3 real .modelbin instances (41,144/1,120,216/469,016 B), 1 .7z (76,037 B compressed/532,843 B uncompressed, 178 files). Largest: Bundle_grub.bt (88,663 B/2,113 lines).

**Confidence:** verified

**Key structure:** No row/table PK at corpus level — 39 independent files, identified by relative path. Each .bt template defines its own internal key (e.g. Bundle_grub.bt blobs keyed by FourCC tag+version in a 24-byte directory array; STR_StringTable.bt entries keyed by uint32 hash per section).

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| Bundle_grub.bt: FileHeader.tag | uint32 magic LE | — | 0x47727562 ('burG') | Identifies every .modelbin/.materialbin/.shaderbin/.swatchbin/.pb file |
| FileHeader.version | struct{major,minor} | — | 1.0 or 1.1 | Bundle format version, gates blob_count width |
| FileHeader.header_size/total_size/blob_count | uint32×3 | — | verified = exact on-disk file size ×3 | Header/total-file/directory-entry sizing |
| BlobHeader (×blob_count, 24-byte stride) | struct{tag,version,metadata_count,metadata_offset,data_offset,sizes} | metadata_offset/data_offset relative to bundle start | ~30 known blob tags (Skel,Mesh,VerB,IndB,MatI,TXCB...) | One directory entry per sub-asset |
| MetaData entries (per blob) | struct{tag,version,size,offset}+payload | TRef metadata → other .swatchbin by CRC-32(path) | tags: Name,TXCH,Id,BBox,TRef,ACMR,ATST,BLEN,VDCL | Small key/value annotations on a blob |
| common.py: Bundle/Blob/Metadata/Mesh/ModelBuffer classes | Python round-trip classes | imported by 4 other importer scripts | — | Independent executable re-implementation of the burG format, decodes real bytes |
| STR_StringTable.bt: header.version/name/section_count | mixed | — | version 3.0/4.0/8.0 (FM6/FH3/FH4/FH6) | .str table header |
| Section.entries[].{hash,offset} | uint32/int32 | combines w/ table_hash → project's `_&<u64>` id | — | Per-string directory entry |
| HashFunc()/table_hash | function/uint32 | — | rotl-7 XOR-fold over table filename | VERIFIED formula for the composite `_&<u64>` id's table-hash half — closes open project question |
| pvs.bt: PVSHeader.{magic,version,...} | uint32×4 | — | version 5–89 (FM2–FH3) | Legacy PVS scene-streaming header |
| CAFF/CAFF.bt: header | mixed | — | compression 0=none,1=zlib | Legacy 'Common Asset File Format' header (FM2-era, predates Grub) |
| FM3_FH1/col.bt, hex.bt, fiz.bt, filename_map.bt, pvsz_lookup.bt, sfs.bt | assorted legacy structs | col.Square↔fiz byte range; volume_entry links filename_map↔pvsz_lookup | — | Legacy world-collision/nav/streaming index family (FM1/FH1/FH2) |
| FM3_FH1/rmb_bin.bt, carbin.bt, FM1/carbin.bt, CarScene_carbin.bt | 4 distinct incompatible layouts | — | — | Historical car-scene formats; only CarScene_carbin.bt (v1.2) is current-gen |
| FM3_FH1/fxobj.bt, D3DBaseTexture.bt | Xbox360-era structs | — | — | Compiled shader resource; GPU texture tiling |
| FM1/decals.bin.bt, liveries.bin.bt | identical shape | — | — | Original-Xbox era resource-pack containers |
| Ms-Store/msixvc.bt: XvdHeader | 512-byte sig + ~0x3000 body | — | VolumeFlags bitfield | Microsoft's outer install-package container, one level above FH6's own files |
| Ms-Store/SegmentMetadata.bt / userdata.bt | small directory structs | file names correspond to unpacked msixvc payload | — | Install-manifest / small named-file container |
| DXBC.bt: DXBCHeader | public MS format | — | — | Generic compiled-shader container spec (not Forza-proprietary) |
| controlArm/*.py, wheel/modelbin_importer-*.py, etc. (importer scripts) | Blender import scripts | 2 (carbin_importer2.py, modelbin_importer2.py) are 1-line GitHub stubs | — | One-off geometry-extraction tooling |
| 3 real .modelbin instances | binary, 41,144/1,120,216/469,016 B | decoded by Bundle_grub.bt/common.py | blob_count 15/38/29 | VERIFIED worked examples; total_size field == exact file size in all 3 |
| FM5XO shader-source .7z | archive, 178 files/532,843 B uncompressed | — | — | Plaintext HLSL source tree, companion to DXBC.bt |

---

### `RAW-05-fh6helper` — "FH6 Helper_[unknowncheats.me]_.exe"

**Scale:** 1,848,320 B, PE32+ x64, 6 sections, 22 imported DLLs/262 functions, 0 exports, 1 resource (RT_MANIFEST). SHA256 `523b7224...`, MD5 `60f126b7...`. Linked 2026-05-24 00:58:47 UTC. Inspected read-only (never executed).

**Confidence:** verified

**Key structure:** No key, single blob. Only identifying handles: filename, computed hash (SHA256/MD5), and the PDB GUID+Age from the debug directory (`6CFD32AD-785F-48FF-91EF-E583FC5B1750`, Age=1) — a stronger "this exact binary" identifier than the hash alone.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| file identity (path/size/hashes) | nested obj | — | 1,848,320 B | Only handle on "which file is this" — no internal version resource |
| COFF FILE_HEADER.Machine | enum | — | 0x8664=AMD64 | Target arch |
| .NumberOfSections/.TimeDateStamp/.Characteristics | int/int/bitmask | — | 6; 1779584327=2026-05-24 00:58:47 UTC (matches PDB stamp — fresh, untampered build); 0x22 relocs-stripped | Build/section metadata |
| OPTIONAL_HEADER.Magic/.Subsystem | enum/enum | — | PE32+; 2=Windows_GUI | 64-bit, no console (overlay app) |
| .DllCharacteristics | bitmask | — | 0x8160 (ASLR+DEP, no CFG) | Loader mitigations |
| .ImageBase/.SizeOfImage/.SizeOfHeaders/.CheckSum | int×4 | — | CheckSum=0 (unstamped, local build) | Standard loader fields |
| .MajorLinkerVersion/Minor | int×2 | corroborated by CRT import set | 14.50 = VS2022/MSVC v143 | Toolchain identity |
| .AddressOfEntryPoint | int (RVA) | — | 0x159d68, inside .text | Confirms no packer |
| SECTION_HEADER (×6) | array | — | entropy: .text 6.52, .rdata 6.56, .data 2.39, .pdata 6.20, .rsrc n/a, .reloc n/a | No packing/encryption signature (would read >7.5) |
| IMPORT_DESCRIPTOR (22 DLLs/262 funcs) | array {dll,functions[]} | — | KERNEL32(92): OpenProcess/RWProcessMemory/VirtualAllocEx/CreateRemoteThread/Toolhelp32; USER32(46): GetAsyncKeyState/SetWindowDisplayAffinity; d3d11+dwmapi+D3DCOMPILER: DX11 overlay | Cross-process memory read/write/inject API set — classic external-cheat pattern |
| DIRECTORY_ENTRY_EXPORT | n/a | — | absent | Standalone EXE, not a DLL |
| VS_VERSIONINFO resource | n/a | — | absent | No ProductName/FileVersion via normal Win32 mechanism |
| RT_MANIFEST | text (XML) | — | requestedExecutionLevel=requireAdministrator | Demands elevation — consistent w/ cross-process VM rights |
| IMAGE_DEBUG_DIRECTORY[0].PdbFileName | text (abs path) | — | `...\FH6-DBDUMPER-master\bin\FH6 Helper.pdb` | Names the project (FH6-DBDUMPER) and author (Shishio) |
| .Signature(GUID)+Age | blob+int | canonical symbol-server key | `6CFD32AD-...`, Age=1 | Exact-build identifier |
| embedded string: Dear ImGui 1.92.8 | text literal | — | — | Statically linked DX11-backend overlay UI |
| embedded string: SQLite format 3 + VDBE opcodes | text literal | — | — | Full SQLite amalgamation statically compiled in |
| embedded string: workflow labels | text (enum-like set) | — | "Connected to forzahorizon6.exe", "CDatabase pattern not found", "Dump complete: {} tables", "Loaded_Database.sqlite" | Attaches to live process, scans for 'CDatabase' object, dumps to SQLite; also independent load/browse/edit of any .sqlite file |
| embedded string: DB-browser UI labels | text | — | `SELECT * FROM [{}] LIMIT 500 OFFSET {}` | Full cell-search/edit table explorer, 500 rows/page |
| embedded string: named cheat-button SQL | text (exact SQL strings) | table/column names below | — | One-click UPDATE/INSERT presets (Free Cars, All in Autoshow, etc.), backup-first convention |
| table/column names disclosed by SQL strings | text list | candidate match vs FH6_Database.sqlite (unverified diff) | Data_Car, CarBuckets, Profile0_Career_Garage, List_Wheels, UpgradePresetPackages | Cross-reference candidates for the game DB |
| embedded string: injection error strings | text | — | "Failed to allocate shellcode" etc. | Confirms active code injection, not passive scraping |
| embedded string: hotkey/credit, window class | text | — | "Made by Shishio \| INSERT = toggle"; "FH6HelperOverlay" | Author attribution (2nd confirmation); Win32 window class |
| non-findings | n/a | — | absent | No AOB signature string recoverable (binary/wildcard, needs disassembly); no auth/phone-home strings |

---

### `RAW-06-lapsmith` — LapSmith-Setup-0.2.2.exe

**Scale:** 93,274,563 B (93.3 MB). SHA256 `6022e541...`, MD5 `423c70d0...`. mtime 2026-09-02 03:35 (download); PE build timestamp 2026-02-11 11:40:27 UTC. ~872,192-byte PE32 SetupLdr stub (11 sections) + ~92.4 MB (99.1%) appended Inno-Setup overlay outside any declared section.

**Confidence:** locked_no_bypass

**Key structure:** No key, single blob at outer level (filename + SHA256). Internally splits into (A) standard PE32 image, offset 0–~871,936, addressable by normal PE keys, and (B) opaque Inno Setup 6.7.0 container, offset ~871,936–EOF — keyed internally by Inno's own ID-block→header→language/component/file-location tables, but that internal keying was NOT opened (deliberately, per do-not-run policy).

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| filename / file_size_bytes / sha256 / md5 | text/int/text/text | — | 93,274,563 fixed | Identity/integrity handles |
| PE.Machine / .TimeDateStamp / .Subsystem | enum/int/enum | — | 0x014C=I386(32-bit stub); 1770810027=2026-02-11 11:40:27 UTC; 2=GUI | SetupLdr stub metadata |
| PE.AddressOfEntryPoint/.SizeOfImage/.CheckSum | uint32×3 | — | SizeOfImage=929792 (stub only, not overlay); CheckSum=0 | Standard optional-header fields |
| PE.SecurityDirectory (Authenticode) | struct | — | both fields 0 = absent | NO code-signing certificate — unsigned |
| PE section table (11 rows) | array {name,VA,SizeOfRawData,PointerToRawData} | — | .text,.itext,.data,.bss,.idata,.didata,.edata,.tls,.rdata,.reloc,.rsrc | Delphi/Pascal-compiler layout (Inno is Delphi); spans only first ~872KB |
| VERSIONINFO.CompanyName/.ProductName | text | — | "LapSmith" | Publisher/product |
| .ProductVersion/.FileVersion | text | — | "0.2.2" | Version string |
| .FileDescription | text | — | "LapSmith 0.2.2 Setup - telemetry-driven tuning tool for Forz[a]" (truncated) | Self-identifies purpose |
| .LegalCopyright/.Comments/.OriginalFileName | text | — | "Copyright © LapSmith"; "...built with Inno Setup."; blank | Copyright, compiler self-ID, empty field |
| Resource dir: RT_ICON/GROUP_ICON/STRING/RCDATA/MANIFEST | PE resource entries | manifest lists comctl32/mpr/netapi32/netutils/textshaping/version/winhttp deps | dpiAware=true | Individual values not itemized |
| Inno ID marker #1 (offset 742156) | fixed ASCII | — | "Inno Setup Setup Data (6.7.0)" | Hardcoded version-check constant in stub |
| Inno Messages marker | fixed ASCII | — | "Inno Setup Messages (6.5.0)" | Bundled translation-table version tag |
| Inno container header (offset 92014516) | opaque compressed, unread | — | 2nd occurrence of ID string | Real header/ID block: AppId GUID, AppName, install directives, file-location table — NOT decompressed |
| Embedded payload (app exe/DLLs/config/registry/URL/license) | unknown, inside compressed overlay | — | — | Entirely unrecovered; 0 plaintext "LapSmith" occurrences outside version resource |
| Qt5/Qt6 byte substrings (2 offsets) | raw byte match, unconfirmed | — | — | Suggests possible Qt-based app; no surrounding context recoverable |

---

### `RAW-07-dbbrowser` — DB Browser for SQLite installer (.msi)

**Scale:** 19,857,408 B (18.94 MiB). OLE2/CFBF compound file, built by WiX Toolset 3.14.1.8722, 2024-10-15 07:54:56 UTC. 49 internal streams: 3 fixed OLE metadata + 37 MSI table streams + 9 embedded binary streams. Largest stream: Media.cab, 18,701,538 B (94%).

**Confidence:** verified

**Key structure:** Two-level nested key. LEVEL 1: CFBF directory keys every object by stream name — 3 fixed-literal names (0x05-prefixed: DigitalSignature, MsiDigitalSignatureEx, SummaryInformation); 46 objects use Microsoft's reversible obfuscated stream-name encoding (U+4840 marker = MSI table). LEVEL 2: rows inside each [TABLE] stream keyed by that table's own declared PK column(s) per standard Windows Installer schema.

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| ole_summary_title | text | — | constant "Installation Database" | Fixed for any MSI |
| ole_summary_subject/author/keywords/comments | text | — | "DB Browser for SQLite"; "...Team"; "Installer"; description | Package identity |
| ole_summary_template | text | — | "x64;1033" | Arch;LCID |
| ole_summary_revision_number | text (GUID) | — | `{1DEF8960-8E93-451C-835D-82BDC71B9FE4}` | MSI-overloaded field = PackageCode GUID |
| ole_summary_create_time/last_saved_time | datetime | — | 2024-10-15 07:54:56 UTC (both equal) | Build timestamp, built once never re-saved |
| ole_summary_num_pages/num_words | int/int(bitfield) | — | 405; 2 (compressed media) | MSI-specific reuse of OLE fields for engine version/install flags |
| ole_summary_creating_application | text | — | "Windows Installer XML Toolset (3.14.1.8722)" | Build toolchain |
| ole_summary_security | int(enum) | — | 0=none..4=RO-enforced; observed 2 | OLE security flag |
| cfbf_stream_name (mangled/decoded) | text | — | — | Level-1 PK; decoder verified against known MSI table names |
| cfbf_stream_kind | enum | — | META(3)\|TABLE(37)\|BLOB(9) | Stream role |
| cfbf_stream_size_bytes | int | — | 4 B (Icon) to 18,701,538 B (Media.cab) | Raw stream payload length |
| table_name (37 [TABLE] streams) | enum (37 distinct) | — | 5 system tables (_Columns,_StringPool,_StringData,_Tables,_Validation) + 32 stock install tables | All stock Microsoft/WiX schema, nothing custom |
| row data inside [TABLE] streams | fixed-width binary, per-_Columns widths | — | not decoded | Text cols stored as string-pool indices; decoding requires MSI string-pool algorithm, deliberately not built |
| blob_name (9 BLOB streams) | enum (9 distinct) | — | Media.cab (payload cabinet), Icon.app.ico, 4× WixUI bitmaps, 2× WixUI icons, WixUIWixca.dll | Embedded install-UI assets, none Forza-related |

---

### `RAW-08-string-csvs` — 69 root string-table CSVs

**Scale:** 69 files, 17,959 total data rows (verified via real CSV parse, not naive line-count — 15 files have embedded newlines in quoted Content). 17,418 rows have a unique (KeyName,HashId) pair; ~541 reuse a shared ordinal-enum KeyName+HashId across files. Combined size 1,620,879 B. Smallest: List_DriveType/CarType/EnginePlacement/Region.csv (3 rows each). Largest: ChallengeData.csv (6,358 rows/645,428 B).

**Confidence:** verified

**Key structure:** Composite (SourceTable, KeyName) uniquely identifies one record. SourceTable = filename stem (69 values). KeyName unique within its file (verified 0 dupes). HashId is a VERIFIED 1:1 bijection with KeyName across the ENTIRE corpus (17,418↔17,418, zero collisions) — an undetermined but deterministic hash function (ruled out: CRC32, FNV-1, FNV-1a, cased/uncased). This bijection is the load-bearing fact: `FH6_Database.sqlite`'s `"_&<uint64>"` TEXT values decode as `(table_hash<<32 | HashId)`, where the low 32 bits equal this store's HashId — verified end-to-end on 3 independent tables (Data_Car, Tracks, List_PartManufacturer).

| Name | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| SourceTable | text (derived from filename) | scopes KeyName/HashId namespace | 69 fixed values | Which CSV/domain a row came from (car/upgrade UI, career/events, world/map, tuning/telemetry, UI chrome clusters) |
| HashId | int (uint32) | LOW 32 BITS of FH6_Database.sqlite's `"_&<uint64>"` TEXT refs (verified, effectively every table's display-name/description column) | 205,264–4,294,861,324, never null | Deterministic hash of KeyName; globally bijective across all 69 files |
| HashIdHex | text, fixed format | fully derived from HashId, no independent info | `^0x[0-9A-F]{8}$` | Display mirror of HashId |
| KeyName | text | numeric/GUID suffix usually = PK of a like-named FH6_Database.sqlite row (verified for Data_Car, Tracks, List_PartManufacturer; structurally implied elsewhere) | always prefixed "IDS_"; 4 suffix shapes: none / small int (enum ordinal) / large int (record PK) / 32-hex GUID (unresolved FK) | Human-readable string identifier, unique within SourceTable |
| Content | text | terminal leaf value, nothing points further out | 0–~600 chars; 536/17,959 (3.0%) empty string (unauthored, not missing) | The actual localized string; carries inline `{0}`/`{1}` format placeholders (17 files) and `[BOLD:]`/`[HIGHLIGHT:]`/etc. bracket-tag markup (13 files); a few rows hold literal `<Placeholder>`/`[PLACEHOLDER]` dev-cut content; valid UTF-8 with BOM throughout (apparent mojibake is a display artifact only) |

---

### RAW-09 — String Tables (`.str` corpus)

**Key structure:** Store-level: 287 independent files keyed by filename stem (= embedded `header.table_name`, verified equal 287/287, and byte-identical to the same-named entry in the live install's `EN.zip`). No cross-file key. Within one file: composite `(table_name, key_hash)`, mirrored by `db/schema.sql`'s `ref_string` PK. The true global identifier used elsewhere in the game DB is the derived 64-bit composite `H(table_name)<<32 | H(key_name)`, printed as `_&<uint64>` — mandatory for uniqueness since `key_hash` alone collides across tables (1,035/6,105 sampled). A folder-level `_list.txt` manifest enumerates all 287 filenames but has no record key of its own.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| filename (stem) | text | `ref_string_table.table_name` | 287 distinct names | Table's own primary key; == embedded `table_name` |
| `_list.txt` | text, CRLF list | none | n/a | Folder manifest of all 287 filenames; matches EN.zip's 288th entry |
| `header.magic_version` | u16 LE @0x00 | none | {0x0800} constant | Container format version; 0x0800 = FH6 |
| `header.table_name` | char[126] @0x02 | `ref_string_table.table_name` | same 287 values | Embedded copy of table name, redundant w/ filename |
| `header.padding` | 2B @0x80 | none | {0} constant | Alignment filler |
| `header.section_count` | u16 @0x82 | none | {2} constant | # of sections (Content + KeyName); mislabeled "version" in project's own strparse.py docstring |
| `header.section_offsets[]` | u32[2] @0x84 | internal | [0]=140 const, [1]=varies | Absolute offsets to Content and KeyName sections |
| `section.section_size` | u32 | none | 0+ | Bytes of Entry array + string pool for this section |
| `section.buffer_size` | u32 | none | 0+ | Byte length of trailing string pool |
| `section.entry_count` | u32 | none | 0–6,963; 12 files =0 | Row count; both sections share same count/order |
| `entry.hash` | u32 | low 32b of `_&<u64>` refs | 58,722 distinct pairs | rotl32(h^c,7) hash of KeyName, seed 0xFFFFFFFF |
| `entry.offset` | u32 | none | 0+, bounded by pool | Byte offset into this section's own string pool |
| Content pool string | text UTF-8 NUL-term | `ref_string.content` | free text | Localized display text; can embed `{0}{1}` / `{colour=...}` tokens |
| KeyName pool string | text ASCII | `ref_string.key_name` | free text, `IDS_`-prefixed | Human identifier, hashes to `entry.hash` |
| `table_hash` (derived) | u32 | `ref_string_table.name_hash` | 287 values | H(table_name), high 32b of composite ref |
| `composite_ref_id` (derived) | u64 | any `_&<u64>` cell in game DB | 58,722 values | `table_hash<<32 \| entry.hash` — the real FK mechanism |

**Scale:** 287 `.str` files + 1 manifest = 288 items (5,829,262 bytes str files, ~6.3 MB folder). 58,722 total rows across all tables (matches `fh6.db` exactly: 287 `ref_string_table`, 58,722 `ref_string`). Per-file entry_count 0–6,963; size 164 B–737,546 B.

**Confidence:** verified

---

### RAW-10 — Tracks.str (dual-section variant)

**Key structure:** Physical key: `hash_id` (u32 LE), unique per-section, pairs Section A (Content) to Section B (KeyName) positionally. Logical key: composite `(MapId, Role)` decoded from KeyName `IDS_<Role>_<MapId>` — 58 MapIds × 4 Roles = 232, matching record count exactly.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `header.name_len` | u16 BE @0x00 | none | 8 | Length of table_name string |
| `header.table_name` | text, padded @0x02 | filename | "Tracks\0\0" | Self-check name |
| `header.reserved_pad` | blob, zero | none | 0 | Pads to 128B fixed header |
| `sectionA.flag0` | u16 LE @0x80 | none | 0 | Unresolved |
| `sectionA.section_count` | u16 LE @0x82 | none | 2 | Declares 2 parallel sections |
| `sectionA.unk_140` | u32 @0x84 | none | 140 | Unknown; operand of derived_field |
| `sectionA.stringpool_end_abs_offset` | u32 @0x88 | sectionB start | 6654 | Verified = Section B's start offset |
| `sectionA.derived_field` | u32 @0x8c | none | 6514 (=end−unk_140) | Only field differing between 2 on-disk copies (delta 12, build drift) |
| `sectionA.stringpool_size` | u32 @0x90 | none | 4646 | Content pool byte length |
| `sectionA.record_count` | u32 @0x94 | none | 232 | Row count |
| `sectionA.table[]` | struct{hash_id u32, content_offset u32}×232 @0x98 | hash_id↔sectionB | — | Index into Content pool |
| `sectionA.string_pool` | blob, 232 NUL-term strings | — | 4,646 B | Content text values |
| `sectionB.field0` | u32 @6654 | none | 7510 (drifts 12 vs twin) | Unresolved |
| `sectionB.stringpool_size` | u32 @6658 | none | 5642 | KeyName pool byte length |
| `sectionB.record_count` | u32 @6662 | none | 232 | Matches Section A |
| `sectionB.table[]` | struct{hash_id u32, keyname_offset u32}×232 @6666 | hash_id↔sectionA | — | Index into KeyName pool |
| `sectionB.string_pool` | blob, 232 NUL-term strings | — | 5,642 B, ends at EOF | KeyName identifiers |
| `row.hash_id` | u32 | plausible low32 of `table_hash<<32\|HashId` composite | 232 distinct | Not plain CRC32 of KeyName (ruled out); stable/reproducible |
| `row.key_name` | text (decoded) | MapId → unconfirmed FK into PG internal map manifest | Role ∈ {Description, DisplayName, ShortDisplayName, ShortDisplayNameAllCaps}; MapId = 58 non-contiguous ints incl. 820=Brio | `IDS_<Role>_<MapId>`; MapId=820 matches live install's `tracks/brio/` folder |
| `row.content` | text (decoded) | `ref_string.content` (pattern) | free text | Localized string per role; 37/58 Descriptions share generic filler |

**Scale:** 14,164 bytes; 128B header + 24B/12B subheaders + 232×8B record arrays + 4,646B/5,642B string pools. 232 physical records = 58 MapIds × 4 Roles. Two near-identical on-disk copies (delta 2 bytes).

**Confidence:** verified

---

### RAW-11 — ONYX Vehicle Database (game-asset scan)

**Key structure:** Single-column PK `car_id` (int), read directly from the asset filename `carclips_<car_id>.clipd`. Stored twice per JSON record (dict key + inner field), 0 duplicates. Strict subset of `ref_car.ordinal` (638/660, 0 unmatched). Natural join field is `asset` ↔ `ref_car.media_name`, case-insensitive (26/638 differ only in case).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `car_id` | int | `ref_car.ordinal` (638/660 subset) | 247–4342, non-contiguous | True PK, scanned from game asset filename |
| `display_name` | text | none | "`<year> <make> <model>`" | Auto-composed, NOT the game's real localized string |
| `year` | int | none | 1953–2032 | Parsed from asset suffix; century heuristic wrong ≥1× (car_id 2372 "FOR_Coupe_32"→2032, likely 1932) |
| `make` | text (enum, 81 vals) | `ref_car.make` (loose) | 81 manufacturers | Derived from `manufacturer_code`; car_id 1215 "NUL_CAR_00" mislabeled make=Nissan |
| `model` | text | `ref_car.model` (loose) | free text | Camel-case-split `raw_model` |
| `asset` | text | `ref_car.media_name` (case-insensitive, 612/638 exact, 26 case-diff) | free text | Real FK into asset pipeline |
| `manufacturer_code` | text (96 vals) | prefix of `asset` | 96 codes → 81 makes | Leading token of asset key |
| `raw_model` | text | none | free text | Un-prettified model token |
| `source` | text, constant | none | 1 value | Static lineage note, repeated every row |
| `confidence` | enum | none | id-from-game-asset-name-auto-cleaned (636) / confirmed-by-user-and-game-asset (2) | Human-verification flag |
| `internal_path` | text, deterministic | none | `Scene/animations/Mojo/clip/carclips_<id>.clipd` | Fully derivable from car_id |
| `zip_file` | text, deterministic | `cars/<asset>.zip` | — | Fully derivable from asset |
| `notes` | text, constant | none | 1 value | Static caveat, repeated every row |

**Scale:** 4 files (2 JSON payloads, SHA-256-identical; 1 CSV missing 2 cols; 1 README). 638 records, ids 247–4342, 81 manufacturers.

**Confidence:** verified

---

### RAW-12 — Materials/Grub Art-Bundle Container (burG)

**Key structure:** No per-record PK — a chunk-container format. (1) FILE level: filename/path is the only stable key (the one GUID field in texture headers is a constant placeholder in 100% of files). (2) Within file: `Blob[]` keyed by ordinal position (24B `BlobHeader` array); FourCC `tag` is type, not unique (a `.modelbin` can hold 2–9 same-tag Mesh blobs). (3) Each Blob owns `MetaData[]`, same ordinal-keyed pattern, tagged by a second FourCC.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `FileHeader.tag` | u32 @0x00 | none | 0x47727562 const | "burG"/"Grub" magic |
| `FileHeader.version` | 2×ubyte @0x04 | none | 1.1 (100%) | Container revision |
| `FileHeader.reserved` | u16 @0x06 | none | 0x0000 | v1.0 slot repurposed as padding in v1.1 |
| `FileHeader.header_size` | u32 @0x08 | none | 44–464 B | Offset where first blob payload starts |
| `FileHeader.total_size` | u32 @0x0C | none | matches file size | Sanity field |
| `FileHeader.blob_count` | u32 @0x10 | none | 1–10 | # BlobHeaders following |
| `BlobHeader.tag` | u32 FourCC | scoped by file ext | 14 observed of ~26 documented: Mesh(2651), MATL(1856), MTUD(1856,undoc), MTPR(1856), TXCB(1029), MatI(588), VerB(392), VLay(313), Skel(133), Modl(133), IndB(132), MBuf(109), Mrph(71), Skin(2), MNCL(1) | Sub-chunk type |
| `BlobHeader.version` | 2×ubyte | none | per-tag, e.g. MNCL=2.0 exceeds documented max 1.1 | Per-blob-type revision |
| `BlobHeader.metadata_count` | u16 | none | 0–2 | # MetaData entries owned |
| `BlobHeader.metadata_offset/data_offset` | 2×u32 | file-relative | — | Offsets to metadata array / payload |
| `BlobHeader.data_size_unused` | u32 | none | always == data_size | Dead/legacy "compressed length" |
| `BlobHeader.data_size` | u32 | none | 18 B–40,000 B | Payload length; verified against BC7 block math for TXCB |
| `MetaDataHeader.tag` | u32 FourCC | scoped by blob | 8 of 9 documented: Name(5095), BBox(2784), ATST(1856), BLST(1856,undoc), XTRA(1856,undoc), Id(1536), TXCH(1029), TRef(1) | Metadata entry type |
| `MetaDataHeader.version/data_size` | packed u16 (4b+12b) | none | data_size 2–88 B | Sub-revision + payload length |
| `MetaDataHeader.data_offset` | u16 | relative to header itself | small ints | Payload offset |
| payload: `Name` | text ASCII | loose vs. 010-Editor CRC32 name table (params only) | shader-family strings, e.g. car_glass, car_standard | Shader/material template family |
| payload: `BBox` | 6×float32 | none | model-local units | Mesh/Modl AABB |
| payload: `Id` | int32 (ambiguous "// long") | Mesh buffer refs, same file | small ints | Sub-object id (buffer index) |
| payload: `TXCH` (swatchbin) | nested struct | — | width/height vary 100×100–916×458; all else constant (BC7, 1 mip, Wrap, Rec709Linear) | Texture header describing sibling TXCB |
| payload: `TXCB` (swatchbin) | blob, BC7 4×4 blocks | decodable to PNG | 40,000–421,360 B | Actual swatch preview pixels |
| payload: `TRef` (modelbin) | u32 count + u32[] hashes | CRC32(lowercase swatchbin path), no reverse table | 1 occurrence | References to .swatchbin textures |
| payload: `MATL` (materialbin) | 1–3 length-prefixed paths | none decoded | 66–88 B | Source-material reference path(s) |
| payload: `MTPR` (materialbin) | array of ShaderParameter records | name_hash→CRC32 table in .bt; texture path_hash→CRC32(swatchbin path) | 11 ShaderParameterType values | Shader-constant/texture bindings (paint, gloss, normal maps) |
| payload: `MTUD` (materialbin, UNDOCUMENTED) | flag + 1–2 length-prefixed strings | internal FM5 asset-library namespace | data_size 1B (empty, majority) or 63B (populated) | Dev-authoring provenance path, e.g. FM5 migration source |
| payload: `ATST` (materialbin) | 2×bool | none | (0,0)/(0,1)/(1,0) observed | Live 2-flag switch, purpose unresolved ("Atlas?") |
| payload: `BLST` (materialbin, UNDOCUMENTED) | 5 bytes | none | always 00 00 00 00 00 | Inert in every sample |
| payload: `XTRA` (materialbin, UNDOCUMENTED) | 5 bytes | none | always 00 00 00 00 00 | Inert in every sample |
| payload: modelbin geometry (Skel/Mrph/MatI/Mesh/IndB/VLay/ILay/VerB/MBuf/Skin/Modl) | shape only (see .bt) | Mesh.bone_index→Skel; Mesh buf ids→IndB/VerB Id | n/a | 3D mesh/skinning data, out of tuning scope |
| payload: `MNCL` (ManufacturerColors.bin) | manufacturer_count + per-mfr material entries | material_index_mask→unresolved; path→swatchbin/materialbin | v1.1 documented layout desyncs vs. real v2.0 | Per-manufacturer paint preview colors; needs own RE pass |

**Scale:** 3,019 burG-format files, 186.44 MB (1,856 `.materialbin`, 1,029 `.swatchbin`, 133 `.modelbin`, 1 `ManufacturerColors.bin`). 100% container v1.1.

**Confidence:** verified

---

### RAW-13 — Golf R Car Scene bundle (carbin/avpins/xaml/debug/build-report)

**Key structure:** No single PK across the 5-file bundle — keyed by filename stem `VW_GolfR_19`, and internally by `Scene.ordinal` (=3413, VERIFIED == `ref_car.ordinal`) and `Scene.build_guid` (shared byte-for-byte with `.carbin_debug`). Nested records key positionally EXCEPT `Upgrade.id = ordinal*1000+index` (VERIFIED == `ref_part.part_id`) and `CarRenderModel11.id` (dense 0–130). `avpins` keys by GUID and `Name` (in-file FK).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `Scene.version` | u16 | none | 7 (FH6) | Schema version |
| `Scene.build_guid` | 16B GUID | `.carbin_debug` header GUID (verified identical) | — | Build-pipeline id |
| `Scene.build_strict` | bool | none | false | Strict-validation build flag |
| `Scene.ordinal` | u32 | `ref_car.ordinal` (verified) | 3413 | Car global id |
| `Scene.media_name` | text | `ref_car.media_name` | "vw_golfr_19" | Internal asset name |
| `Scene.skeleton_modelbin_path` | text | asset tree | — | Shared skeleton path |
| `Scene.levels_of_detail` | bitfield u16 | none | raw 127 (all 7 LODs) | LOD tiers provided |
| `Scene.non_upgradable_parts[]` | array<Part> | — | 3 entries: CarBody(71 meshes), Brakes(8), WheelStyle(4) | Fixed-mesh sub-assemblies |
| `Scene.upgradable_parts[]` | array<UpgradablePart> | — | 6 entries: RearWing, FrontBumper, RearBumper, Hood, SideSkirts, ChassisStiffness | Multi-tier sub-assemblies |
| `CCarParts_Enum` | enum u32/u8 | loosely `ref_part.slot` | 46 named values; only 9 populated in this file | Part-slot vocabulary |
| `Upgrade.id/level/car_body_id` | int32/uint8/int32 | `ref_part.part_id` (VERIFIED); `car_body_id`→`ref_car.stock_carbody_id` (VERIFIED) | id=ordinal*1000+tier; level e.g. 0,1,3,3 (non-sequential) | Per-tier upgrade metadata |
| `SharedCarModel.upgrade_ids[]/model` | array<int32> + CarRenderModel11 | `Upgrade.id` same UpgradablePart | — | Mesh shared across tiers |
| `CarRenderModel11.version` | u16 | none | 21 (100%, max Horizon) | Per-model schema version |
| `CarRenderModel11.path` | text | asset tree | `.modelbin` paths | Mesh asset |
| `CarRenderModel11.transform` | float[16] | none | identity observed | Model→scene transform |
| `CarRenderModel11.levels_of_detail` | bitfield | none | — | Per-mesh LOD flags |
| `CarRenderModel11.bone_name/bone_id` | text/int16 | skeleton modelbin | — | Attach point |
| `CarRenderModel11.draw_groups` | bitfield u32 | none | Exterior=83, Shadow=83, Cockpit=41, DriverlessCockpit=36, WindshieldReflection=2, Hood=1 | Render-pass membership |
| `CarRenderModel11.material_indexes[]` | map<string,u64> | paint-group identity | e.g. carPaint slot repeats same u64 per Part | Named material→paint-group mapping |
| `CarRenderModel11.is_droppable/drop_part_data` | bool + (float,u32 hash) | none | 13/131 models droppable | Crash-detach mesh |
| `CarRenderModel11.id` | u8 | none (internal only) | dense 0–130 | Per-scene mesh index |
| `CarRenderModel11.assembly_name` | text | none | 27 values: Doors(12), SecondaryLights(12), BumperF(11)... | Sub-assembly grouping label |
| `AOMapInfo.*` | struct | none | part_type=0xFFFFFFFF sentinel observed | AO swatchbin binding |
| avpins `View@Name/Guid/Locator` | struct×3 | none | — | Named default camera views |
| avpins `PointOfInterest@*` | struct×65 | Name→in-file FK (Action/Requires/POI@Name) | — | Interactive showroom hotspots |
| avpins `PartVisibilityAffect@UpgradePartID` | int | `Upgrade.id`/`ref_part.part_id` (VERIFIED, e.g. 3413001=Hood L1) | 4 records | Hotspot visibility gated by upgrade |
| xaml `DigitalGaugeConfig@*` | mixed bool/float/int | probable `ref_engine`/`ref_car` rpm/speed (unverified) | MaxBoost=13, MaxSpeed=89.4, MaxFuel=20.0, MaxRpm=8000 | In-cockpit digital dash gauge bounds |
| `carbin_debug.header.build_guid/build_machine/build_timestamp` | GUID/text/text | matches carbin build_guid; matches build_report.html | PGL-HNX097, 2026/05/13 11:29:44.355 | Debug symbol-table build stamp |
| `build_report.html` summary+rows | HTML table | none | Branch=forte_main, Errors=16, Warnings=21, Info=8 | Internal Perforce/MSBuild asset-build log |

**Scale:** `.carbin` 69,866 B (byte-exact parse, 0 remainder) against `CarScene_carbin.bt` v1.2, schema v21. `.avpins` 69,366 B XML, 65 POIs. `.xaml` 23,331 B. `.carbin_debug` 1,529 B. `build_report.html` 69,730 B UTF-16.

**Confidence:** verified

---

### RAW-14 — Track Route Locators (`.nt` corpus, 37 files)

**Key structure:** No corpus-level PK. Within one file, `Locator/Name/@value` is unique (0 dupes/file); across files the true composite key is `(filename, Name)` — same names recur across files (249 shared between bucket/job challenges). `GUID` is a dead placeholder (`"0"` in 100% of records). Recommend cataloging as `(source_file, locator_name)`.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `[filename]` | text | numeric route-id suffix → unconfirmed independent PvP-arena id space (not `data/routes.json`, not FH6_Database.sqlite) | 37 filenames: bucket/job challenge start-ends, eliminator_locators, parkingareas, pinata_locators, 10× map_region, route{0,3001-3023,8100-8105,40001,40041-44,40900} | Groups records by minigame function |
| `TrackLocators` (root) | nested-object | none | n/a | Wrapper, no count/version attr, no XML decl |
| `Locator/@Version` | int (attr) | none | constant "2" | Format tag |
| `Locator/Name/@value` | text | eliminator_locator_N → live-install subset (373 raw vs 100 curated); VOL_HJ_* → unresolved bucket/job-challenge def table; barn_finds_*_<Make>_<Model> → string-match to `ref_car` (not numeric FK) | Naming families: eliminator_locator_NNN, Arena_NNN, finish_line/start_location (King/Eliminator PvP), Hider/Seeker_Spawn (Hide&Seek), car_parking_area_NNNN, pinata_locatorN_NNN, VOL_HJ_<Prefab>_{start/exit}N, carmeet_*/sidi_upsell_*, barn_finds_* | Semantic id, near-unique per file |
| `Locator/GUID/@value` | text (degenerate) | none | constant "0" | Dead/placeholder field |
| `Locator/SceneTransform._11.._44` | float×16 (12 pop. + 4 const) | spatially comparable to `data/courses/*.json`, `data/routes.json` (no direct FK) | X:[-8789.56,7582.58], Y:[-0.88,1575.66], Z:[-9948.51,18425.71]; _14/_24/_34=0, _44=1 always | 3×4 affine world transform; verified orthonormal rotation |
| `Locator/AttachTo` | nested, empty | none | always empty, 100% | Dead/reserved parenting slot |

**Scale:** 37 files, 3,817,808 bytes. 8,117 `<Locator>` records total (verified full parse). Largest: `parkingareas.nt` (2,664 records, 1.24 MB); smallest: `route4004{1-4}.nt` (2 records, 976 B each).

**Confidence:** verified

---

### RAW-15 — Root Physics Binaries (physicsdefinition/Lights/LightPresets/ManufacturerColors)

**Key structure:** No shared key across the 5 files. `physicsdefinition.bin` — no ID field, identity = file itself (2 internal 0-based point arrays, 41 pts each). `Lights.bin` — 12 records keyed by embedded asset-path string (no numeric id). `LightPresets.bin` — presumed positionally keyed 0–97 matching its debug sibling (assumed, not proven). `LightPresets.bin_debug` — two 0–97 offset-indexed tables (PRST mirror, NAME); off-by-one rule confirmed (entry 0 implicit, 97 stored offsets). `ManufacturerColors.bin` — 8 positionally-keyed records, natural key = material-path slug.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `physicsdefinition.magic/version` | i32@0x00 | none | 1 | Format flag |
| `physicsdefinition.header.count_0x08` | i32 | none | 31 | Unresolved capacity field (≠ actual 41) |
| `physicsdefinition.header.sentinelNaN[9]` | float×9 @0x38 | none | 0xFFC00000 const | "unset" sentinel for 9 optional overrides |
| `physicsdefinition.header.bbox[4]` | float×4 @0x5C | none | 0.919/0.657/2.162/2.376 | Probable extent values |
| `physicsdefinition.header.sectionCount` | i32@0x88 | none | 2 (verified) | # point sections |
| `physicsdefinition.header.pointCount` | i32@0xA4 | none | 41 (verified) | Per-section record count |
| `physicsdefinition.section[].record[].x/y/z` | float×3 | none | x±0.92m (mirrored), y 0–1.31m, z ±2.24m | Symmetric 41-pt physics cage; generic mid-size car |
| `physicsdefinition.section[].record[].w` | float | none | const 1e-4 | Epsilon/tolerance, not a type marker |
| `physicsdefinition.section2 vs 1` | n/a | none | y raised 0→0.2 where y=0 in sect.1 | Two ride-height states |
| `physicsdefinition.footer` | i32×4 | none | 0,0,1,-1 | EOS sentinel |
| `Lights.header.magic` | 4B | none | 0xDEADBEEF | Signature |
| `Lights.header.recordCount` | i32@0x08 | none | 12 (verified) | Path record count |
| `Lights.record[].path` | text ASCII | live install asset tree; `vw_golfr_19` slug plausibly → `ref_car` | 12 distinct `.modelbin` paths | Per-car (VW Golf R) light-fixture models — NOT generic |
| `LightPresets.header.magic` | 4B | none | "LDFB" | Signature |
| `LightPresets.header.fileLen` | i32@0x04 | none | 4156 (verified) | File size check |
| `LightPresets.attribute records (TLV)` | repeated [tag,len,val] | positionally to debug NAME (assumed) | tags 0x00–0x3F; lens 1/4/12 | Per-preset bulb/color/cone attrs; boundaries not fully walked |
| `LightPresets.bin_debug.header.magic` | 4B | none | "LDIB" | Signature |
| `LightPresets.bin_debug.car reference string` | text @0x0C, 256B | same `vw_golfr_19` slug join as Lights.bin | "car:vw_golfr_19" | Confirms single-car authoring template |
| `LightPresets.bin_debug.PRST block` | blob+3×i32 | mirrors LightPresets.bin TLV bytes (verified) | count=98 | Raw-data mirror |
| `LightPresets.bin_debug.NAME.offsetTable[97]+blob` | int32[]+strings | positionally→PRST/LightPresets | 98 entries | ref_light_preset(id 0-97,name) — fully decoded |
| `LightPresets.bin_debug.NAME.entry[]` | enum text | possible bulb/colour enum elsewhere | 98 values: IDT_White, LED_Red, BulbType_{HALOGEN,LED,XENON}, Colour_*, Proj_Emerg_* etc. | Preset name catalog |
| `LightPresets.bin_debug embedded swatch paths` | text ×2 | `.swatchbin`/`.swatchpre` asset tree | headlight projection cookies | Outside NAME table, found via string scan |
| `ManufacturerColors.header.magic` | 4B | known burG decoder | "burG" | Standard Grub container |
| `ManufacturerColors.recordCount` | u8@0x2C | none | 8 (3-way verified) | Row count |
| `ManufacturerColors.record[].zoneNames[7]` | Pascal strings | plausible paintable-slot enum | const across all 8: Body, Hood, Mirror, Wing, p_WingEndPlates, p_WingPlane, p_WingStruts | Paintable zones |
| `ManufacturerColors.record[].rgb1/rgb2` | float×3 each | none | [0,1] per channel | Primary/secondary color reps |
| `ManufacturerColors.record[].materialPath` | text | `.materialbin` carpaint namespace | 8 distinct, cross-manufacturer (VW/KTM/Maserati/Lotus/McLaren) | Paint material asset |

**Scale:** 5 files, 40,018 bytes. physicsdefinition.bin=1,584B/82 points; Lights.bin=21,790B/12 records; LightPresets.bin=4,156B/~98 TLV; LightPresets.bin_debug=10,912B/98 names; ManufacturerColors.bin=1,576B/8 records.

**Confidence:** probable

---

### RAW-16 — aovolumetexture.bin

**Key structure:** No key — single blob, one file = one record. No embedded id/name/GUID (only string found = magic "TVOA"). Internal arrays (`points[]`, `bricks[]`) are self-indexed 0..N-1 only. Identity = filename; folder holds exactly one instance (not a per-car library).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `magic` | text 4B | none | const "TVOA" | Format ID |
| `brick_count` | u32 LE @4 | bounds `bricks[]` | 3 (verified) | # AO brick records |
| `grid_dim_x/y/z` | u32×3 @8 | bounds brick pos/size | 128/64/128 | Voxel-grid resolution |
| `extent_x/y/z` | float32×3 @20 | none | 5.0/4.0/5.0 | Probable world-space size (m) |
| `reserved_vec3` | 3×float32+pad @32 | none | (0.0, 0.524, 0.0343, 0.0) | Unresolved single instance |
| `point_count (N)` | u32 @48 | bounds `points[]` | 3396 | # sample vertices |
| `points[].x/y/z/pad` | struct, 16B×N | none | X±0.888, Y[-0.186,1.234], Z±2.107..2.175m; pad always 0 | Vehicle-scale bounding box (~1.78×1.42×4.28m) |
| `bricks[].pos_x/y/z, size_x/y/z` | 24B sub-header | indexes into grid_dim | pos 0–84, size 16–72 | Sparse voxel-space placement (~10.2% grid coverage) |
| `bricks[].texel` | struct{r,g,b,a: u8} | none | full 0–255 range; ~127,127,127,0 = empty sentinel (43% brick0, ~0% bricks1-2) | Probable baked bent-normal (RGB) + AO weight (A) |

**Scale:** 1 file, 484,028 bytes; byte-exact parse (52B header + 3,396×16B points + 3 bricks totaling 429,640B), zero leftover bytes.

**Confidence:** probable

---

### RAW-17 — Manifest.xml (per-car asset wiring)

**Key structure:** No single PK — hierarchical asset tree. Natural composite key for tuning-relevant content: `(PartEnum, PartId)` on `<UpgradeablePart>`; `PartId = ordinal*1000+variant*100+tier`, unique only WITHIN one PartEnum block (repeats across blocks). Whole file implicitly keyed by car (ordinal 3413, VW_GolfR_19), confirmed exact match to `car-option-lists.json`.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `Manifest` (root) | nested-object | none | n/a | Root; children = NonUpgradeablePart / UpgradeablePart |
| `NonUpgradeablePart/PartEnum` | enum text | `car-option-lists.json` slot_names/fixed_slots | this file: CarBody, Brakes, WheelStyle | Fixed-mesh slot (no shop options) |
| `NonUpgradeablePart` (container) | nested-object | none | never carries PartId | Holds 1+ `<Model>` children |
| `UpgradeablePart/PartEnum` | enum text | `car-option-lists.json` slot_names | RearWing, FrontBumper, RearBumper, Hood, SideSkirts, ChassisStiffness | One shop-selectable option per element |
| `UpgradeablePart/PartId` | int (text) | `car-option-lists.json` cars[ordinal].options[slot][*].id (VERIFIED exact) | 3413000–3413003 (variant=0 only, this car) | `ordinal*1000+variant*100+tier` |
| `Model/path` | text (game: path) | live install .modelbin asset tree | 142 elements, 128 distinct | Mesh asset reference |
| `Model/LODs` | int (bitmask, not count) | none | 1,2,3,15,31,62,63,124,126,127 (7-bit contiguous-run values) | Per-LOD mesh-swap selector |
| `Model/children (Material, Swatchbin)` | nested list, path-only | other assets in cars/_library | 546 Material refs (59 distinct), 797 Swatchbin refs (245 distinct) | Shader/texture bindings |

**Scale:** 1 file, 180,104 bytes, 1,673 lines. 3 NonUpgradeablePart, 19 UpgradeablePart across 6 PartEnums, 142 Model elements, max nesting depth 3. One of 660 such files project-wide (558/660 archives yield a usable option list; aggregates to 6,457 UpgradeablePart rows in `car-option-lists.json`).

**Confidence:** verified

---

### RAW-18 — Locators.xml (per-car part-mounting locators, VW Golf R)

**Key structure:** Effective PK = `GUID` (UUID v4, 45/45 unique). `Name` (e.g. `carLocator_wheelLF`) is a secondary near-unique natural key, also 45/45 unique in this file but a shared taxonomy term across cars. No filename-embedded car key — the car (VW_GolfR_19, `Data_Car.Id=3413`) was recovered forensically via embedded `UpgradeInfo/PartId` values and the sibling `Manifest.xml`'s asset paths. Cross-DB join key: `(UpgradeInfo.PartType, PartId)` where `PartId≠-1` → `List_Upgrade<PartType>.Id`.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `CarLocators/@Version` | int attr | none | "2" | Container schema version |
| `Locator/@Version` | int attr | none | "3" (45/45) | Record schema version |
| `GUID/@value` | text UUID | none | 45 distinct | Effective record PK |
| `SrcGUID/@value` | text UUID | same target as GUID | identical to GUID in 45/45 | Provenance/clone-source id |
| `Name/@value` | text (fixed vocab) | none | 45 distinct: carLocator_wheelLF/RF/LR/RR, doorLF/RF/LR/RR, Exhaust_001-010, headlightL/R, hood, wing, root, etc. | Mount-point semantic name |
| `SceneTransform._11.._44` | float×16 | none | X±0.90m, Y[0,1.03]m, Z±2.18m; rotation cells all exactly 1/-1/0 (axis-aligned only) | Locator transform relative to bone |
| `AttachToBone/@BoneName` | text (intended enum) | none | only "<root>" observed (45/45), but LITERALLY unescaped `<root>` — malformed XML | Which skeleton bone the transform is relative to |
| `AttachToBone/@Snap` | bool-as-int | none | only "0" | Snap-to-bone flag |
| `UpgradeInfo/@IsUpgradable` | bool-as-int | none | only "1" | Whether locator can be upgrade-gated |
| `UpgradeInfo/@PartType` | enum text | `List_Upgrade<PartType>` (verified for RearBumper) | "CarBody" (35/45) or "RearBumper" (10/45) | Owning upgrade category |
| `UpgradeInfo/@UpgradeLevel` | u32 (sentinel 4294967295) | `List_UpgradeCarBodyRearBumper.Level` (VERIFIED) | sentinel or {0,1,3} | Gating tier |
| `UpgradeInfo/@PartId` | int (sentinel -1) | `List_Upgrade<PartType>.Id` (VERIFIED) | -1 or {3413000,3413001,3413002} | FK to specific upgrade part |
| `UpgradeInfo/@ParentUpgradeId` | int (sentinel -1) | `List_Upgrade<PartType>.Id`, the IsStock=1 row | -1 or 3413000 | Groups tier family under stock row |

**Scale:** 1 file, 32,748 bytes, 45 records (44 `carLocator_*` + 1 `root`). Single-car specimen — not a per-car table.

**Confidence:** verified

---

### RAW-19 — IK Anchor Bones (global driver-rig config)

**Key structure:** Whole-file, single-record global config — no per-car/per-row PK (only one such file exists in the corpus, applies uniformly). Internal repeating structure = `Bone[]` array, natural key `Bone/@Name` (closed 7-value enum, each appearing once).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `@Version` (root) | int attr | none | 101 (repeated on every node) | Schema/format version |
| `@SteeringWheelMaxDegrees` | float | none | 270.0 | Max visual wheel-model rotation |
| `@HandGripAmount` | float | none | 0.123 | IK grip blend weight |
| `@ReclineAmount` | float | none | -0.318 | Normalized seat-recline offset |
| `Bone/@Name` | text (key) | none | steering_pivot_offset, steering_ik_scale, steering_ik_rot_left, steering_ik_rot_right, anchor_clutch, anchor_gas, anchor_butt | Identifies the anchor row |
| `Bone/@OffsetX/Y/Z` | float, sparse | none | -0.1826 to 0.1579 m | Positional offset, per axis (omitted axis=0.0) |
| `Bone/@RotX/Y/Z` | float, sparse | none | -35.17 to 1.59° | Rotational offset, per axis |
| `Bone/@ScaleX/Y/Z` | float, sparse | none | 1.1251 (only on steering_ik_scale) | Uniform IK-reach scale |
| `Mojo/EditLinkages` | empty nested | none | Version=101 only | Dead authoring-tool metadata |

**Scale:** 1 file, 919 bytes, 10 elements (root + 7 Bone + Mojo + EditLinkages). Only IK/bone-anchor file in the corpus.

**Confidence:** probable

---

### RAW-20 — LiveryMasks/Masks.xml

**Key structure:** Record identity = the XML tag name itself (11 fixed values), all direct children of root `<LiveryMasks>`, each self-closing with attributes only. Global file (not per-car/per-livery) — only Masks.xml in the corpus.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| mask_name (tag) | enum text | matching `.swatchbin` filename (10/11, 1:1 verified; Glass_Top has none) | Front, Back, Top, Left, Right, Wing, Glass_Front, Glass_Back, Glass_Top, Glass_Left, Glass_Right | Which livery paint-projection face |
| `valid` | bool text | none | true (10) / false (1: Glass_Top) | Whether face has a real projection region |
| `xorigin/yorigin` | float | none | derived, redundant with (left+right)/2, (top+bottom)/2 | Rectangle center (verified redundant) |
| `top/bottom/left/right` | float | none | span ≈ -1002..+1003 X, -510..+510 Y | Bounding rectangle in shared canvas space |
| `xAxis` | enum text | none | -x, +x, -z (3 values) | Signed 3D axis for mask's local horizontal |
| `yAxis` | enum text | none | +y, -y, +x (3 values) | Signed 3D axis for mask's local vertical |
| `xScale/yScale` | int-valued | none | always 1 | Per-axis stretch multiplier (identity only, observed) |
| `rotation` | int-valued (degrees) | none | -90, 0, 90, 180 | Texture-projection rotation |

**Scale:** 11 records (10 valid + 1 stub). 2,110 bytes, 14 lines.

**Confidence:** probable

---

### RAW-21 — Build Stamp Files (BuildNumber.txt / CarBuildTime.txt)

**Key structure:** No key — twice over. Each file is one scalar value with no internal delimiter, no filename-embedded key. Association to a build event only via co-location with `carscene_VW_GolfR_19_build_report.html` and exact string match against that report's Build Number field. 1 instance of each in the entire corpus.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `BuildNumber.txt` (whole file) | text, 1 line | none directly | "Local.VW_GolfR_19.PGL-HNX097" | Composite build id, 3 dot-segments |
| `.segment1_build_type` | text/enum | none | "Local" (1 sample) | Build kind |
| `.segment2_content_id` | text | possible FK by name-match into `ref_car` (unconfirmed, not numeric) | `<Make>_<Model>_<idx>` pattern | Turn 10 content/asset-family id |
| `.segment3_build_host` | text | matches build_report.html Build Scratch path | "PGL-HNX097" (1 sample) | Build-farm hostname |
| `CarBuildTime.txt` (whole file) | text, 1 line, timestamp | none | "2026/05/13 12:31:38.984" | Millisecond build-pipeline timestamp, ~52s after paired report's Report Date |

**Scale:** BuildNumber.txt=30B, CarBuildTime.txt=25B. 1 instance each in the whole corpus (despite 662 car families existing elsewhere) — incidental leak, not a systematic store.

**Confidence:** verified

---

### RAW-22 — Stray/Noise Files (Claude-logs zip, POKER.txt, asdfasdf.pdf)

**Key structure:** No shared key — three unrelated whole-file blobs. (1) zip: keyed by 19 fixed entry filenames. (2) POKER.txt: no key, single 7-line text blob. (3) asdfasdf.pdf: no key, single-page PDF identified only by 2 metadata fields (Title, Author).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `Claude-logs-*.zip` entries | blob (zip, Deflate) | none — unrelated to FH6 | 19 fixed filenames (main.log, cowork-service.log, system-info.txt, etc.) | Claude Desktop diagnostic/support-log export for this machine (App 1.40609.1, Electron 42.10.0, Win11 Pro) |
| `POKER.txt` | text, 7 lines | none | n/a | PioSOLVER-style poker-solver command script (unfilled placeholder range) |
| `asdfasdf.pdf` | blob (PDF 1.7, 31 JPEG XObjects) | none — no text layer | Title="Live dashboard A_B testing views", Author="Jett Mitchell-Rose" | Print-to-PDF export of this project's own dashboard A/B view; not a usable data source |

**Scale:** 3 files. zip=1,841,533B compressed/19 entries; POKER.txt=279B; pdf=1,001,129B/1 page.

**Confidence:** verified

---

## Live game install

### `phys-friction-group` — Physics/Surface & Effects XML cluster (7 files)

**Key structure:** 7 independent config files under `Content/media/physics/`, each with its own keyspace. `NatalSurfaceTypes.xml`: `SurfaceCategories` = bare 11-value enum (no key needed); `CategoryToCategoryParams/Node` keyed by ordered pair `(Category0,Category1)` (37-row sparse edge list, not a full matrix, w/ Default/Default fallback); `SurfaceTypes/<TagName>` keyed by tag name (58 records). `BreakEffects.xml` keyed by `SystemEffect@Index` (sparse 0–253). `SmashableObjectTypes.xml` keyed by `Object@type` (text, no numeric id). `CollObjects.xml` — empty template, 0 records. `GroundCoverSurfaceMap.xml` keyed by `Material@name` (5 rows). `RaceEffectsPresence.xml` — 0 active records (1 commented-out). `TireEffectsDefinitions.xml` keyed by `Surface@Name` (133 rows; separate catalog from NatalSurfaceTypes' 58 — not joinable by name).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `SurfaceCategories/<tag>` | enum | target of Node@Category0/1, SurfaceTypes@Category | 11: Car, Cone, Tire, HardWorld, SoftWorld, RumbleStrip, TireWall, GuardRail, GenCollObj, Pylon, SoccerBall | Flat category enum |
| `Node@Category0/@Category1` | enum text | `SurfaceCategories` | 11-enum + "Default" | Collision-pair id, 37 sparse rows |
| `Node@FrictionCoefficient` | float | none | 0.0–1.25 | Coulomb friction for pair |
| `Node@Elasticity` | float | none | -0.97–1.05 | Restitution (engine convention, can be negative) |
| `Node@FrictionNoise*` (5 fields) | float | none | -1.0–5.0 | Procedural friction-perturbation noise params |
| `SurfaceTypes/<TagName>` | text (tag=key) | none | 58 values: Asphalt, Dirt, Grass, Gravel, Sand, Quicksand, RumbleStrip, SpeedBump, CobblestoneX4, BumpyAsphalt/ConcreteX6, CarAluminum/CarbonFiber, etc. | Per-surface deep physics record |
| `SurfaceTypes/<Tag>@Category` | enum | `SurfaceCategories` | e.g. Asphalt→HardWorld, Dirt→SoftWorld | Category membership |
| `.../Friction/{FrictionScale,HeatTireScale,OffRoadness,OffRoadWet/DryPeakSA}` | float×6 | none | FrictionScale 0.8-1.0, PeakSA ~12-20° | Base grip knobs |
| `.../Friction/VelDepFriction/*` (16 fields) | float | none | VelPeak 0-80, LateralCoeff 0.03-1.0 | Velocity-dependent friction/torque curve (2-pt piecewise) |
| `.../Friction/CarWorldCollFricMods/*` (4 fields) | float | none | CarUpAxisY 0.5/0.866 | Friction mod by car upright-ness |
| `.../Aerodynamics/{LinearDrag,AngularDrag}` | float×2 | none | e.g. 0.03/0.1 | Drag while in contact w/ surface |
| `.../Bumpiness/{NoiseType,Frequency,...,Rumble}` | mixed | none | NoiseType: HeightGrid, Ridges, SinWave, Simplex, Simplex4, None | Procedural road-noise generator |
| `.../Springiness/{IsSpringy,SpringK,...}` | bool+float | none | — | Secondary spring model (soft-object contact) |
| `.../SteerTorque/*` (17 fields) | float | none | mostly 0.0-1.0 | Force-feedback torque-feel model |
| `.../SkidData/{Color*,TextureIndex,MinIntensity,SmokeType}` | int/float/nested | none | TextureIndex {0,1} | Skid-mark decal + particle-FX trigger |
| `.../DebugColor/*` | int×4 (0-255) | none | — | Dev-overlay tint color |
| `.../ShouldSpark` | bool | none | true/false | Spark-particle trigger |
| `.../CarDamageScalar` | float | none | 1.0 (sampled) | Impact damage multiplier |
| `.../IsPenaltySurface` | bool | none | true/false | Off-track lap-penalty marker |
| `.../IsHandOfGodTriggerSurface` | bool | none | true/false | Rewind-assist trigger |
| `BreakEffects.SystemEffect@Index` | int (PK) | prop-placement data (unconfirmed) | sparse 0-253, 36 populated | Breakable-prop effect id |
| `BreakEffects.SystemEffect@Name` | text | none | 36 values e.g. Prop_Generic_Metal | Human label |
| `.Effect@Name` | enum | none | Break_Props_Common, Break_Sparks_Common, Break_Pine_Common, etc. | Particle-break template |
| `.Effect.Attribute@Name/Type/Value` | vec4 text | none | Debris_TexID_SpawnCount_* | Packed debris/dust params |
| `SmashableObjectTypes.Object@type` | text (key) | prop-placement data (unconfirmed) | 137 distinct: Fence, Mailbox, Cow, Goal, ChristmasPresents, etc. | Smashable prop catalog |
| `CollObjects` (whole file) | empty nested | none | 0 rows | Unpopulated template |
| `GroundCoverSurfaceMap.Material@name` | text | none | 3D_FML_AGAVE/BEANS/MAIZE/MARYGOLD/SORGHUM | Ground-cover crop model id |
| `.Material@Surface` | text | unresolvable in this file set (likely unopened 4MB surfaceTypes.xml) | Surface_GC_<Crop> | Contact surface id |
| `RaceEffectsPresence` (whole file) | nested, 1 disabled child | none | 0 active | Commented-out example |
| `TireEffectsDefinitions.Surface@Name` | text (key) | separate catalog from NatalSurfaceTypes (NOT joinable) | 133 values, e.g. Asphalt_Smooth, Cobbles_Lrg | FX/particle surface id |
| `.Surface@Type` | enum | none | PhysicsSurface(122), GroundCoverTemplate(11) | Surface family |
| `.Surface@InheritFrom` | text | self-ref to Surface@Name | 11/133 populated | Inherits another surface's Effect list |
| `.Surface.Effect@Name` | enum | none | 24 values: Surface_Smoke, Surface_Mud_Master, Surface_Snow_Master, etc. | Particle-FX system triggered |
| `.Effect@Range/SelfKill/MinTyreTemperatureForSmoke/MinEnvIntensity/Seasons` | mixed | none | Range 30/600; Seasons "Spring,Summer,Autumn" vs "Winter" | Gating/tuning attrs |
| `.Effect.Attribute@Name/Type/Value` | vec4/float/int/vec3 | none | 12 names: DustRGBDepth(62x), DebrisTypeAmountSizeColour(47x), etc. | Packed FX shader params |

**Scale:** 7 files, 256,367 bytes. NatalSurfaceTypes=198,863B (11 categories+37 pairs+58 surfaces, ~4,000+ leaf values); BreakEffects=11,678B/36; SmashableObjectTypes=4,686B/137; CollObjects=37B/0; GroundCoverSurfaceMap=413B/5; RaceEffectsPresence=78B/0; TireEffectsDefinitions=40,810B/133 surfaces, 158 effects, 146 attributes.

**Confidence:** probable

---

### `phys-locked-ini` — PhysicsSettings.ini (encrypted)

**Key structure:** No key, single encrypted blob. Path: `Content\media\physics\PhysicsSettings.ini`. Observable-but-unresolvable envelope: 16-byte header block (offset 0–15) + 4-byte LE int (offset 16–19) + ciphertext body (offset 20–EOF).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `header_block_16B` | blob, 16B @0 | none | high-entropy, per-file (differs from PI.xml's) | Candidate nonce/IV/salt (unconfirmed) |
| `header_int32_LE` | u32 LE @16 | none | 52 (this file); 187 in PI.xml | Unresolved — not remaining-length or block-count |
| `ciphertext_body` | blob @20-EOF | none — no bypass | 68,656 B; entropy 7.997/8.0 bits/byte, all 256 values ~uniform | Opaque encrypted physics-constants payload |

**Scale:** 1 file, 68,676 bytes, 0 decodable records.

**Confidence:** locked_no_bypass

---

### `phys-locked-surfacetypes` — surfaceTypes.xml (encrypted)

**Key structure:** No key, single blob. No filename-embedded id (only one file of this name), no header/footer structure, no recoverable delimiters. Path: `Content\media\physics\surfaceTypes.xml`.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `raw_bytes` (whole file) | blob | none resolvable; presumed authoritative surface/material friction table by name/domain | entropy = 8.0000 bits/byte (theoretical max), 0 duplicate 16B blocks in 250,241 samples; len mod 16 = 4 | Fully opaque ciphertext, no recognizable magic |

**Scale:** 1 file, 4,003,860 bytes (largest single encrypted file in the physics/ tree).

**Confidence:** locked_no_bypass

---

### `phys-pi` — PI.xml (encrypted)

**Key structure:** No key structure — single opaque file, not a table. Identified only by path: `Content\media\physics\PI.xml`.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| whole-file blob | blob | none resolvable; project's PI needs already served by decrypted `FH6_Database.sqlite` | entropy 7.92/8.0 bits/byte, all 256 byte values present, ~35% printable ASCII (vs. ~95%+ expected for real XML) | Opaque high-entropy content masquerading as `.xml`; no `<?xml` decl, no container magic |

**Scale:** 1 file, 2,148 bytes.

**Confidence:** locked_no_bypass

---

### `phys-suspension-current` — Suspension Geometry XML (159 files, current-gen)

**Key structure:** No in-file PK — each XML is a whole-file opaque blob keyed by filename. BUT resolved externally: decrypted game-DB table `List_SuspensionPhysicsType` (`SuspensionPhysicsTypeID` PK → `Name` enum → `Path` = relative filename into this store) — 92/159 files resolved by a live row (0 dangling), 67 on-disk orphans.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `filename` | text | 92/159 → `List_SuspensionPhysicsType.Path` (exact match) | pattern `[CLASS_][GeomType][_Axle][_Level][_Drivetrain][_Modifier].xml` | Physical key |
| `class_prefix` (derived) | enum | none | ROAD, SPORT, GT, RACE, RALLY, TRUCK, BUGGY, DRIFT, DRAG, VINTAGE, UPGRADE, AIR, WB, MT, DW/DWF, RED, or absent (41 files, incl. bespoke Apollo/Senna names) | Class/tuning tier |
| `geometry_type` (derived) | enum | none | Wishbone(+variants), TrailArm/Beam/Lat, FourLink, FiveLink, PanhardRod(+Dependent), Strut, SwingAxle, RevoKnuckle, Drift/FormulaD | Kinematic layout |
| `axle` (derived) | enum | none | F(36)/R(32)/unmarked(91) | Front/rear designation |
| `upgrade_level` (derived) | enum | plausibly parallels `List_UpgradeSpringDamper.Level` (unconfirmed) | L1(12)/L2(7)/L3(6)/unmarked(134) | Stiffness/travel tier |
| `drivetrain_variant` (derived) | enum | conceptually parallels `ref_drivetrain.drivetype` (no direct column) | FWD(6)/AWD(1)/RWD(2)/unmarked(150) | Drivetrain-specific rig |
| `file_size_bytes` | int | none | 2,148–14,820 | On-disk size; larger for _L3/3StageForDroop |
| `raw_bytes` | blob, TRUE CIPHERTEXT | none — no bypass | entropy 7.94–7.96/8.0; no shared prefix across files | Opaque encrypted kinematic geometry |
| `SuspensionPhysicsTypeID` (external, decrypted) | int PK | `Path`→filename; `List_SpringDamperPhysics.SuspensionPhysicsTypeID` | 94 rows: IDs 1-2(non-file), 3-19(t10/), 100-801(root) | Authoritative live index over this store |
| `Name` (external) | text enum | none | INDEPENDANT(1), SOLID(1), ARTICULATED(92, always has Path) | Axle category |
| `List_SpringDamperPhysics.*` (external, decrypted, ALREADY imported) | 44-col numeric table | `SpringDamperPhysicsID`←`List_UpgradeSpringDamper.{F,R}SpringDamperPhysicsID`; `SuspensionPhysicsTypeID`→above | 5,414 rows | Every tunable slider range (ride height, spring rate, damping bands, camber/toe/caster, bump-stop curve) — already mined into `ref_slider` |
| `List_SuspensionType.*` (external, unrelated orphan enum) | 2-col, 6 rows | none found (no column consumes it) | Leaf, Torsion, Strut, Wishbone, Multilink, Trailing (IDs 3-8) | Coarser player-facing label, not wired to any car |

**Scale:** 159 XML files (128 root + 31 t10/), ~1.02 MB total (924,912B + 111,468B). t10/ also has `List_SuspensionPhysicsType.sql` (4.7KB, stale 19-row plaintext snapshot). External: `List_SuspensionPhysicsType` 94 rows, `List_SpringDamperPhysics` 5,414×44, `List_UpgradeSpringDamper` 2,708 rows.

**Confidence:** locked_no_bypass (XML bodies); external index tables verified/imported

---

### `phys-suspension-legacy` — Suspension Geometry XML + JPG diagrams (legacy, 89 files)

**Key structure:** No numeric/composite key. Key = filename stem shared by matched pair `<Stem>.xml` + `<Stem>.jpg`. One record = one named suspension archetype (e.g. "ModernWishbone", "FWD_Strut"). No car FK in-file (a few header comments carry free-text car names, unstructured). Pairing imperfect: 82/89 exact stem match, 6 typo-shifted (e.g. RevoKnuckle-25.xml↔RevoKunckle-25.jpg), 1 orphan (no diagram). Zero repo-wide references — completely unmined.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| `file_stem` | text (key) | none confirmed anywhere in project | 89 distinct, prefix-grouped: 5Link_*, BUGGY_*, DW*/DWF*/DWR*, RACETRUCK_*, TRUCK_*, RevoKnuckle*, UPGRADE_*, WB_Rally_*, Wishbone*, Trailing*, Panhard*, Strut*, + standalones | One archetype per file |
| `Suspension/@Steered` | bool-as-string, 7 spellings ("0","1","true","false","TRUE","FALSE","True") | gates `<Kingpin>` presence (1:1 verified 89/89) | — | Front-steered vs. fixed corner |
| `Suspension/@HalfTrack` | float (m) | derives Spindle(S) x | 0.643891–1.092 | Half track width at axle |
| `Suspension/@TireRadius` | float (m) | derives Spindle(S) y | 0.2888–0.44465 | Reference tire radius |
| `Suspension/@TireWidth` | float (m) | none | 0.17–0.345 | Tire width; only 65/89 files (schema evolved) |
| `Suspension/@DroopTravel` | float (m, neg) | none | -0.5 to -0.15 | Rebound travel limit |
| `Suspension/@BumpTravel` | float (m, pos) | none | 0.15–0.5 | Compression travel limit |
| `Suspension/@UnsprungMassPortionOfBodyMassPerWheel` | float | none | 0.005–0.04 | Unsprung mass fraction |
| `Suspension/@Independent` | bool text | none | true/false | Only on 5/89 dependent-axle files |
| `Suspension/@LinearAntiDiveEffectScalar` | float | none | 0.5–1.0 | Scalar on computed anti-dive effect (only structured anti-dive-adjacent field); present 30/89 |
| `Locator` (id='A'..'N','S'..'W','Z') | array{Id enum, x/y/z float} | intra-file only, referenced by assignment groups | 5-16/file, avg 9.78; S=Spindle reserved | Raw 3D hardpoints (research→game axis conversion) |
| Assignment groups (Chassis, Upright, UpperControlArm, LowerControlArm, CoilSpring, Damper, Kingpin, TieRod, AngularConstraint, Body) | nested{NumLocators, Locator refs, optional Side} | Locator ids, same file | NumLocators 2-7 per tag | Which rigid body/mechanism a Locator subset belongs to |
| `SpringProgression` | array<float> (Scale) | none | length 21-99 pts (mode 50); ~1.00→3-5x | Spring-force multiplier curve over travel |
| `SpringProgressionDamping`/`ReboundDamping` | array<float> | none | length 50-61 (mode 55) | Bump/rebound damping curves; present 88/89 |
| `...2nd/3rd` variants | array<float>, 2 pts | none | always 2 pts | Secondary/tertiary damping stage; only 4 files (Panhard family) |
| `SuspensionXAxis/ZAxis(Rear)` | array<float> (Gradient) | none | length 2/4/5; note casing bug: "SuspensionxAxisRear"(62) vs "SuspensionXAxisRear"(25) split one field | Undocumented roll/steer gradient curves |
| header/inline comments | free text | n/a | 23/89 files carry labeled researcher notes (roll-centre height, kingpin angle, scrub radius, caster, motion ratio) — UNSTRUCTURED, not real fields | Toe-in and anti-squat% appear nowhere as real fields |
| companion diagram | JPEG, external | filename stem (88/89 paired, 6 via typo) | 1920×1080, 814-905KB | Reference photo of physical suspension type |

**Scale:** 89 XML (664,886B, avg 7.5KB) + 88 JPG (~73.5MB, avg 866KB). Directory total ~74MB. Curve lengths vary per file (not fixed).

**Confidence:** verified

---

### `phys-suspension-schema` — List_SuspensionPhysicsType

**Key structure:** Single-column PK `SuspensionPhysicsTypeID` (int), `PK_List_SuspensionPhysicsType` CLUSTERED. One row per named suspension-physics archetype. `Path` is a value column pointing OUT to a separate rig XML, not part of row identity.

**Scale:** 94 rows (RAW-01 sqlite, authoritative superset); 19 also present in live loose `.sql` (4,727 B / 171 lines).

**Confidence:** verified

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| SuspensionPhysicsTypeID | int, PK | `List_SpringDamperPhysics.SuspensionPhysicsTypeID` (5,414 rows, confirmed FK) | 1-19, 100-132, 200-201, 300-313, 400-412, 500-504, 600-609, 700-702, 800-801 (94 total) | Named suspension archetype assignable per axle; blocks track vehicle-class prefix in Path (ROAD=100s, VINTAGE=200s, RALLY=300s, BUGGY=400s, TRUCK=500/600s, DRAG/DRIFT=700s, MT=800s) |
| Name | text/nvarchar(50) | none — closed enum | ARTICULATED (92 rows) \| INDEPENDANT (1, id=1) \| SOLID (1, id=2) | Physics-model category — DOF / rigid-beam vs. independent linkage |
| Path | text/nvarchar(256) | filename key into `physics/suspension/*.xml` and `.../t10/*.xml` — those XML files are true ciphertext (high-entropy, no bypass) | always ends `.xml` when non-null | Relative path to linkage-geometry rig XML; populated only for ARTICULATED rows, NULL/'' for INDEPENDANT/SOLID |

---

### `track-locators-live` — Brio trackroutes `.nt` locator sheets

**Key structure:** Composite, no numeric key: (source `.nt` filename) + (`Locator/Name/@value`, verified unique per file, not globally). Record order = file position; ascending numeric for Eliminator.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| source_file | enum (filename) | candidate: future ref_event/route/challenge table | 37 filenames (eliminator_locators, map_region_*×10, route300x/301x/302x×9, route810x×6, parkingareas, pinata_locators, bucket/job_challenges_startend, route0, route4000x/4090x, route4004x-44×4) | Dataset/context selector — theme groupings span ≥12 game systems, not one homogeneous "locator pattern" |
| Locator/@Version | int enum | none | constant 2 (8,117/8,117) | Schema/format version |
| Name/@value | text | barn_finds_* car codes (MFR_Model_YY) → candidate ref_car FK | ~370 base-name families | Per-file unique naming key; conventions vary by dataset (eliminator_locator_NNN, Arena_NNN, parking/pinata/carmeet/dragmeet/playerhouse/sidi_* patterns) |
| GUID/@value | text (degenerate) | none | constant literal "0" (8,117/8,117) | Dead/unused field |
| SceneTransform 3×3 rotation | float[9] | none | identity in 3/37 files (eliminator, route8100/8101); otherwise real rotation, det≈1 | World-space orientation/heading |
| SceneTransform translation (._41/._42/._43) | float×3 | data/courses/*.json tiles, ref_route waypoints — same world-space | _41/_43 ≈ [-8937, 9071]; _42 (elevation) ≈ [100, 1154] | World-space position, directly overlayable on existing course/route map |
| SceneTransform homogeneous row | float×4 (constant) | none | constant (0,0,0,1), 8,117/8,117 | Affine-matrix padding, no information |
| AttachTo | element, always empty | none | always empty | Unused scene-graph parent reference |

**Scale:** 37 files, 3,817,808 B total; 8,117 `<Locator>` records; sizes 976 B–1,245,194 B. (Note: this profile documents the same live-install `.nt` locator sheets as `RAW-14` from the raw-corpus angle.)

**Confidence:** verified

---

### `track-triggerzones` — Brio `.tz` collision/gameplay volumes

**Key structure:** Composite (file path under `triggerzones/`) + (`triggerzone@name`, unique within file only — 10 names duplicated between Horizon Story/Job files). 12 subfolders = 12 mini-schemas, each with its own `@name`/`<tag>` vocabulary.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| file_path | text | none | 12 subfolders: tz_races, tz_race_activations, tz_playground_games, tz_world_constraints, tz_skyzone, tz_particles, tz_creatures, tz_oceanparams, tz_globalspecexclusion, tz_world_edge_physics, tz_bucket_challenges, tz_job_challenges | Subsystem selector; race-family filenames embed route ids |
| triggerzones (root) | container | none | one per file | Wraps 1..N triggerzone children |
| triggerzone@type | enum | none | box \| sphere \| mesh | Collision shape; determines child geometry set (box/sphere→orientation0-2; mesh→poly/vert) |
| triggerzone@name | text | `race_trigger_zone_rt<id>` / `triggers_route_<id>` → **verified FK** to `ref_route.route_id` (169 rows, 9/9 and 36/36 confirmed) | per-subfolder naming (tz_Creatures_*, HJ/HS_*_zone, race_trigger_zone_rt<id>, TZ_VFXLeaves_*, skyzone_*, landmark slugs, physics_world_constraint_*, op_globalspecexclusionzone[N], A[NN]_Triggerzone) | Zone label; unique per file |
| triggerzone@mobile | bool text | none | constant false (563/563) | Reserved runtime-move flag, unused |
| triggerzone@delay | int text | none | constant 0 (563/563) | Reserved activation-delay, unused |
| triggerzone@streamed | bool text | none | constant false (563/563) | Reserved streaming hint, unused |
| triggerzone@FORZA_SeasonExclusion | int bitmask | none | {0,7,11,13,14}; bit0=spring bit1=summer bit2=autumn bit3=winter | Seasons zone is INACTIVE; 0=all seasons active (526/563) |
| position.x/y/z | float×3 | none | ~-10000..10000 (Brio extents) | World-space center; for mesh, derived = AABB midpoint (verified to 6dp) |
| size.x/y/z | float×3 | none | — | Full extent per axis; sphere x=y=z; for mesh, derived = AABB span |
| orientation0-2 | float 3×3 matrix | none | orthonormal, \|v\|≈1.0 | Local-to-world rotation basis; box/sphere only |
| poly[]>vert×3 | array of triangles | none | always exactly 3 verts/poly (exhaustive) | World-space triangulated surface; mesh only; y near-constant (horizontal slabs) |
| tag[] @name/@type/@value | typed KV array | none | @type: String\|Int\|Float\|Bool\|Matrix | Generic per-subsystem extension block, 230/563 zones, all-or-nothing per file |
| tag Matrix variant (._11.._44) | float 4×4 row-major | none | upper-left 3×3 = identity in samples; _44=1.0 | VFX placement transform (tz_particles fx_transform only) |
| tz_skyzone tag set (17 names) | mixed | none | precipitationtype {1:129,2:10}; speed {0.5,1,4,5,6,10}; Priority 1-10; tempdeltac -5..+6°C; region enum (city/festival/etc., 37/139 populated) | Regional weather/sky-transition config, 139 zones |
| tz_creatures tag set (grp1-4 × 6 fields = 24) | mixed | grpN_creature_type: plausible species-table enum, unconfirmed | 13 species (arcticfox, redfox, dairycow, honsyusikadeer, stag, crane, etc.); grpN_count int; grpN_{season} bool×4 | 4-slot wildlife spawn table, 47 zones |
| tz_oceanparams tag set (2 names) | mixed | none | params: Forte_{Autumn,Spring,Summer,Winter,Main}; speed constant "0.0" | Named current/wave presets, 5 zones, season-gated via SeasonExclusion |
| tz_particles tag set (6 names) | mixed | none | active_radius=10000.0, spawn_probability=1.0, cooldown=0.1, fx_name_idle/evade="cam_falling_leaves_01" (all constant) | Leaf-VFX spawn config, 39 zones, identical values |

**Scale:** 31 files, 2.8 MB; 563 `<triggerzone>` records (mesh 413, sphere 127, box 23); 11,603 `<poly>` triangles; 230/563 zones (41%) carry `<tag>` extensions.

**Confidence:** verified

---

### `car-manifest-live` — per-car `Manifest.xml` (part-slot + asset index)

**Key structure:** Two-level composite. Outer: zip stem (implicit, not an XML field) = `ref_car.media_name` case-insensitive (660/660 verified). Inner: `PartEnum` alone keys a NonUpgradeablePart row; `(PartEnum, PartId)` keys an UpgradeablePart row — `PartId` (`ordinal*1000+variant*100+tier`, one 8-digit anomaly decoded as `%1000`) is globally unique corpus-wide. Model/Swatchbin/Material children are an unordered, non-deduplicated list.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| (archive) filename stem | text, implicit key | `ref_car.media_name` (case-insensitive, 660/660) | 660 stems | Which car; not itself an XML field |
| Manifest (root) | element | none | no attrs, no ns, no `<?xml?>` (0/660) | Wraps whole file |
| NonUpgradeablePart / UpgradeablePart | repeated element | see PartEnum row | only these 2 tag names ever appear (0 unexpected) | One row = one visual part-slot or one shop option; 0-9 fixed slots/car, 0-31 upgrade rows/car |
| PartEnum | text enum | dashboard/db.js & fh6_manifest.py SLOT_NAMES (car_body, rear_wing, front_bumper, rear_bumper, hood, side_skirts, roll_cage, weight_reduction) | WheelStyle(660, always fixed), Brakes(653, fixed), CarBody(551 fixed/109 upgr.), RearBumper(354/218), Hood(351/217), SideSkirts(218/203), FrontBumper(115/518, richest), ChassisStiffness(105/500), RearWing(101/510), WeightReduction(1/1) | Which visual/chassis slot |
| PartId | text (int, 6-8 digit) | `ref_car.ordinal` (via `//1000`) | min 247000, max 16620016 (1 anomaly) | `ordinal*1000+variant*100+tier`; variant 0=stock-body list, 100+=body-kit list |
| Model | repeated element | none (path ref, in-zip only) | 75,731 total, avg 7.9/row | Mesh asset at a specific LOD; can be absent |
| Model.path | text (game: path) | resolves inside SAME zip (.modelbin entry) | always ends `.modelbin`; all lowercase | Points into own car folder, never cross-car |
| Model.LODs | text int (bitmask) | none | 29 values, 1-127 (7-bit) | LOD-level bitmask; contiguous runs dominant, some gapped |
| Swatchbin | repeated element | none | 566,042 total, avg 7.5/Model | Texture-swatch ref |
| Swatchbin.path | text (game: path) | 85.8% → shared `cars/_library/textures`; 13.9% → own car folder (in-zip); 0.3% → top-level `media/_library/textures` (cross-zip, out of scope) | always `.swatchbin`; 39,160 distinct paths | Which texture; heavy reuse (566K refs → <7% unique) |
| Material | repeated element | none | 318,110 total, avg 4.2/Model | Material/shader assignment |
| Material.path | text (game: path) | 99.98% → shared `cars/_library/materials`; 50 refs own-folder; 2 refs global debug `boing.materialbin` | always `.materialbin`; only 210 distinct paths corpus-wide | Small, tightly shared material vocabulary |

**Scale:** 660 archives (not 662), 0 parse errors; Manifest.xml 7,075–716,616 B, avg 177,717 B; 3,109 NonUpgradeablePart + 6,457 UpgradeablePart rows; 75,731 Model, 566,042 Swatchbin, 318,110 Material refs.

**Confidence:** verified

---

### `car-physicsdef-family` — per-car `physicsdefinition.bin`

**Key structure:** No key inside the binary — identity is container path `cars/<CODE>.zip`, matching `ref_car.media_name` exactly. Fixed 208-byte header + 1-6 repeated variable-length curve/point blocks + short footer.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| container_key (filename) | text path | `ref_car.media_name` | 660 CODEs | Only car identifier; nothing inside binary names the car |
| hdr_version (0x00) | int32 LE | none | constant 1 | Format version |
| hdr_flag_04 (0x04) | int32 LE | none | constant 0 | Reserved |
| hdr_schema_id (0x08) | int32 LE | none | constant 31 | Schema id |
| hdr_flag_0c (0x0C) | int32 LE | none | constant 1 | Reserved |
| hdr_padding (0x10-0x34, ×10) | int32 LE | none | constant 0 | Padding |
| hdr_sentinel_slots (0x38-0x58, ×9) | float32 (qNaN) | none | constant NaN sentinel, 660/660 | 9 unused optional per-car override channels |
| car_scalar_A..D (0x5C,0x60,0x64,0x68) | float32 ×4 | none confirmed | A 0.56-1.41, B 0.42-1.98, C 0.75-6.05, D 1.40-7.47 | Real per-car values; don't match ref_car promoted columns; candidate bbox dims or curve x-range |
| hdr_padding2 (0x6C-0x78, ×4) | int32 LE | none | constant 0 | Padding |
| car_scalar_E (0x7C) | float32 | none | -0.04..+0.05 | Small angle (rad) or short offset (m), unconfirmed |
| car_scalar_F (0x80) | float32 | none | 0.42-1.98 | Tracks scalar_B range — paired quantity |
| car_scalar_G (0x84) | float32 | none | -0.77..+0.28 | Unconfirmed |
| block_count (0x88) | int32 LE | none | 1(6 files),2(570,86%),3(6),4(77,12%),6(1) | # of curve/point blocks; verified vs actual structure |
| block[i].const_tag | int32 LE | none | 5 (block 0, all files) | Per-block sub-header field |
| block[i].size_or_resolution | int32 LE | none | 288-1888 (79 distinct) | Byte-length/resolution of this curve |
| block[i].type_id | int32 LE enum | none confirmed | 3589 (648,~98%), 3845 (12,~2%) | Curve format sub-version |
| block[i].padding (×3) | int32 LE | none | constant 0 | Reserved |
| block[i].point_count (0x18) | int32 LE | none | 15-115 (79 distinct) | # of 16-byte point records following; verified matches actual run length |
| block[i].padding2 (×7) | int32 LE | none | constant 0 | Reserved |
| block[i].ref_triple | float32 ×3 | none confirmed | wide per-car range | Bounding-sphere center / origin offset, unconfirmed |
| block[i].points[j] | struct{tag,val_a,val_b,val_c} ×point_count | none confirmed | tag≈constant 0.0001f; val_a/b/c ≈ -3..+3 | Curve/LUT data — candidates: suspension travel, damper force, collision hull; unconfirmed |
| footer/trailer | int32 LE blob | none confirmed | 8B (2-block) to 62B (6-block) | Curve-list/channel terminator |

**Scale:** 660 files, 752–11,656 B (median 1,680, mean 1,990), total 1.28 MB. Entropy 4.56 bits/byte (not ciphertext).

**Confidence:** probable

---

### `car-carbin-family` — `.carbin` scene + `.carbin_debug`

**Key structure:** Pair keyed by (zip stem = `Scene.media_name` lowercased) and `Scene.ordinal` (verified 1:1 to `ref_car.ordinal`, 660/660). Row key within `.carbin`: `(Scene.ordinal, CCarParts_Enum, Upgrade.level, Upgrade.part_id)` — `Upgrade.part_id` verified FK to `ref_part.part_id`. `.carbin_debug` bound via shared `build_guid`.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| Scene.version | uint16 | none | constant 7 (660/660) | Carbin format version (FH6; FH5=6) |
| Scene.build_guid | 16B GUID | `.carbin_debug` leading GUID (byte-identical) | — | Build identifier, matches debug sibling |
| Scene.build_strict | bool | none | constant False | Build-pipeline flag |
| Scene.ordinal | uint32 | `ref_car.ordinal` (PK, 1:1 verified) | 247-4342 | Car numeric id |
| Scene.media_name | text | `ref_car.media_name` (case-insensitive) | — | Lowercase car code |
| Scene.skeleton_modelbin_path | text | none | — | Shared skeleton .modelbin path |
| Scene.levels_of_detail | bitfield u16 | none | constant 127 (all 7 LOD flags) | LOD bands shipped |
| Scene.non_upgradable_parts[] | array{type_v1, Part} | see CCarParts_Enum | WheelStyle 660, Brakes 653, CarBody 551, RearBumper 354, Hood 351, SideSkirts 218, FrontBumper 115, ChassisStiffness 105, RearWing 101, WeightReduction 1 | Fixed-geometry slot groups |
| Scene.upgradable_parts[] | array{UpgradablePart} | see CCarParts_Enum | FrontBumper 518, RearWing 510, ChassisStiffness 500, RearBumper 218, Hood 217, SideSkirts 203, CarBody 109, WeightReduction 1 | Swappable-appearance slot groups |
| Scene.unk_v6 / unk_v7 | bool | none | v6: True 659/False 1; v7: constant True | Undocumented flags |
| Part.{version,type,models_length,bounds} | uint16+enum+u32+AABB | — | version constant 2 | Wraps one non-upgradable slot |
| UpgradablePart.{version,type,upgrades[],shared_models[]} | uint16+enum+arrays | — | version constant 3 | Wraps one swappable slot |
| Upgrade.level | uint8 | `ref_part.level` (verified) | 0,1,2,3,4,10,11 (0-3 dominant) | Upgrade tier |
| Upgrade.is_stock | bool | none | — | Default/stock flag |
| Upgrade.part_id | int32 | `ref_part.part_id` (verified) | ordinal*1000+n (6,456/6,457); widebody exception: car_body_id*10+n | Part option identity |
| Upgrade.car_body_id | int32 | `ref_car_body.carbody_id` | -1 sentinel = N/A | Owning CarBody variant |
| Upgrade.parent_is_stock | bool | none | — | Whether parent CarBody is stock |
| Upgrade.bounds | AABB (2×float4) | none | — | Local-space bounding box |
| SharedCarModel.{upgrade_ids[], model} | array<int32>+CarRenderModel11 | — | — | Mesh shared across multiple upgrade ids |
| CarRenderModel11.version | uint16 | none | constant 21 (46,234+ instances) | Per-mesh sub-format version |
| CarRenderModel11.path | text | none | — | In-game virtual .modelbin path |
| CarRenderModel11.transform | float[16] | none | — | 4×4 placement matrix |
| CarRenderModel11.levels_of_detail | bitfield u16 | none | — | LOD bands for this mesh instance |
| CarRenderModel11.bone_name/bone_id | text+int16 | Scene.skeleton_modelbin_path | 25 distinct; `<root>` = 80% (36,957/46,234) | Skeleton attach point |
| CarRenderModel11.draw_groups | bitfield u32 | none | Exterior 45,867, Shadow 45,237, Cockpit 17,734, DriverlessCockpit 16,710, Hood 3,534, WindshieldReflection 1,409, ProxyLOD 16 | Render-pass membership |
| CarRenderModel11.material_overrides{} | map<string,blob> | none | present 134/46,234 | Rare embedded material data (opaque Grub blob) |
| CarRenderModel11.material_indexes{} | map<string,uint64> | none | pre-v20 fallback: 30-value bitmask enum | Mesh→paint-group binding (FH6: opaque 64-bit id) |
| CarRenderModel11.is_droppable/drop_part_data | bool+{float,uint32} | none | true on 1,533/46,234 | Removable-part flag + weight/id |
| CarRenderModel11.break_amount | float | none | — | Damage-deformation magnitude |
| CarRenderModel11.ao_map_info[] | array<AOMapInfo> | none | non-empty on all 46,234 | AO swatchbin bindings |
| AOMapInfo.{version,path,part_type,part_id,guid,is_default,lod_test,lod_value} | mixed | `CCarParts_Enum`; part_id→ref_part.part_id (plausible) | — | AO texture-to-part-option binding |
| CarRenderModel11.receives_* (impact/splatter/damage/dirt/oil/rubber) | 2 bool + 4 bool4 | none | — | Shader decal-layer acceptance flags |
| CarRenderModel11.assembly_name | text | none | 20+ values (Brakes 4,980, Doors 3,657, SecondaryLights 3,405, PrimaryLights 3,067, Windows 2,824, Wheels 2,737, etc.) | Coarse part-category label |
| CarRenderModel11.guid_v13/drop_guid_v14/ao_map_info_id_v14/unk_v15/damage_guids[]/id/unk_v18/unk0-1_v19 | mixed | none | `.id` = per-model ordering index | Later-version tail fields, several unnamed even by community template |
| CCarParts_Enum | uint32 enum (46 values) | shared taxonomy w/ ref_part.slot | only 9 of 46 appear as Part wrappers here | Full slot taxonomy (Engine, Drivetrain, TireCompound, turbo variants, etc.) |
| .carbin_debug: version tag | uint16 | none | sample=3, unconfirmed constant | Debug-file format version |
| .carbin_debug: build_guid | 16B GUID | `.carbin` Scene.build_guid (byte-identical) | — | Pairing key |
| .carbin_debug: builder_machine, build_timestamp | 2× text | none | e.g. 'PGL-HNX054', ISO-ish timestamp | Build-pipeline metadata (differs from sibling CarBuildTime.txt) |
| .carbin_debug: mesh-name log entries | repeating {tag u16,[string]} | mirrors CarRenderModel11.path | undecoded byte codes | Build/cache log of mesh/part names; no known template |

**Scale:** 660 zips. `.carbin` 9,937-102,541 B (mean 55,849, ~36.9 MB total); `.carbin_debug` 173-2,300 B (mean 1,100, ~726 KB total). `CarRenderModel11` occurs 46,234× (non-upgradable alone).

**Confidence:** verified

---

### `stringtable-en-live` — `EN.zip` localized string tables

**Key structure:** Two-level. `ref_string_table` PK = `table_name`. `ref_string` PK = composite `(table_name, key_hash)` WITHOUT ROWID (`key_hash` alone collides across tables in 1,346/56,096 cases). Raw `.str` file has no record key beyond shared array position; `hash` persists into the DB.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| header.magic[0..1] | blob(2B) | none | constant 0x0800 (u16 LE) | FH6-generation format marker (FH5=0x0400, FM6/FH3/FS=0x0300) |
| header.table_name | text char[126] ASCII | `ref_string_table.table_name` (identity) | 287 distinct | Embedded table name, matches zip stem exactly |
| header.pad | u16 @0x80 | none | constant 0 | Padding |
| header.section_field | u16 @0x82 | none | constant 2 | "section_count" (template) / "version" (project code) — moot, invariant |
| header.content_block_off | u32 @0x84 | none | constant 140 (0x8C) | Fixed 140-byte header size |
| header.key_block_off | u32 @0x88 | none | always < file length | Absolute offset of key-name block |
| block.section_size | u32 (×2/file) | none | 0..~700KB | Byte length of entry array + string pool |
| block.pool_bytes | u32 | none | 0..~600KB | Byte length of NUL-terminated string pool |
| block.count | u32 | `ref_string_table.n_entries` | 0..6,963 | Entries in table; identical between content/key blocks |
| block.entry.hash | u32 (rotl32) | `ref_string.key_hash`; hi32 pair = `ref_string_table.name_hash` | 113,867..4,294,958,667 | Key-name hash: h=0xFFFFFFFF; per byte h=rotl(h^c,7) |
| block.entry.pool_offset | u32 | none | 0..pool_bytes | Byte offset into own pool; purely structural |
| content block pool string | text (NUL-term UTF-8) | none | free text, 0..995+ chars; 921 rows empty | Localized display string → `ref_string.content` |
| key block pool string | text (NUL-term UTF-8) | none | always prefixed `IDS_` | Developer-facing symbolic key → `ref_string.key_name` |
| ref_string_table.table_name | text PK | `ref_string.table_name` | 287 values | One row per real .str table |
| ref_string_table.name_hash | u32 UNIQUE | hi32 half of game's u64 string-ref scheme | full u32 range | Hash of table_name itself |
| ref_string_table.n_entries | int | none | 0..6,963 | Row count |
| ref_string_table.has_csv | bool | none | 69 true / 218 false | Whether a ForzaTech Studio CSV export exists (coverage flag, not table count) |
| ref_string.table_name | text FK | `ref_string_table.table_name` | 287 values | Owning table |
| ref_string.key_hash | u32, PK part | — | 56,096 distinct, 1,346 recur across tables | Same as block.entry.hash |
| ref_string.key_name | text | none | prefix `IDS_` | Same as key block pool string |
| ref_string.content | text | none | 0..995+ chars | Same as content block pool string |
| zip entry: `_list.txt` | text blob, CRLF | none | 288 lines | Manifest of all zip entries; not a table, not imported |

**Scale:** 2,906,705 B, 288 zip entries (287 real tables + `_list.txt` manifest). 58,722 rows total. Per-table rows 0–6,963.

**Confidence:** verified

---

### `stripped-gamedbRC` — `gamedbRC.slt`

**Key structure:** No key structure — whole-file opaque blob, no internal headers/records/indices.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| (whole-file ciphertext body) | blob | none — content inaccessible | full 0x00-0xFF range, near-uniform histogram (counts 60,321-61,694 vs. expected 60,935.6) | Entire file is one undifferentiated high-entropy blob; no magic number, no known container signature (burG/Grub/RIFF/ZIP/gzip/SQLite/XML/JSON), zlib.decompress fails on raw and offset-8 |

**Scale:** 1 file, 15,599,508 B (15.6 MB). Entropy 7.9998 bits/byte (uniform across all 15 sampled 1MB windows).

**Confidence:** locked_no_bypass

---

### `stripped-gs-sublists` — festival substitution lists

**Key structure:** Two-level: (1) filename/root `SubstitutionList Name` → live event; (2) composite `(OldModel.value, OldModel.materialvariant)` within a file; a preceding comment gives a human label (one label reused twice per file).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| SubstitutionList.Name | text (root attr) | none confirmed (unmatched vs. CareerTrackInfo/RivalsEventData) | CrossCountryEvent \| DirtEvent \| ForzathonEvent \| RushEvent | Which live event this file's overrides apply to |
| Substitution | nested-object, repeating | n/a | 18-24/file, 81 total | One asset-swap rule |
| Substitution.comment_label | text (XML comment) | none | 18 shared (Large/Medium/Small Tent, Sunshades, Grandstand, Barriers, TV Tower, Flags, Banners, Concrete A×2, Start Gantry) + event decals | Human label for the slot |
| OldModel.value | text (path) | live install scene assets, no indexing table | prefix `tracks\Brio\scene\models\`; 4 categories (Infrastructure, barriers, props, Decals\Logos) | Default asset replaced when event active |
| OldModel.materialvariant | int | none | 0-12 | Base colorway index |
| NewModel.value | text | same as OldModel.value | can be "" (hide asset, 1 case: Rush "Festival Text Decal") | Event-active replacement asset |
| NewModel.materialvariant | int | none | 0-12 | Event colorway; presence mirrors OldModel exactly |

**Scale:** 4 files, 6,429-8,323 B each, 28,627 B total; 81 `<Substitution>` records (18 shared "core" + event-specific extras).

**Confidence:** verified

---

### `rules-zip` — `Rules.zip` rulebot definitions (encrypted)

**Key structure:** Zip entry filename = PK, pattern `<RuleBotName>.rulebot.<xml|bin>` (2 xml-only exceptions, 1 total outlier `RuleTypeMap.xml`). Logical key = `rulebot_name` (221) × `variant` (xml/bin). CRC-32 is a usable plaintext dedup key (13 duplicate-content clusters, up to 64-way).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| entry_filename | text | none | 441 distinct | Archive PK |
| rulebot_name | text | touge_NNNN/HS_C#P# may join course/event ids elsewhere (unconfirmed, content encrypted) | 221 values: HS_* (70), HJ_TC/TP_* (67), HJ_FC_* (34), *VO (23), touge_NNNN (5), HR_* (3), 19 standalone system rules | Logical rule-bot identity |
| variant | enum | none | {xml, bin} | Source vs. compiled form; bin missing for 3 rulebots |
| compress_type | int | none | constant 22 (private, unregistered) | Zip method — every media/*.zip sibling shares this |
| compress_size | int | none | 13 fixed values, all `36+528k` | Padded stored blob size — padding, not real compression |
| file_size | int | none | 48–3,654,437 B | Original plaintext length |
| crc32 | uint32 hex | none | 13 duplicate-content clusters (2-64 members) | Plaintext CRC — usable dedup key without decrypting |
| header_offset | int | none | 0–591,275 | Local header byte offset (parsing only) |
| extra_field | blob(8B) | none | tag 0x1123 constant; payload = data-start offset | Private PKWARE extra field, fast-seek pointer |
| date_time | tuple | none | constant (1980,0,0,0,0,0) sentinel | Stripped build metadata |
| create_version/extract_version/create_system/flag_bits/external_attr | int | none | 10/10/0/0/0 constants | Confirms custom in-house zip writer; encryption bit NOT set |
| payload_iv (bytes 0-15) | blob(16B) | none | high-entropy, unique per entry (0 collisions across 64-way cluster) | Per-entry IV/nonce |
| payload_length_field (bytes 16-19) | uint32 LE | none | constant per unique plaintext (e.g. 487/421/376) | Length/padding field, content-derived |
| payload_ciphertext (bytes 20-end) | blob | none — unrecoverable | 0 constant byte positions across identical-plaintext siblings | Encrypted rule content; no key material in container |

**Scale:** 441 entries = 221 rulebot names; 626,050 B container; plaintext-size sum 5,342,240 B.

**Confidence:** locked_no_bypass

---

### `gametunables-zip` — `GameTunableSettings.zip`

**Key structure:** No numeric key; `entry_path` (in-archive relative filename, e.g. `AI/AITimes.xml`) is unique and reproduces the config folder tree.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| entry_path | text | none | 122 distinct | Archive PK, mirrors game config tree |
| compress_type | int enum | none | constant 22 | Non-registered PKZIP method |
| compress_size | int | none | csize mod 528 == 36, zero exceptions | Block-cipher-padding signature, not variable-rate compression |
| file_size | int | none | 150–1,691,166 B | Claimed uncompressed size (unverifiable) |
| CRC32 | int | none | — | Standard checksum, unverifiable without decode |
| date_time | tuple | none | constant (1980,0,0,0,0,0) | Zeroed build metadata |
| flag_bits | bitfield | none | constant 0 | Encryption bit unset — lock is not standard zip crypto |
| extra field (0x1123) | blob(8B: id+size+u32) | none | monotonic increasing counter, imperfectly predictable (8/121 transitions matched naive model) | Probable internal fast-seek offset |
| create_system/create_version/extract_version | int×3 | none | 0/10/10 | Plain old-style zip writer |
| external_attr/internal_attr | int×2 | none | constant 0 | No OS attrs |
| [LOCKED] payload content | unknown | none — no bypass found | entropy 7.98/8.0 | All 122 entries unreadable; DEFLATE/zlib/gzip/bz2/lzma/magic-byte attempts all failed |
| entry group: AI/ (16) | n/a, filename-inferred | none | AITimes, 15×Convoy_*, CarLoadingSettings, DensitiesHideAndSeek, RacingAI | Drivatar/traffic AI timing & density, probable |
| entry group: DataManager/ (14) | n/a | none | App, AppDatabase, CommonInput, Defaults, Memory, Metrics(largest,175,851B), TrackMetrics, UI, Wheel, etc. | Engine subsystem config, probable |
| entry group: DefaultGarageLayouts/ (13) | n/a | none | 8 numbered Default-House + named layouts | Garage prop-placement templates, probable |
| entry group: WeatherScript/ (16) | n/a | none | 8 paired cu1_/launch_ × {autumn,spring,summer,winter} .bin+.xml | Compiled weather-sequence timelines, probable |
| entry group: root-level (30) | n/a | none | ANNARecommendations, AudioPresets, GameTunableSettings.ini, Stats.xml(largest, 1,227,980B), track_properties.xml, RaceFeats, Skills, etc. | Flat gameplay-config files, most telos-adjacent: Stats.xml, track_properties.xml, ANNARecommendations.xml |
| remaining groups: Estate/, Horizon_Stories/, IE_Time/, IE_Weather/, LiveryStressOptions/, Navigation/, Rush/, Showcase/ | n/a | none | Estate 2 large files (1.48/1.69MB); Navigation/RoadSpeeds.xml (1, course-adjacent) | Small per-mode/chapter config stubs, probable |

**Scale:** 1,941,180 B, 122 entries (110 xml, 9 bin, 2 json, 1 ini); locked bytes sum 1,923,672; claimed-uncompressed sum 10,150,800 (5.28x).

**Confidence:** locked_no_bypass

---

### `locked-config-family` — `stateflow.zip` / `Camera.zip` / `ProfileSchema.zip`

**Key structure:** Composite `(archive_file, entry_path)`. 373 entries: stateflow.zip (128, flat), Camera.zip (244: 28 flat + 216 under `Test/<Category>/`, 12 categories), ProfileSchema.zip (1 entry).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| archive_file | enum | none | stateflow.zip \| Camera.zip \| ProfileSchema.zip | Which physical zip |
| entry_path | text | none | e.g. "network_eliminator.xml", "Test/BrioArt/Area13_0.xml", "ForzaProfile.sch" | Record key within archive |
| compress_type | int | none | constant 22 | Proprietary method |
| compress_size (csize) | int | none | `36+528n`, n up to 61 (global.xml) | Fixed-page-padded ciphertext |
| file_size (usize) | int | none | 65–421,824 B (CameraPhysics.xml largest) | Plaintext length, stored in clear |
| crc32 | int | none | 5 Camera.zip AutoVista_player_house_*.xml share crc — proven identical plaintext | Plaintext CRC, clear |
| payload_header (first 36B) | blob | none | high-entropy, unique per entry (no shared magic) | Per-entry IV/nonce+MAC (exact split unverified) |
| payload_body | blob | none — no bypass | entropy ~7.6 bits/byte; size = multiple of 528 | Encrypted body, page-quantized |
| flag_bits/create_version/extract_version/create_system/date_time/external_attr/internal_attr/extra_field | mixed, 7 fields | none | all constant: flag=0, ver=10/10, system=0, date=(1980 sentinel), attrs=0, extra=empty | Confirms one bespoke packer wrote all 3 archives |
| [stateflow.zip] content shape | XML, locked | none | 128 flat entries incl. `network_eliminator.xml`, `recommendation.xml`, `race_flow.xml`, `route_blueprint/switch.xml`, `drift_zones.xml`, `speed_traps/zones.xml` | UI/gameplay finite-state-machine flow defs; names only, content locked |
| [Camera.zip] content shape | XML/INI, locked | none | 28 real (CameraPhysics.xml largest, CameraLenses, CarRelativeCams, 321Cams, 3 ini) + 216 `Test/*` dev-debug snapshots | Gameplay + debug camera config; content locked |
| [ProfileSchema.zip] content shape | blob, locked | possible: `User_<id>` profile-bucket save containers (unverified, name-inferred) | single entry, 69,105 B declared | Plausible field-layout schema for the profile save format |

**Scale:** stateflow.zip 575,790 B/128 entries; Camera.zip 511,342 B/244; ProfileSchema.zip 7,566 B/1. All method 22.

**Confidence:** locked_no_bypass

---

### `wheel-ffb` — `wheeltunablesettingspc.zip` (peripheral force-feedback INI)

**Key structure:** One record = one `.ini` = one hardware profile, keyed by filename `ControllerFFB-<VendorProduct>.ini` (8-hex VID:PID). 2 sentinel records: `ControllerFFB.ini` and `ControllerFFB-0000000000.ini`, both FriendlyName="Default", byte-identical physics fields.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| VendorProduct | text (hex) | none — matched at runtime against OS USB VID:PID, not a game store | 46 real 8-hex values + "0000000000" sentinel | Wheel hardware identity, duplicated in filename |
| FirwareVersion | int | none | {0,1,3,20} | Firmware revision selector (note source misspelling) |
| FriendlyName | text | none | 45 distinct; "Default"×2, "TS-XW"×2 | Human wheel model name; not unique |
| PowerLevel | float | none | {-0.01, 0.25, 1} | Overall force-motor power cap |
| DynFFBScale | float, signed | none | -1.25..2 | Dynamic torque scale; sign flips per driver quirk |
| DynFFBMaxForce | float | none | constant 1 | Clamp on DynFFBScale |
| Left/RightVibrationType | int enum | none | constant 1 | Rumble waveform selector |
| Left/RightVibrationAmplitude | float 0-1 | none | Left 0.2-0.8; Right 0.15-0.5 | Rumble strength |
| Left/RightVibrationWavelength | int/float ms | none | Left 10-150; Right 25-120 | Rumble pulse period |
| InMenuSpringScale | float | none | {0.4,0.5,1} | Menu center-return spring |
| InRaceSpringMaxForce / Scale | float | none | MaxForce 0.2-0.5; Scale 0.05-1 | Driving center-return spring |
| InRaceDampingMinForce/MaxForce/Scale | float | none | Min {0,0.25}; Max 0.1-1; Scale 0.05-2 | Base rotation-resistance damping |
| ForceLinearity/InitialLinearityPoint/InitialForceLinearity | float 0-1 | none | {0.5,0.6}; point constant 0.1 | Near-center torque response curve; full-schema cohort only |
| SpringScale{RearSlip,Speed,Load,WaterDrag}{0,1,Scale0,Scale1} | 16 floats | none | Load family: full cohort only | 4 independent 2-point spring-scale curves |
| MechanicalTrailScale/PneumaticTrailScale/PneumaticTrailCasterScale/CasterScaleMin/Max | 5 floats | none | Trail 1.5-3; Pneumatic ~0.2-0.35/0.5; Caster 6-9 | Self-aligning-torque/caster model |
| SteerTorqueMinNormLoadIn0/MaxNormLoadIn1/MinNormLoadOut0/MaxNormLoadOut1/MinNormLatFric/MaxNormLatFric | 6 floats | none | LoadIn 1.5-2/5; LoadOut 1-1.5/2; LatFric 1-2/3-3.5 | Normalized torque-vs-load and lateral-friction curves |
| StationarySteerFriction/VelocityTreshold | float | none | Friction 0.05-0.5; Threshold constant 0.01 | Stationary steering friction (note misspelling) |
| SteerTorqueShouldSmooth | bool | none | true only for DD1/DD2/Simcube2 Sport | Torque smoothing filter enable |
| SteerTorqueSmoothSpringK/D | float | none | K {1000,10000}; D {1,3.0} | Smoothing spring constants |
| DampingAtMinSlip/MaxSlip/MinSlip/MaxSlip/SlopeAdjust | 5 floats | none | each {0,1} | Slip-dependent damping curve |
| DampingScaleOffroad/Snow | float 0-1 | none | Offroad {0,0.9,1}; Snow {0,0.8,1} | Surface damping multipliers |
| RoadFeel{Scale,Smoothing,PowerCoeff}{Asphalt,Offroad,Snow} | 9 floats | none | Scale asphalt 0.05-0.7/offroad&snow 0.3-0.8; PowerCoeff constant 1 | Per-surface road-texture FFB |
| RoadFeelMinSpeed/MaxSpeed/TorqueClamp/MinSlipInput/MaxSlipInput/MinSlipMultiplier/MaxSlipMultiplier | 7 floats | none | MinSpeed=2, MaxSpeed=10 constant; TorqueClamp 0.3-0.5 | Speed-gated, slip-scaled road feel |
| DegreesOfRotation | int enum+sentinel | none | -10 (auto/unset) or 900 (RS50 only) | Wheel rotation lock; full 77-field cohort only |

**Scale:** 47 entries, 196,998 B container, 84,477 B uncompressed (avg 1,797 B/file). Not tuning-relevant (peripheral FFB only).

**Confidence:** verified

---

### `aidensities` — AI traffic-density presets per game mode

**Key structure:** Filename-keyed, two-schema store: `DensitySet_<mode>.xml` (defaultDensity scalar + `DensityWayValue@way` overrides) and `DensityValues_<mode>.xml` (traffic caps, ParkingDensity, `DensityList@cartype` → 8 fixed `Density@id/@name` rows). Joined only via shared mode token in filenames.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| _mode (filename token) | enum | probable game-mode enum elsewhere (unconfirmed) | CityTour, Default, HideSeek, IE, Race (+Sim, DensityValues only) | Game-mode PK |
| DensitySet/@defaultDensity | numeric (int-rendered) | none | 0 or 1 observed | Density for ways not explicitly overridden; IE=1(max everywhere), CityTour=0(zero except 42 ways) |
| DensitySet/DensityWayValue/@way | int | unconfirmed — candidate Brio_00.nav road-spline ids (way ids exceed 1,532 spline count, so not 1:1) | 116-4969, sparse | Road/way id being overridden; only in CityTour (42 rows) |
| DensitySet/DensityWayValue/@density | numeric | none | only 1 observed | Per-way override value |
| Densities/@allowedVehicles | int (bitmask/cap?) | none confirmed | only 13 (0b1101) | Vehicle-class gate; present CityTour/IE/Race only |
| Densities/@maxtrafficperplayer | int | none | only 0, CityTour only | Per-player traffic cap; semantics of literal 0 unclear |
| Densities/@despawnradius | int (m) | none | only 400, CityTour only | Traffic despawn distance |
| Densities/ParkingDensity/@min,@max | float | none | min=max=0.1 constant (5/6 files) | Parked-car density band; absent in Sim |
| Densities/DensityList/@cartype | enum | none | traffic \| festival | Which parallel density table; Sim has festival only |
| Densities/DensityList/Density/@id | int | co-key with @name | 1-8, fixed order every file | Road-type bucket ordinal |
| Densities/DensityList/Density/@name | enum | **verified match** (5/8) to `ref_route_surface.road_type`/`ref_route_turn.road_type` in db/schema.sql | empty, a, b, dirt, freeway, trail (matched) + a_high, b_high (unmatched — open question) | Road-type/traffic-class bucket |
| Densities/DensityList/Density/@color | hex RGB | none | 8 fixed hex values | Debug/editor visualization color |
| Densities/DensityList/Density/@min,@max | float | none | 0.01(Race b/dirt)–2.0(Sim freeway anomaly); trail/empty never populated | Per-mode traffic spawn band; festival lists (4 of 5 modes) carry no min/max at all |
| Densities/DensityList/Density/@speed | int (mph, presumed) | none | a=50,b=40,dirt=30,freeway=70,a_high=40,b_high=30 (traffic cartype only) | Reference speed; _high variants are slower/busier, not faster |

**Scale:** 10 files, ~8.5 KB; 42 DensityWayValue overrides (all in CityTour); 88 Density row-instances (8 names × up to 2 cartypes × 5 files + 8 Sim).

**Confidence:** probable

---

### `everything-else-art` — static art/audio/UI asset library (17 folders)

**Key structure:** No relational key — static read-only install tree. Naming conventions vary per folder (one .zip per named preset/prop/part variant; XML/GUID keys for character customization slots).

| Field (folder) | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| hdrskies/ | zip (Deflate) | none | 33 zips (e.g. Forte_Autoshow_01.zip) | HDRI/reflection-probe textures per named sky preset |
| ui/ | mixed: swatchbin, bk2, vfont, GPU-API .bin, zip | none | 962 loose swatchbin + 479 loose bk2 + 162 zips | UI textures, menu videos, fonts, per-API shader effects |
| audio/ | .bank(FMOD), xml, zip | modularcars/enginesynth filenames embed car codes — no confirmed numeric join | 2,807 .bank, 2,469 root xml, 1,047 zip | Sound routing, per-engine-template and per-car synth config |
| cinematic_assets/ | zip>1 modelbin each | none | 4,924 zips | Per-object cutscene/photo-mode mesh library |
| _library/ | zip (Deflate), each many entries | none | Materials.zip(2,004), Shaders.zip(12,265), Textures.zip(1,508) + page-cache dirs | Shared asset library referenced by name from everywhere else |
| particles/ | zip | none | Materials.zip(2,040), Shaders.zip | VFX particle materialbin/shaderbin |
| livery/ | zip>many modelbin | shape-id-like entry names, no catalog table found | Decals.zip(536), DecalsHiRes.zip, Vinyls.zip(1,480) | Static livery-editor shape library (distinct from saved-paint C_livery) |
| charactercustomisation/ | xml (plaintext) | none | ~35 named slots (Body, Face, Hair, ProstheticArms_left/right, BodyType, etc.) | Driver-avatar customization catalog and slot schema |
| crowds/ | zip (skeld+clipd) | none | skeleton.skeld + 2 clipd (opus_female/male stand) | Background-crowd NPC skeleton/animation |
| brakes/ | zip>modelbin only | cosmetic-enum-shaped names, spec data lives elsewhere | Caliper{2,4,6}_Pistons, Rotor_{Carbon,Drilled,Steel} | Cosmetic brake-part geometry only, no physics/spec |
| timeofday/ | xml + .ppr | none | TimeOfDay{,A,B}.xml + Homespace/TimeOfDay/TimeOfDay_Brio.ppr | Post-effects params + lighting-rig curve data (new .ppr format) |
| graphicscache/ | binary, magic 'cOSP' | none | 2 .dat (Cars_precache, Track_820_precache) | Likely GPU shader/PSO cache, ephemeral/regenerable |
| lensflare/ | xml | none | 1 file, named LensFlare rigs (e.g. 'Anamorphic') | Lens-flare layer definitions |
| weather/ | xml + .ppr + .bin | none | Presets{,Island}.xml, WeatherManager.ppr, WindField.bin (64×64 float grid) | Weather states, transition graph, wind-vector grid |
| water/ | .ppr | none | Water.ppr (ShorelineWaves keys) | Wave/foam/lip intensity rig |
| dynamicpost/ | xml | none | 4 vignette presets (dry/wet × day/night) | Post-process vignette config |
| deformableterrain/ | .ppr | `_library/Textures.zip` swatchbin namespace | DeformableTerrain.ppr | Terrain-deform sweep-region config |

**Scale:** ~33.4 GB, ~12,930 files across 17 folders (hdrskies 14 GB/33; ui 8.9 GB/1,603; audio 5.6 GB/6,323; cinematic_assets 2.6 GB/4,924; _library 2.2 GB/15+; particles 38 MB/2; livery 16 MB/3; charactercustomisation 12 MB/5; crowds 7.0 MB/1; brakes 5.6 MB/6; timeofday 3.1 MB/6; graphicscache 2.9 MB/2; lensflare 176 KB/1; weather 72 KB/6; water 8.0 KB/1; dynamicpost 12 KB/1; deformableterrain 4.0 KB/1).

**Confidence:** verified

---

## Save containers and live runtime

### `save-tuning-containers` — `Tuning_<ordinal>_<ts>` save containers

**Key structure:** Folder name = key: `Tuning_<ordinal>_<yyyymmddhhmmss>`. Each folder holds 3 sibling files (`Data` 598B fixed, `header`, `Thumb.png`). Secondary content key: 16-byte setup GUID in header trailer (476/534 distinct in prior study).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| dirname.ordinal | int | `ref_car.ordinal` | 1..~4000 | Car ordinal from folder name (authoritative) |
| dirname.saved_utc | text | none | — | UTC save timestamp from folder name |
| Data[0x00] version | uint8 | none | constant 3 | Tune binary format version |
| Data[0x01] locked | uint8 bool | none | 1062 locked / 98 self-made (of 1,160) | Downloaded (locked) vs. self-made (editable) |
| Data[0x02] ordinal | uint16 LE | `ref_car.ordinal` | matched dirname 100% | In-file car ordinal copy |
| Data[0x04:0x0E] reserved_1 | blob(10B) | none | constant `00 00 01 00 00 00 01 00 00 00` | Undocumented constant region |
| Data[0x0E:0xD6] parts (50×uint32) | array | `ref_part(slot,part_id)`, `ref_slot(slot)` | sentinel 0xFFFFFFFF = empty | 50 fixed-order part-slot catalog IDs (`id//1000`=family, `id%1000`=tier) |
| Data[0xD6:0x19E] padding (50×uint32) | array | none | constant 0xFFFFFFFF, 58,000/58,000 | Reserved/unused capacity |
| Data[0x19E:0x256] sliders (36×float32) | array | `ref_slider.slider`; `ref_part_slider(slot,part_id,slider)` | 30 meaningful, 6 `_unk_` placeholders | Normalized 0-1 slider positions (downforce, brakes, diff, camber/toe/caster, springs/ARB/ride-height/bump/rebound) |
| _unk_01BA/01BE/01C6/01CA/0226/022A | float32 ×6 | none | each single constant (0.1/1.0/1.0/0.5/1.0/0.5) | Format constants, not real per-tune data |
| handbrake | float32 | none | constant 0.1818 | Not user-adjustable |
| tcs_slip | float32 | none | 4 distinct values (0.0067 dominant) | Internal TC threshold, varies by car/class |
| rear_caster | float32 | none | {0.0, 0.6667} only | Quantized fixed-chassis constant |
| Data[0x22E:0x256] gears (10×float32) | array | `data/global-slider-ranges.json` gear band | -1.0 sentinel = unused | Normalized gear-ratio positions; gear_count distribution 1/4/5/6/7/8/9/10 |
| header.version | uint32 | none | constant 7 | Header format version |
| header.title | UTF-16LE length-prefixed | none | — | Tune display name |
| header.description | UTF-16LE length-prefixed | none | empty 698/1160 (60.2%) | Free-text description |
| header.created (SYSTEMTIME) | struct(8×u16) | none | — | UTC creation time; predates saved_utc for downloaded tunes |
| header.flag_1 | uint32 | none | constant 1 | Unnamed flag |
| header.creator_xuid | uint64 | none | never zero | Original author's XUID |
| header.creator | UTF-16LE length-prefixed | none | — | Author's gamertag |
| header.trailer.flag_2 | uint32 | none | constant 1 | Unnamed flag |
| header.trailer.reserved_2 | blob(8B) | none | constant 0 | Reserved |
| header.trailer.setup_guid | 16B GUID | conceptually = tune_container.setup_hash (not cross-checked by import script) | — | Setup-identity GUID |
| header.trailer.mid_tag | uint32 | none | {513:1154, 1:6} | Unexplained anomaly on 6/1160 files |
| header.trailer.mid_ordinal | uint16 LE | `ref_car.ordinal` | matched 100% | 3rd redundant ordinal copy |
| header.trailer.setup_guid_repeat | 16B GUID | == setup_guid | byte-identical 1160/1160 | GUID repeated at file end |
| Thumb.png (file) | blob | none | burG 820 (70.7%), WEBP 340 (29.3%); true PNG never observed | Format detected by magic bytes, not extension or locked flag |

**Scale:** 580 unique containers (junction-deduped from 1,160 raw reads). Data fixed 598 B; header 123-381 B; Thumb.png 35,508-252,812 B; ~190 MB total.

**Confidence:** verified

---

### `save-livery-containers` — `Livery` / `SoulBoundLivery` / `BaseLivery` save containers

**Key structure:** Folder key `{ContainerType}_{car_ordinal}[_{mesh_variant}]_{timestamp}`, ContainerType ∈ {Livery, SoulBoundLivery, BaseLivery}. Most stable content-identity key: `header.trailer.livery_asset_guid`, always populated, links SoulBoundLivery back to its source Livery.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| folder.container_type | enum | none | Livery(373, has thumb) \| SoulBoundLivery(59) \| BaseLivery(33) | Container kind |
| folder.car_ordinal | int | `ref_car.ordinal` (verified 7/7) | — | Which car |
| folder.mesh_variant | text token, optional | none | `m<n>` (post-2026-07-11) vs. `u<hex>ffff...` (pre-2026-06-27, 2 cases) | Body/paint-slot variant selector; naming-convention change over time |
| folder.timestamp | text 14-digit | none | — | Local save time; differs from header.created for downloaded content |
| header.format_version | u32 | none | constant 7 | Header schema version |
| header.title | UTF-16LE len-prefixed | none | 'Forza BaseLivery'/'Forza SoulBoundLivery' literal for those types | Livery display name |
| header.description | UTF-16LE len-prefixed | none | empty for Base/SoulBound | User tag/description text |
| header.created_systemtime | struct(8×u16) | none | verified against real date (Fri Aug 28 2026) | Creation timestamp |
| header.container_type_id | enum int | none | 3=Livery, 4=BaseLivery, 5=SoulBoundLivery | Redundant int copy of container_type |
| header.creator_xuid | u64 | matches local profile XUID for BaseLivery; matches source Livery for SoulBound | — | Author's XUID; embedded 2nd time in C_livery yrvl#1 |
| header.creator_gamertag | UTF-16LE len-prefixed | none | empty observed once (SoulBound) | Author's gamertag |
| header.trailer.has_shared_id_flag | u32 bool | mirrors clivery.vlrc field1 | 1=Livery/SoulBound, 0=BaseLivery | Shareable-content flag |
| header.trailer.shared_livery_guid | 16B GUID | none | all-zero when flag=0 | Original shared-asset identity |
| header.trailer.format_marker | u16 | none | constant 513 | Trailer sub-version |
| header.trailer.content_checksum | u16 | none | unconfirmed (candidate CRC16) | No correlation found to size/ordinal/timestamp |
| header.trailer.ordinal_echo | u16 | `ref_car.ordinal` (verified 8/8) | — | 3rd redundant ordinal copy |
| header.trailer.livery_asset_guid | 16B GUID | self-referential: SoulBoundLivery→source Livery | always populated | Stable content-identity key |
| C_livery (whole file) | binary [u32 clen][u32 ulen][zlib] | none | verified clen+8==filesize, decompress succeeds 8/8 | zlib-wrapped paint payload |
| clivery.vlrc (root chunk) | struct(FourCC+5×u32) | field3=car_ordinal (matches folder/header) | field0=2 constant; field4 varies 0-9, unconfirmed | Root wrapper |
| clivery.yrvl#1 | struct(tag+u32+8B XUID+u32+u32) | XUID matches header.creator_xuid | subtype constant 19 | Small index chunk, length-checks the next chunk |
| clivery.gyvl | blob, mixed int32/float32 | none | size scales with paint complexity (~948-2,379B samples) | Paint/pattern payload; exact record stride unresolved |
| clivery.yrvl#2 | struct(tag+5×u32+20B) | none | (0,1,varies,16,16) | Small index/count header, unconfirmed |
| clivery.yrvl#3 | blob, repeating packed | none | 0xFFFFFFFF runs + float cluster near 0x206a3e | Probable vector-path/spline point list (vinyl outline); stride unresolved |
| clivery.yrvl#4 (terminator) | struct(tag+4B) | none | constant -1.0 (0x000080BF) | End-of-stream sentinel |
| bigThumb.webp | RIFF/WebP VP8L+alpha | none | present only for Livery (373/373) | Rendered paint preview |

**Scale:** 465 containers (373 Livery + 59 SoulBoundLivery + 33 BaseLivery), 47.5 MB total (headers ~83KB, C_livery ~14.4MB, bigThumb.webp ~34.4MB dominant).

**Confidence:** verified

---

### `save-garage-estate-prop` — `GarageLayout` / `Estate` / `PropPrefab` containers

**Key structure:** Folder key `<ContainerType>_<uuid>`, ContainerType ∈ {GarageLayout, Estate, PropPrefab}; no internal record key (all payloads opaque). `C_GarageLayoutsDataContainer` is a singleton index over the 8 GarageLayout containers (unconfirmed, name-inferred).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| container_folder_name | text | none — no other store references these uuids | GarageLayout(8), Estate(2), PropPrefab(1) | Record PK: `<ContainerType>_<uuid>` |
| header | blob, encrypted | none confirmable | 564B (9/11) or 1092B (2/8 GarageLayout only) | Per-container metadata, presumed name/timestamp/XUID by analogy to Tuning header; entropy 7.6-7.8 |
| GarageLayoutData/EstateData/PropPrefabData | blob, encrypted | none | GarageLayoutData 117,780-319,476B; EstateData 261,396-263,508B (tight); PropPrefabData exactly 564B | Main payload per type; entropy 7.99-8.00 |
| CustomFlyer | blob, encrypted | none | 72,372-152,628B; GarageLayout only (8/8) | Presumed showcase image, name-inferred; no image magic found |
| thumb.png | blob, encrypted (NOT real PNG) | none | 153,684B, 1 sample (PropPrefab only) | Entropy 7.999, no PNG/WebP/zlib magic — corrects census claim it's a viewable image |
| C_GarageLayoutsDataBlob | blob, encrypted | probable: 8 GarageLayout_<uuid> folders, unconfirmed | singleton, 564B | Presumed index/manifest over GarageLayout containers |
| byte[0:16] of every file | blob | none | high-entropy, unique per file (no cross-file repeat) | Probable per-file IV/nonce |
| byte[16:18] of every file | uint16 LE (inferred) | none | 8-508 across 30 samples | Small tag between IV and ciphertext, meaning unresolved |
| byte[18:20] of every file | uint16 (constant) | none | constant 0x0000 (30/30) | Only fully non-random field found |
| byte[20:end] of every file | blob | none | 7.99-8.00 bits/byte | Ciphertext body |

**Scale:** 11 containers, 32 files, 3,436,848 B (GarageLayout 24 files/2.69MB, Estate 4/513.7KB, PropPrefab 3/151.2KB, index 1/564B).

**Confidence:** verified

---

### `save-customroute` — `CustomRoute_<slot>_<ts>` container

**Key structure:** No accessible in-content key (all ciphertext). Folder key `CustomRoute_0000_<ts>`; 3 sibling files `RouteData`, `ContributorData`, `header`, each unique per container.

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| container_dirname | text | none | slot 0000 (only sample) | Composite key: prefix + slot + save timestamp |
| RouteData (whole file) | blob, ciphertext | none | entropy 7.93 bits/byte | Route geometry (waypoints/checkpoints), unreadable |
| RouteData bytes[0:16] | blob(16B) | none | high-entropy, candidate nonce/IV | Unverified |
| RouteData bytes[16:20] | uint32 LE | none | value 134 (this file) | Candidate declared-length, doesn't reconcile with remaining size |
| RouteData bytes[20:end] | blob | none | 2,656 B | Remaining ciphertext, no structure found |
| ContributorData (whole file) | blob, ciphertext | plausibly same XUID space as Tuning header creator field, unconfirmed | entropy 7.66 bits/byte | Presumed co-op route-contributor list |
| ContributorData bytes[0:16]/[16:20]/[20:end] | same framing | none | declared-length field = 500; 544B remaining | Same shape as RouteData |
| header (whole file) | blob, ciphertext | presumed creator/XUID → User_<id> bucket & Tuning-header, unconfirmed | entropy 7.61 bits/byte | Presumed route name/desc/creator/timestamp, by analogy |
| header bytes[0:16]/[16:20]/[20:end] | same framing | none | declared-length field = 328; 544B remaining | Same 20-byte framing; header & ContributorData both total exactly 564B/544B ciphertext despite different declared lengths |

**Scale:** 1 container (1 sample of 1,063 total containers). RouteData 2,676 B, ContributorData 564 B, header 564 B; 3,804 B total.

**Confidence:** verified

---

### `save-index-profile` — profile/sync index (`User_<id>` buckets + JSON manifests)

**Key structure:** 3 encrypted buckets by path: `C_GarageLayoutsDataContainer\` (single blob, no key), `User_90000002F8742\` (filename-keyed: 7 fixed singletons + 489 `CampaignThumb_<uint64>` rows), `User_90000002F8742_Backup\` (2 of 7 singletons only). Plus 3 plaintext JSON sidecars one level above ContainersRoot: `107.json`, `2533274793510722_16D460.json`, `extended-107-manifest.json` — the last a real index (`v1.Folders[].{Id,Name}` for all 1,056 containers; `v1.Files[].Extract[].{FileId,Name,Size,...,SkipFile,FolderId}`, FolderId→Folders.Id FK).

| Field | Type | Join Target | Enum/Range | Meaning |
|---|---|---|---|---|
| bucket_dir_name | text | none | C_GarageLayoutsDataContainer \| User_<XboxUserId> \| User_<XboxUserId>_Backup | Top-level bucket selector |
| C_GarageLayoutsDataBlob | blob, encrypted | probable: sibling GarageLayout containers (out of scope) | 564B | Presumed index, unrecoverable |
| `<XUID>Meta` | blob (filename carries plaintext XUID) | matches path segment & Manifest.UserId | 564B | Metadata singleton; filename itself readable |
| C_ProfileData | blob, encrypted | none | 757,716B | Primary live profile payload (career/garage/currency, probable) |
| C_ProfileData_SCopy | blob, encrypted | == C_ProfileData (sha256-verified) | — | Live shadow/sync mirror, not independent |
| C_ProfileBackup | blob, encrypted | none | ~756-757KB | Distinct older snapshot; 3 coexisting generations across buckets |
| TransactionLogFile | blob (2×uint32 LE, plaintext) | none | observed [1,0] | The one NON-ciphertext file in this store, entropy 0.54 |
| VersionFlags / VersionFlags_SCopy | blob, encrypted | SCopy == VersionFlags (sha256) | 564B pair | Presumed per-title feature/version bit flags |
| CampaignThumb_<id> | blob, encrypted, filename-keyed | none | id spans up to 18.4×10^18 (uint64, non-sequential); 8,484-53,364B | Confirmed NOT images despite name; same wrapper as Meta/header |
| [SHAPE] encrypted-container wrapper | byte layout | none | total = 20+16k bytes | 16B IV + 4B uint32 (unclear) + k×16B AES-CBC-shaped blocks; applies to every payload except TransactionLogFile |
| 107.json: Manifest.UserId/GameId/DeviceId | text | UserId↔Meta filename; GameId↔path segment; DeviceId↔extended-manifest DeviceId | — | Account/title/device identity |
| 107.json: Manifest.Version/BaseVersion/Status/Created/LastWrite/UploadProgress/Chunks | mixed | none | Status: only 0 observed | Local container-set revision & sync state |
| 2533274793510722_16D460.json: Context.Aumid/PackageFullName/LastHR/ProcessId | text | none | Aumid = 'Microsoft.ForteBaseGame_...!Forzahorizon6' (confirms "Forte" codename); build 3.430.771.0 | Game package/build identity |
| 2533274793510722_16D460.json: Context.SaveDescription | text, base64 | none | decoded: "Time Driven 241h31:34 / XP 17,066,060 / Cars In Garage 752 / Discover Japan 44,625 / Horizon Festival 65,565" + session GUID | Human-readable profile summary shown in Xbox save UI |
| 2533274793510722_16D460.json: Context.SessionId/SyncErrorCode/SyncStatus/TotalQuota/TotalSize/UploadSize/UploadVersion | mixed | UploadVersion↔Manifest.BaseVersion | TotalQuota=1,073,741,824 (1GiB); SyncErrorCode/Status only 0 observed | Cloud-sync session/quota/size state |
| extended-107-manifest.json: v1.Folders[].{Id,Name} | GUID/text | Name prefixes → all container types project-wide | 1,056 entries: Tuning(575), Livery(370), SoulBoundLivery(59), BaseLivery(35), GarageLayout(8), User(2), Estate(2), etc. | Flat directory index for the ENTIRE save profile |
| extended-107-manifest.json: v1.Files[].{FileId,Name,CompressSize,Size,Compression,LastModified} | mixed | none | Compression: only 'zip' observed (3rd distinct zip family vs. Deflate/method-22) | Underlying cloud-sync zip blobs |
| extended-107-manifest.json: v1.Files[].Extract[].{FileId,Name,Size,Created,LastModified,SkipFile,FolderId} | mixed | FolderId → v1.Folders[].Id (self-referential FK) | SkipFile {true,false}; exactly 1 false per FileId = current revision | Per-file revision-history index; 3,585 entries |

**Scale:** C_GarageLayoutsDataContainer 1 file/564B; User_90000002F8742 496 files/18,743,876B; _Backup 2 files/757,224B; sidecars 294B + 604B + 935,376B (1,056 folder entries, 11 file-blob records, 3,585 Extract entries).

**Confidence:** probable

---

### `save-misc-plaintext` — SaveVersion + Profiles (input-remap XML)

**Key structure**
- Two independent files, no cross-file PK. File 1 `SaveVersion/SaveVersion`: no key; the whole 40-byte file is one fixed-layout record. File 2 `InputTranslationManager_90000002F8742/Profiles`: no top-level key (whole file = one `<Profiles>` document), but its 20 child profile elements are individually keyed by `Id` GUID attribute (verified unique: KeyboardProfile×5, ControllerProfile×5, WheelProfile×5, RawGameControllerInputMappingProfile×5).
- Sub-records (Context, Value, ButtonInput, GamepadWheelInput) have no independent key — positional children addressed by (profile Id, Context enum, Value/Command enum).
- Exactly one instance of each file exists under GameSave (1 user id, save slot 107, 1 ITM container) — verified via full-tree search, no other copies to reconcile.

**Fields**

| Field | Type | Join target | Enum / range | Meaning |
|---|---|---|---|---|
| SaveVersion.length_prefix | int (u32 LE) | — | observed 36 | Byte length of the following GUID string; matches its length. |
| SaveVersion.version_guid | text (ASCII 36-char hyphenated GUID) | none (checked vs every Profiles Id, no match) | b17c4ad4-e8f8-4d83-907e-83dad83fa231 (observed) | Save-container/schema-version stamp; not an FK into Profiles. |
| Profiles.\<root\> | nested-object (XML root `<Profiles>`) | — | n/a | Container for all 20 local input-remap profiles for this Xbox user. |
| Profiles.profile.element_tag | enum (XML tag) | — | KeyboardProfile / ControllerProfile / WheelProfile / RawGameControllerInputMappingProfile (5 each, 20 total) | Device class of the profile record. |
| Profiles.profile.Version | int (string) | — | constant "3" | Schema/format version. |
| Profiles.profile.Id | text (GUID) | none observed elsewhere; no match to SaveVersion's GUID | 36-char GUID, unique ×20 | Primary key of the profile record. |
| Profiles.profile.UserFacingName | text (localization key) | probable FK → localization/string-table layer (key not spot-checked) | pattern IDS_Custom{Keyboard\|Controller\|Wheel}Profile_{1-5} | UI display name — a string-table key, not literal text. |
| Profiles.profile.IsDefaultProfile | bool ("0"/"1") | — | 0 or 1; all 20 = 0 | Whether profile is active for its device class. |
| Profiles.profile.WheelVidPid | int (string, "0"/"1") | — | 0 (Controller×5) / 1 (Wheel×5, Raw×5) | Coarse device-class flag, not a literal VID:PID. Absent on KeyboardProfile. |
| Profiles.profile.PrimaryDeviceVidPid | int (string) | — | constant "1" (Raw only, ×5) | Placeholder primary-device id slot; no real wheel ever paired in this save. |
| Profiles.profile.FFBDeviceVidPid | int (string) | — | constant "1" (Raw only, ×5) | Placeholder FFB-device id slot. |
| Profiles.profile.FFBMotorIndex | int (string) | — | constant "0" (Raw only, ×5) | FFB motor index for multi-motor bases. |
| Profiles.profile.Layout | nested (empty `<Layout/>`) | — | always empty (15 occurrences) | Placeholder for wheel/pedal axis calibration; unused here. Absent on KeyboardProfile. |
| Profiles.Context.Context | enum (text) | — | 9 values: INPUTCONTEXT_{RACING, UI, RACING_UI, TELEMETRY_UI, RACING_CAMERA_ONLY, COPTER, ANNA, HIDE_SEEK, CAR_MEETS} (14 blocks total) | Game mode/UI screen the binding set applies to. |
| Profiles.Context.Version | int (string) | — | constant "3" when present | Schema version of the binding block; absent specifically on KeyboardProfile's Context. |
| Profiles.ButtonInput (KeyboardProfile child) | nested-object ×5 | — | n/a | One keyboard/mouse binding per command. |
| Profiles.ButtonInput.Command | enum/text (INPUTCMD_ ns) | shares INPUTCMD_ namespace with Profiles.Value.Key | only observed: INPUTCMD_HIDESEEK_PING_OR_CHASEBREAK | Command bound to this key. |
| Profiles.ButtonInput.IsPrimary | bool | — | observed 1 | Primary vs. alt binding. |
| Profiles.ButtonInput.MouseButton | int (string) | — | observed 0 | Mouse button code; 0 = none. |
| Profiles.ButtonInput.Key | int (string, Win32 VK code) | — | observed 82 ('R') | Bound keyboard key. |
| Profiles.ButtonInput.KeyFlags | int (string, bitflags?) | — | observed 0 only | Modifier/behavior flags; semantics unconfirmed. |
| Profiles.ButtonInput.IsAnOnEvent | bool | — | observed 0 | Edge vs. held-state fire; exact semantics unconfirmed. |
| Profiles.Value (ControllerProfile child) | nested-object ×39 | — | n/a | One gamepad command-binding slot; may be unbound. |
| Profiles.Value.Key | enum/text (INPUTCMD_ ns) | shares INPUTCMD_ namespace with ButtonInput.Command | 30 values, e.g. GAS/BRAKE/STEERING/HANDBRAKE/SHIFTUP/SHIFTDOWN/CLUTCH/…/HIDESEEK_PING_OR_CHASEBREAK | Command this gamepad slot binds. |
| Profiles.GamepadWheelInput (Value child) | nested-object ×33 | — | n/a | Physical binding for a Value's command; absent (self-closed Value) = explicitly unbound (6/39 slots: CLUTCH, AUTODRIVE_CINEMATIC_CAMERA, SWITCH_CAMERA×2, RADIO_LEFT, MINILEADERBOARD_TOGGLE). |
| Profiles.GamepadWheelInput.Button | enum (text) | — | 19 values, e.g. GamepadWheelInput{RightTrigger, LeftTrigger, AButton, LeftShoulderButton, DPad_Up, …} | Primary physical control mapped to the command. |
| Profiles.GamepadWheelInput.ButtonHigh | enum (text) | — | GamepadWheelInputNone (32/33) or …LeftThumbstick_Right (1/33, on STEERING) | Secondary/opposite control for bidirectional axis commands; "None" = single-sided. |

**Scale:** File 1: 40 bytes, 1 record. File 2: 11,576 bytes, 1 XML document — 20 profile records, 14 Context blocks, 39 Value slots (33 bound / 6 explicitly unbound), 5 ButtonInput, 33 GamepadWheelInput, 15 empty Layout placeholders. Confirmed as the only instance of each file anywhere under GameSave.

**Confidence:** verified

---

### `live-udp-packet` — Forza Data Out UDP stream

**Key structure**
- No stored PK — a live UDP stream, not a table. Each 324-byte datagram is one ephemeral record; `decode()` yields a dict of 89 named fields, no id field of its own.
- Wire `TimestampMS` (offset 4, u32 ms) is NOT used as a record key anywhere in this codebase (can wrap); the daemon stamps its own `time.time()`/`time.monotonic()` at receipt instead.
- Two retention points: (1) overwritten in-place into `ST.latest`, one packet deep, no history; (2) appended to a per-session capture CSV, keyed practically by the capture-added `(t_wall, t_mono)` pair.
- A derived composite identity key is computed per packet for cross-store joins: `cid(p) = f'{CarOrdinal}|{DrivetrainType}|{NumCylinders}|{CarPI}'` (fh6_live_daemon.py:192) — feeds `data/build-letters.json`, `data/pi-observations.json`, and the in-memory `ST.cars` registry. Not itself a wire field.

**Fields**

| Field | Type | Join target | Enum / range | Meaning |
|---|---|---|---|---|
| IsRaceOn | int32 (s32) | — | 0 or 1 | (off 0) 0=menus/pause/replay, 1=driving; zeroed frames ARE transmitted (not silence) during menus/pause/car-swap. → frame.on. |
| TimestampMS | uint32 | — | 0..2^32-1 ms, wraps | (off 4) engine tick ms; NOT a record key (daemon uses its own time.time()/monotonic instead). Captures-only. |
| EngineMaxRpm | float32 | — | — | (off 8) redline rpm of the fitted build. → frame.maxrpm. |
| EngineIdleRpm | float32 | — | — | (off 12) idle rpm; read once per new cid into ST.cars[cid].idle_rpm. |
| CurrentEngineRpm | float32 | — | — | (off 16) live engine rpm. → frame.rpm. |
| AccelX | float32 | — | — | (off 20) local-frame lateral accel, m/s² (X=right). → frame.lat (÷9.80665); abs(lat_g)>3 flags a collision-impact frame. |
| AccelY | float32 | — | — | (off 24) local-frame vertical accel, m/s². Captures-only. |
| AccelZ | float32 | — | — | (off 28) local-frame longitudinal accel, m/s². → frame.lon (÷G). |
| VelX | float32 | — | — | (off 32) local-frame lateral velocity, m/s. Used only in a one-time layout self-check vs Speed. |
| VelY | float32 | — | — | (off 36) local-frame vertical velocity, m/s. Self-check-only. |
| VelZ | float32 | — | — | (off 40) local-frame forward velocity, m/s. Self-check-only. |
| AngVelX | float32 | — | — | (off 44) pitch rate, rad/s. Captures-only. |
| AngVelY | float32 | — | — | (off 48) yaw rate, rad/s. → frame.yaw (deg/s) — NOTE: name collides with the orientation field "Yaw" at off 56 (captures-only there). |
| AngVelZ | float32 | — | — | (off 52) roll rate, rad/s. Captures-only. |
| Yaw | float32 | — | — | (off 56) vehicle yaw orientation, rad. Captures-only. |
| Pitch | float32 | — | — | (off 60) vehicle pitch orientation, rad. Captures-only. |
| Roll | float32 | — | — | (off 64) vehicle roll orientation, rad. Captures-only. |
| NormSusp{FL,FR,RL,RR} | float32 ×4 | — | 0.0–1.0 | (off 68/72/76/80) normalized suspension travel; 0=stretch, 1=compression. → frame.susp[]. Bottoming = travel>0.98 sustained ≥3 frames. |
| SlipRatio{FL,FR,RL,RR} | float32 ×4 | — | normalized, ~-2..2 | (off 84-96) longitudinal tire slip ratio; abs(x)>1 = wheelspin/lockup. → frame.slip[w][0]. |
| WheelRotSpeed{FL,FR,RL,RR} | float32 ×4 | — | — | (off 100-112) wheel rotational speed, rad/s. Captures-only. |
| OnRumble{FL,FR,RL,RR} | int32 ×4 | — | 0/1 | (off 116-128, official WheelOnRumbleStrip) rumble-strip contact/wheel. Captures-only. |
| InPuddle{FL,FR,RL,RR} | float32 ×4 (disputed) | — | float depth; only 0.0 observed | (off 132-144, official WheelInPuddle) official doc claims s32 bool; this decoder + every community FH6 parser read f32 on the same bytes — open dispute. Captures-only. |
| SurfaceRumble{FL,FR,RL,RR} | float32 ×4 | — | — | (off 148-160) FFB surface-rumble intensity/wheel, unit undocumented. Captures-only. |
| SlipAngle{FL,FR,RL,RR} | float32 ×4 | — | — | (off 164-176) normalized lateral slip angle/wheel. → frame.slip[w][1]. Feeds the understeer index (not yet implemented live). |
| CombinedSlip{FL,FR,RL,RR} | float32 ×4 | — | >1.0 = grip lost | (off 180-192) combined slip/wheel; confirmed Peak% == abs(CombinedSlip)×100. → frame.slip[w][2]; gates live gear-ratio accrual (max abs(slip)<0.12 at WOT). |
| SuspTravelM{FL,FR,RL,RR} | float32 ×4 | — | — | (off 196-208) physical suspension travel, m/wheel (metric companion to NormSusp). Captures-only. |
| CarOrdinal | int32 (s32) | data/car-ordinals.json cars.\<ordinal\>; ref_car.ordinal (fh6.db) | — | (off 212) car model ordinal id; a cid component. → frame.car. |
| CarClass | int32 (s32) | — | 0=D,1=C,2=B,3=A,4=S1,5=S2,6=X,7=X(fallback) | (off 216) Horizon PI class, local map CLASS={…}. → frame.cls (pre-mapped). |
| CarPI | int32 (s32) | loosely ↔ ref_car.pi (stock value) | ~100–999 | (off 220) live PI of the equipped build; a cid component; cross-checked vs the on-disk tune's computed PI to detect an unsaved edit. → frame.pi. |
| DrivetrainType | int32 (s32) | — | 0=FWD,1=RWD,2=AWD | (off 224) drivetrain; a cid component. → frame.drv. |
| NumCylinders | int32 (s32) | soft FK ref_engine.cylinders | e.g. 0,3,4,5,6,8,10,12,16 | (off 228) cylinder count of the fitted engine; a cid component. → frame.cyl. |
| CarGroup | uint32 | — | unresolved; e.g. 47 seen on one A700 car | (off 232) Horizon-only extension field, semantics UNRESOLVED (open question in the project's own research doc). Sampled once/cid into ST.cars[cid].car_group. |
| SmashableVelDiff | float32 | — | 0 outside collisions | (off 236) collision-impact velocity delta, m/s. → frame.smash; used for outlier-frame filtering + event-boundary tracking (ST.ev_maxpos). |
| SmashableMass | float32 | — | 0 outside collisions | (off 240) mass of object hit, kg. Captures-only. |
| PosX | float32 | data/routes.json routes.\*.start (spatial match <120m); data/courses/\*.json | — | (off 244) world-space X, m. → frame.px; used for lap counting + course auto-naming. |
| PosY | float32 | — | — | (off 248) world-space Y (altitude), m. Captures-only. |
| PosZ | float32 | data/routes.json routes.\*.start; data/courses/\*.json | — | (off 252) world-space Z, m. → frame.pz; same route/loop role as PosX. |
| Speed | float32 | — | — | (off 256) speed, m/s. → frame.mph (×2.23694); cross-validated vs magnitude of VelX,Y,Z. |
| Power | float32 | — | — | (off 260) engine power, W. → frame.hp (÷745.7). |
| Torque | float32 | — | — | (off 264) engine torque, Nm. → frame.tq (×0.7376). |
| TireTempF{FL,FR,RL,RR} | float32 ×4 | — | °F (community-inferred unit) | (off 268-280) one bulk temp/tire, no zone breakdown. → frame.temp[] (°F unconverted); capture CSV also derives a parallel °C column set (see TireTempC) — same 4 sensors, not 8. |
| Boost | float32 | — | — | (off 284) turbo/SC boost pressure, psi. → frame.boost. |
| Fuel | float32 | — | 0.0–1.0 | (off 288) fuel fraction. Captures-only. |
| DistanceTraveled | float32 | — | — | (off 292) event odometer, m; event-relative, can be negative behind a standing start. → frame.dist; gates course-mode completion (>80m). |
| BestLap | float32 | — | — | (off 296) best lap this event, s. Captures-only; populates only in Rivals/TT/races. |
| LastLap | float32 | — | — | (off 300) previous lap time, s. Captures-only. |
| CurrentLap | float32 | — | — | (off 304) current lap elapsed, s. → frame.lapt; source of derived "ev" bool (ev=1 if CurrentLap>0) — preferred over RacePosition, which lingers stale. |
| CurrentRaceTime | float32 | — | — | (off 308) elapsed race time, s. Captures-only. |
| LapNumber | uint16 | — | — | (off 312) current lap #. → frame.lapn. |
| RacePosition | uint8 | — | — | (off 314) race placement. → frame.rpos; used to detect event activity (ST.ev_maxpos), known to linger stale after event end. |
| Accel | uint8 | — | 0-255 | (off 315) throttle position. → frame.thr; gates live WOT gear-ratio sampling (≥90%≈230/255). |
| Brake | uint8 | — | 0-255 | (off 316) brake position. → frame.brk. |
| Clutch | uint8 | — | 0-255 | (off 317) clutch position. Captures-only. |
| HandBrake | uint8 | — | 0-255 | (off 318) handbrake position. → frame.hb; excludes drift frames from understeer calc (not yet live). |
| Gear | uint8 | — | 0=R/neutral (overloaded), 1-10=forward, 11=shift transient | (off 319) VERIFIED empirically: 0 is ambiguous R/neutral; 11 = mid-shift transient (339 frames, ~24m/s / 7,556 rpm), not an 11th gear. → frame.gear; gates gear-ladder identity evidence + live gear-ratio accrual. |
| Steer | int8 | — | -127..127 | (off 320) steering input. → frame.steer. |
| NormDrivingLine | int8 | — | -127..127 | (off 321) deviation from AI racing-line assist. Captures-only. |
| NormAIBrakeDiff | int8 | — | -127..127 | (off 322) deviation vs AI/ghost brake point. Captures-only. |
| Trailing323 | uint8 | — | always 0 (observed) | (off 323) undocumented trailing byte; always 0 in every sample — inert padding/reserved. |
| t_wall | float (unix epoch s) | none | — | NOT a wire field — capture-script-added (time.time()), CSV col 1; absolute wall-clock since TimestampMS is untrustworthy. |
| t_mono | float (s) | — | — | NOT a wire field — capture-script-added (time.monotonic()-t0), CSV col 2; resets per file/roll. |
| speed_mph | float (derived) | — | — | NOT a wire field — Speed×2.23694, CSV col 3; duplicates frame.mph. |
| lat_g | float (derived) | — | — | NOT a wire field — AccelX/9.80665, CSV col 4; duplicates frame.lat. |
| long_g | float (derived) | — | — | NOT a wire field — AccelZ/9.80665, CSV col 5; duplicates frame.lon. |
| yaw_rate_dps | float (derived) | — | — | NOT a wire field — degrees(AngVelY), CSV col 6; duplicates frame's confusingly-named "yaw" key. |
| TireTempC{FL,FR,RL,RR} | float ×4 (derived) | — | °C | NOT wire fields — (TireTempF-32)×5/9, CSV cols 7-10 (before the 89 raw fields at col 11); same 4 sensors as TireTempF, reported twice, not 8 independent readings. 6+4+89=99 CSV cols total. |

**Scale:** 324 bytes/packet, little-endian, 89 fields (struct.calcsize and struct.unpack both verified 89, not the "99" the census implies). Live rate ~139 pps uncapped (game frame rate, not fixed Hz). Persisted as `captures/fh6_<ts>.csv[.gz]`: 121 files today (65 gz, 56 plain), ~16GB total. CSV row = 99 cols (6 capture-derived timing/dynamics + 4 derived °C tire-temp + 89 raw). SSE `frame` event: ~30-key reduced JSON, throttled ≤20Hz regardless of the ~139pps arrival rate.

**Confidence:** verified

---

### `captures-archive` — persisted capture CSV archive

**Key structure**
- No declared PK (plain CSV, no schema/constraints).
- FILE level: each file = one continuous capture segment, keyed by its filename's embedded wall-clock start timestamp: `captures/fh6_<YYYYMMDD>_<HHMMSS>.csv[.gz]`.
- ROW level: `t_wall` (`time.time()`, float epoch s) is the natural row key — VERIFIED strictly monotonic increasing, zero duplicates across a full 145,666-row sample file; unlike `t_mono` (resets every file/roll), t_wall should be unique store-wide (not enforced).
- Practical synthetic PK: `(source_filename, row_ordinal_within_file)`, or `t_wall` alone.
- Files join 1:1 forward to `data/sessions/*.json` by matching timestamp stem (`captures/fh6_<ts>.csv[.gz]` → `data/sessions/fh6_<ts>.json`, produced by `scripts/telemetry/analyze_session.py`) — confirmed ≥1 exact-timestamp pair in the working tree (`fh6_20260831_172011`).
- Schema is STRUCTURALLY GUARANTEED identical to `live-udp-packet`: `fh6_live_daemon.py` does `from fh6_dataout_capture import FH_FMT, FIELDS, W, decode` — both share the literal same Python `FIELDS` list and struct format at import time; they cannot silently drift apart.

**Fields**

| Field | Type | Join target | Enum / range | Meaning |
|---|---|---|---|---|
| t_wall | float64 (text in CSV) | de-facto row key | epoch s, ~1.78e9 | Wall-clock at packet receipt; VERIFIED strictly monotonic + duplicate-free across a full 145,666-row file. |
| t_mono | float64 | — | 0..file duration | time.monotonic()-t0 since this file was opened; resets to 0 each new file/roll — only locally unique. |
| speed_mph | float64 (derived) | — | ≥0 | Speed(m/s)×2.23694. |
| lat_g | float64 (derived) | — | g-force, impacts spike 6-10g | AccelX/9.80665 (AccelX = local lateral, X=right, per official Data Out spec). |
| long_g | float64 (derived) | — | g-force | AccelZ/9.80665 (AccelZ = local longitudinal/forward). |
| yaw_rate_dps | float64 (derived) | — | deg/s | degrees(AngVelY) (AngVelY = raw yaw angular velocity). |
| TireTempC{FL,FR,RL,RR} | float32 ×4 (derived) | — | °C, ~0 idle to ~90+ loaded | (TireTempF-32)×5/9; CSV cols 6-9 (before the 89 raw fields) — pure unit conversion of TireTempF, not a second sensor: 4 physical readings reported twice, not 8. |
| IsRaceOn | int32 | — | 0=not driving (zeroed frame), 1=driving | (off 0) VERIFIED via live-capture test: 1 even in free roam, not just races; 0 marks a fully-zeroed placeholder during menus/pause/car-swap (stream never silent) — all car/session fields sentinel-0 then. |
| TimestampMS | uint32 | — | 0..2^32-1 ms, wraps ~49.7d | (off 4) in-game engine tick ms, NOT wall clock, resets per boot — not usable as a cross-file order key (use t_wall). |
| EngineMaxRpm | float32 | — | — | (off 8) redline rpm of fitted engine/tune. |
| EngineIdleRpm | float32 | — | — | (off 12) idle rpm. |
| CurrentEngineRpm | float32 | — | — | (off 16) live engine rpm. |
| AccelX | float32 | — | — | (off 20) local lateral accel, m/s² (X=right, official). Source of lat_g. |
| AccelY | float32 | — | — | (off 24) local vertical accel, m/s² (Y=up). |
| AccelZ | float32 | — | — | (off 28) local longitudinal accel, m/s² (Z=forward). Source of long_g; also used as a mass-estimation input elsewhere (Power/(Speed×AccelZ)). |
| VelX | float32 | — | — | (off 32) local lateral velocity, m/s. |
| VelY | float32 | — | — | (off 36) local vertical velocity, m/s. |
| VelZ | float32 | — | — | (off 40) local forward velocity, m/s; sqrt(VelX²+VelY²+VelZ²) matches Speed (verified self-check). |
| AngVelX | float32 | — | — | (off 44) pitch rate, rad/s (X=pitch, official). |
| AngVelY | float32 | — | — | (off 48) yaw rate, rad/s (Y=yaw). Source of yaw_rate_dps. |
| AngVelZ | float32 | — | — | (off 52) roll rate, rad/s (Z=roll). |
| Yaw | float32 | — | — | (off 56) car heading orientation, rad. |
| Pitch | float32 | — | — | (off 60) car pitch orientation, rad. |
| Roll | float32 | — | — | (off 64) car roll orientation, rad. |
| NormSusp{FL,FR,RL,RR} | float32 ×4 | — | ~0.0-1.0 nominal, can exceed on bottoming | (off 68-80) normalized suspension travel/wheel; 0=full stretch, 1=full compression (official). |
| SlipRatio{FL,FR,RL,RR} | float32 ×4 | — | typically -1..1, can exceed | (off 84-96) normalized longitudinal slip/wheel; 0=full grip, abs(x)>1=beyond the friction limit (official). |
| WheelRotSpeed{FL,FR,RL,RR} | float32 ×4 | — | — | (off 100-112) wheel rotational speed, rad/s/wheel. |
| OnRumble{FL,FR,RL,RR} | int32 ×4 | — | 0/1 (probable; not confirmed nonzero this pass) | (off 116-128) rumble-strip flag/wheel; all-zero in this pass's 2 samples — analyzer's own corner-classifier relies on it turning nonzero elsewhere. |
| InPuddle{FL,FR,RL,RR} | float32 ×4 | — | float depth, likely 0.0-1.0; only 0.0 observed | (off 132-144) puddle contact/wheel; RESOLVED here — official doc claims s32 0/1, every real FH6 parser (incl. this capture) reads f32 depth on the same bytes. |
| SurfaceRumble{FL,FR,RL,RR} | float32 ×4 | — | — | (off 148-160) continuous surface-roughness intensity/wheel; used by analyze_session.py to classify road vs rough-surface cornering (sustained value, not a one-frame kerb clip). |
| SlipAngle{FL,FR,RL,RR} | float32 ×4 | — | — | (off 164-176) normalized lateral slip angle/wheel (official, same ±1 convention as SlipRatio). |
| CombinedSlip{FL,FR,RL,RR} | float32 ×4 | — | ~-1.5..1.5+, >1.0=past grip limit | (off 180-192) combined ratio+angle grip metric/wheel; CONFIRMED Peak% == abs(CombinedSlip)×100 (median log-error 0.086, 38 frames) — the Friction page's red ring. |
| SuspTravelM{FL,FR,RL,RR} | float32 ×4 | — | — | (off 196-208) suspension travel, m/wheel (metric companion to NormSusp). |
| CarOrdinal | int32 | ref_car.ordinal (fh6.db) | 0=sentinel or real ref_car.ordinal | (off 212) FK VERIFIED: 11/11 sampled non-zero ordinals resolved to real ref_car rows (e.g. 3600=Hennessey Venom F5, 4167=GT-R Black Edition R35 FE). 0 = "no car" sentinel on IsRaceOn=0 rows. |
| CarClass | int32 | — | 0=D,1=C,2=B,3=A,4=S1,5=S2,6=X (0 ambiguous w/ sentinel) | (off 216) Horizon PI class, VERIFIED against analyzer's own CLASS dict + live test (an A-700 car reported 3). |
| CarPI | int32 | loosely ↔ ref_car.pi (stock) | observed 0(sentinel)-930 | (off 220) live PI AS CONFIGURED (reflects installed upgrades), not necessarily ref_car.pi's stock value. |
| DrivetrainType | int32 | — | 0=FWD,1=RWD,2=AWD | (off 224) VERIFIED via analyzer's own DRIVE dict. |
| NumCylinders | int32 | soft FK ref_engine.cylinders; cid component (with CarOrdinal, DrivetrainType, CarPI) | observed 0,1,3,4,6,8 | (off 228) fitted-engine cylinder count; a single ordinal can carry multiple upgrade configs, disambiguated by the cid composite. |
| CarGroup | uint32 | — | observed 13,17,19,21,26,43,48,49,50 (this sample); semantics unknown | (off 232) UNRESOLVED — carried as an opaque passthrough everywhere (session_car.car_group), never decoded to a name; project's own research doc flags it open. |
| SmashableVelDiff | float32 | — | 0 outside collisions | (off 236) collision-impact velocity delta, m/s (official); one of two impact-frame triggers (paired with abs(lat_g)>3.0) used to discard collision frames from corner/grip analysis. |
| SmashableMass | float32 | — | 0 outside collisions | (off 240) mass of object hit, kg (official). |
| PosX | float32 | — | — | (off 244) WORLD-space m (distinct from the local-frame Accel/Vel fields above; official per appendix). |
| PosY | float32 | — | — | (off 248) world-space m, vertical. |
| PosZ | float32 | — | — | (off 252) world-space m. |
| Speed | float32 | — | — | (off 256) scalar speed, m/s. VERIFIED self-check: magnitude of VelX,Y,Z matches Speed on real driving frames. |
| Power | float32 | — | — | (off 260) live engine power, W. |
| Torque | float32 | — | — | (off 264) live engine torque, Nm. |
| TireTempF{FL,FR,RL,RR} | float32 ×4 | — | — | (off 268-280) contact-patch temp/tire, °F (community-consensus unit, never officially documented). Source of the derived TireTempC group. |
| Boost | float32 | — | — | (off 284) turbo/SC boost pressure, psi. |
| Fuel | float32 | — | 0-1 fraction (standard convention; not re-verified this pass) | (off 288) fuel remaining. |
| DistanceTraveled | float32 | — | — | (off 292) odometer since event/lap start, m; project notes it "under-reports badly on long routes" — prefers path-integrated distance from PosX/PosZ for course-length work. |
| BestLap | float32 | — | — | (off 296) best lap time recorded this session/event, s. |
| LastLap | float32 | — | — | (off 300) most recent completed lap time, s; "LastLap published" + LapNumber incrementing together = authoritative "real lap" signal; both zeroing together = restart. |
| CurrentLap | float32 | — | — | (off 304) elapsed time in lap underway, s; resets near 0 at lap boundary. CurrentLap>0 = "honest" in-event flag, more reliable than RacePosition. |
| CurrentRaceTime | float32 | — | — | (off 308) elapsed time since event/race start, s; keeps climbing across laps, 0 only on full RESTART — disambiguates a real lap-complete reset from a restart. |
| LapNumber | uint16 | — | — | (off 312) lap counter within event; stays 0 through a single-lap Rivals/TT run (time via LastLap instead). |
| RacePosition | uint8 | — | observed 0-2 in samples, 0 dominant off-race | (off 314) race placement; project notes it "lingers >0 in free roam after event ends" — NOT by itself a reliable event-boundary flag. |
| Accel | uint8 | — | 0-255 | (off 315) throttle pedal/trigger position. |
| Brake | uint8 | — | 0-255 | (off 316) brake pedal/trigger position. |
| Clutch | uint8 | — | 0-255 (0/255 only observed) | (off 317) clutch input; only digital-looking values in this pass's gamepad samples — a clutch-pedal rig could yield intermediate values. |
| HandBrake | uint8 | — | 0-255 (0/255 only observed) | (off 318) handbrake input. |
| Gear | uint8 | — | 0=R/neutral (overloaded), 1-10=forward, 11=mid-shift transient | (off 319) VERIFIED empirically (339 transient frames clustered at upshifts, ~24m/s / 7,556 rpm). |
| Steer | int8 | — | -127..127 | (off 320) steering input. |
| NormDrivingLine | int8 | — | -127..127 | (off 321) deviation from ideal-driving-line assist overlay (standard Forza field; semantics not re-verified this pass — probable). |
| NormAIBrakeDiff | int8 | — | -127..127 | (off 322) deviation vs AI/ghost suggested brake point (probable). |
| Trailing323 | uint8 | — | always 0 (observed, 153K+ rows, 2 files) | (off 323) undocumented reserved/padding byte at packet end. |

**Scale:** 121 files today (65 `.csv.gz` + 56 `.csv`), 16,651,919,203 bytes (~16.65GB). ~25M telemetry rows total (extrapolated from two exact-counted files: 145,666 rows/140.27MB and 701,976 rows/660.86MB, ~950 bytes/row, agreeing within ~2%). 2 files header-only/0 rows (aborted sessions); largest single file 2.03GB (predates the 192MB roll cap added 2026-09-01). Every file: 99 columns, byte-identical header across old `.gz` and new `.csv`.

**Confidence:** verified

---

### `live-daemon-endpoints` — live HTTP+SSE API surface

**Key structure**
- Not a row-keyed data store — a live HTTP+SSE API surface (`scripts/telemetry/fh6_live_daemon.py`, stdlib `http.server` + hand-rolled SSE, single in-process `ST` state object, no DB of its own).
- Nearest "key" per surface: (a) REST routes → the `(method, path)` pair — 12 GET paths, 1 OPTIONS, 13 POST body-shapes across ~12 POST paths (POST /route carries two disjoint body shapes on one path); (b) SSE channel → the `event:` name in `event:<name>\ndata:<json>\n\n` frames — 3 periodic (snapshot/frame/status) + 12 named one-shot, multiplexed over one `GET /events` connection with a shared 2000-entry ring (`ST.events`, `seq` int) as the only ordering/dedup mechanism; (c) within car/build payloads, the record key is `ordinal` (FK data/car-ordinals.json) or the richer composite `cid` = `ordinal|drivetrainType|cylinders|CarPI`.

**Fields**

| Field | Type | Join target | Enum / range | Meaning |
|---|---|---|---|---|
| GET /events (SSE, overview) | text/event-stream | — | 15 payload shapes | Long-lived connection; on open flushes `snapshot`; loop ~50/s replays queued named events (ST.events, seq>last_seq — slow client can miss events since the ring caps at 2000); emits `frame` when a UDP packet landed in the last 1s (throttled ≥50ms apart); emits `status` 1/s unconditionally. No auth, no per-client filtering, no replay-from-scratch. |
| snapshot (SSE, once/connection) | nested-object | — | — | strip: last 1800 per-sec entries; corners: last 60 corner objects; cars: array of ST.cars[] entries; analysis: object/null; stint: int; tags: object keyed by stint# → {label≤80, role: donor/replica, t0}; loop: object/null {name, start[x,z], lap, last_s}; game: enum menu/freeroam/event; mode: {suggest: course/decode/free/null, reason, kind: race/"rivals / timed"/null, game}; session: object/null {id, summary} (trimmed); clone_lock: int/null. |
| frame (SSE, ~20Hz) | nested-object | — | — | = compact(packet): t(t_mono,2dp), on(IsRaceOn), car(CarOrdinal), cid(composite key), pi, cls(D/C/B/A/S1/S2/X), drv(FWD/RWD/AWD), cyl, gear(0=neutral..10), mph, rpm, maxrpm, ev(0/1, CurrentLap>0), lapn, rpos, lapt, dist, px/pz, lat/lon(g-force), yaw(deg/s), steer/thr/brk, hb, boost, hp, tq, slip{FL,FR,RL,RR}→[ratio,angle,combined], susp[4], temp[4](°F), smash, stint(appended post-hoc in ingest()). |
| status (SSE, 1Hz, unconditional) | nested-object | — | — | pps, frames, receiving(bool), cars(array of FULL ST.cars[] entries — differs from /health's cid-strings-only "cars"), stint, loop{name,lap,last_s}(fewer keys than snapshot.loop), game, mode(same shape as snapshot.mode), csv(relpath/null), clone_lock. |
| ST.cars[] entry | nested-object | id=cid; ordinal→data/car-ordinals.json cars.\<ordinal\>; car_group→game-DB CarGroup table | — | id(=cid, closest thing to a PK), ordinal, pi, class, drivetrain, cyl, max_rpm, idle_rpm, car_group, name(joined once at creation, NOT live-updated except via POST /car), gears([] always empty here — real data lives in analyzer session JSON), dyno([] always empty), live_s(always 0 here — real value in analyzer's own cars[]). |
| mode (SSE one-shot) | nested-object | — | game: menu/freeroam/event; kind: race/"rivals / timed"/null; suggest: course/decode/free | game, kind, suggest, reason(str), t(1dp). Emitted only on change. |
| lap (SSE one-shot) | nested-object | — | topology: circuit/unknown | 2 shapes: normal loop crossing {loop, lap, time_s}; timed-event/auto-course completion {loop, lap, time_s/null, final:true, topology, dist_m}. "unknown" topology = a live single pass could be a genuine finish or a crashed circuit lap, disambiguated offline later. |
| loop (SSE one-shot) | nested-object | — | 4 variants | {name:null}=cleared; {name,start[x,z],lap:0,auto:true}=timed-event auto-anchor at S/F (name = nearest known route within 120m, else "Rivals course"); {…,auto:true,topology:circuit}=re-pinned once LapNumber first incremented; {name,start,lap:0}(no auto key)=user manual mark via POST /mark-start, persisted to data/reference-loops.json. |
| stint (SSE one-shot) | nested-object | — | why: first drive/build change/event start-finish/new run (manual)/menu gap (course mode)/event start (boundary moved) | n(new stint#), t0(1dp), id(cid of car now driving), why. A boundary within 0.05s of the previous for the SAME car merges instead of incrementing n. |
| config (SSE one-shot, on new cid) | nested-object | = ST.cars[] entry | — | broadcast the instant a car/build combo not seen this session appears. |
| strip (SSE one-shot, ~1/s driving) | nested-object | — | state: off/impact/both/front/rear/calm | Per-second grip aggregate (also unbounded in ST.strip; snapshot ships last 1800). {t,state:off} if <half that sec's frames were on-track; else {t,state,car(cid),mph(avg),f(peak front combined-slip),r(peak rear),g(peak abs(lat_g))}. |
| corner (SSE one-shot, live detector) | nested-object | — | dir: L/R; red: both/front/rear/none | t0/t1, car(cid), stint, lapn(1-based, null in free roam), ev, dir, mph_in/min/out/apex, apex[px,pz], loop_lap, lat_g_peak, phases[4]{phase,front,rear,red,dur}, first_red{phase,axle}/null, usi(3dp, understeer idx), drift(bool, rear avg combined-slip>2.5), kink(bool), brake_on_m/throttle_on_m(m from apex), brake_max, hb(bool). Unbounded in ST.corners; snapshot ships last 60. |
| tag (SSE one-shot) | nested-object | — | role: donor/replica/null | n(stint#), label/null, role/null. Persisted to data/sessions/\<sid\>.tags.json with stint_starts for offline numbering parity. |
| analysis (SSE one-shot / GET /analysis) | nested-object | — | — | Trimmed mirror of analyze_session.py output, re-run periodically + on lap completion. id, summary, final(bool, driving stopped), cars[](keyed down to id/ordinal/name/class/pi/drivetrain/cyl/build_id/coverage/advice/general/decode/clone_sheet/temps_med_f/live_s — full record has more keys, lives in data/sessions/*.json), courses[](first 4 only, all keys except geometry), stints[](last 20, n/id/label/role/t0/t1). GET /analysis returns ST.analysis verbatim or {}. |
| session (SSE one-shot, on FINAL analysis) | nested-object | path → data/sessions/*.json | — | id, summary, path(relpath under data/sessions/). |
| disk (SSE, file-watcher, polls every 1.5s) | nested-object | — | 2 shapes | No tune: {ordinal, available:false}. New/changed save: {ordinal, name/null, ts, available:true, deliverable(=GET /disk-tune's deliverable shape), match(=GET /disk-tune's match shape), diff{sliders[{field,from,to,unit}], parts[{item,from,to}], gear_delta}/null(present only on genuine re-save of same car), new_save(bool)}. Fires PI-observation accrual (data/pi-observations.json) and auto livery-association (data/build-liveries.json) as side effects. |
| GET /cars-map | nested-object | = data/car-ordinals.json | — | Direct passthrough, no transform: {schema_version, cars:{\<ordinal\>:{name,confidence,source}}, builds:{\<build_id\>:{label,source,cid/null}}}. |
| GET /session.json | nested-object | mirrors data/sessions/*.json | — | = ST.session_json verbatim ({} if none this process lifetime) — FULL untrimmed analyze_session.py output (incl. geometry per course, complete per-car record, every stint), unlike the trimmed "analysis" SSE shape. |
| GET /laps?route_key=&class=&limit=&all= | nested-object | read-only view over data/laps.db | — | {route_key, class/null, n, laps[](capped by limit, default 40 max 200), best{lap_s,cid}/null, by_class{\<letter\>:int}(route-wide), contact{laps,impacted,void}(route-wide)}. Lap item: {cid, build_id/null, class, pi, drivetrain, lap_s/null, tune_hash/null(FK: slider revision), pct_off/null, competitive(bool), solo/null, impacts(int), void(bool, contact-invalidated), partial(bool), arc_m/null, session, t0, pts[[arc_m,mph,grip_code,x,z]] downsampled ≤200, guaranteeing grip_code==4 (impact) samples + first/last}. |
| GET /health | nested-object | — | — | pps, frames, receiving, cars(array of cid STRINGS only — differs from snapshot/status's full-object "cars"), shots(bool), clone_lock/null. |
| GET /shots?n= | nested-object | — | — | {dirs[], shots[]{id(filename),dir,mtime,size,url}, newest-first, capped n(default 24)}. GET /shot?f= returns raw image bytes, Content-Type by extension, 404 on miss. |
| GET /disk-tunes | nested-object | — | — | {available, root, count, cars[]{ordinal,name/null,tunes(save count),locked(newest downloaded),gears}, sorted by name} or {available:false,error} or {available:false,cars:[]} if the decode module failed import. |
| GET /disk-tune?ordinal=&ts= (envelope) | nested-object | — | — | Success: {available:true, ordinal, name/null, ts(save actually chosen), tune{…}, deliverable{…}, match{…}}. No tune: {available:false, ordinal, reason}. Decode error: {available:false, error}. ordinal defaults to ST.latest.car if omitted. |
| GET /disk-tune → tune (raw 598-byte decode) | nested-object | parts values → game-DB part-id catalog | — | version(u8,=3), locked(u8), ordinal(u16), parts{54 named slots}(u32 part-id or null=0xFFFFFFFF empty), sliders{34 named f32 fields}(28 real+6 internal padding), each {norm(0-1,4dp), unit, adjustable(bool), value/null, range[lo,hi]/absent, derived/absent, anchored/absent, pole/absent, pole_pct/absent, cal_points/absent}, gears_norm[](0-1,4dp per used gear), gear_count. Byte-identical to the 598-byte savefile format (see FH6 savefile tune decode memory). |
| GET /disk-tune → deliverable (Clone Sheet) | nested-object | pi → data/parts-pi.json | — | source:disk, ordinal, car/null, locked, gear_count, menus[]{menu(Conversions/Engine & Power/Platform & Handling/Drivetrain/Tires & Rims/Aero & Appearance), rows[]{item,category,value,upgrade,conf/null,tier/null,stock(bool),raw(part id)/null,status:measured,confidence:1.0,note?,derived_level?,pi?,engine_type?,engine_type_conf?,telemetry?,resulting_drivetrain?,needs_drive?}}, tabs[]{tab(Tires/Springs/Alignment/Anti-roll bars/Damping/Aero/Brakes/Differential/Gearing), rows[]{field,label,section,poles[2],fill(4dp),value/null,unit,display,status:measured/…,confidence(0.6-1.0),+optional flags}}, summary{parts_installed, sliders_absolute/exact/derived/relative, pi_total/null, pi_attributed/null, pi_known_parts, pi_total_parts, pi_obs_car, pi_obs_total}, confidence(0-1,3dp weighted avg), gear_diag?, union?{fields[], asks[]}. |
| GET /disk-tune → match (build-identity disambiguation) | nested-object | builds[].build → data/build-letters.json | how: picked/signature/newest/no-match/gear-matched | how, live(bool), live_recent(bool,≤2h), live_cyl/null, live_pi/null, chosen_cyl/null, chosen_pi/null, n_saves, n_signature_ties, gear_disambig(bool), max_gear_seen/null, box_exercised(bool), held(bool,2h-sticky), ladder_tied(bool), picked_ok(bool), stale{live_pi,save_pi,save_ts,why}/null, builds[]{build(8-char sha1, FK data/build-letters.json), label(permanent A/B/C…), saves[ts], n, cyl/null, pi/null, gears/null, diff_base, diff_vs_A[≤12], n_diffs, livery?}, saves[]{ts,cyl/null,pi/null,locked,gears/null,build/null}. |
| GET /liveries?ordinal= | nested-object | dir → GameSave ContainersRoot folder | kind: Livery/SoulBoundLivery/BaseLivery | {liveries[]{dir,kind,ts,name/null,desc/null,creator/null,thumb(bool)}, error?}. READ-ONLY. GET /livery-thumb?d=\<dir\> serves raw bigThumb.webp bytes, 404 on missing/unsafe path. |
| POST — generic response envelope | nested-object | — | — | Every POST branch except /analyze and /tune-range (custom bodies) ends by writing/re-reading data/car-ordinals.json if names changed, responds {ok(bool), cars(object), builds(object)} = the full names-file maps, HTTP 200/400. |
| POST /car {ordinal,name} | request-body | writes data/car-ordinals.json cars.\<ordinal\> | confidence:player-confirmed | Also live-patches ST.cars entries sharing that ordinal. |
| POST /reset {} | request-body | — | — | No body fields used. Clears ST's in-memory accumulators (strip/corners/cars/analysis/session_json/stint/loop-lap-count/etc.) for a fresh session; keeps picked_id and the loop DEFINITION (only resets its lap count). |
| POST /tag or /role {stint?,label?,role?} | request-body | writes data/sessions/\<sid\>.tags.json | role: donor/replica/'' | stint(int,default current), label(≤80,optional), role(exclusive — clears from every other stint first). Emits 'tag'. |
| POST /mode {mode} | request-body | — | course/decode/free/other→null | Reverts to auto-detected mode_suggest on unrecognized value. |
| POST /clone-lock {ordinal} | request-body | — | int or null | Pins/clears a clone-target ordinal; while set, PI/catalog accrual for it pauses. |
| POST /new-run {} | request-body | — | — | No fields used. Forces a new stint at the next driving frame (manual split). |
| POST /analyze {} | request-body | — | — | No fields used. Forces immediate re-analysis (skips debounce). Bypasses generic envelope: {ok:true, analyzing:bool}. |
| POST /tune-range {ordinal,field,value,unit?,ts?,norm?} | request-body | writes data/car-tune-ranges.json | — | Registers a (slider-position, real value) calibration point to back-solve per-car slider min/max (TUNE.register_range). Bypasses generic envelope: success {ok:true,solved:bool,points,distinct,need(2 total),norm(4dp),field,ordinal,ts}; failure {ok:false,error}(400) — refuses rather than guesses on ambiguous pairing. |
| POST /build-field {cid,...} | request-body | writes data/builds/\<sanitized-cid\>.json | — | cid(required) + one of: pane_key+value; menu+slot+value+shot?; tune_tabs(replaces wholesale). Seeded from data/builds/_template.json on first write. |
| POST /mark-start {name,radius?,min_dist?} | request-body | writes data/reference-loops.json loops.\<name\> | — | name(≤60), radius(default 60m), min_dist(default 250m). Requires valid on-track position (fails if parked at [0,0]/menu). Emits 'loop'. |
| POST /clear-loop {} | request-body | — | — | No fields. Clears active reference loop; emits loop:{name:null}. |
| POST /course-expected {route_key,n} | request-body | writes data/courses/\<route_key\>.json expected_turns | — | n:int/null(0/empty removes field). Human-entered ground truth the analyzer cross-checks turn detection against. |
| POST /build-livery {ordinal,build,dir?} | request-body | writes data/build-liveries.json assoc.\<ordinal\>.\<build\> | — | dir/null(omitted/falsy clears pin). Manual override of the save-time-proximity auto-guess. |
| POST /route {route_key,rivals} (variant A) | request-body | merge-patches data/routes.json routes.\<route_key\>.rivals | bool | Declared game-mode flag telemetry alone can't distinguish from a led time trial. |
| POST /route {route_key,name,mode?} (variant B, same path) | request-body | merge-patches data/routes.json routes.\<route_key\>.{name,source,mode} | — | name(≤80). Merge-patches (never replaces) to avoid wiping start/heading/length_m. |
| POST /build {build_id,label,cid?} | request-body | writes data/car-ordinals.json builds.\<build_id\> | — | {label, source:'dashboard \<date\>', cid}. |

**Scale:** Source file 2,323 lines / 172,054 bytes. 12 GET + 1 OPTIONS + 13 POST body-shapes (12 paths) = 26 request/response contracts, plus 15 SSE payload shapes = 40+ distinct JSON shapes for one process. Not a stored dataset — no row count applies. In-memory ring buffers: ST.events cap 2000; ST.strip snapshot slice last 1800 (full list unbounded); ST.corners snapshot slice last 60 (full list unbounded). /disk-tune parts=54 named slots, sliders=34 named fields (28 real+6 padding) — same counts as the 598-byte savefile format, since this endpoint is a JSON wrapper around that exact byte layout.

**Confidence:** verified

---

## External

### `car-ordinal-live-endpoints` — HDR ordinal gist + mirror

**Key structure**
- No key at the wire level: the raw endpoint is one flat JSON object `{"YYYY Make Model": "ordinal_string", ...}`, 660 pairs, no wrapper.
- Car NAME (the JSON key) is free text, not a stable normalized id.
- Effective PK = ORDINAL (the value, cast int): unique across all 660 entries (0 collisions); VERIFIED identical entry-for-entry to `Data_Car.Id` in the decrypted FH6_Database.sqlite — `set(Data_Car.Id) == set(ordinals)`, 660==660, zero symmetric difference. Spot-checks confirm this is not coincidental (Id 247/MakeID 49 → List_CarMake "TOY"/"Toyota" matches "1969 Toyota 2000 GT"→247; Id 3665/MakeID 213 → "SIE" matches "2021 Sierra Cars 700R"→3665).
- Downstream merged store `data/car-ordinals.json`: "cars" keyed by ordinal-as-string ("247", …); sibling "builds" keyed by a separate player-assigned build_id string (currently empty).

**Fields**

| Field | Type | Join target | Enum / range | Meaning |
|---|---|---|---|---|
| (object key) car name | text | display value only, not a join key; → cars[ordinal].name | pattern 'YYYY Make Model[ (Tag)]'; 12 distinct parenthetical tags across 660 | 659/660 start with a 4-digit year (1932-2554, some archive-codename artifacts); 1 exception "NUL_CAR_00" (ordinal 1215) → Data_Car MakeID 200 → List_CarMake "PG" (unresolved) = Playground-Games internal placeholder; 1 malformed key (unbalanced parens, ordinal 4168) silently patched by the fetch script. |
| (object value) ordinal | text (string-encoded int) | FH6_Database.sqlite Data_Car.Id (verified exact-match PK); Forza Data Out telemetry CarOrdinal field | range 247-4342, 0 dupes | The car's identity number; also the value the live UDP stream reports as CarOrdinal. Sparse: 448 gaps>1 between consecutive present ordinals; 2 large gaps (641→1006 span 365; 1668→2002 span 334) suggest whole blocks (other Forza titles/unreleased/internal) are simply absent. |
| cars.\<ordinal\>.name | text | n/a (display) | — | Same name string; upserted by fetch_car_ordinals.py OR overwritten via the live daemon's POST /car handler. |
| cars.\<ordinal\>.confidence | enum (text) | n/a | community-table (658/660) or player-confirmed (2/660) | Provenance tier; player-confirmed entries are NEVER touched by a future community-table refetch. |
| cars.\<ordinal\>.source | text (free-form) | n/a | — | community-table: fixed string "HDR FH6 ordinal gist (cross-checked vs ONYX asset scan)"; player-confirmed: hand-written note (dashboard-generated or manual build annotation). |
| table_source.{url,fetched,entries,note} | nested {url:text, fetched:text(YYYY-MM-DD), entries:int, note:text} | n/a | entries=660 | Metadata on the most recent successful fetch; rewritten wholesale each run, never touched by the daemon. |
| builds.\<build_id\>.{label,source,cid} | nested {label:text, source:text, cid:text/null} | cid composes CarOrdinal (joins back to this store's own ordinal key) + DrivetrainType/NumCylinders/CarPI (telemetry fields) | — | Separate sibling registry in the same JSON document; written only by the POST /build handler. Currently 0 entries locally (unused, not broken). |

**Scale:** PRIMARY (gist): 25,127 bytes, 660 pairs, 1 JSON GET. MIRROR: 25,127 bytes, sha256-IDENTICAL to primary (confirmed this session) — pure failover copy, not independent data despite the repo name `fh6-car-database`. Merge target `data/car-ordinals.json`: 3,312 lines, 660 "cars" entries (last fetch stamped 2026-08-21, unchanged as of 2026-09-03) + 0 "builds" entries.

**Confidence:** verified

---

### `vetted-guides-ledger` — external tuning-source trust ledger (memory note)

**Key structure**
- No database key — a single whole-file blob, not row-oriented. Identity = the memory filename itself (`fh6-external-tuning-sources.md`, = `frontmatter.name`).
- Body below the YAML frontmatter is unstructured Markdown prose with 3 embedded list-shaped substructures requiring hand-parsing: `trust_ranking` (7 rows), `error_catches` (2 rows), `consensus_baselines` (9 inline key:value pairs). No JSON/YAML body, no row IDs, no per-guide key.
- If normalized to SQL: 1 row per memory file (keyed by `name`) + child table `vetted_guide` keyed by `domain` (7 rows: tier, role_note, ledger_id FK) + child table `error_catch` keyed by a synthetic serial (2 rows: source_domain FK, wrong_claim, correct_value). `consensus_baselines` already has its canonical home in `data/slider-baselines.json` — this file is the provenance note, not the canonical store.

**Fields**

| Field | Type | Join target | Enum / range | Meaning |
|---|---|---|---|---|
| frontmatter.name | text | = filename stem, this record's own PK | free text, kebab-case | memory-node slug/id. |
| frontmatter.description | text | — | — | one-line summary shown in MEMORY.md index. |
| frontmatter.metadata.node_type | enum (text) | — | observed: "memory" | memory-system record kind. |
| frontmatter.metadata.type | enum (text) | — | observed: "reference" | memory-system record subtype. |
| frontmatter.metadata.originSessionId | text (UUID) | conceptually → a session/conversation id; no local store of session ids found (data/sessions/*.json = unrelated FH6 telemetry sessions) — does not currently resolve to anything on disk | — | authoring Claude Code session. |
| frontmatter.metadata.modified | text (ISO-8601 UTC, ms) | — | observed 2026-08-23T04:26:01.508Z, matches OS mtime | last-edit time. |
| body.digest_header | text (prose) | — | — | states digest date, guide count (7), motivating task, epistemic stance; only extractable atoms are the count and date. |
| trust_ranking[] (7 rows) | array of nested {tier, domain, role_note} | — | — | one bullet/guide; shapes not fully uniform (1 row's note is a site-type description, not a trust rationale). |
| trust_ranking[].tier | enum (unicode stars) | — | ★★★(2: forzatune.com, forza.guide) / ★★½(1: gamingpromax.com) / ★½(2: grindout.com, skycoach.gg) / ★(1: vpesports.com) / unrated-tool(1: forzafire.com) | ordinal trust rating. |
| trust_ranking[].domain | text (bare hostname) | 5/7 also appear in data/sources.json's 97-entry bibliography, for DIFFERENT purposes (car tiers/Eliminator/credit-farming); vpesports.com appears NOWHERE else in the project (grep-confirmed) | forzatune.com, forza.guide, gamingpromax.com, grindout.com, skycoach.gg, vpesports.com, forzafire.com | identifies the guide site. |
| trust_ranking[].role_note | text (free prose, 3-15 words) | — | — | why the tier was assigned. |
| error_catches[] (2 rows) | array of nested {source, wrong_claim, correct_value, applied_as?} | — | — | numbered list, both present. |
| error_catches[1] (grindout damping error) | nested object | → data/slider-baselines.json constants.damping_bump=6.0/damping_rebound=18.0; dashboard/app.js SLIDER_BASE.fbump/rbump=6, freb/rreb=18 | grindout claims bump≈60% of rebound (WRONG) | consensus (gamingpromax+skycoach+"18/6 baseline"): bump≈1/3 of rebound; encoded rebound=18, bump=6. |
| error_catches[2] (vpesports diff-direction error) | nested object | none direct — informs qualitative direction logic, not a baked number | vpesports says increase accel diff to fix power-oversteer (WRONG, backwards) | every other source: REDUCE accel diff. Caution only, no applied_as value. |
| consensus_baselines{} (9 entries) | object of scalars, hand-parsed from prose (not JSON in source) | — | — | the ledger's actual payload — numbers baked into code. |
| consensus_baselines.rebound | int | dashboard/app.js SLIDER_BASE.freb/rreb=18; data/slider-baselines.json constants.damping_rebound=18.0 | 18 | damping rebound baseline. |
| consensus_baselines.bump | int | dashboard/app.js SLIDER_BASE.fbump/rbump=6; data/slider-baselines.json constants.damping_bump=6.0 | 6 | damping bump baseline. |
| consensus_baselines.brake_bias | int (%) | dashboard/app.js SLIDER_BASE.bbal=52; data/slider-baselines.json constants.brake_bias_front_pct=52 | 52% | front brake bias baseline. |
| consensus_baselines.brake_pressure | int (%) | dashboard/app.js SLIDER_BASE.bpress=100; data/slider-baselines.json constants.brake_pressure_pct=100 | 100% | brake pressure baseline. |
| consensus_baselines.diff_accel | int (%), drivetrain-conditioned | dashboard/app.js SLIDER_BASE_DT={FWD:{accel:70},RWD:{accel:55},AWD:{accel:55,center:80}}; data/slider-baselines.json by_drivetrain.\*.diff_accel_pct | 55 (RWD, as recorded in memory) | memory only records the RWD value; downstream code carries a fuller per-drivetrain table (FWD=70) NOT recorded in this memory file — a gap. |
| consensus_baselines.diff_decel | int (%) | dashboard/app.js SLIDER_BASE.decel=15; data/slider-baselines.json by_drivetrain.\*.diff_decel_pct=15 (all 3 drivetrains) | 15% | deceleration differential baseline. |
| consensus_baselines.awd_center | int (%, rear share) | dashboard/app.js SLIDER_BASE.center=80/SLIDER_BASE_DT.AWD.center=80; data/slider-baselines.json by_drivetrain.AWD.center_rear_pct=80 | 80% rear | AWD center diff split baseline. |
| consensus_baselines.mechanical_balance_target | float range + point | data/slider-baselines.json constants.mech_balance_target=0.60 and mech_balance_by_class{S2:0.62…D:0.55} (per-class breakdown NOT in this memory file — another gap) | 0.55-0.65, point ~0.60 | Mechanical Balance (front-grip-share) target band, phase-3/mid-corner target, set via ARBs. |
| consensus_baselines.aero_balance_target | float range | data/slider-baselines.json constants.aero_balance_front=0.42 (point value not recorded in memory ledger, only the range) | 0.40-0.45 | Aero balance (front downforce share) target band. |
| closing_note | text (prose) | — | — | states what the 7 guides collectively lack (no per-car slider min/max DB, no per-part PI table); cites forza.guide's calculator confirming k=f²·W_axle/19.56, 2.80Hz front/2.90Hz rear targets; validates the project's derivation-over-capture approach. |
| wikilinks[] (2 outbound) | array of text, Markdown `[[...]]` | → memory/fh6-data-capture-constraint.md, memory/fh6-slider-range-derivation.md | — | links to 2 sibling memory nodes. |
| inbound_wikilinks[] (derived, not stored) | n/a | dashboard/app.js:2826 (code comment) + data/slider-baselines.json:4 (its `purpose` string) both contain the literal token `[[fh6-external-tuning-sources]]` | — | 2 project files cite this node back (found by grep, not a field of this record). |

**Scale:** 1 record (1 memory file), 2,763 bytes, 28 lines. Body: 1 intro paragraph + 7-item trust-ranking list + 2-item error-catch list + 1 consensus-baselines paragraph (9 inline key:value pairs) + 1 closing paragraph with 2 wikilinks. Smallest of the 5 census-listed external-source stores — dwarfed by data/sources.json (97 entries), data/tuner-sheets.json (875KB / 2,344 raw codes), and ForzaTech Studio (29.3MB); its value is purely as a small human-curated provenance/trust layer upstream of larger downstream artifacts.

**Confidence:** verified

---

**Next: ref_field table.** This catalog — not the census — is the intended source for a planned `ref_field` table in `fh6.db`: one row per field documented above (store, field name, type, join target, enum/range, meaning, confidence), giving the project a queryable index over its own data instead of a document to grep. That table is not built yet. Per the project owner's own choice, writing this catalog came first; `ref_field` is a deliberate follow-up, not an oversight.
