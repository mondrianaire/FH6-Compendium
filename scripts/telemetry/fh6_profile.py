"""FH6 profile-save (C_ProfileData) decode primitive.

The game profile save is the authoritative source the lab otherwise reverse-engineers by hand:
  * the CURRENTLY-EQUIPPED tune of the current car  -> identify-on-equip (settles signature ties)
  * an embedded SQLite `Career_Garage` (every owned car INSTANCE: full decoded build + tune + stats
    + equipped tune/livery + a stable per-instance Guid)  -> the decoded build/tune corpus (scaffolded)

C_ProfileData is encrypted. Two decrypt paths, in this order:

  1. LOCAL (default) -- `scripts/tools/fh6_local_decrypt`, our own implementation of the published
     container format (AES-256-CBC + a deterministic HKDF-SHA256 IV chain + zlib). Nothing leaves the
     machine, so it needs NO approval and can run unattended on every menu-exit. Validated byte-identical
     against the tool below; see that project's README and docs/fh6-profile-crypto-mimicry.md.
  2. FALLBACK -- DVS-code's ForzaCryptoTool, which UPLOADS the save to a hosted backend. Per Jett's
     privacy rule the daemon never uploads silently, so this path still refuses unless the caller passes
     approved=True (set only on an explicit user click).

C:\\XboxGames is read-only -- always decrypt a COPY, never the original.

This module is READ-ONLY w.r.t. the game: it locates, copies, decrypts and parses. It never writes into
the save tree and never runs any game .exe.

See [[fh6-equipped-tune-in-profiledata]] for the reverse-engineering behind current_equipped()/read_garage().
"""
import os
import re
import sys
import shutil
import sqlite3
import subprocess
import tempfile

try:
    import fh6_tune_decode as TUNE  # reuse the containers-root locator
except Exception:  # pragma: no cover - the daemon imports this the same way
    TUNE = None

# DVS-code Forza Crypto Tool 3.1.0 (self-contained .NET). Server-assisted decrypt (uploads the file).
FORZACRYPTO = os.environ.get("FORZACRYPTO_EXE", r"C:\Users\mondr\Downloads\ForzaCryptoTool.exe")

# Our offline decryptor: scripts/tools/fh6_local_decrypt (decrypt-only, no upload, no approval needed).
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOCAL_DECRYPT = os.environ.get("FH6_LOCAL_DECRYPT") or os.path.join(
    _REPO, "scripts", "tools", "fh6_local_decrypt", "bin", "Release", "net8.0", "fh6_local_decrypt.exe")


def local_decrypt_available():
    """True when the offline decryptor is built -- i.e. no upload is needed for a profile read."""
    return os.path.exists(LOCAL_DECRYPT)


# --------------------------------------------------------------------------- locate
def find_profile_path(containers_root=None):
    """Return the path to the live C_ProfileData, or None. Reuses the tune decoder's root locator."""
    root = containers_root
    if root is None and TUNE is not None:
        root = TUNE.find_containers_root()
    if not root:
        return None
    import glob
    hits = glob.glob(os.path.join(root, "User_*", "C_ProfileData"))
    # exclude the *_Backup sibling dir; prefer the newest by mtime
    hits = [p for p in hits if "_Backup" not in os.path.dirname(p)]
    if not hits:
        return None
    return max(hits, key=os.path.getmtime)


def profile_mtime(containers_root=None):
    p = find_profile_path(containers_root)
    return os.path.getmtime(p) if p else None


# --------------------------------------------------------------------------- decrypt (upload!)
class UploadNotApproved(Exception):
    pass


