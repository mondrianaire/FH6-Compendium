"""fh6_nav.py -- reader for ForzaTech FH6 'NAVW' navigation files (Route<id>.nav,
Brio_00.nav) found under Content/media/openworld/brio/, and the ROAD SURFACE layer
built from them.

WHY THIS FILE EXISTS
--------------------
Radius, width and banking come off the .owt centre-line, so the project could describe a
corner's shape but not what the corner is MADE OF -- and the surface is what decides which
tyre compound is legal and whether a slider recommendation applies at all. The surface is
here, in Brio_00.nav: every road in the free-roam graph is a spline, and every spline
carries a `road_type` attribute whose value is a plain string in the file's own value blob
('a', 'b', 'freeway', 'dirt', 'trail', 'hidden', 'shortcut', 'evolving_world'). The
vocabulary is READ, not inferred -- that is why this source was chosen over the 16-bit code
in the .owt records, which is per-point and exact but has to have its meaning guessed.

The two are used together: nav names the surface, the .owt code carries it to the points
nav does not cover.  See scripts/db/import_surface.py.

Container
---------
A .nav file is a flat list of chunks:

    +0x00  char[4] magic      'WVAN' (= 'NAVW' stored little-endian), 'RVAN'
    +0x04  u32     version    0x00000200 in FH6
    +0x08  u32     hash       same value in every chunk of one file (asset id)
    +0x0C  u32     payloadSz
    +0x10  payload  (payloadSz bytes)
    +...   char[4] magic      exact 16-byte echo of the chunk header
                              (magic/version/hash/payloadSz) as a footer
    next chunk starts immediately after the footer

'WVAN' carries the navigation graph.  'RVAN' (route files only) carries the
race start grid / finish line.

WVAN payload map (absolute file offsets, chunk always starts at 0)
------------------------------------------------------------------
    0x10 .. 0x57   72 bytes, all zero in every FH6 file
    0x58  u32 nNode      node count
    0x5c  u32 nSpline    spline / road count (1..3 on routes, 1532 on Brio_00)
    0x60  u32 nLink      link-record count      (array A)
    0x64  u32 nLink2     == nLink in all 170 files
    0x68  u32 nAttr      attribute-pair count   (array B)
    0x6c  u32 nKey       distinct attribute keys
    0x70  u32 nVal       distinct attribute values
    0x74  u32 keyBlobLen bytes of key string blob
    0x78  u32 valBlobLen bytes of value string blob
    0x7c  u32 w7c        unexplained (7636 on every route file, 55089 on Brio)
    0x80  u32 0
    0x84  u32 0
    0x88  u32 w88        unexplained (0xffffffff on routes, 5 on Brio)
    0x8c  u32 w8c        unexplained (0xffffffff on routes, 0 on Brio)
    0x90  node[nNode]    48 bytes each -- see below
    ...   spline[nSpline] 24 bytes each:
                            u32 memberCount
                            u16 flagsB      (4,5,6 on Brio; 1 on routes)
                            u16 idxC        (0..5253 on Brio -- unexplained)
                            u64 memberEnd   exclusive end into link[]  (prefix sum
                                            of memberCount)
                            u64 attrEnd     exclusive end into attr[]  (prefix sum)
    ...   memberNode[]   u64 each, nLink entries (node index per membership)
    ...   link[nLink]    16 bytes each: u64 splineIndex, u64 seqAlongSpline
    ...   attr[nAttr]    16 bytes each: u64 keyIndex, u64 valueIndex
    ...   keyOff[nKey]   u64 byte offset into the key blob      (16-aligned)
    ...   valOff[nVal]   u64 byte offset into the value blob    (16-aligned)
    ...   keyBlob        keyBlobLen bytes of NUL-terminated ASCII (16-aligned)
    ...   valBlob        valBlobLen bytes of NUL-terminated ASCII (16-aligned)
                         and ends exactly at the chunk footer.

Node record, 48 bytes -- FULLY accounted for
--------------------------------------------
    +0x00 f32 x          world metres, same frame as telemetry and .owt
    +0x04 f32 y          height
    +0x08 f32 z
    +0x0c f32 nx  \
    +0x10 f32 ny   >     unit surface normal (|n|=1 for 100% of all nodes)
    +0x14 f32 nz  /
    +0x18 u16 tag        per-file unique 16-bit tag (see notes)
    +0x1a u8  deg0       small count, 0..4
    +0x1b u8  deg1       small count, 0..4
    +0x1c f16 width      HALF-FLOAT road width in metres (5.0 .. 30.0)
    +0x1e u16 pad        0 in every node of every file
    +0x20 u64 linkEnd    EXCLUSIVE end into link[]; this node's memberships are
                         link[linkEnd-deg0 : linkEnd]   (verified: linkEnd is the
                         running sum of deg0 for 38472/38473 Brio nodes)
    +0x28 u64 attrIdx    START index into attr[] of this node's own attribute run,
                         0xffffffffffffffff = none.  The run ends at the next
                         used start value (the starts partition attr[]).

RVAN payload (route files)
--------------------------
    0x10.. header, then 48-byte records:
        f32 x,y,z; f32 pad; f32 dx,dy,dz; f32 pad; u32 id; ...
    followed by a NUL-terminated name blob:
        start_line, start_location_000..011, finish_line
"""

