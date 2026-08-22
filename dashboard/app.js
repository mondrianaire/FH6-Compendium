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
        <dt>Class</dt><dd>${clsBadge(c.class, true)} <span class="why" style="font-size:12px">(PI ${classes[c.class] || "span"})</span></dd>
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
          <td>${r.pi}</td><td>${r.drivetrain || ""}</td>
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
    const clsTier = (c) => /S2|S1|^R$/.test(c) ? "S" : c === "A" ? "A" : "B";
    const clsBadge = (c) => `<span class="badge tier-${clsTier(c)}">${c}</span>`;
    const conf = (c) => `<span class="conf ${confClass(c)}">${confLabel(c)}</span>`;
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
            <div class="card-row" style="margin-top:0"><h4 style="margin:0">${e.name} ${clsBadge(e.class)} <span class="why" style="font-size:11px">≤${e.cap} · ${e.length_mi}mi · ${e.laps || 1} lap · ${e.region}</span></h4>${dirTag(e.direction || "")}</div>
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
        <p class="why" style="margin-top:8px">${list.length} of ${all.length} codes${list.length > CAP ? ` (showing first ${CAP} — refine search)` : ""}${clsFilter ? " · " + clsFilter : ""}${discFilter ? " · " + discFilter : ""}${q ? ' · "' + q + '"' : ""}.</p>`;
    }
    const chip = (val, cur, cls) => `<button class="chip ${cls}" data-v="${val}" style="cursor:pointer;${val === cur ? "border-color:var(--accent);color:var(--accent)" : ""}">${val || "All"}</button>`;

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
    const extraRows = extraFe.map((c) => `<tr><td>${c.year} ${c.manufacturer} ${c.model.replace(/ ?forza edition/i, " FE")}</td><td><span class="badge tm-meta">✓ OWNED</span></td><td class="why" style="font-size:12px">${c.class ? clsBadge(c.class) : ""} ${c.pi || ""} — beyond the cross-source roster</td></tr>`).join("");

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
      if (L === "all") return TZ_C.bad;
      if (L === "limit") return TZ_C.warn;
      if (L === which) return TZ_C.bad;
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
    const zoneCol = { muted: "#2a313c", good: "#00d27a", mixed: "#e3b341", drift: "#e5414e" };
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
      const stCol = { calm: "#2a313c", front: "#2f81f7", rear: "#e5414e", both: "#a371f7", spike: "#e3b341" };
      const stLbl = { calm: "within grip", front: "fronts saturated — understeer", rear: "rears saturated — oversteer", both: "all four — drift/overdriven", spike: "impact / physics jolt (discard)" };
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
    const ST = { calm: "#2a313c", front: "#2f81f7", rear: "#e5414e", both: "#a371f7", impact: "#e3b341", off: "#0b0e12" };
    const STL = { calm: "within grip", front: "fronts past the limit", rear: "rears past the limit", both: "all four — drift / overdriven", impact: "impact / jolt", off: "not driving" };
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
    const carCol = (s, o) => CARC[Math.max(0, s.cars.findIndex((c) => c.id === baseId(o) || String(c.ordinal) === baseId(o))) % CARC.length];
    const candidates = (c) => { const own = ((DB.ownedCars || {}).cars || []); const same = own.filter((x) => x.class === c.class && String(x.pi) === String(c.pi)); const cls = own.filter((x) => x.class === c.class && !same.includes(x)); return [...same, ...cls].map((x) => `${x.year} ${x.manufacturer} ${x.model}`); };
    const nameUI = (c) => carName(c) ? "" : `<div class="lab-name" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="chip" style="border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)">🏷 unknown car #${c.ordinal}</span><input list="cands-${c.ordinal}" placeholder="which car is this? (${c.class} ${c.pi} ${c.drivetrain})" style="min-width:230px;padding:4px 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:12px"><datalist id="cands-${c.ordinal}">${candidates(c).slice(0, 60).map((n) => `<option value="${esc(n)}">`).join("")}</datalist><button class="lab-mode" data-savename="${c.ordinal}" style="padding:4px 10px;font-size:12px">save</button></div>`;
    const sigChips = (c) => c.sig ? `<div class="chips" style="margin-top:4px">${[["build", c.build_id], ["max rpm", c.max_rpm], ["boost", c.sig.boost_max + " psi"], ["peak", c.sig.hp_peak ? `${c.sig.hp_peak} hp @ ${c.sig.rpm_at_peak}` : "—"], ["gears", c.sig.gear_count], ["mass idx", c.sig.mass_idx ?? "—"], ["group", c.car_group]].map(([k, v]) => `<span class="chip" title="${k}">${k} <b>${v}</b></span>`).join("")}</div>` : "";
    function bindNames(root) {
      (root || host).querySelectorAll("[data-savename]").forEach((b) => b.addEventListener("click", () => {
        const wrap = b.closest(".lab-name"); const v = wrap.querySelector("input").value.trim(); if (!v) return; const ord = b.dataset.savename;
        const loc = JSON.parse(localStorage.getItem("fh6CarNames") || "{}"); loc[ord] = { name: v }; localStorage.setItem("fh6CarNames", JSON.stringify(loc));
        if (live.connected) fetch(liveUrl + "/car", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ordinal: ord, name: v }) }).catch(() => {});
        render();
      }));
    }
    const fmt = (v, d = 2) => (v == null ? "—" : (+v).toFixed(d));
    const esc = (t) => String(t).replace(/"/g, "&quot;");
    // tiny SVG line chart: series = [{pts:[[x,y]...], col, label}]
    const chart = (series, o = {}) => {
      const w = o.w || 380, h = o.h || 130, L = 36, B = 22, R = 8, T = 8;
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
      const n = s.strip.length, W = 900, cw = W / n;
      return `<svg viewBox="0 0 ${W} 70" class="tz-svg tz-wide" role="img" aria-label="Session strip">
        ${s.strip.map((x, i) => `<g><rect x="${(i * cw).toFixed(2)}" y="6" width="${Math.max(cw - 0.3, 0.6).toFixed(2)}" height="40" fill="${ST[x.state]}" opacity="${x.state === "off" ? 1 : x.state === "calm" ? .6 : .95}"><title>${x.t}s — ${STL[x.state]}${x.mph != null ? ` · ${x.mph} mph · F ${x.f} R ${x.r} · ${x.g} g` : ""}${x.car ? ` · ${carLbl(s, x.car)}` : ""}</title></rect>
          ${x.car ? `<rect x="${(i * cw).toFixed(2)}" y="48" width="${Math.max(cw - 0.3, 0.6).toFixed(2)}" height="5" fill="${carCol(s, x.car)}"/>` : ""}
          ${x.t % 60 === 0 ? `<text x="${(i * cw).toFixed(1)}" y="66" fill="var(--muted)" font-size="9">${Math.floor(x.t / 60)}:00</text>` : ""}</g>`).join("")}
      </svg>
      <div class="chips" style="margin-top:2px">${Object.keys(ST).map((k) => `<span class="chip" style="border-color:${ST[k]};color:${k === "calm" || k === "off" ? "var(--muted)" : ST[k]}">${STL[k]}</span>`).join("")}</div>`;
    }
    function cornerCard(s, c) {
      const cell = cellFor(c);
      const fr = c.first_red;
      return `<div class="lab-corner" style="border-left:4px solid ${carCol(s, c.car)}">
        <div class="card-row" style="margin-top:0"><strong>${c.dir === "L" ? "⬅" : "➡"} ${c.t0}s · ${c.mph_in}→${c.mph_min} mph · ${c.lat_g_peak} g</strong>
          <span>${c.stint ? `<span class="chip" title="run">run ${c.stint}</span> ` : ""}${c.drift ? `<span class="chip" style="border-color:#a371f7;color:#a371f7">drift</span>` : fr ? `<span class="chip" style="border-color:${CM_PC[(c.kink ? 5 : fr.phase) - 1]};color:${CM_PC[(c.kink ? 5 : fr.phase) - 1]}">first red: ${fr.axle} · ph ${c.kink ? 5 : fr.phase}</span>` : `<span class="chip">no saturation</span>`}</span></div>
        <div class="lab-ph">${c.phases.map((p) => `<div style="border-color:${CM_PC[p.phase - 1]}" title="${esc(CM_SHORT[p.phase - 1])} · ${p.dur}s">
            <span style="color:${CM_PC[p.phase - 1]};font-weight:700">${p.phase}</span> F <b style="color:${p.front > 1 ? "#e5414e" : "inherit"}">${p.front}</b><div class="lab-bar"><i style="width:${Math.min(100, p.front * 50)}%;background:${p.front > 1 ? "#2f81f7" : "#566173"}"></i></div>
            R <b style="color:${p.rear > 1 ? "#e5414e" : "inherit"}">${p.rear}</b><div class="lab-bar"><i style="width:${Math.min(100, p.rear * 50)}%;background:${p.rear > 1 ? "#e5414e" : "#566173"}"></i></div></div>`).join("")}</div>
        <p class="why" style="font-size:11px;margin:6px 0 0">USI <b>${c.usi > 0 ? "+" : ""}${c.usi}</b> ${c.usi > 0.15 ? "→ understeer" : c.usi < -0.05 ? "→ oversteer" : "→ balanced"}${c.hb ? " · handbrake" : ""}${c.brake_max > 200 ? " · hard brake" : ""}</p>
        ${cell && !c.drift ? `<p class="why" style="font-size:11px;margin:4px 0 0"><strong>${cell.name}</strong> — ${cell.fix}</p>` : ""}
      </div>`;
    }
    // ---- WORKFLOW sections — rendered from a session object (a recording, or the live session's latest analysis); isLive adds live hints ----
    const arr = (s, k) => (s && Array.isArray(s[k]) ? s[k] : []);
    const EMPTY_LIVE = `<div class="block"><p class="why" style="font-size:12px;margin:0">first analysis lands after ~20 s of driving — the stream bar above is already live</p></div>`;
    const routeName = (key, fallback) => (((((DB.routes || {}).routes) || {})[key] || {}).name) || (JSON.parse(localStorage.getItem("fh6Routes") || "{}")[key] || {}).name || fallback;
    function eventsTable(s) {
      const ev = arr(s, "events"); if (!ev.length) return "";
      return `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏆 Events — timed modes detected (races · Rivals · time trials · reference-loop laps)</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>window</th><th>car</th><th>mode</th><th>laps</th><th>length</th><th>best lap</th><th>final pos</th><th>route</th></tr></thead><tbody>
            ${ev.map((e) => { const rn = e.route || routeName(e.route_key, null); return `<tr style="border-left:3px solid ${carCol(s, e.car)}"><td>${e.t0}–${e.t1}s (${e.duration_s}s)</td><td>${carLbl(s, e.car).split(" · ").slice(0, 2).join(" · ")}</td><td>${e.mode}</td><td>${e.laps || "—"}</td><td>${(e.distance_m / 1000).toFixed(2)} km</td><td>${e.best_lap ? e.best_lap.toFixed(3) + " s" : "—"}</td><td>${e.pos_final ?? "—"}</td><td>${rn ? `<b>${esc(rn)}</b>` : `<span class="lab-route" data-key="${e.route_key}" data-mode="${esc(e.mode)}"><input placeholder="name this route (start ${(e.start || []).join(",")})" style="min-width:180px;padding:3px 6px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:11px"> <button class="lab-mode" data-saveroute style="padding:3px 8px;font-size:11px">save</button></span>`}</td></tr>`; }).join("")}
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
          ${rel ? `<div style="padding:6px 8px;border:1px solid var(--accent);border-radius:8px"><div><b style="color:var(--accent)">${esc(lbl(rel.sel))}</b> <span class="why">· ${rel.sel.geometry.length_m} m · ${(rel.sel.geometry.turns || []).length} turns · ${rel.sel.laps || 0} laps</span> <span class="chip" data-atlas-clear="1" style="cursor:pointer;padding:1px 6px">✕ clear</span></div>
            <div style="margin-top:4px"><b>${rel.sameStart.size}</b> other route${rel.sameStart.size === 1 ? "" : "s"} start${rel.sameStart.size === 1 ? "s" : ""} at this hub · <b>${rel.follows.size}</b> follow${rel.follows.size === 1 ? "s" : ""} its path</div>
            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${relList.map((m) => `<span class="chip" data-atlas-route="${esc(m.route_key)}" style="cursor:pointer;border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)" title="click to select">${esc(lbl(m)).slice(0, 24)} · ${rel.sameStart.has(m.route_key) ? "same start" : ""}${rel.sameStart.has(m.route_key) && rel.follows.has(m.route_key) ? " · " : ""}${rel.follows.has(m.route_key) ? Math.round(rel.ov[m.route_key] * 100) + "% on path" : ""}</span>`).join("") || `<span class="why">no other route starts here or follows it</span>`}</div></div>`
            : `<div><span style="color:var(--accent)">━</span> courses in this ${arr(s, "courses").length ? "session" : "view"} · <span style="color:var(--accent2)">━</span> other learned routes · ● start · <b>click a route or its start</b> to highlight every route that starts there or follows it</div>`}
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">${models.map((m) => `<span class="chip" data-atlas-route="${esc(m.route_key)}" style="cursor:pointer;${rel && m.route_key === rel.key ? "border-color:var(--accent);color:var(--accent)" : rel && (rel.sameStart.has(m.route_key) || rel.follows.has(m.route_key)) ? "border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)" : cur.has(m.route_key) ? "border-color:var(--accent);color:var(--accent)" : ""}" title="${esc(m.route_key)} — click to select">${esc(lbl(m)).slice(0, 26)} · ${(m.geometry.turns || []).length}T · ${m.laps || 0}L</span>`).join("")}</div><p class="why" style="font-size:10px;margin:6px 0 0">paths are learned from your own laps (reference lap per route); name a route once in the events table and the label updates here</p></div></div></div>`;
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
      farb: { label: "Front ARB", unit: "", step: 3, min: 1, max: 65, dp: 1 }, rarb: { label: "Rear ARB", unit: "", step: 3, min: 1, max: 65, dp: 1 },
      fspring: { label: "Front spring rate", unit: " lb/in", step: 0, pct: 0.06, dp: 0 }, rspring: { label: "Rear spring rate", unit: " lb/in", step: 0, pct: 0.06, dp: 0 },
      fbump: { label: "Front bump", unit: "", step: 1.5, min: 1, max: 20, dp: 1 }, rbump: { label: "Rear bump", unit: "", step: 1.5, min: 1, max: 20, dp: 1 },
      freb: { label: "Front rebound", unit: "", step: 1.5, min: 1, max: 20, dp: 1 }, rreb: { label: "Rear rebound", unit: "", step: 1.5, min: 1, max: 20, dp: 1 },
      bbal: { label: "Brake balance (% front)", unit: "%", step: 3, min: 0, max: 100, dp: 0 }, bpress: { label: "Brake pressure", unit: "%", step: 8, min: 50, max: 150, dp: 0 },
      accel: { label: "Accel differential", unit: "%", step: 8, min: 0, max: 100, dp: 0 }, decel: { label: "Decel differential", unit: "%", step: 6, min: 0, max: 100, dp: 0 },
      center: { label: "Center balance (% rear)", unit: "%", step: 5, min: 0, max: 100, dp: 0 }, faero: { label: "Front downforce", unit: "", step: 0, pct: 0.15, dp: 0 }, raero: { label: "Rear downforce", unit: "", step: 0, pct: 0.15, dp: 0 },
    };
    const SLIDER_ORDER = ["farb", "rarb", "fspring", "rspring", "fbump", "rbump", "freb", "rreb", "bbal", "bpress", "accel", "decel", "center", "faero", "raero"];
    const TUNE_RX = {
      "mid-understeer": [["farb", -1, 1], ["rarb", 1, 0.6], ["fspring", -1, 0.6]],
      "front-hot": [["farb", -1, 0.5], ["faero", 1, 0.4]],
      "rear-limited": [["rarb", -1, 1], ["accel", -1, 0.6], ["rspring", -1, 0.5]],
      "oversteer-balance": [["rarb", -1, 1], ["accel", -1, 0.7], ["raero", 1, 0.5]],
      "brake-lockup": [["bpress", -1, 1]],
      "brake-balance-rear": [["bbal", -1, 1]], "brake-balance-front": [["bbal", 1, 1]],
      "brake-pressure": [["bpress", -1, 1]], "trail-brake": [["bbal", -1, 0.4]],
      "launch-spin": [["accel", -1, 1]], "launch-front-spin": [["center", 1, 1], ["accel", -1, 0.5]],
      "bottoming": [["rreb", 1, 0.7], ["fbump", 1, 0.5]],
    };
    const tuneKey = (cid) => "fh6Tune:" + baseId(cid);
    const getTune = (cid) => { try { return JSON.parse(localStorage.getItem(tuneKey(cid)) || "{}"); } catch (e) { return {}; } };
    const setTune = (cid, k, v) => { const t = getTune(cid); if (v === "" || v == null || isNaN(+v)) delete t[k]; else t[k] = +v; localStorage.setItem(tuneKey(cid), JSON.stringify(t)); };
    const tuningMoves = (adv, corners, cur) => {
      const acc = {};
      (adv || []).filter((a) => !a.open).forEach((a) => { const rx = TUNE_RX[a.key]; if (!rx) return; const cw = a.course_weight != null ? a.course_weight : 1; if (cw < 0.2) return;
        const mag = (a.severity / 3) * (a.confidence || 0.7) * cw;
        rx.forEach(([sl, dir, w]) => { const e = acc[sl] = acc[sl] || { net: 0, wsum: 0, sev: 0, srcs: new Set(), conf: 0 }; e.net += dir * w * mag; e.wsum += w * mag; e.sev = Math.max(e.sev, a.severity); e.conf = Math.max(e.conf, a.confidence || 0.7); e.srcs.add(a.text.split(":")[0].split(" (")[0]); });
      });
      const tuneCorners = (corners || []).filter((k) => k.limiter === "tune");
      const understeerN = tuneCorners.filter((k) => k.dominant === "front").length, oversteerN = tuneCorners.filter((k) => k.dominant === "rear").length; const nT = Math.max(1, (corners || []).length);
      if (understeerN) { const e = acc.farb = acc.farb || { net: 0, wsum: 0, sev: 2, srcs: new Set(), conf: 0.7 }; const m = 0.5 * understeerN / nT; e.net -= m; e.wsum += m; e.srcs.add(`${understeerN} turns front-limited`); }
      if (oversteerN) { const e = acc.rarb = acc.rarb || { net: 0, wsum: 0, sev: 2, srcs: new Set(), conf: 0.7 }; const m = 0.5 * oversteerN / nT; e.net -= m; e.wsum += m; e.srcs.add(`${oversteerN} turns rear-limited`); }
      const moves = [];
      SLIDER_ORDER.forEach((sl) => { const e = acc[sl]; if (!e || Math.abs(e.net) < 0.12) return; const S = SLIDER[sl]; const dir = e.net > 0 ? 1 : -1; const cv = cur[sl];
        let delta; if (S.pct) delta = cv != null ? Math.round(cv * S.pct * Math.min(1.5, Math.abs(e.net)) * dir) : null; else delta = +(S.step * Math.min(1.5, Math.abs(e.net)) * dir).toFixed(S.dp);
        let to = null; if (cv != null && delta != null) { to = cv + delta; if (S.min != null) to = Math.max(S.min, Math.min(S.max, to)); to = +to.toFixed(S.dp); delta = +(to - cv).toFixed(S.dp); }
        moves.push({ sl, label: S.label, unit: S.unit, from: cv, to, delta, dir, conf: e.conf, sev: e.sev, why: [...e.srcs].slice(0, 3).join(" · "), pct: !!S.pct });
      });
      return moves.sort((a, b) => b.sev - a.sev || Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
    };
    const tuneInputRow = (cid) => { const cur = getTune(cid); const n = Object.keys(cur).length;
      return `<details ${n ? "" : "open"} style="margin:6px 0"><summary style="cursor:pointer;font-size:11.5px"><b>⚙️ Current tune</b> <span class="why">${n ? n + " values entered — targets below are exact; edit anytime" : "enter your current slider values for EXACT target numbers (from the in-game tune pane)"}</span></summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 8px;margin-top:6px">${SLIDER_ORDER.map((sl) => `<label style="font-size:10.5px;display:flex;justify-content:space-between;align-items:center;gap:4px">${SLIDER[sl].label}<input data-tunecid="${esc(cid)}" data-tunesl="${sl}" value="${cur[sl] != null ? cur[sl] : ""}" inputmode="decimal" style="width:60px;padding:2px 4px;border-radius:4px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:11px"></label>`).join("")}</div></details>`;
    };
    const numericTuningPanel = (co, s, forceCid) => {
      const cid = forceCid || (live.frame && live.frame.on && live.frame.cid) || (co.cars || [])[0]; if (!cid) return "";
      const adv = (co.advice_by_car || {})[cid] || (co.advice_by_car && Object.values(co.advice_by_car)[0]) || [];
      const cur = getTune(cid); const moves = tuningMoves(adv, co.corners, cur); const haveCur = Object.keys(cur).length > 0;
      const arrow = (m) => m.delta > 0 ? "▲" : "▼"; const col = (m) => m.dir > 0 ? "#e3b341" : "#2f81f7";
      return `<div class="lab-corner" style="border-left:4px solid var(--accent);background:var(--bg2)"><div class="card-row" style="margin-top:0"><strong style="font-size:14px">🎯 Tuning adjustments — the numbers to change</strong><span class="chip" style="border-color:var(--accent);color:var(--accent)">${moves.length} change${moves.length === 1 ? "" : "s"}${co.profile && co.profile.priority && co.profile.priority.length ? " · prioritised for " + co.profile.priority[0] : ""}</span></div>
        ${tuneInputRow(cid)}
        ${moves.length ? `<div style="overflow-x:auto"><table style="font-size:12px"><thead><tr><th>slider</th><th>current</th><th></th><th>set to</th><th>Δ</th><th>why (from the course)</th><th>conf</th></tr></thead><tbody>
          ${moves.map((m) => `<tr><td><b>${m.label}</b></td><td>${m.from != null ? m.from + m.unit : `<span class="why">—</span>`}</td><td style="color:${col(m)};font-weight:700">${arrow(m)}</td><td>${m.to != null ? `<b style="color:${col(m)}">${m.to}${m.unit}</b>` : `<span style="color:${col(m)}">${m.dir > 0 ? "stiffer" : "softer"}${m.delta != null ? " ~" + Math.abs(m.delta) + m.unit : ""}</span>`}</td><td style="color:${col(m)}">${m.delta != null ? (m.delta > 0 ? "+" : "") + m.delta + m.unit : (m.dir > 0 ? "+" : "−")}</td><td class="why" style="font-size:10.5px">${esc(m.why)}</td><td><div class="lab-bar" style="width:44px;height:5px;display:inline-block"><i style="width:${Math.round((m.conf || 0) * 100)}%;background:${(m.conf || 0) >= 0.7 ? "#00d27a" : "#e3b341"}"></i></div></td></tr>`).join("")}
          </tbody></table></div>
          <p class="why" style="font-size:10.5px;margin:5px 0 0">${haveCur ? "Targets are computed from your entered values. " : "Enter your current values above for exact target numbers — without them these are directions + magnitudes. "}Change ONE group at a time, re-drive the course, and the numbers refine. ▼ softer/less · ▲ stiffer/more. Only sliders the course actually stresses are shown.</p>`
          : `<p class="why" style="font-size:12px;margin:6px 0">No firm tuning change indicated on this course yet — the car is balanced for what this track demands, or more clean laps are needed to separate driver from tune. Drive a few more consistent laps.</p>`}</div>`;
    };
    // ---- LIVE · COURSE: two STAGES, car-independent. COURSE TRAINING until the course itself is known well enough (map · turn count earned across laps ·
    //      laps on record · profile → knowledge ≥ 75 %), then COURSE TUNING (this car's feedback on that course). Manual override via chips. ----
    const courseStageSel = () => localStorage.getItem("fh6CourseStage") || "auto";   // auto | training | tuning
    const courseKnowledge = (co) => {
      const tr = co.track || {}, tu = co.turns || {}, geo = co.geometry; const lapsN = co.laps ? co.laps.total : co.runs; const lapsTrack = Math.max(tr.laps || 0, lapsN || 0);
      // 'mapped' must come from the analysis's turn data (tu.mapped / canonical), NOT co.geometry — geometry is stripped from the live SSE payload,
      // so relying on it kept every live course stuck in training. A course is mapped once it has turns established / curvature-mapped.
      const mapped = (tu.mapped || 0) > 0 || (tu.canonical || []).length > 0 || !!(geo && (geo.turns || []).length); const turnConf = tu.track_confidence || tu.confidence || 0; const poss = tu.possible || 0; const notDriven = (geo && geo.not_driven) || []; const prof = !!co.profile;
      const lapStr = 1 - Math.exp(-1.2 * lapsTrack / 3);
      const pct = Math.round((0.25 * (mapped ? 1 : 0) + 0.35 * turnConf + 0.25 * lapStr + 0.15 * (prof ? 1 : 0)) * 100);
      const needs = [];
      if (!mapped) needs.push({ k: "map", p: 0, text: "complete ONE full lap without pausing — the course map is learned from it" });
      if (lapsTrack < 3) needs.push({ k: "laps", p: 1, text: `${3 - lapsTrack} more full lap${3 - lapsTrack === 1 ? "" : "s"} — the turn count is earned across laps (now ${Math.round(turnConf * 100)}%)` });
      else if (turnConf < 0.7) needs.push({ k: "laps", p: 1, text: `keep lapping — turn count ${Math.round(turnConf * 100)}% (target 70%): clean laps confirm turns, messy laps split them` });
      if (poss) needs.push({ k: "possible", p: 2, text: `${poss} possible turn${poss === 1 ? "" : "s"} seen on a minority of laps — lap consistently to confirm or drop ${poss === 1 ? "it" : "them"}` });
      if (notDriven.length) needs.push({ k: "load", p: 2, text: `mapped turn${notDriven.length === 1 ? "" : "s"} ${notDriven.join(", ")} never loaded the tyres — take ${notDriven.length === 1 ? "it" : "them"} at pace once so ${notDriven.length === 1 ? "it registers" : "they register"}` });
      if (!prof) needs.push({ k: "profile", p: 3, text: "one full lap so the course's demands (profile) are known" });
      if ((tu.messy || []).length) needs.push({ k: "messy", p: 3, text: `${tu.messy.join(", ")} split into several detections most laps — drive ${tu.messy.length === 1 ? "it" : "them"} as one smooth arc` });
      needs.sort((x, y) => x.p - y.p);
      const auto = (pct >= 75 && mapped) ? "tuning" : "training"; const sel = courseStageSel(); const stage = sel === "auto" ? auto : sel;
      return { pct, stage, auto, sel, needs, mapped, turnConf, lapsTrack, lapsN, poss, notDriven, prof };
    };
    const stageChips = (ck) => `<span style="display:inline-flex;gap:3px;margin-left:8px">${[["auto", "🧭 auto"], ["training", "📚 training"], ["tuning", "🏋 tuning"]].map(([k, l]) => `<span class="chip" data-course-stage="${k}" style="cursor:pointer;padding:1px 7px;${ck.sel === k ? "border-color:var(--txt);color:var(--txt)" : ""}">${l}${k === "auto" && ck.sel === "auto" ? " → " + ck.auto : ""}</span>`).join("")}</span>`;
    const courseStageBanner = (co, ck) => {
      const training = ck.stage === "training"; const top = ck.needs[0]; const col = training ? "var(--accent2)" : "var(--accent)";
      const remain = Math.max(0, 75 - ck.pct);
      return `<div class="lab-corner" style="border-left:4px solid ${col};background:var(--bg2);margin-bottom:8px">
        <div class="card-row" style="margin-top:0"><strong style="font-size:15px">${training ? "📚 COURSE TRAINING" : "🏋 COURSE TUNING"} <span class="why" style="font-weight:400">· ${training ? "learning THIS COURSE (car-independent)" : "the course is known — feedback is about this car on it"}</span></strong><span style="display:inline-flex;align-items:center;gap:4px"><span id="lvCourseLive" class="chip"></span>${stageChips(ck)}</span></div>
        ${training ? `<div style="display:flex;align-items:baseline;gap:10px;margin:8px 0 2px"><b style="font-size:34px;line-height:1;color:${col}">${ck.pct}%</b><span class="why" style="font-size:12px">course-learning confidence${remain ? ` · ${remain}% to reach the tuning stage (75%)` : " · ready to switch to tuning"}</span></div>
          <div class="lab-bar" style="height:14px;margin:4px 0 8px"><i style="width:${ck.pct}%;background:${col}"></i><i style="left:75%;width:2px;background:var(--txt);opacity:.7" title="75% — switches to tuning"></i></div>
          <div style="font-size:14px;margin:6px 0 2px"><b>▶ NEXT to raise confidence:</b> ${top ? esc(top.text) : "keep lapping — the next analysis will confirm"}</div>
          ${ck.needs.slice(1).length ? `<div class="why" style="font-size:11px;margin-top:2px">then:</div><ol style="margin:2px 0 0 18px;padding:0;font-size:11.5px">${ck.needs.slice(1).map((n) => `<li>${esc(n.text)}</li>`).join("")}</ol>` : ""}
          <p class="why" style="font-size:10px;margin:6px 0 0">counts toward confidence: a full lap (map · profile) · more laps (turn count earned across laps) · loading every mapped turn once · consistent lines (settles possible turns). Tuning feedback is not shown while training — per-car references are still saved in the background.</p>`
          : `<div class="lab-bar" style="height:8px;margin:6px 0"><i style="width:${ck.pct}%;background:${col}"></i><i style="left:75%;width:2px;background:var(--txt);opacity:.6"></i></div><p class="why" style="font-size:11px;margin:4px 0 0">course knowledge ${ck.pct}% · ${ck.needs.length ? "still useful for the course: " + ck.needs.map((n) => esc(n.text)).join(" · ") : "nothing more needed for the course — everything below is feedback for this car on it"}</p>`}
      </div>`;
    };
    const liveCourseDashboard = (co, s) => {
      const p = courseParts(co, s); const tr = co.track || {}; const tu = co.turns || {}; const dr = co.driving || {}; const lapsN = co.laps ? co.laps.total : co.runs; const f = live.frame || {};
      // CAR-AWARE: everything car-specific (references, tuning, feedback) follows the EQUIPPED car; course LEARNING (turns/map/profile) is the track and stays.
      const curCar = (f.on && f.cid) || (co.cars || [])[0]; const curName = curCar ? (carName({ ordinal: String(curCar).split("|")[0], id: curCar }) || "#" + String(curCar).split("|")[0]) : "";
      const carGrip = dr.car_grip || {}; const analysisReflectsCar = curCar && (carGrip[curCar] != null || (co.cars || []).includes(curCar));
      const carChanged = !!(live.courseCar && curCar && live.courseCar !== curCar);   // set in paintFrame; means the analysis still reflects the previous car
      const ck = courseKnowledge(co); const training = ck.stage === "training"; const turnsN = tu.count || 0;
      const refsOwn = analysisReflectsCar ? (dr.own_refs || 0) : 0, refsPred = dr.predicted || 0;   // a just-swapped car has no references yet — re-gathering
      const needRefs = Math.max(1, Math.ceil(turnsN * 0.5)); const feedbackReady = ck.mapped && analysisReflectsCar && refsOwn >= needRefs;
      const carBanner = (carChanged || !analysisReflectsCar) && curCar ? `<div class="lab-corner" style="border-left:4px solid var(--warn,#e3b341);background:rgba(227,179,65,.08);margin-bottom:8px"><strong style="font-size:13px">🔄 Car changed — now ${esc(curName)}</strong> <span class="why" style="font-size:11px">the course (turns · map · layout) is kept; this car's references, tuning targets and feedback are re-gathering — drive ${needRefs} clean turn${needRefs === 1 ? "" : "s"} (predictions from geometry × this car's grip fill in meanwhile). The next analysis (~20 s) confirms.</span></div>` : "";
      const tiles = [[esc(p.rn), "course"], [`${lapsN} / ${tr.laps || lapsN}`, "laps · session / on record"], [co.best_lap ? co.best_lap.toFixed(3) : "—", "best lap · session"], [tr.best ? tr.best.best_lap.toFixed(3) : "—", "best lap · track"], [`${turnsN}${tu.possible ? " +" + tu.possible : ""}`, `turns · ${Math.round((tu.track_confidence || tu.confidence || 0) * 100)}% earned`], [`${ck.pct}%`, "course knowledge"], [`${dr.on_reference || 0}/${dr.compared || 0}`, "turns on reference"], [`${refsOwn}/${turnsN}`, "refs for this car"]];
      const st = (k, ok, t) => `<span class="chip" title="${esc(t)}" style="border-color:${ok ? "#00d27a" : "var(--warn,#e3b341)"};color:${ok ? "#00d27a" : "var(--warn,#e3b341)"}">${ok ? "✓" : "○"} ${k}</span>`;
      const learnPanel = `<div class="lab-corner" style="border-left:4px solid var(--accent2)"><div class="card-row" style="margin-top:0"><strong>📚 Course learning — what we know about this track</strong><span class="chip" style="border-color:var(--accent2);color:var(--accent2);font-weight:700">${ck.pct}%</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;margin:6px 0">${st("identified", (tr.sessions || 0) > 1 || (tr.laps || 0) > lapsN, (tr.laps || 0) > lapsN ? `known track · ${tr.laps} laps on record over ${tr.sessions} sessions` : "new track — learning it from this session")}${st("mapped", ck.mapped, ck.mapped ? `${tu.mapped || ((co.geometry || {}).turns || []).length} turns mapped from coordinates` : "the map appears after the first full lap")}${st("turn count", ck.turnConf >= 0.7, `${Math.round(ck.turnConf * 100)}% earned across laps`)}${st("laps", ck.lapsTrack >= 3, `${ck.lapsTrack} on record`)}${st("profile", ck.prof, ck.prof ? "demands known" : "after a lap")}${st("references (this car)", turnsN ? refsOwn / turnsN >= 0.5 : false, `${refsOwn}/${turnsN} turns have a reference for THIS car${refsPred ? ` · ${refsPred} predicted from geometry × grip` : ""}`)}</div>
            ${p.track}${p.map}${p.turns}${p.profile}${p.laps}</div>`;
      const feedPanel = `<div class="lab-corner" style="border-left:4px solid ${feedbackReady ? "var(--accent)" : "var(--muted)"}"><div class="card-row" style="margin-top:0"><strong>🏋 Tuning feedback — this car on this track</strong><span class="chip" style="border-color:${feedbackReady ? "#00d27a" : "var(--warn,#e3b341)"};color:${feedbackReady ? "#00d27a" : "var(--warn,#e3b341)"};font-weight:700">${feedbackReady ? "ACTIVE" : "WARMING UP"}</span></div>
            <p class="why" style="font-size:11px;margin:4px 0 6px">${feedbackReady ? `references exist for ${refsOwn}/${turnsN} turns — the per-turn deltas and slider suggestions below are grounded in this car's own best passes` : `${refsOwn}/${turnsN} turns have a reference for this car — ${Math.max(0, needRefs - refsOwn)} more clean turn${needRefs - refsOwn === 1 ? "" : "s"} needed (geometry × grip predictions fill in meanwhile)`}</p>
            ${numericTuningPanel(co, s, curCar)}
            <details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px"><b>📊 Diagnosis behind the numbers</b> <span class="why">— per-turn deltas, limiters, phase breakdown</span></summary><div style="margin-top:6px">${p.probes}${p.corners}${p.driving}${p.advice}</div></details></div>`;
      if (training) return `${carBanner}${courseStageBanner(co, ck)}<div class="lab-tiles" style="margin-bottom:8px">${tiles.map(([v, l]) => `<div class="lab-tile"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
        <div id="lvCornerAnalysis" style="margin-bottom:8px">${cornerAnalysis()}</div>
        ${learnPanel}
        <div class="lab-corner" style="border-left:4px solid var(--muted);opacity:.75;font-size:11.5px" title="Tuning feedback is a tuning-stage concern"><b>🏋 Tuning feedback — locked while training.</b> <span class="why">This car's per-turn references (${refsOwn}/${turnsN}) are still being gathered and saved in the background; they become live feedback the moment course knowledge reaches 75%.</span></div>`;
      return `${carBanner}${courseStageBanner(co, ck)}<div class="lab-tiles" style="margin-bottom:8px">${tiles.map(([v, l]) => `<div class="lab-tile"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
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
        <div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:800;color:${col};line-height:1.1">${esc(nm)}</div><div class="why" style="font-size:12px">${on ? `${f.cls} ${f.pi} · ${f.drv} · ${f.cyl || ""}cyl${f.on && f.ev ? " · in an event" : ""}` : "parked — last active car"} · build ${String(cid).split("|").slice(0, 4).join("|")}</div></div>
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
        return `<tr data-atlas-route="${esc(m.route_key)}" style="cursor:pointer;${sel ? "outline:2px solid var(--accent);outline-offset:-2px" : cur.has(m.route_key) ? "background:rgba(0,210,122,.06)" : ""}"><td><b>${esc(lbl(m))}</b>${cur.has(m.route_key) ? ` <span class="chip" style="border-color:var(--accent);color:var(--accent)">in this recording</span>` : ""}</td><td>${kind}</td><td>${g.length_m ? (g.length_m / 1000).toFixed(2) + " km" : "—"}</td><td>${(g.turns || []).length || "—"}</td><td>${m.laps || 0}</td><td>${visits.reduce((a, v) => a + (v.attempts || 0), 0)}</td><td>${(m.sessions || []).length}</td><td>${best ? `<b style="color:#00d27a">${best.best_lap.toFixed(3)} s</b>` : "—"}</td><td>${best ? `${esc(best.name || best.cid)} <span class="why">· ${best.class || ""} ${best.pi || ""}${best.drivetrain ? " " + best.drivetrain : ""}${best.build_id ? " · build " + best.build_id : ""}${best.hp ? " · " + best.hp + " hp" : ""}</span>` : "—"}</td><td class="why">${(m.sessions || []).slice(-1)[0] ? String((m.sessions || []).slice(-1)[0]).slice(-6) : ""}</td></tr>`; }).join("");
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
        ${entries.map((e) => { const d = e.best && e.best.decode || {}; const cs = e.best && e.best.sheet || {}; const picked = libPick && libPick.key === e.id && libPick.sid === (e.best && e.best.sid); return `<tr style="${picked ? "outline:2px solid #a371f7;outline-offset:-2px" : curIds.has(e.id) ? "background:rgba(0,210,122,.06)" : ""}"><td><b>${esc(e.name || "#" + String(e.id).split("|")[0])}</b> <span class="why">· ${e.class || ""} ${e.pi || ""} ${e.drivetrain || ""} ${e.cyl || ""}cyl</span>${curIds.has(e.id) ? ` <span class="chip" style="border-color:var(--accent);color:var(--accent)">in this recording</span>` : ""}</td><td class="why">${[...e.build_ids].filter(Boolean).join(", ") || "—"}</td><td>${e.sessions.length}</td><td>${d.total ? `<span style="color:${d.pct >= 1 ? "#00d27a" : "var(--warn,#e3b341)"}">${d.ready_n}/${d.total}</span>` : "—"}</td><td>${cs.confidence != null ? `<div style="display:flex;align-items:center;gap:6px"><div class="lab-bar" style="width:60px;height:6px"><i style="width:${cs.confidence * 100}%;background:${confCol(cs.confidence)}"></i></div><b style="color:${confCol(cs.confidence)}">${Math.round(cs.confidence * 100)}%</b>${cs.complete ? ` <span class="chip" style="border-color:#00d27a;color:#00d27a">complete</span>` : ""}${cs.components ? ` <span class="chip" style="border-color:#a371f7;color:#a371f7">components</span>` : ""}</div>` : "—"}</td><td>${[...e.roles].map((r) => r === "donor" ? "🎯" : "🔧").join(" ") || ""}</td><td>${e.best ? `<span class="chip" data-lib-pick="${esc(e.best.sid)}|${esc(e.id)}" style="cursor:pointer;border-color:#a371f7;color:#a371f7">use as donor (from ${String(e.best.sid).slice(-6)})</span>` : ""}</td></tr>`; }).join("")}
        </tbody></table></div><p class="why" style="font-size:10.5px;margin:6px 0 0">the library is built from every recording; 'use as donor' loads that config's best capture into the DONOR side so any run in this recording can be converged against it — that is what Recording · Decode is for</p></div>`;
    };
    function courseSection(s, isLive) {
      if (!s) return isLive ? EMPTY_LIVE : NOSESS;
      const allCourses = arr(s, "courses");   // no car filter here — the car rail belongs to Free Tuning; a course card already names its cars
      // the atlas selection drives the details: only the selected course is shown (from this session, or from its track record if not visited here)
      const selModel = atlasPick ? (DB.courseModels || []).find((m) => m && m.route_key === atlasPick) : null;
      const courses = atlasPick ? allCourses.filter((co) => co.route_key === atlasPick) : allCourses;
      const selBar = atlasPick ? `<div class="card-row" style="margin:0 0 8px"><span class="chip" style="border-color:var(--accent);color:var(--accent)">showing the course selected in the atlas${courses.length ? "" : " — from its track record"}</span><span class="chip" data-atlas-clear="1" style="cursor:pointer">✕ show all ${allCourses.length} course${allCourses.length === 1 ? "" : "s"}</span></div>` : "";
      const lead = isLive ? "" : `${routesAtlas(s)}${trackIndex(s)}`;
      if (isLive) return `${courses.length ? courses.map((co) => { const _ck = courseKnowledge(co); const _tr = _ck.stage === "training"; const _col = _tr ? "var(--accent2)" : "var(--accent)"; const _bg = _tr ? "rgba(47,129,247,.07)" : "rgba(0,210,122,.07)"; return `<div class="block" style="border:2px solid ${_col};box-shadow:inset 6px 0 0 ${_col};background:${_bg}"><h3 style="margin-top:0;display:flex;align-items:center;gap:8px;font-size:17px"><span style="font-size:22px">${_tr ? "📚" : "🏋"}</span><span style="color:${_col}">${_tr ? "COURSE LEARNING" : "COURSE TUNING"}</span><span class="why" style="font-weight:400;font-size:12px">${_tr ? `— learning the course · knowledge ${_ck.pct}%, switches to tuning at 75%` : `— the course is known (${_ck.pct}%) · feedback for this car`}</span><span class="chip" style="margin-left:auto">updates every ~20 s of driving</span></h3>${selBar}${liveCourseDashboard(co, s)}</div>`; }).join("") : atlasPick && selModel ? `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🏟 Course — from the track record</h3>${selBar}<div class="card-grid">${modelCourseCard(selModel)}</div></div>` : `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏟 Course dashboard</h3><div class="lab-corner" style="border-left:4px solid var(--accent2);background:var(--bg2)"><div class="card-row" style="margin-top:0"><strong style="font-size:15px">📚 COURSE TRAINING <span class="why" style="font-weight:400">· no course identified yet</span></strong><span id="lvCourseLive" class="chip"></span></div><div style="font-size:13px;margin:4px 0 2px"><b>▶ NEXT for the course:</b> complete the first attempt / loop lap — the course appears (and is matched against the database) when it finishes</div><p class="why" style="font-size:10.5px;margin:5px 0 0">timed event (Rivals · race · time trial) or a marked reference loop (📍 in the stream bar). Everything outside those windows is Free Tuning.</p></div><div id="lvCornerAnalysis" style="margin-top:8px">${cornerAnalysis()}</div></div>`}${eventsTable(s)}${routesAtlas(s)}`;
      return `${lead}${courses.length ? `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏟 Course — per route: what it demands, every turn quantified & classified, lap deltas per run, course-weighted suggestions</h3>${selBar}<div class="card-grid">${courses.map((co) => courseBlock(co, s)).join("")}</div></div>` : atlasPick && selModel ? `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🏟 Course — from the track record</h3>${selBar}<div class="card-grid">${modelCourseCard(selModel)}</div></div>`
        : `<div class="block" style="border-color:var(--accent2)"><h3 style="margin-top:0">🏟 Course — nothing scoped yet</h3><p class="why" style="font-size:12px;margin:0">A course appears when you run a timed event (Rivals · race · time trial) or lap a marked reference loop${isLive ? " — mark one with 📍 in the stream bar above (the control lives on this Course tab) and drive back through the start" : ""}. Everything outside those windows is Free Tuning.</p></div>`}
        ${eventsTable(s)}`;
    }
    // 🛣 FREE TUNING — whole-session advisor, runs, test cards, gear & dyno (recordings also get the strip + corner cards; live paints those as instruments)
    function freeSection(s, isLive) {
      if (!s) return isLive ? EMPTY_LIVE : NOSESS;
      const cars = arr(s, "cars"), corners = arr(s, "corners"), launches = arr(s, "launches"), braking = arr(s, "braking"), pulses = arr(s, "pulses"), stints = arr(s, "stints");
      const cs = carSel ? corners.filter((c) => c.car === carSel) : corners; const real = cs.filter((c) => !c.drift); const sm = s.summary || {};
      const tiles = isLive ? "" : `<div class="lab-tiles">${[[s.rate_pps, "pkt/s"], [cars.length, "cars"], [corners.length, "corners"], [sm.front_limited_corners, "front-limited"], [sm.rear_limited_corners, "rear-limited"], [sm.drift_corners, "drifts"], [launches.length, "launches"], [braking.length, "brake events"], [sm.impacts, "impacts"]].map(([v, l]) => `<div class="lab-tile"><b>${v ?? "—"}</b><span>${l}</span></div>`).join("")}</div>`;
      const rail = `<div class="lab-rail"><span class="chip ${carSel == null ? "on" : ""}" data-car="all">all cars</span>${cars.map((c) => `<span class="chip ${carSel === c.id ? "on" : ""}" data-car="${c.id}" style="border-color:${carCol(s, c.id)}">${carLbl(s, c.id)}</span>`).join("")}</div>`;
      const launchCharts = launches.filter((l) => !carSel || l.car === carSel).slice(0, 4).map((l) => `<div class="car-card" style="cursor:default"><h3 style="font-size:13px;margin:0 0 4px">🚦 Launch @ ${l.t}s · ${carLbl(s, l.car)}</h3>
        <p class="why" style="font-size:11px;margin:0 0 4px">0-60 <b>${l.zero60_s ?? "—"} s</b> · peak rear slip <b style="color:${l.peak_slip_rear > 1 ? "#e5414e" : "inherit"}">${l.peak_slip_rear}</b> · front ${l.peak_slip_front}</p>
        ${chart([{ pts: l.trace.map((p) => [p[0], Math.abs(p[3])]), col: "#e5414e", label: "RL slip" }, { pts: l.trace.map((p) => [p[0], Math.abs(p[4])]), col: "#f0883e", label: "RR slip" }, { pts: l.trace.map((p) => [p[0], Math.abs(p[1])]), col: "#2f81f7", label: "FL slip" }], { xl: "s", yl: "slip ratio", hline: 1, hlabel: "limit", ymax: Math.min(8, Math.max(1.5, l.peak_slip_rear * 1.1)) })}</div>`).join("");
      const brakeRows = braking.filter((b) => !carSel || b.car === carSel).map((b) => `<tr><td>${b.t}s</td><td>${carLbl(s, b.car)}</td><td>${b.mph_start}→${b.mph_end}</td><td>${b.decel_g_peak} g</td>
        <td><div class="lab-bar" style="width:90px;display:inline-block;vertical-align:middle"><i style="width:${Math.min(100, b.front_deficit * 100)}%;background:#2f81f7"></i></div> ${b.front_deficit}</td>
        <td><div class="lab-bar" style="width:90px;display:inline-block;vertical-align:middle"><i style="width:${Math.min(100, b.rear_deficit * 100)}%;background:#e5414e"></i></div> ${b.rear_deficit}</td>
        <td>${b.lock === "none" ? `<span class="chip">no lock</span>` : `<span class="chip" style="border-color:#e5414e;color:#e5414e">${b.lock} lock</span>`}</td></tr>`).join("");
      const gearCards = cars.filter((c) => !carSel || c.id === carSel).map((c) => `<div class="car-card" style="cursor:default;border-left:4px solid ${carCol(s, c.id)}"><h3 style="font-size:13px;margin:0 0 4px">⚙️ ${carLbl(s, c.id)} <span class="chip">${c.live_s ?? "—"}s</span></h3>${nameUI(c)}${sigChips(c)}
        <div style="display:flex;gap:12px;flex-wrap:wrap"><table style="font-size:11px"><thead><tr><th>gear</th><th>m/s per krpm</th><th>vs 1st</th></tr></thead><tbody>${(c.gears || []).map((g) => `<tr><td>${g.gear}</td><td>${g.mps_per_krpm}</td><td>${g.rel}</td></tr>`).join("")}</tbody></table>
        <div>${chart([{ pts: (c.dyno || []).map((d) => [d.rpm, d.hp]), col: "#e3b341", label: "hp" }, { pts: (c.dyno || []).map((d) => [d.rpm, d.tq]), col: "#e83c9e", label: "ft·lb" }], { w: 260, h: 120, xl: "rpm (WOT frames)", yl: "" })}</div></div>
        <p class="why" style="font-size:10.5px;margin:4px 0 0">tire temp max °F: ${Object.entries(c.temps_max_f || {}).map(([w, v]) => `${w} ${v}`).join(" · ") || "—"}</p></div>`).join("");
      const pulsesByCar = cars.map((c) => { const p = pulses.filter((x) => x.car === c.id && x.decay_s != null).map((x) => x.decay_s).sort((a, b) => a - b); return p.length ? `${carLbl(s, c.id)}: median decay <b>${p[Math.floor(p.length / 2)].toFixed(2)} s</b> (${p.length} pulses)` : null; }).filter(Boolean);
      const adviceCars = cars.filter((c) => c.coverage && (!carSel || c.id === carSel));
      return `${tiles}
        ${adviceCars.length ? `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🎯 Confidence & suggestions — whole session, per car${sm.corners != null ? ` <span class="chip">${sm.corners} corners · ${sm.launches} launches · ${sm.braking} stops</span>` : ""}${isLive ? ` <span class="chip">updates every ~20 s of driving</span>` : ""}</h3><div class="card-grid">${adviceCars.map((c) => adviceBlock(c, s)).join("")}</div></div>` : `<div class="block" style="border-color:var(--accent)"><h3 style="margin-top:0">🎯 Confidence & suggestions</h3><p class="why" style="font-size:12px;margin:0">${isLive ? "first analysis after ~20 s of driving…" : "no analysed cars in this recording"}</p></div>`}
        ${stints.length ? `<div class="block"><h3 style="margin-top:0">🏁 Runs — the unit of an A/B re-tune (tag them; set 🎯 / 🔧 roles for Decode)</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>run</th><th>car</th><th>window</th><th>label</th><th>role</th><th>corners</th><th>USI med</th><th>front-red</th><th>brake F/R</th><th>launch slip</th><th>ladder</th></tr></thead><tbody>
            ${stints.map((st) => `<tr style="border-left:3px solid ${carCol(s, st.id)}"><td><b>${st.n}</b></td><td>${carLbl(s, st.id).split(" · ").slice(0, 2).join(" · ")}</td><td>${st.t0}–${st.t1}s (${st.live_s}s)</td><td>${st.label ? `<b>${esc(st.label)}</b>` : `<span class="why">—</span>`}</td><td>${st.role === "donor" ? `<span class="chip" style="border-color:#e3b341;color:#e3b341">🎯 DONOR</span>` : st.role === "replica" ? `<span class="chip" style="border-color:#00d27a;color:#00d27a">🔧 REPLICA</span>` : ""}</td><td>${st.corners ?? "—"}</td><td>${st.usi_med == null ? "—" : (st.usi_med > 0 ? "+" : "") + st.usi_med.toFixed(3)}</td><td>${st.first_red_front ?? "—"}/${st.corners ?? "—"}</td><td>${st.brake_fd_med == null ? "—" : `${st.brake_fd_med.toFixed(2)}/${(st.brake_rd_med ?? 0).toFixed(2)}`}</td><td>${st.launch_rear_slip == null ? "—" : st.launch_rear_slip.toFixed(2)}</td><td title="${esc(JSON.stringify(st.ladder || {}))}">${Object.keys(st.ladder || {}).length ? (st.ladder_changed === true ? `<span class="chip" style="border-color:#e3b341;color:#e3b341">gearing changed</span>` : st.ladder_changed === false ? `<span class="chip">same gearing</span>` : `<span class="chip">first / n-a</span>`) : "—"}</td></tr>`).join("")}
          </tbody></table></div><p class="why" style="font-size:11px;margin-top:6px">Same car + same parts + new sliders looks identical in the packet header — the RUN is the unit. In Course mode every menu gap starts a run; in Decode / Free only a build change, an event edge, or ➕ new run does.</p></div>` : ""}
        ${isLive ? "" : `<div class="block"><h3 style="margin-top:0">📼 Session strip — ${s.id}</h3>${arr(s, "strip").length ? strip(s) : `<p class="why" style="font-size:11px">no strip in this recording</p>`}
          ${rail}
          <p class="why" style="font-size:11px">${arr(s, "zero_windows").length} not-driving windows · ${arr(s, "impacts").length} impact frames discarded · hover any second for numbers.</p></div>
        <div class="block" style="border-color:#e5414e"><h3 style="margin-top:0">🩺 Corners — first red ring, by phase</h3>
          <p class="why" style="font-size:12px">${real.length} grip corners (${cs.length - real.length} drifts hidden from diagnosis): front-limited <b>${real.filter((c) => c.first_red && c.first_red.axle === "front").length}</b> · rear-limited <b>${real.filter((c) => c.first_red && c.first_red.axle === "rear").length}</b> · clean <b>${real.filter((c) => !c.first_red).length}</b></p>
          <div class="card-grid">${cs.slice(0, 24).map((c) => cornerCard(s, c)).join("")}</div>${cs.length > 24 ? `<p class="why" style="font-size:11px">+${cs.length - 24} more</p>` : ""}</div>`}
        <div class="block"><h3 style="margin-top:0">🧪 Test cards detected</h3>${isLive ? rail : ""}
          <div class="card-grid" style="margin-top:8px">${launchCharts || `<p class="why" style="font-size:11px">no standing launches yet</p>`}</div>
          <h3 style="font-size:14px">🛑 Braking events — wheel-speed deficit (lock detector)</h3>
          <div style="overflow-x:auto"><table><thead><tr><th>t</th><th>car</th><th>mph</th><th>decel</th><th>front deficit</th><th>rear deficit</th><th>verdict</th></tr></thead><tbody>${brakeRows || `<tr><td colspan="7" class="why">none</td></tr>`}</tbody></table></div>
          <div class="card-grid" style="margin-top:10px">${gearCards}</div>
          <p class="why" style="font-size:11px;margin-top:8px">🪃 Wiggle (yaw decay after a steering pulse, experimental): ${pulsesByCar.join(" · ") || "no pulses detected"}. 🛏 Bottoming events: <b>${sm.bottoming ?? "—"}</b>.</p></div>
        <div class="block" style="border-color:var(--warn,#e3b341)"><h3 style="margin-top:0">📎 HUD clips — the two things the stream can't carry</h3>
          <div class="card-grid"><div class="lab-slot"><img src="assets/telemetry/tires-misc.jpg" alt="">Tires, Misc. — hot pressures → cold = hot − 3.5 psi · live camber</div><div class="lab-slot"><img src="assets/telemetry/heat.jpg" alt="">Heat — inner / middle / outer → camber verdict</div></div></div>`;
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
        <div style="overflow-x:auto"><table style="font-size:11.5px"><thead><tr><th>shop menu</th><th>part</th><th>install / match</th><th>status</th><th style="min-width:150px">confidence · evidence</th><th style="min-width:170px">how / why</th></tr></thead><tbody>
        ${cs.menus.map((m) => m.items.map((it, i) => { const sc = STATCHIP[it.status] || ["?", "var(--muted)"]; const cv = it.confidence; const cc = cv == null ? null : confCol(cv); return `<tr>${i === 0 ? `<td rowspan="${m.items.length}" style="font-weight:700;color:var(--accent2);white-space:nowrap">${m.menu}</td>` : ""}<td style="white-space:nowrap">${it.item}</td><td>${it.pending ? `<span style="color:var(--muted)">⏳ pending — needs <b>${gateLbl[it.gate] || it.gate}</b></span>` : (it.value != null ? `<b>${esc(String(it.value))}</b>` : `<span style="color:var(--muted)">—</span>`)}</td><td style="white-space:nowrap"><span class="chip" style="border-color:${sc[1]};color:${sc[1]}">${sc[0]}</span></td><td>${cv == null ? `<span class="why" style="font-size:10.5px">— verify in shop</span>` : `<div style="display:flex;align-items:center;gap:6px"><div class="lab-bar" style="width:60px;height:6px"><i style="width:${cv * 100}%;background:${cc}"></i></div><b style="color:${cc};font-size:11px">${Math.round(cv * 100)}%</b>${it.status === "inferred" && !it.evidence ? `<span class="why" style="font-size:10px">assumed</span>` : ""}</div>${it.evidence ? `<div class="why" style="font-size:10px;margin-top:2px">${esc(it.evidence)}</div>` : ""}${it.needs && cv < 0.7 ? `<div style="font-size:10px;color:var(--warn,#e3b341);margin-top:2px">↑ ${esc(it.needs)}</div>` : ""}`}</td><td class="why" style="font-size:10.5px">${it.note ? esc(it.note) : ""}</td></tr>`; }).join("")).join("")}
        </tbody></table></div>`;
    };
    // ---- LIVE CORNER ANALYSIS (course training): every corner of every lap, full stats, in real time ----
    // enriched corner log: each live 'corner' event tagged with its lap and matched to a course turn (canonical apex position)
    const canonTurns = () => { const an = live.analysis; const co = an && (an.courses || [])[0]; return (co && co.turns && co.turns.canonical) || []; };
    const matchTurn = (apex) => { if (!apex || apex[0] == null) return null; const cs = canonTurns(); let best = null, bd = 60 * 60; cs.forEach((t, i) => { const d = (t.pos[0] - apex[0]) ** 2 + (t.pos[1] - apex[1]) ** 2; if (d < bd) { bd = d; best = { id: t.id, n: i + 1, dir: t.dir }; } }); return best; };
    const pushCornerLog = (c) => { if (!live.cornerLog) live.cornerLog = []; const lap = c.lapn != null ? c.lapn : (c.loop_lap != null ? c.loop_lap : null); live.cornerLog.push(Object.assign({}, c, { lap, seq: (live.cornerLog.length + 1) })); if (live.cornerLog.length > 400) live.cornerLog = live.cornerLog.slice(-400); };   // turn match happens at RENDER (canonical turns may load after the corner)
    const usiVerdict = (u) => u > 0.15 ? ["understeer", "#2f81f7"] : u < -0.05 ? ["oversteer", "#e5414e"] : ["neutral", "#00d27a"];
    const phaseBars = (ph) => `<span style="display:inline-flex;gap:2px">${(ph || []).map((p) => { const fr = Math.min(1, p.front / 1.5), rr = Math.min(1, p.rear / 1.5); const col = p.red === "front" ? "#2f81f7" : p.red === "rear" ? "#e5414e" : p.red === "both" ? "#a371f7" : "#3a4250"; return `<span title="phase ${p.phase} (${CM_SHORT ? CM_SHORT[p.phase - 1] : ""}): front ${p.front} · rear ${p.rear}" style="display:inline-block;width:16px;height:16px;border-radius:2px;border:1px solid ${col};position:relative;background:var(--bg)"><i style="position:absolute;left:0;bottom:0;width:50%;height:${Math.round(fr * 100)}%;background:#2f81f7;opacity:${p.front > 1 ? 1 : .4}"></i><i style="position:absolute;right:0;bottom:0;width:50%;height:${Math.round(rr * 100)}%;background:#e5414e;opacity:${p.rear > 1 ? 1 : .4}"></i></span>`; }).join("")}</span>`;
    const cornerAnalysis = () => {
      const curC = (live.frame && live.frame.on && live.frame.cid) || live.courseCar; const log = (live.cornerLog || []).filter((c) => !curC || c.car === curC); const cs = canonTurns(); const f = live.frame || {}; const inCorner = f.on && Math.abs(f.lat || 0) > 0.4;   // car-aware: only the equipped car's corners
      if (!log.length && !cs.length) return `<div class="lab-corner" style="border-left:4px solid var(--accent2);background:var(--bg2)"><strong>🩺 Corner analysis</strong> <span class="why">— every corner of every lap, live. Start a lap; each corner appears here the moment you complete it.</span>${inCorner ? ` <span class="chip" style="border-color:var(--accent2);color:var(--accent2)">● in a corner now — ${f.lat > 0 ? "right" : "left"}, ${Math.abs(f.lat).toFixed(2)} g</span>` : ""}</div>`;
      // per-turn matrix (this session): for each course turn, the corners taken on it (matched here, so a late-arriving analysis still groups older corners)
      const byTurn = {}; log.forEach((c) => { c._turn = matchTurn(c.apex); const k = c._turn ? c._turn.id : "?"; (byTurn[k] = byTurn[k] || []).push(c); });
      const med = (a) => { a = a.filter((x) => x != null).slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
      const rows = cs.map((t, i) => { const arr = (byTurn[t.id] || []); const last = arr[arr.length - 1]; const fr = { front: 0, rear: 0, none: 0 }; arr.forEach((c) => fr[(c.first_red || {}).axle || "none"]++); const dom = arr.length ? Object.keys(fr).sort((a, b) => fr[b] - fr[a])[0] : "—";
        return { n: i + 1, id: t.id, dir: t.dir, taken: arr.length, mph: med(arr.map((c) => c.mph_min)), lat: med(arr.map((c) => c.lat_g_peak)), usi: med(arr.map((c) => c.usi)), dom, fr, last, brake: med(arr.map((c) => c.brake_on_m)) }; });
      const matrix = `<div style="overflow-x:auto"><table style="font-size:11px"><thead><tr><th>turn</th><th>taken</th><th>apex mph</th><th>lat g</th><th>brake (m)</th><th>USI</th><th>first red</th><th>last: in→apex→out · phases</th></tr></thead><tbody>
        ${rows.map((r) => { const uv = r.usi != null ? usiVerdict(r.usi) : null; const dcol = r.dom === "front" ? "#2f81f7" : r.dom === "rear" ? "#e5414e" : "var(--muted)"; return `<tr style="${r.taken ? "" : "opacity:.4"}"><td><b>T${r.n}</b> ${r.dir === "L" ? "⬅" : "➡"}</td><td>${r.taken || "—"}</td><td>${r.mph ?? "—"}</td><td>${r.lat ?? "—"}</td><td>${r.brake ?? "—"}</td><td>${r.usi != null ? `<span style="color:${uv[1]}">${r.usi > 0 ? "+" : ""}${r.usi.toFixed(2)}</span>` : "—"}</td><td>${r.taken ? `<span style="color:${dcol};font-weight:700">${r.dom}</span> <span class="why">${r.fr.front}/${r.fr.rear}/${r.fr.none}</span>` : "—"}</td><td>${r.last ? `${r.last.mph_in}→<b>${r.last.mph_min}</b>→${r.last.mph_out ?? "—"} ${phaseBars(r.last.phases)}` : "—"}</td></tr>`; }).join("")}
        </tbody></table></div>`;
      // chronological log — full stats per corner, newest first
      const recent = log.slice(-16).reverse();
      const logHtml = `<div style="overflow-x:auto;margin-top:8px"><table style="font-size:11px"><thead><tr><th>#</th><th>lap</th><th>turn</th><th>type</th><th>in→apex→out</th><th>lat g</th><th>brake·thr (m)</th><th>phases F/R</th><th>first red</th><th>USI</th><th>flags</th></tr></thead><tbody>
        ${recent.map((c) => { const type = c.mph_min < 45 ? "hairpin" : c.mph_min <= 85 ? "medium" : "fast"; const fr = c.first_red; const uv = usiVerdict(c.usi); const frcol = fr ? (fr.axle === "front" ? "#2f81f7" : "#e5414e") : "var(--muted)"; const tm = c._turn || matchTurn(c.apex); return `<tr><td class="why">${c.seq}</td><td>${c.lap ?? "—"}</td><td><b>${tm ? "T" + tm.n : "·"}</b> ${c.dir === "L" ? "⬅" : "➡"}</td><td>${type}</td><td>${c.mph_in}→<b>${c.mph_min}</b>→${c.mph_out ?? "—"}</td><td>${c.lat_g_peak}</td><td>${c.brake_on_m ?? "—"}${c.throttle_on_m != null ? " · +" + c.throttle_on_m : ""}</td><td>${phaseBars(c.phases)}</td><td>${fr ? `<span style="color:${frcol};font-weight:700">${fr.axle} ph${fr.phase}</span>` : `<span style="color:#00d27a">clean</span>`}</td><td><span style="color:${uv[1]}">${uv[0]}</span> ${c.usi > 0 ? "+" : ""}${c.usi}</td><td class="why">${c.hb ? "🖐 " : ""}${c.drift ? "drift " : ""}${c.kink ? "kink " : ""}${c.brake_max > 200 ? "🛑" : ""}</td></tr>`; }).join("")}
        </tbody></table></div>`;
      return `<div class="lab-corner" style="border-left:4px solid var(--accent2)"><div class="card-row" style="margin-top:0"><strong>🩺 Corner analysis — every corner, every lap (live)</strong><span class="chip" style="border-color:var(--accent2);color:var(--accent2)">${log.length} corner${log.length === 1 ? "" : "s"} this session${inCorner ? " · ● in a corner now" : ""}</span></div>
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
      const curId = isLive && live.frame ? live.frame.cid : null; const A = curId ? car(s, curId) : null; const Adone = !!(A && A.decode && A.decode.pct >= 1);
      const subject = isLive ? (A ? `<div class="block" style="border-color:#a371f7"><div class="card-row" style="margin-top:0"><h3 style="margin:0">🚗 Cloning the car you're in — ${esc(carName(A) || "#" + A.ordinal)} <span class="why">· ${A.class} ${A.pi} ${A.drivetrain} ${A.cyl}cyl · build ${A.build_id}</span></h3><span class="chip" style="border-color:${Adone ? "#00d27a" : "#e3b341"};color:${Adone ? "#00d27a" : "#e3b341"};font-weight:700">${A.decode ? (Adone ? "CAPTURE COMPLETE" : A.decode.ready_n + "/" + A.decode.total + " tests") : "analysing…"}</span></div>
          <p class="why" style="font-size:11px;margin:2px 0 6px">analysed constantly — the daemon re-analyses every ~20 s of driving; the panel below moves with every frame</p>
          <div id="lvDecNext">${nextPanelHtml(A)}</div>
          ${(() => { const st = live.stint || (live.frame && live.frame.stint) || 0; const tg = (live.tags || {})[String(st)] || {}; const myRole = (typeof tg === "object" && tg.role) || ""; const pin = PIN(); const hasDonor = !!(pin || roleStint("donor"));
            return `<div style="margin:6px 0;padding:8px 10px;border:1px dashed #a371f7;border-radius:8px;font-size:11.5px">
              <div style="font-weight:700;margin-bottom:4px">Which run is this? <span class="why" style="font-weight:400">— tag the car you're driving so the Bench knows what to compare</span></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <button class="lab-mode" data-role="donor" style="padding:5px 12px;font-size:12px;border-color:#e3b341;color:#e3b341;${myRole === "donor" ? "background:#e3b341;color:#0e1116" : ""}">🎯 DONOR — the tune I want to clone</button>
                <button class="lab-mode" data-role="replica" style="padding:5px 12px;font-size:12px;border-color:#00d27a;color:#00d27a;${myRole === "replica" ? "background:#00d27a;color:#0e1116" : ""}">🔧 REPLICA — my rebuild of it</button>
                ${myRole ? `<span class="chip" style="border-color:${myRole === "donor" ? "#e3b341" : "#00d27a"};color:${myRole === "donor" ? "#e3b341" : "#00d27a"}">this run = ${myRole === "donor" ? "🎯 DONOR" : "🔧 REPLICA"}</span>` : ""}
              </div>
              <div class="why" style="font-size:10.5px;margin-top:5px">${!hasDonor ? "<b>Start here:</b> driving the locked / downloaded tune you want to copy? Press 🎯 DONOR — its Clone Sheet (the parts) builds below and it stays pinned." : A.id === (D && D.id) ? "This IS the donor — the Clone Sheet below is your deliverable. Build a copy, drive it, and press 🔧 REPLICA to see the slider gaps." : "Donor already set. If this is your rebuild, press 🔧 REPLICA to converge it against the donor on the Bench."}</div>
            </div>`; })()}
          ${A.decode ? (Adone ? `${A.clone_sheet ? cloneSheetHtml(A) : ""}<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px"><b>🧬 decode battery</b> <span class="chip" style="border-color:#00d27a;color:#00d27a">all tests captured</span></summary>${decodePanel(A, "🚗 ")}</details>` : `${decodePanel(A, "🚗 ")}${A.clone_sheet ? `<div style="margin-top:8px">${cloneSheetHtml(A)}</div>` : ""}`) : `<p class="why" style="font-size:11px">first analysis after ~20 s of driving…</p>`}
        </div>` : `<div class="block" style="border-color:#a371f7"><h3 style="margin-top:0">🚗 Cloning the car you're in</h3><p class="why" style="font-size:12px;margin:0 0 6px">${live.frame && live.frame.on ? "this config has no analysis yet — drive ~20 s" : "not driving — the car you get into becomes the decode subject automatically"}</p><div id="lvDecNext">${nextPanelHtml(null)}</div></div>`) : "";
      const libraryBlock = isLive ? "" : buildLibrary(s);
      const hideDonorDeliverable = isLive && A && A.id === D.id;   // the subject block already shows it
      return `${subject}${libraryBlock}
        <div class="block" style="border-color:#e3b341"><h3 style="margin-top:0">🧬 Decode — clone a build: donor capture → Clone Sheet (the parts) → Bench convergence (the sliders)</h3>
          <p class="why" style="font-size:12px">${pinNote ? pinNote + " · " : ""}${hasRoles || pin ? "Donor: " + (pin ? "📌 pinned — stays until you pick another donor or unpin it" : "from the run roles (🎯 / 🔧)") + "." : isLive ? "Set <b>🎯 DONOR</b> on the locked-tune run and <b>🔧 REPLICA</b> on your rebuild from the stream bar — or pick runs below." : "No run roles in this recording — pick the donor run and the replica run below."} ${sameRun ? "Same run on both sides: a self-check until a replica run exists." : diffCar ? "<b>Different cars on the two sides</b> — a demo comparison; the ledger will be honestly red." : ""}${isLive && pin ? ` <button class="lab-mode" data-unpin style="padding:2px 8px;font-size:11px;margin-left:6px">✕ unpin donor</button>` : ""}</p>
          <div class="lab-bench">
            <div><strong style="color:${dC}">🎯 DONOR / RUN A</strong> <div class="lab-rail">${sD.cars.map((c) => `<span class="chip ${donor === c.id ? "on" : ""}" data-donor="${c.id}">${carLbl(sD, c.id)}</span>`).join("")}${stintChips(donor, "donor", sD)}</div></div>
            <div><strong style="color:${rC}">🔧 REPLICA / RUN B</strong> <div class="lab-rail">${s.cars.map((c) => `<span class="chip ${replica === c.id ? "on" : ""}" data-replica="${c.id}">${carLbl(s, c.id)}</span>`).join("")}${stintChips(replica, "replica", s)}</div></div>
          </div>
          <div class="lab-rail" style="margin-top:10px">${kinds.map(([k, ok]) => `<span class="chip ${ok ? "on" : "missing"}">${ok ? "✓" : "○"} ${k}</span>`).join("")}</div>
        </div>
        ${hideDonorDeliverable ? "" : (() => { const done = !!(D.decode && D.decode.pct >= 1); const lbl = roleStint("donor") ? "🎯 DONOR · " : "donor (picked) · ";
          const prog = D.decode ? `<div class="block" style="border-color:#e3b341">${decodePanel(D, lbl)}</div>` : "";
          const sheet = D.clone_sheet ? `<div class="block" style="${done ? "border-color:#00d27a" : ""}">${cloneSheetHtml(D)}</div>` : "";
          // DELIVERABLE MODE: once every test is captured the sheet leads and the battery folds away
          return done ? `${sheet}<div class="block" style="border-color:#e3b341"><details><summary style="cursor:pointer;font-size:12px"><b>🧬 Decode progress — ${esc(carName(D) || "")}</b> <span class="chip" style="border-color:#00d27a;color:#00d27a">ALL TESTS CAPTURED</span> <span class="why">capture complete — the sheet above is the deliverable; expand for the per-test battery</span></summary>${D.decode ? decodePanel(D, lbl) : ""}</details></div>` : `${prog}${sheet}`; })()}
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
    let es = null, liveUrl = localStorage.getItem("fh6LiveUrl") || "http://localhost:8765";
    const live = { status: null, frame: null, strip: [], corners: [], cars: [], session: null, connected: false, err: false, loaded: null, loop: null, mode: null };
    // the LIVE effective mode (manual override, else daemon suggestion) — pushed to the daemon so its run-split rule matches what you see
    const liveEffMode = () => { const m = labModeSel(); return m !== "auto" ? m : ((live.mode && live.mode.suggest) || "free"); };
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
        <div class="card-row" style="margin-top:0"><strong>🎯 ${s ? carLbl(s, c.id) : (carName(c) || "#" + c.ordinal) + " · " + c.class + " " + c.pi}</strong><span class="chip" style="border-color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"};color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}">confidence ${Math.round(cov.overall * 100)}%</span></div>
        <div class="lab-bar" style="height:8px;margin:6px 0 10px"><i style="width:${cov.overall * 100}%;background:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}"></i></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px">${cov.probes.map((p) => { const ready = p.ready ?? p.confidence >= 1; const frac = p.key === "dyno" || p.key === "gears" || p.key === "warm"; return `<div title="${esc(p.hint)}" style="${needed.has(p.key) ? "outline:1px dashed var(--warn,#e3b341);outline-offset:3px;border-radius:4px" : ""}"><div style="display:flex;justify-content:space-between"><span>${ready ? "✓ " : ""}${needed.has(p.key) ? "🔍 " : ""}${p.label}</span><b style="color:${ready ? "#00d27a" : "var(--muted)"}">${frac ? Math.round(p.count * 100) + "%" : `${p.count}/${p.required}`} <span style="font-weight:400;color:var(--muted)">· ${Math.round(p.confidence * 100)}%</span></b></div><div class="lab-bar"><i style="width:${p.confidence * 100}%;background:${ready ? "#00d27a" : "#2f81f7"}"></i></div>${p.confidence < 0.97 ? `<span class="why" style="font-size:10px">${p.hint}</span>` : ""}</div>`; }).join("")}</div>
        ${adv.length ? `<div style="margin-top:10px">${adv.slice(0, 5).map((a) => `<div style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><span class="lab-light" style="background:${SEV[a.severity]};margin-top:4px"></span><div style="flex:1"><div style="font-size:12px"><strong>${a.text}</strong></div><div class="why" style="font-size:10.5px">${a.evidence} · confidence ${Math.round(a.confidence * 100)}%</div><div class="lab-bar" style="height:4px;margin-top:3px;max-width:220px"><i style="width:${a.confidence * 100}%;background:${SEV[a.severity]}"></i></div></div></div>`).join("")}</div>` : `<p class="why" style="font-size:11px;margin:8px 0 0">no firm suggestions yet — drive the probes above</p>`}
        ${open.length ? `<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:8px"><div style="font-size:11px;color:var(--warn,#e3b341);font-weight:700">🔍 Further testing needed — evidence is split</div>${open.map((a) => `<div style="margin:6px 0"><div style="font-size:12px">${a.text}</div><div class="why" style="font-size:10.5px">${a.evidence} · uncertainty ${Math.round(a.confidence * 100)}%</div><div class="chips" style="margin-top:3px">${(a.needs || []).map((k) => `<span class="chip" style="border-color:var(--warn,#e3b341);color:var(--warn,#e3b341)">drive: ${PLBL[k] || k}</span>`).join("")}</div></div>`).join("")}</div>` : ""}
      </div>`;
    };
    // course MAP from coordinates: reference-lap path + latest lap overlaid + ALL turns of the course (the canonical/established set — matches the turn count — not only the curvature-mapped ones)
    const courseMap = (geo, corners, turns) => {
      const pieces = geo && (geo.paths || (geo.path ? [geo.path] : [])); if (!pieces || !pieces.length) return "";
      const pts = geo.path || pieces.flat(), lp = geo.last_path || (geo.last_paths || []).flat(), layout = geo.layout_paths || []; if (pts.length < 5) return "";
      const all = pts.concat(lp, ...layout.map((l) => l.pts));
      const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const W = 360, H = 240, pad = 18; const sc = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, z1 - z0));
      const X = (x) => pad + (x - x0) * sc + ((W - 2 * pad) - (x1 - x0) * sc) / 2, Y = (z) => H - pad - (z - z0) * sc - ((H - 2 * pad) - (z1 - z0) * sc) / 2;
      const poly = (arr) => arr.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
      // the turn markers = the CANONICAL turns of the course (established across sessions, positions in world coords) — so the map matches the count.
      // A canonical turn is "geometry-confirmed" if a curvature turn sits near it, and "loaded" if a behavioural corner was measured near it this session.
      const canon = (turns && turns.canonical && turns.canonical.length) ? turns.canonical.map((t) => ({ id: t.id, pos: t.pos, dir: t.dir, r: t.radius_m })) : (geo.turns || []).map((g) => ({ id: g.id, pos: g.apex, dir: g.dir, r: g.radius_m }));
      const gTurns = (geo.turns || []).map((g) => g.apex); const nearAny = (pos, list, d) => list.some((q) => (q[0] - pos[0]) ** 2 + (q[1] - pos[1]) ** 2 <= d * d);
      const cornerPos = (corners || []).map((k) => k.pos).filter(Boolean);
      const markers = canon.map((t, i) => ({ n: i + 1, id: t.id, pos: t.pos, dir: t.dir, r: t.r, mapped: nearAny(t.pos, gTurns, 45), loaded: nearAny(t.pos, cornerPos, 45) }));
      return `<svg viewBox="0 0 ${W} ${H}" class="tz-svg" style="max-width:${W}px;background:var(--bg);border-radius:8px">
        ${layout.map((l) => `<polyline fill="none" stroke="var(--muted)" stroke-width="1" opacity=".32" points="${poly(l.pts)}"/>`).join("")}
        ${(geo.last_paths || (lp.length ? [lp] : [])).map((pc) => `<polyline fill="none" stroke="var(--warn,#e3b341)" stroke-width="2" stroke-dasharray="4 3" opacity=".9" points="${poly(pc)}"/>`).join("")}
        ${pieces.map((pc) => `<polyline fill="none" stroke="var(--accent2)" stroke-width="2.5" points="${poly(pc)}"/>`).join("")}
        <circle cx="${X(pts[0][0]).toFixed(1)}" cy="${Y(pts[0][1]).toFixed(1)}" r="4" fill="#00d27a"/><text x="${(X(pts[0][0]) + 6).toFixed(1)}" y="${(Y(pts[0][1]) - 4).toFixed(1)}" fill="#00d27a" font-size="9">start</text>
        ${markers.map((g) => { const col = g.loaded ? "#e5414e" : g.mapped ? "var(--accent)" : "var(--warn,#e3b341)"; return `<g><circle cx="${X(g.pos[0]).toFixed(1)}" cy="${Y(g.pos[1]).toFixed(1)}" r="5" fill="${g.loaded ? "#e5414e" : "var(--bg)"}" stroke="${col}" stroke-width="1.5"><title>Turn ${g.n}${g.dir ? " · " + g.dir : ""}${g.r ? " · r≈" + g.r + " m" : ""} — ${g.loaded ? "loaded in telemetry this session" : g.mapped ? "on the map, not loaded this session (take it at pace)" : "counted from your laps, not yet curvature-mapped (a fast/flat turn)"}</title></circle><text x="${(X(g.pos[0]) + 6).toFixed(1)}" y="${(Y(g.pos[1]) + 3).toFixed(1)}" fill="${col}" font-size="9" font-weight="700">${g.n}</text></g>`; }).join("")}
      </svg>`;
    };
    // ---- course card pieces (also used for atlas-selected tracks that are NOT in the current session: rendered from the track record) ----
    const profileCardHtml = (prof) => { const BB = { heavy: "#e5414e", moderate: "#e3b341", light: "#2f81f7", absent: "#3a4250" }; const DLBL = { low_corner: "low-speed corners", mid_corner: "medium corners", fast_corner: "fast sweepers", braking: "heavy braking", straight: "straights / top-end", elevation: "elevation" }; return prof ? `<div style="margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2)">
          <strong style="font-size:12px">🗺 Course profile — what this track actually demands</strong>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">${["low_corner", "mid_corner", "fast_corner", "braking", "straight", "elevation"].map((k) => { const b = prof.dims[k].band; return `<span class="chip" title="${prof.dims[k].frac != null ? Math.round(prof.dims[k].frac * 100) + "% of the lap" : (prof.dims[k].range_m != null ? prof.dims[k].range_m + " m elevation" : b)}" style="border-color:${BB[b]};color:${b === "absent" ? "var(--muted)" : BB[b]};${b === "absent" ? "text-decoration:line-through" : ""}">${b === "heavy" ? "●●● " : b === "moderate" ? "●● " : b === "light" ? "● " : "○ "}${DLBL[k]}</span>`; }).join("")}</div>
          ${prof.priority.length ? `<p class="why" style="font-size:11px;margin:2px 0"><b>Tune priority here:</b> ${prof.priority.join(" › ")}</p>` : ""}
          ${prof.notes.map((n) => `<p class="why" style="font-size:10.5px;margin:2px 0;color:var(--warn,#e3b341)">⚠ ${n}</p>`).join("")}
        </div>` : ""; };
    const trackRecordHtml = (tr, rn) => { const carLabel = (c) => `${c.name || "#" + String(c.cid).split("|")[0]} · ${c.class || ""} ${c.pi || ""}`.trim(); return tr ? `<div style="margin:8px 0;padding:8px 10px;border:1px solid var(--accent2);border-radius:8px;background:var(--bg2)">
          <div class="card-row" style="margin-top:0"><strong style="font-size:12px">🏁 Track record — ${esc(tr.name || rn)}</strong><span class="chip" style="border-color:var(--accent2);color:var(--accent2)">${tr.laps} lap${tr.laps === 1 ? "" : "s"} · ${tr.attempts || 0} attempt${tr.attempts === 1 ? "" : "s"} · ${tr.sessions} session${tr.sessions === 1 ? "" : "s"} · ${(tr.cars || []).length} car${(tr.cars || []).length === 1 ? "" : "s"}</span></div>
          <div style="font-size:11.5px;margin-top:4px">${tr.best ? `track best <b style="color:#00d27a">${tr.best.best_lap.toFixed(3)} s</b> <span class="why">(${esc(carLabel(tr.best))}${tr.best.session ? ", " + tr.best.session.slice(-6) : ""})</span>` : "no timed lap yet"}${tr.this_session_best ? ` · this session <b>${tr.this_session_best.toFixed(3)} s</b>${tr.delta_to_track_best != null ? ` <span style="color:${tr.delta_to_track_best <= 0 ? "#00d27a" : "var(--warn,#e3b341)"}">(${tr.delta_to_track_best > 0 ? "+" : ""}${tr.delta_to_track_best.toFixed(3)})</span>` : ""}` : ""}</div>
          ${(tr.best_laps || []).length > 1 || ((tr.best_laps || []).length === 1 && (tr.cars || []).length > 1) ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${tr.best_laps.map((b, i) => `<span class="chip" title="session ${b.session}" style="${i === 0 ? "border-color:#00d27a;color:#00d27a" : ""}">${esc(carLabel(b))} · ${b.best_lap.toFixed(3)} s</span>`).join("")}</div>` : ""}
          ${(tr.visits || []).length > 1 ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px;font-size:10.5px"><span class="why">visits:</span>${tr.visits.map((v) => `<span class="chip" title="${v.session}${v.best_car ? " · " + v.best_car : ""}">${v.session.slice(-6)} · ${v.laps}L${v.best_lap ? " · " + v.best_lap.toFixed(2) : ""}</span>`).join("")}</div>` : ""}
          <p class="why" style="font-size:10px;margin:5px 0 0">one record per track — every car and session that visits it adds laps, references and best times here; the turn references below are per car</p>
        </div>` : ""; };
    const mapCardHtml = (geo, corners, turns) => { if (!geo) return ""; const canonN = turns && turns.canonical ? turns.canonical.length : (geo.turns || []).length; const shown = (turns && turns.count) || canonN; const mapped = (geo.turns || []).length;
      return `<div style="margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2)">
          <div class="card-row" style="margin-top:0"><strong style="font-size:12px">🗺 Course map — ${shown} turn${shown === 1 ? "" : "s"}${mapped !== shown ? ` (${mapped} curvature-mapped)` : ""} · ${geo.length_m} m</strong><span class="chip">${geo.from_model ? "best map on record" : "ref lap " + ((geo.ref_lap || {}).lap || "—")}${geo.last_lap ? ` · latest lap ${geo.last_lap.lap} overlaid` : ""}</span></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">${courseMap(geo, corners, turns)}<div style="font-size:10.5px;min-width:150px;max-width:320px"><div><span style="color:var(--accent2)">━</span> course path · <span style="color:var(--warn,#e3b341)">╌</span> latest lap · <span style="color:var(--muted)">─</span> every recorded lap${(geo.layout_paths || []).length ? ` (${geo.layout_paths.length})` : ""}</div><div style="margin-top:3px">turns: <span style="color:#e5414e">●</span> loaded this session · <span style="color:var(--accent)">○</span> on the map, not loaded · <span style="color:var(--warn,#e3b341)">○</span> counted from your laps, not curvature-mapped (fast/flat)</div>${(geo.not_driven || []).length ? `<p class="why" style="font-size:10px;margin:5px 0 0">${geo.not_driven.join(", ")}: mapped turns not loaded this session — take them at pace to register them</p>` : ""}</div></div>
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
        <div class="card-row" style="margin-top:0"><strong>🏟 ${esc(rn)}</strong><span class="chip" style="border-color:var(--accent);color:var(--accent)">from the track record — not visited in this ${src === "live" ? "session" : "recording"}</span></div>
        ${trackRecordHtml(tr, rn)}${m.profile ? profileCardHtml(m.profile) : ""}${geo ? mapCardHtml(geo, [], mTurns) : ""}
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
          <p class="why" style="font-size:10.5px;margin:5px 0 0">${esc(tu.note || "")} · a turn taken badly often shows up as 2–3 detections; it becomes ONE turn as laps accumulate</p>
        </div>` : "";
      const tr = co.track; const trackCard = trackRecordHtml(tr, rn);
      const header = `<div class="card-row" style="margin-top:0"><strong>${co.is_loop ? "📍" : "🏟"} ${esc(rn)}</strong><span class="chip" style="border-color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"};color:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}">course confidence ${Math.round(cov.overall * 100)}% · ${nl} lap${nl === 1 ? "" : "s"}${co.best_lap ? " · best " + co.best_lap.toFixed(3) + " s" : ""}</span></div>`;
      const probes = `<div class="lab-bar" style="height:8px;margin:6px 0 8px"><i style="width:${cov.overall * 100}%;background:${cov.overall >= 0.8 ? "#00d27a" : cov.overall >= 0.45 ? "#e3b341" : "#e5414e"}"></i></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px">${present.map((p) => `<div title="${esc(p.hint)}"><div style="display:flex;justify-content:space-between"><span>${p.ready ? "✓ " : ""}${p.label}</span><b style="color:${p.ready ? "#00d27a" : "var(--muted)"}">${p.count}/${p.required} <span style="font-weight:400;color:var(--muted)">· ${Math.round(p.confidence * 100)}%</span></b></div><div class="lab-bar"><i style="width:${p.confidence * 100}%;background:${p.ready ? "#00d27a" : "#2f81f7"}"></i></div>${p.confidence < 0.97 ? `<span class="why" style="font-size:10px">${p.hint}</span>` : ""}</div>`).join("")}</div>
