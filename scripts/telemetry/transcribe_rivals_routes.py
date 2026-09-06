#!/usr/bin/env python3
"""transcribe_rivals_routes.py -- the Rivals > Routes screen, recorded once, into data/rivals-routes-<discipline>.json.

    python scripts/telemetry/transcribe_rivals_routes.py <recording.mp4> --discipline "Dirt Racing"
    python scripts/telemetry/transcribe_rivals_routes.py <recording.mp4> --discipline "Road Racing" --expect data/rivals-routes-road.json

Record the screen scrolled end to end (docs/rivals-routes-capture.md), hand it this. Frames are
sampled at 1 fps; on each one three fixed regions of the 2560x1440 layout are read with EasyOCR --
the big route name in the hero panel, the "Route Length: X.X MI" line under it, and the Details
text on the right. Every name is a CHECKED join, not an OCR result: it must equal one of the
RivalsEventData strings already in data/fh6.db (ref_string), or be within a small edit distance of
exactly one, in which case the game's spelling is written and the correction is recorded. A name
that resolves to nothing is listed under "unresolved" and the file is still written, so the fix
is one hand edit rather than a re-run. The IDS_Name guids come from ref_string too (7 per route);
descriptions are matched the same way against the IDS_Description strings.

The result is the same shape as data/rivals-routes-road.json (2026-09-01, transcribed by hand from
49 frames), so stage `events` needs no change to pick up a new discipline. --expect diffs the
result against an existing file: run it on the original Road Racing recording before trusting
a new one.
"""
import argparse
import difflib
import glob
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "db"))
import fh6db                                            # noqa: E402

# Regions of the 2560x1440 Routes screen (x0, y0, x1, y1). Scaled if the recording is another size.
REGIONS = {
    "name":   (240, 700, 1860, 880),      # hero panel: the selected route's name, large white
    "length": (250, 860, 900, 920),       # "Route Length: 4.3 MI" under the name
    "desc":   (1880, 450, 2320, 930),     # Details panel text
}
LEN_RE = re.compile(r"(\d{1,2}[.,]\d)\s*M[Il1]", re.I)
MI = 1609.344


def slug(s):
    return re.sub(r"[^0-9a-z]+", "-", s.lower()).strip("-")


def game_strings(cx):
    """{name: [guid...]} from ref_string(RivalsEventData) and {description: [table:guid...]} from
    RivalsEventData AND CareerTrackInfo -- Edamame Circuit's on-screen description is only in the
    latter (the Rivals table carries a different wording for it)."""
    names, descs = {}, {}
    for tbl, kn, content in cx.execute(
            "SELECT table_name, key_name, content FROM ref_string"
            " WHERE table_name IN ('RivalsEventData', 'CareerTrackInfo')"):
        guid = kn.split("_", 2)[2] if kn.count("_") >= 2 else kn
        if tbl == "RivalsEventData" and kn.startswith("IDS_Name_"):
            names.setdefault(content, []).append(guid)
        elif kn.startswith("IDS_Description_"):
            descs.setdefault(content, []).append(tbl + ":" + guid)
    return names, descs


def extract_frames(video, out_dir, fps=1):
    os.makedirs(out_dir, exist_ok=True)
    for f in glob.glob(os.path.join(out_dir, "r_*.png")):
        os.remove(f)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vf", "fps=%d" % fps,
                    os.path.join(out_dir, "r_%03d.png")], check=True)
    return sorted(glob.glob(os.path.join(out_dir, "r_*.png")))


def _norm(s):
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower()).strip()


def resolve(text, pool, cutoff):
    """(game_string, kind): exact | corrected | None. The pool is the game's own list."""
    if text in pool:
        return text, "exact"
    by_norm = {_norm(k): k for k in pool}
    t = _norm(text)
    if t in by_norm:
        return by_norm[t], "corrected"
    close = difflib.get_close_matches(t, list(by_norm), n=2, cutoff=cutoff)
    if len(close) >= 1 and (len(close) == 1 or difflib.SequenceMatcher(None, t, close[0]).ratio()
                            - difflib.SequenceMatcher(None, t, close[1]).ratio() > 0.05):
        return by_norm[close[0]], "corrected"
    return None, None


def read_frames(frames, reader, size):
    """Per frame: raw OCR text of the three regions, cropped and scaled to the layout size."""
    from PIL import Image
    sx, sy = size[0] / 2560.0, size[1] / 1440.0
    out = []
    for path in frames:
        im = Image.open(path)
        rec = {"frame": os.path.splitext(os.path.basename(path))[0]}
        for key, (x0, y0, x1, y1) in REGIONS.items():
            crop = im.crop((int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy)))
            import numpy as np
            words = reader.readtext(np.array(crop), detail=0, paragraph=(key == "desc"))
            rec[key] = " ".join(w.strip() for w in words if w.strip())
        out.append(rec)
    return out


