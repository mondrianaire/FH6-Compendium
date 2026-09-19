---
name: fh6-spec-rivals-events
description: "Some Rivals events are SPEC: the car + tune are fixed by the event and TEMPORARY (not owned) — so 'no save on disk' is expected and tuning advice is moot there"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-11T10:58:45.770Z
---

Some FH6 Rivals events are **spec events**: the event supplies a fixed car AND a fixed tune (like a one-make spec series), and they are **temporary** — the car isn't in the player's garage and reverts after the event. Confirmed by Jett for the W1 event (session fh6_20260911_053056, route `-6350_-3750`): the car read as **ordinal 4118, "X 918 PI, RWD," uncatalogued, no save on disk** — that is the CORRECT, expected state for a spec/temp car, NOT an identity failure.

Implications:
- The dashboard's `#hdr` / identity showing "NOTHING ON DISK · NOT SAVED — NOTHING CAN BE COMPARED" for such a car is a false alarm. A spec/temporary-car event should be recognised and that warning suppressed (identity is "spec car, provided by the event").
- **Tuning advice is moot** in a spec event — you cannot change the car's setup. So detector/rule fixes (e.g. "accel diff lock down") are not actionable; the useful analysis is **driving** (line, throttle patience, brake points), not tuning. The W1 crash (rear grip loss escalating into a low-speed slide, launch wheelspin) is therefore a driving problem to be corrected by technique, not a setup to change.
- An uncatalogued high-PI car with no save, in a timed-solo Rivals event, is a good heuristic signal for "spec/temporary".

See [[fh6-course-mode-redesign-reenact]] (the inline identity bar / #hdr that shows this state), [[fh6-tuning-lane-split]], [[jett-tuning-workflow]].
