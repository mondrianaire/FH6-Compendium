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
import io
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


# --- game-install formats -----------------------------------------------------
MEDIA = "C:/XboxGames/Forza Horizon 6/Content/media"


def _zip_entries(pattern, suffix):
    import zipfile
    hits = glob.glob(pattern, recursive=True)
    if not hits:
        return None, []
    z = zipfile.ZipFile(hits[0])
    return z, [n for n in z.namelist() if n.lower().endswith(suffix)]


def check_owt():
    """Route<id>.owt ('FTWO') -- header words and the trailer echo."""
    files = sorted(glob.glob(MEDIA + "/openworld/brio/aitracks/Route*.owt"))
    fails = []
    if not files:
        print("  NOTE: no .owt files; skipped")
        return fails
    bad_magic = bad_ver = bad_pay = bad_tail = 0
    secs = {}
    for p in files:
        b = open(p, "rb").read()
        if b[:4] != b"FTWO":
            bad_magic += 1
            continue
        if struct.unpack_from("<H", b, 4)[0] != 512:
            bad_ver += 1
        if struct.unpack_from("<I", b, 0x0C)[0] != len(b) - 32:
            bad_pay += 1
        if b[-16:] != b[:16]:
            bad_tail += 1
        secs[struct.unpack_from("<I", b, 0x20)[0]] = secs.get(
            struct.unpack_from("<I", b, 0x20)[0], 0) + 1
    print("  %d files: %d bad magic, %d version != 512, %d payload word wrong, "
          "%d trailer not an echo" % (len(files), bad_magic, bad_ver, bad_pay, bad_tail))
    print("  section counts: %s" % dict(sorted(secs.items())))
    for n, what in ((bad_magic, "not FTWO"), (bad_ver, "version != 512"),
                    (bad_pay, "payload word != filesize-32"),
                    (bad_tail, "trailer does not echo the header")):
        if n:
            fails.append("%d .owt files %s" % (n, what))
    return fails


def check_nav():
    """Route<id>.nav ('WVAN') -- walk the chunk list and verify every footer echo."""
    files = sorted(glob.glob(MEDIA + "/**/*.nav", recursive=True))
    fails = []
    if not files:
        print("  NOTE: no .nav files; skipped")
        return fails
    walked = badfoot = badver = 0
    for p in files:
        b = open(p, "rb").read()
        o, ok = 0, True
        while o + 16 <= len(b):
            ver, _h, sz = struct.unpack_from("<3I", b, o + 4)
            if ver != 0x200:
                badver += 1
            if b[o + 16 + sz:o + 32 + sz] != b[o:o + 16]:
                ok = False
                break
            o += 32 + sz
        if ok and o == len(b):
            walked += 1
        else:
            badfoot += 1
    print("  %d files: %d walked header->payload->footer exactly to EOF, "
          "%d did not, %d chunks with version != 0x200"
          % (len(files), walked, badfoot, badver))
    if badfoot:
        fails.append("%d .nav files did not walk cleanly to EOF" % badfoot)
    if badver:
        fails.append("%d .nav chunks have an unexpected version" % badver)

    # DEEP: the WVAN payload is laid out FROM BOTH ENDS. nodes[] and spline[]
    # run forward from 0x90; attr[]/keyOff[]/valOff[]/keyBlob/valBlob are
    # anchored to the payload END, each occupying align16(size), and link[] and
    # memberNode[] are placed backward from there. The two regions OVERLAP:
    # the last spline record's trailing (memberEnd, attrEnd) u64s alias
    # memberNode[0..1], which the writer never fills in. Verify the overlap is
    # real and bounded -- 0, 8 or 16 bytes, never negative.
    def a16(x):
        return (x + 15) & ~15

    over = {}
    bad_overlap = 0
    for p in files:
        b = open(p, "rb").read()
        sz = struct.unpack_from("<I", b, 12)[0]
        end = 16 + sz
        (nNode, nSpline, nLink, _n2, nAttr, nKey, nVal,
         keyLen, valLen) = struct.unpack_from("<9I", b, 0x58)
        vb = end - a16(valLen)
        kb = vb - a16(keyLen)
        vo = kb - a16(nVal * 8)
        ko = vo - a16(nKey * 8)
        attr = ko - a16(nAttr * 16)
        member = attr - nLink * 16 - nLink * 8
        ovl = (0x90 + 48 * nNode + 24 * nSpline) - member
        over[ovl] = over.get(ovl, 0) + 1
        if ovl < 0 or ovl > 16:
            bad_overlap += 1
    print("  DEEP: backward layout closes on every file; spline[]/memberNode[] "
          "overlap = %s" % dict(sorted(over.items())))
    if bad_overlap:
        fails.append("%d .nav files have an overlap outside 0..16 bytes -- the "
                     "two-ended layout does not hold" % bad_overlap)
    return fails


