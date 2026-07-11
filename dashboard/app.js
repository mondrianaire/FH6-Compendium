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
  const fmtCr = (n) => n == null ? "—" : n.toLocaleString("en-US") + " cr";
  const confClass = (c) => c === "verified" ? "conf-verified" : c === "contested" ? "conf-contested" : "conf-probable";
  const confLabel = (c) => c === "verified" ? "✅ verified" : c === "contested" ? "⚠️ contested" : "🟡 probable";
  const fh6Class = (c) => c === "fh6_confirmed" ? "conf-verified" : c === "needs_ingame" ? "conf-contested" : "conf-probable";
  const fh6Label = (c) => c === "fh6_confirmed" ? "✅ FH6" : c === "needs_ingame" ? "❌ in-game" : "🟡 FH6";
  const acqLabel = (d) => d === "easy" ? "🟢 easy to get" : d === "medium" ? "🟡 some effort"
    : (d === "hard" || d === "hard-unconfirmed") ? "🔴 hard / luck-gated" : "";
  const tuneConf = (c) => c === "player-verified" ? "✅ verified" : c === "sourced-unverified" ? "🟡 sourced"
    : c === "suspect" ? "❌ suspect" : "ℹ️ method";
  const tuneLine = (t) => {
    const head = t.code
      ? `<code>${t.code}</code> <span class="acq">${tuneConf(t.confidence)}</span> <span style="font-size:11px;color:var(--muted)">${t.surface || ""}${t.source ? " · " + t.source : ""}</span>`
      : `<span class="acq">${tuneConf(t.confidence)}</span> ${t.method || ""}`;
    return `<div style="padding:4px 0">${head}${t.note ? `<br><span style="font-size:11px;color:var(--muted)">${t.note}</span>` : ""}</div>`;
  };

  // ---- owned-car tracking (localStorage — user state stays local; data/*.json stays facts-only) ----
  const OWNED_KEY = "fh6_owned_cars";
  let owned = {};
  try { owned = JSON.parse(localStorage.getItem(OWNED_KEY)) || {}; } catch (e) { owned = {}; }
  const isOwned = (id) => !!owned[id];
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

  function render() {
    const d = fDiscipline.value, cl = fClass.value;
    const budget = fBudget.value ? Number(fBudget.value) : null;
    const freeOnly = fFreeOnly.checked;

    let list = cars.filter((c) => {
      if (d && !c.disciplines.includes(d)) return false;
      if (cl && c.class !== cl) return false;
      if (budget != null && c.price_credits != null && c.price_credits > budget) return false;
      if (freeOnly && !isFree(c)) return false;
      return true;
    });

    // rank: tier S>A>B, then value_rating, then known price asc
    const tierRank = { S: 0, A: 1, B: 2 };
    list.sort((a, b) =>
      (tierRank[a.tier] - tierRank[b.tier]) ||
      (b.value_rating - a.value_rating) ||
      ((a.price_credits ?? Infinity) - (b.price_credits ?? Infinity))
    );

    document.getElementById("resultCount").textContent =
      `${list.length} car${list.length === 1 ? "" : "s"} match — ranked by tier, then value.`;

    const grid = document.getElementById("recoCards");
    grid.innerHTML = "";
    if (!list.length) { grid.innerHTML = "<p class='empty'>No cars match these filters. Loosen the budget or class.</p>"; return; }
    list.forEach((c, i) => grid.appendChild(card(c, i === 0)));
  }

  function card(c, top) {
    const el = document.createElement("div");
    el.className = "car-card";
    el.innerHTML = `
      <div class="card-row" style="margin-top:0">
        <span class="badge tier-${c.tier}">${top ? "★ TOP PICK • " : ""}TIER ${c.tier}</span>
        <span>${isOwned(c.id) ? '<span class="conf conf-verified">✓ owned</span> ' : ""}<span class="conf ${confClass(c.confidence)}">${confLabel(c.confidence)}</span></span>
      </div>
      <h3>${c.year} ${c.name}</h3>
      <div class="card-row"><span>${c.class} class · ${c.recommended_drivetrain}</span><span class="price">${fmtCr(c.price_credits)}</span></div>
      ${c.acquisition_difficulty ? `<div class="card-row"><span class="acq acq-${c.acquisition_difficulty.split("-")[0]}">${acqLabel(c.acquisition_difficulty)}</span></div>` : ""}
      <div class="value-bar"><span style="width:${c.value_rating * 10}%"></span></div>
      <div class="chips">${c.disciplines.map((d) => `<span class="chip">${DISCIPLINE_LABEL[d] || d}</span>`).join("")}</div>
    `;
    el.addEventListener("click", () => openModal(c));
    return el;
  }

  // ---- modal ----
  const modal = document.getElementById("modal");
  document.getElementById("modalClose").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

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

    document.getElementById("modalContent").innerHTML = `
      <span class="badge tier-${c.tier}">TIER ${c.tier}</span>
      <span class="conf ${confClass(c.confidence)}" style="margin-left:8px">${confLabel(c.confidence)}</span>
      <label style="float:right;cursor:pointer;font-size:13px;user-select:none">
        <input type="checkbox" id="modalOwn" ${isOwned(c.id) ? "checked" : ""} style="cursor:pointer;vertical-align:-2px"> I own this
      </label>
      <h2>${c.year} ${c.name}</h2>
      ${c.use_case ? `<p class="why" style="margin:2px 0 10px"><strong>Use case:</strong> ${c.use_case}</p>` : ""}
      <dl class="kv">
        <dt>Class</dt><dd>${c.class} (${classes[c.class] || "?"})</dd>
        <dt>Disciplines</dt><dd>${c.disciplines.map((d) => DISCIPLINE_LABEL[d] || d).join(", ")}</dd>
        <dt>Drivetrain</dt><dd>${c.drivetrain_stock} stock → ${c.recommended_drivetrain}</dd>
        <dt>Power split</dt><dd>${c.power_split || "—"}</dd>
        <dt>Price</dt><dd>${fmtCr(c.price_credits)}${c.price_note ? `<br><span class="why" style="font-size:12px">${c.price_note}</span>` : ""}</dd>
        ${c.acquisition_difficulty ? `<dt>Get it</dt><dd><span class="acq acq-${c.acquisition_difficulty.split("-")[0]}">${acqLabel(c.acquisition_difficulty)}</span>${c.acquisition ? `<br><span class="why" style="font-size:12px">${c.acquisition}</span>` : ""}${c.easy_alternative ? `<br><span class="why" style="font-size:12px"><strong>Easy alternative:</strong> ${c.easy_alternative}</span>` : ""}</dd>` : ""}
        ${c.tunes && c.tunes.length ? `<dt>Tunes</dt><dd>${c.tunes.map(tuneLine).join("")}${c.alt_tune_note ? `<div style="font-size:11px;color:var(--warn);margin-top:4px">⚠️ ${c.alt_tune_note}</div>` : ""}</dd>` : (c.alt_tune_note ? `<dt>Tunes</dt><dd><div style="font-size:11px;color:var(--warn)">⚠️ ${c.alt_tune_note}</div></dd>` : "")}
        <dt>Acquisition</dt><dd>${c.acquisition || "—"}</dd>
        <dt>Value rating</dt><dd>${c.value_rating}/10</dd>
      </dl>
      <h3>Why this car</h3>
      <p class="why">${c.why}</p>
      ${c.leaderboard_meta ? `<h3>Leaderboard reality check (2026-07-11)</h3><p class="fh6note">${c.leaderboard_meta}</p>` : ""}
      ${c.disciplines_note ? `<p class="fh6note">${c.disciplines_note}</p>` : ""}
      <h3>Mod / upgrade priority (buy in this order)</h3>
      <ol class="why">${c.upgrade_priority.map((u) => `<li>${u}</li>`).join("")}</ol>
      ${tuneHtml}
      ${shareHtml}
    `;
    document.getElementById("modalOwn").addEventListener("change", (e) => setOwned(c.id, e.target.checked));
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
        <p class="why" style="margin:10px 0 0">Tick a car when you get it. Difficulty: 🟢 buy anytime / free-guaranteed · 🟡 deterministic effort (aftermarket spawn, auction) · 🔴 luck- or pay-gated. Click a row for the full card (use case, tunes, how to get it, easy alternatives).</p>
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
        const dRank = { easy: 0, medium: 1, hard: 2, "hard-unconfirmed": 2 };
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
        <td>${c.year} ${c.name}${isOwned(c.id) ? ' <span style="color:var(--accent)">✓</span>' : ""}</td>
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
      `<br><span style="color:var(--warn)">${tv.note}</span>`;
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
      ${levels}
      ${mechanics}
      ${tips}
      ${patches}
      ${retracted}`;
  }

  // ---- init ----
  render();
  buildProgress();
  buildTable();
  buildVariables();
  buildStrategy();
  buildTemplates();
  buildRivals();
  buildEliminator();
})();
