'use strict';
/**
 * NHL opportunity / fantasy research. Uses NHL public official per-game logs.
 * No xG is calculated without an independently validated shot-quality model
 * or an authorized data source; no live line or PP1 role is guessed.
 */
function toMinutes(value){
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return value;
  if(typeof value!=='string')return null;
  const match=value.trim().match(/^(\d+):([0-5]\d)$/);
  return match?Number(match[1])+Number(match[2])/60:null;
}
const n=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const average=items=>items.length?items.reduce((a,b)=>a+b,0)/items.length:null;
function verifiedTOI(logs){
  return(logs||[]).filter(x=>typeof x.date==='string').map(x=>({date:x.date,opponent:x.opponent||null,minutes:toMinutes(x.toi??x.value),shots:n(x.shots),goals:n(x.goals),assists:n(x.assists),powerPlayPoints:n(x.powerPlayPoints)}))
    .filter(x=>x.minutes!==null&&x.minutes>0).sort((a,b)=>a.date.localeCompare(b.date));
}
function usageTrend(logs,asOf){
  const valid=verifiedTOI(logs).filter(x=>x.date<asOf),l10=valid.slice(-10),l5=l10.slice(-5),prior=l10.slice(0,Math.max(0,l10.length-5));
  if(l10.length<3)return{verified:false,games:l10.length,reason:'Not enough actual time-on-ice game logs'};
  const last10=average(l10.map(x=>x.minutes)),recent=average(l5.map(x=>x.minutes)),
    before=prior.length>=3?average(prior.map(x=>x.minutes)):null;
  const shots=l10.filter(x=>x.shots!==null),totalShots=shots.reduce((a,x)=>a+x.shots,0),
    totalShotMinutes=shots.reduce((a,x)=>a+x.minutes,0);
  const ppp=l10.filter(x=>x.powerPlayPoints!==null);
  const delta=before===null?null:recent-before;
  return{verified:true,games:l10.length,averageToiLast10:last10,averageToiLast5:recent,
    previous5Toi:before,toiChangeMinutes:delta,shotsPer60:totalShotMinutes>0?totalShots/totalShotMinutes*60:null,
    powerPlayPointsLast10:ppp.length?ppp.reduce((a,x)=>a+x.powerPlayPoints,0):null,
    powerPlayPointGames:ppp.length,
    trend:delta===null?'sample-limited':delta>=2?'more-ice-time':delta<=-2?'less-ice-time':'stable',
    note:'Historical TOI and power-play points; PP1 membership and next-game role remain unverified.'};
}
function fantasyHistory(logs,asOf,weights={}){
  const allowed={goals:3,assists:2,shots:.4,powerPlayPoints:.5,blockedShots:.5,hits:.2};
  const w={...allowed,...Object.fromEntries(Object.entries(weights).filter(([k,v])=>k in allowed&&typeof v==='number'&&Number.isFinite(v)))};
  const rows=(logs||[]).filter(x=>x.date<asOf).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const scored=rows.map(x=>{
    const missing=[],points=Object.entries(w).reduce((sum,[k,val])=>{
      if(val===0)return sum;
      const stat=n(x[k]);if(stat===null){missing.push(k);return sum}return sum+stat*val;
    },0);
    return{date:x.date,opponent:x.opponent||null,points:missing.length?null:points,missing};
  });
  const valid=scored.filter(x=>x.points!==null).slice(-10);
  return{verified:valid.length>=3,averageFantasyPoints:average(valid.map(x=>x.points)),last10:valid,
    weights:w,coverage:valid.length,missingStats:[...new Set(scored.flatMap(x=>x.missing))],
    note:'Historical example scoring only. Configure actual league weights and positions before making fantasy projections.'};
}
const eventKinds={goal:'goal','shot-on-goal':'sog','missed-shot':'miss','blocked-shot':'block'};
function corsiFenwick(events,teams){
  // Expects normalized official PBP events with the shooting team already resolved.
  // NHL "eventOwnerTeamId" is not assumed to be the shooter on blocked events.
  if(!Array.isArray(teams)||teams.length!==2||teams[0]===teams[1])return{verified:false,reason:'Two distinct team identifiers required'};
  const summary=Object.fromEntries(teams.map(id=>[id,{corsiFor:0,fenwickFor:0,shotsOnGoalFor:0,blockedAttemptsFor:0}]));
  let sample=0,rejected=0;
  for(const e of events||[]){
    if(e.situation!=='5v5'){rejected++;continue}
    const kind=eventKinds[e.eventType],shoot=e.shootingTeamId;
    if(!kind||!summary[shoot]){rejected++;continue}
    sample++;
    summary[shoot].corsiFor++;
    if(kind!=='block')summary[shoot].fenwickFor++;
    if(kind==='sog'||kind==='goal')summary[shoot].shotsOnGoalFor++;
    if(kind==='block')summary[shoot].blockedAttemptsFor++;
  }
  const cf=teams.reduce((a,t)=>a+summary[t].corsiFor,0),ff=teams.reduce((a,t)=>a+summary[t].fenwickFor,0);
  if(!cf)return{verified:false,reason:'No verified normalized 5v5 attempt events',rejected};
  return{verified:true,teams:Object.fromEntries(teams.map(t=>[t,{...summary[t],cfPct:summary[t].corsiFor/cf,ffPct:ff?summary[t].fenwickFor/ff:null}])),
    attempts:cf,unblockedAttempts:ff,rejected,
    note:'5v5 Corsi = all attempts incl. blocked; Fenwick = unblocked attempts. No xG or scoring chance quality is inferred.'};
}
module.exports={toMinutes,verifiedTOI,usageTrend,fantasyHistory,corsiFenwick};
