'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),posts=new Map(),storage={},tab={id:5,url:'https://www.facebook.com/groups/backpackIL/',active:true};
const otherTab={id:6,url:'https://www.facebook.com/groups/pumpkinlatte/',active:true};
let sendListener,alarmListener,tabUpdatedListener,injections=0,connected=false,modalOpen=false,expectedModal=false,requests=0;
function request(tx,run){const r={};tx.pending++;setImmediate(()=>{try{r.result=run();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();tx.onerror?.();}finally{tx.pending--;tx.completed();}});return r;}
class TX {constructor(){this.pending=0;this.complete=false;}completed(){if(!this.pending&&!this.complete){setImmediate(()=>{if(!this.pending&&!this.complete){this.complete=true;this.oncomplete?.();}});}} objectStore(){return {get:key=>request(this,()=>posts.get(key)),put:obj=>request(this,()=>posts.set(obj.key,structuredClone(obj))),delete:key=>request(this,()=>posts.delete(key)),index:()=>({getAll:range=>request(this,()=>[...posts.values()].filter(p=>p.group===range.group)),openKeyCursor:range=>{let keys=[...posts.values()].filter(p=>p.group===range.group).map(p=>p.key),ix=0;const r={};const advance=()=>{if(ix>=keys.length){r.result=null;r.onsuccess?.();return;}r.result={primaryKey:keys[ix++],continue:()=>setImmediate(advance)};r.onsuccess?.();};this.pending++;setImmediate(()=>{advance();this.pending--;this.completed();});return r;}})};}}
class DB{constructor(){this.objectStoreNames={contains:()=>true};}transaction(){return new TX();}close(){}createObjectStore(){return{createIndex(){}};}}
const indexedDB={open:()=>{const r={result:new DB()};setImmediate(()=>{r.onupgradeneeded?.();r.onsuccess?.();});return r;}},IDBKeyRange={only:group=>({group})};
const chrome={runtime:{onMessage:{addListener:cb=>sendListener=cb},onInstalled:{addListener(){}},getURL:s=>'chrome-extension://test/'+s},storage:{local:{get:async k=>({[k]:storage[k]}),set:async o=>Object.assign(storage,o)}},tabs:{get:async id=>{assert.ok([5,6].includes(id));return id===5?tab:otherTab;},update:async(id,data)=>{assert.ok([5,6].includes(id));const target=id===5?tab:otherTab;Object.assign(target,data);return target;},sendMessage:async(id,msg)=>{assert.ok([5,6].includes(id));if(!connected)throw Error('no receiver');if(msg.type==='burPing')return {ready:true,version:'0.5.5-alpha',obstruction:modalOpen?{kind:'facebook_dialog'}:null,detailPost:expectedModal};return {ready:true};},create:async()=>{},onUpdated:{addListener:cb=>tabUpdatedListener=cb}},scripting:{executeScript:async()=>{injections++;connected=true;}},alarms:{create(){},onAlarm:{addListener:cb=>alarmListener=cb}}};
function spawn(){const context={chrome,indexedDB,IDBKeyRange,URL,console,setTimeout,clearTimeout,Date,structuredClone,fetch:()=>{requests++;throw Error('MUST NOT call model or API')}};context.globalThis=context;const ctx=vm.createContext(context);context.importScripts=(...files)=>{for(const f of files)vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});};vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx,{filename:'background.js'});}
function call(type,msg={},sender=['start','resume','pause','collectFound','status','exportSlice'].includes(type)?{}:{tab:{...tab}}){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Timed out: '+type)),8000);sendListener({type,...msg},sender,r=>{clearTimeout(timeout);r.ok?resolve(r.result):reject(Error(r.error));});});}
function makePost(i){const id=String(1700000000000000+i);return {group:'backpackIL',post_id:id,permalink:'https://www.facebook.com/groups/backpackIL/posts/'+id+'/',post_text:'Публикация '+i+' про котов, рекламу, маршрут или что угодно',post_text_quality:'body_selector',comments:[]};}

// Run the shipped export page against the real background message listener,
// including MessageSender.tab (extension pages opened in tabs have it too).
async function exportSaved(expected){
 const snapshot=JSON.stringify({storage,posts:[...posts]});
 const tabMethods={get:chrome.tabs.get,update:chrome.tabs.update,sendMessage:chrome.tabs.sendMessage,create:chrome.tabs.create};
 for(const key of Object.keys(tabMethods))chrome.tabs[key]=async()=>{throw Error('Export must not access Facebook tabs: '+key);};
 spawn(); // extension update / worker restart: retain the old DB and job key
 const sender={url:chrome.runtime.getURL('export.html'),tab:{id:77,url:chrome.runtime.getURL('export.html')}};
 const envelope=await new Promise(resolve=>sendListener({type:'exportSlice',offset:0,limit:50},sender,resolve));
 assert.equal(envelope.ok,true);

 let text='',downloaded=null,finish;
 const done=new Promise(resolve=>finish=resolve);
 const status={get textContent(){return text},set textContent(v){text=v;if(v.startsWith('Ошибка:'))finish();}};
 const button={};
 const ExportURL={createObjectURL:blob=>{downloaded=blob;return 'blob:test'},revokeObjectURL(){}};
 const ctx=vm.createContext({chrome:{runtime:{getManifest:()=>({version_name:'0.5.5-alpha'}),sendMessage:msg=>new Promise(resolve=>sendListener(msg,sender,resolve))}},document:{getElementById:id=>id==='status'?status:button,body:{appendChild(){}},createElement:()=>({click:()=>finish(),remove(){}})},URL:ExportURL,Blob,setTimeout:()=>0,Date,console});
 vm.runInContext(fs.readFileSync(path.join(root,'export.js'),'utf8'),ctx);
 let timeout;await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Export timeout: '+text)),8000)})]).finally(()=>clearTimeout(timeout));
 assert.ok(downloaded,'export failed: '+text);
 const data=JSON.parse(await downloaded.text());
 assert.equal(data.posts.length,expected);
 assert.equal(data.collector_version,'0.5.5-alpha');
 assert.deepEqual(data.posts,JSON.parse(JSON.stringify([...posts.values()].filter(p=>p.group===data.group).sort((a,b)=>a.key.localeCompare(b.key)))));
 assert.deepEqual(data.posts.map(p=>p.key),[...posts.values()].filter(p=>p.group===data.group).map(p=>p.key).sort());
 assert.equal(JSON.stringify({storage,posts:[...posts]}),snapshot,'export must not mutate saved archive/job');
 const foreign=await call('exportSlice',{}, {url:tab.url,tab:{...tab,id:77}});
 assert.equal(foreign.ignored,true,'Facebook tab must not gain export bypass');
 const spoof=await call('exportSlice',{}, {url:chrome.runtime.getURL('export.html')+'.evil',tab:{id:77}});
 assert.equal(spoof.ignored,true,'only exact export page gets bypass');
 Object.assign(chrome.tabs,tabMethods);
 console.log('PASS: saved '+expected+'-post archive exported through background + export.js after worker restart, without Facebook navigation');
}

(async()=>{
 spawn();let j=await call('start',{tabId:5,url:tab.url,options:{maxPosts:5,maxSteps:100}});assert.equal(j.stage,'discover');assert.equal(injections,1);

 // Two open groups: popup controls must never transfer ownership to pumpkinlatte.
 const owner=structuredClone(await call('status'));
 await assert.rejects(call('resume',{tabId:6,url:otherTab.url}),/исходной вкладке/);
 await assert.rejects(call('collectFound',{tabId:6,url:otherTab.url}),/backpackIL/);
 assert.equal(JSON.stringify(await call('status')),JSON.stringify(owner));
 assert.equal(await call('status',{}, {tab:otherTab}),null);
 assert.equal(await call('status',{}, {tab:{...otherTab,url:tab.url}}),null,'same group in another tab must not run');
 const foreign=await call('discover',{posts:[{...makePost(99),group:'pumpkinlatte'}],step:1},{tab:otherTab});
 assert.equal(foreign.ignored,true);
 await call('endDiscovery',{}, {tab:otherTab});
 await call('obstructed',{}, {tab:{...tab,url:otherTab.url}});
 assert.equal(JSON.stringify(await call('status')),JSON.stringify(owner));
 tabUpdatedListener(6,{status:'complete'},otherTab);
 await new Promise(r=>setTimeout(r,400));
 assert.equal(otherTab.url,'https://www.facebook.com/groups/pumpkinlatte/');
 // Restart retains the original binding even while the other group is active.
 spawn();assert.equal((await call('status')).tabId,5);
 await assert.rejects(call('resume',{tabId:6,url:otherTab.url}),/исходной вкладке/);
 // A discovery popup is recovered automatically by returning to the canonical group feed.
 tab.url='https://www.facebook.com/groups/backpackIL/';await call('obstructed',{stage:'discover',diagnostics:{kind:'facebook_dialog',phase:'feed popup'}});j=await call('status');assert.equal(j.stage,'discover');assert.equal(j.paused,false);assert.equal(tab.url,'https://www.facebook.com/groups/backpackIL/');
 // ALL posts go deep, including unhelpful text. Limit triggers deep without selection or second click.
 const discovered=await call('discover',{posts:Array.from({length:5},(_,i)=>makePost(i)),step:1});assert.equal(discovered.stage,'deep');j=await call('status');assert.equal(j.queue.length,5);assert.equal(j.paused,false);assert.equal(tab.url,'https://www.facebook.com/groups/backpackIL/posts/1700000000000000/');

 const deepOwner=JSON.stringify(await call('status'));
 await call('deepError',{id:j.queue[0],error:'foreign'},{tab:otherTab});
 await call('deepSnapshot',{post:makePost(0)},{tab:{...otherTab,url:tab.url}});
 await assert.rejects(call('resume',{tabId:6,url:otherTab.url}),/исходной вкладке/);
 assert.equal(JSON.stringify(await call('status')),deepOwner);
 // Simulate page modal owned by currently selected post: it must not block resume.
 await call('pause');modalOpen=true;expectedModal=true;j=await call('resume',{tabId:5,url:tab.url});assert.equal(j.stage,'deep');assert.equal(j.paused,false);modalOpen=false;expectedModal=false;
 // Background/inactive tab must NOT pause the collector.
 tab.active=false;await alarmListener({name:'bur-collector-watchdog'});j=await call('status');assert.equal(j.stage,'deep');assert.equal(j.paused,false);tab.active=true;
 // A UI obstruction in one deep post is a per-post failure and the queue advances automatically.
 j=await call('status');assert.equal(j.queue[j.index],makePost(0).post_id);await call('obstructed',{stage:'deep',diagnostics:{kind:'facebook_dialog',phase:'nested photo popup'}});j=await call('status');assert.equal(j.stage,'deep');assert.equal(j.index,1);assert.equal(j.deepErrors,1);
 // Remaining posts continue, including one ordinary inaccessible post.
 for(let i=1;i<5;i++){j=await call('status');assert.equal(j.stage,'deep');assert.equal(j.queue[j.index],makePost(i).post_id);if(i===2)await call('deepError',{id:makePost(i).post_id,error:'Публикация удалена'});else await call('deepSnapshot',{post:{...makePost(i),comments:[{id:'c'+i,text:'Текст комментария '+i,author:'Автор'}]},expanded:2,scrolled:4});}
 j=await call('status');assert.equal(j.stage,'done');assert.equal(j.deepDone,3);assert.equal(j.deepErrors,2);assert.equal(j.queue.length,5);const exported=await call('exportSlice',{offset:0,limit:50});assert.equal(exported.total,5);assert.equal(exported.items.filter(p=>p.deep?.status==='failed').length,2);assert.equal(exported.items.filter(p=>p.deep?.status==='captured_unverified').length,3);
 await exportSaved(5);
 // A new run resets only the current group's local corpus, no migrations/import.
 tab.url='https://www.facebook.com/groups/backpackIL/';await call('start',{tabId:5,url:tab.url,options:{maxPosts:100}});assert.equal((await call('exportSlice',{offset:0,limit:50})).total,0);
 const fixture=process.env.BUR_53_FIXTURE?JSON.parse(fs.readFileSync(process.env.BUR_53_FIXTURE,'utf8')):{posts:Array.from({length:53},(_,i)=>makePost(i+100))};assert.equal(fixture.posts.length,53);
 await call('discover',{posts:fixture.posts,step:1});j=await call('status');assert.equal(j.stage,'discover');assert.equal(j.discovered,53);
 // One button does everything: finish scan, immediately navigate first post. No 'resume' click.
 await call('collectFound',{tabId:5,url:tab.url});j=await call('status');assert.equal(j.stage,'deep');assert.equal(j.paused,false);assert.equal(j.queue.length,53);assert.equal(tab.url,'https://www.facebook.com/groups/backpackIL/posts/'+j.queue[0]+'/');
 // Restart worker retains queue position (in chrome.storage.local).
 spawn();assert.equal((await call('status')).queue.length,53);
 await call('deepSnapshot',{post:fixture.posts.find(p=>p.post_id===j.queue[0])});j=await call('status');assert.equal(j.index,1);
 // LIVE REGRESSION: Facebook may asynchronously redirect an active deep tab to home.
 // The collector must reclaim the tab without a manual pause/resume click.
 const liveRedirectId=j.queue[j.index];tab.url='https://www.facebook.com/';tabUpdatedListener(5,{status:'complete'},{...tab});
 await new Promise(r=>setTimeout(r,500));j=await call('status');
 assert.equal(tab.url,'https://www.facebook.com/groups/backpackIL/posts/'+liveRedirectId+'/', 'active deep redirect must be auto-recovered');
 assert.equal(j.stage,'deep');assert.equal(j.paused,false);assert.equal(j.queue[j.index],liveRedirectId);
 // Repeated live redirects must not loop forever. After bounded auto-recovery, only
 // that post is failed and the queue advances autonomously.
 const errorsBeforeRedirectLoop=j.deepErrors;
 for(let k=0;k<4;k++){tab.url='https://www.facebook.com/';tabUpdatedListener(5,{status:'complete'},{...tab});await new Promise(r=>setTimeout(r,500));}
 j=await call('status');assert.equal(j.stage,'deep');assert.equal(j.paused,false);assert.equal(j.deepErrors,errorsBeforeRedirectLoop+1);assert.notEqual(j.queue[j.index],liveRedirectId);
 // Simulate pause during deep, Facebook redirecting away, then resume. Collector must
 // reclaim its service tab and return to the expected post without asking the user.
 await call('pause');const was=j.queue[j.index];tab.url='https://www.facebook.com/backpackIL';await call('resume',{tabId:5,url:tab.url});j=await call('status');assert.equal(j.queue[j.index],was);assert.equal(tab.url,'https://www.facebook.com/groups/backpackIL/posts/'+was+'/');assert.equal(j.paused,false);
 // Post randomly unavailable: skip, then continue.
 const beforeManualSkip=j.index;await call('deepError',{id:was,error:'Недоступен'});j=await call('status');assert.equal(j.index,beforeManualSkip+1);
 // Stress the rest of the 53-post queue with deterministic mixed failures.
 // No ordinary post-level condition may leave the job stalled.
 const byId=new Map(fixture.posts.map(p=>[String(p.post_id),p]));
 while((j=await call('status')).stage==='deep'){
  const ix=j.index,id=j.queue[ix];
  if(ix%9===0)await call('obstructed',{stage:'deep',diagnostics:{kind:'facebook_dialog',phase:'stress popup'}});
  else if(ix%13===0)await call('deepError',{id,error:'stress unavailable'});
  else await call('deepSnapshot',{post:byId.get(String(id))||{...makePost(100+ix),post_id:id,permalink:'https://www.facebook.com/groups/backpackIL/posts/'+id+'/'},expanded:1,scrolled:1});
 }
 j=await call('status');assert.equal(j.stage,'done');assert.equal(j.deepDone+j.deepErrors,53);assert.equal(j.paused,false);
 await exportSaved(53);
 assert.equal(requests,0);console.log('PASS: resilient queue: inactive tab; per-post popup/deletion failures; redirect recovery; restart; 53-post mixed-failure stress reaches done');
})().catch(e=>{console.error(e);process.exitCode=1});

