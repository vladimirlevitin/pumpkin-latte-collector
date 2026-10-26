/* FB Bur collector-only 0.5.9-alpha. Resilient autonomous queue; no ranking, AI, or import. */
importScripts('core.js');
const C=globalThis.FBBurCore;
const DB='bur-collector-v05', DBVER=1,JOB_KEY='burCollectorJob-v05',ALARM='bur-collector-watchdog';
const VERSION='0.5.9-alpha',now=()=>Date.now();
const DEFAULTS={maxPosts:100,maxSteps:900};
function groupOf(url){try{const u=new URL(url);if(!['www.facebook.com','web.facebook.com'].includes(u.hostname))return null;return decodeURIComponent(u.pathname.match(/^\/groups\/([^/]+)/)?.[1]||'')||null;}catch{return null;}}
function postIdOf(url,group){return C.idFromPermalink(url,group);}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,DBVER);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('posts')){const s=db.createObjectStore('posts',{keyPath:'key'});s.createIndex('group','group');}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function getOne(key){return new Promise(async(resolve,reject)=>{try{const db=await openDB(),tx=db.transaction('posts','readonly'),r=tx.objectStore('posts').get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();}catch(e){reject(e);}});}
function allPosts(group){return new Promise(async(resolve,reject)=>{try{const db=await openDB(),tx=db.transaction('posts','readonly'),r=tx.objectStore('posts').index('group').getAll(IDBKeyRange.only(group));r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();}catch(e){reject(e);}});}
async function clearGroup(group){const db=await openDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('posts','readwrite'),idx=tx.objectStore('posts').index('group');const r=idx.openKeyCursor(IDBKeyRange.only(group));r.onsuccess=()=>{const cur=r.result;if(cur){tx.objectStore('posts').delete(cur.primaryKey);cur.continue();}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
async function putOne(p){const db=await openDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('posts','readwrite');tx.objectStore('posts').put(p);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
async function putMany(rows,group){let added=0,updated=0;const db=await openDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('posts','readwrite'),s=tx.objectStore('posts');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);for(const raw of rows){const row=C.normalizePost(raw,group);if(!row.post_id||row.group!==group)continue;const request=s.get(row.key);request.onsuccess=()=>{const old=request.result;if(old)updated++;else added++;s.put(C.mergePosts(old,row,group));};}});}finally{db.close();}return {added,updated};}
async function getJob(){return (await chrome.storage.local.get(JOB_KEY))[JOB_KEY]||null;}
async function setJob(j){j.updatedAt=now();await chrome.storage.local.set({[JOB_KEY]:j});return j;}
function safeError(e){return String(e?.message||e||'Error').slice(0,240);}
function keyOf(group,id){return group+'|post:'+id;}
async function notifyTab(tabId){try{await chrome.tabs.sendMessage(tabId,{type:'burWake'});}catch(e){console.warn('Bur wake',safeError(e));}}
async function ensureContent(tabId,group){
 const tab=await chrome.tabs.get(tabId);
 if(groupOf(tab.url)!==group)throw Error('Вкладка ещё не открыта в нужной Facebook-группе');
 let r;try{r=await chrome.tabs.sendMessage(tabId,{type:'burPing'});}catch{}
 if(!r?.ready||r.version!==VERSION){try{await chrome.scripting.executeScript({target:{tabId},files:['core.js','feed-scroll.js','content.js']});r=await chrome.tabs.sendMessage(tabId,{type:'burPing'});}catch(e){throw Error('Скрипт не подключился: '+safeError(e)+'. Обновите вкладку Facebook.');}}
 if(!r?.ready||r.version!==VERSION)throw Error('Не удалось подтвердить версию скрипта');
 return r;
}
async function start({tabId,url,options={},replacePaused=false}){const group=groupOf(url);if(!group||!/^\/groups\/[^/]+\/?$/.test(new URL(url).pathname))throw Error('Откройте ленту нужной Facebook-группы');await ensureContent(tabId,group);const existing=await getJob();if(existing&&existing.stage!=='done'&&!(replacePaused&&existing.paused))throw Error('Сбор уже существует: нажмите «Продолжить» либо поставьте его на паузу перед запуском другой группы.');
 const opts={maxPosts:Math.max(5,Math.min(5000,Math.trunc(Number(options.maxPosts)||DEFAULTS.maxPosts))),maxSteps:Math.max(30,Math.min(15000,Math.trunc(Number(options.maxSteps)||DEFAULTS.maxSteps)))};
 // Fresh run starts a fresh local corpus for this group. No import or migrations.
 await clearGroup(group);
 const j={id:now().toString(36),group,tabId,stage:'discover',paused:false,startedAt:now(),lastSeen:now(),steps:0,discovered:0,deepDone:0,deepErrors:0,queue:[],index:0,options:opts,note:'Разведка: сбор ВСЕХ доступных публикаций без оценки содержания'};
 await setJob(j);await notifyTab(tabId);return j;
}
async function pause(){const j=await getJob();if(!j)return null;j.paused=true;j.note='Остановлено пользователем';return setJob(j);}
async function resume(tabId,url){const j=await getJob();if(!j)throw Error('Нет задания');if(j.stage==='done')throw Error('Задание завершено. Запустите новый сбор.');
 if(tabId!==j.tabId)throw Error('Задание привязано к исходной вкладке группы '+j.group+'. Вернитесь в неё.');const currentGroup=groupOf(url);if(currentGroup&&currentGroup!==j.group)throw Error('Задание привязано к группе '+j.group+'. Текущая вкладка открыта в другой группе; переход отменён.');
 await chrome.tabs.get(j.tabId);
 j.paused=false;j.resumeCount=(j.resumeCount||0)+1;
 if(j.stage==='stalled'){j.stage=['discover','deep'].includes(j.stall?.resumeStage)?j.stall.resumeStage:'discover';if(j.stage==='discover'&&j.steps>=j.options.maxSteps)j.options.maxSteps+=200;}
 j.note='Продолжение '+(j.stage==='deep'?'подробного извлечения':'разведки');await setJob(j);
 if(j.stage==='deep')await navigateCurrent(j);
 else {const feed='https://www.facebook.com/groups/'+encodeURIComponent(j.group)+'/';if(groupOf(url)!==j.group||!/^\/groups\/[^/]+\/?$/.test(new URL(url).pathname))await chrome.tabs.update(tabId,{url:feed});else {await ensureContent(tabId,j.group);await notifyTab(tabId);}}
 return j;
}
async function beginDeep(j,reason){if(!j||!['discover','stalled'].includes(j.stage))return j;
 const all=await allPosts(j.group);const order=all.filter(p=>p.post_id).sort((a,b)=>String(a.first_seen||'').localeCompare(String(b.first_seen||''))||String(a.key).localeCompare(String(b.key)));
 j.queue=order.map(p=>p.post_id);j.index=0;j.stage='deep';j.paused=false;j.stall=null;j.note=`Разведка окончена (${reason}). Подробный сбор ВСЕХ ${j.queue.length} публикаций — без отбора.`;
 await setJob(j);if(j.queue.length)await navigateCurrent(j);else await finish(j);return j;
}
async function collectFound(tabId,url){const j=await getJob();if(!j||!(j.stage==='discover'||j.stage==='stalled'&&j.stall?.resumeStage==='discover'))throw Error('Сначала запустите разведку');if(groupOf(url)!==j.group)throw Error('Откройте группу '+j.group);if(tabId!==j.tabId)throw Error('Вернитесь в исходную вкладку группы '+j.group);await ensureContent(j.tabId,j.group);return beginDeep(j,'нажата кнопка «Собрать найденные»');}
async function stall(j,reason,details,resumeStage){j.stage='stalled';j.paused=true;j.stall={at:new Date().toISOString(),reason,details:details||null,resumeStage:resumeStage||j.stage};j.note='Приостановлено: '+reason+'. Не отмечено как успешное завершение.';await setJob(j);return j;}
async function obstructed(msg,sender){
 const j=await getJob();if(!j||j.paused||!['discover','deep'].includes(j.stage)||sender.tab?.id!==j.tabId)return {ignored:true};
 if(j.stage==='deep'){
  const id=j.queue[j.index];
  return failDeep({id,error:'Интерфейс Facebook перекрыл публикацию: '+String(msg.diagnostics?.phase||msg.diagnostics?.kind||'dialog'),details:msg.diagnostics||null},sender);
 }
 j.obstructionRecoveries=(j.obstructionRecoveries||0)+1;
 if(j.obstructionRecoveries>5)return stall(j,'Facebook более 5 раз подряд перекрыл ленту; вероятна проверка входа/доступа',msg.diagnostics,'discover');
 j.note=`Автовосстановление ленты после окна Facebook (${j.obstructionRecoveries}/5)`;j.lastSeen=now();await setJob(j);
 await chrome.tabs.update(j.tabId,{url:'https://www.facebook.com/groups/'+encodeURIComponent(j.group)+'/'});
 return {recovered:true};
}
async function discovered(msg,sender){const j=await getJob();if(!j||j.stage!=='discover'||j.paused||sender.tab?.id!==j.tabId||groupOf(sender.tab?.url)!==j.group)return {ignored:true};const rows=(Array.isArray(msg.posts)?msg.posts:[]).slice(0,150);const r=await putMany(rows,j.group);j.discovered+=r.added;j.steps+=Math.min(1,Number(msg.step)||0);j.lastSeen=now();if(r.added)j.obstructionRecoveries=0;j.note=`Разведка: ${j.discovered} из ${j.options.maxPosts}, проходы ${j.steps}`;
 if(j.discovered>=j.options.maxPosts)await beginDeep(j,'достигнут предел публикаций');
 else if(j.steps>=j.options.maxSteps||msg.exhausted)await stall(j,j.steps>=j.options.maxSteps?'Лимит проходов ленты':'Лента перестала продвигаться',msg.diagnostics,'discover');
 else await setJob(j);
 return {...r,stage:j.stage,discovered:j.discovered};}
