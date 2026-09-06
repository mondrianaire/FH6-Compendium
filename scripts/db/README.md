# `scripts/db` — the central database pipeline

> "We absolutely should be creating our own database schema and re-entering everything into
> our OWN central database as much as possible instead of attempting to compute essential
> values in real time." — Jett

Everything here exists to fill **`data/fh6.db`** from `db/schema.sql` (40 tables, 4 views).
The schema's header states the rule this directory enforces:

**Every value a tool or the dashboard needs is a COLUMN, written once at ingest — not a
computation performed on every read.**

A part's display name, a slider's physical unit, a rim's weight class, a build's PI, a clone
route's tile numbers: all of them are resolved by an importer and stored. Consumers `SELECT`.
Before this, four copies of each resolver lived in `clone_parts.py`, `fh6_tune_decode.py`,
`app.js` and the daemon — and four copies of a rule is four places for it to be wrong.

---

## Layer model

Layers are named by table prefix. Each one has exactly one owner and a different rebuild policy.

| Prefix | Layer | Source of truth | Rebuild policy |
|---|---|---|---|
| `ref_` | **Reference** — game truth | `FH6_Database.sqlite` + the 287 `.str` string tables | Dropped and repopulated **wholesale**. Never hand-edited. |
| `tune_` | **Save-file truth** — one row per container / slot / slider / gear | `C:\XboxGames\...\Tuning_*\Data` (1,150 containers) | Rebuilt from the containers; names and physical slider values already resolved against `ref_` at import. |
| `hw_`, `setup` | **Hardware-package tier** — distinct part sets, independent of sliders | derived from `tune_container` | Recomputed from `tune_`. |
| `session_`, `course_`, `lap_`, `corner_obs` | **Telemetry** | `data/sessions/*.json`, `data/courses/*.json`, `data/laps.db` | Incremental; a session is imported once, keyed by `session_id`. |
| `obs_` | **Observation** — what a person saw | screenshots, menu reads, PI steps | The **only** layer a human writes. Every row carries its `source` and `confidence`. |
| `plan_` | **Materialized deliverables** — clone routes, readiness | computed from `ref_` + `tune_` | Recomputed on demand but **stored**, so the dashboard and the CLI read identical rows. |
| `v_` | **Views** the dashboard bundle is generated from | — | No consumer re-derives anything a view already spells out. |

`C:\XboxGames` is **read-only. Never write under it.**

---

## Rebuild order

The order is forced by foreign keys and by what each layer resolves *against*:

```
1. schema      fh6db.py --init                 40 tables, 4 views, schema_meta
2. strings     ref_string_table, ref_string    288 .str tables -> 58,722 entries
3. gamedb      ref_class, ref_car, ref_engine, ref_drivetrain, ref_car_body, ref_motor,
               ref_slot, ref_part, ref_part_slider, ref_slider, ref_wheel*, ref_compound,
               ref_track, ref_region
                 ^ needs (2): every name is a '_&<u64>' ref resolved through a string table
4. events      ref_event, ref_event_string
                 ^ needs (3) for ref_track/ref_region; (2) to check the IDS_Name/IDS_Description guids
5. containers  tune_container, tune_part, tune_slider, tune_gear, hw_package*, setup
                 ^ needs (3): part names come from ref_part, slider bands from ref_part_slider
6. telemetry   session*, course*, lap, lap_point, corner_obs
                 ^ needs (3) for ref_compound, (4) for ref_event, (5) to bind a lap to a container
7. derive      obs_*, plan_clone, plan_clone_step, plan_readiness
                 ^ needs everything above
```

`ref_event` is filled by stage `events` (`import_events.py`), never by `gamedb` — the Rivals
catalogue (route names, screen-read lengths, IDS_Name/IDS_Description guids) is not part of
the 205-table game DB at all; it comes from `data/rivals-routes-*.json`, a transcription of
the Rivals > Routes screen.

Steps 2–7 are the five sibling importer modules in this directory. Each is **idempotent and
re-runnable**: it wraps its work in a transaction, `DELETE`/`INSERT` or upserts *its own*
tables, and writes one `import_run` row. Running any of them twice must leave identical row
counts — `--selftest` proves this for the accessor and each importer proves it for itself.

