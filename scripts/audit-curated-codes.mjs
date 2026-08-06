// Audit meta-car curated tune codes by provenance/reliability.
// Codes can't be validated without loading them in-game — the best proxy is whether the machine-ingested
// pool (actively-maintained community sheets) corroborates the code, or at least has a same-car tune.
// Run: node scripts/audit-curated-codes.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const meta = read("meta-cars.json");
const pool = read("tuner-sheets.json").tunes;

const tnorm = (s) => (s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\b(19|20)\d\d\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const GEN = new Set(["forza", "edition", "the"]);
const poolCodes = new Set(pool.map((t) => t.code));
const poolIdx = pool.map((t) => ({ ...t, toks: new Set(tnorm(t.car).split(" ").filter((w) => w.length > 1)) }));
const poolTunesForCar = (name) => {
  const qt = tnorm(name).split(" ").filter((w) => w.length > 1);
  const mk = qt[0], model = qt.filter((t) => t !== mk && !GEN.has(t));
  return poolIdx.filter((e) => e.toks.has(mk) && model.some((t) => e.toks.has(t)));
};
const curatedCode = (c) => {
  if (c.tune_code) return { code: c.tune_code, src: c.tune_source };
  const t = (c.tunes || []).find((x) => x.code); if (t) return { code: t.code, src: t.source };
  const s = (c.share_codes || []).find((x) => x.code); if (s) return { code: s.code, src: s.source };
  return null;
};

const buckets = { corroborated: [], handWithAlt: [], handNoAlt: [] };
for (const c of meta.cars) {
  const cc = curatedCode(c); if (!cc) continue;
  if (poolCodes.has(cc.code)) buckets.corroborated.push({ car: c.name, ...cc });
  else if (poolTunesForCar(c.name).length) buckets.handWithAlt.push({ car: c.name, ...cc, alts: poolTunesForCar(c.name).length });
  else buckets.handNoAlt.push({ car: c.name, ...cc });
}

const total = buckets.corroborated.length + buckets.handWithAlt.length + buckets.handNoAlt.length;
console.log(`Curated meta-car codes: ${total}`);
console.log(`  ✅ pool-corroborated (exact code in machine pool):        ${buckets.corroborated.length}`);
console.log(`  🟡 hand-sourced, pool has a same-car alt (fixable):       ${buckets.handWithAlt.length}`);
console.log(`  🔴 hand-sourced, NO cross-check anywhere (verify first):  ${buckets.handNoAlt.length}`);
if (buckets.handNoAlt.length) {
  console.log("\nNo-cross-check codes (highest risk — verify in-game before trusting):");
  buckets.handNoAlt.forEach((x) => console.log(`  ${x.car} [${x.code}] ${x.src || ""}`));
}
console.log("\nHand-sourced with pool fallback (re-check if reported broken):");
buckets.handWithAlt.forEach((x) => console.log(`  ${x.car} [${x.code}] ${x.src || ""} — ${x.alts} pool alt(s)`));
