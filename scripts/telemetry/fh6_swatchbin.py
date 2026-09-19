#!/usr/bin/env python3
"""
fh6_swatchbin.py -- decode Forza Horizon 6 ``.swatchbin`` UI textures to PNG.

Pure standard library (struct, zlib, zipfile). No numpy, no PIL.

Container ("Grub" bundle, little-endian throughout)::

    0x00  b'burG'
    0x04  U32 version/flags (0x101)
    0x08  U32 header size == payload offset (140 for every observed file)
    0x0C  U32 total file size
    0x10  U32 chunk count (1)
    0x14  b'BCXT'  U32 0x10000  U32 44 (TXCH offset)  U32 data offset  U32 data size  U32 data size
    0x2C  b'HCXT'  then 12 x U32:
          [525696, 56, 80, 0, 0, 0, 16777216, WIDTH, HEIGHT, 1, 0x06010001, 0]
    0x8C  pixel payload to EOF

The payload is DXGI_FORMAT_BC7_UNORM: 16-byte 4x4 blocks, linear row-major,
top-left block first, exactly one mip level (no mip chain in any of the 902
entries of Upgrade_Parts.zip).  Widths that are not a multiple of 4 are padded
to the next block boundary (e.g. the 670-wide tune thumbnails carry 672 px).

Usage::

    python fh6_swatchbin.py <zip-or-file> [entry-glob] --out <dir>   dump PNGs
    python fh6_swatchbin.py <zip>          [entry-glob] --list        list entries
    python fh6_swatchbin.py <zip-or-file>  [entry-glob] --modes       BC7 mode histogram

``entry-glob`` is a fnmatch pattern against the zip entry name (case-insensitive,
``*`` matches across ``/``).  A bare ``.swatchbin`` (or any Grub file) may be
given instead of a zip.

BC7 reference: Microsoft "BC7 Format" (Direct3D 11 texture block compression
docs) and Khronos KHR_texture_compression_bptc, whose tables are reproduced
below.  Bits are read LSB-first across the 128-bit block, i.e. the block is
treated as one little-endian 128-bit integer and consumed from bit 0 upward.
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import struct
import sys
import time
import zipfile
import zlib
from typing import Dict, Iterable, List, Optional, Tuple

# --------------------------------------------------------------------------- #
# BC7 tables
# --------------------------------------------------------------------------- #

# Per-mode layout, in bitstream order after the mode bits:
#   subsets, partition bits, rotation bits, index-selection bits,
#   colour bits/endpoint/channel, alpha bits/endpoint,
#   per-endpoint P-bits (1 per endpoint), shared P-bits (1 per subset),
#   primary index bits, secondary index bits (modes 4/5 only).
_MODE_INFO = (
    # ns pb rb isb cb ab epb spb ib ib2
    (3, 4, 0, 0, 4, 0, 1, 0, 3, 0),  # mode 0
    (2, 6, 0, 0, 6, 0, 0, 1, 3, 0),  # mode 1
    (3, 6, 0, 0, 5, 0, 0, 0, 2, 0),  # mode 2
    (2, 6, 0, 0, 7, 0, 1, 0, 2, 0),  # mode 3
    (1, 0, 2, 1, 5, 6, 0, 0, 2, 3),  # mode 4
    (1, 0, 2, 0, 7, 8, 0, 0, 2, 2),  # mode 5
    (1, 0, 0, 0, 7, 7, 1, 0, 4, 0),  # mode 6
    (2, 6, 0, 0, 5, 5, 1, 0, 2, 0),  # mode 7
)

_WEIGHTS = {
    2: (0, 21, 43, 64),
    3: (0, 9, 18, 27, 37, 46, 55, 64),
    4: (0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64),
}

# Two-subset partition table (64 partitions x 16 pixels, pixel = y*4 + x).
_PARTITIONS_2 = (
    (0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1),
    (0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1),
    (0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1),
    (0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1),
    (0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1),
    (0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1),
    (0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1),
    (0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1),
    (0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0),
    (0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0),
    (0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0),
    (0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0),
    (0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0),
    (0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0),
    (0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1),
    (0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0),
    (0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0),
    (0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0),
    (0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0),
    (0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0),
    (0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0),
    (0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0),
    (0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0),
    (0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1),
    (0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1),
    (0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0),
    (0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0),
    (0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0),
    (0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0),
    (0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1),
    (0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1),
    (0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0),
    (0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0),
    (0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0),
    (0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0),
    (0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0),
    (0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1),
    (0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1),
    (0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0),
    (0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0),
    (0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0),
    (0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0),
    (0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0),
    (0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1),
    (0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1),
    (0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0),
    (0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0),
    (0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1),
    (0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1),
    (0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1),
    (0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1),
    (0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1),
    (0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0),
    (0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0),
    (0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1),
)

# Three-subset partition table (64 x 16).
_PARTITIONS_3 = (
    (0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 1, 2, 2, 2, 2),
    (0, 0, 0, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 2, 1),
    (0, 0, 0, 0, 2, 0, 0, 1, 2, 2, 1, 1, 2, 2, 1, 1),
    (0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 1, 0, 1, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2),
    (0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 2, 2),
    (0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1),
    (0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1),
    (0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2),
    (0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2),
    (0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2),
    (0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2),
    (0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2),
    (0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2),
    (0, 0, 1, 1, 0, 1, 1, 2, 1, 1, 2, 2, 1, 2, 2, 2),
    (0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0, 2, 2, 2, 0),
    (0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 2, 1, 1, 2, 2),
    (0, 1, 1, 1, 0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0),
    (0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2),
    (0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 1, 1),
    (0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2, 0, 2, 2, 2),
    (0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 2, 1, 2, 2, 2, 1),
    (0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 0, 1, 2, 2),
    (0, 0, 0, 0, 1, 1, 0, 0, 2, 2, 1, 0, 2, 2, 1, 0),
    (0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1, 0, 0, 0, 0),
    (0, 0, 1, 2, 0, 0, 1, 2, 1, 1, 2, 2, 2, 2, 2, 2),
    (0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1, 0, 1, 1, 0),
    (0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1),
    (0, 0, 2, 2, 1, 1, 0, 2, 1, 1, 0, 2, 0, 0, 2, 2),
    (0, 1, 1, 0, 0, 1, 1, 0, 2, 0, 0, 2, 2, 2, 2, 2),
    (0, 0, 1, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1),
    (0, 0, 0, 0, 2, 0, 0, 0, 2, 2, 1, 1, 2, 2, 2, 1),
    (0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 2, 2, 2),
    (0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 2, 0, 0, 1, 1),
    (0, 0, 1, 1, 0, 0, 1, 2, 0, 0, 2, 2, 0, 2, 2, 2),
    (0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0),
    (0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0),
    (0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0),
    (0, 1, 2, 0, 2, 0, 1, 2, 1, 2, 0, 1, 0, 1, 2, 0),
    (0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2, 0, 0, 1, 1),
    (0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 1, 1),
    (0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2),
    (0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1),
    (0, 0, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2, 1, 1, 2, 2),
    (0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 1, 1),
    (0, 2, 2, 0, 1, 2, 2, 1, 0, 2, 2, 0, 1, 2, 2, 1),
    (0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 0, 1, 0, 1),
    (0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1),
    (0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2),
    (0, 2, 2, 2, 0, 1, 1, 1, 0, 2, 2, 2, 0, 1, 1, 1),
    (0, 0, 0, 2, 1, 1, 1, 2, 0, 0, 0, 2, 1, 1, 1, 2),
    (0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2),
    (0, 2, 2, 2, 0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2),
    (0, 0, 0, 2, 1, 1, 1, 2, 1, 1, 1, 2, 0, 0, 0, 2),
    (0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2),
    (0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 1, 2),
    (0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2, 2, 2, 2, 2),
    (0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2),
    (0, 0, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2),
    (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2),
    (0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1),
    (0, 2, 2, 2, 1, 2, 2, 2, 0, 2, 2, 2, 1, 2, 2, 2),
    (0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2),
    (0, 1, 1, 1, 2, 0, 1, 1, 2, 2, 0, 1, 2, 2, 2, 0),
)

_PARTITIONS_1 = ((0,) * 16,)

# Anchor (fix-up) index of the second subset, two-subset partitions.
_ANCHOR_2 = (
    15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
    15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
    15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6,
    6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
)

# Anchor index of the second subset, three-subset partitions.
_ANCHOR_3A = (
    3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3,
    3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
    8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15,
    3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
)

# Anchor index of the third subset, three-subset partitions.
_ANCHOR_3B = (
    15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8,
    15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
    15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8,
    15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
)


def _self_check_tables() -> None:
    """Cheap structural consistency check on the hand-typed tables."""
    assert len(_PARTITIONS_2) == 64 and len(_PARTITIONS_3) == 64
    assert len(_ANCHOR_2) == 64 and len(_ANCHOR_3A) == 64 and len(_ANCHOR_3B) == 64
    for p, tbl in enumerate(_PARTITIONS_2):
        assert len(tbl) == 16 and tbl[0] == 0 and set(tbl) == {0, 1}, p
        assert tbl[_ANCHOR_2[p]] == 1, ("2-subset anchor not in subset 1", p)
    for p, tbl in enumerate(_PARTITIONS_3):
        assert len(tbl) == 16 and tbl[0] == 0 and set(tbl) == {0, 1, 2}, p
        assert tbl[_ANCHOR_3A[p]] == 1, ("3-subset anchor A not in subset 1", p)
        assert tbl[_ANCHOR_3B[p]] == 2, ("3-subset anchor B not in subset 2", p)


_self_check_tables()

# Precomputed per (subsets, partition): (partition row, anchor pixel set).
_LAYOUT: Dict[Tuple[int, int], Tuple[Tuple[int, ...], frozenset]] = {}
for _p in range(64):
    _LAYOUT[(2, _p)] = (_PARTITIONS_2[_p], frozenset((0, _ANCHOR_2[_p])))
    _LAYOUT[(3, _p)] = (_PARTITIONS_3[_p], frozenset((0, _ANCHOR_3A[_p], _ANCHOR_3B[_p])))
_LAYOUT[(1, 0)] = (_PARTITIONS_1[0], frozenset((0,)))

_TRANSPARENT_BLOCK = bytes(64)


# --------------------------------------------------------------------------- #
# BC7 block decode
# --------------------------------------------------------------------------- #

def _unquant(x: int, bits: int) -> int:
    """Expand a `bits`-wide endpoint component to 8 bits (shift up, OR high bits)."""
    return ((x << (8 - bits)) | (x >> (2 * bits - 8))) & 0xFF


def decode_bc7_block(block: bytes, mode_counts: Optional[list] = None) -> bytes:
    """Decode one 16-byte BC7 block to 64 bytes of RGBA8 (16 pixels, row-major).

    Reserved mode (low byte == 0) decodes to transparent black, as D3D does.
    """
    v = int.from_bytes(block, "little")
    if v & 0xFF == 0:
        if mode_counts is not None:
            mode_counts[8] += 1
        return _TRANSPARENT_BLOCK

    mode = 0
    while not (v >> mode) & 1:
        mode += 1
    if mode_counts is not None:
        mode_counts[mode] += 1
    pos = mode + 1

    ns, pb, rb, isb, cb, ab, epb, spb, ib, ib2 = _MODE_INFO[mode]

    partition = (v >> pos) & ((1 << pb) - 1)
    pos += pb
    rotation = (v >> pos) & ((1 << rb) - 1)
    pos += rb
    idx_sel = (v >> pos) & 1 if isb else 0
    pos += isb

    nch = 4 if ab else 3
    # eps[subset][endpoint] = [r, g, b, a] (raw quantised values)
    eps = [[[0, 0, 0, 0] for _ in range(2)] for _ in range(ns)]
    for c in range(nch):
        bits = cb if c < 3 else ab
        mask = (1 << bits) - 1
        for s in range(ns):
            for e in range(2):
                eps[s][e][c] = (v >> pos) & mask
                pos += bits

    # P-bits: one per endpoint (modes 0, 3, 6, 7) or one per subset (mode 1).
    if epb:
        for s in range(ns):
            for e in range(2):
                p = (v >> pos) & 1
                pos += 1
                ep = eps[s][e]
                for c in range(nch):
                    ep[c] = (ep[c] << 1) | p
        cbits, abits = cb + 1, ab + 1
    elif spb:
        for s in range(ns):
            p = (v >> pos) & 1
            pos += 1
            for e in range(2):
                ep = eps[s][e]
                for c in range(nch):
                    ep[c] = (ep[c] << 1) | p
        cbits, abits = cb + 1, ab + 1
    else:
        cbits, abits = cb, ab

    # Unquantise endpoints to 8 bits.
    for s in range(ns):
        for e in range(2):
            ep = eps[s][e]
            ep[0] = _unquant(ep[0], cbits)
            ep[1] = _unquant(ep[1], cbits)
            ep[2] = _unquant(ep[2], cbits)
            ep[3] = _unquant(ep[3], abits) if ab else 255

    part, anchors = _LAYOUT[(ns, partition)]

    # Primary index set (anchor pixels carry one bit fewer).
    idx1 = [0] * 16
    full = (1 << ib) - 1
    short = (1 << (ib - 1)) - 1
    for i in range(16):
        if i in anchors:
            idx1[i] = (v >> pos) & short
            pos += ib - 1
        else:
            idx1[i] = (v >> pos) & full
            pos += ib

    if ib2:
        # Secondary index set (modes 4 and 5), single subset, anchor = pixel 0.
        idx2 = [0] * 16
        full2 = (1 << ib2) - 1
        idx2[0] = (v >> pos) & ((1 << (ib2 - 1)) - 1)
        pos += ib2 - 1
        for i in range(1, 16):
            idx2[i] = (v >> pos) & full2
            pos += ib2
        # Index-selection bit swaps which set drives colour and which drives alpha.
        if idx_sel:
            cidx, cbits_w = idx2, ib2
            aidx, abits_w = idx1, ib
        else:
            cidx, cbits_w = idx1, ib
            aidx, abits_w = idx2, ib2
        cw = _WEIGHTS[cbits_w]
        aw = _WEIGHTS[abits_w]
        e0, e1 = eps[0]
        r0, g0, b0, a0 = e0
        r1, g1, b1, a1 = e1
        cpal = [
            (((64 - w) * r0 + w * r1 + 32) >> 6,
             ((64 - w) * g0 + w * g1 + 32) >> 6,
             ((64 - w) * b0 + w * b1 + 32) >> 6)
            for w in cw
        ]
        apal = [((64 - w) * a0 + w * a1 + 32) >> 6 for w in aw]
        out = bytearray(64)
        o = 0
        for i in range(16):
            r, g, b = cpal[cidx[i]]
            a = apal[aidx[i]]
            # Rotation swaps alpha with one colour channel, after interpolation.
            if rotation == 1:
                r, a = a, r
            elif rotation == 2:
                g, a = a, g
            elif rotation == 3:
                b, a = a, b
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = a
            o += 4
        return bytes(out)

    # Single index set: one palette per subset.
    wts = _WEIGHTS[ib]
    pals = []
    for s in range(ns):
        e0, e1 = eps[s]
        r0, g0, b0, a0 = e0
        r1, g1, b1, a1 = e1
        pals.append([
            bytes((((64 - w) * r0 + w * r1 + 32) >> 6,
                   ((64 - w) * g0 + w * g1 + 32) >> 6,
                   ((64 - w) * b0 + w * b1 + 32) >> 6,
                   ((64 - w) * a0 + w * a1 + 32) >> 6))
            for w in wts
        ])
    out = bytearray(64)
    o = 0
    for i in range(16):
        out[o:o + 4] = pals[part[i]][idx1[i]]
        o += 4
    return bytes(out)


def decode_bc7(payload: bytes, width: int, height: int,
               mode_counts: Optional[list] = None) -> bytes:
    """Decode a linear BC7 block stream to RGBA8 bytes (row-major, width*height*4).

    Blocks are 4x4, ordered left-to-right then top-to-bottom.  Only the first
    mip level is read; a short payload is padded with transparent blocks.
    ``mode_counts`` (a list of 9 ints, index 8 = reserved) is accumulated if given.
    """
    bw = (width + 3) // 4
    bh = (height + 3) // 4
    need = bw * bh * 16
    if len(payload) < need:
        payload = payload + bytes(need - len(payload))
    stride = width * 4
    out = bytearray(width * height * 4)
    src = 0
    for by in range(bh):
        y0 = by * 4
        rows = min(4, height - y0)
        for bx in range(bw):
            px = decode_bc7_block(payload[src:src + 16], mode_counts)
            src += 16
            x0 = bx * 4
            cols = min(4, width - x0)
            base = y0 * stride + x0 * 4
            if cols == 4:
                for r in range(rows):
                    o = base + r * stride
                    out[o:o + 16] = px[r * 16:r * 16 + 16]
            else:
                n = cols * 4
                for r in range(rows):
                    o = base + r * stride
                    out[o:o + n] = px[r * 16:r * 16 + n]
    return bytes(out)


# --------------------------------------------------------------------------- #
# Grub container
# --------------------------------------------------------------------------- #

def parse_grub(data: bytes) -> Tuple[int, int, bytes]:
    """Return (width, height, payload) from a Grub/TXCH texture bundle.

    The TXCH header ('HCXT' fourcc + 12 U32) carries width at +4+4*7 and
    height at +4+4*8.  The payload offset is the U32 at byte 8 of the Grub
    header (140 in every observed file); it falls back to 140 if implausible.
    """
    if data[:4] != b"burG":
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            raise ValueError("not a Grub bundle: already a WebP image (RIFF/WEBP), use it as-is")
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            raise ValueError("not a Grub bundle: already a PNG image, use it as-is")
        raise ValueError("not a Grub bundle (magic %r, expected b'burG')" % (data[:4],))
    i = data.find(b"HCXT")
    if i < 0:
        raise ValueError("no TXCH chunk")
    width = struct.unpack_from("<I", data, i + 4 + 4 * 7)[0]
    height = struct.unpack_from("<I", data, i + 4 + 4 * 8)[0]
    off = struct.unpack_from("<I", data, 8)[0]
    if off < i + 4 + 48 or off >= len(data):
        off = 140
    return width, height, data[off:]


def grub_info(data: bytes) -> Dict[str, int]:
    """Header fields worth listing: width, height, payload size, expected size."""
    w, h, payload = parse_grub(data)
    need = ((w + 3) // 4) * ((h + 3) // 4) * 16
    fmt = struct.unpack_from("<I", data, data.find(b"HCXT") + 4 + 4 * 10)[0]
    return {"width": w, "height": h, "payload": len(payload), "expected": need, "fmt": fmt}


# --------------------------------------------------------------------------- #
# PNG writer
# --------------------------------------------------------------------------- #

def _png_chunk(tag: bytes, body: bytes) -> bytes:
    return (struct.pack(">I", len(body)) + tag + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))


def to_png(rgba: bytes, w: int, h: int) -> bytes:
    """Encode RGBA8 (row-major, no padding) as an 8-bit RGBA PNG (colour type 6)."""
    if len(rgba) != w * h * 4:
        raise ValueError("rgba length %d != %d*%d*4" % (len(rgba), w, h))
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0 (None)
        raw += rgba[y * stride:(y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + _png_chunk(b"IHDR", ihdr)
            + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 6))
            + _png_chunk(b"IEND", b""))


def decode_to_png(data: bytes, mode_counts: Optional[list] = None) -> Tuple[bytes, int, int]:
    """Grub bytes -> (png bytes, width, height)."""
    w, h, payload = parse_grub(data)
    rgba = decode_bc7(payload, w, h, mode_counts)
    return to_png(rgba, w, h), w, h


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _iter_entries(source: str, pattern: Optional[str]) -> Iterable[Tuple[str, bytes]]:
    """Yield (name, bytes) for the zip entries (or the single file) matching pattern."""
    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                if pattern and not fnmatch.fnmatch(name.lower(), pattern.lower()):
                    continue
                yield name, z.read(info)
    else:
        with open(source, "rb") as f:
            yield os.path.basename(source), f.read()


def _entry_out_path(out_dir: str, name: str) -> str:
    # Replace whatever extension the entry has (.swatchbin, or the misleading
    # .png the game gives its Grub-wrapped tune thumbnails) with .png.
    rel = os.path.splitext(name.replace("\\", "/"))[0]
    return os.path.join(out_dir, *rel.split("/")) + ".png"


def _worker(args: Tuple[str, bytes, str]) -> Tuple[str, Optional[str], List[int], float]:
    """Decode one entry and write its PNG; returns (name, error, mode_counts, seconds)."""
    name, data, out_path = args
    counts = [0] * 9
    t0 = time.perf_counter()
    try:
        png, _, _ = decode_to_png(data, counts)
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(png)
        return name, None, counts, time.perf_counter() - t0
    except Exception as exc:  # report, do not abort the batch
        return name, "%s: %s" % (type(exc).__name__, exc), counts, time.perf_counter() - t0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Decode FH6 .swatchbin (Grub/TXCH + BC7) textures to PNG.")
    ap.add_argument("source", help="Upgrade_Parts.zip (or any zip of swatchbins) or a single Grub file")
    ap.add_argument("pattern", nargs="?", default=None,
                    help="fnmatch glob against the zip entry name (case-insensitive), e.g. 'Platform_Handling/*'")
    ap.add_argument("--out", metavar="DIR", help="directory to write <entry>.png files into")
    ap.add_argument("--list", action="store_true", help="list matching entries with dimensions and sizes")
    ap.add_argument("--modes", action="store_true", help="print the BC7 block-mode histogram per entry and in total")
    ap.add_argument("--jobs", type=int, default=0,
                    help="worker processes for --out (default: cpu count for zips, 1 for a single file)")
    ns = ap.parse_args(argv)

    if not (ns.list or ns.modes or ns.out):
        ap.error("one of --out DIR, --list or --modes is required")

    entries = list(_iter_entries(ns.source, ns.pattern))
    if not entries:
        print("no entries match", file=sys.stderr)
        return 1

    if ns.list:
        total = 0
        for name, data in entries:
            try:
                info = grub_info(data)
                flag = "" if info["payload"] == info["expected"] else "  (payload %+d)" % (info["payload"] - info["expected"])
                print("%-60s %5dx%-5d %8d bytes  fmt=0x%08X%s" % (
                    name, info["width"], info["height"], len(data), info["fmt"], flag))
            except Exception as exc:
                print("%-60s ERROR %s" % (name, exc))
            total += len(data)
        print("%d entries, %d bytes" % (len(entries), total))
        return 0

    if ns.modes and not ns.out:
        total = [0] * 9
        for name, data in entries:
            counts = [0] * 9
            w, h, payload = parse_grub(data)
            decode_bc7(payload, w, h, counts)
            for k in range(9):
                total[k] += counts[k]
            print("%-60s %dx%d  modes=%s" % (name, w, h, counts))
        print("TOTAL modes 0..7, reserved:", total)
        return 0

    # --out: dump PNGs (optionally in parallel).
    out_dir = ns.out
    os.makedirs(out_dir, exist_ok=True)
    jobs = ns.jobs or ((os.cpu_count() or 1) if len(entries) > 1 else 1)
    work = [(name, data, _entry_out_path(out_dir, name)) for name, data in entries]
    t0 = time.perf_counter()
    results = []
    if jobs > 1 and len(work) > 1:
        import multiprocessing
        with multiprocessing.Pool(jobs) as pool:
            for res in pool.imap_unordered(_worker, work, chunksize=4):
                results.append(res)
    else:
        for item in work:
            results.append(_worker(item))
    elapsed = time.perf_counter() - t0

    total = [0] * 9
    failed = []
    for name, err, counts, _ in results:
        if err:
            failed.append((name, err))
        for k in range(9):
            total[k] += counts[k]
    ok = len(results) - len(failed)
    print("decoded %d/%d entries to %s in %.1fs (%d workers)" % (ok, len(results), out_dir, elapsed, jobs))
    if ns.modes:
        print("block modes 0..7, reserved:", total)
    for name, err in failed:
        print("FAILED %s: %s" % (name, err))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
