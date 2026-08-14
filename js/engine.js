/* ================================================================
   ASHES OF THE NORTH — GAME ENGINE
   Pure logic module. No DOM access here (keeps it testable with
   Node and reusable if the UI layer is ever swapped out).
   ================================================================ */

const GameEngine = (function () {
  const D = (typeof GameData !== "undefined") ? GameData : require("./data.js");

  const SAVE_KEY = "ashesOfTheNorth_save_v1";
  const GRID_W = 10, GRID_H = 7;
  const BASE_CAMP_HOUSING = 14;
  const MAX_NAMED_CITIZENS = 220;

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
  function makeCitizen(age, important) {
    citizenCounter++;
    const sex = chance(0.5) ? "m" : "f";
    const first = sex === "m" ? pick(FIRST_NAMES_M) : pick(FIRST_NAMES_F);
    const last = pick(SURNAMES);
    const traitCount = important ? 2 : (chance(0.4) ? 1 : 0);
    const traits = [];
    for (let i = 0; i < traitCount; i++) {
      const t = pick(TRAITS).id;
      if (!traits.includes(t)) traits.push(t);
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
      history: important ? ["Joined the settlement."] : [],
      arrivedTurn: 0
    };
  }

  // ---------------------------------------------------------------
  // GRID GENERATION
  // ---------------------------------------------------------------
  function buildInitialGrid() {
    const grid = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        let terrain = "field";
        if (x === 0 || x === 1) terrain = "river";
        else if (x >= GRID_W - 2 && y <= 1) terrain = "hills";
        else if (y === GRID_H - 1 && x > 3) terrain = "forest";
        else if (x === 5 && y === 3) terrain = "road";
        grid.push({ x, y, terrain, building: null, tier: 0, constructing: null });
      }
    }
    // Place the three ruin anchors near the centre
    setBuilding(grid, 4, 2, "keep");
    setBuilding(grid, 5, 2, "shrine");
    setBuilding(grid, 4, 4, "storehouse");
    return grid;
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

  function capacities(state) {
    const cap = { housing: BASE_CAMP_HOUSING, defense: 0, jobSlots: {}, tradeBonus: 0, knowledgeMult: 1, trainingBonus: 0, foodStorage: state.resourceCap.food };
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
      if (!b || !b.effect || !b.effect.yieldMult || !b.chain) continue;
      if (b.chain[0] === rootId) mult = Math.max(mult, b.effect.yieldMult);
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
    return str * mult;
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
          amount *= fmult * kfmult;
        }
        if (res === "coin") {
          const { mult: cmult } = techMult(state, "coinMult");
          const { mult: kcmult } = kingdomMult(state, "coinMult");
          amount *= cmult * kcmult * (1 + cap.tradeBonus);
        }
        if (res === "knowledge") {
          const { mult: kmult } = techMult(state, "knowledgeMult");
          amount *= kmult * cap.knowledgeMult;
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
    // stability abstract drift from tech + kingdom
    const { flat: stabFlat } = techMult(state, "stabilityFlat");
    const { flat: stabDrift } = kingdomMult(state, "stabilityDrift");
    state.resources.stability = clamp(round2(state.resources.stability + stabFlat + stabDrift), 0, 100);
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
    } else {
      logMsg(state, "A resident named " + victim.name + " has died" + (cause ? " (" + cause + ")" : "") + ".");
    }
  }

  function runPopulation(state) {
    const pop = population(state);
    if (pop === 0) return;
    const cap = capacities(state);
    const slack = cap.housing > pop ? 1 : 0.25;
    const { mult: growthMult } = kingdomMult(state, "growthMult");
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
  function maybeTriggerLocalEvent(state) {
    if (state.activeEvent) return;
    if (!chance(0.35)) return;
    const ev = pick(D.LOCAL_EVENTS);
    state.activeEvent = { id: ev.id, title: ev.title, text: ev.text, options: ev.options };
  }

  function resolveEvent(state, optionIndex) {
    if (!state.activeEvent) return { ok: false, reason: "No active event." };
    const def = D.LOCAL_EVENTS.find(e => e.id === state.activeEvent.id);
    const opt = def.options[optionIndex];
    if (!opt) return { ok: false, reason: "Invalid option." };
    applyEffectBundle(state, opt.effect);
    if (opt.chronicle) chronicle(state, opt.chronicle);
    state.activeEvent = null;
    state.stats.eventsResolved++;
    return { ok: true };
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
    runFactionDrift(state);
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
    newBuildOptions, queueConstruction, queueUpgrade, cancelConstruction,
    performFactionAction, faction,
    resolveEvent, exploreNext, researchTech,
    militaryStrength, legacyScore,
    saveGame, loadGame, hasSave, deleteSave,
    tileAt, isRuinTile, builtTiles
  };
})();

if (typeof window !== "undefined") window.GameEngine = GameEngine;
if (typeof module !== "undefined") module.exports = GameEngine;
