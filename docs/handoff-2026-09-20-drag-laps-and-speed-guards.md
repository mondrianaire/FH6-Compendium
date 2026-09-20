# Handoff — 2026-09-20: drag-strip laps, and guarding against impossible lap times

Session worktree `forza-eliminator-tips-db-c512c3`, branch `claude/forza-eliminator-tips-db-c512c3`,
pushed to `origin/…` at tip **`83ce27a`** (verified against GitHub `mondrianaire/FH6-Compendium` by
`git ls-remote`). Three commits of my own; the rest of the branch is other sessions' work.

| commit | what |
| --- | --- |
| `aebd723` | A point-to-point drag run is a lap, however short — the segmentation fix |
| `752ec47` | Guard laps against impossible average speeds (3 boundaries) + `import_diagnosis` `lap_id` robustness |
| `a16c6bd` | Guard the course-model best trace against collapsed laps + self-heal purge |

> Commits `8bc8fa0`, `3e34adc`, `83ce27a` (and, locally, six more unpushed — Encyclopedia review,
> `grip_envelope`/radius-envelope schema 11–12) are **another session's** work on this shared branch,
> fast-forwarded in by the post-commit hook. I left them for that session to push.

## The task: ~10 drag runs, only 1 lap showing

Jett ran the Irokawa Space Center Drag Strip many times and the laps screen showed one. The going-in
theory (from the prior session) was that multiple runs were being **glued** into one lap and needed
splitting per outbound pass. **The telemetry disproved it.** Every window's position trace is a clean
monotonic straight (0→400 m, never returns) and each holds exactly one launch — the runs were never
glued. The `drag_out_passes` detector built on the glued-lap theory did nothing here and was removed.

The real cause was the **15-second minimum-window floor**. A quarter-mile run is ~6 s, and *two*
gates dropped anything shorter as "the stub after a finish line"
([`analyze_session.py`](../scripts/telemetry/analyze_session.py) — the window floor and the
geometry/lap-store `_cand_laps` gate). That floor is right for a lapped circuit (the trailing
fragment after the last crossing is not a lap) but wrong for point-to-point: one event **is** one
whole run. A ~50-run session stored 4 laps — only the windows long enough to clear the floor, and
those had staging idle folded in, so their times were garbage.

**The fix:** both gates now exempt a window that is the **sole window of its event** (a whole P2P
pass, never a split-off stub). `sole` is recomputed after `split_multilap`, so a looped free-roam
event that genuinely splits is not mistaken for a whole pass. Circuit laps (≥15 s) are untouched.

Result: Irokawa Space Center Drag Strip stores **122 clean ~6 s laps** (best 4.535 s), each its own
correctly-timed run.

## What the full backfill surfaced

Jett asked to apply the fix across history (`backfill_laps.py`, all 442 captures, 97 min, +132 laps,
S2 +130). Re-analysing every capture **churned `lap_id`** and exposed two pre-existing problems that
only appear at scale:

### 1. Rewind-collapsed laps read as impossibly fast

A rewind-heavy session can present a lap time no car could set:

- A **short sole window** whose paused/rewound frames dropped out spans a few seconds of surviving
  rows yet traces kilometres (the sole-window exemption would admit it).
- A **full-length window** whose `_game_lap_s` read a corrupted race clock — 13.3 s for a 10.9 km
  Colossus lap (838 m/s). This is independent of window length and predates this work.

No FH6 car averages more than ~150 m/s (540 km/h) over a whole pass, so that ceiling separates a real
lap from an artifact. **Four guards, each at a different boundary**, none of which touches a real
drag/sprint lap (400 m at ~60 m/s):

