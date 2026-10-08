const base='https://api.statshawk.ai/v1';module.exports=async(req,res)=>{const key=process.env.STATSHAWK_API_KEY;if(!key)return res.status(503).json({available:false,provider:'StatsHawk',reason:'STATSHAWK_API_KEY is not configured. Public league feeds remain available.'});if(String(req.query.mode||'')==='player'){const pid=String(req.query.person_id||''),league=String(req.query.league||'nfl').toLowerCase(),stat=String(req.query.stat||({nhl:'sog',mlb:'pitching.so',nfl:'rec'}[league]||'rec')),line=Number(req.query.line??3.5);const markets={nfl:['rec','receiving.rec','targets','receiving.yards','rushing.yards','passing.yards','rushing.att','passing.att','intc','passing.td','rushing.td','receiving.td'],nhl:['sog','pts','goals','assists','blocks','hits'],mlb:['pitching.so','outs','pitching.bb','pitching.h','er','batting.h','batting.hr','total_bases','rbi']},allow=markets[league]||[];if(!/^per_[a-z0-9]+$/.test(pid)||!allow.includes(stat)||!Number.isFinite(line)||line<0||line>1000)return res.status(400).json({error:'Invalid player, market or line'});try{const u=new URL(base+'/analysis/player-prop');for(const[k,v]of Object.entries({person_id:pid,stat,line,competition:league}))u.searchParams.set(k,v);const r=await fetch(u,{headers:{'X-API-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)return res.status(r.status===401?502:r.status).json({available:false,provider:'StatsHawk',error:r.status===429?'Monthly quota exceeded':'Player history unavailable',providerStatus:r.status});const p=await r.json(),d=p.data||{};res.setHeader('Cache-Control','public,max-age=0,s-maxage=900');return res.json({available:true,provider:'StatsHawk',source:'StatsHawk historical player-prop card',league,player:d.person?.bio?.display_name||null,stat,line,averages:d.averages||null,hitRates:d.hit_rates||null,games:d.games??0,recent:(d.game_log_detail||[]).slice(-10).map(x=>({date:x.kickoff,value:x.value,opponent:x.opponent?.name||null})),caveat:'Historical observed hit rates, not prediction or verified bet365 line.'})}catch(e){return res.status(502).json({available:false,error:'Historical player analysis unavailable'})}}
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