"""The .owt section table: a route is a graph of sections, and the point array is not at 0x60.

Route132 (The Colossus) holds six sections -- a primary chain 0 -> 1 -> 2 -> 3 -> 0 plus two
alternate lines -- behind a 192-byte section table that is NOT a whole number of 56-byte records.
Read as one array from 0x60 it came out as 3.1 km with a zero bounding box. These tests build
synthetic files with exactly the shipped layout (header, 40-byte entries from 0x58, 16-byte
alignment, 16-byte trailer) and hold the parser to the primary chain, on every section-count
shape the install has: 1, 4, 5 and 6.
"""
import math
import os
import struct
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H  # noqa: E402,F401  (path setup)

import fh6_owt  # noqa: E402

R = 500.0            # circle radius; the primary chain of a loop is one lap of 2*pi*R
STEP_DEG = 0.25      # ~2.2 m point spacing at R=500, like the shipped ~2 m


def arc(a0, a1, offset=0.0):
    """Points along the circle from a0 to a1 degrees (end exclusive), radially offset."""
    pts = []
    a = a0
    while a < a1 - 1e-9:
        r = R + offset
        pts.append((r * math.cos(math.radians(a)), 100.0, r * math.sin(math.radians(a))))
        a += STEP_DEG
    return pts


def record(p, code):
    """One 56-byte point record: 11 floats, four u16 road-class copies, one float."""
    return struct.pack("<11f4Hf", p[0], p[1], p[2], 0.5, 0.0, 5.5, 0.0, 1.0, 0.0, 0.0, 0.0,
                       code, code, code, code, 0.0)


def build_owt(sections):
    """sections: [(points, flags, links)] -- links is None for section 0, else a list of ints.

    Lays the bytes out exactly as the game does: 0x58-byte fixed header carrying section 0's
    count/flags at 0x50, one 40-byte entry per further section, the point array 16-byte
    aligned, padded to 16, then a 16-byte copy of the first header bytes. Points carry the
    road-class code given as the section index + 1 so a test can tell which section a returned
    point came from.
    """
    n_all = sum(len(p) for p, _f, _l in sections)
    hdr = bytearray(0x58)
    hdr[0:4] = b"FTWO"
    struct.pack_into("<H", hdr, 0x04, 2)
    struct.pack_into("<I", hdr, 0x08, 0x2A076436)
    struct.pack_into("<I", hdr, 0x20, len(sections))
    struct.pack_into("<I", hdr, 0x24, n_all)
    struct.pack_into("<I", hdr, 0x28, 0xFFFFFFFF)
    struct.pack_into("<I", hdr, 0x2C, 0x01B701B7)
    struct.pack_into("<I", hdr, 0x38, 1 if len(sections) > 1 else 0)
    hdr[0x40:0x50] = b"\xff" * 16
    struct.pack_into("<2I", hdr, 0x50, len(sections[0][0]), sections[0][1])
    out = bytearray(hdr)
    start = len(sections[0][0])
    for pts, flags, links in sections[1:]:
        ln = list(links) + [-1] * (3 - len(links))
        pairs = []
        for l in ln:
            pairs += [l, 0 if l >= 0 else -1]
        out += struct.pack("<2I6i2I", start, 0, *pairs, len(pts), flags)
        start += len(pts)
    out += b"\0" * (-len(out) % 16)
    for k, (pts, _f, _l) in enumerate(sections):
        for p in pts:
            out += record(p, k + 1)
    out += b"\0" * (-len(out) % 16)
    struct.pack_into("<I", out, 0x0C, len(out) + 16 - 32)
    out += bytes(out[:16])
    return bytes(out)


def write_tmp(data):
    path = os.path.join(tempfile.gettempdir(), "Route%s.owt" % uuid.uuid4().hex[:8])
    with open(path, "wb") as fh:
        fh.write(data)
    return path


def colossus_like():
    """Six sections shaped like Route132: chain 0-1-2-3 closes the circle, 4 and 5 are
    alternate lines over the same road as 0 and 2 (flags high byte 2, one link back in)."""
    s0, s1, s2, s3 = arc(0, 120), arc(120, 130), arc(130, 300), arc(300, 360)
    return [
        (s0, 0x0101, None),
        (s1, 0x0102, [2, 5]),                   # two ways on: the primary 2 and its alternate 5
        (s2, 0x0101, [3]),
        (s3, 0x0101, [0]),                      # back to the start: a circuit
        (arc(0, 120, offset=3.0), 0x0201, [1]),  # alternate of 0
        (arc(130, 300, offset=3.0), 0x0201, [3]),  # alternate of 2
    ]


