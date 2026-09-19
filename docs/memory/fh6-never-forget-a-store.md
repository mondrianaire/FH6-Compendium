---
name: fh6-never-forget-a-store
description: "Jett's standing rule (2026-09-03) — never forget any relevant variable or datastore; docs/DATA-INVENTORY.md is the standing answer, consult it before ever saying something is unknown or asking the user to capture it"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T09:26:54.039Z
---

**`docs/DATA-INVENTORY.md` is the project's index of everything it holds** — every `fh6.db`
table with its row count and meaning, every `data/*.json`, every API file, the daemon's
endpoints / SSE events / frame fields, the game's own files, the specifications, and the
driving test battery. **Consult it before saying a thing is unknown, before adding a capture
step, and before asking the user to drive anything.**

**Why:** the same solved problems kept resurfacing as if unsolved. Concretely: gear ladders are
in `tune_gear` (4,067 rows, exact per save) and the daemon already matches them unit-free from
its own WOT accrual (`ST.live_fdg`) or the analyzer's `fd_gear`, with `_box_exercised` making
"no gear above N" real evidence from the accumulated gear set in `data/identity-evidence.json`
— so identity almost never needs a fresh pull, and asking for one is over-asking. Menu
dependency order is recorded (`ref_slot.menu_area/menu_order`, `ref_part.requires_aspiration`,
spec §9.1/§10.7) and must drive any clone route: aspiration conversion before its tier, body
kit last (it removes the front bumper), transmission and spring kits rewrite sliders so they
precede slider work. Driving instructions are a designed instrument, not a fallback:
`data/tuning-test-battery.json` has 3 static and 8 dynamic tests, the symptom matrix, the
cornering envelope, and `test_zero`, with Rivals as the fixed-condition lab.

**The coverage rule (added after the same failure recurred):** `docs/DATA-INVENTORY.md` §0 lists
every SOURCE with its import state, because the earlier version listed only what we held — so an
unimported source was never a row and never looked like a gap. Measured 2026-09-03: the 50 upgrade
slot tables are complete (87,655 = 87,655), 37 more game-DB tables imported by name, **129
untouched** (List_TorqueCurve, List_TireFrictionCurve, List_PartAttribute, UpgradePresetPackages
are the ones that matter); **6 of 82 UI texture archives** read — `Upgrade_Parts.zip` (902 entries,
the upgrade tile art) sat unopened for weeks despite a BC7 decoder already in the tree, and the
save folder's `header` and `Thumb.png` likewise. A source is done when every table or entry is
either imported or has a row saying why not.

**How to apply:** a new store is added to the inventory in the same commit that creates it. If
something genuinely is missing, say which inventory line is empty. See
[[fh6-ui-spec-is-the-contract]], [[fh6-data-capture-constraint]], [[jett-port-perfected-surfaces]].
