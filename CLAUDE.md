# FH6 Tuning Lab — agent orientation

The working root for the Forza Horizon 6 tuning knowledge base + local dashboard. **Read this first.**
Thin index by design — detail lives in `docs/`. *Last updated 2026-09-13.*

## Use your checkout of the lab branch as the project root

Work from **your own checkout of the lab branch** (`claude/forza-eliminator-tips-db-c512c3`) — whatever
worktree you are in. The tracked files (code, `docs/`, `db/`, `scripts/`, this `CLAUDE.md`) are present in
**every** checkout, so any of them is fine for editing, grounding, and committing. Grant access to that
**root** (recursively), not to a subfolder — `docs/` is a sibling of `dashboard/`.

- The generated **`dashboard/v2/api/*.json` is git-ignored and per-worktree** (built by
  `scripts/db/build_web.py`), so it exists only in a checkout where a build/lab has run. You need it only to
  **serve or verify the live dashboard**; if your checkout's `api/` is empty, rebuild it with
  `python scripts/db/build_web.py`, or use the worktree where the lab runs.
- **Never use** `…/Projects/forza-horizon-6-tuning` (the bare root outside `.claude/`) for the live dashboard:
  it is the `master` mirror with an empty `api/`, so the dashboard there hangs on "reading the database…".

## Start here

- `README.md`
- `docs/DATA-INVENTORY.md` — the index of **every** data store. Read before concluding anything is "not available."
- `docs/data-availability.md` — the data-availability map for onboarding agents: the provenance and value-type
  of every source, and the "sanitized branch" lens. Visual: https://app.eraser.io/workspace/Ex1bEXcuOL57kK2O5OQg
- `docs/game-data-refresh.md` — every game-data refresh routine (decrypt the game DB, extract EN.zip, rebuild,
  sync names): source, utility, why, and frequency. Run its checklist after every FH6 title update.
- `docs/handoff-data-structures.md` — every store, table and field VALUE (enums, codes, tiers) with row
  counts; written companion to the *FH6 Lab Database ERD* (https://app.eraser.io/workspace/EV5zhW3hPU6v4Z7PiZoW).
- Recent state: `docs/handoff-2026-09-11-course-mode-live-pedals.md`, `docs/handoff-2026-09-06-session-state.md`
- Dashboard: `docs/dashboard-states.md` (regions/modes) · `docs/fh6-ui-spec.md` (in-game UI contract) · `docs/design-language.md`

## The dashboard (what an agent working on it absolutely needs)

- Current = **v2**: `dashboard/v2/` (`index.html` → `panel.js`, `live.js`, `app.js`, `styles.css`).
  `dashboard/app.js` at the dashboard root is **v1**, legacy.
- **Static / most-recent view** = the built files in `dashboard/v2/` + its generated `api/` (this worktree only).
- **Live view** = run the lab (`scripts/lab_up.ps1`): live daemon on **:8765**, dashboard on **:8000**
  (v1 at `/`, v2 at `/v2/`), rebuild service on **:8001**. Design target is a 4K **portrait** screen = 1080×1920 CSS px.

## Hard rules (do not relearn these the hard way)

- **Course identity**: route id → `ref_track_info` → name. Never name a course by length, `.str`, or decryption.
- **Two turn namespaces**: `course_turn` ≠ `ref_route_turn` — never join by id. Displayed/identified turns come
  from `ref_route_turn` / `fh6_turns`; `course_turn` is the old ~2–3× doubled driven set.
- **Identity has two directions**: forward (telemetry → build) may use the gear ladder / PI; any
  compare / distinguish / A-B **must** use `hw_hash` (upgrades) + `tune_hash` (sliders).
- **Rebuild via `scripts/db/rebuild.py`**, never a standalone import stage — standalone skips
  `course_match` / `route_names` and courses lose their names.
- **Never run the game `.exe` / `.msi`** in `Downloads/forza raw data files` — read only the sqlite / string refs.
- **Shared-worktree commits**: stage explicit pathspecs and commit those paths. Never `git add -A`, never a bare
  `git stash` — unrelated changes (course/session JSON, PI obs) are usually in flight.
- **Provenance / sanitization**: the *Data Out* UDP telemetry is the only developer-supplied live source; the
  runtime decode of game files (save tune, livery, anchors) is the "sanitized branch" target — see
  `docs/data-availability.md`.

## Data at a glance

Central store `data/fh6.db`: the `ref_*` reference layer decoded offline from the game, plus our own
lap / course / identity tables. The dashboard `api/` JSON is generated from it. Live telemetry arrives over UDP
into `fh6_live_daemon.py` (:8765). Full detail and provenance: `docs/DATA-INVENTORY.md` and `docs/data-availability.md`.
