'use strict';
/**
 * NHL full-game Goals Allowed by Opposing Scorer Position (GA/GP).
 * Official boxscore counts goals for credited scorer C/LW/RW/D, never inferred
 * from the number of opposing skaters, lineup slot, or opponent market odds.
 */
const C=require('./free-core');
const POS=['C','LW','RW','D'];
function position(p){
 const x=String(p||'').toUpperCase();
 return({C:'C',CENTER:'C',L:'LW',LW:'LW',LEFTWING:'LW',R:'RW',RW:'RW',RIGHTWING:'RW',D:'D',DEFENSE:'D',DEFENCEMAN:'D',DEFENSEMAN:'D'})[x.replace(/[^A-Z]/g,'')]||null;
}
function rows(side){
 const g=side||{};
 return [...(g.forwards||[]).map(x=>({...x,group:'F'})),...(g.defense||[]).map(x=>({...x,group:'D'}))];
}
function game(box,asOf){
 if(!box?.id||!box.playerByGameStats||!['OFF','FINAL'].includes(String(box.gameState||''))||
   !box.gameDate||String(box.gameDate).slice(0,10)>=asOf)
   return{verified:false,reason:'Official prior final and full player box score required'};
 const home=box.homeTeam||{},away=box.awayTeam||{};
 const ab=x=>C.name(x.abbrev).toUpperCase(),homeAbbrev=ab(home),awayAbbrev=ab(away);
 if(!homeAbbrev||!awayAbbrev||homeAbbrev===awayAbbrev)
   return{verified:false,reason:'Game home/away team abbreviations not resolved'};
 const bySide={},missing=[];
 for(const key of ['homeTeam','awayTeam']){
  const skaters=rows(box.playerByGameStats[key]);
  if(!skaters.length)return{verified:false,reason:'Missing full-game NHL skater boxscore for '+key};
  const count=Object.fromEntries(POS.map(pos=>[pos,0]));
  let credited=0,unknown=0;
  for(const p of skaters){
   const goals=C.numeric(p.goals),pos=position(p.position||p.positionCode||(p.group==='D'?'D':null));
   if(goals===null)continue;
   if(goals<0||!Number.isInteger(goals))return{verified:false,reason:'Invalid NHL official goal count'};
   if(!goals)continue;
   if(!pos){unknown+=goals;continue}
   count[pos]+=goals;credited+=goals;
  }
  if(unknown)missing.push(key+': '+unknown+' scorer goal(s) had no verified position');
  bySide[key]={goalsByPosition:count,credited,unknown,total:credited+unknown};
 }
 if(missing.length)return{verified:false,reason:missing.join('; ')};
 const officialGoals=x=>C.numeric(x.score),homeScore=officialGoals(home),awayScore=officialGoals(away);
 const isSO=String(box.gameOutcome?.lastPeriodType||'').toUpperCase()==='SO';
 if(homeScore!==null&&awayScore!==null){
  const compatible=(actual,official)=>actual===official||(isSO&&actual+1===official);
  if(!compatible(bySide.homeTeam.total,homeScore)||!compatible(bySide.awayTeam.total,awayScore))
   return{verified:false,reason:'Player goal totals inconsistent with NHL final score'};
 }
 return{verified:true,gameId:String(box.id),date:String(box.gameDate).slice(0,10),
  homeAbbrev,awayAbbrev,homeScoring:bySide.homeTeam.goalsByPosition,
  awayScoring:bySide.awayTeam.goalsByPosition,
  source:'Official NHL final full-game player box score',
  caveat:'Full-game scoring by actual scorer roster position, including PP/SH/OT; not a 5v5 metric'};
}
function allowed(team,games,date){
 const eligible=(games||[]).filter(g=>g?.verified&&(g.homeAbbrev===team||g.awayAbbrev===team))
   .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
 const n=eligible.length;
 if(!n)return{available:false,team,reason:'No verified previous games with scorer position attribution'};
 const season=Number(date.slice(0,4))-(Number(date.slice(5,7))<9?1:0);
 const counts=Object.fromEntries(POS.map(pos=>[pos,0]));
 for(const g of eligible){
  const incoming=g.homeAbbrev===team?g.awayScoring:g.homeScoring;
  for(const p of POS)counts[p]+=incoming[p]||0;
 }
 const current=eligible.filter(g=>g.date>=season+'-09-01').length,
  positions=Object.fromEntries(POS.map(p=>[p,{goalsAllowed:counts[p],games:n,gaPerGame:counts[p]/n}]));
 return{available:true,source:'NHL official gamecenter final boxscores',team,games:n,
  currentSeasonGames:current,priorSeasonGames:n-current,
  positions,hasReliableCurrentSeasonSample:current>=5,
  note:'Observed total opposing goals per game by scorer position; NOT xG and not a guaranteed scorer probability. Small samples are not reliable to rank individual players.',
  samples:eligible.map(g=>({date:g.date,gameId:g.gameId,against:g.homeAbbrev===team?g.awayAbbrev:g.homeAbbrev,
    positions:g.homeAbbrev===team?g.awayScoring:g.homeScoring}))};
}
module.exports={position,game,allowed};
