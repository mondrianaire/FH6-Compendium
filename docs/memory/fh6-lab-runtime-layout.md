---
name: fh6-lab-runtime-layout
description: The FH6 lab daemon and ALL accrued data stores live in the WORKTREE checkout — never restart the daemon from the main checkout (empty stores); master is a code mirror only
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-16T21:24:58.469Z
---

The live daemon (port 8765) must be started with its working directory set to the
**worktree** (`.claude\worktrees\forza-eliminator-tips-db-c512c3`), NOT the main checkout.
All accrued learning is worktree-resident `data/`: pi-observations.json, courses/*.json,
sessions/*, build-liveries.json, engine-swaps learning, routes.json. The main checkout's
`data/` copies are stale/empty — on 2026-08-28 a daemon restart from main made the two
S1-800 builds "lose" their PI stamps until restarted from the worktree.

**Why:** git worktrees share history but not working-tree files; the daemon reads/writes
data relative to its cwd, and it has always run from the worktree.

**How to apply:** deploy chain = commit in worktree → `git -C <main> merge --ff-only
claude/forza-eliminator-tips-db-c512c3` (serves 8643's static files) → restart daemon via
`Start-Process python scripts\telemetry\fh6_live_daemon.py -WorkingDirectory <worktree>` →
run `scripts/telemetry/verify_workflow.py` (27-attribute harness). See
[[fh6-savefile-tune-decode]] for the decode pipeline itself.

## Which changes need a daemon restart

The daemon spawns `analyze_session.py` as a FRESH SUBPROCESS every cycle and re-reads it from disk, so
**analyzer edits go live by themselves** — no restart, no commit. That has bitten twice: a bad void
predicate reached real data before review, and a detector change re-derived every course map unasked.

But the daemon **imports `lap_store` and `fh6_tune_decode` once at startup**, so edits to those sit
inert until it is restarted. Symptom seen 2026-08-28: `/laps` kept serving a 15.089 s partial lap with
`arc_m = 0` as the S1 reference for hours after the partial-lap guard was written and committed, because
the running process still held the pre-fix module.

Rule of thumb:
  * `analyze_session.py`        -> live immediately (treat every edit as production)
  * `lap_store.py`, `fh6_tune_decode.py`, `fh6_live_daemon.py` -> need a restart
  * `dashboard/app.js`, `db.js` -> need a cache-buster bump in dashboard/index.html

Restart ALWAYS from the worktree (see above) — from the main checkout it serves empty stores.

**Start/restart via `scripts/lab_up.ps1` — and NEVER via bare `python` (2026-09-16).** On this box bare `python`
resolves to the WindowsApps stub (`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`), which no-ops instead of binding —
that is what left duplicate stub+real dashboard/rebuild processes on 09-12 and would silently fail a headless start. Real
interpreters: `C:\Users\mondr\AppData\Local\Python\pythoncore-3.14-64\python.exe` (the running lab uses this) and
`...\Python\bin\python.exe`. `lab_up.ps1` now pins a real interpreter (Resolve-Python) and is idempotent (starts only
what is not already `LISTENING`), so it is THE start/restart entry point (daemon 8765 + dashboard 8000 + rebuild 8001).
**Watchdog (2026-09-16):** `scripts/lab_watchdog.ps1` polls `/health` + the 8000/8001 ports every 30 s and re-runs
`lab_up.ps1` when anything is down (single-instance mutex; logs `data/logs/watchdog.log`). Installed by
`scripts/install_lab_watchdog.ps1`, which tries a Scheduled Task (needs ELEVATION — blocked in the normal non-elevated
session) then falls back to a per-user **Startup-folder** `.vbs` launcher (`%APPDATA%\...\Startup\fh6-lab-watchdog.vbs`,
runs at logon) and starts it now. Root cause it fixes: the daemon was started once on 09-12, terminated externally ~16 h
later (clean exit, empty `daemon.err` — not a crash), and NOTHING supervised or restarted it, so the dashboard ran
feed-less ~3.75 days. Remove: `schtasks /delete /tn "FH6 Lab Watchdog" /f` and/or delete the .vbs. These 3 scripts +
the lab_up.ps1 interpreter pin are UNCOMMITTED as of 2026-09-16.

- Browser-pane check after editing dashboard/app.js: the page loads app.js?v=<tag> and the tag does not change on edit, so a plain reload can serve the cached old copy (symptom: new UI missing, no console error). Fetch the script with cache:"reload" (or bump the ?V= tag) before reloading; the worktree server and db.js were fine. Learned 2026-09-02.

**Rebuild service (added 2026-09-03):** `python scripts/rebuild_service.py 8001`, started from the WORKTREE, detached (log: `data/logs/rebuild_service.log`). POST /rebuild runs `rebuild.py --only containers` + `build_web.py` (~4 s warm, ~10 s cold); the dashboard calls it by itself when a re-read finds a save the DB does not hold, and from IMPORT + REGENERATE. If it is down the header chip reads 'import failed' and the banner names the start command. Never start it from the main checkout.
Its `GET /watch` (SSE) is the dashboard's live-reload channel: `code` on any dashboard/v2 file change (reload), `data` after a rebuild or when api/identity.json is rewritten (re-read). No browser polling.

## Checkout census, 2026-09-05

Seven copies exist; only two matter. `claude/forza-eliminator-tips-db-c512c3` is **100 commits
ahead of `master`** and contains everything master has — `dashboard/v2/` exists ONLY there, so a
`git log master` or a fresh clone of master misrepresents the project by two weeks of work.
The other four worktrees are orphans: `confident-euclid-744bc4` (branch `funny-ritchie-bc56d9`,
identical to master, clean, 110 M of redundant data), `determined-wilson-666419` and
`nostalgic-fermi-71f14e` (both merged, dead since 2026-07-10/11; nostalgic-fermi holds 5
uncommitted July dashboard edits), plus a branch with no worktree,
`claude/wmvp-exe-relaunches-d289cf`. `..\forza-horizon-6-tuning-premerge-backup-20260827\` is a
raw 20 M file copy, NOT a git repo — the only copy unreachable from git.

**Disk:** the worktree is 22 GB, of which `captures/` is 21 GB (194 raw telemetry CSVs, untracked)
and `data/` only 334 M. `_compress_old_captures()` gzips CSVs older than 3 days but runs
**once at daemon startup only**, so anything that ages past 3 days mid-run waits for the next
restart — that is why stragglers accumulate (one 558 MB Aug-28 CSV, seven from Sep 2).
Three uncompressed days at ~20 files x 193 MB is ~12 GB of working set by design.

**v1 lives beside v2 (settled 2026-09-03, do not re-derive):** v1 = `dashboard/app.js` + `db.js` +
`index.html`, served by the same server as v2 -- port 8000, `/` = v1, `/v2/` = v2. v1's build sheet
(`diskDeliverableHtml()`, `verifyBuild()`, `liveCoarse()`, the calibration input that POSTs to
`/tune-range`) is the richer surface v2 still has to port ([[jett-port-perfected-surfaces]]). v1's
`liveCourse()` did NOT solve overlapping-route matching; the real matcher is
`attribute_route()` + `_is_rollup()` in analyze_session.py (path overlap first, lap-timer-validated
start line only to split shared tarmac) -- port that, never invent a new heuristic.

**Identity is per BUILD, never per car instance:** `cars[].id` = ordinal|drive|cyl|pi; cid,
hw_hash and build_id are configuration keys on purpose. Two cars with identical builds are one
build for ranking -- correct, not a gap.

**Automatic imports (lesson of 2026-09-03, when telemetry sat 5 h stale):** the rebuild service
takes `scope=containers` (a save) or `scope=telemetry` (the daemon fires it on session close,
never per lap or on a timer); the dashboard's SESSIONS chip counts quiet-but-unimported session
files (90 s grace for a file still being written). Whenever a new automatic trigger is added, ask
what its failure mode SURFACES as -- this bug was a trigger that existed for one half of the
database and not the other, with nothing to notice the asymmetry.