async function endDiscovery(msg,sender){const j=await getJob();if(j&&sender.tab?.id===j.tabId&&j.stage==='discover'&&!j.paused)await stall(j,msg.reason||'Нет новых карточек',msg.diagnostics,'discover');return getJob();}
async function navigateCurrent(j){if(j.paused||j.stage!=='deep')return;const id=j.queue[j.index];if(!id){await finish(j);return;}const url=C.canonicalUrl(j.group,id);
 try{const tab=await chrome.tabs.get(j.tabId);if(!tab)throw Error('Вкладка закрыта');if(j.redirectPostId!==id){j.redirectPostId=id;j.redirectRecoveries=0;}const already=postIdOf(tab.url,j.group)===id;j.navStartedAt=now();j.currentId=id;j.deepPhase=already?'READY':'NAVIGATING';j.note=`Сейчас: ${j.index+1}/${j.queue.length}`;await setJob(j);if(!already)await chrome.tabs.update(j.tabId,{url});else {try{await ensureContent(j.tabId,j.group);}catch{}await notifyTab(j.tabId);}}
 catch(e){j.paused=true;j.stage='stalled';j.stall={at:new Date().toISOString(),reason:'collector_tab_missing',resumeStage:'deep',details:safeError(e)};j.note='Служебная вкладка закрыта. Задание приостановлено: исходная вкладка закрыта. Перенос в другую вкладку запрещён.';await setJob(j);}}
