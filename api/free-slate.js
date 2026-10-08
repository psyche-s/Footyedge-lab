'use strict';
const C=require('../lib/free-core');
const sources={nhl:require('../lib/free-nhl'),nfl:require('../lib/free-nfl'),mlb:require('../lib/free-mlb')};
async function serve(req,res,info={}){
 const league=String(req.query?.league||'').toLowerCase(),date=String(req.query?.date||''),view=String(req.query?.view||'ranked');
 if(!sources[league]||!/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)||!['ranked','scorers'].includes(view))
   return res.status(400).json({available:false,error:'A valid league, ISO date and ranked/scorers view are required.'});
 try{
  const result=await sources[league].run(date);
  const notes=[...result.warnings,'Free-source fallback active: '+(info.reason||'StatsHawk omitted or unavailable')+'. No bet365, DraftKings or FanDuel market prices are inferred.'];
  const output=view==='scorers'?C.scoringBoard(league,date,result.entries,notes,result.sources):C.rankedBoard(league,date,result.entries,notes,result.sources);
  output.coverage={games:result.games||0,playersChecked:result.playerLogsChecked??result.playersMatched??null,sourceMode:'free-public-data',lineups:'Only official MLB batting-order confirmations are accepted; NHL/NFL projected starters remain unconfirmed'};
  res.setHeader('Cache-Control','public,max-age=0,s-maxage=600,stale-while-revalidate=600');
  res.setHeader('X-SportsLab-Research-Source','public-league-fallback');
  return res.status(200).json(output);
 }catch(e){
  res.setHeader('Cache-Control','no-store');
  return res.status(503).json({available:false,league,date,fallback:true,error:'All eligible public '+league.toUpperCase()+' research feeds are unavailable or lack verifiable game statistics.',reason:String(e?.message||'Unavailable').slice(0,180),warnings:['No stale picks or invented bookmaker odds will be published as current.'],sources:[]});
 }
}
module.exports=serve;
