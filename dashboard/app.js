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
      return `<span class="pib pib-${u.toLowerCase()}"><b>${u}</b>${showCap ? `<i>${PI_CAP[u]}</i>` : ""}</span>`;
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
  const GENERIC_TOK = new Set(["forza", "edition", "the"]);
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
  const allCodesBtn = document.getElementById("allCodesBtn");
  if (allCodesBtn) allCodesBtn.addEventListener("click", openTuneCodesOverlay);
})();
