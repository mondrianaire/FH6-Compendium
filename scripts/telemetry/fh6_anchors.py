#!/usr/bin/env python3
"""fh6_anchors.py -- the game's race-activation spheres: a ROUTE ID pinned to a world position.

    media/tracks/brio/triggerzones/tz_race_activations/race_triggers.tz

is 14 KB of plaintext XML shipped with the game: 36 spheres named ``race_trigger_zone_rt<N>``,
radius 100 m, in the same metre frame the UDP telemetry and Route<N>.owt use. ``<N>`` is a
``ref_route.route_id`` -- the only id field in the shipped data that is populated (Tracks.Route is
0 on every row, every .nt locator GUID is "0"). Found by the data-audit session, 2026-09-05;
verified here: 36/36 ids resolve, median 10.6 m from their own centre-line, 27 of 36 within 50 m.

What a sphere proves, and what it does not. A session event whose START lies inside ``rt<N>`` began
where route N's race begins. That is an observation, not a shape comparison, so it is the strongest
identity evidence there is for THAT route -- but 33 of the 36 spheres have another route's
centre-line inside 100 m (route 131's sits 0.3 m from route 5555's), so presence in a sphere does
not by itself say which of the overlapping roads was then driven. The anchor therefore
CORROBORATES geometry and breaks its ties (import_course_match.py); it never names anything
(import_route_names.py reads verified/probable identities only).

READ-ONLY. Never writes to the game install.
"""
import math
import os
import re
import xml.etree.ElementTree as ET

TZ_PATH = (r"C:\XboxGames\Forza Horizon 6\Content\media\tracks\brio\triggerzones"
           r"\tz_race_activations\race_triggers.tz")
NAME_RE = re.compile(r"^race_trigger_zone_rt(\d+)$")


def parse(text):
    """[{route_id, name, x, y, z, radius_m}] from the file's text. Zones whose name is not
    race_trigger_zone_rt<N> are skipped (there are none in the shipped file; the guard is for a
    future edit). radius_m is the sphere's x size; the file writes 100.0 on every zone."""
    root = ET.fromstring(text)
    out = []
    for z in root.iter("triggerzone"):
        m = NAME_RE.match(z.get("name") or "")
        if not m or z.get("type") != "sphere":
            continue
        pos, size = z.find("position"), z.find("size")
        if pos is None or size is None:
            continue
        out.append({"route_id": str(int(m.group(1))), "name": z.get("name"),
                    "x": float(pos.get("x")), "y": float(pos.get("y")), "z": float(pos.get("z")),
                    "radius_m": float(size.get("x"))})
    return out


def load(path=TZ_PATH):
    """The anchors on disk, or [] when the install is not there (the lab must run without the game)."""
    if not path or not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig") as fh:
        return parse(fh.read())


def nearest(anchors, x, z):
    """(anchor, distance_m) of the closest sphere centre, or (None, None)."""
    best, bd = None, None
    for a in anchors:
        d = math.hypot(a["x"] - x, a["z"] - z)
        if bd is None or d < bd:
            best, bd = a, d
    return best, bd


def inside(anchors, x, z):
    """The ONE anchor whose sphere contains (x, z), or None. 35 of the 36 shipped pairs of centres
    are over 200 m apart; routes 2311 and 311 sit 153.8 m apart, so their spheres share a ~46 m
    lens. A point inside two spheres is not single-sphere evidence and resolves to None rather
    than to the nearer centre."""
    hits = [a for a in anchors if math.hypot(a["x"] - x, a["z"] - z) <= a["radius_m"]]
    return hits[0] if len(hits) == 1 else None


if __name__ == "__main__":
    import sys
    A = load(sys.argv[1] if len(sys.argv) > 1 else TZ_PATH)
    print("%d anchors" % len(A))
    for a in A:
        print("  rt%-6s x=%9.1f z=%9.1f r=%.0f" % (a["route_id"], a["x"], a["z"], a["radius_m"]))
