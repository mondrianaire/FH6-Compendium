#!/usr/bin/env python3
"""ONE-SHOT: apply the current establishment rule to course models already on disk.

    python scripts/telemetry/migrate_turn_establishment.py --dry     # show what would change
    python scripts/telemetry/migrate_turn_establishment.py           # write it

WHY THIS EXISTS. The analyzer stopped establishing turns from BEHAVIOUR on a course that already has a map: a
behaviour-only turn depends on how you drove, and with the lateral-g split folding gentle corners into the geometry
it had become pure drift. But models are read-modify-written, and a model only re-derives its turns when that course
is driven again -- so 16 courses were still carrying 140 turns established under the old rule, one of them claiming
30 turns over a 5-turn map. Waiting for each course to be re-driven would leave those counts wrong for weeks.

This applies the SAME predicate the analyzer now uses (see `_established` in analyze_session.py) to the stored
`turns` array. It never invents a turn and never promotes one: the only transition it can make is established ->
possible, for turns whose sole evidence was behaviour on a course that has a map. Geometry-established turns, their
provenance, their per-turn history and the map itself are untouched.

Re-runnable and idempotent: a second run finds nothing to change. It is a migration, not a step in the pipeline --
once every course has been re-analysed under the new rule this script has nothing left to do.
"""
import argparse, glob, io, json, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


TOL = 45.0   # the same radius the model's own geo_mapped match uses


def demote(model):
    """Return (n_demoted, new_turn_count) after applying the current rule. Mutates `model`.

    Judged on EVIDENCE, not on the `est_by` label. Two of the oldest models predate provenance entirely -- no
    est_by, no geo_mapped, no geo_sessions -- so trusting the label would have skipped them, leaving one course
    claiming 184 turns over a 172-turn map. For a course that has a map the rule reduces to its geometry clauses,
    and the missing geo_mapped flag is simply recomputed: a stored turn sitting within TOL of a turn in the current
    map IS mapped, which is all that flag ever recorded.
    """
    gturns = (model.get("geometry") or {}).get("turns") or []
    if not gturns:
        return 0, model.get("turn_count")          # no map -> behaviour is still the only evidence there is
    apexes = [g.get("apex") for g in gturns if g.get("apex")]

    def mapped(t):
        if t.get("geo_mapped"):
            return True
        p = t.get("pos")
        return bool(p) and any((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= TOL * TOL for q in apexes)

    def keep(t):
        if mapped(t) or (t.get("geo_sessions") or 0) >= 2:
            return "geometry"
        if (t.get("geo_sessions") or 0) >= 1 and ((t.get("track") or {}).get("passes") or 0) >= 1:
            return "geometry+driven"
        return None                                 # behaviour was its only evidence, and this course has a map

    n = 0
    for t in model.get("turns") or []:
        if not t.get("established"):
            continue
        by = keep(t)
        if by:
            t.setdefault("est_by", by)              # backfill provenance where the old writer left none
            continue
        t["established"] = False
        t["est_by"] = None
        t["status"] = "possible"
        n += 1
    if n:
        est = [t for t in (model.get("turns") or []) if t.get("established")]
        model["turn_count"] = len(est)
        exp = model.get("expected_turns")
        model["turn_count_delta"] = (len(est) - exp) if exp else None
    return n, model.get("turn_count")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="report only, write nothing")
    a = ap.parse_args()
    tot_t = tot_c = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        try:
            m = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            print("  !! %s: %s" % (os.path.basename(path), e)); continue
        before = m.get("turn_count")
        n, after = demote(m)
        if not n:
            continue
        tot_t += n; tot_c += 1
        geo = len((m.get("geometry") or {}).get("turns") or [])
        print("  %-24s %s -> %s turns  (map has %d · dropped %d behaviour-only)" % (
            os.path.basename(path), before, after, geo, n))
        if not a.dry:
            json.dump(m, open(path, "w", encoding="utf-8"), indent=2)
    print("\n%s: %d turns demoted across %d courses" % ("WOULD CHANGE" if a.dry else "WROTE", tot_t, tot_c))
    if not tot_t:
        print("nothing to do — every stored model already matches the current rule")


if __name__ == "__main__":
    main()
