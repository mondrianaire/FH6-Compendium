/* panel.js — the instrument panel: five regions whose contents follow the workflow state.
 *
 * The regions never move. What fills them is decided by two things and nothing else:
 *   MODE    free | course | decode   — from the daemon's own mode event, sticky through menus
 *   STATUS  downloaded | unknown | variation | clone | ratified — from five observable variables
 * docs/dashboard-states.md is the contract this file implements. If the two disagree, the doc wins
 * and this file is wrong.
 */
"use strict";

let MODE = { suggest: "free", reason: "no signal yet", kind: null, game: null };
let WORLD = null, DIAG = null, COURSES = null, COURSE = null, COURSE_KEY = null;
let RIGHT_TAB = null;              // null = follow the context; a click pins a tab until the context class changes
let RIGHT_CTX = null;
let BASELINE = null;
let LIVEPOS = null;

/* ----------------------------------------------------------- status */
// The five variables and the status they decide. Every branch here is a row of the table in
// docs/dashboard-states.md §3; the order of the tests is the order of the table.
function buildStatus() {
  if (!CUR) return { key: "none", label: "no car", tone: "dim", why: "waiting for the game" };
  const disk = CUR.disk, q = matchQuality(CUR.match);
  const drift = !!(CUR.match && LIVE_PI && CUR.match.chosen_pi != null && LIVE_PI !== CUR.match.chosen_pi);
  if (!disk) return { key: "unknown", label: "unknown / unsaved", tone: "bad",
    why: "no save on disk for this car", steps: ["save the setup in-game with a name", "the save is read the moment a menu closes"] };
  if (drift) return { key: "unknown", label: "unknown / unsaved", tone: "bad",
    why: "live PI " + LIVE_PI + " matches no save; the hardware changed and has not been saved",
    steps: ["save the setup with a name to hold it", "then it can be identified, cloned and compared"] };
  const locked = !!(disk.tune && disk.tune.locked);
  const hwOk = !!(MATCH && MATCH.hw && MATCH.hw.length);
  const tuneOk = !!(MATCH && MATCH.exact && MATCH.exact.length);
  const ambiguous = q.level !== "ok";
  if (!hwOk) return { key: "unknown", label: locked ? "downloaded, not yet held" : "new build on disk", tone: "warn",
    why: (RB.state === "running" || RB.pending) ? "a save the database does not hold yet — importing it now"
       : locked ? "a downloaded tune installed since the last import — the import runs by itself"
       : "a save written since the last import — the import runs by itself",
    steps: ["import the save and regenerate the dashboard data — one button, about 10 s"], rebuild: true };
  if (locked) return { key: "downloaded", label: "downloaded / locked", tone: "warn",
    why: "someone else's build; sliders are hidden by the lock",
    steps: ["clone it onto a second copy of the car (BUILD SHEET)", "save the clone with a name — only then can it be tuned or compared"], ambiguous };
  if (!tuneOk) {
    const base = MATCH.hw[0];
    return { key: "variation", label: "variation", tone: "blue",
      why: "same hardware as '" + (base.name || "a held build") + "', different sliders — an A/B in progress",
      base, steps: ["drive laps on both setups", "compare A/B — laps are stored against the setup that drove them"], ambiguous };
  }
  const twins = MATCH.exact;
  const onlyLockedTwins = twins.every((b) => b.locked);
  if (onlyLockedTwins) return { key: "clone", label: "unsaved clone", tone: "blue",
    why: "identical to a locked build; this unlocked copy is not yet held as its own build",
    steps: ["save it under its own name", "re-import so the clone becomes a ratified build"], ambiguous };
  return { key: "ratified", label: "ratified", tone: "ok",
    why: "your own saved, unlocked build" + (twins.length > 1 ? " (" + twins.length + " identical saves)" : ""),
    twin: twins.find((b) => !b.locked) || twins[0], ambiguous };
}

/* ------------------------------------------------------------ layout */
function panelSkeleton(host) {
  host.innerHTML = `
    <div class="hdr" id="hdr"></div>
    <div class="trace" id="trace"></div>
    <div id="alerts"></div>
    <div class="panes">
      <section class="pane" id="pLeft"><header id="leftHd">Map</header><div class="body map" id="leftBody"></div></section>
      <section class="pane" id="pRight"><header id="rightHd">Statistics</header><div class="body" id="rightBody"></div></section>
    </div>
    <div class="dock" id="dock"></div>
    <div class="ftr" id="ftr"></div>`;
}

async function panelBoot() {
  try { BASELINE = JSON.parse(localStorage.getItem("fh6baseline") || "null"); } catch (e) { BASELINE = null; }
  const [w, d, c] = await Promise.all([get("world.json"), get("diag.json"), get("courses.json")]);
  WORLD = w; DIAG = d; COURSES = c;
}

function paintPanel() {
  paintHeader(); paintTrace(); paintBanner(); paintLeft(); paintRight(); paintDock(); paintFooter();
}

/* -------------------------------------------------------------- trace */
// THE SPEED TRACE — the v1 card, ported whole, in a FIXED block: the region is 240 px tall and
// the chart is drawn at its measured pixel size, so nothing in it scales with the window or
// jumps when the content changes. Speed against distance for every lap on record on the course
// under the car. WHICH laps: a preset against the car you are in (all · this class · this car ·
// this build · same hardware under the rim rule · this tune), then the dimension filters built
// from what is on screen, then the lap chips themselves, each a click to hide. When a timed
// event starts on a known course, the class preset selects itself: every trace in the class you
// are racing. Your lap is painted by grip state (or by speed on its own range), the field's
// fastest is green, the rest faint; partial and void laps dashed and struck; turns ticked by
// their own ids; impacts marked; hover reads the point and marks it on the course map. Off a
// known course the block shows the live run, so it is never blank.
const TRACE_GRIP = ["#00d27a", "#4ea3ff", "#f0616d", "#c678dd", "#e3b341"];
const TRACE_WORD = ["within grip", "front slipping", "rear slipping", "all four", "impact"];
const GRAD = ["#2f81f7", "#3fb6c8", "#6fd08c", "#d7d264", "#e8a13c", "#e5414e"];
const TRACE_DIMS = [["class", "class"], ["dt", "drive"], ["container", "tune"], ["solo", "traffic"], ["bid", "build"]];
const PRESETS = [["all", "all"], ["class", "this class"], ["car", "this car"], ["build", "this build"], ["hw", "same hardware"], ["tune", "this tune"]];
let TRACE_F = {};                     // per course: {dim: value}
let TRACE_SEL = {};                   // per course: {preset, hidden: Set, ctx}
let TRACE_MODE = (() => { try { return localStorage.getItem("fh6SegMode") || "grip"; } catch (e) { return "grip"; } })();
let TRACE_ALL = (() => { try { return localStorage.getItem("fh6PaintAll") === "1"; } catch (e) { return false; } })();
let TRACE_KEY = null;
const lapTime = (t) => (t == null ? "—" : (t >= 60 ? Math.floor(t / 60) + ":" + (t % 60).toFixed(2).padStart(5, "0") : t.toFixed(2) + " s"));
const tuneLabel = (c) => { const m = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}$/.exec(String(c || "")); return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(c || "").slice(-6); };
const dimVal = (l, d) => (d === "solo" ? (l.solo == null ? null : (l.solo ? "clean" : "contact")) : (l[d] == null ? null : String(l[d])));
const dimLab = (d, v) => (d === "container" ? tuneLabel(v) : d === "bid" ? String(v).slice(0, 6) : String(v));
const notTimed = (l) => !!(l.void || l.partial || (l.cov != null && l.cov < 0.9));
const lapBuild = (l) => (IDENT && l.container ? IDENT.builds.find((x) => x.c === l.container) : null) || null;
const liveClass = () => (LIVE.frame && LIVE.frame.on && LIVE.frame.cls) || (CUR && CUR.cls) || null;
const curContainer = () => (CUR && CUR.disk && CUR.disk.ts ? "Tuning_" + String(CUR.ordinal).padStart(4, "0") + "_" + CUR.disk.ts : null);

