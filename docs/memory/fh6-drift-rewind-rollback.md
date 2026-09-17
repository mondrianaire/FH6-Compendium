---
name: fh6-drift-rewind-rollback
description: SETTLED 2026-09-09 — rewind does not penalise zone score; it winds the run back, so the drop = points banked in the rewound stretch
metadata:
  type: project
---

Jett, 2026-09-09: "the rewind score is negative because we are rewinding to a previous
point in time, the amount it is negative should depend on the amount we rewound."

Correct, and now tested. `scripts/drift/rewind_check.py` is the discriminator: under a
PENALTY the post-rewind score would sit *below* the run's own pre-rewind curve, matching
no value the run ever held; under RESTORE it must land *on* it.

**All 4 of 4 land on the curve.** Implied rewind lengths 2.91 / 3.17 / 3.66 / 3.85 s
(mean 3.40 s — one fixed step), and the implied rate over each rewound stretch
(1,532–2,631 pts/s) is an ordinary scoring rate for that moment. The drop is duration ×
rate. There is no penalty.

**Correction to my own earlier note:** I had flagged `data/drift-guide.json` →
`scoring_mechanics` → `Banking rules` ("Rewind PRESERVES accrued zone score") as
*contradicted*. It is not — it is imprecise. Nothing extra is deducted; the score is
restored along with the rest of the run state, so it returns to its value at the rewind
target rather than staying at the pre-rewind peak. Reword, don't retier.

Still unmeasured: whether the rewind step is fixed or scales with speed (all four samples
came from similar speeds), and the guide's separate claim that too many rewinds fails the
attempt. Operationally, **a rewind hides the entire HUD** — which is why
`scripts/drift/route_signal.py` needs its HUD-present gate. See
[[fh6-drift-zone-route-channel]], [[fh6-drift-corpus-discipline]].
