#!/usr/bin/env python3
"""COURSE-MODEL AUDIT — invariant checks for the class of bug that hides in persisted state.

Every fault found in the turn-identification work shared ONE shape: a value that accumulates across sessions
and can never be re-derived from evidence, so a mistake made once is permanent and silently authoritative.

  * model_map was set and never cleared      -> a corner removed from the map stayed 'part of the road' forever
  * geometry replaced only if LONGER         -> a merged double lap outranks every real lap, permanently
  * the declared turn count PROMOTED turns   -> the count could no longer disagree, so it could not warn
  * the reference lap was the session MAX    -> one merged lap evicts every genuine lap as a 'fragment'

The checks below are therefore not about turns specifically. They ask, of each persisted artefact:
  RATCHET     does this only ever grow?
  DERIVABLE   does it still match what the evidence says it should be?
  CONSISTENT  does it agree with the other artefacts in the same file?

    python scripts/telemetry/audit_models.py            # audit every course model
    python scripts/telemetry/audit_models.py --json     # machine-readable, for the verify harness
"""
import glob, io, json, math, os, statistics, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from analyze_session import DET_VER, self_retrace   # noqa: E402


def arc(p):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p, p[1:]))


def audit(m, path):
    """Returns a list of (severity, code, message). severity: FAIL breaks a promise, WARN needs an eye."""
    out = []
    key = m.get("route_key") or os.path.basename(path)[:-5]
    g = m.get("geometry") or {}
    gp = g.get("path") or []
    turns = m.get("turns") or []
    gseen = m.get("geo_turns") or {}
    laps = [lp.get("pts") or [] for lp in (g.get("lap_paths") or []) if len(lp.get("pts") or []) >= 30]
    lap_arcs = sorted(arc(p) for p in laps)

    # --- 1. MERGED LAP: the map must be one lap of road, not two. ---
    if gp:
        sr = self_retrace(gp)
        if sr >= 0.4:
            out.append(("FAIL", "merged-map", f"map retraces itself {100*sr:.0f}% — it is {len(gp)} pts / "
                                              f"{arc(gp):.0f} m of MULTIPLE laps, so every corner is counted twice"))
        elif sr >= 0.25:
            out.append(("WARN", "map-overlap", f"map retraces itself {100*sr:.0f}% — check for a partial second lap"))

    # --- 2. MAP LENGTH vs the laps actually driven: the map should BE a typical lap. ---
    if gp and len(lap_arcs) >= 5:
        med = statistics.median(lap_arcs)
        ml = arc(gp)
        if med and ml > 1.45 * med:
            out.append(("FAIL", "map-too-long", f"map is {ml:.0f} m but the median recorded lap is {med:.0f} m "
                                                f"({ml/med:.2f}x) — the reference lap is not a lap"))
        elif med and ml < 0.7 * med:
            out.append(("WARN", "map-too-short", f"map is {ml:.0f} m vs median lap {med:.0f} m ({ml/med:.2f}x) — "
                                                 f"the map covers less road than you routinely drive"))

    # --- 3. DETECTOR GENERATION: turns computed by a superseded detector are not comparable. ---
    if gp and g.get("det") != DET_VER:
        out.append(("WARN", "stale-detector", f"map built by detector {g.get('det') or 'pre-versioning'!r}, "
                                              f"current is {DET_VER!r} — turns will refresh on the next full session"))

    # --- 4. RATCHET: no turn may claim map authority unless it is IN the map. ---
    mapped = [t for t in (g.get("turns") or []) if t.get("apex")]
    for k, v in gseen.items():
        if not v.get("model_map"):
            continue
        ap = v.get("pos")
        if ap and not any((t["apex"][0] - ap[0]) ** 2 + (t["apex"][1] - ap[1]) ** 2 <= 45 ** 2 for t in mapped):
            out.append(("FAIL", "phantom-turn", f"registry entry {k} claims model_map but sits {45}m+ from every "
                                                f"turn in the current map — a ratchet from a superseded map"))

    # --- 5. DERIVABLE: the headline count must equal what the flags actually say. ---
    est = [t for t in turns if t.get("established")]
    if m.get("turn_count") is not None and m["turn_count"] != len(est):
        out.append(("FAIL", "count-mismatch", f"turn_count={m['turn_count']} but {len(est)} turns are established"))
    if any(t.get("est_by") == "declared" for t in turns):
        out.append(("FAIL", "declared-promotion", "a turn is established by the DECLARED count — the count is an "
                                                  "input again, so it can no longer test the detector"))

    # --- 6. CONSISTENT: a declared count that the geometry cannot reach is worth surfacing, not hiding. ---
    exp = m.get("expected_turns")
    if exp and abs(len(est) - exp) >= 3:
        out.append(("WARN", "count-drift", f"{len(est)} established vs {exp} declared (delta {len(est)-exp:+d})"))

    # --- 7. LAP HYGIENE: merged laps in the stored layout distort every length statistic downstream. ---
    if len(lap_arcs) >= 5:
        med = statistics.median(lap_arcs)
        bad = [a for a in lap_arcs if med and a > 1.45 * med]
        if bad:
            out.append(("WARN", "merged-laps", f"{len(bad)} of {len(lap_arcs)} stored laps exceed 1.45x the median "
                                               f"({med:.0f} m) — likely un-split multi-lap windows: "
                                               f"{', '.join(f'{a:.0f}' for a in bad[:5])} m"))
    return key, out


def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        try:
            m = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            rows.append((os.path.basename(p), [("FAIL", "unreadable", str(e))]))
            continue
        rows.append(audit(m, p))
    if "--json" in sys.argv:
        print(json.dumps([{"course": k, "findings": [{"severity": s, "code": c, "message": msg} for s, c, msg in f]}
                          for k, f in rows], indent=2))
        return
    nf = sum(1 for _, f in rows for s, _, _ in f if s == "FAIL")
    nw = sum(1 for _, f in rows for s, _, _ in f if s == "WARN")
    print(f"COURSE-MODEL AUDIT — {len(rows)} courses · {nf} FAIL · {nw} WARN\n")
    for k, f in rows:
        if not f:
            continue
        print(f"── {k}")
        for s, c, msg in sorted(f, key=lambda x: x[0]):
            print(f"    [{s}] {c}: {msg}")
        print()
    if not nf and not nw:
        print("all clean.")
    print("=" * 78)
    print(f"{len(rows)} courses · {nf} FAIL · {nw} WARN")
    return 1 if nf else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
