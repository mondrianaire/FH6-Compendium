---
name: fh6-drift-zone-route-channel
description: A flat Drift Zone ticker has two causes — off the route (minimap cyan loop gone) vs on route but not sideways
metadata:
  type: project
---

Jett, 2026-09-09: "0 score when everything else looks good is because the car is off
the identified track." Corroborated on both episodes then in the corpus.

The HUD carries this channel and I had been ignoring it. While the car is inside the
zone corridor the **minimap draws the route as a CYAN loop with an "N YD" readout above
the map**. Both vanish the instant the car leaves it — and that is exactly when the
ticker freezes, however good the drift looks. The clean case is
`forzahorizon6_taOxVbHDMm` t=127: full smoke, big angle, 62 mph, the skill chain still
awarding "Drift 100" at x1.6, ticker frozen at 168,783, no cyan route on the minimap.
The attempt failed one second later.

Two unrelated causes of a flat ticker, never to be conflated:
1. **Off the route** — scores nothing at any speed or angle; both FAILED attempts were
   in this state beforehand, and no COMPLETED attempt ever entered it.
2. **On the route but not sideways** — also scores nothing, but does NOT fail the
   attempt; scoring resumes the moment the car goes sideways again.

Note "off the tarmac" is NOT "off the route": at t=124-125 the car was in grass beside
the road and still scoring +2,374.

A THIRD cause was added 2026-09-09 (Jett): rotating **past about 90 degrees** — too far
backwards — also kills the count, on-route and mid-drift. Supported so far, reduced
rather than zeroed at 1 Hz sampling. Gear R is not a proxy for it: reverse-gear seconds
have scored at up to 2,087 pts/s.

**How to apply:** `on_route` is now measured automatically by
`scripts/drift/route_signal.py` (cyan fraction of the minimap crop — a colour threshold,
never OCR), and exclude off-route seconds before fitting
anything about rate. `scripts/drift/corpus.py` reports the two kinds of flat second
separately. Open questions and their gates live in `data/drift-questions.json`. See
[[fh6-drift-corpus-discipline]] for the standing rule about not claiming mechanics from
one video, and [[fh6-judge-against-the-course]].
