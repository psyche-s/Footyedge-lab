'use strict';
// Manual/scheduled owner publishing: GitHub Release body update, never a Vercel deploy.
const fs=require('node:fs/promises'),path=require('node:path'),freeSlate=require('../lib/free-slate');
const SPORTS=['nhl','nfl','mlb','nba'],DIR=path.join(process.cwd(),'published');
function torontoDate(value=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day}
function inputs(){const a=process.argv.slice(2),v=n=>a.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);return{league:(v('league')||process.env.INPUT_LEAGUE||'all').toLowerCase(),source:(v('source')||process.env.INPUT_SOURCE||'auto').toLowerCase(),date:v('date')||torontoDate(),preview:a.includes('--preview')}}
function valid(board,view,league,date){return board?.available===true&&board.league===league&&board.date===date&&(view==='ranked'?Array.isArray(board.props)&&(board.props.length>0||(board.sgps||[]).length>0):Array.isArray(board.groups)&&board.groups.some(x=>(x.picks||[]).length))}
async function live(league,view,date){const u=new URL('https://sportslab-psyche8.vercel.app/api/stat-board');for(const[k,v]of Object.entries({league,view,date,source:'live',refresh:String(Date.now())}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(11000)});if(!r.ok)throw Error('Live HTTP '+r.status);return r.json()}
async function free(league,view,date){let status=200,result;const res={status(x){status=x;return this},setHeader(){return this},json(x){result=x;return this}};await freeSlate({query:{league,view,date}},res,{reason:'Owner published refresh'});if(status>=400||!result?.available)throw Error(result?.reason||result?.error||'Free source unavailable');return result}
async function get(league,view,date,source){if(source==='auto')try{const p=await live(league,view,date);if(valid(p,view,league,date))return p}catch(e){console.log('[primary unavailable] '+league+'/'+view+': '+e.message)}return free(league,view,date)}

