const EVOLUTION=require('../lib/model-quality');

/**
 * Public read-only GitHub Release snapshot. Releases are edited by an
 * authenticated owner GitHub Action. Changing them never triggers a Vercel
 * deployment; anonymous site visitors can only read.
 */

async function publishedReview(league,date){
  try{
    const url='https://api.github.com/repos/psyche-s/SportsLab/releases/tags/sportslab-review-latest-'+league;
    const r=await fetch(url,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'SportsLab-Review'},signal:AbortSignal.timeout(6500)});
    if(!r.ok)return null;
    const release=await r.json();if(release.draft||release.prerelease||!release.body)return null;
    const p=JSON.parse(release.body);
    if(p.schemaVersion!==1||p.league!==league||p.date!==date||!p.pregameFreezeAt||!p.sourceTotals)return null;
    return{available:true,...p,readOnly:true,dataMode:'official_postgame_grade',note:'Only original published pregame picks are graded; unverified outcomes are never claimed as hits or losses.'};
  }catch(e){return null}
}

async function publishedBoard(league,date,view){
  const url='https://api.github.com/repos/psyche-s/SportsLab/releases/tags/sportslab-board-'+league;
  try{
    const r=await fetch(url,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'SportsLab-Published-Board'},signal:AbortSignal.timeout(6500)});
    if(!r.ok)return null;
    const release=await r.json();
    if(!release?.body||release.draft||release.prerelease)return null;
    const snapshot=JSON.parse(release.body);
    if(snapshot.schemaVersion!==1||snapshot.league!==league||snapshot.date!==date)return null;
    const stamp=Date.parse(snapshot.publishedAt||'');
    if(!Number.isFinite(stamp)||stamp>Date.now()+60000||Date.now()-stamp>36*3600000)return null;
    const p=snapshot[view];
    if(!p||p.available!==true||p.league!==league||p.date!==date)return null;
    return{...p,publishedAt:snapshot.publishedAt,dataMode:'published',publishSource:'GitHub data-only release',publishedViews:snapshot.views};
  }catch(e){return null}
}

const FREE_SLATE=require('../lib/free-slate');

