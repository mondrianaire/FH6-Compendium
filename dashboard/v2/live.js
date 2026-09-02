/* live.js — the Dashboard tab: identify the car in front of you, then hand you its build.
 *
 * NOT a scrolling page. One fixed-height grid; every pane fills and changes contextually as the
 * identification advances. There is no "course / decode / free tuning" mode switch — what you see
 * IS the current stage.
 *
 * The workflow it walks:
 *   1  CAR        the daemon reports the live car (ordinal, drivetrain, cylinders, PI) and its livery
 *   2  HARDWARE   the car's 50 decoded part ids are joined in slot order and matched, exactly,
 *                 against every build we hold. A match is a fingerprint, not a guess.
 *   3  TUNE       the 36 slider values are matched the same way
 *   green light = car + hardware + tune all matched -> the clone stage can begin, because we can
 *   now state every upgrade and every slider with full fidelity.
 *
 * Identification does not depend on the car being driven: it reads the SAVE. Telemetry only tells
 * us which car is in front of you.
 */
"use strict";

const DAEMON = "http://127.0.0.1:8765";
let IDENT = null, LIVE = { cars: [], receiving: false, pps: 0 }, ES = null;
let CUR = null;          // { ordinal, cid, name, ... }
let MATCH = null;        // { build, hw, tune } after identification
let POP = null;

function pkeyOf(parts, slots) {
  return slots.map((s) => { const v = parts[s]; return (v == null) ? "-" : String(v); }).join(",");
}
function skeyOf(sliders, order) {
  return order.map((s) => {
    const e = sliders && sliders[s];
    const n = e && (typeof e === "object" ? e.norm : e);
    return (n == null) ? "-" : (+n).toFixed(4);
  }).join(",");
}

async function viewLive(host) {
  document.body.classList.add("fixed");
  host.classList.add("live");
  host.innerHTML = `
    <div class="idbar" id="idbar"></div>
    <div class="stages" id="stages"></div>
    <div class="panes">
      <section class="pane" id="pHw"><header>Hardware<span class="why" id="hwn"></span>
        <button class="popbtn" id="popHw" title="pop out beside the game">pop out</button></header>
        <div class="body" id="hwBody"></div></section>
      <section class="pane" id="pTune"><header>Tuning<span class="why" id="tunen"></span>
        <button class="popbtn" id="popTune" title="pop out beside the game">pop out</button></header>
        <div class="body" id="tuneBody"></div></section>
    </div>`;
  $("#popHw").onclick = () => popOut("hw");
  $("#popTune").onclick = () => popOut("tune");

  if (!IDENT) IDENT = await get("identity.json");
  paintBar(); paintStages();
  connect();
}

function connect() {
  if (ES) return;
  try {
    ES = new EventSource(DAEMON + "/events");
    ES.addEventListener("snapshot", (e) => onLive(JSON.parse(e.data)));
    ES.addEventListener("status", (e) => onLive(JSON.parse(e.data)));
    ES.onerror = () => { LIVE.receiving = false; paintBar(); };
  } catch (err) { LIVE.err = String(err); paintBar(); }
}

function onLive(d) {
  if (d.cars) LIVE.cars = d.cars;
  if (d.pps != null) LIVE.pps = d.pps;
  if (d.receiving != null) LIVE.receiving = d.receiving;
  const cars = LIVE.cars || [];
  // the live car is the one the game is currently feeding; fall back to the most recently seen
  const pick = cars.filter((c) => c && c.id).sort((a, b) => (b.live_s || 0) - (a.live_s || 0))[0];
  if (pick && (!CUR || CUR.cid !== pick.id)) identify(pick);
  else paintBar();
}

async function identify(car) {
  const ordinal = car.ordinal != null ? car.ordinal : parseInt(String(car.id).split("|")[0], 10);
  CUR = { cid: car.id, ordinal, name: car.name, cls: car.class, pi: car.pi,
          dt: car.drivetrain, cyl: car.cyl, build_id: car.build_id, live_s: car.live_s };
  MATCH = null; paintBar(); paintStages();

  // the SAVE is what identifies a build; telemetry only says which car is in front of us
  let dt = null;
  try {
    const r = await fetch(DAEMON + "/disk-tune?ordinal=" + ordinal);
    if (r.ok) dt = await r.json();
  } catch (e) { /* daemon down: the car stage still stands on its own */ }
  CUR.disk = dt && dt.available ? dt : null;

  try {
    const lv = await fetch(DAEMON + "/liveries?ordinal=" + ordinal);
    if (lv.ok) { const j = await lv.json(); CUR.liveries = (j.liveries || j.designs || []).slice(0, 6); }
  } catch (e) { /* liveries are a nicety, not a gate */ }

  if (CUR.disk && CUR.disk.tune) {
    const pk = pkeyOf(CUR.disk.tune.parts || {}, IDENT.slots);
    const sk = skeyOf(CUR.disk.tune.sliders || {}, IDENT.sliders);
    const sameCar = IDENT.builds.filter((b) => b.o === ordinal);
    const hw = sameCar.filter((b) => b.pkey === pk);
    const exact = hw.filter((b) => b.skey === sk);
    MATCH = { pk, sk, hw, exact, build: (exact[0] || hw[0] || null) };
    if (MATCH.build) loadBuild(MATCH.build.hw);
  }
  paintBar(); paintStages();
}