async function recoverDeepRedirect(j,tabUrl){
 if(!j||j.paused||j.stage!=='deep')return false;const id=j.queue[j.index];if(!id)return false;
 if(postIdOf(tabUrl,j.group)===id){j.deepPhase='READY';j.navReadyAt=now();if(j.redirectPostId===id&&j.redirectRecoveries)j.redirectRecoveries=0;await setJob(j);return false;}
 if(j.redirectPostId!==id){j.redirectPostId=id;j.redirectRecoveries=0;}j.redirectRecoveries=(j.redirectRecoveries||0)+1;
 if(j.redirectRecoveries<=3){const url=C.canonicalUrl(j.group,id);j.deepPhase='NAVIGATING';j.navStartedAt=now();j.note=`Сейчас: ${j.index+1}/${j.queue.length}. Facebook сменил страницу — автовозврат ${j.redirectRecoveries}/3`;await setJob(j);await chrome.tabs.update(j.tabId,{url});return true;}
 j.redirectRecoveries=0;return failDeep({id,error:'Facebook 4 раза подряд перенаправил служебную вкладку с выбранной публикации'}, {tab:{id:j.tabId}});
}
async function deepState(msg,sender,phase){
 const j=await getJob();if(!j||j.stage!=='deep'||j.paused||sender.tab?.id!==j.tabId)return {ignored:true};
 const id=j.queue[j.index];if(String(msg.id)!==String(id)||postIdOf(sender.tab?.url,j.group)!==id)return {ignored:true};
 j.deepPhase=phase;j.lastDeepProgressAt=now();if(phase==='READY')j.navReadyAt=now();await setJob(j);return j;
}
async function deepMismatch(msg,sender){
 const j=await getJob();if(!j||j.stage!=='deep'||j.paused||sender.tab?.id!==j.tabId)return {ignored:true};
 const id=j.queue[j.index];if(String(msg.id)!==String(id))return {ignored:true};
 if(j.deepPhase==='NAVIGATING')return {waiting:true,expected:id,actual:msg.actual||null};
 return recoverDeepRedirect(j,sender.tab?.url||'');
}
async function completeDeep(msg,sender){const j=await getJob();if(!j||j.stage!=='deep'||j.paused||sender.tab?.id!==j.tabId)return {ignored:true};const id=j.queue[j.index];if(String(msg.post?.post_id||'')!==String(id)||postIdOf(sender.tab?.url,j.group)!==id)return {ignored:true};
 const row=C.normalizePost(msg.post,j.group);if(row.group!==j.group)throw Error('Чужая группа');await putMany([row],j.group);const merged=await getOne(row.key);merged.deep={status:'captured_unverified',at:new Date().toISOString(),visible_comment_count:merged.comments?.length||0,completeness:'unknown_not_all_threads_verified',scrolled:Number(msg.scrolled)||0,expanded:Number(msg.expanded)||0,fallback:msg.fallback||null};await putOne(merged);j.index++;j.deepDone++;j.lastSeen=now();await setJob(j);if(j.index>=j.queue.length)await finish(j);else await navigateCurrent(j);return {ok:true,index:j.index};}
