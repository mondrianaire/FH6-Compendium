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
let CHANGE = null;       // what moved since the last read: hardware | tune | saved
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
    <div id="alerts"></div>
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
    // THE FRAME IS THE ONLY THING THAT KNOWS WHICH CAR YOU ARE IN.
    // The `cars` list in snapshot/status is every car SEEN this session, so picking from it by
    // drive time identifies whatever you drove longest and never changes when you switch cars.
    // The frame carries the live cid, so that is what drives identification.
    ES.addEventListener("frame", (e) => onFrame(JSON.parse(e.data)));
    ES.addEventListener("snapshot", (e) => onLive(JSON.parse(e.data)));
    ES.addEventListener("status", (e) => onLive(JSON.parse(e.data)));
    ES.onerror = () => { LIVE.receiving = false; paintBar(); };
  } catch (err) { LIVE.err = String(err); paintBar(); }
}

function onLive(d) {
  if (d.cars) LIVE.cars = d.cars;
  if (d.pps != null) LIVE.pps = d.pps;
  if (d.receiving != null) LIVE.receiving = d.receiving;
  // no frames yet (game at a menu since we connected): fall back to the last car the session saw
  if (!CUR && LIVE.cars.length) {
    const last = LIVE.cars[LIVE.cars.length - 1];
    if (last && last.id) identify(carOf(last.id), "session");
  }
  paintBar();
}

function carOf(cid) {
  const meta = (LIVE.cars || []).find((c) => c && c.id === cid) || {};
  const bits = String(cid).split("|");
  return { id: cid, ordinal: meta.ordinal != null ? meta.ordinal : parseInt(bits[0], 10),
           name: meta.name, class: meta.class, pi: meta.pi != null ? meta.pi : parseInt(bits[3], 10),
           drivetrain: meta.drivetrain, cyl: meta.cyl != null ? meta.cyl : parseInt(bits[2], 10) };
}

// The game reports IsRaceOn = 0 whenever you are in a menu, which is exactly when upgrades and
// sliders get changed. So a menu is not dead time: it is the window in which the build we hold
// can stop being true, and the moment to re-read the save.
let MENU_SINCE = 0, LAST_REREAD = 0, LIVE_PI = null;

function onFrame(f) {
  LIVE.receiving = true;
  const inMenu = !f.on;
  const was = LIVE.inMenu;
  LIVE.inMenu = inMenu;
  LIVE_PI = f.pi;

  if (f.cid && (!CUR || CUR.cid !== f.cid)) { identify(carOf(f.cid), "frame"); return; }

  if (inMenu && !was) MENU_SINCE = Date.now();
  const now = Date.now();
  // While a menu is open, re-read the save on a slow beat; the instant it closes, read once more.
  const dueInMenu = inMenu && now - LAST_REREAD > 4000;
  const leftMenu = !inMenu && was;
  // A live PI that no longer matches the build we matched means the car changed under us and the
  // change has not been saved yet — the strongest signal we get without a new save file.
  const piDrift = MATCH && MATCH.build && LIVE_PI != null && MATCH.build.pi != null
    && LIVE_PI !== MATCH.build.pi;
  if (CUR && (dueInMenu || leftMenu || (piDrift && now - LAST_REREAD > 2500))) {
    LAST_REREAD = now;
    reread();
  }
  paintBar();
}

async function identify(car, why) {
  const ordinal = car.ordinal != null ? car.ordinal : parseInt(String(car.id).split("|")[0], 10);
  CUR = { cid: car.id, ordinal, name: car.name, cls: car.class, pi: car.pi,
          dt: car.drivetrain, cyl: car.cyl, build_id: car.build_id, live_s: car.live_s, why };
  MATCH = null; CHANGE = null; LAST_REREAD = Date.now();
  paintBar(); paintStages();

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

  fingerprint(ordinal);
  paintBar(); paintStages();
}

