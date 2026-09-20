#!/usr/bin/env python3
"""strparse.py -- parse Forza Horizon 6 binary ``.str`` string tables (stdlib only).

Layout (little-endian; verified 2026-09-02 against the 66 ForzaTech Studio CSV exports)::

    0x00  u8   0                  constant in all 288 files
    0x01  u8   8                  constant in all 288 files
    0x02  char[126]               table name, ASCII, NUL padded (== file stem)
    0x80  u16  0                  constant
    0x82  u16  2                  format version
    0x84  u32  block1_off         absolute offset of the CONTENT block (always 0x8C)
    0x88  u32  block2_off         absolute offset of the KEY-NAME block (== file size when the
                                  file has no key block; 12 of 288 files)
    block := u32 size             == 8*count + pool_bytes (excludes this 12-byte block header)
             u32 pool_bytes
             u32 count
             count x { u32 hash, u32 offset }   offset = BYTE offset into the pool
             pool                 NUL-terminated UTF-8 strings

Block 1 pool holds the display Content, block 2 pool the KeyName; both carry the same hash
list in the same order (sorted by KeyName, ordinal ASCII).

Hash (the CSV "HashId"): ``h = 0xFFFFFFFF; for c in key.encode('ascii'): h = rotl32(h ^ c, 7)``.
Equivalently ``~fold(rotl(h,7) ^ c over key + NUL)``.

Usage::

    python strparse.py FILE.str                      print rows
    python strparse.py --validate STRDIR CSVDIR      compare every CSV against its .str
    python strparse.py --convert STRDIR OUTDIR       write OUTDIR/<name>.json for every .str
    python strparse.py --hash KEY                    print the hash of a key

Ported from the analysis scratchpad 2026-09-02 so the ref_string import has no dependency
outside the repo. Validated: 58,722 entries across 288 tables, all 66 ForzaTech Studio CSV
exports reproduced byte-exact.
"""
import csv
import json
import os
import struct
import sys

M32 = 0xFFFFFFFF


def rotl32(h, k):
    return ((h << k) | (h >> (32 - k))) & M32


# The hash rule lives in fh6db.strhash -- one definition for the whole project. Fall back to a
# local copy so this file still runs standalone on a machine that only has the .str files.
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fh6db import strhash as key_hash          # noqa: E402  (CSV HashId of a KeyName)
except ImportError:                                 # pragma: no cover
    def key_hash(key):
        """CSV HashId of a KeyName (ASCII, case-sensitive)."""
        h = M32
        for c in key.encode("utf-8"):
            h = rotl32(h ^ c, 7)
        return h


def _read_block(b, off):
    size, pool_bytes, count = struct.unpack_from("<III", b, off)
    # Game files (EN.zip, ForzaTech Studio CSV exports' sources): size == 8*count + pool_bytes.
    # Files re-saved by ForzaTech Studio carry size == 12 + 8*count + pool_bytes (header included).
    if size - (8 * count + pool_bytes) not in (0, 12):
        raise ValueError("block at 0x%X: size %d != 8*%d + %d (+0 or +12)" % (off, size, count, pool_bytes))
    pairs = list(struct.iter_unpack("<II", b[off + 12: off + 12 + 8 * count]))
    pool_off = off + 12 + 8 * count
    pool = b[pool_off: pool_off + pool_bytes]
    strings = []
    bad = 0
    for h, o in pairs:
        end = pool.find(b"\0", o)
        if end < 0:
            raise ValueError("block at 0x%X: unterminated string at pool offset %d" % (off, o))
        raw = pool[o:end]
        try:
            s = raw.decode("utf-8")
        except UnicodeDecodeError:
            s = raw.decode("utf-8", "replace")
            bad += 1
        strings.append((h, s))
    return {"off": off, "size": size, "pool_bytes": pool_bytes, "count": count,
            "end": pool_off + pool_bytes, "rows": strings, "decode_errors": bad}


def parse(path):
    """-> {name, version, count, has_keys, entries: [(hash, key|None, content)], layout: {...}}"""
    b = open(path, "rb").read()
    if len(b) < 0x98:
        raise ValueError("%s: too short" % path)
    b0, b1 = b[0], b[1]
    name = b[2:0x80].split(b"\0")[0].decode("ascii")
    pad, version, blk1, blk2 = struct.unpack_from("<HHII", b, 0x80)
    if (b0, b1, pad, version, blk1) != (0, 8, 0, 2, 0x8C):
        raise ValueError("%s: unexpected header %r" % (path, (b0, b1, pad, version, blk1)))
    content = _read_block(b, blk1)
    has_keys = blk2 < len(b)
    keys = None
    if has_keys:
        if content["end"] != blk2:
            raise ValueError("%s: block1 ends at 0x%X but block2 starts at 0x%X" % (path, content["end"], blk2))
        keys = _read_block(b, blk2)
        if keys["end"] != len(b):
            raise ValueError("%s: block2 ends at 0x%X, file size 0x%X" % (path, keys["end"], len(b)))
        if [h for h, _ in keys["rows"]] != [h for h, _ in content["rows"]]:
            raise ValueError("%s: hash list differs between content and key blocks" % path)
    else:
        if blk2 != len(b) or content["end"] != len(b):
            raise ValueError("%s: no key block but block1 ends at 0x%X, blk2=0x%X, size 0x%X"
                             % (path, content["end"], blk2, len(b)))
    entries = []
    for i, (h, c) in enumerate(content["rows"]):
        k = keys["rows"][i][1] if keys else None
        entries.append((h, k, c))
    return {"name": name, "version": version, "count": content["count"], "has_keys": has_keys,
            "entries": entries,
            "layout": {"file_size": len(b), "block1_off": blk1, "block2_off": blk2,
                       "content_pool_bytes": content["pool_bytes"],
                       "key_pool_bytes": keys["pool_bytes"] if keys else 0,
                       "decode_errors": content["decode_errors"] + (keys["decode_errors"] if keys else 0)}}


