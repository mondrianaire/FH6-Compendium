---
name: fh6-decrypt-landscape
description: "FH6 locked files (method-22 zips, sfsdata, gamedbRC.slt, PI.xml) = Arxan TransformIT white-box AES (CBC + MAC, 512 B or 128 KB blocks) + a CRC32 obfuscation on the GameDB; algorithm fully open-sourced (Doliman100 C++, Nenkai C#) but FH6's white-box TABLES exist only in DVS-code's hosted service and three researchers' hands; what each path costs and risks; the proven GameDB re-decrypt procedure (ForzaCryptoTool.exe decrypt gamedbRC.slt, 2026-09-13)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-13T04:07:12.289Z
---

**The cipher, settled (2026-09-05 research, GitHub-first):** every locked FH6 file is one wrapper:
16-byte IV, u32 padding_size, 16-byte header MAC, then blocks of 0x200 (File/ConfigFile/Profile/
Photo: hence method-22 zip entries at 36 + 528k bytes) or 0x20000 (GameDB, SFS = media/sfsdata)
encrypted bytes each followed by a 16-byte MAC. The cipher is Chow-style WHITE-BOX AES-256 in CBC:
17 rounds of 16 lookup tables x 256 x 4 bytes plus residual round-key words; the MAC is a 13-round
CMAC-like AES-128. Method 22 = TFIT-decrypt with the File key, then plain DEFLATE. gamedbRC.slt
adds a per-dword CRC32 XOR keystream (per-game seed + CRC table swap) on top. Two independent
open-source implementations agree: Doliman100/ForzaTech-crypto-tool (C++, FM6 Apex..FH5 v1.614)
and Nenkai/ForzaTools ForzaDecryptor (C#, FH5). Both ship WITHOUT key/table files (.gitignored
contexts/keys, contexts/tables). The "keys" are the dumped white-box tables, taken from the running
game's memory with x64dbg per the C++ author's own note; no FH6 tables are public anywhere.