This directory now holds more stages than the seven above (`routes`, `surface`, `course_match`,
`route_names`, `corners`, `observations`, `diagnosis`, `field_catalog` — see `rebuild.py`'s
`STAGES` for the authoritative, current order); the layer picture above is unchanged by them.

### Rebuild everything

```sh
cd "C:/Users/mondr/Documents/Claude/Projects/forza-horizon-6-tuning/.claude/worktrees/forza-eliminator-tips-db-c512c3" \
&& PYTHONIOENCODING=utf-8 python scripts/db/rebuild.py --all
```

`rebuild.py` runs every stage in order and stops at the first failure. To drive a single
layer, run the module directly (`python scripts/db/import_gamedb.py`), and afterwards:

```sh
PYTHONIOENCODING=utf-8 python scripts/db/fh6db.py --info --check
```

### Running one stage — `--only` and its cascade

`--only NAME` does not run just `NAME`: `rebuild.py` also reruns every stage its own
`DOWNSTREAM` map says depends on `NAME`'s tables, transitively, in `STAGES` order — printed
as `cascade: +stage1 +stage2 …` before anything runs. `--only events`, for instance, also
reruns `route_names`, because `route_names` joins on `ref_event`. This exists because a stage
that rewrites a table another stage joins on and is *not* followed by that stage leaves the
join dark — `course_route` sitting at 0 rows from 2026-09-03 to 2026-09-05 was exactly this,
and `--check` (I2-stale) now fails on it. Pass `--no-cascade` to run exactly the named
stage(s) with no dependents — only when you already know nothing downstream needs the rerun.

---

## `fh6db.py` — the accessor every other module imports

Written first and kept deliberately small: five modules depend on its stability. It holds the
rules the old scattered copies disagreed about, exactly once.

```python
import sys, os
sys.path.insert(0, os.path.join(REPO, "scripts", "db"))
import fh6db as db

cx  = db.connect()                 # $FH6_DB or <repo>/data/fh6.db; WAL, FK on, busy_timeout 10s, Row
db.ensure_schema(cx)               # runs db/schema.sql when schema_meta is absent

rid = db.run_begin(cx, "gamedb", GAMEDB_PATH)
n   = db.replace_all(cx, "ref_class", COLS, rows)   # the idempotency pattern: wipe, refill
cx.commit()
db.run_end(cx, rid, n_rows=n, ok=1, notes="660 cars")
```

| Function | What it is for |
|---|---|
| `connect(path=None, ro=False)` | The pragmas. `ro=True` for consumers that must not take a write lock. |
| `ensure_schema(cx)` / `schema_version(cx[, v])` / `meta_get` / `meta_set` | Schema and `schema_meta`. |
| `run_begin(cx, kind, source)` / `run_end(cx, run_id, n_rows, ok, notes)` | `import_run` bookkeeping. |
| `upsert_many(cx, table, cols, rows)` / `replace_all(...)` / `wipe(cx, *tables)` | Chunked bulk write. Rows may be tuples or dicts. Does **not** commit — the caller owns the transaction. |
| `strhash(s)` / `split_ref(u64)` / `make_ref(t,k)` / `parse_ref(cell)` | **Rule 1**, the string hash. |
| `display_pi(norm, classes)` / `class_of(...)` / `load_classes(cx)` / `build_class_anchors(rows)` | **Rule 4**, display PI. |
| `slider_value(norm, mn, mx)` / `install_norm(def, mn, mx)` / `is_locked(mn, mx)` | **Rule 5**, slider bands. |
| `table_counts(cx)`, `utcnow()`, `f32(x)`, `CONFIDENCE`, `EMPTY_PART` | Small shared constants. |

```sh
python scripts/db/fh6db.py --init      # create the database from db/schema.sql
python scripts/db/fh6db.py --info      # table row counts + import_run history
python scripts/db/fh6db.py --check     # integrity_check, foreign_key_check, empty ref_ tables
python scripts/db/fh6db.py --selftest  # the hash / PI / slider rules, against the game DB
```

