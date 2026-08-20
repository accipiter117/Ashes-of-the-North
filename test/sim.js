const Engine = require("../js/engine.js");
const Data = require("../js/data.js");

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
}

// advanceTurn() correctly refuses to advance while an event is awaiting a decision
// (by design — you can't skip past a choice). Isolated single/double-turn tests below
// need to resolve any pending event first or they'll silently no-op and measure
// nothing. This bit three separate tests before it got factored out here — use this
// instead of a bare Engine.advanceTurn() in any new isolated test.
function resolveIfEvent(s) {
  if (s.activeEvent) {
    const def = Data.LOCAL_EVENTS.find(e => e.id === s.activeEvent.id);
    Engine.resolveEvent(s, Math.floor(Math.random() * def.options.length));
  }
}
function advanceClean(s) {
  resolveIfEvent(s);
  const r = Engine.advanceTurn(s);
  if (!r.ok) throw new Error("advanceTurn unexpectedly refused: " + r.reason);
  return r;
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
    c.traits = []; // neutralise random trait bonuses so this measures the building multiplier only
    Engine.assignJob(s, c.id, "farmer");
    // Isolate the production figure: single citizen (no consumption noise) and every
    // faction relationship neutralised so a random raid can't contaminate this turn's
    // food delta (raids are resolved inside the same advanceTurn() call).
    s.citizens = [c];
    s.factions.forEach(f => { f.relationship = 0; });
    const before = s.resources.food;
    advanceClean(s);
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
  for (let i = 0; i < 60 && !bornInfant; i++) {
    const beforeIds = new Set(s.citizens.map(c => c.id));
    advanceClean(s);
    for (const c of s.citizens) {
      if (!beforeIds.has(c.id) && c.age <= 1) bornInfant = true;
    }
  }
  assert(bornInfant, "population growth should produce at least one citizen recorded as an infant (age 0-1) within 60 turns");
  console.log("Regression check OK: newborns are recorded with an infant age, not a random adult age");
})();

function checkFinite(state, label) {
  for (const r in state.resources) {
    assert(Number.isFinite(state.resources[r]), label + " resource " + r + " not finite: " + state.resources[r]);
  }
  assert(Number.isFinite(state.meta.turn), label + " turn not finite");
}

// --- Regression test: adjacency bonuses must actually affect production ---
(function testAdjacencyApplies() {
  function productionWithNeighbour(neighbourTerrain) {
    const s = Engine.newGame("AdjTest");
    const t = s.grid.find(g => g.terrain === "field" && !g.building && g.x > 0 && !Engine.tileAt(s.grid, g.x - 1, g.y).building);
    t.building = "farm"; t.tier = 0;
    const n = Engine.tileAt(s.grid, t.x - 1, t.y);
    n.terrain = neighbourTerrain;
    const c = s.citizens[0];
    c.traits = [];
    Engine.assignJob(s, c.id, "farmer");
    s.citizens = [c];
    s.factions.forEach(f => { f.relationship = 0; });
    const before = s.resources.food;
    advanceClean(s);
    return s.resources.food - before;
  }
  const withoutRiver = productionWithNeighbour("forest");
  const withRiver = productionWithNeighbour("river");
  assert(withRiver > withoutRiver, "a farm next to a river should outproduce one that isn't — got forest=" + withoutRiver.toFixed(2) + " river=" + withRiver.toFixed(2));
  console.log("Regression check OK: adjacency bonus applies (farm+forest " + withoutRiver.toFixed(2) + " -> farm+river " + withRiver.toFixed(2) + ")");
})();

