---
name: fh6-not-eliminator
description: "HARD RULE (Jett, 2026-09-03, final, said forcefully) -- Eliminator mode is NOT in play for this project's build/testing work. Never suggest, guess, or float it as an explanation for anything observed, ever again"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T23:10:00.000Z
---

Jett, verbatim: "i need you to repeat to me twice that eliminator is not an issue, I am not playing
eliminator while attempting to build this and you need to not bring that up as an option again."
This is final. Do not suggest, hedge toward, or float Eliminator mode as an explanation for
anything observed in this project again, in any context.

**What happened, so the mistake is not repeated in spirit even if not by name.** A live daemon
health check showed 11 different car ordinals in `ST.cars` (a cache that accumulates over the
WHOLE time the daemon has been running, not a recent window). That alone was pattern-matched into
"rapid car-switching -> must be Eliminator" and stated as fact, without checking any actual
mode signal first -- and Forza's live telemetry protocol carries NO explicit game-mode field at
all (confirmed directly this session by reading a raw frame), so a mode claim from telemetry is
ALWAYS an inference, never a read fact. Jett corrected this directly and firmly.

**How to apply.** A diverse or changing car list in `ST.cars`/`/health` proves nothing about
what mode is active -- don't infer a game mode from it, Eliminator or otherwise. If a car has no
on-disk save container (`/disk-tune` returns `available:false`), the honest, verifiable
explanation is simply "no tune has been saved for this car yet" (per `buildStatus()`'s own
`!disk` branch) -- state exactly that, cite what was actually checked (container count on disk,
the daemon's own stated reason), and stop there. Do not construct a game-mode narrative to explain
a data gap. If the real cause of something observed is genuinely unclear, say so directly and ask,
per Jett's own instruction: "I would rather no answer than a confident incorrect one."
