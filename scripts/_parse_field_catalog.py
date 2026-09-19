#!/usr/bin/env python3
"""One-off parser: docs/data-field-catalog-2026-09-03.md -> data/field-catalog.json
Not part of the pipeline; run once by the field-catalog extraction task."""
import json
import re

SRC = "docs/data-field-catalog-2026-09-03.md"
OUT = "data/field-catalog.json"

with open(SRC, encoding="utf-8") as f:
    lines = f.read().split("\n")

# store id = the backtick-quoted or first-token identifier in the ### heading
heading_re = re.compile(r"^### `?([A-Za-z0-9_\-.\*/]+)`?")
table_row_re = re.compile(r"^\|(.+)\|$")

STORE_DOMAIN_KEYWORDS = [
    (["route", "course", "track", "surface", "world", "region", "locator", "triggerzone",
      "map", "environments", "landmark", "poi", "points-of-interest", "aidensit"], "world"),
    (["progression", "profile", "owned-cars", "wheelspin", "save-index", "save-misc",
      "input", "controller", "wheel-ffb", "estate", "garage", "customroute", "livery",
      "character", "player"], "player_meta"),
    (["schema-sql", "rebuild-log", "daemon-endpoint", "import_run", "live-daemon"], "project"),
]
STORE_DOMAIN_DEFAULT = "car"  # most FH6 stores in this catalog are car/tune-centric


def classify_domain(store_id, section):
    sid = store_id.lower()
    if section == "External" or "vetted-guides" in sid or "tuner-guide" in sid:
        return "project"
    for kws, dom in STORE_DOMAIN_KEYWORDS:
        if any(k in sid for k in kws):
            return dom
    return STORE_DOMAIN_DEFAULT


TYPE_MAP = [
    (r"\bbool\b", "bool"),
    (r"\bjson\b|\bnested[- ]?obj|\barray|\bblob\b(?!.*text)", "json"),
    (r"\benum\b", "enum"),
    (r"\bint\d*\b|\buint\d*\b|\bu\d+\b(?!\w)|\bi\d+\b(?!\w)", "int"),
    (r"\bfloat\d*\b|\breal\b|\bdouble\b", "float"),
    (r"\btext\b|\bchar\b|\bstring\b", "string"),
]


def classify_type(type_col):
    t = type_col.lower()
    for pat, kind in TYPE_MAP:
        if re.search(pat, t):
            return kind
    return "string"


def clean_cell(c):
    c = c.strip()
    c = c.replace("\\|", "|")
    if c in ("—", "-", "n/a", ""):
        return None
    return c


# Generic prefixes that recur across many unrelated binary/JSON formats in this doc (header, block,
# section, row, payload, ...) -- splitting on these as if they were distinct stores collapses
# unrelated fields from different real stores into one wrong bucket. Only split on a real SQL-style
# table name (ref_/tune_/hw_/session/lap/course/obs_/plan_/import_run/schema_meta or an explicit
# known table) or an explicit "<file>.json:" prefix.
KNOWN_TABLE_RE = re.compile(
    r"^(ref_[a-z_]+|tune_[a-z_]+|hw_package(_part)?|setup|session(_car)?|lap(_point)?|corner_obs|"
    r"course(_route|_turn)?|obs_[a-z_]+|plan_clone(_step)?|plan_readiness|import_run|schema_meta|"
    r"diag_event)$"
)


def split_store_field(name_col, current_store):
    """'ref_car.ordinal' -> (ref_car, ordinal) for known table names. Everything else stays scoped
    to the enclosing ### store so generic prefixes (header., block., row.) from different binary
    formats never collide across stores."""
    name_col = name_col.strip().strip("`")
    m2 = re.match(r"^([A-Za-z0-9_\-]+\.json):\s*(.+)$", name_col)
    if m2:
        return m2.group(1), m2.group(2)
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_\[\].]+)$", name_col)
    if m and KNOWN_TABLE_RE.match(m.group(1)):
        return m.group(1), m.group(2)
    return current_store, name_col


records = {}
current_store = None
current_section = None
header_cols = None
in_table = False

for raw in lines:
    line = raw.rstrip("\n")
    if line.startswith("## "):
        current_section = line[3:].strip()
        continue
    hm = heading_re.match(line)
    if hm:
        current_store = hm.group(1)
        in_table = False
        header_cols = None
        continue
    if not current_store:
        continue
    rm = table_row_re.match(line)
    if not rm:
        in_table = False
        header_cols = None
        continue
    cells = [c.strip() for c in rm.group(1).split("|")]
    if all(re.match(r"^:?-{2,}:?$", c) for c in cells):
        in_table = True
        continue
    if not in_table and header_cols is None:
        low = [c.lower() for c in cells]
        if low and (low[0] in ("field", "name", "table")):
            header_cols = low
            continue
        else:
            continue
    if header_cols is None:
        continue
    if len(cells) < 3:
        continue
    row = dict(zip(header_cols, cells))
    name_col = row.get("field") or row.get("name") or row.get("table") or ""
    if not name_col:
        continue
    type_col = row.get("type", "")
    join_col = row.get("join target", "") or row.get("join target ", "")
    enum_col = row.get("enum/range", "") or row.get("enum / range", "")
    meaning_col = row.get("meaning", "")

    store, field = split_store_field(name_col, current_store)
    if not field:
        continue

    domain = classify_domain(store, current_section)
    storage_type = classify_type(type_col)
    join_target = clean_cell(join_col)
    if join_target:
        join_target = re.sub(r"\s*\(.*?verified.*?\)", "", join_target, flags=re.I).strip()
        if join_target.lower() in ("none", "none confirmed", "none resolvable", "n/a"):
            join_target = None
    enum_source = None
    if storage_type == "enum":
        ec = clean_cell(enum_col)
        jc = clean_cell(join_col)
        enum_source = jc or ec
    notes = clean_cell(meaning_col)
    if notes and len(notes) > 240:
        notes = notes[:237] + "..."

    key = (store, field)
    rec = {"store": store, "field": field, "domain": domain, "storage_type": storage_type,
           "enum_source": enum_source, "join_target": join_target, "notes": notes}
    if key in records:
        prev = records[key]
        merged_notes = prev["notes"]
        if notes and notes != prev["notes"]:
            merged_notes = (prev["notes"] + " | " + notes) if prev["notes"] else notes
            if len(merged_notes) > 240:
                merged_notes = merged_notes[:237] + "..."
        rec["notes"] = merged_notes
        rec["join_target"] = prev["join_target"] or rec["join_target"]
        rec["enum_source"] = prev["enum_source"] or rec["enum_source"]
    records[key] = rec

out = list(records.values())
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)

stores = sorted({r["store"] for r in out})
print("total fields:", len(out))
print("distinct stores represented:", len(stores))