| boundary | file | what it does |
| --- | --- | --- |
| window selection | `analyze_session.py` `_short_pass_ok` | a short sole window must imply a possible speed (game clock **and** wall span) or it falls back to the 15 s floor |
| lap record | `analyze_session.py` (after `_game_lap_s`) | a time implying an impossible speed over `arc_w` is struck to `None` (keep the trace — the lap canon's untimed lap) |
| best-trace | `analyze_session.py` (`_full` filter + `speed_traces` purge) | an impossible window can't win the "fastest trace" slot, and any already-poisoned model trace is **retired on every analysis of the course** (self-heal) |
| materialization | `import_telemetry.py` `add_lap` | the same check at the boundary the dashboard reads, so no source — laps.db, a stale course-model trace, a session JSON — can put an impossible time in front of the dashboard |

The ceiling is a named constant in each file: `SHORT_LAP_VMAX = 150.0`
(`analyze_session.py`) and `LAP_VMAX_MPS = 150.0` (`import_telemetry.py`). **Keep them in sync** — or
promote to one shared home if you touch this again.

### 2. `lap_id` churn hard-fails the `diagnosis` stage

`lap_id` is an autoincrement reassigned on **every** telemetry re-import, but the deterministic
`.det.json` sidecars cache the `lap_id` they saw at scan time and are not regenerated (the stage
skips a sidecar newer than its capture). A full backfill orphaned **1007** cached references and the
`diag_event → lap` foreign key failed the whole stage. Fix: `import_diagnosis.py` coerces an
unresolvable cached `lap_id` to `NULL` before insert (the fault is still placed by
session/route/turn/cid; the grip/brake paths already emit `NULL`). The stage is now resilient to id
churn instead of hard-failing the cascade.

## Reprocessing done

- `backfill_laps.py` over all captures (one skipped: `fh6_20260828_134742.csv.gz`, a truncated gzip —
  pre-existing corruption, unrelated).
- Re-analysed individually while iterating the guards: `fh6_20260918_215956` (Irokawa),
  `fh6_20260829_051952` (Colossus), `fh6_20260906_024029` (the `4300_-4650` free-roam key).
- `rebuild.py --only telemetry` (cascades through `deterministic` → `diagnosis`) + `build_web.py`.

## Verification

- Irokawa Space Center Drag Strip: **122 laps**, best 4.535 s — on the dashboard, in fh6.db, in the API.
- **Zero impossible-speed laps DB-wide**; **zero corrupted `speed_traces`** across every course model;
  the game's-own-`BestLap` path (`best_laps`) had none to begin with.
- The Colossus (route:132) on the dashboard: **BEST 170.70 s** (was a bogus 13.3 s), plus one full
  lap now correctly **untimed** (its rewind-corrupted clock struck to `NULL`) and one 76 %-coverage
  partial. Its fragment course `-3750_300` (also route 132): all 7 laps plausible (23–109 m/s).
- `rebuild.py` `check: PASSED`; `diagnosis` passes.

## For whoever picks this up

- **The guards are defense-in-depth, not a root fix.** The root fragility is that `lap_id` is not a
  stable key — it is reassigned on every telemetry import, so any cached reference to it (the
  `.det.json` sidecars today; anything similar tomorrow) goes stale on the next re-import. A real fix
  is a stable lap identity (a hash of `route_key`+`session`+`cid`+`t0`, or a preserved rowid). Until
  then, a full backfill will keep orphaning sidecars — the `diagnosis` NULL-coercion just stops that
  from being fatal.
- **Two `VMAX` constants** (`SHORT_LAP_VMAX`, `LAP_VMAX_MPS`), both 150 m/s. In sync now; keep them so.
- **Data files are in flight.** `data/courses/*.json`, `data/sessions/*.json` and the git-ignored
  `dashboard/v2/api/` were churned by the backfill, the re-analyses and the live daemon. I did **not**
  commit them (shared-worktree rule); they are the lab's own accumulated state.
- The Irokawa drag runs also scatter onto a free-roam coordinate key `-1050_-8700` (same start line)
  when the route matcher misses the strip — a **course-attribution** issue, separate from this lap
  work, still open.