def check_str():
    """<name>.str in EN.zip -- header constants and the embedded-name match."""
    z, names = _zip_entries(MEDIA + "/stripped/stringtables/EN.zip", ".str")
    fails = []
    if not names:
        print("  NOTE: EN.zip not found; skipped")
        return fails
    bad_head = bad_ver = bad_off = bad_name = 0
    for n in names:
        b = z.read(n)
        if b[0] != 0 or b[1] != 8:
            bad_head += 1
        if struct.unpack_from("<H", b, 0x82)[0] != 2:
            bad_ver += 1
        t2 = struct.unpack_from("<I", b, 0x88)[0]
        if not (0x8C < t2 < len(b)):
            bad_off += 1
        tname = b[2:0x80].split(b"\x00")[0].decode("ascii", "replace")
        if not tname or tname.lower() not in n.lower():
            bad_name += 1
    print("  %d .str tables (%d zip entries incl. _list.txt): %d bad 00-08 head, "
          "%d version != 2, %d table-2 offset outside file, %d name mismatch"
          % (len(names), len(z.namelist()), bad_head, bad_ver, bad_off, bad_name))
    for n, what in ((bad_head, "do not start 00 08"), (bad_ver, "are not version 2"),
                    (bad_off, "have an out-of-range table-2 offset"),
                    (bad_name, "have an embedded name that is not the filename")):
        if n:
            fails.append("%d .str tables %s" % (n, what))

    # DEEP: resolve every string in both tables, and require the two tables to
    # carry the SAME hash set -- they are a key/value pair, so a mismatch means
    # one side is being mis-read.
    def table(b, o):
        cnt = struct.unpack_from("<3I", b, o)[2]
        recs = [struct.unpack_from("<2I", b, o + 12 + 8 * i) for i in range(cnt)]
        blob = o + 12 + 8 * cnt
        hashes, bad = set(), 0
        for h, off in recs:
            p = blob + off
            if not (0 <= p < len(b)) or b.find(0, p) < 0:
                bad += 1
                continue
            hashes.add(h)
        return hashes, bad, cnt

    total = unresolved = mismatch = 0
    for n in names:
        b = z.read(n)
        v, bv, cv = table(b, 0x8C)
        k, bk, ck = table(b, struct.unpack_from("<I", b, 0x88)[0])
        total += cv + ck
        unresolved += bv + bk
        if v != k:
            mismatch += 1
    print("  DEEP: %s strings resolved, %d unresolved; value/key hash sets "
          "identical in %d/%d tables" % (format(total, ","), unresolved,
                                         len(names) - mismatch, len(names)))
    if unresolved:
        fails.append("%d .str entries do not resolve to a NUL-terminated string" % unresolved)
    if mismatch:
        fails.append("%d .str tables have mismatched value/key hash sets" % mismatch)
    return fails


def check_bxml():
    """BXML entries in ObjectModelGame.zip -- magic, version, index width."""
    z, names = _zip_entries(MEDIA + "/**/ObjectModelGame.zip", "")
    fails = []
    if not names:
        print("  NOTE: ObjectModelGame.zip not found; skipped")
        return fails
    bad_magic = bad_ver = 0
    widths = {1: 0, 2: 0, 4: 0}
    for n in names:
        b = z.read(n)
        if len(b) < 13:
            continue
        if b[:4] != b"BXML":
            bad_magic += 1
            continue
        if b[4] != 2:
            bad_ver += 1
        sc = struct.unpack_from("<i", b, 5)[0]
        widths[1 if sc <= 255 else (2 if sc <= 65535 else 4)] += 1
    print("  %d entries: %d not BXML, %d version != 2; index width u8=%d u16=%d u32=%d"
          % (len(names), bad_magic, bad_ver, widths[1], widths[2], widths[4]))
    if bad_magic:
        fails.append("%d entries are not BXML" % bad_magic)
    if bad_ver:
        fails.append("%d BXML entries are not version 2" % bad_ver)

    # DEEP: walk the whole recursive node tree and require it to consume the
    # file exactly. This is the check an offset table cannot do, and it is the
    # strongest statement available about a variable-length format: if the
    # walk ends anywhere but EOF, the structure is not what we think it is.
    sys.setrecursionlimit(100000)
    walked = short = 0
    for n in names:
        b = z.read(n)
        if len(b) < 13 or b[:4] != b"BXML":
            continue
        try:
            if _bxml_walk(b) == len(b):
                walked += 1
            else:
                short += 1
        except Exception:
            short += 1
    print("  DEEP: %d/%d entries walk the full node tree to EXACTLY EOF"
          % (walked, walked + short))
    if short:
        fails.append("%d BXML entries do not walk cleanly to EOF" % short)
    return fails


