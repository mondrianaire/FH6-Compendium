// Categorization audit: does each meta-car's RECOMMENDED tune actually match that car's
// discipline and class? Catches mislabels like a dirt tune shown as a road recommendation
// (the TVR Cerbera case). Cross-references the machine-ingested pool for ground-truth discipline/class.
// Run: node scripts/audit-categorization.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const meta = read("meta-cars.json");
const pool = read("tuner-sheets.json").tunes;

const byCode = new Map(pool.map((t) => [t.code, t]));           // code -> pool tune (ground-truth discipline/class)
const tnorm = (s) => (s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\b(19|20)\d\d\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const GEN = new Set(["forza", "edition", "the"]);
const poolIdx = pool.map((t) => ({ ...t, toks: new Set(tnorm(t.car).split(" ").filter((w) => w.length > 1)) }));
const poolTunesForCar = (name) => {
  const qt = tnorm(name).split(" ").filter((w) => w.length > 1);
  const mk = qt[0], model = qt.filter((t) => t !== mk && !GEN.has(t));
  return poolIdx.filter((e) => e.toks.has(mk) && model.some((t) => e.toks.has(t)));
};
// car discipline -> pool bucket(s)
const DISC = { road: "road", touge_street: "road", street: "road", dirt_rally: "dirt/offroad", cross_country: "dirt/offroad", offroad: "dirt/offroad", drift: "drift", drag: "drag" };
const carBuckets = (c) => new Set((c.disciplines || []).map((d) => DISC[d]).filter(Boolean));
// surface label -> bucket (fallback when code not in pool)
const SURF = { road: "road", touge: "road", street: "road", dirt: "dirt/offroad", rally: "dirt/offroad", cc: "dirt/offroad", cross_country: "dirt/offroad", drift: "drift", drag: "drag" };
const CLASS_ORDER = ["D", "C", "B", "A", "S1", "S2", "X", "R"];
const expandClass = (cls) => {
  if (!cls) return [];
  if (cls.includes("-")) { const [lo, hi] = cls.split("-"); const i = CLASS_ORDER.indexOf(lo), j = CLASS_ORDER.indexOf(hi); if (i >= 0 && j >= i) return CLASS_ORDER.slice(i, j + 1); }
  return [cls];
};
const curatedTune = (c) => {
  if (c.tune_code) return { code: c.tune_code, surface: null, source: c.tune_source };
  const t = (c.tunes || []).find((x) => x.code); if (t) return t;
  const s = (c.share_codes || []).find((x) => x.code); if (s) return { code: s.code, surface: s.purpose, source: s.source };
  return null;
};

const flags = [];
for (const c of meta.cars) {
  const cur = curatedTune(c); if (!cur) continue;
  const p = byCode.get(cur.code);                              // ground truth if code is in the pool
  const tuneDisc = p ? p.discipline : (SURF[(cur.surface || "").toLowerCase()] || null);
  const tuneClass = p ? p.class : null;
  const cb = carBuckets(c);
  const issues = [];
  // discipline mismatch: tune is for a discipline the car isn't listed for
  if (tuneDisc && cb.size && !cb.has(tuneDisc)) issues.push(`DISCIPLINE: tune is ${tuneDisc}, car is [${[...cb].join("/")}]${p ? " (pool truth)" : " (our label)"}`);
  // class mismatch: pool tune's class not in the car's class range
  if (tuneClass && !expandClass(c.class).includes(tuneClass)) issues.push(`CLASS: tune is ${tuneClass}, car is ${c.class}`);
  if (issues.length) {
    const fix = poolTunesForCar(c.name).filter((t) => cb.has(t.discipline) && expandClass(c.class).includes(t.class));
    flags.push({ car: c.name, code: cur.code, source: cur.source, issues, fixes: fix.map((f) => `${f.class}/${f.discipline} ${f.code} (${f.creator})`) });
  }
}

console.log(`Categorization audit — ${meta.cars.length} meta cars, ${meta.cars.filter(curatedTune).length} with a curated tune`);
console.log(`Mis-categorized recommendations: ${flags.length}\n`);
for (const f of flags) {
  console.log(`✗ ${f.car}  [${f.code}] ${f.source || ""}`);
  f.issues.forEach((i) => console.log(`    ${i}`));
  console.log(`    fix options (right discipline+class in pool): ${f.fixes.length ? f.fixes.join(" | ") : "NONE — needs manual/verify"}`);
}
if (!flags.length) console.log("✅ every recommended tune matches its car's discipline and class.");

// ---- acquisition-difficulty categorization ----
// 🔴 hard means luck-gated / money-can't-help (RNG-only, not sold). A Playlist reward is deterministic
// effort, and anything with an Auction House / credits path is 🟡 — never 🔴.
console.log("\n--- acquisition difficulty ---");
const acqFlags = [];
for (const c of meta.cars) {
  const d = c.acquisition_difficulty || "";
  const a = (c.acquisition || "").toLowerCase();
  const hasCreditsPath = /playlist|auction|aftermarket|autoshow|treasure|barn find|journal|reward/.test(a);
  const rngOnly = /only|not sold/.test(a) && /wheelspin|rng/.test(a);
  if ((d === "hard" || d === "hard-unconfirmed") && hasCreditsPath && !rngOnly)
    acqFlags.push(`${c.name}: 🔴 hard, but acquisition has a credits/effort path — should be 🟡 medium (${(c.acquisition || "").slice(0, 60)})`);
  if (d === "easy" && /wheelspin|rng/.test(a) && rngOnly)
    acqFlags.push(`${c.name}: 🟢 easy, but acquisition is RNG-only — should be 🔴 hard`);
}
console.log(`Acquisition mis-categorizations: ${acqFlags.length}`);
acqFlags.forEach((f) => console.log("  ✗ " + f));
