---
name: jett-github-first-research
description: "Jett's rule (2026-09-02) — before reverse-engineering any game structure, search GitHub first; someone has usually already decoded it (this is how the decrypted FH6 game DB and ForzaTech Studio were found)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-02T09:29:54.106Z
---

Before reverse-engineering any Forza structure (binary formats, telemetry packets, database ids, string tables), search GitHub first with plain queries like "Forza Horizon 6 telemetry", "ForzaTech", "gamedb", and check the tools people built (D3FEKT/ForzaTechStudio converts .str/.carbin/.modelbin/.swatchbin; community DB dumps). Jett wants this as a standing step in my research procedure, not a one-off.

**Why:** Months of screenshot capture and byte-diffing were spent on things the community had already decoded. A single GitHub search on 2026-09-02 surfaced the decrypted FH6 gameplay database (every part id, name, rim, slider range) and the tool that exports the game's string tables. See [[fh6-raw-data-folder]].

**How to apply:** At the start of any RE or "how does the game encode X" task: (1) GitHub search (repos + code search) for the game name + the concept; (2) check ForzaTech Studio docs and the raw data folder before designing captures; (3) only then fall back to screenshots/telemetry. Report what the search found even when it is nothing. Related: [[fh6-data-capture-constraint]], [[fh6-sample-is-not-population]].
