/* FB Bur 0.5.19-alpha. Continuous feed session: feed tab stays put; deep runs in a service tab. */
importScripts('core.js');
const C=globalThis.FBBurCore;
const DB='bur-collector-v05', DBVER=1,JOB_KEY='burCollectorJob-v0519',CHECKPOINT_KEY='burCollectorCheckpoints-v0519',HISTORY_KEY='burCollectorHistory-v0519',ALARM='bur-collector-watchdog';
const VERSION='0.5.19-alpha',CHECKPOINT_ALGORITHM='continuous_feed_v3',HISTORY_LIMIT=50000,now=()=>Date.now();
const historyCache=new Map();
const DEFAULTS={maxPosts:50,maxSteps:15000};
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
async function getCheckpoints(){return (await chrome.storage.local.get(CHECKPOINT_KEY))[CHECKPOINT_KEY]||{};}
async function setCheckpoint(group,postId,meta={}){
 const all=await getCheckpoints();if(postId)all[group]={post_id:String(postId),saved_at:new Date().toISOString(),...meta};else delete all[group];
 await chrome.storage.local.set({[CHECKPOINT_KEY]:all});return all[group]||null;
}
async function getPageCheckpoint(tabId,group){try{const r=await chrome.tabs.sendMessage(tabId,{type:'burCheckpointGet',group});const id=String(r?.post_id||'').trim();return /^\d{8,30}$/.test(id)?id:null;}catch{return null;}}
async function setPageCheckpoint(tabId,group,postId){try{await chrome.tabs.sendMessage(tabId,{type:'burCheckpointSet',group,post_id:postId?String(postId):null});return true;}catch{return false;}}
async function getPageHistory(tabId,group){try{const r=await chrome.tabs.sendMessage(tabId,{type:'burHistoryGet',group});return Array.isArray(r?.ids)?r.ids.map(String).filter(x=>/^\d{8,30}$/.test(x)).slice(-HISTORY_LIMIT):[];}catch{return [];}}
async function setPageHistory(tabId,group,ids){try{const list=Array.from(new Set((ids||[]).map(String).filter(x=>/^\d{8,30}$/.test(x)))).slice(-HISTORY_LIMIT);await chrome.tabs.sendMessage(tabId,{type:'burHistorySet',group,ids:list});return true;}catch{return false;}}
async function historyFor(group,tabId=null){
 if(historyCache.has(group))return historyCache.get(group);
 const raw=(await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY]||{},local=Array.isArray(raw[group])?raw[group]:[];
 const page=tabId?await getPageHistory(tabId,group):[],set=new Set([...local,...page].map(String).filter(x=>/^\d{8,30}$/.test(x)));
 while(set.size>HISTORY_LIMIT)set.delete(set.values().next().value);
 historyCache.set(group,set);
 raw[group]=[...set];await chrome.storage.local.set({[HISTORY_KEY]:raw});
 if(tabId)await setPageHistory(tabId,group,raw[group]);
 return set;
}
async function mergeHistory(group,ids,tabId=null){
 const set=await historyFor(group,tabId);
 for(const raw of ids||[]){const id=String(raw||'');if(/^\d{8,30}$/.test(id)){if(set.has(id))set.delete(id);set.add(id);}}
 while(set.size>HISTORY_LIMIT)set.delete(set.values().next().value);
 const all=(await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY]||{};all[group]=[...set];await chrome.storage.local.set({[HISTORY_KEY]:all});
 if(tabId)await setPageHistory(tabId,group,all[group]);
 return set;
}
async function clearHistory(group,tabId=null){
 historyCache.delete(group);const all=(await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY]||{};delete all[group];await chrome.storage.local.set({[HISTORY_KEY]:all});
 if(tabId)await setPageHistory(tabId,group,[]);return true;
}
async function checkpointForStart(group,existing,tabId){
 // 0.5.17 could start from Facebook's restored scroll position and therefore
 // record a false continuation. 0.5.18 never migrates its checkpoint namespace.
 const all=await getCheckpoints();if(all[group]?.post_id&&all[group]?.algorithm===CHECKPOINT_ALGORITHM)return all[group];
 const pageId=await getPageCheckpoint(tabId,group);
 if(pageId)return setCheckpoint(group,pageId,{source:'facebook_localstorage',recovered_after_reinstall:true,algorithm:CHECKPOINT_ALGORITHM});
 return null;
}
function safeError(e){return String(e?.message||e||'Error').slice(0,240);}
function keyOf(group,id){return group+'|post:'+id;}
function observationsFrom(msg){
 const vh=Math.max(1,Number(msg.viewportHeight)||800);
 const src=Array.isArray(msg.observations)?msg.observations.slice(0,200):
   (Array.isArray(msg.posts)?msg.posts.slice(0,200).map((post,i)=>({post,top:i*100,bottom:i*100+80,visible:true,viewportHeight:vh})):[]);
 return src.map((o,i)=>{
   const post=o?.post||o;
   const top=o?.top!==null&&o?.top!==undefined&&Number.isFinite(Number(o.top))?Number(o.top):null;
   const bottom=o?.bottom!==null&&o?.bottom!==undefined&&Number.isFinite(Number(o.bottom))?Number(o.bottom):null;
   return {post,top,bottom,visible:o?.visible===true,viewportHeight:Math.max(1,Number(o?.viewportHeight)||vh),_i:i};
 }).filter(o=>o.post?.post_id).sort((a,b)=>{
   const at=Number.isFinite(a.top)?a.top:Number.POSITIVE_INFINITY,bt=Number.isFinite(b.top)?b.top:Number.POSITIVE_INFINITY;
   return at-bt||a._i-b._i;
 });
}
function rememberCheckpointSeen(j,ids){
 const arr=Array.isArray(j.checkpointSeenIds)?j.checkpointSeenIds:[],seen=new Set(arr);
 for(const raw of ids||[]){const id=String(raw||'');if(!id||seen.has(id))continue;seen.add(id);arr.push(id);}
 // Old cards far above the checkpoint cannot re-enter a virtualized Facebook viewport.
 // Keep a generous rolling guard without letting one very deep scan bloat chrome.storage forever.
 if(arr.length>HISTORY_LIMIT)arr.splice(0,arr.length-HISTORY_LIMIT);
 j.checkpointSeenIds=arr;
}
async function admitRows(j,rows){
 const blocked=new Set((Array.isArray(j.checkpointSeenIds)?j.checkpointSeenIds:[]).map(String));
 if(j.checkpointPostId)blocked.add(String(j.checkpointPostId));
 const historical=await historyFor(j.group,j.feedTabId??j.tabId);
 const order=Array.isArray(j.discoveryOrder)?j.discoveryOrder.map(String):[],known=new Set(order),batchSeen=new Set();
 const eligible=[],newIds=[];let historyRejected=0,remaining=Math.max(0,(j.options?.maxPosts||0)-order.length);
 for(const raw of rows||[]){
  const id=String(raw?.post_id||'');if(!id||blocked.has(id)||batchSeen.has(id))continue;batchSeen.add(id);
  if(historical.has(id)&&!known.has(id)){historyRejected++;continue;}
  if(!known.has(id)){if(remaining<=0)continue;known.add(id);order.push(id);newIds.push(id);remaining--;}
  eligible.push(raw);
 }
 const allowed=new Set(order),toStore=eligible.filter(r=>allowed.has(String(r.post_id||'')));
 const db=toStore.length?await putMany(toStore,j.group):{added:0,updated:0};
 j.discoveryOrder=order;j.discovered=order.length;j.historyRejected=(j.historyRejected||0)+historyRejected;j.historyCount=historical.size;
 return {added:newIds.length,updated:db.updated||0,stored:toStore.length,newIds,historyRejected};
}
async function notifyTab(tabId){try{await chrome.tabs.sendMessage(tabId,{type:'burWake'});}catch(e){console.warn('Bur wake',safeError(e));}}
async function ensureContent(tabId,group){
 const tab=await chrome.tabs.get(tabId);
 if(groupOf(tab.url)!==group)throw Error('Вкладка ещё не открыта в нужной Facebook-группе');
 let r;try{r=await chrome.tabs.sendMessage(tabId,{type:'burPing'});}catch{}
 // If an older Bur content script is still alive in an already-open Facebook tab,
 // injecting the new file cannot safely remove the old listener. Reload the tab once;
 // manifest content_scripts will then start ONLY the current version.
 if(r?.ready&&r.version!==VERSION){
  await chrome.tabs.reload(tabId);
  for(let i=0;i<30;i++){
   await new Promise(resolve=>setTimeout(resolve,300));
   try{r=await chrome.tabs.sendMessage(tabId,{type:'burPing'});}catch{r=null;}
   if(r?.ready&&r.version===VERSION)break;
  }
 }
 if(!r?.ready){try{await chrome.scripting.executeScript({target:{tabId},files:['core.js','feed-scroll.js','content.js']});r=await chrome.tabs.sendMessage(tabId,{type:'burPing'});}catch(e){throw Error('Скрипт не подключился: '+safeError(e)+'. Обновите вкладку Facebook.');}}
 if(!r?.ready||r.version!==VERSION)throw Error('Не удалось подтвердить версию скрипта '+VERSION);
 return r;
}
function isRootFeedUrl(url,group){try{const u=new URL(url);return groupOf(url)===group&&u.pathname.replace(/\/+$/,'')==='/groups/'+group;}catch{return false;}}
function feedId(j){return j?.feedTabId??j?.tabId??null;}
function deepId(j){return j?.deepTabId??null;}
function senderRole(j,sender){const id=sender?.tab?.id;if(!j||!id)return null;if(id===feedId(j)&&groupOf(sender.tab?.url)===j.group)return 'feed';if(id===deepId(j)&&groupOf(sender.tab?.url)===j.group)return 'deep';return null;}
async function start({tabId,url,options={},replacePaused=false,startAfter=null}){const group=groupOf(url);if(!group||!/^\/groups\/[^/]+\/?$/.test(new URL(url).pathname))throw Error('Откройте ленту нужной Facebook-группы');await ensureContent(tabId,group);const existing=await getJob();if(existing&&existing.stage!=='done'&&!(replacePaused&&existing.paused))throw Error('Сбор уже существует: нажмите «Продолжить» либо поставьте его на паузу перед запуском другой группы.');
 const opts={maxPosts:Math.max(5,Math.min(5000,Math.trunc(Number(options.maxPosts)||DEFAULTS.maxPosts))),maxSteps:Math.max(30,Math.min(15000,Math.trunc(Number(options.maxSteps)||DEFAULTS.maxSteps)))};
 const manual=String(startAfter||'').trim();if(manual&&!/^\d{8,30}$/.test(manual))throw Error('post_id должен состоять только из цифр');
 const checkpoint=manual?await setCheckpoint(group,manual,{manual:true,source:'popup',algorithm:CHECKPOINT_ALGORITHM}):await checkpointForStart(group,existing,tabId);
 if(manual)await setPageCheckpoint(tabId,group,manual);
 const history=await historyFor(group,tabId);
 await clearGroup(group);
 const hasCheckpoint=Boolean(checkpoint?.post_id);
 const j={id:now().toString(36),version:VERSION,checkpointAlgorithm:CHECKPOINT_ALGORITHM,group,tabId,stage:'discover',paused:false,startedAt:now(),lastSeen:now(),steps:0,discovered:0,deepDone:0,deepErrors:0,queue:[],discoveryOrder:[],checkpointSeenIds:[],historyRejected:0,historyCount:history.size,index:0,options:opts,
  checkpointPostId:checkpoint?.post_id||null,checkpointPending:hasCheckpoint,checkpointFound:false,checkpointScanSteps:0,checkpointSource:manual?'manual':(checkpoint?.recovered_after_reinstall?'facebook_localstorage':'stored'),
  rewindPending:hasCheckpoint,rewindVerified:!hasCheckpoint,rewindDiagnostics:null,
  note:hasCheckpoint?'Сначала возвращаю Facebook-ленту в подтверждённый верх. До checkpoint '+checkpoint.post_id+' ничего не сохраняю.':'Разведка: первый пакет, сбор ВСЕХ доступных публикаций без оценки содержания'};
 await setJob(j);
 if(hasCheckpoint){await chrome.tabs.reload(tabId);return j;}
 await notifyTab(tabId);return j;
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
 if(j.checkpointPending)throw Error('Контрольная точка ещё не найдена. До неё Бур только листает и ничего не сохраняет.');
 const all=await allPosts(j.group),byId=new Map(all.filter(p=>p.post_id).map(p=>[String(p.post_id),p]));
 let ids=(Array.isArray(j.discoveryOrder)?j.discoveryOrder:[]).map(String).filter(id=>byId.has(id));
 if(!ids.length&&all.length)ids=all.filter(p=>p.post_id).sort((a,b)=>String(a.first_seen||'').localeCompare(String(b.first_seen||''))||String(a.key).localeCompare(String(b.key))).map(p=>String(p.post_id));
 j.queue=ids;j.index=0;j.stage='deep';j.paused=false;j.stall=null;j.note=`Разведка окончена (${reason}). Подробный сбор ВСЕХ ${j.queue.length} публикаций в порядке фактической прокрутки — без отбора.`;
 await setJob(j);if(j.queue.length)await navigateCurrent(j);else await finish(j);return j;
}
async function collectFound(tabId,url){const j=await getJob();if(!j||!(j.stage==='discover'||j.stage==='stalled'&&j.stall?.resumeStage==='discover'))throw Error('Сначала запустите разведку');if(groupOf(url)!==j.group)throw Error('Откройте группу '+j.group);if(tabId!==j.tabId)throw Error('Вернитесь в исходную вкладку группы '+j.group);if(j.checkpointPending)throw Error('Контрольная точка '+j.checkpointPostId+' ещё не найдена; до неё Бур ничего не сохраняет.');await ensureContent(j.tabId,j.group);return beginDeep(j,'нажата кнопка «Собрать найденные»');}
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
async function rewindResult(msg,sender){
 const j=await getJob();if(!j||j.stage!=='discover'||j.paused||sender.tab?.id!==j.tabId||groupOf(sender.tab?.url)!==j.group)return {ignored:true};
 if(!j.rewindPending)return {ignored:true,alreadyDone:true};
 const r=msg.result||{};j.lastSeen=now();j.rewindDiagnostics=r;
 if(!r.ok){return stall(j,'Не удалось надёжно вернуть Facebook-ленту к самому верху; checkpoint не ищется и данные не сохраняются',{rewind:r},'discover');}
 j.rewindPending=false;j.rewindVerified=true;j.rewindDoneAt=new Date().toISOString();j.steps=0;j.checkpointScanSteps=0;j.checkpointSeenIds=[];j.note='Верх ленты подтверждён. Ищу checkpoint '+j.checkpointPostId+'. До него ничего не сохраняю.';
 await setJob(j);await notifyTab(j.tabId);return {ok:true,rewindVerified:true,checkpoint:j.checkpointPostId};
}
async function discovered(msg,sender){
 const j=await getJob();if(!j||j.stage!=='discover'||j.paused||sender.tab?.id!==j.tabId||groupOf(sender.tab?.url)!==j.group)return {ignored:true};
 if(j.rewindPending)return {ignored:true,rewinding:true,stage:j.stage,discovered:j.discovered};
 const observations=observationsFrom(msg),vh=Math.max(1,Number(msg.viewportHeight)||observations[0]?.viewportHeight||800);
 j.steps+=Math.min(1,Number(msg.step)||0);j.lastSeen=now();
 let candidateRows=[];
 if(j.checkpointPending){
  j.checkpointScanSteps=(j.checkpointScanSteps||0)+1;
  // "Reached" means the checkpoint has physically entered/passed the viewport while
  // scrolling downward. A checkpoint merely prefetched far below the viewport is NOT reached.
  const cp=observations.find(o=>String(o.post.post_id)===String(j.checkpointPostId)&&Number.isFinite(o.top)&&o.top<vh);
  if(!cp){
   // Remember only cards that have actually reached the viewport. DOM may pre-render
   // future cards below it; blocking those would create a gap after the checkpoint.
   rememberCheckpointSeen(j,observations.filter(o=>Number.isFinite(o.top)&&o.top<vh).map(o=>o.post.post_id));
   j.note=`Ищу контрольную точку ${j.checkpointPostId}; проходы ${j.checkpointScanSteps}. До неё ничего не сохранено.`;
   if(j.steps>=j.options.maxSteps||msg.exhausted)await stall(j,'Контрольная точка '+j.checkpointPostId+' не найдена; сбор остановлен, чтобы не начать не с того места',msg.diagnostics,'discover');
   else await setJob(j);
   return {added:0,updated:0,stage:j.stage,discovered:j.discovered,seekingCheckpoint:true,checkpoint:j.checkpointPostId,seenBeforeCheckpoint:j.checkpointSeenIds.length};
  }
  const cpTop=cp.top;
  // This is the key 0.5.17 rule: geometry, not DOM-array position, defines "after".
  // Everything at/above the checkpoint is a forbidden old area; only cards physically
  // BELOW it can enter the new package.
  rememberCheckpointSeen(j,observations.filter(o=>Number.isFinite(o.top)&&o.top<=cpTop+4).map(o=>o.post.post_id));
  rememberCheckpointSeen(j,[j.checkpointPostId]);
  j.checkpointPending=false;j.checkpointFound=true;j.checkpointFoundAt=new Date().toISOString();j.checkpointFoundTop=cpTop;
  const historical=await mergeHistory(j.group,j.checkpointSeenIds,j.tabId);j.historyCount=historical.size;
  candidateRows=observations.filter(o=>Number.isFinite(o.top)&&Number.isFinite(o.bottom)&&o.top>cpTop+4&&o.bottom>0).map(o=>o.post);
 }else if(j.checkpointFound){
  // Once the boundary is crossed, ignore cards wholly above the viewport and every id
  // observed before/at the boundary. This survives Facebook keeping old DOM nodes around.
  candidateRows=observations.filter(o=>Number.isFinite(o.top)&&Number.isFinite(o.bottom)&&o.bottom>0).map(o=>o.post);
 }else{
  // First-ever package: there is no boundary to seek.
  candidateRows=observations.map(o=>o.post);
 }
 const r=await admitRows(j,candidateRows);if(r.added)j.obstructionRecoveries=0;
 j.note=(j.checkpointFound?`Продолжение строго после ${j.checkpointPostId}. `:'')+`Разведка: ${j.discovered} из ${j.options.maxPosts}, проходы ${j.steps}`;
 if(j.discovered>=j.options.maxPosts)await beginDeep(j,'достигнут предел публикаций');
 else if(j.steps>=j.options.maxSteps||msg.exhausted)await stall(j,j.steps>=j.options.maxSteps?'Лимит проходов ленты':'Лента перестала продвигаться',msg.diagnostics,'discover');
 else await setJob(j);
 return {...r,stage:j.stage,discovered:j.discovered,seekingCheckpoint:false,checkpointFound:j.checkpointFound,checkpoint:j.checkpointPostId,discoveryTail:j.discoveryOrder.slice(-3)};
}
async function endDiscovery(msg,sender){const j=await getJob();if(j&&sender.tab?.id===j.tabId&&j.stage==='discover'&&!j.paused)await stall(j,j.checkpointPending?'Контрольная точка '+j.checkpointPostId+' не найдена; сбор остановлен, чтобы не пропустить публикации':(msg.reason||'Нет новых карточек'),msg.diagnostics,'discover');return getJob();}
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
async function finish(j){j.stage='done';j.paused=false;j.finishedAt=now();if(j.queue?.length){const order=Array.isArray(j.discoveryOrder)&&j.discoveryOrder.length?j.discoveryOrder:j.queue;j.lastCollectedPostId=String(order[order.length-1]);const historical=await mergeHistory(j.group,order,j.tabId);j.historyCount=historical.size;await setCheckpoint(j.group,j.lastCollectedPostId,{source_job_id:j.id,deep_done:j.deepDone,deep_errors:j.deepErrors,algorithm:CHECKPOINT_ALGORITHM,version:VERSION});await setPageCheckpoint(j.tabId,j.group,j.lastCollectedPostId);}j.note=`Обработано ${j.deepDone}/${j.queue.length}; ошибок ${j.deepErrors}. Следующая доверенная граница: ${j.lastCollectedPostId||'не изменена'}. История известных ID: ${j.historyCount||0}. Полнота комментариев не гарантирована.`;await setJob(j);try{await chrome.tabs.create({url:chrome.runtime.getURL('export.html')});}catch{}return j;}
let mutex=Promise.resolve();function serial(task){const next=mutex.then(task,task);mutex=next.catch(()=>{});return next;}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{serial(async()=>{if(sender.tab&&!(msg.type==='exportSlice'&&sender.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('export.html'))){const j=await getJob();if(sender.frameId&&sender.frameId!==0)return {ignored:true};if(msg.type!=='status'&&(!j||sender.tab.id!==j.tabId||groupOf(sender.tab.url)!==j.group))return {ignored:true};if(['start','resume','collectFound','pause'].includes(msg.type))return {ignored:true};}switch(msg.type){
 case 'start':return start(msg);
 case 'pause':return pause();
 case 'resume':return resume(msg.tabId,msg.url);
 case 'collectFound':return collectFound(msg.tabId,msg.url);
 case 'resetCheckpoint':{const j=await getJob();const group=msg.group||j?.group;if(!group)throw Error('Группа не определена');await setCheckpoint(group,null);if(j?.group===group){await setPageCheckpoint(j.tabId,group,null);await clearHistory(group,j.tabId);}else await clearHistory(group,null);if(j?.group===group&&j.stage==='stalled'&&j.stall?.resumeStage==='discover'){j.checkpointPostId=null;j.checkpointPending=false;j.checkpointFound=false;j.checkpointSeenIds=[];j.discoveryOrder=[];j.historyRejected=0;j.historyCount=0;j.rewindPending=false;j.rewindVerified=true;j.rewindDiagnostics=null;j.stall=null;j.stage='discover';j.paused=false;j.steps=0;j.note='Контрольная точка сброшена вручную. Разведка начата как первый пакет.';await setJob(j);await chrome.tabs.update(j.tabId,{url:'https://www.facebook.com/groups/'+encodeURIComponent(group)+'/'});}return getJob();}
 case 'status':{const j=await getJob();return sender.tab&&(sender.tab.id!==j?.tabId||groupOf(sender.tab.url)!==j?.group)?null:j;}
 case 'rewindResult':return rewindResult(msg,sender);
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
