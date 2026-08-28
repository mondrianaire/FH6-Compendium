/* FH6 Tuning Decision Dashboard — reads window.FH6_DB (built from data/*.json). */
(function () {
  const DB = window.FH6_DB;
  if (!DB) { document.body.innerHTML = "<p style='padding:24px'>db.js not loaded. Run <code>node scripts/build-db.mjs</code>.</p>"; return; }

  const cars = DB.metaCars.cars;
  const classes = DB.metaCars.pi_classes;
  // PI class badge — in-game design language (player screenshot 2026-07-31)
  const PI_CAP = { D: 400, C: 500, B: 600, A: 700, S1: 800, S2: 900, R: 998, X: 999 };
  function clsBadge(cls, cap) {
    if (!cls) return "";
    const one = (c, showCap) => {
      const u = String(c).toUpperCase().trim();
      if (PI_CAP[u] == null) return `<span class="pib"><b style="background:var(--bg3)">${u}</b></span>`;
      return `<span class="pib pib-${u.toLowerCase()}"><img class="pib-img" src="assets/badges/class-${u.toLowerCase()}.png" alt="${u}" onerror="this.outerHTML='<b>${u}</b>'">${showCap ? `<i>${PI_CAP[u]}</i>` : ""}</span>`;
    };
    const parts = String(cls).split("-").map((x) => x.trim());
    if (parts.length === 2 && PI_CAP[parts[0].toUpperCase()] != null && PI_CAP[parts[1].toUpperCase()] != null)
      return `${one(parts[0], false)}<span class="pib-dash">–</span>${one(parts[1], !!cap)}`;
    return one(cls, !!cap);
  }
  // the SAME in-game badge with the car's ACTUAL PI in the dark cell (clsBadge's flag shows the class CEILING —
  // a menu/regulation context). Class derives from the PI when the caller only has the number. sm = dense-row size.
  const CLS_OF_PI = (pi) => { const n = +pi; return !isFinite(n) ? null : n <= 400 ? "D" : n <= 500 ? "C" : n <= 600 ? "B" : n <= 700 ? "A" : n <= 800 ? "S1" : n <= 900 ? "S2" : n <= 998 ? "R" : "X"; };
  function piBadge(cls, pi, sm) {
    const u = cls ? String(cls).toUpperCase().trim() : (pi != null ? CLS_OF_PI(pi) : null);
    const cell = pi != null && pi !== "" ? `<i>${pi}</i>` : "";
    const wrap = `pib${sm ? " pib--sm" : ""}`;
    if (!u || PI_CAP[u] == null) return (cell || u) ? `<span class="${wrap}"><b style="background:var(--bg3)">${u || "?"}</b>${cell}</span>` : "";
    return `<span class="${wrap} pib-${u.toLowerCase()}"><img class="pib-img" src="assets/badges/class-${u.toLowerCase()}.png" alt="${u}" onerror="this.outerHTML='<b>${u}</b>'">${cell}</span>`;
  }
  const disciplines = DB.metaCars.disciplines;
  const DISCIPLINE_LABEL = {
    road: "Road", touge: "Touge (1v1 duels)", street: "Street (night/traffic)", touge_street: "Touge / Street",
    dirt_rally: "Dirt / Rally", cross_country: "Cross Country", drag: "Drag", drift: "Drift"
  };
  // what tuning attributes each race category rewards — shown under the coverage-matrix headers
  const DISCIPLINE_TUNING = {
    road: "grip + balanced power, moderate downforce",
    touge: "class-capped momentum: cornering grip, rotation, compliance, short gearing",
    street: "classless: fastest STABLE car — braking + high-speed stability, top-end",
    touge_street: "cornering grip, brakes, downforce, short gearing",
    dirt_rally: "soft suspension, AWD, raised ride height, rally tyres",
    cross_country: "max ride height, AWD, off-road tyres, durability",
    drag: "launch + gearing + power, minimal aero, drag tyres",
    drift: "RWD only, angle kit, power-to-slide balance — score, not speed"
  };
  // normalise free-text acquisition into one of ~9 canonical methods (homogenised "Get it")
  const acqDot = (d) => !d ? "" : d.startsWith("easy") ? "🟢" : d.startsWith("medium") ? "🟡" : d.startsWith("hard") ? "🔴" : d === "premium" ? "💰" : "";
  function acqMethod(c) {
    const a = (c.acquisition || "").toLowerCase();
    const has = (...k) => k.some((x) => a.includes(x));
    // primary Autoshow wins over keywords in disambiguation notes (e.g. "distinct from the ... DLC variant")
    if (a.includes("autoshow") && has("buy anytime", "always available") && !has("not in autoshow", "not sold")) return "Autoshow";
    if (has("mastery")) return "Car Mastery";
    if (has("treasure")) return "Treasure Car";
    if (has("barn find")) return "Barn Find";
    if (has("aftermarket")) return "Aftermarket spawn";
    if (has("wheelspin")) return "Wheelspin (RNG)";
    if (has("playlist")) return has("passed", "ended", "auction house only", "over") ? "Playlist reward (ended)" : "Playlist reward";
    if (has("journal", "collection", "tier", "promo")) return "Journal reward";
    if (has("welcome pack", "deluxe", "premium edition", "vip", " dlc", "paid ")) return "Paid DLC";
    if (has("auction")) return "Auction House";
    if (a.includes("autoshow") && !has("not in autoshow", "not sold in the autoshow", "not sold in autoshow")) return "Autoshow";
    return c.acquisition_difficulty === "easy" ? "Autoshow" : c.acquisition_difficulty === "premium" ? "Paid DLC" : c.acquisition_difficulty === "hard" ? "Wheelspin (RNG)" : "Special reward";
  }
  const fmtCr = (n) => n == null ? "—" : n.toLocaleString("en-US") + " cr";
  // when a car has no credit price, the price slot names the source instead (player request 2026-08-01)
  const priceOrSource = (c) => {
    if (c.price_credits != null) return fmtCr(c.price_credits);
    const a = (c.acquisition || "").toLowerCase();
    if (/vip|car pass|paid dlc|premium edition|time attack car pack/.test(a)) return "💰 DLC";
    if (/wheelspin/.test(a) && !/not wheelspin/.test(a)) return "🎰 Wheelspin";
    if (/journal|loyalty|reward|collection/.test(a)) return "🎁 Reward";
    return "—";
  };
  const confClass = (c) => c === "verified" ? "conf-verified" : c === "contested" ? "conf-contested" : "conf-probable";
  const confLabel = (c) => c === "verified" ? "✅ verified" : c === "contested" ? "⚠️ contested" : "🟡 probable";
  // 53Rain tune-meta strength (drives ranking): meta > favourite > road > (untagged)
  const TM_RANK = { meta: 0, favorite: 1, road: 2 };
  const tuneMetaRank = (c) => TM_RANK[c && c.tune_meta] ?? 3;
  const tmBadge = (c) => !c ? "" : c.tune_meta === "meta" ? '<span class="badge tm-meta">53Rain META</span>'
    : c.tune_meta === "favorite" ? '<span class="badge tm-fav">53Rain FAV</span>'
    : c.tune_meta === "road" ? '<span class="badge tm-road">53Rain ROAD</span>' : "";
  const fh6Class = (c) => c === "fh6_confirmed" ? "conf-verified" : c === "needs_ingame" ? "conf-contested" : "conf-probable";
  const fh6Label = (c) => c === "fh6_confirmed" ? "✅ FH6" : c === "needs_ingame" ? "❌ in-game" : "🟡 FH6";
  // 200M+ cr banked (player_state 2026-08-01): price is irrelevant — availability is the axis.
  const acqLabel = (dOrCar) => {
    const c = typeof dOrCar === "object" ? dOrCar : null;
    const d = c ? c.acquisition_difficulty : dOrCar;
    if (c && c.acquisition_disputed) return "⚠️ disputed — see card";
    if (d === "easy") return c && c.autoshow === false ? "🎁 free — play required" : "🛒 Autoshow — buy now";
    if (d === "medium") return "🟡 some effort";
    if (d === "hard" || d === "hard-unconfirmed") return "🔴 luck-gated grind";
    if (d === "premium") return "💰 premium (real money)";
    return "";
  };
  const acqClass = (dOrCar) => {
    const c = typeof dOrCar === "object" ? dOrCar : null;
    const d = c ? c.acquisition_difficulty : dOrCar;
    if (c && c.acquisition_disputed) return "acq-disputed";
    if (d === "easy") return c && c.autoshow === false ? "acq-free" : "acq-easy";
    return "acq-" + String(d || "").split("-")[0];
  };
  // P2W doctrine (player, 2026-08-10): real-money cars are permanently off the table —
  // struck through + subtle red wash everywhere a car renders. Disputed cars exempt until resolved.
  // Curated tag ONLY — free-text sniffing false-positives hard ("Vip" matches inside "Viper",
  // "with VIP" discount asides, "Also in the Welcome Pack" bundle mentions). Real-money cars
  // missing the tag get fixed in DATA, not sniffed here.
  const isP2W = (c) => !!c && typeof c === "object" && !c.acquisition_disputed &&
    (c.acquisition_difficulty === "premium" || c.get === "premium"); // .get = drift-guide's curated field
  const p2wName = (c, html) => isP2W(c) ? `<s class="p2w-name" title="Pay-to-win: real money only — not expected in the garage">${html}</s>` : html;
  const tuneConf = (c) => c === "player-verified" ? "✅ verified" : c === "sourced-unverified" ? "🟡 sourced"
    : c === "suspect" ? "❌ suspect" : "ℹ️ method";
  const tuneLine = (t) => {
    const head = t.code
      ? `<code>${t.code}</code> <span class="acq">${tuneConf(t.confidence)}</span> <span style="font-size:11px;color:var(--muted)">${t.surface || ""}${t.source ? " · " + t.source : ""}</span>`
      : `<span class="acq">${tuneConf(t.confidence)}</span> ${t.method || ""}`;
    return `<div style="padding:4px 0">${head}${t.note ? `<br><span style="font-size:11px;color:var(--muted)">${t.note}</span>` : ""}</div>`;
  };

  // ---- tune-code tooltips (zero screen-space; 53Rain codes surface on hover) ----
  const tnorm = (s) => (s || "").toLowerCase()
    .replace(/\([^)]*\)/g, " ").replace(/\b(19|20)\d\d\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const TCODE_INDEX = ((DB.tuneCodes && DB.tuneCodes.classes) || []).flatMap((cl) =>
    cl.cars.filter((c) => c.code).map((c) => ({
      code: c.code, note: c.note || "", cls: cl.class, car: c.car,
      tokens: new Set(tnorm(c.car).split(" ").filter(Boolean))
    })));
  // conservative fuzzy match: same make + >=3 shared tokens (avoids cross-generation mismatches)
  // Non-distinguishing tokens: shared across many cars, so they must NOT be enough to match on their own.
  // (e.g. "Forza Edition" is a suffix on dozens of cars — matching on make + "forza edition" alone binds
  //  the wrong car, e.g. BRZ FE -> Vivio RX-R FE.)
  // Category/prefix words shared across many cars — not model identifiers. Matching on these alone
  // binds the wrong car (BRZ FE↔Vivio FE via "forza edition"; #777 240SX↔599 GTB via "formula drift").
  const GENERIC_TOK = new Set(["forza", "edition", "the", "formula", "drift", "motorsports"]);
  const modelToks = (qt, make) => qt.filter((t) => t !== make && !GENERIC_TOK.has(t));
  function matchTuneCode(name) {
    const qt = tnorm(name).split(" ").filter(Boolean);
    if (!qt.length) return null;
    const make = qt[0];
    const model = modelToks(qt, make);
    let best = null, bs = 0;
    for (const e of TCODE_INDEX) {
      if (!e.tokens.has(make)) continue;
      if (!model.some((t) => e.tokens.has(t))) continue; // must share a real model token, not just make + suffix
      const shared = qt.filter((t) => e.tokens.has(t)).length;
      if (shared > bs && shared >= 3) { best = e; bs = shared; }
    }
    return best;
  }
  // ---- ingested tuner-sheet pool (1600+ community codes) ----
  const POOL = ((DB.tunerSheets && DB.tunerSheets.tunes) || []).map((t) => ({
    ...t, tokens: new Set(tnorm(t.car).split(" ").filter(Boolean)),
  }));
  const META_CREATORS = new Set(
    Object.values((DB.tunerRoster && DB.tunerRoster.specialty_index) || {}).flat().map((s) => s.toLowerCase())
  );
  // map a dashboard discipline key → a pool discipline bucket
  const DISC_BUCKET = { road: "road", touge_street: "road", touge: "road", street: "road", dirt_rally: "dirt/offroad", cross_country: "dirt/offroad", offroad: "dirt/offroad", drift: "drift", drag: "drag" };
  // best pool tune for a car: make + ≥2 shared tokens, prefer class, then discipline, then a curated ("good") tuner
  function poolMatch(name, cls, buckets) {
    const qt = tnorm(name).split(" ").filter(Boolean);
    if (!qt.length || !POOL.length) return null;
    const make = qt[0];
    const model = modelToks(qt, make); // distinguishing (non-make, non-suffix) tokens
    let best = null, bestScore = -1;
    for (const e of POOL) {
      if (!e.tokens.has(make)) continue;
      const sharedModel = model.filter((t) => e.tokens.has(t)).length;
      if (sharedModel < 1) continue; // MUST match the real model — not just make + "forza edition"
      // never cross disciplines: a road/drift car must not be handed a dirt build (drift ≠ dirt ≠ road ≠ drag).
      // (only filters when both the car's discipline and the tune's discipline are known.)
      if (buckets && buckets.size && e.discipline && !buckets.has(e.discipline)) continue;
      const shared = qt.filter((t) => e.tokens.has(t)).length;
      if (shared < 2) continue;
      let score = sharedModel * 12 + shared * 6; // weight real-model matches above generic overlap
      if (cls && e.class === cls) score += 8;
      if (buckets && buckets.size && e.discipline && buckets.has(e.discipline)) score += 5;
      if (META_CREATORS.has((e.creator || "").toLowerCase())) score += 2;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }
  const bucketsFor = (carObj) => new Set(((carObj && carObj.disciplines) || []).map((d) => DISC_BUCKET[d]).filter(Boolean));

  // curated codes (attached directly to a car) win over fuzzy matches
  function curatedCode(carObj) {
    if (!carObj) return null;
    if (carObj.tune_code) return { code: carObj.tune_code, note: carObj.tune_source || "", src: carObj.tune_source || "53Rain" };
    const t = (carObj.tunes || []).find((x) => x.code); if (t) return { code: t.code, note: t.note || "", src: t.source || "" };
    const s = (carObj.share_codes || []).find((x) => x.code); if (s) return { code: s.code, note: s.purpose || "", src: s.source || "" };
    return null;
  }
  // returns a tiny 🔑 with the code in a native tooltip, or "" if no code is known
  function codeTip(name, carObj) {
    let c = curatedCode(carObj);
    if (!c) { const p = poolMatch(name, carObj && carObj.class, bucketsFor(carObj)); if (p) c = { code: p.code, note: [p.focus, p.creator].filter(Boolean).join(" · "), src: p.source }; }
    if (!c) { const m = matchTuneCode(name); if (m) c = { code: m.code, note: m.note, src: "53Rain " + m.cls }; }
    if (!c || !c.code) return "";
    const title = `Tune code ${c.code}${c.note ? " — " + c.note : ""}${c.src ? " · " + c.src : ""} · verify in-game (Find Tuning Setups)`;
    return ` <span class="code-key" title="${title.replace(/"/g, "&quot;")}">🔑</span>`;
  }

  // ---- raw tune data + deterministic focus inference ----
  const RAW_TUNES = (DB.tuneRaw && DB.tuneRaw.tunes) || [];
  function rawTuneFor(name) {
    const q = tnorm(name);
    return RAW_TUNES.find((t) => { const m = tnorm(t.match_car); return q.includes(m) || m.includes(q); }) || null;
  }
  // infer what a tune is BUILT FOR, purely from its slider values (heuristic, labelled as such)
  function inferFocus(r) {
    const sig = [];
    const psi = ((r.tire_psi_f ?? 0) + (r.tire_psi_r ?? 0)) / 2;
    if (psi) sig.push(psi < 28 ? `Low tyre pressure (${psi.toFixed(1)} psi) → maximises grip`
      : psi > 32 ? `High tyre pressure (${psi.toFixed(1)} psi) → response over outright grip`
      : `Mid tyre pressure (${psi.toFixed(1)} psi) → balanced`);
    const fd = r.final_drive;
    if (fd != null) sig.push(fd >= 3.8 ? `Short final drive (${fd}) → acceleration/technical, not top speed`
      : fd <= 3.0 ? `Long final drive (${fd}) → top-speed biased` : `Mid final drive (${fd}) → balanced accel/top-end`);
    const df = (r.df_f ?? 0) + (r.df_r ?? 0);
    if (r.df_f != null || r.df_r != null) sig.push(df >= 200 ? `High downforce (${df} lb) → cornering grip (circuit/touge)`
      : df === 0 ? `Zero downforce → low-drag top-speed/drag build` : `Light downforce (${df} lb) → mild cornering aid`);
    if (r.brake_bal != null) sig.push(r.brake_bal > 54 ? `Front brake bias (${r.brake_bal}%) → stable braking`
      : r.brake_bal < 46 ? `Rear brake bias (${r.brake_bal}%) → trail-brake rotation` : `Neutral brake balance (${r.brake_bal}%)`);
    if (r.diff_accel_r != null) sig.push(r.diff_accel_r >= 80 ? `High rear accel lock (${r.diff_accel_r}%) → aggressive power-down/rotation`
      : r.diff_accel_r <= 40 ? `Loose diff (${r.diff_accel_r}% accel) → smooth traction` : `Moderate diff lock (${r.diff_accel_r}% accel)`);
    // ride height omitted: absolute value is car-dependent (no reliable baseline) — inferring dirt/road from it misleads
    // primary label
    const grip = psi && psi < 28, shortG = fd >= 3.8, aero = df >= 200, longG = fd <= 3.0, noAero = df === 0;
    let primary = "Balanced road";
    if (noAero && longG) primary = "Top-speed / drag";
    else if (r.diff_accel_r >= 85 && r.brake_bal < 46) primary = "Drift / rotation";
    else if (aero && shortG && grip) primary = "Grip / technical (touge / circuit)";
    else if (grip && (shortG || aero)) primary = "Grip-biased road";
    else if (longG) primary = "Speed-biased road";
    return { primary, signals: sig };
  }

  // ---- tune resolution: bind a tune to EVERY recommendation (car-specific code, else class+format template) ----
  const TMPL_BY_DISC = { road: "Road", touge_street: "Touge", touge: "Touge", street: "Road", drift: "Drift", dirt_rally: "Dirt", cross_country: "Cross", drag: "Drag" };
  function pickTemplate(disc) {
    const k = TMPL_BY_DISC[disc]; if (!k) return null;
    return ((DB.tuningTemplates && DB.tuningTemplates.templates) || []).find((t) => (t.label || "").includes(k)) || null;
  }
  function resolveTune(c) {
    const cur = curatedCode(c);
    if (cur && cur.code) return { level: "car", code: cur.code, source: cur.src || "community", note: cur.note };
    const p = poolMatch(c.name, c.class, bucketsFor(c));
    if (p) return { level: "pool", code: p.code, source: p.source, creator: p.creator, note: [p.focus, p.discipline].filter(Boolean).join(" · ") };
    const m = matchTuneCode(c.name);
    if (m) return { level: "car", code: m.code, source: "53Rain " + m.cls };
    const disc = (c.disciplines || [])[0];
    const tmpl = pickTemplate(disc);
    if (tmpl) return { level: "template", discipline: disc, tmpl };
    return null;
  }
  const tuneChip = (c) => {
    const t = resolveTune(c);
    if (!t) return "";
    if (t.level === "template") return `📋 ${DISCIPLINE_LABEL[t.discipline] || "format"} template`;
    if (t.level === "pool") return `🔑 ${t.creator ? t.creator + " code" : "community code"}`;
    return "🔑 car code";
  };

  // ---- owned-car tracking (localStorage — user state stays local; data/*.json stays facts-only) ----
  const OWNED_KEY = "fh6_owned_cars";
  let owned = {};
  try { owned = JSON.parse(localStorage.getItem(OWNED_KEY)) || {}; } catch (e) { owned = {}; }
  // Public build: visitors start with an EMPTY garage and track their own via localStorage (above).
  // The owner's captured garage (owned-cars.json) is opt-in DEMO data, loaded via the button in the Garage tracker.
  const SEED_KEY = "fh6_load_demo_garage";
  const seedOn = (() => { try { return localStorage.getItem(SEED_KEY) === "1"; } catch (e) { return false; } })();
  const SEED_OWNED = new Set(seedOn ? ((DB.ownedCars && DB.ownedCars.owned_meta_ids) || []) : []);
  const isOwned = (id) => !!owned[id] || SEED_OWNED.has(id);
  const setDemoGarage = (on) => { try { on ? localStorage.setItem(SEED_KEY, "1") : localStorage.removeItem(SEED_KEY); } catch (e) { /* private mode */ } location.reload(); };
  function setOwned(id, val) {
    if (val) owned[id] = true; else delete owned[id];
    try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned)); } catch (e) { /* private mode: state won't persist */ }
    drawGarage();
    render();
  }

  // ---- stamps ----
  // "Updated" = when the compendium was last built/deployed (self-updating via build stamp).
  // Meta-car rankings carry their own capture + re-verify provenance (in the data + footer).
  const reverify = DB.metaCars.meta_recheck && DB.metaCars.meta_recheck.date;
  document.getElementById("metaStamp").textContent =
    "Updated " + DB.builtAt + (reverify ? " · meta re-verified " + reverify : "") + " — FH6 is live; rankings shift with patches.";
  document.getElementById("footStamp").textContent =
    "Built " + DB.builtAt + " · meta captured " + DB.metaCars.captured;

  // ---- tabs ----
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById(t.dataset.tab).classList.add("active");
    })
  );

  // ---- filters ----
  const fDiscipline = document.getElementById("fDiscipline");
  const fClass = document.getElementById("fClass");
  const fBudget = document.getElementById("fBudget");
  const fFreeOnly = document.getElementById("fFreeOnly");

  fDiscipline.appendChild(opt("", "Any discipline"));
  disciplines.forEach((d) => fDiscipline.appendChild(opt(d, DISCIPLINE_LABEL[d] || d)));
  fClass.appendChild(opt("", "Any class"));
  Object.keys(classes).forEach((c) => fClass.appendChild(opt(c, `${c} (${classes[c]})`)));

  [fDiscipline, fClass, fFreeOnly].forEach((el) => el.addEventListener("change", render));
  fBudget.addEventListener("input", render);
  document.getElementById("resetBtn").addEventListener("click", () => {
    fDiscipline.value = ""; fClass.value = ""; fBudget.value = ""; fFreeOnly.checked = false; render();
  });

  function opt(v, label) { const o = document.createElement("option"); o.value = v; o.textContent = label; return o; }

  function isFree(c) {
    const a = (c.acquisition || "").toLowerCase();
    return c.price_credits === 0 || a.includes("free") || a.includes("reward") || a.includes("collection journal") || a.includes("wheelspin");
  }

  // class strings like "D-B" span classes; expand to the full list
  const CLASS_ORDER = ["D", "C", "B", "A", "S1", "S2", "R"];
  function expandClass(cls) {
    if (!cls) return [];
    if (cls.includes("-")) {
      const [lo, hi] = cls.split("-");
      const i = CLASS_ORDER.indexOf(lo), j = CLASS_ORDER.indexOf(hi);
      if (i >= 0 && j >= i) return CLASS_ORDER.slice(i, j + 1);
    }
    return [cls];
  }
  // does car c have an evidenced fit for (discipline d, class cl)? "" = wildcard
  function fitsSlot(c, d, cl) {
    const av = c.also_viable_in || [];
    if (d && cl) return (expandClass(c.class).includes(cl) && c.disciplines.includes(d)) ||
      av.some((v) => v.class === cl && v.discipline === d);
    if (d) return c.disciplines.includes(d) || av.some((v) => v.discipline === d);
    if (cl) return expandClass(c.class).includes(cl) || av.some((v) => v.class === cl);
    return true;
  }

  function render() {
    const d = fDiscipline.value, cl = fClass.value;
    const budget = fBudget.value ? Number(fBudget.value) : null;
    const freeOnly = fFreeOnly.checked;

    let list = cars.filter((c) => {
      if (!fitsSlot(c, d, cl)) return false;
      if (budget != null && c.price_credits != null && c.price_credits > budget) return false;
      if (freeOnly && !isFree(c)) return false;
      return true;
    });
    drawMatrix();

    // rank: tier S>A>B, then value_rating, then known price asc
    const tierRank = { S: 0, A: 1, B: 2 };
    list.sort((a, b) =>
      (tuneMetaRank(a) - tuneMetaRank(b)) ||
      (tierRank[a.tier] - tierRank[b.tier]) ||
      (b.value_rating - a.value_rating) ||
      ((a.price_credits ?? Infinity) - (b.price_credits ?? Infinity))
    );

    document.getElementById("resultCount").textContent =
      `${list.length} car${list.length === 1 ? "" : "s"} match — 53Rain tune-meta picks first, then tier & value.`;

    const grid = document.getElementById("recoCards");
    grid.innerHTML = "";
    if (!list.length) { grid.innerHTML = "<p class='empty'>No cars match these filters. Loosen the budget or class.</p>"; return; }
    list.forEach((c, i) => grid.appendChild(card(c, i === 0)));
  }

  // ---- class × format coverage matrix ----
  function bestForSlot(d, cl) {
    const tierRank = { S: 0, A: 1, B: 2 };
    return cars.filter((c) => fitsSlot(c, d, cl)).sort((a, b) =>
      (tuneMetaRank(a) - tuneMetaRank(b)) ||
      (tierRank[a.tier] - tierRank[b.tier]) ||
      (b.value_rating - a.value_rating) ||
      ((a.price_credits ?? Infinity) - (b.price_credits ?? Infinity)))[0] || null;
  }
  // top-N ranked picks for a slot (multi-car, not just the single best)
  function topForSlot(d, cl, n) {
    const tierRank = { S: 0, A: 1, B: 2 };
    return cars.filter((c) => fitsSlot(c, d, cl)).sort((a, b) =>
      (tuneMetaRank(a) - tuneMetaRank(b)) ||
      (tierRank[a.tier] - tierRank[b.tier]) ||
      (b.value_rating - a.value_rating) ||
      ((a.price_credits ?? Infinity) - (b.price_credits ?? Infinity))).slice(0, n || 3);
  }

  function drawMatrix() {
    const host = document.getElementById("covMatrix");
    if (!host) return;
    // street is excluded on purpose: no class caps there, so class x format is meaningless
    const MD = disciplines.filter((d) => d !== "street");
    let covered = 0, ownedCount = 0;
    const total = CLASS_ORDER.length * MD.length;
    const rows = CLASS_ORDER.map((cl) => {
      const cells = MD.map((d) => {
        const picks = topForSlot(d, cl, 3);
        const pick = picks[0];
        if (pick) { covered++; if (isOwned(pick.id)) ownedCount++; }
        const cellClass = !pick ? "cov-gap" : isOwned(pick.id) ? "cov-owned" : "cov-have";
        const nm = (p) => `${p2wName(p, p.name)}${!(expandClass(p.class).includes(cl) && p.disciplines.includes(d)) ? " ↗" : ""}${isOwned(p.id) ? " ✓" : ""}`;
        const label = pick
          ? `<div class="cell-top">${nm(pick)}${codeTip(pick.name, pick)}</div>${picks.slice(1).map((p) => `<div class="cell-alt">${nm(p)}${codeTip(p.name, p)}</div>`).join("")}`
          : "—";
        const title = pick ? `Top picks: ${picks.map((p) => `${isP2W(p) ? "💰 " : ""}${p.year} ${p.name} (${p.tier})`).join("  ·  ")}` : "GAP: no evidenced pick in the database yet";
        return `<td class="${cellClass}" data-d="${d}" data-cl="${cl}" title="${title}">${label}</td>`;
      }).join("");
      return `<tr><th>${clsBadge(cl, true)}</th>${cells}</tr>`;
    }).join("");

    host.innerHTML = `
      <div class="block" style="margin-top:0">
        <div class="card-row" style="margin-top:0">
          <h3 style="margin:0">Class × format coverage — a competitive car for every slot</h3>
          <span class="conf conf-probable">${covered}/${total} slots covered · ${ownedCount} owned</span>
        </div>
        <div style="overflow-x:auto;margin-top:8px"><table class="cov-table">
          <thead><tr><th></th>${MD.map((d) => `<th>${DISCIPLINE_LABEL[d] || d}${DISCIPLINE_TUNING[d] ? `<span class="col-tune">${DISCIPLINE_TUNING[d]}</span>` : ""}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody></table></div>
        <p class="why" style="margin:8px 0 0">Each cell shows the <strong>top ~3 picks</strong> (bold = best, then runners-up). 🟩 owned · 🟨 pick exists, not owned yet · dim = GAP. ↗ = cross-class build backed by leaderboard evidence. Click a cell for the full ranked list below.</p>
        ${DB.metaCars.discipline_split ? `
        <div style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-top:10px">
          <strong>🌃 Street Racing has no column on purpose.</strong>
          <span class="why">Street events (15 night point-to-point, civilian traffic, no barriers) have <strong>NO class restrictions</strong> — "a car per class" is meaningless there. Bring your fastest STABLE car: braking + high-speed stability beat everything, night + traffic punish twitchy builds. Current inference-grade picks (no street meta source yet): filter the cards by <em>Street</em>.</span>
        </div>` : ""}
      </div>`;
    host.querySelectorAll("td[data-d]").forEach((td) =>
      td.addEventListener("click", () => {
        fDiscipline.value = td.dataset.d; fClass.value = td.dataset.cl; render();
        document.getElementById("resultCount").scrollIntoView({ behavior: "smooth", block: "center" });
      }));
  }

  function card(c, top) {
    const el = document.createElement("div");
    el.className = "car-card" + (isP2W(c) ? " p2w" : "");
    el.innerHTML = `
      <div class="card-row" style="margin-top:0">
        <span>${tmBadge(c)}<span class="badge tier-${c.tier}">${top ? "★ TOP PICK • " : ""}TIER ${c.tier}</span></span>
        <span>${isOwned(c.id) ? '<span class="conf conf-verified">✓ owned</span> ' : ""}<span class="conf ${confClass(c.confidence)}">${confLabel(c.confidence)}</span></span>
      </div>
      <h3>${p2wName(c, `${c.year ? c.year + " " : ""}${c.name}`)}${codeTip(c.name, c)}</h3>
      <div class="card-row"><span>${clsBadge(c.class, true)} · ${c.recommended_drivetrain}</span><span class="price">${priceOrSource(c)}</span></div>
      ${c.acquisition_difficulty ? `<div class="card-row"><span class="acq ${acqClass(c)}">${acqLabel(c)}</span></div>` : ""}
      <div class="value-bar"><span style="width:${c.value_rating * 10}%"></span></div>
      <div class="chips"><span class="chip">${tuneChip(c)}</span>${c.disciplines.map((d) => `<span class="chip">${DISCIPLINE_LABEL[d] || d}</span>`).join("")}</div>
    `;
    el.addEventListener("click", () => openModal(c));
    return el;
  }

  // ---- modal ----
  const modal = document.getElementById("modal");
  const closeModal = () => { modal.classList.add("hidden"); modal.querySelector(".modal-box").classList.remove("wide"); };
  document.getElementById("modalClose").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  function openModal(c) {
    const tb = c.tune_baseline;
    const tuneHtml = tb ? `
      <h3>Tune baseline ${tb.note ? "" : "(AWD circuit start)"}</h3>
      <div class="tune-grid">
        ${tb.tire_psi_front != null ? `<div>Front tire</div><div>${tb.tire_psi_front} psi</div>` : ""}
        ${tb.tire_psi_rear != null ? `<div>Rear tire</div><div>${tb.tire_psi_rear} psi</div>` : ""}
        ${tb.diff_accel != null ? `<div>Diff accel</div><div>${tb.diff_accel}%</div>` : ""}
        ${tb.diff_decel != null ? `<div>Diff decel</div><div>${tb.diff_decel}%</div>` : ""}
        ${tb.diff_center_rear != null ? `<div>AWD center</div><div>${tb.diff_center_rear}% rear</div>` : ""}
        ${tb.brake_balance_front != null ? `<div>Brake balance</div><div>${tb.brake_balance_front}% front</div>` : ""}
      </div>
      ${tb.note ? `<p class="why">${tb.note}</p>` : ""}` :
      `<p class="why">No per-car tune baseline captured yet — use the generic AWD-circuit baseline in the Tuning Variables tab as a start.</p>`;

    const shareHtml = (c.share_codes && c.share_codes.length) ? `
      <h3>Community share codes</h3>
      ${c.share_codes.map((s) => `<div class="share"><code>${s.code}</code> — ${s.purpose} <span class="conf ${confClass(s.confidence)}">${confLabel(s.confidence)}</span></div>`).join("")}` : "";

    const rt = rawTuneFor(c.name);
    const rawHtml = rt ? (() => {
      const r = rt.raw, f = inferFocus(r);
      const row = (label, val) => val == null ? "" : `<div class="var-line"><span>${label}</span><span class="rng">${val}</span></div>`;
      return `
      <h3>Raw tune data + inferred focus <span class="conf conf-probable">${rt.source}</span></h3>
      <div class="fh6note" style="margin-bottom:10px">
        <strong>Inferred focus: ${f.primary}</strong>
        <div style="font-size:12px;color:var(--muted);margin:2px 0 6px">Read heuristically from the sliders below — not stated by the tuner.</div>
        <ul class="why" style="margin:0;padding-left:18px">${f.signals.map((s) => `<li>${s}</li>`).join("")}</ul>
      </div>
      <div>
        ${row("Tyre psi F/R", `${r.tire_psi_f} / ${r.tire_psi_r}`)}
        ${row("Final drive", r.final_drive)}
        ${row("Camber F/R", `${r.camber_f} / ${r.camber_r}°`)}
        ${row("Caster", r.caster)}
        ${row("Anti-roll F/R", `${r.arb_f} / ${r.arb_r}`)}
        ${row("Springs F/R", `${r.spring_f} / ${r.spring_r}`)}
        ${row("Ride height F/R", `${r.ride_f} / ${r.ride_r} in`)}
        ${row("Bump F/R", `${r.bump_f} / ${r.bump_r}`)}
        ${row("Rebound F/R", `${r.rebound_f} / ${r.rebound_r}`)}
        ${row("Downforce F/R", `${r.df_f} / ${r.df_r} lb`)}
        ${row("Brake bal / press", `${r.brake_bal}% / ${r.brake_press}%`)}
        ${row("Diff rear acc/dec", `${r.diff_accel_r}% / ${r.diff_decel_r}%`)}
        ${row("Diff centre", r.diff_center != null ? `${r.diff_center}% rear` : null)}
      </div>
      ${rt.url ? `<p class="why" style="font-size:11px;margin-top:6px"><a href="${rt.url}" target="_blank" style="color:var(--accent2)">source build ↗</a></p>` : ""}`;
    })() : "";

    document.getElementById("modalContent").innerHTML = `
      <span class="badge tier-${c.tier}">TIER ${c.tier}</span>
      <span class="conf ${confClass(c.confidence)}" style="margin-left:8px">${confLabel(c.confidence)}</span>
      <label style="float:right;cursor:pointer;font-size:13px;user-select:none">
        <input type="checkbox" id="modalOwn" ${isOwned(c.id) ? "checked" : ""} style="cursor:pointer;vertical-align:-2px"> I own this
      </label>
      <h2>${p2wName(c, `${c.year ? c.year + " " : ""}${c.name}`)}${codeTip(c.name, c)}</h2>
      ${isP2W(c) ? `<p class="why" style="margin:2px 0 8px;color:var(--warn)">💰 Pay-to-win: real-money only — treated as permanently unavailable.</p>` : ""}
      ${c.use_case ? `<p class="why" style="margin:2px 0 10px"><strong>Use case:</strong> ${c.use_case}</p>` : ""}
      <dl class="kv">
        <dt>Class</dt><dd>${clsBadge(c.class, true)}</dd>
        <dt>Disciplines</dt><dd>${c.disciplines.map((d) => DISCIPLINE_LABEL[d] || d).join(", ")}</dd>
        <dt>Drivetrain</dt><dd>${c.drivetrain_stock} stock → ${c.recommended_drivetrain}</dd>
        <dt>Power split</dt><dd>${c.power_split || "—"}</dd>
        <dt>Price</dt><dd>${priceOrSource(c)}${c.price_note ? `<br><span class="why" style="font-size:12px">${c.price_note}</span>` : ""}</dd>
        ${c.acquisition_difficulty ? `<dt>Get it</dt><dd><span class="acq acq-${c.acquisition_difficulty.split("-")[0]}" title="${(c.acquisition || "").replace(/"/g, "&quot;")}">${acqDot(c.acquisition_difficulty)} ${acqMethod(c)}</span></dd>` : ""}
        ${c.tunes && c.tunes.length ? `<dt>Tunes</dt><dd>${c.tunes.map(tuneLine).join("")}${c.alt_tune_note ? `<div style="font-size:11px;color:var(--warn);margin-top:4px">⚠️ ${c.alt_tune_note}</div>` : ""}</dd>` : (c.alt_tune_note ? `<dt>Tunes</dt><dd><div style="font-size:11px;color:var(--warn)">⚠️ ${c.alt_tune_note}</div></dd>` : "")}
        <dt>Value rating</dt><dd>${c.value_rating}/10</dd>
      </dl>
      ${c.easy_alternative ? `<h3>Easier alternative</h3><p class="why">${c.easy_alternative}</p>` : ""}
      <h3>Why this car</h3>
      <p class="why">${c.why}</p>
      ${(() => {
        const t = resolveTune(c);
        if (!t) return "";
        if (t.code) return `<h3>Recommended tune <span class="conf conf-probable">🟡 mildly verified</span></h3>
          <div class="share"><code>${t.code}</code> — ${t.creator ? t.creator : "car-specific"} · ${t.source || ""}${t.note ? " · " + t.note : ""}</div>
          <p class="why" style="font-size:11px;margin-top:4px">From a reputable community source — verify in-game (Find Tuning Setups).</p>`;
        const tm = t.tmpl;
        if (!tm) return "";
        const settings = Object.entries(tm.template || {}).slice(0, 8).map(([k, v]) => `<div class="var-line"><span>${k.replace(/_/g, " ")}</span><span class="rng" style="max-width:60%;white-space:normal;text-align:right">${v}</span></div>`).join("");
        return `<h3>Recommended tune <span class="conf conf-contested">📋 ${DISCIPLINE_LABEL[t.discipline] || t.discipline} template</span></h3>
          <p class="why" style="font-size:13px">No car-specific published code sourced yet — start from the <strong>${DISCIPLINE_LABEL[t.discipline] || t.discipline}</strong> baseline (matched to this car's class &amp; format, not car-specific):</p>
          <div>${settings}</div>
          <p class="why" style="font-size:11px">${tm.tune_sourcing || "Full template + how-to in the Tuning tab."}</p>`;
      })()}
      ${c.leaderboard_meta ? `<h3>Leaderboard reality check (2026-07-11)</h3><p class="fh6note">${c.leaderboard_meta}</p>` : ""}
      ${c.disciplines_note ? `<p class="fh6note">${c.disciplines_note}</p>` : ""}
      ${c.also_viable_in && c.also_viable_in.length ? `
        <h3>Also viable in (evidence-backed)</h3>
        <ul class="why">${c.also_viable_in.map((v) => `<li><strong>${clsBadge(v.class)} ${DISCIPLINE_LABEL[v.discipline] || v.discipline}</strong> — ${v.evidence}</li>`).join("")}</ul>` : ""}
      ${c.detune_note ? `<p class="fh6note">⚠️ ${c.detune_note}</p>` : ""}
      <h3>Mod / upgrade priority (buy in this order)</h3>
      <ol class="why">${c.upgrade_priority.map((u) => `<li>${u}</li>`).join("")}</ol>
      ${tuneHtml}
      ${shareHtml}
      ${rawHtml}
    `;
    document.getElementById("modalOwn").addEventListener("change", (e) => setOwned(c.id, e.target.checked));
    modal.querySelector(".modal-box").classList.remove("wide");
    modal.classList.remove("hidden");
  }

  // ---- garage tracker (car table + owned tracking) ----
  let garageFilter = "all"; // all | owned | missing
  let sortKey = "tier", sortDir = 1;

  function drawGarage() {
    const ownedCount = cars.filter((c) => isOwned(c.id)).length;
    const pct = Math.round((ownedCount / cars.length) * 100);
    const header = document.getElementById("garageHeader");
    header.innerHTML = `
      <div class="block" style="margin-top:0">
        <div class="card-row" style="margin-top:0">
          <h3 style="margin:0">Garage: ${ownedCount} / ${cars.length} meta cars owned</h3>
          <span class="conf conf-probable">tracked locally in this browser</span>
        </div>
        <div class="value-bar" style="margin-top:8px"><span style="width:${pct}%"></span></div>
        <div class="chips" style="margin-top:10px">
          ${["all", "owned", "missing"].map((f) =>
            `<button class="chip garage-filter" data-f="${f}" style="cursor:pointer;border:1px solid ${garageFilter === f ? "var(--accent)" : "var(--line)"}">${f === "all" ? "All" : f === "owned" ? "✓ Owned" : "◯ Missing"}</button>`).join("")}
          <button class="chip" id="demoGarageBtn" style="cursor:pointer;margin-left:8px">${seedOn ? "✕ Clear demo garage" : "⬇ Load demo garage (owner's collection)"}</button>
        </div>
        <p class="why" style="margin:10px 0 0">Tick a car when you get it. Availability (price is no object at 200M+ cr): 🛒 Autoshow — one click, any price · 🎁 guaranteed free but play required (journal/loyalty) · 🟡 deterministic effort (aftermarket spawn, auction) · 🔴 luck-gated grind (wheelspin RNG / limited-time — credits can't help) · 💰 premium (real money). Click a row for the full card.</p>
      </div>`;
    header.querySelectorAll(".garage-filter").forEach((b) =>
      b.addEventListener("click", () => { garageFilter = b.dataset.f; drawGarage(); }));
    const demoBtn = header.querySelector("#demoGarageBtn");
    if (demoBtn) demoBtn.addEventListener("click", () => setDemoGarage(!seedOn));

    const tierRank = { S: 0, A: 1, B: 2 };
    let list = cars.filter((c) =>
      garageFilter === "owned" ? isOwned(c.id) : garageFilter === "missing" ? !isOwned(c.id) : true);
    const sorted = [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "tier") { av = tierRank[av]; bv = tierRank[bv]; }
      if (sortKey === "owned") { av = isOwned(a.id) ? 0 : 1; bv = isOwned(b.id) ? 0 : 1; }
      if (sortKey === "acquisition_difficulty") {
        const dRank = { easy: 0, medium: 1, hard: 2, "hard-unconfirmed": 2, premium: 3 };
        av = dRank[a.acquisition_difficulty] ?? 3; bv = dRank[b.acquisition_difficulty] ?? 3;
      }
      if (sortKey === "name") return sortDir * String(av).localeCompare(String(bv));
      av = av ?? -Infinity; bv = bv ?? -Infinity;
      return sortDir * (av > bv ? 1 : av < bv ? -1 : 0);
    });

    const cols = [
      ["owned", "✓"], ["name", "Car"], ["use_case", "Use case"],
      ["acquisition_difficulty", "Get it"], ["class", "Class"], ["tier", "Tier"],
      ["price_credits", "Price"], ["value_rating", "Value"], ["confidence", "Conf"]
    ];
    const wrap = document.getElementById("carTableWrap");
    wrap.innerHTML = `<div style="overflow-x:auto"><table><thead><tr>${cols.map((c) => `<th data-k="${c[0]}">${c[1]}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map((c) => `<tr data-id="${c.id}" class="${isP2W(c) ? "p2w-row" : ""}" style="${isOwned(c.id) ? "opacity:.65" : ""}">
        <td><input type="checkbox" class="own-check" data-id="${c.id}" ${isOwned(c.id) ? "checked" : ""} style="cursor:pointer"></td>
        <td>${p2wName(c, `${c.year ? c.year + " " : ""}${c.name}`)}${codeTip(c.name, c)}${isOwned(c.id) ? ' <span style="color:var(--accent)">✓</span>' : ""}</td>
        <td class="why" style="font-size:12px;max-width:300px">${c.use_case || (c.disciplines.map((d) => DISCIPLINE_LABEL[d] || d).join(", "))}</td>
        <td><span class="acq ${acqClass(c)}">${acqLabel(c)}</span></td>
        <td>${clsBadge(c.class)}</td>
        <td><span class="badge tier-${c.tier}">${c.tier}</span></td>
        <td class="price">${priceOrSource(c)}</td>
        <td>${c.value_rating}/10</td>
        <td class="conf ${confClass(c.confidence)}">${c.confidence === "verified" ? "✅" : c.confidence === "contested" ? "⚠️" : "🟡"}</td>
      </tr>`).join("")}</tbody></table></div>
      ${!sorted.length ? `<p class="empty">No cars in this filter${garageFilter === "owned" ? " — tick some checkboxes as you collect" : ""}.</p>` : ""}`;
    wrap.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k; if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = 1; } drawGarage();
    }));
    wrap.querySelectorAll(".own-check").forEach((cb) => {
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => setOwned(cb.dataset.id, cb.checked));
    });
    wrap.querySelectorAll("tbody tr").forEach((tr) =>
      tr.addEventListener("click", () => openModal(cars.find((c) => c.id === tr.dataset.id))));
  }
  function buildTable() { drawGarage(); }

  // ---- variables ----
  // corner-map constants shared by the big phase map and the per-category glyphs
  // 5-slot categorical palette validated (dataviz six-checks) against surface #161b22
  // ═══ GRIP STATE — THE universal identity for what the tyres are doing. ONE alphabet (the daemon's and the
  // analyzer's: off|calm|front|rear|both|impact), ONE palette, ONE set of words, used by the strip, the course
  // map, the turn cards, the speed trace, the diagnosis panels and every chip that names an axle. Blue = the
  // FRONTS gave up (understeer family) · red = the REARS gave up (oversteer) · purple = all four (drift /
  // overdriven) · amber = an impact to discard · slate = within grip · near-black = not driving.
  // `word` is the handling family a driver thinks in; `axle` is the measurement it came from — both are true,
  // and every surface should show the one that fits its space rather than inventing a third vocabulary.
  const GRIP = {
    calm:   { col: "#2a313c", ink: "#8b97a7", word: "within grip",  axle: "within grip",            short: "grip",   icon: "✓", n: 0 },
    front:  { col: "#2f81f7", ink: "#2f81f7", word: "understeer",   axle: "fronts past the limit",  short: "front",  icon: "↔", n: 1 },
    rear:   { col: "#e5414e", ink: "#e5414e", word: "oversteer",    axle: "rears past the limit",   short: "rear",   icon: "⟳", n: 2 },
    both:   { col: "#a371f7", ink: "#a371f7", word: "drift / overdriven", axle: "all four — drift / overdriven", short: "all four", icon: "🌀", n: 3 },
    impact: { col: "#e3b341", ink: "#e3b341", word: "impact / jolt", axle: "impact / jolt",         short: "impact", icon: "⚡", n: 4 },
    off:    { col: "#0b0e12", ink: "#8b97a7", word: "not driving",   axle: "not driving",           short: "off",    icon: "·", n: 5 },
  };
  const GRIP_BY_N = ["calm", "front", "rear", "both", "impact", "off"];      // the analyzer's numeric trace codes
  const gripOf = (k) => GRIP[k] || (typeof k === "number" ? GRIP[GRIP_BY_N[k]] : null) || GRIP.calm;
  const gripCol = (k) => gripOf(k).col;
  // axle + handling word in one chip — the Rosetta the diagnostic matrix already teaches (front≡understeer)
  const gripChip = (k, opts) => { const g = gripOf(k); const o = opts || {};
    return `<span class="gchip" style="border-color:${g.ink};color:${g.ink}"${o.title ? ` title="${o.title}"` : ""}>${o.noIcon ? "" : g.icon + " "}${o.axle ? g.axle : g.word}</span>`; };
  // the ONE legend — every strip/trace/map that paints states explains them the same way
  const gripLegend = (keys) => `<span class="glegend">${(keys || ["calm", "front", "rear", "both", "impact"]).map((k) => { const g = gripOf(k);
    return `<span title="${esc(g.axle)}"><i style="background:${g.col}"></i>${g.word}</span>`; }).join("")}</span>`;
  // USI (understeer index) and first-red axle both resolve INTO the same alphabet — never a parallel one
  const gripFromUsi = (u) => (u > 0.15 ? "front" : u < -0.05 ? "rear" : "calm");
  const gripFromAxle = (a, drift) => (drift ? "both" : a === "front" ? "front" : a === "rear" ? "rear" : a === "both" ? "both" : "calm");
  const CM_PC = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
  const CM_SHORT = ["Braking", "Turn-in", "Mid-corner", "Exit", "Straight/crest"];
  const CM_SEGS = [
    "M 50 262 L 330 262",
    "M 330 262 Q 385 262 415 240",
    "M 415 240 A 50 50 0 1 0 415 140",
    "M 415 140 Q 385 118 330 118",
    "M 330 118 L 50 118",
  ];
  const CM_RIBBON = "M 50 262 L 330 262 Q 385 262 415 240 A 50 50 0 1 0 415 140 Q 385 118 330 118 L 50 118";
  // mini glyph: same geometry, lit segments = active phases (1-indexed)
  function miniCorner(phases, w) {
    const title = "Acts in: " + phases.map((p) => `${p} ${CM_SHORT[p - 1]}`).join(", ");
    return `<svg viewBox="0 0 620 320" width="${w || 88}" height="${Math.round((w || 88) * 0.52)}" style="vertical-align:middle" role="img" aria-label="${title}"><title>${title}</title>
      <path d="${CM_RIBBON}" fill="none" stroke="var(--bg3)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
      ${CM_SEGS.map((d, i) => phases.includes(i + 1)
        ? `<path d="${d}" fill="none" stroke="${CM_PC[i]}" stroke-width="18" stroke-linecap="round"/>` : "").join("")}
    </svg>`;
  }
  function phaseDots(phases) {
    const title = "Acts in: " + phases.map((p) => `${p} ${CM_SHORT[p - 1]}`).join(", ");
    return `<span title="${title}" style="display:inline-flex;gap:3px;vertical-align:middle;margin-left:6px">${[1, 2, 3, 4, 5].map((p) =>
      `<span style="width:9px;height:9px;border-radius:50%;display:inline-block;${phases.includes(p) ? `background:${CM_PC[p - 1]}` : "border:1px solid var(--line)"}"></span>`).join("")}</span>`;
  }
  const CM_ABBR = ["Brake", "Turn-in", "Mid", "Exit", "Straight"];
  const CM_CHIP = [[190, 262], [382, 249], [478, 191], [382, 131], [190, 118]];   // per-phase badge anchors on the corner ribbon (from the variables map)
  // per-move glyph: same canonical corner, PHASE-COLOURED where this slider ACTS, red halo where the driver's ISSUE occurs.
  // overlap (colour core + red halo) = this change directly targets the problem; a lone red dashed segment = the issue is there but another move handles it.
  function moveCorner(aph, iph, w) {
    aph = aph || []; iph = iph || [];
    const wide = w || 118;
    const title = `Change acts in: ${aph.map((p) => p + " " + CM_SHORT[p - 1]).join(", ") || "—"}` + (iph.length ? ` · issue occurs in: ${iph.map((p) => p + " " + CM_SHORT[p - 1]).join(", ")}` : "");
    const segs = CM_SEGS.map((d, i) => {
      const act = aph.includes(i + 1), iss = iph.includes(i + 1); let s = "";
      if (iss) s += `<path d="${d}" fill="none" stroke="#e5414e" stroke-width="30" stroke-linecap="round" opacity=".30"/>`;
      if (act) s += `<path d="${d}" fill="none" stroke="${CM_PC[i]}" stroke-width="17" stroke-linecap="round"/>`;
      else if (iss) s += `<path d="${d}" fill="none" stroke="#e5414e" stroke-width="9" stroke-linecap="round" stroke-dasharray="1 12" opacity=".85"/>`;
      return s;
    }).join("");
    return `<svg viewBox="0 0 620 320" width="${wide}" height="${Math.round(wide * 0.52)}" style="display:block" role="img" aria-label="${title}"><title>${title}</title>
      <path d="${CM_RIBBON}" fill="none" stroke="var(--bg3)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
      ${segs}</svg>`;
  }
  // master "anatomy of a turn" image above the move cards: every phase in its colour + numbered, the phases where the
  // driver's ISSUES occur pulsed red and named. One reference image the per-move glyphs read against.
  function movesAnatomy(moves) {
    const issue = {};   // phase -> Set(issue words)
    (moves || []).forEach((m) => (m.iph || []).forEach((p) => { (issue[p] = issue[p] || new Set()); (m.iss || []).forEach((wd) => issue[p].add(wd)); }));
    const issPhases = Object.keys(issue).map(Number);
    const segs = CM_SEGS.map((d, i) => {
      const iss = issPhases.includes(i + 1);
      return `${iss ? `<path d="${d}" fill="none" stroke="#e5414e" stroke-width="30" stroke-linecap="round" opacity=".9"><animate attributeName="opacity" values=".85;.3;.85" dur="1.9s" repeatCount="indefinite"/></path>` : ""}<path d="${d}" fill="none" stroke="${CM_PC[i]}" stroke-width="16" stroke-linecap="round" opacity="${iss ? 1 : .9}"/>`;
    }).join("");
    const badges = CM_CHIP.map((c, i) => `<g><circle cx="${c[0]}" cy="${c[1]}" r="17" fill="var(--bg)" stroke="${CM_PC[i]}" stroke-width="2.5"/><text x="${c[0]}" y="${c[1] + 7}" text-anchor="middle" font-size="21" font-weight="700" fill="${CM_PC[i]}">${i + 1}</text></g>`).join("");
    const svg = `<svg class="tm-anat-svg" viewBox="0 0 620 320" role="img" aria-label="Anatomy of a turn">
      <path d="${CM_RIBBON}" fill="none" stroke="var(--bg3)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>${segs}${badges}</svg>`;
    const legend = [1, 2, 3, 4, 5].map((p) => {
      const on = issue[p]; const words = on ? [...on].slice(0, 2).join(", ") : "";
      return `<span class="tm-lg${on ? " iss" : ""}"><i style="background:${CM_PC[p - 1]}"></i>${p} ${CM_SHORT[p - 1]}${on ? ` — <b>${words}</b>` : ""}</span>`;
    }).join("");
    return `<div class="tm-anat"><div class="tm-anat-wrap">${svg}</div><div class="tm-anat-lg"><span class="tm-anat-ttl">Anatomy of a turn · <span style="color:#e5414e">red = where your issues occur</span></span>${legend}<span class="tm-tgt" title="FH6's Mechanical Balance stat (front-vs-rear grip, shown live in the tuning screen) is the master target — set it with ARBs first. Confirmed across 4 vetted guides.">🎯 Mech. Balance <b>0.55–0.65</b> <span style="opacity:.7">(~0.60, a mid-corner target)</span> · Aero <b>0.40–0.45</b></span></div></div>`;
  }

  // direction-effect icons: rotate (red, loosens) / push+stability (blue, tightens) / neutral axes
  const FX_ICONS = {
    rotate: '<path d="M11.5 3.5 A5 5 0 1 0 12.3 8.3"/><path d="M9.2 1.6 L12.4 3.6 L9.2 5.4 Z" fill="currentColor" stroke="none"/>',
    push: '<path d="M2 11.5 Q7 10.5 11 5"/><path d="M11.9 2.8 L12 6.6 L8.8 4.9 Z" fill="currentColor" stroke="none"/>',
    stability: '<path d="M3.5 2 V12 M10.5 2 V12"/><circle cx="7" cy="7" r="1.6" fill="currentColor" stroke="none"/>',
    grip: '<circle cx="7" cy="5.5" r="3.2"/><path d="M2.5 11.5 H11.5"/>',
    response: '<path d="M8 1.5 L3.5 8 H6.5 L6 12.5 L10.5 6.5 H7.5 Z" fill="currentColor" stroke="none"/>',
    speed: '<path d="M2.5 3.5 L6.5 7 L2.5 10.5 M7.5 3.5 L11.5 7 L7.5 10.5"/>',
    accel: '<path d="M2.5 11.5 H11.5 V3.5 Z" fill="currentColor" stroke="none" opacity="0.85"/>',
    travel: '<path d="M7 3.2 V10.8 M4.8 5 L7 2.4 L9.2 5 M4.8 9 L7 11.6 L9.2 9"/>',
    flat: '<path d="M2.5 10.5 H11.5"/><rect x="5" y="7.2" width="4" height="2.4" rx="0.6" fill="currentColor" stroke="none"/>',
    stop: '<circle cx="7" cy="7" r="4.5"/><path d="M5 7 H9"/>',
  };
  const FX_COLOR = { rotate: "#e66767", push: "#4b96f3", stability: "#4b96f3" };
  const fxIcon = (kind) => `<svg viewBox="0 0 14 14" width="13" height="13" style="vertical-align:-2px" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${FX_ICONS[kind] || ""}</svg>`;
  function fxRow(v) {
    const e = v.effect;
    if (!e) return v.poles ? `<div class="poles">${v.poles}</div>` : "";
    const side = (d, dir) => {
      const col = FX_COLOR[d.kind] || "var(--muted)";
      return `<span style="color:${col};white-space:nowrap">${dir === "lo" ? "lower ◀&nbsp;" : ""}${fxIcon(d.kind)} <span class="fx-label">${d.label}</span>${dir === "hi" ? "&nbsp;▶ raise" : ""}</span>`;
    };
    return `<div class="fx-row" title="${(v.poles || "").replace(/"/g, "&quot;")}">${side(e.down, "lo")}<span class="fx-axis"></span>${side(e.up, "hi")}</div>`;
  }

  function buildVariables() {
    const sm = DB.tuningVariables.situational_model;
    if (sm) {
      const host = document.getElementById("varOrder");
      const el = document.createElement("div");
      el.className = "block";
      el.style.borderColor = "var(--accent)";
      const PC = CM_PC, SHORT = CM_SHORT, SEGS = CM_SEGS, ribbon = CM_RIBBON;
      const CHIP = [[190, 262], [382, 249], [478, 191], [382, 131], [190, 118]];
      const LABEL = [[190, 296], [398, 285], [545, 191], [398, 100], [190, 96]];
      const allSliders = [];
      sm.phase_map.forEach((p) => p.active_sliders.forEach((s) => { if (!allSliders.includes(s)) allSliders.push(s); }));

      el.innerHTML = `
        <h3>When does each slider actually act? <span class="conf conf-probable">🟡 doctrine</span></h3>
        <p class="why"><strong>${sm.principle}</strong></p>
        <p class="why" style="margin:8px 0 4px"><strong>Find a slider</strong> (click to light up its phases) — or click a track zone:</p>
        <div class="chips" id="cmapSliders">${allSliders.map((s) => `<span class="chip cmap-chip" data-s="${s}" style="cursor:pointer">${s}</span>`).join("")}</div>
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin-top:10px">
          <svg id="cmapSvg" viewBox="0 0 620 320" style="flex:1 1 380px;max-width:640px;min-width:320px" role="img" aria-label="Corner phase map">
            <path d="${ribbon}" fill="none" stroke="var(--bg3)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
            <polygon points="50,254 70,262 50,270" fill="var(--muted)"/>
            <text x="84" y="243" fill="var(--muted)" font-size="11">travel →</text>
            ${SEGS.map((d, i) => `<path class="cmap-seg" data-i="${i}" d="${d}" fill="none" stroke="${PC[i]}" stroke-width="10" stroke-linecap="round"/>`).join("")}
            ${SEGS.map((d, i) => `<path class="cmap-hit" data-i="${i}" d="${d}" fill="none" stroke="rgba(0,0,0,0)" stroke-width="34" style="cursor:pointer"/>`).join("")}
            ${CHIP.map((c, i) => `<g class="cmap-chipdot" data-i="${i}" style="cursor:pointer"><circle cx="${c[0]}" cy="${c[1]}" r="11" fill="${PC[i]}"/><text x="${c[0]}" y="${c[1] + 4}" text-anchor="middle" fill="#0e1116" font-size="12" font-weight="700">${i + 1}</text></g>`).join("")}
            ${LABEL.map((c, i) => `<text x="${c[0]}" y="${c[1]}" text-anchor="${i === 2 ? "start" : "middle"}" fill="var(--text, #e6edf3)" font-size="12">${SHORT[i]}</text>`).join("")}
          </svg>
          <div id="cmapDetail" style="flex:1 1 260px;min-width:250px"></div>
        </div>
        <details style="margin-top:10px"><summary class="why" style="cursor:pointer">Table view (same data)</summary>
          <div style="overflow-x:auto;margin-top:8px"><table>
            <thead><tr><th>Corner phase</th><th>What carries load</th><th>Sliders ACTIVE here</th><th>Inert here (don't bother)</th></tr></thead>
            <tbody>${sm.phase_map.map((r, i) => `<tr><td><span style="color:${PC[i]}">●</span> <strong>${r.phase}</strong></td><td class="why" style="font-size:12px">${r.loaded}</td><td>${r.active_sliders.join(", ")}</td><td class="why" style="font-size:12px">${r.inert}</td></tr>`).join("")}</tbody></table></div>
        </details>
        <ol class="why" style="margin-top:10px">${sm.three_questions.map((q) => `<li>${q}</li>`).join("")}</ol>
        <ul class="why" style="margin-top:4px">${sm.habits.map((h) => `<li>${h}</li>`).join("")}</ul>`;
      host.parentNode.insertBefore(el, host.nextSibling);

      const segEls = el.querySelectorAll(".cmap-seg");
      const chipEls = el.querySelectorAll(".cmap-chip");
      const detail = el.querySelector("#cmapDetail");
      function paint(activeIdxs, selSlider) {
        segEls.forEach((s) => {
          const i = +s.dataset.i;
          const on = activeIdxs.includes(i);
          s.style.opacity = on ? "1" : "0.25";
          s.setAttribute("stroke-width", on ? "13" : "10");
        });
        chipEls.forEach((c) => {
          c.style.borderColor = c.dataset.s === selSlider ? PC[activeIdxs[0] ?? 0] : "";
          c.style.color = c.dataset.s === selSlider ? "var(--text, #e6edf3)" : "";
        });
      }
      function showPhase(i) {
        const p = sm.phase_map[i];
        paint([i], null);
        detail.innerHTML = `
          <h4 style="margin:0 0 6px"><span style="color:${PC[i]}">●</span> ${p.phase}</h4>
          <p class="why" style="margin:0"><strong>What carries load:</strong> ${p.loaded}</p>
          <p class="why" style="margin:8px 0 4px"><strong>Active sliders — the only ones that matter here:</strong></p>
          <div class="chips">${p.active_sliders.map((s) => `<span class="chip" style="border:1px solid ${PC[i]}">${s}</span>`).join("")}</div>
          <p class="why" style="margin:8px 0 0;color:var(--muted)"><strong>Inert here:</strong> ${p.inert}</p>`;
      }
      function showSlider(name) {
        const idxs = sm.phase_map.map((p, i) => p.active_sliders.some((s) => s === name) ? i : -1).filter((i) => i >= 0);
        paint(idxs, name);
        detail.innerHTML = `
          <h4 style="margin:0 0 6px">${name}</h4>
          <p class="why" style="margin:0">Acts in <strong>${idxs.length}</strong> phase${idxs.length === 1 ? "" : "s"}:</p>
          <ul class="why" style="margin:6px 0 0">${idxs.map((i) => `<li><span style="color:${PC[i]}">●</span> <strong>${SHORT[i]}</strong> — ${sm.phase_map[i].loaded}</li>`).join("")}</ul>
          <p class="why" style="margin:8px 0 0;color:var(--muted)">Everywhere else this slider does nothing — don't reach for it there.</p>`;
      }
      el.querySelectorAll(".cmap-hit, .cmap-chipdot").forEach((h) =>
        h.addEventListener("click", () => showPhase(+h.dataset.i)));
      chipEls.forEach((c) => c.addEventListener("click", () => showSlider(c.dataset.s)));
      showPhase(1);
    }
    const tv = DB.tuningVariables;
    const bp = tv.build_phase;
    document.getElementById("varOrder").innerHTML =
      (bp ? `<span style="color:var(--accent)"><strong>STEP 0 — BUILD TO CLASS FIRST.</strong> ${bp.principle}</span><br>` +
        `<span style="font-size:12px">${bp.steps.join("<br>")}</span><br><br>` : "") +
      "<strong>Then tune in this order:</strong> " + tv.tuning_order.map((t, i) => `${i + 1}. ${t.replace(/_/g, " ")}`).join("  →  ") +
      `<br><span style="color:var(--warn)">${tv.note || tv.tuning_order_note || ""}</span>`;
    const host = document.getElementById("varCats");
    const glyphLegend = sm && sm.glyph_note ? `<p class="why" style="margin:14px 0 6px">${miniCorner([1, 2, 3, 4, 5], 64)} ${sm.glyph_note}</p>` : "";
    host.innerHTML = glyphLegend + tv.categories.map((cat) => `
      <div class="varcat">
        <h3>${cat.phases ? miniCorner(cat.phases, 92) + " " : ""}${cat.label}
          ${cat.fh6_tab ? `<span class="flag tab-flag">${cat.fh6_tab} tab</span>` : ""}
          ${cat.tune_first ? '<span class="flag">tune first</span>' : ""}
          ${cat.tune_last ? '<span class="flag">tune last</span>' : ""}
          ${cat.tune_early ? '<span class="flag">tune early</span>' : ""}
        </h3>
        ${cat.gating ? `<p class="gating"><strong>Unlocks:</strong> ${cat.gating}</p>` : ""}
        ${cat.fh6_note ? `<p class="fh6note">${cat.fh6_note}</p>` : ""}
        <p class="principle">${cat.principle || ""}</p>
        ${cat.variables.map((v) => {
          const base = v.baseline ?? v.baseline_awd_circuit ?? v.baseline_awd ?? v.baseline_rwd_awd_rear;
          const rng = (v.typical_min != null && v.typical_max != null) ? `${v.typical_min} – ${v.typical_max} ${v.unit || ""}` : (v.unit || "");
          const fh6 = v.fh6 ? `<span class="conf ${fh6Class(v.fh6)}" title="${v.range_note || ""}">${fh6Label(v.fh6)}</span>` : "";
          const dots = v.phases ? phaseDots(v.phases) : "";
          return `<div class="var-line">
            <span>${v.label}${dots}${base != null ? ` <span class="flag">base ${base}</span>` : ""} ${fh6}${fxRow(v)}</span>
            <span class="rng">${rng}</span>
          </div>`;
        }).join("")}
      </div>`).join("");
  }

  // ---- strategy ----
  function buildStrategy() {
    const s = DB.upgradeStrategy;
    document.getElementById("strategyContent").innerHTML = `
      <p class="hint">${s.note}</p>
      <h3>Upgrade / buy order</h3>
      ${s.upgrade_order.map((u) => `
        <div class="strat-step">
          <div class="strat-num">${u.step}</div>
          <div><h4>${u.category} <span class="conf ${confClass(u.confidence)}">${confLabel(u.confidence)}</span></h4><p>${u.detail}</p></div>
        </div>`).join("")}
      <div class="block">
        <h3>Drivetrain rules</h3>
        <ul>
          <li><strong>Road:</strong> ${s.drivetrain_rules.road_racing}</li>
          <li><strong>Off-road/dirt/CC:</strong> ${s.drivetrain_rules.off_road_dirt_cross_country}</li>
          <li><strong>Early power split:</strong> ${s.drivetrain_rules.early_meta_power_split}</li>
        </ul>
      </div>
      <div class="block">
        <h3>Engine swaps</h3>
        <ul><li>${s.engine_swap_notes.heavy_v8_swap}</li><li>${s.engine_swap_notes.principle}</li></ul>
      </div>
      <div class="block">
        <h3>Build principles</h3>
        <ul>${s.build_principles.map((p) => `<li>${p}</li>`).join("")}</ul>
      </div>`;
  }

  // ---- tuning templates ----
  function buildTemplates() {
    const tt = DB.tuningTemplates;
    if (!tt) return;
    const host = document.getElementById("templatesContent");
    const convClass = (c) => c === "high" ? "conf-verified" : c === "low" ? "conf-contested" : "conf-probable";
    const convLabel = (c) => c === "high" ? "🟢 high convergence (apply template)" : c === "low" ? "🔴 low (bespoke tune + line matter)" : "🟡 medium";
    const cards = tt.templates.map((t) => {
      const tmpl = Object.entries(t.template || {}).map(([k, v]) =>
        `<div class="var-line"><span><strong>${k.replace(/_/g, " ")}</strong></span><span class="rng" style="max-width:62%;white-space:normal;text-align:right">${v}</span></div>`).join("");
      const vars = (t.key_variables || []).map((v) => `<li>${v}</li>`).join("");
      const variants = (t.variants || []).map((v) => `<li><strong>${v.name}:</strong> ${v.deltas}</li>`).join("");
      return `
      <div class="block">
        <div class="card-row" style="margin-top:0">
          <h3 style="margin:0">${t.label}</h3>
          <span class="conf ${convClass(t.convergence)}">${convLabel(t.convergence)}</span>
        </div>
        <p class="why">${t.convergence_note}</p>
        <p class="fh6note"><strong>Getting a tune:</strong> ${t.tune_sourcing}</p>
        <h4 style="margin:12px 0 4px">What actually matters</h4>
        <ol class="why" style="margin:0;padding-left:18px">${vars}</ol>
        <h4 style="margin:12px 0 4px">Template (baseline settings)</h4>
        ${tmpl}
        ${variants ? `<h4 style="margin:12px 0 4px">Variants</h4><ul class="why" style="margin:0;padding-left:18px">${variants}</ul>` : ""}
        <p class="why" style="margin-top:10px"><strong>Car choice:</strong> ${t.car_selection}</p>
        <p class="conf ${confClass(t.confidence)}" style="font-size:12px">${confLabel(t.confidence)}</p>
      </div>`;
    }).join("");
    const scale = `<div class="block"><h3>Convergence — how much the tune/car matters by discipline</h3>
      <p class="why">🟢 <strong>high:</strong> ${tt.convergence_scale.high}</p>
      <p class="why">🟡 <strong>medium:</strong> ${tt.convergence_scale.medium}</p>
      <p class="why">🔴 <strong>low:</strong> ${tt.convergence_scale.low}</p></div>`;
    host.innerHTML = `<p class="hint">${tt.note}</p>` + scale + cards;
  }

  // ---- rivals ----
  function buildRivals() {
    const rt = DB.rivalsTracks;
    if (!rt) return;
    const host = document.getElementById("rivalsContent");
    const h = rt.board_reading_heuristic;
    const heur = `
      <div class="block">
        <h3>How to read a Rivals board <span class="conf conf-verified">method</span></h3>
        <p class="why">${h.purpose}</p>
        <ol class="why">${h.rules.map((r) => `<li>${r}</li>`).join("")}</ol>
      </div>`;
    const analysis = (a) => {
      const rows = ((a.leaderboard_snapshot && a.leaderboard_snapshot.top) || []).map((r) => `
        <tr><td>${r.pos}</td><td>${r.driver}</td><td>${r.car}</td>
          <td>${piBadge(null, r.pi, true)}</td><td>${r.drivetrain || ""}</td>
          <td class="rng">${r.time}</td><td class="why" style="font-size:12px">${r.flag || ""}</td></tr>`).join("");
      const snap = a.leaderboard_snapshot || {};
      return `
        <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px">
          <div class="card-row" style="margin-top:0"><h4 style="margin:0">${clsBadge(a.class, true)}</h4><span class="conf conf-probable">${(snap.your_standing) || ""}</span></div>
          ${a.board_state ? `<p class="fh6note"><strong>Board (${snap.date || ""}, ${snap.filter || ""}):</strong> ${a.board_state}</p>` : ""}
          ${rows ? `<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Driver</th><th>Car</th><th>PI</th><th>DT</th><th>Time</th><th>Flag</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
          ${a.recommended_car ? `<p class="why"><strong>Pick:</strong> ${a.recommended_car}</p>` : ""}
          ${a.acquisition ? `<p class="gating"><strong>How to get it:</strong> ${a.acquisition}</p>` : ""}
          ${a.how_to_get_the_tune ? `<p class="why"><strong>Getting a tune:</strong> ${a.how_to_get_the_tune}</p>` : ""}
          ${a.tune_browser_warning ? `<p class="fh6note">⚠️ ${a.tune_browser_warning}</p>` : ""}
          ${a.key_insight ? `<p class="fh6note"><strong>Key insight:</strong> ${a.key_insight}</p>` : ""}
          ${a.targets ? `<p class="why"><strong>Targets:</strong> ${a.targets.realistic_first} → stretch: ${a.targets.stretch}</p>` : ""}
          <p class="why" style="font-size:12px;color:var(--muted)">${a.confidence || ""}</p>
        </div>`;
    };
    const fmtBadge = (f) => f === "endurance" ? "🏁 endurance" : f === "sprint" ? "➡️ sprint" : "🔁 circuit";
    const profBadge = (p) => !p ? "" : ({ "technical": "🟣 technical", "mixed-technical": "🔵 mixed-tech", "mixed": "⚪ mixed", "mixed-fast": "🟠 mixed-fast", "high-speed": "🔴 high-speed" }[p] || p);
    const cfBadge = (c) => c === "verified" ? '<span class="conf conf-verified">✅ verified</span>' : c === "probable" ? '<span class="conf conf-probable">🟡 probable</span>' : c === "speculation" ? '<span class="conf conf-contested">❓ speculation</span>' : "";
    const dragBody = (t) => {
      const pb = t.drag_playbook || {};
      const cars = pb.car_by_class ? Object.entries(pb.car_by_class).map(([k, v]) =>
        `<div class="var-line"><span><strong>${k}</strong></span><span class="rng" style="max-width:68%;white-space:normal;text-align:right">${v}</span></div>`).join("") : "";
      return `
        <p class="fh6note"><strong>Strip:</strong> ${t.strip_bias || ""}</p>
        <p class="why"><strong>Approach:</strong> ${pb.approach || ""}</p>
        <p class="why"><strong>Gearing:</strong> ${pb.gearing || ""}</p>
        ${cars ? `<h4 style="margin:10px 0 4px">Car by class</h4>${cars}` : ""}
        <p class="why"><strong>Launch:</strong> ${pb.launch || ""}</p>
        <p class="why" style="font-size:12px;color:var(--muted)">${pb.confidence || ""}</p>`;
    };
    const card = (t, bodyHtml, badge) => `
      <div class="block">
        <div class="card-row" style="margin-top:0">
          <h3 style="margin:0">${t.name} <span class="flag tab-flag">${fmtBadge(t.format)}</span></h3>
          <span class="conf ${badge.cls}">${badge.txt}</span>
        </div>
        <p class="why" style="font-size:12px;color:var(--muted)">${t.region || ""}${t.location ? " · " + t.location : ""}${t.length ? " · " + String(t.length).slice(0, 40) : ""}</p>
        ${t.speed_profile && t.discipline === "road" ? `<div class="card-row" style="margin-top:0"><span class="acq">${profBadge(t.speed_profile)}</span><span style="font-size:12px;color:var(--muted)">${t.drivetrain_bias ? "DT: " + t.drivetrain_bias : ""}</span></div>` : ""}
        <p class="why"><strong>Character:</strong> ${t.character} ${cfBadge(t.character_confidence)}</p>
        ${t.research && t.research.caveat ? `<p class="why" style="font-size:11px;color:var(--muted)">⚠️ ${t.research.caveat}</p>` : ""}
        ${bodyHtml}
      </div>`;
    const roadTracks = rt.tracks.filter((t) => t.discipline === "road");
    const dragTracks = rt.tracks.filter((t) => t.discipline === "drag");

    // ---- meta-inferred per-track picks (until a leaderboard capture upgrades a track) ----
    // Best road-meta cars, biased by the track's speed profile, each bound to a real pool tune code.
    const tierRank = { S: 0, A: 1, B: 2 };
    function metaPicksForTrack(t, n = 3) {
      const prof = t.speed_profile || "";
      const tech = /technical/.test(prof), fast = /high-speed|fast/.test(prof);
      return cars.filter((c) => (c.disciplines || []).includes("road"))
        .map((c) => {
          let bias = 0;
          const touge = (c.disciplines || []).includes("touge_street") || (c.disciplines || []).includes("touge");
          if (tech && touge) bias -= 1;      // technical layout → favour handling/touge cars
          if (fast && !touge) bias -= 1;      // fast layout → favour speed-biased cars
          return { c, bias };
        })
        .sort((x, y) => (x.bias - y.bias) || (tuneMetaRank(x.c) - tuneMetaRank(y.c)) ||
          ((tierRank[x.c.tier] ?? 9) - (tierRank[y.c.tier] ?? 9)) || (y.c.value_rating - x.c.value_rating))
        .slice(0, n).map((o) => o.c);
    }
    function pickLine(c) {
      const t = resolveTune(c);
      const code = t && t.code
        ? ` — <code>${t.code}</code> <span class="why" style="font-size:11px">${t.creator || t.source || ""}</span>`
        : ` — <span class="why" style="font-size:11px">no bound code; pick a ROAD tune in the 🔑 browser</span>`;
      return `<li>${p2wName(c, c.name)} ${clsBadge(c.class, true)}${code}</li>`;
    }
    function metaInferredBlock(t) {
      const picks = metaPicksForTrack(t, 3);
      if (!picks.length) return "";
      return `<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px">
        <p class="why" style="margin:0 0 4px"><strong>Meta-inferred picks</strong> <span class="conf conf-probable">🟡 not board-verified</span> — top road-meta cars for this ${t.speed_profile || "road"} layout, each bound to a real tune code from the ingested pool. Verify at your race class; a leaderboard capture upgrades this to board-verified.</p>
        <ul class="why" style="margin:4px 0 0">${picks.map(pickLine).join("")}</ul>
      </div>`;
    }

    const roadCards = roadTracks.map((t) => {
      const done = t.status === "analyzed" && (t.class_analyses || []).length;
      const body = done ? t.class_analyses.map(analysis).join("")
        : `<p class="why" style="color:var(--warn)">⏳ No board capture yet — send an in-game Rivals screenshot for this event + your race class to upgrade to a board-verified read.</p>${metaInferredBlock(t)}`;
      return card(t, body, done ? { cls: "conf-verified", txt: "✅ board-verified" } : { cls: "conf-probable", txt: "🟡 meta-inferred" });
    }).join("");
    const dragCards = dragTracks.map((t) => card(t, dragBody(t), { cls: "conf-verified", txt: "✅ template-driven" })).join("");
    const roadDone = roadTracks.filter((t) => t.status === "analyzed").length;
    const summary = `<div class="block"><h3>Road Racing Rivals — ${roadDone}/${roadTracks.length} board-verified</h3>
      <p class="why">Every track shows <strong>meta-inferred picks</strong> (best road-meta car + a real tune code from the ${(DB.tunerSheets && DB.tunerSheets.tunes.length) || 0}-tune pool) right now; a leaderboard screenshot upgrades a track to <strong>board-verified</strong> (the actual most-represented clean-lap car). ${rt.scaffold_todo || ""}</p>
      <p class="why" style="font-size:12px;color:var(--muted)">${rt.scope || ""}</p></div>`;
    const dragSummary = dragTracks.length ? `<div class="block"><h3>Drag Rivals — ${dragTracks.length}/${dragTracks.length} ✅ complete (template-driven)</h3>
      <p class="why">${(rt.drag_module && rt.drag_module.note) || ""}</p></div>` : "";
    host.innerHTML = `<p class="hint">${rt.note}</p>` + heur + summary + roadCards + dragSummary + dragCards;
  }

  // ---- progression ----
  function buildProgress() {
    const p = DB.progression;
    const stack = p.credit_multiplier_stack;
    const host = document.getElementById("progressContent");

    const roadmap = p.roadmap.map((ph) => `
      <div class="strat-step">
        <div class="strat-num">${ph.phase}</div>
        <div>
          <h4>${ph.title} <span class="conf ${confClass(ph.confidence)}">${confLabel(ph.confidence)}</span></h4>
          <ul class="why" style="margin:6px 0 0;padding-left:18px">${ph.actions.map((a) => `<li>${a}</li>`).join("")}</ul>
        </div>
      </div>`).join("");

    const multiplier = `
      <div class="block">
        <h3>Credit multiplier stack — turn assists OFF on real races</h3>
        <p class="why">${stack.note}</p>
        <div class="tune-grid" style="grid-template-columns:1fr auto">
          ${stack.modifiers.map((m) => `<div>${m.setting}</div><div style="color:var(--accent);text-align:right">+${m.bonus_pct}%</div>`).join("")}
          <div style="border-top:1px solid var(--line);padding-top:6px"><strong>Approx total</strong></div>
          <div style="border-top:1px solid var(--line);padding-top:6px;text-align:right;color:var(--accent)"><strong>+${stack.approx_total_pct}%</strong></div>
        </div>
        <p class="why">${stack.extra}</p>
      </div>`;

    const methods = `
      <h3 style="margin-top:24px">Farming methods, ranked</h3>
      <div class="card-grid">
        ${p.methods.map((m) => {
          const codes = m.setup && m.setup.eventlab_codes
            ? m.setup.eventlab_codes.map((c) => `<div class="share"><code>${c.code}</code> — ${c.name}: ${c.use}</div>`).join("") : "";
          const car = m.setup && (m.setup.car || (m.setup.cars && m.setup.cars.join(", ")));
          return `
          <div class="car-card" style="cursor:default">
            <div class="card-row" style="margin-top:0">
              <span class="badge tier-${m.type === "active" ? "A" : m.type === "passive" || m.type === "weekly" ? "S" : "B"}">${m.type.toUpperCase()}</span>
              <span class="conf ${confClass(m.confidence)}">${confLabel(m.confidence)}</span>
            </div>
            <h3>${m.name}</h3>
            <p class="why" style="margin:6px 0">${m.yield}</p>
            <div class="chips">
              <span class="chip">rate: ${m.rate}</span>
              <span class="chip">effort: ${m.effort}</span>
              <span class="chip">risk: ${m.risk}</span>
            </div>
            ${car ? `<p class="why" style="margin:8px 0 0"><strong>Car:</strong> ${car}</p>` : ""}
            ${m.setup && m.setup.premium_alt ? `<p class="why" style="margin:4px 0 0"><strong>Premium alt:</strong> ${m.setup.premium_alt}</p>` : ""}
            ${codes}
            ${m.tip ? `<p class="why" style="margin:8px 0 0;color:var(--accent2)">💡 ${m.tip}</p>` : ""}
          </div>`;
        }).join("")}
      </div>`;

    const excl = `
      <div class="block" style="border-color:var(--warn)">
        <h3>⚠️ Excluded on purpose</h3>
        <ul>${p.exclusions.map((e) => `<li><strong>${e.what}</strong> — ${e.why_excluded}</li>`).join("")}</ul>
      </div>`;

    host.innerHTML = `
      <p class="hint">${p.goal}</p>
      <h3 style="margin-top:20px">The optimal path (do these in order)</h3>
      ${roadmap}
      ${multiplier}
      ${methods}
      ${excl}`;
  }

  // ---- eliminator ----
  function buildEliminator() {
    const e = DB.eliminatorTips;
    if (!e) return;
    const host = document.getElementById("eliminatorContent");
    const PHASE_LABEL = {
      early_game: "🌱 Early game", mid_game: "⚔️ Mid game", head_to_head: "🏎️ Head-to-Head",
      final_showdown: "🏁 Final Showdown", general: "📋 General"
    };
    const ov = e.mode_overview;
    const fact = (f) => `${f.value} <span class="conf ${confClass(f.confidence)}">${confLabel(f.confidence)}</span>`;

    const overview = `
      <div class="block">
        <h3>How the mode works</h3>
        <p class="why">${ov.what}</p>
        <dl class="kv">
          <dt>Players</dt><dd>${fact(ov.player_count)}</dd>
          <dt>Starter car</dt><dd>${fact(ov.starter_car)}</dd>
          <dt>Arena</dt><dd>${fact(ov.map_context)}</dd>
          <dt>Where</dt><dd>${fact(ov.hub_context)}</dd>
        </dl>
      </div>`;

    const mechanics = `
      <h3 style="margin-top:24px">Mechanics</h3>
      ${e.mechanics.map((m) => `
        <div class="block">
          <h4 style="margin:0 0 6px">${m.name} <span class="conf ${confClass(m.confidence)}">${confLabel(m.confidence)}</span></h4>
          <p class="why" style="margin:0">${m.detail}</p>
          ${m.note ? `<p class="why" style="font-size:12px;color:var(--muted);margin:6px 0 0">${m.note}</p>` : ""}
        </div>`).join("")}`;

    const levels = `
      <div class="block">
        <h3>Car Drop levels <span class="conf ${confClass(e.car_levels.confidence)}">${confLabel(e.car_levels.confidence)}</span></h3>
        <p class="fh6note">${e.car_levels.note}</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Lv</th><th>Reported cars</th><th>Role</th></tr></thead>
          <tbody>${e.car_levels.levels.map((l) => `
            <tr><td><span class="badge tier-${l.level >= 9 ? "S" : l.level >= 5 ? "A" : "B"}">${l.level}</span></td>
            <td>${l.cars.join(", ")}</td><td class="why" style="font-size:12px">${l.role}</td></tr>`).join("")}
          </tbody></table></div>
      </div>`;

    const whereToDrop = e.where_to_drop ? `
      <div class="block" style="border-color:var(--accent)">
        <h3>📍 Where to drop</h3>
        <p class="fh6note">${e.where_to_drop.verdict}</p>
        <ul class="why">${e.where_to_drop.usable_guidance.map((g) => `
          <li><span class="conf ${confClass(g.confidence)}">${confLabel(g.confidence)}</span> ${g.tip}${g.note ? ` <span style="color:var(--muted)">(${g.note})</span>` : ""}</li>`).join("")}
        </ul>
      </div>` : "";

    const playbook = e.playbook ? `
      <div class="block">
        <h3>⏱️ Minute-by-minute playbook</h3>
        <p class="fh6note">${e.playbook.note}</p>
        ${e.playbook.steps.map((s) => `
          <div class="strat-step">
            <div class="strat-num" style="font-size:10px;min-width:74px">${s.phase}</div>
            <div><p class="why" style="margin:0">${s.action} <span class="conf ${confClass(s.confidence)}">${confLabel(s.confidence)}</span></p></div>
          </div>`).join("")}
      </div>` : "";

    const research = e.research_state ? `
      <div class="block">
        <h3>🔬 Open questions (as of ${e.research_state.as_of})</h3>
        <ul class="why">${e.research_state.next_actions.map((a) => `<li>${a}</li>`).join("")}</ul>
      </div>` : "";

    const phases = ["early_game", "mid_game", "head_to_head", "final_showdown", "general"];
    const tips = phases.map((ph) => {
      const list = e.tips.filter((t) => t.phase === ph);
      if (!list.length) return "";
      return `
        <h3 style="margin-top:24px">${PHASE_LABEL[ph]}</h3>
        <div class="card-grid">
          ${list.map((t) => `
            <div class="car-card" style="cursor:default">
              <div class="card-row" style="margin-top:0">
                <span class="conf ${confClass(t.confidence)}">${confLabel(t.confidence)}</span>
              </div>
              <h3 style="font-size:14px">${t.tip}</h3>
              <p class="why" style="margin:6px 0 0">${t.why}</p>
              <p class="why" style="font-size:11px;color:var(--muted);margin:8px 0 0">sources: ${t.sources.join(", ")}</p>
            </div>`).join("")}
        </div>`;
    }).join("");

    const patches = `
      <div class="block">
        <h3>Patch history</h3>
        ${e.patch_history.map((p) => `
          <div class="strat-step">
            <div class="strat-num" style="font-size:11px">${p.date.slice(5)}</div>
            <div><p class="why" style="margin:0">${p.event} <span class="conf ${confClass(p.confidence)}">${confLabel(p.confidence)}</span></p></div>
          </div>`).join("")}
      </div>`;

    const retracted = e.retracted && e.retracted.length ? `
      <div class="block" style="border-color:var(--warn)">
        <h3>⚠️ Excluded on purpose</h3>
        <ul>${e.retracted.map((r) => `<li><strong>${r.what}</strong> — ${r.why}</li>`).join("")}</ul>
      </div>` : "";

    host.innerHTML = `
      <p class="hint">${e.meta_disclaimer}</p>
      ${overview}
      ${whereToDrop}
      ${playbook}
      ${levels}
      ${mechanics}
      ${tips}
      ${patches}
      ${retracted}
      ${research}`;
  }

  // ---- touge guide ----
  function buildTouge() {
    const g = DB.tougeGuide;
    if (!g) return;
    const host = document.getElementById("tougeContent");
    const conf = (c) => `<span class="conf ${confClass(c)}">${confLabel(c)}</span>`;   // (local clsBadge/clsTier shadow removed — the global in-game .pib badge is the ONE class design language)
    const ov = g.overview;

    const overview = `
      <div class="block">
        <h3 style="margin-top:0">What Touge is ${conf(ov.confidence)}</h3>
        <p class="why">${ov.what}</p>
        <p class="why"><strong>How it differs:</strong> ${ov.how_it_differs}</p>
        ${ov.leaderboard_note ? `<p class="fh6note"><strong>Leaderboards:</strong> ${ov.leaderboard_note}</p>` : ""}
        ${ov.reported_unconfirmed ? `<p class="fh6note">🟡 ${ov.reported_unconfirmed}</p>` : ""}
      </div>`;

    const dirTag = (d) => /^downhill/.test(d) ? '<span class="conf conf-probable">↓ downhill</span>' : /unverified/.test(d) ? '<span class="conf conf-contested">? dir.</span>' : `<span class="why">${d}</span>`;
    const events = g.events ? `
      <div class="block">
        <h3>The touge events ${conf(g.events.confidence)}</h3>
        <p class="fh6note">${g.events.note}</p>
        ${g.events.list.map((e) => `
          <div style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">
            <div class="card-row" style="margin-top:0"><h4 style="margin:0">${e.name} ${clsBadge(e.class, true)} <span class="why" style="font-size:11px">${e.length_mi}mi · ${e.laps || 1} lap · ${e.region}</span></h4>${dirTag(e.direction || "")}</div>
            <p class="why" style="margin:4px 0 0"><strong>Character:</strong> ${e.character}</p>
            ${e.unlock ? `<p class="why" style="font-size:12px;margin:3px 0 0"><strong>Find it:</strong> ${e.unlock}</p>` : ""}
            ${e.lean ? `<p class="why" style="font-size:12px;margin:3px 0 0"><strong>Build lean</strong> ${conf(e.lean_confidence || "inference")}: ${e.lean}</p>` : ""}
          </div>`).join("")}
      </div>` : "";

    const metaCars = `
      <h3 style="margin-top:24px">🏁 Meta cars by class</h3>
      ${g.meta_cars_note ? `<p class="why">${g.meta_cars_note}</p>` : ""}
      ${g.drivetrain_verdict ? `<p class="fh6note"><strong>Drivetrain verdict:</strong> ${g.drivetrain_verdict}</p>` : ""}
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Class</th><th>Car</th><th>DT</th><th>Why</th><th></th></tr></thead>
        <tbody>${g.meta_cars.map((c) => `<tr>
          <td>${clsBadge(c.class)}</td>
          <td>${c.year ? c.year + " " : ""}${c.manufacturer} ${c.model}${codeTip(c.manufacturer + " " + c.model, { class: c.class, disciplines: ["touge"] })}</td>
          <td class="why" style="font-size:11px">${c.drivetrain || ""}</td>
          <td class="why" style="font-size:12px">${c.why}</td>
          <td>${conf(c.confidence)}</td></tr>`).join("")}</tbody>
      </table></div>`;

    const build = `
      <h3 style="margin-top:24px">🔧 What a touge tune prioritizes</h3>
      ${g.build_attributes.map((a) => `
        <div class="block">
          <h4 style="margin:0 0 6px">${a.attribute} ${conf(a.confidence)}</h4>
          <p class="why" style="margin:0"><strong>${a.guidance}</strong></p>
          <p class="why" style="font-size:12px;color:var(--muted);margin:6px 0 0">${a.why}</p>
        </div>`).join("")}`;

    const PHASE_LABEL = { launch: "🚦 Launch", entry: "↘️ Entry", "mid-corner": "🎯 Mid-corner", exit: "↗️ Exit", downhill: "⛰️ Downhill", uphill: "🏔️ Uphill" };
    const technique = `
      <h3 style="margin-top:24px">💡 Driving technique</h3>
      <div class="card-grid">
        ${g.technique.map((t) => `
          <div class="car-card" style="cursor:default">
            <div class="card-row" style="margin-top:0"><span class="chip">${PHASE_LABEL[t.phase] || t.phase}</span>${conf(t.confidence)}</div>
            <h3 style="font-size:14px;margin-top:8px">${t.tip}</h3>
            <p class="why" style="margin:6px 0 0">${t.why}</p>
          </div>`).join("")}
      </div>`;

    const overtaking = `
      <div class="block" style="margin-top:24px">
        <h3 style="margin-top:0">↔️ Overtaking on narrow roads</h3>
        <ul class="why">${g.overtaking.map((o) => `<li>${conf(o.confidence)} ${o.tip}<br><span style="color:var(--muted)">${o.why}</span></li>`).join("")}</ul>
      </div>`;

    const settings = `
      <div class="block">
        <h3 style="margin-top:0">🎛️ Assist / setting recommendations</h3>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Setting</th><th>For a new touge player</th><th>Why</th></tr></thead>
          <tbody>${g.settings.map((s) => `<tr><td>${s.setting}</td><td><strong>${s.recommendation}</strong> ${conf(s.confidence)}</td><td class="why" style="font-size:12px">${s.why}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>`;

    const mistakes = `
      <h3 style="margin-top:24px">⚠️ Common mistakes → fixes</h3>
      ${g.mistakes.map((m) => `
        <div class="block">
          <h4 style="margin:0 0 4px;color:var(--warn)">${m.symptom}</h4>
          <p class="why" style="margin:0"><strong>Cause:</strong> ${m.cause}</p>
          <p class="why" style="margin:4px 0 0"><strong>Fix:</strong> ${m.fix}</p>
        </div>`).join("")}`;

    // Touge-appropriate codes: no pass-specific tunes exist, but touge shares the technical-tarmac meta,
    // so surface the best grip/purist ROAD tunes proven on tight technical circuits, filtered to each pass's class.
    const TOUGE_CLASSES = ["B", "A", "S1", "S2"];
    const eventsByClass = {};
    ((g.events && g.events.list) || []).forEach((e) => { (eventsByClass[e.class] = eventsByClass[e.class] || []).push(e.name); });
    function tougeCodesForClass(cls, n = 4) {
      return POOL.filter((t) => t.class === cls && t.discipline === "road")
        .map((t) => {
          const txt = [t.focus, t.notes, t.build].join(" ");
          let s = 0;
          if (/circuit|narai|juku|shirakawa|legend island|coastline|\b\d{2}\.\d\b/i.test(txt)) s += 5; // proven on a technical circuit (map + laptime)
          if (/purist|grip/i.test(txt)) s += 3;
          if (/allround|road/i.test(txt)) s += 1;
          if (META_CREATORS.has((t.creator || "").toLowerCase())) s += 2;
          return { t, s };
        })
        .filter((o) => o.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, n).map((o) => o.t);
    }
    const tougeCodes = `
      <h3 style="margin-top:24px">🔑 Touge-appropriate tune codes <span class="conf conf-probable">🟡 circuit-derived</span></h3>
      <p class="why">There are <strong>no tunes for the touge passes themselves</strong> — but touge shares the technical-tarmac meta, so these are the best transferable codes from the ${POOL.length}-tune pool: <strong>grip / purist road tunes proven on tight technical circuits</strong> (Narai Juku, Shirakawa…), filtered to each pass's class. A strong starting point — then bias slightly further toward corner-exit for a downhill pass.</p>
      ${TOUGE_CLASSES.map((cls) => {
        const picks = tougeCodesForClass(cls, 4);
        if (!picks.length) return "";
        const evs = (eventsByClass[cls] || []).join(", ");
        return `<div class="block">
          <h4 style="margin:0 0 8px">${clsBadge(cls)}${evs ? ` <span class="why">${evs}</span>` : ""}</h4>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Car</th><th>Code</th><th>Tuner</th><th>Proven on</th></tr></thead>
            <tbody>${picks.map((t) => `<tr>
              <td>${t.car}</td><td><code>${t.code}</code></td>
              <td class="why">${t.creator || t.source}${META_CREATORS.has((t.creator || "").toLowerCase()) ? ' <span class="badge tier-S" style="font-size:9px">curated</span>' : ""}</td>
              <td class="why" style="font-size:12px">${t.focus || ""}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>`;
      }).join("")}`;

    const codes = g.codes ? `
      <h3 style="margin-top:24px">🔑 Actual touge tunes</h3>
      <div class="block" style="border-color:var(--warn)">
        <p class="why" style="margin-top:0"><strong>No verified codes exist</strong> — ${g.codes.why_no_verified_codes}</p>
      </div>
      ${(g.codes.attributed_unverified && g.codes.attributed_unverified.length) ? `
        <h4 style="margin:16px 0 6px">Attributed, single-source, untested <span class="conf conf-probable">🟡 verify in-game</span></h4>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Class</th><th>Car</th><th>Code</th><th>By</th><th>Note</th></tr></thead>
          <tbody>${g.codes.attributed_unverified.map((c) => `<tr>
            <td>${clsBadge(c.class)}</td><td>${c.car}</td>
            <td><code>${c.code}</code></td><td class="why">${c.tuner}</td>
            <td class="why" style="font-size:12px">${c.why}</td></tr>`).join("")}</tbody>
        </table></div>` : ""}
      ${(g.codes.resources && g.codes.resources.length) ? `
        <h4 style="margin:16px 0 6px">Where to find touge tunes / boards</h4>
        <ul class="why">${g.codes.resources.map((r) => `<li><strong>${r.name}</strong> — ${r.note}</li>`).join("")}</ul>` : ""}` : "";

    const consensus = g.community_consensus ? `
      <div class="block" style="margin-top:24px">
        <h3 style="margin-top:0">🗣️ Community consensus</h3>
        <p class="why">${g.community_consensus}</p>
      </div>` : "";

    const research = g.research_state ? `
      <div class="block">
        <h3>🔬 Open questions (as of ${g.research_state.as_of})</h3>
        <ul class="why">${g.research_state.next_actions.map((a) => `<li>${a}</li>`).join("")}</ul>
      </div>` : "";

    host.innerHTML = `
      <p class="hint">${g.meta_disclaimer}</p>
      ${overview}${events}${metaCars}${build}${technique}${overtaking}${settings}${mistakes}${codes}${tougeCodes}${consensus}${research}`;
  }

  // ---- drift guide ----
  function buildDrift() {
    const g = DB.driftGuide;
    if (!g) return;
    const host = document.getElementById("driftContent");

    // Visual: how a sliding car actually moves (momentum vs nose angle vs countersteer)
    const svg = `
    <svg viewBox="0 0 840 480" role="img" aria-label="Drift physics diagram" style="width:100%;height:auto;max-width:840px;display:block;margin:0 auto">
      <defs>
        <marker id="mArrow" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto"><path d="M2,2 L10,6 L2,10 Z" fill="#00d27a"/></marker>
        <marker id="nArrow" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto"><path d="M2,2 L10,6 L2,10 Z" fill="#2f81f7"/></marker>
      </defs>
      <!-- momentum (line of travel) -->
      <path d="M 360 452 C 360 372 375 302 392 250 C 410 197 430 150 452 108" stroke="#00d27a" stroke-width="11" fill="none" marker-end="url(#mArrow)" opacity="0.9"/>
      <!-- nose-angle direction (dashed) -->
      <line x1="420" y1="196" x2="492" y2="78" stroke="#2f81f7" stroke-width="3" stroke-dasharray="7 6" marker-end="url(#nArrow)"/>
      <!-- car, rotated to a drift angle relative to travel -->
      <g transform="rotate(30 392 250)">
        <line x1="360" y1="312" x2="360" y2="352" stroke="#f0883e" stroke-width="4" opacity="0.5" stroke-dasharray="2 6"/>
        <line x1="424" y1="312" x2="424" y2="352" stroke="#f0883e" stroke-width="4" opacity="0.5" stroke-dasharray="2 6"/>
        <rect x="352" y="282" width="13" height="28" rx="3" fill="#12161c"/>
        <rect x="419" y="282" width="13" height="28" rx="3" fill="#12161c"/>
        <g transform="rotate(-30 392 206)">
          <rect x="352" y="192" width="13" height="28" rx="3" fill="#12161c"/>
          <rect x="419" y="192" width="13" height="28" rx="3" fill="#12161c"/>
        </g>
        <rect x="360" y="190" width="64" height="120" rx="13" fill="#d3dae4" stroke="#0e1116" stroke-width="2"/>
        <rect x="366" y="193" width="52" height="9" rx="3" fill="#9aa4b0"/>
        <rect x="369" y="212" width="46" height="40" rx="7" fill="#33404f"/>
      </g>
      <!-- labels + leaders -->
      <g font-family="system-ui, -apple-system, sans-serif">
        <line x1="232" y1="262" x2="360" y2="300" stroke="#2a313c" stroke-width="1.5"/>
        <text x="40" y="238" fill="#00d27a" font-size="17" font-weight="700">MOMENTUM</text>
        <text x="40" y="260" fill="#8b97a7" font-size="13">where the car actually</text>
        <text x="40" y="277" fill="#8b97a7" font-size="13">travels — barely changes</text>

        <line x1="520" y1="96" x2="492" y2="80" stroke="#2a313c" stroke-width="1.5"/>
        <text x="524" y="86" fill="#2f81f7" font-size="17" font-weight="700">NOSE ANGLE</text>
        <text x="524" y="107" fill="#8b97a7" font-size="13">where it POINTS —</text>
        <text x="524" y="124" fill="#8b97a7" font-size="13">not where you go</text>

        <line x1="536" y1="266" x2="432" y2="214" stroke="#2a313c" stroke-width="1.5"/>
        <text x="540" y="250" fill="#e6edf3" font-size="17" font-weight="700">COUNTERSTEER</text>
        <text x="540" y="271" fill="#8b97a7" font-size="13">front wheels point back</text>
        <text x="540" y="288" fill="#8b97a7" font-size="13">toward travel — this</text>
        <text x="540" y="305" fill="#8b97a7" font-size="13">CATCHES the slide</text>

        <line x1="238" y1="408" x2="372" y2="330" stroke="#2a313c" stroke-width="1.5"/>
        <text x="40" y="404" fill="#f0883e" font-size="17" font-weight="700">REAR SLID OUT</text>
        <text x="40" y="425" fill="#8b97a7" font-size="13">tyres broke traction —</text>
        <text x="40" y="442" fill="#8b97a7" font-size="13">throttle controls how far</text>
      </g>
    </svg>`;

    const balance = `
      <div class="block">
        <h3>Throttle = your angle dial</h3>
        <p class="why">Drifting lives in the narrow band between two mistakes. Feather the throttle to stay in the middle.</p>
        <div style="height:16px;border-radius:8px;background:linear-gradient(90deg,#f0883e 0%,#e3b341 28%,#00d27a 50%,#e3b341 72%,#f0883e 100%);margin:14px 0 6px"></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
          <span>◀ too little<br>bogs &amp; straightens</span>
          <span style="color:var(--accent);text-align:center;font-weight:700">THE DRIFT<br>feather here</span>
          <span style="text-align:right">too much ▶<br>spins out backwards</span>
        </div>
      </div>`;

    const concept = `
      <div class="block">
        <h3>${g.concept.headline}</h3>
        <ul class="why">${g.concept.points.map((p) => `<li>${p}</li>`).join("")}</ul>
      </div>`;

    const failures = `
      <div class="block">
        <h3>Fix your two problems</h3>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>What's happening</th><th>Why</th><th>Fix</th></tr></thead>
          <tbody>${g.failure_modes.map((f) => `<tr>
            <td><strong>${f.symptom}</strong></td>
            <td class="why" style="font-size:13px">${f.cause}</td>
            <td class="why" style="font-size:13px;color:var(--accent)">${f.fix}</td>
          </tr>`).join("")}</tbody>
        </table></div>
      </div>`;

    const scoring = `
      <div class="block">
        <h3>Drift Zone scoring <span class="conf ${confClass(g.scoring.confidence)}">${confLabel(g.scoring.confidence)}</span></h3>
        <p class="why" style="font-size:16px;color:var(--txt)"><code style="font-size:15px">${g.scoring.formula}</code></p>
        <p class="why"><strong>The #1 lever — chaining:</strong> ${g.scoring.multiplier_note}</p>
        <p class="why"><strong>Entry:</strong> ${g.scoring.entry}</p>
        <p class="why"><strong>Width:</strong> ${g.scoring.width}</p>
      </div>`;

    const smTier = (t) => t === "corroborated" || t === "corroborated-structure" || t === "corroborated-absence" ? "conf-verified"
      : t === "player-corroborated" ? "conf-verified" : t === "contested" ? "conf-contested" : "conf-probable";
    const mechanics = g.scoring_mechanics ? `
      <div class="block" style="border-color:var(--accent2)">
        <h3>🔬 Scoring mechanics — the deep dive (${g.scoring_mechanics.researched.split(" (")[0]})</h3>
        <p class="fh6note">Corroboration bar deliberately relaxed (new game): tiers are corroborated / single-source / FH5-inherited / contested — read the tag, not just the claim.</p>
        ${g.scoring_mechanics.mechanics.map((m) => `
          <p class="why" style="margin:8px 0 0"><span class="conf ${smTier(m.tier)}">${m.tier}</span> <strong>${m.name}:</strong> ${m.facts}</p>`).join("")}
        <h4 style="margin:14px 0 4px">⚗️ Experiments that would settle the unknowns</h4>
        <ul class="why">${g.scoring_mechanics.experiments.map((e) => `<li>${e}</li>`).join("")}</ul>
      </div>` : "";

    const checklist = `
      <div class="block">
        <h3>Pre-run checklist</h3>
        <ul class="why">${g.settings_checklist.map((s) => `<li>${s}</li>`).join("")}</ul>
      </div>`;

    const drill = `
      <div class="block" style="border-color:var(--accent2)">
        <h3>🎯 Practice drill (do this first)</h3>
        <p class="why">${g.practice_drill}</p>
      </div>`;

    const tune = `
      <div class="block">
        <h3>Getting a drift tune</h3>
        <p class="why"><strong>Easiest:</strong> ${g.tune.easiest}</p>
        <p class="why"><strong>If you tune manually:</strong> ${g.tune.manual_essentials}</p>
      </div>`;

    const acqDot = (d) => d === "easy" ? "🟢" : d === "medium" ? "🟡" : "🔴";
    const cars = `
      <h3 style="margin-top:24px">Meta drift cars</h3>
      <div class="card-grid">
        ${g.meta_cars.map((c) => `
          <div class="car-card${isP2W(c) ? " p2w" : ""}" style="cursor:default">
            <div class="card-row" style="margin-top:0">
              ${clsBadge(c.class, true)}
              <span class="conf ${confClass(c.confidence)}">${confLabel(c.confidence)}</span>
            </div>
            <h3 style="font-size:15px">${p2wName(c, c.name)}${codeTip(c.name, c)}</h3>
            <div class="card-row"><span>${acqDot(c.get)} ${c.acquisition}</span><span class="price">${priceOrSource(c)}</span></div>
            <p class="why" style="margin:8px 0 0">${c.note}</p>
          </div>`).join("")}
      </div>`;

    host.innerHTML = `
      <p class="hint">${g.meta_disclaimer}</p>
      <div class="block"><h3 style="margin-top:0">How a slide actually works</h3>${svg}</div>
      ${concept}
      ${balance}
      ${failures}
      ${scoring}
      ${mechanics}
      ${cars}
      ${tune}
      ${checklist}
      ${drill}`;
  }

  // ---- tune codes (full 53Rain import) — opened as a modal overlay from the Cars page ----
  function openTuneCodesOverlay() {
    const host = document.getElementById("modalContent");
    // merge 53Rain (DB.tuneCodes) + ingested tuner-sheet pool (DB.tunerSheets), dedupe by code
    const rows = [];
    ((DB.tuneCodes && DB.tuneCodes.classes) || []).forEach((cl) => cl.cars.forEach((c) =>
      c.code && rows.push({ car: c.car, code: c.code, class: cl.class, creator: "53Rain", discipline: "", focus: c.note || "", source: "53Rain", meta: c.tag === "meta" })));
    POOL.forEach((t) => rows.push({ car: t.car, code: t.code, class: t.class || "", creator: t.creator || t.source, discipline: t.discipline || "", focus: t.focus || "", source: t.source, meta: META_CREATORS.has((t.creator || "").toLowerCase()) }));
    const seen = new Set(); const all = [];
    for (const r of rows) { if (seen.has(r.code)) continue; seen.add(r.code); all.push(r); }

    const classes = [...new Set(all.map((r) => r.class).filter(Boolean))].sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
    const discs = [...new Set(all.map((r) => r.discipline).filter(Boolean))].sort();
    let q = "", clsFilter = "", discFilter = "";
    const CAP = 400;

    function draw() {
      const ql = q.toLowerCase();
      const list = all.filter((r) =>
        (!clsFilter || r.class === clsFilter) &&
        (!discFilter || r.discipline === discFilter) &&
        (!ql || r.car.toLowerCase().includes(ql) || (r.creator || "").toLowerCase().includes(ql)));
      const shown = list.slice(0, CAP);
      const body = shown.map((r) => `<tr class="${r.meta ? "row-meta" : ""}">
        <td>${r.car}</td>
        <td><code>${r.code}</code></td>
        <td>${r.class ? clsBadge(r.class) : "—"}</td>
        <td>${r.discipline || "—"}</td>
        <td>${r.creator || ""}${r.meta ? ' <span class="badge tier-S" style="font-size:9px">curated</span>' : ""}<br><span class="why" style="font-size:11px">${r.source}</span></td>
        <td class="why" style="font-size:12px">${r.focus || ""}</td>
      </tr>`).join("");
      document.getElementById("tcTableWrap").innerHTML = `<div style="overflow-x:auto"><table>
        <thead><tr><th>Car</th><th>Code</th><th>Class</th><th>Discipline</th><th>Tuner / source</th><th>Focus / notes</th></tr></thead>
        <tbody>${body}</tbody></table></div>
        <p class="why" style="margin-top:8px">${list.length} of ${all.length} codes${list.length > CAP ? ` (showing first ${CAP} — refine search)` : ""}${clsFilter ? " · " + clsBadge(clsFilter) : ""}${discFilter ? " · " + discFilter : ""}${q ? ' · "' + q + '"' : ""}.</p>`;
    }
    const chip = (val, cur, cls) => `<button class="chip ${cls}" data-v="${val}" style="cursor:pointer;${val === cur ? "border-color:var(--accent);color:var(--accent)" : ""}">${cls === "tc-cls" && val ? clsBadge(val) : (val || "All")}</button>`;

    host.innerHTML = `
      <h2 style="margin-top:0">🔑 Tune codes — ${all.length} across ${new Set(all.map((r) => r.source)).size} sources</h2>
      <p class="why" style="font-size:12px;margin-top:0">Community share codes ingested from the curated tuner sheets (53Rain, GBR Ozzy, LogikJ, aTTaX, OxGRIDRUNR, K1Z Gray). <b>Sourced-unverified</b> — verify in-game via Find Tuning Setups. Rows highlighted are by curated "good tuners".</p>
      <div class="controls" style="margin-bottom:12px">
        <label>Search car or tuner<input type="text" id="tcSearch" placeholder="e.g. Supra, 240SX, KapienPL, Golf"></label>
      </div>
      <div class="chips" style="margin-bottom:6px"><span class="why" style="font-size:11px;align-self:center">Class:</span> ${["", ...classes].map((c) => chip(c, clsFilter, "tc-cls")).join("")}</div>
      <div class="chips" style="margin-bottom:12px"><span class="why" style="font-size:11px;align-self:center">Discipline:</span> ${["", ...discs].map((d) => chip(d, discFilter, "tc-disc")).join("")}</div>
      <div id="tcTableWrap"></div>`;
    const search = document.getElementById("tcSearch");
    search.addEventListener("input", () => { q = search.value; draw(); });
    host.querySelectorAll(".tc-cls").forEach((b) => b.addEventListener("click", () => { clsFilter = b.dataset.v; host.querySelectorAll(".tc-cls").forEach((x) => { x.style.borderColor = "var(--line)"; x.style.color = "var(--muted)"; }); b.style.borderColor = "var(--accent)"; b.style.color = "var(--accent)"; draw(); }));
    host.querySelectorAll(".tc-disc").forEach((b) => b.addEventListener("click", () => { discFilter = b.dataset.v; host.querySelectorAll(".tc-disc").forEach((x) => { x.style.borderColor = "var(--line)"; x.style.color = "var(--muted)"; }); b.style.borderColor = "var(--accent)"; b.style.color = "var(--accent)"; draw(); }));
    draw();
    modal.querySelector(".modal-box").classList.add("wide");
    modal.classList.remove("hidden");
    search.focus();
  }

  // ---- where to find good tunes ----
  function buildTuners() {
    const t = DB.tuners;
    if (!t) return;
    const host = document.getElementById("tunersContent");
    const sheets = t.tuners.filter((x) => x.kind === "sheet");
    const gts = t.tuners.filter((x) => x.kind === "gamertag");
    host.innerHTML = `
      <div class="block" style="border-color:var(--warn)">
        <h3 style="margin-top:0">Why the in-game tune finder misleads you</h3>
        <p class="why">${t.the_gap}</p>
      </div>
      <div class="block">
        <h3>How to actually find a good tune</h3>
        <ol class="why">${t.how_to_find.map((s) => `<li>${s}</li>`).join("")}</ol>
      </div>
      <h3 style="margin-top:20px">Trusted tuners with public sheets <span class="conf conf-probable">ingestible</span></h3>
      <div class="card-grid">
        ${sheets.map((s) => `
          <div class="car-card" style="cursor:default">
            <div class="card-row" style="margin-top:0"><span class="badge tm-road">SHEET</span><span class="conf ${confClass(s.confidence)}">${confLabel(s.confidence)}</span></div>
            <h3 style="font-size:15px">${s.name}</h3>
            <p class="why" style="margin:6px 0">${s.specialty}</p>
            ${s.sheet_url ? `<a href="${s.sheet_url}" target="_blank" style="color:var(--accent2);font-size:13px">open sheet ↗</a>` : ""}
          </div>`).join("")}
      </div>
      <h3 style="margin-top:20px">Trusted tuners — search their gamertag in the Tune Browser</h3>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Gamertag</th><th>Known for</th></tr></thead>
        <tbody>${gts.map((g) => `<tr><td><strong>${g.name}</strong></td><td class="why" style="font-size:13px">${g.specialty}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="why" style="font-size:12px;margin-top:10px">${t.note} Source: <a href="${t.source_url}" target="_blank" style="color:var(--accent2)">${t.source}</a></p>`;
  }

  // ---- wheelspin / Forza Edition tracker ----
  function buildWheelspin() {
    const oc = DB.ownedCars;
    const ws = DB.wheelspinCars;
    if (!oc || !ws) return;
    const host = document.getElementById("wheelspinContent");

    // per-visitor wheelspin tracking (localStorage) — independent of the owner's garage capture
    const WS_OWNED_KEY = "fh6_wheelspin_owned";
    let wsOwned = {};
    try { wsOwned = JSON.parse(localStorage.getItem(WS_OWNED_KEY)) || {}; } catch (e) { wsOwned = {}; }
    const wsKey = (mfr, model, year) => tnorm((mfr || "") + " " + (model || "")) + "|" + (year || "");
    const toggleWs = (k) => {
      if (wsOwned[k]) delete wsOwned[k]; else wsOwned[k] = true;
      try { localStorage.setItem(WS_OWNED_KEY, JSON.stringify(wsOwned)); } catch (e) { /* private mode */ }
      buildWheelspin();
    };

    // fuzzy owned-lookup over the transcribed garage (model + manufacturer, ±1yr)
    const ownedIndex = oc.cars.map((c) => ({
      toks: tnorm((c.model || "") + " " + (c.manufacturer || "")).split(" ").filter((w) => w.length > 1),
      codes: tnorm((c.model || "") + " " + (c.manufacturer || "")).split(" ").filter((w) => /\d/.test(w)),
      year: c.year, raw: c,
    }));
    // Returns the matching garage car (with real in-game rarity) or null.
    // Distinguishing model-code tokens (zr1, 6x6, gt3, m2, "4"…) MUST match exactly —
    // this is what stops false positives like "Corvette ZR1" matching a plain Stingray.
    const ownedMatch = (mfr, model, year) => {
      const full = tnorm(model + " " + mfr).split(" ");
      const dt = full.filter((w) => w.length > 1);
      const keys = full.filter((w) => /\d/.test(w)); // incl. single-digit codes ("4" vs "2")
      return ownedIndex.find((o) => {
        const yok = !year || !o.year || Math.abs(o.year - year) <= 1;
        if (!yok) return false;
        if (!keys.every((k) => o.codes.includes(k))) return false;
        const shared = dt.filter((w) => o.toks.includes(w)).length;
        return shared >= Math.max(2, Math.min(dt.length, o.toks.length) - 1);
      }) || null;
    };
    // cross-reference our 48-car meta list for a meta-value read
    const metaMatch = (mfr, model, year) => {
      const dt = tnorm(model + " " + mfr).split(" ").filter((w) => w.length > 1);
      return cars.find((c) => {
        const ct = tnorm(c.name).split(" ").filter((w) => w.length > 1);
        const yok = !year || !c.year || Math.abs(c.year - year) <= 1;
        const shared = dt.filter((w) => ct.includes(w)).length;
        return yok && shared >= Math.max(2, Math.min(dt.length, ct.length) - 1);
      }) || null;
    };
    const confDot = (cf) => cf === "verified" ? '<span class="conf conf-verified" title="cross-source verified">●</span>'
      : cf === "probable" ? '<span class="conf conf-probable" title="single/partial source">●</span>'
      : '<span class="conf conf-contested" title="unverified">●</span>';
    const rarBadge = (r, verified) => {
      const k = (r || "").toLowerCase();
      const cls = k.includes("legendary") ? "rar-legendary" : k.includes("epic") ? "rar-epic"
        : k.includes("rare") ? "rar-rare" : k.includes("forza") ? "rar-fe"
        : k.includes("barn") ? "rar-barn" : k.includes("common") ? "rar-common" : "rar-unknown";
      const label = r ? r.replace(/forza edition/i, "FE") : "?";
      const title = !r ? " title=\"rarity not published by any reliable source\""
        : verified ? " title=\"confirmed in your garage (in-game)\"" : " title=\"community-researched rarity\"";
      return `<span class="badge ${cls}"${title}>${label}${verified ? " ✓" : ""}</span>`;
    };
    const statusCell = (owned) => owned
      ? '<span class="badge tm-meta">✓ OWNED</span>'
      : '<span class="badge tier-B">NEED</span>';
    const metaVal = (m, note) => m
      ? `<span class="conf conf-verified">meta: tier ${m.tier} · ${m.value_rating}/10${m.tune_meta ? " · 53Rain " + m.tune_meta : ""}</span>`
      : `<span class="why" style="font-size:12px">${note || "collector"}</span>`;

    const cleanRar = (r) => r ? r.split(";")[0].trim() : null;
    const enrich = (list) => list.map((c) => {
      // garage cross-reference only when the owner's demo garage is loaded; otherwise per-visitor ticks only
      const g = seedOn ? ownedMatch(c.manufacturer, c.model, c.year) : null;
      const m = metaMatch(c.manufacturer, c.model, c.year);
      const gRar = g ? cleanRar(g.raw.rarity) : null;
      const key = wsKey(c.manufacturer, c.model, c.year);
      const owned = !!wsOwned[key] || !!g;
      // rarity ✓ = confirmed from the owner's in-game garage (only when demo loaded); else researched value
      return { ...c, key, owned, m, rarity: gRar || c.rarity, rarityVerified: !!gRar };
    });
    const rarRank = (r) => { const k = (r || "").toLowerCase(); return k.includes("legendary") ? 5 : k.includes("forza") ? 5 : k.includes("epic") ? 4 : k.includes("rare") ? 3 : k.includes("common") ? 2 : 0; };
    const rowSort = (a, b) => (a.owned - b.owned) || (rarRank(b.rarity) - rarRank(a.rarity)) || ((b.m ? b.m.value_rating : 0) - (a.m ? a.m.value_rating : 0));

    const ownCell = (c) => `<td style="text-align:center"><input type="checkbox" class="ws-own" data-k="${c.key}" ${c.owned ? "checked" : ""} title="tick if you own it (saved in this browser)"></td>`;

    const fe = enrich(ws.forza_edition).sort(rowSort);
    const feHave = fe.filter((c) => c.owned).length;
    const feRows = fe.map((c) => `<tr${c.owned ? "" : ' style="opacity:.85"'}>
      ${ownCell(c)}
      <td>${confDot(c.confidence)} ${c.year} ${c.manufacturer} ${c.model.replace(/ ?forza edition/i, " FE")}</td>
      <td>${rarBadge("Forza Edition", c.rarityVerified)}</td>
      <td>${statusCell(c.owned)}</td>
      <td>${metaVal(c.m, c.meta_note)}</td></tr>`).join("");

    const wx = enrich(ws.wheelspin_exclusive).sort(rowSort);
    const wxHave = wx.filter((c) => c.owned).length;
    const wxRows = wx.map((c) => `<tr${c.owned ? "" : ' style="opacity:.85"'}>
      ${ownCell(c)}
      <td>${confDot(c.confidence)} ${c.year} ${c.manufacturer} ${c.model}</td>
      <td>${rarBadge(c.rarity, c.rarityVerified)}</td>
      <td>${statusCell(c.owned)}</td>
      <td>${metaVal(c.m, c.meta_note)}</td></tr>`).join("");

    // FE cars you own that aren't on the researched roster (roster is incomplete).
    // Match each owned-FE against every roster entry with the same fuzzy token test.
    const onRoster = (car) => {
      const dt = tnorm((car.model || "") + " " + (car.manufacturer || "")).split(" ").filter((w) => w.length > 1);
      return ws.forza_edition.some((r) => {
        const rt = tnorm(r.model + " " + r.manufacturer).split(" ").filter((w) => w.length > 1);
        const yok = !car.year || !r.year || Math.abs(r.year - car.year) <= 1;
        const shared = dt.filter((w) => rt.includes(w)).length;
        return yok && shared >= Math.max(2, Math.min(dt.length, rt.length) - 1);
      });
    };
    const extraFe = seedOn ? oc.cars.filter((c) => c.fe).filter((c) => !onRoster(c)) : [];
    const extraRows = extraFe.map((c) => `<tr><td>${c.year} ${c.manufacturer} ${c.model.replace(/ ?forza edition/i, " FE")}</td><td><span class="badge tm-meta">✓ OWNED</span></td><td class="why" style="font-size:12px">${piBadge(c.class, c.pi || null, true)} — beyond the cross-source roster</td></tr>`).join("");

    host.innerHTML = `
      <div class="block" style="margin-top:0">
        <h3 style="margin-top:0">🎰 Wheelspin &amp; Forza Edition cars</h3>
        <p class="why">These cars <strong>can't be bought</strong> — only won from Wheelspins / Super Wheelspins (RNG) or reward drops, so they're the collectibles worth tracking. <strong>Tick the ✓ box</strong> on the ones you own — it's saved in this browser (localStorage), private to you. <strong>Rarity</strong> is the in-game gem tier (grey Common → blue Rare → purple Epic → gold Legendary → green FE). <strong>Meta value</strong> = whether it's a competitive pick (matched against the 48-car meta list). ● dot = source confidence. No reliable source publishes credit values, so those aren't shown.${seedOn ? " <em>Demo garage loaded: rows also reflect the owner's captured collection, and a rarity ✓ means it's confirmed in-game.</em>" : ""}</p>
      </div>

      <h3>Forza Edition roster — ${feHave} / ${fe.length} owned</h3>
      <p class="why">The FE set the community sources agree on — the full collectible checklist. Tick what you have.</p>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>✓</th><th>Car</th><th>Rarity</th><th>Status</th><th>Meta value</th></tr></thead>
        <tbody>${feRows}</tbody></table></div>
      ${extraFe.length ? `<h4 style="margin:18px 0 6px">Extra FE cars in the demo garage (not on the cross-source roster) — ${extraFe.length}</h4>
      <div style="overflow-x:auto"><table><thead><tr><th>Car</th><th>Status</th><th>Note</th></tr></thead><tbody>${extraRows}</tbody></table></div>` : ""}

      <h3 style="margin-top:26px">Wheelspin-exclusive meta cars — ${wxHave} / ${wx.length} owned</h3>
      <p class="why">Non-FE cars that are still Wheelspin-only. The NEED rows are the highest-value luck-gated targets — grind Super Wheelspins (Playlist / level-up rewards) for these.</p>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>✓</th><th>Car</th><th>Rarity</th><th>Status</th><th>Meta value</th></tr></thead>
        <tbody>${wxRows}</tbody></table></div>
      <p class="why" style="font-size:12px;margin-top:14px">Roster from game8 · insider-gaming · racinggames.gg · destructoid (4 independent sources). Community counts disagree (FE total reported 5–9), so the real in-game total may be higher than any single list.</p>`;
    host.querySelectorAll(".ws-own").forEach((cb) => cb.addEventListener("change", () => toggleWs(cb.dataset.k)));
  }

  // ---- tune lab ----
  function buildTuneLab() {
    const L = DB.tuneLab;
    const host = document.getElementById("labContent");
    if (!L || !host) return;
    const testCard = (t, dynamic) => `
      <div class="car-card" style="cursor:default">
        <div class="card-row" style="margin-top:0">
          <span class="badge tier-${dynamic ? "A" : "B"}">${dynamic ? "DRIVE" : "MENU"}</span>
          <span class="conf ${confClass(t.confidence?.split(" ")[0])}">${t.confidence?.split(" ")[0] || "method"}</span>
        </div>
        <h3 style="font-size:14px">${t.name}</h3>
        ${t.venue ? `<p class="why" style="margin:4px 0 0"><strong>Venue:</strong> ${t.venue}</p>` : ""}
        <p class="why" style="margin:6px 0 0"><strong>Sliders:</strong> ${t.sliders.join(", ")}</p>
        <p class="why" style="margin:6px 0 0"><strong>Measure:</strong> ${t.measure}</p>
        ${t.procedure ? `<p class="why" style="margin:6px 0 0">${t.procedure}</p>` : ""}
        <p class="why" style="margin:6px 0 0;color:var(--accent)"><strong>PASS:</strong> ${t.pass}</p>
        <p class="why" style="margin:4px 0 0;color:var(--warn)"><strong>FAIL:</strong> ${t.fail_symptom}</p>
        ${t.limit_finding ? `<p class="why" style="margin:6px 0 0"><strong>Limit:</strong> ${t.limit_finding}</p>` : ""}
      </div>`;
    const rows = (L.results_log.rows || []);
    host.innerHTML = `
      <p class="hint">${L.purpose}</p>
      <div class="block">
        <h3>Lab rules — non-negotiable</h3>
        <ul class="why">${Object.entries(L.lab_conditions).map(([k, v]) => `<li><strong>${k.replace(/_/g, " ")}:</strong> ${v}</li>`).join("")}</ul>
      </div>
      <div class="block">
        <h3>Instruments</h3>
        ${L.instrumentation.map((i) => `<p class="why" style="margin:4px 0"><span class="conf ${i.status.startsWith("verified") ? "conf-verified" : "conf-contested"}">${i.status.startsWith("verified") ? "✅" : "❌ verify in-game"}</span> <strong>${i.id}:</strong> ${i.what} — ${i.use}</p>`).join("")}
      </div>
      ${L.cornering_envelope ? `
      <div class="block" style="border-color:var(--accent2)">
        <h3>Cornering envelope — your car's maximum corner, as a curve <span class="conf conf-verified">✅ panel-measured</span></h3>
        <p class="why">${L.cornering_envelope.concept}</p>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:8px 0">
          <label class="why">Lateral G @ 60 mph <input id="envG60" type="number" step="0.01" value="1.11" style="width:70px"></label>
          <label class="why">@ 120 mph <input id="envG120" type="number" step="0.01" value="1.13" style="width:70px"></label>
          <label class="why">Corner radius (ft) <input id="envR" type="number" step="10" value="300" style="width:80px"></label>
          <span class="why" id="envAnswer" style="color:var(--accent)"></span>
        </div>
        <svg id="envChart" viewBox="0 0 640 300" style="width:100%;max-width:680px"></svg>
        <p class="why" style="font-size:12px;margin:6px 0 0">
          <span style="color:#199e70">■ solid green zone of influence</span> — <strong>mechanical sliders lift the whole curve</strong>: ${L.cornering_envelope.slider_mapping.lift_whole_curve_mechanical.join("; ")}.
          <span style="color:#d55181">■ magenta</span> — <strong>aero bends the fast end only</strong>: ${L.cornering_envelope.slider_mapping.bend_fast_end_aero.join("; ")}.
          Ceiling: ${L.cornering_envelope.slider_mapping.ceiling_build_not_sliders.join("; ")}.</p>
        <p class="fh6note">${L.cornering_envelope.workflow} (Defaults: ${L.cornering_envelope.defaults_note})</p>
      </div>` : ""}
      <div class="block" style="border-color:var(--accent)">
        <h3>Test 0 — ${L.test_zero.name} <span class="conf conf-contested">${L.test_zero.status}</span></h3>
        <p class="why">${L.test_zero.procedure}</p>
        <p class="fh6note">${L.test_zero.output}</p>
      </div>
      <h3 style="margin-top:20px">Static tests (from the tune menu — no driving)</h3>
      <div class="card-grid">${L.static_tests.map((t) => testCard(t, false)).join("")}</div>
      <h3 style="margin-top:20px">Dynamic tests (on track)</h3>
      <div class="card-grid">${L.dynamic_tests.map((t) => testCard(t, true)).join("")}</div>
      <div class="block">
        <h3>Symptom → slider matrix</h3>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Symptom</th><th>Phase</th><th>1st response</th><th>2nd</th><th>3rd</th><th>Verify with</th></tr></thead>
          <tbody>${L.symptom_matrix.map((s) => `<tr><td>${s.symptom}</td><td>${s.phase}</td><td><strong>${s.primary}</strong></td><td>${s.secondary}</td><td>${s.tertiary}</td><td class="why" style="font-size:11px">${s.verify_test}</td></tr>`).join("")}</tbody></table></div>
      </div>
      <div class="block">
        <h3>Fitting to a course / class</h3>
        <p class="why">${L.course_fitting.note}</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Archetype</th><th>Dominant tests</th><th>Gearing</th><th>Aero</th></tr></thead>
          <tbody>${L.course_fitting.archetypes.map((a) => `<tr><td>${a.archetype}</td><td class="why" style="font-size:12px">${a.dominant_tests.join(", ")}</td><td class="why" style="font-size:12px">${a.gearing}</td><td class="why" style="font-size:12px">${a.aero}</td></tr>`).join("")}</tbody></table></div>
        <ul class="why" style="margin-top:8px">${L.class_fitting.rules.map((r) => `<li>${r}</li>`).join("")}</ul>
      </div>
      ${L.capture_protocol ? `
      <div class="block">
        <h3>📸 Build capture protocol — 3 shots + a sentence</h3>
        <p class="why">${L.capture_protocol.purpose}</p>
        <ol class="why">${L.capture_protocol.core_3.map((s) => `<li>${s.replace(/^\d+\.\s*/, "")}</li>`).join("")}</ol>
        <p class="why"><strong>Instead of upgrade-menu shots:</strong> ${L.capture_protocol.plus_text}</p>
        <p class="why"><strong>Full record:</strong> ${L.capture_protocol.full_record}</p>
        <p class="fh6note">${L.capture_protocol.handling_problem}</p>
      </div>` : ""}
      <div class="block" style="border-color:${rows.length ? "var(--accent)" : "var(--warn)"}">
        <h3>Results log — found windows (${rows.length})</h3>
        <p class="why">${L.results_log.instructions}</p>
        ${rows.length ? `<div style="overflow-x:auto"><table>
          <thead><tr><th>Car</th><th>Course</th><th>Slider</th><th>Window</th><th>Symptom at limit</th><th>Date</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${r.car}</td><td>${r.course}</td><td>${r.slider}</td><td><strong>${r.window[0]} – ${r.window[1]}</strong></td><td class="why" style="font-size:12px">${r.symptom_at_limit}</td><td>${r.date}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="empty">No windows logged yet. Start with Test 0, then report findings in-session — example row shape: ${JSON.stringify(L.results_log.example_row.slider)} window ${JSON.stringify(L.results_log.example_row.window)}.</p>`}
      </div>`;

    // ---- cornering envelope chart ----
    const chart = document.getElementById("envChart");
    if (chart) {
      const G = 32.17, MPH = 1.46667;
      const X0 = 52, X1 = 620, Y0 = 262, Y1 = 18, RMAX = 1000, VMAX = 200;
      const xr = (r) => X0 + (r / RMAX) * (X1 - X0);
      const yv = (v) => Y0 - (v / VMAX) * (Y0 - Y1);
      // latG(v) = a + b v^2 (v in ft/s) fitted through the two panel points
      const fit = (g60, g120) => {
        const b = (g120 - g60) / (14400 - 3600) / (MPH * MPH);
        return { a: g60 - b * (60 * MPH) ** 2, b };
      };
      const vmaxAt = (r, f) => {
        const den = 1 - G * r * f.b;
        if (den <= 0.02) return VMAX + 50;
        return Math.sqrt((G * r * f.a) / den) / MPH;
      };
      const curvePts = (f) => {
        let s = "";
        for (let r = 20; r <= RMAX; r += 10) s += `${xr(r).toFixed(1)},${yv(Math.min(vmaxAt(r, f), VMAX)).toFixed(1)} `;
        return s.trim();
      };
      function drawEnv() {
        const g60 = parseFloat(document.getElementById("envG60").value) || 1.11;
        const g120 = parseFloat(document.getElementById("envG120").value) || g60;
        const f = fit(g60, g120);
        const fMech = fit(g60 + 0.07, g120 + 0.07);
        const fAero = { a: f.a, b: Math.max(f.b, 0) * 2.5 + 1.2e-6 };
        const ticksX = [0, 200, 400, 600, 800, 1000];
        const ticksY = [0, 50, 100, 150, 200];
        chart.innerHTML = `
          ${ticksY.map((v) => `<line x1="${X0}" y1="${yv(v)}" x2="${X1}" y2="${yv(v)}" stroke="var(--line)" stroke-width="0.6"/><text x="${X0 - 8}" y="${yv(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${v}</text>`).join("")}
          ${ticksX.map((r) => `<text x="${xr(r)}" y="${Y0 + 16}" text-anchor="middle" fill="var(--muted)" font-size="11">${r}</text>`).join("")}
          <text x="${(X0 + X1) / 2}" y="${Y0 + 32}" text-anchor="middle" fill="var(--muted)" font-size="11">corner radius (ft)</text>
          <text x="14" y="${(Y0 + Y1) / 2}" fill="var(--muted)" font-size="11" transform="rotate(-90 14 ${(Y0 + Y1) / 2})" text-anchor="middle">max corner speed (mph)</text>
          <polyline points="${curvePts(fAero)}" fill="none" stroke="#d55181" stroke-width="1.6" stroke-dasharray="5 4"/>
          <polyline points="${curvePts(fMech)}" fill="none" stroke="#199e70" stroke-width="1.6" stroke-dasharray="5 4"/>
          <polyline points="${curvePts(f)}" fill="none" stroke="var(--accent2)" stroke-width="2.4"/>
          <text x="${X1 - 4}" y="${yv(Math.min(vmaxAt(RMAX, f), VMAX)) - 6}" text-anchor="end" fill="var(--accent2)" font-size="11">your car</text>
          <text x="${X1 - 4}" y="${yv(Math.min(vmaxAt(RMAX, fMech), VMAX)) - 18}" text-anchor="end" fill="#199e70" font-size="11">+ mechanical work (+0.07 G)</text>
          <text x="${X1 - 4}" y="${yv(Math.min(vmaxAt(RMAX, fAero), VMAX)) + 14}" text-anchor="end" fill="#d55181" font-size="11">+ downforce (fast end bends up)</text>
          <line id="envGuide" x1="0" y1="0" x2="0" y2="0" stroke="var(--warn)" stroke-width="1" opacity="0"/>`;
        const r = parseFloat(document.getElementById("envR").value) || 300;
        const v = vmaxAt(r, f);
        document.getElementById("envAnswer").textContent =
          `→ a ${r} ft corner holds ~${v > VMAX ? "200+" : v.toFixed(0)} mph (grip gives up above that)`;
        const gd = document.getElementById("envGuide");
        gd.setAttribute("x1", xr(r)); gd.setAttribute("x2", xr(r));
        gd.setAttribute("y1", Y0); gd.setAttribute("y2", yv(Math.min(v, VMAX)));
        gd.setAttribute("opacity", "0.8");
      }
      ["envG60", "envG120", "envR"].forEach((id) =>
        document.getElementById(id).addEventListener("input", drawEnv));
      chart.addEventListener("mousemove", (ev) => {
        const rect = chart.getBoundingClientRect();
        const r = Math.max(20, Math.min(RMAX, ((ev.clientX - rect.left) / rect.width * 640 - X0) / (X1 - X0) * RMAX));
        document.getElementById("envR").value = Math.round(r / 10) * 10;
        drawEnv();
      });
      drawEnv();
    }
  }

  // ---- Training Zone: feeling-first corner school on the grip-slide spectrum ----
  const TZ_TABS = ["TIRES", "GEARING", "ALIGNMENT", "ANTIROLL BARS", "SPRINGS", "DAMPING", "AERO", "BRAKE", "DIFFERENTIAL"];
  const TZ_PHASE_DEF = [
    "Straight-line deceleration. Weight piles onto the front; the rear goes light. Brakes and rear decel-lock rule here.",
    "The transient. You are asking the car to change direction — dampers, toe and caster own this half-second, and nothing else can fix it.",
    "Steady state. Load has settled; this is where lateral G, aero balance and mechanical balance are actually measured.",
    "Power down. The differential decides which wheels drive and how tied together they are; traction is the whole question.",
    "Full commitment. Aero and gearing only — no more grip is coming, so stability is everything.",
  ];
  const TZ_C = { mom: "#00d27a", nose: "#2f81f7", body: "#d3dae4", dark: "#12161c", bad: "#e5414e", warn: "#e3b341", road: "#262d38" };

  // top-down car showing what the chassis is physically doing
  const TZ_SEGS = [
    "M 208 300 L 208 214",
    "M 208 214 L 208 176 Q 208 146 194 122",
    "M 194 122 Q 180 98 140 88.6",
    "M 140 88.6 L 88 88",
    "M 88 88 L 8 88",
  ];
  function carDiag(v, ph) {
    const cx = 208, cy = 186, head = v.heading || 0, trav = v.travel || 0, steer = v.steer || 0;
    const R = (a) => a * Math.PI / 180;
    const px = (x, y, a, d) => [x + d * Math.sin(R(a)), y - d * Math.cos(R(a))];
    const P = (a, d) => px(cx, cy, a, d);
    const arrow = (a, r0, r1, col, w, dash) => {
      const [x0, y0] = P(a, r0), [x1, y1] = P(a, r1);
      const [ax, ay] = px(x1, y1, a, 12), [bx, by] = px(x1, y1, a + 90, 6.5), [dx2, dy2] = px(x1, y1, a - 90, 6.5);
      return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>
        <polygon points="${ax},${ay} ${bx},${by} ${dx2},${dy2}" fill="${col}"/>`;
    };
    const tireCol = (which) => {
      const L = v.loose;
      if (L === "all") return gripCol("both");      // the axle that let go must READ as that axle: front blue,
      if (L === "limit") return gripCol("impact");   // rear red, all four purple — they were all one red before
      if (L === which) return gripCol(which === "front" ? "front" : "rear");
      return TZ_C.dark;
    };
    const tire = (x, y, col, rot) => `<rect x="${x}" y="${y}" width="10" height="22" rx="2.5" fill="${col}"${rot ? ` transform="rotate(${rot} ${x + 5} ${y + 11})"` : ""}/>`;
    const ghost = v.ghost != null ? `<g transform="rotate(${v.ghost} ${cx} ${cy})" opacity="0.22">
        <rect x="${cx - 25}" y="${cy - 47}" width="50" height="94" rx="10" fill="${TZ_C.body}"/></g>` : "";
    const dirt = v.surface === "dirt";
    return `<svg viewBox="0 0 416 300" class="tz-svg" role="img" aria-label="${(v.caption || "car behaviour").replace(/"/g, "&quot;")}">
      <path d="M 208 300 L 208 176 Q 208 96 128 88 L 8 88" fill="none" stroke="${dirt ? "#3a3128" : TZ_C.road}" stroke-width="96" stroke-linejoin="round"/>
      ${TZ_SEGS.map((sg, i) => `<path d="${sg}" fill="none" stroke="${CM_PC[i]}" stroke-width="${i + 1 === ph ? 13 : 5}" stroke-linecap="round" opacity="${i + 1 === ph ? 1 : 0.22}"/>`).join("")}
      <path d="M 208 300 L 208 176 Q 208 96 128 88 L 8 88" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="9 9" opacity="0.4"/>
      ${ph ? `<text x="12" y="292" fill="${CM_PC[ph - 1]}" font-size="12" font-weight="700" font-family="system-ui,-apple-system,sans-serif">PHASE ${ph} · ${CM_SHORT[ph - 1].toUpperCase()}</text>` : ""}
      ${v.outcome === "wide" || v.outcome === "spin" ? arrow(trav, 52, 128, TZ_C.bad, 3.5, "7 6") : ""}
      ${ghost}
      ${arrow(trav, 0, 92, TZ_C.mom, 6)}
      <g transform="rotate(${head} ${cx} ${cy})">
        ${tire(cx - 33, cy - 36, tireCol("front"), steer)}
        ${tire(cx + 23, cy - 36, tireCol("front"), steer)}
        ${tire(cx - 33, cy + 14, tireCol("rear"), 0)}
        ${tire(cx + 23, cy + 14, tireCol("rear"), 0)}
        <rect x="${cx - 25}" y="${cy - 47}" width="50" height="94" rx="10" fill="${TZ_C.body}" stroke="#0e1116" stroke-width="2"/>
        <rect x="${cx - 19}" y="${cy - 27}" width="38" height="19" rx="3.5" fill="#33404f"/>
        <rect x="${cx - 16}" y="${cy - 44}" width="32" height="8" rx="2.5" fill="#9aa4b0"/>
      </g>
      ${arrow(head, 56, 104, TZ_C.nose, 2.5, "6 5")}
      <g font-family="system-ui,-apple-system,sans-serif" font-size="11">
        <text x="10" y="20" fill="${TZ_C.mom}" font-weight="700">MOMENTUM</text><text x="10" y="34" fill="var(--muted)">where it actually goes</text>
        <text x="10" y="56" fill="${TZ_C.nose}" font-weight="700">NOSE</text><text x="10" y="70" fill="var(--muted)">where it points</text>
        ${v.loose && v.loose !== "none" ? `<text x="300" y="20" fill="${v.loose === "limit" ? TZ_C.warn : TZ_C.bad}" font-weight="700">${v.loose === "limit" ? "AT THE LIMIT" : (v.loose === "all" ? "ALL FOUR SLIDING" : v.loose.toUpperCase() + " SLIDING")}</text>` : ""}
        ${v.outcome === "wide" ? `<text x="240" y="284" fill="${TZ_C.bad}" font-weight="700">runs wide →</text>` : ""}
        ${v.outcome === "spin" ? `<text x="250" y="284" fill="${TZ_C.bad}" font-weight="700">lets go →</text>` : ""}
        ${dirt ? `<text x="300" y="40" fill="#f0883e" font-weight="700">LOOSE SURFACE</text>` : ""}
      </g>
    </svg>`;
  }

  // the nine tabs, ALWAYS in game order, lit by relevance
  function tuneRack(rack) {
    const pri = (rack && rack.primary) || [], sec = (rack && rack.secondary) || [];
    return `<div class="tz-rack">${TZ_TABS.map((t) => {
      const st = pri.includes(t) ? "pri" : sec.includes(t) ? "sec" : "off";
      return `<span class="tz-tab tz-${st}" title="${st === "pri" ? "primary owner of this scenario" : st === "sec" ? "secondary influence" : "inert here — leave it alone"}">${t}</span>`;
    }).join("")}</div>`;
  }

  // a front:rear pair shown at BOTH extremes, with the direction this scenario wants
  function ratioBar(r) {
    const t = Math.max(4, Math.min(96, r.target != null ? r.target : 50));
    return `<div class="tz-ratio">
      <div class="tz-ratio-name">${r.pair}</div>
      <div class="tz-ratio-grid">
        <div class="tz-ratio-end tz-left"><strong>${r.lo}</strong><span>${r.lo_feel}</span></div>
        <div class="tz-ratio-track"><i style="left:${t}%"></i></div>
        <div class="tz-ratio-end tz-right"><strong>${r.hi}</strong><span>${r.hi_feel}</span></div>
      </div>
      <div class="tz-ratio-why">${r.why}</div>
    </div>`;
  }

  function buildTraining() {
    const tz = DB.trainingZone;
    const host = document.getElementById("trainingContent");
    if (!tz || !host) return;
    const tierPill = (t) => `<span class="conf ${/player-verified/.test(t) ? "conf-verified" : /contested/.test(t) ? "conf-contested" : "conf-probable"}" title="${(t || "").replace(/"/g, "&quot;")}">${/player-verified/.test(t) ? "✅ player-verified" : /contested/.test(t) ? "⚠️ contested" : "🟡 doctrine"}</span>`;

    // --- grip science: the slip curve ---
    const gs = tz.grip_science;
    const SC = { x0: 56, x1: 604, y0: 246, y1: 26, smax: 60, gmax: 1.12 };
    const sx = (s) => SC.x0 + (s / SC.smax) * (SC.x1 - SC.x0);
    const sy = (g) => SC.y0 - (g / SC.gmax) * (SC.y0 - SC.y1);
    const shape = { slick: 2.2, "rally-tarmac": 1.6, "rally-dirt": 0.9 };
    const curve = (su) => {
      const a = shape[su.id] || 1.5, pts = [];
      for (let s = 0.4; s <= SC.smax; s += 0.6) {
        const x = s / su.peak_slip;
        pts.push([sx(s), sy(su.peak_grip * Math.pow(x, a) * Math.exp(a * (1 - x)))]);
      }
      return pts.map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    };
    const zoneCol = { muted: gripCol("calm"), good: "#00d27a", mixed: gripCol("impact"), drift: gripCol("both") };   // drift is PURPLE everywhere now (it read red here, purple in the lab)
    const slipSvg = `<svg viewBox="0 0 640 300" class="tz-svg tz-wide" role="img" aria-label="Grip versus slip angle">
      ${gs.slip_curve.zones.map((z) => `<rect x="${sx(z.from)}" y="${SC.y1}" width="${sx(z.to) - sx(z.from)}" height="${SC.y0 - SC.y1}" fill="${zoneCol[z.tone]}" opacity="0.09"/>`).join("")}
      <line x1="${SC.x0}" y1="${SC.y0}" x2="${SC.x1}" y2="${SC.y0}" stroke="var(--line)" stroke-width="1.5"/>
      <line x1="${SC.x0}" y1="${SC.y0}" x2="${SC.x0}" y2="${SC.y1}" stroke="var(--line)" stroke-width="1.5"/>
      ${[0, 10, 20, 30, 40, 50, 60].map((s) => `<text x="${sx(s)}" y="${SC.y0 + 16}" text-anchor="middle" fill="var(--muted)" font-size="10">${s}°</text>`).join("")}
      <text x="${(SC.x0 + SC.x1) / 2}" y="${SC.y0 + 32}" text-anchor="middle" fill="var(--muted)" font-size="11">slip angle — how far the tire is sliding vs pointing</text>
      <text x="14" y="${(SC.y0 + SC.y1) / 2}" transform="rotate(-90 14 ${(SC.y0 + SC.y1) / 2})" text-anchor="middle" fill="var(--muted)" font-size="11">grip</text>
      ${gs.slip_curve.surfaces.map((su) => `<path d="${curve(su)}" fill="none" stroke="${su.color}" stroke-width="3"/>
        <circle cx="${sx(su.peak_slip)}" cy="${sy(su.peak_grip)}" r="5" fill="${su.color}"/>
        <text x="${sx(su.peak_slip)}" y="${sy(su.peak_grip) - 11}" text-anchor="middle" fill="${su.color}" font-size="11" font-weight="700">peak</text>`).join("")}
      ${gs.slip_curve.zones.map((z, i) => `<text x="${(sx(z.from) + sx(z.to)) / 2}" y="${SC.y1 + (i % 2 ? 26 : 12)}" text-anchor="middle" fill="${zoneCol[z.tone]}" font-size="10" opacity="0.95">${z.label.split(" · ")[0].split(" — ")[0]}</text>`).join("")}
    </svg>`;

    // --- grip science: the traction circle ---
    const TC = { cx: 168, cy: 158, r: 108 };
    const tcArrow = (ang, len, col, w, lbl, dash) => {
      const x = TC.cx + len * Math.sin(ang * Math.PI / 180), y = TC.cy - len * Math.cos(ang * Math.PI / 180);
      return `<line x1="${TC.cx}" y1="${TC.cy}" x2="${x}" y2="${y}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>
        <circle cx="${x}" cy="${y}" r="5" fill="${col}"/>${lbl ? `<text x="${x + (Math.sin(ang * Math.PI / 180) > 0 ? 10 : -10)}" y="${y + 4}" fill="${col}" font-size="11" font-weight="700" text-anchor="${Math.sin(ang * Math.PI / 180) > 0 ? "start" : "end"}">${lbl}</text>` : ""}`;
    };
    const circSvg = `<svg viewBox="0 0 400 300" class="tz-svg" role="img" aria-label="Traction circle">
      <circle cx="${TC.cx}" cy="${TC.cy}" r="${TC.r}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
      <circle cx="${TC.cx}" cy="${TC.cy}" r="${TC.r * 0.66}" fill="none" stroke="var(--line)" stroke-width="1" stroke-dasharray="4 5"/>
      <line x1="${TC.cx - TC.r}" y1="${TC.cy}" x2="${TC.cx + TC.r}" y2="${TC.cy}" stroke="var(--line)"/>
      <line x1="${TC.cx}" y1="${TC.cy - TC.r}" x2="${TC.cx}" y2="${TC.cy + TC.r}" stroke="var(--line)"/>
      <text x="${TC.cx}" y="${TC.cy - TC.r - 8}" text-anchor="middle" fill="var(--muted)" font-size="10">accelerating</text>
      <text x="${TC.cx}" y="${TC.cy + TC.r + 16}" text-anchor="middle" fill="var(--muted)" font-size="10">braking</text>
      <text x="${TC.cx - TC.r - 6}" y="${TC.cy - 6}" text-anchor="end" fill="var(--muted)" font-size="10">cornering</text>
      ${tcArrow(180, TC.r, TZ_C.mom, 4, "100% brake")}
      ${tcArrow(216, TC.r * 1.34, TZ_C.bad, 4, "+ steering = SLIDE", "7 5")}
      <path d="M ${TC.cx} ${TC.cy + TC.r} A ${TC.r} ${TC.r} 0 0 1 ${TC.cx - TC.r} ${TC.cy}" fill="none" stroke="${TZ_C.warn}" stroke-width="3.5" stroke-dasharray="8 6"/>
      <text x="${TC.cx - TC.r + 4}" y="${TC.cy + TC.r - 18}" fill="${TZ_C.warn}" font-size="11" font-weight="700">trail-brake: ride the edge</text>
      <text x="${TC.cx}" y="${TC.cy + 5}" text-anchor="middle" fill="var(--muted)" font-size="10">safe</text>
    </svg>`;

    // visual-first primitives (prose budget: rules + drawers instead of paragraphs)
    const ruleCard = (ico, head, why, color) => `<div class="tz-rule"${color ? ` style="border-left-color:${color}"` : ""}>
      <div class="tzr-head"><span class="tzr-ico">${ico}</span><span>${head}</span></div>
      ${why ? `<details class="tz-why"><summary>why</summary><p>${why}</p></details>` : ""}</div>`;
    const SURF_SHORT = {
      slick: "highest peak · sharpest cliff — huge grip at 7°, brutal at 12°",
      "rally-tarmac": "lower peak · kinder fall — the PI-arbitrage trade",
      "rally-dirt": "a PLATEAU, not a cliff — 20° of slip IS the operating point",
    };
    const gripBlock = `
      <div class="block" style="border-color:var(--accent)">
        <h3>🎯 ${gs.headline}</h3>
        <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;margin-top:10px">
          <div style="flex:1 1 420px;min-width:340px">${slipSvg}</div>
          <div style="flex:1 1 300px;min-width:280px">
            <div style="overflow-x:auto"><table>
              <thead><tr><th>Tire · surface</th><th>Peak</th><th>Past the peak</th></tr></thead>
              <tbody>${gs.slip_curve.surfaces.map((s) => `<tr title="${s.note.replace(/"/g, "&quot;")}"><td><span style="color:${s.color}">●</span> <strong style="font-size:12px">${s.label}</strong></td><td style="color:${s.color};font-weight:800">${s.peak_slip}°</td><td class="why" style="font-size:12px">${SURF_SHORT[s.id] || s.note}</td></tr>`).join("")}</tbody>
            </table></div>
            <div class="tz-rules" style="grid-template-columns:1fr">
              ${ruleCard("⚠️", "Past the peak you get LESS grip and MORE angle — a slide feeds itself", gs.slip_curve.concept, "var(--warn)")}
              ${ruleCard("🧊", "Setup can WIDEN the peak, not raise it — pressure, compound, damping turn the cliff into a slope", gs.slip_curve.why_it_feels_sudden, "var(--accent2)")}
            </div>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid var(--line);margin:16px 0">
        <h3 style="margin-top:0">⭕ The traction circle — one budget, spent in every direction</h3>
        <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start">
          <div style="flex:0 1 380px;min-width:300px">${circSvg}</div>
          <div style="flex:1 1 300px;min-width:280px">
            <div class="tz-rules" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
              ${ruleCard("⭕", "Brake, turn and drive all draw from ONE circle — the total is a vector", gs.traction_circle.concept)}
              ${ruleCard("🔪", "100% braking = already on the edge; any steering tips the vector outside", gs.traction_circle.why_trail_braking_is_knife_edge, "#e5414e")}
              ${ruleCard("🤝", "Trail-braking = trading brake for turn while staying ON the rim", gs.traction_circle.the_trade, "var(--warn)")}
              ${ruleCard("🔧", "Tuning decides how the four circles are FILLED — only compound and load grow them", gs.traction_circle.tuning_link, "var(--accent2)")}
            </div>
          </div>
        </div>
        <strong style="display:block;margin-top:14px;font-size:13px">📊 See it on the real screens</strong>
        <div class="tz-proofgrid">
          ${[["friction", "Friction", "Which tire quit, and by how much — ring + Peak% per wheel. First red = the answer."],
             ["body-acceleration", "Body Acceleration", "The whole-car budget, live: dot distance = how much, direction = spent on what."],
             ["tires-misc", "Tires, Misc.", "Wheel-speed split = the spin / lock-up detector."],
             ["heat", "Heat", "Inner/middle/outer temps = where the patch really works — camber ground truth."]]
            .map(([slug, name, cap], i) => `<figure title="${(gs.telemetry_proof[i] || "").replace(/"/g, "&quot;")}">
              <a href="assets/telemetry/${slug}.jpg" target="_blank"><img src="assets/telemetry/${slug}.jpg" alt="${name} page"></a>
              <figcaption><strong>${name}</strong> — ${cap}</figcaption>
            </figure>`).join("")}
        </div>
      </div>`;

    // --- friction diagnosis: the oversteer/understeer instrument ---
    const fd = tz.friction_diagnosis;
    let fdBlock = "";
    if (fd) {
      const bandBar = `
        <div style="display:flex;height:30px;border-radius:7px;overflow:hidden;margin:10px 0 4px">
          ${fd.peak_bands.map((b) => `<div title="${b.meaning.replace(/"/g, "&quot;")}" style="flex:0 0 ${b.w}%;background:${b.color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#0e1116">${b.label}</div>`).join("")}
        </div>
        <div style="display:flex;font-size:10px;color:var(--muted)">
          ${fd.peak_bands.map((b) => `<div style="flex:0 0 ${b.w}%;text-align:center">${b.band}</div>`).join("")}
        </div>`;
      const NC = { cx: 108, cy: 112, r: 66 };
      const ncA = (dx, dy, col, lbl, ax, ay, dash) => `
        <line x1="${NC.cx}" y1="${NC.cy}" x2="${NC.cx + dx}" y2="${NC.cy + dy}" stroke="${col}" stroke-width="3.5" stroke-linecap="round"${dash ? ` stroke-dasharray="6 5"` : ""}/>
        <circle cx="${NC.cx + dx}" cy="${NC.cy + dy}" r="4.5" fill="${col}"/>
        <text x="${NC.cx + ax}" y="${NC.cy + ay}" text-anchor="middle" fill="${col}" font-size="10" font-weight="700">${lbl}</text>`;
      const needleSvg = `<svg viewBox="0 0 340 224" class="tz-svg" role="img" aria-label="Reading the needle">
        <circle cx="${NC.cx}" cy="${NC.cy}" r="${NC.r}" fill="none" stroke="#00d27a" stroke-width="2.5"/>
        ${ncA(0, -NC.r, "var(--accent2)", "drive", 0, -NC.r - 10)}
        ${ncA(0, NC.r, TZ_C.mom, "brake", 0, NC.r + 18)}
        ${ncA(-NC.r, 0, "var(--muted)", "corner", -NC.r - 2, -12)}
        ${ncA(NC.r, 0, "var(--muted)", "corner", NC.r + 2, -12)}
        ${ncA(NC.r * 0.94, NC.r * 0.94, TZ_C.bad, "two jobs = red ring", NC.r * 0.35, NC.r + 34, true)}
        <circle cx="278" cy="66" r="34" fill="none" stroke="#00d27a" stroke-width="2"/>
        <circle cx="278" cy="158" r="11" fill="none" stroke="#00d27a" stroke-width="2"/>
        <text x="278" y="112" text-anchor="middle" fill="var(--muted)" font-size="9.5">ring = load</text>
        <text x="278" y="186" text-anchor="middle" fill="var(--muted)" font-size="9.5">unloaded</text>
      </svg>`;
      const fdMatrix = `
        <div style="overflow-x:auto;margin-top:12px"><table style="min-width:900px">
          <thead><tr><th style="width:110px"></th>${fd.matrix.map((m) => `<th style="background:${CM_PC[m.phase - 1]}22;border-top:4px solid ${CM_PC[m.phase - 1]}"><span style="color:${CM_PC[m.phase - 1]};font-weight:700">${m.phase} · ${CM_SHORT[m.phase - 1]}</span></th>`).join("")}</tr></thead>
          <tbody>
            <tr><td><strong style="color:#2f81f7">FRONTS<br>red first</strong><p class="why" style="font-size:10px;margin:4px 0 0">= understeer family</p></td>
              ${fd.matrix.map((m) => `<td style="vertical-align:top"><strong style="font-size:12px">${m.front.name}</strong>
                <p class="why" style="font-size:11px;margin:4px 0"><em>${m.front.tell}</em></p>
                <ul class="why" style="font-size:11px;margin:4px 0 0;padding-left:16px">${m.front.fix.map((f) => `<li>${f}</li>`).join("")}</ul></td>`).join("")}</tr>
            <tr><td><strong style="color:#e5414e">REARS<br>red first</strong><p class="why" style="font-size:10px;margin:4px 0 0">= oversteer family</p></td>
              ${fd.matrix.map((m) => `<td style="vertical-align:top"><strong style="font-size:12px">${m.rear.name}</strong>
                <p class="why" style="font-size:11px;margin:4px 0"><em>${m.rear.tell}</em></p>
                <ul class="why" style="font-size:11px;margin:4px 0 0;padding-left:16px">${m.rear.fix.map((f) => `<li>${f}</li>`).join("")}</ul></td>`).join("")}</tr>
          </tbody>
        </table></div>`;
      // both maps are now VIEWS onto the one GRIP identity (the hand-authored timeline says "spike" where telemetry says "impact")
      const stCol = { calm: gripCol("calm"), front: gripCol("front"), rear: gripCol("rear"), both: gripCol("both"), spike: gripCol("impact") };
      const stLbl = { calm: GRIP.calm.axle, front: `${GRIP.front.axle} — ${GRIP.front.word}`, rear: `${GRIP.rear.axle} — ${GRIP.rear.word}`, both: GRIP.both.axle, spike: `${GRIP.impact.axle} (discard)` };
      const run = fd.your_run;
      const CW = 740 / run.timeline.length;
      const runStrip = `<svg viewBox="0 0 740 84" class="tz-svg tz-wide" role="img" aria-label="Your run, second by second">
        ${run.timeline.map((f, i) => `<g><rect x="${(i * CW).toFixed(1)}" y="10" width="${(CW - 1.6).toFixed(1)}" height="44" rx="3" fill="${stCol[f.state]}" opacity="${f.state === "calm" ? 0.55 : 0.95}"><title>0:${String(f.t).padStart(2, "0")} — FL ${f.fl}% · FR ${f.fr}% · RL ${f.rl}% · RR ${f.rr}% — ${stLbl[f.state]}</title></rect>
          ${f.t % 5 === 0 ? `<text x="${(i * CW + CW / 2).toFixed(1)}" y="72" text-anchor="middle" fill="var(--muted)" font-size="9">0:${String(f.t).padStart(2, "0")}</text>` : ""}</g>`).join("")}
      </svg>`;
      fdBlock = `
      <div class="block" style="border-color:#e5414e">
        <div class="card-row" style="margin-top:0"><h3 style="margin:0">🩺 ${fd.headline}</h3>${tierPill(fd.tier)}</div>
        <div class="tz-quote">${fd.core_rule}</div>
        <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;margin-top:12px">
          <div style="flex:1 1 400px;min-width:330px">
            <strong style="font-size:13px">Peak % is your position on the slip curve</strong>
            ${bandBar}
            <ul class="why" style="font-size:12px;margin-top:10px">${fd.instrument_notes.map((n) => `<li>${n}</li>`).join("")}</ul>
          </div>
          <div style="flex:0 1 360px;min-width:300px">
            <strong style="font-size:13px">Reading the needle</strong>
            ${needleSvg}
            <p class="why" style="font-size:11px;margin:4px 0 0">${fd.needle.ring_size}</p>
          </div>
          <div style="flex:1 1 320px;min-width:280px">
            <strong style="font-size:13px">The instrument itself</strong>
            <a href="assets/telemetry/friction.jpg" target="_blank" title="Friction page — player capture, click for full size"><img src="assets/telemetry/friction.jpg" alt="Friction telemetry page, player capture" style="width:100%;border-radius:8px;margin-top:8px;border:1px solid var(--line)"></a>
            <p class="why" style="font-size:11px;margin:6px 0 0">Your capture — fronts at 179/188% (red, saturated) while the rears hold: an understeer moment, on instruments. Open telemetry with <code>T</code>, cycle pages with <code>Page Up</code>/<code>Page Down</code>.</p>
          </div>
        </div>
        <h3 style="margin-top:16px">The diagnostic matrix — axle × phase → fix</h3>
        <p class="why">${fd.needle.concept}</p>
        ${fdMatrix}
        <p class="why" style="margin-top:10px"><strong>Both axles red:</strong> ${fd.both_red}</p>
        <div class="tz-proof" style="margin-top:14px"><strong>📋 The capture workflow</strong>
          <ol class="why" style="margin:6px 0 0;padding-left:20px">${fd.how_to_capture.map((s) => `<li>${s}</li>`).join("")}</ol>
        </div>
        <h3 style="margin-top:16px">📼 Your run, on instruments</h3>
        <p class="why">${run.context}</p>
        ${runStrip}
        <div class="chips" style="margin:4px 0 10px">${Object.keys(stCol).map((k) => `<span class="chip" style="border-color:${stCol[k]};color:${k === "calm" ? "var(--muted)" : stCol[k]}">${stLbl[k]}</span>`).join("")}</div>
        <div class="card-grid">
          ${run.moments.map((m) => `<div class="car-card" style="cursor:default">
            <div class="card-row" style="margin-top:0"><h3 style="font-size:13px;margin:0">${m.t} — ${m.title}</h3><span class="chip">${m.cell}</span></div>
            <p class="why" style="font-size:11px;margin:6px 0"><code>${m.numbers}</code></p>
            <p class="why" style="font-size:12px;margin:0">${m.lesson}</p>
          </div>`).join("")}
        </div>
      </div>`;
    }

    // --- controllability ---
    const co = tz.controllability;
    const coBlock = co ? `
      <div class="block" style="border-color:var(--accent2)">
        <div class="card-row" style="margin-top:0"><h3 style="margin:0">🪃 ${co.headline}</h3>${tierPill(co.tier)}</div>
        <p class="why">${co.concept}</p>
        <div class="card-grid" style="margin-top:10px">
          ${co.three_qualities.map((q) => `<div class="car-card" style="cursor:default">
            <h3 style="font-size:14px">${q.name}</h3>
            <p class="why" style="font-size:12px;margin:4px 0 8px"><em>${q.question}</em></p>
            <div class="tz-hilo"><span class="tz-hi">✔ ${q.high}</span><span class="tz-lo">✘ ${q.low}</span></div>
            <div class="chips" style="margin-top:8px">${q.sliders.map((s) => `<span class="chip tz-slider" title="${s.why.replace(/"/g, "&quot;")}"><strong>${s.s}</strong> → ${s.dir}</span>`).join("")}</div>
          </div>`).join("")}
        </div>
        <div class="tz-proof"><strong>📊 ${co.the_measurable_test.name}</strong>
          <p class="why" style="margin:6px 0"><strong>Do:</strong> ${co.the_measurable_test.procedure}</p>
          <p class="why" style="margin:6px 0"><strong>Read:</strong> ${co.the_measurable_test.read}</p>
          <p class="why" style="margin:6px 0"><strong>Tune toward:</strong> ${co.the_measurable_test.tune_toward}</p>
        </div>
        <p class="why" style="margin-top:10px"><strong>The chassis half:</strong> ${co.car_side}</p>
      </div>` : "";

    // --- chassis character: plot any car from its two visible numbers ---
    const cc = tz.chassis_character;
    const ccBlock = cc ? `
      <div class="block" style="border-color:var(--accent2)">
        <div class="card-row" style="margin-top:0"><h3 style="margin:0">🧭 ${cc.headline}</h3>${tierPill(cc.tier)}</div>
        <p class="why">${cc.concept}</p>
        <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;margin-top:10px">
          <div style="flex:1 1 400px;min-width:330px">
            <svg id="ccChart" viewBox="0 0 620 380" class="tz-svg" role="img" aria-label="Chassis character map"></svg>
          </div>
          <div style="flex:1 1 280px;min-width:270px">
            <div class="controls" style="padding:12px">
              <label>Weight (lb)<input id="ccW" type="number" value="3148" min="1200" max="6000" step="10"></label>
              <label>Front weight %<input id="ccF" type="number" value="54" min="35" max="70" step="1"></label>
            </div>
            <div id="ccRead" style="margin-top:10px"></div>
          </div>
        </div>
        <ul class="why" style="margin-top:10px">${cc.reading.map((r) => `<li>${r}</li>`).join("")}</ul>
      </div>` : "";

    // --- braking science ---
    const bs = tz.braking_science;
    const bsBlock = bs ? `
      <div class="block">
        <div class="card-row" style="margin-top:0"><h3 style="margin:0">🛑 ${bs.headline}</h3>${tierPill(bs.tier)}</div>
        <p class="why">${bs.concept}</p>
        <p class="why"><strong>The counterintuitive part:</strong> ${bs.the_counterintuitive_part}</p>
        <ul class="why">${bs.what_makes_a_car_lock_resistant.map((x) => `<li>${x}</li>`).join("")}</ul>
        <div class="tz-proof"><strong>📐 ${bs.the_panel_test.name}</strong>
          <p class="why" style="margin:6px 0"><strong>Math:</strong> ${bs.the_panel_test.math}</p>
          <p class="why" style="margin:6px 0"><strong>Read:</strong> ${bs.the_panel_test.read}</p>
          <p class="why" style="margin:6px 0"><strong>Worked example:</strong> ${bs.the_panel_test.worked_example}</p>
          <div class="controls" style="padding:10px;margin-top:8px">
            <label>60-0 ft<input id="abI60" type="number" value="79.1" step="0.1" min="40" max="300"></label>
            <label>100-0 ft<input id="abI100" type="number" value="195.2" step="0.1" min="80" max="600"></label>
          </div>
          <p id="abOut" class="why" style="margin:8px 0 0;font-size:14px"></p>
        </div>
        <p class="why" style="margin-top:10px"><strong>Tuning response:</strong> ${bs.tuning_response}</p>
      </div>` : "";

    // --- ratio doctrine ---
    const rd = tz.ratio_doctrine;
    const ratioBlock = `
      <div class="block">
        <h3>⚖️ ${rd.headline}</h3>
        <p class="why">${rd.principle}</p>
        <div style="overflow-x:auto;margin-top:10px"><table>
          <thead><tr><th>Tab</th><th>The pair</th><th>The RATIO decides…</th><th>The MAGNITUDE decides…</th></tr></thead>
          <tbody>${rd.pairs.map((p) => `<tr><td><span class="tz-tab tz-pri" style="font-size:10px">${p.tab}</span></td><td><strong>${p.pair}</strong></td><td class="why" style="font-size:12px">${p.ratio}</td><td class="why" style="font-size:12px">${p.magnitude}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="why" style="margin-top:10px"><strong>Reading rule:</strong> ${rd.reading_rule}</p>
      </div>`;

    // --- spectrum ---
    const spectrum = `
      <div class="block" style="border-color:var(--accent)">
        <h3>🎚 The grip–slide spectrum</h3>
        <p class="why">${tz.spectrum.concept}</p>
        <div style="height:14px;border-radius:7px;background:linear-gradient(90deg,#4b96f3 0%,#f0883e 55%,#e5414e 100%);margin:12px 0 6px"></div>
        <div class="tz-3col">
          ${tz.spectrum.stations.map((s) => `<div><strong>${s.label}</strong> <span class="chip">slip ${s.slip}</span>
            <p class="why" style="font-size:12px;margin:4px 0 0">${s.doctrine}${s.status ? ` <em>(${s.status})</em>` : ""}</p></div>`).join("")}
        </div>
      </div>`;

    // --- conditions ---
    const conditions = `
      <div class="block" style="border-color:var(--warn,#e3b341)">
        <h3>🧊 Before you blame a slider — the conditions layer</h3>
        <p class="why">${(tz.conditions.headline.split(" — ")[1] || tz.conditions.headline)}</p>
        <div class="card-grid" style="margin-top:10px">
          ${tz.conditions.checks.map((c) => `<div class="car-card" style="cursor:default">
            <div class="tz-quote">${c.icon} ${c.feeling}</div>
            <p class="why" style="margin:8px 0 4px">${c.mechanism}</p>
            <p class="why" style="font-size:12px"><strong>Tells:</strong> ${c.tells}</p>
            <p class="why" style="font-size:12px"><strong>Options:</strong> ${c.options}</p>
            <div style="margin-top:6px">${tierPill(c.tier)}</div>
          </div>`).join("")}
        </div>
      </div>`;

    // --- telemetry inventory ---
    const tel = tz.telemetry;
    const TEL_IMG = { "General": "general", "Body Acceleration": "body-acceleration", "Friction": "friction", "Tires, Misc.": "tires-misc", "Heat": "heat", "Suspension": "suspension", "Damage": "damage" };
    const telShot = (name, w) => TEL_IMG[name] ? `<a href="assets/telemetry/${TEL_IMG[name]}.jpg" target="_blank" title="${name} — player capture, click for full size"><img src="assets/telemetry/${TEL_IMG[name]}.jpg" alt="${name} telemetry page" style="width:${w || 190}px;border-radius:6px;display:block;border:1px solid var(--line)"></a>` : "";
    const telBlock = tel ? `
      <div class="block">
        <h3>📊 ${tel.headline}</h3>
        <p class="why"><strong>How:</strong> ${tel.how}</p>
        <div style="overflow-x:auto;margin-top:8px"><table>
          <thead><tr><th>The screen</th><th>Page</th><th>Shows</th><th>Proves</th></tr></thead>
          <tbody>${tel.pages.map((p) => `<tr><td>${telShot(p.name)}</td><td><strong>${p.name}</strong></td><td class="why" style="font-size:12px">${p.shows}</td><td class="why" style="font-size:12px">${p.proves}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="why" style="font-size:11px;margin-top:6px">${tel.captured}</p>
      </div>` : "";

    const legend = `
      <div class="block" style="border-color:var(--accent2)">
        <h3>🎨 The five phases — one colour each, everywhere on this site</h3>
        <p class="why">Every corner is five mechanically distinct events, and a slider that rules one of them is usually inert in the others. These colours are the same on the Tuning page's corner map, in the mini-glyphs beside each slider, and on every diagram below — learn them once and the whole site reads faster.</p>
        <div class="tz-legend">
          ${CM_SHORT.map((s, i) => `<div class="tz-leg" style="border-top:4px solid ${CM_PC[i]}">
            <span class="tz-leg-num" style="background:${CM_PC[i]}">${i + 1}</span>
            <strong>${s}</strong>
            <span class="why">${TZ_PHASE_DEF[i]}</span>
          </div>`).join("")}
        </div>
      </div>`;

    // --- corner archetypes ---
    const entryHtml = (ph, e) => `
      <div class="tz-entry" style="border-left:5px solid ${CM_PC[ph.phase - 1]}">
        <div class="tz-phase-band" style="background:${CM_PC[ph.phase - 1]}">
          <span class="tz-phase-num">${ph.phase}</span>
          <span class="tz-phase-name">${CM_SHORT[ph.phase - 1]}</span>
          <span class="tz-phase-sub">${ph.label}</span>
          <span class="tz-phase-tier">${tierPill(e.tier)}</span>
        </div>
        <div class="tz-quote">🗣 ${e.feeling}</div>
        <div class="tz-split">
          <div class="tz-pic">${carDiag(e.visual || {}, ph.phase)}${e.visual && e.visual.caption ? `<p class="why tz-cap">${e.visual.caption}</p>` : ""}</div>
          <div class="tz-body">
            <p class="why" style="margin:0 0 10px">${e.mechanism}</p>
            ${tuneRack(e.rack)}
            ${(e.ratios || []).map(ratioBar).join("")}
            <p class="why" style="font-size:12px;margin:10px 0 0"><strong>Options:</strong> ${e.options}</p>
            ${e.telemetry ? `<div class="tz-proof"><strong>📊 Confirm it on telemetry</strong><ul class="why">${e.telemetry.map((t) => `<li>${t}</li>`).join("")}</ul></div>` : ""}
          </div>
        </div>
      </div>`;
    const corners = tz.corner_types.map((ct) => `
      <div class="block">
        <div class="card-row" style="margin-top:0">
          <h3 style="margin:0">${ct.name} <span class="chip">${ct.speed}</span></h3>
          <span class="conf ${ct.id === "dirt-corner" ? "conf-contested" : "conf-probable"}" style="max-width:52%">${ct.regime}</span>
        </div>
        ${ct.status ? `<p class="why" style="color:var(--warn,#e3b341);font-size:12px;margin:4px 0 0">🌱 ${ct.status}</p>` : ""}
        ${ct.phases.map((ph) => ph.entries.map((e) => entryHtml(ph, e)).join("")).join("")}
      </div>`).join("");

    host.innerHTML = `
      <h2 class="section-title" style="margin-top:0;border-top:none;padding-top:0">🎓 Training Zone — every corner, feeling first</h2>
      <p class="hint">${tz.purpose}</p>
      ${gripBlock}${fdBlock}${ccBlock}${bsBlock}${coBlock}${ratioBlock}${spectrum}${conditions}
      ${legend}
      <h2 class="section-title">🏁 The corner archetypes</h2>
      ${corners}${telBlock}`;


    // aero-brake index calculator
    if (bs) {
      const upd = () => {
        const a = +document.getElementById("abI60").value, b = +document.getElementById("abI100").value;
        const out = document.getElementById("abOut");
        if (!a || !b) { out.textContent = ""; return; }
        const idx = (b / a) / 2.778;
        const verdict = idx < 0.93 ? ["strong aero contribution — lock-resistant at speed, lock-PRONE as you slow", "var(--accent)"]
          : idx < 0.99 ? ["some aero help at speed", "var(--accent2)"]
          : idx <= 1.03 ? ["grip is speed-independent — expect the same pedal to lock the wheels at high speed", "var(--warn,#e3b341)"]
          : ["brakes worse from high speed than physics predicts — check compound, weight or brake bias", "#e5414e"];
        out.innerHTML = `Aero-brake index = <strong style="color:${verdict[1]}">${idx.toFixed(2)}</strong> — ${verdict[0]}`;
      };
      ["abI60", "abI100"].forEach((id) => document.getElementById(id).addEventListener("input", upd));
      upd();
    }
    // chassis character chart
    if (cc) {
      const X0 = 62, X1 = 596, Y0 = 320, Y1 = 26;
      const wMin = cc.axes.x.min, wMax = cc.axes.x.max, fMin = cc.axes.y.min, fMax = cc.axes.y.max;
      const cxp = (w) => X0 + (Math.max(wMin, Math.min(wMax, w)) - wMin) / (wMax - wMin) * (X1 - X0);
      const cyp = (f) => Y0 - (Math.max(fMin, Math.min(fMax, f)) - fMin) / (fMax - fMin) * (Y0 - Y1);
      const MIDW = 2750, MIDF = 50;
      const quad = (w, f) => (w < MIDW ? (f >= MIDF ? "agile-stable" : "nervous") : (f >= MIDF ? "gt" : "widowmaker"));
      const qOf = (id) => cc.quadrants.find((q) => q.id === id);
      const svg = document.getElementById("ccChart");
      function drawCC() {
        const w = +document.getElementById("ccW").value || 3000;
        const f = +document.getElementById("ccF").value || 50;
        const q = qOf(quad(w, f));
        const zones = [
          { id: "agile-stable", x: X0, y: Y1, w: cxp(MIDW) - X0, h: cyp(MIDF) - Y1 },
          { id: "gt", x: cxp(MIDW), y: Y1, w: X1 - cxp(MIDW), h: cyp(MIDF) - Y1 },
          { id: "nervous", x: X0, y: cyp(MIDF), w: cxp(MIDW) - X0, h: Y0 - cyp(MIDF) },
          { id: "widowmaker", x: cxp(MIDW), y: cyp(MIDF), w: X1 - cxp(MIDW), h: Y0 - cyp(MIDF) },
        ];
        svg.innerHTML = `
          ${zones.map((z) => { const qq = qOf(z.id); return `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="${qq.color}" opacity="${q.id === z.id ? 0.22 : 0.07}"/>
            <text x="${z.x + z.w / 2}" y="${z.y + 20}" text-anchor="middle" fill="${qq.color}" font-size="12" font-weight="700">${qq.name}</text>`; }).join("")}
          <line x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}" stroke="var(--line)"/>
          <line x1="${X0}" y1="${Y0}" x2="${X0}" y2="${Y1}" stroke="var(--line)"/>
          ${[1600, 2200, 2800, 3400, 4000].map((v) => `<text x="${cxp(v)}" y="${Y0 + 16}" text-anchor="middle" fill="var(--muted)" font-size="10">${v}</text>`).join("")}
          ${[42, 46, 50, 54, 58].map((v) => `<text x="${X0 - 8}" y="${cyp(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="10">${v}%</text>`).join("")}
          <text x="${(X0 + X1) / 2}" y="${Y0 + 34}" text-anchor="middle" fill="var(--muted)" font-size="11">${cc.axes.x.label} — ${cc.axes.x.meaning}</text>
          <text x="16" y="${(Y0 + Y1) / 2}" transform="rotate(-90 16 ${(Y0 + Y1) / 2})" text-anchor="middle" fill="var(--muted)" font-size="11">${cc.axes.y.label} — restoring force</text>
          ${cc.reference_cars.map((r) => `<g><circle cx="${cxp(r.weight)}" cy="${cyp(r.front)}" r="5" fill="var(--muted)" opacity="0.85"><title>${r.name} — ${r.note}</title></circle>
            <text x="${cxp(r.weight) + 9}" y="${cyp(r.front) + 4}" fill="var(--muted)" font-size="10">${r.name}</text></g>`).join("")}
          <circle cx="${cxp(w)}" cy="${cyp(f)}" r="9" fill="${q.color}" stroke="#0e1116" stroke-width="2"/>
          <circle cx="${cxp(w)}" cy="${cyp(f)}" r="15" fill="none" stroke="${q.color}" stroke-width="1.5" opacity="0.6"/>`;
        document.getElementById("ccRead").innerHTML = `
          <div class="block" style="margin:0;border-color:${q.color}">
            <h3 style="margin:0 0 6px;color:${q.color}">${q.name}</h3>
            <p class="why" style="margin:0 0 8px">${q.feel}</p>
            <p class="why" style="margin:0"><strong>What you'll be tuning:</strong> ${q.tuning}</p>
          </div>`;
      }
      ["ccW", "ccF"].forEach((id) => document.getElementById(id).addEventListener("input", drawCC));
      drawCC();
    }
  }


  // ---- Telemetry Lab: Lab Run + Decode Bench over Data Out sessions ----
  function buildLab() {
    const host = document.getElementById("labContent2");
    if (!host) return;
    const sessions = DB.sessions || [];
    const tzfd = (DB.trainingZone || {}).friction_diagnosis;
    const NOSESS = `<p class="hint">No recorded sessions yet. Live: <code>python scripts/telemetry/fh6_live_daemon.py</code> then the 🔴 Live mode. Post-hoc: <code>fh6_dataout_capture.py</code> → <code>analyze_session.py</code> → rebuild.</p>`;
    const ST = Object.fromEntries(Object.entries(GRIP).map(([k, g]) => [k, g.col]));      // strip colors — the ONE palette
    const STL = Object.fromEntries(Object.entries(GRIP).map(([k, g]) => [k, g.axle]));     // strip labels — the ONE wording
    const CARC = ["#00d27a", "#2f81f7", "#e3b341", "#e83c9e", "#a371f7", "#f0883e"];
    let sIdx = 0, carSel = null, donor = null, replica = null;
    const S = () => sessions[sIdx];
    const NAMES = () => Object.assign({}, ((DB.carOrdinals || {}).cars) || {}, JSON.parse(localStorage.getItem("fh6CarNames") || "{}"), (typeof live !== "undefined" && live.names) || {});
    const baseId = (o) => String(o).split("#")[0];
    const stintOf = (o) => (String(o).includes("#") ? +String(o).split("#")[1] : null);
    const car = (s, o) => { const b = baseId(o); return s.cars.find((c) => c.id === b) || s.cars.find((c) => String(c.ordinal) === b); };
    const carName = (c) => (c && (NAMES()[String(c.ordinal)] || {}).name) || (c && c.name) || null;
    const stintLbl = (s, o) => { const n = stintOf(o); if (n == null) return ""; const st = (s.stints || []).find((x) => x.n === n); return ` · run ${n}${st && st.label ? " “" + st.label + "”" : ""}`; };
    const carLbl = (s, o) => { const c = car(s, o); if (!c) return `#${o}`; const nm = carName(c); return `${nm ? nm : "#" + c.ordinal} · ${c.class} ${c.pi} ${c.drivetrain} ${c.cyl}cyl${stintLbl(s, o)}`; };
    // TUNE IDENTITY: the paint IS the identity — players recognize a specific build by its livery thumbnail.
    // One resolver for every surface that references a build: ordinal (+ parts-fingerprint when known) → the
    // associated livery. Falls back to the equipped save's build; paint-only liveries render the labelled chip
    // (no thumbnail exists on disk); no association → "" and the text identity stands alone.
    const buildLivery = (ord, sig) => { try { if (typeof live === "undefined") return null; const c = live.diskCache && live.diskCache[String(ord)]; if (!c || !c.available || !c.match) return null; const bs = c.match.builds || []; return (sig && bs.find((x) => x.build === sig)) || bs.find((x) => (x.saves || []).some((ts) => String(ts) === String(c.ts))) || null; } catch (e) { return null; } };
    const buildThumb = (ord, sig, sm) => {
      const b = buildLivery(ord, sig); const lv = b && b.livery; if (!lv) return "";
      const t = esc((lv.name || "livery") + (lv.source === "guess" ? " (guess)" : "") + " · Build " + (b.label || "?"));
      return lv.thumb ? `<img class="tl-blvy${sm ? " blvy-sm" : ""}" src="${liveUrl}/livery-thumb?d=${encodeURIComponent(lv.dir)}" loading="lazy" alt="" title="${t}">`
        : `<span class="tl-blvy-chip${sm ? " blvy-sm" : ""}" title="${t} — paint-only, no thumbnail exists on disk">🎨${sm ? "" : " " + esc(lv.name || "base paint")}${lv.source === "guess" ? " ≈" : ""}</span>`;
    };
    // badge-emitting variant for innerHTML sinks — the in-game class badge design language everywhere the label is
    // MARKUP; carLbl stays plain for title=/placeholder/SVG-<title> sinks, which cannot render HTML. short = name + badge only.
    const carLblHtml = (s, o, short) => { const c = car(s, o); if (!c) return esc(`#${o}`); const nm = carName(c); const th = buildThumb(c.ordinal, c.build_id, true); return `${th ? th + " " : ""}${esc(nm ? nm : "#" + c.ordinal)} ${piBadge(c.class, c.pi, true)}${short ? "" : ` ${esc(c.drivetrain)} ${c.cyl}cyl${esc(stintLbl(s, o))}`}`; };
    const carCol = (s, o) => CARC[Math.max(0, s.cars.findIndex((c) => c.id === baseId(o) || String(c.ordinal) === baseId(o))) % CARC.length];
    const candidates = (c) => { const own = ((DB.ownedCars || {}).cars || []); const same = own.filter((x) => x.class === c.class && String(x.pi) === String(c.pi)); const cls = own.filter((x) => x.class === c.class && !same.includes(x)); return [...same, ...cls].map((x) => `${x.year} ${x.manufacturer} ${x.model}`); };
    const nameUI = (c) => carName(c) ? "" : `<div class="lab-name" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="chip" style="border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)">🏷 unknown car #${c.ordinal}</span><input list="cands-${c.ordinal}" placeholder="which car is this? (${c.class} ${c.pi} ${c.drivetrain})" style="min-width:230px;padding:4px 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:12px"><datalist id="cands-${c.ordinal}">${candidates(c).slice(0, 60).map((n) => `<option value="${esc(n)}">`).join("")}</datalist><button class="lab-mode" data-savename="${c.ordinal}" style="padding:4px 10px;font-size:12px">save</button></div>`;
    const sigChips = (c) => c.sig ? `<div class="chips" style="margin-top:4px">${[["build", c.build_id], ["max rpm", c.max_rpm], ["boost", c.sig.boost_max + " psi"], ["peak", c.sig.hp_peak ? `${c.sig.hp_peak} hp @ ${c.sig.rpm_at_peak}` : "—"], ["gears", c.sig.gear_count], ["mass idx", c.sig.mass_idx ?? "—"], ["group", c.car_group]].map(([k, v]) => `<span class="chip" title="${k}">${k === "build" ? buildThumb(c.ordinal, c.build_id, true) : ""}${k} <b>${v}</b></span>`).join("")}</div>` : "";
    function bindNames(root) {
      (root || host).querySelectorAll("[data-savename]").forEach((b) => b.addEventListener("click", () => {
        const wrap = b.closest(".lab-name"); const v = wrap.querySelector("input").value.trim(); if (!v) return; const ord = b.dataset.savename;
        const loc = JSON.parse(localStorage.getItem("fh6CarNames") || "{}"); loc[ord] = { name: v }; localStorage.setItem("fh6CarNames", JSON.stringify(loc));
        if (live.connected) fetch(liveUrl + "/car", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordinal: ord, name: v }) }).catch(() => {});
        render();
      }));
    }
    const fmt = (v, d = 2) => (v == null ? "—" : (+v).toFixed(d));
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");   // FULL escape — livery names/creators are arbitrary user text from downloaded designs; quote-only escaping was an XSS vector into innerHTML
    // tiny SVG line chart: series = [{pts:[[x,y]...], col, label}]
    const chart = (series, o = {}) => {
      const w = o.w || 380, h = o.h || 130, L = 36, B = 22, R = 8, T = 8;
      series = (series || []).map((s) => Object.assign({}, s, { pts: (s.pts || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1])) })).filter((s) => s.pts.length);   // drop non-finite points so a car with partial dyno/gear data can't emit NaN SVG
      const xs = series.flatMap((s) => s.pts.map((p) => p[0])), ys = series.flatMap((s) => s.pts.map((p) => p[1]));
      if (!xs.length) return `<p class="why" style="font-size:11px">no data</p>`;
      const xmin = o.xmin ?? Math.min(...xs), xmax = o.xmax ?? Math.max(...xs), ymin = o.ymin ?? Math.min(0, ...ys), ymax = o.ymax ?? ((Math.max(...ys) * 1.05) || 1);
      const X = (x) => L + (x - xmin) / ((xmax - xmin) || 1) * (w - L - R), Y = (y) => T + (1 - (y - ymin) / ((ymax - ymin) || 1)) * (h - T - B);
      return `<svg viewBox="0 0 ${w} ${h}" class="tz-svg" style="max-width:${w}px">
        <line x1="${L}" y1="${Y(ymin)}" x2="${w - R}" y2="${Y(ymin)}" stroke="var(--line)"/><line x1="${L}" y1="${T}" x2="${L}" y2="${Y(ymin)}" stroke="var(--line)"/>
        ${o.hline != null ? `<line x1="${L}" y1="${Y(o.hline)}" x2="${w - R}" y2="${Y(o.hline)}" stroke="#e5414e" stroke-dasharray="4 4" opacity=".7"/><text x="${w - R}" y="${Y(o.hline) - 3}" text-anchor="end" fill="#e5414e" font-size="9">${o.hlabel || ""}</text>` : ""}
        ${series.map((s) => `<polyline fill="none" stroke="${s.col}" stroke-width="2" points="${s.pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`).join("")}
        <text x="${(L + w) / 2}" y="${h - 6}" text-anchor="middle" fill="var(--muted)" font-size="9">${o.xl || ""}</text>
        <text x="10" y="${(T + h - B) / 2}" transform="rotate(-90 10 ${(T + h - B) / 2})" text-anchor="middle" fill="var(--muted)" font-size="9">${o.yl || ""}</text>
        ${[ymin, (ymin + ymax) / 2, ymax].map((v) => `<text x="${L - 3}" y="${Y(v) + 3}" text-anchor="end" fill="var(--muted)" font-size="8">${v.toFixed(v >= 10 ? 0 : 1)}</text>`).join("")}
        ${[xmin, (xmin + xmax) / 2, xmax].map((v) => `<text x="${X(v)}" y="${h - B + 10}" text-anchor="middle" fill="var(--muted)" font-size="8">${v.toFixed(v >= 100 ? 0 : 1)}</text>`).join("")}
        ${series.filter((s) => s.label).map((s, i) => `<text x="${w - R}" y="${T + 10 + i * 11}" text-anchor="end" fill="${s.col}" font-size="9">${s.label}</text>`).join("")}
      </svg>`;
    };
    const light = (v, good, ok) => v == null ? `<span class="lab-light" style="background:#3a4250"></span>` : `<span class="lab-light" style="background:${v <= good ? "#00d27a" : v <= ok ? "#e3b341" : "#e5414e"}"></span>`;
    const cellFor = (c) => {
      if (!tzfd || !c.first_red) return null;
      const ph = c.kink ? 5 : c.first_red.phase;
      const m = tzfd.matrix.find((x) => x.phase === ph); if (!m) return null;
      const side = c.first_red.axle === "front" ? m.front : m.rear;
      return { phase: ph, name: side.name, fix: side.fix[0] };
    };

    function strip(s) {
      const n = s.strip.length, W = 900, cw = W / n, H = 82;
      // TURN IDENTIFICATION: overlay every extracted corner on the timeline, coloured by balance — the strip is the
      // live spine the suggestions come from, so each turn is marked where it happened (▲ understeer / oversteer / neutral).
      const idxAt = (t) => { let b = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(s.strip[i].t - t); if (d < bd) { bd = d; b = i; } } return b; };
      const usiCol = (u) => gripCol(gripFromUsi(u));   // USI resolves INTO the grip alphabet, never a parallel one
      const t0 = n ? s.strip[0].t : 0, t1 = n ? s.strip[n - 1].t : 0;
      const turns = (s.corners || []).filter((c) => !c.drift && c.t0 >= t0 && c.t0 <= t1);
      const marks = turns.map((c, i) => { const x = idxAt(c.t0) * cw + cw / 2; const col = usiCol(c.usi); const v = gripOf(gripFromUsi(c.usi)).word;
        return `<g><line x1="${x.toFixed(1)}" y1="14" x2="${x.toFixed(1)}" y2="58" stroke="${col}" stroke-width="1" opacity=".45"/><path d="M${(x - 3.2).toFixed(1)} 4 L${(x + 3.2).toFixed(1)} 4 L${x.toFixed(1)} 12 Z" fill="${col}"><title>turn ${i + 1}: ${c.dir === "L" ? "left" : "right"} · ${c.mph_in}→${c.mph_min} mph · ${c.lat_g_peak} g · USI ${c.usi > 0 ? "+" : ""}${c.usi} → ${v}${c.first_red ? " · first red " + c.first_red.axle : ""}</title></path></g>`; }).join("");
      return `<svg viewBox="0 0 ${W} ${H}" class="tz-svg tz-wide" role="img" aria-label="Session strip with identified turns">
        ${s.strip.map((x, i) => `<g><rect x="${(i * cw).toFixed(2)}" y="16" width="${Math.max(cw - 0.3, 0.6).toFixed(2)}" height="40" fill="${ST[x.state]}" opacity="${x.state === "off" ? 1 : x.state === "calm" ? .6 : .95}"><title>${x.t}s — ${STL[x.state]}${x.mph != null ? ` · ${x.mph} mph · F ${x.f} R ${x.r} · ${x.g} g` : ""}${x.car ? ` · ${carLbl(s, x.car)}` : ""}</title></rect>
          ${x.car ? `<rect x="${(i * cw).toFixed(2)}" y="58" width="${Math.max(cw - 0.3, 0.6).toFixed(2)}" height="5" fill="${carCol(s, x.car)}"/>` : ""}
          ${x.t % 60 === 0 ? `<text x="${(i * cw).toFixed(1)}" y="78" fill="var(--muted)" font-size="9">${Math.floor(x.t / 60)}:00</text>` : ""}</g>`).join("")}
        ${marks}
      </svg>
      <div class="chips" style="margin-top:2px"><span class="chip" style="border-color:var(--line)">${turns.length} turns ▲ <span style="color:#2f81f7">understeer</span> · <span style="color:#e5414e">oversteer</span> · <span style="color:#00d27a">neutral</span></span>${Object.keys(ST).map((k) => `<span class="chip" style="border-color:${ST[k]};color:${k === "calm" || k === "off" ? "var(--muted)" : ST[k]}">${STL[k]}</span>`).join("")}</div>`;
    }
    function cornerCard(s, c) {
      const cell = cellFor(c);
      const fr = c.first_red;
      return `<div class="lab-corner" style="border-left:4px solid ${carCol(s, c.car)}">
        <div class="card-row" style="margin-top:0"><strong>${c.dir === "L" ? "⬅" : "➡"} ${c.t0}s · ${c.mph_in}→${c.mph_min} mph · ${c.lat_g_peak} g</strong>
          <span>${c.stint ? `<span class="chip" title="run">run ${c.stint}</span> ` : ""}${c.drift ? `<span class="chip" style="border-color:${gripCol("both")};color:${gripCol("both")}">${GRIP.both.word}</span>` : fr ? `<span class="chip" style="border-color:${CM_PC[(c.kink ? 5 : fr.phase) - 1]};color:${CM_PC[(c.kink ? 5 : fr.phase) - 1]}">first red: ${fr.axle} · ph ${c.kink ? 5 : fr.phase}</span>` : `<span class="chip">no saturation</span>`}</span></div>
        <div class="lab-ph">${c.phases.map((p) => `<div style="border-color:${CM_PC[p.phase - 1]}" title="${esc(CM_SHORT[p.phase - 1])} · ${p.dur}s">
            <span style="color:${CM_PC[p.phase - 1]};font-weight:700">${p.phase}</span> F <b style="color:${p.front > 1 ? gripCol("front") : "inherit"}">${p.front}</b><div class="lab-bar"><i style="width:${Math.min(100, p.front * 50)}%;background:${p.front > 1 ? gripCol("front") : "#566173"}"></i></div>
            R <b style="color:${p.rear > 1 ? gripCol("rear") : "inherit"}">${p.rear}</b><div class="lab-bar"><i style="width:${Math.min(100, p.rear * 50)}%;background:${p.rear > 1 ? gripCol("rear") : "#566173"}"></i></div></div>`).join("")}</div>
        <p class="why" style="font-size:11px;margin:6px 0 0">USI <b>${c.usi > 0 ? "+" : ""}${c.usi}</b> → ${gripOf(gripFromUsi(c.usi)).word}${c.hb ? " · handbrake" : ""}${c.brake_max > 200 ? " · hard brake" : ""}</p>
        ${cell && !c.drift ? `<p class="why" style="font-size:11px;margin:4px 0 0"><strong>${cell.name}</strong> — ${cell.fix}</p>` : ""}
      </div>`;
    }
    // ---- WORKFLOW sections — rendered from a session object (a recording, or the live session's latest analysis); isLive adds live hints ----
    const arr = (s, k) => (s && Array.isArray(s[k]) ? s[k] : []);
    const EMPTY_LIVE = `<div class="block" style="border-color:#a371f7"><h3 style="margin-top:0">🚗 Cloning the car you're in</h3><div id="lvDiskDecode"></div><p class="why" style="font-size:12px;margin:6px 0 0">the on-disk tune (above) decodes instantly from the save file — no driving needed; the drive-based decode battery begins after ~20 s of driving</p></div>`;
    const routeName = (key, fallback) => (((((DB.routes || {}).routes) || {})[key] || {}).name) || (JSON.parse(localStorage.getItem("fh6Routes") || "{}")[key] || {}).name || fallback;
    function eventsTable(s) {
      const ev = arr(s, "events"); if (!ev.length) return "";
      return `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏆 Events — timed modes detected (races · Rivals · time trials · reference-loop laps)</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>window</th><th>car</th><th>mode</th><th>laps</th><th>length</th><th>best lap</th><th>final pos</th><th>route</th></tr></thead><tbody>
            ${ev.map((e) => { const rn = e.route || routeName(e.route_key, null); return `<tr style="border-left:3px solid ${carCol(s, e.car)}"><td>${e.t0}–${e.t1}s (${e.duration_s}s)</td><td>${carLblHtml(s, e.car, true)}</td><td>${e.mode}</td><td>${e.laps || "—"}</td><td>${(e.distance_m / 1000).toFixed(2)} km</td><td>${e.best_lap ? e.best_lap.toFixed(3) + " s" : "—"}</td><td>${e.pos_final ?? "—"}</td><td>${rn ? courseIdentMini(rn, null, e.route_key, 20) : `<span class="lab-route" data-key="${e.route_key}" data-mode="${esc(e.mode)}"><input placeholder="name this route (start ${(e.start || []).join(",")})" style="min-width:180px;padding:3px 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:11px"> <button class="lab-mode" data-saveroute style="padding:3px 8px;font-size:11px">save</button></span>`}</td></tr>`; }).join("")}
          </tbody></table></div><p class="why" style="font-size:11px;margin-top:6px">No track ordinal exists in FH6 Data Out — a route is recognised by its start position + length. Name it once and every later run on it is labelled. Free roam = everything outside these windows.</p></div>`;
    }
    // 🏟 COURSE — the course's identity: profile (incl. what it never uses), every turn quantified & classified, lap deltas, course-weighted suggestions
    // routes ATLAS: every known route's learned path on one canvas (world coordinates) — the general layout of where you race.
    // Click a route or its start ● to select it: every route that STARTS at the same hub (≤ 250 m) or FOLLOWS its path (≥ 30 % of points within 30 m) lights up.
    let atlasPick = null, atlasLastS = null;
    const atlasRelated = (models, key) => {
      const sel = models.find((m) => m.route_key === key); if (!sel) return null;
      const sp = sel.geometry.path, s0 = sp[0]; const cells = new Map();
      sp.forEach((p) => { const k = `${Math.floor(p[0] / 30)},${Math.floor(p[1] / 30)}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p); });
      const near = (x, z) => { const cx = Math.floor(x / 30), cz = Math.floor(z / 30); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const a = cells.get(`${cx + dx},${cz + dz}`); if (a) for (const p of a) { if ((p[0] - x) ** 2 + (p[1] - z) ** 2 <= 900) return true; } } return false; };
      const sameStart = new Set(), follows = new Set(), ov = {};
      models.forEach((m) => { if (m.route_key === key) return; const p = m.geometry.path; if (Math.hypot(p[0][0] - s0[0], p[0][1] - s0[1]) <= 250) sameStart.add(m.route_key); const f = p.filter((q) => near(q[0], q[1])).length / p.length; ov[m.route_key] = f; if (f >= 0.3) follows.add(m.route_key); });
      return { key, sel, sameStart, follows, ov };
    };
    const routesAtlas = (s) => {
      atlasLastS = s;
      const models = (DB.courseModels || []).filter((m) => m && m.geometry && ((m.geometry.path && m.geometry.path.length > 4) || (m.geometry.paths && m.geometry.paths.flat().length > 4)));
      if (!models.length) return "";
      models.forEach((m) => { if (!m.geometry.path) m.geometry.path = m.geometry.paths.flat(); });
      const cur = new Set(arr(s, "courses").map((co) => co.route_key)); const names = ((DB.routes || {}).routes) || {}; const loc = JSON.parse(localStorage.getItem("fh6Routes") || "{}");
      const all = models.flatMap((m) => m.geometry.path); const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const W = 560, H = 380, pad = 24; const sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, z1 - z0));
      const X = (x) => pad + (x - x0) * sc + ((W - 2 * pad) - (x1 - x0) * sc) / 2, Y = (z) => H - pad - (z - z0) * sc - ((H - 2 * pad) - (z1 - z0) * sc) / 2;
      const poly = (a) => a.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
      const lbl = (m) => (m.name || (names[m.route_key] || {}).name || (loc[m.route_key] || {}).name || m.route_key);
      const rel = atlasPick ? atlasRelated(models, atlasPick) : null; if (atlasPick && !rel) atlasPick = null;
      const styleOf = (m) => { const on = cur.has(m.route_key); if (!rel) return { col: on ? "var(--accent)" : "var(--accent2)", w: on ? 2.5 : 1.5, op: on ? 1 : .7 }; const isSel = m.route_key === rel.key, isRel = rel.sameStart.has(m.route_key) || rel.follows.has(m.route_key); return { col: isSel ? "var(--accent)" : isRel ? "var(--warn,#e3b341)" : "var(--accent2)", w: isSel ? 3.5 : isRel ? 1.6 : 1.2, op: isSel ? 1 : isRel ? .55 : .18 }; };   // ONLY the selected course is lit; related routes stay subtle (listed in the panel)
      const relList = rel ? models.filter((m) => m.route_key !== rel.key && (rel.sameStart.has(m.route_key) || rel.follows.has(m.route_key))) : [];
      return `<div class="block" id="atlasBlock" style="border-color:var(--accent2)"><div class="card-row" style="margin-top:0"><h3 style="margin:0">🗺 Routes atlas — every route learned so far (${models.length}), in world coordinates</h3><span class="chip">${models.reduce((a, m) => a + (m.laps || 0), 0)} laps · ${models.reduce((a, m) => a + ((m.sessions || []).length), 0)} session-visits</span></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start"><svg viewBox="0 0 ${W} ${H}" class="tz-svg" data-atlas-bg="1" style="max-width:${W}px;background:var(--bg);border-radius:8px;cursor:${rel ? "pointer" : "default"}">
          ${models.map((m) => { const st = styleOf(m); const k = esc(m.route_key); return `<g>${(m.geometry.paths || [m.geometry.path]).map((pc) => `<polyline data-atlas-route="${k}" fill="none" stroke="${st.col}" stroke-width="${st.w}" opacity="${st.op}" style="cursor:pointer" points="${poly(pc)}"><title>${esc(lbl(m))} · ${m.geometry.length_m} m · ${(m.geometry.turns || []).length} turns · ${m.laps || 0} laps — click to highlight routes sharing its start / path</title></polyline>`).join("")}<circle data-atlas-route="${k}" cx="${X(m.geometry.path[0][0]).toFixed(1)}" cy="${Y(m.geometry.path[0][1]).toFixed(1)}" r="${rel && m.route_key === rel.key ? 5 : 3.5}" fill="${st.col}" opacity="${Math.max(st.op, .5)}" style="cursor:pointer"><title>start of ${esc(lbl(m))} — click</title></circle><text data-atlas-route="${k}" x="${(X(m.geometry.path[0][0]) + 5).toFixed(1)}" y="${(Y(m.geometry.path[0][1]) - 4).toFixed(1)}" fill="${st.col === "var(--accent2)" ? "var(--txt)" : st.col}" opacity="${Math.max(st.op, .45)}" font-size="9" font-weight="${st.w >= 2.5 ? 700 : 400}" style="cursor:pointer">${esc(lbl(m)).slice(0, 22)}</text></g>`; }).join("")}
        </svg><div style="font-size:10.5px;max-width:260px" id="atlasInfo">
          ${rel ? `<div style="padding:6px 8px;border:1px solid var(--accent);border-radius:8px"><div><span class="course-mini-glyph" style="display:inline-flex;vertical-align:middle;margin-right:5px">${courseShapeGlyph(rel.sel.geometry, 26)}</span><b style="color:var(--accent)">${esc(lbl(rel.sel))}</b> <span class="why">· <span class="start-pt"><i>●</i> ${startOfKey(rel.sel.route_key, rel.sel.geometry) || "?"}</span> · ${rel.sel.geometry.length_m} m · ${(rel.sel.geometry.turns || []).length} turns · ${rel.sel.laps || 0} laps</span> <span class="chip" data-atlas-clear="1" style="cursor:pointer;padding:1px 6px">✕ clear</span></div>${courseTagsRow(rel.sel)}
            <div style="margin-top:4px"><b>${rel.sameStart.size}</b> other route${rel.sameStart.size === 1 ? "" : "s"} start${rel.sameStart.size === 1 ? "s" : ""} at this hub · <b>${rel.follows.size}</b> follow${rel.follows.size === 1 ? "s" : ""} its path</div>
            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${relList.map((m) => `<span class="chip" data-atlas-route="${esc(m.route_key)}" style="cursor:pointer;border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)" title="click to select · start ${esc(String(m.route_key).replace("_", ", "))}">${courseShapeGlyph(m.geometry, 15)} ${esc(lbl(m)).slice(0, 24)} · ${rel.sameStart.has(m.route_key) ? "same start" : ""}${rel.sameStart.has(m.route_key) && rel.follows.has(m.route_key) ? " · " : ""}${rel.follows.has(m.route_key) ? Math.round(rel.ov[m.route_key] * 100) + "% on path" : ""}</span>`).join("") || `<span class="why">no other route starts here or follows it</span>`}</div></div>`
            : `<div><span style="color:var(--accent)">━</span> courses in this ${arr(s, "courses").length ? "session" : "view"} · <span style="color:var(--accent2)">━</span> other learned routes · ● start · <b>click a route or its start</b> to highlight every route that starts there or follows it</div>`}
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">${models.map((m) => `<span class="chip" data-atlas-route="${esc(m.route_key)}" style="cursor:pointer;${rel && m.route_key === rel.key ? "border-color:var(--accent);color:var(--accent)" : rel && (rel.sameStart.has(m.route_key) || rel.follows.has(m.route_key)) ? "border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)" : cur.has(m.route_key) ? "border-color:var(--accent);color:var(--accent)" : ""}" title="start ${esc(String(m.route_key).replace("_", ", "))} — click to select">${courseShapeGlyph(m.geometry, 15)} ${esc(lbl(m)).slice(0, 26)} · ${(m.geometry.turns || []).length}T · ${m.laps || 0}L</span>`).join("")}</div><p class="why" style="font-size:10px;margin:6px 0 0">paths are learned from your own laps (reference lap per route); name a route once in the events table and the label updates here</p></div></div></div>`;
    };
    const bindAtlas = (root) => {
      const r = root || host;
      r.querySelectorAll("[data-atlas-route]").forEach((el) => el.addEventListener("click", (ev) => { ev.stopPropagation(); const k = el.dataset.atlasRoute; atlasPick = atlasPick === k ? null : k; repaintAtlas(); }));
      r.querySelectorAll("[data-atlas-clear]").forEach((el) => el.addEventListener("click", (ev) => { ev.stopPropagation(); atlasPick = null; repaintAtlas(); }));
      r.querySelectorAll("[data-atlas-bg]").forEach((el) => el.addEventListener("click", () => { if (atlasPick) { atlasPick = null; repaintAtlas(); } }));
    };
    const repaintAtlas = () => { if (src === "live") paintSections(true); else render(); };   // the course cards follow the atlas selection, so repaint the whole course section
    // ---- NUMERIC TUNING ADJUSTMENTS: the deliverable of Course TUNING — actual slider numbers from the diagnosis + the current tune ----
    const SLIDER = {
      farb: { label: "Front ARB", unit: "", step: 3, min: 1, max: 65, dp: 1, verb: ["stiffer", "softer"] }, rarb: { label: "Rear ARB", unit: "", step: 3, min: 1, max: 65, dp: 1, verb: ["stiffer", "softer"] },
      fspring: { label: "Front spring rate", unit: " lb/in", step: 0, pct: 0.06, dp: 0, verb: ["stiffer", "softer"] }, rspring: { label: "Rear spring rate", unit: " lb/in", step: 0, pct: 0.06, dp: 0, verb: ["stiffer", "softer"] },
      fheight: { label: "Front ride height", unit: "", step: 1, dp: 0, notch: true, verb: ["higher", "lower"] }, rheight: { label: "Rear ride height", unit: "", step: 1, dp: 0, notch: true, verb: ["higher", "lower"] },
      fbump: { label: "Front bump", unit: "", step: 1.5, min: 1, max: 20, dp: 1, verb: ["firmer", "softer"] }, rbump: { label: "Rear bump", unit: "", step: 1.5, min: 1, max: 20, dp: 1, verb: ["firmer", "softer"] },
      freb: { label: "Front rebound", unit: "", step: 1.5, min: 1, max: 20, dp: 1, verb: ["slower", "faster"] }, rreb: { label: "Rear rebound", unit: "", step: 1.5, min: 1, max: 20, dp: 1, verb: ["slower", "faster"] },
      bbal: { label: "Brake balance (% front)", unit: "%", step: 3, min: 0, max: 100, dp: 0, verb: ["+front", "+rear"] }, bpress: { label: "Brake pressure", unit: "%", step: 8, min: 50, max: 150, dp: 0, verb: ["higher", "lower"] },
      accel: { label: "Accel differential", unit: "%", step: 8, min: 0, max: 100, dp: 0, verb: ["more lock", "less lock"] }, decel: { label: "Decel differential", unit: "%", step: 6, min: 0, max: 100, dp: 0, verb: ["more lock", "less lock"] },
      center: { label: "Center balance (% rear)", unit: "%", step: 5, min: 0, max: 100, dp: 0, verb: ["+rear", "+front"] }, faero: { label: "Front downforce", unit: "", step: 0, pct: 0.15, dp: 0, verb: ["more", "less"] }, raero: { label: "Rear downforce", unit: "", step: 0, pct: 0.15, dp: 0, verb: ["more", "less"] },
    };
    // plain-language EFFECT of moving each slider (dir up / down) — what the change DOES on track
    const SLIDER_FX = {
      farb: { up: "sharper front turn-in, but can scrub", down: "front regains grip → less understeer" },
      rarb: { up: "sharper rear, more rotation → more oversteer", down: "rear regains grip → less oversteer" },
      fspring: { up: "less nose dive, sharper but firmer", down: "more front grip over bumps" },
      rspring: { up: "supports the rear, less squat & bottoming", down: "more rear grip over bumps" },
      fheight: { up: "raises the nose → stops the front bottoming out", down: "lower nose & CG (only if it isn't bottoming)" },
      rheight: { up: "raises the tail → stops the rear bottoming out", down: "lower tail & CG (only if it isn't bottoming)" },
      fbump: { up: "firmer over sharp bumps up front", down: "softer front impacts, more compliance" },
      rbump: { up: "firmer rear over bumps", down: "more rear compliance" },
      freb: { up: "front settles slower after a bump", down: "front recovers faster" },
      rreb: { up: "rear settles slower → calmer on throttle", down: "rear recovers faster" },
      bbal: { up: "more front brake → stops the rears locking", down: "more rear brake → rotates on entry" },
      bpress: { up: "stronger brakes (can lock up)", down: "stops lock-up → shorter, controllable stops" },
      accel: { up: "more corner-exit drive, but more wheelspin", down: "less wheelspin off throttle → traction, less power-oversteer" },
      decel: { up: "more stable off throttle (can push wide)", down: "freer rotation into the corner" },
      center: { up: "more rear bias → livelier / more oversteer", down: "more front bias → more stable" },
      faero: { up: "more front grip at speed → less high-speed understeer", down: "less drag, faster top end" },
      raero: { up: "more rear grip at speed → less high-speed oversteer", down: "less drag, faster top end" },
    };
    const SLIDER_ORDER = ["farb", "rarb", "fspring", "rspring", "fheight", "rheight", "fbump", "rbump", "freb", "rreb", "bbal", "bpress", "accel", "decel", "center", "faero", "raero"];
    const TUNE_RX = {
      "mid-understeer": [["farb", -1, 1], ["rarb", 1, 0.6], ["fspring", -1, 0.6]],
      "front-hot": [["farb", -1, 0.5], ["faero", 1, 0.4]],
      "rear-limited": [["rarb", -1, 1], ["accel", -1, 0.6], ["rspring", -1, 0.5]],
      "oversteer-balance": [["rarb", -1, 1], ["accel", -1, 0.7], ["raero", 1, 0.5]],
      "brake-lockup": [["bpress", -1, 1]],
      "brake-balance-rear": [["bbal", -1, 1]], "brake-balance-front": [["bbal", 1, 1]],
      "brake-pressure": [["bpress", -1, 1]], "trail-brake": [["bbal", -1, 0.4]],
      "launch-spin": [["accel", -1, 1]], "launch-front-spin": [["center", 1, 1], ["accel", -1, 0.5]],
      "bottoming": [["rheight", 1, 1], ["fheight", 1, 0.8]],   // fix bottoming with RIDE HEIGHT (matches the advice), not dampers
      // net-new symptoms mined from the vetted external guides (forzatune / gamingpromax / forza.guide) — phase-tagged
      "hi-speed-understeer": [["faero", 1, 1], ["fheight", -1, 0.4]],   // fast sweepers: front lacks aero grip at speed
      "lift-oversteer": [["bbal", 1, 0.6], ["rreb", 1, 0.5], ["decel", 1, 0.5]],   // rear steps out on lift / trail-brake
      "hi-speed-wobble": [["raero", 1, 0.7], ["rreb", 1, 0.4]],   // weaves on fast straights (also caster, not a move slider)
    };
    // WHICH PHASES a slider acts in (1=Braking 2=Turn-in 3=Mid-corner 4=Exit 5=Straight/crest) — grounded in the
    // situational-model doctrine (data/tuning-variables.json phase_map) and cross-checked against forza.guide's
    // Four-Corner-Phases lists (front ARB→turn-in, front bump→braking dive, ride height→mid-corner + bottoming).
    const SLIDER_PHASES = {
      farb: [2, 3], rarb: [3, 4], fspring: [3], rspring: [3, 4], fheight: [1, 3, 5], rheight: [3, 4, 5],
      fbump: [1, 2], rbump: [2, 4], freb: [2, 5], rreb: [4, 5], bbal: [1, 2], bpress: [1],
      accel: [4], decel: [2], center: [4], faero: [3, 5], raero: [3, 5],
    };
    // WHERE each symptom (TUNE_RX key) actually shows up on track + a one-word issue label for the anatomy image.
    const SYMPTOM_PHASES = {
      "mid-understeer": { ph: [3], issue: "understeer" }, "front-hot": { ph: [2, 3], issue: "front overheating" },
      "rear-limited": { ph: [3, 4], issue: "oversteer" }, "oversteer-balance": { ph: [3, 4], issue: "oversteer" },
      "brake-lockup": { ph: [1], issue: "lock-up" }, "brake-pressure": { ph: [1], issue: "lock-up" },
      "brake-balance-rear": { ph: [1, 2], issue: "brake bias" }, "brake-balance-front": { ph: [1, 2], issue: "brake bias" },
      "trail-brake": { ph: [1, 2], issue: "entry rotation" }, "launch-spin": { ph: [4], issue: "wheelspin" },
      "launch-front-spin": { ph: [4], issue: "wheelspin" }, "bottoming": { ph: [1, 5], issue: "bottoming" },
      "hi-speed-understeer": { ph: [3, 5], issue: "high-speed understeer" }, "lift-oversteer": { ph: [1, 2], issue: "lift/decel oversteer" },
      "hi-speed-wobble": { ph: [5], issue: "high-speed wobble" },
    };
    // ABSOLUTE starting-point values from the vetted external guides (multi-source consensus). Used as the anchor on a
    // move card when the current value isn't known — sliders whose value is car-specific (springs, ARBs, ride height,
    // aero) are intentionally omitted (direction-only). rebound 18 / bump 6 is the cross-checked baseline (NOT
    // grindout's bump≈60%·rebound outlier). See [[fh6-external-tuning-sources]].
    const SLIDER_BASE = { fbump: 6, rbump: 6, freb: 18, rreb: 18, bbal: 52, bpress: 100, accel: 55, decel: 15, center: 80 };
    // drivetrain-specific baseline overrides (data/slider-baselines.json): FWD tunes the FRONT diff higher; center split is AWD-only.
    const SLIDER_BASE_DT = { FWD: { accel: 70 }, RWD: { accel: 55 }, AWD: { accel: 55, center: 80 } };
    const sliderBaseFor = (sl, drv) => { const dt = SLIDER_BASE_DT[drv] || {}; return dt[sl] != null ? dt[sl] : SLIDER_BASE[sl]; };
    // J19: cid embeds PI (and cyl/drv), so installing a part minted a NEW cid and orphaned every typed slider,
    // A/B chain and applied-history. Key user state by ordinal + parts-fingerprint (the daemon's build sig, stable
    // across slider iterations) instead; skey() self-migrates the legacy cid-keyed value on first touch.
    const buildSigFor = (ord) => { try { if (typeof live === "undefined") return null; const c = live.diskCache && live.diskCache[ord]; if (!c || !c.available) return null; const m = c.match || {}; const b = (m.builds || []).find((b2) => (b2.saves || []).some((ts) => String(ts) === String(c.ts))); return b ? b.build : null; } catch (e) { return null; } };
    const stateId = (cid) => { const b = baseId(cid); const ord = String(b).split("|")[0]; const sig = buildSigFor(ord); return sig ? ord + "|" + sig : b; };
    const skey = (prefix, cid) => { const nk = prefix + stateId(cid); try { const lk = prefix + baseId(cid); if (nk !== lk) { const lv = localStorage.getItem(lk); if (lv != null) { if (localStorage.getItem(nk) == null) localStorage.setItem(nk, lv); localStorage.removeItem(lk); } } } catch (e) {} return nk; };   // migrate once, then DELETE the legacy key — offline writes under baseId were orphaned forever once the sig key existed (split-brain)
    const tuneKey = (cid) => skey("fh6Tune:", cid);
    // disk-decoded exact slider values → the tuning engine's slider keys (auto-fills "current tune")
    const DISK2SLIDER = { front_arb: "farb", rear_arb: "rarb", front_bump: "fbump", rear_bump: "rbump", front_rebound: "freb", rear_rebound: "rreb", brake_balance: "bbal", brake_pressure: "bpress", rear_diff_accel: "accel", rear_diff_decel: "decel", center_diff: "center", front_spring: "fspring", rear_spring: "rspring", front_downforce: "faero", rear_downforce: "raero" };
    const applyDiskTune = (d) => {                       // pull exact slider values off the decode so targets need no typing; returns whether they changed
      if (!d || !d.deliverable) return false;
      if (live.cloneTarget && live.cloneTarget.ordinal === +d.ordinal) return false;   // locked: the target's slider targets are frozen; the WIP must not overwrite them
      live.diskTune = live.diskTune || {}; const key = String(d.ordinal);
      // GATE: if the decoded save does NOT match the build you're driving (its cylinder count differs from your live
      // engine), its slider values belong to a DIFFERENT build — never auto-fill them as your "current" tune, or the
      // recommendations read the wrong car. Clear instead, so targets fall back to vetted baselines until you save THIS
      // build. This is the fix for "the stored values are not for the current car".
      if (d.match && (d.match.how === "no-match" || d.match.how === "unsaved-build")) { const had = live.diskTune[key] != null; delete live.diskTune[key]; return had; }   // a distinct/unsaved build must never auto-fill another build's sliders as "current"
      const vals = {};
      (d.deliverable.tabs || []).forEach((t) => (t.rows || []).forEach((r) => { if (r.value != null && DISK2SLIDER[r.field]) vals[DISK2SLIDER[r.field]] = r.value; }));
      const changed = JSON.stringify(live.diskTune[key]) !== JSON.stringify(vals);
      live.diskTune[key] = vals; return changed;
    };
    const userTune = (cid) => { try { return JSON.parse(localStorage.getItem(tuneKey(cid)) || "{}"); } catch (e) { return {}; } };
    const getTune = (cid) => { const ord = String(cid).split("|")[0]; const disk = (live.diskTune && live.diskTune[ord]) || {}; return Object.assign({}, disk, userTune(cid)); };   // user entries override the disk auto-fill
    const setTune = (cid, k, v) => { const t = userTune(cid); if (v === "" || v == null || isNaN(+v)) delete t[k]; else t[k] = +v; try { localStorage.setItem(tuneKey(cid), JSON.stringify(t)); } catch (e) {} };   // a quota throw here silently killed the whole repaint chain
    // ---- interactive tune iteration: mark a suggested change as IMPLEMENTED (sets it as the new current value +
    // starts a fresh run), then RE-TEST (force a re-analysis). An applied move that drops off the next analysis's
    // suggestion list = resolved; one still suggested = needs more / a cleaner re-drive. ----
    const appliedKey = (cid) => skey("fh6Applied:", cid);   // J19: per-build — a slider change never moves PI
    const getApplied = (cid) => { try { return JSON.parse(localStorage.getItem(appliedKey(cid)) || "{}"); } catch (e) { return {}; } };
    const markApplied = (cid, sl, to) => { const a = getApplied(cid); a[sl] = { to: (to === "" || to == null ? null : +to), at: Date.now() }; try { localStorage.setItem(appliedKey(cid), JSON.stringify(a)); } catch (e) {} if (to !== "" && to != null) setTune(cid, sl, +to); };
    const unApply = (cid, sl) => { const a = getApplied(cid); delete a[sl]; try { localStorage.setItem(appliedKey(cid), JSON.stringify(a)); } catch (e) {} };
    const appliedStrip = (cid, moves) => {
      if (!cid) return ""; const a = getApplied(cid); const keys = Object.keys(a); if (!keys.length) return "";
      const curSet = new Set((moves || []).map((m) => m.sl));
      const resolved = keys.filter((sl) => !curSet.has(sl)), pending = keys.filter((sl) => curSet.has(sl));
      const lbl = (sl) => (SLIDER[sl] || {}).label || sl;
      const cur = getTune(cid);   // AUTO-READ the current slider values off the decode — verify the change actually landed on disk
      const item = (sl) => { const tgt = a[sl].to, now = cur[sl]; let v = "";
        if (tgt != null && now != null) { const close = Math.abs(now - tgt) <= Math.max(0.5, Math.abs(tgt) * 0.03);
          v = close ? ` <span class="as-ok" title="read from your saved tune — the change landed">✓${now}</span>` : ` <span class="as-miss" title="the decode reads ${now}, not the ${tgt} you aimed for — did the save land? (per-car sliders read as % until a range is registered)">✎${now}≠${tgt}</span>`; }
        return lbl(sl) + v; };
      return `<div class="applied-strip"><div class="as-hd"><b>🔁 Tune iteration</b><span class="why" style="font-size:10.5px">${keys.length} change${keys.length === 1 ? "" : "s"} marked done · ✓ = read back off your saved tune</span><button class="lab-mode as-retest" data-retest="${esc(cid)}" title="re-run the analysis on your latest driving right now (otherwise it refreshes on lap boundaries / every 20–90 s)">🔁 Re-test now</button></div>
        ${resolved.length ? `<div class="as-row ok">✓ <b>resolved</b> after your change: ${resolved.map(item).join(", ")} — no longer flagged</div>` : ""}
        ${pending.length ? `<div class="as-row pend">↻ <b>still flagged</b>: ${pending.map(item).join(", ")} — drive a clean run &amp; re-test, or it may need another step</div>` : ""}
        <button class="as-clear" data-clearapplied="${esc(cid)}">clear</button></div>`;
    };
    // ---- A/B TUNING SCAFFOLD: each distinct SAVED tune of a car is a "version". We AUTO-READ its slider values from
    // the decode (exact where the range is known) and snapshot the resulting metrics (balance USI, traction spin%,
    // front/rear-limited corner counts) every analysis, so a change can be attributed to its slider delta. Foundation
    // for suggest -> implement -> measure -> compare. ----
    const SLIDER_BETTER = { usi_abs: "lower", spin: "lower", frontLim: "lower", rearLim: "lower" };   // all "issues": lower = better
    const abKey = (cid) => skey("fh6AB:", cid);   // J19: the A/B chain must survive a part install
    const getAB = (cid) => { try { return JSON.parse(localStorage.getItem(abKey(cid)) || "{}").versions || []; } catch (e) { return []; } };
    const setAB = (cid, versions) => { try { localStorage.setItem(abKey(cid), JSON.stringify({ versions: versions.slice(-24) })); } catch (e) {} };
    const sliderSnapshot = (cid) => { const t = getTune(cid); const o = {}; SLIDER_ORDER.forEach((sl) => { if (t[sl] != null) o[sl] = t[sl]; }); return o; };   // numeric fast-path (the exact sliders), kept as metric context
    // FULL slider snapshot straight off the decoded deliverable — EVERY tuning field, its displayed value + unit, and
    // whether it's still a position (% slider). An A/B version stores THIS, so a multi-slider change is captured in full
    // and every value stays viewable later. `key` encodes value-or-position, so ANY change is detected — including
    // ride-height / downforce that still read as % before calibration.
    const abFull = (cid) => { const ord = String(cid).split("|")[0]; const dl = (live.diskCache && live.diskCache[ord] && live.diskCache[ord].deliverable) || null;
      if (!dl || !(dl.tabs || []).length) return null; const o = {};
      (dl.tabs || []).forEach((t) => (t.rows || []).forEach((r) => {
        o[r.field] = { label: r.label || r.field, section: r.section || t.tab, unit: r.unit || "", pos: r.value == null,
          disp: r.display || (r.value != null ? String(r.value) + (r.unit ? " " + r.unit : "") : ((r.fill != null ? Math.round(r.fill * 1000) / 10 : "?") + "%")),
          key: r.value != null ? "v" + r.value : "n" + (r.fill != null ? Math.round(r.fill * 1e4) : "?") }; }));
      return o; };
    const abFullEq = (a, b) => { if (!a || !b) return false; const ks = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of ks) { if (!a[k] || !b[k] || a[k].key !== b[k].key) return false; } return true; };
    const abFullDelta = (prev, cur) => { if (!prev) return []; const out = []; Object.keys(cur).forEach((k) => { if (!prev[k] || prev[k].key !== cur[k].key) out.push({ field: k, label: cur[k].label, from: prev[k] ? prev[k].disp : "—", to: cur[k].disp }); }); return out; };
    const abMetrics = (c, s) => { const g = c && c.general; const trac = tracSummary(); const sm = (s && s.summary) || {};
      return { usi: g && g.usi != null ? +(+g.usi).toFixed(3) : null, spin: trac ? trac.pct : null,
               frontLim: sm.front_limited_corners != null ? sm.front_limited_corners : null,
               rearLim: sm.rear_limited_corners != null ? sm.rear_limited_corners : null, corners: sm.corners != null ? sm.corners : null }; };
    // A version is born the moment a CHANGE is detected (any field's value/position differs from the last version) —
    // driven by the save event, so it never waits on the ~20s analysis. Metrics fill in on the next analysis (same tune
    // -> refresh in place, without clobbering good numbers with nulls). Stores the FULL field set for later viewing.
    const abCapture = (cid, c, s) => {
      if (!cid) return;
      const cc = live.diskCache && live.diskCache[String(cid).split("|")[0]];
      if (cc && cc.match && (cc.match.how === "no-match" || cc.match.how === "unsaved-build")) return;   // decoded save is a DIFFERENT build — don't version/diff its values as this car's tune
      const full = abFull(cid); if (!full) return;
      const m = abMetrics(c, s); const versions = getAB(cid); const last = versions[versions.length - 1];
      if (last && abFullEq(last.full, full)) {
        if (m && (m.usi != null || m.spin != null || m.rearLim != null || m.frontLim != null)) last.metrics = m;   // refresh only with real numbers
        last.at = Date.now(); setAB(cid, versions); return; }
      const delta = abFullDelta(last && last.full, full);
      versions.push({ at: Date.now(), full, sliders: sliderSnapshot(cid), metrics: m, delta }); setAB(cid, versions);
    };
    // gather current car/session context and (re)capture — called on a detected save change AND on each fresh analysis
    const abSync = (cid) => { if (!cid) return; const s = (src === "live" ? live.analysis : S()) || null; const ls = liveSess(); const c = (ls && cid && car(ls, cid)) || (ls && (ls.cars || [])[0]) || null; abCapture(cid, c, s); };
    // FRESH-READ before the diff: re-query the current on-disk slider values right before comparing, so a change is never
    // missed by a stale cache. The save-event path is already fresh (the daemon re-decodes and pushes on every save);
    // this covers the periodic analysis path, where the cache could otherwise lag a change made between events.
    const refreshDiskThenCapture = (cid, c, s) => {
      const ord = +String(cid || "").split("|")[0];
      if (!ord || (src === "live" && !live.connected)) { abCapture(cid, c, s); return; }
      const ts = live.diskPick && live.diskPick[ord];
      fetch(liveUrl + "/disk-tune?ordinal=" + ord + (ts ? "&ts=" + encodeURIComponent(ts) : "")).then((r) => r.json()).then((d) => {
        if (d && d.available) { live.diskCache = live.diskCache || {}; live.diskCache[ord] = d; if (!(live.cloneTarget && live.cloneTarget.ordinal === ord)) applyDiskTune(d); }
        abCapture(cid, c, s);
      }).catch(() => abCapture(cid, c, s));
    };
    // A/B comparison: latest vs previous — every changed field (from->to), metric deltas coloured by improvement, and an
    // expandable list of EVERY stored value for the current version so nothing is hidden.
    const abPanel = (cid) => {
      const versions = getAB(cid); if (!versions.length) return "";
      const cur = versions[versions.length - 1];
      const tm = (t) => { try { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
      const secs = {}; Object.keys(cur.full || {}).forEach((k) => { const f = cur.full[k]; (secs[f.section] = secs[f.section] || []).push(f); });
      const fullList = Object.keys(secs).length ? Object.keys(secs).map((s) => `<div class="abv-sec">${esc(s)}</div>${secs[s].map((f) => `<div class="abv-row"><span>${esc(f.label)}</span><b class="${f.pos ? "pos" : ""}">${esc(f.disp)}</b></div>`).join("")}`).join("") : `<div class="why" style="font-size:11px">no fields stored yet</div>`;
      const nfields = Object.keys(cur.full || {}).length;
      if (versions.length < 2) return `<div class="ab-panel"><div class="ab-hd"><b>⚗️ A/B testing</b> <span class="why" style="font-size:10.5px">baseline v1 captured ${tm(cur.at)} · ${nfields} fields — change a slider &amp; save to spawn v2</span></div><details class="abv"><summary>view all ${nfields} stored values</summary>${fullList}</details></div>`;
      const prev = versions[versions.length - 2];
      const changed = (cur.delta || []).length ? (cur.delta).map((d) => `<span class="ab-chg">${esc(d.label)} <span class="why">${esc(String(d.from))}</span> → <b>${esc(String(d.to))}</b></span>`).join("") : `<span class="why">metrics re-measured, no slider change</span>`;
      const mrow = (key, name, unit) => { const a = prev.metrics && prev.metrics[key], b = cur.metrics && cur.metrics[key]; if (a == null || b == null) return "";
        const av = key === "usi" ? Math.abs(a) : a, bv = key === "usi" ? Math.abs(b) : b; const better = bv < av - 1e-6, worse = bv > av + 1e-6;
        const col = better ? "#00d27a" : worse ? "#e5414e" : "var(--muted)"; const arr = better ? "▼" : worse ? "▲" : "=";
        return `<div class="ab-m"><span>${name}</span><b>${a}${unit || ""}</b><span class="ab-arr" style="color:${col}">${arr}</span><b style="color:${col}">${b}${unit || ""}</b>${better ? " ✓" : worse ? " ✗" : ""}</div>`; };
      const nch = (cur.delta || []).length;
      return `<div class="ab-panel"><div class="ab-hd"><b>⚗️ A/B testing</b> <span class="why" style="font-size:10.5px">v${versions.length - 1} → v${versions.length} · ${nch} slider${nch === 1 ? "" : "s"} changed · ${tm(cur.at)}</span></div>
        <div class="ab-changed">${changed}</div>
        <div class="ab-grid">${mrow("spin", "traction spin", "%")}${mrow("usi", "balance |USI|")}${mrow("rearLim", "rear-limited turns")}${mrow("frontLim", "front-limited turns")}</div>
        <details class="abv"><summary>view all ${nfields} stored values (v${versions.length})</summary>${fullList}</details></div>`;
    };
    // ---- TUNE SANITY CHECK: runs on the decoded tune (re-evaluates whenever a save change is detected). Flags the
    // obvious range errors AND the non-obvious "secret" traps most players miss (rebound<bump packing, front-ARB
    // understeer on RWD, negative rake, locked decel diff, aero that goes light at speed). ----
    const SAN_LBL = { front_tire_pressure: "Front tyre pressure", rear_tire_pressure: "Rear tyre pressure", front_camber: "Front camber", rear_camber: "Rear camber", front_bump: "Front bump", rear_bump: "Rear bump", front_rebound: "Front rebound", rear_rebound: "Rear rebound", front_arb: "Front ARB", rear_arb: "Rear ARB", brake_balance: "Brake bias", brake_pressure: "Brake pressure", front_ride_height: "Front ride height", rear_ride_height: "Rear ride height", rear_diff_accel: "Rear diff accel", rear_diff_decel: "Rear diff decel", center_diff: "Center diff", front_downforce: "Front downforce", rear_downforce: "Rear downforce" };
    // a STABLE identity for a finding across value changes — strip HTML + digits so "rear over the limit 96%" and
    // "…94%" are the same finding. Used to flag which findings are NEW since the user last hit Check.
    const sanKey = (x) => ((x.lvl || "") + "|" + String(x.msg || "").replace(/<[^>]+>/g, "").replace(/[0-9.]+/g, "#")).slice(0, 70);
    const sanSeenKey = (cid) => skey("fh6SanSeen:", cid);   // J19 (buildConfirmKey intentionally stays on the raw cid — a genuinely new build SHOULD re-confirm)
    const loadSanSeen = (cid) => { try { return new Set(JSON.parse(localStorage.getItem(sanSeenKey(cid)) || "[]")); } catch (e) { return new Set(); } };
    const saveSanSeen = (cid, set) => { try { localStorage.setItem(sanSeenKey(cid), JSON.stringify([...set])); } catch (e) {} };
    const sanityCheck = (dl, drv) => {
      const v = {}; (dl.tabs || []).forEach((t) => (t.rows || []).forEach((r) => { if (r.value != null && !isNaN(+r.value)) v[r.field] = +r.value; }));
      const I = [];
      // each fix carries a CONCRETE from->to (auto-read current value + a target) and the affected corner PHASES, so
      // the warning can show the tuning-guide corner glyph + exact numbers, not just prose.
      const add = (lvl, msg, fixes, iph) => I.push({ lvl, msg, iph: iph || [],
        fixes: (fixes || []).map((f) => ({ label: SAN_LBL[f.field] || f.field, from: v[f.field] != null ? +(+v[f.field]).toFixed(2) : null, to: f.to != null ? +(+f.to).toFixed(2) : null, sl: DISK2SLIDER[f.field] })).filter((f) => f.to != null) });
      const fwd = drv === "FWD", awd = drv === "AWD";
      const rearFix = () => [{ field: "rear_diff_accel", to: v.rear_diff_accel != null ? Math.min(v.rear_diff_accel, 50) : 50 }, { field: "rear_arb", to: v.rear_arb != null ? Math.max(1, +(v.rear_arb - 6).toFixed(1)) : null }];
      const frontFix = () => [{ field: "front_arb", to: v.front_arb != null ? Math.max(1, +(v.front_arb - 5).toFixed(1)) : null }];
      const trac = tracForCar(dl && dl.ordinal);   // MEASURED behaviour is the headline flag
      if (trac && trac.lvl && trac.lvl !== "ok" && trac.pct != null)
        add(trac.lvl === "bad" ? "error" : "warn", `Measured — the ${(trac.axle || "driven").toLowerCase()} is over the grip limit <b>${trac.pct}%</b> of your on-throttle time. You're spinning, not accelerating — this tune can't put its power down.`, trac.drv === "FWD" ? frontFix() : rearFix(), trac.drv === "FWD" ? [3, 4] : [4, 5]);
      const sm2 = (live.analysis && live.analysis.summary) || {};   // analysis signal persists on the daemon (survives reload)
      const nc = sm2.corners || 0, rl = sm2.rear_limited_corners || 0, fl = sm2.front_limited_corners || 0, drift = sm2.drift_corners || 0; const rearGo = rl + drift;
      if ((!trac || trac.lvl === "ok") && nc >= 4) {
        if (!fwd && rearGo / nc >= 0.4) add(rearGo / nc >= 0.6 ? "error" : "warn", `Measured — the rear breaks loose in <b>${rearGo} of ${nc}</b> corners (${drift} into a slide${rl ? `, ${rl} grip-limited` : ""}): it can't hold traction — power-oversteer, unless you're drifting on purpose.`, rearFix(), [4, 5]);
        else if (fl / nc >= 0.45) add(fl / nc >= 0.65 ? "error" : "warn", `Measured — <b>${fl} of ${nc}</b> corners are front-limited: the front washes out (understeer).`, frontFix(), [2, 3]);
      }
      [["front_bump", "front_rebound", "front"], ["rear_bump", "rear_rebound", "rear"]].forEach(([b, rb, ax]) => {   // SECRET: rebound must be >= bump or the suspension packs down
        if (v[b] != null && v[rb] != null && v[rb] < v[b] - 0.3) add("error", `${SAN_LBL[rb]} (${v[rb]}) is below ${SAN_LBL[b].toLowerCase()} (${v[b]}) — the ${ax} packs down over bumps and can't recover, losing grip mid-corner.`, [{ field: rb, to: v[b] }], [3]);
      });
      ["front_tire_pressure", "rear_tire_pressure"].forEach((k) => { if (v[k] == null) return;
        if (v[k] < 15) add("error", `${SAN_LBL[k]} ${v[k]} psi is far too low — the tyre rolls onto its sidewall and loses grip.`, [{ field: k, to: 30 }], [2, 3, 4]);
        else if (v[k] > 52) add("warn", `${SAN_LBL[k]} ${v[k]} psi is very high — it shrinks the contact patch and overheats the centre.`, [{ field: k, to: 31 }], [2, 3, 4]); });
      if (!fwd && v.rear_diff_accel != null && v.rear_diff_accel >= 95) add("warn", `Rear diff accel ${v.rear_diff_accel}% is near-locked — both rears break loose together on exit (snap oversteer).`, [{ field: "rear_diff_accel", to: 55 }], [4]);
      if (!fwd && v.rear_diff_decel != null && v.rear_diff_decel >= 55) add("warn", `Rear diff decel ${v.rear_diff_decel}% is high — it locks the rears on entry, causing lift / entry instability.`, [{ field: "rear_diff_decel", to: 15 }], [1, 2]);   // SECRET
      if (awd && v.center_diff != null && v.center_diff < 50) add("warn", `Center diff ${v.center_diff}% rear — under 50% makes an AWD car understeer like FWD.`, [{ field: "center_diff", to: 75 }], [4]);
      if (v.front_arb != null && v.rear_arb != null) { const d = v.front_arb - v.rear_arb;
        if (!fwd && d > 10) add("warn", `Front ARB (${v.front_arb}) is much stiffer than the rear (${v.rear_arb}) — on ${drv || "RWD"} this biases the car toward understeer.`, [{ field: "front_arb", to: v.rear_arb }], [2, 3]);   // SECRET
        if (fwd && d < -10) add("warn", `Rear ARB (${v.rear_arb}) is much stiffer than the front (${v.front_arb}) on FWD — can snap into lift-off oversteer.`, [{ field: "rear_arb", to: v.front_arb }], [4]); }
      if (!fwd && v.front_downforce != null && v.rear_downforce != null && v.rear_downforce > 0 && v.front_downforce > v.rear_downforce * 1.15) add("warn", `Front downforce exceeds the rear on ${drv || "RWD"} — the rear goes light at speed and can snap into high-speed oversteer.`, [{ field: "front_downforce", to: v.rear_downforce }], [5]);
      if (v.brake_pressure != null && v.brake_pressure < 90) add("info", `Brake pressure ${v.brake_pressure}% — braking force left unused unless you're locking up.`, [{ field: "brake_pressure", to: 100 }], [1]);
      if (v.brake_balance != null && (v.brake_balance < 40 || v.brake_balance > 68)) add("warn", `Brake bias ${v.brake_balance}% front is extreme — risks locking one axle.`, [{ field: "brake_balance", to: 52 }], [1]);
      ["front_camber", "rear_camber"].forEach((k) => { if (v[k] != null && v[k] < -4) add("info", `${SAN_LBL[k]} ${v[k]}° is very aggressive — cornering bite up, but less straight-line grip and more wear.`, [{ field: k, to: -2 }], [3]); });
      return I;
    };
    const sanityPanel = (dl, drv, hl) => {
      if (!dl || !(dl.tabs || []).length) return "";
      const I = sanityCheck(dl, drv || "?"); const err = I.filter((x) => x.lvl === "error"), warn = I.filter((x) => x.lvl === "warn");
      if (!I.length) return `<div class="sanity ok"><b>🩺 Sanity check</b> <span class="why">— no red flags in this tune.</span></div>`;
      const row = (x) => { const aph = new Set(); (x.fixes || []).forEach((f) => (SLIDER_PHASES[f.sl] || []).forEach((p) => aph.add(p)));
        const iph = (x.iph && x.iph.length) ? x.iph : [...aph];
        const glyph = (aph.size || iph.length) ? `<div class="s-glyph">${moveCorner([...aph], iph, 92)}</div>` : "";
        const sets = (x.fixes || []).map((f) => `<span class="s-set">${esc(f.label)} ${f.from != null ? `<b class="s-from">${f.from}</b> → ` : "→ "}<b class="s-to">${f.to}</b></span>`).join("");
        const isNew = hl && hl.has(sanKey(x));
        return `<div class="sanity-row ${x.lvl}${isNew ? " new" : ""}"><span class="s-ic">${x.lvl === "error" ? "⛔" : x.lvl === "warn" ? "⚠" : "ℹ"}</span><div class="s-body"><div>${isNew ? `<span class="s-new">⭐ NEW</span> ` : ""}${x.msg}</div>${sets ? `<div class="s-fixrow">🔧 ${sets}</div>` : ""}</div>${glyph}</div>`; };
      return `<div class="sanity ${err.length ? "bad" : warn.length ? "warn" : "info"}"><div class="sanity-hd"><b>🩺 Sanity check</b> <span class="why">${err.length ? err.length + " error" + (err.length > 1 ? "s" : "") : ""}${err.length && warn.length ? " · " : ""}${warn.length ? warn.length + " warning" + (warn.length > 1 ? "s" : "") : ""}${!err.length && !warn.length ? "notes only" : ""}</span></div>${[...err, ...warn, ...I.filter((x) => x.lvl === "info")].map(row).join("")}</div>`;
    };
    const tuningMoves = (adv, corners, cur, weightKey) => {
      const wk = weightKey || "course_weight";   // course lane weights by course_weight; general lane by breadth
      const acc = {};
      (adv || []).filter((a) => !a.open).forEach((a) => { const rx = TUNE_RX[a.key]; if (!rx) return; const cw = a[wk] != null ? a[wk] : 1; if (cw < 0.2) return;
        const mag = (a.severity / 3) * (a.confidence || 0.7) * cw;
        const sp = SYMPTOM_PHASES[a.key];
        rx.forEach(([sl, dir, w]) => { const e = acc[sl] = acc[sl] || { net: 0, wsum: 0, sev: 0, srcs: new Set(), conf: 0, iph: new Set(), iss: new Set() }; e.net += dir * w * mag; e.wsum += w * mag; e.sev = Math.max(e.sev, a.severity); e.conf = Math.max(e.conf, a.confidence || 0.7); e.srcs.add(a.text.split(":")[0].split(" (")[0]); if (sp) { sp.ph.forEach((p) => e.iph.add(p)); e.iss.add(sp.issue); } });
      });
      const tuneCorners = (corners || []).filter((k) => k.limiter === "tune");
      const understeerN = tuneCorners.filter((k) => k.dominant === "front").length, oversteerN = tuneCorners.filter((k) => k.dominant === "rear").length; const nT = Math.max(1, (corners || []).length);
      const cornPh = (k) => (k.phase != null ? k.phase : (k.first_red && k.first_red.phase));   // exact telemetry phase where grip was first lost (settled corners carry first_red; live folds carry .phase)
      if (understeerN) { const e = acc.farb = acc.farb || { net: 0, wsum: 0, sev: 2, srcs: new Set(), conf: 0.7, iph: new Set(), iss: new Set() }; const m = 0.5 * understeerN / nT; e.net -= m; e.wsum += m; e.srcs.add(`${understeerN} turns front-limited`); e.iss.add("understeer"); e.iph.add(3); tuneCorners.forEach((k) => { if (k.dominant === "front") { const p = cornPh(k); if (p) e.iph.add(p); } }); }
      if (oversteerN) { const e = acc.rarb = acc.rarb || { net: 0, wsum: 0, sev: 2, srcs: new Set(), conf: 0.7, iph: new Set(), iss: new Set() }; const m = 0.5 * oversteerN / nT; e.net -= m; e.wsum += m; e.srcs.add(`${oversteerN} turns rear-limited`); e.iss.add("oversteer"); e.iph.add(4); tuneCorners.forEach((k) => { if (k.dominant === "rear") { const p = cornPh(k); if (p) e.iph.add(p); } }); }
      const moves = [];
      SLIDER_ORDER.forEach((sl) => { const e = acc[sl]; if (!e || Math.abs(e.net) < 0.12) return; const S = SLIDER[sl]; const dir = e.net > 0 ? 1 : -1; const cv = cur[sl];
        let delta; if (S.pct) delta = cv != null ? Math.round(cv * S.pct * Math.min(1.5, Math.abs(e.net)) * dir) : null; else delta = +(S.step * Math.min(1.5, Math.abs(e.net)) * dir).toFixed(S.dp);
        let to = null; if (cv != null && delta != null) { to = cv + delta; if (S.min != null) to = Math.max(S.min, Math.min(S.max, to)); to = +to.toFixed(S.dp); delta = +(to - cv).toFixed(S.dp); }
        moves.push({ sl, label: S.label, unit: S.unit, from: cv, to, delta, dir, conf: e.conf, sev: e.sev, why: [...e.srcs].slice(0, 3).join(" · "), pct: !!S.pct, iph: [...(e.iph || [])].sort(), iss: [...(e.iss || [])] });
      });
      return moves.sort((a, b) => b.sev - a.sev || Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
    };
    // elegant tuning-move cards: priority-striped, current -> target, PLAIN-LANGUAGE effect, diagnosis + confidence
    const movesCards = (moves, drv, cid) => { ensureFhmCss(); const applied = cid ? getApplied(cid) : {}; return moves.length ? `${movesAnatomy(moves)}<div class="tmoves">${moves.map((m, i) => {
      const up = m.dir > 0; const col = up ? "#f2994a" : "#2f81f7";   // direction orange/blue — #e3b341 is reserved for pending/warning (audit F12)
      const sevCol = m.sev >= 3 ? "#e5414e" : m.sev >= 2 ? "#e3b341" : "#00d27a";
      const fx = (SLIDER_FX[m.sl] || {})[up ? "up" : "down"] || "";
      const vb = (SLIDER[m.sl].verb || ["stiffer", "softer"])[up ? 0 : 1];
      const notch = SLIDER[m.sl].notch; const dmag = notch ? Math.max(1, Math.round(Math.abs(m.delta || 0))) : Math.abs(m.delta);
      const notchU = notch ? (dmag === 1 ? " notch" : " notches") : (m.unit || "");
      // when the current value isn't known, anchor on the vetted community BASELINE and nudge from it — so the card
      // still gives an absolute number to dial in, not just a direction. Sliders without a baseline stay direction-only.
      const base = sliderBaseFor(m.sl, drv); let baseTo = null;
      if (m.to == null && base != null && m.delta != null && !notch) {
        baseTo = base + m.delta; const S = SLIDER[m.sl];
        if (S.min != null) baseTo = Math.max(S.min, Math.min(S.max, baseTo));
        baseTo = +baseTo.toFixed(S.dp);
      }
      const change = (m.to != null && m.from != null)
        ? `<span class="tm-from">${m.from}${m.unit}</span><span class="tm-arr" style="color:${col}">${up ? "▲" : "▼"}</span><b class="tm-to" style="color:${col}">${m.to}${m.unit}</b>`
        : baseTo != null
          ? `<span class="tm-from" title="vetted community baseline — enter your current value for an exact target">≈${base}${m.unit}</span><span class="tm-arr" style="color:${col}">${up ? "▲" : "▼"}</span><b class="tm-to" style="color:${col}">${baseTo}${m.unit}</b><span class="tm-baseline" title="anchored on the multi-source baseline, not your car">base</span>`
          : `<b class="tm-to" style="color:${col}">${vb}${(m.delta != null || notch) ? " ~" + dmag + notchU : ""}</b>`;
      const aph = SLIDER_PHASES[m.sl] || []; const iph = m.iph || [];
      const cap = aph.map((p) => `<span style="color:${CM_PC[p - 1]}">${CM_ABBR[p - 1]}</span>`).join("·") || "—";
      const tgt = m.to != null ? m.to : (baseTo != null ? baseTo : "");
      const applyBtn = cid ? (applied[m.sl]
        ? `<button class="tm-done" data-unapply="${esc(cid)}@@${m.sl}" title="marked done — still suggested, so drive a clean run &amp; re-test, or it may need another step. Click to un-mark.">✓ done · still flagged</button>`
        : `<button class="tm-apply" data-apply="${esc(cid)}@@${m.sl}@@${tgt}" title="I made this change in-game — set it as my new current value &amp; start a fresh run to A/B test">✓ I made this</button>`) : "";
      return `<div class="tmove${applied[m.sl] ? " done" : ""}" style="border-left-color:${sevCol}"><div class="tm-main"><div class="tmove-top"><span class="tmove-n">${i + 1}</span><span class="tmove-sl">${m.label}</span><span class="tmove-ch">${change}</span></div>${fx ? `<div class="tmove-fx">${fx}</div>` : ""}<div class="tmove-why"><span>${esc(m.why)}</span><span class="tmove-conf" title="confidence ${Math.round((m.conf || 0) * 100)}%"><i style="width:${Math.round((m.conf || 0) * 100)}%;background:${(m.conf || 0) >= 0.7 ? "#00d27a" : "#e3b341"}"></i></span></div>${applyBtn}</div><div class="tm-diag" title="acts where the change works · red = where your issue is">${moveCorner(aph, iph)}<div class="tm-diag-cap">acts: ${cap}</div></div></div>`;
    }).join("")}</div>` : `<p class="why" style="font-size:11px;margin:6px 0 0">No across-the-board change stands out yet — the car's weaknesses so far are context-specific (see the balance signature), not systematic.</p>`; };
    const tuneInputRow = (cid) => { const cur = getTune(cid); const n = Object.keys(cur).length;
      const o0 = String(cid).split("|")[0];
      const diskN = Object.keys((live.diskTune && live.diskTune[o0]) || {}).length;
      const noMatch = (() => { const c = live.diskCache && live.diskCache[o0]; return !!(c && c.match && c.match.how === "no-match"); })();
      const note = diskN ? `<b style="color:#00d27a">📀 ${diskN} current values auto-filled from disk</b> ${buildThumb(o0, null, true)} — targets are exact; edit any to override`
        : noMatch ? `<b style="color:#e3b341">⚠️ this build isn't saved on disk</b> — no saved tune matches your live engine, so targets use vetted baselines. Save your tune in-game (or type your values) to read exact current numbers.`
        : (n ? n + " values entered — targets below are exact; edit anytime" : "enter your current slider values for EXACT target numbers (from the in-game tune pane)");
      return `<details ${n ? "" : "open"} style="margin:6px 0"><summary style="cursor:pointer;font-size:11.5px"><b>⚙️ Current tune</b> <span class="why">${note}</span></summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 8px;margin-top:6px">${SLIDER_ORDER.map((sl) => `<label style="font-size:10.5px;display:flex;justify-content:space-between;align-items:center;gap:4px">${SLIDER[sl].label}<input data-tunecid="${esc(cid)}" data-tunesl="${sl}" value="${cur[sl] != null ? cur[sl] : ""}" inputmode="decimal" style="width:60px;padding:2px 4px;border-radius:4px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:11px"></label>`).join("")}</div></details>`;
    };
    const numericTuningPanel = (co, s, forceCid) => {
      const cid = forceCid || (live.frame && live.frame.on && live.frame.cid) || live.courseCar || (co.cars || [])[0]; if (!cid) return "";   // when paused, stay on the LAST-DRIVEN car — not co.cars[0], which may be a different car
      if (live.connected) { const o0 = String(cid).split("|")[0]; if (!(live.diskTune && live.diskTune[o0])) fetchDiskTune(+o0); }
      const adv = (co.advice_by_car || {})[cid] || [];   // J18: no advice for THIS build yet ≠ borrow another build's advice
      const liveInc = (live.cornSince || []).filter((c) => !c.drift && c.first_red && (!cid || c.car === cid)).map((c) => ({ limiter: "tune", dominant: c.first_red.axle, phase: c.first_red.phase }));
      const cur = getTune(cid); const moves = tuningMoves(adv, [...(co.corners || []), ...liveInc], cur); const haveCur = Object.keys(cur).length > 0;
      live.lastMoves = live.lastMoves || {}; if (cid) live.lastMoves[cid] = moves;   // cache for the anchored dock iteration panel
      const _age = live.analysisAt ? Math.round((Date.now() - live.analysisAt) / 1000) : null;
      const liveNote = liveInc.length ? ` <span class="chip" style="border-color:#00d27a;color:#00d27a" title="the settled read recomputes on lap boundaries / every 20–90 s; corners since then fold into the balance live — the settled read stays the authority for the tune-vs-driver call">📡 settled${_age != null ? " " + _age + "s ago" : ""} · +${liveInc.length} live corner${liveInc.length > 1 ? "s" : ""} folding in</span>` : "";
      const prio = (co.profile && co.profile.priority) || []; const rideMove = moves.some((m) => m.sl === "rheight" || m.sl === "fheight"); const rn = co.name || "this course";
      const verdict = !moves.length ? "Balanced for what this track demands — no firm change yet · a few more clean laps will separate driver from tune" : `<b>${moves.length} change${moves.length > 1 ? "s" : ""}</b> to sharpen this car for ${esc(rn)}${prio.length ? ` · this track stresses ${esc(prio.slice(0, 2).join(" + "))}` : ""}${rideMove ? " · incl. ride height (bottoming)" : ""}`;
      return `<div class="lab-corner" style="border-left:4px solid var(--accent);background:var(--bg2)"><div class="card-row" style="margin-top:0"><strong style="font-size:14px">🔧 Tuning adjustments — the numbers to change</strong><span class="chip" style="border-color:var(--accent);color:var(--accent)">${moves.length} change${moves.length === 1 ? "" : "s"}${prio.length ? " · prioritised for " + esc(prio[0]) : ""}</span>${liveNote}</div>
        <div style="font-size:13px;font-weight:600;margin:7px 0 9px;color:var(--txt)">${verdict}</div>
        ${abPanel(cid)}${appliedStrip(cid, moves)}${movesCards(moves, ["FWD", "RWD", "AWD"][+String(cid).split("|")[1]] || null, cid)}
        <p class="why" style="font-size:10.5px;margin:7px 0 0">${haveCur ? "Targets are computed from your current values (auto-filled from disk). " : "Position-only sliders show a direction until you register their range. "}Change ONE group, re-drive the course, and the numbers refine — course-weighted, so only what THIS track stresses is shown.</p>
        ${tuneInputRow(cid)}</div>`;
    };
    // ---- LIVE · COURSE: two STAGES, car-independent. COURSE TRAINING until the course itself is known well enough (map · turn count earned across laps ·
    //      laps on record · profile → knowledge ≥ 75 %), then COURSE TUNING (this car's feedback on that course). Manual override via chips. ----
    const courseStageSel = () => localStorage.getItem("fh6CourseStage") || "auto";   // auto | training | tuning
    // J15: honest cadence — the daemon re-analyses on lap boundaries and every 20/45/90 s of driving (period grows
    // with the session file), so a fixed "~20 s" promise reads as a stall after long drives. Show the truth we hold.
    const analysisAgeChip = () => { const a = live.analysisAt ? Math.round((Date.now() - live.analysisAt) / 1000) : null; return `<span class="chip"${live._anGap ? ` title="last analysis interval ${live._anGap}s — re-analysis slows as the session file grows; ↺ reset for a fresh, fast session"` : ` title="re-analyses on lap boundaries and every 20–90 s of driving"`}>${a == null ? "no analysis yet — drive to trigger" : "analysed " + a + "s ago"}</span>`; };
    const courseKnowledge = (co) => {
      const tr = co.track || {}, tu = co.turns || {}, geo = co.geometry; const lapsN = co.laps ? co.laps.total : co.runs; const lapsTrack = Math.max(tr.laps || 0, lapsN || 0);
      // 'mapped' must come from the analysis's turn data (tu.mapped / canonical), NOT co.geometry — geometry is stripped from the live SSE payload,
      // so relying on it kept every live course stuck in training. A course is mapped once it has turns established / curvature-mapped.
      const mapped = (tu.mapped || 0) > 0 || (tu.canonical || []).length > 0 || !!(geo && (geo.turns || []).length); const turnConf = tu.track_confidence || tu.confidence || 0; const poss = tu.possible || 0; const notDriven = (geo && geo.not_driven) || []; const prof = !!co.profile;
      // SHAPE COVERAGE: the curvature map's turn count is the shape's own testimony — ratification must not outrun
      // enumeration. established/mapped (+1 slack for extractor generosity); no geometry data → no penalty.
      const estN = tu.established != null ? tu.established : ((tu.canonical || []).length || tu.count || 0);
      const geoCov = tu.shape_coverage != null ? tu.shape_coverage : ((tu.mapped || 0) > 0 ? Math.min(1, (estN + 1) / (tu.expected || tu.mapped)) : 1);   // the player's DECLARED count is ground truth — an over-mapping extractor must not deadlock the gate
      const missingN = (tu.mapped || 0) > estN ? tu.mapped - estN : 0;
      const lapStr = 1 - Math.exp(-1.2 * lapsTrack / 3);
      // SHAPE confidence: are the recorded laps tracing the same OUTLINE? (analyzer-measured; the shape is the course's identity, so it's the
      // 25% that used to be a free "a map exists" boolean). Falls back to that boolean for models analysed before shape_confidence existed.
      const shapeMeasured = tu.shape_confidence != null; const shapeConf = shapeMeasured ? tu.shape_confidence : (mapped ? 0.5 : 0);   // unmeasured ≠ perfect: a map with no cross-lap shape agreement earns half, not a free 1.0
      const shapeAgree = tu.shape_laps_agree, shapeCompared = tu.shape_laps_compared, shapeSpread = tu.shape_spread_m;
      const pct = Math.round((0.25 * shapeConf + 0.35 * turnConf + 0.25 * lapStr + 0.15 * (prof ? 1 : 0)) * 100);
      const needs = [];
      if (!mapped) needs.push({ k: "map", p: 0, text: "complete ONE full lap without pausing — the course map is learned from it" });
      if (missingN > 1) needs.push({ k: "enumerate", p: 0, text: `the shape shows ${tu.mapped} turns — only ${estN} enumerated: ${missingN} still to establish (take the map's hollow turns at pace so they register)` });   // the shape's own testimony blocks ratification
      else if (shapeMeasured && shapeConf < 0.75) needs.push({ k: "shape", p: 0, text: `the outline is still settling — ${shapeAgree || 1} lap${(shapeAgree || 1) === 1 ? "" : "s"} trace the same shape${shapeSpread != null ? ` (±${shapeSpread} m)` : ""}; a few more clean laps ratify it (shape ${Math.round(shapeConf * 100)}%)` });
      if (lapsTrack < 3) needs.push({ k: "laps", p: 1, text: `${3 - lapsTrack} more full lap${3 - lapsTrack === 1 ? "" : "s"} — the turn count is earned across laps (now ${Math.round(turnConf * 100)}%)` });
      else if (turnConf < 0.7) needs.push({ k: "laps", p: 1, text: `keep lapping — turn count ${Math.round(turnConf * 100)}% (target 70%): clean laps confirm turns, messy laps split them` });
      if (poss) needs.push({ k: "possible", p: 2, text: `${poss} possible turn${poss === 1 ? "" : "s"} seen on a minority of laps — lap consistently to confirm or drop ${poss === 1 ? "it" : "them"}` });
      if (notDriven.length) needs.push({ k: "load", p: 2, text: `mapped turn${notDriven.length === 1 ? "" : "s"} ${notDriven.map(turnLabel).join(", ")} never loaded the tyres — take ${notDriven.length === 1 ? "it" : "them"} at pace once so ${notDriven.length === 1 ? "it registers" : "they register"}` });   // J13: G-ids resolve to the T<n> the map shows
      if (!prof) needs.push({ k: "profile", p: 3, text: "one full lap so the course's demands (profile) are known" });
      if ((tu.messy || []).length) needs.push({ k: "messy", p: 3, text: `${tu.messy.map(turnLabel).join(", ")} split into several detections most laps — drive ${tu.messy.length === 1 ? "it" : "them"} as one smooth arc` });   // J13
      needs.sort((x, y) => x.p - y.p);
      let auto = (pct >= 75 && mapped && geoCov >= 0.9) ? "tuning" : "training"; const sel = courseStageSel();   // HARD gate: the tuning stage requires the enumerated turns to cover the shape's mapped turns — per-turn advice on a known-incomplete inventory is wrong advice
      if (src === "live") { try { const hk = "fh6StageAuto:" + (co.route_key || "");   // HYSTERESIS: a reached tuning stage regresses only when CLEARLY below the gate — one newly-mapped turn at the boundary must not flap the stage (and its toast) every analysis. LIVE-only: a recording render of stale data must not clobber the live latch
        if (localStorage.getItem(hk) === "tuning" && auto === "training" && pct >= 68 && geoCov >= 0.85 && mapped) auto = "tuning";
        localStorage.setItem(hk, auto); } catch (e) {} }
      let stage = sel === "auto" ? auto : sel; let pinSuspended = false;
      if (sel === "tuning" && auto === "training") { stage = "training"; pinSuspended = true; }   // STATUS REGRESSION beats the pin: prerequisites no longer fulfilled → the pinned tuning stage is suspended, not honored
      return { pct, stage, auto, sel, needs, mapped, turnConf, lapsTrack, lapsN, poss, notDriven, prof, shapeConf, shapeMeasured, shapeAgree, shapeCompared, shapeSpread, geoCov, missingN, pinSuspended };
    };
    const stageChips = (ck) => `<span style="display:inline-flex;gap:3px;margin-left:8px">${[["auto", "🧭 auto"], ["training", "📚 training"], ["tuning", "🏋 tuning"]].map(([k, l]) => `<span class="chip" data-course-stage="${k}" style="cursor:pointer;padding:1px 7px;${ck.sel === k ? "border-color:var(--txt);color:var(--txt)" : ""}">${l}${k === "auto" && ck.sel === "auto" ? " → " + ck.auto : ""}</span>`).join("")}</span>`;
    const courseStageBanner = (co, ck) => {
      const training = ck.stage === "training"; const top = ck.needs[0]; const col = training ? "var(--accent2)" : "var(--accent)";
      const remain = Math.max(0, 75 - ck.pct);
      const regrNote = ck.pinSuspended ? `<div style="border-left:3px solid #e5414e;background:rgba(229,65,78,.08);padding:5px 8px;border-radius:6px;margin-bottom:6px;font-size:11.5px"><b style="color:#e5414e">⬇ Your 🏋 tuning pin is suspended</b> <span class="why">— prerequisites regressed${ck.missingN > 1 ? ` (the shape shows ${ck.missingN} more turns than are enumerated)` : ""}; it resumes on its own when the gate passes.</span></div>` : "";
      return `<div class="lab-corner" style="border-left:4px solid ${col};background:var(--bg2);margin-bottom:8px">${regrNote}
        <div class="card-row" style="margin-top:0"><strong style="font-size:15px">${training ? "📚 COURSE TRAINING" : "🏋 COURSE TUNING"} <span class="why" style="font-weight:400">· ${training ? "learning THIS COURSE (car-independent)" : "the course is known — feedback is about this car on it"}</span></strong><span style="display:inline-flex;align-items:center;gap:4px"><span id="lvCourseLive" class="chip"></span>${stageChips(ck)}</span></div>
        ${training ? `<div style="display:flex;align-items:baseline;gap:10px;margin:8px 0 2px"><b style="font-size:34px;line-height:1;color:${col}">${ck.pct}%</b><span class="why" style="font-size:12px">course-learning confidence${remain ? ` · ${remain}% to reach the tuning stage (75%)` : " · ready to switch to tuning"}</span></div>
          <div class="lab-bar" style="height:14px;margin:4px 0 8px"><i style="width:${ck.pct}%;background:${col}"></i><i style="left:75%;width:2px;background:var(--txt);opacity:.7" title="75% — switches to tuning"></i></div>
          <div style="font-size:14px;margin:6px 0 2px"><b>▶ NEXT to raise confidence:</b> ${top ? esc(top.text) : "keep lapping — the next analysis will confirm"}</div>
          ${ck.needs.slice(1).length ? `<div class="why" style="font-size:11px;margin-top:2px">then:</div><ol style="margin:2px 0 0 18px;padding:0;font-size:11.5px">${ck.needs.slice(1).map((n) => `<li>${esc(n.text)}</li>`).join("")}</ol>` : ""}
          <p class="why" style="font-size:10px;margin:6px 0 0">counts toward confidence: a <b>stable outline</b> (laps tracing the same shape — 25%${ck.shapeMeasured ? `, now ${Math.round(ck.shapeConf * 100)}%` : ""}) · turn count earned across laps (35%) · more laps (25%) · the course profile (15%). The tuning stage ALSO requires the enumerated turns to cover the shape's mapped turns${ck.geoCov != null ? ` (now ${Math.round(ck.geoCov * 100)}%, needs 90%)` : ""} — per-turn advice on an incomplete inventory would be wrong advice. Tuning feedback is not shown while training — per-car references are still saved in the background.</p>`
          : `<div class="lab-bar" style="height:8px;margin:6px 0"><i style="width:${ck.pct}%;background:${col}"></i><i style="left:75%;width:2px;background:var(--txt);opacity:.6"></i></div><p class="why" style="font-size:11px;margin:4px 0 0">course knowledge ${ck.pct}% · ${ck.needs.length ? "still useful for the course: " + ck.needs.map((n) => esc(n.text)).join(" · ") : "nothing more needed for the course — everything below is feedback for this car on it"}</p>`}
      </div>`;
    };
    // ---- LAST-CORNER SCORECARD: a quick grade for the corner you just drove, from the same telemetry the analysis uses.
    // Combines (a) keeping GRIP (no slid axle / drift through the phases), (b) AVERAGE SPEED vs your best line through
    // that same corner, and (c) avoiding the common MISTAKES we detect (understeer, oversteer, exit wheelspin, lockup,
    // handbrake). Backbone is grip+mistakes; speed nudges it once we've seen the corner before. ----
    const GRADE_COL = { S: "#00d27a", A: "#4fd07a", B: "#e3b341", C: "#e8963c", D: "#e5414e" };
    const cornerKey = (c) => {
      if (!c || !c.apex || c.apex[0] == null || c.apex[1] == null) return null;
      if (c.ev !== 0) { try { const mt = matchTurn(c.apex); if (mt) return "ct" + mt.n; } catch (e) {} }   // J10: canonical turn id when the course knows its turns — stable, unlike raw grid buckets. J14: a free-roam corner (ev:0) never shares a course turn's key — its pace must not become the turn's baseline
      return Math.round(c.apex[0] / 18) + "_" + Math.round(c.apex[1] / 18);            // grid fallback: unmapped course corners AND all free-roam corners
    };
    const cornerAvg = (c) => { const b = (live.spd || []).filter((p) => p.t >= c.t0 && p.t <= c.t1); if (b.length >= 2) return b.reduce((s, p) => s + p.mph, 0) / b.length; return (c.mph_in + c.mph_min + c.mph_out) / 3; };
    const scoreCorner = (c) => {
      if (!c) return null;
      const avg = Math.round(cornerAvg(c));
      const key = cornerKey(c); const bestRec = key && live.cornerBest && live.cornerBest[key]; const best = bestRec ? bestRec.avg : null;
      let grip = 100; const issues = [];
      (c.phases || []).forEach((p) => { if (p.red && p.red !== "none") { const w = p.phase === 4 ? 12 : p.phase === 3 ? 10 : p.phase === 2 ? 8 : 6; grip -= (p.red === "both" ? Math.round(w * 1.3) : w); } });
      if (c.drift) { grip -= 16; issues.push({ k: "🌀 drift", sev: 3, t: "rear slid well past grip" }); }
      else if (c.usi > 0.18) { grip -= Math.min(22, Math.round(c.usi * 55)); issues.push({ k: "↔ understeer", sev: c.usi > 0.3 ? 3 : 2, t: "front washed out (turn-in / mid)" }); }
      else if (c.usi < -0.18) { grip -= Math.min(20, Math.round(-c.usi * 50)); issues.push({ k: "⟳ oversteer", sev: c.usi < -0.3 ? 3 : 2, t: "rear stepped out" }); }
      const p4 = (c.phases || []).find((p) => p.phase === 4);
      if (p4 && p4.rear > 1.2 && !c.drift) { grip -= 10; issues.push({ k: "🔥 exit spin", sev: 2, t: "wheelspin on exit — losing drive" }); }
      if (c.brake_max >= 99 && c.first_red && c.first_red.phase <= 2) { grip -= 8; issues.push({ k: "🛑 lockup", sev: 2, t: "brakes maxed into the corner" }); }
      if (c.hb) { grip -= 14; issues.push({ k: "✋ handbrake", sev: 2, t: "handbrake pulled" }); }
      grip = Math.max(0, Math.min(100, grip));
      let deltaBest = null, speedPct = null;
      if (best != null && best > 0) { speedPct = Math.round(avg / best * 100); deltaBest = avg - Math.round(best); }
      // grip is the backbone (60%); speed vs your best line is 40% and STEEP — a clean-but-slow corner is not an S.
      let score = grip; if (speedPct != null) { const speedComp = Math.max(0, Math.min(100, 100 - (100 - speedPct) * 1.8)); score = Math.round(grip * 0.6 + speedComp * 0.4); }
      score = Math.max(0, Math.min(100, score));
      const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 68 ? "B" : score >= 55 ? "C" : "D";
      const gripState = c.drift ? "drift" : (c.first_red ? c.first_red.axle : "held");
      return { score, grade, grip, gripState, issues: issues.sort((a, b) => b.sev - a.sev), avg, apex: c.mph_apex != null ? c.mph_apex : c.mph_min, pos: c.apex, best: best != null ? Math.round(best) : null, deltaBest, dir: c.dir, key, kink: !!c.kink, lapn: c.lapn, t: c.t1 };   // pos = world coords — the map's last-corner callout anchors here
    };
    const pushCornerScore = (c) => {
      const sc = scoreCorner(c); if (!sc) return;
      if (sc.key) { live.cornerBest = live.cornerBest || {}; const b = live.cornerBest[sc.key]; if (!b || sc.avg > b.avg) live.cornerBest[sc.key] = { avg: sc.avg, at: Date.now() }; }   // update the personal best AFTER scoring vs the prior best
      sc.at = Date.now();   // wall-clock stamp — the map's grade ring pulses while the score is fresh
      (live.cornerScores = live.cornerScores || []).push(sc); if (live.cornerScores.length > 60) live.cornerScores.shift();
    };
    const cornerScoreCard = () => {
      const scs = live.cornerScores || [];
      if (!scs.length) return `<div class="cscore"><div class="cscore-hd"><b>Last corner</b> <span class="why" style="font-size:10.5px">drive a corner — each is graded on grip, speed &amp; clean execution</span></div></div>`;
      const l = scs[scs.length - 1]; const col = GRADE_COL[l.grade];
      const dirIcon = l.dir === "R" ? "▶ right" : "◀ left";
      const gripLbl = l.gripState === "held" ? `<b style="color:#00d27a">🟢 grip held</b>` : l.gripState === "drift" ? `<b style="color:#e5414e">🔴 drifting</b>` : `<b style="color:#e3b341">🟡 ${esc(l.gripState)} slipped</b>`;
      const speedLbl = l.best != null ? `avg <b>${l.avg}</b> mph <span style="color:${l.deltaBest >= 0 ? "#00d27a" : "#e5414e"}">${l.deltaBest >= 0 ? "▲ +" + l.deltaBest : "▼ " + l.deltaBest}</span> vs your best` : `avg <b>${l.avg}</b> mph · apex ${l.apex} · <span class="why">first pass = baseline</span>`;
      const issues = l.issues.length ? l.issues.map((i) => `<span class="cscore-iss s${i.sev}" title="${esc(i.t)}">${i.k}</span>`).join("") : `<span class="cscore-clean">✓ clean — nothing flagged</span>`;
      const strip = scs.slice(-10).map((s) => `<span class="cscore-chip" style="background:${GRADE_COL[s.grade]}" title="grade ${s.grade} · score ${s.score} · avg ${s.avg} mph${s.deltaBest != null ? " (" + (s.deltaBest >= 0 ? "+" : "") + s.deltaBest + " vs best)" : ""}">${s.grade}</span>`).join("");
      return `<div class="cscore" style="border-color:${col}">
        <div class="cscore-hd"><b>Last corner${l.key && String(l.key).indexOf("ct") === 0 ? " — T" + String(l.key).slice(2) : ""}</b> <span class="why" style="font-size:10.5px">${dirIcon}${l.kink ? " · kink" : ""} · lap ${l.lapn || "—"}${l.pos && l.pos[0] != null ? ` · <span style="color:${GRADE_COL[l.grade]}">◉ on the map</span>` : ""}</span><span class="cscore-strip" title="the last 10 corners, newest on the right">${strip}</span></div>
        <div class="cscore-body"><div class="cscore-grade" style="color:${col};border-color:${col}">${l.grade}<small>${l.score}</small></div>
          <div class="cscore-detail"><div class="cscore-line">${gripLbl} · ${speedLbl}</div><div class="cscore-issues">${issues}</div></div></div></div>`;
    };
    const paintCornerScore = () => { const el = document.getElementById("lvCornerScore"); if (el) el.innerHTML = cornerScoreCard(); };
    // LIVE MAP: the car's position, moved every frame on any rendered live course map (no re-render — the SVG
    // carries its own transform constants), and the just-scored turn ringed in its Last-corner grade color so the
    // map and the scorecard narrate the same moment.
    const updCarDot = (f) => { try {
      host.querySelectorAll("svg[data-live-map]").forEach((sv) => {
        const g = sv.querySelector(".lv-car"); if (!g) return;
        if (!f || !f.on || f.px == null) { g.style.display = "none"; return; }
        const ds = sv.dataset; const cx = +ds.ox + (f.px - +ds.x0) * +ds.sc, cy = +ds.oy - (f.pz - +ds.z0) * +ds.sc;
        if (cx < -25 || cy < -25 || cx > +ds.w + 25 || cy > +ds.h + 25) { g.style.display = "none"; return; }   // off the mapped area — hide rather than pin to an edge
        g.style.display = ""; g.setAttribute("transform", `translate(${cx.toFixed(1)},${cy.toFixed(1)})`);
      });
    } catch (e) {} };
    // LAST-CORNER CALLOUT: the scorecard's verdict, ON the map, at the corner's real apex — grade color + the
    // established driving-error icons (🌀 drift · ↔ understeer · ⟳ oversteer · 🔥 exit spin · 🛑 lockup · ✋ handbrake).
    // One visual language: what the Last-corner card says, the map shows, where it happened.
    const lastCornerSvg = (sc) => {
      const col = GRADE_COL[sc.grade];
      const icons = sc.issues && sc.issues.length ? sc.issues.slice(0, 3).map((i) => (i.k || "").split(" ")[0]).join("") : "✓";
      const tn = sc.key && String(sc.key).indexOf("ct") === 0 ? " — T" + String(sc.key).slice(2) : "";
      const tt = `LAST CORNER${tn} · grade ${sc.grade} (${sc.score})${sc.deltaBest != null ? ` · ${sc.deltaBest >= 0 ? "+" : ""}${sc.deltaBest} mph vs best` : ""}${sc.issues && sc.issues.length ? " · " + sc.issues.map((i) => `${i.k} — ${i.t}`).join(" · ") : " · clean — nothing flagged"}`;
      return `<circle r="16.5" fill="none" stroke="${col}" stroke-width="1" opacity=".35"/><circle class="lvl-ring" r="12.5" fill="var(--bg)" fill-opacity=".55" stroke="${col}" stroke-width="2.6"/><text y="4" text-anchor="middle" fill="${col}" font-size="11" font-weight="800" style="paint-order:stroke;stroke:var(--bg);stroke-width:2px">${sc.grade}</text><text y="28" text-anchor="middle" font-size="10" style="paint-order:stroke;stroke:var(--bg);stroke-width:2.5px"${sc.issues && sc.issues.length ? "" : ` fill="#00d27a"`}>${icons}</text><title>${esc(tt)}</title>`;
    };
    const paintLastOnMap = (sc) => { try {
      if (!sc) return;
      flashTurnOnMap(sc);   // the turn's persistent grade ring
      if (!sc.pos || sc.pos[0] == null) return;
      host.querySelectorAll("svg[data-live-map]").forEach((sv) => {
        const ds = sv.dataset; const cx = +ds.ox + (sc.pos[0] - +ds.x0) * +ds.sc, cy = +ds.oy - (sc.pos[1] - +ds.z0) * +ds.sc;
        if (cx < -25 || cy < -25 || cx > +ds.w + 25 || cy > +ds.h + 25) return;   // this map is a different course
        let g = sv.querySelector(".lv-last");
        if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.setAttribute("class", "lv-last"); sv.insertBefore(g, sv.querySelector(".lv-car")); }
        g.setAttribute("transform", `translate(${cx.toFixed(1)},${cy.toFixed(1)})`); g.innerHTML = lastCornerSvg(sc);
        g.classList.remove("fresh"); void g.getBoundingClientRect(); g.classList.add("fresh");
      });
    } catch (e) {} };
    // TRACE ↔ MAP: hovering the speed trace marks the exact spot on the course map. The trace's points carry
    // their own world position (analyzer writes [s, mph, grip, x, z]), so this needs no arc-to-path alignment.
    const bindTraceHover = (root) => { (root || host).querySelectorAll("svg.spd-trace[data-pts]").forEach((sv) => {
      if (sv._bound) return; sv._bound = true;
      let P = null; try { P = JSON.parse(sv.dataset.pts || "[]"); } catch (e) { P = null; }
      if (!P || !P.length) return;
      const ds = sv.dataset, smax = +ds.smax, padL = +ds.padl, W2 = +ds.w;
      const readEl = sv.closest(".lab-corner") && sv.closest(".lab-corner").querySelector(".spd-read");
      const cur = sv.querySelector(".spd-cursor");
      const move = (ev) => {
        const r = sv.getBoundingClientRect(); const vx = ((ev.clientX - r.left) / r.width) * W2;
        const s = ((vx - padL) / (W2 - padL - 6)) * smax;
        let bi = 0, bd = Infinity;
        for (let i = 0; i < P.length; i++) { const d = Math.abs(P[i][0] - s); if (d < bd) { bd = d; bi = i; } }
        const p = P[bi]; const g = gripOf(p[2]);
        const px = padL + (p[0] / smax) * (W2 - padL - 6);
        if (cur) { cur.style.display = ""; cur.querySelector("line").setAttribute("x1", px); cur.querySelector("line").setAttribute("x2", px);
          const cc = cur.querySelector("circle"); cc.setAttribute("cx", px); cc.setAttribute("cy", sv.querySelector("polyline") ? +(sv.dataset.h) - 15 - (p[1] / (Math.max(...P.map((q) => q[1])) * 1.06 || 1)) * (+sv.dataset.h - 15 - 8) : 0); cc.setAttribute("fill", g.col); }
        if (readEl) readEl.innerHTML = `<b>${Math.round(p[1])} mph</b> at ${Math.round(p[0])} m · ${gripChip(GRIP_BY_N[p[2]] || "calm", { axle: true })}`;
        if (p.length > 4) markMapAt(p[3], p[4], g.col);
      };
      sv.addEventListener("mousemove", move);
      sv.addEventListener("mouseleave", () => { if (cur) cur.style.display = "none"; if (readEl) readEl.textContent = "hover the trace — it marks that exact spot on the course map"; clearMapMark(); });
    }); };
    const markMapAt = (x, z, col) => { try { host.querySelectorAll("svg[data-live-map]").forEach((sv) => {
      const ds = sv.dataset; const cx = +ds.ox + (x - +ds.x0) * +ds.sc, cy = +ds.oy - (z - +ds.z0) * +ds.sc;
      if (cx < -20 || cy < -20 || cx > +ds.w + 20 || cy > +ds.h + 20) return;
      let g = sv.querySelector(".spd-mark");
      if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.setAttribute("class", "spd-mark"); sv.appendChild(g); }
      g.style.display = ""; g.innerHTML = `<circle r="11" fill="none" stroke="${col}" stroke-width="1.4" opacity=".55"/><circle r="5" fill="${col}" stroke="var(--bg)" stroke-width="1.5"/>`;
      g.setAttribute("transform", `translate(${cx.toFixed(1)},${cy.toFixed(1)})`);
    }); } catch (e) {} };
    const clearMapMark = () => { try { host.querySelectorAll("svg[data-live-map] .spd-mark").forEach((g) => { g.style.display = "none"; }); } catch (e) {} };
    const flashTurnOnMap = (sc) => { try {
      if (!sc || !sc.key || String(sc.key).indexOf("ct") !== 0) return; const n = +String(sc.key).slice(2); const col = GRADE_COL[sc.grade];
      host.querySelectorAll(`svg[data-live-map] [data-tn="${n}"]`).forEach((mk) => {
        const anchor = mk.querySelector("circle[cx]"); if (!anchor) return;
        let ring = mk.querySelector(".tn-grade");
        if (!ring) { ring = document.createElementNS("http://www.w3.org/2000/svg", "circle"); ring.setAttribute("class", "tn-grade"); ring.setAttribute("cx", anchor.getAttribute("cx")); ring.setAttribute("cy", anchor.getAttribute("cy")); ring.setAttribute("r", "8.5"); ring.setAttribute("fill", "none"); ring.setAttribute("stroke-width", "2.2"); mk.insertBefore(ring, mk.firstChild); }
        ring.setAttribute("stroke", col); ring.classList.remove("fresh"); void ring.getBoundingClientRect(); ring.classList.add("fresh");   // restart the pulse
      });
    } catch (e) {} };
    // ---- BUILD-CONFIRM GATE: tuning advice is only as good as the build identification behind its "current values", so
    // course tuning stays locked until the DECODE confidently identifies the build you're driving. The system decides
    // when it's confident (clean live match + a solid decode) and prompts YOU to confirm — you don't have to judge it. ----
    const buildConfirmKey = (cid) => "fh6BuildOK:" + baseId(cid);
    const isBuildConfirmed = (cid) => { try { return localStorage.getItem(buildConfirmKey(cid)) === "1"; } catch (e) { return false; } };
    const setBuildConfirmed = (cid, v) => { try { if (v) localStorage.setItem(buildConfirmKey(cid), "1"); else localStorage.removeItem(buildConfirmKey(cid)); } catch (e) {} };
    const buildConfidence = (cached) => {
      const R = { ready: false, pct: 0, why: [], need: [], hardBlock: false, matchLbl: "", noSave: false };
      if (cached && cached.available === false) {
        // definitively NO saved tune on disk — there are no wrong current values to protect against (advice falls back
        // to vetted baselines), so this is NOT a hard block: 'confirm anyway' proceeds on baselines.
        R.noSave = true; R.matchLbl = "no saved tune";
        R.need.push("apply or save a tune once — advice uses baselines until a file exists");
        return R;
      }
      if (!cached || !cached.deliverable) { R.need.push("reading the build from the save file…"); R.hardBlock = true; return R; }
      const dl = cached.deliverable, m = cached.match || {}, sm = dl.summary || {};
      const n = m.n_saves || (m.saves || []).length || 1, ties = m.n_signature_ties || 1;
      if (m.how === "unsaved-build") { R.hardBlock = true; R.matchLbl = "distinct build"; R.need.push(`its file isn't on disk — capture it: change any part or slider and SAVE (if yours), or apply a DIFFERENT tune then re-apply this one — re-applying the already-active tune writes nothing`); }
      else if (m.how === "no-match") { R.hardBlock = true; R.matchLbl = "no match"; R.need.push(`no save matches your ${m.live_cyl}-cyl engine — capture it: change any part or slider and SAVE (if yours), or apply a DIFFERENT tune then re-apply this one — re-applying the already-active tune writes nothing`); }
      else if (m.how === "gear-matched") { R.matchLbl = "gear-matched"; R.why.push(`identified the equipped build by its live gear ladder (${ties} share this engine + PI)`); }
      else if (m.how === "signature" && ties >= 2) { R.hardBlock = true; R.matchLbl = "ambiguous"; R.need.push(m.ladder_tied ? `these ${ties} builds share IDENTICAL gearing — the ladder cannot separate them: pick the equipped save in the 🪪 drawer (one click resolves it)` : `drive up through the gears — the ladder identifies which of ${ties} builds you're on`); }   // when the ladder RAN and tied, 'drive the gears' is a dead-end ask — the manual pick is THE escape
      else if (m.how === "signature") { R.matchLbl = "signature"; R.why.push(m.live ? "matched to the car you're driving (cylinders + PI)" : "matched to the car you last drove (cylinders + PI) — held while parked"); }   // J20
      else if (m.how === "picked") { R.matchLbl = "pinned"; R.why.push("pinned to a specific saved tune"); }
      else if (n > 1) { R.hardBlock = true; R.matchLbl = "unmatched"; R.need.push(`drive so I can match the equipped build (${n} saved tunes exist), or pick it in the decode panel`); }
      else if (m.live) { R.matchLbl = "single save"; R.why.push("single saved tune for this car — unambiguous, and the live car checks out"); }
      else if (m.live_recent) { R.matchLbl = "single save"; R.why.push("verified on your last run — held while parked"); }   // J20: parking must not demand a re-drive the gate already had
      else { R.matchLbl = "single save"; R.softNoLive = true; R.need.push("drive once — verifies the save matches the car you're in"); }
      R.why.push(`${sm.parts_installed || 0} parts read exact`);
      const exact = sm.sliders_exact != null ? sm.sliders_exact : (sm.sliders_absolute || 0), rel = sm.sliders_relative || 0;
      if (exact > 0) R.why.push(`${exact} slider values exact`);
      if (rel > 0) R.need.push(`calibrate ${rel} %-slider${rel === 1 ? "" : "s"} — 🎯 drawer (baselines used meanwhile)`);
      // UNION input: telemetry cross-checks drive the verdict. Corroborations raise confidence; an open save×telemetry
      // CONFLICT means the decode and the measurements disagree — never confirm on top of that.
      const u = dl.union || {};
      if (u.n_agree) R.why.push(`${u.n_agree} field${u.n_agree > 1 ? "s" : ""} corroborated by telemetry (save × measured agree)`);
      if (u.n_conflict) R.need.push(`resolve ${u.n_conflict} save×telemetry conflict${u.n_conflict > 1 ? "s" : ""} — 🔗 drawer`);
      const topAsk = (u.asks || [])[0];
      if (topAsk && (!u.n_agree || R.hardBlock)) R.need.push(topAsk.text);   // surface the top ask when nothing corroborates OR the gate is hard-blocked (the daemon's corrected escape must reach the card)
      const conf = dl.confidence || 0;
      R.pct = R.hardBlock ? 0 : Math.max(0, Math.round(conf * 100) - 15 * (u.n_conflict || 0));
      R.ready = !R.hardBlock && !R.softNoLive && conf >= 0.6 && !(u.n_conflict || 0);   // identified LIVE + solid decode + no open conflicts → the SYSTEM says "confirm now"
      return R;
    };
    const buildConfirmCard = (cid, bc) => {
      const col = bc.hardBlock ? "#e5414e" : bc.ready ? "#00d27a" : "#e3b341";
      const head = bc.hardBlock ? "⏳ Identifying your build" : bc.noSave ? "📄 No saved tune yet" : bc.ready ? "✅ Build confidently identified" : "⏳ Gathering build data";
      const sub = bc.hardBlock ? "Tuning advice stays locked until I can confidently identify the exact build you're driving — otherwise the numbers would sit on the wrong current values."
        : bc.noSave ? "This car has no saved tune to identify — there are no wrong values to protect against, so you can proceed now: advice will use vetted baselines until you save a tune."
        : bc.ready ? "The decode confidently matches the build you're driving. Confirm to unlock tuning advice grounded in your real current values."
        : "Almost there — I'll light up Confirm the moment the build reads confidently.";
      const whyList = bc.why.length ? `<div class="bcf-list ok">${bc.why.map((w) => `<div>✓ ${w}</div>`).join("")}</div>` : "";
      const needList = bc.need.length ? `<div class="bcf-list need"><div class="bcf-need-h">${bc.hardBlock ? "needed to identify the build:" : "to reach exact advice:"}</div>${bc.need.map((w) => `<div>→ ${w}</div>`).join("")}</div>` : "";
      const btn = bc.hardBlock ? ""
        : bc.ready ? `<button class="bcf-btn go" data-confirmbuild="${esc(cid)}">✓ Confirm build &amp; unlock tuning</button>`
        : bc.noSave ? `<button class="bcf-btn go" data-confirmbuild="${esc(cid)}">✓ Proceed on baselines</button>`
        : `<button class="bcf-btn wait" data-confirmbuild="${esc(cid)}" title="not yet confident — you can confirm anyway, but I'd wait">confirm anyway (not yet confident)</button>`;
      const regr = (() => { try { const rj = JSON.parse(localStorage.getItem("fh6BuildRegressed:" + baseId(cid)) || "null"); return rj && rj.why ? `<p class="why" style="font-size:11px;margin:0 0 7px;color:#e5414e">⬇ previously confirmed — regressed: ${esc(rj.why)}</p>` : ""; } catch (e) { return ""; } })();
      return `<div class="bcf" style="border-color:${col}"><div class="bcf-hd" style="color:${col}">${buildThumb(String(cid).split("|")[0])}<b>${head}</b>${bc.hardBlock ? "" : `<span class="bcf-pct">${bc.pct}% confident</span>`}</div><p class="why" style="font-size:11.5px;margin:2px 0 7px">${sub}</p>${regr}${whyList}${needList}${btn}</div>`;
    };
    // the GATE around course tuning advice: advice is only as good as the build identification behind its current
    // values, so until the build is confirmed the panel shows the confirm card (the SYSTEM says when it's confident —
    // the ✓ button lights green on a clean match + solid decode + zero union conflicts). Recordings skip the gate.
    // STATUS REGRESSION: a confirmation is a claim about prerequisites — when they stop holding, the status must
    // FALL BACK on its own, not linger until a manual re-check. Positive evidence only (identity lost, save gone,
    // ambiguity returned, conflicts opened); offline / loading / parked are NOT evidence and never regress anything.
    const confirmRegressReason = (cached) => {
      if (!cached) return null;
      if (cached.available === false) return "the saved tune file is gone from disk";
      const m = cached.match || {};
      if (m.how === "no-match") return "no saved tune matches the live engine any more";
      if (m.how === "unsaved-build") return "you're in a distinct build whose file is not on disk";
      if (m.how === "signature" && (m.n_signature_ties || 1) >= 2) return `${m.n_signature_ties} builds share this signature — identity is ambiguous again`;
      const nc = ((cached.deliverable || {}).union || {}).n_conflict || 0;
      if (nc) return `${nc} save×telemetry conflict${nc > 1 ? "s" : ""} opened`;
      return null;
    };
    const gatedTuning = (co, s, cid) => {
      if (src !== "live" || !cid) return numericTuningPanel(co, s, cid);
      if (!live.connected) return `<div class="bcf" style="border-color:var(--muted)"><div class="bcf-hd" style="color:var(--muted)"><b>📡 Daemon offline</b></div><p class="why" style="font-size:11.5px;margin:2px 0 0">reconnect to identify the build — tuning advice needs the live decode (a red 'identifying…' here would be wrong: nothing is being identified while offline)</p></div>`;   // audit F23: offline is not an identification failure
      const ord = String(cid).split("|")[0];
      const cached = live.diskCache ? live.diskCache[ord] : null;
      if (cached === undefined && live.connected) fetchDiskTune(+ord);
      if (isBuildConfirmed(cid)) {
        const why = confirmRegressReason(cached);
        let overrode = ""; try { overrode = localStorage.getItem("fh6BuildOKevi:" + baseId(cid)) || ""; } catch (e) {}
        const normWhy = (s) => String(s).replace(/\d+/g, "#");   // '2 conflicts opened' vs '3 conflicts opened' is the SAME standing condition — exact-string compare revived the ping-pong on every count change
        if (why && normWhy(why) !== normWhy(overrode)) {   // regress on NEW evidence only — 'confirm anyway'/'proceed on baselines' explicitly overrode the standing condition
          try { localStorage.removeItem(buildConfirmKey(cid)); localStorage.setItem("fh6BuildRegressed:" + baseId(cid), JSON.stringify({ at: Date.now(), why })); } catch (e) {}
          if (live._regrToast !== baseId(cid)) { live._regrToast = baseId(cid); focusToast("⬇ build confirmation regressed — " + why); }
          return `<div class="bcf" style="border-color:#e5414e"><div class="bcf-hd" style="color:#e5414e"><b>⬇ Confirmation regressed</b></div><p class="why" style="font-size:11.5px;margin:2px 0 0">${esc(why)} — tuning advice is locked again until the build re-verifies.</p></div>` + buildConfirmCard(cid, buildConfidence(cached || null));
        }
        return `<div class="bcf-ok">${buildThumb(String(cid).split("|")[0], null, true)} ✓ build confirmed — advice reads this build's real values<button class="bcf-recheck" data-unconfirmbuild="${esc(cid)}" title="drop the confirmation and re-verify the build identification">↺ re-check</button></div>` + numericTuningPanel(co, s, cid);
      }
      return buildConfirmCard(cid, buildConfidence(cached || null));
    };
    // slim persistent identity row for the COURSE view (audit F22) — the user lives here, but identity lived only in
    // Decode: one line with the car, its verified build, the worn paint, and the confirm state. Details stay in Decode.
    const courseIdRow = (cid) => {
      if (src !== "live" || !cid) return "";
      const ord = String(cid).split("|")[0];
      const cached = live.diskCache ? live.diskCache[ord] : undefined;
      if (cached === undefined && live.connected) fetchDiskTune(+ord);
      if (!cached || !cached.available) return "";
      const m = cached.match || {};
      const curB = (m.builds || []).find((b) => (b.saves || []).some((ts) => String(ts) === String(cached.ts)));
      const lv = curB && curB.livery;
      const thumb = lv && lv.thumb ? `<img class="tl-blvy" src="${liveUrl}/livery-thumb?d=${encodeURIComponent(lv.dir)}" alt="">` : lv ? `<span class="tl-blvy-chip" title="paint-only — no thumbnail exists on disk">🎨 ${esc(lv.name || "base paint")}${lv.source === "guess" ? " ≈" : ""}</span>` : "";
      const verdict = m.how === "gear-matched" ? `<span style="color:#00d27a;font-weight:700">⚙ verified${m.held ? " · held" : ""}</span>`
        : (m.how === "unsaved-build" || m.how === "no-match") ? `<span style="color:#e5414e;font-weight:700">🚧 build file missing</span>`
        : `<span class="why">${esc(m.how || "unverified")}</span>`;
      return `<div class="idm-ribbon" style="border-color:var(--line);margin-bottom:8px">${thumb}<b>${esc(cached.name || "#" + ord)}</b>${curB ? `<span class="why">Build ${esc(curB.label)}${curB.pi != null ? " " + piBadge(null, curB.pi, true) : ""}</span>` : ""}${verdict}${isBuildConfirmed(cid) ? `<span style="color:#00d27a;font-size:11px">✓ confirmed</span>` : ""}<span class="why" style="margin-left:auto;font-size:10px">details → 🧬 Decode</span></div>`;
    };
    const liveCourseDashboard = (co, s) => {
      const p = courseParts(co, s); const tr = co.track || {}; const tu = co.turns || {}; const dr = co.driving || {}; const lapsN = co.laps ? co.laps.total : co.runs; const f = live.frame || {};
      // CAR-AWARE: everything car-specific (references, tuning, feedback) follows the EQUIPPED car; course LEARNING (turns/map/profile) is the track and stays.
      const curCar = (f.on && f.cid) || live.courseCar || (co.cars || [])[0]; const curName = curCar ? (carName({ ordinal: String(curCar).split("|")[0], id: curCar }) || "#" + String(curCar).split("|")[0]) : "";   // paused → stay on the LAST-DRIVEN car, never rescope the gate/advice to co.cars[0] (audit F20)
      const carGrip = dr.car_grip || {}; const analysisReflectsCar = curCar && (carGrip[curCar] != null || (co.cars || []).includes(curCar));
      const carChanged = !!(live.courseCar && curCar && live.courseCar !== curCar);   // set in paintFrame; means the analysis still reflects the previous car
      const ck = courseKnowledge(co); const training = ck.stage === "training"; const turnsN = tu.count || 0;
      try { const pk = "fh6StageSeen:" + co.route_key; const prevSt = localStorage.getItem(pk);   // STATUS REGRESSION is announced, not silent: one toast per downgrade edge
        if (prevSt === "tuning" && ck.stage === "training") focusToast(`⬇ ${p.rn || "course"} regressed to TRAINING — prerequisites no longer fulfilled`);
        if (prevSt !== ck.stage) localStorage.setItem(pk, ck.stage); } catch (e) {}
      const tuneUnlocked = !training && (src !== "live" || !curCar || isBuildConfirmed(curCar));   // J12: the per-turn 🔧 verdicts must agree with the gate — no prescriptions while tuning advice is locked
      const refsOwn = (dr.own_refs_by_car && curCar != null) ? (dr.own_refs_by_car[curCar] || 0) : (analysisReflectsCar ? (dr.own_refs || 0) : 0), refsPred = dr.predicted || 0;   // J17: "refs for this car" counts THIS build's refs — the flat own_refs counted every build's (fallback for pre-J17 analyses)
      const needRefs = Math.max(1, Math.ceil(turnsN * 0.5)); const feedbackReady = ck.mapped && analysisReflectsCar && refsOwn >= needRefs;
      const carBanner = (carChanged || !analysisReflectsCar) && curCar ? `<div class="lab-corner" style="border-left:4px solid var(--warn,#e3b341);background:rgba(227,179,65,.08);margin-bottom:8px" title="The course (turns · map · layout) is kept. This car's references and tuning targets re-gather; geometry × grip predictions fill in meanwhile; the next analysis (~20 s) confirms."><strong style="font-size:13px">🔄 Now ${buildThumb(String(curCar).split("|")[0], null, true)} ${esc(curName)}</strong> <span class="why" style="font-size:11px">course kept · drive ${needRefs} clean turn${needRefs === 1 ? "" : "s"} to re-learn this car</span></div>` : "";
      const tiles = [[esc(p.rn), "course"], [`${lapsN} / ${tr.laps || lapsN}`, "laps · session / on record"], [co.best_lap ? co.best_lap.toFixed(3) : "—", "best lap · session"], [tr.best ? tr.best.best_lap.toFixed(3) : "—", "best lap · track"], [`${turnsN}${tu.possible ? " +" + tu.possible : ""}`, `turns · ${Math.round((tu.track_confidence || tu.confidence || 0) * 100)}% earned`], [`${dr.on_reference || 0}/${dr.compared || 0}`, "turns on reference"], [`${refsOwn}/${turnsN}`, "refs for this car"]];
      const st = (k, ok, t) => `<span class="chip" title="${esc(t)}" style="border-color:${ok ? "#00d27a" : "var(--warn,#e3b341)"};color:${ok ? "#00d27a" : "var(--warn,#e3b341)"}">${ok ? "✓" : "○"} ${k}</span>`;
      const learnPanel = `<div class="lab-corner" style="border-left:4px solid var(--accent2)"><div class="card-row" style="margin-top:0"><strong>📚 Course learning — what we know about this track</strong><span class="chip" style="border-color:var(--accent2);color:var(--accent2);font-weight:700">${ck.pct}%</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;margin:6px 0"><span class="why" style="font-size:10.5px;align-self:center">course progress ↑ in the banner ·</span>${st("references (this car)", turnsN ? refsOwn / turnsN >= 0.5 : false, `${refsOwn}/${turnsN} turns have a reference for THIS car${refsPred ? ` · ${refsPred} predicted from geometry × grip` : ""}`)}</div>
            ${p.track}${p.turns}${p.profile}${p.laps}</div>`;
      const feedPanel = `<div class="lab-corner" style="border-left:4px solid ${feedbackReady ? "var(--accent)" : "var(--muted)"}"><div class="card-row" style="margin-top:0"><strong>🏋 Tuning feedback — this car on this track</strong><span class="chip" style="border-color:${feedbackReady ? "#00d27a" : "var(--warn,#e3b341)"};color:${feedbackReady ? "#00d27a" : "var(--warn,#e3b341)"};font-weight:700">${feedbackReady ? "ACTIVE" : "WARMING UP"}</span></div>
            <p class="why" style="font-size:11px;margin:4px 0 6px">${feedbackReady ? `references exist for ${refsOwn}/${turnsN} turns — the per-turn deltas and slider suggestions below are grounded in this car's own best passes` : `${refsOwn}/${turnsN} turns have a reference for this car — ${Math.max(0, needRefs - refsOwn)} more clean turn${needRefs - refsOwn === 1 ? "" : "s"} needed (geometry × grip predictions fill in meanwhile)`}</p>
            ${gatedTuning(co, s, curCar)}
            <details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px"><b>📊 Diagnosis behind the numbers</b> <span class="why">— per-turn deltas, limiters, phase breakdown</span></summary><div style="margin-top:6px">${p.probes}${p.corners}${p.driving}${p.advice}</div></details></div>`;
      const courseHdr = courseIdentity(p.rn, courseGeoFor(co), { icon: co.is_loop ? "📍" : "🏟", topology: co.is_loop ? "loop" : (co.topology || null), routeKey: co.route_key, mode: co.is_loop ? "loop" : "event", tags: courseTagsRow(co) });
      if (training) return `${courseHdr}${courseIdRow(curCar)}${carBanner}${courseHero(p, co)}<div id="lvCornerScore" style="margin-bottom:8px">${cornerScoreCard()}</div>${courseStageBanner(co, ck)}<div class="lab-tiles" style="margin-bottom:8px">${tiles.map(([v, l]) => `<div class="lab-tile"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
        <div id="lvCornerAnalysis" style="margin-bottom:8px">${cornerAnalysis()}</div>
        ${turnByTurnSection(co, tuneUnlocked)}
        ${speedTracesCard(co, curCar)}
        ${learnPanel}
        <div class="lab-corner" style="border-left:4px solid var(--muted);opacity:.75;font-size:11.5px" title="Tuning feedback is a tuning-stage concern"><b>🏋 Tuning feedback — locked while training.</b> <span class="why">This car's per-turn references (${refsOwn}/${turnsN}) are still being gathered and saved in the background; they become live feedback the moment course knowledge reaches 75%.</span></div>`;
      return `${courseHdr}${courseIdRow(curCar)}${carBanner}${courseHero(p, co)}<div id="lvCornerScore" style="margin-bottom:8px">${cornerScoreCard()}</div>${courseStageBanner(co, ck)}<div class="lab-tiles" style="margin-bottom:8px">${tiles.map(([v, l]) => `<div class="lab-tile"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
        ${turnByTurnSection(co, tuneUnlocked)}
        ${speedTracesCard(co, curCar)}
        <div class="card-grid">${feedPanel}<details class="lab-corner" style="border-left:4px solid var(--accent2)"><summary style="cursor:pointer;font-size:12px"><b>📚 Course learning</b> <span class="chip" style="border-color:var(--accent2);color:var(--accent2)">${ck.pct}%</span> <span class="why">— known course; open for the record, map and turns</span></summary><div style="margin-top:8px">${learnPanel}</div></details></div>`;
    };
    // large ACTIVE-CAR banner — everything car-scoped (course tuning, references, decode) is about THIS car; make it unmissable
    const paintActiveCar = () => { const el = host.querySelector("#lvActiveCar"); if (!el) return; const f = live.frame; const on = f && f.on;
      const cid = on ? f.cid : live.courseCar; const changed = live._carJustChanged && (performance.now() - live._carJustChanged < 6000);
      const key = `${on ? 1 : 0}|${cid || ""}|${changed ? 1 : 0}`; if (el.dataset.k === key) return; el.dataset.k = key;
      if (!cid) { el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border:2px solid var(--muted);border-radius:10px;background:var(--bg2)"><span style="font-size:24px">🚗</span><b style="font-size:16px;color:var(--muted)">No active car</b><span class="why">get in a car and drive — every course / decode reading below is scoped to the active car</span></div>`; return; }
      const nm = (NAMES()[String(f && f.car)] || {}).name || (carName({ ordinal: String(cid).split("|")[0], id: cid })) || "#" + String(cid).split("|")[0];
      const col = changed ? "var(--warn,#e3b341)" : on ? "var(--accent)" : "var(--muted)";
      el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:9px 14px;border:2px solid ${col};border-radius:10px;background:${changed ? "rgba(227,179,65,.10)" : on ? "rgba(0,210,122,.06)" : "var(--bg2)"};box-shadow:inset 6px 0 0 ${col}">
        <span style="font-size:26px">${changed ? "🔄" : "🚗"}</span>
        <div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:800;color:${col};line-height:1.1">${esc(nm)}</div><div class="why" style="font-size:12px">${on ? `${piBadge(f.cls, f.pi, true)} · ${f.drv} · ${f.cyl || ""}cyl${f.on && f.ev ? " · in an event" : ""}` : "parked — last active car"}${(() => { const th = buildThumb(String(cid).split("|")[0], null, true); return th ? ` · ${th}` : ` · <span title="config id ${esc(String(cid))}">build ${String(cid).split("|").slice(0, 4).join("|")}</span>`; })()}</div></div>
        <span class="chip" style="border-color:${col};color:${col};font-weight:700">${changed ? "CAR CHANGED" : on ? "● ACTIVE" : "idle"}</span>
        <span class="why" style="font-size:11px;max-width:260px">course tuning, references &amp; decode below are for THIS car${changed ? " — re-gathering its data" : ""}</span>
      </div>`;
    };
    const paintCourseLive = () => { const el = host.querySelector("#lvCourseLive"); if (!el) return; const f = live.frame || {}; const lo = live.loop; const txt = f.on && f.ev ? `lap ${f.lapn || 1} in progress${f.lapt ? " · " + f.lapt.toFixed(1) + " s" : ""}` : lo && lo.lap ? `loop lap ${lo.lap}${lo.last_s ? " · last " + lo.last_s + " s" : ""}` : f.on ? "free roam — not on the course" : "not driving"; if (el.textContent !== txt) el.textContent = txt; };
    // ---- RECORDING · COURSE: the TRACK INDEX — every course on record with its records and the BEST BUILD that set them ----
    const trackIndex = (s) => {
      const models = (DB.courseModels || []).filter((m) => m && m.route_key); if (!models.length) return "";
      const names = ((DB.routes || {}).routes) || {}; const loc = JSON.parse(localStorage.getItem("fh6Routes") || "{}"); const lbl = (m) => (m.name || (names[m.route_key] || {}).name || (loc[m.route_key] || {}).name || m.route_key);
      const cur = new Set(arr(s, "courses").map((co) => co.route_key));
      const rows = models.slice().sort((a, b) => (b.laps || 0) - (a.laps || 0)).map((m) => { const bl = Object.entries(m.best_laps || {}).map(([cid, v]) => Object.assign({ cid }, v)).sort((a, b) => a.best_lap - b.best_lap); const best = bl[0]; const g = m.geometry || {}; const visits = m.visits || []; const kind = m.route_key.startsWith("loop:") ? "reference loop" : (visits.some((v) => (v.laps || 0) > (v.attempts || 0)) ? "circuit" : "point-to-point"); const sel = atlasPick === m.route_key;
        return `<tr data-atlas-route="${esc(m.route_key)}" style="cursor:pointer;${sel ? "outline:2px solid var(--accent);outline-offset:-2px" : cur.has(m.route_key) ? "background:rgba(0,210,122,.06)" : ""}"><td>${courseIdentMini(lbl(m), g, m.route_key, 22)}${cur.has(m.route_key) ? ` <span class="chip" style="border-color:var(--accent);color:var(--accent)">in this recording</span>` : ""}</td><td>${kind}${(() => { const ct = courseTags(m); return ct && (ct.tags.length || ct.fits.length) ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px">${ct.tags.slice(0, 2).concat(ct.fits.slice(0, 1)).map((t2) => `<span class="chip" style="border-color:${t2.col};color:${t2.col};font-size:9.5px;padding:1px 5px" title="${esc(t2.why)}">${t2.t}</span>`).join("")}</div>` : ""; })()}</td><td>${g.length_m ? (g.length_m / 1000).toFixed(2) + " km" : "—"}</td><td>${(g.turns || []).length || "—"}</td><td>${m.laps || 0}</td><td>${visits.reduce((a, v) => a + (v.attempts || 0), 0)}</td><td>${(m.sessions || []).length}</td><td>${best ? `<b style="color:#00d27a">${best.best_lap.toFixed(3)} s</b>` : "—"}</td><td>${best ? `${buildThumb(String(best.cid).split("|")[0], best.build_id, true)} ${esc(best.name || best.cid)} <span class="why"${best.build_id ? ` title="build fingerprint ${esc(String(best.build_id))}"` : ""}>${piBadge(best.class || null, best.pi || null, true)}${best.drivetrain ? " " + best.drivetrain : ""}${best.hp ? " · " + best.hp + " hp" : ""}</span>` : "—"}</td><td class="why">${(m.sessions || []).slice(-1)[0] ? String((m.sessions || []).slice(-1)[0]).slice(-6) : ""}</td></tr>`; }).join("");
      return `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">📇 Track index — every course on record (${models.length}) · click a track to open it</h3>
        <div style="overflow-x:auto"><table style="font-size:11.5px"><thead><tr><th>track</th><th>type</th><th>length</th><th>turns</th><th>laps</th><th>attempts</th><th>sessions</th><th>record</th><th>best build</th><th>last</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    };
    // ---- RECORDING · DECODE: the BUILD LIBRARY — every config ever captured, its decode status and sheet confidence; pick one as the donor for the bench ----
    let libPick = null;
    const buildLibrary = (s) => {
      const lib = new Map();
      (DB.sessions || []).forEach((ss) => (ss.cars || []).forEach((c) => { const k = c.id; const e = lib.get(k) || { id: k, name: carName(c) || c.name, class: c.class, pi: c.pi, drivetrain: c.drivetrain, cyl: c.cyl, build_ids: new Set(), sessions: [], best: null, roles: new Set() }; e.build_ids.add(c.build_id); e.sessions.push(ss.id); const d = c.decode || {}, cs = c.clone_sheet || {}; const score = (d.pct || 0) + (cs.confidence || 0) / 10; if (!e.best || score > e.best.score) e.best = { score, sid: ss.id, decode: d, sheet: cs, live_s: c.live_s }; (ss.stints || []).forEach((st) => { if (st.id === k && st.role) e.roles.add(st.role); }); lib.set(k, e); }));
      const entries = [...lib.values()].sort((a, b) => (b.best ? b.best.score : 0) - (a.best ? a.best.score : 0));
      if (!entries.length) return "";
      const curIds = new Set((s.cars || []).map((c) => c.id));
      return `<div class="block" style="border-color:#a371f7"><div class="card-row" style="margin-top:0"><h3 style="margin:0">📚 Build library — every config captured so far (${entries.length}) · pick one as the DONOR for the bench below</h3>${libPick ? `<span class="chip" data-lib-clear="1" style="cursor:pointer">✕ clear donor pick</span>` : ""}</div>
        <div style="overflow-x:auto"><table style="font-size:11.5px"><thead><tr><th>car · config</th><th>build</th><th>sessions</th><th>decode</th><th>sheet confidence</th><th>roles</th><th></th></tr></thead><tbody>
        ${entries.map((e) => { const d = e.best && e.best.decode || {}; const cs = e.best && e.best.sheet || {}; const picked = libPick && libPick.key === e.id && libPick.sid === (e.best && e.best.sid); return `<tr style="${picked ? "outline:2px solid #a371f7;outline-offset:-2px" : curIds.has(e.id) ? "background:rgba(0,210,122,.06)" : ""}"><td><b>${esc(e.name || "#" + String(e.id).split("|")[0])}</b> <span class="why">${piBadge(e.class || null, e.pi || null, true)} ${e.drivetrain || ""} ${e.cyl || ""}cyl</span>${curIds.has(e.id) ? ` <span class="chip" style="border-color:var(--accent);color:var(--accent)">in this recording</span>` : ""}</td><td class="why">${[...e.build_ids].filter(Boolean).join(", ") || "—"}</td><td>${e.sessions.length}</td><td>${d.total ? `<span style="color:${d.pct >= 1 ? "#00d27a" : "var(--warn,#e3b341)"}">${d.ready_n}/${d.total}</span>` : "—"}</td><td>${cs.confidence != null ? `<div style="display:flex;align-items:center;gap:6px"><div class="lab-bar" style="width:60px;height:6px"><i style="width:${cs.confidence * 100}%;background:${confCol(cs.confidence)}"></i></div><b style="color:${confCol(cs.confidence)}">${Math.round(cs.confidence * 100)}%</b>${cs.complete ? ` <span class="chip" style="border-color:#00d27a;color:#00d27a">complete</span>` : ""}${cs.components ? ` <span class="chip" style="border-color:#a371f7;color:#a371f7">components</span>` : ""}</div>` : "—"}</td><td>${[...e.roles].map((r) => r === "donor" ? "🎯" : "🔧").join(" ") || ""}</td><td>${e.best ? `<span class="chip" data-lib-pick="${esc(e.best.sid)}|${esc(e.id)}" style="cursor:pointer;border-color:#a371f7;color:#a371f7">use as donor (from ${String(e.best.sid).slice(-6)})</span>` : ""}</td></tr>`; }).join("")}
        </tbody></table></div><p class="why" style="font-size:10.5px;margin:6px 0 0">the library is built from every recording; 'use as donor' loads that config's best capture into the DONOR side so any run in this recording can be converged against it — that is what Recording · Decode is for</p></div>`;
    };
    function courseSection(s, isLive) {
      if (!s) return isLive ? EMPTY_LIVE : NOSESS;
      const allCourses = arr(s, "courses");   // no car filter here — the car rail belongs to Free Tuning; a course card already names its cars
      // the atlas selection drives the details: only the selected course is shown (from this session, or from its track record if not visited here)
      const selModel = atlasPick ? (DB.courseModels || []).find((m) => m && m.route_key === atlasPick) : null;
      const courses = atlasPick ? allCourses.filter((co) => co.route_key === atlasPick) : allCourses;
      const selBar = atlasPick ? `<div class="card-row" style="margin:0 0 8px"><span class="chip" style="border-color:var(--accent);color:var(--accent)">showing ${courseIdentMini((selModel && selModel.name) || null, selModel && selModel.geometry, atlasPick, 18)} from the atlas${courses.length ? "" : " — its track record"}</span><span class="chip" data-atlas-clear="1" style="cursor:pointer">✕ show all ${allCourses.length} course${allCourses.length === 1 ? "" : "s"}</span></div>` : "";
      const lead = isLive ? "" : `${routesAtlas(s)}${trackIndex(s)}`;
      if (isLive) return `${courses.length ? courses.map((co) => { const _ck = courseKnowledge(co); const _tr = _ck.stage === "training"; const _col = _tr ? "var(--accent2)" : "var(--accent)"; const _bg = _tr ? "rgba(47,129,247,.07)" : "rgba(0,210,122,.07)"; return `<div class="block" style="border:2px solid ${_col};box-shadow:inset 6px 0 0 ${_col};background:${_bg}"><h3 style="margin-top:0;display:flex;align-items:center;gap:8px;font-size:17px"><span style="font-size:22px">${_tr ? "📚" : "🏋"}</span><span style="color:${_col}">${_tr ? "COURSE LEARNING" : "COURSE TUNING"}</span><span class="why" style="font-weight:400;font-size:12px">${_tr ? `— learning the course · switches to tuning at 75%` : `— the course is known · feedback for this car`}</span><span style="margin-left:auto">${analysisAgeChip()}</span></h3>${selBar}${liveCourseDashboard(co, s)}</div>`; }).join("") : atlasPick && selModel ? `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🏟 Course — from the track record</h3>${selBar}<div class="card-grid">${modelCourseCard(selModel)}</div></div>` : `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏟 Course dashboard</h3><div class="lab-corner" style="border-left:4px solid var(--accent2);background:var(--bg2)"><div class="card-row" style="margin-top:0"><strong style="font-size:15px">📚 COURSE TRAINING <span class="why" style="font-weight:400">· no course identified yet</span></strong><span id="lvCourseLive" class="chip"></span></div><div style="font-size:13px;margin:4px 0 2px"><b>▶ NEXT for the course:</b> complete the first attempt / loop lap — the course appears (and is matched against the database) when it finishes</div><p class="why" style="font-size:10.5px;margin:5px 0 0">timed event (Rivals · race · time trial) or a marked reference loop (📍 in the stream bar). Everything outside those windows is Free Tuning.</p></div><div id="lvCornerAnalysis" style="margin-top:8px">${cornerAnalysis()}</div></div>`}${eventsTable(s)}${routesAtlas(s)}`;
      return `${lead}${courses.length ? `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏟 Course — per route: what it demands, every turn quantified & classified, lap deltas per run, course-weighted suggestions</h3>${selBar}<div class="card-grid">${courses.map((co) => courseBlock(co, s)).join("")}</div></div>` : atlasPick && selModel ? `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🏟 Course — from the track record</h3>${selBar}<div class="card-grid">${modelCourseCard(selModel)}</div></div>`
        : `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏟 Course — nothing scoped yet</h3><p class="why" style="font-size:12px;margin:0">A course appears when you run a timed event (Rivals · race · time trial) or lap a marked reference loop${isLive ? " — mark one with 📍 in the stream bar above (the control lives on this Course tab) and drive back through the start" : ""}. Everything outside those windows is Free Tuning.</p></div>`}
        ${eventsTable(s)}`;
    }
    // 🛣 FREE TUNING — whole-session advisor, runs, test cards, gear & dyno (recordings also get the strip + corner cards; live paints those as instruments)
    // ---- GENERAL / ALL-AROUND tuning: the inverse of course tuning. Weights diagnoses by BREADTH
    // (how consistently a problem shows across every context the build has driven — corner-type x surface),
    // so it recommends changes that help across the board for public / Horizon Open play, never overfit to one track.
    const BIAS_COL = { understeer: "#2f81f7", oversteer: "#e5414e", neutral: "#00d27a" };
    const generalTuningPanel = (c, s) => {
      if (!c) return "";
      const g = c.general, adv = c.advice || [], cid = c.id;
      if (live.connected) { const o0 = String(cid).split("|")[0]; if (!(live.diskTune && live.diskTune[o0])) fetchDiskTune(+o0); }   // pull current values for THIS car (not just the active frame)
      const sig = (g && g.balance) || [];
      if (!g || g.corners < 4 || sig.length === 0) return `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🛣 All-around tune — ${esc(carName(c) || "#" + c.ordinal)}</h3><p class="why" style="font-size:12px;margin:0">Gathering — drive varied corners (and surfaces) on public / free-roam; the all-around read needs a spread of contexts, not one track.</p></div>`;
      const moves = tuningMoves(adv, [], getTune(cid), "breadth");
      live.lastMoves = live.lastMoves || {}; if (cid) live.lastMoves[cid] = moves;   // cache for the anchored dock iteration panel
      const rob = g.robustness;
      const robCol = rob == null ? "var(--muted)" : rob >= 0.6 ? "#00d27a" : rob >= 0.35 ? "#e3b341" : "#e5414e";
      // balance signature matrix — the diagnostic: how the car handles across every context, so surface/speed specificity shows through
      const matrix = `<div style="overflow-x:auto"><table style="font-size:11.5px"><thead><tr><th>context</th><th>corners</th><th>balance (USI)</th><th>first red</th><th></th></tr></thead><tbody>
        ${sig.map((r) => `<tr><td><b>${r.type}</b> <span class="why">· ${r.surface}</span></td><td>${r.n}</td><td style="color:${BIAS_COL[r.bias]};font-weight:700">${r.usi > 0 ? "+" : ""}${r.usi.toFixed(3)}</td><td>${r.axle === "none" ? `<span style="color:#00d27a">clean</span>` : `<span style="color:${r.axle === "front" ? "#2f81f7" : "#e5414e"}">${r.axle}</span>`}</td><td><span class="chip" style="border-color:${BIAS_COL[r.bias]};color:${BIAS_COL[r.bias]}">${r.bias}</span></td></tr>`).join("")}
        </tbody></table></div>`;
      const splitFlag = g.surface_split ? `<div style="margin:8px 0;padding:6px 10px;border:1px solid #e3b341;border-radius:8px;font-size:11.5px"><b style="color:#e3b341">⚠ Surface-specific:</b> balance swings by surface — USI ${g.surface_split.smooth > 0 ? "+" : ""}${g.surface_split.smooth} on road vs ${g.surface_split.rough > 0 ? "+" : ""}${g.surface_split.rough} on rough. No single tune wins both; this all-around read favours where you drive most — tune a separate setup for the other surface.</div>` : "";
      const arrow = (m) => m.delta > 0 ? "▲" : "▼"; const col = (m) => m.dir > 0 ? "#e3b341" : "#2f81f7";
      const movesTbl = abPanel(cid) + appliedStrip(cid, moves) + movesCards(moves, c.drivetrain || (["FWD", "RWD", "AWD"][+String(c.id).split("|")[1]] || null), cid);
      const ovr = sig.filter((r) => r.bias === "oversteer").length, und = sig.filter((r) => r.bias === "understeer").length;
      const rideMove = moves.some((m) => m.sl === "rheight" || m.sl === "fheight");
      const verdict = !moves.length ? "Balanced across the board — no systematic change stands out yet" :
        `${ovr > und ? "Leans oversteer" : und > ovr ? "Leans understeer" : "Mixed balance"} across your contexts — <b>${moves.length} move${moves.length > 1 ? "s" : ""}</b> to make it more neutral & robust${rideMove ? " (incl. ride height — it's bottoming)" : ""}`;
      return `<div class="block" style="border-color:var(--accent)"><div class="card-row" style="margin-top:0"><h3 style="margin:0">🛣 All-around tune — ${esc(carName(c) || "#" + c.ordinal)} <span class="why">· for public / Horizon Open</span></h3><span class="chip" style="border-color:${robCol};color:${robCol};font-weight:700" title="how consistent the car's balance is across every context — high = predictable all-rounder">consistency ${rob == null ? "—" : Math.round(rob * 100) + "%"}</span> <span class="chip">${g.corners} corners · ${g.buckets} contexts${g.surfaces.length > 1 ? " · " + g.surfaces.join("+") : ""}</span></div>
        <div style="font-size:13px;font-weight:600;margin:7px 0 9px;color:var(--txt)">${verdict}</div>
        ${movesTbl}
        <details style="margin-top:10px"><summary style="cursor:pointer;font-size:11.5px;color:var(--muted)"><b>▸ Why these moves</b> — balance across every context (blue = understeer · red = oversteer · green = neutral)</summary><div style="margin-top:6px">${matrix}${splitFlag}<p class="why" style="font-size:10.5px;margin:6px 0 0">Weighs each fix by how <b>broadly</b> it helps — a problem in every context gets a full move; one that only shows in some contexts is a balance issue, not a blanket change (that's the course lane's job).</p></div></details>
        ${tuneInputRow(cid)}</div>`;
    };
    function freeSection(s, isLive) {
      if (!s) return isLive ? EMPTY_LIVE : NOSESS;
      const cars = arr(s, "cars"), corners = arr(s, "corners"), launches = arr(s, "launches"), braking = arr(s, "braking"), pulses = arr(s, "pulses"), stints = arr(s, "stints");
      const cs = carSel ? corners.filter((c) => c.car === carSel) : corners; const real = cs.filter((c) => !c.drift); const sm = s.summary || {};
      const tiles = isLive ? "" : `<div class="lab-tiles">${[[s.rate_pps, "pkt/s"], [cars.length, "cars"], [corners.length, "corners"], [sm.front_limited_corners, "front-limited"], [sm.rear_limited_corners, "rear-limited"], [sm.drift_corners, "drifts"], [launches.length, "launches"], [braking.length, "brake events"], [sm.impacts, "impacts"]].map(([v, l]) => `<div class="lab-tile"><b>${v ?? "—"}</b><span>${l}</span></div>`).join("")}</div>`;
      const rail = `<div class="lab-rail"><span class="chip ${carSel == null ? "on" : ""}" data-car="all">all cars</span>${cars.map((c) => `<span class="chip ${carSel === c.id ? "on" : ""}" data-car="${c.id}" style="border-color:${carCol(s, c.id)}">${carLblHtml(s, c.id)}</span>`).join("")}</div>`;
      const launchCharts = launches.filter((l) => !carSel || l.car === carSel).slice(0, 4).map((l) => `<div class="car-card" style="cursor:default"><h3 style="font-size:13px;margin:0 0 4px">🚦 Launch @ ${l.t}s · ${carLblHtml(s, l.car)}</h3>
        <p class="why" style="font-size:11px;margin:0 0 4px">0-60 <b>${l.zero60_s ?? "—"} s</b> · peak rear slip <b style="color:${l.peak_slip_rear > 1 ? "#e5414e" : "inherit"}">${l.peak_slip_rear}</b> · front ${l.peak_slip_front}</p>
        ${chart([{ pts: l.trace.map((p) => [p[0], Math.abs(p[3])]), col: "#e5414e", label: "RL slip" }, { pts: l.trace.map((p) => [p[0], Math.abs(p[4])]), col: "#f0883e", label: "RR slip" }, { pts: l.trace.map((p) => [p[0], Math.abs(p[1])]), col: "#2f81f7", label: "FL slip" }], { xl: "s", yl: "slip ratio", hline: 1, hlabel: "limit", ymax: Math.min(8, Math.max(1.5, l.peak_slip_rear * 1.1)) })}</div>`).join("");
      const brakeRows = braking.filter((b) => !carSel || b.car === carSel).map((b) => `<tr><td>${b.t}s</td><td>${carLblHtml(s, b.car)}</td><td>${b.mph_start}→${b.mph_end}</td><td>${b.decel_g_peak} g</td>
        <td><div class="lab-bar" style="width:90px;display:inline-block;vertical-align:middle"><i style="width:${Math.min(100, b.front_deficit * 100)}%;background:#2f81f7"></i></div> ${b.front_deficit}</td>
        <td><div class="lab-bar" style="width:90px;display:inline-block;vertical-align:middle"><i style="width:${Math.min(100, b.rear_deficit * 100)}%;background:#e5414e"></i></div> ${b.rear_deficit}</td>
        <td>${b.lock === "none" ? `<span class="chip">no lock</span>` : `<span class="chip" style="border-color:#e5414e;color:#e5414e">${b.lock} lock</span>`}</td></tr>`).join("");
      const gearCards = cars.filter((c) => !carSel || c.id === carSel).map((c) => `<div class="car-card" style="cursor:default;border-left:4px solid ${carCol(s, c.id)}"><h3 style="font-size:13px;margin:0 0 4px">⚙️ ${carLblHtml(s, c.id)} <span class="chip">${c.live_s ?? "—"}s</span></h3>${nameUI(c)}${sigChips(c)}
        <div style="display:flex;gap:12px;flex-wrap:wrap"><table style="font-size:11px"><thead><tr><th>gear</th><th>m/s per krpm</th><th>vs 1st</th></tr></thead><tbody>${(c.gears || []).map((g) => `<tr><td>${g.gear}</td><td>${g.mps_per_krpm}</td><td>${g.rel}</td></tr>`).join("")}</tbody></table>
        <div>${chart([{ pts: (c.dyno || []).map((d) => [d.rpm, d.hp]), col: "#e3b341", label: "hp" }, { pts: (c.dyno || []).map((d) => [d.rpm, d.tq]), col: "#e83c9e", label: "ft·lb" }], { w: 260, h: 120, xl: "rpm (WOT frames)", yl: "" })}</div></div>
        <p class="why" style="font-size:10.5px;margin:4px 0 0">tire temp max °F: ${Object.entries(c.temps_max_f || {}).map(([w, v]) => `${w} ${v}`).join(" · ") || "—"}</p></div>`).join("");
      const pulsesByCar = cars.map((c) => { const p = pulses.filter((x) => x.car === c.id && x.decay_s != null).map((x) => x.decay_s).sort((a, b) => a - b); return p.length ? `${carLblHtml(s, c.id)}: median decay <b>${p[Math.floor(p.length / 2)].toFixed(2)} s</b> (${p.length} pulses)` : null; }).filter(Boolean);
      const adviceCars = cars.filter((c) => c.coverage && (!carSel || c.id === carSel));
      const genCar = (isLive && live.frame && live.frame.on && cars.find((c) => c.id === live.frame.cid)) || (isLive && live.courseCar && cars.find((c) => c.id === live.courseCar)) || (carSel && cars.find((c) => c.id === carSel)) || adviceCars[0] || cars[0];   // in a menu, stay on the car you last drove
      return `${genCar ? generalTuningPanel(genCar, s) : ""}${tiles}
        ${adviceCars.length ? `<details class="block" style="border-color:var(--accent)"><summary style="cursor:pointer;font-weight:600;font-size:14px">🎯 Confidence &amp; suggestions — whole session, per car${sm.corners != null ? ` <span class="chip">${sm.corners} corners · ${sm.launches} launches · ${sm.braking} stops</span>` : ""}${isLive ? ` ${analysisAgeChip()}` : ""}</summary><div class="card-grid" style="margin-top:8px">${adviceCars.map((c) => adviceBlock(c, s)).join("")}</div></details>` : `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🎯 Confidence & suggestions</h3><p class="why" style="font-size:12px;margin:0">${isLive ? "first analysis after ~20 s of driving (longer once the session file grows)…" : "no analysed cars in this recording"}</p></div>`}
        ${stints.length ? `<details class="block"><summary style="cursor:pointer;font-weight:600;font-size:14px">🏁 Runs — the A/B re-tune ledger</summary>
          <div style="overflow-x:auto"><table><thead><tr><th>run</th><th>car</th><th>window</th><th>label</th><th>role</th><th>corners</th><th>USI med</th><th>front-red</th><th>brake F/R</th><th>launch slip</th><th>ladder</th></tr></thead><tbody>
            ${stints.map((st) => `<tr style="border-left:3px solid ${carCol(s, st.id)}"><td><b>${st.n}</b></td><td>${carLblHtml(s, st.id, true)}</td><td>${st.t0}–${st.t1}s (${st.live_s}s)</td><td>${st.label ? `<b>${esc(st.label)}</b>` : `<span class="why">—</span>`}</td><td>${st.role === "donor" ? `<span class="chip" style="border-color:#e3b341;color:#e3b341">🎯 DONOR</span>` : st.role === "replica" ? `<span class="chip" style="border-color:#00d27a;color:#00d27a">🔧 REPLICA</span>` : ""}</td><td>${st.corners ?? "—"}</td><td>${st.usi_med == null ? "—" : (st.usi_med > 0 ? "+" : "") + st.usi_med.toFixed(3)}</td><td>${st.first_red_front ?? "—"}/${st.corners ?? "—"}</td><td>${st.brake_fd_med == null ? "—" : `${st.brake_fd_med.toFixed(2)}/${(st.brake_rd_med ?? 0).toFixed(2)}`}</td><td>${st.launch_rear_slip == null ? "—" : st.launch_rear_slip.toFixed(2)}</td><td title="${esc(JSON.stringify(st.ladder || {}))}">${Object.keys(st.ladder || {}).length ? (st.ladder_changed === true ? `<span class="chip" style="border-color:#e3b341;color:#e3b341">gearing changed</span>` : st.ladder_changed === false ? `<span class="chip">same gearing</span>` : `<span class="chip">first / n-a</span>`) : "—"}</td></tr>`).join("")}
          </tbody></table></div><p class="why" style="font-size:11px;margin-top:6px">Same car + same parts + new sliders looks identical in the packet header — the RUN is the unit. In Course mode every menu gap starts a run; in Decode / Free only a build change, an event edge, or ➕ new run does.</p></details>` : ""}
        ${isLive ? "" : `<div class="block"><h3 style="margin-top:0">📼 Session strip — ${s.id}</h3>${arr(s, "strip").length ? strip(s) : `<p class="why" style="font-size:11px">no strip in this recording</p>`}
          ${rail}
          <p class="why" style="font-size:11px">${arr(s, "zero_windows").length} not-driving windows · ${arr(s, "impacts").length} impact frames discarded · hover any second for numbers.</p></div>
        <div class="block" style="border-color:#e5414e"><h3 style="margin-top:0">🩺 Corners — first red ring, by phase</h3>
          <p class="why" style="font-size:12px">${real.length} grip corners (${cs.length - real.length} drifts hidden from diagnosis): front-limited <b>${real.filter((c) => c.first_red && c.first_red.axle === "front").length}</b> · rear-limited <b>${real.filter((c) => c.first_red && c.first_red.axle === "rear").length}</b> · clean <b>${real.filter((c) => !c.first_red).length}</b></p>
          <div class="card-grid">${cs.slice(0, 24).map((c) => cornerCard(s, c)).join("")}</div>${cs.length > 24 ? `<p class="why" style="font-size:11px">+${cs.length - 24} more</p>` : ""}</div>`}
        <details class="block"><summary style="cursor:pointer;font-weight:600;font-size:14px">🧪 Test cards — launches · braking · gearing · dyno</summary>${isLive ? rail : ""}
          <div class="card-grid" style="margin-top:8px">${launchCharts || `<p class="why" style="font-size:11px">no standing launches yet</p>`}</div>
          <h3 style="font-size:14px">🛑 Braking events — wheel-speed deficit (lock detector)</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>t</th><th>car</th><th>mph</th><th>decel</th><th>front deficit</th><th>rear deficit</th><th>verdict</th></tr></thead><tbody>${brakeRows || `<tr><td colspan="7" class="why">none</td></tr>`}</tbody></table></div>
          <div class="card-grid" style="margin-top:10px">${gearCards}</div>
          <p class="why" style="font-size:11px;margin-top:8px">🪃 Wiggle (yaw decay after a steering pulse, experimental): ${pulsesByCar.join(" · ") || "no pulses detected"}. 🛏 Bottoming events: <b>${sm.bottoming ?? "—"}</b>.</p></details>
        <details class="block" style="border-color:var(--warn,#e3b341)"><summary style="cursor:pointer;font-weight:600;font-size:14px">📎 HUD clips — the two things the stream can't carry</summary>
          <div class="card-grid"><div class="lab-slot"><img src="assets/telemetry/tires-misc.jpg" alt="">Tires, Misc. — hot pressures → cold = hot − 3.5 psi · live camber</div><div class="lab-slot"><img src="assets/telemetry/heat.jpg" alt="">Heat — inner / middle / outer → camber verdict</div></div></details>`;
    }
    // ---- DECODE mode primitives: progress = test completeness ONLY; deliverable = the shop-standardized clone sheet ----
    const STATCHIP = { measured: ["✅ measured", "#00d27a"], inferred: ["🟡 inferred", "#e3b341"], shop: ["🔍 shop check", "#2f81f7"], verified: ["✅ verified", "#00d27a"], consistent: ["✓ consistent", "#2f81f7"], captured: ["📷 captured", "#a371f7"], contradicted: ["⚠ contradicted", "#e5414e"] };
    const decodePanel = (c, roleLbl) => {
      const d = c.decode; if (!d) return "";
      const col = d.pct >= 1 ? "#00d27a" : d.pct >= 0.6 ? "#e3b341" : "#e5414e";
      return `<div class="card-row" style="margin-top:0"><strong>🧬 Decode progress — ${roleLbl || ""}${esc(carName(c) || "#" + c.ordinal)}</strong><span class="chip" style="border-color:${col};color:${col}">${d.pct >= 1 ? "ALL TESTS CAPTURED" : d.ready_n + "/" + d.total + " tests"}</span></div>
        <div class="lab-bar" style="height:8px;margin:6px 0"><i style="width:${d.pct * 100}%;background:${col}"></i></div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${d.tests.map((t) => `<span class="chip" title="${esc(t.why)} — unlocks: ${t.unlocks.join(", ")}" style="border-color:${t.ok ? "#00d27a" : "var(--warn,#e3b341)"};color:${t.ok ? "#00d27a" : "var(--warn,#e3b341)"}">${t.ok ? "✓" : "○"} ${t.label} ${t.have}/${t.need}</span>`).join("")}</div>
        ${d.missing.length ? `<p class="why" style="font-size:10.5px;margin:5px 0 0">to finish the clone capture: ${d.tests.filter((t) => !t.ok).map((t) => `<b>${t.label}</b> ${t.have}/${t.need}${t.why.includes(" — ") ? ` <span style="color:var(--warn,#e3b341)">(${esc(t.why.split(" — ").slice(1).join(" — "))})</span>` : ""}`).join(" · ")} — anywhere, any road; only these tests gate the sheet</p>` : `<p class="why" style="font-size:10.5px;margin:5px 0 0;color:#00d27a">battery complete — the clone sheet is fully unlocked</p>`}`;
    };
    const confCol = (v) => (v >= 0.8 ? "#00d27a" : v >= 0.6 ? "#e3b341" : "#e5414e");
    // the DELIVERABLE: every row = what to install / match + a confidence EARNED from independent, consistent measurements (+ what to drive to raise it)
    // ---- SHOP CAPTURE: the daemon serves your in-game screenshots; fill the 'shop check' fields (widths, compound, aero…) while viewing them, saved to the build record ----
    const SHOP_CAPTURE = [
      { group: "My Cars pane", pane: true, fields: [["pi", "PI"], ["power_hp", "Power (hp)"], ["torque_lbft", "Torque (lb-ft)"], ["weight_lb", "Weight (lb)"], ["front_pct", "Front %"], ["compound", "Compound"], ["suspension", "Suspension"], ["displacement_l", "Displacement (L)"]] },
      { group: "Tires & Rims", menu: "Tires & Rims", fields: [["Tire compound"], ["Front tire width"], ["Rear tire width"], ["Rim style"], ["Front track width"], ["Rear track width"]] },
      { group: "Aero & Appearance", menu: "Aero & Appearance", fields: [["Front bumper / splitter"], ["Rear wing"], ["Other body parts"]] },
      { group: "Conversions", menu: "Conversions", fields: [["Body kit"]] },
    ];
    let shotEnlarged = null;
    const refreshShots = () => { fetch(liveUrl + "/shots?n=24").then((r) => r.json()).then((d) => { live.shots = d.shots || []; live.shotsDirs = d.dirs || []; const el = host.querySelector("#lvShopCapture"); if (el && el.dataset.cid) el.innerHTML = shopCaptureInner(el.dataset.cid); bindBody(host.querySelector("#lvShopCapture") || host); }).catch(() => {}); };
    const savedVal = (rec, group, slot, paneKey) => { if (!rec) return null; if (paneKey) return (rec.pane || {})[paneKey]; const items = (rec.parts || {})[group] || []; const row = items.find((it) => it.slot === slot); return row ? row.installed : null; };
    const buildRecordFor = (cid) => (DB.builds || (window.__builds ||= {}))[cid] || (arr(S(), "cars").find((c) => c.id === cid) || {}).build_record || null;
    const shopCaptureInner = (cid) => {
      const rec = (live.session && (arr(S(), "cars").find((c) => c.id === cid) || {}).build_record) || null;
      const shots = live.shots || []; const now = Date.now() / 1000; const recent = shots.filter((s) => now - s.mtime < 3600).length;
      const gallery = shots.length ? `<div style="display:flex;gap:6px;overflow-x:auto;padding:2px 0">${shots.slice(0, 16).map((s) => `<img data-shot="${esc(s.url)}" src="${liveUrl}${esc(s.url)}" title="${esc(s.id)}" style="height:70px;border-radius:6px;border:1px solid var(--line);cursor:pointer;flex:0 0 auto">`).join("")}</div>${shotEnlarged ? `<div style="margin:6px 0"><img src="${liveUrl}${esc(shotEnlarged)}" style="max-width:100%;max-height:420px;border-radius:8px;border:1px solid var(--accent2)"> <span class="chip" data-shot-close="1" style="cursor:pointer">✕ close</span></div>` : ""}`
        : `<p class="why" style="font-size:11px">No screenshots found in ${(live.shotsDirs || []).map((d) => `<code>${esc(d.split(/[\\/]/).slice(-2).join("/"))}</code>`).join(", ") || "the watched folders"}. Take an in-game screenshot (Xbox Game Bar <b>Win+Alt+PrtScn</b>, or your ShareX hotkey) and press ↻.</p>`;
      const form = SHOP_CAPTURE.map((g) => `<div style="margin-top:8px"><div style="font-size:11px;font-weight:700;color:var(--accent2)">${g.group}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 10px;margin-top:3px">${g.fields.map(([slot, label]) => { const val = savedVal(rec, g.group, slot, g.pane ? slot : null) ?? ""; return `<label style="font-size:11px;display:flex;justify-content:space-between;align-items:center;gap:5px">${label || slot}<input data-shopcid="${esc(cid)}" data-shoppane="${g.pane ? slot : ""}" data-shopmenu="${g.pane ? "" : esc(g.menu)}" data-shopslot="${g.pane ? "" : esc(slot)}" value="${esc(String(val))}" placeholder="from the shot" style="width:88px;padding:2px 5px;border-radius:4px;border:1px solid ${val ? "#00d27a" : "var(--line)"};background:var(--bg2);color:var(--txt);font-size:11px"></label>`; }).join("")}</div></div>`).join("");
      return `<div class="card-row" style="margin-top:0"><strong style="font-size:13px">📸 Shop capture — fill the 🔍 shop-check data from screenshots</strong><span><span class="chip" title="${recent} shot(s) in the last hour">${shots.length} shots</span> <button class="lab-mode" id="lvShotRefresh" style="padding:2px 8px;font-size:11px">↻ refresh</button></span></div>
        <p class="why" style="font-size:10.5px;margin:2px 0 6px">Open the in-game <b>upgrade shop</b> / <b>My Cars pane</b> / <b>tune tabs</b>, screenshot each (Win+Alt+PrtScn), press ↻, click a thumbnail to enlarge, then type the values below — saved straight to this car's build record; the Clone Sheet's 🔍 rows turn ✅.</p>
        ${gallery}${form}`;
    };
    const shopCapture = (cid) => cid ? `<div class="block" style="border-color:var(--accent2)"><div id="lvShopCapture" data-cid="${esc(cid)}">${shopCaptureInner(cid)}</div></div>` : "";
    const cloneSheetHtml = (c) => {
      const cs = c.clone_sheet; if (!cs) return "";
      const gateLbl = Object.fromEntries((c.decode ? c.decode.tests : []).map((t) => [t.key, t.label]));
      const oc = cs.confidence != null ? confCol(cs.confidence) : "var(--muted)"; const weak = cs.weak || [];
      return `<div class="card-row" style="margin-top:0"><h3 style="margin:0">📋 Clone sheet — ${esc(carName(c) || "#" + c.ordinal)}${cs.complete ? ` <span class="chip" style="border-color:#00d27a;color:#00d27a">capture complete — this is the deliverable</span>` : ""}</h3>${cs.confidence != null ? `<span class="chip" style="border-color:${oc};color:${oc};font-weight:700;font-size:13px">clone confidence ${Math.round(cs.confidence * 100)}%</span>` : ""}</div>
        <div class="lab-bar" style="height:8px;margin:6px 0"><i style="width:${(cs.confidence || 0) * 100}%;background:${oc}"></i></div>
        ${cs.components ? `<p class="why" style="font-size:11px;margin:2px 0 6px">📷 <b>Individual components from the donor car's own shop</b> (${esc((cs.build_record || {}).label || "build record")} · captured ${esc((cs.build_record || {}).captured || "")}) — each verified against the stream where it can be: ✅ verified · ✓ consistent · 📷 captured (stream can't see it) · ⚠ contradicted. ${Object.entries(cs.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}.</p>`
          : `<div style="margin:0 0 8px;padding:8px 10px;border:1px dashed var(--accent2);border-radius:8px;font-size:11px"><b>📷 Individual components need the donor car's own shop — the stream can't name parts (many stacks give the same outputs).</b> Capture once: <b>Upgrade shop</b> → each category with its INSTALLED tiles (Conversions · Engine · Platform & Handling · Drivetrain · Tires & Rims · Aero & Appearance) · the <b>My Cars stats pane</b> (PI · power · torque · weight · compound · suspension · front %) · the <b>tune menu tab row</b> (which tabs exist). Drop the screenshots in chat → transcribed into <code>data/builds/</code> → every part appears here, verified against the stream (gear count · boost · drivetrain · engine · exact PI · hp/tq).</div>`}
        <p class="why" style="font-size:11px;margin:2px 0 6px">${cs.components ? "" : `✅ ${cs.counts.measured} measured · 🟡 ${cs.counts.inferred} inferred (assumptions) · 🔍 ${cs.counts.shop} shop checks · ⏳ ${cs.counts.pending} pending — `}each row's confidence comes from how many independent measurements back it and how consistent they are, never from one reading. ${esc(cs.pi_note)}</p>
        ${weak.length ? `<div style="margin:0 0 8px;padding:6px 10px;border:1px solid var(--warn,#e3b341);border-radius:8px;font-size:11px"><b style="color:var(--warn,#e3b341)">⚠ ${weak.length} measured row${weak.length === 1 ? "" : "s"} under 70 % — don't trust yet:</b> ${weak.map((w) => `<span class="chip" style="border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)">${esc(w.item)} ${Math.round(w.confidence * 100)}%</span> <span class="why">↑ ${esc(w.needs || "")}</span>`).join(" · ")}</div>` : (cs.complete ? `<p class="why" style="font-size:11px;margin:0 0 8px;color:#00d27a">every measured row is backed by repeated, consistent measurements</p>` : "")}
        <div style="overflow-x:auto"><table style="font-size:11.5px"><thead><tr><th style="max-width:72px">shop menu</th><th>part</th><th>install / match</th><th>status</th><th style="min-width:110px">confidence · evidence</th><th style="min-width:110px">how / why</th></tr></thead><tbody>
        ${cs.menus.map((m) => m.items.map((it, i) => { const sc = STATCHIP[it.status] || ["?", "var(--muted)"]; const cv = it.confidence; const cc = cv == null ? null : confCol(cv); return `<tr>${i === 0 ? `<td rowspan="${m.items.length}" style="font-weight:700;color:var(--accent2);font-size:10px;max-width:72px">${m.menu}</td>` : ""}<td style="white-space:nowrap">${it.item}</td><td>${it.pending ? `<span style="color:var(--muted)">⏳ pending — needs <b>${gateLbl[it.gate] || it.gate}</b></span>` : (it.value != null ? `<b>${esc(String(it.value))}</b>` : `<span style="color:var(--muted)">—</span>`)}</td><td style="white-space:nowrap"><span class="chip" style="border-color:${sc[1]};color:${sc[1]}">${sc[0]}</span></td><td>${cv == null ? `<span class="why" style="font-size:10.5px">— verify in shop</span>` : `<div style="display:flex;align-items:center;gap:6px"><div class="lab-bar" style="width:60px;height:6px"><i style="width:${cv * 100}%;background:${cc}"></i></div><b style="color:${cc};font-size:11px">${Math.round(cv * 100)}%</b>${it.status === "inferred" && !it.evidence ? `<span class="why" style="font-size:10px">assumed</span>` : ""}</div>${it.evidence ? `<div class="why" style="font-size:10px;margin-top:2px">${esc(it.evidence)}</div>` : ""}${it.needs && cv < 0.7 ? `<div style="font-size:10px;color:var(--warn,#e3b341);margin-top:2px">↑ ${esc(it.needs)}</div>` : ""}`}</td><td class="why" style="font-size:10.5px">${it.note ? esc(it.note) : ""}</td></tr>`; }).join("")).join("")}
        </tbody></table></div>`;
    };
    // ---- ON-DISK DECODE: read the equipped car's tune straight from the save file (exact, no driving) ----
    // FH6 writes every tune as a plaintext 598-byte Data file; the daemon parses it (/disk-tune) into the
    // same Clone-Sheet deliverable shape. This is the STRONGEST decode source — exact values, and it sees
    // the locked/downloaded sliders the in-game screen hides — so it leads the decode subject when present.
    const diskDiffBanner = (ordinal) => {   // "changed since your last save" — appears ~45s after a fresh save
      const dd = live.diskDiff; if (!dd || !dd.diff || dd.ordinal !== ordinal || performance.now() - dd.t > 45000) return "";
      const sl = (dd.diff.sliders || []).map((c) => { const f = esc(c.field.replace(/_/g, " ")); return c.pos ? `<b>${f}</b> ${c.from_pct}%→${c.to_pct}%` : `<b>${f}</b> ${c.from}→${c.to}${c.unit ? " " + esc(c.unit) : ""}`; });
      const pc = (dd.diff.parts || []).length;
      if (!sl.length && !pc) return "";
      return `<div style="margin:0 0 10px;padding:8px 12px;border:1px solid #e3b341;border-radius:8px;background:rgba(227,179,65,.08);font-size:12px"><b style="color:#e3b341">🔧 Changed since your last save:</b> ${sl.slice(0, 8).join(" · ") || ""}${sl.length > 8 ? ` · +${sl.length - 8} more` : ""}${pc ? ` <span class="why">· ${pc} part change${pc > 1 ? "s" : ""}</span>` : ""}</div>`;
    };
    // (FHM_CLS class-color map retired — the global piBadge/.pib in-game badge is the ONE class design language)
    const FHM_CSS = `
      .fhm{font-family:'Saira Semi Condensed','Barlow Semi Condensed','Segoe UI',system-ui,sans-serif}
      .fhm-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      @media(max-width:860px){.fhm-cols{grid-template-columns:1fr}}
      .fhm-sub{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:6px;margin:0 0 10px}
      .fhm-cat{margin-bottom:9px;border:1px solid var(--line);border-radius:7px;overflow:hidden;background:var(--bg2)}
      .fhm-cath{display:flex;align-items:center;gap:8px;padding:6px 11px;background:rgba(255,255,255,.02);border-bottom:1px solid var(--line)}
      .fhm-cath .bar{width:3px;height:12px;background:#36c1e8;border-radius:2px}
      .fhm-cath b{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--txt)}
      .fhm-cath .k{margin-left:auto;font-size:10px;color:var(--muted)}
      .fhm-prow{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:5px 11px;border-bottom:1px solid rgba(255,255,255,.03);font-size:12.5px;text-transform:capitalize}
      .fhm-prow:last-child{border-bottom:none}.fhm-prow.stock{opacity:.5}
      .fhm-pips{display:flex;gap:3px}.fhm-pips i{width:13px;height:6px;border-radius:1px;background:#26313a}.fhm-pips i.on{background:#a8d92a}
      .fhm-up{min-width:120px;text-align:right;text-transform:none}
      .fhm-up.named,.fhm-up.category{color:#c3ea4f}.fhm-up.stock{color:var(--muted);font-size:11px;text-transform:uppercase}
      .fhm-up.dim{color:#36c1e8}.fhm-up.cosmetic{color:var(--muted)}
      .fhm-pi{margin-left:6px;font-size:9.5px;letter-spacing:.04em;font-weight:700;color:#e6a63a;border:1px solid rgba(230,166,58,.4);border-radius:8px;padding:0 5px;vertical-align:middle;font-variant-numeric:tabular-nums}
      .fhm-prow-sub{font-size:10px;color:var(--muted);line-height:1.25;margin-top:2px;font-style:italic}
      .fhm-prow-sub.meas{color:#8fd14f;font-style:normal}
      .dm-bar{margin:6px 0 9px;display:flex;flex-direction:column;gap:5px}
      .dm-warn{font-size:11.5px;border:1px solid rgba(229,65,78,.5);background:rgba(229,65,78,.08);color:var(--txt);border-radius:7px;padding:6px 9px;line-height:1.4}
      .dm-ok{font-size:11px;color:#00d27a}
      .dm-why{font-size:11px;color:var(--muted)}
      .dm-picker{display:flex;flex-wrap:wrap;gap:5px}
      .dm-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;border:1px solid var(--line);border-radius:12px;padding:3px 10px;background:var(--bg2);color:var(--txt);cursor:pointer;font-variant-numeric:tabular-nums}
      .dm-chip:hover{border-color:var(--muted)}
      .dm-chip.on{border-color:#a371f7;color:#a371f7;background:rgba(163,113,247,.12);font-weight:700}   /* selection is purple everywhere (tl-save.on matches); green = live-verified only (audit F13) */
      .dm-chip.auto{border-color:#a371f7;color:#a371f7}
      .dm-chip .dm-date{font-size:9px;color:var(--muted)}
      .clone-mode{display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:9px;margin:0 0 10px;font-size:12.5px}
      .clone-mode .cm-txt{flex:1;min-width:0}.clone-mode .why{font-size:11px;margin-top:2px}
      .clone-mode.live{border:1px solid rgba(0,210,122,.45);background:rgba(0,210,122,.06)}.clone-mode.live>.cm-txt b{color:#00d27a}
      .clone-mode.locked{border:1px solid #a371f7;background:rgba(163,113,247,.13)}.clone-mode.locked>.cm-txt b{color:#a371f7}
      .clone-mode .lab-mode{flex:none;white-space:nowrap}
      .fhm-pi-budget{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px;font-size:11px;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:5px 9px;margin:0 0 11px;background:rgba(230,166,58,.05)}
      .fhm-pi-budget.ok{border-color:rgba(0,210,122,.4);background:rgba(0,210,122,.05)}
      .fhm-pi-budget .lbl{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700}
      .fhm-pi-budget b{color:#e6a63a;font-variant-numeric:tabular-nums}
      .fhm-tab{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 7px;border-left:2px solid var(--accent);padding-left:7px}
      .fhm-sec{margin-bottom:11px}
      .fhm-sech{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#0b0f07;background:#a8d92a;padding:2px 8px;border-radius:3px;display:inline-block;margin:0 0 7px}
      .fhm-sl{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)}.fhm-sl:last-child{border-bottom:none}
      .fhm-slt{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:5px}
      .fhm-sll{font-size:12px;color:var(--txt)}
      .fhm-slv{font-weight:700;font-size:16px;color:#c3ea4f;white-space:nowrap;font-variant-numeric:tabular-nums}
      .fhm-slv.pos{color:#e6a63a;font-size:13px}
      .fhm-slv.derived{color:#8fd14f;border-bottom:1px dotted rgba(143,209,79,.55)}
      .fhm-trk{position:relative;height:16px}
      .fhm-trk .rail{position:absolute;top:7px;left:0;right:0;height:3px;border-radius:2px;background:#0b1013;border:1px solid var(--line)}
      .fhm-trk .fill{position:absolute;top:7px;left:0;height:3px;border-radius:2px;background:#a8d92a}
      .fhm-trk .fill.pos{background:repeating-linear-gradient(90deg,#e6a63a,#e6a63a 4px,transparent 4px,transparent 8px)}
      .fhm-trk .knob{position:absolute;top:1px;width:4px;height:14px;border-radius:2px;background:var(--txt);transform:translateX(-50%)}
      .fhm-trk .knob.pos{background:#e6a63a}
      .fhm-pol{display:flex;justify-content:space-between;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-top:2px}
      .fhm-rin{width:44px;padding:1px 3px;border-radius:3px;border:1px dashed #e6a63a;background:var(--bg2);color:var(--txt);font-size:10px;margin-left:4px}
      .fhm-conf{border:1px solid var(--line);border-radius:8px;padding:8px 11px;margin:0 0 11px;background:rgba(255,255,255,.015)}
      .fhm-confhead{display:flex;align-items:center;gap:9px}
      .fhm-confhead .lbl{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
      .fhm-confhead b{font-size:16px;font-variant-numeric:tabular-nums;margin-left:auto}
      .fhm-confhead .tag{font-size:10px;border:1px solid;border-radius:10px;padding:1px 8px;white-space:nowrap}
      .fhm-confbar{height:7px;border-radius:4px;background:#0b1013;border:1px solid var(--line);overflow:hidden;margin:6px 0 8px}
      .fhm-confbar i{display:block;height:100%;border-radius:4px;transition:width .5s ease}
      .fhm-todos{display:flex;flex-direction:column;gap:4px}
      .fhm-todo{display:flex;gap:7px;font-size:11.5px;align-items:baseline}
      .fhm-todo .d{color:#e3b341;flex:none}
      .fhm-todo.ok .d{color:#00d27a}
      .fhm-todo code{background:var(--bg2);border:1px solid var(--line);border-radius:3px;padding:0 4px;font-size:10.5px;color:#e6a63a}
      .fhm-float{position:fixed;right:18px;bottom:18px;z-index:9999;width:min(560px,94vw);max-height:86vh;border:1px solid #00d27a;border-radius:10px;background:var(--bg);box-shadow:0 18px 46px rgba(0,0,0,.55);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(140,150,160,.45) transparent}
      .fhm-float::-webkit-scrollbar{width:12px;height:12px}
      .fhm-float::-webkit-scrollbar-track{background:transparent;margin:6px 0}
      .fhm-float::-webkit-scrollbar-thumb{background:rgba(140,150,160,.35);border-radius:10px;border:3px solid transparent;background-clip:padding-box}
      .fhm-float::-webkit-scrollbar-thumb:hover{background:rgba(0,210,122,.6);background-clip:padding-box}
      .fhm-float::-webkit-scrollbar-thumb:active{background:rgba(0,210,122,.85);background-clip:padding-box}
      .fhm-float::-webkit-scrollbar-corner{background:transparent}
      .fhm-fbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:7px 11px;background:linear-gradient(180deg,rgba(0,210,122,.16),rgba(0,210,122,.05)),var(--bg);border-bottom:1px solid var(--line);cursor:grab;user-select:none}
      .fhm-fbar:active{cursor:grabbing}
      .fhm-fbar .ttl{font-size:10px;letter-spacing:.15em;font-weight:700;color:#00d27a;white-space:nowrap}
      .fhm-fbar .nm{font-size:12.5px;font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fhm-fbar .pct{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:auto;white-space:nowrap}
      .fhm-fbtn{flex:none;width:24px;height:22px;border:1px solid var(--line);border-radius:5px;background:var(--bg2);color:var(--txt);font-size:12px;line-height:1;cursor:pointer;padding:0}
      .fhm-fbtn:hover{border-color:var(--accent);color:var(--accent)}
      .fhm-fbtn.on{border-color:#a371f7;color:#a371f7;background:rgba(163,113,247,.14)}
      .fhm-fbody{padding:11px}
      .fhm-fbody .block{margin:0 !important;border:none !important;padding:0 !important;background:none !important}
      .fhm-vdot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:var(--muted)}
      .fhm-vdot.ok{background:#00d27a;box-shadow:0 0 5px rgba(0,210,122,.6)}
      .fhm-vdot.near{background:#e3b341}
      .fhm-vdot.off{background:#e5414e;box-shadow:0 0 5px rgba(229,65,78,.5)}
      .fhm-vdot.over{background:#ff9f45}
      .fhm-coarse{border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin:0 0 9px;background:rgba(255,255,255,.015)}
      .fhm-coarse-h{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
      .fhm-coarse-row{display:flex;flex-wrap:wrap;gap:6px}
      .fhm-vchip{display:inline-flex;align-items:center;font-size:11px;border:1px solid var(--line);border-radius:11px;padding:2px 9px;white-space:nowrap}
      .fhm-vchip.ok{border-color:rgba(0,210,122,.45)}
      .fhm-vchip.off{border-color:rgba(229,65,78,.55)}
      .fhm-vchip.over{border-color:rgba(255,159,69,.55)}
      .fhm-vchip .w{color:#e5414e;margin-left:4px}
      .fhm-vchip.over .w{color:#ff9f45}
      .fhm-verify{border:1px solid;border-radius:8px;padding:8px 11px;margin:0 0 10px;background:rgba(255,255,255,.015)}
      .fhm-verify-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;margin-bottom:6px}
      .fhm-verify-h span{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
      .fhm-verify-todo{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:7px;font-size:11px;text-transform:capitalize}
      .fhm-verify-todo span{display:inline-flex;align-items:center}
      .tmoves{display:flex;flex-direction:column;gap:7px;margin-top:4px}
      .tmove{display:flex;gap:10px;align-items:stretch;border-left:3px solid var(--line);background:var(--bg2);border-radius:0 8px 8px 0;padding:8px 11px}
      .tm-main{flex:1;min-width:0}
      .tm-diag{flex:none;width:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-left:1px solid var(--line);padding-left:9px}
      .tm-diag-cap{font-size:8.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);text-align:center;line-height:1.25}
      .tm-diag-cap span{font-weight:700}
      .tm-anat{display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:9px 13px;margin:2px 0 9px}
      .tm-anat-wrap{flex:none;width:220px;max-width:46vw}
      .tm-anat-svg{width:100%;height:auto;display:block}
      .tm-anat-lg{display:flex;flex-direction:column;gap:3px;font-size:11px;min-width:160px;flex:1}
      .tm-anat-ttl{font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
      .tm-lg{display:inline-flex;align-items:center;gap:6px;color:var(--muted)}
      .tm-lg i{width:11px;height:8px;border-radius:2px;flex:none}
      .tm-lg.iss{color:var(--txt)}.tm-lg.iss b{color:#e5414e;font-weight:700}
      .tm-tgt{margin-top:5px;padding-top:5px;border-top:1px solid var(--line);font-size:10.5px;color:var(--muted);line-height:1.4}
      .tm-tgt b{color:var(--accent);font-variant-numeric:tabular-nums}
      .tm-baseline{margin-left:5px;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 5px;vertical-align:middle}
      @media(max-width:640px){.tm-diag{width:92px}.tmove{gap:7px}.tm-anat-wrap{width:150px}}
      .tmove-top{display:flex;align-items:center;gap:9px}
      .tmove-n{flex:none;width:19px;height:19px;border-radius:50%;background:var(--bg);border:1px solid var(--line);font-size:10.5px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-variant-numeric:tabular-nums}
      .tmove-sl{font-weight:600;font-size:13px}
      .tmove-ch{margin-left:auto;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap;display:inline-flex;align-items:baseline;gap:5px}
      .tm-from{color:var(--muted)}.tm-arr{font-size:11px}.tm-to{font-size:15.5px;font-weight:700}
      .tmove-fx{font-size:11.5px;color:var(--txt);margin:5px 0 0 28px;line-height:1.35}
      .tmove-why{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--muted);margin:4px 0 0 28px}
      .tmove-conf{display:inline-block;width:42px;height:4px;border-radius:2px;background:#0b1013;overflow:hidden;flex:none}
      .tmove-conf i{display:block;height:100%}
      .tmove.done{opacity:.72}
      .tm-apply,.tm-done{margin:6px 0 0 28px;font-size:10.5px;font-weight:700;border-radius:12px;padding:2px 10px;cursor:pointer;border:1px solid}
      .tm-apply{border-color:#00d27a;color:#00d27a;background:rgba(0,210,122,.08)}.tm-apply:hover{background:rgba(0,210,122,.16)}
      .tm-done{border-color:#e3b341;color:#e3b341;background:rgba(227,179,65,.08)}
      .applied-strip{border:1px solid var(--accent);border-radius:8px;background:rgba(47,129,247,.06);padding:7px 10px;margin:0 0 9px;font-size:11.5px}
      .applied-strip .as-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .applied-strip .as-hd b{font-size:13px}
      .applied-strip .as-retest{margin-left:auto;border:1px solid var(--accent);color:var(--accent);background:rgba(47,129,247,.1);border-radius:12px;padding:3px 11px;font-size:11px;font-weight:700;cursor:pointer}
      .applied-strip .as-retest:hover{background:rgba(47,129,247,.2)} .applied-strip .as-retest:disabled{opacity:.6;cursor:default}
      .applied-strip .as-row{margin-top:5px;padding:3px 8px;border-radius:5px}
      .applied-strip .as-row.ok{background:rgba(0,210,122,.08);border-left:3px solid #00d27a}
      .applied-strip .as-row.pend{background:rgba(227,179,65,.08);border-left:3px solid #e3b341}
      .applied-strip .as-clear{margin-top:6px;font-size:9.5px;color:var(--muted);background:none;border:none;cursor:pointer;text-decoration:underline}
      .applied-strip .as-ok{color:#00d27a;font-weight:700}.applied-strip .as-miss{color:#e3b341;font-weight:700}
      .ab-panel{border:1px solid #a371f7;border-radius:8px;background:rgba(163,113,247,.07);padding:7px 10px;margin:0 0 9px}
      .ab-panel .ab-hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.ab-panel .ab-hd b{font-size:13px;color:#a371f7}
      .ab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 12px;margin-top:6px}
      .ab-m{display:flex;align-items:center;gap:6px;font-size:11.5px;font-variant-numeric:tabular-nums}
      .ab-m>span:first-child{color:var(--muted);flex:1}.ab-m .ab-arr{font-size:10px}
      .sanity{border-radius:8px;padding:7px 10px;margin:0 0 11px;font-size:11.5px;border:1px solid var(--line)}
      .sanity.ok{border-color:rgba(0,210,122,.4);background:rgba(0,210,122,.05)}.sanity.ok b{color:#00d27a}
      .sanity.info{border-color:var(--line)}
      .sanity.warn{border-color:rgba(227,179,65,.5);background:rgba(227,179,65,.06)}
      .sanity.bad{border-color:#e5414e;background:rgba(229,65,78,.08)}
      .sanity-hd{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}.sanity-hd b{font-size:13px}
      .sanity.bad .sanity-hd b{color:#e5414e}.sanity.warn .sanity-hd b{color:#e3b341}
      .sanity-row{display:flex;gap:8px;align-items:flex-start;padding:5px 0;line-height:1.4;border-top:1px solid rgba(255,255,255,.05)}
      .sanity-row:first-of-type{border-top:none}
      .sanity-row .s-ic{flex:none}.sanity-row .s-body{flex:1;min-width:0}.sanity-row .s-glyph{flex:none}
      .sanity-row.error .s-body>div:first-child,.sanity-row.warn .s-body>div:first-child{color:var(--txt)}.sanity-row.info{color:var(--muted)}
      .s-fixrow{margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px}
      .s-set{border:1px solid var(--line);border-radius:6px;padding:1px 8px;font-variant-numeric:tabular-nums;background:var(--bg2);white-space:nowrap}
      .s-set .s-from{color:var(--muted);font-weight:600}.s-set .s-to{color:#00d27a;font-weight:800}
      .sanity-row.new{background:rgba(227,179,65,.10);border-radius:6px}
      .s-new{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.05em;color:#0b0e13;background:#e3b341;border-radius:4px;padding:0 5px;margin-right:5px;vertical-align:1px}
      /* ---- livery gallery ---- */
      .lvy-strip{border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin:0 0 10px;background:rgba(255,255,255,.015)}
      .lvy-h{font-size:12px;font-weight:700;margin-bottom:5px}
      .lvy-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:3px;scrollbar-width:thin}
      .lvy{flex:none;width:104px;margin:0;text-align:center}
      .lvy img{width:104px;height:62px;object-fit:cover;border-radius:6px;border:1px solid var(--line);display:block;background:var(--bg2)}
      .lvy figcaption{font-size:9.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lvy-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
      .lvy-chip{font-size:10.5px;border:1px solid var(--line);border-radius:10px;padding:2px 9px;background:var(--bg2);white-space:nowrap}
      .lvy{position:relative}
      .lvy.assoc img{border-color:#a371f7}
      .lvy.assoc-cur img{border:2px solid #00d27a;box-shadow:0 0 9px rgba(0,210,122,.45)}
      .lvy-badge{position:absolute;top:2px;left:2px;font-size:8.5px;font-weight:800;background:rgba(14,17,22,.85);border:1px solid #a371f7;color:#a371f7;border-radius:5px;padding:0 4px;max-width:98px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lvy-badge.cur{border-color:#00d27a;color:#00d27a}
      .lvy-cur-tag{color:#00d27a;font-weight:800}
      .lvy-chip.assoc{border-color:#a371f7}
      .lvy-chip.assoc-cur{border-color:#00d27a;box-shadow:0 0 6px rgba(0,210,122,.35)}
      .lvy-chip b{color:#a371f7;font-weight:700}.lvy-chip.assoc-cur b{color:#00d27a}
      /* ---- build-confirm gate ---- */
      .bcf{border:2px solid;border-radius:9px;padding:9px 12px;margin:0 0 10px;background:rgba(255,255,255,.015)}
      .bcf-hd{display:flex;align-items:baseline;gap:9px}.bcf-hd b{font-size:13.5px}
      .bcf-pct{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
      .bcf-list{font-size:11.5px;margin:4px 0}.bcf-list.ok{color:#00d27a}
      .bcf-list.need{color:var(--txt)}.bcf-need-h{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#e3b341;margin-bottom:2px}
      .bcf-btn{margin-top:6px;border-radius:7px;padding:6px 14px;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid}
      .bcf-btn.go{background:#00d27a;border-color:#00d27a;color:#0e1116}
      .bcf-btn.go:hover{filter:brightness(1.1)}
      .bcf-btn.wait{background:transparent;border-color:var(--line);color:var(--muted)}
      .bcf-ok{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#00d27a;font-weight:700;border:1px solid rgba(0,210,122,.4);border-radius:7px;padding:4px 10px;margin:0 0 8px;background:rgba(0,210,122,.06)}
      .bcf-recheck{margin-left:auto;border:1px solid var(--line);border-radius:6px;background:var(--bg2);color:var(--muted);font-size:10.5px;padding:1px 8px;cursor:pointer}
      .bcf-recheck:hover{border-color:var(--accent);color:var(--accent)}
      /* ---- tune library ---- */
      .tl{border:1px solid #a371f7;border-radius:8px;background:rgba(163,113,247,.05);padding:7px 11px;margin:0 0 10px;font-size:11.5px}
      .tl>summary{cursor:pointer;user-select:none}.tl>summary b{font-size:12.5px;color:#a371f7}
      .tl-bucket{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:5px 0;border-top:1px solid rgba(255,255,255,.05)}
      .tl-bucket:first-of-type{margin-top:5px}
      .tl-sig{min-width:150px;font-variant-numeric:tabular-nums}
      .tl-tie{display:inline-block;margin-left:7px;font-size:9.5px;font-weight:700;color:#e3b341;border:1px solid #e3b341;border-radius:8px;padding:0 6px}
      .tl-saves{display:inline-flex;gap:5px;flex-wrap:wrap}
      .tl-save{font-size:10.5px;border:1px solid var(--line);border-radius:6px;background:var(--bg2);color:var(--txt);padding:1px 8px;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums}
      .tl-save:hover{border-color:#a371f7}
      .tl-save.on{border-color:#a371f7;color:#a371f7;background:rgba(163,113,247,.12);font-weight:700}
      .tl-bucket.cur{background:rgba(163,113,247,.06);border-radius:7px;padding-left:6px;padding-right:6px}
      .tl-blvy{width:44px;height:26px;object-fit:cover;border-radius:5px;border:1px solid var(--line);cursor:pointer;flex:none;align-self:center}
      .tl-blvy:hover{border-color:#a371f7}
      .tl-blvy-chip{font-size:9.5px;border:1px solid var(--line);border-radius:6px;padding:1px 6px;cursor:pointer;white-space:nowrap;flex:none}
      img.tl-blvy.blvy-sm{width:28px;height:17px;border-radius:4px;vertical-align:middle}
      span.tl-blvy-chip.blvy-sm{padding:0 4px;font-size:9px;vertical-align:middle}
      .course-mini{display:inline-flex;align-items:center;gap:5px;vertical-align:middle;max-width:100%}
      .course-mini-glyph{flex:none;display:flex;align-items:center}
      .course-mini b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .start-pt{white-space:nowrap}.start-pt i{color:#00d27a;font-style:normal}
      .gchip{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:600;border:1px solid;border-radius:5px;padding:1px 6px;white-space:nowrap}
      .glegend{display:inline-flex;flex-wrap:wrap;gap:9px;font-size:10px;color:var(--muted)}
      .glegend span{display:inline-flex;align-items:center;gap:4px}
      .glegend i{width:10px;height:3px;border-radius:2px;display:inline-block}
      svg.spd-trace{cursor:crosshair}
      .spd-mark{pointer-events:none}
      .ratif{border-radius:8px;padding:7px 10px;margin:0 0 8px;font-size:12px}
      .ratif.ok{border:1px solid #00d27a;background:rgba(0,210,122,.08)}
      .ratif.no{border:1px solid #e3b341;background:rgba(227,179,65,.07)}
      .ratif.bad{border:1px solid #e5414e;background:rgba(229,65,78,.07)}
      .ratif ol{margin:4px 0 0 20px;padding:0}
      .ratif li{margin:2px 0;font-size:11.5px}
      .ratif li span{margin-right:3px}
      .ratif-reqs{display:flex;flex-direction:column;gap:2px;margin-top:5px}
      .ratif-req{display:flex;align-items:baseline;gap:7px;font-size:11.5px}
      .ratif-req .rr-st{flex:none;font-weight:800;width:12px;text-align:center}
      .ratif-req.done .rr-st{color:#00d27a}
      .ratif-req.todo .rr-st{color:var(--warn,#e3b341)}
      .ratif-req.adv .rr-st{color:var(--muted)}
      .ratif-req.adv .rr-lbl{color:var(--muted)}
      .ratif-req.adv .rr-act{color:var(--muted);font-size:10.5px}
      .ratif-req.done .rr-lbl{color:var(--muted)}
      .ratif-req.todo .rr-lbl{font-weight:700}
      .ratif-req .rr-act{color:var(--txt);font-size:11px}
      .rat-chip{font-size:10.5px;font-weight:800;border-radius:5px;padding:2px 7px;border:1px solid;white-space:nowrap}
      .rat-chip.ok{color:#00d27a;border-color:#00d27a}
      .rat-chip.no{color:#e3b341;border-color:#e3b341}
      .rat-chip.bad{color:#e5414e;border-color:#e5414e}
      .lv-car{transition:transform .18s linear}
      .lv-last .lvl-ring{opacity:.95}
      .lv-last.fresh .lvl-ring{animation:tnpulse 1.1s ease-out 2}
      .tn-grade{opacity:.85}
      .tn-grade.fresh{animation:tnpulse 1.1s ease-out 3}
      @keyframes tnpulse{0%{stroke-opacity:1;stroke-width:4}60%{stroke-opacity:.35;stroke-width:2.2}100%{stroke-opacity:.85;stroke-width:2.2}}
      .tl-blvy-chip:hover{border-color:#a371f7}
      .tl-blvy-none{font-size:11px;border:1px dashed var(--line);border-radius:6px;padding:1px 7px;color:var(--muted);cursor:pointer;flex:none}
      .tl-blvy-none:hover{border-color:#a371f7;color:#a371f7}
      .tl-diffs{flex-basis:100%;display:flex;flex-wrap:wrap;gap:4px;align-items:baseline;padding:3px 0 1px 12px}
      .tl-diff{font-size:9.5px;border:1px solid rgba(227,179,65,.45);color:#e3b341;border-radius:6px;padding:0 6px;white-space:nowrap}
      .tl-worn{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:6px;padding-top:5px;border-top:1px dashed rgba(255,255,255,.12)}
      .tl-lvy{width:56px;height:34px;object-fit:cover;border-radius:5px;border:1px solid var(--line)}
      /* ---- consolidated identification master panel + drawers ---- */
      .idm{margin:0 0 10px}
      .idm-ribbon{display:flex;align-items:center;gap:9px;border:1px solid;border-radius:8px;padding:5px 10px;margin:0 0 9px;font-size:12.5px}
      .dm-info{cursor:help;color:var(--muted);font-size:10.5px;border-bottom:1px dotted var(--muted);white-space:nowrap}
      #fhmToast{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-8px);z-index:9500;background:var(--bg2);border:1px solid #00d27a;color:#00d27a;font-weight:700;font-size:13px;border-radius:9px;padding:8px 18px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;box-shadow:0 6px 22px rgba(0,0,0,.45)}
      #fhmToast.show{opacity:1;transform:translateX(-50%) translateY(0)}
      .idm-chips{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0}
      .idm-id{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:11.5px;margin:7px 0;padding:6px 10px;border:1px dashed var(--line);border-radius:7px}
      .idm-id.ok{border-color:rgba(0,210,122,.5);border-style:solid}
      .idm-id.guess{border-color:rgba(227,179,65,.55)}
      .idm-id.unknown{border-color:rgba(229,65,78,.45)}
      .idm-picks{display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center;vertical-align:middle}
      .idm-pick{width:66px;height:40px;object-fit:cover;border-radius:6px;border:2px solid var(--line);cursor:pointer;transition:border-color .12s,transform .12s}
      .idm-pick:hover{border-color:#00d27a;transform:scale(1.06)}
      .idm-pick.chip{width:auto;height:auto;font-size:10.5px;padding:2px 8px;border-radius:8px;background:var(--bg2);border-width:1px}
      .idm-drawer{border:1px solid var(--line);border-radius:8px;margin:0 0 8px;padding:6px 11px;font-size:11.5px;background:rgba(255,255,255,.012)}
      .idm-drawer>summary{cursor:pointer;font-weight:600;font-size:12px;user-select:none}
      .idm-drawer>summary:hover{color:var(--accent)}
      .idm-dbody{margin-top:7px}
      .idm-dbody>.us,.idm-dbody>.sanity,.idm-dbody>.cal-card,.idm-dbody>.fhm-pi-budget{border:none;background:none;padding:0;margin:0}
      .idm-flag{font-size:10px;font-weight:800;color:#e5414e;border:1px solid #e5414e;border-radius:8px;padding:0 6px;margin-left:6px;vertical-align:1px}
      .idm-flag.warn{color:#e3b341;border-color:#e3b341}
      /* ---- SAVE x TELEMETRY union strip ---- */
      .us{border:1px solid #2f81f7;border-radius:8px;background:rgba(47,129,247,.06);padding:8px 11px;margin:0 0 11px}
      .us.has-conflict{border-color:#e5414e;background:rgba(229,65,78,.05)}
      .us-hd{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:6px}
      .us-hd>b{font-size:13px;color:#2f81f7}.us.has-conflict .us-hd>b{color:#e5414e}
      .us-chip{font-size:10.5px;border:1px solid;border-radius:10px;padding:1px 8px;white-space:nowrap;font-weight:700}
      .us-chip.ok{border-color:#00d27a;color:#00d27a}.us-chip.bad{border-color:#e5414e;color:#e5414e;background:rgba(229,65,78,.12)}
      .us-chip.fill{border-color:#2f81f7;color:#2f81f7}.us-chip.wait{border-color:#e3b341;color:#e3b341}
      .us-row{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;padding:3px 0;font-size:11.5px;border-top:1px solid rgba(255,255,255,.05)}
      .us-row:first-of-type{border-top:none}
      .us-row.conflict{background:rgba(229,65,78,.08);border-radius:6px;padding-left:5px;padding-right:5px}
      .us-ic{flex:none;font-weight:800}.us-name{min-width:118px}
      .us-vals{font-variant-numeric:tabular-nums}
      .us-src{font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px;margin-right:4px}
      .us-src.tel{border-color:#2f81f7;color:#2f81f7}
      .us-x{margin:0 6px;color:var(--muted)}
      .us-note{flex-basis:100%;font-size:10.5px;color:#e5414e;padding-left:20px}
      .us-row.await .us-note,.us-row.tele-fill .us-note{color:var(--muted)}
      .us-asks{margin-top:7px;border:1px dashed #e3b341;border-radius:7px;padding:6px 10px;background:rgba(227,179,65,.06)}
      .us-asks-h{font-size:9.5px;letter-spacing:.12em;font-weight:800;color:#e3b341;margin-bottom:3px}
      .us-ask{display:flex;align-items:baseline;gap:6px;font-size:11.5px;padding:1px 0}
      .us-ask-arrow{color:#e3b341;font-weight:800}
      .us-gain{margin-left:auto;font-size:9.5px;color:var(--muted);white-space:nowrap;border:1px solid var(--line);border-radius:8px;padding:0 6px}
      .fhm-cflag{display:inline-block;font-size:9.5px;font-weight:800;color:#e5414e;border:1px solid #e5414e;border-radius:5px;padding:0 5px;margin-left:5px;background:rgba(229,65,78,.1);vertical-align:1px}
      .fhm-aflag{display:inline-block;font-size:9px;font-weight:800;color:#00d27a;margin-left:5px;vertical-align:1px;opacity:.85}
      /* ---- one-time per-car calibration card (ride height / downforce ranges) ---- */
      .cal-card{border:1px solid #e6a63a;border-radius:8px;background:rgba(230,166,58,.07);padding:8px 11px;margin:0 0 11px}
      .cal-hd{margin-bottom:6px}.cal-hd b{font-size:13px;color:#e6a63a}
      .cal-sub{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:7px;padding-top:5px;border-top:1px dashed rgba(255,255,255,.12)}
      .cal-row{display:flex;align-items:center;gap:9px;padding:4px 0;border-top:1px solid rgba(255,255,255,.05);flex-wrap:wrap}
      .cal-row:first-of-type{border-top:none}
      .cal-lbl{font-weight:700;min-width:120px;font-size:12px}
      .cal-pos{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
      .cal-dots{letter-spacing:2px;color:#e6a63a;font-size:12px}
      .cal-row .fhm-rin{width:70px;margin-left:0}
      .cal-unit{color:var(--muted);font-size:11px}
      .fhm-rin-msg{font-size:10.5px;flex:1 0 100%;margin-left:1px}
      .cal-flash{outline:2px solid #e6a63a;outline-offset:2px;border-radius:6px;transition:outline-color .4s}
      .fhm-caljump{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;border:1px solid #e6a63a;color:#e6a63a;background:rgba(230,166,58,.10);border-radius:10px;padding:0 7px;margin-left:5px;cursor:pointer;white-space:nowrap}
      .fhm-caljump:hover{background:rgba(230,166,58,.22)}
      /* ---- A/B full-value view + changed-field chips ---- */
      .ab-changed{display:flex;flex-wrap:wrap;gap:5px 8px;margin-top:6px;font-size:11.5px}
      .ab-chg{border:1px solid rgba(163,113,247,.4);border-radius:6px;padding:1px 7px;background:rgba(163,113,247,.08);font-variant-numeric:tabular-nums}
      .abv{margin-top:7px;font-size:11px}
      .abv>summary{cursor:pointer;color:#a371f7;font-weight:600;user-select:none}
      .abv-sec{margin-top:5px;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
      .abv-row{display:flex;justify-content:space-between;gap:10px;padding:1px 0;font-variant-numeric:tabular-nums}
      .abv-row>span{color:var(--muted)}.abv-row>b.pos{color:#e6a63a}
      /* ---- 📡 data-needs status (pill + panel) ---- */
      .ddata-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;border:1px solid;border-radius:11px;padding:1px 9px;background:var(--bg2);cursor:pointer;white-space:nowrap}
      .ddata-pill .dot{width:6px;height:6px;border-radius:50%}
      .ddata-pill.warn{border-color:#e3b341;color:#e3b341}.ddata-pill.warn .dot{background:#e3b341}
      .ddata-pill.bad{border-color:#e5414e;color:#e5414e}.ddata-pill.bad .dot{background:#e5414e}
      .ddata-pill.ok{border-color:#00d27a;color:#00d27a}.ddata-pill.ok .dot{background:#00d27a}
      .ddata-pill:hover{filter:brightness(1.2)}
      .ddata-cap{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:5px}
      .ddata-row{display:flex;align-items:baseline;gap:7px;font-size:11.5px;padding:2px 0}
      .ddata-arrow{color:#e3b341;font-weight:800;flex:none}
      .ddata-gain{margin-left:auto;font-size:9.5px;color:var(--muted);white-space:nowrap;border:1px solid var(--line);border-radius:8px;padding:0 6px;flex:none}
      .ddata-done{font-size:11.5px;color:#00d27a;font-weight:700}
      /* ---- dock manual sanity-check window ---- */
      .dsan-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:7px;font-size:11.5px}
      .dsan-hd>span:first-child{flex:1}
      .dsan-new{color:#e3b341}.dsan-res{color:#00d27a}
      /* ---- F1 speed trace ---- */
      .spd-hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:2px}
      .spd-hd b{font-size:12.5px;color:var(--accent)}
      .spd-svg{margin-top:2px}
      /* ---- last-corner scorecard ---- */
      .cscore{border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:8px 11px;background:rgba(255,255,255,.015)}
      .cscore-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .cscore-hd>b{font-size:13px}
      .cscore-strip{margin-left:auto;display:inline-flex;gap:3px}
      .cscore-chip{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;font-size:9px;font-weight:800;color:#0e1116}
      .cscore-body{display:flex;align-items:center;gap:12px;margin-top:7px}
      .cscore-grade{flex:none;width:56px;height:56px;border:2px solid;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:28px;font-weight:800;line-height:1}
      .cscore-grade small{font-size:10px;font-weight:600;color:var(--muted)}
      .cscore-detail{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
      .cscore-line{font-size:12px;font-variant-numeric:tabular-nums}
      .cscore-issues{display:flex;flex-wrap:wrap;gap:5px}
      .cscore-iss{font-size:10.5px;border-radius:5px;padding:1px 7px;border:1px solid}
      .cscore-iss.s3{border-color:#e5414e;color:#e5414e;background:rgba(229,65,78,.1)}
      .cscore-iss.s2{border-color:#e3b341;color:#e3b341;background:rgba(227,179,65,.1)}
      .cscore-iss.s1{border-color:var(--line);color:var(--muted)}
      .cscore-clean{font-size:11px;color:#00d27a;font-weight:700}
      /* ---- bottom LIVE DOCK: session-strip spine + bench/clone pop-chips, anchored to every Lab subtab ---- */
      .fhm-dock{position:fixed;left:0;right:0;bottom:0;z-index:9000;background:linear-gradient(180deg,rgba(14,17,22,.86),var(--bg));border-top:1px solid var(--line);box-shadow:0 -10px 30px rgba(0,0,0,.4);backdrop-filter:blur(6px);font-family:'Saira Semi Condensed','Barlow Semi Condensed','Segoe UI',system-ui,sans-serif}
      .fhm-dock-hd{display:flex;align-items:center;gap:9px;padding:5px 12px;min-height:30px;flex-wrap:wrap}
      .fhm-dock-ttl{font-size:9.5px;letter-spacing:.16em;font-weight:700;color:#e5414e;white-space:nowrap;display:inline-flex;align-items:center;gap:5px}
      .fhm-dock-ttl .dot{width:7px;height:7px;border-radius:50%;background:#e5414e;box-shadow:0 0 6px rgba(229,65,78,.7)}
      .fhm-dock-ttl.off{color:var(--muted)}
      .fhm-dock-ttl.off .dot{background:var(--muted);box-shadow:none}
      .fhm-dock.offline .fhm-dock-tiles{opacity:.45}
      .fhm-dock-tiles{display:flex;flex-wrap:wrap;gap:6px;padding:5px 10px 6px;min-height:34px;align-items:stretch;border-top:1px solid rgba(255,255,255,.05)}
      .fhm-dtile{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:48px;padding:2px 7px;border-radius:6px;background:var(--bg2);border:1px solid var(--line)}
      .fhm-dtile b{font-size:15px;font-weight:800;line-height:1.02;color:var(--txt);font-variant-numeric:tabular-nums}
      .fhm-dtile span{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;margin-top:1px}
      .fhm-dtile:nth-last-child(-n+2){min-width:auto;align-items:flex-start}
      .fhm-dtile:nth-last-child(-n+2) b{font-size:12px;font-weight:700}
      .fhm-dock-chips{display:inline-flex;gap:6px;margin-left:auto;align-items:center}
      .fhm-dchip{display:inline-flex;align-items:center;gap:4px;font-size:11px;border:1px solid var(--line);border-radius:12px;padding:2px 10px;background:var(--bg2);color:var(--txt);cursor:pointer;white-space:nowrap}
      .fhm-dchip:hover{border-color:var(--muted)}
      .fhm-dchip.on{border-color:#a371f7;color:#a371f7;background:rgba(163,113,247,.14)}
      .fhm-dock-x{flex:none;width:22px;height:20px;border:1px solid var(--line);border-radius:5px;background:var(--bg2);color:var(--muted);font-size:11px;line-height:1;cursor:pointer;padding:0}
      .fhm-dock-x:hover{border-color:var(--accent);color:var(--accent)}
      .fhm-dock-panel{max-height:min(46vh,340px);overflow-y:auto;overflow-x:hidden;padding:6px 12px 8px;border-top:1px solid rgba(255,255,255,.04);overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(140,150,160,.45) transparent}
      .fhm-dock-panel::-webkit-scrollbar{width:11px;height:11px}
      .fhm-dock-panel::-webkit-scrollbar-track{background:transparent;margin:5px 0}
      .fhm-dock-panel::-webkit-scrollbar-thumb{background:rgba(140,150,160,.35);border-radius:9px;border:3px solid transparent;background-clip:padding-box}
      .fhm-dock-panel::-webkit-scrollbar-thumb:hover{background:rgba(163,113,247,.6);background-clip:padding-box}
      .fhm-dock-strip{padding:0 10px 6px}
      .fhm-dock-strip svg{width:100%;height:auto;display:block}
      .fhm-dock.min .fhm-dock-strip,.fhm-dock.min .fhm-dock-panel{display:none}
      .fhm-dchip.hidden{display:none}`;
    const ensureFhmCss = () => { if (!document.getElementById("fhmCss")) { const s = document.createElement("style"); s.id = "fhmCss"; s.textContent = FHM_CSS; document.head.appendChild(s); } };
    const fhmPips = (up) => { const lvl = /^Race/.test(up) ? 3 : /^Sport/.test(up) ? 2 : /^Street/.test(up) ? 1 : 0; return lvl ? `<span class="fhm-pips">${[0, 1, 2].map((i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("")}</span>` : "<span></span>"; };
    // WHICH saved tune is this? A car can have many saved tunes on disk; the daemon matches the shown one to the car
    // you're driving (cyl + PI). This bar shows how it matched, warns when nothing matches the live build, and — when
    // there are several — lets you pin a specific one (essential when browsing downloaded tunes you haven't applied yet).
    const _tsFmt = (ts) => { const s = String(ts || ""); return s.length >= 12 ? `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : s; };
    const diskMatchBar = (r, ordinal) => {
      const m = r.match; if (!m) return "";
      const saves = m.saves || []; const cur = String(r.ts); const pick = live.diskPick && live.diskPick[ordinal];
      let status = "";
      const ties = m.n_signature_ties || 1;
      if (m.how === "unsaved-build") status = `<div class="dm-warn"><b>🚧 Distinct build — its file is not on disk.</b> Change any part/slider and SAVE (if yours), or apply a DIFFERENT tune then re-apply this one — re-applying the active tune writes nothing. <span class="dm-info" title="Measured ${esc((m.evidence || []).join(" + ").toLowerCase() || "telemetry")} contradicts every saved tune. Same cylinders${m.live_pi ? ` and PI ${m.live_pi}` : ""} — at a class cap different part combos converge to one PI, so only part-level measurements can tell builds apart. A downloaded tune writes its file when applied.">ⓘ why</span></div>`;
      else if (m.how === "no-match") status = `<div class="dm-warn"><b>⚠ No saved tune matches this car.</b> Apply its tune (or a different one first if it's already active — a re-apply of the active tune writes nothing), or save it if yours. <span class="dm-info" title="You're in a ${m.live_cyl}-cyl car${m.live_pi ? ` at PI ${m.live_pi}` : ""}; the closest save is ${m.chosen_cyl}-cyl — a different engine, so its parts and sliders are not this build's. Downloaded tunes write their file when applied.">ⓘ why</span></div>`;
      else if (m.how === "gear-matched") status = `<div class="dm-ok">✓ identified the <b>equipped build</b> by its gear ladder ⚙${m.held ? ` <span class="why" style="font-weight:400">— held from your last verified run (a menu car-swap is invisible to telemetry; WOT the gears again if you switched cars)</span>` : ties > 1 ? ` <span class="why" style="font-weight:400">(${ties} builds share this engine + PI)</span>` : ""}</div>`;
      else if (m.how === "signature") status = `<div class="dm-ok">✓ matched to the car you${m.live ? "'re driving" : " last drove (held while parked)"} — ${m.live_cyl}-cyl${m.live_pi ? ` ${piBadge(null, m.live_pi, true)}` : ""}${ties >= 2 ? ` <span class="why" style="font-weight:400">· ${ties} builds share this signature — drive up through the gears to pin the exact one, or pick below</span>` : ""}</div>`;
      else if (m.how === "picked") status = `<div class="dm-ok">📌 pinned to this saved tune${saves.length > 1 ? " — auto-match off" : ""}</div>`;
      else if (saves.length > 1) status = `<div class="dm-why">showing the newest of ${saves.length} saved tunes — drive one to auto-match, or pick it:</div>`;
      const picker = (saves.length > 1 || pick) ? `<div class="dm-picker">${saves.map((s) => {
        const on = String(s.ts) === cur;
        return `<button class="dm-chip${on ? " on" : ""}" data-diskpick="${ordinal}|${s.ts}" title="${s.locked ? "downloaded" : "self-made"} · saved ${_tsFmt(s.ts)}">${(() => { try { const bb = ((m.builds || []).find((b2) => (b2.saves || []).some((ts) => String(ts) === String(s.ts)))); return bb && bb.livery && bb.livery.thumb ? `<img class="tl-blvy blvy-sm" src="${liveUrl}/livery-thumb?d=${encodeURIComponent(bb.livery.dir)}" loading="lazy" alt=""> ` : ""; } catch (e) { return ""; } })()}${s.pi != null ? piBadge(null, s.pi, true) : "PI ?"}${s.cyl != null ? ` · ${s.cyl}cyl` : ""} <span class="dm-date">${_tsFmt(s.ts)}</span></button>`;
      }).join("")}${pick ? `<button class="dm-chip auto" data-diskpick="${ordinal}|">🔄 auto</button>` : ""}</div>` : "";
      return (status || picker) ? `<div class="dm-bar">${status}${picker}</div>` : "";
    };
    // ONE-TIME per-car calibration: ride-height / downforce ranges are per-chassis, so the save's 0..1 position can't be
    // turned into a real number until we see the displayed value at TWO different positions. This is the single guided
    // "read this value" surface — enter the in-game number, move the slider & re-save, enter it again → the range locks
    // and every future decode of this car prints exact. Progress dots come from the daemon's captured-point count.
    const CAL_REFINABLE = new Set(["final_drive", "front_spring", "rear_spring", "front_ride_height", "rear_ride_height", "front_downforce", "rear_downforce"]);
    const calibrationCard = (dl) => {
      const un = [], refine = [];
      (dl.tabs || []).forEach((t) => (t.rows || []).forEach((row) => {
        if (row.value == null && row.per_car && !String(row.field).startsWith("gear")) un.push(row);
        else if (row.derived && CAL_REFINABLE.has(row.field)) refine.push(row);   // band-derived (~85%): the in-game number arbitrates the band & anchors it exact
      }));
      if (!un.length && !refine.length) return "";
      const ord = dl.ordinal;
      const crow = (r, isRefine) => { const cp = r.cal_points || 0; const pct = r.norm != null ? Math.round(r.norm * 1000) / 10 : Math.round((r.fill || 0) * 1000) / 10;
        const dots = isRefine ? "" : `<span class="cal-dots" title="${cp} of 2 reference points captured">${cp >= 1 ? "●" : "○"}${cp >= 2 ? "●" : "○"}</span>`;
        const pos = isRefine ? `<span class="cal-pos" title="band-derived estimate — enter the real in-game number to anchor it exact">est. ${esc(String(r.value))}${esc(r.unit || "")}</span>` : `<span class="cal-pos">${pct}% toward ${esc((r.poles || [])[0] || r.pole || "")}</span>`;
        return `<div class="cal-row" id="cal-${ord}-${esc(r.field)}"><span class="cal-lbl">${esc(r.label || r.field)}</span>${pos}${dots}<input class="fhm-rin" data-rangeord="${ord}" data-rangefield="${esc(r.field)}" data-rangenorm="${r.fill}" data-rangeunit="${esc(r.unit || "")}" placeholder="in-game #" inputmode="decimal">${r.unit ? `<span class="cal-unit">${esc(r.unit)}</span>` : ""}<span class="fhm-rin-msg"></span></div>`; };
      const unHtml = un.length ? `${un.map((r) => crow(r, false)).join("")}` : "";
      const refHtml = refine.length ? `<div class="cal-sub">refine band-derived (est. shown — your in-game number arbitrates)</div>${refine.map((r) => crow(r, true)).join("")}` : "";
      return `<div class="cal-card"><div class="cal-hd"><b>🎯 One-time calibration</b> <span class="why" style="font-size:10.5px">type the number shown in-game — ONE entry makes that slider exact at its current position immediately; a second entry at a different setting locks the car's full range for good.</span></div>${unHtml}${refHtml}</div>`;
    };
    // ---- SAVE × TELEMETRY UNION STRIP: the reconciled decode. Every field the daemon could cross-check carries both
    // sources — agreements corroborate, disagreements flag as ⚠ CONFLICTS (competing expected values → low confidence),
    // and where a telemetry reading WOULD raise confidence, the ranked "drive X" asks say exactly what to drive. ----
    const unionStrip = (dl, uopts) => {
      uopts = uopts || {};
      const u = dl && dl.union; if (!u || !(u.fields || []).length && (uopts.noAsks || !(u.asks || []).length)) return "";
      const ICO = { agree: "✓", conflict: "⚠", "tele-fill": "📡", await: "○" };
      const COL = { agree: "#00d27a", conflict: "#e5414e", "tele-fill": "#2f81f7", await: "#e3b341" };
      const ORD = { conflict: 0, agree: 1, "tele-fill": 2, await: 3 };
      const chips = `${u.n_agree ? `<span class="us-chip ok" title="save and telemetry agree on these — confidence raised">✓ ${u.n_agree} corroborated</span>` : ""}${u.n_conflict ? `<span class="us-chip bad">⚠ ${u.n_conflict} conflict${u.n_conflict > 1 ? "s" : ""}</span>` : ""}${u.n_fill ? `<span class="us-chip fill" title="values the save cannot know, measured live (drivetrain layout, peak hp)">📡 ${u.n_fill} from telemetry</span>` : ""}${u.n_await ? `<span class="us-chip wait">○ ${u.n_await} awaiting telemetry</span>` : ""}`;
      const frow = (f) => { const vfm = (v) => f.name === "PI" ? esc(String(v)).replace(/^(\d+)/, (mm) => piBadge(null, mm, true)) : esc(String(v));   // the PI union row wears the in-game badge; other fields stay plain
        return `<div class="us-row ${f.status}"><span class="us-ic" style="color:${COL[f.status] || "var(--muted)"}">${ICO[f.status] || "·"}</span><b class="us-name">${esc(f.name)}</b><span class="us-vals">${f.save != null ? `<span class="us-src">save</span>${vfm(f.save)}` : ""}${f.save != null && f.telemetry != null ? `<span class="us-x">×</span>` : ""}${f.telemetry != null ? `<span class="us-src tel">📡</span>${vfm(f.telemetry)}` : ""}</span>${f.note ? `<div class="us-note">${esc(f.note)}</div>` : ""}</div>`; };
      const fields = (u.fields || []).slice().sort((a, b) => (ORD[a.status] ?? 9) - (ORD[b.status] ?? 9));
      const asks = (!uopts.noAsks && (u.asks || []).length) ? `<div class="us-asks"><div class="us-asks-h">📡 DRIVE TO RAISE CONFIDENCE</div>${u.asks.map((a) => `<div class="us-ask"><span class="us-ask-arrow">▸</span><span>${esc(a.text)}</span><span class="us-gain">${esc(a.gain)}</span></div>`).join("")}</div>` : "";
      return `<div class="us${u.n_conflict ? " has-conflict" : ""}"><div class="us-hd"><b>🔗 Save × telemetry — one reconciled decode</b>${chips}</div>${fields.map(frow).join("")}${asks}</div>`;
    };
    // ---- TUNE LIBRARY: categorized by BUILD — the exact PARTS fingerprint of each save (byte-exact from disk).
    // PI can't be the category (at a class cap, different part combos share one PI), so builds are: A, B, C… newest
    // first, each with its observed PI (stamped once driven), its saves (slider iterations of that build), and the
    // exact UPGRADE-PART diffs vs Build A. The equipped build carries 🎮 from the live match. ----
    const tuneLibraryCard = (r, ordinal) => {
      const m = r.match; const saves = (m && m.saves) || [];
      if (saves.length < 2 && (m && m.how) !== "unsaved-build") return "";   // a detected unsaved build shows the library even with one save — that's the whole point
      const cur = String(r.ts); const eqLive = m.how === "signature" || m.how === "gear-matched"; const pinnedPick = m.how === "picked";
      const saveBtn = (s) => { const on = String(s.ts) === cur;
        const flag = on && eqLive ? "🎮 " : on && pinnedPick ? "📌 " : "";   // 🎮 = live-verified equipped; 📌 = manually pinned (no live verification)
        return `<button class="tl-save${on ? " on" : ""}" data-diskpick="${ordinal}|${s.ts}" title="${s.locked ? "downloaded / locked" : "self-made"} · saved ${_tsFmt(s.ts)} · click to decode this build${on && pinnedPick ? " · pinned manually — not live-verified" : ""}">${flag}${_tsFmt(s.ts)}${s.gears ? ` · ${s.gears}-sp` : ""}${s.locked ? " 🔒" : ""}</button>`; };
      const byTs = new Map(saves.map((s) => [String(s.ts), s]));
      let rows, nCats;
      if ((m.builds || []).length) {
        nCats = m.builds.length;
        rows = m.builds.map((b) => {
          const items = (b.saves || []).map((ts) => byTs.get(String(ts))).filter(Boolean).map(saveBtn).join("");
          const holdsCur = (b.saves || []).some((ts) => String(ts) === cur);
          const dchips = (b.diff_vs_A || []).map((d) => `<span class="tl-diff">${esc(d)}</span>`).join("");
          const more = b.n_diffs > (b.diff_vs_A || []).length ? `<span class="tl-diff">+${b.n_diffs - b.diff_vs_A.length} more</span>` : "";
          // build↔livery: pinned association or a save-time-proximity guess (labelled). Click to cycle through this
          // car's liveries (…last → none → first); any click PINS your choice — user truth beats the guess.
          const lv = b.livery;
          const cyc = `data-cyclelivery="${ordinal}|${esc(b.build)}|${esc((lv && lv.dir) || "")}"`;
          const lvTitle = lv ? `${esc(lv.name || "livery")}${lv.source === "guess" ? ` · GUESS (saved ~${lv.dt_h}h apart) — click to change/confirm` : lv.source === "auto" ? " · auto-associated (saved while this build was verified equipped) — click to change" : " · pinned — click to change"}` : "no livery associated — click to assign from this car's liveries";
          const lvCell = lv
            ? (lv.thumb ? `<img class="tl-blvy" src="${liveUrl}/livery-thumb?d=${encodeURIComponent(lv.dir)}" loading="lazy" alt="" ${cyc} title="${lvTitle}">`
                        : `<span class="tl-blvy-chip" ${cyc} title="${lvTitle}">🎨 ${esc(lv.name || "livery")}${lv.source === "guess" ? " ≈" : ""}</span>`)
            : `<span class="tl-blvy-none" ${cyc} title="${lvTitle}">🎨+</span>`;
          return `<div class="tl-bucket${holdsCur ? " cur" : ""}">${lvCell}<span class="tl-sig"><b>Build ${esc(b.label)}</b> · ${b.pi != null ? piBadge(null, b.pi, true) : `<span class="why" title="PI is stamped the first time this exact build is driven">PI ? — drive to stamp</span>`}${b.cyl != null ? ` · ${b.cyl}-cyl` : ""}${b.gears ? ` · ${b.gears}-sp` : ""}${lv && lv.source === "guess" ? `<span class="tl-tie" title="associated by save-time proximity, not recorded by the game — click the thumbnail to confirm or change">livery ≈ guess</span>` : ""}</span><span class="tl-saves">${items}</span>${b.label !== (b.diff_base || "A") && (dchips || more) ? `<div class="tl-diffs"><span class="why" style="font-size:9.5px">vs ${esc(b.diff_base || "A")}:</span> ${dchips}${more}</div>` : ""}</div>`;
        }).join("");
      } else {   // old daemon payload — fall back to signature buckets
        const buckets = new Map();
        saves.forEach((s) => { const k = `${s.cyl != null ? s.cyl : "?"}|${s.pi != null ? s.pi : "?"}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(s); });
        nCats = buckets.size;
        rows = [...buckets.entries()].map(([k, list]) => {
          const [cyl, pi] = k.split("|");
          return `<div class="tl-bucket"><span class="tl-sig">${pi !== "?" ? piBadge(null, pi, true) : "<b>PI ?</b>"} · ${cyl !== "?" ? cyl + "-cyl" : "engine ?"}</span><span class="tl-saves">${list.map(saveBtn).join("")}</span></div>`;
        }).join("");
      }
      // GARAGE-INSTANCE reality check: FH6 stores tune containers per MODEL + save event — two garage cars of the
      // same model do NOT get separate tune files, and no livery↔tune link exists on disk. When the car has liveries,
      // show them inline here so the picker at least carries the visual identity, and say what the game can't record.
      // a live-DETECTED distinct build gets its own synthetic row — it exists in the garage but not on disk
      const unsavedRow = m.how === "unsaved-build" ? `<div class="tl-bucket"><span class="tl-sig"><b>🚧 unsaved build</b> · detected live<span class="tl-tie" title="measured ${esc((m.evidence || []).join(" + "))} contradicts every saved tune — same cylinders + PI (class-cap convergence), different parts">${esc((m.evidence || []).join(" + ")) || "measured"} differs</span></span><span class="tl-saves"><span class="why" style="font-size:10.5px">change a part/slider + SAVE (own), or apply a DIFFERENT tune then re-apply (downloaded) → it becomes a real entry here</span></span></div>` : "";
      // (the duplicate 'tl-worn' gallery was removed — audit F2: it repeated the livery strip with less information;
      // the per-build cells above remain the association editor, the strip remains the one gallery)
      return `<details class="tl"${nCats > 1 ? " open" : ""} data-dk="tl"><summary><b>📚 Tune library</b> <span class="why" style="font-size:10.5px">${saves.length} saved tune${saves.length > 1 ? "s" : ""} · <b>${nCats} distinct build${nCats > 1 ? "s" : ""}</b> (by upgrade parts)${eqLive ? " · 🎮 = equipped" : pinnedPick ? " · 📌 = pinned (not live-verified)" : " · drive to flag the equipped one"}</span></summary>${rows}${unsavedRow}</details>`;
    };
    // ---- LIVERY GALLERY: the paintjob thumbnails from the save's Livery containers — the visual identity players
    // actually use to tell builds apart. No tune↔livery link exists on disk (both key by car only), so this is a
    // recognition aid, not an identity key: you see YOUR paint, you know YOUR build. READ-ONLY via the daemon. ----
    const fetchLiveries = (ord) => {
      if (!ord || !live.connected) return;
      live.liveryCache = live.liveryCache || {};
      if (live.liveryCache[ord] !== undefined) return;   // cached or in-flight
      live.liveryCache[ord] = null;
      fetch(liveUrl + "/liveries?ordinal=" + ord).then((r) => r.json())
        .then((d) => { live.liveryCache[ord] = { n: (d.liveries || []).length, list: d.liveries || [] }; paintDiskDecode(); paintFloat(); })
        .catch(() => { live.liveryCache[ord] = { n: 0, list: [] }; setTimeout(() => { if (live.liveryCache && live.liveryCache[ord] && !live.liveryCache[ord].n) delete live.liveryCache[ord]; }, 30000); });   // a fetch error must not cache 'no liveries' forever — retry on the next paint after 30s
    };
    const liveryStrip = (ord, mm, curTs) => {
      live.liveryCache = live.liveryCache || {};
      const c = live.liveryCache[ord];
      if (c === undefined) { fetchLiveries(ord); return ""; }
      if (!c) return "";
      // ZERO entries is itself information: an untouched factory-paint car writes NO livery container at all (verified
      // across the garage — 47/160 tuned cars). Say so, instead of an ambiguous blank.
      if (!c.n) return `<div class="lvy-strip"><div class="lvy-h">🎨 Liveries on this car <span class="why" style="font-size:10px">— none saved</span></div><div class="lvy-chips"><span class="lvy-chip" title="no Livery / BaseLivery container exists for this car — the game only writes one when you save a design or apply a paint">🏭 factory paint — never repainted</span></div></div>`;
      // ASSOCIATION back-projection: liveries the identification algorithm has tied to a BUILD carry that build's tune
      // specs as a badge (🪪 E · PI 800 · 8sp); the CURRENTLY DECODED tune's livery gets the strongest highlight.
      const assoc = {};
      (((mm || {}).builds) || []).forEach((b) => { if (b.livery && b.livery.dir) {
        const isCur = (b.saves || []).some((ts) => String(ts) === String(curTs));
        if (!assoc[b.livery.dir] || isCur) assoc[b.livery.dir] = { label: b.label, pi: b.pi, gears: b.gears, source: b.livery.source, isCur }; } });
      const specTxt = (a) => `Build ${a.label}${a.pi != null ? ` · PI ${a.pi}` : ""}${a.gears ? ` · ${a.gears}-sp` : ""}${a.source === "guess" ? " ≈" : ""}`;   // plain — for title= sinks
      const specHtml = (a) => `Build ${esc(a.label)}${a.pi != null ? ` ${piBadge(null, a.pi, true)}` : ""}${a.gears ? ` · ${a.gears}-sp` : ""}${a.source === "guess" ? " ≈" : ""}`;   // badge — for innerHTML sinks
      const cards = c.list.filter((l) => l.thumb).slice(0, 12).map((l) => { const a = assoc[l.dir];
        const badge = a ? `<span class="lvy-badge${a.isCur ? " cur" : ""}" title="${a.source === "pinned" ? "pinned — this livery wears this tune" : a.source === "auto" ? "auto-associated — saved while this build was verified equipped" : "guessed from save-time proximity — confirm in the library"}">🪪 ${specHtml(a)}</span>` : "";
        return `<figure class="lvy${a ? " assoc" : ""}${a && a.isCur ? " assoc-cur" : ""}" title="${esc([l.name, l.desc, l.creator && ("by " + l.creator)].filter(Boolean).join(" · ") || l.kind)}${a ? " · " + esc(specTxt(a)) : ""}">${badge}<img src="${liveUrl}/livery-thumb?d=${encodeURIComponent(l.dir)}" loading="lazy" alt="livery"><figcaption>${esc(l.name || (l.kind === "SoulBoundLivery" ? "soul-bound" : l.kind === "BaseLivery" ? "base paint" : "design"))}${a && a.isCur ? `<b class="lvy-cur-tag"> ◀ this tune</b>` : ""}</figcaption></figure>`; }).join("");
      // PAINT-ONLY case: a plain paintjob saves a BaseLivery container with NO thumbnail (the game only renders
      // bigThumb.webp for full designs), and its name is the generic 'Forza BaseLivery'. Show those as labelled
      // chips with the save date — still a recognition cue, honestly presented as paint rather than a design.
      const chips = c.list.filter((l) => !l.thumb).slice(0, 8).map((l) => { const a = assoc[l.dir];
        const generic = /^Forza (Base|SoulBound)?Livery$/i.test(l.name || "");
        const label = (l.name && !generic) ? l.name : (l.kind === "BaseLivery" ? "base paint" : l.kind === "SoulBoundLivery" ? "soul-bound livery" : "design");
        return `<span class="lvy-chip${a ? " assoc" : ""}${a && a.isCur ? " assoc-cur" : ""}" title="${esc([l.name, l.desc, l.creator && ("by " + l.creator)].filter(Boolean).join(" · ") || l.kind)}${a ? " · " + esc(specTxt(a)) : ""}">🎨 ${esc(label)}${l.ts ? ` · ${_tsFmt(l.ts)}` : ""}${a ? ` <b>🪪 ${specHtml(a)}</b>${a.isCur ? " ◀" : ""}` : ""}</span>`; }).join("");
      if (!cards && !chips) return "";
      const note = cards ? "— the paint is how you know the build at a glance · 🪪 = tune association" : "— paint-only (the game saves no thumbnail for plain paintjobs)";
      return `<div class="lvy-strip"><div class="lvy-h">🎨 Liveries on this car <span class="why" style="font-size:10px">${note}</span></div><div class="lvy-row">${cards}${chips ? `<div class="lvy-chips">${chips}</div>` : ""}</div></div>`;
    };
    const diskDeliverableHtml = (r, opts) => {
      opts = opts || {};
      ensureFhmCss();
      const vp = (opts.verify && opts.verify.parts) || {}; const vsl = (opts.verify && opts.verify.sliders) || {};
      const dl = r && r.deliverable; if (!dl) return "";
      const oc = confCol(dl.confidence); const sm = dl.summary || {};
      const f = live.frame; const fMatch = f && String(f.car) === String(dl.ordinal);
      const badge = (fMatch && f.cls) ? `${piBadge(f.cls, f.pi)}${f.drv ? ` <span class="chip" style="border-color:var(--accent2);color:var(--accent2)">${esc(f.drv)}</span>` : ""}` : "";   // the in-game class badge, not a hand-rolled chip
      const lockChip = dl.locked ? `<span class="chip" style="border-color:#e3b341;color:#e3b341" title="downloaded / locked in-game — the save file still holds its real values">🔒 downloaded</span>` : `<span class="chip" style="border-color:#00d27a;color:#00d27a">self-made</span>`;
      const cats = (dl.menus || []).map((m) => {
        const inst = m.rows.filter((x) => !x.stock).length;
        const rows = m.rows.map((it) => {
          const cls = it.stock ? "stock" : (it.conf === "dim" ? "dim" : it.conf === "cosmetic" ? "cosmetic" : it.conf === "category" ? "category" : "named");
          const pi = it.pi != null ? `<span class="fhm-pi" title="estimated PI cost vs stock — self-building from your driven configs">+${it.pi}</span>` : "";
          const sub = it.engine_type ? `<div class="fhm-prow-sub${it.engine_type_conf === "measured" ? " meas" : ""}" title="${it.engine_type_conf === "measured" ? "from live telemetry (cyl / redline / hp)" : "from the save + build capture — drive it for measured cyl / hp"}">${it.engine_type_conf === "measured" ? "📡 " : ""}${esc(it.engine_type)}</div>` : "";
          const noteSub = it.note ? `<div class="fhm-prow-sub" style="font-style:italic">ℹ ${esc(it.note)}</div>` : "";
          const swapHint = (it.item === "powertrain" && !it.stock && it.engine_family != null) ? `<div class="fhm-prow-sub" style="color:var(--accent2);font-style:normal" title="the engine's identity is recovered from the save's engine-internals family (${it.engine_family}) — the old decode read the wrong byte and called every car stock. In-game, open Engine Swap and pick the tile whose signature matches.">🔧 Engine Swap menu → match this tile${it.engine_catalog && it.engine_catalog.shared_swap ? " · shared swap engine" : ""}</div>` : "";
          return `<div class="fhm-prow ${it.stock ? "stock" : ""}"><span>${vdot(vp[it.item])}${esc(it.item.replace(/_/g, " "))}${sub}${noteSub}${swapHint}</span>${fhmPips(it.upgrade || "")}<span class="fhm-up ${cls}">${esc(it.upgrade || it.value)}${pi}</span></div>`;
        }).join("");
        return `<div class="fhm-cat"><div class="fhm-cath"><span class="bar"></span><b>${esc(m.menu)}</b><span class="k">${inst}/${m.rows.length}</span></div>${rows}</div>`;
      }).join("");
      const tabsHtml = (dl.tabs || []).map((t) => {
        const secs = []; const at = {};
        t.rows.forEach((row) => { if (at[row.section] == null) { at[row.section] = secs.length; secs.push({ h: row.section, rows: [] }); } secs[at[row.section]].rows.push(row); });
        const secHtml = secs.map((s) => `<div class="fhm-sec"><div class="fhm-sech">${esc(s.h)}</div>${s.rows.map((row) => {
          const rel = row.value == null; const pct = Math.max(2, Math.min(98, (row.fill || 0) * 100));
          const val = rel
            ? `<span class="fhm-slv pos">${row.norm != null ? Math.round(row.norm * 1000) / 10 : Math.round((row.fill || 0) * 1000) / 10}%${row.per_car && !String(row.field).startsWith("gear") ? ` <button class="fhm-caljump" data-caljump="cal-${dl.ordinal}-${esc(row.field)}" title="set the exact value — jumps to the one-time calibration above">🎯 set${(row.cal_points || 0) >= 1 ? " · 1/2" : ""}</button>` : ""}</span>`
            : `<span class="fhm-slv${row.derived ? " derived" : ""}"${row.derived ? ' title="derived from the global gear / final-drive band — exact on your next gear-ladder drive"' : ""}>${esc(String(row.value))}<small style="font-size:10px;color:var(--muted);margin-left:2px">${esc(row.unit || "")}</small></span>${row.conflict ? `<span class="fhm-cflag" title="COMPETING VALUES — the save decodes ${row.conflict.save} but telemetry measures ${row.conflict.telemetry}; showing the telemetry read at low confidence">⚠ save ${row.conflict.save}</span>` : row.agree ? `<span class="fhm-aflag" title="corroborated — the save's value and the telemetry measurement agree">✓×2</span>` : ""}`;
          return `<div class="fhm-sl"><div class="fhm-slt"><span class="fhm-sll">${vdot(vsl[row.field])}${esc(row.label || row.field)}</span>${val}</div><div class="fhm-trk"><span class="rail"></span><span class="fill ${rel ? "pos" : ""}" style="width:${pct}%"></span><span class="knob ${rel ? "pos" : ""}" style="left:${pct}%"></span></div><div class="fhm-pol"><span>◄ ${esc((row.poles || [])[0] || "")}</span><span>${esc((row.poles || [])[1] || "")} ►</span></div></div>`;
        }).join("")}</div>`).join("");
        return `<div style="margin-bottom:13px"><div class="fhm-tab">${esc(t.tab)}</div>${secHtml}</div>`;
      }).join("");
      const cf = diskConf(r);
      const popBtn = opts.popBtn ? (cf && cf.reasonable ? `<button class="lab-mode" data-popout="${dl.ordinal}" title="keep this build on screen while you navigate the upgrade / tune menus" style="padding:3px 10px;font-size:11px;border-color:#a371f7;color:#a371f7;margin-left:auto">📌 Pop out</button>` : `<button class="lab-mode" disabled title="reach reasonable confidence first — see the checklist below" style="padding:3px 10px;font-size:11px;border-color:var(--line);color:var(--muted);margin-left:auto;opacity:.55;cursor:not-allowed">📌 Pop out</button>`) : "";
      const headRow = opts.inFloat ? "" : `<div class="card-row" style="margin-top:0"><h3 style="margin:0">📀 On-disk tune — ${esc(r.name || "#" + dl.ordinal)}</h3>${badge}${lockChip} <span class="chip">${dl.gear_count}-speed</span>${popBtn}</div>`;
      // ---- CONSOLIDATED assembly: CONFIDENCE is the primary section. Identity (match), the confidence meter, one
      // contributor-chip row and the single ranked ask list form the master panel; everything that used to stack as
      // parallel cards (union detail, sanity, PI budget, calibration) becomes a DRAWER feeding it — same information,
      // one hierarchy, no duplicate prompts. Drawers auto-open only when they carry something red. ----
      const u2 = dl.union || {};
      const drvX = (() => { const cm = (dl.menus || []).find((m) => m.menu === "Conversions"); const dr2 = cm && (cm.rows || []).find((x) => x.item === "drivetrain"); return (dr2 && dr2.resulting_drivetrain) || (live.frame && live.frame.on && live.frame.drv) || null; })();
      const sanI = (dl.tabs || []).length ? sanityCheck(dl, drvX || "?") : [];
      const sanE = sanI.filter((x) => x.lvl === "error").length, sanW = sanI.filter((x) => x.lvl === "warn").length;
      const exactN = sm.sliders_exact != null ? sm.sliders_exact : (sm.sliders_absolute || 0); const relN = sm.sliders_relative || 0;
      const piKnown = sm.pi_known_parts || 0, piTot = sm.pi_total_parts || 0;
      const c2 = (txt, cls, title) => `<span class="us-chip ${cls}"${title ? ` title="${esc(title)}"` : ""}>${txt}</span>`;
      const contrib = [
        c2(`${sm.parts_installed} parts exact`, "ok", "every installed part decodes byte-exact from the save"),
        c2(`${exactN} sliders exact${sm.sliders_derived ? ` · ${sm.sliders_derived} derived` : ""}${relN ? ` · ${relN} by %` : ""}`, relN ? "wait" : "ok", relN ? "%-sliders lock exact via the 🎯 calibration drawer" : "all slider values absolute"),
        u2.n_agree ? c2(`✓ ${u2.n_agree} corroborated`, "ok", "save × telemetry agree — see the 🔗 drawer") : "",
        u2.n_conflict ? c2(`⚠ ${u2.n_conflict} conflict${u2.n_conflict > 1 ? "s" : ""}`, "bad", "save and telemetry disagree — the 🔗 drawer has both values") : "",
        u2.n_await ? c2(`○ ${u2.n_await} awaiting telemetry`, "wait", "the ask list below says which drive provides each") : "",
        (sanE || sanW) ? c2(`🩺 ${sanE ? sanE + " error" + (sanE > 1 ? "s" : "") : ""}${sanE && sanW ? " · " : ""}${sanW ? sanW + " warning" + (sanW > 1 ? "s" : "") : ""}`, sanE ? "bad" : "wait", "tuning sanity findings — the 🩺 drawer has the fixes") : ((dl.tabs || []).length ? c2("🩺 clean", "ok", "no sanity findings on this tune") : ""),
        (piTot || sm.pi_total != null) ? c2(`🧮 ${sm.pi_total != null ? piBadge(null, sm.pi_total, true) + " · " : "PI "}${piKnown}/${piTot} priced`, (piKnown >= piTot && piTot) ? "ok" : "wait", "per-part PI accrues as configs are driven — details in the 🧮 drawer") : "",
      ].filter(Boolean).join("");
      const asksHtml = (u2.asks || []).length ? `<div class="us-asks"><div class="us-asks-h">📡 DRIVE TO RAISE CONFIDENCE</div>${u2.asks.map((a) => `<div class="us-ask"><span class="us-ask-arrow">▸</span><span>${esc(a.text)}</span><span class="us-gain">${esc(a.gain)}</span></div>`).join("")}</div>` : "";
      const drawer = (title, body, open) => body ? `<details class="idm-drawer" data-dk="${esc(title.slice(0, 2))}"${open ? " open" : ""}><summary>${title}</summary><div class="idm-dbody">${body}</div></details>` : "";
      const piHtml = (() => { if (!piTot && sm.pi_total == null) return ""; const priced = piKnown >= piTot && piTot > 0;
        const oc2 = sm.pi_obs_car || 0, ot2 = sm.pi_obs_total || 0;
        return `<div class="fhm-pi-budget${priced ? " ok" : ""}" title="Per-part PI self-builds from your driven configs: two decoded builds of the same car differing by one part reveal that part's PI."><span class="lbl">🧮 PI budget</span>${sm.pi_total != null ? `${piBadge(null, sm.pi_total, true)} total` : `<span class="why">total unknown — drive this exact build once</span>`}${sm.pi_attributed != null ? ` · <b>${sm.pi_attributed}</b> attributed` : ""} · <span class="why">${piKnown}/${piTot} parts priced${piKnown < piTot ? " — accrues as you drive" : ""}</span> · <span class="why" title="configs the daemon has paired with a live PI — this car / whole garage">📈 ${oc2} this car · ${ot2} total observed</span></div>`; })();
      // frame color follows the MATCH state, never a hardcoded green — green claimed "trustable" even over a
      // distinct-build warning (audit F3/F11); the confidence color oc carries the verified case.
      const mm0 = r.match || {};
      const frameCol = (mm0.how === "no-match" || mm0.how === "unsaved-build") ? "#e5414e" : (u2.n_conflict ? "#e3b341" : oc);
      const idmBlock = `<div class="idm">
          ${diskMatchBar(r, dl.ordinal)}
          ${confMeterHtml(r)}
          ${(() => {   // RECOGNITION IDENTITY line — decode % measures how completely the tune FILE reads; WHICH of
            // your cars wears it is a separate axis the player recognises by PAINT. Say its state explicitly.
            const mm = r.match || {}; const curB = (mm.builds || []).find((b) => (b.saves || []).some((ts) => String(ts) === String(r.ts)));
            if (!curB) return "";
            const lv = curB.livery;
            const cyc = `data-cyclelivery="${dl.ordinal}|${esc(curB.build)}|${esc((lv && lv.dir) || "")}"`;
            const img = lv && lv.thumb ? `<img class="tl-blvy" src="${liveUrl}/livery-thumb?d=${encodeURIComponent(lv.dir)}" ${cyc} title="click to change">` : "";
            if (lv && lv.source === "pinned") return `<div class="idm-id ok">${img}🪪 this tune is <b>Build ${esc(curB.label)}</b> · worn livery: <b>${esc(lv.name || "pinned design")}</b> <span class="why">pinned by you — recognition certain</span></div>`;
            if (lv && lv.source === "auto") return `<div class="idm-id ok">${img}🪪 this tune is <b>Build ${esc(curB.label)}</b> · worn livery: <b>${esc(lv.name || "design")}</b> <span class="why">auto-associated — this livery was saved while the build was verified equipped (click to change)</span></div>`;
            if (lv) return `<div class="idm-id guess">${img}🪪 <b>Build ${esc(curB.label)}</b> · worn livery: <b>≈ ${esc(lv.name || "design")}</b> <span class="why">a GUESS from save-time proximity (~${lv.dt_h}h) — click the thumbnail to confirm or change</span></div>`;
            // ONE-TAP PICKER: the game never records which car wears which paint (GarageLayout blobs are encrypted —
            // probed), so at the moment the build is VERIFIED we show the car's liveries as direct choices: one glance,
            // one tap, pinned to the right build while the identity is certain.
            const lc2 = (live.liveryCache || {})[String(dl.ordinal)];
            const opts2 = ((lc2 && lc2.list) || []).slice(0, 6).map((l) => l.thumb
              ? `<img class="idm-pick" src="${liveUrl}/livery-thumb?d=${encodeURIComponent(l.dir)}" loading="lazy" alt="" title="tap: Build ${esc(curB.label)} wears ${esc(l.name || "this design")}" data-picklivery="${dl.ordinal}|${esc(curB.build)}|${esc(l.dir)}">`
              : `<span class="idm-pick chip" data-picklivery="${dl.ordinal}|${esc(curB.build)}|${esc(l.dir)}" title="tap: Build ${esc(curB.label)} wears this">🎨 ${esc(l.name && !/^Forza/.test(l.name) ? l.name : (l.kind === "BaseLivery" ? "base paint" : "soul-bound"))}</span>`).join("");
            return `<div class="idm-id unknown">🪪 <b>Build ${esc(curB.label)}</b> · <b>worn livery unknown</b>${opts2 ? ` — <b>tap the paint this car is wearing:</b> <span class="idm-picks">${opts2}</span>` : ` <span class="tl-blvy-none" ${cyc}>🎨+</span>`} <span class="why">the game never records this — one tap pins it for good</span></div>`;
          })()}
          <div class="idm-chips">${contrib}</div>
          ${asksHtml}
        </div>`;
      const colsBlock = `<div class="fhm-cols"><div><div class="fhm-sub">🔧 Upgrades — the parts to install</div>${cats}</div><div><div class="fhm-sub">🎛 Tuning — the sliders to set</div>${tabsHtml}</div></div>`;
      const drawers = `${drawer(`🔗 Save × telemetry — field detail${u2.n_conflict ? ` <span class="idm-flag">⚠ ${u2.n_conflict}</span>` : ""}`, unionStrip(dl, { noAsks: true }), !!u2.n_conflict)}
        ${drawer(`🩺 Sanity check${sanE || sanW ? ` <span class="idm-flag${sanE ? "" : " warn"}">${sanE ? "⛔ " + sanE : ""}${sanE && sanW ? " · " : ""}${sanW ? "⚠ " + sanW : ""}</span>` : " — clean"}`, sanI.length ? sanityPanel(dl, drvX) : "", sanE > 0)}
        ${drawer(`🧮 PI budget — per-part pricing`, piHtml, false)}
        ${drawer(`🎯 Calibration${relN ? ` <span class="idm-flag warn">${relN} pending</span>` : ""}`, calibrationCard(dl), false)}`;
      // ---- STREAMLINED assembly (UX audit, second pass): ONE glanceable identity ribbon, payload immediately,
      // EVERYTHING else in drawers. The dock's 📡 pill carries the persistent ask signal, so the sheet stays quiet.
      const curB0 = (mm0.builds || []).find((b) => (b.saves || []).some((ts) => String(ts) === String(r.ts)));
      const ribThumb = curB0 && curB0.livery && curB0.livery.thumb ? `<img class="tl-blvy" src="${liveUrl}/livery-thumb?d=${encodeURIComponent(curB0.livery.dir)}" alt="" title="${esc((curB0.livery.name || "livery") + (curB0.livery.source === "guess" ? " (guess)" : ""))}">` : curB0 && curB0.livery ? `<span class="tl-blvy-chip" title="paint-only — no thumbnail exists on disk">🎨 ${esc(curB0.livery.name || "base paint")}${curB0.livery.source === "guess" ? " ≈" : ""}</span>` : "";
      const verdictChip = mm0.how === "gear-matched" ? `<span style="color:#00d27a;font-weight:700">⚙ verified${mm0.held ? " · held" : ""}</span>`
        : mm0.how === "picked" ? `<span style="color:#a371f7;font-weight:700">📌 pinned</span>`
        : (mm0.how === "no-match" || mm0.how === "unsaved-build") ? `<span class="idm-flag">build file missing</span>`
        : (mm0.n_signature_ties || 1) >= 2 ? `<span class="idm-flag warn">${mm0.n_signature_ties} candidates — drive the gears</span>`
        : `<span class="why">${esc(mm0.how || "")}</span>`;
      const flags = `${u2.n_conflict ? `<span class="idm-flag" title="save × telemetry disagree — 🔗 drawer">⚠ ${u2.n_conflict}</span>` : ""}${sanE ? `<span class="idm-flag" title="sanity errors — 🩺 drawer">⛔ ${sanE}</span>` : sanW ? `<span class="idm-flag warn" title="sanity warnings — 🩺 drawer">🩺 ${sanW}</span>` : ""}${relN ? `<span class="idm-flag warn" title="%-sliders to calibrate — 🎯 drawer">🎯 ${relN}</span>` : ""}`;
      // ---- RATIFICATION VERDICT: the ONE answer this card must give — is the tune FINISHED, and if not, exactly
      // what finishes it. Every ingredient already exists in the flags/drawers; this states them as one numbered
      // checklist that never hides. Ratified = identity verified · no conflicts · no sanity errors · every value
      // exact · PI stamped. Awaiting-telemetry corroboration does NOT block (it is enrichment, not doubt). ----
      // ---- RATIFICATION LEDGER: FIVE fixed requirements. The section NEVER changes shape — only checkmarks move.
      // Each requirement LATCHES per build (ordinal + fingerprint): once fulfilled it stays fulfilled until POSITIVE
      // contradiction. Absence of signal (parked, menus, a fresh daemon, a cache miss) never un-checks anything —
      // that was the volatility: the list was a snapshot of flickering inputs, not a ledger of requirements.
      const bcR = buildConfidence(r);
      const ordL = String(dl.ordinal); const sigL = (curB0 && curB0.build) || "nosig";   // sig from the RENDERED payload, never a live lookup — mixing them latched the clone TARGET's ledger with the WIP build's evidence (split-brain)
      const ledFrozen = !!(live.cloneTarget && live.cloneTarget.ordinal === +dl.ordinal);   // a frozen target's ledger is read-only: the live car's driving must not earn or destroy ITS latches
      const ledKey = "fh6Ratif:" + ordL + "|" + sigL;
      let led = {}; try { led = JSON.parse(localStorage.getItem(ledKey) || "{}") || {}; } catch (e) {}
      const regrWhy = confirmRegressReason(r);
      const idNowOk = !bcR.hardBlock && !bcR.softNoLive;
      if (!ledFrozen) {
        if (idNowOk) led.identity = { ok: true, at: Date.now(), note: bcR.matchLbl };
        else if (regrWhy) delete led.identity;   // positive contradiction — everything else keeps the latch
      }
      const idOk = !!(led.identity && led.identity.ok);
      const piNow = curB0 && curB0.pi != null ? curB0.pi : null;
      if (!ledFrozen && piNow != null) led.pi = { v: piNow, at: Date.now() };   // the physical fact "this config's PI is known" does not become false on a cache/hash migration
      const piOk = !!(led.pi && led.pi.v != null);
      if (!ledFrozen) { try { localStorage.setItem(ledKey, JSON.stringify(led)); } catch (e) {} }
      const REQS = [
        { k: "identity", ok: idOk, lbl: "build identity verified", act: (bcR.need || [])[0] || "drive up through the gears — the ladder identifies the equipped build", note: idOk && !idNowOk ? "held from your last verified run" : idOk ? (led.identity.note || "") : "" },
        { k: "conflicts", ok: !u2.n_conflict, lbl: "save × telemetry agree", act: (dl.gear_diag || {}).kind === "fd" ? `gear conflict is a SYSTEMATIC offset (final-drive band) — re-saving cannot change a band-derived value: calibrate the final drive in the 🎯 drawer instead` : `resolve ${u2.n_conflict || 0} conflict${(u2.n_conflict || 0) > 1 ? "s" : ""} — re-save (own) or apply a different tune then re-apply (downloaded), then drive once · 🔗 drawer` },
        { k: "sanity", ok: !sanE, soft: true, lbl: "tuning sanity clean", act: `${sanE} finding${sanE > 1 ? "s" : ""} — 🩺 drawer (advisory: does not block ratification)` },
        { k: "calib", ok: !relN, lbl: "every slider value exact", act: dl.locked ? `calibrate ${relN} %-slider${relN > 1 ? "s" : ""} — a locked tune hides its sliders, so calibrate via ANY editable tune on this car (calibration is per-car and transfers): save your own tune once, do the 🎯 two-point read there, then re-apply this one` : `calibrate ${relN} %-slider${relN > 1 ? "s" : ""} — 🎯 drawer, two-point read` },
        { k: "pi", ok: piOk, lbl: "PI stamped", act: "drive this build once while identified — stamps its PI", note: piOk ? `PI ${led.pi.v}` : "" },
      ];
      const hard = REQS.filter((q) => !q.soft);   // sanity findings are ADVISORY — warnings, never ratification blockers
      const doneN = hard.filter((q) => q.ok).length; const ratified = doneN === hard.length;
      const ratCls = ratified ? "ok" : (u2.n_conflict || (!idOk && bcR.hardBlock)) ? "bad" : "no";
      const ratChip = ratified ? `<span class="rat-chip ok">✓ RATIFIED</span>` : `<span class="rat-chip ${ratCls}">◐ ${doneN}/${hard.length}</span>`;
      const ratifBlock = `<div class="ratif ${ratCls}"><b>${ratified ? "✅ TUNE RATIFIED" : `◐ RATIFICATION — ${doneN} of ${hard.length}`}</b>${ratified && u2.n_await ? ` <span class="why">${u2.n_await} field${u2.n_await > 1 ? "s" : ""} still corroborating in the background</span>` : ""}
        <div class="ratif-reqs">${REQS.map((q) => `<div class="ratif-req ${q.ok ? "done" : q.soft ? "adv" : "todo"}"><span class="rr-st">${q.ok ? "✓" : q.soft ? "⚠" : "○"}</span><span class="rr-lbl">${q.lbl}</span>${q.ok ? (q.note ? `<span class="why">${esc(q.note)}</span>` : "") : `<span class="rr-act">${esc(q.act)}</span>`}</div>`).join("")}</div></div>`;
      const ribbon = `<div class="idm-ribbon" style="border-color:${frameCol}">${ribThumb}<b>${curB0 ? "Build " + esc(curB0.label) : esc(r.name || "#" + dl.ordinal)}</b>${curB0 && curB0.pi != null ? `${piBadge(null, curB0.pi, true)}${curB0.gears ? `<span class="why"> · ${curB0.gears}-sp</span>` : ""}` : ""}${verdictChip}<span style="margin-left:auto;display:inline-flex;gap:7px;align-items:center">${ratChip}<span style="color:${oc};font-weight:800">${Math.round(dl.confidence * 100)}%</span></span>${flags}</div>`;
      // short warn line inline (action-first); the full match bar + picker live in the identity drawer
      const warnLine = (mm0.how === "no-match" || mm0.how === "unsaved-build")
        ? `<div class="dm-warn" style="margin:0 0 8px"><b>🚧 This build's file is not on disk.</b> Change a part/slider + SAVE (own) or apply a DIFFERENT tune then re-apply (re-applying the active tune writes nothing) — full detail in the 🪪 drawer.</div>` : "";
      const idDrawer = drawer("🪪 Identity, confidence, liveries &amp; library", idmBlock + liveryStrip(dl.ordinal, r.match, r.ts) + tuneLibraryCard(r, dl.ordinal), false);
      if (opts.inFloat) {
        return `<div class="block fhm" style="border-color:${frameCol}">${ribbon}${ratifBlock}${colsBlock}${idDrawer}${drawers}</div>`;
      }
      return `<div class="block fhm" style="border-color:${frameCol}">${headRow}
        ${warnLine}
        ${diskDiffBanner(dl.ordinal)}
        ${ribbon}
        ${ratifBlock}
        ${colsBlock}
        ${idDrawer}
        ${drawers}</div>`;
    };
    const fetchDiskTune = (ordinal, opts) => {
      opts = opts || {};
      if (!ordinal || !live.connected) return;   // 0 / null = no active car — never fetch
      live.diskCache = live.diskCache || {}; live.diskPick = live.diskPick || {}; live._diskGen = live._diskGen || {};
      if (!opts.force && Object.prototype.hasOwnProperty.call(live.diskCache, ordinal)) return;   // cached (incl. in-flight / negative)
      const gen = (live._diskGen[ordinal] = (live._diskGen[ordinal] || 0) + 1);   // generation token — a newer fetch supersedes stale/out-of-order responses
      live.diskCache[ordinal] = null;   // in-flight marker — avoids refetch storms
      const ts = live.diskPick[ordinal];   // a manual pick sticks across refetches until cleared
      fetch(liveUrl + "/disk-tune?ordinal=" + ordinal + (ts ? "&ts=" + encodeURIComponent(ts) : "")).then((r) => r.json()).then((d) => {
        if (live._diskGen[ordinal] !== gen) return;   // superseded — drop this stale response so the last-matched build wins
        live.diskCache[ordinal] = d && d.available ? d : { available: false };
        if (d && d.available) maybeFocusCourse(d.match, ordinal);   // a positive identification pulls focus to Course
        const filled = d && d.available ? applyDiskTune(d) : false;
        paintDiskDecode(); paintFloat();
        const activeOrd = live.frame && String(live.frame.car);
        if (filled && effMode() !== "decode" && activeOrd === String(ordinal)) paintSections(true);   // current values now known -> tuning panels show current -> target
      }).catch(() => { if (live._diskGen[ordinal] === gen) live.diskCache[ordinal] = { available: false }; });   // record failure (not delete) so it can't storm
    };
    // the live car's signature (cylinders + PI) identifies WHICH saved tune of a multi-build car is loaded; when it
    // changes (you switched builds), re-match — but ONLY after the new signature is stable (menu/half-load frames drop
    // cyl/PI and would otherwise storm), and NEVER while a clone target is locked (then we deliberately don't follow live).
    const diskSigCheck = (f) => {
      if (!f || !f.on || !f.car || !f.cyl || !f.pi) return;   // ignore blip frames (menus drop cyl/PI to 0/null)
      if (live.cloneTarget) return;                            // CLONE mode: the target is frozen — do not follow the live car
      live.diskSig = live.diskSig || {}; live.diskPick = live.diskPick || {}; live._sigPend = live._sigPend || {};
      const sig = `${f.cyl}|${f.pi}`;
      if (live.diskSig[f.car] === sig) { delete live._sigPend[f.car]; return; }
      const p = live._sigPend[f.car];                          // debounce: the new signature must hold a few frames before we act
      if (!p || p.sig !== sig) { live._sigPend[f.car] = { sig, n: 1 }; return; }
      if (++p.n < 3) return;
      delete live._sigPend[f.car]; live.diskSig[f.car] = sig;
      if (live.diskCache && Object.prototype.hasOwnProperty.call(live.diskCache, f.car) && !live.diskPick[f.car]) {
        delete live.diskCache[f.car]; fetchDiskTune(f.car, { force: true });   // re-match to the tune now loaded
      }
    };
    const pickDiskTune = (ordinal, ts) => {   // manual override: pin a specific saved tune (ts) or clear back to auto-match
      live.diskPick = live.diskPick || {};
      if (ts) live.diskPick[ordinal] = ts; else delete live.diskPick[ordinal];
      fetchDiskTune(ordinal, { force: true });
    };
    // CLONE-TARGET LOCK — the single explicit switch between the two intents. IDENTIFY (default) follows the live car
    // and re-decodes as you switch builds. LOCKED freezes ONE build as the target: the decode stops following the live
    // car (so building your replica never poisons it), and the daemon pauses PI/catalog accrual for that car.
    const lockCloneTarget = (ordinal) => {
      const c = live.diskCache && live.diskCache[ordinal];
      if (!c || !c.available) return;
      const f = live.frame; const snap = (f && String(f.car) === String(ordinal)) ? { pi: f.pi, cls: f.cls, drv: f.drv, cyl: f.cyl } : null;   // donor's live signature for the no-save coarse check
      live.cloneTarget = { ordinal: +ordinal, ts: c.ts, name: c.name, payload: c, live: snap, at: Date.now() };
      fetch(liveUrl + "/clone-lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordinal: +ordinal, ts: c.ts }) }).catch(() => {});
      paintDiskDecode(); paintFloat();
    };
    const unlockCloneTarget = () => {
      live.cloneTarget = null;
      fetch(liveUrl + "/clone-lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordinal: null }) }).catch(() => {});
      paintDiskDecode(); paintFloat();
    };
    // one banner that makes the mode unmistakable + carries the toggle
    const cloneModeBanner = (locked, payload) => {
      if (locked) {
        const t = live.cloneTarget || {}; const sm = ((t.payload || {}).deliverable || {}).summary || {};
        return `<div class="clone-mode locked"><div class="cm-txt"><b>🎯 CLONE TARGET LOCKED</b> — ${buildThumb(t.ordinal, t.build_id, true)} ${esc(t.name || "#" + t.ordinal)}${sm.pi_total ? ` ${piBadge(null, sm.pi_total, true)}` : ""}<div class="why">Frozen — not decoding your live car. Build your replica to match this. Accrual paused for this car so half‑built configs can't poison it.</div></div><button class="lab-mode" data-clone-unlock="1">🔍 Unlock · follow live</button></div>`;
      }
      const f = live.frame; const nm = (payload && payload.name) || (f && ((NAMES()[String(f.car)] || {}).name)) || "";
      const ord = (payload && payload.ordinal) || (f && f.car) || 0;
      return `<div class="clone-mode live"><div class="cm-txt"><b>🔍 IDENTIFYING</b> — following the car you're in${nm ? ` · ${esc(nm)}` : ""}<div class="why">This re‑reads as you switch builds. Lock it once you've found the build you want to clone.</div></div><button class="lab-mode" data-clone-lock="${ord}">🎯 Lock as clone target</button></div>`;
    };
    // keep the user's drawer toggles + scroll across key-based innerHTML rebuilds (audit F4): capture before, restore
    // after. A drawer the user explicitly set wins over the template's auto-open; a NEW drawer keeps its default.
    const captureUi = (el) => { const map = {}; el.querySelectorAll("details[data-dk]").forEach((d) => { map[d.dataset.dk] = d.open; }); const fb = el.querySelector(".fhm-fbody"); return { map, scroll: fb ? fb.scrollTop : null }; };
    const restoreUi = (el, st) => { if (!st) return; el.querySelectorAll("details[data-dk]").forEach((d) => { if (Object.prototype.hasOwnProperty.call(st.map, d.dataset.dk)) d.open = st.map[d.dataset.dk]; }); const fb = el.querySelector(".fhm-fbody"); if (fb && st.scroll != null) fb.scrollTop = st.scroll; };
    const bindDiskDecode = (el) => {
      el.querySelectorAll("[data-popout]").forEach((b) => b.addEventListener("click", () => popOutFloat(+b.dataset.popout)));
      el.querySelectorAll("[data-diskpick]").forEach((b) => b.addEventListener("click", () => { const [o, ts] = b.dataset.diskpick.split("|"); pickDiskTune(+o, ts || null); }));
      el.querySelectorAll("[data-clone-lock]").forEach((b) => b.addEventListener("click", () => lockCloneTarget(+b.dataset.cloneLock)));
      el.querySelectorAll("[data-clone-unlock]").forEach((b) => b.addEventListener("click", () => unlockCloneTarget()));
      el.querySelectorAll("[data-picklivery]").forEach((b3) => b3.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation();
        const [ordP, buildP, dirP] = b3.dataset.picklivery.split("|");
        fetch(liveUrl + "/build-livery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordinal: +ordP, build: buildP, dir: dirP }) })
          .then(() => { if (live.diskCache) delete live.diskCache[ordP]; fetchDiskTune(+ordP, { force: true }); }).catch(() => {});
      }));
      // audit F6: no more blind cycling — clicking the livery cell opens an INLINE tap-picker (thumbs + none + cancel);
      // one explicit choice pins, cancel restores, nothing is rewritten silently.
      el.querySelectorAll("[data-cyclelivery]").forEach((b2) => b2.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation();
        const [ordL, buildL] = b2.dataset.cyclelivery.split("|");
        const lc = (live.liveryCache || {})[String(ordL)];
        const opts = (lc && lc.list) || [];
        if (!opts.length) { fetchLiveries(ordL); return; }
        const pop = document.createElement("span"); pop.className = "idm-picks";
        const choose = (dir) => { fetch(liveUrl + "/build-livery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordinal: +ordL, build: buildL, dir: dir }) })
          .then(() => { if (live.diskCache) delete live.diskCache[ordL]; fetchDiskTune(+ordL, { force: true }); paintFloat(true); }).catch(() => {}); };
        opts.slice(0, 6).forEach((l) => { let o;
          if (l.thumb) { o = document.createElement("img"); o.className = "idm-pick"; o.src = liveUrl + "/livery-thumb?d=" + encodeURIComponent(l.dir); o.alt = ""; }
          else { o = document.createElement("span"); o.className = "idm-pick chip"; o.textContent = "🎨 " + (l.name && !/^Forza/.test(l.name) ? l.name : (l.kind === "BaseLivery" ? "base paint" : "soul-bound")); }
          o.title = "pin: " + (l.name || l.kind); o.addEventListener("click", (e) => { e.stopPropagation(); choose(l.dir); }); pop.appendChild(o); });
        const none = document.createElement("span"); none.className = "idm-pick chip"; none.textContent = "∅ none"; none.title = "clear the association";
        none.addEventListener("click", (e) => { e.stopPropagation(); choose(null); }); pop.appendChild(none);
        const cancel = document.createElement("span"); cancel.className = "idm-pick chip"; cancel.textContent = "✕"; cancel.title = "cancel — keep as is";
        cancel.addEventListener("click", (e) => { e.stopPropagation(); pop.replaceWith(b2); }); pop.appendChild(cancel);
        b2.replaceWith(pop);
      }));
      el.querySelectorAll("[data-caljump]").forEach((b) => b.addEventListener("click", () => {
        const t = el.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(b.dataset.caljump) : b.dataset.caljump));
        if (t) { let dd = t.closest("details"); while (dd) { dd.open = true; dd = dd.parentElement ? dd.parentElement.closest("details") : null; }   // the calibration card lives in a drawer now — open it before jumping
          t.scrollIntoView({ behavior: "smooth", block: "center" }); const i = t.querySelector("input"); if (i) { i.focus(); t.classList.add("cal-flash"); setTimeout(() => t.classList.remove("cal-flash"), 1200); } }
      }));
      el.querySelectorAll("[data-rangefield]").forEach((inp) => inp.addEventListener("change", () => {
        const v = parseFloat(inp.value); if (isNaN(v)) return; const ord = +inp.dataset.rangeord;
        const msg = inp.parentElement && inp.parentElement.querySelector(".fhm-rin-msg");
        const set = (t, c) => { if (msg) { msg.textContent = t; msg.style.color = c; } };
        set("saving…", "var(--muted)");
        fetch(liveUrl + "/tune-range", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ordinal: ord, field: inp.dataset.rangefield, norm: +inp.dataset.rangenorm, value: v, unit: inp.dataset.rangeunit }) })
          .then((r) => r.json()).then((d) => {
            if (!d || !d.ok) { inp.style.borderColor = "#e5414e"; set("✕ not saved" + (d && d.error ? " — " + d.error : ""), "#e5414e"); return; }
            if (d.solved) { inp.style.borderColor = "#00d27a"; set(`✓ locked ${d.solved[0]}–${d.solved[1]} ${inp.dataset.rangeunit || ""} — now exact`, "#00d27a"); }
            else { inp.style.borderColor = "#00d27a";
              set(`✓ anchored exact at this position (point ${d.distinct || 1}/2) — later, move the slider, re-save & enter again to lock the full range`, "#00d27a"); }
            if (live.diskCache) delete live.diskCache[ord]; fetchDiskTune(ord, { force: true });   // fresh decode either way → the anchored/exact value flows to the sheet, gears, union, sanity & A/B immediately
          }).catch(() => { inp.style.borderColor = "#e5414e"; set("✕ daemon offline", "#e5414e"); });
      }));
    };
    // FOCUS THE COURSE once identification goes POSITIVE: the moment the matcher verifies the equipped build while
    // you're on a course (timed event or marked loop), the identification job is done — foreground the Course
    // workflow instead of leaving the user parked in Decode (especially with manual mode pinned). Fires once per car
    // per verification; never while a clone workflow is active (that's a deliberate Decode stay).
    const focusToast = (txt) => { let t = document.getElementById("fhmToast"); if (!t) { t = document.createElement("div"); t.id = "fhmToast"; document.body.appendChild(t); ensureFhmCss(); } t.textContent = txt; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 4200); };
    const maybeFocusCourse = (m, ordinal) => {
      if (src !== "live" || !m) return;
      live._idFocused = live._idFocused || {};
      if (m.how !== "gear-matched") { delete live._idFocused[ordinal]; return; }
      if (live._idFocused[ordinal]) return;
      if (live.cloneTarget) return;                                              // cloning = a deliberate Decode stay
      if (live.mode && live.mode.suggest === "decode") return;                   // donor/replica run flagged
      const f = live.frame; const onCourse = !!((f && f.ev) || live.loop);
      if (!onCourse) return;
      live._idFocused[ordinal] = true;
      if (effMode() === "course") { focusToast("⚙ build identified — course feedback is live"); return; }
      if (labModeSel() !== "auto") localStorage.setItem("fh6LabMode", "course");   // J9: manual users get re-pinned; auto users stay auto (game-state detection lands on course itself)
      pushMode(); renderBody();
      focusToast("⚙ build identified — focusing Course");
    };
    const lastCarOrd = () => (live.courseCar ? +String(live.courseCar).split("|")[0] : 0);   // last car you drove (survives menu / upgrade-screen frames where CarOrdinal drops to 0)
    const paintDiskDecode = () => {
      const el = host.querySelector("#lvDiskDecode"); if (!el) return;
      // CLONE TARGET LOCKED: render the FROZEN target, not the live car — building your replica must never repoint it.
      if (live.cloneTarget && live.cloneTarget.payload && live.cloneTarget.payload.available) {
        const t = live.cloneTarget; const tgtDl = t.payload.deliverable;
        const f = live.frame; const fMatch = f && String(f.car) === String(t.ordinal);
        // progress toward the clone: the COARSE live check (PI/class/drivetrain/cyl — updates as you install parts, no
        // save needed) + the FINE part/slider verify against your latest SAVED build (dots go green as it matches).
        const cur = (live.diskCache && live.diskCache[t.ordinal]) || null;
        const verify = (cur && cur.available && cur.deliverable && cur.ts !== t.ts) ? verifyBuild(tgtDl, cur.deliverable) : null;
        const coarse = liveCoarse(t, f);
        // DYNAMIC key: re-render when your live signature (PI/cyl) moves OR your saved build changes OR the match count
        // shifts — so "building toward the clone" actually updates as you upgrade, instead of freezing at lock time.
        const key = "LOCK|" + t.ordinal + "|" + t.ts + "|" + (cur && cur.ts ? cur.ts : "-") + "|" + (fMatch ? f.pi + "." + f.cyl : "-") + "|" + (verify ? verify.okParts + "." + verify.okSliders : "-") + "|" + (((live.liveryCache || {})[t.ordinal] || {}).n || 0);
        if (el.dataset.fhmKey !== key || !el.querySelector(".fhm")) {
          el.dataset.fhmKey = key;
          const st = captureUi(el);
          el.innerHTML = cloneModeBanner(true) + coarseStrip(coarse) + verifyBanner(verify, !verify) + diskDeliverableHtml(t.payload, { popBtn: true, verify: verify });
          bindDiskDecode(el); restoreUi(el, st);
        }
        return;
      }
      const ord = (live.frame && live.frame.car) || lastCarOrd();
      if (!ord) { el.innerHTML = ""; return; }   // 0 / null = no active car (and none driven yet)
      live.diskCache = live.diskCache || {};
      const cached = live.diskCache[ord];
      if (cached === undefined) { fetchDiskTune(ord); el.innerHTML = `<div class="block" style="border-color:#00d27a"><p class="why" style="font-size:11px;margin:0">📀 reading the on-disk tune…</p></div>`; return; }
      if (cached === null) { el.innerHTML = `<div class="block" style="border-color:#00d27a"><p class="why" style="font-size:11px;margin:0">📀 reading the on-disk tune…</p></div>`; return; }
      if (!cached.available) {   // J1: the bootstrap action must be VISIBLE — silence read as "nothing to do" while the journey was stalled on a menu save
        el.innerHTML = `<div class="block" style="border-color:#e3b341"><b style="font-size:13px">📄 No tune file for this car yet</b><p class="why" style="font-size:11.5px;margin:4px 0 0">The decode reads the on-disk tune file, and this car has none. <b>Apply a downloaded tune from Find Tunes</b> (applying writes its file) <b>or save your own tune once</b> — the full build sheet appears the moment the file exists. Driving alone cannot create it.</p></div>`; return; }
      const dsum = (cached.deliverable && cached.deliverable.summary) || {};
      const key = "LIVE|" + ord + "|" + (cached.ts || "") + "|" + (dsum.sliders_absolute || 0) + "|" + (live.diskDiff && live.diskDiff.ordinal === ord ? live.diskDiff.t : "") + "|" + (((live.liveryCache || {})[ord] || {}).n || 0);
      if (el.dataset.fhmKey === key && el.querySelector(".fhm")) return;   // unchanged — don't rebuild every frame (keeps the =? inputs stable)
      el.dataset.fhmKey = key;
      const st = captureUi(el);
      el.innerHTML = cloneModeBanner(false, cached) + diskDeliverableHtml(cached, { popBtn: true });
      bindDiskDecode(el); restoreUi(el, st);
    };
    // ---- FLOATING "TAKE TO GAME" WINDOW: the decoded build sheet, kept on screen across menu / workflow / tab / source changes ----
    // Mounted on document.body (position:fixed) so NOTHING in the render cycle wipes it. It reads live.diskCache for the
    // pinned (or last-decoded) ordinal — completely frame-independent, so a CarOrdinal blip to 0 in the menus can't clear it.
    const FLOAT_KEY = "fh6FloatState";
    const loadFloat = () => { try { return JSON.parse(localStorage.getItem(FLOAT_KEY)) || {}; } catch (e) { return {}; } };
    const initFloat = () => { if (live.float) return; live.float = Object.assign({ ord: 0, open: false, min: false, pinned: false, x: null, y: null }, loadFloat()); if (!live.float.target) live.float.target = loadTarget(); };
    const saveFloat = () => { try { localStorage.setItem(FLOAT_KEY, JSON.stringify({ ord: live.float.ord, open: live.float.open, min: live.float.min, pinned: live.float.pinned, x: live.float.x, y: live.float.y })); } catch (e) {} };
    // which car the float tracks: pinned -> its locked ordinal; else the active car, else the last car driven (survives menu blips)
    const floatOrd = () => { initFloat(); return (live.float.pinned && live.float.ord) ? live.float.ord : ((live.frame && live.frame.car) || lastCarOrd() || live.float.ord || 0); };
    // confidence model for an on-disk decode: what's exact, what still needs a user action, and whether it's "reasonable" to build from
    const diskConf = (cached) => {
      const dl = cached && cached.deliverable; if (!dl) return null;
      let rangeNeeded = 0; const soft = [];
      (dl.tabs || []).forEach((t) => (t.rows || []).forEach((row) => { if (row.value == null && row.per_car && !String(row.field).startsWith("gear")) rangeNeeded++; }));
      (dl.menus || []).forEach((m) => (m.rows || []).forEach((row) => { if (!row.stock && (row.conf === "category" || row.conf === "compound" || row.conf === "dim")) soft.push(String(row.item).replace(/_/g, " ")); }));
      const conf = dl.confidence || 0;
      return { pct: Math.round(conf * 100), conf, reasonable: conf >= 0.75, rangeNeeded, soft, locked: !!dl.locked };
    };
    const confMeterHtml = (cached) => {
      const c = diskConf(cached); if (!c) return "";
      const oc = confCol(c.conf); const items = [];
      items.push(c.rangeNeeded
        ? `<div class="fhm-todo"><span class="d">○</span><span><b>${c.rangeNeeded} per-car slider${c.rangeNeeded > 1 ? "s" : ""}</b> shown by position — <span class="why">type the in-game number on a <code>=?</code> box; two positions lock this car's range and every slider prints exact</span></span></div>`
        : `<div class="fhm-todo ok"><span class="d">✓</span><span>every slider is exact</span></div>`);
      items.push(c.soft.length
        ? `<div class="fhm-todo"><span class="d">○</span><span><b>${c.soft.length} best-effort part name${c.soft.length > 1 ? "s" : ""}</b> — <span class="why">confirm in the upgrade shop: ${esc(c.soft.slice(0, 4).join(", "))}${c.soft.length > 4 ? " +" + (c.soft.length - 4) + " more" : ""}</span></span></div>`
        : `<div class="fhm-todo ok"><span class="d">✓</span><span>every part named exactly</span></div>`);
      const nder = (cached.deliverable && cached.deliverable.summary && cached.deliverable.summary.sliders_derived) || 0;
      if (nder) items.push(`<div class="fhm-todo ok"><span class="d">≈</span><span><b>${nder} gear / final-drive values</b> derived from the global band — <span class="why">exact on your next gear-ladder drive</span></span></div>`);
      if (c.locked) items.push(`<div class="fhm-todo ok"><span class="d">🔒</span><span>downloaded tune — values read straight off disk (the in-game tune screen hides them)</span></div>`);
      return `<div class="fhm-conf">
        <div class="fhm-confhead"><span class="lbl">confidence to a buildable clone</span><b style="color:${oc}">${c.pct}%</b><span class="tag" style="border-color:${oc};color:${oc}">${c.reasonable ? "✓ reasonable — ready to build" : "partial — keep refining"}</span></div>
        <div class="fhm-confbar"><i style="width:${c.pct}%;background:${oc}"></i></div>
        <div class="fhm-todos">${items.join("")}</div></div>`;
    };
    // (the float binds calibration inputs via bindDiskDecode — one binder, one behavior, everywhere)
    // ---- BUILD VERIFICATION: score the current build against the pinned clone (green / yellow / red per row) ----
    const TARGET_KEY = "fh6FloatTarget";
    const saveTarget = () => { try { live.float.target ? localStorage.setItem(TARGET_KEY, JSON.stringify(live.float.target)) : localStorage.removeItem(TARGET_KEY); } catch (e) {} };
    const loadTarget = () => { try { return JSON.parse(localStorage.getItem(TARGET_KEY)) || null; } catch (e) { return null; } };
    const partTier = (u) => /^Race/.test(u || "") ? 3 : /^Sport/.test(u || "") ? 2 : /^Street/.test(u || "") ? 1 : 0;
    const VDOT_TITLE = { ok: "matches the clone", near: "close — double-check", off: "not matching the clone yet", over: "higher tier than the clone (adds PI)" };
    const vdot = (st) => st ? `<span class="fhm-vdot ${st}" title="${VDOT_TITLE[st] || ""}"></span>` : "";
    // freeze the pinned clone as the target to build toward, plus a live snapshot (PI/class/drivetrain) for instant checks
    const freezeTarget = (ord) => {
      const cached = live.diskCache && live.diskCache[ord];
      if (!cached || !cached.available) { live.float.target = null; saveTarget(); return; }
      const f = live.frame; const snap = (f && String(f.car) === String(ord)) ? { pi: f.pi, cls: f.cls, drv: f.drv, cyl: f.cyl } : null;
      live.float.target = { ordinal: cached.deliverable.ordinal, name: cached.name, ts: cached.ts, deliverable: cached.deliverable, live: snap };
      saveTarget();
    };
    // compare the current build's decode against the frozen target: per installed part + per slider
    const verifyBuild = (tgtDl, curDl) => {
      const res = { parts: {}, sliders: {}, nParts: 0, okParts: 0, nSliders: 0, okSliders: 0, bad: [] };
      const cp = {}; ((curDl && curDl.menus) || []).forEach((m) => m.rows.forEach((r) => { cp[r.item] = r; }));
      ((tgtDl && tgtDl.menus) || []).forEach((m) => m.rows.forEach((t) => {
        if (t.stock) return;   // only score the parts the clone actually installs
        res.nParts++; const c = cp[t.item]; let st;
        if (!c || c.stock) st = "off";
        else { const tt = partTier(t.upgrade), ct = partTier(c.upgrade);
          if (tt && ct) st = ct === tt ? "ok" : (ct < tt ? "off" : "over");
          else st = String(c.upgrade || c.value) === String(t.upgrade || t.value) ? "ok" : "near"; }
        res.parts[t.item] = st; if (st === "ok") res.okParts++; else res.bad.push({ item: t.item, st, want: t.upgrade || t.value });
      }));
      const cs = {}; ((curDl && curDl.tabs) || []).forEach((tb) => tb.rows.forEach((r) => { cs[r.field] = r; }));
      ((tgtDl && tgtDl.tabs) || []).forEach((tb) => tb.rows.forEach((t) => {
        res.nSliders++; const c = cs[t.field]; let st = "off";
        if (c) { const d = (t.value != null && c.value != null) ? Math.abs(c.value - t.value) / (Math.abs(t.value) || 1) : Math.abs((c.fill || 0) - (t.fill || 0));
          st = d < 0.02 ? "ok" : d < 0.06 ? "near" : "off"; }
        res.sliders[t.field] = st; if (st === "ok") res.okSliders++;
      }));
      return res;
    };
    // instant, pre-save checks from the live frame vs the pinned snapshot (PI / class / drivetrain / cylinders)
    const liveCoarse = (tgt, f) => {
      if (!tgt || !tgt.live || !f || String(f.car) !== String(tgt.ordinal)) return null;
      const s = tgt.live; const out = [];
      if (s.pi != null && f.pi != null) { const dpi = f.pi - s.pi; out.push({ k: "PI", st: dpi === 0 ? "ok" : "off", now: f.pi, want: s.pi, note: dpi === 0 ? "" : (dpi > 0 ? "+" + dpi + " over" : dpi + " under") }); }
      if (s.cls && f.cls) out.push({ k: "class", st: f.cls === s.cls ? "ok" : "off", now: f.cls, want: s.cls });
      if (s.drv && f.drv) out.push({ k: "drivetrain", st: f.drv === s.drv ? "ok" : "off", now: f.drv, want: s.drv });
      if (s.cyl != null && f.cyl != null) out.push({ k: "cylinders", st: f.cyl === s.cyl ? "ok" : "over", now: f.cyl + "cyl", want: s.cyl + "cyl" });
      return out.length ? out : null;
    };
    const coarseStrip = (coarse) => {
      if (!coarse) return "";
      const chip = (c) => { const vv = (v) => c.k === "PI" ? piBadge(null, v, true) : c.k === "class" ? piBadge(v, null, true) : `<b>${esc(String(v))}</b>`;   // PI / class rows wear the in-game badge
        return `<span class="fhm-vchip ${c.st}">${vdot(c.st)}${c.k} ${vv(c.now)}${c.st !== "ok" ? ` <span class="w">→ ${vv(c.want)}${c.note ? " (" + esc(c.note) + ")" : ""}</span>` : ""}</span>`; };
      return `<div class="fhm-coarse"><div class="fhm-coarse-h">● live — the car you're in vs the clone (no save needed)</div><div class="fhm-coarse-row">${coarse.map(chip).join("")}</div></div>`;
    };
    const verifyBanner = (v, pinnedNoBuild) => {
      if (!v) return pinnedNoBuild ? `<div class="fhm-verify" style="border-color:var(--line)"><div class="fhm-verify-h"><b>🎯 clone pinned as your target</b><span class="why">save your build to check each part</span></div><p class="why" style="font-size:10.5px;margin:4px 0 0">every row below is what to install / set — dots turn green as your saved build matches</p></div>` : "";
      const tot = v.nParts + v.nSliders, ok = v.okParts + v.okSliders; const pct = tot ? Math.round(ok / tot * 100) : 100;
      const col = pct >= 100 ? "#00d27a" : pct >= 70 ? "#e3b341" : "#e5414e";
      return `<div class="fhm-verify" style="border-color:${col}"><div class="fhm-verify-h"><b style="color:${col}">${pct >= 100 ? "✅ build matches the clone" : "🔧 building toward the clone"}</b><span>${v.okParts}/${v.nParts} upgrades · ${v.okSliders}/${v.nSliders} tune</span></div><div class="fhm-confbar"><i style="width:${pct}%;background:${col}"></i></div>${v.bad.length ? `<div class="fhm-verify-todo">${v.bad.slice(0, 6).map((b) => `<span>${vdot(b.st)}<b>${esc(String(b.item).replace(/_/g, " "))}</b> → ${esc(String(b.want))}</span>`).join("")}${v.bad.length > 6 ? `<span class="why">+${v.bad.length - 6} more</span>` : ""}</div>` : ""}</div>`;
    };
    const ensureFloatHost = () => { let el = document.getElementById("fhmFloat"); if (!el) { el = document.createElement("div"); el.id = "fhmFloat"; el.className = "fhm-float"; el.style.display = "none"; document.body.appendChild(el); ensureFhmCss(); } return el; };
    const popOutFloat = (ord) => { initFloat(); const next = ord || floatOrd();
      if (live.float.pinned && live.float.target && String(live.float.target.ordinal) !== String(next)) {   // audit F7: never silently overwrite a frozen target
        const nm = live.float.target.name || ("#" + live.float.target.ordinal);
        if (!window.confirm(`Replace the pinned clone target (${nm}) with this build?`)) return;
      }
      live.float.ord = next; live.float.pinned = true; live.float.open = true; live.float.min = false; freezeTarget(live.float.ord); saveFloat(); paintFloat(true); };
    function paintFloat(force) {
      initFloat(); const el = ensureFloatHost();
      if (!live.float.open) { el.style.display = "none"; return; }
      const pinned = !!(live.float.pinned && live.float.target);
      let cached, cur = null, verify = null, coarse = null;
      if (pinned) {
        const t = live.float.target;
        cached = { available: true, name: t.name, ts: t.ts, deliverable: t.deliverable };
        cur = (live.diskCache && live.diskCache[t.ordinal]) || null;
        if (cur && cur.available && cur.ts !== t.ts) verify = verifyBuild(t.deliverable, cur.deliverable);
        coarse = liveCoarse(t, live.frame);
        live.float.ord = t.ordinal; live.float._lastOrd = t.ordinal;
      } else {
        const ord = floatOrd();
        cached = (ord && live.diskCache) ? live.diskCache[ord] : null;
        if ((!cached || !cached.available) && live.float._lastOrd && live.diskCache) cached = live.diskCache[live.float._lastOrd];
      }
      if (!cached || !cached.available) { el.style.display = "none"; return; }
      const dl = cached.deliverable; if (!live.float.pinned) live.float._lastOrd = dl.ordinal;
      const c = diskConf(cached); const nm = cached.name || ("#" + dl.ordinal); const oc = confCol(c.conf); const dsum = dl.summary || {};
      const vsig = verify ? (verify.okParts + "/" + verify.nParts + "," + verify.okSliders + "/" + verify.nSliders) : "";
      const csig = coarse ? coarse.map((x) => x.k + x.st + x.now).join("") : "";
      const key = "F|" + dl.ordinal + "|" + (cached.ts || "") + "|" + ((cur && cur.ts) || "") + "|" + (dsum.sliders_absolute || 0) + "|" + live.float.min + "|" + live.float.pinned + "|" + vsig + "|" + csig + "|" + (live.diskDiff && live.diskDiff.ordinal === dl.ordinal ? live.diskDiff.t : "") + "|" + (((live.liveryCache || {})[dl.ordinal] || {}).n || 0);
      el.style.display = "block";
      if (live.float.x != null) { el.style.left = live.float.x + "px"; el.style.top = live.float.y + "px"; el.style.right = "auto"; el.style.bottom = "auto"; }
      if (!force && el.dataset.k === key && el.querySelector(".fhm-fbar")) return;   // unchanged - don't rebuild (keeps the =? inputs stable while typing)
      el.dataset.k = key;
      const pinTitle = live.float.pinned ? "pinned as your target — the build below is scored against it (click to unpin)" : "following the car you're in — click to pin this as the target to build toward";
      const bar = `<div class="fhm-fbar"><span class="ttl">📀 TAKE TO GAME</span><span class="nm">${esc(nm)}</span><span class="pct" style="color:${oc}">${c.pct}%</span>
        <button class="fhm-fbtn ${live.float.pinned ? "on" : ""}" data-fpin title="${pinTitle}">📌</button>
        <button class="fhm-fbtn" data-fmin title="${live.float.min ? "expand" : "minimize to a pill"}">${live.float.min ? "▢" : "—"}</button>
        <button class="fhm-fbtn" data-fclose title="close (re-open with the Pop out button)">✕</button></div>`;
      const body = coarseStrip(coarse) + verifyBanner(verify, pinned && !verify) + diskDeliverableHtml(cached, { inFloat: true, verify: verify });
      const stF = captureUi(el);
      el.innerHTML = live.float.min ? bar : bar + `<div class="fhm-fbody">${body}</div>`;
      restoreUi(el, stF);   // scroll + drawer toggles survive the per-key rebuild (audit F1/F4 — the float resets scroll on exactly the mid-menu glances it exists for)
      const fbar = el.querySelector(".fhm-fbar");
      if (fbar) fbar.addEventListener("mousedown", (e) => { if (e.target.closest(".fhm-fbtn")) return; const sx = e.clientX, sy = e.clientY, r = el.getBoundingClientRect(), ox = r.left, oy = r.top;
        const mv = (ev) => { live.float.x = Math.max(0, Math.min(window.innerWidth - 80, ox + ev.clientX - sx)); live.float.y = Math.max(0, Math.min(window.innerHeight - 26, oy + ev.clientY - sy)); el.style.left = live.float.x + "px"; el.style.top = live.float.y + "px"; el.style.right = "auto"; el.style.bottom = "auto"; };
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); saveFloat(); };
        document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); e.preventDefault(); });
      const pin = el.querySelector("[data-fpin]"); if (pin) pin.addEventListener("click", () => {
        if (live.float.pinned) { if (!window.confirm("Unpin the clone target? Its frozen snapshot is discarded (re-pin from the decode panel any time).")) return; }   // audit F7
        live.float.pinned = !live.float.pinned; if (live.float.pinned) { live.float.ord = dl.ordinal; freezeTarget(dl.ordinal); } else { live.float.target = null; saveTarget(); } saveFloat(); paintFloat(true); });
      const mn = el.querySelector("[data-fmin]"); if (mn) mn.addEventListener("click", () => { live.float.min = !live.float.min; saveFloat(); paintFloat(true); });
      const cl = el.querySelector("[data-fclose]"); if (cl) cl.addEventListener("click", () => { live.float.open = false; saveFloat(); paintFloat(true); });
      if (!live.float.min) bindDiskDecode(el);   // same binder as the inline panel — anchored calibration feedback, tune-library picks, cal-jumps all work in the float too
    }
    // ---- LIVE CORNER ANALYSIS (course training): every corner of every lap, full stats, in real time ----
    // enriched corner log: each live 'corner' event tagged with its lap and matched to a course turn (canonical apex position)
    // ═══ TURN TABLE — turns come from COURSE DATA, not from re-deriving them per session. Order of truth:
    // (1) the persisted course model's established turns (full fidelity: type, radius, track record, per-car
    // bests), (2) the session's canonical projection of that same model when it is fresher, (3) — only when a
    // course has never established a turn — the curvature map, flagged PROVISIONAL. `source` is rendered, never
    // hidden, so "no turns yet" reads as a stage of learning rather than a blank panel.
    const _ttCache = {};
    const turnTable = (co) => {
      if (!co) return { turns: [], source: "none", count: 0 };
      const rk = co.route_key || ""; const ck = rk + "|" + ((live.analysis && live.analysis.id) || "") + "|" + ((co.turns || {}).canonical || []).length;
      if (_ttCache[ck]) return _ttCache[ck];
      const tu = co.turns || {};
      const m = ((DB.courseModels || []).find((x) => x && x.route_key === rk)) || null;
      let rows = [];
      if (m && (m.turns || []).length) {
        let est = m.turns.filter((t) => t.established);
        if (m.expected_turns && est.length > m.expected_turns) {
          est = est.slice().sort((a, b) => ((b.track || {}).presence || 0) - ((a.track || {}).presence || 0)).slice(0, m.expected_turns)
                   .sort((a, b) => m.turns.indexOf(a) - m.turns.indexOf(b));
        }
        rows = est.map((t) => ({ id: t.id, pos: t.pos, dir: t.dir, radius_m: t.radius_m, type: t.type, track: t.track || null, best_by_car: t.best_by_car || null }));
      }
      const canon = tu.canonical || [];
      if (canon.length) {   // the session sees the SAME model, fresher than db.js — it wins, keeping the model's extra fields where they line up
        const near = (a, b) => a && b && ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) <= 20 * 20;
        rows = canon.map((c) => Object.assign({}, rows.find((r2) => r2.id === c.id) || rows.find((r2) => near(r2.pos, c.pos)) || {},
          { id: c.id, pos: c.pos, dir: c.dir, radius_m: c.radius_m, passes: c.passes, presence: c.presence, sessions: c.sessions, dominant: c.dominant }));
      }
      let out;
      if (rows.length) out = { turns: rows.map((r2, i) => Object.assign(r2, { n: i + 1 })), source: "model", count: tu.count || (m && (m.expected_turns || m.turn_count)) || rows.length, expected: tu.expected != null ? tu.expected : (m && m.expected_turns) || null };
      else {
        const geo = courseGeoFor(co) || (m && m.geometry) || null; const g = (geo && geo.turns) || [];
        out = g.length ? { turns: g.map((x, i) => ({ n: i + 1, id: x.id, pos: x.apex, dir: x.dir, radius_m: x.radius_m, provisional: true })), source: "geometry", count: g.length, expected: tu.expected || null }
                       : { turns: [], source: "none", count: 0, expected: tu.expected || null };
      }
      _ttCache[ck] = out; return out;
    };
    const TURN_R = 45;   // ONE join radius everywhere (the analyzer's own corner↔turn radius) — was 60/45/40/18 in five places
    const turnAt = (co, pos) => { if (!pos || pos[0] == null) return null; let best = null, bd = TURN_R * TURN_R;
      turnTable(co).turns.forEach((t) => { const d = (t.pos[0] - pos[0]) ** 2 + (t.pos[1] - pos[1]) ** 2; if (d < bd) { bd = d; best = t; } }); return best; };
    const turnKey = (t) => (t ? (t.id || "g" + t.n) : null);   // join on the MODEL's id, never a positional index
    const canonTurns = () => { const an = live.analysis; const co = an && (an.courses || [])[0]; return (co ? turnTable(co).turns : []); };   // legacy shim: live course, model-first
    const matchTurn = (apex) => { if (!apex || apex[0] == null) return null; const an = live.analysis; const co = an && (an.courses || [])[0]; const t = co && turnAt(co, apex); return t ? { id: t.id, n: t.n, dir: t.dir } : null; };
    // J13: ONE turn language for the user — canonical T<n>. Analyzer ids (C3 clusters, G4 geometry, model T-ids)
    // stay in the data but resolve to T<n> for display; unresolvable ids pass through untouched.
    const matchTurnById = (id) => {
      if (!id) return null; const cs = canonTurns();
      const ci = cs.findIndex((t) => t.id === id); if (ci >= 0) return { id, n: ci + 1, dir: cs[ci].dir };
      const geo = ((live.analysis && (live.analysis.courses || [])[0]) || {}).geometry;
      const g = ((geo && geo.turns) || []).find((t) => t.id === id);
      return g && g.apex ? matchTurn(g.apex) : null;
    };
    const turnLabel = (id) => { try { const mt = matchTurnById(id); return mt ? "T" + mt.n : String(id); } catch (e) { return String(id); } };
    const resolveTurnIds = (text) => { try { return String(text).replace(/\b[GC]\d+\b/g, (id) => turnLabel(id)); } catch (e) { return text; } };
    const pushCornerLog = (c) => { if (!live.cornerLog) live.cornerLog = []; const lap = c.lapn != null ? c.lapn : (c.loop_lap != null ? c.loop_lap : null); live.cornerLog.push(Object.assign({}, c, { lap, seq: (live.cornerLog.length + 1) })); if (live.cornerLog.length > 400) live.cornerLog = live.cornerLog.slice(-400); };   // turn match happens at RENDER (canonical turns may load after the corner)
    const usiVerdict = (u) => { const g = gripOf(gripFromUsi(u)); return [g.word, u > 0.15 || u < -0.05 ? g.ink : "#00d27a"]; };
    const phaseBars = (ph) => `<span style="display:inline-flex;gap:2px">${(ph || []).map((p) => { const fr = Math.min(1, p.front / 1.5), rr = Math.min(1, p.rear / 1.5); const col = p.red === "front" ? "#2f81f7" : p.red === "rear" ? "#e5414e" : p.red === "both" ? "#a371f7" : "#3a4250"; return `<span title="phase ${p.phase} (${CM_SHORT ? CM_SHORT[p.phase - 1] : ""}): front ${p.front} · rear ${p.rear}" style="display:inline-block;width:16px;height:16px;border-radius:2px;border:1px solid ${col};position:relative;background:var(--bg)"><i style="position:absolute;left:0;bottom:0;width:50%;height:${Math.round(fr * 100)}%;background:#2f81f7;opacity:${p.front > 1 ? 1 : .4}"></i><i style="position:absolute;right:0;bottom:0;width:50%;height:${Math.round(rr * 100)}%;background:#e5414e;opacity:${p.rear > 1 ? 1 : .4}"></i></span>`; }).join("")}</span>`;
    const cornerAnalysis = () => {
      const curC = (live.frame && live.frame.on && live.frame.cid) || live.courseCar; const log = (live.cornerLog || []).filter((c) => !curC || c.car === curC); const cs = canonTurns(); const f = live.frame || {}; const inCorner = f.on && Math.abs(f.lat || 0) > 0.4;   // car-aware: only the equipped car's corners
      if (!log.length && !cs.length) return `<div class="lab-corner" style="border-left:4px solid var(--accent2);background:var(--bg2)"><strong>🩺 Corner analysis</strong> <span class="why">— every corner of every lap, live. Start a lap; each corner appears here the moment you complete it.</span>${inCorner ? ` <span class="chip" style="border-color:var(--accent2);color:var(--accent2)">● in a corner now — ${f.lat > 0 ? "right" : "left"}, ${Math.abs(f.lat).toFixed(2)} g</span>` : ""}</div>`;
      // per-turn matrix (this session): for each course turn, the corners taken on it (matched here, so a late-arriving analysis still groups older corners)
      const byTurn = {}; log.forEach((c) => { c._turn = c.ev === 0 ? null : matchTurn(c.apex); if (c.ev === 0) return; const k = c._turn ? c._turn.id : "?"; (byTurn[k] = byTurn[k] || []).push(c); });   // J14: free-roam corners (ev:0) stay in the log but never enter a course turn's row
      const med = (a) => { a = a.filter((x) => x != null).slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
      const rows = cs.map((t, i) => { const arr = (byTurn[t.id] || []); const last = arr[arr.length - 1]; const fr = { front: 0, rear: 0, none: 0 }; arr.forEach((c) => fr[(c.first_red || {}).axle || "none"]++); const dom = arr.length ? Object.keys(fr).sort((a, b) => fr[b] - fr[a])[0] : "—";
        return { n: i + 1, id: t.id, dir: t.dir, taken: arr.length, mph: med(arr.map((c) => c.mph_min)), lat: med(arr.map((c) => c.lat_g_peak)), usi: med(arr.map((c) => c.usi)), dom, fr, last, brake: med(arr.map((c) => c.brake_on_m)) }; });
      const matrix = `<div style="overflow-x:auto"><table style="font-size:11px"><thead><tr><th>turn</th><th>taken</th><th>apex mph</th><th>lat g</th><th>brake (m)</th><th>USI</th><th>first red</th><th>last: in→apex→out · phases</th></tr></thead><tbody>
        ${rows.map((r) => { const uv = r.usi != null ? usiVerdict(r.usi) : null; const dcol = r.dom === "front" ? "#2f81f7" : r.dom === "rear" ? "#e5414e" : "var(--muted)"; return `<tr style="${r.taken ? "" : "opacity:.4"}"><td><b>T${r.n}</b> ${r.dir === "L" ? "⬅" : "➡"}</td><td>${r.taken || "—"}</td><td>${r.mph ?? "—"}</td><td>${r.lat ?? "—"}</td><td>${r.brake ?? "—"}</td><td>${r.usi != null ? `<span style="color:${uv[1]}">${r.usi > 0 ? "+" : ""}${r.usi.toFixed(2)}</span>` : "—"}</td><td>${r.taken ? `<span style="color:${dcol};font-weight:700">${r.dom}</span> <span class="why">${r.fr.front}/${r.fr.rear}/${r.fr.none}</span>` : "—"}</td><td>${r.last ? `${r.last.mph_in}→<b>${r.last.mph_min}</b>→${r.last.mph_out ?? "—"} ${phaseBars(r.last.phases)}` : "—"}</td></tr>`; }).join("")}
        </tbody></table></div>`;
      // chronological log — full stats per corner, newest first
      const recent = log.slice(-16).reverse();
      const logHtml = `<div style="overflow-x:auto;margin-top:8px"><table style="font-size:11px"><thead><tr><th>#</th><th>lap</th><th>turn</th><th>type</th><th>in→apex→out</th><th>lat g</th><th>brake·thr (m)</th><th>phases F/R</th><th>first red</th><th>USI</th><th>flags</th></tr></thead><tbody>
        ${recent.map((c) => { const type = c.mph_min < 45 ? "hairpin" : c.mph_min <= 85 ? "medium" : "fast"; const fr = c.first_red; const uv = usiVerdict(c.usi); const frcol = fr ? (fr.axle === "front" ? "#2f81f7" : "#e5414e") : "var(--muted)"; const tm = c._turn || (c.ev === 0 ? null : matchTurn(c.apex)); return `<tr><td class="why">${c.seq}</td><td>${c.lap ?? "—"}</td><td><b>${tm ? "T" + tm.n : "·"}</b> ${c.dir === "L" ? "⬅" : "➡"}</td><td>${type}</td><td>${c.mph_in}→<b>${c.mph_min}</b>→${c.mph_out ?? "—"}</td><td>${c.lat_g_peak}</td><td>${c.brake_on_m ?? "—"}${c.throttle_on_m != null ? " · +" + c.throttle_on_m : ""}</td><td>${phaseBars(c.phases)}</td><td>${fr ? `<span style="color:${frcol};font-weight:700">${fr.axle} ph${fr.phase}</span>` : `<span style="color:#00d27a">clean</span>`}</td><td><span style="color:${uv[1]}">${uv[0]}</span> ${c.usi > 0 ? "+" : ""}${c.usi}</td><td class="why">${c.hb ? "🖐 " : ""}${c.drift ? "drift " : ""}${c.kink ? "kink " : ""}${c.brake_max > 200 ? "🛑" : ""}</td></tr>`; }).join("")}
        </tbody></table></div>`;
      return `<div class="lab-corner" style="border-left:4px solid var(--accent2)"><div class="card-row" style="margin-top:0"><strong>🩺 Corner analysis — every corner, every lap (live)</strong>${(() => { try { const co0 = (live.analysis && (live.analysis.courses || [])[0]) || null; return co0 ? ` ${courseIdentMini(co0.name, courseGeoFor(co0), co0.route_key, 20)}` : ""; } catch (e) { return ""; } })()}<span class="chip" style="border-color:var(--accent2);color:var(--accent2)">${log.length} corner${log.length === 1 ? "" : "s"} this session${inCorner ? " · ● in a corner now" : ""}</span></div>
        <div style="font-size:11px;color:var(--muted);margin:4px 0 2px">Per-turn this session — apex speed, lat g, braking point, understeer/oversteer, which axle gives up first. Phase squares: ▮ = phase 1-4 (entry → turn-in → apex → exit), blue=front slip, red=rear; filled past the grip limit.</div>${matrix}
        <div style="font-size:11px;color:var(--muted);margin:8px 0 2px">Every corner as you take it (newest first)</div>${logHtml}</div>`;
    };
    const paintCornerAnalysis = () => { const el = host.querySelector("#lvCornerAnalysis"); if (el) el.innerHTML = cornerAnalysis(); };
    // ---- LIVE DECODE coach: the car you're in is analysed constantly; between the daemon's analyses the dashboard tracks, frame by frame, what the battery still needs ----
    const DEC_HOWTO = { launch: "standing start — stop fully, then full throttle past 60 mph", gears: "full throttle in every gear (15+ frames each)", dyno: "sweep the rev range at full throttle", top: "hold TOP gear at full throttle for 5 s", brake: "threshold-brake from 80+ mph to a near stop", hairpin: "a hairpin (apex under 45 mph)", medium: "a medium corner (apex 45–85 mph)", fast: "a fast sweeper (apex over 85 mph)", crest: "a crest / bump at speed (car goes light)", wiggle: "quick left-right steering pulses at 55+ mph" };
    const decReset = (cid) => { live.dec = { cid, gearF: {}, bins: new Set(), topS: 0, topCur: 0, launches: 0, brakes: 0, wiggles: 0, crests: 0, corners: { hairpin: 0, medium: 0, fast: 0 }, lastT: 0, stoppedT: null, brkOn: false, steerSign: 0, steerT: 0, wigT: 0, crestT: 0, act: "—", topGear: null, lastPaint: 0 }; };
    const updateLiveDec = (f) => {
      if (!f || !f.on) { if (live.dec) live.dec.act = "not driving"; return; }
      if (!live.dec || live.dec.cid !== f.cid) decReset(f.cid);
      const d = live.dec, now = performance.now(), dt = d.lastT ? Math.min(0.2, (now - d.lastT) / 1000) : 0; d.lastT = now;
      const ls = liveSess(); const A = ls ? car(ls, f.cid) : null; if (f.gear > (d.topGear || 0) && f.gear <= 10) d.topGear = f.gear; const topGear = (A && A.sig && A.sig.gear_count) || d.topGear || 0;
      const wot = f.thr > 230 && f.rpm > 1500 && f.mph > 5 && f.gear >= 1 && f.gear <= 10; let act = "cruising";
      if (wot) { d.gearF[f.gear] = (d.gearF[f.gear] || 0) + 1; d.bins.add(Math.floor(f.rpm / 250) * 250); act = `WOT pull · gear ${f.gear} · ${Math.round(f.rpm)} rpm`; if (topGear && f.gear >= topGear) { d.topCur += dt; d.topS = Math.max(d.topS, d.topCur); act = `TOP-GEAR pull · ${d.topCur.toFixed(1)} s`; } else d.topCur = 0; } else d.topCur = 0;
      if (f.mph < 2) { if (d.stoppedT == null) d.stoppedT = now; } else if (d.stoppedT != null && now - d.stoppedT > 800 && f.mph > 30) { d.launches += 1; d.stoppedT = null; act = "LAUNCH"; } else if (d.stoppedT != null && f.mph > 30) d.stoppedT = null;
      if (d.stoppedT != null && f.mph < 2 && now - d.stoppedT > 800) act = "stopped — ready to launch";
      if (f.brk > 200 && !d.brkOn) { d.brkOn = true; if (f.mph >= 80) { d.brakes += 1; act = "HARD STOP"; } } else if (f.brk < 60) d.brkOn = false;
      if (f.brk > 200 && f.mph >= 60) act = "braking hard";
      const sgn = f.steer > 60 ? 1 : f.steer < -60 ? -1 : 0;
      if (sgn && f.mph > 55) { if (d.steerSign && sgn !== d.steerSign && now - d.steerT < 1200 && now - d.wigT > 2000) { d.wiggles += 1; d.wigT = now; act = "steering pulse"; } d.steerSign = sgn; d.steerT = now; }
      if (f.susp && f.susp.length === 4 && f.mph > 50 && f.susp.every((v) => v < 0.25) && now - d.crestT > 3000) { d.crests += 1; d.crestT = now; act = "CREST"; }
      if (Math.abs(f.lat) > 0.6 && !wot && act === "cruising") act = "cornering";
      d.act = act;
    };
    const decOnCorner = (c) => { const d = live.dec; if (!d || !c || c.car !== d.cid || c.drift) return; const k = c.mph_min < 45 ? "hairpin" : c.mph_min <= 85 ? "medium" : "fast"; d.corners[k] = (d.corners[k] || 0) + 1; };
    const liveTestProgress = (A) => {   // authoritative counts from the last analysis + what the dashboard has seen since (approximate; reset on each analysis)
      const d = live.dec || {}; const tests = (A && A.decode && A.decode.tests) || [];
      return tests.map((t) => { let extra = 0, live_ = null;
        if (t.key === "launch") extra = d.launches || 0;
        else if (t.key === "brake") extra = d.brakes || 0;
        else if (t.key === "wiggle") extra = d.wiggles || 0;
        else if (t.key === "crest") extra = d.crests || 0;
        else if (t.key === "hairpin" || t.key === "medium" || t.key === "fast") extra = (d.corners || {})[t.key] || 0;
        else if (t.key === "top") { if (!t.ok) live_ = `${Math.min(5, d.topS || 0).toFixed(1)} / 5 s held`; if ((d.topS || 0) >= 5) extra = 1; }
        else if (t.key === "gears") { const miss = ((t.why.match(/missing gear ([\d, ]+)/) || [])[1] || "").split(",").map((x) => +x.trim()).filter(Boolean); extra = miss.filter((g) => (d.gearF || {})[g] >= 15).length; if (miss.length) live_ = miss.map((g) => `g${g} ${Math.min(15, (d.gearF || {})[g] || 0)}/15 frames`).join(" · "); }
        else if (t.key === "dyno") { const miss = ((t.why.match(/missing rpm: ([\d, ]+)/) || [])[1] || "").split(",").map((x) => +x.trim()).filter(Boolean); const bins = d.bins || new Set(); extra = miss.filter((b) => bins.has(b)).length; if (miss.length) { const left = miss.filter((b) => !bins.has(b)); live_ = left.length ? `rpm still missing: ${left.join(", ")}` : "all missing bins swept — the next analysis confirms"; } }
        const have = Math.min(t.need, t.have + extra); return Object.assign({}, t, { have_live: have, ok_live: have >= t.need, live: live_, extra });
      });
    };
    const nextPanelHtml = (A) => {
      const d = live.dec || {};
      if (!A || !A.decode) return `<div class="lab-corner" style="border-left:4px solid #a371f7;background:var(--bg2)"><div class="card-row" style="margin-top:0"><strong style="font-size:15px">▶ NEXT: drive — the first analysis (~20 s of driving) defines what this car still needs</strong><span class="chip">${esc(d.act || "—")}</span></div></div>`;
      const prog = liveTestProgress(A); const todo = prog.filter((t) => !t.ok_live).sort((a, b) => (b.need - b.have_live) / b.need - (a.need - a.have_live) / a.need); const weak = (A.clone_sheet && A.clone_sheet.weak) || []; const done = prog.length && !todo.length; const top = todo[0];
      return `<div class="lab-corner" style="border-left:4px solid ${done ? "#00d27a" : "#a371f7"};background:var(--bg2)">
        <div class="card-row" style="margin-top:0"><strong style="font-size:15px">${done ? "✅ CAPTURE COMPLETE — sheet ready" : "▶ NEXT: " + esc(DEC_HOWTO[top.key] || top.label)}</strong><span class="chip" title="what the dashboard sees you doing right now">${esc(d.act || "—")}</span></div>
        ${done ? `<p class="why" style="font-size:12px;margin:4px 0">every battery test is captured${weak.length ? ` — to raise confidence: ${weak.map((w) => `<b>${esc(w.item)}</b> ${Math.round(w.confidence * 100)}% · ${esc(w.needs || "")}`).join(" · ")}` : " — every measured row is backed by repeated, consistent measurements"}</p>` : `<p class="why" style="font-size:12px;margin:4px 0">${todo.length} of ${prog.length} tests still needed — counts move with every frame; the analysis confirms them every ~20 s of driving</p>`}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px">${prog.map((t) => `<div style="${t.ok_live ? "opacity:.55" : ""}"><div style="display:flex;justify-content:space-between;gap:6px"><span>${t.ok_live ? "✓ " : "○ "}<b>${t.label}</b>${!t.ok_live ? ` <span class="why">— ${esc(DEC_HOWTO[t.key] || "")}</span>` : ""}</span><b style="white-space:nowrap;color:${t.ok_live ? "#00d27a" : "#e3b341"}">${t.have_live}/${t.need}${t.extra ? ` <span style="font-weight:400;color:var(--muted)">(+${t.extra} live)</span>` : ""}</b></div><div class="lab-bar" style="height:5px"><i style="width:${Math.min(100, t.have_live / t.need * 100)}%;background:${t.ok_live ? "#00d27a" : "#a371f7"}"></i></div>${t.live && !t.ok_live ? `<span class="why" style="font-size:10px">${esc(t.live)}</span>` : ""}</div>`).join("")}</div>
      </div>`;
    };
    const paintDecNext = () => { const el = host.querySelector("#lvDecNext"); if (!el) return; const d = live.dec; const now = performance.now(); if (d && now - (d.lastPaint || 0) < 400) return; if (d) d.lastPaint = now; const ls = liveSess(); const A = live.frame && ls ? car(ls, live.frame.cid) : null; el.innerHTML = nextPanelHtml(A); };
    // 🧬 DECODE — clone a build: donor capture (progress = tests only) → Clone Sheet (the parts) → Bench convergence (the sliders)
    function decodeSection(s, isLive) {
      if (!s || !arr(s, "cars").length) return isLive ? EMPTY_LIVE : NOSESS;
      // DONOR side may come from the pinned donor (its own session, possibly before a reset / restart); REPLICA side is always the current session
      const pin = isLive ? PIN() : null; let sD = s, pinNote = "";
      if (!isLive && libPick) { const sdl = (sessions || []).find((x) => x.id === libPick.sid); if (sdl && car(sdl, libPick.key)) { sD = sdl; donor = libPick.key; pinNote = `📚 donor from the build library — <b>${esc(carName(car(sdl, libPick.key)) || libPick.key)}</b> (session ${esc(String(libPick.sid).slice(-6))})`; } }
      if (pin) {
        if (pin.sid === s.id && car(s, pin.key)) { sD = s; pinDonor(s, pin.key); }   // same session: keep the pinned copy fresh from the live data
        else if (pin.data && car(pin.data, pin.key)) { sD = pin.data; pinNote = `📌 donor pinned from session <b>${esc(pin.sid)}</b> — replica side is the current session`; }
      }
      const stints = arr(s, "stints"), stintsD = arr(sD, "stints"), launches = arr(s, "launches"), launchesD = arr(sD, "launches"), braking = arr(s, "braking"), brakingD = arr(sD, "braking"), corners = arr(s, "corners"), cornersD = arr(sD, "corners"), pulses = arr(s, "pulses"), pulsesD = arr(sD, "pulses");
      const roleStint = (rl, list) => { const st = (list || stints).find((x) => x.role === rl); return st ? st.id + "#" + st.n : null; };
      if (isLive) {   // live: the pin wins, then an explicit chip click, then a run role (roles can be set AFTER this tab first rendered), then the first car
        const rd = roleStint("donor");
        if (!pin && rd) pinDonor(s, rd);   // a 🎯 DONOR role set in the stream bar pins itself
        donor = (pin && car(sD, pin.key) ? pin.key : null) || live._donorPick || rd || s.cars[0].id;
        replica = live._replicaPick || roleStint("replica") || (s.cars[1] || s.cars[0]).id;
      } else {
        if (donor == null) donor = roleStint("donor") || s.cars[0].id;
        if (replica == null) replica = roleStint("replica") || (s.cars[1] || s.cars[0]).id;
      }
      if (!car(sD, donor)) donor = (sD.cars[0] || s.cars[0]).id;
      if (!car(s, replica)) replica = (s.cars[1] || s.cars[0]).id;
      const D = car(sD, donor), R = car(s, replica); const Dg = D.gears || [], Rg = R.gears || [], Dd = D.dyno || [], Rd = R.dyno || [];
      const dC = "#e3b341", rC = "#00d27a";
      const pick = (a, o) => { const b = baseId(o), n = stintOf(o); return a.filter((x) => x.car === b && (n == null || x.stint === n)); };
      const stintChips = (sel, attr, ss) => arr(ss, "stints").filter((st) => (st.corners || 0) + (st.launches || 0) + (st.braking || 0) > 0).map((st) => `<span class="chip ${sel === st.id + "#" + st.n ? "on" : ""}" data-${attr}="${st.id}#${st.n}" title="${st.t0}s–${st.t1}s">run ${st.n}${st.role === "donor" ? " 🎯" : st.role === "replica" ? " 🔧" : ""}${st.label ? " “" + esc(st.label) + "”" : ""} · ${carLbl(ss, st.id).split(" · ")[0]}</span>`).join("");
      const hasRoles = stints.some((x) => x.role) || stintsD.some((x) => x.role); const sameRun = sD === s && baseId(donor) === baseId(replica) && stintOf(donor) === stintOf(replica); const diffCar = D.id !== R.id;
      const kinds = [["Launch", pick(launchesD, donor).length && pick(launches, replica).length], ["Braking", pick(brakingD, donor).length && pick(braking, replica).length], ["Corner", pick(cornersD, donor).length && pick(corners, replica).length], ["Gearing", Dg.length && Rg.length], ["Dyno", Dd.length && Rd.length], ["Crest", 1], ["Top-speed pull", 0], ["Wiggle", pick(pulsesD, donor).length && pick(pulses, replica).length]];
      // match metrics
      const common = Dg.filter((g) => Rg.find((h) => h.gear === g.gear));
      const gearErr = common.length ? Math.sqrt(common.reduce((a, g) => { const h = Rg.find((x) => x.gear === g.gear); return a + Math.pow((h.mps_per_krpm - g.mps_per_krpm) / g.mps_per_krpm, 2); }, 0) / common.length) * 100 : null;
      const rpmC = Dd.filter((d) => Rd.find((e) => e.rpm === d.rpm));
      const dynoErr = rpmC.length ? Math.sqrt(rpmC.reduce((a, d) => { const e = Rd.find((x) => x.rpm === d.rpm); return a + Math.pow((e.hp - d.hp) / Math.max(d.hp, 1), 2); }, 0) / rpmC.length) * 100 : null;
      const med = (a) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
      const lD = pick(launchesD, donor)[0], lR = pick(launches, replica)[0];
      const launchErr = lD && lR ? Math.abs(lR.peak_slip_rear - lD.peak_slip_rear) / Math.max(lD.peak_slip_rear, 0.1) * 100 : null;
      const bD = med(pick(brakingD, donor).map((b) => b.front_deficit - b.rear_deficit)), bR = med(pick(braking, replica).map((b) => b.front_deficit - b.rear_deficit));
      const brakeErr = bD != null && bR != null ? Math.abs(bR - bD) * 100 : null;
      const uD = med(pick(cornersD, donor).filter((c) => !c.drift).map((c) => c.usi)), uR = med(pick(corners, replica).filter((c) => !c.drift).map((c) => c.usi));
      const usiErr = uD != null && uR != null ? Math.abs(uR - uD) * 100 : null;
      const pD = med(pick(pulsesD, donor).filter((p) => p.decay_s != null).map((p) => p.decay_s)), pR = med(pick(pulses, replica).filter((p) => p.decay_s != null).map((p) => p.decay_s));
      const pulseErr = pD != null && pR != null ? Math.abs(pR - pD) / Math.max(pD, 0.05) * 100 : null;
      const ledger = [
        ["⚙️ Gearing", gearErr, 2, 6, `ladder RMS ${fmt(gearErr, 1)}% over ${common.length} gears`, "FD / individual ratios until the WOT ladder overlays gear by gear"],
        ["🔧 Engine", dynoErr, 3, 8, `dyno curve RMS ${fmt(dynoErr, 1)}% over ${rpmC.length} rpm bins`, "aspiration tier / bolt-ons until the hp curve AND boost profile overlay — peak hp alone is not proof"],
        ["🔁 Diff (launch)", launchErr, 10, 25, `peak rear slip ${fmt(lR && lR.peak_slip_rear)} vs donor ${fmt(lD && lD.peak_slip_rear)}`, "accel lock ↑ if replica spins one wheel more; center split toward donor's front/rear slip share"],
        ["🛑 Brakes", brakeErr, 5, 15, `front−rear deficit ${fmt(bR)} vs donor ${fmt(bD)}`, "balance toward the axle the donor locks LATER; pressure to match the lock threshold"],
        ["⚖️ Springs / ARBs", usiErr, 5, 15, `corner USI ${fmt(uR, 3)} vs donor ${fmt(uD, 3)}`, "front relatively softer if donor USI is lower (less understeer); ratio first, magnitude second"],
        ["🪃 Dampers", pulseErr, 15, 40, `yaw-decay ${fmt(pR)} s vs donor ${fmt(pD)} s (experimental)`, "rear rebound / front bump until the decay and crest traces overlay"],
        ["🪁 Aero", null, 0, 0, "needs a top-speed pull + fast-sweeper probe (not in this session)", "rear wing / front aero until speed-binned lat g and braking overlay"],
      ];
      const lad = (sel, c, list) => { const n = stintOf(sel); const st = n != null ? (list || stints).find((x) => x.n === n) : null; return st && st.ladder && Object.keys(st.ladder).length ? Object.entries(st.ladder).map(([g, v]) => [+g, v]) : (c.gears || []).map((g) => [g.gear, g.mps_per_krpm]); };
      // LIVE: the SUBJECT of decoding is the car you are in right now — full clone of the currently equipped, active config
      const curId = isLive ? ((live.frame && live.frame.on && live.frame.cid) || live.courseCar) : null; const A = curId ? car(s, curId) : null; const Adone = !!(A && A.decode && A.decode.pct >= 1);   // fall back to the last car you drove so the clone sheet stays while you're in the upgrade screen
      const subject = isLive ? (A ? `<div class="block" style="border-color:#a371f7"><div class="card-row" style="margin-top:0"><h3 style="margin:0">🚗 Cloning the car you're in — ${buildThumb(A.ordinal, A.build_id, true)} ${esc(carName(A) || "#" + A.ordinal)} <span class="why" title="build fingerprint ${esc(String(A.build_id || ""))}">${piBadge(A.class, A.pi, true)} ${A.drivetrain} ${A.cyl}cyl</span></h3><span class="chip" style="border-color:${Adone ? "#00d27a" : "#e3b341"};color:${Adone ? "#00d27a" : "#e3b341"};font-weight:700">${A.decode ? (Adone ? "CAPTURE COMPLETE" : A.decode.ready_n + "/" + A.decode.total + " tests") : "analysing…"}</span></div>
          <p class="why" style="font-size:11px;margin:2px 0 6px">the daemon re-analyses on lap boundaries and every 20–90 s of driving (slows as the session grows) — the panel below moves with every frame · ${analysisAgeChip()}</p>
          <div id="lvDiskDecode"></div>
          <div id="lvDecNext">${nextPanelHtml(A)}</div>
          ${(() => { const st = live.stint || (live.frame && live.frame.stint) || 0; const tg = (live.tags || {})[String(st)] || {}; const myRole = (typeof tg === "object" && tg.role) || ""; const pin = PIN(); const hasDonor = !!(pin || roleStint("donor"));
            return `<div style="margin:6px 0;padding:8px 10px;border:1px dashed #a371f7;border-radius:8px;font-size:11.5px">
              <div style="font-weight:700;margin-bottom:4px">Which run is this? <span class="why" style="font-weight:400">— tag the car you're driving so the Bench knows what to compare</span></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="lab-mode" data-role="donor" style="padding:5px 12px;font-size:12px;border-color:#e3b341;color:#e3b341;${myRole === "donor" ? "background:#e3b341;color:#0e1116" : ""}">🎯 DONOR — the tune I want to clone</button>
                <button class="lab-mode" data-role="replica" style="padding:5px 12px;font-size:12px;border-color:#00d27a;color:#00d27a;${myRole === "replica" ? "background:#00d27a;color:#0e1116" : ""}">🔧 REPLICA — my rebuild of it</button>
                ${myRole ? `<span class="chip" style="border-color:${myRole === "donor" ? "#e3b341" : "#00d27a"};color:${myRole === "donor" ? "#e3b341" : "#00d27a"}">this run = ${myRole === "donor" ? "🎯 DONOR" : "🔧 REPLICA"}</span>` : ""}
              </div>
              <div class="why" style="font-size:10.5px;margin-top:5px">${!hasDonor ? "<b>Start here:</b> driving the locked / downloaded tune you want to copy? Press 🎯 DONOR — its build sheet (📀 above) is the deliverable, and the 📡 measurement detail accrues below." : A.id === (D && D.id) ? "This IS the donor — the 📀 build sheet above is your deliverable (measured facts feed its 🔗 union; the raw detail sits in the 📡 drawer below). Build a copy, drive it, and press 🔧 REPLICA to see the slider gaps." : "Donor already set. If this is your rebuild, press 🔧 REPLICA to converge it against the donor on the Bench."}</div>
            </div>`; })()}
          ${(() => {   // ONE deliverable: the save sheet + union above is canonical. The telemetry clone-sheet is the
            // MEASUREMENT DETAIL feeding that union — collapsed, not a competing second deliverable. The battery
            // advisor (what to drive next) stays visible while capture is incomplete, since it drives the data in.
            if (!A.decode) return `<p class="why" style="font-size:11px">first analysis after ~20 s of driving…</p>`;
            const sheet = A.clone_sheet ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px"><b>📡 Telemetry measurement detail</b> <span class="why">— the measured facts feeding the 🔗 union in the build sheet above${Adone ? "" : " (still capturing)"}</span></summary><div style="margin-top:6px">${cloneSheetHtml(A)}</div></details>` : "";
            return Adone
              ? `${sheet}<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px"><b>🧬 decode battery</b> <span class="chip" style="border-color:#00d27a;color:#00d27a">all tests captured</span></summary>${decodePanel(A, "🚗 ")}</details>`
              : `${decodePanel(A, "🚗 ")}${sheet}`;
          })()}
        </div>` : `<div class="block" style="border-color:#a371f7"><h3 style="margin-top:0">🚗 Cloning the car you're in</h3><p class="why" style="font-size:12px;margin:0 0 6px">${live.frame && live.frame.on ? "this config has no analysis yet — drive ~20 s" : "not driving — the car you get into becomes the decode subject automatically"}</p><div id="lvDiskDecode"></div><div id="lvDecNext">${nextPanelHtml(null)}</div></div>`) : "";
      const libraryBlock = isLive ? "" : buildLibrary(s);
      const hideDonorDeliverable = isLive && A && A.id === D.id;   // the subject block already shows it
      return `${subject}${libraryBlock}
        <div class="block" style="border-color:#e3b341"><h3 style="margin-top:0">🧬 Decode — clone a build: donor capture → Clone Sheet (the parts) → Bench convergence (the sliders)</h3>
          <p class="why" style="font-size:12px">${pinNote ? pinNote + " · " : ""}${hasRoles || pin ? "Donor: " + (pin ? "📌 pinned — stays until you pick another donor or unpin it" : "from the run roles (🎯 / 🔧)") + "." : isLive ? "Set <b>🎯 DONOR</b> on the locked-tune run and <b>🔧 REPLICA</b> on your rebuild from the stream bar — or pick runs below." : "No run roles in this recording — pick the donor run and the replica run below."} ${sameRun ? "Same run on both sides: a self-check until a replica run exists." : diffCar ? "<b>Different cars on the two sides</b> — a demo comparison; the ledger will be honestly red." : ""}${isLive && pin ? ` <button class="lab-mode" data-unpin style="padding:2px 8px;font-size:11px;margin-left:6px">✕ unpin donor</button>` : ""}</p>
          <div class="lab-bench">
            <div><strong style="color:${dC}">🎯 DONOR / RUN A</strong> <div class="lab-rail">${sD.cars.map((c) => `<span class="chip ${donor === c.id ? "on" : ""}" data-donor="${c.id}">${carLblHtml(sD, c.id)}</span>`).join("")}${stintChips(donor, "donor", sD)}</div></div>
            <div><strong style="color:${rC}">🔧 REPLICA / RUN B</strong> <div class="lab-rail">${s.cars.map((c) => `<span class="chip ${replica === c.id ? "on" : ""}" data-replica="${c.id}">${carLblHtml(s, c.id)}</span>`).join("")}${stintChips(replica, "replica", s)}</div></div>
          </div>
          <div class="lab-rail" style="margin-top:10px">${kinds.map(([k, ok]) => `<span class="chip ${ok ? "on" : "missing"}">${ok ? "✓" : "○"} ${k}</span>`).join("")}</div>
        </div>
        ${hideDonorDeliverable ? "" : (() => { const done = !!(D.decode && D.decode.pct >= 1); const lbl = roleStint("donor") ? "🎯 DONOR · " : "donor (picked) · ";
          const prog = D.decode ? `<div class="block" style="border-color:#e3b341">${decodePanel(D, lbl)}</div>` : "";
          const sheet = D.clone_sheet ? `<div class="block" style="${done ? "border-color:#00d27a" : ""}">${cloneSheetHtml(D)}</div>` : "";
          // DELIVERABLE MODE: once every test is captured the sheet leads and the battery folds away
          return done ? `${sheet}<div class="block" style="border-color:#e3b341"><details><summary style="cursor:pointer;font-size:12px"><b>🧬 Decode progress — ${esc(carName(D) || "")}</b> <span class="chip" style="border-color:#00d27a;color:#00d27a">ALL TESTS CAPTURED</span> <span class="why">capture complete — the sheet above is the deliverable; expand for the per-test battery</span></summary>${D.decode ? decodePanel(D, lbl) : ""}</details></div>` : `${prog}${sheet}`; })()}
        ${isLive ? shopCapture(D.id) : ""}
        <div class="block"><h3 style="margin-top:0">⚖️ Bench — donor vs replica, maneuver by maneuver</h3>
        <div class="lab-bench">
          <div><h3 style="margin-top:0;font-size:14px">⚙️ Gear ladder</h3>${chart([{ pts: lad(donor, D, stintsD), col: dC, label: "A" }, { pts: lad(replica, R, stints), col: rC, label: "B" }], { xl: "gear", yl: "m/s per krpm", w: 380 })}</div>
          <div><h3 style="margin-top:0;font-size:14px">🔧 Dyno (WOT frames)</h3>${chart([{ pts: Dd.map((d) => [d.rpm, d.hp]), col: dC, label: "donor hp" }, { pts: Rd.map((d) => [d.rpm, d.hp]), col: rC, label: "replica hp" }], { xl: "rpm", yl: "hp", w: 380 })}</div>
          <div><h3 style="margin-top:0;font-size:14px">🚦 Launch — rear slip ratio</h3>${lD && lR ? chart([{ pts: lD.trace.map((p) => [p[0], Math.max(Math.abs(p[3]), Math.abs(p[4]))]), col: dC, label: "donor" }, { pts: lR.trace.map((p) => [p[0], Math.max(Math.abs(p[3]), Math.abs(p[4]))]), col: rC, label: "replica" }], { xl: "s", yl: "slip", hline: 1, hlabel: "limit", ymax: 6, w: 380 }) : `<p class="why">needs a launch on both</p>`}</div>
          <div><h3 style="margin-top:0;font-size:14px">🛑 Braking — deficit front vs rear</h3>${chart([{ pts: pick(brakingD, donor).map((b, i) => [i + 1, b.front_deficit]), col: dC, label: "donor F" }, { pts: pick(brakingD, donor).map((b, i) => [i + 1, b.rear_deficit]), col: "#f0883e", label: "donor R" }, { pts: pick(braking, replica).map((b, i) => [i + 1, b.front_deficit]), col: rC, label: "replica F" }, { pts: pick(braking, replica).map((b, i) => [i + 1, b.rear_deficit]), col: "#2f81f7", label: "replica R" }], { xl: "event #", yl: "deficit", w: 380, ymax: 1.05 })}</div>
        </div></div>
        <div class="block" style="margin-top:14px"><h3 style="margin-top:0">📋 Match ledger — green all the way down = decoded</h3>
          <div style="overflow-x:auto"><table><thead><tr><th></th><th>slider group</th><th>measured</th><th>turn next</th></tr></thead><tbody>
            ${ledger.map(([n, v, g, o, m, turn]) => `<tr><td>${light(v, g, o)}</td><td><strong>${n}</strong></td><td class="why" style="font-size:12px">${m}</td><td class="why" style="font-size:12px">${turn}</td></tr>`).join("")}
          </tbody></table></div>
          <p class="why" style="font-size:11px;margin-top:8px">Static certification still applies above this ledger: pane rows dashed, radar matched, and the two HUD clips (pressure, camber). The ledger covers what the panel cannot see.</p></div>`;
    }
    // ---- LIVE mode: EventSource from the local daemon ----
    let es = null, liveUrl = (localStorage.getItem("fh6LiveUrl") || "http://127.0.0.1:8765").replace("//localhost:", "//127.0.0.1:");   // 127.0.0.1 avoids the Windows localhost→IPv6 resolution stall
    const live = { status: null, frame: null, strip: [], corners: [], cars: [], session: null, connected: false, err: false, loaded: null, loop: null, mode: null };
    // the LIVE effective mode (manual override, else daemon suggestion) — pushed to the daemon so its run-split rule matches what you see
    const liveEffMode = () => {   // auto workflow = the daemon's suggestion, but FROZEN while you're in a menu (upgrade / tune screen) so the deliverable stays up while you implement it
      const m = labModeSel(); if (m !== "auto") return m;
      const suggest = (live.mode && live.mode.suggest) || "free";
      const inMenu = !!(live.status && live.status.game === "menu");
      if (!inMenu) { live._lastDriveWf = suggest; return suggest; }
      return live._lastDriveWf || suggest;
    };
    let pushedMode = null;
    // only a MANUAL override is pushed; in auto the daemon uses its own detection (so a second dashboard on the same daemon can't fight it)
    const pushMode = () => { if (!live.connected) return; const m = labModeSel() === "auto" ? "auto" : liveEffMode(); if (m === pushedMode) return; pushedMode = m; fetch(liveUrl + "/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: m }) }).catch(() => { pushedMode = null; }); };
    // ---- pinned DONOR: once chosen it STAYS (across resets, daemon restarts, reloads, workflow switches) until a new donor is picked or it's unpinned.
    // The pin carries a compact copy of the donor's data, so Decode keeps working after the live session has moved on.
    const PIN = () => { try { return JSON.parse(localStorage.getItem("fh6DecodeDonor") || "null"); } catch (e) { return null; } };
    const miniSession = (s, key) => { const b = baseId(key), n = stintOf(key); const f = (a) => (a || []).filter((x) => x.car === b && (n == null || x.stint === n)); const c = car(s, key); return { id: s.id, pinned: true, cars: c ? [c] : [], stints: (s.stints || []).filter((st) => st.id === b && (n == null || st.n === n)), launches: f(s.launches), braking: f(s.braking), corners: f(s.corners), pulses: f(s.pulses), events: [], courses: [], strip: [], summary: s.summary || {} }; };
    const pinDonor = (s, key) => { if (!s || !key || !car(s, key)) return; const base = { sid: s.id, key, name: carName(car(s, key)) || "#" + baseId(key), ts: Date.now() }; try { localStorage.setItem("fh6DecodeDonor", JSON.stringify(Object.assign({ data: miniSession(s, key) }, base))); } catch (e) { try { localStorage.setItem("fh6DecodeDonor", JSON.stringify(base)); } catch (e2) {} } };
    const unpinDonor = () => { localStorage.removeItem("fh6DecodeDonor"); live._donorPick = null; };
    const liveS = () => ({ cars: live.cars });
    const circleSvg = (w) => `<svg viewBox="0 0 120 130" class="tz-svg" data-wheel="${w}" style="max-width:160px">
        <text x="60" y="12" text-anchor="middle" fill="var(--muted)" font-size="10">${w}</text>
        <circle cx="60" cy="68" r="46" fill="none" stroke="#00d27a" stroke-width="3" data-ring="${w}"/>
        <circle cx="60" cy="68" r="23" fill="none" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"/>
        <line x1="60" y1="22" x2="60" y2="114" stroke="var(--line)" stroke-width=".5"/><line x1="14" y1="68" x2="106" y2="68" stroke="var(--line)" stroke-width=".5"/>
        <line x1="60" y1="68" x2="60" y2="68" stroke="#f0883e" stroke-width="4" stroke-linecap="round" data-needle="${w}"/>
        <text x="60" y="128" text-anchor="middle" fill="var(--txt)" font-size="14" font-weight="800" data-peak="${w}">—</text></svg>`;
    // coverage bars + ranked suggestions for one car entry (from analyzer output)
    const SEV = { 3: "#e5414e", 2: "#e3b341", 1: "#2f81f7" };
    const adviceBlock = (c, s) => {
      if (!c || !c.coverage) return "";
      const cov = c.coverage, advAll = c.advice || [], adv = advAll.filter((a) => !a.open), open = advAll.filter((a) => a.open);
      const needed = new Set(open.flatMap((a) => a.needs || []));
      const PLBL = Object.fromEntries(cov.probes.map((p) => [p.key, p.label.split(" (")[0]]));
      return `<div class="lab-corner" style="border-left:4px solid ${s ? carCol(s, c.id) : "var(--accent)"}">
        <div class="card-row" style="margin-top:0"><strong>🎯 ${s ? carLblHtml(s, c.id) : esc(carName(c) || "#" + c.ordinal) + " " + piBadge(c.class, c.pi, true)}</strong><span class="chip" style="border-color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"};color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}">confidence ${Math.round(cov.overall * 100)}%</span></div>
        <div class="lab-bar" style="height:8px;margin:6px 0 10px"><i style="width:${cov.overall * 100}%;background:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}"></i></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px">${cov.probes.map((p) => { const ready = p.ready ?? p.confidence >= 1; const frac = p.key === "dyno" || p.key === "gears" || p.key === "warm"; return `<div title="${esc(p.hint)}" style="${needed.has(p.key) ? "outline:1px dashed var(--warn,#e3b341);outline-offset:3px;border-radius:4px" : ""}"><div style="display:flex;justify-content:space-between"><span>${ready ? "✓ " : ""}${needed.has(p.key) ? "🔍 " : ""}${p.label}</span><b style="color:${ready ? "#00d27a" : "var(--muted)"}">${frac ? Math.round(p.count * 100) + "%" : `${p.count}/${p.required}`} <span style="font-weight:400;color:var(--muted)">· ${Math.round(p.confidence * 100)}%</span></b></div><div class="lab-bar"><i style="width:${p.confidence * 100}%;background:${ready ? "#00d27a" : "#2f81f7"}"></i></div>${p.confidence < 0.97 ? `<span class="why" style="font-size:10px">${p.hint}</span>` : ""}</div>`; }).join("")}</div>
        ${adv.length ? `<div style="margin-top:10px">${adv.slice(0, 5).map((a) => `<div style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><span class="lab-light" style="background:${SEV[a.severity]};margin-top:4px"></span><div style="flex:1"><div style="font-size:12px"><strong>${a.text}</strong></div><div class="why" style="font-size:10.5px">${a.evidence} · confidence ${Math.round(a.confidence * 100)}%</div><div class="lab-bar" style="height:4px;margin-top:3px;max-width:220px"><i style="width:${a.confidence * 100}%;background:${SEV[a.severity]}"></i></div></div></div>`).join("")}</div>` : `<p class="why" style="font-size:11px;margin:8px 0 0">no firm suggestions yet — drive the probes above</p>`}
        ${open.length ? `<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:8px"><div style="font-size:11px;color:var(--warn,#e3b341);font-weight:700">🔍 Further testing needed — evidence is split</div>${open.map((a) => `<div style="margin:6px 0"><div style="font-size:12px">${a.text}</div><div class="why" style="font-size:10.5px">${a.evidence} · uncertainty ${Math.round(a.confidence * 100)}%</div><div class="chips" style="margin-top:3px">${(a.needs || []).map((k) => `<span class="chip" style="border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)">drive: ${PLBL[k] || k}</span>`).join("")}</div></div>`).join("")}</div>` : ""}
      </div>`;
    };
    // course MAP from coordinates: reference-lap path + latest lap overlaid + ALL turns of the course (the canonical/established set — matches the turn count — not only the curvature-mapped ones)
    const courseMap = (geo, corners, turns, opts) => {
      opts = opts || {};
      const pieces = geo && (geo.paths || (geo.path ? [geo.path] : [])); if (!pieces || !pieces.length) return "";
      const pts = geo.path || pieces.flat(), lp = geo.last_path || (geo.last_paths || []).flat(), layout = geo.layout_paths || []; if (pts.length < 5) return "";
      const all = pts.concat(lp, ...layout.map((l) => l.pts));
      const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const W = 460, H = 300, pad = 20; const sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, z1 - z0));
      const X = (x) => pad + (x - x0) * sc + ((W - 2 * pad) - (x1 - x0) * sc) / 2, Y = (z) => H - pad - (z - z0) * sc - ((H - 2 * pad) - (z1 - z0) * sc) / 2;
      const poly = (arr) => arr.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
      // the turn markers = the CANONICAL turns of the course (established across sessions, positions in world coords) — so the map matches the count.
      // A canonical turn is "geometry-confirmed" if a curvature turn sits near it, and "loaded" if a behavioural corner was measured near it this session.
      // ONE table for markers, clicks and the breakdown panel — the old canonical/geometry ternary made the
      // geometry fallback clickable while the panel only indexed canonical, so those clicks did nothing.
      const _tt = opts.co ? turnTable(opts.co) : { turns: (turns && turns.canonical && turns.canonical.length ? turns.canonical.map((t, i) => ({ n: i + 1, id: t.id, pos: t.pos, dir: t.dir, radius_m: t.radius_m })) : (geo.turns || []).map((g, i) => ({ n: i + 1, id: g.id, pos: g.apex, dir: g.dir, radius_m: g.radius_m, provisional: true }))), source: "model" };
      const canon = _tt.turns.map((t) => ({ id: t.id, pos: t.pos, dir: t.dir, r: t.radius_m, provisional: t.provisional }));
      const gTurns = (geo.turns || []).map((g) => g.apex); const nearAny = (pos, list, d) => list.some((q) => (q[0] - pos[0]) ** 2 + (q[1] - pos[1]) ** 2 <= d * d);
      const cornerPos = (corners || []).map((k) => k.pos).filter(Boolean);
      const markers = canon.map((t, i) => ({ n: i + 1, id: t.id, pos: t.pos, dir: t.dir, r: t.r, provisional: t.provisional, mapped: nearAny(t.pos, gTurns, 45), loaded: nearAny(t.pos, cornerPos, 45),
        grip: (() => { const k = (corners || []).filter((c) => c.pos && (c.pos[0] - t.pos[0]) ** 2 + (c.pos[1] - t.pos[1]) ** 2 <= TURN_R * TURN_R).slice(-1)[0];
          return k ? gripFromAxle(k.dominant, k.drift) : null; })() }));   // a turn wears the state it took: blue when the fronts went, purple when all four did
      // LIVE INSTRUMENT: on the live source the map carries (a) the transform constants so paintFrame can move the
      // car marker every frame without re-rendering, (b) a per-turn GRADE ring from the Last-corner scoring — the
      // map and the scorecard speak about the same turn in the same color.
      const OX = pad + ((W - 2 * pad) - (x1 - x0) * sc) / 2, OY = H - pad - ((H - 2 * pad) - (z1 - z0) * sc) / 2;
      const gradeByTurn = {}; if (opts.live && typeof live !== "undefined") (live.cornerScores || []).forEach((s2) => { if (s2.key && String(s2.key).indexOf("ct") === 0) gradeByTurn[+String(s2.key).slice(2)] = s2; });
      return `<svg viewBox="0 0 ${W} ${H}" class="tz-svg"${opts.live ? ` data-live-map="1" data-x0="${x0}" data-z0="${z0}" data-sc="${sc}" data-ox="${OX.toFixed(2)}" data-oy="${OY.toFixed(2)}" data-w="${W}" data-h="${H}"` : ""} style="max-width:${W}px;background:var(--bg);border-radius:8px">
        ${layout.map((l) => `<polyline fill="none" stroke="var(--muted)" stroke-width="1" opacity=".32" points="${poly(l.pts)}"/>`).join("")}
        ${(geo.last_paths || (lp.length ? [lp] : [])).map((pc) => `<polyline fill="none" stroke="var(--warn,#e3b341)" stroke-width="2" stroke-dasharray="4 3" opacity=".9" points="${poly(pc)}"/>`).join("")}
        ${pieces.map((pc) => `<polyline fill="none" stroke="var(--accent2)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" points="${poly(pc)}"/>`).join("")}
        <circle cx="${X(pts[0][0]).toFixed(1)}" cy="${Y(pts[0][1]).toFixed(1)}" r="4" fill="#00d27a"/><text x="${(X(pts[0][0]) + 6).toFixed(1)}" y="${(Y(pts[0][1]) - 4).toFixed(1)}" fill="#00d27a" font-size="9">start</text>
        ${markers.map((g) => { const col = g.grip && g.grip !== "calm" ? gripCol(g.grip) : g.loaded ? "#00d27a" : g.mapped ? "var(--accent)" : "var(--warn,#e3b341)"; const sel = opts.selN === g.n; const rk = opts.rk || ""; const gr = gradeByTurn[g.n]; const fresh = gr && gr.at && (Date.now() - gr.at < 8000); return `<g class="ct-marker${sel ? " sel" : ""}" data-tn="${g.n}"${rk ? ` data-courseturn="${esc(rk)}|${g.n}" style="cursor:pointer"` : ""}>${gr ? `<circle class="tn-grade${fresh ? " fresh" : ""}" cx="${X(g.pos[0]).toFixed(1)}" cy="${Y(g.pos[1]).toFixed(1)}" r="8.5" fill="none" stroke="${GRADE_COL[gr.grade]}" stroke-width="2.2"><title>latest pass: grade ${gr.grade} · score ${gr.score}${gr.deltaBest != null ? ` · ${gr.deltaBest >= 0 ? "+" : ""}${gr.deltaBest} vs best` : ""}</title></circle>` : ""}${sel ? `<circle cx="${X(g.pos[0]).toFixed(1)}" cy="${Y(g.pos[1]).toFixed(1)}" r="9.5" fill="none" stroke="var(--txt)" stroke-width="1.6"/>` : ""}<circle cx="${X(g.pos[0]).toFixed(1)}" cy="${Y(g.pos[1]).toFixed(1)}" r="${sel ? 6 : 5}" fill="${g.grip && g.grip !== "calm" ? gripCol(g.grip) : g.loaded ? "#00d27a" : "var(--bg)"}" stroke="${col}" stroke-width="1.5"><title>Turn ${g.n}${g.dir ? " · " + g.dir : ""}${g.r ? " · r≈" + g.r + " m" : ""} — ${rk ? "click for the full breakdown · " : ""}${g.loaded ? "loaded in telemetry this session" : g.mapped ? "on the map, not loaded this session (take it at pace)" : "counted from your laps, not yet curvature-mapped (a fast/flat turn)"}</title></circle><text x="${(X(g.pos[0]) + 6).toFixed(1)}" y="${(Y(g.pos[1]) + 3).toFixed(1)}" fill="${col}" font-size="9" font-weight="700">${g.n}</text></g>`; }).join("")}
        ${(() => { if (!opts.live || typeof live === "undefined") return ""; const ls = (live.cornerScores || []).slice(-1)[0]; if (!ls || !ls.pos || ls.pos[0] == null) return ""; const lx = X(ls.pos[0]), ly = Y(ls.pos[1]); if (lx < -25 || ly < -25 || lx > W + 25 || ly > H + 25) return ""; return `<g class="lv-last" transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})">${lastCornerSvg(ls)}</g>`; })()}
        ${opts.live ? `<g class="lv-car" style="display:none"><circle r="9" fill="none" stroke="#00d27a" stroke-width="1.4" opacity=".45"/><circle r="4.6" fill="#00d27a" stroke="#0e1116" stroke-width="1.4"><title>you — live position</title></circle></g>` : ""}
      </svg>`;
    };
    // COURSE IDENTITY: the auto-computed SHAPE (from ground-truth position data) is a course's PRIMARY identifier —
    // there is no track-name string in telemetry, so identity = shape + the user's title. A compact outline glyph,
    // usable inline atop every course section; an unnamed course still reads by its shape (no ugly "route @ x,z").
    const courseShapeGlyph = (geo, w) => {
      const g = geo || {}; const pts = g.path || (g.paths ? g.paths.flat() : null);
      if (!pts || pts.length < 5) return "";
      const wide = w || 92, H = Math.round(wide * 0.64), pad = 5;
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const sc = Math.min((wide - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, z1 - z0));
      const X = (x) => pad + (x - x0) * sc + ((wide - 2 * pad) - (x1 - x0) * sc) / 2, Y = (z) => H - pad - (z - z0) * sc - ((H - 2 * pad) - (z1 - z0) * sc) / 2;
      const poly = pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
      return `<svg viewBox="0 0 ${wide} ${H}" width="${wide}" height="${H}" class="course-glyph" role="img" aria-label="course shape"><polyline fill="none" stroke="var(--accent2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${poly}"/><circle cx="${X(pts[0][0]).toFixed(1)}" cy="${Y(pts[0][1]).toFixed(1)}" r="3" fill="#00d27a"/></svg>`;
    };
    // COURSE IDENTITY = name + STARTING POINT + shape. The start is the primary distinguisher between same-named /
    // same-shaped variants; the green ● is the one symbol tying the glyph's start dot, the meta chip and the mini form.
    const startOfKey = (rk, geo) => { if (rk && /^-?\d+_-?\d+$/.test(String(rk))) return String(rk).replace("_", ", "); const p0 = geo && ((geo.path || (geo.paths || [])[0] || [])[0]); return p0 ? `${Math.round(p0[0])}, ${Math.round(p0[1])}` : null; };
    const geoForKey = (rk) => { if (!rk) return null; try { if (typeof live !== "undefined") { if (live.courseGeo && _hasGeo(live.courseGeo[rk])) return live.courseGeo[rk]; const co = ((live.analysis || {}).courses || []).find((c) => c.route_key === rk); if (co && _hasGeo(co.geometry)) return co.geometry; } } catch (e) {} const m = (DB.courseModels || []).find((x) => x && x.route_key === rk); return m ? m.geometry : null; };
    // compact one-line course identity for table rows & chips: [shape glyph] name · ● start
    const courseIdentMini = (rn, geo, rk, w) => { const g2 = geo || geoForKey(rk); const glyph = courseShapeGlyph(g2, w || 22); const st = startOfKey(rk, g2); const nm = rn && !/^route @/i.test(rn) ? rn : null; return `<span class="course-mini"${st ? ` title="start ${st}"` : ""}>${glyph ? `<span class="course-mini-glyph">${glyph}</span>` : ""}<b>${esc(nm || (st ? "route @ " + st : "course"))}</b>${st && nm ? ` <small class="start-pt"><i>●</i> ${st}</small>` : ""}</span>`; };
    // COURSE TAGS — the course's TYPE and the CAR TYPES that fit it, derived from the MEASURED makeup (the profile
    // built during course learning/tuning). Works on a live analysis course OR a persisted course model (identical
    // profile shape). No profile yet → no tags: tags are earned from data, never guessed.
    const courseTags = (x) => {
      const prof = x && x.profile; if (!prof || !prof.dims) return null;
      const d = prof.dims; const band = (k) => (d[k] || {}).band || "absent"; const frac = (k) => (d[k] || {}).frac || 0;
      const BB = { heavy: "#e5414e", moderate: "#e3b341", light: "#2f81f7", absent: "#3a4250" };
      const tags = [], fits = [];
      const rk = x.route_key || ""; const visits = x.visits || (x.track && x.track.visits) || null; const evs = x.events || null;
      const kind = (String(rk).indexOf("loop:") === 0 || x.is_loop) ? "reference loop" : ((visits && visits.some((v) => (v.laps || 0) > (v.attempts || 0))) || (evs && evs.some((e) => (e.laps || 0) > 1))) ? "circuit" : (visits || evs) ? "point-to-point" : null;
      const arch = [
        ["low_corner", "🌀 technical — low-speed corners", "hairpins & tight turns define the lap"],
        ["mid_corner", "〰 momentum — medium corners", "carried speed beats top-end here"],
        ["fast_corner", "🌊 flow — fast sweepers", "stability at speed decides it"],
        ["straight", "⚡ power — straights / top-end", "top-end and gearing decide it"],
        ["braking", "🛑 braking-heavy", "repeated hard stops from speed"],
      ];
      arch.forEach(([k, t, why]) => { if (band(k) === "heavy") tags.push({ t, col: BB.heavy, why: `${Math.round(frac(k) * 100)}% of the lap — ${why}` }); });
      if (!tags.length) arch.forEach(([k, t, why]) => { if (band(k) === "moderate") tags.push({ t, col: BB.moderate, why: `${Math.round(frac(k) * 100)}% of the lap — ${why}` }); });   // nothing heavy → the moderates ARE the character
      if (band("elevation") !== "absent") tags.push({ t: `🏔 elevation ±${Math.round(prof.elevation_range_m || (d.elevation || {}).range_m || 0)} m`, col: BB[band("elevation")], why: "crests & compressions work the springs/dampers" });
      if (prof.rough_frac != null && prof.rough_frac > 0.15) tags.push({ t: prof.rough_frac > 0.35 ? "🌾 rough surface" : "🌾 part rough", col: prof.rough_frac > 0.35 ? BB.heavy : BB.moderate, why: `${Math.round(prof.rough_frac * 100)}% of cornering on rumble / loose surface (measured)` });
      const comp = x.composition; if (comp && (comp.flick || 0) >= 3) tags.push({ t: "↔ flicks — quick transitions", col: BB.moderate, why: `${comp.flick} left-right transitions this session — damper/ARB response matters` });
      const glen = x.geometry && x.geometry.length_m; if (glen && glen > 15000) tags.push({ t: "🛣 endurance lap", col: "var(--muted)", why: `${(glen / 1000).toFixed(1)} km per lap` });
      // CAR FIT — what the makeup rewards, in the car cards' own tuning vocabulary (top-2 demands + terrain)
      const FIT = {
        low_corner: ["🌀 rotation + launch", "light, short-geared builds; AWD launch out of hairpins; front grip for turn-in"],
        mid_corner: ["〰 mechanical grip", "momentum builds — balanced grip over raw power (mid-corner Mechanical Balance is the target)"],
        fast_corner: ["🌊 downforce + stability", "aero-led builds — high-speed stability beats acceleration"],
        straight: ["⚡ top-end power", "power builds — tall gearing, minimal drag aero"],
        braking: ["🛑 brakes + entry stability", "big brakes, stable decel — late-braking wins here"],
      };
      ["low_corner", "mid_corner", "fast_corner", "straight", "braking"].map((k) => [k, frac(k)]).sort((a, b) => b[1] - a[1]).filter(([, f]) => f >= 0.09).slice(0, 2).forEach(([k]) => fits.push({ t: FIT[k][0], col: "var(--accent)", why: FIT[k][1] }));
      if (band("elevation") === "moderate" || band("elevation") === "heavy") fits.push({ t: "🏔 compliance", col: "var(--accent)", why: "softer springs / more travel — crests unload the tyres" });
      if (prof.rough_frac != null && prof.rough_frac > 0.35) fits.push({ t: "🌾 Dirt / Rally build", col: "var(--accent)", why: DISCIPLINE_TUNING.dirt_rally });
      return { kind, tags, fits };
    };
    // measured evidence beats derived advice: the fastest RECORDED build here, in the tune-identity language
    const courseMeasuredChip = (x) => { try {
      const bl = (x.track && x.track.best_laps) || (x.best_laps ? Object.entries(x.best_laps).map(([c2, v]) => Object.assign({ cid: c2 }, v)).sort((a, b) => a.best_lap - b.best_lap) : []);
      const b = bl && bl[0]; if (!b || b.best_lap == null) return "";
      return `<span class="chip" style="border-color:#00d27a;color:#00d27a" title="measured, not guessed — the fastest recorded lap here: ${esc(b.name || b.cid || "")}${b.hp ? " · " + b.hp + " hp" : ""}">🏆 fastest here: ${buildThumb(String(b.cid || "").split("|")[0], b.build_id, true)} ${piBadge(b.class || null, b.pi || null, true)}${b.drivetrain ? " " + esc(b.drivetrain) : ""} · ${b.best_lap.toFixed(3)} s</span>`;
    } catch (e) { return ""; } };
    // PER-TUNE SPEED TRACES: every saved best-lap speed-vs-distance curve for this circuit, overlaid — gated to the
    // viewer's CLASS (an S1 trace against a D trace is noise, not signal). Legend chips wear the tune identity
    // (livery thumb + PI badge); turn ticks speak the map's T-number language. YOUR tune is the blue emphasized line.
    const _traceCls = (curCar) => { const fp = (live.frame && live.frame.on && live.frame.cls) || null; if (fp) return fp; const pi = curCar ? +String(curCar).split("|")[3] : NaN; return isFinite(pi) ? CLS_OF_PI(pi) : null; };
    const _traceEntries = (co, curCls) => Object.entries(co.speed_traces || {}).map(([c2, t]) => Object.assign({ cid: c2, cls: t.class || CLS_OF_PI(t.pi) }, t)).filter((t) => t.pts && t.pts.length > 2 && (!curCls || t.cls === curCls));
    const speedTracesCard = (co, curCar) => { try {
      const st = co.speed_traces; if (!st || !Object.keys(st).length) return "";
      const curCls = _traceCls(curCar);
      const match = _traceEntries(co, curCls);
      if (!match.length) { const have = [...new Set(Object.values(st).map((t) => t.class || CLS_OF_PI(t.pi)).filter(Boolean))]; return `<div class="lab-corner" style="border-left:4px solid var(--muted);font-size:11.5px"><b>📈 Speed traces</b> <span class="why">no saved trace for ${curCls ? "class " + esc(curCls) : "this class"} on this circuit yet — a clean best lap saves one per tune automatically${have.length ? " · traces exist for class " + have.map(esc).join(", ") : ""}</span></div>`; }
      match.sort((a, b) => (a.lap_s || 9e9) - (b.lap_s || 9e9));
      const smax = Math.max(...match.map((t) => t.pts[t.pts.length - 1][0])); if (!smax) return "";
      const vmax = Math.max(...match.flatMap((t) => t.pts.map((p) => p[1]))) * 1.06 || 1;
      const W2 = 560, H2 = 150, padL = 26, padB = 15;
      const px2 = (s) => padL + (s / smax) * (W2 - padL - 6), py2 = (v) => (H2 - padB) - (v / vmax) * (H2 - padB - 8);
      const line = (t, col, w2, op) => `<polyline fill="none" stroke="${col}" stroke-width="${w2}" opacity="${op}" points="${t.pts.map((p) => `${px2(p[0]).toFixed(1)},${py2(p[1]).toFixed(1)}`).join(" ")}"/>`;
      // GRIP-PAINTED trace: the same line, cut into runs of one state, so a turn reads blue the instant the
      // fronts give up and purple when all four go — the state change IS the shape of the line, seamlessly.
      const gripLine = (t, w2) => { const P = t.pts; if (!P.length || P[0].length < 3) return line(t, "var(--accent2)", w2, 1);
        const segs = []; let run = [P[0]], st = P[0][2];
        for (let i = 1; i < P.length; i++) { if (P[i][2] !== st) { run.push(P[i]); segs.push([st, run]); run = [P[i]]; st = P[i][2]; } else run.push(P[i]); }
        segs.push([st, run]);
        return segs.map(([s2, pts2]) => `<polyline fill="none" stroke="${gripCol(s2)}" stroke-width="${s2 ? w2 + 0.8 : w2}" stroke-linecap="round" opacity="${s2 ? 1 : 0.85}" points="${pts2.map((p) => `${px2(p[0]).toFixed(1)},${py2(p[1]).toFixed(1)}`).join(" ")}"><title>${esc(gripOf(s2).axle)}</title></polyline>`).join("");
      };
      const isCur = (t) => !!curCar && t.cid === curCar; const best = match[0]; const cur = match.find(isCur);
      const geo = courseGeoFor(co); const canon2 = ((co.turns || {}).canonical) || [];
      const tkLbl = (g2) => { let bi = -1, bd = 60 * 60; canon2.forEach((t2, i2) => { const d2 = (t2.pos[0] - g2.apex[0]) ** 2 + (t2.pos[1] - g2.apex[1]) ** 2; if (d2 < bd) { bd = d2; bi = i2; } }); return bi >= 0 ? "T" + (bi + 1) : "·"; };   // THIS course's T-numbers, not courses[0]'s
      const ticks = ((geo && geo.turns) || []).filter((g2) => g2.s != null && g2.apex).map((g2) => `<line x1="${px2(g2.s).toFixed(1)}" y1="${H2 - padB}" x2="${px2(g2.s).toFixed(1)}" y2="8" stroke="var(--line)" opacity=".55"/><text x="${px2(g2.s).toFixed(1)}" y="${H2 - 4}" text-anchor="middle" font-size="8" fill="var(--muted)">${tkLbl(g2)}</text>`).join("");
      const axis = [0.5, 1].map((f2) => { const v = Math.round(vmax * f2 / 10) * 10; return `<text x="2" y="${(py2(v) + 3).toFixed(1)}" font-size="8" fill="var(--muted)">${v}</text>`; }).join("");
      // rivals: plain lines (comparison). YOUR tune: grip-painted, because that is the one you can act on.
      const lines = match.map((t) => (isCur(t) ? "" : line(t, t === best ? "#00d27a" : "var(--muted)", t === best ? 1.8 : 1.1, t === best ? 0.9 : 0.45))).join("") + (cur ? gripLine(cur, 2.4) : "");
      const hasGrip = !!(cur && cur.pts && cur.pts[0] && cur.pts[0].length > 2);
      const leg = match.slice(0, 6).map((t) => `<span class="chip" title="${esc((t.session || "") + (t.build_id ? " · build " + t.build_id : ""))}" style="border-color:${isCur(t) ? "var(--accent2)" : t === best ? "#00d27a" : "var(--line)"};${isCur(t) || t === best ? "" : "color:var(--muted)"}">${buildThumb(String(t.cid).split("|")[0], t.build_id, true)} ${piBadge(t.cls, t.pi, true)}${t.lap_s ? ` · ${t.lap_s.toFixed(1)} s` : ""}${isCur(t) ? " · you" : t === best ? " · fastest" : ""}</span>`).join("");
      return `<div class="lab-corner" style="border-left:4px solid var(--accent2)"><div class="card-row" style="margin-top:0"><strong>📈 Speed traces — class ${esc(curCls || "all")} on this circuit</strong><span class="why" style="font-size:10.5px">${match.length} saved tune${match.length === 1 ? "" : "s"} · each tune's best lap · mph vs distance</span></div>
        <div style="overflow-x:auto"><svg class="spd-trace" viewBox="0 0 ${W2} ${H2}" style="min-width:420px;max-width:100%;background:var(--bg);border-radius:8px"
             data-smax="${smax}" data-padl="${padL}" data-w="${W2}" data-h="${H2}"
             data-pts="${hasGrip ? esc(JSON.stringify(cur.pts.map((p) => [p[0], p[1], p[2], p[3], p[4]]))) : ""}">${axis}${ticks}${lines}
             <g class="spd-cursor" style="display:none"><line y1="6" y2="${H2 - padB}" stroke="var(--txt)" stroke-width="1" opacity=".6"/><circle r="3.5" fill="var(--txt)"/></g></svg></div>
        <div class="spd-read why" style="font-size:10.5px;min-height:14px">${hasGrip ? "hover the trace — it marks that exact spot on the course map" : ""}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${leg}</div>
        ${hasGrip ? `<div style="margin-top:4px">${gripLegend(["calm", "front", "rear", "both", "impact"])}</div>` : ""}</div>`;
    } catch (e) { return ""; } };
    const turnTraceStrip = (co, tpos, curCar) => { try {
      if (!co.speed_traces || !tpos) return ""; const geo = courseGeoFor(co);
      const gt = ((geo && geo.turns) || []).find((g2) => g2.apex && g2.s != null && ((g2.apex[0] - tpos[0]) ** 2 + (g2.apex[1] - tpos[1]) ** 2) <= 45 * 45); if (!gt) return "";
      const curCls = _traceCls(curCar); const entries = _traceEntries(co, curCls); if (!entries.length) return "";
      const s0 = Math.max(0, gt.s - 120), s1 = gt.s + 180;
      const segs = entries.map((t) => ({ t, pts: t.pts.filter((p) => p[0] >= s0 && p[0] <= s1) })).filter((x) => x.pts.length > 2); if (!segs.length) return "";
      const vmax = Math.max(...segs.flatMap((x) => x.pts.map((p) => p[1]))) * 1.08 || 1; const W3 = 240, H3 = 74;
      const px3 = (s) => ((s - s0) / (s1 - s0)) * (W3 - 8) + 4, py3 = (v) => (H3 - 6) - (v / vmax) * (H3 - 14);
      const best = segs.slice().sort((a, b) => ((a.t.lap_s || 9e9) - (b.t.lap_s || 9e9)))[0];
      const lines = segs.map((x) => `<polyline fill="none" stroke="${curCar && x.t.cid === curCar ? "var(--accent2)" : x === best ? "#00d27a" : "var(--muted)"}" stroke-width="${curCar && x.t.cid === curCar ? 2.2 : x === best ? 1.6 : 1}" opacity="${curCar && x.t.cid === curCar ? 1 : x === best ? 0.9 : 0.4}" points="${x.pts.map((p) => `${px3(p[0]).toFixed(1)},${py3(p[1]).toFixed(1)}`).join(" ")}"/>`).join("");
      return `<div class="ct-trace" style="margin-top:5px"><svg viewBox="0 0 ${W3} ${H3}" width="${W3}" height="${H3}" style="background:var(--bg);border-radius:6px"><line x1="${px3(gt.s).toFixed(1)}" y1="4" x2="${px3(gt.s).toFixed(1)}" y2="${H3 - 4}" stroke="var(--warn,#e3b341)" opacity=".7"/>${lines}</svg><div class="why" style="font-size:9.5px">speed through this turn — <span style="color:var(--accent2)">you</span> vs <span style="color:#00d27a">fastest</span> · class ${esc(curCls || "all")}${segs.length > 1 ? ` · ${segs.length} tunes` : ""} · ${"｜"} = apex</div></div>`;
    } catch (e) { return ""; } };
    const courseTagsRow = (x) => {
      const ct = courseTags(x); if (!ct) return "";
      const chip2 = (g) => `<span class="chip" style="border-color:${g.col};color:${g.col}" title="${esc(g.why)}">${g.t}</span>`;
      const kindChip = ct.kind ? `<span class="chip" style="border-color:var(--accent2);color:var(--accent2)" title="topology from recorded laps">${ct.kind === "reference loop" ? "📍" : ct.kind === "circuit" ? "🔁" : "➡"} ${ct.kind}</span>` : "";
      // RIVALS: the packet has no mode field, so this is inferred from RacePosition — and CLICKABLE, because the
      // player's own word beats a heuristic that cannot tell a wire-to-wire race win from a time trial.
      const _tuR = x.turns || {}; const _riv = _tuR.rivals, _rsrc = _tuR.rivals_src;
      const rivChip = x.route_key ? `<span class="chip" data-rivals="${esc(x.route_key)}|${_riv ? 0 : 1}" style="cursor:pointer;border-color:${_riv ? "var(--accent)" : "var(--line)"};color:${_riv ? "var(--accent)" : "var(--muted)"}" title="${_rsrc === "declared" ? "you declared this a Rivals course — its laps are the clean comparable ones" : _riv ? "inferred from race position (no opponents seen) — click to confirm" : "races recorded here — click if this is actually a Rivals course"}">🏁 ${_riv ? "Rivals" : "not Rivals"}${_rsrc === "declared" ? "" : " ≈"}</span>` : "";
      return `<div class="course-tags" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px">${kindChip}${rivChip}${ct.tags.map(chip2).join("")}${ct.fits.length ? `<span class="why" style="font-size:10px">fits:</span>${ct.fits.map(chip2).join("")}` : ""}${courseMeasuredChip(x)}</div>`;
    };
    const courseIdentity = (rn, geo, opts) => {
      opts = opts || {}; const glyph = courseShapeGlyph(geo, opts.w || 112);
      const named = !!rn && !/^route @/i.test(rn) && rn !== "Rivals course"; const g = geo || {};
      const meta = []; const st0 = startOfKey(opts.routeKey, g); if (st0) meta.push(`<span class="start-pt" title="starting point — the green dot on the shape"><i>●</i> start ${st0}</span>`);
      if (g.length_m) meta.push(g.length_m + " m"); if (g.turns && g.turns.length) meta.push(g.turns.length + " turns"); if (opts.topology) meta.push(opts.topology);
      const title = named ? esc(rn) : "unnamed course";
      const editable = !!opts.routeKey;   // double-click the title to name the course on the spot (persists to routes.json)
      const nameB = `<b class="course-id-name${editable ? " editable" : ""}"${named ? "" : ' style="color:var(--muted);font-weight:600"'}${editable ? ` data-nameroute="${esc(opts.routeKey)}" data-curname="${named ? esc(rn) : ""}"${opts.mode ? ` data-namemode="${esc(opts.mode)}"` : ""} title="double-click to name this course"` : ""}>${title}</b>`;
      return `<div class="course-id">${glyph ? `<div class="course-id-glyph"${named ? "" : ' title="the shape is this course&#39;s identity — name it in the Atlas"'}>${glyph}</div>` : `<div class="course-id-glyph noshape" title="shape appears once a full lap is mapped">🗺</div>`}<div class="course-id-main"><div class="course-id-title">${opts.icon || "🏟"} ${nameB}</div>${meta.length ? `<div class="course-id-meta">${meta.join(" · ")}</div>` : ""}${opts.tags || ""}${named ? "" : `<div class="course-id-hint">its shape is the identity · ${editable ? "<b>double-click the title</b> to name it" : "title it in 🗺 Atlas"}</div>`}</div>${opts.right ? `<div class="course-id-right">${opts.right}</div>` : ""}</div>`;
    };
    // COURSE SHAPE HERO — the interactive map is the course's single most important element; it sits directly under the
    // identity, front-and-centre, in BOTH stages (was buried in a sub-panel / a collapsed drawer). Empty state below
    // makes the shape's absence explicit so the user knows a lap is all that's needed to draw it.
    // SHAPE-CONFIDENCE badge — how sure we are the auto-computed outline is right (laps that trace the same shape, ± their spread).
    // This is the exact quantity the training→tuning gate now leans on, surfaced right on the shape so the user sees it ratify.
    const shapeBadge = (co) => {
      const tu = (co && co.turns) || {}; if (tu.shape_confidence == null) return "";
      const c = tu.shape_confidence, ag = tu.shape_laps_agree || 0, sp = tu.shape_spread_m, lvl = c >= 0.75 ? "ok" : c >= 0.45 ? "warn" : "off";
      const word = c >= 0.75 ? "ratified" : c >= 0.45 ? "stabilizing" : "unverified";
      const detail = `${ag} lap${ag === 1 ? "" : "s"} agree${sp != null ? ` · ±${sp} m` : ""} · ${Math.round(c * 100)}%`;
      return `<span class="shape-badge ${lvl}" title="the recorded laps that trace the same outline, and their spread — this is what the tuning gate uses"><span class="sys-dot"></span>SHAPE · ${word}<small>${detail}</small></span>`;
    };
    const courseHero = (p, co) => {
      if (p && p.map) return `<div class="course-hero"><div class="course-hero-ey"><span>▨ COURSE SHAPE — the identity of this course · click any turn for its breakdown</span>${shapeBadge(co)}</div>${p.map}</div>`;
      const co2 = co || {}; const nl = co2.laps ? co2.laps.total : co2.runs;
      const g0 = courseGeoFor(co2); const st0 = startOfKey(co2.route_key, g0);   // the start point is known pre-lap — it is the only identity available while the shape draws
      return `<div class="course-hero building">${courseShapeGlyph(g0, 60) || `<span style="font-size:32px;line-height:1">🗺</span>`}<div><b style="font-size:13.5px">Mapping this course's shape…</b>${st0 ? `<div class="start-pt" style="font-size:11px;margin-top:1px"><i>●</i> start ${st0}</div>` : ""}<div class="why" style="font-size:11px;margin-top:2px">the outline is this course's <b>primary identity</b> — ${co2.is_loop === false ? "reach the event end" : "complete one full lap"} and it draws here from your position trace${nl ? ` · ${nl} pass${nl === 1 ? "" : "es"} so far` : ""}</div></div></div>`;
    };
    // ---- course card pieces (also used for atlas-selected tracks that are NOT in the current session: rendered from the track record) ----
    const profileCardHtml = (prof) => { const BB = { heavy: "#e5414e", moderate: "#e3b341", light: "#2f81f7", absent: "#3a4250" }; const DLBL = { low_corner: "low-speed corners", mid_corner: "medium corners", fast_corner: "fast sweepers", braking: "heavy braking", straight: "straights / top-end", elevation: "elevation" }; return prof ? `<div style="margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2)">
          <strong style="font-size:12px">🗺 Course profile — what this track actually demands</strong>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">${["low_corner", "mid_corner", "fast_corner", "braking", "straight", "elevation"].map((k) => { const b = prof.dims[k].band; return `<span class="chip" title="${prof.dims[k].frac != null ? Math.round(prof.dims[k].frac * 100) + "% of the lap" : (prof.dims[k].range_m != null ? prof.dims[k].range_m + " m elevation" : b)}" style="border-color:${BB[b]};color:${b === "absent" ? "var(--muted)" : BB[b]};${b === "absent" ? "text-decoration:line-through" : ""}">${b === "heavy" ? "●●● " : b === "moderate" ? "●● " : b === "light" ? "● " : "○ "}${DLBL[k]}</span>`; }).join("")}</div>
          ${prof.priority.length ? `<p class="why" style="font-size:11px;margin:2px 0"><b>Tune priority here:</b> ${prof.priority.join(" › ")}</p>` : ""}
          ${prof.notes.map((n) => `<p class="why" style="font-size:10.5px;margin:2px 0;color:var(--warn,#e3b341)">⚠ ${n}</p>`).join("")}
        </div>` : ""; };
    const trackRecordHtml = (tr, rn, trGeo, trRk) => { const carLabel = (c) => `${buildThumb(String(c.cid).split("|")[0], c.build_id, true)} ${esc(c.name || "#" + String(c.cid).split("|")[0])} ${piBadge(c.class || null, c.pi || null, true)}`.trim(); return tr ? `<div style="margin:8px 0;padding:8px 10px;border:1px solid var(--accent2);border-radius:8px;background:var(--bg2)">
          <div class="card-row" style="margin-top:0"><strong style="font-size:12px">🏁 Track record — ${courseIdentMini(tr.name || rn, trGeo, trRk, 22)}</strong><span class="chip" style="border-color:var(--accent2);color:var(--accent2)">${tr.laps} lap${tr.laps === 1 ? "" : "s"} · ${tr.attempts || 0} attempt${tr.attempts === 1 ? "" : "s"} · ${tr.sessions} session${tr.sessions === 1 ? "" : "s"} · ${(tr.cars || []).length} car${(tr.cars || []).length === 1 ? "" : "s"}</span></div>
          <div style="font-size:11.5px;margin-top:4px">${tr.best ? `track best <b style="color:#00d27a">${tr.best.best_lap.toFixed(3)} s</b> <span class="why">(${carLabel(tr.best)}${tr.best.session ? ", " + tr.best.session.slice(-6) : ""})</span>` : "no timed lap yet"}${tr.this_session_best ? ` · this session <b>${tr.this_session_best.toFixed(3)} s</b>${tr.delta_to_track_best != null ? ` <span style="color:${tr.delta_to_track_best <= 0 ? "#00d27a" : "var(--warn,#e3b341)"}">(${tr.delta_to_track_best > 0 ? "+" : ""}${tr.delta_to_track_best.toFixed(3)})</span>` : ""}` : ""}</div>
          ${(tr.best_laps || []).length > 1 || ((tr.best_laps || []).length === 1 && (tr.cars || []).length > 1) ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${tr.best_laps.map((b, i) => `<span class="chip" title="session ${b.session}" style="${i === 0 ? "border-color:#00d27a;color:#00d27a" : ""}">${carLabel(b)} · ${b.best_lap.toFixed(3)} s</span>`).join("")}</div>` : ""}
          ${(tr.visits || []).length > 1 ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px;font-size:10.5px"><span class="why">visits:</span>${tr.visits.map((v) => `<span class="chip" title="${v.session}${v.best_car ? " · " + v.best_car : ""}">${v.session.slice(-6)} · ${v.laps}L${v.best_lap ? " · " + v.best_lap.toFixed(2) : ""}</span>`).join("")}</div>` : ""}
          <p class="why" style="font-size:10px;margin:5px 0 0">one record per track — every car and session that visits it adds laps, references and best times here; the turn references below are per car</p>
        </div>` : ""; };
    // PER-TURN CORNERING BREAKDOWN — clicking a turn on the course map opens THIS: the full corner structure for that
    // turn (the phase where grip broke, balance, entry/apex/exit speeds, grip-envelope apex), STAGE-AWARE — a learning
    // status while the layout is still being ratified, then tuning feedback + the fix once confidence crosses 75%.
    const courseTurnBreakdown = (co, n) => {
      const tu = co.turns || {}; const canon = tu.canonical || []; const t = canon[n - 1]; if (!t) return "";
      const near = (a, b, d) => a && b && ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) <= d * d;
      const cs = (co.corners || []).filter((k) => k.pos && !k.drift && near(k.pos, t.pos, 45));
      const c = cs.length ? cs[cs.length - 1] : null;   // the latest measured pass through this turn this session
      const geo = courseGeoFor(co); const gTurns = ((geo && geo.turns) || []).map((g) => g.apex);
      const mappedT = gTurns.some((q) => near(q, t.pos, 45));
      const ck = courseKnowledge(co); const tuning = ck.stage === "tuning";
      const dr = t.dir === "L" ? "◀ left" : t.dir === "R" ? "right ▶" : "";
      const r = t.radius_m || (c && c.radius_m) || null;
      const curCar = (live.frame && live.frame.on && live.frame.cid) || (co.cars || [])[0];
      const grip = (co.driving && co.driving.car_grip && curCar && co.driving.car_grip[curCar]) || null;
      const predMph = (grip && r) ? Math.round(Math.sqrt(grip * 9.81 * r) * 2.237) : null;
      const ph = c ? (c.dominant_phase || null) : null; const axle = c ? c.dominant : null;   // session corners: phase = dominant_phase, axle = dominant
      const mphOut = c ? (c.mph_out != null ? c.mph_out : (c.last && c.last.mph_out != null ? c.last.mph_out : (c.ref && c.ref.mph_out))) : null;
      const usi = c ? c.usi : null; const bal = usi == null ? "" : usi > 0.15 ? "understeer" : usi < -0.05 ? "oversteer" : "neutral";
      const balCol = usi == null ? "var(--muted)" : usi > 0.15 ? "#2f81f7" : usi < -0.05 ? "#e5414e" : "#00d27a";
      const glyph = ph ? moveCorner([ph], [ph], 132) : "";
      const spd = (v, l) => `<span>${v != null ? v : "—"}<small>${l}</small></span>`;
      const speeds = c ? `<div class="ct-speeds">${c.mph_in != null ? spd(c.mph_in, "in") + `<span class="ct-arr">→</span>` : ""}<span><b style="color:${balCol}">${c.mph_min != null ? c.mph_min : "—"}</b><small>apex</small></span>${mphOut != null ? `<span class="ct-arr">→</span>` + spd(mphOut, "out") : ""}${c.lat_g ? `<span class="ct-g">${c.lat_g} g</span>` : ""}</div>` : `<div class="why" style="font-size:11px">not driven at pace this session — take it once to load the tyres</div>`;
      const env = predMph != null ? `<div class="ct-env">grip-envelope apex ≈ <b>${predMph}</b> mph <span class="why">(r≈${Math.round(r)} m × this car's grip)</span>${c ? ` · you carried <b style="color:${c.mph_min >= predMph - 2 ? "#00d27a" : "#e3b341"}">${c.mph_min}</b>${c.mph_min >= predMph - 2 ? " — at the limit" : " · " + Math.max(0, predMph - c.mph_min) + " to find"}` : ""}</div>` : "";
      let stage;
      const bcOK = src !== "live" || !curCar || isBuildConfirmed(curCar);   // J12: no concrete slider move while the build-confirm gate says tuning advice is locked
      if (tuning && c && axle && c.limiter === "tune" && !bcOK) {
        stage = `<div class="ct-stage tune"><b>🏋 Tuning</b> — ${ph ? `grip broke at <b style="color:${CM_PC[ph - 1]}">${CM_SHORT[ph - 1]}</b>, ` : ""}<b>${bal || axle + "-limited"}</b> — setup-limited. <span class="why">the slider move arrives once the build is confirmed (see the tuning panel)</span></div>`;
      } else if (tuning && c && axle && c.limiter === "tune") { const move = c.note || (axle === "front" ? "soften the FRONT (ARB → spring)" : "soften the REAR (ARB / accel diff)");
        stage = `<div class="ct-stage tune"><b>🏋 Tuning</b> — ${ph ? `grip broke at <b style="color:${CM_PC[ph - 1]}">${CM_SHORT[ph - 1]}</b>, ` : ""}<b>${bal || axle + "-limited"}</b> → ${esc(resolveTurnIds(move))}${c.delta != null ? ` <span class="why">(you're ${c.delta > 0 ? "+" : ""}${c.delta} mph vs your reference here)</span>` : ""}</div>`;
      } else if (tuning && c && c.limiter === "driver") { stage = `<div class="ct-stage"><b>🏋 Tuning</b> — the car's fine here; this turn is a <b>driver</b> line/braking gain, not a tune change.</div>`;
      } else if (tuning) { stage = `<div class="ct-stage"><b>🏋 Tuning</b> — clean through here; no change needed for this turn.</div>`;
      } else { const passes = t.passes ?? (t.track && t.track.passes) ?? (c && c.laps_seen) ?? 0;
        stage = `<div class="ct-stage learn"><b>📚 Learning</b> — ${mappedT ? "mapped from coordinates" : "counted from your laps (fast/flat)"}${c ? " · loaded this session" : " · not yet loaded — take it at pace"} · ${passes} pass${passes === 1 ? "" : "es"} on record. <span class="why">at 75% course confidence this flips to tuning feedback</span></div>`; }
      return `<div class="ct-break"><div class="ct-break-hd"><b>Turn ${n}${dr ? " · " + dr : ""}</b>${r ? `<span class="chip">r≈${Math.round(r)} m</span>` : ""}${bal ? `<span class="chip" style="border-color:${balCol};color:${balCol}">${bal}</span>` : ""}<span class="ct-close" data-courseturn-close="1" title="close">✕</span></div><div class="ct-break-body">${glyph ? `<div class="ct-glyph">${glyph}<div class="ct-glyph-cap">grip: <b style="color:${ph ? CM_PC[ph - 1] : "var(--muted)"}">${ph ? CM_SHORT[ph - 1] : "—"}</b></div></div>` : ""}<div class="ct-break-main">${speeds}${env}${turnTraceStrip(co, t.pos, curCar)}${stage}</div></div></div>`;
    };
    // ---- FULL 5-PHASE per-turn analysis: EVERY identified turn, all phases coloured by what the grip did there, with a
    // tune-vs-driver verdict and a recurring-problem flag. The analyzer measures 4 grip phases (brake · turn-in · mid ·
    // exit); phase 5 (straight/crest) reads exit-traction. Status: front=understeer · rear=oversteer · both · clean. ----
    const PH_COL = { clean: "#00d27a", front: "#2f81f7", rear: "#e5414e", both: "#d95926", traction: "#e3b341", unseen: "var(--line)" };
    const PH_LBL = { clean: "grip OK", front: "understeer", rear: "oversteer", both: "front + rear slip", traction: "traction-limited", unseen: "not driven" };
    const turnPhaseRibbon = (prof, firstPh, w) => {
      prof = prof || [];
      const stOf = (i) => { const p = prof.find((x) => x.phase === i); return p && p.n ? p.status : "unseen"; };
      const p4 = prof.find((x) => x.phase === 4);
      const ph5 = (p4 && (p4.status === "rear" || p4.status === "both")) ? "traction" : (p4 && p4.n ? "clean" : "unseen");
      const stat = [stOf(1), stOf(2), stOf(3), stOf(4), ph5];
      const segs = CM_SEGS.map((d, i) => {
        const s = stat[i]; const col = PH_COL[s] || "var(--line)"; const first = firstPh && (i + 1) === firstPh;
        const halo = first ? `<path d="${d}" fill="none" stroke="var(--txt)" stroke-width="27" stroke-linecap="round" opacity=".26"/>` : "";
        const stroke = s === "unseen"
          ? `<path d="${d}" fill="none" stroke="var(--line)" stroke-width="9" stroke-dasharray="1 11" stroke-linecap="round" opacity=".6"/>`
          : `<path d="${d}" fill="none" stroke="${col}" stroke-width="18" stroke-linecap="round"/>`;
        return halo + stroke;
      }).join("");
      const title = [1, 2, 3, 4, 5].map((p) => `${p} ${CM_SHORT[p - 1]}: ${PH_LBL[stat[p - 1]]}`).join(" · ");
      return `<svg viewBox="0 0 620 320" width="${w || 160}" height="${Math.round((w || 160) * 0.52)}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><path d="${CM_RIBBON}" fill="none" stroke="var(--bg3)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>${segs}</svg>`;
    };
    const turnVerdict = (c, unlocked) => {
      if (!c) return `<div class="tv unseen"><b>— not driven</b> — take this turn at pace once to read its phases</div>`;
      const note = c.note ? esc(resolveTurnIds(c.note)) : ""; const lim = c.limiter;
      if (lim === "tune" && unlocked === false) return `<div class="tv tune"><b>🔧 setup-limited</b> — the car, not your line, gives up here.${note ? " " + note : ""} <span class="why">the fix arrives with tuning feedback once it unlocks</span></div>`;   // J12: diagnosis without a prescription while tuning advice is locked
      if (lim === "tune") return `<div class="tv tune"><b>🔧 TUNE fix</b> — a setup change helps here.${note ? " " + note : ""}</div>`;
      if (lim === "driver") return `<div class="tv driver"><b>🧑 DRIVER fix</b> — too fast for the turn regardless of setup.${note ? " " + note : " brake earlier / slower entry."}</div>`;
      if (lim === "mixed") return `<div class="tv mixed"><b>◐ MIXED</b> — ${note || "inconsistent — drive it clean a few more times to separate technique from setup"}</div>`;
      return `<div class="tv clean"><b>✓ CLEAN</b> — no grip loss through here.</div>`;
    };
    const recurringFlag = (t, c) => {
      const trk = (c && c.track) || (t && t.track) || null; if (!trk) return "";
      const lim = trk.lim || {}; const bad = (lim.tune || 0) + (lim.driver || 0) + (lim.mixed || 0);
      if (bad >= 2 && (lim.tune || lim.driver)) {
        const kind = (lim.tune || 0) >= (lim.driver || 0) ? "tune" : "driver";
        return `<span class="chip trec" title="limited on ${bad} of ${trk.sessions || 0} sessions here">⚠ RECURRING · ${kind}-limited · ${trk.passes || 0} passes</span>`;
      }
      return "";
    };
    const turnCorner = (co, n) => { const t = turnTable(co).turns[n - 1]; if (!t) return [null, null];
      const near = (a, b, d) => a && b && ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) <= d * d;
      const cs = (co.corners || []).filter((k) => k.pos && !k.drift && near(k.pos, t.pos, 45)); return [t, cs.length ? cs[cs.length - 1] : null]; };
    const fullTurnCard = (co, n, unlocked) => {
      const [t, c] = turnCorner(co, n); if (!t) return "";
      const dr = t.dir === "L" ? "◀ L" : t.dir === "R" ? "R ▶" : "";
      const r = t.radius_m || (c && c.radius_m) || null; const type = c ? c.type : null;
      const curCar = (live.frame && live.frame.on && live.frame.cid) || (co.cars || [])[0];
      const grip = (co.driving && co.driving.car_grip && curCar && co.driving.car_grip[curCar]) || null;
      const predMph = (grip && r) ? Math.round(Math.sqrt(grip * 9.81 * r) * 2.237) : null;
      const prof = c ? c.phase_profile : null; const firstPh = c ? c.dominant_phase : null;
      const mphOut = c ? (c.mph_out ?? (c.last && c.last.mph_out) ?? (c.ref && c.ref.mph_out)) : null;
      const phChips = c && prof ? `<div class="tp-legend">${[1, 2, 3, 4].map((i) => { const p = prof.find((x) => x.phase === i); const s = p && p.n ? p.status : "unseen"; const first = firstPh === i;
        return `<span class="tp-lg${first ? " first" : ""}"><i style="background:${PH_COL[s]}"></i>${CM_SHORT[i - 1]}: <b style="color:${PH_COL[s]}">${PH_LBL[s]}</b>${first ? " · ⚑ starts here" : ""}</span>`; }).join("")}</div>` : "";
      const speeds = c ? `<div class="ct-speeds">${c.mph_in != null ? `<span>${c.mph_in}<small>in</small></span><span class="ct-arr">→</span>` : ""}<span><b>${c.mph_min != null ? c.mph_min : "—"}</b><small>apex</small></span>${mphOut != null ? `<span class="ct-arr">→</span><span>${mphOut}<small>out</small></span>` : ""}${c.lat_g ? `<span class="ct-g">${c.lat_g} g</span>` : ""}${predMph != null ? `<span class="ct-env2" title="grip-envelope apex = radius × this car's measured grip">envelope ≈ ${predMph}${c.mph_min != null ? (c.mph_min >= predMph - 2 ? " · at the limit" : " · " + Math.max(0, predMph - c.mph_min) + " to find") : ""}</span>` : ""}</div>` : "";
      return `<div class="ft-card"><div class="ft-hd"><b>Turn ${n}${dr ? " · " + dr : ""}</b>${r ? `<span class="chip">r≈${Math.round(r)} m</span>` : ""}${type ? `<span class="chip">${type}</span>` : ""}${recurringFlag(t, c)}</div>
        <div class="ft-body"><div class="ft-glyph">${turnPhaseRibbon(prof, firstPh, 172)}</div><div class="ft-main">${phChips}${speeds}${turnVerdict(c, unlocked)}</div></div></div>`;
    };
    const turnByTurnSection = (co, unlocked) => {
      const _T = turnTable(co); const canon = _T.turns;
      if (!canon.length) return `<div class="lab-corner" style="border-left:4px solid var(--accent2);margin-bottom:8px;font-size:11.5px"><b>🔬 Turn-by-turn</b> <span class="why">— no turns learned yet. Complete one full lap: the course's turns are read from it, and they become permanent once they show up on most laps across two sessions.</span></div>`;
      let nTune = 0, nDriver = 0, nRec = 0;
      canon.forEach((t, i) => { const c = turnCorner(co, i + 1)[1]; if (c && c.limiter === "tune") nTune++; if (c && c.limiter === "driver") nDriver++; if (recurringFlag(t, c)) nRec++; });
      const cards = canon.map((t, i) => fullTurnCard(co, i + 1, unlocked)).join("");
      return `<div class="lab-corner" style="border-left:4px solid var(--accent2);margin-bottom:8px"><div class="card-row" style="margin-top:0"><strong>🔬 Turn-by-turn — all ${canon.length} turns · every phase</strong><span style="display:inline-flex;gap:4px">${nTune ? `<span class="chip" style="border-color:#00d27a;color:#00d27a">🔧 ${nTune} ${unlocked === false ? "setup-limited" : "tune"}</span>` : ""}${nDriver ? `<span class="chip" style="border-color:#e3b341;color:#e3b341">🧑 ${nDriver} driver</span>` : ""}${nRec ? `<span class="chip trec">⚠ ${nRec} recurring</span>` : ""}</span></div>
        <div class="why" style="font-size:10.5px;margin:2px 0 6px">each turn's 5 phases coloured by grip · <span style="color:#2f81f7">■</span> understeer · <span style="color:#e5414e">■</span> oversteer · <span style="color:#d95926">■</span> both · <span style="color:#00d27a">■</span> ok · ⚑ where the trouble starts · 🔧 setup helps / 🧑 it's speed, not setup</div>
        <div class="ft-grid">${cards}</div></div>`;
    };
    const mapCardHtml = (geo, corners, turns, co) => { if (!geo) return ""; const canonN = turns && turns.canonical ? turns.canonical.length : (geo.turns || []).length; const shown = (turns && turns.count) || canonN; const mapped = (geo.turns || []).length;
      const rk = co && co.route_key; const selN = (rk && live.selTurn && live.selTurn.rk === rk) ? live.selTurn.n : null; const brk = (co && selN) ? courseTurnBreakdown(co, selN) : "";
      return `<div style="margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2)">
          <div class="card-row" style="margin-top:0"><strong style="font-size:12px">🗺 Course map — ${shown} turn${shown === 1 ? "" : "s"}${mapped !== shown ? ` (${mapped} curvature-mapped)` : ""} · ${geo.length_m} m</strong><span class="chip">${geo.from_model ? "best map on record" : "ref lap " + ((geo.ref_lap || {}).lap || "—")}${geo.last_lap ? ` · latest lap ${geo.last_lap.lap} overlaid` : ""}</span></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">${courseMap(geo, corners, turns, { rk, selN, live: src === "live", co })}<div style="font-size:10.5px;min-width:150px;max-width:320px">${rk ? `<div style="font-weight:600;color:var(--accent2);margin-bottom:3px">▶ click a turn for its breakdown</div>` : ""}<div><span style="color:var(--accent2)">━</span> course path · <span style="color:var(--warn,#e3b341)">╌</span> latest lap · <span style="color:var(--muted)">─</span> every recorded lap${(geo.layout_paths || []).length ? ` (${geo.layout_paths.length})` : ""}</div><div style="margin-top:3px">turns: <span style="color:#00d27a">●</span> clean this session · <span style="color:var(--accent)">○</span> on the map, not loaded</div><div style="margin-top:3px">a turn wears the state it took: ${gripLegend(["front", "rear", "both"])}</div>${(geo.not_driven || []).length ? `<p class="why" style="font-size:10px;margin:5px 0 0">${geo.not_driven.map(turnLabel).join(", ")}: mapped turns not loaded this session — take them at pace to register them</p>` : ""}</div></div>
          ${brk}
        </div>`; };
    // a course card built purely from a TRACK RECORD (course model) — for a route selected in the atlas that this session / recording never visited
    const modelCourseCard = (m) => {
      const names = ((DB.routes || {}).routes) || {}; const loc = JSON.parse(localStorage.getItem("fh6Routes") || "{}"); const rn = m.name || (names[m.route_key] || {}).name || (loc[m.route_key] || {}).name || `route @ ${m.route_key.replace("_", ", ")}`;
      const bl = m.best_laps || {}; const bestList = Object.entries(bl).map(([cid, v]) => Object.assign({ cid }, v)).sort((a, b) => a.best_lap - b.best_lap); const visits = m.visits || [];
      const tr = { name: rn, laps: m.laps || 0, sessions: (m.sessions || []).length, attempts: visits.reduce((a, v) => a + (v.attempts || 0), 0), cars: Object.entries(m.cars || {}).map(([cid, v]) => Object.assign({ cid }, v)), best_laps: bestList, best: bestList[0] || null, visits: visits.slice(-8), this_session_best: null, delta_to_track_best: null };
      const g = m.geometry || {}; const geo = g.path || g.paths ? { paths: g.paths || [g.path], path: g.path || (g.paths || []).flat(), layout_paths: (g.lap_paths || []).map((lp) => ({ session: lp.session, pts: lp.pts })), turns: g.turns || [], length_m: g.length_m, ref_lap: { lap: "—" }, driven: null, not_driven: [] } : null;
      let estTurns = (m.turns || []).filter((t) => t.established);
      if (m.expected_turns && estTurns.length > m.expected_turns) estTurns = estTurns.slice().sort((a, b) => ((b.track || {}).presence || 0) - ((a.track || {}).presence || 0)).slice(0, m.expected_turns);
      estTurns = estTurns.map((t) => ({ id: t.id, pos: t.pos, dir: t.dir, radius_m: t.radius_m }));
      const mTurns = { count: m.expected_turns || m.turn_count || estTurns.length, canonical: estTurns };
      return `<div class="lab-corner" style="border-left:4px solid var(--accent)">
        ${courseIdentity(rn, geo, { icon: "🏟", routeKey: m.route_key, tags: courseTagsRow(m), right: `<span class="chip" style="border-color:var(--accent);color:var(--accent)">from the track record — not visited in this ${src === "live" ? "session" : "recording"}</span>` })}
        ${trackRecordHtml(tr, rn, geo, m.route_key)}${m.speed_traces ? speedTracesCard({ speed_traces: m.speed_traces, geometry: m.geometry, route_key: m.route_key }, live.courseCar || null) : ""}${m.profile ? profileCardHtml(m.profile) : ""}${geo ? mapCardHtml(geo, [], mTurns) : ""}
        ${(g.turns || []).length ? `<div style="margin-top:8px;font-size:11px"><div style="color:var(--muted);margin-bottom:4px">Turns on this route (from its map)</div><div style="display:flex;flex-wrap:wrap;gap:3px">${g.turns.map((t) => `<span class="chip" title="${t.len_m} m long · ${t.deg != null ? t.deg + "°" : ""}">${t.id} ${t.dir === "L" ? "⬅" : "➡"} r${t.radius_m}${t.deg != null ? " · " + t.deg + "°" : ""}</span>`).join("")}</div><p class="why" style="font-size:10.5px;margin:4px 0 0">drive it in this session for per-turn references, limiter and advice</p></div>` : ""}
      </div>`;
    };
    // course mode card: scoped coverage (present probes only), per-run lap times, scoped suggestions per car
    // course card PARTS — reused by the session card, the live Course dashboard (learning vs feedback) and the track index
    const courseParts = (co, s) => {
      const rn = co.name || ((((DB.routes || {}).routes) || {})[co.route_key] || {}).name || (JSON.parse(localStorage.getItem("fh6Routes") || "{}")[co.route_key] || {}).name || `route @ ${co.route_key.replace("_", ", ")}`;
      const cov = co.coverage; const present = cov.probes.filter((p) => p.present), absent = cov.probes.filter((p) => !p.present);
      const carsS = s || { cars: [], stints: [] };
      const prof = co.profile;
      const BB = { heavy: "#e5414e", moderate: "#e3b341", light: "#2f81f7", absent: "#3a4250" };
      const DLBL = { low_corner: "low-speed corners", mid_corner: "medium corners", fast_corner: "fast sweepers", braking: "heavy braking", straight: "straights / top-end", elevation: "elevation" };
      const profileCard = profileCardHtml(prof);
      const nl = co.laps ? co.laps.total : co.runs; const tu = co.turns; const TC = tu ? (tu.confidence >= 0.8 ? "#00d27a" : tu.confidence >= 0.5 ? "#e3b341" : "#e5414e") : "var(--muted)";
      const turnsCard = tu ? `<div style="margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2)">
          <div class="card-row" style="margin-top:0"><strong style="font-size:12px">🔁 Turns — established across every session</strong><span class="chip" style="border-color:${tu.expected != null ? (tu.expected === tu.count ? "#00d27a" : "var(--warn,#e3b341)") : TC};color:${tu.expected != null ? (tu.expected === tu.count ? "#00d27a" : "var(--warn,#e3b341)") : TC};font-weight:700">${tu.count} turn${tu.count === 1 ? "" : "s"}${tu.expected != null ? (tu.expected === (tu.established ?? tu.count) ? " ✓ your count" : " · you count " + tu.expected) : ""}</span></div>
          <div class="why" style="font-size:10.5px;margin-top:2px">${tu.expected != null ? `<b>${tu.expected}</b> declared` : `<b>${tu.established ?? tu.count}</b> established`}${tu.established != null && tu.expected != null && tu.established !== tu.expected ? ` · ${tu.established} established across the track` : ""}${tu.mapped != null ? ` · ${tu.mapped} mapped from coordinates` : ""}${tu.detected_here != null ? ` · ${tu.detected_here} detected this session` : ""}${tu.near ? ` · ${tu.near} nearly established` : ""}</div>
          <div class="card-row" style="margin-top:2px"><span class="why" style="font-size:10.5px">your count for this course:</span> <span style="display:inline-flex;gap:3px">${[6, 7, 8, 9, 10, 11, 12].map((n) => `<span class="chip" data-expected="${co.route_key}|${n}" style="cursor:pointer;padding:1px 6px;${tu.expected === n ? "border-color:var(--accent);color:var(--accent)" : ""}">${n}</span>`).join("")}${tu.expected != null ? `<span class="chip" data-expected="${co.route_key}|0" style="cursor:pointer;padding:1px 6px">clear</span>` : ""}</span></div>
          <div class="lab-bar" style="height:6px;margin:5px 0"><i style="width:${tu.confidence * 100}%;background:${TC}"></i></div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;font-size:11px"><span class="why">detections per lap:</span>${(tu.per_lap_detections || []).map((n, i) => `<span class="chip" title="lap ${i + 1}: ${n} corner detections" style="${n === tu.count ? "border-color:#00d27a;color:#00d27a" : "border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)"}">L${i + 1} · ${n}</span>`).join(`<span class="why">→</span>`)}${(tu.per_lap_detections || []).length ? `<span class="why">→ converges on <b>${tu.count}</b></span>` : ""}</div>
          ${tu.track_laps != null && tu.track_laps > tu.laps ? `<div style="margin-top:5px;font-size:11px"><span class="chip" style="border-color:${(tu.track_confidence || 0) >= 0.8 ? "#00d27a" : "#e3b341"};color:${(tu.track_confidence || 0) >= 0.8 ? "#00d27a" : "#e3b341"}">track: ${tu.track_laps} laps over ${tu.track_sessions} session${tu.track_sessions === 1 ? "" : "s"} · turn count ${Math.round((tu.track_confidence || 0) * 100)}%</span> <span class="why">this session adds ${tu.laps} lap${tu.laps === 1 ? "" : "s"}; the turn column on the right counts every pass ever recorded here</span></div>` : ""}
          <p class="why" style="font-size:10.5px;margin:5px 0 0">${esc(resolveTurnIds(tu.note || ""))} · a turn taken badly often shows up as 2–3 detections; it becomes ONE turn as laps accumulate</p>
        </div>` : "";
      const tr = co.track; const trackCard = trackRecordHtml(tr, rn, courseGeoFor(co), co.route_key);
      const confChip = `<span class="chip" style="border-color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"};color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}">course confidence ${Math.round(cov.overall * 100)}% · ${nl} lap${nl === 1 ? "" : "s"}${co.best_lap ? " · best " + co.best_lap.toFixed(3) + " s" : ""}</span>`;
      const header = courseIdentity(rn, courseGeoFor(co), { icon: co.is_loop ? "📍" : "🏟", topology: co.is_loop ? "loop" : (co.topology || null), routeKey: co.route_key, tags: courseTagsRow(co), right: confChip });
      const probes = `<div class="lab-bar" style="height:8px;margin:6px 0 8px"><i style="width:${cov.overall * 100}%;background:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}"></i></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px">${present.map((p) => `<div title="${esc(p.hint)}"><div style="display:flex;justify-content:space-between"><span>${p.ready ? "✓ " : ""}${p.label}</span><b style="color:${p.ready ? "#00d27a" : "var(--muted)"}">${p.count}/${p.required} <span style="font-weight:400;color:var(--muted)">· ${Math.round(p.confidence * 100)}%</span></b></div><div class="lab-bar"><i style="width:${p.confidence * 100}%;background:${p.ready ? "#00d27a" : "#2f81f7"}"></i></div>${p.confidence < 0.97 ? `<span class="why" style="font-size:10px">${p.hint}</span>` : ""}</div>`).join("")}</div>
${absent.length ? `<p class="why" style="font-size:10.5px;margin:6px 0 0">not on this course: ${absent.map((p) => p.label).join(" · ")} — excluded from the goal</p>` : ""}`;
      const laps = `<div style="overflow-x:auto;margin-top:8px"><table style="font-size:11px"><thead><tr><th>run</th><th>car</th><th>label</th><th>lap</th><th>Δ best</th><th>mode</th></tr></thead><tbody>
${co.events.slice().reverse().map((e) => `<tr><td>${e.stint ?? "—"}</td><td>${carLbl(carsS, e.car).split(" · ")[0]}</td><td>${e.label ? `<b>${esc(e.label)}</b>` : `<span class="why">—</span>`}</td><td>${e.best_lap ? e.best_lap.toFixed(3) + " s" : `${e.duration_s}s · ${(e.distance_m / 1000).toFixed(2)} km`}</td><td>${e.delta_s == null ? "—" : e.delta_s === 0 ? `<b style="color:#00d27a">best</b>` : `<span style="color:${e.delta_s > 0 ? "#e5414e" : "#00d27a"}">${e.delta_s > 0 ? "+" : ""}${e.delta_s.toFixed(3)}</span>`}</td><td>${e.mode.replace("timed solo (Rivals / time trial)", "solo")}</td></tr>`).join("")}
</tbody></table></div>`;
      const corners = `${(co.corners || []).length ? `<div style="margin-top:10px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">Turns on this route — the same physical corner across laps and runs (${tu ? `${tu.count} turn${tu.count === 1 ? "" : "s"}${tu.possible ? " + " + tu.possible + " possible" : ""}` : co.corners.length + " identified"})</div>
<div style="overflow-x:auto"><table style="font-size:11px"><thead><tr><th>#</th><th>type</th><th>min mph</th><th>g</th><th>first red</th><th>limiter</th><th>consistency</th><th title="one square per lap: green = detected once · yellow = split into several detections (messy) · hollow = missed">laps (this session)</th><th>samples</th><th title="this turn across EVERY session on this track: passes · presence over all track laps · sessions">track (all sessions)</th></tr></thead><tbody>
${co.corners.map((k) => { const tn = (() => { try { const mt = matchTurn(k.pos); return mt ? "T" + mt.n : null; } catch (e) { return null; } })(); const dcol = k.dominant === "front" ? "#2f81f7" : k.dominant === "rear" ? "#e5414e" : "var(--muted)"; const phc = k.dominant_phase ? CM_PC[(k.dominant_phase) - 1] : "var(--muted)"; const LIM = { driver: ["🧑 driver", "#e3b341"], tune: ["🔧 tune", "#2f81f7"], mixed: ["◐ mixed", "var(--muted)"], clean: ["✓ clean", "#00d27a"] }; const lm = LIM[k.limiter || "clean"]; const noteTxt = (k.status === "possible" ? `possible turn — seen on ${k.laps_seen} of ${tu ? tu.laps : "?"} lap${tu && tu.laps === 1 ? "" : "s"}; lap it more to confirm or drop it` + (k.note ? " · " + k.note : "") : k.note); const lapsCell = (k.per_lap || []).map((n, i) => `<span title="lap ${i + 1}: ${n ? n + " detection" + (n > 1 ? "s (messy)" : "") : "missed"}" style="display:inline-block;width:9px;height:9px;margin-right:2px;border-radius:2px;border:1px solid ${n ? (n >= 2 ? "#e3b341" : "#00d27a") : "var(--line)"};background:${n >= 2 ? "#e3b341" : n ? "#00d27a" : "transparent"}"></span>`).join(""); return `<tr ${k.status === "possible" ? 'style="opacity:.55"' : ""} title="apex ${k.pos.join(", ")} · per run: ${esc(k.runs.map((r) => `run ${r.stint}: ${r.mph_min} mph, USI ${r.usi}, ${r.first_red}`).join(" | "))}"><td style="white-space:nowrap"><b>${tn || k.id}</b> ${k.dir === "L" ? "⬅" : "➡"}${tn || k.geo_id ? ` <span class="why" title="analyzer ids for this same physical turn">${tn ? k.id + (k.geo_id ? " · " + k.geo_id : "") : k.geo_id}</span>` : ""}</td><td>${k.type}</td><td>${k.mph_min}</td><td>${k.lat_g}</td><td><span style="color:${dcol};font-weight:700">${k.dominant === "none" ? "clean" : k.dominant}</span>${k.dominant_phase && k.dominant !== "none" ? ` <span style="color:${phc}">ph ${k.dominant_phase}</span>` : ""}</td><td><span style="color:${lm[1]};font-weight:700">${lm[0]}</span></td><td><div class="lab-bar" style="width:60px;display:inline-block;vertical-align:middle"><i style="width:${k.consistency * 100}%;background:${k.consistency >= 0.75 ? "#00d27a" : k.consistency >= 0.5 ? "#e3b341" : "#e5414e"}"></i></div> ${Math.round(k.consistency * 100)}%</td><td style="white-space:nowrap">${lapsCell}${k.multi >= 0.34 ? ` <span title="detected more than once on ${Math.round(k.multi * 100)}% of its laps — taken inconsistently" style="color:#e3b341;font-weight:700">×</span>` : ""}</td><td>${k.n} (${k.runs.length}r)</td><td style="white-space:nowrap">${k.track ? `<b>${k.track.passes}</b> passes${k.track.presence != null ? ` · <span title="seen on ${k.track.laps_seen} of ${k.track.laps_track} laps on record" style="color:${k.track.presence >= 0.7 ? "#00d27a" : k.track.presence >= 0.4 ? "#e3b341" : "var(--muted)"}">${Math.round(k.track.presence * 100)}% of ${k.track.laps_track} laps</span>` : ""}${k.track.sessions > 1 ? ` · ${k.track.sessions} sessions` : ""}${k.track.dominant && k.track.dominant !== "none" ? ` · <span style="color:${k.track.dominant === "front" ? "#2f81f7" : "#e5414e"}">${k.track.dominant} ${Math.round((k.track.consistency || 0) * 100)}%</span>` : ""}` : "—"}</td></tr>${noteTxt ? `<tr><td></td><td colspan="9" class="why" style="font-size:10.5px;padding-top:0;color:${k.status === "possible" ? "var(--muted)" : k.limiter === "driver" ? "var(--warn,#e3b341)" : k.limiter === "tune" ? "#2f81f7" : "var(--muted)"}">${k.dir === "L" ? "⬅" : "➡"} ${tn || k.id}: ${esc(resolveTurnIds(noteTxt))}</td></tr>` : ""}`; }).join("")}
</tbody></table></div>
<p class="why" style="font-size:10.5px;margin:4px 0 0"><b>🔧 tune</b> = fails on every clean lap → change a slider · <b>🧑 driver</b> = only when you over-drive it → change your line, not the car · <b>◐ mixed</b> = drive it more to separate them · laps: <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#00d27a;vertical-align:middle"></span> seen once · <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#e3b341;vertical-align:middle"></span> split into several detections · <span style="display:inline-block;width:9px;height:9px;border-radius:2px;border:1px solid var(--line);vertical-align:middle"></span> missed</p></div>` : ""}`;
      const driving = `${(co.corners || []).some((k) => k.advice) ? `<div style="margin-top:10px"><div class="card-row" style="margin-top:0"><div style="font-size:11px;color:var(--muted)">${co.model ? `📚 <b>Course learning</b>: ${co.model.turns} turns · ${co.model.laps} laps · ${co.model.sessions} session${co.model.sessions === 1 ? "" : "s"} — geometry transfers to any car · ` : ""}🏋 <b>Course training</b>: your LATEST pass vs your reference (best clean pass of <i>this car</i>)${co.driving && co.driving.predicted ? ` · ${co.driving.predicted} turn${co.driving.predicted === 1 ? "" : "s"} predicted from geometry × your grip until you drive ${co.driving.predicted === 1 ? "it" : "them"}` : ""}${co.driving && co.driving.car_grip ? ` · grip ${Object.values(co.driving.car_grip).filter(Boolean).map((g) => g + " g").join(" / ")}` : ""}</div>${co.driving ? `<span class="chip" style="border-color:${co.driving.on_reference === co.driving.compared && co.driving.compared ? "#00d27a" : "var(--warn,#e3b341)"};color:${co.driving.on_reference === co.driving.compared && co.driving.compared ? "#00d27a" : "var(--warn,#e3b341)"}">${co.driving.on_reference}/${co.driving.compared} turns on reference</span>` : ""}</div>
<div style="overflow-x:auto"><table style="font-size:11px"><thead><tr><th>#</th><th>reference · in → apex → out mph · brake (m before apex)</th><th>your last pass</th><th>Δ</th><th>advice</th></tr></thead><tbody>
${co.corners.filter((k) => k.ref || k.advice).map((k) => { const tn = (() => { try { const mt = matchTurn(k.pos); return mt ? "T" + mt.n : null; } catch (e) { return null; } })(); const r = k.ref || {}, l = k.last || {}, d = k.delta || {}; const f = (v) => (v == null ? "—" : v); const sd = (v, unit, inv) => (v == null ? "" : `<span style="color:${Math.abs(v) < 3 ? "var(--muted)" : ((inv ? v > 0 : v < 0) ? "#e5414e" : "#00d27a")}">${v > 0 ? "+" : ""}${v}${unit}</span>`); return `<tr ${k.status === "possible" ? 'style="opacity:.55"' : ""}><td style="white-space:nowrap"><b>${tn || k.id}</b> ${k.dir === "L" ? "⬅" : "➡"} <span class="why"${tn ? ` title="analyzer id ${esc(k.id)}"` : ""}>${k.type}${k.radius_m ? " · r≈" + k.radius_m + " m" : ""}</span></td><td>${k.ref ? `${f(r.mph_in)} → <b>${f(r.mph_min)}</b> → ${f(r.mph_out)} · brake ${f(r.brake_on_m)} m${r.first_red ? ` · <span style="color:#e5414e">${r.first_red}</span>` : ""} <span class="why">(${esc(k.ref_src || "")}${r.stint ? ", run " + r.stint : ""})</span>` : "—"}</td><td>${k.last ? `${f(l.mph_in)} → <b>${f(l.mph_min)}</b> → ${f(l.mph_out)} · brake ${f(l.brake_on_m)} m${l.first_red ? ` · <span style="color:#e5414e">${l.first_red}</span>` : ""}${l.stint ? ` <span class="why">(run ${l.stint})</span>` : ""}` : "—"}</td><td style="white-space:nowrap">${k.delta ? `in ${sd(d.mph_in, "", true)} · apex ${sd(d.mph_min, "", false)} · brake ${sd(d.brake_on_m, " m", false)}${d.line_m != null ? ` · line ${d.line_m} m` : ""}` : ""}</td><td style="font-size:11px;color:${k.on_ref ? "#00d27a" : "var(--txt)"}">${k.advice ? esc(k.advice) : ""}</td></tr>`; }).join("")}
</tbody></table></div>
<p class="why" style="font-size:10.5px;margin:4px 0 0">Δ: entry <span style="color:#e5414e">red when faster</span> than the reference (over-driving) · apex <span style="color:#e5414e">red when slower</span> · brake Δ negative = you braked later. The reference is the best CLEAN pass — from this session, or from the course model built on earlier sessions.</p></div>` : ""}`;
      const advice = `${Object.entries(co.advice_by_car || {}).map(([cidk, adv]) => { const firm = adv.filter((a) => !a.open).slice(0, 4), open = adv.filter((a) => a.open); return `<div style="margin-top:8px"><div style="font-size:11px;color:var(--muted)">${carLblHtml(carsS, cidk)}</div>
${firm.map((a) => `<div style="display:flex;gap:8px;align-items:flex-start;margin:5px 0;${a.minor_here ? "opacity:.5" : ""}"><span class="lab-light" style="background:${SEV[a.severity]};margin-top:4px"></span><div style="flex:1"><div style="font-size:12px"><strong>${a.text}</strong>${a.minor_here ? ` <span class="chip" style="border-color:var(--muted);color:var(--muted)">rarely used on this course</span>` : ""}</div><div class="why" style="font-size:10.5px">${a.evidence} · confidence ${Math.round(a.confidence * 100)}%</div></div></div>`).join("") || `<p class="why" style="font-size:11px;margin:4px 0">no firm suggestions on this course yet</p>`}
${open.length ? `<div style="font-size:11px;color:var(--warn,#e3b341);margin-top:4px">🔍 ${open.map((a) => a.text).join(" · ")}</div>` : ""}</div>`; }).join("")}`;
      return { rn, cov, nl, tu, tr, header, track: trackCard, profile: profileCard, map: mapCardHtml(courseGeoFor(co), co.corners, co.turns, co), turns: turnsCard, probes, laps, corners, driving, advice };
    };
    const courseBlock = (co, s) => { const p = courseParts(co, s); return `<div class="lab-corner" style="border-left:4px solid var(--accent2)">${p.header}${p.track}${p.profile}${p.map}${p.turns}${p.probes}${p.laps}${p.corners}${p.driving}${p.advice}</div>`; };
    // ---- LIVE plumbing: mode banner, stream bar, the live workflow body, and section repaint from the daemon's latest full analysis ----
    function paintBanner() {
      const el = host.querySelector("#lvBanner"); if (!el) return;
      const em = effMode(), ms = labModeSel(), lm = live.mode || {};
      const MODE_LBL = { course: ["🏟 COURSE", "var(--accent2)"], decode: ["🧬 DECODE", "#e3b341"], free: ["🛣 FREE TUNING", "var(--accent)"] };
      const an = live.analysis; const donorSt = an && (an.stints || []).find((x) => x.role === "donor"); const pin = PIN(); const ls = liveSess();
      const donorCar = pin ? ((ls && pin.sid === ls.id && car(ls, pin.key)) || (pin.data && car(pin.data, pin.key)) || null) : (donorSt && (an.cars || []).find((c) => c.id === donorSt.id));
      const dchip = donorCar && donorCar.decode ? `<span class="chip" style="border-color:#e3b341;color:#e3b341" title="${pin ? "pinned donor — stays until you pick another or unpin (Decode tab)" : "donor capture progress — tests only"}">${pin ? "📌 " : ""}🎯 donor ${buildThumb(donorCar.ordinal, donorCar.build_id, true)} ${esc(carName(donorCar) || "")} ${donorCar.decode.ready_n}/${donorCar.decode.total} tests${donorCar.decode.pct >= 1 && donorCar.clone_sheet && donorCar.clone_sheet.confidence != null ? " · 📋 sheet " + Math.round(donorCar.clone_sheet.confidence * 100) + "%" : ""}</span>` : "";
      el.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><span class="chip" style="border-color:${MODE_LBL[em][1]};color:${MODE_LBL[em][1]};font-weight:700">${MODE_LBL[em][0]}</span><span class="why" style="font-size:11px">${ms === "auto" ? "🧭 auto-detected" + (lm.reason ? " — " + esc(lm.reason) : " — waiting for the stream") : "manual — click 🧭 auto to hand detection back"}${live.status && live.status.game === "menu" ? ` · in menus — <b style="color:var(--accent)">📌 deliverable held</b> for the upgrade / tune screen` : ""}</span>${dchip}${(() => { const lk = live.status && live.status.clone_lock; if (lk == null || (live.cloneTarget && live.cloneTarget.ordinal === lk)) return ""; const nm2 = (NAMES()[String(lk)] || {}).name || "#" + lk; return `<span class="chip" style="border-color:#e5414e;color:#e5414e" title="a clone lock from a previous session is still active on the daemon — it silently pauses PI stamping and catalog accrual for this car">🎯 orphaned clone lock: ${esc(nm2)} <button class="lab-mode" data-clone-unlock="1" style="padding:1px 7px;font-size:10px;margin-left:4px">unlock</button></span>`; })()}</div>`;
      el.querySelectorAll("[data-clone-unlock]").forEach((b) => b.addEventListener("click", () => { unlockCloneTarget(); if (live.status) live.status.clone_lock = null; paintBanner(); }));
    }
    function streamBar() {
      // the NECESSARY live state (status + workflow/event line + the ↺/⚙ controls) lives in the sticky .lab-top header
      // (anchored to the top of the screen). This block holds only the non-glanceable, scrollable bits.
      return `
        <div class="block" style="border-color:#e5414e;margin-top:0">
          <div id="lvConnRow" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;margin-top:0"><input id="lvUrl" value="${esc(liveUrl)}" style="min-width:240px;padding:5px 8px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:12px"><button class="lab-mode" id="lvConnect" style="font-size:12px">connect</button><span class="why" style="font-size:10.5px">daemon: <code>python scripts/telemetry/fh6_live_daemon.py</code> (<code>--replay captures/&lt;file&gt;.csv</code> to replay)</span></div>
          <div id="lvCloneLauncher"></div>
          <div id="lvLoop" style="margin-top:6px"></div>
          <div id="lvStint" style="margin-top:6px"></div>
          <div id="lvSession"></div><div id="lvUnknown"></div>
        </div>`;
    }
    // the session object the live workflows render from: the daemon's latest full analysis (refetched after every analysis), else a thin stand-in built from the SSE analysis payload
    const analysisAsSession = (an) => ({ id: an.id, partial: true, cars: live.cars.length ? live.cars.map((x) => Object.assign({}, x, (an.cars || []).find((y) => y.id === x.id) || {})) : (an.cars || []), stints: an.stints || [], courses: an.courses || [], events: [], launches: [], braking: [], corners: [], pulses: [], strip: [], summary: an.summary || {} });
    // the loaded full session is only trusted when it IS the session the daemon is currently analysing (reconnects / restarts / replays change the id)
    const liveSess = () => { const an = live.analysis; if (!an) return null; const full = live.loaded && live.loaded === an.id && sessions.find((x) => x.id === live.loaded); if (full) cacheCourseGeo(full); return full || analysisAsSession(an); };
    // COURSE GEOMETRY CACHE — the live SSE payload STRIPS geometry to stay light, so between the ~20 s re-analyses the
    // course map/shape would collapse to nothing then flicker back. Cache the last-known geometry per route_key from any
    // full session and fall back to it, so the visual course route (a course's PRIMARY identity) PERSISTS across analyses.
    live.courseGeo = live.courseGeo || {};
    const _hasGeo = (g) => !!(g && ((g.path && g.path.length > 4) || (g.paths && [].concat(...(g.paths || [])).length > 4)));
    const cacheCourseGeo = (sess) => { if (sess && sess.courses) sess.courses.forEach((co) => { if (co && co.route_key && _hasGeo(co.geometry)) live.courseGeo[co.route_key] = co.geometry; }); };
    const courseGeoFor = (co) => co ? (_hasGeo(co.geometry) ? co.geometry : (live.courseGeo[co.route_key] || co.geometry || null)) : null;
    const sectionsHtml = (s, isLive) => { const w = effMode(); return w === "course" ? courseSection(s, isLive) : w === "decode" ? decodeSection(s, isLive) : freeSection(s, isLive); };
    function liveBody() {
      const w = effMode();
      return `<div id="lvActiveCar" style="margin-bottom:8px"></div>
        <div id="lvBanner"></div>
        <div id="lvTraction"></div>
        ${w !== "decode" ? `<div class="block lvSpeedTrace" style="border-color:var(--accent);padding:8px 11px 6px"></div>` : ""}
        ${w === "course" ? "" : `<div class="lab-tiles" id="lvTiles"></div>`}
        <div id="lvSections">${sectionsHtml(liveSess(), true)}</div>
        ${w === "free" ? `<details class="block"><summary style="cursor:pointer;font-weight:600;font-size:14px">🩺 Live feel — friction rings &amp; pedal inputs</summary>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(140px,180px));gap:6px;justify-content:center;margin-top:8px" id="lvCircles">${circleSvg("FL")}${circleSvg("FR")}${circleSvg("RL")}${circleSvg("RR")}</div>
          <div id="lvInputs" style="max-width:520px;margin:10px auto 0"></div></details>
        <details class="block" style="border-color:#e5414e"><summary style="cursor:pointer;font-weight:600;font-size:14px">🩺 Corner log — every turn, newest first</summary><div class="card-grid" id="lvCorners" style="margin-top:8px"></div></details>`
        : w === "course" ? `<div class="block" style="border-color:#e5414e"><h3 style="margin-top:0">🩺 Corner log — newest first</h3><div class="card-grid" id="lvCorners"></div></div>` : ""}`;
    }
    function paintSections(force) {
      const el = host.querySelector("#lvSections"); if (!el) return;
      const a = document.activeElement; if (!force && a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   // never wipe something being typed — the next analysis repaints (reset / explicit picks force)
      el.innerHTML = sectionsHtml(liveSess(), true); bindBody(el);
    }
    function loadFullSession() {
      fetch(liveUrl + "/session.json").then((r) => r.json()).then((js) => { if (js && js.id && live.analysis && js.id === live.analysis.id) { const i = sessions.findIndex((x) => x.id === js.id); if (i >= 0) sessions[i] = js; else sessions.push(js); live.loaded = js.id; cacheCourseGeo(js);
        const cid = (live.frame && live.frame.cid) || live.courseCar; const c = cid && (js.cars || []).find((x) => x.id === cid); if (c) refreshDiskThenCapture(cid, c, js);   // A/B: re-read the on-disk sliders THEN snapshot/diff each analysis, so a change is never missed by a stale cache
      } }).catch(() => {}).then(() => { paintSections(); paintStatus(); paintBanner(); });   // a response that lands after a reset (analysis null / new id) is ignored
    }
    // SYSTEM STATUS — one at-a-glance health readout of every subsystem, anchored in the top bar.
    function checkDecodeHealth() {   // self-throttled to ~15 s; pings /disk-tunes to confirm the save is readable
      if (!live.connected || Date.now() - (live._dhAt || 0) < 15000) return;
      live._dhAt = Date.now();
      fetch(liveUrl + "/disk-tunes").then((r) => r.json()).then((d) => { live.decodeHealth = { ok: !!(d && d.available), n: (d && d.count) || 0, ts: Date.now() }; paintSystemStatus(); }).catch(() => { live.decodeHealth = { ok: false, n: 0, ts: Date.now() }; paintSystemStatus(); });
    }
    function paintSystemStatus() {
      const el = host.querySelector("#lvSysStatus"); if (!el) return;
      const st = live.status || {}; const dh = live.decodeHealth;
      const age = live.analysisAt ? Math.round((Date.now() - live.analysisAt) / 1000) : null;
      const nS = (DB.sessions || []).length, nR = Object.keys(((DB.routes || {}).routes) || {}).length, nC = Object.keys(((DB.carOrdinals || {}).cars) || {}).length;
      const checks = [
        live.connected ? { k: "Daemon", lvl: "ok", d: `connected @ ${liveUrl} · ${st.pps || 0} pkt/s` } : { k: "Daemon", lvl: "off", d: live.err ? "not reachable — start it, then connect" : "connecting…" },
        !live.connected ? { k: "Telemetry", lvl: "off", d: "daemon down" } : st.receiving ? { k: "Telemetry", lvl: "ok", d: `${st.pps} pkt/s · ${st.frames} frames` } : { k: "Telemetry", lvl: "warn", d: "connected — no packets (drive, or replay a CSV)" },
        !live.connected ? { k: "Game", lvl: "off", d: "—" } : st.game ? { k: "Game", lvl: "ok", d: `FH6 · ${st.game}` } : { k: "Game", lvl: "warn", d: "not detected — is FH6 running with Data Out on?" },
        !live.connected ? { k: "Decode", lvl: "off", d: "daemon down" } : dh ? (dh.ok ? { k: "Decode", lvl: "ok", d: `${dh.n} tunes readable on disk` } : { k: "Decode", lvl: "warn", d: "save folder not reachable" }) : { k: "Decode", lvl: "warn", d: "checking…" },
        age == null ? { k: "Analysis", lvl: "warn", d: "none yet — drive to trigger" } : age < 60 ? { k: "Analysis", lvl: "ok", d: `updated ${age}s ago` } : { k: "Analysis", lvl: "warn", d: `stale · ${age}s ago` },
        (st.frames || live.session) ? { k: "Session", lvl: "ok", d: `${st.frames || 0} frames${st.csv ? " · " + st.csv : ""}` } : { k: "Session", lvl: "warn", d: "idle — no recording yet" },
        { k: "Data", lvl: "ok", d: `${nS} sessions · ${nR} routes · ${nC} cars` },
      ];
      const overall = checks.some((c) => c.lvl === "off") ? "off" : checks.some((c) => c.lvl === "warn") ? "warn" : "ok";
      const key = overall + "|" + checks.map((c) => c.lvl + c.d).join("|");
      if (el.dataset.k === key) return; el.dataset.k = key;
      const OL = { ok: "all systems go", warn: "up · some subsystems idle", off: "daemon offline" };
      el.innerHTML = `<span class="sys-lead ${overall}" title="overall system health"><span class="sys-dot"></span>${OL[overall]}</span>${checks.map((c) => `<span class="sys-pill ${c.lvl}" title="${esc(c.d)}"><span class="sys-dot"></span>${c.k}</span>`).join("")}`;
    }
    function paintStatus() {
      const el = host.querySelector("#lvStatus"); if (!el) return;
      paintSystemStatus(); checkDecodeHealth();
      const st = live.status;
      const outdated = !!(st && (st.stint === undefined || st.mode === undefined));
      el.textContent = !live.connected ? (live.err ? "daemon not reachable — start it, then connect" : "connecting…") : outdated ? `⚠ daemon is an older build — stop and start it to get live suggestions, runs and reset (still receiving ${st.pps} pkt/s)` : st && st.receiving ? `● receiving ${st.pps} pkt/s · ${st.frames} frames${st.csv ? " · " + st.csv : ""}` : "connected — waiting for packets (drive, or start a replay)";
      el.style.borderColor = el.style.color = !live.connected ? "#e5414e" : outdated ? "var(--warn,#e3b341)" : st && st.receiving ? "#00d27a" : "var(--warn,#e3b341)";
      const se = host.querySelector("#lvSession");
      if (se) se.innerHTML = live.session ? `<p class="why" style="font-size:12px;margin:8px 0 0">📦 Session analyzed: <strong>${live.session.id}</strong> — ${live.session.summary ? `${live.session.summary.corners} corners · ${live.session.summary.launches} launches · ${live.session.summary.braking} brake events` : ""} ${live.loaded === live.session.id ? `<button class="lab-mode" id="lvOpen">open as recording</button>` : "(loading…)"}</p>` : "";
      const ob = host.querySelector("#lvOpen"); if (ob) ob.addEventListener("click", () => { sIdx = sessions.findIndex((x) => x.id === live.loaded); src = "session"; localStorage.setItem("fh6LabSrc", src); carSel = null; render(); });
      const un = host.querySelector("#lvUnknown"); if (un) { const seen = new Set(); un.innerHTML = live.cars.filter((c) => !carName(c) && !seen.has(c.ordinal) && seen.add(c.ordinal)).map(nameUI).join(""); bindNames(un); }
      const lv = host.querySelector("#lvLoop");
      if (lv && live.connected) {
        const lo = live.loop; const onCourse = effMode() === "course"; const lk = `${onCourse}|${lo ? lo.name + "|" + lo.lap + "|" + lo.last_s : "none"}`;   // reference-loop controls belong to the Course workflow only
        if (lv.dataset.k !== lk) {
          lv.dataset.k = lk; const typedLoop = (lv.querySelector("#lvLoopName") || {}).value || "";
          const spec = `<details class="tz-why" style="margin-top:4px"><summary>the decode loop — what to include</summary><p style="font-size:11px">One repeatable circuit that hits every decode test: <b>standing start → long straight</b> (gearing · dyno · top-speed) → <b>threshold brake</b> from 80+ → <b>hairpin</b> → <b>medium corner</b> → <b>fast sweeper</b> → a <b>crest</b> → a quick <b>left-right</b> (wiggle) → back to start. ~90–120 s. The Goliath hits everything but is slow; an EventLab blueprint or a chosen free-roam loop is the quick version. The 🧬 Decode battery below fills in as you cover each element.</p></details>`;
          lv.innerHTML = !onCourse ? "" : lo ? `<span class="chip" style="border-color:var(--accent2);color:var(--accent2)">${(() => { try { const lm = (DB.courseModels || []).find((mm) => mm && String(mm.route_key || "").indexOf("loop:") === 0 && mm.name === lo.name); const gl = lm && courseShapeGlyph(lm.geometry, 16); return gl ? `${gl} ` : ""; } catch (e) { return ""; } })()}📍 loop “${esc(lo.name)}” · lap ${lo.lap}${lo.last_s ? " · last " + lo.last_s + "s" : ""}</span> <button class="lab-mode" id="lvClearLoop" style="padding:3px 8px;font-size:11px">clear loop</button> <span class="why" style="font-size:11px">drive back through the start to complete a lap</span>${spec}`
            : `<div style="font-size:11px;color:var(--accent2);font-weight:700;margin-bottom:3px">🏟 Course mode · reference loop</div><button class="lab-mode" id="lvMarkLoop" style="padding:4px 10px;font-size:12px;border-color:var(--accent2);color:var(--accent2)">📍 mark loop start (here)</button> <input id="lvLoopName" placeholder="loop name — e.g. Decode Loop" style="min-width:220px;padding:4px 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:12px"> <span class="why" style="font-size:11px">stand at your start/finish, name it, mark — every lap is timed & position-aligned</span>${spec}`;
          const ln = lv.querySelector("#lvLoopName"); if (ln && typedLoop) ln.value = typedLoop;
          const mb = lv.querySelector("#lvMarkLoop"); if (mb) mb.addEventListener("click", () => { const nm = lv.querySelector("#lvLoopName").value.trim() || "test loop"; fetch(liveUrl + "/mark-start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nm }) }).then((r) => r.json()).then((r) => { if (r.ok !== false) { live.loop = { name: nm, lap: 0, last_s: null }; lv.dataset.k = ""; paintStatus(); } }).catch(() => {}); });
          const cb = lv.querySelector("#lvClearLoop"); if (cb) cb.addEventListener("click", () => { fetch(liveUrl + "/clear-loop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(() => { live.loop = null; lv.dataset.k = ""; paintStatus(); }).catch(() => {}); });
        }
      }
      const sv = host.querySelector("#lvStint");
      if (sv && live.connected) {
        const n = live.stint || (st && st.stint) || 0; const tg = (live.tags || {})[String(n)] || {}; const labTxt = typeof tg === "string" ? tg : (tg.label || ""); const role = (typeof tg === "object" && tg.role) || "";
        if (sv.dataset.n !== String(n) || sv.dataset.lab !== labTxt || sv.dataset.crole !== role || sv.dataset.m !== liveEffMode()) {
          const sameRun = sv.dataset.n === String(n); const typedTag = (sv.querySelector("#lvTag") || {}).value || "";   // keep a half-typed tag across repaints
          sv.dataset.n = String(n); sv.dataset.lab = labTxt; sv.dataset.crole = role; sv.dataset.m = liveEffMode();
          const roleChip = role ? `<span class="chip" style="border-color:${role === "donor" ? "#e3b341" : "#00d27a"};color:${role === "donor" ? "#e3b341" : "#00d27a"}">${role === "donor" ? "🎯 DONOR" : "🔧 REPLICA"}</span>` : "";
          const wf = liveEffMode();   // the run row follows the workflow: Course = attempts (auto-split), Decode = roles + manual splits, Free = tags + manual splits
          sv.innerHTML = n ? `<span class="chip" style="border-color:var(--accent);color:var(--accent)">🏁 ${wf === "course" ? "attempt" : "run"} ${n}${labTxt ? " “" + esc(labTxt) + "”" : ""}</span> ${roleChip}
            <input id="lvTag" placeholder="${wf === "course" ? "tag this attempt — e.g. softer front" : "tag this run — e.g. front ARB −2"}" value="${esc(labTxt)}" style="min-width:200px;padding:4px 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:12px"> <button class="lab-mode" id="lvTagBtn" style="padding:4px 10px;font-size:12px">🏷 tag</button>${wf === "course" ? "" : ` <button class="lab-mode" id="lvNewRun" title="force a run split at the next driving frame — use after a slider change" style="padding:4px 10px;font-size:12px">➕ new run</button>`}
            <div class="why" style="font-size:10.5px;margin-top:3px">${wf === "course" ? "🏟 every menu gap / restart starts a new attempt — tag one when you changed a slider between them" : wf === "decode" ? "🧬 the 🎯 DONOR / 🔧 REPLICA controls are in the Decode section below" : "🛣 runs split on a build change, an event edge, or ➕ new run — tag each re-tune"}</div>` : `<span class="why" style="font-size:11px">run counter starts with the first driving frame</span>`;
          const ti = sv.querySelector("#lvTag"); if (ti && sameRun && typedTag && typedTag !== labTxt) ti.value = typedTag;
          const tb = sv.querySelector("#lvTagBtn"); if (tb) tb.addEventListener("click", () => { const v = sv.querySelector("#lvTag").value.trim(); fetch(liveUrl + "/tag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: v, stint: n }) }).then(() => { live.tags = Object.assign({}, live.tags, { [String(n)]: Object.assign({}, live.tags[String(n)], { label: v }) }); paintStatus(); }).catch(() => {}); });
          const nr = sv.querySelector("#lvNewRun"); if (nr) nr.addEventListener("click", () => { fetch(liveUrl + "/new-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(() => { nr.textContent = "➕ splits at next driving frame"; setTimeout(() => { nr.textContent = "➕ new run"; }, 2500); }).catch(() => {}); });
        }
      }
    }
    // the clone launcher lives in the stream bar (visible in EVERY workflow) so you can pop the last-decoded
    // build sheet out into the floating window even from Course mode, where the in-section Pop out isn't shown
    function paintCloneLauncher() {
      const el = host.querySelector("#lvCloneLauncher"); if (!el) return;
      initFloat();
      const ord = (live.float.pinned && live.float.target) ? live.float.target.ordinal : floatOrd();
      const cached = (ord && live.diskCache) ? live.diskCache[ord] : null;
      if (!cached || !cached.available) { if (el.dataset.k !== "-") { el.dataset.k = "-"; el.innerHTML = ""; } return; }
      const c = diskConf(cached); const nm = cached.name || ("#" + ord); const oc = confCol(c.conf);
      const open = !!live.float.open, pinned = !!live.float.pinned;
      const k = ord + "|" + open + "|" + pinned + "|" + c.pct;
      if (el.dataset.k === k) return; el.dataset.k = k;
      el.innerHTML = `<span class="chip" style="border-color:#00d27a;color:#00d27a">📀 clone ready</span> ${buildThumb(ord, null, true)} <b style="font-size:12px">${esc(nm)}</b> <span class="chip" style="border-color:${oc};color:${oc}">${c.pct}%</span> ${open
        ? `<span class="why" style="font-size:11px">📌 window ${pinned ? "pinned — scoring your build" : "open"} · <a href="#" data-clonefocus style="color:var(--accent)">bring to front</a> · <a href="#" data-cloneclose style="color:var(--muted)">close</a></span>`
        : `<button class="lab-mode" data-clonepop style="padding:3px 10px;font-size:11px;border-color:#a371f7;color:#a371f7">📌 keep on screen</button> <span class="why" style="font-size:11px">— pops the build sheet out so it stays while you work the upgrade / tune menus</span>`}`;
      const pop = el.querySelector("[data-clonepop]"); if (pop) pop.addEventListener("click", () => { popOutFloat(ord); paintCloneLauncher(); });
      const cl = el.querySelector("[data-cloneclose]"); if (cl) cl.addEventListener("click", (e) => { e.preventDefault(); live.float.open = false; saveFloat(); paintFloat(true); paintCloneLauncher(); });
      const fc = el.querySelector("[data-clonefocus]"); if (fc) fc.addEventListener("click", (e) => { e.preventDefault(); live.float.min = false; live.float.x = null; live.float.y = null; saveFloat(); paintFloat(true); });
    }
    // ---- bottom LIVE DOCK: the session-strip spine + bench/clone pop-chips, anchored to EVERY Lab subtab (mounted on
    //      document.body so render() cycles never wipe it, like the float). Clone detaches to the floating window. ----
    const DOCK_KEY = "fh6DockState";
    const loadDock = () => { try { return JSON.parse(localStorage.getItem(DOCK_KEY)) || {}; } catch (e) { return {}; } };
    const initDock = () => { if (live.dock) return; live.dock = Object.assign({ min: false, panel: null }, loadDock()); };
    const saveDock = () => { try { localStorage.setItem(DOCK_KEY, JSON.stringify({ min: live.dock.min, panel: live.dock.panel })); } catch (e) {} };
    const ensureDockHost = () => { let el = document.getElementById("fhmDock"); if (!el) { el = document.createElement("div"); el.id = "fhmDock"; el.className = "fhm-dock"; el.style.display = "none"; document.body.appendChild(el); ensureFhmCss(); } return el; };
    const labActive = () => { const l = document.getElementById("lab"); return !!(l && l.classList.contains("active")); };
    const dockStripData = () => {
      if (src === "live") return (live.strip && live.strip.length) ? { strip: live.strip.slice(-900), cars: live.cars, corners: (live.corners || []).slice(-80) } : null;
      const s = S(); return (s && s.strip && s.strip.length) ? { strip: s.strip.slice(-900), cars: s.cars, corners: (s.corners || []).slice(-120) } : null;
    };
    const dockShouldShow = () => labActive() && (src === "live" ? (live.connected || !!(live.strip && live.strip.length)) : !!dockStripData());
    const dockCloneOrd = () => { initFloat(); return (live.float.pinned && live.float.target) ? live.float.target.ordinal : floatOrd(); };
    // bench panel: the driven car's dyno (hp/tq vs rpm) + gear ladder, from the live / loaded analysis
    const dockBenchHtml = () => {
      const ls = liveSess(); const cid = (live.frame && live.frame.on && live.frame.cid) || null;
      const c = (ls && cid && car(ls, cid)) || (ls && (ls.cars || [])[0]) || null;
      if (!c) return `<p class="why" style="font-size:11px;margin:2px 0">No car analysed yet — drive to build the dyno &amp; gear bench.</p>`;
      const dyno = c.dyno || []; const gears = c.gears || []; const nm = carName(c) || ("#" + c.ordinal);
      const dynoC = dyno.length ? chart([{ pts: dyno.map((d) => [d.rpm, d.hp]), col: "#e3b341", label: "hp" }, { pts: dyno.map((d) => [d.rpm, d.tq]), col: "#e83c9e", label: "ft·lb" }], { w: 320, h: 118, xl: "rpm (WOT frames)", yl: "" }) : `<p class="why" style="font-size:11px">no WOT frames yet — hold full throttle up the rev range</p>`;
      const ladC = gears.length ? chart([{ pts: gears.map((g, i) => [i + 1, g]), col: "#2f81f7", label: "ratio" }], { w: 240, h: 118, xl: "gear", yl: "ratio" }) : "";
      return `<div style="font-size:11px;color:var(--muted);margin-bottom:4px">📊 Bench — ${buildThumb(c.ordinal, c.build_id, true)} <b style="color:var(--txt)">${esc(nm)}</b></div><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">${dynoC}${ladC}</div>`;
    };
    // clone panel: compact summary of the pinned / last-decoded build + a "detach to floating window" action (the window holds full detail)
    const dockCloneHtml = () => {
      const ord = dockCloneOrd(); const cached = (ord && live.diskCache) ? live.diskCache[ord] : null;
      if (!cached || !cached.available) return `<p class="why" style="font-size:11px;margin:2px 0">No clone decoded yet — drive the car whose build you want to clone.</p>`;
      const c = diskConf(cached); const nm = cached.name || ("#" + ord); const oc = confCol(c.conf);
      return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px">${buildThumb(ord, null, true)}<b style="font-size:12.5px">📀 ${esc(nm)}</b><span class="chip" style="border-color:${oc};color:${oc};font-weight:700">${c.pct}%</span><button class="lab-mode" data-dockdetach="${ord}" style="padding:3px 10px;font-size:11px;border-color:#a371f7;color:#a371f7">⧉ detach to floating window</button></div>${confMeterHtml(cached)}`;
    };
    // the mph→mode readout, shared by the in-body #lvTiles card and the anchored dock strip so both stay identical
    function frameTiles(f) {
      return [[f.mph.toFixed(0), "mph"], [f.gear === 0 ? "R/N" : f.gear === 11 ? "⇅" : f.gear, "gear"], [f.rpm, "rpm"], [f.lat.toFixed(2), "lat g"], [f.lon.toFixed(2), "long g"], [f.yaw.toFixed(0), "yaw °/s"], [f.hp, "hp"], [f.boost.toFixed(1), "boost psi"], [f.on ? `${buildThumb(String(f.car), null, true)} ${piBadge(f.cls, f.pi, true)}` : "—", f.on ? `${(NAMES()[String(f.car)] || {}).name || "#" + f.car} · ${f.drv} ${f.cyl || ""}cyl` : "not driving"], [f.on ? (f.ev ? `EVENT${f.lapn ? " · lap " + f.lapn : ""}${f.rpos ? " · P" + f.rpos : ""}` : "free roam") : "—", f.on && f.ev ? `${(() => { try { const c5 = (live.analysis && (live.analysis.courses || [])[0]) || null; const n5 = c5 && (c5.name || null); return n5 ? esc(String(n5).slice(0, 16)) + " · " : ""; } catch (e) { return ""; } })()}${(f.dist / 1000).toFixed(2)} km · ${f.lapt ? f.lapt.toFixed(1) + " s" : ""}` : "mode"]];
    }
    // anchored constant-feedback readout in the dock — the full mph→mode row, visible even when the dock is collapsed
    function paintDockTiles() {
      const el = document.getElementById("dockTiles"); if (!el) return; const f = live.frame;
      if (src === "live" && f) {
        el.innerHTML = frameTiles(f).map(([v, l]) => `<div class="fhm-dtile"><b>${v}</b><span>${l}</span></div>`).join("");
      } else if (src !== "live") { const s = S(); el.innerHTML = s ? `<div class="fhm-dtile" style="min-width:auto"><b style="font-size:11.5px">📼 ${esc(s.id)}</b><span>recording</span></div>` : ""; }
      else { el.innerHTML = `<span class="why" style="font-size:11px;padding:5px 4px">waiting for telemetry…</span>`; }
    }
    function paintDockStrip() {
      const el = document.getElementById("dockStrip"); if (!el) return; const d = dockStripData();
      el.innerHTML = d ? strip(d) : `<p class="why" style="font-size:11px;margin:2px 0">waiting for the first second…</p>`;
    }
    // ---- anchored-dock cockpit panels: iteration tracker, A/B results, and the manual sanity check — the result-tracking
    //      surfaces, always reachable on the dock instead of buried in the scrolling body. ----
    const dockActiveCid = () => { if (live.frame && live.frame.on && live.frame.cid) return live.frame.cid; const ls = liveSess(); const c = ls && (ls.cars || [])[0]; return c ? c.id : null; };
    const dockIterHtml = () => { const cid = dockActiveCid();
      if (!cid) return `<p class="why" style="font-size:11px;margin:2px 0">No car yet — drive to track tune changes.</p>`;
      const moves = (live.lastMoves && live.lastMoves[cid]) || [];
      return appliedStrip(cid, moves) || `<div class="why" style="font-size:11px">🔁 Nothing marked done yet. In the tuning panel press <b>“✓ I made this”</b> on a suggested change — it tracks here: did it land on your saved tune, and did it clear the issue.</div>`; };
    const dockABHtml = () => { const cid = dockActiveCid();
      if (!cid) return `<p class="why" style="font-size:11px;margin:2px 0">No car yet — drive to capture A/B baselines.</p>`;
      return abPanel(cid) || `<div class="why" style="font-size:11px">⚗️ No A/B versions yet. Every saved change spawns a version automatically — the full slider set is stored so you can compare balance, spin% and limited-corner counts.</div>`; };
    // the manual sanity check + a "what's new" window: same check as the auto save-trigger, but on demand and diffed
    // against the findings you last acknowledged, so genuinely new problems stand out.
    const activeSanCtx = () => { const ord = (live.frame && live.frame.car) || lastCarOrd(); if (!ord) return null;
      const cached = live.diskCache && live.diskCache[ord]; if (!cached || !cached.available || !cached.deliverable) return null;
      const dl = cached.deliverable; const cm = (dl.menus || []).find((m) => m.menu === "Conversions"); const dr = cm && (cm.rows || []).find((r) => r.item === "drivetrain");
      const drv = (dr && dr.resulting_drivetrain) || (live.frame && live.frame.on && live.frame.drv) || null;
      const cid = (live.frame && live.frame.on && live.frame.cid) || String(ord);
      return { ord, dl, drv, cid }; };
    const runSanityCheck = (opts) => { opts = opts || {}; const ctx = activeSanCtx(); if (!ctx) return;
      if (opts.acknowledge && ctx.dl) saveSanSeen(ctx.cid, new Set(sanityCheck(ctx.dl, ctx.drv).map(sanKey)));   // baseline what's visible now
      if (opts.refresh && ctx.ord) { if (live.diskCache) delete live.diskCache[ctx.ord]; fetchDiskTune(ctx.ord, { force: true }); fetch(liveUrl + "/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}); } };
    const dockSanityHtml = () => { const ctx = activeSanCtx();
      if (!ctx) return `<p class="why" style="font-size:11px;margin:2px 0">No decoded tune yet — drive the car to read its sliders, then check.</p>`;
      const findings = sanityCheck(ctx.dl, ctx.drv); const seen = loadSanSeen(ctx.cid);
      const keys = findings.map(sanKey); const hl = new Set(keys.filter((k) => !seen.has(k)));
      const resolved = [...seen].filter((k) => !keys.includes(k)).length;
      const err = findings.filter((x) => x.lvl === "error").length, warn = findings.filter((x) => x.lvl === "warn").length;
      const head = `<div class="dsan-hd"><span>${hl.size ? `<b class="dsan-new">⭐ ${hl.size} new</b>` : `<span class="why">no new findings</span>`}${resolved ? ` · <span class="dsan-res">✓ ${resolved} resolved</span>` : ""} <span class="why">· ${err} error${err === 1 ? "" : "s"}, ${warn} warning${warn === 1 ? "" : "s"}</span></span><button class="lab-mode" data-sancheck="1" title="re-read the saved tune + re-run the driving analysis, then mark these findings as seen">🩺 Check now</button></div>`;
      return `<div class="dsan">${head}${sanityPanel(ctx.dl, ctx.drv, hl)}</div>`; };
    // ---- 📡 DATA-NEEDS STATUS: the single surface that says which LIVE TECHNIQUES are still required before the
    // analysis can be trusted — the union's ranked asks (gear ladder, redline pull, drive-once, calibration…) plus
    // course-knowledge needs in course mode. Pill = always-visible count; panel = the technique list with payoffs. ----
    const dockDataState = () => {
      const ord = (live.frame && live.frame.car) || lastCarOrd(); if (!ord) return null;
      const cached = live.diskCache ? live.diskCache[ord] : undefined;
      if (cached === undefined || cached === null) { if (cached === undefined && live.connected) fetchDiskTune(ord); return { loading: true }; }   // null = in flight (J4)
      if (!cached.available) return { none: true, ord };
      const u = (cached.deliverable || {}).union || {};
      let courseNeeds = [];
      if (effMode() === "course") { const ls = liveSess(); const co = ls && (ls.courses || [])[0];
        if (co) { const ck = courseKnowledge(co); courseNeeds = (ck.needs || []).map((n) => ({ text: n.text, gain: "course knowledge", key: "course-" + n.k })); } }
      return { ord, asks: (u.asks || []), courseNeeds, agree: u.n_agree || 0, fill: u.n_fill || 0, conflict: u.n_conflict || 0 };
    };
    const dockDataHtml = () => {
      const s = dockDataState();
      if (!s) return `<p class="why" style="font-size:11px;margin:2px 0">No car yet — get in a car; the data checklist scopes to it.</p>`;
      if (s.loading) return `<p class="why" style="font-size:11px;margin:2px 0">reading the build…</p>`;
      if (s.none) return `<div class="ddata-row"><span class="ddata-arrow">▸</span><span><b>apply or save a tune in-game</b> — no tune file exists for this car (downloaded tunes write theirs when applied; your own when saved); the decode has nothing to analyse until one exists</span><span class="ddata-gain">unblocks decode</span></div>`;
      const rows = [...s.asks, ...s.courseNeeds];
      const cap = `<div class="ddata-cap">${s.agree ? `<span class="us-chip ok" title="save and telemetry agree on these">✓ ${s.agree} corroborated</span>` : ""}${s.fill ? `<span class="us-chip fill" title="values the save cannot know, measured live">📡 ${s.fill} from telemetry</span>` : ""}${s.conflict ? `<span class="us-chip bad">⚠ ${s.conflict} conflict${s.conflict > 1 ? "s" : ""}</span>` : ""}</div>`;
      if (!rows.length) return `${cap}<div class="ddata-done">✓ every measurable is captured — the analysis is running on complete data for this car</div>`;
      return `${cap}<div class="why" style="font-size:10.5px;margin:2px 0 5px">these techniques provide the data the analysis still needs — in payoff order:</div>${rows.map((a) => `<div class="ddata-row"><span class="ddata-arrow">▸</span><span>${esc(a.text)}</span><span class="ddata-gain">${esc(a.gain)}</span></div>`).join("")}`;
    };
    const paintDockData = () => {
      const el = document.getElementById("dockData"); if (!el) return;
      const s = dockDataState();
      if (!s || s.loading) { if (el.innerHTML) { el.innerHTML = ""; el.dataset.k = ""; } return; }
      const n = s.none ? 1 : (s.asks || []).length + (s.courseNeeds || []).length;
      // an OPEN CONFLICT outranks "complete": zero asks with disagreeing data is red, not green (found by verify_workflow attr D1)
      const lvl = s.conflict ? "bad" : (s.none || n ? "warn" : "ok");
      const label = s.conflict && !n ? `⚠ ${s.conflict} conflict${s.conflict > 1 ? "s" : ""} open` : s.none ? "apply/save a tune" : n ? `${n} drive${n > 1 ? "s" : ""} needed` : "data complete";   // J1: a menu save is not a "drive"
      const pk = lvl + "|" + label; if (el.dataset.k === pk) return; el.dataset.k = pk;   // paintDock runs per FRAME — an unconditional rebuild replaced the pill mid-press and ate the click
      el.innerHTML = `<button class="ddata-pill ${lvl}" title="${s.conflict ? "save × telemetry disagree — open the panel / 🔗 drawer" : n ? "live techniques still needed for correct analysis — click for the list" : "all measurable data captured for this car"}"><span class="dot"></span>📡 ${label}</button>`;
      const b = el.querySelector(".ddata-pill"); if (b) b.addEventListener("click", () => { live.dock.panel = live.dock.panel === "data" ? null : "data"; if (live.dock.min) live.dock.min = false; saveDock(); paintDock(true); });
    };
    const dockPanelSig = (panel) => { const cid = dockActiveCid();
      if (panel === "iter") return `i|${cid}|${localStorage.getItem(appliedKey(cid || "")) || ""}|${((live.lastMoves || {})[cid] || []).map((m) => m.sl).join(",")}`;
      if (panel === "ab") return `a|${cid}|${localStorage.getItem(abKey(cid || "")) || ""}`;
      if (panel === "san") { const ctx = activeSanCtx(); return `s|${ctx ? ctx.cid : ""}|${ctx ? sanityCheck(ctx.dl, ctx.drv).map(sanKey).join(";") : ""}|${ctx ? localStorage.getItem(sanSeenKey(ctx.cid)) || "" : ""}`; }
      if (panel === "data") { const s = dockDataState(); return `d|${s ? (s.ord || "") : ""}|${s && s.asks ? s.asks.map((a) => a.key).join(",") : ""}|${s && s.courseNeeds ? s.courseNeeds.map((a) => a.key).join(",") : ""}|${s ? `${s.agree}.${s.fill}.${s.conflict}` : ""}|${s && s.none ? "none" : ""}`; }
      return panel; };
    const fillDockPanel = (pel, panel) => {
      pel.innerHTML = panel === "bench" ? dockBenchHtml() : panel === "clone" ? dockCloneHtml() : panel === "iter" ? dockIterHtml() : panel === "ab" ? dockABHtml() : panel === "san" ? dockSanityHtml() : panel === "data" ? dockDataHtml() : "";
      const dt = pel.querySelector("[data-dockdetach]"); if (dt) dt.addEventListener("click", () => { popOutFloat(+dt.dataset.dockdetach); paintDock(true); });
      pel.querySelectorAll("[data-retest]").forEach((b) => b.addEventListener("click", () => { b.textContent = "🔁 re-analysing…"; b.disabled = true; fetch(liveUrl + "/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}); }));
      pel.querySelectorAll("[data-clearapplied]").forEach((b) => b.addEventListener("click", () => { if (!b.dataset.arm) { b.dataset.arm = "1"; const t0 = b.textContent; b.textContent = "really clear the history?"; setTimeout(() => { delete b.dataset.arm; b.textContent = t0; }, 4000); return; } localStorage.removeItem(appliedKey(b.dataset.clearapplied)); paintDock(true); }));   // audit F9: two-step
      pel.querySelectorAll("[data-sancheck]").forEach((b) => b.addEventListener("click", () => { b.textContent = "🩺 checking…"; runSanityCheck({ acknowledge: true, refresh: true }); setTimeout(() => paintDock(true), 250); }));
      pel.dataset.sig = dockPanelSig(panel); };
    function paintDock(force) {
      initDock(); const el = ensureDockHost();
      if (!dockShouldShow()) { el.style.display = "none"; const m = document.querySelector("main"); if (m && m.dataset.dockpad) { m.style.paddingBottom = ""; delete m.dataset.dockpad; } return; }
      el.style.display = "block";
      const cloneReady = !!(dockCloneOrd() && live.diskCache && live.diskCache[dockCloneOrd()] && live.diskCache[dockCloneOrd()].available);
      const hasCar = !!dockActiveCid();
      const offline = src === "live" && !live.connected;
      const idle = src === "live" && !hasCar && !(live.strip || []).length;   // no car, no data yet — one line, not seven placeholders (audit F21)
      let panel = live.dock.panel;
      if (!hasCar && ["iter", "ab", "san", "data"].includes(panel)) panel = null;   // never render a panel whose chip is hidden
      const shellKey = `${live.dock.min}|${panel}|${cloneReady}|${hasCar}|${src}|${offline}|${idle}`;
      if (idle) {
        if (el.dataset.k !== shellKey) { el.dataset.k = shellKey; el.className = "fhm-dock" + (offline ? " offline" : "");
          el.innerHTML = `<div class="fhm-dock-hd"><span class="fhm-dock-ttl${offline ? " off" : ""}"><span class="dot"></span>${offline ? "OFFLINE" : "LIVE"}</span><span class="why" style="font-size:11px">waiting for telemetry — get in a car and drive</span></div>`;
          const m0 = document.querySelector("main"); if (m0) { m0.style.paddingBottom = (el.offsetHeight + 14) + "px"; m0.dataset.dockpad = "1"; } }
        return;
      }
      if (force || el.dataset.k !== shellKey) {
        el.dataset.k = shellKey; el.className = "fhm-dock" + (live.dock.min ? " min" : "") + (offline ? " offline" : "");
        const chip = (key, label, hide) => `<button class="fhm-dchip ${panel === key ? "on" : ""}${hide ? " hidden" : ""}" data-dockpanel="${key}">${label}</button>`;
        el.innerHTML = `<div class="fhm-dock-hd"><span class="fhm-dock-ttl${offline ? " off" : ""}"><span class="dot"></span>${offline ? "OFFLINE — last data" : "LIVE"}</span><span id="dockTrac"></span><span id="dockData"></span><span class="fhm-dock-chips">${chip("data", "📡 data", !hasCar)}${chip("bench", "📊 bench")}${chip("iter", "🔁 iter", !hasCar)}${chip("ab", "⚗️ A/B", !hasCar)}${chip("san", "🩺 check", !hasCar)}${chip("clone", "📀 clone", !cloneReady)}<button class="fhm-dock-x" data-dockmin title="${live.dock.min ? "expand" : "collapse"}">${live.dock.min ? "▲" : "▼"}</button></span></div><div class="fhm-dock-tiles" id="dockTiles"></div>${live.dock.min ? "" : `${panel ? `<div class="fhm-dock-panel" id="dockPanel"></div>` : ""}<div class="fhm-dock-strip" id="dockStrip"></div>`}`;
        el.querySelectorAll("[data-dockpanel]").forEach((b) => b.addEventListener("click", () => { live.dock.panel = live.dock.panel === b.dataset.dockpanel ? null : b.dataset.dockpanel; if (live.dock.min) live.dock.min = false; saveDock(); paintDock(true); }));
        const mn = el.querySelector("[data-dockmin]"); if (mn) mn.addEventListener("click", () => { live.dock.min = !live.dock.min; saveDock(); paintDock(true); });
        if (!live.dock.min && panel) { const pel = el.querySelector("#dockPanel"); if (pel) fillDockPanel(pel, panel); }
        paintDockStrip();
        paintDockTiles();
        const m = document.querySelector("main"); if (m) { m.style.paddingBottom = (el.offsetHeight + 14) + "px"; m.dataset.dockpad = "1"; }
      }
      // keep the live cockpit panels fresh without wiping them every frame — only re-render when their content changed
      if (!live.dock.min && (panel === "iter" || panel === "ab" || panel === "san" || panel === "data")) { const pel = el.querySelector("#dockPanel"); if (pel && pel.dataset.sig !== dockPanelSig(panel)) fillDockPanel(pel, panel); }
      paintDockTiles(); paintDockTrac(); paintDockData();
    }
    // shared rolling-window traction stat, used by the full Free-Tuning card AND the anchored dock pill
    const tracSummary = () => {
      const buf = live.trac || []; if (buf.length < 25) return null;   // computed from the persistent buffer — survives a pause so the finding stays up while you implement it
      const med = (a) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
      const pct = Math.round(100 * buf.filter((b) => b.spin).length / buf.length);
      const rmed = med(buf.map((b) => b.rc)), fmed = med(buf.map((b) => b.fc)); const drv = live.tracDrv || (live.frame && live.frame.drv) || "RWD";
      const axleLimited = drv === "FWD" ? (fmed > rmed * 1.5) : (rmed > fmed * 1.5);
      return { pct, rmed, fmed, drv, axle: drv === "FWD" ? "FRONT" : "REAR", axleLimited, lvl: pct >= 55 ? "bad" : pct >= 25 ? "warn" : "ok", paused: !(live.frame && live.frame.on) };
    };
    // the traction finding, PER CAR + persisted, so the sanity check can flag it even on a fresh load / a car you're
    // not currently in. Live buffer for the car you're driving; last-saved reading otherwise.
    const tracForCar = (ord) => {
      const liveCar = (live.frame && live.frame.car) || lastCarOrd();
      if (ord && String(liveCar) === String(ord)) { const s = tracSummary(); if (s && s.pct != null) { try { localStorage.setItem("fh6Trac:" + ord, JSON.stringify({ pct: s.pct, axle: s.axle, lvl: s.lvl, drv: s.drv, at: Date.now() })); } catch (e) {} } return s; }
      try { return JSON.parse(localStorage.getItem("fh6Trac:" + ord) || "null"); } catch (e) { return null; }
    };
    const paintDockTrac = () => {
      const el = document.getElementById("dockTrac"); if (!el) return; const s = tracSummary();
      if (!s) { if (el.innerHTML) el.innerHTML = ""; return; }
      const lbl = s.lvl === "ok" ? "grip" : `${s.axle[0]}·spin ${s.pct}%`; const ic = s.paused ? "⏸" : "🔥";
      el.innerHTML = `<span class="dtrac ${s.lvl}" title="traction: driven wheels over the grip limit ${s.pct}% of on-throttle time${s.axleLimited ? " · " + s.axle.toLowerCase() + "-limited" : ""}${s.paused ? " · frozen from your last drive" : ""}"><span class="dot"></span>${ic} ${lbl}</span>`;
    };
    // LIVE traction diagnosis from the rolling on-throttle window: how often the driven axle is over the grip limit,
    // which axle, and the immediate tuning fix. Actively scans every frame — no waiting for the ~20 s analysis.
    function paintTraction() {
      const el = host.querySelector("#lvTraction"); if (!el) return;
      const s = tracSummary();
      if (!s) { if (el.innerHTML) { el.innerHTML = ""; el.dataset.k = ""; } return; }
      const key = s.lvl + "|" + s.pct + "|" + (s.axleLimited ? "1" : "0") + "|" + s.drv + "|" + (s.paused ? "p" : "d");
      if (el.dataset.k === key) return; el.dataset.k = key;
      const frozen = s.paused ? `<span class="trac-frozen">⏸ from your last drive — implement it, then re-test</span>` : "";
      if (s.lvl === "ok") { el.innerHTML = `<div class="trac ok"><b>✓ TRACTION OK</b> <span class="why">— over the grip limit only ${s.pct}% of your throttle time; you're putting the power down.</span>${frozen}</div>`; return; }
      const fix = s.drv === "FWD"
        ? "front diff <b>ACCEL&nbsp;↓</b> · soften the <b>FRONT</b> ARB &amp; spring · front tyre pressure toward its grip peak · shift weight forward"
        : "rear diff <b>ACCEL&nbsp;↓</b> (less snap) · soften the <b>REAR</b> ARB &amp; spring (more mechanical grip) · rear tyre pressure toward its grip peak · add <b>rear downforce</b> / rear weight if available · feed the throttle in more progressively";
      const ratio = s.axleLimited ? Math.round((s.drv === "FWD" ? s.fmed / Math.max(0.02, s.rmed) : s.rmed / Math.max(0.02, s.fmed))) : 0;
      const sev = s.lvl === "bad" ? "MAJOR" : "moderate";
      el.innerHTML = `<div class="trac ${s.lvl}"><div class="trac-hd"><b>🔥 TRACTION — ${s.axle}-LIMITED</b><span class="trac-sev">${sev}</span>${frozen}</div>`
        + `<div class="trac-why">The <b>${s.axle.toLowerCase()}</b> is over the grip limit <b>${s.pct}%</b> of the time you're on the throttle${ratio >= 3 ? ` — ${ratio}× the other axle` : ""}. You're spinning, not accelerating.</div>`
        + `<div class="trac-fix">→ ${fix}</div></div>`;
    }
    // ---- F1-STYLE SPEED TRACE: a constant tracker of speed over the run. Free mode = the last 2 minutes (vs time);
    // course mode = the current lap (vs track distance, so corners sit at their real track positions). Corners are marked
    // at the speed minima (a dip that recovers) — the "dramatic change" a race engineer reads straight off this chart. ----
    const SPD_WIN_S = 120;   // free-mode rolling window (seconds)
    const spdWindow = () => {
      const buf = live.spd || []; if (buf.length < 4) return null;
      if (effMode() === "course") {
        const evPts = buf.filter((p) => p.ev && p.dist != null);
        if (evPts.length >= 8) {
          // group by CONTIGUOUS (segment, lap) — a group is one clean pass of a lap with no discontinuity inside it, so
          // its distance is monotonic and the x-axis can't be corrupted by a menu/rewind mid-lap. Overlay the 6 most
          // recent groups; a replay or glitch lands in its own segment and simply scrolls out.
          const groups = new Map();
          evPts.forEach((p) => { const k = p.seg + "|" + p.lapn; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
          const ordered = [...groups.values()].filter((g) => g.length >= 6).sort((a, b) => a[a.length - 1].t - b[b.length - 1].t).slice(-6);
          const laps = ordered.map((g) => { const d0 = g[0].dist;
            return { lapn: g[0].lapn, pts: g.map((p) => ({ x: Math.max(0, p.dist - d0), y: p.mph, t: p.t, seg: p.seg })) }; });
          if (laps.length) return { mode: "course", laps, xlabel: "lap distance", curLap: laps[laps.length - 1].lapn };
        }
      }
      const lastT = buf[buf.length - 1].t; const w = buf.filter((p) => lastT - p.t <= SPD_WIN_S);
      if (w.length < 4) return null; const t0 = w[0].t;
      return { pts: w.map((p) => ({ x: p.t - t0, y: p.mph, t: p.t, seg: p.seg })), mode: "free", xlabel: "seconds", lapn: null, span: lastT - t0 };
    };
    // RECONCILE with the analyzer: place a marker at each detected turn (authoritative — lateral-g + slip, not just
    // speed), aligned to the trace by matching the corner's time window to the buffer. Carries L/R + true min speed.
    // Returns null when no analyzer corner overlaps the window, so the caller falls back to raw speed-minima.
    const spdCorners = (pts) => {
      const cs = live.corners || []; if (!cs.length || pts.length < 4) return null;
      const tMin = pts[0].t, tMax = pts[pts.length - 1].t;
      const inWin = cs.filter((c) => c.t0 != null && c.t1 != null && c.t1 >= tMin && c.t0 <= tMax);
      if (!inWin.length) return null;
      const marks = [];
      inWin.forEach((c) => { let best = -1, bestY = Infinity;
        for (let i = 0; i < pts.length; i++) { if (pts[i].t >= c.t0 && pts[i].t <= c.t1 && pts[i].y < bestY) { bestY = pts[i].y; best = i; } }
        if (best >= 0) marks.push({ i: best, dir: c.dir, mph: c.mph_min != null ? c.mph_min : Math.round(pts[best].y) }); });
      marks.sort((a, b) => a.i - b.i);
      const dedup = []; marks.forEach((m) => { const l = dedup[dedup.length - 1]; if (!l || m.i - l.i > 2) dedup.push(m); else if (m.mph < l.mph) dedup[dedup.length - 1] = m; });
      return dedup.length ? dedup : null;
    };
    const spdDips = (pts) => {   // corners = local speed minima that fell and recovered by >=7 mph
      const n = pts.length; if (n < 6) return [];
      const win = Math.max(3, Math.round(n * 0.02)); const raw = [];
      for (let i = win; i < n - win; i++) { const y = pts[i].y; let isMin = true;
        for (let j = i - win; j <= i + win; j++) { if (pts[j].y < y - 0.01) { isMin = false; break; } }
        if (!isMin) continue;
        const before = Math.max(...pts.slice(Math.max(0, i - win * 3), i).map((p) => p.y));
        const after = Math.max(...pts.slice(i + 1, Math.min(n, i + win * 3)).map((p) => p.y));
        if (before - y >= 7 && after - y >= 7 && y >= 6) raw.push(i); }   // y>=6: a corner, not a standstill / launch
      const merged = []; raw.forEach((i) => { const last = merged[merged.length - 1]; if (last != null && i - last < win * 2) { if (pts[i].y < pts[last].y) merged[merged.length - 1] = i; } else merged.push(i); });
      return merged;
    };
    const speedTraceHtml = () => {
      const win = spdWindow();
      if (!win) return `<div class="spd-hd"><b>🏁 Speed trace</b></div><p class="why" style="font-size:11px;margin:4px 0">gathering data… drive to build the line.</p>`;
      const W = 720, H = 190, PL = 32, PR = 10, PT = 14, PB = 24;
      const lines = win.mode === "course" ? win.laps.map((L) => L.pts) : [win.pts];
      const allPts = [].concat(...lines);
      const xMax = Math.max(1, ...allPts.map((p) => p.x)), yMax = Math.max(40, Math.ceil((Math.max(...allPts.map((p) => p.y)) + 4) / 10) * 10);
      const X = (x) => PL + (x / xMax) * (W - PL - PR), Y = (y) => PT + (1 - y / yMax) * (H - PT - PB);
      // break the line at SEGMENT boundaries (a "M" instead of "L") so a pause/menu gap or a rewind never draws a
      // connecting streak across the discontinuity.
      const pathOf = (pts) => pts.map((p, i) => `${(i === 0 || (pts[i - 1].seg != null && p.seg !== pts[i - 1].seg)) ? "M" : "L"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" ");
      const yticks = [0, Math.round(yMax / 2), yMax].map((v) => `<line x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}" stroke="rgba(255,255,255,.07)"/><text x="${PL - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">${v}</text>`).join("");
      // corner markers (analyzer turns when available, else speed minima) — always drawn on the NEWEST line
      const markOf = (pts) => { const an = spdCorners(pts); const list = an || spdDips(pts).map((i) => ({ i, mph: Math.round(pts[i].y) }));
        const html = list.map((m, k) => { const p = pts[m.i], x = X(p.x), y = Y(p.y); const d = m.dir === "R" ? "▶" : m.dir === "L" ? "◀" : "";
          return `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${H - PB}" stroke="rgba(227,179,65,.30)" stroke-dasharray="3 3"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#e3b341"/><text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" fill="#e3b341" font-size="10" font-weight="700">T${k + 1}${d}</text><text x="${x.toFixed(1)}" y="${(H - PB + 10).toFixed(1)}" text-anchor="middle" fill="var(--muted)" font-size="8">${Math.round(m.mph)}</text>`; }).join("");
        return { html, n: list.length, src: an ? "analyzer turns · ◀▶ dir" : "speed minima" }; };
      let body = "", markers = "", nC = 0, src = "", hd = "", note = "";
      if (win.mode === "course") {
        const n = win.laps.length;
        // OLDEST → NEWEST: brighter/thicker green = the more recent lap; older laps fade toward dark green
        body = win.laps.map((L, i) => { const rec = n > 1 ? i / (n - 1) : 1;
          const col = `hsl(145,${Math.round(45 + 28 * rec)}%,${Math.round(30 + 34 * rec)}%)`, op = (0.32 + 0.68 * rec).toFixed(2), sw = (1 + 0.9 * rec).toFixed(1);
          return `<path d="${pathOf(L.pts)}" fill="none" stroke="${col}" stroke-width="${sw}" opacity="${op}"/>`; }).join("");
        const mk = markOf(win.laps[n - 1].pts); markers = mk.html; nC = mk.n; src = mk.src;
        hd = `🏁 Speed trace — ${n} lap${n === 1 ? "" : "s"} overlaid · lap ${win.curLap} newest`;
        note = `brighter = newer lap · corners = ${src}`;
      } else {
        const pts = win.pts;
        // area fill only under the LAST continuous segment (the current drive) so a paused gap earlier in the window
        // doesn't paint a filled block across the break.
        const lastSeg = pts[pts.length - 1].seg; const tail = pts.filter((p) => p.seg === lastSeg);
        const area = tail.length >= 2 ? `<path d="${pathOf(tail)} L${X(tail[tail.length - 1].x).toFixed(1)} ${Y(0).toFixed(1)} L${X(tail[0].x).toFixed(1)} ${Y(0).toFixed(1)} Z" fill="rgba(47,129,247,.10)"/>` : "";
        body = area + `<path d="${pathOf(pts)}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`;
        const mk = markOf(pts); markers = mk.html; nC = mk.n; src = mk.src;
        hd = `🏁 Speed trace — last ${Math.min(SPD_WIN_S, Math.round(win.span || 0))}s · ${nC} corner${nC === 1 ? "" : "s"}`;
        note = `corners = ${src}`;
      }
      const xlab = win.mode === "free" ? `${Math.round(win.span || xMax)}s ago ← → now` : `${(xMax / 1000).toFixed(2)} km/lap`;
      return `<div class="spd-hd"><b>${hd}</b><span class="why" style="font-size:10px">${note}</span></div>
        <svg viewBox="0 0 ${W} ${H}" class="spd-svg" style="width:100%;height:auto;display:block">
          ${yticks}${body}${markers}
          <text x="${W - PR}" y="${H - 3}" text-anchor="end" fill="var(--muted)" font-size="9">${esc(xlab)}</text>
          <text x="${PL - 26}" y="${PT + 4}" fill="var(--muted)" font-size="9">mph</text>
        </svg>`;
    };
    const paintSpeedTrace = (force) => { const els = document.querySelectorAll(".lvSpeedTrace"); if (!els.length) return;
      const anyEmpty = [...els].some((e) => !e.innerHTML);   // a freshly-mounted container fills at once, throttle aside
      const now = performance.now(); if (!force && !anyEmpty && live._spdPaintT && now - live._spdPaintT < 480) return; live._spdPaintT = now;   // ~2 fps is plenty for a trace
      const html = speedTraceHtml(); els.forEach((el) => { el.innerHTML = html; }); };
    function paintFrame() {
      const f = live.frame; if (!f) return;
      if (f.car && live.connected) { fetchDiskTune(f.car); diskSigCheck(f); }   // auto-fill + re-match the decode to the build now loaded (cyl/PI signature)
      // J5: the focus pull must also fire on the COURSE-ARRIVAL edge (entering an event / starting a loop) — a car
      // identified back in free roam produces no new match event when f.ev flips, so match-arrival alone missed it.
      const onC = !!(f.ev || live.loop);
      if (onC && !live._prevOnCourse && f.car) { const c0 = live.diskCache && live.diskCache[f.car]; if (c0 && c0.available) maybeFocusCourse(c0.match, f.car); }
      live._prevOnCourse = onC;
      updateLiveDec(f); paintDecNext(); paintDiskDecode(); paintFloat(); paintCloneLauncher(); paintCourseLive(); paintActiveCar(); updCarDot(f);
      // course training is CAR-AWARE: when the equipped car changes, re-scope the car-specific parts (references, tuning, feedback) — repaint the course sections
      if (f.on && f.cid && f.cid !== live.courseCar) { const was = live.courseCar; live.courseCar = f.cid; if (was) { live._carJustChanged = performance.now(); if (effMode() !== "free") paintSections(true); } }
      for (const w of W4) {
        const [ratio, angle, comb] = f.slip[w]; const ring = host.querySelector(`[data-ring="${w}"]`), nd = host.querySelector(`[data-needle="${w}"]`), pk = host.querySelector(`[data-peak="${w}"]`);
        if (!ring) continue;
        const sat = Math.abs(comb) > 1; ring.setAttribute("stroke", sat ? "#e5414e" : "#00d27a");
        const sc = 46, cl = (v) => Math.max(-2.2, Math.min(2.2, v));
        nd.setAttribute("x2", (60 + cl(angle) * sc / 1.0).toFixed(1)); nd.setAttribute("y2", (68 - cl(ratio) * sc / 1.0).toFixed(1));
        pk.textContent = `${Math.round(Math.abs(comb) * 100)}%`; pk.setAttribute("fill", sat ? "#e5414e" : "var(--txt)");
      }
      // ---- LIVE TRACTION SCANNER: driven-wheel slip WHILE ON THROTTLE — the power-down pattern the corner analysis
      // (lateral grip) misses. Accumulates a rolling window; paintTraction turns it into an instant diagnosis + fix. ----
      if (f.on && f.slip) {
        if (live._tracCar !== f.car) { live._tracCar = f.car; live.trac = []; }   // J8: a different car's wheelspin is not this car's diagnosis
        if (f.drv && f.drv !== "?") live.tracDrv = f.drv;   // remember the drivetrain so the finding still reads correctly once you pause
        const drivenW = f.drv === "FWD" ? ["FL", "FR"] : f.drv === "RWD" ? ["RL", "RR"] : ["FL", "FR", "RL", "RR"];
        if (f.thr > 190 && f.mph > 3) {   // hard on the gas and actually moving (not a standstill burnout)
          const cb = (w) => Math.abs((f.slip[w] || [0, 0, 0])[2]);
          const dc = Math.max(...drivenW.map(cb)); const rc = Math.max(cb("RL"), cb("RR")), fc = Math.max(cb("FL"), cb("FR"));
          (live.trac = live.trac || []).push({ mph: f.mph, dc, rc, fc, spin: dc > 1 });
          if (live.trac.length > 300) live.trac.shift();
        }
      }
      // ---- SPEED-TRACE buffer (FH6-robust): sample ~7Hz ONLY while actually driving. Reject single-frame telemetry
      // SPIKES, and start a NEW SEGMENT on any discontinuity — a pause/menu gap, a distance teleport or REWIND, a lap
      // regression (replay), or a car change. Segments are never joined by a line, so menu-pausing, rewinds and replays
      // can't draw wild connecting streaks across the chart. ----
      if (f.on && f.mph != null && f.mph >= 0 && f.mph < 320 && f.car) {
        const now = performance.now();
        if (!live._spdT || now - live._spdT >= 140) {
          const buf = (live.spd = live.spd || []); const prev = buf[buf.length - 1];
          const dt = prev ? f.t - prev.t : 0;
          const spike = prev && dt >= 0 && dt < 0.6 && Math.abs(f.mph - prev.mph) > 55;   // ~16g in one sample = a glitch frame, not real motion → skip it
          if (!spike) {
            live._spdT = now; let seg = live._spdSeg || 0;
            if (prev) { const dd = (f.dist != null && prev.dist != null) ? f.dist - prev.dist : 0;
              // gap (pause/menu) · time going backward · distance rewind · distance teleport · lap regression (replay) · car swap
              if (dt > 1.0 || dt < 0 || dd < -5 || Math.abs(dd) > 120 || (f.lapn != null && prev.lapn != null && f.lapn < prev.lapn) || String(f.car) !== String(prev.car)) seg = (live._spdSeg = seg + 1);
            }
            buf.push({ t: f.t, mph: f.mph, dist: f.dist, lapn: f.lapn, ev: f.ev, seg, car: f.car });
            if (buf.length > 6000) buf.shift();   // ~14 min at 7Hz — several laps overlaid in course mode
          }
        }
        paintSpeedTrace();
      }
      paintTraction(f);
      // the stream bar's live line follows the WORKFLOW: Course = the event you're in (lap, lap time, distance); Decode = donor capture state; Free = the car and the run
      const wl = host.querySelector("#lvWfLine");
      if (wl) {
        const wf = liveEffMode(); const carNm = f.on ? ((NAMES()[String(f.car)] || {}).name || "#" + f.car) : "—"; const an = live.analysis; let html = "";
        if (wf === "course") {
          const co = an && (an.courses || [])[0]; const rn = co ? (co.name || routeName(co.route_key, null)) : null;
          html = f.on && f.ev ? `${(() => { const g5 = co ? courseGeoFor(co) : null; const st5 = co ? startOfKey(co.route_key, g5) : null; return `<span class="chip" style="border-color:var(--accent2);color:var(--accent2);font-weight:700"${st5 ? ` title="start ${st5}"` : ""}>${courseShapeGlyph(g5, 16)} 🏟 EVENT${rn ? " · " + esc(rn) : st5 ? ` · <span class="why" style="font-weight:400">unnamed — shape is the identity · <span class="start-pt"><i>●</i> ${st5}</span></span>` : ""}</span>`; })()} lap <b>${f.lapn || 1}</b>${f.lapt ? ` · <b>${f.lapt.toFixed(1)} s</b>` : ""}${f.rpos ? ` · P${f.rpos}` : ""} · ${(f.dist / 1000).toFixed(2)} km${co && co.best_lap ? ` · session best ${co.best_lap.toFixed(3)} s` : ""}${co && co.track && co.track.best ? ` · track best ${co.track.best.best_lap.toFixed(3)} s` : ""}${co && co.track ? ` · ${co.track.laps} laps on record` : ""}${co && co.turns ? ` · ${co.turns.count} turns @ ${Math.round(co.turns.confidence * 100)}%` : ""}${(() => { const ls2 = liveSess(); const cof = ls2 && (ls2.courses || [])[0]; if (!cof) return ""; const ck = courseKnowledge(cof); return ` · <b style="color:${ck.stage === "training" ? "var(--accent2)" : "var(--accent)"}">${ck.stage === "training" ? "📚 TRAINING" : "🏋 TUNING"} ${ck.pct}%</b>`; })()}` : `<span class="chip" style="border-color:var(--accent2);color:var(--accent2)">🏟 COURSE</span> <span class="why">free roam — join an event or lap a marked loop; every attempt becomes a run</span>`;
        } else if (wf === "decode") {
          const pin = PIN(); const ls = liveSess(); const dc = pin ? ((ls && pin.sid === ls.id && car(ls, pin.key)) || (pin.data && car(pin.data, pin.key))) : null;
          html = `<span class="chip" style="border-color:#e3b341;color:#e3b341;font-weight:700">🧬 DECODE</span> ${dc ? `donor ${buildThumb(dc.ordinal, dc.build_id, true)} <b>${esc(carName(dc) || pin.name || "")}</b>${dc.decode ? ` · ${dc.decode.ready_n}/${dc.decode.total} tests${dc.decode.pct >= 1 && dc.clone_sheet ? " · 📋 sheet " + Math.round((dc.clone_sheet.confidence || 0) * 100) + "%" : ""}` : ""} · driving <b>${esc(carNm)}</b>${f.on ? "" : " (not driving)"}` : `no donor yet — drive the locked-tune car and <b>set as 🎯 DONOR</b> below · driving <b>${esc(carNm)}</b>`}`;
        } else {
          html = `<span class="chip" style="border-color:var(--accent);color:var(--accent);font-weight:700">🛣 FREE TUNING</span> ${f.on ? buildThumb(String(f.car), null, true) : ""} <b>${esc(carNm)}</b>${f.on ? ` ${piBadge(f.cls, f.pi, true)} · ${f.drv}` : " · not driving"}${an && an.summary ? ` · ${an.summary.corners} corners · ${an.summary.launches} launches · ${an.summary.braking} stops analysed` : ""}`;
        }
        if (wl.dataset.h !== html) { wl.dataset.h = html; wl.innerHTML = html; }
      }
      const tiles = host.querySelector("#lvTiles");
      if (tiles) { const dup = dockShouldShow();   // the anchored dock already shows this exact row — don't render it twice in one viewport (audit F5)
        tiles.style.display = dup ? "none" : ""; if (!dup) tiles.innerHTML = frameTiles(f).map(([v, l]) => `<div class="lab-tile"><b>${v}</b><span>${l}</span></div>`).join(""); }
      const inp = host.querySelector("#lvInputs");
      if (inp) inp.innerHTML = `<div style="display:grid;grid-template-columns:60px 1fr;gap:4px 8px;font-size:11px;align-items:center">
          <span>throttle</span><div class="lab-bar" style="height:8px"><i style="width:${f.thr / 2.55}%;background:#00d27a"></i></div>
          <span>brake</span><div class="lab-bar" style="height:8px"><i style="width:${f.brk / 2.55}%;background:#e5414e"></i></div>
          <span>steer</span><div class="lab-bar" style="height:8px"><i style="left:${50 + Math.min(50, Math.max(-50, f.steer / 2.54))}%;width:2px;background:#2f81f7"></i><i style="left:50%;width:1px;background:var(--muted)"></i></div>
          <span>susp</span><div style="display:flex;gap:4px">${f.susp.map((v, i) => `<div class="lab-bar" style="flex:1;height:8px" title="${W4[i]} ${v}"><i style="width:${v * 100}%;background:${v > 0.95 ? "#e5414e" : "#a371f7"}"></i></div>`).join("")}</div>
          <span>temp °F</span><span>${f.temp.map((v, i) => `${W4[i]} <b>${v}</b>`).join(" · ")}${f.hb ? " · <b style='color:#e3b341'>HANDBRAKE</b>" : ""}</span></div>`;
      paintDock();
    }
    const W4 = ["FL", "FR", "RL", "RR"];
    function paintStrip() { const el = host.querySelector("#lvStrip"); if (el) el.innerHTML = live.strip.length ? strip({ strip: live.strip.slice(-900), cars: live.cars, corners: (live.corners || []).slice(-80) }) : `<p class="why" style="font-size:11px">waiting for the first second…</p>`; paintDockStrip(); paintDock(); }
    function paintCorners() { const el = host.querySelector("#lvCorners"); if (el) el.innerHTML = live.corners.slice(-12).reverse().map((c) => cornerCard(liveS(), c)).join("") || `<p class="why" style="font-size:11px">no corners yet</p>`; }
    function paintAll(force) { paintStatus(); paintFrame(); paintStrip(); paintCorners(); paintBanner(); paintSections(force); paintCloneLauncher(); paintDock(force); paintSpeedTrace(); }
    function liveConnect() {
      if (es) { es.close(); es = null; }
      live.loaded = null; carSel = null;   // a (re)connect may be a different daemon / session — never carry a loaded session or a car filter across
      live.connected = false; live.err = false; paintStatus();
      try { es = new EventSource(liveUrl + "/events"); } catch (e) { live.err = true; paintStatus(); return; }
      es.addEventListener("snapshot", (e) => { const d = JSON.parse(e.data); live.strip = d.strip || []; live.corners = d.corners || []; live.cornerLog = []; (d.corners || []).forEach(pushCornerLog); live.cars = d.cars || []; live.session = d.session || null; live.analysis = d.analysis || null; live.stint = d.stint || 0; live.tags = d.tags || {}; live.loop = d.loop || null; if (d.mode) live.mode = d.mode; if (!d.analysis || live.loaded !== d.analysis.id) live.loaded = null; live.connected = true; live.err = false; live.diskCache = {}; live.diskTune = {}; live.diskDiff = null; paintAll(true); onModeChanged(); if (d.analysis) loadFullSession(); });
      es.addEventListener("stint", (e) => { const d = JSON.parse(e.data); live.stint = d.n; paintStatus(); });
      es.addEventListener("loop", (e) => { const d = JSON.parse(e.data); live.loop = d.name ? { name: d.name, lap: d.lap || 0, last_s: null } : null; paintStatus(); });
      es.addEventListener("lap", (e) => { const d = JSON.parse(e.data); if (live.loop) { live.loop = { name: d.loop, lap: d.lap, last_s: d.time_s }; } paintStatus(); });
      es.addEventListener("disk", (e) => {   // daemon pushed a fresh on-disk decode (car change or a new tune save)
        const d = JSON.parse(e.data); live.diskCache = live.diskCache || {}; live._diskGen = live._diskGen || {};
        const locked = live.cloneTarget && live.cloneTarget.ordinal === +d.ordinal;   // a save on the replica you're building must NOT touch the frozen target
        const pinned = live.diskPick && live.diskPick[d.ordinal] && String(d.ts) !== String(live.diskPick[d.ordinal]);   // the daemon emits the AUTO match — a manual save-pick must not be clobbered by it
        if (!pinned) { live.diskCache[d.ordinal] = d.available ? d : { available: false }; live._diskGen[d.ordinal] = (live._diskGen[d.ordinal] || 0) + 1; }   // gen bump: a stale in-flight fetch must not overwrite this fresher decode
        const changed = (!locked && d.available) ? applyDiskTune(d) : false;
        if (!locked && d.available) maybeFocusCourse(d.match, d.ordinal);
        if (!locked && d.new_save) live.diskDiff = d.diff ? { ordinal: d.ordinal, diff: d.diff, t: performance.now() } : null;   // set (or clear) the banner on every save
        if (d.new_save && live.liveryCache) delete live.liveryCache[d.ordinal];   // a save may bring a new/changed livery — refetch the gallery
        if (!locked && d.new_save && d.available && live.frame && String(live.frame.car) === String(d.ordinal) && live.frame.cid) abSync(live.frame.cid);   // a change was saved → spawn/refresh the A/B version NOW (stores the full field set; metrics fill on next analysis)
        paintDiskDecode(); paintFloat(); paintCloneLauncher(); paintDock(true);
        const activeOrd = live.frame && String(live.frame.car);
        if (!locked && d.available && effMode() !== "decode" && activeOrd === String(d.ordinal) && (changed || d.new_save)) paintSections(true);   // refresh tuning targets when the auto-fill newly applies (car change) or a save lands
      });
      es.addEventListener("tag", (e) => { const d = JSON.parse(e.data); live.tags = Object.assign({}, live.tags, { [String(d.n)]: { label: d.label, role: d.role } }); paintStatus(); });
      es.addEventListener("analysis", (e) => { live.analysis = JSON.parse(e.data); live._anGap = live.analysisAt ? Math.round((Date.now() - live.analysisAt) / 1000) : null; live.analysisAt = Date.now(); live.cornSince = []; if (live.dec) decReset(live.dec.cid); paintBanner(); loadFullSession(); });   // the analysis absorbed what the live tracker counted — start the live deltas again
      es.addEventListener("reset", () => { live.strip = []; live.corners = []; live.cornerLog = []; live.analysis = null; live.session = null; live.loaded = null; live.cars = []; carSel = null; donor = replica = null; live._donorPick = live._replicaPick = null; live.spd = []; live._spdSeg = 0; live.cornerScores = []; live.cornerBest = {}; paintAll(true); });
      es.addEventListener("config", (e) => { const c = JSON.parse(e.data); if (!live.cars.find((x) => x.id === c.id)) live.cars.push(c); paintStatus(); });
      fetch(liveUrl + "/cars-map").then((r) => r.json()).then((m) => { live.names = (m && m.cars) || {}; paintStatus(); }).catch(() => {});
      es.addEventListener("frame", (e) => { live.frame = JSON.parse(e.data); paintFrame(); });
      es.addEventListener("strip", (e) => { live.strip.push(JSON.parse(e.data)); paintStrip(); });
      es.addEventListener("corner", (e) => { const c = JSON.parse(e.data); live.corners.push(c); (live.cornSince = live.cornSince || []).push(c); pushCornerLog(c); pushCornerScore(c); paintCornerScore(); paintLastOnMap((live.cornerScores || []).slice(-1)[0]); paintCorners(); decOnCorner(c); paintDecNext(); paintCornerAnalysis(); const now = Date.now(); if ((effMode() === "course" || effMode() === "free") && now - (live._lastCornPaint || 0) > 4000) { live._lastCornPaint = now; paintSections(); } });
      es.addEventListener("status", (e) => { live.status = JSON.parse(e.data); if (live.status.cars) live.cars = live.status.cars; live.connected = true; live.err = false;
        const sm = live.status.mode; const changed = sm && (!live.mode || sm.suggest !== live.mode.suggest || sm.reason !== live.mode.reason);   // status carries the current mode every second — authoritative after reconnects / daemon restarts
        if (changed) live.mode = sm;
        const gm = live.status.game; const gameChanged = gm !== live._game; live._game = gm;
        paintStatus(); pushMode(); if (changed) onModeChanged(); else if (gameChanged) paintBanner(); });
      es.addEventListener("mode", (e) => { live.mode = JSON.parse(e.data); onModeChanged(); });
      es.addEventListener("session", (e) => { live.session = JSON.parse(e.data); paintStatus(); loadFullSession(); });
      es.onerror = () => { live.connected = false; live.err = true; paintStatus(); paintDock(true); };   // the dock must not keep claiming LIVE over frozen numbers (audit F19)
    }
    function liveReset(local) {
      live.strip = []; live.corners = []; live.analysis = null; live.session = null; live.loaded = null; live.frame = null; live.cars = []; carSel = null; donor = replica = null; live._donorPick = live._replicaPick = null;
      if (!local && live.connected) fetch(liveUrl + "/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
      render();
    }
    function bindLive() {
      const b = host.querySelector("#lvConnect"), u = host.querySelector("#lvUrl"), r = host.querySelector("#lvReset");
      if (b) b.addEventListener("click", () => { liveUrl = u.value.trim().replace(/\/$/, ""); localStorage.setItem("fh6LiveUrl", liveUrl); liveConnect(); });
      if (r) r.addEventListener("click", () => { if (confirm("Start a fresh recording? This clears the live screen and begins a new session on the daemon. Your pinned donor and course records are kept.")) liveReset(false); });
      const g = host.querySelector("#lvConnGear"); if (g) g.addEventListener("click", () => { const row = host.querySelector("#lvConnRow"); if (row) row.style.display = row.style.display === "none" ? "flex" : "none"; });
    }
    // ---- Lab axes: SOURCE (🔴 live stream | 📼 recording) × WORKFLOW (🏟 Course | 🧬 Decode | 🛣 Free Tuning) ----
    // Live: the workflow is auto-detected by the daemon (Rivals / race / loop → Course · donor flagged → Decode · else Free) unless you click a tab (manual, until 🧭 auto).
    // Recording: you pick the workflow; the same section renderers run on the recorded session.
    let src = localStorage.getItem("fh6LabSrc") || "live";
    const WFS = [["course", "🏟 Course", "COURSE", "course profile (incl. what it never uses) · every turn quantified & classified · lap deltas per run · driver-vs-tune · course-weighted suggestions"], ["decode", "🧬 Decode", "DECODE", "clone a build: donor capture → decode progress (tests only) → Clone Sheet → Bench convergence"], ["free", "🛣 Free Tuning", "FREE TUNING", "whole-session advisor · live instruments · runs · launch / brake / gear / dyno test cards"]];
    const labModeSel = () => localStorage.getItem("fh6LabMode") || "auto";        // live workflow: auto | course | decode | free
    const sessWf = () => localStorage.getItem("fh6LabWfSession") || "course";      // recording workflow: course | decode | free
    const effMode = () => (src === "live" ? liveEffMode() : sessWf());
    const courseMode = () => effMode() === "course";
    const decodeMode = () => effMode() === "decode";
    const tabsHtml = () => { const em = effMode(); const auto = src === "live" && labModeSel() === "auto"; const cur = WFS.find((w) => w[0] === em) || WFS[2]; return WFS.map(([k, l, , tip]) => `<button class="lab-mode ${em === k ? "active" : ""}" data-wf="${k}" title="${esc(tip)}">${l}</button>`).join("") + (src === "live" ? `<button class="lab-mode" data-wf="auto" title="detected from the stream: timed event (Rivals / race) → Course · lapping a marked loop → Course · donor / replica flagged → Decode · otherwise Free Tuning" style="margin-left:6px;border-color:${auto ? "var(--accent2)" : "var(--muted)"};color:${auto ? "var(--accent2)" : "var(--muted)"}">🧭 auto${auto ? " → " + cur[2] : " off — manual"}</button>` : ""); };
    const bindTabs = () => host.querySelectorAll("[data-wf]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.wf; if (src === "live") { localStorage.setItem("fh6LabMode", k); pushMode(); renderBody(); } else { localStorage.setItem("fh6LabWfSession", k); render(); } }));
    const paintTabs = () => { const sp = host.querySelector("#labWf"); if (sp) { sp.innerHTML = tabsHtml(); bindTabs(); } };
    const paintModeChips = paintTabs;   // compat name used by the snapshot handler
    // a live workflow change (auto-detected) rebuilds only the body; anything else is a targeted repaint — the stream bar's typed inputs are never wiped
    const onModeChanged = () => { pushMode(); if (src === "live" && effMode() !== live._shownWf) renderBody(); else { paintTabs(); paintBanner(); paintStatus(); } };
    function bindBody(root) {
      const r = root || host;
      bindTraceHover(r);   // trace → map scrubbing survives every innerHTML rebuild
      r.querySelectorAll("[data-rivals]").forEach((b) => b.addEventListener("click", () => { const [rk, v] = b.dataset.rivals.split("|");
        fetch(liveUrl + "/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route_key: rk, rivals: v === "1" }) })
          .then(() => { if (src === "live") paintSections(true); else render(); }).catch(() => {}); }));
      r.querySelectorAll("[data-car]").forEach((b) => b.addEventListener("click", () => { carSel = b.dataset.car === "all" ? null : b.dataset.car; if (src === "live") paintSections(); else render(); }));
      r.querySelectorAll("[data-donor]").forEach((b) => b.addEventListener("click", () => { donor = b.dataset.donor; if (src === "live") { live._donorPick = donor; const ls = liveSess(); const p = PIN(); pinDonor(ls && car(ls, donor) ? ls : (p && p.data && car(p.data, donor) ? p.data : null), donor); paintSections(true); paintBanner(); } else render(); }));
      bindAtlas(r);
      r.querySelectorAll("[data-tunecid]").forEach((inp) => inp.addEventListener("change", () => { setTune(inp.dataset.tunecid, inp.dataset.tunesl, inp.value); if (src === "live") paintSections(true); else render(); }));
      // interactive tune iteration: mark a move done (sets current=target + starts a fresh run), un-mark, re-test, clear
      /* J16: cid itself contains "|" — split on a safe delimiter; this button was dead since birth */
      r.querySelectorAll("[data-apply]").forEach((b) => b.addEventListener("click", () => { const [cid, sl, to] = b.dataset.apply.split("@@"); markApplied(cid, sl, to); fetch(liveUrl + "/new-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}); if (src === "live") paintSections(true); else render(); }));
      r.querySelectorAll("[data-unapply]").forEach((b) => b.addEventListener("click", () => { const [cid, sl] = b.dataset.unapply.split("@@"); unApply(cid, sl); if (src === "live") paintSections(true); else render(); }));
      r.querySelectorAll("[data-retest]").forEach((b) => b.addEventListener("click", () => { b.textContent = "🔁 re-analysing…"; b.disabled = true; fetch(liveUrl + "/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}); }));
      r.querySelectorAll("[data-clearapplied]").forEach((b) => b.addEventListener("click", () => { if (!b.dataset.arm) { b.dataset.arm = "1"; const t0 = b.textContent; b.textContent = "really clear the history?"; setTimeout(() => { delete b.dataset.arm; b.textContent = t0; }, 4000); return; } localStorage.removeItem(appliedKey(b.dataset.clearapplied)); if (src === "live") paintSections(true); else render(); }));   // audit F9: two-step
      // build-confirm gate: confirm (unlocks course tuning advice) / re-check (drops the confirmation)
      r.querySelectorAll("[data-confirmbuild]").forEach((b) => b.addEventListener("click", () => { setBuildConfirmed(b.dataset.confirmbuild, true); try { const c0 = (live.diskCache || {})[String(b.dataset.confirmbuild).split("|")[0]]; localStorage.setItem("fh6BuildOKevi:" + baseId(b.dataset.confirmbuild), confirmRegressReason(c0 || null) || ""); localStorage.removeItem("fh6BuildRegressed:" + baseId(b.dataset.confirmbuild)); } catch (e) {} live._regrToast = null; if (src === "live") paintSections(true); else render(); }));
      r.querySelectorAll("[data-unconfirmbuild]").forEach((b) => b.addEventListener("click", () => { setBuildConfirmed(b.dataset.unconfirmbuild, false); try { localStorage.removeItem("fh6BuildOKevi:" + baseId(b.dataset.unconfirmbuild)); } catch (e) {} if (src === "live") paintSections(true); else render(); }));
      const shopEl = r.querySelector("#lvShopCapture") || (r.id === "lvShopCapture" ? r : null);
      if (shopEl && !live.shots) refreshShots();
      const sref = r.querySelector("#lvShotRefresh"); if (sref) sref.addEventListener("click", refreshShots);
      r.querySelectorAll("[data-shot]").forEach((im) => im.addEventListener("click", () => { shotEnlarged = shotEnlarged === im.dataset.shot ? null : im.dataset.shot; const el = host.querySelector("#lvShopCapture"); if (el) { el.innerHTML = shopCaptureInner(el.dataset.cid); bindBody(el); } }));
      r.querySelectorAll("[data-shot-close]").forEach((b) => b.addEventListener("click", () => { shotEnlarged = null; const el = host.querySelector("#lvShopCapture"); if (el) { el.innerHTML = shopCaptureInner(el.dataset.cid); bindBody(el); } }));
      r.querySelectorAll("[data-shopcid]").forEach((inp) => inp.addEventListener("change", () => { const body = { cid: inp.dataset.shopcid, value: inp.value.trim() || null }; if (inp.dataset.shoppane) body.pane_key = inp.dataset.shoppane; else { body.menu = inp.dataset.shopmenu; body.slot = inp.dataset.shopslot; } if (shotEnlarged) body.shot = shotEnlarged;
        fetch(liveUrl + "/build-field", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r2) => r2.json()).then((res) => { if (res.ok !== false) { inp.style.borderColor = "#00d27a"; inp.title = "saved ✓ — re-analyses shortly"; } }).catch(() => {}); }));
      r.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => { const rl = b.dataset.role; const n = live.stint || (live.frame && live.frame.stint) || 0; if (!n) return;
        fetch(liveUrl + "/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: rl, stint: n }) }).then(() => {
          live.tags = Object.assign({}, live.tags); Object.keys(live.tags).forEach((k) => { if (live.tags[k] && live.tags[k].role === rl) live.tags[k] = Object.assign({}, live.tags[k], { role: null }); }); live.tags[String(n)] = Object.assign({}, live.tags[String(n)], { role: rl });
          if (rl === "donor") { const ls = liveSess(); const cidNow = live.frame && live.frame.cid; if (ls && cidNow) { live._donorPick = null; pinDonor(ls, cidNow + "#" + n); } }
          paintStatus(); if (src === "live") paintSections(true); else render();
        }).catch(() => {});
      }));
      r.querySelectorAll("[data-course-stage]").forEach((b) => b.addEventListener("click", () => { localStorage.setItem("fh6CourseStage", b.dataset.courseStage); if (src === "live") paintSections(true); else render(); }));
      // click a turn on the course map -> open its per-turn breakdown (the ✕ closes it)
      r.querySelectorAll("[data-courseturn]").forEach((g) => g.addEventListener("click", () => { const parts = String(g.dataset.courseturn).split("|"); live.selTurn = { rk: parts[0], n: +parts[1] }; if (src === "live") paintSections(true); else render(); }));
      r.querySelectorAll("[data-courseturn-close]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); live.selTurn = null; if (src === "live") paintSections(true); else render(); }));
      r.querySelectorAll("[data-expected]").forEach((b) => b.addEventListener("click", () => { const [rk, n] = b.dataset.expected.split("|"); fetch(liveUrl + "/course-expected", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route_key: rk, n: +n }) }).then(() => { b.textContent = "saved ✓"; }).catch(() => {}); }));
      r.querySelectorAll("[data-lib-pick]").forEach((b) => b.addEventListener("click", () => { const [sid, key] = b.dataset.libPick.split("|"); libPick = { sid, key }; donor = key; render(); }));
      r.querySelectorAll("[data-lib-clear]").forEach((b) => b.addEventListener("click", () => { libPick = null; donor = null; render(); }));
      r.querySelectorAll("[data-unpin]").forEach((b) => b.addEventListener("click", () => {
        // unpin = un-donor: if the pinned donor is a run of the CURRENT live session, clear its 🎯 role too (else the role would re-pin it at once)
        const p = PIN(); const ls = liveSess(); const n = p ? stintOf(p.key) : null;
        if (p && ls && p.sid === ls.id && n != null && live.connected) { fetch(liveUrl + "/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: null, stint: n }) }).catch(() => {}); if (live.tags && live.tags[String(n)]) live.tags[String(n)] = Object.assign({}, live.tags[String(n)], { role: null }); const st = (ls.stints || []).find((x) => x.n === n); if (st) st.role = null; }
        unpinDonor(); paintSections(true); paintBanner(); paintStatus();
      }));
      r.querySelectorAll("[data-replica]").forEach((b) => b.addEventListener("click", () => { replica = b.dataset.replica; if (src === "live") { live._replicaPick = replica; paintSections(true); } else render(); }));
      bindNames(r);
      r.querySelectorAll("[data-saveroute]").forEach((b) => b.addEventListener("click", () => {
        const wrap = b.closest(".lab-route"); const v = wrap.querySelector("input").value.trim(); if (!v) return;
        const key = wrap.dataset.key; const loc = JSON.parse(localStorage.getItem("fh6Routes") || "{}"); loc[key] = { name: v }; localStorage.setItem("fh6Routes", JSON.stringify(loc));
        fetch(liveUrl + "/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route_key: key, name: v, mode: wrap.dataset.mode }) }).catch(() => {});
        if (src === "live") paintSections(); else render();
      }));
      // DOUBLE-CLICK the course title to name it on the spot (same persistence as the Atlas: localStorage + POST /route)
      r.querySelectorAll("[data-nameroute]").forEach((el) => el.addEventListener("dblclick", (e) => {
        e.preventDefault(); if (el.querySelector("input")) return;
        const key = el.dataset.nameroute, cur = el.dataset.curname || "", mode = el.dataset.namemode || null;
        const inp = document.createElement("input"); inp.type = "text"; inp.value = cur; inp.className = "course-id-nameinput"; inp.placeholder = "name this course…"; inp.maxLength = 80;
        el.textContent = ""; el.appendChild(inp); inp.focus(); inp.select();
        let done = false;
        const finish = (commit) => { if (done) return; done = true; const v = inp.value.trim();
          if (commit && v) { const loc = JSON.parse(localStorage.getItem("fh6Routes") || "{}"); loc[key] = { name: v }; localStorage.setItem("fh6Routes", JSON.stringify(loc));
            fetch(liveUrl + "/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route_key: key, name: v, mode }) }).catch(() => {}); }
          if (src === "live") paintSections(true); else render();   // re-render either way (restores the title on cancel)
        };
        inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); finish(true); } else if (ev.key === "Escape") { ev.preventDefault(); finish(false); } });
        inp.addEventListener("blur", () => finish(true));
        inp.addEventListener("click", (ev) => ev.stopPropagation());
      }));
    }
    function renderBody() {   // live only: rebuild the workflow body beneath the stream bar
      const body = host.querySelector("#lvBody"); if (!body || src !== "live") { render(); return; }
      live._shownWf = effMode(); body.innerHTML = liveBody(); bindBody(body); paintTabs(); paintAll();
    }
    function render() {
      const s = S(); const SRCS = [["live", "🔴 Live stream"], ["session", "📼 Recording"]];
      host.innerHTML = `
        <h2 class="section-title" style="margin-top:0;border-top:none;padding-top:0">📡 Telemetry Lab — Data Out</h2>
        <div class="lab-top">
          <div class="lab-modes" style="margin-bottom:4px"><span class="why" style="font-size:11px;margin-right:2px">source</span>${SRCS.map(([k, l]) => `<button class="lab-mode ${src === k ? "active" : ""}" data-src="${k}">${l}</button>`).join("")}
            ${src === "session" ? (sessions.length > 1 ? `<select id="labSess">${sessions.map((x, i) => `<option value="${i}" ${i === sIdx ? "selected" : ""}>${x.id}</option>`).join("")}</select>` : s ? `<span class="chip">${s.id} · ${s.frames} frames · ${s.duration_s}s</span>` : "") : ""}</div>
          <div class="lab-modes"><span class="why" style="font-size:11px;margin-right:2px">workflow</span><span id="labWf" style="display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center">${tabsHtml()}</span></div>
          ${src === "live" ? `<div class="lab-live-state"><span class="dot"></span><span id="lvStatus" class="chip">connecting…</span><span id="lvWfLine"></span><span class="lab-live-ctrls"><button class="lab-mode" id="lvReset" title="Start a fresh recording — clears the live screen and begins a new session/CSV. Your pinned donor and course records are kept." style="padding:2px 8px;font-size:11px;border-color:#e5414e;color:#e5414e">↺ new</button><span class="chip" id="lvConnGear" title="connection settings" style="cursor:pointer;padding:2px 7px">⚙</span></span></div><div class="lab-sys" id="lvSysStatus"></div>` : ""}
        </div>
        ${src === "live" ? `${streamBar()}<div id="lvBody">${liveBody()}</div>` : !s ? NOSESS : sectionsHtml(s, false)}`;
      live._shownWf = effMode();
      host.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => { src = b.dataset.src; localStorage.setItem("fh6LabSrc", src); carSel = null; donor = replica = null; render(); }));   // run picks ('cid#n') never carry across sources — run numbers restart per session
      bindTabs(); bindBody(host);
      const sel = host.querySelector("#labSess"); if (sel) sel.addEventListener("change", () => { sIdx = +sel.value; carSel = null; donor = replica = null; render(); });
      if (src === "live") { bindLive(); if (!es) liveConnect(); else paintAll(); ensureFloatHost(); paintFloat(); }
      paintDock(true);
    }
    ensureFloatHost(); ensureDockHost();
    // the dock only shows on the Lab tab — repaint it whenever #lab gains/loses .active (tab switch or hash nav)
    (() => { const lab = document.getElementById("lab"); if (lab && !lab._dockObs) { const o = new MutationObserver(() => paintDock(true)); o.observe(lab, { attributes: true, attributeFilter: ["class"] }); lab._dockObs = o; } })();
    render();
  }

  // ---- Function registry: every quantitative model, one notation ----
  function buildFormulas() {
    const F = DB.formulas;
    const host = document.getElementById("formulaContent");
    if (!F || !host) return;
    const TIER = {
      physics: ["conf-verified", "⚙️ physics", "standard vehicle dynamics — holds regardless of the game"],
      fitted: ["conf-verified", "📐 fitted", "physics-shaped model fitted to in-game readouts"],
      heuristic: ["conf-probable", "🟡 heuristic", "invented here to compress experience — directional, not a law"],
      refuted: ["conf-contested", "❌ refuted", "believed, then disproved — kept so it is not re-derived"],
    };
    const fcard = (f) => {
      const t = TIER[f.tier] || TIER.heuristic;
      const bands = f.output && f.output.bands
        ? `<table class="fx-bands"><tbody>${f.output.bands.map((b) => `<tr><td><code>${b.range}</code></td><td class="why">${b.read}</td></tr>`).join("")}</tbody></table>` : "";
      const ins = (f.inputs || []).map((i) => `<tr><td><code>${i.sym}</code></td><td class="why">${i.units || ""}</td><td class="why">${i.domain || i.typical || ""}</td><td class="why">${i.read_from || ""}</td></tr>`).join("");
      return `<div class="block" id="fn-${f.id}" style="border-color:${f.tier === "refuted" ? "#e5414e" : f.tier === "heuristic" ? "var(--warn,#e3b341)" : "var(--accent)"}">
        <div class="card-row" style="margin-top:0">
          <h3 style="margin:0">${f.name}</h3>
          <span class="conf ${t[0]}" title="${t[2]}">${t[1]}</span>
        </div>
        <code class="fx-sig">${f.signature || f.id}</code>
        <pre class="fx-expr">${f.expression || ""}</pre>
        ${ins ? `<table class="fx-in"><thead><tr><th>input</th><th>units</th><th>domain</th><th>read from</th></tr></thead><tbody>${ins}</tbody></table>` : ""}
        ${f.output ? `<p class="why"><strong>Output — ${f.output.name}${f.output.units ? ` (${f.output.units})` : ""}:</strong> ${f.output.meaning || ""}</p>${bands}` : ""}
        ${f.basis ? `<p class="why"><strong>Basis:</strong> ${f.basis}</p>` : ""}
        ${f.worked_example ? `<div class="fx-eg"><strong>Worked example</strong><pre>${f.worked_example}</pre></div>` : ""}
        ${f.why_refuted ? `<p class="why" style="color:#e5414e"><strong>Why refuted:</strong> ${f.why_refuted}</p>` : ""}
        ${f.status ? `<p class="why" style="color:var(--warn,#e3b341)"><strong>Status:</strong> ${f.status}</p>` : ""}
        ${f.note ? `<p class="why"><strong>Note:</strong> ${f.note}</p>` : ""}
        ${f.caveats ? `<p class="why"><strong>Caveats:</strong> ${f.caveats}</p>` : ""}
        ${f.used_by ? `<p class="why" style="font-size:11px">Used by: ${f.used_by.join(" · ")}</p>` : ""}
      </div>`;
    };
    host.innerHTML = `
      <p class="hint">${F.purpose}</p>
      <div class="block" style="border-color:var(--accent2)">
        <h3>📏 Notation &amp; units</h3>
        <p class="why">${F.notation.convention}</p>
        <div style="overflow-x:auto"><table><thead><tr><th>symbol</th><th>quantity</th><th>units</th><th>where it comes from</th></tr></thead>
          <tbody>${F.notation.symbols.map((s) => `<tr><td><code>${s.sym}</code></td><td>${s.name}</td><td class="why">${s.units}${s.value ? ` = ${s.value}` : ""}</td><td class="why">${s.source || s.meaning || ""}</td></tr>`).join("")}</tbody></table></div>
        <div class="tz-3col" style="margin-top:10px">${Object.entries(F.notation.tiers).map(([k, v]) => `<div><strong>${(TIER[k] || ["", k])[1]}</strong><p class="why" style="font-size:12px;margin:3px 0 0">${v}</p></div>`).join("")}</div>
      </div>
      <div class="chips" style="margin:10px 0">${F.functions.map((f) => `<a class="chip" href="#fn-${f.id}">${f.name}</a>`).join("")}</div>
      ${F.functions.map(fcard).join("")}
      <div class="block"><h3>🧹 Housekeeping</h3><p class="why">${F.housekeeping.rule}</p><p class="why">${F.housekeeping.refuted_kept_deliberately}</p></div>`;
  }

  // ---- init ----
  render();
  buildWheelspin();
  buildProgress();
  buildTable();
  buildVariables();
  buildStrategy();
  buildTemplates();
  buildRivals();
  buildDrift();
  buildTouge();
  buildEliminator();
  buildTuners();
  buildTuneLab();
  buildTraining();
  buildFormulas();
  buildLab();
  // deep links: #<tab> opens a tab, #lab-live / #lab-session pick the Telemetry Lab source
  const applyHash = () => {
    const h = (location.hash || "").slice(1); if (!h) return;
    const [tab, sub] = h.split("-");
    const b = document.querySelector(`.tab[data-tab="${tab}"]`); if (b) b.click();
    if (tab === "lab" && (sub === "live" || sub === "session")) { const m = document.querySelector(`#labContent2 [data-src="${sub}"]`); if (m) m.click(); }
  };
  applyHash(); window.addEventListener("hashchange", applyHash);
  const allCodesBtn = document.getElementById("allCodesBtn");
  if (allCodesBtn) allCodesBtn.addEventListener("click", openTuneCodesOverlay);
})();