const RANK_BASE='https://api.statshawk.ai/v1';
const marketName={sog:'Shots on goal',rec:'Receptions','receiving.rec':'Receptions','receiving.yards':'Receiving yards','rushing.yards':'Rushing yards','passing.yards':'Passing yards','rushing.att':'Rushing attempts','passing.att':'Passing attempts',targets:'Targets','pitching.so':'Pitcher strikeouts',outs:'Pitcher outs','pitching.bb':'Pitcher walks','pitching.h':'Hits allowed','batting.h':'Batter hits',total_bases:'Total bases',er:'Earned runs'};
const bookOrder=['bet365','draftkings','fanduel'];
const marketKey=s=>String(s||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const etDate=d=>{try{const date=new Date(d);if(!Number.isFinite(date.valueOf()))return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day}catch(e){return''}};
function playerThreshold(metric,line,dir){const inclusive=dir==='Over'&&Number.isInteger(line+0.5);if(metric==='sog'&&line===1.5&&dir==='Over')return'2+ shots on goal';return dir+' '+line+' '+(marketName[metric]||metric)}
function lowerBound(h,n){if(!n)return 0;const p=h/n,z=1.64;return Math.max(0,(p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n))}
function numericHitRates(card,side,threshold){const w=card?.hit_rates||{};const norm=x=>{const n=Number(x?.games),o=Number(x?.hits);if(!Number.isFinite(n)||n<1||!Number.isFinite(o))return null;const pushes=(Number.isInteger(threshold)?null:0);if(side==='Under'&&pushes===null)return null;const hits=side==='Under'?n-o:o;return{games:n,hits,rate:hits/n,average:null}};return{last5:norm(w.last_5),last10:norm(w.last_10),season:norm(w.season)}}

function impliedMarket(odds){const n=Number(odds);return !Number.isFinite(n)||n===0?null:n>0?100/(n+100):-n/(-n+100)}
function marketScore(a,b){const x=impliedMarket(a),y=impliedMarket(b);return x===null||y===null?null:x/(x+y)}
function americanAllowed(n){return Number.isFinite(n)&&n>=-400&&n!==0&&n>=-10000&&n<=10000}
function pickBookName(raw){const name=marketKey(raw);return name==='bet365'?'bet365':name==='draftkings'?'DraftKings':name==='fanduel'?'FanDuel':null}
function findBookQuote(side,baseLine){
  if(!side?.books)return null;
  for(const wanted of bookOrder){
    const key=Object.keys(side.books).find(k=>marketKey(k)===wanted),quotes=key?side.books[key]:null;
    if(!Array.isArray(quotes))continue;
    const valid=quotes.filter(q=>Number.isFinite(Number(q.price))&&americanAllowed(Number(q.price))&&!q.withdrawn&&(baseLine===null||Number.isFinite(Number(q.point))&&Math.abs(Number(q.point)-baseLine)<.01)).sort((a,b)=>Date.parse(b.observed_at||0)-Date.parse(a.observed_at||0));
    if(!valid.length)continue;
    const quote=valid[0],seen=Date.parse(quote.observed_at||0);
    if(!Number.isFinite(seen)||Date.now()-seen>24*3600*1000||seen-Date.now()>3600*1000)continue;
    return{book:pickBookName(wanted),price:Number(quote.price),observedAt:quote.observed_at||null,point:quote.point??null};
  }
  return null;
}
function marketKindLabel(market){return market==='h2h'?'Moneyline':market==='spreads'?'Spread':market==='totals'?'Game total':market==='team_total'?'Team total':market}
function gameRef(away,home){return [marketKey(away),marketKey(home)].join(':')}
async function buildCrossGameParlay({league,date,props,hawkKey,warnings}){
  const noResult=(reason,stats={})=>({available:false,gameCount:stats.gameCount||0,consideredMarkets:stats.consideredMarkets||0,reason,legs:[],legCount:0,combinedPrice:null,estimatedPrice:null,verifiedBook:null,status:'PASS — no cross-game parlay published'});
  const playbookKey=process.env.PlaybookAPI;
  const linesUrl=new URL('https://api.playbook-api.com/v1/lines');
  linesUrl.searchParams.set('league',league);
  if(playbookKey)linesUrl.searchParams.set('api_key',playbookKey);
  const getJson=async(url,headers={},timeout=7000)=>{const response=await fetch(url,{headers:{Accept:'application/json',...headers},signal:AbortSignal.timeout(timeout)});if(!response.ok)throw Error('HTTP '+response.status);return(await response.json()).data||{}};
  let lines=[];
  if(playbookKey)try{
    const data=await getJson(linesUrl);
    lines=(Array.isArray(data)?data:[]).filter(g=>g.startTime&&etDate(g.startTime)===date&&g.homeTeamName&&g.awayTeamName);
  }catch(e){warnings.push('Cross-game Playbook markets could not be retrieved.')}
  const now=Date.now();
  lines=lines.filter(g=>Date.parse(g.startTime)>now+60000);
  const candidates=[],scoped=new Map();
  for(const game of lines){
    const ml=game.lines?.moneyline||{},sp=game.lines?.spread||{},tot=game.lines?.totalPrice||{};
    const away=game.awayTeamName,home=game.homeTeamName,key=gameRef(away,home),startTime=game.startTime;
    if(scoped.has(key))continue;scoped.set(key,game);
    const add=(kind,selection,side,point,price,other,about)=>{
      const raw=marketScore(price,other);
      if(raw===null||!americanAllowed(Number(price))||raw<.51)return;
      const core=Math.round(raw*82);
      candidates.push({game:key,gameLabel:away+' @ '+home,gameStart:startTime,market:kind,marketLabel:marketKindLabel(kind),selection,side,point,price:null,aggregatePrice:Number(price),book:null,verifiedOdds:false,observedAt:null,marketShare:Number(raw.toFixed(3)),evidenceScore:core,reason:about+' Based on the listed two-sided aggregate market; a sportsbook offer and independent matchup advantage are not confirmed.',source:'Playbook aggregate',kind:'game'});
    };
    add('h2h',home+' moneyline','home',null,Number(ml.home),Number(ml.away),'Market favours '+home+'.');
    add('h2h',away+' moneyline','away',null,Number(ml.away),Number(ml.home),'Market favours '+away+'.');
    if(Number.isFinite(Number(sp.home))&&Number.isFinite(Number(sp.away))){
      const format=(team,pt)=>team+' '+(pt>0?'+':'')+pt+' spread';
      add('spreads',format(home,sp.home),'home',Number(sp.home),Number(sp.homePrice),Number(sp.awayPrice),'The listed handicap gives '+home+' '+(sp.home>=0?'a cushion':'a required margin')+'.');
      add('spreads',format(away,sp.away),'away',Number(sp.away),Number(sp.awayPrice),Number(sp.homePrice),'The listed handicap gives '+away+' '+(sp.away>=0?'a cushion':'a required margin')+'.');
    }
    if(Number.isFinite(Number(game.lines?.total))){
      const t=Number(game.lines.total);
      add('totals','Over '+t+' total '+(league==='nhl'?'goals':league==='mlb'?'runs':'points'),'over',t,Number(tot.over),Number(tot.under),'The market favours the higher-scoring side of the listed total.');
      add('totals','Under '+t+' total '+(league==='nhl'?'goals':league==='mlb'?'runs':'points'),'under',t,Number(tot.under),Number(tot.over),'The market favours the lower-scoring side of the listed total.');
    }
  }
  // If there are multiple games, verify market-specific quotes with the preferred sportsbooks.
  // Never silently turn an aggregate Playbook quote into a FanDuel, DraftKings or bet365 quote.
  if(scoped.size>=2&&hawkKey){
    try{
      const season=Number(date.slice(0,4))-(league==='nfl'&&Number(date.slice(5,7))<3?1:0);
      const source=await getJson(RANK_BASE+'/competitions/'+league+'/editions/'+season+'/games?date='+encodeURIComponent(date),{'X-API-Key':hawkKey},7000);
      const gameMap=new Map();
      for(const g of source.items||[]){
        if(g.id&&g.home_team_name&&g.away_team_name&&etDate(g.kickoff)===date&&!['final','postponed','cancelled'].includes(g.status)){
          const ref=gameRef(g.away_team_name,g.home_team_name);
          if(!gameMap.has(ref))gameMap.set(ref,g);
        }
      }
      const pickGames=[...scoped.keys()].filter(k=>gameMap.has(k)).slice(0,8);
      const replies=await Promise.allSettled(pickGames.map(async k=>({
        key:k,
        data:await getJson(RANK_BASE+'/contests/'+gameMap.get(k).id+'/odds',{'X-API-Key':hawkKey},6500)
      })));
      for(const r of replies){
        if(r.status!=='fulfilled')continue;
        for(const m of r.value.data.items||[]){
          if(!['h2h','spreads','totals','team_total'].includes(m.market)||m.period!=='full')continue;
          const sideQuotes=m.sides||[];
          for(const side of sideQuotes){
            const outcome=side.outcome||{};
            let selectionSide=outcome.slot||outcome.kind;
            if(!selectionSide&&outcome.name){
              const g=scoped.get(r.value.key);
              if(g){if(marketKey(outcome.name)===marketKey(g.homeTeamName))selectionSide='home';if(marketKey(outcome.name)===marketKey(g.awayTeamName))selectionSide='away'}
            }
            if(!selectionSide)continue;
            const existing=candidates.find(x=>x.game===r.value.key&&x.market===m.market&&x.side===selectionSide&&(x.point===null||Number(x.point)===Number((side.books?.fanduel||side.books?.draftkings||side.books?.bet365||[])[0]?.point??x.point)));
            const quote=findBookQuote(side,existing?.point??null);
            if(!quote)continue;
            if(existing){
              existing.price=quote.price;existing.book=quote.book;existing.verifiedOdds=true;existing.observedAt=quote.observedAt;existing.evidenceScore=Math.min(96,existing.evidenceScore+7);existing.source='StatsHawk '+quote.book+' quote + Playbook market';
            }else if(m.market==='team_total'&&Number.isFinite(Number(quote.point))){
              const subject=m.subject?.name||null,raw=impliedMarket(quote.price);
              if(!subject||raw===null||raw<.54)continue;
              candidates.push({game:r.value.key,gameLabel:scoped.get(r.value.key).awayTeamName+' @ '+scoped.get(r.value.key).homeTeamName,gameStart:scoped.get(r.value.key).startTime,market:'team_total',marketLabel:'Team total',selection:subject+' '+(selectionSide==='under'?'Under ':'Over ')+quote.point+' '+(league==='nhl'?'goals':league==='mlb'?'runs':'points'),side:selectionSide,point:Number(quote.point),price:quote.price,aggregatePrice:null,book:quote.book,verifiedOdds:true,observedAt:quote.observedAt,marketShare:null,evidenceScore:Math.round(raw*78),reason:'A posted team-total price is available. Team offensive form and defensive matchup still need independent confirmation.',source:'StatsHawk '+quote.book,kind:'game'});
            }
          }
        }
      }
    }catch(e){warnings.push('Cross-game bookmaker verification is incomplete; aggregate market sources remain labeled.')}
  }
  for(const p of props){
    const rate=p.last10?.rate,sample=p.last10?.games;
    if(!p.player||!p.selection||!Number.isFinite(rate)||sample<4||rate<.70||!Number.isFinite(p.average))continue;
    if(p.side==='Over'&&p.average<=p.line||p.side==='Under'&&p.average>=p.line)continue;
    if(p.priced&&(!americanAllowed(Number(p.price))||Date.now()-Date.parse(p.observedAt||0)>24*3600*1000))continue;
    const gameId=p.gameId||null;
    let g=gameId?null:[...scoped.values()].find(x=>marketKey(p.team)===marketKey(x.homeTeamName)&&marketKey(p.opponent)===marketKey(x.awayTeamName)||marketKey(p.team)===marketKey(x.awayTeamName)&&marketKey(p.opponent)===marketKey(x.homeTeamName));
    if(!g&&gameId){
      // Only trust the actual game identity for player props, never an unrelated match by a partial name.
      g=[...scoped.values()].find(x=>p.game&&marketKey(p.game)===marketKey(x.awayTeamName+' @ '+x.homeTeamName));
    }
    if(!g)continue;
    const key=gameRef(g.awayTeamName,g.homeTeamName);
    candidates.push({game:key,gameLabel:g.awayTeamName+' @ '+g.homeTeamName,gameStart:g.startTime,market:'player_prop',marketLabel:p.marketLabel||'Player prop',personId:p.personId,player:p.player,stat:p.market,opponent:p.opponent,opponentId:p.opponentId||null,position:p.position||null,gameId:p.gameId,league,selection:p.player+' — '+p.selection,side:p.side,point:p.line,price:p.priced?p.price:null,aggregatePrice:null,book:p.priced?p.book:null,verifiedOdds:!!p.priced,observedAt:p.observedAt||null,marketShare:null,evidenceScore:Math.max(1,Math.min(95,(p.evidenceScore||50)-(sample<5?7:0)-(p.priced?0:8))),last5:p.last5,last10:p.last10,average:p.average,reason:p.player+' has recorded '+p.last10.hits+'/'+sample+' over this threshold in the most recent available games. Historical rate is not a calibrated win probability.',source:p.source||'StatsHawk player logs',kind:'player'});
  }
  candidates.sort((a,b)=>b.evidenceScore-a.evidenceScore||Number(b.verifiedOdds)-Number(a.verifiedOdds));
  const quotedGames=new Set(candidates.filter(x=>x.verifiedOdds).map(x=>x.game));
  const maxLegs=quotedGames.size>=6?7:quotedGames.size>=4?6:quotedGames.size>=2?5:4;
  const chosen=[],seen=new Set();
  for(const p of candidates){
    if(seen.has(p.game)||p.evidenceScore<54)continue;
    chosen.push(p);seen.add(p.game);
    if(chosen.length>=maxLegs)break;
  }
  // At least four distinct matchups are required, never pad with a second leg from one game.
  if(chosen.length<4)return noResult('Fewer than four distinct upcoming games have qualifying lines or research support. No cross-game parlay is forced.',{gameCount:scoped.size,consideredMarkets:candidates.length});
  const distinctBooks=[...new Set(chosen.map(x=>x.book).filter(Boolean))];
  const uniform=chosen.every(x=>x.verifiedOdds)&&distinctBooks.length===1;
  let arithmeticEstimate=null;
  if(uniform){
    const decimal=chosen.reduce((acc,x)=>acc*(x.price>0?1+x.price/100:1+100/Math.abs(x.price)),1);
    arithmeticEstimate=decimal>=2?'+'+Math.round((decimal-1)*100):String(-Math.round(100/(decimal-1)));
  }
  return{
    available:true,league,date,gameCount:scoped.size,consideredMarkets:candidates.length,legs:chosen,legCount:chosen.length,
    booksChecked:bookOrder,verifiedLegs:chosen.filter(x=>x.verifiedOdds).length,
    combinedPrice:null,estimatedPrice:arithmeticEstimate,
    verifiedBook:uniform?distinctBooks[0]:null,
    status:uniform?'Research parlay · each leg quoted by '+distinctBooks[0]+'; combined payout not verified':'Research-only combination · one or more sportsbook-specific prices unavailable',
    explanation:'One selection per game. Moneylines, spreads, game totals, team totals (if posted), and qualifying player props are evaluated. Leg count adapts to independently quoted market coverage rather than automatically using seven. Ranking combines listed market-implied risk and available player history. Scores are not calibrated confidence, and independent defensive/injury verification is incomplete.',
    notice:'No SGP-style cross-market correlation is inferred. Combined parlay odds must be verified directly at the sportsbook.'
  };
}


function availabilityFromRoster(entry){
  if(!entry)return{status:'not_verified',label:'Lineup not verified',risk:'No matched roster record'};
  const injury=entry.injury||entry.person?.injury||null,raw=String(injury?.status||'').trim(),state=raw.toLowerCase();
  const absent=/\b(out|injured reserve|ir|inactive|suspended|ruled out|disabled list|injured list|il-)\b/.test(state);
  const uncertain=/questionable|doubtful|game.time.decision|day.to.day|day to day|probable/.test(state);
  const source=entry.source||entry.membership_source||null;
  if(absent)return{status:'out',label:raw||'Unavailable',risk:'Excluded: reported unavailable',injuryType:injury?.injury_type||null};
  if(uncertain)return{status:'uncertain',label:raw||'Game status uncertain',risk:'Flagged: availability needs game-day confirmation',injuryType:injury?.injury_type||null};
  if(source==='membership')return{status:'unconfirmed',label:raw||'Roster member only',risk:'No confirmed recent appearance; starting role unverified'};
  return{status:'rostered',label:raw==='Active'?'Active report; starter unconfirmed':'Rostered; starting lineup unconfirmed',risk:'Lineup, special-teams/usage role and minutes need confirmation'};
}
function formTrend(props){
  for(const p of props){
    const recent=p.last5,base=p.last10,raw5=p.averages?.last_5??p.avgLast5,raw10=p.averages?.last_10??p.average,avg5=raw5==null?NaN:Number(raw5),avg10=raw10==null?NaN:Number(raw10);
    const enough=(base?.games||0)>=7&&(recent?.games||0)>=3;
    const delta=enough?recent.rate-base.rate:null;
    const vdelta=enough&&Number.isFinite(avg5)&&Number.isFinite(avg10)?avg5-avg10:null;
    p.form={last5:recent?.rate??null,last10:base?.rate??null,hitRateChange:delta,averageLast5:Number.isFinite(avg5)?avg5:null,averageLast10:Number.isFinite(avg10)?avg10:null,averageChange:vdelta,read:!enough?'Limited sample':delta>=.14?'Improving':delta<=-.14?'Cooling':'Stable'};
    // Small adjustment: repeatable recent form affects ranking, but does not create fake model certainty.
    if(delta!==null)p.evidenceScore=Math.max(1,Math.min(96,p.evidenceScore+Math.round(Math.max(-7,Math.min(7,delta*22)))));
  }
}
async function applyRosterAvailability(props,league,key,fetchData,warnings,fallbackTeamIds=[]){
  if(!['nhl','nfl'].includes(league)||!props.length)return;
  const teams=[...new Set([...props.slice().sort((a,b)=>b.evidenceScore-a.evidenceScore).slice(0,24).map(x=>x.teamId),...fallbackTeamIds].filter(x=>/^team_[a-z0-9]{18,40}$/.test(x)))].slice(0,16);
  if(!teams.length){warnings.push('Player starting lineups could not be verified. Trends are historical only.');return}
  const results=await Promise.allSettled(teams.map(async id=>{
    const roster=await fetchData(RANK_BASE+'/teams/'+id+'/roster',6800);
    const rows=Array.isArray(roster.items)?roster.items:Array.isArray(roster.players)?roster.players:Array.isArray(roster.roster)?roster.roster:[];
    const record=new Map(rows.map(p=>[p.person_id||p.person?.id||p.person||'',p]));
    return{id,record};
  }));
  const rosterMap=new Map(results.filter(x=>x.status==='fulfilled').map(x=>[x.value.id,x.value.record]));
  let excluded=0,flagged=0;
  for(let i=props.length-1;i>=0;i--){
    const p=props[i];if(!p.teamId){for(const [id,records] of rosterMap)if(records.has(p.personId)){p.teamId=id;break}}const entry=rosterMap.get(p.teamId)?.get(p.personId),info=availabilityFromRoster(entry);
    p.availability=info;p.lineupConfirmed=false;
    if(info.status==='out'){props.splice(i,1);excluded++;continue}
    if(info.status==='uncertain'){p.evidenceScore=Math.max(1,p.evidenceScore-11);flagged++}
    if(info.status==='unconfirmed')p.evidenceScore=Math.max(1,p.evidenceScore-7);
  }
  if(excluded)warnings.push(excluded+' player(s) excluded due to reported absence or injured-list status.');
  if(flagged)warnings.push(flagged+' questionable / day-to-day player(s) flagged and down-ranked.');
  warnings.push('An active roster does not confirm an NHL line combination, power-play role or NFL starting snap count. Check game-day lineup.');
}


const scoringMarkets={
  nhl:[{key:'goals',stat:'goals',title:'Top Goalscorers',selection:'Anytime goalscorer',line:.5,minimum:.18,role:'sog',roleFloor:1.7,max:5},{key:'assists',stat:'assists',title:'Top Assist Picks',selection:'To record an assist',line:.5,minimum:.20,role:'sog',roleFloor:1.2,max:5}],
  nfl:[{key:'touchdownReceiving',stat:'receiving.td',title:'Receiving TD Picks',selection:'Receiving touchdown',line:.5,minimum:.18,role:'targets',roleFloor:3,max:5},{key:'touchdownRushing',stat:'rushing.td',title:'Rushing TD Picks',selection:'Rushing touchdown',line:.5,minimum:.18,role:'rushing.att',roleFloor:6,max:5}],
  mlb:[{key:'homeRuns',stat:'batting.hr',title:'Home Run Picks',selection:'To hit a home run',line:.5,minimum:.08,role:'pa',roleFloor:2.8,max:5}]
};
async function scoringSlate(req,res,key,league,date){
  const markets=scoringMarkets[league]||[],warnings=[],scoring=[],fetchedAt=new Date().toISOString(),headers={'X-API-Key':key,Accept:'application/json'};
  const fetchData=async(u,t=9000)=>{const r=await fetch(u,{headers,signal:AbortSignal.timeout(t)});if(!r.ok)throw Error(r.status===429?'StatsHawk quota exhausted (429)':'Provider HTTP '+r.status);return(await r.json()).data||{}};
  const stats=await Promise.allSettled(markets.map(async market=>{
    const u=new URL(RANK_BASE+'/analysis/stat-board');
    for(const [k,v] of Object.entries({competition:league,date,stat:market.stat,line:.5,window:10,min_games:3,limit:200}))u.searchParams.set(k,v);
    return{market,data:await fetchData(u.toString(),10500)}
  }));
  if(stats.every(x=>x.status==='rejected'&&String(x.reason||'').includes('quota')))return FREE_SLATE(req,res,{reason:'StatsHawk monthly quota exhausted'});
  for(let i=0;i<stats.length;i++){
    const market=markets[i],result=stats[i];
    if(result.status!=='fulfilled'){const err=String(result.reason||'');warnings.push(market.title+(err.includes('quota')?' paused: monthly StatsHawk allowance exhausted.':' source unavailable; no picks were fabricated.'));continue}
    const data=result.value.data,rows=(Array.isArray(data.full_slate)?data.full_slate:[]).filter(x=>/^per_[a-z0-9]{18,40}$/.test(x.person?.id||'')&&x.person?.bio?.display_name&&x.games_in_window>=3&&Number.isFinite(Number(x.window_rate)));
    const ordered=rows.sort((a,b)=>{
      const as=a.window_rate*(a.games_in_window/(a.games_in_window+5)),bs=b.window_rate*(b.games_in_window/(b.games_in_window+5));
      return bs-as||b.games_in_window-a.games_in_window
    });
    const byTeam=new Map(),selected=[];
    for(const row of ordered){
      const tid=row.team?.team_id||row.team?.id||row.team?.name||'Unknown',count=byTeam.get(tid)||0;
      if(count>=2)continue;
      selected.push(row);byTeam.set(tid,count+1);if(selected.length>=10)break;
    }
    const checked=await Promise.allSettled(selected.map(async(row)=>{
      const u=new URL(RANK_BASE+'/analysis/player-prop');for(const[k,v]of Object.entries({person_id:row.person.id,competition:league,stat:market.stat,line:market.line}))u.searchParams.set(k,v);
      return{row,card:await fetchData(u.toString(),9000)}
    }));
    for(const attempt of checked){
      if(attempt.status!=='fulfilled')continue;
      const {row,card}=attempt.value,rate=numericHitRates(card,'Over',.5),base=rate.last10||rate.season,season=rate.season,avg=Number(card.averages?.last_10??card.averages?.season);
      if(!base||base.games<3||!Number.isFinite(avg)||base.rate<market.minimum)continue;
      if(league==='mlb'&&(!season||season.games<12||season.rate<.045))continue;
      const combined=base.rate*.55+lowerBound(base.hits,base.games)*.26+Math.min(base.games,10)/10*.09+Math.min(Math.max(avg,0),1)*.10;
      scoring.push({
        marketKey:market.key,stat:market.stat,market:market.stat,marketLabel:market.title,selection:market.selection,side:'Over',line:.5,
        player:row.person.bio.display_name,personId:row.person.id,position:row.person.bio.position||null,
        teamId:row.team?.team_id||row.team?.id||null,team:row.team?.name||null,
        opponentId:row.opponent?.team_id||row.opponent?.id||null,opponent:row.opponent?.name||null,
        game:[row.team?.name,row.opponent?.name].filter(Boolean).join(' vs '),gameId:null,
        last5:rate.last5,last10:rate.last10,season,average:avg,avgLast5:card.averages?.last_5??null,averages:card.averages||null,
        evidenceScore:Math.round(combined*100),opportunity:null,book:null,price:null,priced:false,observedAt:null,
        lineupConfirmed:false,lineupStatus:'Not confirmed',projectionSource:row.projection_source||'unverified',
        source:'StatsHawk observed game logs',sampleNote:'Scoring events are volatile; observed rate is not a prediction',
        fullSample:season?.games||null
      });
    }
  }
  formTrend(scoring);
  await applyRosterAvailability(scoring,league,key,fetchData,warnings);
  if(league==='mlb'){
    for(const p of scoring){
      const source=String(p.projectionSource||'').toLowerCase();
      p.lineupConfirmed=source.includes('confirmed');
      p.lineupStatus=p.lineupConfirmed?'Confirmed batting order':'Batting order not verified';
      p.availability=p.lineupConfirmed?{status:'confirmed',label:'Confirmed starting lineup',risk:'Confirmed lineup; batting order/role may still change'}:{status:'unconfirmed',label:'Starting lineup unconfirmed',risk:'Check official batting order before selecting HR props'};
      if(!p.lineupConfirmed)p.evidenceScore=Math.max(1,p.evidenceScore-10);
    }
  }
  // Check that a goalscorer / TD / HR candidate still receives opportunities (shots, targets, carries, PA).
  // A role floor can reject a high event-rate sample with no repeatable current volume.
  const top=scoring.slice().sort((a,b)=>b.evidenceScore-a.evidenceScore).slice(0,12);
  const roles=await Promise.allSettled(top.map(async p=>{
    const market=markets.find(x=>x.key===p.marketKey),stat=market.role;
    const u=new URL(RANK_BASE+'/analysis/player-prop');for(const[k,v]of Object.entries({person_id:p.personId,competition:league,stat,line:.5}))u.searchParams.set(k,v);
    return{personId:p.personId,market:p.marketKey,roleStat:stat,minimum:market.roleFloor,card:await fetchData(u.toString(),8000)}
  }));
  const roleMap=new Map(roles.filter(x=>x.status==='fulfilled').map(x=>[x.value.personId+'|'+x.value.market,x.value]));
  for(let i=scoring.length-1;i>=0;i--){
    const p=scoring[i],role=roleMap.get(p.personId+'|'+p.marketKey);
    if(!role){p.opportunity={verified:false,note:'Recent role volume unavailable; check expected ice time, routes, carries or batting appearances.'};continue}
    const avg=Number(role.card?.averages?.last_10??role.card?.averages?.season);
    if(!Number.isFinite(avg)){p.opportunity={verified:false,note:'No verified recent opportunity volume'};continue}
    p.opportunity={verified:true,stat:role.roleStat,last10Average:avg,minimum:role.minimum,note:'Historical volume indicator, not a forecast'};
    if(avg<role.minimum){p.evidenceScore=Math.max(1,p.evidenceScore-15);p.sampleNote+='; low recent opportunity volume'}
    else p.evidenceScore=Math.min(95,p.evidenceScore+Math.min(5,Math.round((avg-role.minimum)*1.5)));
  }
  // Odds are linked only when the exact player, scoring stat, line and sportsbook quote all match.
  try{
    const year=Number(date.slice(0,4))-(league==='nfl'&&Number(date.slice(5,7))<3?1:league==='nhl'&&Number(date.slice(5,7))<8?1:0);
    const slate=await fetchData(RANK_BASE+'/competitions/'+league+'/editions/'+year+'/games?date='+encodeURIComponent(date),7500);
    const games=(slate.items||[]).filter(g=>g.id&&g.status!=='final'&&g.status!=='postponed'&&etDate(g.kickoff)===date).slice(0,8);
    const quotes=await Promise.allSettled(games.map(async g=>({game:g,data:await fetchData(RANK_BASE+'/contests/'+g.id+'/odds',8000)})));
    const found=new Map();
    for(const result of quotes){
      if(result.status!=='fulfilled')continue;
      const {game,data}=result.value;
      for(const m of data.items||[]){
        if(m.market!=='player_prop'||m.period!=='full'||m.subject?.kind!=='person'||!m.subject.id)continue;
        for(const side of m.sides||[]){
          if(side.outcome?.kind!=='over')continue;
          const quote=findBookQuote(side,.5);if(!quote)continue;
          const key=m.subject.id+'|'+m.measure;
          const prior=found.get(key);if(prior&&bookOrder.indexOf(marketKey(prior.book))<=bookOrder.indexOf(marketKey(quote.book)))continue;
          found.set(key,{...quote,gameId:game.id});
        }
      }
    }
    for(const p of scoring){
      const quote=found.get(p.personId+'|'+p.stat);
      if(!quote)continue;
      p.price=quote.price;p.book=quote.book;p.priced=true;p.observedAt=quote.observedAt;p.gameId=quote.gameId;
    }
  }catch(e){warnings.push('Verified scorer market prices could not be fully retrieved; research lines are not sportsbook offers.')}
  EVOLUTION.applyQuality(scoring,()=>({formPreviouslyWeighted:true,postseason:league==='mlb'}));
  scoring.sort((a,b)=>b.evidenceScore-a.evidenceScore||(b.last10?.games||0)-(a.last10?.games||0));
  let groups=markets.map(m=>{
    const candidates=scoring.filter(p=>p.marketKey===m.key),unique=[],seen=new Set(),teamCount=new Map();
    for(const p of candidates){
      if(seen.has(p.personId)||(teamCount.get(p.teamId||p.team)||0)>=2)continue;
      unique.push(p);seen.add(p.personId);teamCount.set(p.teamId||p.team,(teamCount.get(p.teamId||p.team)||0)+1);
      if(unique.length>=m.max)break;
    }
    return{key:m.key,title:m.title,stat:m.stat,selection:m.selection,picks:unique};
  });
  if(league==='nfl'){
    const combined=[],seen=new Set();
    for(const p of scoring){if(seen.has(p.personId))continue;seen.add(p.personId);combined.push(p);if(combined.length>=6)break}
    groups=[{key:'touchdowns',title:'Top Touchdown Picks',stat:'receiving.td / rushing.td',selection:'Player TD (specified type)',picks:combined}];
  }
  if(!groups.some(x=>x.picks.length))return FREE_SLATE(req,res,{reason:'Primary scorer slate lacks qualifying verified entries'});
  res.setHeader('Cache-Control','public,max-age=0,s-maxage=480,stale-while-revalidate=360');
  return res.json({available:true,league,date,groups,scorers:groups.flatMap(x=>x.picks),warnings,modelStatus:'Scoring-event research: true historical goals, assists, touchdowns or home runs; recent form, volume opportunity and available roster/lineup flags. Starting assignments and opponent advantage remain unverified unless separately evidenced. No calibrated win probabilities or guaranteed outcomes.',fetchedAt});
}

async function rankedSlate(req,res,key,league,date){
  const headers={'X-API-Key':key,Accept:'application/json'};
  const warnings=[];
  const fetchData=async(url,timeout=8000)=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(timeout)});if(!r.ok)throw Error(r.status===429?'StatsHawk quota exhausted (429)':'Provider HTTP '+r.status);const p=await r.json();return p.data||{}};
  const props=[],matched=[],nflTeamIds=[];
  if(league==='nfl'){
    try{
      const season=Number(date.slice(0,4))-(Number(date.slice(5,7))<3?1:0);
      const slate=await fetchData(RANK_BASE+'/competitions/nfl/editions/'+season+'/games?date='+encodeURIComponent(date));
      const games=(slate.items||[]).filter(x=>etDate(x.kickoff)===date&&!['postponed','cancelled','final'].includes(x.status)).slice(0,6);for(const g of games){if(g.home_team)nflTeamIds.push(g.home_team);if(g.away_team)nflTeamIds.push(g.away_team)}
      const quoteResults=await Promise.allSettled(games.map(async game=>({game,odds:await fetchData(RANK_BASE+'/contests/'+game.id+'/odds',9000)})));
      const quotes=[];
      for(const result of quoteResults){
        if(result.status!=='fulfilled')continue;
        const {game,odds}=result.value;
        for(const m of odds.items||[]){
          if(m.market!=='player_prop'||m.period!=='full'||m.subject?.kind!=='person'||!m.subject.id)continue;
          const measure=m.measure,stat=measure==='receiving.rec'?'rec':measure;
          if(!['rec','targets','receiving.yards','rushing.yards','passing.yards','rushing.att','passing.att','passing.intc'].includes(stat))continue;
          const choices=(m.sides||[]).filter(x=>['over','under'].includes(x.outcome?.kind));
          let selected=null;
          for(const b of bookOrder){
            const candidates=choices.map(side=>{const key=Object.keys(side.books||{}).find(x=>marketKey(x)===b);const q=(key?side.books[key]:[]||[]).filter(x=>Number.isFinite(x.price)&&Number.isFinite(x.point)).sort((a,b)=>Date.parse(b.observed_at||0)-Date.parse(a.observed_at||0))[0];return q?{side:side.outcome.kind,quote:q,book:b}:null}).filter(Boolean);
            if(candidates.length){selected=candidates;break}
          }
          if(!selected)continue;
          for(const v of selected){
            if(v.quote.price < -400)continue;
            const age=Date.now()-Date.parse(v.quote.observed_at||0);
            if(!Number.isFinite(age)||age>36*3600e3||age< -86400000)continue;
            if(v.side==='under'&&Number.isInteger(v.quote.point))continue;
            quotes.push({person:m.subject,measure:stat,book:v.book,game,side:v.side==='under'?'Under':'Over',line:v.quote.point,price:v.quote.price,observedAt:v.quote.observed_at});
          }
        }
      }
      const best=new Map();
      for(const q of quotes){const id=q.person.id+'|'+q.measure+'|'+q.line;const old=best.get(id);if(!old||bookOrder.indexOf(q.book)<bookOrder.indexOf(old.book)||old.side==='Under'&&q.side==='Over')best.set(id,q)}
      const work=[...best.values()].slice(0,20);
      const stats=await Promise.allSettled(work.map(async q=>{const u=new URL(RANK_BASE+'/analysis/player-prop');for(const[k,v]of Object.entries({person_id:q.person.id,competition:'nfl',stat:q.measure,line:q.line}))u.searchParams.set(k,v);const result=await fetchData(u.toString(),7500);return{quote:q,data:result}}));
      for(const result of stats){
        if(result.status!=='fulfilled')continue;
        const {quote:q,data:p}=result.value,stats=numericHitRates(p,q.side,q.line),l=stats.last10||stats.season;
        if(!l||l.games<3)continue;
        const a=p.averages||{};const recentAvg=Number(a.last_10??a.season);if(!Number.isFinite(recentAvg)||(q.side==='Over'&&recentAvg<=q.line)||(q.side==='Under'&&recentAvg>=q.line))continue;
        const score=l.rate*.57+lowerBound(l.hits,l.games)*.31+Math.min(l.games,10)/10*.12;
        props.push({player:q.person.name||p.person?.bio?.display_name||'Unknown',personId:q.person.id,position:p.person?.bio?.position||null,opponentId:p.opponent?.team_id||null,team:p.team?.name||null,opponent:p.opponent?.name||null,game:q.game.away_team_name+' @ '+q.game.home_team_name,gameId:q.game.id,market:q.measure,marketLabel:marketName[q.measure]||q.measure,teamId:q.game.home_team_name===p.team?.name?q.game.home_team:q.game.away_team_name===p.team?.name?q.game.away_team:null,avgLast5:a.last_5??null,side:q.side,line:q.line,selection:playerThreshold(q.measure,q.line,q.side),book:q.book==='fanduel'?'FanDuel':q.book==='draftkings'?'DraftKings':'bet365',price:q.price,observedAt:q.observedAt,last5:stats.last5,last10:stats.last10,season:stats.season,average:a.last_10??a.season??null,evidenceScore:Math.round(score*100),sampleNote:l.games<5?'Small sample — early season':'Historical sample; not a prediction',lineupConfirmed:false,priced:true,source:'StatsHawk sportsbook odds + player game logs'});
      }
      if(!props.length)warnings.push('No player prop offers met the minimum historical sample and price requirements.');
    }catch(e){warnings.push('NFL player markets temporarily unavailable: '+e.message)}
  }else{
    const metric=league==='nhl'?'sog':'pitching.so',line=league==='nhl'?1.5:4.5;
    try{
      const u=new URL(RANK_BASE+'/analysis/stat-board');for(const[k,v]of Object.entries({competition:league,date,stat:metric,window:10,min_games:3,limit:200}))u.searchParams.set(k,v);
      const data=await fetchData(u.toString(),11000),raw=(data.full_slate||[]).filter(x=>x.person?.id&&x.person?.bio?.display_name&&x.games_in_window>=3);
      const grouped=new Map();
      for(const row of raw){const key=row.team?.name||'Unknown';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row)}
      const selected=[];for(const group of grouped.values())selected.push(...group.slice(0,league==='nhl'?3:4));
      selected.sort((a,b)=>(b.games_in_window||0)-(a.games_in_window||0));
      const candidates=selected.slice(0,league==='nhl'?32:18);
      const results=await Promise.allSettled(candidates.map(async c=>{const p=new URL(RANK_BASE+'/analysis/player-prop');for(const[k,v]of Object.entries({person_id:c.person.id,competition:league,stat:metric,line}))p.searchParams.set(k,v);return{candidate:c,card:await fetchData(p.toString(),8000)}}));
      for(const result of results){
        if(result.status!=='fulfilled')continue;
        const {candidate:c,card}=result.value,stat=numericHitRates(card,'Over',line),l=stat.last10||stat.season;
        if(!l||l.games<3)continue;
        const avg=Number(card.averages?.last_10??card.averages?.season)||0;if(league==='nhl'&&(l.rate<.5||avg<1.5))continue;if(league==='mlb'&&(l.rate<.5||avg<4.2))continue;
        const score=l.rate*.53+lowerBound(l.hits,l.games)*.27+Math.min(avg/(line+1.15),1)*.2;
        props.push({player:c.person.bio.display_name,personId:c.person.id,position:c.person?.bio?.position||null,teamId:c.team?.team_id||null,opponentId:c.opponent?.team_id||null,team:c.team?.name||null,opponent:c.opponent?.name||null,game:[c.team?.name,c.opponent?.name].filter(Boolean).join(' vs '),gameId:null,market:metric,marketLabel:marketName[metric],avgLast5:card.averages?.last_5??null,side:'Over',line,selection:playerThreshold(metric,line,'Over'),book:null,price:null,observedAt:null,last5:stat.last5,last10:stat.last10,season:stat.season,average:avg,evidenceScore:Math.round(score*100),sampleNote:l.games<5?'Small early-season sample; lineup unconfirmed':'No bookmaker offer verified; lineup unconfirmed',lineupConfirmed:false,priced:false,source:'StatsHawk historical player game logs'});
      }
      if(!props.length&&league==='nhl')warnings.push('No skater has enough logged games for a qualified shot-volume research shortlist.');
      if(league==='nhl')warnings.push('NHL shots props are research lines (2+ SOG). No bet365, DraftKings or FanDuel SOG prices were returned by the accessible odds feed.');
      if(league==='mlb')warnings.push('MLB strikeout lines are research thresholds; confirm probable starters and posted odds before playing.');
    }catch(e){warnings.push('Historical prop data unavailable: '+e.message)}
  }
  if(league==='mlb'){
    try{
      const r=await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+date+'&hydrate=probablePitcher',{signal:AbortSignal.timeout(6500)});
      const probable=[];
      if(r.ok){const d=await r.json();for(const row of d.dates||[])for(const g of row.games||[])for(const side of ['home','away']){
        const a=g.teams?.[side],other=g.teams?.[side==='home'?'away':'home'];if(a?.probablePitcher?.fullName)probable.push({name:a.probablePitcher.fullName,team:a.team?.name||'',opponent:other?.team?.name||''});
      }}
      if(probable.length){
        const valid=new Set(probable.map(x=>marketKey(x.name)));
        for(let i=props.length-1;i>=0;i--)if(!valid.has(marketKey(props[i].player)))props.splice(i,1);
        const known=new Set(props.map(x=>marketKey(x.player)));
        const absent=probable.filter(x=>!known.has(marketKey(x.name)));
        const extra=await Promise.allSettled(absent.map(async person=>{
          const found=await fetchData(RANK_BASE+'/persons?q='+encodeURIComponent(person.name)+'&limit=10',6500);
          const a=(found.items||[]).find(x=>marketKey(x.bio?.display_name||x.bio?.full_name)===marketKey(person.name));if(!a)return null;
          const u=new URL(RANK_BASE+'/analysis/player-prop');for(const[k,v]of Object.entries({person_id:a.id,competition:'mlb',stat:'pitching.so',line:4.5}))u.searchParams.set(k,v);
          const c=await fetchData(u.toString(),6500);
          return{person,card:c,id:a.id};
        }));
        for(const e of extra){if(e.status!=='fulfilled'||!e.value)continue;const {person,card,id}=e.value,rate=numericHitRates(card,'Over',4.5),l=rate.last10||rate.season;const average=Number(card.averages?.last_10??card.averages?.season);if(!l||l.games<3||!Number.isFinite(average)||average<3.5)continue;
          const score=l.rate*.53+lowerBound(l.hits,l.games)*.27+Math.min(average/5.65,1)*.20;
          props.push({player:person.name,personId:id,position:'P',team:person.team,opponent:person.opponent,opponentId:null,game:[person.team,person.opponent].filter(Boolean).join(' vs '),gameId:null,market:'pitching.so',marketLabel:'Pitcher strikeouts',side:'Over',line:4.5,selection:'Over 4.5 Pitcher strikeouts',book:null,price:null,observedAt:null,last5:rate.last5,last10:rate.last10,season:rate.season,average,evidenceScore:Math.round(score*100),sampleNote:'Officially listed probable starter; game lineup and price not confirmed',lineupConfirmed:false,priced:false,source:'MLB official probable starters + StatsHawk historical game logs'});
        }
        warnings.push('MLB prop candidates are limited to pitchers listed as probable starters by MLB. Bookmaker-specific prices were not available.');
      }else{
        for(let i=props.length-1;i>=0;i--)if(props[i].last10?.rate<.6||props[i].average<4.5)props.splice(i,1);
        warnings.push('Official probable starters are not posted for this date. Remaining historical pitcher stats are watchlist-only, not qualified game picks.');
      }
    }catch(e){props.length=0;warnings.push('Starting pitcher confirmation unavailable. No MLB picks have been published without that verification.')}
  }
  if(league==='mlb'&&!props.length)warnings.push('No verified starting-pitcher props passed the research filters today.');
  formTrend(props);
  await applyRosterAvailability(props,league,key,fetchData,warnings,nflTeamIds);
  EVOLUTION.applyQuality(props,()=>({formPreviouslyWeighted:true,postseason:league==='mlb'}));
  props.sort((a,b)=>b.evidenceScore-a.evidenceScore||(b.last10?.games||0)-(a.last10?.games||0));
  const picked=[],seen=new Set();for(const p of props){if(!seen.has(p.personId)){picked.push(p);seen.add(p.personId)}if(picked.length===10)break}
  const groups=new Map();
  for(const p of props){const game=p.gameId||[p.team,p.opponent].filter(Boolean).sort().join('|');if(!game)continue;if(!groups.has(game))groups.set(game,[]);groups.get(game).push(p)}
  const sgps=[];
  for(const [gid,entries] of groups){const sorted=entries.filter(x=>x.last10&&x.last10.games>=5&&x.last10.rate>=.65&&x.quality?.score>=54&&x.quality.readiness!=='exclude').sort((a,b)=>b.evidenceScore-a.evidenceScore);const unique=[],ids=new Set();for(const p of sorted){if(ids.has(p.personId))continue;ids.add(p.personId);unique.push(p);if(unique.length>=5)break}if(unique.length<3)continue;const legs=unique.slice(0,Math.min(5,unique.length));const risk=EVOLUTION.sgpQuality(legs);if(risk.readiness==='exclude')continue;sgps.push({game:legs[0].game,gameId:legs[0].gameId||null,legs,legCount:legs.length,combinedPrice:null,book:legs.every(x=>x.book===legs[0].book)?legs[0].book:null,pricedLegs:legs.filter(x=>x.priced).length,rankScore:risk.score,sgpRisk:risk,status:'Research combination — correlated outcomes and combined odds are not verified',notes:risk.flags.includes('three_plus_legs_same_team')?'Multiple legs rely on the same team game script; review line/PP/usage assumptions.':'Same-game correlations, lineup availability and accepted sportsbook payout must still be checked.'})}
  sgps.sort((a,b)=>b.rankScore-a.rankScore);
  if(!props.length)return FREE_SLATE(req,res,{reason:'Primary player-prop board unavailable or lacks qualifying samples'});
  const crossGameParlay=await buildCrossGameParlay({league,date,props:props.slice(0,45),hawkKey:key,warnings});
  res.setHeader('Cache-Control','public,max-age=0,s-maxage=360,stale-while-revalidate=300');
  return res.status(200).json({available:true,league,date,props:picked,candidateProps:props.slice(0,45),sgps:sgps.slice(0,3),crossGameParlay,candidatesEvaluated:props.length,pricedProps:picked.filter(x=>x.priced).length,warnings,modelStatus:'Historical research and exact posted bookmaker lines where available; not calibrated betting probabilities. Never infer a combined SGP payout.',sources:['StatsHawk statistical logs','StatsHawk sportsbook pregame quotes when posted']});
}

