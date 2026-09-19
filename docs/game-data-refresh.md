# Game data refresh — every routine, why it exists, and how often it runs

The single reference for **how each game-derived data source reaches the lab**: where it lives in the install,
whether it is encrypted, the utility that refreshes it, what depends on it, and **when** it must be re-run.
Written after the **2026-09-07 FH6 title update** forced the first full refresh (decrypt the game DB, re-extract
the English strings) on 2026-09-13.

*Created 2026-09-13. Grounded in `scripts/db/rebuild.py` (`STAGES`, `DOWNSTREAM`), the importer/exporter
docstrings, and `docs/DATA-INVENTORY.md` §0 and §5.*

- **Sibling docs:** `docs/data-refresh-methods.md` covers the *lab-runtime* side (daemon, rebuild service,
  dashboard reload, code deploys). `docs/DATA-INVENTORY.md` indexes every store. `docs/data-availability.md`
  gives each source's provenance tag (official-feature / live-decode / decoded-once-committed / derived-ours).
- **Why this matters for future versions:** a new FH6 build, or a future game, changes *these* inputs. Knowing
  which are copies (they go stale), which are read live (they self-refresh), and which need decryption (an
  external tool) turns a version bump into a checklist instead of a rediscovery.

## 1. The three refresh classes

| Class | What it means | Frequency | Trigger |
|---|---|---|---|
| **A. Snapshots** | Extracted or decrypted out of the install into the raw folder, or generated into committed `data/` files. **Stale until re-run.** | **Every FH6 title update** (the install is re-written; last 2026-09-07 18:34) | Manual — §3 checklist |
| **B. Read live from the install** | The importer opens the install file directly on each run. | **Every `rebuild.py`** — self-refreshes after an update | Automatic on rebuild |
| **C. Player / session data** | Save containers and *Data Out* UDP telemetry. | **Every save / every driving session** | Automatic — daemon + rebuild service (`data-refresh-methods.md` §A) |

Encrypted files the lab does **not** import (`physics\PI.xml`, `PhysicsSettings.ini`, `surfaceTypes.xml`, the
suspension XMLs, `sfsdata`) owe no refresh — see `docs/fh6-encryption-methods-survey-2026-09-05.md`.

## 2. Source registry

- **Install** = `C:\XboxGames\Forza Horizon 6\Content\media` — READ-ONLY, never write under it.
- **Raw folder** = `C:\Users\mondr\Downloads\forza raw data files` — never run the `.exe`/`.msi` files in it.

### A. Snapshots — refresh on every title update

