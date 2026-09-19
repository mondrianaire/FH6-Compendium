---
name: fh6-drift-attack-rewind-start-glitch
description: "ANSWERED 2026-09-13 (Jett-tested, 2 attempts measured): in Drift Attack, a rewind back to a first snapshot taken right at the start line keeps the score, so points compound; leaderboard reportedly caps at 750k"
metadata: 
  node_type: memory
  type: project
  originSessionId: c945cf04-0a47-42c1-bf6d-dbada521d23a
  modified: 2026-09-13T07:46:01.201Z
---

**Mechanic (Jett's conclusion, consistent with telemetry):** line the car up as close to the start line as possible so
the attempt's first rewind snapshot lands on the line; every later rewind back to that exact snapshot keeps the live
score instead of restoring 0, so points compound. Forgiving — no special lead-up needed (the backward gate crossings
seen in both measured attempts were just how he lined up). Mid-run snapshots restore normally.

**Evidence:** MafLn2sFGM (snapshot 7.1 m past gate, 3/3 kept) and ax7LGSE2rW (snapshot −1847.156, 1564.627, 0.42 m,
15 rewinds, 14/14 readable pairs kept; ~241k → 849,768 finish). ~20 other rewinds to later snapshots restored.
Telemetry pins each rewind target to 0.00 m (resume frame = earlier frame). In Drift Attack DistanceTraveled is live
attempt distance (distance-to-gate after an attempt ends).

**Leaderboard:** Jett reports it appears to max out at 750 (k); the HUD row read 849,768 right after that finish —
unverified which the global board keeps.

**Untested:** a game reset-placed start (~(−1848.9, 1563.1)) as the rewound-to snapshot; Drift Zones.
Scripts: scratchpad rewindall.py, rewindcheck2.py (session c945cf04). Related: [[fh6-drift-rewind-rollback]], [[fh6-drift-attack-x2-bonus]].