// the preset's test, against the car you are in
function presetTest(k) {
  const cls = liveClass(), ord = CUR && CUR.ordinal, mb = MATCH && MATCH.build, cont = curContainer();
  const twins = new Set(atomicTwins().map((x) => x.c));
  return {
    all: () => true,
    class: (l) => !!cls && l.class === cls,
    car: (l) => ord != null && parseInt(String(l.cid || "").split("|")[0], 10) === ord,
    build: (l) => !!mb && !!mb.hw && (lapBuild(l) || {}).hw === mb.hw,
    hw: (l) => twins.size > 0 && twins.has(l.container),
    tune: (l) => !!cont && l.container === cont,
  }[k] || (() => true);
}
// the selection for this course, created on first sight with the context's own default: a timed
// event on a known course starts with the class you are racing selected, free roam with all
function traceSel(c) {
  const ctx = MODE.game === "event" ? "event" : "free";
  let sel = TRACE_SEL[c.key];
  if (!sel || sel.ctx !== ctx) {
    const cls = liveClass();
    sel = TRACE_SEL[c.key] = { preset: (ctx === "event" && cls) ? "class" : "all", hidden: new Set(), ctx };
  }
  return sel;
}

function paintTrace() {
  const el = $("#trace"); if (!el) return;
  const course = MODE.suggest === "course" && COURSE && COURSE.traces && Object.keys(COURSE.traces).length;
  const key = course ? JSON.stringify(["c", COURSE.key, TRACE_F[COURSE.key], traceSel(COURSE), [...traceSel(COURSE).hidden], TRACE_MODE, TRACE_ALL, CUR && CUR.cid, liveClass(), el.clientWidth])
                     : JSON.stringify(["r", LIVE.run.length >> 3, CUR && CUR.cid, TRACE_MODE, el.clientWidth]);
  if (key === TRACE_KEY && el.firstChild) return;
  TRACE_KEY = key;
  const r = course ? courseTrace(COURSE) : liveRun();
  // shell first, so the chart can be drawn at the pixels the shell leaves it
  el.innerHTML = `<div class="thd">${r.head}</div><div class="tbody"></div><div class="tfoot">${r.foot}</div>`;
  const host = el.querySelector(".tbody");
  const W = Math.max(300, host.clientWidth), H = Math.max(80, host.clientHeight);
  host.innerHTML = r.svg(W, H);
  wireTrace(el);
}
window.addEventListener("resize", () => { TRACE_KEY = null; paintTrace(); });

function chart(W, H, padL, padB, smax, vmax) {
  return { px: (x) => padL + (x / (smax || 1)) * (W - padL - 8), py: (v) => (H - padB) - (v / (vmax || 1)) * (H - padB - 10) };
}
function paintedLine(pts, ch, w, mode) {
  if (!pts.length) return "";
  let sc = null;
  if (mode === "speed") { const vs = pts.map((q) => q[1]); sc = { lo: Math.min(...vs), hi: Math.max(...vs) }; if (sc.hi - sc.lo < 1e-6) sc = null; }
  const keyOf = (q) => (mode === "speed" && sc) ? Math.max(0, Math.min(GRAD.length - 1, Math.floor(((q[1] - sc.lo) / (sc.hi - sc.lo)) * GRAD.length))) : (q[2] | 0);
  const colOf = (k) => (mode === "speed" && sc) ? GRAD[k] : (TRACE_GRIP[k] || TRACE_GRIP[0]);
  const segs = []; let run = [pts[0]], st = keyOf(pts[0]);
  for (let i = 1; i < pts.length; i++) { const k = keyOf(pts[i]); if (k !== st) { run.push(pts[i]); segs.push([st, run]); run = [pts[i]]; st = k; } else run.push(pts[i]); }
  segs.push([st, run]);
  return segs.map(([k, pp]) => `<polyline fill="none" stroke="${colOf(k)}" stroke-width="${(mode === "speed" || k) ? w + 0.6 : w}" stroke-linecap="round" points="${pp.map((q) => ch.px(q[0]).toFixed(1) + "," + ch.py(q[1]).toFixed(1)).join(" ")}"><title>${mode === "speed" ? "speed" : TRACE_WORD[k] || ""}</title></polyline>`).join("");
}
const plainLine = (pts, ch, col, w, op, dashed) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}"${dashed ? ' stroke-dasharray="3 3"' : ""} points="${pts.map((q) => ch.px(q[0]).toFixed(1) + "," + ch.py(q[1]).toFixed(1)).join(" ")}"/>`;
function impactMarks(pts) { const out = []; for (const q of pts) { if ((q[2] | 0) !== 4 || q.length < 5) continue; const l = out[out.length - 1]; if (l && (l[3] - q[3]) ** 2 + (l[4] - q[4]) ** 2 <= 144) continue; out.push(q); } return out; }
function modeControls() {
  return `<span class="segctl"><span class="why">paint</span>${[["grip", "grip", "what the tyres did — the axle that let go, and where"], ["speed", "speed", "how fast, coloured across the lap's own range"]].map(([k, l, tip]) =>
    `<button class="mini ${TRACE_MODE === k ? "on" : ""}" data-tmode="${k}" title="${tip}">${l}</button>`).join("")}
    <button class="mini ${TRACE_ALL ? "on" : ""}" data-tall title="paint every run, not only the foregrounded lap">every run</button></span>`;
}
const axisSvg = (ch, vmax) => [0.5, 1].map((f) => { const v = Math.round(vmax * f / 10) * 10; return `<text x="2" y="${(ch.py(v) + 3).toFixed(1)}" font-size="8" fill="var(--dim)">${v}</text>`; }).join("");
const cursorSvg = (H) => `<g class="cur" style="display:none"><line y1="6" y2="${H - 16}" stroke="var(--ink)" opacity=".6"/><circle r="3.5" fill="var(--ink)"/></g>`;

