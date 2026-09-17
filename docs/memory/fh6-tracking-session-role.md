---
name: fh6-tracking-session-role
description: The project-tracking-feature-769139 worktree/session is READ-ONLY by Jett's charter — it tracks progression across axes and never edits project files
metadata:
  type: project
---

Jett opened the session in worktree `.claude/worktrees/project-tracking-feature-769139`
(branch `claude/project-tracking-feature-769139`) on 2026-09-06 as a standing
**progress-tracking instrument**: it reads, understands and analyses project files across
multiple axes, and **makes no project changes directly** — no edits, no commits to project
files, no runtime mutation.

**Why:** the tracker has to be able to observe the project without being part of it; a session
that both measures and changes the thing it measures cannot be trusted as a baseline, and the
lab worktree is shared (see [[fh6-shared-worktree-commit-race]]).

**How to apply:** in this session, produce reports/artifacts, not patches. Writes are limited to
scratchpad and tracker output. If a fix is warranted, name it and hand it off — spawn a task or
tell Jett — rather than applying it. Live runtime stores are NOT in this worktree; the lab
worktree owns them (see [[fh6-lab-runtime-layout]]), so read across paths and say which checkout
a number came from.
