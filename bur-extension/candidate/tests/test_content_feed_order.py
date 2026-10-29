"""Real content code must verify order and rewind before admitting feed observations."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
url='https://www.facebook.com/groups/feed-fixture/'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 for scenario in ['select','already','changed_order','missing','stale_document']:
  page=b.new_page();page.set_content('<div id="sort" role="button" aria-haspopup="dialog" aria-expanded="false">сортировать ленту группы по параметру<h2>Новые действия</h2></div><div role="feed"><article role="article"><a href="/groups/feed-fixture/posts/1700000000000001/">Date</a><div data-ad-preview="message">Post with explicit identity and independently verified feed order.</div></article></div>')
  page.evaluate('''scenario=>{
   const control=document.querySelector('#sort');
   if(scenario==='already'||scenario==='changed_order')control.querySelector('h2').textContent='Новые публикации';
   if(scenario==='missing')control.remove();
   control.onclick=()=>{control.setAttribute('aria-expanded','true');const panel=document.createElement('div');panel.setAttribute('role','dialog');panel.innerHTML='<div role="button">Новые публикации</div>';document.body.appendChild(panel);panel.firstChild.onclick=()=>{control.querySelector('h2').textContent='Новые публикации';control.setAttribute('aria-expanded','false');panel.remove();};};
   window.rewinds=0;window.observations=[];window.proofs=[];window.lost=[];
   window.job={id:'feed-order',stage:'discover',tabRole:'feed',group:'feed-fixture',paused:false,rewindPending:scenario!=='stale_document',checkpointPending:false,feedOrder:scenario==='stale_document'?{verified:true,order:'new_posts',page_instance:'old-doc'}:null};
   window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async msg=>{
    if(msg.type==='status')return {ok:true,result:window.job};
    if(msg.type==='rewindResult'){window.proofs.push(msg);if(msg.result.feed_order?.verified){window.job.rewindPending=false;window.job.feedOrder={...msg.result.feed_order,page_instance:msg.pageInstance};if(scenario==='changed_order')control.querySelector('h2').textContent='Недокументированный порядок';}else window.job.paused=true;return {ok:true,result:{ok:true}};}
    if(msg.type==='discover'){window.observations.push(msg);window.job.paused=true;return {ok:true,result:{stage:'paused'}};}
    if(msg.type==='feedOrderLost'){window.lost.push(msg);window.job.paused=true;return {ok:true,result:{recovering:true}};}
    if(msg.type==='obstructed')throw Error(JSON.stringify(msg));
    return {ok:true,result:{ready:true}};
   }}};
  }''',scenario)
  for file in ['core.js','feed-scroll.js','checkpoint-seek.js']:page.evaluate((root/file).read_text(encoding='utf-8'))
  page.evaluate('BurFeedScroll.rewindToTop=async()=>{window.rewinds++;return {ok:true}};BurFeedScroll.advance=async()=>({moved:false,tries:[]})')
  source=(root/'content.js').read_text(encoding='utf-8').replace('location.pathname',repr('/groups/feed-fixture/')).replace('location.href',repr(url))
  source=source.replace('const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));','const delay=()=>Promise.resolve();').replace('setTimeout(tick,900)','setTimeout(tick,0)').replace('setInterval(tick,2600)','setInterval(tick,10)')
  page.evaluate(source);page.wait_for_function('window.job.paused',timeout=15000)
  data=page.evaluate('({proofs:window.proofs,observations:window.observations,lost:window.lost,rewinds:window.rewinds})')
  if scenario in ['select','already']:
   assert len(data['proofs'])==len(data['observations'])==1,data
   proof=data['proofs'][0];obs=data['observations'][0]
   assert proof['result']['ok'] and proof['result']['feed_order']['order']=='new_posts',data
   assert data['rewinds']==(2 if scenario=='select' else 1),data
   assert proof['pageInstance']==obs['pageInstance'] and proof['pageInstance'],data
   assert obs['observations'][0]['post']['post_id']=='1700000000000001',data
  elif scenario=='changed_order':
   assert len(data['lost'])==len(data['proofs'])==1 and not data['observations'],data
   assert data['lost'][0]['feed_order']['status']=='other_order',data
  elif scenario=='missing':
   assert not data['observations'] and not data['proofs'][0]['result']['ok'],data
  else:
   assert len(data['lost'])==1 and not data['proofs'] and not data['observations'],data
  page.close()
 b.close()
print('PASS real content verifies New posts before discovery, rewinds after changing order, and rejects absent or stale-document proof without collecting')
