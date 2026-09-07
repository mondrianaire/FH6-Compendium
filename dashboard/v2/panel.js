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
let ROUTE = null;   // in a timed event with no learned course: the catalogued route the car is on (locateRouteInEvent)
let LOOP = null;    // the daemon's S/F-crossing identity {name,start} — authoritative in an event, matched to a route START (adoptLoop)
let BROWSE_PICK = null;            // Course Browser: the route id whose location+shape the left world map is zoomed to
let BROWSE_FILTER = "all";         // Course Browser mode chip: all | rivals | race | career | free
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
    steps: ["import the save and regenerate the dashboard data — one button, about 10 s"], rebuild: true };
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
    <div class="trace" id="trace"></div>
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
  BROWSE_FILTER = vg("browseFilter", "all"); BROWSE_PICK = vg("browsePick", null);
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
// (paintHeld, called from paintPanel). Amber/⏸, matching the held live-dot's own colour
// (addLiveDot's dimmed ring is already #e3b341) rather than inventing a second "paused" colour.
function heldSince() {
  return MENU_SINCE ? "since " + new Date(MENU_SINCE).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}
function paintHeld() {
  const held = !!LIVE.inMenu;
  [$("#trace"), $("#dock")].forEach((el) => { if (el) el.classList.toggle("held", held); });
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
    ${(() => { const sp = RB.last && RB.last.sessions_pending;
      return sp == null ? "" : dot(sp === 0, "sessions", sp === 0 ? "caught up" : sp + " unimported",
        sp === 0 ? "every driving session on disk is imported into the database"
                 : sp + " session" + (sp === 1 ? "" : "s") + " on disk have not been imported yet — corners/laps from them are not queryable until they are"); })()}
  </span>`;
  el.dataset.tone = tone;
  el.innerHTML = `<b>${esc(txt)}</b>${when ? `<span class="when">${esc(when)}</span>` : ""}${svc}`;
}

function paintPanel() {
  lastAction();
  paintHeader(); paintTrace(); paintBanner(); paintLeft(); paintRight(); paintDock(); paintFooter();
  paintHeld();
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
// PI-class colours, matching the .pib-<class> badges (styles.css). A context (non-foregrounded)
// speed-trace line is painted by the PI CLASS of the build that drove it, so PI-vs-speed reads at a
// glance across laps from different-class builds (Jett 2026-09-07). Unknown class falls back to --dim.
const PI_COLORS = { D: "#45c8f1", C: "#f0c530", B: "#f0862d", A: "#e5414e", S1: "#a468e8", S2: "#2f62e0", R: "#e83c9e", X: "#2fd05f" };
function piColor(cls) { return PI_COLORS[String(cls || "").toUpperCase()] || "var(--dim)"; }
// FH PI class bands (D<=500, C<=600, B<=700, A<=800, S1<=900, S2<=998, X>=999). Derives the class
// LETTER from a PI so a badge is never an impossible pair like "S1 800" (800 is A). R is a category,
// not a PI band, so it is never derived here -- it only appears when it comes from stored data.
function classForPi(p) { return p == null ? null : p <= 500 ? "D" : p <= 600 ? "C" : p <= 700 ? "B" : p <= 800 ? "A" : p <= 900 ? "S1" : p <= 998 ? "S2" : "X"; }
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
  const key = course ? JSON.stringify(["c", COURSE.key, vc0.filters, vc0.preset, vc0.ctx, [...(vc0.hidden || [])], TRACE_MODE, TRACE_ALL, CUR && CUR.cid, liveClass(), MODE.game, el.clientWidth, MODE.game === "event" ? LIVE.run.length : 0])
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
function paintedLine(pts, ch, w, mode, baseCol) {
  if (!pts.length) return "";
  let sc = null;
  if (mode === "speed") { const vs = pts.map((q) => q[1]); sc = { lo: Math.min(...vs), hi: Math.max(...vs) }; if (sc.hi - sc.lo < 1e-6) sc = null; }
  const keyOf = (q) => (mode === "speed" && sc) ? Math.max(0, Math.min(GRAD.length - 1, Math.floor(((q[1] - sc.lo) / (sc.hi - sc.lo)) * GRAD.length))) : (q[2] | 0);
  // "NO PROBLEMS" IS THE DEFAULT COLOUR (Jett 2026-09-07): in grip paint the within-grip segments
  // (k===0, nothing wrong) carry the build's PI class colour when one is given, so PI stays readable
  // even on a painted line -- the problem states (slip/impact) keep their diagnostic colours, and the
  // speed gradient is untouched (it has no no-problem baseline).
  const base0 = (baseCol && baseCol !== "var(--dim)") ? baseCol : TRACE_GRIP[0];   // unknown class -> keep the green within-grip
  const colOf = (k) => (mode === "speed" && sc) ? GRAD[k] : (k === 0 ? base0 : (TRACE_GRIP[k] || TRACE_GRIP[0]));
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
  // NEVER BLANK THE TRACE WHILE LAPS EXIST. traceSel() auto-defaults to "this class" on an event, but if you
  // are in a class you have never driven this course in, that preset is empty and the trace read "nothing to
  // draw" over N real recorded laps. When an AUTO-chosen preset hides every lap, fall back to "all" (a
  // deliberate user pick, sel.auto === false, is respected -- their empty filter stands with the widen hint).
  if (all.length && sel.auto !== false && sel.preset !== "all" && !all.some(presetTest(sel.preset))) sel.preset = "all";
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
// THE LIVE LAP, aligned to the course. LIVE.run's own x is the fake event odometer, which does NOT line up
// with the recorded laps' real arc-along-lap -- so map each live point's (px,pz) to the nearest point on a
// recorded reference lap and take ITS arc. Return the CURRENT lap only (points since the arc last wrapped
// past the S/F on a circuit), grip-coded like the recorded laps: [arc, mph, grip, px, pz]. null if too short.
function alignLiveToCourse(run, ref, c) {
  if (!ref || !(ref.pts || []).length || !(run || []).length) return null;
  const R = ref.pts, L = (c && c.len) || R[R.length - 1][0] || 1;
  const arcOf = (px, pz) => { let bd = Infinity, ba = 0; for (let i = 0; i < R.length; i++) { const dx = R[i][3] - px, dz = R[i][4] - pz, d = dx * dx + dz * dz; if (d < bd) { bd = d; ba = R[i][0]; } } return ba; };
  const mapped = run.map((q) => [arcOf(q[3], q[4]), q[1], q[2] | 0, q[3], q[4]]);
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
  const head = `<b>Speed trace</b><span class="why">${esc(c.name || c.key)} · ${match.length} of ${all.length} lap${all.length === 1 ? "" : "s"} on record${MODE.game === "event" ? " · timed event" : ""}</span>
    <span class="fdim"><span class="why">show</span>${presets}</span>${filt}${clearBtn}<span class="tspacer"></span><span class="tread why">hover: reads the point and marks the map</span>${modeControls()}`;
  if (!stage2.length) return { head, foot: `<span class="why">no lap on record matches — widen the preset or clear a filter</span>`, svg: () => `<div class="why tempty">nothing to draw</div>` };
  const L = Math.max(c.len || 0, ...stage2.map((t) => t.pts[t.pts.length - 1][0]));
  stage2.forEach((t) => { t._cov = t.cov != null ? t.cov : (L ? t.pts[t.pts.length - 1][0] / L : 1); });
  const best = match.find((t) => !notTimed(t)) || null;
  const mine = match.filter((t) => CUR && t.cid === CUR.cid);
  const cur = mine.find((t) => !notTimed(t)) || mine[0] || null;
  const fore = cur || best || match[0] || null;
  // THE ACTIVE (LIVE, in-progress) LAP: drawn on top, grip-painted, updating in real time as you drive it.
  const live = (MODE.game === "event") ? alignLiveToCourse(LIVE.run, fore, c) : null;
  const leg = stage2.slice(0, 12).map((t) => {
    const hid = sel.hidden.has(String(t.id));
    const nt = notTimed(t); const off = best && !nt && t !== best && t.t ? ((t.t / best.t - 1) * 100).toFixed(1) + "% off" : "";
    const col = t.void ? "#e3b341" : (t.partial || t._cov < 0.9) ? "var(--warn)" : t === cur ? "var(--acc2)" : t === best ? "#00d27a" : "var(--line2)";
    const what = t === cur ? "you" : t === best ? "fastest" : "";
    return `<button class="lchip ${hid ? "hid" : ""} ${t === cur ? "you" : t === best ? "best" : ""}" data-thide="${esc(String(t.id))}"
      style="--lc:${col}" title="${esc((hid ? "hidden — click to draw it" : "drawn — click to hide it") + " · " + (t.sid || "") + (t.container ? " · " + t.container : "") + (t.void ? " · time void: contact" : "") + (t.partial ? " · partial lap" : ""))}">
      <i class="lcd"></i><span class="lct">${nt ? `<s>${lapTime(t.t)}</s>` : lapTime(t.t)}</span>
      <span class="lcm">${what || off || (t.class ? esc(t.class) : "")}</span></button>`; }).join("");
  // in default mode the context lines are coloured by PI class -- show which classes are on the chart
  const clsPresent = [...new Set(match.map((t) => t.class).filter(Boolean))];
  const piLeg = (!TRACE_ALL && clsPresent.length) ? `<span class="lchips pileg" title="context lines are coloured by the PI class of the build that drove each lap">${clsPresent.map((k) => `<span class="lchip key" style="border-color:${piColor(k)};background:${piColor(k)}22"><i style="background:${piColor(k)}"></i>${esc(k)}</span>`).join("")}</span>` : "";
  const foot = `${piLeg}<span class="lchips">${live ? `<span class="lchip livenow" title="the lap you are driving now — painted live by grip"><i></i>● LIVE lap</span>` : ""}${leg}</span>`;
  TRACE_FIT = stage2.length;
  // publish the selection so the LEFT PANE draws the same laps and the two panes agree
  const sel2 = { key: c.key, ids: match.map((t) => String(t.id)), fore: fore ? String(fore.id) : null };
  if (JSON.stringify(sel2) !== JSON.stringify(TRACE_PICK)) { TRACE_PICK = sel2; LEFT_KEY = null; setTimeout(paintLeft, 0); }
  const svg = (W, H) => {
    if (!match.length) return `<div class="why tempty">every matching lap is hidden — click a chip to show it</div>`;
    const smax = L, vmax = Math.max(...match.flatMap((t) => t.pts.map((q) => q[1]))) * 1.06 || 1;
    const ch = chart(W, H, 28, 16, smax, vmax);
    // default (non-"every run") context lines paint by the build's PI class, best emphasised by weight/opacity
    const lines = match.map((t) => t === cur ? "" : (TRACE_ALL ? paintedLine(t.pts, ch, t === best ? 1.4 : 0.9, TRACE_MODE, piColor(t.class)) : plainLine(t.pts, ch, piColor(t.class), t === best ? 1.8 : 1, t === best ? 0.95 : 0.5, notTimed(t)))).join("")
      + (cur ? paintedLine(cur.pts, ch, 2.4, TRACE_MODE, piColor(cur.class)) : "");
    const ticks = (c.turns || []).filter((t) => t.s != null).map((t) => `<line x1="${ch.px(t.s).toFixed(1)}" y1="6" x2="${ch.px(t.s).toFixed(1)}" y2="${H - 16}" stroke="var(--line2)" opacity=".7"/><text x="${ch.px(t.s).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--dim)">${esc(t.id)}</text>`).join("");
    const imp = impactMarks(fore.pts).map((q, i) => `<g><title>impact ${i + 1} at ${Math.round(q[0])} m</title><line x1="${ch.px(q[0]).toFixed(1)}" y1="6" x2="${ch.px(q[0]).toFixed(1)}" y2="${H - 16}" stroke="#e3b341" stroke-dasharray="2 2" opacity=".6"/><circle cx="${ch.px(q[0]).toFixed(1)}" cy="${ch.py(q[1]).toFixed(1)}" r="3" fill="#e3b341"/></g>`).join("");
    const pts = fore.pts.map((q) => [q[0], q[1], q[2], q[3], q[4]]);
    // THE ACTIVE LAP, on top and unmistakable: a soft accent glow under the grip-painted line, thicker than
    // any recorded lap, with a pulsing dot at the car's current position -- so the live one reads as live.
    const lp = live && live[live.length - 1];
    const liveSvg = live ? `<g class="livelap">
      <polyline fill="none" stroke="var(--acc2)" stroke-width="6.5" stroke-linejoin="round" stroke-linecap="round" opacity=".22" points="${live.map((q) => ch.px(q[0]).toFixed(1) + "," + ch.py(q[1]).toFixed(1)).join(" ")}"/>
      ${paintedLine(live, ch, 3.2, TRACE_MODE, piColor(CUR && CUR.cls))}
      <circle cx="${ch.px(lp[0]).toFixed(1)}" cy="${ch.py(lp[1]).toFixed(1)}" r="4.5" fill="var(--acc2)" stroke="#04101c" stroke-width="1.4"><animate attributeName="r" values="4.5;6.8;4.5" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;.5;1" dur="1.1s" repeatCount="indefinite"/></circle></g>` : "";
    return `<svg class="tsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-smax="${smax}" data-vmax="${vmax}" data-padl="28" data-padb="16" data-w="${W}" data-h="${H}" data-pts="${esc(JSON.stringify(pts))}">${axisSvg(ch, vmax)}${ticks}${lines}${imp}${liveSvg}${cursorSvg(H)}</svg>`;
  };
  return { head, foot, svg, hasData: match.length > 0 };
}

