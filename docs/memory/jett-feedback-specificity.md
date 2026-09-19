---
name: jett-feedback-specificity
description: "Tuning/upgrade advice must name exact in-game parts, menus, and values — category-level guidance ('add cams/exhaust', 'back off a part') is unacceptable"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 87e277b2-0c63-4ece-b224-d3c5a84d0789
  modified: 2026-08-10T22:10:52.895Z
---

Jett (2026-08-10, mid-4C-replication): "you need practice giving specific tuning information" — after I advised "bisect through cams/exhaust/intake/internals" and "back off the least-impactful engine part" without knowing the 4C's actual FH6 parts tree.

**Why:** Jett executes advice in a game menu in real time. A category name that doesn't match a menu entry is a dead instruction; they'd already flagged that discrete upgrades ARE the deliverable ([[jett-tuning-workflow]]). Generic tuning talk reads as filler to someone standing in the upgrade shop.

**2nd occurrence (2026-08-10, Viper build sheet):** gave ARB slider values (40/34) while the Race Anti-roll Bars purchase was buried in a parenthetical — Jett reached the tune menu without the part. RULE: every slider value in a build sheet must have its UNLOCK PART as an explicit numbered shop step (springs, ARBs, diff, brakes, transmission, aero are all separate unlocks); parentheticals are not instructions.

**How to apply:** Before advising any upgrade path, FETCH the car's actual FH6 parts data — calculators.games per-car pages, CODMunity tune parts lists, kudosprime sheets — or state plainly that the tree is unknown and go research it (workflow) before answering. Name parts exactly as the game menus name them, give per-part numbers (hp/tq/PI) when available, and give targets per SCREEN (which menu, which row, what value). If evidence only supports a partial list, label the gap instead of padding with categories.
