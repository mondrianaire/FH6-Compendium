---
name: fh6-game-file-refresh-registry
description: "TRACKER: every game-derived input the lab imports, where it comes from in the install, whether a game update makes it stale, the utility that refreshes it, and its current status. Check it after every FH6 update (install files re-written 2026-09-07 18:34)."
metadata: 
  node_type: memory
  type: project
  originSessionId: bdda2253-bc68-473d-a438-6a7e522e56ca
  modified: 2026-09-13T12:42:23.345Z
---

Started 2026-09-13. A game update re-writes files under `C:\XboxGames\Forza Horizon 6\Content\media`
(last: **2026-09-07 18:34**). Inputs read **straight from the install** refresh themselves on the next
`scripts/db/rebuild.py`; inputs **copied into `Downloads\forza raw data files`** go stale until someone
re-extracts them. After any refresh: `rebuild.py` (full cascade, [[fh6-rebuild-cascade]]) **then**
`build_web.py` (it is NOT a rebuild stage) **then** `sync_car_names.py` (projects ref_car names into
`data/car-ordinals.json` — the daemon reads that per request, so no restart needed).

## Copies that go stale (need a manual refresh)
| Input (lab path) | Install source | Encrypted? | Utility | Status 2026-09-13 |
|---|---|---|---|---|
| `forza raw data files\FH6_Database.sqlite` (`import_gamedb.py` DEFAULT_GAMEDB) | `media\stripped\gamedbRC.slt` | YES (TFIT + CRC) | `Downloads\ForzaCryptoTool.exe decrypt …gamedbRC.slt -o db.sqlite` (server-side) — [[fh6-decrypt-landscape]] | **DONE** 09-13: 671 cars, rebuilt + build_web |
| `forza raw data files\raw string values\*.str` (`import_gamedb.py` DEFAULT_STRDIR → ref_string_table/ref_string) | `media\stripped\stringtables\EN.zip` | **NO** — plain Deflate zip, 291/291 entries read clean | any unzip (Python `zipfile`, `Expand-Archive`); `scripts/db/strparse.py` parses | **DONE 09-13** — extracted current EN.zip .str over the folder (backup `.bak-2026-09-05`) → rebuild.py + build_web.py; ref_string_table 290; **4354="Jaguar XJ-S Forza Edition", 3429="Ginetta G40 Junior"**, stubs 0. The 09-07 delta applied: 3 new tables + 38 changed (Data_Car.str 67,418→68,536 = MODEL names, List_CarMake, List_PartManufacturer, Rivals, CareerRace*). Stray GameTunableSettings.zip ignored (only .str read) |
| `data/game-strings/*.json` (23 tables, committed; used by clone_parts/Rivals names) | same EN.zip | NO | `python scripts/telemetry/fh6_strings.py` (reads the install zip directly) | **DONE 09-13** — re-ran; committed `346b6e6` |
| `data/car-option-lists.json` (per-car upgrade option lists) | `media\cars\<CAR>.zip` Manifest.xml | no | `python scripts/telemetry/fh6_manifest.py` (after sync_car_names) | **STALE** (found 09-13): 558 cars, lacks 3429/4354; install has 671 car zips |
| `forza raw data files\swatchbin\` (`import_gamedb.py` DEFAULT_SWATCH; only sets a wheel-has-swatch count) | `media\**\*.swatchbin` | no | copy from install | minor-stale: 902 files vs 962 in install |
| `forza raw data files\*.csv` (ForzaTech Studio exports, 09-02) | .str tables | no | ForzaTech Studio | harmless: import only uses the CSV *names* to set `ref_string_table.has_csv` |
| `data/car-ordinals.json` (ordinal→name map; daemon `names_load` + build_engine_catalog/clone_coverage/fh6_manifest/analyze_session) | now **`ref_car`** (was HDR community gist, the pre-decrypt bootstrap 08-21) | n/a | **`scripts/db/sync_car_names.py`** (projects ref_car; run after build_web). `fetch_car_ordinals.py` = fallback for non-Data_Car ordinals only | **DONE 09-13** (`9cd8d99`): 671 cars, 11 added, 364 community names corrected to the game's own; daemon serves real names, no restart |

## Read live from the install (auto-fresh on rebuild — nothing to do)
`media\ObjectModelGame.zip` (`import_objectmodel.py`, updated 09-07), `openworld\brio\aitracks` .owt/.nav
(`fh6_owt.py`, 09-07), `tracks\brio\triggerzones` race_triggers.tz (`fh6_anchors.py`), `media\cars`
(`fh6_manifest.py`), `ui\textures` (`export_icons.py`, must be re-run by hand), save containers under
`XboxGames\GameSave` (daemon/`import_containers.py`).

## Still encrypted, not imported (no refresh owed)
`physics\PI.xml`, `sfsdata`, suspension XMLs — [[fh6-decrypt-landscape]].

**Repo doc:** `docs/game-data-refresh.md` (2026-09-13, branch `claude/game-data-refresh-doc`) is the full
checklist + refresh log for the team; keep this memory and that doc in agreement.

**How to apply:** after an FH6 update, compare install mtimes to this table, refresh every STALE row, then
rebuild + build_web, then update the Status column. Related: [[fh6-import-gated-backlog]] (Batch 1b = the
string refresh), [[fh6-raw-data-folder]], [[fh6-never-forget-a-store]].
