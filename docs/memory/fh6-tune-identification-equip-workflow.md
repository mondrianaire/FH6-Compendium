---
name: fh6-tune-identification-equip-workflow
description: "HARD WORKFLOW 2026-09-11 — CLONING is solid (keep as-is); TUNE identification is the shaky part. Guaranteed fix: equip via Find build→equip build; in-game My Tuning Setup, the tune tile with the GREY MINUS PI badge is the current tune, and equipping this way fully decodes it."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-11T17:43:00.625Z
---

Jett's ruling on identification (2026-09-11), correcting an earlier over-broad "shelved" note:

- **CLONING is perfect — keep it exactly as is.** Do not touch or downgrade the clone / A-B /
  variation surfaces. The part that is shaky is **TUNE identification** (knowing which saved tune is
  the one currently on the car), not cloning.

- **The GUARANTEED tune-identification workflow** (equipping this way GUARANTEES the daemon's savefile
  decoder can fully decode the tune — see [[fh6-savefile-tune-decode]]):
  1. Find build → **equip build** → Start
  2. Buy used and new cars → travel to festival site
  3. Cars tab → Upgrades and Tuning → **My Tuning Setup**
  4. In that tune list, **the tile whose PI badge shows a GREY MINUS ( – ) is the current tune.**
     The other tiles show a **red down-arrow ( ▼ )** (a tune that would change PI from current) — those
     are NOT the equipped one. The green outline is only the cursor, not the current tune. (Measured
     example: a row of A700 / A700 / R901 / R953 / S1 795 / S2 868 — the grey-minus sat on R953, the
     equipped tune, while the cursor highlighted the first A700.)

- **THE BUILD PICKER IS RETIRED (Jett 2026-09-11, later the same day):** "we are not using this method of
  picking builds, we are only using the save tune method." v2's signature-tie picker ("N builds share this
  car's cylinders, drivetrain and PI … Pick below and it stays picked", tiles A–E with "daemon's pick") no longer
  renders; the header's unsettled state says "equip the build, then save the tune in-game". Never re-add a
  pick-from-ties UI or a "drive the gears to separate them" prompt as the identification path. (Pins set from
  other build surfaces still exist; only the tie picker went.)

- **Why it matters:** auto-identifying the current tune from telemetry/disk alone was never 100%
  without user action; this equip-then-read path is the reliable one. The grey-minus badge is the
  in-game confirmation of which tune is live; equipping through it writes the tune to disk in the fully
  decodable form. Reverse identity (hw_hash + tune_hash to tell two in-hand builds apart) still stands
  for what it does — see [[fh6-identity-two-directions]], [[fh6-daemon-ts-request-is-a-pick]].
