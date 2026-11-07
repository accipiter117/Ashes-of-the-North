// Playtest bot: plays whole games the way a sensible player would (build order,
// Auto-Assign, reshuffling gatherers every six months, best-looking event choice)
// and reports how far settlements get. Use it to measure balance changes.
// Usage: node tools/playtest.js [games=20] [months=240]   (TRACE=1 prints game 1 yearly)
const path = require('path');
const E = require(path.join(__dirname, '../js/engine.js'));
const D = require(path.join(__dirname, '../js/data.js'));
const GAMES = +process.argv[2] || 20, TURNS = +process.argv[3] || 240;
const R = s => s.resources;
function cap(s){ return E.capacities(s); }
function count(s, ids){ return s.grid.filter(t => ids.includes(t.building) || (t.constructing && ids.includes(t.constructing.buildingId))).length; }
function freeTile(s, terrain){ return s.grid.find(t => !t.building && !t.constructing && (terrain ? t.terrain===terrain : (t.terrain==='field'||t.terrain==='road'))); }
function tryBuild(s, id){ const b=D.BUILDINGS[id]; const t=freeTile(s, b.requiresTile); if(!t) return false; return E.queueConstruction(s,t.x,t.y,id).ok; }
function tryUpgrade(s, fromIds){ for (const t of s.grid) if (t.building && fromIds.includes(t.building) && !t.constructing) { if (E.queueUpgrade(s,t.x,t.y).ok) return true; } return false; }
function building(s){ return s.grid.filter(t=>t.constructing).length; }
function playTurn(s){
  const pop=E.population(s), c=cap(s);
  // rebalance jobs: keep enough farmers
  if (s.meta.turn % 6 === 0) for (const c of E.livingCitizens(s)) if (['lumberjack','mason','builder','herbalist','farmer','fisherman'].includes(c.job)) E.unassignJob(s,c.id);
  E.autoAssignIdle(s);
  if (building(s) < 2 + Math.floor(pop/30)) {
    const farmers = count(s,['farm','farm2','farm3']);
    const want = [];
    if (c.housing - pop < 4) want.push(['b','house']);
    if (farmers*3 < pop*0.3) want.push(['b','farm']);
    if (!count(s,['dock'])) want.push(['b','dock']);
    if (!count(s,['workshop','workshop2'])) want.push(['b','workshop']);
    if (!count(s,['market','market2','market3'])) want.push(['b','market']);
    if (!count(s,['guardhouse','barracks','trainingyard'])) want.push(['b','guardhouse']);
    if (!count(s,['mine'])) want.push(['b','mine']);
    if (!count(s,['hall'])) want.push(['b','hall']);
    want.push(['u',['shrine']], ['u',['storehouse']]);
    const nr = E.needsReport(s), lv = id => nr.needs.find(n=>n.id===id);
    const short = id => lv(id).active && lv(id).level < 0.85;
    if (short('ale') && count(s,['brewhouse']) < 1 + Math.floor(pop/100)) want.unshift(['b','brewhouse']);
    if (short('furniture') && count(s,['joinery']) < 1 + Math.floor(pop/150)) want.unshift(['b','joinery']);
    if (short('market')) want.unshift(['u',['market','market2']], ['b','market']);
    if (short('faith')) want.unshift(['u',['wayshrine','chapel']], ['b','wayshrine']);
    if (short('health')) want.unshift(['u',['school','library']], ['b','school']);
    if (short('safety')) want.unshift(['u',['guardhouse','barracks']], ['b','guardhouse']);
    if (E.armedFraction(s) < 0.8 || E.toolCoverage(s) < 0.8) { if (!count(s,['workshop','workshop2'])) want.unshift(['b','workshop']); }
    if (!count(s,['school','library','academy'])) want.push(['b','school']);
    if (!count(s,['well'])) want.push(['b','well']);
    want.push(['u',['keep']]);
    if (!count(s,['walls','stonewalls'])) want.push(['b','walls']);
    want.push(['u',['farm','farm2']],['u',['house','house2']],['u',['market','market2']],['u',['guardhouse','barracks']],['u',['workshop']],['u',['school','library']],['u',['chapel']],['u',['watchtower','fortkeep']],['u',['walls']]);
    if (count(s,['dock']) < 3) want.push(['b','dock']);
    for (const [k,id] of want) { if (k==='b' ? tryBuild(s,id) : tryUpgrade(s,id)) break; }
  }
  for (const id in D.TECHS) E.researchTech(s,id);
  if (s.meta.turn % 8 === 4) E.exploreNext(s);
  if (R(s).coin > 30 && s.meta.turn % 3===0) { for (const f of ['brennas','caravan','dwarves','heddon','garrison']) { const r=E.performFactionAction(s,f,'trade_agreement'); if (r.ok) break; } }
  const res = E.advanceTurn(s);
  if (!res.ok && s.activeEvent) {
    // choose best-looking option: avoid combat under 50%, prefer biggest net gain
    const ev = s.activeEvent; let best=-1, bv=-1e9;
    ev.options.forEach((o,i)=>{ let v; if (!E.eventOptionAffordable(s,i)) return;
      if (o.combatCheck) { const p=E.previewCombatChance(s,o.combatCheck); v = p*10 - (1-p)*15; }
      else { v=0; for (const k in (o.effect||{})) if (typeof o.effect[k]==='number' && k!=='faction') v += o.effect[k]*(['stability','reputation','population'].includes(k)?3:1);
        if (o.effect && o.effect.approval) for (const g in o.effect.approval) v += o.effect.approval[g]*0.6;
        for (const k in (o.effect||{})) if (o.effect[k]<0 && D.RESOURCE_INFO[k] && !D.RESOURCE_INFO[k].max && R(s)[k] < -o.effect[k]) v -= 50; }
      if (v>bv){bv=v;best=i;} });
    if (best<0) best=ev.options.findIndex((_,i)=>E.eventOptionAffordable(s,i));
    E.resolveEvent(s,best); E.advanceTurn(s);
  }
}
const stats = { happy:[], minHappy:[], emig:[], petitions:0, stages:{}, endPop:[], minStab:[], starveDeaths:0, deaths:[], hungryMonths:[], coin:[], firstHamlet:[], firstVillage:[], firstTown:[], firstCity:[], battles:[0,0], legacy:[] };
for (let g=0; g<GAMES; g++){
  const s = E.newGame('Bot'); let minStab=100, hungry=0, minH=1, hsum=0, hn=0; const reached={};
  for (let t=0;t<TURNS;t++){
    playTurn(s);
    if (!reached[s.meta.stage]) reached[s.meta.stage]=s.meta.turn;
    minStab=Math.min(minStab,R(s).stability);
    const hh=E.settlementHappiness(s); if (t>12){ minH=Math.min(minH,hh); hsum+=hh; hn++; }
    if (s.activeEvent && /^petition_/.test(s.activeEvent.id)) stats.petitions++;
    if (s.log.length && /went hungry|goes hungry/.test(s.log[s.log.length-1]?.text||s.log[0]?.text||'')) hungry++;
    if (E.population(s)===0) break;
    if (process.env.TRACE && g===0 && t%12===11) console.log(`T${s.meta.turn} ${s.meta.stage} pop=${E.population(s)} house=${cap(s).housing} food=${R(s).food|0} wood=${R(s).wood|0} stone=${R(s).stone|0} iron=${R(s).iron|0} coin=${R(s).coin|0} upk=${E.totalUpkeep(s)} stab=${R(s).stability|0} rep=${R(s).reputation|0} happy=${(E.settlementHappiness(s)*100)|0} ale=${R(s).ale|0} furn=${R(s).furniture|0} tools=${R(s).tools|0} weap=${R(s).weapons|0} grp=${Object.values(s.groups).map(x=>x|0).join('/')} know=${R(s).knowledge|0} bld=${E.builtTiles(s).length} techs=${s.techs.unlocked.length} jobs=${JSON.stringify(E.livingCitizens(s).reduce((a,c)=>(a[c.job||(c.age<12?"child":"idle")]=(a[c.job||(c.age<12?"child":"idle")]||0)+1,a),{}))}`);
  }
  stats.stages[s.meta.stage]=(stats.stages[s.meta.stage]||0)+1;
  stats.happy.push(hsum/Math.max(1,hn)); stats.minHappy.push(minH); stats.emig.push(s.stats.emigrated||0);
  stats.endPop.push(E.population(s)); stats.minStab.push(minStab|0); stats.deaths.push(s.stats.deaths); stats.coin.push(R(s).coin|0);
  stats.battles[0]+=s.stats.battlesWon; stats.battles[1]+=s.stats.battlesLost; stats.legacy.push(E.legacyScore(s));
  for (const k of ['hamlet','village','town','city']) (stats['first'+k[0].toUpperCase()+k.slice(1)]).push(reached[k]??'-');
}
const avg=a=>{const n=a.filter(x=>typeof x==='number'); return n.length? (n.reduce((x,y)=>x+y,0)/n.length).toFixed(1):'-';};
console.log('end stages', stats.stages);
console.log('end pop avg', avg(stats.endPop), 'min', Math.min(...stats.endPop), 'max', Math.max(...stats.endPop));
console.log('min stability avg', avg(stats.minStab), 'deaths avg', avg(stats.deaths), 'end coin avg', avg(stats.coin), 'legacy', avg(stats.legacy));
console.log('turn reached hamlet', avg(stats.firstHamlet), 'village', avg(stats.firstVillage), 'town', avg(stats.firstTown), 'city', avg(stats.firstCity));
console.log('  never town:', stats.firstTown.filter(x=>x==='-').length, 'never city:', stats.firstCity.filter(x=>x==='-').length);
console.log('battles won/lost', stats.battles);
console.log('happiness avg', avg(stats.happy), 'lowest avg', avg(stats.minHappy), 'emigrated avg', avg(stats.emig), 'petitions seen', stats.petitions);
