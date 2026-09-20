"""Coverage audit: for every stored tune container, can clone_parts name every populated slot?

Classifies each populated (non-EMPTY) slot of each container by how its name resolves:
  proven    an explicit row in data/part-names.json proven by a saved setup / diff
  verified  catalogue row (base+tier) in a slot with at least one verified pair
  derived   catalogue row in a slot with no verified pair yet
  ladder    global tier ladder guess only
  brand     a brand-labelled slot (engine swap, body kit, wing, bumpers, hood, skirts): per-car, no table
  rim       rim_style ids: only the verified anchors resolve
  unknown   nothing resolves
A build is "clone-ready" when every populated non-stock slot is proven/verified by name, or is a dense
tile-position slot (drivetrain, engine swap, body kit, wing, front bumper, weight, cage, motor, the 8 size
ladders), or is set by the kit (hood, skirts, rear bumper), or is a rim (weight class read from the source
car), or is a catalogue-derived name on a base tier 0-3 (19/19 record). Late-added catalogue rows and
unknown indices are the only blockers. Writes data/clone-coverage.json and prints a summary.
"""
import datetime as _dt
import io, os, sys, glob, json, struct, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fh6_tune_decode as T
import clone_parts as C

out = io.TextIOWrapper(open(1, 'wb', closefd=False), encoding='utf-8', errors='replace')
ROOT = T.find_containers_root()
files = sorted(set(os.path.realpath(p) for p in glob.glob(os.path.join(ROOT, 'Tuning_*', 'Data'))))
cars = json.load(open(os.path.join(C.DATA, 'car-ordinals.json'), encoding='utf-8'))
cname = {}
def harvest(x):
    if isinstance(x, dict):
        for k, v in x.items():
            if k.isdigit() and isinstance(v, dict) and v.get('name'): cname[int(k)] = v['name']
            harvest(v)
    elif isinstance(x, list):
        for v in x: harvest(v)
harvest(cars)
pn = json.load(open(os.path.join(C.DATA, 'part-names.json'), encoding='utf-8'))
brand_slots = set((pn.get('catalogue', {}).get('brand_slots') or {}).get('slots') or [])
RIM = {'rim_style', 'rear_rim_style'}
DENSE_TILE = {'drivetrain', 'car_body', 'engine', 'rear_wing', 'front_bumper', 'weight_reduction', 'roll_cage', 'motor'}
AUTO_BY_KIT = {'hood', 'side_skirts', 'rear_bumper'}
SIZE_SLOTS = {'front_tire_width', 'rear_tire_width', 'front_rim_size', 'rear_rim_size', 'front_track_width', 'rear_track_width', 'front_tire_profile', 'rear_tire_profile'}

def classify(slot, pid, ordinal):
    ps, idx = C.split_any(pid, ordinal)
    if slot in RIM:
        nm, conf = C.resolve_name(slot, idx, pid)
        return ('rim-proven' if nm else 'rim', idx, nm)
    if idx is None:
        return ('unknown', None, None)
    nm, conf = C.resolve_name(slot, idx, pid)
    if nm is None:
        if slot in brand_slots: return ('brand', idx, None)
        tn = C.tier_name(slot, idx)
        return ('ladder' if tn else 'unknown', idx, tn)
    if conf == 'proven': return ('proven', idx, nm)
    if conf == 'verified': return ('verified', idx, nm)
    if conf == 'derived': return ('derived', idx, nm)
    return ('ladder', idx, nm)

per_slot = collections.defaultdict(collections.Counter)
gaps = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))   # slot -> (idx or pid) -> ordinal count
builds = []
for p in files:
    b = open(p, 'rb').read()
    if len(b) != 598: continue
    o = struct.unpack_from('<H', b, 2)[0]
    parts = {}
    for i, slot in enumerate(T.PARTS):
        v = struct.unpack_from('<I', b, T.OFF_PARTS + 4 * i)[0]
        if v != 0xFFFFFFFF: parts[slot] = v
    blockers = []
    for slot, pid in parts.items():
        cls, idx, nm = classify(slot, pid, o)
        per_slot[slot][cls] += 1
        stock = idx is not None and idx % 100 == 0 and slot not in RIM
        # 2026-09-02 audit: size slots are dense (tile = tier + 1); catalogue-derived names are clone-safe on the
        # base tiers 0-3 (19/19 record); only late-added catalogue rows (tier >= 4, or slots with no base run)
        # remain real gaps. Rims are a weight class read from the source car, so they never block.
        if slot in SIZE_SLOTS or slot in DENSE_TILE or slot in AUTO_BY_KIT or slot in RIM:
            continue
        if cls == 'derived' and idx is not None and idx % 100 <= 3:
            continue
        if cls in ('proven', 'verified', 'rim-proven') or stock:
            continue
        key = pid if slot in RIM else idx
        gaps[slot][key][o] += 1
        blockers.append((slot, key, cls))
    builds.append({'path': p, 'ordinal': o, 'car': cname.get(o, '?'), 'blockers': blockers})

ready = [x for x in builds if not x['blockers']]
print('  containers: %d   clone-ready now: %d (%.1f%%)' % (len(builds), len(ready), 100.0 * len(ready) / max(1, len(builds))), file=out)
by_reason = collections.Counter()
for x in builds:
    kinds = sorted(set(c for _, _, c in x['blockers']))
    by_reason[' + '.join(kinds) if kinds else 'ready'] += 1
print('  builds by blocker kind: %s' % dict(by_reason.most_common()), file=out)
print('  --- per slot (populated occurrences by resolution class) ---', file=out)
for slot in T.PARTS:
    if per_slot.get(slot): print('  %-26s %s' % (slot, dict(per_slot[slot])), file=out)
print('  --- gaps: slot -> index/id -> builds (top cars) ---', file=out)
gap_rows = []
for slot, m in gaps.items():
    for key, cnt in sorted(m.items(), key=lambda kv: -sum(kv[1].values())):
        n = sum(cnt.values()); top = ', '.join('%s x%d' % (cname.get(oo, 'ord %d' % oo), c) for oo, c in cnt.most_common(3))
        gap_rows.append({'slot': slot, 'key': key, 'builds': n, 'cars': len(cnt), 'top': top})
gap_rows.sort(key=lambda r: -r['builds'])
for r in gap_rows[:60]:
    print('  %-26s %-8s %4d builds %3d cars  %s' % (r['slot'], r['key'], r['builds'], r['cars'], r['top']), file=out)
# schema_version + generated: this is a GENERATED report, and it carried neither, so a stale copy
# was indistinguishable from a fresh one and no consumer could tell which shape it was reading.
# Every other committed store under data/ declares one or the other (see DATA-INVENTORY.md §2).
json.dump({'schema_version': '1.0.0',
           'generated': _dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'containers': len(builds), 'clone_ready': len(ready), 'by_blocker_kind': dict(by_reason), 'per_slot': {k: dict(v) for k, v in per_slot.items()},
           'gaps': gap_rows, 'ready_examples': [x['car'] for x in ready[:20]]},
          open(os.path.join(C.DATA, 'clone-coverage.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('  wrote data/clone-coverage.json (%d gap rows)' % len(gap_rows), file=out)
out.flush()
