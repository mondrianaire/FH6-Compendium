---
name: fh6-no-game-turn-table
description: "HARD FINDING 2026-09-07: the game stores NO turn list/count/indicators for a route — turns must be derived from geometry; the raw route data was dug and has none"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-07T12:11:40.289Z
---

Dug the raw route data for a canonical turn table (2026-09-07). There is none — turns are NOT readable from the game, they must be DERIVED from the centre-line geometry (curvature), which is what `fh6_turns.py` does. Do not re-chase a game turn list.

- **Game DBs** (`FH6_Database.sqlite`, `gamedbRC_decrypted.sqlite`, 205 tables each): no per-route turn/corner/waypoint table. Only "turn" hits are `AIMistakeScales_TurnType` (AI turn-TYPE taxonomy, not per-route) and tire curves. No route/track layout table at all — routes live in the `.owt` files, not the DB.
- **`Route<id>.owt`** (169 files at `C:\XboxGames\Forza Horizon 6\Content\media\openworld\brio\aitracks`, parsed by `fh6_owt.py`): 56-byte per-point record, 14 fields. 0–8 = geometry (pos, lateral half-width vector, surface normal); 9–13 = "link data". Slots 11/12 = surface road-class code (used by `import_surface.py`). Slots 9/10 = DENSE packed ints (~95–98% of points, per-point link/index data). Slot 13 = SPARSE (~10%) and looked like turn markers, but correlating its hits vs the curvature-derived apexes across 5 routes showed they're spread everywhere (idx-dist 0–340 to any apex) AND a 0-turn straight route (Route11045, 87 pts) still carries 8 evenly-spaced slot-13 hits → it's periodic waypoint/sector nodes, NOT turns.
- The in-game turn-ahead cues are derived from geometry in real time, same as we must.

Implication: no ground-truth turn table exists to validate against, so the turn-recognition Priority 1 ([[fh6-course-identity-stability-2026-09-07]] / docs/turn-recognition-deep-dive-2026-09-07.md) — map-anchored precision/recall scoring in `turn_lab.py` against `ref_route_turn` — is the closest thing to ground truth. Reinforces [[fh6-turn-identification-rule]] (the map/geometry is the authority) and [[fh6-github-first-research]]. The separate `Downloads\forza raw data files\trackroutes\*.nt` (route0.nt, route3001.nt, locators, map_region_*) are locator/challenge/nav files, not per-route turn tables; the `.owt` set is authoritative and turn-less.