class OwtSectionTableTest(unittest.TestCase):

    def setUp(self):
        self.paths = []

    def tearDown(self):
        for p in self.paths:
            try:
                os.remove(p)
            except OSError:
                pass

    def parse(self, sections, full=False):
        data = build_owt(sections)
        path = write_tmp(data)
        self.paths.append(path)
        return data, fh6_owt.parse(path, full=full)

    def test_six_sections_primary_chain_is_the_route(self):
        secs = colossus_like()
        data, r = self.parse(secs)
        # the defect's shape: the table is 5 x 40 = 200 bytes past 0x58, no whole number of records
        arr = fh6_owt._align16(0x58 + 5 * fh6_owt.SEC_ENTRY)
        self.assertEqual(arr, 0x120)
        self.assertNotEqual((arr - fh6_owt.HDR) % fh6_owt.STRIDE, 0)
        self.assertEqual(struct.unpack_from("<I", data, 0x24)[0], sum(len(s[0]) for s in secs))
        self.assertEqual(r["n_sections"], 6)
        self.assertEqual(r["chain"], [0, 1, 2, 3])
        n_primary = sum(len(secs[k][0]) for k in (0, 1, 2, 3))
        self.assertEqual(r["n"], n_primary)
        self.assertEqual(len(r["codes"]), n_primary)
        self.assertEqual(r["n_dropped"], 0)
        self.assertTrue(r["is_loop"])
        self.assertAlmostEqual(r["length_m"], 2 * math.pi * R, delta=0.01 * 2 * math.pi * R)
        self.assertEqual(r["bbox"], [-500, 500, -500, 500])
        # not one alternate-line point in the polyline: codes 5 and 6 belong to sections 4 and 5
        self.assertEqual(sorted(set(r["codes"])), [1, 2, 3, 4])
        # the polyline is in driving order: section 1's first point follows section 0's last
        first_of_1 = r["points"][len(secs[0][0])]
        self.assertAlmostEqual(math.degrees(math.atan2(first_of_1[2], first_of_1[0])), 120.0, places=3)
        # every section is still described, alternates included, with its own length
        self.assertEqual([s["variant"] for s in r["sections"]], [1, 1, 1, 1, 2, 2])
        self.assertEqual(r["sections"][1]["links"], [2, 5])
        self.assertAlmostEqual(r["sections"][4]["length_m"], r["sections"][0]["length_m"], delta=10.0)

    def test_five_sections_table_needs_alignment_pad(self):
        """Five sections end the table at 0xF8: the array starts 8 bytes later, at 0x100. Read
        8 bytes early every x came out 0 (the shipped Route1181)."""
        secs = [
            (arc(0, 10), 0x0101, None),
            (arc(10, 200), 0x0103, [2, 3, 4]),
            (arc(200, 360), 0x0101, [0]),
            (arc(200, 360, offset=3.0), 0x0201, [1]),
            (arc(200, 360, offset=6.0), 0x0201, [1]),
        ]
        _data, r = self.parse(secs)
        self.assertEqual(fh6_owt._align16(0x58 + 4 * fh6_owt.SEC_ENTRY), 0x100)
        self.assertEqual(r["chain"], [0, 1, 2])
        self.assertTrue(r["is_loop"])
        self.assertGreater(r["bbox"][1] - r["bbox"][0], 900)     # a real x span, not [0, 0]
        self.assertAlmostEqual(r["length_m"], 2 * math.pi * R, delta=0.01 * 2 * math.pi * R)

    def test_four_sections_keeps_every_primary_point(self):
        """Four sections make a 112-byte table -- exactly two records -- which is why those
        files half-worked before: read from 0x60 the table became two non-finite points and the
        last two real points fell off the end. The chain must hold every primary point."""
        secs = [
            (arc(0, 250), 0x0102, None),
            (arc(250, 300), 0x0101, [2]),
            (arc(300, 360), 0x0101, [0]),
            (arc(250, 300, offset=3.0), 0x0401, [2]),
        ]
        _data, r = self.parse(secs, full=True)
        self.assertEqual(r["chain"], [0, 1, 2])
        self.assertEqual(r["n"], sum(len(secs[k][0]) for k in (0, 1, 2)))
        self.assertEqual(len(r["points"][0]), 14)
        self.assertTrue(r["is_loop"])
        last = r["points"][-1]
        self.assertAlmostEqual(math.degrees(math.atan2(last[2], last[0])) % 360, 360 - STEP_DEG, places=3)

    def test_single_section_is_the_whole_array_from_0x60(self):
        """163 of 169 files: one section, array at 0x60. Both alignment cases (an 8-byte pad
        before the trailer, and none) must yield every point -- the old '24-byte tail' rule
        only fit one of them."""
        for n_pts in (1243, 1920):                 # 0x60 + n*56 is 8 mod 16, then 0 mod 16
            pts = arc(0, n_pts * STEP_DEG)[:n_pts]
            data, r = self.parse([(pts, 0x0101, None)])
            self.assertEqual((0x60 + n_pts * 56) % 16, 8 if n_pts == 1243 else 0)
            self.assertEqual(r["n_sections"], 1)
            self.assertEqual(r["chain"], [0])
            self.assertEqual(r["n"], n_pts)
            for got, want in ((r["points"][0], pts[0]), (r["points"][-1], pts[-1])):
                for g, w in zip(got[:3], want):          # float32 on disk, float64 in the test
                    self.assertAlmostEqual(g, w, places=3)
            self.assertEqual(struct.unpack_from("<I", data, 0x0C)[0], len(data) - 32)

    def test_point_to_point_stops_at_the_dead_end(self):
        secs = [
            (arc(0, 100), 0x0101, None),
            (arc(100, 180), 0x0100, []),           # nowhere to go: a point-to-point route
            (arc(100, 180, offset=3.0), 0x0200, []),
        ]
        _data, r = self.parse(secs)
        self.assertEqual(r["chain"], [0, 1])
        self.assertFalse(r["is_loop"])
        self.assertAlmostEqual(r["length_m"], math.pi * R, delta=0.01 * math.pi * R)

    def test_layout_that_does_not_fit_is_refused(self):
        """A header count that does not lay the file out to its size is an error, not a read
        from a guessed offset."""
        data = bytearray(build_owt(colossus_like()))
        n = struct.unpack_from("<I", data, 0x24)[0]
        struct.pack_into("<I", data, 0x24, n + 1)
        path = write_tmp(bytes(data))
        self.paths.append(path)
        with self.assertRaises(ValueError):
            fh6_owt.parse(path)


if __name__ == "__main__":
    unittest.main()
