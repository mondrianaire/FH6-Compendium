# Format — `C_ProfileData`, the FH6 profile save

The newest and richest store the lab has found: the game's own profile save. It carries, already decoded
by the game itself, **every owned car instance with its full build, every tune slider, its equipped tune
and livery, and its usage stats** — the data the lab otherwise reverse-engineers out of `Tuning_*`
containers one save at a time.

*Enumerated 2026-09-18 from a live decrypt of this machine's profile. Every offset, count and field name
below is measured from that file, not inferred. Where something is not yet understood it says so.*

| | |
| --- | --- |
| **Live path** | `C:\XboxGames\GameSave\pgs\u_<xuid>_16D460\<ver>\ContainersRoot\User_<hex>\C_ProfileData` |
| **Siblings** | `C_ProfileData_SCopy` (identical shadow copy), `C_ProfileBackup` (older snapshot), `<xuid>Meta` |
| **Encrypted size** | 820,548 bytes (this capture) |
| **Decrypted size** | 3,610,427 bytes |
| **Encryption** | Arxan TransformIT-family; decrypted by ForzaCryptoTool **3.1.0**, which uploads to a third-party backend (`IVs derived server-side`). See `docs/fh6-profile-crypto-mimicry.md` |
| **Write trigger** | The game flushes it live — equipping a tune writes here and **not** to a `Tuning_*` container |
| **Read by** | `scripts/telemetry/fh6_profile.py` (locate → copy → decrypt on approval → parse) |

> **Safety rules, non-negotiable.** `C:\XboxGames` is read-only: always decrypt a **copy**. Never run a
> write op (`encrypt`, `profile-set`, `saveswap`, `restore`) against the live save. The decrypt uploads
> the save to a third party, so it happens only on an explicit human approval, never silently and never
> per-frame.

**Every field, exhaustively:** [`docs/format-c-profiledata-fields.md`](format-c-profiledata-fields.md) — all 714
typed properties by name with type, size and a sample value, and all 9 SQLite tables with every column, its
type and how many rows populate it. That file is generated from a decrypt, not written by hand; this one
explains the structure it inventories.

## 1. Region map

Whole-file layout of the decrypted blob, with the offsets measured in this capture. Only the header and
the section magics are fixed; **every other offset shifts per save — anchor on the magics, never on a
constant.**

| Region | Offset | Size | Contents |
| --- | ---: | ---: | --- |
| Header | 0 | 12 B | magic + section pointer + count |
| Property tree | 12 | 27,076 B | **714** typed named properties |
| BXML | 27,104 | — | magic `BXML`, version 2, **5,548** nodes |
| Interned string table | 27,119 | 52,808 B | **1,901** `[u16 len][bytes]` entries, sorted |
| Binary records | 79,927 | 2,518,788 B | **112** binary car-state records (framing not yet decoded) |
| Embedded SQLite | 2,598,715 | 1,011,712 B | the career database — **9 tables** |

The tool's own `profile-inspect` agrees on every count (714 properties, 5,548 BXML nodes, 112 binary
records, SQLite `ok`), which is the cross-check that this map is read correctly.

## 2. Header

```
b6 f2 8b 4a   magic (u32 LE 0x4a8bf2b6)
d0 69 00 00   u32 = 27088 — end of the property tree / start of the BXML block
15 00 00 00   u32 = 21    — top-level property-group count
```

## 3. Property tree — 714 typed properties

One record per property, laid out back to back from offset 12:

```
[u8  0x00]           record start
[u32 0x00000020]     kind marker (32) — constant on every record in this capture
[u32 nameLen]
[u8  nameLen] name   ASCII, e.g. "MouseLookLeftRightSensitivity"
[u32 typeCode]
[payload]            size depends on typeCode
```

Type codes, measured across all 714 records:

