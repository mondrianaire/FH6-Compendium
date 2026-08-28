#!/usr/bin/env python3
"""
fh6_pi_solve.py  —  Self-building per-part PI cost model, from ZERO capture.

The daemon records observations pairing a car's exact decoded config (its 50 slot tiers) with the
live CarPI reported by telemetry, into data/pi-observations.json. CarPI is exact, so two observations
of the SAME ordinal that differ in exactly ONE slot's tier isolate that (slot, tier_from->tier_to)
PI cost directly — no per-car menu capture needed. This module differences every such single-part
pair, medians the deltas, anchors each slot's tiers to its stock reference, and writes the estimates
to data/parts-pi.json. Where single-part isolation is impossible it optionally runs a pure-Python
least-squares regression (CarPI ~ per-ordinal base + per-part contributions), clearly tagged lower
confidence. Sparse early on by design — most tiers stay unknown until varied configs are driven.

  python fh6_pi_solve.py            # rebuild data/parts-pi.json, print a coverage summary
  python fh6_pi_solve.py --json     # also dump the solved table as JSON

stdlib only. READ-ONLY except the atomic (temp + os.replace) write of data/parts-pi.json.
"""
import json, os, sys, time, statistics
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fh6_tune_decode as TUNE   # noqa: E402  (canonical PARTS list + paths)


def _data(name):
    return os.path.abspath(os.path.join(HERE, "..", "..", "data", name))

OBS_PATH = _data("pi-observations.json")
OUT_PATH = _data("parts-pi.json")


def load_observations():
    """The recorded decoded-config <-> CarPI observations (list); missing/malformed file -> []."""
    try:
        with open(OBS_PATH, encoding="utf-8") as fh:
            doc = json.load(fh)
        obs = doc.get("observations") if isinstance(doc, dict) else None
        return obs or []
    except Exception:
        return []


def _tk(v):
    """Tier key as a string; None (empty slot) -> 'None' so it round-trips through JSON object keys."""
    return "None" if v is None else str(v)


# ---- primary method: single-part isolation ----------------------------------
def solve_isolation(observations):
    """Difference every pair of same-ordinal observations that differ in exactly ONE slot; median the
    per-edge CarPI deltas; anchor each slot's tiers to its stock reference. Returns (parts_pi, stats)."""
    slots = TUNE.PARTS
    by_ord = {}
    for o in observations:
        try:
            by_ord.setdefault(int(o.get("ordinal")), []).append(o)
        except (TypeError, ValueError):
            continue

    # slot groups the game changes together, so a "single part" edge may legitimately touch two slots
    LINKED = (frozenset(("rim_style", "rear_rim_style")), frozenset(("front_tire_width", "rear_tire_width")))
    edges = {}          # slot -> {(from_tier, to_tier): [delta, ...]}  (both directions)
    pair_count = 0
    for obs in by_ord.values():
        for i in range(len(obs)):
            for j in range(i + 1, len(obs)):
                a, b = obs[i], obs[j]
                pa, pb = (a.get("parts") or {}), (b.get("parts") or {})
                diff = [s for s in slots if pa.get(s) != pb.get(s)]
                # LINKED SLOTS MOVE AS ONE PART. Wheels are fitted as a set, so changing them writes BOTH
                # rim_style and rear_rim_style; tyre width likewise. A strict one-slot test therefore discards
                # every genuine rim change as "two parts changed" -- which is why the solver reported
                # single_part_pairs=0 while 9 isolated edges (7 rim pairs, 1 differential, 1 tire_compound)
                # were sitting in the 513 saves on disk. The pair IS the edge: attribute it to the front slot,
                # since the two always carry the same tier.
                if len(diff) == 2 and frozenset(diff) in LINKED:
                    diff = [d for d in diff if not d.startswith("rear_")] or diff[:1]
                if len(diff) != 1:
                    continue
                s = diff[0]
                ta, tb = pa.get(s), pb.get(s)
                d = (b.get("car_pi") or 0) - (a.get("car_pi") or 0)
                em = edges.setdefault(s, {})
                em.setdefault((ta, tb), []).append(d)
                em.setdefault((tb, ta), []).append(-d)
                pair_count += 1

    parts_pi = {}
    for s, em in edges.items():
        med = {e: statistics.median(v) for e, v in em.items()}
        nodes = {n for e in med for n in e}
        int_nodes = sorted(n for n in nodes if isinstance(n, int))
        # stock reference: an empty slot (None) if seen, else tier 0, else the lowest observed tier
        if None in nodes:
            ref = None
        elif 0 in int_nodes:
            ref = 0
        else:
            ref = int_nodes[0] if int_nodes else None
        # relax from the reference, accumulating median edge deltas -> PI(node) vs stock
        adj = {}
        for (a, b), dv in med.items():
            adj.setdefault(a, []).append((b, dv))
        pot = {ref: 0.0}; frontier = [ref]
        while frontier:
            nxt = []
            for n in frontier:
                for (m2, dv) in adj.get(n, []):
                    if m2 not in pot:
                        pot[m2] = pot[n] + dv; nxt.append(m2)
            frontier = nxt

        slot_out = {}
        for n in int_nodes:
            if n == ref:
                continue
            incoming = {(a, b): vs for (a, b), vs in em.items() if b == n}   # each undirected pair once (x->n)
            pv = pot.get(n)
            direct = (ref, n) in med
            slot_out[str(n)] = {
                "pi_vs_stock": (int(round(pv)) if pv is not None else None),
                "ref_tier": _tk(ref),
                "samples": sum(len(vs) for vs in incoming.values()),
                "confidence": ("measured-direct" if direct else "measured-chain" if pv is not None else "unresolved"),
                "edges": {f"{_tk(a)}->{_tk(b)}": {"median_delta": round(statistics.median(vs), 1), "samples": len(vs)}
                          for (a, b), vs in incoming.items()},
            }
        if slot_out:
            parts_pi[s] = slot_out

    return parts_pi, {"observations": len(observations), "ordinals": len(by_ord), "single_part_pairs": pair_count}


