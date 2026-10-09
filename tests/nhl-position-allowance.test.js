'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const POS=require('../lib/nhl-position-allowance');
const box=(id,day='2026-10-01')=>({
 id,gameDate:day,gameState:'OFF',gameType:2,
 homeTeam:{abbrev:{default:'NYR'},score:1},
 awayTeam:{abbrev:{default:'WSH'},score:2},
 playerByGameStats:{
  homeTeam:{forwards:[{playerId:101,position:'C',goals:1},{playerId:102,position:'L',goals:0}],defense:[]},
  awayTeam:{forwards:[{playerId:202,position:'C',goals:1},{playerId:203,position:'R',goals:1}],defense:[]}
 }
});
test('Position C/L/R/D normalize correctly, including defensmen',()=>{
 assert.equal(POS.position('C'),'C');
 assert.equal(POS.position('L'),'LW');
 assert.equal(POS.position('RW'),'RW');
 assert.equal(POS.position('D'),'D');
 assert.equal(POS.position('unknown'),null);
});
test('Exact official final scorer positions are used, never skater roster totals',()=>{
 const p=POS.game(box(2026020001),'2026-10-09');
 assert.equal(p.verified,true);
 assert.deepEqual(p.awayScoring,{C:1,LW:0,RW:1,D:0});
 assert.deepEqual(p.homeScoring,{C:1,LW:0,RW:0,D:0});
});
test('Own goals are excluded: opponent scoring is goals allowed',()=>{
 const games=[1,2,3].map((i)=>POS.game(box(2026020000+i),'2026-10-09'));
 const ny=POS.allowed('NYR',games,'2026-10-09');
 assert.equal(ny.available,true);
 assert.equal(ny.positions.C.goalsAllowed,3);
 assert.equal(ny.positions.C.gaPerGame,1);
 assert.equal(ny.positions.RW.gaPerGame,1);
 assert.equal(ny.positions.LW.gaPerGame,0);
 assert.equal(ny.games,3);
 assert.equal(ny.hasReliableCurrentSeasonSample,false);
});
test('Current-day and unfinished games cannot leak into historical GA/GP',()=>{
 assert.equal(POS.game(box(1,'2026-10-09'),'2026-10-09').verified,false);
 assert.equal(POS.game({...box(2),gameState:'LIVE'},'2026-10-09').verified,false);
});
test('Missing scorer positions or official total mismatch are not treated as data',()=>{
 const x=box(1);
 x.playerByGameStats.awayTeam.forwards[0].position=null;
 assert.equal(POS.game(x,'2026-10-09').verified,false);
 assert.equal(POS.game({...box(2),homeTeam:{...box(2).homeTeam,score:4}},'2026-10-09').verified,false);
});
test('A small three-game GA/GP sample is descriptive and not a verified elite trend',()=>{
 const n=POS.allowed('WSH',[POS.game(box(1),'2026-10-09')],'2026-10-09');
 assert.equal(n.currentSeasonGames,1);
 assert.equal(n.hasReliableCurrentSeasonSample,false);
 assert.equal(n.positions.C.gaPerGame,1);
});


test('SOG allowed by position is a separately verified full-game group total',()=>{
 const b=box(2026021001);
 b.playerByGameStats.homeTeam.forwards[0].sog=3;
 b.playerByGameStats.homeTeam.forwards[1].sog=1;
 b.playerByGameStats.awayTeam.forwards[0].sog=2;
 b.playerByGameStats.awayTeam.forwards[1].sog=4;
 const g=POS.game(b,'2026-10-09');
 assert.equal(g.verified,true);
 assert.equal(g.shotPositionVerified,true);
 const ny=POS.allowed('NYR',[g],'2026-10-09');
 assert.equal(ny.shotAvailable,true);
 assert.equal(ny.shotGames,1);
 assert.equal(ny.shotPositions.RW.shotsAllowed,4);
 assert.equal(ny.shotPositions.C.shotsPerGame,2);
 assert.equal(ny.shotPositions.LW.shotsPerGame,0);
 assert.equal(ny.hasReliableShotSample,false);
 const bad=box(2026021002);
 assert.equal(POS.game(bad,'2026-10-09').shotPositionVerified,false);
 assert.equal(POS.allowed('NYR',[POS.game(bad,'2026-10-09')],'2026-10-09').shotAvailable,false);
});
