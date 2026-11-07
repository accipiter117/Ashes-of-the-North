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
  // `state` is optional and only used to persist the ID counter (see below) — every
  // call site created before `state` exists (the initial founding citizens in
  // newGame) omits it and falls back to the module-level counter, which newGame then
  // copies onto the freshly-built state right after.
  function makeCitizen(age, important, lineage, state) {
    let nextId;
    if (state) {
      // BUG FIX: citizenCounter used to be a plain module-level variable, which resets
      // to 0 on every page reload (a fresh JS module load) but was never saved or
      // restored. Any citizen created after a reload would start renumbering from
      // "c1" again, directly colliding with existing citizens (most obviously the
      // founder) still in the loaded save — corrupting every ID-based lookup
      // (assignJob, unassignJob, lineage partner/parent links) for whichever citizen
      // `.find()` happened to resolve to. Persisting the counter on `state` itself
      // means it round-trips through save/load naturally, like everything else.
      state.citizenCounter = (state.citizenCounter || 0) + 1;
      nextId = state.citizenCounter;
    } else {
      citizenCounter++;
      nextId = citizenCounter;
    }
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
      id: "c" + nextId,
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
      chronicle(state, "New land to the east and south has been surveyed and opened for settlement: " + added + " new plots await.");
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
      stats: { deaths: 0, births: 0, battlesWon: 0, battlesLost: 0, eventsResolved: 0, emigrated: 0 },
      groups: initialGroups(),
      needs: null,
      petitionTurns: {},
      citizenCounter: citizenCounter // carry the bootstrap counter forward so it round-trips through save/load
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
      if (!t.building || t.burnt) continue;
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
      if (!t.building || t.burnt) continue;
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
      return { ok: false, reason: "This edict was changed too recently. Wait " + (def.cooldown - turnsSince) + " more month(s)." };
    }
    state.edicts[edictId] = { active: !current.active, sinceTurn: state.meta.turn };
    chronicle(state, (state.edicts[edictId].active ? "The edict of " + def.name + " was declared." : def.name + " was repealed."));
    return { ok: true, active: state.edicts[edictId].active };
  }

  function livingCitizens(state) { return state.citizens.filter(c => c.alive); }
  function population(state) { return livingCitizens(state).length; }
  function idleCitizens(state) { return livingCitizens(state).filter(c => !c.job && c.age >= 12); }
  function citizensInJob(state, jobId) { return livingCitizens(state).filter(c => c.job === jobId); }

  function soldierCount(state) {
    let n = 0;
    for (const c of state.citizens) if (c.alive && c.job && D.JOBS[c.job] && D.JOBS[c.job].type === "soldier" && D.JOBS[c.job].military) n++;
    return n;
  }
  // Share of soldiers with a weapon in hand: weapons in store, one each.
  function armedFraction(state) {
    const n = soldierCount(state);
    return n === 0 ? 1 : clamp((state.resources.weapons || 0) / n, 0, 1);
  }
  // Labourers and artisans want about one tool between two and a half workers.
  function toolWorkers(state) {
    let n = 0;
    for (const c of state.citizens) if (c.alive && c.job && D.JOBS[c.job] && (D.JOBS[c.job].type === "labourer" || D.JOBS[c.job].type === "artisan")) n++;
    return n;
  }
  function toolCoverage(state) {
    const n = toolWorkers(state);
    return n === 0 ? 1 : clamp((state.resources.tools || 0) / (n * 0.4), 0, 1);
  }

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
    // Soldiers fight at half strength without a weapon each (see armedFraction).
    return str * mult * emult * (0.5 + 0.5 * armedFraction(state)) + allyBonus;
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
      return { ok: false, reason: "No open slots for that job yet. Build or upgrade the required building." };
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
  // Auto-assign used to walk a fixed list in which lumberjack (an uncapped job) came
  // third, so after the farms filled every other idle resident became a lumberjack:
  // the market, mine, hall and school never got staff, coin dried up, upkeep went
  // unpaid and stability fell to zero. Now it staffs the buildings the player paid
  // for first, then spreads whoever is left across the open gathering jobs by need.
  function autoAssignIdle(state) {
    let assigned = 0;
    const r = state.resources;
    const fill = (jobId, limit) => {
      const max = Math.min(jobCapacityMax(state, jobId), limit === undefined ? 999 : limit);
      const idle = idleCitizens(state);
      while (jobCapacityUsed(state, jobId) < max && idle.length > 0) {
        assignJob(state, idle.shift().id, jobId);
        assigned++;
      }
    };
    // 1. Food before anything else, but only as many hands as the settlement needs:
    //    one food worker feeds about eleven people over a year (winter included),
    //    plus extra while the stores are low. Filling every farm slot regardless left
    //    nobody to cut wood once the granary was full.
    const pop = population(state);
    const foodWorkers = () => citizensInJob(state, "farmer").length + citizensInJob(state, "fisherman").length;
    const foodTarget = Math.ceil(pop / 11) + 1 + (r.food < pop * 2 ? 2 : 0);
    fill("farmer", citizensInJob(state, "farmer").length + Math.max(0, foodTarget - foodWorkers()));
    fill("fisherman", citizensInJob(state, "fisherman").length + Math.max(0, foodTarget - foodWorkers()));
    // 1b. Keep a core of woodcutters and a mason: nearly everything is built from them.
    const workers = livingCitizens(state).filter(c => c.age >= 12).length;
    fill("lumberjack", Math.max(2, Math.round(workers * 0.15)));
    fill("mason", 1);
    // 2. Building jobs, skipping those whose inputs the settlement can't supply.
    const hasHerbs = r.herbs >= 3 || citizensInJob(state, "herbalist").length > 0;
    const staffed = [
      ["trader", true], ["brewer", stageIndex(state) >= 3 && r.food >= population(state) * 0.4], ["carpenter", stageIndex(state) >= 4 && r.wood >= 10],
      ["tanner", true], ["miner", true],
      ["blacksmith", r.iron >= 2 || citizensInJob(state, "miner").length > 0],
      ["carpenter", r.wood >= 20], ["administrator", true], ["teacher", true], ["scribe", true],
      ["innkeeper", true], ["caravan_master", true], ["guard", true], ["archer", true], ["militia", true],
      ["physician", hasHerbs], ["alchemist", hasHerbs], ["brewer", r.food >= population(state) * 0.4],
      ["tax_collector", r.stability >= 40]
    ];
    for (const [jobId, ok] of staffed) if (ok) fill(jobId);
    // 3. Whoever is left gathers, going to whichever open job is most short-handed
    //    for what the settlement currently lacks.
    const anyConstruction = state.grid.some(t => t.constructing);
    const weights = {
      lumberjack: r.wood > 400 ? 1 : 3,
      mason: r.stone > 300 ? 1 : 2,
      builder: anyConstruction ? 1 : 0,
      herbalist: r.herbs < 25 && citizensInJob(state, "herbalist").length < 2 ? 1 : 0
    };
    let idle = idleCitizens(state);
    while (idle.length > 0) {
      let best = null, bestScore = Infinity;
      for (const jobId in weights) {
        if (!weights[jobId]) continue;
        const score = (citizensInJob(state, jobId).length + 1) / weights[jobId];
        if (score < bestScore) { bestScore = score; best = jobId; }
      }
      if (!best) break;
      if (best === "herbalist" && citizensInJob(state, "herbalist").length >= 2) { weights.herbalist = 0; continue; }
      assignJob(state, idle.shift().id, best);
      assigned++;
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
    if (t.building) return { ok: false, reason: "Tile occupied. Try upgrading instead." };
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
        if (t.constructing.repair) {
          t.burnt = false; t.constructing = null;
          logMsg(state, D.BUILDINGS[finishedId].name + " has been rebuilt.");
          continue;
        }
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
    // How hard people work: content people work faster (0.85x to 1.15x), a group
    // that approves of the elder works harder still (0.8x to 1.2x), and labourers
    // and artisans short of tools lose up to a quarter of their output.
    const pace = 0.82 + 0.3 * settlementHappiness(state);
    const tools = toolCoverage(state);
    state.flags.physicianWork = 0;
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
      // Workers who need inputs (blacksmiths' iron, carpenters' wood, physicians'
      // herbs) only work as far as the stores allow. Without this the stores went
      // negative and the workers kept producing from nothing.
      let inputShare = 1;
      for (const res in (job.consumes || {})) {
        const need = job.consumes[res] * effectiveWorkers;
        const have = Math.max(0, (state.resources[res] || 0) + (totals[res] || 0));
        if (need > 0) inputShare = Math.min(inputShare, have / need);
      }
      const groupMult = 1 + (groupApproval(state, groupOfJob(jobId)) - 50) / 300;
      const toolMult = (job.type === "labourer" || job.type === "artisan") ? 0.75 + 0.25 * tools : 1;
      const workMult = pace * groupMult * toolMult;
      if (jobId === "physician") state.flags.physicianWork = effectiveWorkers * inputShare * workMult;
      for (const res in (job.produces || {})) {
        let amount = job.produces[res] * effectiveWorkers * seasonMult * buildingMult * inputShare * workMult;
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
        const amount = job.consumes[res] * effectiveWorkers * inputShare;
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
    // Buildings' own monthly stability and influence (chapel, well, better houses, the
    // keep's upgrades). These were listed on the buildings but never actually applied.
    let bStab = 0, bInf = 0;
    for (const t of state.grid) {
      const b = t.building && !t.burnt && D.BUILDINGS[t.building];
      if (!b || !b.effect) continue;
      bStab += b.effect.stability || 0;
      bInf += b.effect.influence || 0;
    }
    if (bInf) state.resources.influence = round2((state.resources.influence || 0) + bInf);
    state.resources.stability = clamp(round2(state.resources.stability + stabFlat + stabDrift + stabEdict + adjStab + bStab), 0, 100);
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
      state.flags.hungryTurn = state.meta.turn;
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

  // ---------------------------------------------------------------
  // ECONOMY REBALANCE: upkeep, diplomacy diminishing returns, resource decay
  // ---------------------------------------------------------------
  // Every built (non-ruin) building costs coin to maintain, scaled by tier — more and
  // better buildings means a bigger settlement, but also a bigger standing cost, so
  // growth stops being purely additive. Falling short doesn't damage buildings (too
  // punishing for one bad month) but does cost stability — the treasury can't pay
  // its people, and they notice.
  function totalUpkeep(state) {
    let total = 0;
    for (const t of state.grid) {
      if (!t.building || t.burnt) continue;
      const b = D.BUILDINGS[t.building];
      if (b && b.upkeep && b.upkeep.coin) total += b.upkeep.coin;
    }
    return round2(total);
  }
  function runUpkeep(state) {
    const upkeep = totalUpkeep(state);
    if (upkeep <= 0) return;
    if (state.resources.coin >= upkeep) {
      state.resources.coin = round2(state.resources.coin - upkeep);
    } else {
      const shortfall = round2(upkeep - state.resources.coin);
      state.flags.upkeepShortTurn = state.meta.turn;
      state.resources.coin = 0;
      const penalty = clamp(round2(shortfall * 0.15), 0, 8);
      state.resources.stability = clamp(round2(state.resources.stability - penalty), 0, 100);
      logMsg(state, "The treasury could not cover " + shortfall + " coin in upkeep this month. Unrest grows.");
    }
  }

  // Stockpiled coin, tools, weapons, knowledge, and influence above a stage-scaled
  // soft cap spoil, waste, or lose relevance rather than sitting idle forever —
  // without this, a settlement's economy only ever grows and resources never present
  // any reason to spend rather than hoard. Only the excess above the cap decays (a
  // fixed percentage of it per turn), so this never claws back what's already below
  // the threshold and never punishes early or mid-game accumulation.
  const RESOURCE_DECAY_RESOURCES = ["coin", "tools", "weapons", "knowledge", "influence", "ale", "furniture"];
  const STAGE_SOFT_CAPS = { camp: 150, hamlet: 400, village: 900, town: 1800, city: 3500 };
  function resourceSoftCap(state) {
    return STAGE_SOFT_CAPS[state.meta.stage] || 3500;
  }
  function runResourceDecay(state) {
    const cap = resourceSoftCap(state);
    let anyDecayed = false;
    for (const r of RESOURCE_DECAY_RESOURCES) {
      const val = state.resources[r] || 0;
      if (val <= cap) continue;
      const excess = val - cap;
      const lost = round2(excess * 0.08);
      if (lost > 0) {
        state.resources[r] = round2(val - lost);
        anyDecayed = true;
      }
    }
    if (anyDecayed && chance(0.25)) {
      logMsg(state, "Surplus goods beyond what the settlement can put to use are wasting away in storage.");
    }
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
      const child = makeCitizen(0, true, { parentIds: [c.id, partner.id], inheritTraitsFrom: [c, partner] }, state);
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
    const happyFactor = 0.4 + settlementHappiness(state);   // content families have more children
    const growthRate = 0.018 * stabFactor * slack * foodFactor * (growthMult || 1) * happyFactor;
    const expected = pop * growthRate;
    const wholeBirths = Math.floor(expected);
    const fractional = expected - wholeBirths;
    let births = wholeBirths + (chance(fractional) ? 1 : 0);
    for (let i = 0; i < births; i++) {
      if (state.citizens.length >= MAX_NAMED_CITIZENS) break;
      const c = makeCitizen(0, false, null, state);
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
    if (state.resources.reputation > 55 && settlementHappiness(state) >= 0.55 && chance(0.12) && cap.housing > pop) {
      const migrants = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < migrants; i++) {
        if (state.citizens.length >= MAX_NAMED_CITIZENS) break;
        const c = makeCitizen(16 + Math.floor(rand() * 30), false, null, state);
        c.arrivedTurn = state.meta.turn;
        state.citizens.push(c);
      }
      logMsg(state, migrants + " migrants have arrived, drawn by the settlement's reputation.");
    }
  }

  // ---------------------------------------------------------------
  // NEEDS, HAPPINESS AND THE VOICES OF THE TOWN
  // ---------------------------------------------------------------
  // Households expect more as the settlement grows (D.NEEDS, each from a stage).
  // How well those needs are met, plus how each interest group feels about the
  // elder, sets every resident's happiness. Happiness then feeds back into work
  // pace, births, stability, newcomers and, if it falls low enough, families
  // packing up and leaving. Groups that fall below 25 approval petition.
  const ALE_PER_HEAD = 0.04, FURNITURE_PER_HEAD = 0.008, HERBS_PER_HEAD = 0.01;
  const TENT_VALUE = { camp: 1, hamlet: 1, village: 0.6, town: 0.25, city: 0.1 };
  const PETITION_COOLDOWN = 12;

  const JOB_GROUP = {};
  for (const g of D.INTEREST_GROUPS) for (const j of g.linkedJobs) JOB_GROUP[j] = g.id;
  function groupOfJob(jobId) { return JOB_GROUP[jobId] || null; }
  function groupApproval(state, groupId) {
    if (!groupId || !state.groups || state.groups[groupId] === undefined) return 50;
    return state.groups[groupId];
  }
  function settlementHappiness(state) {
    return state.needs && typeof state.needs.happiness === "number" ? state.needs.happiness : 0.6;
  }
  function stageIndex(state) { return Math.max(0, D.STAGES.findIndex(s => s.id === state.meta.stage)); }
  function needActive(state, need) { return stageIndex(state) >= D.STAGES.findIndex(s => s.id === need.from); }
  function edictActive(state, id) { return !!(state.edicts && state.edicts[id] && state.edicts[id].active); }
  function chainTier(state, rootId) {
    let best = -1;
    for (const t of state.grid) {
      const b = t.building && !t.burnt && D.BUILDINGS[t.building];
      if (b && b.chain && b.chain[0] === rootId) best = Math.max(best, b.tier || 0);
    }
    return best;
  }
  function chainCount(state, ids) { return state.grid.filter(t => !t.burnt && ids.includes(t.building)).length; }

  // Goods households use each month: ale and furniture once they expect them,
  // herbs as home remedies once health matters; weapons and tools wear out.
  function runGoods(state) {
    const r = state.resources, pop = population(state);
    const supply = {};
    const use = (res, demand) => {
      if (demand <= 0) { supply[res] = 1; return; }
      const got = Math.min(r[res] || 0, demand);
      r[res] = round2((r[res] || 0) - got);
      supply[res] = got / demand;
    };
    const active = id => needActive(state, D.NEEDS.find(n => n.id === id));
    use("ale", active("ale") ? pop * ALE_PER_HEAD : 0);
    use("furniture", active("furniture") ? pop * FURNITURE_PER_HEAD : 0);
    if (active("health")) use("herbs", pop * HERBS_PER_HEAD);
    const soldiers = soldierCount(state);
    if (soldiers && r.weapons > 0) r.weapons = round2(Math.max(0, r.weapons - soldiers * 0.02));
    const tw = toolWorkers(state);
    if (tw && r.tools > 0) r.tools = round2(Math.max(0, r.tools - tw * 0.02));
    state.goodsSupply = supply;
  }

  // How well each need is met right now, 0..1 (computed for every need, active
  // or not, so the UI can show what's coming and groups can judge it).
  function needLevels(state) {
    const r = state.resources, pop = Math.max(1, population(state));
    const cap = capacities(state);
    const si = stageIndex(state);
    const levels = {};
    // food: a healthy store, nothing if anyone went hungry this month; bread and fish both from a village on
    let food = r.food >= pop * 0.5 ? 1 : r.food / (pop * 0.5);
    if (state.flags.hungryTurn === state.meta.turn) food = 0;
    if (si >= 2 && !(citizensInJob(state, "farmer").length && citizensInJob(state, "fisherman").length)) food *= 0.85;
    levels.food = clamp(food, 0, 1);
    // shelter: houses count fully; tents less as the place grows; beyond the camp, nothing
    const houseBeds = Math.max(0, cap.housing - BASE_CAMP_HOUSING);
    const housed = Math.min(pop, houseBeds);
    const inTents = Math.min(pop - housed, BASE_CAMP_HOUSING);
    levels.shelter = clamp((housed + inTents * (TENT_VALUE[state.meta.stage] || 0.1)) / pop, 0, 1);
    // safety: armed strength and walls against the size of the place, dented by a lost fight
    let safety = (militaryStrength(state) * 1.5 + cap.defense) / (4 + pop * 0.25);
    if (state.flags.raidLostTurn !== undefined && state.meta.turn - state.flags.raidLostTurn <= 4) safety *= 0.6;
    levels.safety = clamp(safety, 0, 1);
    // faith: room in a chapel
    const faithRoom = chainCount(state, ["wayshrine"]) * 15 + chainCount(state, ["chapel"]) * 40 + chainCount(state, ["sanctum"]) * 120;
    levels.faith = clamp(faithRoom * (edictActive(state, "devout_observance") ? 1.25 : 1) / pop, 0, 1);
    // health: physicians at work, eked out by herbs in store
    levels.health = clamp(((state.flags.physicianWork || 0) * 25 + (r.herbs || 0) * 1.5) / pop, 0, 1);
    // goods: last month's supply against demand
    const sup = state.goodsSupply || {};
    levels.ale = sup.ale !== undefined && needActive(state, D.NEEDS.find(n => n.id === "ale")) ? sup.ale : clamp((r.ale || 0) / (pop * ALE_PER_HEAD), 0, 1);
    levels.furniture = sup.furniture !== undefined && needActive(state, D.NEEDS.find(n => n.id === "furniture")) ? sup.furniture : clamp((r.furniture || 0) / (pop * FURNITURE_PER_HEAD), 0, 1);
    const marketRoom = chainCount(state, ["market"]) * 40 + chainCount(state, ["market2"]) * 90 + chainCount(state, ["market3"]) * 160;
    levels.market = clamp(marketRoom / pop, 0, 1);
    return levels;
  }

  // What each group cares about beyond the common needs, each 0..1.
  function groupWants(state, levels) {
    const r = state.resources, pop = Math.max(1, population(state));
    const adults = livingCitizens(state).filter(c => c.age >= 12);
    const idle = adults.filter(c => !c.job).length;
    const upkeepOk = state.flags.upkeepShortTurn === undefined || state.meta.turn - state.flags.upkeepShortTurn > 3;
    const tierScore = (t, scores) => t < 0 ? scores[0] : scores[Math.min(t + 1, scores.length - 1)];
    const partners = state.factions.filter(f => f.tradeAgreement || f.allied).length;
    return {
      farmers: [
        { text: "a full granary", v: clamp(r.food / (pop * 1.5), 0, 1) },
        { text: "improved farms", v: chainCount(state, ["farm2", "farm3"]) > 0 ? 1 : 0.4 },
        { text: "low taxes", v: edictActive(state, "high_taxation") ? 0 : 1 }
      ],
      labourers: [
        { text: "work for everyone", v: adults.length ? 1 - idle / adults.length : 1 },
        { text: "a proper roof", v: levels.shelter },
        { text: "no forced labour", v: edictActive(state, "forced_labour") ? 0 : 1 }
      ],
      merchants: [
        { text: "a good market", v: tierScore(chainTier(state, "market"), [0, 0.6, 0.85, 1]) },
        { text: "safe roads", v: levels.safety },
        { text: "trading partners", v: clamp(partners / 2, 0, 1) }
      ],
      artisans: [
        { text: "a workshop", v: tierScore(chainTier(state, "workshop"), [0, 0.7, 1]) },
        { text: "iron to work", v: clamp((r.iron || 0) / 10, 0, 1) },
        { text: "tools enough", v: toolCoverage(state) }
      ],
      soldiers: [
        { text: "a weapon each", v: armedFraction(state) },
        { text: "wages paid", v: upkeepOk ? 1 : 0.2 },
        { text: "proper barracks", v: tierScore(chainTier(state, "guardhouse"), [0.2, 0.5, 0.8, 1]) }
      ],
      clergy: [
        { text: "room at chapel", v: levels.faith },
        { text: "a fine chapel", v: tierScore(chainTier(state, "shrine"), [0.1, 0.1, 0.7, 1]) },
        { text: "no forced labour", v: edictActive(state, "forced_labour") ? 0.3 : 1 }
      ],
      scholars: [
        { text: "a school", v: tierScore(chainTier(state, "school"), [0.1, 0.6, 0.85, 1]) },
        { text: "healers at work", v: levels.health },
        { text: "open scholarship", v: edictActive(state, "open_scholarship") ? 1 : 0.6 }
      ]
    };
  }

  function needsScore(state, levels) {
    let sum = 0, weight = 0;
    for (const n of D.NEEDS) {
      if (!needActive(state, n)) continue;
      const w = (n.id === "food" || n.id === "shelter") ? 1.5 : 1;
      sum += levels[n.id] * w; weight += w;
    }
    if (!weight) return 1;
    // a need left almost entirely unmet hurts more than its share of the average
    let neglected = 0;
    for (const n of D.NEEDS) if (needActive(state, n) && levels[n.id] < 0.25) neglected++;
    return clamp(sum / weight - 0.12 * neglected, 0, 1);
  }

  function runNeeds(state) {
    if (!state.groups) state.groups = initialGroups();
    const levels = needLevels(state);
    const score = needsScore(state, levels);
    const wants = groupWants(state, levels);
    // groups drift toward what they think of things
    const targets = {};
    for (const g of D.INTEREST_GROUPS) {
      const w = wants[g.id] || [];
      const wantScore = w.length ? w.reduce((a, x) => a + x.v, 0) / w.length : 0.5;
      let edicts = 0;
      for (const id in D.EDICTS) {
        if (!edictActive(state, id)) continue;
        if ((D.EDICTS[id].likes || []).includes(g.id)) edicts += 10;
        if ((D.EDICTS[id].dislikes || []).includes(g.id)) edicts -= 15;
      }
      const target = clamp(10 + 100 * (0.35 * score + 0.45 * wantScore) + edicts, 0, 100);
      targets[g.id] = target;
      state.groups[g.id] = clamp(round2(state.groups[g.id] + (target - state.groups[g.id]) * 0.12), 0, 100);
    }
    // every resident: three parts needs, one part how their group feels; idleness stings
    const allApproval = D.INTEREST_GROUPS.reduce((a, g) => a + state.groups[g.id], 0) / D.INTEREST_GROUPS.length;
    let total = 0, n = 0;
    for (const c of livingCitizens(state)) {
      const g = groupOfJob(c.job);
      let h = score * 70 + (g ? state.groups[g] : allApproval) * 0.3;
      if (c.age >= 12 && !c.job) h -= 8;
      c.happiness = Math.round(clamp(h, 0, 100));
      total += c.happiness; n++;
    }
    const happiness = n ? total / n / 100 : 0.6;
    state.needs = { levels, score: round2(score), happiness: round2(happiness), targets };
    // contentment steadies the settlement; misery unsettles it
    state.resources.stability = clamp(round2(state.resources.stability + (happiness - 0.55) * 1.5), 0, 100);
    // the unhappiest families leave when things are bad enough
    if (happiness < 0.4 && chance(0.4)) {
      const leaving = livingCitizens(state).filter(c => c.age >= 12 && !c.important).sort((a, b) => a.happiness - b.happiness)
        .slice(0, 1 + Math.floor(population(state) * 0.015));
      for (const c of leaving) { c.alive = false; c.leftTurn = state.meta.turn; c.job = null; }
      if (leaving.length) {
        state.stats.emigrated = (state.stats.emigrated || 0) + leaving.length;
        logMsg(state, leaving.length === 1 ? leaving[0].name + " has packed up and left for somewhere kinder." : leaving.length + " unhappy residents have packed up and taken the road out of " + state.settlementName + ".");
      }
    }
  }

  function initialGroups() {
    const g = {};
    for (const x of D.INTEREST_GROUPS) g[x.id] = 50;
    return g;
  }

  // A group under 25 approval petitions the elder (one group at a time, each at most once a year).
  function petitionDef(id) {
    if (!id || id.indexOf("petition_") !== 0) return null;
    const gid = id.slice(9), p = D.PETITIONS[gid];
    return p ? { id, title: p.title, text: p.text, options: p.options } : null;
  }
  function eventDef(id) { return D.LOCAL_EVENTS.find(e => e.id === id) || petitionDef(id); }
  function maybeTriggerPetition(state) {
    if (state.activeEvent || !state.groups) return false;
    if (!state.petitionTurns) state.petitionTurns = {};
    const unhappy = D.INTEREST_GROUPS.filter(g => state.groups[g.id] < 25 &&
      (state.petitionTurns[g.id] === undefined || state.meta.turn - state.petitionTurns[g.id] >= PETITION_COOLDOWN))
      .sort((a, b) => state.groups[a.id] - state.groups[b.id]);
    if (!unhappy.length || !chance(0.5)) return false;
    const g = unhappy[0];
    state.petitionTurns[g.id] = state.meta.turn;
    const def = petitionDef("petition_" + g.id);
    state.activeEvent = { id: def.id, title: def.title, text: def.text, options: def.options };
    return true;
  }

  // Read-only summaries for the UI.
  function needsReport(state) {
    const levels = needLevels(state);
    const si = stageIndex(state);
    return {
      happiness: settlementHappiness(state),
      score: needsScore(state, levels),
      pace: 0.82 + 0.3 * settlementHappiness(state),
      needs: D.NEEDS.map(n => ({ id: n.id, name: n.name, icon: n.icon, desc: n.desc, level: levels[n.id], active: needActive(state, n),
        from: D.STAGES.find(s => s.id === n.from).name, soon: D.STAGES.findIndex(s => s.id === n.from) === si + 1 }))
    };
  }
  function groupReport(state) {
    const levels = needLevels(state);
    const wants = groupWants(state, levels);
    const targets = (state.needs && state.needs.targets) || {};
    return D.INTEREST_GROUPS.map(g => {
      const w = (wants[g.id] || []).slice().sort((a, b) => a.v - b.v);
      const members = g.linkedJobs.reduce((a, j) => a + citizensInJob(state, j).length, 0);
      const edictsLiked = Object.keys(D.EDICTS).filter(id => edictActive(state, id) && (D.EDICTS[id].likes || []).includes(g.id)).map(id => D.EDICTS[id].name);
      const edictsHated = Object.keys(D.EDICTS).filter(id => edictActive(state, id) && (D.EDICTS[id].dislikes || []).includes(g.id)).map(id => D.EDICTS[id].name);
      const approval = groupApproval(state, g.id);
      return { id: g.id, name: g.name, icon: g.icon, wants: g.wants, approval, members,
        trend: targets[g.id] === undefined ? 0 : Math.sign(Math.round(targets[g.id] - approval)),
        grievance: w.length && w[0].v < 0.6 ? w[0].text : null, pleasedBy: w.length && w[w.length - 1].v >= 0.9 ? w[w.length - 1].text : null,
        edictsLiked, edictsHated, workMult: 1 + (approval - 50) / 300 };
    });
  }

  // ---------------------------------------------------------------
  // BATTLES ON THE MAP
  // ---------------------------------------------------------------
  // Attacks on the settlement are fought out on the map in real time: raiders
  // walk in from the road, monsters rise from the river, woods or ruins, soldiers
  // muster at their posts and go to meet them, archers and towers shoot, and
  // everyone else runs for shelter. Everything is decided here, so what the
  // map shows is what happens: the people caught outside, the stores carried
  // off, the buildings set alight. Time is in game seconds (a month is
  // MONTH_SECONDS); the UI ticks it in real time and advanceTurn finishes any
  // battle still running, so headless play and tests resolve the same way.
  const MONTH_SECONDS = 72;
  const BATTLE_LIMIT = 70;          // attackers withdraw after this long
  const SHELTER_SECONDS = 6;        // how long it takes people to get indoors after the alarm
  const ATTACKER_KINDS = {
    raider:  { name: "Raider",  hp: 13, dmg: 2.4, speed: 1.15, range: 0.45, cd: 1.0, loots: true, burns: true, flees: 0.5 },
    warrior: { name: "Warrior", hp: 15, dmg: 2.5, speed: 1.0,  range: 0.45, cd: 1.0, loots: true, burns: true, flees: 0.5 },
    drowner: { name: "Drowner", hp: 11, dmg: 2.6, speed: 0.95, range: 0.45, cd: 1.1, hunts: true },
    nekker:  { name: "Nekker",  hp: 9,  dmg: 2.2, speed: 1.35, range: 0.4,  cd: 0.8, hunts: true },
    ghoul:   { name: "Ghoul",   hp: 15, dmg: 3.0, speed: 0.85, range: 0.45, cd: 1.2, hunts: true }
  };
  const DEFENDER_STATS = {
    militia: { hp: 12, dmg: 2.1, range: 0.45, cd: 1.0 },
    guard:   { hp: 15, dmg: 2.6, range: 0.45, cd: 1.0 },
    archer:  { hp: 10, dmg: 2.2, range: 3.2,  cd: 1.4 },
    scout:   { hp: 10, dmg: 1.6, range: 0.45, cd: 0.9 }
  };
  const TOWER_FIRE = { watchtower: { dps: 2.0, range: 3.8 }, fortkeep: { dps: 3.4, range: 4.2 }, manor: { dps: 4.2, range: 4.6 } };
  const HIT_CHANCE = 0.62;          // blows and arrows miss; keeps fights from being foregone conclusions
  const STORE_ROOTS = ["storehouse", "market", "workshop", "brewhouse", "joinery"];
  // where each kind of worker is out in the open, by job
  const OUTDOOR_JOBS = { farmer: "farm", fisherman: "dock", lumberjack: "forest", miner: "mine", herbalist: "forest", builder: "constructing", mason: "constructing" };

  function tileKey(t) { return t.x + "," + t.y; }
  function isBurnt(t) { return !!(t && t.burnt); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function battleActive(state) { return !!(state.battle && !state.battle.outcome); }

  function edgeSpawn(state, from, i) {
    const W = GRID_W, H = GRID_H;
    const forest = state.grid.filter(t => t.terrain === "forest" && !t.building);
    const ruins = state.grid.filter(t => t.building && isRuinTile(t));
    const jitter = () => (rand() - 0.5) * 0.8;
    if (from === "river") return { x: 1.2 + rand() * 1.4, y: 1 + rand() * (H - 2) };
    if (from === "forest" && forest.length) { const t = forest[Math.floor(rand() * forest.length)]; return { x: t.x + 0.5 + jitter(), y: t.y + 0.5 + jitter() }; }
    if (from === "ruins" && ruins.length) { const t = ruins[i % ruins.length]; return { x: t.x + 0.5 + jitter(), y: t.y + 0.9 + rand() * 0.5 }; }
    if (from === "north") return { x: 5 + rand() * (W - 8), y: 0.3 };
    return { x: W - 0.3 - rand() * 0.6, y: 7.5 + jitter() };     // the east road
  }

  // Begin a battle. spec: { kind, count, from, label, mode ("hold" keeps soldiers inside
  // the settlement, "sally" sends them out), source, eventId, optionIndex, strength }
  function startBattle(state, spec) {
    if (battleActive(state)) finishBattleNow(state);
    const k = ATTACKER_KINDS[spec.kind] || ATTACKER_KINDS.raider;
    const attackers = [];
    for (let i = 0; i < spec.count; i++) {
      const p = edgeSpawn(state, spec.from, i);
      attackers.push({ id: "a" + i, kind: spec.kind, x: p.x, y: p.y, hp: k.hp, maxHp: k.hp, cd: rand() * k.cd, state: "approach", carry: 0, target: null, hitT: 99 });
    }
    // soldiers muster at the guardhouse (or the old keep, or the fire)
    const posts = state.grid.filter(t => t.building && !isBurnt(t) && ["guardhouse", "barracks", "trainingyard"].includes(t.building));
    const keep = state.grid.find(t => t.building && D.BUILDINGS[t.building].chain[0] === "keep");
    const muster = posts[0] || keep || { x: 9, y: 6 };
    const cap = capacities(state);
    const armed = armedFraction(state);
    const { mult } = techMult(state, "militaryMult");
    const { mult: emult } = edictMult(state, "militaryMult");
    const training = 1 + (state.flags.trainingBonusTurns > 0 ? cap.trainingBonus + 0.15 : cap.trainingBonus);
    const defenders = [];
    for (const c of livingCitizens(state)) {
      const st = DEFENDER_STATS[c.job];
      if (!st || c.away) continue;
      defenders.push({ id: c.id, job: c.job, x: muster.x + 0.5 + (rand() - 0.5) * 0.8, y: muster.y + 0.8 + rand() * 0.4,
        hp: st.hp, maxHp: st.hp, dmg: st.dmg * (0.5 + 0.5 * armed) * mult * emult * training, range: st.range, cd: rand() * st.cd, cdMax: st.cd, state: "muster", hitT: 99 });
    }
    // formal allies send a few spears
    const allies = (state.factions || []).filter(f => f.allied);
    allies.forEach((f, ai) => { for (let i = 0; i < 2; i++) defenders.push({ id: "ally" + ai + i, job: "guard", ally: f.name, x: 18.5, y: 7.2 + i * 0.6, hp: 15, maxHp: 15, dmg: 2.4, range: 0.45, cd: rand(), cdMax: 1, state: "muster", hitT: 99 }); });
    state.battle = {
      id: (state.battleCount = (state.battleCount || 0) + 1),
      kind: spec.kind, label: spec.label || (k.name + "s"), mode: spec.mode || "sally", from: spec.from,
      t: 0, attackers, defenders, shots: [], deaths: [], fires: {}, burnt: [], looted: { food: 0, coin: 0 }, recovered: 0,
      lootGoal: k.loots ? spec.count * 10 : 0, armour: Math.min(0.45, cap.defense / 120),
      source: spec.source || "raid", factionId: spec.factionId || null, eventId: spec.eventId || null, optionIndex: spec.optionIndex,
      outcome: null
    };
    logMsg(state, "Alarm! " + state.battle.label + " are attacking " + state.settlementName + ".");
    return state.battle;
  }

  function nearestOf(list, from, filter) {
    let best = null, bd = Infinity;
    for (const u of list) { if (filter && !filter(u)) continue; const d = dist(u, from); if (d < bd) { bd = d; best = u; } }
    return best;
  }
  function moveToward(u, target, speed, dt) {
    const d = dist(u, target);
    if (d < 0.02) return true;
    const step = Math.min(d, speed * dt);
    u.x += (target.x - u.x) / d * step; u.y += (target.y - u.y) / d * step;
    u.fx = target.x > u.x ? 1 : -1;
    return step >= d;
  }
  function settlementBox(state) {
    const built = state.grid.filter(t => t.building || t.constructing);
    let x0 = 7, x1 = 13, y0 = 4, y1 = 10;
    for (const t of built) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x + 1); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y + 1); }
    return { x0: x0 - 0.5, x1: x1 + 0.5, y0: y0 - 0.5, y1: y1 + 0.5 };
  }
  function inBox(b, u, pad) { pad = pad || 0; return u.x >= b.x0 - pad && u.x <= b.x1 + pad && u.y >= b.y0 - pad && u.y <= b.y1 + pad; }

  // Who can still be caught outside at a tile, by what they do there.
  function exposedAt(state, t) {
    const root = t.building ? D.BUILDINGS[t.building].chain[0] : (t.constructing ? "constructing" : t.terrain);
    const jobs = Object.keys(OUTDOOR_JOBS).filter(j => OUTDOOR_JOBS[j] === root || (OUTDOOR_JOBS[j] === "constructing" && t.constructing));
    return livingCitizens(state).filter(c => jobs.includes(c.job) && !c.sheltered);
  }

  function pickAttackerTarget(state, a) {
    const k = ATTACKER_KINDS[a.kind];
    const b = state.battle;
    const caught = b.t < SHELTER_SECONDS;
    let tiles;
    if (k.hunts) {
      // monsters go for wherever people work outdoors, then for houses
      tiles = state.grid.filter(t => (t.building && ["farm", "farm2", "farm3", "dock", "mine"].includes(t.building)) || t.constructing || (t.terrain === "forest" && !t.building));
      if (!caught || !tiles.length) tiles = state.grid.filter(t => t.building && !isRuinTile(t) && !isBurnt(t));
    } else {
      // raiders go for the stores first, then anything worth burning
      tiles = state.grid.filter(t => t.building && !isBurnt(t) && STORE_ROOTS.includes(D.BUILDINGS[t.building].chain[0]) && !isRuinTile(t));
      if (!tiles.length || a.carry >= 10) tiles = state.grid.filter(t => t.building && !isBurnt(t) && !isRuinTile(t) && D.BUILDINGS[t.building].chain[0] === "house");
    }
    if (!tiles.length) {
      // nothing worth taking: they come looking for a fight at the heart of the place
      const keep = state.grid.find(t => t.building && D.BUILDINGS[t.building].chain[0] === "keep") || { x: 9, y: 6 };
      return { x: keep.x + 1 + (rand() - 0.5), y: keep.y + 1.5 + (rand() - 0.5) * 0.6, key: tileKey(keep) };
    }
    tiles.sort((p, q) => dist({ x: p.x + 0.5, y: p.y + 0.5 }, a) - dist({ x: q.x + 0.5, y: q.y + 0.5 }, a));
    const t = tiles[Math.floor(rand() * Math.min(3, tiles.length))];
    return { x: t.x + 0.5 + (rand() - 0.5) * 0.4, y: t.y + 0.5 + (rand() - 0.5) * 0.4, key: tileKey(t) };
  }

  function killCitizen(state, c, cause) {
    if (!c || !c.alive) return;
    c.alive = false; c.job = null;
    state.stats.deaths++;
    if (c.important) {
      chronicle(state, c.name + " was killed " + (cause === "monster" ? "by monsters" : "in the fighting") + ". Their memory will be recorded.");
      handleSuccession(state, c);
    } else {
      logMsg(state, c.name + " was killed " + (cause === "monster" ? "by monsters" : "in the fighting") + ".");
    }
  }

  function tickBattle(state, dt) {
    const b = state.battle;
    if (!b || b.outcome) return null;
    // small fixed steps keep fights fair at any game speed
    while (dt > 1e-6 && !b.outcome) {
      const h = Math.min(0.1, dt);
      dt -= h;
      stepBattle(state, b, h);
    }
    return b.outcome;
  }

  function stepBattle(state, b, h) {
    b.t += h;
    const box = settlementBox(state);
    const live = b.attackers.filter(a => a.state !== "dead" && a.state !== "gone");
    const up = b.defenders.filter(d => d.state !== "down");
    for (const u of b.attackers) u.hitT += h;
    for (const u of b.defenders) u.hitT += h;
    if (b.t >= SHELTER_SECONDS && !b.sheltered) {
      b.sheltered = true;
      for (const c of livingCitizens(state)) c.sheltered = true;
    }
    // --- attackers
    const lost = b.attackers.filter(a => a.state === "dead").length / Math.max(1, b.attackers.length);
    for (const a of live) {
      const k = ATTACKER_KINDS[a.kind];
      if (a.state === "flee") {
        const exit = a.kind === "drowner" ? { x: 1, y: a.y } : { x: GRID_W + 0.5, y: 7.5 };
        if (moveToward(a, exit, k.speed * 1.1, h) || a.x < 0.6 || a.x > GRID_W) a.state = "gone";
        continue;
      }
      if (k.flees && lost >= k.flees) { b.broke = true; a.state = "flee"; continue; }
      if (b.t >= BATTLE_LIMIT) { a.state = "flee"; continue; }
      if (k.loots && a.carry >= 10 && a.state !== "fight") {
        // arms full: some put a torch to a house on the way out
        if (k.burns && !a.torched && a.wantsTorch === undefined) a.wantsTorch = rand() < 0.45;
        if (!a.wantsTorch || a.torched) { a.state = "flee"; continue; }
        if (!a.target || a.target.kind !== "torch") {
          const houses = state.grid.filter(t => t.building && !isBurnt(t) && !isRuinTile(t) && D.BUILDINGS[t.building].chain[0] === "house");
          const near = nearestOf(houses.map(t => ({ x: t.x + 0.5, y: t.y + 0.5, key: tileKey(t), kind: "torch" })), a);
          if (!near) { a.state = "flee"; continue; }
          a.target = near;
        }
      }
      // fight anyone close
      const foe = nearestOf(up, a, d => d.state !== "down");
      if (foe && dist(foe, a) < 1.6) {
        a.state = "fight";
        if (dist(foe, a) > k.range) moveToward(a, foe, k.speed, h);
        else if ((a.cd -= h) <= 0) {
          a.cd = k.cd;
          if (rand() < HIT_CHANCE) foe.hp -= k.dmg * (1 - b.armour);
          foe.hitT = 0;
          if (foe.hp <= 0) { foe.hp = 0; foe.state = "down"; }
        }
        continue;
      }
      if (a.state === "fight") a.state = "approach";
      if (!a.target) a.target = pickAttackerTarget(state, a);
      if (!a.target) { a.state = "flee"; continue; }
      if (!moveToward(a, a.target, k.speed, h)) continue;
      // arrived: catch whoever is still outside, loot, burn
      const [tx, ty] = a.target.key.split(",").map(Number);
      const t = tileAt(state.grid, tx, ty);
      if (!t) { a.target = null; continue; }
      if (!b.sheltered && !(b.scattered || (b.scattered = {}))[a.target.key]) {
        // the first one there may catch someone; everyone else at that spot runs for it
        b.scattered[a.target.key] = true;
        const victims = rand() < 0.5 ? exposedAt(state, t) : [];
        if (victims.length) {
          const v = victims[Math.floor(rand() * victims.length)];
          b.deaths.push({ id: v.id, x: a.x + 0.2, y: a.y + 0.1, t: b.t, by: a.kind });
          killCitizen(state, v, k.hunts ? "monster" : "raid");
        }
      }
      a.dwell = (a.dwell || 0) + h;
      if (k.loots && t.building && STORE_ROOTS.includes(D.BUILDINGS[t.building].chain[0])) {
        const take = Math.min(10 - a.carry, 3 * h);
        const food = Math.min(state.resources.food, take * 0.6), coin = Math.min(state.resources.coin, take * 0.4);
        state.resources.food = round2(state.resources.food - food); state.resources.coin = round2(state.resources.coin - coin);
        a.carry += food + coin; b.looted.food += food; b.looted.coin += coin;
        if (state.resources.food + state.resources.coin < 1) a.carry = 10;
      } else if (k.burns && t.building && !isRuinTile(t) && !isBurnt(t)) {
        const key = tileKey(t);
        if (b.fires[key] === undefined && rand() < (a.wantsTorch ? 0.8 : 0.25) * h) b.fires[key] = 0.01;
        if (b.fires[key] !== undefined && a.wantsTorch) a.torched = true;
      }
      if (a.dwell > 4) { a.dwell = 0; a.target = null; }
    }
    // fires spread through a building while the battle lasts
    for (const key in b.fires) {
      if (b.fires[key] >= 1) continue;
      b.fires[key] = Math.min(1, b.fires[key] + h / 14);
      if (b.fires[key] >= 1) {
        const [x, y] = key.split(",").map(Number);
        const t = tileAt(state.grid, x, y);
        if (t && !t.burnt) { t.burnt = true; b.burnt.push(key); }
      }
    }
    // --- defenders
    const targets = b.attackers.filter(a => a.state !== "dead" && a.state !== "gone");
    for (const d of up) {
      if (d.state === "down") continue;
      const foe = nearestOf(targets, d, a => b.mode !== "hold" || inBox(box, a, 1.5));
      if (!foe) {
        // nothing to fight: back toward the muster point
        if (d.state !== "muster") d.state = "muster";
        continue;
      }
      d.state = "fight";
      const gap = dist(foe, d);
      if (gap > d.range) moveToward(d, foe, d.job === "scout" ? 1.4 : 1.15, h);
      else if ((d.cd -= h) <= 0) {
        d.cd = d.cdMax;
        if (rand() < HIT_CHANCE) { foe.hp -= d.dmg; foe.hitT = 0; }
        if (d.range > 1) b.shots.push({ fx: d.x, fy: d.y - 0.1, tx: foe.x, ty: foe.y, t: b.t });
        if (foe.hp <= 0) dropAttacker(state, b, foe);
      }
    }
    // --- towers
    for (const t of state.grid) {
      const tf = !isBurnt(t) && TOWER_FIRE[t.building];
      if (!tf) continue;
      const tw = { x: t.x + 0.5, y: t.y + 0.3 };
      const foe = nearestOf(targets, tw, a => a.hp > 0 && dist(a, tw) <= tf.range);
      if (!foe) continue;
      if (!b.towerCd) b.towerCd = {};
      const tk = tileKey(t);
      b.towerCd[tk] = (b.towerCd[tk] || 0) - h;
      if (b.towerCd[tk] <= 0) {
        b.towerCd[tk] = 1.2;
        if (rand() < HIT_CHANCE) { foe.hp -= tf.dps * 1.2; foe.hitT = 0; }
        b.shots.push({ fx: tw.x, fy: tw.y, tx: foe.x, ty: foe.y, t: b.t });
        if (foe.hp <= 0) dropAttacker(state, b, foe);
      }
    }
    if (b.shots.length > 40) b.shots.splice(0, b.shots.length - 40);
    // --- end
    const still = b.attackers.filter(a => a.state !== "dead" && a.state !== "gone");
    if (!still.length) {
      // once the attackers are gone, people come out with buckets; a fire may still win
      let burning = false;
      for (const key in b.fires) {
        if (b.fires[key] >= 1) continue;
        if (rand() < 0.14 * h) { delete b.fires[key]; continue; }
        burning = true;
      }
      if (!burning) endBattle(state, b);
    }
  }

  function dropAttacker(state, b, a) {
    a.hp = 0; a.state = "dead";
    // whatever they carried is left where they fell, and gathered up again
    if (a.carry > 0) {
      const share = a.carry / Math.max(1e-6, b.looted.food + b.looted.coin);
      const food = b.looted.food * share, coin = b.looted.coin * share;
      state.resources.food = round2(state.resources.food + food); state.resources.coin = round2(state.resources.coin + coin);
      b.looted.food -= food; b.looted.coin -= coin; b.recovered += a.carry; a.carry = 0;
    }
  }

  function endBattle(state, b) {
    const killed = b.attackers.filter(a => a.state === "dead").length;
    const stolen = b.looted.food + b.looted.coin;
    // won: they broke and ran, or were cut down. What they stole or burned is its own cost.
    const civilianDeaths = b.deaths.filter(d => !d.soldier).length;
    const won = killed === b.attackers.length || (b.broke && stolen < Math.max(6, b.lootGoal * 0.5)) ||
      (stolen < 6 && b.burnt.length === 0 && civilianDeaths === 0);
    b.outcome = won ? "won" : "lost";
    // fires still smouldering are put out
    for (const key in b.fires) if (b.fires[key] < 1) delete b.fires[key];
    for (const c of state.citizens) delete c.sheltered;
    // the fallen: two in five of those cut down don't get up again
    const fallen = [];
    for (const d of b.defenders) {
      if (d.state !== "down" || d.ally) continue;
      const c = state.citizens.find(x => x.id === d.id);
      if (c && c.alive && chance(0.4)) { fallen.push(c.name); b.deaths.push({ id: c.id, x: d.x, y: d.y, t: b.t, soldier: true }); killCitizen(state, c, "battle"); }
    }
    if (b.burnt.length) trimJobsToCapacity(state);
    if (won) { state.stats.battlesWon++; state.resources.reputation = clamp(round2(state.resources.reputation + 3), 0, 100); }
    else {
      state.stats.battlesLost++;
      state.flags.raidLostTurn = state.meta.turn;
      state.resources.stability = clamp(round2(state.resources.stability - 4 - b.burnt.length * 2), 0, 100);
    }
    const what = [];
    if (Math.round(stolen) > 0) what.push(Math.round(b.looted.food) + " food and " + Math.round(b.looted.coin) + " coin carried off");
    if (b.burnt.length) what.push(b.burnt.length + " building" + (b.burnt.length > 1 ? "s" : "") + " burned");
    const dead = b.deaths.length;
    if (dead) what.push(dead + " dead");
    b.summary = (won ? "The " + b.label.toLowerCase() + " were driven off" : "The " + b.label.toLowerCase() + " got the better of the defence") + (what.length ? ": " + what.join(", ") + "." : ".");
    // an event's own consequences follow the battle
    const def = b.eventId ? eventDef(b.eventId) : null;
    const cc = def && def.options[b.optionIndex] && def.options[b.optionIndex].combatCheck;
    if (cc) {
      if (won) {
        if (cc.winEffect) applyEffectBundle(state, scaleEventEffect(state, cc.winEffect));
        if (cc.winFollowUp) scheduleEvent(state, cc.winFollowUp.eventId, cc.winFollowUp.delayTurns);
        chronicle(state, cc.winChronicle || b.summary);
      } else {
        // what was taken or burned is the material loss; the rest of the blow still lands
        const rest = {};
        for (const k in (cc.loseEffect || {})) if (!["food", "coin", "wood", "stone", "iron"].includes(k)) rest[k] = cc.loseEffect[k];
        applyEffectBundle(state, scaleEventEffect(state, rest));
        if (cc.loseFollowUp) scheduleEvent(state, cc.loseFollowUp.eventId, cc.loseFollowUp.delayTurns);
        chronicle(state, cc.loseChronicle || b.summary);
      }
    } else {
      chronicle(state, b.summary);
    }
    if (fallen.length) logMsg(state, "Fallen in the defence: " + fallen.join(", ") + ".");
  }

  // Run a battle to its end straight away (skipping ahead, tests, or the month turning over).
  function finishBattleNow(state) {
    let guard = 0;
    while (battleActive(state) && guard++ < 2000) tickBattle(state, 0.25);
    if (battleActive(state)) { state.battle.t = BATTLE_LIMIT; for (const a of state.battle.attackers) if (a.state !== "dead") a.state = "gone"; endBattle(state, state.battle); }
  }

  // After buildings burn, anyone whose workplace is gone goes idle.
  function trimJobsToCapacity(state) {
    for (const jobId in D.JOBS) {
      const max = jobCapacityMax(state, jobId);
      const workers = citizensInJob(state, jobId);
      for (let i = max; i < workers.length; i++) workers[i].job = null;
    }
  }

  // Burnt buildings can be rebuilt for half their cost.
  function repairCost(t) {
    const b = D.BUILDINGS[t.building];
    const cost = {};
    for (const k in (b.cost || {})) cost[k] = Math.ceil(b.cost[k] / 2);
    return cost;
  }
  function queueRepair(state, x, y) {
    const t = tileAt(state.grid, x, y);
    if (!t || !t.burnt) return { ok: false, reason: "Nothing here needs rebuilding." };
    if (t.constructing) return { ok: false, reason: "Already being rebuilt." };
    if (battleActive(state)) return { ok: false, reason: "Wait until the fighting is over." };
    const cost = repairCost(t);
    if (!canAfford(state, cost)) return { ok: false, reason: "Not enough resources." };
    pay(state, cost);
    const time = Math.max(1, Math.ceil((D.BUILDINGS[t.building].buildTime || 1) / 2));
    t.constructing = { buildingId: t.building, remaining: time, totalTime: time, repair: true };
    return { ok: true };
  }

  // Monsters come out of their own accord now and then once the settlement is worth the trouble.
  function maybeMonsterIncursion(state) {
    if (battleActive(state) || stageIndex(state) < 1 || !chance(0.035)) return false;
    const options = [];
    if (state.grid.some(t => t.building === "dock") || citizensInJob(state, "fisherman").length) options.push({ kind: "drowner", from: "river", label: "Drowners" });
    if (state.grid.some(t => t.terrain === "forest" && !t.building)) options.push({ kind: "nekker", from: "forest", label: "Nekkers" });
    if (state.grid.some(t => t.building && isRuinTile(t))) options.push({ kind: "ghoul", from: "ruins", label: "Ghouls" });
    if (!options.length) return false;
    const o = options[Math.floor(rand() * options.length)];
    const count = clamp(Math.round((2 + stageIndex(state) * 1.2) * (0.7 + rand() * 0.6)), 2, 9);
    startBattle(state, { kind: o.kind, from: o.from, label: o.label, count, mode: "sally", source: "monsters" });
    return true;
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

  // Currying favor with an already-friendly faction costs progressively more — this is
  // what stops relationship from being something you can just cheaply buy to any level
  // and hold forever; keeping a faction at high relationship gets genuinely expensive,
  // not just slow. At relationship 0 this is a 1x multiplier; by 100 it's roughly 2.67x.
  function factionActionCost(state, factionId, actionId) {
    const f = faction(state, factionId);
    const action = D.FACTION_ACTIONS.find(a => a.id === actionId);
    if (!f || !action) return {};
    const costMult = 1 + Math.max(0, f.relationship) / 60;
    const scaled = {};
    for (const r in action.cost) scaled[r] = round2(action.cost[r] * costMult);
    return scaled;
  }

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
    const scaledCost = factionActionCost(state, factionId, actionId);
    if (!canAfford(state, scaledCost)) return { ok: false, reason: "Not enough resources." };
    pay(state, scaledCost);
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
        state.citizens.push(Object.assign(makeCitizen(28 + Math.floor(rand()*15), true, null, state), { arrivedTurn: state.meta.turn }));
        logMsg(state, f.name + " sent a specialist to join the settlement.");
        break;
      case "recurringTrade":
        f.tradeAgreement = true;
        break;
      case "alliance":
        f.allied = true;
        state.resources.reputation = clamp(round2(state.resources.reputation + 8), 0, 100);
        chronicle(state, "A formal alliance was struck with " + f.name + ". Their strength stands with the settlement's now.");
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
      if ((f.id === "bandits" || f.personality === "opportunist") && f.relationship < -20 && chance(0.05)) {
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

  // A hostile faction raids: its band walks in along the road (see startBattle).
  function triggerRaid(state, f) {
    if (battleActive(state)) return;
    const attackStrength = (f.military || 20) * (0.6 + rand() * 0.6);
    // a raiding party, not the whole company; bigger as the settlement grows richer
    const count = clamp(Math.round(attackStrength / 9 + stageIndex(state) * 0.6), 2, 9);
    startBattle(state, { kind: "raider", from: chance(0.5) ? "east" : "north", label: f.name, count, mode: "sally", source: "raid", factionId: f.id });
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
    if (maybeTriggerPetition(state)) return;
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

  // What an event option would take from the stores (after scaling), or null if free.
  // Effects used to be clamped at zero, so a choice like "Restore the shrine (-12
  // stone)" cost nothing at all when the stone store was empty and still paid out.
  function eventOptionShortfall(state, opt) {
    if (!opt || opt.combatCheck) return null;
    const eff = scaleEventEffect(state, opt.effect);
    const missing = [];
    for (const k in eff) {
      const info = D.RESOURCE_INFO[k];
      if (!info || info.max || typeof eff[k] !== "number" || eff[k] >= 0) continue;
      if ((state.resources[k] || 0) < -eff[k]) missing.push(k);
    }
    return missing.length ? missing : null;
  }
  // An option is affordable unless it costs more than the stores hold. If somehow
  // nothing is affordable, every option is allowed so the player can never be stuck.
  function eventOptionAffordable(state, optionIndex) {
    if (!state.activeEvent) return false;
    const def = eventDef(state.activeEvent.id);
    if (!def) return true;
    if (def.options.every(o => eventOptionShortfall(state, o))) return true;
    return !eventOptionShortfall(state, def.options[optionIndex]);
  }

  function resolveEvent(state, optionIndex) {
    if (!state.activeEvent) return { ok: false, reason: "No active event." };
    const def = eventDef(state.activeEvent.id);
    const opt = def.options[optionIndex];
    if (!opt) return { ok: false, reason: "Invalid option." };
    if (!eventOptionAffordable(state, optionIndex)) return { ok: false, reason: "The stores can't cover that choice." };
    let combatWon = null;
    if (opt.combatCheck && opt.combatCheck.onMap) {
      // fought out on the map; its consequences follow the battle (see endBattle)
      const m = opt.combatCheck.onMap;
      startBattle(state, { kind: m.kind, from: m.from, label: m.label, mode: m.mode, count: clamp(Math.round(opt.combatCheck.attackerStrength / 6), 2, 12),
        source: "event", eventId: state.activeEvent.id, optionIndex });
      combatWon = null;
    } else if (opt.combatCheck) {
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
      state.flags.raidLostTurn = state.meta.turn;
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
      if (key === "approval") {
        if (!state.groups) state.groups = initialGroups();
        for (const g in effect.approval) if (state.groups[g] !== undefined) state.groups[g] = clamp(state.groups[g] + effect.approval[g], 0, 100);
        continue;
      }
      if (key === "population") {
        const delta = effect.population;
        if (delta > 0) {
          for (let i = 0; i < delta; i++) {
            if (state.citizens.length >= MAX_NAMED_CITIZENS) break;
            state.citizens.push(Object.assign(makeCitizen(8 + Math.floor(rand()*40), false, null, state), { arrivedTurn: state.meta.turn }));
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
    if (battleActive(state)) finishBattleNow(state);
    state.meta.turn++;
    state.meta.month++;
    if (state.meta.month > 12) { state.meta.month = 1; state.meta.year++; }
    if (state.flags.trainingBonusTurns > 0) state.flags.trainingBonusTurns--;

    tickKingdomEffects(state);
    progressConstruction(state);
    runProduction(state);
    runConsumption(state);
    runUpkeep(state);
    runGoods(state);
    runNeeds(state);
    runPopulation(state);
    runLineage(state);
    runFactionDrift(state);
    runInterFactionPolitics(state);
    recomputeStage(state);
    runResourceDecay(state);
    maybeTriggerKingdomEvent(state);
    maybeTriggerLocalEvent(state);
    if (!state.activeEvent) maybeMonsterIncursion(state);

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
      // needs and interest groups (added later): start everyone at an even 50
      if (!state.groups) state.groups = initialGroups();
      if (!state.petitionTurns) state.petitionTurns = {};
      if (state.resources.ale === undefined) state.resources.ale = 0;
      if (state.resources.furniture === undefined) state.resources.furniture = 0;
      // BUG FIX (citizen ID collisions — see makeCitizen): old saves predate the
      // persisted citizenCounter entirely. Derive a safe resume point from the
      // highest existing numeric ID so every citizen created from now on is
      // guaranteed unique, even though any duplicates already present from before
      // this fix can't be safely re-numbered without breaking partner/parent/child
      // references that point at them.
      if (state.citizenCounter === undefined || state.citizenCounter === null) {
        let maxId = 0;
        const seenIds = new Set();
        let duplicatesFound = 0;
        for (const c of (state.citizens || [])) {
          const m = /^c(\d+)$/.exec(c.id);
          if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
          if (seenIds.has(c.id)) duplicatesFound++;
          seenIds.add(c.id);
        }
        state.citizenCounter = maxId;
        if (duplicatesFound > 0) {
          logMsg(state, "Some settlement records from an older version had conflicting identifiers (corrected for everyone created from now on).");
        }
      }
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
    needsReport, groupReport, scaleEventEffect,
    MONTH_SECONDS, ATTACKER_KINDS, startBattle, tickBattle, finishBattleNow, battleActive, queueRepair, repairCost, armedFraction, toolCoverage, settlementHappiness, groupApproval,
    toggleEdict, getFactionRelation, eventOptionShortfall, eventOptionAffordable, previewCombatChance, totalUpkeep, resourceSoftCap, factionActionCost
  };
})();

if (typeof window !== "undefined") window.GameEngine = GameEngine;
if (typeof module !== "undefined") module.exports = GameEngine;
