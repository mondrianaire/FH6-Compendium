#!/usr/bin/env python3
"""Build a course from VERIFIED COMPLETE LAPS, top-down, instead of inferring one from telemetry windows.

    python scripts/telemetry/build_course_from_laps.py captures/fh6_20260829_023235.csv          # report
    python scripts/telemetry/build_course_from_laps.py captures/fh6_20260829_023235.csv --write   # write the model

WHY THIS EXISTS, in Jett's words: "it should be framed by context. if a rivals track was loaded then we need to do
a quick car inventory to see if it matches a known tune and then use the start finish line with lap times to
identify which are correct laps from metadata."

The analyzer works the other way round. It cuts telemetry into windows, guesses which are courses, and keys each
by wherever the window happened to open — so a rolling Rivals start keys the U-turn, an approach becomes a
"course", a 23.4 mi lap lands under six different keys, and the three real laps of one circuit end up in three
different models. Every one of those is the same mistake: inferring the course from the capture, when the game
already TELLS you what a lap is.

THE FRAME, in order:

  1. CONTEXT. Is this a timed solo event (Rivals / time trial)? RacePosition constant 1 and a running lap timer.
     Nothing else is a course.
  2. CAR. Which build was equipped — read from the config id, matched against the saved-tune roster, so a lap is
     attributed to a build and not just to an ordinal.
  3. THE LINE. CurrentLap runs 0 -> t and resets as you cross. Both crossings are the SAME PLACE on every lap,
     which is what makes it the course's start/finish rather than an artefact of the capture.
  4. CORRECT LAPS, from metadata. A lap is real when the timer ran from ~0 to a peak, LastLap then reports that
     same time, and the path returns to where the timer started. Anything else — approach, U-turn, aborted run —
     fails at least one and is not a lap.
  5. THE COURSE IS WHAT A CORRECT LAP TRACES. Not the window it sat in, and not the drive that led up to it.

The turns come from the same curvature detector the analyzer uses (imported, not reimplemented), so a course built
here and one built there describe corners identically.
"""
import argparse, csv, io, json, math, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import analyze_session as A   # noqa: E402  — curvature/detect_turns/smooth, so corners are defined in ONE place

CLOSE_M = 60.0        # a lap must return this close to where its timer started
MIN_LAP_S = 20.0      # below this it is a stub, not a lap
STEP = 4.0            # resample spacing, matching the analyzer's own


def read_laps(path):
    """Every timed lap in a capture, with the metadata that proves it is one."""
    f = open(path, encoding="utf-8", errors="replace", newline="")
    rd = csv.reader(f)
    hdr = next(rd)
    ix = {n: i for i, n in enumerate(hdr)}
    need = ("IsRaceOn", "CurrentLap", "LastLap", "PosX", "PosZ", "Speed", "RacePosition", "CarOrdinal", "CarPI",
            "DrivetrainType", "NumCylinders", "PosY")
    miss = [n for n in need if n not in ix]
    if miss:
        raise SystemExit("capture is missing columns: %s" % miss)
    G = lambda r, n: float(r[ix[n]])
    laps, run, prev, pos_seen = [], [], None, set()
    for row in rd:
        try:
            on = int(G(row, "IsRaceOn")); cl = G(row, "CurrentLap")
        except Exception:
            continue
        if on != 1 or cl <= 0:                      # timer not running: approach, menu, U-turn — never a lap
            if run: laps.append(run)
            run, prev = [], None
            continue
        if prev is not None and cl < prev - 0.5:    # the timer reset: the line
            laps.append(run); run = []
        try:
            run.append({"cl": cl, "x": G(row, "PosX"), "z": G(row, "PosZ"), "y": G(row, "PosY"),
                        "mph": G(row, "Speed") * 2.23694, "last": G(row, "LastLap"),
                        "rpos": int(G(row, "RacePosition")),
                        "cid": "%d|%d|%d|%d" % (int(G(row, "CarOrdinal")), int(G(row, "DrivetrainType")),
                                                int(G(row, "NumCylinders")), int(G(row, "CarPI")))})
        except Exception:
            pass
        prev = cl
    if run: laps.append(run)
    f.close()
    return [L for L in laps if len(L) > 100]