// One place decides what the save says, so a re-read and a first read can never disagree.
function fingerprint(ordinal) {
  if (!(CUR && CUR.disk && CUR.disk.tune)) { MATCH = null; return; }
  const pk = pkeyOf(CUR.disk.tune.parts || {}, IDENT.slots);
  const sk = skeyOf(CUR.disk.tune.sliders || {}, IDENT.sliders);
  const sameCar = IDENT.builds.filter((b) => b.o === ordinal);
  const hw = sameCar.filter((b) => b.pkey === pk);
  const exact = hw.filter((b) => b.skey === sk);
  const prev = MATCH;
  MATCH = { pk, sk, hw, exact, build: (exact[0] || hw[0] || null) };
  // WHAT CHANGED decides what happens next, and the two cases are not the same thing:
  //   hardware moved -> the game will not have written it yet; it needs a NEW SAVE, with a name,
  //                     before we can hold it at all
  //   sliders moved on the same hardware -> a tuning pass is under way, either following advice
  //                     or your own, and that is exactly what A/B wants to compare
  if (prev && prev.pk) {
    if (prev.pk !== pk) CHANGE = { kind: "hardware", from: prev, to: MATCH, at: Date.now() };
    else if (prev.sk !== sk) CHANGE = { kind: "tune", from: prev, to: MATCH, at: Date.now() };
  }
  if (MATCH.build) loadBuild(MATCH.build.hw);
}

// Re-read the save for the car we are on and re-fingerprint it. Cache-busted on purpose: the
// point of a re-read is to see a file that just changed.
async function reread() {
  if (!CUR) return;
  try {
    const r = await fetch(DAEMON + "/disk-tune?ordinal=" + CUR.ordinal + "&_=" + Date.now());
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.available) return;
    const changedFile = !CUR.disk || CUR.disk.ts !== j.ts;
    CUR.disk = j;
    fingerprint(CUR.ordinal);
    if (changedFile) CHANGE = CHANGE || { kind: "saved", at: Date.now() };
    paintBar(); paintStages();
  } catch (e) { /* daemon busy; the next beat will pick it up */ }
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
  const drift = MATCH && MATCH.build && LIVE_PI != null && MATCH.build.pi != null
    && LIVE_PI !== MATCH.build.pi;
  return `<span class="chip ${LIVE.receiving ? "on" : "r"}">${LIVE.receiving ? "telemetry live" : "no packets"}</span>
    ${LIVE.inMenu ? '<span class="chip w">in a menu — watching for changes</span>' : ""}
    ${drift ? `<span class="chip r">live PI ${LIVE_PI} ≠ saved ${MATCH.build.pi}</span>` : ""}
    <span class="chip mono">${n1(LIVE.pps)} pps</span>
    <span class="chip ${CUR && CUR.disk ? "on" : "w"}">${CUR && CUR.disk ? "save read" : "no save"}</span>`;
}

// The banner is the contextual half of the dashboard: it says what just moved and what that
// means you have to do about it.
function changeBanner() {
  if (!CHANGE) return "";
  const k = CHANGE.kind;
  if (k === "hardware") return `<div class="alert bad"><b>Hardware changed.</b>
    The parts on this car no longer match the build we hold. The game does not write an upgrade
    change to disk until you save the setup, so <b>save the tune and give it a name</b> — until
    then this car cannot be cloned or compared.
    <button class="mini" data-act="dismiss">dismiss</button></div>`;
  if (k === "tune") return `<div class="alert warn"><b>Sliders changed, same hardware.</b>
    A tuning pass on the same package: the two setups are directly comparable, because only the
    sliders differ.
    <button class="mini go" data-act="ab">compare A/B on course</button>
    <button class="mini" data-act="dismiss">dismiss</button></div>`;
  return `<div class="alert"><b>New setup saved.</b> Re-read from disk.
    <button class="mini" data-act="dismiss">dismiss</button></div>`;
}

function wireBanner() {
  document.querySelectorAll("#alerts [data-act]").forEach((b) => b.onclick = () => {
    if (b.dataset.act === "dismiss") { CHANGE = null; paintStages(); }
    else if (b.dataset.act === "ab") abOverlay();
  });
}

