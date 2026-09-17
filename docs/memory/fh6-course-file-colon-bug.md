---
name: fh6-course-file-colon-bug
description: "Course detail files must be named with the dashboard's sanitiser (colon→_); a raw route:<id> filename is illegal on Windows and 404s"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-07T00:37:17.241Z
---

The "unnamed course" that would not go away (2026-09-06) was NOT an identification failure. The daemon named the course correctly (loop = "Legend Island Circuit", route:311) and world.json indexed it named — but `build_web.py` wrote its detail file as `course/route:311.json` (`key.replace("/", "_")` only swapped slashes, leaving the colon). **A colon is an illegal Windows filename char**, so every `route:<id>.json` write collapsed onto an alternate data stream of a 0-byte base file `route` and the real file never existed. The dashboard fetches `course/route_311.json` (`courseFile()` maps every non-`[A-Za-z0-9_-]` char to `_`, panel.js), got a 404, and `adoptLoop()` bailed ("never latch a key whose file will not load") — so the view stayed on the only files that existed, the leftover grid-keyed courses, showing one as "unnamed course -5000_-850". Only 23 of 80 courses (the grid-keyed, colon-free ones) had loadable files; all 57 `route:<id>` courses 404'd.

Fix: sanitise the filename the SAME way both sides do — `re.sub(r"[^A-Za-z0-9_-]", "_", key)` in build_web, matching `courseFile()`. Rule: **any key that becomes a filename must pass through the identical sanitiser on the writer and the reader**, and a colon (or `\ / : * ? " < > |`) is never legal on Windows. Verified: all 57 route files write, `route_311.json` HTTP 200 with 36 turns/22 laps, `adoptLoop` sets COURSE instead of the grid fallback. Committed 00488a1. Related: [[fh6-course-keying-catalogue]], [[fh6-course-corroboration-hierarchy]].

Separate open observation from the same session: the daemon classifies a Rivals rolling-in / between-laps phase (CurrentLap==0, RacePosition==0) as `game="freeroam"` — the packet cannot tell it from free roam (CurrentRaceTime is >0 while moving in BOTH). Position on a catalogued route is the only signal there; not yet wired.
