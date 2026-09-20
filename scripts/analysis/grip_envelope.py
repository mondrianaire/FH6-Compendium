#!/usr/bin/env python
"""THE GRIP ENVELOPE OF A BUILD — the maximum speed its tyres hold at any given turn radius.

Jett, 2026-09-18: "Every single car/build/tune has a maximum force the tires can hold before losing grip.
As the current turn angle and speed go up (sharper turn), they multiply to a maximum value and then grip is
lost in the tire. Theoretically, we could create a chart for every single build that shows the MAXIMUM speed
the tires can hold grip at any given turn angle."

That is exactly right, and the data already holds it. a_lat = v^2 / R, so for a tyre ceiling a_max the
fastest a build can hold a radius R is v_max = sqrt(a_max * g * R). Two things make the real envelope more
interesting than that one curve, and BOTH are visible in the measurements:

  1. GRIP-LIMITED, at tight radii. v_max really does follow sqrt(R), and the measured a_max is strikingly
     constant per build across radii (one A-class AWD build: lat_g p95 = 2.93-2.97 g everywhere from 18 m
     to 120 m). That flat number IS the tyre ceiling Jett describes.
  2. POWER-LIMITED, once the radius opens out. Past some radius the car simply cannot reach the speed the
     tyres would allow, and the envelope stops rising: the same build's held speed saturates at ~112 mph
     from 120 m outward while the sqrt curve keeps climbing. The RADIUS WHERE THE TWO MEET is the tightest
     corner that build can take flat out -- a single number that says a great deal about it.

So the envelope is min(sqrt(a_max * g * R), v_top), and the chart is that curve with the build's own
observations behind it.

WHAT IS MEASURED AND WHAT IS MODELLED
  r_m    lap_point.r_m   -- the DRIVEN radius, r = v / yaw_rate, computed at the full 60 Hz capture rate
                            (schema 9). Not geometry: stored x/z are rounded, and differencing them
                            fabricates curvature (the analyzer measured a +3.3 g median error that way).
  lat_g  lap_point.lat_g -- the recorded peak |lateral g| over the frames each point spans (schema 7).
  grip   lap_point.grip  -- 0 within grip, 1 front, 2 rear, 3 both, 4 impact.
  a_max  MEASURED, as a high quantile of lat_g over the samples that were actually loading the tyres.
  v_top  MEASURED, as a high quantile of observed speed.

THE ONE HONEST CAVEAT, stated in the output so no reader misses it: "share of samples that lost grip" is
a fact about the DRIVING as much as the build -- at a 20 m radius the driver is always near the limit, so
almost every sample shows slip. The build's own ceiling comes from lat_g and the speed plateau, which do
not care how hard the corner was attacked; the loss share is carried alongside as context, never as the
ceiling itself.

Read-only against the database. Writes data/grip-envelope.json.
"""
from __future__ import annotations
import argparse
import json
import math
import os
import sqlite3
import statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MPS = 0.44704
G = 9.80665

# log-spaced radius bins: a hairpin and a sweeper live at very different scales and a linear axis
# spends all its room on the sweepers, which are the part that tells you least.
EDGES = [8, 12, 18, 26, 38, 55, 80, 120, 180, 270, 400, 600, 1000, 1600]
# speed bands, matching the shape of the course export's own classGrip bands, so a build's ceiling can be
# compared with its class's. Downforce, if a build has it, shows up as a_max rising across these.
SPEED_BANDS = [(0, 70), (70, 110), (110, None)]


def q(sorted_vals, p):
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, int(p * (len(sorted_vals) - 1)))]


