# Dashboard design review — the packet

Everything a designer needs to judge the FH6 lab dashboard without running it.

## The telos (the project's own words)

> create a utility that utilizes ALL possible data (telemetry, decrypted, raw files, etc.) to create a
> platform to store, use and analyze car upgrades and car tuning data and utilize this data availability
> to both provide insightful, data backed recommendations with a full testing architecture to record,
> analyze and compare tuning variations (a/b) AND to provide a data rich but focused environment to learn
> about forza car mechanics, tuning values and various upgrades and how they impact driving.

## The hard constraints (non-negotiable, from the owner)

1. **The dashboard has ZERO scrollbars.** All real estate is planned; a list that cannot fit says
   "+N more — not shown, the cell is full".
2. **Vertical space is a budget.** A band keeps its height only while it carries something: the trace
   collapses 240px→34px with nothing to draw, the dock 216px→96px when not driving, alerts 96px→26px
   when there is nothing to act on.
3. **The screen is a 4K monitor in PORTRAIT at 200% — a 1080 × 1751 CSS-px viewport.** Judge it there.
4. **The design language is the game's own**: square blocks, not pills; the in-game PI badge with its
   class tile art; the game's own render of the tuned car; uppercase condensed labels; the lime name bar.
5. **Presentation is allocated by DIFFICULTY, not by data.** The state's own answer takes the largest
   type; exactly one step and one control are offered; a field earns a slot only in the states where it
   changes what the user does next.
6. **Never render a number or a claim without where it came from and how sure it is.**

## What to review

| File | What it is |
|---|---|
| `screens/` | full-page captures at 1080×1751, and the header alone, per state |
| `dashboard-states.md` | the contract: regions, modes, the six build states, what each must show |
| `fh6-ui-spec.md` | the in-game Upgrade & Tune UI transcribed from 758 frames — the design language's source |
| `v1-lessons-audit.md` | 40 ranked regressions from the previous dashboard, with fixes |
| `DATA-INVENTORY.md` | every store the project holds — what could be shown that is not |
| `src/` | the panel's source: panel.js (regions + header), live.js (identity + sheet), styles.css |

## The question for the reviewer

Does this surface serve the telos — a data-rich but FOCUSED environment that produces backed
recommendations and supports A/B testing — or does it merely display everything it has? Name what to
cut, what to promote, and what the layout should be at 1080 × 1751, in pixels.
