// Ingest public tuner Google Sheets (FH6 tabs only) into data/tuner-sheets.json.
// Sheets are public → fetched via gviz CSV export (no auth). Run: node scripts/ingest-tuner-sheets.mjs [--preview]
// Provenance: every tune carries source (which sheet) + creator (actual author). Confidence = sourced-unverified
// (community tune codes, not personally play-tested). CSV export strips hyperlink targets, so sheets whose codes
// live only in cell links (kleis) are ingested as codeless recommendations.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW = process.argv.includes("--preview");
const CODE = /\b\d{3}\s*\d{3}\s*\d{3}\b/;

function parseCSV(t) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else if (c !== "\r") cur += c; }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const cell = (r, i) => (i == null || r[i] == null ? "" : String(r[i]).replace(/\s+/g, " ").trim());
const normCode = (s) => {
  const m = (s || "").match(CODE); if (!m) return "";
  const d = m[0].replace(/\D/g, "");
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : m[0].replace(/\s+/g, " ");
};
const normClass = (s) => {
  const k = (s || "").toUpperCase().replace(/[-\s]*CLASS/g, "").replace(/[^A-Z0-9]/g, "").trim();
  return ["D", "C", "B", "A", "S1", "S2", "X", "R"].includes(k) ? k : (k || "");
};
// Derive a normalized discipline from free text (focus/notes/tune-name), rather than trusting
// positionally-ambiguous columns. Order matters (drift/drag before road).
function deriveDiscipline(text, fallback) {
  const s = (text || "").toLowerCase();
  if (/\bdrift\b/.test(s)) return "drift";
  if (/\bdrag\b/.test(s)) return "drag";
  if (/(dirt|off[- ]?road|offroad|cross ?country|\bcc\b)/.test(s)) return "dirt/offroad";
  if (/(road|street|touge|tarmac|grip|circuit|track|goliath|speed|handling|accel|allround|all[- ]around|purist|balance|launch)/.test(s)) return "road";
  return fallback || "";
}
async function fetchTab(id, tab) {
  const u = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return parseCSV(await r.text());
}

// ---- coded tune sources (share codes present in cell text) ----
const SOURCES = [
  {
    tuner: "aTTaX Johnson Racing", id: "1F3xqy6yodUmnuua08YU-fet4KDDoIbaoNZRiZ9U8yxk", tabs: ["Horizon 6"],
    map: { class: 0, car: 1, focus: 2, creator: 3, code: 4, notes: 5 },
  },
  {
    tuner: "GBR Ozzy", id: "1FQ29uIAWVEJDT41sx9bEoqz0BGLpOi9MdA2hp0uzP9w", tabs: ["🛠️FH6 Tune List"],
    map: { make: 1, model: 2, class: 3, focus: 4, creator: 5, drivetrain: 6, discipline: 9, surface: 10, date: 11, code: 12 },
  },
  {
    tuner: "OxGRIDRUNR", id: "1CRKW7Kmpqz7AZeNDD4WL4A9CoT-ldFRFPOaxTFLYzMY", tabs: ["Sheet1"],
    map: { class: 0, year: 1, make: 2, model: 3, focus: 4, code: 5, drivetrain: 6, tire: 7, engine: 8, notes: 9 },
    discipline: "drift",
  },
  {
    tuner: "LogikJ", id: "1ZDLQ1Jg6E6VWfMZUZX-GWflVRl75xSYPj4NHUYwZnLo", tabs: ["🛠️LogikJ's Tunes", "LogikJ's Tunes - CBA12RD", "LogikJ's Tunes - D-R"],
    map: { year: 0, make: 1, model: 2, category: 3, focus: 5, class: 6, drivetrain: 8, engine: 9, build: 10, tire: 11, discipline: 12, usage: 13, date: 14, code: 15 },
  },
  {
    // Guest tuner hosted on LogikJ's sheet — same column layout.
    tuner: "K1Z Gray", id: "1ZDLQ1Jg6E6VWfMZUZX-GWflVRl75xSYPj4NHUYwZnLo", tabs: ["K1Z Gray's Tunes"],
    map: { year: 0, make: 1, model: 2, category: 3, focus: 5, class: 6, drivetrain: 8, engine: 9, build: 10, tire: 11, discipline: 12, usage: 13, date: 14, code: 15 },
  },
];
// Deliberately NOT ingested (logged for transparency, not silently dropped):
const SKIPPED = [
  "LogikJ seasonal 'Series 1/2/3 × season' tabs — heavy overlap with the master tune list (dedupe would collapse); event-specific picks only",
  "LogikJ '🏁Online Racing Tune Picks' + 'aiolos5656 Tunes/Drag' — <5 parseable codes / messy merged layout; low yield",
  "kleis codes — live in cell hyperlinks that CSV export omits (kept as codeless recommendations)",
  "Noa Miyako (docs.qq.com) — Tencent Docs, no CSV/gviz API; needs separate DOM scrape",
];

