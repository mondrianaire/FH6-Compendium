# Source inventory & audit verification — `Downloads\forza raw data files`, 2026-09-05

The four 09-03 audit documents re-checked against the stores they describe, reorganised around one
question: **what data sources exist in the supplied folder, and what is each still worth to the
program?**

Telos used for every usefulness call: *store, use and analyze car upgrade and tuning data; give
data-backed recommendations with an A/B testing architecture; learn how upgrades and tuning values
affect driving.*

Everything re-derived from the folder itself, `data/fh6.db`, `FH6_Database.sqlite`, the game install
at `Content\media`, and the save containers. Nothing taken from the documents' own claims.

---

## Bottom line

The folder is **3,483 files / 357 MiB**, matching the audit's count exactly. But as a *data source*
it is nearly spent:

- **88% of it is not data at all** — 49.6% is one car's art export, 38.5% is unrun tools and installers.
- **The entire string layer is 100% redundant.** All 17,959 rows across the 69 CSVs are byte-identical
  to rows already in `ref_string`, and all 287 `.str` tables match `ref_string_table` one-for-one.
- **The game DB is stored twice** (25.4 MiB), content-identical across all 205 tables.
- **`trackroutes/` is a copy of the live install's own folder** — same 37 files, same route ids, same
  373 locators.

What remains genuinely unexploited is small, and none of it is in this folder: it is the **twelve
enum tables in `FH6_Database.sqlite`**, the **livery `zlib` payloads in the save containers**, and a
**plaintext suspension index in the game install** that no document mentions.

| cluster | files | size | verdict |
|---|---:|---:|---|
| Art assets — Golf R scene dump + shared libraries | 3,027 | 177.2 MiB | **no value** to the telos; art/paint/geometry |
| Tools & installers (unrun) | 4 | 137.6 MiB | ForzaTech Studio is the decoder of record; the rest is chaff |
| Game DB — two copies | 2 | 25.4 MiB | **highest-value source in the folder**; one copy is pure duplication |
| String tables `.str` | 288 | 5.6 MiB | **fully redundant** with `ref_string` |
| `trackroutes/*.nt` | 37 | 3.6 MiB | **redundant** with the live install; ids don't join `ref_route` |
| Non-Forza strays | 3 | 2.7 MiB | delete |
| `importer/` community decoders | 39 | 2.4 MiB | reference only; format already re-documented in-house |
| String tables `.csv` | 69 | 1.6 MiB | **fully redundant** — proven at 100% |
| ONYX vehicle database | 4 | 0.8 MiB | superseded by `ref_car` (660 > 638) |
| Misc root binaries + leftovers | 10 | 0.1 MiB | small, readable, low value |

---

## 1. The string layer is finished — proven, not assumed

The audit called the CSVs "the ID→name layer in text form, not new data." That is now measured rather
than inferred:

- **69 CSVs, 17,959 rows, 17,959 exactly present in `ref_string`** (same `table_name` + `key_name` +
  `content`). Zero mismatches, zero absent.
- **287 `.str` files ↔ 287 rows in `ref_string_table`.** Set difference empty in both directions.

There is no extraction left to do here. The 5.6 MiB `raw string values` folder and the 69 root CSVs
can be retired without losing a byte the database doesn't hold.

**One correction.** The audit's F8 says the 69 CSVs "split 25 that mirror game tables and 44 that are
string-table exports." They don't split — **all 69 carry the identical header
`HashId,HashIdHex,KeyName,Content`** and are string exports. Nothing in them mirrors a game table.

This matters because it changes what two files were hoped to be:

- **`EventBlueprint.csv`** (625 rows) reads like the event definitions F4 is missing. It isn't — it is
  UI labels for the blueprint editor (`IDS_AICountLabel` → "Max Number Of Drivatars").
- **`CareerTrackInfo.csv`** (448) and **`RivalsEventData.json`**, which the census names as "plausible
  leads for finding 4's empty `ref_event`", are the same shape.

