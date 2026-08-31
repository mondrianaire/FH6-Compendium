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

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from analyze_session import DET_VER, self_retrace   # noqa: E402


def arc(p):
    """Road length of a point list, in metres, IGNORING the teleports between disconnected map pieces.

    A model's geometry can hold several pieces of road, and `path` is their concatenation -- so the straight line
    from the end of one piece to the start of the next was being counted as road. Measured: 600_-3800 has 1239 m
    of road in 2 pieces and scored 7276 m, of which 6037 m was one jump; -5200_-5250 has 292 m and scored 6074 m,
    20.8x. That number is not cosmetic. audit_models check 2 divides by it, so honest full laps of -6800_-1100
    were failing as "map-too-long" against a 9085 m map that is really 5711 m of road; and merge_courses prints
    it to the operator as the reason for a merge ("7276 m lies on 37789 m"). I made the same mistake by hand
    earlier and blamed the trace rather than the ruler.

    The break is found from the data, not a constant: road is sampled at a near-constant step, so a segment far
    longer than the median IS a discontinuity. 20x the median, floored at 150 m so a sparsely sampled straight on
    a short path is never mistaken for one.
    """
    if not p or len(p) < 2:
        return 0.0
    segs = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p, p[1:])]
    med = sorted(segs)[len(segs) // 2]
    cut = max(150.0, med * 20.0) if med > 0 else float("inf")
    return sum(d for d in segs if d <= cut)


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

    # --- 2. MAP LENGTH vs the laps actually driven. ---
    # ONLY A CIRCUIT'S MAP SHOULD BE ONE LAP. This compared map length to the median lap unconditionally and
    # failed 1900_6100 as "the reference lap is not a lap" — but that route's map self-retraces 0.0%, its start
    # and end sit 3105 m apart, and every stored lap lies 100% ON the map while covering 11-62% of it. It is a
    # POINT-TO-POINT, and partial traversals of one are the normal shape, not a fault. Judging an open road by a
    # circuit's rule is the same mistake as judging a lap against the wrong reference set.
    ml = arc(gp) if gp else 0
    # CLOSED means "comes back to where it started", and how close is close depends on the size of the loop. At 5%
    # a declared reference loop whose ends sit 81 m apart on a 744 m circuit was classed a point-to-point and run
    # through the open-road branch. A declared loop is a loop whatever its endpoints say; otherwise 12% of length.
    closed = str(key).startswith("loop:") or (
        bool(gp) and math.hypot(gp[0][0] - gp[-1][0], gp[0][1] - gp[-1][1]) <= max(60.0, 0.12 * ml))
    if gp and len(lap_arcs) >= 5 and closed:
        # MEASURE THE MAP AGAINST LAPS THAT FINISHED, NOT AGAINST EVERY RUN FILED HERE. This took the median over
        # all stored arcs and failed the Colossus: a 37849 m circuit whose median stored run is 3792 m, reported as
        # "the reference lap is not a lap". But the map is the verified part — 23.4 mi, confirmed against the game
        # — and it is the RUNS that are partial, because a 23 mi lap is usually abandoned partway. Judging a course
        # by the sample of attempts is this project's oldest bug, and here it accused the one thing we had checked.
        # A map built from a bad reference (several laps stitched into one) still fails, because that map is long
        # relative to the laps that DID complete. When nothing completed, we cannot tell, and say exactly that.
        _done = [a for a in lap_arcs if a >= 0.60 * ml]
        if len(_done) < 3:
            out.append(("WARN", "circuit-never-completed",
                        f"circuit map is {ml:.0f} m and no more than {len(_done)} recorded run covers 60% of it "
                        f"(median run {statistics.median(lap_arcs):.0f} m) — the map cannot be checked against a "
                        f"full lap until one is driven"))
            med = None
        else:
            med = statistics.median(_done)
        if med and ml > 1.45 * med:
            out.append(("FAIL", "map-too-long", f"circuit map is {ml:.0f} m but the median COMPLETED lap is "
                                                f"{med:.0f} m ({ml/med:.2f}x) — the reference lap is not a lap"))
        elif med and ml < 0.7 * med:
            out.append(("WARN", "map-too-short", f"map is {ml:.0f} m vs median lap {med:.0f} m ({ml/med:.2f}x) — "
                                                 f"the map covers less road than you routinely drive"))
    # The open-road equivalent, which the length test cannot express. A partial traversal of a point-to-point is
    # ordinary, so the question is not "how much of the map did this lap cover" but WHETHER THE TWO ARE THE SAME
    # ROAD — which needs coverage measured BOTH WAYS. The first cut of this check reported one-way coverage and
    # called five courses "two roads in one model"; every one of them had map-on-lap = 1.00, i.e. the map sits
    # wholly INSIDE a longer drive. That is a short map, not a spliced one, and it is the open-road form of the
    # map-too-short WARN above. Only mutual divergence is a fault, and nothing on disk exhibits it.
    elif gp and not closed and laps:
        def _cov(a, cb):
            return sum(1 for x, z in a if any((int(x // 30) + dx, int(z // 30) + dz) in cb
                                              for dx in (-1, 0, 1) for dz in (-1, 0, 1))) / max(1, len(a))
        mc = {(int(x // 30), int(z // 30)) for x, z in gp}
        # A FRAGMENT CANNOT TESTIFY. An aborted 313 m stub of a 740 m road covers little of the map and is covered
        # by little of it, which looks exactly like divergence while meaning only "this attempt stopped early".
        # Judge only laps long enough to be a traversal; the store already treats short laps as partial elsewhere.
        _med = statistics.median(lap_arcs) if lap_arcs else 0
        split, short = [], []
        for lp in laps:
            if _med and arc(lp) < 0.5 * _med:
                continue
            on = _cov(lp, mc)
            if on >= 0.80:
                continue
            back = _cov(gp, {(int(x // 30), int(z // 30)) for x, z in lp})
            (short if back >= 0.80 else split).append(on)
        if split:
            out.append(("FAIL", "lap-off-map", f"{len(split)} of {len(laps)} stored laps diverge from this "
                                               f"point-to-point's map in BOTH directions (best {max(split):.0%} on "
                                               f"it) — two different roads in one model"))
        elif short:
            out.append(("WARN", "map-too-short", f"{len(short)} of {len(laps)} stored laps run past the mapped road "
                                                 f"(map lies wholly inside them) — the map covers less than you "
                                                 f"routinely drive here"))

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
    # NOTE THIS CHECK'S CEILING. It compares the count to the flags, so it can only ever catch a WRITER bug —
    # the count field drifting from the array. It is structurally incapable of catching a RULE bug, where the
    # flags themselves are wrong *in agreement* with the count. That is exactly how 221 turns were established
    # under a superseded rule with every check passing: turn_count=184 and len(established)=184 agreed perfectly
    # while both described a 172-turn map. Check 5b is the one that can disagree.
    est = [t for t in turns if t.get("established")]
    if m.get("turn_count") is not None and m["turn_count"] != len(est):
        out.append(("FAIL", "count-mismatch", f"turn_count={m['turn_count']} but {len(est)} turns are established"))

    # --- 5b. DERIVABLE, FOR REAL: re-run the establishment rule and compare the SET. ---
    # The audit's checks were pairwise between ADJACENT artefacts: registry -> map (check 4) and
    # turn_count -> established (check 5). The pair that mattered, established turns -> THE MAP, was never
    # wired, so a course could carry 184 established turns over a 172-turn map and report clean. Cross-checking
    # neighbours can always be satisfied by self-consistent nonsense; the only check that cannot is one that
    # RE-DERIVES the value from the evidence and compares. So this does not ask whether the flags agree with
    # each other — it asks what the flags SHOULD be, and says so when they differ.
    if mapped:                       # a course with no map still establishes from behaviour; nothing to re-derive
        apex = [t["apex"] for t in mapped]
        # PROXIMITY IS A FALLBACK, NOT A DEFINITION. geo_mapped is set by the analyzer's own matcher, whose
        # tolerance is derived from the map's closest turn gap (6-18 m). Using a fixed 45 m radius as a stand-in
        # calls turns "mapped" that the analyzer correctly did not, and the first cut of this check duly reported
        # 15 courses of underclaimed turns that were nothing of the kind. So proximity is used ONLY to reconstruct
        # the flag on the two legacy models that predate provenance entirely; where the field exists, it is truth.
        has_prov = any("geo_mapped" in t for t in turns)

        def _near(t):
            p = t.get("pos")
            return bool(p) and any((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= 45 ** 2 for q in apex)

        def _should(t):
            if t.get("geo_mapped") or (t.get("geo_sessions") or 0) >= 2:
                return True
            if not has_prov and _near(t):
                return True
            return (t.get("geo_sessions") or 0) >= 1 and ((t.get("track") or {}).get("passes") or 0) >= 1

        over = [t for t in est if not _should(t)]          # established with no geometric evidence behind it
        # the mirror case is stated WITHOUT the proximity fallback: only an outright contradiction counts —
        # the model itself says this turn is in the map, and the model itself says it is not a turn.
        under = [t for t in turns if not t.get("established") and t.get("geo_mapped")]
        if over:
            ids = ", ".join(str(t.get("id") or t.get("n")) for t in over[:6])
            out.append(("FAIL", "unearned-turns", f"{len(over)} of {len(est)} established turns have NO geometric "
                                                  f"evidence on a course whose map has {len(mapped)} turns — the "
                                                  f"establishment rule and the stored flags disagree ({ids}"
                                                  f"{', …' if len(over) > 6 else ''})"))
        if under:
            out.append(("WARN", "underclaimed-turns", f"{len(under)} mapped-and-driven turns are NOT established — "
                                                      f"the ratchet may be holding a superseded rule's result"))
        if len(est) > len(mapped):
            out.append(("FAIL", "more-turns-than-road", f"{len(est)} turns established but the map has only "
                                                        f"{len(mapped)} — a course cannot have more corners than "
                                                        f"its own road"))
    if any(t.get("est_by") == "declared" for t in turns):
        out.append(("FAIL", "declared-promotion", "a turn is established by the DECLARED count — the count is an "
                                                  "input again, so it can no longer test the detector"))

    # --- 6. CONSISTENT: a declared count that the geometry cannot reach is worth surfacing, not hiding. ---
    exp = m.get("expected_turns")
    if exp and abs(len(est) - exp) >= 3:
        out.append(("WARN", "count-drift", f"{len(est)} established vs {exp} declared (delta {len(est)-exp:+d})"))

    # --- 7. LAP HYGIENE: merged laps in the stored layout distort every length statistic downstream. ---
    if len(lap_arcs) >= 5:
        # LENGTH ALONE DOES NOT MAKE A LAP MERGED, AND ON AN OPEN ROAD IT MEANS NOTHING AT ALL. This flagged any
        # lap over 1.45x the median with no closed/open gate -- the same mistake check 2 was rewritten to stop
        # making (see its comment). 1900_6100 is a point-to-point whose map ends 3106 m from its start, with
        # stored runs of 1408, 1599, 2061, 5465 and 8439 m covering 10% to 61% of the road: partial traversals of
        # an open road are the normal shape, not evidence of anything.
        # This file already owns the signal that CAN tell the two apart, and check 1 uses it on the map:
        # self_retrace, "the only way to tell a genuinely long course from two laps of a short one". A merged
        # window drives the same road twice and retraces itself; a long single traversal does not. Ask the lap
        # itself rather than inferring from its length, at check 1's own 0.25 threshold.
        med = statistics.median(lap_arcs)
        bad = []
        for p_ in laps:
            a_ = arc(p_)
            if med and a_ > 1.45 * med and self_retrace(p_) >= 0.25:
                bad.append(a_)
        if bad:
            out.append(("WARN", "merged-laps", f"{len(bad)} of {len(lap_arcs)} stored laps exceed 1.45x the median "
                                               f"({med:.0f} m) AND retrace themselves — un-split multi-lap "
                                               f"windows: {', '.join(f'{a:.0f}' for a in sorted(bad)[:5])} m"))
    # --- 8. A PERSISTED LAP TIME MUST BE A LAP. ---
    # best_laps is improve-only (analyze_session.py), guarded only by "> 0", so one absurd value latches forever
    # and becomes the course's headline record. 200_-6000 is showing 231307.938 s -- a 64-HOUR track record -- and
    # -1850_1550 12.2 hours. The largest healthy lap anywhere on disk is 208.6 s, a 17x margin, so the ceiling is
    # not a judgement call. The floor is clean today and goes in anyway: an absurdly LARGE time self-heals the next
    # time that car drives here, an absurdly SMALL one can never be beaten and so can never heal.
    def _times():
        for cid, v in (m.get("best_laps") or {}).items():
            yield f"best_laps[{cid}]", (v or {}).get("best_lap")
        for i, v in enumerate(m.get("visits") or []):
            yield f"visits[{i}]", (v or {}).get("best_lap")
        for cid, v in (m.get("speed_traces") or {}).items():
            yield f"speed_traces[{cid}]", (v or {}).get("lap_s")
    bad_t = [(w, t) for w, t in _times() if t and (t >= 3600 or t < 5)]
    if bad_t:
        w, t = bad_t[0]
        out.append(("FAIL", "impossible-lap", f"{len(bad_t)} stored lap time(s) outside 5 s..1 h — {w} = {t:.3f} s "
                                              f"({t/3600:.1f} h); improve-only, so it can never be beaten off"))

    # --- 9. A TRACE MUST NOT SPAN MORE ROAD THAN THE MAP IT IS DRAWN AGAINST. ---
    # 1.45 is not a new constant: it is the reciprocal of check 2's own 0.7, so both state one threshold. The span
    # must be PIECE-AWARE -- pts[-1][0] under-reads by ~1950 m on -4750_-1550 where the arc resets mid-trace.
    L = (g.get("length_m") or 0) or ml
    # A MAP MADE OF SCRAPS IS NOT A SHORT MAP, AND A TRACE IS NOT WRONG FOR BEING WIDER THAN ONE. Two models here
    # are stored as two path pieces sitting 5781 m and 6037 m apart — further than the entire road they have
    # mapped (51+241 m, and 40+1199 m). They are not courses: they are unrelated scraps that landed on one route
    # key, one of them with no turns at all and two laps to its name. Measured against those, an ordinary 2.3 km
    # trace reads as 9.07x and got reported as trace-too-wide — blaming the driving for a defect in the map, which
    # is this project's oldest mistake wearing a new label. Name the actual fault, and let the trace check stand
    # down: it has nothing to say until there is a coherent map to say it against.
    _ps = g.get("paths") or []
    _gaps = [math.hypot(_ps[i][-1][0] - _ps[i + 1][0][0], _ps[i][-1][1] - _ps[i + 1][0][1])
             for i in range(len(_ps) - 1) if _ps[i] and _ps[i + 1]]
    _fragmented = bool(_gaps) and max(_gaps) > (L or 0)
    if _fragmented:
        out.append(("WARN", "map-fragments",
                    f"map is {len(_ps)} disconnected pieces totalling {L:.0f} m with a {max(_gaps):.0f} m gap "
                    f"between them — further apart than the whole map is long, so this key is holding scraps of "
                    f"two different roads, not one course; a retirement candidate, and no trace can be judged "
                    f"against it"))
    if L and not _fragmented:
        def _span(pts):
            tot = 0.0; prev = None; st = None
            for q in pts or []:
                a = q[0]
                if prev is None: st = a
                elif a < prev: tot += prev - st; st = a
                prev = a
            return tot + (prev - st) if prev is not None else 0.0
        wide = []
        for cid, v in (m.get("speed_traces") or {}).items():
            sp = _span((v or {}).get("pts"))
            if sp and sp / L >= 1.45: wide.append((cid, sp))
        if wide:
            cid, sp = max(wide, key=lambda x: x[1])
            out.append(("FAIL", "trace-too-wide", f"{len(wide)} speed trace(s) span more road than the {L:.0f} m map "
                                                  f"— worst {cid} at {sp:.0f} m ({sp/L:.2f}x); a merged trace here "
                                                  f"drags the retirement baseline and evicts the honest ones"))
    return key, out


def audit_routes(routes, models, ev_counts):
    """Invariants on data/routes.json -- THE FILE THE AUDIT NEVER OPENED.

    The audit's scope was drawn around the artefact whose bug was being diagnosed (course models) rather than
    around the write path that produces persisted state. routes.json is written by the same analyzer, carries two
    textbook max()-ratchets, and gates ROUTE ATTRIBUTION -- which decides which model a session's turns and
    geometry are written into. It sits upstream of the entire turns/geometry/registry triangle.
    """
    out = []
    # (a) DOMAIN. length_m is minted unclamped and only ever grown, so an impossible value at birth is permanent.
    #     It is load-bearing: >= 200 enables the reversed-heading rejection, < 600 marks a route a stub.
    # ABSENT IS NOT A FAULT. A route that has not measured its length yet simply has no length_m, and every reader
    # already handles that (`R.get("length_m") or 0`). Only a value that IS there and is impossible is a fault —
    # the first cut failed on `is None` and so re-failed the two routes immediately after repairing them.
    bad = [(k, v.get("length_m")) for k, v in routes.items()
           if isinstance(v, dict) and v.get("length_m") is not None and v["length_m"] <= 0]
    if bad:
        out.append(("FAIL", "route-length-domain", f"{len(bad)} route(s) with a non-positive length_m: "
                                                   f"{', '.join(f'{k}={v}' for k, v in bad[:4])} — minted unclamped "
                                                   f"and only ever grown, so this never self-heals"))
    # (b) DISTINCT ROADS DO NOT HAVE IDENTICAL LENGTHS. A shared value across routes whose starts are far apart is
    #     one event's odometer saturating into every route it touched.
    by_len = {}
    for k, v in routes.items():
        L = (v or {}).get("length_m")
        if L and L > 0: by_len.setdefault(round(L / 5) * 5, []).append(k)
    for L, ks in sorted(by_len.items()):
        if len(ks) < 3: continue
        st = [(routes[k] or {}).get("start") for k in ks]
        far = any(a and b and ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) > 200 ** 2
                  for i, a in enumerate(st) for b in st[i + 1:])
        if far:
            out.append(("WARN", "route-length-cluster", f"{len(ks)} routes on different roads share length_m ~{L} m "
                                                        f"({', '.join(ks[:5])}…) — one event's odometer saturating "
                                                        f"into every route it touched"))
    # (c) EVENTS RECOUNT. R["events"] += 1 on EVERY re-analysis, so the counter measures how often the analyzer ran,
    #     not how often you drove. Equality is what one honest pass produces, so healthy data sits ON the boundary.
    over = [(k, (v or {}).get("events") or 0, ev_counts.get(k, 0)) for k, v in routes.items()
            if ((v or {}).get("events") or 0) > ev_counts.get(k, 0) + 2]
    if over:
        w = max(over, key=lambda x: x[1] - x[2])
        out.append(("WARN", "route-events-ratchet", f"{len(over)} of {len(routes)} routes declare more events than "
                                                    f"the sessions on disk can justify — worst {w[0]}: {w[1]} "
                                                    f"declared vs {w[2]} recounted (re-analysis re-increments)"))
    return "data/routes.json", out


def _route_events():
    """Recount, from the sessions on disk, how many events each route actually saw."""
    n = {}
    for p in glob.glob(os.path.join(ROOT, "data", "sessions", "*.json")):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        for e in (d.get("events") or []):
            k = e.get("route_key")
            if k:
                n[k] = n.get(k, 0) + 1
    return n


def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        try:
            m = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            rows.append((os.path.basename(p), [("FAIL", "unreadable", str(e))]))
            continue
        rows.append(audit(m, p))
    # THE OTHER FILE THE SAME PIPELINE WRITES. Scoping the audit to data/courses/ was scoping it to the artefact
    # whose bug was being diagnosed rather than to the write path; routes.json carries two max()-ratchets and gates
    # route attribution, which decides which model a session is written into at all.
    try:
        R = json.load(open(os.path.join(ROOT, "data", "routes.json"), encoding="utf-8")).get("routes") or {}
        rows.append(audit_routes(R, rows, _route_events()))
    except Exception as e:
        rows.append(("data/routes.json", [("FAIL", "routes-unreadable", str(e))]))
    nf = sum(1 for _, f in rows for s, _, _ in f if s == "FAIL")
    if "--json" in sys.argv:
        print(json.dumps([{"course": k, "findings": [{"severity": s, "code": c, "message": msg} for s, c, msg in f]}
                          for k, f in rows], indent=2))
        # AN UNEXERCISED CHECKER MUST NOT LOOK LIKE A PASSING ONE. This branch used a bare `return`, so --json
        # exited 0 on the exact data where plain mode exited 1 — and the harness that consumes it reads only
        # stdout. A crashed audit and a clean audit were the same green tick.
        return 1 if nf else 0
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
