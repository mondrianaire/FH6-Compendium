---
name: fh6-menu-frames-are-dead-time
description: "Jett's correction — in-menu UDP telemetry is not a useful data window; rely on the disk re-scan on menu exit instead"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T14:16:42.223Z
---

Do not design dashboard/daemon behavior around the idea that "a menu is not dead time because
that's when sliders/parts change" — [[fh6-lab-runtime-layout]] and the live dashboard's own code
carried that rationale (dashboard/v2/live.js ~line 100-101), but Jett flagged it (2026-09-03) as
based on a misunderstanding of what data actually comes from which source.

**Why:** the UDP telemetry packet degrades in a menu — CarOrdinal, CarPI and position all drop to
0/absent (confirmed both in live.js's own comments ~line 114-122 and from re-reading the daemon).
Live frames during menu dwell carry no usable build/slider information; they cannot be "the window
we are watching" for a change, because they don't see the change. What actually catches a
menu-made edit is the SEPARATE disk/save-file re-read the daemon already performs on menu exit
(scripts/telemetry/fh6_live_daemon.py, "RE-READ THE TUNE EVERY TIME YOU COME OUT OF A MENU",
~line 296-301) — a 598-byte tune decode keyed off the menu-exit transition, not off live frames.

**How to apply:** it is safe to treat menu dwell time as dead time for the dashboard's live
moment-to-moment repainting (pause live updates while `on-track -> menu`, hold the display, and
resume on `menu -> on-track`) as long as the menu-exit rescan stays rigorous — keep/strengthen the
disk re-read on exit rather than trying to infer changes from in-menu frames. Menu entry and exit
are themselves meaningful events worth logging; the dwell time in between is not a live-data
window and repainting through it is what has been causing "losing context" during menu
transitions and fast travel. See [[fh6-daemon-ts-request-is-a-pick]] for the concrete feature this
fed into, once implemented.