import os
import struct

MAGIC_NAV = b'WVAN'
MAGIC_RACE = b'RVAN'
NODE_OFF = 0x90
NODE_SZ = 48
SPLINE_SZ = 24
LINK_SZ = 16
ATTR_SZ = 16
NONE64 = 0xFFFFFFFFFFFFFFFF


def _align16(x):
    return (x + 15) & ~15


def _f16(u):
    """IEEE-754 binary16 -> float."""
    return struct.unpack('<e', struct.pack('<H', u))[0]


class NavNode(object):
    __slots__ = ('i', 'x', 'y', 'z', 'nx', 'ny', 'nz', 'tag', 'deg0', 'deg1',
                 'width', 'link', 'attr')

    def __init__(self, i, vals):
        (self.x, self.y, self.z, self.nx, self.ny, self.nz,
         self.tag, self.deg0, self.deg1, wraw, _pad,
         self.link, self.attr) = vals
        self.i = i
        self.width = _f16(wraw)

    def __repr__(self):
        return ('<NavNode %d (%.1f,%.1f,%.1f) w=%.1f tag=%d link=%s attr=%s>' %
                (self.i, self.x, self.y, self.z, self.width, self.tag,
                 self.link if self.link != NONE64 else None,
                 self.attr if self.attr != NONE64 else None))


