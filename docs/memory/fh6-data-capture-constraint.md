---
name: fh6-data-capture-constraint
description: "Jett's hard rule on manual data capture — one global-extrapolable menu grab is fine, per-car capture of every upgrade menu is NOT"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-08-23T04:00:10.912Z
---

Jett (2026-08-22) set the boundary on manual capture for filling decode gaps: **"I am okay to do a video capture of a single menu if the data can be extrapolated to all cars, but I will not capture or input the data from every single upgrade menu from every single car."**

**Why:** the whole project telos is a self-completing decode that needs near-zero user interaction; a per-car capture chore defeats it. A one-time capture that yields a GLOBAL mapping is acceptable because it amortizes to the whole garage.

**How to apply — classify every missing datum before proposing a capture:**
- **Global enum / game-fixed → ONE capture OK.** e.g. tire-compound index→name is a global enum (idx 0=Stock, 5=Race hold across all cars); one tire-menu grab pins 11/12/15 for every car. Wired via [[fh6-savefile-tune-decode]] `data/tire-compounds.json` + `load_compound_names()`. Same for global slider bands (gears/FD) — one ladder drive.
- **Per-car / per-chassis → do NOT ask for per-car capture.** e.g. available engine SWAPS per car, ride-height & downforce end-stops, per-car spring range. Get these WITHOUT capture: telemetry (auto — cyl/redline/dyno/boost, tyre radius, gear ratios), formula (springs from mass), or REGRESSION from the 159 already-decoded tunes × their exact CarPI (the path for per-part PI costs — no menus at all).
- When a feature *only* resolves via per-car capture (per-car swap NAME), drop that ambition rather than propose the chore; substitute telemetry signature + a global source.

This reframed the engine-upgrade deep dive (task wsqquen91): the in-game Engine Swap menu is per-car, so it's OFF the table under this rule — PI costs go via owned-data regression instead. Relates to [[fh6-slider-range-derivation]] (path C, menu-endpoint capture, is only OK where the endpoint is global).
