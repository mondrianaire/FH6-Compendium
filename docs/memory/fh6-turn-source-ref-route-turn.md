---
name: fh6-turn-source-ref-route-turn
description: "The identified/displayed turn set is ref_route_turn (fh6_turns.turns_for), NEVER the course_turn table"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-10T02:24:04.830Z
---

The turn identity actually under review — what the dashboard shows and what any turn-validation must render — is the **geometry detector** output: `fh6_turns.turns_for(route)` → `ref_route_turn`. The DB **`course_turn`** table is the OLD driven/learned set and is heavily **over-segmented (~2–3× the turns): Highway 45 vs 17, Kawazu 41 vs 9, Hakone 24 vs 18** — it reads as turns "doubling up" on one corner.

Path B (build_web.py ~line 369, `turns = _geo`) replaces the turns with the `ref_route_turn` set **only in the exported course/*.json**, NOT in the DB `course_turn` table — so reading `course_turn` directly gives the doubled driven set. A validation doc I built from `course_turn` showed false doubling; regenerating from `fh6_turns.turns_for` was clean.

**Why:** the driven turn set and the geometry set are different namespaces (never join by id — see [[fh6-turn-identification-rule]], [[fh6-turn-design-language]]). The geometry set is the deterministic, arc-anchored identity ([[no-game-turn-table]]).

**How to apply:** to show/validate "the identified turns," source them from `fh6_turns.turns_for` or `ref_route_turn`, ordered by `apex_arc_m` (start→finish), never from `course_turn`. Open latent issue: DB `course_turn` stays stale/doubled; check whether diagnosis/corner placement reads it before trusting those counts.
