from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
ID='1759778711800830'
URL='https://www.facebook.com/groups/backpackIL/posts/'+ID+'/'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1200,'height':800})
 page.route('**/*',lambda route: route.fulfill(status=200,content_type='text/html; charset=utf-8',body='<html><body></body></html>'))
 page.goto(URL)
 job={'id':'edge059','stage':'deep','group':'backpackIL','paused':False,'queue':[ID],'index':0,'deepPhase':'READY'}
 page.evaluate('''(job)=>{window.testJob=job;window.snapshots=[];window.obstructions=[];
 window.chrome={runtime:{sendMessage:async(msg)=>{
   if(msg.type==='status')return {ok:true,result:window.testJob};
   if(msg.type==='deepReady'){window.testJob.deepPhase='READY';return {ok:true,result:window.testJob};}
   if(msg.type==='deepExpanding'){window.testJob.deepPhase='EXPANDING';return {ok:true,result:window.testJob};}
   if(msg.type==='deepSnapshot'){window.snapshots.push(msg);window.testJob.paused=true;return {ok:true,result:{ok:true}};}
   if(msg.type==='obstructed'){window.obstructions.push(msg);window.testJob.paused=true;return {ok:true,result:{ok:true}};}
   if(msg.type==='deepMismatch')return {ok:true,result:{waiting:true}};
   return {ok:true,result:{ok:true}};
 },onMessage:{addListener:()=>{}}}};}''',job)
 for name in ['core.js','feed-scroll.js','content.js']:
   src=(root/name).read_text(encoding='utf-8')
   if name=='content.js':
     src=src.replace('const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));','const delay=ms=>new Promise(resolve=>setTimeout(resolve,0));')
   page.evaluate(src)
 page.wait_for_function('window.snapshots.length===1',timeout=15000)
 snap=page.evaluate('window.snapshots[0]')
 assert snap['post']['post_id']==ID,snap
 assert snap.get('fallback')=='url_identity_existing_discovery',snap
 assert not page.evaluate('window.obstructions.length'),page.evaluate('window.obstructions')
 # Structured overlay diagnostics
 page.set_content('<div role="dialog" id="login" aria-label="Login checkpoint" style="position:fixed;inset:0">Log in to continue</div>')
 page.evaluate("window.view={location:{pathname:'/groups/backpackIL/posts/"+ID+"/'},innerWidth:1200,innerHeight:800,getComputedStyle:e=>getComputedStyle(e)}")
 diag=page.evaluate("BurFeedScroll.deepObstruction(document,view,null)")
 assert diag and diag['coverage']>=90 and diag['aria_label']=='Login checkpoint' and 'Log in' in (diag['text_sample'] or ''),diag
 print('PASS: verified URL fallback succeeds and overlay diagnostics are structured')
 b.close()
