/* FH6 Lab v2 — every number on screen is a COLUMN read from data/fh6.db.
 *
 * The old dashboard parsed a 13 MB bundle on every load and re-derived part names, slider units
 * and lap coverage in the browser. This one fetches only the view it is showing and renders what
 * the database already decided. If a value looks wrong here, it is wrong in the database, and
 * that is the point: one place to fix it.
 */
"use strict";

const API = "api/";
const cache = new Map();
async function get(path) {
  if (cache.has(path)) return cache.get(path);
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(path + ": " + r.status);
  const j = await r.json();
  cache.set(path, j);
  return j;
}

const $ = (s, r) => (r || document).querySelector(s);
const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n0 = (v) => v == null ? "—" : Math.round(v).toLocaleString();
const n1 = (v) => v == null ? "—" : (+v).toFixed(1);
const n2 = (v) => v == null ? "—" : (+v).toFixed(2);
const secs = (v) => v == null ? "—" : (+v).toFixed(2) + " s";
// ONE class design language (v1 ecea4cd): the in-game PI badge — the class tile art with the PI
// number in the black cell beside it — on every surface. The letter alone is the same badge
// without the number; nothing else may draw a class.
const PI_CLASSES = { D: 1, C: 1, B: 1, A: 1, S1: 1, S2: 1, R: 1, X: 1 };
function piBadge(cls, pi, sm) {
  const u = cls ? String(cls).toUpperCase().trim() : null;
  const cell = pi != null && pi !== "" ? `<i>${esc(String(pi))}</i>` : "";
  const wrap = `pib${sm ? " pib--sm" : ""}`;
  // DRAWN, NOT CROPPED. The badge is two cells in one rounded block — the class letter on its own
  // colour, the PI on near-black — exactly as the game draws it. A vector is sharp at any size;
  // the 42px PNG crops it replaces went soft above about 40px and could not carry a two-character
  // class (S1, S2) without stretching.
  const k = (u || "").toLowerCase();
  return `<span class="${wrap}${PI_CLASSES[u] ? " pib-" + k : ""}" title="class ${esc(u || "?")}${pi != null ? " · PI " + esc(String(pi)) : ""}"><b>${esc(u || "?")}</b>${cell}</span>`;
}
const clsBadge = (c) => piBadge(c, null, true);
const KG_LB = 2.2046226;

// COURSE NAMES (2026-09-05): the chip beside a course's title says where the NAME came from, read
// straight off course.name_confidence -- never re-derived here. 'typed' is a person's own word,
// recorded but not cross-checked (confidence 'read'); the other two are the route_names rule's own
// tiers. Read-only: an unnamed course with candidates shows what it MIGHT be, dashed like the
// dashboard's other "not the real thing yet" chip, never a picker.
function nameChip(naming) {
  if (!naming) return "";
  // 'derived:game' (2026-09-05): the game's own catalogue names the identified route -- the name is
  // the game's word for that road, not a derivation; the map only said WHICH road.
  if (naming.name_source === "derived:game") return '<span class="chip on">game · verified</span>';
  if (naming.name_confidence === "verified") return '<span class="chip on">auto · verified</span>';
  if (naming.name_confidence === "derived") return '<span class="chip b">auto · derived</span>';
  if (naming.name_confidence === "read") return '<span class="chip">typed</span>';
  const cand = (naming.candidates || []).filter((c) => !c.chosen);
  if (cand.length) return `<span class="chipmore">${cand.slice(0, 2).map((c) => esc(c.name)).join(" / ")} ?</span>`;
  return "";
}

/* ---------------------------------------------------------------- views */
const VIEWS = [
  { k: "live", lbl: "Dashboard", f: (h) => viewLive(h) },
  { k: "overview", lbl: "Overview", f: viewOverview },
  { k: "cars", lbl: "Cars", f: viewCars },
  { k: "builds", lbl: "Builds", f: viewBuilds },
  { k: "courses", lbl: "Courses", f: viewCourses },
  { k: "evidence", lbl: "Evidence", f: viewEvidence },
];

