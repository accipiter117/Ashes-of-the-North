const Engine = require("../js/engine.js");
const Data = require("../js/data.js");

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
}

// --- Regression test: building-tier yield multipliers must actually apply ---
// (farm2/farm3/workshop2 carry an `effect.yieldMult`; a prior bug compared building
// `chain` arrays with `===`, which are always different object references even for
// buildings in the same chain, so the bonus silently never applied.)
(function testYieldMultApplies() {
  function isolatedProduction(buildingId, tier) {
    const s = Engine.newGame("YieldTest");
    const t = s.grid.find(g => g.terrain === "field" && !g.building);
    t.building = buildingId; t.tier = tier;
    const c = s.citizens[0];
    Engine.assignJob(s, c.id, "farmer");
    // Isolate the production figure: single citizen (no consumption noise) and every
    // faction relationship neutralised so a random raid can't contaminate this turn's
    // food delta (raids are resolved inside the same advanceTurn() call).
    s.citizens = [c];
    s.factions.forEach(f => { f.relationship = 0; });
    const before = s.resources.food;
    Engine.advanceTurn(s);
    return s.resources.food - before;
  }
  const base = isolatedProduction("farm", 0);
  const upgraded = isolatedProduction("farm3", 2);
  assert(upgraded > base * 1.3, "farm3 (Large Farm, x1.5 yield) should meaningfully outproduce a base farm — got base=" + base.toFixed(2) + " upgraded=" + upgraded.toFixed(2));
  console.log("Regression check OK: building yieldMult applies (base " + base.toFixed(2) + " -> farm3 " + upgraded.toFixed(2) + ")");
})();

// --- Regression test: newborns must actually be born as infants, not adults ---
// (a prior bug used `age || fallback`, and 0 is falsy in JS, so every newborn was
// silently given a random adult age instead of age 0.)
(function testNewbornAge() {
  const s = Engine.newGame("BirthTest");
  // Crowd the settlement with fertile, well-fed, housed, high-stability adults to
  // force at least one birth this turn.
  for (let i = 0; i < 30; i++) {
    const t = s.grid.find(g => g.terrain === "field" && !g.building);
    if (t) { t.building = "house3"; t.tier = 2; }
  }
  s.resources.food = 5000;
  s.resources.stability = 100;
  let bornInfant = false;
  for (let i = 0; i < 40 && !bornInfant; i++) {
    const beforeIds = new Set(s.citizens.map(c => c.id));
    Engine.advanceTurn(s);
    for (const c of s.citizens) {
      if (!beforeIds.has(c.id) && c.age <= 1) bornInfant = true;
    }
  }
  assert(bornInfant, "population growth should produce at least one citizen recorded as an infant (age 0-1) within 40 turns");
  console.log("Regression check OK: newborns are recorded with an infant age, not a random adult age");
})();

function checkFinite(state, label) {
  for (const r in state.resources) {
    assert(Number.isFinite(state.resources[r]), label + " resource " + r + " not finite: " + state.resources[r]);
  }
  assert(Number.isFinite(state.meta.turn), label + " turn not finite");
}

let failures = 0;
for (let trial = 0; trial < 5; trial++) {
  console.log("--- Trial " + trial + " ---");
  const state = Engine.newGame("Testholm");
  checkFinite(state, "init");

  // Build a reasonable spread of buildings over the run
  const buildPlan = ["house","farm","farm","workshop","market","hall","guardhouse","school","well","walls","house","farm"];
  let bi = 0;
  let placed = 0;

  for (let turn = 0; turn < 240; turn++) {
    // resolve any pending event with a random valid option
    if (state.activeEvent) {
      const def = Data.LOCAL_EVENTS.find(e => e.id === state.activeEvent.id);
      const idx = Math.floor(Math.random() * def.options.length);
      const r = Engine.resolveEvent(state, idx);
      assert(r.ok, "event resolve failed: " + JSON.stringify(r));
    }

    // occasionally queue a new building on an empty valid tile
    if (bi < buildPlan.length && turn % 4 === 0) {
      const bId = buildPlan[bi];
      const bdef = Data.BUILDINGS[bId];
      let target = null;
      for (const t of state.grid) {
        if (t.building || t.constructing) continue;
        if (bdef.requiresTile && t.terrain !== bdef.requiresTile) continue;
        if (!bdef.requiresTile && (t.terrain === "river" || t.terrain === "hills")) continue;
        target = t; break;
      }
      if (target) {
        const res = Engine.queueConstruction(state, target.x, target.y, bId);
        if (res.ok) { bi++; placed++; }
      }
    }

    // upgrade the keep/shrine/storehouse ruins early
    if (turn === 10) {
      ["keep","shrine","storehouse"].forEach(rid => {
        const t = state.grid.find(g => g.building === rid);
        if (t) Engine.queueUpgrade(state, t.x, t.y);
      });
    }

    Engine.autoAssignIdle(state);

    // try a faction action every so often
    if (turn % 7 === 0) {
      const f = Data.FACTIONS[turn % Data.FACTIONS.length];
      const a = Data.FACTION_ACTIONS[turn % Data.FACTION_ACTIONS.length];
      Engine.performFactionAction(state, f.id, a.id); // ignore result — may legitimately fail (cost)
    }

    // try exploring occasionally
    if (turn % 9 === 0) {
      Engine.exploreNext(state);
    }

    // try research if affordable
    if (turn % 15 === 0) {
      for (const techId in Data.TECHS) {
        Engine.researchTech(state, techId);
      }
    }

    const res = Engine.advanceTurn(state);
    assert(res.ok, "advanceTurn failed at turn " + turn + ": " + JSON.stringify(res));
    checkFinite(state, "turn " + turn);
    assert(Engine.population(state) >= 0, "negative population at turn " + turn);
    assert(state.resources.stability >= 0 && state.resources.stability <= 100, "stability out of range: " + state.resources.stability);
    assert(state.resources.reputation >= 0 && state.resources.reputation <= 100, "reputation out of range: " + state.resources.reputation);
    assert(state.resources.food >= 0, "negative food at turn " + turn);
  }

  console.log("Turns simulated: 240 | Buildings placed: " + placed + " | Final stage: " + state.meta.stage +
    " | Population: " + Engine.population(state) + " | Coin: " + state.resources.coin.toFixed(1) +
    " | Stability: " + state.resources.stability.toFixed(1) + " | Legacy: " + Engine.legacyScore(state));

  // Save/load round trip test (mock localStorage)
  global.localStorage = (function () {
    let store = {};
    return {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: k => { delete store[k]; }
    };
  })();
  const saveRes = Engine.saveGame(state);
  assert(saveRes.ok, "save failed");
  const loadRes = Engine.loadGame();
  assert(loadRes.ok, "load failed: " + loadRes.reason);
  assert(loadRes.state.meta.turn === state.meta.turn, "loaded turn mismatch");
  checkFinite(loadRes.state, "post-load");

  // Corrupted save handling
  localStorage.setItem("ashesOfTheNorth_save_v1", "{not valid json");
  const corrupt = Engine.loadGame();
  assert(!corrupt.ok, "corrupted save should fail gracefully, not throw");
  console.log("Save/load + corruption handling OK");
}

console.log("\nALL SIMULATION TRIALS PASSED");
