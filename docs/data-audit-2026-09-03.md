# Data audit — 2026-09-03

Two databases, judged against the telos with everything learned since the last audit.

- **The loose corpus**: `Downloads\forza raw data files` (3,483 files, 374 MB, 136 folders) plus the game
  install, the save containers and the telemetry recordings. Collected by any means necessary.
- **The project database**: `data/fh6.db`, 53 tables, designed for this project (`db/schema.sql`).

The telos, in the owner's words: *use ALL possible data to store, use and analyze car upgrades and tuning
data; give data-backed recommendations with a full A/B testing architecture; and be a data-rich but
focused environment to learn how upgrades and tuning values affect driving.*

Data is graded in three camps:

| camp | what it is | lab tables |
|---|---|---|
| **A** Car metadata & performance | the car, its hardware, the tuning sliders, the physics behind them | `ref_car*`, `ref_engine`, `ref_part*`, `ref_slider`, `ref_*_curve`, `tune_*`, `hw_*`, `setup`, `ref_preset*` |
| **B** Course performance & metadata | where it was driven and how it went | `course*`, `lap*`, `corner_obs`, `session*`, `ref_route*`, `ref_track`, `ref_event`, `diag_event` |
| **C** Linking layer | the keys that let A and B be joined into one picture | ordinals, slot/part ids, `hw_hash`/`setup_hash`/`tune_hash`, `cid`, `route_key`↔`route_id`, the string tables, `ref_symptom` |

## Verdict

Camp A is on track and deep. Camp B is materially behind: the two layers the schema is proudest of
(road surface, events) are empty in the live database. Camp C has three broken links that silently
degrade both. The general pattern is that `docs/DATA-INVENTORY.md` over-reports and the live database
under-delivers, so the next audit must read `import_run`, not the inventory.

Every finding below was re-measured against `data/fh6.db` and the raw corpus on 2026-09-03; nothing is
taken from the inventory's own claims.

## Findings, ranked

### 1. Component ids on containers and packages are copies of the ordinal — camp C, critical

`tune_container.engine_id / drivetrain_id / carbody_id` and the same three on `hw_package` equal the car's
ordinal on **every row** (567/567, 580/580, 580/580; 493/493, 506/506, 506/506). Cause: the container
importer's `comp()` (`scripts/db/import_containers.py:165`) returns `ref_part.key_id`, and for the engine,
drivetrain and car-body slots the game keys the part table by Ordinal, so `key_id` *is* the car. The real
ids are in the part's JSON blob (`ref_part.data.EngineID`, `DrivetrainID`, `CarBodyID`, `MotorID`), and
they join their reference tables on the full value set (670/670, 662/662, 779/779, 19/19).
`export_options.py` knows this and works around it in a docstring. The schema comment on the columns
("resolved from the engine slot") is false today.

**Fix:** read the four ids from the fitted part's blob; drop the exporter's workaround; add REFERENCES.

### 2. The road-surface layer is empty in the live database — camp B, critical

`ref_route_surface` has 0 rows; `ref_route_turn.road_class` is NULL on all 3,812 turns; `ref_route.road_class`
is NULL on all 169 routes. The inventory says this source is *complete*. `import_run` tells the story:
eight `surface` runs succeeded up to 2026-09-03T00:37Z (284,207 rows), then commit `d91f3a4` renamed the
concept to `road_class` and every rebuild since fails with `KeyError: 'road_class'` (runs 55, 57, 67, 79,
all `ok=0`). The rename touched `import_surface.py` (`resolve()` reads `hit["road_class"]`,
line 248) but not the nav index it calls: `scripts/telemetry/fh6_nav.py:400` `SurfaceIndex.at()` still
returns the key `surface`.

**Fix:** one key rename in `fh6_nav.py` (or read `hit["surface"]`), then rebuild. Until then every
compound recommendation is made without knowing whether the road is paved.

### 3. Telemetry never binds to a hardware package at the session level — camp C, high

`session_car.hw_hash` is set on **0 of 393** rows: the importer only copies a `hw_hash` from the session
file's metadata (`import_telemetry.py:163,222`) and nothing writes one there. Laps bind by a different
route, `tune_hash` matching against `tune_container` (270 of 331 laps have a container; 61 do not), and
`diag_event.container` follows the lap (5,021 of 8,898). So the A/B architecture the telos names rests
on one hash match per lap, with no session-level fallback, and 39% of diagnosis events float free of any
setup.

**Fix:** derive `session_car.hw_hash` from the bound laps (or from the newest container for that
ordinal at session time) and record which rule bound it.

### 4. Events do not exist — camp B, high