/* ------------------------------------------------------------------ A/B */
// Two setups on one hardware package, judged on the course you are actually driving. The lap
// records already carry which setup drove them, so the comparison is measured, not modelled.
async function abOverlay() {
  const a = CHANGE && CHANGE.from && CHANGE.from.build;
  const b = CHANGE && CHANGE.to && CHANGE.to.build;
  document.getElementById("abOv")?.remove();
  const ov = document.createElement("div");
  ov.id = "abOv"; ov.className = "cloneov";
  ov.innerHTML = `<div class="ovbox ab"><button class="ovx" id="abx">✕</button>
    <div class="abhd"><b>A / B</b><span class="why">same hardware, different sliders — only the
      tuning is under test</span></div>
    <div class="abcols" id="abcols">reading laps…</div></div>`;
  document.body.appendChild(ov);
  ov.querySelector("#abx").onclick = () => ov.remove();

  let rows = "";
  try {
    const cs = await get("courses.json");
    const live = cs.filter((c) => c.lap_rows).slice(0, 40);
    rows = `<div class="abtab"><div class="abr hd"><span>setup</span><span>saved</span>
        <span>sliders differing</span></div>
      ${[["A", a], ["B", b]].map(([k, s]) => `<div class="abr"><span><b>${k}</b>
        ${esc((s && s.name) || "unnamed")}</span>
        <span class="mono">${esc(((s && s.saved) || "").replace("T", " ").replace("Z", ""))}</span>
        <span class="mono">${s ? diffCount(a, b) : "—"}</span></div>`).join("")}</div>
      <div class="why" style="margin-top:10px">Drive a lap on each. Laps are stored against the
      setup that drove them, so the course view can rank them without you tagging anything.</div>`;
  } catch (e) { rows = `<div class="why">${esc(e.message)}</div>`; }
  ov.querySelector("#abcols").innerHTML = rows;
}

function diffCount(a, b) {
  if (!a || !b || !a.skey || !b.skey) return "—";
  const x = a.skey.split(","), y = b.skey.split(",");
  let n = 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) n++;
  return n + " of " + x.length;
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
    `<button class="stage act ${green ? "go" : "wait"}" id="goClone" ${green ? "" : "disabled"}>
      <div class="dot">${green ? "▶" : "·"}</div>
      <div><div class="t">${green ? "Ready to clone" : "Clone stage locked"}</div>
      <div class="s">${green
        ? "open the clone sheet — the shop and tuning screens, in order"
        : "identification must complete first"}</div></div></button>`;
  const btn = $("#goClone");
  if (btn && green) btn.onclick = () => cloneWindow();
  const al = $("#alerts");
  if (al) { al.innerHTML = changeBanner(); wireBanner(); }
}

/* --------------------------------------------------------- clone sheet */
// A floating window laid out like the two screens you are about to walk: the Upgrade Shop, one
// category at a time with the tile strip you must land on, and the Tuning screen with its own
// tabs and front/rear columns. Ticking a row remembers itself, so the sheet is a live checklist
// rather than a picture of one.
function cloneWindow() {
  if (!MATCH || !MATCH.sheet) return;
  const b = MATCH.sheet;
  let w = null;
  try { w = window.open("", "fh6clone", "width=980,height=900"); } catch (e) { w = null; }
  if (w && w.document) {
    POP = POP || {}; POP.clone = w;
    const d = w.document;
    d.head.innerHTML = `<title>Clone — ${esc(b.car || "")}</title><style>${CLONE_CSS}</style>`;
    d.body.innerHTML = cloneHTML(b);
    wireClone(w, b);
    return;
  }
  // Popup blocked. The sheet is the point, not the window it lives in: show it as a full-screen
  // overlay with its own pop-out button, so a blocker can never cost you the clone.
  cloneOverlay(b);
}

