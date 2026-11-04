"""Install exact unpacked ZIP into isolated Chromium; intercept every network request."""
from pathlib import Path
import os, json, tempfile
from playwright.sync_api import sync_playwright
root=Path(os.environ['EXPLORER_ROOT']).resolve()
feed='https://www.facebook.com/groups/testgroup/'
post1=feed+'posts/1772823333829701/'
post2=feed+'posts/1772475750531126/'
htmlfeed=f'''<!doctype html><meta charset="utf-8"><div role="main"><div role="feed">
<article role="article"><a href="{post1}">date 1</a></article><article role="article"><a href="{post2}">date 2</a></article></div></div>'''
htmlpost='''<!doctype html><meta charset="utf-8"><style>#thread article{display:inline-block;width:2px;height:2px;overflow:hidden}</style><div role="main"><div data-ad-rendering-role="story_message">PRIVATE POST MUST NOT ENTER LOG <span>Страница сейчас недоступна</span></div>
<span>1,2 тыс. комментариев</span><button id="sort" aria-haspopup="menu" onclick="document.getElementById('menu').hidden=false">Самые актуальные</button>
<div id="menu" hidden><button role="menuitem" onclick="this.parentElement.hidden=true;document.getElementById('sort').textContent='Все комментарии'">Все комментарии</button></div>
<button id="more" onclick="let a=document.createElement('article');a.setAttribute('role','article');let l=document.createElement('a');l.href='?comment_id=123456789';l.textContent='PRIVATE COMMENT MUST NOT ENTER LOG';a.append(l);document.getElementById('thread').append(a);this.remove()">Смотреть другие комментарии</button>
<button onclick="let d=document.createElement('div');d.setAttribute('role','dialog');d.style.cssText='position:fixed;top:20px;left:20px;width:300px;height:200px;background:white';let a=document.createElement('article');a.setAttribute('role','article');let l=document.createElement('a');l.href='?comment_id=111111111';l.textContent='PRIVATE REPLY MUST NOT ENTER LOG';a.append(l);let b=document.createElement('button');b.textContent='Закрыть';b.onclick=()=>d.remove();d.append(a,b);document.body.append(d);this.remove()">Посмотреть 1 ответ</button>
<div id="thread">'''+''.join(f'<article role="article"><a href="?comment_id={i+90000000}">date</a></article>' for i in range(1002))+'''</div></div>'''
error='<!doctype html><meta charset="utf-8"><main><h1>Страница сейчас недоступна</h1></main>'
break_on_expand=[False]
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp,sync_playwright() as p:
 def launch(preexisting=False):
  args=['--enable-unsafe-extension-debugging']
  ctx=p.chromium.launch_persistent_context(tmp,channel='chromium',headless=True,args=args,ignore_default_args=['--disable-extensions'])
  def route(q):
   if q.request.url.startswith('chrome-extension://'):q.continue_()
   elif q.request.url==feed:q.fulfill(body=htmlfeed,content_type='text/html')
   elif q.request.url==post1:
    body=htmlpost
    if break_on_expand[0]:body=body.replace("this.remove()", "this.remove();let h=document.createElement('h1');h.textContent='Страница сейчас недоступна';document.querySelector('[role=main]').replaceChildren(h)")
    q.fulfill(body=body,content_type='text/html')
   elif q.request.url==post2:q.fulfill(body=error,status=429,content_type='text/html')
   elif q.request.url.startswith('https://www.facebook.com/api/graphql'):q.fulfill(body='{}',status=503,content_type='application/json')
   else:q.abort()
  ctx.route('**/*',route)
  if not preexisting:ctx.browser.new_browser_cdp_session().send('Extensions.loadUnpacked',{'path':str(root)})
  return ctx
 ctx=launch(True)
 page=ctx.new_page();page.goto(feed)
 page.evaluate("()=>{document.body.style.minHeight='2500px';window.scrollTo(0,400)}")
 assert page.evaluate('scrollY')==400
 # Install the real unpacked extension AFTER Facebook is already open.
 cdp=ctx.browser.new_browser_cdp_session()
 installed=cdp.send('Extensions.loadUnpacked',{'path':str(root)})
 print('setup: isolated Chromium launched',flush=True)
 base='chrome-extension://'+installed['id']
 ui=ctx.new_page();ui.on('pageerror',lambda e:print('panel error: '+str(e),flush=True));ui.goto(base+'/panel.html');ui.set_default_timeout(10000)
 worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
 worker.on('console',lambda m:print('worker console: '+m.text,flush=True))
 print('setup: panel opened',flush=True)
 assert base=='chrome-extension://'+installed['id']
 missing=ui.evaluate("async()=>{const tab=(await chrome.tabs.query({})).find(t=>t.url==='https://www.facebook.com/groups/testgroup/');try{await chrome.tabs.sendMessage(tab.id,{type:'ping'});return false}catch{return true}}")
 assert missing,'Regression precondition: existing FB tab unexpectedly has a live receiver'
 print('setup: reproduced missing receiver in pre-existing Facebook tab; scroll position 400',flush=True)
 ui.bring_to_front()
 def send(kind,**kw):return ui.evaluate("async m=>{const r=await Promise.race([chrome.runtime.sendMessage(m),new Promise((_,reject)=>setTimeout(()=>reject(Error('worker reply timeout: '+m.type)),10000))]);if(!r.ok)throw Error(r.error);return r.result}",dict(type=kind,**kw))
 def state():return send('state')
 def until(pred,timeout=60):
  for tick in range(timeout*5):
   s=state()
   if pred(s):return s
   if s and not s.get('running') and s.get('lastSignal')=='paused':
    print('DEBUG JOURNAL '+json.dumps(send('journal',run=s['id'])[-12:],ensure_ascii=True),flush=True)
    for page_debug in ctx.pages:
     if page_debug.url.startswith('https://www.facebook.com'):
      print('DEBUG DOM '+json.dumps(page_debug.evaluate('()=>({url:location.href,body:document.body.innerHTML.slice(0,800)})'),ensure_ascii=True),flush=True)
    raise AssertionError(json.dumps(s,ensure_ascii=True))
   if tick%50==0:print('waiting: '+json.dumps({k:s.get(k) for k in ['phase','running','current','actions','reason']} if s else None,ensure_ascii=True),flush=True)
   ui.wait_for_timeout(200)
  raise AssertionError(json.dumps(state(),ensure_ascii=False))
 tab=ui.evaluate("async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://www.facebook.com/groups/testgroup/').id")
 ui.locator('#refresh').click();ui.locator('#tab').select_option(str(tab));ui.locator('#delay').fill('1');ui.locator('#start').click()
 print('setup: Start clicked',flush=True)
 first=until(lambda s:s and s.get('current')=='1772823333829701',15)
 run=first['id']
 fault=until(lambda s:s and not s['running'] and s.get('lastSignal')=='fault',90)
 assert fault['current']=='1772475750531126',fault
 assert fault['checked']==1,fault
 def events():return send('journal',run=run)
 rows=events();kinds=[e['kind'] for e in rows]
 assert any(e['kind']=='probe_connected' and e['data']['connection']=='connected_existing_tab' for e in rows)
 assert any(e['kind']=='feed_scan' and e['data']['snapshot']['scrollY']==400 for e in rows)
 print('PASS Start connects pre-existing tab without reload or scroll reset',flush=True)
 assert 'error_screen' in kinds and 'navigation_intent' in kinds and 'action_intent' in kinds,kinds
 assert any(e['kind']=='network_complete' and e['data']['status']==429 for e in rows),rows
 assert any(e['kind']=='observation' and e['data'].get('commentElements',0)>1000 for e in rows)
 assert any(e['kind']=='action_intent' and e['data']['action']=='select_all_comments' for e in rows)
 assert any(e['kind']=='action_intent' and e['data']['action']=='comments' for e in rows),json.dumps([e for e in rows if e['kind'] in ['action_intent','observation']],ensure_ascii=True)
 assert any(e['kind']=='reply_dialog_opened' for e in rows)
 assert any(e['kind']=='action_intent' and e['data']['action']=='close_reply_dialog' for e in rows)
 assert all(marker not in json.dumps(rows) for marker in ['PRIVATE POST','PRIVATE COMMENT','PRIVATE REPLY'])
 print('PASS installed walk: >1000 DOM comments + sort + expand + second-post HTTP429/error stop; no content in journal',flush=True)
 count=len([e for e in rows if e['kind']=='action_intent']);ui.wait_for_timeout(2500)
 assert len([e for e in events() if e['kind']=='action_intent'])==count
 ui.locator('#retry').click()
 again=until(lambda s:s and s['attempt']==2 and not s['running'] and s.get('lastSignal')=='fault')
 assert again['checked']==1 and again['current']==fault['current']
 assert any(e['kind']=='retry' for e in events())
 print('PASS no automatic retries; manual same-post reload recorded as attempt 2',flush=True)
 # Verify network telemetry strips query strings and request payload.
 detail=next(t for t in ctx.pages if t.url==post2)
 detail.evaluate("()=>fetch('/api/graphql/?SECRET_QUERY=hidden',{method:'POST',body:'SECRET_BODY=hidden'})")
 ui.wait_for_timeout(1000)
 rows=events();assert any(e['kind']=='network_complete' and e['data']['status']==503 and e['data']['endpoint']=='graphql' for e in rows)
 assert 'SECRET_' not in json.dumps(rows)
 print('PASS network evidence records HTTP503 without URL query/body',flush=True)
 # Manually start on another group: must not accept prior tab under wrong mode.
 bad=ui.evaluate("async tab=>chrome.runtime.sendMessage({type:'start',tab,mode:'single'})",tab)
 assert not bad['ok']
 # A new single-post run, pause persistence, and prior run retention.
 page.goto(post1);ui.locator('#refresh').click();ui.locator('#tab').select_option(str(tab));ui.locator('#mode').select_option('single');ui.locator('#start').click()
 single=until(lambda s:s and s['id']!=run and s['running']);ui.locator('#pause').click();paused=until(lambda s:s and not s['running'])
 assert paused['mode']=='single'
 # Error immediately after expansion must retain causal timing and the action.
 break_on_expand[0]=True
 ui.locator('#start').click()
 after_click=until(lambda s:s and s['id']!=paused['id'] and not s['running'] and s.get('lastSignal')=='fault')
 action_rows=send('journal',run=after_click['id'])
 screen=next(e for e in action_rows if e['kind']=='error_screen')
 assert screen['data']['lastAction']['action']=='comments',screen
 assert 0<=screen['data']['sinceActionMs']<5000,screen
 assert screen['data']['sinceNavigationMs']>=screen['data']['sinceActionMs']
 paused=after_click
 print('PASS error after comment expansion records last action and both timing intervals',flush=True)
 oldrows=events();assert oldrows
 ctx.close()
 ctx=launch();ui=ctx.new_page();ui.goto(base+'/panel.html')
 restored=state();assert restored['id']==paused['id'] and not restored['running']
 assert send('journal',run=run)==oldrows
 assert len(send('runs'))==3
 # Unrelated tabs/content scripts cannot control a run.
 unrelated=ctx.new_page();unrelated.goto(feed)
 assert unrelated.evaluate("()=>typeof chrome.runtime")=='undefined'
 assert 'externally_connectable' not in json.loads((root/'manifest.json').read_text(encoding='utf-8'))
 print('PASS browser restart: local journal + attempts + run history retained; ordinary page has no extension messaging access',flush=True)
 ctx.close()
print('PASS exact unpacked ZIP installed in isolated Chromium. Live Facebook NOT tested.')
