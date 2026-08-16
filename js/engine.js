/* ================================================================
   ASHES OF THE NORTH — GAME ENGINE
   Pure logic module. No DOM access here (keeps it testable with
   Node and reusable if the UI layer is ever swapped out).
   ================================================================ */

const GameEngine = (function () {
  const D = (typeof GameData !== "undefined") ? GameData : require("./data.js");

  const SAVE_KEY = "ashesOfTheNorth_save_v1";
  const GRID_W = 20, GRID_H = 14;
  const BASE_CAMP_HOUSING = 14;
  const MAX_NAMED_CITIZENS = 600;

  const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
  const SEASON_FOOD_MULT = { Spring: 0.95, Summer: 1.3, Autumn: 1.15, Winter: 0.35 };
  const SEASON_CONSUMPTION_MULT = { Spring: 1.0, Summer: 0.95, Autumn: 1.0, Winter: 1.25 };
  const SEASON_BUILD_MULT = { Spring: 1.0, Summer: 1.1, Autumn: 1.0, Winter: 0.6 };

  const FIRST_NAMES_M = ["Berengar","Cadmus","Dorn","Edmund","Falk","Godric","Halvar","Ivo","Jaskier","Konrad","Lambert","Merek","Norin","Osric","Perun","Radovan","Sten","Tomas","Ulric","Vesemir","Witold","Yorin","Zdenek","Brom","Corin"];
  const FIRST_NAMES_F = ["Aveline","Branwen","Ciri","Dagny","Elowen","Freya","Gerta","Halka","Idris","Jonna","Kasia","Liska","Marika","Nadia","Orsolya","Petra","Renata","Sabrina","Teodora","Uma","Vessna","Wren","Yolanda","Zora","Brigid"];
  const SURNAMES = ["Ashwood","Barrowfield","Coldwater","Duskmoor","Elderbrook","Farrow","Greymantle","Hollowmere","Ironside","Kestrel","Longmarsh","Millbrook","Norwood","Oakhart","Ravenscroft","Stonewell","Thornbury","Underhill","Vane","Whitcombe"];
  const TRAITS = [
    { id: "hardy",       name: "Hardy",         desc: "Rarely falls ill.", jobBonus: {} },
    { id: "green_thumb", name: "Green-thumbed", desc: "A natural with crops.", jobBonus: { farmer: 0.2 } },
    { id: "quick_hands", name: "Quick-fingered", desc: "Skilled at fine work.", jobBonus: { blacksmith: 0.2, carpenter: 0.2 } },
    { id: "shrewd",      name: "Shrewd",        desc: "A sharp head for trade.", jobBonus: { trader: 0.25 } },
    { id: "devout",      name: "Devout",        desc: "A steadying presence.", jobBonus: { administrator: 0.15 } },
    { id: "bookish",     name: "Bookish",       desc: "Learns quickly.", jobBonus: { teacher: 0.25, scribe: 0.25 } },
    { id: "stouthearted",name: "Stout-hearted", desc: "Steady under pressure.", jobBonus: { guard: 0.2, militia: 0.2 } },
    { id: "restless",    name: "Restless",      desc: "Always looking beyond the walls.", jobBonus: { scout: 0.3 } }
  ];

  let rngState = null; // optional seed hook, unused by default (Math.random)
  function rand() { return Math.random(); }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
  function chance(p) { return rand() < p; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function roundDown(v) { return Math.floor(v); }

  // ---------------------------------------------------------------
  // CITIZEN GENERATION
  // ---------------------------------------------------------------
  let citizenCounter = 0;
  function makeCitizen(age, important, lineage) {
    citizenCounter++;
    const sex = chance(0.5) ? "m" : "f";
    const first = sex === "m" ? pick(FIRST_NAMES_M) : pick(FIRST_NAMES_F);
    const last = pick(SURNAMES);
    lineage = lineage || {};
    const parentIds = lineage.parentIds || [];
    const inheritFrom = lineage.inheritTraitsFrom || []; // array of parent citizen objects
    const traits = [];
    if (inheritFrom.length > 0) {
      // A child of notable parents inherits up to one trait from each parent's pool
      // (weighted, not guaranteed — nature doesn't promise the best of both).
      for (const parent of inheritFrom) {
        if (parent.traits && parent.traits.length && chance(0.6)) {
          const t = pick(parent.traits);
          if (!traits.includes(t)) traits.push(t);
        }
      }
    } else {
      const traitCount = important ? 2 : (chance(0.4) ? 1 : 0);
      for (let i = 0; i < traitCount; i++) {
        const t = pick(TRAITS).id;
        if (!traits.includes(t)) traits.push(t);
      }
    }
    return {
      id: "c" + citizenCounter,
      name: first + " " + last,
      age: (age !== undefined && age !== null) ? age : (16 + Math.floor(rand() * 30)),
      sex, type: null, job: null,
      important: !!important,
      traits,
      loyalty: important ? 50 + Math.floor(rand() * 30) : null,
      happiness: 60,
      alive: true,
      history: important ? (parentIds.length ? [] : ["Joined the settlement."]) : [],
      arrivedTurn: 0,
      // Lineage (Phase 2)
      partnerId: null,
      childrenIds: [],
      parentIds: parentIds
    };
  }

  // ---------------------------------------------------------------
  // GRID GENERATION
  // ---------------------------------------------------------------
  // Shared terrain rule for any (x,y) on the current grid size — used both to build a
  // fresh grid for new games and to extend an existing save's smaller grid (see
  // `migrateGridToNewSize`) without disturbing anything the player has already built.
  function terrainForCoord(x, y) {
    if (x <= 2) return "river";
    if (x >= GRID_W - 4 && y <= 3) return "hills";
    if (y >= GRID_H - 3 && x > 5) return "forest";
    if (y === 7 && x >= 3 && x <= GRID_W - 5) return "road";
    return "field";
  }

  function buildInitialGrid() {
    const grid = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        grid.push({ x, y, terrain: terrainForCoord(x, y), building: null, tier: 0, constructing: null });
      }
    }
    // Place the three ruin anchors near the centre
    setBuilding(grid, 9, 6, "keep");
    setBuilding(grid, 10, 6, "shrine");
    setBuilding(grid, 9, 8, "storehouse");
    return grid;
  }

  // Grows an existing (possibly smaller, pre-Phase-2.1) save's grid out to the current
  // GRID_W x GRID_H without touching a single tile the player already has — every new
  // tile is purely additive. Safe to call on an already-current-size grid (no-op).
  function migrateGridToNewSize(state) {
    const existingCoords = new Set(state.grid.map(t => t.x + "," + t.y));
    let added = 0;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const key = x + "," + y;
        if (existingCoords.has(key)) continue;
        state.grid.push({ x, y, terrain: terrainForCoord(x, y), building: null, tier: 0, constructing: null });
        added++;
      }
    }
    if (added > 0) {
      chronicle(state, "New land to the east and south has been surveyed and opened for settlement — " + added + " new plots await.");
    }
  }

  function tileAt(grid, x, y) { return grid.find(t => t.x === x && t.y === y); }
  function setBuilding(grid, x, y, buildingId) {
    const t = tileAt(grid, x, y);
    t.building = buildingId;
    t.terrain = "settlement";
  }

  // ---------------------------------------------------------------
  // NEW GAME
  // ---------------------------------------------------------------
  function newGame(settlementName) {
    citizenCounter = 0;
    const citizens = [];
    // A handful of important founding characters
    const founder = makeCitizen(38, true);
    founder.name = founder.name; // keep generated name
    founder.history[0] = "Led the survivors here after the war.";
    citizens.push(founder);
    for (let i = 0; i < 4; i++) citizens.push(makeCitizen(20 + Math.floor(rand() * 25), true));
    for (let i = 0; i < 12; i++) citizens.push(makeCitizen(10 + Math.floor(rand() * 45), false));

    const factions = D.FACTIONS.map(f => Object.assign({}, f, { actionsThisTurn: 0, memory: [] }));
    initFactionRelations(factions);

    const state = {
      version: 1,
      settlementName: settlementName || "Ashholm",
      meta: { year: 1271, month: 1, turn: 0, stage: "camp" },
      resources: Object.assign({}, D.STARTING_RESOURCES),
      resourceCap: { food: 120 },
      citizens,
      grid: buildInitialGrid(),
      constructionQueue: [], // {x,y,buildingId,remaining,totalTime}
      factions,
      techs: { unlocked: [] },
      chronicle: [{ year: 1271, month: 1, text: "The settlement of " + (settlementName || "Ashholm") + " was founded among the ruins." }],
      log: [], // rolling recent-events feed for UI
      activeEvent: null,
      explorationQueue: shuffledSiteIds(),
      discoveredSites: [],
      kingdomEffects: [],
      edicts: {},
      scheduledEvents: [], // Phase 2: chained/delayed events queue
      eventCooldowns: {}, // eventId -> last turn fired, reduces repetition over a long game
      flags: { tutorialSeen: false },
      stats: { deaths: 0, births: 0, battlesWon: 0, battlesLost: 0, eventsResolved: 0 }
    };
    logMsg(state, "The settlement of " + state.settlementName + " is founded among the ruins of the old keep.");
    return state;
  }

  function shuffledSiteIds() {
    const ids = D.EXPLORATION_SITES.map(s => s.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  function logMsg(state, text) {
    state.log.unshift({ turn: state.meta.turn, text });
    if (state.log.length > 60) state.log.length = 60;
  }
  function chronicle(state, text) {
    state.chronicle.push({ year: state.meta.year, month: state.meta.month, text });
    logMsg(state, text);
  }

  // ---------------------------------------------------------------
  // COMPUTED VALUES (capacities, multipliers)
  // ---------------------------------------------------------------
  function getSeason(month) { return SEASONS[Math.floor(((month - 1) % 12) / 3)]; }

  function builtTiles(state) {
    return state.grid.filter(t => t.building && !isRuinTile(t));
  }
  function isRuinTile(t) {
    const b = D.BUILDINGS[t.building];
    return b && b.ruin;
  }

  // Core neighbour scan, shared by the post-build lookup and the pre-build preview.
  function computeAdjacencyForRoot(state, x, y, rootId) {
    const neighbours = [
      tileAt(state.grid, x - 1, y), tileAt(state.grid, x + 1, y),
      tileAt(state.grid, x, y - 1), tileAt(state.grid, x, y + 1)
    ].filter(Boolean);
    const totals = {};
    const matched = [];
    for (const n of neighbours) {
      for (const rule of D.ADJACENCY_RULES) {
        if (rule.building !== rootId) continue;
        const terrainMatch = n.terrain === rule.near;
        const nBuilding = n.building && D.BUILDINGS[n.building];
        const buildingMatch = nBuilding && nBuilding.chain && nBuilding.chain[0] === rule.near;
        if (terrainMatch || buildingMatch) {
          for (const k in rule.bonus) totals[k] = round2((totals[k] || 0) + rule.bonus[k]);
          matched.push(rule.desc);
        }
      }
    }
    return Object.keys(totals).length ? { totals, matched } : null;
  }

  // Sums every ADJACENCY_RULES match against this tile's four orthogonal neighbours.
  // Multiple qualifying neighbours stack (a farm bordered by river on two sides gets
  // the irrigation bonus twice) — this is what makes tile placement a real decision.
  function adjacencyBonusForTile(state, t) {
    if (!t || !t.building) return null;
    const b = D.BUILDINGS[t.building];
    if (!b || !b.chain) return null;
    return computeAdjacencyForRoot(state, t.x, t.y, b.chain[0]);
  }

  // Preview what adjacency bonus a NOT-YET-PLACED building would get on this tile,
  // so the UI can help the player plan before they commit resources.
  function previewAdjacency(state, x, y, buildingId) {
    const b = D.BUILDINGS[buildingId];
    if (!b || !b.chain) return null;
    return computeAdjacencyForRoot(state, x, y, b.chain[0]);
  }

  function capacities(state) {
    const cap = { housing: BASE_CAMP_HOUSING, defense: 0, jobSlots: {}, tradeBonus: 0, knowledgeMult: 1, trainingBonus: 0, foodStorage: state.resourceCap.food, adjacencyStabilityFlat: 0 };
    for (const t of state.grid) {
      if (!t.building) continue;
      const b = D.BUILDINGS[t.building];
      if (!b || !b.effect) continue;
      const e = b.effect;
      if (e.housing) cap.housing += e.housing;
      if (e.defense) cap.defense += e.defense;
      if (e.tradeBonus) cap.tradeBonus = Math.max(cap.tradeBonus, e.tradeBonus);
      if (e.knowledgeMult) cap.knowledgeMult = Math.max(cap.knowledgeMult, e.knowledgeMult);
      if (e.trainingBonus) cap.trainingBonus = Math.max(cap.trainingBonus, e.trainingBonus);
      if (e.foodStorage) cap.foodStorage = Math.max(cap.foodStorage, e.foodStorage);
      if (e.jobSlots) {
        for (const j in e.jobSlots) cap.jobSlots[j] = (cap.jobSlots[j] || 0) + e.jobSlots[j];
      }
      const adj = adjacencyBonusForTile(state, t);
      if (adj) {
        if (adj.totals.defense) cap.defense += adj.totals.defense;
        if (adj.totals.tradeBonus) cap.tradeBonus += adj.totals.tradeBonus;
        if (adj.totals.stability) cap.adjacencyStabilityFlat = round2(cap.adjacencyStabilityFlat + adj.totals.stability);
      }
    }
    return cap;
  }

  function jobYieldMult(state, jobId) {
    const job = D.JOBS[jobId];
    let mult = 1;
    if (!job.requiresBuilding || !D.BUILDINGS[job.requiresBuilding]) return mult;
    const rootId = D.BUILDINGS[job.requiresBuilding].chain[0];
    for (const t of state.grid) {
      if (!t.building) continue;
      const b = D.BUILDINGS[t.building];
      if (!b || !b.chain || b.chain[0] !== rootId) continue;
      let tileMult = (b.effect && b.effect.yieldMult) || 1;
      const adj = adjacencyBonusForTile(state, t);
      if (adj && adj.totals.yieldMult) tileMult += adj.totals.yieldMult;
      mult = Math.max(mult, tileMult);
    }
    return mult;
  }

  function techMult(state, key) {
    let mult = 1, flat = 0;
    for (const id of state.techs.unlocked) {
      const t = D.TECHS[id];
      if (!t || !t.effect) continue;
      if (t.effect[key] !== undefined) {
        if (key.endsWith("Flat")) flat += t.effect[key];
        else mult *= t.effect[key];
      }
    }
    return { mult, flat };
  }

  function kingdomMult(state, key) {
    let mult = 1, flat = 0;
    for (const ke of state.kingdomEffects) {
      if (ke.key !== key) continue;
      if (typeof ke.value === "number" && key.toLowerCase().includes("drift")) flat += ke.value;
      else mult *= ke.value;
    }
    return { mult, flat };
  }

  // Same shape as techMult/kingdomMult: scans every currently-active edict for a
  // matching effect key. "Flat" keys (ending in Flat) sum; everything else multiplies.
  function edictMult(state, key) {
    let mult = 1, flat = 0;
    if (!state.edicts) return { mult, flat };
    for (const id in state.edicts) {
      if (!state.edicts[id] || !state.edicts[id].active) continue;
      const def = D.EDICTS[id];
      if (!def || !def.effect || def.effect[key] === undefined) continue;
      if (key.endsWith("Flat")) flat += def.effect[key];
      else mult *= def.effect[key];
    }
    return { mult, flat };
  }

  function toggleEdict(state, edictId) {
    const def = D.EDICTS[edictId];
    if (!def) return { ok: false, reason: "Unknown edict." };
    if (!state.edicts) state.edicts = {};
    const current = state.edicts[edictId] || { active: false, sinceTurn: -999 };
    const turnsSince = state.meta.turn - current.sinceTurn;
    if (turnsSince < def.cooldown) {
      return { ok: false, reason: "This edict was changed too recently — wait " + (def.cooldown - turnsSince) + " more month(s)." };
    }
    state.edicts[edictId] = { active: !current.active, sinceTurn: state.meta.turn };
    chronicle(state, (state.edicts[edictId].active ? "The edict of " + def.name + " was declared." : def.name + " was repealed."));
    return { ok: true, active: state.edicts[edictId].active };
  }

  function livingCitizens(state) { return state.citizens.filter(c => c.alive); }
  function population(state) { return livingCitizens(state).length; }
  function idleCitizens(state) { return livingCitizens(state).filter(c => !c.job && c.age >= 12); }
  function citizensInJob(state, jobId) { return livingCitizens(state).filter(c => c.job === jobId); }

  function militaryStrength(state) {
    let str = 0;
    for (const j in D.JOBS) {
      if (!D.JOBS[j].military) continue;
      str += citizensInJob(state, j).length * D.JOBS[j].military;
    }
    const { mult } = techMult(state, "militaryMult");
    const { mult: emult } = edictMult(state, "militaryMult");
    // Formal allies (see performFactionAction's "alliance" result) lend real strength
    // here — this single function already backs raids, defense event combatChecks,
    // and exploration combat, so an alliance's benefit reaches all of them for free.
    const allyBonus = (state.factions || []).filter(f => f.allied).length * 8;
    return str * mult * emult + allyBonus;
  }

  // ---------------------------------------------------------------
  // JOB ASSIGNMENT
  // ---------------------------------------------------------------
  function jobCapacityUsed(state, jobId) { return citizensInJob(state, jobId).length; }
  function jobCapacityMax(state, jobId) {
    const job = D.JOBS[jobId];
    if (!job.requiresBuilding) return 999; // gathering jobs (lumberjack, scout, herbalist, builder, mason) are uncapped
    return (capacities(state).jobSlots[jobId]) || 0;
  }

  function assignJob(state, citizenId, jobId) {
    const c = state.citizens.find(x => x.id === citizenId && x.alive);
    if (!c) return { ok: false, reason: "No such citizen." };
    if (c.age < 12) return { ok: false, reason: "Too young to work." };
    const job = D.JOBS[jobId];
    if (!job) return { ok: false, reason: "Unknown job." };
    if (jobCapacityUsed(state, jobId) >= jobCapacityMax(state, jobId)) {
      return { ok: false, reason: "No open slots for that job yet — build or upgrade the required building." };
    }
    c.job = jobId;
    c.type = job.type;
    return { ok: true };
  }
  function unassignJob(state, citizenId) {
    const c = state.citizens.find(x => x.id === citizenId && x.alive);
    if (!c) return { ok: false };
    c.job = null;
    return { ok: true };
  }
  function autoAssignIdle(state) {
    const priority = ["farmer","fisherman","lumberjack","builder","miner","trader","blacksmith","carpenter","militia","teacher","herbalist","administrator"];
    let assigned = 0;
    for (const jobId of priority) {
      let idle = idleCitizens(state);
      while (jobCapacityUsed(state, jobId) < jobCapacityMax(state, jobId) && idle.length > 0) {
        const c = idle.shift();
        assignJob(state, c.id, jobId);
        assigned++;
      }
    }
    return assigned;
  }

  // ---------------------------------------------------------------
  // CONSTRUCTION
  // ---------------------------------------------------------------
  function canAfford(state, cost) {
    for (const r in cost) if ((state.resources[r] || 0) < cost[r]) return false;
    return true;
  }
  function pay(state, cost) {
    for (const r in cost) state.resources[r] = round2(state.resources[r] - cost[r]);
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  function newBuildOptions(t) {
    // tier-0, non-ruin buildings that can be freshly placed on this tile
    return Object.keys(D.BUILDINGS).filter(id => {
      const b = D.BUILDINGS[id];
      if (b.tier !== 0 || b.ruin) return false;
      if (b.requiresTile && b.requiresTile !== t.terrain) return false;
      if (!b.requiresTile && (t.terrain === "river" || t.terrain === "hills")) return false;
      return true;
    });
  }

  function queueConstruction(state, x, y, buildingId) {
    const t = tileAt(state.grid, x, y);
    if (!t) return { ok: false, reason: "Invalid tile." };
    if (t.constructing) return { ok: false, reason: "Already under construction." };
    if (t.building) return { ok: false, reason: "Tile occupied — try upgrading instead." };
    const b = D.BUILDINGS[buildingId];
    if (!b || b.tier !== 0 || b.ruin) return { ok: false, reason: "Not a valid new building." };
    if (b.requiresTile && b.requiresTile !== t.terrain) return { ok: false, reason: "Wrong terrain for this building." };
    if (!canAfford(state, b.cost)) return { ok: false, reason: "Not enough resources." };
    pay(state, b.cost);
    t.constructing = { buildingId, remaining: b.buildTime, totalTime: b.buildTime };
    return { ok: true };
  }

  function queueUpgrade(state, x, y) {
    const t = tileAt(state.grid, x, y);
    if (!t || !t.building) return { ok: false, reason: "Nothing here to upgrade." };
    if (t.constructing) return { ok: false, reason: "Already under construction." };
    const cur = D.BUILDINGS[t.building];
    const chain = cur.chain;
    const idx = chain.indexOf(t.building);
    if (idx === chain.length - 1) return { ok: false, reason: "Already at maximum tier." };
    const nextId = chain[idx + 1];
    const next = D.BUILDINGS[nextId];
    if (!canAfford(state, next.cost)) return { ok: false, reason: "Not enough resources." };
    pay(state, next.cost);
    t.constructing = { buildingId: nextId, remaining: next.buildTime, totalTime: next.buildTime, upgrade: true };
    return { ok: true };
  }

  function cancelConstruction(state, x, y) {
    const t = tileAt(state.grid, x, y);
    if (!t || !t.constructing) return { ok: false };
    // Partial refund (50%) of the queued building's cost
    const b = D.BUILDINGS[t.constructing.buildingId];
    for (const r in b.cost) state.resources[r] = round2((state.resources[r] || 0) + b.cost[r] * 0.5);
    t.constructing = null;
    return { ok: true };
  }

  // The three ruin-derived monument chains anchor the settlement's founding story —
  // deliberately not demolishable, same spirit as not letting a player delete their
  // capital. Everything else can be cleared to make way for something better.
  const PROTECTED_CHAIN_ROOTS = ["keep", "shrine", "storehouse"];

  function demolishBuilding(state, x, y) {
    const t = tileAt(state.grid, x, y);
    if (!t) return { ok: false, reason: "Invalid tile." };
    if (!t.building) return { ok: false, reason: "Nothing here to clear." };
    if (t.constructing) return { ok: false, reason: "Cancel the construction in progress instead." };
    const b = D.BUILDINGS[t.building];
    if (!b) return { ok: false, reason: "Unknown building." };
    if (PROTECTED_CHAIN_ROOTS.includes(b.chain[0])) {
      return { ok: false, reason: "This monument is part of the settlement's founding and cannot be torn down." };
    }
    // 30% refund of the CURRENT tier's own cost (not the full cumulative cost of every
    // tier that led to it) — enough to make clearing a mistake forgivable without
    // making demolish-and-rebuild a profitable resource loop.
    for (const r in b.cost) state.resources[r] = round2((state.resources[r] || 0) + b.cost[r] * 0.3);
    const wasName = b.name;
    t.building = null;
    t.tier = 0;
    logMsg(state, wasName + " was cleared to make way for something new.");
    return { ok: true };
  }

  function progressConstruction(state) {
    const builders = citizensInJob(state, "builder").length + citizensInJob(state, "carpenter").length + citizensInJob(state, "mason").length;
    const season = getSeason(state.meta.month);
    const speed = SEASON_BUILD_MULT[season];
    let bonusTicks = Math.floor(builders / 3);
    const queue = state.grid.filter(t => t.constructing).sort((a, b) => (a.constructing.remaining - b.constructing.remaining));
    for (const t of queue) {
      let dec = speed >= 1 ? 1 : (chance(speed) ? 1 : 0);
      if (bonusTicks > 0) { dec += 1; bonusTicks--; }
      t.constructing.remaining -= dec;
      if (t.constructing.remaining <= 0) {
        const finishedId = t.constructing.buildingId;
        const wasRuin = isRuinTile(t);
        t.building = finishedId;
        t.tier = D.BUILDINGS[finishedId].tier;
        t.constructing = null;
        const bdef = D.BUILDINGS[finishedId];
        if (bdef.tier >= 2 || wasRuin) {
          chronicle(state, (bdef.name) + " was completed" + (wasRuin ? ", raised from the old ruins." : "."));
        } else {
          logMsg(state, bdef.name + " construction completed.");
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // ECONOMY TURN
  // ---------------------------------------------------------------
  function runProduction(state) {
    const season = getSeason(state.meta.month);
    const cap = capacities(state);
    const { mult: workerAvailMult } = kingdomMult(state, "workerAvailability");
    const totals = {};
    const traitBonusFor = (c, jobId) => {
      let b = 0;
      for (const tr of c.traits) {
        const trait = TRAITS.find(x => x.id === tr);
        if (trait && trait.jobBonus && trait.jobBonus[jobId]) b += trait.jobBonus[jobId];
      }
      return b;
    };
    for (const jobId in D.JOBS) {
      const job = D.JOBS[jobId];
      const workers = citizensInJob(state, jobId);
      if (workers.length === 0) continue;
      const effectiveWorkers = workers.length * (workerAvailMult || 1);
      let seasonMult = 1;
      if (job.seasonal) seasonMult = SEASON_FOOD_MULT[season];
      const buildingMult = jobYieldMult(state, jobId);
      for (const res in (job.produces || {})) {
        let amount = job.produces[res] * effectiveWorkers * seasonMult * buildingMult;
        if (res === "food") {
          const { mult: fmult } = techMult(state, "farmYieldMult");
          const { mult: kfmult } = kingdomMult(state, "farmYieldMult");
          const { mult: efmult } = edictMult(state, "farmYieldMult");
          amount *= fmult * kfmult * efmult;
        }
        if (res === "coin") {
          const { mult: cmult } = techMult(state, "coinMult");
          const { mult: kcmult } = kingdomMult(state, "coinMult");
          const { mult: ecmult } = edictMult(state, "coinMult");
          amount *= cmult * kcmult * ecmult * (1 + cap.tradeBonus);
        }
        if (res === "knowledge") {
          const { mult: kmult } = techMult(state, "knowledgeMult");
          const { mult: ekmult } = edictMult(state, "knowledgeMult");
          amount *= kmult * ekmult * cap.knowledgeMult;
        }
        // trait bonuses (approximate: apply average bonus across assigned workers)
        let traitTotal = 0;
        for (const c of workers) traitTotal += traitBonusFor(c, jobId);
        amount *= (1 + traitTotal / Math.max(1, workers.length));
        totals[res] = (totals[res] || 0) + amount;
      }
      for (const res in (job.consumes || {})) {
        const amount = job.consumes[res] * effectiveWorkers;
        totals[res] = (totals[res] || 0) - amount;
      }
      if (job.sideEffect) {
        for (const res in job.sideEffect) totals[res] = (totals[res] || 0) + job.sideEffect[res] * workers.length;
      }
    }
    for (const res in totals) {
      state.resources[res] = round2((state.resources[res] || 0) + totals[res]);
    }
    // stability abstract drift from tech + kingdom + edicts
    const { flat: stabFlat } = techMult(state, "stabilityFlat");
    const { flat: stabDrift } = kingdomMult(state, "stabilityDrift");
    const { flat: stabEdict } = edictMult(state, "stabilityFlat");
    const adjStab = cap.adjacencyStabilityFlat || 0;
    state.resources.stability = clamp(round2(state.resources.stability + stabFlat + stabDrift + stabEdict + adjStab), 0, 100);
    return totals;
  }

  function runConsumption(state) {
    const season = getSeason(state.meta.month);
    const pop = population(state);
    const perCapita = 0.24 * SEASON_CONSUMPTION_MULT[season];
    const consumption = round2(pop * perCapita);
    state.resources.food = round2(state.resources.food - consumption);
    const cap = capacities(state);
    if (state.resources.food > cap.foodStorage) state.resources.food = cap.foodStorage;
    if (state.resources.food < 0) {
      const deficit = -state.resources.food;
      state.resources.food = 0;
      state.resources.stability = clamp(round2(state.resources.stability - 6), 0, 100);
      logMsg(state, "Food ran short this month. The settlement goes hungry.");
      if (chance(clamp(deficit / (pop + 5), 0.05, 0.4))) {
        killRandomCitizen(state, "starvation");
      }
    }
    return consumption;
  }

  function killRandomCitizen(state, cause) {
    const alive = livingCitizens(state);
    if (alive.length === 0) return;
    const victim = pick(alive);
    victim.alive = false;
    state.stats.deaths++;
    if (victim.important) {
      chronicle(state, victim.name + " has died" + (cause === "starvation" ? " of hunger." : cause === "battle" ? " in battle." : ".") + " Their memory will be recorded.");
      handleSuccession(state, victim);
    } else {
      logMsg(state, "A resident named " + victim.name + " has died" + (cause ? " (" + cause + ")" : "") + ".");
    }
  }

  // When a notable citizen dies: free their partner to remarry (with a note in their
  // own history), and — if they left living children — name the eldest as successor.
  // This is what makes a death land as something instead of a stat decrement.
  function handleSuccession(state, victim) {
    if (victim.partnerId) {
      const partner = state.citizens.find(c => c.id === victim.partnerId);
      if (partner && partner.alive) {
        partner.partnerId = null;
        partner.history.push("Widowed by the death of " + victim.name + ".");
      }
    }
    if (victim.childrenIds && victim.childrenIds.length) {
      const livingChildren = victim.childrenIds
        .map(id => state.citizens.find(c => c.id === id))
        .filter(c => c && c.alive)
        .sort((a, b) => b.age - a.age);
      if (livingChildren.length) {
        const successor = livingChildren[0];
        successor.loyalty = clamp((successor.loyalty || 50) + 10, 0, 100);
        successor.history.push("Took up " + victim.name + "'s place after their death.");
        chronicle(state, successor.name + " succeeds " + victim.name + " as head of their line.");
      }
    }
  }

  // Marriage and birth attempts for the notable-citizen pool (see makeCitizen's
  // `lineage` param). Deliberately scoped to important citizens rather than the full
  // population — simulating marriage/inheritance for all ~220 possible residents would
  // be both a performance and a UI-clutter problem for no real gameplay benefit.
  function isCloseRelative(a, b) {
    if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
    if (a.parentIds.length && b.parentIds.length && a.parentIds.some(p => b.parentIds.includes(p))) return true;
    return false;
  }

  function attemptMarriages(state) {
    const notables = livingCitizens(state).filter(c => c.important && !c.partnerId && c.age >= 18);
    const commoners = livingCitizens(state).filter(c => !c.important && !c.partnerId && c.age >= 18);
    for (const c of notables) {
      if (c.partnerId) continue; // may have just been paired earlier in this same pass
      if (!chance(0.03)) continue;
      let pool = (chance(0.6) ? notables : commoners).filter(o => o.id !== c.id && !o.partnerId && !isCloseRelative(c, o));
      if (pool.length === 0) pool = commoners.filter(o => o.id !== c.id && !o.partnerId && !isCloseRelative(c, o));
      if (pool.length === 0) continue;
      const partner = pick(pool);
      c.partnerId = partner.id;
      partner.partnerId = c.id;
      if (!partner.important) {
        partner.important = true;
        partner.loyalty = 50 + Math.floor(rand() * 20);
        partner.history.push("Married into the founding lines.");
      }
      c.history.push("Married " + partner.name + ".");
      partner.history.push("Married " + c.name + ".");
      chronicle(state, c.name + " and " + partner.name + " were married.");
    }
  }

  function attemptBirths(state) {
    for (const c of livingCitizens(state)) {
      if (!c.important || !c.partnerId || c.age < 18 || c.age > 45) continue;
      const partner = state.citizens.find(x => x.id === c.partnerId);
      if (!partner || !partner.alive) continue;
      if (c.id > partner.id) continue; // process each couple once, not twice
      if (state.citizens.length >= MAX_NAMED_CITIZENS) continue;
      if (!chance(0.025)) continue;
      const child = makeCitizen(0, true, { parentIds: [c.id, partner.id], inheritTraitsFrom: [c, partner] });
      child.arrivedTurn = state.meta.turn;
      child.history.push("Born to " + c.name + " and " + partner.name + ".");
      state.citizens.push(child);
      c.childrenIds.push(child.id);
      partner.childrenIds.push(child.id);
      state.stats.births++;
      chronicle(state, child.name + " was born to " + c.name + " and " + partner.name + ".");
    }
  }

  function runLineage(state) {
    attemptMarriages(state);
    attemptBirths(state);
  }

  function runPopulation(state) {
    const pop = population(state);
    if (pop === 0) return;
    const cap = capacities(state);
    const slack = cap.housing > pop ? 1 : 0.25;
    const { mult: growthMult } = kingdomMult(state, "growthMult");
    const { mult: edictGrowthMult } = edictMult(state, "growthMult");
    const stabFactor = state.resources.stability / 100;
    const foodFactor = state.resources.food > pop * 0.5 ? 1 : 0.4;
    const growthRate = 0.018 * stabFactor * slack * foodFactor * (growthMult || 1);
    const expected = pop * growthRate;
    const wholeBirths = Math.floor(expected);
    const fractional = expected - wholeBirths;
    let births = wholeBirths + (chance(fractional) ? 1 : 0);
    for (let i = 0; i < births; i++) {
      if (state.citizens.length >= MAX_NAMED_CITIZENS) break;
      const c = makeCitizen(0, false);
      c.arrivedTurn = state.meta.turn;
      state.citizens.push(c);
      state.stats.births++;
    }
    if (births > 0) logMsg(state, births + " new child" + (births > 1 ? "ren were" : " was") + " born this season.");
    // ageing
    for (const c of livingCitizens(state)) {
      if (state.meta.month === 1) c.age += 1;
      if (c.age > 60 && chance(0.004 * (c.age - 60))) {
        killRandomCitizen(state, "old age");
      }
    }
    // occasional migrants drawn by reputation
    if (state.resources.reputation > 55 && chance(0.12) && cap.housing > pop) {
      const migrants = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < migrants; i++) {
        if (state.citizens.length >= MAX_NAMED_CITIZENS) break;
        const c = makeCitizen(16 + Math.floor(rand() * 30), false);
        c.arrivedTurn = state.meta.turn;
        state.citizens.push(c);
      }
      logMsg(state, migrants + " migrants have arrived, drawn by the settlement's reputation.");
    }
  }

  // ---------------------------------------------------------------
  // KINGDOM EFFECTS TICK
  // ---------------------------------------------------------------
  function tickKingdomEffects(state) {
    state.kingdomEffects = state.kingdomEffects.filter(e => {
      e.turnsLeft -= 1;
      return e.turnsLeft > 0;
    });
  }

  function maybeTriggerKingdomEvent(state) {
    if (!chance(0.22)) return;
    const ev = pick(D.KINGDOM_EVENTS);
    state.kingdomEffects.push({ key: ev.effect.key, value: ev.effect.value, turnsLeft: ev.effect.turns });
    logMsg(state, "News from afar: " + ev.text);
  }

  // ---------------------------------------------------------------
  // FACTIONS
  // ---------------------------------------------------------------
  function faction(state, id) { return state.factions.find(f => f.id === id); }

  function performFactionAction(state, factionId, actionId) {
    const f = faction(state, factionId);
    const action = D.FACTION_ACTIONS.find(a => a.id === actionId);
    if (!f || !action) return { ok: false, reason: "Unknown faction or action." };
    if (action.requiresRelationship !== undefined && f.relationship < action.requiresRelationship) {
      return { ok: false, reason: "This faction isn't friendly enough yet (needs " + action.requiresRelationship + "+ relationship)." };
    }
    if (action.requiresTrust !== undefined && f.trust < action.requiresTrust) {
      return { ok: false, reason: "This faction doesn't trust the settlement enough yet (needs " + action.requiresTrust + "+ trust)." };
    }
    if (action.result === "alliance" && f.allied) {
      return { ok: false, reason: "Already allied with " + f.name + "." };
    }
    if (!canAfford(state, action.cost)) return { ok: false, reason: "Not enough resources." };
    pay(state, action.cost);
    // trust affects success chance
    const successChance = clamp(0.4 + f.trust / 100, 0.15, 0.95);
    const success = chance(successChance);
    if (!success) {
      f.relationship = clamp(f.relationship - 2, -100, 100);
      logMsg(state, f.name + " declined the approach (" + action.name + ").");
      return { ok: true, success: false };
    }
    if (action.effect.relationship) f.relationship = clamp(f.relationship + action.effect.relationship, -100, 100);
    if (action.effect.trust) f.trust = clamp(f.trust + action.effect.trust, 0, 100);
    switch (action.result) {
      case "coin": state.resources.coin = round2(state.resources.coin + action.amount); break;
      case "knowledge": state.resources.knowledge = round2(state.resources.knowledge + action.amount); break;
      case "aidRoll":
        if (chance(0.5 + f.relationship / 200)) {
          const r = pick(["food","wood","coin"]);
          const amt = 10 + Math.floor(rand() * 15);
          state.resources[r] = round2(state.resources[r] + amt);
          logMsg(state, f.name + " sent aid: " + amt + " " + r + ".");
        } else {
          logMsg(state, f.name + " was unable to send aid this time.");
        }
        break;
      case "militaryTraining":
        state.flags.trainingBonusTurns = (state.flags.trainingBonusTurns || 0) + 6;
        logMsg(state, f.name + " agreed to train the settlement's soldiers.");
        break;
      case "specialist":
        state.citizens.push(Object.assign(makeCitizen(28 + Math.floor(rand()*15), true), { arrivedTurn: state.meta.turn }));
        logMsg(state, f.name + " sent a specialist to join the settlement.");
        break;
      case "recurringTrade":
        f.tradeAgreement = true;
        break;
      case "alliance":
        f.allied = true;
        state.resources.reputation = clamp(round2(state.resources.reputation + 8), 0, 100);
        chronicle(state, "A formal alliance was struck with " + f.name + " — their strength stands with the settlement's now.");
        break;
      default: break;
    }
    f.memory.push({ turn: state.meta.turn, action: action.id, success: true });
    logMsg(state, f.name + " responded well to " + action.name + ".");
    return { ok: true, success: true };
  }

  function runFactionDrift(state) {
    for (const f of state.factions) {
      // trade agreements passively generate coin
      if (f.tradeAgreement && chance(0.6)) {
        state.resources.coin = round2(state.resources.coin + 3);
      }
      // slow drift toward neutral, personality-flavoured
      if (f.relationship > 0) f.relationship = round2(f.relationship - 0.15);
      if (f.relationship < 0) f.relationship = round2(f.relationship + 0.1);
      // hostile opportunists/bandits may raid if relationship very low
      if ((f.id === "bandits" || f.personality === "opportunist") && f.relationship < -20 && chance(0.08)) {
        triggerRaid(state, f);
      }
      // reputation influences noble/garrison relations passively
      if (f.id === "noble" && state.resources.reputation > 60) f.relationship = clamp(f.relationship + 0.2, -100, 100);
    }
  }

  // ---------------------------------------------------------------
  // INTER-FACTION POLITICS (Phase 2)
  // ---------------------------------------------------------------
  function initFactionRelations(factions) {
    for (const f of factions) {
      if (!f.relations) f.relations = {};
      for (const g of factions) {
        if (f.id === g.id) continue;
        if (f.relations[g.id] === undefined) f.relations[g.id] = 0;
      }
    }
    for (const seed of D.FACTION_RELATIONS_SEED) {
      const fa = factions.find(f => f.id === seed.a);
      const fb = factions.find(f => f.id === seed.b);
      if (fa && fb) { fa.relations[seed.b] = seed.value; fb.relations[seed.a] = seed.value; }
    }
  }

  function getFactionRelation(state, aId, bId) {
    const fa = faction(state, aId);
    if (!fa || !fa.relations) return 0;
    return fa.relations[bId] !== undefined ? fa.relations[bId] : 0;
  }

  // Low, deliberately conservative frequency (see Phase 2 plan) — this is the most
  // systemic of the five Phase 2 additions, so it starts cautious rather than chatty.
  function runInterFactionPolitics(state) {
    if (state.factions.length < 2) return;
    if (!chance(0.06)) return;
    const a = pick(state.factions);
    let b = pick(state.factions);
    let guard = 0;
    while (b.id === a.id && guard++ < 5) b = pick(state.factions);
    if (a.id === b.id) return;

    const currentRel = getFactionRelation(state, a.id, b.id);
    const eligible = D.FACTION_INCIDENTS.filter(inc => inc.requiresBelow === undefined || currentRel <= inc.requiresBelow);
    if (eligible.length === 0) return;
    const incident = pick(eligible);
    const newVal = clamp(currentRel + incident.relationDelta, -100, 100);
    a.relations[b.id] = newVal;
    b.relations[a.id] = newVal;

    const msg = a.name + " " + incident.label + " " + b.name + ".";
    if (incident.kind === "war" || incident.kind === "positive") chronicle(state, msg);
    else logMsg(state, msg);

    applyInterFactionSpillover(state, a, b, incident);
  }

  // Spillover onto the player, scaled by how friendly the player already is with each
  // side — being caught between two allies who go to war stings; benefiting from two
  // trading partners making peace is a small, honest windfall.
  function applyInterFactionSpillover(state, a, b, incident) {
    const relA = a.relationship, relB = b.relationship;
    if (incident.kind === "war") {
      if (relA > 20 && relB > 20) {
        state.resources.stability = clamp(round2(state.resources.stability - 4), 0, 100);
        logMsg(state, "Caught between allies now at war, the settlement's mood grows uneasy.");
      }
      const strongerIsA = (a.military || 10) >= (b.military || 10);
      const strongerRel = strongerIsA ? relA : relB;
      if (strongerRel > 30) state.resources.reputation = clamp(round2(state.resources.reputation + 2), 0, 100);
    } else if (incident.kind === "positive") {
      if (relA > 20 || relB > 20) {
        state.resources.coin = round2(state.resources.coin + 6);
        logMsg(state, "The settlement benefits modestly from renewed ties between " + a.name + " and " + b.name + ".");
      }
    } else if (incident.kind === "negative") {
      if (relA > 20 && relB > 20) {
        state.resources.stability = clamp(round2(state.resources.stability - 2), 0, 100);
      }
    }
  }

  function triggerRaid(state, f) {
    const attackStrength = (f.military || 20) * (0.6 + rand() * 0.6);
    const cap = capacities(state);
    const defense = militaryStrength(state) * 2 + cap.defense;
    const trainingBonus = state.flags.trainingBonusTurns > 0 ? cap.trainingBonus + 0.15 : cap.trainingBonus;
    const effectiveDefense = defense * (1 + trainingBonus);
    const total = attackStrength + effectiveDefense;
    const winChance = total > 0 ? effectiveDefense / total : 0.5;
    if (chance(winChance)) {
      state.stats.battlesWon++;
      state.resources.reputation = clamp(round2(state.resources.reputation + 3), 0, 100);
      chronicle(state, f.name + " raided the settlement and were driven off.");
    } else {
      state.stats.battlesLost++;
      const lossCoin = Math.min(state.resources.coin, 10 + Math.floor(rand() * 20));
      const lossFood = Math.min(state.resources.food, 10 + Math.floor(rand() * 15));
      state.resources.coin = round2(state.resources.coin - lossCoin);
      state.resources.food = round2(state.resources.food - lossFood);
      state.resources.stability = clamp(round2(state.resources.stability - 6), 0, 100);
      if (chance(0.35)) killRandomCitizen(state, "battle");
      chronicle(state, f.name + " raided the settlement, making off with supplies.");
    }
  }

  // ---------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------
  // Scheduled follow-up events (from a prior event's `followUp`) always take priority
  // over a fresh random roll, and only one triggers per turn so a backlog can't pile
  // up and ambush the player with several at once.
  function maybeTriggerScheduledEvent(state) {
    if (state.activeEvent) return false;
    if (!state.scheduledEvents || state.scheduledEvents.length === 0) return false;
    const dueIdx = state.scheduledEvents.findIndex(s => s.dueTurn <= state.meta.turn);
    if (dueIdx === -1) return false;
    const due = state.scheduledEvents.splice(dueIdx, 1)[0];
    const ev = D.LOCAL_EVENTS.find(e => e.id === due.eventId);
    if (!ev) return false; // defensive: unknown id, just drop it rather than crash
    state.activeEvent = { id: ev.id, title: ev.title, text: ev.text, options: ev.options };
    return true;
  }

  function maybeTriggerLocalEvent(state) {
    if (state.activeEvent) return;
    if (maybeTriggerScheduledEvent(state)) return;
    if (!chance(0.35)) return;
    if (!state.eventCooldowns) state.eventCooldowns = {};
    const fullPool = D.LOCAL_EVENTS.filter(e => !e.chainOnly);
    // An event that just fired won't be drawn again for a while — spreads variety
    // across a long playthrough instead of the same handful of events repeating every
    // few turns. Falls back to the full pool if everything happens to be on cooldown
    // (small pool / very early game) rather than silently skipping the roll.
    const COOLDOWN_TURNS = 18;
    let pool = fullPool.filter(e => {
      const last = state.eventCooldowns[e.id];
      return last === undefined || (state.meta.turn - last) >= COOLDOWN_TURNS;
    });
    if (pool.length === 0) pool = fullPool;
    const ev = pick(pool);
    state.eventCooldowns[ev.id] = state.meta.turn;
    state.activeEvent = { id: ev.id, title: ev.title, text: ev.text, options: ev.options };
  }

  // Fixed absolute event effects (e.g. "-10 food") were sized for an early settlement
  // and become invisible once stockpiles grow into the hundreds. This scales tangible,
  // uncapped resources (food/wood/coin/knowledge/etc, identified by NOT having a `max`
  // in RESOURCE_INFO) up with population, while leaving capped 0-100 meters (stability,
  // reputation) and relationship/trust/population deltas — which are already meaningful
  // at any scale — untouched.
  function eventMagnitudeMult(state) {
    return clamp(1 + population(state) / 40, 1, 6);
  }
  function scaleEventEffect(state, effect) {
    if (!effect) return effect;
    const mult = eventMagnitudeMult(state);
    const scaled = {};
    for (const key in effect) {
      const info = D.RESOURCE_INFO[key];
      scaled[key] = (info && !info.max) ? round2(effect[key] * mult) : effect[key];
    }
    return scaled;
  }

  function resolveEvent(state, optionIndex) {
    if (!state.activeEvent) return { ok: false, reason: "No active event." };
    const def = D.LOCAL_EVENTS.find(e => e.id === state.activeEvent.id);
    const opt = def.options[optionIndex];
    if (!opt) return { ok: false, reason: "Invalid option." };
    let combatWon = null;
    if (opt.combatCheck) {
      combatWon = resolveEventCombat(state, opt.combatCheck);
    } else {
      applyEffectBundle(state, scaleEventEffect(state, opt.effect));
      if (opt.chronicle) chronicle(state, opt.chronicle);
      if (opt.followUp) scheduleEvent(state, opt.followUp.eventId, opt.followUp.delayTurns);
    }
    state.activeEvent = null;
    state.stats.eventsResolved++;
    return { ok: true, combatWon };
  }

  function scheduleEvent(state, eventId, delayTurns) {
    if (!state.scheduledEvents) state.scheduledEvents = [];
    state.scheduledEvents.push({ eventId, dueTurn: state.meta.turn + delayTurns });
  }

  // Generic combat resolution for any event option — reuses the same
  // strength-vs-threat formula as the passive raid mechanic (triggerRaid) so a
  // player's militia and fortifications actually matter here, not only when a
  // hostile faction happens to raid on its own initiative. `strengthMult` /
  // `defenseMult` let an individual option lean toward rewarding an active militia
  // (sallying out to intercept) or fortification (holding behind walls) differently —
  // that trade-off is deliberate: it gives both kinds of military investment a
  // distinct, meaningful use instead of one flat "military strength" number.
  // Read-only odds preview (no RNG, no state mutation) so the UI can show the player
  // their estimated chance before they commit to a combat option — the whole point of
  // this system is to make military investment visible and informative, not a blind
  // guess dressed up as a choice.
  function previewCombatChance(state, cc) {
    const cap = capacities(state);
    const strengthMult = cc.strengthMult !== undefined ? cc.strengthMult : 2;
    const defenseMult = cc.defenseMult !== undefined ? cc.defenseMult : 1;
    const trainingBonus = state.flags.trainingBonusTurns > 0 ? cap.trainingBonus + 0.15 : cap.trainingBonus;
    const playerStrength = (militaryStrength(state) * strengthMult + cap.defense * defenseMult) * (1 + trainingBonus);
    const total = playerStrength + cc.attackerStrength;
    return total > 0 ? clamp(playerStrength / total, 0.05, 0.95) : 0.5;
  }

  function resolveEventCombat(state, cc) {
    const cap = capacities(state);
    const strengthMult = cc.strengthMult !== undefined ? cc.strengthMult : 2;
    const defenseMult = cc.defenseMult !== undefined ? cc.defenseMult : 1;
    const trainingBonus = state.flags.trainingBonusTurns > 0 ? cap.trainingBonus + 0.15 : cap.trainingBonus;
    const playerStrength = (militaryStrength(state) * strengthMult + cap.defense * defenseMult) * (1 + trainingBonus);
    const total = playerStrength + cc.attackerStrength;
    const winChance = total > 0 ? clamp(playerStrength / total, 0.05, 0.95) : 0.5;
    const win = chance(winChance);
    if (win) {
      state.stats.battlesWon++;
      if (cc.winEffect) applyEffectBundle(state, scaleEventEffect(state, cc.winEffect));
      if (cc.winChronicle) chronicle(state, cc.winChronicle);
      const winCasualtyChance = cc.winCasualtyChance !== undefined ? cc.winCasualtyChance : 0;
      if (chance(winCasualtyChance)) killRandomCitizen(state, "battle");
      if (cc.winFollowUp) scheduleEvent(state, cc.winFollowUp.eventId, cc.winFollowUp.delayTurns);
    } else {
      state.stats.battlesLost++;
      if (cc.loseEffect) applyEffectBundle(state, scaleEventEffect(state, cc.loseEffect));
      if (cc.loseChronicle) chronicle(state, cc.loseChronicle);
      const loseCasualtyChance = cc.loseCasualtyChance !== undefined ? cc.loseCasualtyChance : 0.3;
      if (chance(loseCasualtyChance)) killRandomCitizen(state, "battle");
      if (cc.loseFollowUp) scheduleEvent(state, cc.loseFollowUp.eventId, cc.loseFollowUp.delayTurns);
    }
    return win;
  }

  function applyEffectBundle(state, effect) {
    if (!effect) return;
    for (const key in effect) {
      if (key === "faction") continue;
      if (key === "population") {
        const delta = effect.population;
        if (delta > 0) {
          for (let i = 0; i < delta; i++) {
            if (state.citizens.length >= MAX_NAMED_CITIZENS) break;
            state.citizens.push(Object.assign(makeCitizen(8 + Math.floor(rand()*40), false), { arrivedTurn: state.meta.turn }));
          }
        } else if (delta < 0) {
          for (let i = 0; i < -delta; i++) killRandomCitizen(state, "departure");
        }
        continue;
      }
      if (key === "military") continue; // handled narratively, no direct stat
      if (D.RESOURCE_INFO[key]) {
        const info = D.RESOURCE_INFO[key];
        let v = round2((state.resources[key] || 0) + effect[key]);
        if (info.max) v = clamp(v, 0, info.max);
        else v = Math.max(0, v);
        state.resources[key] = v;
      }
    }
    if (effect.faction) {
      const f = faction(state, effect.faction);
      if (f) {
        if (effect.relationship) f.relationship = clamp(f.relationship + effect.relationship, -100, 100);
        if (effect.trust) f.trust = clamp(f.trust + effect.trust, 0, 100);
      }
    }
  }

  // ---------------------------------------------------------------
  // EXPLORATION
  // ---------------------------------------------------------------
  function exploreNext(state) {
    if (state.explorationQueue.length === 0) {
      return { ok: false, reason: "There is nowhere new left to explore nearby." };
    }
    const siteId = state.explorationQueue.shift();
    const site = D.EXPLORATION_SITES.find(s => s.id === siteId);
    const scouts = citizensInJob(state, "scout").length;
    const riskReduction = Math.min(0.5, scouts * 0.08);
    const effectiveRisk = clamp(site.risk - riskReduction, 0.02, 0.95);
    state.discoveredSites.push(siteId);
    let outcome;
    if (site.monster) {
      const monster = D.MONSTERS.find(m => m.id === site.monster);
      const str = militaryStrength(state) + scouts * 2;
      const winChance = clamp(str / (str + monster.threat), 0.1, 0.95);
      if (chance(winChance)) {
        applyEffectBundle(state, site.reward);
        chronicle(state, "Scouts investigated the " + site.name + " and drove off " + monster.name.toLowerCase() + " lurking there.");
        outcome = { ok: true, success: true, site, reward: site.reward, monster: monster.name };
      } else {
        if (chance(0.4)) killRandomCitizen(state, "monster attack");
        state.resources.stability = clamp(round2(state.resources.stability - 3), 0, 100);
        chronicle(state, "An expedition to the " + site.name + " was driven back by " + monster.name.toLowerCase() + ".");
        outcome = { ok: true, success: false, site, monster: monster.name };
      }
    } else if (site.bandits) {
      const str = militaryStrength(state) + scouts * 2;
      const winChance = clamp(str / (str + 25), 0.15, 0.9);
      if (chance(winChance)) {
        applyEffectBundle(state, site.reward);
        chronicle(state, "The " + site.name + " was raided successfully, scattering the outlaws within.");
        outcome = { ok: true, success: true, site, reward: site.reward };
      } else {
        state.resources.stability = clamp(round2(state.resources.stability - 2), 0, 100);
        if (chance(0.3)) killRandomCitizen(state, "skirmish");
        chronicle(state, "An attempt on the " + site.name + " went badly, and the party returned empty-handed.");
        outcome = { ok: true, success: false, site };
      }
    } else if (chance(effectiveRisk)) {
      state.resources.stability = clamp(round2(state.resources.stability - 2), 0, 100);
      logMsg(state, "The expedition to the " + site.name + " met with misfortune and found little of value.");
      outcome = { ok: true, success: false, site };
    } else {
      applyEffectBundle(state, site.reward);
      chronicle(state, "Scouts explored the " + site.name + " and returned with useful findings.");
      outcome = { ok: true, success: true, site, reward: site.reward };
    }
    return outcome;
  }

  // ---------------------------------------------------------------
  // TECH / DEVELOPMENT
  // ---------------------------------------------------------------
  function researchTech(state, techId) {
    const t = D.TECHS[techId];
    if (!t) return { ok: false, reason: "Unknown technology." };
    if (state.techs.unlocked.includes(techId)) return { ok: false, reason: "Already researched." };
    for (const req of t.requires) if (!state.techs.unlocked.includes(req)) return { ok: false, reason: "Prerequisite not met." };
    if (state.resources.knowledge < t.cost) return { ok: false, reason: "Not enough knowledge." };
    state.resources.knowledge = round2(state.resources.knowledge - t.cost);
    state.techs.unlocked.push(techId);
    if (t.effect.reputationFlat) state.resources.reputation = clamp(round2(state.resources.reputation + t.effect.reputationFlat), 0, 100);
    chronicle(state, t.name + " was developed, a milestone for the settlement.");
    return { ok: true };
  }

  // ---------------------------------------------------------------
  // STAGE / LEGACY
  // ---------------------------------------------------------------
  function recomputeStage(state) {
    const pop = population(state);
    const count = builtTiles(state).length;
    let stage = D.STAGES[0];
    for (const s of D.STAGES) if (pop >= s.minPop && count >= s.minBuildings) stage = s;
    if (stage.id !== state.meta.stage) {
      const oldIdx = D.STAGES.findIndex(s => s.id === state.meta.stage);
      const newIdx = D.STAGES.findIndex(s => s.id === stage.id);
      state.meta.stage = stage.id;
      if (newIdx > oldIdx) {
        chronicle(state, "The settlement has grown into a " + stage.name.toLowerCase() + ".");
      } else {
        chronicle(state, "Hard times have reduced the settlement to a " + stage.name.toLowerCase() + " once more.");
      }
    }
  }

  function legacyScore(state) {
    const pop = population(state);
    const avgRel = state.factions.reduce((a, f) => a + f.relationship, 0) / state.factions.length;
    return Math.round(
      pop * 1.2 +
      state.resources.coin * 0.15 +
      state.resources.stability * 1.5 +
      state.resources.reputation * 1.5 +
      builtTiles(state).length * 4 +
      avgRel * 1.5 +
      state.techs.unlocked.length * 12 +
      state.chronicle.length * 1.5
    );
  }

  // ---------------------------------------------------------------
  // TURN ADVANCE
  // ---------------------------------------------------------------
  function advanceTurn(state) {
    if (state.activeEvent) return { ok: false, reason: "Resolve the current event first." };
    state.meta.turn++;
    state.meta.month++;
    if (state.meta.month > 12) { state.meta.month = 1; state.meta.year++; }
    if (state.flags.trainingBonusTurns > 0) state.flags.trainingBonusTurns--;

    tickKingdomEffects(state);
    progressConstruction(state);
    runProduction(state);
    runConsumption(state);
    runPopulation(state);
    runLineage(state);
    runFactionDrift(state);
    runInterFactionPolitics(state);
    recomputeStage(state);
    maybeTriggerKingdomEvent(state);
    maybeTriggerLocalEvent(state);

    return { ok: true, season: getSeason(state.meta.month) };
  }

  // ---------------------------------------------------------------
  // SAVE / LOAD
  // ---------------------------------------------------------------
  function saveGame(state) {
    try {
      const json = JSON.stringify(state);
      if (typeof localStorage !== "undefined") localStorage.setItem(SAVE_KEY, json);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "Could not save: " + e.message };
    }
  }
  function loadGame() {
    try {
      if (typeof localStorage === "undefined") return { ok: false, reason: "No storage available." };
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { ok: false, reason: "No save found." };
      const state = JSON.parse(raw);
      if (!state || !state.meta || !state.citizens || !state.grid) {
        return { ok: false, reason: "Save data is corrupted." };
      }
      // Backfill fields for forward-compatibility with older saves
      if (!state.log) state.log = [];
      if (!state.kingdomEffects) state.kingdomEffects = [];
      if (!state.explorationQueue) state.explorationQueue = shuffledSiteIds();
      if (!state.discoveredSites) state.discoveredSites = [];
      if (!state.stats) state.stats = { deaths: 0, births: 0, battlesWon: 0, battlesLost: 0, eventsResolved: 0 };
      if (!state.resourceCap) state.resourceCap = { food: 120 };
      if (!state.edicts) state.edicts = {};
      if (!state.scheduledEvents) state.scheduledEvents = [];
      if (!state.eventCooldowns) state.eventCooldowns = {};
      if (state.factions && state.factions.some(f => !f.relations)) initFactionRelations(state.factions);
      migrateGridToNewSize(state);
      return { ok: true, state };
    } catch (e) {
      return { ok: false, reason: "Save data is corrupted and could not be read." };
    }
  }
  function hasSave() {
    try {
      return typeof localStorage !== "undefined" && !!localStorage.getItem(SAVE_KEY);
    } catch (e) { return false; }
  }
  function deleteSave() {
    try { if (typeof localStorage !== "undefined") localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  return {
    GRID_W, GRID_H, SEASONS, TRAITS,
    newGame, advanceTurn,
    getSeason, capacities, jobCapacityMax, jobCapacityUsed,
    assignJob, unassignJob, autoAssignIdle,
    idleCitizens, livingCitizens, citizensInJob, population,
    newBuildOptions, queueConstruction, queueUpgrade, cancelConstruction, demolishBuilding,
    performFactionAction, faction,
    resolveEvent, exploreNext, researchTech,
    militaryStrength, legacyScore,
    saveGame, loadGame, hasSave, deleteSave,
    tileAt, isRuinTile, builtTiles, adjacencyBonusForTile, previewAdjacency,
    toggleEdict, getFactionRelation, previewCombatChance
  };
})();

if (typeof window !== "undefined") window.GameEngine = GameEngine;
if (typeof module !== "undefined") module.exports = GameEngine;
