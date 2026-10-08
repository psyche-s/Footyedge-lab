'use strict';
const C=require('./free-core'),BASE='https://statsapi.mlb.com/api/v1';
const playerLog=(data,key)=>(data.stats||[]).flatMap(a=>a.splits||[]).filter(a=>a.date&&a.stat&&a.stat[key]!=null).map(a=>({date:String(a.date),opponent:a.opponent?.name||null,opponentId:a.opponent?.id||null,value:key==='inningsPitched'?outs(a.stat[key]):C.numeric(a.stat[key])})).filter(a=>a.value!=null);
function outs(x){if(x==null)return null;const m=String(x).match(/^(\d+)\.([012])$/);return m?Number(m[1])*3+Number(m[2]):/^\d+$/.test(String(x))?Number(x)*3:null}
async function run(date){
 const year=Number(date.slice(0,4)),warnings=[],sources=['MLB StatsAPI official schedule and probable pitchers','MLB box score batting orders','MLB regular-season game logs'];
 const calendar=await C.getJSON(BASE+'/schedule?sportId=1&date='+date+'&hydrate=probablePitcher',7500);
 const games=(calendar.dates||[]).flatMap(x=>x.games||[]).filter(g=>g.gamePk&&g.teams&&g.gameType!=='S'&&Date.parse(g.gameDate)>Date.now()+60000).slice(0,8);
 if(!games.length)return{league:'mlb',entries:[],warnings:['No upcoming MLB games remain for '+date],sources};
 const teams=await C.pool(games,4,async g=>{
  const home=g.teams.home,away=g.teams.away,homeName=home.team?.name||'Home',awayName=away.team?.name||'Away',meta={id:String(g.gamePk),homeName,awayName};
  const players=[];
  for(const [slot,t,other,team,opponent] of [['home',home,away,homeName,awayName],['away',away,home,awayName,homeName]]){
    if(t.probablePitcher?.id)players.push({type:'pitcher',id:t.probablePitcher.id,name:t.probablePitcher.fullName,team,opponent,opponentId:other.team?.id,teamId:t.team?.id,meta});
  }
  try{
   const box=await C.getJSON(BASE+'/game/'+g.gamePk+'/boxscore',7000);
   for(const [slot,t,other,team,opponent] of [['home',box.teams?.home,away,homeName,awayName],['away',box.teams?.away,home,awayName,homeName]]){
    const order=(t?.battingOrder||[]).map(Number).filter(x=>Number.isInteger(x)&&x>0);
    if(order.length<9)continue;
    for(const id of order.slice(0,6)){
     const name=t.players?.['ID'+id]?.person?.fullName;
     if(name)players.push({type:'batter',id,name,team,opponent,opponentId:other.team?.id,teamId:t.team?.id,meta});
    }
   }
  }catch(e){/* Unconfirmed batting orders are never guessed. */}
  return players;
 });
 const people=teams.filter(x=>x.ok).flatMap(x=>x.value).slice(0,35);
 if(teams.some(x=>!x.ok))warnings.push('Some scheduled MLB team information was unavailable.');
 if(!people.some(p=>p.type==='batter'))warnings.push('No official batting orders are confirmed; home-run candidates are withheld.');
 const checked=await C.pool(people,7,async p=>{
  const group=p.type==='pitcher'?'pitching':'hitting';
  const link=y=>BASE+'/people/'+p.id+'/stats?stats=gameLog&season='+y+'&group='+group;
  const current=await C.getJSON(link(year),7500);
  let previous={stats:[]};
  if((current.stats||[]).flatMap(x=>x.splits||[]).length<10)try{previous=await C.getJSON(link(year-1),6500)}catch(e){}
  return{...p,current,previous};
 });
 const entries=[];
 for(const row of checked){
  if(!row.ok)continue;
  const p=row.value,meta=p.meta,common={league:'mlb',date,personId:p.id,player:p.name,team:p.team,teamId:p.teamId,opponent:p.opponent,opponentId:p.opponentId,game:meta.awayName+' @ '+meta.homeName,gameId:meta.id,gameKey:meta.id,position:p.type==='pitcher'?'P':null,lineupStatus:p.type==='pitcher'?'Official probable starter; appearance not confirmed':'Official box-score batting order present',source:'MLB public regular-season game logs',verifiedGame:true};
  const hist=k=>[...playerLog(p.previous,k),...playerLog(p.current,k)];
  if(p.type==='pitcher'){
   const so=C.makePick({...common,market:'pitching.so',line:4.5,selection:'Over 4.5 pitcher strikeouts',logs:hist('strikeOuts')});
   const po=C.makePick({...common,market:'outs',line:14.5,selection:'15+ pitcher outs',logs:hist('inningsPitched')});
   const choices=[so,po].filter(x=>x.last10.games>=3&&x.last10.rate>=.5).sort((a,b)=>b.evidenceScore-a.evidenceScore);
   if(choices.length)entries.push(choices[0]);
  }else{
   const hit=C.makePick({...common,market:'batting.h',line:.5,selection:'1+ batter hit',logs:hist('hits')});
   if(hit.last10.games>=3&&hit.last10.rate>=.55)entries.push(hit);
   const hr=C.makePick({...common,market:'batting.hr',line:.5,selection:'To hit a home run',group:'homeRuns',logs:hist('homeRuns')});
   const season=C.summary(playerLog(p.current,'homeRuns'),.5);
   if(hr.last10.games>=5&&hr.last10.rate>=.1&&season.games>=12&&season.rate>=.05){
    hr.opportunity={verified:true,stat:'plateAppearances',last10Average:C.summary(playerLog(p.current,'plateAppearances').slice(-10),0).average||null};
    entries.push(hr);
   }
  }
 }
 if(!entries.length)warnings.push('No game-verified MLB players met the public game-log screens; no picks were invented.');
 warnings.push('Public MLB probable pitchers, lineups and historical stats do not verify injuries or sportsbook prices.');
 return{league:'mlb',entries,warnings,sources,games:games.length,playerLogsChecked:checked.filter(x=>x.ok).length};
}
module.exports={run};
