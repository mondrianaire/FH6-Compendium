/* panel.js — the instrument panel: five regions whose contents follow the workflow state.
 *
 * The regions never move. What fills them is decided by two things and nothing else:
 *   MODE    free | course | decode   — from the daemon's own mode event, sticky through menus
 *   STATUS  downloaded | unknown | variation | clone | ratified — from five observable variables
 * docs/dashboard-states.md is the contract this file implements. If the two disagree, the doc wins
 * and this file is wrong.
 */
"use strict";

/* --------------------------------------------------------- the view store */
// A RELOAD IS A RE-QUERY, NOT A RESET. Every value on screen is either re-derived from the stores
// it came from (api/*.json, the daemon's snapshot) or, when it is the user's own choice, read back
// from ONE view store keyed by the context that owns it: the car (ordinal), the course (key), the
// build (hardware hash), or the page. Nothing derivable is persisted; nothing persisted is shown
// as live — a restored course, position or PI is labelled held until a fresh frame confirms it.
let VIEW = { v: 1, global: {}, car: {}, course: {}, build: {} };
let CTX = {};                    // the volatile live-context seed: sessionStorage, expires with the tab
let VIEW_T = null;
function viewLoad() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem("fh6view") || "null"); } catch (e) { v = null; }
  if (!v || v.v !== 1) v = viewMigrate();
  VIEW = Object.assign({ v: 1, global: {}, car: {}, course: {}, build: {} }, v || {});
  VIEW.global = VIEW.global || {}; VIEW.car = VIEW.car || {}; VIEW.course = VIEW.course || {}; VIEW.build = VIEW.build || {};
  try { CTX = JSON.parse(sessionStorage.getItem("fh6ctx") || "{}") || {}; } catch (e) { CTX = {}; }
}
// the five legacy keys become the one store, once
function viewMigrate() {
  const v = { v: 1, global: {}, car: {}, course: {}, build: {} };
  const rd = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const pins = rd("fh6pin") || {};
  Object.keys(pins).forEach((o) => { (v.car[o] = v.car[o] || {}).pin = pins[o]; });
  const bl = rd("fh6baseline"); if (bl && bl.ordinal != null) (v.car[String(bl.ordinal)] = v.car[String(bl.ordinal)] || {}).baseline = bl;
  const sh = rd("fh6sheet"); if (sh) v.global.sheet = sh;
  try { const m = localStorage.getItem("fh6SegMode"); if (m) v.global.traceMode = m; v.global.traceAll = localStorage.getItem("fh6PaintAll") === "1"; } catch (e) {}
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("fh6clone:")) { const d = rd(k); if (d) v.build[k.slice(9)] = { done: d }; } } } catch (e) {}
  try { localStorage.setItem("fh6view", JSON.stringify(v)); } catch (e) {}
  return v;
}
function viewSave() {
  clearTimeout(VIEW_T);
  VIEW_T = setTimeout(() => {
    try {
      const keys = Object.keys(VIEW.course);
      if (keys.length > 40) keys.sort((a, b) => (VIEW.course[b].touched || 0) - (VIEW.course[a].touched || 0)).slice(40).forEach((k) => delete VIEW.course[k]);
      localStorage.setItem("fh6view", JSON.stringify(VIEW, (k, val) => (val instanceof Set ? [...val] : val)));
    } catch (e) { /* private mode, or quota: the page still works, it just forgets */ }
  }, 400);
}
function ctxSave(patch) { Object.assign(CTX, patch, { at: Date.now() }); try { sessionStorage.setItem("fh6ctx", JSON.stringify(CTX)); } catch (e) {} }
const ctxFresh = (ms) => !!(CTX && CTX.at && Date.now() - CTX.at < ms);
function vg(k, d) { if (VIEW.global[k] === undefined) VIEW.global[k] = d; return VIEW.global[k]; }
function vcar(o) { const k = String(o); return VIEW.car[k] || (VIEW.car[k] = {}); }
function vcourse(key) {
  const c = VIEW.course[key] || (VIEW.course[key] = {});
  c.filters = c.filters || {}; c.rightTab = c.rightTab || {};
  if (!(c.hidden instanceof Set)) c.hidden = new Set(c.hidden || []);
  c.touched = Date.now();
  return c;
}

// MODE has three states, not two: unknown until the daemon's first mode event, then free | course |
// decode. Asserting "free" before the daemon spoke was how a reload painted the world map over a
// course you were standing on. `held` = seeded from the previous page, not yet confirmed.
let MODE = { suggest: null, reason: "waiting for the daemon", kind: null, game: null, known: false, held: false };
const liveKnown = () => LIVE.frame != null || LIVE.receiving === false;
function adoptMode(m) {
  if (!m) return;
  const prev = { suggest: MODE.suggest, game: MODE.game };
  if (m.game !== undefined) MODE.game = m.game;
  if (m.kind !== undefined) MODE.kind = m.kind;
  if (m.suggest) { MODE.suggest = m.suggest; MODE.reason = m.reason || MODE.reason; MODE.known = true; MODE.held = false; }
  if (prev.suggest !== MODE.suggest || prev.game !== MODE.game) onModeChange(prev, MODE);
}
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
  if (CUR.diskErr) return { key: "offline", label: "save not read", tone: "dim",
    why: "the daemon could not be reached, so nothing is known about the save — absence of signal is not evidence",
    steps: ["start the daemon from the worktree: python scripts/telemetry/fh6_live_daemon.py", "then REREAD BUILD"] };
  if (!hwOk) return { key: "unknown", label: locked ? "downloaded, not yet held" : "new build on disk", tone: "warn",
    why: (RB.state === "running" || RB.pending) ? "a save the database does not hold yet — importing it now"
       : locked ? "a downloaded tune installed since the last import — the import runs by itself"
       : "a save written since the last import — the import runs by itself",
    steps: ["import the save and regenerate the dashboard data — one button, about 10 s"], rebuild: true };
  if (locked) return { key: "downloaded", label: "downloaded / locked", tone: "warn",
    why: frozenOf() ? "someone else's build, frozen as your target — install your own tune on this car and build back to it"
                    : "someone else's build; sliders are hidden by the lock",
    steps: frozenOf() ? ["build this car back to the frozen sheet", "save it with a name — then it is yours, unlocked and comparable"]
                      : ["clone it onto a second copy of the car — open BUILD SHEET", "with only one copy: keep the sheet as your target, install your own tune on this car, build back to it"], ambiguous };
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
  // THE LAST-ACTION LINE. One accent-coloured rule across the whole viewport, flush to the very
  // top with nothing above it, carrying what the lab last did. It is a status line, not a card:
  // it never grows, never wraps, and is the only thing outside the panel's own grid.
  if (!document.getElementById("lastact")) {
    const la = document.createElement("div"); la.id = "lastact"; document.body.appendChild(la);
  }
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

const courseFile = (key) => "course/" + String(key).replace(/[^A-Za-z0-9_\-]/g, "_") + ".json";
async function panelBoot() {
  // the page's own chrome, from the view store, before anything paints
  DOCK_SPAN = vg("dockSpan", 600); SHOW_OFFMAP = !!vg("showOffmap", false); FOLLOW.on = vg("follow", false) === true;
  TRACE_MODE = vg("traceMode", TRACE_MODE); TRACE_ALL = !!vg("traceAll", TRACE_ALL);
  const [w, d, c] = await Promise.all([get("world.json"), get("diag.json"), get("courses.json")]);
  WORLD = w; DIAG = d; COURSES = c;
  // the live-context seed: where the car was, on which course, in which mode — held, not live
  if (!LIVE.frame && ctxFresh(10 * 60e3)) {
    if (CTX.livePos && LIVEPOS == null) LIVEPOS = CTX.livePos;
    if (CTX.mode && CTX.mode.suggest && !MODE.known) { MODE.suggest = CTX.mode.suggest; MODE.game = CTX.mode.game || null; MODE.reason = "held from the previous page"; MODE.known = true; MODE.held = true; }
    if (CTX.courseKey && !COURSE) {
      try { COURSE = await get(courseFile(CTX.courseKey)); COURSE_KEY = CTX.courseKey; restoreCourseView(COURSE_KEY); } catch (e) { COURSE = null; COURSE_KEY = null; }
    }
  }
}

