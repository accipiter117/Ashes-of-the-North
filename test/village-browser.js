// Real-browser check of the living village (js/village-view.js), which the jsdom
// smoke test can't see because jsdom has no canvas. Needs Playwright with Chromium;
// skips cleanly if it isn't installed.  Run: npm run test:village
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  console.log("Playwright not installed; skipping the village browser check.");
  process.exit(0);
}

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

let failed = false;
function check(cond, msg) { console.log((cond ? "OK: " : "FAIL: ") + msg); if (!cond) failed = true; }

server.listen(0, async () => {
  const url = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && !/fonts\.googleapis|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(url);
    await page.click("#newGameBtn2");
    await page.waitForTimeout(600);

    check(await page.$("#mapGrid.painted #villageCanvas") !== null, "the painted village canvas is on the map");
    check(await page.$$eval(".tile", t => t.length) === 280, "all 280 tiles remain as tap targets");

    // the people move: two frames a second apart differ
    const snap = () => page.evaluate(() => document.getElementById("villageCanvas").toDataURL().length + ":" + document.getElementById("villageCanvas").toDataURL().slice(-200));
    const a = await snap(); await page.waitForTimeout(1000); const b = await snap();
    check(a !== b, "the village animates between frames");

    // time of day drives the clock label
    await page.evaluate(() => VillageView.setClock(0.05));
    await page.waitForTimeout(300);
    check(/Night/.test(await page.textContent("#dayClock")), "the clock reads Night at midnight");
    await page.evaluate(() => VillageView.setClock(0.58));
    await page.waitForTimeout(300);
    check(/Midday/.test(await page.textContent("#dayClock")), "the clock reads Midday meal at noon");

    // tapping a resident names them
    await page.waitForTimeout(6000);
    const spot = await page.evaluate(() => {
      for (let y = 0; y < 14; y += 0.1) for (let x = 0; x < 20; x += 0.1) { const who = VillageView.personAt(x, y); if (who) return { x, y, who }; }
      return null;
    });
    check(!!spot && !!spot.who.name, "a resident can be found by position");

    // zooming keeps the canvas the size of the map
    await page.click("#zoomInBtn");
    await page.waitForTimeout(300);
    const size = await page.evaluate(() => ({ c: document.getElementById("villageCanvas").style.width, g: getComputedStyle(document.querySelector(".tile")).width }));
    check(parseFloat(size.c) === parseFloat(size.g) * 20, "after zooming the canvas still spans the 20-tile map (" + size.c + ")");

    // leaving the map stops the loop; coming back restarts it
    await page.click('.nav-btn[data-view="citizens"]');
    await page.click('.nav-btn[data-view="settlement"]');
    await page.waitForTimeout(400);
    const c = await snap(); await page.waitForTimeout(800); const d = await snap();
    check(c !== d, "the village animates again after returning to the map");

    check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  } catch (e) {
    console.error(e); failed = true;
  } finally {
    await browser.close();
    server.close();
    console.log(failed ? "\nVILLAGE CHECK: FAILURES DETECTED" : "\nVILLAGE CHECK: ALL CHECKS PASSED");
    process.exit(failed ? 1 : 0);
  }
});