function courseTrace(c) {
  const byId = {}; (c.laps || []).forEach((l) => (byId[String(l.id)] = l));
  const all = Object.keys(c.traces).map((id) => Object.assign({ id, pts: c.traces[id] }, byId[id] || {})).filter((t) => t.pts && t.pts.length > 2);
  const sel = traceSel(c), tf = TRACE_F[c.key] || {};
  // 1. the preset against the car you are in — every chip carries its count, an empty one is dim
  const presets = PRESETS.map(([k, lab]) => { const n = all.filter(presetTest(k)).length;
    return `<button class="mini ${sel.preset === k ? "on" : ""} ${n ? "" : "dim"}" data-tpre="${k}" ${n ? "" : "disabled"} title="${k === "hw" ? "every build whose 48 non-rim slots match and whose rims share a mass level" : k === "build" ? "this exact hardware hash" : k === "tune" ? "this save file" : k === "class" ? "the class you are in now" : k === "car" ? "this car, any build" : "every lap on record"}">${lab}<span class="cn">${n}</span></button>`; }).join("");
  const stage1 = all.filter(presetTest(sel.preset));
  // 2. the dimension filters, from what stage 1 leaves on screen
  const filt = TRACE_DIMS.map(([d, lab]) => {
    const vals = [...new Set(stage1.map((t) => dimVal(t, d)).filter((v) => v != null))].sort();
    if (vals.length < 2) return "";
    const chip = (v, text) => `<button class="mini ${(tf[d] || "") === (v == null ? "" : v) ? "on" : ""}" data-tfilt="${esc(d)}|${esc(v == null ? "" : v)}">${esc(text)}</button>`;
    return `<span class="fdim"><span class="why">${lab}</span>${chip(null, "all")}${vals.map((v) => chip(v, dimLab(d, v))).join("")}</span>`;
  }).filter(Boolean).join("");
  const stage2 = stage1.filter((t) => TRACE_DIMS.every(([d]) => !tf[d] || dimVal(t, d) === tf[d]));
  // 3. the chips: each lap, a click to hide
  const match = stage2.filter((t) => !sel.hidden.has(String(t.id)));
  const head = `<b>Speed trace</b><span class="why">${esc(c.name || c.key)} · ${match.length} of ${all.length} lap${all.length === 1 ? "" : "s"} on record${MODE.game === "event" ? " · timed event" : ""}</span>
    <span class="fdim"><span class="why">show</span>${presets}</span>${filt}${Object.keys(tf).length || sel.hidden.size ? `<button class="mini" data-tfilt="*|">clear</button>` : ""}<span class="tspacer"></span>${modeControls()}`;
  if (!stage2.length) return { head, foot: `<span class="why">no lap on record matches — widen the preset or clear a filter</span>`, svg: () => `<div class="why tempty">nothing to draw</div>` };
  stage2.sort((a, b) => (a.t || 9e9) - (b.t || 9e9));
  const L = Math.max(c.len || 0, ...stage2.map((t) => t.pts[t.pts.length - 1][0]));
  stage2.forEach((t) => { t._cov = t.cov != null ? t.cov : (L ? t.pts[t.pts.length - 1][0] / L : 1); });
  const best = match.find((t) => !notTimed(t)) || null;
  const mine = match.filter((t) => CUR && t.cid === CUR.cid);
  const cur = mine.find((t) => !notTimed(t)) || mine[0] || null;
  const fore = cur || best || match[0] || null;
  const leg = stage2.slice(0, 12).map((t) => {
    const hid = sel.hidden.has(String(t.id));
    const nt = notTimed(t); const off = best && !nt && t !== best && t.t ? ((t.t / best.t - 1) * 100).toFixed(1) + "% off" : "";
    const col = t.void ? "#e3b341" : (t.partial || t._cov < 0.9) ? "var(--warn)" : t === cur ? "var(--acc2)" : t === best ? "#00d27a" : "var(--line2)";
    const what = t === cur ? "you" : t === best ? "fastest" : "";
    return `<button class="lchip ${hid ? "hid" : ""}" data-thide="${esc(String(t.id))}" style="border-color:${col}" title="${esc((hid ? "hidden — click to show" : "click to hide") + " · " + (t.sid || "") + (t.container ? " · " + t.container : "") + (t.void ? " · time void: contact" : "") + (t.partial ? " · partial lap" : ""))}">${nt ? `<s>${lapTime(t.t)}</s>` : `<b>${lapTime(t.t)}</b>`}${t.partial || t._cov < 0.9 ? ` ${Math.round(t._cov * 100)}%` : ""}${t.class ? " · " + esc(t.class) : ""}${t.dt ? " " + esc(t.dt) : ""}${what ? ` · <b>${what}</b>` : ""}${off ? ` · ${off}` : ""}</button>`; }).join("");
  const foot = `<span class="tread why">hover the trace — it marks that spot on the course map</span><span class="lchips">${leg}</span>`;
  const svg = (W, H) => {
    if (!match.length) return `<div class="why tempty">every matching lap is hidden — click a chip to show it</div>`;
    const smax = L, vmax = Math.max(...match.flatMap((t) => t.pts.map((q) => q[1]))) * 1.06 || 1;
    const ch = chart(W, H, 28, 16, smax, vmax);
    const lines = match.map((t) => t === cur ? "" : (TRACE_ALL ? paintedLine(t.pts, ch, t === best ? 1.4 : 0.9, TRACE_MODE) : plainLine(t.pts, ch, t === best ? "#00d27a" : "var(--dim)", t === best ? 1.8 : 1, t === best ? 0.9 : 0.45, notTimed(t)))).join("")
      + (cur ? paintedLine(cur.pts, ch, 2.4, TRACE_MODE) : "");
    const ticks = (c.turns || []).filter((t) => t.s != null).map((t) => `<line x1="${ch.px(t.s).toFixed(1)}" y1="6" x2="${ch.px(t.s).toFixed(1)}" y2="${H - 16}" stroke="var(--line2)" opacity=".7"/><text x="${ch.px(t.s).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--dim)">${esc(t.id)}</text>`).join("");
    const imp = impactMarks(fore.pts).map((q, i) => `<g><title>impact ${i + 1} at ${Math.round(q[0])} m</title><line x1="${ch.px(q[0]).toFixed(1)}" y1="6" x2="${ch.px(q[0]).toFixed(1)}" y2="${H - 16}" stroke="#e3b341" stroke-dasharray="2 2" opacity=".6"/><circle cx="${ch.px(q[0]).toFixed(1)}" cy="${ch.py(q[1]).toFixed(1)}" r="3" fill="#e3b341"/></g>`).join("");
    const pts = fore.pts.map((q) => [q[0], q[1], q[2], q[3], q[4]]);
    return `<svg class="tsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-smax="${smax}" data-vmax="${vmax}" data-padl="28" data-padb="16" data-w="${W}" data-h="${H}" data-pts="${esc(JSON.stringify(pts))}">${axisSvg(ch, vmax)}${ticks}${lines}${imp}${cursorSvg(H)}</svg>`;
  };
  return { head, foot, svg };
}

function liveRun() {
  const pts = LIVE.run;
  const head = `<b>Speed trace</b><span class="why">live run · the last ${pts.length ? Math.round(pts.length / 10) : 0} s${MODE.suggest === "course" && COURSE ? ` · no lap on record for ${esc(COURSE.name || COURSE.key)} yet — your first full lap becomes one` : MODE.suggest === "course" ? " · course laps appear here once the course is located" : " · laps on record appear here on a known course"}</span><span class="tspacer"></span>${modeControls()}`;
  const foot = `<span class="tread why">hover the trace — it marks that spot on the map</span><span class="lchips">${TRACE_GRIP.map((c, i) => `<span class="lchip" style="border-color:${c}">${TRACE_WORD[i]}</span>`).join("")}</span>`;
  const svg = (W, H) => {
    if (pts.length < 3) return `<div class="why tempty">drive — speed against distance draws here as you go, painted by what the tyres are doing</div>`;
    const smax = pts[pts.length - 1][0] || 1, vmax = Math.max(60, ...pts.map((q) => q[1])) * 1.06;
    const ch = chart(W, H, 28, 16, smax, vmax);
    const km = [...Array(Math.floor(smax / 500)).keys()].map((i) => (i + 1) * 500).map((d) => `<line x1="${ch.px(d).toFixed(1)}" y1="6" x2="${ch.px(d).toFixed(1)}" y2="${H - 16}" stroke="var(--line)" opacity=".6"/><text x="${ch.px(d).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--dim)">${d / 1000} km</text>`).join("");
    return `<svg class="tsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-smax="${smax}" data-vmax="${vmax}" data-padl="28" data-padb="16" data-w="${W}" data-h="${H}" data-pts="${esc(JSON.stringify(pts.map((q) => [q[0], q[1], q[2], q[3], q[4]])))}">${axisSvg(ch, vmax)}${km}${paintedLine(pts, ch, 2.2, TRACE_MODE)}${cursorSvg(H)}</svg>`;
  };
  return { head, foot, svg };
}

