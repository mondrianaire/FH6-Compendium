#!/usr/bin/env python3
"""check_bt_template.py -- prove a 010 Editor .bt template still describes the real bytes.

A .bt is documentation you cannot run without 010 Editor, which nothing in this
lab's pipeline has. That makes it exactly the kind of doc that goes stale
silently -- the failure this project keeps hitting. This script closes that gap
for fixed-layout templates: it parses the .bt's own field declarations, lays out
the offsets itself, and checks them against

  1. the canonical Python decoder's offset constants, and
  2. every real file of that format on disk.

Fixed-layout templates only (no conditionals, no computed array lengths). The
variable-length formats -- BXML, .owt, .nav -- need a real parser, not this.

    python scripts/tools/check_bt_template.py           # check all known templates
    python scripts/tools/check_bt_template.py tune      # just one

Exit code 1 if any check fails, so it can gate a commit. READ-ONLY throughout.
"""
import glob
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SIZES = {"ubyte": 1, "byte": 1, "ushort": 2, "short": 2, "uint": 4, "int": 4,
         "float": 4, "uint64": 8, "double": 8}


def strip_bt(src):
    """Drop // comments and <attr=...> blocks from .bt source.

    Attributes must be removed with a quote-aware scan, not a regex: a comment
    string may legally contain '>' (e.g. "0 = gripping, >1 = spinning"), and
    <[^>]*> truncates there and corrupts everything after it. That bug silently
    swallowed whole field declarations the first time this ran.
    """
    src = re.sub(r"//.*", "", src)
    out, depth, quoted, i = [], 0, False, 0
    while i < len(src):
        c = src[i]
        if quoted:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                quoted = False
        elif c == '"' and depth:
            quoted = True
        elif c == "<":
            depth += 1
        elif c == ">" and depth:
            depth -= 1
            i += 1
            continue
        if not depth:
            out.append(c)
        i += 1
    return "".join(out)


def bt_structs(path):
    """{struct name: body} for every typedef struct in the file."""
    src = strip_bt(open(path, encoding="utf-8").read())
    return {m.group(2): m.group(1) for m in
            re.finditer(r"typedef\s+struct\s*\{(.*?)\}\s*(\w+)\s*;", src, re.S)}


def bt_layout(path, order):
    """[(struct, field, offset, size)] for the named structs, in file order."""
    bodies = bt_structs(path)

    out, off = [], 0
    for name in order:
        if name not in bodies:
            raise SystemExit("template has no struct %r" % name)
        for ty, fld, arr in re.findall(
                r"\b(" + "|".join(SIZES) + r")\s+(\w+)\s*(\[\d+\])?\s*;", bodies[name]):
            n = int(arr[1:-1]) if arr else 1
            for i in range(n):
                label = fld if n == 1 else "%s[%d]" % (fld, i)
                out.append((name, label, off, SIZES[ty]))
                off += SIZES[ty]
    return out


def check_tune():
    """The 598-byte saved tune blob vs scripts/telemetry/fh6_tune_decode.py."""
    sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))
    import fh6_tune_decode as T

    bt = os.path.join(ROOT, "docs", "formats", "fh6_tune_data.bt")
    lay = bt_layout(bt, ["TuneHeader", "Unknown10", "PartSlots",
                         "ReservedSlots", "TuneSliders", "GearRatios"])
    start = {}
    for sname, fld, off, _ in lay:
        start.setdefault(sname, off)
        start.setdefault((sname, fld), off)
    total = lay[-1][2] + lay[-1][3]
    fails = []

    def eq(what, got, want):
        if got != want:
            fails.append("%s: template 0x%04X, decoder 0x%04X" % (what, got, want))

    eq("total size", total, T.TUNE_FILE_SIZE)
    eq("PartSlots", start["PartSlots"], T.OFF_PARTS)
    eq("TuneSliders", start["TuneSliders"], T.SLIDERS[0][1])
    eq("GearRatios", start["GearRatios"], T.GEARS_OFF)

    parts = [f for s, f, _, _ in lay if s == "PartSlots"]
    if parts != T.PARTS:
        fails.append("part slot names/order differ from decoder PARTS")
    for name, off, *_ in T.SLIDERS:
        eq("slider " + name, start.get(("TuneSliders", name), -1), off)

    print("  template lays out %d bytes in %d fields" % (total, len(lay)))
    print("  %d part slots, %d sliders, %d gears"
          % (len(parts), sum(1 for s, *_ in lay if s == "TuneSliders"),
             sum(1 for s, *_ in lay if s == "GearRatios")))

    # --- and against every real file -------------------------------------
    pat = "C:/XboxGames/GameSave/pgs/*/*/ContainersRoot/Tuning_*/Data"
    files = sorted(glob.glob(pat))
    if not files:
        print("  NOTE: no saves on this machine; byte checks skipped")
        return fails
    bad_size = bad_ver = bad_gap = bad_res = 0
    GAP = bytes.fromhex("00000100000001000000")
    for p in files:
        b = open(p, "rb").read()
        if len(b) != total:
            bad_size += 1
            continue
        if b[0] != 0x03:
            bad_ver += 1
        if b[4:14] != GAP:
            bad_gap += 1
        res = b[start["ReservedSlots"]:start["TuneSliders"]]
        if any(struct.unpack_from("<I", res, i)[0] != 0xFFFFFFFF
               for i in range(0, len(res), 4)):
            bad_res += 1
    print("  %d real files: %d wrong size, %d wrong version, %d gap differs, "
          "%d reserved not 0xFFFFFFFF" % (len(files), bad_size, bad_ver, bad_gap, bad_res))
    for n, what in ((bad_size, "files are not the template's size"),
                    (bad_ver, "files are not version 0x03"),
                    (bad_gap, "files differ in the 0x04 constant -- INVESTIGATE"),
                    (bad_res, "files have a non-sentinel reserved word -- INVESTIGATE")):
        if n:
            fails.append("%d %s" % (n, what))
    return fails