`ref_event` has 0 rows and no importer writes it (`grep` finds no INSERT). `course.event_id` can never
resolve, `ref_route.name` is empty ("filled once the event datasets are decoded"), and course↔route
matching stands at 7 verified, 2 probable, 31 partial, 17 none of 57. The names are already in hand:
the raw folder's `CareerRace.csv` (252 event names, e.g. "Edogawa Cross Country Circuit"),
`DangerSigns.csv` (39), `DriftZones.csv` (32), `Trailblazers.csv` (19) and `Tracks.csv` are string-table
exports keyed by the same hash scheme as `ref_string`. What is missing is the event *definition*
(route, class limit, PI limit), which is not in the 205-table game DB and must come from the event
datasets under the install.

### 5. Real joins that live only inside JSON blobs — camp A/C, medium

Nine `data TEXT` columns hold 538 distinct keys with no recorded type, domain or join target
(`ref_part.data` 163, `ref_car.data` 151, `ref_compound.data` 122, `ref_track.data` 49 …). A
value-set containment test against every primary key found these exact, undeclared joins:

| blob key | joins | coverage |
|---|---|---|
| `ref_part.data.TorqueCurveFullThrottleID` | `ref_torque_curve.curve_id` | 1,706 / 1,706 |
| `ref_part.data.TireCompoundID` | `ref_compound.compound_id` | 39 / 39 |
| `ref_part.data.EngineID / DrivetrainID / CarBodyID / MotorID` | their ref tables | all |
| `ref_compound.data.FrictionMultiCurve*ID` (9 keys) | `ref_friction_curve.multicurve_id` | 41 / 41 each |
| `ref_car.stock_engine_id / stock_drivetrain_id / stock_carbody_id` (typed columns, no REFERENCES) | their ref tables | 642 / 660 / 660 |

And twelve enum keys whose lookup tables exist in the game DB and the CSV exports but were never
imported: `MakeID`→`List_CarMake` (90), `CountryID`→`List_Country` (30), `CylinderID`→`List_Cylinders`
(14), `EngineConfigID`→`List_EngineConfig` (9), `AspirationTypeId`→`List_Aspiration` (8),
`FamilyModelID`→`List_FamilyModel` (36), `FamilyBodyID`→`List_FamilyBody` (46), `TireBrandID`→
`Combo_TireBrandCompound` (30, carries per-brand friction/wear/price scales), `ShiftSystemID`→
`List_ShiftSystem` (7), `Front/RearBrakeTypeID`→`List_BrakeType` (5), `EnvironmentId`→`Environments` (91).

### 6. Untouched game tables that serve the telos — camp A, medium

108 non-empty game tables are referenced by no import script (the 49 slot tables are imported
data-driven through `ref_slot.source_table` and are excluded). 52 are car/hardware/tuning. The ones
that matter, by what they would let the lab say:

| table | rows | why it matters |
|---|---|---|
| `UpgradeWizardParts`, `UpgradeWizardPartsRemoval`, `UpgradeWizardPowerRemoval` | 87 + 30 + 17 | **the game's own upgrade recommender**: part-by-level order for a balanced build and the removal order when over PI — a direct, authored baseline for the telos's recommendations |
| `List_BrakeProfile` | 35 | ABS duration and release points, brake bias scaler, min brake position by steer — what `ref_part.data.BrakesProfileID` points at |
| `List_TractionControl` | 10 | slip start/end per surface for each TC profile (`TCProfileID`) |
| `List_TireAffectCurve` | 33 | temperature→wear, temperature→friction, camber→friction curves the compounds reference (`AffectCurve*ID`) |
| `Combo_TireBrandCompound` | 30 | per-brand scaling of price, wear, friction and peak slip |
| `Data_Car_Buckets`, `CarBuckets` | 644 + 49 | the game's car bucketing (bucket names resolve through `ref_string`) |
| `List_PreloadAndDroopDamper`, `List_ThirdSpringElement`, `List_RearSteeringSettings`, `List_SteeringSettings`, `List_VariableTiming`, `List_AeroStaticSystem` | 9, 9, 9, 7, 3, 2 | small physics enums behind slider bands and part behaviour |
| `CarUpgradeExceptions` (NoRimStyles), `CarInvalidDefaultParts`, `CarTrackOffsets`, `WheelNormOffsets`, `Powertrains` | 6, 2, 77, 111, 8 | per-car gating and geometry offsets |

Not relevant and safe to leave: `CarPartPositions` (model-space positions), `CarRarities`, `PrizeCars`,
`TrafficCars`, `RentalCars`, `BarnfindCars`, `VoiceOfCarTriggers`, every `Livery_*`, `CameraOverrides`,
`PlayerNames`, `OnDiscContent`, the `AIDrivingBehavior*` family.

