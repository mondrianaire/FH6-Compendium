#!/usr/bin/env python3
"""Anchor a tyre-compound NAME to its GLOBAL save-index — the one thing the menu video couldn't give us.

The save stores tire_compound as ordinal*1000 + idx; idx (0..15) is a global compound-catalog position, but the
in-game menu grid is NOT in index order, so we know the NAMES but not which index each is. This resolves it directly:
install a compound on ANY one car in-game, save the tune, then run this with the name you selected — it decodes that
car's newest save, reads tire_compound%idx, and writes {idx: name, verified} into data/tire-compounds.json. Because the
index is global, one install maps that compound for EVERY car that runs it (fixes 11/12/15 and verifies the guesses).

  python anchor_compound.py <ordinal> "<compound name>"     # e.g. python anchor_compound.py 3761 "'Horizon' Semi-Slick Race"
  python anchor_compound.py --show                          # print the current index->name map + which indices are still unmapped
"""
import sys, os, json, glob
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import fh6_tune_decode as T

CJSON = os.path.join(ROOT, "data", "tire-compounds.json")


def load():
    with open(CJSON, encoding="utf-8") as f:
        return json.load(f)


def newest_idx(ordinal):
    metas, _ = T.tunes_for_ordinal(int(ordinal))
    if not metas:
        return None, None
    t = T.parse_tune(metas[0]["path"], ordinal_hint=int(ordinal))
    tc = t["parts"].get("tire_compound")
    return (tc % 1000 if tc is not None else None), metas[0]["ts"]


def show():
    d = load(); names = d.get("names", {}); ver = set(d.get("verified", []))
    # every idx actually used across the garage
    root = T.find_containers_root(); used = {}
    for data in glob.glob(os.path.join(root, "Tuning_*", "Data")):
        try:
            tc = T.parse_tune(data)["parts"].get("tire_compound")
        except Exception:
            continue
        if tc is not None:
            used[tc % 1000] = used.get(tc % 1000, 0) + 1
    print("idx | name (V=verified) | cars using it")
    for ix in sorted(used):
        nm = names.get(str(ix), "— UNMAPPED —")
        tag = " V" if str(ix) in ver else ("  " if str(ix) in [str(k) for k in names] else "")
        print(f" {ix:2} | {nm:34}{tag} | {used[ix]}")
    unmapped = [ix for ix in used if str(ix) not in names]
    if unmapped:
        print("\nstill unmapped:", unmapped, "— install one of these on any car + save, then run this with its name.")


def main():
    if "--show" in sys.argv or len(sys.argv) < 3:
        show(); return
    ordinal, name = sys.argv[1], sys.argv[2]
    idx, ts = newest_idx(ordinal)
    if idx is None:
        print(f"no on-disk tune found for ordinal {ordinal} (or it has no tyre-compound slot).", file=sys.stderr); sys.exit(1)
    d = load(); names = d.setdefault("names", {}); ver = d.setdefault("verified", [])
    prev = names.get(str(idx))
    # A NAME BELONGS TO AT MOST ONE INDEX, AND A VERIFIED ANCHOR BEATS A GUESS. Anchoring 15 = "Drift" left the
    # unverified guess at 9 still claiming "Drift" too, so the catalog asserted one compound at two indices and
    # the older, wrong one was the first a lookup would hit. Every non-stock name in this file started as
    # best-effort, so each anchor is expected to displace one — the tool has to say so rather than leave the
    # contradiction for someone to notice. Verified entries are never touched: two of those disagreeing is a
    # real conflict and must be raised, not silently resolved.
    freed = []
    for k in [k for k, v in names.items() if k != str(idx) and v == name]:
        if k in ver:
            print("CONFLICT: idx %s is VERIFIED as %r too — not touching it. Resolve by hand." % (k, name), file=sys.stderr)
            continue
        del names[k]; freed.append(k)
    names[str(idx)] = name
    if str(idx) not in ver:
        ver.append(str(idx)); ver.sort(key=lambda s: int(s))
    d["updated"] = __import__("time").strftime("%Y-%m-%d")
    tmp = CJSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
    os.replace(tmp, CJSON)
    print(f"ANCHORED: idx {idx} = {name!r} (VERIFIED){' — was ' + repr(prev) if prev and prev != name else ''}. "
          f"From ordinal {ordinal} save {ts}. This maps it for every car that runs idx {idx}.")
    for k in freed:
        print(f"  freed idx {k}: its {name!r} was an unverified guess, now disproven — that index is UNMAPPED again "
              f"and needs its own anchor.")


if __name__ == "__main__":
    main()
