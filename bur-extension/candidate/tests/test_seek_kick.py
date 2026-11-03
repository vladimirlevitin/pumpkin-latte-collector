'''0.5.33: real content.js during checkpoint seek. When the feed stops loading, the page script
nudges the feed and keeps waiting (seekKick) instead of ending discovery after ~30 s.
A) Facebook delivers the next slice after the first nudge -> checkpoint found, no endDiscovery.
B) Facebook never delivers -> the seek keeps nudging instead of pausing (checked for 2 rounds).
Status polling during the seek uses the cheap seekStatus message.'''
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
N=40
CP=str(1700000000000000+N)
def card(i):
 return f'''<div role="article" id="p{i}" style="height:{300+(i*37)%250}px;border:1px solid #ccc">
<a href="/groups/backpackIL/posts/{1700000000000000+i}/">{i} ч.</a>
<div data-ad-comet-preview="message">Пост номер {i}: маршрут, вода, тень.</div></div>'''
html='<!doctype html><html><head><meta charset="utf-8"></head><body><div role="feed">'+''.join(card(i) for i in range(N))+'</div></body></html>'
CP_CARD=card(N)
def run(page,deliver,limit=150,stop_after=99):
 page.set_content(html)
 job={'id':'seek','stage':'discover','tabRole':'feed','group':'backpackIL','paused':False,'feedOrder':None,
      'checkpointPending':True,'checkpointPostId':CP,'options':{'maxPosts':5000}}
 page.evaluate('''([job,cpCard,deliver,cp])=>{window.testJob=job;window.log={kicks:[],end:0,status:0,seekStatus:0,found:false};
 window.chrome={runtime:{sendMessage:async(msg)=>{
  const j=window.testJob,L=window.log;
  if(msg.type==='status'){L.status++;return {ok:true,result:j};}
  if(msg.type==='seekStatus'){L.seekStatus++;return {ok:true,result:{id:j.id,group:j.group,stage:j.stage,paused:j.paused,checkpointPending:j.checkpointPending,rewindPending:false}};}
  if(msg.type==='feedOrderLost'){j.feedOrder={verified:true,page_instance:msg.pageInstance};return {ok:true,result:{}};}
  if(msg.type==='seekKick'){L.kicks.push(msg.kick);
   if(deliver&&L.kicks.length===1)setTimeout(()=>document.querySelector('[role=feed]').insertAdjacentHTML('beforeend',cpCard),500);
   return {ok:true,result:{ok:true}};}
  if(msg.type==='discover'){const hit=msg.observations.some(o=>String(o.post.post_id)===cp&&o.visible);
   if(hit){L.found=true;j.checkpointPending=false;j.paused=true;return {ok:true,result:{stage:'discover',seekingCheckpoint:false,added:0}};}
   return {ok:true,result:{stage:'discover',seekingCheckpoint:true,added:0}};}
  if(msg.type==='endDiscovery'){L.end++;j.paused=true;return {ok:true,result:{}};}
  return {ok:true,result:{}};
 },onMessage:{addListener:()=>{}}}};}''',[job,CP_CARD,deliver,CP])
 for f in ['core.js','feed-scroll.js','checkpoint-seek.js','content.js']:
  src=(root/f).read_text(encoding='utf-8')
  if f=='content.js':
   src=src.replace('location.pathname',repr('/groups/backpackIL/')).replace('location.href',repr('https://www.facebook.com/groups/backpackIL/'))
  page.evaluate(src)
 # Poll from Python: in headless Chromium a pending wait_for_function can freeze page timers.
 import time
 end=time.time()+limit
 while time.time()<end:
  if page.evaluate('window.testJob.paused===true||(window.log.kicks.length>=stop_after)'.replace('stop_after',str(stop_after))):break
  time.sleep(1)
 return page.evaluate('window.log')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1000,'height':800})
 a=run(page,True);print('A',a)
 assert a['found'] and a['end']==0 and a['kicks']==[1],a
 assert a['seekStatus']>a['status'],a
 page=b.new_page(viewport={'width':1000,'height':800})
 # B is shortened to keep the suite fast: the feed never loads, the seek keeps nudging (no pause) for 2 rounds.
 z=run(page,False,limit=200,stop_after=2);print('B',z)
 assert not z['found'] and z['end']==0 and z['kicks']==[1,2],z
 print('PASS: stalled seek nudges the feed and recovers; keeps nudging instead of pausing; cheap status polling')
 b.close()
