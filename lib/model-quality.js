'use strict';
/**
 * SportsLab model process-quality rules (v2). These produce evidence-quality
 * scores, NOT calibrated win probabilities. No thresholds are learned from
 * one exceptional game; revisions require archived out-of-sample reviews.
 */
const n=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const scoringNames=new Set(['goals','assists','pts','receiving.td','rushing.td','passing.td','batting.hr','touchdowns']);
function scoringMarket(p){return scoringNames.has(String(p?.market||p?.stat||''))||Boolean(p?.group&&['goals','assists','touchdowns','homeRuns'].includes(p.group))}
function asMarket(p){return String(p?.market||p?.stat||'').toLowerCase()}
function isShots(p){return asMarket(p)==='sog'||asMarket(p)==='shots'||asMarket(p)==='shots_on_goal'}
function roleRequired(p){const m=asMarket(p);return m==='goals'||m==='assists'?'sog':m.includes('receiving.td')?'targets':m.includes('rushing.td')?'rushing.att':m==='batting.hr'?'pa':null}
function assessment(p,context={}){
  const flags=[],traces=[],line=n(p?.line??p?.point),market=asMarket(p),threshold=Number.isFinite(line)?line:null;
  const last10=p?.last10||{},last5=p?.last5||{},season=p?.season||{};
  const l10=n(last10.games)||0,l5=n(last5.games)||0,rate10=n(last10.rate),rate5=n(last5.rate);
  const avg=n(p?.average??last10.average),scorer=scoringMarket(p);
  let score=clamp(n(p?.evidenceScore)??0,0,100);
  if(!l10||rate10===null){flags.push('missing_historical_sample');score=Math.min(score,35)}
  else if(l10<5){flags.push('short_L10_sample');score=Math.min(score,48);traces.push('Fewer than five recorded games')}
  else if(l10<8){score-=5;flags.push('L10_under_eight_games')}
  if(l5>=3&&l10>=7&&rate5!==null&&rate10!==null){
    const delta=rate5-rate10;
    if(delta<-.19){score-=6;flags.push('recent_hit_rate_cooling')}
    else if(delta>.19){score+=3;flags.push('recent_hit_rate_improving')}
  }
  if(threshold!==null&&avg!==null){
    const side=String(p?.side||'Over').toLowerCase();
    const notSupported=side==='over'?avg<=threshold:avg>=threshold;
    if(notSupported){score-=11;flags.push('recent_average_against_line')}
  }
  const roster=String(p?.availability?.status||'').toLowerCase();
  if(roster==='out'||roster==='inactive'){score=0;flags.push('confirmed_unavailable')}
  if(['uncertain','questionable','doubtful'].includes(roster)){score-=14;flags.push('status_unconfirmed')}
  if(['unconfirmed','not_verified'].includes(roster))flags.push('lineup_unverified');
  if(!p?.lineupConfirmed&&scorer)flags.push('scorer_lineup_unconfirmed');
  const role=p?.opportunity||p?.role;
  const required=roleRequired(p);
  if(required&&!role?.verified){score-=8;flags.push('role_volume_not_verified')}
  if(role?.verified&&n(role.last10Average)!==null&&n(role.minimum)!==null&&n(role.last10Average)<n(role.minimum)){
    score-=12;flags.push('role_volume_below_floor')
  }
  const allowed=p?.positionAllowed||context.positionAllowed;
  if(allowed?.available&&n(allowed.games)>=3&&n(allowed.averagePerPlayer)!==null&&threshold!==null){
    const against=allowed.averagePerPlayer;const side=String(p?.side||'Over').toLowerCase();
    if(side==='over'&&against<=threshold*.72){score-=8;flags.push('opponent_position_restrictive')}
    if(side==='under'&&against>threshold*1.2){score-=8;flags.push('opponent_position_generous')}
    traces.push('Opponent position: '+allowed.games+' recorded games, per-player average '+against.toFixed(1));
  }else flags.push('position_defense_unverified');
  const h2h=p?.h2h||context.h2h;
  if(h2h?.games?.length>=3&&isShots(p)&&threshold!==null){
    const values=h2h.games.map(g=>n(g.value)).filter(v=>v!==null);
    if(values.length>=3){
      const floor=values.slice().sort((a,b)=>a-b)[0],missed=values.filter(x=>x<=threshold).length;
      // Do not boost 3+ shot props when previous direct meetings repeatedly stay at one or two shots.
      if(missed>=Math.ceil(values.length/2)){score-=10;flags.push('head_to_head_floor_concern')}
      traces.push('Verified H2H '+values.length+' games; floor '+floor+' shots');
    }
  }
  if(scorer){score-=6;flags.push('high_event_volatility')}
  const lineupSensitive=(market.startsWith('receiving.')||market.startsWith('passing.')||market.startsWith('rushing.')||market==='rec'||market==='targets');
  if(lineupSensitive&&context.quarterbackChange===true){score-=9;flags.push('starting_qb_change')}
  if(isShots(p)&&context.teamShotEnvironment==='low'){score-=6;flags.push('low_team_shot_environment')}
  if(context.gameScript==='high_variance'){score-=6;flags.push('unstable_game_script')}
  if(context.postseason===true&&market.startsWith('pitching.')){score-=5;flags.push('postseason_short_leash_risk')}
  if(context.verifiedStarter===false&&market.startsWith('pitching.')){score=0;flags.push('starter_unverified')}
  score=clamp(Math.round(score),0,95);
  let readiness='research';
  if(score===0||flags.includes('confirmed_unavailable')||flags.includes('starter_unverified'))readiness='exclude';
  else if(scorer||!p?.priced||flags.includes('lineup_unverified')||flags.includes('status_unconfirmed')||flags.includes('role_volume_not_verified'))readiness='watchlist';
  else if(l10>=5&&score>=55)readiness='candidate';
  else readiness='watchlist';
  return{score,readiness,flags:[...new Set(flags)],explanation:traces,sample:{last5:l5,last10:l10,season:n(season.games)||null},oddsVerified:Boolean(p?.priced),note:'Evidence-quality assessment, not a predicted success probability'};
}
function applyQuality(props,contextFor=()=>({})){
  for(const p of props){
    const quality=assessment(p,contextFor(p));
    p.quality=quality;
    // Baseline rankings are recalibrated to a conservative quality score,
    // never interpreted as a numeric likelihood of winning.
    p.evidenceScore=quality.score;
  }
  return props;
}
function sgpQuality(legs,context={}){
  const flags=[],persons=new Set(),games=new Set(),teams=new Map();
  let quality=0;
  for(const p of legs){
    const q=p.quality||assessment(p);
    quality+=q.score;
    const person=String(p.personId||p.player||'');
    if(persons.has(person))flags.push('same_player_duplicate');
    persons.add(person);games.add(String(p.gameId||p.game||''));
    const t=String(p.team||'');teams.set(t,(teams.get(t)||0)+1);
    if(q.readiness==='exclude')flags.push('excluded_prop_included');
    if(q.flags.includes('short_L10_sample'))flags.push('short_sample_in_sgp');
  }
  if(games.size>1)flags.push('mixed_games_not_sgp');
  // Same-game legs are NOT independent: one QB, one PP unit, or one tempo
  // shift can affect several selections simultaneously.
  if(legs.length>=4)flags.push('four_plus_correlated_legs');
  if([...teams.values()].some(n=>n>=3))flags.push('three_plus_legs_same_team');
  if(legs.some(x=>scoringMarket(x))&&legs.length>=4)flags.push('scorer_volume_correlation');
  if(context.verifiedCorrelation!==true)flags.push('correlation_unverified');
  const penalty=(flags.includes('four_plus_correlated_legs')?5:0)+(flags.includes('three_plus_legs_same_team')?7:0)+
    (flags.includes('correlation_unverified')?8:0)+(flags.includes('scorer_volume_correlation')?6:0);
  quality=Math.round(legs.length?quality/legs.length:0)-penalty;
  return{score:clamp(quality,0,95),flags:[...new Set(flags)],readiness:flags.includes('same_player_duplicate')||flags.includes('mixed_games_not_sgp')||flags.includes('excluded_prop_included')?'exclude':'research',note:'Combined parlay hit rates cannot be inferred by multiplying L5/L10 frequencies. Correlation and sportsbook acceptance require verification.'};
}
function outcome(line,value,side='Over'){
  const threshold=n(line),observed=n(value);
  if(threshold===null||observed===null)return'unknown';
  if(Math.abs(threshold-observed)<1e-10)return'push';
  return String(side).toLowerCase()==='under'?(observed<threshold?'hit':'miss'):(observed>threshold?'hit':'miss');
}
function gradeGameMarket(leg,match){
  if(!match||match.status!=='final')return{status:'pending',reason:'Game not confirmed final'};
  const home=n(match.homeScore),away=n(match.awayScore),kind=String(leg.market||'').toLowerCase(),side=String(leg.side||'').toLowerCase();
  if(home===null||away===null)return{status:'ungraded',reason:'Missing final score'};
  if(kind==='h2h'){const pick=side==='home'?home:side==='away'?away:null,opp=side==='home'?away:side==='away'?home:null;return{status:pick===null?'ungraded':pick===opp?'push':pick>opp?'hit':'miss',actual:pick,result:home+'-'+away}}
  if(kind==='spreads'){const line=n(leg.point);if(line===null)return{status:'ungraded',reason:'Missing original spread'};const diff=side==='home'?home-away:side==='away'?away-home:null;return{status:diff===null?'ungraded':outcome(-line,diff,'Over'),actual:diff,result:home+'-'+away}}
  if(kind==='totals')return{status:outcome(leg.point,home+away,side),actual:home+away,result:home+'-'+away};
  return{status:'ungraded',reason:'Market requires player/team-specific final stat'};
}
function reviewSelections(snapshot,gameResults,playerResults){
  const reviewed=[];
  const assign=(p,where)=>{
    const match=gameResults.find(g=>g.gameId&&String(g.gameId)===String(p.gameId)||g.gameKey&&String(g.gameKey)===String(p.gameKey));
    const kind=String(p.market||p.stat||'');
    let result;
    if(['h2h','spreads','totals'].includes(kind))result=gradeGameMarket(p,match);
    else{
      if(match?.status!=='final')result={status:'pending',reason:'Game unfinished or unmatched'};
      else{
        const player=playerResults.find(r=>String(r.gameId)===String(match.gameId)&&
          (String(r.personId)===String(p.personId)||String(r.player||'').toLowerCase()===String(p.player||'').toLowerCase())&&r.market===kind);
        result=player?{status:outcome(p.line??p.point,player.value,p.side),actual:player.value}:{
          status:'ungraded',reason:'Individual player stat not independently verified'};
      }
    }
    reviewed.push({where,game:p.gameLabel||p.game||null,player:p.player||null,market:kind,selection:p.selection||null,source:p.source||null,originalPrice:p.priced?p.price:null,originalBook:p.priced?p.book:null,...result});
    return result;
  };
  for(const p of snapshot?.ranked?.props||[])assign(p,'top10');
  for(const [i,sgp] of (snapshot?.ranked?.sgps||[]).entries()){
    const legs=(sgp.legs||[]).map(p=>assign(p,'sgp_'+(i+1)));
    reviewed.push({where:'sgp_'+(i+1)+'_summary',status:legs.some(x=>x.status==='miss')?'miss':legs.every(x=>x.status==='hit')?'hit':legs.some(x=>x.status==='ungraded')?'ungraded':'pending',legs:legs.length});
  }
  if(snapshot?.ranked?.crossGameParlay?.available){
    const legs=(snapshot.ranked.crossGameParlay.legs||[]).map(p=>assign(p,'cross_game'));
    reviewed.push({where:'cross_game_summary',status:legs.some(x=>x.status==='miss')?'miss':legs.every(x=>x.status==='hit')?'hit':'ungraded',legs:legs.length});
  }
  for(const p of snapshot?.scorers?.scorers||[])assign(p,'scorers');
  const graded=reviewed.filter(x=>['hit','miss','push'].includes(x.status)&&!x.where.endsWith('_summary'));
  const actionable=graded.filter(x=>x.status!=='push');
  const byMarket={};
  for(const x of actionable){if(!byMarket[x.market])byMarket[x.market]={hits:0,misses:0};byMarket[x.market][x.status==='hit'?'hits':'misses']++}
  return{date:snapshot?.date,reviewed,summary:{graded:graded.length,hits:graded.filter(x=>x.status==='hit').length,misses:graded.filter(x=>x.status==='miss').length,pushes:graded.filter(x=>x.status==='push').length,ungraded:reviewed.filter(x=>x.status==='ungraded').length,pending:reviewed.filter(x=>x.status==='pending').length,rate:actionable.length?graded.filter(x=>x.status==='hit').length/actionable.length:null,byMarket},notes:['Historical success is not evidence of a calibrated future success probability.','Missing individual stat is ungraded, never automatically recorded as a loss.','A one-day miss may reflect game script, injuries or variance; avoid modifying model weights without repeated out-of-sample evidence.']};
}
module.exports={assessment,applyQuality,sgpQuality,outcome,gradeGameMarket,reviewSelections,scoringMarket};