function markMapAt(x, z, col) {
  const sv = document.querySelector("#leftBody svg"); if (!sv || x == null) return;
  const ds = sv.dataset; if (ds.s == null) return;
  const s = +ds.s, H = +ds.h, pad = +ds.pad;
  const cx = pad + (x - +ds.x0) * s, cy = H - pad - (z - +ds.z0) * s;
  if (!isFinite(cx) || !isFinite(cy)) return;
  let g = sv.querySelector("#traceMark");
  if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.id = "traceMark"; sv.appendChild(g); }
  g.innerHTML = `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="none" stroke="${col}" stroke-width="2"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="${col}"/>`;
}
function clearMapMark() { const g = document.querySelector("#leftBody svg #traceMark"); if (g) g.innerHTML = ""; }

function wireTrace(el) {
  el.querySelectorAll("[data-tfilt]").forEach((b) => b.onclick = () => {
    const [d, v] = b.dataset.tfilt.split("|"); const k = COURSE && COURSE.key; if (!k) return;
    if (d === "*") { TRACE_F[k] = {}; traceSel(COURSE).hidden = new Set(); }
    else { const f = TRACE_F[k] = TRACE_F[k] || {}; if (v) f[d] = v; else delete f[d]; }
    paintTrace(); });
  el.querySelectorAll("[data-tpre]").forEach((b) => b.onclick = () => { if (!COURSE) return; traceSel(COURSE).preset = b.dataset.tpre; paintTrace(); });
  el.querySelectorAll("[data-thide]").forEach((b) => b.onclick = () => { if (!COURSE) return; const h = traceSel(COURSE).hidden; const id = b.dataset.thide; if (h.has(id)) h.delete(id); else h.add(id); paintTrace(); });
  el.querySelectorAll("[data-tmode]").forEach((b) => b.onclick = () => { TRACE_MODE = b.dataset.tmode; try { localStorage.setItem("fh6SegMode", TRACE_MODE); } catch (e) {} TRACE_KEY = null; paintTrace(); });
  const ta = el.querySelector("[data-tall]"); if (ta) ta.onclick = () => { TRACE_ALL = !TRACE_ALL; try { localStorage.setItem("fh6PaintAll", TRACE_ALL ? "1" : "0"); } catch (e) {} TRACE_KEY = null; paintTrace(); };
  const sv = el.querySelector("svg.tsvg[data-pts]"); if (!sv) return;
  let P = []; try { P = JSON.parse(sv.dataset.pts || "[]"); } catch (e) { P = []; }
  if (!P.length) return;
  const ds = sv.dataset, smax = +ds.smax, vmax = +ds.vmax, padL = +ds.padl, padB = +ds.padb, W = +ds.w, H = +ds.h;
  const cur = sv.querySelector(".cur"), read = el.querySelector(".tread");
  sv.onmousemove = (ev) => {
    const r = sv.getBoundingClientRect(); const vx = ((ev.clientX - r.left) / r.width) * W;
    const sAt = ((vx - padL) / (W - padL - 8)) * smax;
    let bi = 0, bd = Infinity; for (let i = 0; i < P.length; i++) { const d = Math.abs(P[i][0] - sAt); if (d < bd) { bd = d; bi = i; } }
    const q = P[bi]; const col = TRACE_GRIP[q[2] | 0] || TRACE_GRIP[0];
    const px = padL + (q[0] / smax) * (W - padL - 8), py = (H - padB) - (q[1] / vmax) * (H - padB - 10);
    cur.style.display = ""; const ln = cur.querySelector("line"); ln.setAttribute("x1", px); ln.setAttribute("x2", px);
    const c = cur.querySelector("circle"); c.setAttribute("cx", px); c.setAttribute("cy", py); c.setAttribute("fill", col);
    if (read) read.innerHTML = `<b>${Math.round(q[1])} mph</b> at ${Math.round(q[0])} m · <span style="color:${col}">${TRACE_WORD[q[2] | 0] || ""}</span>`;
    if (q.length > 4) markMapAt(q[3], q[4], col);
  };
  sv.onmouseleave = () => { cur.style.display = "none"; if (read) read.textContent = "hover the trace — it marks that spot on the map"; clearMapMark(); };
}

/* --------------------------------------------------------------- dock */
// The live dock — the v1 Lab's bottom strip, ported: value tiles from the frame, and the time
// trace from the daemon's per-second strip (grip state as colour, speed as a line, every
// identified corner marked ▲ and coloured by its balance). One palette, the analyzer's own.
const DGRIP = {
  calm:   { col: "#2a313c", word: "within grip" },
  front:  { col: "#2f81f7", word: "understeer" },
  rear:   { col: "#e5414e", word: "oversteer" },
  both:   { col: "#a371f7", word: "drift / overdriven" },
  impact: { col: "#e3b341", word: "impact / jolt" },
  off:    { col: "#0b0e12", word: "not driving" },
};
const dGripUsi = (u) => (u > 0.15 ? "front" : u < -0.05 ? "rear" : "calm");
let DOCK_SPAN = 600;               // seconds of trace on screen
let DOCK_TILE_T = 0;

function paintDock() {
  const d = $("#dock"); if (!d) return;
  if (!d.querySelector(".dtiles")) {
    d.innerHTML = `<div class="dhd"><span class="livetag" id="dockLive"></span>
        <span class="spans">${[120, 600, 1800].map((x) => `<button class="${DOCK_SPAN === x ? "on" : ""}" data-span="${x}">${x / 60} min</button>`).join("")}</span>
        <span class="why" id="dockNote"></span></div>
      <div class="dtiles" id="dockTiles"></div>
      <div class="dtrace" id="dockTrace"></div>`;
    d.querySelectorAll("[data-span]").forEach((b) => b.onclick = () => {
      DOCK_SPAN = +b.dataset.span; d.querySelectorAll("[data-span]").forEach((x) => x.classList.toggle("on", x === b)); paintDockTrace(); });
  }
  const lv = $("#dockLive");
  if (lv) { lv.className = "livetag " + (LIVE.receiving ? "" : "off"); lv.innerHTML = `<i></i>${LIVE.receiving ? "LIVE" : "OFFLINE"}${LIVE.pps ? ` <span class="mono">${Math.round(LIVE.pps)} pps</span>` : ""}`; }
  paintDockTiles(true); paintDockTrace();
}

function dockTiles(f) {
  if (!f) return `<span class="why">waiting for telemetry…</span>`;
  const g = f.gear === 0 ? "R/N" : f.gear === 11 ? "⇅" : f.gear;
  const t = [[f.mph.toFixed(0), "mph"], [g, "gear"], [f.rpm, "rpm" + (f.maxrpm ? " / " + f.maxrpm : "")],
             [f.lat.toFixed(2), "lat g"], [f.lon.toFixed(2), "long g"], [f.yaw.toFixed(0), "yaw °/s"],
             [f.hp, "hp"], [f.tq, "ft·lb"], [f.boost.toFixed(1), "boost psi"]];
  const bars = [["thr", f.thr / 255, "var(--acc)"], ["brk", f.brk / 255, "var(--bad)"], ["str", (f.steer + 127) / 254, "var(--acc2)"]];
  const susp = (f.susp || []).map((v, i) => `<div title="${["FL", "FR", "RL", "RR"][i]} suspension travel ${(v * 100).toFixed(0)}%"><i style="height:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%;background:${v > 0.95 ? "var(--bad)" : "var(--mag)"}"></i><span>${["FL", "FR", "RL", "RR"][i]}</span></div>`).join("");
  const mode = f.on ? (f.ev ? `EVENT${f.lapn ? " · lap " + f.lapn : ""}${f.rpos ? " · P" + f.rpos : ""}` : "free roam") : "menu";
  const sub = f.on ? `${(f.dist / 1000).toFixed(2)} km${f.lapt ? " · " + f.lapt.toFixed(1) + " s" : ""}` : "not driving";
  return t.map(([v, l]) => `<div class="dt"><b>${v}</b><span>${l}</span></div>`).join("")
    + `<div class="dt bars">${bars.map(([l, p, c]) => `<div><span>${l}</span><i style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(0)}%;background:${c}"></i></div>`).join("")}</div>`
    + `<div class="dt susp">${susp}</div>`
    + `<div class="dt wide"><b>${esc(mode)}</b><span>${esc(sub)}</span></div>`;
}
function paintDockTiles(force) {
  const el = $("#dockTiles"); if (!el) return;
  const now = performance.now(); if (!force && now - DOCK_TILE_T < 100) return;   // 10 Hz is plenty for eyes
  DOCK_TILE_T = now;
  el.innerHTML = dockTiles(LIVE.frame);
}

