/* ================================================================
   ASHES OF THE NORTH — UI LAYER
   Renders GameEngine state into the DOM and wires up interactions.
   ================================================================ */

const UI = (function () {
  const E = GameEngine, D = GameData;
  let state = null;
  let selectedTile = null;
  let citizenFilter = "idle"; // idle | all | important
  let mapZoom = 30; // px per tile — see ZOOM_MIN/MAX/STEP below
  const ZOOM_MIN = 16, ZOOM_MAX = 56, ZOOM_STEP = 6;

  function init(s) {
    state = s;
    selectedTile = null;
    document.getElementById("settlementTitle").textContent = state.settlementName;
    wireNav();
    wireTurnButton();
    renderAll();
  }

  function getState() { return state; }
  function setState(s) { state = s; selectedTile = null; renderAll(); }

  // ---------------------------------------------------------------
  // NAV
  // ---------------------------------------------------------------
  function wireNav() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
  }
  function switchView(name) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("view-" + name).classList.add("active");
    const btn = document.querySelector('.nav-btn[data-view="' + name + '"]');
    if (btn) btn.classList.add("active");
    renderView(name);
    document.getElementById("views").scrollTop = 0;
  }
  function activeViewName() {
    const el = document.querySelector(".view.active");
    return el ? el.id.replace("view-", "") : "settlement";
  }

  function wireTurnButton() {
    document.getElementById("turnBtn").addEventListener("click", onAdvanceTurn);
  }

  function onAdvanceTurn() {
    if (state.activeEvent) { toast("Resolve the current matter before the month advances."); openEventModal(); return; }
    const chronicleLenBefore = state.chronicle.length;
    const res = E.advanceTurn(state);
    if (!res.ok) { toast(res.reason); return; }
    E.saveGame(state);
    renderAll();
    const newEntries = state.chronicle.slice(chronicleLenBefore);
    if (newEntries.length) toast(newEntries[newEntries.length - 1].text);
    if (state.activeEvent) openEventModal();
  }

  // ---------------------------------------------------------------
  // TOP-LEVEL RENDER
  // ---------------------------------------------------------------
  function renderAll() {
    renderTopbar();
    renderResourceBar();
    renderView(activeViewName());
  }

  function renderView(name) {
    switch (name) {
      case "settlement": renderSettlement(); break;
      case "citizens": renderCitizens(); break;
      case "build": renderBuild(); break;
      case "diplomacy": renderDiplomacy(); break;
      case "explore": renderExplore(); break;
      case "research": renderResearch(); break;
      case "chronicle": renderChronicle(); break;
      case "menu": renderMenu(); break;
    }
  }

  function renderTopbar() {
    const season = E.getSeason(state.meta.month);
    const stageName = D.STAGES.find(s => s.id === state.meta.stage).name;
    document.getElementById("dateDisplay").innerHTML =
      season + ", Year " + state.meta.year + '<span class="stage-tag">' + stageName + '</span>';
    document.getElementById("turnBtnSeason").textContent = season;
  }

  function fmt(v) {
    if (v === undefined || v === null) return "0";
    const r = Math.floor(v);
    return r.toLocaleString();
  }

  function renderResourceBar() {
    const bar = document.getElementById("resourceBar");
    const order = ["food","wood","stone","iron","coin","herbs","tools","weapons","knowledge","influence","stability","reputation"];
    bar.innerHTML = order.map(r => {
      const info = D.RESOURCE_INFO[r];
      const val = state.resources[r] || 0;
      const low = (r === "food" && val < 15) ? " low" : "";
      const abs = info.abstract ? " abstract" : "";
      const suffix = info.max ? "/" + info.max : "";
      return '<div class="res-chip' + low + abs + '" title="' + info.name + '">' +
        '<span class="icon">' + info.icon + '</span><span class="val">' + fmt(val) + suffix + '</span></div>';
    }).join("");
  }

  // ---------------------------------------------------------------
  // SETTLEMENT (MAP)
  // ---------------------------------------------------------------
  function terrainIcon(t) {
    if (t.building) {
      const b = D.BUILDINGS[t.building];
      if (b.ruin) return "⛔";
      if (b.effect && b.effect.housing) return "🏠";
      if (t.building.startsWith("farm")) return "🌾";
      if (t.building === "dock") return "🎣";
      if (t.building.startsWith("workshop")) return "⚒";
      if (t.building === "mine") return "⛏";
      if (t.building.startsWith("market")) return "🏪";
      if (["guardhouse","barracks","trainingyard"].includes(t.building)) return "🛡";
      if (["watchtower","fortkeep","manor"].includes(t.building)) return "🏰";
      if (t.building === "hall") return "🏛";
      if (["school","library","academy"].includes(t.building)) return "📚";
      if (["walls","stonewalls"].includes(t.building)) return "🧱";
      if (["chapel","sanctum"].includes(t.building)) return "⛪";
      if (t.building === "granary") return "🌰";
      if (t.building === "well") return "🪣";
      return "🏗";
    }
    if (t.constructing) return "🚧";
    if (t.terrain === "forest") return "🌲";
    if (t.terrain === "river") return "🌊";
    if (t.terrain === "hills") return "⛰";
    if (t.terrain === "road") return "";
    return "";
  }

  function applyZoom() {
    const gridEl = document.getElementById("mapGrid");
    if (gridEl) gridEl.style.setProperty("--tile-size", mapZoom + "px");
    const lvl = document.getElementById("zoomLevel");
    if (lvl) lvl.textContent = Math.round((mapZoom / 30) * 100) + "%";
  }

  function renderSettlement() {
    const el = document.getElementById("view-settlement");
    // Preserve pan position across a full re-render (triggered whenever game state
    // changes) so building something or advancing a turn doesn't yank the view back
    // to the top-left corner of a now much bigger map.
    const prevWrap = document.getElementById("mapWrap");
    const prevScrollLeft = prevWrap ? prevWrap.scrollLeft : 0;
    const prevScrollTop = prevWrap ? prevWrap.scrollTop : 0;

    let grid = '<div id="mapWrap"><div id="mapGrid" style="grid-template-columns:repeat(' + E.GRID_W + ',var(--tile-size))">';
    for (const t of state.grid) {
      const classes = ["tile", "terrain-" + t.terrain];
      if (t.building) classes.push("has-building");
      if (t.building && E.isRuinTile(t)) classes.push("is-ruin");
      if (t.constructing) classes.push("constructing");
      if (selectedTile && selectedTile.x === t.x && selectedTile.y === t.y) classes.push("selected");
      grid += '<div class="' + classes.join(" ") + '" data-x="' + t.x + '" data-y="' + t.y + '">' + terrainIcon(t) + '</div>';
    }
    grid += '</div></div>';

    const toolbar =
      '<div class="map-toolbar">' +
      '<button class="zoom-btn" id="zoomOutBtn" title="Zoom out">−</button>' +
      '<span class="zoom-level" id="zoomLevel">100%</span>' +
      '<button class="zoom-btn" id="zoomInBtn" title="Zoom in">+</button>' +
      '<button class="zoom-btn" id="zoomFitBtn" title="Reset zoom" style="width:auto;padding:0 10px;font-size:11px">Reset</button>' +
      '<span class="zoom-hint">Pinch or use +/− · swipe to pan</span>' +
      '</div>';

    el.innerHTML =
      '<h2 class="section-title">' + state.settlementName + ' — ' + D.STAGES.find(s => s.id === state.meta.stage).name + '</h2>' +
      '<p class="hint">Tap a tile to inspect it, construct a new building, or upgrade what stands there. Dashed tiles are ruins from before the war.</p>' +
      toolbar +
      grid +
      '<div id="tilePanel"></div>' +
      renderMilitarySummaryCard();

    el.querySelectorAll(".tile").forEach(elm => {
      elm.addEventListener("click", () => {
        const prevSelected = el.querySelector(".tile.selected");
        if (prevSelected) prevSelected.classList.remove("selected");
        elm.classList.add("selected");
        selectedTile = { x: parseInt(elm.dataset.x), y: parseInt(elm.dataset.y) };
        renderTilePanel();
      });
    });

    document.getElementById("zoomInBtn").addEventListener("click", () => {
      mapZoom = clampZoom(mapZoom + ZOOM_STEP);
      applyZoom();
    });
    document.getElementById("zoomOutBtn").addEventListener("click", () => {
      mapZoom = clampZoom(mapZoom - ZOOM_STEP);
      applyZoom();
    });
    document.getElementById("zoomFitBtn").addEventListener("click", () => {
      mapZoom = 30; // default tile size
      applyZoom();
    });

    // Pinch-to-zoom: two-finger touch changes tile size directly, same underlying
    // mapZoom value the +/- buttons use. Deliberately simple (zooms from the map's
    // top-left rather than tracking a pinch centre-point) to keep this robust across
    // devices — swipe/pan after pinching gets you the rest of the way.
    const pinchTarget = document.getElementById("mapWrap");
    let pinchStartDist = null, pinchStartZoom = null;
    pinchTarget.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
        pinchStartZoom = mapZoom;
      }
    }, { passive: true });
    pinchTarget.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && pinchStartDist) {
        e.preventDefault();
        const dist = touchDistance(e.touches[0], e.touches[1]);
        mapZoom = clampZoom(Math.round(pinchStartZoom * (dist / pinchStartDist)));
        applyZoom();
      }
    }, { passive: false });
    pinchTarget.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) { pinchStartDist = null; pinchStartZoom = null; }
    });
    pinchTarget.addEventListener("touchcancel", () => { pinchStartDist = null; pinchStartZoom = null; });

    applyZoom();
    const newWrap = document.getElementById("mapWrap");
    if (newWrap) { newWrap.scrollLeft = prevScrollLeft; newWrap.scrollTop = prevScrollTop; }
    if (selectedTile) renderTilePanel();
  }
  function clampZoom(v) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)); }
  function touchDistance(t0, t1) {
    const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function renderMilitarySummaryCard() {
    const cap = E.capacities(state);
    const str = E.militaryStrength(state).toFixed(1);
    return '<div class="card"><h3>Settlement Overview</h3>' +
      '<div class="row"><span>Population</span><span>' + E.population(state) + ' / ' + cap.housing + ' housed</span></div>' +
      '<div class="row"><span>Military Strength</span><span>' + str + '</span></div>' +
      '<div class="row"><span>Defense</span><span>' + cap.defense.toFixed(0) + '</span></div>' +
      '<div class="row"><span>Legacy Score</span><span>' + E.legacyScore(state) + '</span></div></div>';
  }

  function renderTilePanel() {
    const panel = document.getElementById("tilePanel");
    const t = E.tileAt(state.grid, selectedTile.x, selectedTile.y);
    if (!t) { panel.innerHTML = ""; return; }

    const terrainLabel = t.terrain[0].toUpperCase() + t.terrain.slice(1);
    let headerTitle;
    if (t.constructing) {
      headerTitle = D.BUILDINGS[t.constructing.buildingId].name + " (under construction)";
    } else if (t.building) {
      headerTitle = D.BUILDINGS[t.building].name;
    } else {
      headerTitle = terrainLabel + " (empty)";
    }
    let html = '<div class="card"><h3>' + headerTitle + '</h3><div class="sub">Tile (' + t.x + ', ' + t.y + ') — ' + terrainLabel + ' ground</div>';

    if (t.constructing) {
      const b = D.BUILDINGS[t.constructing.buildingId];
      const pct = Math.round(100 * (1 - t.constructing.remaining / t.constructing.totalTime));
      html += '<div class="sub">' + pct + '% complete, ~' + Math.max(1, t.constructing.remaining) + ' month(s) left</div>';
      html += '<button class="btn danger small" id="cancelBuildBtn">Cancel &amp; Reclaim Materials</button>';
    } else if (t.building) {
      const b = D.BUILDINGS[t.building];
      html += '<div class="sub">' + (b.ruin ? "A ruin from before the war. Restoring it will require materials." : describeBuildingEffect(b)) + '</div>';
      if (!b.ruin) {
        const jobsHere = Object.keys((b.effect && b.effect.jobSlots) || {});
        if (jobsHere.length) {
          // The game tracks workers by job across every building of this type
          // settlement-wide, not per physical tile — so this shows how full each
          // job is overall (a fair, honest stand-in for "who works here" without
          // implying a specific citizen is tied to this exact tile).
          html += '<div class="sub" style="margin-top:4px">Jobs here, settlement-wide occupancy:</div>';
          html += '<div style="margin:4px 0 2px">' + jobsHere.map(j => {
            const used = E.jobCapacityUsed(state, j), max = E.jobCapacityMax(state, j);
            const full = max !== 999 && used >= max;
            return '<span class="tag' + (full ? ' good' : '') + '" style="margin:2px 4px 2px 0">' + D.JOBS[j].name + ' ' + used + '/' + (max === 999 ? '∞' : max) + '</span>';
          }).join("") + '</div>';
        }
        const adj = E.adjacencyBonusForTile(state, t);
        if (adj) html += '<div class="tag good" style="display:block;margin-top:6px;padding:6px 8px">Adjacency: ' + adj.matched.join(" · ") + '</div>';
      }
      const chain = b.chain;
      const idx = chain.indexOf(t.building);
      if (idx < chain.length - 1) {
        const next = D.BUILDINGS[chain[idx + 1]];
        html += '<button class="btn primary small" id="upgradeBtn">Upgrade to ' + next.name + ' (' + costString(next.cost) + ')</button>';
      } else {
        html += '<div class="tag good">Maximum tier reached</div>';
      }
      if (!b.ruin) {
        html += '<button class="btn danger small" id="demolishBtn" style="margin-top:8px;margin-left:6px">Demolish (reclaim 30%)</button>';
      }
    } else {
      const options = E.newBuildOptions(t);
      if (options.length === 0) {
        html += '<div class="sub">Nothing can be built on this tile.</div>';
      } else {
        html += '<div class="sub">Choose a building to construct here:</div>';
        for (const id of options) {
          const b = D.BUILDINGS[id];
          const preview = E.previewAdjacency(state, t.x, t.y, id);
          html += '<button class="btn block small" style="margin-bottom:6px;text-align:left" data-build="' + id + '">' +
            b.name + ' — ' + costString(b.cost) + ' (' + b.buildTime + ' mo)' +
            (preview ? '<br><span style="color:var(--moss);font-size:11px">+ ' + preview.matched.join(", ") + '</span>' : '') +
            '</button>';
        }
      }
    }
    html += '</div>';
    panel.innerHTML = html;

    const cancelBtn = document.getElementById("cancelBuildBtn");
    if (cancelBtn) cancelBtn.addEventListener("click", () => {
      E.cancelConstruction(state, t.x, t.y);
      renderAll();
    });
    const upgradeBtn = document.getElementById("upgradeBtn");
    if (upgradeBtn) upgradeBtn.addEventListener("click", () => {
      const r = E.queueUpgrade(state, t.x, t.y);
      if (!r.ok) toast(r.reason); else toast("Upgrade underway.");
      renderAll();
    });
    const demolishBtn = document.getElementById("demolishBtn");
    if (demolishBtn) demolishBtn.addEventListener("click", () => {
      if (!confirm("Demolish this building? You'll reclaim some materials, but its tier progress is lost.")) return;
      const r = E.demolishBuilding(state, t.x, t.y);
      if (!r.ok) toast(r.reason); else toast("Building cleared — the tile is free again.");
      renderAll();
    });
    panel.querySelectorAll("[data-build]").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = E.queueConstruction(state, t.x, t.y, btn.dataset.build);
        if (!r.ok) toast(r.reason); else toast("Construction underway.");
        renderAll();
      });
    });
  }

  function describeBuildingEffect(b) {
    const parts = [];
    const e = b.effect || {};
    if (e.housing) parts.push("Houses " + e.housing + " residents");
    if (e.defense) parts.push("+" + e.defense + " defense");
    if (e.stability) parts.push("+" + e.stability.toFixed(2) + " stability/mo");
    if (e.influence) parts.push("+" + e.influence.toFixed(2) + " influence/mo");
    if (e.tradeBonus) parts.push("+" + Math.round(e.tradeBonus * 100) + "% trade income");
    if (e.knowledgeMult) parts.push("×" + e.knowledgeMult + " knowledge");
    if (e.yieldMult) parts.push("×" + e.yieldMult + " yield");
    if (e.foodStorage) parts.push(e.foodStorage + " food storage");
    return parts.length ? parts.join(" · ") : "Provides a place to work.";
  }

  function costString(cost) {
    const keys = Object.keys(cost);
    if (keys.length === 0) return "free";
    return keys.map(k => Math.round(cost[k]) + " " + D.RESOURCE_INFO[k].icon).join("  ");
  }

  // ---------------------------------------------------------------
  // CITIZENS
  // ---------------------------------------------------------------
  function renderCitizens() {
    const el = document.getElementById("view-citizens");
    const all = E.livingCitizens(state).slice().sort((a, b) => (b.important - a.important) || a.name.localeCompare(b.name));
    let list = all;
    if (citizenFilter === "idle") list = all.filter(c => !c.job && c.age >= 12);
    if (citizenFilter === "important") list = all.filter(c => c.important);

    el.innerHTML =
      '<h2 class="section-title">People of ' + state.settlementName + '</h2>' +
      '<p class="hint">Population ' + all.length + '. Assign idle residents to jobs — open slots depend on what has been built.</p>' +
      '<div class="row" style="margin-bottom:10px;gap:6px">' +
        '<button class="btn small' + (citizenFilter === "idle" ? " primary" : "") + '" data-filter="idle">Idle</button>' +
        '<button class="btn small' + (citizenFilter === "important" ? " primary" : "") + '" data-filter="important">Notable</button>' +
        '<button class="btn small' + (citizenFilter === "all" ? " primary" : "") + '" data-filter="all">All</button>' +
        '<button class="btn small primary" id="autoAssignBtn" style="margin-left:auto">Auto-Assign Idle</button>' +
      '</div>' +
      '<div class="card">' + (list.length ? list.map(c => citizenRowHtml(c)).join("") : '<div class="empty-state">No one matches this filter.</div>') + '</div>';

    el.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => { citizenFilter = b.dataset.filter; renderCitizens(); }));
    const autoBtn = document.getElementById("autoAssignBtn");
    if (autoBtn) autoBtn.addEventListener("click", () => {
      const n = E.autoAssignIdle(state);
      toast(n > 0 ? n + " resident(s) put to work." : "No open slots for idle residents right now.");
      renderAll();
    });
    el.querySelectorAll(".job-select").forEach(sel => {
      sel.addEventListener("change", () => {
        const cid = sel.dataset.cid;
        if (sel.value === "") { E.unassignJob(state, cid); }
        else { const r = E.assignJob(state, cid, sel.value); if (!r.ok) { toast(r.reason); } }
        renderAll();
      });
    });
  }

  // Builds the <option> list for one specific citizen, excluding that citizen's own
  // current job from the "full" capacity count so they always see their own job as
  // selectable (otherwise anyone in a fully-staffed job would see it wrongly disabled).
  function buildJobOptionsHtml(currentCitizen) {
    let html = '<option value=""' + (!currentCitizen.job ? " selected" : "") + '>— Idle —</option>';
    for (const typeId in D.WORKER_TYPES) {
      html += '<optgroup label="' + D.WORKER_TYPES[typeId].name + '">';
      for (const jobId of D.WORKER_TYPES[typeId].jobs) {
        const isCurrent = currentCitizen.job === jobId;
        const used = E.jobCapacityUsed(state, jobId) - (isCurrent ? 1 : 0);
        const max = E.jobCapacityMax(state, jobId);
        const full = max !== 999 && used >= max;
        html += '<option value="' + jobId + '"' + (full && !isCurrent ? ' disabled' : '') + (isCurrent ? ' selected' : '') + '>' +
          D.JOBS[jobId].name + (max === 999 ? "" : " (" + Math.min(used + 1, max) + "/" + max + ")") +
          (full && !isCurrent ? " — full" : "") + '</option>';
      }
      html += '</optgroup>';
    }
    return html;
  }

  function citizenRowHtml(c) {
    const traitNames = c.traits.map(t => (E.TRAITS.find(x => x.id === t) || {}).name).filter(Boolean).join(", ");
    let familyLine = "";
    if (c.important) {
      const parts = [];
      if (c.partnerId) {
        const partner = state.citizens.find(x => x.id === c.partnerId);
        if (partner) parts.push("married to " + partner.name + (partner.alive ? "" : " (deceased)"));
      }
      if (c.childrenIds && c.childrenIds.length) {
        const names = c.childrenIds.map(id => state.citizens.find(x => x.id === id)).filter(Boolean)
          .map(ch => ch.name + (ch.alive ? "" : " (deceased)"));
        if (names.length) parts.push((names.length === 1 ? "child: " : "children: ") + names.join(", "));
      }
      if (c.parentIds && c.parentIds.length) {
        const names = c.parentIds.map(id => state.citizens.find(x => x.id === id)).filter(Boolean).map(p => p.name);
        if (names.length) parts.push("child of " + names.join(" and "));
      }
      if (parts.length) familyLine = '<div class="citizen-meta" style="color:var(--ember-bright);margin-top:2px">' + parts.join(" · ") + '</div>';
    }
    return '<div class="citizen-row">' +
      '<div><div class="citizen-name">' + (c.important ? '<span class="important-star">★</span>' : '') + c.name + '</div>' +
      '<div class="citizen-meta">Age ' + c.age + (traitNames ? " · " + traitNames : "") + (c.age < 12 ? " · child" : "") + '</div>' +
      familyLine +
      '</div>' +
      (c.age < 12
        ? '<span class="tag">too young</span>'
        : '<select class="job-select" data-cid="' + c.id + '">' + buildJobOptionsHtml(c) + '</select>') +
      '</div>';
  }

  // ---------------------------------------------------------------
  // BUILD OVERVIEW
  // ---------------------------------------------------------------
  const CHAIN_GROUPS = [
    ["house","house2","house3"], ["farm","farm2","farm3"], ["dock"], ["workshop","workshop2"],
    ["mine"], ["market","market2","market3"], ["guardhouse","barracks","trainingyard"],
    ["keep","watchtower","fortkeep","manor"], ["hall"], ["school","library","academy"],
    ["walls","stonewalls"], ["shrine","chapel","sanctum"], ["storehouse","granary"], ["well"]
  ];

  function renderBuild() {
    const el = document.getElementById("view-build");
    const queue = state.grid.filter(t => t.constructing);
    let html = '<h2 class="section-title">Construction</h2>' +
      '<p class="hint">New buildings and upgrades are placed from the Settlement map — select an empty or existing tile there. This page tracks progress and overall development.</p>';

    html += '<div class="card"><h3>Active Construction (' + queue.length + ')</h3>';
    if (queue.length === 0) {
      html += '<div class="empty-state">Nothing under construction. Visit the Settlement map to begin building.</div>';
    } else {
      for (const t of queue) {
        const b = D.BUILDINGS[t.constructing.buildingId];
        const pct = Math.round(100 * (1 - t.constructing.remaining / t.constructing.totalTime));
        html += '<div class="row"><span>' + b.name + ' (' + t.x + ',' + t.y + ')</span><span>' + pct + '%</span></div>';
      }
    }
    html += '</div>';

    html += '<div class="card"><h3>Settlement Development</h3>';
    for (const chain of CHAIN_GROUPS) {
      const built = state.grid.filter(t => chain.includes(t.building));
      const bestTier = built.reduce((m, t) => Math.max(m, D.BUILDINGS[t.building].tier), -1);
      const name = D.BUILDINGS[chain[Math.max(bestTier, 0)]].name;
      html += '<div class="row"><span>' + D.BUILDINGS[chain[0]].name.replace("Ruined ", "") + '</span>' +
        '<span>' + (built.length ? built.length + '× — best: ' + name : '<span class="tag">none built</span>') + '</span></div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // DIPLOMACY
  // ---------------------------------------------------------------
  function renderDiplomacy() {
    const el = document.getElementById("view-diplomacy");
    let html = '<h2 class="section-title">Diplomacy</h2><p class="hint">Nearby factions remember your dealings. Trust affects whether an approach succeeds.</p>';

    html += renderRegionalRelationsCard();

    for (const f of state.factions) {
      const pct = clamp01((f.relationship + 100) / 200) * 100;
      html += '<div class="card">' +
        '<div class="faction-header"><h3>' + f.name + '</h3><span class="tag">' + f.type + '</span></div>' +
        '<div class="sub">' + f.desc + ' — led by ' + f.leader + '</div>' +
        '<div class="rel-bar"><div class="rel-bar-fill" style="width:' + pct + '%"></div><div class="rel-bar-mid"></div></div>' +
        '<div class="sub">Relationship ' + Math.round(f.relationship) + ' · Trust ' + Math.round(f.trust) + (f.tradeAgreement ? ' · <span class="tag good">Trade Agreement</span>' : '') + '</div>' +
        '<div class="grid2" style="margin-top:8px">' +
        D.FACTION_ACTIONS.map(a => '<button class="btn small" data-faction="' + f.id + '" data-action="' + a.id + '">' + a.name +
          (Object.keys(a.cost).length ? ' (' + costString(a.cost) + ')' : '') + '</button>').join("") +
        '</div></div>';
    }
    el.innerHTML = html;
    el.querySelectorAll("[data-faction]").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = E.performFactionAction(state, btn.dataset.faction, btn.dataset.action);
        if (!r.ok) toast(r.reason);
        else toast(r.success ? "The approach was well received." : "The approach did not go as hoped.");
        renderAll();
      });
    });
  }

  function relationLabel(v) {
    if (v <= -50) return { text: "At War", cls: "bad" };
    if (v <= -15) return { text: "Hostile", cls: "bad" };
    if (v < 15) return { text: "Neutral", cls: "" };
    if (v < 50) return { text: "Friendly", cls: "good" };
    return { text: "Allied", cls: "good" };
  }

  // Shows how the region's factions feel about EACH OTHER, not just about the
  // player — only pairs with a notable relationship (|value| >= 15) are shown, sorted
  // by strength, to keep this a quick read rather than a full 10x10 matrix dump.
  function renderRegionalRelationsCard() {
    const pairs = [];
    const seen = new Set();
    for (const f of state.factions) {
      if (!f.relations) continue;
      for (const otherId in f.relations) {
        const key = [f.id, otherId].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const val = f.relations[otherId];
        if (Math.abs(val) < 15) continue;
        const other = state.factions.find(x => x.id === otherId);
        if (!other) continue;
        pairs.push({ a: f.name, b: other.name, val });
      }
    }
    pairs.sort((x, y) => Math.abs(y.val) - Math.abs(x.val));
    if (pairs.length === 0) return "";
    const rows = pairs.slice(0, 8).map(p => {
      const label = relationLabel(p.val);
      return '<div class="row"><span>' + p.a + ' ↔ ' + p.b + '</span><span class="tag ' + label.cls + '">' + label.text + '</span></div>';
    }).join("");
    return '<div class="card"><h3>Regional Relations</h3><p class="sub">How the region\'s factions see each other — this shifts on its own, separate from your own standing with each.</p>' + rows + '</div>';
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // ---------------------------------------------------------------
  // EXPLORATION
  // ---------------------------------------------------------------
  function renderExplore() {
    const el = document.getElementById("view-explore");
    const remaining = state.explorationQueue.length;
    let html = '<h2 class="section-title">Exploration</h2>' +
      '<p class="hint">Scouts (assigned as the Scout job) reduce risk on expeditions. ' + remaining + ' site(s) remain undiscovered nearby.</p>' +
      '<button class="btn primary block" id="exploreBtn" ' + (remaining === 0 ? "disabled" : "") + '>Send an Expedition</button>';

    html += '<div class="card" style="margin-top:12px"><h3>Discovered Sites</h3>';
    if (state.discoveredSites.length === 0) {
      html += '<div class="empty-state">No sites discovered yet.</div>';
    } else {
      for (const id of state.discoveredSites.slice().reverse()) {
        const s = D.EXPLORATION_SITES.find(x => x.id === id);
        html += '<div class="row"><span>' + s.name + '</span><span class="tag">explored</span></div>';
      }
    }
    html += '</div>';

    html += '<div class="card"><h3>Known Monsters of the Region</h3>';
    for (const m of D.MONSTERS) {
      html += '<div class="row"><span>' + m.name + '</span><span class="tag">threat ' + m.threat + '</span></div>';
    }
    html += '</div>';

    el.innerHTML = html;
    const btn = document.getElementById("exploreBtn");
    if (btn) btn.addEventListener("click", () => {
      const r = E.exploreNext(state);
      if (!r.ok) { toast(r.reason); return; }
      toast(r.success ? "The expedition to " + r.site.name + " succeeded." : "The expedition to " + r.site.name + " met trouble.");
      renderAll();
    });
  }

  // ---------------------------------------------------------------
  // RESEARCH / DEVELOPMENT
  // ---------------------------------------------------------------
  function renderResearch() {
    const el = document.getElementById("view-research");
    const branches = {};
    for (const id in D.TECHS) {
      const t = D.TECHS[id];
      branches[t.branch] = branches[t.branch] || [];
      branches[t.branch].push(id);
    }
    let html = '<h2 class="section-title">Governance</h2>' +
      '<p class="hint">Standing edicts shape the settlement for as long as they hold. Development below is a one-time technology tree.</p>';

    html += '<div class="card"><h3>Edicts</h3>';
    for (const id in D.EDICTS) {
      const edict = D.EDICTS[id];
      const record = state.edicts[id];
      const active = !!(record && record.active);
      const sinceTurn = record ? record.sinceTurn : -999;
      const turnsSince = state.meta.turn - sinceTurn;
      const onCooldown = turnsSince < edict.cooldown;
      html += '<div class="row" style="align-items:flex-start">' +
        '<div><strong>' + edict.name + '</strong>' + (active ? ' <span class="tag good">Active</span>' : '') +
        '<div class="sub">' + edict.desc + '</div>' +
        (onCooldown ? '<div class="sub">Can change again in ' + (edict.cooldown - turnsSince) + ' month(s)</div>' : '') + '</div>' +
        '<button class="btn small' + (active ? ' danger' : '') + '" data-edict="' + id + '"' + (onCooldown ? ' disabled' : '') + '>' +
        (active ? 'Repeal' : 'Declare') + '</button>' +
        '</div>';
    }
    html += '</div>';

    for (const branch in branches) {
      html += '<div class="card"><h3>' + branch + '</h3>';
      for (const id of branches[branch]) {
        const t = D.TECHS[id];
        const unlocked = state.techs.unlocked.includes(id);
        const reqsMet = t.requires.every(r => state.techs.unlocked.includes(r));
        const affordable = state.resources.knowledge >= t.cost;
        html += '<div class="row" style="align-items:flex-start">' +
          '<div><strong>' + t.name + '</strong><div class="sub">' + t.desc + '</div>' +
          (t.requires.length ? '<div class="sub">Requires: ' + t.requires.map(r => D.TECHS[r].name).join(", ") + '</div>' : '') + '</div>' +
          (unlocked ? '<span class="tag good">Unlocked</span>' :
            '<button class="btn small' + (reqsMet && affordable ? ' primary' : '') + '" data-tech="' + id + '" ' + (reqsMet ? "" : "disabled") + '>' + t.cost + ' 📜</button>') +
          '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
    el.querySelectorAll("[data-tech]").forEach(btn => btn.addEventListener("click", () => {
      const r = E.researchTech(state, btn.dataset.tech);
      if (!r.ok) toast(r.reason); else toast("New development unlocked.");
      renderAll();
    }));
    el.querySelectorAll("[data-edict]").forEach(btn => btn.addEventListener("click", () => {
      const r = E.toggleEdict(state, btn.dataset.edict);
      if (!r.ok) toast(r.reason); else toast(r.active ? "Edict declared." : "Edict repealed.");
      renderAll();
    }));
  }

  // ---------------------------------------------------------------
  // CHRONICLE
  // ---------------------------------------------------------------
  function renderChronicle() {
    const el = document.getElementById("view-chronicle");
    let html = '<h2 class="section-title">The Chronicle</h2>';
    html += '<div class="card">' + state.chronicle.slice().reverse().map(c =>
      '<div class="chronicle-entry"><span class="date">Year ' + c.year + ', Month ' + c.month + '</span>' + c.text + '</div>'
    ).join("") + '</div>';
    html += '<h2 class="section-title" style="margin-top:16px">Recent Happenings</h2>';
    html += '<div class="card">' + (state.log.length ?
      state.log.map(l => '<div class="log-entry">' + l.text + '</div>').join("") :
      '<div class="empty-state">Nothing notable yet.</div>') + '</div>';
    el.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // MENU (save/load/reset + stats)
  // ---------------------------------------------------------------
  function renderMenu() {
    const el = document.getElementById("view-menu");
    const s = state.stats;
    el.innerHTML =
      '<h2 class="section-title">Menu</h2>' +
      '<div class="card"><h3>Settlement Record</h3>' +
      '<div class="row"><span>Turn</span><span>' + state.meta.turn + '</span></div>' +
      '<div class="row"><span>Deaths</span><span>' + s.deaths + '</span></div>' +
      '<div class="row"><span>Births</span><span>' + s.births + '</span></div>' +
      '<div class="row"><span>Battles Won / Lost</span><span>' + s.battlesWon + ' / ' + s.battlesLost + '</span></div>' +
      '<div class="row"><span>Events Resolved</span><span>' + s.eventsResolved + '</span></div>' +
      '<div class="row"><span>Technologies</span><span>' + state.techs.unlocked.length + ' / ' + Object.keys(D.TECHS).length + '</span></div>' +
      '<div class="row"><span>Legacy Score</span><span>' + E.legacyScore(state) + '</span></div></div>' +
      '<div class="card"><h3>Save Data</h3>' +
      '<button class="btn primary block" id="saveBtn" style="margin-bottom:8px">Save Now</button>' +
      '<button class="btn block" id="newGameBtn" style="margin-bottom:8px">Start a New Settlement…</button>' +
      '<button class="btn danger block" id="resetBtn">Erase Save &amp; Reset</button></div>' +
      '<div class="card"><h3>About</h3><p class="hint" style="margin:0">Ashes of the North is an original fan-made settlement strategy game inspired by the atmosphere of the Northern Kingdoms. No copyrighted assets, text or artwork are used.</p></div>';

    document.getElementById("saveBtn").addEventListener("click", () => { E.saveGame(state); toast("Progress saved."); });
    document.getElementById("newGameBtn").addEventListener("click", () => { if (confirm("Start a new settlement? Unsaved progress on the current one will be lost unless you save first.")) window.startNewGameFlow(); });
    document.getElementById("resetBtn").addEventListener("click", () => { if (confirm("This will permanently erase your save. Continue?")) { E.deleteSave(); window.startNewGameFlow(); } });
  }

  // ---------------------------------------------------------------
  // EVENT MODAL
  // ---------------------------------------------------------------
  function openEventModal() {
    if (!state.activeEvent) return;
    const ev = state.activeEvent;
    const root = document.getElementById("modalRoot");
    root.innerHTML =
      '<div class="modal-overlay"><div class="modal-sheet">' +
      '<h2>' + ev.title + '</h2>' +
      '<p class="body-text">' + ev.text + '</p>' +
      ev.options.map((o, i) => '<button class="option-btn" data-opt="' + i + '">' + o.text + '</button>').join("") +
      '</div></div>';
    root.querySelectorAll("[data-opt]").forEach(btn => {
      btn.addEventListener("click", () => {
        E.resolveEvent(state, parseInt(btn.dataset.opt));
        root.innerHTML = "";
        E.saveGame(state);
        renderAll();
      });
    });
  }

  // ---------------------------------------------------------------
  // TOASTS
  // ---------------------------------------------------------------
  function toast(msg) {
    const stack = document.getElementById("toastStack");
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    stack.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; setTimeout(() => t.remove(), 400); }, 2600);
  }

  return { init, getState, setState, renderAll, openEventModal, toast, switchView };
})();

if (typeof window !== "undefined") window.UI = UI;
if (typeof module !== "undefined") module.exports = UI;