| Type | Count | Payload | Meaning (inferred from values) |
| ---: | ---: | --- | --- |
| `3` | 183 | 4 B | u32 counter / setting (e.g. `Crowds`) |
| `9` | 176 | 4 B | **float32** (e.g. `MouseLookLeftRightSensitivity` = 1.0) |
| `1` | 146 | 1 B | bool / small enum (e.g. `Horns`) |
| `7` | 107 | 4 B | u32 flag-ish (e.g. `RewindOnBack`) |
| `0` | 42 | 1 B | bool (e.g. `MouseLookUpDownInvert`) |
| `17` | 20 | 4 B | reference / index (e.g. `Credits`) |
| `4` | 15 | 8 B (×14), 1,220 B (×1) | u64 counter (e.g. `TotalSkills` = 19,608,412); the one large payload is a blob |
| `15` | 14 | 4 B | **group node** — payload is the child count (e.g. `MouseControlOptions`) |
| `11` | 11 | 4 / 12 / 40 B | variable-length (e.g. `PrivateLicensePlate`) |

Groups seen at the top level include `MouseControlOptions`, `BristolOptions` and `Main`; `Main` is where
the career-wide counters live (`Credits`, `TotalSkills`, `NumSkillTokens`, `NumUltimateWreckages`, …).
The full name/type/size list is reproducible with the walker in §8.

## 4. Interned string table — and the equipped-tune rule

Entries are `[u16 len][bytes]`, laid consecutively and sorted; 1,901 in this capture. The table holds
property names, enum names (`vec3`, `wstring`), GUID strings and world coordinates.

Its value to the lab is a specific invariant: **the game interns the *current* car's equipped container
names into this table**, so a lone real `Tuning_<ordinal>_<timestamp>` here identifies both the current
car and the exact equipped tune — the one thing live telemetry cannot give, since the UDP packet carries
only the ordinal and not which of several instances is in use.

> ⚠ **Measured caveat — this capture has ZERO interned `Tuning_`/`Livery_` entries.** The profile was
> written at 05:52 today with no current-car context (saved from a menu), so `current_equipped()` returns
> `None` here even though the file is otherwise complete. This confirms the caveat recorded when the rule
> was found, and it is not an edge case to hand-wave: a consumer **must** treat `None` as normal,
> cross-check the interned ordinal against live telemetry when present, and fall back to the save-tune
> tie logic otherwise. The equipped tune of **non-current** instances is never interned — it lives only
> in the SQLite garage (§6).

## 5. BXML and binary records

**BXML** begins at the `BXML` magic: `42 58 4d 4c | 02 | 6a 07 00 00 | 0a | b8 00 00 00` — version `2`,
then a u32 (1,898) and a u8/u32 pair (10 / 184). It holds the save-state string table and index-referenced
values, including `CurrentCarState` / `CurrentContainerName`. The lab does **not** parse BXML: the
interned-table scan (§4) answers the same question more cheaply.

**Binary records** occupy 2.5 MB between the string table and the SQLite magic; `profile-inspect` counts
112 of them (registered and seasonal car-state records). Their framing is **not decoded** and there is no
reason to decode it — the same per-instance build and tune data is available already-structured in
`Career_Garage`. Recorded here so nobody re-derives it by accident.

## 6. Embedded SQLite — the career database

Carve from the `SQLite format 3\0` magic to EOF. The header's page count is 0, so the file must be opened
by size; sqlite tolerates the carve.

| Table | Rows | Columns |
| --- | ---: | --- |
| **`Career_Garage`** | **815** | **146** — one row per owned car INSTANCE (see below) |
| `Career_PurchasedParts` | 8,015 | `GarageId`, `UngroupedPartEnum`, `PartId`, `PricePaid` |
| `PhotoCaptures` | 481 | `CarOrdinal` |
| `BarnFinds` | 15 | `CarOrdinal`, `State`, `VIN` (a GUID) |
| `CarExperienceUnlocks` | 4 | `CarID` |
| `FreeCars` | 0 | `CarId`, `FreeCount` |
| `CareerRaces` | 0 | 59 cols — the event schema (`CareerRaceId`, `TrackId`, `RaceModeId`, `NumLaps`, `CustomRoute`, `RouteContainerName`, weather/season fields …) |
| `CareerRaceCollections` | 0 | 9 cols (`Name`, `Description`, `CreatorXUID`, `CarRestrictions`, …) |
| `CareerRacesInCollection` | 0 | 3 cols |