def validate(strdir, csvdir):
    report = {"csv_files": 0, "matched": 0, "mismatched": [], "hash_check": {"files": 0, "keys": 0, "bad": 0},
              "no_key_block": [], "parse_errors": []}
    csvs = sorted(f for f in os.listdir(csvdir) if f.lower().endswith(".csv"))
    for f in csvs:
        stem = f[:-4]
        sp = os.path.join(strdir, stem + ".str")
        if not os.path.exists(sp):
            report["mismatched"].append({"csv": f, "error": "no .str"})
            continue
        report["csv_files"] += 1
        rows = list(csv.DictReader(open(os.path.join(csvdir, f), encoding="utf-8-sig", newline="")))
        try:
            p = parse(sp)
        except Exception as e:
            report["mismatched"].append({"csv": f, "error": "parse: %s" % e})
            continue
        diffs = []
        if len(rows) != p["count"]:
            diffs.append("row count csv %d != str %d" % (len(rows), p["count"]))
        for i, (r, (h, k, c)) in enumerate(zip(rows, p["entries"])):
            if int(r["HashId"]) != h or r["KeyName"] != k or r["Content"] != c or int(r["HashIdHex"], 16) != h:
                diffs.append({"row": i, "csv": (r["HashId"], r["KeyName"], r["Content"][:60]),
                              "str": (h, k, (c or "")[:60])})
                if len(diffs) > 5:
                    break
        if diffs:
            report["mismatched"].append({"csv": f, "diffs": diffs})
        else:
            report["matched"] += 1
    # hash rule over every key of every .str
    for f in sorted(os.listdir(strdir)):
        if not f.lower().endswith(".str"):
            continue
        try:
            p = parse(os.path.join(strdir, f))
        except Exception as e:
            report["parse_errors"].append({"file": f, "error": str(e)})
            continue
        if not p["has_keys"]:
            report["no_key_block"].append(f)
            continue
        report["hash_check"]["files"] += 1
        for h, k, c in p["entries"]:
            report["hash_check"]["keys"] += 1
            if key_hash(k) != h:
                report["hash_check"]["bad"] += 1
                if report["hash_check"]["bad"] <= 5:
                    report["hash_check"].setdefault("examples", []).append((f, k, h, key_hash(k)))
    return report


def convert(strdir, outdir):
    os.makedirs(outdir, exist_ok=True)
    index = []
    for f in sorted(os.listdir(strdir)):
        if not f.lower().endswith(".str"):
            continue
        p = parse(os.path.join(strdir, f))
        out = {"table": p["name"], "source": f, "version": p["version"], "count": p["count"],
               "has_keys": p["has_keys"], "layout": p["layout"],
               "entries": [{"hash": h, "hex": "0x%08X" % h, "key": k, "content": c} for h, k, c in p["entries"]]}
        with open(os.path.join(outdir, p["name"] + ".json"), "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
        index.append({"table": p["name"], "count": p["count"], "has_keys": p["has_keys"],
                      "file_size": p["layout"]["file_size"], "decode_errors": p["layout"]["decode_errors"],
                      "sample_keys": [k for _, k, _ in p["entries"][:3]],
                      "sample_content": [c[:80] for _, _, c in p["entries"][:3]]})
    with open(os.path.join(outdir, "_index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=1)
    return index


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        sys.exit(0)
    if a[0] == "--hash":
        print(key_hash(a[1]), "0x%08X" % key_hash(a[1]))
    elif a[0] == "--validate":
        print(json.dumps(validate(a[1], a[2]), indent=1, ensure_ascii=False))
    elif a[0] == "--convert":
        idx = convert(a[1], a[2])
        print("converted", len(idx), "tables ->", a[2])
    else:
        p = parse(a[0])
        print(p["name"], "version", p["version"], "count", p["count"], "has_keys", p["has_keys"], p["layout"])
        for h, k, c in p["entries"]:
            print("0x%08X" % h, k, repr(c))
