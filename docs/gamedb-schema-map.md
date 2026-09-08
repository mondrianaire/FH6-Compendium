# FH6 game database — grounded schema map

Built by direct introspection of the actual files in `C:\Users\mondr\Downloads\forza raw data files`
on 2026-09-08. Every table name, row count, column list and value below was read from the DB, not
inferred. (This supersedes the fabricated "Car Specifications Table / VehicleID 12847" schema from
the AI-transcript PDF, which was invented before any file was read.)

## The database files in that folder

| file | size | md5 | verdict |
|---|---|---|---|
| `FH6_Database.sqlite` | 13,328,384 B | `675919…3398` | the decrypted game DB — **205 tables** |
| `gamedbRC_decrypted.sqlite` | 15,582,208 B | `c5b6bf…4a32` | **same 205 tables, byte-identical row counts** — a re-decrypt, functionally equal (extra 2.3 MB is unvacuumed free pages) |
| `full forza DB - Copy.db` | 13,328,384 B | `28e57e…1fb5` | working copy of `FH6_Database.sqlite` (differs only in the SQLite change counter) |
| `Copy.db`, `DB`, `-` | 0 B | — | debris from a failed extract command; not stores |

Totals in the game DB: **205 tables, 0 views. ~490k rows.** The 24 largest tables are all upgrade
catalogs or physics grids. `NewProfile_*` tables carry schema but **0 rows** (this is the game
catalogue, not a player save).

## How names resolve (critical)

- `DisplayName` / `Description` / `ShortDisplayName…` columns are **string references** written as
  `_&<19-digit-hash>`. They resolve through the game string tables (`EN.zip` → the project's
  `ref_string`, 58,722 strings). They are **not** human-readable inline.
- Human-readable inline columns exist and are the shortcut: `Data_Car.MediaName`
  (`FER_250GTO_64`, `MER_300SL_54`), `List_CarMake.ManufacturerCode` (`FER`, `TOY`, `POR`),
  `List_DriveType.DriveType` (`FWD`/`RWD`/`AWD`), `List_Aspiration.Aspiration`,
  `List_EngineConfig.EngineConfig`, `CarClasses.BadgeTexturePathPrefix` (`CLASS_R`), and every
  `UpgradeTypes.PartName`.

## Grounded reference vocab (the small enum tables, read in full)

### CarClasses — the class ladder (8 rows, Id 0–7)
| Id | badge | max display PI | career min PI | norm_max |
|----|-------|------|------|------|
| 0 | CLASS_D | 400 | 0 | .2874 |
| 1 | CLASS_C | 500 | 0 | .4003 |
| 2 | CLASS_B | 600 | 0 | .5069 |
| 3 | CLASS_A | 700 | 251 | .6058 |
| 4 | CLASS_S1 | 800 | 601 | .7012 |
| 5 | CLASS_S2 | 900 | 701 | .7931 |
| 6 | **CLASS_R** | 998 | 801 | .8862 |
| 7 | **CLASS_X** | 999 | 901 | 1.0 |

R and X are **distinct game classes** (Id 6 and 7). R is not missing from the ladder — it sits
between S2 and X with a 998 PI cap. Live telemetry's `CarClass` collapses the top two into "X",
which is the only reason the dashboard shows a single top class.

### List_Cylinders (CylinderID ≠ cylinder count — map through it)
1→4, 2→5, 3→6, 4→8, 5→10, 6→12, 7→16, **8→2 (rotary, 1 rotor label)**, 9→3 rotary, 10→0,
11→3, 12→4 rotary, 13→2, 14→1. The `Rotors` flag marks rotary entries.

### List_DriveType: 1 FWD · 2 RWD · 3 AWD
### List_EnginePlacement: 1 Front · 2 Mid · 3 Rear
### List_EngineConfig: 1 V · 2 W · 3 I (inline) · 4 Rotary · 5 F (flat) · 6 E (electric) · 7 SH · 8 PH · 9 SPH (hybrids)
### List_Aspiration: 1 Natural · 2 Turbo · 3 Twin Turbo · 4 Quad Turbo · 5 DSC · 6 CSC · 7 Both Turbo/SC · 8 None
(`KeyPartName` links each to its upgrade: Turbo→SingleTurbo, DSC→SuperchargerDSC, etc.)
### List_CarMake: 90 makes, keyed by `ManufacturerCode` (ACU, AST, AUD, BMW, FER, FOR, HON, LAM, MER, NIS, POR, TOY, VW…)

