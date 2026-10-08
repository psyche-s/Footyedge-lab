const sources={
 board:(day)=>'data/boards/'+day+'.json',
 fixtures:(day)=>'data/'+day+'/fixtures.json',
 research:(day)=>'data/research-base-'+day+'.json',
 readiness:()=> 'data/board-readiness.json',
 performance:()=> 'data/performance/summary.json'
};
module.exports=async function handler(req,res){
  const kind=String(req.query.kind||'');
  const date=String(req.query.date||'');
  if(!Object.hasOwn(sources,kind)||(['board','fixtures','research'].includes(kind)&&!/^\d{4}-\d{2}-\d{2}$/.test(date))){
    return res.status(400).json({error:'Unsupported request'});
  }
  try{
    const url='https://raw.githubusercontent.com/psyche-s/footyedge-board/main/'+sources[kind](date);
    const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'FootyEdge-Lab'},signal:AbortSignal.timeout(12000)});
    if(!r.ok)return res.status(r.status===404?404:502).json({unavailable:true,kind,date,status:r.status});
    const payload=await r.json();
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=40, stale-while-revalidate=100');
    res.setHeader('X-FootyEdge-Origin','main-readonly');
    return res.status(200).json(payload);
  }catch(e){return res.status(502).json({error:'FootyEdge feed temporarily unavailable'})}
};