def transcribe(video, discipline, expect=None, verbose=False, keep_frames=None):
    import easyocr
    from PIL import Image
    work = keep_frames or os.path.join(os.environ.get("TEMP", "/tmp"), "rivals_frames_" + slug(discipline))
    frames = extract_frames(video, work)
    if not frames:
        raise SystemExit("no frames extracted from %s" % video)
    size = Image.open(frames[0]).size
    cx = fh6db.connect(ro=True)
    names, descs = game_strings(cx)
    reader = easyocr.Reader(["en"], verbose=False)
    t0 = time.time()
    recs = read_frames(frames, reader, size)
    if verbose:
        print("ocr: %d frames in %.1fs" % (len(recs), time.time() - t0))

    routes, unresolved, order = {}, [], 0
    for r in recs:
        raw = r["name"]
        if not raw:
            continue
        name, how = resolve(raw, names, cutoff=0.72)
        m = LEN_RE.search(r["length"])
        length = float(m.group(1).replace(",", ".")) if m else None
        if name is None:
            # A Routes-screen frame always carries a "Route Length:" line; one without it is the menu
            # on the way in (Journal, the Rivals hub), not a route nobody could read.
            if m:
                unresolved.append({"frame": r["frame"], "ocr_name": raw, "ocr_length": r["length"]})
            continue
        if name not in routes:
            order += 1
            desc, dhow = resolve(r["desc"], descs, cutoff=0.6) if r["desc"] else (None, None)
            routes[name] = {"order": order, "name": name, "length_mi": length,
                            "description": desc, "ids_name_guids": sorted(names[name]),
                            "frames": [r["frame"]],
                            "_ocr": {"name": raw, "name_match": how, "desc_match": dhow,
                                     "desc_raw": r["desc"] if desc is None else None}}
        else:
            ent = routes[name]
            ent["frames"].append(r["frame"])
            if ent["length_mi"] is None and length is not None:
                ent["length_mi"] = length
            if ent["description"] is None and r["desc"]:
                d, dh = resolve(r["desc"], descs, cutoff=0.6)
                if d:
                    ent["description"], ent["_ocr"]["desc_match"] = d, dh
    rows = sorted(routes.values(), key=lambda x: x["order"])
    corrections = [{"name": x["name"], "ocr": x["_ocr"]["name"]} for x in rows if x["_ocr"]["name_match"] == "corrected"]
    missing_len = [x["name"] for x in rows if x["length_mi"] is None]
    doc = {
        "schema_version": "1.0.0",
        "created": time.strftime("%Y-%m-%d"),
        "discipline": discipline,
        "source": ("Horizon Rivals > Routes screen, scrolled end to end; %s at 1 fps (%d frames); "
                   "scripts/telemetry/transcribe_rivals_routes.py (EasyOCR), every name and description "
                   "resolved to the game's own RivalsEventData string in ref_string"
                   % (os.path.basename(video), len(frames))),
        "note": ("Length is the in-game Route Length in miles (one decimal, so +/-0.05 mi by construction); "
                 "stage events loads this file into ref_event, stage route_names matches courses to it "
                 "by map identity + length. A route name repeats under 7 IDS_Name guids (one per event variant)."),
        "routes": [{k: v for k, v in x.items() if k != "_ocr"} for x in rows],
        "transcription": {"corrections": corrections, "unresolved": unresolved, "missing_length": missing_len},
    }
    report = {"routes": len(rows), "corrections": len(corrections), "unresolved": len(unresolved),
              "missing_length": len(missing_len)}
    if expect:
        with open(expect, encoding="utf-8") as fh:
            exp = {r["name"]: r for r in json.load(fh)["routes"]}
        got = {r["name"]: r for r in rows}
        report["expect"] = {
            "missing": sorted(set(exp) - set(got)), "extra": sorted(set(got) - set(exp)),
            "length_mismatch": sorted(n for n in set(exp) & set(got) if exp[n]["length_mi"] != got[n]["length_mi"]),
            "order_mismatch": sorted(n for n in set(exp) & set(got) if exp[n]["order"] != got[n]["order"]),
            "desc_mismatch": sorted(n for n in set(exp) & set(got) if (exp[n].get("description") or "").strip() != (got[n].get("description") or "").strip()),
        }
    return doc, report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--discipline", required=True, help='as the game names it: "Road Racing", "Dirt Racing", "Cross Country", "Street Scene", "Drag Racing"')
    ap.add_argument("--out", default=None, help="default data/rivals-routes-<slug>.json")
    ap.add_argument("--expect", default=None, help="an existing file to diff against (validation)")
    ap.add_argument("--keep-frames", default=None, help="directory to keep the extracted frames in")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    doc, report = transcribe(a.video, a.discipline, a.expect, a.verbose, a.keep_frames)
    out = a.out or os.path.join(ROOT, "data", "rivals-routes-%s.json" % slug(a.discipline).replace("-racing", "").replace("-scene", ""))
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, out)
    print("wrote %s" % os.path.relpath(out, ROOT))
    print(json.dumps(report, indent=1))
    ok = not report["unresolved"] and not report["missing_length"] and not (
        a.expect and any(report["expect"][k] for k in ("missing", "extra", "length_mismatch", "order_mismatch")))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