**Caveat found in the data:** `Tracks.Length` is `5954` on essentially every one of the 58 rows —
a placeholder. Real route length comes from the `.owt` files / `ref_route`, never this column.

## The 205 tables, by domain

### Car master data (`Data_*`)
| table | rows | cols | holds |
|---|---|---|---|
| `Data_Car` | 660 | 151 | the car master: Id, Year, MakeID, ClassID, PowertrainID, CurbWeight, WeightDistribution, NumGears, TireBrandID, BaseRarity, tire widths/aspects/diameters, DisplayName/ModelShort/MediaName |
| `Data_CarBody` | 779 | 20 | body variants (dimensions) |
| `Data_Engine` | 670 | 24 | EngineID, ConfigID, CylinderID, Compression, AspirationID_Stock, StockBoost-bar, GasTankSize, graphing peaks, Diesel/Rotary/Carbureted flags |
| `Data_Drivetrain` | 662 | 4 | DrivetrainID, DrivetypeID, EngineMountingDirection, ShiftSystemID |
| `Data_Motor` | 19 | 12 | electric motors: mass, RedlineRPM, TorqueCurveFullThrottleID, BatteryCapacity |
| `Data_Car_Buckets` | 644 | 4 | class/PI banding inputs |
| `Data_UpgradePart` / `…Category` / `…Order` | 50 / 5 / 50 | | upgrade-part indexing |

### Upgrade catalogs (`List_Upgrade*`) — the shop grid, ~40 tables
Engine family: `List_UpgradeEngine` (2,944), `…Camshaft` (1,706), `…Displacement` (1,791),
`…Valves` (1,845), `…Intake` (1,814), `…Exhaust` (1,770), `…Ignition` (1,618), `…Intercooler`
(1,617), `…FuelSystem` (1,649), `…OilCooling` (1,664), `…PistonsCompression` (1,560), `…Manifold`
(817), `…TurboSingle` (1,005), `…TurboTwin` (1,154), `…TurboQuad` (0), `…Flywheel` (2,060),
`…RestrictorPlate` (109), `…DSC` (521), `…CSC` (260), `…Motor` (33), `…MotorParts` (50).
Drivetrain: `…DrivetrainTransmission` (4,986), `…DrivetrainDifferential` (3,440), `…DrivetrainDriveline`
(1,916), `…DrivetrainClutch` (1,738), `…Drivetrain` (1,352).
Suspension/body: `…SpringDamper` (2,708), `…AntiSwayFront` (1,518), `…AntiSwayRear` (1,554),
`…CarBody` (779), `…CarBodyWeight` (2,536), `…CarBodyChassisStiffness` (2,227), `…FrontBumper`
(1,736), `…RearBumper` (1,052), `…SideSkirt` (1,053), `…Hood` (1,204), `…TrackSpacingFront/Rear`,
`…TireWidthFront/Rear` (3,421 / 3,519), `…TireAspectRatioFront/Rear`, `…RimSizeFront/Rear` (2,295 / 2,299).
Brakes: `…Brakes` (1,668, incl. rotor mm, caliper pistons, drum depth). Aero: `…RearWing` (1,642).
Tires: `…TireCompound` (6,590). Wheels: `List_Wheels` (1,248).

### Physics grids (behind the sliders and the sim)
`List_SpringDamperPhysics` (5,414×47), `List_AeroPhysics` (1,726×25), `List_AntiSwayPhysics`
(3,072×7), `List_TorqueCurve` (1,725×250 — a dyno per camshaft part, sampled every 100 rpm),
`List_TireFrictionCurve` (738×103), `List_TireFrictionMultiCurve` (369×7 — the load blend),
`List_TyreCurveDB` (41×92 — authored tyre peaks), `List_TireCompound` (41×122), `List_TireAffectCurve`
(33×57), `List_BrakeProfile` (35×13), `List_TractionControl` (10×43), steering / third-spring /
preload-droop / aero-static / damage-mod definition tables.

