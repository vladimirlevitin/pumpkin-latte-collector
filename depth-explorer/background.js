'use strict';
const KEY='depthExplorerState1';let chain=Promise.resolve();
const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
function openDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open('fb-depth-diagnostics-v1',1);q.onupgradeneeded=()=>{const t=q.result.createObjectStore('events',{keyPath:'id',autoIncrement:true});t.createIndex('run','run');};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function append(run,kind,data={}){const db=await openDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite');tx.objectStore('events').add({run,time:new Date().toISOString(),kind,data});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
async function journal(run,before=Number.MAX_SAFE_INTEGER){const db=await openDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('events'),store=tx.objectStore('events'),q=store.openCursor(IDBKeyRange.upperBound(before,true),'prev'),out=[];q.onsuccess=()=>{const c=q.result;if(!c||out.length>=300){resolve(out.reverse());return;}if(c.value.run===run)out.push(c.value);c.continue();};q.onerror=()=>reject(q.error);});}finally{db.close();}}
const get=async()=> (await chrome.storage.local.get(KEY))[KEY]||null;
const save=s=>chrome.storage.local.set({[KEY]:s});
function identity(url){try{const u=new URL(url);if(u.origin!=='https://www.facebook.com')return null;const m=u.pathname.match(/^\/groups\/([^/]+)(?:\/(?:posts|permalink)\/(\d+))?\/?$/);return m?{group:decodeURIComponent(m[1]),post:m[2]||null,url:u.origin+u.pathname}:null;}catch{return null;}}
const canonical=(g,id)=>'https://www.facebook.com/groups/'+encodeURIComponent(g)+'/posts/'+id+'/';
const isPanel=sender=>sender.url?.startsWith(chrome.runtime.getURL('panel.html'));
function role(s,sender){return sender.tab?.id===s?.feedTab?'feed':sender.tab?.id===s?.deepTab?'deep':null;}
async function log(s,kind,data={}){await append(s.id,kind,{phase:s.phase,current:s.current||null,checked:s.checked||0,feedSteps:s.feedSteps||0,elapsedMs:Date.now()-s.started,attempt:s.attempt||1,...data});}
async function halt(s,reason,kind='paused'){if(!s)return;s.running=false;s.reason=reason;s.lastSignal=kind;s.pausedAt=Date.now();await log(s,kind,{reason});await save(s);}
async function ensureProbe(tabId){
 const ping=async()=>{try{const r=await chrome.tabs.sendMessage(tabId,{type:'ping'});return r?.ready&&r.version==='0.1.1';}catch{return false;}};
 if(await ping())return 'already_connected';
 await chrome.scripting.executeScript({target:{tabId},files:['dom.js','probe.js']});
 if(!await ping())throw Error('Нет связи со вкладкой Facebook. Проверьте разрешение расширения на этом сайте и обновите вкладку.');
 return 'connected_existing_tab';
}
async function openPost(s,id,reload=false){
 s.current=id;s.phase='detail';s.token=crypto.randomUUID();s.actions=0;s.postStarted=Date.now();s.navStarted=Date.now();s.lastBeat=Date.now();s.reason='Открывается пост';await save(s);
 const url=canonical(s.group,id);await log(s,'navigation_intent',{url,method:reload?'reload':'tabs.update direct permalink'});
 if(!s.deepTab){const tab=await chrome.tabs.create({url:'about:blank',active:true});s.deepTab=tab.id;await save(s);await log(s,'detail_tab_created');await chrome.tabs.update(s.deepTab,{url});}
 else if(reload)await chrome.tabs.reload(s.deepTab);else await chrome.tabs.update(s.deepTab,{url,active:true});
}
async function handle(m,sender){
 let s=await get();
 if(isPanel(sender)){
  if(m.type==='state')return s;
  if(m.type==='journal')return journal(m.run,m.before);
  if(m.type==='runs')return (await chrome.storage.local.get('depthExplorerRuns1')).depthExplorerRuns1||[];
  if(m.type==='start'){
   if(s?.running)throw Error('Сначала поставьте текущий прогон на паузу.');
   const tab=await chrome.tabs.get(Number(m.tab)),i=identity(tab.url);if(!i)throw Error('Откройте группу или прямую ссылку на пост Facebook.');
   if(m.mode==='single'&&!i.post)throw Error('Для одиночной проверки откройте прямую ссылку на пост.');
   if(m.mode!=='single'&&i.post)throw Error('Для прохода вглубь выберите вкладку с лентой группы.');
   const connection=await ensureProbe(tab.id);
   const n=(x,min,max,defaultValue)=>Math.max(min,Math.min(max,Number(x)||defaultValue));
   s={id:crypto.randomUUID(),group:i.group,mode:m.mode==='single'?'single':'walk',started:Date.now(),running:true,phase:m.mode==='single'?'detail':'seek',
    feedTab:m.mode==='single'?null:tab.id,deepTab:m.mode==='single'?tab.id:null,current:null,queue:[],seen:[],checked:0,feedSteps:0,attempt:1,reason:'Проверка запущена',lastBeat:Date.now(),
    config:{delay:n(m.delay,1,60,3)*1000,posts:n(m.posts,1,1000,30),clicks:n(m.clicks,1,10000,1500),minutes:n(m.minutes,1,120,20)}};
   await log(s,'run_start',{group:s.group,mode:s.mode,config:s.config,feedStart:'current position; no rewind',navigation:'direct permalink, separate feed/detail tabs as in Bur'});
   await log(s,'probe_connected',{connection,tabRole:i.post?'deep':'feed'});
   const runs=(await chrome.storage.local.get('depthExplorerRuns1')).depthExplorerRuns1||[];runs.unshift({id:s.id,group:s.group,started:s.started,config:s.config});await chrome.storage.local.set({depthExplorerRuns1:runs});await save(s);
   if(i.post)await openPost(s,i.post,true);return s;
  }
  if(m.type==='pause'){await halt(s,'Пауза пользователя');return s;}
  if(m.type==='resume'){
   if(!s||s.running||s.phase==='done')throw Error('Нет приостановленного прогона.');
   if(s.lastSignal==='fault')throw Error('После ошибки используйте «Проверить тот же пост заново»: это сохранит разделение попыток.');
   const connection=await ensureProbe(s.phase==='detail'?s.deepTab:s.feedTab);
   await log(s,'probe_connected',{connection,resume:true});
   s.running=true;s.reason='Продолжение';s.lastBeat=Date.now();await log(s,'resume',{pauseMs:Date.now()-s.pausedAt});await save(s);return s;
  }
  if(m.type==='retry'){
   if(!s||s.running||!s.current)throw Error('Сначала остановите проверку на нужном посте.');
   const tab=await chrome.tabs.get(s.deepTab);const current=identity(tab.url);
   if(!current||current.group!==s.group||current.post!==s.current)throw Error('Вкладка перемещена. Откройте нужный пост и начните одиночный прогон.');
   s.running=true;s.attempt++;s.reason='Повторная проверка';await log(s,'retry',{pauseMs:Date.now()-s.pausedAt});await openPost(s,s.current,true);return s;
  }
 }
 const r=role(s,sender);if(!r)return null;
 if(m.type==='permission'){
  if(!s.running)return {allowed:false};
  const i=identity(sender.url||sender.tab?.url);if(!i||i.group!==s.group||(r==='deep'&&i.post!==s.current)){await log(s,'address_mismatch',{role:r,observed:i});await halt(s,'Вкладка перешла на другой адрес: проверка остановлена.');return {allowed:false};}
  const allowed=r==='feed'?s.phase==='seek':s.phase==='detail';
  if(allowed){s.lastBeat=Date.now();await save(s);}
  return {allowed,role:r,phase:s.phase,current:s.current,token:s.token,config:s.config,actions:s.actions||0,postStarted:s.postStarted};
 }
 if(m.type==='event'){await log(s,m.kind,{role:r,observedPage:m.page||null,...m.data});return true;}
 if(!s.running)return false;
 if(r==='deep'&&['intent','finished','fault'].includes(m.type)&&m.page?.post!==s.current){await log(s,'stale_message_ignored',{kind:m.type,observed:m.page||null});return false;}
 if(m.type==='fault'){
  await log(s,'error_screen',{role:r,error:m.error,snapshot:m.snapshot,lastAction:s.lastAction||null,sinceActionMs:s.lastAction?Date.now()-s.lastAction.at:null,sinceNavigationMs:s.navStarted?Date.now()-s.navStarted:null});
  await halt(s,'Facebook: '+m.error.label,'fault');return true;
 }
 if(m.type==='halt'){await halt(s,m.reason);return true;}
 if(r==='feed'&&s.phase==='seek'&&m.type==='feed'){
  s.feedSteps++;const incoming=(m.links||[]).filter(x=>/^\d+$/.test(x.id)&&!s.seen.includes(x.id)&&!s.queue.includes(x.id));s.queue.push(...incoming.map(x=>x.id));
  await log(s,'feed_scan',{newPostIds:incoming.map(x=>x.id),queue:s.queue.length,snapshot:m.snapshot});await save(s);
  if(s.queue.length)await openPost(s,s.queue.shift());return true;
 }
 if(r==='deep'&&s.phase==='detail'){
  if(m.type==='intent'){s.actions++;s.lastAction={action:m.action,label:m.label||null,at:Date.now()};await log(s,'action_intent',{number:s.actions,...m});await save(s);return true;}
  if(m.type==='finished'){
   await log(s,'post_observation_end',{reason:m.reason,snapshot:m.snapshot,actions:s.actions,durationMs:Date.now()-s.postStarted,completeness:'not_tested'});
   s.checked++;s.seen.push(s.current);
   if(s.mode==='single'||s.checked>=s.config.posts){s.phase='done';await halt(s,'Прогон закончен. Полнота данных не оценивалась.','done');}
   else if(s.queue.length)await openPost(s,s.queue.shift());
   else{s.phase='seek';s.reason='Продолжение движения по группе';s.lastBeat=Date.now();await save(s);await chrome.tabs.update(s.feedTab,{active:true});}
   return true;
  }
 }
 return false;
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{serial(()=>handle(m,sender)).then(result=>reply({ok:true,result})).catch(async e=>{
 try{const s=await get();if(s?.running){s.running=false;s.reason='Ошибка записи/управления: '+e.name;await save(s);}}catch{}
 reply({ok:false,error:String(e.message||e)});
});return true;});
chrome.action.onClicked.addListener(tab=>{void chrome.tabs.create({url:chrome.runtime.getURL('panel.html')+'?tab='+tab.id});});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(!change.status&&!change.url&&!change.discarded)return;void serial(async()=>{const s=await get();if(!s||![s.feedTab,s.deepTab].includes(id))return;await log(s,'tab_update',{role:id===s.deepTab?'deep':'feed',status:change.status||null,identity:identity(tab.url),discarded:tab.discarded||false});if(s.running&&change.status==='complete')s.lastBeat=Date.now();await save(s);});});
chrome.tabs.onRemoved.addListener(id=>{void serial(async()=>{const s=await get();if(s?.running&&[s.feedTab,s.deepTab].includes(id))await halt(s,'Проверяемая вкладка закрыта.','tab_closed');});});
chrome.runtime.onStartup.addListener(()=>{void serial(async()=>{const s=await get();if(s?.running)await halt(s,'Chrome был перезапущен. Продолжение — вручную.','browser_restart');});});
chrome.alarms.create('depth-health',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(a=>{if(a.name!=='depth-health')return;void serial(async()=>{const s=await get();if(s?.running&&Date.now()-s.lastBeat>Math.max(120000,s.config.delay*3))await halt(s,'Нет ответа вкладки более двух минут. Проверьте загрузку, сон Chrome или соединение.','heartbeat_lost');});});
function net(category,d){void serial(async()=>{const s=await get();if(!s||![s.feedTab,s.deepTab].includes(d.tabId))return;let endpoint='other';try{const p=new URL(d.url).pathname;endpoint=/graphql/i.test(p)?'graphql':/ajax/i.test(p)?'ajax':identity(d.url)?'group_page':/login|checkpoint/i.test(p)?'authentication':'other';}catch{}
 await log(s,category,{role:d.tabId===s.deepTab?'deep':'feed',requestId:d.requestId,type:d.type,endpoint,status:d.statusCode||null,error:d.error||null,fromCache:d.fromCache||false,requestTime:d.timeStamp});
 });}
const filter={urls:['https://www.facebook.com/*'],types:['main_frame','sub_frame','xmlhttprequest']};
chrome.webRequest.onCompleted.addListener(d=>net('network_complete',d),filter);
chrome.webRequest.onBeforeRequest.addListener(d=>net('network_start',d),filter);
chrome.webRequest.onErrorOccurred.addListener(d=>net('network_error',d),filter);
chrome.webRequest.onBeforeRedirect.addListener(d=>net('network_redirect',d),filter);
