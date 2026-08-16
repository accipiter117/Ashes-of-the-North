/* ================================================================
   ASHES OF THE NORTH — GAME DATA
   Original content. Setting inspired by the Northern Kingdoms of
   The Witcher (place names used only for atmosphere/consistency).
   No copyrighted text, art, or dialogue is reproduced here.
   ================================================================ */

const GameData = (function () {

  // ---------------------------------------------------------------
  // SETTLEMENT STAGES
  // ---------------------------------------------------------------
  const STAGES = [
    { id: "camp",    name: "Refugee Camp", minPop: 0,   minBuildings: 0 },
    { id: "hamlet",  name: "Hamlet",       minPop: 18,  minBuildings: 6 },
    { id: "village", name: "Village",      minPop: 40,  minBuildings: 12 },
    { id: "town",    name: "Town",         minPop: 90,  minBuildings: 20 },
    { id: "city",    name: "City",         minPop: 160, minBuildings: 30 }
  ];

  // ---------------------------------------------------------------
  // RESOURCES
  // ---------------------------------------------------------------
  const RESOURCE_INFO = {
    food:      { name: "Food",      icon: "🌾", core: true },
    wood:      { name: "Wood",      icon: "🪵", core: true },
    stone:     { name: "Stone",     icon: "🪨", core: true },
    iron:      { name: "Iron",      icon: "⛓", core: true },
    coin:      { name: "Coin",      icon: "🪙", core: true },
    herbs:     { name: "Herbs",     icon: "🌿", core: false },
    tools:     { name: "Tools",     icon: "🔨", core: false },
    weapons:   { name: "Weapons",   icon: "⚔", core: false },
    knowledge: { name: "Knowledge", icon: "📜", abstract: true },
    influence: { name: "Influence", icon: "🕯", abstract: true },
    stability: { name: "Stability", icon: "⚖", abstract: true, max: 100 },
    reputation:{ name: "Reputation",icon: "🛡", abstract: true, max: 100 }
  };

  const STARTING_RESOURCES = {
    food: 40, wood: 60, stone: 30, iron: 5, coin: 25,
    herbs: 4, tools: 6, weapons: 4,
    knowledge: 0, influence: 5, stability: 55, reputation: 40
  };

  // ---------------------------------------------------------------
  // WORKER TYPES & JOBS
  // ---------------------------------------------------------------
  const WORKER_TYPES = {
    labourer: { name: "Labourer", jobs: ["farmer","fisherman","lumberjack","miner","builder"] },
    artisan:  { name: "Artisan",  jobs: ["blacksmith","carpenter","tanner","brewer","mason"] },
    merchant: { name: "Merchant", jobs: ["trader","innkeeper","caravan_master"] },
    clerk:    { name: "Clerk",    jobs: ["administrator","scribe","tax_collector"] },
    soldier:  { name: "Soldier",  jobs: ["militia","guard","archer","scout"] },
    scholar:  { name: "Scholar",  jobs: ["herbalist","physician","teacher","alchemist"] }
  };

  const JOBS = {
    farmer:         { name: "Farmer",          type: "labourer", requiresBuilding: "farm",       produces: { food: 3.5 },  seasonal: true },
    fisherman:      { name: "Fisherman",       type: "labourer", requiresBuilding: "dock",        produces: { food: 2.6 },  seasonal: true },
    lumberjack:     { name: "Lumberjack",      type: "labourer", requiresBuilding: null,          produces: { wood: 2.4 } },
    miner:          { name: "Miner",           type: "labourer", requiresBuilding: "mine",        produces: { stone: 1.4, iron: 0.8 } },
    builder:        { name: "Builder",         type: "labourer", requiresBuilding: null,          produces: {}, buildBonus: true },
    blacksmith:     { name: "Blacksmith",      type: "artisan",  requiresBuilding: "workshop",    produces: { tools: 1.1, weapons: 0.5 }, consumes: { iron: 0.8 } },
    carpenter:      { name: "Carpenter",       type: "artisan",  requiresBuilding: "workshop",    produces: { tools: 0.6 }, consumes: { wood: 0.6 }, buildBonus: true },
    tanner:         { name: "Tanner",          type: "artisan",  requiresBuilding: "workshop",    produces: { coin: 1.0 } },
    brewer:         { name: "Brewer",          type: "artisan",  requiresBuilding: "workshop",    produces: { stability: 0.15, coin: 0.6 }, consumes: { food: 0.4 } },
    mason:          { name: "Mason",           type: "artisan",  requiresBuilding: null,          produces: { stone: 0.5 }, buildBonus: true },
    trader:         { name: "Trader",          type: "merchant", requiresBuilding: "market",      produces: { coin: 1.8 } },
    innkeeper:      { name: "Innkeeper",       type: "merchant", requiresBuilding: "market",       produces: { coin: 0.9, stability: 0.1 } },
    caravan_master: { name: "Caravan Master",  type: "merchant", requiresBuilding: "market",       produces: { influence: 0.2, coin: 0.7 } },
    administrator:  { name: "Administrator",   type: "clerk",    requiresBuilding: "hall",        produces: { stability: 0.3 } },
    scribe:         { name: "Scribe",          type: "clerk",    requiresBuilding: "hall",         produces: { knowledge: 0.5 } },
    tax_collector:  { name: "Tax Collector",   type: "clerk",    requiresBuilding: "hall",         produces: { coin: 1.2 }, sideEffect: { stability: -0.1 } },
    militia:        { name: "Militia",         type: "soldier",  requiresBuilding: "guardhouse",  produces: {}, military: 1 },
    guard:          { name: "Guard",           type: "soldier",  requiresBuilding: "guardhouse",  produces: { stability: 0.1 }, military: 1.3 },
    archer:         { name: "Archer",          type: "soldier",  requiresBuilding: "guardhouse",  produces: {}, military: 1.6 },
    scout:          { name: "Scout",           type: "soldier",  requiresBuilding: null,           produces: {}, scouting: true },
    herbalist:      { name: "Herbalist",       type: "scholar",  requiresBuilding: null,           produces: { herbs: 0.7 } },
    physician:      { name: "Physician",       type: "scholar",  requiresBuilding: "school",       produces: { stability: 0.2 }, consumes: { herbs: 0.3 } },
    teacher:        { name: "Teacher",         type: "scholar",  requiresBuilding: "school",       produces: { knowledge: 0.9 } },
    alchemist:      { name: "Alchemist",       type: "scholar",  requiresBuilding: "school",        produces: { knowledge: 0.4, coin: 0.4 }, consumes: { herbs: 0.3 } }
  };

  // ---------------------------------------------------------------
  // BUILDINGS — chains with tiers. gridSize occupied is always 1 tile.
  // ---------------------------------------------------------------
  const BUILDINGS = {
    house:       { name: "House",            chain: ["house","house2","house3"],       tier: 0, cost: { wood: 12, stone: 4 },  upkeep: {}, effect: { housing: 4 }, buildTime: 1 },
    house2:      { name: "Improved House",    chain: ["house","house2","house3"],       tier: 1, cost: { wood: 18, stone: 10 }, upkeep: {}, effect: { housing: 7, stability: 0.05 }, buildTime: 2, upgradeOf: "house" },
    house3:      { name: "Stone House",       chain: ["house","house2","house3"],       tier: 2, cost: { wood: 10, stone: 26, iron: 4 }, upkeep: {}, effect: { housing: 10, stability: 0.1 }, buildTime: 3, upgradeOf: "house2" },

    farm:        { name: "Farm",              chain: ["farm","farm2","farm3"],          tier: 0, cost: { wood: 10 },            upkeep: {}, effect: { jobSlots: { farmer: 3 } }, buildTime: 1 },
    farm2:       { name: "Improved Farm",      chain: ["farm","farm2","farm3"],          tier: 1, cost: { wood: 16, tools: 4 }, upkeep: {}, effect: { jobSlots: { farmer: 4 }, yieldMult: 1.25 }, buildTime: 2, upgradeOf: "farm" },
    farm3:       { name: "Large Farm",         chain: ["farm","farm2","farm3"],          tier: 2, cost: { wood: 20, tools: 8, stone: 6 }, upkeep: {}, effect: { jobSlots: { farmer: 5 }, yieldMult: 1.5 }, buildTime: 3, upgradeOf: "farm2" },

    dock:        { name: "Fishing Dock",      chain: ["dock"],                          tier: 0, cost: { wood: 14 },            upkeep: {}, effect: { jobSlots: { fisherman: 3 } }, buildTime: 1, requiresTile: "river" },

    workshop:    { name: "Workshop",          chain: ["workshop","workshop2"],          tier: 0, cost: { wood: 16, stone: 6 }, upkeep: {}, effect: { jobSlots: { blacksmith: 1, carpenter: 1, tanner: 1, brewer: 1 } }, buildTime: 2 },
    workshop2:   { name: "Advanced Workshop", chain: ["workshop","workshop2"],          tier: 1, cost: { wood: 20, stone: 14, iron: 8 }, upkeep: {}, effect: { jobSlots: { blacksmith: 2, carpenter: 2, tanner: 2, brewer: 2 }, yieldMult: 1.3 }, buildTime: 3, upgradeOf: "workshop" },

    mine:        { name: "Mine",              chain: ["mine"],                          tier: 0, cost: { wood: 18, tools: 4 }, upkeep: {}, effect: { jobSlots: { miner: 3 } }, buildTime: 2, requiresTile: "hills" },

    market:      { name: "Market",            chain: ["market","market2","market3"],    tier: 0, cost: { wood: 14, coin: 10 }, upkeep: {}, effect: { jobSlots: { trader: 2, innkeeper: 1 } }, buildTime: 2 },
    market2:     { name: "Trading Post",      chain: ["market","market2","market3"],    tier: 1, cost: { wood: 20, stone: 8, coin: 30 }, upkeep: {}, effect: { jobSlots: { trader: 3, innkeeper: 2, caravan_master: 1 }, tradeBonus: 0.15 }, buildTime: 3, upgradeOf: "market" },
    market3:     { name: "Market Hall",       chain: ["market","market2","market3"],    tier: 2, cost: { wood: 24, stone: 20, coin: 60 }, upkeep: {}, effect: { jobSlots: { trader: 4, innkeeper: 2, caravan_master: 2 }, tradeBonus: 0.3 }, buildTime: 4, upgradeOf: "market2" },

    guardhouse:  { name: "Guardhouse",        chain: ["guardhouse","barracks","trainingyard"], tier: 0, cost: { wood: 12, iron: 4 }, upkeep: {}, effect: { jobSlots: { militia: 3 }, defense: 4 }, buildTime: 2 },
    barracks:    { name: "Barracks",          chain: ["guardhouse","barracks","trainingyard"], tier: 1, cost: { wood: 20, stone: 12, iron: 10 }, upkeep: {}, effect: { jobSlots: { militia: 4, guard: 2, archer: 2 }, defense: 9 }, buildTime: 3, upgradeOf: "guardhouse" },
    trainingyard:{ name: "Training Yard",     chain: ["guardhouse","barracks","trainingyard"], tier: 2, cost: { wood: 22, stone: 20, iron: 18, coin: 40 }, upkeep: {}, effect: { jobSlots: { militia: 5, guard: 3, archer: 3 }, defense: 15, trainingBonus: 0.25 }, buildTime: 4, upgradeOf: "barracks" },

    keep:        { name: "Ruined Keep",       chain: ["keep","watchtower","fortkeep","manor"], tier: 0, cost: {},                upkeep: {}, effect: {}, buildTime: 0, ruin: true },
    watchtower:  { name: "Watchtower",        chain: ["keep","watchtower","fortkeep","manor"], tier: 1, cost: { wood: 20, stone: 24 }, upkeep: {}, effect: { defense: 10, influence: 0.1 }, buildTime: 4, upgradeOf: "keep" },
    fortkeep:    { name: "Fortified Keep",    chain: ["keep","watchtower","fortkeep","manor"], tier: 2, cost: { wood: 20, stone: 50, iron: 20 }, upkeep: {}, effect: { defense: 22, influence: 0.25 }, buildTime: 6, upgradeOf: "watchtower" },
    manor:       { name: "Town Hall & Manor", chain: ["keep","watchtower","fortkeep","manor"], tier: 3, cost: { wood: 30, stone: 70, iron: 20, coin: 80 }, upkeep: {}, effect: { defense: 30, influence: 0.6, stability: 0.3 }, buildTime: 8, upgradeOf: "fortkeep" },

    hall:        { name: "Town Hall",         chain: ["hall"],                          tier: 0, cost: { wood: 20, stone: 14, coin: 20 }, upkeep: {}, effect: { jobSlots: { administrator: 2, scribe: 1, tax_collector: 2 } }, buildTime: 3 },

    school:      { name: "School",            chain: ["school","library","academy"],    tier: 0, cost: { wood: 18, stone: 6, coin: 15 }, upkeep: {}, effect: { jobSlots: { teacher: 2, physician: 1, alchemist: 1 } }, buildTime: 3 },
    library:     { name: "Library",           chain: ["school","library","academy"],    tier: 1, cost: { wood: 20, stone: 16, coin: 40 }, upkeep: {}, effect: { jobSlots: { teacher: 3, physician: 2, alchemist: 2 }, knowledgeMult: 1.3 }, buildTime: 4, upgradeOf: "school" },
    academy:     { name: "Academy",           chain: ["school","library","academy"],    tier: 2, cost: { wood: 24, stone: 24, coin: 90 }, upkeep: {}, effect: { jobSlots: { teacher: 4, physician: 3, alchemist: 3 }, knowledgeMult: 1.6 }, buildTime: 6, upgradeOf: "library" },

    walls:       { name: "Palisade Walls",    chain: ["walls","stonewalls"],            tier: 0, cost: { wood: 30 },            upkeep: {}, effect: { defense: 8 }, buildTime: 3 },
    stonewalls:  { name: "Stone Walls",       chain: ["walls","stonewalls"],            tier: 1, cost: { stone: 50, iron: 10 }, upkeep: {}, effect: { defense: 20 }, buildTime: 5, upgradeOf: "walls" },

    shrine:      { name: "Ruined Chapel",     chain: ["shrine","chapel","sanctum"],     tier: 0, cost: {},                     upkeep: {}, effect: {}, buildTime: 0, ruin: true },
    chapel:      { name: "Chapel",            chain: ["shrine","chapel","sanctum"],     tier: 1, cost: { wood: 16, stone: 10 }, upkeep: {}, effect: { stability: 0.3, influence: 0.15 }, buildTime: 3, upgradeOf: "shrine" },
    sanctum:     { name: "Sanctum",           chain: ["shrine","chapel","sanctum"],     tier: 2, cost: { wood: 20, stone: 30, coin: 30 }, upkeep: {}, effect: { stability: 0.6, influence: 0.3 }, buildTime: 5, upgradeOf: "chapel" },

    storehouse:  { name: "Ruined Storehouse", chain: ["storehouse","granary"],          tier: 0, cost: {},                     upkeep: {}, effect: {}, buildTime: 0, ruin: true },
    granary:     { name: "Granary",           chain: ["storehouse","granary"],          tier: 1, cost: { wood: 20, stone: 8 }, upkeep: {}, effect: { foodStorage: 200, spoilReduction: 0.5 }, buildTime: 3, upgradeOf: "storehouse" },

    well:        { name: "Well",              chain: ["well"],                          tier: 0, cost: { stone: 6 },           upkeep: {}, effect: { stability: 0.1 }, buildTime: 1 }
  };

  // ---------------------------------------------------------------
  // DEVELOPMENT / KNOWLEDGE TREE (compact)
  // ---------------------------------------------------------------
  const TECHS = {
    crop_rotation:     { name: "Crop Rotation",         branch: "Agriculture",     cost: 30,  requires: [],                 effect: { farmYieldMult: 1.2 }, desc: "Fields are worked in rotation, restoring the soil between plantings." },
    irrigation:        { name: "Irrigation Channels",   branch: "Agriculture",     cost: 60,  requires: ["crop_rotation"],  effect: { farmYieldMult: 1.15 }, desc: "Diverted streams keep the fields watered through dry spells." },
    record_keeping:    { name: "Record Keeping",        branch: "Administration",  cost: 25,  requires: [],                 effect: { stabilityFlat: 0.2 }, desc: "Ledgers and rolls make the settlement easier to govern fairly." },
    advanced_admin:    { name: "Advanced Administration",branch: "Administration", cost: 55,  requires: ["record_keeping"],effect: { coinMult: 1.15 }, desc: "Formal offices and clear procedure reduce waste and graft." },
    professional_militia:{ name: "Professional Militia",branch: "Military",        cost: 40,  requires: [],                 effect: { militaryMult: 1.25 }, desc: "Regular drilling turns levied farmers into a standing force." },
    fortification_craft:{ name: "Fortification Craft",  branch: "Military",        cost: 70,  requires: ["professional_militia"], effect: { defenseFlat: 10 }, desc: "Masons and engineers strengthen every wall and gate." },
    literacy:          { name: "Literacy",              branch: "Knowledge",       cost: 20,  requires: [],                 effect: { knowledgeMult: 1.2 }, desc: "More residents can read and write, speeding every record and remedy." },
    scholarly_exchange:{ name: "Scholarly Exchange",    branch: "Knowledge",       cost: 65,  requires: ["literacy"],       effect: { knowledgeMult: 1.3, reputationFlat: 5 }, desc: "Correspondence with distant scholars brings prestige and insight." }
  };

  // ---------------------------------------------------------------
  // DIPLOMACY FACTIONS
  // ---------------------------------------------------------------
  const FACTIONS = [
    { id: "heddon",     name: "Heddon",              type: "Neighbouring Village",     leader: "Elder Osric",       personality: "isolationist",  relationship: 20, trust: 30, military: 15, desc: "A cautious farming village upriver, wary of outsiders since the war." },
    { id: "brennas",    name: "Brenna's Crossing",   type: "Market Town",              leader: "Reeve Talia Voss",  personality: "merchant",      relationship: 10, trust: 25, military: 25, desc: "A river-crossing town rebuilding its trade routes." },
    { id: "caravan",    name: "The Ashford Company", type: "Merchant Caravan Guild",   leader: "Master Ashford",    personality: "merchant",      relationship: 5,  trust: 20, military: 10, desc: "Itinerant traders who move grain, salt and gossip along the roads." },
    { id: "garrison",   name: "Duren's Watch",       type: "Military Encampment",      leader: "Captain Duren",     personality: "militarist",    relationship: 0,  trust: 15, military: 60, desc: "A Temerian garrison holding the frontier road against bandits and worse." },
    { id: "noble",      name: "House Rovern",        type: "Local Noble",              leader: "Lord Aldric Rovern",personality: "opportunist",   relationship: -5, trust: 10, military: 30, desc: "A minor noble house asserting old claims over this stretch of frontier." },
    { id: "chapel",     name: "Sisters of the Flame",type: "Religious Community",      leader: "Mother Yenna",      personality: "humanitarian",  relationship: 15, trust: 30, military: 5,  desc: "A small order tending the sick and the displaced." },
    { id: "witcher",    name: "Coen of the Wolf",    type: "Wandering Witcher",        leader: "Coen",              personality: "isolationist",  relationship: 0,  trust: 15, military: 40, desc: "A witcher passing through, willing to take contracts for coin." },
    { id: "witch",      name: "The Hollow Witch",    type: "Local Witch",              leader: "Zuzka",             personality: "opportunist",   relationship: -10,trust: 10, military: 8,  desc: "A hedge-witch living in the marsh, feared and quietly relied upon." },
    { id: "dwarves",    name: "Grimstone Kin",       type: "Dwarven Craftsmen",        leader: "Foreman Brokk",     personality: "merchant",      relationship: 10, trust: 20, military: 20, desc: "A dwarven enclave with unmatched skill in stone and steel." },
    { id: "bandits",    name: "The Grey Company",    type: "Bandit Group",             leader: "unknown",           personality: "opportunist",   relationship: -30,trust: 5,  military: 35, desc: "Deserters and outlaws preying on the roads nearby." }
  ];

  // ---------------------------------------------------------------
  // INTER-FACTION POLITICS (Phase 2) — factions have opinions of each other,
  // not just of the player. Unlisted pairs default to neutral (0) and can still
  // shift over time via FACTION_INCIDENTS; only notable starting pairs are seeded here.
  // ---------------------------------------------------------------
  const FACTION_RELATIONS_SEED = [
    { a: "garrison", b: "bandits",  value: -60 },
    { a: "noble",    b: "bandits",  value: -20 },
    { a: "caravan",  b: "brennas",  value: 40 },
    { a: "caravan",  b: "bandits",  value: -50 },
    { a: "heddon",   b: "brennas",  value: 20 },
    { a: "chapel",   b: "witch",    value: -15 },
    { a: "dwarves",  b: "brennas",  value: 25 },
    { a: "noble",    b: "garrison", value: 15 },
    { a: "witcher",  b: "bandits",  value: -30 },
    { a: "witch",    b: "bandits",  value: -10 }
  ];

  // `requiresBelow` gates an incident to pairs whose current relationship is already
  // at or below that value (e.g. open war only breaks out between parties already
  // hostile; a peace treaty only makes sense between parties already at war).
  const FACTION_INCIDENTS = [
    { id: "trade_pact",     label: "forms a trade pact with",      relationDelta: 25,  kind: "positive" },
    { id: "border_dispute", label: "falls into a border dispute with", relationDelta: -25, kind: "negative" },
    { id: "open_war",       label: "declares open war on",         relationDelta: -50, kind: "war",      requiresBelow: -20 },
    { id: "peace_treaty",   label: "signs a peace treaty with",    relationDelta: 40,  kind: "positive", requiresBelow: -20 }
  ];

  const FACTION_ACTIONS = [
    { id: "trade_agreement",   name: "Propose Trade Agreement", cost: { coin: 10 },  effect: { relationship: 5, trust: 3 },  result: "recurringTrade" },
    { id: "food_trade",        name: "Trade Food for Coin",     cost: { food: 15 },  effect: { relationship: 2 },             result: "coin", amount: 12 },
    { id: "request_aid",       name: "Request Aid",             cost: {},            effect: { relationship: -2 },            result: "aidRoll" },
    { id: "offer_aid",         name: "Offer Aid",                cost: { food: 10, coin: 10 }, effect: { relationship: 8, trust: 5 }, result: "none" },
    { id: "military_training", name: "Request Military Training", cost: { coin: 15 }, effect: { relationship: 3 },            result: "militaryTraining" },
    { id: "cultural_exchange", name: "Cultural Exchange",       cost: { influence: 5 }, effect: { relationship: 6, trust: 4 }, result: "knowledge", amount: 8 },
    { id: "diplomatic_gift",   name: "Send Diplomatic Gift",    cost: { coin: 20 },  effect: { relationship: 10, trust: 6 },  result: "none" },
    { id: "share_information", name: "Share Information",       cost: {},            effect: { trust: 5 },                   result: "none" },
    { id: "invite_specialist", name: "Invite Specialist",       cost: { coin: 25, influence: 5 }, effect: { relationship: 2 }, result: "specialist" }
  ];

  // ---------------------------------------------------------------
  // MONSTERS
  // ---------------------------------------------------------------
  const MONSTERS = [
    { id: "drowners",   name: "Drowners",    threat: 12, habitat: "river",  desc: "Bloated things that rise from the shallows when the river runs high." },
    { id: "nekkers",    name: "Nekkers",     threat: 15, habitat: "forest", desc: "Small, vicious pack-hunters nesting in the forest roots." },
    { id: "ghouls",     name: "Ghouls",      threat: 20, habitat: "ruins",  desc: "Carrion-eaters drawn to the old battlefield and its dead." },
    { id: "noonwraith", name: "Noonwraith",  threat: 25, habitat: "fields", desc: "A vengeful spirit said to walk the fields at the height of summer." },
    { id: "werewolf",   name: "Werewolf",    threat: 30, habitat: "forest", desc: "A cursed man who hunts under the full moon." },
    { id: "leshen",     name: "Leshen",      threat: 40, habitat: "forest", desc: "An ancient guardian of the deep woods, rarely seen and rarely survived." }
  ];

  // ---------------------------------------------------------------
  // EXPLORATION SITES (points of interest revealed by scouting)
  // ---------------------------------------------------------------
  const EXPLORATION_SITES = [
    { id: "abandoned_mine",  name: "Abandoned Mine",     reward: { stone: 40, iron: 15 },   risk: 0.2, monster: "nekkers" },
    { id: "old_battlefield", name: "Old Battlefield",    reward: { iron: 20, coin: 10 },     risk: 0.3, monster: "ghouls" },
    { id: "hidden_cave",     name: "Hidden Cave",        reward: { herbs: 12, knowledge: 10 },risk: 0.15, monster: null },
    { id: "noble_estate",    name: "Old Noble Estate",   reward: { coin: 40, influence: 4 },  risk: 0.25, monster: null },
    { id: "witchs_hut",      name: "Witch's Hut",        reward: { herbs: 20, knowledge: 15 },risk: 0.2, monster: null },
    { id: "forgotten_settlement", name: "Forgotten Settlement", reward: { wood: 30, stone: 20, tools: 6 }, risk: 0.2, monster: null },
    { id: "bandit_camp",     name: "Bandit Camp",        reward: { coin: 50, weapons: 5 },    risk: 0.4, monster: null, bandits: true },
    { id: "abandoned_caravan", name: "Abandoned Caravan", reward: { coin: 25, tools: 8, herbs: 6 }, risk: 0.15, monster: null }
  ];

  // ---------------------------------------------------------------
  // INTEREST GROUPS
  // ---------------------------------------------------------------
  const INTEREST_GROUPS = [
    { id: "farmers",   name: "Farmers",   wants: "Land and low taxes", linkedJobs: ["farmer","fisherman"] },
    { id: "labourers", name: "Labourers", wants: "Steady work and fair pay", linkedJobs: ["lumberjack","miner","builder"] },
    { id: "merchants", name: "Merchants", wants: "Safe roads and open trade", linkedJobs: ["trader","innkeeper","caravan_master"] },
    { id: "artisans",  name: "Artisans",  wants: "Workshops and guild privileges", linkedJobs: ["blacksmith","carpenter","tanner","brewer","mason"] },
    { id: "soldiers",  name: "Soldiers",  wants: "Funding and equipment", linkedJobs: ["militia","guard","archer","scout"] },
    { id: "clergy",    name: "Clergy",    wants: "Religious institutions", linkedJobs: [] },
    { id: "scholars",  name: "Scholars",  wants: "Schools and knowledge", linkedJobs: ["teacher","physician","alchemist","herbalist"] }
  ];

  // ---------------------------------------------------------------
  // KINGDOM-WIDE EVENTS (distant, indirect effects)
  // ---------------------------------------------------------------
  const KINGDOM_EVENTS = [
    { id: "redania_summer",   text: "Word arrives that Redania has enjoyed a glorious summer harvest.", effect: { type: "temp", key: "farmYieldMult", value: 1.2, turns: 10 } },
    { id: "aedirn_levy",      text: "Aedirn has mobilised against a border incursion; levies are being called across the North.", effect: { type: "temp", key: "workerAvailability", value: 0.8, turns: 6 } },
    { id: "temeria_roads",    text: "Temerian engineers report the royal roads are being repaired.", effect: { type: "temp", key: "tradeBonus", value: 1.15, turns: 10 } },
    { id: "plague_south",     text: "Rumours speak of plague in the southern provinces.", effect: { type: "temp", key: "growthMult", value: 0.6, turns: 8 } },
    { id: "banditry_roads",   text: "Banditry has increased along the royal roads.", effect: { type: "temp", key: "tradeRisk", value: 1.3, turns: 8 } },
    { id: "royal_taxation",   text: "Royal taxation has been raised across the province.", effect: { type: "temp", key: "coinMult", value: 0.85, turns: 8 } },
    { id: "nilfgaard_tension",text: "Tensions with Nilfgaard are said to be rising once more along the southern border.", effect: { type: "temp", key: "stabilityDrift", value: -0.1, turns: 6 } },
    { id: "peace_talks",      text: "Word spreads of peace talks between the Northern Kingdoms.", effect: { type: "temp", key: "stabilityDrift", value: 0.15, turns: 6 } }
  ];

  // ---------------------------------------------------------------
  // LOCAL / MORAL-CHOICE EVENTS
  // Each option: { text, cost{}, effect{}, chronicle }
  // ---------------------------------------------------------------
  const LOCAL_EVENTS = [
    {
      id: "elven_refugees",
      title: "Refugees at the Gate",
      text: "A ragged band of elven refugees has arrived, fleeing violence further south. They ask for shelter.",
      options: [
        { text: "Admit them fully", effect: { population: 6, stability: -4, reputation: 6 }, chronicle: "Elven refugees were admitted and given a place among us.",
          followUp: { eventId: "refugees_settled_in", delayTurns: 6 } },
        { text: "Turn them away", effect: { stability: 2, reputation: -8 }, chronicle: "Elven refugees were turned away from the gate.",
          followUp: { eventId: "refugees_return_bitter", delayTurns: 8 } },
        { text: "Allow temporary settlement", effect: { population: 3, stability: -1, food: -10 }, chronicle: "Elven refugees were given temporary shelter outside the walls." },
        { text: "Ask Heddon to take them", effect: { faction: "heddon", relationship: -5 }, chronicle: "The elven refugees were sent on to Heddon." },
        { text: "Exploit their labour illegally", effect: { coin: 30, stability: -8, reputation: -12 }, chronicle: "The refugees' labour was taken by force. It will not be forgotten." },
        { text: "Seek a negotiated settlement", effect: { population: 4, influence: -3, stability: 1 }, chronicle: "A negotiated arrangement was reached with the refugees." }
      ]
    },
    {
      id: "drowner_attack",
      title: "Drowners in the Shallows",
      text: "Fishermen report drowners rising from the river shallows at dusk.",
      options: [
        { text: "Send militia to clear them", effect: { food: 5, stability: 1 }, chronicle: "Militia cleared the drowners from the river shallows." },
        { text: "Hire the wandering witcher", effect: { coin: -25, faction: "witcher", relationship: 5, food: 8 }, chronicle: "A witcher was hired to deal with the drowners." },
        { text: "Avoid the river for now", effect: { food: -8, stability: -1 }, chronicle: "The river was avoided; fishing suffered as a result." }
      ]
    },
    {
      id: "trade_dispute",
      title: "A Dispute Over Prices",
      text: "Local merchants complain that market prices are unfair, and tempers are rising.",
      options: [
        { text: "Side with the merchants", effect: { coin: -10, stability: 2, faction: "brennas", relationship: 3 }, chronicle: "The council sided with the merchants in the price dispute." },
        { text: "Side with the townsfolk", effect: { coin: 10, stability: -2 }, chronicle: "The council sided with the townsfolk over market prices." },
        { text: "Let the market settle itself", effect: { stability: -1 }, chronicle: "The dispute was left to settle itself." }
      ]
    },
    {
      id: "noble_claim",
      title: "House Rovern Presses a Claim",
      text: "Lord Rovern's steward arrives, asserting an old claim to a strip of the settlement's fields.",
      options: [
        { text: "Contest the claim", effect: { faction: "noble", relationship: -8, reputation: 4 }, chronicle: "The settlement contested House Rovern's claim to its fields.",
          followUp: { eventId: "noble_retaliates", delayTurns: 7 } },
        { text: "Pay a token tribute", effect: { coin: -20, faction: "noble", relationship: 5 }, chronicle: "A tribute was paid to House Rovern to settle the matter.",
          followUp: { eventId: "noble_asks_more", delayTurns: 9 } },
        { text: "Concede the fields", effect: { food: -6, faction: "noble", relationship: 10 }, chronicle: "A strip of fields was conceded to House Rovern." }
      ]
    },
    {
      id: "sick_villager",
      title: "A Sickness Spreads",
      text: "Several villagers have fallen ill with a wasting fever.",
      options: [
        { text: "Consult the local witch", effect: { faction: "witch", relationship: 6, stability: 2, herbs: -6 }, chronicle: "The Hollow Witch was consulted over the sickness.",
          followUp: { eventId: "witch_calls_favor", delayTurns: 10 } },
        { text: "Rely on the physician", effect: { herbs: -10, stability: 3 }, chronicle: "The settlement's physician tended the sick." },
        { text: "Isolate the afflicted", effect: { stability: -3, population: -1 }, chronicle: "The afflicted were isolated from the rest of the settlement." }
      ]
    },
    {
      id: "bandit_demand",
      title: "The Grey Company Demands Tribute",
      text: "A rider from the Grey Company demands coin in exchange for leaving the roads unmolested.",
      options: [
        { text: "Pay the tribute", effect: { coin: -30, faction: "bandits", relationship: 10 }, chronicle: "Tribute was paid to the Grey Company.",
          followUp: { eventId: "bandits_return_demand", delayTurns: 6 } },
        { text: "Refuse and fortify", effect: { faction: "bandits", relationship: -15, stability: -1 }, chronicle: "The Grey Company's demand was refused.",
          followUp: { eventId: "bandits_retaliate", delayTurns: 4 } },
        { text: "Ask Duren's Watch for help", effect: { faction: "garrison", relationship: 5, coin: -10 }, chronicle: "Duren's Watch was asked to intervene against the Grey Company." }
      ]
    },
    {
      id: "wandering_scholar",
      title: "A Wandering Scholar",
      text: "A travelling scholar offers to share knowledge of record-keeping and old techniques, for a price.",
      options: [
        { text: "Pay for their teaching", effect: { coin: -15, knowledge: 15 }, chronicle: "A wandering scholar shared their knowledge with the settlement." },
        { text: "Turn them away", effect: {}, chronicle: "A wandering scholar was turned away." }
      ]
    },
    {
      id: "good_harvest",
      title: "An Unexpectedly Good Harvest",
      text: "The fields have yielded more than expected this season.",
      options: [
        { text: "Store the surplus", effect: { food: 25, stability: 1 }, chronicle: "A surplus harvest was stored against leaner times." },
        { text: "Sell the surplus", effect: { food: 10, coin: 20 }, chronicle: "A surplus harvest was sold at market." }
      ]
    },
    {
      id: "well_runs_foul",
      title: "The Well Runs Foul",
      text: "The settlement's well has turned brackish, and residents grow uneasy.",
      options: [
        { text: "Dig a new well", effect: { stone: -10, wood: -6, stability: 2 }, chronicle: "A new well was dug to replace the foul one." },
        { text: "Ration what remains", effect: { stability: -3 }, chronicle: "Foul water was rationed until the well recovered." }
      ]
    },
    {
      id: "dwarven_offer",
      title: "Grimstone Kin Offer Apprenticeship",
      text: "The dwarves of Grimstone Kin offer to take on apprentices to teach masonry.",
      options: [
        { text: "Send apprentices", effect: { faction: "dwarves", relationship: 8, knowledge: 10 }, chronicle: "Apprentices were sent to learn masonry from the Grimstone Kin.",
          followUp: { eventId: "apprentices_return", delayTurns: 8 } },
        { text: "Decline politely", effect: {}, chronicle: "The Grimstone Kin's offer of apprenticeship was declined." }
      ]
    },
    {
      id: "noonwraith_sighting",
      title: "A Noonwraith in the Fields",
      text: "Farmers refuse to work at midday, swearing they have seen a pale figure among the wheat.",
      options: [
        { text: "Hire the witcher to investigate", effect: { coin: -30, faction: "witcher", relationship: 6 }, chronicle: "A witcher was hired to deal with the noonwraith." },
        { text: "Consult the soothsayer", effect: { influence: -3, stability: 2 }, chronicle: "A soothsayer was consulted regarding the noonwraith." },
        { text: "Ignore it and press on", effect: { food: -8, stability: -2 }, chronicle: "The noonwraith sighting was ignored, and the harvest suffered." }
      ]
    },
    {
      id: "orphaned_children",
      title: "Orphaned Children",
      text: "A handful of children have been left without family after a hard winter.",
      options: [
        { text: "Take them in", effect: { population: 3, stability: 2, food: -6 }, chronicle: "Orphaned children were taken in by the settlement." },
        { text: "Send them to the chapel", effect: { faction: "chapel", relationship: 6 }, chronicle: "Orphaned children were sent to the Sisters of the Flame." }
      ]
    },
    {
      id: "old_shrine_found",
      title: "An Old Shrine Uncovered",
      text: "Labourers clearing rubble uncover the remains of a shrine, older than the settlement itself.",
      options: [
        { text: "Restore it", effect: { stone: -12, wood: -8, stability: 2, influence: 2 }, chronicle: "An ancient shrine was restored among the ruins." },
        { text: "Leave it undisturbed", effect: {}, chronicle: "An ancient shrine was left undisturbed." },
        { text: "Strip it for materials", effect: { stone: 15, reputation: -3 }, chronicle: "An ancient shrine was stripped for its materials." }
      ]
    },
    {
      id: "caravan_passing",
      title: "A Caravan Passes Through",
      text: "The Ashford Company's caravan passes near the settlement, offering trade before moving on.",
      options: [
        { text: "Trade generously", effect: { coin: -10, faction: "caravan", relationship: 6, tools: 4 }, chronicle: "The settlement traded generously with a passing caravan." },
        { text: "Trade cautiously", effect: { coin: 10 }, chronicle: "The settlement traded cautiously with a passing caravan." }
      ]
    },
    {
      id: "garrison_recruitment",
      title: "Duren's Watch Seeks Recruits",
      text: "Captain Duren asks whether any villagers wish to join the garrison for a season's training.",
      options: [
        { text: "Send volunteers", effect: { faction: "garrison", relationship: 8, population: -2 }, chronicle: "Volunteers were sent to train with Duren's Watch." },
        { text: "Keep everyone home", effect: { faction: "garrison", relationship: -3 }, chronicle: "The settlement declined to send recruits to Duren's Watch." }
      ]
    },
    {
      id: "harsh_winter_warning",
      title: "Signs of a Harsh Winter",
      text: "The soothsayer and the old hunters agree: this winter will be a hard one.",
      options: [
        { text: "Stockpile early", effect: { wood: -10, coin: -10, food: 20 }, chronicle: "Supplies were stockpiled ahead of a hard winter." },
        { text: "Trust to fortune", effect: {}, chronicle: "The warnings of a hard winter went unheeded." }
      ]
    },
    {
      id: "guild_dispute",
      title: "Artisans Demand a Guild",
      text: "The settlement's artisans petition for formal guild privileges.",
      options: [
        { text: "Grant a guild charter", effect: { stability: 3, coin: -10 }, chronicle: "A guild charter was granted to the settlement's artisans." },
        { text: "Deny the petition", effect: { stability: -3 }, chronicle: "The artisans' petition for a guild was denied." }
      ]
    },
    {
      id: "witch_bargain",
      title: "The Hollow Witch Makes an Offer",
      text: "Zuzka offers a remedy for the settlement's ailing herd, for a price only she would ask.",
      options: [
        { text: "Accept the bargain", effect: { faction: "witch", relationship: 10, stability: -2, food: 10 }, chronicle: "A bargain was struck with the Hollow Witch.",
          followUp: { eventId: "witch_price_due", delayTurns: 12 } },
        { text: "Refuse", effect: { food: -8 }, chronicle: "The Hollow Witch's bargain was refused." }
      ]
    },
    {
      id: "mysterious_lights",
      title: "Lights in the Forest",
      text: "Villagers report strange lights deep in the forest at night.",
      options: [
        { text: "Investigate", effect: { influence: 2, herbs: 6 }, chronicle: "Strange lights in the forest were investigated." },
        { text: "Leave it be", effect: { stability: 1 }, chronicle: "Strange lights in the forest were left uninvestigated." }
      ]
    },
    {
      id: "road_toll",
      title: "Brenna's Crossing Proposes a Toll",
      text: "Reeve Voss suggests a shared toll on the river crossing, split between both settlements.",
      options: [
        { text: "Agree to the toll", effect: { coin: 15, faction: "brennas", relationship: 6 }, chronicle: "A shared toll was agreed with Brenna's Crossing." },
        { text: "Decline", effect: { faction: "brennas", relationship: -3 }, chronicle: "Brenna's Crossing's proposed toll was declined." }
      ]
    },
    {
      id: "ghoul_grounds",
      title: "Ghouls at the Old Battlefield",
      text: "Scouts report ghouls gathering at the old battlefield to the east.",
      options: [
        { text: "Burn the grounds", effect: { wood: -10, stability: 2 }, chronicle: "The old battlefield was burned to drive off the ghouls." },
        { text: "Hire the witcher", effect: { coin: -25, faction: "witcher", relationship: 5 }, chronicle: "A witcher was hired to deal with the ghouls at the battlefield." },
        { text: "Avoid the area", effect: { reputation: -2 }, chronicle: "The old battlefield was left to the ghouls." }
      ]
    },

    // -------------------------------------------------------------
    // CHAIN FOLLOW-UPS (Phase 2) — never drawn by the normal random roll
    // (see `chainOnly: true`); only reached via another event's `followUp`.
    // -------------------------------------------------------------
    {
      id: "refugees_settled_in", chainOnly: true,
      title: "The Refugees Have Settled In",
      text: "The elven refugees taken in months ago have found their footing, and their skills are proving useful.",
      options: [
        { text: "Celebrate their contribution", effect: { stability: 3, reputation: 4 }, chronicle: "The settlement celebrated the contribution of its newest residents." },
        { text: "Let it pass unremarked", effect: { stability: 1 }, chronicle: "The refugees' quiet contribution went unremarked, but was not unnoticed." }
      ]
    },
    {
      id: "refugees_return_bitter", chainOnly: true,
      title: "Turned Away, Now Trouble",
      text: "Word reaches the settlement that some of the refugees turned away at the gate have fallen in with rough company on the roads.",
      options: [
        { text: "Send aid to make amends", effect: { coin: -15, reputation: 5 }, chronicle: "Aid was sent in an attempt to make amends with the refugees once turned away." },
        { text: "Fortify against them", effect: { stability: -1, stone: -8 }, chronicle: "The settlement fortified itself against the refugees it once turned away." },
        { text: "Ignore the matter", effect: { stability: -2 }, chronicle: "The fate of the refugees once turned away was ignored." }
      ]
    },
    {
      id: "noble_retaliates", chainOnly: true,
      title: "House Rovern's Harsher Demand",
      text: "Having been rebuffed once, Lord Rovern's steward returns with a far harsher levy, backed by an armed escort.",
      options: [
        { text: "Pay the harsher demand", effect: { coin: -35, faction: "noble", relationship: 6 }, chronicle: "A harsher demand from House Rovern was paid in full." },
        { text: "Stand firm again", effect: { faction: "noble", relationship: -15, reputation: 6 },
          chronicle: "The settlement stood firm against House Rovern a second time.",
          followUp: { eventId: "noble_final_ultimatum", delayTurns: 6 } }
      ]
    },
    {
      id: "noble_final_ultimatum", chainOnly: true,
      title: "House Rovern's Ultimatum",
      text: "Lord Rovern's patience has run out. His steward delivers a final ultimatum: submit the disputed fields, or face open conflict.",
      options: [
        { text: "Submit fully", effect: { food: -12, faction: "noble", relationship: 20, reputation: -6 }, chronicle: "The settlement submitted fully to House Rovern's ultimatum." },
        { text: "Reject and prepare for conflict", effect: { faction: "noble", relationship: -25, reputation: 10, stability: -4 }, chronicle: "House Rovern's ultimatum was rejected outright. War is no longer unthinkable." }
      ]
    },
    {
      id: "noble_asks_more", chainOnly: true,
      title: "House Rovern Grows Bold",
      text: "Emboldened by the tribute already paid, Lord Rovern's steward returns asking for a great deal more.",
      options: [
        { text: "Pay again", effect: { coin: -30, faction: "noble", relationship: 8 }, chronicle: "House Rovern was paid a second, larger tribute." },
        { text: "Refuse this time", effect: { faction: "noble", relationship: -10, reputation: 5 }, chronicle: "House Rovern's second demand for tribute was refused." }
      ]
    },
    {
      id: "witch_calls_favor", chainOnly: true,
      title: "The Hollow Witch Calls In a Favour",
      text: "Zuzka appears at the edge of the settlement. The remedy she gave months ago, she says, was never free.",
      options: [
        { text: "Honour the favour", effect: { herbs: -8, faction: "witch", relationship: 10 }, chronicle: "A favour owed to the Hollow Witch was honoured." },
        { text: "Refuse the favour", effect: { faction: "witch", relationship: -15, stability: -2 }, chronicle: "A favour owed to the Hollow Witch was refused. She did not take it well." }
      ]
    },
    {
      id: "bandits_return_demand", chainOnly: true,
      title: "The Grey Company Returns",
      text: "The Grey Company is back, and word among them is that this settlement pays without a fight.",
      options: [
        { text: "Pay again", effect: { coin: -40, faction: "bandits", relationship: 8 }, chronicle: "The Grey Company was paid a second tribute." },
        { text: "Refuse this time", effect: { faction: "bandits", relationship: -20, reputation: 6 }, chronicle: "The Grey Company's second demand was refused outright." }
      ]
    },
    {
      id: "bandits_retaliate", chainOnly: true,
      title: "The Grey Company Strikes Back",
      text: "In answer to your refusal, the Grey Company raids an outlying storehouse before militia can respond.",
      options: [
        { text: "Rally the militia in pursuit", combatCheck: {
            attackerStrength: 24, strengthMult: 2, defenseMult: 0.3, loseCasualtyChance: 0.25,
            winEffect: { coin: 10, reputation: 6 }, winChronicle: "Militia pursued the Grey Company and recovered much of what was taken.",
            loseEffect: { coin: -10, food: -15, stability: -1 }, loseChronicle: "Militia pursued the Grey Company after their raid, at some cost." } },
        { text: "Absorb the loss and fortify", effect: { food: -20, stone: -10 }, chronicle: "The settlement absorbed the Grey Company's raid and moved to fortify." }
      ]
    },
    {
      id: "apprentices_return", chainOnly: true,
      title: "The Apprentices Return",
      text: "The apprentices sent to the Grimstone Kin return, having learned a good deal of dwarven stonecraft.",
      options: [
        { text: "Put their new skills to work", effect: { knowledge: 12, tools: 8 }, chronicle: "Apprentices returned from the Grimstone Kin and put their new skills to work." },
        { text: "Send them back for further study", effect: { faction: "dwarves", relationship: 6, coin: -15 }, chronicle: "The apprentices were sent back to the Grimstone Kin for further study." }
      ]
    },
    {
      id: "witch_price_due", chainOnly: true,
      title: "The Witch's Price Comes Due",
      text: "Zuzka returns. The bargain struck long ago carried a price, and she has come to collect it.",
      options: [
        { text: "Pay the price demanded", effect: { stability: -6, coin: -25, faction: "witch", relationship: 12 }, chronicle: "The Hollow Witch's price was paid in full, whatever it cost." },
        { text: "Refuse to pay", effect: { faction: "witch", relationship: -30, stability: -8 }, chronicle: "The Hollow Witch's price was refused. Ill fortune is said to follow such refusals." }
      ]
    },

    // -------------------------------------------------------------
    // DEFENSE SCENARIOS — options with `combatCheck` resolve against the settlement's
    // actual military strength and fortifications (see `resolveEventCombat` in
    // engine.js) rather than a fixed effect, so a militia and guardhouses built up
    // over the game genuinely change these outcomes instead of sitting idle.
    // -------------------------------------------------------------
    {
      id: "raiders_on_road",
      title: "Raiders on the Road",
      text: "Scouts report a band of raiders moving along the road toward the settlement's outer fields.",
      options: [
        { text: "Muster the militia to intercept", combatCheck: {
            attackerStrength: 25, strengthMult: 2.2, defenseMult: 0.3,
            winEffect: { reputation: 5, coin: 12 }, winChronicle: "Militia intercepted raiders on the road and drove them off.",
            loseEffect: { stability: -4, food: -10 }, loseChronicle: "Militia sent to intercept raiders were beaten back." } },
        { text: "Hold the walls and let them pass", combatCheck: {
            attackerStrength: 20, strengthMult: 0.4, defenseMult: 2,
            winEffect: { stability: 2 }, winChronicle: "The settlement held behind its walls as raiders passed without incident.",
            loseEffect: { coin: -15, food: -8 }, loseChronicle: "Raiders tested the walls and made off with what they could reach." } },
        { text: "Pay them to move along", effect: { coin: -20 }, chronicle: "Raiders on the road were paid to move along without incident." }
      ]
    },
    {
      id: "monster_pack_sighted",
      title: "A Pack Sighted Near the Fields",
      text: "Farmers report a pack of nekkers denning close to the outer fields, growing bolder by the week.",
      options: [
        { text: "Send soldiers to clear the den", combatCheck: {
            attackerStrength: 22, strengthMult: 2, defenseMult: 0.2, loseCasualtyChance: 0.4,
            winEffect: { food: 10, reputation: 3 }, winChronicle: "Soldiers cleared the nekker den near the fields.",
            loseEffect: { food: -15, stability: -3 }, loseChronicle: "An attempt to clear the nekker den was driven back with losses." } },
        { text: "Fortify the field edge and wait them out", combatCheck: {
            attackerStrength: 18, strengthMult: 0.3, defenseMult: 1.8,
            winEffect: { stability: 1 }, winChronicle: "The fields were fortified, and the nekker pack moved on of its own accord.",
            loseEffect: { food: -12 }, loseChronicle: "The nekker pack pressed in despite the field fortifications." } },
        { text: "Avoid the fields for now", effect: { food: -10 }, chronicle: "The outer fields were avoided while the nekker pack denned nearby." }
      ]
    },
    {
      id: "rival_warband",
      title: "A Rival Warband Approaches",
      text: "A sizeable armed band, banners unfamiliar, is spotted making directly for the settlement.",
      options: [
        { text: "Meet them in open battle", combatCheck: {
            attackerStrength: 55, strengthMult: 2.5, defenseMult: 0.2, winCasualtyChance: 0.15, loseCasualtyChance: 0.5,
            winEffect: { reputation: 12, influence: 4 }, winChronicle: "The settlement's militia met a rival warband in open battle and won decisively.",
            loseEffect: { stability: -10, coin: -30 }, loseChronicle: "The settlement's militia was routed in open battle against a rival warband.",
            loseFollowUp: { eventId: "warband_returns", delayTurns: 10 } } },
        { text: "Retreat behind the walls", combatCheck: {
            attackerStrength: 45, strengthMult: 0.4, defenseMult: 2.2, loseCasualtyChance: 0.3,
            winEffect: { stability: 3 }, winChronicle: "The settlement held behind its walls against a rival warband until it withdrew.",
            loseEffect: { stability: -8, food: -25 }, loseChronicle: "The walls were breached by a rival warband before it withdrew.",
            loseFollowUp: { eventId: "warband_returns", delayTurns: 10 } } },
        { text: "Attempt to parley", effect: { coin: -25, influence: -3 }, chronicle: "A costly parley turned the rival warband aside without battle." }
      ]
    },
    {
      id: "warband_returns", chainOnly: true,
      title: "The Warband Returns",
      text: "Word comes that the warband turned back before has regrouped, emboldened, and is marching on the settlement again.",
      options: [
        { text: "Make a stand", combatCheck: {
            attackerStrength: 60, strengthMult: 2.3, defenseMult: 0.6, winCasualtyChance: 0.1, loseCasualtyChance: 0.5,
            winEffect: { reputation: 15, stability: 4 }, winChronicle: "The returning warband was met and finally broken for good.",
            loseEffect: { stability: -14, food: -30, coin: -20 }, loseChronicle: "The returning warband overran what defense could be mustered." } },
        { text: "Buy them off, whatever the cost", effect: { coin: -60, influence: -6 }, chronicle: "A heavy price was paid to turn the returning warband aside for good." }
      ]
    },
    {
      id: "durens_watch_aid",
      title: "Duren's Watch Calls for Aid",
      text: "Captain Duren sends word: bandits are massing near the garrison, and Duren's Watch asks for soldiers to help hold the line.",
      options: [
        { text: "Answer the call to arms", combatCheck: {
            attackerStrength: 35, strengthMult: 2, defenseMult: 0.4, loseCasualtyChance: 0.4,
            winEffect: { reputation: 5 }, winChronicle: "Soldiers answered Duren's Watch's call and helped break the bandit muster.",
            loseEffect: { stability: -5 }, loseChronicle: "Soldiers sent to aid Duren's Watch suffered losses before the bandits were driven off." } },
        { text: "Decline, the soldiers cannot be spared", effect: { faction: "garrison", relationship: -8 }, chronicle: "Duren's Watch's call for aid was declined." }
      ]
    },
    {
      id: "night_alarm",
      title: "Night Alarm",
      text: "A watchman's horn sounds in the small hours — movement at the tree line, though nothing is yet certain.",
      options: [
        { text: "Rally swiftly to the walls", combatCheck: {
            attackerStrength: 15, strengthMult: 1.5, defenseMult: 1, loseCasualtyChance: 0.15,
            winEffect: { stability: 2 }, winChronicle: "A swift rally to the walls met the night's alarm without serious incident.",
            loseEffect: { stability: -3, coin: -8 }, loseChronicle: "The night alarm caught the settlement's defenders too slow to organise." } },
        { text: "Return to sleep — likely nothing", effect: { stability: -2 }, chronicle: "The night alarm went unanswered. Some slept uneasily after." }
      ]
    },
    {
      id: "defend_the_harvest",
      title: "Defend the Harvest",
      text: "The harvest sits ready in the fields, and word reaches the settlement that raiders have taken notice.",
      options: [
        { text: "Guard the harvest with soldiers", combatCheck: {
            attackerStrength: 28, strengthMult: 2, defenseMult: 0.3,
            winEffect: { food: 20 }, winChronicle: "The harvest was guarded successfully against raiders and brought in whole.",
            loseEffect: { food: -25 }, loseChronicle: "Raiders broke through the harvest guard and made off with much of it." } },
        { text: "Bring the harvest in quickly, unguarded", effect: { food: -8 }, chronicle: "The harvest was rushed in without guard, at some cost to the yield." }
      ]
    },
    {
      id: "show_of_force",
      title: "A Show of Force",
      text: "The militia captain suggests a deliberate patrol in force near the roads the Grey Company favours — a show of strength rather than a response to any specific threat.",
      options: [
        { text: "Send the militia on patrol", combatCheck: {
            attackerStrength: 20, strengthMult: 1.8, defenseMult: 0.2, loseCasualtyChance: 0.1,
            winEffect: { reputation: 4, stability: 2 }, winChronicle: "A deliberate show of force along the roads bolstered the settlement's standing.",
            loseEffect: { stability: -3, faction: "bandits", relationship: -5 }, loseChronicle: "A show of force met more resistance than expected and achieved little." } },
        { text: "Keep the militia close to home", effect: {}, chronicle: "The militia captain's proposal for a show of force was set aside for now." }
      ]
    }
  ];

  // ---------------------------------------------------------------
  // AI PERSONALITIES
  // ---------------------------------------------------------------
  const PERSONALITIES = {
    merchant:      { priorities: ["trade","wealth","stability"] },
    militarist:    { priorities: ["security","military","influence"] },
    isolationist:  { priorities: ["autonomy","security","lowDependence"] },
    humanitarian:  { priorities: ["refugees","stability","diplomacy"] },
    opportunist:   { priorities: ["shortTerm"] }
  };

  // ---------------------------------------------------------------
  // MAP ADJACENCY (Phase 2)
  // `building` and `near` are chain-root building ids or terrain strings.
  // Bonuses are additive per matching orthogonal neighbour (a farm with
  // river on two sides gets the bonus twice) — see engine.js `adjacencyBonusForTile`.
  // ---------------------------------------------------------------
  const ADJACENCY_RULES = [
    { building: "farm",       near: "river",       bonus: { yieldMult: 0.15 }, desc: "Irrigation from the river" },
    { building: "market",     near: "road",         bonus: { tradeBonus: 0.10 }, desc: "Roadside trade" },
    { building: "workshop",   near: "mine",         bonus: { yieldMult: 0.10 }, desc: "Short haul for ore" },
    { building: "house",      near: "shrine",       bonus: { stability: 0.05 }, desc: "Comfort of the faithful" },
    { building: "guardhouse", near: "keep",         bonus: { defense: 3 },      desc: "Coordinated defense with the keep" },
    { building: "market",     near: "storehouse",   bonus: { tradeBonus: 0.08 }, desc: "Goods close at hand" },
    { building: "school",     near: "storehouse",   bonus: { yieldMult: 0.05 }, desc: "Old records recovered nearby" },
    { building: "farm",       near: "well",         bonus: { yieldMult: 0.08 }, desc: "A ready water source" }
  ];

  // ---------------------------------------------------------------
  // EDICTS (Phase 2) — toggleable standing policies, distinct from one-shot
  // tech: each has an ongoing multiplier/flat effect for as long as it's active,
  // and a minimum number of turns it must stay in that state before being
  // switched again (see engine.js `toggleEdict`), so it's a real commitment.
  // ---------------------------------------------------------------
  const EDICTS = {
    open_borders:   { name: "Open Borders",      cooldown: 6, effect: { growthMult: 1.4, stabilityFlat: -0.08 },
                      desc: "Newcomers are welcomed freely, whoever they are. Faster growth, but old residents grumble." },
    conscription:   { name: "Conscription",      cooldown: 6, effect: { militaryMult: 1.3, growthMult: 0.85 },
                      desc: "Able hands are drilled for war at the cost of the fields and the cradle." },
    high_taxation:  { name: "High Taxation",     cooldown: 6, effect: { coinMult: 1.25, stabilityFlat: -0.12 },
                      desc: "The treasury swells. The people grumble, quietly for now." },
    frugal_stores:  { name: "Frugal Stores",     cooldown: 6, effect: { coinMult: 0.9, stabilityFlat: 0.1 },
                      desc: "Spending is watched closely. Slower profit, steadier nerves." },
    devout_observance: { name: "Devout Observance", cooldown: 6, effect: { stabilityFlat: 0.15, knowledgeMult: 0.9 },
                      desc: "Faith is placed above learning for now. Calmer, if a little incurious." },
    open_scholarship: { name: "Open Scholarship", cooldown: 6, effect: { knowledgeMult: 1.25, coinMult: 0.95 },
                      desc: "Coin is spent freely on books and teaching. The treasury feels it." },
    forced_labour:  { name: "Forced Labour",     cooldown: 6, effect: { farmYieldMult: 1.2, stabilityFlat: -0.2 },
                      desc: "Every hand is put to the harvest, willing or not. Yields rise, resentment rises faster." },
    militia_reserve:{ name: "Militia Reserve",   cooldown: 6, effect: { militaryMult: 1.15, coinMult: 0.95 },
                      desc: "A standing reserve is kept armed and ready, drawing on the treasury year-round." }
  };

  return {
    STAGES, RESOURCE_INFO, STARTING_RESOURCES, WORKER_TYPES, JOBS, BUILDINGS,
    TECHS, FACTIONS, FACTION_ACTIONS, MONSTERS, EXPLORATION_SITES,
    INTEREST_GROUPS, KINGDOM_EVENTS, LOCAL_EVENTS, PERSONALITIES, ADJACENCY_RULES, EDICTS,
    FACTION_RELATIONS_SEED, FACTION_INCIDENTS
  };
})();

if (typeof window !== "undefined") window.GameData = GameData;
if (typeof module !== "undefined") module.exports = GameData;
