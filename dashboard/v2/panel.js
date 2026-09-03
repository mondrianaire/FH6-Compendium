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
let RIGHT_TAB = "stats";
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
    <div class="ftr" id="ftr"></div>`;
}

async function panelBoot() {
  try { BASELINE = JSON.parse(localStorage.getItem("fh6baseline") || "null"); } catch (e) { BASELINE = null; }
  const [w, d, c] = await Promise.all([get("world.json"), get("diag.json"), get("courses.json")]);
  WORLD = w; DIAG = d; COURSES = c;
}

function paintPanel() {
  paintHeader(); paintBanner(); paintLeft(); paintRight(); paintFooter();
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
function paintLeft() {
  const hd = $("#leftHd"), body = $("#leftBody"); if (!body) return;
  if (MODE.suggest === "course" && COURSE) {
    hd.innerHTML = `Course · <span class="why">${esc(COURSE.name || COURSE.key)} · ${n0(COURSE.len)} m · ${(COURSE.turns || []).length} turns</span>`;
    body.innerHTML = ""; body.append(courseMap(COURSE)); addLiveDot(body);
  } else {
    hd.innerHTML = `World · <span class="why">${WORLD ? Object.keys(WORLD.routes).length + " routes" : "loading"} · free roam${MODE.suggest === "course" ? " (course not located)" : ""}</span>`;
    body.innerHTML = worldMapHTML(); addLiveDot(body);
  }
}

function worldMapHTML() {
  if (!WORLD || !WORLD.bbox) return `<div class="why">no world data — run build_web.py</div>`;
  const [x0, x1, z0, z1] = WORLD.bbox;
  const W = 900, H = 640, pad = 12;
  const s = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((z1 - z0) || 1));
  const px = (x) => pad + (x - x0) * s, pz = (z) => H - pad - (z - z0) * s;
  const line = (pts, col, w, op) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}" stroke-linejoin="round" points="${pts.map(([x, z]) => px(x).toFixed(0) + "," + pz(z).toFixed(0)).join(" ")}"/>`;
  const routes = Object.values(WORLD.routes).map((r) => line(r.pts, "#3b4a5c", 1.2, 0.9)).join("");
  const mine = Object.values(WORLD.courses || {}).filter((c) => c.path && c.path.length > 3)
    .map((c) => line(c.path, "#00d27a", 1.6, 0.85)).join("");
  return `<svg viewBox="0 0 ${W} ${H}" data-x0="${x0}" data-z0="${z0}" data-s="${s}" data-h="${H}" data-pad="${pad}"
      style="background:var(--bg);border-radius:6px;width:100%;height:100%">${routes}${mine}<g id="liveDot"></g></svg>
    <div class="legend"><span><i style="background:#3b4a5c"></i>every game route</span>
      <span><i style="background:#00d27a"></i>roads you have driven</span><span><i style="background:#e3b341"></i>you, now</span></div>`;
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
function paintRight() {
  const hd = $("#rightHd"), body = $("#rightBody"); if (!body) return;
  const course = MODE.suggest === "course" && COURSE;
  hd.innerHTML = course
    ? `<span class="tabs2"><button class="${RIGHT_TAB === "stats" ? "on" : ""}" data-rt="stats">General statistics</button>
        <button class="${RIGHT_TAB === "concl" ? "on" : ""}" data-rt="concl">Conclusions</button></span>`
    : `General statistics <span class="why">world-wide · ranked by frequency × impact · free roam needs more samples</span>`;
  hd.querySelectorAll("[data-rt]").forEach((b) => b.onclick = () => { RIGHT_TAB = b.dataset.rt; paintRight(); });
  body.innerHTML = (course && RIGHT_TAB === "concl") ? conclusionsHTML() : statsHTML();
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