function cloneOverlay(b) {
  document.getElementById("cloneOv")?.remove();
  const ov = document.createElement("div");
  ov.id = "cloneOv"; ov.className = "cloneov";
  ov.innerHTML = `<style>${CLONE_CSS}</style>
    <div class="ovbox">${cloneHTML(b)}
      <button class="ovx" id="ovx" title="close">✕</button></div>`;
  document.body.appendChild(ov);
  // the overlay borrows the popup's own document API surface
  wireClone({ document: ov, localStorage: window.localStorage }, b);
  ov.querySelector("#ovx").onclick = () => ov.remove();
  document.addEventListener("keydown", function esc2(e) {
    if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", esc2); }
  });
}

function cloneHTML(b) {
  const t = (b.tunes || []).slice(-1)[0] || {};
  const areas = shopAreas(b);
  return `<div class="hd"><div><b>${esc(t.name || "clone")}</b>
      <span class="sub">${esc(b.car || "")}</span></div>
    <div class="tabs"><button class="tb on" data-screen="shop">Upgrade Shop</button>
      <button class="tb" data-screen="tune">Tuning</button></div>
    <div class="prog"><span id="pdone">0</span>/<span id="ptot">0</span> installed</div></div>

  <section class="screen on" id="shop">
    <nav class="cats">${areas.map((g, i) =>
      `<button class="cat ${i ? "" : "on"}" data-cat="${i}">${esc(g.a)}
        <span class="cn">${g.rows.filter((p) => !p.stock && p.pid != null).length}</span></button>`).join("")}</nav>
    <div class="pane">${areas.map((g, i) => `<div class="catbody ${i ? "" : "on"}" data-body="${i}">
      ${g.rows.map((p) => shopRow(p)).join("")}</div>`).join("")}</div>
  </section>

  <section class="screen" id="tune">
    <nav class="cats" id="tcats"></nav>
    <div class="pane" id="tbody"></div>
  </section>`;
}

function shopAreas(b) {
  const areas = [];
  (b.parts || []).forEach((p) => {
    if (!p.area) return;                       // not walked in a menu
    let g = areas.find((x) => x.a === p.area);
    if (!g) areas.push(g = { a: p.area, rows: [] });
    g.rows.push(p);
  });
  return areas;
}

// The tile strip is the whole point: the game does not name the tile you need, it puts it in a
// grid, so the sheet shows the grid with the one you must land on lit.
function shopRow(p) {
  const n = p.tiles || 0, t = p.tile || 0;
  const strip = n && n <= 16
    ? `<span class="strip">${Array.from({ length: n }, (_, i) =>
        `<i class="${i + 1 === t ? "hit" : ""}"></i>`).join("")}</span>`
    : "";
  const stock = p.stock || p.pid == null;
  return `<label class="srow ${stock ? "stock" : ""}" data-pid="${p.pid == null ? "" : p.pid}"
      data-slot="${esc(p.slot)}">
    <input type="checkbox" ${stock ? "disabled" : ""}>
    <span class="slot">${esc(p.slot.replace(/_/g, " "))}</span>
    <span class="nm">${esc(p.name || "—")}</span>
    ${strip}
    <span class="tile">${t ? `${t}<span class="of">/${n}</span>` : ""}</span></label>`;
}

