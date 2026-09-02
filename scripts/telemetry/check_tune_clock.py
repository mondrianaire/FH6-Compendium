#!/usr/bin/env python3
"""TUNE-CLOCK CHECK — are tune-save stamps and session ids being compared on ONE clock? READ-ONLY, ~1 s.

    python scripts/telemetry/check_tune_clock.py            # fixed-point checks + every container on disk
    python scripts/telemetry/check_tune_clock.py --json     # machine-readable results

Two timestamps meet whenever a lap is matched to the tune save that was on the car, and they are written in
different bases: session ids (fh6_YYYYMMDD_HHMMSS) are the daemon's LOCAL clock, tune container folders
(Tuning_<ordinal>_<yyyymmddhhmmss>) are stamped by the game in UTC. Parsing both as local put every save ~4 h
late, "newest save before the lap" rejected the equipped one, and 174 of 306 stored laps had no tune_hash.

Checks (any FAIL exits 1):
  A  fixed points — the documented save (folder 20260902022442 = screenshot 2026-09-01 22:24:37 local, UTC-4)
     renders as 02:24:42 UTC through container_epoch; on a UTC-4 machine it sits 5 s after the session-id
     reading of the screenshot time; parsing the same stamp as local is off by exactly the machine's UTC offset.
  B  every container — |container_epoch(folder stamp) - Data mtime| is seconds, not hours, for ALL of them, and
     the local parse is off by the UTC offset for ALL of them. Two independent clocks (the game's stamp, the
     filesystem's mtime) agreeing on every save is the proof the stamp is UTC; the local-parse column is the
     regression: it would collapse to ~0 if the game ever switched to local stamps, and this check would say so.
  C  helpers — container_epoch reads a meta and a bare stamp identically, and falls back to the Data mtime
     when the stamp is unparseable.
"""
import argparse, calendar, glob, io, json, os, statistics, sys, time

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6_tune_decode as TUNE                                            # noqa: E402
from analyze_session import container_epoch, session_epoch, newest_save_before   # noqa: E402

MAX_SKEW_S = 600.0      # stamp vs Data mtime; observed 2-178 s (median 13 s) over 574 containers on 2026-09-02
DOC_STAMP = "20260902022442"            # docs/fh6-ui-spec.md §10.1: the cmp6 save folder
DOC_SHOT_SID = "fh6_20260901_222437"    # the screenshot's local time, written as a session id would be

RESULTS = []


def check(group, name, fn):
    try:
        ok, detail = fn()
        status = "PASS" if ok is True else ("WARN" if ok == "warn" else "FAIL")
    except Exception as e:
        status, detail = "FAIL", f"exception: {e!r}"
    RESULTS.append({"group": group, "name": name, "status": status, "detail": str(detail)[:240]})


def _local_parse(stamp):
    return time.mktime(time.strptime(stamp[:14], "%Y%m%d%H%M%S"))


def _utc_offset_at(epoch):
    """The machine's UTC offset (s) at that instant — DST-aware, so a July stamp and a December stamp differ."""
    return time.localtime(epoch).tm_gmtoff


# ---- A: fixed points --------------------------------------------------------------------------------------
def a_renders_utc():
    ep = container_epoch(DOC_STAMP)
    got = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ep))
    return got == "2026-09-02 02:24:42", f"container_epoch({DOC_STAMP}) -> {got} UTC"


def a_matches_screenshot():
    ep = container_epoch(DOC_STAMP)
    off = _utc_offset_at(ep)
    if off != -4 * 3600:
        return "warn", f"machine is UTC{off/3600:+.0f} at that date, not UTC-4: screenshot comparison not applicable here"
    d = ep - session_epoch(DOC_SHOT_SID)
    loc = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ep))
    return d == 5.0, f"folder stamp reads {loc} local, {d:+.0f} s after the 22:24:37 screenshot (expect +5)"


def a_local_parse_is_the_bug():
    ep = container_epoch(DOC_STAMP)
    err = _local_parse(DOC_STAMP) - ep
    off = _utc_offset_at(ep)
    return err == -off, f"mktime parse is {err:+.0f} s from the UTC parse; machine offset {off:+.0f} s"


# ---- B: every container -----------------------------------------------------------------------------------
def _containers():
    root = TUNE.find_containers_root()
    if not root:
        return None, []
    out = []
    for data in glob.glob(os.path.join(root, "Tuning_*", "Data")):
        ordn, ts = TUNE._ordinal_from_dirname(os.path.dirname(data))
        if ts is None or len(ts) < 14:
            continue
        out.append({"path": data, "ts": ts, "mtime": os.path.getmtime(data), "ordinal": ordn})
    return root, out


_B = {}


def b_scan():
    root, metas = _containers()
    if not metas:
        return False, f"no Tuning_* containers under {root!r}"
    utc = [container_epoch(m) - m["mtime"] for m in metas]
    loc = [_local_parse(m["ts"]) - m["mtime"] for m in metas]
    _B.update(n=len(metas), utc=utc, loc=loc, metas=metas)
    return True, f"{len(metas)} containers under {root}"


