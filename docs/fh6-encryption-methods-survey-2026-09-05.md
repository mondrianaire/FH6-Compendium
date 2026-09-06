# FH6 encrypted files — cipher identification and every known way in, 2026-09-05

Covers `sfsdata`, `stripped/gamedbRC.slt`, `physics/{PI.xml, PhysicsSettings.ini, surfaceTypes.xml}`,
the 159 current-gen suspension XMLs, and the 936 "method 22" entries in `Rules.zip`,
`GameTunableSettings.zip`, `stateflow.zip`, `Camera.zip`, `ProfileSchema.zip`.

**Result: one cipher, one family, and exactly one publicly working FH6 path — which uploads your
files to a third party.**

---

## 1. The container, measured

Local analysis first, so the tool claims below can be checked against something.

```
[ 36-byte header ][ chunk 0: 528 B ][ chunk 1: 528 B ] … [ chunk k-1: 528 B ]
   16-byte IV
   u32  = valid plaintext bytes in the FINAL chunk
```

| test | result |
|---|---|
| `(size − 36) % 528 == 0` | **159/159** suspension XMLs, `PI.xml`, `PhysicsSettings.ini`, `surfaceTypes.xml`, `NerdData.json`. `gamedbRC.slt` and `sfsdata` carry a partial final chunk |
| `(size − 20) % 16 == 0` | **164/164** loose files, **936/936** method-22 zip entries |
| `u32` at offset 16, across 159 files | min **1**, max **510**, mean 241 — uniform in [1, 511], i.e. mod 512. Not random; it is the final chunk's valid-byte count |
| repeated 16-byte blocks | **0** across 4,694,590 blocks in `sfsdata` → not ECB; per-file IV |
| entropy, chunk-leading 16 B / trailing 16 B / middle | **7.9981 / 7.9985 / 8.0000** over 7,583 chunks of `surfaceTypes.xml` |
| byte offsets near-constant across chunks | **0 of 528** |

So each chunk is **512 bytes of plaintext + 16 bytes of overhead**, and that 16-byte field is
indistinguishable from random — an authentication tag or per-chunk IV, not a compression header. A
compression format would leave *some* structured field; there is not one byte position in 528 that
holds still.

**Decompression was tried, not assumed.** zlib, raw-deflate, gzip, bz2, lzma (auto/alone/xz) at
offsets 0/4/16/20/36/52 against both `PI.xml` and a raw `Eliminator.rulebot.xml` entry: **zero real
successes** (one 1-byte raw-deflate stub, which accepts almost anything).

**This closes the census's "method 22 = non-standard compression" reading for good.** It is
encryption in a zip wrapper.

## 2. The cipher, named

Both independent tool projects identify it the same way, and it matches the structure above:

> **Arxan TransformIT (GuardIT)** — with "zip method 22" called out explicitly.

Arxan is a whitebox crypto product: the key is embedded in the executable in obfuscated form
specifically so that static extraction is hard. That is the reason no public tool ships FH6 keys, and
the reason the one FH6-capable tool keeps its key on a server.

## 3. Every known tool, and its actual state