// The Tuning screen pairs front and rear on one row, exactly as the game lays it out.
function tuneScreen(b) {
  const t = (b.tunes || []).slice(-1)[0];
  if (!t) return { tabs: [], bodies: [] };
  const groups = [];
  (t.sliders || []).forEach((s) => {
    let g = groups.find((x) => x.g === s.grp);
    if (!g) groups.push(g = { g: s.grp, rows: [] });
    g.rows.push(s);
  });
  const bodies = groups.map((g) => {
    const pairs = [];
    g.rows.forEach((s) => {
      const m = /^(front|rear)_(.*)$/.exec(s.slider);
      const base = m ? m[2] : s.slider;
      let pr = pairs.find((p) => p.base === base);
      if (!pr) pairs.push(pr = { base, label: (s.label || s.slider).replace(/^(Front|Rear)\s+/, "") });
      if (m) pr[m[1]] = s; else pr.only = s;
    });
    return `<div class="tgrid"><div class="th"></div><div class="th">Front</div><div class="th">Rear</div>
      ${pairs.map((p) => `<div class="tl">${esc(p.label)}</div>
        ${["front", "rear"].map((side) => {
          const s = p[side] || (side === "front" ? p.only : null);
          if (!s) return `<div class="tv dash">—</div>`;
          const pct = Math.max(0, Math.min(100, (s.norm || 0) * 100));
          return `<div class="tv ${s.locked ? "lk" : ""}">
            <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
            <b>${s.v == null ? "—" : n2(s.v)}</b><span class="u">${esc(s.unit || "")}</span>
            ${s.deflt ? '<span class="df">default</span>' : ""}</div>`;
        }).join("")}`).join("")}</div>`;
  });
  const gears = (t.gears || []).length ? `<div class="tgrid one"><div class="th">Gearing</div><div class="th"></div><div class="th"></div>
    ${t.gears.map((g, i) => `<div class="tl">${i === 0 ? "Final Drive" : i + (i === 1 ? "st" : i === 2 ? "nd" : i === 3 ? "rd" : "th")}</div>
      <div class="tv"><b>${n2(g)}</b></div><div class="tv"></div>`).join("")}</div>` : "";
  if (gears) { groups.push({ g: "Gearing", rows: [] }); bodies.push(gears); }
  return { tabs: groups.map((g) => g.g), bodies };
}

function wireClone(w, b) {
  const d = w.document;                       // a real popup document, or the overlay element
  const byId = (id) => (d.getElementById ? d.getElementById(id) : d.querySelector("#" + id));
  const ts = tuneScreen(b);
  byId("tcats").innerHTML = ts.tabs.map((g, i) =>
    `<button class="cat ${i ? "" : "on"}" data-tcat="${i}">${esc(g)}</button>`).join("");
  byId("tbody").innerHTML = ts.bodies.map((h, i) =>
    `<div class="catbody ${i ? "" : "on"}" data-tbody="${i}">${h}</div>`).join("");

  const sel = (root, s) => Array.from(root.querySelectorAll(s));
  sel(d, ".tb").forEach((btn) => btn.onclick = () => {
    sel(d, ".tb").forEach((x) => x.classList.toggle("on", x === btn));
    sel(d, ".screen").forEach((s) => s.classList.toggle("on", s.id === btn.dataset.screen));
  });
  const pick = (attr, bodyAttr) => sel(d, "[" + attr + "]").forEach((btn) => btn.onclick = () => {
    const scope = btn.closest("section");
    sel(scope, "[" + attr + "]").forEach((x) => x.classList.toggle("on", x === btn));
    sel(scope, "[" + bodyAttr + "]").forEach((x) =>
      x.classList.toggle("on", x.getAttribute(bodyAttr) === btn.getAttribute(attr)));
  });
  pick("data-cat", "data-body"); pick("data-tcat", "data-tbody");

  // the checklist remembers itself per build, so closing the window does not lose your place
  const key = "fh6clone:" + (b.hw || "x");
  let done = {};
  const LS = (w && w.localStorage) || window.localStorage;
  try { done = JSON.parse(LS.getItem(key) || "{}"); } catch (e) { done = {}; }
  const boxes = sel(d, ".srow input");
  const tot = boxes.filter((x) => !x.disabled).length;
  byId("ptot").textContent = tot;
  const count = () => {
    const n = boxes.filter((x) => !x.disabled && x.checked).length;
    byId("pdone").textContent = n;
  };
  boxes.forEach((x) => {
    const row = x.closest(".srow"), id = row.dataset.slot;
    if (done[id]) { x.checked = true; row.classList.add("done"); }
    x.onchange = () => {
      row.classList.toggle("done", x.checked);
      done[id] = x.checked;
      try { LS.setItem(key, JSON.stringify(done)); } catch (e) { /* private mode */ }
      count();
    };
  });
  count();
}

