# Can we decrypt `C_ProfileData` ourselves? — investigation

Today every read of the profile save ([`docs/format-c-profiledata.md`](format-c-profiledata.md)) goes
through DVS-code's **ForzaCryptoTool**, which uploads the save to a third-party backend. This asks what
it would take to do it locally instead.

*Opened 2026-09-18. Claims are tagged ✅ verified (checked directly against the source/API named),
🟡 probable, ❌ speculation. This supersedes the "no FH6 key material exists anywhere" conclusion of
`docs/fh6-encryption-methods-survey-2026-09-05.md` §8–9.*

## 1. Which tool version are we on?

**We are on 3.1.0; the current release is v3.2.** ✅ Our `C:\Users\mondr\Downloads\ForzaCryptoTool.exe`
(saved 2026-09-13) reports `Forza Crypto Tool 3.1.0 (release)`. It is the FH6-specific v3 line, so the
profile decrypt works — it decrypted this machine's save today, 820,548 B → 3,610,427 B, validated.

v3.2 adds an Asset Browser, per-entry `plain`/`encrypted`/`locked` status, and byte-exact archive
repacking. Upgrading is optional for us (we use `decrypt` only), but one line in its README matters to
this investigation: a `locked` entry is *"Method 22 whose per-page IVs aren't available"*. ✅

## 2. The headline finding: the scheme is not white-box AES

The 2026-09-05 survey concluded FH6 needed Arxan TransformIT **white-box** AES tables (17 rounds × 16
tables × 256 × 4 B) dumped from the running game, and that no FH6 tables existed publicly. For the profile
save and the game DB, **that is not the scheme in use**.

A public repo — `HTTPJXRDN/FH6-Local-Crypto-Car-Editor-Tool` — implements FH6 `C_ProfileData` and
`gamedbRC.slt` crypto **entirely locally, with no network calls**, and its source spells the algorithm out.
✅ Verified directly against the GitHub API: created 2026-09-10, last push 2026-09-17, four releases
(`FH6CryptoV1.0.0` → `V1.1.2`), 1 star, 0 forks, **no license file**.

From `GameDb.cs` (quoted from source): ✅

- Layout `[16-byte IV0][4-byte header][16-byte nonce]`, then N slots of `(131072 data bytes + 16 MAC bytes)`.
- Each data slot is **AES-256-CBC/NoPadding**.
- `NextIv(iv) = HKDF-SHA256(secret=iv, salt=TransportKey1, info=TransportKey2)` — re-derived after *every*
  block, data and MAC alike.
- **"Because each IV depends only on the previous IV (not on any data), the whole IV chain is
  deterministic from IV0."**
- Re-encrypt reuses the original file's 36-byte header/IV0 as a template.

From `ProfileData.cs`: the profile is `CryptoContainer → u32 compressedSize + u32 expectedSize → zlib →
payload`. ✅ So the 3.6 MB blob we enumerate is the **post-zlib** payload, and the container itself uses
the same `ForzaZip.DecryptContainer(..., Fh6Keys.Get("ProfileData").DataKey)` primitive.

**What this means.** Local decryption needs no white-box tables, no debugger, and no live server. It needs
exactly: a `DataKey` and `MacKey` per file type (`ProfileData`, `GameDB`, …), plus the two constants
`TransportKey1` / `TransportKey2`. Everything else is standard, well-specified primitives already in
.NET and Python.

## 3. What is still missing — and it is only the key bytes

`Fh6Keys` is **referenced** by `GameDb.cs`, `ProfileData.cs`, `ForzaZip.cs` and `Scramble.cs` but
**defined nowhere in the repository**. ✅ The `.csproj` resolves it from a binary that is not in the tree:

```xml
<Reference Include="FH6LocalCrypto.Runtime">
  <HintPath>lib\FH6LocalCrypto.Runtime.dll</HintPath>
</Reference>
```

