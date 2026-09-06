# Capturing a Rivals › Routes screen (one recording per discipline)

**What it feeds:** `data/rivals-routes-<discipline>.json` → stage `events` → `ref_event.length_m`
→ stage `route_names`. The Route Length on this screen is the only length key the game gives for a
Rivals route; without it a course on that road can only ever carry a typed name.

**Status:** Road Racing done (2026-09-01, 23 routes). Not yet recorded: **Dirt Racing, Cross
Country, Street Scene, Drag Racing** (65 routes between them, all already in `ref_event` name-only).

## In game (about 3 minutes per discipline)

1. Horizon Rivals › pick the discipline › **Routes**. The screen shows one selected route in the
   hero panel (big name, `Route Length: X.X MI` under it, its description under **Details** on the
   right) and the thumbnail strip along the bottom.
2. Start a screen recording (ShareX is fine; 2560×1440 is what the transcriber expects, other
   sizes are scaled).
3. Starting from the **first** tile, press right **once per second or slower**, so every route sits
   selected for at least one full second. Do not skip tiles; do not go back. Stop after the last
   tile has been selected for a second.
4. Stop the recording. One file per discipline.

That is the whole capture. Nothing per car, nothing repeated — it is a global list, the kind of
one-off menu capture the data-capture rule allows.

## Transcribe

```bash
python scripts/telemetry/transcribe_rivals_routes.py "<recording>.mp4" --discipline "Dirt Racing"
```

- Frames at 1 fps; three fixed regions read with EasyOCR (hero name, length line, Details text).
- **Every name is a checked join**: it must equal one of the 88 `RivalsEventData` strings already in
  `data/fh6.db`, or sit within a small edit distance of exactly one (then the game's spelling is
  written and the correction is listed). A name that resolves to nothing is listed under
  `transcription.unresolved` and the file is still written — scroll-transition frames land there
  and are harmless; a real route there means a hand edit of one line.
- Descriptions are matched the same way against the game's `IDS_Description` strings
  (`RivalsEventData` and `CareerTrackInfo` — Edamame's on-screen text exists only in the latter).
- The 7 `ids_name_guids` per route come from `ref_string`, not from the screen.
- Validated 2026-09-05 against the original Road Racing recording: 23/23 names, 0 corrections,
  every length and the screen order identical to the hand-made file; the only unresolved frames
  were the menu screens before Routes opened.

Exit code 0 = clean; 1 = something to look at (`transcription` block in the JSON says what).

## Then

```bash
python scripts/db/rebuild.py --only events        # cascades to route_names
python scripts/db/rebuild.py --check
```

The new discipline's routes get lengths in `ref_event`; any driven course whose map identity and
lap length agree with one of them is named on the next `route_names` run, with the evidence in
`course_event`. Commit the JSON with a pathspec.

## Do NOT

- Do not type route names or lengths by hand into `routes.json` or the database — record the
  screen, let the join check the spelling.
- Do not record faster than one tile per second: a route that is never on screen for a full
  second has no clean frame and will show up as unresolved.