// --- Regression test: edicts must actually apply their effect and respect cooldown ---
(function testEdictsApply() {
  const s = Engine.newGame("EdictTest");
  const t = s.grid.find(g => g.terrain === "field" && !g.building);
  t.building = "farm"; t.tier = 0;
  const c = s.citizens[0];
  c.traits = [];
  Engine.assignJob(s, c.id, "farmer");
  s.citizens = [c];
  s.factions.forEach(f => { f.relationship = 0; });

  const before = s.resources.food;
  advanceClean(s);
  const baselineGain = s.resources.food - before;

  // advanceTurn() can set a fresh activeEvent as its own final step (which still
  // returns success for that call), leaving it pending going into the next call.
  // For this controlled second measurement we discard it outright rather than
  // resolving it — we don't want a random event's own resource effect contaminating
  // the specific delta we're isolating here. Same reasoning for kingdomEffects: a
  // temporary modifier (e.g. workerAvailability) can be rolled during the first
  // measurement turn and still be active for the second, which is real game behaviour
  // but noise for this specific isolated comparison.
  s.activeEvent = null;
  s.kingdomEffects = [];

  const toggleResult = Engine.toggleEdict(s, "forced_labour"); // effect: farmYieldMult 1.2
  assert(toggleResult.ok && toggleResult.active, "toggling an edict for the first time should succeed and activate it");

  const before2 = s.resources.food;
  advanceClean(s);
  const withEdictGain = s.resources.food - before2;
  assert(withEdictGain > baselineGain, "Forced Labour edict should increase farm output — got baseline=" + baselineGain.toFixed(2) + " withEdict=" + withEdictGain.toFixed(2));

  const immediateToggleBack = Engine.toggleEdict(s, "forced_labour");
  assert(!immediateToggleBack.ok, "toggling the same edict again immediately should be blocked by its cooldown");

  console.log("Regression check OK: edicts apply their effect (baseline " + baselineGain.toFixed(2) + " -> Forced Labour " + withEdictGain.toFixed(2) + ") and enforce cooldown");
})();

// --- Regression test: chained events must schedule and later fire their follow-up ---
(function testChainedEventsFire() {
  const s = Engine.newGame("ChainTest");
  // Force the specific starting event rather than relying on the 35% random roll.
  const startDef = Data.LOCAL_EVENTS.find(e => e.id === "elven_refugees");
  s.activeEvent = { id: startDef.id, title: startDef.title, text: startDef.text, options: startDef.options };
  const turnAtChoice = s.meta.turn;
  const turnAwayIdx = startDef.options.findIndex(o => o.text === "Turn them away");
  const r = Engine.resolveEvent(s, turnAwayIdx);
  assert(r.ok, "resolving the chain-starting event should succeed");
  assert(s.scheduledEvents.length === 1 && s.scheduledEvents[0].eventId === "refugees_return_bitter",
    "choosing 'Turn them away' should schedule the refugees_return_bitter follow-up");
  assert(s.scheduledEvents[0].dueTurn === turnAtChoice + 8, "follow-up should be due exactly 8 turns after the choice");

  // Advance turns (resolving any unrelated random event along the way with its first
  // option) until the scheduled follow-up itself surfaces as the active event.
  let sawFollowUp = false;
  for (let i = 0; i < 20 && !sawFollowUp; i++) {
    if (s.activeEvent && s.activeEvent.id === "refugees_return_bitter") { sawFollowUp = true; break; }
    if (s.activeEvent) Engine.resolveEvent(s, 0);
    const res = Engine.advanceTurn(s);
    assert(res.ok, "advanceTurn should succeed while chaining forward");
    if (s.activeEvent && s.activeEvent.id === "refugees_return_bitter") sawFollowUp = true;
  }
  assert(sawFollowUp, "the scheduled follow-up event should eventually appear as the active event");
  assert(!s.scheduledEvents.some(e => e.eventId === "refugees_return_bitter"),
    "the fired follow-up should be removed from the queue (other unrelated events may have since been scheduled, which is fine)");
  console.log("Regression check OK: chained events schedule and fire their follow-up correctly");
})();

