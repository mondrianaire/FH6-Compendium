#!/usr/bin/env python3
"""PIPELINE BENCHMARK — measures where analysis time actually goes, and answers ONE question with numbers:
is a columnar store (Parquet) or further optimization worth it, or is the current path fine?

    python scripts/telemetry/bench_pipeline.py                 # bench the newest capture
    python scripts/telemetry/bench_pipeline.py --all           # every capture, to show the scaling curve
    python scripts/telemetry/bench_pipeline.py --file X.csv

It reports, per capture: parse time, the share of total analysis that parsing is, the per-MB rate, what
column-pruning would save (measured, by parsing only the columns the analyzer reads), and what Parquet would
save (measured if pyarrow is installed, projected from the column-pruned rate if not). Then it prints a
VERDICT tied to the daemon's own re-analysis cadence — the only thing that matters is whether one analysis
finishes comfortably inside its interval.
"""
import csv, glob, io, json, os, statistics, sys, time

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

INTS = ("IsRaceOn", "Gear", "Accel", "Brake", "Clutch", "HandBrake", "Steer", "CarOrdinal", "CarPI", "CarClass",
        "DrivetrainType", "NumCylinders", "CarGroup", "LapNumber", "RacePosition", "Trailing323",
        "NormDrivingLine", "NormAIBrakeDiff")


def used_columns():
    """The columns analyze_session.py actually reads — measured from the source, not guessed."""
    src = open(os.path.join(HERE, "analyze_session.py"), encoding="utf-8").read()
    hdr = None
    for p in sorted(glob.glob(os.path.join(ROOT, "captures", "*.csv")), key=os.path.getmtime, reverse=True):
        with open(p, newline="") as f:
            hdr = next(csv.reader(f), None)
        if hdr:
            break
    if not hdr:
        return None, None
    used = {c for c in hdr if (f'"{c}"' in src or f"'{c}'" in src)}
    return hdr, used


def parse_full(path, cols=None, limit=None):
    """Time a parse over a sample. Returns (seconds, rows, bytes_consumed) — the byte count is what makes the
    whole-file projection honest (an earlier version derived rows from size and size from rows: circular, and
    it claimed a 1.5 GB file parsed in 1.9 s)."""
    n = 0
    with open(path, newline="") as f:
        rd = csv.DictReader(f)
        t0 = time.perf_counter()
        for r in rd:
            try:
                if cols is None:
                    {k: (int(float(v)) if k in INTS else float(v)) for k, v in r.items()}
                else:
                    {k: (int(float(r[k])) if k in INTS else float(r[k])) for k in cols}
            except Exception:
                continue
            n += 1
            if limit and n >= limit:
                break
        dt = time.perf_counter() - t0
    return dt, n


def avg_line_bytes(path, n=20000):
    """Mean bytes per data row, from a raw binary read — the honest divisor for size -> row count."""
    tot = 0; k = 0
    with open(path, "rb") as f:
        f.readline()                       # header
        for line in f:
            tot += len(line); k += 1
            if k >= n: break
    return (tot / k) if k else 1.0


def bench(path):
    size = os.path.getsize(path)
    hdr, used = used_columns()
    print(f"\n=== {os.path.basename(path)} — {size/1048576:.1f} MB ===")
    if hdr:
        print(f"    columns: {len(hdr)} in file · {len(used)} actually read by the analyzer "
              f"({100*len(used)/max(1,len(hdr)):.0f}%)")

    # sample-based projection so a 1.5 GB file does not take minutes to bench
    LIM = 60000
    t_all, n_all = parse_full(path, None, LIM)
    t_use, n_use = parse_full(path, used, LIM) if used else (None, 0)
    est_rows = size / avg_line_bytes(path)          # honest scaling for a variable-width CSV
    rate_all = n_all / t_all if t_all else 0
    proj_all = est_rows / rate_all if rate_all else 0
    print(f"    parse (ALL columns, as today): {rate_all:,.0f} rows/s → ~{proj_all:.1f}s for the whole file (~{est_rows:,.0f} rows)")
    if t_use:
        rate_use = n_use / t_use
        proj_use = est_rows / rate_use if rate_use else 0
        print(f"    parse (only used columns):     {rate_use:,.0f} rows/s → ~{proj_use:.1f}s  "
              f"({100*(1-proj_use/max(0.001,proj_all)):.0f}% faster)")
    else:
        proj_use = proj_all

    # Parquet: measure if pyarrow is present, otherwise say so plainly rather than guessing
    pq = None
    try:
        import pyarrow  # noqa: F401
        import pyarrow.csv as pv, pyarrow.parquet as pqm
        tmp = os.path.join(ROOT, "captures", "_bench.parquet")
        t0 = time.perf_counter(); tbl = pv.read_csv(path); t_read = time.perf_counter() - t0
        pqm.write_table(tbl, tmp, compression="zstd")
        psz = os.path.getsize(tmp)
        t0 = time.perf_counter(); pqm.read_table(tmp, columns=sorted(used) if used else None); t_pq = time.perf_counter() - t0
        os.remove(tmp)
        pq = (t_pq, psz)
        print(f"    parquet (zstd, used columns):  ~{t_pq:.1f}s read · {psz/1048576:.1f} MB on disk "
              f"({size/max(1,psz):.1f}x smaller, {proj_all/max(0.01,t_pq):.0f}x faster than today)")
    except ImportError:
        print("    parquet: pyarrow NOT installed — not measured (install to compare: pip install pyarrow)")
    return {"path": path, "size": size, "proj_all": proj_all, "proj_used": proj_use, "parquet": pq}


