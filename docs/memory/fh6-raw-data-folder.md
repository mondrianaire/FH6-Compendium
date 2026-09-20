---
name: fh6-raw-data-folder
description: "C:\\Users\\mondr\\Downloads\\forza raw data files — the decrypted FH6 game database (FH6_Database.sqlite, 205 tables) plus 66 string-table CSVs and 288 .str files; part ids in save containers are its primary keys, names resolve via a split 64-bit hash"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T16:25:39.476Z
---

Folder: `C:\Users\mondr\Downloads\forza raw data files` (an additional working directory). Dropped by Jett on 2026-09-02 after a GitHub search ([[jett-github-first-research]]).

What is in it and what it settles:
- `FH6_Database.sqlite` (13 MB, 205 tables) = the game's gameplay DB in the clear (the encrypted gamedbRC.slt). `full forza DB - Copy.db` is content-identical. Open read-only (`file:...?mode=ro`).
- Tune-container part ids ARE the DB primary keys: car-keyed slots by Ordinal (412003), engine slots by EngineID, drivetrain slots by DrivetrainID (2102004), body slots by CarBodyID, rims = `List_Wheels.ID` (701 = TSW Hockenheim R, 638 = Asanti AF 134, 13675 = American Racing VF309). The DB `Level` column, not the id's low digits, picks the name via `Upgrades(TypeId, Level)`; `UpgradeTypes.PartName` names the slot; `Data_UpgradePart` maps the 50 slots to tables.
- String refs look like `_&13152509727172136467`: low 32 bits = the CSV `HashId` of the key in that table's string CSV (Upgrades → Upgrades.csv); high 32 bits = per-table constant.
- The 66 `*.csv` were exported by Jett with ForzaTech Studio (D3FEKT/ForzaTechStudio, zip in the folder) from the binary `.str` tables; `raw string values/` holds all 288 `.str`.
- Slider ranges live in `List_SpringDamperPhysics`, `List_AntiSwayPhysics`, `List_AeroPhysics`, `List_UpgradeBrakes`, `List_UpgradeDrivetrainDifferential/Transmission`, `List_UpgradeTireCompound` (Def/Min/Max columns; container value ≈ (def−min)/(max−min), e.g. NSX-R Race front ARB 0.480). `Data_Car` has display PI + normalized PerformanceIndex; `CarClasses` the class anchors.
- Do NOT run the executables in the folder (LapSmith installer, "FH6 Helper" from unknowncheats, DB Browser msi). Also holds a VW Golf R asset dump and an ONYX car-id list.

Derived outputs and the atlas live in the worktree once built (see [[fh6-lab-runtime-layout]]); until then the scratchpad `gamedb/` folder of the 2026-09-02 session holds the reader JSONs.

2026-09-03: a full five-way data-source census (project stores, this raw corpus, the live game
install, save containers + live runtime, external sources) ran and produced
`docs/data-source-census-2026-09-03.md` — read that for the full picture, including the game
install's `physics/`/save-container encrypted files, the untapped livery zlib bypass, and the
16.5GB uncatalogued `captures/` archive. See also [[fh6-decrypt-landscape]].
