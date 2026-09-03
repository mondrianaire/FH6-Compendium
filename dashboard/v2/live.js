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
let IDENT = null, LIVE = { cars: [], receiving: false, pps: 0, strip: [], corners: [], frame: null, run: [], runT: 0 }, ES = null;
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
  panelSkeleton(host);
  if (!IDENT) IDENT = await get("identity.json");
  await panelBoot();
  paintPanel();
  connect();
  connectWatch();
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
    // The dock's time trace and the corner log: one per-second entry, one per corner, and 30
    // minutes of both with the snapshot so a fresh page starts with history, not a blank.
    ES.addEventListener("strip", (e) => { LIVE.strip.push(JSON.parse(e.data)); if (LIVE.strip.length > 1800) LIVE.strip.splice(0, LIVE.strip.length - 1800); paintDockTrace(); });
    ES.addEventListener("corner", (e) => { LIVE.corners.push(JSON.parse(e.data)); if (LIVE.corners.length > 240) LIVE.corners.splice(0, LIVE.corners.length - 240); paintDockTrace(); paintRight(); });
    ES.addEventListener("mode", (e) => { const d = JSON.parse(e.data); MODE = d; paintLeft(); paintRight(); paintFooter(); });
    ES.addEventListener("snapshot", (e) => onLive(JSON.parse(e.data)));
    ES.addEventListener("status", (e) => onLive(JSON.parse(e.data)));
    ES.onerror = () => { LIVE.receiving = false; paintHeader(); };
  } catch (err) { LIVE.err = String(err); paintHeader(); }
}