So that project publishes the **algorithm** as source and keeps the **key material** compiled-only, shipped
inside its release `.exe`. We therefore have a complete specification and no keys. 🟡 The repo credits
"Draff — original Botan-based cryptography work", the same handle DVS-code credits for FH6 research, which
is consistent with both tools deriving from one extraction.

**The per-page IV problem does not apply to us.** ✅ DVS-code's `locked` category covers Method-22 *asset
archives*, where later IVs depend on cipher-internal state not recoverable from the file. The profile and
game DB use the deterministic IV chain quoted above — which is precisely why a purely local tool can do
those two formats and not the locked archives.

## 4. Acquisition paths

| Path | Cost | Risk | Verdict |
| --- | --- | --- | --- |
| **(a) Use the community tool's released `.exe`** | zero | Runs an unaudited binary against your save; 1-star week-old repo, no license, keys in a compiled DLL | ❌ Not as-is — see §5 |
| **(b) Obtain the two key values through a channel we trust, implement the scheme ourselves** | low — the algorithm is published and short | Trust of whoever supplies the bytes | ✅ The realistic path |
| **(c) Dump from the running game with a debugger** | high skill | Attaching to the live game is a different risk class, and the project's own rule is never to run the game binaries from here | ❌ Not worth it |
| **(d) Extract keys from either tool's compiled binary** | moderate | Circumventing a distributor's deliberate choice to withhold keys; DVS-code's client holds none at all, so this means attacking the other project's DLL | ❌ Out of scope |
| **(e) DCA / BGE attacks on white-box AES** | weeks | — | ❌ Moot: this is not white-box AES (§2) |

## 5. Recommendation

**Do not change anything today. Keep using ForzaCryptoTool 3.1.0 with explicit approval per decrypt.**
It works, it is the devil we know, and the only cost is that a copy of the save goes to a third-party
backend on each run — which the current code already gates behind `approved=True`.

**Do not run the community tool's executable against a live save.** It is a week-old, single-author,
unlicensed binary whose crypto keys are deliberately not in its source, and it also *writes* saves. Reading
its source is free; executing it is a trust decision with save-corruption and account consequences that we
have no reason to take on right now.

**The cheapest next step if we ever want local decryption** is narrow: obtain the `ProfileData` `DataKey` /
`MacKey` and the two `TransportKey` constants from a source we are willing to trust, then implement §2 in
~60 lines of Python (`cryptography` gives AES-CBC, HKDF-SHA256 and CMAC). Everything else — the container
framing, the zlib layer, the section parsing — we already have in `scripts/telemetry/fh6_profile.py` and
`docs/format-c-profiledata.md`. That reframes the task from "defeat white-box AES" to "hold two 32-byte
constants", which is a completely different order of problem than the 2026-09-05 survey assumed.

**What local decryption would buy us**, to weigh against that: the profile becomes a first-class lab store
instead of an approval-gated, network-dependent, occasionally-offline (`exit 4 = backend offline`) one.
That is the difference between "the daemon can settle identity on equip whenever it likes" and "only when a
human clicks and the backend answers".

## 6. Checked and found nothing

- `Doliman100/ForzaTech-crypto-tool` — no FH6 anywhere in README, issues or releases. ✅ Unchanged.
- `Nenkai/ForzaTools` `ForzaDecryptor` — documents FH5 only, ships no keys. ✅
- `DVS-code/Forza-Crypto-Tool` `public-client` — key-free by design; config resolves only a backend URL and
  API key (env var → DPAPI-protected file → obfuscated default). No crypto keys in the client. ✅
- `D3FEKT/ForzaTechStudio` — not re-checked this pass; treat as unknown, not as a lead.

## 7. Standing rules this investigation does not touch

Read-only, single-player, own-machine data throughout. No key material was requested, downloaded or
reproduced here — only public source and README text was read. Nothing here targets Playground or
Microsoft services; DVS-code's backend was described only from its own documentation and never probed.