def decrypt(src, out_path, *, approved=False, timeout=120, prefer_local=True):
    """Decrypt a COPY of the encrypted profile -> out_path. Returns out_path.

    Tries the LOCAL decryptor first (offline, no approval needed, ~0.25 s). Falls back to
    ForzaCryptoTool only when the local tool is absent or fails -- and that path UPLOADS the save, so it
    still requires approved=True.

    Raises UploadNotApproved (local tool unavailable and no approval for the upload path),
    FileNotFoundError, or subprocess.CalledProcessError/TimeoutExpired.
    """
    if not os.path.exists(src):
        raise FileNotFoundError(src)
    # never hand either tool the original under C:\XboxGames -- copy to a temp first
    tmp = os.path.join(tempfile.gettempdir(), "fh6_C_ProfileData.enc")
    shutil.copy2(src, tmp)

    if prefer_local and local_decrypt_available():
        r = subprocess.run([LOCAL_DECRYPT, tmp, "-o", out_path, "--type", "profile", "--force", "--quiet"],
                           capture_output=True, text=True, timeout=timeout)
        if r.returncode == 0:
            return out_path
        # fall through to the upload path, but say why the offline one failed
        local_err = (r.stderr or r.stdout or "").strip()
    else:
        local_err = "offline decryptor not built (scripts/tools/fh6_local_decrypt)"

    if not approved:
        raise UploadNotApproved(
            "offline decrypt unavailable (%s); the ForzaCryptoTool fallback uploads the save to a "
            "third-party backend and needs explicit approval" % local_err)
    if not os.path.exists(FORZACRYPTO):
        raise FileNotFoundError(FORZACRYPTO)
    r = subprocess.run([FORZACRYPTO, "decrypt", tmp, "-o", out_path, "-y", "-f"],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise subprocess.CalledProcessError(r.returncode, r.args, r.stdout, r.stderr)
    return out_path


def load_live(*, approved=False, containers_root=None, timeout=120):
    """Locate, copy and decrypt the LIVE profile; return its plaintext bytes (or None if not found).

    The whole daemon-side read in one call. Offline by default, so this is safe to run on every
    menu-exit without asking anyone.
    """
    src = find_profile_path(containers_root)
    if not src:
        return None
    out = os.path.join(tempfile.gettempdir(), "fh6_profile_dec.bin")
    decrypt(src, out, approved=approved, timeout=timeout)
    with open(out, "rb") as f:
        return f.read()


# --------------------------------------------------------------------------- interned string table
def _interned_table(dec, anchor=b"CurrentCarState"):
    """Yield (offset, bytes) for each [u16 len][bytes] entry of the profile's interned string table.

    Anchors on a stable property name and walks back to the chain start, then parses forward. The table
    holds property names AND the live-referenced string values (incl. the CURRENT car's equipped
    Tuning_/Livery_ container names); non-current instances' tunes live only in the SQLite/binary section.
    """
    u16 = lambda o: int.from_bytes(dec[o:o + 2], "little")
    a = dec.find(anchor)
    if a < 0:
        return
    # walk back to a valid chain start (entries end exactly at the next entry's length prefix)
    start = a - 2
    while start > 2:
        good = None
        for L in range(1, 82):
            c = start - 2 - L
            if c < 0:
                break
            if u16(c) == L and c + 2 + L == start and all(32 <= b < 127 for b in dec[c + 2:c + 2 + L]):
                good = c
        if good is None:
            break
        start = good
    off = start
    while off + 2 <= len(dec):
        ln = u16(off)
        if ln == 0 or ln > 8192:
            break
        yield off, dec[off + 2:off + 2 + ln]
        off += 2 + ln


_RE_TUNE = re.compile(rb"Tuning_(\d+)_(\d+)$")
_RE_LIV = re.compile(rb"(?:SoulBound|Base)?Livery_(\d+)_(\d+)$")


def current_equipped(dec):
    """Return {'ordinal', 'tune', 'tune_ts', 'livery', 'livery_ts'} for the CURRENT car, or None.

    The profile interns exactly the current car's equipped container names; the lone real
    `Tuning_<ord>_<ts>` in the interned table is the equipped tune, and its <ord> is the current car.
    Absent (returns None) when there is no current-car/tune context (e.g. saved from a menu) -- callers
    must cross-check the ordinal against live telemetry and fall back to the existing tie logic.
    """
    tune = tune_ts = ordn = liv = liv_ts = None
    for _off, s in _interned_table(dec):
        m = _RE_TUNE.match(s)
        if m:
            tune = s.decode(); ordn = int(m.group(1)); tune_ts = m.group(2).decode()
            continue
        m = _RE_LIV.match(s)
        if m:
            liv = s.decode(); liv_ts = m.group(2).decode()
    if not tune:
        return None
    return {"ordinal": ordn, "tune": tune, "tune_ts": tune_ts, "livery": liv, "livery_ts": liv_ts}


# --------------------------------------------------------------------------- embedded career SQLite
def extract_career_db(dec, out_path):
    """Carve the embedded SQLite career DB out of a decrypted profile to out_path. Returns out_path or None.

    The DB header's page_count is 0, so it must be opened by file size; carving magic->EOF works because
    sqlite tolerates the trailing bytes when the header page-count is 0 (verified: 9 tables incl.
    Career_Garage). Kept deliberately simple; the importer (scaffolded) will own robustness.
    """
    i = dec.find(b"SQLite format 3\x00")
    if i < 0:
        return None
    with open(out_path, "wb") as f:
        f.write(dec[i:])
    return out_path


def read_garage(dec):
    """Return a list of Career_Garage rows (dicts) from a decrypted profile, or [].

    Each row = one owned car INSTANCE: CarId (ordinal), Guid (instance UUID), TuneFileName/LiveryFileName
    (equipped), PerformanceIndex/ClassID, every part column, every Tuning_* slider column, and usage stats.
    This is the corpus source for the (scaffolded) garage_* ingest.
    """
    tmp = os.path.join(tempfile.gettempdir(), "fh6_career.db")
    if not extract_career_db(dec, tmp):
        return []
    con = sqlite3.connect(tmp)
    con.row_factory = sqlite3.Row
    try:
        cur = con.execute("SELECT * FROM Career_Garage")
        return [dict(r) for r in cur.fetchall()]
    except sqlite3.DatabaseError:
        return []
    finally:
        con.close()


# --------------------------------------------------------------------------- brio progression (per-route)
# Each route the player has driven carries a `brio_<type>_event_<routeid>_core` progression record in the
# profile. Layout (verified across all 86 records, 2026-09-18): contiguous block of
#   [u32 name_len][name][7-byte const prefix 01 00 00 01 00 00 01][8-byte packed value][00]
# The 8-byte value is a packed/obfuscated progression blob (not a clean float/int) that CHANGES when the
# route is driven. We don't decode its semantics -- we hash it. A value that differs between two profile
# reads means that route was just played, which is a self-verifying course-ID signal for Rivals (where the
# menu offers no clean current-route pointer). See [[fh6-equipped-tune-in-profiledata]].
_RE_BRIO = re.compile(rb"brio_([a-z_]+?)_event_(\d+)_core")
_BRIO_PREFIX = bytes.fromhex("01000001000001")  # 7 bytes, constant


def brio_map(dec):
    """Return {"<type>:<routeid>": "<8-byte value hex>"} for every brio progression record, or {}.

    The key is `type:routeid` (routeid is the join key to a course via ref_track_info). The value is the
    opaque 8-byte progression blob as hex -- meaningful only by comparison: diff two maps and the routes
    whose blob changed are the routes driven between the reads. Never name a course from this; it only says
    *which route id* moved (identity still resolves route id -> ref_track_info -> name)."""
    out = {}
    for m in _RE_BRIO.finditer(dec):
        off, name = m.start(), m.group(0)
        ne = off + len(name)
        # value blob sits after the constant prefix; guard the prefix so we never hash misaligned bytes
        if dec[ne:ne + 7] != _BRIO_PREFIX:
            continue
        out["%s:%d" % (m.group(1).decode(), int(m.group(2)))] = dec[ne + 7:ne + 15].hex()
    return out


def brio_diff(prev, cur):
    """Route ids whose brio blob changed from `prev` to `cur` (both brio_map() dicts). Returns a sorted list
    of {"key","route","type","from","to"} -- new keys included (from=None). Empty when nothing moved."""
    changed = []
    for k, v in (cur or {}).items():
        pv = (prev or {}).get(k)
        if pv != v:
            t, _, rid = k.partition(":")
            changed.append({"key": k, "route": int(rid), "type": t, "from": pv, "to": v})
    changed.sort(key=lambda d: d["route"])
    return changed


# --------------------------------------------------------------------------- CLI (testing)
def _main(argv):
    if len(argv) < 2:
        print("usage: fh6_profile.py <decrypted_profile>|--live [--equipped] [--garage] [--garage-ord N]")
        print("       --live  locate + decrypt the live save (offline when the local decryptor is built)")
        return 2
    if argv[1] == "--live":
        print("offline decryptor:", "yes" if local_decrypt_available() else "NO (would need upload approval)")
        src = find_profile_path()
        print("live profile:", src)
        dec = load_live()
        if dec is None:
            print("no live profile found")
            return 1
        print("decrypted: %d bytes" % len(dec))
    else:
        dec = open(argv[1], "rb").read()
    args = set(argv[2:])
    if "--equipped" in args or len(args) == 0:
        print("current_equipped:", current_equipped(dec))
    if "--garage" in args:
        rows = read_garage(dec)
        print(f"Career_Garage: {len(rows)} instances")
        for r in rows[:5]:
            print("  ", {k: r[k] for k in ("Id", "CarId", "Guid", "TuneFileName", "PerformanceIndex")})
    if "--brio" in args:
        bm = brio_map(dec)
        print(f"brio progression records: {len(bm)}")
        for k in list(bm)[:8]:
            print("  ", k, bm[k])
    for a in argv[2:]:
        if a.startswith("--garage-ord"):
            try:
                o = int(argv[argv.index(a) + 1])
            except Exception:
                continue
            for r in read_garage(dec):
                if r.get("CarId") == o:
                    print(f"  inst {r['Id']} guid={r['Guid']} tune={r['TuneFileName']} PI={r['PerformanceIndex']}")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