function buildTune(src, tab, r) {
  const m = src.map;
  const code = normCode(m.code != null ? r[m.code] : r.find((c) => CODE.test(c)));
  if (!code) return null;
  const car = m.car != null
    ? cell(r, m.car)
    : ["year", "make", "model"].map((k) => cell(r, m[k])).filter(Boolean).join(" ");
  if (!car) return null;
  const notes = ["notes", "usage", "surface", "category"].map((k) => cell(r, m[k])).filter(Boolean).join(" · ");
  const focus = cell(r, m.focus);
  return {
    car, class: normClass(cell(r, m.class)), code,
    creator: cell(r, m.creator) || src.tuner,
    focus, drivetrain: cell(r, m.drivetrain),
    discipline: src.discipline || deriveDiscipline([focus, cell(r, m.build)].join(" "), ""),
    tire: cell(r, m.tire), engine: cell(r, m.engine),
    build: cell(r, m.build), date: cell(r, m.date), notes,
    source: src.tuner, tab,
  };
}

// ---- kleis: codeless recommendation index (codes are hyperlinks, stripped by CSV) ----
const KLEIS = { id: "1Lv3OzABIpX8_vlXS5zuOXMmrBVhpuLsU", tab: "FH6" };
async function ingestKleis() {
  const rows = await fetchTab(KLEIS.id, KLEIS.tab);
  const recs = [];
  for (const r of rows) {
    const car = cell(r, 0), tuner = cell(r, 1), desc = cell(r, 2);
    if (!car || !tuner || /^car$/i.test(car) || car.length > 80 || !/\d|Nissan|Ford|Honda|Toyota|BMW|Audi|Chevrolet|Mazda|Subaru|Porsche|Lamborghini|Ferrari|Merced/i.test(car)) continue;
    recs.push({ car, tuner, desc, discipline: cell(r, 3), drivetrain: cell(r, 4), livery_by: cell(r, 5), livery: cell(r, 6), tag: cell(r, 7) });
  }
  return recs;
}

async function preview() {
  for (const s of SOURCES) for (const tab of s.tabs) {
    const rows = await fetchTab(s.id, tab);
    console.log(`\n== ${s.tuner} / ${tab} rows=${rows.length}`);
    rows.slice(0, 4).forEach((r, i) => console.log(i, JSON.stringify(r.map((c) => (c || "").slice(0, 20)))));
  }
}

async function run() {
  const all = [];
  const sourceStats = [];
  for (const s of SOURCES) {
    let n = 0;
    for (const tab of s.tabs) {
      const rows = await fetchTab(s.id, tab);
      for (const r of rows) { const t = buildTune(s, tab, r); if (t) { all.push(t); n++; } }
    }
    sourceStats.push({ tuner: s.tuner, id: s.id, tabs: s.tabs, rawTunes: n });
  }
  // dedupe by code (codes are globally unique per upload); merge source list on collision
  const byCode = new Map();
  for (const t of all) {
    if (byCode.has(t.code)) { const e = byCode.get(t.code); if (!e.also_in) e.also_in = []; if (!e.also_in.includes(t.source)) e.also_in.push(t.source); }
    else byCode.set(t.code, t);
  }
  const tunes = [...byCode.values()];

  const kleisRecs = await ingestKleis();

  const out = {
    schema_version: "1.0.0",
    captured: process.env.CAP || "2026-07-30",
    origin: "reddit.com/r/ForzaHorizon6 — Flamesty's 'comprehensive list of good tuners' + linked public tuner sheets",
    confidence: "sourced-unverified (community tune codes from public tuner sheets; not personally play-tested)",
    fh6_only: true,
    caveat: "CSV export omits hyperlink targets, so kleis (codes in links) is ingested codeless as a recommendation index. Some sheet tabs mix FH5-era entries; only FH6-labelled tabs were pulled.",
    sources: sourceStats,
    not_ingested: SKIPPED,
    counts: { coded_tunes_raw: all.length, coded_tunes_unique: tunes.length, kleis_recommendations: kleisRecs.length },
    tunes,
    kleis_recommendations: kleisRecs,
  };
  writeFileSync(join(root, "data", "tuner-sheets.json"), JSON.stringify(out, null, 2) + "\n");

  console.log("Wrote data/tuner-sheets.json");
  console.log("Coded tunes: raw", all.length, "→ unique", tunes.length);
  console.log("kleis recommendations:", kleisRecs.length);
  console.log("Per source:", sourceStats.map((s) => `${s.tuner}:${s.rawTunes}`).join("  "));
  const byClass = {}; tunes.forEach((t) => byClass[t.class || "?"] = (byClass[t.class || "?"] || 0) + 1);
  console.log("By class:", JSON.stringify(byClass));
  const byDisc = {}; tunes.forEach((t) => byDisc[t.discipline || "?"] = (byDisc[t.discipline || "?"] || 0) + 1);
  console.log("By discipline:", JSON.stringify(byDisc));
}

if (PREVIEW) await preview(); else await run();