# ---- fallback: pure-Python least-squares regression -------------------------
def _solve_linear(A, b):
    """Gauss-Jordan solve of A x = b (A square). None if singular / ill-conditioned."""
    n = len(A)
    M = [list(A[i]) + [b[i]] for i in range(n)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[piv][c]) < 1e-9:
            return None
        M[c], M[piv] = M[piv], M[c]
        pv = M[c][c]
        for j in range(c, n + 1):
            M[c][j] /= pv
        for r in range(n):
            if r == c:
                continue
            f = M[r][c]
            if f:
                for j in range(c, n + 1):
                    M[r][j] -= f * M[c][j]
    return [M[i][n] for i in range(n)]


def solve_regression(observations, resolved):
    """Lower-confidence fallback for tiers isolation could not reach: least-squares
    CarPI ~ per-ordinal base + sum of per-(slot, tier) contributions. Runs only when clearly
    overdetermined; fills ONLY still-unresolved tiers, tagged confidence 'regression'. {} on sparse data."""
    slots = TUNE.PARTS
    if len(observations) < 6:
        return {}, "insufficient observations"
    # per-slot modal tier ~ stock reference; features are the non-modal (slot, tier) seen
    modal = {}
    for s in slots:
        c = Counter(_tk((o.get("parts") or {}).get(s)) for o in observations)
        modal[s] = c.most_common(1)[0][0] if c else "None"
    feats = []
    for o in observations:
        for s in slots:
            tk = _tk((o.get("parts") or {}).get(s))
            if tk != modal[s] and (s, tk) not in feats:
                feats.append((s, tk))
    ords = sorted({int(o.get("ordinal")) for o in observations})
    cols = [("base", od) for od in ords] + [("feat", f) for f in feats]
    ncol = len(cols)
    if ncol == 0 or len(observations) < ncol + 2:
        return {}, f"underdetermined ({len(observations)} obs, {ncol} params)"

    def rowvec(o):
        v = [0.0] * ncol
        for k, (kind, ref) in enumerate(cols):
            if kind == "base":
                if int(o.get("ordinal")) == ref:
                    v[k] = 1.0
            else:
                s, tk = ref
                if _tk((o.get("parts") or {}).get(s)) == tk:
                    v[k] = 1.0
        return v

    ata = [[0.0] * ncol for _ in range(ncol)]; aty = [0.0] * ncol
    for o in observations:
        rv = rowvec(o); y = float(o.get("car_pi") or 0)
        for i in range(ncol):
            if rv[i] == 0:
                continue
            aty[i] += rv[i] * y
            for j in range(ncol):
                if rv[j]:
                    ata[i][j] += rv[i] * rv[j]
    x = _solve_linear(ata, aty)
    if x is None:
        return {}, "singular design matrix"

    out = {}
    for k, (kind, ref) in enumerate(cols):
        if kind != "feat":
            continue
        s, tk = ref
        if tk == "None":
            continue
        try:
            tier = int(tk)
        except ValueError:
            continue
        if resolved.get(s, {}).get(str(tier), {}).get("pi_vs_stock") is not None:
            continue        # isolation already nailed it — don't overwrite with the weaker estimate
        out.setdefault(s, {})[str(tier)] = {"pi_vs_stock": int(round(x[k])), "ref_tier": modal[s],
                                            "samples": 0, "confidence": "regression", "edges": {}}
    return out, "ok"