The three `CareerRace*` tables are **empty** — they are the blueprint/custom-event schema, populated only
for user-created events. The route-bearing columns there are the same ones already proven empty in the
game DB, so this is not a new route source.

### `Career_Garage` — all 146 columns

**Identity (3).** `Id` (garage row id), `CarId` (**the ordinal**), `Guid` (the stable per-instance UUID —
this is what makes several instances of one ordinal distinguishable; 815 instances cover 596 ordinals,
with up to 11 instances of a single ordinal).

**Equipped references (5).** `TuneFileName` (populated on 238/815 — the `Tuning_<ord>_<ts>` container
this instance has equipped), `LiveryFileName` (424/815), `VersionedTuneId` and `VersionedLiveryId`
(GUIDs, all 815), `VersionedTuneXUID` (365/815 — the **creator's** XUID, so a downloaded tune's author).

**Engine and drivetrain parts (33).** `Engine`, `Motor`, `MotorParts`, `Drivetrain`, `CarBody`,
`AspirationTypeId`, `Camshaft`, `Valves`, `Displacement`, `PistonsCompression`, `FuelSystem`, `Ignition`,
`Exhaust`, `Intake`, `Manifold`, `RestrictorPlate`, `OilCooling`, `Flywheel`, `SingleTurbo`, `TwinTurbo`,
`QuadTurbo`, `SuperchargerCSC`, `SuperchargerDSC`, `Intercooler`, `Clutch`, `Transmission`, `Driveline`,
`Brakes`, `SpringDamper`, `Differential`, `AntiSwayFront`, `AntiSwayRear`, `ChassisStiffness`.

**Body, wheels and tyres (16).** `FrontBumper`, `RearBumper`, `RearWing`, `Hood`, `SideSkirts`,
`WeightReduction`, `TireCompound`, `TireWidthFront`, `TireWidthRear`, `TireBrand` (**0/815 — never
populated**), `WheelStyle`, `WheelStyleRear`, `RimSizeFront`, `RimSizeRear`, `TrackSpacingFront`,
`TrackSpacingRear`, plus `FrontAspectRatio` / `RearAspectRatio` and the two
`{Front,Rear}TireAspectRatioOffset` columns.

**Tune sliders (36) — real physical values, not normalised.** `Tuning_finalDriveRatio` and
`Tuning_firstGear` … `Tuning_tenthGear` (11), `Tuning_{front,rear}TirePressure`,
`Tuning_{front,rear}Camber`, `Tuning_{front,rear}Toe`, `Tuning_frontCaster`,
`Tuning_{front,rear}Swaybar`, `Tuning_{front,rear}Spring`, `Tuning_{front,rear}RideHeight`,
`Tuning_{front,rear}BumpRatio`, `Tuning_{front,rear}DampingStiffness`, `Tuning_{front,rear}Accel`,
`Tuning_{front,rear}Decel`, `Tuning_{front,rear}Downforce`, `Tuning_brakeBalance`,
`Tuning_brakePressure`, `Tuning_centerTorque`. All 815 populated.

**Performance (19).** `PerformanceIndex`, `ClassID`, `CurbWeight`, `WeightDistribution`, `SimPeakPower`,
`SimPeakTorque`, `SimPeakTorqueAngVel`, `SimPeakAngVel`, `SimRedlineAngVel`, `PeakIntakePSI`, `TopSpeed`,
`Traction_Road`, `Traction_OffRoad`, `Traction_Snow`, and the six game ratings (`SpeedRating`,
`HandlingRating`, `AccelerationRating`, `LaunchRating`, `BrakingRating`, `OffroadRating`).

