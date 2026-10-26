from pathlib import Path
import json,shutil,tempfile
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
 extension=Path(tmp)/'extension';profile=Path(tmp)/'profile'
 shutil.copytree(root,extension)
 manifest=(extension/'manifest.json').read_text(encoding='utf-8')
 (extension/'manifest.json').write_text(manifest.replace('0.5.10','0.5.3'),encoding='utf-8')
 current=(extension/'background.js').read_text(encoding='utf-8')
 gate="if(sender.tab&&!(msg.type==='exportSlice'&&sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('export.html')))"
 assert gate in current
 (extension/'background.js').write_text(current.replace(gate,'if(sender.tab)'),encoding='utf-8')
 export=(extension/'export.js').read_text(encoding='utf-8')
 begin=export.index("if(!r||!Array.isArray(r.items)")
 end=export.index('job=r.job;',begin)
 (extension/'export.js').write_text(export[:begin]+export[end:],encoding='utf-8')
 def launch():
  c=p.chromium.launch_persistent_context(str(profile),channel='chromium',headless=True,accept_downloads=True,args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
  w=c.service_workers[0] if c.service_workers else c.wait_for_event('serviceworker')
  return c,w
 print('launch legacy',flush=True)
 c,w=launch();extension_url=w.url.rsplit('/',1)[0]
 print('seed legacy',flush=True)
 seeded=w.evaluate('''async()=>{
  const job={id:'old-saved',group:'backpackIL',tabId:999,stage:'done',options:{maxPosts:53},queue:Array.from({length:53},(_,i)=>String(i)),deepDone:53,deepErrors:0};
  await chrome.storage.local.set({'burCollectorJob-v05':job});
  const rows=Array.from({length:53},(_,i)=>({key:'backpackIL|post:'+String(i).padStart(3,'0'),group:'backpackIL',post_id:String(i),post_text:'old saved '+i,comments:[{id:'c'+i,parent_id:'parent',author:'Saved author',text:'Saved comment'}],deep:{status:'captured_unverified'}}));
  await new Promise((resolve,reject)=>{const req=indexedDB.open('bur-collector-v05',1);req.onupgradeneeded=()=>{const s=req.result.createObjectStore('posts',{keyPath:'key'});s.createIndex('group','group');};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('posts','readwrite');rows.forEach(row=>tx.objectStore('posts').put(row));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  return {job,rows};
 }''')
 print('open legacy export',flush=True)
 page=c.new_page();page.goto(extension_url+'/export.html')
 expect(page.locator('#status')).to_contain_text('r.items is not iterable')
 assert 'r.items is not iterable' in page.locator('#status').inner_text()
 response=page.evaluate("chrome.runtime.sendMessage({type:'exportSlice',offset:0,limit:50})")
 assert response=={'ok':True,'result':{'ignored':True}},response
 print('legacy crash confirmed',flush=True)
 c.close()
 # Independent fixed installation seeded with the same legacy saved-data shape.
 # Worker-restart preservation is covered separately in test-worker.js.
 (extension/'background.js').write_text(current,encoding='utf-8')
 (extension/'export.js').write_text(export,encoding='utf-8')
 (extension/'manifest.json').write_text(manifest,encoding='utf-8')
 profile=Path(tmp)/'profile-fixed'
 c,w=launch()
 assert w.url.rsplit('/',1)[0]==extension_url
 seeded=w.evaluate('''async()=>{
  const job={id:'old-saved',group:'backpackIL',tabId:999,stage:'done',options:{maxPosts:53},queue:Array.from({length:53},(_,i)=>String(i)),deepDone:53,deepErrors:0};
  await chrome.storage.local.set({'burCollectorJob-v05':job});
  const rows=Array.from({length:53},(_,i)=>({key:'backpackIL|post:'+String(i).padStart(3,'0'),group:'backpackIL',post_id:String(i),post_text:'old saved '+i,comments:[{id:'c'+i,parent_id:'parent',author:'Saved author',text:'Saved comment'}],deep:{status:'captured_unverified'}}));
  await new Promise((resolve,reject)=>{const req=indexedDB.open('bur-collector-v05',1);req.onupgradeneeded=()=>{const s=req.result.createObjectStore('posts',{keyPath:'key'});s.createIndex('group','group');};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('posts','readwrite');rows.forEach(row=>tx.objectStore('posts').put(row));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  return {job,rows};
 }''')
 print('open legacy export',flush=True)
 page=c.new_page()
 with page.expect_download() as event:page.goto(extension_url+'/export.html')
 data=json.loads(Path(event.value.path()).read_text(encoding='utf-8'))
 assert data['posts']==seeded['rows'] and data['job_summary']['id']=='old-saved'
 response=page.evaluate("chrome.runtime.sendMessage({type:'exportSlice',offset:50,limit:50})")
 assert response['ok'] and response['result']['total']==53 and len(response['result']['items'])==3
 assert response['result']['job']==seeded['job']
 assert all('facebook.com' not in page.url for page in c.pages)
 print('PASS: real Chromium extension message API: legacy {ignored:true} + exact crash; fixed installation exports 53 legacy-schema saved posts from IndexedDB/storage without Facebook')
 c.close()

