"""Real installed extension, intercepted FB fixture; never contacts live Facebook."""
from pathlib import Path
import tempfile,json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
cp='1727687685009933'
feed='https://www.facebook.com/groups/backpackIL/'
html='''<!doctype html><meta charset="utf-8"><style>body{margin:0;height:50000px}article{height:300px}</style>
<div role="feed"><article role="article"><a href="/groups/backpackIL/posts/1800000000000001/">Date</a><div data-ad-preview="message">Fixture post before checkpoint. Travel and routes.</div></article></div>'''
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp,sync_playwright() as p:
 ctx=p.chromium.launch_persistent_context(tmp,channel='chromium',headless=True,args=[f'--disable-extensions-except={root}',f'--load-extension={root}'])
 ctx.route('https://www.facebook.com/**',lambda route:route.fulfill(body=html,content_type='text/html'))
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 base=worker.url.rsplit('/',1)[0]
 control=ctx.new_page();control.goto(base+'/export.html?manual=1')
 print('setup: installed extension control ready',flush=True)
 page=ctx.new_page();page.goto(feed)
 page.wait_for_timeout(1200)
 cdp=ctx.browser.new_browser_cdp_session()
 def open_popup():
  page.bring_to_front()
  control.evaluate("()=>{void chrome.action.openPopup();return true}")
  page.wait_for_timeout(500)
  targets=cdp.send('Target.getTargets')['targetInfos']
  chosen=next(x for x in targets if x['url']==base+'/popup.html')
  session=cdp.send('Target.attachToTarget',{'targetId':chosen['targetId'],'flatten':False})['sessionId']
  responses={}
  def message(event):
   if event['sessionId']==session:
    value=json.loads(event['message'])
    if 'id' in value:responses[value['id']]=value
  cdp.on('Target.receivedMessageFromTarget',message)
  seq=[0]
  def evaluate(expression):
   seq[0]+=1;ident=seq[0]
   cdp.send('Target.sendMessageToTarget',{'sessionId':session,'message':json.dumps({'id':ident,'method':'Runtime.evaluate','params':{'expression':expression,'awaitPromise':True,'returnByValue':True}})})
   for _ in range(150):
    if ident in responses:break
    page.wait_for_timeout(100)
   response=responses.pop(ident)
   assert 'exceptionDetails' not in response.get('result',{}),response
   return response.get('result',{}).get('result',{}).get('value')
  return evaluate
 def get_job():
  return control.evaluate("async()=> (await chrome.storage.local.get('burCollectorJob-v0520'))['burCollectorJob-v0520']")
 def until(predicate,seconds=30):
  for _ in range(seconds*5):
   state=get_job()
   if predicate(state):return state
   page.wait_for_timeout(200)
  raise AssertionError('state timeout: '+json.dumps(get_job()))
 print('setup: opening actual toolbar popup',flush=True)
 pe=open_popup()
 manifest=pe('chrome.runtime.getManifest()')
 assert manifest['version_name']=='0.5.23-alpha'
 assert pe("document.querySelector('#status').innerText.includes('Нет задания')")
 tabid=control.evaluate("async()=> (await chrome.tabs.query({})).find(x=>x.url==='https://www.facebook.com/groups/backpackIL/').id")
 ping=control.evaluate('(id)=>chrome.tabs.sendMessage(id,{type:"burPing"})',tabid)
 assert ping['version']==manifest['version_name']
 pe("document.querySelector('#startAfter').value='"+cp+"';document.querySelector('#maxPosts').value='5';document.querySelector('#start').click()")
 saved=until(lambda x:x and x.get('checkpointPostId')==cp)
 assert saved['discovered']==0
 page.wait_for_timeout(3500)
 # Reopening the toolbar popup is the normal operator flow after feed reload.
 pe=open_popup();pe("document.querySelector('#pause').click()")
 saved=until(lambda x:x and x.get('paused'))
 session=saved['id'];print('checkpoint: paused persisted',flush=True);page.reload()
 pe=open_popup()
 assert pe("document.querySelector('#status').innerText.includes('"+cp+"')")
 pe("document.querySelector('#startAfter').value='';document.querySelector('#start').click()")
 status=until(lambda x:x and not x.get('paused'))
 assert status['id']==session and status['checkpointPostId']==cp and status['discovered']==0
 page.evaluate('''cp=>{window.scrollTo(0,0);document.querySelector('[role=feed]').innerHTML=`<article role="article"><a href="/groups/backpackIL/posts/${cp}/">Date</a><div data-ad-preview="message">Exact checkpoint fixture. Long enough body for extraction.</div></article>`;}''',cp)
 status=until(lambda x:x and x.get('checkpointFound'))
 assert status['checkpointPostId']==cp and not status['checkpointPending'] and status['discovered']==0
 pe=open_popup();pe("document.querySelector('#pause').click()")
 until(lambda x:x and x.get('paused'))
 ctx.close()
 # Reopen same profile and same extension path: verify ID and durable state.
 ctx=p.chromium.launch_persistent_context(tmp,channel='chromium',headless=True,args=[f'--disable-extensions-except={root}',f'--load-extension={root}'])
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 assert worker.url.rsplit('/',1)[0]==base
 control=ctx.new_page();control.goto(base+'/export.html?manual=1')
 print('restart: extension control ready',flush=True)
 state=control.evaluate("async()=> (await chrome.storage.local.get('burCollectorJob-v0520'))['burCollectorJob-v0520']")
 assert state['id']==session and state['checkpointPostId']==cp and state['checkpointFound']
 ctx.close()
print('PASS fresh install + aligned ping + actual popup Start + persistence + page reload + resume + exact checkpoint + profile restart, same extension ID')
