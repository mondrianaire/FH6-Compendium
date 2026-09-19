---
name: fh6-capture-session-protocol
description: "How Jett wants in-game capture sessions run: interactive one-screen-at-a-time loop, prove indices by saving a setup per tile (ownership is free, 71M CR), keep the ask near 15 shots not 50, and use the Y-toggle stats pages instead of separate screens."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-02T03:35:03.779Z
---

On 2026-09-01/02 Jett ran a full upgrade-shop walk of the 1992 NSX-R with me. What worked and what Jett corrected:

- **Interactive loop, not a batch list.** Jett asked for "menu items to click until I reach a screen with valuable information, then a screenshot"; I read the newest file in `C:\Users\mondr\Pictures\Screenshots` (or the pasted image), decide the next click, and keep one artifact page (same URL) as the running guide + log. Full-screen shots only: a crop with no lime name bar yields nothing.
- **Proof by save, not by tile position.** Jett: "ownership is inconsequential, upgrades are cheap, 71M CR." So for any menu whose index scheme is unproven: highlight tile, shot, Enter (basket), Setup Manager > save as `<abbr><tile>` (cmp2, trm3, dif4...), then I read the index straight out of the container. Menu order is NOT index order (compound tile 5 = index 10). Once a scheme is proven, names come from the base+tier catalogue rule and only one shot per family is needed.
- **Budget.** When I asked for ~48 engine shots Jett said "this is a LOT more than 15 screenshots." Trim to what closes a real gap: engine needed 7 shots and 0 saves. State the count before asking.
- **Y-toggle pages replace other screens.** Every upgrade menu carries 5 stats pages (Ratings, Power/Weight incl. mass + front %, Braking/Lateral G, Accel/Speed, Aero/Chassis) plus a Performance dyno panel in Engine menus; they preview the highlighted tile. Ask for the page, not a separate menu.
- **Rims are a weight class**, per Jett: only weight/PWR/PI differ; read the INSTALLED tile on the source car (cursor lands on it even when locked); no id->name survey.

**Why:** Jett's time in the game is the scarce resource; every ask must be minimal and every claim must be provable from the save file, which is free to read.

**How to apply:** open with the save-per-tile protocol only where a scheme is unproven, quote the shot count up front, and prefer stored-tune scans (which cars carry an unseen index) over asking Jett to visit menus. Related: [[fh6-data-capture-constraint]], [[fh6-judge-against-the-course]].