function onLive(d) {
  if (d.cars) LIVE.cars = d.cars;
  if (Array.isArray(d.strip)) { LIVE.strip = d.strip.slice(-1800); paintDockTrace(); }
  if (Array.isArray(d.corners)) { LIVE.corners = d.corners.slice(-240); }
  if (d.pps != null) LIVE.pps = d.pps;
  if (d.receiving != null) LIVE.receiving = d.receiving;
  if (d.mode && d.mode.suggest) MODE = d.mode;
  // no frames yet (game at a menu since we connected): fall back to the last car the session saw
  if (!CUR && LIVE.cars.length) {
    const real = LIVE.cars.filter((c) => c && c.id && !String(c.id).startsWith("0|"));
    const last = real[real.length - 1];
    if (last && last.id) identify(carOf(last.id), "session");
  }
  paintHeader();
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

let LAST_PANEL = 0;
function onFrame(f) {
  LIVE.receiving = true;
  LIVE.frame = f;
  const inMenu = !f.on;
  const was = LIVE.inMenu;
  LIVE.inMenu = inMenu;
  // A menu frame reports PI 0 and car 0. Zero is "no car", not a PI; letting it through made the
  // drift test read every menu as "the hardware changed", and the status went red in every menu.
  if (f.pi) LIVE_PI = f.pi;
  if (f.px != null && f.pz != null) {
    const moved = !LIVEPOS || Math.abs(LIVEPOS[0] - f.px) + Math.abs(LIVEPOS[1] - f.pz) > 4;
    LIVEPOS = [f.px, f.pz];
    if (moved) { const b = $("#leftBody"); if (b) addLiveDot(b); locateCourse(); }
  }

  // IN A MENU THE FRAME CARRIES CAR 0. That is the game saying "no car", not a car whose ordinal
  // is zero; identifying it produced a header reading "ordinal 0". Keep the last real car through
  // menus -- the menu itself is when its build is most likely to change, and we are watching it.
  const menuFrame = !f.car || String(f.cid || "").startsWith("0|");
  if (!menuFrame && f.cid && (!CUR || CUR.cid !== f.cid)) { identify(carOf(f.cid), "frame"); return; }

  if (inMenu && !was) MENU_SINCE = Date.now();
  const now = Date.now();
  // While a menu is open, re-read the save on a slow beat; the instant it closes, read once more.
  const dueInMenu = inMenu && now - LAST_REREAD > 4000;
  const leftMenu = !inMenu && was;
  // A live PI that no longer matches the build we matched means the car changed under us and the
  // change has not been saved yet — the strongest signal we get without a new save file.
  const piDrift = MATCH && MATCH.build && LIVE_PI && MATCH.build.pi != null
    && LIVE_PI !== MATCH.build.pi;
  if (CUR && (dueInMenu || leftMenu || (piDrift && now - LAST_REREAD > 2500))) {
    LAST_REREAD = now;
    reread();
  }
  // The tiles follow every frame; the panel follows the context — a menu opening or closing
  // changes what the right pane should show — and otherwise a slow heartbeat, not the packet rate.
  paintDockTiles();
  runSample(f, now);
  if (inMenu !== was || now - LAST_PANEL > 2000) { LAST_PANEL = now; paintPanel(); }
}

// THE LIVE RUN: speed against distance for the drive you are on, painted by grip, sampled at
// 10 Hz — the trace region's content whenever no known course is under the car. A run starts
// when the car sets off (or the odometer restarts) and keeps the last 90 seconds.
function runSample(f, now) {
  if (!f.on) { if (LIVE.run.length) { LIVE.run = []; paintTrace(); } return; }
  if (now - LIVE.runT < 100) return;
  LIVE.runT = now;
  const last = LIVE.run[LIVE.run.length - 1];
  if (last && f.dist < last[5]) LIVE.run = [];          // odometer restarted: a new event, a new run
  const sl = f.slip || {};
  const fr = Math.max(Math.abs((sl.FL || [0, 0, 0])[2]), Math.abs((sl.FR || [0, 0, 0])[2]));
  const rr = Math.max(Math.abs((sl.RL || [0, 0, 0])[2]), Math.abs((sl.RR || [0, 0, 0])[2]));
  const g = (Math.abs(f.lat) > 3 || f.smash > 0) ? 4 : (fr > 1 && rr > 1) ? 3 : fr > 1 ? 1 : rr > 1 ? 2 : 0;
  const d0 = LIVE.run.length ? LIVE.run[0][5] : f.dist;
  LIVE.run.push([f.dist - d0, f.mph, g, f.px, f.pz, f.dist]);
  if (LIVE.run.length > 900) { LIVE.run.splice(0, LIVE.run.length - 900); const b = LIVE.run[0][5]; LIVE.run.forEach((q) => { q[0] = q[5] - b; }); }
  if (now - (LIVE.runPaint || 0) > 500) { LIVE.runPaint = now; paintTrace(); }
}

async function identify(car, why) {
  const ordinal = car.ordinal != null ? car.ordinal : parseInt(String(car.id).split("|")[0], 10);
  CUR = { cid: car.id, ordinal, name: car.name, cls: car.class, pi: car.pi,
          dt: car.drivetrain, cyl: car.cyl, build_id: car.build_id, live_s: car.live_s, why };
  MATCH = null; CHANGE = null; LAST_REREAD = Date.now();
  paintPanel();

  // The SAVE identifies a build, but a car has MANY saves and the game never says which one is
  // fitted. The daemon picks one and reports how sure it is; ignoring that turned a guess among
  // six candidates into a green tick. PIN is the user's own answer, and it wins.
  let dt = null;
  const pin = pinnedTs(ordinal);
  try {
    const r = await fetch(DAEMON + "/disk-tune?ordinal=" + ordinal + (pin ? "&ts=" + pin : ""));
    if (r.ok) dt = await r.json();
  } catch (e) { /* daemon down: the car stage still stands on its own */ }
  CUR.disk = dt && dt.available ? dt : null;
  CUR.match = (dt && dt.match) || null;
  CUR.pinned = pin;

  try {
    const lv = await fetch(DAEMON + "/liveries?ordinal=" + ordinal);
    if (lv.ok) { const j = await lv.json(); CUR.liveries = (j.liveries || j.designs || []).slice(0, 6); }
  } catch (e) { /* liveries are a nicety, not a gate */ }

  fingerprint(ordinal);
  ensureHeld();
  paintPanel();
}

function rimFree(pkey) {
  const slots = IDENT.slots;
  return pkey.split(",").map((p, i) => (slots[i] === "rim_style" || slots[i] === "rear_rim_style") ? "R" : p).join(",");
}
function sameLevels(a, b) { return !!(a && b) && String(a[0]) === String(b[0]) && String(a[1]) === String(b[1]); }
let RIM_LEVEL = null;   // wheel id -> mass level, from identity.json's own rows
function rimLevelsOf(parts) {
  if (!RIM_LEVEL) { RIM_LEVEL = {};
    IDENT.builds.forEach((b) => { const ids = b.pkey.split(","); const s = IDENT.slots;
      const f = ids[s.indexOf("rim_style")], r = ids[s.indexOf("rear_rim_style")];
      if (b.rim_ml) { if (f !== "-") RIM_LEVEL[f] = b.rim_ml[0]; if (r !== "-") RIM_LEVEL[r] = b.rim_ml[1]; } }); }
  return [RIM_LEVEL[String(parts.rim_style)], RIM_LEVEL[String(parts.rear_rim_style)]];
}

// One place decides what the save says, so a re-read and a first read can never disagree.
function fingerprint(ordinal) {
  if (!(CUR && CUR.disk && CUR.disk.tune)) { MATCH = null; return; }
  const pk = pkeyOf(CUR.disk.tune.parts || {}, IDENT.slots);
  const sk = skeyOf(CUR.disk.tune.sliders || {}, IDENT.sliders);
  const sameCar = IDENT.builds.filter((b) => b.o === ordinal);
  // THE RIM RULE. Two builds are the same hardware when every slot agrees except the two rim
  // slots, provided the rims share a mass level. Rims differ only by weight class; the game's own
  // wheel table proves the rest is cosmetic. So the fingerprint compares 48 slots plus two levels.
  const liveRims = rimLevelsOf(CUR.disk.tune.parts || {});
  const hw = sameCar.filter((b) => b.pkey === pk || (rimFree(b.pkey) === rimFree(pk) && sameLevels(b.rim_ml, liveRims)));
  const exact = hw.filter((b) => b.skey === sk);
  const prev = MATCH;
  MATCH = { pk, sk, hw, exact, build: (exact[0] || hw[0] || null) };
  // WHAT CHANGED decides what happens next, and the two cases are not the same thing:
  //   hardware moved -> the game will not have written it yet; it needs a NEW SAVE, with a name,
  //                     before we can hold it at all
  //   sliders moved on the same hardware -> a tuning pass is under way, either following advice
  //                     or your own, and that is exactly what A/B wants to compare
  if (prev && prev.pk) {
    // name the difference, slot by slot and slider by slider — a banner that says "hardware
    // changed" and nothing else is the one that reads as "nothing was picked up"
    const pa = prev.pk.split(","), pb = pk.split(",");
    const slots = IDENT.slots.filter((_, i) => pa[i] !== pb[i]).map((s, i) => s);
    const sa = prev.sk.split(","), sb = sk.split(",");
    const prevS = (prev.sliders || {}), curS = CUR.disk.tune.sliders || {};
    const sliders = IDENT.sliders.map((n, i) => ({ n, i })).filter(({ i }) => sa[i] !== sb[i]).map(({ n, i }) => {
      const e = curS[n] || {}, pe = prevS[n] || {};
      const val = (x, norm) => (x && x.value != null) ? (+x.value).toFixed(2) + (x.unit ? " " + x.unit : "") : (norm === "-" ? "—" : Math.round(+norm * 100) + "%");
      return { name: n, a: val(pe, sa[i]), b: val(e, sb[i]) };
    });
    if (prev.pk !== pk) CHANGE = { kind: "hardware", from: prev, to: MATCH, slots, sliders, at: Date.now() };
    else if (prev.sk !== sk) CHANGE = { kind: "tune", from: prev, to: MATCH, slots: [], sliders, at: Date.now() };
  }
  MATCH.sliders = CUR.disk.tune.sliders || {};       // kept so the next fingerprint can print old → new
  if (MATCH.build) loadBuild(MATCH.build.hw);
}

/* ------------------------------------------------------- import + regenerate */
// The database is a snapshot; a new save leaves it behind. The import and the regeneration
// together take ~10 s (measured: 7.8 s + 1.75 s on 578 containers), so they run AUTOMATICALLY
// when a re-read finds a save the database does not hold, and on demand from the button. The
// trigger is a new save file, never a menu return: menus open many times a minute, saves do not.
// The work runs in scripts/rebuild_service.py on its own port so nothing running is restarted.
const REBUILD = "http://127.0.0.1:8001";
let RB = { state: "unknown", why: null, startedAt: 0, last: null, error: null, pending: false, done_ts: null };
let RB_TIMER = null;
async function requestRebuild(why) {
  RB.pending = true; RB.why = why; RB.error = null; paintChips();
  try {
    const r = await fetch(REBUILD + "/rebuild", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ why }) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    RB.state = "running"; RB.startedAt = Date.now(); RB.pending = false; RB.runsAtStart = j.runs;
    if (!RB_TIMER) RB_TIMER = setInterval(pollRebuild, 1000);
  } catch (e) {
    RB.pending = false; RB.state = "down";
    RB.error = "the import service is not running — start it from the worktree: python scripts/rebuild_service.py 8001";
  }
  paintChips(); paintBanner();
}
async function pollRebuild() {
  try {
    const j = await fetch(REBUILD + "/status").then((r) => r.json());
    if (j.state === "running" || j.queued || (RB.runsAtStart != null && j.runs <= RB.runsAtStart)) { RB.state = "running"; paintChips(); return; }
    clearInterval(RB_TIMER); RB_TIMER = null;
    RB.state = "idle"; RB.last = j; RB.runsAtStart = null;
    if (j.rc !== 0) { RB.error = "import failed: " + (j.tail || []).slice(-3).join(" · "); paintChips(); paintBanner(); return; }
    await afterRebuild();
  } catch (e) { clearInterval(RB_TIMER); RB_TIMER = null; RB.state = "down"; RB.error = "lost the import service"; paintChips(); }
}
// the database moved under us: forget every cached api file, re-read identity, re-fingerprint
async function afterRebuild() {
  cache.clear();
  try { IDENT = await get("identity.json"); } catch (e) { /* the next boot reads it */ }
  try { await panelBoot(); } catch (e) { /* world/diag/courses are optional here */ }
  if (CUR) { RB.done_ts = CUR.disk && CUR.disk.ts; fingerprint(CUR.ordinal); }
  paintPanel();
}
// THE RULE: a save the database does not hold can only exist because it was written after the
// last import — a downloaded tune installed, or your own build saved. Either way the answer is
// the same, and it is automatic: import, once per save stamp, at identification and on every
// re-read. done_ts stops a save the import cannot hold from asking again forever.
function ensureHeld() {
  if (!CUR || !CUR.disk || !CUR.disk.ts) return;
  if (MATCH && MATCH.build) return;
  if (RB.state === "running" || RB.pending || RB.done_ts === CUR.disk.ts) return;
  const locked = !!(CUR.disk.deliverable && CUR.disk.deliverable.locked);
  requestRebuild((locked ? "downloaded tune " : "new save ") + CUR.disk.ts);
}
// LIVE RELOAD: the rebuild service watches the dashboard's own files and its data, and tells
// the page. `code` -> reload (the ?v= bump is how a code change is announced); `data` -> drop
// the api cache and re-read identity, world, diagnosis and the car. Nothing here polls.
let WS = null, DATA_AT = 0;
function connectWatch() {
  if (WS) return;
  try {
    WS = new EventSource(REBUILD + "/watch");
    WS.addEventListener("code", (e) => { let f = []; try { f = JSON.parse(e.data).files || []; } catch (x) {}
      console.info("[watch] code changed:", f.join(", "), "— reloading"); setTimeout(() => location.reload(), 300); });
    WS.addEventListener("data", async (e) => {
      if (Date.now() - DATA_AT < 2000) return;         // a finished run and its file write announce once
      DATA_AT = Date.now();
      try { const j = JSON.parse(e.data); if (j.rc != null) RB.last = { finished: Date.now() / 1000, wall_s: j.wall_s, rc: j.rc, tail: [] }; } catch (x) {}
      await afterRebuild();                            // a run started anywhere (a save, the button, a shell) lands here
    });
    WS.onerror = () => { /* the service is down; reconnects by itself */ };
  } catch (e) { WS = null; }
}
// REREAD BUILD: the strongest re-read there is — identify the car again from the live frame
// (roster, match, save, liveries), or, with no live frame, re-read the save of the car held.
let RR = { busy: false, at: null };
async function rereadBuild() {
  if (RR.busy) return;
  RR.busy = true; paintHeader();
  try {
    const f = LIVE.frame;
    const liveCid = f && f.car && !String(f.cid || "").startsWith("0|") ? f.cid : null;
    if (liveCid) await identify(carOf(liveCid), "reread");
    else if (CUR) await reread();
    RR.at = Date.now();
  } finally { RR.busy = false; }
  paintPanel();
}
function rebuildChip() {
  const rr = RR.at ? `<span class="chip" title="last REREAD BUILD">read ${new Date(RR.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>` : "";
  if (RB.pending) return rr + `<span class="chip w">importing…</span>`;
  if (RB.state === "running") return rr + `<span class="chip w">importing · ${Math.round((Date.now() - RB.startedAt) / 1000)} s</span>`;
  if (RB.error) return rr + `<span class="chip r" title="${esc(RB.error)}">import failed</span>`;
  if (RB.last && RB.last.finished) return rr + `<span class="chip on" title="import + regenerate took ${RB.last.wall_s} s">db · ${new Date(RB.last.finished * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;
  return rr;
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
    const prevTs = CUR.disk && CUR.disk.ts;
    const changedFile = !CUR.disk || CUR.disk.ts !== j.ts;
    CUR.disk = j;
    CUR.match = j.match || CUR.match;                 // the roster grows with every save; the picker must see it
    fingerprint(CUR.ordinal);
    if (changedFile) {
      // A NEW FILE IS A SAVE, BY DEFINITION. Whatever the fingerprint found is on disk, so the
      // banner must never ask for a save it is looking at. A new file with nothing different is a
      // re-save (or a downloaded tune identical to the last), and says so.
      if (!CHANGE || CHANGE.saved) CHANGE = { kind: "same", slots: [], sliders: [], at: Date.now() };
      CHANGE.saved = true; CHANGE.ts = j.ts; CHANGE.prevTs = prevTs || null;
      CHANGE.locked = !!(j.deliverable && j.deliverable.locked);
      CHANGE.held = !!(MATCH && MATCH.build);
    }
    ensureHeld();
    paintPanel();
  } catch (e) { /* daemon busy; the next beat will pick it up */ }
}

async function loadBuild(hw) {
  // The sheet feeds the floating BUILD SHEET and the header's mass/gear chips; there are no
  // hardware/tuning panes on the panel any more, so nothing here paints into them.
  try {
    const b = await get("build/" + hw + ".json");
    if (MATCH) MATCH.sheet = b;
    paintPanel();
    const sh = document.getElementById("fhSheet");
    if (sh && sh.style.display !== "none" && typeof openSheet === "function") openSheet();
  } catch (e) { if (MATCH) MATCH.sheet = null; }
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
  return rebuildChip() + liveChip0();
}
function liveChip0() {
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
const tsLocal = (ts) => { const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(ts || "")); if (!m) return String(ts || "");
  const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };
function changeBanner() {
  if (!CHANGE) return "";
  const k = CHANGE.kind;
  if (CHANGE.saved) {
    const when = `<b>New save read${CHANGE.ts ? " · " + tsLocal(CHANGE.ts) : ""}${CHANGE.locked ? " · a downloaded tune (locked)" : ""}.</b>`;
    const slots = (CHANGE.slots || []).map((x) => x.replace(/_/g, " "));
    const sl = (CHANGE.sliders || []);
    const hwTxt = slots.length ? `<b>${slots.length} part${slots.length === 1 ? "" : "s"}</b> differ from the previous save: ${esc(slots.slice(0, 8).join(", "))}${slots.length > 8 ? " +" + (slots.length - 8) : ""}.` : "";
    const slTxt = sl.length ? `<b>${sl.length} slider${sl.length === 1 ? "" : "s"}</b> moved: ${sl.slice(0, 6).map((x) => `${esc(x.name.replace(/_/g, " "))} ${esc(x.a)} → ${esc(x.b)}`).join("; ")}${sl.length > 6 ? " +" + (sl.length - 6) : ""}.` : "";
    const hold = CHANGE.held ? "" : ` <span class="why">Not in the database yet — the import (steps below) holds it${sl.length && !slots.length ? " and makes the pair comparable" : ""}.</span>`;
    if (k === "same") return `<div class="alert">${when} Identical to the previous save — re-saved, nothing moved.${hold}<button class="mini" data-act="dismiss">dismiss</button></div>`;
    if (k === "hardware") return `<div class="alert warn">${when} ${hwTxt} ${slTxt} A hardware change is a new build, not a tuning pass.${hold}<button class="mini" data-act="dismiss">dismiss</button></div>`;
    return `<div class="alert warn">${when} Same hardware. ${slTxt} An A/B pair.${hold}
      ${CHANGE.held ? '<button class="mini go" data-act="ab">compare A/B on course</button>' : ""}<button class="mini" data-act="dismiss">dismiss</button></div>`;
  }
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
    if (b.dataset.act === "dismiss") { CHANGE = null; paintPanel(); }
    else if (b.dataset.act === "ab") abOverlay();
    else if (b.dataset.act === "rebuild") requestRebuild("manual");
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

/* ------------------------------------------------- which save is fitted */
// The live packet carries only ordinal | drivetrain | cylinders | PI. Two builds that agree on
// all four are INDISTINGUISHABLE from telemetry standing still — which is exactly the Exocet
// case: six saved builds, every one of them 4-cylinder. The daemon breaks such ties by watching
// the gearbox (the builds have 6, 8, 9 and 10 gears), but that needs you to drive through them.
// Until then the honest answer is "one of these", not a green tick, and the user can just say.
function pinnedTs(ordinal) {
  try { return JSON.parse(localStorage.getItem("fh6pin") || "{}")[String(ordinal)] || null; }
  catch (e) { return null; }
}
function setPin(ordinal, ts) {
  let m = {};
  try { m = JSON.parse(localStorage.getItem("fh6pin") || "{}"); } catch (e) { m = {}; }
  if (ts) m[String(ordinal)] = String(ts); else delete m[String(ordinal)];
  try { localStorage.setItem("fh6pin", JSON.stringify(m)); } catch (e) { /* private mode */ }
}

// How much the daemon's pick can be trusted, in the daemon's own words.
// The daemon's own standard (_verified_identity): identity is settled when at most one save ties on
// signature, OR the gearbox has broken the tie — the live packet carries only cylinders, drivetrain
// and PI, but the car cannot use a gear it does not have, and one pull through the box yields a
// ratio ladder that the database can check against every build's stored ladder. "held" means the
// identity is carried from an earlier sighting rather than seen now: trusted, but said.
function matchQuality(m) {
  if (!m) return { level: "none", why: "no save read" };
  const ties = m.n_signature_ties || 0, n = m.n_saves || 0;
  const agree = (m.live_cyl == null || m.chosen_cyl == null || m.live_cyl === m.chosen_cyl)
             && (m.live_pi == null || m.chosen_pi == null || m.live_pi === m.chosen_pi);
  if (!agree) return { level: "conflict", why: "the live car reports " + m.live_cyl + " cyl / PI "
    + m.live_pi + " but the chosen save is " + m.chosen_cyl + " cyl / PI " + m.chosen_pi };
  const settled = ties <= 1 || !!m.gear_disambig || !!m.picked_ok;
  if (n > 1 && !settled) {
    return { level: "ambiguous", why: ties + " of " + n + " saved builds tie on cylinders, drivetrain and PI"
      + (m.max_gear_seen ? "; top gear seen so far " + m.max_gear_seen : "; no gear evidence yet")
      + (m.ladder_tied ? "; the ratio ladder is still tied" : "")
      + " — one full pull through the gears settles it" };
  }
  const how = m.gear_disambig ? "settled by the gearbox" + (m.max_gear_seen ? " (top gear seen " + m.max_gear_seen + ")" : "")
            : m.picked_ok ? "your pick, and the live car agrees with it"
            : (m.how || "matched");
  return { level: "ok", why: how + (n > 1 ? " among " + n + " saves" : "")
    + (m.held ? " — identity held from an earlier sighting, not seen fresh" : "")
    + (m.live_recent === false ? " — live data is not recent" : "") };
}

// The picker: every distinct build the daemon can see, what the gearbox has already ruled out, what
// separates the rest, and a click to say which one is on the car. Pure so it can be tested.
function pickerHTML(m, chosen, pinned, q) {
  if (!m || !(m.builds || []).length) return "";
  q = q || matchQuality(m);
  const top = +m.max_gear_seen || 0;
  const rows = (m.builds || []).map((b) => {
    const ts = (b.saves || [])[0] || "";
    const on = String(ts) === String(chosen);
    const isPin = pinned && String(pinned) === String(ts);
    const diffs = (b.diff_vs_A || []);
    const out = top && b.gears && +b.gears < top;         // a box cannot use a gear it does not have
    return `<button class="pick ${on ? "on" : ""} ${isPin ? "pin" : ""} ${out ? "out" : ""}" data-pin="${esc(ts)}"
      ${out ? `title="ruled out: a ${b.gears}-speed cannot reach gear ${top}"` : ""}>
      <b>${esc(b.label || "?")}</b>
      <span class="pm">${b.cyl != null ? b.cyl + " cyl" : ""}${b.pi ? " · PI " + b.pi : ""}${b.gears ? " · " + b.gears + "-speed" : ""}</span>
      <span class="pd">${out ? "ruled out by the gearbox" : diffs.length ? esc(diffs.slice(0, 2).join(", ")) + (diffs.length > 2 ? " +" + (diffs.length - 2) : "") : "the reference build"}</span>
      ${isPin ? '<span class="chip on">pinned</span>' : on ? '<span class="chip">daemon\'s pick</span>' : ""}</button>`;
  }).join("");
  const alive = (m.builds || []).filter((b) => !(top && b.gears && +b.gears < top));
  const boxes = [...new Set(alive.map((b) => +b.gears || 0).filter(Boolean))].sort((x, y) => x - y);
  const twins = boxes.filter((g) => alive.filter((b) => +b.gears === g).length > 1);
  const lead = q.level === "conflict"
    ? `The live car reports <b>${m.live_cyl} cyl / PI ${m.live_pi}</b>; the save on file decodes as <b>${m.chosen_cyl} cyl / PI ${m.chosen_pi}</b>. Either the build changed since that save, or its engine decode is wrong. <b>Save the tune in-game</b> and it is read exactly; or pick a save to keep anyway.`
    : `${m.n_signature_ties || alive.length} builds share this car's cylinders, drivetrain and PI.`
    + (top ? ` Top gear seen so far: <b>${top}</b>${alive.length < (m.builds || []).length ? ` — ${(m.builds || []).length - alive.length} ruled out.` : "."}` : " No gear evidence yet.")
    + (twins.length ? ` ${twins.map((g) => alive.filter((b) => +b.gears === g).map((b) => b.label).join("·")).join(" and ")} share a box, so the count alone cannot separate them; the ratio ladder held in the database can.` : "")
    + ` <b>One full pull through the gears settles it</b>, or pick below and it stays picked.`;
  return `<div class="picker"><div class="why">${lead}
    ${pinned ? '<button class="mini" data-pin="">clear the pin</button>' : ""}</div>
    <div class="picks">${rows}</div></div>`;
}
function savePicker() {
  return pickerHTML(CUR && CUR.match, (CUR && CUR.disk && CUR.disk.ts) || "", CUR && CUR.pinned);
}

