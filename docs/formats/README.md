# Binary format templates

Every binary format this project reads, documented as a **010 Editor binary template** (`.bt`).
*Started 2026-09-18.*

A `.bt` is executable documentation: open the file in 010 Editor, run the template, and the bytes
either parse or they don't. Prose describing a byte layout doesn't have to add up. A template does —
which is why writing these found four things the prose had missed (below).

**Visual:** the *FH6 Binary Source Formats* diagram maps all eight to the tables they feed —
https://app.eraser.io/workspace/EV5zhW3hPU6v4Z7PiZoW?diagram=PV6Xc_TbbQJN9EPKziNM
(same Eraser file as the *FH6 Lab Database ERD*, so the byte layouts and the schema sit side by side).

## The templates

| Template | Format | Where it comes from | Verified against |
| --- | --- | --- | --- |
| [`fh6_tune_data.bt`](fh6_tune_data.bt) | 598-byte saved tune `Data` | `Tuning_*/Data` (plaintext) | 1,526 saves |
| [`fh6_dataout_packet.bt`](fh6_dataout_packet.bt) | 324-byte *Data Out* UDP packet | the live telemetry stream | 4,356,598 frames |
| [`fh6_cryptocontainer.bt`](fh6_cryptocontainer.bt) | CryptoContainer envelope | `C_ProfileData`, `gamedbRC.slt` | 3 containers |
| [`fh6_route_owt.bt`](fh6_route_owt.bt) | `FTWO` route centre-line | `aitracks/Route<id>.owt` | 170 files |
| [`fh6_nav.bt`](fh6_nav.bt) | `WVAN` navigation chunks | `aitracks/Route<id>.nav` | 171 files |
| [`fh6_stringtable_str.bt`](fh6_stringtable_str.bt) | `.str` string table | `stringtables/EN.zip` | 290 tables |
| [`fh6_bxml.bt`](fh6_bxml.bt) | `BXML` binary XML | `ObjectModelGame.zip` | 7,121 entries |
| [`fh6_swatchbin.bt`](fh6_swatchbin.bt) | `burG` BC7 UI texture | `Upgrade_Parts.zip` | 902 entries |

**Not here, and deliberately so:**

- `race_triggers.tz` — **plaintext XML**, not binary (`<?xml version="1.0"` with a UTF-8 BOM). A `.bt`
  would be theatre.
- `FH6_Database.sqlite`, `data/fh6.db`, the embedded `Career_Garage` — **relational**. Their standard is
  `db/schema.sql` (executable) + [`../handoff-data-structures.md`](../handoff-data-structures.md) + the
  *FH6 Lab Database ERD*, proved by `scripts/tools/check_db_docs.py` the way these are proved by
  `check_bt_template.py`.
- `captures/*.csv.gz`, `data/**.json`, `dashboard/v2/api/` — **text**. Covered by
  [`../DATA-INVENTORY.md`](../DATA-INVENTORY.md).

A `.bt` is the right tool for a byte layout and the wrong tool for everything else. These eight are the
binary corpus; there is no ninth waiting.

## Keeping them true

`.bt` files have one real weakness: **nothing in this pipeline can run them.** 010 Editor is commercial,
so a template can rot silently — the exact failure that left `DATA-INVENTORY.md` claiming `corner_obs`
was empty while it held 17,560 rows.

So each template is checked by a script instead:

```bash
python scripts/tools/check_bt_template.py
```

It parses each `.bt`'s own field declarations, lays out the offsets itself, and checks them against
(a) the canonical Python/C# implementation and (b) every real file of that format on disk. It exits
non-zero on failure, so it can gate a commit. Run it after any game update — a title update is exactly
when a layout moves.

Current state: **8/8 OK**, covering 1,526 saves, 4.36M telemetry frames, 170 routes, 171 nav files,
290 string tables, 7,121 BXML entries and 902 textures.

The offset check is joined by a **deep structural walk** for the three variable-length formats, printed
as `DEEP:` lines:

| Format | What the walk proves | Result |
| --- | --- | --- |
| BXML | the full recursive node tree consumes the file | 7,121/7,121 land **exactly** on EOF |
| `.str` | every string in both tables resolves | 118,536 resolved, 0 unresolved; key sets match 290/290 |
| `.nav` | the two-ended layout closes | 171/171, overlap bounded 0–16 B |

A walk that lands exactly on EOF is the strongest statement available about a variable-length format.

**Kaitai Struct was evaluated for these and declined** — see [`kaitai-assessment.md`](kaitai-assessment.md).
Short version: BXML and `.str` would suit it well but no longer need it, and `.nav` *cannot* be expressed
correctly (no half-float type, and fields that overlap and must be reconstructed).

## Four things this exercise found

1. **A 10-byte block at `0x04` in the tune blob** that `fh6_tune_decode.py` skips and no document named.
   Constant `00 00 01 00 00 00 01 00 00 00` in 1,526/1,526 saves — meaning unknown, value invariant.
   The decoder isn't wrong to skip it, but it was an unnamed hole; now it's a recorded unknown.
2. **The `.owt` "version" field is `0x0200`, not `2`.** The reader's docstring said 2; the `u16` at
   `0x04` reads 512 on all 170 files — the same value `.nav` carries as a `u32`.
3. **Chunk size cannot be inferred from a CryptoContainer's size.** `gamedbRC.slt`'s payload divides
   evenly by *both* the 128 KB slot (121) and the 512 B slot (30,041). Only the first is right, and the
   MACs aren't verified on read, so the wrong guess yields 15 MB of silent noise.
4. **The `.nav` payload is laid out from both ends, and its regions overlap.** `node[]`/`spline[]` run
   forward from `0x90`; everything else is anchored to the payload end with each section taking
   `align16(size)`. The last `spline` record's trailing `(memberEnd, attrEnd)` pair *aliases*
   `memberNode[0..1]` and is never written — `fh6_nav.py` reconstructs it. Measured overlap across all
   171 files: 0 B on 79, 8 B on 89, 16 B on 3. Found by failing to reproduce the layout forward-only,
   and it is what rules Kaitai out for this format.

## House rules for writing one

- **Never name a field you have not decoded.** `Unknown0C[44]` is honest; a guessed name becomes a fact
  three documents later. Several templates here carry large explicit `Unknown` runs.
- **Account for every byte.** A template that doesn't close at the true file size is hiding something —
  that's how finding #1 happened.
- **Record the corpus.** "1,526/1,526" is a claim a later agent can re-run; "always" is not.
- **Cite the canonical implementation** in the header, and keep the `.bt` downstream of it. The code
  parses; the template documents.