async function loadBuild(hw) {
  try {
    const b = await get("build/" + hw + ".json");
    MATCH.sheet = b;
    paintHardware(b); paintTune(b);
  } catch (e) { $("#hwBody").innerHTML = `<div class="why">could not load build ${esc(hw)}</div>`; }
}

/* ------------------------------------------------------------------ bar */
function paintBar() {
  const b = $("#idbar"); if (!b) return;
  if (!CUR) {
    b.innerHTML = `<div class="idcar"><b>waiting for a car</b>
      <span class="why">start driving, or open a car in the game — the daemon reports it here</span></div>
      <div class="idnums">${liveChip()}</div>`;
    return;
  }
  const m = MATCH && MATCH.build;
  b.innerHTML = `
    <div class="idcar">
      <b>${esc(CUR.name || ("ordinal " + CUR.ordinal))}</b>
      <span class="chips">
        ${clsBadge(CUR.cls)}${CUR.pi ? `<span class="chip">PI ${CUR.pi}</span>` : ""}
        ${CUR.dt ? `<span class="chip">${esc(CUR.dt)}</span>` : ""}
        ${CUR.cyl ? `<span class="chip">${CUR.cyl} cyl</span>` : ""}
        <span class="chip mono">${esc(CUR.cid || "")}</span>
        ${m && m.kg ? `<span class="chip">${n0(m.kg)} kg · ${n0(m.kg * KG_LB)} lb</span>` : ""}
        ${m && m.front ? `<span class="chip">${n1(m.front)}% front</span>` : ""}
        ${m && m.gears ? `<span class="chip">${m.gears}-speed</span>` : ""}
      </span>
    </div>
    <div class="idnums">${liveChip()}</div>`;
}
function liveChip() {
  return `<span class="chip ${LIVE.receiving ? "on" : "r"}">${LIVE.receiving ? "telemetry live" : "no packets"}</span>
    <span class="chip mono">${n1(LIVE.pps)} pps</span>
    <span class="chip ${CUR && CUR.disk ? "on" : "w"}">${CUR && CUR.disk ? "save read" : "no save"}</span>`;
}

/* --------------------------------------------------------------- stages */
function paintStages() {
  const s = $("#stages"); if (!s) return;
  const carOk = !!CUR;
  const hwOk = !!(MATCH && MATCH.hw && MATCH.hw.length);
  const tuneOk = !!(MATCH && MATCH.exact && MATCH.exact.length);
  const green = carOk && hwOk && tuneOk;
  const stage = (on, n, title, sub) => `<div class="stage ${on === true ? "ok" : on === false ? "no" : "wait"}">
      <div class="dot">${on === true ? "✓" : n}</div>
      <div><div class="t">${title}</div><div class="s">${sub}</div></div></div>`;

  const d = CUR && CUR.disk;
  s.innerHTML =
    stage(carOk, 1, "Car identified", carOk
      ? esc(CUR.name || CUR.ordinal) + (CUR.liveries && CUR.liveries.length ? ` · ${CUR.liveries.length} liveries on file` : "")
      : "waiting for the game") +
    stage(hwOk ? true : (d ? false : null), 2, "Hardware profile", hwOk
      ? `matches ${MATCH.hw.length} saved build${MATCH.hw.length > 1 ? "s" : ""} — ${esc(MATCH.hw[0].name || "unnamed")}`
      : d ? "the save on disk matches no build we hold" : "reading the save…") +
    stage(tuneOk ? true : (d ? false : null), 3, "Tuning profile", tuneOk
      ? `exact tune match — ${esc(MATCH.exact[0].name || "unnamed")}`
      : hwOk ? "same hardware, different slider values" : "—") +
    `<div class="stage ${green ? "go" : "wait"}"><div class="dot">${green ? "▶" : "·"}</div>
      <div><div class="t">${green ? "Ready to clone" : "Clone stage locked"}</div>
      <div class="s">${green
        ? "every upgrade and slider below is stated at full fidelity"
        : "identification must complete first"}</div></div></div>`;
}