const MARKETS={nhl:{sog:'Shots on goal',pts:'Points',goals:'Goals',assists:'Assists',blocks:'Blocked shots'},nfl:{rec:'Receptions','receiving.yards':'Receiving yards','rushing.yards':'Rushing yards','passing.yards':'Passing yards',targets:'Targets','rushing.att':'Rushing attempts','passing.att':'Passing attempts'},mlb:{'pitching.so':'Pitcher strikeouts',outs:'Pitcher outs','pitching.bb':'Pitcher walks','pitching.h':'Hits allowed',er:'Earned runs','batting.h':'Batter hits',total_bases:'Total bases'}};module.exports=async(req,res)=>{const league=String(req.query.league||'nhl').toLowerCase(),date=String(req.query.date||new Date().toISOString().slice(0,10)),stat=String(req.query.stat||({nhl:'sog',nfl:'rec',mlb:'pitching.so'}[league]||''));if(!MARKETS[league]||!Object.hasOwn(MARKETS[league],stat)||!/^(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date))return res.status(400).json({error:'Invalid league, market or date'});const selectedLine=Number(req.query.line??(league==='nhl'?1.5:league==='nfl'?2.5:4.5));if(!Number.isFinite(selectedLine)||selectedLine<0||selectedLine>150)return res.status(400).json({error:'Invalid stat threshold'});const key=process.env.STATSHAWK_API_KEY,view=String(req.query.view||''),source=String(req.query.source||'auto').toLowerCase();if(view==='review'){const result=await publishedReview(league,date);if(result){res.setHeader('Cache-Control','public,max-age=0,s-maxage=300');return res.status(200).json(result)}return res.status(404).json({available:false,date,league,error:'No graded original pregame picks for this date. A frozen morning publication is required.'})}if(!['auto','live','free','published'].includes(source))return res.status(400).json({available:false,error:'Unknown research source'});if(['ranked','scorers'].includes(view)&&['auto','published'].includes(source)){const publication=await publishedBoard(league,date,view);if(publication){res.setHeader('Cache-Control','public,max-age=0,s-maxage=180,stale-while-revalidate=120');return res.status(200).json(publication)}if(source==='published')return res.status(404).json({available:false,date,league,view,error:'No current published board for this sport and Toronto date.'})}if(['ranked','scorers'].includes(view)&&(!key||String(req.query.source||'')==='free'))return FREE_SLATE(req,res,{reason:!key?'StatsHawk not configured':'Free source explicitly requested'});if(!key)return res.status(503).json({available:false,reason:'StatsHawk API key not configured',picks:[]});if(String(req.query.view||'')==='scorers')return scoringSlate(req,res,key,league,date);if(String(req.query.view||'')==='ranked')return rankedSlate(req,res,key,league,date);try{const u=new URL('https://api.statshawk.ai/v1/analysis/stat-board');for(const[k,v]of Object.entries({competition:league,date,stat,line:selectedLine,window:10,min_games:3,limit:250}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)return res.status(r.status===401?502:r.status).json({available:false,reason:r.status===429?'StatsHawk quota exhausted':r.status===402||r.status===403?'StatsHawk plan does not allow this slate':'StatsHawk slate research unavailable',providerStatus:r.status,picks:[]});const p=await r.json(),data=p.data||{},raw=Array.isArray(data.recommended)?data.recommended:[],unconfirmed=(data.games_with_lineups??0)===0,watchlist=(data.full_slate||[]).filter(x=>x.person?.bio?.display_name&&Number.isFinite(x.window_rate)&&x.games_in_window>=3).sort((a,b)=>b.window_rate-a.window_rate||b.games_in_window-a.games_in_window).slice(0,10).map(x=>({player:x.person.bio.display_name,team:x.team?.name||null,opponent:x.opponent?.name||null,stat,sample:x.games_in_window,activityRate:x.window_rate,projectionSource:x.projection_source||null,line:data.line??null,lineupConfirmed:!unconfirmed})),picks=raw.filter(x=>x.person?.bio?.display_name&&Number.isFinite(x.window_rate)&&x.games_in_window>=5).sort((a,b)=>b.window_rate-a.window_rate||b.games_in_window-a.games_in_window).slice(0,10).map(x=>({player:x.person.bio.display_name,team:x.team?.name||null,stat,market:MARKETS[league][stat],observedLast10Rate:x.window_rate,seasonRate:x.season_rate??null,sample:x.games_in_window,opponent:x.opponent?.name||null,marketLine:Number.isFinite(Number(data.line))?Number(data.line):null,source:'StatsHawk stat board',projectionSource:x.projection_source||null,verifiedBet365Odds:false}));if(String(req.query.inspect||'')==='1')return res.json({market:stat,keys:Object.keys(data),line:data.line,examples:{recommended:(data.recommended||[]).slice(0,1),fullSlate:(data.full_slate||[]).slice(0,1)},stats:{recommended:(data.recommended||[]).length,fullSlate:(data.full_slate||[]).length}});res.setHeader('Cache-Control','public,max-age=0,s-maxage=600,stale-while-revalidate=300');return res.json({available:true,league,date,stat,market:MARKETS[league][stat],picks,watchlist,meta:{gamesWithLineups:data.games_with_lineups??null,gamesWithoutLineups:data.games_without_lineups??null,fullSlateCount:data.full_slate?.length??null,recommendedCount:raw.length,window:data.window??10,line:data.line??null},approvedBets:[],notice:'Observed historical rates at StatsHawk screening thresholds (often 0.5). Watchlist names may have unconfirmed lineup roles. Neither this line nor a historical rate is a bet365 offer or calibrated forecast.',fetchedAt:p.meta?.fetched_at||null})}catch(e){return res.status(502).json({available:false,reason:'StatsHawk analysis temporarily unreachable',picks:[]})}};