def check_dataout():
    """The 324-byte Data Out packet vs scripts/telemetry/fh6_dataout_capture.py."""
    sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))
    import fh6_dataout_capture as D

    bt = os.path.join(ROOT, "docs", "formats", "fh6_dataout_packet.bt")
    # Wheel4f/Wheel4i expand inline wherever they appear, so lay the packet out
    # from the block structs and splice the wheel arrays in by name.
    bodies = bt_structs(bt)

    decl = re.compile(r"\b(" + "|".join(list(SIZES) + ["char", "Wheel4f", "Wheel4i"]) +
                      r")\s+(\w+)\s*(\[\d+\])?\s*;")
    lay, off = [], 0
    for block in ("SledBlock", "HorizonBlock", "DashBlock", "Trailer"):
        for ty, fld, _ in decl.findall(bodies[block]):
            if ty.startswith("Wheel4"):
                for w in ("FL", "FR", "RL", "RR"):
                    lay.append((fld + w, off)); off += 4
            else:
                lay.append((fld, off)); off += 1 if ty == "char" else SIZES[ty]

    fails = []
    want = struct.calcsize(D.FH_FMT)
    if off != want:
        fails.append("total size: template %d, parser %d" % (off, want))
    if len(lay) != len(D.FIELDS):
        fails.append("field count: template %d, parser %d" % (len(lay), len(D.FIELDS)))

    # The .bt uses the official spec's names; the parser uses short ones. Compare
    # by POSITION -- the offsets are the contract, not the spelling.
    poff, o = {}, 0
    toks = re.findall(r"(\d*)([iIfHBb])", D.FH_FMT.lstrip("<"))
    flat = []
    for cnt, ch in toks:
        flat += [ch] * int(cnt or 1)
    for name, ch in zip(D.FIELDS, flat):
        poff[name] = o
        o += {"i": 4, "I": 4, "f": 4, "H": 2, "B": 1, "b": 1}[ch]
    for i, (name, toff) in enumerate(lay):
        if i < len(D.FIELDS):
            pname = D.FIELDS[i]
            if poff[pname] != toff:
                fails.append("field %d (%s/%s): template %d, parser %d"
                             % (i, name, pname, toff, poff[pname]))
    print("  template lays out %d bytes in %d fields" % (off, len(lay)))
    print("  blocks: sled 0x000, horizon 0x%03X, dash 0x%03X, trailer 0x%03X"
          % (poff["CarGroup"], poff["PosX"], poff["Trailing323"]))

    # --- corpus invariants the template asserts --------------------------
    caps = sorted(glob.glob(os.path.join(ROOT, "captures", "*.csv.gz")))
    if not caps:
        print("  NOTE: no captures; corpus checks skipped")
        return fails
    import csv as _csv
    import gzip
    import math
    import random
    random.seed(7)
    sample = random.sample(caps, min(8, len(caps)))
    rows = trailing_nz = velbad = velN = 0
    for p in sample:
        with gzip.open(p, "rt", newline="") as fh:
            for r in _csv.DictReader(fh):
                rows += 1
                if r.get("Trailing323") not in ("0", None):
                    trailing_nz += 1
                try:
                    s = float(r["Speed"])
                    if s > 1.0:
                        velN += 1
                        v = math.sqrt(float(r["VelX"]) ** 2 + float(r["VelY"]) ** 2
                                      + float(r["VelZ"]) ** 2)
                        if abs(v - s) > 0.5:
                            velbad += 1
                except (KeyError, ValueError):
                    pass
    pct = 100.0 * (velN - velbad) / velN if velN else 0.0
    print("  %d capture frames: %d trailing byte non-zero, |Vel|==Speed on "
          "%d/%d moving frames (%.3f%%)" % (rows, trailing_nz, velN - velbad, velN, pct))
    if trailing_nz:
        fails.append("%d frames have a non-zero trailing byte -- INVESTIGATE" % trailing_nz)
    if velN and pct < 99.0:
        fails.append("|Vel| vs Speed holds on only %.2f%% of frames -- layout suspect" % pct)
    return fails


