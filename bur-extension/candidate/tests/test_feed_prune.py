'''0.5.31: feed memory guard. Real content.js on a synthetic 220-card feed: cards far above the
viewport that were already handed to the worker are emptied in place (media released, exact height
kept), so layout/scroll do not move; protected boundary card and the nearest cards stay intact.'''
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
N=220
GIF='data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
cards=''.join(f'''<div role="article" id="p{i}" style="height:{300+(i*37)%250}px;border:1px solid #ccc">
<a href="/groups/backpackIL/posts/{1700000000000000+i}/">{i} ч.</a>
<div data-ad-comet-preview="message">Пост номер {i}: маршрут, вода, тень и парковка у начала тропы.</div>
<img src="{GIF}" width="400" height="200"></div>''' for i in range(N))
html=f'<!doctype html><html><head><meta charset="utf-8"></head><body><div role="feed">{cards}</div></body></html>'
PROTECT=str(1700000000000000+10)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1000,'height':800});page.set_content(html)
 job={'id':'prune','stage':'discover','tabRole':'feed','group':'backpackIL','paused':False,'feedOrder':None,'checkpointPostId':PROTECT,'options':{'maxPosts':5000}}
 page.evaluate('''(job)=>{window.testJob=job;window.sent=new Set();window.steps=0;
 window.chrome={runtime:{sendMessage:async(msg)=>{
  const j=window.testJob;
  if(msg.type==='status')return {ok:true,result:j};
  if(msg.type==='feedOrderLost'){j.feedOrder={verified:true,page_instance:msg.pageInstance};return {ok:true,result:{}};}
  if(msg.type==='discover'){window.steps++;for(const o of msg.observations)window.sent.add(String(o.post.post_id));if(window.steps>=120)j.paused=true;return {ok:true,result:{stage:'discover',added:1,discovered:window.sent.size}};}
  if(msg.type==='endDiscovery'){j.paused=true;return {ok:true,result:{}};}
  return {ok:true,result:{}};
 },onMessage:{addListener:()=>{}}}};}''',job)
 for f in ['core.js','feed-scroll.js','checkpoint-seek.js','content.js']:
  src=(root/f).read_text(encoding='utf-8')
  if f=='content.js':
   src=src.replace('location.pathname',repr('/groups/backpackIL/')).replace('location.href',repr('https://www.facebook.com/groups/backpackIL/'))
  page.evaluate(src)
 page.wait_for_function('window.testJob.paused===true',timeout=300000)
 r=page.evaluate('''(protect)=>{const cards=[...document.querySelectorAll('div[id^=p]')];
  const pruned=cards.filter(c=>c.dataset.burPruned);
  const vh=innerHeight;
  return {pruned:pruned.length,total:cards.length,scrollY:scrollY,
   protectPruned:Boolean(document.getElementById('p10').dataset.burPruned),
   heightsKept:pruned.every(c=>Math.abs(c.getBoundingClientRect().height-parseFloat(c.style.height))<1.5&&c.childElementCount===0),
   farAbove:pruned.every(c=>c.getBoundingClientRect().bottom< -2*vh),
   nearIntact:cards.filter(c=>{const r=c.getBoundingClientRect();return r.bottom>-vh&&r.top<2*vh;}).every(c=>!c.dataset.burPruned&&c.querySelector('img')),
   unsentPruned:pruned.filter(c=>!window.sent.has(String(1700000000000000+Number(c.id.slice(1))))).length,
   observedAfter:[...document.querySelectorAll('[role=article]')].filter(c=>c.dataset.burPruned).length,
   steps:window.steps};}''',PROTECT)
 print(r)
 assert r['pruned']>20,r
 assert not r['protectPruned'],r
 assert r['heightsKept'] and r['farAbove'] and r['nearIntact'],r
 assert r['unsentPruned']==0 and r['observedAfter']==0,r
 # layout did not shift: card offsets equal their original cumulative heights
 shift=page.evaluate('''()=>{let y=null,bad=0;for(const c of document.querySelectorAll('div[id^=p]')){const t=c.getBoundingClientRect().top+scrollY;if(y!==null&&Math.abs(t-y)>2)bad++;y=t+c.getBoundingClientRect().height;}return bad;}''')
 assert shift==0,shift
 print('PASS: passed cards emptied in place, heights kept, scroll unaffected, boundary and nearby cards intact, only submitted IDs pruned')
 b.close()