def judge(L, nxt=None):
    """Is this a CORRECT lap? Returns (ok, why, facts). Every test is on metadata the game reported."""
    t = L[-1]["cl"] - L[0]["cl"]
    close = math.hypot(L[0]["x"] - L[-1]["x"], L[0]["z"] - L[-1]["z"])
    pos = [q["rpos"] for q in L if q["rpos"] > 0]
    solo = bool(pos) and max(pos) == 1 and len(set(pos)) == 1
    # LastLap REPORTS THE LAP YOU JUST FINISHED, so it appears at the start of the NEXT run, not inside this one.
    # Reading it only within the lap made this test silently inert — every lap showed LastLap 0.0 and the
    # corroboration never ran. The game's own record of the time is the strongest evidence a lap was real; it has
    # to be fetched from where the game actually puts it.
    last = next((q["last"] for q in reversed(L) if q["last"] > 0), 0.0)
    if not last and nxt:
        last = next((q["last"] for q in nxt if q["last"] > 0), 0.0)
    facts = {"timer_s": round(t, 2), "close_m": round(close), "solo": solo, "last_lap": round(last, 3),
             "cid": L[-1]["cid"], "started_from_zero": L[0]["cl"] <= 1.0}
    if t < MIN_LAP_S:
        return False, "too short to be a lap (%.1f s)" % t, facts
    if not facts["started_from_zero"]:
        return False, "timer did not start at the line (began at %.1f s)" % L[0]["cl"], facts
    if close > CLOSE_M:
        return False, "did not return to the line (%.0f m away)" % close, facts
    # LastLap must CORROBORATE the timer: the game's own record of the lap agreeing with the clock we watched
    if last and abs(last - t) > 2.0:
        return False, "LastLap %.2f s disagrees with the timer %.2f s" % (last, t), facts
    return True, ("complete lap, LastLap %.2f s confirms the timer" % last) if last else                  "complete lap by the line and the clock (game reported no LastLap)", facts


def geometry_from(L):
    """The course IS what the lap traced. Resample to 4 m, detect turns with the analyzer's own detector."""
    pts = [(q["x"], q["z"]) for q in L]
    P, acc = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        if d > 150:                                  # a teleport is not road
            continue
        acc += d
        if acc >= STEP:
            P.append(b); acc = 0.0
    S, cum = [0.0], 0.0
    for a, b in zip(P, P[1:]):
        cum += math.hypot(b[0] - a[0], b[1] - a[1]); S.append(cum)
    # detect_turns returns INDEX-based records (ia/i0/i1/sgn/k/deg). The analyzer converts those into the
    # apex/s/dir/id shape everything downstream reads — rebind_map_turns matches on `apex`, the map draws `apex`,
    # turn_stats windows on `s`. Writing the raw detector output produced a course with 21 map turns that nothing
    # could bind to: 21 turns, 0 established. Same conversion as analyze_session:1772, kept identical on purpose.
    PS = [(p[0], p[1], s) for p, s in zip(P, S)]
    raw = A.detect_turns(PS)
    turns = [{"id": "G%d" % n, "apex": [round(PS[g["ia"]][0]), round(PS[g["ia"]][1])],
              "s": round(PS[g["ia"]][2]), "radius_m": round(1.0 / g["k"]) if g.get("k") else None,
              "dir": "R" if g["sgn"] > 0 else "L", "deg": g["deg"],
              "len_m": round((g["i1"] - g["i0"]) * STEP),
              "entry": [round(PS[g["i0"]][0]), round(PS[g["i0"]][1])],
              "exit": [round(PS[g["i1"]][0]), round(PS[g["i1"]][1])]}
             for n, g in enumerate(raw, 1)]
    return P, cum, turns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--route", help="route_key to write (default: derived from the start/finish line)")
    a = ap.parse_args()

    laps = read_laps(a.capture)
    print("timer runs found: %d\n" % len(laps))
    good = []
    for i, L in enumerate(laps, 1):
        ok, why, f = judge(L, laps[i] if i < len(laps) else None)
        P, ln, turns = geometry_from(L) if ok else ([], 0, [])
        print("  %-2d %-9s %8.1f s  close %5s m  solo=%-5s LastLap %-9s %s"
              % (i, "ACCEPT" if ok else "reject", f["timer_s"], f["close_m"], f["solo"], f["last_lap"], why))
        if ok:
            print("       -> %.0f m (%.2f mi) · %d turns · car %s" % (ln, ln / 1609.344, len(turns), f["cid"]))
            good.append((L, P, ln, turns, f))
    if not good:
        print("\nno complete lap in this capture — nothing to build from"); return
    # the LONGEST correct lap is the fullest description of the road
    L, P, ln, turns, f = max(good, key=lambda g: g[2])
    key = a.route or "%d_%d" % (int(round(L[0]["x"] / 50) * 50), int(round(L[0]["z"] / 50) * 50))
    print("\nCOURSE from the best complete lap: %s" % key)
    print("  %.0f m (%.2f mi) · %d turns · start/finish [%d,%d] · %s · %.1f s"
          % (ln, ln / 1609.344, len(turns), round(L[0]["x"]), round(L[0]["z"]), f["cid"], f["timer_s"]))
    if not a.write:
        print("\n(report only — re-run with --write to save the course model)"); return
    mp = os.path.join(ROOT, "data", "courses", key.replace(":", "_").replace(" ", "_") + ".json")
    m = json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else {"route_key": key}
    m["geometry"] = dict(m.get("geometry") or {}, path=[[round(x), round(z)] for x, z in P],
                         paths=[[[round(x), round(z)] for x, z in P]], length_m=round(ln), turns=turns,
                         det=A.DET_VER, built_from="complete-lap")
    m["laps"] = max(m.get("laps") or 0, len(good))
    json.dump(m, open(mp, "w", encoding="utf-8"), indent=2)
    print("\nwrote %s" % mp)
    print("run rebind_map_turns.py next so the turn inventory binds to this map")


if __name__ == "__main__":
    main()
