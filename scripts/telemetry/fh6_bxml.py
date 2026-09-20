#!/usr/bin/env python3
"""fh6_bxml.py -- Forza's binary XML (BXML), read into ElementTree.

    python scripts/telemetry/fh6_bxml.py <file.om.xml> [out.xml]

The game's object-model data ships in media/ObjectModelGame.zip (plain Deflate, readable) as
source/ScribbleData/<id>.om.xml -- BXML despite the extension. Every dataset the string tables
name (RivalsEventDataMap, RouteDataMap, CareerRaceDataSet, CareerTrackInfo ...) is one of these
files, and THIS is where a name GUID meets a route id (found 2026-09-05; the string tables never
carried the join, see docs/handoff-to-main-route-identification-2026-09-05.md).

Format, from the MIT-licensed reference reader (Nenkai/ForzaTools, ForzaTools.BinaryXML/BXML.cs):
    u32 'BXML'   u8 version (<= 2)   i32 string_count   i32 string_table_bytes
    string_count x [u16 length][utf-8 bytes]          (sorted; the tree refers to them by index)
    u8 root_flag
    node := u8 flags (1 IsNode | 2 HasAttributes | 4 HasChildNodes)
            idx name
            [u8 n_attr, n_attr x (idx key, idx value)]      when HasAttributes
            [i16 n_children, n_children x node]             when HasChildNodes
    idx is u8 when string_count <= 255, u16 when <= 65535, else u32.
READ-ONLY. Never writes to the game install.
"""
import struct
import sys
import xml.etree.ElementTree as ET

MAGIC = b"BXML"


class Reader:
    def __init__(self, data):
        self.b = data
        self.p = 0

    def u8(self):
        v = self.b[self.p]
        self.p += 1
        return v

    def i16(self):
        v = struct.unpack_from("<h", self.b, self.p)[0]
        self.p += 2
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.b, self.p)[0]
        self.p += 2
        return v

    def i32(self):
        v = struct.unpack_from("<i", self.b, self.p)[0]
        self.p += 4
        return v


def parse(data):
    """bytes -> xml.etree.ElementTree.Element (the root node)."""
    if data[:4] != MAGIC:
        raise ValueError("not BXML (magic %r)" % data[:4])
    r = Reader(data)
    r.p = 4
    version = r.u8()
    if version > 2:
        raise ValueError("BXML version %d unsupported" % version)
    n_str = r.i32()
    r.i32()                                      # string table size, implied by the strings
    strings = []
    for _ in range(n_str):
        n = r.u16()
        strings.append(data[r.p:r.p + n].decode("utf-8", "replace"))
        r.p += n
    idx = r.u8 if n_str <= 0xFF else (r.u16 if n_str <= 0xFFFF else r.i32)
    r.u8()                                       # root flag

    def node():
        flags = r.u8()
        el = ET.Element(strings[idx()])
        if flags & 2:
            for _ in range(r.u8()):
                k = strings[idx()]
                v = strings[idx()]
                el.set(k, v)
        if flags & 4:
            for _ in range(r.i16()):
                el.append(node())
        return el

    root = node()
    return root


def load(path):
    with open(path, "rb") as fh:
        return parse(fh.read())


def to_text(root):
    ET.indent(root)
    return ET.tostring(root, encoding="unicode")


def build(root):
    """Element -> BXML bytes (the inverse of parse; used by the tests to fabricate datasets).
    Strings are sorted the way the game's own files are, but any order round-trips."""
    strings = []
    seen = set()

    def add(s):
        if s not in seen:
            seen.add(s)
            strings.append(s)

    def walk(el):
        add(el.tag)
        for k, v in el.attrib.items():
            add(k)
            add(v)
        for ch in el:
            walk(ch)
    walk(root)
    strings.sort()
    index = {s: i for i, s in enumerate(strings)}
    n = len(strings)
    fmt = "<B" if n <= 0xFF else ("<H" if n <= 0xFFFF else "<i")
    out = bytearray()
    table = bytearray()
    for s in strings:
        b = s.encode("utf-8")
        table += struct.pack("<H", len(b)) + b
    out += MAGIC + bytes([2]) + struct.pack("<ii", n, len(table)) + table + bytes([1])

    def emit(el):
        flags = 1 | (2 if el.attrib else 0) | (4 if len(el) else 0)
        out.append(flags)
        out.extend(struct.pack(fmt, index[el.tag]))
        if el.attrib:
            out.append(len(el.attrib))
            for k, v in el.attrib.items():
                out.extend(struct.pack(fmt, index[k]))
                out.extend(struct.pack(fmt, index[v]))
        if len(el):
            out.extend(struct.pack("<h", len(el)))
            for ch in el:
                emit(ch)
    emit(root)
    return bytes(out)


def main(argv=None):
    a = (argv if argv is not None else sys.argv[1:])
    if not a:
        print(__doc__)
        return 2
    root = load(a[0])
    txt = to_text(root)
    if len(a) > 1:
        with open(a[1], "w", encoding="utf-8") as fh:
            fh.write(txt)
        print("wrote %s (%d bytes)" % (a[1], len(txt)))
    else:
        sys.stdout.write(txt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
