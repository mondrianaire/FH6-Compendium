# Handoff — session state, 2026-09-06

Branch `claude/forza-eliminator-tips-db-c512c3` = `master` at `bf57213`. Working tree clean of
tracked changes. Full 16-stage rebuild in 41 s, `--check` PASSED, 55 tests green, dashboard api
regenerated. Runtime (daemon 8765, dashboard 8000, rebuild service 8001) runs from this worktree via
`scripts/lab_up.ps1`.

## Settled — read, do not redo

| topic | where it lives |
|---|---|
| course id → geometry → common name (the game's catalogue in `ObjectModelGame.zip`) | `docs/course-identity-and-names.md`, stages `objectmodel` / `route_names` tier game |
| race-activation spheres as corroboration, majority rule, `anchored` keeps `route_id` NULL | `scripts/telemetry/fh6_anchors.py`, `import_course_match.apply_anchors` |
| road class as a discipline key in the map tier | `import_route_names._surface_ok` |
| `.owt` files are section graphs (route 132 = The Colossus) | `fh6_owt.py`, `tests/test_owt_sections.py`, commit `3650571` |
| decryption not needed for names; `FH6_Database.sqlite` == decrypted `gamedbRC.slt` | `docs/fh6-encryption-methods-survey-2026-09-05.md` §9–10 |
| checkout consolidation; master is a ff mirror via the post-commit hook | `docs/handoff-checkout-consolidation-2026-09-05.md` |

Live numbers: 18 of 76 courses named (all by the game), 101 of 169 routes named, 88 of 88 Rivals
names bound to one route, 0 ties, 0 conflicts. Three informational warnings: routes 2041 and 2071
read ~1.5× their event length (section shape, parser), and course `-4750_-1550` has one race start
in route 5041's sphere.

## Open, in priority order

1. **Build Sheet overflow** — 5,289 px of content in an 819 px pane, no scrollbars. Jett's oldest
   open ask this week.
2. **A/B slider diff for the `variation` status** — plan exists (`diffSliderRows`, `vdot`, threaded
   through `sliderRow` / `tuneTabs` / `abOverlay` in `dashboard/v2/live.js`); nothing built.
3. **Routes 2041 / 2071 section parse** and the `-4750_-1550` anchor disagreement.
4. **`ref_car_restriction` on the tuning side** — every event's class, PI, power, weight and year
   bounds are now rows; nothing reads them yet.
5. **Optional recordings** (Cross Country, Street Scene, Drag) — displayed length only, per
   `docs/rivals-routes-capture.md`.
6. Older backlog: upgrade-gating research, data-failure fingerprint system, free-mode tabs, corpus
   empty-slot states, dashboard title area and rating band.

## Decisions Jett made this week (not to be re-litigated)

- Origin push stays frozen. Three locked worktree folders clear on reboot.
- Workflow and subagents default to Sonnet unless Jett authorises otherwise.
- The typed word is the final word for a course name; derivations are evidence rows.
- Never suggest Eliminator; never suggest a WOT pull for gear ratios.
