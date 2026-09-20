---
name: fh6-rebuild-cascade
description: "Run scripts/db/rebuild.py, NOT the stage scripts standalone — standalone skips the dependency cascade (course_match, route_names) and courses lose their names"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-07T17:43:17.665Z
---

Never run a DB import stage (import_routes.py, import_telemetry.py, etc.) DIRECTLY when regenerating the lab DB — run `python scripts/db/rebuild.py` instead. rebuild.py owns the stage order and the DEPENDENCY CASCADE (scripts/db/rebuild.py ~line 62-66): e.g. running `routes` must cascade to `course_match` → `route_names` → `corners` → `diagnosis`. Running import_routes.py / import_telemetry.py standalone skips that cascade, so course_route matches and course/ref_route NAMES are never recomputed → courses lose their names and the course browser shows bare route numbers (Jett 2026-09-07: "route numbers are back in the course browser").

**Why:** the naming lives in later stages (import_course_match.py → import_course_match, import_route_names.py → derive course + ref_route names from map identity + catalogue). A standalone earlier stage resets course_route/telemetry but leaves the names stale.

**How to apply:** to push a code change through, run `python scripts/db/rebuild.py` (it verifies too), then `python scripts/db/build_web.py`. If you must run one stage by hand, follow it with its full downstream chain in order (course_match → route_names → corners) then build_web. Related belt-and-suspenders: build_web now names a world route from the matching route:<id> course when ref_route has no catalogue name (commit 1b80525), so a driven-but-uncatalogued route no longer shows as a number. Reinforces [[fh6-course-identity-workflow]].