`--check` exits non-zero when any `ref_` table is empty — an unbuilt reference layer is a
failure, not a state.

## `strparse.py` — the `.str` string-table parser

Ported from the analysis scratchpad so the pipeline has no dependency outside the repo.
Reads the binary tables at `C:\Users\mondr\Downloads\forza raw data files\raw string values\`.
`key_hash` is `fh6db.strhash`, not a second copy of the rule.

```sh
python scripts/db/strparse.py FILE.str                   # print rows
python scripts/db/strparse.py --validate STRDIR CSVDIR   # every CSV against its .str
python scripts/db/strparse.py --hash IDS_Description_1   # -> 1767058358
```

Validated 2026-09-02: 287 tables, 58,722 entries, 0 parse errors, all 69 ForzaTech Studio CSV
exports reproduced byte-exact, and the hash rule holds for all 58,722 keys.

---

## The rules — do not re-derive, do not contradict

Established by adversarial verification on 2026-09-02. Each lives in exactly one function.

1. **String refs.** Every `_&<u64>` cell is `(H(table) << 32) | H(key)`, with
   `H(s) = { h = 0xFFFFFFFF; for each UTF-8 byte c: h = rotl32(h ^ c, 7) }`.
   `lo32` is **not** unique across tables — 1,035 of 6,105 collide — so resolution **must** go
   through the table named by `hi32`. `KeyName` is always `IDS_<ColumnName>_<row id>`.
   One exception: `Data_Car.MakeName` targets `List_CarMake` and is keyed by `MakeID`, not `Id`.

2. **Part ids.** Container slot order is `fh6_tune_decode.PARTS`, which is *not*
   `Data_UpgradePart.Id` order for slots 42..49. `0xFFFFFFFF` = empty → store `NULL`, never `0`.
   Id grammar: Car-keyed `Id = Ordinal*1000+n`, Engine-keyed `EngineID*1000+n`, Drivetrain-keyed
   `DrivetrainID*1000+n`. **CarBody-keyed tables are keyed by the `CarBodyID` column**, which
   differs from `List_UpgradeCarBody.Id` on 87 of 779 rows — resolve body parts by lookup,
   never by id prefix (286 exceptions). `n` is a catalogue position, **not** the Level: the
   display name comes from `Upgrades(TypeId, Level)` using the row's own `Level`.

3. **Rims.** The performance attribute is `List_Wheels.MassLevel` (0 heaviest … 4 lightest),
   **not** `Mass`. Interchangeable for cloning iff `MassLevel` is equal, per slot
   (`rim_style` and `rear_rim_style` are independent). The lb-per-level unit is per *build*,
   not per car — store `MassLevel`, never a lb constant.

4. **Display PI** = `max(100, ceil(P0 + (norm - X0)*(P1 - P0)/(X1 - X0)))`, ceil not round,
   with class D's lower anchor `(0.0, 99)`. Against the game's own `Data_Car.PI` on all 660
   cars: 643 exact, 17 off by one — and all 17 are explained by `PerformanceIndex` being stored
   to only 4 decimals (`--selftest` asserts a norm exists inside each ±0.00005 window that
   yields the stored PI). **Consequence: when the game's own PI column exists, copy it.**
   `display_pi()` is for norms we compute ourselves, not for restating the catalogue.

5. **Sliders.** `v = Min + s*(Max-Min)` in the physics row's unit; a fresh install writes
   `s = clamp((Def-Min)/(Max-Min), 0, 1)`. When `Max == Min` the slider is **locked**: the
   install writes `s = 0.5` and `v = Min` for any `s` (0 exceptions in 575 containers).
   Adjustability is decided by `Max > Min`, **not** by `IsStock`. Bands not in the game DB and
   therefore hard-coded: camber `v = -5 + 10s` deg, front caster `v = 1 + 6s` deg, toe
   `v = -5 + 10s` deg (probable). Aero install writes `List_AeroPhysics.DefaultTuneSlider`.
   `rear_caster` is not a reliable fingerprint (15 of 527 downloaded tunes contradict).

Every `confidence` column uses one vocabulary: `proven | verified | derived | read | unknown`.
Times are ISO-8601 UTC strings; local time never enters a column.