def b_utc_parse_agrees_with_mtime():
    u = _B.get("utc")
    if not u:
        return False, "no scan"
    bad = sum(1 for d in u if abs(d) > MAX_SKEW_S)
    return bad == 0, (f"stamp(UTC) - mtime: min {min(u):+.0f} s · median {statistics.median(u):+.0f} s · "
                      f"max {max(u):+.0f} s · {bad}/{len(u)} beyond {MAX_SKEW_S:.0f} s")


def b_local_parse_disagrees_by_offset():
    l = _B.get("loc"); metas = _B.get("metas")
    if not l:
        return False, "no scan"
    # the local parse must be off by the machine's offset at each save (DST-aware), give or take the same skew
    off_ok = sum(1 for d, m in zip(l, metas) if abs(d + _utc_offset_at(m["mtime"])) <= MAX_SKEW_S)
    return off_ok == len(l), (f"stamp(local) - mtime: median {statistics.median(l):+.0f} s · "
                              f"{off_ok}/{len(l)} explained by the UTC offset")


def b_newest_before_is_monotone():
    """For a moment 1 s after each save, newest_save_before must return THAT save or a newer one for the same
    ordinal — never an older one. This is the rule the analyzer applies; on the buggy clock it failed for every
    save made in the last 4 h before a lap."""
    metas = _B.get("metas")
    if not metas:
        return False, "no scan"
    by = {}
    for m in metas:
        by.setdefault(m["ordinal"], []).append(m)
    wrong = 0; tested = 0
    for ordn, ms in by.items():
        for m in ms:
            tested += 1
            got = newest_save_before(ms, container_epoch(m) + 1.0)
            if got is None or container_epoch(got) < container_epoch(m):
                wrong += 1
    return wrong == 0, f"{tested} saves across {len(by)} ordinals · {wrong} attributed to an OLDER save"


# ---- C: helpers ----------------------------------------------------------------------------------------------
def c_meta_and_stamp_agree():
    metas = _B.get("metas") or []
    if not metas:
        return "warn", "no containers to compare"
    diff = sum(1 for m in metas if container_epoch(m) != container_epoch(m["ts"]))
    return diff == 0, f"{diff}/{len(metas)} metas where meta and bare-stamp readings differ"


def c_mtime_fallback():
    mt = 1786035020.764
    got = container_epoch({"ts": "garbage", "mtime": mt})
    none = container_epoch({"ts": None})
    bare = container_epoch("not-a-stamp")
    return (got == mt and none is None and bare is None), f"broken stamp -> mtime {got}; no mtime -> {none}; bare junk -> {bare}"


def c_session_epoch_local():
    sid = "fh6_20260901_222437"
    ep = session_epoch(sid)
    back = time.strftime("fh6_%Y%m%d_%H%M%S", time.localtime(ep))
    return back == sid and session_epoch("fh6_live") is None, f"{sid} -> {ep:.0f} -> {back}; clockless id -> None"


def main():
    ap = argparse.ArgumentParser(description="Assert tune-save stamps and session ids share one clock.")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    check("A", "documented stamp renders as 02:24:42 UTC", a_renders_utc)
    check("A", "documented stamp sits 5 s after its screenshot (UTC-4)", a_matches_screenshot)
    check("A", "local parse of the stamp is off by the UTC offset", a_local_parse_is_the_bug)
    check("B", "scan containers", b_scan)
    check("B", "UTC parse agrees with Data mtime on every container", b_utc_parse_agrees_with_mtime)
    check("B", "local parse is off by the UTC offset on every container", b_local_parse_disagrees_by_offset)
    check("B", "newest_save_before never picks an older save", b_newest_before_is_monotone)
    check("C", "meta and bare-stamp readings agree", c_meta_and_stamp_agree)
    check("C", "mtime fallback and None paths", c_mtime_fallback)
    check("C", "session_epoch round-trips a local id", c_session_epoch_local)

    if a.json:
        print(json.dumps(RESULTS, indent=1))
    else:
        w = max(len(r["name"]) for r in RESULTS)
        print(f"\nTUNE-CLOCK CHECK — {time.strftime('%Y-%m-%d %H:%M')} local, machine offset "
              f"UTC{time.localtime().tm_gmtoff/3600:+.0f}\n")
        for r in RESULTS:
            mark = {"PASS": "✅", "WARN": "🟡", "FAIL": "❌"}[r["status"]]
            print(f"  {mark} {r['group']}  {r['name']:<{w}}  {r['detail']}")
        n_fail = sum(1 for r in RESULTS if r["status"] == "FAIL")
        n_warn = sum(1 for r in RESULTS if r["status"] == "WARN")
        print(f"\n  {len(RESULTS) - n_fail - n_warn} pass · {n_warn} warn · {n_fail} fail\n")
    sys.exit(1 if any(r["status"] == "FAIL" for r in RESULTS) else 0)


if __name__ == "__main__":
    main()