function wirePicker() {
  document.querySelectorAll("#alerts [data-pin], #stages [data-pin]").forEach((b) =>
    b.onclick = () => {
      setPin(CUR.ordinal, b.dataset.pin || null);
      const car = { id: CUR.cid, ordinal: CUR.ordinal, name: CUR.name, class: CUR.cls,
                    pi: CUR.pi, drivetrain: CUR.dt, cyl: CUR.cyl };
      identify(car, "pinned");
    });
}

/* --------------------------------------------------------------- stages */
function paintStages_legacy() {
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
    (() => { const q = matchQuality(CUR && CUR.match);
      if (!CUR || !CUR.disk) return "";
      const ok = q.level === "ok";
      return stage(ok ? true : false, "?", ok ? "Save matched" : "Which save?",
        (CUR.pinned ? "pinned by you — " : "") + esc(q.why)); })() +
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
  if (al) {
    const q = matchQuality(CUR && CUR.match);
    const needPick = CUR && CUR.disk && (q.level === "ambiguous" || q.level === "conflict");
    al.innerHTML = changeBanner() + (needPick ? savePicker() : "");
    wireBanner(); wirePicker();
  }
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
  ov.innerHTML = `<style>${scopedCloneCss()}</style>
    <div class="ovbox fhcl">${cloneHTML(b)}
      <button class="ovx" id="ovx" title="close">✕</button></div>`;
  document.body.appendChild(ov);
  // the overlay borrows the popup's own document API surface
  wireClone({ document: ov, localStorage: window.localStorage }, b);
  ov.querySelector("#ovx").onclick = () => ov.remove();
  document.addEventListener("keydown", function esc2(e) {
    if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", esc2); }
  });
}