async function failDeep(msg,sender){const j=await getJob();if(!j||j.stage!=='deep'||j.paused||sender.tab?.id!==j.tabId)return {ignored:true};const id=j.queue[j.index];if(String(msg.id)!==String(id))return {ignored:true};const p=await getOne(keyOf(j.group,id));if(p){p.deep={status:'failed',error:String(msg.error||'unknown').slice(0,240),at:new Date().toISOString(),diagnostics:msg.details||null};await putOne(p);}j.deepErrors++;j.index++;j.note=`Недоступен пост ${id}: записана ошибка, идём дальше`;await setJob(j);if(j.index>=j.queue.length)await finish(j);else await navigateCurrent(j);return {ok:true,index:j.index};}
async function finish(j){j.stage='done';j.paused=false;j.finishedAt=now();j.note=`Обработано ${j.deepDone}/${j.queue.length}; ошибок ${j.deepErrors}. Полнота комментариев не гарантирована.`;await setJob(j);try{await chrome.tabs.create({url:chrome.runtime.getURL('export.html')});}catch{}return j;}
let mutex=Promise.resolve();function serial(task){const next=mutex.then(task,task);mutex=next.catch(()=>{});return next;}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{serial(async()=>{if(sender.tab&&!(msg.type==='exportSlice'&&sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('export.html'))){const j=await getJob();if(sender.frameId&&sender.frameId!==0)return {ignored:true};if(msg.type!=='status'&&(!j||sender.tab.id!==j.tabId||groupOf(sender.tab.url)!==j.group))return {ignored:true};if(['start','resume','collectFound','pause'].includes(msg.type))return {ignored:true};}switch(msg.type){
 case 'start':return start(msg);
 case 'pause':return pause();
 case 'resume':return resume(msg.tabId,msg.url);
 case 'collectFound':return collectFound(msg.tabId,msg.url);
 case 'status':{const j=await getJob();return sender.tab&&(sender.tab.id!==j?.tabId||groupOf(sender.tab.url)!==j?.group)?null:j;}
 case 'discover':return discovered(msg,sender);
 case 'obstructed':return obstructed(msg,sender);
 case 'endDiscovery':return endDiscovery(msg,sender);
 case 'deepReady':return deepState(msg,sender,'READY');
 case 'deepExpanding':return deepState(msg,sender,'EXPANDING');
 case 'deepMismatch':return deepMismatch(msg,sender);
 case 'deepSnapshot':return completeDeep(msg,sender);
 case 'deepError':return failDeep(msg,sender);
 case 'exportSlice':{const j=await getJob();if(!j)return {items:[],job:null,total:0};const rows=(await allPosts(j.group)).sort((a,b)=>a.key.localeCompare(b.key));const start=Math.max(0,Number(msg.offset)||0);return {job:j,items:rows.slice(start,start+Math.min(50,Number(msg.limit)||50)),total:rows.length};}
 default:throw Error('Неизвестный запрос');
}}).then(r=>sendResponse({ok:true,result:r})).catch(e=>sendResponse({ok:false,error:safeError(e)}));return true;});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create(ALARM,{periodInMinutes:1}));
chrome.alarms.onAlarm.addListener(async a=>{if(a.name!==ALARM)return;try{const j=await getJob();if(!j||j.paused)return;
 if(j.stage==='deep'&&j.deepPhase==='NAVIGATING'&&now()-(j.navStartedAt||0)>150000){await serial(async()=>{const cur=await getJob();if(cur?.stage==='deep'&&!cur.paused&&cur.deepPhase==='NAVIGATING'&&now()-(cur.navStartedAt||0)>150000)await failDeep({id:cur.queue[cur.index],error:'Таймаут навигации к подробной странице >150 сек'}, {tab:{id:cur.tabId}});});}
 if(j.stage==='discover'&&now()-(j.lastSeen||j.startedAt)>180000){await serial(async()=>{const cur=await getJob();if(!cur||cur.stage!=='discover'||cur.paused)return;cur.watchdogRecoveries=(cur.watchdogRecoveries||0)+1;if(cur.watchdogRecoveries>3){await stall(cur,'Лента не отвечает после 3 автоматических перезагрузок',{watchdog:true},'discover');return;}cur.note=`Автовосстановление: лента молчит >180 сек, перезагрузка ${cur.watchdogRecoveries}/3`;cur.lastSeen=now();await setJob(cur);await chrome.tabs.update(cur.tabId,{url:'https://www.facebook.com/groups/'+encodeURIComponent(cur.group)+'/'});});}
}catch(e){console.warn('Bur watchdog',safeError(e));}});
// Page-load events actively wake the collector. The process no longer depends on
// keeping the Facebook tab focused or on a popup remaining open.
chrome.tabs.onUpdated.addListener((tabId,changeInfo,updatedTab)=>{if(changeInfo.status!=='complete')return;setTimeout(()=>{void serial(async()=>{const j=await getJob();if(!j||j.paused||j.tabId!==tabId||!['discover','deep'].includes(j.stage))return;const tab=updatedTab?.url?updatedTab:await chrome.tabs.get(tabId);if(j.stage==='deep'&&await recoverDeepRedirect(j,tab.url))return;await notifyTab(tabId);});},250);});