/* ------------------------------------------------------- the context hooks */
// Three moments when the context changes hands; each restores what the new context owns.
function restoreCourseView(key) {
  if (!key) return;
  const vc = vcourse(key);
  if (RIGHT_CTX && vc.rightTab[RIGHT_CTX]) RIGHT_TAB = vc.rightTab[RIGHT_CTX];
  TRACE_KEY = null; LEFT_KEY = null;
}
async function onCourseChange(prevKey, key, opts) {
  opts = opts || {};
  if (key && (opts.force || key !== prevKey)) {
    let c = null;
    try { c = await get(courseFile(key)); } catch (e) { c = null; }
    if (!c) return;                         // never latch a key whose file will not load
    COURSE = c; COURSE_KEY = key;
  }
  if (COURSE_KEY) restoreCourseView(COURSE_KEY);
  ctxSave({ courseKey: COURSE_KEY, livePos: LIVEPOS });
  paintLeft(); paintTrace(); paintRight(); paintFooter();
}
function onModeChange(prev, cur) {
  if (COURSE && COURSE.key) { const vc = VIEW.course[COURSE.key]; if (vc && vc.auto !== false) delete vc.preset; }   // the context chose it; let it choose again
  TRACE_KEY = null;
  ctxSave({ mode: { suggest: cur.suggest, game: cur.game } });
  paintLeft(); paintTrace(); paintRight(); paintFooter();
}
function onCarChange() {
  if (!CUR) return;
  const cv = vcar(CUR.ordinal);
  BASELINE = cv.baseline || null;         // a baseline belongs to a car; another car's is not shown here
  if (RIGHT_CTX) RIGHT_TAB = rightTabStore()[RIGHT_CTX] || null;
  if (cv.livePI && LIVE_PI == null && Date.now() - cv.livePI.at < 30 * 60e3) { LIVE_PI = cv.livePI.pi; LIVE_PI_HELD = true; }
  if (!CHANGE && cv.change && !(cv.dismissed && cv.dismissed.change === cv.change.ts) && CUR.disk
      && (cv.change.saved ? cv.change.ts === CUR.disk.ts : (cv.prevFp && cv.prevFp.ts === CUR.disk.ts))) CHANGE = cv.change;
  ctxSave({ cid: CUR.cid, ordinal: CUR.ordinal });
}

