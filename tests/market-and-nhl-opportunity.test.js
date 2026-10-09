'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../lib/market-intelligence');
const N=require('../lib/nhl-opportunity');
const Q=require('../lib/model-quality');
const near=(x,y,tol=1e-9)=>assert.ok(Math.abs(x-y)<tol,x+' should equal '+y);

test('OddsJam math: fair -110/-110 book is 50/50 with vig',()=>{
 const x=M.noVig([-110,-110]);near(x.probabilities[0],.5);near(x.probabilities[1],.5);
 assert.ok(x.overround>.047&&x.overround<.048);near(M.decimal(-110),1+100/110);near(M.implied(190),100/290);
});
test('Market price versus prediction confidence are separate',()=>{
 near(M.edge(.55,-110).roi,.05);
 assert.equal(M.assessValue(-110,{modelProbability:.90,calibrated:false,modelGames:7}).available,false);
 assert.equal(M.assessValue(-110,{modelProbability:.55,calibrated:true,modelGames:100}).available,true);
 const ci=M.wilson(9,10);assert.ok(ci.lower<.7,'9/10 L10 rate is not 90% certain');
});
const scope={eventId:'NHL_2026_WSH_NYR',league:'nhl',market:'spreads',period:'full_game',settlement:'full_game_2way'};
test('The screenshot opposite NHL puck-line quotes are not arbitrage',()=>{
 const a={...scope,subjectId:'WSH',line:-1.5,side:'home',odds:190,book:'DraftKings'},
       b={...scope,subjectId:'NYR',line:1.5,side:'away',odds:-210,book:'FanDuel'};
 const r=M.arbitrage(a,b,100);assert.equal(r.available,false);assert.ok(r.impliedSum>1);
});
test('Real two-price mathematical arbitrage calculation, not risk-free promise',()=>{
 const a={...scope,subjectId:'WSH',line:-1.5,odds:150,book:'DraftKings'},
       b={...scope,subjectId:'NYR',line:1.5,odds:160,book:'FanDuel'};
 const r=M.arbitrage(a,b,100);assert.equal(r.available,true);assert.equal(r.verifiedExecution,false);
 near(r.grossProfit,27.45,.02);
 assert.ok(r.note.includes('NOT risk-free'));
});
test('Mismatched markets, alternate lines and 3-way outcomes fail arb check',()=>{
 const a={...scope,subjectId:'WSH',line:-1.5,odds:150,book:'DraftKings'};
 assert.equal(M.arbitrage(a,{...a,subjectId:'NYR',line:2.5,book:'FanDuel',odds:160}).available,false);
 assert.equal(M.arbitrage(a,{...a,subjectId:'NYR',line:1.5,book:'FanDuel',odds:160,period:'regulation'}).available,false);
 const ml={...scope,market:'h2h',settlement:'regulation_3way',subjectId:'WSH',odds:190};
 assert.equal(M.arbitrage(ml,{...ml,subjectId:'NYR',book:'FanDuel'},100).available,false);
});
test('Price movement must compare same book, same line, ordered timestamps',()=>{
 const a={...scope,subjectId:'WSH',side:'home',line:-1.5,odds:190,book:'DraftKings',at:'2026-10-09T13:00:00Z'};
 const move=M.marketMove(a,{...a,odds:170,at:'2026-10-09T14:00:00Z'});
 assert.equal(move.available,true);assert.ok(move.deltaImpliedPercentagePoints>0);
 assert.equal(M.marketMove(a,{...a,line:-2.5,at:'2026-10-09T14:00:00Z'}).available,false);
});
test('NHL verified TOI excludes incomplete or unreadable games',()=>{
 near(N.toMinutes('16:30'),16.5);assert.equal(N.toMinutes('garbled'),null);
 const rows=Array.from({length:10},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),
    toi:i<5?'18:30':'14:30',shots:3,goals:i%3===0?1:0,assists:i%2===0?1:0,powerPlayPoints:0}));
 const u=N.usageTrend(rows,'2026-10-12');
 assert.equal(u.verified,true);near(u.toiChangeMinutes,-4);assert.equal(u.trend,'less-ice-time');
 assert.ok(u.shotsPer60>10&&u.shotsPer60<12);
 const p={market:'sog',side:'Over',line:1.5,last5:{games:5,hits:5,rate:1},last10:{games:10,hits:9,rate:.9},
    average:3,priced:true,evidenceScore:75,availability:{status:'rostered'},lineupConfirmed:true,opportunity:{verified:true,stat:'sog',last10Average:3},
    usage:{...u,currentSeasonGames:10}};
 const q=Q.assessment(p);
 assert.ok(q.flags.includes('ice_time_recently_declining'));
 const early=Q.assessment({...p,usage:{...u,currentSeasonGames:2}});
 assert.ok(!early.flags.includes('ice_time_recently_declining'),'do not penalize a trend crossing offseason');
});
test('Corsi includes blocks, Fenwick excludes blocks; 5v5 only',()=>{
 const e=[{situation:'5v5',eventType:'goal',shootingTeamId:'A'},{situation:'5v5',eventType:'missed-shot',shootingTeamId:'A'},
 {situation:'5v5',eventType:'blocked-shot',shootingTeamId:'B'},{situation:'4v5',eventType:'goal',shootingTeamId:'B'}];
 const v=N.corsiFenwick(e,['A','B']);assert.equal(v.attempts,3);assert.equal(v.unblockedAttempts,2);
 near(v.teams.A.cfPct,2/3);near(v.teams.A.ffPct,1);
});
test('Fantasy historical scoring does not invent missing tracked categories',()=>{
 const rows=Array.from({length:5},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),goals:1,assists:1,shots:3,powerPlayPoints:0}));
 const missing=N.fantasyHistory(rows,'2026-10-08');
 assert.equal(missing.verified,false);assert.ok(missing.missingStats.includes('blockedShots'));
 const scores=N.fantasyHistory(rows,'2026-10-08',{blockedShots:0,hits:0});
 assert.equal(scores.verified,true);near(scores.averageFantasyPoints,6.2);
});