So **F4's core conclusion survives and hardens**: the event *definition* (route, class limit, PI limit)
is genuinely not in this folder, nor in the 205-table game DB. Only the event *names* are here, and
those already sit in `ref_string`.

## 2. `trackroutes/` — redundant, and the join the audit hoped for doesn't exist

The audit lists the 37 `.nt` files as "XML locator lists (name, GUID, world transform) for event start
and end points — a camp-B lead that pairs with finding 4." Three corrections:

1. **The GUIDs are all zero.** Every one of the **8,117 locators** across all 37 files carries
   `GUID value="0"`. There is no GUID to join on, so the `.nt` → `CareerRace.csv` name linkage is not
   available.
2. **The folder duplicates the live install.** `Content\media\tracks\brio\trackroutes` holds the same
   37 files, the same 22 `route<id>.nt` ids, and the same locator counts.
3. **The route-id namespace is disjoint from ours.** The filenames do carry route ids — 0, 3001–3023,
   8100–8105, 40001–40044, 40900 — but **0 of 22 appear in `ref_route`** (169 ids spanning 41–30106).
   These are blueprint/event route ids, not the nav-mesh `Route*.owt` ids the lab imported. This
   generalises the census's narrower observation about `tz_races` ids 3333–3336 / 8001–8005.

What *is* usable: the world transforms share the lab's coordinate space (locators x −8790..7583,
z −9949..18426; `ref_route_point` x −8053..11023, z −9492..20163). So a **spatial** join is possible
where an id join is not — that is the only viable path from locators to routes, and it is not what
either document proposes.

*Census correction:* `eliminator_locators.nt` holds **373** drop points, not 100. Noted for
completeness only — Eliminator is out of scope for this program's telos.

## 3. The Golf R dump is half the folder and none of the value

Roughly 177 MiB across 3,027 files is a single car's art export: `swatchbin/` (97.7 MiB), `Textures/`
(33.8), `Scene/` (31.6), `LiveryMasks/` (10.0), `_fmnext/` (1,658 material bins), plus
`VW_GolfR_19.carbin`, its debug sibling, the build-report HTML, `.avpins`, and **`Manifest.xml`**.

`Manifest.xml` (180 KB) is worth naming because it is plaintext and appears in none of the four
documents — but it is an *asset* manifest, listing model/swatch/material paths per part for that one
car. Its only data-shaped content is the `PartEnum` set (`CarBody`, `Brakes`, `ChassisStiffness`,
`FrontBumper`, `RearBumper`, `RearWing`, `Hood`, `SideSkirts`, `WheelStyle`) — nine visually-modelled
slots, which `ref_slot.is_visual` already covers. `Locators.xml` (32 KB, `<CarLocators>`) is the same
story in car space.

The audit's characterisation was right; it just never named these files. **No action beyond a
retention decision.**

## 4. What in the folder is still the primary source

**`FH6_Database.sqlite` — 205 tables, 189 non-empty.** This is the one irreplaceable artifact here,
and the audit's read of it is exact. Every row count in F5 and F6 reproduces: `UpgradeWizardParts` 87,
`…PartsRemoval` 30, `…PowerRemoval` 17, `List_BrakeProfile` 35, `List_TractionControl` 10,
`List_TireAffectCurve` 33, `Combo_TireBrandCompound` 30, `Data_Car_Buckets` 644, `CarBuckets` 49,
`List_CarMake` 90, `List_Country` 30, `List_Cylinders` 14, `List_EngineConfig` 9, `List_Aspiration` 8,
`List_FamilyModel` 36, `List_FamilyBody` 46, `List_ShiftSystem` 7, `List_BrakeType` 5, `Environments`
91, `List_PreloadAndDroopDamper` 9, `List_ThirdSpringElement` 9, `List_RearSteeringSettings` 9,
`List_SteeringSettings` 7, `List_VariableTiming` 3, `List_AeroStaticSystem` 2, `CarUpgradeExceptions`
6, `CarInvalidDefaultParts` 2, `CarTrackOffsets` 77, `WheelNormOffsets` 111, `Powertrains` 8. **30 of
30.**

