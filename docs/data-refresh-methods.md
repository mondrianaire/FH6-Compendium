# Updating the lab with new data — every method

How new files (game saves, sessions, telemetry) and code changes reach the running lab. Everything runs
from **the worktree** (`lab_root` guard refuses the main checkout); stores live in `data/` in the worktree,
and `dashboard/v2/api/` is generated (git-ignored).

## The three processes (`scripts/lab_up.ps1` starts all three)

| Process | Port | Script | Role |
|---|---|---|---|
| **Daemon** | 8765 (UDP 9876 in) | `scripts/telemetry/fh6_live_daemon.py` | live telemetry capture, course/build identity, writes session CSVs, runs the analyzer, pings the rebuild service |
| **Dashboard** | 8000 | `scripts/serve_dashboard.py 8000` | static server (v2 at `/v2/`, v1 at `/`) — serves `dashboard/` + `dashboard/v2/api/` |
| **Rebuild service** | 8001 | `scripts/rebuild_service.py 8001` | on-demand `POST /rebuild` → runs a rebuild scope + `build_web`, in a worker thread, coalesced per scope |

Bring the lab up: `powershell scripts/lab_up.ps1`. Health: `:8765/health`, `:8001/status`.

## A. New GAME DATA arrives (automatic — no command needed)

- **New tune save on disk** → the **dashboard** POSTs `scope=containers` to :8001 → `rebuild.py --only containers` + `build_web.py` (~8 s). Separately the **daemon rescans the on-disk tune on every menu exit** (one 598-byte decode) so the current save is always fresh — menu frames carry nothing, the menu-exit disk rescan is the source of truth.
- **Driving → session close** (driving stops 5 s after ≥15 s of real driving — never a menu return or mid-lap) → the **daemon** POSTs `scope=telemetry` to :8001 → `rebuild.py --only telemetry` (which **cascades** to `course_match → route_names → corners → diagnosis`) + `build_web.py` (~3 s). This is what imports `session`/`lap`/`corner_obs` and (re)names courses.
- **Live analysis mid-drive** → the daemon runs `analyze_session.py` as a **subprocess** on lap boundaries / event end / a periodic timer. Because it's a subprocess, **analyzer code changes deploy live with no daemon restart**; results land in `data/sessions/*.json` and `data/courses/*.json`.

## B. Regenerate the DATABASE (`data/fh6.db`) from sources — manual

Always via **`rebuild.py`**, never the raw `import_*.py` scripts (those skip the dependency cascade → courses lose names, see [rebuild-cascade memory]).

```bash
python scripts/db/rebuild.py                      # FULL: every stage in order
python scripts/db/rebuild.py --only routes        # one stage + its transitive DOWNSTREAM (cascade)
python scripts/db/rebuild.py --only telemetry --no-cascade   # literally one stage, no dependents
python scripts/db/rebuild.py --check              # verify only, import nothing
```

Stage order (`STAGES` in rebuild.py): `gamedb, objectmodel, events, curves, parts_extra, containers,
telemetry, routes, anchors, surface, course_match, route_names, corners, observations, diagnosis,
field_catalog`. `--only X` reruns X **plus every stage that joins a table X rewrites** (`DOWNSTREAM` map) —
e.g. `--only routes` also runs `anchors, surface, course_match, route_names, corners, diagnosis`.

## C. Regenerate the WEB DATA (`dashboard/v2/api/*.json`) from the DB — manual

```bash
python scripts/db/build_web.py    # reads data/fh6.db → writes dashboard/v2/api/ (cars, courses, world, build/*, course/*, …)
```

Run this after **any** DB change (rebuild service does it automatically for A). It's what the dashboard
actually fetches; a DB change is invisible to the page until `build_web` runs.

## D. Deploy CODE changes — depends on what changed

| Changed file | How it takes effect |
|---|---|
| **Daemon in-process** (`fh6_live_daemon.py`, and modules it imports in-process e.g. `fh6_tune_decode.py`) | **restart the daemon** (8765). *Standing rule: never kill the live daemon without asking.* |
| **Analyzer** (`analyze_session.py`) | **live, no restart** — runs as a subprocess; next analysis picks it up |
| **Dashboard JS/CSS** (`live.js`, `panel.js`, `app.js`, `styles.css`) | **bump `?v=N` in `dashboard/v2/index.html`** — the page auto-reloads (see E) |
| **Build/import Python** (`build_web.py`, `import_*.py`, `rebuild.py`) | **re-run the relevant build** (B and/or C) for the change to reach the DB/web |
| **Route/turn geometry** (`fh6_turns.py`, `fh6_owt.py`) | `rebuild.py --only routes` (cascades) + `build_web.py`; course_turn side updates as sessions re-analyze |

## E. Refresh the running DASHBOARD PAGE

- **Automatic — code:** editing a JS/CSS `?v=` in `index.html` triggers a reload. Two paths: a live-reload
  **WS `code` event**, and **`watchVersion()` as the backstop** — on every tab focus and once a minute while
  visible, the page fetches `index.html` (no-store) and, if the served `live.js?v=` differs from the one it's
  running, **reloads** (deferring until the menu closes if you're mid-menu). So a `?v=` bump reaches the page
  within ~60 s even if the WS died.
- **Automatic — data:** a **WS `data` event** drops the api cache and re-reads identity/world/diagnosis/car
  **without a full reload** (this is what fires after a rebuild finishes).
- **Manual:** browser reload. **In the in-app preview browser**, `?v=` is cached, so add a throwaway query
  (`/v2/?cb=<anything>`) to force a fresh fetch.

## Quick "I changed X, now what" cheatsheet

- Edited dashboard JS/CSS → bump `?v=` in `index.html`; done (page auto-reloads).
- Edited `build_web.py` → `python scripts/db/build_web.py`.
- Edited an importer or route/turn geometry → `python scripts/db/rebuild.py --only <stage>` then `build_web.py`.
- Edited `analyze_session.py` → nothing; live on next analysis.
- Edited daemon in-process code → restart the daemon (ask first).
- New save / drove a session → nothing; the rebuild service handles it automatically.