class NavFile(object):
    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as f:
            self.data = f.read()
        self.chunks = self._chunks()
        nav = [c for c in self.chunks if c['magic'] == MAGIC_NAV]
        if not nav:
            raise ValueError('%s: no WVAN chunk' % path)
        self.chunk = nav[0]
        d = self.data
        (self.nNode, self.nSpline, self.nLink, self.nLink2, self.nAttr,
         self.nKey, self.nVal, self.keyBlobLen, self.valBlobLen,
         self.w7c, self.w80, self.w84, self.w88,
         self.w8c) = struct.unpack_from('<14I', d, 0x58)
        self._layout()

    # -- container ---------------------------------------------------------
    def _chunks(self):
        out, off, d = [], 0, self.data
        while off + 16 <= len(d):
            mg, ver, h, sz = struct.unpack_from('<4sIII', d, off)
            if mg not in (MAGIC_NAV, MAGIC_RACE):
                break
            body = off + 16
            end = body + sz
            foot = d[end:end + 16]
            out.append(dict(magic=mg, ver=ver, hash=h, size=sz, body=body,
                            end=end, footer_ok=(foot == d[off:off + 16])))
            off = end + 16
        return out

    def _layout(self):
        end = self.chunk['end']
        self.valBlobOff = end - _align16(self.valBlobLen)
        self.keyBlobOff = self.valBlobOff - _align16(self.keyBlobLen)
        self.valOffOff = self.keyBlobOff - _align16(self.nVal * 8)
        self.keyOffOff = self.valOffOff - _align16(self.nKey * 8)
        self.attrOff = self.keyOffOff - _align16(self.nAttr * ATTR_SZ)
        self.nodesOff = NODE_OFF
        self.nodesEnd = NODE_OFF + self.nNode * NODE_SZ
        self.splineOff = self.nodesEnd
        self.linkOff = self.attrOff - self.nLink * LINK_SZ
        self.linkEnd = self.attrOff
        # memberNode[] is nLink u64 ending where link[] begins.  Its first two
        # entries alias the last spline record's (memberEnd, attrEnd) slots,
        # which the writer never fills in -- splines() reconstructs those.
        self.memberNodeOff = self.linkOff - self.nLink * 8

    # -- accessors ---------------------------------------------------------
    def nodes(self):
        d = self.data
        for i in range(self.nNode):
            o = NODE_OFF + i * NODE_SZ
            yield NavNode(i, struct.unpack_from('<6fHBBHHQQ', d, o))

    def links(self):
        """[(splineIndex, seqAlongSpline)] * nLink"""
        d = self.data
        return [struct.unpack_from('<2Q', d, self.linkOff + i * LINK_SZ)
                for i in range(self.nLink)]

    def splines(self):
        """[(memberCount, flagsB, idxC, memberEnd, attrEnd)] * nSpline.

        The final record's memberEnd/attrEnd overlap the memberNode[] array and
        are not written; they are reconstructed as nLink / nAttr."""
        d = self.data
        out = []
        for i in range(self.nSpline):
            o = self.splineOff + i * SPLINE_SZ
            if i == self.nSpline - 1:
                a, b, c = struct.unpack_from('<IHH', d, o)
                out.append((a, b, c, self.nLink, self.nAttr))
            else:
                out.append(struct.unpack_from('<IHHQQ', d, o))
        return out

    def member_nodes(self):
        """u64 node index per membership slot, nLink entries."""
        return list(struct.unpack_from('<%dQ' % self.nLink, self.data,
                                       self.memberNodeOff))

    def spline_table(self):
        """[{index, road_type, spline_profile, ..., nodes:[node index in order]}]"""
        sp = self.splines()
        mn = self.member_nodes()
        pairs = self.attr_pairs()
        out, pm, pa = [], 0, 0
        for s, (cnt, b, c, mend, aend) in enumerate(sp):
            rec = {'index': s, 'memberCount': cnt, 'flagsB': b, 'idxC': c}
            for k, v in pairs[pa:aend]:
                rec.setdefault(k, v)
            rec['attr_range'] = (pa, aend)
            rec['nodes'] = mn[pm:mend]
            pm, pa = mend, aend
            out.append(rec)
        return out

    def node_spline(self):
        """node index -> list of spline indices it belongs to."""
        lk = self.links()
        out = {}
        for nd in self.nodes():
            if nd.link == NONE64:
                continue
            out[nd.i] = [lk[j][0] for j in range(nd.link - nd.deg0, nd.link)]
        return out

    def _blob_strings(self, off, blen, offs_off, n):
        d = self.data
        blob = d[off:off + blen]
        offs = struct.unpack_from('<%dQ' % n, d, offs_off) if n else ()
        out = []
        for o in offs:
            e = blob.find(b'\x00', o)
            out.append(blob[o:e if e >= 0 else len(blob)].decode('latin1'))
        return out

    def keys(self):
        return self._blob_strings(self.keyBlobOff, self.keyBlobLen,
                                  self.keyOffOff, self.nKey)

    def values(self):
        return self._blob_strings(self.valBlobOff, self.valBlobLen,
                                  self.valOffOff, self.nVal)

    def attrs(self):
        """[(keyIndex, valueIndex)] * nAttr"""
        d = self.data
        return [struct.unpack_from('<2Q', d, self.attrOff + i * ATTR_SZ)
                for i in range(self.nAttr)]

    def attr_pairs(self):
        """[(keyString, valueString)] * nAttr"""
        k, v = self.keys(), self.values()
        return [(k[a] if a < len(k) else '?#%d' % a,
                 v[b] if b < len(v) else '?#%d' % b) for a, b in self.attrs()]

    # -- convenience -------------------------------------------------------
    def node_attrs(self, node, maxrun=64):
        """HEURISTIC.  node.attr is a start index into attr[]; the slice length
        is not resolved (deg1 correlates but is not the count).  This stops at
        the first repeated key.  Use spline_table() for anything load-bearing --
        the spline->attr mapping is exact and verified."""
        if node.attr == NONE64 or node.attr >= self.nAttr:
            return []
        pairs = self._pairs_cache()
        out, seen = [], set()
        for j in range(node.attr, min(self.nAttr, node.attr + maxrun)):
            k, v = pairs[j]
            if k in seen:
                break
            seen.add(k)
            out.append((k, v))
        return out

    def _pairs_cache(self):
        if not hasattr(self, '_pc'):
            self._pc = self.attr_pairs()
        return self._pc


def open_nav(path):
    return NavFile(path)


# ===========================================================================
# THE SURFACE LAYER
# ===========================================================================
#
# road_type -> paved or loose.  This is the split that matters for tuning: it picks the
# road bank or the offroad bank of List_TireCompound, and it decides whether a
# tarmac-grip slider recommendation is even valid.  It is NOT a vocabulary judgement --
# each class was placed by three independent measurements, all run over the whole corpus:
#
#   class      nodes  median width   median |y[i-1]-2y[i]+y[i+1]| on the .owt centre-line
#   freeway     3280      14.0 m       0.13 mm        <- smoothest
#   shortcut     184       7.0 m       0.46 mm
#   a          13034      12.0 m       1.22 mm
#   hidden      1181      12.0 m       1.40 mm
#   b          11831      10.0 m       1.85 mm
#   trail       4250       5.0 m       3.14 mm        <- 1.7x the roughest paved class
#   dirt        7113       9.0 m       4.52 mm
#
# and the spline_profile names agree: the paved classes carry a / b / ld_overpass_tarmac /
# urban_* / ld_rural_road_*, dirt carries a_gravel and ld_a_dirt_road, trail carries
# skislope_a1/b1/c1.  Roughness, width and the authored material name are three separate
# readings and they order the classes identically.
#
# 'evolving_world' is not a surface -- it is a road that changes with the world's weekly
# state.  Those 6 splines carry the real class in a second key, evolving_world_road_type
# ('b' on 4, 'hidden' on 2), and resolve() follows that indirection.  This is what makes
# the Edamame Circuit come out paved instead of unclassified.