/* ------------------------------------------------------------ the fitter */
// HARD RULE: the dashboard has NO SCROLLBARS. Every region is a planned cell, and a list that
// cannot fit its cell does not scroll — it shows what fits and says how many it could not show.
// fitRows() runs after a paint: it measures the real box, hides the children past the fold, and
// appends one honest line. Called by every pane that renders a list.
function fitRows(host, noun, keepFirst) {
  if (!host) return;
  const kids = Array.from(host.children).filter((k) => !k.classList.contains("fitmore"));
  host.querySelectorAll(".fitmore").forEach((x) => x.remove());
  kids.forEach((k) => (k.hidden = false));
  const box = host.clientHeight;
  if (!box) return;
  const more = document.createElement("div");
  more.className = "fitmore";
  const head = keepFirst || 0;
  let used = 0, shown = 0;
  for (let i = 0; i < kids.length; i++) {
    const h = kids[i].offsetHeight;
    // the last slot is reserved for the "+N" line, so it can never be the thing that overflows
    if (i >= head && used + h > box - 18 && i < kids.length - 1) {
      for (let j = i; j < kids.length; j++) kids[j].hidden = true;
      more.textContent = "+" + (kids.length - shown) + " more " + (noun || "rows") + " — not shown, the cell is full";
      host.appendChild(more);
      return;
    }
    used += h; shown++;
  }
}
function lastAction() {
  const el = document.getElementById("lastact"); if (!el) return;
  let tone = "dim", txt = "", when = "";
  if (RB.state === "running" || RB.pending) { tone = "warn"; txt = "importing the save into the database"; }
  else if (RR.busy) { tone = "warn"; txt = "re-reading the save from disk"; }
  else if (CHANGE) {
    const n = (CHANGE.sliders || []).length, p = (CHANGE.slots || []).length;
    tone = CHANGE.kind === "hardware" ? "warn" : CHANGE.kind === "tune" ? "blue" : "ok";
    txt = (CHANGE.saved ? "new save read" : CHANGE.kind === "hardware" ? "hardware changed, not saved" : "sliders moved, not saved")
        + (CHANGE.locked ? " · downloaded tune" : "")
        + (p ? " · " + p + " part" + (p === 1 ? "" : "s") : "") + (n ? " · " + n + " slider" + (n === 1 ? "" : "s") : "");
    when = CHANGE.ts ? tsLocal(CHANGE.ts) : (CHANGE.at ? new Date(CHANGE.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
  } else if (RB.last && RB.last.finished) { tone = "ok"; txt = "database up to date"; when = new Date(RB.last.finished * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  else if (CUR && CUR.disk) { tone = "dim"; txt = "save read · nothing has changed since"; }
  else { tone = "dim"; txt = MODE.reason || "waiting for the daemon"; }
  // the connection and the background services live here too: one anchored line carries what the
  // lab last DID on the left and whether it is still connected on the right. A dot per service,
  // so the state is legible without reading a word.
  // each service names ITSELF and its state: a coloured dot alone was unreadable on a coloured band
  const dot = (ok, name, val, title) => `<span class="svc ${ok === null ? "w" : ok ? "ok" : "bad"}" title="${esc(title)}">
    <i class="sdot"></i><em>${esc(name)}</em>${val ? `<b>${esc(val)}</b>` : ""}</span>`;
  const dbAt = RB.last && RB.last.finished ? new Date(RB.last.finished * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const svc = `<span class="svcs">
    ${dot(!!LIVE.receiving, "telemetry", LIVE.receiving ? n1(LIVE.pps) + " pps" : "none", LIVE.receiving ? "the daemon is receiving the game's packets" : "no packets from the game — is the daemon running, and Data Out on?")}
    ${dot(CUR && CUR.disk ? true : (CUR && CUR.diskErr ? false : null), "save", CUR && CUR.disk ? "read" : (CUR && CUR.diskErr ? "unreachable" : "none"), CUR && CUR.diskErr ? "the daemon could not be reached" : "the tune file on disk for this car")}
    ${dot(RB.state === "down" ? false : (RB.state === "running" || RB.pending ? null : true), "database", RB.state === "down" ? "service down" : (RB.state === "running" || RB.pending ? "importing" : (dbAt || "idle")), RB.state === "down" ? "the import service is not running: python scripts/rebuild_service.py 8001" : "the database import service")}
    ${dot(!!WATCH_OK, "auto-reload", WATCH_OK ? "on" : "off", WATCH_OK ? "this page reloads itself when the code or the data changes" : "the reload channel is down; the page checks the server every minute instead")}
  </span>`;
  el.dataset.tone = tone;
  el.innerHTML = `<b>${esc(txt)}</b>${when ? `<span class="when">${esc(when)}</span>` : ""}${svc}`;
}

function paintPanel() {
  lastAction();
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
// the selection and the filters live in the view store per course (vcourse); these two are the
// page-wide paint choices, mirrored to the legacy keys the v1 dashboard still reads
let TRACE_MODE = (() => { try { return localStorage.getItem("fh6SegMode") || "grip"; } catch (e) { return "grip"; } })();
let TRACE_ALL = (() => { try { return localStorage.getItem("fh6PaintAll") === "1"; } catch (e) { return false; } })();
let TRACE_KEY = null;
let TRACE_PICK = null;
let TRACE_FIT = 0;
// the chip row never scrolls sideways: keep the chips that fit, count the rest
function fitChips(row, total) {
  if (!row) return;
  const kids = Array.from(row.children).filter((k) => !k.classList.contains("fitmore"));
  row.querySelectorAll(".fitmore").forEach((x) => x.remove());
  kids.forEach((k) => (k.hidden = false));
  const w = row.clientWidth;
  let used = 0, shown = 0;
  for (const k of kids) {
    const kw = k.offsetWidth;
    if (used + kw > w - 76) { k.hidden = true; continue; }   // the "+N" cell is reserved, never squeezed
    used += kw; shown++;
  }
  const hid = (total || kids.length) - shown;
  if (hid > 0) {
    const m = document.createElement("span");
    m.className = "fitmore chipmore"; m.textContent = "+" + hid;
    m.title = hid + " more laps match — narrow the filters to see them";
    row.appendChild(m);
  }
}             // {key, ids[], fore} — what the trace drew, so the map draws it too
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
  const vc = vcourse(c.key);
  if (!vc.preset || (vc.ctx !== ctx && vc.auto !== false)) {
    const cls = liveClass();
    vc.preset = (ctx === "event" && cls) ? "class" : "all"; vc.auto = true;
  }
  if (vc.ctx !== ctx) { vc.ctx = ctx; viewSave(); }
  return vc;
}

function paintTrace() {
  const el = $("#trace"); if (!el) return;
  const course = MODE.suggest === "course" && COURSE && COURSE.traces && Object.keys(COURSE.traces).length;
  const vc0 = course ? (VIEW.course[COURSE.key] || {}) : null;
  const key = course ? JSON.stringify(["c", COURSE.key, vc0.filters, vc0.preset, vc0.ctx, [...(vc0.hidden || [])], TRACE_MODE, TRACE_ALL, CUR && CUR.cid, liveClass(), MODE.game, el.clientWidth])
                     : JSON.stringify(["r", LIVE.run.length >> 3, CUR && CUR.cid, TRACE_MODE, el.clientWidth]);
  if (key === TRACE_KEY && el.firstChild) return;
  TRACE_KEY = key;
  const r = course ? courseTrace(COURSE) : liveRun();
  // shell first, so the chart can be drawn at the pixels the shell leaves it
  // A REGION EARNS ITS HEIGHT. With nothing to draw the trace is a 34px strip, not 240px of
  // empty chart; the pixels go to the panes, which is where the data is.
  el.classList.toggle("quiet", !r.hasData);   // the band never changes size; only its content does
  el.innerHTML = `<div class="thd">${r.head}</div><div class="tbody"></div><div class="tfoot">${r.foot}</div>`;
  fitChips(el.querySelector(".lchips"), TRACE_FIT);
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

// the preset + dimension chips, shared by the trace pane and the map's own filter drawer — one
// `vc` (per-course view store) backs both, so a click in either pane keeps them in lockstep.
function traceFilterState(c) {
  const byId = {}; (c.laps || []).forEach((l) => (byId[String(l.id)] = l));
  const all = Object.keys(c.traces).map((id) => Object.assign({ id, pts: c.traces[id] }, byId[id] || {})).filter((t) => t.pts && t.pts.length > 2);
  const sel = traceSel(c), tf = sel.filters;
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
  const clearBtn = Object.keys(tf).length || sel.hidden.size ? `<button class="mini" data-tfilt="*|">clear</button>` : "";
  return { all, sel, tf, presets, stage1, filt, stage2, clearBtn };
}
// the compact bar for the map's filter drawer: same chips, none of the trace's own furniture
function mapFilterBar(c) {
  const { presets, filt, clearBtn } = traceFilterState(c);
  return `<div class="fdim"><span class="why">show</span>${presets}</div>${filt}${clearBtn}`;
}
function courseTrace(c) {
  const { all, sel, tf, presets, filt, stage2, clearBtn } = traceFilterState(c);
  // 3. the chips: each lap, a click to hide. Sort FIRST: `best` and `cur` are taken from this
  // list by position, and an unsorted list crowned whichever lap the JSON happened to list first.
  stage2.sort((a, b) => (a.t || 9e9) - (b.t || 9e9));
  const match = stage2.filter((t) => !sel.hidden.has(String(t.id)));
  const head = `<b>Speed trace</b><span class="why">${esc(c.name || c.key)} · ${match.length} of ${all.length} lap${all.length === 1 ? "" : "s"} on record${MODE.game === "event" ? " · timed event" : ""}</span>
    <span class="fdim"><span class="why">show</span>${presets}</span>${filt}${clearBtn}<span class="tspacer"></span><span class="tread why">hover: reads the point and marks the map</span>${modeControls()}`;
  if (!stage2.length) return { head, foot: `<span class="why">no lap on record matches — widen the preset or clear a filter</span>`, svg: () => `<div class="why tempty">nothing to draw</div>` };
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
    return `<button class="lchip ${hid ? "hid" : ""} ${t === cur ? "you" : t === best ? "best" : ""}" data-thide="${esc(String(t.id))}"
      style="--lc:${col}" title="${esc((hid ? "hidden — click to draw it" : "drawn — click to hide it") + " · " + (t.sid || "") + (t.container ? " · " + t.container : "") + (t.void ? " · time void: contact" : "") + (t.partial ? " · partial lap" : ""))}">
      <i class="lcd"></i><span class="lct">${nt ? `<s>${lapTime(t.t)}</s>` : lapTime(t.t)}</span>
      <span class="lcm">${what || off || (t.class ? esc(t.class) : "")}</span></button>`; }).join("");
  const foot = `<span class="lchips">${leg}</span>`;
  TRACE_FIT = stage2.length;
  // publish the selection so the LEFT PANE draws the same laps and the two panes agree
  const sel2 = { key: c.key, ids: match.map((t) => String(t.id)), fore: fore ? String(fore.id) : null };
  if (JSON.stringify(sel2) !== JSON.stringify(TRACE_PICK)) { TRACE_PICK = sel2; LEFT_KEY = null; setTimeout(paintLeft, 0); }
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
  return { head, foot, svg, hasData: match.length > 0 };
}

function liveRun() {
  const pts = LIVE.run;
  const head = `<b>Speed trace</b><span class="why">${pts.length && (pts[pts.length - 1][0] || 0) <= 50 ? "parked — the trace draws once the car moves" : "live run · the last " + (pts.length ? Math.round(pts.length / 10) : 0) + " s"}${MODE.suggest === "course" && COURSE ? ` · no lap on record for ${esc(COURSE.name || COURSE.key)} yet` : ""}</span><span class="tspacer"></span>${modeControls()}`;
  const foot = `<span class="lchips grip">${TRACE_GRIP.map((c, i) => `<span class="lchip key" style="border-color:${c}"><i style="background:${c}"></i>${TRACE_WORD[i]}</span>`).join("")}</span>`;
  const svg = (W, H) => {
    if (pts.length < 3) return `<div class="why tempty">drive — speed against distance draws here as you go, painted by what the tyres are doing</div>`;
    const smax = pts[pts.length - 1][0] || 1, vmax = Math.max(60, ...pts.map((q) => q[1])) * 1.06;
    const ch = chart(W, H, 28, 16, smax, vmax);
    const km = [...Array(Math.floor(smax / 500)).keys()].map((i) => (i + 1) * 500).map((d) => `<line x1="${ch.px(d).toFixed(1)}" y1="6" x2="${ch.px(d).toFixed(1)}" y2="${H - 16}" stroke="var(--line)" opacity=".6"/><text x="${ch.px(d).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--dim)">${d / 1000} km</text>`).join("");
    return `<svg class="tsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-smax="${smax}" data-vmax="${vmax}" data-padl="28" data-padb="16" data-w="${W}" data-h="${H}" data-pts="${esc(JSON.stringify(pts.map((q) => [q[0], q[1], q[2], q[3], q[4]])))}">${axisSvg(ch, vmax)}${km}${paintedLine(pts, ch, 2.2, TRACE_MODE)}${cursorSvg(H)}</svg>`;
  };
  // points are not a trace: a parked car accrues samples at one spot. The band is only worth
  // 240px when there is real distance under the line.
  const span = pts.length ? pts[pts.length - 1][0] : 0;
  return { head, foot, svg, hasData: pts.length >= 3 && span > 50 };
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
    const vc = traceSel(COURSE);
    if (d === "*") { vc.filters = {}; vc.hidden = new Set(); }
    else { if (v) vc.filters[d] = v; else delete vc.filters[d]; }
    viewSave(); paintTrace(); });
  el.querySelectorAll("[data-tpre]").forEach((b) => b.onclick = () => { if (!COURSE) return; const vc = traceSel(COURSE); vc.preset = b.dataset.tpre; vc.auto = false; viewSave(); paintTrace(); });
  el.querySelectorAll("[data-thide]").forEach((b) => b.onclick = () => { if (!COURSE) return; const h = traceSel(COURSE).hidden; const id = b.dataset.thide; if (h.has(id)) h.delete(id); else h.add(id); viewSave(); paintTrace(); });
  el.querySelectorAll("[data-tmode]").forEach((b) => b.onclick = () => { TRACE_MODE = b.dataset.tmode; VIEW.global.traceMode = TRACE_MODE; viewSave(); try { localStorage.setItem("fh6SegMode", TRACE_MODE); } catch (e) {} TRACE_KEY = null; paintTrace(); });
  const ta = el.querySelector("[data-tall]"); if (ta) ta.onclick = () => { TRACE_ALL = !TRACE_ALL; VIEW.global.traceAll = TRACE_ALL; viewSave(); try { localStorage.setItem("fh6PaintAll", TRACE_ALL ? "1" : "0"); } catch (e) {} TRACE_KEY = null; paintTrace(); };
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
  d.classList.toggle("idle", !(LIVE.frame && LIVE.frame.on));
  if (!d.querySelector(".dtiles")) {
    d.innerHTML = `<div class="dhd"><span class="livetag" id="dockLive"></span>
        <span class="spans">${[120, 600, 1800].map((x) => `<button class="${DOCK_SPAN === x ? "on" : ""}" data-span="${x}">${x / 60} min</button>`).join("")}</span>
        <span class="why" id="dockNote"></span></div>
      <div class="dtiles" id="dockTiles"></div>
      <div class="dtrace" id="dockTrace"></div>`;
    d.querySelectorAll("[data-span]").forEach((b) => b.onclick = () => {
      DOCK_SPAN = +b.dataset.span; VIEW.global.dockSpan = DOCK_SPAN; viewSave(); d.querySelectorAll("[data-span]").forEach((x) => x.classList.toggle("on", x === b)); paintDockTrace(); });
  }
  const lv = $("#dockLive");
  if (lv) { lv.className = "livetag " + (LIVE.receiving ? "" : "off"); lv.innerHTML = `<i></i>${LIVE.receiving ? "LIVE" : "OFFLINE"}${LIVE.pps ? ` <span class="mono">${Math.round(LIVE.pps)} pps</span>` : ""}`; }
  paintDockTiles(true); paintDockTrace();
}

function dockTiles(f) {
  if (!f) return `<span class="why">waiting for telemetry…</span>`;
  const g = f.gear === 0 ? "R/N" : f.gear === 11 ? "⇅" : f.gear;
  const t = [[fx(f.mph, 0), "mph"], [g, "gear"], [Number.isFinite(+f.rpm) ? f.rpm : "—", "rpm" + (f.maxrpm ? " / " + f.maxrpm : "")],
             [fx(f.lat, 2), "lat g"], [fx(f.lon, 2), "long g"], [fx(f.yaw, 0), "yaw °/s"],
             [Number.isFinite(+f.hp) ? f.hp : "—", "hp"], [Number.isFinite(+f.tq) ? f.tq : "—", "ft·lb"], [fx(f.boost, 1), "boost psi"]];
  const bars = [["thr", f.thr / 255, "var(--acc)"], ["brk", f.brk / 255, "var(--bad)"], ["str", (f.steer + 127) / 254, "var(--acc2)"]];
  const susp = (f.susp || []).map((v, i) => `<div title="${["FL", "FR", "RL", "RR"][i]} suspension travel ${(v * 100).toFixed(0)}%"><i style="height:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%;background:${v > 0.95 ? "var(--bad)" : "var(--mag)"}"></i><span>${["FL", "FR", "RL", "RR"][i]}</span></div>`).join("");
  const mode = f.on ? (f.ev ? `EVENT${f.lapn ? " · lap " + f.lapn : ""}${f.rpos ? " · P" + f.rpos : ""}` : "free roam") : "menu";
  const sub = f.on ? `${fx(f.dist / 1000, 2)} km${f.lapt ? " · " + fx(f.lapt, 1) + " s" : ""}` : "not driving";
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
// THE BAND IS ALLOCATED BY DIFFICULTY, NOT BY DATA (audit 2026-09-03). One skeleton in every
// state; only the CONTENT and the tone change. The state's own answer takes the largest type in
// the band, exactly one step and one control are offered, and a field earns a slot only in the
// states where it changes what you do next. Everything the game already prints on its own
// screens — mass, drivetrain, cylinders, gear count, displacement — lives in the BUILD SHEET,
// which is one always-present button away.
let HDR_KEY = null;
function paintChips() { lastAction(); }   // the connection state lives in the anchored top line

// what the header SAYS, per state — pure, so it can be read and tested on its own
function headerCopy(st, q) {
  const m = MATCH && MATCH.build;
  const mm = (CUR && CUR.match) || {};
  const tune = (m && m.name) || (CUR && CUR.disk && CUR.disk.name) || "";
  const nSaves = mm.n_saves || 0;
  const when = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };
  const car = (CUR && CUR.name) || (CUR ? "ordinal " + CUR.ordinal : "");
  const byline = [m && m.creator ? "by " + m.creator : "", m && m.created ? when(m.created) : "", car].filter(Boolean).join(" · ");
  const base = { tone: "dim", lead: "", sub: "", tune, byline, why: st.why || "", step: (st.steps || [])[0] || "",
                 rest: (st.steps || []).slice(1), primary: null, noBtn: "", caption: "", evidence: "" };

  // AMBIGUITY OVERRIDES EVERY STATUS: which build is on the car outranks what kind of build it is
  if (q && (q.level === "ambiguous" || q.level === "conflict")) {
    const ties = mm.n_signature_ties || 0, top = mm.max_gear_seen || 0;
    return Object.assign(base, { tone: "warn",
      lead: q.level === "conflict" ? "IDENTITY CONTRADICTED" : "ONE OF " + (nSaves || "?") + " — IDENTITY NOT SETTLED",
      sub: q.why, why: "the live packet carries only cylinders, drivetrain and PI" + (top ? "; top gear seen " + top : ""),
      step: ties > 1 ? "one full pull through the gears settles it, or pick the save below" : "pick the save that is on the car",
      rest: [], primary: { label: "PICK THE SAVE ▸", act: "pick" }, caption: "identity unsettled",
      evidence: (mm.how || "") + (nSaves ? " · " + nSaves + " saves" : "") });
  }
  if (st.key === "offline") return Object.assign(base, { tone: "dim", lead: "DAEMON DOWN — NOTHING HERE IS LIVE",
    sub: "everything below is the last thing seen", step: "python scripts/telemetry/fh6_live_daemon.py",
    rest: [], primary: { label: "COPY COMMAND", act: "copycmd" }, caption: "not live" });
  if (st.key === "downloaded") {
    const froz = frozenOf();
    return Object.assign(base, { tone: "warn",
      lead: froz ? "LOCKED — FROZEN AS YOUR TARGET" : "LOCKED — SOMEONE ELSE'S BUILD",
      sub: (m && m.desc) || "the sliders are hidden by the lock",
      why: froz ? "build this car back to the frozen sheet, then save it with a name" : "someone else's build; it cannot be tuned or compared until it is yours",
      step: froz ? "build back to the sheet, then save it with a name" : "clone it onto a second copy of the car, or keep this sheet as your target",
      primary: { label: froz ? "OPEN THE TARGET ▸" : "CLONE PLAN ▸", act: "sheet" },
      caption: "as downloaded", evidence: nSaves > 1 ? nSaves + " saves on this car" : "" });
  }
  if (st.key === "unknown" && !(CUR && CUR.disk && CUR.disk.deliverable && CUR.disk.deliverable.locked)) {
    const importing = RB.state === "running" || RB.pending;
    if (importing) return Object.assign(base, { tone: "dim", lead: "IMPORTING THIS SAVE",
      sub: "about 10 s · " + Math.max(0, Math.round((Date.now() - (RB.startedAt || Date.now())) / 1000)) + " s elapsed",
      why: "a save the database does not hold yet", step: "nothing to do — this runs by itself",
      rest: [], noBtn: "IMPORTING…", caption: "as saved" });
    return Object.assign(base, { tone: "warn", lead: "NEW SAVE — NOT YET HELD",
      sub: "the database has not imported it", why: st.why, step: st.steps && st.steps[0] ? st.steps[0] : "import it",
      primary: { label: "IMPORT NOW", act: "rebuild" }, caption: "as saved" });
  }
  if (st.key === "unknown") {                    // hardware changed and unsaved (PI drift)
    const ch = CHANGE || {};
    return Object.assign(base, { tone: "bad", lead: "NOT SAVED — NOTHING CAN BE COMPARED",
      sub: (ch.sliders && ch.sliders.length ? ch.sliders.length + " sliders moved" : "") + (ch.slots && ch.slots.length ? (ch.sliders && ch.sliders.length ? " · " : "") + ch.slots.length + " parts changed" : "") || "the car no longer matches any save",
      why: "the game writes nothing to disk until you save", step: "save the tune in-game and give it a name",
      rest: [], noBtn: "NO BUTTON — SAVE IT IN THE GAME", caption: "not saved" });
  }
  if (st.key === "clone") return Object.assign(base, { tone: "blue", lead: "CLONE — NOT YET SAVED",
    sub: st.base ? "identical to '" + (st.base.name || "a locked build") + "'" : "identical to a locked build, unlocked",
    why: "a clone is only comparable once it is saved", step: "save it with a name in the tuning menu",
    rest: [], noBtn: "NO BUTTON — SAVE IT IN THE GAME", caption: "as cloned" });
  if (st.key === "variation") {
    const ch = CHANGE || {}, n = (ch.sliders || []).length;
    const two = (ch.sliders || []).slice(0, 2).map((x) => x.name.replace(/_/g, " ") + " " + x.a + " → " + x.b).join(" · ");
    return Object.assign(base, { tone: "blue",
      lead: "VARIATION" + (st.base && st.base.name ? " OF " + st.base.name.toUpperCase() : "") + (n ? " — " + n + " SLIDERS MOVED" : ""),
      sub: two || "same hardware, different sliders", why: "the hardware is identical, so the tuning is what is under test",
      step: "drive both on one course, then compare", primary: { label: "COMPARE A/B ▸", act: "ab" },
      caption: "as saved", evidence: st.base && st.base.name ? "base: " + st.base.name : "" });
  }
  if (st.key === "ratified") {
    const twins = atomicTwins(), laps = (m && m.laps) || 0, courses = (m && m.courses) || 0;
    const isBase = BASELINE && BASELINE.container === (st.twin && st.twin.c);
    return Object.assign(base, { tone: "ok",
      lead: laps ? "RATIFIED · " + laps + " LAPS" + (courses ? " ON " + courses + " COURSE" + (courses === 1 ? "" : "S") : "") : "RATIFIED — YOUR OWN BUILD",
      sub: (twins.length > 1 ? twins.length + " identical saves under the rim rule" : "one save") + (isBase ? " · this is the testing baseline" : " · baseline not set"),
      why: "your own saved, unlocked build; it carries the history of every atomically similar build",
      step: isBase ? "drive it — laps accrue against this baseline" : "set it as the testing baseline to measure against",
      rest: [], primary: { label: isBase ? "✓ BASELINE — CLEAR" : "SET TESTING BASELINE", act: "base" },
      caption: "as saved", evidence: twins.length > 1 ? twins.length + " atomic twins" : "" });
  }
  return Object.assign(base, { lead: st.label ? st.label.toUpperCase() : "", caption: "as saved" });
}

function paintHeader() {
  const h = $("#hdr"); if (!h) return;
  const st = buildStatus();
  const q = matchQuality(CUR && CUR.match);
  const key = JSON.stringify([CUR && CUR.cid, CUR && CUR.disk && CUR.disk.ts, st.key, st.label, q.level,
    MATCH && MATCH.build && MATCH.build.c, BASELINE && BASELINE.container, CUR && CUR.pinned,
    RR.busy, RB.state === "running" || RB.pending, !!frozenOf(), !!(MATCH && MATCH.sheet),
    CUR && CUR.liveries && CUR.liveries.length, CHANGE && CHANGE.at]);
  if (key === HDR_KEY && h.querySelector(".hlead")) { paintChips(); return; }
  HDR_KEY = key;

  const m = MATCH && MATCH.build;
  const c = CUR ? headerCopy(st, q) : { tone: "dim", lead: "WAITING FOR A CAR", sub: MODE.reason || "no signal yet",
    tune: "", byline: "", why: "get in a car in the game", step: "the header fills the moment a frame names it",
    rest: [], primary: null, noBtn: "", caption: "no car", evidence: "" };
  const liv = CUR && (CUR.liveries || []).find((l) => l.thumb);
  const img = m && m.thumb ? `${API}${m.thumb}` : liv ? `${DAEMON}/livery-thumb?ordinal=${CUR.ordinal}&d=${encodeURIComponent(liv.dir)}` : null;

  h.dataset.tone = c.tone;
  h.innerHTML = `
    <div class="hart">
      ${img ? `<img class="art" alt="" src="${img}">` : `<div class="art none t-l">${esc(CUR ? (c.step || "no render") : "no car")}</div>`}
      ${CUR ? `<span class="artpi">${piBadge(CUR.cls, CUR.pi)}</span>` : ""}
      <span class="artcap t-l">${esc(c.caption)}</span>
    </div>
    <div class="hid">
      <div class="hlead t-d">${esc(c.lead)}</div>
      <div class="hsub t-b">${esc(c.sub)}</div>
      <div class="hsp"></div>
      <div class="htitle t-t">${c.tune ? esc(c.tune) : `<span class="t-l empty">no save on disk for this car</span>`}</div>
      <div class="hby t-l">${esc(c.byline)}</div>
      <div class="hsp"></div>
      <div class="hdec">
        <div class="hwhy t-a">${esc(c.why)}</div>
        ${c.step ? `<div class="hstep t-b"><i>1</i><span>${esc(c.step)}</span></div>` : ""}
      </div>
    </div>
    <div class="hact">
      ${c.primary ? `<button class="prim" id="btnPrim" data-act="${esc(c.primary.act)}">${esc(c.primary.label)}</button>`
        : `<div class="prim none t-l">${esc(c.noBtn || "nothing to do here")}</div>`}
      <button class="second" id="btnSheet" ${MATCH && MATCH.build ? "" : "disabled"}>${frozenOf() ? "◆ BUILD SHEET · TARGET" : "BUILD SHEET ▸"}</button>
      <div class="hev">
        <div class="t-l">evidence</div>
        <div class="t-b">${esc(c.evidence || (q.level === "ok" ? q.why : "") || "—")}</div>
        <button class="icobtn" id="btnRefresh" ${(RR.busy || RB.state === "running" || RB.pending) ? "disabled" : ""}
          title="re-read this car's save from disk, and import it if the database does not hold it. Both happen by themselves; this is the manual override.">${(RR.busy || RB.state === "running" || RB.pending) ? "…" : "⟳"}</button>
      </div>
    </div>`;

  const bs = $("#btnSheet"); if (bs) bs.onclick = () => openSheet();
  const bx = $("#btnRefresh"); if (bx) bx.onclick = async () => { await rereadBuild(); if (CUR && CUR.disk && !(MATCH && MATCH.build)) ensureHeld(); };
  const bp = $("#btnPrim");
  if (bp) bp.onclick = () => {
    const act = bp.dataset.act;
    if (act === "sheet") openSheet();
    else if (act === "base") setBaseline(st.twin);
    else if (act === "rebuild") requestRebuild("manual");
    else if (act === "ab") abOverlay();
    else if (act === "pick") { const el = document.querySelector("#alerts .picker"); if (el) el.scrollIntoView({ block: "nearest" }); }
    else if (act === "copycmd") { try { navigator.clipboard.writeText("python scripts/telemetry/fh6_live_daemon.py"); bp.textContent = "COPIED"; } catch (e) { /* no clipboard */ } }
  };
  // THE NO-CLIP RULE, asserted rather than hoped for: any line that would be cut steps down one
  // size until it fits, and the console names it — an ellipsis in this band is a bug, not a style.
  h.querySelectorAll(".hlead, .htitle, .hsub, .hby, .hwhy").forEach((el) => {
    let px = parseFloat(getComputedStyle(el).fontSize);
    for (let i = 0; i < 6 && el.scrollWidth > el.clientWidth + 1 && px > 9; i++) { px -= 1; el.style.fontSize = px + "px"; }
    if (el.scrollWidth > el.clientWidth + 1) console.warn("[header] still clipped:", el.className, el.textContent.slice(0, 40));
  });
}

function setBaseline(twin) {
  if (!twin) return;
  if (BASELINE && BASELINE.container === twin.c) BASELINE = null;
  else BASELINE = { container: twin.c, hw: twin.hw, su: twin.su, name: twin.name, ordinal: twin.o, set_utc: new Date().toISOString() };
  vcar(twin.o).baseline = BASELINE; viewSave();   // a baseline belongs to its car
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
  // the header carries step 1; the strip carries the rest of the ladder for this state
  const rest = (st.steps || []).slice(1);
  if (rest.length && !CHANGE) {
    parts.push(`<div class="alert ${st.tone === "bad" ? "bad" : st.tone === "warn" ? "warn" : ""}">
      <span class="steps">${rest.map((x, i) => `<span class="step"><i>${i + 2}</i>${esc(x)}</span>`).join("")}</span></div>`);
  }
  if (false) {
    parts.push(`<div class="alert ${st.tone === "bad" ? "bad" : st.tone === "warn" ? "warn" : ""}">
      <b>${esc(st.label)}.</b> ${esc(st.why)}.
      <span class="steps">${st.steps.map((s, i) => `<span class="step"><i>${i + 1}</i>${esc(s)}</span>`).join("")}</span>
      ${st.rebuild ? `<button class="mini go" data-act="rebuild" ${RB.state === "running" || RB.pending ? "disabled" : ""}>${RB.state === "running" || RB.pending ? "importing…" : "IMPORT + REGENERATE"}</button>${RB.error ? `<span class="why" style="color:var(--bad)">${esc(RB.error)}</span>` : ""}` : ""}
      <button class="mini" data-act="dismiss">dismiss</button></div>`);
  }
  al.innerHTML = parts.join("") || `<div class="quiet">nothing to act on</div>`;
  wireBanner(); wirePicker();
  fitRows(al, "alerts", 0);
}

/* ------------------------------------------------------------- left */
let LEFT_KEY = null;
function paintLeft() {
  const hd = $("#leftHd"), body = $("#leftBody"); if (!body) return;
  const course = MODE.suggest === "course" && COURSE;
  // 169 polylines are not free: rebuild the map only when what it shows changes, and let the
  // live dot ride on the map that is already there.
  const key = JSON.stringify([!!course, course && COURSE.key, WORLD && Object.keys(WORLD.routes).length, SHOW_OFFMAP, MODE.suggest, TRACE_PICK && TRACE_PICK.ids && TRACE_PICK.ids.length, TRACE_PICK && TRACE_PICK.fore]);
  if (key === LEFT_KEY && body.querySelector("svg")) { addLiveDot(body); return; }
  LEFT_KEY = key; FOLLOW.span = null; FOLLOW.full = null;
  if (course) {
    const nSel = (TRACE_PICK && TRACE_PICK.key === COURSE.key && TRACE_PICK.ids) ? TRACE_PICK.ids.length : Object.keys(COURSE.traces || {}).length;
    // the track OWNS this pane's title once it is identified: its name, its badge, then the facts
    const named = !!COURSE.name;
    const kind = COURSE.rivals ? "RIVALS" : MODE.game === "event" ? "EVENT" : null;
    hd.innerHTML = `<b class="trackname">${esc(named ? COURSE.name : "unnamed course " + COURSE.key)}</b>
      ${kind ? `<span class="chip w">${kind}</span>` : ""}
      <span class="why">${n0(COURSE.len)} m · ${(COURSE.turns || []).length} turns · ${nSel} of ${(COURSE.laps || []).length} laps drawn</span>`;
    const pick = (TRACE_PICK && TRACE_PICK.key === COURSE.key) ? TRACE_PICK : {};
    body.innerHTML = ""; body.append(courseMap(COURSE, { laps: pick.ids, fore: pick.fore }));
    // courseMap() draws its own inline legend (shared with the v1 course page) — lift it into
    // the floating drawer instead of leaving it inline, and unwrap the panel box around the svg
    // so the map itself gets the space both were holding.
    const legendNode = body.querySelector(".legend");
    const legendHTML = legendNode ? legendNode.innerHTML : "";
    if (legendNode) legendNode.remove();
    const svgWrap = body.querySelector(".panel");
    const mapSvg = body.querySelector("svg");
    if (svgWrap && mapSvg && svgWrap !== body) { body.appendChild(mapSvg); svgWrap.remove(); }
    body.insertAdjacentHTML("beforeend", mapDrawerHTML(`<div class="legend">${legendHTML}${followBtn()}</div>${mapFilterBar(COURSE)}`));
    wireTrace(body); wireFollow(body); wireMapDrawer(body); addLiveDot(body);
  } else {
    const n = WORLD ? Object.keys(WORLD.routes).length : 0;
    const off = WORLD ? routeSplit().off.length : 0;
    hd.innerHTML = `World · <span class="why">${WORLD ? (n - off) + " routes on the island" + (off ? " · " + off + " off-map" : "") : "loading"} · free roam${MODE.suggest === "course" ? " (course not located)" : ""}</span>`;
    body.innerHTML = worldMapHTML(); addLiveDot(body);
    const t = body.querySelector("[data-offmap]"); if (t) t.onclick = () => { SHOW_OFFMAP = !SHOW_OFFMAP; VIEW.global.showOffmap = SHOW_OFFMAP; viewSave(); paintLeft(); };
    wireFollow(body); wireMapDrawer(body);
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
  // the viewBox takes the ISLAND's own aspect, so the map fills the pane instead of sitting as a
  // small shape inside a letterbox — the pane's height is the scarce thing, not the map's
  const pad = 12, AR = ((x1 - x0) || 1) / ((z1 - z0) || 1);
  const H = 640, W = Math.max(320, Math.round((H - 2 * pad) * AR)) + 2 * pad;
  const s = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((z1 - z0) || 1));
  const px = (x) => pad + (x - x0) * s, pz = (z) => H - pad - (z - z0) * s;
  const line = (pts, col, w, op) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}" stroke-linejoin="round" points="${pts.map(([x, z]) => px(x).toFixed(0) + "," + pz(z).toFixed(0)).join(" ")}"/>`;
  const routes = on.map(({ r }) => line(r.pts, "#3b4a5c", 1.2, 0.9)).join("")
    + (SHOW_OFFMAP ? off.map(({ id, r }) => `<g><title>Route${id} — off-map circuit, outside the nav mesh, unreachable</title>${line(r.pts, "#c678dd", 1.4, 0.9)}</g>`).join("") : "");
  const mine = Object.values(WORLD.courses || {}).filter((c) => c.path && c.path.length > 3)
    .map((c) => line(c.path, "#00d27a", 1.6, 0.85)).join("");
  const legend = `<span><i style="background:#3b4a5c"></i>every game route</span>
      <span><i style="background:#00d27a"></i>roads you have driven</span><span><i style="background:#e3b341"></i>you, now</span>
      ${followBtn()}
      ${off.length ? `<button class="mini ${SHOW_OFFMAP ? "on" : ""}" data-offmap title="Routes ${off.map((x) => x.id).join(", ")}: complete circuits parked beyond the north coast, outside the nav mesh — cut or developer content, unreachable">${SHOW_OFFMAP ? "hide" : "show"} off-map (${off.length})</button>` : ""}`;
  return `<svg viewBox="0 0 ${W} ${H}" data-x0="${x0}" data-z0="${z0}" data-s="${s}" data-h="${H}" data-w="${W}" data-pad="${pad}"
      style="background:var(--bg);border-radius:6px;width:100%;height:100%">${routes}${mine}<g id="liveDot"></g></svg>
    ${mapDrawerHTML(`<div class="legend">${legend}</div>`)}`;
}

/* ------------------------------------------------- the map that follows you
   A satnav does not hold one scale: it closes in when you slow for a junction, because that is
   when detail earns its pixels, and pulls back on a motorway where the shape of the road is all
   that matters. Same logic here, from data we already have every frame — speed, lateral g, and
   the distance to the next mapped turn. Slow, loaded, or a corner coming: a ~180 m window with
   the turn ids legible. Fast and straight: the whole course. The view is eased so it glides, and
   the bands overlap so it cannot flap between them. */
// DEFERRED, deliberately. Adaptive zoom is the right idea in the wrong context: while you are
// building and testing a car the map's job is orientation, and a window that keeps changing
// scale costs more than it gives. It belongs to COURSE OPTIMIZATION mode — an established track,
// the car already settled, the driver working on line and timing — where the close view is the
// whole point. The mechanism stays, off by default, opt-in from the legend until that mode exists.
const FOLLOW = { on: false, span: null, cx: null, cz: null, raf: 0, full: null };
function followSpan() {
  const f = LIVE.frame;
  if (!f || !f.on || !LIVEPOS) return null;                  // parked or in a menu: the overview
  const mph = f.mph || 0, lat = Math.abs(f.lat || 0);
  let toTurn = Infinity;
  if (COURSE && (COURSE.turns || []).length) {
    for (const t of COURSE.turns) {
      if (t.x == null) continue;
      const d = Math.hypot(t.x - LIVEPOS[0], t.z - LIVEPOS[1]);
      if (d < toTurn) toTurn = d;
    }
  }
  if (lat > 0.55 || mph < 45 || toTurn < 90) return 180;      // in it, or about to be
  if (lat > 0.25 || mph < 90 || toTurn < 260) return 420;     // approaching, or a quick sequence
  return mph > 130 ? 1600 : 900;                              // a straight: shape, not detail
}
function followMap() {
  FOLLOW.raf = 0;
  const body = $("#leftBody"), svg = body && body.querySelector("svg");
  if (!svg || svg.dataset.x0 == null) return;
  const sc = +svg.dataset.s, H = +svg.dataset.h, pad = +svg.dataset.pad;
  const W = +svg.dataset.w || svg.viewBox.baseVal.width || 900;
  if (!FOLLOW.full) FOLLOW.full = { w: W, h: H };
  const want = FOLLOW.on ? followSpan() : null;
  const wantW = want ? Math.min(FOLLOW.full.w, want * sc) : FOLLOW.full.w;
  const cxT = want && LIVEPOS ? pad + (LIVEPOS[0] - +svg.dataset.x0) * sc : FOLLOW.full.w / 2;
  const czT = want && LIVEPOS ? H - pad - (LIVEPOS[1] - +svg.dataset.z0) * sc : FOLLOW.full.h / 2;
  if (FOLLOW.span == null) { FOLLOW.span = FOLLOW.full.w; FOLLOW.cx = FOLLOW.full.w / 2; FOLLOW.cz = FOLLOW.full.h / 2; }
  const k = 0.14;                                             // ~1 s to settle
  FOLLOW.span += (wantW - FOLLOW.span) * k;
  FOLLOW.cx += (cxT - FOLLOW.cx) * k;
  FOLLOW.cz += (czT - FOLLOW.cz) * k;
  const vw = FOLLOW.span, vh = vw * (FOLLOW.full.h / FOLLOW.full.w);
  const vx = Math.max(0, Math.min(FOLLOW.full.w - vw, FOLLOW.cx - vw / 2));
  const vy = Math.max(0, Math.min(FOLLOW.full.h - vh, FOLLOW.cz - vh / 2));
  svg.setAttribute("viewBox", vx.toFixed(1) + " " + vy.toFixed(1) + " " + vw.toFixed(1) + " " + vh.toFixed(1));
  const across = Math.round(vw / sc);
  svg.classList.toggle("close", across < 600);                // detail follows the scale
  const dot = svg.querySelector("#liveDot circle");
  if (dot) dot.setAttribute("r", across < 300 ? 7 : across < 700 ? 5 : 4);
  const note = document.getElementById("mapScale");
  if (note) note.textContent = FOLLOW.on ? (across >= 3000 ? "whole island" : across + " m across") : "fixed";
  if (Math.abs(wantW - FOLLOW.span) > 1 || Math.abs(cxT - FOLLOW.cx) > 1) queueFollow();
}
function queueFollow() { if (!FOLLOW.raf) FOLLOW.raf = requestAnimationFrame(followMap); }
// THE MAP DRAWER — the colour key and (on a course) the trace's own filter chips, folded into
// one floating panel instead of a permanent inline block. The map pane's whole job is the shape
// of the road; a legend and a row of filter buttons were costing it real pixels for furniture
// that is read once and then ignored. Closed by default, remembered per browser.
let MAPDRAWER_OPEN = (() => { try { return localStorage.getItem("fh6MapDrawer") === "1"; } catch (e) { return false; } })();
function mapDrawerHTML(bodyHTML) {
  return `<div class="mapdrawer ${MAPDRAWER_OPEN ? "open" : ""}">
    <button class="mdtoggle" data-mapdrawer title="legend and filters">${MAPDRAWER_OPEN ? "✕ close" : "☰ legend & filters"}</button>
    <div class="mdpanel">${bodyHTML}</div></div>`;
}
function wireMapDrawer(body) {
  const t = body.querySelector("[data-mapdrawer]"); if (!t) return;
  t.onclick = () => { MAPDRAWER_OPEN = !MAPDRAWER_OPEN;
    try { localStorage.setItem("fh6MapDrawer", MAPDRAWER_OPEN ? "1" : "0"); } catch (e) {}
    LEFT_KEY = null; paintLeft(); };
}
const followBtn = () => '<span class="mapscale"><button class="mini ' + (FOLLOW.on ? "on" : "") +
  '" data-follow title="COURSE OPTIMISATION preview: closes in when you slow, load the tyres or approach a turn, and pulls back on the straights. Off by default — it belongs to the skill-and-timing mode, not to building a car.">follow (preview)</button><span id="mapScale" class="why"></span></span>';
function wireFollow(body) {
  const b = body.querySelector("[data-follow]"); if (!b) return;
  b.onclick = () => { FOLLOW.on = !FOLLOW.on; VIEW.global.follow = FOLLOW.on; viewSave();
    b.classList.toggle("on", FOLLOW.on); queueFollow(); };
}

function addLiveDot(body) {
  const svg = body.querySelector("svg"); if (!svg || !LIVEPOS) return;
  let g = svg.querySelector("#liveDot");
  if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.id = "liveDot"; svg.appendChild(g); }
  const x0 = +svg.dataset.x0, z0 = +svg.dataset.z0, s = +svg.dataset.s, H = +svg.dataset.h, pad = +svg.dataset.pad;
  if (!isFinite(s)) return;
  const cx = pad + (LIVEPOS[0] - x0) * s, cy = H - pad - (LIVEPOS[1] - z0) * s;
  const held = !!LIVE.posHeld;      // no driving frame right now: the last real position, dimmed and hollow
  queueFollow();
  g.innerHTML = held
    ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="none" stroke="#e3b341" stroke-width="1.5" opacity=".7"><title>last known position — held through the menu / loading screen</title></circle>`
    : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#e3b341" stroke="#000" stroke-width="1"/>`;
}

