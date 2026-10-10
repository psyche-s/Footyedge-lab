'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const nba=require('../lib/free-nba');
const core=require('../lib/free-core');

const sample=(count=10)=>{
 const events={}, rows=[];
 for(let i=0;i<count;i++){
  const id=String(70000+i),date='2030-10-'+String(10+i).padStart(2,'0');
  events[id]={gameDate:date,opponent:{abbreviation:'BOS'}};
  rows.push({eventId:id,stats:['32:30','22','7','6','2']});
 }
 return{labels:['MIN','PTS','REB','AST','3PM'],events,
  seasonTypes:[{displayName:'Preseason',categories:[{type:'game',events:[{eventId:'6000',stats:['33','50','10','5','4']}]}]},
   {displayName:'Regular Season',categories:[{type:'game',events:rows}]}]};
};

test('NBA game logs include verified regular season only, with accurate minutes',()=>{
 const log=nba.parseLog(sample(), '2030-11-01');
 assert.equal(log.length,10);
 assert.equal(log[0].minutes,32.5);
 assert.equal(log[0].threes,2);
 assert.equal(log[0].opponent,'BOS');
 assert.equal(nba.seasonYear('2030-11-01'),2031);
 assert.equal(nba.seasonYear('2031-02-01'),2031);
});
test('NBA short and malformed logs are not treated as complete samples',()=>{
 assert.deepEqual(nba.parseLog({labels:['PTS'],seasonTypes:[{displayName:'Preseason',categories:[]}]},'2030-11-01'),[]);
 assert.equal(nba.parseMinutes('31:15'),31.25);
 assert.equal(nba.parseMinutes('DNP'),null);
});
test('NBA full pipeline never creates sportsbook odds or assumed starter status',async t=>{
 const original=global.fetch;
 t.after(()=>{global.fetch=original});
 global.fetch=async url=>{
  const u=String(url);
  let value;
  if(u.includes('/scoreboard?'))value={events:[{id:'99991',date:'2030-11-01T23:00:00Z',season:{type:2},competitions:[{competitors:[
   {homeAway:'home',team:{id:'1',displayName:'Boston Celtics'}},
   {homeAway:'away',team:{id:'2',displayName:'New York Knicks'}}
  ]}]}]};
  else if(u.endsWith('/teams/1/roster'))value={athletes:[{id:'101',displayName:'Example Center',position:{abbreviation:'C'}}]};
  else if(u.endsWith('/teams/2/roster'))value={athletes:[{id:'102',displayName:'Example Guard',position:{abbreviation:'PG'}}]};
  else if(u.includes('/gamelog?'))value=sample();
  else throw Error('Unexpected URL '+u);
  return{ok:true,json:async()=>value};
 };
 const board=await nba.run('2030-11-01');
 assert.equal(board.games,1);
 assert.equal(board.playersMatched,2);
 assert.ok(board.entries.length>0);
 assert.ok(board.entries.every(x=>x.priced===false&&x.book===null&&x.lineupConfirmed===false));
 const ranked=core.rankedBoard('nba','2030-11-01',board.entries,board.warnings,board.sources);
 assert.ok(ranked.available);
 assert.ok(ranked.props.length>0);
 assert.ok(ranked.props.every(x=>x.price===null));
 const scorers=core.scoringBoard('nba','2030-11-01',board.entries,board.warnings,board.sources);
 assert.deepEqual(scorers.groups.map(g=>g.key),['points','threes']);
});
test('NBA preseason slate is excluded without querying rosters',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original});
 let calls=0;
 global.fetch=async()=>{calls++;return{ok:true,json:async()=>({events:[{id:'9',season:{type:1},date:'2030-11-01T23:00:00Z',competitions:[{competitors:[{team:{id:1}},{team:{id:2}}]}]}]})}};
 const p=await nba.run('2030-11-01');
 assert.equal(p.entries.length,0);
 assert.equal(p.games,0);
 assert.equal(calls,1);
});
