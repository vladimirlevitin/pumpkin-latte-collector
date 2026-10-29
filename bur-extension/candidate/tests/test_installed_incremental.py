"""Real installed extension and JSON downloads; all Facebook responses are local fixtures."""
from pathlib import Path
import hashlib,json,tempfile,time
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
group='offline-incremental';feed='https://www.facebook.com/groups/'+group+'/'
def post_id(n):return str(1700000000000000+n)
def article(n):
 return f'''<article role="article" style="min-height:160px"><h3><a href="/profile.php?id={10000000+n}">Fixture Author {n}</a></h3><a href="/groups/{group}/posts/{post_id(n)}/"><time datetime="2026-10-28T10:00:00Z">28 October 2026</time></a><div data-ad-preview="message">Fixture publication {n}: complete offline source text with <a href="https://example.org/map/{n}">map link</a>.</div></article>'''
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile,sync_playwright() as p:
 ctx=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,accept_downloads=True,args=[f'--disable-extensions-except={root}',f'--load-extension={root}'])
 phase=[1];downloads=[]
 def routed(route):
  url=route.request.url
  ids=([10,9,8,7,6] if phase[0]==1 else [20,10,9,8,7,6]) if '/posts/' not in url else [int(url.split('/posts/')[1].split('/')[0])-1700000000000000]
  route.fulfill(body='<!doctype html><meta charset="utf-8"><style>body{margin:0}article{padding:8px}</style><main role="main"><div role="button" aria-haspopup="dialog" aria-expanded="false">сортировать ленту группы по параметру<h2>Новые публикации</h2></div><div role="feed">'+''.join(article(n) for n in ids)+'</div></main>',content_type='text/html')
 ctx.route('https://www.facebook.com/**',routed)
 ctx.route('https://example.org/**',lambda route:route.abort())
 ctx.on('page',lambda page:page.on('download',lambda download:downloads.append(download)))
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 base=worker.url.rsplit('/',1)[0]
 controller=ctx.new_page();controller.goto(base+'/export.html?manual=1')
 page=ctx.new_page();page.goto(feed)
 page.wait_for_timeout(1200)
 tab=controller.evaluate('(url)=>chrome.tabs.query({}).then(tabs=>tabs.find(t=>t.url===url).id)',feed)
 def call(kind,**args):
  controller.bring_to_front()
  try:
   response=controller.evaluate('msg=>Promise.race([chrome.runtime.sendMessage(msg),new Promise((_,reject)=>setTimeout(()=>reject(Error("No worker response: "+msg.type)),15000))])',{'type':kind,**args})
  except Exception:
   print('diagnostic',controller.evaluate("()=>chrome.storage.local.get(['burCollectorJob-v0520'])"),flush=True)
   raise
  assert response['ok'],response
  return response.get('result')
 def job():return call('status')
 def until(predicate,timeout=100):
  deadline=time.monotonic()+timeout
  previous=None
  while time.monotonic()<deadline:
   state=job()
   signature=(state or {}).get('stage'),(state or {}).get('index'),(state or {}).get('completedBatches')
   if signature!=previous:print('state',signature,flush=True);previous=signature
   if predicate(state):return state
   if state and state.get('stage')=='stalled':raise AssertionError('unexpected stalled: '+json.dumps(state,ensure_ascii=True))
   page.wait_for_timeout(200)
  raise AssertionError('timeout: '+json.dumps(job(),ensure_ascii=True))
 page.wait_for_timeout(500)
 call('start',tabId=tab,url=feed,options={'maxPosts':5})
 first=until(lambda j:j and j.get('completedBatches',0)>=1)
 call('pause');before=call('archiveStatus',group=group)
 assert before['head']==post_id(10) and before['tail']==post_id(6),before
 assert len(downloads)==1, len(downloads)
 first_bytes=Path(downloads[0].path()).read_bytes();first_raw=json.loads(first_bytes)
 assert len(first_raw['posts'])==5 and len(first_raw['authors'])==5
 assert first_raw['job_summary']['feed_order']['verified'] and first_raw['job_summary']['feed_order']['order']=='new_posts'
 assert first['lastExport']['sha256']==hashlib.sha256(first_bytes).hexdigest()
 assert all(p['published_at']=='2026-10-28T10:00:00.000Z' and p['links'] for p in first_raw['posts'])
 phase[0]=2;page.reload();page.wait_for_timeout(500)
 call('start',tabId=tab,url=feed,mode='update',replacePaused=True,options={'maxPosts':5})
 done=until(lambda j:j and j.get('stage')=='done')
 after=call('archiveStatus',group=group)
 assert after['head']==post_id(20) and after['tail']==post_id(6),after
 assert len(downloads)==2,len(downloads)
 second_bytes=Path(downloads[1].path()).read_bytes();second_raw=json.loads(second_bytes)
 assert [p['post_id'] for p in second_raw['posts']]==[post_id(20)],second_raw
 assert second_raw['job_summary']['collection_mode']=='update'
 assert second_raw['job_summary']['feed_order']['verified'] and second_raw['job_summary']['feed_order']['order']=='new_posts'
 assert second_raw['job_summary']['update_stop_post_id']==post_id(10)
 assert second_raw['job_summary']['update_boundary_reached'] is True
 assert done['lastExport']['sha256']==hashlib.sha256(second_bytes).hexdigest()
 call('start',tabId=tab,url=feed,mode='update',options={'maxPosts':5})
 until(lambda j:j and j.get('stage')=='done')
 assert len(downloads)==2,'no-change pass must not create a fake empty import batch'
 state=controller.evaluate("async()=> (await chrome.storage.local.get('burCollectorCheckpoints-v0520'))['burCollectorCheckpoints-v0520']")
 assert state[group]['post_id']==post_id(6)
 ctx.close()
print('PASS installed Chromium: first root -> Deep -> real 5-post download -> pause -> new root -> 1-post delta -> unchanged historical tail -> no-change update; author graph/date/link data preserved, all Facebook traffic replaced by fixtures')