/* ------------------------------------------------------------- build sheet
   Two in-game screens. The ROWS carry the v1 "TAKE TO GAME" identity — menus in the game's own
   order, named levels with Street/Sport/Race pips, PI chips, engine sub-lines; tuning tabs with
   sections, absolute values + units, a slider track with knob and pole labels — fed by the
   daemon's deliverable, which the panel already fetches with the disk tune. The database adds
   the two things that surface never had: the tile's position in the shop grid, and the
   checklist. With no save on disk there is no deliverable, and the sheet falls back to the
   database's slot walk so it is never blank. */
const areaKey = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
function sameArea(a, b) {
  a = areaKey(a); b = areaKey(b);
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a));
}
const FI_SLOTS = ["single_turbo", "twin_turbo", "quad_turbo", "centrifugal_supercharger", "pos_supercharger"];
// the database part a deliverable row names: same slot name, or one of the two renamed rows.
// The database keeps the installed blower in its own slot and leaves `aspiration` empty, which is
// why the old sheet drew a blank aspiration row while the turbo sat under Engine.
function partFor(b, item) {
  const parts = (b && b.parts) || [];
  if (item === "powertrain") return parts.find((p) => p.slot === "engine") || null;
  if (item === "aspiration") return parts.find((p) => FI_SLOTS.includes(p.slot) && p.pid != null && !p.stock)
    || parts.find((p) => p.slot === "aspiration") || null;
  return parts.find((p) => p.slot === item) || null;
}
function pips(up) {
  const l = /^Race/.test(up || "") ? 3 : /^Sport/.test(up || "") ? 2 : /^Street/.test(up || "") ? 1 : 0;
  return l ? `<span class="pips">${[0, 1, 2].map((i) => `<i class="${i < l ? "on" : ""}"></i>`).join("")}</span>` : "<span></span>";
}
// The tile strip is the database's contribution: the game does not name the tile you need, it
// puts it in a grid, so the row shows the grid with the one you must land on lit.
function tileStrip(p) {
  const n = (p && p.tiles) || 0, t = (p && p.tile) || 0;
  if (!n || n > 16) return `<span></span><span class="tile"></span>`;
  return `<span class="strip" title="tile ${t} of ${n} in the game's grid">${Array.from({ length: n }, (_, i) =>
      `<i class="${i + 1 === t ? "hit" : ""}"></i>`).join("")}</span>
    <span class="tile">${t ? `${t}<span class="of">/${n}</span>` : ""}</span>`;
}
// PROVEN NAMES FIRST (v1, 5c0a37c). The database holds the game's own name for the exact part id
// in the save — "Racing 7.2L V8" — while the daemon's text is a catalog guess built from telemetry
// ("1993 Porsche 911 Turbo S engine swap · 8-cyl"). The database name leads; the daemon's measured
// line (cylinders, hp @ rpm) stays as the sub-line, because that part IS measured.
function partRow(it, p) {
  const stock = !!it.stock;
  const proven = !!(p && p.pid != null && p.name && !stock);
  const cls = stock ? "stock" : proven ? "named" : it.conf === "dim" ? "dim" : it.conf === "cosmetic" ? "cosmetic" : it.conf === "category" ? "category" : "named";
  const label = proven ? p.name : (it.upgrade || it.value || "");
  const pi = it.pi != null ? `<span class="pi" title="PI cost against stock">${it.pi > 0 ? "+" : ""}${it.pi}</span>` : "";
  const sub = it.engine_type ? `<div class="sub${it.engine_type_conf === "measured" ? " meas" : ""}">${it.engine_type_conf === "measured" ? "📡 " : ""}${esc(it.engine_type)}</div>` : "";
  const note = it.note ? `<div class="sub">ℹ ${esc(it.note)}</div>` : "";
  const swap = (it.item === "powertrain" && !stock && it.engine_family != null)
    ? `<div class="sub hint">Engine Swap menu → match this tile${it.engine_catalog && it.engine_catalog.shared_swap ? " · shared swap engine" : ""}</div>` : "";
  return `<label class="srow ${stock ? "stock" : ""}" data-slot="${esc(p ? p.slot : it.item)}">
    <input type="checkbox" ${stock ? "disabled" : ""}>
    <span class="it">${esc(it.item.replace(/_/g, " "))}${sub}${note}${swap}</span>
    ${pips(it.upgrade || "")}
    ${tileStrip(p)}
    <span class="up ${cls}" ${proven && it.upgrade && it.upgrade !== p.name ? `title="daemon read: ${esc(it.upgrade)}"` : ""}>${esc(label)}${pi}</span></label>`;
}
function dbRow(p) {   // a database slot the deliverable does not carry (or the whole sheet, with no save on disk)
  const stock = !!p.stock || p.pid == null;
  return `<label class="srow ${stock ? "stock" : ""}" data-slot="${esc(p.slot)}">
    <input type="checkbox" ${stock ? "disabled" : ""}>
    <span class="it">${esc(p.slot.replace(/_/g, " "))}</span>
    ${pips(p.name || "")}
    ${tileStrip(p)}
    <span class="up ${stock ? "stock" : "named"}">${esc(p.name || (stock ? "Stock" : "—"))}</span></label>`;
}
function shopMenus(b, dl) {
  if (dl && (dl.menus || []).length) {
    const used = new Set();
    return dl.menus.map((m) => {
      const rows = m.rows.map((it) => { const p = partFor(b, it.item); if (p) used.add(p.slot); return partRow(it, p); });
      // installed parts the deliverable did not name (intercooler, restrictor plate…) join their menu
      const extra = (b.parts || []).filter((p) => !used.has(p.slot) && p.pid != null && !p.stock && sameArea(p.area, m.menu));
      extra.forEach((p) => used.add(p.slot));
      return { name: m.menu, n: m.rows.filter((x) => !x.stock).length + extra.length, of: m.rows.length + extra.length,
               html: rows.join("") + extra.map(dbRow).join("") };
    });
  }
  return shopAreas(b).map((g) => ({ name: g.a, n: g.rows.filter((p) => !p.stock && p.pid != null).length, of: g.rows.length,
                                     html: g.rows.map(dbRow).join("") }));
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
function sliderRow(row) {
  const rel = row.value == null;
  const pct = Math.max(2, Math.min(98, (row.fill || 0) * 100));
  const val = rel
    ? `<span class="slv pos">${row.norm != null ? Math.round(row.norm * 1000) / 10 : Math.round((row.fill || 0) * 1000) / 10}%</span>`
    : `<span class="slv${row.derived ? " derived" : ""}"${row.derived ? ' title="derived from the global band — exact on the next gear-ladder drive"' : row.src === "db" ? ' title="absolute value from the database: the save\'s slider position on the game\'s own range for this car"' : ""}>${esc(String(row.value))}<small>${esc(row.unit || "")}</small>${row.src === "db" ? '<em class="src">db</em>' : ""}</span>`
      + (row.conflict ? `<span class="cflag" title="the save decodes ${esc(String(row.conflict.save))}; telemetry measures ${esc(String(row.conflict.telemetry))}">⚠ save ${esc(String(row.conflict.save))}</span>`
        : row.agree ? `<span class="aflag" title="the save and telemetry agree">✓×2</span>` : "");
  return `<div class="sl"><div class="slt"><span class="sll">${esc(row.label || row.field)}</span>${val}</div>
    <div class="trk"><span class="rail"></span><span class="fill ${rel ? "pos" : ""}" style="width:${pct}%"></span><span class="knob ${rel ? "pos" : ""}" style="left:${pct}%"></span></div>
    <div class="pol"><span>◄ ${esc((row.poles || [])[0] || "")}</span><span>${esc((row.poles || [])[1] || "")} ►</span></div></div>`;
}
// The daemon reports a slider "by %" when it has no per-car range for it; the database has every
// range from the game's own physics rows, so those six read as absolute values here — in the
// game's display units — and are tagged as coming from the database.
const DB_UNITS = { "N/mm": ["lb/in", 5.71015], "m": ["in", 39.3701], "kgf": ["lb", 2.20462], "psi": ["psi", 1], "deg": ["deg", 1], "%": ["%", 1] };
function dbTuneFor(b) {
  const ts = CUR && CUR.disk && CUR.disk.ts;
  const tunes = (b && b.tunes) || [];
  return tunes.find((t) => ts && String(t.container || "").endsWith("_" + ts)) || tunes[tunes.length - 1] || null;
}
function fillFromDb(row, tune) {
  if (!tune || row.value != null) return row;
  const s = (tune.sliders || []).find((x) => x.slider === row.field);
  if (!s || s.v == null) return row;
  const [unit, k] = DB_UNITS[s.unit] || [s.unit, 1];
  const v = s.v * k;
  return Object.assign({}, row, { value: (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)), unit, src: "db", norm: s.norm });
}
function tuneTabs(b, dl) {
  if (dl && (dl.tabs || []).length) {
    const tune = dbTuneFor(b);
    return dl.tabs.map((t) => {
      const secs = [];
      t.rows.forEach((r0) => { const r = fillFromDb(r0, tune); let s = secs.find((x) => x.h === r.section); if (!s) secs.push(s = { h: r.section, rows: [] }); s.rows.push(r); });
      return { name: t.tab, html: secs.map((s) => `<div class="sec"><div class="sech">${esc(s.h)}</div>${s.rows.map(sliderRow).join("")}</div>`).join("") };
    });
  }
  const ts = tuneScreen(b);
  return ts.tabs.map((n, i) => ({ name: n, html: ts.bodies[i] }));
}
function cloneHTML(b, dl, name) {
  const t = (b.tunes || []).slice(-1)[0] || {};
  const menus = shopMenus(b, dl), tabs = tuneTabs(b, dl);
  const rail = (items, attr) => items.map((m, i) => `<button class="cat ${i ? "" : "on"}" data-${attr}="${i}">${esc(m.name)}${m.of != null ? `<span class="cn">${m.n}/${m.of}</span>` : ""}</button>`).join("");
  const bodies = (items, attr) => items.map((m, i) => `<div class="catbody ${i ? "" : "on"}" data-${attr}="${i}">${m.html}</div>`).join("");
  const src = !dl ? `<span class="lk">from the database — no save on disk</span>`
    : dl.locked ? `<span class="lk">🔒 downloaded</span>` : `<span class="own">self-made</span>`;
  return `<div class="hd"><div><b>${esc(name || t.name || "clone")}</b><span class="sub">${esc(b.car || "")}</span>${src}${dl && dl.gear_count ? `<span class="sub">${dl.gear_count}-speed</span>` : ""}</div>
    <div class="tabs"><button class="tb on" data-screen="shop">Upgrade Shop</button>
      <button class="tb" data-screen="tune">Tuning</button></div>
    <div class="prog"><span id="pdone">0</span>/<span id="ptot">0</span> installed</div></div>
  <section class="screen on" id="shop"><nav class="cats">${rail(menus, "cat")}</nav><div class="pane">${bodies(menus, "body")}</div></section>
  <section class="screen" id="tune"><nav class="cats">${rail(tabs, "tcat")}</nav><div class="pane">${bodies(tabs, "tbody")}</div></section>`;
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
  // The database holds each gear as its slider POSITION (0..1) — the ratio band is per car and is
  // not in the save — so the fallback says so: a position, labelled by gear, never a ratio, and
  // never index 0 dressed up as the final drive (that slider sits in the list above under its name).
  const ord = (i) => i + (i === 1 ? "st" : i === 2 ? "nd" : i === 3 ? "rd" : "th");
  const gears = (t.gears || []).length ? `<div class="tgrid one"><div class="th">Gearing</div><div class="th">slider position</div><div class="th"></div>
    ${t.gears.map((g, i) => `<div class="tl">${ord(i + 1)} gear</div>
      <div class="tv"><div class="bar"><i style="width:${(Math.max(0, Math.min(1, g)) * 100).toFixed(1)}%"></i></div><b>${(g * 100).toFixed(1)}%</b></div><div class="tv"></div>`).join("")}</div>` : "";
  if (gears) { groups.push({ g: "Gearing", rows: [] }); bodies.push(gears); }
  return { tabs: groups.map((g) => g.g), bodies };
}