def envelope_for(rows):
    """One build's envelope. rows: (r_m, mph, grip, lat_g)."""
    lat_all = sorted(r[3] for r in rows if r[3] is not None)
    if len(lat_all) < 200:
        return None
    # THE TYRE CEILING. Taken over CORNERING samples only -- a straight-line sample carries no lateral load
    # and would drag the quantile down however grippy the car is. 400 m is where the measured lat_g starts
    # falling for every build looked at, which is the power limit biting, not the tyres giving up.
    corner = sorted(r[3] for r in rows if r[3] is not None and r[0] is not None and r[0] < 400)
    a_p95 = q(corner, .95)
    a_p99 = q(corner, .99)
    # per speed band, so downforce (a_max rising with speed) is visible rather than averaged away
    bands = []
    for lo, hi in SPEED_BANDS:
        sel = sorted(r[3] for r in rows
                     if r[3] is not None and r[0] is not None and r[0] < 400
                     and r[1] is not None and r[1] >= lo and (hi is None or r[1] < hi))
        if len(sel) >= 60:
            bands.append({"lo": lo, "hi": hi, "n": len(sel), "aMax": round(q(sel, .95), 3)})
    speeds = sorted(r[1] for r in rows if r[1] is not None)
    v_top = q(speeds, .98)

    bins = []
    for lo, hi in zip(EDGES, EDGES[1:]):
        sel = [r for r in rows if r[0] is not None and lo <= r[0] < hi]
        if len(sel) < 30:
            continue
        held = sorted(r[1] for r in sel if r[2] == 0 and r[1] is not None)
        lost = sorted(r[1] for r in sel if r[2] in (1, 2, 3) and r[1] is not None)
        lat = sorted(r[3] for r in sel if r[3] is not None)
        # which way it lets go here, when it does -- the same three states everything else in the lab uses
        axle = {1: 0, 2: 0, 3: 0}
        for r in sel:
            if r[2] in axle:
                axle[r[2]] += 1
        bins.append({
            "lo": lo, "hi": hi, "r": round(math.sqrt(lo * hi), 1), "n": len(sel),
            "held": len(held), "lost": len(lost),
            "vHeld50": q(held, .50), "vHeld90": q(held, .90), "vHeld99": q(held, .99),
            "vLost50": q(lost, .50),
            "latP95": round(q(lat, .95), 3) if len(lat) > 20 else None,
            "lossShare": round(len(lost) / len(sel), 3),
            "axle": [axle[1], axle[2], axle[3]],
        })
    if len(bins) < 4:
        return None

    # THE MODELLED CURVE, solved rather than evaluated: a_max depends on the speed band and the speed
    # depends on a_max, so each radius is iterated to a fixed point (three passes is plenty -- the bands
    # are coarse and it converges immediately unless a build sits exactly on a band edge).
    def a_at(v):
        for b in bands:
            if v >= b["lo"] and (b["hi"] is None or v < b["hi"]):
                return b["aMax"]
        return a_p95

    curve = []
    r = EDGES[0]
    while r <= EDGES[-1]:
        v = 60.0
        for _ in range(3):
            v = math.sqrt(max(0.1, a_at(v)) * G * r) / MPS
        curve.append({"r": round(r, 1), "vGrip": round(v, 1),
                      "v": round(min(v, v_top or v), 1), "limit": "power" if (v_top and v > v_top) else "grip"})
        r *= 1.08
    # the tightest radius the build can take flat: where the grip curve first passes the power ceiling
    r_flat = None
    for c in curve:
        if v_top and c["vGrip"] >= v_top:
            r_flat = c["r"]
            break
    return {"aMaxP95": round(a_p95, 3), "aMaxP99": round(a_p99, 3), "bands": bands,
            "vTop": round(v_top, 1) if v_top else None, "rFlat": r_flat,
            "bins": bins, "curve": curve, "nPoints": len(rows)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "fh6.db"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "grip-envelope.json"))
    ap.add_argument("--min-points", type=int, default=1500,
                    help="a build needs this many points with a driven radius to get an envelope")
    args = ap.parse_args()

    cx = sqlite3.connect("file:" + args.db.replace("\\", "/") + "?mode=ro", uri=True)
    cx.row_factory = sqlite3.Row

    # VOID laps are out (contact invalidates the lap and its grip states with it); grip 4 is an impact, not
    # a tyre state, and the analyzer already treats >3 g as a hit rather than grip.
    rows = cx.execute("""
        SELECT l.hw_hash AS hw, l.tune_hash AS tune, l.cid, l.class, l.pi, l.drivetrain, l.lap_id,
               p.r_m, p.mph, p.grip, p.lat_g
        FROM lap l JOIN lap_point p ON p.lap_id = l.lap_id
        WHERE p.r_m IS NOT NULL AND p.grip IS NOT NULL AND p.grip <> 4
          AND l.void = 0 AND l.hw_hash IS NOT NULL AND l.tune_hash IS NOT NULL""").fetchall()

    by_build: dict[tuple[str, str], list] = {}
    meta: dict[tuple[str, str], dict] = {}
    laps: dict[tuple[str, str], set] = {}
    for r in rows:
        k = (r["hw"], r["tune"])
        by_build.setdefault(k, []).append((r["r_m"], r["mph"], r["grip"], r["lat_g"]))
        laps.setdefault(k, set()).add(r["lap_id"])
        if k not in meta:
            meta[k] = {"cid": r["cid"], "class": r["class"], "pi": r["pi"], "drivetrain": r["drivetrain"]}

    out = []
    for k, pts in sorted(by_build.items(), key=lambda kv: -len(kv[1])):
        if len(pts) < args.min_points:
            continue
        env = envelope_for(pts)
        if not env:
            continue
        env.update(meta[k])
        env["hw"] = k[0]
        env["tune"] = k[1]
        env["laps"] = len(laps[k])
        out.append(env)

    # every catalogued turn's radius, so a build's envelope can be read against the corners it will meet
    turns = [dict(r) for r in cx.execute("""
        SELECT rt.route_id, rt.turn_id, rt.radius_m AS r, rt.angle_deg AS deg, rt.kind, rt.dir,
               ti.display_name AS route
        FROM ref_route_turn rt LEFT JOIN ref_track_info ti ON ti.route_id = rt.route_id
        WHERE rt.radius_m IS NOT NULL AND rt.radius_m > 0""")]

    doc = {"builds": out, "turns": turns, "edges": EDGES,
           "note": ("a_max is MEASURED from recorded lat_g over cornering samples; v_top from observed speed. "
                    "lossShare is a fact about the driving as much as the build -- at a tight radius the "
                    "driver is always near the limit -- so it is context, never the ceiling.")}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"{len(out)} build envelopes, {len(turns)} catalogued turn radii -> {args.out}")
    for e in out[:8]:
        print(f"  {e['hw'][:8]}/{e['tune'][:8]}  {e['class']:>2} {e['pi']} {e['drivetrain']:<4} "
              f"{e['laps']:3d} laps  a_max {e['aMaxP95']:.2f} g  v_top {e['vTop']:.0f} mph  "
              f"flat from {e['rFlat'] or '-'} m")


if __name__ == "__main__":
    main()
