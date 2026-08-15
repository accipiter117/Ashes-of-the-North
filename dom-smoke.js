const fs = require("fs");
const path = require("path");
const http = require("http");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
// Strip the Google Fonts @import so jsdom doesn't attempt a live network fetch during the test.
const cssPath = path.join(root, "css", "style.css");
const originalCss = fs.readFileSync(cssPath, "utf8");
fs.writeFileSync(cssPath, originalCss.replace(/^@import[^\n]*\n/, "/* fonts import stripped for test */\n"));

// Serve the game over real HTTP so the page has a non-opaque origin (needed for localStorage,
// exactly like it will have once deployed to GitHub Pages).
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript" };
const server = http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (req.url === "/") p = path.join(root, "index.html");
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "text/plain" });
    res.end(data);
  });
});

let failed = false;
function waitFor(cond, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(check, 20);
    })();
  });
}

let window, doc;

(async function run() {
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const dom = await JSDOM.fromURL("http://127.0.0.1:" + port + "/index.html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true
  });
  window = dom.window;
  window.alert = (msg) => console.log("[alert] " + msg);
  window.confirm = () => true;

  await waitFor(() => window.document.readyState === "complete" && typeof window.UI !== "undefined" && typeof window.GameEngine !== "undefined", 5000);
  await waitFor(() => !!window.document.getElementById("startScreen"), 5000);

  doc = window.document;
  function click(el) { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); }
  function assert(cond, msg) { if (!cond) { failed = true; console.error("FAIL: " + msg); } else { console.log("OK: " + msg); } }

  // Start screen present
  assert(!!doc.getElementById("startScreen"), "start screen rendered");
  assert(!!doc.getElementById("newGameBtn2"), "new game button present");

  // Found a new settlement
  doc.getElementById("settlementNameInput").value = "Ashholm";
  click(doc.getElementById("newGameBtn2"));
  assert(!doc.getElementById("startScreen"), "start screen removed after new game");
  assert(doc.getElementById("settlementTitle").textContent === "Ashholm", "settlement title set");

  // Resource bar populated
  assert(doc.getElementById("resourceBar").children.length > 5, "resource bar has chips");

  // Navigate through every view
  ["settlement","citizens","build","diplomacy","explore","research","chronicle","menu"].forEach(v => {
    const btn = doc.querySelector('.nav-btn[data-view="' + v + '"]');
    click(btn);
    const view = doc.getElementById("view-" + v);
    assert(view.classList.contains("active"), "view switches to " + v);
    assert(view.innerHTML.length > 10, "view " + v + " renders content");
  });

  // Select a tile on the settlement map and build a house
  click(doc.querySelector('.nav-btn[data-view="settlement"]'));
  const emptyTileEl = Array.from(doc.querySelectorAll(".tile")).find(t => !t.classList.contains("has-building") && !t.classList.contains("terrain-river") && !t.classList.contains("terrain-hills"));
  assert(!!emptyTileEl, "found a buildable empty tile");
  click(emptyTileEl);
  const buildBtn = doc.querySelector('[data-build="house"]');
  assert(!!buildBtn, "house build option available on empty tile");
  click(buildBtn);
  assert(doc.querySelectorAll(".constructing").length >= 1, "construction started");

  // Map zoom controls: grid tile count matches the bigger map, zoom buttons resize
  // the grid via the CSS custom property, and pan position survives a re-render.
  assert(doc.querySelectorAll(".tile").length === 280, "map should render all 280 tiles on the bigger grid — got " + doc.querySelectorAll(".tile").length);
  const mapGridEl = doc.getElementById("mapGrid");
  const zoomBefore = mapGridEl.style.getPropertyValue("--tile-size");
  click(doc.getElementById("zoomInBtn"));
  const zoomAfterIn = mapGridEl.style.getPropertyValue("--tile-size");
  assert(zoomAfterIn !== zoomBefore, "zoom in should change the tile-size custom property (" + zoomBefore + " -> " + zoomAfterIn + ")");
  click(doc.getElementById("zoomOutBtn"));
  click(doc.getElementById("zoomOutBtn"));
  const zoomAfterOut = doc.getElementById("mapGrid").style.getPropertyValue("--tile-size");
  assert(zoomAfterOut !== zoomAfterIn, "zoom out should shrink the tile-size custom property again");
  click(doc.getElementById("zoomFitBtn"));
  const zoomAfterReset = doc.getElementById("mapGrid").style.getPropertyValue("--tile-size");
  assert(zoomAfterReset === "30px", "reset button should return zoom to the 30px default — got " + zoomAfterReset);

  const mapWrapEl = doc.getElementById("mapWrap");
  mapWrapEl.scrollLeft = 123;
  // A full re-render (as any game action triggers) should preserve pan position rather
  // than snapping back to the top-left corner of a now much bigger map.
  window.UI.renderAll();
  assert(doc.getElementById("mapWrap").scrollLeft === 123, "pan/scroll position should survive a full re-render — got " + doc.getElementById("mapWrap").scrollLeft);

  // Demolish: build a farm elsewhere, select it, and confirm the demolish button clears it.
  const secondEmptyTile = Array.from(doc.querySelectorAll(".tile")).find(t => !t.classList.contains("has-building") && !t.classList.contains("constructing") && !t.classList.contains("terrain-river") && !t.classList.contains("terrain-hills"));
  click(secondEmptyTile);
  const farmBuildBtn = doc.querySelector('[data-build="farm"]');
  assert(!!farmBuildBtn, "farm build option available for demolish test");
  click(farmBuildBtn);
  const farmTileState = window.UI.getState().grid.find(t => t.x === parseInt(secondEmptyTile.dataset.x) && t.y === parseInt(secondEmptyTile.dataset.y));
  farmTileState.constructing = null; farmTileState.building = "farm"; farmTileState.tier = 0; // instantly finish for the test
  window.UI.renderAll();
  const builtTileEl = doc.querySelector('.tile[data-x="' + secondEmptyTile.dataset.x + '"][data-y="' + secondEmptyTile.dataset.y + '"]');
  click(builtTileEl);
  const demolishBtn = doc.getElementById("demolishBtn");
  assert(!!demolishBtn, "demolish button present for a built, non-ruin tile");
  const woodBefore = window.UI.getState().resources.wood;
  window.confirm = () => true;
  click(demolishBtn);
  assert(window.UI.getState().resources.wood > woodBefore, "demolishing should refund some materials");
  const clearedTile = window.UI.getState().grid.find(t => t.x === parseInt(secondEmptyTile.dataset.x) && t.y === parseInt(secondEmptyTile.dataset.y));
  assert(clearedTile.building === null, "tile should be empty after demolishing via the UI");

  // Assign an idle citizen to a job via the citizens view
  click(doc.querySelector('.nav-btn[data-view="citizens"]'));
  const autoBtn = doc.getElementById("autoAssignBtn");
  click(autoBtn);
  const hasAssigned = window.UI.getState().citizens.some(c => c.job);
  assert(hasAssigned, "auto-assign put at least one citizen to work");

  // Advance several turns, resolving any events, and check nothing throws
  for (let i = 0; i < 30; i++) {
    const s = window.UI.getState();
    if (s.activeEvent) {
      const optBtn = doc.querySelector(".option-btn");
      if (optBtn) click(optBtn);
    }
    click(doc.getElementById("turnBtn"));
  }
  assert(window.UI.getState().meta.turn >= 25, "turns advanced via UI (" + window.UI.getState().meta.turn + ")");
  assert(window.UI.getState().resources.stability >= 0 && window.UI.getState().resources.stability <= 100, "stability stayed in range through UI-driven turns");

  // Diplomacy action
  click(doc.querySelector('.nav-btn[data-view="diplomacy"]'));
  const dipBtn = doc.querySelector('[data-faction="heddon"][data-action="share_information"]');
  assert(!!dipBtn, "diplomacy action button present");
  click(dipBtn);

  // Exploration
  click(doc.querySelector('.nav-btn[data-view="explore"]'));
  const exploreBtn = doc.getElementById("exploreBtn");
  if (exploreBtn && !exploreBtn.disabled) click(exploreBtn);

  // Research (give free knowledge then research)
  window.UI.getState().resources.knowledge = 999;
  click(doc.querySelector('.nav-btn[data-view="research"]'));
  const techBtn = doc.querySelector("[data-tech]");
  assert(!!techBtn, "tech button present");
  click(techBtn);
  assert(window.UI.getState().techs.unlocked.length > 0, "a technology was unlocked via UI");

  // Edicts (Governance tab, same view as research/development)
  const edictBtn = doc.querySelector("[data-edict]");
  assert(!!edictBtn, "edict declare/repeal button present on the Governance tab");
  click(edictBtn);
  const anyEdictActive = Object.values(window.UI.getState().edicts).some(e => e && e.active);
  assert(anyEdictActive, "declaring an edict via the UI actually activates it in state");

  // Save, then simulate reload via localStorage
  const saveResult = window.GameEngine.saveGame(window.UI.getState());
  const loaded = window.GameEngine.loadGame();
  if (!loaded.ok) console.error("  saveResult:", JSON.stringify(saveResult), "loaded:", JSON.stringify(loaded));
  assert(loaded.ok, "save/load round trip via UI-produced state works");

  // Menu view + reset flow doesn't throw
  click(doc.querySelector('.nav-btn[data-view="menu"]'));
  assert(doc.getElementById("saveBtn") !== null, "menu save button present");
  click(doc.getElementById("saveBtn"));

  console.log(failed ? "\nSMOKE TEST: FAILURES DETECTED" : "\nSMOKE TEST: ALL CHECKS PASSED");
  fs.writeFileSync(cssPath, originalCss);
  server.close();
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error("SMOKE TEST THREW AN ERROR:");
  console.error(err.stack || err);
  fs.writeFileSync(cssPath, originalCss);
  server.close();
  process.exit(1);
}
})();
