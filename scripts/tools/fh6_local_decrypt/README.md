# `fh6_local_decrypt` — offline, read-only FH6 decryption

Decrypts `C_ProfileData` and `gamedbRC.slt` **locally**. Nothing is uploaded, no backend is involved, and
it runs unattended — which is what the lab needs: `ForzaCryptoTool` uploads every file to a hosted service,
so each read was a network round trip, a third-party trust decision, and an approval prompt.

**Decrypt-only by construction.** There is no encrypt, no save-swap and no editor here, so this tool
*cannot* write a game file and cannot corrupt a save. It also refuses any output path under `C:\XboxGames`.

## Validated (2026-09-18)

| Check | Result |
| --- | --- |
| `gamedbRC.slt` (15,861,684 B) vs the ForzaCryptoTool output of the same file | **byte-identical**, SHA-256 `c609fe02…ec7e` |
| `C_ProfileData` (820,548 B) | inflates to **3,610,427 B** — the exact size ForzaCryptoTool produces |
| ForzaCryptoTool's own `profile-inspect`, run on **our** output | 714 properties · 5,548 BXML nodes · 112 binary records · SQLite `ok` · `lossless read: yes` · correct XUID |
| `scripts/telemetry/fh6_profile.py` on our output | 815 `Career_Garage` instances parsed |
| Repeat runs | deterministic, identical bytes |
| Speed | profile 0.25 s, GameDB 0.21 s |

## Build

Needs the .NET 8 SDK and the third-party key assembly `FH6LocalCrypto.Runtime.dll` — a 10 KB managed
assembly holding only the crypto constants. **It is not in this repository** (third-party and unlicensed),
and `.gitignore` here makes sure it never gets committed.

```powershell
# point at your copy (or drop the DLL next to this project)
$env:FH6_KEY_RUNTIME = "C:\Users\mondr\Downloads\FH6-Local-Crypto-Car-Editor-Tool-main\FH6-Local-Crypto-Car-Editor-Tool-main\lib\FH6LocalCrypto.Runtime.dll"
dotnet build scripts/tools/fh6_local_decrypt/fh6_local_decrypt.csproj -c Release
```

The build fails with a readable message if the DLL is missing. The default path is the location above, so
on this machine no env var is needed.

## Use

```bash
fh6_local_decrypt <input> -o <output> [--type auto|profile|gamedb] [--force] [--quiet]
```

```powershell
# profile save — copy it out first; C:\XboxGames is read-only
copy "C:\XboxGames\GameSave\pgs\u_*\137\ContainersRoot\User_*\C_ProfileData" $env:TEMP\p.enc
fh6_local_decrypt $env:TEMP\p.enc -o $env:TEMP\profile.bin

# game database, after a title update
fh6_local_decrypt "C:\XboxGames\Forza Horizon 6\Content\media\stripped\gamedbRC.slt" -o db.sqlite
```

Type is detected from the name (`C_Profile*` → profile, `*.slt` → gamedb) and, failing that, from the slot
geometry. Exit codes: `0` ok · `1` failed · `2` bad usage · `3` not found · `5` unsupported type.

## How it works

Both formats are a **CryptoContainer**: `[16-byte IV0][4-byte header][16-byte nonce]`, then N slots of
`(chunk + 16-byte MAC)` — chunk 512 for profiles, 131,072 for the GameDB. Every chunk is AES-256-CBC with
no padding, and the IV advances after *every* block, data and MAC alike, via
`HKDF-SHA256(secret=IV, salt=TransportKey1, info=TransportKey2)`. Because each IV depends only on the
previous one and never on the data, the whole chain is reproducible from IV0 — which is why this needs no
server and no white-box tables, unlike the Method-22 asset archives.

After the container:

- **Profile** — `[u32 compressedSize][u32 inflatedSize]`, then zlib. The inflated size is checked.
- **GameDB** — a self-inverse CRC32 keystream (the game peels it off in its SQLite VFS), then the image is
  trimmed to the header's own `page_size × page_count`, discarding the container's chunk padding. That trim
  is what makes the output byte-identical to ForzaCryptoTool's.

The crypto here is a fresh implementation of the published format (standard .NET primitives); only the key
assembly is third-party. Format details: `docs/format-c-profiledata.md` and
`docs/fh6-profile-crypto-mimicry.md`.

## Caveats

- **The keys are not ours.** If a title update rotates them, this tool stops working until the constants
  are refreshed — untested so far. Today's keys decrypt the post-2026-09-07 build of both file types.
- **MACs are not verified** on read. Fine for decrypt-only; anything that ever writes would have to care.
- Keep the plaintext out of the repo: it contains the account XUID and the whole career.