None of these are imported. The highest-leverage ones against the telos, unchanged from F6:

- **`UpgradeWizardParts` / `…PartsRemoval` / `…PowerRemoval`** — the game's own upgrade recommender,
  part-by-level order for a balanced build and the removal order when over PI. An authored baseline to
  test the lab's recommendations against.
- **`List_BrakeProfile`, `List_TractionControl`, `List_TireAffectCurve`, `Combo_TireBrandCompound`** —
  the physics behind brake bias, TC slip bands, temperature/camber→friction curves, and per-brand
  tyre scaling. These are what turn a slider position into a predicted effect.

**`full forza DB - Copy.db` is pure duplication** — 205/205 tables identical in row count and content
hash, only the page layout differs. 12.7 MiB recoverable.

**`ONYX FH6 Vehicle Database`** — 638 car ids; `ref_car` holds 660 from the game DB. Superseded.

**`importer/`** (39 files, 010-Editor `.bt` templates + Python parsers) documents the `burG`/Grub
bundle header. The project's own `fh6_swatchbin.py` re-documents the same format. Reference only.

## 5. The census's lock taxonomy is wrong, and it misdirects source work

This is the one finding that changes what to *do*, so it belongs in a source inventory.

The census splits "locked" into three mechanisms and ranks a `Rules.zip` crack attempt first, on the
theory that method-22 zip entries are **non-standard compression**, "structurally different from true
ciphertext." They are not. Method-22 entries carry the same cipher wrapper as the loose ciphertext
files:

| test | loose ciphertext files | method-22 zip entries |
|---|---|---|
| `(size − 20) % 16 == 0` | **164 / 164** | **936 / 936** |
| leading 16 bytes | high-entropy, no magic | high-entropy, no magic |
| bytes 16–19 | little-endian u32 | little-endian u32 |
| payload entropy | 7.92 – 8.00 | 7.68 – 7.98 |

A 16-byte IV, a 4-byte field, and ciphertext always an exact multiple of the AES block size, across
1,100 independent files. The stored sizes settle it: all 936 entries take only **46 distinct sizes**,
every one of the form **`36 + 528·k`** — a 512-byte plaintext chunk plus 16 bytes of per-chunk
overhead. Compression yields continuous sizes; this pads to buckets. Small entries *expand*
(`Eliminator.rulebot.bin`: 384 B stored in 564).

**Consequence:** `Rules.zip` and `GameTunableSettings.zip` are not one decompressor away — they sit
behind the same unbroken cipher as `PI.xml`. The honest taxonomy is **two** mechanisms: encrypted
(loose or zip-wrapped) and proprietary-but-decoded.

The census's *predictor* survives intact and is useful: gameplay-config zips are method 22
(`Rules` 441 entries, `GameTunableSettings` 122, `stateflow` 128, `Camera` 244, `ProfileSchema` 1),
asset zips are ordinary Deflate (`Cinematics` 2,483, `Particles` 767, `Sky`). It just predicts which
files are *encrypted*, not which are compressed.

**Two more source-sizing errors** that inflate locked targets:

- **The suspension lock is 0.99 MiB, not 76 MiB.** The 159 encrypted XMLs (128 top-level + 31 `t10`)
  total 0.99 MiB. The 76 MiB is the whole folder, 98% of it the **88 legacy JPG diagrams the census
  elsewhere correctly calls fully readable** — the same bytes counted once as an unbroken lock and
  once as an open resource.
- `Rules.zip` is **0.60 MiB**, not 5.3 MiB; `ProfileSchema.zip` is 0.01 MiB, not "0.5–0.6".

**Undocumented and open:** `physics/suspension/t10/List_SuspensionPhysicsType.sql` — 4.7 KB of
**plaintext** DDL + INSERTs mapping `SuspensionPhysicsTypeID` → `Name`
(`INDEPENDANT`/`SOLID`/`ARTICULATED`) → `Path` (`F_Strut.xml`, `F_ModernWishbone.xml`,
`F_PanhardRodDependent.xml` …). It is the index to the encrypted geometry set, sitting unencrypted
beside it, and appears in none of the four documents.

