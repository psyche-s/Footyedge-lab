'use strict';
const C=require('./free-core');
const NHL_USAGE=require('./nhl-opportunity');
const NHL_POSSESSION=require('./nhl-possession');
const manualNews=require('../ops/nhl-availability-2026-10-09.json');
const normalizeName=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const statusFor=(date,team,player)=>manualNews.date===date?(manualNews.players||[]).find(x=>x.team===team&&normalizeName(x.player)===normalizeName(player)):null;
const base='https://api-web.nhle.com/v1';
function abbrev(obj){return C.name(obj?.abbrev||obj?.triCode||obj?.teamAbbrev).toUpperCase()}
function fullTeam(obj){const city=C.name(obj?.placeName),common=C.name(obj?.commonName),name=C.name(obj?.name);return [city,common].filter(Boolean).join(' ')||name||abbrev(obj)}
function seasonId(start){return String(start)+String(start+1)}
function historicalLog(data,metric,team){return (data.gameLog||[]).filter(x=>x.gameDate&&x[metric]!=null).map(x=>({date:x.gameDate,value:C.numeric(x[metric]),opponent:C.name(x.opponentAbbrev),opponentId:C.name(x.opponentAbbrev),team})).filter(x=>x.value!==null)}
async function run(date){
 const year=Number(date.slice(0,4)),month=Number(date.slice(5,7)),start=year-(month<9?1:0),now=seasonId(start),prior=seasonId(start-1),warnings=[],sources=['NHL public score/schedule','NHL current rosters','NHL regular-season skater stats','NHL individual game logs'];
 const score=await C.getJSON(base+'/score/'+date,7000);
 const games=(score.games||[]).filter(g=>g.gameType===2||g.gameType==null).map(g=>{
  const home=abbrev(g.homeTeam),away=abbrev(g.awayTeam);
  return{key:String(g.id),id:String(g.id),home,away,homeName:fullTeam(g.homeTeam),awayName:fullTeam(g.awayTeam),start:g.startTimeUTC,state:g.gameState};
 }).filter(g=>g.home&&g.away&&Number.isFinite(Date.parse(g.start))&&Date.parse(g.start)>Date.now()+60000);
 if(!games.length)return{league:'nhl',entries:[],warnings:['No upcoming regular-season NHL games remain for '+date+'.'],sources};
 const teamMap=new Map();
 for(const g of games){teamMap.set(g.home,{team:g.home,opponent:g.away,opponentName:g.awayName,teamName:g.homeName,game:g});teamMap.set(g.away,{team:g.away,opponent:g.home,opponentName:g.homeName,teamName:g.awayName,game:g})}
 // Start independent official possession research alongside player roster and log collection.
 // Fail open: never take the historical pick board offline if gamecenter PBP is unavailable.
 const possessionJob=NHL_POSSESSION.collect([...teamMap.keys()],date).catch(e=>({teams:{},warnings:['NHL official 5v5 possession unavailable: '+String(e.message||e).slice(0,95)],gamesVerified:0}));
 const teamData=await C.pool([...teamMap.values()],5,async ref=>{
  const [roster,statsPrev,statsNow]=await Promise.allSettled([
   C.getJSON(base+'/roster/'+encodeURIComponent(ref.team)+'/current',6000),
   C.getJSON(base+'/club-stats/'+encodeURIComponent(ref.team)+'/'+prior+'/2',6500),
   C.getJSON(base+'/club-stats/'+encodeURIComponent(ref.team)+'/'+now+'/2',6500)
  ]);
  const active=roster.status==='fulfilled'?[...(roster.value.forwards||[]),...(roster.value.defensemen||[])]:[];
  if(!active.length)throw Error('NHL current roster unavailable for '+ref.team);
  const stats=new Map();
  for(const batch of [statsPrev,statsNow]){
   if(batch.status!=='fulfilled')continue;
   for(const row of batch.value.skaters||[]){
    const id=Number(row.playerId);if(!id)continue;
    const existing=stats.get(id)||{};
    if(!existing.gamesPlayed||Number(row.gamesPlayed)>Number(existing.gamesPlayed))stats.set(id,row);
   }
  }
  const candidates=active.map(a=>{
   const row=stats.get(Number(a.id))||{};
   const gp=Number(row.gamesPlayed||0),shots=Number(row.shots||0);
   return{id:Number(a.id),name:[C.name(a.firstName),C.name(a.lastName)].filter(Boolean).join(' '),position:a.positionCode,shotRate:gp?shots/gp:0,goalsRate:gp?Number(row.goals||0)/gp:0,assistsRate:gp?Number(row.assists||0)/gp:0,gp,team:ref.team,opponent:ref.opponent,opponentName:ref.opponentName,teamName:ref.teamName,game:ref.game};
  }).filter(p=>p.id&&p.name&&p.gp>=5&&statusFor(date,p.team,p.name)?.status!=='confirmed_out').sort((a,b)=>b.shotRate-a.shotRate||b.gp-a.gp).slice(0,3);
  return candidates;
 });
 const perTeam=teamData.filter(x=>x.ok).map(x=>x.value);
 if(teamData.some(x=>!x.ok))warnings.push(teamData.filter(x=>!x.ok).length+' team(s) lack current verified roster/season coverage and were excluded.');
 const players=[];for(let rank=0;rank<3;rank++)for(const group of perTeam){if(group[rank])players.push(group[rank])}players.length=Math.min(players.length,36);
 const done=await C.pool(players,8,async p=>{
  const [current,previous]=await Promise.allSettled([C.getJSON(base+'/player/'+p.id+'/game-log/'+now+'/2',6500),C.getJSON(base+'/player/'+p.id+'/game-log/'+prior+'/2',6500)]);
  if(current.status!=='fulfilled'&&previous.status!=='fulfilled')throw Error('No player game log');
  const logs={};
  for(const metric of ['shots','goals','assists']){
   const currentRows=current.status==='fulfilled'?historicalLog(current.value,metric,p.team):[];
   const prevRows=previous.status==='fulfilled'?historicalLog(previous.value,metric,p.team):[];
   const unique=new Map([...prevRows,...currentRows].map(x=>[x.date+'-'+x.opponent,x]));
   logs[metric]=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  const original=[...(previous.status==='fulfilled'?(previous.value.gameLog||[]):[]),...(current.status==='fulfilled'?(current.value.gameLog||[]):[])];
  const history=[...new Map(original.filter(x=>x.gameDate&&x.gameDate<date).map(x=>[x.gameDate+'|'+C.name(x.opponentAbbrev),{
    date:x.gameDate,opponent:C.name(x.opponentAbbrev),toi:x.toi,shots:C.numeric(x.shots),goals:C.numeric(x.goals),assists:C.numeric(x.assists),powerPlayPoints:C.numeric(x.powerPlayPoints)
  }])).values()];
  const usage=NHL_USAGE.usageTrend(history,date);
  usage.currentSeasonGames=history.filter(x=>x.date>=start+'-09-01').length;
  return{...p,logs,usage};
 });
 const possession=await possessionJob;
 if(possession.warnings?.length)warnings.push(...possession.warnings);
 if(possession.gamesVerified) sources.push('Official NHL 5v5 PBP: Corsi/Fenwick, PDO, historical shots allowed');
 if(possession.boxscoresVerified) sources.push('Official NHL full-game boxscores: verified scorer-position GA/GP');
 const entries=[];
 for(const item of done){if(!item.ok)continue;const p=item.value,game=p.game,gamelabel=game.awayName+' @ '+game.homeName,common={league:'nhl',date,player:p.name,personId:p.id,team:p.teamName,teamId:p.team,opponent:p.opponentName,opponentId:p.opponent,position:p.position,game:gamelabel,gameId:game.id,gameKey:game.id,lineupStatus:'NHL roster verified; ice-time line and game-day availability unconfirmed',source:'NHL official regular-season game logs',verifiedGame:true};
  const teamPossession=possession.teams?.[p.team],opponentPossession=possession.teams?.[p.opponent];
  const opponentPosition=possession.positionAllowed?.[p.opponent];
  const positionCode=({L:'LW',R:'RW',C:'C',D:'D',LW:'LW',RW:'RW'})[String(p.position||'').toUpperCase()]||null;
  const positionMatchup=positionCode&&opponentPosition?.available?{...opponentPosition.positions?.[positionCode],position:positionCode,opponent:p.opponent,verified:true,source:opponentPosition.source,currentSeasonGames:opponentPosition.currentSeasonGames,priorSeasonGames:opponentPosition.priorSeasonGames,smallSample:!opponentPosition.hasReliableCurrentSeasonSample,note:opponentPosition.note}:null;
  const positionShotMatchup=positionCode&&opponentPosition?.shotAvailable&&opponentPosition.shotPositions?.[positionCode]?
    {...opponentPosition.shotPositions[positionCode],position:positionCode,opponent:p.opponent,
      currentSeasonGames:opponentPosition.currentSeasonShotGames,verified:true,
      source:'Official NHL full-game player boxscores',
      note:'Total SOG by all opposing players at this position, not one shooter; descriptive only.'}:null;
  const opponentRead=opponentPossession?.verified?' Opponent 5v5 L'+opponentPossession.games+': Corsi '+(opponentPossession.corsiPct*100).toFixed(1)+'%, Fenwick '+(opponentPossession.fenwickPct*100).toFixed(1)+'%, SOG allowed '+opponentPossession.sogAgainstPerGame.toFixed(1)+'/game.'+(opponentPossession.currentSeasonGames<3?' Early-season sample includes prior season.':'')+' No trained RAPM or xG.':'';
  if(p.shotRate>=1.5){
   const x=C.makePick({...common,market:'sog',line:1.5,selection:'2+ shots on goal',logs:p.logs.shots,volumeHint:p.shotRate});
   if(x.last10.games>=3&&x.last10.rate>=.5){x.positionShotMatchup=positionShotMatchup;x.usage=p.usage;x.teamPossession=teamPossession;x.opponentPossession=opponentPossession;x.positionMatchup=positionMatchup;x.opponentPositionTable=opponentPosition;if(opponentRead)x.sampleNote+=' '+opponentRead;x.opportunity={verified:true,stat:'sog',last10Average:x.last10.average,shotRatePer60:p.usage.shotsPer60??null,note:'Historical shots and TOI; next-game deployment unverified'};entries.push(x)}
  }
  if(p.shotRate>=1.6&&p.goalsRate>=.17){
   const x=C.makePick({...common,market:'goals',line:.5,selection:'Anytime goalscorer',logs:p.logs.goals,group:'goals',volumeHint:p.shotRate});
   if(x.last10.games>=3&&x.last10.rate>=.18){x.usage=p.usage;x.teamPossession=teamPossession;x.opponentPossession=opponentPossession;x.positionMatchup=positionMatchup;x.opponentPositionTable=opponentPosition;if(opponentRead)x.sampleNote+=' '+opponentRead;x.opportunity={verified:true,stat:'sog',last10Average:C.summary(p.logs.shots.slice(-10),0).average,shotRatePer60:p.usage.shotsPer60??null,note:'Observed shot volume plus time on ice; PP1 remains unverified'};entries.push(x)}
  }
  if(p.shotRate>=1.3&&p.assistsRate>=.20){
   const x=C.makePick({...common,market:'assists',line:.5,selection:'To record an assist',logs:p.logs.assists,group:'assists',volumeHint:p.shotRate});
   if(x.last10.games>=3&&x.last10.rate>=.2){x.usage=p.usage;x.teamPossession=teamPossession;x.opponentPossession=opponentPossession;x.positionMatchup=positionMatchup;x.opponentPositionTable=opponentPosition;if(opponentRead)x.sampleNote+=' '+opponentRead;x.opportunity={verified:true,stat:'sog',last10Average:C.summary(p.logs.shots.slice(-10),0).average,shotRatePer60:p.usage.shotsPer60??null,note:'Observed shot volume plus time on ice; PP1 remains unverified'};entries.push(x)}
  }
 }
 for(const p of entries){const news=statusFor(date,p.teamId,p.player);if(news?.status==='questionable'){p.availability={status:'questionable',label:news.reason||'Game-day availability uncertain',source:news.source,reviewedAt:manualNews.reviewedAt};p.lineupConfirmed=false;p.sampleNote+=' Game-day report: '+(news.reason||'Lineup uncertain')+'.';}}
 if(manualNews.date===date) sources.push('Human-verified Oct 9 injury reports (source-linked; 4 PM lineups require re-check)');
 if(!entries.length)warnings.push('NHL public data returned no game-verified recent prop candidates. Do not force selections.');
 warnings.push('NHL 5v5 possession is real historical official PBP, not fitted RAPM/xG. Early-season samples may include previous year.');
 warnings.push('NHL current roster does not confirm even-strength lines, power-play usage, starting goalie or game-day injury status.');
 return{league:'nhl',entries,warnings,sources,games:games.length,playerLogsChecked:done.filter(x=>x.ok).length,possessionGamesVerified:possession.gamesVerified||0};
}
module.exports={run};
