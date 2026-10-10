'use strict';
// Public NBA research adapter. Uses published NBA/ESPN game data, never odds or inferred starters.
// Game-log-only research is deliberately fail-closed if source shapes or season type differ.
const C=require('./free-core');
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const LOG='https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/';
const seasonYear=date=>Number(date.slice(0,4))+(Number(date.slice(5,7))>=8?1:0);
const safeArray=x=>Array.isArray(x)?x:[];
const values=['PTS','REB','AST','3PM','3PT','3PTM','MIN','FG3M'];
function statValue(record,aliases){
 for(const key of aliases){const n=C.numeric(record[key]);if(n!==null)return n}
 return null;
}
function parseMinutes(v){
 if(typeof v==='string'&&/^\d{1,3}:\d\d$/.test(v)){const [m,s]=v.split(':').map(Number);return m+s/60}
 return C.numeric(v);
}
function parseLog(payload,cutoff){
 const names=safeArray(payload?.labels).map(v=>typeof v==='string'?v:String(v?.abbreviation||v?.name||'').toUpperCase());
 const events=payload?.events&&typeof payload.events==='object'?payload.events:{};
 const entries=[];
 for(const st of safeArray(payload?.seasonTypes)){
  const label=String(st?.displayName||st?.name||st?.type?.displayName||st?.type?.name||'').toLowerCase();
  const id=String(st?.id||st?.type?.id||'');
  // A preseason or playoff result must never be mixed into regular-season hit rates.
  if(!/regular/.test(label)&&id!=='2')continue;
  for(const category of safeArray(st?.categories)){
   if(String(category.type||'').toLowerCase()==='total')continue;
   for(const event of safeArray(category.events)){
    const id=String(event?.eventId||'');const meta=events[id]||{};
    const date=String(meta.gameDate||meta.date||event.gameDate||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>=cutoff||!Array.isArray(event.stats))continue;
    const row=Object.fromEntries(names.map((label,i)=>[label,event.stats[i]]));
    const played=parseMinutes(row.MIN);
    if(played===null||played<=0)continue;
    const opponent=String(meta.opponent?.displayName||meta.opponent?.abbreviation||meta.opponent||'');
    entries.push({date,gameId:id,opponent,minutes:played,points:statValue(row,['PTS']),rebounds:statValue(row,['REB']),assists:statValue(row,['AST']),threes:statValue(row,['3PM','3PTM','FG3M']),team:meta.team?.displayName||''});
   }
  }
 }
 return [...new Map(entries.map(x=>[x.gameId,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function playerCandidates(roster){
 const raw=safeArray(roster?.athletes).flatMap(x=>Array.isArray(x.items)?x.items:[x]);
 const seen=new Set();
 return raw.filter(x=>{
  const id=String(x?.id||'');if(!/^\d+$/.test(id)||seen.has(id)||!x.displayName)return false;
  seen.add(id);return true;
 }).slice(0,8);
}
async function run(date){
 const warnings=[],sources=['ESPN public NBA regular-season schedule','ESPN public team rosters','ESPN public NBA regular-season player game logs'];
 const schedule=await C.getJSON(BASE+'/scoreboard?dates='+date.replace(/-/g,'')+'&limit=100',7000);
 const games=safeArray(schedule.events).filter(e=>{
  const type=Number(e?.season?.type??e?.season?.type?.id);
  return type===2&&e?.id&&e?.competitions?.[0]?.competitors?.length===2
   &&Date.parse(e.date)>Date.now()+60000;
 }).slice(0,7);
 if(!games.length)return{league:'nba',entries:[],games:0,playersMatched:0,sources,warnings:['No upcoming verified NBA regular-season games remain for '+date+'. Preseason games are excluded from the prop model.']};
 const refs=[];
 for(const g of games){
  const teams=g.competitions[0].competitors;
  for(const side of teams){
   const opp=teams.find(x=>x!==side),team=side.team||{},opponent=opp?.team||{};
   if(!team.id||!opponent.id)continue;
   refs.push({teamId:String(team.id),team:team.displayName||team.name||'',opponent:opponent.displayName||opponent.name||'',
    opponentId:String(opponent.id),gameId:String(g.id),game:(teams.find(x=>x.homeAway==='away')?.team?.displayName||'Away')+' @ '+(teams.find(x=>x.homeAway==='home')?.team?.displayName||'Home')});
  }
 }
 const rosterResults=await C.pool(refs,5,async team=>{
  const roster=await C.getJSON(BASE+'/teams/'+team.teamId+'/roster',6500);
  return playerCandidates(roster).map(p=>({...team,personId:p.id,player:p.displayName,position:p.position?.abbreviation||null}));
 });
 const candidates=rosterResults.filter(x=>x.ok).flatMap(x=>x.value).slice(0,56);
 if(rosterResults.some(x=>!x.ok))warnings.push('Some NBA rosters were unavailable and their players were excluded.');
 const season=seasonYear(date);
 const collected=await C.pool(candidates,8,async p=>{
  const get=year=>C.getJSON(LOG+p.personId+'/gamelog?season='+year,6800);
  const now=await get(season);
  let logs=parseLog(now,date);
  if(logs.length<10){try{logs=[...parseLog(await get(season-1),date),...logs]}catch(e){/* no fabricated prior games */}}
  return {...p,logs:[...new Map(logs.map(x=>[x.gameId,x])).values()].sort((a,b)=>a.date.localeCompare(b.date))};
 });
 const entries=[];
 const metrics=[
  ['points',14.5,'15+ points',['points']],['rebounds',4.5,'5+ rebounds',['rebounds']],
  ['assists',3.5,'4+ assists',['assists']],['threes',1.5,'2+ made threes',['threes']]
 ];
 for(const result of collected){
  if(!result.ok)continue;
  const p=result.value,previous=p.logs.slice(-10),mins=previous.map(x=>x.minutes).filter(Number.isFinite);
  const minutes=mins.length?mins.reduce((a,b)=>a+b,0)/mins.length:0;
  if(previous.length<5||minutes<20)continue;
  const common={league:'nba',date,player:p.player,personId:p.personId,team:p.team,teamId:p.teamId,
   opponent:p.opponent,opponentId:p.opponentId,position:p.position,game:p.game,gameId:p.gameId,
   gameKey:p.gameId,source:'ESPN public NBA regular-season player game logs',verifiedGame:true,
   lineupStatus:'NBA roster-listed; game-day availability and minutes not confirmed'};
  const picks=metrics.map(([market,line,selection,[key]])=>{
   const rows=p.logs.filter(x=>x[key]!==null).map(x=>({date:x.date,value:x[key],opponent:x.opponent,opponentId:null}));
   const pick=C.makePick({...common,market,line,selection,logs:rows});
   pick.usage={verified:true,source:'Observed NBA game logs',last10MinutesAverage:Math.round(minutes*10)/10,games:mins.length};
   return pick;
  }).filter(x=>x.last10.games>=5&&x.last10.rate>=.55);
  picks.sort((a,b)=>b.evidenceScore-a.evidenceScore||b.last10.games-a.last10.games);
  if(picks[0])entries.push(picks[0]);
  for(const market of ['points','threes']){
   const scoring=picks.find(x=>x.market===market);
   if(scoring)entries.push({...scoring,group:market});
  }
 }
 if(!entries.length)warnings.push('No NBA players met verified game-log and recent-minutes screening thresholds. No picks were fabricated.');
 warnings.push('Historical thresholds are research screens, NOT quoted sportsbook lines. NBA pregame starters, injuries and current odds are not verified.');
 return{league:'nba',entries,warnings,sources,games:games.length,playersMatched:collected.filter(x=>x.ok).length};
}
module.exports={run,parseLog,parseMinutes,playerCandidates,seasonYear};