### 7. The inventory is hand-maintained and drifts — docs, low

The inventory reports 221 recordings / 107 sessions imported (live: 125 files / 121 sessions), 60 courses
(live: 62) and the surface layer *complete* (live: empty). None of these numbers is wrong by much except
the one that matters. `import_run` already records every step, its row counts and its failures; the
inventory's coverage tables should be generated from it on every rebuild, and a failed step should
appear there as a failure, not disappear.

### 8. What the loose corpus turned out to be — information

- The two SQLite files (`FH6_Database.sqlite`, `full forza DB - Copy.db`) are **content-identical**: same
  205 tables, row counts, schema and per-table content hashes; only page-level bytes differ. No staleness.
- The 69 CSVs split 25 that mirror game tables and **44 that are string-table exports** (HashId, KeyName,
  Content) — the ID→name layer in text form, not new data. Useful as the event-name lead in finding 4.
- The ONYX vehicle database is 638 car ids scanned from asset zips; `ref_car` already holds 660 from the
  game DB. Redundant.
- The 3,018 `.materialbin` / `.swatchbin` / `.modelbin` files share one header (`burG 01 01`, the Forza
  "Grub" bundle) and the `importer/` folder holds the community binary templates and Python parsers for
  it. Decodable, but art and materials: nothing in them is tuning data.
- 37 `.nt` files under `trackroutes/` are XML locator lists (name, GUID, world transform) for event start
  and end points — a camp-B lead that pairs with finding 4.
- Small root-level binaries worth a second-pass look: `physicsdefinition.bin` (1,584 B),
  `Lights.bin`, `LightPresets.bin`, `ManufacturerColors.bin`. The `.carbin` and its debug sibling are a
  single-car scene dump (2019 Golf R), covered by `CarScene_carbin.bt`.
- Two executables and an installer sit in the folder. They are tools, not data, and stay unrun.

## Camp scorecard

| camp | held in the corpus | in `fh6.db` | linked | verdict |
|---|---|---|---|---|
| A car & hardware | 205-table game DB, 87,655 parts, 448 presets, 1,725 torque and 738 friction curves, 580 containers | complete for slots, cars, sliders, curves; 52 relevant tables and 538 blob keys untyped | ordinal, slot/part, hw/setup hash all sound; component ids broken (F1) | **on track**, depth ahead of typing |
| B course & performance | 169 routes with width/banking, 125 sessions, 331 laps, 123,619 points, 3,812 route turns | surface layer empty (F2), events absent (F4), 17 of 57 courses unmatched | 61 laps unbound, 39% of diagnosis events unbound (F3) | **behind** — the schema is ahead of the data |
| C linking | 58,722 strings, hashes, ordinals, part keys | present, but three links false or missing (F1, F3, F4) | — | **needs the three fixes before any A/B claim is trusted** |

## The field catalog

Every important field should be described by structure, not held as a blob: storage class, cardinality,
range, enum source, join target, confidence. The profiler that produced findings 1 and 5 already computes
all of that for 1,144 fields and keys; it should become `ref_field`, a table in `fh6.db` regenerated on
every rebuild, so the dashboard, the CLI and the next audit read one row instead of re-deriving.

## Status after the lightning pass (2026-09-03, same day)

Items 1–3 below are **done and verified** against the live database: surface layer restored
(284,208 rows; 2,908 paved / 590 loose / 314 unknown turns; 111 paved / 39 mixed / 3 loose routes),
component ids now join their reference tables on every row (0 equal the ordinal; `body_variant`
populated for the first time, 111 kit bodies), and `session_car.hw_hash` bound on 78 of 398 rows —
exactly the sessions whose laps bound. The rename had left two more stale `surface` column names
in `import_surface.py` and the index in `schema.sql`; both fixed. One hazard found on the way:
`--only` reruns must follow stage order — the telemetry stage deletes `course` and `course_route`
cascades away until `routes` reruns, and `routes` rewrites `ref_route_turn` and clears road class
until `surface` reruns. Items 4–7 remain open.

## Order of work

1. Fix the surface import key (F2) and rebuild. One line; restores 284,207 rows.
2. Fix the component ids (F1); remove the exporter workaround; add REFERENCES on the stock ids.
3. Bind `session_car.hw_hash` from laps (F3) and record the binding rule.
4. Promote the blob joins (F5): torque-curve and compound ids on `ref_part` as typed columns; import the
   twelve enum tables.
5. Import the upgrade-wizard, brake-profile, traction-control and tire-affect tables (F6).
6. Add `ref_field` and generate the inventory's coverage section from `import_run` (F7).
7. Decode the event datasets and fill `ref_event` from the string tables plus the `.nt` locators (F4).
