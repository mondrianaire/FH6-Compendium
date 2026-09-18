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


def bt_layout(path, order):
    """[(struct, field, offset, size)] for the named structs, in file order."""
    src = open(path, encoding="utf-8").read()
    src = re.sub(r"<[^>]*>", "", src)          # drop <comment=...> attributes
    src = re.sub(r"//.*", "", src)             # drop line comments
    # Anchor each typedef on its own opening brace so a non-greedy match cannot
    # start inside the struct above it -- the bug that made the first run of
    # this check report 39 phantom mismatches.
    bodies = {}
    for m in re.finditer(r"typedef\s+struct\s*\{(.*?)\}\s*(\w+)\s*;", src, re.S):
        bodies[m.group(2)] = m.group(1)

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


CHECKS = {"tune": check_tune}

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