**GameDB re-decrypt PROCEDURE (proven 2026-09-13; use after every game update that adds cars):**
1. Tool = DVS-code Forza Crypto Tool 3.1.0, `C:\Users\mondr\Downloads\ForzaCryptoTool.exe` (165,754,374 B, self-contained .NET; README in `Downloads\Forza-Crypto-Tool-main\`). It made both `gamedbRC_decrypted.sqlite` (2026-09-05 23:16) and the 09-13 decrypt. NOT CryptoTool v4.5 (no FH6 keys) and never the unknowncheats "FH6 Helper" exe.
2. Input = `C:\XboxGames\Forza Horizon 6\Content\media\stripped\gamedbRC.slt` (install is read-only; the tool only reads it). Its mtime/size moving (09-07: 15,861,684 B) = the decrypt is stale.
3. Jett runs it from cmd in Downloads — the SUBCOMMAND is required (bare path gives "unknown command"):
   `ForzaCryptoTool.exe decrypt "C:\XboxGames\Forza Horizon 6\Content\media\stripped\gamedbRC.slt" -o db.sqlite`
   Output: "Detected GameDB… Uploading… Job decrypted… GameDB decrypted to db.sqlite" — decryption is SERVER-SIDE (file is uploaded; exit 4 = backend offline). Game DB only; never upload profile/save files.
4. Verify read-only before use: 09-13 result `Downloads\db.sqlite` = 15,778,816 B, 207 tables (was 205), Data_Car 671 rows, max Id 4354, has 3429+4354, integrity_check ok (old decrypts: 660 cars, max 4342).
5. Keep the old `FH6_Database.sqlite` (rename with its date), drop the new one in as `Downloads\forza raw data files\FH6_Database.sqlite`, then run `scripts/db/rebuild.py` (full cascade, never a standalone stage — [[fh6-rebuild-cascade]]).

**Who has FH6:** DVS-code/Forza-Crypto-Tool (GPL-3 client, .NET 8; source on branch public-client)
decrypts FH6 method-22 zips (GameTunableSettings.zip, Camera.zip, Rules.zip named), gamedbRC.slt
(205 tables -- FH6_Database.sqlite is that output), config .ini and C_ProfileData -- but ONLY via a
hosted backend (/api/method22/decrypt, /api/jobs/upload ...): the client uploads the file and holds
no keys. Credits name DVS, xxd20xxx (GameDB + SFS crypto) and draff. No tool anywhere claims FH6
sfsdata support and nobody has published what GameTunableSettings.zip decrypts to.
D3FEKT/ForzaTechStudio lists FH6 formats but provides no keys. The unknowncheats "FH6 Helper" exe
in the raw folder is the probable origin of the local DB/CSV corpus -- never run it.

**Risk facts:** FH6 has no kernel anti-cheat, no EAC, no Denuvo; the Xbox-app exe is unreadable on
disk (observed) but MSIXVC contents are unencrypted at runtime for a licensed user, and the Steam
build is a plain depot. The enforcement that IS real: Playground's franchise-wide/hardware bans
for the May 2026 pre-release leak (the "new encryption" complaint on Doliman100 issue #4 came
from that torrent, not retail). Decrypting one's own installed data offline touches none of that;
uploading to a third-party service is a trust decision, and debugger-dumping the tables from the
live process is expert RE with an unknown account-side reaction.

**Outcome (2026-09-05 23:00):** Jett ran DVS-code's client on GameTunableSettings.zip -- it decrypted cleanly (122 plain files), but the catalogue was not there (EventNames.xml = engine event names; AI/AITimes.xml = 53 AI time tables, 39 for route ids not in this game). The catalogue was in the never-encrypted ObjectModelGame.zip all along ([[fh6-objectmodel-catalogue]]). sfsdata (75 MB) is classified Unknown by the client and remains undecrypted and, now, unneeded.

**Provenance settled (audit session, 2026-09-05):** FH6_Database.sqlite is byte-for-byte the decrypted gamedbRC.slt (205 tables, zero differing) -- the game DB was never the place; its only route-bearing columns are the empty NewProfile_* tables and Tracks.Route = 0. The local CryptoTool v4.5 in Downloads holds real key/table files for FH3-FH5 only; no FH6 context anywhere in it. docs/fh6-encryption-methods-survey-2026-09-05.md is the long form.

**Paths:** (A) DVS-code service on ONE small file first (GameTunableSettings.zip -> EventNames.xml,
track_properties.xml, TrackMetrics.xml) -- minutes, Jett runs it, I never download/execute/upload;
(B) obtain FH6 table files from the community (ResHax is the live forum; XeNTaX/ZenHAX archives
are unreachable) and add an FH6 context to Doliman's tool -- days, uncertain; (C) dump tables
ourselves -- weeks, not recommended; (D) no decryption: recordings + anchors, names only for
driven courses. See [[fh6-route-anchors]] for why the event catalogue is the prize.

**Taxonomy corrected (supersedes the 2026-09-03 three-bucket note):** there are TWO mechanisms,
not three -- encrypted (loose files and method-22 zip entries alike, same TransformIT wrapper;
"method 22 is compression" was wrong) and proprietary-but-decoded (game DB, Grub/burG bundles,
.owt/.nav, BXML). Still true from that note: ForzaTech Studio (D3FEKT) converts .str/.carbin/
.modelbin/.swatchbin and produced the raw folder's CSVs; save Livery containers' `C_livery`
payload is plain zlib (8-byte header + DEFLATE) and nothing reads it yet; `Rules.zip` holds the
Eliminator rulebot files (irrelevant: [[fh6-not-eliminator]]). True ciphertext with no local
bypass: physics/PI.xml, PhysicsSettings.ini, surfaceTypes.xml, the 159 suspension XMLs,
NerdData.json, sfsdata, most save containers outside Tuning/Livery.
