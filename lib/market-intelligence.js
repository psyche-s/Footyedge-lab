'use strict';
/**
 * SportsLab independent market math.
 * Data ingestion is intentionally separate: this module does NOT scrape a
 * sportsbook or imply a betting edge when no licensed/authorized quote exists.
 */
const EPS=1e-9,finite=x=>typeof x==='number'&&Number.isFinite(x),round=(n,d=4)=>finite(n)?Number(n.toFixed(d)):null;
function decimal(american){
  if(!finite(american)||american===0||Math.abs(american)<100) return null;
  return american>0?1+american/100:1+100/Math.abs(american);
}
function american(decimalOdds){
  if(!finite(decimalOdds)||decimalOdds<=1)return null;
  return Math.round(decimalOdds>=2?(decimalOdds-1)*100:-100/(decimalOdds-1));
}
function implied(americanOdds){const d=decimal(americanOdds);return d===null?null:1/d}
function noVig(americanOdds){
  if(!Array.isArray(americanOdds)||americanOdds.length<2||americanOdds.length>3)return null;
  const raw=americanOdds.map(implied);
  if(raw.some(x=>x===null))return null;
  const sum=raw.reduce((a,b)=>a+b,0);
  if(sum<=0)return null;
  return{probabilities:raw.map(p=>p/sum),rawProbabilities:raw,overround:sum-1,method:'multiplicative',note:'Consensus market proxy, NOT a verified true probability; only outcomes of the same exhaustive market may be normalized.'};
}
function edge(probability,americanOdds){
  const d=decimal(americanOdds);
  if(!finite(probability)||probability<0||probability>1||d===null)return null;
  const roi=probability*d-1;
  return{roi:round(roi,6),breakEven:1/d,fairDecimal:probability>0?1/probability:null,fairAmerican:probability>0?american(1/probability):null,
    expectedProfitPer100:round(100*roi,2)};
}
function probabilityEvidence({modelProbability=null,calibrated=false,modelGames=0,fairMarketProbability=null,sharpBooks=0}={}){
  if(finite(modelProbability)&&calibrated&&modelGames>=75&&modelProbability>=0&&modelProbability<=1)
    return{usable:true,p:modelProbability,method:'calibrated_out_of_sample_model',note:'Use only if calibration and market-specific validation are evidenced.'};
  if(finite(fairMarketProbability)&&fairMarketProbability>=0&&fairMarketProbability<=1&&sharpBooks>=2)
    return{usable:true,p:fairMarketProbability,method:'multi_book_no_vig_market_proxy',note:'Market proxy, not an independently calibrated win-probability model.'};
  return{usable:false,p:null,method:'unverified',note:'Historical hit rates or a high evidence-quality score alone cannot establish positive expected value.'};
}
function assessValue(americanOdds,evidence){
  const p=probabilityEvidence(evidence);
  if(!p.usable)return{available:false,reason:p.note,edge:null};
  return{available:true,price:americanOdds,probability:p.p,calibration:p.method,edge:edge(p.p,americanOdds),note:p.note};
}
function sameOfferScope(a,b){
  if(!a||!b)return false;
  for(const key of ['eventId','league','market','period','settlement']){
    if(!a[key]||!b[key]||String(a[key])!==String(b[key]))return false;
  }
  const market=String(a.market).toLowerCase();
  if(a.eventId===b.eventId&&['totals','player_prop','team_total'].includes(market)){
    return finite(a.line)&&finite(b.line)&&a.line===b.line&&a.subjectId===b.subjectId&&
      new Set([a.side,b.side]).size===2&&['over','under'].includes(a.side)&&['over','under'].includes(b.side);
  }
  if(market==='spreads'){
    return finite(a.line)&&finite(b.line)&&Math.abs(a.line+b.line)<EPS&&a.subjectId&&b.subjectId&&a.subjectId!==b.subjectId;
  }
  if(market==='h2h'){
    return a.settlement==='full_game_2way'&&a.subjectId&&b.subjectId&&a.subjectId!==b.subjectId;
  }
  return false;
}
function arbitrage(a,b,totalStake=100){
  if(!sameOfferScope(a,b))return{available:false,reason:'Both quotes must cover exact opposite exhaustive outcomes with identical game, period, market, line and settlement, including OT/push/void rules.'};
  if(!finite(totalStake)||totalStake<=0)return{available:false,reason:'Invalid total stake'};
  if(a.book===b.book)return{available:false,reason:'Comparison requires two independently available books'};
  const dA=decimal(a.odds),dB=decimal(b.odds);
  if(dA===null||dB===null)return{available:false,reason:'Odds missing or invalid'};
  const sum=1/dA+1/dB,margin=1/sum-1;
  if(margin<=EPS)return{available:false,reason:'No mathematical arbitrage at these two prices',impliedSum:round(sum,6),margin:round(margin,6)};
  const wagerA=totalStake*(1/dA)/sum,wagerB=totalStake*(1/dB)/sum;
  return{available:true,stakeA:round(wagerA,2),stakeB:round(wagerB,2),payoutEachSide:round(totalStake/sum,2),
    grossProfit:round(totalStake*margin,2),grossMargin:round(margin,6),impliedSum:round(sum,6),
    verifiedExecution:false,note:'Theoretical pre-fee two-way payout, NOT risk-free in practice. Quotes, stake limits, voids, partial acceptance, currency, fees and latency require manual validation.'};
}
function marketMove(open,latest){
  if(!open||!latest||!sameScopeOpenLatest(open,latest))return{available:false,reason:'Opening/closing markets or lines do not match'};
  const first=implied(open.odds),last=implied(latest.odds);
  if(first===null||last===null)return{available:false,reason:'Invalid odds'};
  const prevTime=Date.parse(open.at||''),currTime=Date.parse(latest.at||'');
  if(!finite(prevTime)||!finite(currTime)||currTime<=prevTime)return{available:false,reason:'Chronologically ordered observed timestamps required'};
  return{available:true,openingOdds:open.odds,latestOdds:latest.odds,openingImplied:first,latestImplied:last,
    deltaImpliedPercentagePoints:round((last-first)*100,2),hours:round((currTime-prevTime)/3600000,3),
    note:'Book-implied probability movement, not an increase in true win probability. Verify market/line consistency, liquidity and quote freshness.'};
}
function sameScopeOpenLatest(a,b){
  return ['book','eventId','league','market','period','settlement','subjectId','side','line'].every(k=>String(a[k]??'')===String(b[k]??''));
}
function wilson(hits,games,z=1.96){
  if(!Number.isInteger(hits)||!Number.isInteger(games)||games<1||hits<0||hits>games)return null;
  const p=hits/games,d=1+z*z/games,mid=(p+z*z/(2*games))/d,
    half=z*Math.sqrt(p*(1-p)/games+z*z/(4*games*games))/d;
  return{observedRate:p,lower:Math.max(0,mid-half),upper:Math.min(1,mid+half),games,hits,note:'Binomial interval assumes independent, comparably distributed opportunities; role and matchup changes violate that assumption.'};
}
function closingLineValue(entryAmerican,closingNoVig){
  const p=implied(entryAmerican);
  if(p===null||!finite(closingNoVig)||closingNoVig<0||closingNoVig>1)return null;
  return{edgePercentagePoints:round((closingNoVig-p)*100,3),
    note:'Price-based CLV proxy; compares entry break-even to a contemporaneous no-vig closing probability for the exact same line and settlement.'};
}
module.exports={decimal,american,implied,noVig,edge,probabilityEvidence,assessValue,sameOfferScope,arbitrage,marketMove,wilson,closingLineValue};
