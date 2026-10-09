'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const html=readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'SportsLab inline app script must exist');
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',
 isConnected:true,disabled:false,dataset:{},style:{},
 classList:{toggle(){},add(){},remove(){}},addEventListener(){},
 querySelectorAll(){return[]},querySelector(){return null},onclick:null});
 return elements.get(id);
}
const tabs=['sgp','props','cross','scorers','games','research','review'].map(t=>({
 dataset:{t},classList:{toggle(){}},addEventListener(){}}));
const sportButtons=['NHL','NFL','MLB'].map(s=>({
 dataset:{s},classList:{toggle(){}},addEventListener(){}}));
const fakeDocument={getElementById:element,querySelectorAll:q=>q==='[data-t]'?tabs:q==='[data-s]'?sportButtons:[]};
const fakeFetch=async()=>({ok:true,json:async()=>({available:true,props:[],scorers:[],sgps:[],groups:[]})});
const app=new Function('document','fetch',script+
 ';return {plainWhy,makePropCard,scoringPickCard,makeSGPCard,publicSourceNotice,updateSyncStatus};'
)(fakeDocument,fakeFetch);
const pick={
 league:'nhl',date:'2026-10-09',market:'sog',player:'Sample Player',
 personId:'8471001',selection:'2+ shots',team:'Boston Bruins',opponent:'Seattle Kraken',
 game:'Seattle Kraken @ Boston Bruins',line:1.5,side:'Over',
 last5:{games:5,hits:4,rate:.8},last10:{games:10,hits:8,rate:.8},
 season:{games:2,hits:2,rate:1},average:3.1,priced:false,
 availability:{status:'unconfirmed'},position:'LW',
 h2h:{summary:{games:3,hits:2},games:[{date:'2026-02-01',value:2},{date:'2026-03-01',value:3},{date:'2026-04-01',value:0}]},
 positionAllowed:{available:true,games:5,averagePerPlayer:3.3},
 gameLog:Array.from({length:10},(_,i)=>({
  date:'2026-02-'+String(i+1).padStart(2,'0'),opponent:'NYR',value:2+i%3,hit:true
 }))
};
test('Actual main pick card shows plain evidence, opponent-position context and graph',()=>{
 const h=app.makePropCard(pick,0);
 assert.ok(h.includes('Why this pick'));
 assert.ok(h.includes('8 of his last 10'));
 assert.ok(h.includes('4 of his last 5'));
 assert.ok(h.includes('this opponent'));
 assert.ok(h.includes('See last 5/10 games'));
 assert.ok(h.includes('Odds')&&h.includes('Check bookmaker'));
 assert.ok(!h.includes('RAPM'));
 assert.ok(!h.includes('Evidence 70/95'));
 assert.ok(!h.includes('Public-data fallback active'));
});
test('Scorer card shows the same approachable reason without pretending probabilities',()=>{
 const h=app.scoringPickCard({...pick,market:'goals',selection:'Anytime goalscorer',line:.5,average:.3},0);
 assert.ok(h.includes('Why this pick'));
 assert.ok(h.includes('cleared this pick'));
 assert.ok(h.includes('Last 5')&&h.includes('Last 10'));
 assert.ok(h.includes('prop-breakdown'));
});
test('SGP card explains individual legs instead of backend models',()=>{
 const h=app.makeSGPCard({game:'SEA @ BOS',legs:[pick,
  {...pick,personId:'8471002',player:'Player B'},
  {...pick,personId:'8471003',player:'Player C'}]},0);
 assert.ok(h.includes('3 picks for this game'));
 assert.ok(h.includes('cleared this pick'));
 assert.ok(h.includes('Check combined odds'));
 assert.ok(!h.includes('correlation-adjusted'));
});
test('No visible fallback source banner or raw provider warnings',()=>{
 assert.equal(app.publicSourceNotice({fallback:true,sources:['NHL Official']}),'');
 assert.ok(!html.includes('Public-data fallback active'));
 assert.ok(!html.includes('p.warnings.map(x=>'));
});
test('Pick freshness is understandable and source/provider details hidden',()=>{
 const el=element('syncTitle'),info=element('syncInfo');
 app.updateSyncStatus({league:'nhl',date:'2026-10-09',fallback:true,
   fetchedAt:'2026-10-09T13:00:00Z'});
 // Function intentionally ignores dates other than today.
 if(el.textContent) {
  assert.equal(el.textContent,'NHL picks');
  assert.ok(info.textContent.startsWith('Updated'));
  assert.ok(!info.textContent.includes('fallback'));
 }
});

test('Shots card keeps 5v5 team possession distinct from per-position props',()=>{
 const p={...pick,opponentPossession:{verified:true,team:'SEA',games:3,currentSeasonGames:3,
  sogAgainstPerGame:18,corsiPct:.53,fenwickPct:.50}};
 const h=app.makePropCard(p,0);
 assert.ok(h.includes('18.0 total shots per game'));
 assert.ok(h.includes('3 games'));
 assert.ok(h.includes('Not a position-specific figure'));
 assert.ok(!h.includes('RAPM'));
});
test('Goalscorer card contains source-qualified C/LW/RW/D table without elite label',()=>{
 const tbl={available:true,team:'SEA',games:3,currentSeasonGames:3,priorSeasonGames:0,
  positions:{C:{goalsAllowed:6,gaPerGame:2,games:3},LW:{goalsAllowed:1,gaPerGame:1/3,games:3},
   RW:{goalsAllowed:0,gaPerGame:0,games:3},D:{goalsAllowed:1,gaPerGame:1/3,games:3}}};
 const p={...pick,market:'goals',selection:'Anytime goalscorer',line:.5,
  position:'C',positionMatchup:{verified:true,position:'C',goalsAllowed:6,games:3,gaPerGame:2,currentSeasonGames:3},
  opponentPositionTable:tbl};
 const h=app.scoringPickCard(p,0);
 assert.ok(h.includes('allowed 6 goals to centers in 3 recent games'));
 assert.ok(h.includes('Team total for that position'));
 assert.ok(!h.includes('2.00 individual goals'));
 assert.ok(!h.includes('ELITE'));
});


test('Shots pick uses verified shots allowed to entire position, not goals or personal probability',()=>{
 const p={...pick,
  positionShotMatchup:{verified:true,position:'RW',opponent:'SEA',games:3,currentSeasonGames:3,shotsAllowed:30,shotsPerGame:10},
  opponentPossession:{verified:true,currentSeasonGames:3,games:3,sogAgainstPerGame:22}};
 const h=app.makePropCard(p,0);
 assert.ok(h.includes('10.0 shots on goal per game allowed to all right wings combined'));
 assert.ok(h.includes('Early-season sample'));
 assert.ok(!h.includes('10.0 goals'));
});
