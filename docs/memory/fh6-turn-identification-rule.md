---
name: fh6-turn-identification-rule
description: "The settled rule for what counts as a turn in FH6 course models — the map is the authority, and every turn-to-turn matcher must use the map's own spacing"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-08-29T00:38:42.855Z
---

Settled 2026-08-28 after repeated wrong turn counts on Edamame Circuit (13 mapped
turns rendering as 8, then 10, then 16). Two rules, both learned the hard way:

**1. THE MAP IS THE AUTHORITY.** A turn exists because the ROAD bends, not because of
how a lap was driven. Behaviour (grip clusters) is a fallback only while a course has
no geometric map at all — once the lateral-g trough split folds gentle corners into the
geometry, behaviour-only turns are pure drift: they depend on the drive, so the count
moves when nothing about the track did. Edamame showed 13 mapped / 16 established
purely from three grip clusters sitting outside the map.

**2. EVERY TURN-TO-TURN MATCHER USES THE MAP'S OWN SPACING**, never a constant. There
were THREE matchers (registry arc, registry x/z, registry→merged_turns) and fixing two
achieved nothing, because the third still re-merged at a hard-coded 40 m what the first
two had just kept apart. Tolerance is derived once from the map's closest turn gap:
`_TOL = clamp(gapmin / 2, 6, 22)`. Edamame has pairs 20 m apart — any constant above
~20 m silently destroys them.

Corollary for MIGRATIONS: judge stored turns on EVIDENCE, not on the `est_by` label.
The two oldest models predate provenance entirely (no est_by / geo_mapped /
geo_sessions), so a label-based migration skips exactly the worst offenders — one had
184 established turns over a 172-turn map. `geo_mapped` is recomputable: a stored turn
within 45 m of a map turn is mapped, which is all that flag ever meant.
`scripts/telemetry/migrate_turn_establishment.py` does this; it only ever demotes, and
is idempotent.

This is the same recurring failure as [[fh6-judge-against-the-course]]: judging against
the wrong reference set. Here the wrong reference was the DRIVE; the right one is the
road. See also [[fh6-slider-range-derivation]] and [[fh6-lab-runtime-layout]].

**Validation rule (Jett, 2026-09-05):** the earlier detector generations (pre-versioning, geo4,
geo5) were NOT trusted, so never validate a new turn set by how well it matches previously
identified counts or types, and never call a regenerated model "churn" without evidence. Judge
against the map (`ref_route_turn`) and lap stability across sessions. Re-deriving the Aug-22
captures on 2026-09-05 took -4750_-1550 from 12 to 39 turns and 3550_6100 from 27 to 66 --
neither number is right until compared with the road.
