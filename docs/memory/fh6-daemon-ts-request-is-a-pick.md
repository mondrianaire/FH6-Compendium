---
name: fh6-daemon-ts-request-is-a-pick
description: "Any corroborated /disk-tune?ts= request is stored by the daemon as that car's pick for 2 h — verification probes with an old ts silently repoint the live pick; end every probe on the newest save"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T06:53:19.071Z
---

The live daemon treats `/disk-tune?ordinal=N&ts=T` as a DECLARATION, not a read: when the live
car corroborates the save (`picked_ok`), it stores `ST.picked_id[N] = {ts: T}` for two hours
and writes it to `data/identity-evidence.json`. Every later `/disk-tune?ordinal=N` (including
the dashboard's `reread()`) then returns save T, until a fresh save for that car lands (the
watcher pops the pick on a new file). There is no clearing endpoint.

**Why:** on 2026-09-03 a verification probe fetched the Zenvo's older save by `ts` and the
dashboard began serving the 02:36 file instead of the 02:47 one the car was wearing; it looked
like the dashboard had missed the new save.

**How to apply:** never end a probe on an old `ts`; if an old save must be read, follow it with
a `ts=` request for the newest file so the stored pick is the true one. Prefer reading old saves
through the DB (`tune_container`) or the parser directly, not through the daemon. See
[[fh6-judge-against-the-course]] (the daemon's own identity standard), [[fh6-lab-runtime-layout]].
