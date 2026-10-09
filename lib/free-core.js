const QUALITY=require('./model-quality');
'use strict';
// SportsLab no-key statistical fallbacks. Values are historical observations, never bookmaker offers.
const etDate=value=>{const date=new Date(value);if(!Number.isFinite(date.getTime()))return'';const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day};
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const numeric=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const name=x=>typeof x==='string'?x:(x?.default||x?.fullName||x?.displayName||'');
const iso=(date)=>String(date||'').slice(0,10);
async function getJSON(url,timeout=7000){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'SportsLab-Research/1.0'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error('Public source HTTP '+r.status);return r.json()}
async function pool(items,limit,fn){let next=0;const out=Array(items.length),tasks=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const index=next++;if(index>=items.length)return;try{out[index]={ok:true,value:await fn(items[index],index)}}catch(e){out[index]={ok:false,error:String(e?.message||e)}}}});await Promise.all(tasks);return out}
function summary(log,line,side='Over'){const values=log.map(r=>numeric(r.value)).filter(v=>v!==null),hit=values.filter(v=>side==='Under'?v<line:v>line).length;return{games:values.length,hits:hit,rate:values.length?hit/values.length:null,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null}}
function lower(h,n){if(!n)return 0;const p=h/n,z=1.64;return Math.max(0,(p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n))}
function makePick(args){
 const {league,date,market,player,personId,team,teamId,opponent,opponentId,position,game,gameId,gameKey,line,selection,side='Over',logs=[],group=null,volumeHint=null,lineupStatus='Roster or projected role; lineup unconfirmed',source='Public league game logs',verifiedGame=true}=args;
 const valid=logs.filter(x=>numeric(x.value)!==null&&iso(x.date)<date).sort((a,b)=>iso(a.date).localeCompare(iso(b.date))).map(x=>({...x,value:Number(x.value)}));
 const last10=valid.slice(-10),last5=valid.slice(-5),s10=summary(last10,line,side),s5=summary(last5,line,side),season=summary(valid.filter(x=>iso(x.date).startsWith(date.slice(0,4))),line,side);
 const evidenceScore=Math.round(100*(s10.games?(.56*s10.rate+.24*lower(s10.hits,s10.games)+.12*Math.min(s10.games/10,1)+.08*Math.min((s10.average||0)/(line+1),1)):0));
 const trend=s10.games>=7&&s5.games>=3?s5.rate-s10.rate:null;
 const h2h=valid.filter(x=>opponentId&&String(x.opponentId||'')===String(opponentId)||opponent&&clean(x.opponent)===clean(opponent)).slice(-5);
 return {league,date,market,marketLabel:({sog:'Shots on goal',goals:'Goals',assists:'Assists',rec:'Receptions','receiving.yards':'Receiving yards','rushing.yards':'Rushing yards','passing.yards':'Passing yards','receiving.td':'Receiving TD','rushing.td':'Rushing TD','pitching.so':'Pitcher strikeouts',outs:'Pitcher outs','batting.h':'Hits','batting.hr':'Home runs'})[market]||market,player,personId:String(personId||''),team,teamId:teamId||null,opponent,opponentId:opponentId||null,position:position||null,game,gameId:gameId||null,gameKey:gameKey||String(gameId||game||''),side,line,selection:selection||(side+' '+line+' '+market),last5:s5,last10:s10,season,average:s10.average,avgLast5:s5.average,form:{read:trend==null?'Limited sample':trend>.15?'Improving':trend<-.15?'Cooling':'Stable',hitRateChange:trend,averageLast5:s5.average,averageLast10:s10.average},evidenceScore,priced:false,price:null,book:null,observedAt:null,lineupConfirmed:false,lineupStatus,availability:{status:'unconfirmed',label:lineupStatus,risk:'Starting role and injury availability are not confirmed by this fallback'},sampleNote:'Free historical research only; no verified sportsbook price',source,verifiedGame,volumeHint,group,
 gameLog:last10.map(x=>({date:x.date,opponent:x.opponent,opponentId:x.opponentId||null,value:x.value,hit:side==='Under'?x.value<line:x.value>line})),h2h:{games:h2h.map(x=>({date:x.date,opponent:x.opponent,value:x.value,hit:side==='Under'?x.value<line:x.value>line})),summary:summary(h2h,line,side)}};
}
function rankedBoard(league,date,entries,warnings=[],sources=[]){
 QUALITY.applyQuality(entries,()=>({postseason:league==='mlb'&&Number(date.slice(5,7))>=10}));
 const good=entries.filter(x=>x?.player&&x.verifiedGame&&x.last10?.games>=3&&x.quality?.readiness!=='exclude').sort((a,b)=>b.evidenceScore-a.evidenceScore||b.last10.games-a.last10.games);
 const standard=good.filter(x=>!x.group),seen=new Set(),props=[];
 for(const p of standard){if(seen.has(p.personId))continue;seen.add(p.personId);props.push(p);if(props.length===10)break}
 const byGame=new Map();
 for(const p of standard.filter(x=>x.last10.games>=5&&x.last10.rate>=.65&&x.evidenceScore>=54&&x.quality.readiness!=='exclude')){if(!byGame.has(p.gameKey))byGame.set(p.gameKey,[]);byGame.get(p.gameKey).push(p)}
 const sgps=[];
 for(const [id,items] of byGame){
  const teamSeen=new Set(),legs=[];
  for(const p of items){if(teamSeen.has(p.personId))continue;teamSeen.add(p.personId);legs.push(p);if(legs.length===5)break}
  if(legs.length>=3){const check=QUALITY.sgpQuality(legs);if(check.readiness!=='exclude')sgps.push({game:legs[0].game,gameId:id,legs,legCount:legs.length,pricedLegs:0,combinedPrice:null,rankScore:check.score,sgpRisk:check,notes:'Free historical observations only. Opponent-by-position defensive allowances, game-day lineups and SGP correlation remain unverified.',status:'Research combination — no verified sportsbook prices'})}
 }
 sgps.sort((a,b)=>b.rankScore-a.rankScore);
 const distinct=[],games=new Set();
 for(const p of standard.filter(x=>x.last10?.games>=5&&x.last10.rate>=.7&&x.evidenceScore>=58&&x.quality.readiness!=='exclude')){if(games.has(p.gameKey))continue;games.add(p.gameKey);distinct.push(p);if(distinct.length===5)break}
 const cross=distinct.length>=4?{available:true,league,date,gameCount:games.size,consideredMarkets:standard.length,legs:distinct.map(x=>({...x,kind:'player',stat:x.market,gameLabel:x.game,point:x.line,verifiedOdds:false})),legCount:distinct.length,verifiedLegs:0,combinedPrice:null,estimatedPrice:null,status:'Research-only — free historical stats; not sportsbook prices',explanation:'One player-volume leg per game, requiring at least five prior recorded games. Moneyline, spread and total markets require an independently quoted sportsbook feed.',notice:'No exact odds or combined payout are verified.'}:{available:false,league,date,gameCount:new Set(standard.map(x=>x.gameKey)).size,consideredMarkets:standard.length,legs:[],legCount:0,combinedPrice:null,reason:'Not enough separate games with adequately supported free player props; no cross-game parlay forced.'};
 return {available:true,league,date,fallback:true,provider:'Official/free public data',sources,warnings,props,candidateProps:standard.slice(0,45),sgps:sgps.slice(0,3),crossGameParlay:cross,candidatesEvaluated:standard.length,pricedProps:0,modelStatus:'Free historical player statistics; odds, injuries, confirmed roles and correlated SGP payouts are not verified. No prediction confidence claims.',fetchedAt:new Date().toISOString()};
}
function scoringBoard(league,date,entries,warnings=[],sources=[]){
 QUALITY.applyQuality(entries,()=>({postseason:league==='mlb'&&Number(date.slice(5,7))>=10}));
 const defs=league==='nhl'?[['goals','Top Goalscorers'],['assists','Top Assist Picks']]:league==='nfl'?[['touchdowns','Top Touchdown Picks']]:[['homeRuns','Top Home Run Picks']];
 const groups=defs.map(([key,title])=>{
  const selected=entries.filter(x=>x.group===key&&x.last10?.games>=3).sort((a,b)=>b.evidenceScore-a.evidenceScore),chosen=[],seen=new Set();
  for(const p of selected){if(seen.has(p.personId))continue;seen.add(p.personId);chosen.push(p);if(chosen.length===5)break}
  return{key,title,selection:key,stat:key,picks:chosen};
 });
 return {available:true,league,date,fallback:true,provider:'Official/free public data',sources,warnings,groups,scorers:groups.flatMap(x=>x.picks),modelStatus:'Free observed scoring and usage rates; high event variance. Odds and definitive lineup status unverified.',fetchedAt:new Date().toISOString()};
}
module.exports={etDate,clean,numeric,name,iso,getJSON,pool,summary,makePick,rankedBoard,scoringBoard};
