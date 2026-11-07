/* ================================================================
   ASHES OF THE NORTH: LIVING VILLAGE VIEW
   Paints the settlement map top-down with the roofs off (walls,
   floors and furniture visible, in the spirit of colony sims), and
   fills it with residents walking their daily routine: home at night,
   out to their workplace at dawn, a midday meal at the fire, back to
   work, an evening stroll, and home again.

   Purely cosmetic. It only ever reads game state, and uses its own
   random stream, so nothing here can change an outcome.

   Performance: terrain and buildings are painted once into an
   offscreen canvas and only repainted when the map, season or zoom
   changes. Each frame only copies that image and draws the people,
   smoke, weather and lighting on top, at most 30 times a second, and
   the loop stops whenever the map isn't on screen.
   ================================================================ */

const VillageView = (function () {
  const E = (typeof GameEngine !== "undefined") ? GameEngine : null;
  const D = (typeof GameData !== "undefined") ? GameData : null;

  const DAY_SECONDS = 96;          // one in-world day of routine, in real seconds
  const MAX_PAWNS = 90;            // people drawn at most (children fill the last places)
  const FRAME_MS = 1000 / 30;
  const MAX_CANVAS_PIXELS = 7e6;   // stay well under iOS Safari's canvas memory limit

  const supported = typeof document !== "undefined" &&
    !(typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || ""));
  const reducedMotion = typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------
  // COSMETIC RANDOMNESS (own stream, never Math.random)
  // ---------------------------------------------------------------
  let seed = 0x9e3779b9;
  function rnd() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // Stable per-place noise so terrain looks the same every repaint.
  function hash(x, y, i) {
    let h = Math.imul(x * 374761393 + y * 668265263 + (i || 0) * 2147483647, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ---------------------------------------------------------------
  // PALETTE (muted naturals; light comes from the upper right)
  // ---------------------------------------------------------------
  const LOOK = {
    Spring: { grass: "#56683a", grass2: "#4b5d31", speck: "#6d8247", flower: "#d9c86a", forest: "#3f5530", canopy: "#3b5a2c", canopy2: "#4c6f37", soil: "#6a5034", crop: "#7fa34a", water: "#2e5b68", snow: 0 },
    Summer: { grass: "#58702f", grass2: "#4c6329", speck: "#6e8a3c", flower: "#e0b84f", forest: "#3d5828", canopy: "#355a24", canopy2: "#466f2e", soil: "#6d5233", crop: "#9bbd4c", water: "#2b6170", snow: 0 },
    Autumn: { grass: "#6e6635", grass2: "#605a2f", speck: "#8a7a3f", flower: "#b8642e", forest: "#4e4a2a", canopy: "#8a5a22", canopy2: "#a8762c", soil: "#6a4c2e", crop: "#c9a64a", water: "#36606a", snow: 0 },
    Winter: { grass: "#c9d1d6", grass2: "#b7c0c7", speck: "#9aa6ad", flower: null, forest: "#aeb8bf", canopy: "#2f4434", canopy2: "#3c5442", soil: "#8d8a86", crop: null, water: "#4c7684", snow: 1 }
  };
  const INK = "#1c1712";
  const WOOD = "#6e4c2c", WOOD_DARK = "#4d331d", PLANK = "#93714a", PLANK_LINE = "#7a5c3a";
  const STONE = "#8b8a84", STONE_DARK = "#5f5e59", FLAGSTONE = "#a29f96";

  const SKIN = ["#f1d0b0", "#e2b48e", "#c99670", "#a87552", "#ecc7a1"];
  const HAIR = ["#2b211a", "#4a3020", "#7a5530", "#b88a4a", "#d8c08a", "#8a8580", "#5c2a1a"];
  const SHIRT_BY_TYPE = {
    labourer: ["#7a6a4a", "#6b5a3a", "#87754f"],
    artisan: ["#8a4b2a", "#7a3f24", "#985a33"],
    merchant: ["#3f5f8a", "#35507a", "#4c6c96"],
    clerk: ["#2f6b5f", "#285c52", "#3a7a6c"],
    soldier: ["#7d2e2a", "#6c2724", "#8c3a33"],
    scholar: ["#5d4a7a", "#51406b", "#6a5788"],
    idle: ["#6b6b66", "#5e5e5a", "#77756e"],
    child: ["#9a8a6a", "#a07a5a", "#7a8a9a"]
  };
  const CARRY = { lumberjack: "log", miner: "ore", mason: "stone", farmer: "wheat", fisherman: "fish", herbalist: "herbs" };

  // ---------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------
  let canvas = null, ctx = null, staticCanvas = null, darkCanvas = null;
  let tile = 40, dpr = 1, W = 20, H = 14;
  let game = null;           // the live game state (read only)
  let world = null;          // derived map facts (workplaces, homes, lights)
  let pawns = new Map();     // citizen id -> pawn
  let particles = [];
  let weather = { kind: null, drops: [] };
  let clock = 0.3;           // 0..1 through the day; starts mid-morning
  let rafId = null, lastFrame = 0, lastTick = 0;
  let staticKey = "";
  let onClockLabel = null, lastLabel = "";
  let dayCount = 0;
  let clockFn = null;        // the game's own clock, when the UI runs real time
  let simNow = 0;            // seconds of village life (stands still while paused)
  let corpses = [];          // the fallen, where they fell
  let seenDeaths = {};       // battle id -> deaths already shown
  const ROOFED = ["house", "workshop", "brewhouse", "joinery", "guardhouse", "hall", "school"];
  function isRoofed(t) {
    if (!t || !t.building) return false;
    const r = root(t.building), tier = (D.BUILDINGS[t.building] || {}).tier || 0;
    return ROOFED.includes(r) || ((r === "keep" || r === "shrine" || r === "storehouse") && tier >= 1);
  }

  // ---------------------------------------------------------------
  // MAP FACTS
  // ---------------------------------------------------------------
  function root(id) { const b = D.BUILDINGS[id]; return b && b.chain ? b.chain[0] : id; }
  // Tiles by position. Older saves grew their map by appending tiles, so the
  // grid array isn't always in row order; index it once per refresh instead.
  let cells = [];
  function indexCells() {
    cells = new Array(W * H).fill(null);
    for (const t of game.grid) if (t.x >= 0 && t.y >= 0 && t.x < W && t.y < H) cells[t.y * W + t.x] = t;
  }
  function tileAt(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? null : cells[y * W + x]; }

  function buildWorld() {
    const g = game.grid;
    const by = {};
    const add = (k, t) => { (by[k] = by[k] || []).push(t); };
    for (const t of g) {
      if (t.constructing) add("constructing", t);
      if (!t.building) {
        if (t.terrain === "forest") add("forest", t);
        if (t.terrain === "hills") add("hills", t);
        if (t.terrain === "field") add("field", t);
        continue;
      }
      add(root(t.building), t);
      add("built", t);
    }
    const keep = (by.keep || [])[0] || { x: 9, y: 6 };
    const commons = { x: keep.x + 1.0, y: keep.y + 1.5 };   // the fire on the road below the old keep
    const near = (list) => (list || []).slice().sort((a, b) => dist2(a, commons) - dist2(b, commons));
    by.forest = near(by.forest);
    by.hills = near(by.hills);
    by.field = near(by.field);

    // Homes: each house holds as many as it houses; everyone else sleeps in tents
    // pitched on open ground round the fire (the camp the settlement began as).
    const homes = [];
    for (const t of near(by.house)) {
      const n = (D.BUILDINGS[t.building].effect || {}).housing || 4;
      for (let i = 0; i < n; i++) homes.push({ x: t.x + 0.42 + (i % 3) * 0.08, y: t.y + 0.78, tile: t });
    }
    const pop = E.population(game);
    const unhoused = Math.max(0, pop - homes.length);
    const tents = [];
    const tentTiles = by.field.filter(t => !t.constructing && Math.abs(t.y - commons.y) <= 4).slice(0, 14);
    const tentCount = Math.min(tentTiles.length * 2, Math.ceil(unhoused / 3));
    for (let i = 0; i < tentCount; i++) {
      const t = tentTiles[Math.floor(i / 2)];
      const right = i % 2;
      tents.push({ x: t.x + 0.12 + right * 0.46, y: t.y + 0.18 + (right ? 0.32 : 0), tile: t, hue: hash(t.x, t.y, i) });
    }
    for (let i = 0; i < unhoused; i++) {
      const tent = tents[i % Math.max(1, tents.length)];
      homes.push(tent ? { x: tent.x + 0.2, y: tent.y + 0.22, tent: true } : { x: commons.x + (hash(i, 3) - 0.5) * 2, y: commons.y + 1 + hash(i, 4), tent: true });
    }

    // Night lights: windows, forges, candles, torches.
    const lights = [];
    const occupied = new Set(homes.slice(0, pop).filter(h => h.tile).map(h => h.tile));
    for (const t of g) {
      const r = t.building && root(t.building);
      if (!r) continue;
      const cx = t.x + 0.5, cy = t.y + 0.5;
      if (r === "house" && occupied.has(t)) lights.push({ x: cx, y: cy, r: 0.9, c: "255,190,110" });
      else if (r === "workshop") lights.push({ x: t.x + 0.7, y: t.y + 0.3, r: 1.0, c: "255,140,60" });
      else if (r === "brewhouse" || r === "joinery") lights.push({ x: cx, y: cy, r: 0.8, c: "255,180,100" });
      else if (r === "wayshrine") lights.push({ x: cx, y: t.y + 0.6, r: 0.6, c: "255,215,150" });
      else if (r === "shrine" && t.building !== "shrine") lights.push({ x: cx, y: t.y + 0.25, r: 1.0, c: "255,215,150" });
      else if (r === "guardhouse" || (r === "keep" && t.building !== "keep")) { lights.push({ x: t.x + 0.1, y: t.y + 0.9, r: 0.8, c: "255,160,80" }); lights.push({ x: t.x + 0.9, y: t.y + 0.9, r: 0.8, c: "255,160,80" }); }
      else if (r === "market" || r === "hall" || r === "school") lights.push({ x: cx, y: cy, r: 0.9, c: "255,200,130" });
      else if (r === "walls") lights.push({ x: t.x + 0.5, y: t.y + 0.05, r: 0.7, c: "255,160,80" });
    }
    lights.push({ x: commons.x, y: commons.y, r: 2.2, c: "255,150,70", fire: true });

    // Night watch: a loop just outside everything built.
    const built = (by.built || []).concat(by.constructing || []);
    let x0 = commons.x - 2, x1 = commons.x + 2, y0 = commons.y - 2, y1 = commons.y + 2;
    for (const t of built) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x + 1); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y + 1); }
    x0 = Math.max(3.4, x0 - 0.6); y0 = Math.max(0.4, y0 - 0.6); x1 = Math.min(W - 0.4, x1 + 0.6); y1 = Math.min(H - 0.4, y1 + 0.6);
    const patrol = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

    return { by, commons, homes, tents, lights, patrol, season: E.getSeason(game.meta.month) };
  }
  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  // ---------------------------------------------------------------
  // PATHS (A* over tiles: roads quick, woods slow, the river only by a dock)
  // ---------------------------------------------------------------
  let pathCache = new Map();
  function stepCost(t) {
    if (!t) return Infinity;
    if (t.terrain === "river") return (t.building === "dock") ? 1.2 : Infinity;
    if (t.terrain === "road") return 0.55;
    if (t.terrain === "forest" && !t.building) return 1.6;
    if (t.terrain === "hills" && !t.building) return 1.4;
    return 1;
  }
  function findPath(sx, sy, tx, ty) {
    sx = Math.max(0, Math.min(W - 1, sx)); sy = Math.max(0, Math.min(H - 1, sy));
    tx = Math.max(0, Math.min(W - 1, tx)); ty = Math.max(0, Math.min(H - 1, ty));
    const key = sx + "," + sy + ">" + tx + "," + ty;
    if (pathCache.has(key)) return pathCache.get(key);
    const N = W * H, cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const open = [[0, sx + sy * W]];
    cost[sx + sy * W] = 0;
    const goal = tx + ty * W;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === goal) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = nx + ny * W;
        let c = stepCost(cells[ni]);
        // the start and goal tiles are always enterable (a pawn may stand by the water)
        if (c === Infinity && (ni === goal || cur === sx + sy * W)) c = 2;
        if (c === Infinity) continue;
        if (dx && dy) {
          if (stepCost(cells[cx + ny * W]) === Infinity || stepCost(cells[nx + cy * W]) === Infinity) continue;
          c *= 1.414;
        }
        const nc = cost[cur] + c;
        if (nc < cost[ni]) {
          cost[ni] = nc; prev[ni] = cur;
          open.push([nc + Math.hypot(tx - nx, ty - ny) * 0.55, ni]);
        }
      }
    }
    const out = [];
    if (prev[goal] !== -1 || goal === sx + sy * W) {
      for (let c = goal; c !== -1 && c !== sx + sy * W; c = prev[c]) out.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
      out.reverse();
    }
    if (pathCache.size > 600) pathCache.clear();
    pathCache.set(key, out);
    return out;
  }

  // ---------------------------------------------------------------
  // PEOPLE
  // ---------------------------------------------------------------
  function jobType(c) {
    if (c.age < 12) return "child";
    if (!c.job) return "idle";
    return (D.JOBS[c.job] && D.JOBS[c.job].type) || "idle";
  }
  function makePawn(c, home) {
    const s = hashStr(c.id);
    const type = jobType(c);
    const shirts = SHIRT_BY_TYPE[type];
    return {
      id: c.id, name: c.name, seed: s, job: c.job, type, child: c.age < 12,
      x: home.x + (hash(s * 1e6, 1) - 0.5) * 0.3, y: home.y + (hash(s * 1e6, 2) - 0.5) * 0.3,
      path: [], dest: null, act: null, spot: null, nextShuffle: 0, carry: null, facing: 1,
      offset: (hash(s * 1e6, 3) - 0.5) * 0.06, speed: 1.05 + hash(s * 1e6, 4) * 0.35,
      skin: SKIN[Math.floor(s * 997) % SKIN.length], hair: HAIR[Math.floor(s * 7919) % HAIR.length],
      shirt: shirts[Math.floor(s * 31) % shirts.length], sex: c.sex, visible: true, anim: hash(s * 1e6, 5) * 10,
      watch: type === "soldier" && hash(s * 1e6, 6) < 0.5
    };
  }

  function syncPawns() {
    const living = E.livingCitizens(game);
    const adults = living.filter(c => c.age >= 12), kids = living.filter(c => c.age < 12);
    const shown = adults.slice(0, MAX_PAWNS).concat(kids.slice(0, Math.max(0, Math.min(20, MAX_PAWNS - adults.length))));
    const keepIds = new Set();
    shown.forEach((c, i) => {
      const home = world.homes[living.indexOf(c)] || world.homes[i % Math.max(1, world.homes.length)] || world.commons;
      let p = pawns.get(c.id);
      if (!p) { p = makePawn(c, home); pawns.set(c.id, p); }
      if (p.job !== c.job || p.child !== (c.age < 12)) {
        const fresh = makePawn(c, home);
        Object.assign(p, { job: fresh.job, type: fresh.type, shirt: fresh.shirt, child: fresh.child, watch: fresh.watch, act: null, spot: null });
      }
      p.home = home;
      p.name = c.name;
      keepIds.add(c.id);
    });
    for (const id of Array.from(pawns.keys())) if (!keepIds.has(id)) pawns.delete(id);
    // the map may have changed under anyone mid-route: re-plan from where they stand
    for (const p of pawns.values()) { p.act = null; p.path = []; }
  }

  function pick(list, p, salt) {
    if (!list || !list.length) return null;
    return list[Math.floor(hash(p.seed * 1e6, salt || 7) * list.length) % list.length];
  }
  // where to stand at a building: in front of a roofed one (or just inside its door)
  function yardSpot(t) { return { x: t.x + 0.2 + rnd() * 0.6, y: t.y + 0.72 + rnd() * 0.2 }; }
  const INDOOR_JOBS = ["administrator", "scribe", "tax_collector", "teacher", "physician", "alchemist", "brewer", "tanner"];
  function within(t, pad) {
    pad = pad === undefined ? 0.22 : pad;
    return { x: t.x + pad + rnd() * (1 - pad * 2), y: t.y + pad + rnd() * (1 - pad * 2) };
  }

  // Where this person works right now, and how they stand there.
  function workSpot(p) {
    const by = world.by, j = p.job;
    const nearest = (list, n) => list && list.length ? list[Math.floor(rnd() * Math.min(n, list.length))] : null;
    let t = null, pose = "stand";
    const building = j && D.JOBS[j] && D.JOBS[j].requiresBuilding;
    if (j === "farmer") { t = pick(by.farm, p); pose = "crouch"; }
    else if (j === "fisherman") { t = pick(by.dock, p); pose = "fish"; if (t) return { x: t.x + 0.22 + rnd() * 0.15, y: t.y + 0.35 + rnd() * 0.35, pose }; }
    else if (j === "lumberjack") { t = nearest(by.forest, 6); pose = "chop"; }
    else if (j === "miner") { t = pick(by.mine, p) || nearest(by.hills, 3); pose = "chop"; }
    else if (j === "builder" || j === "mason" || j === "carpenter") {
      t = pick(by.constructing, p, 11);
      pose = "hammer";
      if (!t) {
        if (j === "mason") t = nearest(by.hills, 4);
        else if (j === "carpenter") t = pick(by.joinery, p) || pick(by.workshop, p);
        else { t = nearest(by.forest, 4); pose = "carry"; }
      }
    }
    else if (j === "blacksmith") { t = pick(by.workshop, p); pose = "hammer"; }
    else if (j === "brewer") { t = pick(by.brewhouse, p) || pick(by.workshop, p); pose = "stand"; }
    else if (j === "scout") { const e = world.patrol[Math.floor(rnd() * 4)]; return { x: e.x + (rnd() - 0.5) * 3, y: e.y + (rnd() - 0.5) * 2, pose: "walk", roam: true }; }
    else if (j === "herbalist") { t = nearest(by.forest, 10); pose = "crouch"; }
    else if (building) {
      const r = root(building);
      t = pick(by[r], p) || (r === "guardhouse" ? pick(by.keep, p) : null);
      pose = p.type === "soldier" ? "guard" : (p.type === "clerk" || p.type === "scholar") ? "sit" : "stand";
    }
    if (!t) { const a = rnd() * Math.PI * 2, r = 0.6 + rnd() * 1.1; return { x: world.commons.x + Math.cos(a) * r * 1.3, y: world.commons.y + Math.sin(a) * r, pose: "sit" }; }
    const s = isRoofed(t) ? yardSpot(t) : within(t);
    if (isRoofed(t) && INDOOR_JOBS.includes(j)) { s.x = t.x + 0.5; s.y = t.y + 0.78; s.inside = true; }
    s.pose = pose; s.tile = t;
    return s;
  }

  // What everyone should be doing at this time of day.
  function battleOn() { return !!(game && game.battle && !game.battle.outcome); }
  function wantedActivity(p, phase) {
    if (battleOn()) {
      if (game.battle.defenders.some(d => d.id === p.id)) return "battle";
      return "home";   // everyone else runs for shelter
    }
    if (p.child) {
      if (phase < 0.24 || phase > 0.84) return "home";
      return "play";
    }
    if (phase < 0.22 || phase >= 0.9) return (p.watch && pawns.size > 3) ? "watch" : "home";
    if (phase < 0.55) return "work";
    if (phase < 0.62) return "meal";
    if (phase < 0.8) return "work";
    return "leisure";
  }

  function destFor(p, act) {
    const c = world.commons;
    if (act === "home") return { x: p.home.x, y: p.home.y, pose: "sleep" };
    if (act === "battle") return { x: p.x, y: p.y, pose: "battle" };
    if (act === "work") return workSpot(p);
    if (act === "meal") { const a = rnd() * Math.PI * 2, r = 0.55 + rnd() * 0.5; return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.7, pose: "sit" }; }
    if (act === "watch") { const i = Math.floor(rnd() * 4); const q = world.patrol[i]; return { x: q.x, y: q.y, pose: "walk", watch: i }; }
    if (act === "play") {
      const around = rnd() < 0.5 ? c : p.home;
      return { x: around.x + (rnd() - 0.5) * 2.2, y: around.y + (rnd() - 0.5) * 1.6, pose: "walk" };
    }
    // leisure: pray at the chapel, browse the market, draw water, or sit by the fire
    const by = world.by, roll = rnd();
    const chapel = (by.shrine || []).find(t => t.building !== "shrine") || pick(by.wayshrine, p, 17);
    let t = null;
    if (roll < 0.25 && chapel) t = chapel;
    else if (roll < 0.5 && by.market) t = pick(by.market, p, 13);
    else if (roll < 0.65 && by.well) t = by.well[0];
    if (t) {
      if (isRoofed(t)) return { x: t.x + 0.5, y: t.y + 0.8, pose: "stand", inside: true };   // in to pray
      const s = within(t, 0.25); s.pose = "stand"; return s;
    }
    return { x: c.x + (rnd() - 0.5) * 1.8, y: c.y + (rnd() - 0.5) * 1.2, pose: "sit" };
  }

  function clampDest(d) {
    d.x = Math.max(0.1, Math.min(W - 0.1, d.x));
    d.y = Math.max(0.1, Math.min(H - 0.1, d.y));
    return d;
  }

  function goTo(p, d) {
    clampDest(d);
    const sx = Math.floor(p.x), sy = Math.floor(p.y), tx = Math.floor(d.x), ty = Math.floor(d.y);
    const jitter = (p.seed - 0.5) * 0.28;
    p.path = findPath(sx, sy, tx, ty).slice(0, -1).map(q => ({ x: q.x + jitter, y: q.y + jitter * 0.7 }));
    p.path.push({ x: d.x, y: d.y });
    p.dest = d;
  }

  function updatePawn(p, dt, now) {
    const phase = (clock + p.offset + 1) % 1;
    const want = wantedActivity(p, phase);
    if (want !== p.act) {
      // leaving work with something to show for it
      if (p.act === "work" && CARRY[p.job]) p.carry = CARRY[p.job];
      if (want === "work") p.carry = null;
      p.act = want;
      p.visible = want !== "battle";
      if (want === "battle") { p.path = []; p.dest = { pose: "battle" }; return; }
      // running from danger
      p.hurry = battleOn() ? 1.8 : 1;
      goTo(p, destFor(p, want));
      p.nextShuffle = now + 6 + rnd() * 10;
    }
    if (p.path.length) {
      const q = p.path[0];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      const t = tileAt(Math.floor(p.x), Math.floor(p.y));
      const slow = t && t.terrain === "forest" && !t.building ? 0.75 : (t && t.terrain === "road" ? 1.2 : 1);
      const step = p.speed * slow * dt * (p.child ? 1.15 : 1) * (p.act === "play" ? 0.9 : 1) * (p.hurry || 1);
      if (Math.abs(dx) > 0.01) p.facing = dx > 0 ? 1 : -1;
      if (d <= step) { p.x = q.x; p.y = q.y; p.path.shift(); }
      else { p.x += dx / d * step; p.y += dy / d * step; }
      p.moving = true;
      return;
    }
    p.moving = false;
    const pose = p.dest ? p.dest.pose : "stand";
    if (pose === "battle") { p.visible = false; return; }
    if (pose === "sleep" || (p.dest && p.dest.inside)) { p.visible = false; if (pose === "sleep") p.carry = null; p.hurry = 1;
      if (p.dest && p.dest.inside && now > p.nextShuffle && p.act !== "home") { p.nextShuffle = now + 10 + rnd() * 15; }
      return; }
    // drop the load at the fire or at home
    if (p.carry && (p.act === "meal" || p.act === "leisure")) p.carry = null;
    // move on now and then: the next row of crops, another tree, the next corner of the watch
    if (now > p.nextShuffle && (p.act === "work" || p.act === "play" || p.act === "watch" || (p.act === "leisure" && rnd() < 0.3))) {
      p.nextShuffle = now + (p.act === "watch" ? 0 : 5 + rnd() * 12);
      if (p.act === "watch") {
        const i = ((p.dest.watch || 0) + 1) % 4;
        const q = world.patrol[i];
        goTo(p, { x: q.x, y: q.y, pose: "walk", watch: i });
      } else {
        goTo(p, destFor(p, p.act));
      }
    }
  }

  // ---------------------------------------------------------------
  // STATIC LAYER: TERRAIN AND BUILDINGS
  // ---------------------------------------------------------------
  function paintStatic() {
    const sc = staticCanvas, g = sc.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, sc.width, sc.height);
    g.setTransform(tile * dpr, 0, 0, tile * dpr, 0, 0);
    const look = LOOK[world.season];
    for (const t of game.grid) drawGround(g, t, look);
    for (const t of game.grid) drawRiverBank(g, t, look);
    for (const t of game.grid) if (t.terrain === "road") drawRoadEdges(g, t, look);
    for (const tent of world.tents) drawTent(g, tent, look);
    for (const t of game.grid) {
      if (t.building) drawBuilding(g, t, t.building, look);
      if (t.constructing) drawConstruction(g, t, look);
    }
    for (const t of game.grid) if (t.terrain === "hills" && !t.building && !t.constructing) drawBoulders(g, t, look);
    // trees last, south to north, so canopies overlap naturally
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tileAt(x, y);
      if (t && t.terrain === "forest" && !t.building && !t.constructing) drawTrees(g, t, look);
    }
    drawCampfireRing(g, look);
  }

  function drawGround(g, t, look) {
    const { x, y } = t;
    if (t.terrain === "river") {
      g.fillStyle = look.water; g.fillRect(x, y, 1, 1);
      g.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 3; i++) g.fillRect(x + hash(x, y, i) * 0.7, y + hash(x, y, i + 9) * 0.9, 0.25, 0.025);
      if (look.snow && x === 0) { g.fillStyle = "rgba(225,235,240,0.55)"; g.fillRect(x, y, 0.5, 1); }
      return;
    }
    let base = look.grass;
    if (t.terrain === "forest") base = look.forest;
    if (t.terrain === "hills") base = look.snow ? "#b4b6b6" : "#6e6754";
    if (t.terrain === "road") base = look.snow ? "#a49d92" : "#7c6649";
    g.fillStyle = base; g.fillRect(x, y, 1, 1);
    // speckle: tufts, pebbles, snow patches
    for (let i = 0; i < 7; i++) {
      const hx = hash(x, y, i), hy = hash(x, y, i + 20), hs = hash(x, y, i + 40);
      if (t.terrain === "road") { g.fillStyle = hs < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.08)"; g.fillRect(x + hx, y + hy, 0.05, 0.05); continue; }
      if (t.terrain === "hills") { g.fillStyle = hs < 0.5 ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.1)"; g.fillRect(x + hx * 0.95, y + hy * 0.95, 0.07, 0.05); continue; }
      g.fillStyle = hs < 0.5 ? look.speck : look.grass2;
      g.fillRect(x + hx * 0.94, y + hy * 0.94, 0.06, 0.035 + hs * 0.03);
    }
    if (look.flower && t.terrain === "field" && hash(x, y, 77) < 0.35) {
      g.fillStyle = look.flower;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x + hash(x, y, 80 + i), y + hash(x, y, 90 + i), 0.025, 0, 7); g.fill(); }
    }
  }

  function drawRiverBank(g, t, look) {
    if (t.terrain !== "river") return;
    const right = tileAt(t.x + 1, t.y);
    if (right && right.terrain !== "river") {
      g.fillStyle = look.snow ? "#d7dcdf" : "#a08c62";
      g.fillRect(t.x + 0.88, t.y, 0.12, 1);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(t.x + 0.84, t.y, 0.04, 1);
    }
    if (look.snow && t.x === 2) { g.fillStyle = "rgba(220,235,242,0.6)"; g.fillRect(t.x + 0.55, t.y, 0.33, 1); }
  }

  function drawRoadEdges(g, t, look) {
    g.strokeStyle = "rgba(0,0,0,0.16)"; g.lineWidth = 0.03;
    g.beginPath(); g.moveTo(t.x, t.y + 0.38); g.lineTo(t.x + 1, t.y + 0.38); g.moveTo(t.x, t.y + 0.62); g.lineTo(t.x + 1, t.y + 0.62); g.stroke();
    const up = tileAt(t.x, t.y - 1), dn = tileAt(t.x, t.y + 1);
    if (!up || up.terrain !== "road") { g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(t.x, t.y, 1, 0.05); }
    if (!dn || dn.terrain !== "road") { g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(t.x, t.y + 0.95, 1, 0.05); }
  }

  function drawTrees(g, t, look) {
    const n = 2 + Math.floor(hash(t.x, t.y, 5) * 2);
    for (let i = 0; i < n; i++) {
      const cx = t.x + 0.2 + hash(t.x, t.y, 50 + i) * 0.6, cy = t.y + 0.2 + hash(t.x, t.y, 60 + i) * 0.6;
      const r = 0.24 + hash(t.x, t.y, 70 + i) * 0.12;
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.beginPath(); g.ellipse(cx - 0.07, cy + 0.07, r, r * 0.9, 0, 0, 7); g.fill();
      g.fillStyle = (look.snow || hash(t.x, t.y, 30 + i) < 0.5) ? look.canopy : look.canopy2;
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
      g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 0.025; g.stroke();
      g.fillStyle = look.snow ? "rgba(235,242,246,0.8)" : "rgba(255,255,255,0.12)";
      g.beginPath(); g.arc(cx + r * 0.25, cy - r * 0.25, r * 0.5, 0, 7); g.fill();
    }
  }

  function drawBoulders(g, t, look) {
    for (let i = 0; i < 3; i++) {
      const cx = t.x + 0.2 + hash(t.x, t.y, 100 + i) * 0.6, cy = t.y + 0.2 + hash(t.x, t.y, 110 + i) * 0.6, r = 0.08 + hash(t.x, t.y, 120 + i) * 0.1;
      g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.ellipse(cx - 0.03, cy + 0.04, r, r * 0.8, 0, 0, 7); g.fill();
      g.fillStyle = look.snow ? "#9fa3a4" : "#8d8777"; g.beginPath(); g.ellipse(cx, cy, r, r * 0.8, 0.4, 0, 7); g.fill();
      g.strokeStyle = INK; g.lineWidth = 0.02; g.stroke();
      g.fillStyle = look.snow ? "rgba(240,245,248,0.85)" : "rgba(255,255,255,0.15)"; g.beginPath(); g.ellipse(cx + r * 0.2, cy - r * 0.25, r * 0.5, r * 0.35, 0.4, 0, 7); g.fill();
    }
  }

  // A ridge tent seen from above: two pitched halves, a flap at the front, guy ropes.
  function drawTent(g, tent, look) {
    const { x, y } = tent, w = 0.36, h = 0.3;
    const cloth = ["#c2ae84", "#b39d72", "#a8946c", "#bfa98a"][Math.floor(tent.hue * 4)];
    g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(x - 0.04, y + 0.05, w, h);
    g.strokeStyle = "rgba(60,45,30,0.7)"; g.lineWidth = 0.012;
    g.beginPath();
    for (const [a, b, c, d] of [[x, y, x - 0.06, y - 0.05], [x + w, y, x + w + 0.06, y - 0.05], [x, y + h, x - 0.06, y + h + 0.05], [x + w, y + h, x + w + 0.06, y + h + 0.05]]) { g.moveTo(a, b); g.lineTo(c, d); }
    g.stroke();
    g.fillStyle = cloth; g.fillRect(x, y, w / 2, h);
    g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x, y, w / 2, h);
    g.fillStyle = cloth; g.fillRect(x + w / 2, y, w / 2, h);
    g.fillStyle = "rgba(255,255,255,0.1)"; g.fillRect(x + w / 2, y, w / 2, h);
    g.strokeStyle = INK; g.lineWidth = 0.02; g.strokeRect(x, y, w, h);
    g.strokeStyle = "#5a4630"; g.lineWidth = 0.025;
    g.beginPath(); g.moveTo(x + w / 2, y - 0.02); g.lineTo(x + w / 2, y + h + 0.02); g.stroke();
    // open flap at the front
    g.fillStyle = "#3a2e22"; g.beginPath(); g.moveTo(x + w / 2 - 0.07, y + h); g.lineTo(x + w / 2, y + h - 0.09); g.lineTo(x + w / 2 + 0.07, y + h); g.closePath(); g.fill();
    if (look.snow) { g.fillStyle = "rgba(235,240,244,0.75)"; g.fillRect(x + 0.02, y + 0.02, w - 0.04, 0.08); }
  }

  function drawCampfireRing(g) {
    const c = world.commons;
    g.fillStyle = "rgba(40,30,20,0.5)"; g.beginPath(); g.arc(c.x, c.y, 0.22, 0, 7); g.fill();
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      g.fillStyle = "#7d7a72"; g.beginPath(); g.arc(c.x + Math.cos(a) * 0.2, c.y + Math.sin(a) * 0.2, 0.045, 0, 7); g.fill();
      g.strokeStyle = INK; g.lineWidth = 0.015; g.stroke();
    }
    // log benches round the fire, bark ends showing
    g.strokeStyle = INK; g.lineWidth = 0.018;
    for (const [dx, dy] of [[-0.48, 0.18], [0.48, 0.18], [0, 0.42]]) {
      g.save(); g.translate(c.x + dx, c.y + dy);
      g.fillStyle = "#5e4128"; g.fillRect(-0.18, -0.045, 0.36, 0.09); g.strokeRect(-0.18, -0.045, 0.36, 0.09);
      g.fillStyle = "#a07a50"; g.beginPath(); g.ellipse(-0.18, 0, 0.02, 0.045, 0, 0, 7); g.ellipse(0.18, 0, 0.02, 0.045, 0, 0, 7); g.fill();
      g.restore();
    }
  }

  // ----- building pieces (all in tile units) -----
  function shadowRect(g, x, y, w, h) { g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x - 0.05, y + 0.05, w, h); }
  function room(g, t, o) {
    const pad = o.pad === undefined ? 0.06 : o.pad, wall = o.wall || 0.09;
    const x = t.x + pad, y = t.y + pad, s = 1 - pad * 2;
    shadowRect(g, x, y, s, s);
    g.fillStyle = o.floor; g.fillRect(x, y, s, s);
    if (o.planks) {
      g.strokeStyle = o.planks; g.lineWidth = 0.012;
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(x, y + s * i / 6); g.lineTo(x + s, y + s * i / 6); g.stroke(); }
    }
    if (o.tiles) {
      g.strokeStyle = o.tiles; g.lineWidth = 0.012;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + s * i / 4, y); g.lineTo(x + s * i / 4, y + s); g.moveTo(x, y + s * i / 4); g.lineTo(x + s, y + s * i / 4); g.stroke(); }
    }
    // walls with a door gap at the bottom
    g.fillStyle = o.wallColour;
    const door = 0.2, mid = x + s / 2;
    const segs = o.broken ? [[x, y, s * 0.55, wall], [x + s * 0.75, y, s * 0.25, wall], [x, y, wall, s * 0.4], [x + s - wall, y + s * 0.3, wall, s * 0.7], [x, y + s - wall, s * 0.25, wall], [mid + door / 2, y + s - wall, s / 2 - door / 2 - s * 0.2, wall]]
      : [[x, y, s, wall], [x, y, wall, s], [x + s - wall, y, wall, s], [x, y + s - wall, s / 2 - door / 2, wall], [mid + door / 2, y + s - wall, s / 2 - door / 2, wall]];
    for (const [a, b, w, h] of segs) { g.fillRect(a, b, w, h); }
    g.strokeStyle = INK; g.lineWidth = 0.018;
    for (const [a, b, w, h] of segs) g.strokeRect(a, b, w, h);
    if (o.cornerStones) {
      g.fillStyle = STONE;
      for (const [a, b] of [[x, y], [x + s - wall * 1.3, y], [x, y + s - wall * 1.3], [x + s - wall * 1.3, y + s - wall * 1.3]]) { g.fillRect(a, b, wall * 1.3, wall * 1.3); g.strokeRect(a, b, wall * 1.3, wall * 1.3); }
    }
    return { x: x + wall, y: y + wall, s: s - wall * 2 };
  }
  function box(g, x, y, w, h, fill, line) { g.fillStyle = fill; g.fillRect(x, y, w, h); g.strokeStyle = line || INK; g.lineWidth = 0.016; g.strokeRect(x, y, w, h); }
  function circle(g, x, y, r, fill, line) { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); if (line !== false) { g.strokeStyle = line || INK; g.lineWidth = 0.016; g.stroke(); } }
  function bed(g, x, y, blanket) { box(g, x, y, 0.13, 0.24, blanket); box(g, x + 0.015, y + 0.015, 0.1, 0.06, "#e8e0cc"); }
  function crate(g, x, y, s) { box(g, x, y, s, s, "#9a7a4e"); g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s); g.moveTo(x + s, y); g.lineTo(x, y + s); g.stroke(); }
  function rubble(g, t, n) {
    for (let i = 0; i < n; i++) {
      const cx = t.x + 0.15 + hash(t.x, t.y, 200 + i) * 0.7, cy = t.y + 0.15 + hash(t.x, t.y, 210 + i) * 0.7;
      circle(g, cx, cy, 0.03 + hash(t.x, t.y, 220 + i) * 0.04, i % 2 ? STONE : STONE_DARK);
    }
    g.fillStyle = "rgba(20,15,10,0.35)"; g.beginPath(); g.ellipse(t.x + 0.45, t.y + 0.55, 0.18, 0.12, 0.3, 0, 7); g.fill();
  }

  // ----- roofed buildings, seen from above -----
  // A pitched roof with its ridge running across: the upper slope catches the
  // late sun (light from the upper right), the lower slope is in shade, the eaves
  // overhang, and a strip of front wall with a door and windows shows beneath.
  const ROOFS = {
    thatch:  { hi: "#c9a85e", lo: "#9c7d3f", line: "rgba(80,58,24,0.45)", edge: "#6e5528" },
    shingle: { hi: "#8a5a3a", lo: "#64402a", line: "rgba(30,18,10,0.45)", edge: "#3e2818" },
    slate:   { hi: "#6f7782", lo: "#4e5560", line: "rgba(20,24,30,0.5)", edge: "#2c3138" },
    tile:    { hi: "#a5503a", lo: "#7a3828", line: "rgba(40,14,8,0.45)", edge: "#4a2016" }
  };
  function roof(g, x, y, w, h, kind, o) {
    o = o || {};
    const R = ROOFS[kind] || ROOFS.thatch;
    const wallH = Math.min(0.12, h * 0.2);
    // shadow falls down and to the left
    g.fillStyle = "rgba(0,0,0,0.32)"; g.fillRect(x - 0.07, y + 0.07, w + 0.02, h + 0.02);
    // front wall, door and windows below the eaves
    const wy = y + h - wallH;
    g.fillStyle = o.wall || (kind === "slate" ? STONE : WOOD); g.fillRect(x + 0.03, wy, w - 0.06, wallH);
    g.strokeStyle = INK; g.lineWidth = 0.016; g.strokeRect(x + 0.03, wy, w - 0.06, wallH);
    g.fillStyle = "#2a1c10"; g.fillRect(x + w / 2 - 0.05, wy + 0.01, 0.1, wallH - 0.01);
    if (w > 0.5) { g.fillStyle = "#e8c070"; g.fillRect(x + w * 0.2, wy + wallH * 0.3, 0.06, wallH * 0.4); g.fillRect(x + w * 0.8 - 0.06, wy + wallH * 0.3, 0.06, wallH * 0.4); }
    // the two slopes
    const rh = h - wallH, mid = y + rh / 2;
    g.fillStyle = R.hi; g.fillRect(x, y, w, rh / 2);
    g.fillStyle = R.lo; g.fillRect(x, mid, w, rh / 2);
    g.strokeStyle = R.line; g.lineWidth = 0.012;
    g.beginPath();
    if (kind === "thatch") {
      for (let i = 0; i <= w * 28; i++) { const lx = x + i / 28; g.moveTo(lx, y + 0.01); g.lineTo(lx + 0.01, mid - 0.01); g.moveTo(lx, mid + 0.01); g.lineTo(lx - 0.01, y + rh - 0.01); }
    } else {
      const rows = Math.max(2, Math.round(rh / 0.06));
      for (let r = 1; r < rows; r++) { const ly = y + r * rh / rows; g.moveTo(x, ly); g.lineTo(x + w, ly); }
      for (let r = 0; r < rows; r++) { const off = (r % 2) * 0.04; for (let cx = x + off; cx < x + w; cx += 0.08) { const ly = y + r * rh / rows; g.moveTo(cx, ly); g.lineTo(cx, ly + rh / rows); } }
    }
    g.stroke();
    // ridge and eaves
    g.strokeStyle = R.edge; g.lineWidth = 0.03; g.beginPath(); g.moveTo(x, mid); g.lineTo(x + w, mid); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 0.018; g.strokeRect(x, y, w, rh);
    if (kind === "thatch") { g.fillStyle = "rgba(255,240,200,0.12)"; g.fillRect(x, y, w, 0.03); }
    if (o.chimney) {
      const cx = x + w * (o.chimneyX || 0.72), cy = y + rh * 0.18;
      box(g, cx, cy, 0.09, 0.09, kind === "slate" ? STONE_DARK : "#6a4e3a");
      g.fillStyle = "#1a1410"; g.fillRect(cx + 0.02, cy + 0.02, 0.05, 0.05);
    }
    if (o.snow) { g.fillStyle = "rgba(236,242,246,0.82)"; g.fillRect(x + 0.01, y + 0.01, w - 0.02, rh / 2 - 0.01); g.fillStyle = "rgba(220,230,236,0.55)"; g.fillRect(x + 0.01, mid + 0.01, w - 0.02, rh / 2 - 0.03); }
    return { x, y, w, h, wallTop: wy };
  }
  // A round tower with a conical roof.
  function roundTower(g, cx, cy, r, kind, snow) {
    const R = ROOFS[kind] || ROOFS.slate;
    g.fillStyle = "rgba(0,0,0,0.32)"; g.beginPath(); g.arc(cx - 0.06, cy + 0.06, r, 0, 7); g.fill();
    circle(g, cx, cy, r, STONE);
    const grd = g.createRadialGradient(cx + r * 0.3, cy - r * 0.3, 0, cx, cy, r * 0.85);
    grd.addColorStop(0, R.hi); grd.addColorStop(1, R.lo);
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r * 0.85, 0, 7); g.fill();
    g.strokeStyle = R.line; g.lineWidth = 0.012; g.beginPath();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); }
    g.stroke();
    g.strokeStyle = INK; g.lineWidth = 0.018; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    circle(g, cx, cy, 0.03, R.edge);
    if (snow) { g.fillStyle = "rgba(236,242,246,0.7)"; g.beginPath(); g.arc(cx, cy, r * 0.8, Math.PI, Math.PI * 1.9); g.lineTo(cx, cy); g.fill(); }
  }
  function barrel(g, x, y) { circle(g, x, y, 0.055, "#7a5230"); g.strokeStyle = "#3a3a3a"; g.lineWidth = 0.01; g.beginPath(); g.arc(x, y, 0.038, 0, 7); g.stroke(); }
  function banner(g, x, y, colour) {
    g.strokeStyle = WOOD_DARK; g.lineWidth = 0.02; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 0.22); g.stroke();
    g.fillStyle = colour; g.beginPath(); g.moveTo(x, y - 0.22); g.lineTo(x + 0.14, y - 0.18); g.lineTo(x, y - 0.13); g.closePath(); g.fill();
  }
  function yard(g, x, y, w, h, colour) { g.fillStyle = colour || "rgba(120,100,70,0.55)"; g.fillRect(x, y, w, h); }

  // Returns true when the building was drawn as a roofed building.
  function drawRoofed(g, t, id, look) {
    const b = D.BUILDINGS[id] || {};
    const r = root(id), tier = b.tier || 0;
    const { x, y } = t, snow = !!look.snow;
    if (r === "house") {
      const kind = ["thatch", "shingle", "slate"][tier] || "thatch";
      const w = [0.66, 0.76, 0.84][tier], h = [0.56, 0.62, 0.68][tier];
      const rx = x + (1 - w) / 2, ry = y + 0.12;
      if (tier >= 1) yard(g, x + 0.08, y + 0.82, 0.84, 0.12, "rgba(110,90,60,0.35)");
      roof(g, rx, ry, w, h, kind, { chimney: true, snow, chimneyX: 0.68 });
      if (tier >= 1) { g.fillStyle = WOOD_DARK; for (let i = 0; i < 7; i++) g.fillRect(x + 0.08 + i * 0.13, y + 0.9, 0.03, 0.05); }
      if (tier === 2) roof(g, rx + w - 0.22, ry + h - 0.08, 0.24, 0.24, "slate", { snow });
      return true;
    }
    if (r === "workshop") {
      yard(g, x + 0.05, y + 0.55, 0.9, 0.4);
      roof(g, x + 0.1, y + 0.06, 0.8, 0.5, tier ? "slate" : "shingle", { chimney: true, snow, chimneyX: 0.8 });
      // the forge and anvil stand out in the yard
      box(g, x + 0.62, y + 0.66, 0.18, 0.14, "#4a3e36"); circle(g, x + 0.71, y + 0.73, 0.04, "#e07a2a", false);
      g.fillStyle = "#3a3a3e"; g.beginPath(); g.moveTo(x + 0.32, y + 0.74); g.lineTo(x + 0.48, y + 0.74); g.lineTo(x + 0.44, y + 0.8); g.lineTo(x + 0.36, y + 0.8); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.014; g.stroke();
      for (let i = 0; i < 3; i++) box(g, x + 0.1, y + 0.66 + i * 0.07, 0.16, 0.05, "#7a5a3a");
      return true;
    }
    if (r === "brewhouse") {
      yard(g, x + 0.05, y + 0.6, 0.9, 0.35);
      roof(g, x + 0.1, y + 0.08, 0.8, 0.52, "shingle", { chimney: true, snow, chimneyX: 0.2 });
      for (let i = 0; i < 4; i++) barrel(g, x + 0.2 + i * 0.15, y + 0.8);
      return true;
    }
    if (r === "joinery") {
      yard(g, x + 0.05, y + 0.6, 0.9, 0.35);
      roof(g, x + 0.1, y + 0.08, 0.8, 0.52, "thatch", { snow });
      for (let i = 0; i < 4; i++) box(g, x + 0.12, y + 0.66 + i * 0.05, 0.4, 0.04, i % 2 ? PLANK : "#a8845a");
      box(g, x + 0.62, y + 0.7, 0.2, 0.05, "#6a4a2a"); g.fillStyle = "#6a4a2a"; g.fillRect(x + 0.64, y + 0.75, 0.02, 0.08); g.fillRect(x + 0.78, y + 0.75, 0.02, 0.08);
      return true;
    }
    if (r === "guardhouse") {
      yard(g, x + 0.05, y + 0.62, 0.9, 0.33, tier === 2 ? "rgba(190,165,110,0.6)" : undefined);
      roof(g, x + 0.08, y + 0.08, tier ? 0.84 : 0.7, 0.54, "slate", { wall: STONE, snow, chimney: tier > 0, chimneyX: 0.15 });
      banner(g, x + 0.86, y + 0.7, "#8a2a24");
      g.strokeStyle = "#9a9a9a"; g.lineWidth = 0.018; g.beginPath();
      for (let i = 0; i < 4; i++) { g.moveTo(x + 0.14 + i * 0.05, y + 0.66); g.lineTo(x + 0.14 + i * 0.05, y + 0.88); }
      g.stroke();
      if (tier === 2) { for (const dx of [0.45, 0.65]) { circle(g, x + dx, y + 0.8, 0.06, "#c8a860"); circle(g, x + dx, y + 0.8, 0.025, "#8a2a24"); } }
      return true;
    }
    if (r === "keep" && tier >= 1) {
      if (id === "watchtower") { roundTower(g, x + 0.5, y + 0.48, 0.36, "slate", snow); return true; }
      // a square keep: battlements round a stone roof, corner towers
      g.fillStyle = "rgba(0,0,0,0.32)"; g.fillRect(x - 0.02, y + 0.1, 0.98, 0.9);
      box(g, x + 0.05, y + 0.05, 0.9, 0.9, STONE);
      g.fillStyle = id === "manor" ? ROOFS.tile.lo : FLAGSTONE; g.fillRect(x + 0.15, y + 0.15, 0.7, 0.7);
      if (id === "manor") roof(g, x + 0.16, y + 0.16, 0.68, 0.62, "tile", { wall: STONE, snow, chimney: true });
      g.fillStyle = STONE_DARK;
      for (let i = 0; i < 8; i++) { const f = 0.08 + i * 0.11; g.fillRect(x + f, y + 0.05, 0.06, 0.06); g.fillRect(x + f, y + 0.89, 0.06, 0.06); g.fillRect(x + 0.05, y + f, 0.06, 0.06); g.fillRect(x + 0.89, y + f, 0.06, 0.06); }
      for (const [a, c] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) roundTower(g, x + a, y + c, 0.13, "slate", snow);
      banner(g, x + 0.5, y + 0.45, "#2f5a8a");
      return true;
    }
    if (r === "hall") {
      roof(g, x + 0.06, y + 0.1, 0.88, 0.7, "tile", { wall: STONE, snow, chimney: true, chimneyX: 0.15 });
      box(g, x + 0.42, y + 0.02, 0.16, 0.16, STONE); roundTower(g, x + 0.5, y + 0.1, 0.07, "slate", snow);
      banner(g, x + 0.88, y + 0.92, "#2f5a8a");
      return true;
    }
    if (r === "school") {
      const kind = ["thatch", "shingle", "slate"][tier];
      roof(g, x + 0.08, y + 0.08, 0.84, 0.62, kind, { snow, chimney: tier > 0 });
      box(g, x + 0.3, y + 0.8, 0.4, 0.06, "#6a4a2a");
      box(g, x + 0.8, y + 0.74, 0.12, 0.08, "#d8cfb8");
      if (tier === 2) roundTower(g, x + 0.2, y + 0.3, 0.12, "slate", snow);
      return true;
    }
    if (r === "shrine" && tier >= 1) {
      // chapel: a long nave with a bell tower over the door
      roof(g, x + 0.14, y + 0.06, 0.72, 0.74, tier >= 2 ? "slate" : "shingle", { wall: STONE, snow });
      box(g, x + 0.4, y + 0.66, 0.2, 0.2, STONE);
      roundTower(g, x + 0.5, y + 0.76, 0.09, tier >= 2 ? "slate" : "shingle", snow);
      if (tier >= 2) for (const [a, c] of [[0.17, 0.3, "#3a5a9a"], [0.83, 0.3, "#9a3a3a"], [0.17, 0.5, "#c8a03a"], [0.83, 0.5, "#3a8a5a"]]) { g.fillStyle = c; g.fillRect(x + a - 0.02, y + c, 0.04, 0.08); }
      return true;
    }
    if (r === "storehouse" && tier >= 1) {
      roundTower(g, x + 0.42, y + 0.42, 0.34, "thatch", snow);
      for (let i = 0; i < 4; i++) { g.fillStyle = "#c8b080"; g.beginPath(); g.ellipse(x + 0.6 + (i % 2) * 0.14, y + 0.78 + Math.floor(i / 2) * 0.1, 0.06, 0.045, 0, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.012; g.stroke(); }
      crate(g, x + 0.12, y + 0.8, 0.1);
      return true;
    }
    return false;
  }

  // What a burned building leaves: blackened walls, fallen beams, ash.
  function drawBurnt(g, t) {
    const { x, y } = t;
    g.fillStyle = "rgba(20,16,12,0.85)"; g.fillRect(x + 0.08, y + 0.1, 0.84, 0.74);
    g.strokeStyle = "#1a120c"; g.lineWidth = 0.06; g.strokeRect(x + 0.1, y + 0.12, 0.8, 0.7);
    g.strokeStyle = "#3a2a1c"; g.lineWidth = 0.035; g.beginPath();
    g.moveTo(x + 0.15, y + 0.2); g.lineTo(x + 0.8, y + 0.7); g.moveTo(x + 0.75, y + 0.18); g.lineTo(x + 0.3, y + 0.75); g.moveTo(x + 0.2, y + 0.5); g.lineTo(x + 0.85, y + 0.45); g.stroke();
    for (let i = 0; i < 6; i++) circle(g, x + 0.2 + hash(x, y, 600 + i) * 0.6, y + 0.2 + hash(x, y, 610 + i) * 0.55, 0.03, "rgba(90,80,70,0.8)", false);
  }

  function drawBuilding(g, t, id, look) {
    if (t.burnt && id === t.building && !(t.constructing && t.constructing.repair)) { drawBurnt(g, t); return; }
    if (drawRoofed(g, t, id, look)) return;
    const r = root(id), tier = (D.BUILDINGS[id] || {}).tier || 0;
    const { x, y } = t;
    if (r === "house") {
      const stone = tier >= 2;
      const inn = room(g, t, { floor: stone ? FLAGSTONE : PLANK, planks: stone ? null : PLANK_LINE, tiles: stone ? "rgba(0,0,0,0.15)" : null, wallColour: stone ? STONE : WOOD, cornerStones: tier === 1 });
      const beds = [2, 3, 4][tier];
      const blankets = ["#7a3a2a", "#3a5a7a", "#5a6a3a", "#7a6a3a"];
      for (let i = 0; i < beds; i++) bed(g, inn.x + 0.03 + i * (inn.s - 0.16) / Math.max(1, beds - 1), inn.y + 0.03, blankets[(i + x) % 4]);
      box(g, inn.x + inn.s - 0.2, inn.y + inn.s - 0.18, 0.16, 0.11, "#6a4a2a");
      box(g, inn.x + 0.02, inn.y + inn.s - 0.16, 0.12, 0.12, "#3a3430");
      circle(g, inn.x + 0.08, inn.y + inn.s - 0.1, 0.03, "#c8642a", false);
      return;
    }
    if (r === "farm") {
      const pad = 0.04, s = 1 - pad * 2;
      g.fillStyle = look.snow ? "#bfc2c2" : look.soil; g.fillRect(x + pad, y + pad, s, s);
      const rows = [4, 5, 6][tier];
      for (let i = 0; i < rows; i++) {
        const ry = y + pad + 0.06 + i * (s - 0.12) / (rows - 1);
        g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 0.03; g.beginPath(); g.moveTo(x + 0.1, ry); g.lineTo(x + 0.9, ry); g.stroke();
        if (look.crop) {
          for (let k = 0; k < 8; k++) {
            const cx = x + 0.12 + k * 0.1, ch = world.season === "Spring" ? 0.025 : 0.045;
            g.fillStyle = look.crop; g.beginPath(); g.arc(cx, ry - 0.01, ch, 0, 7); g.fill();
          }
        }
      }
      g.fillStyle = WOOD_DARK;
      for (let i = 0; i <= 8; i++) { const f = i / 8; for (const [a, b] of [[x + f, y], [x + f, y + 0.97], [x, y + f], [x + 0.97, y + f]]) g.fillRect(a, b, 0.035, 0.035); }
      if (tier >= 1) { // scarecrow
        g.strokeStyle = WOOD_DARK; g.lineWidth = 0.025; g.beginPath(); g.moveTo(x + 0.75, y + 0.5); g.lineTo(x + 0.9, y + 0.5); g.stroke();
        circle(g, x + 0.825, y + 0.47, 0.035, "#c8a860");
      }
      if (tier >= 2) { box(g, x + 0.06, y + 0.06, 0.24, 0.2, WOOD); crate(g, x + 0.1, y + 0.1, 0.08); }
      return;
    }
    if (r === "dock") {
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x + 0.18, y + 0.27, 0.84, 0.5);
      box(g, x + 0.2, y + 0.24, 0.8, 0.46, PLANK);
      g.strokeStyle = PLANK_LINE; g.lineWidth = 0.014;
      for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(x + 0.2 + i * 0.1, y + 0.24); g.lineTo(x + 0.2 + i * 0.1, y + 0.7); g.stroke(); }
      for (const [a, b] of [[0.2, 0.22], [0.2, 0.68], [0.55, 0.22], [0.55, 0.68]]) circle(g, x + a, y + b, 0.035, WOOD_DARK);
      // moored boat
      g.fillStyle = "#5a3e24"; g.beginPath(); g.ellipse(x + 0.12, y + 0.86, 0.1, 0.06, 0.2, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.016; g.stroke();
      crate(g, x + 0.82, y + 0.3, 0.1);
      return;
    }
    if (r === "workshop") {
      const inn = room(g, t, { floor: "#7a6a52", wallColour: tier ? STONE : WOOD, cornerStones: !tier });
      box(g, inn.x + inn.s - 0.24, inn.y + 0.02, 0.22, 0.18, "#4a3e36");
      circle(g, inn.x + inn.s - 0.13, inn.y + 0.11, 0.05, "#e07a2a", false);
      g.fillStyle = "#3a3a3e"; g.beginPath(); g.moveTo(inn.x + 0.25, inn.y + 0.4); g.lineTo(inn.x + 0.45, inn.y + 0.4); g.lineTo(inn.x + 0.4, inn.y + 0.47); g.lineTo(inn.x + 0.3, inn.y + 0.47); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.016; g.stroke();
      box(g, inn.x + 0.02, inn.y + 0.04, 0.32, 0.12, "#8a6a42");
      if (tier) { box(g, inn.x + 0.02, inn.y + inn.s - 0.16, 0.12, 0.12, "#555"); crate(g, inn.x + inn.s - 0.14, inn.y + inn.s - 0.15, 0.12); }
      return;
    }
    if (r === "mine") {
      g.fillStyle = "#5a5446"; g.fillRect(x, y, 1, 1);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x + 0.2, y + 0.15, 0.6, 0.45);
      g.fillStyle = "#14110e"; g.beginPath(); g.ellipse(x + 0.5, y + 0.3, 0.24, 0.17, 0, 0, 7); g.fill();
      g.strokeStyle = WOOD; g.lineWidth = 0.06; g.beginPath(); g.moveTo(x + 0.27, y + 0.48); g.lineTo(x + 0.27, y + 0.2); g.lineTo(x + 0.73, y + 0.2); g.lineTo(x + 0.73, y + 0.48); g.stroke();
      g.strokeStyle = "#5c5c5c"; g.lineWidth = 0.02;
      g.beginPath(); g.moveTo(x + 0.44, y + 0.45); g.lineTo(x + 0.44, y + 1); g.moveTo(x + 0.56, y + 0.45); g.lineTo(x + 0.56, y + 1); g.stroke();
      for (let i = 0; i < 6; i++) { g.strokeStyle = WOOD_DARK; g.beginPath(); g.moveTo(x + 0.4, y + 0.52 + i * 0.08); g.lineTo(x + 0.6, y + 0.52 + i * 0.08); g.stroke(); }
      for (let i = 0; i < 6; i++) circle(g, x + 0.12 + hash(x, y, 300 + i) * 0.15, y + 0.6 + hash(x, y, 310 + i) * 0.3, 0.035, i % 2 ? "#7a7a78" : "#8a5a3a");
      box(g, x + 0.72, y + 0.68, 0.16, 0.12, "#5a4a3a");
      return;
    }
    if (r === "market") {
      g.fillStyle = "#8a826f"; g.fillRect(x + 0.03, y + 0.03, 0.94, 0.94);
      g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 0.012;
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(x + 0.03, y + i / 6); g.lineTo(x + 0.97, y + i / 6); g.stroke(); }
      const awn = ["#9a3a2a", "#2f5a8a", "#c8a03a", "#3a7a4a"];
      const n = [2, 3, 4][tier];
      for (let i = 0; i < n; i++) {
        const sx = x + 0.08 + (i % 2) * 0.48, sy = y + 0.08 + Math.floor(i / 2) * 0.46;
        shadowRect(g, sx, sy, 0.38, 0.22);
        for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? "#e8dcc0" : awn[(i + x) % 4]; g.fillRect(sx + k * 0.095, sy, 0.095, 0.22); }
        g.strokeStyle = INK; g.lineWidth = 0.016; g.strokeRect(sx, sy, 0.38, 0.22);
      }
      crate(g, x + 0.12, y + 0.8, 0.1); circle(g, x + 0.84, y + 0.86, 0.05, "#6a4a2a");
      return;
    }
    if (r === "guardhouse") {
      const inn = room(g, t, { floor: "#6f6a60", tiles: "rgba(0,0,0,0.12)", wallColour: tier ? STONE : WOOD, cornerStones: !tier, wall: tier ? 0.11 : 0.09 });
      for (let i = 0; i < 1 + tier; i++) bed(g, inn.x + 0.02 + i * 0.16, inn.y + 0.02, "#5a4a3a");
      g.strokeStyle = "#9a9a9a"; g.lineWidth = 0.02;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(inn.x + inn.s - 0.04, inn.y + 0.05 + i * 0.08); g.lineTo(inn.x + inn.s - 0.24, inn.y + 0.05 + i * 0.08); g.stroke(); }
      box(g, inn.x + inn.s - 0.12, inn.y + inn.s - 0.24, 0.08, 0.2, "#8a2a24");
      if (tier >= 2) { circle(g, inn.x + 0.2, inn.y + inn.s - 0.12, 0.07, "#c8a860"); circle(g, inn.x + 0.2, inn.y + inn.s - 0.12, 0.03, "#8a2a24"); }
      return;
    }
    if (r === "keep") {
      if (tier === 0) { room(g, t, { pad: 0.04, floor: "#5a554c", wallColour: STONE_DARK, wall: 0.12, broken: true }); rubble(g, t, 9); return; }
      if (id === "watchtower") {
        g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.arc(x + 0.45, y + 0.55, 0.4, 0, 7); g.fill();
        circle(g, x + 0.5, y + 0.5, 0.4, STONE); circle(g, x + 0.5, y + 0.5, 0.28, "#7a7466");
        g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 0.02;
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.beginPath(); g.moveTo(x + 0.5, y + 0.5); g.lineTo(x + 0.5 + Math.cos(a) * 0.27, y + 0.5 + Math.sin(a) * 0.27); g.stroke(); }
        circle(g, x + 0.5, y + 0.5, 0.06, STONE_DARK);
        return;
      }
      const inn = room(g, t, { pad: 0.04, floor: id === "manor" ? "#6a2a24" : FLAGSTONE, tiles: id === "manor" ? null : "rgba(0,0,0,0.15)", wallColour: STONE, wall: 0.13 });
      for (const [a, b] of [[x + 0.04, y + 0.04], [x + 0.78, y + 0.04], [x + 0.04, y + 0.78], [x + 0.78, y + 0.78]]) circle(g, a + 0.09, b + 0.09, 0.11, STONE);
      if (id === "manor") { box(g, inn.x + 0.12, inn.y + 0.2, inn.s - 0.24, 0.14, "#6a4a2a"); box(g, inn.x + inn.s / 2 - 0.06, inn.y + 0.02, 0.12, 0.08, "#c8a03a"); }
      else { box(g, inn.x + 0.06, inn.y + 0.06, 0.14, 0.24, "#5a4a3a"); crate(g, inn.x + inn.s - 0.16, inn.y + 0.04, 0.12); }
      return;
    }
    if (r === "hall") {
      const inn = room(g, t, { floor: "#7a3a2a", wallColour: STONE, wall: 0.1 });
      g.fillStyle = "#8a6a3a"; g.fillRect(inn.x + 0.04, inn.y + 0.04, inn.s - 0.08, inn.s - 0.08);
      box(g, inn.x + 0.2, inn.y + 0.12, inn.s - 0.4, 0.38, "#5a3e24");
      for (let i = 0; i < 4; i++) { box(g, inn.x + 0.08, inn.y + 0.14 + i * 0.09, 0.07, 0.06, "#4a3220"); box(g, inn.x + inn.s - 0.15, inn.y + 0.14 + i * 0.09, 0.07, 0.06, "#4a3220"); }
      box(g, inn.x + inn.s / 2 - 0.05, inn.y + 0.01, 0.1, 0.08, "#2f5a8a");
      return;
    }
    if (r === "school") {
      const inn = room(g, t, { floor: PLANK, planks: PLANK_LINE, wallColour: tier >= 2 ? STONE : WOOD, cornerStones: tier === 1 });
      box(g, inn.x + 0.02, inn.y + 0.02, inn.s - 0.04, 0.08, "#5a3e24");
      for (let i = 0; i < 3 + tier; i++) g.fillStyle = ["#8a2a24", "#2f5a8a", "#3a6a3a", "#c8a03a"][i % 4], g.fillRect(inn.x + 0.04 + i * 0.08, inn.y + 0.03, 0.05, 0.06);
      for (let r2 = 0; r2 < 2; r2++) for (let c = 0; c < 2; c++) box(g, inn.x + 0.1 + c * 0.3, inn.y + 0.22 + r2 * 0.2, 0.18, 0.1, "#8a6a42");
      return;
    }
    if (r === "walls") {
      if (tier === 0) {
        for (let i = 0; i < 14; i++) {
          const f = i / 13;
          for (const [a, b] of [[x + 0.08 + f * 0.84, y + 0.08], [x + 0.08, y + 0.08 + f * 0.84], [x + 0.92, y + 0.08 + f * 0.84]]) circle(g, a, b, 0.045, WOOD);
          if (f < 0.35 || f > 0.65) circle(g, x + 0.08 + f * 0.84, y + 0.92, 0.045, WOOD);
        }
      } else {
        room(g, t, { pad: 0.04, floor: look.grass, wallColour: STONE, wall: 0.16 });
        for (const [a, b] of [[x + 0.04, y + 0.04], [x + 0.8, y + 0.04], [x + 0.04, y + 0.8], [x + 0.8, y + 0.8]]) box(g, a, b, 0.16, 0.16, STONE_DARK);
      }
      return;
    }
    if (r === "shrine") {
      if (tier === 0) {
        room(g, t, { floor: "#5a554c", wallColour: STONE_DARK, broken: true }); rubble(g, t, 6);
        box(g, x + 0.4, y + 0.18, 0.2, 0.1, "#7a7466"); return;
      }
      const inn = room(g, t, { floor: tier >= 2 ? FLAGSTONE : PLANK, planks: tier >= 2 ? null : PLANK_LINE, tiles: tier >= 2 ? "rgba(0,0,0,0.12)" : null, wallColour: STONE, wall: 0.1 });
      box(g, inn.x + inn.s / 2 - 0.12, inn.y + 0.03, 0.24, 0.1, "#d8cfb8");
      for (let i = 0; i < 3; i++) circle(g, inn.x + inn.s / 2 - 0.08 + i * 0.08, inn.y + 0.08, 0.018, "#f0d880", false);
      for (let i = 0; i < 3; i++) { box(g, inn.x + 0.04, inn.y + 0.22 + i * 0.13, inn.s / 2 - 0.12, 0.06, "#6a4a2a"); box(g, inn.x + inn.s / 2 + 0.08, inn.y + 0.22 + i * 0.13, inn.s / 2 - 0.12, 0.06, "#6a4a2a"); }
      if (tier >= 2) for (const [a, b, c] of [[x + 0.06, y + 0.35, "#3a5a9a"], [x + 0.89, y + 0.35, "#9a3a3a"], [x + 0.06, y + 0.6, "#c8a03a"], [x + 0.89, y + 0.6, "#3a8a5a"]]) box(g, a, b, 0.05, 0.12, c);
      return;
    }
    if (r === "storehouse") {
      if (tier === 0) { room(g, t, { floor: "#5a554c", wallColour: WOOD_DARK, broken: true }); rubble(g, t, 5); crate(g, x + 0.6, y + 0.6, 0.12); return; }
      const inn = room(g, t, { floor: PLANK, planks: PLANK_LINE, wallColour: WOOD, cornerStones: true });
      for (let i = 0; i < 6; i++) { g.fillStyle = "#c8b080"; g.beginPath(); g.ellipse(inn.x + 0.08 + (i % 3) * 0.14, inn.y + 0.08 + Math.floor(i / 3) * 0.14, 0.06, 0.05, 0, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.014; g.stroke(); }
      for (let i = 0; i < 3; i++) crate(g, inn.x + inn.s - 0.14, inn.y + 0.02 + i * 0.15, 0.12);
      return;
    }
    if (r === "well") {
      g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.arc(x + 0.46, y + 0.55, 0.2, 0, 7); g.fill();
      circle(g, x + 0.5, y + 0.5, 0.2, STONE); circle(g, x + 0.5, y + 0.5, 0.12, look.water);
      g.strokeStyle = WOOD_DARK; g.lineWidth = 0.04; g.beginPath(); g.moveTo(x + 0.25, y + 0.5); g.lineTo(x + 0.75, y + 0.5); g.stroke();
      box(g, x + 0.62, y + 0.6, 0.08, 0.08, "#6a4a2a");
      return;
    }
    if (r === "wayshrine") {
      // a roadside shrine: stone plinth, a small figure, candles and offerings
      g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(x + 0.3, y + 0.36, 0.42, 0.42);
      box(g, x + 0.33, y + 0.32, 0.36, 0.36, STONE);
      box(g, x + 0.4, y + 0.38, 0.22, 0.12, FLAGSTONE);
      circle(g, x + 0.51, y + 0.44, 0.06, "#d8cfb8");
      for (const [a, b] of [[0.4, 0.6], [0.51, 0.62], [0.62, 0.6]]) circle(g, x + a, y + b, 0.02, "#f0d880", false);
      for (let i = 0; i < 5; i++) circle(g, x + 0.24 + hash(x, y, 500 + i) * 0.55, y + 0.75 + hash(x, y, 510 + i) * 0.15, 0.022, ["#c84a4a", "#e0c040", "#e8e0f0"][i % 3], false);
      return;
    }
    if (r === "brewhouse") {
      const inn = room(g, t, { floor: "#6f6250", wallColour: WOOD, cornerStones: true });
      circle(g, inn.x + 0.2, inn.y + 0.2, 0.15, "#b0683a");
      circle(g, inn.x + 0.2, inn.y + 0.2, 0.1, "#6a4a22");
      for (let i = 0; i < 4; i++) { circle(g, inn.x + inn.s - 0.1, inn.y + 0.08 + i * 0.15, 0.065, "#7a5230"); g.strokeStyle = "#3a3a3a"; g.lineWidth = 0.012; g.beginPath(); g.arc(inn.x + inn.s - 0.1, inn.y + 0.08 + i * 0.15, 0.045, 0, 7); g.stroke(); }
      box(g, inn.x + 0.06, inn.y + inn.s - 0.16, 0.3, 0.1, "#8a6a42");
      return;
    }
    if (r === "joinery") {
      const inn = room(g, t, { floor: "#8a7356", wallColour: WOOD, cornerStones: false });
      for (let i = 0; i < 4; i++) box(g, inn.x + 0.03, inn.y + 0.04 + i * 0.06, 0.4, 0.045, i % 2 ? PLANK : "#a8845a");
      box(g, inn.x + inn.s - 0.26, inn.y + 0.06, 0.22, 0.08, "#6a4a2a");
      for (const [a, b] of [[0.2, 0.48], [0.38, 0.5]]) { box(g, inn.x + a, inn.y + b, 0.1, 0.1, "#9a7448"); box(g, inn.x + a, inn.y + b - 0.03, 0.1, 0.03, "#7a5634"); }
      g.fillStyle = "rgba(220,190,140,0.6)"; for (let i = 0; i < 8; i++) g.fillRect(inn.x + inn.s - 0.3 + hash(x, y, 520 + i) * 0.25, inn.y + inn.s - 0.2 + hash(x, y, 530 + i) * 0.15, 0.02, 0.012);
      return;
    }
    // anything else: a plain hut
    room(g, t, { floor: PLANK, planks: PLANK_LINE, wallColour: WOOD });
  }

  function drawConstruction(g, t, look) {
    const c = t.constructing;
    const total = c.totalTime || (D.BUILDINGS[c.buildingId] || {}).buildTime || 1;
    const done = clamp01(1 - (c.remaining / Math.max(1, total)));
    g.save();
    g.globalAlpha = 0.25 + done * 0.5;
    if (!t.building || t.building !== c.buildingId) drawBuilding(g, t, c.buildingId, look);
    g.restore();
    g.strokeStyle = "#b08a52"; g.lineWidth = 0.03;
    g.beginPath();
    for (let i = 0; i <= 3; i++) { g.moveTo(t.x + 0.08 + i * 0.28, t.y + 0.08); g.lineTo(t.x + 0.08 + i * 0.28, t.y + 0.92); }
    g.moveTo(t.x + 0.08, t.y + 0.08); g.lineTo(t.x + 0.92, t.y + 0.92);
    g.moveTo(t.x + 0.92, t.y + 0.08); g.lineTo(t.x + 0.08, t.y + 0.92);
    g.stroke();
    for (let i = 0; i < 3; i++) { box(g, t.x + 0.7, t.y + 0.74 + i * 0.05, 0.22, 0.04, PLANK); }
    circle(g, t.x + 0.18, t.y + 0.8, 0.06, STONE);
  }

  // ---------------------------------------------------------------
  // PER-FRAME DRAWING
  // ---------------------------------------------------------------
  function drawWater(c, now) {
    c.strokeStyle = "rgba(220,240,255,0.18)"; c.lineWidth = 0.02;
    c.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < 3; x++) {
      for (let i = 0; i < 2; i++) {
        const ph = (now * 0.12 + hash(x, y, i + 400)) % 1;
        const yy = y + ((hash(x, y, i + 410) + now * 0.25) % 1);
        c.moveTo(x + 0.1 + ph * 0.5, yy); c.lineTo(x + 0.3 + ph * 0.5, yy);
      }
    }
    c.stroke();
  }

  function drawFire(c, now) {
    const f = world.commons, fl = Math.sin(now * 13) * 0.02 + Math.sin(now * 7.3) * 0.02;
    c.fillStyle = "#e0782a"; c.beginPath(); c.arc(f.x, f.y, 0.12 + fl, 0, 7); c.fill();
    c.fillStyle = "#f4c04a"; c.beginPath(); c.arc(f.x + fl * 0.5, f.y - 0.02, 0.06 + fl * 0.5, 0, 7); c.fill();
  }

  function emitSmoke(now, dt) {
    if (particles.length > 90) return;
    for (const l of world.lights) {
      if (l.fire || rnd() > dt * 0.9) continue;
      particles.push({ kind: "smoke", x: l.x + 0.15, y: l.y - 0.25, vx: 0.08 + rnd() * 0.05, vy: -0.18 - rnd() * 0.08, life: 0, max: 3 + rnd() * 2 });
    }
    if (rnd() < dt * 3) particles.push({ kind: "smoke", x: world.commons.x, y: world.commons.y - 0.1, vx: 0.06 + rnd() * 0.05, vy: -0.25, life: 0, max: 2.5 + rnd() });
  }
  function drawParticles(c, dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life += dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life > q.max) { particles.splice(i, 1); continue; }
      const k = q.life / q.max;
      if (q.kind === "smoke") { c.fillStyle = (q.dark ? "rgba(50,45,42," + (0.45 * (1 - k)) : "rgba(200,200,205," + (0.22 * (1 - k))) + ")"; c.beginPath(); c.arc(q.x, q.y, 0.05 + k * (q.dark ? 0.3 : 0.16), 0, 7); c.fill(); }
      else if (q.kind === "spark") { c.fillStyle = "rgba(255,200,90," + (1 - k) + ")"; c.fillRect(q.x, q.y, 0.025, 0.025); q.vy += dt * 2; }
      else if (q.kind === "chip") { c.fillStyle = "rgba(190,150,100," + (1 - k) + ")"; c.fillRect(q.x, q.y, 0.03, 0.02); q.vy += dt * 2; }
    }
  }

  const PAWN_SCALE = 1.35;
  function drawPawn(c, p, now) {
    // drawn at a comfortable size around the feet; sparks are mapped back out
    c.save();
    c.translate(p.x, p.y); c.scale(PAWN_SCALE, PAWN_SCALE); c.translate(-p.x, -p.y);
    drawPawnBody(c, p, now);
    c.restore();
  }
  function drawPawnBody(c, p, now) {
    const sc = p.child ? 0.72 : 1;
    const walking = p.moving;
    const bob = walking ? Math.abs(Math.sin((now + p.anim) * 11)) * 0.022 : 0;
    const pose = p.moving ? "walk" : (p.dest && p.dest.pose) || "stand";
    const working = !p.moving && p.act === "work";
    const crouch = (pose === "crouch" || pose === "sit") && !p.moving ? 0.03 : 0;
    const x = p.x, y = p.y - bob + crouch;
    // shadow
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.beginPath(); c.ellipse(p.x, p.y + 0.07 * sc, 0.09 * sc, 0.04 * sc, 0, 0, 7); c.fill();
    // body
    c.fillStyle = p.shirt;
    c.beginPath(); c.ellipse(x, y + 0.02 * sc, 0.085 * sc, 0.07 * sc, 0, 0, 7); c.fill();
    c.strokeStyle = INK; c.lineWidth = 0.018; c.stroke();
    // head
    const hx = x + p.facing * 0.012, hy = y - 0.075 * sc;
    c.fillStyle = p.skin;
    c.beginPath(); c.arc(hx, hy, 0.058 * sc, 0, 7); c.fill(); c.stroke();
    if (p.type === "soldier") {
      c.fillStyle = "#8a8a8a"; c.beginPath(); c.arc(hx, hy - 0.012, 0.06 * sc, Math.PI, 0); c.fill(); c.stroke();
    } else {
      c.fillStyle = p.hair;
      c.beginPath(); c.arc(hx - p.facing * 0.008, hy - 0.016 * sc, 0.054 * sc, Math.PI * 1.05, Math.PI * 1.95); c.fill();
      if (p.sex === "f" && !p.child) { c.beginPath(); c.ellipse(hx - p.facing * 0.045 * sc, hy + 0.01, 0.022 * sc, 0.045 * sc, 0, 0, 7); c.fill(); }
    }
    // tools and loads
    const swing = working ? Math.sin((now + p.anim) * 6) : 0;
    c.lineWidth = 0.022; c.strokeStyle = "#4a3a2a";
    if (working && (pose === "chop" || pose === "hammer")) {
      const a = -0.6 + swing * 0.9, len = pose === "chop" ? 0.16 : 0.11;
      const ox = x + p.facing * 0.08, oy = y - 0.01;
      const ex = ox + p.facing * Math.cos(a) * len, ey = oy + Math.sin(a) * len;
      c.beginPath(); c.moveTo(ox, oy); c.lineTo(ex, ey); c.stroke();
      c.fillStyle = "#8a8a8a"; c.fillRect(ex - 0.02, ey - 0.02, 0.04, 0.04);
      if (swing > 0.97 && rnd() < 0.5) particles.push({ kind: p.job === "blacksmith" ? "spark" : "chip", x: p.x + (ex - p.x) * PAWN_SCALE, y: p.y + (ey - p.y) * PAWN_SCALE, vx: (rnd() - 0.5) * 0.6, vy: -0.4 - rnd() * 0.3, life: 0, max: 0.5 });
    } else if (working && pose === "crouch") {
      const a = 0.4 + swing * 0.3;
      c.beginPath(); c.moveTo(x + p.facing * 0.07, y); c.lineTo(x + p.facing * (0.07 + Math.cos(a) * 0.1), y + Math.sin(a) * 0.1); c.stroke();
    } else if (working && pose === "fish") {
      p.facing = -1;
      const tip = { x: x - 0.28, y: y - 0.12 };
      c.beginPath(); c.moveTo(x - 0.06, y); c.lineTo(tip.x, tip.y); c.stroke();
      c.strokeStyle = "rgba(230,230,230,0.6)"; c.lineWidth = 0.008;
      const by = y + 0.08 + Math.sin(now * 2 + p.anim) * 0.01;
      c.beginPath(); c.moveTo(tip.x, tip.y); c.lineTo(tip.x - 0.04, by); c.stroke();
      c.fillStyle = "#d84a2a"; c.beginPath(); c.arc(tip.x - 0.04, by, 0.016, 0, 7); c.fill();
    } else if (p.type === "soldier") {
      c.strokeStyle = "#5a4a3a"; c.beginPath(); c.moveTo(x + p.facing * 0.08, y + 0.06); c.lineTo(x + p.facing * 0.08, y - 0.2); c.stroke();
      c.fillStyle = "#a0a0a0"; c.beginPath(); c.moveTo(x + p.facing * 0.08, y - 0.25); c.lineTo(x + p.facing * 0.06, y - 0.2); c.lineTo(x + p.facing * 0.1, y - 0.2); c.closePath(); c.fill();
      if (p.act === "watch") { c.fillStyle = "#f4a040"; c.beginPath(); c.arc(x - p.facing * 0.08, y - 0.1, 0.03 + Math.sin(now * 15) * 0.006, 0, 7); c.fill(); }
    }
    if (p.carry && p.moving) {
      const cx = x, cy = y - 0.17 * sc;
      if (p.carry === "log") { box(c, cx - 0.1, cy - 0.025, 0.2, 0.05, "#7a5a3a"); }
      else if (p.carry === "fish") { c.fillStyle = "#8ab0c0"; c.beginPath(); c.ellipse(cx, cy, 0.06, 0.025, 0, 0, 7); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.012; c.stroke(); }
      else if (p.carry === "wheat") { circle(c, cx, cy, 0.05, "#d8b860"); }
      else if (p.carry === "herbs") { circle(c, cx, cy, 0.04, "#5a8a3a"); }
      else { circle(c, cx, cy, 0.045, p.carry === "ore" ? "#8a5a3a" : "#8a8a84"); }
    }
  }


  // ---------------------------------------------------------------
  // BATTLES
  // ---------------------------------------------------------------
  function noteDeaths() {
    const b = game && game.battle;
    if (!b) return;
    const seen = seenDeaths[b.id] || 0;
    for (let i = seen; i < b.deaths.length; i++) {
      const d = b.deaths[i];
      const p = pawns.get(d.id);
      corpses.push({ x: d.x, y: d.y, skin: p ? p.skin : SKIN[0], hair: p ? p.hair : HAIR[0], shirt: p ? p.shirt : SHIRT_BY_TYPE.labourer[0], t: simNow });
      if (p) pawns.delete(d.id);
    }
    seenDeaths[b.id] = b.deaths.length;
    if (corpses.length > 30) corpses.splice(0, corpses.length - 30);
  }
  function lying(c, x, y, shirt, skin, hair, alpha, scale) {
    c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(scale || PAWN_SCALE, scale || PAWN_SCALE); c.rotate(Math.PI / 2.3);
    c.fillStyle = "rgba(90,10,10,0.5)"; c.beginPath(); c.ellipse(0.02, 0.04, 0.11, 0.06, 0, 0, 7); c.fill();
    c.fillStyle = shirt; c.beginPath(); c.ellipse(0, 0.02, 0.085, 0.06, 0, 0, 7); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.016; c.stroke();
    c.fillStyle = skin; c.beginPath(); c.arc(0, -0.07, 0.05, 0, 7); c.fill(); c.stroke();
    if (hair) { c.fillStyle = hair; c.beginPath(); c.arc(0, -0.085, 0.045, Math.PI, 0); c.fill(); }
    c.restore();
  }
  function drawCorpses(c) {
    for (let i = corpses.length - 1; i >= 0; i--) {
      const k = corpses[i], age = simNow - k.t;
      if (age > 90) { corpses.splice(i, 1); continue; }
      lying(c, k.x, k.y, k.shirt, k.skin, k.hair, age > 70 ? (90 - age) / 20 : 1);
    }
  }
  function healthBar(c, x, y, hp, max) {
    if (hp >= max || hp <= 0) return;
    c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(x - 0.1, y, 0.2, 0.03);
    c.fillStyle = hp / max > 0.5 ? "#8fbf5a" : hp / max > 0.25 ? "#e0b050" : "#d84a2a"; c.fillRect(x - 0.1, y, 0.2 * hp / max, 0.03);
  }
  function addBattleDrawables(c, items, now) {
    const b = game.battle;
    for (const d of b.defenders) {
      const p = pawns.get(d.id) || { skin: SKIN[1], hair: HAIR[1], shirt: SHIRT_BY_TYPE.soldier[0], anim: 0, sex: "m" };
      if (d.state === "down") { items.push({ y: d.y - 0.2, draw: () => lying(c, d.x, d.y, p.shirt, p.skin, p.hair, 0.95) }); continue; }
      items.push({ y: d.y, draw: () => {
        const fake = { x: d.x, y: d.y, child: false, moving: d.state !== "fight", anim: p.anim || 0, skin: p.skin, hair: p.hair, shirt: d.ally ? "#3a4a6a" : SHIRT_BY_TYPE.soldier[0], sex: p.sex,
          type: "soldier", facing: d.fx || 1, act: "work", job: d.job, dest: { pose: d.job === "archer" ? "stand" : "hammer" }, carry: null };
        drawPawn(c, fake, now);
        if (d.hitT < 0.15) { c.fillStyle = "rgba(255,40,30,0.35)"; c.beginPath(); c.arc(d.x, d.y - 0.05, 0.14, 0, 7); c.fill(); }
        healthBar(c, d.x, d.y - 0.32, d.hp, d.maxHp);
      } });
    }
    for (const a of b.attackers) {
      if (a.state === "gone") continue;
      if (a.state === "dead") { items.push({ y: a.y - 0.2, draw: () => drawFoe(c, a, now, true) }); continue; }
      items.push({ y: a.y, draw: () => drawFoe(c, a, now, false) });
    }
  }
  // Raiders, warriors and monsters.
  function drawFoe(c, a, now, dead) {
    const k = a.kind, f = a.fx || -1;
    c.save();
    c.translate(a.x, a.y);
    if (dead) { c.rotate(Math.PI / 2.2); c.globalAlpha = 0.85; }
    c.scale(PAWN_SCALE, PAWN_SCALE);
    const bob = !dead && a.state !== "fight" ? Math.abs(Math.sin((now + a.x) * 10)) * 0.02 : 0;
    c.translate(0, -bob);
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(0, 0.07 + bob, 0.1, 0.045, 0, 0, 7); c.fill();
    c.strokeStyle = INK; c.lineWidth = 0.018;
    const swing = a.state === "fight" ? Math.sin(now * 9 + a.x * 3) : 0;
    if (k === "raider" || k === "warrior") {
      const cloak = k === "raider" ? "#4a2a22" : "#3a3e48";
      c.fillStyle = cloak; c.beginPath(); c.ellipse(0, 0.02, 0.09, 0.075, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = k === "raider" ? "#8a2420" : "#a08a3a"; c.fillRect(-0.085, 0.0, 0.17, 0.022);
      c.fillStyle = "#d8b090"; c.beginPath(); c.arc(f * 0.01, -0.075, 0.056, 0, 7); c.fill(); c.stroke();
      if (k === "raider") { c.fillStyle = "#2a1c18"; c.beginPath(); c.arc(f * 0.005, -0.08, 0.062, Math.PI * 0.95, Math.PI * 2.05); c.fill(); }
      else { c.fillStyle = "#7a7a7a"; c.beginPath(); c.arc(0, -0.088, 0.06, Math.PI, 0); c.fill(); c.stroke(); c.fillStyle = "#8a2420"; c.fillRect(-0.01, -0.16, 0.02, 0.05); }
      // blade
      const ang = -0.7 + swing * 0.9;
      c.strokeStyle = "#c8c8c8"; c.lineWidth = 0.02; c.beginPath(); c.moveTo(f * 0.08, 0); c.lineTo(f * (0.08 + Math.cos(ang) * 0.15), Math.sin(ang) * 0.15); c.stroke();
      if (k === "warrior") { c.fillStyle = "#6a3a2a"; c.beginPath(); c.arc(-f * 0.08, 0.02, 0.05, 0, 7); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.014; c.stroke(); }
      if (a.carry > 0 && !dead) { c.fillStyle = "#b09a6a"; c.beginPath(); c.arc(-f * 0.06, -0.12, 0.05, 0, 7); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.012; c.stroke(); }
    } else if (k === "drowner") {
      c.fillStyle = "#3e6a5e"; c.beginPath(); c.ellipse(0, 0.02, 0.1, 0.08, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = "#4e7e70"; c.beginPath(); c.arc(f * 0.02, -0.07, 0.065, 0, 7); c.fill(); c.stroke();
      c.fillStyle = "#e8e050"; c.fillRect(f * 0.02 - 0.03, -0.085, 0.02, 0.015); c.fillRect(f * 0.02 + 0.01, -0.085, 0.02, 0.015);
      c.strokeStyle = "#2a4a40"; c.lineWidth = 0.02; c.beginPath(); c.moveTo(f * 0.08, 0.0); c.lineTo(f * (0.14 + swing * 0.04), 0.06); c.stroke();
    } else if (k === "nekker") {
      c.scale(0.8, 0.8);
      c.fillStyle = "#6a5a48"; c.beginPath(); c.ellipse(0, 0.02, 0.09, 0.07, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = "#7a6a56"; c.beginPath(); c.arc(f * 0.02, -0.07, 0.06, 0, 7); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-0.04, -0.1); c.lineTo(-0.1, -0.17); c.lineTo(-0.01, -0.12); c.moveTo(0.04, -0.1); c.lineTo(0.1, -0.17); c.lineTo(0.01, -0.12); c.fill(); c.stroke();
      c.fillStyle = "#e04030"; c.fillRect(f * 0.02 - 0.025, -0.08, 0.015, 0.015); c.fillRect(f * 0.02 + 0.01, -0.08, 0.015, 0.015);
    } else {
      // ghoul
      c.fillStyle = "#9a9a8a"; c.beginPath(); c.ellipse(0, 0.02, 0.11, 0.08, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = "#b0ae9c"; c.beginPath(); c.arc(f * 0.03, -0.06, 0.06, 0, 7); c.fill(); c.stroke();
      c.fillStyle = "#c03020"; c.fillRect(f * 0.03 - 0.025, -0.07, 0.015, 0.012); c.fillRect(f * 0.03 + 0.01, -0.07, 0.015, 0.012);
      c.strokeStyle = "#e0dccc"; c.lineWidth = 0.012; c.beginPath();
      for (let i = 0; i < 3; i++) { c.moveTo(f * 0.09, -0.01 + i * 0.02); c.lineTo(f * (0.15 + swing * 0.03), -0.03 + i * 0.03); }
      c.stroke();
    }
    c.restore();
    if (!dead) {
      if (a.hitT < 0.15) { c.fillStyle = "rgba(255,255,255,0.35)"; c.beginPath(); c.arc(a.x, a.y - 0.05, 0.14, 0, 7); c.fill(); }
      healthBar(c, a.x, a.y - 0.3, a.hp, a.maxHp);
    }
  }
  function drawShots(c) {
    const b = game.battle;
    if (!b || !battleOn()) return;
    c.strokeStyle = "rgba(240,230,200,0.9)"; c.lineWidth = 0.015;
    for (const s of b.shots) {
      const age = b.t - s.t;
      if (age < 0 || age > 0.35) continue;
      const k = age / 0.35, x = s.fx + (s.tx - s.fx) * k, y = s.fy + (s.ty - s.fy) * k - Math.sin(k * Math.PI) * 0.3;
      const dx = (s.tx - s.fx), dy = (s.ty - s.fy), d = Math.hypot(dx, dy) || 1;
      c.beginPath(); c.moveTo(x - dx / d * 0.14, y - dy / d * 0.14); c.lineTo(x, y); c.stroke();
    }
  }
  function drawFires(c, now, dt) {
    const b = game.battle;
    if (!b || !b.fires) return;
    for (const key in b.fires) {
      const [x, y] = key.split(",").map(Number);
      const prog = b.fires[key];
      const n = 3 + Math.floor(prog * 6);
      for (let i = 0; i < n; i++) {
        const fx = x + 0.2 + hash(x, y, 700 + i) * 0.6, fy = y + 0.25 + hash(x, y, 710 + i) * 0.5;
        const h = 0.12 + Math.sin(now * 12 + i * 1.7) * 0.04 + prog * 0.1;
        c.fillStyle = "rgba(230,100,30,0.85)"; c.beginPath(); c.moveTo(fx - 0.06, fy); c.quadraticCurveTo(fx, fy - h * 1.4, fx + 0.06, fy); c.fill();
        c.fillStyle = "rgba(255,210,90,0.9)"; c.beginPath(); c.moveTo(fx - 0.03, fy); c.quadraticCurveTo(fx, fy - h * 0.8, fx + 0.03, fy); c.fill();
      }
      if (dt > 0 && rnd() < dt * 4 && particles.length < 120) particles.push({ kind: "smoke", x: x + 0.3 + rnd() * 0.4, y: y + 0.2, vx: 0.15 + rnd() * 0.1, vy: -0.35, life: 0, max: 3 + rnd() * 2, dark: true });
    }
  }

  function darkness(phase) {
    if (phase < 0.18 || phase >= 0.94) return { k: 1, tint: 0 };
    if (phase < 0.27) { const f = (phase - 0.18) / 0.09; return { k: 1 - f, tint: Math.sin(f * Math.PI) }; }
    if (phase < 0.82) return { k: 0, tint: 0 };
    const f = (phase - 0.82) / 0.12; return { k: f, tint: Math.sin(f * Math.PI) };
  }

  function drawLighting(c, now) {
    const { k, tint } = darkness(clock);
    if (tint > 0.01) { c.fillStyle = "rgba(255,130,50," + (0.12 * tint) + ")"; c.fillRect(0, 0, W, H); }
    if (k <= 0.01) return;
    const dc = darkCanvas, d = dc.getContext("2d");
    const s = dc.width / W;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, dc.width, dc.height);
    d.fillStyle = "rgba(8,12,32," + (0.66 * k) + ")";
    d.fillRect(0, 0, dc.width, dc.height);
    d.setTransform(s, 0, 0, s, 0, 0);
    d.globalCompositeOperation = "destination-out";
    const glow = (x, y, r) => { const gr = d.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(0,0,0,0.95)"); gr.addColorStop(1, "rgba(0,0,0,0)"); d.fillStyle = gr; d.beginPath(); d.arc(x, y, r, 0, 7); d.fill(); };
    const flick = 1 + Math.sin(now * 9) * 0.05;
    for (const l of world.lights) glow(l.x, l.y, l.r * (l.fire ? flick : 1));
    for (const p of pawns.values()) if (p.act === "watch" && p.visible) glow(p.x, p.y - 0.1, 0.9 * flick);
    if (game.battle && battleOn()) {
      for (const key in game.battle.fires) { const [fx, fy] = key.split(",").map(Number); glow(fx + 0.5, fy + 0.5, 2.2 * flick); }
      for (const a of game.battle.attackers) if ((a.kind === "raider" || a.kind === "warrior") && a.state !== "dead" && a.state !== "gone") glow(a.x, a.y - 0.1, 0.9 * flick);
      for (const d of game.battle.defenders) if (d.state !== "down") glow(d.x, d.y - 0.1, 0.7 * flick);
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(dc, 0, 0, canvas.width, canvas.height);
    c.restore();
    // warm colour where the lights fall
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const l of world.lights) {
      const gr = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.7);
      gr.addColorStop(0, "rgba(" + l.c + "," + (0.13 * k) + ")"); gr.addColorStop(1, "rgba(" + l.c + ",0)");
      c.fillStyle = gr; c.beginPath(); c.arc(l.x, l.y, l.r * 0.7, 0, 7); c.fill();
    }
    c.restore();
  }

  function rollWeather() {
    const s = world.season;
    const r = rnd();
    let kind = null;
    if (s === "Winter") kind = r < 0.7 ? "snow" : null;
    else if (s === "Autumn") kind = r < 0.35 ? "rain" : (r < 0.75 ? "leaves" : null);
    else if (s === "Spring") kind = r < 0.3 ? "rain" : null;
    else kind = r < 0.1 ? "rain" : null;
    weather = { kind, drops: [] };
    const n = kind === "rain" ? 140 : kind === "snow" ? 110 : kind === "leaves" ? 26 : 0;
    for (let i = 0; i < n; i++) weather.drops.push({ x: rnd() * W, y: rnd() * H, v: 0.6 + rnd() * 0.6, ph: rnd() * 6 });
  }
  function drawWeather(c, dt, now) {
    if (!weather.kind) return;
    if (weather.kind === "rain") {
      c.strokeStyle = "rgba(190,210,230,0.35)"; c.lineWidth = 0.012; c.beginPath();
      for (const q of weather.drops) { q.y += q.v * dt * 9; q.x -= dt * 1.5; if (q.y > H) { q.y = -0.3; q.x = rnd() * (W + 3); } c.moveTo(q.x, q.y); c.lineTo(q.x - 0.05, q.y + 0.22); }
      c.stroke();
      c.fillStyle = "rgba(40,50,70,0.12)"; c.fillRect(0, 0, W, H);
    } else if (weather.kind === "snow") {
      c.fillStyle = "rgba(245,248,252,0.85)";
      for (const q of weather.drops) { q.y += q.v * dt * 0.9; q.x += Math.sin(now + q.ph) * dt * 0.3; if (q.y > H) { q.y = -0.1; q.x = rnd() * W; } c.beginPath(); c.arc(q.x, q.y, 0.025, 0, 7); c.fill(); }
    } else {
      for (const q of weather.drops) { q.y += q.v * dt * 0.6; q.x += (0.4 + Math.sin(now * 2 + q.ph) * 0.4) * dt; if (q.y > H || q.x > W) { q.y = -0.1; q.x = rnd() * W; }
        c.fillStyle = ["#b8642e", "#c8963a", "#8a4a22"][Math.floor(q.ph) % 3]; c.save(); c.translate(q.x, q.y); c.rotate(now * 2 + q.ph); c.fillRect(-0.03, -0.015, 0.06, 0.03); c.restore(); }
    }
  }

  function clockLabel(phase) {
    if (phase < 0.18 || phase >= 0.94) return "🌙 Night";
    if (phase < 0.27) return "🌅 Dawn";
    if (phase < 0.55) return "☀ Morning";
    if (phase < 0.62) return "🍲 Midday meal";
    if (phase < 0.82) return "☀ Afternoon";
    return "🌇 Dusk";
  }

  function frame(ts) {
    rafId = null;
    if (!canvas || !canvas.isConnected || !canvas.offsetParent) return;   // not on screen: let the loop stop
    if (document.hidden) { rafId = requestAnimationFrame(frame); return; }
    if (ts - lastFrame < FRAME_MS - 2) { rafId = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, (ts - (lastTick || ts)) / 1000);
    lastTick = ts; lastFrame = ts;
    tick(dt, ts / 1000);
    rafId = requestAnimationFrame(frame);
  }

  function tick(dt, now) {
    const before = clock;
    let simDt = dt;
    if (clockFn) {
      const gc = clockFn();
      clock = gc.phase % 1; simDt = dt * gc.speed;
    } else {
      clock = (clock + dt / DAY_SECONDS) % 1;
    }
    if (clock < before - 0.5) { dayCount++; rollWeather(); }
    simNow += simDt;
    noteDeaths();
    for (const p of pawns.values()) updatePawn(p, simDt, simNow);
    if (simDt > 0) emitSmoke(simNow, simDt);
    draw(simDt, now);
    const label = clockLabel(clock);
    if (label !== lastLabel) { lastLabel = label; if (onClockLabel) onClockLabel(label); }
  }

  function draw(dt, now) {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(staticCanvas, 0, 0);
    c.setTransform(tile * dpr, 0, 0, tile * dpr, 0, 0);
    drawWater(c, now);
    drawFire(c, now);
    drawCorpses(c);
    const items = Array.from(pawns.values()).filter(p => p.visible).map(p => ({ y: p.y, draw: () => drawPawn(c, p, now) }));
    if (battleOn()) addBattleDrawables(c, items, now);
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    drawFires(c, now, dt);
    drawShots(c);
    drawParticles(c, dt);
    drawWeather(c, dt, now);
    drawLighting(c, now);
  }

  // ---------------------------------------------------------------
  // PUBLIC
  // ---------------------------------------------------------------
  function ensureCanvases() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "villageCanvas";
    canvas.setAttribute("aria-hidden", "true");
    ctx = canvas.getContext("2d");
    staticCanvas = document.createElement("canvas");
    darkCanvas = document.createElement("canvas");
  }

  function resize() {
    const w = W * tile, h = H * tile;
    const want = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    dpr = Math.max(1, Math.min(want, Math.sqrt(MAX_CANVAS_PIXELS / (w * h))));
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    if (staticCanvas.width !== pw || staticCanvas.height !== ph) { staticCanvas.width = pw; staticCanvas.height = ph; staticKey = ""; }
    darkCanvas.width = Math.round(W * 16); darkCanvas.height = Math.round(H * 16);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
  }

  function mapKey() {
    let k = world.season + "|" + tile + "|" + dpr + "|" + world.tents.length + "|";
    for (const t of game.grid) if (t.building || t.constructing) k += t.x + "," + t.y + ":" + (t.building || "") + (t.burnt ? "!" : "") + "/" + (t.constructing ? t.constructing.buildingId + Math.ceil(t.constructing.remaining) : "") + ";";
    return k;
  }

  function refresh() {
    if (!canvas || !game) return;
    W = E.GRID_W; H = E.GRID_H;
    indexCells();
    world = buildWorld();
    pathCache = new Map();
    resize();
    const key = mapKey();
    if (key !== staticKey) { paintStatic(); staticKey = key; }
    syncPawns();
    if (!weather.kind && !weather.drops.length) rollWeather();
  }

  // Attach the village to a freshly rendered map grid (called on every map render).
  function mount(gridEl, state, tileSize, labelCallback) {
    if (!supported || !E || !D || !gridEl) return false;
    ensureCanvases();
    if (!ctx) return false;
    game = state; tile = tileSize; onClockLabel = labelCallback || null; lastLabel = "";
    gridEl.insertBefore(canvas, gridEl.firstChild);
    refresh();
    if (reducedMotion) {
      // one still frame by day, everyone at their posts
      clock = 0.4;
      for (const p of pawns.values()) { const s = destFor(p, "work"); p.x = s.x; p.y = s.y; p.act = "work"; p.dest = s; p.path = []; p.visible = true; }
      draw(0, 0);
      if (onClockLabel) onClockLabel(clockLabel(clock));
      return true;
    }
    start();
    return true;
  }
  function setTileSize(tileSize) {
    if (!canvas || !game || tileSize === tile) return;
    tile = tileSize; refresh();
    if (reducedMotion) draw(0, 0);
  }
  function start() {
    if (rafId || reducedMotion || !canvas) return;
    lastTick = 0;
    rafId = requestAnimationFrame(frame);
  }
  // A tap on the map: who is standing here, if anyone (tile units).
  function personAt(tx, ty) {
    let best = null, bd = 0.04;
    for (const p of pawns.values()) {
      if (!p.visible) continue;
      const d = (p.x - tx) ** 2 + (p.y - 0.05 - ty) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    const job = best.job && D.JOBS[best.job] ? D.JOBS[best.job].name : (best.child ? "Child" : "Idle");
    const doing = { work: "at work", meal: "at the midday meal", leisure: "taking the evening air", home: "heading home", watch: "on the night watch", play: "playing" }[best.act] || "";
    return { name: best.name, job, doing };
  }

  // For screenshots and tests: jump to a time of day (0 midnight, 0.5 midday).
  function setClock(v) {
    clock = ((v % 1) + 1) % 1;
    if (clockSet) clockSet(clock);      // the game's clock is the one that counts
    for (const p of pawns.values()) { p.act = null; }
  }

  function centre() { return world ? world.commons : null; }
  let clockSet = null;
  function useClock(fn, setFn) { clockFn = fn; clockSet = setFn || null; }

  return { supported, mount, setTileSize, start, personAt, setClock, centre, useClock };
})();

if (typeof window !== "undefined") window.VillageView = VillageView;
if (typeof module !== "undefined") module.exports = VillageView;
