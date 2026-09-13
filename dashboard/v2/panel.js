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
  if (!(c.hi instanceof Set)) c.hi = new Set(c.hi || []);   // laps a click has HIGHLIGHTED (3-state chip: enabled → highlighted → disabled)
  c.touched = Date.now();
  return c;
}

// MODE has three states, not two: unknown until the daemon's first mode event, then free | course |
// decode. Asserting "free" before the daemon spoke was how a reload painted the world map over a
// course you were standing on. `held` = seeded from the previous page, not yet confirmed.
let MODE = { suggest: null, reason: "waiting for the daemon", kind: null, game: null, known: false, held: false };
const liveKnown = () => LIVE.frame != null || LIVE.receiving === false;
let PENDING_FREE = null, FREE_TIMER = 0;
function adoptMode(m) {
  if (!m) return;
  // TEMPORARY COURSE BROWSER holds the view on a hand-picked course while you are parked in free roam. It is
  // released BY CONTEXT: a real course/event suggestion, or actually driving (a live frame, out of the menu),
  // ends the browse and hands control back to normal mode detection. A plain streamed "free" is ignored so the
  // browse doesn't evaporate the moment it starts (free roam streams "free" every second).
  if (TEMP_COURSE) {
    const real = m.suggest === "course" || m.suggest === "event";
    const driving = LIVE.frame && LIVE.frame.on && !LIVE.inMenu;
    if (!real && !driving) { if (m.game !== undefined) MODE.game = m.game; return; }
    TEMP_COURSE = false;
    if (!real) { COURSE = null; COURSE_KEY = null; }   // drove off into free roam → drop the browsed course
    MODE.suggest = null;                                // let the normal path below re-evaluate from scratch
  }
  // COURSE MODE IS STICKY ACROSS A PAUSE (Jett 2026-09-10): a menu is not free roam, and on resume the game
  // briefly reads free-roam before the event/loop re-registers. So a drop from "course" to "free" is DEFERRED
  // and only applied if it PERSISTS past a settle window -- a resume transient is held on the course, but a
  // genuine move to free roam (free still suggested after the window, not in a menu) switches as before.
  if (m.suggest === "free" && MODE.suggest === "course" && COURSE) {
    if (m.game !== undefined) MODE.game = m.game;
    // DON'T RESTART THE SETTLE TIMER ON EVERY STREAMED "free" (bug 2026-09-10): the periodic status
    // event calls adoptMode(d.mode) continuously, so free roam streams "free" every second. Re-arming
    // the 6 s timer each time meant it never elapsed and the dashboard stayed stuck in course mode. Arm
    // it ONCE per free episode; a genuine course/event suggestion (the else branch) clears it, after
    // which the next "free" arms a fresh window.
    if (PENDING_FREE) return;
    PENDING_FREE = m;
    clearTimeout(FREE_TIMER);
    FREE_TIMER = setTimeout(() => {
      if (!PENDING_FREE || LIVE.inMenu || MODE.suggest !== "course") { PENDING_FREE = null; return; }
      const mm = PENDING_FREE; PENDING_FREE = null;
      const prev = { suggest: MODE.suggest, game: MODE.game };
      MODE.suggest = "free"; MODE.reason = mm.reason || MODE.reason; MODE.known = true; MODE.held = false;
      if (mm.game !== undefined) MODE.game = mm.game;
      onModeChange(prev, MODE);
    }, 6000);
    return;
  }
  PENDING_FREE = null; clearTimeout(FREE_TIMER);   // a real course/event/decode suggestion supersedes a pending free
  const prev = { suggest: MODE.suggest, game: MODE.game };
  if (m.game !== undefined) MODE.game = m.game;
  if (m.kind !== undefined) MODE.kind = m.kind;
  if (m.suggest) { MODE.suggest = m.suggest; MODE.reason = m.reason || MODE.reason; MODE.known = true; MODE.held = false; }
  if (prev.suggest !== MODE.suggest || prev.game !== MODE.game) onModeChange(prev, MODE);
}
let WORLD = null, DIAG = null, COURSES = null, COURSE = null, COURSE_KEY = null;
let TEMP_COURSE = false;   // free-roam course-browser overlay: a picked course's full analysis while parked, released by context
let CARMAP = {};   // ordinal -> {name, short} from cars.json, for naming the car that drove a lap
// A lap's cid is "ordinal|..|cyl|pi"; name the car from cars.json (carOf() only resolves LIVE cars).
function carName(cid) { const o = parseInt(String(cid).split("|")[0], 10); return (CARMAP[o] || {}).name || (o ? "ordinal " + o : "unknown car"); }
function carShort(cid) { const o = parseInt(String(cid).split("|")[0], 10); return (CARMAP[o] || {}).short || (o ? "#" + o : "?"); }
let ROUTE = null;   // in a timed event with no learned course: the catalogued route the car is on (locateRouteInEvent)
let LOOP = null;    // the daemon's S/F-crossing identity {name,start} — authoritative in an event, matched to a route START (adoptLoop)
let BROWSE_PICK = null;            // Course Browser: the route id whose location+shape the left world map is zoomed to
let BROWSE_FILTER = "all";         // Course Browser mode chip: all | rivals | race | career | free
let BROWSE_DEV = false;            // Course Browser: show the IE/dev and number-only routes too (off by default)
let BROWSE_SORT = "name";          // Course Browser sort key: name | laps | length | type
let BROWSE_SORT_REV = false;       // reverse the sort (click the active sort button again)
let COURSE_MATCH = null;           // { dist, secondKey, secondDist } from the last locateCourse() — how sure the current course is
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
  // TRANSPORT BEFORE BUILD. A failed /disk-tune fetch sets diskErr AND leaves CUR.disk null (live.js:233),
  // so while this test sat below `!disk` it could never fire: an unreachable daemon reported "no save on
  // disk for this car" — a claim about the save file, made when nothing about the save file was known.
  // "offline" is a precondition like "no car", not one of the build statuses in docs/dashboard-states.md
  // §3, so it belongs here with them and not among the rows of that table.
  if (CUR.diskErr) return { key: "offline", label: "save not read", tone: "dim",
    why: "the daemon could not be reached, so nothing is known about the save — absence of signal is not evidence",
    steps: ["start the daemon from the worktree: python scripts/telemetry/fh6_live_daemon.py", "then REREAD BUILD"] };
  if (!disk) return { key: "unknown", label: "unknown / unsaved", tone: "bad",
    why: "no save on disk for this car", steps: ["save the setup in-game with a name", "the save is read the moment a menu closes"] };
  if (drift) return { key: "unknown", label: "unknown / unsaved", tone: "bad",
    why: "live PI " + LIVE_PI + " matches no save; the hardware changed and has not been saved",
    steps: ["save the setup with a name to hold it", "then it can be identified, cloned and compared"] };
  const locked = !!(disk.tune && disk.tune.locked);
  const hwOk = !!(MATCH && MATCH.hw && MATCH.hw.length);
  const tuneOk = !!(MATCH && MATCH.exact && MATCH.exact.length);
  const ambiguous = q.level !== "ok";
  if (!hwOk) return { key: "unknown", label: locked ? "identified · importing for history" : "new build on disk", tone: "warn",
    // The save IS the equipped build by construction and its parts/sliders are already decoded in the
    // deliverable — the build sheet renders now. What lags is only the DATABASE holding it for history/A-B,
    // and the daemon now fires that import itself on the save. So a downloaded tune is identified, not "not held".
    why: (RB.state === "running" || RB.pending) ? "identified from the save; the database is catching up — importing it now"
       : locked ? "identified from the save — the history import runs by itself (the daemon fires it on the save)"
       : "a save written since the last import — the import runs by itself",
    // A LOCKED (downloaded) save imports itself — the daemon fires the history import on the save, so there
    // is no manual "import" step; an empty step list keeps the ticker (panel.js:1162) and the ratification
    // block (panel.js:2026) from telling the user to click a button that does not apply. A local unheld
    // save still offers the one-button import. rebuild:true stays for both — it only gates the two locked-
    // aware gate branches (panel.js:982 !locked, panel.js:992 locked), never a bare IMPORT button.
    steps: locked ? [] : ["import the save and regenerate the dashboard data — one button, about 10 s"], rebuild: true };
  if (locked) return { key: "downloaded", label: "downloaded / locked", tone: "warn",
    why: frozenOf() ? "someone else's build, frozen as your target — install your own tune on this car and build back to it"
                    // 2026-09-03 (Jett flagged this as "crazy" -- flatly contradicted by the Clone Plan
                    // feature two lines below, which only works because this is false): the LOCK blocks
                    // editing a slider in-game; it never blocked reading one. Every slider decodes from
                    // the save file's own bytes regardless of lock status -- that's how a locked/downloaded
                    // build gets cloned at all.
                    : "someone else's build — every part and slider decodes cleanly from the save; only editing it in-game is locked",
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
    <div id="alerts"></div>
    <div class="idbar" id="idbar" hidden></div>
    <div class="trace" id="trace"></div>
    <div class="coursefilter" id="coursefilter" hidden></div>
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
  DOCK_SPAN = vg("dockSpan", 600); FOLLOW.on = vg("follow", false) === true;
  BROWSE_FILTER = vg("browseFilter", "all"); BROWSE_PICK = vg("browsePick", null); BROWSE_DEV = vg("browseDev", false);
  BROWSE_SORT = vg("browseSort", "name"); BROWSE_SORT_REV = vg("browseSortRev", false) === true;
  TRACE_MODE = vg("traceMode", TRACE_MODE); TRACE_ALL = !!vg("traceAll", TRACE_ALL); RACING_ONLY = vg("racingOnly", RACING_ONLY) !== false;
  const [w, d, c, cars] = await Promise.all([get("world.json"), get("diag.json"), get("courses.json"), get("cars.json").catch(() => null)]);
  WORLD = w; DIAG = d; COURSES = c;
  // ordinal -> car name, so a lap (its cid carries the ordinal) can be attributed to a car in the
  // turn leaderboard and the class stats. short = model without the year, for the dense table cell.
  const carRows = Array.isArray(cars) ? cars : (cars && cars.cars) || [];
  carRows.forEach((cr) => { if (cr && cr.ordinal != null) CARMAP[cr.ordinal] = { name: cr.name, short: shedName(cr.model || String(cr.name || "").replace(/^(19|20)\d\d\s+/, ""), 15) }; });
  // LEVEL OF DETAIL (2026-09-07, Jett: "point-to-point data ... paths should scale up gracefully on all
  // zoom"). world.json now ships the FULL native centre-line (~4 m, 0.1 m precision). But animating the SVG
  // viewBox re-rasterises EVERY drawn point each frame, and 275 k points measured ~20 fps at 4K -- so we can't
  // draw all of it dense. The road you actually zoom INTO is one route, though: draw the faint background
  // (all routes grey, driven courses green) and do all per-frame matching from a strided ~16 m copy (r._lo /
  // c._lo -- imperceptible at island scale, and point-to-segment already locates at ~16 m), and draw only the
  // FOCUS route (the picked highlight / the event route) from the dense r.pts -- ~1 k points, trivial to
  // raster. Fidelity goes where the eye is; the animation stays cheap. Derived ONCE here.
  if (WORLD && WORLD.routes) for (const r of Object.values(WORLD.routes)) r._lo = strideLo(r.pts, 4);
  if (WORLD && WORLD.courses) for (const c of Object.values(WORLD.courses)) c._lo = strideLo(c.path, 4);
  // the live-context seed: where the car was, on which course, in which mode — held, not live
  if (!LIVE.frame && ctxFresh(10 * 60e3)) {
    if (CTX.livePos && LIVEPOS == null) LIVEPOS = CTX.livePos;
    if (CTX.mode && CTX.mode.suggest && !MODE.known) { MODE.suggest = CTX.mode.suggest; MODE.game = CTX.mode.game || null; MODE.reason = "held from the previous page"; MODE.known = true; MODE.held = true; }
    if (CTX.courseKey && !COURSE) {
      try { COURSE = await get(courseFile(CTX.courseKey)); COURSE_KEY = CTX.courseKey; restoreCourseView(COURSE_KEY); } catch (e) { COURSE = null; COURSE_KEY = null; }
    }
  }
  // THE MISSING THIRD HOLD (2026-09-03). Mode and course were already restored above from the
  // persisted context; the car never was -- CUR is set ONLY by a live SSE frame naming a car
  // (identify(), below), so a fresh tab opened while the game sits in a menu (no car in the frame
  // at all) showed a genuinely blank page: no header, no map, nothing to hold, even though the
  // daemon's own /disk-tune already knows the last driven car (it just didn't fall back to it
  // either, until the same day's fix). One request, reusing identify() rather than duplicating what
  // it does with a disk-tune payload.
  if (!CUR) {
    try {
      const dt = await fetch(DAEMON + "/disk-tune").then((r) => r.json());
      if (dt && dt.available && dt.ordinal != null) {
        await identify({ id: String(dt.ordinal), ordinal: dt.ordinal, name: dt.name }, "held from the previous page");
      }
    } catch (e) { /* no daemon yet, or genuinely no car ever seen -- the existing "waiting for a car" state stands */ }
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
    if (!c) {
      // The new course's file is not built yet (a course driven since the last rebuild). Do NOT keep showing
      // the OLD course -- that is how a new PvP course read as the previous one. Drop the stale course and
      // return false so the caller can fall back to the catalogued route (its map still draws from world.json).
      if (COURSE_KEY && COURSE_KEY !== key) { COURSE = null; COURSE_KEY = null; paintLeft(); paintTrace(); paintRight(); paintFooter(); }
      return false;
    }
    COURSE = c; COURSE_KEY = key;
  }
  if (COURSE_KEY) restoreCourseView(COURSE_KEY);
  ctxSave({ courseKey: COURSE_KEY, livePos: LIVEPOS });
  paintLeft(); paintTrace(); paintRight(); paintFooter();
  return true;
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
// THE PAUSED LANGUAGE — one vocabulary for "the source is paused, so this is too", used
// everywhere that applies: the anchored line (below) and any pane that freezes with it
// (paintHeld, called from paintPanel). Amber/⏸. The held MAP MARKER is the exception: it is grey
// (addLiveDot), because a marker that means "you" may not share a colour with a grip state, and
// amber is impact (Jett 2026-09-11).
function heldSince() {
  return MENU_SINCE ? "since " + new Date(MENU_SINCE).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}
function paintHeld() {
  const held = !!LIVE.inMenu;
  [$("#trace"), $("#dock")].forEach((el) => { if (el) el.classList.toggle("held", held); });
}
// STATUS HISTORY (Jett 2026-09-07): a rolling, persisted record of the status line's changes, so the "database
// up to date" indicator carries WHEN each state happened and what it was. Enumerated in a hover dropdown on the
// status display. Deduped on the label (the line only logs on a real transition) and capped; survives reloads.
let STATUS_LOG = (() => { try { return JSON.parse(localStorage.getItem("fh6StatusLog")) || []; } catch (e) { return []; } })();
function logStatus(label, tone) {
  if (!label) return;
  if (STATUS_LOG.length && STATUS_LOG[0].label === label) return;   // no change -> nothing to record
  STATUS_LOG.unshift({ t: Date.now(), label, tone: tone || "dim" });
  STATUS_LOG = STATUS_LOG.slice(0, 50);
  try { localStorage.setItem("fh6StatusLog", JSON.stringify(STATUS_LOG)); } catch (e) {}
}
function statusLogHTML() {
  if (!STATUS_LOG.length) return "";
  const rows = STATUS_LOG.map((e) => {
    const d = new Date(e.t);
    const when = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const day = d.toLocaleDateString([], { month: "short", day: "numeric" });
    return `<div class="sle sle-${esc(e.tone)}"><span class="slt">${day} ${when}</span><span class="sll">${esc(e.label)}</span></div>`;
  }).join("");
  return `<div class="statlog"><div class="statlog-h">recent status · newest first</div>${rows}</div>`;
}
// the lab-services controls (start/stop/restart the daemon, dashboard, rebuild) now live in the TOP status
// bar as a hover dropdown off the services strip (Jett 2026-09-11) — no longer a right-pane tab.
function servicesPop() {
  return `<div class="svcpop"><div class="svcpop-h">lab services · start · stop · restart</div>${servicesHTML()}</div>`;
}
function lastAction() {
  const el = document.getElementById("lastact"); if (!el) return;
  let tone = "dim", txt = "", when = "";
  if (LIVE.inMenu) { tone = "warn"; txt = "⏸ paused — in a menu " + heldSince(); }
  else if (RB.state === "running" || RB.pending) { tone = "warn"; txt = "importing the save into the database"; }
  else if (RR.busy) { tone = "warn"; txt = "re-reading the save from disk"; }
  else if (CHANGE) {
    const n = (CHANGE.sliders || []).length, p = (CHANGE.slots || []).length;
    tone = CHANGE.kind === "hardware" ? "warn" : CHANGE.kind === "tune" ? "blue" : "ok";
    const tnm = (CUR && CUR.disk && CUR.disk.tune_name) || "";
    txt = (CHANGE.saved ? "new save read" + (tnm ? " · “" + tnm + "”" : "") : CHANGE.kind === "hardware" ? "hardware changed, not saved" : "sliders moved, not saved")
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
    ${(() => { const sp = RB.last && RB.last.sessions_pending;
      return sp == null ? "" : dot(sp === 0, "sessions", sp === 0 ? "caught up" : sp + " unimported",
        sp === 0 ? "every driving session on disk is imported into the database"
                 : sp + " session" + (sp === 1 ? "" : "s") + " on disk have not been imported yet — corners/laps from them are not queryable until they are"); })()}
    <button type="button" class="svccaret" aria-label="lab services — start, stop, restart" title="lab services — start · stop · restart">⚙</button>${servicesPop()}
  </span>`;
  if (!LIVE.inMenu) logStatus(txt, tone);   // record the transition (skip the transient in-menu pause, which ticks a duration)
  // DISPLAY prefix (not logged): where the drive is + the lap, so the top bar reads "on course · lap 3 · <freeze>"
  // (spec line 24). Only in a steady drive state — not while paused/importing, which own the whole line.
  const loc = LIVE.inMenu ? null : (RB.state === "running" || RB.pending || RR.busy) ? null
    : MODE.suggest === "course" ? "on course" : MODE.suggest === "free" ? "free roam" : null;
  const lapn = lapNo(LIVE.frame);
  const dispTxt = (loc ? loc + (lapn != null ? " · lap " + lapn : "") + " · " : "") + txt;
  el.dataset.tone = tone;
  el.innerHTML = `<b>${esc(dispTxt)}<i class="statcaret" aria-hidden="true">▾</i></b>${when ? `<span class="when">${esc(when)}</span>` : ""}${svc}${statusLogHTML()}`;
  // the services dropdown's controls (moved here from the right-pane tab): wire start/stop/restart, and read
  // the process state the first time the strip is hovered (so it isn't fetched until someone opens it).
  el.querySelectorAll("[data-svcact]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); svcAct(b.dataset.svc, b.dataset.svcact); });
  el.querySelectorAll("[data-svcrefresh]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); svcRefresh(); });
  const svcs = el.querySelector(".svcs");
  if (svcs) svcs.addEventListener("mouseenter", () => { if (!SVC.list.length && !SVC.busy && !SVC.err) svcRefresh(); });
}

function paintPanel() {
  lastAction();
  paintHeader(); paintIdBar(); paintTrace(); paintCourseFilter(); paintBanner(); paintLeft(); paintRight(); paintDock(); paintFooter();
  paintHeld();
}
// THE INLINE CAR-IDENTITY BAR (redesign spec lines 112-120): a slim full-width strip shown ONLY in course
// mode, directly above the speed trace — the PI badge fused with the number, the car, a divider, the matched
// build+tune, an "identified" pill, the plain-English match note, and a right-aligned Build Sheet button.
// It reuses piBadge()/classPill() and the resolutionState()/gateStrip() data the header already computes, so
// identity is stated the same way in both places (no second source of truth).
function paintIdBar() {
  const el = $("#idbar"); if (!el) return;
  const on = MODE.suggest === "course" && COURSE && CUR;
  el.hidden = !on;
  if (!on) { el.innerHTML = ""; return; }
  const st = buildStatus(), rs = resolutionState(), g = gateStrip(st, rs);
  const m = MATCH && MATCH.build;
  const carNm = carName(CUR.cid) || (CUR.disk && CUR.disk.car) || "unknown car";
  const tune = m ? (m.name || m.tune_name || "") : (CUR.disk && CUR.disk.tune_name) || "";
  const reach = !!m;
  const tone = g.tone;   // acc = identified, warn = ambiguous/importing, bad = nothing on disk
  el.dataset.tone = tone;
  el.innerHTML = `
    <span class="idb-pi">${piBadge(CUR.cls, CUR.pi)}</span>
    <span class="idb-car" title="${esc(carNm)}">${esc(carNm)}</span>
    <span class="idb-sep">│</span>
    ${tune ? `<span class="idb-build" title="${esc(tune)}">${rs.key === "resolved" ? `<b class="tick">✓</b> ` : ""}${esc(shedName(tune, 32))}</span>` : `<span class="idb-build empty">${g.spec ? "event spec tune — temporary" : CUR.disk ? "unnamed save" : "no save on disk"}</span>`}
    <span class="idb-chip chip ${tone === "acc" ? "on" : g.spec ? "spec" : tone === "bad" ? "b" : "w"}">${esc((g.ident || "").replace(/^[^A-Za-z]+/, ""))}</span>
    <span class="idb-hint why" title="${esc(rs.hint || "")}">${esc(rs.hint || g.detail || "")}</span>
    ${g.sheet === "filled" ? `<button class="idb-sheet" data-act="sheet">🔓 Build sheet ▸</button>`
      : (g.sheet === "outline" && reach) ? `<button class="idb-sheet outline" data-act="sheet">🔓 Build sheet ▸</button>`
      : `<span class="idb-sheet dead">🔒 Build sheet</span>`}`;
  const btn = el.querySelector("[data-act=sheet]"); if (btn) btn.onclick = () => { const b = $("#btnSheet"); if (b) b.click(); };
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
// THE ONE GRIP PALETTE (D1/D2, Jett 2026-09-11; docs/design-language.md §3.2, §4.2). Fills -- bars, cells, the
// swatch of a fill -- use `col`; lines and text use `ink`. Calm's #2a313c fill would vanish as a line on the
// #0d1117 page, so calm's ink is the car's class colour when known (gripInk), else #8b97a7 -- never green, which
// means fastest / success. The words are these; v1's axle wording rides in `tip` for tooltips. This replaced
// TRACE_GRIP / TRACE_WORD and app.js GRIP (the app's status colours standing in for grip).
const DGRIP = {
  calm:   { col: "#2a313c", ink: "#8b97a7", word: "within grip",        tip: "all four tyres within grip" },
  front:  { col: "#2f81f7", ink: "#2f81f7", word: "understeer",         tip: "the fronts past the limit" },
  rear:   { col: "#e5414e", ink: "#e5414e", word: "oversteer",          tip: "the rears past the limit" },
  both:   { col: "#a371f7", ink: "#a371f7", word: "drift / overdriven", tip: "all four tyres past the limit" },
  impact: { col: "#e3b341", ink: "#e3b341", word: "impact / jolt",      tip: "a hit: over 3 g lateral, or a smashable" },
  off:    { col: "#0b0e12", ink: "#8b97a7", word: "not driving",        tip: "no driving frame" },
};
const GSTATE = ["calm", "front", "rear", "both", "impact"];   // grip code 0-4 -> DGRIP key
const gripOf = (k) => DGRIP[typeof k === "number" ? GSTATE[k] : k] || DGRIP.calm;
// THE PEDAL PAINT (Jett 2026-09-11: "indicate brake and throttle measurements throughout the run"). What the
// driver's feet did at each point -- throttle in greens and brake in reds (the telemetry convention), each in
// three bands by how hard, coast grey, both pedals at once pale violet. Points carry throttle / brake as 0-100 %
// at [6] / [7] (recorded traces, schema 6) -- a lap analysed before schema 6 has none and reads "no pedal data".
// Its own axis: grip and speed keep their palettes, and every surface's legend names which one a line wears.
const PEDAL = {
  none:  { col: "#2e3642", word: "no pedal data" },
  coast: { col: "#8b97a7", word: "coast" },
  thr1:  { col: "#2f7d5a", word: "throttle under 40%", group: "throttle, light → full" },
  thr2:  { col: "#3fb67c", word: "throttle 40–90%" },
  thr3:  { col: "#6af2a8", word: "throttle 90%+" },
  brk1:  { col: "#8e3b2c", word: "brake under 40%", group: "brake, light → full" },
  brk2:  { col: "#d9542f", word: "brake 40–90%" },
  brk3:  { col: "#ff8a5c", word: "brake 90%+" },
  both:  { col: "#e3c8ff", word: "both pedals" },
};
const PEDAL_KEYS = ["none", "coast", "thr1", "thr2", "thr3", "brk1", "brk2", "brk3", "both"];
// throttle / brake % -> PEDAL_KEYS index; a pedal counts as pressed from 10%
function pedalKey(thr, brk) {
  if (thr == null && brk == null) return 0;
  const t = +thr || 0, b = +brk || 0;
  if (b >= 10 && t >= 10) return 8;
  if (b >= 10) return b >= 90 ? 7 : b >= 40 ? 6 : 5;
  if (t >= 10) return t >= 90 ? 4 : t >= 40 ? 3 : 2;
  return 1;
}
const pedalCol = (k) => PEDAL[PEDAL_KEYS[k]].col;
// the pedal key for any legend: coast · throttle ramp · brake ramp · both pedals
function pedalSwatches() {
  return [["coast"], ["thr1", "thr2", "thr3"], ["brk1", "brk2", "brk3"], ["both"]].map((ks) =>
    `<span class="ped-sw" title="${esc(ks.map((k) => PEDAL[k].word).join(" · "))}">${ks.map((k) => `<i style="background:${PEDAL[k].col}"></i>`).join("")}${esc(PEDAL[ks[0]].group || PEDAL[ks[0]].word)}</span>`).join("");
}
// the grip key for a legend: the 5 DGRIP states, each swatch the INK the grip lines actually paint (calm = grey)
function gripSwatches() {
  return GSTATE.map((k) => `<span class="ped-sw" title="${esc(DGRIP[k].tip)}"><i style="background:${DGRIP[k].ink}"></i>${esc(DGRIP[k].word)}</span>`).join("");
}
// the legacy key the v1 dashboard also reads knows only its own modes; pedals persists in the v2 view store alone
function saveTraceMode() { VIEW.global.traceMode = TRACE_MODE; viewSave(); if (TRACE_MODE !== "pedals") { try { localStorage.setItem("fh6SegMode", TRACE_MODE); } catch (e) {} } }
// PI-class colours, matching the .pib-<class> badges (styles.css). A context (non-foregrounded)
// speed-trace line is painted by the PI CLASS of the build that drove it, so PI-vs-speed reads at a
// glance across laps from different-class builds (Jett 2026-09-07). Unknown class falls back to --dim.
// ONE SOURCE (docs/design-language.md, decision D5, 2026-09-11): the class colours live ONLY as CSS custom
// properties (--pc-d ... --pc-x in styles.css :root). This map is READ from them -- never a second copy. It
// resolves to real colour strings, not var() references, because the traces paint SVG stroke attributes and
// var() does not resolve there. Read lazily, and cached only once all eight have resolved.
const PI_CLASS_KEYS = ["D", "C", "B", "A", "S1", "S2", "R", "X"];
let PI_COLORS = null;
function piColors() {
  if (PI_COLORS) return PI_COLORS;
  const cs = getComputedStyle(document.documentElement), m = {};
  PI_CLASS_KEYS.forEach((k) => { const v = cs.getPropertyValue("--pc-" + k.toLowerCase()).trim(); if (v) m[k] = v; });
  if (Object.keys(m).length === PI_CLASS_KEYS.length) PI_COLORS = m;
  return m;
}
function piColor(cls) { return piColors()[String(cls || "").toUpperCase()] || "var(--dim)"; }
// FH6 PI class bands -- the game's own ref_class table, confirmed by telemetry (CarClass and CarPI are
// reported independently): D <=400, C <=500, B <=600, A <=700, S1 <=800, S2 <=900. The bands this replaced
// were FH5's (D<=500 ... S2<=998), one class high: a PI 700 build sheet read "B" (design-language.md
// 2026-09-11). Derives the class LETTER from a PI so a badge is never an impossible pair like "S1 700".
// TOP BAND, deliberately unresolved (decision D4): the game has R = 901-998 and X = 999, but the lab's
// class maps (analyze_session, fh6_live_daemon, build_web) still label class 6 as X, so above 900 this
// keeps returning "X" to agree with the stored data until the R/X research settles it.
function classForPi(p) { return p == null ? null : p <= 400 ? "D" : p <= 500 ? "C" : p <= 600 ? "B" : p <= 700 ? "A" : p <= 800 ? "S1" : p <= 900 ? "S2" : "X"; }
// A turn's DISPLAY label is its clean route-order number (T1..Tn from `seq`), NOT its stable id
// (T<round(arc)>, e.g. T654) -- that arc-anchored id is the internal key that survives re-derivation
// (fh6_turns.stable_turn_id); the user only ever sees the tidy running number. Falls back to the raw
// id/turn_id for any pre-seq data. See docs/turn-consistency-research-2026-09-07.md.
function turnLabel(t) {
  if (!t) return "T?";
  if (t.seq != null) return "T" + t.seq;
  const raw = t.id != null ? t.id : t.turn_id;
  return raw != null ? String(raw) : "T?";
}
const GRAD = ["#2f81f7", "#3fb6c8", "#6fd08c", "#d7d264", "#e8a13c", "#e5414e"];
const TRACE_DIMS = [["class", "class"], ["dt", "drive"], ["container", "tune"], ["solo", "traffic"], ["bid", "build"]];
const PRESETS = [["all", "all"], ["class", "this class"], ["car", "this car"], ["build", "this build"], ["hw", "same hardware"], ["tune", "this tune"]];
// the selection and the filters live in the view store per course (vcourse); these two are the
// page-wide paint choices, mirrored to the legacy keys the v1 dashboard still reads
let TRACE_MODE = (() => { try { return localStorage.getItem("fh6SegMode") || "grip"; } catch (e) { return "grip"; } })();
let TRACE_ALL = (() => { try { return localStorage.getItem("fh6PaintAll") === "1"; } catch (e) { return false; } })();
// RACING-ONLY (Jett 2026-09-10): default ON. Hide non-competitive laps -- cruise/drift runs far off the
// class pace, rewound laps (invalid clock), and over/under-covered laps -- so the speed trace compares
// like with like. There is no stored race flag; "racing" is inferred from pace vs the class's own best.
let RACING_ONLY = (() => { try { return localStorage.getItem("fh6RacingOnly") !== "0"; } catch (e) { return true; } })();
let TRACE_KEY = null;
let TRACE_PICK = null;
let TRACE_FIT = 0;
let TRACE_CLS_HI = null;   // click a PI-class swatch in the speed-trace legend to spotlight that class's laps
// THE 5-PHASE TURN LANGUAGE (Jett 2026-09-10) — the WHERE axis of a corner, coloured the same on
// the map overlay and in the turn-detail card. Matches the offline analyzer's turn-phases render
// (gen_segments.py): braking and straight/crest are the connectors, turn-in→mid→exit the corner.
const SEG_ORDER = ["braking", "turn_in", "mid", "exit", "straight"];
const SEG_COL = { braking: "#6c8cf0", turn_in: "#45c8b0", mid: "#f0b429", exit: "#63d19e", straight: "#8a95a5" };
// "Entry", not "Turn-in" (Jett 2026-09-11, design-language.md D6): one word for the segment the diagnosis
// symptoms already call "entry". Display only -- the data key stays turn_in everywhere.
const SEG_LABEL = { braking: "Braking", turn_in: "Entry", mid: "Mid-corner", exit: "Exit", straight: "Straight / crest" };
// which course turn (by display seq) is selected for the map highlight + right-pane stats; scoped to
// a course key so a stale pick from another course is simply ignored, never mis-applied.
let TURN_PICK = null;
let LB_PICK = null;   // the leaderboard-selected lap id (a trace to isolate on the corner map), reset per turn
function turnPickSeq() { return (TURN_PICK && COURSE && TURN_PICK.key === COURSE.key) ? TURN_PICK.seq : null; }
function pickTurn(seq) {
  const s = seq == null ? null : +seq;
  const cur = turnPickSeq();
  TURN_PICK = (s == null || s === cur) ? null : { key: COURSE && COURSE.key, seq: s };   // click the same turn to clear
  LB_PICK = null;   // a new turn -> drop any isolated-lap selection
  // selecting a turn is a request to SEE it: bring the right pane to Turn analysis (its full stats).
  if (TURN_PICK && MODE.suggest === "course" && COURSE) { RIGHT_TAB = "matrix"; try { rightTabStore()[rightContext()] = "matrix"; } catch (e) {} }
  LEFT_KEY = null; TRACE_KEY = null; paintLeft(); paintTrace(); paintRight();   // trace repaints too: the selected turn's span band + tick highlight
}
// LAP ISOLATION: clicking a leaderboard row picks a lap; its trace on the corner map is lifted and every other
// lap's trace is dimmed. Click the same row again to clear. Toggled in place (no repaint) + re-applied after one.
function pickLap(id) {
  LB_PICK = (LB_PICK === id || id == null) ? null : String(id);
  applyLapPick();
}
function applyLapPick() {
  const rb = $("#rightBody");
  if (rb) {
    const svg = rb.querySelector(".tstat-cornersvg");
    if (svg) { svg.classList.toggle("has-sel", LB_PICK != null);
      svg.querySelectorAll(".cm-lap").forEach((g) => g.classList.toggle("sel", LB_PICK != null && g.dataset.lap === LB_PICK)); }
    rb.querySelectorAll(".tlb-row[data-lap]").forEach((r) => r.classList.toggle("lbsel", LB_PICK != null && r.dataset.lap === LB_PICK));
  }
  // MIRROR THE PICK ONTO THE LEFT COURSE MAP (Jett 2026-09-11): lift the same lap's whole-course trace and
  // dim the rest, so the isolated lap reads across BOTH the course map and the single-corner map. The left
  // map persists across right-pane repaints, so toggling classes in place (no paintLeft) is enough.
  const lb = $("#leftBody"), lsvg = lb && lb.querySelector(".cmap svg");
  if (lsvg) { lsvg.classList.toggle("has-lapsel", LB_PICK != null);
    lsvg.querySelectorAll(".cmap-lap").forEach((g) => g.classList.toggle("sel", LB_PICK != null && g.dataset.lap === LB_PICK)); }
}
// cross-highlight one phase across the left map + rail and the right table (shared data-phase spine):
// emphasise the matching part, dim the rest; null clears.
function hiPhase(name) {
  const lb = $("#leftBody");
  if (lb) lb.querySelectorAll("[data-phase]").forEach((e) => {
    const on = name == null || e.dataset.phase === name;
    e.style.opacity = on ? "" : "0.2";
    if (e.tagName.toLowerCase() === "polyline") e.style.strokeWidth = (name && e.dataset.phase === name) ? "13" : "";
  });
  const rb = $("#rightBody");
  if (rb) rb.querySelectorAll("tr[data-phase]").forEach((r) => r.classList.toggle("hi", name != null && r.dataset.phase === name));
}
// step to the previous / next turn by display seq (wraps), for the ‹ › walkthrough
function stepTurn(dir) {
  const seqs = (COURSE && COURSE.turns || []).map((t) => t.seq).filter((s) => s != null).sort((a, b) => a - b);
  if (!seqs.length) return;
  const cur = turnPickSeq();
  const i = cur == null ? -1 : seqs.indexOf(cur);
  const nxt = i < 0 ? seqs[0] : seqs[(i + (dir < 0 ? -1 : 1) + seqs.length) % seqs.length];
  TURN_PICK = { key: COURSE && COURSE.key, seq: nxt };
  LB_PICK = null;
  LEFT_KEY = null; TRACE_KEY = null; paintLeft(); paintTrace(); paintRight();
}
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
// ONE LAP-NUMBER CONVENTION (handoff §5.2): 1-based, as the game shows it, on every surface. The frame's
// LapNumber is 0-based (the hero read "EVENT · LAP 0" while the Current lap tab read "lap 1" for the same lap);
// corner events are already 1-based (the daemon adds 1). Any lap number drawn from a frame goes through this.
const lapNo = (f) => (f && f.ev && f.lapn != null ? (f.lapn | 0) + 1 : null);
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
  const key = course ? JSON.stringify(["c", COURSE.key, vc0.filters, vc0.preset, vc0.ctx, [...(vc0.hidden || [])], [...(vc0.hi || [])], TRACE_MODE, TRACE_ALL, TRACE_CLS_HI, RACING_ONLY, CUR && CUR.cid, liveClass(), MODE.game, el.clientWidth, liveLapSig(), turnPickSeq()])
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
// Split a trace wherever consecutive points don't sit next to each other in arc, so the line never
// draws a straight streak across the gap: a BACKWARD step (< -30 m) is the start/finish seam a re-anchored
// loop wraps at; a big FORWARD step (> 60 m) is a coverage gap (a section the lap didn't record). Normal
// samples are a few metres apart, so neither threshold trips on a continuous lap.
function arcRuns(pts) {
  if (pts.length < 2) return pts.length ? [pts] : [];
  const runs = []; let run = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1][0], b = pts[i][0];
    if (a != null && b != null && (b < a - 30 || b > a + 60)) { runs.push(run); run = [pts[i]]; }
    else run.push(pts[i]);
  }
  runs.push(run); return runs;
}
// the ink of a grip state for a LINE or TEXT (code 0-4 or DGRIP key): within grip wears the PI class colour when
// known, else calm's grey ink; the problem states keep their diagnostic colours
function gripInk(k, baseCol) {
  const g = gripOf(k);
  if (g !== DGRIP.calm) return g.ink;
  return (baseCol && baseCol !== "var(--dim)" && !inkClashes(baseCol)) ? baseCol : DGRIP.calm.ink;
}
// A CLASS COLOUR THAT READS AS A GRIP STATE CANNOT MEAN "WITHIN GRIP" (2026-09-11). Measured CIE76 ΔE to the
// nearest grip ink: A 0.0 (it IS oversteer red), S1 5.1 (drift violet), C 13.9 and B 29.8 (impact amber),
// S2 15.0 (understeer blue); R 45.7, D 57.0, X 72.2 stay clear. Under 30 the line would be misread as a
// problem state, so calm falls back to its grey ink for those classes.
const INK_CLASH_DE = 30, _inkClash = {};
function inkClashes(col) {
  if (col in _inkClash) return _inkClash[col];
  const p = colLab(col);
  return (_inkClash[col] = !!p && GSTATE.slice(1).some((k) => { const q = colLab(DGRIP[k].ink); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < INK_CLASH_DE; }));
}
function colLab(c) {
  c = String(c).trim(); let rgb = null;
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  else { const r = /^rgba?\(([^)]+)\)/i.exec(c); if (r) rgb = r[1].split(",").slice(0, 3).map(Number); }
  if (!rgb || rgb.some((v) => !isFinite(v))) return null;
  const [R, G, B] = rgb.map((v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; });
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// one speed scale per course (every recorded lap's slowest..fastest), so the live trail on the map and the
// live line on the trace paint the same mph the same colour
function courseSpeedRange(c) {
  if (!c) return null;
  if (c._spd !== undefined) return c._spd;
  let lo = Infinity, hi = -Infinity;
  Object.values(c.traces || {}).forEach((pts) => pts.forEach((q) => { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; }));
  return (c._spd = (isFinite(lo) && hi - lo > 1e-6) ? { lo, hi } : null);
}
function paintedLine(pts, ch, w, mode, baseCol, range) {
  if (!pts.length) return "";
  let sc = null;
  if (mode === "speed" && range) sc = range;   // a fixed scale (the course's), so two views of one lap agree
  else if (mode === "speed") { const vs = pts.map((q) => q[1]); sc = { lo: Math.min(...vs), hi: Math.max(...vs) }; if (sc.hi - sc.lo < 1e-6) sc = null; }
  const keyOf = (q) => mode === "pedals" ? pedalKey(q[6], q[7]) : (mode === "speed" && sc) ? Math.max(0, Math.min(GRAD.length - 1, Math.floor(((q[1] - sc.lo) / (sc.hi - sc.lo)) * GRAD.length))) : (q[2] | 0);
  // "NO PROBLEMS" IS THE DEFAULT COLOUR (Jett 2026-09-07): in grip paint the within-grip segments
  // (k===0, nothing wrong) carry the build's PI class colour when one is given, so PI stays readable
  // even on a painted line -- the problem states (slip/impact) keep their diagnostic colours, and the
  // speed gradient is untouched (it has no no-problem baseline).
  const colOf = (k) => mode === "pedals" ? pedalCol(k) : (mode === "speed" && sc) ? GRAD[k] : gripInk(k, baseCol);
  return arcRuns(pts).map((rp) => {
    const segs = []; let run = [rp[0]], st = keyOf(rp[0]);
    for (let i = 1; i < rp.length; i++) { const k = keyOf(rp[i]); if (k !== st) { run.push(rp[i]); segs.push([st, run]); run = [rp[i]]; st = k; } else run.push(rp[i]); }
    segs.push([st, run]);
    return segs.map(([k, pp]) => `<polyline fill="none" stroke="${colOf(k)}" stroke-width="${(mode === "speed" || (mode === "pedals" ? k > 1 : k)) ? w + 0.6 : w}" stroke-linecap="round" points="${pp.map((q) => ch.px(q[0]).toFixed(1) + "," + ch.py(q[1]).toFixed(1)).join(" ")}"><title>${mode === "pedals" ? PEDAL[PEDAL_KEYS[k]].word : mode === "speed" ? "speed" : gripOf(k).word + " — " + gripOf(k).tip}</title></polyline>`).join("");
  }).join("");
}
const plainLine = (pts, ch, col, w, op, dashed) => arcRuns(pts).map((run) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}"${dashed ? ' stroke-dasharray="3 3"' : ""} points="${run.map((q) => ch.px(q[0]).toFixed(1) + "," + ch.py(q[1]).toFixed(1)).join(" ")}"/>`).join("");
function impactMarks(pts) { const out = []; for (const q of pts) { if ((q[2] | 0) !== 4 || q.length < 5) continue; const l = out[out.length - 1]; if (l && (l[3] - q[3]) ** 2 + (l[4] - q[4]) ** 2 <= 144) continue; out.push(q); } return out; }
function modeControls() {
  return `<span class="segctl"><span class="why">paint</span>${[["grip", "grip", "what the tyres did — the axle that let go, and where"], ["speed", "speed", "how fast, coloured across the lap's own range"], ["pedals", "pedals", "what your feet did — throttle in greens, brake in reds, by how hard"]].map(([k, l, tip]) =>
    `<button class="mini ${TRACE_MODE === k ? "on" : ""}" data-tmode="${k}" title="${tip}">${l}</button>`).join("")}
    <button class="mini ${TRACE_ALL ? "on" : ""}" data-tall title="paint every run, not only the foregrounded lap">every run</button>
    <button class="mini ${RACING_ONLY ? "on" : ""}" data-racing title="show only competitive laps — hide cruise/drift runs far off the class pace, rewound laps, and over/under-covered laps. Off = every lap on record.">racing only</button></span>`;
}

// THE COURSE-MODE FILTER BAR (Jett 2026-09-11). The historical-data filters (show-preset + the
// class/drive/tune/traffic/build dimensions) are not a trace toy -- they scope EVERY course-mode
// pane: the speed trace, the turn analysis, the info, and the general statistics all read the same
// activeLapSet(). So the filters live here, in one bar between the trace and the course panes,
// with the resulting lap set spelled out (strong feedback for what is currently selected). Reuses
// traceFilterState()'s chips and wireTrace()'s handlers so one `vc` store still backs every surface.
// THE SCOPE BAND (course mode v2 step 2, handoff §2) grew out of it: the single source of truth for what every
// count below is measured against. Class options are the game's class badge + the laps choosing it would scope
// to; a reading line states what the filter costs; MISMATCH IS A STATE -- when the filter's class is not the car
// under you, the band's edge and its button turn amber and one tap scopes to your car. The trail's paint lives
// here too, bound to the one TRACE_MODE the trace header and the map key already share.
// SCOPE band: the `show` presets and the drive/tune/traffic/build filters fold behind a "filters" toggle,
// collapsed by default, so the band is one row (~78px, the design height) instead of wrapping to ~108px.
let SCOPE_MORE = (() => { try { return localStorage.getItem("fh6ScopeMore") === "1"; } catch (e) { return false; } })();
// scope every course pane to a class, or clear back to all: the SCOPE band's class badges AND the hero's
// laps-by-class bars both call this — one source for "make class X the thing every count is measured against".
// A class pick is explicit: it drops the "this class" preset (which follows the car) so the pick stands.
function setScopeClass(k) {
  if (!COURSE) return;
  const vc = traceSel(COURSE);
  if (k) vc.filters.class = k; else delete vc.filters.class;
  if (vc.preset === "class") vc.preset = "all";
  vc.auto = false; viewSave(); repaintFiltered();
}
function paintCourseFilter() {
  const el = $("#coursefilter"); if (!el) return;
  const course = MODE.suggest === "course" && COURSE;
  el.hidden = !course;
  if (!course) { el.innerHTML = ""; delete el.dataset.state; return; }
  const { presets, filt, clearBtn, sel } = traceFilterState(COURSE, ["class"]);
  const ls = activeLapSet(), tf = sel.filters || {};
  // per-class counts under the SAME preset, other dims and racing gate activeLapSet applies, so the number on a
  // class button is the token that button produces
  const base = (COURSE.laps || []).filter(presetTest(sel.preset === "class" ? "all" : sel.preset))
    .filter((l) => TRACE_DIMS.every(([d]) => d === "class" || !tf[d] || dimVal(l, d) === String(tf[d])));
  const race = RACING_ONLY ? racingIds(COURSE.laps || []) : null;
  const cnt = (ids) => { if (!race) return ids.length; const g = ids.filter((id) => race.has(id)); return g.length || ids.length; };
  const byCls = {}; base.forEach((l) => { if (l.class) (byCls[l.class] = byCls[l.class] || []).push(String(l.id)); });
  const classes = Object.keys(byCls).sort((a, b) => (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99));
  const carCls = liveClass(), carN = carCls ? cnt(byCls[carCls] || []) : 0;
  const state = !carCls ? "nocar" : !ls.cls ? "open" : ls.cls === carCls ? "match" : "mismatch";
  const clsBtn = (k) => {
    const on = k == null ? !ls.cls : ls.cls === k, n = k == null ? cnt(base.map((l) => String(l.id))) : cnt(byCls[k]);
    return `<button class="cf-cls${on ? " on" : ""}${k && k === carCls ? " car" : ""}" data-cfcls="${k == null ? "" : esc(k)}" title="${k == null ? "every class" : "class " + esc(k)} · ${n} lap${n === 1 ? "" : "s"}${k && k === carCls ? " · the car under you" : ""}">${k == null ? `<b class="cf-all">all</b><em class="cf-n">${n}</em>` : classPill(k, n)}</button>`;
  };
  const paint = `<span class="fdim cf-paint"><span class="why">paint the trail</span>${[["grip", "what the tyres did"], ["speed", "how fast, on this course's own scale"], ["pedals", "throttle and brake, by how hard"]].map(([m, tip]) => `<button class="mini ${TRACE_MODE === m ? "on" : ""}" data-tmode="${m}" title="${tip}">${m}</button>`).join("")}</span>`;
  const carTxt = !carCls ? "no live car to check the scope against"
    : `the car under you is class ${esc(carCls)} (${carN} lap${carN === 1 ? "" : "s"})`
      + (state === "mismatch" ? ` — <b class="cf-warn">every count below is measured against class ${esc(ls.cls)}</b>` : state === "match" ? " — the filter matches it" : "");
  const read = `<b>${ls.n}</b> lap${ls.n === 1 ? "" : "s"} in this filter ${scopeTok(ls)} · ${ls.total} on the course · ${carTxt}`;
  const cta = state === "nocar" ? "" : `<button class="cf-cta" data-cfmatch="${state === "match" ? "" : esc(carCls)}" title="${state === "match" ? "tap to widen back to every class" : "scope every pane to the class of the car under you"}">
      <b>${state === "match" ? "✓ scope matches" : state === "mismatch" ? "⚠ filter ≠ your car" : "match my car"}</b>
      <em>${state === "match" ? `class ${esc(carCls)} · ${carN} lap${carN === 1 ? "" : "s"}` : `tap to match my car — class ${esc(carCls)}`}</em></button>`;
  el.dataset.state = state;
  const moreBtn = `<button class="cf-morebtn ${SCOPE_MORE ? "on" : ""}" data-cfmore title="show / hide the preset and data filters">filters ${SCOPE_MORE ? "▾" : "▸"}</button>`;
  const moreRow = SCOPE_MORE ? `<div class="cf-morerow"><span class="fdim"><span class="why">show</span>${presets}</span>${filt}${clearBtn}</div>` : "";
  el.innerHTML = `<div class="cf-main"><div class="cf-row"><span class="cf-h">scope</span><span class="cf-clss">${[null].concat(classes).map(clsBtn).join("")}</span>`
    + `${paint}${moreBtn}</div>${moreRow}`
    + `<div class="cf-read">${read}</div></div>${cta}`;
  wireTrace(el);   // data-tpre / data-tfilt / data-tfiltsel / data-tmode handlers (they repaint every pane)
  el.querySelectorAll("[data-cfcls]").forEach((b) => b.onclick = () => setScopeClass(b.dataset.cfcls || null));
  const m = el.querySelector("[data-cfmatch]"); if (m) m.onclick = () => setScopeClass(m.dataset.cfmatch || null);
  const mb = el.querySelector("[data-cfmore]"); if (mb) mb.onclick = () => { SCOPE_MORE = !SCOPE_MORE; try { localStorage.setItem("fh6ScopeMore", SCOPE_MORE ? "1" : "0"); } catch (e) {} paintCourseFilter(); };
}
// One filter change re-scopes the trace, the bar's own summary, and (in course mode) the map/turns
// and stats. The left/right rebuild is course-only — in free roam it would needlessly re-raster the
// world map and interrupt its viewBox animation.
function repaintFiltered() {
  TRACE_KEY = null;
  paintTrace(); paintCourseFilter();
  if (MODE.suggest === "course" && COURSE) { LEFT_KEY = null; paintLeft(); paintRight(); }
}
const axisSvg = (ch, vmax) => [0.5, 1].map((f) => { const v = Math.round(vmax * f / 10) * 10; return `<text x="2" y="${(ch.py(v) + 3).toFixed(1)}" font-size="8" fill="var(--dim)">${v}</text>`; }).join("");
const cursorSvg = (H) => `<g class="cur" style="display:none"><line y1="6" y2="${H - 16}" stroke="var(--ink)" opacity=".6"/><circle r="3.5" fill="var(--ink)"/></g>`;

// a "racing lap" -- inferred, since nothing stores the flag: clean (no void / partial / rewind), a
// full single loop (coverage ~0.85-1.15), and within 30% of its OWN CLASS's best time. That keeps
// every competitive B/S1/X lap and drops cruise/drift runs (Irokawa's were ~+100% off) and overruns.
function racingIds(all) {
  const best = {};
  all.forEach((t) => { if (!t.void && !t.partial && !t.rewinds && t.t != null && (best[t.class] == null || t.t < best[t.class])) best[t.class] = t.t; });
  return new Set(all.filter((t) => {
    if (t.void || t.partial || t.rewinds) return false;
    if (t.cov != null && (t.cov < 0.85 || t.cov > 1.15)) return false;
    const b = best[t.class];
    if (b != null && t.t != null && t.t > b * 1.30) return false;
    return true;
  }).map((t) => String(t.id)));
}
// the preset + dimension chips, shared by the trace pane and the map's own filter drawer — one
// `vc` (per-course view store) backs both, so a click in either pane keeps them in lockstep.
function traceFilterState(c, skip) {   // skip: dims a caller renders itself (the scope band draws class)
  const byId = {}; (c.laps || []).forEach((l) => (byId[String(l.id)] = l));
  const allRaw = Object.keys(c.traces).map((id) => Object.assign({ id, pts: c.traces[id] }, byId[id] || {})).filter((t) => t.pts && t.pts.length > 2);
  // RACING-ONLY gate (default on) -- drop non-competitive laps unless it would blank the pane
  const _race = racingIds(allRaw);
  const all = (RACING_ONLY && _race.size) ? allRaw.filter((t) => _race.has(String(t.id))) : allRaw;
  const sel = traceSel(c), tf = sel.filters;
  // NEVER BLANK THE TRACE WHILE LAPS EXIST. traceSel() auto-defaults to "this class" on an event, but if you
  // are in a class you have never driven this course in, that preset is empty and the trace read "nothing to
  // draw" over N real recorded laps. When an AUTO-chosen preset hides every lap, fall back to "all" (a
  // deliberate user pick, sel.auto === false, is respected -- their empty filter stands with the widen hint).
  if (all.length && sel.auto !== false && sel.preset !== "all" && !all.some(presetTest(sel.preset))) sel.preset = "all";
  // 1. the preset against the car you are in — every chip carries its count, an empty one is dim
  const presets = PRESETS.map(([k, lab]) => { const n = all.filter(presetTest(k)).length;
    return `<button class="mini ${sel.preset === k ? "on" : ""} ${n ? "" : "dim"}" data-tpre="${k}" ${n ? "" : "disabled"} title="${k === "hw" ? "every build whose 48 non-rim slots match and whose rims share a mass level" : k === "build" ? "this exact hardware hash" : k === "tune" ? "this save file" : k === "class" ? "the class you are in now" : k === "car" ? "this car, any build" : "every lap on record"}">${lab}<span class="cn">${n}</span></button>`; }).join("");
  const stage1 = all.filter(presetTest(sel.preset));
  // 2. the dimension filters, from what stage 1 leaves on screen. A dim with more than CHIP_MAX
  // distinct values (the build-hash / tune-timestamp dumps, which used to spill 18 + 8 unreadable
  // chips) COLLAPSES to a single dropdown -- same reach, one entry instead of dozens (Jett 2026-09-10).
  const CHIP_MAX = 4;
  const filt = TRACE_DIMS.filter(([d]) => !(skip || []).includes(d)).map(([d, lab]) => {
    const vals = [...new Set(stage1.map((t) => dimVal(t, d)).filter((v) => v != null))].sort();
    if (vals.length < 2) return "";
    const active = tf[d] != null ? String(tf[d]) : "";
    // CLASS is always pills, never a dropdown: it is a small bounded, colour-coded vocabulary
    // (D/C/B/A/S1/S2/X) the user reads at a glance -- only the high-cardinality build/tune dumps collapse.
    if (vals.length > CHIP_MAX && d !== "class") {
      const opts = [`<option value=""${active === "" ? " selected" : ""}>all (${vals.length})</option>`]
        .concat(vals.map((v) => `<option value="${esc(String(v))}"${active === String(v) ? " selected" : ""}>${esc(dimLab(d, v))}</option>`)).join("");
      return `<label class="fdim fseldim${active ? " on" : ""}"><span class="why">${lab}</span><select class="fsel" data-tfiltsel="${esc(d)}">${opts}</select></label>`;
    }
    // the "all" chip is the NEUTRAL default (no filter on this dim) -- a quiet outline when active,
    // so only a specific value chosen (a real filter) fills solid and pops.
    const chip = (v, text) => {
      const on = active === (v == null ? "" : String(v));
      // class chips carry the PI-class colour, the same vocabulary the trace legend and .pib badges
      // use, so a class reads the same everywhere; a specific pick fills solid, "all" stays neutral.
      const pc = (d === "class" && v != null) ? piColor(v) : null;
      return `<button class="mini ${on ? "on" : ""}${v == null ? " neutral" : ""}${pc ? " clschip" : ""}" data-tfilt="${esc(d)}|${esc(v == null ? "" : v)}"${pc ? ` style="--pc:${pc}"` : ""}>${esc(text)}</button>`;
    };
    return `<span class="fdim"><span class="why">${lab}</span>${chip(null, "all")}${vals.map((v) => chip(v, dimLab(d, v))).join("")}</span>`;
  }).filter(Boolean).join("");
  const stage2 = stage1.filter((t) => TRACE_DIMS.every(([d]) => !tf[d] || dimVal(t, d) === tf[d]));
  const clearBtn = Object.keys(tf).length || sel.hidden.size || sel.hi.size ? `<button class="mini clearf" data-tfilt="*|">✕ clear filters</button>` : "";
  return { all, sel, tf, presets, stage1, filt, stage2, clearBtn };
}
// the compact bar for the map's filter drawer: same chips, none of the trace's own furniture.
// PRESET row on top (the primary "how wide a net" selector), the readable dimension filters below,
// and a plain "showing N of M" summary so the active selection is never ambiguous.
function mapFilterBar(c) {
  const { presets, filt, clearBtn, sel, all, stage2 } = traceFilterState(c);
  const shown = stage2.filter((t) => !sel.hidden.has(String(t.id))).length;
  const plabel = (PRESETS.find((p) => p[0] === sel.preset) || ["", "all"])[1];
  const nFilt = Object.keys(sel.filters || {}).length;
  return `<div class="fdim"><span class="why">show</span>${presets}</div>`
    + (filt ? `<div class="ffilters">${filt}${clearBtn}</div>` : (clearBtn ? `<div class="ffilters">${clearBtn}</div>` : ""))
    + `<div class="fsummary why">drawing <b>${shown}</b> of ${all.length} laps · <b>${esc(plabel)}</b>${nFilt ? ` · ${nFilt} filter${nFilt === 1 ? "" : "s"} on` : ""}</div>`;
}
// THE LIVE LAP, aligned to the course. LIVE.run's own x is the fake event odometer, which does NOT line up
// with the recorded laps' real arc-along-lap -- so map each live point's (px,pz) to the nearest point on a
// recorded reference lap and take ITS arc. Return the CURRENT lap only (points since the arc last wrapped
// past the S/F on a circuit), grip-coded like the recorded laps: [arc, mph, grip, px, pz]. null if too short.
function alignLiveToCourse(run, ref, c) {
  if (!ref || !(ref.pts || []).length || !(run || []).length) return null;
  const R = ref.pts, L = (c && c.len) || R[R.length - 1][0] || 1;
  const arcOf = (px, pz) => { let bd = Infinity, ba = 0; for (let i = 0; i < R.length; i++) { const dx = R[i][3] - px, dz = R[i][4] - pz, d = dx * dx + dz * dz; if (d < bd) { bd = d; ba = R[i][0]; } } return ba; };
  const mapped = run.map((q) => [arcOf(q[3], q[4]), q[1], q[2] | 0, q[3], q[4], null, q[8] ?? null, q[9] ?? null]);   // LIVE.lap keeps pedals at [8]/[9]
  let start = 0;                                   // the last S/F wrap: the arc drops by most of a lap
  for (let i = 1; i < mapped.length; i++) if (mapped[i][0] < mapped[i - 1][0] - L * 0.4) start = i;
  const lap = mapped.slice(start);
  return lap.length >= 3 ? lap : null;
}
function courseTrace(c) {
  const { all, sel, tf, presets, filt, stage2, clearBtn } = traceFilterState(c);
  // 3. the chips: each lap, a click to hide. Sort FIRST: `best` and `cur` are taken from this
  // list by position, and an unsorted list crowned whichever lap the JSON happened to list first.
  stage2.sort((a, b) => (a.t || 9e9) - (b.t || 9e9));
  const match = stage2.filter((t) => !sel.hidden.has(String(t.id)));
  const onRec = (c.laps || []).length;
  const head = `<b>Speed trace</b><span class="why">${esc(c.name || c.key)} · ${onRec} lap${onRec === 1 ? "" : "s"} on record · showing ${match.length} of ${all.length}${onRec > all.length ? (RACING_ONLY ? " · racing only" : " (traces capped)") : ""}${MODE.game === "event" ? " · timed event" : ""}${TRACE_MODE === "pedals" ? ` · pedals recorded on ${stage2.filter((t) => t.pts.some((q) => q[6] != null)).length} of ${stage2.length} laps` : ""} · ticks share the turn list's T numbers</span>
    <span class="tspacer"></span><span class="tread why">hover: reads the point and marks the map</span>${modeControls()}`;
  if (!stage2.length) return { head, foot: `<span class="why">no lap on record matches — widen the preset or clear a filter</span>`, svg: () => `<div class="why tempty">nothing to draw</div>` };
  const L = Math.max(c.len || 0, ...stage2.map((t) => t.pts[t.pts.length - 1][0]));
  stage2.forEach((t) => { t._cov = t.cov != null ? t.cov : (L ? t.pts[t.pts.length - 1][0] / L : 1); });
  const best = match.find((t) => !notTimed(t)) || null;
  const mine = match.filter((t) => CUR && t.cid === CUR.cid);
  const cur = mine.find((t) => !notTimed(t)) || mine[0] || null;
  const fore = cur || best || match[0] || null;
  // THE ACTIVE (LIVE, in-progress) LAP: drawn on top, grip-painted, updating in real time as you drive it. It is
  // the whole lap (LIVE.lap, not the 90 s LIVE.run), and a pause or the end-of-event menu HOLDS it as "last run"
  // until the next lap starts -- the moment a driver stops to read it is not the moment it may vanish (handoff §4).
  const shownLap = liveLapFor(c);
  const live = shownLap ? alignLiveToCourse(shownLap.pts, fore, c) : null;
  const liveNow = !!(live && LIVE.lap && LIVE.lap.live);
  const leg = stage2.slice(0, 12).map((t) => {
    // THREE-STATE CHIP (Jett 2026-09-11): a click cycles enabled → highlighted → disabled → enabled. enabled draws
    // the lap normally; highlighted lifts it and recedes every other enabled lap; disabled hides it (sel.hidden).
    const id = String(t.id), hid = sel.hidden.has(id), lhi = !hid && sel.hi.has(id);
    const nt = notTimed(t); const off = best && !nt && t !== best && t.t ? ((t.t / best.t - 1) * 100).toFixed(1) + "%" : "";
    // swatch matches the lap's own polyline colour (its PI class); best is green, current is accent (spec 545-546)
    const col = t.void ? "#e3b341" : (t.partial || t._cov < 0.9) ? "var(--warn)" : t === cur ? "var(--acc2)" : t === best ? "#00d27a" : piColor(t.class);
    const lead = t === cur ? "you" : t === best ? "fastest" : off;   // always suffix the lap's class (spec)
    const metaTxt = [lead, t.class ? esc(t.class) : ""].filter(Boolean).join(" · ");
    const nextTip = hid ? "hidden — click to draw it" : lhi ? "highlighted — click to hide it" : "drawn — click to highlight it";
    return `<button class="lchip ${hid ? "hid" : ""}${lhi ? " lhi" : ""} ${t === cur ? "you" : t === best ? "best" : ""}" data-tcycle="${esc(id)}"
      style="--lc:${col}" title="${esc(nextTip + " · " + (t.sid || "") + (t.container ? " · " + t.container : "") + (t.void ? " · time void: contact" : "") + (t.partial ? " · partial lap" : ""))}">
      <i class="lcd"></i><span class="lct">${nt ? `<s>${lapTime(t.t)}</s>` : lapTime(t.t)}</span>
      <span class="lcm">${metaTxt}</span></button>`; }).join("");
  // in default mode the context lines are coloured by PI class -- show which classes are on the chart
  const clsPresent = [...new Set(match.map((t) => t.class).filter(Boolean))];
  if (TRACE_CLS_HI && !clsPresent.includes(TRACE_CLS_HI)) TRACE_CLS_HI = null;   // spotlight class fell out of view
  // CLICK A CLASS SWATCH TO SPOTLIGHT IT (Jett 2026-09-10): clicking a class in the legend lifts that class's
  // laps and dims the rest in the chart -- a highlight, not a filter (every lap stays on screen). Click again
  // (or its ✕) to clear. The chips carry an `on` state so the current spotlight is obvious.
  const piLeg = (!TRACE_ALL && clsPresent.length) ? `<span class="lchips pileg" title="click a class to spotlight its laps in the chart; the lines are coloured by the PI class that drove each lap">${clsPresent.map((k) => `<button class="lchip key clshi${TRACE_CLS_HI === k ? " on" : ""}" data-clshi="${esc(k)}" style="--pc:${piColor(k)};border-color:${piColor(k)};background:${piColor(k)}${TRACE_CLS_HI === k ? "44" : "22"}"><i style="background:${piColor(k)}"></i>${esc(k)}${TRACE_CLS_HI === k ? " ✕" : ""}</button>`).join("")}</span>` : "";
  // the mode legend: grip and pedals colour every point, so each needs its key here (grip was missing — the
  // course-mode trace paints by grip by default, yet only pedals ever showed a legend). speed uses the gradient bar.
  const modeLeg = TRACE_MODE === "grip" ? `<span class="lchips pedleg">${gripSwatches()}</span>`
    : TRACE_MODE === "pedals" ? `<span class="lchips pedleg">${pedalSwatches()}</span>` : "";
  const foot = `${modeLeg}${piLeg}<span class="lchips">${live ? (liveNow ? `<span class="lchip livenow" title="the lap you are driving now — painted live by grip"><i></i>● LIVE lap</span>` : `<span class="lchip livenow last" title="the last lap driven, held through the pause / menu until the next lap starts"><i></i>last run</span>`) : ""}${leg}</span>`;
  TRACE_FIT = stage2.length;
  // publish the selection so the LEFT PANE draws the same laps and the two panes agree
  const sel2 = { key: c.key, ids: match.map((t) => String(t.id)), fore: fore ? String(fore.id) : null };
  if (JSON.stringify(sel2) !== JSON.stringify(TRACE_PICK)) { TRACE_PICK = sel2; LEFT_KEY = null; setTimeout(() => { paintLeft(); if (MODE.suggest === "course" && COURSE) paintRight(); }, 0); }   // the corner-phase strip re-scopes to the filtered laps too
  const svg = (W, H) => {
    if (!match.length) return `<div class="why tempty">every matching lap is hidden — click a chip to show it</div>`;
    const smax = L, vmax = Math.max(...match.flatMap((t) => t.pts.map((q) => q[1]))) * 1.06 || 1;
    const ch = chart(W, H, 28, 16, smax, vmax);
    // default (non-"every run") context lines paint by the build's PI class, best emphasised by weight/opacity.
    // A class spotlight (TRACE_CLS_HI) lifts that class's laps and fades the rest -- highlight, not filter.
    // a lit set comes from EITHER the class spotlight (TRACE_CLS_HI) OR a per-lap highlight (sel.hi, the 3-state
    // chip). When anything is lit, everything else recedes — highlight, not filter (every lap stays drawn).
    const clsHi = TRACE_CLS_HI, lapHi = sel.hi, anyHi = !!clsHi || lapHi.size > 0;
    const lines = match.map((t) => {
      if (t === cur) return "";
      if (TRACE_ALL) return paintedLine(t.pts, ch, t === best ? 1.4 : 0.9, TRACE_MODE, piColor(t.class));
      const isLit = (clsHi && t.class === clsHi) || lapHi.has(String(t.id));
      const other = anyHi && !isLit, lit = anyHi && isLit;
      const w = lit ? Math.max(t === best ? 1.8 : 1, 1.7) : other ? 0.9 : (t === best ? 1.8 : 1);
      const op = lit ? 0.98 : other ? 0.1 : (t === best ? 0.95 : 0.5);
      return plainLine(t.pts, ch, piColor(t.class), w, op, notTimed(t));
    }).join("")
      + (cur ? paintedLine(cur.pts, ch, 2.4, TRACE_MODE, piColor(cur.class)) : "");
    const tsel = turnPickSeq();
    // the selected turn: highlight its tick (accent, bold) + wash a translucent band over its stretch of the
    // trace (from the midpoint to the previous turn to the midpoint to the next) so its extent reads at a glance
    let band = "";
    if (tsel != null) { const bt = (c.turns || []).find((t) => t.seq === tsel && t.s != null);
      if (bt) { const ss = (c.turns || []).map((t) => t.s).filter((v) => v != null).sort((a, b) => a - b);
        const i = ss.indexOf(bt.s), prev = i > 0 ? ss[i - 1] : Math.max(0, bt.s - 70), next = i < ss.length - 1 ? ss[i + 1] : bt.s + 70;
        const bx0 = ch.px((bt.s + prev) / 2), bx1 = ch.px((bt.s + next) / 2);
        band = `<rect x="${Math.min(bx0, bx1).toFixed(1)}" y="6" width="${Math.abs(bx1 - bx0).toFixed(1)}" height="${H - 22}" fill="var(--acc2)" opacity=".10"><title>${esc(turnLabel(bt))} extent</title></rect>`; } }
    const ticks = (c.turns || []).filter((t) => t.s != null).map((t) => { const on = t.seq === tsel;
      return `<line x1="${ch.px(t.s).toFixed(1)}" y1="6" x2="${ch.px(t.s).toFixed(1)}" y2="${H - 16}" stroke="${on ? "var(--acc2)" : "var(--line2)"}" stroke-width="${on ? 1.6 : 1}" opacity="${on ? 0.95 : 0.7}"/><text x="${ch.px(t.s).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" font-weight="${on ? 700 : 400}" fill="${on ? "var(--acc2)" : "var(--dim)"}">${esc(turnLabel(t))}</text>`; }).join("");
    const imp = impactMarks(fore.pts).map((q, i) => `<g><title>impact ${i + 1} at ${Math.round(q[0])} m</title><line x1="${ch.px(q[0]).toFixed(1)}" y1="6" x2="${ch.px(q[0]).toFixed(1)}" y2="${H - 16}" stroke="${DGRIP.impact.ink}" stroke-dasharray="2 2" opacity=".6"/><circle cx="${ch.px(q[0]).toFixed(1)}" cy="${ch.py(q[1]).toFixed(1)}" r="3" fill="${DGRIP.impact.col}"/></g>`).join("");
    const pts = fore.pts.map((q) => [q[0], q[1], q[2], q[3], q[4], null, q[6] ?? null, q[7] ?? null]);   // pedals ride for the hover readout
    // THE ACTIVE LAP, on top and unmistakable: a soft accent glow under the grip-painted line, thicker than
    // any recorded lap, with the car's marker at its current position -- the same "you" the course map draws
    // (white core, accent pulse; a hollow grey ring when held), never a grip colour. "Last run" drops the pulse.
    const lp = live && live[live.length - 1];
    const liveSvg = live ? `<g class="livelap">
      <polyline fill="none" stroke="var(--acc2)" stroke-width="6.5" stroke-linejoin="round" stroke-linecap="round" opacity="${liveNow ? ".22" : ".1"}" points="${live.map((q) => ch.px(q[0]).toFixed(1) + "," + ch.py(q[1]).toFixed(1)).join(" ")}"/>
      ${paintedLine(live, ch, 3.2, TRACE_MODE, piColor(CUR && CUR.cls), courseSpeedRange(c))}
      ${youMarkSvg(ch.px(lp[0]), ch.py(lp[1]), liveNow)}</g>` : "";
    return `<svg class="tsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-smax="${smax}" data-vmax="${vmax}" data-padl="28" data-padb="16" data-w="${W}" data-h="${H}" data-pts="${esc(JSON.stringify(pts))}">${axisSvg(ch, vmax)}${band}${ticks}${lines}${imp}${liveSvg}${cursorSvg(H)}</svg>`;
  };
  return { head, foot, svg, hasData: match.length > 0 };
}

function liveRun() {
  const pts = LIVE.run;
  const head = `<b>Speed trace</b><span class="why">${pts.length && (pts[pts.length - 1][0] || 0) <= 50 ? "parked — the trace draws once the car moves" : "live run · the last " + (pts.length && pts[0][6] != null ? Math.round((pts[pts.length - 1][6] - pts[0][6]) / 1000) : (pts.length ? Math.round(pts.length / 10) : 0)) + " s"}${MODE.suggest === "course" && COURSE ? ` · no lap on record for ${esc(COURSE.name || COURSE.key)} yet` : ""}</span><span class="tspacer"></span>${modeControls()}`;
  // 2026-09-03 (Jett): the legend named every grip state but never said which one you're IN right
  // now -- LIVE.run's own last point already carries it (runSample() pushes [dist,mph,g,...]).
  const curG = pts.length ? pts[pts.length - 1][2] : null;
  // the swatches key a LINE, so they wear each state's ink (within grip: the PI colour the line paints in)
  const pc = piColor(CUR && CUR.cls);
  const foot = TRACE_MODE === "pedals" ? `<span class="lchips pedleg">${pedalSwatches()}</span>` : `<span class="lchips grip">${GSTATE.map((key, i) => { const c = gripInk(i, pc); return `<span class="lchip key${curG === i ? " on" : ""}" title="${esc(DGRIP[key].tip)}" style="border-color:${c}${curG === i ? `;background:${c}22` : ""}"><i style="background:${c}"></i>${DGRIP[key].word}</span>`; }).join("")}</span>`;
  const svg = (W, H) => {
    if (pts.length < 3) return `<div class="why tempty">drive — speed against time draws here as you go, painted by what the tyres are doing</div>`;
    // FREE MODE PLOTS vs TIME, not distance (Jett 2026-09-07): a free-roam run has no course to measure
    // along, so the x-axis is seconds since the run began. [6] is the sample timestamp; fall back to the
    // distance axis for any stale point that predates it.
    const hasT = pts[0][6] != null, t0 = hasT ? pts[0][6] : 0;
    const P = pts.map((q) => [hasT ? (q[6] - t0) / 1000 : q[0], q[1], q[2], q[3], q[4], null, q[7] ?? null, q[8] ?? null]);   // LIVE.run keeps pedals at [7]/[8]
    const smax = P[P.length - 1][0] || 1, vmax = Math.max(60, ...P.map((q) => q[1])) * 1.06;
    const ch = chart(W, H, 28, 16, smax, vmax);
    // split at a pause: a menu dwell holds the run but leaves a >1.5 s gap in the timestamps, and drawing
    // straight across it would be a flat line over dead time.
    const runs = []; let run = [P[0]];
    for (let i = 1; i < P.length; i++) { if (hasT && P[i][0] - P[i - 1][0] > 1.5) { runs.push(run); run = []; } run.push(P[i]); }
    runs.push(run);
    const body = runs.filter((r) => r.length > 1).map((r) => paintedLine(r, ch, 2.2, TRACE_MODE, piColor(CUR && CUR.cls))).join("");
    const step = smax <= 20 ? 5 : smax <= 60 ? 10 : smax <= 150 ? 30 : 60;   // second ticks scaled to the window
    const ticks = hasT ? [...Array(Math.floor(smax / step)).keys()].map((i) => (i + 1) * step).map((s) => `<line x1="${ch.px(s).toFixed(1)}" y1="6" x2="${ch.px(s).toFixed(1)}" y2="${H - 16}" stroke="var(--line)" opacity=".6"/><text x="${ch.px(s).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--dim)">${s}s</text>`).join("") : "";
    return `<svg class="tsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-smax="${smax}" data-vmax="${vmax}" data-padl="28" data-padb="16" data-w="${W}" data-h="${H}" data-pts="${esc(JSON.stringify(P))}">${axisSvg(ch, vmax)}${ticks}${body}${cursorSvg(H)}</svg>`;
  };
  // points are not a trace: a parked car accrues samples at one spot. The band is only worth
  // 240px when there is real distance under the line.
  const span = pts.length ? pts[pts.length - 1][0] : 0;
  return { head, foot, svg, hasData: pts.length >= 3 && span > 50 };
}

function markMapAt(x, z, col) {
  const sv = document.querySelector("#leftBody svg[data-x0]"); if (!sv || x == null) return;   // the map, not the hero glyph
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
    if (d === "*") { vc.filters = {}; vc.hidden = new Set(); vc.hi = new Set(); }   // also drop per-lap highlights, so a highlight whose chip scrolled out of the legend can't get stuck
    else { if (v) vc.filters[d] = v; else delete vc.filters[d]; }
    viewSave(); repaintFiltered(); });
  // high-cardinality dims (build / tune) render as a dropdown instead of a chip row
  el.querySelectorAll("[data-tfiltsel]").forEach((s) => s.onchange = () => {
    const d = s.dataset.tfiltsel; if (!COURSE) return;
    const vc = traceSel(COURSE);
    if (s.value) vc.filters[d] = s.value; else delete vc.filters[d];
    viewSave(); repaintFiltered(); });
  el.querySelectorAll("[data-tpre]").forEach((b) => b.onclick = () => { if (!COURSE) return; const vc = traceSel(COURSE); vc.preset = b.dataset.tpre; vc.auto = false; viewSave(); repaintFiltered(); });
  el.querySelectorAll("[data-tcycle]").forEach((b) => b.onclick = () => { if (!COURSE) return; const s = traceSel(COURSE), id = b.dataset.tcycle;
    if (s.hidden.has(id)) s.hidden.delete(id);              // disabled → enabled
    else if (s.hi.has(id)) { s.hi.delete(id); s.hidden.add(id); }   // highlighted → disabled
    else s.hi.add(id);                                     // enabled → highlighted
    viewSave(); TRACE_KEY = null; paintTrace(); });
  el.querySelectorAll("[data-tmode]").forEach((b) => b.onclick = () => { TRACE_MODE = b.dataset.tmode; saveTraceMode(); TRACE_KEY = null; paintTrace(); paintCourseFilter();   // the scope band's paint buttons show the same state
    if (MODE.suggest === "course" && COURSE) { LEFT_KEY = null; paintLeft(); } });   // one paint state: the map's trail + key follow
  el.querySelectorAll("[data-clshi]").forEach((b) => b.onclick = () => { const k = b.dataset.clshi; TRACE_CLS_HI = (TRACE_CLS_HI === k) ? null : k; TRACE_KEY = null; paintTrace(); });
  const ta = el.querySelector("[data-tall]"); if (ta) ta.onclick = () => { TRACE_ALL = !TRACE_ALL; VIEW.global.traceAll = TRACE_ALL; viewSave(); try { localStorage.setItem("fh6PaintAll", TRACE_ALL ? "1" : "0"); } catch (e) {} TRACE_KEY = null; paintTrace(); };
  const rc = el.querySelector("[data-racing]"); if (rc) rc.onclick = () => { RACING_ONLY = !RACING_ONLY; VIEW.global.racingOnly = RACING_ONLY; viewSave(); try { localStorage.setItem("fh6RacingOnly", RACING_ONLY ? "1" : "0"); } catch (e) {} TRACE_KEY = null; LEFT_KEY = null; paintTrace(); paintLeft(); if (MODE.suggest === "course" && COURSE) paintRight(); };
  const sv = el.querySelector("svg.tsvg[data-pts]"); if (!sv) return;
  let P = []; try { P = JSON.parse(sv.dataset.pts || "[]"); } catch (e) { P = []; }
  if (!P.length) return;
  const ds = sv.dataset, smax = +ds.smax, vmax = +ds.vmax, padL = +ds.padl, padB = +ds.padb, W = +ds.w, H = +ds.h;
  const cur = sv.querySelector(".cur"), read = el.querySelector(".tread");
  sv.onmousemove = (ev) => {
    const r = sv.getBoundingClientRect(); const vx = ((ev.clientX - r.left) / r.width) * W;
    const sAt = ((vx - padL) / (W - padL - 8)) * smax;
    let bi = 0, bd = Infinity; for (let i = 0; i < P.length; i++) { const d = Math.abs(P[i][0] - sAt); if (d < bd) { bd = d; bi = i; } }
    const q = P[bi]; const col = gripInk(q[2] | 0);
    const px = padL + (q[0] / smax) * (W - padL - 8), py = (H - padB) - (q[1] / vmax) * (H - padB - 10);
    cur.style.display = ""; const ln = cur.querySelector("line"); ln.setAttribute("x1", px); ln.setAttribute("x2", px);
    const c = cur.querySelector("circle"); c.setAttribute("cx", px); c.setAttribute("cy", py); c.setAttribute("fill", col);
    if (read) read.innerHTML = `<b>${Math.round(q[1])} mph</b> at ${Math.round(q[0])} m · <span style="color:${col}" title="${esc(gripOf(q[2] | 0).tip)}">${gripOf(q[2] | 0).word}</span>${q.length > 7 && (q[6] != null || q[7] != null) ? ` · throttle <b>${q[6] ?? 0}%</b> · brake <b>${q[7] ?? 0}%</b>` : ""}`;
    if (q.length > 4) markMapAt(q[3], q[4], col);
  };
  sv.onmouseleave = () => { cur.style.display = "none"; if (read) read.textContent = "hover the trace — it marks that spot on the map"; clearMapMark(); };
}

/* --------------------------------------------------------------- dock */
// The live dock — the v1 Lab's bottom strip, ported: value tiles from the frame, and the time
// trace from the daemon's per-second strip (grip state as colour, speed as a line, every
// identified corner marked ▲ and coloured by its balance). One palette, the analyzer's own.
// (DGRIP itself is defined once, with the trace constants above.)
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
  const mode = f.on ? (f.ev ? `EVENT${lapNo(f) != null ? " · lap " + lapNo(f) : ""}${f.rpos ? " · P" + f.rpos : ""}` : "free roam") : "menu";
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
  // bottoming (🔧) and wall-impact (💥) markers, detected live off the frame stream (live.js detectLiveEvents)
  const ev = (LIVE.events || []).filter((e) => e.t >= t0 && e.t <= t1).map((e) => {
    const x = idx(e.t) * cw + cw / 2, wall = e.kind === "wall";
    const ic = wall ? "💥" : "🔧", col = wall ? "#e5414e" : "#e3b341";
    const lab = wall ? `wall / barrier impact · lost ${e.drop} mph at ${e.mph} mph${e.hard ? " · HARD" : ""}`
                     : `bottoming ${e.wheel}${e.hard ? " · HARD" : ""} · ${e.mph} mph`;
    return `<g><line x1="${x.toFixed(1)}" y1="16" x2="${x.toFixed(1)}" y2="60" stroke="${col}" stroke-width="${e.hard ? 1.6 : 0.9}" opacity=".6"/>
      <text x="${x.toFixed(1)}" y="73" font-size="${e.hard ? 15 : 12}" text-anchor="middle">${ic}<title>${e.t.toFixed(1)}s — ${lab}</title></text></g>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="trace" role="img" aria-label="time trace">${bars}<path d="${line}" fill="none" stroke="#dfe7ef" stroke-width="1.1" opacity=".85"/>${marks}${ev}${ticks}</svg>
    <div class="legend">${Object.entries(DGRIP).map(([k, g]) => `<span><i style="background:${g.col}"></i>${g.word}</span>`).join("")}<span><i class="ln"></i>speed</span><span>▲ corner, coloured by balance</span><span>🔧 bottoming</span><span>💥 wall impact</span></div>`;
}
function paintDockTrace() {
  const el = $("#dockTrace"); if (!el) return;
  el.innerHTML = stripSVG(LIVE.strip, LIVE.corners, DOCK_SPAN);
  const note = $("#dockNote"); if (note) note.textContent = LIVE.strip.length ? `${Math.round(LIVE.strip.length / 60)} min of history · ${(LIVE.corners || []).length} corners this session` : "";
}

// (The status-spectrum ladder — STATUS_SPECTRUM / spectrumIdx() / statusSpectrumHTML() and the marker
// fly-in — was retired 2026-09-07 by the gate strip in the band. resolutionState() below survives; it
// feeds gateStrip().)

// RESOLUTION, NOT A JOURNEY (Jett 2026-09-06). Identity is a tree: the live cid narrows to a few HARDWARE
// hashes, each holding known SLIDER hashes; a saved (hw_hash, tune_hash) is a complete, clone-able build,
// and an unsaved one is cid-only and incomplete. So the header's status is where we are in that resolution
// — RESOLVED / AMBIGUOUS / UNSAVED — not the old UNKNOWN→RATIFIED spectrum. Reuses buildStatus()'s signals.
// SPEC / TEMPORARY-CAR EVENT (Jett 2026-09-11): some Rivals give a FIXED car + tune that you do not own and
// that vanish after the event (spec racing). "No save on disk" is then EXPECTED, not a fault, and no tuning
// applies — the analysis is driving-only. Heuristic: in an event, the live car has no disk save AND its
// ordinal is not in the car catalogue (a provided car the garage never held).
function isSpecEvent() {
  if (!CUR || CUR.disk) return false;
  const inEvent = MODE.game === "event" || (MODE.suggest === "course" && COURSE && COURSE.rivals);
  if (!inEvent) return false;
  const ord = CUR.ordinal != null ? CUR.ordinal : (CUR.cid ? parseInt(String(CUR.cid).split("|")[0], 10) : null);
  return ord != null && !CARMAP[ord];   // uncatalogued + no save + in an event = provided spec car
}
function resolutionState() {
  const st = buildStatus();
  if (isSpecEvent()) return { key: "spec", label: "spec car", tone: "blue", clonable: false, locked: false, hwN: 0, tunes: 0,
    hint: "spec car provided by the event — fixed car + tune, temporary; nothing to save or compare, so any advice here is about driving, not tuning" };
  const mm = (CUR && CUR.match) || {};
  const q = matchQuality(CUR && CUR.match);
  const ambiguous = q.level === "ambiguous" || q.level === "conflict";
  const locked = st.key === "downloaded" || !!(CUR && CUR.disk && CUR.disk.tune && CUR.disk.tune.locked);
  const hwN = MATCH && MATCH.hw ? new Set(MATCH.hw.map((b) => rimFree(b.pkey))).size : 0;   // distinct hardware hashes the cid matches
  const tunes = MATCH && MATCH.hw ? MATCH.hw.length : 0;                                     // slider hashes under them
  let key, label, tone, clonable, hint;
  if (st.key === "none") return { key: "none", label: "no car", tone: "dim", hint: "waiting for a car", hwN: 0, tunes: 0 };
  if (ambiguous) {
    key = "ambiguous"; tone = "warn"; clonable = false; label = "ambiguous";
    hint = `cid matches ${mm.n_signature_ties || tunes || "several"} saved builds — equip the build and save the tune in-game to identify it`;
  } else if (st.key === "ratified" || st.key === "downloaded") {
    key = "resolved"; tone = "ok"; clonable = true; label = "resolved";
    hint = locked ? "downloaded / locked — reads and clones cleanly; only editing it in-game is locked" : "one saved build · hardware hash + slider hash both known";
  } else if (st.key === "clone") {
    key = "resolved"; tone = "blue"; clonable = true; label = "clone · unnamed";
    hint = "an unlocked clone of a known build — save it under a name to ratify it";
  } else if (st.key === "variation") {
    key = "unsaved"; tone = "blue"; clonable = false; label = "variation";
    hint = "same hardware as a held build, sliders moved — save to capture this slider hash, or A/B it against the base";
  } else {   // unknown: no hardware match, or hardware changed and not saved
    key = "unsaved"; tone = "bad"; clonable = false; label = locked ? "downloaded · importing" : "unsaved";
    hint = locked ? "identified from the save; the history import is catching up" : "the live car matches no saved build — save it in-game to capture the hardware + slider hashes";
  }
  return { key, label, tone, clonable, locked, hwN, tunes, hint };
}

// THE GATE STRIP (header handoff §4): one strip that pairs the identity we HAVE with the one thing
// this state affords. Returns {tone, ident, detail, sheet, sheetSub}. `sheet` grades the
// trailing Build Sheet cell -- "filled" (it IS the primary, downloaded), "outline" (reachable, open
// shackle), "dead" (refused, shut shackle). The middle action cell is c.primary / c.noBtn from headerCopy().
// VERDICT FOLDED IN (2026-09-11 header collapse): the old separate `verdict` field drew a 21px headline row
// that just restated this ident/detail -- same fact twice, and a state-conditional row is exactly what made
// the band's height jitter. The severe states now carry their verdict IN `ident` (a contradiction reads
// "◌ IDENTITY CONTRADICTED" at tone bad; a new build already reads "◌ NEW BUILD"), so nothing gets an extra row.
function gateStrip(st, rs) {
  const ch = CHANGE || {}, nSl = (ch.sliders || []).length, nPa = (ch.slots || []).length;
  if (!CUR || rs.key === "none") return { tone: "dim", ident: "—", detail: "waiting for a car", sheet: "dead", sheetSub: "no car" };
  if (st.key === "offline") return { tone: "dim", ident: "◌ NOT LIVE", detail: "last thing seen", sheet: "dead", sheetSub: "daemon down" };
  if (rs.key === "spec") return { tone: "blue", ident: "◈ SPEC CAR", detail: "provided by the event · temporary", sheet: "dead", sheetSub: "spec — nothing to save", spec: true };
  // IDENTITY = "LAST BUILD REMEMBERED" (Jett 2026-09-11): the confidence is simply whether we hold THIS exact
  // car + build on record ("remembered"), separate from whether the TUNING is exact. Tuning is only guaranteed
  // when the build was captured through the game's own save (equip → My Tuning Setup → the grey-minus tile → the
  // save fully decodes); a downloaded tune's sliders are locked, so it is remembered but its tune is not readable
  // until you equip + save it. See memory fh6-tune-identification-equip-workflow.
  if (rs.key === "ambiguous") {
    const mm = (CUR && CUR.match) || {}; const ties = mm.n_signature_ties || rs.tunes || 0;
    const conflict = CUR.match && matchQuality(CUR.match).level === "conflict";
    return { tone: conflict ? "bad" : "warn", ident: conflict ? "◌ IDENTITY CONTRADICTED" : "◌ NOT YET REMEMBERED",
      detail: (ties ? ties + " saves tie" : "several saves tie") + " · equip + save the tune to pin it",
      sheet: "dead", sheetSub: "needs one save" };
  }
  if (st.key === "variation") return { tone: "acc", ident: "✓ REMEMBERED", detail: nSl + " slider" + (nSl === 1 ? "" : "s") + " off a saved build · tuning guaranteed", sheet: "outline" };
  if (st.key === "clone") return { tone: "acc", ident: "✓ REMEMBERED", detail: "clone · unlocked · save it to keep", sheet: "outline" };
  if (rs.key === "unsaved") {   // truly unsaved: hardware changed / no match, nothing on disk
    if (rs.locked) return { tone: "warn", ident: "◷ IMPORTING", detail: "history catching up", sheet: "dead", sheetSub: "importing" };
    const d = [nSl ? nSl + " slider" + (nSl === 1 ? "" : "s") + " moved" : "", nPa ? nPa + " part" + (nPa === 1 ? "" : "s") + " changed" : ""].filter(Boolean).join(" · ");
    return { tone: "bad", ident: "◌ NEW BUILD", detail: (d ? d + " · " : "") + "equip + save to remember it", sheet: "dead", sheetSub: "needs a save" };
  }
  // resolved (remembered)
  const tree = (rs.hwN || 1) + " hw · " + (rs.tunes || 1) + " tune" + ((rs.tunes || 1) === 1 ? "" : "s");
  if (st.key === "ratified") {
    const m = MATCH && MATCH.build, laps = (m && m.laps) || 0, courses = (m && m.courses) || 0;
    const hist = laps ? laps + " lap" + (laps === 1 ? "" : "s") + (courses ? " · " + courses + " course" + (courses === 1 ? "" : "s") : "") : "your build";
    return { tone: "acc", ident: "✓ REMEMBERED", detail: hist + " · tuning guaranteed", sheet: "outline" };
  }
  return { tone: "acc", ident: "✓ REMEMBERED", detail: "downloaded · equip + save to read the tune", sheet: "filled" };   // downloaded / locked
}

// THE HASH TABLE (header handoff §5): the two tiers as a table, not chip columns. Each row is one
// hardware hash (its gear ladder + tune count) with the slider hashes (tunes) under it. --acc on the
// car's CURRENT hardware row and on the IDENTIFIED tune. Rows keep the data-act="upg"/"tune" handlers.
function hashTableHTML() {
  const groups = carUpgradeGroups();
  if (groups.length < 1) return `<div class="hth-empty t-l">no saved build on this car yet</div>`;
  const curHw = MATCH ? rimFree(MATCH.pk) : null, curSk = MATCH ? MATCH.sk : null;
  const selKey = UPG_SEL || curHw;
  const tsOf = (b) => (b.saves || [])[0] || (b.c || "").split("_").pop() || "";
  // FITS THE BAND (handoff §1/§7): the band shows at most CAP hardware rows -- the current one first,
  // then the rest -- and sheds the overflow to a "+N more" line rather than clipping or scrolling.
  const CAP = 3;
  const ordered = groups.slice().sort((a, b) => (a.key === curHw ? -1 : 0) - (b.key === curHw ? -1 : 0));
  const shown = ordered.slice(0, CAP), moreN = ordered.length - shown.length;
  const rows = shown.map((g) => {
    const gears = (g.builds[0] || {}).gears, isCur = g.key === curHw, isSel = g.key === selKey;
    const seen = new Set(), tunes = [];
    g.builds.forEach((b) => { if (!seen.has(b.skey)) { seen.add(b.skey); tunes.push(b); } });
    const tuneCells = tunes.map((b) => {
      const on = b.skey === curSk && isCur;
      return `<button class="hth-tune${on ? " on" : ""}" data-act="tune" data-ts="${esc(tsOf(b))}" title="identify this tune">${esc(shedName(b.name || b.label || "unnamed", 26))}</button>`;
    }).join("");
    return `<div class="hth-row${isSel ? " sel" : ""}${isCur ? " cur" : ""}">
      <button class="hth-hw" data-act="upg" data-hw="${esc(g.key)}" title="${g.builds.length} tune${g.builds.length > 1 ? "s" : ""} on this hardware${isCur ? " · the car's current hardware" : ""}">${gears ? gears + "-spd" : "hw"}<i>${g.builds.length}</i></button>
      <div class="hth-tunes">${tuneCells || `<span class="t-l">no tune</span>`}</div>
    </div>`;
  }).join("");
  const more = moreN > 0 ? `<div class="hth-morerow t-l">+${moreN} more hardware — pick one below to see its tunes</div>` : "";
  return `<div class="hth"><div class="hth-head"><span class="t-l">upgrade</span><span class="t-l">slider hash</span></div>${rows}${more}</div>`;
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

// THE TWO TIERS, in the header (Jett 2026-09-06). hw_hash (upgrades) -> tune_hash (sliders): this car's
// builds group by HARDWARE (the rim rule, rimFree), and under a matched upgrade its tunes list by common
// name. Picking a tune identifies it (the same setPin+identify the save picker uses). This is the reverse
// direction — distinguish/compare by the two hashes, never the gear ladder (see memory two-directions).
let UPG_SEL = null;      // hardware-group key whose tunes the right column shows (null = the matched/current one)
let CHG_OPEN = false;    // the slim header CHANGE chip is expanded into the full banner below

function carUpgradeGroups() {
  if (!(IDENT && CUR)) return [];
  // SHARED CLASS ONLY (Jett 2026-09-06): hardware sets the PI, so different engine builds land in
  // different classes — you almost never tune across a class boundary. Filter on the DRIVEN class `dcls`
  // (what the game reported when the build was driven, joined in build_web from pi-observations) — the
  // stored `cls` is only the car's stock class and cannot separate builds. Reference class = the equipped
  // build's own driven class (exact and stable even in a menu, where the live read goes stale), else the
  // live on-track read. Drop only builds CONFIRMED to be a different class; unclassed builds (never driven)
  // are kept and never dropped, and the classing self-fills as more builds are driven.
  const cls = (MATCH && MATCH.build && MATCH.build.dcls) || ((CUR.cls && CUR.cls !== "?") ? CUR.cls : null);
  const same0 = IDENT.builds.filter((b) => b.o === CUR.ordinal);
  const same = cls ? same0.filter((b) => !b.dcls || b.dcls === cls) : same0;
  const groups = new Map();                         // hardware key -> its builds (the tunes under it)
  same.forEach((b) => {
    const k = rimFree(b.pkey);
    let g = groups.get(k); if (!g) groups.set(k, g = { key: k, builds: [] });
    g.builds.push(b);
  });
  return [...groups.values()];
}

function similarGroupsHTML() {
  const groups = carUpgradeGroups();
  if (groups.length < 1) return "";
  const curHw = MATCH ? rimFree(MATCH.pk) : null;
  const curSk = MATCH ? MATCH.sk : null;
  const sel = groups.find((g) => g.key === (UPG_SEL || curHw)) || groups[0];
  const matched = sel.key === curHw;                // "if upgrade matched": only then are its tunes the equipped set
  const seen = new Set(), tunes = [];               // one chip per distinct tune (skey), by common name
  sel.builds.forEach((b) => { if (!seen.has(b.skey)) { seen.add(b.skey); tunes.push(b); } });
  const upgChip = (g) => {
    const gears = (g.builds[0] || {}).gears;
    return `<button class="hg-chip${g.key === sel.key ? " on" : ""}${g.key === curHw ? " match" : ""}" data-act="upg" data-hw="${esc(g.key)}"
      title="${g.builds.length} tune${g.builds.length > 1 ? "s" : ""} on this hardware${g.key === curHw ? " · the car's current hardware" : ""}">${gears ? gears + "-spd" : "hw"}<i>${g.builds.length}</i></button>`;
  };
  const tsOf = (b) => (b.saves || [])[0] || (b.c || "").split("_").pop() || "";   // the container carries the save stamp (Tuning_<ord>_<stamp>)
  const tuneChip = (b) => `<button class="hg-chip${(b.skey === curSk && matched) ? " on" : ""}" data-act="tune" data-ts="${esc(tsOf(b))}"
      title="identify this tune">${esc(b.name || b.label || "unnamed")}</button>`;
  return `<div class="hgroups">
    <div class="hgcol">
      <div class="hgh">similar upgrades <i>${groups.length}</i></div>
      <div class="hgbody">${groups.map(upgChip).join("")}</div>
    </div>
    <div class="hgcol">
      <div class="hgh">tunes under it${matched ? "" : " · unmatched"} <i>${tunes.length}</i></div>
      <div class="hgbody">${tunes.length ? tunes.map(tuneChip).join("") : `<span class="hg-empty t-l">no tunes on this hardware</span>`}</div>
    </div>
  </div>`;
}

function changeSlim() {
  if (!CHANGE) return "";
  // A DOWNLOADED (locked) tune is not a change you made -- never render "hardware changed" / "sliders moved" for
  // it, however the CHANGE got here: the live fingerprint (guarded in live.js) OR a STALE one restored from the
  // view store (a fresh session doesn't have it, which is why the preview looked clean while the banner stuck).
  if (CUR && CUR.disk && CUR.disk.tune && CUR.disk.tune.locked && !CHANGE.saved && (CHANGE.kind === "hardware" || CHANGE.kind === "tune")) return "";
  const k = CHANGE.kind;
  const label = CHANGE.saved ? "new save read" : k === "hardware" ? "hardware changed"
    : k === "tune" ? ((CHANGE.sliders || []).length + " slider" + ((CHANGE.sliders || []).length === 1 ? "" : "s") + " moved")
    : k === "same" ? "re-saved" : "changed";
  const tone = CHANGE.saved ? "on" : k === "hardware" ? "r" : "b";
  // a STATUS pill, not a control (2026-09-12): it used to be a button whose "show the details below" toggle
  // drove #alerts, but #alerts is emptied unconditionally now, so the click revealed nothing. Just states the change.
  return `<span class="hchg ${tone}" title="what changed on the car since the last save the daemon read">● ${esc(label)}</span>`;
}

// what the header SAYS, per state — pure, so it can be read and tested on its own
// CONTENT SHEDS TOKENS; TYPE NEVER SHEDS PIXELS (header handoff §3). The old runtime shrinker measured
// scrollWidth and stepped font-size down in a loop on EVERY header rebuild -- a read/write reflow thrash
// that, when the identified car flipped (a lobby, a re-read), made the band strobe and spammed
// "[header] still clipped". This sheds the string deterministically instead (no DOM measurement, so the
// result is stable across rebuilds and cannot flicker): drop a parenthetical, then a leading year, then
// truncate. The full text stays in the element's title. Budgets are generous, so short names are untouched.
function shedName(text, max) {
  if (!text) return text || "";
  let s = String(text).trim();
  if (s.length <= max) return s;
  s = s.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();   // drop parentheticals
  if (s.length <= max) return s;
  s = s.replace(/^(19|20)\d\d\s+/, "").trim();                          // drop a leading model year
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";                      // last resort — a real ellipsis
}
// THE GUARANTEED TUNE-ID WORKFLOW (Jett 2026-09-11): auto-identifying WHICH saved tune is on the car was
// never 100% from telemetry alone; equipping through the game's own tune list is. This is the reliable path,
// shown persistently in the header whenever the current tune is unsettled. In My Tuning Setup the tile whose
// PI badge is a GREY MINUS ( – ) is the tune on the car (the red ▼ tiles are not). See the memory
// fh6-tune-identification-equip-workflow. `short` sits in the band; `title` carries the full steps on hover.
const TUNE_ID_GUARANTEE = {
  short: "Sure-fire fix: re-equip it — in My Tuning Setup the grey-minus ( – ) tile is the tune on the car",
  title: "Guaranteed tune identification: Find build → equip build → Start → Buy used & new cars → travel to the festival site → Cars → Upgrades and Tuning → My Tuning Setup → the tile whose PI badge shows a grey minus ( – ) is the tune currently on the car (the red ▼ tiles are others). Equipping it this way lets the daemon fully decode it.",
};
function headerCopy(st, q) {
  const m = MATCH && MATCH.build;
  const mm = (CUR && CUR.match) || {};
  // THE TUNE'S OWN NAME (Jett 2026-09-08: "we need to implement the tune common name predominantly").
  // `CUR.disk.name` is the CAR's name -- /disk-tune builds it from names.json keyed by ordinal -- so
  // this used to fall back to the car name whenever the database did not yet hold the build, and the
  // header printed "1987 Nissan Be-1" in both the car slot and the tune slot. The save carries its own
  // name in the container header; the daemon now returns it as `tune_name`.
  const tune = (m && m.name) || (CUR && CUR.disk && CUR.disk.tune_name) || "";
  const nSaves = mm.n_saves || 0;
  const when = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }); };
  const car = (CUR && CUR.name) || (CUR ? "ordinal " + CUR.ordinal : "");
  // 2026-09-03 (Jett, final spec for this panel): exactly four fields, in this order -- (1) car
  // make/model/year, (2) the tune's name as identified in the save, (3) the CURRENT STATUS of the
  // selected tune (the short canonical label -- downloaded/unknown/variation/clone/ratified, per
  // buildStatus()'s own docstring at the top of this file -- not the long descriptive headline that
  // used to occupy this slot), (4) the next step to raise that status. `car` used to be the LAST,
  // smallest thing in the header, after the state headline, the tune's custom name, and the creator
  // credit; it's now first and biggest. `status` is new: distinct from `lead`, which stays as the
  // longer state-specific headline available for a state that still needs one (ambiguous identity).
  const creator = (m && m.creator) || (CUR && CUR.disk && CUR.disk.creator) || "";
  const byline = [creator ? "by " + creator : "", m && m.created ? when(m.created) : ""].filter(Boolean).join(" · ");
  // HONEST NEW-CAR STATE: a car added after our last game-DB decode has only a STUB ref_car row (display_name
  // "ordinal N", no class/PI, its stock engine absent from the catalog). It can't be named or classed, so the
  // header must say so plainly instead of implying a resolved identity. Set once here so the flag survives the
  // state-specific Object.assign branches below. Identity for it comes from the live frame (daemon cyl-bootstrap);
  // name/class/PI resolve only on a game-DB re-import.
  const newcar = !!(CUR && /^ordinal\s+\d+$/i.test(String(carName(CUR.cid) || "")));   // stub ref_car (catalog name "ordinal N") = a car added since our last game-DB decode; class/PI here come from the live frame, so the NAME is the only reliable stub signal
  const base = { tone: "dim", lead: "", sub: "", tune, car, status: st.label || "", byline, why: st.why || "", step: (st.steps || [])[0] || "",
                 rest: (st.steps || []).slice(1), primary: null, noBtn: "", caption: "", evidence: "", guarantee: "",
                 newcar, newcarNote: newcar ? "new car — not in the game database yet. Name, class and PI are pending a game-DB re-import; identity is inferred from live telemetry." : "" };

  // AMBIGUITY OVERRIDES EVERY STATUS: which build is on the car outranks what kind of build it is
  if (q && (q.level === "ambiguous" || q.level === "conflict")) {
    const ties = mm.n_signature_ties || 0;
    // A PICK WAITING ON THE LIVE CAR. The daemon only stores a manual pick the running engine
    // corroborates -- the picked save's cylinders must match the live cylinders (fh6_live_daemon.py:1337),
    // and a pick it cannot verify is not stored at all (:2076). Paused in a menu there is no live cylinder
    // reading (live_cyl 0), so the pick evaporated and this card snapped straight back to "pick the save"
    // as if the click did nothing -- the defect Jett hit. When a pick IS pinned, the car does not
    // contradict it (ambiguous, not conflict), and it simply has no live engine yet (live_cyl falsy), say
    // so: the pick is held, it only needs a moment of driving to confirm (and the ladder usually settles
    // it anyway). live_cyl being read but WRONG stays the contradiction path below.
    if (CUR && pinnedTs(CUR.ordinal) && !mm.picked_ok && !mm.live_cyl && q.level !== "conflict") {
      return Object.assign(base, { tone: "warn", lead: "PICK NOTED — DRIVE TO CONFIRM",
        sub: q.why,
        why: "the save you picked is held, but the daemon only accepts it once the live engine confirms it — idle in a menu its cylinders can't be read, so it isn't settled yet",
        step: "drive out of the menu for a few seconds — the gear ladder usually settles it on its own, and confirms the pick either way",
        rest: [], primary: null, caption: "pick pending", guarantee: TUNE_ID_GUARANTEE,
        evidence: (mm.how || "") + (nSaves ? " · " + nSaves + " saves" : "") });
    }
    // 2026-09-03 (Jett flagged this reading "wild"): the headline used to say "ONE OF 8" right
    // above a sub-line saying "7 of 8 tie" — two different numbers about the same 8 saves, never
    // reconciled. Dropped the count from the headline entirely; sub (q.why) is the one place the
    // count is stated now. `why` used to restate sub in different words ("the live packet carries
    // only cylinders...") -- same three facts, twice, in two boxes on one card. Replaced with what
    // sub does NOT say: what happens next.
    return Object.assign(base, { tone: "warn",
      lead: q.level === "conflict" ? "IDENTITY CONTRADICTED" : "IDENTITY NOT SETTLED",
      sub: q.why, why: "the live telemetry alone can't separate them — cylinders, drivetrain and PI are all it carries",
      // the build picker is retired (Jett 2026-09-11): the one way to settle it is the save-tune method
      step: "equip the build, then save the tune in-game — the new save is read exactly",
      rest: [], primary: null, caption: "identity unsettled", guarantee: TUNE_ID_GUARANTEE,
      evidence: (mm.how || "") + (nSaves ? " · " + nSaves + " saves" : "") });
  }
  if (st.key === "offline") return Object.assign(base, { tone: "dim", lead: "DAEMON DOWN — NOTHING HERE IS LIVE",
    sub: "everything below is the last thing seen", step: "python scripts/telemetry/fh6_live_daemon.py",
    rest: [], primary: { label: "COPY COMMAND", act: "copycmd" }, caption: "not live" });
  if (st.key === "downloaded") {
    // ONE BUTTON (2026-09-03, Jett): CLONE PLAN / OPEN THE TARGET used to sit here as their own
    // primary button, both with act:"sheet" -- the identical destination BUILD SHEET already opens
    // one slot over. Opening the sheet is never really "just a peek" here; it's step one of cloning
    // either way, so a second, differently-labelled button to the same place added a choice with no
    // real difference behind it. Removed; the why/step text below still carries the clone framing,
    // build sheet is the one door.
    const froz = frozenOf();
    return Object.assign(base, { tone: "warn",
      lead: froz ? "LOCKED — FROZEN AS YOUR TARGET" : "LOCKED — SOMEONE ELSE'S BUILD",
      sub: (m && m.desc) || "every part and slider decodes from the save — only editing it in-game is locked",
      why: froz ? "build this car back to the frozen sheet, then save it with a name" : "someone else's build; it reads and clones cleanly — it just can't be tuned until it is yours",
      step: froz ? "build back to the sheet, then save it with a name" : "clone it onto a second copy of the car, or keep this sheet as your target",
      noBtn: froz ? "NO BUTTON — BUILD SHEET ABOVE IS YOUR TARGET" : "NO BUTTON — USE BUILD SHEET ABOVE TO CLONE IT",
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
  if (st.key === "unknown" && st.rebuild && CUR && CUR.disk && CUR.disk.deliverable && CUR.disk.deliverable.locked) {
    // A DOWNLOADED (locked) tune whose hardware the DB does not HOLD yet is buildStatus 'unknown' + locked
    // (line 111, the ONLY unknown branch that sets rebuild:true). It is already on disk and fully decoded
    // from the save -- the history import runs by itself -- so it must NEVER read as "save the tune in-game
    // and give it a name" (Jett 2026-09-07: "even though the tune was just downloaded and is on disk"). Show
    // downloaded/importing instead. The st.rebuild guard keeps genuine PI-DRIFT (line 104 -- hardware changed
    // in-game and unsaved, which can still carry a locked prior deliverable) on the correct "save it" path.
    const importing = RB.state === "running" || RB.pending;
    return Object.assign(base, { tone: importing ? "dim" : "warn",
      lead: importing ? "DOWNLOADED — IMPORTING FOR HISTORY" : "DOWNLOADED — HISTORY IMPORT PENDING",
      sub: importing ? "about 10 s · " + Math.max(0, Math.round((Date.now() - (RB.startedAt || Date.now())) / 1000)) + " s elapsed"
                     : "identified from the save; the history import runs by itself",
      why: "a downloaded tune is already on disk and fully decoded — only the database history is catching up; there is nothing to save",
      step: "nothing to do — the import runs by itself; clone it from the BUILD SHEET to make it yours",
      rest: [], noBtn: importing ? "IMPORTING…" : "NO BUTTON — IT IMPORTS ITSELF", caption: "as downloaded" });
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
    CUR && CUR.liveries && CUR.liveries.length, CHANGE && CHANGE.at, UPG_SEL, CHG_OPEN,
    IDENT && CUR && IDENT.builds.filter((b) => b.o === CUR.ordinal).length]);
  if (key === HDR_KEY && h.querySelector(".hcar")) { paintChips(); return; }
  HDR_KEY = key;

  const m = MATCH && MATCH.build;
  const c = CUR ? headerCopy(st, q) : { tone: "dim", lead: "WAITING FOR A CAR", sub: MODE.reason || "no signal yet",
    tune: "", car: "no car", status: "—", byline: "", why: "get in a car in the game", step: "the header fills the moment a frame names it",
    rest: [], primary: null, noBtn: "", caption: "no car", evidence: "" };
  const liv = CUR && (CUR.liveries || []).find((l) => l.thumb);
  const img = m && m.thumb ? `${API}${m.thumb}` : liv ? `${DAEMON}/livery-thumb?ordinal=${CUR.ordinal}&d=${encodeURIComponent(liv.dir)}` : null;

  h.dataset.tone = c.tone;
  // THE BAND (2026-09-11 header collapse): a flat 120px, two columns — the identity text on the left
  // (1fr) and the car's livery as a hero tile on the right (240px), NOT washed behind the text. Row A
  // merges the PI badge + save/lock chip + CHANGE chip + car name onto one line (the 28px badge governs
  // its height); Row B is the tune name; Row C is the one gate strip pairing the identity we have with
  // the single action this state affords. The old evidence column folds into the gate's state cell; the
  // guarantee walkthrough folds into an ⓘ tooltip; the verdict folds into the state ident (see gateStrip).
  // Height is fixed in every state on purpose: a state-conditional row would jitter the course view below.
  const rs = resolutionState();
  const g = gateStrip(st, rs);
  const FILL = { pick: "acc2", sheet: "warn", ab: "acc2", base: "acc", rebuild: "acc2", copycmd: "line2" };
  const fill = c.primary ? (FILL[c.primary.act] || "acc") : null;
  const reach = !!(MATCH && MATCH.build);
  const resolved = rs.key === "resolved";
  const busy = RR.busy || RB.state === "running" || RB.pending;
  const ev = c.evidence || (q.level === "ok" ? q.why : "") || "";
  // THE LIVERY HERO TILE: an image-only 240×120 frame. With a thumb, an <img object-fit:cover> (sharper
  // than a stretched background at this size, and the source PNG is a clean alpha cutout). With a car but
  // no thumb, a class-tinted glow plate (the same --pc-* token the PI badge wears). With no car at all,
  // a flat plate — no class exists yet to tint by.
  const livGlow = CUR ? piColor(CUR.cls) : "";
  h.innerHTML = `
    <div class="hlivery"${!CUR ? ' data-fill="empty"' : (!img ? ' data-fill="glow"' : "")}${livGlow ? ` style="--liv:${livGlow}"` : ""}>
      ${img ? `<img src="${img}" alt="">` : ""}
    </div>
    <button class="icobtn hreload" id="btnRefresh" ${busy ? "disabled" : ""}
      title="re-read this car's save from disk, and import it if the database does not hold it — both happen by themselves; this is the manual override.">${busy ? "…" : "⟳"}</button>
    <div class="hident">
      <div class="hrowa">
        ${CUR ? `<span class="hpi artpi">${piBadge(CUR.cls, CUR.pi)}</span>` : ""}
        ${c.newcar ? `<span class="hnew t-l" tabindex="0" title="${esc(c.newcarNote)}">◈ NEW CAR</span>` : ""}
        ${rs.locked ? `<span class="hlock t-l">🔒 ${esc(c.caption || "locked")}</span>` : (c.caption ? `<span class="hcap t-l">${esc(c.caption)}</span>` : "")}
        ${changeSlim()}
        <span class="hcar t-d" title="${esc(c.car)}${c.byline ? " — " + esc(c.byline) : ""}">${esc(shedName(c.car, 30))}</span>
      </div>
      <div class="htitle t-t" title="${esc(c.tune || "")}">${c.tune ? `${resolved ? `<b class="tick">✓</b> ` : ""}${esc(shedName(c.tune, 40))}` : `<span class="t-l empty">${CUR && CUR.disk ? "unnamed save" : "no save on disk for this car"}</span>`}</div>
      <div class="hgate">
        <div class="gcell gstate" data-tone="${g.tone}" title="${esc(rs.hint || g.detail || "")}"><b>${esc(g.ident)}</b><span>${esc(g.detail)}</span>${ev ? `<span class="gev" title="${esc(ev)}">${esc(ev)}</span>` : ""}</div>
        <span class="garrow" data-w="${(g.tone === "bad" || g.tone === "warn" || g.sheet === "dead") ? "weak" : "strong"}"></span>
        ${g.sheet === "filled" ? "" : (c.primary
          ? `<button class="gprim" id="btnPrim" data-act="${esc(c.primary.act)}" data-fill="${fill}">${esc(c.primary.label)}</button>`
          : `<div class="ginstr t-b">${esc(c.step || c.noBtn || "")}${c.guarantee ? ` <span class="hinfo" tabindex="0" title="${esc(c.guarantee.short + " — " + c.guarantee.title)}">ⓘ</span>` : ""}</div>`)}
        ${g.sheet === "filled"
          ? `<button class="gsheet filled" id="btnSheet">🔓 BUILD SHEET ▸<em>unlocks this build</em></button>`
          : g.sheet === "outline" && reach
            ? `<button class="gsheet outline" id="btnSheet">🔓 BUILD SHEET ▸<em>the full sheet</em></button>`
            : `<div class="gsheet dead">🔒 BUILD SHEET<em>${esc(g.sheetSub || "needs a save")}</em></div>`}
      </div>
    </div>`;

  // HASH TABLE RETIRED (Jett 2026-09-11): the upgrade/slider-hash table was less useful than hoped, so the
  // header no longer renders it (hashTableHTML kept but uncalled). Identifying a tune is the save-tune equip
  // workflow now, not clicking a hash cell (see memory fh6-tune-identification-equip-workflow); the .hth-hw /
  // .hth-tune wiring went with it.
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
  // (The runtime font-size shrinker that lived here is gone -- it measured scrollWidth and stepped the
  // font down every rebuild, a reflow thrash that strobed the band when the identified car flipped.
  // shedName() now sheds CONTENT at render time instead, deterministically, so nothing here touches
  // layout after paint. See the note above headerCopy().)
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
// THE ALERTS TICKER (Jett 2026-09-07): all the alert data streams across the news-ticker row below the nav.
// Each alert / context fact is one item [tone,label,text]; the label hue of the most urgent one colours the
// ticker's fixed left tag. The track is rendered twice so a translateX of -50% loops seamlessly, and the
// duration scales with the content length so the pace stays readable. A key guards the render so a repaint
// that changes nothing does not restart the scroll mid-stream.
let TICKER_KEY = null;
function paintTicker() {   // RETIRED 2026-09-11: the #ticker element was removed; this is now an inert no-op (kept only so any stray caller is harmless)
  const el = $("#ticker"); if (!el) return;
  const st = buildStatus(), q = matchQuality(CUR && CUR.match), ch = CHANGE || {};
  const items = [];
  // --- alerts (urgent first) ---
  if (CHANGE) {
    const ns = (ch.sliders || []).length, np = (ch.slots || []).length;
    const _locked = !!(CUR && CUR.disk && CUR.disk.tune && CUR.disk.tune.locked);   // downloaded tune -> not a change you made (matches changeSlim)
    if (ch.saved) items.push(["ok", "SAVED", "new save read from disk" + ((CUR && CUR.disk && CUR.disk.tune_name) ? " — “" + CUR.disk.tune_name + "”" : "")]);
    else if (!_locked && ch.kind === "hardware") items.push(["bad", "HARDWARE CHANGED", `${np} part${np === 1 ? "" : "s"} · ${ns} slider${ns === 1 ? "" : "s"} — not saved`]);
    else if (!_locked && ch.kind === "tune") items.push(["warn", "SLIDERS MOVED", `${ns} slider${ns === 1 ? "" : "s"} changed, same hardware`]);
  }
  if (CUR && CUR.disk && (q.level === "ambiguous" || q.level === "conflict")) {
    const _mm = (CUR && CUR.match) || {}, ties = _mm.n_signature_ties || 0;
    if (pinnedTs(CUR.ordinal) && !_mm.picked_ok && !_mm.live_cyl && q.level !== "conflict")
      items.push(["warn", "PICK PENDING", "pick noted — drive out of the menu for a few seconds to confirm it"]);
    else
      items.push(["warn", q.level === "conflict" ? "IDENTITY CONTRADICTED" : "IDENTITY NOT SETTLED", `${ties || "several"} saves tie — equip the build and save the tune in-game`]);
  }
  (st.steps || []).forEach((s, i) => items.push([st.tone === "bad" ? "bad" : st.tone === "warn" ? "warn" : "", `STEP ${i + 1}`, s]));
  // --- ambient context (always-on) ---
  if (CUR) items.push(["", "CAR", (CUR.name || ("ordinal " + CUR.ordinal)) + (CUR.cls && CUR.cls !== "?" ? " · " + CUR.cls + " " + CUR.pi : "")]);
  if (MODE.suggest === "course" && COURSE) items.push(["blue", "COURSE", (COURSE.name || COURSE.key) + ((COURSE.laps || []).length ? ` · ${(COURSE.laps || []).length} laps on record` : "")]);
  else if (typeof ROUTE !== "undefined" && ROUTE) items.push(["blue", "ROUTE", ROUTE.name]);
  if (RB.last && RB.last.finished) items.push(["ok", "DATABASE", "up to date"]);
  if (!items.length) items.push(["", "FH6 LAB", "no action to take — telemetry live"]);
  const key = JSON.stringify(items);
  if (key === TICKER_KEY && el.querySelector(".tick-track")) return;   // unchanged -> do not restart the scroll
  TICKER_KEY = key;
  const rank = { bad: 3, warn: 2, blue: 1, ok: 0, "": 0 };
  const top = items.reduce((m, x) => rank[x[0]] > rank[m] ? x[0] : m, "");
  el.dataset.top = (top === "bad" || top === "warn") ? top : "";
  const one = items.map(([tone, label, text]) => `<span class="tick-item ${tone}"><b>${esc(label)}</b>${esc(text)}</span>`).join("");
  const chars = items.reduce((n, x) => n + x[1].length + x[2].length + 8, 0);
  const dur = Math.max(24, Math.round(chars / 5.5));   // readable pace, scales with content
  el.innerHTML = `<span class="tick-label"><i></i>${(top === "bad" || top === "warn") ? "ALERT" : "LAB"}</span>` +
    `<div class="tick-win"><div class="tick-track" style="animation-duration:${dur}s">${one}${one}</div></div>`;
}

// #alerts now holds ONLY the one interactive alert -- the save picker for an ambiguous identity, which the
// header's PICK THE SAVE scrolls to and cannot be a scrolling marquee. Everything else is in the ticker.
function paintBanner() {
  // the scrolling alerts ticker was retired (Jett 2026-09-11) to give the car header + panes its 24px row —
  // every ticker item already lives in the #lastact status bar (+ its log), the #hdr gate strip, and the id bar.
  // THE BUILD PICKER IS RETIRED (Jett 2026-09-11): builds are not picked from a list of signature ties -- the
  // tune is identified only by the save-tune method (equip the build, save the tune in-game, the save is read).
  // pickerHTML()/wirePicker() in live.js are left unrendered; #alerts stays empty.
  const al = $("#alerts"); if (!al) return;
  al.innerHTML = "";
  al.classList.add("empty");
}

/* ------------------------------------------------------------- left */
let LEFT_KEY = null;
function paintLeft() {
  const hd = $("#leftHd"), body = $("#leftBody"); if (!body) return;
  const course = MODE.suggest === "course" && COURSE;
  // 169 polylines are not free: rebuild the map only when what it shows changes, and let the
  // live dot ride on the map that is already there.
  // BROWSE_PICK is deliberately NOT in this key: a browser pick must NOT rebuild the map (that would kill the
  // viewBox animation) — browsePick() updates the highlight + eases the frame on the SVG that is already there.
  // MODE.game is NOT keyed at all (Jett 2026-09-10). Neither the world map nor the course map depends on
  // game -- the live dot (addLiveDot) and the speed trace update on their own paths -- yet MODE.game flips
  // menu<->freeroam<->event on every pause/resume, and keying it rebuilt the whole SVG each flip (replacing
  // the node mid-animation in free roam, and repainting every trace polyline on a course event-start pause).
  // Confirmed by a LEFT_KEY field-diff capture: an event->menu blip flipped ONLY `game` and forced a rebuild
  // with an otherwise-identical map. The course pill's EVENT/RIVALS label rides the next real rebuild.
  const key = JSON.stringify([!!course, course && COURSE.key, WORLD && Object.keys(WORLD.routes).length, MODE.suggest, TRACE_PICK && TRACE_PICK.ids && TRACE_PICK.ids.length, TRACE_PICK && TRACE_PICK.fore, ROUTE && ROUTE.id, turnPickSeq(), TURN_SORT, MAP_VIEW]);
  if (key === LEFT_KEY && body.querySelector("svg")) { addLiveDot(body); return; }
  LEFT_KEY = key; FOLLOW.span = null; FOLLOW.full = null;
  if (course) {
    const nSel = (TRACE_PICK && TRACE_PICK.key === COURSE.key && TRACE_PICK.ids) ? TRACE_PICK.ids.length : Object.keys(COURSE.traces || {}).length;
    // the track OWNS this pane's title once it is identified — as the same COURSE INFORMATION PILL the world
    // map header uses (Jett 2026-09-07), fed from the learned COURSE plus the catalogued route it matched
    // (classes/modes/shape come from the route; name/length/turns/laps are the course's own driven facts).
    const _cr = COURSE.route || {};
    const _wr = (_cr.route_id && WORLD && WORLD.routes && WORLD.routes[_cr.route_id]) || null;
    // the demoted hero detail (shape glyph, laps-by-class bars, confidence, freshness) rides IN the pill's
    // drawer now; the compact facts line goes above the map (see courseHeroParts / the collapse).
    const heroParts = courseHeroParts(COURSE, activeLapSet(), nSel);
    hd.innerHTML = courseInfoPill({
      id: _cr.route_id, name: COURSE.name || ("unnamed course " + COURSE.key),
      pts: (_wr && _wr.pts) || COURSE.path || null,
      len: COURSE.len, loop: _wr ? _wr.loop : _cr.is_loop,
      is_race: _wr ? _wr.is_race : !!COURSE.rivals,
      modes: (_wr && _wr.modes) || (COURSE.rivals ? ["rivals"] : []),
      disc: _wr && _wr.disc, classes: (_wr && _wr.classes) || [], class_data: (_wr && _wr.class_data) || [],
      lap_class: (_wr && _wr.lap_class) || [], lap_car: (_wr && _wr.lap_car) || [],
      laps: (COURSE.laps || []).length, lapsDrawn: nSel, turns: (COURSE.turns || []).length,
      kindLabel: COURSE.rivals ? "RIVALS" : MODE.game === "event" ? "EVENT" : null,
      nameChip: nameChip(COURSE.naming), drawerExtra: heroParts.drawer,
    }, "course");
    // the pill's drawer lives in #leftHd, so its click-to-scope class bars aren't caught by the #leftBody
    // wiring below — bind them here (the rail in #leftBody is bound with the rest at data-clsbar).
    hd.querySelectorAll("[data-clsbar]").forEach((b) => b.onclick = () => { const cur = activeLapSet().cls; setScopeClass(cur === b.dataset.clsbar ? null : b.dataset.clsbar); });
    // The LEFT pane ALWAYS shows the whole-course map + hero + turn list (Jett 2026-09-11). Selecting a turn
    // only HIGHLIGHTS its marker + paints its phases on this map (courseMap's turnPick arg); the per-turn line
    // trace + phase rail now live in the RIGHT pane beside that turn's stats (cornerMapHTML in turnStatsHTML).
    const pick = (TRACE_PICK && TRACE_PICK.key === COURSE.key) ? TRACE_PICK : {};
    body.innerHTML = "";
    body.insertAdjacentHTML("beforeend", heroParts.facts);   // the compact course-facts line above the map (was .chero)
    // COURSE VIEW IS STATIC: no follow-preview zoom here (Jett 2026-09-06). courseMap() fits the whole course
    // to the pane and carries its own always-visible bottom-left legend (which houses the map-view toggle);
    // the DATA filter is in the shared #coursefilter bar, not here.
    body.append(courseMap(COURSE, { laps: pick.ids, fore: pick.fore, turnPick: turnPickSeq(), view: MAP_VIEW, legOpen: MAP_LEG_OPEN }));
    body.insertAdjacentHTML("beforeend", turnTableHTML(COURSE, activeLapSet()));   // redesign phase B: the sortable turn list
    wireTrace(body); addLiveDot(body); liveLapPaint();   // a rebuilt map redraws the live lap once, then appends
    // a turn marker OR a turn-list row selects that turn (highlight its phases here, full stats on the
    // right); the SVG/list is rebuilt on select, so re-bind every paint. Clicking the selected one clears.
    body.querySelectorAll("[data-turn]").forEach((g) => g.onclick = () => pickTurn(g.dataset.turn));
    body.querySelectorAll("[data-tsort]").forEach((b) => b.onclick = () => { TURN_SORT = b.dataset.tsort; try { localStorage.setItem("fh6TurnSort", TURN_SORT); } catch (e) {} LEFT_KEY = null; paintLeft(); });
    body.querySelectorAll("[data-mapview]").forEach((b) => b.onclick = () => { MAP_VIEW = b.dataset.mapview; try { localStorage.setItem("fh6MapView", MAP_VIEW); } catch (e) {} LEFT_KEY = null; paintLeft(); });
    body.querySelectorAll("[data-maplayer]").forEach((b) => b.onclick = () => { const k = b.dataset.maplayer; MAP_LAYERS[k] = !MAP_LAYERS[k]; try { localStorage.setItem("fh6MapLayers", JSON.stringify(MAP_LAYERS)); } catch (e) {} LEFT_KEY = null; paintLeft(); });
    // WHAT THE LIVE TRAIL'S COLOUR MEANS (Jett 2026-09-11: selectable in the map legend's settings) -- the same
    // state as the speed trace's paint toggle, so the two views of the live lap can never disagree
    body.querySelectorAll("[data-trailpaint]").forEach((b) => b.onclick = () => { TRACE_MODE = b.dataset.trailpaint; saveTraceMode(); TRACE_KEY = null; LEFT_KEY = null; paintTrace(); paintLeft(); paintCourseFilter(); });
    body.querySelectorAll("[data-tcx]").forEach((b) => b.onclick = () => exitTempCourse());   // leave the temporary course-browser view
    body.querySelectorAll("[data-clsbar]").forEach((b) => b.onclick = () => { const cur = activeLapSet().cls; setScopeClass(cur === b.dataset.clsbar ? null : b.dataset.clsbar); });   // laps-by-class bar → scope
    // the legend key toggles IN PLACE (no map rebuild → no re-animation): flip the pill's open state + the key rows
    body.querySelectorAll("[data-legtoggle]").forEach((b) => b.onclick = () => {
      MAP_LEG_OPEN = !MAP_LEG_OPEN; try { localStorage.setItem("fh6MapLeg", MAP_LEG_OPEN ? "1" : "0"); } catch (e) {}
      const leg = b.closest(".cmap-legend"); if (!leg) return;
      leg.classList.toggle("open", MAP_LEG_OPEN);
      const lb = leg.querySelector(".cleg-body"); if (lb) lb.hidden = !MAP_LEG_OPEN;   // the whole legend collapses to one button
      b.textContent = "legend " + (MAP_LEG_OPEN ? "▾" : "▸"); b.title = (MAP_LEG_OPEN ? "collapse" : "expand") + " the map legend";
    });
    // the map is rebuilt fresh here, so an active leaderboard lap-pick must be re-applied — otherwise any
    // left re-render (resize, filter, follow) silently drops the isolation while LB_PICK still stands. The
    // right pane already re-applies in paintRight; this is its left-map counterpart.
    applyLapPick();
  } else {
    paintLeftHeader();
    body.innerHTML = worldMapHTML();
    const mapSvg = body.querySelector("svg[data-x0]");
    if (mapSvg) { mapAttach(mapSvg); wireWorldCourses(mapSvg); const g = mapSvg.querySelector("#browseHi"); if (g && BROWSE_PICK) g.innerHTML = browseHiSVG(mapSvg, BROWSE_PICK); }
    addLiveDot(body);
    wireFollow(body); wireMapDrawer(body);
  }
}
// Just the left pane's TITLE (free-mode: browsing a course / on a route / the world) — updated on a browser pick
// without rebuilding the map, so the viewBox animation is never interrupted. Course mode owns its own title.
function paintLeftHeader() {
  const hd = $("#leftHd"); if (!hd || (MODE.suggest === "course" && COURSE)) return;
  if (!WORLD || !WORLD.routes) { hd.innerHTML = `World · <span class="why">loading</span>`; return; }
  // COURSE INFORMATION PILL (Jett 2026-09-07): the map pane's header carries a course pill in the car-pill's
  // design language -- a shape glyph, the name, its length/turns/laps, the classes it is offered in, and its
  // modes -- for the ACTIVE course: an explicit browse pick, else the route located under the car, else the
  // browser's TOP ROW for the current filter so the pill is never empty. Same data + chips as a browser tile.
  let rid = BROWSE_PICK || (ROUTE && ROUTE.id) || null;
  const state = BROWSE_PICK ? "browsing" : (ROUTE ? "route" : "default");
  if (!rid) {
    const top = Object.entries(WORLD.routes).map(([id, r]) => ({ id, r })).filter(({ r }) => r.name || r.laps)
      .filter(({ r }) => browseMatch(r, BROWSE_FILTER))
      .sort((a, b) => (a.r.name ? 0 : 1) - (b.r.name ? 0 : 1) || (a.r.name || "").localeCompare(b.r.name || "") || (a.id - b.id))[0];
    rid = top && top.id;
  }
  const r = rid && WORLD.routes[rid];
  hd.innerHTML = r ? courseInfoPill(Object.assign({ id: rid }, r), state)
                   : `World · <span class="why">${routeSplit().on.length} routes on the island · free roam</span>`;
}
// The pill body: a horizontal, header-sized version of a Course Browser row, from a NORMALISED descriptor so
// both the free-roam world routes and an identified learned COURSE feed the same renderer. `state` picks the
// status chip. Optional fields: turns, lapsDrawn (shows "N of M laps drawn"), nameChip (HTML), kindLabel.
// ONE class badge for the whole app: the established .pib PI-class badge (colour = piColor === the
// .pib-<class> palette). Everywhere a class is shown -- hero, leaderboard, stats -- renders THIS, so a
// class reads identically wherever it appears (Jett: consistent class design language everywhere).
function classPill(cls, n) {
  if (!cls) return "";
  return `<span class="pib pib--sm pib-${String(cls).toLowerCase()}" title="class ${esc(cls)}${n != null ? " · " + n + " lap" + (n === 1 ? "" : "s") : ""}"><b>${esc(cls)}</b>${n != null ? `<i class="pib-n">${n}</i>` : ""}</span>`;
}
// distinct laps of the active set that took this turn (its phaseObs) -- the turn's confidence sample
function turnLapCount(t, ls) {
  const s = new Set();
  Object.values(t.phaseObs || {}).forEach((rows) => rows.forEach((r) => { if (ls.set.has(String(r[0]))) s.add(r[0]); }));
  return s.size;
}
// THE COURSE FACTS (2026-09-11 course-info collapse): the tall `.chero` hero is split so the map can
// dominate the pane. Returns { facts, drawer }: `facts` is ONE compact line (flattened inline stats +
// a click-to-scope class rail) that replaces `.chero` as #leftBody's first child; `drawer` is the
// demoted detail (annotated shape glyph, the laps-by-class bar chart, the confidence split, the
// freshness note) handed to the course pill's hover/caret drawer so nothing is dropped — only made one
// interaction away. See docs/pane-audit-framework.md for the tiers this follows.
function courseHeroParts(c, ls, lapsDrawn) {
  const laps = (c.laps || []).filter((l) => ls.set.has(String(l.id)));
  const clean = (l) => !l.void && !l.partial && !l.rewinds && l.t != null;
  const med = (a) => { a = a.filter((x) => x != null).slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
  const timed = laps.filter(clean);
  const medLap = med(timed.map((l) => l.t));
  const bestLap = timed.length ? timed.reduce((m, l) => l.t < m.t ? l : m) : null;
  let climb = null;
  // climb must respect the SAME active lap set as median/best (Jett 2026-09-11) — pick the longest trace
  // among the filtered laps only, never across every lap on record.
  const tr = laps.map((l) => c.traces && c.traces[l.id]).filter(Boolean).sort((a, b) => b.length - a.length)[0]
    || Object.values(c.traces || {}).sort((a, b) => b.length - a.length)[0];
  if (tr && tr.length) { const es = tr.map((p) => p[5]).filter((v) => v != null); if (es.length) climb = Math.round(Math.max(...es) - Math.min(...es)); }
  const byCls = {}; laps.forEach((l) => { if (l.class) byCls[l.class] = (byCls[l.class] || 0) + 1; });
  const classes = Object.keys(byCls).sort((a, b) => (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99));
  const nCars = new Set(laps.map((l) => l.cid).filter(Boolean)).size;
  const turns = c.turns || [];
  let strong = 0, weak = 0;
  turns.forEach((t) => { const n = turnLapCount(t, ls); if (n >= 13) strong++; else if (n > 0) weak++; });
  const measured = turns.length, catalogued = c.n_turns_catalogued;
  const unmeasured = catalogued != null ? Math.max(0, catalogued - measured) : null;
  // THREE CONFIDENCE STATES, plus the scope's own gap (handoff §3): a measured turn with no lap in THIS scope is
  // neither strong nor weak and must not read as "needs more"; a catalogued turn never timed is its own state.
  const noneIn = Math.max(0, measured - strong - weak);
  // FRESHNESS ON THE COMPARISON, not only in the status bar (handoff §3): when this history was built and
  // whether driving sessions are still waiting to be counted in it.
  const hhmm = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const builtAt = c.built_at ? new Date(c.built_at) : null, sp = RB.last ? RB.last.sessions_pending : null;
  const fresh = `${(c.laps || []).length} laps counted in history${builtAt && !isNaN(builtAt) ? " · history built " + hhmm(builtAt) : ""}`
    + (sp ? ` · <b class="ch-pend">${sp} session${sp === 1 ? "" : "s"} not yet counted</b>` : sp === 0 ? " · every session counted" : "")
    + " · turn geometry from the game's own centre-line";
  // LAPS BY CLASS as a bar chart (redesign): each class a proportional bar, the SCOPED class lifted (it is
  // what every count on this screen is measured against), and a click scopes every pane to it — one path
  // with the SCOPE band (setScopeClass). Over EVERY lap on the course (not the filtered set) so every class
  // is always there to click, no matter what is currently scoped. Replaces the flat pill row.
  const byClsAll = {}; (c.laps || []).forEach((l) => { if (l.class) byClsAll[l.class] = (byClsAll[l.class] || 0) + 1; });
  const classesAll = Object.keys(byClsAll).sort((a, b) => (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99));
  const nCarsAll = new Set((c.laps || []).map((l) => l.cid).filter(Boolean)).size;
  const clsMax = Math.max(1, ...classesAll.map((cl) => byClsAll[cl]));
  const clsBars = classesAll.map((cl) => { const n = byClsAll[cl], on = ls.cls === cl, w = Math.max(5, Math.round(n / clsMax * 100));
    return `<button class="ch-bar${on ? " on" : ""}" data-clsbar="${esc(cl)}" title="class ${esc(cl)} · ${n} lap${n === 1 ? "" : "s"} · ${on ? "scoped — click to widen back to all" : "click to scope every count on this screen to it"}">${classPill(cl)}<span class="ch-bt"><i style="width:${w}%;background:${piColor(cl)}"></i></span><b class="ch-bn mono">${n}</b></button>`;
  }).join("");
  const liveLap = MODE.game === "event" ? lapNo(LIVE.frame) : null;
  // route glyph + start/finish/direction legend (spec's hero left column): the course's shape with a green
  // start dot and a pink finish dot, captioned loop / point-to-point.
  const path = (c.route && c.route.path) || c.path || [];
  const loop = !!(c.route && c.route.is_loop) || !!(c.route && c.route.loop);
  let glyph = "";
  if (path.length > 2) {
    let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
    path.forEach(([x, z]) => { if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (z < gz0) gz0 = z; if (z > gz1) gz1 = z; });
    const GW = 132, GH = 58, gpd = 7, gs = Math.min((GW - 2 * gpd) / ((gx1 - gx0) || 1), (GH - 2 * gpd) / ((gz1 - gz0) || 1));
    const gox = gpd + (GW - 2 * gpd - (gx1 - gx0) * gs) / 2, goy = gpd + (GH - 2 * gpd - (gz1 - gz0) * gs) / 2;
    const GX = (x) => gox + (x - gx0) * gs, GY = (z) => GH - goy - (z - gz0) * gs;
    const a = path[0], b = path[path.length - 1];
    glyph = `<svg class="ch-glyphsvg" viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="xMidYMid meet">
      <polyline fill="none" stroke="#8fa0b3" stroke-width="1.6" stroke-linejoin="round" points="${path.map(([x, z]) => GX(x).toFixed(1) + "," + GY(z).toFixed(1)).join(" ")}"/>
      <circle cx="${GX(a[0]).toFixed(1)}" cy="${GY(a[1]).toFixed(1)}" r="3" fill="#33d17a"/>
      <circle cx="${GX(b[0]).toFixed(1)}" cy="${GY(b[1]).toFixed(1)}" r="3" fill="#ff5d7d"/></svg>`;
  }
  const confHTML = `${scopeTok(ls)}<span class="ch-dot ok"></span>${strong} turn${strong === 1 ? "" : "s"} on 13+ laps · <span class="ch-dot w"></span>${weak} timed on fewer${noneIn ? ` · <span class="ch-dot n"></span>${noneIn} with no lap in scope` : ""}${unmeasured ? ` · <span class="ch-dot x"></span>${unmeasured} catalogued, never timed` : ""}`;
  // ROW 2 — the one always-visible facts line: flattened inline stats, then a click-to-scope class rail.
  // Every stacked value/caption pair from the old hero is a `LABEL value` pair on one baseline now.
  const cfact = (v, lab, title) => `<span class="cfact"${title ? ` title="${esc(title)}"` : ""}><em>${esc(lab)}</em><b>${v}</b></span>`;
  const totLaps = (c.laps || []).length;
  const factCells = [
    cfact(n0(c.len) + " m · " + (loop ? "loop" : "P2P"), "length"),
    cfact(medLap != null ? lapTime(medLap) : "—", "median"),
    cfact(bestLap ? lapTime(bestLap.t) : "—", "best", bestLap ? "best lap · " + carShort(bestLap.cid) : ""),
    cfact(climb != null ? climb + " m" : "—", "climb"),
    cfact(measured + (catalogued != null ? " / " + catalogued : ""), "turns"),
    cfact((lapsDrawn != null ? lapsDrawn + " / " : "") + totLaps, "laps", nCarsAll + " car" + (nCarsAll === 1 ? "" : "s") + " · " + totLaps + " lap" + (totLaps === 1 ? "" : "s") + " in history"),
  ].join("");
  // the class rail: the ONLY always-visible per-class breakdown now (the bar chart moved to the drawer),
  // so it carries its count; the scoped class is inset-lifted; a click scopes every pane (shared with the
  // bar chart's own data-clsbar handler and the SCOPE band's setScopeClass).
  const rail = classesAll.length ? `<div class="ch-cls cfact-rail">${classesAll.map((cl) => { const n = byClsAll[cl], on = ls.cls === cl;
    return `<button class="ccls${on ? " on" : ""}" data-clsbar="${esc(cl)}" title="class ${esc(cl)} · ${n} lap${n === 1 ? "" : "s"} · ${on ? "scoped — click to widen back to all" : "click to scope every count on this screen to it"}">${classPill(cl, n)}</button>`;
  }).join("")}</div>` : "";
  const facts = `<div class="cfacts">
    ${TEMP_COURSE ? `<div class="ch-browse"><b>browsing course data</b><em>not live · double-click the map to switch, or</em><button class="mini" data-tcx>exit ✕</button></div>` : ""}
    ${liveLap != null ? `<div class="ch-live"><i></i>event · lap ${liveLap}<em>turn-by-turn live</em></div>` : ""}
    <div class="cfacts-row"><div class="cfact-stats">${factCells}</div>${rail}</div>
  </div>`;
  // DRAWER — the demoted detail, one interaction away (the pill's hover/caret drawer, see courseInfoPill)
  const drawer =
      (glyph ? `<div class="cps-h">course shape</div><div class="ch-glyph cps-glyph">${glyph}<span class="ch-gleg"><span><i class="s"></i>start</span><span><i class="f"></i>finish</span><span class="why">${loop ? "loop" : "point-to-point"}</span></span></div>` : "")
    + (classesAll.length ? `<div class="cps-h">laps by class<i>${totLaps}</i></div><div class="ch-bars">${clsBars}<div class="ch-bnote why">${ls.cls ? "the highlighted row is what every count on this screen is measured against" : "click a class to scope every count to it"}</div></div>` : "")
    + `<div class="cps-h">confidence</div><div class="ch-conf">${confHTML}</div>`
    + `<div class="cps-h">freshness</div><div class="ch-note">${fresh}</div>`;
  return { facts, drawer };
}
// SHARED per-turn aggregate over the active lap set — the "statistics infrastructure" the turn table,
// the leaderboard and the selected-turn pane all read: n laps, per-phase agg, median turn time, best
// turn time, and avail = median-best = the seconds to FIND vs your own best line through this turn.
function turnAgg(t, ls) {
  const phases = SEG_ORDER.map((n) => ({ n, p: phaseAgg((t.phaseObs || {})[n], ls.set) }));
  const byLap = {};
  SEG_ORDER.forEach((n) => ((t.phaseObs || {})[n] || []).forEach((r) => { if (ls.set.has(String(r[0]))) (byLap[r[0]] = byLap[r[0]] || {})[n] = r; }));
  const tts = [];
  Object.values(byLap).forEach((ph) => { let tt = 0, any = false; SEG_ORDER.forEach((n) => { const r = ph[n]; if (r && r[5] != null) { tt += r[5]; any = true; } }); if (any) tts.push(tt); });
  tts.sort((a, b) => a - b);
  const med = tts.length ? tts[tts.length >> 1] : null, best = tts.length ? tts[0] : null;
  return { t, n: Object.keys(byLap).length, phases, turnT: med, bestT: best, avail: (med != null && best != null) ? med - best : null };
}
// the single PI class in scope, or null when it spans more than one -- apex GRIP and apex SPEED are both
// car-dependent, so a grip-ceiling rating is only honest within one class.
function scopeOneClass(ls) {
  if (ls.cls) return ls.cls;
  const cs = new Set();
  (COURSE.laps || []).forEach((l) => { if (ls.set.has(String(l.id)) && l.class) cs.add(l.class); });
  return cs.size === 1 ? [...cs][0] : null;
}
// GRIP CEILING (2026-09-12): how close the best pass got to the tyres' MEASURED limit through this turn.
// a_max = the class's grip ceiling (course.classGrip, a p90 of mid-phase peak |lat_g|, n>=20). Each lap
// carries its own mid-phase peak |lat_g| (phaseObs.mid r[8], schema 7). grip used = best pass's g / a_max.
// The SPEED headroom follows from v proportional to sqrt(lateral a) AT A FIXED LINE: v_max/v = sqrt(a_max/g),
// so we never need the corner's radius (which is derived from g -> circular) or an aero model. Honest by
// construction: returns a reason (not a number) when the scope mixes classes or a_max / g is missing.
function turnGripCeiling(c, t, ls) {
  const cls = scopeOneClass(ls);
  if (!cls) return { reason: "mixed" };
  const cg = (c.classGrip || {})[cls];
  if (!cg || cg.aMax == null) return { cls, reason: "no-amax" };
  const mid = (t.phaseObs || {}).mid || [];
  // ONE REFERENCE PASS (2026-09-12 fix): the in-scope lap that pulled the MOST grip here (closest to the limit).
  // Read its OWN apex speed and g from the SAME row, so the band pick and the sqrt speed-extrapolation can never
  // be built from two different laps (the cross-lap-mixing bug: best-g from one lap paired with a faster lap's
  // apex fabricated a "+mph"). nLaps = how many of the driver's own in-scope laps here carry grip — the true
  // sample size, disclosed separately from the class-band n (a max-of-few reads as a best-of, so it's labelled).
  let ref = null, nLaps = 0;
  mid.forEach((r) => {
    if (!ls.set.has(String(r[0]))) return;
    const g = r.length > 8 && r[8] != null && r[8] > 0.1 ? r[8] : null;
    if (g == null) return;
    nLaps++;
    if (ref == null || g > ref.g) ref = { g, apex: r[2] };
  });
  if (ref == null) return { cls, cg, reason: "no-g" };
  const bestG = ref.g, bestApex = ref.apex;
  // SPEED-BANDED a_max: rate against the class grip achievable at the speed THIS reference pass took the corner
  // (aero grip scales with speed). Fall back to the class-global a_max when the band is thin (coarse, flagged).
  let aMax = cg.aMax, n = cg.n, coarse = true, band = null;
  if (bestApex != null && Array.isArray(cg.bands)) {
    band = cg.bands.find((b) => bestApex >= b.lo && (b.hi == null || bestApex < b.hi));
    if (band) { aMax = band.aMax; n = band.n; coarse = false; }
  }
  const util = Math.min(100, Math.round(bestG / aMax * 100));
  // "+mph to find" ONLY near the limit, from the reference pass's OWN apex + g (same row): v ∝ sqrt(lateral a)
  // holds for a small perturbation of that line, but overshoots extrapolated across a big gap, so gate at >=88%.
  let avail = null;
  if (util >= 88 && bestApex != null && aMax > bestG) {
    avail = Math.max(0, Math.round(bestApex * (Math.sqrt(aMax / bestG) - 1)));
  }
  return { cls, cg, aMax, n, coarse, band, bestG: Math.round(bestG * 100) / 100, util, apex: bestApex, avail, nLaps };
}
let TURN_SORT = (() => { try { return localStorage.getItem("fh6TurnSort") || "find"; } catch (e) { return "find"; } })();
// MAP_VIEW: how the left course map colours its traces — "laptime" (each lap by its recorded time, a gradient)
// or "phases" (the whole road painted by the 5-phase turn model). Toggled from the map's floating legend.
let MAP_VIEW = (() => { try { return localStorage.getItem("fh6MapView") || "laptime"; } catch (e) { return "laptime"; } })();
// CM_TRACE_MODE: how the single-corner map colours each lap's driven line. "rank" (default) paints each
// trace ONE solid colour by its leaderboard position for this turn — green fastest → red slowest, so the
// map reads at a glance which lines belong to quick laps; "speed" keeps the point-by-point speed gradient
// (slow red → fast green within the corner) as a togglable filter. Persisted; a corner-map legend toggles it.
let CM_TRACE_MODE = (() => { try { return localStorage.getItem("fh6CmTrace") || "rank"; } catch (e) { return "rank"; } })();
// MAP_LEG_OPEN: whether the course map's floating legend pill is expanded to show the colour key. Collapsed
// by default so the pill stays small and never covers the turn numbers.
let MAP_LEG_OPEN = (() => { try { return localStorage.getItem("fh6MapLeg") === "1"; } catch (e) { return false; } })();
// MAP LAYER VISIBILITY (redesign · map legend): the course map's layers toggle independently of the colour
// VIEW (MAP_VIEW) — centre = the road / centre-line reference, laps = the lap bundle, phases = the selected
// turn's 5-phase overlay. The live-lap layer is drawn whenever a lap is live. Persisted; toggled from the
// legend. courseMap (app.js) reads this global (panel.js loads first).
let MAP_LAYERS = (() => { const d = { centre: true, laps: true, phases: true };
  try { return Object.assign(d, JSON.parse(localStorage.getItem("fh6MapLayers") || "{}")); } catch (e) { return d; } })();
// THE TURN LIST (redesign · phase B): every measured turn enumerated on the LEFT, sortable by route
// order or by TIME TO FIND (biggest opportunity first — the default). Each row: turn + kind, the five
// phase apex-mph medians, the median time in the turn, and the seconds available vs your best line.
// Clicking a row selects the turn (drives the right-pane analysis + the map highlight).
function turnTableHTML(c, ls) {
  const aggs = (c.turns || []).filter((t) => t.phaseObs).map((t) => turnAgg(t, ls)).filter((a) => a.n > 0);
  if (!aggs.length) return "";
  const oneCls = scopeOneClass(ls);
  const gp = (t) => { const g = turnGripCeiling(c, t, ls); return g.util != null ? g.util : null; };   // grip used % (one class + a_max only)
  if (TURN_SORT === "find") aggs.sort((a, b) => (b.avail || 0) - (a.avail || 0) || (a.t.seq || 0) - (b.t.seq || 0));
  else if (TURN_SORT === "grip") aggs.sort((a, b) => { const ga = gp(a.t), gb = gp(b.t); return (ga == null ? 101 : ga) - (gb == null ? 101 : gb) || (a.t.seq || 0) - (b.t.seq || 0); });   // least grip used first = the most left on the table
  else aggs.sort((a, b) => (a.t.seq || 0) - (b.t.seq || 0));
  const sel = turnPickSeq();
  const totFind = aggs.reduce((s, a) => s + (a.avail || 0), 0);
  const maxFind = Math.max(0.01, ...aggs.map((a) => a.avail || 0));
  const SHORT = { braking: "brake", turn_in: "entry", mid: "mid", exit: "exit", straight: "straight" };
  const findInk = (v) => v == null ? "var(--dim)" : v > 0.6 ? "#f0616d" : v > 0.35 ? "#e3b341" : "var(--mut)";
  // each phase cell: apex-mph value, a grip-mix mini-bar, and a 3px phase-colour underline (SEG_COL = WHERE)
  const ph = (a, n) => { const p = a.phases.find((x) => x.n === n).p;
    const bar = p && p.mix ? gripBar(p.mix) : `<span class="gbar gbar--empty"></span>`;
    return `<td class="tt-ph" title="${esc(SEG_LABEL[n])} apex mph${p && p.time != null ? " · " + p.time.toFixed(1) + " s" : ""}"><span class="tt-phv mono">${p && p.min != null ? p.min : "·"}</span>${bar}<span class="tt-phu" style="background:${SEG_COL[n]}"></span></td>`; };
  const rows = aggs.map((a) => { const t = a.t, dirW = t.dir === "L" ? "left" : t.dir === "R" ? "right" : "";
    const ink = findInk(a.avail), pct = Math.round((a.avail || 0) / maxFind * 100);
    return `<tr class="ttr${sel === t.seq ? " on" : ""}" data-turn="${t.seq}" title="${a.n} lap${a.n === 1 ? "" : "s"}">
    <td class="tt-lbl"><div class="tt-lname"><b>${esc(turnLabel(t))}</b> <span class="why">${esc(cap1(t.kind || "") + (dirW ? " " + dirW : ""))}</span></div>
      <div class="tt-geo mono">${t.r != null ? Math.round(t.r) + " m" : ""}${t.deg != null ? " · " + Math.round(t.deg) + "°" : ""} · ${a.n} lap${a.n === 1 ? "" : "s"}</div></td>
    ${SEG_ORDER.map((n) => ph(a, n)).join("")}
    <td class="mono tt-in">${a.turnT != null ? a.turnT.toFixed(1) + "s" : "—"}</td>
    <td class="tt-find2"><b class="mono" style="color:${ink}">${a.avail ? "+" + a.avail.toFixed(2) : "—"}</b><span class="tt-findbar"><i style="width:${pct}%;background:${ink}"></i></span></td>
    <td class="tt-grip">${(() => { const g = turnGripCeiling(c, t, ls); if (g.util == null) return `<span class="mono off">·</span>`; const thin = g.nLaps < 3; return `<b class="mono${thin ? " tg-thin" : ""}" title="${g.nLaps} lap${g.nLaps === 1 ? "" : "s"} here${thin ? " — thin" : ""}">${g.util}%</b><span class="tt-gbar"><i style="width:${g.util}%"></i></span>`; })()}</td></tr>`; }).join("");
  const sortBtn = (k, lbl) => `<button class="mini${TURN_SORT === k ? " on" : ""}" data-tsort="${k}">${lbl}</button>`;
  const measured = (c.turns || []).length, catalogued = c.n_turns_catalogued;
  const sortWhy = TURN_SORT === "find" ? "ranked by the time available vs your best lap"
    : TURN_SORT === "grip" ? "ranked by grip use — the least-used corners (most grip left) first" + (oneCls ? "" : " · scope to one class to fill it")
    : "route order · click any turn, or its number on the map";
  return `<div class="grp"><div class="gh">${measured}${catalogued != null ? " of " + catalogued : ""} turns measured ${scopeTok(ls)} <span class="why">· ${aggs.length} with a lap in scope · ${esc(sortWhy)}</span>
      <span class="ttsort"><span class="why">sort</span>${sortBtn("route", "route order")}${sortBtn("find", "time to find")}${sortBtn("grip", "grip use")}</span></div>
    <div class="tt-wrap"><table class="tt"><thead><tr><th>turn</th>
      ${SEG_ORDER.map((n) => `<th class="tt-phh" title="${esc(SEG_LABEL[n])} apex mph"><span class="pdot" style="background:${SEG_COL[n]}"></span>${esc(SHORT[n])}</th>`).join("")}
      <th title="median time through the turn">in turn</th><th title="seconds to find vs your best line">to find</th><th title="best pass's peak lateral g vs the class grip ceiling (a_max) — 100% = at the limit; low = grip left (one class only)">grip use</th></tr></thead>
      <tbody>${rows}</tbody>${totFind > 0.05 ? `<tfoot><tr><td colspan="7">total time to find</td><td class="mono tt-find">+${totFind.toFixed(2)}</td><td></td></tr></tfoot>` : ""}</table></div></div>`;
}
function courseInfoPill(r, state) {
  const nm = r.name || ("Route " + (r.id != null ? r.id : "?"));
  const kind = ("kindLabel" in r) ? r.kindLabel
             : r.is_race ? "RACE" : (r.modes || []).includes("rivals") ? "RIVALS"
             : (r.modes || []).includes("career") ? "CAREER" : null;
  const laps = r.laps || 0, sess = r.sessions || 0;
  const meta = [n0(r.len) + " m", r.loop ? "loop" : "P2P"];
  if (r.turns != null) meta.push(r.turns + " turn" + (r.turns === 1 ? "" : "s"));
  if (r.lapsDrawn != null) meta.push(r.lapsDrawn + " of " + laps + " lap" + (laps === 1 ? "" : "s") + " drawn");
  else if (laps) { meta.push(laps + " lap" + (laps === 1 ? "" : "s")); }   // laps are the usable samples; runs (play sessions) demoted off the pill
  else meta.push("no data yet");
  if (r.alsoName) meta.push("shares road with " + r.alsoName);
  const metaS = meta.join(" · ");
  const dataSet = new Set(r.class_data || []);   // solid = we hold laps in that class, hollow = offered only
  const lapCls = r.lap_class || [], lapCar = r.lap_car || [];   // real per-class / per-car lap counts (void=0)
  const clsN = {}; lapCls.forEach(([c, n]) => { clsN[c] = n; });
  const pills = (r.classes || []).map((cl) => {
    const n = clsN[cl], has = dataSet.has(cl) || n;
    return `<span class="pib pib--sm pib-${cl.toLowerCase()}${has ? "" : " pib--neg"}" title="class ${cl}${n ? " · " + n + " lap" + (n === 1 ? "" : "s") : has ? " · has data" : " · no data yet"}"><b>${esc(cl)}</b>${n ? `<i class="pib-n">${n}</i>` : ""}</span>`;
  }).join("");
  const badges = [(r.modes || []).includes("rivals") ? `<span class="bb riv">rivals</span>` : "",
                  (r.modes || []).includes("career") ? `<span class="bb car">career</span>` : "",
                  r.disc ? `<span class="bb dsc">${esc(r.disc)}</span>` : ""].join("");
  const stChip = state === "browsing" ? `<span class="chip w">BROWSING</span>`
               : state === "route" ? `<span class="chip w">${MODE.game === "event" ? "ON EVENT ROUTE" : "ON ROUTE"}</span>`
               : state === "course" ? `<span class="chip on">ON COURSE</span>`
               : `<span class="chip dim">top of list</span>`;
  // COURSE-MODE COLLAPSE (2026-09-11): in course mode the pill is Row 1 (identity) only — the meta line and
  // the class/mode badge row move to the compact facts line above the map (courseHeroParts), so both are
  // omitted here and the mode tags the badge row carried merge into Row 1 beside the kind chip. Free-roam
  // (browsing/route/default) keeps the fuller two-line pill unchanged, since its header still has the room.
  const course = state === "course";
  const modeTags = course
    ? (r.modes || []).filter((m) => (m || "").toUpperCase() !== (kind || "")).map((m) =>
        `<span class="bb ${m === "rivals" ? "riv" : m === "career" ? "car" : "dsc"}">${esc(m)}</span>`).join("")
    : "";
  // the small glyph is the ONLY route silhouette now (the hero's big one moved to the drawer) — give it the
  // start/finish/loop legend + the meta facts as a tooltip so nothing the caption used to say is dropped.
  const glyphTip = `green = start · pink = finish · ${r.loop ? "loop" : "point-to-point"} · ${metaS}`;
  // QUICK STATS DRAWER (Jett 2026-09-09; superset since the collapse): laps-by-car, plus in course mode the
  // demoted hero detail (shape, laps-by-class bars, confidence, freshness) handed in as r.drawerExtra.
  const totLaps = lapCls.reduce((a, kv) => a + kv[1], 0);
  const CAR_CAP = 10;
  const clsRow = lapCls.length ? lapCls.map(([c, n]) =>
      `<span class="cps-c"><span class="pib pib--sm pib-${c.toLowerCase()}"><b>${esc(c)}</b></span><i>${n}</i></span>`).join("")
      : `<span class="why">no laps yet</span>`;
  const carRows = lapCar.slice(0, CAR_CAP).map(([lbl, n]) =>
      `<div class="cps-car"><span class="cps-cn" title="${esc(lbl)}">${esc(lbl)}</span><i>${n}</i></div>`).join("")
      + (lapCar.length > CAR_CAP ? `<div class="cps-more">+${lapCar.length - CAR_CAP} more car${lapCar.length - CAR_CAP === 1 ? "" : "s"}</div>` : "");
  const carSection = lapCar.length ? `<div class="cps-h">laps by car<i>${lapCar.length}</i></div><div class="cps-cars">${carRows}</div>` : "";
  const alsoSection = r.alsoName ? `<div class="cps-h">shares road</div><div class="cps-also why">${esc(r.alsoName)}</div>` : "";
  // course mode: the drawer is the hero detail + laps-by-car (the plain-text laps-by-class row is dropped —
  // the Row-2 rail carries counts and the drawer's bar chart carries the detail). Free-roam: as before.
  const drawerBody = course
    ? (r.drawerExtra || "") + carSection + alsoSection
    : (lapCls.length || lapCar.length
        ? `<div class="cps-h">laps by class<i>${totLaps}</i></div><div class="cps-row">${clsRow}</div>${carSection}`
        : "");
  const hasStats = !!drawerBody;
  const stats = hasStats ? `<div class="cpstats">${drawerBody}</div>` : "";
  return `<div class="cpill${hasStats ? " has-stats" : ""}" data-state="${esc(state)}">
    <span class="cpill-glyph" title="${esc(glyphTip)}">${tileSvg(r, false)}</span>
    <span class="cpill-txt">
      <span class="cpill-l1"><b class="trackname" title="${esc(nm)}">${esc(nm)}</b>${stChip}${kind ? `<span class="chip w">${esc(kind)}</span>` : ""}${modeTags}<span class="cpill-prov">${r.id != null ? `<span class="cpill-rid mono" title="catalogued route id">route ${esc(String(r.id))}${r.disc ? " · " + esc(r.disc) : ""}</span>` : ""}${r.nameChip || ""}</span>${hasStats ? `<button type="button" class="cps-caret" aria-label="lap breakdown, shape and freshness" title="lap breakdown, shape and freshness">▾</button>` : ""}</span>
      ${course ? "" : `<span class="why cpill-l2" title="${esc(metaS)}">${esc(metaS)}</span>
      <span class="cpill-badges">${pills}${badges}</span>`}
    </span>
    ${stats}
  </div>`;
}

// Two of the game's 169 routes (102 and 103) are complete circuits parked 8–11 km beyond the north
// coast, outside the nav mesh, with road-class 0 in every record — cut or developer test circuits,
// not a destination (research 2026-09-03). They are IGNORED entirely (Jett 2026-09-07): routeSplit
// separates them out so nothing draws them, fits the map to them, or counts them — no toggle.
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
// Break a POSITION polyline into runs wherever the car teleported (a respawn / checkpoint reset jumps
// the position by far more than any real step), so a map never draws a straight line across the island.
// Catalogue geometry has no such gaps, so it comes back as one run — harmless to pass through. Global on
// purpose: app.js's courseMap() uses it too. Only for x/z position paths, never speed-vs-distance traces.
// Keep every `step`-th point plus the last: the ~16 m copy used both for the per-frame route matchers and for
// the faint BACKGROUND polylines (the focus route is drawn dense instead). Point-to-segment location needs
// only ~16 m segments (4 x 4 m), and 16 m is sub-pixel at island scale, so both uses look and match as they
// did before the paths went full-resolution. Keeping the final point guarantees a route's end is never lost.
function strideLo(pts, step) {
  if (!pts || pts.length <= 2 || step <= 1) return pts || [];
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
function splitTP(pts, cap) {
  cap = cap || 150;
  if (!pts || pts.length < 2) return pts && pts.length ? [pts] : [];
  const runs = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > cap) runs.push([b]); else runs[runs.length - 1].push(b);
  }
  return runs.filter((r) => r.length > 1);
}
// COURSE-TYPE PALETTE. Keys are ref_event.discipline as build_web writes it into world.json (`disc`,
// the route's dominant discipline over its events). `_unverified` is for a learned course with no route
// link — deliberately colourless, because the colour asserts an identified type.
const DISC_COL = { road: "#58a6ff", street: "#bc8cff", dirt: "#d29922", "cross-country": "#3fb950",
                   playground: "#f778ba", drag: "#ff7b72", showcase: "#79c0ff", rush: "#ffa657",
                   _other: "#00d27a", _unverified: "#54606f" };
let MAP_HOVER = null;              // route id the pointer is over on the world map (highlight only, never a pick)

function worldMapHTML() {
  if (!WORLD || !WORLD.bbox) return `<div class="why">no world data — run build_web.py</div>`;
  const { on } = routeSplit();   // the two off-map routes (102/103) are cut/dev test circuits -- ignored entirely
  const shown = on;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  shown.forEach(({ r }) => r.pts.forEach(([x, z]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }));
  Object.values(WORLD.courses || {}).forEach((c) => (c.path || []).forEach(([x, z]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }));
  if (!isFinite(x0)) [x0, x1, z0, z1] = WORLD.bbox;
  // The content is ALWAYS drawn full-island; zooming to a picked course is done by animating the SVG viewBox
  // (mapView below), not by reframing here — so a pick glides in, deselect glides back, and mouse drag/wheel
  // can rubber-band before easing back to the current target.
  // the viewBox takes the ISLAND's own aspect, so the map fills the pane instead of sitting as a
  // small shape inside a letterbox — the pane's height is the scarce thing, not the map's
  const pad = 12, AR = ((x1 - x0) || 1) / ((z1 - z0) || 1);
  const H = 640, W = Math.max(320, Math.round((H - 2 * pad) * AR)) + 2 * pad;
  const s = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((z1 - z0) || 1));
  const px = (x) => pad + (x - x0) * s, pz = (z) => H - pad - (z - z0) * s;
  // toFixed(2), not (0): the SVG is drawn ONCE at full-island fit (~20 m per SVG unit) and then the viewBox
  // magnifies it 30-100x on a course pick. Integer SVG units pre-snapped every path point to a ~20 m grid,
  // so zoom just enlarged the stair-steps -- the "low resolution on zoom" (Jett 2026-09-07). Centi-unit
  // precision (~0.2 m at island scale) survives the deepest zoom the map reaches.
  const ptsStr = (run) => run.map(([x, z]) => px(x).toFixed(2) + "," + pz(z).toFixed(2)).join(" ");
  const line = (pts, col, w, op) => splitTP(pts).map((run) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}" stroke-linejoin="round" points="${ptsStr(run)}"/>`).join("");
  // BACKGROUND at strided ~16 m (._lo) so the viewBox animation stays cheap; the FOCUS route below is dense.
  const routes = on.map(({ r }) => line(r._lo || r.pts, "#3b4a5c", 1.2, 0.9)).join("");
  // COLOUR BY COURSE TYPE (Jett 2026-09-08). A course we have VERIFIED — its key is `route:<id>`, so it
  // reconciled to a catalogued route — takes that route's discipline colour. One we have not (an `<x>_<z>`
  // learned leftover, no route link) stays a dim neutral: the colour is a claim about identity, so an
  // unidentified trace must not make one. Each course is its own <g> carrying a transparent fat hit-line,
  // so it can be hovered at island zoom where the visible stroke is barely a pixel wide.
  const mine = Object.entries(WORLD.courses || {}).filter(([, c]) => c.path && c.path.length > 3)
    .map(([key, c]) => {
      const rm = /^route:(.+)$/.exec(key);
      const rt = rm && WORLD.routes[rm[1]];
      const disc = rt ? (rt.disc || null) : null;
      const col = disc ? (DISC_COL[disc] || DISC_COL._other) : DISC_COL._unverified;
      const runs = splitTP(c._lo || c.path);
      const hit = runs.map((run) => `<polyline class="wc-hit" fill="none" stroke="transparent" stroke-width="10" stroke-linecap="round" points="${ptsStr(run)}"/>`).join("");
      const vis = runs.map((run) => `<polyline class="wc-ink" fill="none" stroke="${col}" stroke-width="1.6" opacity="${disc ? 0.9 : 0.4}" stroke-linejoin="round" points="${ptsStr(run)}"/>`).join("");
      const nm = (rt && rt.name) || c.name || key;
      return `<g class="wcourse" data-key="${esc(key)}"${rm ? ` data-rid="${esc(rm[1])}"` : ""} data-disc="${esc(disc || "")}"><title>${esc(nm)}${disc ? " · " + esc(disc) : " · unverified"}</title>${hit}${vis}</g>`;
    }).join("");
  // in an event, the catalogued route the car is on, drawn bright over the rest so the map is legible -- this
  // is a FOCUS route (the viewBox zooms to it), so draw it DENSE (r.pts) for a smooth line at deep zoom.
  const hi = (ROUTE && WORLD.routes[ROUTE.id] && (WORLD.routes[ROUTE.id].pts || []).length > 1)
    ? line(WORLD.routes[ROUTE.id].pts, "#e3b341", 2.8, 1) : "";
  // no follow toggle here: following is course-only (see followSpan()) -- offering it on the
  // world map invited turning on a satnav zoom that could only ever collapse the island view.
  const seen = [...new Set(Object.keys(WORLD.courses || {}).map((k) => {
    const m = /^route:(.+)$/.exec(k); const r = m && WORLD.routes[m[1]]; return (r && r.disc) || null; }))];
  const legend = `<span><i style="background:#3b4a5c"></i>every game route</span>`
    + seen.filter(Boolean).sort().map((d) => `<span><i style="background:${DISC_COL[d] || DISC_COL._other}"></i>${esc(d)}</span>`).join("")
    + (seen.includes(null) ? `<span><i style="background:${DISC_COL._unverified}"></i>unverified</span>` : "")
    + `<span><i style="background:#fff"></i>you, now</span>`;
  return `<svg viewBox="0 0 ${W} ${H}" data-x0="${x0}" data-z0="${z0}" data-s="${s}" data-h="${H}" data-w="${W}" data-pad="${pad}"
      style="background:var(--bg);border-radius:6px;width:100%;height:100%">${routes}${mine}${hi}<g id="browseHi"></g><g id="liveDot"></g></svg>
    ${mapDrawerHTML(`<div class="legend">${legend}</div>`)}`;
}

/* ------------------------------------------------- the world map as a live, framed view
   The SVG content is drawn once (full island). The DISPLAYED window is the SVG viewBox, eased every
   frame toward a TARGET rectangle: the whole island by default, a picked course's bounding box when the
   Course Browser has a selection. Mouse wheel zooms and drag pans the live window, but ~0.9 s after you
   let go it glides back to the target -- "manipulable, but always returns to its current state". */
const MAPVIEW = { svg: null, tx: 0, ty: 0, tw: 0, th: 0, cx: 0, cy: 0, cw: 0, ch: 0,
                  W: 0, H: 0, raf: 0, holdUntil: 0, drag: null, wired: null };
function mapProj(svg) {
  return { x0: +svg.dataset.x0, z0: +svg.dataset.z0, s: +svg.dataset.s, pad: +svg.dataset.pad, H: +svg.dataset.h,
           px(x) { return this.pad + (x - this.x0) * this.s; }, pz(z) { return this.H - this.pad - (z - this.z0) * this.s; } };
}
function routePxBox(svg, id) {
  const r = WORLD.routes[id]; if (!r || !r.pts || r.pts.length < 2) return null;
  const p = mapProj(svg); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  r.pts.concat(r.spawn ? [r.spawn] : []).forEach(([x, z]) => { const X = p.px(x), Y = p.pz(z);
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; });
  const mx = ((x1 - x0) || 40) * 0.28 + 26, my = ((y1 - y0) || 40) * 0.28 + 26;   // margin: keep some island context around it
  return { x: x0 - mx, y: y0 - my, w: (x1 - x0) + 2 * mx, h: (y1 - y0) + 2 * my };
}
function browseHiSVG(svg, id) {
  const r = WORLD.routes[id]; if (!r || !r.pts || r.pts.length < 2) return "";
  const p = mapProj(svg), P = r.pts;
  // centi-unit precision (see line()): this bright highlight is the route you zoom INTO, so it is the one
  // the pre-rounding blockiness showed on most.
  const poly = splitTP(P).map((run) => `<polyline fill="none" stroke="#ffcf4d" stroke-width="3" opacity="1" stroke-linejoin="round" points="${run.map(([x, z]) => p.px(x).toFixed(2) + "," + p.pz(z).toFixed(2)).join(" ")}"/>`).join("");
  const mk = (r.spawn ? `<circle cx="${p.px(r.spawn[0]).toFixed(2)}" cy="${p.pz(r.spawn[1]).toFixed(2)}" r="6" fill="none" stroke="#c792ea" stroke-width="2.2"/>` : "")
    + `<circle cx="${p.px(P[P.length - 1][0]).toFixed(2)}" cy="${p.pz(P[P.length - 1][1]).toFixed(2)}" r="5" fill="#ff5d7d" stroke="#0f1720" stroke-width="1.5"/>`
    + `<circle cx="${p.px(P[0][0]).toFixed(2)}" cy="${p.pz(P[0][1]).toFixed(2)}" r="5" fill="#33d17a" stroke="#0f1720" stroke-width="1.5"/>`;
  return poly + mk;
}
function mapTargetFor(svg) {   // the rectangle the view wants to sit at, from the current selection
  const box = BROWSE_PICK && routePxBox(svg, BROWSE_PICK);
  return box || { x: 0, y: 0, w: MAPVIEW.W, h: MAPVIEW.H };
}
function mapApply() { const m = MAPVIEW; if (m.svg) m.svg.setAttribute("viewBox", `${m.cx.toFixed(1)} ${m.cy.toFixed(1)} ${m.cw.toFixed(1)} ${m.ch.toFixed(1)}`); }
function mapTick() {
  const m = MAPVIEW; if (!m.svg || !m.svg.isConnected) { m.raf = 0; return; }
  const held = Date.now() < m.holdUntil;
  if (!held) {   // ease the live window toward the target
    const k = 0.16;
    m.cx += (m.tx - m.cx) * k; m.cy += (m.ty - m.cy) * k; m.cw += (m.tw - m.cw) * k; m.ch += (m.th - m.ch) * k;
    mapApply();
    const near = Math.abs(m.tx - m.cx) + Math.abs(m.ty - m.cy) + Math.abs(m.tw - m.cw) + Math.abs(m.th - m.ch) < 0.6;
    if (near) { m.cx = m.tx; m.cy = m.ty; m.cw = m.tw; m.ch = m.th; mapApply(); m.raf = 0; return; }
  }
  m.raf = requestAnimationFrame(mapTick);
}
function mapKick() { if (!MAPVIEW.raf) MAPVIEW.raf = requestAnimationFrame(mapTick); }
function mapRetarget(animate) {
  const m = MAPVIEW; if (!m.svg) return;
  const t = mapTargetFor(m.svg); m.tx = t.x; m.ty = t.y; m.tw = t.w; m.th = t.h;
  if (!animate) { m.cx = t.x; m.cy = t.y; m.cw = t.w; m.ch = t.h; mapApply(); }
  else { m.holdUntil = 0; mapKick(); }
}
function mapAttach(svg) {
  const m = MAPVIEW; m.svg = svg; m.W = +svg.dataset.w; m.H = +svg.dataset.h;
  const t = mapTargetFor(svg);            // snap to the current target on a fresh render (no zoom flash on unrelated repaints)
  m.tx = m.cx = t.x; m.ty = m.cy = t.y; m.tw = m.cw = t.w; m.th = m.ch = t.h; mapApply();
  if (m.wired === svg) return; m.wired = svg;
  const clientToVB = (e) => { const rc = svg.getBoundingClientRect();
    return { x: m.cx + ((e.clientX - rc.left) / rc.width) * m.cw, y: m.cy + ((e.clientY - rc.top) / rc.height) * m.ch, fx: (e.clientX - rc.left) / rc.width, fy: (e.clientY - rc.top) / rc.height }; };
  svg.addEventListener("wheel", (e) => {
    e.preventDefault(); const at = clientToVB(e);
    const f = Math.exp(e.deltaY * 0.0016);                       // wheel up = zoom in
    let nw = Math.min(m.W * 1.15, Math.max(m.W * 0.04, m.cw * f)); const r = nw / m.cw; let nh = m.ch * r;
    m.cx = at.x - at.fx * nw; m.cy = at.y - at.fy * nh; m.cw = nw; m.ch = nh;
    mapApply(); m.holdUntil = Date.now() + 900; mapKick();
  }, { passive: false });
  svg.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; m.drag = { x: e.clientX, y: e.clientY }; svg.setPointerCapture(e.pointerId); svg.style.cursor = "grabbing"; m.holdUntil = Date.now() + 1e9; });
  svg.addEventListener("pointermove", (e) => { if (!m.drag) return; const rc = svg.getBoundingClientRect();
    m.cx -= ((e.clientX - m.drag.x) / rc.width) * m.cw; m.cy -= ((e.clientY - m.drag.y) / rc.height) * m.ch;
    m.drag.x = e.clientX; m.drag.y = e.clientY; mapApply(); });
  const endDrag = (e) => { if (!m.drag) return; m.drag = null; svg.style.cursor = ""; try { svg.releasePointerCapture(e.pointerId); } catch (_) {} m.holdUntil = Date.now() + 900; mapKick(); };
  svg.addEventListener("pointerup", endDrag); svg.addEventListener("pointercancel", endDrag);
  svg.style.cursor = "grab";
}
// HOVER THE MAP, HIGHLIGHT THE BROWSER (Jett 2026-09-08: "mousing over an established course should
// highlight (but not select unless clicked on) the associated course in the course browser"). Hover is a
// PREVIEW: it never writes BROWSE_PICK, never touches the view store, and never moves the map's target —
// so letting go leaves the view exactly as it was. Only the click commits, through browsePick().
function hoverCourse(rid) {
  if (MAP_HOVER === rid) return;
  MAP_HOVER = rid;
  document.querySelectorAll(".wcourse.hi").forEach((g) => g.classList.remove("hi"));
  document.querySelectorAll(".tile.hi").forEach((t) => t.classList.remove("hi"));
  if (!rid) return;
  document.querySelectorAll(`.wcourse[data-rid="${CSS.escape(rid)}"]`).forEach((g) => g.classList.add("hi"));
  const tile = document.querySelector(`.tile[data-bpick="${CSS.escape(rid)}"]`);
  if (tile) {
    tile.classList.add("hi");
    // bring it into view only when it is actually off-screen, so a hover never yanks a list the user is reading
    const box = tile.getBoundingClientRect(), host = tile.closest(".tiles");
    if (host) { const hb = host.getBoundingClientRect();
      if (box.top < hb.top || box.bottom > hb.bottom) tile.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
}
function wireWorldCourses(svg) {
  if (svg.dataset.wcWired === "1") return;      // paintLeft can re-enter; the SVG itself is drawn once
  svg.dataset.wcWired = "1";
  // A REDRAW WIPES THE HIGHLIGHT BUT NOT THE VARIABLE. worldMapHTML() replaces the whole SVG, so every
  // `.hi` class goes with it while MAP_HOVER still names the last course — and hoverCourse()'s
  // "same course, nothing to do" guard then swallowed the next real hover over that same course, for
  // the life of the page. Clearing it here ties the memory to the DOM it describes.
  MAP_HOVER = null;
  svg.querySelectorAll(".wcourse").forEach((g) => {
    const rid = g.dataset.rid || null;
    g.style.cursor = rid ? "pointer" : "default";
    g.addEventListener("mouseenter", () => hoverCourse(rid));
    g.addEventListener("mouseleave", () => hoverCourse(null));
    if (rid) g.addEventListener("click", (e) => { e.stopPropagation(); browsePick(rid); });
    // double-click a course on the world map → open its full analysis (temporary course-browser view)
    if (rid) g.addEventListener("dblclick", (e) => { e.stopPropagation(); e.preventDefault(); enterTempCourse(rid); });
  });
  svg.addEventListener("mouseleave", () => hoverCourse(null));
}

// pick a course from the browser: highlight it + glide the map to it; pick again (BROWSE_PICK null) glides back
function browsePick(id) {
  BROWSE_PICK = (BROWSE_PICK === id) ? null : id;
  VIEW.global.browsePick = BROWSE_PICK; viewSave();
  const svg = MAPVIEW.svg;
  if (svg) { const g = svg.querySelector("#browseHi"); if (g) g.innerHTML = BROWSE_PICK ? browseHiSVG(svg, BROWSE_PICK) : ""; }
  mapRetarget(true);
  paintLeftHeader();                 // just the title — not a full re-render, so the animation is never interrupted
  browseSyncTiles();                 // toggle the .on tile in place — a full paintRight() rebuilt every tile SVG and FLICKERED (Jett 2026-09-07)
}
// Reflect the current BROWSE_PICK by toggling the selected tile's class, WITHOUT rebuilding the grid.
// paintRight() rewrites #rightBody.innerHTML, so calling it on every pick destroyed and recreated all ~100
// tile <svg>s each click -- the flicker. Only two tiles ever change state, so touch only those.
function browseSyncTiles() {
  const body = $("#rightBody"); if (!body) return;
  body.querySelectorAll(".tile[data-bpick]").forEach((t) => {
    const on = t.dataset.bpick === BROWSE_PICK;
    t.classList.toggle("on", on);
    const sv = t.querySelector(".tsvg"); if (sv) sv.classList.toggle("on", on);
  });
}
// TEMPORARY COURSE BROWSER (Jett 2026-09-11): double-clicking a course in free roam — a browser tile or its
// shape on the world map — opens its FULL analysis (the course-mode map, hero, turn list, turn analysis and
// statistics) without being on it, to study the data and make inferences. It reuses course mode wholesale by
// loading the course and forcing MODE.suggest="course" behind TEMP_COURSE; adoptMode() releases it by context.
async function enterTempCourse(routeId) {
  if (!routeId) return;
  const key = "route:" + String(routeId);
  if (TEMP_COURSE && COURSE_KEY === key) return exitTempCourse();   // double-click the same course again → leave
  let ok = false;
  try { ok = await onCourseChange(COURSE_KEY, key, { force: true }); } catch (e) { ok = false; }
  if (!ok || !COURSE || COURSE_KEY !== key) { logStatus("no course data on record for that route yet", "warn"); return; }
  TEMP_COURSE = true;
  MODE.suggest = "course"; MODE.known = true; MODE.held = false;
  MODE.reason = "browsing " + (COURSE.name || key) + " · double-click again to exit";
  BROWSE_PICK = String(routeId); VIEW.global.browsePick = BROWSE_PICK; viewSave();
  LEFT_KEY = null; TRACE_KEY = null; paintPanel();
}
function exitTempCourse() {
  if (!TEMP_COURSE) return;
  TEMP_COURSE = false; COURSE = null; COURSE_KEY = null;
  MODE.suggest = "free"; MODE.known = true; MODE.held = false; MODE.reason = "free roam";
  LEFT_KEY = null; TRACE_KEY = null; paintPanel();
}

/* ------------------------------------------------- Course Browser (free-mode right tab)
   Every known route as a shape tile; pick one and the left world map zooms to its location.
   Filter chips separate the modes we identified (a route is used by rivals AND/OR career events;
   `race` is the ones with a world activation sphere) without double-listing, since most courses
   support several modes at once. */
const BROWSE_CHIPS = [["all", "All"], ["rivals", "Rivals"], ["race", "Race"], ["career", "Career"], ["free", "Free-roam"]];
// NOT EVERY CATALOGUED ROUTE IS A PLACE (Jett 2026-09-08: "there are superfluous courses that are either
// dev courses or left over and these are taking up valuable real estate"). Two kinds, both from the game's
// own data rather than a hand-written list:
//   * the "IE ..." drive sections -- ref_track_info names five of them (IE Drive Section One/2/Three/Four,
//     IE City Tour), all flagged use_cross_country_ai, and they are intro-experience/dev content;
//   * a route we only know by NUMBER -- no catalogue name at all, on the tile purely because we drove over
//     its geometry once.
// HIDDEN, NEVER DROPPED: the toggle below shows them again, because "superfluous" is a judgement about
// screen space, not about the data.
function browseJunk(r) {
  if (/^IE /.test(r.name || "")) return true;
  return !r.name;
}
function browseMatch(r, f) {
  const m = r.modes || [];
  if (f === "all") return true;
  if (f === "rivals") return m.includes("rivals");
  if (f === "race") return !!r.is_race;
  if (f === "career") return m.includes("career");
  if (f === "free") return !r.is_race && !m.includes("rivals") && !m.includes("career");
  return true;
}
function tileSvg(r, sel) {
  const pts = r.pts || []; if (pts.length < 2) return "";
  const step = Math.max(1, Math.ceil(pts.length / 60));       // tiny tile: ~60 points is plenty
  const P = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const all = r.spawn ? P.concat([r.spawn]) : P;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  all.forEach(([x, z]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; });
  const W = 108, H = 74, pad = 7, sx = (x1 - x0) || 1, sz = (z1 - z0) || 1;
  const s = Math.min((W - 2 * pad) / sx, (H - 2 * pad) / sz);
  const ox = pad + (W - 2 * pad - sx * s) / 2, oy = pad + (H - 2 * pad - sz * s) / 2;
  const X = (x) => ox + (x - x0) * s, Y = (z) => H - oy - (z - z0) * s;
  const col = r.is_race ? "var(--race,#ff8a3d)" : "var(--free,#7fb2ff)";
  // tiles draw the CATALOGUE geometry, which is clean (max point gap 24 m), so no teleport split is needed
  // here — and the ~60-point subsample would make a 150 m cap misfire anyway. One polyline over the shape.
  const poly = `<polyline fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" points="${P.map(([x, z]) => X(x).toFixed(1) + "," + Y(z).toFixed(1)).join(" ")}"/>`;
  const dot = (p, c, rad) => p ? `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${rad}" fill="${c}"/>` : "";
  const spawn = r.spawn ? `<circle cx="${X(r.spawn[0]).toFixed(1)}" cy="${Y(r.spawn[1]).toFixed(1)}" r="3" fill="none" stroke="#c792ea" stroke-width="1.4"/>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="tsvg${sel ? " on" : ""}" preserveAspectRatio="xMidYMid meet">
    ${poly}${spawn}${dot(P[P.length - 1], "#ff5d7d", 2.4)}${dot(P[0], "#33d17a", 2.4)}</svg>`;
}
function browserHTML() {
  if (!WORLD || !WORLD.routes) return `<div class="why">no world data — run build_web.py</div>`;
  // A BROWSABLE COURSE IS A NAMED CATALOGUE ROUTE (or one we hold data on). The .owt geometry import carries all
  // 169 routes, but 66 are geometry-only with no catalogue name -- cut/dev/alternate-line content (ids 11000+,
  // 20000+, 30100+, and the off-map 102/103) that is not a player course. They rendered as "Route <id> · no data
  // yet" and swamped the browser; drop them unless we have actually driven one (then it earns a tile on its data).
  const all = Object.entries(WORLD.routes).map(([id, r]) => ({ id, r })).filter(({ r }) => r.name || r.laps);
  const nJunk = all.filter(({ r }) => browseJunk(r)).length;
  const rows = BROWSE_DEV ? all : all.filter(({ r }) => !browseJunk(r));
  const count = (f) => rows.filter(({ r }) => browseMatch(r, f)).length;
  const chips = BROWSE_CHIPS.map(([f, lbl]) =>
    `<button class="bchip ${BROWSE_FILTER === f ? "on" : ""}" data-bfilter="${f}">${lbl} <em>${count(f)}</em></button>`).join("")
    + (nJunk ? `<button class="bchip bchip--dev ${BROWSE_DEV ? "on" : ""}" data-bdev="1"
        title="${BROWSE_DEV ? "hide" : "show"} the game's IE drive sections and number-only routes — dev and leftover geometry, not destinations">${BROWSE_DEV ? "hide" : "show"} dev <em>${nJunk}</em></button>` : "");
  // SORTING (Jett 2026-09-11): the filter chips narrow WHICH courses show; these order them. Each key has a
  // sensible natural direction (name A–Z, most laps first, longest first, grouped by kind); clicking the active
  // sort reverses it. Every key falls back to name so ties are stable.
  const nameCmp = (a, b) => (a.r.name ? 0 : 1) - (b.r.name ? 0 : 1) || (a.r.name || "").localeCompare(b.r.name || "") || (a.id - b.id);
  const kindKey = (r) => (r.disc || "~") + "|" + (r.is_race ? "0" : (r.modes || []).includes("rivals") ? "1" : (r.modes || []).includes("career") ? "2" : "3");
  const CMP = {
    name: nameCmp,
    laps: (a, b) => (b.r.laps || 0) - (a.r.laps || 0) || nameCmp(a, b),
    length: (a, b) => (b.r.len || 0) - (a.r.len || 0) || nameCmp(a, b),
    type: (a, b) => kindKey(a.r).localeCompare(kindKey(b.r)) || nameCmp(a, b),
  };
  const cmp = CMP[BROWSE_SORT] || nameCmp;
  const sel = rows.filter(({ r }) => browseMatch(r, BROWSE_FILTER)).sort((a, b) => BROWSE_SORT_REV ? -cmp(a, b) : cmp(a, b));
  const SORTS = [["name", "name"], ["laps", "laps"], ["length", "length"], ["type", "kind"]];
  const sortRow = `<div class="bsort"><span class="why">sort</span>${SORTS.map(([k, lbl]) =>
    `<button class="mini${BROWSE_SORT === k ? " on" : ""}" data-bsort="${k}" title="sort by ${lbl}${BROWSE_SORT === k ? " · click again to reverse" : ""}">${lbl}${BROWSE_SORT === k ? (BROWSE_SORT_REV ? " ↑" : " ↓") : ""}</button>`).join("")}</div>`;
  const tiles = sel.map(({ id, r }) => {
    const nm = r.name || ("Route " + id);
    const laps = r.laps || 0, sess = r.sessions || 0;
    // LAPS lead -- they are the usable data samples; RUNS (independent play sessions) are demoted to muted
    // context (Jett 2026-09-07: "the number of laps ... represents actual usable data samples").
    const data = laps ? `<span class="tdata">${laps} lap${laps === 1 ? "" : "s"}</span><span class="truns"> · ${sess} run${sess === 1 ? "" : "s"}</span>`
                      : `<span class="tdata none">no data yet</span>`;
    // performance-class pills: every class the Rivals course is offered in. SOLID = we hold data for that class,
    // NEGATIVE (hollow: black fill, class-colour outline + letter) = offered but no laps yet -- so the classes we
    // still need to drive read at a glance. Same established piBadge design (.pib pib--sm pib-<class>), + .pib--neg.
    const dataSet = new Set(r.class_data || []);
    const pill = (c) => { const has = dataSet.has(c);
      return `<span class="pib pib--sm pib-${c.toLowerCase()}${has ? "" : " pib--neg"}" title="class ${c}${has ? " · has data" : " · no data yet"}"><b>${esc(c)}</b></span>`; };
    const cls = (r.classes || []).length ? `<div class="tcls">${r.classes.map(pill).join("")}</div>` : "";
    const badges = [r.is_race ? `<span class="bb race">race</span>` : "",
                    (r.modes || []).includes("rivals") ? `<span class="bb riv">rivals</span>` : "",
                    (r.modes || []).includes("career") ? `<span class="bb car">career</span>` : "",
                    r.disc ? `<span class="bb dsc">${esc(r.disc)}</span>` : ""].join("");
    return `<button class="tile ${BROWSE_PICK === id ? "on" : ""}" data-bpick="${id}" title="${esc(nm)}">
      ${tileSvg(r, BROWSE_PICK === id)}
      <div class="tnm">${esc(nm)}</div>
      <div class="tmeta">${n0(r.len)} m${r.loop ? " · loop" : " · P2P"} · ${data}</div>
      ${cls}
      <div class="tbadges">${badges}</div></button>`;
  }).join("");
  return `<div class="bchips">${chips}</div>
    ${sortRow}
    <div class="tiles">${tiles || `<div class="why">no courses in this filter</div>`}</div>`;
}
function wireBrowser(body) {
  body.querySelectorAll("[data-bfilter]").forEach((b) => b.onclick = () => {
    BROWSE_FILTER = b.dataset.bfilter; VIEW.global.browseFilter = BROWSE_FILTER; viewSave(); paintRight(); paintLeftHeader(); });
  body.querySelectorAll("[data-bdev]").forEach((b) => b.onclick = () => {
    BROWSE_DEV = !BROWSE_DEV; VIEW.global.browseDev = BROWSE_DEV; viewSave(); paintRight(); paintLeftHeader(); });
  body.querySelectorAll("[data-bsort]").forEach((b) => b.onclick = () => {
    const k = b.dataset.bsort;
    if (BROWSE_SORT === k) BROWSE_SORT_REV = !BROWSE_SORT_REV; else { BROWSE_SORT = k; BROWSE_SORT_REV = false; }
    VIEW.global.browseSort = BROWSE_SORT; VIEW.global.browseSortRev = BROWSE_SORT_REV; viewSave(); paintRight(); });
  body.querySelectorAll("[data-bpick]").forEach((b) => {
    b.onclick = () => browsePick(b.dataset.bpick);
    // double-click opens the course's full analysis in a temporary course-browser view (released by context)
    b.ondblclick = (e) => { e.preventDefault(); enterTempCourse(b.dataset.bpick); };
    // the same preview in reverse — hovering a tile lights its trace on the map, without picking it
    b.onmouseenter = () => hoverCourse(b.dataset.bpick);
    b.onmouseleave = () => hoverCourse(null);
  });
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
  // COURSE VIEW ONLY, per the design above — the whole point of the WORLD map is seeing your
  // position on the island, so a satnav zoom there defeats it. Bug (2026-09-03): this never
  // checked context, so slowing down or braking anywhere in free roam collapsed the world map to
  // a ~180 m window with no route in view — indistinguishable from "no live position" to the
  // person looking at it. FOLLOW.on can still be true (persisted from the course map's own
  // toggle); it just does nothing outside a course now.
  if (!(MODE.suggest === "course" && COURSE)) return null;
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
// The close-detail class, the live-dot radius and the #mapScale note, from the CURRENT viewBox width.
// Shared so that when MAPVIEW owns the viewBox (course-browser framing / the live overview) followMap can
// present the scale WITHOUT also writing the viewBox -- writing it was the two-writer conflict that made the
// map flick island<->zoom every telemetry frame (follow slammed to the island, mapTick eased back to the box).
function presentScale(svg, vw, sc) {
  const across = Math.round((vw || 0) / sc);
  svg.classList.toggle("close", across < 600);
  const dot = svg.querySelector("#liveDot circle");
  if (dot) dot.setAttribute("r", across < 300 ? 7 : across < 700 ? 5 : 4);
  const note = document.getElementById("mapScale");
  if (note) note.textContent = across >= 3000 ? "whole island" : across + " m across";
}
// COURSE FOLLOW CAMERA (Jett 2026-09-11, Q1): the whole-course map zooms in to follow the car ONLY while a lap
// is live, and eases back to the full-course fit on the live→held edge (a pause, the end-of-event menu and
// browsing all keep the static fit). Reads LIVE.lap.live + LIVEPOS + LIVE_HEAD (heading, for the look-ahead).
// The window is a ~180 m span centred 0.55 on the car / 0.45 on where it is heading, so the road ahead leads.
function courseFollow(svg, sc, H, pad) {
  const full = FOLLOW.full;
  const live = !!(LIVE.lap && LIVE.lap.live) && Array.isArray(LIVEPOS);
  if (live && !FOLLOW.wasLive) FOLLOW.span = null;            // snap in on the held→live edge
  FOLLOW.wasLive = live;
  let cxT, czT, wantW;
  if (live) {
    const carX = pad + (LIVEPOS[0] - +svg.dataset.x0) * sc, carY = H - pad - (LIVEPOS[1] - +svg.dataset.z0) * sc;
    wantW = Math.min(full.w, 180 * sc * 1.3);
    let laX = carX, laY = carY;
    if (LIVE_HEAD.a != null) { const r = LIVE_HEAD.a * Math.PI / 180, look = wantW * 0.28; laX = carX + Math.sin(r) * look; laY = carY - Math.cos(r) * look; }
    cxT = carX * 0.55 + laX * 0.45; czT = carY * 0.55 + laY * 0.45;
  } else { wantW = full.w; cxT = full.w / 2; czT = full.h / 2; }
  if (FOLLOW.span == null) {
    if (!live) { svg.setAttribute("viewBox", `0 0 ${full.w} ${full.h}`); return; }   // idle: already the full fit
    FOLLOW.span = wantW; FOLLOW.cx = cxT; FOLLOW.cz = czT;                            // live edge: snap the window in
  }
  const k = 0.12;
  FOLLOW.span += (wantW - FOLLOW.span) * k; FOLLOW.cx += (cxT - FOLLOW.cx) * k; FOLLOW.cz += (czT - FOLLOW.cz) * k;
  const vw = FOLLOW.span, vh = vw * (full.h / full.w);
  const vx = Math.max(0, Math.min(full.w - vw, FOLLOW.cx - vw / 2)), vy = Math.max(0, Math.min(full.h - vh, FOLLOW.cz - vh / 2));
  svg.setAttribute("viewBox", vx.toFixed(1) + " " + vy.toFixed(1) + " " + vw.toFixed(1) + " " + vh.toFixed(1));
  svg.classList.toggle("close", Math.round(vw / sc) < 600);
  if (live || Math.abs(FOLLOW.span - full.w) >= 2) queueFollow();                     // keep following, or keep easing back
  else { svg.setAttribute("viewBox", `0 0 ${full.w} ${full.h}`); FOLLOW.span = null; }  // settled to full → stop
}
function followMap() {
  FOLLOW.raf = 0;
  const body = $("#leftBody");
  const courseMode = MODE.suggest === "course" && !!COURSE;
  // in course view the FIRST svg in the pane is the hero glyph; the map is .cmap svg[data-x0]
  const svg = courseMode ? (body && body.querySelector(".cmap svg[data-x0]")) : (body && body.querySelector("svg"));
  if (!svg || svg.dataset.x0 == null) return;
  const sc = +svg.dataset.s, H = +svg.dataset.h, pad = +svg.dataset.pad;
  const W = +svg.dataset.w || svg.viewBox.baseVal.width || 900;
  // Self-invalidating extent cache: re-capture whenever the SVG is rebuilt at a new size OR the context
  // (course vs world) changes, so the eased box is always seeded against the box actually on screen.
  const ctx = courseMode ? "course" : "world";
  if (!FOLLOW.full || FOLLOW.ctx !== ctx || (Number.isFinite(W) && Number.isFinite(H) && (FOLLOW.full.w !== W || FOLLOW.full.h !== H))) {
    FOLLOW.full = { w: W, h: H }; FOLLOW.ctx = ctx; FOLLOW.span = null;
  }
  if (courseMode) { courseFollow(svg, sc, H, pad); return; }
  // free roam: present-only (never write viewBox) unless the user opted into the follow preview — MAPVIEW owns
  // the viewBox otherwise (the flicker fix).
  if (!FOLLOW.on) {
    presentScale(svg, (typeof MAPVIEW !== "undefined" && MAPVIEW.cw) || svg.viewBox.baseVal.width || W, sc);
    return;
  }
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
  // svg[data-x0], not the first svg: only the course map carries data-x0. Other SVGs can share the pane
  // (the shape glyph, now in the pill's drawer; a trace), and the dot must land on the map, not on them.
  const svg = body.querySelector("svg[data-x0]"); if (!svg || !LIVEPOS || !isFinite(+svg.dataset.s)) return;
  let g = svg.querySelector("#liveDot");
  // v1-style (2026-09-03): the dot element is created ONCE and MOVED via a transform on every
  // update, never rebuilt -- rewriting innerHTML every frame (the old approach) replaces the
  // circle with a brand-new element each time, which is exactly why a CSS transition could never
  // have worked before even if one had been added: there was never the same element around long
  // enough to transition. Two pre-built circles (solid / held) are toggled by display instead of
  // being re-created, matching app.js's updCarDot (~line 3283-3298).
  // THE CAR MARKER (Jett 2026-09-11): a white arrow pointing where the car is going, in an accent pulse ring --
  // the same "you" the speed trace draws. Never amber (#e3b341 is IMPACT) and never a grip colour. Held (menu /
  // loading) = the same shape hollow and grey, no pulse. Sized in SCREEN pixels (.ld-s counter-scales the
  // viewBox), so it reads the same on the static course map and at any world-map zoom.
  if (!g || !g.firstChild) {
    if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.id = "liveDot"; svg.appendChild(g); }
    const arrow = `d="M0,-8 L6.2,6.5 L0,3.2 L-6.2,6.5 Z" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
    g.setAttribute("pointer-events", "none");
    g.innerHTML = `<g class="ld-s"><g class="ld-rot">`
      + `<g class="ld-solid"><title>you, now</title><circle r="7" fill="none" stroke="var(--acc2)" stroke-width="2" vector-effect="non-scaling-stroke">`
      + `<animate attributeName="r" values="7;15;7" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".95;.1;.95" dur="1.1s" repeatCount="indefinite"/></circle>`
      + `<path class="ld-arrow" ${arrow} fill="#fff" stroke="#04101c" stroke-width="1.6"/>`
      + `<circle class="ld-disc" r="5" fill="#fff" stroke="#04101c" stroke-width="1.6" vector-effect="non-scaling-stroke"/></g>`
      + `<g class="ld-held"><title>last known position — held through the menu / loading screen</title>`
      + `<path class="ld-arrow" ${arrow} fill="#0d1117" fill-opacity=".6" stroke="#8b97a7" stroke-width="1.6" stroke-dasharray="2.5 2"/>`
      + `<circle class="ld-disc" r="5" fill="none" stroke="#8b97a7" stroke-width="1.6" stroke-dasharray="2.5 2" vector-effect="non-scaling-stroke"/></g>`
      + `</g></g>`;
  }
  const x0 = +svg.dataset.x0, z0 = +svg.dataset.z0, s = +svg.dataset.s, H = +svg.dataset.h, pad = +svg.dataset.pad;
  if (!isFinite(s)) return;
  const cx = pad + (LIVEPOS[0] - x0) * s, cy = H - pad - (LIVEPOS[1] - z0) * s;
  const held = !!LIVE.posHeld;      // no driving frame right now: the last real position, hollow and grey
  queueFollow();
  // HEADING FROM MOTION: the frame has no yaw angle (its `yaw` is a rate), so the arrow points along the last
  // >= 2 m of travel. A jump of hundreds of metres is a teleport, not a direction. Until the car has moved the
  // marker is a disc -- an arrow pointing nowhere in particular would be a claim the data cannot make.
  const hp = LIVE_HEAD.p, dx = hp ? LIVEPOS[0] - hp[0] : 0, dz = hp ? LIVEPOS[1] - hp[1] : 0, d2 = dx * dx + dz * dz;
  if (!hp || d2 > 4) {
    if (hp && d2 < 250000) LIVE_HEAD.a = Math.atan2(dx, dz) * 180 / Math.PI;   // screen y is -z, so clockwise from up
    LIVE_HEAD.p = LIVEPOS.slice();
  }
  // POSITION BEFORE FIRST PAINT (matches app.js:3290-3297): a freshly-created/rebuilt map's dot
  // has no transform attribute yet, so this placement has nothing to transition FROM -- flushing
  // layout here (once, only on first placement) commits it instantly instead of letting the
  // transition animate in from the SVG's origin corner.
  const firstPlace = !g.hasAttribute("transform");
  g.setAttribute("transform", `translate(${cx.toFixed(1)},${cy.toFixed(1)})`);
  if (firstPlace) void g.getBoundingClientRect();
  const ctm = svg.getScreenCTM(), u = ctm && ctm.a ? 1 / ctm.a : 1;
  const sg = g.querySelector(".ld-s");
  if (sg && (!g._u || Math.abs(u / g._u - 1) > 0.03)) { g._u = u; sg.setAttribute("transform", `scale(${u.toPrecision(4)})`); }
  const rg = g.querySelector(".ld-rot");
  if (rg && LIVE_HEAD.a != null) rg.setAttribute("transform", `rotate(${LIVE_HEAD.a.toFixed(0)})`);
  g.classList.toggle("held", held);
  g.classList.toggle("nohead", LIVE_HEAD.a == null);
}
const LIVE_HEAD = { p: null, a: null };
// the same marker on the speed trace, at the live lap's last point (live: pulsing; last run: hollow grey)
function youMarkSvg(x, y, now) {
  const X = x.toFixed(1), Y = y.toFixed(1);
  return now
    ? `<circle cx="${X}" cy="${Y}" r="4.5" fill="none" stroke="var(--acc2)" stroke-width="2"><animate attributeName="r" values="4.5;9;4.5" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".95;.1;.95" dur="1.1s" repeatCount="indefinite"/></circle><circle cx="${X}" cy="${Y}" r="3.8" fill="#fff" stroke="#04101c" stroke-width="1.4"><title>you, now</title></circle>`
    : `<circle cx="${X}" cy="${Y}" r="3.8" fill="#0d1117" stroke="#8b97a7" stroke-width="1.5" stroke-dasharray="2.5 2"><title>where the last run stopped</title></circle>`;
}

// THE LIVE LAP ON THE COURSE MAP (Jett 2026-09-11): the lap being driven, written onto the static course map as
// the car goes -- the speed trace's live language (accent glow under a grip-painted line, thicker than any
// history lap) plus an impact starburst wherever the lap recorded grip 4. LIVE.lap (live.js) is the source.
// Built ONCE per map and APPENDED to (points pushed onto the open polyline; a new polyline only when the grip
// state changes or the car teleports) -- never an innerHTML repaint per sample. History recedes by a class on
// .cmap (styles.css), so nothing in the map's own SVG is touched.
// The lap to show: the current one, except in its first 3 s, when the lap just finished stays up -- a lap-number
// tick at the finish line (or the post-race roll-out) must not wipe the lap the driver wants to read.
function liveLapShown() {
  const c = LIVE.lap, p = LIVE.lapPrev;
  if (!c) return null;
  return (c.pts.length < 30 && p && p.pts.length >= 30) ? p : c;
}
function liveLapFor(c) {
  const l = liveLapShown();
  return (l && c && l.key === c.key && l.pts.length > 1) ? l : null;
}
function liveLapSig() {
  const l = MODE.suggest === "course" && COURSE ? liveLapFor(COURSE) : null;
  return l ? [l.seq, l.pts.length, !!LIVE.lap.live] : 0;
}
// live <-> held edges: the map's classes and the trace's chip both change, so both repaint (once per edge)
function liveLapChanged() { liveLapPaint(); paintTrace(); }
const IMPACT_BURST = "M 0 -5.5 L 1.5 -1.5 L 5.5 0 L 1.5 1.5 L 0 5.5 L -1.5 1.5 L -5.5 0 L -1.5 -1.5 Z";   // v1's impact glyph
function liveLapPaint() {
  const body = $("#leftBody"), svg = body && body.querySelector(".cmap > svg"), g = svg && svg.querySelector("#liveLap");
  if (!g) return;
  const wrap = svg.parentNode;
  const lap = (MODE.suggest === "course" && COURSE) ? liveLapFor(COURSE) : null;
  const now = !!(lap && LIVE.lap && LIVE.lap.live);
  const mode = TRACE_MODE === "speed" || TRACE_MODE === "pedals" ? TRACE_MODE : "grip", sc = mode === "speed" ? courseSpeedRange(COURSE) : null;
  wrap.classList.toggle("live-on", now);
  wrap.classList.toggle("live-last", !!lap && !now);
  wrap.classList.toggle("trail-speed", mode === "speed");
  wrap.classList.toggle("trail-pedals", mode === "pedals");
  if (!lap) { if (g._seq != null) { g.textContent = ""; g._seq = null; } return; }
  const ds = svg.dataset, x0 = +ds.x0, z0 = +ds.z0, s = +ds.s, H = +ds.h, pad = +ds.pad;
  if (!isFinite(s)) return;
  const base = piColor(CUR && CUR.cls);
  // a different lap, a rewind cut (new seq), a changed class colour or a cap trim: redraw this layer once
  if (g._seq !== lap.seq || g._lap !== lap || g._base !== base || g._mode !== mode || g._abs < lap.n0) {
    g.innerHTML = `<g class="ll-glow"></g><g class="ll-grip"></g><g class="ll-imp"></g>`;
    const ctm = svg.getScreenCTM();
    Object.assign(g, { _seq: lap.seq, _lap: lap, _base: base, _mode: mode, _abs: lap.n0, _last: null, _glow: null, _line: null, _k: -1, _imp: null, _u: ctm && ctm.a ? 1 / ctm.a : 1 });
    wrap.style.setProperty("--live-calm", gripInk(0, base));
  }
  const NS = "http://www.w3.org/2000/svg", [gGlow, gGrip, gImp] = g.children;
  const poly = (host, col, w, op) => {
    const p = document.createElementNS(NS, "polyline");
    p.setAttribute("fill", "none"); p.setAttribute("stroke", col); p.setAttribute("stroke-width", w);
    p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("vector-effect", "non-scaling-stroke"); if (op != null) p.setAttribute("opacity", op);
    host.appendChild(p); return p;
  };
  const add = (p, x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; p.points.appendItem(q); };
  for (let i = g._abs - lap.n0; i < lap.pts.length; i++) {
    const q = lap.pts[i], X = pad + (q[3] - x0) * s, Y = H - pad - (q[4] - z0) * s;
    if (!isFinite(X) || !isFinite(Y)) continue;
    const L = g._last, jump = !!L && Math.hypot(q[3] - L[3], q[4] - L[4]) > 60;   // a respawn never draws a streak
    if (!g._glow || jump) { g._glow = poly(gGlow, "var(--acc2)", 8, 0.3); g._line = null; }
    add(g._glow, X, Y);
    // the colour key: grip state, or the speed band on the course's own scale (impacts still burst either way)
    const k = mode === "pedals" ? pedalKey(q[8], q[9])
      : (mode === "speed" && sc) ? Math.max(0, Math.min(GRAD.length - 1, Math.floor(((q[1] - sc.lo) / (sc.hi - sc.lo)) * GRAD.length))) : q[2] | 0;
    if (!g._line || k !== g._k) {
      const nl = poly(gGrip, mode === "pedals" ? pedalCol(k) : mode === "speed" && sc ? GRAD[k] : gripInk(k, base), (mode !== "grip" || k) ? 4 : 3.4);
      if (g._line) add(nl, g._lx, g._ly);                 // butt onto the previous state's last point: no gaps
      g._line = nl; g._k = k;
    }
    add(g._line, X, Y);
    if ((q[2] | 0) === 4 && (!g._imp || Math.hypot(q[3] - g._imp[0], q[4] - g._imp[1]) > 12)) {   // v1's 12 m impact dedup
      const b = document.createElementNS(NS, "path");
      b.setAttribute("d", IMPACT_BURST); b.setAttribute("transform", `translate(${X.toFixed(1)},${Y.toFixed(1)}) scale(${(g._u * 1.7).toPrecision(3)})`);
      b.setAttribute("fill", DGRIP.impact.col); b.setAttribute("stroke", "#0d1117"); b.setAttribute("stroke-width", "1.2"); b.setAttribute("vector-effect", "non-scaling-stroke");
      gImp.appendChild(b); g._imp = [q[3], q[4]];
    }
    g._last = q; g._lx = X; g._ly = Y;
  }
  g._abs = lap.n0 + lap.pts.length;
}

// which learned course is the live car on? nearest course whose path passes within 60 m
// Learned courses share road (17 pairs in world.json overlap within 60 m), so the incumbent keeps
// the car while it is within 90 m unless a challenger is nearer by 25 m: a flip a second after a
// reload would orphan the per-course view state that was just restored.
// THE START/FINISH LINE NAMES THE MAP (Jett 2026-09-06). The daemon crosses the S/F at event start and
// matches that point to a route START (fh6_live_daemon._match_route_name) — one route per start, so it is
// UNAMBIGUOUS, unlike the whole-path position match. It arrives as the `loop` SSE event; adopt it as the
// authoritative identity for the event, resolving to a learned course (with laps) by name when we have one,
// else the catalogued route (map + name). Position matching (locateCourse / locateRouteInEvent) is then only
// the fallback for free roam and roads with no S/F crossing.
async function adoptLoop(loop) {
  const nm = loop && loop.name && loop.name !== "Rivals course" ? loop.name : null;
  LOOP = nm ? { name: nm, start: loop.start || null } : null;
  if (!LOOP) { if (ROUTE) { ROUTE = null; paintLeft(); } return; }   // loop ended -> let position take over
  const learned = WORLD && Object.entries(WORLD.courses).find(([, c]) => c.name && c.name === nm);
  if (learned) {
    if (learned[0] === COURSE_KEY) { ROUTE = null; paintLeft(); return; }
    const ok = await onCourseChange(COURSE_KEY, learned[0]);
    if (ok) { ROUTE = null; return; }
    // the learned course's file is not built yet -> fall through to the catalogued route (map from world.json)
  }
  const cat = WORLD && Object.entries(WORLD.routes).find(([, r]) => r.name === nm);
  if (cat) {
    if (COURSE_KEY) { COURSE = null; COURSE_KEY = null; }
    ROUTE = { id: cat[0], name: nm, len: cat[1].len, loop: cat[1].loop, alsoName: null };
  }
  paintLeft();
}

async function locateCourse() {
  if (LOOP) return;                                   // the S/F crossing already named the route — authoritative
  if (!LIVEPOS || !WORLD || !WORLD.courses) return;
  // IN AN EVENT WITH NO DAEMON-NAMED LOOP, DON'T FLAP AMONG LEARNED COURSES (Jett 2026-09-07: driving
  // the Goliath, "the map was CONSTANTLY switching between maps that wasn't the goliath"). An offset-
  // start / long route (the Goliath's S/F didn't resolve to a start, so the daemon says "Rivals course"
  // and LOOP is null) threads through many short learned courses' roads; point-to-segment then finds a
  // DIFFERENT one momentarily nearest almost every frame and the incumbent's 25 m hysteresis can't hold
  // against a course dead-on the shared tarmac. So skip the learned-course proximity match here and let
  // locateRouteInEvent name the stable CATALOGUED route (its longest-route-wins tie-break keeps the
  // Goliath over the sprints that reuse its road). Learned-course location still runs in free roam.
  if (MODE.game === "event") {
    if (COURSE_KEY) { COURSE = null; COURSE_KEY = null; }   // drop whatever short course last flapped in
    COURSE_MATCH = null;
    locateRouteInEvent(false);
    return;
  }
  // Distance from the live car to a course's LINE, not its vertices. The world path is a decimated
  // centre-line — on a long course like The Goliath it sits ~415 m between points, so the nearest
  // VERTEX can be 87 m away mid-course (over the 60 m radius) even while the car is dead on the road,
  // 2 m from the line. Point-to-vertex then failed to locate the Goliath at all, and the view stayed
  // stuck on whatever course was shown last (the Sekibe Scramble report). Point-to-SEGMENT locates it.
  const near = (c) => {
    const p = c.path || [];
    if (p.length < 2) return p.length ? Math.hypot(p[0][0] - LIVEPOS[0], p[0][1] - LIVEPOS[1]) : Infinity;
    let bd = Infinity;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], dx = p[i + 1][0] - ax, dz = p[i + 1][1] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 ? ((LIVEPOS[0] - ax) * dx + (LIVEPOS[1] - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(LIVEPOS[0] - (ax + t * dx), LIVEPOS[1] - (az + t * dz));
      if (d < bd) bd = d;
    }
    return bd;
  };
  let best = null, bd = 60, second = null, sd = Infinity;
  for (const [key, c] of Object.entries(WORLD.courses)) {
    const d = near(c);
    if (d < bd) { second = best; sd = bd; best = key; bd = d; }
    else if (d < sd) { second = key; sd = d; }
  }
  if (COURSE_KEY && WORLD.courses[COURSE_KEY]) {
    const dInc = near(WORLD.courses[COURSE_KEY]);
    if (dInc <= 90 && (best == null || bd >= dInc - 25)) { best = COURSE_KEY; bd = dInc; }
  }
  // a course is never its own backup: the incumbent promotion above can make `best` the same key the
  // loop had parked in `second`, which then rendered "could also be <the course you're on>" (Jett
  // 2026-09-07). Drop the runner-up when it collapses onto the pick.
  if (second === best) { second = null; sd = Infinity; }
  // how sure this is: some learned courses share road within the match radius (see courseConfidenceBadge)
  COURSE_MATCH = { dist: bd, secondKey: second, secondDist: sd };
  ctxSave({ livePos: LIVEPOS });
  if (best && best !== COURSE_KEY) await onCourseChange(COURSE_KEY, best);
  locateRouteInEvent(!!best);
}

// IN A TIMED EVENT THE MAP IS KNOWN (Jett 2026-09-06: "if it identifies that we are in rivals there is
// no reason that the map should not be identified"). A Rivals / race run is always on one of the game's
// catalogued routes, and the client holds every route's DENSE centre-line (WORLD.routes, ~8 m spacing).
// So when we're in an event but no LEARNED course is located (a route never driven, or one whose learned
// path is too sparse), match the car to the catalogued route and name the map from that. Routes share
// roads, so the pick is honest about a near runner-up.
function locateRouteInEvent(haveCourse) {
  if (MODE.game !== "event" || haveCourse || !LIVEPOS || !WORLD || !WORLD.routes) {
    if (ROUTE) { ROUTE = null; paintLeft(); }
    return;
  }
  const segNear = (pts) => {
    let bd = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az, l2 = dx * dx + dz * dz;
      let t = l2 ? ((LIVEPOS[0] - ax) * dx + (LIVEPOS[1] - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(LIVEPOS[0] - (ax + t * dx), LIVEPOS[1] - (az + t * dz)); if (d < bd) bd = d;
    }
    return bd;
  };
  const hits = [];                                              // named routes only — all 88 Rivals routes are named
  for (const [id, r] of Object.entries(WORLD.routes)) {
    if (!r.name || !(r.pts || []).length) continue;
    const d = segNear(r._lo || r.pts);   // strided ~16 m copy: full-density r.pts is for DRAWING the focus route, not per-frame matching
    if (d < 45) hits.push({ id, name: r.name, len: r.len || 0, loop: r.loop, dist: d });
  }
  hits.sort((a, b) => a.dist - b.dist);
  let best = null;
  if (hits.length) {
    const nearD = hits[0].dist;
    // routes share roads, so several can be equally near. A Rivals run is the route you LOADED, which
    // on a shared stretch is the through-route, not a sub-segment of it — break the near-tie toward the
    // LONGER route (the Goliath over a sprint that reuses its start), then name the runner-up as shared.
    const tied = hits.filter((h) => h.dist <= nearD + 15);
    best = tied.reduce((m, h) => (h.len > m.len ? h : m), tied[0]);
    // "shares road with X" only when X is a COMPARABLE-length route (>= half the through-route). A tiny
    // course the through-route merely spawns beside -- Sekibe Scramble (~2 km) next to a 25-min route --
    // is a plaza coincidence at the start line, not a shared road, and must not be named (Jett 2026-09-07).
    const other = hits.find((h) => h.id !== best.id && h.dist <= best.dist + 25 && (h.len || 0) >= (best.len || 0) * 0.5);
    best.alsoName = other ? other.name : null;
  }
  const changed = (best && best.id) !== (ROUTE && ROUTE.id);
  ROUTE = best;
  if (changed) { if (COURSE_KEY) { COURSE = null; COURSE_KEY = null; } paintLeft(); }
}

// A learned course's path can pass within the match radius of a different learned course (same
// road, two names) — when the runner-up is nearly as close as the pick, say so rather than let a
// per-turn view present wrong turn labels with the same confidence as a clean pick.
function courseConfidenceBadge() {
  if (!COURSE_MATCH || !COURSE_MATCH.secondKey || !isFinite(COURSE_MATCH.secondDist)) return "";
  if (COURSE_MATCH.secondKey === COURSE_KEY) return "";   // never "could also be <the course you're on>"
  if (COURSE_MATCH.secondDist > COURSE_MATCH.dist * 2) return "";
  const other = (WORLD.courses[COURSE_MATCH.secondKey] || {}).name || COURSE_MATCH.secondKey;
  return ` <span class="chip w" title="this course's path passes within ${Math.round(COURSE_MATCH.secondDist)} m of another learned course here — turns could be attributed to the wrong course if identification flips">⚠ could also be ${esc(other)}</span>`;
}

/* ------------------------------------------------------------ right */
// Which pane the context calls for. In a menu the build is what can change, so its data asks and
// ratification steps lead; on the road the corners you are taking lead; on a course with a
// baseline set, the conclusions lead. A click pins a tab until the context class changes.
const RT_LABEL = { lap: "Current lap", corners: "Live corners", matrix: "Turn analysis", stats: "General statistics", concl: "Conclusions", build: "Build data", browser: "Course Browser", services: "Services" };
// "build" (Build Data) disabled for free mode 2026-09-03 (Jett: "does not seem immediately useful
// to me") -- NOT deleted, RT_LABEL.build and its render path are untouched, just dropped from the
// list this function returns. Add "build" back to the free-mode array below to re-enable it.
// "concl" (Conclusions) dropped from the tab list 2026-09-11 (Jett) — same pattern as "build": RT_LABEL.concl
// and conclusionsHTML()'s render path below are UNTOUCHED, just not offered as a tab, so it comes back for the
// tuning-suggestions pass by adding "concl" back to the course array here.
function rightTabs() { return (MODE.suggest === "course" && COURSE) ? ["lap", "corners", "matrix", "stats"] : ["corners", "stats", "browser"]; }
function rightContext() {
  const course = MODE.suggest === "course" && COURSE;
  if (LIVE.inMenu || !LIVE.frame) return "stats";   // "build" was the free-mode fallback here; disabled alongside the tab (2026-09-03)
  if (course && LIVE.frame.on && LIVE.frame.ev) return "lap";   // actively driving a course lap -> the live current-lap tab leads
  if (course && BASELINE) return "concl";
  if (course) return "matrix";      // course mode leads with Turn analysis (Jett 2026-09-06); a baseline still leads with conclusions
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
  const why = { lap: "each turn rated as you take it · minimum speed against the scope",
                corners: "every corner as you take it · newest first", matrix: "one row per course turn · this session",
                stats: "world-wide · ranked by frequency × impact · free roam needs more samples",
                concl: "this course's turns · what to change", build: "what the save gives, what a drive still has to provide",
                browser: "every known course · pick one to locate it on the map",
                services: "the three processes the lab runs · start, stop or restart each one" }[cur];
  hd.innerHTML = `<span class="tabs2">${tabs.map((t) => `<button class="${cur === t ? "on" : ""}" data-rt="${t}">${RT_LABEL[t]}</button>`).join("")}</span><span class="why">${esc(why)}</span>`;
  hd.querySelectorAll("[data-rt]").forEach((b) => b.onclick = () => { RIGHT_TAB = b.dataset.rt; rightTabStore()[ctx] = RIGHT_TAB; viewSave(); paintRight(); });
  body.innerHTML = cur === "lap" ? lapHTML() : cur === "corners" ? cornersHTML() : cur === "matrix" ? matrixHTML() : cur === "concl" ? conclusionsHTML() : cur === "build" ? buildDataHTML() : cur === "browser" ? browserHTML() : cur === "services" ? servicesHTML() : statsHTML();
  body.querySelectorAll('[data-act="rebuild"]').forEach((b) => b.onclick = () => requestRebuild("manual"));
  body.querySelectorAll("[data-svcact]").forEach((b) => b.onclick = () => svcAct(b.dataset.svc, b.dataset.svcact));
  body.querySelectorAll("[data-svcrefresh]").forEach((b) => b.onclick = () => svcRefresh());
  if (!SVC.list.length && !SVC.err && body.querySelector(".svcrow, [data-svcrefresh]")) svcRefresh();
  if (cur === "browser") wireBrowser(body);
  if (cur === "matrix") {
    body.querySelectorAll("[data-turn]").forEach((r) => r.onclick = () => pickTurn(r.dataset.turn));
    const cl = body.querySelector("[data-turnclear]"); if (cl) cl.onclick = () => pickTurn(null);
    body.querySelectorAll("[data-turnstep]").forEach((b) => b.onclick = () => stepTurn(b.dataset.turnstep === "prev" ? -1 : 1));
    // hover a phase row -> light the matching part on the left map, and vice-versa
    body.querySelectorAll("[data-phase]").forEach((r) => {
      r.onmouseenter = () => hiPhase(r.dataset.phase); r.onmouseleave = () => hiPhase(null);
    });
    // click a leaderboard lap -> isolate its trace on the corner map (dim the rest); re-apply after a repaint
    body.querySelectorAll(".tlb-row[data-lap]").forEach((r) => r.onclick = () => pickLap(r.dataset.lap));
    // corner-map trace colouring: position (solid by leaderboard rank, default) vs speed (per-point gradient)
    body.querySelectorAll("[data-cmtrace]").forEach((b) => b.onclick = () => { CM_TRACE_MODE = b.dataset.cmtrace; try { localStorage.setItem("fh6CmTrace", CM_TRACE_MODE); } catch (e) {} paintRight(); });
    applyLapPick();
  }
  if (cur === "lap") {
    // a nav button or a table row picks the window's turn (held until the next turn is taken); heads sort the table
    body.querySelectorAll("[data-lapwin]").forEach((b) => b.onclick = () => { LAP_WIN = { key: COURSE && COURSE.key, seq: +b.dataset.lapwin, n: LAP_N }; paintRight(); });
    body.querySelectorAll("[data-lapsort]").forEach((b) => b.onclick = () => { LAP_SORT = b.dataset.lapsort; try { localStorage.setItem("fh6LapSort", LAP_SORT); } catch (e) {} paintRight(); });
  }
  if (cur === "stats") body.querySelectorAll("[data-clsfocus]").forEach((b) => b.onclick = () => {
    if (!COURSE) return; const cls = b.dataset.clsfocus, vc = traceSel(COURSE);
    if (vc.filters.class === cls) delete vc.filters.class; else vc.filters.class = cls;   // toggle the class focus (= the filter bar's class pick)
    viewSave(); repaintFiltered(); });
  const courseStats = cur === "stats" && MODE.suggest === "course" && COURSE;   // its sections manage their own overflow; do not row-clip them
  if (cur !== "matrix" && cur !== "browser" && !courseStats) fitRows(body, cur === "corners" ? "corners" : cur === "build" ? "rows" : "findings", 1);
  body.querySelectorAll('[data-pickts]').forEach((b) => b.onclick = () => {
    setPin(CUR.ordinal, b.dataset.pickts); if (COURSE) { vcourse(COURSE.key).filters.container = b.dataset.cont; viewSave(); }
    identify(carOf(CUR.cid), "pinned"); });
  if (cur === "build") fillSinceSave(body);
}

// THE CURRENT-LAP LIVE TAB: as each turn is completed (its corner event arrives) it is rated against YOUR OWN
// history for that turn — a per-turn leaderboard position on apex speed + the delta off your best apex — and
// its grip loss is read from the live corner (first-red axle/phase, else the understeer index). Course mode
// only; repaints on every corner event because the SSE "corner" handler calls paintRight().
const LIVE_PH = ["braking", "turn_in", "mid", "exit"];   // live corner phase index (1-4) -> SEG name
// GRIP RATED ACROSS THE 5-PHASE TURN (Jett 2026-09-11): grip is its OWN rating (speed is rated separately,
// left), and it reads PER PHASE -- each driving phase (braking / turn-in / mid / exit) coloured by what the
// tyres did there, its width the time spent in it, the worst phase captioned. The daemon already resolves
// each phase's state (c.phases[].red) and duration; the tab used to collapse all of it to a single
// first-red word. Falls back to that single read only when an event carries no per-phase breakdown.
const GRIP_SEV = { both: 4, impact: 4, rear: 3, front: 2, calm: 0 };
function phaseGrip(c) {
  const phs = Array.isArray(c.phases) ? c.phases : [];
  if (phs.length) {
    let worst = null;
    const cells = phs.map((p) => {
      const st = DGRIP[p.red] ? p.red : "calm", g = DGRIP[st];
      const nm = SEG_LABEL[LIVE_PH[p.phase - 1]] || ("phase " + p.phase);
      if (st !== "calm" && (!worst || GRIP_SEV[st] > GRIP_SEV[worst.st] || (GRIP_SEV[st] === GRIP_SEV[worst.st] && (p.dur || 0) > worst.dur)))
        worst = { st, ph: LIVE_PH[p.phase - 1], dur: p.dur || 0 };
      return `<span class="lap-gcell" style="flex:${Math.max(3, Math.round((p.dur || 0.3) * 40))} 0 0;background:${g.col}" title="${esc(nm)} · ${esc(g.word)}${p.dur != null ? " · " + p.dur.toFixed(2) + " s" : ""}"></span>`;
    }).join("");
    const wg = worst ? DGRIP[worst.st] : DGRIP.calm;
    const cap = worst ? `${esc(wg.word.split(/[ /]/)[0])} · ${esc(SEG_LABEL[worst.ph].split(/[ /]/)[0].toLowerCase())}` : "clean";
    return { cell: `<span class="lap-grip"><em class="lap-gword" style="color:${wg.ink}">${cap}</em><span class="lap-gbar">${cells}</span></span>`, lost: !!worst };
  }
  const gstate = c.first_red ? (c.first_red.axle === "front" ? "front" : "rear") : dGripUsi(c.usi), g = DGRIP[gstate] || DGRIP.calm;
  const gl = c.first_red ? `${g.word} · ${esc(SEG_LABEL[LIVE_PH[c.first_red.phase - 1]] || "phase " + c.first_red.phase)}` : (gstate === "calm" ? "clean" : g.word);
  return { cell: `<span class="lap-grip" style="color:${g.ink}">${gl}</span>`, lost: gstate !== "calm" };
}
function lapHTML() {
  if (!(MODE.suggest === "course" && COURSE)) return `<div class="why" style="padding:8px 6px">Drive a course to rate each turn the moment you take it.</div>`;
  const cid = CUR && CUR.cid, ls = activeLapSet();
  const mine = (LIVE.corners || []).filter((c) => (!cid || c.car === cid) && c.ev !== 0 && c.lapn != null);
  // LAP-NUMBER CONVENTIONS DIFFER (Jett 2026-09-11): a corner event stores lapn 1-based (daemon adds +1 to
  // the telemetry LapNumber), but the live FRAME reports lapn = raw LapNumber (0-based). Comparing the two
  // raw was off by one, so `taken` never matched and the tab sat empty. Convert the frame lap to the corner
  // convention (+1), and only trust it while actually in an event; otherwise take the latest corner's lap.
  const inEv = !!(LIVE.frame && LIVE.frame.on && LIVE.frame.ev);
  const frameLap = inEv ? lapNo(LIVE.frame) : null;
  const curLap = frameLap != null ? frameLap : (mine.length ? Math.max(...mine.map((c) => c.lapn)) : null);
  const onLap = mine.filter((c) => c.lapn === curLap).sort((a, b) => a.t0 - b.t0);
  // ABANDONED ATTEMPTS (handoff §5.2): a restart keeps the lap number, so one lap can hold the passes of two runs
  // (18 turns listed on a 16-turn route). The daemon stamps every corner with its run (stint); only the newest
  // run on this lap is rated, and each earlier run collapses to a single row -- never extra turns.
  const stints = [...new Set(onLap.map((c) => c.stint).filter((s) => s != null))].sort((a, b) => a - b);
  const curStint = stints.length ? stints[stints.length - 1] : null;
  const taken = curStint == null ? onLap : onLap.filter((c) => c.stint === curStint || c.stint == null);
  const abandoned = stints.slice(0, -1).map((s, i) => {
    const cs = onLap.filter((c) => c.stint === s), last = cs[cs.length - 1];
    const lt = last && turnAtMatrix(last.apex, null), stop = last && last.mph_out != null ? Math.round(last.mph_out) : null;
    return `<div class="lap-abandon"><span>▸ attempt ${i + 1} — abandoned${lt && lt.t ? " at " + esc(turnLabel(lt.t)) : ""}</span>
      <span class="why">${cs.length} turn${cs.length === 1 ? "" : "s"}${stop != null ? " · stopped at " + stop + " mph" : ""} · not ranked</span><span class="why mono">run ${s}</span></div>`;
  }).join("");
  const live = !!(LIVE.frame && LIVE.frame.on && LIVE.frame.ev);
  const head = `<div class="gh">Current lap${curLap != null ? " · lap " + curLap : ""} ${live ? `<span class="lap-liveflag"><i></i>live</span>` : ""}<span class="why">· ${taken.length} turn${taken.length === 1 ? "" : "s"} so far · rated on minimum speed against ${scopeTok(ls)} · grip across the corner's phases</span></div>`;
  if (!taken.length) return `<div class="lapview">${head}${abandoned}<div class="why" style="padding:10px 6px">No turns yet this lap — the first one appears the instant you finish it.</div></div>`;
  let lastSeq = null, worstRow = null, gripHits = 0, rankable = 0, first = 0, thinFirst = 0, unranked = 0;
  const passes = [];
  taken.forEach((c) => {
    const b = turnAtMatrix(c.apex, lastSeq), t = b && b.t; if (!t) return; lastSeq = t.seq;
    // THE RATED NUMBER IS THE SHOWN NUMBER (handoff §1): the pass is rated on its MINIMUM speed, the same
    // quantity every past lap contributes below. It used to show and rate the peak-lateral-g speed, which sits
    // above the minimum on 55 of 60 corners (+9.2 mph) -- so the live pass "won" by construction.
    const apex = c.mph_min != null ? c.mph_min : c.mph_apex;
    // apex speed per PAST lap for this turn = the slowest point across WHATEVER phases that lap recorded here,
    // not only the 'mid' phase. A fast turn is often detected with no mid phase, so reading mid alone showed
    // "first pass here" while its neighbours had 18-19 (Jett 2026-09-11). Take each lap's min across its phases.
    const histByLap = {};
    SEG_ORDER.forEach((seg) => ((t.phaseObs && t.phaseObs[seg]) || []).forEach((r) => {
      if (!ls.set.has(String(r[0])) || r[2] == null) return;
      if (histByLap[r[0]] == null || r[2] < histByLap[r[0]]) histByLap[r[0]] = r[2];
    }));
    const v = rankVerdict(Object.values(histByLap), apex, ls);
    if (v.kind === "best" || v.kind === "ranked") { rankable++; if (v.isBest) { if (v.thin) thinFirst++; else first++; } } else unranked++;
    const tone = v.isBest && !v.thin ? "var(--acc)" : v.d != null && v.d <= -4 ? "var(--bad)" : "var(--mut)";
    const gr = phaseGrip(c);   // grip rated per phase, separate from the speed rank above
    if (gr.lost) gripHits++;
    if (v.d != null && v.d < 0 && (!worstRow || v.d < worstRow.d)) worstRow = { t, d: v.d };
    const peak = c.mph_apex != null && c.mph_min != null ? ` title="minimum ${Math.round(c.mph_min)} mph (rated) · at peak lateral g ${Math.round(c.mph_apex)} mph"` : "";
    passes.push({ c, t, apex, v, tone, gr, peak, hist: histByLap });
  });
  LAP_N = passes.length;
  const win = lapWinPick(passes);
  // THE RANK TABLE (handoff §5.2): every turn taken this lap, 4 rows visible and scrolling, sortable by the
  // turn, by rank within its pool, or by the gap to the pool's best; a row picks that turn for the window.
  const rk = (q) => (q.v.kind === "best" || q.v.kind === "ranked") ? (q.v.rank - 1) / Math.max(1, q.v.of - 1) : 2;
  const sorted = passes.slice();
  if (LAP_SORT === "rank") sorted.sort((a, b) => rk(a) - rk(b));
  else if (LAP_SORT === "delta") sorted.sort((a, b) => (a.v.d == null ? 1e9 : a.v.d) - (b.v.d == null ? 1e9 : b.v.d));
  const rows = sorted.map((q) => `<div class="lap-row${q === win ? " on" : ""}" data-lapwin="${q.t.seq}" title="show ${esc(turnLabel(q.t))} in the window">
      <span class="lap-turn">${esc(turnLabel(q.t))}<em>${esc(cap1(q.t.kind || ""))}</em></span>
      <span class="lap-spd mono"${q.peak}>${Math.round(q.c.mph_in)}<i>→</i><b>${Math.round(q.apex)}</b><i>→</i>${Math.round(q.c.mph_out)}<em> mph</em></span>
      <span class="lap-rank mono lap-v-${q.v.kind}${q.v.thin ? " thin" : ""}" style="color:${q.tone}"><b>${q.v.text}${q.v.d != null && !q.v.isBest ? ` · ${mphD(q.v.d)}` : ""}</b><em>${esc(q.v.basis)}</em></span>
      ${q.gr.cell}</div>`).join("");
  const sortH = (k, lbl) => `<button class="${LAP_SORT === k ? "on" : ""}" data-lapsort="${k}" title="sort by ${lbl}">${lbl}${LAP_SORT === k ? " ▾" : " ⇅"}</button>`;
  // the summary counts only turns that COULD be ranked: an only-lap or level pool is excluded, never a win
  const firstTxt = rankable ? `<b style="color:${first ? "var(--acc)" : "var(--ink)"}">${first + thinFirst} of ${rankable}</b> rankable turn${rankable === 1 ? "" : "s"} come first${thinFirst ? ` <span class="why">(${thinFirst === first + thinFirst ? "all" : thinFirst} on a pool under 5 laps — a weak claim)</span>` : ""}`
    : `nothing can be ranked in ${scopeTok(ls)} — ${unranked} turn${unranked === 1 ? "" : "s"} with no other lap, a lap compared with itself`;
  const sum = `<div class="lap-sum">${firstTxt}${worstRow ? ` · most to find: <b style="color:var(--warn)">${esc(turnLabel(worstRow.t))}</b> ${mphD(worstRow.d)} against the pool's best` : ""}<span class="why">${unranked && rankable ? unranked + " unranked · " : ""}${gripHits} of ${taken.length} turns lost grip</span></div>`;
  return `<div class="lapview">${head}${abandoned}${win ? lapWindowHTML(win, passes, ls) : ""}`
    + `<div class="lap-hd">${sortH("drive", "turn")}<span>in→min→out</span>${sortH("rank", "rank of pool")}${sortH("delta", "against the pool's best")}</div>`
    + `<div class="lap-rows">${rows}</div>${sum}</div>`;
}
// THE TURN WINDOW (course mode v2 step 3, handoff §5.1). The Current lap tab is majority graphical: one turn at a
// time, redrawn on every turn taken -- the corner as a 5-phase ribbon with the shown lap's line painted by grip,
// the speed through that span against every lap in scope, and two ladders (speed, grip) whose ranks carry their
// pool and scope. It follows the turn just taken; a nav button or a table row picks another, and the pick holds
// until the next turn is taken.
let LAP_WIN = null, LAP_N = 0;
let LAP_SORT = (() => { try { return localStorage.getItem("fh6LapSort") || "drive"; } catch (e) { return "drive"; } })();
function lapWinPick(passes) {
  if (!passes.length) return null;
  if (LAP_WIN && COURSE && LAP_WIN.key === COURSE.key && LAP_WIN.n === passes.length) {
    const p = passes.find((x) => x.t.seq === LAP_WIN.seq); if (p) return p;
  }
  LAP_WIN = null;
  return passes[passes.length - 1];
}
// the lap the window draws: the live lap (or the held last run) on this course, else the trace's foregrounded lap
function lapShown() {
  const L = COURSE && liveLapFor(COURSE);
  // LIVE.lap's own shape moved into the recorded one ([arc, mph, grip, x, z, elev, thr, brk]) so one reader serves both
  if (L) return { pts: L.pts.map((q) => [q[0], q[1], q[2], q[3], q[4], null, q[8] ?? null, q[9] ?? null]), label: LIVE.lap && LIVE.lap.live ? "live lap" : "last run" };
  const id = TRACE_PICK && COURSE && TRACE_PICK.key === COURSE.key ? TRACE_PICK.fore : null, tr = id && COURSE.traces[id];
  return tr ? { pts: tr, label: "foregrounded lap" } : null;
}
// a lap's stretch through a turn: nearest point (within 40 m) to the braking start, then to the exit end after it
function turnSlice(pts, a, b) {
  if (!pts || pts.length < 3) return null;
  const near = (x, z, from) => { let bi = -1, bd = 1600; for (let i = from; i < pts.length; i++) { const q = pts[i]; if (q[3] == null) continue; const d = (q[3] - x) ** 2 + (q[4] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const i0 = near(a[0], a[1], 0); if (i0 < 0) return null;
  const i1 = near(b[0], b[1], i0 + 1); if (i1 < 0 || i1 - i0 < 2) return null;
  const sl = pts.slice(i0, i1 + 1), s0 = sl[0][0], L = (sl[sl.length - 1][0] - s0) || 1;
  return sl.map((q) => [(q[0] - s0) / L, q[1], q[2] | 0, q[3], q[4], null, q[6] ?? null, q[7] ?? null]);   // [fraction through the turn, mph, grip, x, z, -, thr, brk]
}
function lapWindowHTML(p, passes, ls) {
  const t = p.t, i = passes.indexOf(p), prev = passes[i - 1], next = passes[i + 1];
  const nTurns = (COURSE.turns || []).length, dirW = t.dir === "L" ? "left" : t.dir === "R" ? "right" : "";
  const nav = (q, side) => q
    ? `<button class="lw-nav ${side}" data-lapwin="${q.t.seq}" title="${side === "prev" ? "the turn before" : "the turn after"} this one on this lap"><em>${side === "prev" ? "last" : "next"}</em><b>${side === "prev" ? "‹ " : ""}${esc(turnLabel(q.t))}${side === "next" ? " ›" : ""}</b></button>`
    : `<span class="lw-nav ${side} off"><em>${side === "prev" ? "last" : "next"}</em><b>${side === "prev" ? "—" : "not yet"}</b></span>`;
  const follow = !LAP_WIN;
  const top = `<div class="lw-top">${nav(prev, "prev")}<div class="lw-title"><b>${esc(turnLabel(t))}</b>`
    + `<span>turn ${t.seq} of ${nTurns}${t.kind ? " · " + esc(t.kind) + (dirW ? " " + dirW : "") : ""}</span>`
    + `<i class="${follow ? "lw-pulse" : "lw-pin"}">${follow ? "the turn just taken · redraws at the next" : "picked · follows again at the next turn"}</i></div>${nav(next, "next")}</div>`;
  const segs = t.seg || {}, phases = SEG_ORDER.filter((n) => segs[n] && segs[n].length >= 2);
  const shown = lapShown(), base = piColor(CUR && CUR.cls);
  // the shown lap's line follows the one paint choice: pedals when picked, else what the tyres did
  const pedals = TRACE_MODE === "pedals", runKey = (q) => (pedals ? pedalKey(q[6], q[7]) : q[2] | 0), runInk = (k) => (pedals ? pedalCol(k) : gripInk(k, base));
  const gripRuns = (pts, draw) => { if (pts.length < 2) return ""; let out = "", seg = [pts[0]], k = runKey(pts[0]);
    const flush = () => { if (seg.length > 1) out += draw(seg, k); };
    for (let j = 1; j < pts.length; j++) { const kk = runKey(pts[j]); seg.push(pts[j]); if (kk !== k) { flush(); seg = [pts[j]]; k = kk; } }
    flush(); return out; };
  let map = `<div class="why lw-empty">no phase geometry for ${esc(turnLabel(t))} yet</div>`, rib = "";
  if (phases.length) {
    // ---- the corner: casing, 5 butt-cut phase bands with a divider per cut, the shown lap's line by grip
    const [x0, x1, z0, z1] = turnFrame(COURSE, t);   // the whole turn, approach to exit (shared with Turn analysis)
    const dx = (x1 - x0) || 40, dz = (z1 - z0) || 40;
    const W = 560, H = 190, pad = 14, s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (z1 - z0));
    const ox = (W - (x1 - x0) * s) / 2, oy = (H - (z1 - z0) * s) / 2;
    const X = (x) => ox + (x - x0) * s, Y = (z) => H - oy - (z - z0) * s, P = (x, z) => X(x).toFixed(1) + "," + Y(z).toFixed(1);
    const NS = ' vector-effect="non-scaling-stroke"';
    const inBox = (x, z) => x > x0 - dx * 0.4 && x < x1 + dx * 0.4 && z > z0 - dz * 0.4 && z < z1 + dz * 0.4;
    const boxRuns = (pts, xz) => { const out = []; let run = []; pts.forEach((q) => { const g = xz(q); if (g && inBox(g[0], g[1])) run.push(q); else { if (run.length > 1) out.push(run); run = []; } }); if (run.length > 1) out.push(run); return out; };
    const road = boxRuns((COURSE.route && COURSE.route.path) || COURSE.path || [], (q) => q)
      .map((r) => `<polyline fill="none" stroke="#3a4453" stroke-width="2" opacity=".5"${NS} points="${r.map(([x, z]) => P(x, z)).join(" ")}"/>`).join("");
    const whole = [].concat(...phases.map((n) => segs[n]));
    const casing = `<polyline fill="none" stroke="#05080c" stroke-width="26" stroke-linejoin="round"${NS} points="${whole.map(([x, z]) => P(x, z)).join(" ")}"/>`;
    const bands = phases.map((n) => `<polyline data-phase="${n}" fill="none" stroke="${SEG_COL[n]}" stroke-width="20" stroke-linejoin="round" opacity=".38"${NS} points="${segs[n].map(([x, z]) => P(x, z)).join(" ")}"><title>${esc(SEG_LABEL[n])}</title></polyline>`).join("");
    const cuts = phases.slice(1).map((n) => { const a = segs[n][0], b = segs[n][1];
      const ux = X(b[0]) - X(a[0]), uy = Y(b[1]) - Y(a[1]), L = Math.hypot(ux, uy) || 1, nx = -uy / L * 13, ny = ux / L * 13, cx = X(a[0]), cy = Y(a[1]);
      return `<line x1="${(cx + nx).toFixed(1)}" y1="${(cy + ny).toFixed(1)}" x2="${(cx - nx).toFixed(1)}" y2="${(cy - ny).toFixed(1)}" stroke="#0d1117" stroke-width="2"/>`; }).join("");
    const drive = shown ? boxRuns(shown.pts, (q) => (q[3] != null ? [q[3], q[4]] : null)).map((r) => gripRuns(r, (sg, k) =>
      `<polyline fill="none" stroke="${runInk(k)}" stroke-width="${k ? 4 : 3.4}" stroke-linecap="round" stroke-linejoin="round"${NS} points="${sg.map((q) => P(q[3], q[4])).join(" ")}"/>`)).join("") : "";
    const apex = t.x != null ? `<circle cx="${X(t.x).toFixed(1)}" cy="${Y(t.z).toFixed(1)}" r="4" fill="#fff" stroke="#05080c" stroke-width="1.5"/><text x="${(X(t.x) + 8).toFixed(1)}" y="${(Y(t.z) + 4).toFixed(1)}" font-size="13" font-weight="700" paint-order="stroke" stroke="#05080c" stroke-width="3" stroke-linejoin="round" fill="#fff">${esc(turnLabel(t))}</text>` : "";
    map = `<div class="lw-map"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${road}${casing}${bands}${cuts}${drive}${apex}</svg>`
      + `<div class="lw-cap">${shown ? "showing the " + esc(shown.label) : "no lap line to show"}<span>thick line = ${pedals ? "throttle / brake" : "what the tyres did"} · pale band = which part of the corner</span></div></div>`;
    // ---- the speed through the same span: phase bands behind, every lap in scope faint, the shown lap by grip
    const lastSeg = segs[phases[phases.length - 1]], a = segs[phases[0]][0], b = lastSeg[lastSeg.length - 1];
    const pool = Object.keys(COURSE.traces || {}).filter((id) => ls.set.has(String(id))).map((id) => turnSlice(COURSE.traces[id], a, b)).filter(Boolean);
    const mineS = shown ? turnSlice(shown.pts, a, b) : null, ref = mineS || pool[0];
    const vals = [].concat(...pool.map((r) => r.map((q) => q[1])), mineS ? mineS.map((q) => q[1]) : []).filter((v) => v != null);
    if (ref && vals.length) {
      const RW = 560, RH = 86, rt = 13, rb = 4, lo = Math.min(...vals), hi = Math.max(...vals), sp = (hi - lo) || 1;
      const rx = (f) => 26 + f * (RW - 60), ry = (v) => rt + (1 - (v - lo) / sp) * (RH - rt - rb);
      const starts = phases.map((n) => { let bi = 0, bd = Infinity; ref.forEach((q, j) => { const d = (q[3] - segs[n][0][0]) ** 2 + (q[4] - segs[n][0][1]) ** 2; if (d < bd) { bd = d; bi = j; } }); return ref[bi][0]; });
      const bandsR = phases.map((n, j) => { const f0 = j ? starts[j] : 0, f1 = j < phases.length - 1 ? starts[j + 1] : 1;
        return `<rect x="${rx(f0).toFixed(1)}" y="${rt}" width="${Math.max(0, rx(f1) - rx(f0)).toFixed(1)}" height="${RH - rt - rb}" fill="${SEG_COL[n]}" opacity=".13"/>`
          + `<text x="${((rx(f0) + rx(f1)) / 2).toFixed(1)}" y="10" text-anchor="middle" font-size="8.5" fill="${SEG_COL[n]}">${esc(String(SEG_LABEL[n] || n).split(/[ /]/)[0].toLowerCase())}</text>`; }).join("");
      const pl = (r) => r.map((q) => rx(q[0]).toFixed(1) + "," + ry(q[1]).toFixed(1)).join(" ");
      const poolSvg = pool.map((r) => `<polyline fill="none" stroke="#4a5563" stroke-width="1" opacity=".55" points="${pl(r)}"/>`).join("");
      let mineSvg = "", reads = "";
      if (mineS) {
        mineSvg = gripRuns(mineS, (sg, k) => `<polyline fill="none" stroke="${runInk(k)}" stroke-width="${k ? 3 : 2.6}" stroke-linecap="round" points="${pl(sg)}"/>`);
        const mn = mineS.reduce((m, q) => (q[1] < m[1] ? q : m), mineS[0]), e0 = mineS[0], e1 = mineS[mineS.length - 1];
        const cy = (y) => Math.max(10, Math.min(RH - 2, y));
        const lab = (q, txt, anchor, dy) => `<text x="${Math.max(2, Math.min(RW - 2, rx(q[0]))).toFixed(1)}" y="${cy(ry(q[1]) + dy).toFixed(1)}" text-anchor="${anchor}" font-size="10" font-weight="700" fill="#dfe7ef" paint-order="stroke" stroke="#0d1117" stroke-width="3" stroke-linejoin="round">${txt}</text>`;
        reads = lab(e0, Math.round(e0[1]), "start", -5) + lab(mn, Math.round(mn[1]) + " min", "middle", 13) + lab(e1, Math.round(e1[1]), "end", -5);
      }
      const axis = `<text x="2" y="${(ry(hi) + 4).toFixed(1)}" font-size="8" fill="#576372">${Math.round(hi)}</text><text x="2" y="${(ry(lo)).toFixed(1)}" font-size="8" fill="#576372">${Math.round(lo)}</text>`;
      rib = `<div class="lw-rib"><div class="why">the speed through ${esc(turnLabel(t))} · mph · ${pool.length} lap${pool.length === 1 ? "" : "s"} in ${scopeTok(ls)} faint${mineS ? " · the " + esc(shown.label) + " painted by " + (pedals ? "pedals" : "grip") : ""}</div>`
        + `<svg viewBox="0 0 ${RW} ${RH}" preserveAspectRatio="xMidYMid meet">${bandsR}${axis}${poolSvg}${mineSvg}${reads}</svg></div>`;
    }
  }
  // ---- two ladders: every lap in scope as a dot, this pass as the square, its rank with pool and scope beside it
  const lapsGrip = {};
  SEG_ORDER.forEach((n) => ((t.phaseObs || {})[n] || []).forEach((r) => { if (!ls.set.has(String(r[0])) || r[4] == null) return;
    const g = lapsGrip[r[0]] = lapsGrip[r[0]] || [0, 0]; g[1]++; if ((r[4] | 0) === 0) g[0]++; }));
  const ph = Array.isArray(p.c.phases) ? p.c.phases : [], offGrip = { front: 1, rear: 1, both: 1, impact: 1 };
  const calmN = ph.filter((q) => !offGrip[q.red]).length, grMine = ph.length ? calmN / ph.length : null;
  const gv = rankVerdict(Object.values(lapsGrip).map(([k, n]) => k / n), grMine, ls, 0.01);
  const board = (name, metric, vals, mine, v, fmt, loW, hiW, mineTxt) => {
    const all = vals.concat(mine != null ? [mine] : []), lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1, sp = (hi - lo) || 1;
    const at = (x) => (((x - lo) / sp) * 100).toFixed(1);
    const tone = v.isBest && !v.thin ? "var(--acc)" : v.kind === "ranked" || v.isBest ? "var(--ink)" : "var(--mut)";
    return `<div class="lw-board"><div class="lw-bh"><b>${name}</b><em>${metric}</em></div>`
      + `<div class="lw-lad"><div class="lw-track">${vals.map((x) => `<i style="left:${at(x)}%"></i>`).join("")}${mine != null ? `<b style="left:${at(mine)}%;background:${v.isBest && !v.thin ? "var(--acc)" : "var(--acc2)"}" title="this pass · ${esc(mineTxt)}"></b>` : ""}</div>`
      + `<div class="lw-ends"><span>${esc(fmt(lo))} · ${loW}</span><span>${hiW} · ${esc(fmt(hi))}</span></div></div>`
      + `<div class="lw-bv"><b style="color:${tone}">${v.text}</b><em>${esc(mineTxt)} · ${esc(v.basis)}</em></div></div>`;
  };
  const boards = `<div class="lw-boards">`
    + board("SPEED", "minimum through the turn, mph", Object.values(p.hist), p.apex, p.v, (x) => Math.round(x), "slowest", "fastest", Math.round(p.apex) + " mph")
    + board("GRIP", "share of phases within grip", Object.values(lapsGrip).map(([k, n]) => k / n), grMine, gv, (x) => Math.round(x * 100) + "%", "least", "most",
        ph.length ? `${calmN} of ${ph.length} phases within grip` : "no phase data")
    + `</div>`;
  return `<div class="lapwin">${top}${map}${rib}${boards}</div>`;
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
      turn = `<span class="why tturn" title="${esc(turnLabel(t))} · ${esc(t.kind || "")} · ${t.r != null ? Math.round(t.r) + " m radius" : ""} · ${t.n != null ? t.n + " passes on record" : ""}"><b>${esc(turnLabel(t))}</b> ${esc(t.kind || "")}${t.r != null ? " · " + Math.round(t.r) + " m" : ""}${t.n != null ? " · " + t.n + " on record" : ""}${mine.length > 1 ? ` · your ${mine.length} passes: best ${best} — this ${here}` : ""}</span>`;
    }
    return `<div class="crow"><span class="mono">${log.length - i}</span><span>${c.lapn != null ? "lap " + c.lapn : c.ev ? "" : "free"}</span>
      <b>${c.dir === "L" ? "⬅" : "➡"} ${kind}</b>${turn || "<span></span>"}
      <span class="mono">${c.mph_in}→<b>${c.mph_min}</b>→${c.mph_out ?? "—"}</span>
      <span class="mono">${c.lat_g_peak} g</span>
      <span class="mono">${c.brake_on_m != null ? c.brake_on_m + " m" : "—"}</span>
      <span style="color:${g.ink}" title="${esc(g.tip)}">${g.word}</span>
      <span class="why">${fr ? `${fr.axle} first · ph ${fr.phase}` : "clean"}${c.hb ? " · handbrake" : ""}${c.drift ? " · drift" : ""}${c.brake_max > 200 ? " · hard brake" : ""}</span></div>`;
  }).join("");
  // SESSION BALANCE (2026-09-03, Jett: a short corner log left the whole pane a slab of empty black
  // below it -- the map beside it fills the same height naturally, the corner list can't once the
  // count runs out. Real content, not padding: the same per-corner verdict every row already shows,
  // tallied. Grows into the space a short session leaves instead of leaving it bare.
  const tally = { calm: 0, front: 0, rear: 0 };
  log.forEach((c) => tally[dGripUsi(c.usi)]++);
  const order = ["calm", "front", "rear"].filter((k) => tally[k]);
  const balance = log.length ? `<div class="grp"><div class="gh">Session balance — ${log.length} corner${log.length === 1 ? "" : "s"}</div>
    <div class="balbar">${order.map((k) => `<span style="flex:${tally[k]} 0 0;background:${DGRIP[k].col}" title="${DGRIP[k].word}: ${tally[k]}"></span>`).join("")}</div>
    <div class="ballegend">${order.map((k) => `<span><i style="background:${DGRIP[k].col}"></i>${DGRIP[k].word} · ${tally[k]} (${Math.round(tally[k] / log.length * 100)}%)</span>`).join("")}</div>
  </div>` : "";
  return head + `<div class="crow hd"><span>#</span><span>lap</span><b>kind</b><span>turn</span><span>in→apex→out</span><span>lat g</span><span>brake</span><span>balance</span><span>first red</span></div>` + rows + balance;
}

// One row per course turn, this session — cornersHTML()'s log pivoted by turn instead of time.
// Turn identity is resolved geometrically, fresh, every render, against whatever COURSE currently
// holds — never by the turn_id string. course_turn ids are positionally renumbered by the analyzer
// on every rebuild (confirmed: a two-day diff of the same route showed 100% id churn, including an
// id landing on a different physical corner), so a persisted/cached turn_id join would silently
// merge or split one corner's history under a relabeled id. This view intentionally never touches
// corner_obs/DIAG.by_turn (a different, ref_route_turn-keyed namespace) for the same reason — it is
// session-scoped from LIVE.corners only. A future "historical best per turn" pass must join those
// spatially (nearest apex, like turnAt() below), never by turn_id equality.
//
// turnAt()'s plain nearest-XZ match (above) has no tie-break: real course data has turn pairs as
// close as 2.8 m against its 40 m radius (~19% of consecutive turn pairs under 80 m apart), so a
// noisy apex position can silently bind to the wrong neighbor. This adds a runner-up check and
// breaks a close tie by route continuity (the turn after wherever this session's matrix last
// bound), falling back to a visible ambiguity flag rather than a silent guess.
function turnAtMatrix(apex, lastSeq) {
  if (!apex || apex[0] == null || !COURSE || !(COURSE.turns || []).length) return { t: null, ambiguous: false };
  let best = null, bd = 40 * 40, second = null, sd = 40 * 40;
  for (const t of COURSE.turns) {
    if (t.x == null) continue;
    const d = (t.x - apex[0]) ** 2 + (t.z - apex[1]) ** 2;
    if (d < bd) { second = best; sd = bd; best = t; bd = d; }
    else if (d < sd) { second = t; sd = d; }
  }
  if (!best) return { t: null, ambiguous: false };
  const close = second && sd < bd * 2.25;   // runner-up within 1.5x the winner's distance (bd/sd are squared)
  if (!close) return { t: best, ambiguous: false };
  if (lastSeq != null) {
    const wantSeq = (lastSeq + 1) % COURSE.turns.length;
    if (best.seq === wantSeq) return { t: best, ambiguous: false };
    if (second.seq === wantSeq) return { t: second, ambiguous: false };
  }
  return { t: best, ambiguous: true };      // no session context to disambiguate — nearest as a best guess, flagged
}

// the daemon's live corner detector always emits exactly 4 phases (a fixed tuple); the offline
// analyzer's 5th "Straight/crest" phase never appears on the live SSE stream this reads from.
const PH_SHORT = ["Braking", "Entry", "Mid-corner", "Exit"];
function phaseBars(ph) {
  return `<span style="display:inline-flex;gap:2px">${(ph || []).map((p) => {
    // a fully-zeroed phase (front:0,rear:0,red:"none",dur:0 — mostly phase 1, ~0.2% of real phase-slots
    // when the corner opened right after the per-second sample buffer reset) renders as an empty bar,
    // correctly — it is a real zero-slip reading, not a missing one, so it is never skipped.
    const fr = Math.min(1, (p.front || 0) / 1.5), rr = Math.min(1, (p.rear || 0) / 1.5);
    const col = (DGRIP[p.red] && p.red !== "off" ? DGRIP[p.red] : DGRIP.calm).col;
    return `<span title="phase ${p.phase} (${PH_SHORT[p.phase - 1] || ""}): front ${p.front} · rear ${p.rear}"
      style="display:inline-block;width:14px;height:14px;border-radius:2px;border:1px solid ${col};position:relative;background:var(--bg)">
      <i style="position:absolute;left:0;bottom:0;width:50%;height:${Math.round(fr * 100)}%;background:${DGRIP.front.col};opacity:${p.front > 1 ? 1 : .4}"></i>
      <i style="position:absolute;right:0;bottom:0;width:50%;height:${Math.round(rr * 100)}%;background:${DGRIP.rear.col};opacity:${p.rear > 1 ? 1 : .4}"></i></span>`;
  }).join("")}</span>`;
}

// PER-PHASE CORNER STRIP (Jett 2026-09-10): for each course turn, its 5 WHERE-phases as cells coloured
// by the modal grip state, accumulated over the course's clean laps (COURSE.turns[].phases from build_web).
// Always available in course mode -- it does not wait on this session's live corners.
// aggregate the per-lap phase rows [[lap_id, entry, min, exit, grip]...] over the ACTIVE lap set (the
// trace preset's selection), so the strip separates by class / build / tune exactly as the map traces do.
// row = [lap_id, entry, min, exit, grip_state, time_s, grip_hist[5], mean]. The grip a phase reports is
// its TYPICAL state, NOT the single worst moment (the old max() painted every hard phase "drift"). `mix`
// is the 5-state fraction, averaged EQUAL-WEIGHT PER LAP (each lap's own grip_hist normalised to 1, then
// meaned over the preset) so one long or messy lap cannot dominate the mix; `grip` is its argmax; `time`
// the median seconds in the phase. Falls back to the per-lap modal grip_state for pre-histogram exports.
function phaseAgg(rows, lapSet) {
  if (!rows || !rows.length) return null;
  const f = lapSet ? rows.filter((r) => lapSet.has(String(r[0]))) : rows;
  if (!f.length) return null;
  const med = (i) => { const v = f.map((r) => r[i]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? Math.round(v[v.length >> 1] * 10) / 10 : null; };
  const acc = [0, 0, 0, 0, 0]; let nHist = 0;
  f.forEach((r) => {
    const h = r[6]; if (!Array.isArray(h)) return;
    const s = h.reduce((a, b) => a + (b || 0), 0); if (!s) return;
    for (let i = 0; i < 5; i++) acc[i] += (h[i] || 0) / s;              // this lap's own fraction, weight 1
    nHist++;
  });
  let grip, mix = null;
  if (nHist) { mix = acc.map((v) => v / nHist); grip = mix.indexOf(Math.max(...mix)); }
  else {                                                                // old export: modal of per-lap grip_state
    const gc = {}; f.forEach((r) => { if (r[4] != null) gc[r[4]] = (gc[r[4]] || 0) + 1; });
    grip = Object.keys(gc).length ? +Object.keys(gc).sort((a, b) => gc[b] - gc[a])[0] : 0;
  }
  return { n: new Set(f.map((r) => r[0])).size, entry: med(1), min: med(2), exit: med(3), mean: med(7),
           time: med(5), grip, mix, mixLaps: nHist };
}
function phaseCells(obs, lapSet) {
  return ["braking", "turn_in", "mid", "exit", "straight"].map((name) => {
    const p = obs[name] && phaseAgg(obs[name], lapSet);
    if (!p) return `<span class="pcell pc-empty"></span>`;
    const g = DGRIP[GSTATE[p.grip] || "calm"];
    const lbl = name === "mid" ? `<b>${p.min ?? ""}</b>` : "";
    return `<span class="pcell" style="background:${g.col}" title="${esc((SEG_LABEL[name] || name).toLowerCase())} · ${p.n} lap${p.n === 1 ? "" : "s"} · entry ${p.entry ?? "—"} → min ${p.min ?? "—"} → exit ${p.exit ?? "—"} mph · ${g.word}">${lbl}</span>`;
  }).join("");
}
// the lap set the trace preset (all / this class / this car / this build / same hardware / this tune)
// is showing -- so the corner strip and turn stats separate by class / build / tune with the SAME
// filter as the map traces. Aggregation uses the FULL lap list, not the drawn traces (capped at 400).
// RACING-ONLY (default) also gates it, matching the speed trace: cruise/drift/rewound laps drop out of
// the corner medians too. Falls back to the ungated preset set if racing would blank it.
function activeLapSet() {
  // THE lap set every course-mode pane is scoped to. Applies the SAME filters as the speed trace --
  // the show-preset AND the class/drive/tune/traffic/build dimensions -- so a class or build picked
  // in the filter bar re-scopes the turn analysis and general statistics, not only the trace.
  const sel = traceSel(COURSE), tf = sel.filters || {};
  let ids = (COURSE.laps || []).filter(presetTest(sel.preset))
    .filter((l) => TRACE_DIMS.every(([d]) => !tf[d] || dimVal(l, d) === String(tf[d])))
    .map((l) => String(l.id));
  let label = (PRESETS.find((p) => p[0] === sel.preset) || ["", "all laps"])[1];
  const dims = TRACE_DIMS.filter(([d]) => tf[d]).map(([d]) => dimLab(d, tf[d]));
  if (dims.length) label += " · " + dims.join(" · ");
  if (RACING_ONLY) {
    const race = racingIds(COURSE.laps || []);
    const gated = ids.filter((id) => race.has(id));
    if (gated.length) { ids = gated; label += " · racing"; }
  }
  // THE SCOPE TOKEN (handoff §2): what every scoped count is measured against, small enough to ride beside it --
  // class · laps in scope (A·7), or the preset's name when no class narrows it (ALL·45, CAR·12). The full
  // label stays on the token's tooltip.
  const cls = tf.class || (sel.preset === "class" ? liveClass() : null) || null;
  const token = (cls || SCOPE_PRE[sel.preset] || "ALL") + "·" + ids.length;
  return { set: new Set(ids), label, token, cls, n: ids.length, total: (COURSE.laps || []).length };
}
const SCOPE_PRE = { all: "ALL", class: "CLASS", car: "CAR", build: "BUILD", hw: "HW", tune: "TUNE" };
const mphD = (d) => (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d) + " mph";   // a signed speed gap, typographic minus
const scopeTok = (ls) => `<span class="scopetok mono" title="${esc(ls.label)} · ${ls.n} of ${ls.total} laps on the course">${esc(ls.token)}</span>`;
// A VERDICT CARRIES ITS BASIS (handoff §1 rule 1): rank · denominator · scope · confidence, never a bare "best yet".
// pool = one value per lap in scope (higher is better; every lap in scope, Jett 2026-09-11 Q3), mine = the pass
// being rated, which is not in the pool, so it ranks among pool + itself. Degenerate pools are not wins:
//   no pool          -> "only lap" (a lap compared with itself), no star, no delta
//   every value level (within 0.5) -> "level · n", no star
//   fewer than 5 in all -> a thin claim: a hollow ☆ when first, never the gold ★
function rankVerdict(pool, mine, ls, eps) {   // eps: the gap that still counts as level (0.5 mph by default)
  const vals = (pool || []).filter((v) => v != null && isFinite(v)), tok = ls ? ls.token : "";
  const n = vals.length, of = n + 1, laps = `${n} lap${n === 1 ? "" : "s"} in ${tok}`;
  if (mine == null || !isFinite(mine)) return { kind: "nolap", text: "no lap", basis: n ? laps : `none in ${tok}`, star: "", d: null };
  if (!n) return { kind: "only", rank: 1, of: 1, text: "only lap", basis: `none in ${tok} to compare with`, star: "", d: null };
  const best = Math.max(...vals), all = vals.concat([mine]);
  if (Math.max(...all) - Math.min(...all) < (eps != null ? eps : 0.5)) return { kind: "level", rank: null, of, text: `level · ${of}`, basis: `${laps} · all level`, star: "", best, d: null };
  const rank = vals.filter((v) => v > mine).length + 1, isBest = rank === 1, thin = of < 5;
  // one decimal under 1 mph, so a pass 0.3 mph short of the best never reads "2 of 34 · 0 mph"
  const dd = mine - best, d = Math.abs(dd) < 1 ? Math.round(dd * 10) / 10 : Math.round(dd);
  return { kind: isBest ? "best" : "ranked", rank, of, isBest, thin, best, d,
           star: isBest ? (thin ? "☆" : "★") : "", text: `${isBest ? (thin ? "☆ " : "★ ") : ""}${rank} of ${of}`,
           basis: laps + (thin ? " · thin" : "") };
}
function cornerStripHTML(ls, sel) {
  const turns = (COURSE.turns || []).filter((t) => t.phaseObs).slice().sort((a, b) => a.seq - b.seq);
  if (!turns.length) return "";
  const withData = new Set();
  turns.forEach((t) => Object.values(t.phaseObs).forEach((rows) => rows.forEach((r) => { if (ls.set.has(String(r[0]))) withData.add(r[0]); })));
  const nLaps = withData.size;
  return `<div class="grp"><div class="gh">Corner phases <span class="why">· ${esc(ls.label)} · ${nLaps} lap${nLaps === 1 ? "" : "s"} · click a turn for its phases &amp; stats</span></div>
    <div class="pstrip pstrip-h"><span class="ptn"></span><span class="pcells"><span>brake</span><span>entry</span><span>mid</span><span>exit</span><span>straight</span></span></div>
    ${turns.map((t) => `<div class="pstrip pstrip--pick${sel === t.seq ? " sel" : ""}" data-turn="${t.seq}"><span class="ptn">${esc(turnLabel(t))}</span><span class="pcells">${phaseCells(t.phaseObs, ls.set)}</span></div>`).join("")}</div>`;
}
// GRIP AS A DISTRIBUTION, never a single lossy swatch (Jett 2026-09-10). mix = [calm,front,rear,both,
// impact] fractions (equal-weight per lap over the preset). This is the honest "how the grip splits" that
// answers "i cant figure out what drift means": a phase reads e.g. 62% within grip / 26% oversteer.
function gripBar(mix, cls) {
  if (!mix) return `<span class="gbar gbar--empty" title="no grip samples"></span>`;
  const seg = GSTATE.map((k, i) => {
    const f = mix[i] || 0; if (f < 0.006) return "";
    return `<span style="flex:${Math.round(f * 1000)} 0 0;background:${DGRIP[k].col}" title="${DGRIP[k].word} · ${Math.round(f * 100)}%"></span>`;
  }).join("");
  return `<span class="gbar ${cls || ""}">${seg}</span>`;
}
function gripRead(mix) {
  if (!mix) return "no grip data";
  const calm = Math.round((mix[0] || 0) * 100);
  let bi = 1, bv = -1; for (let i = 1; i < 5; i++) { if ((mix[i] || 0) > bv) { bv = mix[i] || 0; bi = i; } }
  if ((mix[0] || 0) >= 0.8 || bv < 0.1) return `mostly within grip (${calm}% of samples)`;
  return `${calm}% within grip · ${DGRIP[GSTATE[bi]].word} ${Math.round(bv * 100)}%`;
}
// RIGHT PANE — "the corner, phase by phase": the selected turn's line trace zoomed to fill the width, drawn
// in the WHERE palette (SEG_COL) ONLY -- colour here is structure, never grip -- with the apex ringed, a
// travel chevron, entry/apex/exit speeds pinned, and a phase-time rail whose cell widths ARE the median
// seconds in each part, each cell carrying its representative mph and filled with that part's grip
// distribution. Returns an HTML STRING (a labelled .grp section) so turnStatsHTML can compose it inline; the
// course map stays on the LEFT at all times (Jett 2026-09-11 — the per-turn map belongs beside its stats).
// speed -> colour for the driven-line gradient: slow = red, through amber, to green = fast
function spdColor(v, vmin, vmax) {
  let f = (vmax <= vmin) ? 1 : (v - vmin) / (vmax - vmin); f = Math.max(0, Math.min(1, f));
  const lp = (a, b, k) => Math.round(a + (b - a) * k);
  const s = f < 0.5 ? [[240, 97, 109], [227, 179, 65], f / 0.5] : [[227, 179, 65], [0, 210, 122], (f - 0.5) / 0.5];
  return `rgb(${lp(s[0][0], s[1][0], s[2])},${lp(s[0][1], s[1][1], s[2])},${lp(s[0][2], s[1][2], s[2])})`;
}
// leaderboard POSITION -> a single solid colour for a lap's whole trace: rank 0 (fastest) = green, through
// amber, to the slowest = red — the same green→amber→red the course map's lap-time gradient uses, so "quick"
// reads the same on both maps. i is the 0-based leaderboard index; n the number of ranked passes.
function rankColor(i, n) {
  let f = (n <= 1 || i == null) ? 0 : i / (n - 1); f = Math.max(0, Math.min(1, f));
  const lp = (a, b, k) => Math.round(a + (b - a) * k);
  const s = f < 0.5 ? [[0, 210, 122], [227, 179, 65], f / 0.5] : [[227, 179, 65], [240, 97, 109], (f - 0.5) / 0.5];
  return `rgb(${lp(s[0][0], s[1][0], s[2])},${lp(s[0][1], s[1][1], s[2])},${lp(s[0][2], s[1][2], s[2])})`;
}
// THE WHOLE TURN, NOT JUST ITS PHASE GEOMETRY (Jett 2026-09-11: "why is the corner detail view so zoomed in? you
// can't see the entirety of the turn"). A long, gentle turn's phase polylines cover a few dozen metres, so a frame
// fitted to them cropped the approach and the exit. Frame the ROAD: the centre-line walked from the apex halfway
// back toward the previous turn and halfway on toward the next (each half 60-220 m), plus the phases and the apex,
// padded 8% with an 80 m minimum span. Used by the Turn analysis corner map and the Current lap turn window.
function turnFrame(c, t) {
  const pts = [];
  SEG_ORDER.forEach((n) => ((t.seg || {})[n] || []).forEach((p) => pts.push(p)));
  const path = (c.route && c.route.path) || c.path || [];
  if (t.x != null) {
    pts.push([t.x, t.z]);
    if (path.length > 2) {
      let ai = 0, bd = Infinity;
      path.forEach(([x, z], i) => { const d = (x - t.x) ** 2 + (z - t.z) ** 2; if (d < bd) { bd = d; ai = i; } });
      const ord = (c.turns || []).filter((u) => u.x != null).sort((a, b) => a.seq - b.seq), k = ord.indexOf(t);
      const half = (u) => (u ? Math.max(60, Math.min(220, Math.hypot(u.x - t.x, u.z - t.z) / 2)) : 120);
      const walk = (dir, lim) => { let acc = 0;
        for (let i = ai; i + dir >= 0 && i + dir < path.length && acc < lim; i += dir) {
          acc += Math.hypot(path[i + dir][0] - path[i][0], path[i + dir][1] - path[i][1]); pts.push(path[i + dir]); } };
      walk(-1, half(ord[k - 1])); walk(1, half(ord[k + 1]));
    }
  }
  if (!pts.length) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  pts.forEach(([x, z]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; });
  const gx = Math.max(80 - (x1 - x0), 0) / 2 + (x1 - x0) * 0.08, gz = Math.max(80 - (z1 - z0), 0) / 2 + (z1 - z0) * 0.08;
  return [x0 - gx, x1 + gx, z0 - gz, z1 + gz];
}
function cornerMapHTML(c, t, ls) {
  const segs = t.seg || {};
  const phases = SEG_ORDER.filter((n) => segs[n] && segs[n].length >= 2);
  // NO PROSE CAPTION (Jett 2026-09-11): the old "the corner, phase by phase · strips = which part · lines =
  // every lap in scope" header just narrated the map's own legend below (phases / lines / marks rows) and the
  // title bar above already names the turn — pure real-estate waste. The map speaks through its legend now.
  const [x0, x1, z0, z1] = turnFrame(c, t) || [Infinity, -Infinity, Infinity, -Infinity];
  const ag = (n) => phaseAgg(t.phaseObs && t.phaseObs[n], ls.set);
  const aggs = SEG_ORDER.map((n) => ({ n, p: ag(n) }));
  const maxT = Math.max(0.1, ...aggs.map((a) => (a.p && a.p.time) || 0));
  const rail = aggs.map(({ n, p }) => {
    const w = p && p.time ? Math.max(7, (p.time / maxT) * 100) : 7;
    const inner = p && p.mix ? gripBar(p.mix) : `<span class="gbar gbar--empty"></span>`;
    const mph = p && p.min != null ? `<em class="trail-mph">${Math.round(p.min)} mph</em>` : "";
    return `<div class="trail-c" style="flex:${w} 1 0" data-phase="${n}" title="${esc(SEG_LABEL[n])} · ${p && p.time != null ? p.time + " s · " + gripRead(p.mix) : "no data"}">
      <span class="trail-lbl" style="color:${SEG_COL[n]}">${esc(SEG_LABEL[n].split(/[ /]/)[0].toLowerCase())}</span>
      <span class="trail-t"><b>${p && p.time != null ? p.time.toFixed(1) + "s" : "—"}</b>${mph}</span>${inner}</div>`;
  }).join("");
  const trailBox = `<div class="trail" title="each part's width = median seconds spent in it · fill = its grip mix">${rail}</div>`;
  if (!isFinite(x0)) return `<div class="grp tstat-corner"><div class="why" style="padding:10px 6px">no phase geometry for this turn yet</div>${trailBox}</div>`;
  const pad = 16, H = 260, AR = ((x1 - x0) || 1) / ((z1 - z0) || 1);
  const W = Math.max(300, Math.round((H - 2 * pad) * AR)) + 2 * pad;
  const s = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((z1 - z0) || 1));
  const px = (x) => pad + (x - x0) * s, py = (z) => H - pad - (z - z0) * s;
  const road = (c.route && c.route.path) || c.path || [];
  const _split = (typeof splitTP === "function") ? splitTP : (p) => (p && p.length ? [p] : []);
  const ctx = road.length ? _split(road).map((run) => `<polyline fill="none" stroke="#3a4453" stroke-width="2" opacity=".4" points="${run.map(([x, z]) => px(x).toFixed(1) + "," + py(z).toFixed(1)).join(" ")}"/>`).join("") : "";
  // the 5 phases as a TRANSLUCENT UNDERLAY band (structure), so the speed-coloured driven lines read on top
  const ph = phases.map((n) => `<polyline class="tv-ph" data-phase="${n}" fill="none" stroke="${SEG_COL[n]}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" opacity=".12" points="${segs[n].map(([x, z]) => px(x).toFixed(1) + "," + py(z).toFixed(1)).join(" ")}"><title>${esc(SEG_LABEL[n])}</title></polyline>`).join("");
  // THE PHASE MODEL ON THE ROAD'S EDGES (Jett 2026-09-11: "when there are multiple historical traces, it makes the
  // 5 phase turn model overlay invisible"). Every lap's line runs inside the road, so a band under them is buried by
  // any bundle. Each phase is now a pair of strips just outside the road edges (this turn's own width), with a
  // divider across the road at every phase boundary -- no line can cover it; the underlay stays only as a tint.
  const halfW = Math.max(7, ((+t.width || 10) / 2) * s + 4);
  const offs = (pts, d) => pts.map((q, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const ux = px(b[0]) - px(a[0]), uy = py(b[1]) - py(a[1]), L = Math.hypot(ux, uy) || 1;
    return (px(q[0]) - (uy / L) * d).toFixed(1) + "," + (py(q[1]) + (ux / L) * d).toFixed(1); }).join(" ");
  const strips = phases.map((n) => [halfW, -halfW].map((d) => `<polyline class="cm-strip" data-phase="${n}" fill="none" stroke="${SEG_COL[n]}" stroke-width="5" stroke-linejoin="round" points="${offs(segs[n], d)}"><title>${esc(SEG_LABEL[n])}</title></polyline>`).join("")).join("")
    + phases.slice(1).map((n) => { const a = segs[n][0], b = segs[n][1] || a;
      const ux = px(b[0]) - px(a[0]), uy = py(b[1]) - py(a[1]), L = Math.hypot(ux, uy) || 1, nx = -uy / L, ny = ux / L, e = halfW + 4;
      return `<line x1="${(px(a[0]) + nx * e).toFixed(1)}" y1="${(py(a[1]) + ny * e).toFixed(1)}" x2="${(px(a[0]) - nx * e).toFixed(1)}" y2="${(py(a[1]) - ny * e).toFixed(1)}" stroke="#dfe7ef" stroke-width="1.2" opacity=".6"/>`; }).join("");
  // DRIVEN SPEED LINES: every lap's racing line through this corner (active preset only). DEFAULT ("rank"):
  // each lap's line is ONE solid colour = its leaderboard position for this turn (green fastest → red slowest).
  // FILTER ("speed"): coloured point-by-point by speed (red slow → green fast) within the corner. Each lap's
  // segments are wrapped in a <g data-lap> so selecting a lap in the leaderboard can dim the rest and lift it.
  const winV = [], runsByLap = {}, paceByLap = {};
  Object.keys(c.traces || {}).forEach((id) => {
    if (ls.set && !ls.set.has(String(id))) return;
    const tr = c.traces[id]; if (!tr || tr.length < 3) return;
    const lapRuns = []; let run = [], sumV = 0, nV = 0;
    for (const p of tr) {
      const X = p[3], Z = p[4], V = p[1];
      if (X == null || Z == null || X < x0 || X > x1 || Z < z0 || Z > z1) { if (run.length > 1) lapRuns.push(run); run = []; continue; }
      run.push([X, Z, V, p[6], p[7], p[2]]); if (V != null) { winV.push(V); sumV += V; nV++; }   // run pt = [x,z,v,thr%,brk%,gripCode] — [3]/[4] pedal paint, [5] grip paint
    }
    if (run.length > 1) lapRuns.push(run);
    if (lapRuns.length) { runsByLap[id] = lapRuns; paceByLap[id] = nV ? sumV / nV : 0; }
  });
  const vmin = winV.length ? Math.min(...winV) : 0, vmax = winV.length ? Math.max(...winV) : 1;
  // PACE RANK (default colouring): order every DRAWN trace by its mean speed through this corner — fastest
  // first — so each trace gets a leaderboard position and one solid colour (green quickest → red slowest).
  // Ranking the drawn traces themselves (not the phaseObs timing table, which is one representative lap per
  // turn) means every line is coloured, and pace reads at a glance. The timing leaderboard you click to
  // isolate a lap is also speed-ordered, so a quick lap there is a green line here.
  const paceOrder = Object.keys(runsByLap).sort((a, b) => paceByLap[b] - paceByLap[a]);
  const rankOf = {}; paceOrder.forEach((id, i) => { rankOf[id] = i; });
  const nDrawn = paceOrder.length;
  const byRank = CM_TRACE_MODE === "rank" && nDrawn > 0;   // default: solid colour by pace position
  const speedLines = Object.entries(runsByLap).map(([id, lapRuns]) => {
    // rank view: one solid colour for the whole lap by its pace position; speed view: per-segment gradient.
    // sw thickens the fastest lap a touch so P1 stands out.
    const ri = rankOf[id];
    const solid = byRank ? rankColor(ri, nDrawn) : null;
    const sw = byRank && ri === 0 ? 2 : 1.3;
    const seg2 = lapRuns.map((run) => {
      let r = run; if (r.length > 40) { const stp = r.length / 40; r = Array.from({ length: 40 }, (_, i) => run[Math.floor(i * stp)]); }
      let out = "";
      for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i], v = ((a[2] || 0) + (b[2] || 0)) / 2;
        // grip: paint each point by its grip state (grey = within grip, so the breaks pop). pedals: throttle/brake.
        const col = byRank ? solid : CM_TRACE_MODE === "grip" ? gripInk(b[5], null) : CM_TRACE_MODE === "pedals" ? pedalCol(pedalKey(b[3], b[4])) : spdColor(v, vmin, vmax);
        out += `<line x1="${px(a[0]).toFixed(1)}" y1="${py(a[1]).toFixed(1)}" x2="${px(b[0]).toFixed(1)}" y2="${py(b[1]).toFixed(1)}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`; }
      return out;
    }).join("");
    return `<g class="cm-lap" data-lap="${esc(String(id))}">${seg2}</g>`;
  }).join("");
  const apex = t.x != null ? `<circle cx="${px(t.x).toFixed(1)}" cy="${py(t.z).toFixed(1)}" r="8" fill="none" stroke="#fff" stroke-width="2"/><circle cx="${px(t.x).toFixed(1)}" cy="${py(t.z).toFixed(1)}" r="2.6" fill="#fff"><title>apex</title></circle><text x="${(px(t.x) + 11).toFixed(1)}" y="${(py(t.z) - 8).toFixed(1)}" font-size="14" font-weight="700" paint-order="stroke" stroke="#0b0e12" stroke-width="3.2" stroke-linejoin="round" fill="#fff">${esc(turnLabel(t))}</text>` : "";
  let chev = "";
  const lastP = phases.length ? segs[phases[phases.length - 1]] : null;
  if (lastP && lastP.length >= 2) {
    const a = lastP[lastP.length - 2], b = lastP[lastP.length - 1];
    const ang = Math.atan2(py(b[1]) - py(a[1]), px(b[0]) - px(a[0])) * 180 / Math.PI;
    chev = `<g transform="translate(${px(b[0]).toFixed(1)},${py(b[1]).toFixed(1)}) rotate(${ang.toFixed(1)})"><path d="M-6,-4 L3,0 L-6,4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }
  const pillAt = (pt, val, bold) => pt ? `<g transform="translate(${px(pt[0]).toFixed(1)},${py(pt[1]).toFixed(1)})"><rect x="-19" y="-9" width="38" height="18" rx="4" fill="#0b0e12" opacity=".85"/><text x="0" y="4" text-anchor="middle" font-size="${bold ? 11 : 9.5}" font-weight="${bold ? 700 : 600}" fill="#fff">${val}</text></g>` : "";
  const midOf = (n) => { const a = segs[n]; return a && a.length ? a[a.length >> 1] : null; };
  const brP = ag("braking"), mdP = ag("mid"), exP = ag("exit");
  const pills = [
    brP && brP.entry != null && segs.braking ? pillAt(segs.braking[0], brP.entry) : "",
    mdP && mdP.min != null ? pillAt(midOf("mid"), mdP.min, true) : "",
    exP && exP.exit != null && segs.exit ? pillAt(segs.exit[segs.exit.length - 1], exP.exit) : "",
  ].join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="tstat-cornersvg" style="background:var(--bg);border-radius:6px;width:100%;max-height:34vh">${ctx}${ph}${speedLines}${strips}${apex}${chev}${pills}</svg>`;
  // legend reflects the active colouring; the toggle switches it (position = default, speed / pedals / grip = filters)
  const modeLeg = CM_TRACE_MODE === "grip" ? `<span class="why">line colour = grip</span>${gripSwatches()}`
    : CM_TRACE_MODE === "pedals" ? `<span class="why">line colour = pedals</span>${pedalSwatches()}` : byRank
    ? `<span class="why">line colour = position (fastest → slowest)</span><em>P1</em><i class="cm-grad cm-grad--rank"></i><em>P${nDrawn}</em>`
    : (winV.length ? `<span class="why">line colour = speed</span><em>${Math.round(vmin)}</em><i class="cm-grad"></i><em>${Math.round(vmax)} mph</em>` : `<span class="why">line colour = speed</span>`);
  const cmToggle = `<span class="cm-views">${[["rank", "position", "each trace one solid colour by its leaderboard position"], ["speed", "speed", "colour each trace point-by-point by speed"], ["grip", "grip", "colour each trace point-by-point by grip state — grey within grip, so where the tyres let go stands out"], ["pedals", "pedals", "colour each trace point-by-point by throttle and brake"]].map(([k, l, tip]) => `<button class="mini ${CM_TRACE_MODE === k ? "on" : ""}" data-cmtrace="${k}" title="${tip}">${l}</button>`).join("")}</span>`;
  // THE CORNER'S LEGEND (Jett 2026-09-11: "the corner detail view needs a legend"): every mark on the map named --
  // the phase strips, what the lines' colour means (with its switch), and the marks.
  const legend = `<div class="cm-legend">
    <div class="cm-lrow"><em>phases</em>${phases.map((n) => `<span><i class="cm-sw" style="background:${SEG_COL[n]}"></i>${esc(SEG_LABEL[n])}</span>`).join("")}</div>
    <div class="cm-lrow"><em>lines</em><span class="why">${nDrawn} lap${nDrawn === 1 ? "" : "s"} in ${scopeTok(ls)}</span>${modeLeg}${cmToggle}</div>
    <div class="cm-lrow"><em>marks</em><span><b class="cm-ring"></b>apex</span><span><b class="cm-pill">mph</b>median entry · slowest · exit</span><span><b class="cm-chev">›</b>direction of travel</span></div></div>`;
  return `<div class="grp tstat-corner">${svg}${legend}${trailBox}</div>`;
}
// RIGHT PANE — TIMING, then statistics, then the grip read. Every figure is a median over the active
// preset's laps and carries its lap count; grip is always the distribution, never a lone word.
// THE SINGLE-TURN VIEW (Jett 2026-09-11). Two things matter: the historical line trace (the left
// turnMap) and a SPEED LEADERBOARD for the turn -- the fastest passes ranked, each phase showing its
// apex speed coloured by grip. The old pane repeated the phase times in two tables, the geometry as
// chips AND a sentence, the grip in a column AND a card. Now geometry is one header line, timing is
// one summary line (the detail is the leaderboard's own turn-s column), the per-phase speed+grip is
// the leaderboard, and grip is one whole-turn bar -- each fact in exactly one place.
// ---- ERROR ANALYSIS (Jett 2026-09-11): a per-phase error is a phase whose dominant off-grip state recurs
// in >=30% of the samples. Each carries a FREQUENCY (share of same-kind corners that show the same phase
// error), a SEVERITY 0-100 (systemic lap-time impact x error type x amount), and TUNING (the analyzer's own
// detector fix where one fired on this turn, else the phase+axle rule) -- or, in a spec event, a DRIVING cue.
const ERR_TYPE_W = { front: 1.0, rear: 1.4, both: 1.55, impact: 1.3 };
const ERR_RULES = {
  "braking|front": "Fronts saturate under braking before turn-in — brake pressure down toward the knee, then balance 2–3% rearward.",
  "turn_in|front": "Trail-brake understeer — finish more of the braking before you steer; caster +0.5 for camber-in-turn.",
  "mid|front": "Mid-corner understeer — front ARB −2 or softer front springs; if only the fast corners, aero balance forward.",
  "exit|front": "Understeer off the exit — front ARB −2 / softer front springs so the nose bites earlier on power.",
  "turn_in|rear": "Entry oversteer — rear ARB/springs softer, or a touch more rear toe-in; ease the trail-braking.",
  "mid|rear": "Mid-corner oversteer — rear ARB/springs softer; add rear downforce if it's the fast corners.",
  "exit|rear": "Power-down oversteer on exit — accel diff lock −10%, or soften the rear / add rear toe-in.",
};
function errRule(ph, state) {
  if (state === "both") return "All four beyond grip — an overdriven line, not a balance fault. Drive it within grip for 3 more laps to separate line from tune.";
  if (state === "impact") return "Impacts / jolts through the corner — ride height up a notch or springs stiffer (verify on the HUD Suspension page).";
  return ERR_RULES[ph + "|" + state] || ERR_RULES["mid|" + state] || "Rear-limited — rear ARB/springs softer; on throttle, accel diff lock −10%.";
}
function drivingCue(ph, state) {
  if (state === "rear") return ph === "exit" ? "Squeeze the throttle later and smoother on exit — the rear steps out when you pick it up too early." : "Ease the trail-braking and be gentler with mid-corner throttle so the rear stays planted.";
  if (state === "front") return "Brake a touch earlier and slow your hands — you're asking the front for more grip than it has, so it washes wide.";
  if (state === "both") return "You're over the limit everywhere here — carry less entry speed and settle the car before you ask for power.";
  if (state === "impact") return "Pick a smoother line over the bumps/kerb through here so the suspension isn't bottoming.";
  return "Smooth the inputs through this phase.";
}
function turnPhaseDom(t, ls) {
  const out = {};
  SEG_ORDER.forEach((n) => { const p = phaseAgg((t.phaseObs || {})[n], ls.set);
    if (!p || !p.mix) { out[n] = { dom: "calm", share: 0, time: p && p.time }; return; }
    let bi = 0, bv = 0; for (let i = 1; i < 5; i++) { if (p.mix[i] > bv) { bv = p.mix[i]; bi = i; } }
    out[n] = bi > 0 ? { dom: GSTATE[bi], share: bv, time: p.time } : { dom: "calm", share: 0, time: p.time };
  });
  return out;
}
function courseLapMed() { const ts = (COURSE && COURSE.laps || []).map((l) => l.t).filter((v) => v != null).sort((a, b) => a - b); return ts.length ? ts[ts.length >> 1] : null; }
function turnErrors(t, ls, cmp) {
  const lapMed = courseLapMed() || 1, sims = (COURSE.turns || []).filter((x) => x.kind === t.kind), dom = turnPhaseDom(t, ls), errs = [];
  const cache = new Map(), domOf = (x) => { if (!cache.has(x)) cache.set(x, turnPhaseDom(x, ls)); return cache.get(x); };
  SEG_ORDER.forEach((n) => { const d = dom[n]; if (!d || d.dom === "calm" || d.share < 0.30) return;
    const cr = cmp.find((c) => c.n === n), tl = (cr && cr.typ != null && cr.best != null) ? Math.max(0, cr.typ - cr.best) : 0;
    let hit = 0; sims.forEach((s) => { const sd = domOf(s)[n]; if (sd && sd.dom === d.dom && sd.share >= 0.30) hit++; });
    const freq = sims.length ? hit / sims.length : 0, systemic = tl * Math.max(1, hit), sysPct = systemic / lapMed * 100;
    const sev = Math.min(100, Math.round(sysPct * 20 * (ERR_TYPE_W[d.dom] / 1.2) * (0.75 + 0.25 * d.share)));
    const sevLab = sev >= 75 ? "critical" : sev >= 50 ? "major" : sev >= 25 ? "moderate" : "minor";
    let tuning = null, src = "rule";
    (DIAG && DIAG.by_turn ? DIAG.by_turn : []).some((r) => { if (r.route_key === COURSE.key && (r.turn_id === t.turn_id || r.turn_id === t.id) && r.phase === n && r.primary_fix) { tuning = r.symptom + " → " + r.primary_fix; src = "detector"; return true; } return false; });
    if (!tuning) tuning = errRule(n, d.dom);
    errs.push({ phase: n, state: d.dom, share: d.share, freq, hit, nsim: sims.length, timeLost: tl, systemic, sysPct, sev, sevLab, tuning, src });
  });
  errs.sort((a, b) => b.sev - a.sev); return errs;
}
function turnStatsHTML(t, ls) {
  const obs = t.phaseObs || {};
  const inSet = (r) => ls.set.has(String(r[0]));
  const meta = {}; (COURSE.laps || []).forEach((l) => meta[l.id] = l);
  const lapT = {}; (COURSE.laps || []).forEach((l) => { if (l.t != null) lapT[l.id] = l.t; });
  const med = (a) => { a = a.filter((x) => x != null).slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
  // gather each phase's obs row per lap, then rank the passes by their time through the turn.
  const byLap = {};
  SEG_ORDER.forEach((n) => (obs[n] || []).forEach((r) => { if (!inSet(r)) return; (byLap[r[0]] = byLap[r[0]] || {})[n] = r; }));
  const lapIds = Object.keys(byLap);
  // TYPICAL PHASE SET (Jett 2026-09-11): every driven pass is now exported (build_web no longer keeps only
  // whole clean laps), but which phases a pass is sampled in is noisy — sum the raw per-phase times and a
  // pass caught in fewer phases posts a smaller turnT and would falsely rank fastest. So rank on the phase
  // set the turn ACTUALLY shows: phases present in >= half its passes. turnT sums exactly that set (extra
  // phases ignored) so every ranked pass is timed over the SAME phases; a pass missing a typical phase has
  // no comparable time and is left out of the ranking (its grip still counts in the mix + on the map).
  const nSeen = lapIds.length;
  const typical = SEG_ORDER.filter((n) => lapIds.reduce((c, id) => c + ((byLap[id][n] && byLap[id][n][5] != null) ? 1 : 0), 0) >= nSeen / 2);
  const passes = lapIds.map((id) => {
    const covers = typical.length > 0 && typical.every((n) => byLap[id][n] && byLap[id][n][5] != null);
    let tt = 0; if (covers) typical.forEach((n) => { tt += byLap[id][n][5]; });
    return { id: +id, ph: byLap[id], turnT: covers ? tt : null, lapT: lapT[id], meta: meta[id] || {} };
  }).filter((p) => p.turnT != null).sort((a, b) => a.turnT - b.turnT);
  const nLaps = passes.length, best = passes[0] || null;
  const medTurnT = med(passes.map((p) => p.turnT)), medLapT = med(passes.map((p) => p.lapT));
  // whole-turn grip mix (equal weight per lap) + which phase eats the most time
  const aggs = SEG_ORDER.map((n) => ({ n, p: phaseAgg(obs[n], ls.set) }));
  const twMix = [0, 0, 0, 0, 0]; let twW = 0;
  aggs.forEach(({ p }) => { if (p && p.mix) { const w = p.time || 1; for (let i = 0; i < 5; i++) twMix[i] += p.mix[i] * w; twW += w; } });
  const turnMix = twW ? twMix.map((v) => v / twW) : null;
  const biggest = aggs.filter((a) => a.p && a.p.time).sort((a, b) => b.p.time - a.p.time)[0];

  // ---- HEADER: the turn and its whole geometry on ONE line
  const dirW = t.dir === "L" ? "left" : t.dir === "R" ? "right" : "";
  // geometry only, compacted (the lap COUNT moved to the summary/leaderboard where the timing lives, and the
  // unit words are trimmed): "Tight left · R34m · 99° · 14.7m wide · 2° bank · apex 268m".
  const geo = [t.kind && cap1(t.kind) + (dirW ? " " + dirW : ""), t.r != null && "R" + Math.round(t.r) + "m",
    t.deg != null && Math.round(t.deg) + "°", t.width != null && (+t.width).toFixed(1) + "m wide",
    t.bank != null && (Math.abs(t.bank) < 1.5 ? "flat" : Math.abs(Math.round(t.bank)) + "° bank"),
    t.s != null && "apex " + Math.round(t.s) + "m", nLaps ? "" : "not timed yet"].filter(Boolean).join(" · ");
  const header = `<div class="gh tstat-h"><b>${esc(turnLabel(t))}</b><span class="why">${esc(geo)}</span>
    <span class="tstat-nav"><button class="mini" data-turnstep="prev" title="previous turn">‹</button><button class="mini" data-turnstep="next" title="next turn">›</button><button class="mini" data-turnclear title="clear selection">✕</button></span></div>`;
  if (!nLaps) return `<div class="tstat">${header}<div class="why" style="padding:8px 6px">no timed laps through this turn in ${esc(ls.label)} — widen the filter or drive it</div></div>`;

  // ---- per-phase best times (from the single fastest pass), for the where-the-time-goes table
  const bestPh = {}; if (best) SEG_ORDER.forEach((n) => { const r = best.ph[n]; if (r && r[5] != null) bestPh[n] = r[5]; });
  const cmp = aggs.map(({ n, p }) => ({ n, typ: p && p.time, best: bestPh[n] })).filter((r) => r.typ != null);
  let worst = null; cmp.forEach((r) => { if (r.best != null) { const d = r.typ - r.best; if (!worst || d > worst.d) worst = { n: r.n, d }; } });
  const findTotal = cmp.reduce((s, r) => s + (r.best != null ? Math.max(0, r.typ - r.best) : 0), 0);

  // ---- DIAGNOSIS: ONE verdict card (the worst detector row on THIS turn), tone-coloured; a green
  // "nothing to change" card when nothing fired. route_key + turn_id match against the detector output.
  // ---- DETECTED ERRORS: each phase's dominant off-grip fault, with frequency in similar corners, a severity
  // (systemic lap impact x type x amount), and tuning — or a DRIVING cue when the car is a spec/temporary one.
  const errs = turnErrors(t, ls, cmp);
  const SEVCOL = { minor: "var(--mut)", moderate: "var(--warn)", major: "#f0862d", critical: "var(--bad)" };
  const spec = isSpecEvent();
  const errHead = (e) => { const P = SEG_LABEL[e.phase];
    return e.state === "both" ? P + ": an overdriven line — all four past grip" : e.state === "front" ? P + ": understeer — the front washes out"
      : e.state === "rear" ? P + ": oversteer — the rear steps out" : e.state === "impact" ? P + ": the suspension is bottoming" : P; };
  const diag = errs.length ? `<div class="grp"><div class="gh">Detected errors <span class="why">· 5-phase · how often in similar corners · severity · ${spec ? "driving" : "tuning"}</span></div>
    ${errs.map((e) => { const sc = SEVCOL[e.sevLab], gg = DGRIP[e.state] || DGRIP.calm;
      const tx = spec ? drivingCue(e.phase, e.state) : e.tuning, wr = spec ? "drive" : "tune", src = spec ? "spec car" : e.src;
      return `<div class="terr" style="--sev:${sc}"><div class="terr-top">
        <span class="terr-ph" style="border-color:${SEG_COL[e.phase]}"><i style="background:${SEG_COL[e.phase]}"></i>${esc(SEG_LABEL[e.phase])}</span>
        <span class="terr-grip" style="color:${gg.ink}" title="${esc(gg.tip)}">${esc(gg.word)}</span>
        <span class="terr-sev"><b style="color:${sc}">${e.sev}</b><em style="color:${sc}">${e.sevLab}</em></span></div>
        <div class="terr-head">${esc(errHead(e))}</div>
        <div class="terr-m">
          <span><em>freq · similar</em><b>${Math.round(e.freq * 100)}%</b><i>${e.hit}/${e.nsim} ${esc(t.kind)}</i></span>
          <span><em>lap impact</em><b>+${e.timeLost.toFixed(2)}s</b><i>${e.systemic.toFixed(2)}s · ${e.sysPct.toFixed(1)}% systemic</i></span>
          <span><em>amount</em><b>${Math.round(e.share * 100)}%</b><i>of samples</i></span></div>
        <div class="terr-tune"><span class="wr">${wr}</span><span class="tx">${esc(tx)}<span class="src">${esc(src)}</span></span></div></div>`;
    }).join("")}</div>`
    : `<div class="grp"><div class="dxcard dxcard--ok"><div class="dx-top"><span class="dx-lbl">diagnosis</span><span class="dx-conf ok">measured · ${nLaps} lap${nLaps === 1 ? "" : "s"}</span></div>
      <div class="dx-head" style="color:var(--acc)">Nothing to change here</div><div class="dx-fix">Every phase reads within grip across the drawn laps.</div><div class="dx-ev">${esc(gripRead(turnMix))}</div></div></div>`;

  // ---- WHERE THE TIME GOES: the headline turn-time figure + available, the fastest/most-time verdict, a
  // per-phase time-budget bar, and the typical-vs-best table (5th column visualises each phase's gap).
  const hasBest = cmp.some((r) => r.best != null);
  const maxD = Math.max(0.01, ...cmp.map((r) => r.best != null ? Math.max(0, r.typ - r.best) : 0));
  const budgetSegs = aggs.filter((a) => a.p && a.p.time).map(({ n, p }) =>
    `<span class="bud-seg" style="flex:${Math.round(p.time * 100)} 0 0;background:${SEG_COL[n]}" title="${esc(SEG_LABEL[n])} · ${p.time.toFixed(2)} s">${p.time >= 0.5 ? `<i>${p.time.toFixed(1)}</i>` : ""}</span>`).join("");
  // THE COMPACT TIME SUMMARY (Jett 2026-09-11): the headline the bottom "where the time goes" panel carried —
  // typical turn-time + share of lap, time available, the fastest pass, and which phase eats the most — folds
  // UP into the title bar so the identity and the summary read as one bar, above the map.
  const sumRow = `<div class="tsum"><b class="tsum-typ">${medTurnT.toFixed(1)}s</b> typical${nLaps ? ` · ${nLaps} laps` : ""}${medLapT ? ` · ${Math.round(medTurnT / medLapT * 100)}% of lap` : ""}${hasBest && findTotal > 0.02 ? ` · <b class="tsum-avail">+${findTotal.toFixed(2)}s</b> to find` : ""}${best ? ` · fastest <b class="tsum-fast">${best.turnT.toFixed(2)}s</b>` : ""}${biggest ? ` · most time <b class="tsum-most" style="color:${SEG_COL[biggest.n]}"><i style="background:${SEG_COL[biggest.n]}"></i>${esc(SEG_LABEL[biggest.n])}</b>` : ""}</div>`;
  // THE GRIP-CEILING LINE (2026-09-12): how close the best pass got to the tyres' measured limit here, from
  // the class a_max (schema-7 peak lat_g). Honest by outcome: a % only within one class with a_max present;
  // otherwise the reason, never a fabricated number. Silent when there's no grip data for this turn yet.
  const gcx = turnGripCeiling(COURSE, t, ls);
  let gripLine = "";
  if (gcx.reason === "mixed") {
    gripLine = `<div class="tsum tsum-grip"><span class="tg-lab">grip ceiling</span> <span class="why">scope to one class to read it — apex grip is car-dependent</span></div>`;
  } else if (gcx.util != null) {
    const atLimit = gcx.util >= 97;
    const thin = gcx.nLaps < 3;   // rests on 1-2 of the driver's own laps here -> mark it, never authoritative
    const tail = gcx.avail ? ` · <b class="tsum-avail">~+${gcx.avail} mph</b> to find` : atLimit ? " · at the limit" : "";
    const bandTxt = gcx.coarse ? "class-wide, speed-coarse" : `${gcx.band.lo}${gcx.band.hi ? "–" + gcx.band.hi : "+"} mph band`;
    gripLine = `<div class="tsum tsum-grip" title="your best of ${gcx.nLaps} lap${gcx.nLaps === 1 ? "" : "s"} here pulled ${gcx.bestG} g of the ${esc(gcx.cls)} grip ceiling a_max ${gcx.aMax} g (${bandTxt} · p90 of ${gcx.n} class laps)${thin ? " · THIN: only " + gcx.nLaps + " of your laps support this" : ""} · a gentle corner uses less lateral g by nature, so a low % can be the corner not the driver · dirt & aero not separated${gcx.avail ? " · +mph is a near-limit estimate" : ""}"><span class="tg-lab">grip used</span> <b class="tg-pct${atLimit ? " tg-max" : ""}${thin ? " tg-thin" : ""}">${gcx.util}%</b> <span class="why">of the ${esc(gcx.cls)} grip limit${thin ? ` · <span class="tg-thinnote">${gcx.nLaps} lap${gcx.nLaps === 1 ? "" : "s"}</span>` : ""}${tail}</span></div>`;
  }
  // ONE compacted title info bar: identity + geometry (header) ∪ the time summary ∪ the grip ceiling ∪ the
  // 5-phase corner model (the per-phase time-budget bar). The detailed per-phase typical-vs-best TABLE stays below.
  const titleBar = `<div class="grp tstat-title">${header}${sumRow}${gripLine}${budgetSegs ? `<div class="budget budget--title" title="the 5-phase corner model · each segment = median seconds in that phase, coloured to the phase legend">${budgetSegs}</div>` : ""}</div>`;
  const cmpTable = hasBest ? `<table class="tstat-cmp"><thead><tr><th>phase</th><th>typical</th><th>best lap</th><th>Δ s</th><th>where it goes</th></tr></thead><tbody>
    ${cmp.map((r) => { const d = r.best != null ? r.typ - r.best : null; const flag = worst && worst.n === r.n && worst.d > 0.03; const pct = d != null && d > 0 ? Math.round(d / maxD * 100) : 0;
      return `<tr class="${flag ? "tb-flag" : ""}"><td><span class="pdot" style="background:${SEG_COL[r.n]}"></span>${esc(SEG_LABEL[r.n])}</td>
        <td class="mono">${r.typ.toFixed(2)}</td><td class="mono dim">${r.best != null ? r.best.toFixed(2) : "—"}</td>
        <td class="mono" style="color:${d != null && d > 0.05 ? "#e3b341" : "var(--mut)"};font-weight:700">${d != null ? (d > 0 ? "+" : "") + d.toFixed(2) : "—"}</td>
        <td><span class="wig"><i style="width:${pct}%;background:${SEG_COL[r.n]}"></i></span></td></tr>`; }).join("")}</tbody></table>` : "";
  const wtg = hasBest ? `<div class="grp tstat-wtg"><div class="gh">Where the time goes <span class="why">· per phase · typical vs your best lap (${lapTime(best.lapT)})</span></div>${cmpTable}</div>` : "";

  // ---- THE LEADERBOARD: passes fastest-first; each phase cell = apex mph, coloured by grip
  const SHORT = { braking: "brake", turn_in: "entry", mid: "mid", exit: "exit", straight: "straight" };
  const phHead = SEG_ORDER.map((n) => `<th title="${esc(SEG_LABEL[n])}"><span class="pdot" style="background:${SEG_COL[n]}"></span>${esc(SHORT[n])}</th>`).join("");
  const cell = (r) => { if (!r || r[2] == null) return `<td class="mono off">·</td>`; const gk = GSTATE[r[4]] || "calm"; const g = DGRIP[gk];
    return `<td class="mono" style="color:${gk === "calm" ? "var(--ink)" : g.col}" title="apex ${Math.round(r[2])} mph · ${esc(g.word)}${r[5] != null ? " · " + r[5].toFixed(2) + " s" : ""}">${Math.round(r[2])}</td>`; };
  const rows = passes.map((p, i) => `<tr class="tlb-row${i === 0 ? " tlb-best" : ""}" data-lap="${esc(String(p.id))}" title="click to isolate this lap's trace on the corner map">
      <td class="tlb-rank">${i + 1}</td><td class="mono">${p.lapT != null ? lapTime(p.lapT) : "—"}</td>
      <td class="tlb-car" title="${esc(carName(p.meta.cid))}${p.meta.pi ? " · " + p.meta.pi + " PI" : ""}">${classPill(p.meta.class)}<span class="tlb-carn">${esc(carShort(p.meta.cid))}</span></td>
      <td class="mono tlb-tt">${p.turnT.toFixed(2)}</td>${SEG_ORDER.map((n) => cell(p.ph[n])).join("")}</tr>`).join("");
  // NO row cap: the info panes may scroll (Jett 2026-09-11) -- .pane>.body already scrolls, so every
  // pass is listed and the list scrolls, rather than being clipped to a "top N".
  const board = `<div class="grp"><div class="gh">Fastest passes <span class="why">· ${esc(ls.label)} · ${nLaps} lap${nLaps === 1 ? "" : "s"} · phase = apex mph, coloured by grip</span></div>
    <div class="tlb-wrap"><table class="tlb"><thead><tr><th></th><th>lap</th><th>car</th><th title="time through the turn">turn s</th>${phHead}</tr></thead><tbody>${rows}</tbody></table></div></div>`;

  // ---- GRIP: one whole-turn bar; the legend carries each state's share of samples (turnMix)
  const gripCard = `<div class="grp"><div class="gh">Grip through the turn <span class="why">· share of samples · ${esc(ls.label)}</span></div>
    <div class="tstat-gread">${gripBar(turnMix, "gbar--lg")}<span class="tstat-gword">${esc(gripRead(turnMix))}</span></div>
    <div class="ballegend gleg">${GSTATE.map((k, i) => `<span><i style="background:${DGRIP[k].col}"></i>${DGRIP[k].word}${turnMix ? ` <b class="mono dim">${Math.round((turnMix[i] || 0) * 100)}%</b>` : ""}</span>`).join("")}</div>
    <div class="tstat-foot">medians over ${nLaps} lap${nLaps === 1 ? "" : "s"} in ${esc(ls.label)} · phase spans from the game's centre-line · every figure carries its lap count</div></div>`;

  const cornerMap = cornerMapHTML(COURSE, t, ls);   // the per-turn line trace + phase-time rail, now in THIS (right) pane
  // the corner map (historical line trace) is one of the two most important things in the single-turn view,
  // so it leads — right under the header — with the leaderboard, errors, where-the-time-goes and grip below.
  // ERRORS PULLED FROM TURN ANALYSIS FOR NOW (Jett 2026-09-11): the detected-error cards (`diag`) are held
  // out of this section. The machinery above (turnErrors + `diag`) is left intact so restoring is a one-token
  // change — put ${diag} back between ${cornerMap} and ${wtg} when we bring it back.
  void diag;
  return `<div class="tstat">${titleBar}${cornerMap}${wtg}${board}${gripCard}</div>`;
}
function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function matrixHTML() {
  if (!COURSE || !(COURSE.turns || []).length) return `<div class="why">no turn map for this course yet</div>`;
  const ls = activeLapSet();
  const sel = turnPickSeq();
  const selT = sel != null ? (COURSE.turns || []).find((t) => t.seq === sel) : null;
  // a turn is selected -> the pane IS its full statistics (timing + per-phase + grip); its own ‹ › ✕ nav
  // steps between turns and clears. The overview strip + live session matrix return when nothing is picked.
  if (selT) return turnStatsHTML(selT, ls);
  const strip = cornerStripHTML(ls, sel);
  const cid = CUR && CUR.cid;
  const log = (LIVE.corners || []).filter((c) => !cid || c.car === cid);
  if (!log.length) return strip || `<div class="why">start driving — the matrix fills in one row per turn as you take it</div>`;

  // ev===0 (free-roam) corners are excluded from turn rows, the same gate v1's matrix used — the
  // live ev stamp trusts a single apex-frame read today; see the daemon-side majority-vote hardening.
  const bySeq = {}; let lastSeq = null;
  log.filter((c) => c.ev !== 0).forEach((c) => {
    const { t, ambiguous } = turnAtMatrix(c.apex, lastSeq);
    if (!t) return;
    lastSeq = t.seq;
    (bySeq[t.seq] = bySeq[t.seq] || []).push({ c, ambiguous });
  });

  const med = (a) => { a = a.filter((v) => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const rows = COURSE.turns.slice().sort((a, b) => a.seq - b.seq).map((t) => {
    const arr = bySeq[t.seq] || [];
    const last = arr.length ? arr[arr.length - 1].c : null;
    const anyAmbiguous = arr.some((b) => b.ambiguous);
    const fr = { front: 0, rear: 0, none: 0 };
    arr.forEach((b) => fr[(b.c.first_red || {}).axle || "none"]++);   // first_red is legitimately null ~10% of the time (a clean corner) — bucketed, not skipped
    const dom = arr.length ? Object.keys(fr).sort((x, y) => fr[y] - fr[x])[0] : null;
    return {
      t, taken: arr.length, anyAmbiguous, dom, fr, last,
      mph: med(arr.map((b) => b.c.mph_apex != null ? b.c.mph_apex : b.c.mph_min)),
      lat: med(arr.map((b) => b.c.lat_g_peak)),
      usi: med(arr.map((b) => b.c.usi)),          // usi can legitimately be exactly 0 — check `!= null`, never truthiness
    };
  });

  const badge = courseConfidenceBadge();
  const head = `<div class="frow head"><b>${rows.filter((r) => r.taken).length}/${rows.length} turns taken this session</b>${badge}</div>`;
  const table = `<div style="overflow:auto"><table style="font-size:11px;border-collapse:collapse;width:100%"><thead><tr>
    <th style="text-align:left">turn</th><th>taken</th><th>apex mph</th><th>lat g</th><th>USI</th><th>first red</th><th>last pass</th></tr></thead><tbody>
    ${rows.map((r) => {
      const g = r.usi != null ? DGRIP[dGripUsi(r.usi)] : null;
      const dcol = r.dom === "front" || r.dom === "rear" ? DGRIP[r.dom].ink : "var(--muted)";
      return `<tr style="${r.taken ? "" : "opacity:.4"}${r.anyAmbiguous ? ";outline:1px dashed var(--w)" : ""}">
        <td><b>${esc(turnLabel(r.t))}</b>${r.t.kind ? " " + esc(r.t.kind) : ""}${r.anyAmbiguous ? ` <span title="nearest of 2 turns within range — some passes here could belong to a neighboring turn">⚠</span>` : ""}</td>
        <td class="mono" style="text-align:center">${r.taken || "—"}</td>
        <td class="mono" style="text-align:center">${r.mph ?? "—"}</td>
        <td class="mono" style="text-align:center">${r.lat ?? "—"}</td>
        <td style="text-align:center">${r.usi != null ? `<span style="color:${g.ink}" title="${esc(g.word)}">${r.usi > 0 ? "+" : ""}${r.usi.toFixed(2)}</span>` : "—"}</td>
        <td style="text-align:center">${r.taken ? `<span style="color:${dcol};font-weight:700">${r.dom || "clean"}</span> <span class="why">${r.fr.front}/${r.fr.rear}/${r.fr.none}</span>` : "—"}</td>
        <td class="mono">${r.last ? `${r.last.mph_in}→<b>${r.last.mph_min}</b>→${r.last.mph_out ?? "—"} ${phaseBars(r.last.phases)}` : "—"}</td>
      </tr>`;
    }).join("")}
  </tbody></table></div>`;
  return strip + head + table;
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

// THE THREE PROCESSES THE LAB IS (Jett 2026-09-08). Served by the rebuild service on 8001, because that is
// the one that is neither the daemon nor the page server and can therefore restart either. State is polled
// on open and after every action -- never on a timer: netstat costs ~100 ms and nothing here changes on its
// own. STOPPING THE DASHBOARD KILLS THIS PAGE, so that one button asks first; the rebuild service refuses
// to stop itself at the server (409) and the button is not offered.
const SVC = { list: [], busy: null, note: "", err: "" };
async function svcRefresh() {
  try {
    const r = await fetch(REBUILD + "/services");
    SVC.list = (await r.json()).services || []; SVC.err = "";
  } catch (e) { SVC.list = []; SVC.err = "the rebuild service on 8001 is not answering — start the lab with scripts/lab_up.ps1"; }
  lastAction();   // the services controls live in the top bar now
}
async function svcAct(name, action) {
  if (name === "dashboard" && (action === "stop" || action === "restart")
      && !confirm("The dashboard server on 8000 serves THIS PAGE.\n\n"
                  + (action === "stop" ? "Stopping it will make this page stop loading — you would restart it with scripts/lab_up.ps1."
                                       : "Restarting it will drop this page for a few seconds; reload after it comes back.")
                  + "\n\nContinue?")) return;
  SVC.busy = name + ":" + action; SVC.note = ""; SVC.err = ""; lastAction();
  try {
    const r = await fetch(REBUILD + "/service", { method: "POST", headers: { "Content-Type": "application/json" },
                                                  body: JSON.stringify({ name, action }) });
    const j = await r.json();
    SVC.note = (j.note || j.error || "") + "";
    if (!r.ok && !j.note) SVC.err = j.error || ("HTTP " + r.status);
  } catch (e) { SVC.err = String((e && e.message) || e); }
  SVC.busy = null;
  // a restarted service needs a moment to bind before its state is worth reading
  setTimeout(svcRefresh, action === "stop" ? 400 : 1600);
  lastAction();   // repaint the top-bar services dropdown, not the (removed) right-pane tab
}
function servicesHTML() {
  const rows = SVC.list.map((v) => {
    const busy = (a) => SVC.busy === v.name + ":" + a;
    const anyBusy = !!SVC.busy;
    const btn = (a, lbl) => `<button class="mini svcb" data-svc="${esc(v.name)}" data-svcact="${a}"
        ${anyBusy || (a === "start" && v.up) || (a !== "start" && !v.up) ? "disabled" : ""}>${busy(a) ? "…" : lbl}</button>`;
    return `<div class="frow svcrow">
      <span class="svcdot" data-up="${v.up ? "1" : "0"}"></span>
      <b>${esc(v.name)}</b>
      <span class="why">${esc(v.what)} · ${v.up ? "up on " + v.port + (v.pid ? " · pid " + v.pid : "") : "down (" + v.port + ")"}</span>
      <span class="svcbtns">${btn("start", "START")}${v.self ? "" : btn("stop", "STOP")}${btn("restart", "RESTART")}</span>
    </div>`;
  }).join("");
  return `<div class="grp"><div class="gh">Background services</div>
    ${SVC.err ? `<div class="frow"><span class="why" style="color:var(--bad)">${esc(SVC.err)}</span></div>` : ""}
    ${rows || `<div class="frow"><span class="why">nothing read yet</span><button class="mini" data-svcrefresh="1">READ STATE</button></div>`}
    ${rows ? `<div class="frow"><button class="mini" data-svcrefresh="1">REFRESH</button><span class="why">${esc(SVC.note || "the rebuild service cannot stop itself — it hosts these controls")}</span></div>` : ""}
  </div>`;
}

// What this build keeps doing wrong, wherever it happens. Filtered to atomically-similar builds:
// same hardware fingerprint under the rim rule, which is what makes history transferable.
// GENERAL STATISTICS (course mode): the course's own facts + a per-class breakdown. Each class is
// its own comparison (an S1 lap is not an A lap), so lap times and the cars/builds that set them live
// in a class section. Picking a class in the filter bar -- or clicking a class here -- FOCUSES it: the
// other classes collapse to a one-line summary and the chosen one expands to its build table.
const CLASS_ORDER = ["D", "C", "B", "A", "S1", "S2", "R", "X"];
function courseStatsHTML() {
  // GENERAL STATISTICS, PER CAR (redesign step 4): scoped to the active lap set, this answers "which car,
  // and how does practice trade for pace" — a most-driven and a quickest headline, a laps×best scatter (one
  // dot per car, fastest at the top), and a fastest-first car table. Cars are grouped by ordinal (the physical
  // car), NOT by build/tune as before. The basis header states the scope and never implies a total over laps
  // it dropped — laps that name no tune are counted and called out, not hidden.
  const ls = activeLapSet(), allLaps = COURSE.laps || [];
  const laps = allLaps.filter((l) => ls.set.has(String(l.id)));
  const clean = (l) => !l.void && !l.partial && !l.rewinds && l.t != null;
  const fmtLen = (m) => m == null ? "—" : m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
  const med = (a) => { a = a.filter((x) => x != null).slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
  const ordOf = (cid) => String(cid || "").split("|")[0] || "?";
  const nCars = new Set(laps.map((l) => ordOf(l.cid)).filter((o) => o && o !== "?")).size;
  const noTune = laps.filter((l) => !l.container).length;
  const totals = `<div class="grp"><div class="gh">${esc(COURSE.name || COURSE.key)} <span class="why">· general statistics</span></div>
    <div class="cstat-tot"><span><b>${laps.length}</b><em>lap${laps.length === 1 ? "" : "s"} in ${scopeTok(ls)}</em></span>
      <span><b>${allLaps.length}</b><em>on the course</em></span>
      <span><b>${nCars}</b><em>car${nCars === 1 ? "" : "s"}</em></span>
      <span><b>${fmtLen(COURSE.len)}</b><em>length</em></span>
      ${noTune ? `<span><b>${noTune}</b><em>lap${noTune === 1 ? "" : "s"} name no tune</em></span>` : ""}</div></div>`;
  if (!laps.length) return totals + `<div class="why" style="padding:4px 6px">${allLaps.length ? `no lap in ${scopeTok(ls)} — ${allLaps.length} on the course; widen the filter to see them` : "no laps recorded on this course yet"}</div>`;
  // per-CAR aggregation (by ordinal) within scope
  const byCar = {};
  laps.forEach((l) => { const o = ordOf(l.cid);
    const c = byCar[o] = byCar[o] || { ord: o, cid: l.cid, name: carShort(l.cid), cls: l.class, pi: l.pi, laps: [] };
    c.laps.push(l); if (l.class && !c.cls) c.cls = l.class; if (l.pi && !c.pi) c.pi = l.pi; });
  const cars = Object.values(byCar).map((c) => { const timed = c.laps.filter(clean);
    const best = timed.length ? Math.min(...timed.map((l) => l.t)) : null;
    return { ord: c.ord, name: c.name, cls: c.cls, pi: c.pi, n: c.laps.length, nClean: timed.length, best, med: med(timed.map((l) => l.t)) }; });
  const mostUsed = cars.slice().sort((a, b) => b.n - a.n)[0];
  const withBest = cars.filter((c) => c.best != null);
  const quickest = withBest.slice().sort((a, b) => a.best - b.best)[0];
  const headline = `<div class="grp cstat-heads">
    ${mostUsed ? `<div class="cstat-head"><em>most driven</em><b>${esc(mostUsed.name)}</b><span class="why">${classPill(mostUsed.cls)} · ${mostUsed.n} lap${mostUsed.n === 1 ? "" : "s"}</span></div>` : ""}
    ${quickest ? `<div class="cstat-head"><em>quickest</em><b class="mono" style="color:var(--acc)">${lapTime(quickest.best)}</b><span class="why">${classPill(quickest.cls)} · ${esc(quickest.name)}</span></div>` : ""}</div>`;
  // SCATTER: x = laps driven, y = best lap (fastest at the TOP), one dot per car, coloured by class
  let scatter = "";
  if (withBest.length) {
    const W = 520, H = 168, padL = 40, padR = 10, padT = 10, padB = 22;
    const maxN = Math.max(1, ...cars.map((c) => c.n)), bs = withBest.map((c) => c.best), lo = Math.min(...bs), hi = Math.max(...bs), sp = (hi - lo) || 1;
    const X = (n) => padL + (maxN <= 1 ? 0.5 : (n - 1) / (maxN - 1)) * (W - padL - padR);
    const Y = (t) => padT + ((t - lo) / sp) * (H - padT - padB);   // fastest (lo) at the top
    const dots = withBest.map((c) => { const on = c === quickest;
      return `<circle cx="${X(c.n).toFixed(1)}" cy="${Y(c.best).toFixed(1)}" r="${on ? 5.5 : 4}" fill="${piColor(c.cls)}" stroke="${on ? "var(--acc)" : "#0b0e12"}" stroke-width="${on ? 2 : 1}"><title>${esc(c.name)}${c.cls ? " · " + esc(c.cls) : ""} · ${c.n} lap${c.n === 1 ? "" : "s"} · best ${lapTime(c.best)}${c.med != null ? " · median " + lapTime(c.med) : ""}</title></circle>`; }).join("");
    const ya = [lo, hi].map((t) => `<text x="2" y="${(Y(t) + 3).toFixed(1)}" font-size="8" fill="var(--dim)">${lapTime(t)}</text>`).join("");
    const xa = `<text x="${padL}" y="${H - 6}" font-size="8" fill="var(--dim)">1 lap</text><text x="${W - padR}" y="${H - 6}" font-size="8" fill="var(--dim)" text-anchor="end">${maxN} lap${maxN === 1 ? "" : "s"}</text>`;
    scatter = `<div class="grp"><div class="gh">pace vs practice <span class="why">· each car: laps driven → its best lap · fastest at the top</span></div>
      <svg class="cstat-scatter" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="var(--line2)"/><line x1="${padL}" y1="${(H - padB).toFixed(1)}" x2="${W - padR}" y2="${(H - padB).toFixed(1)}" stroke="var(--line2)"/>${ya}${xa}${dots}</svg></div>`;
  }
  // CAR TABLE: fastest first; the pane scrolls (courseStats skips fitRows)
  const rows = cars.slice().sort((a, b) => (a.best || 9e9) - (b.best || 9e9)).map((c) => `<tr${c === quickest ? ' class="cstat-fast"' : ""}>
    <td>${piBadge(c.cls, c.pi, true)} <b>${esc(c.name)}</b></td>
    <td class="mono" style="text-align:center">${c.n}</td>
    <td class="mono" style="text-align:right">${c.best != null ? lapTime(c.best) : "—"}</td>
    <td class="mono dim" style="text-align:right">${c.med != null ? lapTime(c.med) : "—"}</td></tr>`).join("");
  const table = `<div class="grp"><div class="gh">by car <span class="why">· ${cars.length} car${cars.length === 1 ? "" : "s"} in ${scopeTok(ls)} · fastest first</span></div>
    <table class="cstat-tbl"><thead><tr><th>car</th><th>laps</th><th>best</th><th>median</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return totals + headline + scatter + table;
}
function statsHTML() {
  if (MODE.suggest === "course" && COURSE) return courseStatsHTML();
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
    <div class="fl"><b>${esc(turnLabel(r))} <span class="dim">${esc(r.kind || "")}</span></b>
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
  // LEFT: the live glance — a LIVE dot, the compact mph/gear/lat-g readout, and the next-turn hint (spec 390-393)
  const fr = LIVE.frame, liveOn = !!(LIVE.receiving && fr && fr.on);
  const g = fr ? (fr.gear === 0 ? "N" : fr.gear === 11 ? "⇅" : fr.gear) : "—";
  let nextUp = "";
  if (MODE.suggest === "course" && COURSE && (COURSE.turns || []).length) {
    const seqs = COURSE.turns.map((t) => t.seq).filter((s) => s != null).sort((a, b) => a - b);
    if (seqs.length) { const cur = turnPickSeq(), i = cur == null ? -1 : seqs.indexOf(cur);
      const nt = COURSE.turns.find((t) => t.seq === (i < 0 ? seqs[0] : seqs[(i + 1) % seqs.length]));
      if (nt) { const mid = phaseAgg((nt.phaseObs || {}).mid, activeLapSet().set);
        nextUp = `${turnLabel(nt)} next${mid && mid.min != null ? " · " + mid.min + " mph typical apex" : ""}`; } }
  }
  const liveRead = liveOn
    ? `<span class="ftr-live"><i></i>LIVE</span><span class="mono ftr-tel">${fx(fr.mph, 0)} mph · ${esc(String(g))} · ${fx(fr.lat, 2)} lat g</span>${nextUp ? `<span class="why ftr-next">${esc(nextUp)}</span>` : ""}`
    : `<span class="ftr-live off"><i></i>idle</span><span class="why">${esc(MODE.reason || "not driving")}</span>`;
  f.innerHTML = `${liveRead}
    <span class="ftr-right">
      <span class="why">status · ${esc(st.label)}</span>${cov}
      <span class="chip ${MODE.suggest === "course" ? "on" : ""}">mode · ${MODE.known ? esc(MODE.suggest) + (MODE.held ? " (held)" : "") : "—, waiting"}</span>
      <span class="chip">baseline · ${BASELINE ? esc(BASELINE.name || BASELINE.container) : "none"}</span>
    </span>`;
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
    cls: CUR.cls, pi: CUR.pi,   // for the sheet's own PI badge -- CUR.pi drifts with the live car same as MATCH.sheet did, freeze it too
    // BUG FIX (2026-09-03, Jett: "i go to restore the car to default upgrades... and the build
    // sheet changes????"). The parts/hardware list rendered by openSheet() was ALWAYS built from
    // the live MATCH.sheet, even when frozen -- only the deliverable (tuning tab) and the name
    // were actually pulled from this object. The instant the car's own parts changed (restoring
    // to stock to start the clone), fingerprint() reassigned MATCH to match the NEW state, and
    // MATCH.sheet followed it -- so the "FROZEN TARGET" badge kept showing, but the parts list
    // underneath silently tracked the live car instead of staying put. A true snapshot, not a
    // live reference: MATCH.sheet gets REASSIGNED (not mutated) by loadBuild(), so a reference
    // alone wouldn't survive that -- JSON round-trip to guarantee independence.
    sheet: JSON.parse(JSON.stringify(MATCH.sheet)),
  };
  viewSave(); paintPanel(); openSheet();
}
function frozenOf() { return CUR ? (vcar(CUR.ordinal).frozen || null) : null; }
function thawTarget() { if (CUR) { delete vcar(CUR.ordinal).frozen; viewSave(); paintPanel(); openSheet(); } }

function openSheet() {
  const fz = frozenOf();
  // BUG FIX (2026-09-03): `sheet` now prefers the frozen SNAPSHOT over the live MATCH.sheet
  // whenever one exists -- every reference below reads from this local, not from MATCH.sheet
  // directly, so the parts list actually stays frozen instead of just the badge saying so.
  const sheet = (fz && fz.sheet) || (MATCH && MATCH.sheet);
  if (!sheet) return;
  let el = document.getElementById("fhSheet");
  if (!el) {
    el = document.createElement("div"); el.id = "fhSheet"; el.className = "fsheet";
    document.body.appendChild(el);
  }
  const dl = (fz && fz.deliverable) || (CUR && CUR.disk && CUR.disk.deliverable) || null;
  const name = (fz && fz.name) || (MATCH.build && MATCH.build.name) || (CUR && CUR.disk && CUR.disk.name) || "";
  // BADGE = the TUNE this sheet shows, as ONE consistent (class, pi) pair -- never the live car's class
  // stapled to the tune's PI (Jett 2026-09-07: an A-class tune, whose own PI a locked download never
  // captured, read "S1 800" because the class came from CUR and the 800 from the tune/live). PI comes
  // from the frozen snapshot, else the tune's own observed CarPI (dl.summary.pi_total); the class is
  // DERIVED from that PI so the pair can never contradict. When neither is known the tune's PI is
  // genuinely unknown -- no badge (the live car's PI lives in the car header, not on the tune's sheet).
  const pi = (fz && fz.pi != null) ? fz.pi : (!fz && dl && dl.summary && dl.summary.pi_total != null ? dl.summary.pi_total : null);
  const cls = pi != null ? classForPi(pi) : (fz ? fz.cls : null);
  // 2026-09-03: when identity is unsettled, MATCH.build is just the first of N tied candidates
  // (fingerprint()'s `exact[0] || hw[0]`, live.js) -- a real, correctly-decoded build, but not
  // confirmed as the one actually on the car. This sheet used to open silently on that guess with
  // no indication it might be the wrong one of several; the header card already says so, this
  // drawer didn't.
  const q = !fz && typeof matchQuality === "function" ? matchQuality(CUR && CUR.match) : null;
  const unconfirmed = q && (q.level === "ambiguous" || q.level === "conflict");
  const key = (sheet.hw || "") + "|" + ((fz && fz.ts) || (CUR && CUR.disk && CUR.disk.ts) || "") + "|" + (dl ? 1 : 0) + "|" + (fz ? "F" : "");
  if (el.dataset.k === key && el.querySelector(".fbody")) { el.style.display = "block"; return; }   // same build, same save: just show it
  el.dataset.k = key;
  const st = vg("sheet", {});
  st.open = true; viewSave();
  if (st.x != null) { el.style.left = st.x + "px"; el.style.top = st.y + "px"; }
  el.classList.toggle("min", !!st.min);
  el.innerHTML = `<div class="fbar" id="fbar">${pi != null || cls ? piBadge(cls, pi, true) : ""}<span class="ttl">${fz ? "FROZEN TARGET" : "BUILD SHEET"}</span>
      <span class="nm">${esc(sheet.car || "")}${name ? " · " + esc(name) : ""}${fz ? ` <span class="froz">frozen ${esc(new Date(fz.at).toLocaleString())}${fz.creator ? " · by " + esc(fz.creator) : ""} — build back to this</span>` : ""}${unconfirmed ? ` <span class="chip w" title="identity isn't settled -- this shows one of ${(CUR && CUR.match && CUR.match.n_signature_ties) || "several"} equally-plausible saves, not a confirmed pick">⚠ unconfirmed pick</span>` : ""}</span>
      <button data-f="pin" class="${fz ? "on" : ""}" title="${fz ? "this sheet is your frozen target — click to release it" : "keep this sheet as your target: change the car freely and this stays as what to build back to"}">${fz ? "◆ TARGET" : "◇ keep as target"}</button>
      <button data-f="min" title="${st.min ? "expand" : "minimise"}">${st.min ? "▢" : "—"}</button>
      <button data-f="close" title="close">✕</button></div>
    <div class="fbody fhcl"><style>${scopedCloneCss()}</style>${flowDocHTML(sheet, dl, name)}</div>`;
  // 2026-09-03 (Jett: A/B between your OWN saved slider variations of the same hardware): when
  // this build is "variation" status, the base to diff against is already known -- buildStatus()
  // resolves it as MATCH.hw[0] with no pin step needed (see fh6-slider... plan). The diff needs
  // an async fetch, so it patches in as a second pass once ready; the synchronous render above
  // (no dots) is what shows immediately and what every other status keeps forever.
  if (!fz) {
    const bstat = buildStatus();
    if (bstat.key === "variation" && MATCH.hw && MATCH.hw.length) {
      const base = MATCH.hw[0];
      const baseTs = String(base.c || "").split("_").pop();
      if (baseTs) applyVariationDiff(el, key, base.o, baseTs, name);
    }
  }
  el.style.display = "block";
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

// The A/B diff needs a fetch (the base build's own deliverable), so it patches in as a second
// pass after openSheet()'s synchronous render. Guards on `key` (unchanged since DAEMON var,
// live.js) so a fast car-switch or re-open before this resolves can't stamp a stale diff onto
// the wrong sheet -- same staleness discipline as identify()'s IDENT_SEQ.
async function applyVariationDiff(el, key, baseOrdinal, baseTs, name) {
  let baseDl;
  try {
    const r = await fetch(DAEMON + "/disk-tune?ordinal=" + baseOrdinal + "&ts=" + baseTs);
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.available || !j.deliverable) return;
    baseDl = j.deliverable;
  } catch (e) { return; }
  if (el.dataset.k !== key || !MATCH || !MATCH.sheet) return;   // sheet moved on while we were fetching
  const dl = (frozenOf() && frozenOf().deliverable) || (CUR && CUR.disk && CUR.disk.deliverable) || null;
  if (!dl) return;
  const diff = diffSliderRows(baseDl.tabs, dl.tabs);
  const body = el.querySelector(".fbody");
  if (!body) return;
  body.innerHTML = `<style>${scopedCloneCss()}</style>${flowDocHTML(MATCH.sheet, dl, name, diff)}`;
}