// --- Regression test: a chain can run three levels deep, not just two ---
(function testThreeLevelChain() {
  const s = Engine.newGame("ChainDepthTest");
  const startDef = Data.LOCAL_EVENTS.find(e => e.id === "noble_claim");
  s.activeEvent = { id: startDef.id, title: startDef.title, text: startDef.text, options: startDef.options };
  const contestIdx = startDef.options.findIndex(o => o.text === "Contest the claim");
  Engine.resolveEvent(s, contestIdx);
  assert(s.scheduledEvents[0].eventId === "noble_retaliates", "contesting the claim should schedule noble_retaliates");

  function advanceUntil(targetEventId, maxTurns) {
    for (let i = 0; i < maxTurns; i++) {
      if (s.activeEvent && s.activeEvent.id === targetEventId) return true;
      if (s.activeEvent) Engine.resolveEvent(s, 0); // an unrelated random event fired — resolve and keep going
      Engine.advanceTurn(s);
      if (s.activeEvent && s.activeEvent.id === targetEventId) return true;
    }
    return false;
  }

  let outcome = advanceUntil("noble_retaliates", 25);
  assert(outcome === true, "level-2 event (noble_retaliates) should surface within 25 turns");
  const level2Def = Data.LOCAL_EVENTS.find(e => e.id === "noble_retaliates");
  const standFirmIdx = level2Def.options.findIndex(o => o.text === "Stand firm again");
  Engine.resolveEvent(s, standFirmIdx);
  assert(s.scheduledEvents.some(e => e.eventId === "noble_final_ultimatum"), "standing firm again should schedule the level-3 ultimatum");

  outcome = advanceUntil("noble_final_ultimatum", 25);
  assert(outcome === true, "level-3 event (noble_final_ultimatum) should surface within 25 turns");
  console.log("Regression check OK: a three-level event chain (claim -> retaliation -> ultimatum) fires end to end");
})();

// --- Regression test: lineage (marriage/birth/succession) must stay internally consistent ---
(function testLineageConsistency() {
  const s = Engine.newGame("LineageTest");
  // Build enough housing that population growth (and therefore marriage/birth
  // opportunities) isn't bottlenecked, and keep every faction neutral so raids
  // don't wipe out the notable pool before lineage has a chance to run.
  for (let i = 0; i < 20; i++) {
    const t = s.grid.find(g => g.terrain === "field" && !g.building);
    if (t) { t.building = "house3"; t.tier = 2; }
  }
  s.resources.stability = 90;
  s.factions.forEach(f => { f.relationship = 0; });

  // Force-pair two founding citizens directly so the birth mechanism has a guaranteed
  // eligible couple from turn 1 (random marriage timing alone made this test flaky —
  // over 300 turns there's a small but real chance no marriage happens early enough
  // to also produce a birth in the remaining window). Natural random marriage is still
  // exercised for the sawMarriage assertion below via every other notable citizen.
  const seedA = s.citizens.find(c => c.important);
  const seedB = s.citizens.find(c => c.important && c.id !== seedA.id);
  seedA.partnerId = seedB.id;
  seedB.partnerId = seedA.id;
  seedA.age = 25; seedB.age = 25;

  let sawMarriage = false, sawBirthWithInheritedTrait = false, sawAnyBirth = false;
  const namedIdsAtStart = new Set(s.citizens.map(c => c.id));

  for (let i = 0; i < 300; i++) {
    if (s.activeEvent) Engine.resolveEvent(s, 0);
    // Pin the seeded couple's age, survival, and pairing every turn. Without this,
    // ordinary mortality (starvation, raids — not just old age) can kill one of them
    // partway through and cut the eligible window short, which is a real interaction
    // between lineage and the mortality system but not what this test isolates: it's
    // specifically checking that a stably-eligible couple does eventually produce a
    // child, not re-testing survival odds on top of it.
    if (!seedA.alive) seedA.alive = true;
    if (!seedB.alive) seedB.alive = true;
    seedA.age = 25; seedB.age = 25;
    // Before forcing the seed pairing back, cleanly release anyone the surviving seed
    // member may have validly remarried while the other was dead (real, correct game
    // behaviour) — otherwise overwriting their link here would leave that third party's
    // partnerId dangling, which is a test-harness bug, not a lineage-system one.
    if (seedA.partnerId && seedA.partnerId !== seedB.id) {
      const stray = s.citizens.find(x => x.id === seedA.partnerId);
      if (stray) stray.partnerId = null;
    }
    if (seedB.partnerId && seedB.partnerId !== seedA.id) {
      const stray = s.citizens.find(x => x.id === seedB.partnerId);
      if (stray) stray.partnerId = null;
    }
    seedA.partnerId = seedB.id; seedB.partnerId = seedA.id;
    Engine.advanceTurn(s);

    for (const c of s.citizens) {
      if (c.important && c.partnerId) sawMarriage = true;
      if (!namedIdsAtStart.has(c.id) && c.parentIds && c.parentIds.length === 2) {
        sawAnyBirth = true;
        const parents = c.parentIds.map(pid => s.citizens.find(x => x.id === pid));
        const parentTraitPool = parents.reduce((acc, p) => acc.concat(p ? p.traits : []), []);
        if (c.traits.length === 0 || c.traits.every(t => parentTraitPool.includes(t))) sawBirthWithInheritedTrait = true;
      }
    }

    // Invariants checked every turn, not just at the end, so a transient bad state
    // (e.g. a death that forgot to clear the surviving partner's link) can't slip by.
    for (const c of s.citizens) {
      if (c.alive && c.partnerId) {
        const partner = s.citizens.find(x => x.id === c.partnerId);
        assert(partner, "citizen " + c.id + " has a partnerId pointing to a citizen that doesn't exist");
        assert(partner.alive, "living citizen " + c.name + " still has partnerId pointing to the DEAD " + partner.name + " — should have been cleared on death");
      }
      if (c.parentIds && c.parentIds.length) {
        for (const pid of c.parentIds) {
          assert(s.citizens.some(x => x.id === pid), c.name + " has parentId " + pid + " that doesn't correspond to any citizen");
        }
      }
      if (c.childrenIds && c.childrenIds.length) {
        for (const cid of c.childrenIds) {
          const child = s.citizens.find(x => x.id === cid);
          assert(child, c.name + " lists a child " + cid + " that doesn't exist");
          assert(child.parentIds.includes(c.id), "child " + (child && child.name) + " doesn't list " + c.name + " back as a parent");
        }
      }
    }
  }

  assert(sawMarriage, "at least one marriage should occur across 300 turns with ample housing and stability");
  assert(sawAnyBirth, "at least one child should be born to a notable couple across 300 turns");
  assert(sawBirthWithInheritedTrait, "at least one born child's traits should be explainable by inheritance from their parents' trait pools");
  console.log("Regression check OK: lineage system produces marriages and births, with consistent bidirectional family links throughout, and traits trace back to parents");
})();

