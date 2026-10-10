'use strict';
/**
 * SportsLab official-source postgame audit.
 * Only grades a frozen pregame published board; never invents historical picks.
 */
const fs=require('node:fs/promises');
const path=require('node:path');
const REVIEW=require('../lib/model-quality');
const githubDate=d=>String(d||'').slice(0,10);
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const finite=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function torontoToday(d=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
function dateYesterday(){
  const date=new Date(torontoToday()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);
}
async function data(url,timeout=10000){
  const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'SportsLab-Postgame-Review'},signal:AbortSignal.timeout(timeout)});
  if(!r.ok)throw Error('Official box-score API '+r.status);
  return r.json();
}
function title(x){return typeof x==='string'?x:x?.default||x?.fullName||x?.displayName||''}
function gameResult(id,homeName,awayName,homeScore,awayScore,status,source){
  return{gameId:String(id),gameKey:[clean(homeName),clean(awayName)].sort().join('|'),
    homeName,awayName,homeScore:finite(homeScore),awayScore:finite(awayScore),status,source};
}
const push=(values,gameId,personId,player,stat,value)=>{
  const n=finite(value);if(n===null)return;
  values.push({gameId:String(gameId),personId:String(personId||''),player:String(player||''),market:stat,value:n});
};
async function nhl(date){
 const calendar=await data('https://api-web.nhle.com/v1/score/'+date);
 const games=[],players=[],issues=[],tasks=[];
 for(const g of calendar.games||[]){
  const home=title(g.homeTeam?.placeName)+' '+title(g.homeTeam?.commonName),away=title(g.awayTeam?.placeName)+' '+title(g.awayTeam?.commonName);
  const status=['OFF','FINAL'].includes(g.gameState)?'final':'pending';
  games.push(gameResult(g.id,home.trim(),away.trim(),g.homeTeam?.score,g.awayTeam?.score,status,'NHL public API'));
  if(status==='final')tasks.push(g);
 }
 // Fetch final player box scores only; published pick evaluation never treats absent players as 0.
 for(const g of tasks){
  try{
   const p=await data('https://api-web.nhle.com/v1/gamecenter/'+g.id+'/boxscore',9000);
   for(const side of ['homeTeam','awayTeam'])for(const group of ['forwards','defense','goalies']){
    const rows=p.playerByGameStats?.[side]?.[group]||[];
    for(const row of rows){
     const id=row.playerId,player=title(row.name),map={
      sog:row.sog??row.shots,goals:row.goals,assists:row.assists,
      pts:row.points??(finite(row.goals)!==null&&finite(row.assists)!==null?Number(row.goals)+Number(row.assists):null),
      blocks:row.blockedShots??row.blockedShotAttempts,hits:row.hits,
      saves:row.saves
     };
     for(const [key,value] of Object.entries(map))push(players,g.id,id,player,key,value);
    }
   }
  }catch(e){issues.push('NHL box score not verified for game '+g.id)}
 }
 return{games,players,issues,source:'NHL official box scores',final:games.filter(g=>g.status==='final').length,total:games.length};
}
function espnGame(e){
 const c=e.competitions?.[0]||{},home=c.competitors?.find(x=>x.homeAway==='home'),away=c.competitors?.find(x=>x.homeAway==='away');
 if(!home||!away)return null;
 return gameResult(e.id,home.team?.displayName||home.team?.name,away.team?.displayName||away.team?.name,home.score,away.score,e.status?.type?.completed?'final':'pending','ESPN NFL scores');
}
function rowValues(group,row){
 const category=String(group.name||group.type||'').toLowerCase(),labels=group.labels||[];
 const fields=Object.fromEntries(labels.map((label,i)=>[clean(label),row.stats?.[i]]));
 const measure=(...keys)=>keys.map(key=>fields[clean(key)]).find(x=>finite(x)!==null);
 const result={};
 if(category.includes('receiv')){
   result.rec=measure('REC','RECEPTIONS');result['receiving.rec']=result.rec;
   result['receiving.yards']=measure('YDS','YARDS');result['receiving.td']=measure('TD');
 }
 if(category.includes('rush')){
   result['rushing.yards']=measure('YDS','YARDS');result['rushing.att']=measure('CAR','ATT');
   result['rushing.td']=measure('TD');
 }
 if(category.includes('pass')){
   result['passing.yards']=measure('YDS','YARDS');result['passing.td']=measure('TD');
   result['passing.intc']=measure('INT');
   const attempts=String(fields.catt||fields.compatt||'').split('/')[1];
   result['passing.att']=finite(attempts);
 }
 return result;
}
async function nfl(date){
 const p=await data('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates='+date.replace(/-/g,'')+'&limit=100');
 const games=(p.events||[]).map(espnGame).filter(Boolean),players=[],issues=[];
 for(const g of games.filter(x=>x.status==='final')){
  try{
   const box=await data('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event='+g.gameId,10000);
   for(const group of box.boxscore?.players||[])for(const stat of group.statistics||[])for(const row of stat.athletes||[]){
    const person=row.athlete||{},values=rowValues(stat,row);
    for(const[k,v]of Object.entries(values))push(players,g.gameId,person.id,person.displayName||person.fullName,k,v);
   }
  }catch(e){issues.push('NFL player summary unavailable for '+g.gameId)}
 }
 return{games,players,issues,source:'ESPN NFL final scores and box scores',final:games.filter(g=>g.status==='final').length,total:games.length};
}
const outs=ip=>{if(ip==null)return null;const m=String(ip).match(/^(\d+)\.([012])$/);return m?Number(m[1])*3+Number(m[2]):/^\d+$/.test(String(ip))?Number(ip)*3:null};
async function mlb(date){
 const p=await data('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+date);
 const fixtures=(p.dates||[]).flatMap(x=>x.games||[]),games=[],players=[],issues=[];
 for(const g of fixtures){
  const status=g.status?.abstractGameState==='Final'?'final':'pending',home=g.teams?.home?.team?.name,away=g.teams?.away?.team?.name;
  games.push(gameResult(g.gamePk,home,away,g.teams?.home?.score,g.teams?.away?.score,status,'MLB StatsAPI'));
  if(status!=='final')continue;
  try{
   const box=await data('https://statsapi.mlb.com/api/v1/game/'+g.gamePk+'/boxscore',9000);
   for(const team of ['home','away'])for(const row of Object.values(box.teams?.[team]?.players||{})){
    const b=row.stats?.batting||{},pitch=row.stats?.pitching||{},person=row.person||{};
    for(const[k,v]of Object.entries({'batting.h':b.hits,'batting.hr':b.homeRuns,'batting.rbi':b.rbi,total_bases:b.totalBases,'pitching.so':pitch.strikeOuts,outs:outs(pitch.inningsPitched),'pitching.bb':pitch.baseOnBalls,'pitching.h':pitch.hits,er:pitch.earnedRuns}))
     push(players,g.gamePk,person.id,person.fullName,k,v);
   }
  }catch(e){issues.push('MLB individual boxscore unavailable for game '+g.gamePk)}
 }
 return{games,players,issues,source:'MLB official schedule and full box score',final:games.filter(g=>g.status==='final').length,total:games.length};
}
async function nba(date){
 const board=await data('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+date.replace(/-/g,'')+'&limit=100');
 const games=[],players=[],issues=[];
 for(const e of board.events||[]){
  if(Number(e.season?.type)!==2)continue; // Regular-season NBA only.
  const c=e.competitions?.[0]||{},home=c.competitors?.find(x=>x.homeAway==='home'),away=c.competitors?.find(x=>x.homeAway==='away');
  if(!home||!away)continue;
  const final=e.status?.type?.completed===true;
  games.push(gameResult(e.id,home.team?.displayName,away.team?.displayName,home.score,away.score,final?'final':'pending','ESPN public NBA scoreboard'));
  if(!final)continue;
  try{
   const box=await data('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+e.id);
   for(const team of box.boxscore?.players||[])for(const group of team.statistics||[])for(const player of group.athletes||[]){
    const who=player.athlete||{},stats=Object.fromEntries((group.labels||[]).map((label,i)=>[String(label||'').toUpperCase(),player.stats?.[i]]));
    const threes=finite(stats['3PM']??stats['3PTM']??stats.FG3M);
    const split=String(stats['3PT']||'').match(/^(\d+)-\d+$/);
    for(const[k,v]of Object.entries({points:stats.PTS,rebounds:stats.REB,assists:stats.AST,threes:threes===null?(split?Number(split[1]):null):threes}))
     push(players,e.id,who.id,who.displayName||who.fullName,k,v);
   }
  }catch(e2){issues.push('NBA individual box score unavailable for game '+e.id)}
 }
 return{games,players,issues,source:'ESPN public NBA regular-season final box scores',final:games.filter(x=>x.status==='final').length,total:games.length};
}

function warningsFor(day){
 const summary=day.summary||{},gameCount=day.sourceTotals||{},notes=[];
 if(summary.graded<10)notes.push('Low graded-pick sample. Do not change historical win-probability weights from this report alone.');
 if(summary.ungraded||summary.pending)notes.push('Incomplete games/player statistics remain ungraded, not automatically losses.');
 if(gameCount.final<gameCount.total)notes.push('Not all scheduled games have official final scores. Rerun review after completion.');
 return notes;
}
async function review(snapshot){
 if(snapshot?.schemaVersion!==1||!['nhl','nfl','mlb','nba'].includes(snapshot.league)||!/^20\d{2}-\d\d-\d\d$/.test(snapshot.date)||!snapshot.publishedAt)
  throw Error('A dated original pregame freeze is required for historical grading');
 const mode={nhl,nfl,mlb,nba}[snapshot.league],source=await mode(snapshot.date);
 const reviewed=REVIEW.reviewSelections(snapshot,source.games,source.players);
 const processWarnings=warningsFor({...reviewed,sourceTotals:{final:source.final,total:source.total}});
 return{schemaVersion:1,league:snapshot.league,date:snapshot.date,pregameFreezeAt:snapshot.publishedAt,reviewedAt:new Date().toISOString(),source:source.source,
  sourceTotals:{final:source.final,total:source.total,individualStats:source.players.length},
  games:source.games,reviewed:reviewed.reviewed,summary:reviewed.summary,
  auditNotes:[...reviewed.notes,...processWarnings,...source.issues],
  conclusion:'Outcome grading only. A miss is not automatically a bad model read; identify game-state and role effects from independently verified evidence before any weight changes.',
  modelUpdates:'Model changes require at least 25 unique graded picks per prop market across multiple match dates before retrospective adjustments.'};
}
async function main(){
 const args=process.argv.slice(2),opt=k=>args.find(x=>x.startsWith('--'+k+'='))?.slice(k.length+3),league=opt('league'),date=opt('date')||dateYesterday();
 if(!['nhl','nfl','mlb'].includes(league)||!/^20\d{2}-\d\d-\d\d$/.test(date))throw Error('Provide --league=nhl|nfl|mlb [--date=YYYY-MM-DD]');
 const filename=opt('snapshot')||path.join(process.cwd(),'frozen',league+'.json');
 const snapshot=JSON.parse(await fs.readFile(filename,'utf8'));
 if(snapshot.league!==league||snapshot.date!==date)throw Error('Freeze date/sport mismatch: refuse to re-label historical picks');
 const result=await review(snapshot);
 const dir=path.join(process.cwd(),'reviewed');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,league+'.json'),JSON.stringify(result),'utf8');
 console.log('[graded] '+JSON.stringify({league,date,freeze:result.pregameFreezeAt,final:result.sourceTotals.final,total:result.sourceTotals.total,summary:result.summary}));
 if(!result.sourceTotals.final)throw Error('No completed games: do not publish speculative grading.');
}
if(require.main===module)main().catch(e=>{console.error('[review failed] '+e.message);process.exitCode=1});
module.exports={review,nhl,nfl,mlb,espnGame,rowValues,outs,warningsFor};