function stripSVG(strip, corners, span) {
  const s = (strip || []).slice(-span); const n = s.length;
  if (!n) return `<div class="why">waiting for the first second of telemetry…</div>`;
  const W = 900, H = 84, cw = W / n, t0 = s[0].t, t1 = s[n - 1].t;
  const idx = (t) => Math.max(0, Math.min(n - 1, Math.round((t - t0) / Math.max(1, t1 - t0) * (n - 1))));
  const vmax = Math.max(60, ...s.map((x) => x.mph || 0));
  const bars = s.map((x, i) => { const g = DGRIP[x.state] || DGRIP.calm;
    return `<rect x="${(i * cw).toFixed(2)}" y="16" width="${Math.max(cw - 0.3, 0.6).toFixed(2)}" height="40" fill="${g.col}" opacity="${x.state === "off" ? 1 : x.state === "calm" ? .6 : .95}"><title>${x.t}s — ${g.word}${x.mph != null ? ` · ${x.mph} mph · F ${x.f} R ${x.r} · ${x.g} g` : ""}</title></rect>`; }).join("");
  const line = "M" + s.map((x, i) => `${(i * cw + cw / 2).toFixed(1)} ${(56 - 40 * ((x.mph || 0) / vmax)).toFixed(1)}`).join(" L");
  const ticks = s.map((x, i) => x.t % 60 === 0 ? `<text x="${(i * cw).toFixed(1)}" y="78" fill="var(--mut)" font-size="9">${Math.floor(x.t / 60)}:00</text>` : "").join("");
  const marks = (corners || []).filter((c) => !c.drift && c.t0 >= t0 && c.t0 <= t1).map((c) => {
    const x = idx(c.t0) * cw + cw / 2; const g = DGRIP[dGripUsi(c.usi)];
    return `<g><line x1="${x.toFixed(1)}" y1="14" x2="${x.toFixed(1)}" y2="58" stroke="${g.col}" opacity=".45"/>
      <path d="M${(x - 3.2).toFixed(1)} 4 L${(x + 3.2).toFixed(1)} 4 L${x.toFixed(1)} 12 Z" fill="${g.col}"><title>${c.dir === "L" ? "left" : "right"} · ${c.mph_in}→${c.mph_min}→${c.mph_out} mph · ${c.lat_g_peak} g · ${g.word}</title></path></g>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="trace" role="img" aria-label="time trace">${bars}<path d="${line}" fill="none" stroke="#dfe7ef" stroke-width="1.1" opacity=".85"/>${marks}${ticks}</svg>
    <div class="legend">${Object.entries(DGRIP).map(([k, g]) => `<span><i style="background:${g.col}"></i>${g.word}</span>`).join("")}<span><i class="ln"></i>speed</span><span>▲ corner, coloured by balance</span></div>`;
}
function paintDockTrace() {
  const el = $("#dockTrace"); if (!el) return;
  el.innerHTML = stripSVG(LIVE.strip, LIVE.corners, DOCK_SPAN);
  const note = $("#dockNote"); if (note) note.textContent = LIVE.strip.length ? `${Math.round(LIVE.strip.length / 60)} min of history · ${(LIVE.corners || []).length} corners this session` : "";
}

/* ------------------------------------------------------------ header */
let HDR_KEY = null;
function paintChips() {
  const c = $("#hdr .hchips"); if (c) c.innerHTML = liveChip();
}
function paintHeader() {
  const h = $("#hdr"); if (!h) return;
  const st = buildStatus();
  // Rebuild only when the identity or status changed; a frame beat repaints the chips alone.
  // Rebuilding on every frame re-created the livery <img> and re-fetched it 40 times a second.
  const key = JSON.stringify([CUR && CUR.cid, CUR && CUR.disk && CUR.disk.ts, st.key, st.label,
    MATCH && MATCH.build && MATCH.build.c, BASELINE && BASELINE.container, CUR && CUR.pinned]);
  if (key === HDR_KEY && h.querySelector(".hcar")) { paintChips(); return; }
  HDR_KEY = key;
  if (!CUR) {
    h.innerHTML = `<div class="hcar"><div class="thumb none"></div><div><b>waiting for a car</b>
      <div class="why">${esc(MODE.reason)}</div></div></div><div class="hchips">${liveChip()}</div>`;
    return;
  }
  const m = MATCH && MATCH.build;
  const liv = (CUR.liveries || []).find((l) => l.thumb) || null;
  const thumb = liv ? `<img class="thumb" alt="" src="${DAEMON}/livery-thumb?ordinal=${CUR.ordinal}&d=${encodeURIComponent(liv.dir)}">`
                    : `<div class="thumb none">${esc(String(CUR.ordinal))}</div>`;
  const tune = (CUR.disk && CUR.disk.deliverable && CUR.disk.deliverable.name) || (m && m.name) || (CUR.disk ? "unnamed save" : "");
  h.innerHTML = `
    <div class="hcar">${thumb}
      <div>
        <div class="hname"><b>${esc(CUR.name || ("ordinal " + CUR.ordinal))}</b>
          ${clsBadge(CUR.cls)}${CUR.pi ? `<span class="chip">PI ${CUR.pi}</span>` : ""}
          ${CUR.dt ? `<span class="chip">${esc(CUR.dt)}</span>` : ""}${CUR.cyl ? `<span class="chip">${CUR.cyl} cyl</span>` : ""}
          <span class="pill ${st.tone}" title="${esc(st.why)}">${esc(st.label)}</span>
          ${liv ? `<span class="chip m">${esc(liv.name)}</span>` : ""}</div>
        <div class="htune">${tune ? `<span class="tn">${esc(tune)}</span>` : ""}
          ${m && m.kg ? `<span class="chip">${n0(m.kg)} kg · ${n0(m.kg * KG_LB)} lb</span>` : ""}
          ${m && m.gears ? `<span class="chip">${m.gears}-speed</span>` : ""}
          ${st.ambiguous ? '<span class="chip w">one of several saves</span>' : ""}</div>
      </div>
    </div>
    <div class="hact">
      <button class="big" id="btnSheet" ${MATCH && MATCH.build ? "" : "disabled"}>BUILD SHEET ▸</button>
      ${st.key === "ratified" ? `<button class="big go ${BASELINE && BASELINE.container === (st.twin && st.twin.c) ? "on" : ""}" id="btnBase">
          ${BASELINE && BASELINE.container === (st.twin && st.twin.c) ? "✓ TESTING BASELINE" : "SET TESTING BASELINE"}</button>` : ""}
    </div>
    <div class="hchips">${liveChip()}</div>`;
  const bs = $("#btnSheet"); if (bs) bs.onclick = () => openSheet();
  const bb = $("#btnBase"); if (bb) bb.onclick = () => setBaseline(st.twin);
}

function setBaseline(twin) {
  if (!twin) return;
  if (BASELINE && BASELINE.container === twin.c) BASELINE = null;
  else BASELINE = { container: twin.c, hw: twin.hw, su: twin.su, name: twin.name, ordinal: twin.o, set_utc: new Date().toISOString() };
  try { localStorage.setItem("fh6baseline", JSON.stringify(BASELINE)); } catch (e) { /* private */ }
  if (BASELINE) setPin(twin.o, (twin.c || "").split("_").pop());
  paintPanel();
}

/* ------------------------------------------------------------ banner */
function paintBanner() {
  const al = $("#alerts"); if (!al) return;
  const st = buildStatus();
  const q = matchQuality(CUR && CUR.match);
  const parts = [];
  if (CHANGE) parts.push(changeBanner());
  if (CUR && CUR.disk && (q.level === "ambiguous" || q.level === "conflict")) parts.push(savePicker());
  if (st.steps && st.steps.length && !CHANGE) {
    parts.push(`<div class="alert ${st.tone === "bad" ? "bad" : st.tone === "warn" ? "warn" : ""}">
      <b>${esc(st.label)}.</b> ${esc(st.why)}.
      <span class="steps">${st.steps.map((s, i) => `<span class="step"><i>${i + 1}</i>${esc(s)}</span>`).join("")}</span>
      ${st.rebuild ? `<button class="mini go" data-act="rebuild" ${RB.state === "running" || RB.pending ? "disabled" : ""}>${RB.state === "running" || RB.pending ? "importing…" : "IMPORT + REGENERATE"}</button>${RB.error ? `<span class="why" style="color:var(--bad)">${esc(RB.error)}</span>` : ""}` : ""}
      <button class="mini" data-act="dismiss">dismiss</button></div>`);
  }
  al.innerHTML = parts.join("");
  wireBanner(); wirePicker();
}

/* ------------------------------------------------------------- left */
let LEFT_KEY = null;
function paintLeft() {
  const hd = $("#leftHd"), body = $("#leftBody"); if (!body) return;
  const course = MODE.suggest === "course" && COURSE;
  // 169 polylines are not free: rebuild the map only when what it shows changes, and let the
  // live dot ride on the map that is already there.
  const key = JSON.stringify([!!course, course && COURSE.key, WORLD && Object.keys(WORLD.routes).length, SHOW_OFFMAP, MODE.suggest]);
  if (key === LEFT_KEY && body.querySelector("svg")) { addLiveDot(body); return; }
  LEFT_KEY = key;
  if (course) {
    hd.innerHTML = `Course · <span class="why">${esc(COURSE.name || COURSE.key)} · ${n0(COURSE.len)} m · ${(COURSE.turns || []).length} turns</span>`;
    body.innerHTML = ""; body.append(courseMap(COURSE)); addLiveDot(body);
  } else {
    const n = WORLD ? Object.keys(WORLD.routes).length : 0;
    const off = WORLD ? routeSplit().off.length : 0;
    hd.innerHTML = `World · <span class="why">${WORLD ? (n - off) + " routes on the island" + (off ? " · " + off + " off-map" : "") : "loading"} · free roam${MODE.suggest === "course" ? " (course not located)" : ""}</span>`;
    body.innerHTML = worldMapHTML(); addLiveDot(body);
    const t = body.querySelector("[data-offmap]"); if (t) t.onclick = () => { SHOW_OFFMAP = !SHOW_OFFMAP; paintLeft(); };
  }
}

// Two of the game's 169 routes (102 and 103) are complete circuits parked 8–11 km beyond the north
// coast, outside the nav mesh, with road-class 0 in every record — cut or developer circuits, not
// a destination (research 2026-09-03). Fitting the map to them squashed the island into a third
// of the pane. They are drawn only on request, and never enter a road-class or route aggregate.
let SHOW_OFFMAP = false;
function routeSplit() {
  const rs = Object.entries(WORLD.routes).map(([id, r]) => {
    const n = r.pts.length; const cx = r.pts.reduce((m, p) => m + p[0], 0) / n, cz = r.pts.reduce((m, p) => m + p[1], 0) / n;
    return { id, r, cx, cz }; });
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const mx = med(rs.map((x) => x.cx)), mz = med(rs.map((x) => x.cz));
  const on = [], off = [];
  rs.forEach((x) => ((Math.hypot(x.cx - mx, x.cz - mz) > 12000) ? off : on).push(x));
  return { on, off };
}
function worldMapHTML() {
  if (!WORLD || !WORLD.bbox) return `<div class="why">no world data — run build_web.py</div>`;
  const { on, off } = routeSplit();
  const shown = SHOW_OFFMAP ? on.concat(off) : on;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  shown.forEach(({ r }) => r.pts.forEach(([x, z]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }));
  Object.values(WORLD.courses || {}).forEach((c) => (c.path || []).forEach(([x, z]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }));
  if (!isFinite(x0)) [x0, x1, z0, z1] = WORLD.bbox;
  const W = 900, H = 640, pad = 12;
  const s = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((z1 - z0) || 1));
  const px = (x) => pad + (x - x0) * s, pz = (z) => H - pad - (z - z0) * s;
  const line = (pts, col, w, op) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}" stroke-linejoin="round" points="${pts.map(([x, z]) => px(x).toFixed(0) + "," + pz(z).toFixed(0)).join(" ")}"/>`;
  const routes = on.map(({ r }) => line(r.pts, "#3b4a5c", 1.2, 0.9)).join("")
    + (SHOW_OFFMAP ? off.map(({ id, r }) => `<g><title>Route${id} — off-map circuit, outside the nav mesh, unreachable</title>${line(r.pts, "#c678dd", 1.4, 0.9)}</g>`).join("") : "");
  const mine = Object.values(WORLD.courses || {}).filter((c) => c.path && c.path.length > 3)
    .map((c) => line(c.path, "#00d27a", 1.6, 0.85)).join("");
  return `<svg viewBox="0 0 ${W} ${H}" data-x0="${x0}" data-z0="${z0}" data-s="${s}" data-h="${H}" data-pad="${pad}"
      style="background:var(--bg);border-radius:6px;width:100%;height:100%">${routes}${mine}<g id="liveDot"></g></svg>
    <div class="legend"><span><i style="background:#3b4a5c"></i>every game route</span>
      <span><i style="background:#00d27a"></i>roads you have driven</span><span><i style="background:#e3b341"></i>you, now</span>
      ${off.length ? `<button class="mini ${SHOW_OFFMAP ? "on" : ""}" data-offmap title="Routes ${off.map((x) => x.id).join(", ")}: complete circuits parked beyond the north coast, outside the nav mesh — cut or developer content, unreachable">${SHOW_OFFMAP ? "hide" : "show"} off-map (${off.length})</button>` : ""}</div>`;
}

