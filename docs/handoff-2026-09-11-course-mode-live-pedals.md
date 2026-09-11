# Handoff — 2026-09-11 afternoon: live lap, course mode v2 steps 1–3, identity fix, pedals

14 commits on `claude/forza-eliminator-tips-db-c512c3`, `7dfe11a` → `4f4fc0c` (12:53–14:10), all
fast-forwarded to `master` (0/0). Nothing interleaved from other sessions. 16 files, +1709 / −192.
Asset stamps now: `styles.css?v=163`, `live.js?v=113`, `panel.js?v=211`, `app.js?v=106`.

## What changed

| area | commits | what it does |
|---|---|---|
| Live lap on the course map | `7dfe11a`, `6d43d5c` | `LIVE.lap` buffers the whole lap on the game's lap clock (rewind cut, restart, last run held through a pause, survives a reload via sessionStorage). The map draws it as an accent glow + painted trail + impact starbursts; the car marker is a white heading arrow (was amber = impact). Trail paint is selectable (grip / speed / pedals) from the map legend, one state with the trace. Fix: the live dot had been drawn in the course hero's glyph, not the map. |
| One grip palette | `e0d82a4`, `6d43d5c` | `DGRIP {col, ink, word, tip}` + `gripOf` / `gripInk` replace `TRACE_GRIP`, `TRACE_WORD`, `app.js GRIP`. Calm lines wear the class colour unless it is within ΔE 30 of a grip ink (A, S1, C, S2, B fall back to grey). |
| Course mode v2 step 1 | `762590b` | `rankVerdict` (rank · pool · scope · confidence; only lap / level / thin ☆), Current lap rated on **minimum** speed, abandoned attempts grouped by stint, `lapNo()` one 1-based lap number, scope token (`A·7`), General statistics on `activeLapSet()`, hero freshness from `built_at` (new in `build_web.py`). |
| Step 2 — scope band | `06513dc` | `#coursefilter` → class badges with counts, reading line, open / match / mismatch state with one-tap "match my car", paint control. ~108 px vs the design's 78 px. |
| Step 3 — turn window | `446f8d5` | Current lap tab: nav, 5-phase corner ribbon with the shown lap's line, speed ribbon vs the pool, SPEED / GRIP ladders, 4-row sortable rank table. |
| Build picker retired | `446f8d5` | Signature-tie picker no longer renders; identity is the save-tune method only. |
| Turn-map readability | `86cc2c7` | `turnFrame()` frames the whole turn; phase model drawn as strips on the road edges (laps can't bury it); corner-map legend; course legend collapses to one button with audited entries. |
| Identity rescan | `a7f09db` | Daemon `disk_watcher` tracks each car's newest save (`seen`), so a save made in a menu re-anchors identity; dashboard listens for the `disk` SSE event and re-reads. **Daemon restarted 13:5x** from the worktree via `lab_up.ps1`. |
| Pedals | `553c7e1` | Throttle / brake % recorded **from now on** (no backfill, Jett's call): analyzer → `laps.db` pts [7]/[8] → schema 6 `lap_point.thr/brk` → `build_web` trace [6]/[7]. "pedals" paint on the speed trace, map trail, map view, turn window and Turn analysis. Schema migrated by the 14:02 rebuild. |
| Docs | `7a83b6b`, `a8127de`, `b4d4873`, `eb96a69`, `4f4fc0c` | `course-mode-v2-prep.md` (spec → code map, decisions, build order), `course-mode-v2-design-extract.md` (the design canvas read in full), `data-structures-and-locations.md` (the real stores, replacing the fictional Eraser doc), `DATA-INVENTORY.md` / `design-language.md` touch-ups. |

## Verified vs not

- Verified in the Browser pane at 1080 × 1751 with synthetic frames on routes 5411 / 5191: no console
  errors, no page scroll, every state above.
- **Not yet seen with real driving:** the live map trail in an event, the first pedal-carrying lap (next
  analysed lap), and identity settling on the next in-game save (car 3429 still shows 3 tied saves).

## Open

- Course mode v2 steps 4–6: General statistics redesign, map legend bar + layer order, follow camera
  (only while a lap is live). See `docs/course-mode-v2-prep.md`.
- D3: live grip should be typical, not worst — the GRIP ladder compares a worst-moment live pass to typical history.
- `fh6db.py --selftest` fails its table-count check (expects 40 tables, schema has 67) — predates this work.
- `DATA-INVENTORY.md` row counts are from 2026-09-03; the Eraser "Untitled" doc and the ERD are stale —
  replacing them waits on Jett.
