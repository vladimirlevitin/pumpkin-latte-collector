"""Installed extension: actual JSON download must precede checkpoint commit."""
from pathlib import Path
import hashlib,json,tempfile,time
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile,sync_playwright() as p:
 def launch():
  c=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,accept_downloads=True,args=[f'--disable-extensions-except={root}',f'--load-extension={root}'])
  w=c.service_workers[0] if c.service_workers else c.wait_for_event('serviceworker')
  control=c.new_page();control.goto(w.url.rsplit('/',1)[0]+'/popup.html')
  return c,w,control
 c,w,control=launch();base=w.url.rsplit('/',1)[0]
 control.evaluate('''async()=>{
  const ids=['1700000000000011','1700000000000012'];
  const j={id:'download-test',sessionId:'download-test',group:'offline-fixture',feedOrder:{verified:true,order:'new_posts',page_instance:'saved-source-doc'},stage:'exporting',paused:true,batchNumber:1,completedBatches:0,sessionPosts:0,sessionDeepDone:0,sessionDeepErrors:0,options:{maxPosts:5},discovered:2,steps:1,queue:ids,discoveryOrder:ids,deepDone:2,deepErrors:0,lastCollectedPostId:ids[1]};
  await chrome.storage.local.set({'burCollectorJob-v0520':j});
  await new Promise((resolve,reject)=>{const request=indexedDB.open('bur-collector-v05',1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('posts',{keyPath:'key'});store.createIndex('group','group')};request.onsuccess=()=>{const db=request.result,tx=db.transaction('posts','readwrite');ids.forEach(id=>tx.objectStore('posts').put({key:j.group+'|post:'+id,group:j.group,post_id:id,post_text:'Offline fixture',comments:[]}));tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};request.onerror=()=>reject(request.error)});
 }''')
 assert control.evaluate("async()=>!(await chrome.storage.local.get('burCollectorCheckpoints-v0520'))['burCollectorCheckpoints-v0520']")
 page=c.new_page()
 with page.expect_download() as event:page.goto(base+'/export.html?auto=1')
 downloaded=event.value;data=Path(downloaded.path()).read_bytes();digest=hashlib.sha256(data).hexdigest()
 for _ in range(100):
  receipt=control.evaluate("async()=> (await chrome.storage.local.get('burCollectorExportReceipts-v1'))['burCollectorExportReceipts-v1']")
  if receipt:break
  page.wait_for_timeout(100)
 record=receipt['offline-fixture|download-test|1'];assert record['sha256']==digest,record
 assert record['retained'] and record['import_verified'] is False
 state=control.evaluate('chrome.storage.local.get(null)')
 assert state['burCollectorCheckpoints-v0520']['offline-fixture']['post_id']=='1700000000000012'
 assert state['burCollectorJob-v0520']['batchNumber']==2 and state['burCollectorJob-v0520']['paused']
 assert len(json.loads(data)['posts'])==2
 assert control.evaluate("async()=>{return new Promise((resolve,reject)=>{const req=indexedDB.open('bur-collector-v05',1);req.onsuccess=()=>{const db=req.result,r=db.transaction('posts').objectStore('posts').count();r.onsuccess=()=>{db.close();resolve(r.result)}};req.onerror=()=>reject(req.error)})}")==2
 assert all('facebook.com' not in pg.url for pg in c.pages)
 c.close();c,w,control=launch()
 assert control.evaluate("async()=> (await chrome.storage.local.get('burCollectorExportReceipts-v1'))['burCollectorExportReceipts-v1']['offline-fixture|download-test|1'].sha256")==digest
 c.close()
print('PASS actual Chromium download bytes/hash, atomic job/checkpoint/history/receipt commit, local snapshot retention and browser restart; no Facebook/backend contacted')
