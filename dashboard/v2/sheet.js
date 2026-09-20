/* FH6 GameSheet — the two in-game screens, reproduced.
 *
 *   window.GameSheet = { render(host, model), destroy(host) }
 *
 * model = {
 *   options:      api/options/<ordinal>.json      (the shop tree, rims, index_scheme, unknown)
 *   fitted:       {slot: pid}                     the build being cloned (pid != null rows)
 *   fittedNames:  {slot: name}
 *   deliverable:  the daemon's deliverable        {tabs:[{tab,rows:[…]}], summary, locked}
 *   name:         tune title
 *   locked:       bool
 *   done:         {slot: bool}                    the clone checklist
 *   onDone(slot, bool)
 *   stats:        {ratings?, power?, …} | null
 * }
 *
 * The renderer reads NOTHING from the page — every input arrives in `model`, every CSS rule
 * is scoped under `.gsheet` (sheet.css). Where the spec marks a string UNKNOWN (§7) the sheet
 * draws UNKNOWN; it never invents a name, a price or a value.
 *
 * Spec references throughout are to docs/fh6-ui-spec.md.
 */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ glyphs */
  // Inline SVG only — the spec forbids nothing here, but "no external assets" does.
  const LOCK = '<svg viewBox="0 0 12 14" class="lockglyph" aria-hidden="true">' +
    '<path d="M3 6V4a3 3 0 0 1 6 0v2h1.2v7.2H1.8V6H3zm1.2 0h3.6V4a1.8 1.8 0 0 0-3.6 0v2z"/></svg>';
  const LOCK_BANNER = '<svg viewBox="0 0 12 14" aria-hidden="true">' +
    '<path d="M3 6V4a3 3 0 0 1 6 0v2h1.2v7.2H1.8V6H3zm1.2 0h3.6V4a1.8 1.8 0 0 0-3.6 0v2z"/></svg>';
  const WRENCH = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9.6.6a4 4 0 0 0-3.5 5.9L.7 11.9l1.4 1.4 5.4-5.4A4 4 0 0 0 13.4 4l-2 2-1.4-1.4 2-2A4 4 0 0 0 9.6.6z"/></svg>';
  const BASKET = '<svg viewBox="0 0 14 14" class="gs-basket" aria-hidden="true"><path d="M1 5h12l-1.3 7.5a1 1 0 0 1-1 .8H3.3a1 1 0 0 1-1-.8L1 5zm3.2-.9L6.3.7l1.2.7L5.7 4.1H4.2zm5.6 0L8.3 1.4 9.5.7l2.1 3.4H9.8z"/></svg>';

  /* -------------------------------------------------------------- shop tables
     Verbatim strings from the spec. Used only as a FALLBACK when the options
     payload does not carry `desc` — data always wins. */
  const SHOP_DESC = {
    "Engine": "Engine upgrades can improve your car's acceleration and speed. You can add a more aggressive cam, stiffer valve springs, improved intake, and exhaust systems as well as a turbo or supercharger to get more power out of your…",
    "Platform and Handling": "Platform and handling upgrades include better brakes and suspension. Combine several platform and handling upgrade types to get the most out of your chassis. These upgrades add up to better braking and cornering. But…",
    "Drivetrain": "Change how the engine's power gets to the wheels to improve your cars acceleration and speed. Upgrades to components such as the transmission, clutch, differentials, and driveline can improve shift time and enable fine-tuning of…",
    "Tires and Rims": "You cannot transmit your cars power and handling potential to the road without the right tires and rims. The stock tires on your car limit your track performance, no matter how you tweak your engine or suspension. Upgrading…",
    "Aero and Appearance": "Weight and aerodynamic upgrades can improve your cars acceleration, speed, downforce, and cornering, but to get ahead on the race track you have to balance your upgrades. A lightweight, streamlined car that is short on…",
    "Body Kits and Conversions": "Change major components of your car, altering its very nature.  Conversions affect the upgrades that are available in other categories."
  };
  // Sub-menu descriptions the spec transcribed (§2.1, §2.5). Everything else is UNKNOWN.
  const MENU_DESC = {
    "Intake": "Intake upgrades help the engine inhale more freely and provide a lot of bang for the buck. Less restrictive air filters and a tuned intake manifold allow more air into the engine, making more power.",
    "Ignition": "Ignition upgrades help the engine burn fuel more efficiently to produce more power. Adding better coils, spark plugs, and ignition wiring can make a significant difference in engine power and car performance.",
    "Valves": "Valves allow the air and fuel mixture to enter and exit the engine. Upgrading these allows for more air flow increasing power.",
    "Displacement": "Displacement upgrades make the engine more durable and less damage-prone. They can also reduce friction/inertia and increase displacement/compression to make the engine more powerful and responsive.",
    "Oil / Cooling": "Adding oil cooling keeps the engine's oil at the correct temperature, aiding efficiency and increasing power.",
    "Flywheel": "For a stock car, the rotating mass of the flywheel smoothes and steadies the rotation of the driveshaft, but it decreases throttle response and acceleration. Upgrading to a lighter-weight flywheel allows the engine to respond to the…",
    "Front Bumper": "You can upgrade your front bumper to increase the load over the front wheels by increasing downforce. These upgrades allow higher cornering speeds. Note that Race upgrades make downforce adjustable.",
    "Rear Wing": "Upgrading the rear wing on your car increases the load over the rear wheels by generating downforce to allow higher cornering speeds. Note that Race upgrades make downforce adjustable."
  };
  // Forced-induction slots — the Engine list's length follows the fitted aspiration (§9.1, §10.5).
  const FI_SLOTS = ["single_turbo", "twin_turbo", "quad_turbo",
                    "centrifugal_supercharger", "pos_supercharger"];
  const RIM_SLOTS = { rim_style: 1, rear_rim_style: 1 };

  /* ------------------------------------------------------------- tune tables
     Spec §3 — the strip order is what is DRAWN, not the order a tuner works in.
     Each panel: name · low caption · high caption · optional unit chip (§5.4).
     Each row: label · deliverable field · decimals · inline suffix (§5.5). */
  const N = null;
  const TUNE_TABS = [
    { tab: "TIRES", panels: [
      { name: "Tire Pressure", lo: "Low", hi: "High", unit: "PSI", rows: [
        { label: "Front", field: "front_tire_pressure", dp: 1, sfx: "" },
        { label: "Rear",  field: "rear_tire_pressure",  dp: 1, sfx: "" }] }] },
    { tab: "GEARING", panels: [
      { name: "Forward Gears", lo: "Speed", hi: "Acceleration", unit: N, gears: true, rows: [
        { label: "Final Drive", field: "final_drive", dp: 2, sfx: "" }] }] },
    { tab: "ALIGNMENT", panels: [
      { name: "Camber", lo: "Negative", hi: "Positive", unit: N, rows: [
        { label: "Front", field: "front_camber", dp: 1, sfx: "°" },
        { label: "Rear",  field: "rear_camber",  dp: 1, sfx: "°" }] },
      { name: "Toe", lo: "In", hi: "Out", unit: N, rows: [
        { label: "Front", field: "front_toe", dp: 1, sfx: "°" },
        { label: "Rear",  field: "rear_toe",  dp: 1, sfx: "°" }] },
      { name: "Front Caster", lo: "Low", hi: "High", unit: N, rows: [
        { label: "Angle", field: "front_caster", dp: 1, sfx: "°" }] }] },
    { tab: "ANTIROLL BARS", panels: [
      { name: "ANTIROLL BARS", lo: "Soft", hi: "Stiff", unit: N, rows: [
        { label: "Front", field: "front_arb", dp: 2, sfx: "" },
        { label: "Rear",  field: "rear_arb",  dp: 2, sfx: "" }] }] },
    { tab: "SPRINGS", panels: [
      { name: "Springs", lo: "Soft", hi: "Stiff", unit: "LB/IN", rows: [
        { label: "Front", field: "front_spring", dp: 1, sfx: "" },
        { label: "Rear",  field: "rear_spring",  dp: 1, sfx: "" }] },
      { name: "Ride Height", lo: "Low", hi: "High", unit: "IN", rows: [
        { label: "Front", field: "front_ride_height", dp: 1, sfx: "" },
        { label: "Rear",  field: "rear_ride_height",  dp: 1, sfx: "" }] }] },
    { tab: "DAMPING", panels: [
      { name: "Rebound Stiffness", lo: "Soft", hi: "Stiff", unit: N, rows: [
        { label: "Front", field: "front_rebound", dp: 1, sfx: "" },
        { label: "Rear",  field: "rear_rebound",  dp: 1, sfx: "" }] },
      { name: "Bump Stiffness", lo: "Soft", hi: "Stiff", unit: N, rows: [
        { label: "Front", field: "front_bump", dp: 1, sfx: "" },
        { label: "Rear",  field: "rear_bump",  dp: 1, sfx: "" }] }] },
    { tab: "AERO", panels: [
      { name: "Downforce", lo: "Speed", hi: "Cornering", unit: "LB", rows: [
        { label: "Front", field: "front_downforce", dp: 0, sfx: "" },
        { label: "Rear",  field: "rear_downforce",  dp: 0, sfx: "" }] }] },
    // §3: the BRAKE tab draws the header text `Braking Force` TWICE — once per panel.
    { tab: "BRAKE", panels: [
      { name: "Braking Force", lo: "Rear", hi: "Front", unit: N, rows: [
        { label: "Balance", field: "brake_balance", dp: 0, sfx: "%" }] },
      { name: "Braking Force", lo: "Low", hi: "High", unit: N, rows: [
        { label: "Pressure", field: "brake_pressure", dp: 0, sfx: "%" }] }] },
    { tab: "DIFFERENTIAL", panels: [
      { name: "Front", lo: "Low", hi: "High", unit: N, rows: [
        { label: "Acceleration", field: "front_diff_accel", dp: 0, sfx: "%" },
        { label: "Deceleration", field: "front_diff_decel", dp: 0, sfx: "%" }] },
      { name: "Rear", lo: "Low", hi: "High", unit: N, rows: [
        { label: "Acceleration", field: "rear_diff_accel", dp: 0, sfx: "%" },
        { label: "Deceleration", field: "rear_diff_decel", dp: 0, sfx: "%" }] },
      { name: "CENTER", lo: "Front", hi: "Rear", unit: N, rows: [
        { label: "Balance", field: "center_diff", dp: 0, sfx: "%" }] }] }
  ];
  // §8 — the row whose lock the spec names, and the note the Description panel carries.
  const BRAKE_LOCK_NOTE = "UNLOCKED BY INSTALLING RACE BRAKE UPGRADES.";

  // §4.2 — the Performance panel: four groups, fixed order, fixed formatting.
  const PERF = [
    { g: "Braking Distance", rows: [
      { l: "60 mph – 0",  k: ["braking_60_0", "brake_60_0", "b60"],   dp: 1, u: " ft" },
      { l: "100 mph – 0", k: ["braking_100_0", "brake_100_0", "b100"], dp: 1, u: " ft" }] },
    { g: "Lateral Gs", rows: [
      { l: "60 mph",  k: ["lat_g_60", "lateral_60", "g60"],   dp: 2, u: "" },
      { l: "120 mph", k: ["lat_g_120", "lateral_120", "g120"], dp: 2, u: "" }] },
    { g: "Acceleration & Speed", rows: [
      { l: "0 – 60 mph",  k: ["accel_0_60", "zero_60", "a60"],   dp: 3, u: "s" },
      { l: "0 – 100 mph", k: ["accel_0_100", "zero_100", "a100"], dp: 3, u: "s" },
      { l: "Top Speed",        k: ["top_speed", "topspeed"],          dp: 1, u: " mph" }] },
    { g: "Miscellaneous", rows: [
      { l: "Mech. Balance",   k: ["mech_balance", "mechanical_balance"], dp: 2, u: "" },
      { l: "Aero Balance",    k: ["aero_balance"],                      dp: 2, u: "" },
      { l: "Aero Efficiency", k: ["aero_efficiency", "aero_eff"],       dp: 3, u: "" }] }
  ];
  // §4.1 + §10 — the upgrade panel's five Y-toggle pages.
  const STAT_PAGES = [
    { name: "Ratings", rows: [
      { l: "Speed", k: ["ratings.speed"], dp: 1 }, { l: "Handling", k: ["ratings.handling"], dp: 1 },
      { l: "Acceleration", k: ["ratings.acceleration"], dp: 1 }, { l: "Launch", k: ["ratings.launch"], dp: 1 },
      { l: "Braking", k: ["ratings.braking"], dp: 1 }, { l: "Offroad", k: ["ratings.offroad"], dp: 1 }] },
    { name: "Power / Weight", rows: [
      { l: "Power", k: ["power"], dp: 0, u: " hp" }, { l: "Torque", k: ["torque"], dp: 0, u: " ft·lb" },
      { l: "Weight", k: ["weight"], dp: 0, u: " lb", comma: true }, { l: "Front", k: ["front_pct", "front"], dp: 0, u: "%" },
      { l: "PWR", k: ["pwr"], dp: 2, u: " hp/lb" }, { l: "Displacement", k: ["displacement"], dp: 0, comma: true }] },
    { name: "Braking Distance / Lateral Gs", rows: [
      { l: "60 mph – 0", k: ["braking_60_0"], dp: 1, u: " ft" }, { l: "100 mph – 0", k: ["braking_100_0"], dp: 1, u: " ft" },
      { l: "60 mph", k: ["lat_g_60"], dp: 2 }, { l: "120 mph", k: ["lat_g_120"], dp: 2 }] },
    { name: "Acceleration & Speed", rows: [
      { l: "0 – 60 mph", k: ["accel_0_60"], dp: 3, u: " s" }, { l: "0 – 100 mph", k: ["accel_0_100"], dp: 3, u: " s" },
      { l: "Top Speed", k: ["top_speed"], dp: 1, u: " mph" }] },
    { name: "Aerodynamics / Chassis", rows: [
      { l: "Efficiency", k: ["aero_efficiency"], dp: 3 }, { l: "Balance", k: ["aero_balance"], dp: 2 },
      { l: "Mech. Balance", k: ["mech_balance"], dp: 2 }] }
  ];

  /* ----------------------------------------------------------------- helpers */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // §5.6 — `CR ` prefix, thousands comma, no decimals.
  function cr(n) { return "CR " + Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function comma(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function num(v, dp) { const x = Number(v); return isFinite(x) ? x.toFixed(dp) : null; }
  function dig(obj, path) {
    if (!obj) return undefined;
    if (path.indexOf(".") < 0) return obj[path];
    return path.split(".").reduce(function (o, k) { return (o == null ? o : o[k]); }, obj);
  }
  function pick(stats, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = dig(stats, keys[i]);
      if (v != null && v !== "") return v;
    }
    return undefined;
  }
  function pct(fill) { return Math.max(0, Math.min(100, (Number(fill) || 0) * 100)); }

  /* ---------------------------------------------------- model-derived lookups */
  function allMenus(m) {
    const out = [];
    ((m.options && m.options.shop) || []).forEach(function (area, ai) {
      (area.menus || []).forEach(function (mu, mi) { out.push({ area: area, ai: ai, menu: mu, mi: mi }); });
    });
    return out;
  }
  function findMenu(m, slot) {
    const hit = allMenus(m).filter(function (x) { return x.menu.slot === slot; })[0];
    return hit ? hit.menu : null;
  }
  function fittedPid(m, slot) {
    const v = (m.fitted || {})[slot];
    return (v === undefined || v === null) ? null : v;
  }
  // §2.5 / §10.7 — the Front Bumper tile disappears while a body kit is on.
  function bodyKitOn(m) {
    const pid = fittedPid(m, "car_body");
    if (pid == null) return false;
    const menu = findMenu(m, "car_body");
    if (!menu) return false;                    // no car_body menu exported → cannot judge
    const t = (menu.tiles || []).filter(function (t) { return t.pid === pid; })[0];
    return t ? !t.stock : false;
  }
  function anyFI(m) { return FI_SLOTS.some(function (s) { return fittedPid(m, s) != null; }); }
  // §9.1 / §10.5 — the Engine list is engine- and aspiration-specific.
  function menuVisible(m, menu) {
    // the exporter's own verdict wins when it makes one (it knows the save's hardware)
    if (menu.shown_in_context === false) return false;
    if (menu.removed_by_body_kit && bodyKitOn(m)) return false;
    const ra = menu.requires_aspiration;
    if (ra == null || ra === false) return true;
    if (ra === true || ra === "any" || ra === "forced_induction") return anyFI(m);
    if (ra === "naturally_aspirated") return !anyFI(m);
    return fittedPid(m, ra) != null;
  }
  function visibleMenus(area, m) {
    return (area.menus || []).filter(function (mu) { return menuVisible(m, mu); });
  }
  function isRimMenu(menu) { return !!RIM_SLOTS[menu && menu.slot]; }
  function rimList(m) {
    const brands = ((m.options && m.options.rims) || {}).brands || [];
    const flat = [];
    brands.forEach(function (b) {
      (b.rims || []).forEach(function (r) { flat.push({ brand: b.brand, rim: r }); });
    });
    return { brands: brands, flat: flat };
  }
  // The tile this menu's TARGET build wants. Rims resolve out of options.rims.
  // Matching is by part id; where the export left `pid` null (it happens — e.g. Aspiration
  // on cars whose ids were never proven) the tile name from `fittedNames` is the fallback.
  // Neither is invented: a slot that matches neither simply has no target.
  function targetName(m, menu) {
    const n = (m.fittedNames || {})[menu.slot];
    return (n == null || n === "") ? null : String(n);
  }
  function targetTile(m, menu) {
    const pid = fittedPid(m, menu.slot);
    const nm = targetName(m, menu);
    if (pid == null && nm == null) return null;
    if (isRimMenu(menu)) {
      const flat = rimList(m).flat;
      const hit = flat.filter(function (x) { return pid != null && x.rim.pid === pid; })[0] ||
                  flat.filter(function (x) { return nm != null && x.rim.name === nm; })[0];
      return hit ? { pid: hit.rim.pid, name: hit.rim.name, price: hit.rim.price, stock: false,
                     brand: hit.brand, mass_lb: hit.rim.mass_lb, mass_level: hit.rim.mass_level } : null;
    }
    const ts = menu.tiles || [];
    return ts.filter(function (t) { return pid != null && t.pid === pid; })[0] ||
           ts.filter(function (t) { return nm != null && t.name === nm; })[0] || null;
  }
  // Is this exact tile the clone's target? (same rule as targetTile, applied to one tile)
  function isTargetTile(m, menu, t) {
    if (!t) return false;
    const tt = targetTile(m, menu);
    if (!tt) return false;
    return (tt.pid != null && t.pid === tt.pid) ||
           (tt.pid == null && t.name != null && t.name === tt.name);
  }
  // Footer chips (§0.5, §5.6): the running basket — target parts not yet ticked.
  function basket(m) {
    let cr = 0, n = 0;
    allMenus(m).forEach(function (x) {
      if (!menuVisible(m, x.menu)) return;
      const t = targetTile(m, x.menu);
      if (!t || t.stock) return;                       // stock is not a purchase
      if ((m.done || {})[x.menu.slot]) return;         // already ticked off
      n += 1;
      if (typeof t.price === "number") cr += t.price;
    });
    return { cr: cr, n: n };
  }

  /* ------------------------------------------------------------ tune plumbing */
  // Flatten every deliverable row into field → row, so the sheet can lay them out in the
  // GAME's tab order (§5.3) whatever order/naming the deliverable used.
  function rowIndex(d) {
    const ix = {};
    ((d && d.tabs) || []).forEach(function (t) {
      (t.rows || []).forEach(function (r) { if (r && r.field) ix[r.field] = r; });
    });
    return ix;
  }
  function gearFields(ix) {
    const out = [];
    for (let i = 1; i <= 10; i++) if (ix["gear_" + i]) out.push(i);
    return out;
  }
  const ORD = { 1: "1st", 2: "2nd", 3: "3rd" };
  function ordinal(i) { return ORD[i] || (i + "th"); }

  /* --------------------------------------------------------------- state ---- */
  const STATE = typeof WeakMap === "function" ? new WeakMap() : null;
  const FALLBACK = [];
  function getState(host) {
    if (STATE) return STATE.get(host);
    const hit = FALLBACK.filter(function (e) { return e.host === host; })[0];
    return hit && hit.st;
  }
  function setState(host, st) {
    if (STATE) { STATE.set(host, st); return; }
    const hit = FALLBACK.filter(function (e) { return e.host === host; })[0];
    if (hit) hit.st = st; else FALLBACK.push({ host: host, st: st });
  }
  function delState(host) {
    if (STATE) { STATE.delete(host); return; }
    for (let i = FALLBACK.length - 1; i >= 0; i--) if (FALLBACK[i].host === host) FALLBACK.splice(i, 1);
  }

  /* ================================================================ SHOP views */
  function tileHTML(o) {
    // o = {i, name, unknown, badge, sublabel, sublabelBad, hi, price, ticked, pos}
    const cls = ["gs-tile"];
    if (o.hi) cls.push("hi");
    if (o.unknown) cls.push("unk");
    let h = '<button class="' + cls.join(" ") + '" data-gs="tile" data-i="' + o.i + '"' +
      (o.title ? ' title="' + esc(o.title) + '"' : "") + ">";
    if (o.badge) h += '<span class="gs-badge ' + o.badge.cls + '">' + esc(o.badge.text) + "</span>";
    if (o.ticked) h += BASKET;
    h += '<span class="gs-tname">' + (o.unknown ? "UNKNOWN" : esc(o.name)) + "</span>";
    if (o.sublabel) h += '<span class="gs-sublabel ' + (o.sublabelBad ? "bad" : "good") + '">' +
      esc(o.sublabel) + "</span>";
    if (o.pos) h += '<span class="gs-tpos">' + o.pos + "</span>";
    return h + "</button>";
  }

  function nameBarHTML(name, price, unknown) {
    return '<div class="gs-namebar' + (unknown ? " unk" : "") + '">' +
      '<span class="n">' + (unknown ? "UNKNOWN" : esc(name || "")) + "</span>" +
      (price != null ? '<span class="p">' + cr(price) + "</span>" : "") + "</div>";
  }
  function descHTML(text) {
    return '<div class="gs-desc">' + (text
      ? esc(text)
      : '<span class="unk">Description not captured for this tile — spec §7 leaves it UNKNOWN.</span>') +
      "</div>";
  }
  function footHTML(m) {
    const b = basket(m);
    return '<div class="gs-foot">' +
      '<span class="gs-chip">' + cr(b.cr) + "</span>" +
      '<span class="gs-chip">' + WRENCH + '<span class="cnt">' + b.n + "</span></span>" +
      '<span class="gs-chip" style="margin-left:auto;border-color:transparent;background:none;' +
      'color:var(--gs-dim);font-size:11px">parts still to buy</span></div>';
  }
  // §0 button prompts, per screen kind and per highlighted-tile state.
  function promptsHTML(kind, state) {
    let p;
    if (kind === "category") {
      p = [["A", "Ok"], ["B", "Back"], [null, "Setup Manager"], [null, "View Basket"], ["RT", "Rev Engine"]];
    } else if (state === "installed") {
      p = [["B", "Back"], ["Y", "Toggle"], [null, "View Basket"], [null, "Setup Manager"], ["RT", "Rev Engine"]];
    } else if (state === "owned") {
      p = [["A", "Install"], ["B", "Back"], ["Y", "Toggle"], [null, "View Basket"], [null, "Setup Manager"], ["RT", "Rev Engine"]];
    } else {
      p = [["A", "Buy and Install"], ["B", "Back"], ["Y", "Toggle"], [null, "View Basket"], [null, "Setup Manager"], ["RT", "Rev Engine"]];
    }
    return '<div class="gs-prompts">' + p.map(function (x) {
      return "<span>" + (x[0] ? "<b>" + esc(x[0]) + "</b>" : "") + esc(x[1]) + "</span>";
    }).join("") + "</div>";
  }
  function unlockHTML(text) {
    if (!text) return "";
    return '<div class="gs-unlock">' + LOCK_BANNER + "<span>" + esc(text) + "</span></div>";
  }
  function statsHTML(m, page) {
    const P = STAT_PAGES[page % STAT_PAGES.length];
    let h = '<div class="gs-stats"><div class="h"><span>' + esc(P.name) + "</span>" +
      '<button class="y" data-gs="ytoggle">Y Toggle – page ' + ((page % STAT_PAGES.length) + 1) +
      "/" + STAT_PAGES.length + "</button></div>";
    P.rows.forEach(function (r) {
      const v = pick(m.stats, r.k);
      let txt, na = false;
      if (v == null) { txt = "—"; na = true; }
      else if (r.comma) txt = comma(v) + (r.u || "");
      else { const f = num(v, r.dp); txt = (f == null ? String(v) : f) + (r.u || ""); }
      h += '<div class="gs-srow"><span class="l">' + esc(r.l) + '</span><span class="v' +
        (na ? " na" : "") + '">' + esc(txt) + "</span></div>";
    });
    if (!m.stats) h += '<div class="gs-srow"><span class="l" style="font-style:italic;color:var(--gs-dim)">' +
      "no preview stats in the model — nothing is invented</span></div>";
    return h + "</div>";
  }

  function shopRootHTML(m, st) {
    const shop = (m.options && m.options.shop) || [];
    const hi = Math.min(st.hi, Math.max(0, shop.length - 1));
    const grid = shop.map(function (a, i) {
      return tileHTML({ i: i, name: a.area, hi: i === hi, pos: a.pos || (i + 1) });
    }).join("");
    const cur = shop[hi];
    const unk = ((m.options && m.options.unknown) || []);
    return '<div class="gs-panel">' +
      '<div class="gs-title"><h3>Upgrade Shop</h3><span class="gs-crumb">' +
        esc((m.options && m.options.name) || "") + "</span></div>" +
      '<div class="gs-grid rows2">' + grid + "</div>" +
      nameBarHTML(cur ? cur.area : "", null, false) +
      descHTML(cur ? (cur.desc || SHOP_DESC[cur.area]) : null) +
      footHTML(m) + promptsHTML("category") + "</div>" +
      '<div class="gs-side">' +
        '<div class="gs-note"><h4>Reading this sheet</h4><ul>' +
          "<li>A tile carries <code>TARGET</code> while the clone still needs it, and " +
          "<code>INSTALLED</code> once you tick it. Clicking a target tile ticks it — it never buys.</li>" +
          "<li>The footer chips are the running basket: credits still to spend, and how many parts.</li>" +
          "<li>Menus the fitted aspiration or the body kit removes are not drawn (§9.1, §2.5).</li>" +
        "</ul></div>" +
        (unk.length ? '<div class="gs-note"><h4>Unknown in this export (§7)</h4><ul>' +
          unk.slice(0, 40).map(function (u) { return "<li>" + esc(u) + "</li>"; }).join("") +
          (unk.length > 40 ? "<li>… and " + (unk.length - 40) + " more</li>" : "") +
          "</ul></div>" : "") +
      "</div>";
  }

  function shopCategoryHTML(m, st) {
    const shop = (m.options && m.options.shop) || [];
    const area = shop[st.area];
    if (!area) return '<div class="gs-empty">no such category</div>';
    const menus = visibleMenus(area, m);
    const hi = Math.min(st.hi, Math.max(0, menus.length - 1));
    const grid = menus.map(function (mu, i) {
      const t = targetTile(m, mu);
      const ticked = !!(m.done || {})[mu.slot];
      let badge = null;
      if (t && !t.stock) badge = ticked ? { cls: "inst", text: "INSTALLED" } : { cls: "tgt", text: "TARGET" };
      return tileHTML({ i: i, name: mu.tile_label || mu.title, hi: i === hi, badge: badge,
                        pos: mu.pos || (i + 1),
                        title: t ? (t.name || "UNKNOWN") : "no target part in this build" });
    }).join("");
    const cur = menus[hi];
    return '<div class="gs-panel">' +
      '<div class="gs-title"><button class="gs-back" data-gs="back">◀ Back</button>' +
        "<h3>" + esc(area.area) + '</h3><span class="gs-crumb">Upgrade Shop › ' +
        esc(area.area) + "</span></div>" +
      '<div class="gs-grid">' + grid + "</div>" +
      nameBarHTML(cur ? (cur.tile_label || cur.title) : "", null, false) +
      descHTML(cur ? (cur.desc || MENU_DESC[cur.title] || MENU_DESC[cur.tile_label]) : null) +
      footHTML(m) + promptsHTML("category") + "</div>" +
      '<div class="gs-side">' +
        (cur && cur.unlock ? unlockHTML(cur.unlock) : "") +
        '<div class="gs-note"><h4>' + esc(area.area) + "</h4><ul>" +
          "<li>" + menus.length + " sub-menu" + (menus.length === 1 ? "" : "s") + " on this car, in the game's order.</li>" +
          ((area.menus || []).length !== menus.length
            ? "<li>" + ((area.menus || []).length - menus.length) +
              " hidden by the fitted aspiration / body kit.</li>" : "") +
        "</ul></div></div>";
  }

  function shopPartHTML(m, st) {
    const shop = (m.options && m.options.shop) || [];
    const area = shop[st.area];
    if (!area) return '<div class="gs-empty">no such category</div>';
    const menus = visibleMenus(area, m);
    const menu = menus[st.menu];
    if (!menu) return '<div class="gs-empty">no such menu</div>';
    if (isRimMenu(menu)) return rimStyleHTML(m, st, area, menu);

    const tiles = (menu.tiles || []).slice();
    const tgt = targetTile(m, menu);
    const ticked = !!(m.done || {})[menu.slot];
    const hi = Math.min(st.hi, Math.max(0, tiles.length - 1));
    const grid = tiles.map(function (t, i) {
      const isTarget = isTargetTile(m, menu, t);
      let badge = null;
      if (isTarget) badge = (ticked || t.stock) ? { cls: "inst", text: "INSTALLED" }
                                                : { cls: "tgt", text: "TARGET" };
      // §2.2/§2.5: a stock tile the car did not keep still reads OWNED. `owned` from the
      // export wins where the exporter knows; a stock tile is owned by definition.
      else if (t.owned || t.stock) badge = { cls: "own", text: "OWNED" };
      const eff = t.effect;
      return tileHTML({ i: i, name: t.name, unknown: !!t.unknown || t.name == null,
                        hi: i === hi, badge: badge, pos: t.pos || (i + 1),
                        ticked: isTarget && ticked,
                        sublabel: eff || null, sublabelBad: /(^|\s)-|\bWeight \+/.test(String(eff || "")) });
    }).join("");
    const cur = tiles[hi] || {};
    const curIsTarget = isTargetTile(m, menu, cur);
    // §0.3 — no price is drawn for an installed/owned part, nor for a stock (free) tile.
    const showPrice = !cur.stock && !cur.owned && !(curIsTarget && ticked) &&
                      typeof cur.price === "number" && cur.price > 0;
    // §0 prompts: the A entry is absent on the installed tile, reads `Install` on an owned
    // one, and `Buy and Install` on a purchasable one. A stock tile is always owned.
    const pstate = (curIsTarget && ticked) ? "installed"
      : (cur.owned || cur.stock || cur.price === 0) ? "owned" : "buy";
    // §5.8 — the banner belongs to the tile that unlocks. When the export pins it per tile,
    // only those tiles draw it; a menu-level `unlock` is the coarse fallback (non-stock only).
    const perTile = tiles.some(function (t) { return !!t.unlock; });
    const unlock = perTile ? (cur.unlock || null) : (!cur.stock ? menu.unlock : null);
    return '<div class="gs-panel">' +
      '<div class="gs-title"><button class="gs-back" data-gs="back">◀ Back</button><h3>' +
        esc(menu.title) + '</h3><span class="gs-crumb">Upgrade Shop › ' + esc(area.area) +
        " › " + esc(menu.title) + "</span></div>" +
      '<div class="gs-grid">' + grid + "</div>" +
      nameBarHTML(cur.name, showPrice ? cur.price : null, !!cur.unknown || cur.name == null) +
      statsHTML(m, st.statsPage) + footHTML(m) + promptsHTML("part", pstate) + "</div>" +
      '<div class="gs-side">' + unlockHTML(unlock) +
        '<div class="gs-note"><h4>Clone target</h4><ul>' +
          (!tgt
            ? "<li>No tile in this grid matches the build's <code>" + esc(menu.slot) +
              "</code> — nothing is marked TARGET.</li>"
            : "<li>Target tile: <code>" + esc(tgt.name || "UNKNOWN") + "</code>" +
              (targetName(m, menu) && targetName(m, menu) !== tgt.name
                ? " (build reads “" + esc(targetName(m, menu)) + "”)" : "") + "</li>") +
          "<li>" + (ticked ? "Ticked — counted as installed." : "Not ticked — still in the basket.") + "</li>" +
          (menu.tile_count && menu.tile_count !== tiles.length
            ? "<li>Export declares " + menu.tile_count + " tiles, " + tiles.length + " drawn.</li>" : "") +
        "</ul></div></div>";
  }

  // §2.4 / §5.2 — the tile reads `Front Rim Style`, the screen is titled `Rim Style`;
  // a paged 3x3 grid by brand with the brand card beside the name bar.
  function rimStyleHTML(m, st, area, menu) {
    const rl = rimList(m);
    const brands = rl.brands;
    if (!brands.length) {
      return '<div class="gs-panel"><div class="gs-title">' +
        '<button class="gs-back" data-gs="back">◀ Back</button><h3>' + esc(menu.title) +
        "</h3></div>" + '<div class="gs-empty">No rim catalogue in this export — ' +
        "§7 leaves the full Rim Style catalogue UNKNOWN.</div>" + footHTML(m) + "</div>" +
        '<div class="gs-side"></div>';
    }
    const bi = Math.min(st.brand, brands.length - 1);
    const brand = brands[bi];
    const rims = brand.rims || [];
    const pages = Math.max(1, Math.ceil(rims.length / 9));
    const pg = Math.min(st.page, pages - 1);
    const slice = rims.slice(pg * 9, pg * 9 + 9);
    const tgt = targetTile(m, menu);
    const ticked = !!(m.done || {})[menu.slot];
    const hi = Math.min(st.hi, Math.max(0, slice.length - 1));
    const grid = slice.map(function (r, i) {
      const isTarget = !!tgt && (tgt.pid != null ? r.pid === tgt.pid : r.name === tgt.name);
      const badge = isTarget ? (ticked ? { cls: "inst", text: "INSTALLED" } : { cls: "tgt", text: "TARGET" })
                             : (r.owned ? { cls: "own", text: "OWNED" } : null);
      // §10.6 — the lb per mass_level step belongs to the CAR, so an export that leaves
      // mass_lb null gets the class, never an invented weight.
      const mass = (typeof r.mass_lb === "number")
        ? "Weight " + (r.mass_lb > 0 ? "+" : "") + r.mass_lb + " lb"
        : (r.mass_level != null ? "class " + r.mass_level : null);
      return tileHTML({ i: i, name: r.name, unknown: r.name == null, hi: i === hi, badge: badge,
                        ticked: isTarget && ticked, pos: pg * 9 + i + 1,
                        sublabel: mass, sublabelBad: (r.mass_lb || 0) > 0 });
    }).join("");
    const cur = slice[hi] || {};
    const curIsTarget = !!tgt && (tgt.pid != null ? cur.pid === tgt.pid : cur.name === tgt.name);
    const showPrice = !(curIsTarget && ticked) && typeof cur.price === "number" && cur.price > 0;
    return '<div class="gs-panel">' +
      '<div class="gs-title"><button class="gs-back" data-gs="back">◀ Back</button><h3>' +
        esc(menu.title) + '</h3><span class="gs-crumb">Upgrade Shop › ' + esc(area.area) +
        " › " + esc(menu.title) + "</span></div>" +
      '<div class="gs-grid">' + grid + "</div>" +
      '<div class="gs-pager">' +
        '<button data-gs="brand" data-d="-1"' + (bi <= 0 ? " disabled" : "") + ">◀ brand</button>" +
        "<span>" + esc(brand.brand) + "</span>" +
        '<button data-gs="brand" data-d="1"' + (bi >= brands.length - 1 ? " disabled" : "") + ">brand ▶</button>" +
        '<span class="sp">page ' + (pg + 1) + "/" + pages + "</span>" +
        '<button data-gs="page" data-d="-1"' + (pg <= 0 ? " disabled" : "") + ">◀</button>" +
        '<button data-gs="page" data-d="1"' + (pg >= pages - 1 ? " disabled" : "") + ">▶</button>" +
      "</div>" +
      nameBarHTML(cur.name, showPrice ? cur.price : null, cur.name == null) +
      statsHTML(m, st.statsPage) + footHTML(m) +
      promptsHTML("part", (curIsTarget && ticked) ? "installed" : cur.owned ? "owned" : "buy") + "</div>" +
      '<div class="gs-side">' +
        '<div class="gs-brandcard"><div class="b">' + esc(brand.brand) + "</div>" +
        (brand.tagline ? '<div class="s">' + esc(brand.tagline) + "</div>" : "") + "</div>" +
        '<div class="gs-note"><h4>Rims are a weight class (§10.6)</h4><ul>' +
          "<li>A rim changes weight only — any rim in the same class clones the same.</li>" +
          (typeof (cur.mass_level) === "number" ? "<li>Highlighted class: " + cur.mass_level + "</li>" : "") +
          (((m.options && m.options.rims) || {}).stock_mass_level != null
            ? "<li>Stock class: " + m.options.rims.stock_mass_level + "</li>" : "") +
        "</ul></div></div>";
  }

  function shopHTML(m, st) {
    const inner = st.view === "root" ? shopRootHTML(m, st)
      : st.view === "category" ? shopCategoryHTML(m, st)
      : shopPartHTML(m, st);
    return '<div class="gs-shop">' + inner + "</div>";
  }

  /* ================================================================ TUNE view */
  function tuneRowHTML(def, row, allLocked, brakeTab, hi) {
    const missing = !row;
    const locked = allLocked || missing || (row && row.locked === true);
    const cls = ["gs-trow"];
    if (locked) cls.push("lk");
    if (hi) cls.push("hi");
    let val;
    if (locked) {
      val = '<span class="rv">' + LOCK + "</span>";
    } else if (row.value == null) {
      // measured-relative: the daemon has no absolute range for this slider on this car.
      val = '<span class="rv na" title="relative only — no absolute range for this car yet">' +
        "—</span>";
    } else {
      const f = num(row.value, def.dp);
      val = '<span class="rv">' + esc(f == null ? String(row.value) : f) +
        (def.sfx ? '<span class="u">' + def.sfx + "</span>" : "") + "</span>";
    }
    const p = missing ? 0 : pct(row.fill);
    return '<button class="' + cls.join(" ") + '" data-gs="trow" data-f="' + esc(def.field) + '">' +
      '<span class="rl">' + esc(def.label) + "</span>" +
      '<span class="gs-trk"><span class="f" style="width:' + p.toFixed(1) + '%"></span>' +
        '<span class="k" style="left:' + p.toFixed(1) + '%"></span></span>' +
      val + "</button>";
  }

  function tunePanelsHTML(m, st, ix, allLocked) {
    const T = TUNE_TABS[st.tab];
    let h = "";
    T.panels.forEach(function (p) {
      let rows = p.rows.slice();
      if (p.gears) {                                    // §3 — Final Drive then 1st..Nth
        gearFields(ix).forEach(function (i) {
          // §3 — the rows read `Final Drive`, `1st`, `2nd`, … not "1st gear"
          rows.push({ label: ordinal(i), field: "gear_" + i, dp: 2, sfx: "" });
        });
      }
      h += '<div class="gs-tp"><div class="gs-tph">' +
        '<span class="pn">' + esc(p.name) + "</span>" +
        '<span class="lo">' + esc(p.lo) + "</span>" +
        '<span class="hi">' + esc(p.hi) + "</span>" +
        '<span class="unit' + (p.unit ? "" : " none") + '">' + esc(p.unit || "") + "</span></div>";
      rows.forEach(function (r) {
        h += tuneRowHTML(r, ix[r.field], allLocked, T.tab === "BRAKE", st.row === r.field);
      });
      h += "</div>";
    });
    return h;
  }

  function perfHTML(m) {
    // §4.2 — while the sim re-runs the game prints the literal SIMULATING...
    let h = '<div class="gs-colh">Performance</div><div class="gs-perf">';
    PERF.forEach(function (g) {
      h += '<div class="gs-perfg"><div class="g">' + esc(g.g) + "</div>";
      g.rows.forEach(function (r) {
        const v = pick(m.stats, r.k);
        let txt, sim = false;
        if (v == null) { txt = "SIMULATING..."; sim = true; }
        else { const f = num(v, r.dp); txt = (f == null ? String(v) : f) + (r.u || ""); }
        h += '<div class="r"><span class="l">' + esc(r.l) + '</span><span class="v' +
          (sim ? " sim" : "") + '">' + esc(txt) + "</span></div>";
      });
      h += "</div>";
    });
    return h + "</div>";
  }

  function tuneDescHTML(m, st, ix, allLocked) {
    const T = TUNE_TABS[st.tab];
    let label = null, def = null;
    T.panels.forEach(function (p) {
      p.rows.forEach(function (r) { if (r.field === st.row) { label = r.label; def = r; } });
    });
    if (!def && T.panels[0] && T.panels[0].rows[0]) { def = T.panels[0].rows[0]; label = def.label; }
    const row = def ? ix[def.field] : null;
    const locked = allLocked || !row || (row && row.locked === true);
    let yellow = "";
    if (T.tab === "BRAKE" && locked) yellow = BRAKE_LOCK_NOTE;
    else if (allLocked) yellow = "LOCKED TUNE — THE GAME WILL NOT SHOW THESE VALUES.";
    return '<div class="gs-colh">Description</div><div class="gs-descpanel">' +
      '<div class="t">' + esc(T.tab) + (label ? " · " + esc(label) : "") + "</div>" +
      '<div class="b unk">Row description not captured — §7 leaves the Tune ' +
        "screen's Description text UNKNOWN.</div>" +
      (yellow ? '<div class="yellow">' + esc(yellow) + "</div>" : "") + "</div>";
  }

  function tuneHTML(m, st) {
    const d = m.deliverable || null;
    const ix = rowIndex(d);
    const allLocked = !!(m.locked || (d && d.locked));
    const strip = TUNE_TABS.map(function (t, i) {
      return '<button class="tab' + (i === st.tab ? " on" : "") + '" data-gs="ttab" data-i="' + i + '">' +
        esc(t.tab) + "</button>";
    }).join("");
    return '<div class="gs-tune">' +
      '<div class="gs-tunehd"><h3>Tune</h3><div class="gs-tabs">' +
        '<span class="bump">LB</span>' + strip + '<span class="bump">RB</span></div></div>' +
      '<div class="gs-3col">' +
        '<div class="gs-col">' + perfHTML(m) + "</div>" +
        '<div class="gs-col">' + (d ? tunePanelsHTML(m, st, ix, allLocked)
          : '<div class="gs-empty">no deliverable in the model — nothing to draw</div>') + "</div>" +
        '<div class="gs-col">' + tuneDescHTML(m, st, ix, allLocked) + "</div>" +
      "</div></div>";
  }

  /* ================================================================== shell -- */
  function shellHTML(m, st) {
    const o = m.options || {};
    const pi = m.stats && (m.stats.pi || m.stats.class_pi);
    return '<div class="gs-top">' +
      '<div class="gs-car">' + (pi ? '<span class="gs-pi">' + esc(pi) + "</span>" : "") +
        '<span class="gs-carname">' + esc(o.name || m.name || "") + "</span>" +
        (m.name && m.name !== o.name ? '<span class="gs-tunename">' + esc(m.name) + "</span>" : "") +
      "</div>" +
      (m.locked || (m.deliverable && m.deliverable.locked)
        ? '<span class="gs-lockchip">' + LOCK_BANNER + "downloaded tune</span>" : "") +
      '<div class="gs-screens">' +
        '<button data-gs="screen" data-s="shop" class="' + (st.screen === "shop" ? "on" : "") + '">Upgrade Shop</button>' +
        '<button data-gs="screen" data-s="tune" class="' + (st.screen === "tune" ? "on" : "") + '">Tune</button>' +
      "</div></div>" +
      '<div class="gs-body' + (st.screen === "shop" ? " on" : "") + '" data-gs-body="shop">' +
        (st.screen === "shop" ? shopHTML(m, st.shop) : "") + "</div>" +
      '<div class="gs-body' + (st.screen === "tune" ? " on" : "") + '" data-gs-body="tune">' +
        (st.screen === "tune" ? tuneHTML(m, st.tune) : "") + "</div>";
  }

  function draw(host) {
    const st = getState(host);
    if (!st) return;
    host.innerHTML = shellHTML(st.model, st);
  }

  /* ---------------------------------------------------------------- wiring -- */
  function onClick(ev) {
    const host = ev.currentTarget;
    const st = getState(host);
    if (!st) return;
    const el = ev.target && ev.target.closest ? ev.target.closest("[data-gs]") : null;
    if (!el || !host.contains(el)) return;
    const kind = el.getAttribute("data-gs");
    const m = st.model, sh = st.shop;

    if (kind === "screen") { st.screen = el.getAttribute("data-s"); draw(host); return; }
    if (kind === "back") {
      if (sh.view === "part") { sh.view = "category"; sh.hi = sh.menu; }
      else if (sh.view === "category") { sh.view = "root"; sh.hi = sh.area; }
      draw(host); return;
    }
    if (kind === "ytoggle") { sh.statsPage = (sh.statsPage + 1) % STAT_PAGES.length; draw(host); return; }
    if (kind === "brand") { sh.brand = Math.max(0, sh.brand + Number(el.getAttribute("data-d"))); sh.page = 0; sh.hi = 0; draw(host); return; }
    if (kind === "page") { sh.page = Math.max(0, sh.page + Number(el.getAttribute("data-d"))); sh.hi = 0; draw(host); return; }
    if (kind === "ttab") { st.tune.tab = Number(el.getAttribute("data-i")) || 0; st.tune.row = null; draw(host); return; }
    if (kind === "trow") { st.tune.row = el.getAttribute("data-f"); draw(host); return; }

    if (kind === "tile") {
      const i = Number(el.getAttribute("data-i")) || 0;
      if (sh.view === "root") { sh.area = i; sh.view = "category"; sh.hi = 0; draw(host); return; }
      if (sh.view === "category") { sh.menu = i; sh.view = "part"; sh.hi = 0; sh.page = 0; sh.brand = 0; draw(host); return; }
      // part screen — highlight, and tick the checklist when the tile IS the clone's target
      const area = ((m.options && m.options.shop) || [])[sh.area];
      const menus = area ? visibleMenus(area, m) : [];
      const menu = menus[sh.menu];
      const wasHi = sh.hi === i;
      sh.hi = i;
      if (menu) {
        let tile = null;
        if (isRimMenu(menu)) {
          const rl = rimList(m), brand = rl.brands[Math.min(sh.brand, rl.brands.length - 1)];
          const rims = (brand && brand.rims) || [];
          tile = rims.slice(sh.page * 9, sh.page * 9 + 9)[i] || null;
        } else {
          tile = (menu.tiles || [])[i] || null;
        }
        const tgt = targetTile(m, menu);
        const hitTarget = !!tile && !!tgt &&
          (tgt.pid != null ? tile.pid === tgt.pid : tile.name === tgt.name);
        if (hitTarget && wasHi) {
          const now = !(m.done || {})[menu.slot];
          m.done = m.done || {};
          m.done[menu.slot] = now;
          if (typeof m.onDone === "function") { try { m.onDone(menu.slot, now); } catch (e) {} }
        }
      }
      draw(host); return;
    }
  }

  /* ------------------------------------------------------------------- API -- */
  const GameSheet = {
    render: function (host, model) {
      if (!host) return;
      const prev = getState(host);
      const st = {
        model: model || {},
        screen: (prev && prev.screen) || "shop",
        shop: (prev && prev.shop) || { view: "root", area: 0, menu: 0, hi: 0, page: 0, brand: 0, statsPage: 0 },
        tune: (prev && prev.tune) || { tab: 0, row: null },
        onClick: (prev && prev.onClick) || null
      };
      if (!st.onClick) {
        st.onClick = onClick;
        host.addEventListener("click", onClick);
      }
      host.classList.add("gsheet");
      setState(host, st);
      draw(host);
      return GameSheet;
    },
    destroy: function (host) {
      if (!host) return;
      const st = getState(host);
      if (st && st.onClick) host.removeEventListener("click", st.onClick);
      delState(host);
      host.classList.remove("gsheet");
      host.innerHTML = "";
    },
    // exposed for the dev fixture / tests — pure, no DOM
    _fmt: { cr: cr, num: num, basket: basket, tabs: TUNE_TABS }
  };

  root.GameSheet = GameSheet;
})(typeof window !== "undefined" ? window : this);