### Upgrade meta
`Upgrades` (248 — TypeId + Level, the tier list), `UpgradeTypes` (53 — `PartName`: Engine, Intake,
Camshaft, SingleTurbo, TwinTurbo, SuperchargerCSC/DSC, Transmission, Differential, Driveline,
SpringDamper, AntiSwayFront/Rear, CarBody, RimSize…), `UpgradePresetPackages` (448×58 — complete
factory builds), `Powertrains` (8), `UpgradeAreas`, `UpgradeWizardParts`.

### Enums / vocab
`List_CarMake` (90), `List_PartManufacturer` (739), `List_PartAttribute` (546), `CarClasses` (8),
`List_Cylinders` (14), `List_Aspiration` (8), `List_EngineConfig` (9), `List_DriveType` (3),
`List_EnginePlacement` (3), `List_CarType` (3), `List_Country` (30), `List_Region` (3), color /
finish / shift-system / brake-type / material-type / family tables.

### Livery / customization
`Livery_DecalsSortOrder` (19,649), `Livery_VinylsDecals` (1,442), `Livery_Decals` (708),
`Livery_Categories`, `Livery_VinylNames`, `Livery_Materials`, `LiveryStripes`, `PaintableGroups`,
`List_SpecialColors`.

### Tracks / world / events
`Tracks` (58×49 — but `Length` is a placeholder), `Environments` (91×21 — Location, MapX/MapY),
`ContentOffers` / `…Mapping`, `EventBlueprint*` (flyer styles/restrictions/backgrounds),
`OnDiscContent` (621), `CareerRaceCollectionTypes`.

### Cars — misc catalogues
`CarRarities` (767), `CarDetails` (33), `CarBuckets` (49), `CarExceptions` (511 — livery gating,
not upgrade gating), `CarPartPositions` (2,413), `CarTrackOffsets` (77), `AllIECars` (118),
`PrizeCars`, `RentalCars`, `TrafficCars`, `BarnfindCars`, `MidnightCars`, `RecommendedCars`,
`UnobtainableCars`, `HorizonRecommends`.

### AI / Drivatar
`AIDrivingBehaviorObservationDefaults` (209), `AIDrivingBehaviorObservationModel_*`,
`DrivatarTestingObservationDefaults` (89), `AITemperaments`, `AIMistakeScales_*`, `AILineChoices`,
`AIDynamicLineObservations`, `AIPlayerColors`, `AutoSteerOverrides`.

### Player-profile schema (0 rows — catalogue DB, not a save)
`NewProfile_Career_Garage` (0×144), `NewProfile_CareerRaces` (0×59), `NewProfile_Career_PurchasedParts`,
`NewProfile_BarnFinds`, `NewProfile_FreeCars`, `NewProfile_PhotoCaptures`, `NewProfile_CareerRaceCollections`.

## The rest of the folder (not the DB)

- **71 CSV exports** of game tables (`Data_Car.csv`, `CareerTrackInfo.csv`, `ChallengeData.csv` 645 kB…) — flat dumps, headers = columns.
- **290 `.str`** string-table dumps · **335 `.xml`** · **13 `.py`** · **8 `.json`** · **32 `.bin`**.
- **ForzaTech asset dump**: 1,856 `.materialbin`, 1,029 `.swatchbin`, 133 `.modelbin`, plus `.nt`, `.bt`.
- **Executables — never run**: `FH6 Helper_[unknowncheats.me]_.exe`, `LapSmith-Setup-0.2.2.exe`,
  `DB.Browser.for.SQLite…msi`, `ForzaTech.Studio.zip`.

## Cross-check vs `docs/DATA-INVENTORY.md` (treated as a hint, not canon)
The inventory's §0/§5 already describe this DB and agree with the census (205 tables; `Data_Car`
660; the curve tables; the class ladder mirrored in `ref_class`). Deltas this fresh read found:
the second decrypted DB (`gamedbRC_decrypted.sqlite`) is not listed; the CSV count is **71**, not
"~70"; and the class ladder is now confirmable from `CarClasses` directly rather than by inference.
