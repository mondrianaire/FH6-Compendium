---
name: fh6-checkout-consolidation
description: As of 2026-09-05 the lab branch claude/forza-eliminator-tips-db-c512c3 IS the project; master is a mirror kept equal by a post-commit hook (ff-only); the runtime and data stay in the worktree; scripts/lab_up.ps1 is the one way to start the stack; dead worktrees/branches pruned
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-06T00:18:30.744Z
---

Seven copies of the repo existed on 2026-09-05 and master sat 100 commits behind the lab
branch with zero unique commits. Consolidated that evening:

- Lab branch committed in three chunks (code dd78f9b, data a32d4bd, docs 6b08d48) and master
  fast-forwarded to it. `.git/hooks/post-commit` (shared by all worktrees, must stay executable)
  fast-forwards master after every commit on the lab branch when master's tracked tree is clean;
  it prints what it did. Master is a CODE MIRROR only: data, captures (21 GB) and the three
  services stay in the worktree (memory fh6-lab-runtime-layout).
- Master's dirty data (stale re-derivations, 2026-09-05's disposable sessions) was discarded; its
  untracked Aug-22 leftovers were parked in main/data/_superseded_by_worktree_20260905/ and
  captures/_disposable_20260905/ (reversible). Its raw Aug 21-28 captures were copied into the
  worktree and re-derived (see fh6-course-names-derived / commit a32d4bd).
- Removed worktrees confident-euclid-744bc4 and determined-wilson-666419 and branches
  funny-ritchie, determined-wilson, wmvp-exe-relaunches. Windows held the two folders open so
  the directories still exist on disk until a reboot (git no longer knows them).
- Still open, Jett's call: nostalgic-fermi-71f14e (5 uncommitted July v1 dashboard edits),
  enumerate-project-folders-56025f (an audit session's worktree, in use), the non-git
  ..\forza-horizon-6-tuning-premerge-backup-20260827, and pushing master to origin (auto-deploys
  the public FH6-Compendium Pages site, frozen at Aug 22).
- `scripts/lab_up.ps1` starts daemon (8765) -> dashboard (8000) -> rebuild (8001) from the
  checkout it lives in and prints /health's lab.root; the guard refuses master.

**Why:** Jett: "none of this seems to target the base issue of how many different branches
there are and that this is MILES ahead of main" -- symptoms (rogue daemon, drifted data) had
been treated while the structure that produced them stayed.

**How to apply:** commit on the lab branch with pathspecs; expect master to follow. If
`git rev-list --left-right --count master...HEAD` is not 0/0, the hook was skipped (dirty master
or not executable) -- run `git -C <main> merge --ff-only claude/forza-eliminator-tips-db-c512c3`.
Never create work in a new worktree of this repo without a reason that outlives the session.

**The failure this exists to prevent (2026-09-05):** a Claude session mis-homed in the poker
project's worktree started the daemon and a dashboard on 8643 from the MAIN checkout, so every
frame landed in master's stale `data/` and the lab's stores split. Guard now in code:
`scripts/lab_root.py require_lab_root()` exits 2 when the root hosts `.claude/worktrees/*`
(`FH6_ALLOW_MAIN=1` overrides); `/health` reports `lab: {root, branch}`; `scripts/lab_up.ps1` is the
ONE start command. Before starting the stack: `netstat -ano` for 8765/8643/9876 and list sessions;
a server whose `/v2/` 404s is serving master. Never kill the live daemon without asking -- it is
capturing the user's driving.

**The project is public:** GitHub `mondrianaire/FH6-Compendium`, Pages auto-deploys on push to
master, owner garage data behind an opt-in demo toggle. origin/master is at 2026-08-22; pushing
is Jett's decision (frozen as of 2026-09-06).