function addLiveDot(body) {
  const svg = body.querySelector("svg"); if (!svg || !LIVEPOS) return;
  let g = svg.querySelector("#liveDot");
  if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.id = "liveDot"; svg.appendChild(g); }
  const x0 = +svg.dataset.x0, z0 = +svg.dataset.z0, s = +svg.dataset.s, H = +svg.dataset.h, pad = +svg.dataset.pad;
  if (!isFinite(s)) return;
  const cx = pad + (LIVEPOS[0] - x0) * s, cy = H - pad - (LIVEPOS[1] - z0) * s;
  g.innerHTML = `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#e3b341" stroke="#000" stroke-width="1"/>`;
}

// which learned course is the live car on? nearest course whose path passes within 60 m
async function locateCourse() {
  if (!LIVEPOS || !WORLD || !WORLD.courses) return;
  let best = null, bd = 60 * 60;
  for (const [key, c] of Object.entries(WORLD.courses)) {
    for (const [x, z] of (c.path || [])) {
      const d = (x - LIVEPOS[0]) ** 2 + (z - LIVEPOS[1]) ** 2;
      if (d < bd) { bd = d; best = key; }
    }
  }
  if (best && best !== COURSE_KEY) {
    COURSE_KEY = best;
    try { COURSE = await get("course/" + best.replace(/\//g, "_") + ".json"); } catch (e) { COURSE = null; }
    paintLeft(); paintRight(); paintFooter();
  }
}

/* ------------------------------------------------------------ right */
// Which pane the context calls for. In a menu the build is what can change, so its data asks and
// ratification steps lead; on the road the corners you are taking lead; on a course with a
// baseline set, the conclusions lead. A click pins a tab until the context class changes.
const RT_LABEL = { corners: "Live corners", stats: "General statistics", concl: "Conclusions", build: "Build data" };
function rightTabs() { return (MODE.suggest === "course" && COURSE) ? ["corners", "stats", "concl"] : ["corners", "stats", "build"]; }
function rightContext() {
  const course = MODE.suggest === "course" && COURSE;
  if (LIVE.inMenu || !LIVE.frame) return course ? "stats" : "build";
  if (course && BASELINE) return "concl";
  return "corners";
}
function paintRight() {
  const hd = $("#rightHd"), body = $("#rightBody"); if (!body) return;
  const ctx = rightContext();
  if (ctx !== RIGHT_CTX) { RIGHT_CTX = ctx; RIGHT_TAB = null; }
  const tabs = rightTabs();
  const cur = tabs.includes(RIGHT_TAB) ? RIGHT_TAB : ctx;
  const why = { corners: "every corner as you take it · newest first", stats: "world-wide · ranked by frequency × impact · free roam needs more samples",
                concl: "this course's turns · what to change", build: "what the save gives, what a drive still has to provide" }[cur];
  hd.innerHTML = `<span class="tabs2">${tabs.map((t) => `<button class="${cur === t ? "on" : ""}" data-rt="${t}">${RT_LABEL[t]}</button>`).join("")}</span><span class="why">${esc(why)}</span>`;
  hd.querySelectorAll("[data-rt]").forEach((b) => b.onclick = () => { RIGHT_TAB = b.dataset.rt; paintRight(); });
  body.innerHTML = cur === "corners" ? cornersHTML() : cur === "concl" ? conclusionsHTML() : cur === "build" ? buildDataHTML() : statsHTML();
  body.querySelectorAll('[data-act="rebuild"]').forEach((b) => b.onclick = () => requestRebuild("manual"));
}

// The corner log: the daemon's live corner events for the car you are in, newest first.
function cornersHTML() {
  const cid = CUR && CUR.cid;
  const log = (LIVE.corners || []).filter((c) => !cid || c.car === cid);
  const f = LIVE.frame || {};
  const inCorner = f.on && Math.abs(f.lat || 0) > 0.4;
  const head = `<div class="frow head"><b>${log.length} corner${log.length === 1 ? "" : "s"} this session</b>
    ${inCorner ? `<span class="chip on">● in a corner now — ${f.lat > 0 ? "right" : "left"}, ${Math.abs(f.lat).toFixed(2)} g</span>` : ""}</div>`;
  if (!log.length) return head + `<div class="why">start driving — each corner appears here the moment you complete it, with its balance verdict</div>`;
  const rows = log.slice(-30).reverse().map((c, i) => {
    const g = DGRIP[dGripUsi(c.usi)]; const fr = c.first_red;
    const kind = c.mph_min < 45 ? "hairpin" : c.mph_min <= 85 ? "medium" : "fast";
    return `<div class="crow"><span class="mono">${log.length - i}</span><span>${c.lapn != null ? "lap " + c.lapn : c.ev ? "" : "free"}</span>
      <b>${c.dir === "L" ? "⬅" : "➡"} ${kind}</b>
      <span class="mono">${c.mph_in}→<b>${c.mph_min}</b>→${c.mph_out ?? "—"}</span>
      <span class="mono">${c.lat_g_peak} g</span>
      <span class="mono">${c.brake_on_m != null ? c.brake_on_m + " m" : "—"}</span>
      <span style="color:${g.col === DGRIP.calm.col ? "var(--acc)" : g.col}">${g.word}</span>
      <span class="why">${fr ? `${fr.axle} first · ph ${fr.phase}` : "clean"}${c.hb ? " · handbrake" : ""}${c.drift ? " · drift" : ""}${c.brake_max > 200 ? " · hard brake" : ""}</span></div>`;
  }).join("");
  return head + `<div class="crow hd"><span>#</span><span>lap</span><b>turn</b><span>in→apex→out</span><span>lat g</span><span>brake</span><span>balance</span><span>first red</span></div>` + rows;
}

// Build data: what the save on disk gives exactly, what the union still has to measure, and the
// steps to ratification — the menu-time pane, because a menu is where the build changes.
function buildDataHTML() {
  const st = buildStatus();
  const dl = CUR && CUR.disk && CUR.disk.deliverable;
  const parts = [];
  if (!CUR) return `<div class="why">${esc(MODE.reason || "waiting for a car")}</div>`;
  if (!dl) parts.push(`<div class="frow"><b>${esc(st.label)}</b> <span class="why">${esc(st.why)}</span></div>`);
  else {
    const sm = dl.summary || {}, u = dl.union || {};
    const chip = (t, cls) => `<span class="chip ${cls}">${t}</span>`;
    parts.push(`<div class="frow head"><b>${esc(CUR.disk.name || "")}</b>${dl.locked ? chip("🔒 downloaded", "w") : chip("self-made", "on")}${dl.gear_count ? chip(dl.gear_count + "-speed", "") : ""}
      ${sm.parts_installed != null ? chip(sm.parts_installed + " parts exact", "on") : ""}
      ${sm.sliders_exact != null ? chip(sm.sliders_exact + " sliders exact" + (sm.sliders_derived ? " · " + sm.sliders_derived + " derived" : "") + (sm.sliders_relative ? " · " + sm.sliders_relative + " from database ranges" : ""), "on") : ""}
      ${u.n_agree ? chip("✓ " + u.n_agree + " corroborated", "on") : ""}${u.n_conflict ? chip("⚠ " + u.n_conflict + " conflict" + (u.n_conflict > 1 ? "s" : ""), "bad") : ""}${u.n_await ? chip("○ " + u.n_await + " awaiting telemetry", "w") : ""}</div>`);
    const asks = u.asks || [];
    if (asks.length) parts.push(`<div class="grp"><div class="gh">Drive to raise confidence</div>${asks.map((a) => `<div class="ask"><span>▸</span><span>${esc(a.text)}</span><span class="gain">${esc(a.gain || "")}</span></div>`).join("")}</div>`);
    else parts.push(`<div class="why">every measurable is captured — the analysis runs on complete data for this build</div>`);
  }
  if (st.steps && st.steps.length) parts.push(`<div class="grp"><div class="gh">To ratification</div><span class="steps">${st.steps.map((x, i) => `<span class="step"><i>${i + 1}</i>${esc(x)}</span>`).join("")}</span></div>`);
  else if (st.key === "ratified") parts.push(`<div class="frow normal"><b>ratified</b> <span class="why">this build carries the history of every atomically-similar build</span></div>`);
  parts.push(`<div class="grp"><div class="gh">Database</div><div class="frow"><button class="mini go" data-act="rebuild" ${RB.state === "running" || RB.pending ? "disabled" : ""}>${RB.state === "running" || RB.pending ? "importing…" : "IMPORT + REGENERATE"}</button>
    <span class="why">${RB.last && RB.last.finished ? `last import ${new Date(RB.last.finished * 1000).toLocaleTimeString()} · ${RB.last.wall_s} s` : "imports every save on disk and rewrites the dashboard data (~10 s); runs by itself when a new save is not yet held"}</span>${RB.error ? `<span class="why" style="color:var(--bad)">${esc(RB.error)}</span>` : ""}</div></div>`);
  return parts.join("");
}

// What this build keeps doing wrong, wherever it happens. Filtered to atomically-similar builds:
// same hardware fingerprint under the rim rule, which is what makes history transferable.
function statsHTML() {
  if (!DIAG) return `<div class="why">loading</div>`;
  const conts = new Set(atomicTwins().map((b) => b.c));
  const rows = DIAG.by_setup.filter((r) => conts.has(r.container));
  if (!rows.length) return `<div class="why">no failure statistics for this build yet — drive, and the detectors fill this in</div>`;
  const agg = {};
  rows.forEach((r) => { const a = agg[r.symptom] = agg[r.symptom] || { ...r, occurrences: 0, laps_affected: 0, turns_affected: 0 };
    a.occurrences += r.occurrences; a.laps_affected += r.laps_affected; a.turns_affected = Math.max(a.turns_affected, r.turns_affected || 0); });
  const list = Object.values(agg).sort((a, b) => b.occurrences * (b.mean_severity || 0.5) - a.occurrences * (a.mean_severity || 0.5));
  const need = MODE.suggest === "course" ? 5 : 20;    // provisional sample thresholds, see docs §5
  return `<div class="grp">${list.map((r) => {
    const normal = /Bottoming/.test(r.symptom) && r.laps_affected && r.occurrences / r.laps_affected < 3;
    const weak = r.laps_affected < need;
    return `<div class="frow ${normal ? "normal" : ""} ${weak ? "weak" : ""}">
      <div class="fl"><b>${esc(r.symptom)}</b><span class="why">${esc(r.phase || "")} · ${r.occurrences} incidents · ${r.laps_affected} laps · ${r.turns_affected} turns</span></div>
      <div class="fr">${normal ? '<span class="chip on">within normal operation</span>' : weak ? `<span class="chip w">${r.laps_affected}/${need} laps — need more</span>` : `<span class="chip b">${esc(r.primary_fix || "")}</span>`}</div></div>`;
  }).join("")}</div>`;
}

// Course conclusions: the corners on THIS route ranked by what went wrong there, geometry beside.
function conclusionsHTML() {
  if (!DIAG || !COURSE) return `<div class="why">no course</div>`;
  const rows = DIAG.by_turn.filter((r) => r.route_key === COURSE.key).sort((a, b) => b.occurrences - a.occurrences).slice(0, 14);
  if (!rows.length) return `<div class="why">no failures placed on this course's turns yet</div>`;
  return `<div class="grp">${rows.map((r) => `<div class="frow">
    <div class="fl"><b>${esc(r.turn_id)} <span class="dim">${esc(r.kind || "")}</span></b>
      <span class="why">${r.radius_m ? n0(r.radius_m) + " m radius" : ""}${r.width_m ? " · " + n1(r.width_m) + " m wide" : ""}${r.bank_deg != null ? " · " + n1(r.bank_deg) + "° bank" : ""}</span>
      <span class="why">${esc(r.symptom)} · ${r.occurrences} on ${r.laps_affected} laps</span></div>
    <div class="fr"><span class="chip b">${esc(r.primary_fix || "")}</span></div></div>`).join("")}</div>`;
}

/* ------------------------------------------------------------ footer */
function paintFooter() {
  const f = $("#ftr"); if (!f) return;
  const st = buildStatus();
  let cov = "";
  if (BASELINE) {
    const rows = (DIAG ? DIAG.by_setup.filter((r) => r.container === BASELINE.container) : []);
    const laps = rows.reduce((m, r) => Math.max(m, r.laps_affected || 0), 0);
    const need = MODE.suggest === "course" ? 5 : 20;
    const pct = Math.min(100, Math.round(100 * laps / need));
    cov = `<span class="cov"><span class="why">coverage</span><span class="bar"><i style="width:${pct}%"></i></span>
      <span class="mono">${laps}/${need} laps</span>${laps < need ? '<span class="chip w">not yet outlier-proof</span>' : '<span class="chip on">baseline ready</span>'}</span>`;
  }
  f.innerHTML = `<span class="chip ${MODE.suggest === "course" ? "on" : ""}">mode · ${esc(MODE.suggest)}</span>
    <span class="why">${esc(MODE.reason || "")}</span>
    <span class="chip">baseline · ${BASELINE ? esc(BASELINE.name || BASELINE.container) : "none"}</span>
    ${cov}
    <span class="why" style="margin-left:auto">status · ${esc(st.label)}</span>`;
}

/* ------------------------------------------------------- the rim rule */
// Atomic twins: builds whose 48 non-rim slots are identical and whose rims share a mass level.
function atomicTwins() {
  if (!IDENT || !MATCH || !MATCH.pk) return [];
  const mine = IDENT.builds.find((b) => b.pkey === MATCH.pk);
  const key = rimFreeKey(MATCH.pk, mine ? mine.rim_ml : null);
  return IDENT.builds.filter((b) => b.o === CUR.ordinal && rimFreeKey(b.pkey, b.rim_ml) === key);
}
function rimFreeKey(pkey, rimMl) {
  const slots = IDENT.slots, parts = pkey.split(",");
  const out = parts.map((p, i) => (slots[i] === "rim_style" || slots[i] === "rear_rim_style") ? "R" : p);
  return out.join(",") + "|" + ((rimMl || []).join("/"));
}

/* ------------------------------------------------- the floating sheet */
// The v1 decode float pattern: an in-page panel, draggable by its bar, pin / minimise / close,
// position remembered. Never window.open — the game's overlay and the browser both block it.
function openSheet() {
  if (!MATCH || !MATCH.sheet) return;
  let el = document.getElementById("fhSheet");
  if (!el) {
    el = document.createElement("div"); el.id = "fhSheet"; el.className = "fsheet";
    document.body.appendChild(el);
  }
  const dl = (CUR && CUR.disk && CUR.disk.deliverable) || null;
  const name = (MATCH.build && MATCH.build.name) || (CUR && CUR.disk && CUR.disk.name) || "";
  const key = (MATCH.sheet.hw || "") + "|" + ((CUR && CUR.disk && CUR.disk.ts) || "") + "|" + (dl ? 1 : 0);
  if (el.dataset.k === key && el.querySelector(".fbody")) { el.style.display = "block"; return; }   // same build, same save: just show it
  el.dataset.k = key;
  const st = (() => { try { return JSON.parse(localStorage.getItem("fh6sheet") || "{}"); } catch (e) { return {}; } })();
  if (st.x != null) { el.style.left = st.x + "px"; el.style.top = st.y + "px"; }
  el.classList.toggle("min", !!st.min);
  el.innerHTML = `<div class="fbar" id="fbar"><span class="ttl">BUILD SHEET</span>
      <span class="nm">${esc(MATCH.sheet.car || "")}${name ? " · " + esc(name) : ""}</span>
      <button data-f="min" title="${st.min ? "expand" : "minimise"}">${st.min ? "▢" : "—"}</button>
      <button data-f="close" title="close">✕</button></div>
    <div class="fbody fhcl"><style>${scopedCloneCss()}</style>${cloneHTML(MATCH.sheet, dl, name)}</div>`;
  el.style.display = "block";
  wireClone({ document: el, localStorage: window.localStorage }, MATCH.sheet);
  el.querySelector('[data-f="close"]').onclick = () => { el.style.display = "none"; };
  el.querySelector('[data-f="min"]').onclick = () => { st.min = !st.min; el.classList.toggle("min", st.min); save();
    const bt = el.querySelector('[data-f="min"]'); bt.textContent = st.min ? "▢" : "—"; bt.title = st.min ? "expand" : "minimise"; };
  const save = () => { try { localStorage.setItem("fh6sheet", JSON.stringify(st)); } catch (e) { /* private */ } };
  // drag by the bar
  const bar = el.querySelector("#fbar");
  bar.onpointerdown = (e) => {
    if (e.target.tagName === "BUTTON") return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    const mv = (ev) => { el.style.left = Math.max(0, ev.clientX - sx) + "px"; el.style.top = Math.max(0, ev.clientY - sy) + "px"; };
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      st.x = el.offsetLeft; st.y = el.offsetTop; save(); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
}
