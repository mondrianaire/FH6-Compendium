---
name: fh6-import-gated-backlog
description: "Work deferred to a batch import/reprocess run (planned evening of 2026-09-12): the game-DB re-import batch (2 stub cars) and the telemetry-reprocess batch, plus the non-blocked interim fixes to not lose. Do the re-import FIRST — other structures depend on it."
metadata:
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-13T08:05:18.560Z
---

Consolidated 2026-09-12. Jett is batching import-gated work for later that evening because other
structures will be built that also depend on the re-import — so **run the re-import first, then the
dependent work**.

## Batch 1 — GAME-DB RE-IMPORT (needs an updated, decrypted `FH6_Database.sqlite`)
Root cause: cars added in a recent game update are **absent from our decoded game DB** (`Data_Car`), so
the import left **stub `ref_car` rows** (`display_name = "ordinal N"`, class/pi/engine all NULL). Two stubs
right now:
- **ordinal 4354** — the drift car; 6 builds A–F. Its stub state is WHY build identity contradicts: the
  stock-engine builds get `cyl = null` (no engine in the catalog), so the signature matcher can't credit the
  equipped build and picks a wrong sibling (see [[fh6-tune-identification-equip-workflow]]).
- **ordinal 3429** — also a stub (long-standing; seen in [[fh6-daemon-ts-request-is-a-pick]]).

Fixes on re-import: names, class, PI, and the stock engines into `ref_engine`/the catalog → `cyl` resolves →
identity works for these cars. Also picks up any new parts/events from the update.
- **Precondition:** Jett re-extracts/re-decrypts the updated `FH6_Database.sqlite` (DVS-code; NEVER run the
  exes from here — [[fh6-raw-data-folder]], [[fh6-decrypt-landscape]]).
- **Precondition MET 2026-09-13 00:06:** Jett decrypted the current install → `C:\Users\mondr\Downloads\db.sqlite`
  (671 cars, max Id 4354, has 3429+4354, integrity ok). NOT yet swapped in as `FH6_Database.sqlite`, NOT yet rebuilt.
  Procedure: [[fh6-decrypt-landscape]].
- **DONE 2026-09-13:** backed up old→`FH6_Database.sqlite.bak-2026-09-02`, swapped in db.sqlite, ran `scripts/db/rebuild.py` (check PASSED, integrity ok, 671 cars), then `build_web.py`, then restarted the daemon on the fresh DB. Result: 0 `'ordinal N'` stubs; 4354="1990 Jaguar" PI 750 (S1), 3429="2019" PI 560; 4354 engine now catalogued (cyl 12 resolves) → identity matches on real signals; `◈ NEW CAR` chip clears; api regenerated (cars 671).
- **⚠ `build_web.py` is NOT a `rebuild.py` stage** — `rebuild.py` only does the DB import cascade; you MUST run `build_web.py` (+ export_options/export_icons as needed) separately afterward to regenerate `dashboard/v2/api/`, else cars.json stays stale. (The old note that build_web was the final rebuild stage was wrong.)
- **Batch 1b — model names — DONE 2026-09-13.** EN.zip needs NO decryption (plain Deflate). Backed up `…\forza raw data files\raw string values\` →`.bak-2026-09-05`, extracted the current install's `media\stripped\stringtables\EN.zip` .str into it (Data_Car.str 67418→68536, +3 tables; importer reads that folder's `*.str`, DEFAULT_STRDIR, NOT the zip), then rebuild.py + build_web.py + `fh6_strings.py` (game-strings committed `346b6e6`). Result: **4354="Jaguar XJ-S Forza Edition" (S1,750)**, **3429="Ginetta G40 Junior" (B,560)**, stubs 0, ref_string_table 290. Daemon NOT restarted (dashboard name comes from cars.json/build_web; standing rule). Tracked in [[fh6-game-file-refresh-registry]].

## Batch 2 — TELEMETRY REPROCESS (re-analyze captures; independent of the game DB)
From [[fh6-turn-analysis-data-model]] — do these when captures are next reprocessed:
- **`resample()` downward-bias on stored `lat_g`** — reads only the two bracketing frames per 4 m checkpoint.
  **Fix resample FIRST**, then reprocess (else the bias re-bakes).
- **per-lap `peak_lat_g` is a raw MAX, not a p90** (minor; n≈2–4/phase so ≈max anyway).
Recomputes `lap_point`/`corner_segment`; does not touch the game DB.

## NOT blocked — interim fixes to not lose (can do anytime, no import needed)
- **cyl-bootstrap + honest NEW CAR state** — DONE + committed `9be4394` (2026-09-12), master mirrored.
  `_pick_meta` credits the live frame's cyl to an uncatalogued (stub-car) build for scoring → 4354 resolves to
  build F (chosen_pi 864 == live_pi 864, contradiction gone); the existing bootstrap persists the learned cyl once
  chosen. Header shows a `◈ NEW CAR` chip (panel v236) whose tooltip says name/class/PI await the re-import and
  identity is from live telemetry. NOTE this is the interim; the re-import (Batch 1) is still the durable fix that
  gives 3429/4354 real name/class/PI and collapses the residual 6-way tie.
- **setup_hash new-save fix** — DONE + committed `15928b2` (2026-09-12), master mirrored. Daemon new-save edge +
  `/disk-tune`/SSE `chash` + dashboard `reread`/rebuild dedup all key on setup_hash; live.js v=114. Verified: same
  content + advanced mtime → identical hash (no false "new save read"); the 6 builds of 4354 hash distinctly.

**How to apply:** tonight, do Batch 1 (re-import) before any structure that reads `ref_car`/engine data; then
Batch 2 if reprocessing; the two interim fixes are independent and can land whenever. Related:
[[fh6-never-forget-a-store]], [[fh6-rebuild-cascade]].
