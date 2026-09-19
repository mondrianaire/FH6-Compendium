# Handoff: checkout consolidation — promote the worktree, retire the orphans

**Date:** 2026-09-05
**Author:** session `enumerate-project-folders-56025f` (read-only audit; nothing was changed)
**Audience:** the main lab agent working in `.claude/worktrees/forza-eliminator-tips-db-c512c3`
**Status:** ANALYSIS COMPLETE — awaiting Jett's go/no-go before any step is executed
**Related memory:** `fh6-lab-runtime-layout`, `fh6-judge-against-the-course`, `fh6-shared-worktree-commit-race`, `fh6-rebuild-partial-rerun-order`, `fh6-rogue-main-checkout-daemon`

---

## 1. Decision requested

Seven copies of this codebase exist on disk. Jett asked whether to **merge everything back to
`master`** or **simply declare this worktree the main database**.

**Finding: it is neither, and the two halves have opposite answers.**

* The **code** should be fast-forwarded into `master`. That is not a merge — `master` has *zero*
  unique commits. It costs nothing and it stops `git log master` misrepresenting the project.
* The **data and runtime** should stay here. That is already doctrine (`fh6-lab-runtime-layout`).
* The divergent data in `master` should be **re-derived, not hand-merged.** See §4.

Net: promote this worktree to be the code trunk *as well as* the data home, rather than leaving
`master` as a stale mirror that a fresh clone would land on.

---

## 2. Situation: the seven copies

