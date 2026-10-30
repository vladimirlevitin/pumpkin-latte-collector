from pathlib import Path
import json,shutil,tempfile,time
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
 extension=Path(tmp)/'extension';profile=Path(tmp)/'profile'
 shutil.copytree(root,extension)
 c=p.chromium.launch_persistent_context(str(profile),channel='chromium',headless=True,accept_downloads=True,args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
 w=c.service_workers[0] if c.service_workers else c.wait_for_event('serviceworker')
 extension_url=w.url.rsplit('/',1)[0]
 control=c.new_page();control.goto(extension_url+'/popup.html')
 seeded=control.evaluate('''async()=>{
  const job={id:'saved-session',sessionId:'saved-session',group:'backpackIL',feedTabId:999,stage:'exporting',paused:true,batchNumber:3,completedBatches:2,sessionPosts:100,options:{maxPosts:53},discovered:53,steps:42,queue:Array.from({length:53},(_,i)=>String(i)),discoveryOrder:Array.from({length:53},(_,i)=>String(i)),deepDone:53,deepErrors:0,lastCollectedPostId:'52',checkpointPostId:'before'};
  await chrome.storage.local.set({'burCollectorJob-v0520':job});
  const rows=Array.from({length:53},(_,i)=>({key:'backpackIL|post:'+String(i).padStart(3,'0'),group:'backpackIL',post_id:String(i),post_text:'saved '+i,comments:[{id:'c'+i,author:'Author',text:'Comment'}],deep:{status:'captured_unverified'}}));
  await new Promise((resolve,reject)=>{const req=indexedDB.open('bur-collector-v05',1);req.onupgradeneeded=()=>{const s=req.result.createObjectStore('posts',{keyPath:'key'});s.createIndex('group','group');};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('posts','readwrite');rows.forEach(row=>tx.objectStore('posts').put(row));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  return {job,rows};
 }''')
 page=c.new_page()
 with page.expect_download() as event:
  page.goto(extension_url+'/export.html?manual=1')
 data=json.loads(Path(event.value.path()).read_text(encoding='utf-8'))
 assert len(data['posts'])==len(seeded['rows'])
 for actual,original in zip(data['posts'],seeded['rows']):
  for key,value in original.items():
   if key!='comments':assert actual[key]==value
  for comment,old in zip(actual['comments'],original['comments']):
   for key,value in old.items():assert comment[key]==value
   assert comment['author_key'] and comment['post_key']==actual['key']
 assert len(data['authors'])==53
 assert all(a['identity_quality']=='display_name_only' for a in data['authors'])
 assert data['collector_version']=='0.5.28-alpha'
 assert data['job_summary']['session_id']=='saved-session'
 assert data['job_summary']['batch_number']==3
 assert data['job_summary']['id']=='saved-session-b0003'
 response=page.evaluate("chrome.runtime.sendMessage({type:'exportSlice',offset:50,limit:100})")
 assert response['ok'] and response['result']['total']==53 and len(response['result']['items'])==3
 assert all('facebook.com' not in pg.url for pg in c.pages)
 print('PASS: real extension exports current continuous-session batch from IndexedDB without touching Facebook tabs')
 c.close()
