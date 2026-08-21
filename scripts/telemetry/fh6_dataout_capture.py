#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FH6 Data Out capture — records the game's UDP telemetry stream to CSV and prints a
quick-look summary. First controlled experiment for the Data Out research
(docs/research/fh6-data-out.md).

In-game: Settings > HUD and Gameplay > (bottom) Data Out = On,
         Data Out IP Address = 127.0.0.1, Data Out IP Port = <PORT> (avoid 5200-5300).
Run:     python scripts/telemetry/fh6_dataout_capture.py --port 9876 --seconds 120 --out captures/
Then drive. Ctrl-C stops early. Microsoft Store/Game Pass build may need a loopback exemption
(see the report). Steam build needs nothing.

Layout: official FH6 Data Out doc (Zendesk 51744149102611) — 324 bytes, little-endian,
FH4/FH5-identical. Offsets cross-checked against ClickClickMedia/0x20F/grimsi/richstokes.
"""
import argparse, csv, math, os, socket, struct, sys, time
from collections import defaultdict

# ---- packet layout (FH4/FH5/FH6, 324 bytes) ----------------------------------
SLED_FMT = "<iI" + "f" * 3 + "f" * 9 + "f" * 3 + "f" * 4 + "f" * 4 + "f" * 4 + "i" * 4 + "f" * 4 + "f" * 4 + "f" * 4 + "f" * 4 + "f" * 4 + "i" * 5   # 232 bytes
HZN_FMT = "Iff"                                  # 232..243 CarGroup, SmashableVelDiff, SmashableMass
DASH_FMT = "fff" + "fff" + "ffff" + "fffffff" + "H" + "BBBBBB" + "bbb"   # 244..322 (79 bytes)
FH_FMT = SLED_FMT + HZN_FMT + DASH_FMT + "B"     # + trailing byte 323 => 324
assert struct.calcsize(FH_FMT) == 324, struct.calcsize(FH_FMT)

W = ["FL", "FR", "RL", "RR"]
def per_wheel(name): return [f"{name}{w}" for w in W]

FIELDS = (
    ["IsRaceOn", "TimestampMS", "EngineMaxRpm", "EngineIdleRpm", "CurrentEngineRpm",
     "AccelX", "AccelY", "AccelZ", "VelX", "VelY", "VelZ", "AngVelX", "AngVelY", "AngVelZ",
     "Yaw", "Pitch", "Roll"]
    + per_wheel("NormSusp") + per_wheel("SlipRatio") + per_wheel("WheelRotSpeed")
    + per_wheel("OnRumble") + per_wheel("InPuddle") + per_wheel("SurfaceRumble")
    + per_wheel("SlipAngle") + per_wheel("CombinedSlip") + per_wheel("SuspTravelM")
    + ["CarOrdinal", "CarClass", "CarPI", "DrivetrainType", "NumCylinders",
       "CarGroup", "SmashableVelDiff", "SmashableMass",
       "PosX", "PosY", "PosZ", "Speed", "Power", "Torque"]
    + per_wheel("TireTempF")
    + ["Boost", "Fuel", "DistanceTraveled", "BestLap", "LastLap", "CurrentLap", "CurrentRaceTime",
       "LapNumber", "RacePosition", "Accel", "Brake", "Clutch", "HandBrake", "Gear",
       "Steer", "NormDrivingLine", "NormAIBrakeDiff", "Trailing323"]
)
assert len(FIELDS) == len(struct.unpack(FH_FMT, bytes(324))), (len(FIELDS), len(struct.unpack(FH_FMT, bytes(324))))

DERIVED = ["t_wall", "t_mono", "speed_mph", "lat_g", "long_g", "yaw_rate_dps"] + [f"TireTempC{w}" for w in W]

def decode(data):
    vals = struct.unpack(FH_FMT, data[:324])
    return dict(zip(FIELDS, vals))

def main():
    ap = argparse.ArgumentParser(description="FH6 Data Out UDP capture -> CSV + quick-look")
    ap.add_argument("--port", type=int, default=9876)
    ap.add_argument("--seconds", type=float, default=0, help="stop after N seconds (0 = until Ctrl-C)")
    ap.add_argument("--out", default="captures")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", a.port))
    sock.settimeout(1.0)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    path = os.path.join(a.out, f"fh6_{stamp}.csv")
    print(f"listening on UDP 0.0.0.0:{a.port} -> {path}  (Ctrl-C to stop)")

    f = open(path, "w", newline="")
    wr = csv.writer(f)
    wr.writerow(DERIVED + FIELDS)

    n = 0; lens = defaultdict(int); t0 = time.monotonic(); last_report = t0
    first_checked = False
    # quick-look accumulators
    max_lat = 0.0; max_comb = {w: 0.0 for w in W}; raceon = 0
    gear_pts = defaultdict(list)   # gear -> list of speed_mps / rpm
    max_susp = {w: 0.0 for w in W}; min_susp = {w: 1.0 for w in W}
    temps = {w: [] for w in W}
    car = None
    try:
        while True:
            if a.seconds and time.monotonic() - t0 > a.seconds: break
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            lens[len(data)] += 1
            if len(data) < 323:
                continue   # not a Horizon packet (232 sled / 311 FM7 / 331 FM2023) — ignore, but counted in lens
            if len(data) == 323:
                data = data + b"\x00"
            p = decode(data)
            n += 1
            vmag = math.sqrt(p["VelX"]**2 + p["VelY"]**2 + p["VelZ"]**2)
            if not first_checked and p["Speed"] > 1.0:
                first_checked = True
                ok = abs(vmag - p["Speed"]) < 0.5
                print(f"layout self-check: |Velocity|={vmag:.2f} Speed={p['Speed']:.2f} -> {'OK (offsets confirmed)' if ok else 'MISMATCH - layout differs!'}")
                print(f"  car ordinal {p['CarOrdinal']}  class {p['CarClass']}  PI {p['CarPI']}  drivetrain {p['DrivetrainType']}  cyl {p['NumCylinders']}  CarGroup {p['CarGroup']}")
                print(f"  IsRaceOn={p['IsRaceOn']}  gear={p['Gear']}  InPuddleFL raw f32={p['InPuddleFL']!r}  trailing323={p['Trailing323']}")
                car = (p["CarOrdinal"], p["CarPI"])
            row = [time.time(), time.monotonic() - t0, p["Speed"] * 2.23694, p["AccelX"] / 9.80665, p["AccelZ"] / 9.80665, math.degrees(p["AngVelY"])]
            row += [(p[f"TireTempF{w}"] - 32.0) * 5.0 / 9.0 for w in W]
            row += [p[k] for k in FIELDS]
            wr.writerow(row)
            # accumulate
            raceon += 1 if p["IsRaceOn"] else 0
            max_lat = max(max_lat, abs(p["AccelX"]) / 9.80665)
            for w in W:
                max_comb[w] = max(max_comb[w], abs(p[f"CombinedSlip{w}"]))
                max_susp[w] = max(max_susp[w], p[f"NormSusp{w}"]); min_susp[w] = min(min_susp[w], p[f"NormSusp{w}"])
                temps[w].append(p[f"TireTempF{w}"])
            if p["Gear"] and p["CurrentEngineRpm"] > 1500 and p["Speed"] > 3 and p["Accel"] > 200:
                gear_pts[p["Gear"]].append(p["Speed"] / p["CurrentEngineRpm"])
            now = time.monotonic()
            if not a.quiet and now - last_report >= 5:
                print(f"  {n} pkts  {n/(now-t0):.0f} pps avg  speed {p['Speed']*2.23694:5.1f} mph  gear {p['Gear']}  rpm {p['CurrentEngineRpm']:.0f}  latG {p['AccelX']/9.80665:+.2f}  comb {p['CombinedSlipFL']:+.2f}/{p['CombinedSlipFR']:+.2f}/{p['CombinedSlipRL']:+.2f}/{p['CombinedSlipRR']:+.2f}")
                last_report = now
    except KeyboardInterrupt:
        pass
    finally:
        f.close()
    dur = time.monotonic() - t0
    print("\n==== quick-look ====")
    print(f"packets: {n} in {dur:.0f}s = {n/max(dur,1e-9):.1f} pps   lengths seen: {dict(lens)}   IsRaceOn frames: {raceon}/{n}")
    if n:
        print(f"max |lat g|: {max_lat:.2f}")
        print("max |combined slip| per wheel: " + "  ".join(f"{w} {max_comb[w]:.2f}" for w in W) + "   (>1.0 = past the limit)")
        print("suspension range (normalized): " + "  ".join(f"{w} {min_susp[w]:.2f}-{max_susp[w]:.2f}" for w in W))
        print("tire temp F (min/median/max): " + "  ".join(f"{w} {min(temps[w]):.0f}/{sorted(temps[w])[len(temps[w])//2]:.0f}/{max(temps[w]):.0f}" for w in W if temps[w]))
        if gear_pts:
            print("gear table (median m/s per rpm at WOT; ratios relative to 1st):")
            base = None
            for g in sorted(gear_pts):
                pts = sorted(gear_pts[g]); med = pts[len(pts)//2]
                if base is None: base = med
                print(f"  gear {g}: {med*1000:.3f} m/s per 1000rpm  rel {med/base:.3f}  ({len(pts)} samples)")
    print(f"saved: {path}")

if __name__ == "__main__":
    main()
