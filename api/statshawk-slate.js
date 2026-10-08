
const detailStats={
  nhl:{sog:['skater','sog'],pts:['skater','pts'],goals:['skater','goals'],assists:['skater','assists'],blocks:['skater','blocks'],hits:['skater','hits'],saves:['goalie','saves']},
  nfl:{rec:['receiving','rec'],'receiving.rec':['receiving','rec'],targets:['receiving','targets'],'receiving.yards':['receiving','yards'],'rushing.yards':['rushing','yards'],'passing.yards':['passing','yards'],'rushing.att':['rushing','att'],'passing.att':['passing','att'],'passing.intc':['passing','intc'],'receiving.td':['receiving','td'],'rushing.td':['rushing','td'],'passing.td':['passing','td']},
  mlb:{'pitching.so':['pitching','so'],outs:['pitching','outs'],'pitching.bb':['pitching','bb'],'pitching.h':['pitching','h'],er:['pitching','er'],'batting.h':['batting','h'],'batting.hr':['batting','hr'],total_bases:['batting','total_bases'],rbi:['batting','rbi']}
};
const detailClean=x=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const detailItemId=x=>x?.person?.id||x?.person_id||x?.person||'';
const detailItems=x=>Array.isArray(x?.items)?x.items:Array.isArray(x?.players)?x.players:[];
const detailDate=x=>Date.parse(x?.kickoff||x?.date||'')||0;
const detailFinite=x=>Number.isFinite(Number(x))?Number(x):null;
const detailSummary=(rows,line,side)=>{
  const values=rows.map(x=>x.value).filter(Number.isFinite),hits=rows.filter(x=>x.hit).length;
  return{games:values.length,hits,rate:values.length?hits/values.length:null,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,line,side};
};
function detailFormatLog(entries,cutoff,side,line){
  return (entries||[]).filter(x=>Number.isFinite(Number(x.value))&&detailDate(x)>0&&detailDate(x)<cutoff).map(x=>{
    const v=Number(x.value),op=x.opponent||{},opponentId=op.team_id||op.id||null;
    return{date:x.kickoff||x.date,contestId:x.contest_id||null,opponent:op.name||null,opponentId,home:typeof x.home==='boolean'?x.home:null,value:v,hit:side==='under'?v<line:v>line};
  });
}
async function playerPropDetail(req,res,key){
  const league=String(req.query.league||'').toLowerCase(),personId=String(req.query.person_id||''),stat=String(req.query.stat||''),side=String(req.query.side||'over').toLowerCase();
  const line=Number(req.query.line),opponent=String(req.query.opponent||'').trim().slice(0,90),opponentQueryId=String(req.query.opponent_id||''),contestId=String(req.query.game_id||''),date=String(req.query.date||new Date().toISOString().slice(0,10));
  if(!detailStats[league]?.[stat]||!/^per_[a-z0-9]{18,40}$/.test(personId)||!['over','under'].includes(side)||!Number.isFinite(line)||line<0||line>1500||!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)||opponentQueryId&&!/^team_[a-z0-9]{18,40}$/.test(opponentQueryId)||contestId&&!/^cst_[a-z0-9]{18,40}$/.test(contestId)){
    return res.status(400).json({available:false,error:'Invalid player, prop, line, date or opponent reference'});
  }
  const seasonStart=Number(date.slice(0,4))-(league==='nhl'&&Number(date.slice(5,7))<9?1:league==='nfl'&&Number(date.slice(5,7))<3?1:0);
  const cutoff=Date.parse(date+'T23:59:59.999Z')+1;
  const request=async(url,timeout=8000)=>{
    const r=await fetch(url,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(timeout)});
    if(!r.ok)throw new Error(r.status===429?'StatsHawk usage quota exceeded':'Provider HTTP '+r.status);
    const body=await r.json();return body.data||{};
  };
  const propUrl=season=>{const u=new URL('https://api.statshawk.ai/v1/analysis/player-prop');for(const [k,v]of Object.entries({person_id:personId,stat,line,competition:league,season}))u.searchParams.set(k,String(v));return u.toString()};
  try{
    const main=await request(propUrl(seasonStart),10000);
    const pos=String(main.person?.bio?.position||'').toUpperCase();
    let log=detailFormatLog(main.game_log_detail,cutoff,side,line);
    const unique=new Map();
    for(const row of log)unique.set(row.contestId||row.date,row);
    const reasons=[],prevSeasons=[],matchesOpponent=row=>opponentQueryId&&row.opponentId===opponentQueryId||opponent&&detailClean(row.opponent)===detailClean(opponent);
    if(unique.size<10||[...unique.values()].filter(matchesOpponent).length<5){
      // Two prior regular seasons supply genuine previous meetings and L10 history when the current season is short.
      // This is triggered only on demand, never during initial slate ranking.
      const years=[seasonStart-1,seasonStart-2];
      const older=await Promise.allSettled(years.map(async year=>({year,data:await request(propUrl(year),8500)})));
      for(const result of older){
        if(result.status!=='fulfilled'){reasons.push('Some previous-season game logs were unavailable.');continue}
        const {year,data}=result.value;prevSeasons.push(year);
        for(const row of detailFormatLog(data.game_log_detail,cutoff,side,line)){
          unique.set(row.contestId||row.date,row);
        }
      }
    }
    const chronological=[...unique.values()].sort((a,b)=>detailDate(a)-detailDate(b));
    const recent10=chronological.slice(-10),recent5=recent10.slice(-5);
    let vs=chronological.filter(matchesOpponent).slice(-5);
    let positionAllowed={available:false,opponent:opponent||null,position:pos||null,reason:!opponent?'Opponent not identified for this player.':'Verified opponent-by-position box scores are not available.'};
    let opponentId=opponentQueryId||chronological.find(matchesOpponent)?.opponentId||null;
    const teamIdPattern=/^team_[a-z0-9]{18,40}$/;
    const nameResolution=()=>opponentId&&teamIdPattern.test(opponentId);
    // Find the exact upcoming opponent, using canonical game identities and rosters, never partial nickname guessing.
    if(!nameResolution()&&opponent){
      try{
        const t=await request('https://api.statshawk.ai/v1/competitions/'+league+'/editions/'+seasonStart+'/teams',6000);
        const teams=detailItems(t);
        const found=teams.find(x=>detailClean(x.name||x.team?.name)===detailClean(opponent));
        if(found)opponentId=found.id||found.team?.id||found.team_id||null;
      }catch(e){reasons.push('Opponent team identifier could not be verified.')}
    }
    if(!nameResolution()&&contestId&&league!=='mlb'){
      try{
        const sched=await request('https://api.statshawk.ai/v1/competitions/'+league+'/editions/'+seasonStart+'/games?date='+encodeURIComponent(date),6500);
        const game=detailItems(sched).find(x=>x.id===contestId);
        const home=game?.home_team||game?.home_team_id,away=game?.away_team||game?.away_team_id;
        if(teamIdPattern.test(home||'')&&teamIdPattern.test(away||'')){
          const rosters=await Promise.allSettled([home,away].map(id=>request('https://api.statshawk.ai/v1/teams/'+id+'/roster',6500)));
          const own=(rosters[0].status==='fulfilled'&&detailItems(rosters[0].value).some(x=>detailItemId(x)===personId))?home:(rosters[1].status==='fulfilled'&&detailItems(rosters[1].value).some(x=>detailItemId(x)===personId))?away:null;
          if(own)opponentId=own===home?away:home;
          if(own&&!opponent){
            const n=own===home?game.away_team_name:game.home_team_name;
            positionAllowed.opponent=n||null;
          }
        }
      }catch(e){reasons.push('Current-game roster verification was unavailable.')}
    }
    // Rebuild last five H2H with the canonical opponent ID if available.
    if(nameResolution()){
      vs=chronological.filter(row=>row.opponentId===opponentId||opponent&&detailClean(row.opponent)===detailClean(opponent)).slice(-5);
    }
    if(['nhl','nfl'].includes(league)&&nameResolution()&&pos&&pos!=='G'){
      try{
        const t=await request('https://api.statshawk.ai/v1/teams/'+opponentId+'/games?competition='+league+'&season='+seasonStart,7000);
        const selected=detailItems(t).filter(g=>g.status==='final'&&String(g.stage||'').toLowerCase()==='regular'&&(g.home_team===opponentId||g.away_team===opponentId)&&/^cst_[a-z0-9]{18,40}$/.test(g.id||'')&&detailDate(g)<cutoff).sort((a,b)=>detailDate(b)-detailDate(a)).slice(0,5).map(g=>({...g,game:g.id,opponent:g.home_team===opponentId?g.away_team:g.home_team}));
        if(selected.length){
          const [phase,measure]=detailStats[league][stat];
          const boxData=await Promise.allSettled(selected.map(async g=>{
            const [box,roster]=await Promise.all([
              request('https://api.statshawk.ai/v1/contests/'+g.game+'/boxscore',7200),
              request('https://api.statshawk.ai/v1/teams/'+g.opponent+'/roster?season='+seasonStart,7200)
            ]);
            const posMap=new Map(detailItems(roster).map(x=>[detailItemId(x),String(x.person?.bio?.position||x.position||'').toUpperCase()]));
            const appearances=(box.lines||box.players||[]).filter(x=>{
              const id=detailItemId(x),team=x.team||x.team_id;
              return team===g.opponent&&posMap.get(id)===pos;
            });
            let total=0,players=0,hits=0;
            for(const row of appearances){
              const p=(row.phases||[]).find(x=>x.phase===phase),v=detailFinite(p?.measures?.[measure]);
              if(v===null)continue;
              total+=v;players++;if(side==='under'?v<line:v>line)hits++;
            }
            return{date:g.kickoff,opponentId:g.opponent,players,total,hits,hasRecordedStat:players>0};
          }));
          const rows=boxData.filter(x=>x.status==='fulfilled'&&x.value.hasRecordedStat).map(x=>x.value).sort((a,b)=>detailDate(a)-detailDate(b));
          if(rows.length){
            const sum=rows.reduce((acc,x)=>acc+x.total,0),playerApps=rows.reduce((acc,x)=>acc+x.players,0),hits=rows.reduce((acc,x)=>acc+x.hits,0);
            positionAllowed={available:true,opponent:positionAllowed.opponent||opponent||null,position:pos,stat,unit:stat,season:seasonStart,games:rows.length,requestedGames:Math.min(5,selected.length),averageCombined:sum/rows.length,averagePerPlayer:playerApps?sum/playerApps:null,playerAppearances:playerApps,playerHits:hits,playerHitRate:playerApps?hits/playerApps:null,gamesWithPositionHit:rows.filter(x=>x.hits>0).length,byGame:rows,source:'StatsHawk opponent game logs, historical rosters and box scores',note:'Regular-season games only. Combined allowed totals and per-player figures are descriptive, not individual projections or calibrated probabilities.'};
          }else reasons.push('Recent opponent box scores did not contain confirmed position-level stats.');
        }else reasons.push('No completed regular-season opponent games with eligible positional statistics were found this season.');
      }catch(e){reasons.push('Position allowed could not be verified from opponent box scores.')}
    }else if(league==='mlb'){
      reasons.push('Baseball pitcher/batter platoon and lineup context is not the same as a position-allowed defensive split.');
    }
    const selectedName=opponent||positionAllowed.opponent||null;
    const result={available:true,provider:'StatsHawk',league,personId,player:main.person?.bio?.display_name||main.person?.bio?.full_name||null,position:pos||null,stat,line,side,selectedOpponent:selectedName,scope:'Current and up to two prior regular seasons (where needed)',seasonsIncluded:[seasonStart,...prevSeasons],last5:{games:recent5,summary:detailSummary(recent5,line,side)},last10:{games:recent10,summary:detailSummary(recent10,line,side)},headToHead:{games:vs,summary:detailSummary(vs,line,side),opponent:selectedName,note:vs.length?'Most recent available verified games against this opponent (maximum 5).':'No verified prior meetings in the seasons checked.'},positionAllowed,notes:[...new Set(reasons)],notice:'Charts use recorded appearances only. Averages and opponent-by-position stats are descriptive, not forecasts. Missing sample values are never substituted with zero.'};
    res.setHeader('Cache-Control','public,max-age=0,s-maxage=3600,stale-while-revalidate=10800');
    return res.json(result);
  }catch(e){
    return res.status(502).json({available:false,error:String(e.message||'').includes('quota')?'StatsHawk data quota reached':'Player game logs temporarily unavailable',last5:null,last10:null,headToHead:null,positionAllowed:null});
  }
}

