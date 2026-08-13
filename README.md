# Ashes of the North

A mobile-first, browser-based settlement strategy game. You are the elder of a small
settlement rebuilding on the frontier of the Northern Kingdoms after a devastating war —
assigning workers, constructing buildings, managing food and resources through the
seasons, negotiating with neighbouring factions, researching developments, sending out
expeditions, and writing your settlement's chronicle across generations.

**This is an original, non-commercial fan project.** It uses no copyrighted text, art,
music, UI, or code from CD Projekt Red. Place names and general setting concepts
(Northern Kingdoms, Temeria, witchers, familiar monster archetypes) are used only for
atmosphere and consistency, in the same way any homage to a fictional world's flavour
works — every line of text, every mechanic, and all artwork (CSS/emoji-based, no image
assets) is original.

## Running it locally

No build step and no server required. From the project folder:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. (You can also just double-click
`index.html`, though some browsers restrict `localStorage` on the `file://` origin —
saving works reliably once served over `http://` or `https://`, including GitHub Pages.)

## Deploying to GitHub Pages

1. Push this folder's contents to a GitHub repository (they can sit at the repo root, or
   in a `/docs` folder if you prefer — just point Pages at the right one).
2. In the repository's **Settings → Pages**, set the source to the branch/folder you used.
3. GitHub will publish it at `https://<your-username>.github.io/<repo-name>/`.

All asset paths are relative (`css/style.css`, `js/*.js`), so it works whether the site
is served from a domain root or a repo subpath. There is no backend, database, or paid
API — everything runs client-side, and progress is saved to the browser's `localStorage`.

## What was built

**Core loop:** observe → assign workers → produce/gather → build → trade/negotiate →
explore → respond to events → survive the season → develop → expand. One turn = one month.

**Systems implemented:**
- 6 worker types / 23 individual jobs, tied to specific buildings where relevant
- 14 building chains (36 individual tiers) across housing, farming, fishing, industry,
  trade, military, governance, faith, knowledge, storage, and the three ruined
  monuments (keep, chapel, storehouse) that can be restored over time
- 5 settlement stages (Refugee Camp → Hamlet → Village → Town → City), driven by
  population and the number of completed buildings
- Full seasonal cycle (Spring/Summer/Autumn/Winter) affecting farming, fishing,
  construction speed, and food consumption, with winter as the central survival pressure
- Named citizen population with ageing, birth, migration, and death (starvation,
  old age, battle); a handful of "notable" founding characters carry traits and a
  personal history log, in line with the brief's request not to over-detail every
  resident
- 8-technology compact development tree across Agriculture, Administration, Military,
  and Knowledge branches
- 10 diplomatic factions (villages, a market town, a merchant guild, a military
  garrison, a local noble house, a religious order, a wandering witcher, a local witch,
  a dwarven enclave, and a bandit company), each with relationship/trust that respond to
  9 diplomatic actions and drift and remember over time
- 20 local/moral-choice events (multi-option, consequence-bearing, not simple
  good/evil binaries) plus 8 distant kingdom-wide bulletins that apply temporary
  settlement-wide modifiers
- 6 monster types and 8 exploration sites, resolved through a formula-driven combat
  system (strength vs. threat, modified by scouts and fortifications) rather than a
  full tactical battlefield — the brief explicitly allows a "robust combat-resolution
  system" where a full tactical layer would risk the stability of the wider build, and
  that trade-off was made deliberately here to keep the whole game reliable
- Passive raid mechanic: factions with poor relationships (bandits especially) can
  raid the settlement, resolved with the same combat system, with real stakes
  (resource loss, stability loss, possible casualties, chronicle entries)
- A written Chronicle recording founding, growth stages, deaths of notable citizens,
  major event outcomes, and battles, plus a separate rolling "recent happenings" feed
- A Legacy score blending population, prosperity, stability, reputation, development,
  and diplomatic standing, visible at any time from the Menu
- Local-storage save/load with New Game / Continue / Save / Reset, and graceful
  handling of missing or corrupted save data (verified by an automated test)
- Mobile-first UI: bottom tab navigation, a persistent scrollable resource bar, a
  fixed one-tap "advance month" control, touch-sized targets throughout, and a
  settlement map you pan horizontally rather than pinch-zoom