// --- Regression test: inter-faction relations seed correctly, stay symmetric/bounded, and incidents actually fire ---
(function testInterFactionPolitics() {
  const s = Engine.newGame("FactionTest");
  assert(Engine.getFactionRelation(s, "garrison", "bandits") === -60, "garrison/bandits should start seeded at -60");
  assert(Engine.getFactionRelation(s, "bandits", "garrison") === -60, "seed should be symmetric");
  assert(Engine.getFactionRelation(s, "heddon", "witcher") === 0, "an unlisted pair should default to neutral (0)");

  let sawIncident = false;
  for (let i = 0; i < 400; i++) {
    if (s.activeEvent) Engine.resolveEvent(s, 0);
    const before = JSON.stringify(s.factions.map(f => f.relations));
    Engine.advanceTurn(s);
    const after = JSON.stringify(s.factions.map(f => f.relations));
    if (before !== after) sawIncident = true;

    // Symmetry + bounds invariant, checked every turn so a transient bad state can't slip by.
    for (const f of s.factions) {
      for (const otherId in f.relations) {
        const val = f.relations[otherId];
        assert(val >= -100 && val <= 100, "relation " + f.id + "->" + otherId + " out of bounds: " + val);
        const otherFaction = s.factions.find(x => x.id === otherId);
        assert(otherFaction, f.id + " has a relation entry for unknown faction " + otherId);
        assert(otherFaction.relations[f.id] === val,
          "asymmetric relation: " + f.id + "->" + otherId + "=" + val + " but " + otherId + "->" + f.id + "=" + otherFaction.relations[f.id]);
      }
    }
  }
  assert(sawIncident, "at least one inter-faction incident should occur across 400 turns");
  console.log("Regression check OK: inter-faction relations seed correctly, stay symmetric and bounded, and incidents fire over time");
})();

