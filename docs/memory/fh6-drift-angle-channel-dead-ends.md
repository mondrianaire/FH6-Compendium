---
name: fh6-drift-angle-channel-dead-ends
description: HARD FINDING — drift angle is not recoverable from the minimap; two approaches failed validation. Use the UDP daemon.
metadata:
  type: project
---

Angle is the missing term in three open drift questions at once. Two attempts to recover
it from video **failed their own validation on 2026-09-09**. Do not re-chase either.

1. **Route principal axis.** Fit the cyan route pixels in a disc around the player marker,
   treating the minimap as heading-up. Two seconds known from their frames to be dead
   straight read **77° and 60°**. Cause: the zone routes are tight spirals, so the disc
   catches several strands of the same loop and a line fit through them means nothing.
2. **Player chevron orientation.** Read the chevron instead, on the theory that the map is
   course-up so the chevron shows heading. The same two straight seconds read **+143° and
   +140°**. Pixel counts of 300–800 also show the disc catching UI text. The chevron *does*
   rotate and the compass N *does* rotate — so the map is neither heading-up nor north-up —
   but the chevron does not track the car's visible state. Unresolved; not worth a third guess.

**The in-game TELEMETRY OVERLAY is not the answer either.** It shows steering, throttle,
brake, e-brake, clutch, rpm and speed — but it *replaces* the HUD, so the zone ticker is
hidden while it is open and the two can never be correlated frame by frame. It also shows
no slip angle on its General page. See `data/drift-runs/forzahorizon6_OAT6XAs7i3.json`.

**The path that should work:** the project already owns `scripts/telemetry/fh6_live_daemon.py`,
which reads the game's physics over UDP while the HUD stays normal. Run it alongside an
ordinary capture — video gives the ticker, the daemon gives true slip angle, joined on the
wall clock. One session's work, and it unblocks `rate-drivers`, `what-stops-it` and
`past-90-degrees` together. See [[fh6-drift-rate-law]], [[fh6-drift-corpus-discipline]].