# ---- assemble + write -------------------------------------------------------
def build():
    observations = load_observations()
    parts_pi, stats = solve_isolation(observations)
    reg, reg_note = solve_regression(observations, parts_pi)
    for s, tiers in reg.items():
        parts_pi.setdefault(s, {}).update(tiers)

    tiers_seen = sum(len(v) for v in parts_pi.values())
    tiers_resolved = sum(1 for v in parts_pi.values() for e in v.values() if e.get("pi_vs_stock") is not None)
    by_conf = Counter(e.get("confidence") for v in parts_pi.values() for e in v.values())
    coverage = {"slots_with_estimates": len(parts_pi), "part_tiers_seen": tiers_seen,
                "part_tiers_resolved": tiers_resolved,
                "by_confidence": dict(by_conf), "regression": reg_note, **stats}

    doc = {
        "schema_version": "1.0.0",
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "method": "single-part isolation from decoded-config<->CarPI observations (median per edge, anchored to "
                  "stock); pure-Python least-squares regression fallback (tagged 'regression') for the rest",
        "parts_pi": parts_pi,
        "coverage": coverage,
    }
    _safe_write(OUT_PATH, doc)
    return doc


def _safe_write(path, doc):
    data = json.dumps(doc, indent=1, ensure_ascii=False)
    if len(data) < 20:                       # sanity: never truncate the target to garbage
        raise ValueError("refusing to write implausibly small parts-pi.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(data)
    sz = os.path.getsize(tmp)
    if sz < 20:
        os.remove(tmp); raise ValueError("temp parts-pi.json failed size check")
    os.replace(tmp, path)


def main():
    want_json = "--json" in sys.argv
    doc = build()
    cov = doc["coverage"]
    print(f"[pi-solve] observations={cov['observations']}  ordinals={cov['ordinals']}  "
          f"single-part pairs={cov['single_part_pairs']}")
    print(f"[pi-solve] slots with estimates: {cov['slots_with_estimates']}  "
          f"part-tiers seen: {cov['part_tiers_seen']}  resolved (PI known): {cov['part_tiers_resolved']}")
    if cov["by_confidence"]:
        print("[pi-solve] by confidence:", ", ".join(f"{k}={v}" for k, v in cov["by_confidence"].items()))
    print(f"[pi-solve] regression fallback: {cov['regression']}")
    if cov["observations"] == 0:
        print("[pi-solve] no observations yet — drive varied configs so the daemon records them, then re-run.")
    print(f"[pi-solve] wrote {os.path.relpath(OUT_PATH, os.path.join(HERE, '..', '..'))}")
    if want_json:
        print(json.dumps(doc["parts_pi"], indent=2))


if __name__ == "__main__":
    main()
