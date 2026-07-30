/* FH6 Tuning Decision Dashboard — reads window.FH6_DB (built from data/*.json). */
(function () {
  const DB = window.FH6_DB;
  if (!DB) { document.body.innerHTML = "<p style='padding:24px'>db.js not loaded. Run <code>node scripts/build-db.mjs</code>.</p>"; return; }

  const cars = DB.metaCars.cars;
  const classes = DB.metaCars.pi_classes;
  const disciplines = DB.metaCars.disciplines;
  const DISCIPLINE_LABEL = {
    road: "Road", touge_street: "Touge / Street", dirt_rally: "Dirt / Rally",
    cross_country: "Cross Country", drag: "Drag"
  };
  // what tuning attributes each race category rewards — shown under the coverage-matrix headers
  const DISCIPLINE_TUNING = {
    road: "grip + balanced power, moderate downforce",
    touge_street: "cornering grip, brakes, downforce, short gearing",
    dirt_rally: "soft suspension, AWD, raised ride height, rally tyres",
    cross_country: "max ride height, AWD, off-road tyres, durability",
    drag: "launch + gearing + power, minimal aero, drag tyres"
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
  const acqLabel = (d) => d === "easy" ? "🟢 easy to get" : d === "medium" ? "🟡 some effort"
    : (d === "hard" || d === "hard-unconfirmed") ? "🔴 luck-gated grind"
    : d === "premium" ? "💰 premium (real money)" : "";
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
  function matchTuneCode(name) {
    const qt = tnorm(name).split(" ").filter(Boolean);
    if (!qt.length) return null;
    const make = qt[0];
    let best = null, bs = 0;
    for (const e of TCODE_INDEX) {
      if (!e.tokens.has(make)) continue;
      const shared = qt.filter((t) => e.tokens.has(t)).length;
      if (shared > bs && shared >= 3) { best = e; bs = shared; }
    }
    return best;
  }
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
  const TMPL_BY_DISC = { road: "Road", touge_street: "Touge", dirt_rally: "Dirt", cross_country: "Cross", drag: "Drag" };
  function pickTemplate(disc) {
    const k = TMPL_BY_DISC[disc]; if (!k) return null;
    return ((DB.tuningTemplates && DB.tuningTemplates.templates) || []).find((t) => (t.label || "").includes(k)) || null;
  }
  function resolveTune(c) {
    const cur = curatedCode(c);
    if (cur && cur.code) return { level: "car", code: cur.code, source: cur.src || "community", note: cur.note };
    const m = matchTuneCode(c.name);
    if (m) return { level: "car", code: m.code, source: "53Rain " + m.cls };
    const disc = (c.disciplines || [])[0];
    const tmpl = pickTemplate(disc);
    if (tmpl) return { level: "template", discipline: disc, tmpl };
    return null;
  }
  const tuneChip = (c) => { const t = resolveTune(c); return !t ? "" : t.level === "car" ? "🔑 car code" : `📋 ${DISCIPLINE_LABEL[t.discipline] || "format"} template`; };

  // ---- owned-car tracking (localStorage — user state stays local; data/*.json stays facts-only) ----
  const OWNED_KEY = "fh6_owned_cars";
  let owned = {};
  try { owned = JSON.parse(localStorage.getItem(OWNED_KEY)) || {}; } catch (e) { owned = {}; }
  // seeded from the real garage read (owned-cars.json) — these show owned by default; localStorage adds more
  const SEED_OWNED = new Set((DB.ownedCars && DB.ownedCars.owned_meta_ids) || []);
  const isOwned = (id) => !!owned[id] || SEED_OWNED.has(id);
  function setOwned(id, val) {
    if (val) owned[id] = true; else delete owned[id];
    try { localStorage.setItem(OWNED_KEY, JSON.stringify(owned)); } catch (e) { /* private mode: state won't persist */ }
    drawGarage();
    render();
  }

  // ---- stamps ----
  document.getElementById("metaStamp").textContent =
    "Meta captured " + DB.metaCars.captured + " — game is new; rankings will shift with patches.";
  document.getElementById("footStamp").textContent = "Built " + DB.builtAt;

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
    let covered = 0, ownedCount = 0;
    const total = CLASS_ORDER.length * disciplines.length;
    const rows = CLASS_ORDER.map((cl) => {
      const cells = disciplines.map((d) => {
        const picks = topForSlot(d, cl, 3);
        const pick = picks[0];
        if (pick) { covered++; if (isOwned(pick.id)) ownedCount++; }
        const cellClass = !pick ? "cov-gap" : isOwned(pick.id) ? "cov-owned" : "cov-have";
        const nm = (p) => `${p.name}${!(expandClass(p.class).includes(cl) && p.disciplines.includes(d)) ? " ↗" : ""}${isOwned(p.id) ? " ✓" : ""}`;
        const label = pick
          ? `<div class="cell-top">${nm(pick)}${codeTip(pick.name, pick)}</div>${picks.slice(1).map((p) => `<div class="cell-alt">${nm(p)}${codeTip(p.name, p)}</div>`).join("")}`
          : "—";
        const title = pick ? `Top picks: ${picks.map((p) => `${p.year} ${p.name} (${p.tier})`).join("  ·  ")}` : "GAP: no evidenced pick in the database yet";
        return `<td class="${cellClass}" data-d="${d}" data-cl="${cl}" title="${title}">${label}</td>`;
      }).join("");
      return `<tr><th>${cl}</th>${cells}</tr>`;
    }).join("");

    host.innerHTML = `
      <div class="block" style="margin-top:0">
        <div class="card-row" style="margin-top:0">
          <h3 style="margin:0">Class × format coverage — a competitive car for every slot</h3>
          <span class="conf conf-probable">${covered}/${total} slots covered · ${ownedCount} owned</span>
        </div>
        <div style="overflow-x:auto;margin-top:8px"><table class="cov-table">
          <thead><tr><th></th>${disciplines.map((d) => `<th>${DISCIPLINE_LABEL[d] || d}${DISCIPLINE_TUNING[d] ? `<span class="col-tune">${DISCIPLINE_TUNING[d]}</span>` : ""}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody></table></div>
        <p class="why" style="margin:8px 0 0">Each cell shows the <strong>top ~3 picks</strong> (bold = best, then runners-up). 🟩 owned · 🟨 pick exists, not owned yet · dim = GAP. ↗ = cross-class build backed by leaderboard evidence. Click a cell for the full ranked list below.</p>
      </div>`;
    host.querySelectorAll("td[data-d]").forEach((td) =>
      td.addEventListener("click", () => {
        fDiscipline.value = td.dataset.d; fClass.value = td.dataset.cl; render();
        document.getElementById("resultCount").scrollIntoView({ behavior: "smooth", block: "center" });
      }));
  }

  function card(c, top) {
    const el = document.createElement("div");
    el.className = "car-card";
    el.innerHTML = `
      <div class="card-row" style="margin-top:0">
        <span>${tmBadge(c)}<span class="badge tier-${c.tier}">${top ? "★ TOP PICK • " : ""}TIER ${c.tier}</span></span>
        <span>${isOwned(c.id) ? '<span class="conf conf-verified">✓ owned</span> ' : ""}<span class="conf ${confClass(c.confidence)}">${confLabel(c.confidence)}</span></span>
      </div>
      <h3>${c.year} ${c.name}${codeTip(c.name, c)}</h3>
      <div class="card-row"><span>${c.class} class · ${c.recommended_drivetrain}</span><span class="price">${fmtCr(c.price_credits)}</span></div>
      ${c.acquisition_difficulty ? `<div class="card-row"><span class="acq acq-${c.acquisition_difficulty.split("-")[0]}">${acqLabel(c.acquisition_difficulty)}</span></div>` : ""}
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
      <h2>${c.year} ${c.name}${codeTip(c.name, c)}</h2>
      ${c.use_case ? `<p class="why" style="margin:2px 0 10px"><strong>Use case:</strong> ${c.use_case}</p>` : ""}
      <dl class="kv">
        <dt>Class</dt><dd>${c.class} (${classes[c.class] || "?"})</dd>
        <dt>Disciplines</dt><dd>${c.disciplines.map((d) => DISCIPLINE_LABEL[d] || d).join(", ")}</dd>
        <dt>Drivetrain</dt><dd>${c.drivetrain_stock} stock → ${c.recommended_drivetrain}</dd>
        <dt>Power split</dt><dd>${c.power_split || "—"}</dd>
        <dt>Price</dt><dd>${fmtCr(c.price_credits)}${c.price_note ? `<br><span class="why" style="font-size:12px">${c.price_note}</span>` : ""}</dd>
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
        if (t.level === "car") return `<h3>Recommended tune <span class="conf conf-probable">🟡 mildly verified</span></h3>
          <div class="share"><code>${t.code}</code> — car-specific · ${t.source}${t.note ? " · " + t.note : ""}</div>
          <p class="why" style="font-size:11px;margin-top:4px">From a reputable community source — verify in-game (Find Tuning Setups).</p>`;
        const tm = t.tmpl;
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
        <ul class="why">${c.also_viable_in.map((v) => `<li><strong>${v.class} ${DISCIPLINE_LABEL[v.discipline] || v.discipline}</strong> — ${v.evidence}</li>`).join("")}</ul>` : ""}
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
        </div>
        <p class="why" style="margin:10px 0 0">Tick a car when you get it. Difficulty: 🟢 buy anytime / free-guaranteed · 🟡 deterministic effort (aftermarket spawn, auction) · 🔴 luck-gated grind (wheelspin RNG / limited-time — money can't help) · 💰 premium (paid DLC/VIP — guaranteed, but costs real money). Click a row for the full card (use case, tunes, how to get it, easy alternatives).</p>
      </div>`;
    header.querySelectorAll(".garage-filter").forEach((b) =>
      b.addEventListener("click", () => { garageFilter = b.dataset.f; drawGarage(); }));

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
      <tbody>${sorted.map((c) => `<tr data-id="${c.id}" style="${isOwned(c.id) ? "opacity:.65" : ""}">
        <td><input type="checkbox" class="own-check" data-id="${c.id}" ${isOwned(c.id) ? "checked" : ""} style="cursor:pointer"></td>
        <td>${c.year} ${c.name}${codeTip(c.name, c)}${isOwned(c.id) ? ' <span style="color:var(--accent)">✓</span>' : ""}</td>
        <td class="why" style="font-size:12px;max-width:300px">${c.use_case || (c.disciplines.map((d) => DISCIPLINE_LABEL[d] || d).join(", "))}</td>
        <td><span class="acq acq-${(c.acquisition_difficulty || "").split("-")[0]}">${acqLabel(c.acquisition_difficulty)}</span></td>
        <td>${c.class}</td>
        <td><span class="badge tier-${c.tier}">${c.tier}</span></td>
        <td class="price">${fmtCr(c.price_credits)}</td>
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
  function buildVariables() {
    const tv = DB.tuningVariables;
    document.getElementById("varOrder").innerHTML =
      "<strong>Tune in this order:</strong> " + tv.tuning_order.map((t, i) => `${i + 1}. ${t.replace(/_/g, " ")}`).join("  →  ") +
      `<br><span style="color:var(--warn)">${tv.note || tv.tuning_order_note || ""}</span>`;
    const host = document.getElementById("varCats");
    host.innerHTML = tv.categories.map((cat) => `
      <div class="varcat">
        <h3>${cat.label}
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
          const poles = v.poles ? `<div class="poles">${v.poles}</div>` : "";
          return `<div class="var-line">
            <span>${v.label}${base != null ? ` <span class="flag">base ${base}</span>` : ""} ${fh6}${poles}</span>
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
          <div class="card-row" style="margin-top:0"><h4 style="margin:0">${a.class} class</h4><span class="conf conf-probable">${(snap.your_standing) || ""}</span></div>
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
    const roadCards = roadTracks.map((t) => {
      const done = t.status === "analyzed" && (t.class_analyses || []).length;
      const body = done ? t.class_analyses.map(analysis).join("")
        : `<p class="why" style="color:var(--warn)">⏳ Awaiting leaderboard — send an in-game Rivals screenshot for this event + the class you race, and I'll fill in the board read, car, acquisition & tune source.</p>`;
      return card(t, body, done ? { cls: "conf-verified", txt: "✅ analyzed" } : { cls: "conf-probable", txt: "scaffold" });
    }).join("");
    const dragCards = dragTracks.map((t) => card(t, dragBody(t), { cls: "conf-verified", txt: "✅ template-driven" })).join("");
    const roadDone = roadTracks.filter((t) => t.status === "analyzed").length;
    const summary = `<div class="block"><h3>Road Racing Rivals — ${roadDone}/${roadTracks.length} analyzed</h3>
      <p class="why">${rt.scaffold_todo || ""}</p>
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
          <div class="car-card" style="cursor:default">
            <div class="card-row" style="margin-top:0">
              <span class="badge tier-${c.class === "S1" || c.class === "S2" ? "S" : c.class === "A" ? "A" : "B"}">${c.class} class</span>
              <span class="conf ${confClass(c.confidence)}">${confLabel(c.confidence)}</span>
            </div>
            <h3 style="font-size:15px">${c.name}${codeTip(c.name, c)}</h3>
            <div class="card-row"><span>${acqDot(c.get)} ${c.acquisition}</span><span class="price">${fmtCr(c.price_credits)}</span></div>
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
      ${cars}
      ${tune}
      ${checklist}
      ${drill}`;
  }

  // ---- tune codes (full 53Rain import) — opened as a modal overlay from the Cars page ----
  function openTuneCodesOverlay() {
    const tc = DB.tuneCodes;
    if (!tc) return;
    const host = document.getElementById("modalContent");
    const rows = [];
    tc.classes.forEach((cl) => cl.cars.forEach((c) => rows.push({ ...c, class: cl.class })));
    const metaCount = rows.filter((r) => r.tag === "meta").length;
    let q = "", clsFilter = "";
    const tagBadge = (t) => t === "meta" ? '<span class="badge tier-S">META</span>'
      : t === "favorite" ? '<span class="badge tier-A">FAV</span>'
      : t === "road" ? '<span class="badge tier-B">ROAD</span>' : "";

    function draw() {
      const ql = q.toLowerCase();
      const list = rows.filter((r) => (!clsFilter || r.class === clsFilter) && (!ql || r.car.toLowerCase().includes(ql)));
      const body = list.map((r) => `<tr class="${r.tag === "meta" ? "row-meta" : ""}">
        <td>${r.car}</td>
        <td><code>${r.code || "—"}</code></td>
        <td>${r.class}</td>
        <td>${tagBadge(r.tag)}</td>
        <td class="why" style="font-size:12px">${r.note || ""}</td>
      </tr>`).join("");
      document.getElementById("tcTableWrap").innerHTML = `<div style="overflow-x:auto"><table>
        <thead><tr><th>Car</th><th>Share code</th><th>Class</th><th>Tag</th><th>Notes</th></tr></thead>
        <tbody>${body}</tbody></table></div>
        <p class="why" style="margin-top:8px">${list.length} of ${rows.length} codes shown${clsFilter ? " · class " + clsFilter : ""}${q ? " · \"" + q + "\"" : ""}.</p>`;
    }

    host.innerHTML = `
      <h2 style="margin-top:0">🔑 Tune codes — 53Rain</h2>
      <p class="why" style="font-size:12px;margin-top:0">${tc.disclaimer}</p>
      <div class="controls" style="margin-bottom:12px">
        <label>Search car<input type="text" id="tcSearch" placeholder="e.g. Supra, 240SX, Golf, Miata"></label>
        <div class="chips" id="tcClass" style="align-self:flex-end">
          ${["", "B", "A", "S1"].map((c) => `<button class="chip tc-cls" data-c="${c}" style="cursor:pointer">${c || "All"}</button>`).join("")}
        </div>
        <span class="why" style="font-size:12px;align-self:flex-end">${rows.length} codes · ${metaCount} 🟢 Meta · <a href="${tc.source_url}" target="_blank" style="color:var(--accent2)">${tc.source}</a></span>
      </div>
      <div id="tcTableWrap"></div>`;
    const search = document.getElementById("tcSearch");
    search.addEventListener("input", () => { q = search.value; draw(); });
    host.querySelectorAll(".tc-cls").forEach((b) => b.addEventListener("click", () => {
      clsFilter = b.dataset.c;
      host.querySelectorAll(".tc-cls").forEach((x) => x.style.borderColor = "var(--line)");
      b.style.borderColor = "var(--accent)";
      draw();
    }));
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
      const g = ownedMatch(c.manufacturer, c.model, c.year);
      const m = metaMatch(c.manufacturer, c.model, c.year);
      const gRar = g ? cleanRar(g.raw.rarity) : null;
      // owned → use the real in-game rarity from the garage (authoritative); else the researched value
      return { ...c, owned: !!g, m, rarity: gRar || c.rarity, rarityVerified: !!gRar };
    });
    const rarRank = (r) => { const k = (r || "").toLowerCase(); return k.includes("legendary") ? 5 : k.includes("forza") ? 5 : k.includes("epic") ? 4 : k.includes("rare") ? 3 : k.includes("common") ? 2 : 0; };
    const rowSort = (a, b) => (a.owned - b.owned) || (rarRank(b.rarity) - rarRank(a.rarity)) || ((b.m ? b.m.value_rating : 0) - (a.m ? a.m.value_rating : 0));

    const fe = enrich(ws.forza_edition).sort(rowSort);
    const feHave = fe.filter((c) => c.owned).length;
    const feRows = fe.map((c) => `<tr${c.owned ? "" : ' style="opacity:.85"'}>
      <td>${confDot(c.confidence)} ${c.year} ${c.manufacturer} ${c.model.replace(/ ?forza edition/i, " FE")}</td>
      <td>${rarBadge("Forza Edition", c.owned)}</td>
      <td>${statusCell(c.owned)}</td>
      <td>${metaVal(c.m, c.meta_note)}</td></tr>`).join("");

    const wx = enrich(ws.wheelspin_exclusive).sort(rowSort);
    const wxHave = wx.filter((c) => c.owned).length;
    const wxRows = wx.map((c) => `<tr${c.owned ? "" : ' style="opacity:.85"'}>
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
    const extraFe = oc.cars.filter((c) => c.fe).filter((c) => !onRoster(c));
    const extraRows = extraFe.map((c) => `<tr><td>${c.year} ${c.manufacturer} ${c.model.replace(/ ?forza edition/i, " FE")}</td><td><span class="badge tm-meta">✓ OWNED</span></td><td class="why" style="font-size:12px">${c.class || ""} ${c.pi || ""} — beyond the cross-source roster</td></tr>`).join("");

    host.innerHTML = `
      <div class="block" style="margin-top:0">
        <h3 style="margin-top:0">🎰 Wheelspin &amp; Forza Edition cars</h3>
        <p class="why">These cars <strong>can't be bought</strong> — only won from Wheelspins / Super Wheelspins (RNG) or reward drops, so they're the collectibles worth tracking. Rows show what you <strong>own</strong> vs still <strong>need</strong>. <strong>Rarity</strong> is the in-game gem tier (grey Common → blue Rare → purple Epic → gold Legendary → green FE); a <strong>✓</strong> means it's confirmed from your garage, otherwise it's from game8 + forzalabs. <strong>Meta value</strong> = whether it's a competitive pick (matched against the 48-car meta list). ● dot = source confidence. No reliable source publishes credit values, so those aren't shown.</p>
      </div>

      <h3>Forza Edition roster — you have ${feHave} / ${fe.length}</h3>
      <p class="why">The FE set the community sources agree on. You own <strong>all cross-source-verified FE cars</strong> plus extras below.</p>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Car</th><th>Rarity</th><th>Status</th><th>Meta value</th></tr></thead>
        <tbody>${feRows}</tbody></table></div>
      ${extraFe.length ? `<h4 style="margin:18px 0 6px">Extra FE cars you own (not on the cross-source roster) — ${extraFe.length}</h4>
      <div style="overflow-x:auto"><table><thead><tr><th>Car</th><th>Status</th><th>Note</th></tr></thead><tbody>${extraRows}</tbody></table></div>` : ""}

      <h3 style="margin-top:26px">Wheelspin-exclusive meta cars — you have ${wxHave} / ${wx.length}</h3>
      <p class="why">Non-FE cars that are still Wheelspin-only. NEED rows are your highest-value luck-gated targets — grind Super Wheelspins (Playlist / level-up rewards) for these.</p>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Car</th><th>Rarity</th><th>Status</th><th>Meta value</th></tr></thead>
        <tbody>${wxRows}</tbody></table></div>
      <p class="why" style="font-size:12px;margin-top:14px">Roster from game8 · insider-gaming · racinggames.gg · destructoid (4 independent sources). Community counts disagree (FE total reported 5–9); your garage holds ${oc.cars.filter((c) => c.fe).length} FE cars, so the real in-game total is higher than any single list. New Wheelspin pulls: add them via the <em>Recently Obtained</em> screenshot workflow.</p>`;
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
  buildEliminator();
  buildTuners();
  const allCodesBtn = document.getElementById("allCodesBtn");
  if (allCodesBtn) allCodesBtn.addEventListener("click", openTuneCodesOverlay);
})();
