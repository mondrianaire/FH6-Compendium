---
name: fh6-drift-skill-chain-separate
description: "MEASURED 2026-09-13 in an online Drift race: the top-screen skill-chain multiplier (x1.0..x7.0) does NOT multiply the Drift PTS ticker; ticker = distance x angle rule in all three drift modes"
metadata: 
  node_type: memory
  type: project
  originSessionId: c945cf04-0a47-42c1-bf6d-dbada521d23a
  modified: 2026-09-13T10:48:55.101Z
---

Online Drift race (Discord_nJRK5bSDyn, Narai-Juku Circuit, car ordinal 2412 = 1957 BMW Isetta 300, telemetry
fh6_20260913_063033.csv, race start 10:38:34.71 = on-screen 05:00; Discord clip mtime is ~78 s after clip end).

- Skill chain: grows ~+0.1 per skill popup from x1.0, reached x7.0 at ~2:50 in and never exceeded it across ~120 s of
  further skills (observed ceiling, likely cap); broke to x1.0 on a stall. Its chain total (e.g. 49,694 x7.0) is the
  separate skill economy.
- Ticker: lap 1 = 259,090 over 2,492 m (104 pts/m overall, 134 per metre at β≥10). A x7 multiplier would be ~1,000 pts/m;
  chain break x7→x1 left the ticker rate unchanged. Zone/attack angle curves predict 303-323k (model ~15-20% high here).
- Jett's lap: 23% of distance <10° (pays ~0). Same distance at 45-90° predicts 470-510k = opponents' 450-490k.

Related: [[fh6-drift-video-telemetry-union]], [[fh6-drift-rate-law]].