def _bxml_walk(b):
    """Consume a BXML file entirely; return the end offset."""
    sc = struct.unpack_from("<i", b, 5)[0]
    o = 13
    for _ in range(sc):
        o += 2 + struct.unpack_from("<H", b, o)[0]
    w = 1 if sc <= 255 else (2 if sc <= 65535 else 4)

    def idx(p):
        if w == 1:
            return b[p], p + 1
        if w == 2:
            return struct.unpack_from("<H", b, p)[0], p + 2
        return struct.unpack_from("<I", b, p)[0], p + 4

    def node(p):
        flags = b[p]
        p += 1
        _, p = idx(p)
        if flags & 2:
            n = b[p]
            p += 1
            for _ in range(n):
                _, p = idx(p)
                _, p = idx(p)
        if flags & 4:
            n = struct.unpack_from("<h", b, p)[0]
            p += 2
            for _ in range(n):
                p = node(p)
        return p

    return node(o + 1)


def check_swatchbin():
    """.swatchbin in Upgrade_Parts.zip -- Grub header and the BC7 payload size."""
    z, names = _zip_entries(MEDIA + "/**/Upgrade_Parts.zip", ".swatchbin")
    fails = []
    if not names:
        print("  NOTE: Upgrade_Parts.zip not found; skipped")
        return fails
    bad_magic = bad_hdr = bad_size = bad_pay = 0
    dims = {}
    for n in names:
        b = z.read(n)
        if b[:4] != b"burG":
            bad_magic += 1
            continue
        if struct.unpack_from("<I", b, 8)[0] != 140:
            bad_hdr += 1
        if struct.unpack_from("<I", b, 12)[0] != len(b):
            bad_size += 1
        v = struct.unpack_from("<12I", b, 0x30)
        w, h = v[7], v[8]
        dims[(w, h)] = dims.get((w, h), 0) + 1
        if len(b) - 140 != ((w + 3) // 4) * ((h + 3) // 4) * 16:
            bad_pay += 1
    print("  %d entries: %d bad magic, %d header size != 140, %d size word wrong, "
          "%d payload != BC7 block count" % (len(names), bad_magic, bad_hdr, bad_size, bad_pay))
    print("  dimensions: %s" % sorted(dims.items(), key=lambda kv: -kv[1])[:5])
    for n, what in ((bad_magic, "are not 'burG'"), (bad_hdr, "have a header size != 140"),
                    (bad_size, "have a wrong size word"),
                    (bad_pay, "do not match a single-mip BC7 payload")):
        if n:
            fails.append("%d .swatchbin entries %s" % (n, what))
    return fails


def check_paths():
    """Every template declares its source, and every declared path resolves.

    A template that documents a byte layout but not WHERE the bytes live sends
    the next agent hunting. This makes the location a checked fact rather than a
    claim: each .bt must carry SOURCE-CATEGORY / SOURCE-LOCATION / SOURCE-READ /
    SOURCE-READER, and every SOURCE-LOCATION must glob to at least one real file.
    A location of "(none ...)" is allowed for the wire format, which has no file.
    """
    fails = []
    bts = sorted(glob.glob(os.path.join(ROOT, "docs", "formats", "*.bt")))
    if not bts:
        return ["no .bt templates found"]
    for p in bts:
        name = os.path.basename(p)
        text = io.open(p, encoding="utf-8").read()
        tags = {}
        for key in ("SOURCE-CATEGORY", "SOURCE-LOCATION", "SOURCE-READ", "SOURCE-READER"):
            tags[key] = re.findall(r"^// %s:\s*(.+?)\s*$" % key, text, re.M)
        missing = [k for k, v in tags.items() if not v]
        if missing:
            fails.append("%s declares no %s" % (name, ", ".join(missing)))
            continue

        resolved = []
        for loc in tags["SOURCE-LOCATION"]:
            if loc.startswith("("):
                resolved.append((loc[:46], "n/a"))
                continue
            # strip the trailing " -- note"
            path = loc.split(" -- ")[0].strip()
            # relative paths are worktree-relative; absolute ones are literal
            probe = path if (len(path) > 1 and path[1] == ":") else os.path.join(ROOT, path)
            hits = glob.glob(probe.replace("\\", "/"), recursive=True)
            resolved.append((os.path.basename(path) or path, len(hits)))
            if not hits:
                fails.append("%s: SOURCE-LOCATION does not resolve on this machine: %s"
                             % (name, path))
        cat = tags["SOURCE-CATEGORY"][0]
        print("  %-26s %s" % (name, cat))
        for what, n in resolved:
            print("      %-42s %s" % (what, n if n != "n/a" else "no file (wire format)"))
    return fails


CHECKS = {"paths": check_paths, "tune": check_tune, "dataout": check_dataout,
          "crypto": check_cryptocontainer, "owt": check_owt, "nav": check_nav,
          "str": check_str, "bxml": check_bxml, "swatchbin": check_swatchbin}

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
