'use strict';
const C=require('./free-core');
const ROOT='https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_';
const SCHEDULE='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const ESPN='https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
function cells(line){const arr=[];let cell='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){arr.push(cell);cell=''}else cell+=c}arr.push(cell);return arr}
async function csv(url){
 const r=await fetch(url,{headers:{Accept:'text/csv','User-Agent':'SportsLab-Research/1.0'},signal:AbortSignal.timeout(11500)});
 if(!r.ok)throw Error('NFL historical CSV source '+r.status);
 const bytes=Number(r.headers.get('content-length')||0);
 if(bytes>22000000)throw Error('NFL CSV exceeds bounded serverless ingestion budget');
 const txt=await r.text();
 if(txt.length>22000000||!txt.includes('season'))throw Error('NFL CSV unavailable or malformed');
 const lines=txt.trim().split(/\r?\n/),keys=cells(lines.shift().replace(/^\uFEFF/,'')),out=[];
 for(const row of lines){if(!row)continue;const x=cells(row);if(x.length!==keys.length)continue;const record={};for(let i=0;i<keys.length;i++)record[keys[i]]=x[i];out.push(record)}
 return out;
}
function abbrev(s){const x=String(s||'').toUpperCase();return({LAR:'LA',WSH:'WAS',JAX:'JAX',JAC:'JAX'})[x]||x}
function key(season,week,team){return season+'|'+week+'|'+abbrev(team)}
function extractGamePairs(rows){
 const result=new Map();
 for(const g of rows){
  if(!/^\d{4}-\d\d-\d\d$/.test(g.gameday||'')||!['REG','WC','DIV','CON','SB'].includes(g.game_type))continue;
  for(const [team,opp] of [[g.home_team,g.away_team],[g.away_team,g.home_team]])result.set(key(g.season,g.week,team),{date:g.gameday,opponent:abbrev(opp),home:abbrev(g.home_team),away:abbrev(g.away_team),gameId:g.game_id});
 }
 return result;
}
function dataLog(rows,metric,map){
 return rows.map(x=>{const game=map.get(key(x.season,x.week,x.recent_team)),v=C.numeric(x[metric]);return game&&v!==null?{date:game.date,opponent:game.opponent,opponentId:game.opponent,value:v,gameId:game.gameId,season:Number(x.season),week:Number(x.week)}:null}).filter(Boolean);
}
function allowedToPosition(all,player,metric,upcoming,history){
 const defense=abbrev(upcoming?.opponentAbbr),position=player.position;
 if(!defense||!position)return null;
 const opponentWeeks=[...history.entries()].filter(([,g])=>g.date&&g.date<upcoming.date&&(g.home===defense||g.away===defense)).sort((a,b)=>b[1].date.localeCompare(a[1].date));
 const unique=new Map();
 for(const [,g] of opponentWeeks){if(!unique.has(g.gameId))unique.set(g.gameId,g);if(unique.size>=5)break}
 const values=[];
 for(const g of unique.values()){
  const offense=g.home===defense?g.away:g.home;
  const eligible=all.filter(x=>String(x.season)===String(g.gameId||'').split('_')[0]&&abbrev(x.recent_team)===offense&&x.position===position&&dataLog([x],metric,history).some(t=>t.date===g.date));
  let total=0,count=0,hits=0;
  for(const x of eligible){const val=C.numeric(x[metric]);if(val!==null){total+=val;count++;if(val>upcoming.line)hits++}}
  if(count)values.push({date:g.date,total,players:count,hits});
 }
 if(!values.length)return null;
 const playerAppearances=values.reduce((a,b)=>a+b.players,0),sum=values.reduce((a,b)=>a+b.total,0),playerHits=values.reduce((a,b)=>a+b.hits,0);
 return{available:true,opponent:upcoming.opponentName,position,stat:metric,games:values.length,averageCombined:sum/values.length,averagePerPlayer:sum/playerAppearances,playerAppearances,playerHits,playerHitRate:playerHits/playerAppearances,byGame:values.reverse(),note:'Historical position-wide stats from nflverse weekly player game logs. Not an individual projection.',source:'nflverse weekly stats + historical NFL schedule'};
}
async function run(date){
 const warnings=[],sources=['ESPN NFL public scoreboard','nflverse official-data-derived weekly player CSV','nflverse/nfldata historical game schedule'];
 const season=Number(date.slice(0,4))-(Number(date.slice(5,7))<3?1:0);

 let games=[],espnOk=false;
 try{
  const current=await C.getJSON(ESPN+'?dates='+date.replace(/-/g,'')+'&limit=100',7000);
  games=(current.events||[]).map(e=>{
   const c=e.competitions?.[0]||{},home=c.competitors?.find(t=>t.homeAway==='home'),away=c.competitors?.find(t=>t.homeAway==='away');
   if(!home||!away)return null;
   return{id:String(e.id),date:e.date,homeAbbr:abbrev(home.team?.abbreviation),awayAbbr:abbrev(away.team?.abbreviation),homeName:home.team?.displayName||home.team?.name,awayName:away.team?.displayName||away.team?.name,state:e.status?.type?.state};
  }).filter(g=>g&&g.homeAbbr&&g.awayAbbr&&Date.parse(g.date)>Date.now()+60000);
  espnOk=true;
 }catch(e){warnings.push('ESPN NFL schedule unavailable; falling back to the nflverse historical schedule if possible.')}
 const sourceResults=await Promise.allSettled([
  csv(ROOT+season+'.csv'),
  csv(ROOT+(season-1)+'.csv'),
  csv(SCHEDULE)
 ]);
 if(!games.length&&!espnOk&&sourceResults[2].status==='fulfilled'){
  games=sourceResults[2].value.filter(g=>g.gameday===date&&g.game_type==='REG'&&g.home_team&&g.away_team&&!(g.home_score&&g.away_score)).map(g=>({
   id:g.game_id,date:g.gameday,homeAbbr:abbrev(g.home_team),awayAbbr:abbrev(g.away_team),homeName:abbrev(g.home_team),awayName:abbrev(g.away_team),state:'scheduled'
  }));
  if(games.length)warnings.push('Upcoming NFL games resolved from nflverse; exact kickoff times and active rosters are not confirmed.');
 }
 if(!games.length)return{league:'nfl',entries:[],warnings:[...warnings,'No confirmed upcoming NFL games remain for '+date+'.'],sources};
 if(sourceResults[2].status!=='fulfilled')throw Error('The free NFL schedule crosswalk was unavailable; cannot assign observed weeks to verified opponents or dates.');
 const gamesIndex=extractGamePairs(sourceResults[2].value);
 const data=[...sourceResults.slice(0,2).filter(r=>r.status==='fulfilled').flatMap(r=>r.value)].filter(x=>x.season_type==='REG'||x.season_type==='reg'||x.season_type==='Regular');
 if(!data.length)throw Error('No nflverse weekly player data available to verify current NFL props.');
 if(sourceResults.some(r=>r.status==='rejected'))warnings.push('One or more nflverse historical releases were unavailable. Sample sizes may be reduced.');
 const roster=new Set(games.flatMap(g=>[g.homeAbbr,g.awayAbbr])),players=new Map();
 for(const p of data){
  const name=p.player_display_name||p.player_name,team=abbrev(p.recent_team),position=String(p.position||'').toUpperCase();
  if(!roster.has(team)||!name||!['QB','RB','WR','TE'].includes(position)||!gamesIndex.has(key(p.season,p.week,p.recent_team)))continue;
  const id=p.player_id||name+'|'+team;
  const k=id+'|'+team;
  if(!players.has(k))players.set(k,[]);
  players.get(k).push(p);
 }
 const entries=[],matchups=new Map();
 for(const g of games){
  matchups.set(g.homeAbbr,{team:g.homeAbbr,opponentAbbr:g.awayAbbr,opponentName:g.awayName,teamName:g.homeName,game:g,date});
  matchups.set(g.awayAbbr,{team:g.awayAbbr,opponentAbbr:g.homeAbbr,opponentName:g.homeName,teamName:g.awayName,game:g,date});
 }
 for(const playerRows of players.values()){
  const last=playerRows[playerRows.length-1],position=last.position,team=abbrev(last.recent_team),matchup=matchups.get(team);
  if(!matchup)continue;
  const common={league:'nfl',date,personId:last.player_id||last.player_display_name,player:last.player_display_name||last.player_name,team:matchup.teamName,teamId:team,opponent:matchup.opponentName,opponentId:matchup.opponentAbbr,game:matchup.game.awayName+' @ '+matchup.game.homeName,gameId:matchup.game.id,gameKey:matchup.game.id,position,lineupStatus:'NFL weekly appearance verified; game-day actives and starting role unconfirmed',source:'nflverse weekly player stats',verifiedGame:true};
  const options=position==='QB'?[['passing.yards','passing_yards',179.5,'Over 179.5 passing yards']]:position==='RB'?[['rushing.yards','rushing_yards',39.5,'Over 39.5 rushing yards']]:[['rec','receptions',2.5,'Over 2.5 receptions'],['receiving.yards','receiving_yards',29.5,'Over 29.5 receiving yards']];
  const ranked=[];
  for(const [market,col,line,selection] of options){
   const p=C.makePick({...common,market,line,selection,logs:dataLog(playerRows,col,gamesIndex)});
   if(p.last10.games>=3&&p.last10.rate>=.5&&p.average>line){
    const allowed=allowedToPosition(data,last,col,{...matchup,line},gamesIndex);if(allowed)p.positionAllowed=allowed;
    ranked.push(p);
   }
  }
  ranked.sort((a,b)=>b.evidenceScore-a.evidenceScore);
  if(ranked.length)entries.push(ranked[0]);
  const scoreTypes=position==='RB'?[['rushing.td','rushing_tds']]:position==='WR'||position==='TE'?[['receiving.td','receiving_tds']]:[];
  for(const [market,col] of scoreTypes){
   const p=C.makePick({...common,market,line:.5,selection:position==='RB'?'Anytime rushing TD':'Anytime receiving TD',group:'touchdowns',logs:dataLog(playerRows,col,gamesIndex)});
   if(p.last10.games>=3&&p.last10.rate>=.18){const used=position==='RB'?'carries':'targets';p.opportunity={verified:true,stat:used,last10Average:C.summary(dataLog(playerRows,used,gamesIndex).slice(-10),0).average};entries.push(p)}
  }
 }
 warnings.push('nflverse weekly data can lag completed games. ESPN scoreboard verifies today’s matchups but not live injuries, actives or depth-chart roles.');
 if(!entries.length)warnings.push('No current NFL matchup has enough matched weekly player history for a qualified free research candidate.');
 return{league:'nfl',entries,warnings,sources,games:games.length,playersMatched:players.size};
}
module.exports={run,cells,extractGamePairs,readCsv:csv};