// which learned course is the live car on? nearest course whose path passes within 60 m
// Learned courses share road (17 pairs in world.json overlap within 60 m), so the incumbent keeps
// the car while it is within 90 m unless a challenger is nearer by 25 m: a flip a second after a
// reload would orphan the per-course view state that was just restored.
async function locateCourse() {
  if (!LIVEPOS || !WORLD || !WORLD.courses) return;
  const near = (c) => { let bd = Infinity; for (const [x, z] of (c.path || [])) { const d = (x - LIVEPOS[0]) ** 2 + (z - LIVEPOS[1]) ** 2; if (d < bd) bd = d; } return Math.sqrt(bd); };
  let best = null, bd = 60;
  for (const [key, c] of Object.entries(WORLD.courses)) { const d = near(c); if (d < bd) { bd = d; best = key; } }
  if (COURSE_KEY && WORLD.courses[COURSE_KEY]) {
    const dInc = near(WORLD.courses[COURSE_KEY]);
    if (dInc <= 90 && (best == null || bd >= dInc - 25)) best = COURSE_KEY;
  }
  ctxSave({ livePos: LIVEPOS });
  if (best && best !== COURSE_KEY) await onCourseChange(COURSE_KEY, best);
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
function rightTabStore() { return (MODE.suggest === "course" && COURSE) ? vcourse(COURSE.key).rightTab : vg("rightTab", {}); }
function paintRight() {
  const hd = $("#rightHd"), body = $("#rightBody"); if (!body) return;
  if (!liveKnown() && !LIVE.frame) {      // before the first frame the context is not known; do not latch it
    hd.innerHTML = `<span class="tabs2">${rightTabs().map((t) => `<button disabled>${RT_LABEL[t]}</button>`).join("")}</span><span class="why">waiting for telemetry</span>`;
    body.innerHTML = `<div class="why">waiting for the first frame — the pane follows the context once it is known</div>`;
    return;
  }
  const ctx = rightContext();
  if (ctx !== RIGHT_CTX) { RIGHT_CTX = ctx; RIGHT_TAB = rightTabStore()[ctx] || null; }
  const tabs = rightTabs();
  const cur = tabs.includes(RIGHT_TAB) ? RIGHT_TAB : ctx;
  const why = { corners: "every corner as you take it · newest first", stats: "world-wide · ranked by frequency × impact · free roam needs more samples",
                concl: "this course's turns · what to change", build: "what the save gives, what a drive still has to provide" }[cur];
  hd.innerHTML = `<span class="tabs2">${tabs.map((t) => `<button class="${cur === t ? "on" : ""}" data-rt="${t}">${RT_LABEL[t]}</button>`).join("")}</span><span class="why">${esc(why)}</span>`;
  hd.querySelectorAll("[data-rt]").forEach((b) => b.onclick = () => { RIGHT_TAB = b.dataset.rt; rightTabStore()[ctx] = RIGHT_TAB; viewSave(); paintRight(); });
  body.innerHTML = cur === "corners" ? cornersHTML() : cur === "concl" ? conclusionsHTML() : cur === "build" ? buildDataHTML() : statsHTML();
  body.querySelectorAll('[data-act="rebuild"]').forEach((b) => b.onclick = () => requestRebuild("manual"));
  fitRows(body, cur === "corners" ? "corners" : cur === "build" ? "rows" : "findings", 1);
  body.querySelectorAll('[data-pickts]').forEach((b) => b.onclick = () => {
    setPin(CUR.ordinal, b.dataset.pickts); if (COURSE) { vcourse(COURSE.key).filters.container = b.dataset.cont; viewSave(); }
    identify(carOf(CUR.cid), "pinned"); });
  if (cur === "build") fillSinceSave(body);
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
  // bound to the course's own turns GEOMETRICALLY (nearest turn to the apex within 40 m), never by
  // id: course turns and diagnosis turns are two id namespaces. Your passes of the same turn this
  // session rank this one against them; laps on record are the turn's `n`.
  const turnAt = (apex) => { if (!apex || apex[0] == null || !COURSE || !(COURSE.turns || []).length) return null;
    let best = null, bd = 40 * 40; for (const t of COURSE.turns) { if (t.x == null) continue; const d = (t.x - apex[0]) ** 2 + (t.z - apex[1]) ** 2; if (d < bd) { bd = d; best = t; } } return best; };
  const bound = log.map((c) => ({ c, t: turnAt(c.apex) }));
  const rows = bound.slice(-30).reverse().map(({ c, t }, i) => {
    const g = DGRIP[dGripUsi(c.usi)]; const fr = c.first_red;
    // the map is the authority on what a turn IS; a guess from the speed carried must never sit
    // beside the map's word. Off the map the row says so instead of inventing a kind.
    const kind = t ? (t.kind || "unclassified turn") : "corner";
    let turn = "";
    if (t) {
      const mine = bound.filter((b) => b.t === t).map((b) => b.c);
      const apexes = mine.map((x) => x.mph_apex != null ? x.mph_apex : x.mph_min).filter((v) => v != null);
      const best = apexes.length ? Math.max(...apexes) : null, here = c.mph_apex != null ? c.mph_apex : c.mph_min;
      turn = `<span class="why tturn" title="${esc(t.id)} · ${esc(t.kind || "")} · ${t.r != null ? Math.round(t.r) + " m radius" : ""} · ${t.n != null ? t.n + " passes on record" : ""}"><b>${esc(t.id)}</b> ${esc(t.kind || "")}${t.r != null ? " · " + Math.round(t.r) + " m" : ""}${t.n != null ? " · " + t.n + " on record" : ""}${mine.length > 1 ? ` · your ${mine.length} passes: best ${best} — this ${here}` : ""}</span>`;
    }
    return `<div class="crow"><span class="mono">${log.length - i}</span><span>${c.lapn != null ? "lap " + c.lapn : c.ev ? "" : "free"}</span>
      <b>${c.dir === "L" ? "⬅" : "➡"} ${kind}</b>${turn || "<span></span>"}
      <span class="mono">${c.mph_in}→<b>${c.mph_min}</b>→${c.mph_out ?? "—"}</span>
      <span class="mono">${c.lat_g_peak} g</span>
      <span class="mono">${c.brake_on_m != null ? c.brake_on_m + " m" : "—"}</span>
      <span style="color:${g.col === DGRIP.calm.col ? "var(--acc)" : g.col}">${g.word}</span>
      <span class="why">${fr ? `${fr.axle} first · ph ${fr.phase}` : "clean"}${c.hb ? " · handbrake" : ""}${c.drift ? " · drift" : ""}${c.brake_max > 200 ? " · hard brake" : ""}</span></div>`;
  }).join("");
  return head + `<div class="crow hd"><span>#</span><span>lap</span><b>kind</b><span>turn</span><span>in→apex→out</span><span>lat g</span><span>brake</span><span>balance</span><span>first red</span></div>` + rows;
}

// Build data: what the save on disk gives exactly, what the union still has to measure, and the
// steps to ratification — the menu-time pane, because a menu is where the build changes.
// SINCE THE PREVIOUS SAVE — derived from the database's own saves, never from page memory, so a
// reload draws the same block. The pair is the two newest saves of this car in identity.json;
// the physical values come from build/<hw>.json (both, when the pair crosses hardware). Never
// /disk-tune?ts= here: that stores a two-hour pick as a side effect.
const savesOfCar = (o) => (IDENT ? IDENT.builds.filter((b) => b.o === o) : []).slice().sort((a, b) => String(b.saved || "").localeCompare(String(a.saved || "")));
function sinceSaveHTML() {
  const saves = savesOfCar(CUR.ordinal);
  if (saves.length < 2) return saves.length ? `<div class="grp"><div class="gh">Since the previous save</div><div class="why">only one save of this car is held — the next one makes a pair</div></div>` : "";
  const [b, a] = saves;                    // b = newest, a = the one before
  const pa = a.pkey.split(","), pb = b.pkey.split(","), sa = a.skey.split(","), sb = b.skey.split(",");
  const slots = IDENT.slots.filter((_, i) => pa[i] !== pb[i]);
  const sliders = IDENT.sliders.filter((_, i) => sa[i] !== sb[i]);
  const fitted = CUR.disk && CUR.disk.ts, newer = fitted && String(b.c || "").indexOf("_" + fitted) < 0 && saves.every((x) => String(x.c || "").indexOf("_" + fitted) < 0);
  return `<div class="grp" id="sinceSave" data-a="${esc(a.c)}" data-b="${esc(b.c)}"><div class="gh">Since the previous save</div>
    <div class="pair"><b title="${esc(b.name || "unnamed")}">${esc(b.name || "unnamed")}</b><span class="mono">${esc(tsLocal(String(b.c).split("_").pop()))}</span><span class="vs">vs</span><b title="${esc(a.name || "unnamed")}">${esc(a.name || "unnamed")}</b><span class="mono">${esc(tsLocal(String(a.c).split("_").pop()))}</span></div>
    ${newer ? `<div class="frow"><span class="chip w" title="the save on the car is newer than anything the database holds — the import is running or pending">fitted save not held yet</span></div>` : ""}
    <div class="frow diffs">${slots.length ? `<b>${slots.length} part${slots.length === 1 ? "" : "s"}</b> changed: <span class="ssl">${slots.map((x) => `<span data-slot="${esc(x)}">${esc(x.replace(/_/g, " "))}</span>`).join(", ")}</span>` : "same hardware"}${b.kg && a.kg ? ` <span class="why">· ${(b.kg - a.kg) >= 0 ? "+" : ""}${n0(b.kg - a.kg)} kg</span>` : ""}${b.gears !== a.gears ? ` <span class="why">· ${a.gears}→${b.gears} gears</span>` : ""}</div>
    <div class="frow diffs">${sliders.length ? `<b>${sliders.length} slider${sliders.length === 1 ? "" : "s"}</b> moved: <span class="ssl">${sliders.map((x) => `<span data-slider="${esc(x)}">${esc(x.replace(/_/g, " "))}</span>`).join("; ")}</span>` : "sliders unchanged"}</div></div>`;
}
// fills the physical old → new values once both build files are in (memoised through get())
async function fillSinceSave(body) {
  const el = body.querySelector("#sinceSave"); if (!el || !IDENT) return;
  const a = IDENT.builds.find((x) => x.c === el.dataset.a), b = IDENT.builds.find((x) => x.c === el.dataset.b); if (!a || !b) return;
  let ba = null, bb = null;
  try { ba = await get("build/" + a.hw + ".json"); bb = a.hw === b.hw ? ba : await get("build/" + b.hw + ".json"); } catch (e) { return; }
  if (!el.isConnected) return;
  const tune = (bj, c) => (bj.tunes || []).find((t) => t.container === c) || null;
  const ta = tune(ba, a.c), tb = tune(bb, b.c);
  const fmt = (s) => s && s.v != null ? (Math.abs(s.v) >= 100 ? s.v.toFixed(0) : s.v.toFixed(2)) + (s.unit ? " " + s.unit : "") : "—";
  el.querySelectorAll("[data-slider]").forEach((sp) => { const n = sp.dataset.slider;
    const va = ta && (ta.sliders || []).find((x) => x.slider === n), vb = tb && (tb.sliders || []).find((x) => x.slider === n);
    if (va || vb) sp.innerHTML = `${esc(n.replace(/_/g, " "))} <span class="mono">${esc(fmt(va))} → ${esc(fmt(vb))}</span>`; });
  el.querySelectorAll("[data-slot]").forEach((sp) => { const n = sp.dataset.slot;
    const pa = (ba.parts || []).find((x) => x.slot === n), pb = (bb.parts || []).find((x) => x.slot === n);
    if (pa || pb) sp.innerHTML = `${esc(n.replace(/_/g, " "))} <span class="mono">${esc((pa && pa.name) || "stock")} → ${esc((pb && pb.name) || "stock")}</span>`; });
}
// the car's saves, newest first, repeat saves of one setup collapsed; a click pins that save
function saveHistoryHTML() {
  const saves = savesOfCar(CUR.ordinal); if (!saves.length) return "";
  const fitted = CUR.disk && CUR.disk.ts;
  const groups = []; saves.forEach((sv) => { const g = groups.find((x) => x.su === sv.su && x.hw === sv.hw); if (g) { g.n++; return; } groups.push({ su: sv.su, hw: sv.hw, n: 1, sv }); });
  const twins = new Set(atomicTwins().map((x) => x.c));
  return `<div class="grp"><div class="gh">Saves of this car · ${saves.length}</div>${groups.slice(0, 14).map(({ sv, n }) => {
    const ts = String(sv.c).split("_").pop(); const on = fitted && ts === fitted;
    return `<button class="srowb ${on ? "on" : ""}" data-pickts="${esc(ts)}" data-cont="${esc(sv.c)}" title="${esc(sv.c)} · click to pin this save and foreground it on the trace">
      <span class="mono">${esc(tsLocal(ts))}</span><b>${esc(sv.name || "unnamed")}</b><span class="why">${sv.locked ? "downloaded" : "own"}${sv.creator ? " · " + esc(sv.creator) : ""}</span>
      <span class="why">${sv.pi ? "PI " + sv.pi : ""}${sv.kg ? " · " + n0(sv.kg) + " kg" : ""}${sv.gears ? " · " + sv.gears + "-sp" : ""}</span>
      <span class="why">${n > 1 ? "saved " + n + "×" : ""}${on ? " · fitted" : ""}${BASELINE && BASELINE.container === sv.c ? " · baseline" : ""}${twins.has(sv.c) && !on ? " · same hardware" : ""}</span></button>`; }).join("")}</div>`;
}
function buildDataHTML() {
  const st = buildStatus();
  const dl = CUR && CUR.disk && CUR.disk.deliverable;
  const parts = [];
  if (!CUR) return `<div class="why">${esc(MODE.reason || "waiting for a car")}</div>`;
  parts.push(sinceSaveHTML());
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
  parts.push(saveHistoryHTML());
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
  f.innerHTML = `
    <span class="chip ${MODE.suggest === "course" ? "on" : ""}">mode · ${MODE.known ? esc(MODE.suggest) + (MODE.held ? " (held)" : "") : "—, waiting"}</span>
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
// FREEZE. A downloaded tune is locked: you cannot tune or compare it, and the only way forward
// is to rebuild it as your own. With a second copy of the car you clone onto that; with ONE copy
// you freeze the sheet, install your own unlocked tune on the same car and livery, and the frozen
// sheet is what you build back to. Frozen per car in the view store, so it survives the save being
// replaced, the page reloading and the car being put away.
function freezeTarget() {
  if (!CUR || !MATCH || !MATCH.sheet || !CUR.disk) return;
  vcar(CUR.ordinal).frozen = {
    hw: MATCH.sheet.hw, container: (MATCH.build && MATCH.build.c) || null,
    name: (MATCH.build && MATCH.build.name) || (CUR.disk && CUR.disk.name) || "frozen build",
    creator: (MATCH.build && MATCH.build.creator) || null,
    locked: !!(CUR.disk.deliverable && CUR.disk.deliverable.locked),
    ts: CUR.disk.ts, at: Date.now(),
    deliverable: CUR.disk.deliverable || null,
  };
  viewSave(); paintPanel(); openSheet();
}
function frozenOf() { return CUR ? (vcar(CUR.ordinal).frozen || null) : null; }
function thawTarget() { if (CUR) { delete vcar(CUR.ordinal).frozen; viewSave(); paintPanel(); openSheet(); } }

function openSheet() {
  if (!MATCH || !MATCH.sheet) return;
  let el = document.getElementById("fhSheet");
  if (!el) {
    el = document.createElement("div"); el.id = "fhSheet"; el.className = "fsheet";
    document.body.appendChild(el);
  }
  const fz = frozenOf();
  const dl = (fz && fz.deliverable) || (CUR && CUR.disk && CUR.disk.deliverable) || null;
  const name = (fz && fz.name) || (MATCH.build && MATCH.build.name) || (CUR && CUR.disk && CUR.disk.name) || "";
  const key = (MATCH.sheet.hw || "") + "|" + ((fz && fz.ts) || (CUR && CUR.disk && CUR.disk.ts) || "") + "|" + (dl ? 1 : 0) + "|" + (fz ? "F" : "");
  if (el.dataset.k === key && el.querySelector(".fbody")) { el.style.display = "block"; return; }   // same build, same save: just show it
  el.dataset.k = key;
  const st = vg("sheet", {});
  st.open = true; viewSave();
  if (st.x != null) { el.style.left = st.x + "px"; el.style.top = st.y + "px"; }
  el.classList.toggle("min", !!st.min);
  el.innerHTML = `<div class="fbar" id="fbar"><span class="ttl">${fz ? "FROZEN TARGET" : "BUILD SHEET"}</span>
      <span class="nm">${esc(MATCH.sheet.car || "")}${name ? " · " + esc(name) : ""}${fz ? ` <span class="froz">frozen ${esc(new Date(fz.at).toLocaleString())}${fz.creator ? " · by " + esc(fz.creator) : ""} — build back to this</span>` : ""}</span>
      <button data-f="pin" class="${fz ? "on" : ""}" title="${fz ? "this sheet is your frozen target — click to release it" : "keep this sheet as your target: change the car freely and this stays as what to build back to"}">${fz ? "◆ TARGET" : "◇ keep as target"}</button>
      <button data-f="min" title="${st.min ? "expand" : "minimise"}">${st.min ? "▢" : "—"}</button>
      <button data-f="close" title="close">✕</button></div>
    <div class="fbody fhcl"><style>${scopedCloneCss()}</style>${cloneHTML(MATCH.sheet, dl, name)}</div>`;
  el.style.display = "block";
  wireClone({ document: el, localStorage: window.localStorage }, MATCH.sheet);
  el.querySelector('[data-f="close"]').onclick = () => { el.style.display = "none"; st.open = false; save(); };
  const th = el.querySelector('[data-f="pin"]'); if (th) th.onclick = () => (frozenOf() ? thawTarget() : freezeTarget());
  el.querySelector('[data-f="min"]').onclick = () => { st.min = !st.min; el.classList.toggle("min", st.min); save();
    const bt = el.querySelector('[data-f="min"]'); bt.textContent = st.min ? "▢" : "—"; bt.title = st.min ? "expand" : "minimise"; };
  const save = () => { VIEW.global.sheet = st; viewSave(); };
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