Encryption calls themselves all verify by entropy and to the byte: `PI.xml` 2,148 B, `PhysicsSettings.ini`
68,676 B, `surfaceTypes.xml` 4,003,860 B, `NerdData.json` 564 B, `gamedbRC.slt` 15,599,508 B —
entropy 7.61–8.00; readable cousins plaintext (`NatalSurfaceTypes.xml` 5.07, `BreakEffects.xml` 4.91).
*Path note:* the census writes these as `Content\physics\...`; they are under `Content\media\physics\...`.

## 6. Sources outside the folder that are still worth taking

**Save containers — the livery `zlib` bypass is real.** All **468 / 468** `C_livery` payloads
decompress with stdlib `zlib` today, yielding the described chunk stream (`vlrc` / `yrvl` / `gyvl`).
The header is 2×u32, the second of which is the inflated length. This is unclaimed capability, though
paint data is peripheral to the telos.

Save-container encryption calls verify: GarageLayout (8), Estate (2), PropPrefab (1), CustomRoute (1),
`User_` bucket (502 files), and the `CampaignThumb_*` files are indeed **not images**. *Correction:*
PropPrefab's `thumb.png` is also encrypted (entropy 7.997, no PNG magic), not "a normal viewable
image". Container counts: 468 livery (376 + 59 + 33), not 465.

**`data/game-strings/*.json` closes the enum gap.** 23 files / 487 KB, with `List_CarMake.json`,
`List_Aspiration.json`, `List_Cylinders.json`, `List_EngineConfig.json` all present as
`IDS_DisplayName_<id>` → name. Directly importable; **0 of 12 enum tables imported so far**. The
census is right that the remaining gap is JSON→SQL, not source access.

**`captures/` is the deepest telemetry source, and its alarm is false.** The census warns recording
may have "silently stopped or been pruned" after 08-29. It didn't — the store is **195 files /
22.2 GB**, with files dated through today:

```
.csv.gz   98 files   4.7 GB   08-23 → 09-02
.csv      96 files  17.5 GB   08-28 → 09-05
```

The daemon's `_compress_old_captures()` (`fh6_live_daemon.py:2318`) gzips captures **older than 3
days**. The census globbed `*.csv.gz` only, saw the compressed backlog, and mistook a retention policy
for data loss; its 16.5 GB undercounts by ~6 GB for the same reason. `CAPTURE_ROLL_MB = 192` and the
**99-column** schema both verify, identical in a `.gz` and a plain `.csv`. `backfill_laps.py` globs
both extensions, so nothing downstream is blind to the uncompressed half.

---

## 7. Audit findings — status

| finding | status |
|---|---|
| **F1** component ids = ordinal | **fixed & verified** — 0 of 594/607/607 and 516/529/529 now equal the ordinal |
| **F2** surface layer empty | **fixed & verified** — 284,208 rows; turns 2,908 paved / 590 loose / 314 unknown; routes 111 / 39 / 3 — the remediation note's exact digits |
| **F3** `session_car.hw_hash` unbound | **fixed** — 114 of 634 bound (was 78 of 398; data grew) |
| **F4** events absent | **open in substance.** `ref_event` now has 23 rows, but Rivals-only from `rivals-routes-road.json`, not the game-DB decode. `ref_route.name` still empty on **163 of 169**; `course.event_id` resolves on **8 of 74** |
| **F5** blob joins / enums | **open.** Key counts 163 / 151 / 122 / 49 exact; joins 1,706/1,706, 39/39, 642/660/660 exact; `FrictionMultiCurve*ID` is 9 keys (base + `_Offroad` + `_Snow`) at 41/41. No key promoted to a column; **0 of 12 enum tables imported** |
| **F6** untouched game tables | **open.** 30 of 30 row counts exact |
| **F7** inventory drifts | **true, partly acted on, still true.** `DATA-INVENTORY.md` now flags the stale 221/107 figure and the road-class outage, but still reports `fh6.db` at 107 MB (**121 MB**), `session` at 107 (**227**) and 62 courses (**74**). Generating the coverage section from `import_run` is not done |
| **F8** corpus facts | **verified** — 205 tables, the two DBs content-identical (0 of 205 differ), ONYX superseded, ForzaTech Studio 29,319,712 B |

