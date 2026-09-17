---
name: fh6-shared-worktree-commit-race
description: "Several Claude sessions commit concurrently in the forza-eliminator-tips-db-c512c3 worktree; add+commit races and sweeps the other session's staged files"
metadata: 
  node_type: memory
  type: project
  originSessionId: 46142379-5ffd-46b3-89ca-d7f2966d32cd
  modified: 2026-09-02T04:48:03.597Z
---

The live lab worktree (`.claude/worktrees/forza-eliminator-tips-db-c512c3`, see [[fh6-lab-runtime-layout]]) is shared by two or more interactive Claude sessions at once, and they all commit to the same branch through the same index. On 2026-09-02 a `git add <4 files> && git commit` from one session lost the race: a peer session committed 14 s earlier and its commit (bd4697c) swept the four staged files in with its own two; the second commit then found nothing to commit. Fixed by a soft reset and a two-commit split (8c8991c + 5c0a37c, identical tree).

**Why:** the index is per-worktree, not per-session, so anything staged by anyone is committed by whoever runs `git commit` next.

**How to apply:** in that worktree commit with an explicit pathspec (`git commit -- <paths> -m ...`) rather than add-then-commit, and check `git diff --cached --name-only` immediately before committing; if the set contains files you did not touch, stop and look. Never stage the live data files or `clone_parts.py` that the other sessions keep modified. If a sweep does happen, the branch is local and unpushed, so a soft-reset split is safe; message the peer sessions (ListAgents shows them) with the new SHAs.