| # | Path | Branch | Head | Dirty | `data/` |
|---|---|---|---|---|---|
| 1 | `forza-horizon-6-tuning/` (main checkout) | `master` | `3ff4a7e` Sep 1 | 63 | 100 M · 67 courses · 194 sessions |
| 2 | `.claude/worktrees/forza-eliminator-tips-db-c512c3/` | `claude/forza-eliminator-tips-db-c512c3` | `b444d79` Sep 3 | 305 | **334 M · 74 courses · 363 sessions** |
| 3 | `.claude/worktrees/confident-euclid-744bc4/` | `claude/funny-ritchie-bc56d9` | `3ff4a7e` (= master) | clean | 110 M redundant |
| 4 | `.claude/worktrees/enumerate-project-folders-56025f/` | audit session (this one) | `3ff4a7e` | clean | 110 M copy |
| 5 | `.claude/worktrees/determined-wilson-666419/` | same name | `50da255` **Jul 11** | clean | empty |
| 6 | `.claude/worktrees/nostalgic-fermi-71f14e/` | same name | `ae7d69d` **Jul 10** | 5 modified | empty |
| 7 | `..\forza-horizon-6-tuning-premerge-backup-20260827\` | **not a git repo** | — | 75 files, 20 M | frozen Aug 27 |

Nothing forza-related exists elsewhere under `Projects\`. `Poker Tools` has no worktrees directory
(the old rogue-daemon home from `fh6-rogue-main-checkout-daemon` is gone). `.claude/.bak/` is empty.

**Disk:** this worktree is 22 GB, of which `captures/` is 21 GB (194 raw telemetry CSVs, untracked)
and `data/` only 334 M. See §7 for the retention defect behind that.

---

## 3. Evidence

### 3.1 Code — strictly one-directional

    git rev-list --left-right --count master...claude/forza-eliminator-tips-db-c512c3
    0       100

`master` contributes nothing. Diff `master -> this branch`, excluding data/captures:
**57 files, +21,024 / -87.** Including data: 101 files, +186,549 / -71,895. 85 files added,
**1 deleted** (`data/courses/-1700_-4450_31.json`, removed on purpose by the duplicate-key merge).

Subsystems that exist **only** here — a clone of `master` gets none of them:

* `dashboard/v2/` — the entire v2 UI (9 files)
* `scripts/db/` — the 15-module import/rebuild pipeline (`fh6db.py`, `import_gamedb.py`,
  `rebuild.py`, `build_web.py`, `export_options.py`, …)
* `scripts/telemetry/clone_parts.py` (1,534 lines), `fh6_swatchbin.py`, `fh6_nav.py`,
  `fh6_owt.py`, `fh6_turns.py`, `fh6_manifest.py`, `check_tune_clock.py`
* `docs/DATA-INVENTORY.md`, `docs/fh6-ui-spec.md`, the whole `docs/design-review/` packet
* `db/schema.sql`, `scripts/rebuild_service.py`

`git merge-tree` reports the trees merge cleanly — **no content conflict.**

### 3.2 Data — this worktree is authoritative nearly everywhere

Compared record-by-record, not by file size:

| Store | master | here | master-unique | verdict |
|---|---|---|---|---|
| `routes.json` → `routes` | 64 | 76 | 1 (the deliberately-deleted dup key) | 28 drifted: **richer here in 14, in master 0** |
| `pi-observations.json` | 59 | 86 | 8 raw, but 7 share a `parts_hash` with ours | **only 1 genuinely new** |
| `build-letters.json` → `letters` | 40 | 55 | 0 | superset here |
| `identity-evidence.json` → `gears` | 26 | 40 | 1 (`2866`) | superset here |

Representative route drift — master's record is structurally thinner, not merely older:

    master: {"start":[-1703,-4435], "length_m":6997, "events":1281, ...}
    here:   {"start":[-1703,-4435], "length_m":6997, "events":2005,
             "name":"Highway Circuit", "source":"dashboard 2026-09-02",
             "mode":null, "rivals":true}

Gear drift resolves the same way. Where the `cid` matches, we hold more evidence
(`1601`: gears 1–5 vs **1–9**; `412`: 1–9 vs **1–10**). Where `cid` differs, the two daemons simply
observed *different builds* of the same ordinal — the store is ordinal-keyed last-write-wins, so
those are not conflicting truths and must not be "reconciled".

### 3.3 What master genuinely holds that we do not

Only four things:

1. `data/sessions/fh6_20260905_144837.json` + `.tags.json` (227 KB, today 14:58)
2. `data/sessions/fh6_20260905_153843.json` + `.tags.json` (19 KB, today 15:39)
3. One `pi-observations` record — today 14:53, ordinal 1601, A/700, `parts_hash d6dc2e0a`
   (verified absent here by hash, not by count)
4. One `identity-evidence.gears` entry, ordinal `2866` → `{"cid":"2866|1|4|700","g":[1]}`

All four came from a daemon running out of the **main checkout** today. It is not running now —
nothing is listening on 8765 / 8000 / 8001. That daemon is the sole cause of every divergence in
this document.

### 3.4 The one contested course — why re-derivation, not merging

`data/courses/-4750_-1550.json` is the whole argument in one file:

| | master | here |
|---|---|---|
| `laps` | **9** | 8 |
| `sessions` / `visits` | **5** | 4 |
| `turn_count` | 13 | **39** |
| `turns` | 46 | **67** |
| `updated` | `fh6_20260905_144837` | `fh6_20260822_035921` |

Master has one extra lap because the rogue daemon drove it today. We have ~3x the turn detail
because we have the current detector. **Hand-merging this file means choosing between a lap and a
turn model** — precisely the failure shape `fh6-judge-against-the-course` names as this project's
most recurrent bug. Take the session file, re-derive the course.

### 3.5 The five orphan courses are dead, not lost

`-2350_-7800`, `-2550_-1050`, `-6700_-900`, `0_-4100`, `0_-4100_26` exist only in master.

* Aug-22 pre-worktree-split leftovers; untracked files do not follow a new worktree, which is why
  they never arrived here (this is what `data/_preserved_pre_worktree_20260822/` was preserving).
* **Not addressable by either pipeline** — absent from master's *and* our `routes.json`.
* Old schema: missing `geo_turns`, `speed_traces`, `turn_count_delta`. 54–92 KB against the
  current era's 376–704 KB.
* Their five source sessions **already exist here**, so they are re-derivable if wanted. The raw
  captures are gone (earliest surviving capture is `fh6_20260823_023501`).

Do not copy these files in. If the courses are wanted, rebuild them from the sessions.

---

## 4. Recommended plan

Steps 1–3 touch **only the main checkout**; they are safe to run while this worktree is busy.

### Step 1 — rescue the four uniques (do this first)

Copy the two session files here, then let the pipeline re-derive:

```bash
cp "C:/Users/mondr/Documents/Claude/Projects/forza-horizon-6-tuning/data/sessions/fh6_20260905_144837."*json "C:/Users/mondr/Documents/Claude/Projects/forza-horizon-6-tuning/.claude/worktrees/forza-eliminator-tips-db-c512c3/data/sessions/"
```

```bash
cp "C:/Users/mondr/Documents/Claude/Projects/forza-horizon-6-tuning/data/sessions/fh6_20260905_153843."*json "C:/Users/mondr/Documents/Claude/Projects/forza-horizon-6-tuning/.claude/worktrees/forza-eliminator-tips-db-c512c3/data/sessions/"
```

Then rebuild. Per `fh6-rebuild-partial-rerun-order`, `--only` reruns must follow stage order —
telemetry cascades `course_route` away until routes reruns, and routes clears `road_class` until
surface reruns. Verify with `import_run` + row counts afterwards.

Items 3 and 4 (the single pi-observation and the `2866` gears entry) should fall out of the same
re-derivation. **Verify they did** rather than assuming; if not, append them by hand — they are one
record each and both are listed verbatim in §3.3.

### Step 2 — clear the two fast-forward blockers in master

A ff-only merge fails today on exactly two locally-modified files:

    data/courses/-4750_-1550.json
    data/routes.json

Both are provably stale (§3.2, §3.4) **once step 1 has landed the lap they carry**. Discard them in
the main checkout only. Do not use bare `git stash` — see `fh6-shared-worktree-commit-race`; the
stash stack is shared across every worktree.

### Step 3 — fast-forward master

```bash
git -C "C:/Users/mondr/Documents/Claude/Projects/forza-horizon-6-tuning" merge --ff-only claude/forza-eliminator-tips-db-c512c3
```

Confirmed to report `Updating 3ff4a7e..b444d79` with no conflict. This also refreshes the static
files master serves on 8643.

### Step 4 — keep the runtime here

Unchanged from `fh6-lab-runtime-layout`. The daemon, the rebuild service (8001) and all accrued
`data/` stay in this worktree. Step 3 changes where the *code* lives, not where the lab runs.

### Step 5 — stop the fork from re-opening

The rogue main-checkout daemon created every divergence in §3. Confirm it is down and keep it down;
otherwise this document is obsolete within a day. Cross-reference `fh6-rogue-main-checkout-daemon`.

### Step 6 — retire the orphan checkouts (optional, low priority)

* `confident-euclid-744bc4` — at master's exact commit, clean, branch name (`funny-ritchie-bc56d9`)
  does not even match its folder. 110 M of redundancy. Remove.
* `determined-wilson-666419` — merged, dead since Jul 11. Remove.
* `nostalgic-fermi-71f14e` — merged, dead since Jul 10, **but holds 5 uncommitted July edits** to
  `dashboard/app.js|db.js|index.html|styles.css` and `data/meta-cars.json`. Diff before removing.
* `claude/wmvp-exe-relaunches-d289cf` — merged branch with no worktree. Prune.
* `..\forza-horizon-6-tuning-premerge-backup-20260827\` — the only copy unreachable from git.
  Needs a human decision, not an agent's.

---

## 5. Do NOT

* **Do not hand-merge course JSONs** between checkouts. Re-derive. (§3.4)
* **Do not copy the five orphan courses in.** Old schema, unregistered in any route registry. (§3.5)
* **Do not "reconcile" gear entries whose `cid` differs.** Those are different builds, not conflicts. (§3.2)
* **Do not `git clean`** in this worktree. Its 305 dirty entries include real untracked stores:
  `data/fh6.db`, `data/logs/`, `data/field-catalog.json`, `AgentDoc/`.
* **Do not use bare `git stash` / `git stash pop`** anywhere in this repo. (`fh6-shared-worktree-commit-race`)
* **Do not restart the daemon from the main checkout**, before or after step 3. (`fh6-lab-runtime-layout`)

---

## 6. Verification after execution

1. `git -C <main> log --oneline -1` → `b444d79`
2. `ls <main>/dashboard/v2/` → exists (proves the v2 UI reached master)
3. `git -C <main> status --porcelain` line count → materially below 63
4. `pi-observations.json` here contains `parts_hash d6dc2e0a`
5. `identity-evidence.json` → `gears["2866"]` is non-null here
6. `courses/-4750_-1550.json` here shows `laps >= 9` **and** `turn_count == 39` — the point of
   step 1 is to get both, not to trade one for the other
7. `scripts/telemetry/verify_workflow.py` (27-attribute harness) passes

---

## 7. Separate finding: capture retention is startup-only

Not part of the consolidation, but found during the disk audit and worth a ticket.

`_compress_old_captures()` — `scripts/telemetry/fh6_live_daemon.py:2318` — gzips capture CSVs older
than 3 days, but is launched as a **one-shot thread in `main()`**. Anything that ages past the
3-day line while the daemon is already running is never swept; it waits for the next restart.

Observed consequence: 7 of 16 Sep-2 captures are still raw while 9 are gzipped, and one **558 MB
Aug-28 CSV** sits uncompressed beside 27 gzipped same-day siblings, 8 days past threshold.

Compressing the eligible backlog (Sep 2 and older) recovers roughly 1.5–2 GB at the observed ~3:1
ratio. Sep 3–5 are correctly inside the retention window; ~12 GB of uncompressed working set is by
design at ~20 files x 193 MB/day. Suggested fix: run the sweep periodically rather than once at
startup.

---

## 8. Open questions for Jett

1. Should `master` be fast-forwarded (recommended), or should this branch be renamed to become the
   trunk outright? Either fixes the stale-trunk hazard; the fast-forward is less disruptive.
2. Keep or delete `..\forza-horizon-6-tuning-premerge-backup-20260827\`? It is 20 M and the only
   copy git cannot reconstruct.
3. Are `nostalgic-fermi`'s five uncommitted July dashboard edits worth rescuing before removal?
4. Are the five orphaned Aug-22 courses worth re-deriving from their surviving session files?

---

## Appendix — how to reproduce this audit

```bash
git rev-list --left-right --count master...claude/forza-eliminator-tips-db-c512c3
```

```bash
git diff --stat master..claude/forza-eliminator-tips-db-c512c3 -- ":(exclude)data/*" ":(exclude)captures/*"
```

```bash
git merge-tree --write-tree master claude/forza-eliminator-tips-db-c512c3
```

Data stores were compared by descending into the record collection
(`routes.json:routes`, `pi-observations.json:observations`, `build-letters.json:letters`,
`identity-evidence.json:gears`) and set-differencing the keys — **not** by comparing file sizes.
File size is misleading here: master's `dashboard/db.js` is 22 MB against our 14 MB, yet it is an
auto-generated artifact of a lesser dataset and carries no merge value at all.