F2's causal story is corroborated in `import_run` **to the run id**: seven `surface` runs succeeded to
`2026-09-03T00:37Z` at 284,207 rows, then runs **55, 57, 67, 79** all `ok=0` with
`KeyError: 'road_class'`, and run 85 with `no such column: surface`. *Nit:* eight runs happened,
seven succeeded (run 31 died on a `%X` format error).

`ref_field` **now exists** (2,007 rows), so the audit's field-catalog proposal is built.

**The field catalog verifies to the row** on every spot-check — all 10 columns flagged DEAD are
0-non-null; `ref_part_attribute` fully orphaned (546 rows, `join_status='orphan'`, price {0: 342,
5000: 204}, `mass_is_engine` {0: 108, 1: 438}); `ref_part.is_stock` 57,481/30,174; `confidence`
80,181/7,466/8; `ref_wheel.mass_level` 153/226/311/401/157; `ref_preset.purchasable` 330/118;
`ref_car_body.variant` 660/115/2/2.

**Its one miss is worth knowing.** `ref_slider.band_source` — catalog `part(17)/fixed(11)/none(8)`,
live **`part(13)/fixed(15)/none(8)`**. Four sliders moved `part` → `fixed` since 09-03 (the
differential group and the two tyre pressures now read `fixed` while keeping their `source_slot`).
This is drift, not an error — but `band_source` decides whether a slider's range comes from the fitted
part or a hard-coded band, which is exactly the reliability hierarchy the tuning rules depend on, so
it is the number to re-derive rather than trust.

*Table-count drift:* the audit says 53 tables, the field catalog says 77 in one header and 58 in
another. Live is **58**.

---

## 8. Recommended order of work

1. **Import the twelve enum tables** from `data/game-strings/` — cheapest unclaimed win, no new source
   access needed, closes half of F5.
2. **Import the upgrade-wizard and physics-profile tables** (`UpgradeWizardParts` + removals,
   `List_BrakeProfile`, `List_TractionControl`, `List_TireAffectCurve`, `Combo_TireBrandCompound`).
   This is the only material left in the folder that advances the telos, and the wizard tables give an
   authored baseline to test recommendations against.
3. **Rewrite the census's mechanism table to two locks** and strike the `Rules.zip` /
   `GameTunableSettings.zip` crack recommendations, before someone spends a session hunting a
   compression algorithm that doesn't exist.
4. **Take `List_SuspensionPhysicsType.sql`** — the plaintext index to the encrypted suspension set.
5. **Correct the `captures/` entry** to 195 files / 22.2 GB and record the 3-day gzip retention policy,
   so the next sweep doesn't re-raise the false alarm.
6. **Generate `DATA-INVENTORY.md`'s coverage section from `import_run`** (F7) — it drifted again on
   three numbers in two days, which is the finding proving itself.
7. **Retire the redundant corpus**: `full forza DB - Copy.db` (12.7 MiB), the 69 CSVs + 288 `.str`
   files (7.2 MiB, proven 100% redundant), `trackroutes/` (3.6 MiB, a copy of the install), ONYX, and
   the three non-Forza strays. Keep `FH6_Database.sqlite`, `ForzaTech.Studio.zip` and `importer/`.
   The Golf R art dump (177 MiB) is a separate retention call — it has no telos value but is also the
   only local sample of that export format.

---

## 9. The 53→12 restructuring risk map — verified, and it inverts the risk