## File structure

```
index.html          Page shell — resource bar, view containers, nav, turn button
css/style.css        All styling (dark Northern-frontier theme, mobile-first, no image assets)
js/data.js            Game content: resources, jobs, buildings, tech tree, factions,
                       monsters, exploration sites, events (all original text)
js/engine.js           Pure game-logic module: state, turn simulation, construction,
                       diplomacy, combat, exploration, save/load — no DOM access, so it
                       can be run and tested headlessly in Node
js/ui.js                Renders engine state to the DOM and wires up all interactions
js/main.js               Boot sequence and the new game / continue start screen
test/sim.js               Headless simulation: 5 trials × 240 simulated turns exercising
                          construction, jobs, diplomacy, exploration, research and
                          combat, asserting no NaNs, no out-of-range stats, and a clean
                          save/load round trip (including corrupted-save handling)
test/dom-smoke.js          jsdom-based end-to-end test: serves the real files over HTTP,
                          loads the actual page, and drives it through the browser DOM —
                          new game, every view, building, job assignment, ~30 turns of
                          play with event resolution, diplomacy, exploration, research,
                          and save/load — verifying the built page itself works, not
                          just the underlying logic
```
`test/` and any `node_modules/` are development-only and not required to run or deploy
the game — you can delete them from a production copy if you like a leaner repo.

## Tests performed

- `node test/sim.js` — 1,200 simulated turns across 5 independent trials with randomised
  construction, job assignment, diplomacy, exploration, and research actions. Asserts:
  no `NaN`/non-finite values ever enter resources, population never goes negative, food
  never goes negative, stability and reputation always stay within 0–100, and save/load
  (including intentionally corrupted save data) never throws.
- `node test/dom-smoke.js` — serves the actual `index.html`/CSS/JS over a local HTTP
  server (matching the real deployed origin, which matters for `localStorage`), loads it
  in a real DOM via jsdom, and clicks through: new game creation, every navigation tab,
  selecting a map tile and constructing a building, auto-assigning idle citizens to
  jobs, ~30 turns of play (resolving any events that fire), a diplomacy action, an
  exploration expedition, unlocking a technology, and a save/load round trip. All steps
  pass end-to-end against the real page.
- Manual read-through of every building chain, job, tech, faction action, and event for
  internal consistency (costs deduct correctly, capacities gate assignment, chains only
  upgrade in order).

Both test scripts are safe to delete or re-run at any time; they don't modify the game
files (the smoke test temporarily strips the Google Fonts `@import` so the sandboxed
test run doesn't attempt a live network fetch, and restores the file afterward).

## Known limitations / assumptions made

- **Combat is formula-resolved, not a tactical battlefield.** The brief allows this
  explicitly as a fallback; a full grid-based tactical layer was judged likely to
  jeopardise the reliability of the rest of the build within a single pass, so the
  "robust combat-resolution system" option was taken deliberately.
- **Population beyond ~220 named citizens is capped** at that number rather than
  simulated individually further, to keep the UI and save file manageable at City scale;
  this ceiling comfortably covers the "City" stage threshold (160) with headroom.
- **Google Fonts (Cinzel/Spectral)** are loaded from `fonts.googleapis.com` for
  typography. If served somewhere with no internet access at all, the page still works
  and falls back to Georgia/Times New Roman — only the display type treatment is lost.
- **No sound.** Not requested in the brief and out of scope for a single-pass build.
- **Balance is a first pass.** The economy, growth rates, and raid frequency were tuned
  by running hundreds of simulated turns (see `test/sim.js`) rather than extensive human
  playtesting — expect some numbers may want adjusting once you've actually played a
  full game to City stage.
- **Exploration sites are finite** (8 curated sites) rather than infinite/procedural, in
  keeping with "do not overload the first build."

## Extending it later

Everything content-related lives in `js/data.js` as plain data structures — new
buildings, jobs, tech, factions, monsters, exploration sites, or events can be added
there without touching engine or UI logic, as long as they follow the existing shape.
`js/engine.js` has no DOM dependency, so it can be reused if the UI is ever rebuilt.