/* ------------------------------------------------------------- hardware */
// Upgrade Shop order, exactly as the menus are walked. Stock parts are shown greyed rather than
// hidden: on a clone you must SEE that a slot is deliberately stock, not wonder if it was missed.
function hardwareHTML(b, forPop) {
  const parts = (b.parts || []);
  const areas = [];
  parts.forEach((p) => {
    // A slot with no menu area is not walked in the shop (aspiration, the reserved slots).
    // Group them last under an honest heading rather than as a nameless block at the top.
    const a = p.area || "Not bought in a menu";
    let g = areas.find((x) => x.a === a);
    if (!g) areas.push(g = { a, rows: [], last: !p.area });
    g.rows.push(p);
  });
  areas.sort((x, y) => (x.last ? 1 : 0) - (y.last ? 1 : 0));
  // an unfitted slot in a group nobody walks is pure noise
  areas.forEach((g) => { if (g.last) g.rows = g.rows.filter((p) => p.pid != null); });
  const shown = areas.filter((g) => g.rows.length);
  areas.length = 0; areas.push(...shown);
  return areas.map((g) => `<div class="grp"><h4>${esc(g.a)}</h4>
    ${g.rows.map((p) => {
      const stock = p.stock || p.pid == null;
      return `<div class="row ${stock ? "stock" : ""}">
        <span class="slot">${esc(p.slot.replace(/_/g, " "))}</span>
        <span class="nm">${esc(p.name || "—")}</span>
        <span class="tile">${p.tile ? `${p.tile}<span class="dim">/${p.tiles || "?"}</span>` : ""}</span>
        <span class="pid mono dim">${p.pid == null ? "" : p.pid}</span></div>`;
    }).join("")}</div>`).join("");
}
function paintHardware(b) {
  const on = (b.parts || []).filter((p) => p.pid != null && !p.stock).length;
  $("#hwn").textContent = `${on} upgrades · Upgrade Shop order`;
  $("#hwBody").innerHTML = hardwareHTML(b);
  syncPop();
}

/* ---------------------------------------------------------------- tune */
function tuneHTML(b) {
  const t = (b.tunes || []).slice(-1)[0];
  if (!t) return `<div class="why">no tune saved on this hardware</div>`;
  const groups = [];
  (t.sliders || []).forEach((s) => {
    let g = groups.find((x) => x.g === s.grp);
    if (!g) groups.push(g = { g: s.grp, rows: [] });
    g.rows.push(s);
  });
  const gears = (t.gears || []).length
    ? `<div class="grp"><h4>Gearing</h4>${t.gears.map((g, i) =>
      `<div class="row"><span class="slot">${i === 0 ? "final drive" : i + (i === 1 ? "st" : i === 2 ? "nd" : i === 3 ? "rd" : "th")}</span>
       <span class="nm mono">${n2(g)}</span><span class="tile"></span><span class="pid"></span></div>`).join("")}</div>` : "";
  return groups.map((g) => `<div class="grp"><h4>${esc(g.g)}</h4>
    ${g.rows.map((s) => `<div class="row ${s.locked ? "stock" : ""}">
      <span class="slot">${esc(s.label || s.slider)}</span>
      <span class="nm mono">${s.v == null ? "—" : n2(s.v)} <span class="dim">${esc(s.unit || "")}</span></span>
      <span class="tile">${s.deflt ? '<span class="chip w">default</span>' : ""}${s.locked ? '<span class="chip">locked</span>' : ""}</span>
      <span class="pid dim mono">${s.lo == null ? "" : n1(s.lo) + "–" + n1(s.hi)}</span></div>`).join("")}</div>`).join("") + gears;
}
function paintTune(b) {
  const t = (b.tunes || []).slice(-1)[0];
  $("#tunen").textContent = t ? esc(t.name || "unnamed") : "";
  $("#tuneBody").innerHTML = tuneHTML(b);
  syncPop();
}

/* ------------------------------------------------------------- pop out */
function popOut(which) {
  const w = window.open("", "fh6pop_" + which, "width=520,height=880");
  if (!w) return;
  POP = POP || {}; POP[which] = w;
  syncPop();
}
function syncPop() {
  if (!POP || !MATCH || !MATCH.sheet) return;
  Object.entries(POP).forEach(([which, w]) => {
    if (!w || w.closed) return;
    const body = which === "hw" ? hardwareHTML(MATCH.sheet) : tuneHTML(MATCH.sheet);
    const title = which === "hw" ? "Hardware" : "Tuning";
    w.document.title = "FH6 " + title + " — " + (MATCH.sheet.car || "");
    w.document.body.innerHTML =
      `<link rel="stylesheet" href="${location.origin}/v2/styles.css">
       <div class="popwrap"><h3>${esc(title)} · ${esc(MATCH.sheet.car || "")}</h3>
       <div class="live"><div class="pane"><div class="body">${body}</div></div></div></div>`;
    w.document.body.className = "pop";
  });
}