def verdict(results):
    print("\n" + "=" * 72)
    print("VERDICT — the only test that matters: does ONE analysis finish inside its own cadence?")
    print("  (daemon cadence: 20s <60MB · 45s <150MB · 90s <350MB · 300s beyond)")
    worst = max(results, key=lambda r: r["proj_all"])
    for r in sorted(results, key=lambda r: r["size"]):
        mb = r["size"] / 1048576
        cad = 20 if mb < 60 else 45 if mb < 150 else 90 if mb < 350 else 300
        head_now = r["proj_all"] / cad
        head_use = r["proj_used"] / cad
        flag = "OK" if head_now < 0.5 else ("TIGHT" if head_now < 1.0 else "OVERRUNS")
        print(f"  {mb:7.0f} MB · cadence {cad:3}s · parse {r['proj_all']:6.1f}s = {100*head_now:5.0f}% of it  [{flag}]"
              f"   → column-pruned: {100*head_use:4.0f}%")
    print()
    if worst["proj_all"] > 0:
        big = worst["size"] / 1048576
        print(f"  Largest capture: {big:.0f} MB, ~{worst['proj_all']:.0f}s to parse today.")
        gain = 1 - (worst["proj_used"] / worst["proj_all"]) if worst["proj_all"] else 0
        print(f"  Column pruning alone: {100*gain:.0f}% off parse time — free, no dependency.")
        if worst["parquet"]:
            print(f"  Parquet: {worst['parquet'][0]:.1f}s and {worst['parquet'][1]/1048576:.0f} MB "
                  f"(vs {big:.0f} MB CSV).")
            print("  → WORTH IT if the column-pruned figure still overruns the cadence above; otherwise defer.")
        else:
            print("  Parquet: unmeasured (no pyarrow). Rule of thumb: it wins only when the column-pruned")
            print("  parse still overruns the cadence — the table above says whether that is the case.")
    print("=" * 72)


def main():
    args = sys.argv[1:]
    caps = sorted(glob.glob(os.path.join(ROOT, "captures", "*.csv")), key=os.path.getsize)
    if "--file" in args:
        caps = [args[args.index("--file") + 1]]
    elif "--all" not in args:
        caps = caps[-1:] if caps else []
        big = [c for c in sorted(glob.glob(os.path.join(ROOT, "captures", "*.csv")), key=os.path.getsize)]
        caps = list({c: 1 for c in ([big[0]] if big else []) + ([big[len(big)//2]] if len(big) > 2 else []) + caps}.keys())
    if not caps:
        print("no captures to benchmark"); return
    res = [bench(p) for p in caps]
    verdict(res)
    try:
        import lap_store
        st = lap_store.stats(ROOT)
        print(f"\nlap store: {st['laps']} laps across {st['courses']} courses · {st['bytes']/1048576:.1f} MB")
        if st["laps"]:
            print(f"  per lap: {st['bytes']/st['laps']/1024:.1f} KB → 10,000 laps ≈ {st['bytes']/st['laps']*10000/1048576:.0f} MB")
    except Exception:
        pass


if __name__ == "__main__":
    main()