function wireClone(w, b) {
  const d = w.document;                       // a real popup document, or the overlay element
  const byId = (id) => (d.getElementById ? d.getElementById(id) : d.querySelector("#" + id));
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

// Scoped copy for in-page use: every selector prefixed so the sheet cannot restyle the panel.
function scopedCloneCss() {
  return CLONE_CSS.replace(/(^|\})\s*([^{}@]+)\{/g, (m, pre, sel) => pre + sel.split(",").map((x) => {
    x = x.trim(); if (!x) return x;
    if (x === ":root" || x === "body") return ".fhcl";
    return ".fhcl " + x;
  }).join(",") + "{");
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
.cats{display:flex;flex-direction:column;gap:2px;margin:0;background:var(--pn);border-right:1px solid var(--ln);overflow:auto;padding:6px}
.cat{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;
 color:var(--mut);padding:9px 11px;border-radius:6px;font:500 12.5px inherit;cursor:pointer}
.cat:hover{background:var(--pn2);color:var(--ink)}
.cat.on{background:var(--pn2);color:var(--acc);box-shadow:inset 3px 0 0 var(--acc)}
.cn{margin-left:auto;font:11px var(--mono);opacity:.8}
.pane{overflow:auto;padding:10px 12px;background:none;border:0;border-radius:0}
.catbody{display:none}.catbody.on{display:block}
.srow{display:grid;grid-template-columns:18px minmax(0,1fr) 49px auto 44px minmax(150px,38%);gap:10px;align-items:center;
 padding:6px 10px;border-bottom:1px solid var(--ln);cursor:pointer;font-size:12.5px;text-transform:capitalize}
.srow:hover{background:var(--pn2)}
.srow.stock{opacity:.45;cursor:default}
.srow.done{background:#0f2a1e55}
.srow.done .up{text-decoration:line-through;color:var(--mut)}
.srow .it{min-width:0}
.srow .sub{font-size:10px;color:var(--mut);line-height:1.25;margin-top:2px;font-style:italic;text-transform:none}
.srow .sub.meas{color:#8fd14f;font-style:normal}
.srow .sub.hint{color:var(--acc2);font-style:normal}
.pips{display:flex;gap:3px}
.pips i{width:13px;height:6px;border-radius:1px;background:#26313a}
.pips i.on{background:#a8d92a}
.strip{display:flex;gap:3px}
.strip i{width:12px;height:12px;border:1px solid var(--ln);border-radius:2px;background:var(--pn2)}
.strip i.hit{background:var(--acc);border-color:var(--acc);box-shadow:0 0 0 2px #00d27a33}
.srow .tile{font:12px var(--mono);color:var(--acc);text-align:right}
.srow .of{color:var(--mut)}
.up{text-align:right;text-transform:none;overflow-wrap:anywhere;min-width:0}
.up.named,.up.category{color:#c3ea4f}
.up.stock{color:var(--mut);font-size:11px;text-transform:uppercase}
.up.dim{color:#36c1e8}
.up.cosmetic{color:var(--mut)}
.pi{margin-left:6px;font-size:9.5px;letter-spacing:.04em;font-weight:700;color:#e6a63a;border:1px solid rgba(230,166,58,.4);border-radius:8px;padding:0 5px;vertical-align:middle;font-variant-numeric:tabular-nums}
.hd .lk{color:var(--warn);font-size:11px;border:1px solid var(--warn);border-radius:9px;padding:0 7px;margin-left:8px}
.hd .own{color:var(--acc);font-size:11px;border:1px solid var(--acc);border-radius:9px;padding:0 7px;margin-left:8px}
.sec{margin-bottom:12px}
.sech{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#0b0f07;background:#a8d92a;padding:2px 8px;border-radius:3px;display:inline-block;margin:0 0 7px}
.sl{display:block;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.sl:last-child{border-bottom:none}
.slt{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:5px}
.sll{font-size:12px;color:var(--ink)}
.slv{font-weight:700;font-size:16px;color:#c3ea4f;white-space:nowrap;font-variant-numeric:tabular-nums}
.slv small{font-size:10px;color:var(--mut);margin-left:3px;font-weight:400}
.slv.pos{color:#e6a63a;font-size:13px}
.slv.derived{color:#8fd14f;border-bottom:1px dotted rgba(143,209,79,.55)}
.cflag{margin-left:8px;font-size:10px;color:var(--warn)}
.aflag{margin-left:8px;font-size:10px;color:var(--acc)}
.trk{position:relative;height:16px}
.trk .rail{position:absolute;top:7px;left:0;right:0;height:3px;border-radius:2px;background:#0b1013;border:1px solid var(--ln)}
.trk .fill{position:absolute;top:7px;left:0;height:3px;border-radius:2px;background:#a8d92a}
.trk .fill.pos{background:repeating-linear-gradient(90deg,#e6a63a,#e6a63a 4px,transparent 4px,transparent 8px)}
.trk .knob{position:absolute;top:1px;width:4px;height:14px;border-radius:2px;background:var(--ink);transform:translateX(-50%)}
.trk .knob.pos{background:#e6a63a}
.pol{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-top:2px}
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
.bar{display:block;margin:0;position:relative;flex:1;height:8px;background:var(--pn2);border:1px solid var(--ln);border-radius:4px;overflow:hidden}
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
