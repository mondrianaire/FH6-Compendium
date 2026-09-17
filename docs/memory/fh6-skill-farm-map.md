---
name: fh6-skill-farm-map
description: "FH6 skill-farm EventLab map \"gl hf\" — share code 417 202 428, tile position history for macro navigation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 31a7f054-bdfe-4244-a378-9489ced29e9f
  modified: 2026-07-27T06:16:19.582Z
---

POST-PATCH META (found 2026-07-17, unverified in-game): SP farming moved from EventLab races (capped 1 SP/run, empirically confirmed) to **Challenge Creator challenges** — a different content type whose rewards escaped the July 13 cap. Specific target: challenge **"New Skill Point Farm (27 Seconds)"** by creator **Aamirusmandus**, **share code 415 085 169** (verified working by Jett 2026-07-17, ~10 SP/27s run). Farm car: Subaru 22B-STi with tune **871 988 972** (verified 2026-07-19; the "...872" variant circulating in guides is a typo) — the 9× chain multiplier lives in the car's MASTERY perks, so a rebought 22B needs its multiplier path re-purchased or runs under-bank (source: Hypnostic video ~2026-07-13, 17K views; claims ~999 SP/hr, all-assists semi-AFK, 27s runs). Conversion meta: Lamborghini Revuelto = 1 Super Wheelspin + 3 Wheelspins per car. Patch-risk HIGH — same cat-and-mouse, expect a future sweep; free-roam chains remain the unpatchable fallback (still unprobed).

The original (pre-2026-07-13) skill-point farm ran on the EventLab map **"gl hf"** (RAAD-adjacent, Spring/Cloudy/Late Afternoon, custom route + world). **Share code: 417 202 428** — backup way to load it if tile navigation breaks again.

Tile position in the curated browser proved unstable (moved twice on 2026-07-10, once mid-run), so navigation switched to the **Favorites tab**: the map is favorited (must stay the ONLY favorite), and the farm macro presses **RB ×7** at event selection to reach Favorites, with zero left/right arrow presses (source: `Documents\full sp farm Forza6 v3 favorites.txt`; earlier tile-count sources v2/original are obsolete). If the farm desyncs at rep start, check: map still favorited, still the only favorite, and Favorites still 7 RB tabs away. Tile position is set by the game/curation and can shift again — if the farm desyncs at the very start (blue lightbar phase, first seconds), suspect tile drift first and consider switching the macro to load by share code instead ([[fh6-afk-macro-stack]]).
