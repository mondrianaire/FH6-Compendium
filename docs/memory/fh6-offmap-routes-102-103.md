---
name: fh6-offmap-routes-102-103
description: "Route102/103.owt are complete circuits parked 8–11 km beyond FH6's north coast, outside the nav mesh, road-class 0 — cut/dev content, not corruption; excluded from the map fit and from aggregates"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T06:03:02.977Z
---

Of the 169 `aitracks/Route*.owt` files, **Route102 (3.87 km, 16 turns) and Route103 (3.14 km,
18 turns)** sit at x 8769..11023, z 17092..20163 — 22–24 km NE of the island centre, 8–11 km
past the coast. Researched 2026-09-03.

**Not corrupt:** unit surface normals, 4–6.5 m half-widths, 2 m spacing, island-like altitude,
normal `.nav` companions. **Not reachable:** `Brio_00.nav` (38,473 nodes) spans x −8052..6717,
z −9492..9274 and has zero nodes within 8 km of them; every record carries road-class code **0**
(every island route has real codes); no telemetry has ever been there. The game DB's
`Tracks`/`Environments` ids 102/103 are legacy Forza Motorsport test environments in a different
id space — a dead join. No real Japanese circuit matches either length within 4%.

**Verdict:** cut or developer circuits shipped in the route folder (~70%); nothing announced,
leaked, or reported corresponds to them.

**How to apply:** the world map fits to the island and draws them only behind the "show
off-map (2)" toggle (`routeSplit()` in panel.js: centroid > 12 km from the median). Keep them
out of every road-class or route-family aggregate — class 0 is a sentinel, not a value. They
can never produce telemetry, so they are cartography, not tuning data. See
[[fh6-turn-identification-rule]], [[fh6-decode-the-whole-record]].
