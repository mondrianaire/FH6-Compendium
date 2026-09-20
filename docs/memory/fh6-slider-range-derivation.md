---
name: fh6-slider-range-derivation
description: SOLVED 2026-09-02 — every FH6 slider's min/max/default comes from the game database's physics rows; the mass/formula/telemetry derivations and the =? capture are obsolete
metadata:
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-02T10:21:10.555Z
---

**Solved.** A tune container stores each slider as a 0..1 float; the physical value is `v = Min + s*(Max-Min)`, and Min/Max/Def come from the fitted part's physics row in the game's own database ([[fh6-raw-data-folder]]):

- springs, ride height, bump, rebound, and the camber/toe/caster **defaults**: `List_SpringDamperPhysics`, reached via `List_UpgradeSpringDamper.Front/RearSpringDamperPhysicsID`
- anti-roll bars: `List_AntiSwayPhysics` via `List_UpgradeAntiSwayFront/Rear`
- aero: `List_AeroPhysics` (Downforce0/1, DefaultTuneSlider) via the front bumper's and rear wing's AeroPhysicsID
- brakes: `List_UpgradeBrakes` (BrakeTorqueSlider, BrakeBiasSlider); differential: the limited-slip columns; gearing: `FinalDriveRatio` + GearRatio0..N; tire pressure: `List_UpgradeTireCompound.Front/RearTirePressure`

A fresh install writes `s = clamp((Def-Min)/(Max-Min), 0, 1)`. **When Max == Min the slider is locked**: install writes 0.5 and the value is Min whatever s says (0 exceptions in 575 containers). Adjustability is decided by `Max > Min`, never by IsStock. Three bands are hard-coded, not in the DB: camber `v = -5 + 10s` deg, front caster `v = 1 + 6s`, toe `v = -5 + 10s` (probable). `rear_caster` is not a reliable kit fingerprint — 15 of 527 downloaded tunes contradict it.

**Why the old entry was wrong, and the lesson.** This memory used to hold a six-agent research verdict that derived spring rates from mass, back-solved gears from telemetry, and required reading ride height and downforce off the screen per car — with "extract from game files" **rejected** on the grounds that `gamedbRC.slt` is Arxan-encrypted and cracking it would take weeks. The rejection was sound about that one file and wrong about the goal: the community had already published a decrypted copy of the same database, and one GitHub search found it. A path assessed as too hard should be re-checked for whether someone else already walked it before it is written off. See [[jett-github-first-research]].

Now materialized as columns in our own database, not computed at read time: `ref_part_slider(slot, part_id, slider, def_value, min_value, max_value, def_norm, locked)` and `tune_slider(container, slider, norm, value, unit, min_value, max_value, locked, is_install_default)`. Related: [[fh6-savefile-tune-decode]], [[fh6-tuning-lane-split]].

**Open check (Jett, 2026-09-03 evening):** a front spring decoded to 228 lb/in on a build
"extremely close to cloning the og" while the in-game slider floors at 367 lb/in (probable car:
2012 Lamborghini Gallardo LP570-4 Spyder Performante). Under the DB-row model that means a wrong
spring-kit band or a different kit on the locked tune -- unresolved.