A separate utility produced a consolidation proposal ("FH6 Lab DB — Restructuring Risk Map, 53 tables
consolidated"): twelve merged entities, eight edges marked as enforced FKs, six marked
"at-risk: string-matched, no FK enforced", and three tables flagged as performance hotspots.

Measured against the live database, **the risk labels are backwards.**

### 9.1 All six "at-risk" links are clean

| link as drawn | measured |
|---|---|
| `hw_package <> lap.hw_hash` | 397 non-null, **0 orphans** |
| `tune_container <> lap.container` | 397 non-null, **0 orphans** |
| `ref_route <> diagnosis.route_key` | 4,221 non-null → `course`, **0 orphans** |
| `tune_container <> evidence.container` | `obs_pi.container` is **0 non-null** — the link carries no data |
| `ref_parts_catalog <> ref_curves.part_id` | 1,706 non-null, **0 orphans** |
| `ref_car.stock_engine_id <> ref_curves.engine_id` | 1,706 non-null, **0 orphans** |

Every flagged link resolves completely. The risk is theoretical.

### 9.2 The one edge drawn as an enforced FK is the one that is actually broken

The map draws `ref_route.id_route < lap.route_key` as a solid, enforced relationship. It is
**532 of 532 orphans** — a total non-join:

```
ref_route.route_id   '101', '102', '1021', '1022', '1023'      ← game nav-mesh ids
lap.route_key        '-100_-6050', '-1050_400', '-1150_-5100'  ← coordinate-derived course keys
```

Two different namespaces. `lap.route_key` resolves to **`course.route_key`** (532/532, 0 orphans),
and only reaches `ref_route` through `course_route` — which is the project's hardest and most
carefully-tracked matching problem, not an FK.

The map omits `course`, `course_route`, `course_turn` and `course_event` entirely, then draws the
join to the table it deleted. That is the whole error in one move.

### 9.3 The hotspot annotations are wrong

`lap_point` is annotated "⚠ HOT: largest table". It isn't:

| table | rows | in the map? |
|---|---:|---|
| `ref_route_point` | 284,208 | no |
| `ref_route_surface` | 284,208 | **no** |
| `lap_point` | 184,857 | yes, flagged largest |
| `ref_part` | 87,655 | merged away |
| `ref_part_slider` | 65,864 | **no** |
| `ref_string` | 58,722 | **no** |

The two tables larger than the flagged one are both absent, including `ref_route_surface` — the layer
finding 2 had just restored.

### 9.4 It accounts for 28 of 58 tables

The title says 53 (live is 58). It names 28. The 30 it omits include the structurally load-bearing:

`ref_route_surface` (284,208) · `ref_part_slider` (65,864) · `ref_string` (58,722) ·
`ref_preset_part` (17,617) + `ref_preset` (448) · `course_turn` (1,214) · `ref_car_body` (779) ·
`ref_engine` (670) · `ref_drivetrain` (662) · `session_car` (636) · `ref_car_exception` (511) ·
`import_run` (341) · `ref_field` (2,007) · `corner_obs` (4,772) · the whole `course*` family.

Three of those omissions are load-bearing for work just completed or just proposed:
`ref_part_slider` carries the per-part slider bands the reliability hierarchy depends on;
`import_run` is the provenance table F7 wants the inventory generated from; `ref_preset`/`ref_preset_part`
is the 448-build corpus the inventory calls the largest block of self-consistent part combinations.

### 9.5 The three merges collapse distinct grains

- **`ref_parts_catalog`** would fuse `ref_slot` (50, PK `slot_index`), `ref_part` (87,655, PK
  `slot,part_id`), `ref_slider` (36, PK `slider`), `ref_wheel` (1,248, PK `wheel_id`) and
  `ref_compound` (41, PK `compound_id`) — five different entities at five different grains under one
  synthetic `id_slot_part`. It also has to dissolve `ref_part_slider`, a genuine **M:N** with 65,864
  rows, which is where every part's contributed slider band lives.
- **`ref_curves`** would fuse `ref_torque_curve` (1,725, keyed by engine/part/level) with
  `ref_friction_curve` (738, whose identity is the composite
  `compound|multicurve|channel|surface|load_band` — 738 distinct over 738 rows). The proposed columns
  (`engine_id`, `part_id`, `peak_power_hp`) exist only on the torque side; friction curves would lose
  their identity entirely.
- **`evidence`** would fuse `obs_pi` (88: PI deltas per slot), `obs_menu` (92: tile positions) and
  `obs_evidence` (129: free-form `subject`/`claim`/`confidence`). Only `obs_pi` has
  `container`/`hw_hash` at all, and those are 0 non-null. Three different subjects, 309 rows total —
  no scale pressure to justify the loss.

### 9.6 The real risk it missed

`PRAGMA foreign_keys` is **0**. Thirty-seven of the 58 tables *do* declare `REFERENCES` — the map's
premise that these links are unenforced string matches is wrong about the schema — but SQLite does
not enforce them unless the pragma is set per connection. `PRAGMA foreign_key_check` currently returns
**0 violations**, so the data is clean today; nothing guarantees it stays clean.

That is the actionable finding, and it is one line per connection, not a restructuring.

### 9.7 Verdict

**Do not act on this proposal.** It would merge five reference entities of different grain, dissolve a
65,864-row M:N, drop the identity of the friction curves, delete the `course` layer that the telemetry
actually joins through, and omit the two largest tables in the database — in order to fix six links
that have zero orphans between them.

Worth keeping from it: the hotspot *question* is legitimate even though the answers are wrong, and
`lap_point`/`ref_route_point`/`ref_route_surface` are worth an index review. Everything else in the
map should be re-derived from `sqlite_master` and `ref_field` rather than from field-name similarity —
which is what produced the `route_key`/`route_id` collapse in the first place.

*Note:* the database moved during this verification (`ref_event` 23 → 88, `diag_event` 13,504 →
13,528), so any structural proposal should be re-measured at the moment it is acted on.

---

## 10. Course and route names — where they are, and what binds them

**Names are not scarce. Bindings are.** `ref_string` holds thousands of place, course and event
names; what does not exist anywhere in the data is a link from any of them to a route id.

### 10.1 The one table that matters: `RivalsEventData`

**88 distinct Rivals course names**, carried as 604 GUID-keyed rows — exactly **7 GUIDs per name**
for 86 of the 88 (one per difficulty/variant slot).

The project has mapped **23** of them, via `data/rivals-routes-road.json`, whose `ids_name_guids`
field holds 161 GUIDs — all 161 resolve into `RivalsEventData`, 7 per route. That file is the working
name bridge, and it covers the `road` discipline only.

**65 names are unmapped**, and they are precisely the disciplines the lab has no names for:

> Airfield Trail · Arashiyama Takao · Bamboo Forest Scramble · Bandai Azuma · Cedar Run ·
> Cherry Field Trail · Chiheisen Scramble · City Docks Cross Country Circuit · Daikoku Chase ·
> Edogawa Cross Country Circuit · Festival Chase · Flight Club · Hakone Nanamagari ·
> Hirosaki Scramble · Hokubu Ascent · Hokubu Trail · Horizon Festival Drag Strip ·
> Horizon Stadium Scramble · Ine Scramble · Irokawa Space Center Drag Strip · Ito Airfield Drag Strip ·
> Ito Trail · Izu Cross Country · Kawazu Nanadaru Scramble · Kinkaku-ji Trail · Kita Ine ·
> Legend Island Cross Country Circuit · Legend Island Trail · Matsumi Climb · Mech My Day ·
> Minami Chase · Mt. Haruna · Nachi Run · Nangan Cross Country Circuit · Naruo Cross Country Circuit ·
> Norikura Descent · Norikura Skyline · Nukabira Trail · Oka Cross Country Circuit ·
> Okishinaimura Run · … (65 total)

Note `Hakone Nanamagari` is already in `course` as a **declared** name read from the game — the string
table would have corroborated it independently.

### 10.2 The rest of the name inventory

| table | named entries | character |
|---|---:|---|
| `ChallengeData` | 3,180 | POIs, challenge and location names (`Tokyo City`, `Meiji Jingu Gaien Ginkgo Avenue`) |
| `RivalsEventData` | 604 → **88 distinct** | **the course-name source** |
| `CareerRace` | 252 | race names, GUID-keyed |
| `CareerTrackInfo` | 224 + 224 descriptions | course names **with prose descriptions** (`The Colossus`, `Horizon Invitational`) |
| `CareerRaceCollection` | 157 | series/collection names (`Nukabira Trail`, `Shikisai Sprint`) |
| `Landmarks` | 79 | real Japanese landmarks, numerically keyed |
| `MapRegion` | 20 | `Nangan Region`, `Hokubu Region`, `Legend Island` |
| `TimeAttack` | 6 | `Sekibe`/`Edamame`/`Hokubu Time Attack` |
| `DragEvent` | 3 | `Ito Half Mile`, `Festival Kilometer`, `Irokawa Quarter Mile` |
| `Profile` | 4 | `Ine Coast`, `West Tokyo City`, `East Tokyo City` |

**A trap worth naming:** `DriftZones` (31), `Trailblazers` (18) and `DangerSigns` (38) are
numerically keyed — tempting, because integer keys look linkable — but the names are Spanish
(`Otro Mundo`, `Barranco`, `Granjas`, `Tierras Verdes`, `Puerta Pétrea`). These are **FH5 Mexico
carryover**, not FH6 Japan content; `SplashChoice` still contains "Welcome to Mexico". Do not bind
them to FH6 routes. `LabyrinthRoutes` (12: `Ice Rink`, `Stunt Park`, `Winter Wonderland`) is likewise
event-arena carryover.

### 10.3 Every id field that should carry the binding is zeroed

This is why F4 stays open. Three independent link fields exist, and all three are null-valued:

| candidate binding | result |
|---|---|
| `Tracks.Route` (game DB, 58 rows) | **`0` on every row** |
| `.nt` locator `<GUID value="…"/>` (8,117 locators, 37 files) | **`"0"` on every locator** |
| `NewProfile_CareerRaces` (`TrackId`, `CustomRoute`, `RouteContainerName`) | **0 rows** |

And the names themselves are orphaned: I extracted the **700 distinct GUIDs** from `CareerTrackInfo` +
`CareerRace` and searched every text column of all 205 game-DB tables — **0 hits** — then scanned all
262 readable files under the install's `tracks/` tree — **0 hits**. The GUIDs appear only in the
string tables that define them.

`ref_track` is not a fallback: resolving all 58 `_&hash` DisplayNames through `ref_string` (58/58
resolve) yields Drivatar first names and test labels — `Grace`, `Haley`, `Natasha`, `TestPW01`,
`rendertest` — with 57 of 58 carrying the placeholder length 5954.0. The field catalog's
"dev/QA placeholder" call is confirmed by resolution, not just inspection.

### 10.4 What this means

The lab's existing approach is the correct one and should be extended, not replaced. Course names
today come from `course.name_source` values `derived:map`, `derived:length`, `derived:map+declared`
and `declared` — geometry and length matched against a transcribed name list. That is the only
mechanism available, because the game ships the names and the routes in separate id spaces with the
bridging columns zeroed out.

**The cheapest concrete win:** extend `rivals-routes-road.json`'s pattern to the other 65
`RivalsEventData` names. The names, their 7-GUID sets and their disciplines are already in `ref_string`;
what each entry needs is the length and map identity the existing 23 rows carry, which is the same
derivation `derived:map` already performs. That would take `ref_route.name` from 4 of 169 and
`course.name` from 8 of 74 toward full coverage without any new source access.

`CareerTrackInfo`'s 224 descriptions are a second, untouched layer — prose describing each course's
character ("a hill climb leads high up into the Sotoyama Region", "this drag strip runs alongside the
Irokawa Space Center") — directly useful for orienting a driver on an unfamiliar course, and currently
unused.