**Ownership and usage stats (13).** `DistanceDriven`, `TimeDriven`, `TimeDrivenInRoadTrips`, `NumRaces`,
`NumVictories`, `NumPodiums`, `TotalWinnings`, `CurOwnerNumRaces`, `CurOwnerWinnings`, `NumOwners`,
`OriginalOwner` (806/815), `NumTimesSold`, `TotalRepairs`, `NumSkillPointsEarned`, `HighestSkillScore`,
`IsFavorite` (81/815), `Flags`, `HasCurrentOwnerViewedCar`, `SharedID`, `Thumbnail`,
`DefaultManufacturerColorIndex`, `PartsValue`.

**Always-empty in this capture (7).** `TireBrand`, `CarGroup`, `RebuildModTorque`, `RebuildModGrip`,
`RebuildModBraking`, `RebuildModWeight`, `RebuildScore` — all 0/815. Treat as unused, not as missing data.

### Field-value notes that matter

- **`PerformanceIndex` is the NORMALISED PI (0..1), not the displayed number.** Do **not** multiply by
  1000. Verified: the per-`ClassID` ranges in this file land exactly on the lab's `ref_class.norm_max`
  boundaries — ClassID 0 tops out at 0.2874 (D), 1 at 0.4003 (C), 2 at 0.5069 (B), 3 at 0.6058 (A),
  4 at 0.7012 (S1), 5 at 0.7931 (S2), 6 at 0.8862 (R). Convert through `ref_class`, the way the lab
  already does.
- **`ClassID` is the game's own class index: 0=D, 1=C, 2=B, 3=A, 4=S1, 5=S2, 6=R, 7=X.** This is direct
  evidence on the open R-vs-X question: the game separates 6 and 7, and the lab's map of class 6 → "X"
  is a mislabel. This capture holds 27 instances at ClassID 6 and one at ClassID 7 (norm 0.9136).
- **`TuneFileName` joins straight to our `tune_container.container`** — the same `Tuning_<ord>_<ts>`
  string the save decoder already keys on.
- **`Career_PurchasedParts.GarageId` joins `Career_Garage.Id`**, giving purchase history and price per
  part per instance.

## 7. Why this store matters

- It is the **authoritative equipped-tune mapping**. Equipping writes here, not to a `Tuning_*` container,
  which is exactly why identity previously could not be settled by equipping.
- It supplies the **per-instance UUID** (`Guid`). Live telemetry gives the ordinal only, so where several
  instances share an ordinal — 11 of one car here — the profile is the only thing that can tell them apart.
- It is an **already-decoded build+tune corpus** for every owned car: 815 instances × (parts + 36 real
  slider values + PI/class + stats), against the 754 containers the save decoder has reverse-engineered.
- Usage stats (`DistanceDriven`, `NumRaces`, `NumVictories`) exist nowhere else in the lab.

## 8. Reproducing this enumeration

```bash
# 1. copy (never decrypt in place), 2. decrypt on explicit approval, 3. parse read-only
cp "<live C_ProfileData>" "$SCRATCH/C_ProfileData.enc"
ForzaCryptoTool.exe decrypt "$SCRATCH/C_ProfileData.enc" -o "$SCRATCH/profile_dec.bin" -y -f
ForzaCryptoTool.exe profile-inspect "$SCRATCH/profile_dec.bin"      # counts to cross-check against
python scripts/telemetry/fh6_profile.py "$SCRATCH/profile_dec.bin" --equipped --garage
```

Section offsets: anchor on the magics (`BXML`, `SQLite format 3\0`, the property-name `CurrentCarState`),
never on the constants in §1 — they move with every save. Delete the plaintext when finished; it contains
the account XUID (`2533274793510722` here) and the whole career.

## 9. Open questions

- **Binary-record framing** (112 records, 2.5 MB) — undecoded, and deliberately so while `Career_Garage`
  answers the same questions.
- **The "exactly one interned tune" invariant** still needs confirming across captures *that have* a
  current car; this capture had none, which proves only the empty case.
- **`Flags`, `SharedID`, `UngroupedPartEnum`** — meanings not established.
- **Ingest.** Nothing imports this yet. A `garage_*` layer keyed on `Guid` would give the lab per-instance
  identity and an 815-row decoded tune corpus; that is a design decision, not a documentation gap.