const base='https://api.statshawk.ai/v1';module.exports=async(req,res)=>{const key=process.env.STATSHAWK_API_KEY;if(!key)return res.status(503).json({available:false,provider:'StatsHawk',reason:'STATSHAWK_API_KEY is not configured. Public league feeds remain available.'});if(String(req.query.mode||'')==='prop-detail')return playerPropDetail(req,res,key);if(String(req.query.mode||'')==='player'){const pid=String(req.query.person_id||''),league=String(req.query.league||'nfl').toLowerCase(),stat=String(req.query.stat||({nhl:'sog',mlb:'pitching.so',nfl:'rec'}[league]||'rec')),line=Number(req.query.line??3.5);const markets={nfl:['rec','receiving.rec','targets','receiving.yards','rushing.yards','passing.yards','rushing.att','passing.att','intc','passing.td','rushing.td','receiving.td'],nhl:['sog','pts','goals','assists','blocks','hits'],mlb:['pitching.so','outs','pitching.bb','pitching.h','er','batting.h','batting.hr','total_bases','rbi']},allow=markets[league]||[];if(!/^per_[a-z0-9]+$/.test(pid)||!allow.includes(stat)||!Number.isFinite(line)||line<0||line>1000)return res.status(400).json({error:'Invalid player, market or line'});try{const u=new URL(base+'/analysis/player-prop');for(const[k,v]of Object.entries({person_id:pid,stat,line,competition:league}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)return res.status(r.status===401?502:r.status).json({available:false,provider:'StatsHawk',error:r.status===429?'Monthly quota exceeded':'Player history unavailable',providerStatus:r.status});const p=await r.json(),d=p.data||{};res.setHeader('Cache-Control','public,max-age=0,s-maxage=900');return res.json({available:true,provider:'StatsHawk',source:'StatsHawk historical player-prop card',league,player:d.person?.bio?.display_name||null,stat,line,averages:d.averages||null,hitRates:d.hit_rates||null,games:d.games??0,recent:(d.game_log_detail||[]).slice(-10).map(x=>({date:x.kickoff,value:x.value,opponent:x.opponent?.name||null})),caveat:'Historical observed hit rates, not prediction or verified bet365 line.'})}catch(e){return res.status(502).json({available:false,error:'Historical player analysis unavailable'})}}
const mode=String(req.query.mode||'');
if(mode==='odds'||mode==='odds-markets'){
  const contest=String(req.query.contest||'');
  if(!/^cst_[a-z0-9]{20,36}$/.test(contest))return res.status(400).json({available:false,error:'Invalid game reference'});
  const person=String(req.query.person_id||'');
  if(person&&!/^per_[a-z0-9]{20,36}$/.test(person))return res.status(400).json({available:false,error:'Invalid player reference'});
  try{
    const path=mode==='odds-markets'?'/contests/'+contest+'/odds/markets':person?'/persons/'+person+'/odds':'/contests/'+contest+'/odds';
    const u=new URL(base+path);
    if(person)u.searchParams.set('contest',contest);
    const m=String(req.query.markets||'');if(m&&/^(h2h|spreads|totals|team_total|player_prop)(,(h2h|spreads|totals|team_total|player_prop))*$/.test(m))u.searchParams.set('markets',m);
    const measure=String(req.query.measure||'');if(measure&&/^[a-z0-9_.]{1,40}$/.test(measure))u.searchParams.set('measure',measure);
    const r=await fetch(u,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return res.status(r.status===404?200:r.status===401?502:r.status).json({available:false,provider:'StatsHawk',error:r.status===404?'No odds posted for this contest':r.status===429?'API quota exceeded':'Odds feed unavailable',providerStatus:r.status,data:[]});
    const p=await r.json(),data=p.data||{};
    const bookPriority=['bet365','draftkings','fanduel'];
    const preferredOffers=[];
    for(const market of (Array.isArray(data.items)?data.items:[])){
      if(market.period!=='full')continue;
      for(const side of market.sides||[]){
        const entries=Object.entries(side.books||{});
        let found=null;
        for(const wanted of bookPriority){
          const match=entries.find(([id])=>id.toLowerCase().replace(/[^a-z0-9]/g,'').startsWith(wanted));
          if(!match)continue;
          const quotes=(Array.isArray(match[1])?match[1]:[]).filter(x=>Number.isFinite(Number(x.price))&&!x.withdrawn).sort((a,b)=>Date.parse(b.observed_at||0)-Date.parse(a.observed_at||0));
          if(quotes.length){found={book:wanted==='bet365'?'bet365':wanted==='draftkings'?'DraftKings':'FanDuel',quote:quotes[0]};break}
        }
        if(!found)continue;
        preferredOffers.push({market:String(market.market||''),period:market.period,measure:market.measure||null,subject:market.subject||null,outcome:side.outcome||null,book:found.book,price:found.quote.price,point:found.quote.point??null,observedAt:found.quote.observed_at||null});
      }
    }
    res.setHeader('Cache-Control','public,max-age=0,s-maxage=120,stale-while-revalidate=300');
    return res.json({available:true,contest,mode,provider:'StatsHawk pregame odds',data,preferredOffers,meta:p.meta||null,booksPreference:['bet365','draftkings','fanduel'],notice:'Pregame reference quotes only. Never label a price as a sportsbook unless that book is explicitly present.'});
  }catch(e){return res.status(502).json({available:false,error:'Odds feed unreachable'})}
}

if(mode==='season-pitch-map'){
  const pitcher=String(req.query.pitcher||''),batter=String(req.query.batter||''),season=Number(req.query.season||new Date().getUTCFullYear());
  if(!/^per_[a-z0-9]{20,36}$/.test(pitcher)||!/^per_[a-z0-9]{20,36}$/.test(batter)||pitcher===batter||!Number.isInteger(season)||season<2020||season>new Date().getUTCFullYear())return res.status(400).json({available:false,error:'Select a pitcher, batter and valid season'});
  try{
    const headers={'X-API-Key':key,Accept:'application/json'},signal=AbortSignal.timeout(18000);
    const url=id=>base+'/persons/'+id+'/game-log?competition=mlb&season='+season+'&stage=all';
    const [pr,br]=await Promise.all([fetch(url(pitcher),{headers,signal}),fetch(url(batter),{headers,signal})]);
    if(!pr.ok||!br.ok)return res.status(502).json({available:false,error:'Season game-log lookup unavailable'});
    const [pp,bp]=await Promise.all([pr.json(),br.json()]);const pitchGames=pp.data?.items||[],batGames=bp.data?.items||[];
    const names={pitcher:pitchGames.find(x=>x.line?.person_name)?.line?.person_name||null,batter:batGames.find(x=>x.line?.person_name)?.line?.person_name||null};
    const pitSet=new Set(pitchGames.map(x=>x.game));
    const shared=[...new Map(batGames.filter(x=>pitSet.has(x.game)&&/^cst_[a-z0-9]{20,36}$/.test(x.game)&&Date.parse(x.kickoff||0)<=Date.now()).map(x=>[x.game,x])).values()].sort((a,b)=>Date.parse(b.kickoff)-Date.parse(a.kickoff));
    const recent=shared.slice(0,10);
    const replies=await Promise.all(recent.map(async x=>{try{const u=new URL(base+'/contests/'+x.game+'/play-by-play');u.searchParams.set('detail','full');u.searchParams.set('pitcher_id',pitcher);u.searchParams.set('batter_id',batter);const r=await fetch(u,{headers,signal});return r.ok?{game:x.game,p:(await r.json()).data||{}}:null}catch(e){return null}}));
    const pitches=[];let appearances=0,matchedGames=0;
    for(const item of replies.filter(Boolean)){const pa=item.p.plate_appearances||[];if(pa.length)matchedGames++;appearances+=pa.length;
      for(const a of pa){const hit=['single','double','triple','home_run'].includes(String(a.event_type||'').toLowerCase());for(const t of a.pitches||[]){const px=Number(t.plate_x),pz=Number(t.plate_z);pitches.push({pitcher,batter,number:t.pitch_number_game??t.pitch_number??null,type:String(t.pitch_type||'Unknown'),code:String(t.pitch_type_code||''),speed:Number.isFinite(Number(t.start_speed))?Number(t.start_speed):null,x:Number.isFinite(px)?px:null,z:Number.isFinite(pz)?pz:null,zone:Number.isInteger(t.zone)?t.zone:null,call:String(t.call_description||''),inPlay:!!t.is_in_play,whiff:/swinging strike/i.test(String(t.call_description||'')),swing:!!t.is_in_play||/swing|foul/i.test(String(t.call_description||'')),hit:!!t.is_in_play&&hit,event:String(a.event||''),inning:a.inning,half:a.half_inning,game:item.game})}}}
    res.setHeader('Cache-Control','public,max-age=0,s-maxage=1800,stale-while-revalidate=10800');
    return res.json({available:true,scope:'season-h2h',season,source:'StatsHawk real 2026 direct H2H Statcast',pitchCount:pitches.length,pitches:pitches.slice(0,1000),plateAppearances:appearances,sharedGames:shared.length,gamesScanned:recent.length,gamesWithPitches:matchedGames,truncated:shared.length>10,pitchers:[{id:pitcher,name:names.pitcher,count:pitches.length}],batters:[{id:batter,name:names.batter,count:pitches.length}],notice:'Direct head-to-head game logs for requested season; maximum 10 shared games inspected. When no pitch records exist, no estimate is generated.'});
  }catch(e){return res.status(502).json({available:false,error:'Season matchup temporarily unavailable'})}
}

if(mode==='pitch-map'){
  const contest=String(req.query.contest||'');
  if(!/^cst_[a-z0-9]{20,36}$/.test(contest))return res.status(400).json({available:false,error:'Choose a valid MLB game'});
  try{
    const opts={headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(16000)};
    const [raw,box]=await Promise.all([fetch(base+'/contests/'+contest+'/play-by-play?detail=full',opts),fetch(base+'/contests/'+contest+'/boxscore',opts)]);
    if(!raw.ok)return res.status(raw.status===429?429:502).json({available:false,error:raw.status===429?'Statshawk quota reached':'Pitch history unavailable'});
    const p=await raw.json(),d=p.data||{},pa=Array.isArray(d.plate_appearances)?d.plate_appearances:[];
    let names={};if(box.ok){const b=await box.json(),bd=b.data||{};for(const x of bd.lines||bd.players||[]){const id=typeof x.person==='string'?x.person:x.person_id||x.person?.id;const n=x.player_name||x.person_name||x.name||x.person?.bio?.display_name;if(id&&n)names[id]=n}}
    const pitchers=new Map(),batters=new Map(),pitches=[];
    for(const a of pa.slice(0,150)){
      if(!a.pitcher_id||!a.batter_id)continue;
      pitchers.set(a.pitcher_id,(pitchers.get(a.pitcher_id)||0)+(a.pitches||[]).length);
      batters.set(a.batter_id,(batters.get(a.batter_id)||0)+(a.pitches||[]).length);
      const isHit=['single','double','triple','home_run'].includes(String(a.event_type||'').toLowerCase());
      for(const pitch of a.pitches||[]){
        const x=Number(pitch.plate_x),z=Number(pitch.plate_z);
        pitches.push({pitcher:a.pitcher_id,batter:a.batter_id,number:pitch.pitch_number_game??pitch.pitch_number??null,type:String(pitch.pitch_type||'Unknown'),code:String(pitch.pitch_type_code||''),speed:Number.isFinite(Number(pitch.start_speed))?Number(pitch.start_speed):null,x:Number.isFinite(x)?x:null,z:Number.isFinite(z)?z:null,zone:Number.isInteger(pitch.zone)?pitch.zone:null,call:String(pitch.call_description||''),inPlay:!!pitch.is_in_play,whiff:/swinging strike/i.test(String(pitch.call_description||'')),swing:!!pitch.is_in_play||/swing|foul/i.test(String(pitch.call_description||'')),hit:!!pitch.is_in_play&&isHit,event:String(a.event||''),inning:a.inning,half:a.half_inning});
      }
    }
    res.setHeader('Cache-Control','public,max-age=0,s-maxage=1800,stale-while-revalidate=7200');
    return res.json({available:true,contest,source:'StatsHawk pitch-level Statcast, one game',plateAppearances:pa.length,pitchCount:pitches.length,pitches:pitches.slice(0,500),pitchers:[...pitchers].sort((a,b)=>b[1]-a[1]).map(([id,count])=>({id,name:names[id]||null,count})),batters:[...batters].sort((a,b)=>b[1]-a[1]).map(([id,count])=>({id,name:names[id]||null,count})),notice:'Single-game pitch locations only. Zone average is hits / balls in play in that zone. Not season-long batter average, xBA or a predictive model.'});
  }catch(e){return res.status(502).json({available:false,error:'Could not retrieve pitch locations'})}
}
const league=String(req.query.league||'').toLowerCase(),date=String(req.query.date||'');if(!['nhl','nfl','mlb'].includes(league)||!/^(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date))return res.status(400).json({error:'Invalid league or date'});try{const year=Number(date.slice(0,4))-(league==='nfl'&&Number(date.slice(5,7))<3?1:0);const url=base+'/competitions/'+league+'/editions/'+year+'/games?date='+encodeURIComponent(date);const response=await fetch(url,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(9000)});if(!response.ok)return res.status(response.status===401?502:response.status).json({available:false,provider:'StatsHawk',error:response.status===401?'Provider authentication rejected':response.status===429?'Provider quota exhausted':'Provider request failed',providerStatus:response.status});const p=await response.json();res.setHeader('Cache-Control','public,max-age=0,s-maxage=300');return res.json({available:true,provider:'StatsHawk',league,date,games:p.data?.items||[],meta:p.meta||null})}catch(e){return res.status(502).json({available:false,provider:'StatsHawk',error:'Provider unavailable'})}};