function compactPossession(p){
 if(!p?.verified)return p||null;
 return{verified:true,team:p.team,games:p.games,currentSeasonGames:p.currentSeasonGames,
  corsiPct:p.corsiPct,fenwickPct:p.fenwickPct,sogForPerGame:p.sogForPerGame,
  sogAgainstPerGame:p.sogAgainstPerGame,innerSlotLocationProxyPerGame:p.innerSlotLocationProxyPerGame,
  pdo:p.pdo};
}
function compactPick(p){
 const q={...p};
 // Drop verbose repeated backend source warnings. The actual pick, form,
 // matchup, H2H game logs and source-qualified metrics stay intact.
 delete q.sampleNote;
 if(q.teamPossession)q.teamPossession=compactPossession(q.teamPossession);
 if(q.opponentPossession)q.opponentPossession=compactPossession(q.opponentPossession);
 if(String(q.market||q.stat||'')!=='goals'){delete q.positionMatchup;delete q.opponentPositionTable;}
 if(q.opponentPositionTable?.available){const p=q.opponentPositionTable;q.opponentPositionTable={available:true,source:p.source,team:p.team,games:p.games,currentSeasonGames:p.currentSeasonGames,priorSeasonGames:p.priorSeasonGames,hasReliableCurrentSeasonSample:p.hasReliableCurrentSeasonSample,positions:p.positions};}
 return q;
}
function compactLeg(p){
 // An SGP leg is a repeat of a researched pick; keep identity, form,
 // matchup/H2H and gradeable settlement, not full duplicate raw game/usage.
 const keys=['league','date','game','gameId','gameKey','player','personId','position',
  'team','opponent','market','marketLabel','side','line','selection','last5','last10',
  'season','evidenceScore','priced','book','price','h2h','source','quality','form',
  'status','verifiedOdds','kind','stat','point','gameLabel'];
 return Object.fromEntries(keys.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
}
function compactTrack(p){
 // Grading needs the immutable original selection, not a second copy of charts.
 const keys=['game','gameId','gameKey','personId','player','market','stat',
  'side','line','selection','priced','price','book'];
 return Object.fromEntries(keys.filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
}
function compactParlay(p){return{...p,legs:(p.legs||[]).map(compactLeg)}}
function compact(p,view){const c={available:true,league:p.league,date:p.date,fallback:!!p.fallback,sources:(p.sources||[]).slice(0,8),warnings:(p.warnings||[]).slice(0,8),modelStatus:p.modelStatus||null,coverage:p.coverage||null,fetchedAt:p.fetchedAt||null,dataMode:'published'};if(view==='ranked')return{...c,props:(p.props||[]).slice(0,10).map(compactPick),candidateProps:[],sgps:(p.sgps||[]).slice(0,3).map(compactParlay),crossGameParlay:p.crossGameParlay?.available?compactParlay(p.crossGameParlay):(p.crossGameParlay||{available:false,legs:[],reason:'Not verified'}),pricedProps:p.pricedProps||0,candidatesEvaluated:p.candidatesEvaluated??(p.props||[]).length};const groups=(p.groups||[]).map(g=>({key:g.key,title:g.title,stat:g.stat,selection:g.selection,picks:(g.picks||[]).slice(0,5).map(compactPick)}));return{...c,groups,scorers:groups.flatMap(g=>g.picks).map(compactTrack)}}
async function compose(league,date,source){const types=['ranked','scorers'],parts={},responses=await Promise.allSettled(types.map(v=>get(league,v,date,source)));for(let i=0;i<types.length;i++)if(responses[i].status==='fulfilled')parts[types[i]]=compact(responses[i].value,types[i]);if(!Object.keys(parts).length)throw Error('No verified data: '+responses.map(r=>r.reason?.message||'unavailable').join(' | '));const publishedAt=new Date().toISOString(),data={schemaVersion:1,league,date,publishedAt,publisher:'GitHub Actions data-only, no Vercel build',views:Object.keys(parts),...parts};let json=JSON.stringify(data);if(Buffer.byteLength(json)>110000&&data.ranked){
  data.ranked.candidateProps=[];
  // Preserve original price, market and Top10 interactive graphs; SGP legs
  // retain L5/L10 summary, but shed detailed H2H arrays if still oversized.
  for(const sgp of data.ranked.sgps||[])for(const leg of sgp.legs||[])if(leg.h2h)leg.h2h={summary:leg.h2h.summary};
  for(const leg of data.ranked.crossGameParlay?.legs||[])if(leg.h2h)leg.h2h={summary:leg.h2h.summary};
  json=JSON.stringify(data)
 }if(Buffer.byteLength(json)>110000)throw Error('Board still too large for publication: '+Buffer.byteLength(json)+' bytes');return{json,summary:{league,date,publishedAt,views:data.views,props:data.ranked?.props?.length||0,sgps:data.ranked?.sgps?.length||0,scorers:data.scorers?.scorers?.length||0,bytes:Buffer.byteLength(json)}}}
async function main(){const{league,date,source,preview}=inputs();if(!['all',...SPORTS].includes(league)||!['auto','free'].includes(source)||!/^20\d\d-\d\d-\d\d$/.test(date))throw Error('Invalid sport/source/date');if(date!==torontoDate())throw Error('Cannot publish stale date: '+date+'; today '+torontoDate());await fs.mkdir(DIR,{recursive:true});const targets=league==='all'?SPORTS:[league];let success=0;for(const x of targets)try{const p=await compose(x,date,source);if(!preview)await fs.writeFile(path.join(DIR,x+'.json'),p.json,'utf8');console.log('[ready] '+JSON.stringify(p.summary));success++}catch(e){console.error('[not published] '+x+': '+e.message)}if(!success)throw Error('Nothing qualified. Existing publications remain untouched.');console.log('[complete] '+success+'/'+targets.length+' boards prepared without Vercel deploy')}
if(require.main===module)main().catch(e=>{console.error('[failed] '+e.message);process.exitCode=1});
module.exports={torontoDate,inputs,valid,compact,compose,main};