/* ============================================================ OVERVIEW */
async function viewOverview(host) {
  const ix = await get("index.json");
  const t = ix.totals;
  const cards = [
    ["cars", t.cars, "cars in the game's own table", ""],
    ["parts", t.parts_named, "parts named of " + n0(t.parts), ""],
    ["builds", t.containers, "saved tunes, in " + n0(t.packages) + " hardware packages", "b"],
    ["ready", t.ready, "of " + n0(t.containers) + " clone-ready", ""],
    ["courses", t.courses, "courses learned from telemetry", "b"],
    ["laps", t.laps, "laps, " + n0(t.trace_points) + " trace samples", "b"],
  ];
  host.append(el(`<div class="grid cards">${cards.map(([, v, l, c]) =>
    `<div class="stat"><div class="n ${c}">${n0(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>`));

  host.append(el(`<h3>where each layer came from</h3>`));
  const rows = ix.runs.map((r) => `<tr><td class="mono">${esc(r.kind)}</td>
      <td class="num">${n0(r.n_rows)}</td><td class="dim mono">${esc(r.finished_utc || "")}</td></tr>`).join("");
  host.append(el(`<div class="panel tight"><table><thead><tr><th>import</th>
    <th class="right">rows</th><th>last run</th></tr></thead><tbody>${rows}</tbody></table></div>`));

  host.append(el(`<h3>table sizes</h3>`));
  const groups = { "ref_": "the game's truth", "tune_": "saves", "hw_": "packages", "lap": "telemetry", "course": "telemetry", "session": "telemetry", "obs_": "our observations", "plan_": "materialized" };
  const items = Object.entries(ix.counts).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 24);
  host.append(el(`<div class="panel"><div class="chips">${items.map(([k, v]) =>
    `<span class="chip">${esc(k)} <b class="mono">${n0(v)}</b></span>`).join("")}</div></div>`));
}

/* ================================================================ CARS */
async function viewCars(host) {
  const cars = await get("cars.json");
  const bar = el(`<div class="bar">
    <input type="search" id="q" placeholder="search 660 cars…" style="width:230px">
    <select id="cls"><option value="">every class</option>${["D", "C", "B", "A", "S1", "S2", "R", "X"]
      .map((c) => `<option>${c}</option>`).join("")}</select>
    <select id="dt"><option value="">any drivetrain</option><option>FWD</option><option>RWD</option><option>AWD</option></select>
    <label class="chip"><input type="checkbox" id="mine"> only cars I have driven or built</label>
    <span class="why" id="count"></span></div>`);
  host.append(bar);
  const wrap = el(`<div class="panel tight scroll"><table><thead><tr>
    <th>car</th><th>class</th><th class="right">PI</th><th class="right">kg</th>
    <th>drive</th><th>engine</th><th class="right">builds</th><th class="right">laps</th>
    <th class="right">cost</th></tr></thead><tbody id="tb"></tbody></table></div>`);
  host.append(wrap);

  function draw() {
    const q = $("#q").value.trim().toLowerCase(), c = $("#cls").value, d = $("#dt").value,
      mine = $("#mine").checked;
    const rows = cars.filter((x) =>
      (!q || (x.name || "").toLowerCase().includes(q)) &&
      (!c || x.class === c) && (!d || x.dt === d) &&
      (!mine || x.builds > 0 || x.laps > 0));
    $("#count").textContent = rows.length + " of " + cars.length;
    $("#tb").innerHTML = rows.slice(0, 400).map((x) => `<tr>
      <td>${esc(x.name)}</td><td>${clsBadge(x.class)}</td>
      <td class="num">${n0(x.pi)}</td><td class="num">${n0(x.kg)}</td>
      <td class="dim">${esc(x.dt || "")}</td>
      <td class="dim">${x.cyl ? esc(x.cyl) + "cyl " : ""}${x.cc ? (x.cc / 1000).toFixed(1) + "L " : ""}${esc(x.asp || "")}</td>
      <td class="num">${x.builds ? `<span class="chip on">${x.builds}</span>` : ""}</td>
      <td class="num">${x.laps ? `<span class="chip b">${x.laps}</span>` : ""}</td>
      <td class="num dim">${x.cost ? n0(x.cost) : ""}</td></tr>`).join("");
  }
  ["#q", "#cls", "#dt", "#mine"].forEach((s) => $(s).addEventListener("input", draw));
  draw();
}

/* ============================================================== BUILDS */
async function viewBuilds(host) {
  const pk = await get("packages.json");
  const split = el(`<div class="grid split">
    <div><div class="bar"><input type="search" id="q" placeholder="search builds…" style="width:100%"></div>
      <div class="panel tight scroll" style="max-height:78vh"><table><thead><tr><th>build</th>
      <th class="right">parts</th></tr></thead><tbody id="lst"></tbody></table></div></div>
    <div id="detail"><div class="panel why">pick a build to see the parts it is made of and every
      tune saved on it.</div></div></div>`);
  host.append(split);

  function list() {
    const q = $("#q").value.trim().toLowerCase();
    const rows = pk.filter((p) => !q || (p.car + " " + (p.label || "")).toLowerCase().includes(q));
    $("#lst").innerHTML = rows.slice(0, 300).map((p) => `<tr class="click" data-hw="${esc(p.hw)}">
      <td><div>${esc(p.label || "(unnamed)")}</div>
        <div class="why">${esc(p.car)}${p.locked ? ' <span class="chip w">downloaded</span>' : ""}
        ${p.n > 1 ? `<span class="chip">${p.n} tunes</span>` : ""}</div></td>
      <td class="num">${p.n_parts}</td></tr>`).join("");
    $("#lst").querySelectorAll("tr").forEach((tr) =>
      tr.addEventListener("click", () => { $("#lst").querySelectorAll("tr").forEach((x) => x.classList.remove("sel")); tr.classList.add("sel"); showBuild(tr.dataset.hw); }));
  }
  $("#q").addEventListener("input", list);
  list();
}

async function showBuild(hw) {
  const host = $("#detail");
  host.innerHTML = `<div class="panel why">loading…</div>`;
  const b = await get("build/" + hw + ".json");
  const t0 = b.tunes[b.tunes.length - 1] || {};
  host.innerHTML = "";
  host.append(el(`<div class="panel"><div class="chips">
    <b>${esc(t0.name || "(unnamed)")}</b> <span class="chip b">${esc(b.car)}</span>
    ${t0.kg ? `<span class="chip">${n0(t0.kg)} kg · ${n0(t0.kg * KG_LB)} lb</span>` : ""}
    ${t0.locked ? '<span class="chip w">downloaded, locked</span>' : '<span class="chip">own save</span>'}
    <span class="chip mono">${esc(hw.slice(0, 8))}</span></div></div>`));

  // parts, grouped by the menu area you would walk in the shop
  const byArea = {};
  b.parts.filter((p) => p.pid != null).forEach((p) => (byArea[p.area || "—"] = byArea[p.area || "—"] || []).push(p));
  const areas = Object.entries(byArea).map(([area, ps]) => `<h3>${esc(area)}</h3>
    <div class="panel tight"><table><tbody>${ps.map((p) => `<tr>
      <td class="dim" style="width:150px">${esc(p.slot.replace(/_/g, " "))}</td>
      <td>${esc(p.name || "—")}${p.tile ? ` <span class="chip">tile ${p.tile}${p.tiles ? " of " + p.tiles : ""}</span>` : ""}
        ${p.shop ? "" : '<span class="chip m">Paint and Customize</span>'}</td>
      <td class="num dim">${p.pid}</td></tr>`).join("")}</tbody></table></div>`).join("");
  host.append(el(`<div>${areas}</div>`));

  // every tune saved on this hardware
  b.tunes.slice().reverse().forEach((t) => host.append(tuneSheet(t)));
}

function tuneSheet(t) {
  const groups = {};
  (t.sliders || []).forEach((s) => (groups[s.grp] = groups[s.grp] || []).push(s));
  const body = Object.entries(groups).map(([g, ss]) => `<h3>${esc(g)}</h3>` + ss.map((s) => {
    const pct = (s.lo != null && s.hi != null && s.hi > s.lo) ? (s.norm * 100) : (s.locked ? 100 : s.norm * 100);
    const dv = s.deflt ? "" : "";
    return `<div class="sl ${s.locked ? "locked" : ""}">
      <div class="lb">${esc(s.label || s.slider)}</div>
      <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div>
        ${s.deflt ? '<div class="tick" style="left:' + Math.max(0, Math.min(99, pct)).toFixed(1) + '%"></div>' : ""}</div>
      <div class="val">${s.v == null ? "—" : n2(s.v)} <span class="dim">${esc(s.unit || "")}</span></div></div>`;
  }).join("")).join("");
  const gears = (t.gears || []).length
    ? `<h3>gearing</h3><div class="chips">${t.gears.map((g, i) =>
      `<span class="chip${i === 0 ? " b" : ""}">${i === 0 ? "final" : i}<b class="mono"> ${n2(g)}</b></span>`).join("")}</div>` : "";
  return el(`<div class="panel" style="margin-top:12px">
    <div class="chips" style="margin-bottom:8px"><b>${esc(t.name || "(unnamed)")}</b>
      <span class="chip mono">${esc((t.saved || "").replace("T", " ").replace("Z", ""))}</span>
      ${t.locked ? '<span class="chip w">locked</span>' : ""}</div>
    ${body}${gears}
    <div class="legend"><span><i style="background:var(--acc)"></i>value in its band</span>
      <span><i style="background:var(--warn)"></i>still the install default</span>
      <span><i style="background:var(--line2)"></i>locked: this part gives no adjustment</span></div></div>`);
}

/* ============================================================= COURSES */
async function viewCourses(host) {
  const cs = await get("courses.json");
  const split = el(`<div class="grid split">
    <div><div class="bar"><input type="search" id="q" placeholder="search courses…" style="width:100%"></div>
      <div class="panel tight scroll" style="max-height:78vh"><table><thead><tr><th>course</th>
      <th class="right">best</th></tr></thead><tbody id="lst"></tbody></table></div></div>
    <div id="cdetail"><div class="panel why">pick a course. The grey line is the game's own
      centre-line for the route; the green line is where you actually drove.</div></div></div>`);
  host.append(split);
  function list() {
    const q = $("#q").value.trim().toLowerCase();
    const rows = cs.filter((c) => !q || ((c.name || "") + c.key).toLowerCase().includes(q));
    $("#lst").innerHTML = rows.map((c) => `<tr class="click" data-k="${esc(c.key)}">
      <td><div>${esc(c.name || c.key)}</div><div class="why">
        ${n0(c.len)} m · ${c.turns || 0} turns · ${c.lap_rows || 0} laps
        ${c.rivals ? '<span class="chip w">Rivals</span>' : ""}
        ${c.route_id ? `<span class="chip ${c.match === "verified" || c.match === "probable" ? "on" : ""}">Route ${esc(c.route_id)}</span>` : ""}
      </div></td><td class="num">${c.best ? secs(c.best) : ""}</td></tr>`).join("");
    $("#lst").querySelectorAll("tr").forEach((tr) => tr.addEventListener("click", () => {
      $("#lst").querySelectorAll("tr").forEach((x) => x.classList.remove("sel"));
      tr.classList.add("sel"); showCourse(tr.dataset.k);
    }));
  }
  $("#q").addEventListener("input", list);
  list();
}

async function showCourse(key) {
  const host = $("#cdetail");
  host.innerHTML = `<div class="panel why">loading…</div>`;
  const c = await get("course/" + key.replace(/\//g, "_") + ".json");
  host.innerHTML = "";
  const r = c.route;
  host.append(el(`<div class="panel"><div class="chips">
    <b>${esc(c.name || c.key)}</b>
    ${nameChip(c.naming)}
    <span class="chip">${n0(c.len)} m</span>
    <span class="chip">${(c.turns || []).length} turns</span>
    <span class="chip b">${(c.laps || []).length} laps</span>
    ${c.rivals ? '<span class="chip w">Rivals</span>' : ""}
    ${r && r.route_id ? `<span class="chip ${r.match_kind === "verified" ? "on" : r.match_kind === "probable" ? "b" : "w"}">
       game Route ${esc(r.route_id)} · ${esc(r.match_kind)}</span>` : '<span class="chip r">no game route identified</span>'}
    ${r && r.mean_dev_m != null ? `<span class="chip">${n1(r.mean_dev_m)} m off the centre-line</span>` : ""}
    ${r && r.covered != null ? `<span class="chip">${Math.round(r.covered * 100)}% of the route driven</span>` : ""}
  </div></div>`));

  host.append(courseMap(c));

  const laps = (c.laps || []);
  const clean = laps.filter((l) => !l.void && !l.partial);
  if (clean.length) host.append(speedTrace(c, clean));

  host.append(el(`<h3>laps</h3><div class="panel tight scroll" style="max-height:40vh">
    <table><thead><tr><th>car</th><th class="right">time</th><th class="right">arc</th>
    <th class="right">cover</th><th>state</th><th>session</th></tr></thead><tbody>
    ${laps.map((l) => `<tr><td class="mono dim">${esc(l.cid || "")}</td>
      <td class="num">${l.t ? secs(l.t) : "—"}</td><td class="num dim">${n0(l.arc)}</td>
      <td class="num dim">${l.cov != null ? Math.round(l.cov * 100) + "%" : ""}</td>
      <td>${l.void ? '<span class="chip r">void</span>' : ""}${l.partial ? '<span class="chip w">partial</span>' : ""}
          ${l.impacts ? `<span class="chip">${l.impacts} hits</span>` : ""}${l.solo ? '<span class="chip on">clean run</span>' : ""}</td>
      <td class="dim mono" style="font-size:10.5px">${esc(l.sid || "")}</td></tr>`).join("")}
    </tbody></table></div>`));
}

function bounds(paths) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  paths.forEach((p) => p.forEach(([x, z]) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;   // a null/NaN coord used to poison the whole box -> a collapsed map
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }));
  return [x0, x1, z0, z1];
}
// Scale the course map to the BULK of the geometry, not to a lone stray point. A single outlier
// sample -- a respawn at the map origin, a teleport, a point from a mis-joined reverse lap -- used
// to stretch one axis so far that the real loop collapsed into a hairline (the "broken map": a thin
// near-vertical sliver). Clip the box to the 2nd..98th percentile per axis; points past the clip
// still DRAW (the SVG viewBox just crops them), they no longer get to set the scale. Returns null
// when there are fewer than two finite points to scale from.
function robustBounds(paths) {
  const xs = [], zs = [];
  paths.forEach((p) => p.forEach(([x, z]) => { if (Number.isFinite(x) && Number.isFinite(z)) { xs.push(x); zs.push(z); } }));
  if (xs.length < 2) return null;
  xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  let x0 = q(xs, 0.02), x1 = q(xs, 0.98), z0 = q(zs, 0.02), z1 = q(zs, 0.98);
  if (x1 - x0 < 1) { x0 = xs[0]; x1 = xs[xs.length - 1]; }   // clip erased the span (few points) -> use the true extent
  if (z1 - z0 < 1) { z0 = zs[0]; z1 = zs[zs.length - 1]; }
  return [x0, x1, z0, z1];
}

// THE MAP AND THE TRACE MUST COUNT THE SAME LAPS. The map drew ONE aggregate path — the course
// model's own centre-line of where you have driven — while the trace drew every lap on record, so
// Edamame read "40 laps" above a map showing one. The map now draws the SAME set the trace has
// selected (opts.laps: the ids the trace kept after its preset and filters), each lap faint, the
// foregrounded lap solid, and says how many it drew.
function courseMap(c, opts) {
  opts = opts || {};
  const ids = opts.laps && opts.laps.length ? opts.laps.map(String) : Object.keys(c.traces || {});
  const lapT = {}; (c.laps || []).forEach((l) => { if (l.t != null) lapT[String(l.id)] = l.t; });
  // keep each driven path with its lap id: it lets a path be coloured by its own lap time, and fixes a
  // latent bug where foreIx indexed `ids` but the drawn set was a FILTERED copy (misaligned foreground).
  const pathRows = ids.map((id) => ({ id: String(id), pts: (c.traces || {})[id] }))
    .filter((r) => r.pts && r.pts.length > 2)
    .map((r) => ({ id: r.id, pts: r.pts.map((q) => [q[3], q[4]]).filter((q) => q[0] != null) }));
  const paths = pathRows.map((r) => r.pts);
  const foreIx = opts.fore != null ? pathRows.findIndex((r) => r.id === String(opts.fore)) : -1;
  // LAP-TIME GRADIENT (Jett 2026-09-11): each drawn lap's trace is coloured across the drawn set —
  // green (fastest) through amber to red (slowest) — so the map reads at a glance which lines are quick.
  const _dt = pathRows.map((r) => lapT[r.id]).filter((v) => v != null);
  const tmin = _dt.length ? Math.min(..._dt) : 0, tmax = _dt.length ? Math.max(..._dt) : 1;
  const _lp = (a, b, f) => Math.round(a + (b - a) * f);
  const heat = (f) => { f = Math.max(0, Math.min(1, f));
    const s = f < 0.5 ? [[0, 210, 122], [227, 179, 65], f / 0.5] : [[227, 179, 65], [240, 97, 109], (f - 0.5) / 0.5];
    return `rgb(${_lp(s[0][0], s[1][0], s[2])},${_lp(s[0][1], s[1][1], s[2])},${_lp(s[0][2], s[1][2], s[2])})`; };
  const gcol = (id) => { const t = lapT[id]; return (t == null || tmax <= tmin) ? "#00d27a" : heat((t - tmin) / (tmax - tmin)); };
  const ours = c.path || [];
  const theirs = (c.route && c.route.path) || [];
  if (!ours.length && !theirs.length) return el(`<div class="panel why">no geometry for this course</div>`);
  const rb = robustBounds([ours, theirs].concat(paths).filter((p) => p.length));
  if (!rb) return el(`<div class="panel why">no geometry for this course</div>`);   // nothing finite to scale from
  const [x0, x1, z0, z1] = rb;
  const pad = 18, AR = ((x1 - x0) || 1) / ((z1 - z0) || 1);
  const H = 380, W = Math.max(320, Math.round((H - 2 * pad) * AR)) + 2 * pad;
  const sx = (x1 - x0) || 1, sz = (z1 - z0) || 1, s = Math.min((W - 2 * pad) / sx, (H - 2 * pad) / sz);
  const px = (x) => pad + (x - x0) * s, py = (z) => H - pad - (z - z0) * s;
  // split at teleports (respawns) so a lap or a drive never draws a straight line across the map;
  // splitTP is defined in panel.js (loaded first) and falls back to a single run for clean catalogue geometry
  const _split = (typeof splitTP === "function") ? splitTP : (p) => (p && p.length ? [p] : []);
  const line = (p, col, w, op) => (p && p.length) ? _split(p).map((run) => `<polyline fill="none" stroke="${col}" stroke-width="${w}"
      opacity="${op}" stroke-linejoin="round" points="${run.map(([x, z]) => px(x).toFixed(1) + "," + py(z).toFixed(1)).join(" ")}"/>`).join("") : "";
  // TURN-ANALYSIS SELECTION (Jett 2026-09-10): a picked turn paints its 5 phases along the route
  // centre-line (braking→turn-in→mid→exit→straight) and lifts its own marker; the rest dim back so
  // the selected corner reads alone. Palette + phase geometry (t.seg) come from panel.js / build_web.
  const tp = opts.turnPick != null ? +opts.turnPick : null;
  const selT = tp != null ? (c.turns || []).find((t) => t.seq === tp) : null;
  const SC = (typeof SEG_COL !== "undefined") ? SEG_COL : {};
  const SO = (typeof SEG_ORDER !== "undefined") ? SEG_ORDER : ["braking", "turn_in", "mid", "exit", "straight"];
  const SL = (typeof SEG_LABEL !== "undefined") ? SEG_LABEL : {};
  const phaseOv = (selT && selT.seg) ? SO.map((name) => {
    const pp = selT.seg[name]; if (!pp || pp.length < 2) return "";
    return `<polyline data-phase="${name}" fill="none" stroke="${SC[name] || "#888"}" stroke-width="6" stroke-linecap="round"
        stroke-linejoin="round" opacity=".95" points="${pp.map(([x, z]) => px(x).toFixed(1) + "," + py(z).toFixed(1)).join(" ")}">
        <title>${esc(turnLabel(selT))} · ${esc(SL[name] || name)}</title></polyline>`;
  }).join("") : "";
  // TURN NUMBERS ARE PRIMARY (Jett 2026-09-10): the map is how you pick a turn, so its number must read at
  // a glance -- a legible, bold label with a dark halo (paint-order:stroke) so it stays sharp over the
  // trace lines and the road, never a faint 9px tick. Clustered turns still separate because each number
  // carries its own halo.
  const turns = (c.turns || []).filter((t) => t.x != null).map((t) => {
    const on = tp != null && t.seq === tp;
    const dim = tp != null && !on;
    const lx = (px(t.x) + 7).toFixed(1), ly = (py(t.z) - 6).toFixed(1);
    return `<g data-turn="${t.seq}" style="cursor:pointer">
      <circle cx="${px(t.x).toFixed(1)}" cy="${py(t.z).toFixed(1)}" r="${on ? 6 : 4}" fill="${on ? "#fff" : "var(--acc2)"}"
        stroke="#0b0e12" stroke-width="${on ? 1.6 : 1}" opacity="${dim ? 0.4 : 1}"><title>${esc(turnLabel(t))} · ${n0(t.r)} m radius</title></circle>
      <text x="${lx}" y="${ly}" font-size="${on ? 13 : 11}" font-weight="700" paint-order="stroke"
        stroke="#0b0e12" stroke-width="3" stroke-linejoin="round" fill="${on ? "#fff" : "#e8edf3"}"
        opacity="${dim ? 0.45 : 1}">${esc(turnLabel(t))}</text></g>`;
  }).join("");
  const phaseKey = (selT && selT.seg) ? SO.filter((n) => selT.seg[n]).map((n) =>
    `<span><i style="background:${SC[n]}"></i>${esc(SL[n] || n)}</span>`).join("") : "";
  // VIEW MODES (Jett 2026-09-11): the floating legend switches how the map is coloured. `laptime`
  // paints each lap's trace by its recorded time (gradient above); `phases` paints the whole road by
  // the five-phase turn model — every turn's own seg geometry along the centre-line, no lap traces.
  const view = opts.view || "laptime";
  const showPhases = view === "phases" && !selT;
  const allPhaseOv = SO.map((name) => (c.turns || []).map((t) => {
    const pp = t.seg && t.seg[name]; if (!pp || pp.length < 2) return "";
    return `<polyline fill="none" stroke="${SC[name] || "#888"}" stroke-width="5" stroke-linecap="round"
        stroke-linejoin="round" opacity=".92" points="${pp.map(([x, z]) => px(x).toFixed(1) + "," + py(z).toFixed(1)).join(" ")}"/>`;
  }).join("")).join("");
  // each lap's trace is wrapped in a group carrying its lap id, so a leaderboard pick can lift THIS lap's
  // whole-course trace and dim the rest (applyLapPick, panel.js) — the same isolation the corner map does,
  // now across both maps. The id space is the trace key (== the leaderboard's phaseObs lap id, both strings).
  const lapg = (id, inner) => `<g class="cmap-lap" data-lap="${id}">${inner}</g>`;
  const laps = showPhases ? allPhaseOv
    : `${pathRows.map((r, i) => (i === foreIx ? "" : lapg(r.id, line(r.pts, gcol(r.id), 1.2, tp != null ? 0.18 : 0.55)))).join("")}
       ${foreIx >= 0 ? lapg(pathRows[foreIx].id, line(pathRows[foreIx].pts, gcol(pathRows[foreIx].id), 2.6, 1)) : line(ours, "#00d27a", 2, tp != null ? 0.45 : 0.95)}`;
  const gradKey = (pathRows.length && _dt.length)
    ? `<span class="leg-grad" title="each lap's trace is coloured by its recorded time"><em>${typeof lapTime === "function" ? lapTime(tmin) : tmin.toFixed(2)}</em><i class="grad"></i><em>${typeof lapTime === "function" ? lapTime(tmax) : tmax.toFixed(2)}</em><b>${pathRows.length} lap${pathRows.length === 1 ? "" : "s"}</b></span>`
    : `<span><i style="background:#00d27a"></i>where you drove</span>`;
  const allPhaseKey = SO.map((n) => `<span><i style="background:${SC[n]}"></i>${esc(SL[n] || n)}</span>`).join("");
  const vbtn = (k, lbl) => `<button class="mini ${view === k ? "on" : ""}" data-mapview="${k}">${lbl}</button>`;
  // The map fills the pane; the legend is a COMPACT FLOATING PILL at bottom-left (Jett 2026-09-11) — by
  // default just the view toggle (lap-time gradient vs turn-phase view), so it never covers the turn numbers.
  // A "key" button expands the colour key on demand. The DATA filter is NOT here — it lives in the shared
  // #coursefilter bar between the trace and the info pane.
  const legOpen = !!opts.legOpen;
  return el(`<div class="cmap">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="background:var(--bg)" data-live-map data-x0="${x0}" data-z0="${z0}" data-s="${s}" data-h="${H}" data-w="${W}" data-pad="${pad}">
      ${line(theirs, "#3d4a5a", 9, 0.55)}
      ${line(theirs, "#8fa0b3", 1.4, showPhases ? 0.45 : 0.9)}
      ${laps}
      ${phaseOv}${turns}<g id="traceMark"></g>
    </svg>
    <div class="cmap-legend${legOpen ? " open" : ""}">
      <div class="cleg-bar">
        <span class="leg-views">${vbtn("laptime", "lap time")}${vbtn("phases", "turn phases")}</span>
        <button class="cleg-toggle" data-legtoggle title="${legOpen ? "hide the map key" : "show the map key"}">key ${legOpen ? "▾" : "▸"}</button>
      </div>
      <div class="cleg-key"${legOpen ? "" : " hidden"}>
        <span><i style="background:#7d8b9c"></i>centre-line</span>
        ${showPhases ? allPhaseKey : gradKey}
        <span><i style="background:var(--acc2)"></i>turn</span>
        ${!showPhases ? phaseKey : ""}
      </div>
    </div></div>`);
}

const GRIP = ["#00d27a", "#4ea3ff", "#f0616d", "#c678dd", "#e3b341"];
function speedTrace(c, laps) {
  const ids = Object.keys(c.traces || {});
  if (!ids.length) return el(`<div class="panel why">no speed trace stored for this course</div>`);
  const W = 760, H = 190, padL = 30, padB = 18;
  let smax = 0, vmax = 0;
  ids.forEach((id) => c.traces[id].forEach((p) => { if (p[0] > smax) smax = p[0]; if (p[1] > vmax) vmax = p[1]; }));
  vmax *= 1.06;
  const px = (s) => padL + (s / smax) * (W - padL - 8), py = (v) => (H - padB) - (v / vmax) * (H - padB - 10);
  const byId = {}; laps.forEach((l) => (byId[l.id] = l));
  const best = ids.map((id) => byId[id]).filter(Boolean).sort((a, b) => a.t - b.t)[0];
  const paths = ids.map((id) => {
    const l = byId[id]; const pts = c.traces[id];
    const isBest = best && l && l.id === best.id;
    // grip-paint the fastest lap, leave the rest as context
    if (!isBest) return `<polyline fill="none" stroke="var(--dim)" stroke-width="1" opacity=".5"
        points="${pts.map((p) => px(p[0]).toFixed(1) + "," + py(p[1]).toFixed(1)).join(" ")}"/>`;
    const segs = []; let run = [pts[0]], st = pts[0][2] | 0;
    for (let i = 1; i < pts.length; i++) {
      const k = pts[i][2] | 0;
      if (k !== st) { run.push(pts[i]); segs.push([st, run]); run = [pts[i]]; st = k; } else run.push(pts[i]);
    }
    segs.push([st, run]);
    return segs.map(([k, pp]) => `<polyline fill="none" stroke="${GRIP[k] || GRIP[0]}" stroke-width="2"
        stroke-linecap="round" points="${pp.map((p) => px(p[0]).toFixed(1) + "," + py(p[1]).toFixed(1)).join(" ")}"/>`).join("");
  }).join("");
  const ticks = (c.turns || []).filter((t) => t.s != null).map((t) =>
    `<line x1="${px(t.s).toFixed(1)}" y1="8" x2="${px(t.s).toFixed(1)}" y2="${H - padB}" stroke="var(--line2)" opacity=".7"/>
     <text x="${px(t.s).toFixed(1)}" y="${H - 5}" font-size="8" fill="var(--dim)" text-anchor="middle">${esc(turnLabel(t))}</text>`).join("");
  const axis = [0.5, 1].map((f) => { const v = Math.round(vmax * f / 10) * 10;
    return `<text x="2" y="${(py(v) + 3).toFixed(1)}" font-size="9" fill="var(--dim)">${v}</text>`; }).join("");
  return el(`<div class="panel" style="margin-top:12px">
    <div class="chips" style="margin-bottom:6px"><b>speed</b>
      <span class="why">mph against distance · ${ids.length} laps · the fastest is painted by grip state</span></div>
    <svg viewBox="0 0 ${W} ${H}" style="background:var(--bg);border-radius:6px">${axis}${ticks}${paths}</svg>
    <div class="legend"><span><i style="background:#00d27a"></i>within grip</span>
      <span><i style="background:#4ea3ff"></i>front slipping</span>
      <span><i style="background:#f0616d"></i>rear slipping</span>
      <span><i style="background:#c678dd"></i>all four</span>
      <span><i style="background:#e3b341"></i>impact</span>
      <span><i style="background:#576372"></i>other laps</span></div></div>`);
}

/* ============================================================ EVIDENCE */
async function viewEvidence(host) {
  const d = await get("evidence.json");
  host.append(el(`<div class="bar"><input type="search" id="q" placeholder="search claims…" style="width:280px">
    <select id="cf"><option value="">any confidence</option>${["verified", "read", "derived", "proven", "unknown"]
      .map((c) => `<option>${c}</option>`).join("")}</select>
    <span class="why">Every claim we hold, and where it came from. A claim is only as good as its source.</span></div>`));
  const box = el(`<div id="ev"></div>`); host.append(box);
  function draw() {
    const q = $("#q").value.trim().toLowerCase(), cf = $("#cf").value;
    box.innerHTML = d.evidence.filter((e) =>
      (!q || (e.subject + " " + e.claim).toLowerCase().includes(q)) && (!cf || e.conf === cf))
      .map((e) => `<div class="rule ${esc(e.conf)}">
        <div><b class="mono">${esc(e.subject)}</b> <span class="chip">${esc(e.conf)}</span></div>
        <div>${esc(e.claim)}</div>
        <div class="src">${esc(e.source || "")}</div></div>`).join("");
  }
  ["#q", "#cf"].forEach((s) => $(s).addEventListener("input", draw));
  draw();
}

/* ================================================================ boot */
async function route() {
  const k = (location.hash || "#live").slice(1).split("/")[0];
  const v = VIEWS.find((x) => x.k === k) || VIEWS[0];
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.k === v.k));
  const host = $("#view"); host.innerHTML = "";
  // the Dashboard is a fixed-height instrument panel, every other view is a document
  document.body.classList.toggle("fixed", v.k === "live");
  host.classList.toggle("live", v.k === "live");
  try { await v.f(host); }
  catch (e) { host.innerHTML = `<div class="panel"><b>could not render ${esc(v.k)}</b>
    <div class="why">${esc(e.message)}</div>
    <div class="why">Run <span class="mono">python scripts/db/build_web.py</span> to regenerate the data files.</div></div>`; }
}

(async function boot() {
  $("#nav").innerHTML = VIEWS.map((v) =>
    `<button data-k="${v.k}" onclick="location.hash='${v.k}'">${v.lbl}</button>`).join("");
  window.addEventListener("hashchange", route);
  try {
    const ix = await get("index.json");
    // SAY WHICH CODE IS ON SCREEN. Two people looked at two different renders and argued about
    // the same layout; the document never said which build it was. The asset tag settles it.
    const v = ((document.querySelector('script[src*="panel.js"]') || {}).src || "").split("v=")[1] || "?";
    $("#stamp").innerHTML = `<span title="the dashboard code on screen">ui v${esc(v)}</span> · built ${esc((ix.built || "").replace("T", " ").replace("Z", ""))}`;
  } catch (e) { $("#stamp").textContent = "no data — run build_web.py"; }
  route();
})();
