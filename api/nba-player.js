'use strict';
// Historical NBA game-log lookup from an ESPN athlete ID.
// Does not infer starting status, market lines, odds, or probability.
const {parseLog,seasonYear}=require('../lib/free-nba');
module.exports=async function(req,res){
 const id=String(req.query.player||'');
 if(!/^\d{1,12}$/.test(id))return res.status(400).json({error:'Invalid NBA player ID'});
 const date=new Date(),toronto=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
 const iso=toronto.year+'-'+toronto.month+'-'+toronto.day,year=seasonYear(iso);
 const base='https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/'+id+'/gamelog?season=';
 const get=async y=>{const r=await fetch(base+y,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(7500)});if(!r.ok)throw Error('NBA feed HTTP '+r.status);return parseLog(await r.json(),iso)};
 try{
  const [current,previous]=await Promise.allSettled([get(year),get(year-1)]);
  if(current.status!=='fulfilled'&&previous.status!=='fulfilled')throw Error('Game logs unavailable');
  const all=[...(previous.status==='fulfilled'?previous.value:[]),...(current.status==='fulfilled'?current.value:[])]
   .sort((a,b)=>a.date.localeCompare(b.date));
  const dedup=[...new Map(all.map(x=>[x.gameId,x])).values()].slice(-10);
  res.setHeader('Cache-Control','public,max-age=0,s-maxage=900,stale-while-revalidate=900');
  return res.json({available:true,source:'ESPN public NBA regular-season game logs',playerId:id,season:year,
   last10:dedup.reverse(),warnings:['Regular-season statistics only. Preseason/playoff results excluded. No injury confirmation, quoted odds or projected minutes.']});
 }catch(e){return res.status(502).json({available:false,error:'NBA player history unavailable from free source'})}
};