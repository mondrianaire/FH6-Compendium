---
name: fh6-ui-spec-is-the-contract
description: "docs/fh6-ui-spec.md (352 lines, transcribed from 758 in-game frames) + scripts/telemetry/clone_parts.py are THE authorities for any in-game mimic (build sheet, clone route); names, order, units, value precision are law"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T08:49:23.922Z
---

**`docs/fh6-ui-spec.md`** is the reconciled FH6 Upgrade & Tune UI specification, transcribed
verbatim from 758 frames (1 fps) of two recordings on the 1992 Honda NSX-R by an 8-agent
workflow (2026-09-01/02). It fixes: the Upgrade Shop 3×2 root and its six names (Engine ·
Platform and Handling · Drivetrain · Tires and Rims · Aero and Appearance · Body Kits and
Conversions); every category grid's order; part-tile naming (`Stock/Sport/Race/Rally/Drift/Offroad
<part>`, `<Brand> - <Part>`); `CR 1,200` prices; INSTALLED/OWNED badges; the lime name bar
rgb(168,217,42); yellow `UNLOCKS …` banners; the five Y-toggle stats pages; the Tune strip
`TIRES | GEARING | ALIGNMENT | ANTIROLL BARS | SPRINGS | DAMPING | AERO | BRAKE | DIFFERENTIAL`;
three-column body; green panel headers carrying captions + unit chip (`PSI`, `LB/IN`, `IN`, `LB`);
magenta sliders; value precision (§5.5). §7 lists what is UNKNOWN — never invent it. §9.5: match
conversions by POSITION, tiers by NAME. §10 has proven grids (Tire Compound 11 tiles, Transmission
6, Differential 4, Platform and Handling 6, Engine 8/12 by aspiration).

**`scripts/telemetry/clone_parts.py`** (1,370 lines, 253a173) is the authority for how a slot's
full tile grid is named and ordered: names by tile count, Manifest ranks
(`data/car-option-lists.json`), Paint and Customize steps, dense size grids, the sparse global
ladder for tier slots vs per-car position lists for conversions.

**How to apply:** any surface that shows the shop or the tuning screen must be checked against
§5's ten rules before it ships; per-car option lists come from `scripts/db/export_options.py`
→ `api/options/<ordinal>.json` (built 2026-09-03). The daemon's deliverable menu names
("Engine & Power", "Conversions") are NOT the game's names. Screenshots the daemon watches:
`~/Pictures/Screenshots`, `~/Videos/Captures`, `~/Documents/ShareX/Screenshots`; the 758
frames themselves are not in the repo. See [[jett-port-perfected-surfaces]],
[[fh6-savefile-tune-decode]].

**Case that proved it (2026-09-03, commit 78ea532):** `SHOP_MENUS["Engine & Power"]` listed only
`intercooler` of the five-slot aspirator family for its whole life; the fix was read off the
UI-spec tab order, not guessed. When a menu row seems missing, diff SHOP_MENUS against the spec
before anything else.
