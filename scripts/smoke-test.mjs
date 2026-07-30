// Headless smoke test: boots the real dashboard (index.html + db.js + app.js) in jsdom
// and exercises every interactive surface — every recommend card's modal (across all
// discipline×class filters), every tab, the coverage matrix, and the tune-codes overlay —
// failing on ANY thrown error. Catches the class of bug where a card click crashes silently.
// Run: node scripts/smoke-test.mjs   (or: npm test)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// capture uncaught exceptions from event handlers (jsdom reports them as 'jsdomError')
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push((e && (e.detail?.stack || e.detail?.message || e.message)) || String(e)));

const dom = new JSDOM(read("dashboard/index.html"), {
  runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc,
});
const { window } = dom;
const { document } = window;
window.addEventListener("error", (e) => errors.push(e.error?.stack || e.message));
// jsdom doesn't implement layout APIs the app calls in real browsers — stub them (not app bugs)
window.Element.prototype.scrollIntoView = window.Element.prototype.scrollIntoView || function () {};

let pass = 0; const fails = [];
const check = (name, fn) => { errors.length = 0; try { fn(); if (errors.length) throw new Error(errors[0].split("\n")[0]); pass++; } catch (e) { fails.push(name + " → " + e.message); } };

// ---- boot: db.js then app.js (init runs synchronously) ----
window.eval(read("dashboard/db.js"));
check("boot app.js", () => { window.eval(read("dashboard/app.js")); if (window.document.body.textContent.includes("db.js not loaded")) throw new Error("DB missing"); });
if (fails.length) { console.log("✗ boot failed:\n  " + fails.join("\n  ")); process.exit(1); }

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));

// ---- 1) every tab switches without throwing (re-runs its render path) ----
$$(".tab").forEach((t) => check("tab:" + t.dataset.tab, () => t.click()));

// ---- 2) every recommend card opens its modal, across all discipline×class filters ----
$(".tab[data-tab='recommend']").click();
const fd = $("#fDiscipline"), fc = $("#fClass");
const clicked = new Set();
const clickAllCards = (ctx) => $$("#recoCards .car-card").forEach((card) => {
  const title = (card.querySelector("h3")?.textContent || "?").trim();
  if (clicked.has(title)) return; clicked.add(title);
  check("card:" + title + " " + ctx, () => {
    card.click();
    if ($("#modal").classList.contains("hidden")) throw new Error("modal did not open");
    if (!$("#modalContent").textContent.trim()) throw new Error("modal empty");
    $("#modalClose").click();
  });
});
for (const od of [...fd.options]) for (const oc of [...fc.options]) {
  fd.value = od.value; fire(fd, "change");
  fc.value = oc.value; fire(fc, "change");
  clickAllCards(`[${od.value || "any"}/${oc.value || "any"}]`);
}

// ---- 3) coverage-matrix cells are clickable ----
check("coverage matrix cells", () => { const cells = $$("#covMatrix td[data-d]"); if (!cells.length) throw new Error("no matrix cells"); cells.slice(0, 12).forEach((td) => td.click()); });

// ---- 4) tune-codes overlay opens and renders ----
check("tune-codes overlay", () => { $("#allCodesBtn").click(); if (!$("#tcTableWrap") || !$("#tcTableWrap").textContent.trim()) throw new Error("overlay did not render"); });

// ---- report ----
console.log(`\nSmoke test: ${pass} passed, ${fails.length} failed. Unique cars exercised: ${clicked.size}.`);
if (fails.length) { console.log("FAILURES:"); fails.slice(0, 25).forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
console.log("✅ all interactive surfaces OK (cards, tabs, matrix, overlay)");