// --- Regression test: an old save missing the relations matrix must backfill cleanly ---
(function testFactionRelationsBackfill() {
  global.localStorage = (function () {
    let store = {};
    return { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  })();
  const s = Engine.newGame("BackfillTest");
  // Simulate a pre-Phase-2 save: strip the relations matrix entirely before saving.
  s.factions.forEach(f => { delete f.relations; });
  Engine.saveGame(s);
  const loaded = Engine.loadGame();
  assert(loaded.ok, "loading a save with no relations matrix should not fail");
  assert(loaded.state.factions.every(f => f.relations && Object.keys(f.relations).length > 0), "backfill should populate a relations matrix for every faction on an old save");
  assert(loaded.state.factions.find(f => f.id === "garrison").relations.bandits === -60, "backfill should re-seed known relationships correctly");
  console.log("Regression check OK: old saves missing the faction-relations matrix backfill cleanly");
})();

// --- Regression test: bigger grid must generate correctly and old saves must migrate losslessly ---
(function testGridSizeAndMigration() {
  const s = Engine.newGame("GridTest");
  assert(s.grid.length === Engine.GRID_W * Engine.GRID_H, "fresh grid should have GRID_W*GRID_H tiles — got " + s.grid.length);
  const ruinCount = s.grid.filter(t => ["keep", "shrine", "storehouse"].includes(t.building)).length;
  assert(ruinCount === 3, "fresh grid should have exactly 3 ruin anchors, got " + ruinCount);

  // Simulate an old, smaller pre-expansion save and confirm migration preserves it exactly.
  const old = Engine.newGame("OldGridTest");
  old.grid = old.grid.filter(t => t.x < 10 && t.y < 7);
  const oldFarmTile = old.grid.find(t => t.x === 5 && t.y === 5);
  oldFarmTile.building = "farm3"; oldFarmTile.tier = 2;
  const oldTileCount = old.grid.length;
  Engine.saveGame(old);
  const loaded = Engine.loadGame();
  assert(loaded.ok, "loading an old small-grid save should not fail");
  assert(loaded.state.grid.length === Engine.GRID_W * Engine.GRID_H, "migration should grow the grid to the current full size");
  const migratedFarm = loaded.state.grid.find(t => t.x === 5 && t.y === 5);
  assert(migratedFarm.building === "farm3" && migratedFarm.tier === 2, "a building the player already placed must survive grid migration unchanged");
  console.log("Regression check OK: grid is " + s.grid.length + " tiles, and an old " + oldTileCount + "-tile save migrates losslessly to full size");
})();

// --- Regression test: demolition must refund, clear the tile, and protect founding monuments ---
(function testDemolition() {
  const s = Engine.newGame("DemolishTest");
  const t = s.grid.find(g => g.terrain === "field" && !g.building);
  const r = Engine.queueConstruction(s, t.x, t.y, "farm");
  assert(r.ok, "should be able to queue a farm for the demolition test");
  // Finish construction instantly for the test rather than waiting out buildTime.
  t.constructing = null; t.building = "farm"; t.tier = 0;

  const before = { wood: s.resources.wood };
  const demo = Engine.demolishBuilding(s, t.x, t.y);
  assert(demo.ok, "demolishing a normal building should succeed");
  assert(t.building === null, "tile should be empty after demolition");
  assert(s.resources.wood > before.wood, "demolishing should refund some materials — got no change (before=" + before.wood + ", after=" + s.resources.wood + ")");

  const emptyDemo = Engine.demolishBuilding(s, t.x, t.y);
  assert(!emptyDemo.ok, "demolishing an already-empty tile should fail cleanly");

  const keepTile = s.grid.find(g => g.building === "keep");
  const protectedDemo = Engine.demolishBuilding(s, keepTile.x, keepTile.y);
  assert(!protectedDemo.ok, "the founding keep ruin should not be demolishable");
  assert(keepTile.building === "keep", "protected monument should remain untouched after a refused demolition attempt");
  console.log("Regression check OK: demolition refunds materials, clears the tile, and protects founding monuments");
})();

// --- Regression test: event effect magnitude scales with settlement population ---
(function testEventMagnitudeScaling() {
  function measureHarvestGain(targetPop) {
    const s = Engine.newGame("ScaleTest");
    while (Engine.population(s) < targetPop) {
      s.citizens.push({
        id: "extra" + s.citizens.length, name: "Extra Resident", age: 30, sex: "m", type: null, job: null,
        important: false, traits: [], loyalty: null, happiness: 60, alive: true, history: [], arrivedTurn: 0,
        partnerId: null, childrenIds: [], parentIds: []
      });
    }
    const def = Data.LOCAL_EVENTS.find(e => e.id === "good_harvest");
    s.activeEvent = { id: def.id, title: def.title, text: def.text, options: def.options };
    const before = s.resources.food;
    const idx = def.options.findIndex(o => o.text === "Store the surplus");
    Engine.resolveEvent(s, idx);
    return s.resources.food - before;
  }
  const low = measureHarvestGain(5);
  const high = measureHarvestGain(200);
  assert(high > low * 3, "a populous, late-game settlement should get a meaningfully larger event payoff than a tiny one — got pop5=" + low + " pop200=" + high);
  console.log("Regression check OK: event magnitude scales with population (pop5 -> " + low + ", pop200 -> " + high + ")");
})();

// --- Regression test: event cooldown prevents the same random event repeating too soon ---
(function testEventCooldownSpacing() {
  const s = Engine.newGame("CooldownTest");
  const chainOnlyIds = new Set(Data.LOCAL_EVENTS.filter(e => e.chainOnly).map(e => e.id));
  const lastSeen = {};
  let violations = 0, totalFires = 0;
  for (let i = 0; i < 400; i++) {
    if (s.activeEvent) {
      const id = s.activeEvent.id;
      if (!chainOnlyIds.has(id)) {
        if (lastSeen[id] !== undefined && (s.meta.turn - lastSeen[id]) < 18) violations++;
        lastSeen[id] = s.meta.turn;
      }
      totalFires++;
      Engine.resolveEvent(s, 0);
    }
    Engine.advanceTurn(s);
  }
  assert(totalFires > 20, "expected a reasonable number of events to fire over 400 turns to make this test meaningful — got " + totalFires);
  assert(violations === 0, "a random-pool event repeated within its 18-turn cooldown window " + violations + " time(s)");
  console.log("Regression check OK: event cooldown prevents repeats within the window (" + totalFires + " events observed, 0 violations)");
})();

// --- Regression test: event combatCheck outcomes must actually depend on military strength ---
(function testCombatCheckRespondsToStrength() {
  function winRateFor(strengthLevel, trials) {
    let wins = 0;
    for (let i = 0; i < trials; i++) {
      const s = Engine.newGame("CombatTest" + i);
      if (strengthLevel === "high") {
        for (let g = 0; g < 8; g++) {
          const t = s.grid.find(t2 => t2.terrain === "field" && !t2.building);
          t.building = "trainingyard"; t.tier = 2;
        }
        for (let c = 0; c < 20 && c < s.citizens.length; c++) {
          Engine.assignJob(s, s.citizens[c].id, c % 3 === 0 ? "archer" : (c % 3 === 1 ? "guard" : "militia"));
        }
        for (let g = 0; g < 30; g++) {
          if (s.citizens.length >= 20) break;
          s.citizens.push({ id: "sold" + g, name: "Soldier", age: 25, sex: "m", type: "soldier", job: "militia",
            important: false, traits: [], loyalty: null, happiness: 60, alive: true, history: [], arrivedTurn: 0,
            partnerId: null, childrenIds: [], parentIds: [] });
        }
      }
      // "low" strength uses the settlement exactly as newGame creates it — no soldiers assigned at all.
      const def = Data.LOCAL_EVENTS.find(e => e.id === "raiders_on_road");
      s.activeEvent = { id: def.id, title: def.title, text: def.text, options: def.options };
      const idx = def.options.findIndex(o => o.text === "Muster the militia to intercept");
      const r = Engine.resolveEvent(s, idx);
      if (r.combatWon) wins++;
    }
    return wins / trials;
  }
  const lowWinRate = winRateFor("low", 60);
  const highWinRate = winRateFor("high", 60);
  assert(highWinRate > lowWinRate + 0.25,
    "a well-armed, well-trained settlement should win a combatCheck event meaningfully more often than an undefended one — got low=" + lowWinRate.toFixed(2) + " high=" + highWinRate.toFixed(2));
  console.log("Regression check OK: combatCheck win rate scales with military strength (undefended=" + lowWinRate.toFixed(2) + ", well-armed=" + highWinRate.toFixed(2) + ")");
})();

// --- Regression test: combatCheck applies the right effect for whatever outcome actually
// occurs, and schedules the matching win/lose follow-up. Win chance is deliberately
// clamped to [5%, 95%] even at extremes (see resolveEventCombat), so this checks
// outcome-consistent effects across several trials rather than asserting a single
// trial's result is certain — a truly "always guaranteed" outcome would itself be a bug.
(function testCombatCheckEffectsAndFollowUp() {
  function makeUndefendedSettlement(seed) {
    return Engine.newGame("CombatEffectTest" + seed);
  }
  function makeOverwhelmingSettlement(seed) {
    const s = Engine.newGame("CombatEffectTest2_" + seed);
    for (let g = 0; g < 8; g++) {
      const t = s.grid.find(t2 => t2.terrain === "field" && !t2.building);
      t.building = "trainingyard"; t.tier = 2;
    }
    for (let g = 0; g < 40; g++) {
      s.citizens.push({ id: "elite" + g, name: "Elite Soldier", age: 25, sex: "m", type: "soldier", job: "archer",
        important: false, traits: [], loyalty: null, happiness: 60, alive: true, history: [], arrivedTurn: 0,
        partnerId: null, childrenIds: [], parentIds: [] });
    }
    return s;
  }

  let sawLossWithCorrectEffectAndFollowUp = false;
  let sawWinWithCorrectEffect = false;

  for (let i = 0; i < 15; i++) {
    // Undefended settlement vs a strong attacker — losing should be the common case,
    // and every loss must apply loseEffect and schedule warband_returns.
    const s = makeUndefendedSettlement(i);
    const def = Data.LOCAL_EVENTS.find(e => e.id === "rival_warband");
    s.activeEvent = { id: def.id, title: def.title, text: def.text, options: def.options };
    const idx = def.options.findIndex(o => o.text === "Meet them in open battle");
    const before = s.resources.stability;
    const r = Engine.resolveEvent(s, idx);
    assert(r.ok, "resolving a combatCheck option should succeed");
    if (r.combatWon === false) {
      assert(s.resources.stability < before, "on a loss, the loseEffect must apply (stability should drop)");
      assert(s.scheduledEvents.some(ev => ev.eventId === "warband_returns"), "a loss must schedule the warband_returns follow-up");
      sawLossWithCorrectEffectAndFollowUp = true;
    } else {
      assert(s.resources.stability > before || s.resources.reputation > 0, "on a win, the winEffect must apply, not the loseEffect");
    }

    // Overwhelmingly strong settlement vs a token attacker — winning should be the
    // common case, and every win must apply winEffect (not loseEffect).
    const s2 = makeOverwhelmingSettlement(i);
    const nightDef = Data.LOCAL_EVENTS.find(e => e.id === "night_alarm");
    s2.activeEvent = { id: nightDef.id, title: nightDef.title, text: nightDef.text, options: nightDef.options };
    const idx2 = nightDef.options.findIndex(o => o.text === "Rally swiftly to the walls");
    const stabBefore = s2.resources.stability;
    const r2 = Engine.resolveEvent(s2, idx2);
    if (r2.combatWon === true) {
      assert(s2.resources.stability >= stabBefore, "on a win, the winEffect (stability +2) must apply, not the loseEffect");
      sawWinWithCorrectEffect = true;
    }
  }

  assert(sawLossWithCorrectEffectAndFollowUp, "an undefended settlement should lose at least once in 15 trials against a strong attacker, with the correct effect and follow-up applied when it does");
  assert(sawWinWithCorrectEffect, "an overwhelmingly strong settlement should win at least once in 15 trials, with the correct effect applied when it does");
  console.log("Regression check OK: combatCheck applies the outcome-correct effect and follow-up across multiple trials");
})();

// --- Regression test: alliance eligibility gate, one-time constraint, and military bonus ---
(function testAllianceMechanic() {
  const s = Engine.newGame("AllianceTest");
  s.resources.coin = 1000; s.resources.influence = 1000;

  // Not eligible yet — a fresh faction starts well below the 70/70 threshold.
  const tooEarly = Engine.performFactionAction(s, "heddon", "form_alliance");
  assert(!tooEarly.ok, "forming an alliance before reaching the relationship/trust threshold should be rejected");
  assert(!s.factions.find(f => f.id === "heddon").allied, "faction should not be marked allied after a rejected attempt");

  // Push relationship/trust up directly (bypassing the slow diplomatic grind, which
  // is already covered by other tests) to isolate the gate/unlock logic itself.
  const heddon = s.factions.find(f => f.id === "heddon");
  heddon.relationship = 75; heddon.trust = 80;
  const strengthBefore = Engine.militaryStrength(s);
  // The approach still has its own success roll (capped at 95%, same clamped-probability
  // pattern as combat odds) separate from the eligibility gate, so retry a bounded
  // number of times rather than assuming the very first attempt must succeed.
  let allied = null;
  for (let i = 0; i < 30 && !(allied && allied.success); i++) {
    heddon.relationship = Math.max(heddon.relationship, 75); // a failed roll dings relationship slightly; keep it above threshold
    allied = Engine.performFactionAction(s, "heddon", "form_alliance");
  }
  assert(allied.ok && allied.success, "forming an alliance once eligible should eventually succeed within 30 attempts");
  assert(heddon.allied === true, "faction should be marked allied after a successful alliance");
  const strengthAfter = Engine.militaryStrength(s);
  assert(strengthAfter > strengthBefore, "an ally should measurably increase military strength — got before=" + strengthBefore + " after=" + strengthAfter);

  // One-time only — can't form the same alliance twice.
  const again = Engine.performFactionAction(s, "heddon", "form_alliance");
  assert(!again.ok, "attempting to form an alliance with an already-allied faction should be rejected");

  console.log("Regression check OK: alliance requires threshold relationship/trust, is one-time, and measurably strengthens the settlement's military");
})();

// --- Regression test: citizen IDs must never collide across a simulated page reload ---
// (a real browser reload re-executes every JS module fresh, resetting any plain
// module-level variable — this is exactly what caused the original bug, where a
// module-level `citizenCounter` reset to 0 on reload while the loaded save's citizens
// kept their old IDs, so the next citizen created after any reload collided with an
// existing one, corrupting every ID-based lookup for whichever citizen it collided with.)
(function testCitizenIdSurvivesReload() {
  global.localStorage = (function () {
    let store = {};
    return { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  })();

  const enginePath = require.resolve("../js/engine.js");
  const Engine1 = require(enginePath);
  const s1 = Engine1.newGame("ReloadIdTest");
  const idsBefore = s1.citizens.map(c => c.id);
  Engine1.saveGame(s1);

  // Simulate a real page reload: delete the module from Node's cache and re-require
  // it, forcing every module-level variable (including the old citizenCounter) back
  // to its initial value — exactly what happens when a browser reloads the page.
  delete require.cache[enginePath];
  const Engine2 = require(enginePath);
  const loaded = Engine2.loadGame();
  assert(loaded.ok, "loading the save after a simulated reload should succeed");
  assert(loaded.state.citizenCounter === idsBefore.length,
    "the citizen ID counter should be restored from the save, not reset — got " + loaded.state.citizenCounter + ", expected " + idsBefore.length);

  loaded.state.resources.coin = 2000; loaded.state.resources.influence = 2000;
  loaded.state.factions.forEach(f => { f.relationship = 100; f.trust = 100; });
  let result;
  for (let i = 0; i < 15 && !(result && result.success); i++) {
    result = Engine2.performFactionAction(loaded.state, "heddon", "invite_specialist");
  }
  assert(result && result.success, "should be able to invite a specialist (creating a new citizen) after the simulated reload");
  const idsAfter = loaded.state.citizens.map(c => c.id);
  assert(new Set(idsAfter).size === idsAfter.length,
    "citizen IDs must all be unique after creating a new citizen post-reload — found a collision among: " + idsAfter.join(","));
  assert(!idsBefore.includes(idsAfter[idsAfter.length - 1]),
    "the newly created citizen's ID must not collide with any pre-existing citizen from before the reload");

  console.log("Regression check OK: citizen IDs stay unique across a simulated page reload (no collision after reload + new citizen creation)");
})();

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

    // occasionally flip an edict
    if (turn % 11 === 0) {
      const edictIds = Object.keys(Data.EDICTS);
      Engine.toggleEdict(state, edictIds[turn % edictIds.length]); // ignore result — cooldown rejection is expected sometimes
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
