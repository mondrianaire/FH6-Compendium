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
    why: "a save exists but our database has not imported it",
    steps: ["run the import (python scripts/db/rebuild.py --only containers)", "then regenerate the dashboard data"] };
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
  paintHeader(); paintBanner(); paintLeft(); paintRight(); paintDock(); paintFooter();
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
          ${liv ? `<span class="chip m">${esc(liv.name)}</span>` : ""}</div>
        <div class="htune">${tune ? `<span class="tn">${esc(tune)}</span>` : ""}
          <span class="pill ${st.tone}" title="${esc(st.why)}">${esc(st.label)}</span>
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
      ${sm.sliders_exact != null ? chip(sm.sliders_exact + " sliders exact" + (sm.sliders_derived ? " · " + sm.sliders_derived + " derived" : "") + (sm.sliders_relative ? " · " + sm.sliders_relative + " by %" : ""), sm.sliders_relative ? "w" : "on") : ""}
      ${u.n_agree ? chip("✓ " + u.n_agree + " corroborated", "on") : ""}${u.n_conflict ? chip("⚠ " + u.n_conflict + " conflict" + (u.n_conflict > 1 ? "s" : ""), "bad") : ""}${u.n_await ? chip("○ " + u.n_await + " awaiting telemetry", "w") : ""}</div>`);
    const asks = u.asks || [];
    if (asks.length) parts.push(`<div class="grp"><div class="gh">Drive to raise confidence</div>${asks.map((a) => `<div class="ask"><span>▸</span><span>${esc(a.text)}</span><span class="gain">${esc(a.gain || "")}</span></div>`).join("")}</div>`);
    else parts.push(`<div class="why">every measurable is captured — the analysis runs on complete data for this build</div>`);
  }
  if (st.steps && st.steps.length) parts.push(`<div class="grp"><div class="gh">To ratification</div><span class="steps">${st.steps.map((x, i) => `<span class="step"><i>${i + 1}</i>${esc(x)}</span>`).join("")}</span></div>`);
  else if (st.key === "ratified") parts.push(`<div class="frow normal"><b>ratified</b> <span class="why">this build carries the history of every atomically-similar build</span></div>`);
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