| # | Lab input | Install source | Encrypted? | Refresh utility | Consumed by → feeds | Why it matters |
|---|---|---|---|---|---|---|
| A1 | `<raw>\FH6_Database.sqlite` (`import_gamedb.py` `DEFAULT_GAMEDB`) | `stripped\gamedbRC.slt` | **Yes** — TransformIT white-box AES + CRC32 keystream | **`C:\Users\mondr\Downloads\ForzaCryptoTool.exe decrypt <slt> -o db.sqlite`** — DVS-code Forza Crypto Tool 3.1.0. Decryption is **server-side** (the file is uploaded; exit code 4 = backend offline) | stage `gamedb` → the whole `ref_` layer (cars, class, PI, engines, parts, physics); stages `curves` and `parts_extra` read the same file | New cars are **absent** without it → stub `ref_car` rows ("ordinal N") with no engine → build identity fails |
| A2 | `<raw>\raw string values\*.str` (`import_gamedb.py` `DEFAULT_STRDIR`) | `stripped\stringtables\EN.zip` | **No** — plain Deflate zip | Unzip into the folder (`Expand-Archive … -Force`); parsed by `scripts/db/strparse.py`. The importer reads the **folder**, not the zip | stage `gamedb` → `ref_string_table`, `ref_string`; every `_&<u64>` name ref resolves through it | Car **model** names, makes, part manufacturers, Rivals/career names. Stale strings give "1990 Jaguar" instead of "Jaguar XJ-S Forza Edition" |
| A3 | `data/game-strings/*.json` (committed, 23 tables) | `stripped\stringtables\EN.zip` (read directly) | No | `python scripts/telemetry/fh6_strings.py` | `clone_parts.py` (Upgrades catalogue); Rivals name guids | Part-name cloning and Rivals naming outside the DB |
| A4 | `data/car-ordinals.json` (committed) | derived from `ref_car` (needs A1 + A2) | n/a | **`python scripts/db/sync_car_names.py`** — after rebuild. `fetch_car_ordinals.py` (community gist) is a fallback for non-`Data_Car` ordinals only | daemon `names_load` (re-read per request, no restart); `build_engine_catalog`, `clone_coverage`, `fh6_manifest`, `analyze_session` | The live identification name map. 2026-09-13: +11 cars, 364 community names corrected |
| A5 | `data/engine-swaps.json` (committed) | derived (save containers + `car-ordinals.json`) | n/a | `python scripts/telemetry/build_engine_catalog.py` — after A4 | the tune decode names an engine swap | New cars' engine families |
| A6 | `data/car-option-lists.json` (committed) | `cars\<CAR>.zip` → `Manifest.xml` (plain Deflate) | No | `python scripts/telemetry/fh6_manifest.py` — after A4 (it reads `car-ordinals.json`) | per-car upgrade option lists with ranks | **Still stale as of 2026-09-13:** 558 cars, lacks 3429 and 4354; the install has 671 car archives |
| A7 | `<raw>\swatchbin\` (`import_gamedb.py` `DEFAULT_SWATCH`) | `**\*.swatchbin` | No | copy from the install | stage `gamedb` — only a wheel-has-swatch count | Minor: 902 files vs 962 in the install |
| A8 | `<raw>\*.csv` (ForzaTech Studio exports, 2026-09-02) | the `.str` tables | No | ForzaTech Studio | stage `gamedb` uses only the CSV **file names** (`ref_string_table.has_csv`) | Harmless if stale; cross-checks only |

### B. Read live — self-refresh on every rebuild

| Reader (stage) | Install source | Encrypted? | Notes |
|---|---|---|---|
| `import_objectmodel.py` (`objectmodel`) | `ObjectModelGame.zip` | No (plain Deflate BXML) | The event catalogue: route id ↔ name. Re-written 2026-09-07 |
| `import_routes.py` (`routes`) via `fh6_owt.py` | `openworld\brio\aitracks\Route*.owt/.nav` | No | 169 route centre-lines. Re-written 2026-09-07 |
| `import_surface.py` (`surface`) via `fh6_nav.py` | `…\brio\freeroam\Brio_00.nav` + aitracks | No | Road class / surface at each turn |
| `import_anchors.py` (`anchors`) via `fh6_anchors.py` | `tracks\brio\triggerzones\…\race_triggers.tz` | No | 36 race-start spheres; also re-parsed live by `analyze_session` |
| `export_icons.py` — **not a stage, run by hand** | `ui\textures\data_bound\Upgrade_Parts.zip` | No (BC7 textures) | Upgrade tile art → `dashboard/v2/assets/upgrade/`. Re-run only if the zip changed (unchanged since 2026-06-07) |

### C. Player / session data — automatic

| Source | Reader | Trigger |
|---|---|---|
| `C:\XboxGames\GameSave\pgs\…\ContainersRoot\Tuning_*\` | daemon disk watcher + stage `containers` | every in-game save (rebuild service `scope=containers`) |
| *Data Out* UDP telemetry (port 9876) | `fh6_live_daemon.py` → `data/sessions`, `data/courses`, stage `telemetry` | every driving-session close (`scope=telemetry`, cascades) |

### Non-game inputs with their own cadence

| Input | Utility | Frequency |
|---|---|---|
| `data/rivals-routes-*.json` (the Rivals > Routes screen, transcribed) | human transcription → stage `events`, which re-proves every guid against `ref_string` | when a new discipline's screen is captured; re-check after a string refresh |
| `data/field-catalog.json` | `scripts/_parse_field_catalog.py` from `docs/data-field-catalog-2026-09-03.md` → stage `field_catalog` | when the field-catalogue doc changes |

## 3. The title-update checklist (in this order)

**Detect.** An update re-writes the install. Compare install sizes and dates with the baseline below:

```powershell
$m="C:\XboxGames\Forza Horizon 6\Content\media"; "stripped\gamedbRC.slt","stripped\stringtables\EN.zip","ObjectModelGame.zip","ui\textures\data_bound\Upgrade_Parts.zip" | % { $i=Get-Item (Join-Path $m $_); "{0,-45} {1,12} {2}" -f $_,$i.Length,$i.LastWriteTime }; (Get-ChildItem "$m\cars\*.zip").Count
```

Baseline at the last refresh (2026-09-13): `gamedbRC.slt` 15,861,684 B · `EN.zip` 2,931,509 B · both dated
2026-09-07 · 671 car archives.

**Refresh.** Run from your lab-branch checkout.

1. **Decrypt the game DB (A1).** Jett runs it; the tool uploads the file:
   `ForzaCryptoTool.exe decrypt "C:\XboxGames\Forza Horizon 6\Content\media\stripped\gamedbRC.slt" -o db.sqlite`.
   Check it read-only: the `Data_Car` row count and max `Id` grew, and `PRAGMA integrity_check` = ok. Rename the
   old `FH6_Database.sqlite` to `FH6_Database.sqlite.bak-<date>`, then put `db.sqlite` in its place.
2. **Extract the strings (A2).** Copy `raw string values` to `raw string values.bak-<date>`, then
   `Expand-Archive "…\stripped\stringtables\EN.zip" "<raw>\raw string values" -Force`.
3. *(If changed)* copy `*.swatchbin` into `<raw>\swatchbin` (A7).
4. `python scripts/db/rebuild.py` — the **full cascade**, never a standalone import stage (standalone skips
   `course_match`/`route_names`, and courses lose their names). Class-B sources refresh here automatically.
5. `python scripts/db/build_web.py` — **not a rebuild stage**; without it `dashboard/v2/api/` stays stale.
6. `python scripts/db/sync_car_names.py` (A4).
7. `python scripts/telemetry/fh6_strings.py` (A3), then `python scripts/telemetry/build_engine_catalog.py` (A5)
   and `python scripts/telemetry/fh6_manifest.py` (A6).
8. `python scripts/db/export_icons.py` only if `Upgrade_Parts.zip` changed.
9. Commit the regenerated committed files (`data/game-strings/`, `data/car-ordinals.json`,
   `data/engine-swaps.json`, `data/car-option-lists.json`) with **explicit pathspecs**. Restart the daemon only
   with Jett's OK.

**Verify.**

- `python scripts/db/rebuild.py --check` passes.
- `SELECT COUNT(*) FROM ref_car WHERE display_name LIKE 'ordinal %'` → **0**.
- `SELECT COUNT(*) FROM ref_string_table` equals the number of `.str` entries in EN.zip (2026-09-13: 290 — the
  zip's 291st entry is `_list.txt`).
- A newly added car resolves with make, model, class and PI (2026-09-13: 4354 = Jaguar XJ-S Forza Edition,
  S1 750; 3429 = Ginetta G40 Junior, B 560).
- The car count in `dashboard/v2/api/cars.json` matches `ref_car`.

## 4. Refresh log

| Date | Trigger | Done | Result |
|---|---|---|---|
| 2026-09-02 | initial decode | A1 (third-party decrypt), A2, A8 | 660 cars, 288 string tables |
| 2026-09-05 | in-house re-decrypt (DVS-code) | A1 | content-identical to 09-02; proved `FH6_Database.sqlite` = decrypted `gamedbRC.slt` |
| 2026-09-13 | FH6 update of 2026-09-07 | A1, A2, A3, A4, A5, rebuild + build_web | 671 cars, 290 string tables, 0 stubs, 364 names corrected (`346b6e6`, `9cd8d99`) |
| — | still owed from the 09-07 update | **A6** (car-option-lists), A7 (swatchbin) | — |

Add a row every time the checklist runs.
