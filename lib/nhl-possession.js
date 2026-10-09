'use strict';
// Official NHL 5v5 event-level possession: Corsi/Fenwick and shot-location
// proxy. Never masquerades as xG, HDCF, or actual fitted RAPM coefficients.
const C=require('./free-core'),H=require('./nhl-opportunity'),POSITION=require('./nhl-position-allowance');
const ROOT='https://api-web.nhle.com/v1',name=C.name;
function toEvent(p,home,away){
 const kind=p?.typeDescKey,code=String(p?.situationCode||''),period=p?.periodDescriptor;
 if(!['goal','shot-on-goal','missed-shot','blocked-shot'].includes(kind)||code!=='1551'||
    period?.periodType!=='REG'||Number(period.number)>3)return null;
 const owner=Number(p.details?.eventOwnerTeamId);
 if(owner!==home&&owner!==away)return null;
 // Blocked-shot event owner is the blocker; shooting team is its opponent.
 const shooter=kind==='blocked-shot'?(owner===home?away:home):owner;
 const x=C.numeric(p.details?.xCoord),y=C.numeric(p.details?.yCoord);
 return{eventType:kind,situation:'5v5',shootingTeamId:shooter,
  locationKnown:x!==null&&y!==null,innerSlotProxy:x!==null&&y!==null&&Math.abs(x)>=69&&Math.abs(y)<=20};
}
function parseGame(p,date){
 const home=Number(p?.homeTeam?.id),away=Number(p?.awayTeam?.id);
 if(!p?.id||!Number.isInteger(home)||!Number.isInteger(away)||home===away||
    !Array.isArray(p.plays)||!['OFF','FINAL'].includes(String(p.gameState||''))||
    !/^20\d\d-\d\d-\d\d$/.test(String(p.gameDate||'').slice(0,10))||
    String(p.gameDate||'').slice(0,10)>=date)return{verified:false,reason:'Not a complete earlier NHL game with official PBP'};
 const mapped=p.plays.map(x=>toEvent(x,home,away)).filter(Boolean);
 if(mapped.length<35)return{verified:false,reason:'Too few verified 5v5 attempts'};
 const metric=H.corsiFenwick(mapped,[home,away]);
 if(!metric.verified)return{verified:false,reason:'Unable to attribute official shot attempts'};
 const add=id=>{
   const a=metric.teams[id],other=metric.teams[id===home?away:home],
     own=mapped.filter(x=>x.shootingTeamId===id),opp=mapped.filter(x=>x.shootingTeamId!==id);
   return{attemptsFor:a.corsiFor,attemptsAgainst:other.corsiFor,fenwickFor:a.fenwickFor,
    fenwickAgainst:other.fenwickFor,sogFor:a.shotsOnGoalFor,sogAgainst:other.shotsOnGoalFor,
    goalsFor:own.filter(x=>x.eventType==='goal').length,goalsAgainst:opp.filter(x=>x.eventType==='goal').length,
    innerSlotProxy:own.filter(x=>x.innerSlotProxy).length,shotLocationCoverage:own.filter(x=>x.locationKnown).length,
    corsiPct:a.cfPct,fenwickPct:a.ffPct};
 };
 return{verified:true,id:String(p.id),date:String(p.gameDate).slice(0,10),homeId:home,awayId:away,
   homeAbbr:name(p.homeTeam?.abbrev).toUpperCase(),awayAbbr:name(p.awayTeam?.abbrev).toUpperCase(),
   home:add(home),away:add(away),source:'NHL official gamecenter 5v5 play-by-play'};
}
function teamSummary(team,all,date){
 const games=all.filter(x=>x.verified&&(x.homeAbbr===team||x.awayAbbr===team))
   .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
 if(!games.length)return{verified:false,team,reason:'No verified official 5v5 games'};
 const rows=games.map(g=>({date:g.date,id:g.id,...(g.homeAbbr===team?g.home:g.away)}));
 const sum=k=>rows.reduce((a,x)=>a+x[k],0);
 const n=rows.length,cf=sum('attemptsFor'),ca=sum('attemptsAgainst'),
   ff=sum('fenwickFor'),fa=sum('fenwickAgainst'),sf=sum('sogFor'),sa=sum('sogAgainst'),
   gf=sum('goalsFor'),ga=sum('goalsAgainst'),yr=Number(date.slice(0,4))-
   (Number(date.slice(5,7))<9?1:0);
 const current=rows.filter(x=>x.date>=yr+'-09-01').length;
 return{verified:true,source:'NHL official 5v5 PBP',team,games:n,currentSeasonGames:current,
  priorSeasonGames:n-current,lastGameDate:rows[0].date,corsiPct:cf+ca?cf/(cf+ca):null,
  fenwickPct:ff+fa?ff/(ff+fa):null,attemptsForPerGame:cf/n,attemptsAgainstPerGame:ca/n,
  sogForPerGame:sf/n,sogAgainstPerGame:sa/n,goalsForPerGame:gf/n,goalsAgainstPerGame:ga/n,
  pdo:sf>=12&&sa>=12?100*(gf/sf+1-ga/sa):null,
  innerSlotLocationProxyPerGame:sum('innerSlotProxy')/n,
  shotLocationCoverage:cf?sum('shotLocationCoverage')/cf:null,
  xgFor:null,xgAgainst:null,gsae:null,
  rapm:{available:false,reason:'No validated historical on-ice stint coefficients installed'},
  warnings:[...(current<3?['Previous-season games included; changed rosters/goalies reduce relevance.']:[]),
    'Slot count is an uncalibrated shot-location proxy, not official xG/HDCF.',
    'PDO is retrospective only and cannot establish an automatic regression bet.'],
  gameSamples:rows.map(x=>({date:x.date,id:x.id,cfPct:x.corsiPct,ffPct:x.fenwickPct,sogFor:x.sogFor,sogAgainst:x.sogAgainst}))};
}
async function schedule(team,date,current,prior){
 const result=await Promise.allSettled([current,prior].map(season=>
  C.getJSON(ROOT+'/club-schedule-season/'+encodeURIComponent(team)+'/'+season,6500)));
 const games=new Map();
 for(const r of result){if(r.status!=='fulfilled')continue;
  for(const g of r.value.games||[]){
   if(!g.id||g.gameType!==2||!['OFF','FINAL'].includes(g.gameState)||
      !g.gameDate||String(g.gameDate)>=date)continue;
   games.set(String(g.id),{id:String(g.id),date:String(g.gameDate)});
  }
 }
 return[...games.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
}
async function collect(teams,date){
 const unique=[...new Set((teams||[]).filter(Boolean))],year=Number(date.slice(0,4)),
   season=year-(Number(date.slice(5,7))<9?1:0),cur=''+season+(season+1),prior=''+(season-1)+season,
   warnings=[],byGame=new Map();
 const schedules=await C.pool(unique,5,async team=>schedule(team,date,cur,prior)),byTeam=new Map();
 schedules.forEach((r,i)=>{if(!r.ok){warnings.push('Missing NHL schedule for '+unique[i]);return}
  byTeam.set(unique[i],r.value);
  for(const g of r.value)byGame.set(g.id,g)});
 // Sample every slate team fairly, max 18 prior-game PBPs; no extra endpoint.
 const selected=new Map();
 for(let round=0;round<3&&selected.size<18;round++){
  for(const team of unique){
   const match=byTeam.get(team)?.[round];
   if(match&&selected.size<18)selected.set(match.id,match);
  }
 }
 const games=[...selected.values()].sort((a,b)=>b.date.localeCompare(a.date)),
   loaded=await C.pool(games,6,async g=>parseGame(
     await C.getJSON(ROOT+'/gamecenter/'+g.id+'/play-by-play',8000),date)),
   valid=loaded.filter(x=>x.ok&&x.value.verified).map(x=>x.value);
 // Full-game position allowance is a separate official BOX SCORE measure, not
 // possession / 5v5; a scorer must have verified C/LW/RW/D position.
 const scored=await C.pool(games,6,async g=>POSITION.game(
   await C.getJSON(ROOT+'/gamecenter/'+g.id+'/boxscore',7000),date));
 const validScoring=scored.filter(x=>x.ok&&x.value.verified).map(x=>x.value);
 if(valid.length<games.length)warnings.push((games.length-valid.length)+' official past game(s) lacked verifiable 5v5 shot data.');
 return{teams:Object.fromEntries(unique.map(t=>[t,teamSummary(t,valid,date)])),
   positionAllowed:Object.fromEntries(unique.map(t=>[t,POSITION.allowed(t,validScoring,date)])),
   warnings,source:'NHL official schedules, 5v5 PBP and full-game scorer box scores',
   gamesRequested:games.length,gamesVerified:valid.length,boxscoresVerified:validScoring.length};
}
module.exports={toEvent,parseGame,teamSummary,schedule,collect};
