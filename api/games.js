
function gName(x){return typeof x==='string'?x:(x?.default||x?.fullName||x?.displayName||'')}
function gNhlTeam(x){const ab=gName(x?.abbrev),city=gName(x?.placeName),common=gName(x?.commonName);return{name:[city,common].filter(Boolean).join(' ')||gName(x?.name)||ab,short:common||ab,abbreviation:ab,logo:x?.logo||'',score:x?.score??null,record:null}}
async function publicSchedule(sport,date){
 if(sport==='NHL'){
  const r=await fetch('https://api-web.nhle.com/v1/score/'+date,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('NHL public schedule '+r.status);
  const p=await r.json();
  return(p.games||[]).map(x=>({id:String(x.id),date:x.startTimeUTC,status:x.gameState==='FUT'?'Scheduled':x.gameState==='LIVE'?'In progress':x.gameState==='OFF'?'Final':x.gameState||'Unverified',state:x.gameState==='OFF'?'post':x.gameState==='LIVE'?'in':'pre',detail:x.gameState||'',home:gNhlTeam(x.homeTeam),away:gNhlTeam(x.awayTeam),venue:x.venue?.default||'',broadcast:'',league:'NHL',summaryAvailable:false}));
 }
 if(sport==='MLB'){
  const r=await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+date,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('MLB public schedule '+r.status);
  const p=await r.json();
  return(p.dates||[]).flatMap(x=>x.games||[]).map(g=>{const team=x=>({name:x?.team?.name||'',short:x?.team?.teamName||x?.team?.name||'',abbreviation:x?.team?.abbreviation||'',logo:'',score:x?.score??null,record:null});const state=g.status?.abstractGameState||'Preview';return{id:String(g.gamePk),date:g.gameDate,status:g.status?.detailedState||state,state:state==='Final'?'post':state==='Live'?'in':'pre',detail:state,home:team(g.teams?.home),away:team(g.teams?.away),league:'MLB',venue:g.venue?.name||'',broadcast:'',summaryAvailable:false}});
 }

 if(sport==='NBA'){
  // NBA's public schedule is documented by the open-source swar/nba_api project.
  // Use it only when the ESPN NBA scoreboard is unavailable.
  const r=await fetch('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw Error('NBA schedule fallback HTTP '+r.status);
  const p=await r.json();
  const dateParts=(value)=>{const m=String(value||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0'):null};
  return(p.leagueSchedule?.gameDates||[]).filter(x=>dateParts(x.gameDate)===date)
   .flatMap(x=>x.games||[]).filter(g=>String(g.gameId||'').startsWith('002'))
   .map(g=>{
    const team=x=>({name:[x?.teamCity,x?.teamName].filter(Boolean).join(' '),short:x?.teamName||'',
      abbreviation:x?.teamTricode||'',score:g.gameStatus===1?null:(x?.score??null),
      logo:x?.teamId?'https://cdn.nba.com/logos/nba/'+encodeURIComponent(x.teamId)+'/primary/L/logo.svg':'',record:null});
    const status=Number(g.gameStatus||1);
    return{id:String(g.gameId),date:g.gameDateTimeUTC||null,status:status===3?'Final':status===2?'In progress':'Scheduled',
      state:status===3?'post':status===2?'in':'pre',detail:g.gameStatusText||'',league:'NBA',
      home:team(g.homeTeam),away:team(g.awayTeam),venue:g.arenaName||'',summaryAvailable:false};
   });
 }
 if(sport==='NFL'){
  const {readCsv}=require('../lib/free-nfl');
  const rows=await readCsv('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv');
  const names={ARI:'Arizona Cardinals',ATL:'Atlanta Falcons',BAL:'Baltimore Ravens',BUF:'Buffalo Bills',CAR:'Carolina Panthers',CHI:'Chicago Bears',CIN:'Cincinnati Bengals',CLE:'Cleveland Browns',DAL:'Dallas Cowboys',DEN:'Denver Broncos',DET:'Detroit Lions',GB:'Green Bay Packers',HOU:'Houston Texans',IND:'Indianapolis Colts',JAX:'Jacksonville Jaguars',KC:'Kansas City Chiefs',LA:'Los Angeles Rams',LAC:'Los Angeles Chargers',LV:'Las Vegas Raiders',MIA:'Miami Dolphins',MIN:'Minnesota Vikings',NE:'New England Patriots',NO:'New Orleans Saints',NYG:'New York Giants',NYJ:'New York Jets',PHI:'Philadelphia Eagles',PIT:'Pittsburgh Steelers',SEA:'Seattle Seahawks',SF:'San Francisco 49ers',TB:'Tampa Bay Buccaneers',TEN:'Tennessee Titans',WAS:'Washington Commanders'};
  const offsetPart=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'}).formatToParts(new Date(date+'T12:00:00Z')).find(x=>x.type==='timeZoneName')?.value||'GMT-04:00';
  const offset=offsetPart.replace('GMT','')||'-04:00';
  return rows.filter(x=>x.gameday===date&&x.game_type==='REG').map(g=>{
   const time=/^\d{1,2}:\d{2}$/.test(g.gametime||'')?g.gametime.padStart(5,'0'):null;
   const when=time?date+'T'+time+':00'+offset:null;
   const homeScore=g.home_score!==''?Number(g.home_score):null,awayScore=g.away_score!==''?Number(g.away_score):null;
   const complete=g.result!==''&&g.result!=null||Number.isFinite(homeScore)&&Number.isFinite(awayScore),team=(abbr,score)=>({name:names[abbr]||abbr,short:(names[abbr]||abbr).split(' ').slice(-1)[0],abbreviation:abbr,logo:'',score,record:null});
   return{id:g.game_id||date+'_'+g.away_team+'_'+g.home_team,date:when,status:complete?'Final':'Scheduled',state:complete?'post':'pre',detail:time?'nflverse scheduled time':'Kickoff time not verified',home:team(g.home_team,homeScore),away:team(g.away_team,awayScore),venue:g.stadium||'',league:'NFL',summaryAvailable:false};
  });
 }
 throw Error('No independent public schedule backup configured for '+sport);
}

const LEAGUES={NHL:'hockey/nhl',NFL:'football/nfl',MLB:'baseball/mlb',NBA:'basketball/nba'};module.exports=async function handler(req,res){const sport=String(req.query.sport||'').toUpperCase();const day=String(req.query.date||'');if(!LEAGUES[sport]||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z')))return res.status(400).json({error:'Invalid sport or date'});const dates=day.replace(/-/g,'');try{const upstream=await fetch('https://site.api.espn.com/apis/site/v2/sports/'+LEAGUES[sport]+'/scoreboard?dates='+dates+'&limit=100',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});if(!upstream.ok)throw Error('Upstream '+upstream.status);const payload=await upstream.json();const games=(payload.events||[]).map(e=>{const c=e.competitions?.[0]||{};const sides=c.competitors||[];const home=sides.find(x=>x.homeAway==='home');const away=sides.find(x=>x.homeAway==='away');if(!home||!away)return null;const team=x=>({name:x.team?.displayName||'',short:x.team?.shortDisplayName||'',abbreviation:x.team?.abbreviation||'',logo:x.team?.logo||'',score:x.score??null,record:x.records?.[0]?.summary||null});return{id:e.id,date:e.date,status:e.status?.type?.description||'Scheduled',state:e.status?.type?.state||'pre',detail:e.status?.type?.shortDetail||'',league:e.league?.name||sport,home:team(home),away:team(away),venue:c.venue?.fullName||'',summaryAvailable:true,homeWinPct:home.records?.find(r=>r.type==='total')?.summary||home.records?.[0]?.summary||null,awayWinPct:away.records?.find(r=>r.type==='total')?.summary||away.records?.[0]?.summary||null,broadcast:c.broadcasts?.[0]?.names?.join(', ')||''}}).filter(Boolean);res.setHeader('Cache-Control','public,max-age=0,s-maxage=300,stale-while-revalidate=600');res.setHeader('X-Data-Source','ESPN public scoreboard');return res.status(200).json({sport,date:day,source:'ESPN public scoreboard',fetchedAt:new Date().toISOString(),games})}catch(e){try{const games=await publicSchedule(sport,day);res.setHeader('Cache-Control','public,max-age=0,s-maxage=300,stale-while-revalidate=600');res.setHeader('X-Data-Source',(sport==='NFL'?'nflverse public schedule':sport+' official public schedule'));return res.status(200).json({sport,date:day,source:(sport==='NFL'?'nflverse public game schedule (ESPN fallback)':sport+' official public schedule (ESPN fallback)'),fetchedAt:new Date().toISOString(),games,warning:'ESPN unavailable: public fallback schedule may omit game details, box scores, logos or verified kickoff times.'})}catch(e2){return res.status(502).json({error:'Both ESPN and official league schedule are unavailable',games:[]})}}};