const CLONE_CSS = `
:root{--bg:#0b0f14;--pn:#121922;--pn2:#18212c;--ln:#243040;--ink:#e6edf5;--mut:#8a97a8;
 --acc:#00d27a;--acc2:#4ea3ff;--warn:#e3b341;--mono:ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.45 "Inter","Segoe UI",system-ui,sans-serif}
.hd{display:flex;align-items:center;gap:16px;padding:10px 14px;background:var(--pn);
 border-bottom:2px solid var(--acc);position:sticky;top:0;z-index:5}
.hd b{font-size:15px}.hd .sub{color:var(--mut);margin-left:8px;font-size:12px}
.tabs{display:flex;gap:4px;margin-left:auto}
.tb{background:var(--pn2);border:1px solid var(--ln);color:var(--mut);border-radius:5px;
 padding:5px 14px;font:600 12px inherit;cursor:pointer;letter-spacing:.05em;text-transform:uppercase}
.tb.on{background:var(--acc);color:#04140c;border-color:var(--acc)}
.prog{font:12px var(--mono);color:var(--mut);min-width:96px;text-align:right}
.screen{display:none;grid-template-columns:210px 1fr;height:calc(100vh - 49px)}
.screen.on{display:grid}
.cats{background:var(--pn);border-right:1px solid var(--ln);overflow:auto;padding:6px}
.cat{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;
 color:var(--mut);padding:9px 11px;border-radius:6px;font:500 12.5px inherit;cursor:pointer}
.cat:hover{background:var(--pn2);color:var(--ink)}
.cat.on{background:var(--pn2);color:var(--acc);box-shadow:inset 3px 0 0 var(--acc)}
.cn{margin-left:auto;font:11px var(--mono);opacity:.8}
.pane{overflow:auto;padding:10px 12px}
.catbody{display:none}.catbody.on{display:block}
.srow{display:grid;grid-template-columns:20px 128px 1fr auto 52px;gap:10px;align-items:center;
 padding:7px 10px;border-bottom:1px solid var(--ln);cursor:pointer}
.srow:hover{background:var(--pn2)}
.srow.stock{opacity:.4;cursor:default}
.srow.done{background:#0f2a1e55}
.srow.done .nm{text-decoration:line-through;color:var(--mut)}
.srow .slot{color:var(--mut);font-size:11px}
.srow .nm{font-size:13px}
.strip{display:flex;gap:3px}
.strip i{width:13px;height:13px;border:1px solid var(--ln);border-radius:2px;background:var(--pn2)}
.strip i.hit{background:var(--acc);border-color:var(--acc);box-shadow:0 0 0 2px #00d27a33}
.srow .tile{font:12px var(--mono);color:var(--acc);text-align:right}
.srow .of{color:var(--mut)}
.tgrid{display:grid;grid-template-columns:170px 1fr 1fr;gap:6px 14px;align-items:center;
 padding:4px 4px 16px}
.tgrid.one{grid-template-columns:170px 130px 1fr}
.th{color:var(--mut);font:600 10.5px inherit;letter-spacing:.1em;text-transform:uppercase;
 padding:6px 0;border-bottom:1px solid var(--ln)}
.tl{color:var(--mut);font-size:12.5px}
.tv{display:flex;align-items:center;gap:8px;font:13px var(--mono)}
.tv b{min-width:64px;text-align:right;font-weight:600}
.tv .u{color:var(--mut);font-size:11px;min-width:44px}
.tv.dash{color:#3d4a5a}
.tv.lk b{color:var(--mut)}
.bar{position:relative;flex:1;height:8px;background:var(--pn2);border:1px solid var(--ln);border-radius:4px;overflow:hidden}
.bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#0b3a2a,var(--acc))}
.tv.lk .bar i{background:var(--ln)}
.df{color:var(--warn);font:10px inherit;border:1px solid var(--warn);border-radius:9px;padding:0 6px}
`;

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