PAVED = ('a', 'b', 'freeway', 'hidden', 'shortcut')
LOOSE = ('dirt', 'trail')

SURFACE_OF = dict([(k, 'paved') for k in PAVED] + [(k, 'loose') for k in LOOSE])

# OffRoadness as media/physics/NatalSurfaceTypes.xml spells it: 0 = tarmac tyre model,
# 1 = offroad tyre model.  Stored as an integer so it joins the compound tables directly.
OFFROAD_OF = {'paved': 0, 'loose': 1}

BRIO_NAV = (r'C:\XboxGames\Forza Horizon 6\Content\media\openworld\brio'
            r'\freeroam\Brio_00.nav')


def road_type_of(spline):
    """The class of one spline record, following the evolving_world indirection."""
    rt = spline.get('road_type')
    if rt == 'evolving_world':
        rt = spline.get('evolving_world_road_type') or rt
    return rt


class SurfaceIndex(object):
    """World position -> road surface, from the free-roam road graph.

    Built once from Brio_00.nav (38,473 nodes / 1,532 splines), then queried per point.
    A node is a point ON a road, spaced about 20 m along it, so `at()` answers "which road
    am I on" and the returned distance is how far the query sat from the nearest node of
    that road -- typically a few metres for a point on the centre-line, not an error.
    """

    CELL = 32.0

    def __init__(self, path=BRIO_NAV):
        self.path = path
        nv = open_nav(path)
        self.nav = nv
        self.nodes = list(nv.nodes())
        self.rt = {}
        self.profile = {}
        self.level = {}
        for s in nv.spline_table():
            rt = road_type_of(s)
            pf = s.get('spline_profile')
            lv = s.get('road_level')
            for ni in s['nodes']:
                if ni < len(self.nodes):
                    self.rt.setdefault(ni, rt)
                    self.profile.setdefault(ni, pf)
                    self.level.setdefault(ni, lv)
        self.grid = {}
        for nd in self.nodes:
            self.grid.setdefault((int(nd.x // self.CELL), int(nd.z // self.CELL)),
                                 []).append(nd.i)

    def nearest(self, x, z, max_m=25.0):
        """-> (node index, distance m) or (None, None)."""
        rad = int(max_m // self.CELL) + 1
        cx, cz = int(x // self.CELL), int(z // self.CELL)
        best, bd = None, max_m * max_m
        for dx in range(-rad, rad + 1):
            for dz in range(-rad, rad + 1):
                for ni in self.grid.get((cx + dx, cz + dz), ()):
                    nd = self.nodes[ni]
                    d = (nd.x - x) ** 2 + (nd.z - z) ** 2
                    if d < bd:
                        best, bd = ni, d
        return (best, bd ** 0.5) if best is not None else (None, None)

    def at(self, x, z, max_m=25.0):
        """-> dict(road_type, road_profile, road_level, surface, offroad, width_m, nav_m)
        or None when nothing in the free-roam graph is within max_m."""
        ni, d = self.nearest(x, z, max_m)
        if ni is None:
            return None
        rt = self.rt.get(ni)
        surf = SURFACE_OF.get(rt)
        return {'node': ni, 'road_type': rt, 'road_profile': self.profile.get(ni),
                'road_level': self.level.get(ni), 'surface': surf,
                'offroad': OFFROAD_OF.get(surf), 'width_m': self.nodes[ni].width,
                'nav_m': round(d, 2)}


if __name__ == '__main__':
    import sys
    args = sys.argv[1:] or [BRIO_NAV]
    for p in args:
        n = open_nav(p)
        print('%s  nodes=%d links=%d attrs=%d keys=%d vals=%d' %
              (os.path.basename(p), n.nNode, n.nLink, n.nAttr, n.nKey, n.nVal))
        print('  chunks:', [(c['magic'].decode(), c['size'], c['footer_ok'])
                            for c in n.chunks])
        print('  keys:', n.keys())
        tbl = n.spline_table()
        hist = {}
        for s in tbl:
            rt = road_type_of(s)
            hist[rt] = hist.get(rt, 0) + len(s['nodes'])
        if hist:
            print('  road_type (nodes):', sorted(hist.items(), key=lambda kv: -kv[1]))