def check_cryptocontainer():
    """The CryptoContainer envelope vs fh6_local_decrypt/Program.cs and real files."""
    bt = os.path.join(ROOT, "docs", "formats", "fh6_cryptocontainer.bt")
    lay = bt_layout(bt, ["ContainerHeader"])
    hdr = lay[-1][2] + lay[-1][3]
    fails = []

    # Constants are asserted against the C# source, which is canonical here --
    # there is no Python implementation of the container to compare with.
    cs = open(os.path.join(ROOT, "scripts", "tools", "fh6_local_decrypt",
                           "Program.cs"), encoding="utf-8").read()
    want = {}
    for k, pat in (("header", r"ContainerHeaderSize\s*=\s*(\d+)"),
                   ("mac", r"MacSize\s*=\s*(\d+)"),
                   ("profile", r"ProfileChunk\s*=\s*(\d+)"),
                   ("gamedb", r"GameDbChunk\s*=\s*(\d+)")):
        m = re.search(pat, cs)
        if not m:
            fails.append("could not read %s constant from Program.cs" % k)
        else:
            want[k] = int(m.group(1))
    if want.get("header") != hdr:
        fails.append("header size: template %d, Program.cs %d" % (hdr, want.get("header")))
    for k in ("profile", "gamedb"):
        if str(want.get(k)) not in open(bt, encoding="utf-8").read():
            fails.append("template never mentions the %s chunk size %s" % (k, want.get(k)))
    print("  header %d bytes (IV0 16 + word 4 + nonce 16); chunks profile=%s gamedb=%s"
          % (hdr, want.get("profile"), want.get("gamedb")))

    # --- real containers --------------------------------------------------
    found = []
    for pat, chunk, label in (
            ("C:/XboxGames/GameSave/pgs/*/*/ContainersRoot/User_*/C_ProfileData",
             want.get("profile"), "C_ProfileData"),
            ("C:/XboxGames/**/gamedbRC.slt", want.get("gamedb"), "gamedbRC.slt")):
        for p in glob.glob(pat, recursive=True):
            sz = os.path.getsize(p)
            pay = sz - hdr
            ok = pay > 0 and chunk and pay % (chunk + want["mac"]) == 0
            found.append((label, sz, pay // (chunk + want["mac"]) if ok else None))
            if not ok:
                fails.append("%s (%d bytes) does not divide into %s-byte slots"
                             % (label, sz, chunk))
            if pay % 16:
                fails.append("%s payload is not AES block-aligned" % label)
    if not found:
        print("  NOTE: no containers on this machine; byte checks skipped")
        return fails
    for label, sz, n in found:
        print("  %-14s %12s bytes -> %s slots" % (label, format(sz, ","), n))

    # The documented trap: gamedb divides by BOTH slot sizes. If that ever stops
    # being true the warning in the template is overstated and should be edited.
    gd = [f for f in found if f[0] == "gamedbRC.slt"]
    if gd and want.get("profile"):
        pay = gd[0][1] - hdr
        both = pay % (want["profile"] + want["mac"]) == 0
        print("  gamedb also divides by the %d-byte profile slot: %s (the documented trap)"
              % (want["profile"] + want["mac"], both))
        if not both:
            fails.append("the .bt claims gamedb divides by both slot sizes; it no longer does")
    return fails


CHECKS = {"tune": check_tune, "dataout": check_dataout,
          "crypto": check_cryptocontainer}

if __name__ == "__main__":
    want = sys.argv[1:] or sorted(CHECKS)
    bad = 0
    for name in want:
        if name not in CHECKS:
            raise SystemExit("unknown template %r; known: %s" % (name, ", ".join(sorted(CHECKS))))
        print("== %s" % name)
        fails = CHECKS[name]()
        for f in fails:
            print("  FAIL %s" % f)
        bad += len(fails)
        print("  %s" % ("OK" if not fails else "%d FAILURE(S)" % len(fails)))
    sys.exit(1 if bad else 0)