function liveRun() {
  const pts = LIVE.run;
  const head = `<b>Speed trace</b><span class="why">${pts.length && (pts[pts.length - 1][0] || 0) <= 50 ? "parked — the trace draws once the car moves" : "live run · the last " + (pts.length ? Math.round(pts.length / 10) : 0) + " s"}${MODE.suggest === "course" && COURSE ? ` · no lap on record for ${esc(COURSE.name || COURSE.key)} yet` : ""}</span><span class="tspacer"></span>${modeControls()}`;
  // 2026-09-03 (Jett): the legend named every grip state but never said which one you're IN right
  // now -- LIVE.run's own last point already carries it (runSample() pushes [dist,mph,g,...]).
  const curG = pts.length ? pts[pts.length - 1][2] : null;
  const pc = piColor(CUR && CUR.cls); const g0 = (pc && pc !== "var(--dim)") ? pc : TRACE_GRIP[0];   // the within-grip swatch shows the PI colour it now paints
  const foot = `<span class="lchips grip">${TRACE_GRIP.map((c0, i) => { const c = i === 0 ? g0 : c0; return `<span class="lchip key${curG === i ? " on" : ""}" style="border-color:${c}${curG === i ? `;background:${c}22` : ""}"><i style="background:${c}"></i>${TRACE_WORD[i]}</span>`; }).join("")}</span>`;
  const svg = (W, H) => {
    if (pts.length < 3) return `<div class="why tempty">drive — speed against distance draws here as you go, painted by what the tyres are doing</div>`;
    const smax = pts[pts.length - 1][0] || 1, vmax = Math.max(60, ...pts.map((q) => q[1])) * 1.06;
    const ch = chart(W, H, 28, 16, smax, vmax);
    const km = [...Array(Math.floor(smax / 500)).keys()].map((i) => (i + 1) * 500).map((d) => `<line x1="${ch.px(d).toFixed(1)}" y1="6" x2="${ch.px(d).toFixed(1)}" y2="${H - 16}" stroke="var(--line)" opacity=".6"/><text x="${ch.px(d).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--dim)">${d / 1000} km</text>`).join("");
    return `<svg class="tsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-smax="${smax}" data-vmax="${vmax}" data-padl="28" data-padb="16" data-w="${W}" data-h="${H}" data-pts="${esc(JSON.stringify(pts.map((q) => [q[0], q[1], q[2], q[3], q[4]])))}">${axisSvg(ch, vmax)}${km}${paintedLine(pts, ch, 2.2, TRACE_MODE, piColor(CUR && CUR.cls))}${cursorSvg(H)}</svg>`;
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
function resolutionState() {
  const st = buildStatus();
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
    hint = `cid matches ${mm.n_signature_ties || tunes || "several"} saved builds — pick the tune below, or drive the gears to separate them`;
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
// this state affords. Returns {tone, ident, detail, sheet, sheetSub, verdict}. `sheet` grades the
// trailing Build Sheet cell -- "filled" (it IS the primary, downloaded), "outline" (reachable, open
// shackle), "dead" (refused, shut shackle). `verdict` is set only for the two severe states that
// promote a finding to a 21px line. The middle action cell is c.primary / c.noBtn from headerCopy().
function gateStrip(st, rs) {
  const ch = CHANGE || {}, nSl = (ch.sliders || []).length, nPa = (ch.slots || []).length;
  if (!CUR || rs.key === "none") return { tone: "dim", ident: "—", detail: "waiting for a car", sheet: "dead", sheetSub: "no car" };
  if (st.key === "offline") return { tone: "dim", ident: "◌ NOT LIVE", detail: "last thing seen", sheet: "dead", sheetSub: "daemon down" };
  if (rs.key === "ambiguous") {
    const mm = (CUR && CUR.match) || {}; const ties = mm.n_signature_ties || rs.tunes || 0;
    return { tone: "warn", ident: "! NOT IDENTIFIED", detail: ties ? ties + " saves tie" : "several saves tie",
      sheet: "dead", sheetSub: "needs one save", verdict: (CUR.match && matchQuality(CUR.match).level === "conflict") ? "IDENTITY CONTRADICTED" : "" };
  }
  if (st.key === "variation") return { tone: "acc", ident: "✓ IDENTIFIED", detail: "base + " + nSl + " slider" + (nSl === 1 ? "" : "s"), sheet: "outline" };
  if (st.key === "clone") return { tone: "acc", ident: "✓ IDENTIFIED", detail: "identical, unlocked", sheet: "outline" };
  if (rs.key === "unsaved") {   // truly unsaved: hardware changed / no match, nothing on disk
    if (rs.locked) return { tone: "warn", ident: "◷ IMPORTING", detail: "history catching up", sheet: "dead", sheetSub: "importing" };
    const d = [nSl ? nSl + " slider" + (nSl === 1 ? "" : "s") + " moved" : "", nPa ? nPa + " part" + (nPa === 1 ? "" : "s") + " changed" : ""].filter(Boolean).join(" · ") || "no save on disk";
    return { tone: "bad", ident: "✗ NOTHING ON DISK", detail: d, sheet: "dead", sheetSub: "needs a save", verdict: "NOT SAVED — NOTHING CAN BE COMPARED" };
  }
  // resolved
  const tree = (rs.hwN || 1) + " hw · " + (rs.tunes || 1) + " tune" + ((rs.tunes || 1) === 1 ? "" : "s");
  if (st.key === "ratified") {
    const m = MATCH && MATCH.build, laps = (m && m.laps) || 0, courses = (m && m.courses) || 0;
    return { tone: "acc", ident: "✓ IDENTIFIED", detail: laps ? laps + " lap" + (laps === 1 ? "" : "s") + (courses ? " · " + courses + " course" + (courses === 1 ? "" : "s") : "") : tree, sheet: "outline" };
  }
  return { tone: "acc", ident: "✓ IDENTIFIED", detail: tree, sheet: "filled" };   // downloaded / locked
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
  const k = CHANGE.kind;
  const label = CHANGE.saved ? "new save read" : k === "hardware" ? "hardware changed"
    : k === "tune" ? ((CHANGE.sliders || []).length + " slider" + ((CHANGE.sliders || []).length === 1 ? "" : "s") + " moved")
    : k === "same" ? "re-saved" : "changed";
  const tone = CHANGE.saved ? "on" : k === "hardware" ? "r" : "b";
  return `<button class="hchg ${tone}${CHG_OPEN ? " open" : ""}" data-act="chg" title="${CHG_OPEN ? "hide" : "show"} the details below">● ${esc(label)}</button>`;
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
function headerCopy(st, q) {
  const m = MATCH && MATCH.build;
  const mm = (CUR && CUR.match) || {};
  const tune = (m && m.name) || (CUR && CUR.disk && CUR.disk.name) || "";
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
  const byline = [m && m.creator ? "by " + m.creator : "", m && m.created ? when(m.created) : ""].filter(Boolean).join(" · ");
  const base = { tone: "dim", lead: "", sub: "", tune, car, status: st.label || "", byline, why: st.why || "", step: (st.steps || [])[0] || "",
                 rest: (st.steps || []).slice(1), primary: null, noBtn: "", caption: "", evidence: "" };

  // AMBIGUITY OVERRIDES EVERY STATUS: which build is on the car outranks what kind of build it is
  if (q && (q.level === "ambiguous" || q.level === "conflict")) {
    const ties = mm.n_signature_ties || 0;
    // 2026-09-03 (Jett flagged this reading "wild"): the headline used to say "ONE OF 8" right
    // above a sub-line saying "7 of 8 tie" — two different numbers about the same 8 saves, never
    // reconciled. Dropped the count from the headline entirely; sub (q.why) is the one place the
    // count is stated now. `why` used to restate sub in different words ("the live packet carries
    // only cylinders...") -- same three facts, twice, in two boxes on one card. Replaced with what
    // sub does NOT say: what happens next.
    return Object.assign(base, { tone: "warn",
      lead: q.level === "conflict" ? "IDENTITY CONTRADICTED" : "IDENTITY NOT SETTLED",
      sub: q.why, why: "the live telemetry alone can't separate them — cylinders, drivetrain and PI are all it carries",
      step: ties > 1 ? "pick the save below — it may also settle on its own as you keep driving" : "pick the save that is on the car",
      rest: [], primary: { label: "PICK THE SAVE ▸", act: "pick" }, caption: "identity unsettled",
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
  // THE BAND (header handoff §2–§4): render washed across the whole band behind a scrim; identity on
  // the left (470), the hardware→tune hash table on the right (1fr), and one gate strip pairing the
  // identity we have with the single action this state affords. The spectrum/marker fly-in is retired.
  const rs = resolutionState();
  const g = gateStrip(st, rs);
  const FILL = { pick: "acc2", sheet: "warn", ab: "acc2", base: "acc", rebuild: "acc2", copycmd: "line2" };
  const fill = c.primary ? (FILL[c.primary.act] || "acc") : null;
  const reach = !!(MATCH && MATCH.build);
  const resolved = rs.key === "resolved";
  const busy = RR.busy || RB.state === "running" || RB.pending;
  h.innerHTML = `
    ${img ? `<div class="hwash" style="background-image:url('${img}')"></div>` : ""}
    <div class="hscrim"></div>
    <button class="icobtn hreload" id="btnRefresh" ${busy ? "disabled" : ""}
      title="re-read this car's save from disk, and import it if the database does not hold it — both happen by themselves; this is the manual override.">${busy ? "…" : "⟳"}</button>
    <div class="hident">
      <div class="hident-hd">
        ${CUR ? `<span class="hpi">${piBadge(CUR.cls, CUR.pi)}</span>` : ""}
        ${rs.locked ? `<span class="hlock t-l">🔒 ${esc(c.caption || "locked")}</span>` : (c.caption ? `<span class="hcap t-l">${esc(c.caption)}</span>` : "")}
        ${changeSlim()}
      </div>
      <div class="hcar t-d" title="${esc(c.car)}${c.byline ? " — " + esc(c.byline) : ""}">${esc(shedName(c.car, 30))}</div>
      <div class="htitle t-t" title="${esc(c.tune || "")}">${c.tune ? `${resolved ? `<b class="tick">✓</b> ` : ""}${esc(shedName(c.tune, 40))}` : `<span class="t-l empty">no save on disk for this car</span>`}</div>
      ${g.verdict ? `<div class="hverdict">${esc(g.verdict)}</div>` : ""}
      <div class="hgate">
        <div class="gcell gstate" data-tone="${g.tone}"><b>${esc(g.ident)}</b><span>${esc(g.detail)}</span></div>
        <span class="garrow" data-w="${(g.tone === "bad" || g.tone === "warn" || g.sheet === "dead") ? "weak" : "strong"}"></span>
        ${g.sheet === "filled" ? "" : (c.primary
          ? `<button class="gprim" id="btnPrim" data-act="${esc(c.primary.act)}" data-fill="${fill}">${esc(c.primary.label)}</button>`
          : `<div class="ginstr t-b">${esc(c.step || c.noBtn || "")}</div>`)}
        ${g.sheet === "filled"
          ? `<button class="gsheet filled" id="btnSheet">🔓 BUILD SHEET ▸<em>unlocks this build</em></button>`
          : g.sheet === "outline" && reach
            ? `<button class="gsheet outline" id="btnSheet">🔓 BUILD SHEET ▸<em>the full sheet</em></button>`
            : `<div class="gsheet dead">🔒 BUILD SHEET<em>${esc(g.sheetSub || "needs a save")}</em></div>`}
      </div>
    </div>
    <div class="hev">
      ${hashTableHTML()}
      <div class="hev-ev"><span class="t-l">evidence</span><span class="t-b">${esc(c.evidence || (q.level === "ok" ? q.why : "") || "—")}</span></div>
    </div>`;

  // the two-tier group: pick an upgrade (shows its tunes), or pick a tune (identifies it — reverse
  // direction, keyed on the file's hashes, not the gear ladder)
  h.querySelectorAll('.hth-hw[data-act="upg"]').forEach((b) => b.onclick = () => { UPG_SEL = b.dataset.hw; HDR_KEY = null; paintHeader(); });
  h.querySelectorAll('.hth-tune[data-act="tune"]').forEach((b) => b.onclick = () => {
    const ts = b.dataset.ts; if (!ts || !CUR) return;
    setPin(CUR.ordinal, ts);
    identify({ id: CUR.cid, ordinal: CUR.ordinal, name: CUR.name, class: CUR.cls, pi: CUR.pi, drivetrain: CUR.dt, cyl: CUR.cyl }, "pinned");
  });
  const hc = h.querySelector('.hchg[data-act="chg"]'); if (hc) hc.onclick = () => { CHG_OPEN = !CHG_OPEN; HDR_KEY = null; paintHeader(); paintBanner(); };
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
function paintTicker() {
  const el = $("#ticker"); if (!el) return;
  const st = buildStatus(), q = matchQuality(CUR && CUR.match), ch = CHANGE || {};
  const items = [];
  // --- alerts (urgent first) ---
  if (CHANGE) {
    const ns = (ch.sliders || []).length, np = (ch.slots || []).length;
    if (ch.saved) items.push(["ok", "SAVED", "new save read from disk"]);
    else if (ch.kind === "hardware") items.push(["bad", "HARDWARE CHANGED", `${np} part${np === 1 ? "" : "s"} · ${ns} slider${ns === 1 ? "" : "s"} — not saved`]);
    else if (ch.kind === "tune") items.push(["warn", "SLIDERS MOVED", `${ns} slider${ns === 1 ? "" : "s"} changed, same hardware`]);
  }
  if (CUR && CUR.disk && (q.level === "ambiguous" || q.level === "conflict")) {
    const ties = ((CUR && CUR.match) || {}).n_signature_ties || 0;
    items.push(["warn", q.level === "conflict" ? "IDENTITY CONTRADICTED" : "IDENTITY NOT SETTLED", `${ties || "several"} saves tie — pick the save in the header`]);
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
  paintTicker();
  const al = $("#alerts"); if (!al) return;
  const q = matchQuality(CUR && CUR.match);
  const show = CUR && CUR.disk && (q.level === "ambiguous" || q.level === "conflict");
  al.innerHTML = show ? savePicker() : "";
  al.classList.toggle("empty", !show);
  if (show) wirePicker();
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
  const key = JSON.stringify([!!course, course && COURSE.key, WORLD && Object.keys(WORLD.routes).length, MODE.suggest, TRACE_PICK && TRACE_PICK.ids && TRACE_PICK.ids.length, TRACE_PICK && TRACE_PICK.fore, ROUTE && ROUTE.id, MODE.game]);
  if (key === LEFT_KEY && body.querySelector("svg")) { addLiveDot(body); return; }
  LEFT_KEY = key; FOLLOW.span = null; FOLLOW.full = null;
  if (course) {
    const nSel = (TRACE_PICK && TRACE_PICK.key === COURSE.key && TRACE_PICK.ids) ? TRACE_PICK.ids.length : Object.keys(COURSE.traces || {}).length;
    // the track OWNS this pane's title once it is identified: its name, its badge, then the facts
    const named = !!COURSE.name;
    const kind = COURSE.rivals ? "RIVALS" : MODE.game === "event" ? "EVENT" : null;
    hd.innerHTML = `<b class="trackname">${esc(named ? COURSE.name : "unnamed course " + COURSE.key)}</b>
      ${nameChip(COURSE.naming)}
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
    // COURSE VIEW IS STATIC: no follow-preview zoom here (Jett 2026-09-06). courseMap() fits the whole course
    // to the pane; the adaptive zoom stays a free-view-only tool, so a course reads as one stable shape.
    body.insertAdjacentHTML("beforeend", mapDrawerHTML(`<div class="legend">${legendHTML}</div>${mapFilterBar(COURSE)}`));
    wireTrace(body); wireMapDrawer(body); addLiveDot(body);
  } else {
    paintLeftHeader();
    body.innerHTML = worldMapHTML();
    const mapSvg = body.querySelector("svg[data-x0]");
    if (mapSvg) { mapAttach(mapSvg); const g = mapSvg.querySelector("#browseHi"); if (g && BROWSE_PICK) g.innerHTML = browseHiSVG(mapSvg, BROWSE_PICK); }
    addLiveDot(body);
    wireFollow(body); wireMapDrawer(body);
  }
}
// Just the left pane's TITLE (free-mode: browsing a course / on a route / the world) — updated on a browser pick
// without rebuilding the map, so the viewBox animation is never interrupted. Course mode owns its own title.
function paintLeftHeader() {
  const hd = $("#leftHd"); if (!hd || (MODE.suggest === "course" && COURSE)) return;
  const onN = WORLD ? routeSplit().on.length : 0;   // on-island routes; the two off-map test circuits are ignored
  const bp = BROWSE_PICK && WORLD && WORLD.routes[BROWSE_PICK];
  if (bp) hd.innerHTML = `<b class="trackname">${esc(bp.name || "Route " + BROWSE_PICK)}</b> <span class="chip w">BROWSING</span> <span class="why">${n0(bp.len)} m${bp.loop ? " · loop" : " · P2P"}${bp.is_race ? " · race event" : ""}${(bp.modes || []).length ? " · " + bp.modes.join(", ") : ""} · click the tile again to clear</span>`;
  else if (ROUTE) hd.innerHTML = `<b class="trackname">${esc(ROUTE.name)}</b> <span class="chip w">${MODE.game === "event" ? "EVENT · CATALOGUED" : "ROUTE"}</span> <span class="why">${n0(ROUTE.len)} m${ROUTE.loop ? " · loop" : ""} · the game's route, no laps recorded here yet${ROUTE.alsoName ? ` · shares road with ${esc(ROUTE.alsoName)}` : ""}</span>`;
  else hd.innerHTML = `World · <span class="why">${WORLD ? onN + " routes on the island" : "loading"} · free roam${MODE.suggest === "course" ? " (course not located)" : ""}</span>`;
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
  const line = (pts, col, w, op) => splitTP(pts).map((run) => `<polyline fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}" stroke-linejoin="round" points="${run.map(([x, z]) => px(x).toFixed(0) + "," + pz(z).toFixed(0)).join(" ")}"/>`).join("");
  const routes = on.map(({ r }) => line(r.pts, "#3b4a5c", 1.2, 0.9)).join("");
  const mine = Object.values(WORLD.courses || {}).filter((c) => c.path && c.path.length > 3)
    .map((c) => line(c.path, "#00d27a", 1.6, 0.85)).join("");
  // in an event, the catalogued route the car is on, drawn bright over the rest so the map is legible
  const hi = (ROUTE && WORLD.routes[ROUTE.id] && (WORLD.routes[ROUTE.id].pts || []).length > 1)
    ? line(WORLD.routes[ROUTE.id].pts, "#e3b341", 2.8, 1) : "";
  // no follow toggle here: following is course-only (see followSpan()) -- offering it on the
  // world map invited turning on a satnav zoom that could only ever collapse the island view.
  const legend = `<span><i style="background:#3b4a5c"></i>every game route</span>
      <span><i style="background:#00d27a"></i>roads you have driven</span><span><i style="background:#e3b341"></i>you, now</span>`;
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
  const poly = splitTP(P).map((run) => `<polyline fill="none" stroke="#ffcf4d" stroke-width="3" opacity="1" stroke-linejoin="round" points="${run.map(([x, z]) => p.px(x).toFixed(0) + "," + p.pz(z).toFixed(0)).join(" ")}"/>`).join("");
  const mk = (r.spawn ? `<circle cx="${p.px(r.spawn[0]).toFixed(0)}" cy="${p.pz(r.spawn[1]).toFixed(0)}" r="6" fill="none" stroke="#c792ea" stroke-width="2.2"/>` : "")
    + `<circle cx="${p.px(P[P.length - 1][0]).toFixed(0)}" cy="${p.pz(P[P.length - 1][1]).toFixed(0)}" r="5" fill="#ff5d7d" stroke="#0f1720" stroke-width="1.5"/>`
    + `<circle cx="${p.px(P[0][0]).toFixed(0)}" cy="${p.pz(P[0][1]).toFixed(0)}" r="5" fill="#33d17a" stroke="#0f1720" stroke-width="1.5"/>`;
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
// pick a course from the browser: highlight it + glide the map to it; pick again (BROWSE_PICK null) glides back
function browsePick(id) {
  BROWSE_PICK = (BROWSE_PICK === id) ? null : id;
  VIEW.global.browsePick = BROWSE_PICK; viewSave();
  const svg = MAPVIEW.svg;
  if (svg) { const g = svg.querySelector("#browseHi"); if (g) g.innerHTML = BROWSE_PICK ? browseHiSVG(svg, BROWSE_PICK) : ""; }
  mapRetarget(true);
  paintLeftHeader();                 // just the title — not a full re-render, so the animation is never interrupted
  paintRight();                      // reflect the selected tile
}

/* ------------------------------------------------- Course Browser (free-mode right tab)
   Every known route as a shape tile; pick one and the left world map zooms to its location.
   Filter chips separate the modes we identified (a route is used by rivals AND/OR career events;
   `race` is the ones with a world activation sphere) without double-listing, since most courses
   support several modes at once. */
const BROWSE_CHIPS = [["all", "All"], ["rivals", "Rivals"], ["race", "Race"], ["career", "Career"], ["free", "Free-roam"]];
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
  const rows = Object.entries(WORLD.routes).map(([id, r]) => ({ id, r })).filter(({ r }) => r.name || r.laps);
  const count = (f) => rows.filter(({ r }) => browseMatch(r, f)).length;
  const chips = BROWSE_CHIPS.map(([f, lbl]) =>
    `<button class="bchip ${BROWSE_FILTER === f ? "on" : ""}" data-bfilter="${f}">${lbl} <em>${count(f)}</em></button>`).join("");
  const sel = rows.filter(({ r }) => browseMatch(r, BROWSE_FILTER))
    .sort((a, b) => (a.r.name ? 0 : 1) - (b.r.name ? 0 : 1) || (a.r.name || "").localeCompare(b.r.name || "") || (a.id - b.id));
  const tiles = sel.map(({ id, r }) => {
    const nm = r.name || ("Route " + id);
    const laps = r.laps || 0, sess = r.sessions || 0;
    const data = laps ? `<span class="tdata">${laps} lap${laps === 1 ? "" : "s"} · ${sess} run${sess === 1 ? "" : "s"}</span>`
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
    <div class="tiles">${tiles || `<div class="why">no courses in this filter</div>`}</div>`;
}
function wireBrowser(body) {
  body.querySelectorAll("[data-bfilter]").forEach((b) => b.onclick = () => {
    BROWSE_FILTER = b.dataset.bfilter; VIEW.global.browseFilter = BROWSE_FILTER; viewSave(); paintRight(); });
  body.querySelectorAll("[data-bpick]").forEach((b) => b.onclick = () => browsePick(b.dataset.bpick));
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
function followMap() {
  FOLLOW.raf = 0;
  const body = $("#leftBody"), svg = body && body.querySelector("svg");
  if (!svg || svg.dataset.x0 == null) return;
  const sc = +svg.dataset.s, H = +svg.dataset.h, pad = +svg.dataset.pad;
  const W = +svg.dataset.w || svg.viewBox.baseVal.width || 900;
  if (!FOLLOW.full) FOLLOW.full = { w: W, h: H };
  // Present-only (never write viewBox) when the user has not opted into follow (MAPVIEW owns it -- the flicker
  // fix) OR when this is the live COURSE view, which is deliberately static: courseMap fits the whole course and
  // the follow-preview zoom is a free-view-only tool now, so a persisted FOLLOW.on cannot zoom a course map.
  if (!FOLLOW.on || (MODE.suggest === "course" && COURSE)) {
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
  const svg = body.querySelector("svg"); if (!svg || !LIVEPOS) return;
  let g = svg.querySelector("#liveDot");
  // v1-style (2026-09-03): the dot element is created ONCE and MOVED via a transform on every
  // update, never rebuilt -- rewriting innerHTML every frame (the old approach) replaces the
  // circle with a brand-new element each time, which is exactly why a CSS transition could never
  // have worked before even if one had been added: there was never the same element around long
  // enough to transition. Two pre-built circles (solid / held) are toggled by display instead of
  // being re-created, matching app.js's updCarDot (~line 3283-3298).
  if (!g) {
    g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.id = "liveDot";
    g.innerHTML = `<circle class="ld-solid" r="5" fill="#e3b341" stroke="#000" stroke-width="1"/>` +
      `<circle class="ld-held" r="5" fill="none" stroke="#e3b341" stroke-width="1.5" opacity=".7" style="display:none">` +
      `<title>last known position — held through the menu / loading screen</title></circle>`;
    svg.appendChild(g);
  }
  const x0 = +svg.dataset.x0, z0 = +svg.dataset.z0, s = +svg.dataset.s, H = +svg.dataset.h, pad = +svg.dataset.pad;
  if (!isFinite(s)) return;
  const cx = pad + (LIVEPOS[0] - x0) * s, cy = H - pad - (LIVEPOS[1] - z0) * s;
  const held = !!LIVE.posHeld;      // no driving frame right now: the last real position, dimmed and hollow
  queueFollow();
  // POSITION BEFORE FIRST PAINT (matches app.js:3290-3297): a freshly-created/rebuilt map's dot
  // has no transform attribute yet, so this placement has nothing to transition FROM -- flushing
  // layout here (once, only on first placement) commits it instantly instead of letting the
  // transition animate in from the SVG's origin corner.
  const firstPlace = !g.hasAttribute("transform");
  g.setAttribute("transform", `translate(${cx.toFixed(1)},${cy.toFixed(1)})`);
  if (firstPlace) void g.getBoundingClientRect();
  const solid = g.querySelector(".ld-solid"), heldC = g.querySelector(".ld-held");
  if (solid) solid.style.display = held ? "none" : "";
  if (heldC) heldC.style.display = held ? "" : "none";
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
    const d = segNear(r.pts);
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
    const other = hits.find((h) => h.id !== best.id && h.dist <= best.dist + 25);
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
const RT_LABEL = { corners: "Live corners", matrix: "Turn analysis", stats: "General statistics", concl: "Conclusions", build: "Build data", browser: "Course Browser" };
// "build" (Build Data) disabled for free mode 2026-09-03 (Jett: "does not seem immediately useful
// to me") -- NOT deleted, RT_LABEL.build and its render path are untouched, just dropped from the
// list this function returns. Add "build" back to the free-mode array below to re-enable it.
function rightTabs() { return (MODE.suggest === "course" && COURSE) ? ["corners", "matrix", "stats", "concl"] : ["corners", "stats", "browser"]; }
function rightContext() {
  const course = MODE.suggest === "course" && COURSE;
  if (LIVE.inMenu || !LIVE.frame) return "stats";   // "build" was the free-mode fallback here; disabled alongside the tab (2026-09-03)
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
  const why = { corners: "every corner as you take it · newest first", matrix: "one row per course turn · this session",
                stats: "world-wide · ranked by frequency × impact · free roam needs more samples",
                concl: "this course's turns · what to change", build: "what the save gives, what a drive still has to provide",
                browser: "every known course · pick one to locate it on the map" }[cur];
  hd.innerHTML = `<span class="tabs2">${tabs.map((t) => `<button class="${cur === t ? "on" : ""}" data-rt="${t}">${RT_LABEL[t]}</button>`).join("")}</span><span class="why">${esc(why)}</span>`;
  hd.querySelectorAll("[data-rt]").forEach((b) => b.onclick = () => { RIGHT_TAB = b.dataset.rt; rightTabStore()[ctx] = RIGHT_TAB; viewSave(); paintRight(); });
  body.innerHTML = cur === "corners" ? cornersHTML() : cur === "matrix" ? matrixHTML() : cur === "concl" ? conclusionsHTML() : cur === "build" ? buildDataHTML() : cur === "browser" ? browserHTML() : statsHTML();
  body.querySelectorAll('[data-act="rebuild"]').forEach((b) => b.onclick = () => requestRebuild("manual"));
  if (cur === "browser") wireBrowser(body);
  if (cur !== "matrix" && cur !== "browser") fitRows(body, cur === "corners" ? "corners" : cur === "build" ? "rows" : "findings", 1);
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
const PH_SHORT = ["Braking", "Turn-in", "Mid-corner", "Exit"];
function phaseBars(ph) {
  return `<span style="display:inline-flex;gap:2px">${(ph || []).map((p) => {
    // a fully-zeroed phase (front:0,rear:0,red:"none",dur:0 — mostly phase 1, ~0.2% of real phase-slots
    // when the corner opened right after the per-second sample buffer reset) renders as an empty bar,
    // correctly — it is a real zero-slip reading, not a missing one, so it is never skipped.
    const fr = Math.min(1, (p.front || 0) / 1.5), rr = Math.min(1, (p.rear || 0) / 1.5);
    const col = p.red === "front" ? "#2f81f7" : p.red === "rear" ? "#e5414e" : p.red === "both" ? "#a371f7" : "#3a4250";
    return `<span title="phase ${p.phase} (${PH_SHORT[p.phase - 1] || ""}): front ${p.front} · rear ${p.rear}"
      style="display:inline-block;width:14px;height:14px;border-radius:2px;border:1px solid ${col};position:relative;background:var(--bg)">
      <i style="position:absolute;left:0;bottom:0;width:50%;height:${Math.round(fr * 100)}%;background:#2f81f7;opacity:${p.front > 1 ? 1 : .4}"></i>
      <i style="position:absolute;right:0;bottom:0;width:50%;height:${Math.round(rr * 100)}%;background:#e5414e;opacity:${p.rear > 1 ? 1 : .4}"></i></span>`;
  }).join("")}</span>`;
}

function matrixHTML() {
  const cid = CUR && CUR.cid;
  const log = (LIVE.corners || []).filter((c) => !cid || c.car === cid);
  if (!COURSE || !(COURSE.turns || []).length) return `<div class="why">no turn map for this course yet</div>`;
  if (!log.length) return `<div class="why">start driving — the matrix fills in one row per turn as you take it</div>`;

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
      const dcol = r.dom === "front" ? "#2f81f7" : r.dom === "rear" ? "#e5414e" : "var(--muted)";
      return `<tr style="${r.taken ? "" : "opacity:.4"}${r.anyAmbiguous ? ";outline:1px dashed var(--w)" : ""}">
        <td><b>${esc(r.t.id)}</b>${r.t.kind ? " " + esc(r.t.kind) : ""}${r.anyAmbiguous ? ` <span title="nearest of 2 turns within range — some passes here could belong to a neighboring turn">⚠</span>` : ""}</td>
        <td class="mono" style="text-align:center">${r.taken || "—"}</td>
        <td class="mono" style="text-align:center">${r.mph ?? "—"}</td>
        <td class="mono" style="text-align:center">${r.lat ?? "—"}</td>
        <td style="text-align:center">${r.usi != null ? `<span style="color:${g.col === DGRIP.calm.col ? "var(--acc)" : g.col}">${r.usi > 0 ? "+" : ""}${r.usi.toFixed(2)}</span>` : "—"}</td>
        <td style="text-align:center">${r.taken ? `<span style="color:${dcol};font-weight:700">${r.dom || "clean"}</span> <span class="why">${r.fr.front}/${r.fr.rear}/${r.fr.none}</span>` : "—"}</td>
        <td class="mono">${r.last ? `${r.last.mph_in}→<b>${r.last.mph_min}</b>→${r.last.mph_out ?? "—"} ${phaseBars(r.last.phases)}` : "—"}</td>
      </tr>`;
    }).join("")}
  </tbody></table></div>`;
  return head + table;
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
