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

    // real time: the month bar fills, pause stops it, speed cycles, skip moves to the next month
    const fillAt = () => page.evaluate(() => parseFloat(document.getElementById("monthFill").style.width));
    const f1 = await fillAt(); await page.waitForTimeout(1500); const f2 = await fillAt();
    check(f2 > f1, "the month runs on in real time (" + f1 + "% -> " + f2 + "%)");
    await page.click("#pauseBtn"); const p1 = await fillAt(); await page.waitForTimeout(1200); const p2 = await fillAt();
    check(p1 === p2 && (await page.textContent("#pauseBtn")) === "▶", "pause stops the clock");
    await page.click("#pauseBtn");
    await page.click("#speedBtn");
    check((await page.textContent("#speedBtn")) === "2×", "the speed button cycles to 2×");
    await page.click("#speedBtn"); await page.click("#speedBtn");
    const monthBefore = await page.evaluate(() => UI.getState().meta.turn);
    await page.click("#turnBtn");
    await page.waitForTimeout(200);
    const monthAfter = await page.evaluate(() => { const s = UI.getState(); if (s.activeEvent) { document.querySelector(".option-btn:not([disabled])").click(); } return s.meta.turn; });
    check(monthAfter === monthBefore + 1, "skip moves to the next month");

    // an attack shows on the map with a banner, and ends
    await page.evaluate(() => { const s = UI.getState(); s.activeEvent = null; document.getElementById("modalRoot").innerHTML = ""; GameEngine.tileAt(s.grid, 9, 8).building = "granary"; s.resources.food = 80; GameEngine.startBattle(s, { kind: "raider", from: "east", count: 3, mode: "sally", label: "Test raiders" }); });
    await page.waitForTimeout(1500);
    check(/Test raiders/.test(await page.textContent("#battleBanner")) && await page.isVisible("#battleBanner"), "the battle banner shows the attack");
    const ba = await snap(); await page.waitForTimeout(700); const bb = await snap();
    check(ba !== bb, "the battle animates on the map");
    await page.evaluate(() => GameEngine.finishBattleNow(UI.getState()));
    await page.waitForTimeout(400);
    check(await page.isHidden("#battleBanner"), "the banner goes once the battle is over");

    // people really walk about, even with the phone's Reduce Motion setting on
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const page2 = await ctx2.newPage();
    await page2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page2.goto(url);
    await page2.evaluate(() => localStorage.clear());
    await page2.reload();
    await page2.click("#newGameBtn2");
    await page2.evaluate(() => VillageView.setClock(0.35));
    await page2.waitForTimeout(2500);
    const before = await page2.evaluate(() => VillageView.peek());
    await page2.waitForTimeout(3000);
    const after = await page2.evaluate(() => VillageView.peek());
    const moved = after.pawns.filter(q => { const o = before.pawns.find(r => r.id === q.id); return o && Math.hypot(q.x - o.x, q.y - o.y) > 0.5; }).length;
    check(moved >= 8, "with Reduce Motion on, people still walk about (" + moved + " of " + after.pawns.length + " moved in 3s)");
    await page2.waitForTimeout(8000);
    check((await page2.evaluate(() => VillageView.peek().travellers)) > 0, "travellers come along the road by day");
    check(await page2.isHidden(".map-toolbar") && await page2.isVisible("#zoomInBtn"), "no toolbar above the map; zoom floats on it");
    await ctx2.close();

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
