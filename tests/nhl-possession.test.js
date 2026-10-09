'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../lib/nhl-possession');
const Q=require('../lib/model-quality');
const game=(id,date,home='BOS',away='NYR')=>({
 id,gameDate:date,gameState:'OFF',
 homeTeam:{id:6,abbrev:{default:home}},awayTeam:{id:3,abbrev:{default:away}},
 plays:Array.from({length:78},(_,i)=>({
  typeDescKey:i%8===0?'blocked-shot':i%7===0?'missed-shot':i%9===0?'goal':'shot-on-goal',
  situationCode:i%17===0?'1451':'1551',
  periodDescriptor:{periodType:'REG',number:1+i%3},
  details:{eventOwnerTeamId:i%2===0?6:3,xCoord:80,yCoord:10}
 }))
});
test('NHL blocked-shot owner is defending team; invert to find shooter',()=>{
 const e=P.toEvent({typeDescKey:'blocked-shot',situationCode:'1551',periodDescriptor:{periodType:'REG',number:2},details:{eventOwnerTeamId:6,xCoord:70,yCoord:3}},6,3);
 assert.equal(e.shootingTeamId,3);
 assert.equal(e.innerSlotProxy,true);
});
test('No fake 5v5 shots when strength is 5v4 or overtime',()=>{
 const base={typeDescKey:'shot-on-goal',periodDescriptor:{periodType:'REG',number:1},details:{eventOwnerTeamId:6}};
 assert.equal(P.toEvent({...base,situationCode:'1541'},6,3),null);
 assert.equal(P.toEvent({...base,situationCode:'1551',periodDescriptor:{periodType:'OT',number:4}},6,3),null);
 assert.equal(P.toEvent({...base,situationCode:'1551'},6,3).shootingTeamId,6);
});
test('Corsi/Fenwick include actual blocked shot but Fenwick excludes it',()=>{
 const parsed=P.parseGame(game(2025020001,'2026-04-01'),'2026-10-09');
 assert.equal(parsed.verified,true);
 assert.ok(parsed.home.corsiPct>=0&&parsed.home.corsiPct<=1);
 assert.ok(parsed.home.fenwickFor < parsed.home.attemptsFor);
 assert.equal(parsed.home.attemptsFor+parsed.away.attemptsFor,
              parsed.home.attemptsAgainst+parsed.away.attemptsAgainst);
 assert.ok(parsed.home.innerSlotProxy>0);
 assert.ok(parsed.home.sogFor>=parsed.home.goalsFor);
});
test('Past game final cannot leak into pregame slate for the same date',()=>{
 const parsed=P.parseGame(game(2026020001,'2026-10-09'),'2026-10-09');
 assert.equal(parsed.verified,false);
 assert.ok(P.parseGame({...game(2026020001,'2026-10-08'),gameState:'LIVE'},'2026-10-09').verified===false);
});
test('Team summaries show sample size, prior-year warning, observed PDO, no fictitious RAPM or xG',()=>{
 const games=[P.parseGame(game(2025020001,'2026-04-01'),'2026-10-09'),
              P.parseGame(game(2025020002,'2026-04-03'),'2026-10-09'),
              P.parseGame(game(2026020001,'2026-10-08'),'2026-10-09')];
 const b=P.teamSummary('BOS',games,'2026-10-09');
 assert.equal(b.verified,true);
 assert.equal(b.games,3);
 assert.equal(b.currentSeasonGames,1);
 assert.equal(b.priorSeasonGames,2);
 assert.equal(b.rapm.available,false);
 assert.equal(b.xgFor,null);
 assert.ok(b.warnings.some(s=>s.includes('Previous-season')));
 const n=Q.assessment({league:'nhl',market:'sog',line:1.5,side:'Over',last5:{games:5,rate:.8},last10:{games:10,rate:.7},average:2.6,evidenceScore:75,
 opportunity:{verified:true,stat:'sog',last10Average:2.6},priced:false,opponentPossession:b});
 assert.ok(n.flags.includes('opponent_5v5_early_season_sample'));
 assert.ok(!n.flags.includes('verified_high_volume_5v5_environment'));
});
test('Unknown NHL shooting team or missing coordinates are never fabricated',()=>{
 const p=P.toEvent({typeDescKey:'shot-on-goal',situationCode:'1551',periodDescriptor:{periodType:'REG',number:1},details:{eventOwnerTeamId:333}},6,3);
 assert.equal(p,null);
 const s=P.toEvent({typeDescKey:'missed-shot',situationCode:'1551',periodDescriptor:{periodType:'REG',number:1},details:{eventOwnerTeamId:6}},6,3);
 assert.equal(s.locationKnown,false);assert.equal(s.innerSlotProxy,false);
});
