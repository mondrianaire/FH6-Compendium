---
name: jett-workflow-agents-default-sonnet
description: "HARD RULE (Jett, 2026-09-05): every agent spawned by a Workflow script defaults to the Sonnet model (opts.model 'sonnet'); a different model only with a specific reason AND the user's authorization"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-05T23:33:42.968Z
---

Every `agent(...)` call in a Workflow script passes `model: 'sonnet'` unless Jett has authorized
a different model for that specific stage. Same for `Agent` tool subagents.

**Why:** 2026-09-05 two workflows (78 + 11 agents, ~5.7M subagent tokens) ran on the session's
default model and hit the session limit mid-run -- 62 verify/judge/critic agents failed, leaving
the reader stages done and the verification stages empty. Jett's standing instruction: "any
agents spawned for workflows should AUTOMATICALLY default to SONNET model unless there is a
specific reason and is authorized by the user."

**How to apply:** in every workflow script set a `const MODEL = 'sonnet'` and pass
`{ ..., model: MODEL }` on each agent(); if a stage genuinely needs a stronger model (a final
judge over a wide design space, say), ask first and name the reason. Never silently upgrade.
