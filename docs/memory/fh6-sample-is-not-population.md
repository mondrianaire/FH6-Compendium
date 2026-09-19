---
name: fh6-sample-is-not-population
description: "Never generalise \"this source is encrypted/unavailable\" from a sample; sweep the whole population first. Two sampled files called the FH6 install encrypted; the sweep found 8,807 of 8,830 zips readable, including the game's own ID→name string tables."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-02T10:21:20.022Z
---

On 2026-09-01 I told Jett the FH6 game install was encrypted, on the strength of two files I happened to open (`NerdData.json`, `physics/PI.xml`). When Jett asked how we could be confident there were no other unencrypted sources, a full sweep of all 16,020 files under `Content` showed 8,807 of 8,830 `.zip` archives are plain Deflate and 2,638 of 2,802 `.xml` are plain — including `media/stripped/stringtables/EN.zip`, the 288-table localisation set that turned out to be the missing part-ID→name layer (`Upgrades.str` is the numbered part catalogue). The two files I sampled were in a small encrypted pocket.

**Why:** a negative claim about a *population* ("nothing readable here") cannot be earned from a *sample*; it needs an exhaustive pass classified by signature and entropy. The cost of the wrong generalisation was days of building name tables by screen capture that the game ships in plain text.

**How to apply:** before saying a data source is closed, enumerate it completely (walk, classify by magic bytes + entropy, count readable vs opaque) and report the counts. Treat "I opened two files" as a lead, never a verdict. Same family as [[fh6-judge-against-the-course]] — judging from the sample instead of the accumulated model.

**Third instance, 2026-09-02 — generalising a ladder from one car.** The differential ladder in `part-names.json` was proven on the NSX-R and recorded as global: index 5 Drift, 6 Offroad, 7 probably Rally. The game database says the opposite for almost everything: index 5 = Rally, 6 = Drift, 7 = Offroad on 640-plus of 644 drivetrain sets. **Exactly two sets deviate — 2102 and 2170 — and 2102 is the NSX-R's AWD swap set**, the one car we proved it on. Every ladder proven on a single car is a sample; check it against the population before writing it as a rule. The same pass found 23 of 25 engine-swap donor names wrong and 12 of 41 by-eye rim verdicts wrong.