| tool | scope | FH6? | keys | runs where |
|---|---|---|---|---|
| **[Doliman100/ForzaTech-crypto-tool](https://github.com/Doliman100/ForzaTech-crypto-tool)** | exactly our file set — `media\sfsdata`, `media\Stripped\gamedbRC.slt`, `.zip`/`.xml`/`.ini`, Profile, Photo, Dynamic (custom routes), CMS. Auto-detects title/key by MAC verification | **No** — FM6 Apex → FH5 (≤ v1.614.70.0) | **not in the repo** (README points at a XeNTaX thread) | local |
| **[Nenkai/ForzaTools](https://github.com/Nenkai/ForzaTools)** | `ForzaDecryptor` for FH5 TransformIT zips/files/gamedb, plus BinaryXML, PlaygroundMiniZip, Bundle reader | **No** — FH4/FH5 | **"Keys are not currently included in this repository"**; reference implementation | local |
| **[DVS-code/Forza-Crypto-Tool](https://github.com/DVS-code/Forza-Crypto-Tool)** | method-22 assets, `.slt` GameDB, `.ini` config, `C_ProfileData` saves | **Yes — v3.1 is FH6-only** (FH3–FH5 supported in v2, not yet ported) | **none held locally** | **server-side: "it identifies files, uploads them, polls the job, and writes the result"** |
| **[D3FEKT/ForzaTechStudio](https://github.com/D3FEKT/ForzaTechStudio)** (already in the corpus) | `.str`, `.carbin`, `.modelbin`, `.swatchbin`, zip viewer/builder | n/a | **no crypto at all** | local |

On the last row — I checked the shipped assembly rather than taking the README's word. `ForzaTech
Studio.dll` contains `XCompression`, `OodleCompression`, `OodleLZ_Decompress`, `XMemDecompress`,
`TryNativeDecompress` — a *decompression* stack. The three `Aes` hits are coincidental byte fragments
inside unrelated identifiers, not a crypto class. Its docs list the methods it understands as
"Store, Deflate, **Method 21**" — note **21**, not 22. It cannot open any file in this survey.

The `importer/importer/FM3_FH1/sfs.bt` template already in the corpus is likewise not a way in: it is
`SecureFileSystem::CDigestRegistry`, BigEndian, seeking fixed offsets in an extracted Xbox 360
`default.xex`, and it parses an integrity manifest rather than contents.

## 4. The one thing that would make the local path work

The two local tools have the right architecture and the right file coverage. They stop at FH5 because
**they lack FH6 keys** — keys are per-title, and Doliman100's MAC-verification step is a lookup
against a per-title key table that has no FH6 entry.

So the local route reduces to a single blocker: an FH6 TransformIT key set. The fact that the only
FH6-capable tool deliberately keeps its key server-side is strong evidence that none is public.

## 5. Before uploading anything — a 2 KB test that costs nothing

If the DVS tool is used at all, the first file to hand it should be **`physics/PI.xml`, 2,148 bytes**:

- it is already proven ciphertext, so a readable-XML result proves the service genuinely works
- it is 2 KB rather than 75 MB
- it is a physics constants table, not personal data
- if it fails, nothing larger will work and no meaningful data left the machine

Only after that passes is there a case for `gamedbRC.slt` (15.6 MB) or `GameTunableSettings.zip`
(1.85 MB, which contains `ANNARecommendations.xml` — the game's own recommendation-engine config).

## 6. Things worth weighing, stated plainly rather than decided here

- **Uploading is irreversible.** Assume anything sent is retained and may be logged, regardless of
  later deletion. `sfsdata` is 75 MB of game content; that is the user's call, and it is a real one.
- **Never upload the profile/save files.** The DVS tool supports `C_ProfileData` and advertises
  "save swapping between accounts". The save containers carry the XUID and gamertag — that is
  personal data, and it is also the file class most associated with account enforcement. Restrict any
  use to non-personal game asset files.
- **There is a ToS/account dimension**, which is presumably why the leak-ban coverage came up. Forza
  has enforced against account holders over leaked/modified content. Decrypting local files for
  personal analysis is a different activity from distributing content, but a third-party service that
  also does save swapping is not a neutral counterparty. This is a risk to weigh, not a technical
  obstacle.
- **The project's own rule — never run the corpus executables — applies to any new tool too.** If one
  is run, it should be a deliberate exception with a named reason, not a drift.

## 7. What this changes for the naming problem

Nothing about the route-identification work, which needs no decryption:
`race_triggers.tz` is plaintext and gives 36/36 verified `ref_route` ids.

For **naming**, decryption remains the only path that would name all 88 Rivals routes and the career
events at once — the catalogue is in `sfsdata` or `gamedbRC.slt` if it is anywhere. The alternative
remains the three remaining discipline recordings, which are free, local, carry no account risk, and
are already specified in `docs/rivals-routes-capture.md`.

Given that the only FH6 decryption path currently routes through someone else's server, **the
recordings are the cheaper and lower-risk option today**, and the decryption route is worth revisiting
if and when an FH6 key set becomes available to the local tools.

---

Sources: [Doliman100/ForzaTech-crypto-tool](https://github.com/Doliman100/ForzaTech-crypto-tool) ·
[DVS-code/Forza-Crypto-Tool](https://github.com/DVS-code/Forza-Crypto-Tool) ·
[Nenkai/ForzaTools](https://github.com/Nenkai/ForzaTools) ·
[D3FEKT/ForzaTechStudio](https://github.com/D3FEKT/ForzaTechStudio)

---

## 8. CryptoTool v4.5 (local build, `Downloads\CryptoTool_v4.5`) — verified

This build **does** carry the key material the GitHub repo withholds:

- `CryptoTool/contexts/keys/` — `fh3`, `fh3dev`, `fh4`, `fh5`, `fh5_v1.614.70.0`,
  `fh5_v1.619.349.0`, `fm6apex`, `fm7` (17–41 KB each)
- `CryptoTool/contexts/tables/` — `fh3`, `fh4`, `fh5`, `fm6apex`, `fm7` (~1.6 MB each)

So the "no keys" blocker is closed — **for those titles only**.

**FH6 is absent from both the source and the compiled binary:**

| check | result |
|---|---|
| `contexts.h` `GameType` enum | `FH5_v1_619_349_0, FH5_v1_614_70_0, FH5, FH4, FM7, FH3Dev, FH3, FM6Apex` — **no FH6** |
| `keys/` and `tables/` directories | no `fh6.*` file of any kind |
| `CryptoTool.exe` (3,573,760 B), literal `FH6` | **0 occurrences** |
| `CryptoTool.exe`, literal `Horizon 6` | **0 occurrences** |
| game strings actually present in the binary | Forza Motorsport 6: Apex · Forza Horizon 3 · FH3 v1.0.37.2 "OpusDev" · Forza Horizon 4 · Forza Motorsport 7 · Forza Horizon 5 · FH5 v1.614.70.0 · FH5 v1.619.349.0 |

The binary's own help example is `...\Forza Horizon 5\media\Physics\PI.xml" -o"PI.xml"` — the exact
file class we are targeting, but for FH5.

The 0-byte `sfsdata` in the folder root is consistent with a run that produced no output, which is
what a MAC-verification failure looks like when no key set matches the input.

**Conclusion: v4.5 closes the key gap for FH3–FH5 and changes nothing for FH6.** The tool is
complete and correct for the titles it covers; FH6 tables simply do not exist in it.

`contexts.h` carries a partial author's note describing how the existing tables were lifted from a
running game with a debugger. That is the gap-closing method, and it means defeating the game's
anti-tamper at runtime rather than reading a file — a different activity from everything else in this
survey, with account and legal exposure attached. Noted here so the option is understood, not as a
recommendation or a procedure.

---

## 9. `gamedbRC_decrypted.sqlite` appeared — what it is, and what it settles

A decrypted `gamedbRC.slt` landed in the raw corpus (15,582,208 B vs the encrypted 15,599,508 B —
the 17 KB difference is the container overhead, not content). It is a genuine SQLite 3 file,
205 tables, 189 non-empty.

**It is content-identical to `FH6_Database.sqlite`.** Compared table-by-table on row count and a
content hash of every row: **205 tables on both sides, zero differing, zero unique to either.**

Three things follow.

### 9.1 The lost provenance is answered

The census recorded that `FH6_Database.sqlite` "was found via a GitHub search, not decrypted
in-house… the citation is lost", and flagged `gamedbRC.slt` as "distinct from the GitHub-sourced
decrypted copy, **not** a decryption of this file."

That last claim is now disproved. `FH6_Database.sqlite` **is** the decrypted `gamedbRC.slt`, proven by
exact content match against a decryption of this machine's own install. Whoever published it ran the
same decryption. The census entry should be corrected.

### 9.2 Decrypting the game DB yields nothing new

The project has held 100% of this content since 2026-09-02. Every finding built on
`FH6_Database.sqlite` — the 30/30 row counts, the twelve unimported enum tables, the upgrade-wizard
and physics-profile tables — stands unchanged, and none of it needed decrypting.

### 9.3 The event catalogue is definitively not in the game DB

Checked against the authoritative decrypted source rather than a third-party copy:

| table | rows |
|---|---|
| `NewProfile_CareerRaces` (`CustomRoute`, `RouteContainerName`, `CustomRouteP2P`) | **0** |
| `NewProfile_CareerRaceCollections` | **0** |
| `NewProfile_CareerRacesInCollection` | **0** |
| `Tracks.Route`, distinct values | **`0`** — the only other route-bearing column in all 205 tables |

Those four are the *only* route-referencing columns in the entire database. Audit finding 4's
conclusion is now proven from the primary source: the event definition layer is not in the game DB,
and no amount of decrypting it will produce one.

### 9.4 What this redirects to

The decryption route is **demonstrated working** — that is the real news. It just points at the wrong
file. The remaining encrypted container that could plausibly hold the event catalogue is
**`media\sfsdata`, 75,113,460 bytes** — "SFS" being Secure File System, i.e. plausibly a packed
container of many files rather than one dataset.

That is now the single highest-value decryption target, and the only one left whose contents are
genuinely unknown. `GameTunableSettings.zip` (1.85 MB, holds `ANNARecommendations.xml`) is a distant
second.

Everything else in this survey is unchanged, including that route *identification* via
`race_triggers.tz` needs no decryption at all.

---

## 10. Resolution (main agent, 2026-09-05 late): the catalogue was never encrypted

Section 9.4's target was wrong by one archive. `GameTunableSettings.zip` was decrypted through
DVS-code's client the same night and held no catalogue (`EventNames.xml` is engine event names).
The event catalogue is in **`media/ObjectModelGame.zip`** — plain Deflate, ~7,000 BXML documents
with numeric names — as `TrackInfoDataSet` (route id beside the CareerTrackInfo name GUID),
`RaceCollectionDataSet`, `CareerRaceDataSet`, `RivalsEventDataMap` and `CarRestrictionMap`.
Rivals event → collection → career race → track → route resolves 88 of 88 names. See
`docs/course-identity-and-names.md`. `sfsdata` remains undecrypted and is no longer needed for
names. Sections 8 and 9 stand: the local CryptoTool v4.5 carries FH3–FH5 keys only, and
`FH6_Database.sqlite` is proven to be the decrypted `gamedbRC.slt`.