${absent.length ? `<p class="why" style="font-size:10.5px;margin:6px 0 0">not on this course: ${absent.map((p) => p.label).join(" · ")} — excluded from the goal</p>` : ""}`;
      const laps = `<div style="overflow-x:auto;margin-top:8px"><table style="font-size:11px"><thead><tr><th>run</th><th>car</th><th>label</th><th>lap</th><th>Δ best</th><th>mode</th></tr></thead><tbody>
${co.events.slice().reverse().map((e) => `<tr><td>${e.stint ?? "—"}</td><td>${carLbl(carsS, e.car).split(" · ")[0]}</td><td>${e.label ? `<b>${esc(e.label)}</b>` : `<span class="why">—</span>`}</td><td>${e.best_lap ? e.best_lap.toFixed(3) + " s" : `${e.duration_s}s · ${(e.distance_m / 1000).toFixed(2)} km`}</td><td>${e.delta_s == null ? "—" : e.delta_s === 0 ? `<b style="color:#00d27a">best</b>` : `<span style="color:${e.delta_s > 0 ? "#e5414e" : "#00d27a"}">${e.delta_s > 0 ? "+" : ""}${e.delta_s.toFixed(3)}</span>`}</td><td>${e.mode.replace("timed solo (Rivals / time trial)", "solo")}</td></tr>`).join("")}
</tbody></table></div>`;
      const corners = `${(co.corners || []).length ? `<div style="margin-top:10px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">Turns on this route — the same physical corner across laps and runs (${tu ? `${tu.count} turn${tu.count === 1 ? "" : "s"}${tu.possible ? " + " + tu.possible + " possible" : ""}` : co.corners.length + " identified"})</div>
<div style="overflow-x:auto"><table style="font-size:11px"><thead><tr><th>#</th><th>type</th><th>min mph</th><th>g</th><th>first red</th><th>limiter</th><th>consistency</th><th title="one square per lap: green = detected once · yellow = split into several detections (messy) · hollow = missed">laps (this session)</th><th>samples</th><th title="this turn across EVERY session on this track: passes · presence over all track laps · sessions">track (all sessions)</th></tr></thead><tbody>
${co.corners.map((k) => { const dcol = k.dominant === "front" ? "#2f81f7" : k.dominant === "rear" ? "#e5414e" : "var(--muted)"; const phc = k.dominant_phase ? CM_PC[(k.dominant_phase) - 1] : "var(--muted)"; const LIM = { driver: ["🧑 driver", "#e3b341"], tune: ["🔧 tune", "#2f81f7"], mixed: ["◐ mixed", "var(--muted)"], clean: ["✓ clean", "#00d27a"] }; const lm = LIM[k.limiter || "clean"]; const noteTxt = (k.status === "possible" ? `possible turn — seen on ${k.laps_seen} of ${tu ? tu.laps : "?"} lap${tu && tu.laps === 1 ? "" : "s"}; lap it more to confirm or drop it` + (k.note ? " · " + k.note : "") : k.note); const lapsCell = (k.per_lap || []).map((n, i) => `<span title="lap ${i + 1}: ${n ? n + " detection" + (n > 1 ? "s (messy)" : "") : "missed"}" style="display:inline-block;width:9px;height:9px;margin-right:2px;border-radius:2px;border:1px solid ${n ? (n >= 2 ? "#e3b341" : "#00d27a") : "var(--line)"};background:${n >= 2 ? "#e3b341" : n ? "#00d27a" : "transparent"}"></span>`).join(""); return `<tr ${k.status === "possible" ? 'style="opacity:.55"' : ""} title="apex ${k.pos.join(", ")} · per run: ${esc(k.runs.map((r) => `run ${r.stint}: ${r.mph_min} mph, USI ${r.usi}, ${r.first_red}`).join(" | "))}"><td style="white-space:nowrap"><b>${k.id}</b> ${k.dir === "L" ? "⬅" : "➡"}${k.geo_id ? ` <span class="why">${k.geo_id}</span>` : ""}</td><td>${k.type}</td><td>${k.mph_min}</td><td>${k.lat_g}</td><td><span style="color:${dcol};font-weight:700">${k.dominant === "none" ? "clean" : k.dominant}</span>${k.dominant_phase && k.dominant !== "none" ? ` <span style="color:${phc}">ph ${k.dominant_phase}</span>` : ""}</td><td><span style="color:${lm[1]};font-weight:700">${lm[0]}</span></td><td><div class="lab-bar" style="width:60px;display:inline-block;vertical-align:middle"><i style="width:${k.consistency * 100}%;background:${k.consistency >= 0.75 ? "#00d27a" : k.consistency >= 0.5 ? "#e3b341" : "#e5414e"}"></i></div> ${Math.round(k.consistency * 100)}%</td><td style="white-space:nowrap">${lapsCell}${k.multi >= 0.34 ? ` <span title="detected more than once on ${Math.round(k.multi * 100)}% of its laps — taken inconsistently" style="color:#e3b341;font-weight:700">×</span>` : ""}</td><td>${k.n} (${k.runs.length}r)</td><td style="white-space:nowrap">${k.track ? `<b>${k.track.passes}</b> passes${k.track.presence != null ? ` · <span title="seen on ${k.track.laps_seen} of ${k.track.laps_track} laps on record" style="color:${k.track.presence >= 0.7 ? "#00d27a" : k.track.presence >= 0.4 ? "#e3b341" : "var(--muted)"}">${Math.round(k.track.presence * 100)}% of ${k.track.laps_track} laps</span>` : ""}${k.track.sessions > 1 ? ` · ${k.track.sessions} sessions` : ""}${k.track.dominant && k.track.dominant !== "none" ? ` · <span style="color:${k.track.dominant === "front" ? "#2f81f7" : "#e5414e"}">${k.track.dominant} ${Math.round((k.track.consistency || 0) * 100)}%</span>` : ""}` : "—"}</td></tr>${noteTxt ? `<tr><td></td><td colspan="9" class="why" style="font-size:10.5px;padding-top:0;color:${k.status === "possible" ? "var(--muted)" : k.limiter === "driver" ? "var(--warn,#e3b341)" : k.limiter === "tune" ? "#2f81f7" : "var(--muted)"}">${k.dir === "L" ? "⬅" : "➡"} ${k.id}: ${esc(noteTxt)}</td></tr>` : ""}`; }).join("")}
</tbody></table></div>
<p class="why" style="font-size:10.5px;margin:4px 0 0"><b>🔧 tune</b> = fails on every clean lap → change a slider · <b>🧑 driver</b> = only when you over-drive it → change your line, not the car · <b>◐ mixed</b> = drive it more to separate them · laps: <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#00d27a;vertical-align:middle"></span> seen once · <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#e3b341;vertical-align:middle"></span> split into several detections · <span style="display:inline-block;width:9px;height:9px;border-radius:2px;border:1px solid var(--line);vertical-align:middle"></span> missed</p></div>` : ""}`;
      const driving = `${(co.corners || []).some((k) => k.advice) ? `<div style="margin-top:10px"><div class="card-row" style="margin-top:0"><div style="font-size:11px;color:var(--muted)">${co.model ? `📚 <b>Course learning</b>: ${co.model.turns} turns · ${co.model.laps} laps · ${co.model.sessions} session${co.model.sessions === 1 ? "" : "s"} — geometry transfers to any car · ` : ""}🏋 <b>Course training</b>: your LATEST pass vs your reference (best clean pass of <i>this car</i>)${co.driving && co.driving.predicted ? ` · ${co.driving.predicted} turn${co.driving.predicted === 1 ? "" : "s"} predicted from geometry × your grip until you drive ${co.driving.predicted === 1 ? "it" : "them"}` : ""}${co.driving && co.driving.car_grip ? ` · grip ${Object.values(co.driving.car_grip).filter(Boolean).map((g) => g + " g").join(" / ")}` : ""}</div>${co.driving ? `<span class="chip" style="border-color:${co.driving.on_reference === co.driving.compared && co.driving.compared ? "#00d27a" : "var(--warn,#e3b341)"};color:${co.driving.on_reference === co.driving.compared && co.driving.compared ? "#00d27a" : "var(--warn,#e3b341)"}">${co.driving.on_reference}/${co.driving.compared} turns on reference</span>` : ""}</div>
<div style="overflow-x:auto"><table style="font-size:11px"><thead><tr><th>#</th><th>reference · in → apex → out mph · brake (m before apex)</th><th>your last pass</th><th>Δ</th><th>advice</th></tr></thead><tbody>
${co.corners.filter((k) => k.ref || k.advice).map((k) => { const r = k.ref || {}, l = k.last || {}, d = k.delta || {}; const f = (v) => (v == null ? "—" : v); const sd = (v, unit, inv) => (v == null ? "" : `<span style="color:${Math.abs(v) < 3 ? "var(--muted)" : ((inv ? v > 0 : v < 0) ? "#e5414e" : "#00d27a")}">${v > 0 ? "+" : ""}${v}${unit}</span>`); return `<tr ${k.status === "possible" ? 'style="opacity:.55"' : ""}><td style="white-space:nowrap"><b>${k.id}</b> ${k.dir === "L" ? "⬅" : "➡"} <span class="why">${k.type}${k.radius_m ? " · r≈" + k.radius_m + " m" : ""}</span></td><td>${k.ref ? `${f(r.mph_in)} → <b>${f(r.mph_min)}</b> → ${f(r.mph_out)} · brake ${f(r.brake_on_m)} m${r.first_red ? ` · <span style="color:#e5414e">${r.first_red}</span>` : ""} <span class="why">(${esc(k.ref_src || "")}${r.stint ? ", run " + r.stint : ""})</span>` : "—"}</td><td>${k.last ? `${f(l.mph_in)} → <b>${f(l.mph_min)}</b> → ${f(l.mph_out)} · brake ${f(l.brake_on_m)} m${l.first_red ? ` · <span style="color:#e5414e">${l.first_red}</span>` : ""}${l.stint ? ` <span class="why">(run ${l.stint})</span>` : ""}` : "—"}</td><td style="white-space:nowrap">${k.delta ? `in ${sd(d.mph_in, "", true)} · apex ${sd(d.mph_min, "", false)} · brake ${sd(d.brake_on_m, " m", false)}${d.line_m != null ? ` · line ${d.line_m} m` : ""}` : ""}</td><td style="font-size:11px;color:${k.on_ref ? "#00d27a" : "var(--txt)"}">${k.advice ? esc(k.advice) : ""}</td></tr>`; }).join("")}
</tbody></table></div>
<p class="why" style="font-size:10.5px;margin:4px 0 0">Δ: entry <span style="color:#e5414e">red when faster</span> than the reference (over-driving) · apex <span style="color:#e5414e">red when slower</span> · brake Δ negative = you braked later. The reference is the best CLEAN pass — from this session, or from the course model built on earlier sessions.</p></div>` : ""}`;
      const advice = `${Object.entries(co.advice_by_car || {}).map(([cidk, adv]) => { const firm = adv.filter((a) => !a.open).slice(0, 4), open = adv.filter((a) => a.open); return `<div style="margin-top:8px"><div style="font-size:11px;color:var(--muted)">${carLbl(carsS, cidk)}</div>
${firm.map((a) => `<div style="display:flex;gap:8px;align-items:flex-start;margin:5px 0;${a.minor_here ? "opacity:.5" : ""}"><span class="lab-light" style="background:${SEV[a.severity]};margin-top:4px"></span><div style="flex:1"><div style="font-size:12px"><strong>${a.text}</strong>${a.minor_here ? ` <span class="chip" style="border-color:var(--muted);color:var(--muted)">rarely used on this course</span>` : ""}</div><div class="why" style="font-size:10.5px">${a.evidence} · confidence ${Math.round(a.confidence * 100)}%</div></div></div>`).join("") || `<p class="why" style="font-size:11px;margin:4px 0">no firm suggestions on this course yet</p>`}
${open.length ? `<div style="font-size:11px;color:var(--warn,#e3b341);margin-top:4px">🔍 ${open.map((a) => a.text).join(" · ")}</div>` : ""}</div>`; }).join("")}`;
      return { rn, cov, nl, tu, tr, header, track: trackCard, profile: profileCard, map: mapCardHtml(co.geometry, co.corners, co.turns), turns: turnsCard, probes, laps, corners, driving, advice };
    };
    const courseBlock = (co, s) => { const p = courseParts(co, s); return `<div class="lab-corner" style="border-left:4px solid var(--accent2)">${p.header}${p.track}${p.profile}${p.map}${p.turns}${p.probes}${p.laps}${p.corners}${p.driving}${p.advice}</div>`; };
    // ---- LIVE plumbing: mode banner, stream bar, the live workflow body, and section repaint from the daemon's latest full analysis ----
    function paintBanner() {
      const el = host.querySelector("#lvBanner"); if (!el) return;
      const em = effMode(), ms = labModeSel(), lm = live.mode || {};
      const MODE_LBL = { course: ["🏟 COURSE", "var(--accent2)"], decode: ["🧬 DECODE", "#e3b341"], free: ["🛣 FREE TUNING", "var(--accent)"] };
      const an = live.analysis; const donorSt = an && (an.stints || []).find((x) => x.role === "donor"); const pin = PIN(); const ls = liveSess();
      const donorCar = pin ? ((ls && pin.sid === ls.id && car(ls, pin.key)) || (pin.data && car(pin.data, pin.key)) || null) : (donorSt && (an.cars || []).find((c) => c.id === donorSt.id));
      const dchip = donorCar && donorCar.decode ? `<span class="chip" style="border-color:#e3b341;color:#e3b341" title="${pin ? "pinned donor — stays until you pick another or unpin (Decode tab)" : "donor capture progress — tests only"}">${pin ? "📌 " : ""}🎯 donor ${esc(carName(donorCar) || "")} ${donorCar.decode.ready_n}/${donorCar.decode.total} tests${donorCar.decode.pct >= 1 && donorCar.clone_sheet && donorCar.clone_sheet.confidence != null ? " · 📋 sheet " + Math.round(donorCar.clone_sheet.confidence * 100) + "%" : ""}</span>` : "";
      el.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><span class="chip" style="border-color:${MODE_LBL[em][1]};color:${MODE_LBL[em][1]};font-weight:700">${MODE_LBL[em][0]}</span><span class="why" style="font-size:11px">${ms === "auto" ? "🧭 auto-detected" + (lm.reason ? " — " + esc(lm.reason) : " — waiting for the stream") : "manual — click 🧭 auto to hand detection back"}${live.status && live.status.game === "menu" ? " · in menus / paused" : ""}</span>${dchip}</div>`;
    }
    function streamBar() {
      return `
        <div class="block" style="border-color:#e5414e">
          <div class="card-row" style="margin-top:0"><h3 style="margin:0;font-size:15px">🔴 Live stream</h3><span style="display:inline-flex;align-items:center;gap:6px"><span id="lvStatus" class="chip">connecting…</span><button class="lab-mode" id="lvReset" title="Start a fresh recording — clears the live screen and begins a new session/CSV. Your pinned donor and course records are kept." style="padding:3px 10px;font-size:11px;border-color:#e5414e;color:#e5414e">↺ new session</button><span class="chip" id="lvConnGear" title="connection settings" style="cursor:pointer;padding:3px 8px">⚙</span></span></div>
          <div id="lvConnRow" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><input id="lvUrl" value="${esc(liveUrl)}" style="min-width:240px;padding:5px 8px;border-radius:6px;border:1px solid var(--line);background:var(--bg2);color:var(--txt);font-size:12px"><button class="lab-mode" id="lvConnect" style="font-size:12px">connect</button><span class="why" style="font-size:10.5px">daemon: <code>python scripts/telemetry/fh6_live_daemon.py</code> (<code>--replay captures/&lt;file&gt;.csv</code> to replay)</span></div>
          <div id="lvWfLine" style="margin-top:8px;font-size:12px"></div>
          <div id="lvLoop" style="margin-top:8px"></div>
          <div id="lvStint" style="margin-top:8px"></div>
          <div id="lvSession"></div><div id="lvUnknown"></div>
        </div>`;
    }
    // the session object the live workflows render from: the daemon's latest full analysis (refetched after every analysis), else a thin stand-in built from the SSE analysis payload
    const analysisAsSession = (an) => ({ id: an.id, partial: true, cars: live.cars.length ? live.cars.map((x) => Object.assign({}, x, (an.cars || []).find((y) => y.id === x.id) || {})) : (an.cars || []), stints: an.stints || [], courses: an.courses || [], events: [], launches: [], braking: [], corners: [], pulses: [], strip: [], summary: an.summary || {} });
    // the loaded full session is only trusted when it IS the session the daemon is currently analysing (reconnects / restarts / replays change the id)
    const liveSess = () => { const an = live.analysis; if (!an) return null; const full = live.loaded && live.loaded === an.id && sessions.find((x) => x.id === live.loaded); return full || analysisAsSession(an); };
    const sectionsHtml = (s, isLive) => { const w = effMode(); return w === "course" ? courseSection(s, isLive) : w === "decode" ? decodeSection(s, isLive) : freeSection(s, isLive); };
    function liveBody() {
      const w = effMode();
      return `<div id="lvActiveCar" style="margin-bottom:8px"></div>
        <div id="lvBanner"></div>
        <div class="lab-tiles" id="lvTiles"></div>
        <div id="lvSections">${sectionsHtml(liveSess(), true)}</div>
        ${w === "free" ? `<div class="block"><h3 style="margin-top:0">🩺 Friction — live (Peak% = |combined slip| × 100; needle = slip vector; ring red past 1.0)</h3>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(140px,180px));gap:6px;justify-content:center" id="lvCircles">${circleSvg("FL")}${circleSvg("FR")}${circleSvg("RL")}${circleSvg("RR")}</div>
          <div id="lvInputs" style="max-width:520px;margin:10px auto 0"></div></div>
        <div class="block"><h3 style="margin-top:0">📼 Session strip — growing</h3><div id="lvStrip"></div></div>` : ""}
        ${w !== "decode" ? `<div class="block" style="border-color:#e5414e"><h3 style="margin-top:0">🩺 Corner log — newest first</h3><div class="card-grid" id="lvCorners"></div></div>` : ""}`;
    }
    function paintSections(force) {
      const el = host.querySelector("#lvSections"); if (!el) return;
      const a = document.activeElement; if (!force && a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   // never wipe something being typed — the next analysis repaints (reset / explicit picks force)
      el.innerHTML = sectionsHtml(liveSess(), true); bindBody(el);
    }
    function loadFullSession() {
      fetch(liveUrl + "/session.json").then((r) => r.json()).then((js) => { if (js && js.id && live.analysis && js.id === live.analysis.id) { const i = sessions.findIndex((x) => x.id === js.id); if (i >= 0) sessions[i] = js; else sessions.push(js); live.loaded = js.id; } }).catch(() => {}).then(() => { paintSections(); paintStatus(); paintBanner(); });   // a response that lands after a reset (analysis null / new id) is ignored
    }
    function paintStatus() {
      const el = host.querySelector("#lvStatus"); if (!el) return;
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
          lv.innerHTML = !onCourse ? "" : lo ? `<span class="chip" style="border-color:var(--accent2);color:var(--accent2)">📍 loop “${esc(lo.name)}” · lap ${lo.lap}${lo.last_s ? " · last " + lo.last_s + "s" : ""}</span> <button class="lab-mode" id="lvClearLoop" style="padding:3px 8px;font-size:11px">clear loop</button> <span class="why" style="font-size:11px">drive back through the start to complete a lap</span>${spec}`
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
    function paintFrame() {
      const f = live.frame; if (!f) return;
      updateLiveDec(f); paintDecNext(); paintCourseLive(); paintActiveCar();
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
      // the stream bar's live line follows the WORKFLOW: Course = the event you're in (lap, lap time, distance); Decode = donor capture state; Free = the car and the run
      const wl = host.querySelector("#lvWfLine");
      if (wl) {
        const wf = liveEffMode(); const carNm = f.on ? ((NAMES()[String(f.car)] || {}).name || "#" + f.car) : "—"; const an = live.analysis; let html = "";
        if (wf === "course") {
          const co = an && (an.courses || [])[0]; const rn = co ? (co.name || routeName(co.route_key, null)) : null;
          html = f.on && f.ev ? `<span class="chip" style="border-color:var(--accent2);color:var(--accent2);font-weight:700">🏟 EVENT${rn ? " · " + esc(rn) : ""}</span> lap <b>${f.lapn || 1}</b>${f.lapt ? ` · <b>${f.lapt.toFixed(1)} s</b>` : ""}${f.rpos ? ` · P${f.rpos}` : ""} · ${(f.dist / 1000).toFixed(2)} km${co && co.best_lap ? ` · session best ${co.best_lap.toFixed(3)} s` : ""}${co && co.track && co.track.best ? ` · track best ${co.track.best.best_lap.toFixed(3)} s` : ""}${co && co.track ? ` · ${co.track.laps} laps on record` : ""}${co && co.turns ? ` · ${co.turns.count} turns @ ${Math.round(co.turns.confidence * 100)}%` : ""}${(() => { const ls2 = liveSess(); const cof = ls2 && (ls2.courses || [])[0]; if (!cof) return ""; const ck = courseKnowledge(cof); return ` · <b style="color:${ck.stage === "training" ? "var(--accent2)" : "var(--accent)"}">${ck.stage === "training" ? "📚 TRAINING" : "🏋 TUNING"} ${ck.pct}%</b>`; })()}` : `<span class="chip" style="border-color:var(--accent2);color:var(--accent2)">🏟 COURSE</span> <span class="why">free roam — join an event or lap a marked loop; every attempt becomes a run</span>`;
        } else if (wf === "decode") {
          const pin = PIN(); const ls = liveSess(); const dc = pin ? ((ls && pin.sid === ls.id && car(ls, pin.key)) || (pin.data && car(pin.data, pin.key))) : null;
          html = `<span class="chip" style="border-color:#e3b341;color:#e3b341;font-weight:700">🧬 DECODE</span> ${dc ? `donor <b>${esc(carName(dc) || pin.name || "")}</b>${dc.decode ? ` · ${dc.decode.ready_n}/${dc.decode.total} tests${dc.decode.pct >= 1 && dc.clone_sheet ? " · 📋 sheet " + Math.round((dc.clone_sheet.confidence || 0) * 100) + "%" : ""}` : ""} · driving <b>${esc(carNm)}</b>${f.on ? "" : " (not driving)"}` : `no donor yet — drive the locked-tune car and <b>set as 🎯 DONOR</b> below · driving <b>${esc(carNm)}</b>`}`;
        } else {
          html = `<span class="chip" style="border-color:var(--accent);color:var(--accent);font-weight:700">🛣 FREE TUNING</span> <b>${esc(carNm)}</b>${f.on ? ` · ${f.cls} ${f.pi} · ${f.drv}` : " · not driving"}${an && an.summary ? ` · ${an.summary.corners} corners · ${an.summary.launches} launches · ${an.summary.braking} stops analysed` : ""}`;
        }
        if (wl.dataset.h !== html) { wl.dataset.h = html; wl.innerHTML = html; }
      }
      const tiles = host.querySelector("#lvTiles");
      if (tiles) tiles.innerHTML = [[f.mph.toFixed(0), "mph"], [f.gear === 0 ? "R/N" : f.gear === 11 ? "⇅" : f.gear, "gear"], [f.rpm, "rpm"], [f.lat.toFixed(2), "lat g"], [f.lon.toFixed(2), "long g"], [f.yaw.toFixed(0), "yaw °/s"], [f.hp, "hp"], [f.boost.toFixed(1), "boost psi"], [f.on ? `${f.cls} ${f.pi}` : "—", f.on ? `${(NAMES()[String(f.car)] || {}).name || "#" + f.car} · ${f.drv} ${f.cyl || ""}cyl` : "not driving"], [f.on ? (f.ev ? `EVENT${f.lapn ? " · lap " + f.lapn : ""}${f.rpos ? " · P" + f.rpos : ""}` : "free roam") : "—", f.on && f.ev ? `${(f.dist / 1000).toFixed(2)} km · ${f.lapt ? f.lapt.toFixed(1) + " s" : ""}` : "mode"]]
        .map(([v, l]) => `<div class="lab-tile"><b>${v}</b><span>${l}</span></div>`).join("");
      const inp = host.querySelector("#lvInputs");
      if (inp) inp.innerHTML = `<div style="display:grid;grid-template-columns:60px 1fr;gap:4px 8px;font-size:11px;align-items:center">
          <span>throttle</span><div class="lab-bar" style="height:8px"><i style="width:${f.thr / 2.55}%;background:#00d27a"></i></div>
          <span>brake</span><div class="lab-bar" style="height:8px"><i style="width:${f.brk / 2.55}%;background:#e5414e"></i></div>
          <span>steer</span><div class="lab-bar" style="height:8px"><i style="left:${50 + Math.min(50, Math.max(-50, f.steer / 2.54))}%;width:2px;background:#2f81f7"></i><i style="left:50%;width:1px;background:var(--muted)"></i></div>
          <span>susp</span><div style="display:flex;gap:4px">${f.susp.map((v, i) => `<div class="lab-bar" style="flex:1;height:8px" title="${W4[i]} ${v}"><i style="width:${v * 100}%;background:${v > 0.95 ? "#e5414e" : "#a371f7"}"></i></div>`).join("")}</div>
          <span>temp °F</span><span>${f.temp.map((v, i) => `${W4[i]} <b>${v}</b>`).join(" · ")}${f.hb ? " · <b style='color:#e3b341'>HANDBRAKE</b>" : ""}</span></div>`;
    }
    const W4 = ["FL", "FR", "RL", "RR"];
    function paintStrip() { const el = host.querySelector("#lvStrip"); if (el) el.innerHTML = live.strip.length ? strip({ strip: live.strip.slice(-900), cars: live.cars }) : `<p class="why" style="font-size:11px">waiting for the first second…</p>`; }
    function paintCorners() { const el = host.querySelector("#lvCorners"); if (el) el.innerHTML = live.corners.slice(-12).reverse().map((c) => cornerCard(liveS(), c)).join("") || `<p class="why" style="font-size:11px">no corners yet</p>`; }
    function paintAll(force) { paintStatus(); paintFrame(); paintStrip(); paintCorners(); paintBanner(); paintSections(force); }
    function liveConnect() {
      if (es) { es.close(); es = null; }
      live.loaded = null; carSel = null;   // a (re)connect may be a different daemon / session — never carry a loaded session or a car filter across
      live.connected = false; live.err = false; paintStatus();
      try { es = new EventSource(liveUrl + "/events"); } catch (e) { live.err = true; paintStatus(); return; }
      es.addEventListener("snapshot", (e) => { const d = JSON.parse(e.data); live.strip = d.strip || []; live.corners = d.corners || []; live.cornerLog = []; (d.corners || []).forEach(pushCornerLog); live.cars = d.cars || []; live.session = d.session || null; live.analysis = d.analysis || null; live.stint = d.stint || 0; live.tags = d.tags || {}; live.loop = d.loop || null; if (d.mode) live.mode = d.mode; if (!d.analysis || live.loaded !== d.analysis.id) live.loaded = null; live.connected = true; live.err = false; paintAll(true); onModeChanged(); if (d.analysis) loadFullSession(); });
      es.addEventListener("stint", (e) => { const d = JSON.parse(e.data); live.stint = d.n; paintStatus(); });
      es.addEventListener("loop", (e) => { const d = JSON.parse(e.data); live.loop = d.name ? { name: d.name, lap: d.lap || 0, last_s: null } : null; paintStatus(); });
      es.addEventListener("lap", (e) => { const d = JSON.parse(e.data); if (live.loop) { live.loop = { name: d.loop, lap: d.lap, last_s: d.time_s }; } paintStatus(); });
      es.addEventListener("tag", (e) => { const d = JSON.parse(e.data); live.tags = Object.assign({}, live.tags, { [String(d.n)]: { label: d.label, role: d.role } }); paintStatus(); });
      es.addEventListener("analysis", (e) => { live.analysis = JSON.parse(e.data); live.analysisAt = Date.now(); if (live.dec) decReset(live.dec.cid); paintBanner(); loadFullSession(); });   // the analysis absorbed what the live tracker counted — start the live deltas again
      es.addEventListener("reset", () => { live.strip = []; live.corners = []; live.cornerLog = []; live.analysis = null; live.session = null; live.loaded = null; live.cars = []; carSel = null; donor = replica = null; live._donorPick = live._replicaPick = null; paintAll(true); });
      es.addEventListener("config", (e) => { const c = JSON.parse(e.data); if (!live.cars.find((x) => x.id === c.id)) live.cars.push(c); paintStatus(); });
      fetch(liveUrl + "/cars-map").then((r) => r.json()).then((m) => { live.names = (m && m.cars) || {}; paintStatus(); }).catch(() => {});
      es.addEventListener("frame", (e) => { live.frame = JSON.parse(e.data); paintFrame(); });
      es.addEventListener("strip", (e) => { live.strip.push(JSON.parse(e.data)); paintStrip(); });
      es.addEventListener("corner", (e) => { const c = JSON.parse(e.data); live.corners.push(c); pushCornerLog(c); paintCorners(); decOnCorner(c); paintDecNext(); paintCornerAnalysis(); });
      es.addEventListener("status", (e) => { live.status = JSON.parse(e.data); if (live.status.cars) live.cars = live.status.cars; live.connected = true; live.err = false;
        const sm = live.status.mode; const changed = sm && (!live.mode || sm.suggest !== live.mode.suggest || sm.reason !== live.mode.reason);   // status carries the current mode every second — authoritative after reconnects / daemon restarts
        if (changed) live.mode = sm;
        const gm = live.status.game; const gameChanged = gm !== live._game; live._game = gm;
        paintStatus(); pushMode(); if (changed) onModeChanged(); else if (gameChanged) paintBanner(); });
      es.addEventListener("mode", (e) => { live.mode = JSON.parse(e.data); onModeChanged(); });
      es.addEventListener("session", (e) => { live.session = JSON.parse(e.data); paintStatus(); loadFullSession(); });
      es.onerror = () => { live.connected = false; live.err = true; paintStatus(); };
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
      r.querySelectorAll("[data-car]").forEach((b) => b.addEventListener("click", () => { carSel = b.dataset.car === "all" ? null : b.dataset.car; if (src === "live") paintSections(); else render(); }));
      r.querySelectorAll("[data-donor]").forEach((b) => b.addEventListener("click", () => { donor = b.dataset.donor; if (src === "live") { live._donorPick = donor; const ls = liveSess(); const p = PIN(); pinDonor(ls && car(ls, donor) ? ls : (p && p.data && car(p.data, donor) ? p.data : null), donor); paintSections(true); paintBanner(); } else render(); }));
      bindAtlas(r);
      r.querySelectorAll("[data-tunecid]").forEach((inp) => inp.addEventListener("change", () => { setTune(inp.dataset.tunecid, inp.dataset.tunesl, inp.value); if (src === "live") paintSections(true); else render(); }));
      r.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => { const rl = b.dataset.role; const n = live.stint || (live.frame && live.frame.stint) || 0; if (!n) return;
        fetch(liveUrl + "/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: rl, stint: n }) }).then(() => {
          live.tags = Object.assign({}, live.tags); Object.keys(live.tags).forEach((k) => { if (live.tags[k] && live.tags[k].role === rl) live.tags[k] = Object.assign({}, live.tags[k], { role: null }); }); live.tags[String(n)] = Object.assign({}, live.tags[String(n)], { role: rl });
          if (rl === "donor") { const ls = liveSess(); const cidNow = live.frame && live.frame.cid; if (ls && cidNow) { live._donorPick = null; pinDonor(ls, cidNow + "#" + n); } }
          paintStatus(); if (src === "live") paintSections(true); else render();
        }).catch(() => {});
      }));
      r.querySelectorAll("[data-course-stage]").forEach((b) => b.addEventListener("click", () => { localStorage.setItem("fh6CourseStage", b.dataset.courseStage); if (src === "live") paintSections(true); else render(); }));
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
    }
    function renderBody() {   // live only: rebuild the workflow body beneath the stream bar
      const body = host.querySelector("#lvBody"); if (!body || src !== "live") { render(); return; }
      live._shownWf = effMode(); body.innerHTML = liveBody(); bindBody(body); paintTabs(); paintAll();
    }
    function render() {
      const s = S(); const SRCS = [["live", "🔴 Live stream"], ["session", "📼 Recording"]];
      host.innerHTML = `
        <h2 class="section-title" style="margin-top:0;border-top:none;padding-top:0">📡 Telemetry Lab — Data Out</h2>
        <div class="lab-modes" style="margin-bottom:4px"><span class="why" style="font-size:11px;margin-right:2px">source</span>${SRCS.map(([k, l]) => `<button class="lab-mode ${src === k ? "active" : ""}" data-src="${k}">${l}</button>`).join("")}
          ${src === "session" ? (sessions.length > 1 ? `<select id="labSess">${sessions.map((x, i) => `<option value="${i}" ${i === sIdx ? "selected" : ""}>${x.id}</option>`).join("")}</select>` : s ? `<span class="chip">${s.id} · ${s.frames} frames · ${s.duration_s}s</span>` : "") : ""}</div>
        <div class="lab-modes"><span class="why" style="font-size:11px;margin-right:2px">workflow</span><span id="labWf" style="display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center">${tabsHtml()}</span></div>
        ${src === "live" ? `${streamBar()}<div id="lvBody">${liveBody()}</div>` : !s ? NOSESS : sectionsHtml(s, false)}`;
      live._shownWf = effMode();
      host.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => { src = b.dataset.src; localStorage.setItem("fh6LabSrc", src); carSel = null; donor = replica = null; render(); }));   // run picks ('cid#n') never carry across sources — run numbers restart per session
      bindTabs(); bindBody(host);
      const sel = host.querySelector("#labSess"); if (sel) sel.addEventListener("change", () => { sIdx = +sel.value; carSel = null; donor = replica = null; render(); });
      if (src === "live") { bindLive(); if (!es) liveConnect(); else paintAll(); }
    }
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
