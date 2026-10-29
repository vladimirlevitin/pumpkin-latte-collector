/* FB Bur 0.5.23-alpha. Continuous feed identity: same document resumes in place; checkpoint recovery only after real feed loss. */
importScripts('core.js','archive-state.js');
const C=globalThis.FBBurCore,A=globalThis.FBBurArchive;
const DB='bur-collector-v05', DBVER=1,JOB_KEY='burCollectorJob-v0520',CHECKPOINT_KEY='burCollectorCheckpoints-v0520',HISTORY_KEY='burCollectorHistory-v0520',RECEIPT_KEY='burCollectorExportReceipts-v1',ARCHIVE_KEY='burCollectorArchives-v1',SAVED_JOB_KEY='burCollectorSavedJobs-v1',ALARM='bur-collector-watchdog';
const VERSION='0.5.23-alpha',CHECKPOINT_ALGORITHM='continuous_feed_v4',HISTORY_LIMIT=50000,now=()=>Date.now();
const historyCache=new Map(),confirmedCache=new Map();
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
async function setJob(j,extra={}){
 j.updatedAt=now();const saved=(await chrome.storage.local.get(SAVED_JOB_KEY))[SAVED_JOB_KEY]||{};
 saved[j.group]||={};saved[j.group][j.runMode||'history']=j;
 await chrome.storage.local.set({[JOB_KEY]:j,[SAVED_JOB_KEY]:saved,...extra});return j;
}
async function archiveMap(){return (await chrome.storage.local.get(ARCHIVE_KEY))[ARCHIVE_KEY]||{};}
async function archiveFor(group){const map=await archiveMap();return map[group]||A.empty(group);}
async function archiveJob(j,operation){
 const map=await archiveMap(),state=map[j.group]||A.empty(j.group);
 map[j.group]=operation(state);await setJob(j,{[ARCHIVE_KEY]:map});return map[j.group];
}
async function finishUpdate(j){
 if(!j.updateBoundaryReached||j.discoveryOrder?.length||j.deferredRows?.length)throw Error('Пополнение ещё не сохранено');
 const map=await archiveMap();let state=map[j.group];
 if(!state?.runs[j.id])throw Error('Нет состояния пополнения');
 if(state.runs[j.id]?.status==='suspended')state=A.resume(state,j.id);state=A.reachBoundary(state,j.id,j.updateStopId);state=A.finish(state,j.id);map[j.group]=state;
 j.stage='done';j.paused=false;j.note='Пополнение сохранено до прежней верхней границы. Исторический хвост не изменён.';
 j.archiveHead=state.head;j.archiveTail=state.tail;await setJob(j,{[ARCHIVE_KEY]:map});return j;
}
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
async function confirmedFor(group){
 if(confirmedCache.has(group))return confirmedCache.get(group);
 const receipts=(await chrome.storage.local.get(RECEIPT_KEY))[RECEIPT_KEY]||{},ids=new Set();
 for(const [key,receipt] of Object.entries(receipts))if((receipt.group===group||!receipt.group&&key.startsWith(group+'|'))&&receipt.retained&&!receipt.incomplete&&/^[a-f0-9]{64}$/.test(receipt.sha256||''))for(const id of receipt.ids||[])ids.add(String(id));
 confirmedCache.set(group,ids);return ids;
}
async function admitRows(j,rows){
 const blocked=new Set((Array.isArray(j.checkpointSeenIds)?j.checkpointSeenIds:[]).map(String));
 if(j.checkpointPostId)blocked.add(String(j.checkpointPostId));
 const historical=await historyFor(j.group,j.feedTabId??j.tabId);
 const confirmed=j.runMode==='update'?await confirmedFor(j.group):null;
 const order=Array.isArray(j.discoveryOrder)?j.discoveryOrder.map(String):[],known=new Set(order),batchSeen=new Set();
 const eligible=[],newIds=[];let historyRejected=0,remaining=Math.max(0,(j.options?.maxPosts||0)-order.length);
 const source=rows||[];
 for(let rowIndex=0;rowIndex<source.length;rowIndex++){
  const raw=source[rowIndex];
  if(raw?.group&&raw.group!==j.group)continue;
  if(raw?._stopBoundary){j.updateBoundaryReached=true;j.updateBoundaryFoundAt=new Date().toISOString();break;}
  const id=String(raw?.post_id||'');if(!id||blocked.has(id)&&!raw._burRetainedDraft||batchSeen.has(id))continue;batchSeen.add(id);
  if(!raw._burRetainedDraft&&confirmed?.has(id)&&!known.has(id)){historyRejected++;continue;}
  if(!raw._burRetainedDraft&&j.runMode!=='update'&&historical.has(id)&&!known.has(id)){historyRejected++;continue;}
  if(!known.has(id)){if(remaining<=0){j.deferredRows=(j.deferredRows||[]).concat(source.slice(rowIndex));break;}known.add(id);order.push(id);newIds.push(id);remaining--;}
  j.feedPinById||={};if(!(id in j.feedPinById))j.feedPinById[id]=raw.is_pinned===true;
  j.headCandidates||=[];if(!raw.is_pinned&&!j.headCandidates.includes(id))j.headCandidates.push(id);
  const stored={...raw,feed_is_pinned:j.feedPinById[id]};delete stored._burRetainedDraft;eligible.push(stored);
 }
 const allowed=new Set(order),toStore=eligible.filter(r=>allowed.has(String(r.post_id||'')));
 const db=toStore.length?await putMany(toStore,j.group):{added:0,updated:0};
 j.discoveryOrder=order;j.discovered=order.length;j.historyRejected=(j.historyRejected||0)+historyRejected;j.historyCount=historical.size;
 return {added:newIds.length,updated:db.updated||0,stored:toStore.length,newIds,historyRejected};
}
async function notifyTab(tabId){try{await chrome.tabs.sendMessage(tabId,{type:'burWake'});}catch(e){console.warn('Bur wake',safeError(e));}}
async function probeFeedState(tabId,group){
 try{
  const tab=await chrome.tabs.get(tabId);
  if(groupOf(tab.url)!==group||!isRootFeedUrl(tab.url,group))return {ok:false,reason:'not_root_feed',url:tab.url||null};
  const r=await chrome.tabs.sendMessage(tabId,{type:'burPing'});
  if(!r?.ready||r.version!==VERSION)return {ok:false,reason:'content_version',version:r?.version||null,url:tab.url||null};
  return {ok:true,pageInstance:String(r.pageInstance||''),scrollY:Number(r.scrollY)||0,url:tab.url||null};
 }catch(e){return {ok:false,reason:'probe_failed',error:safeError(e)};}
}
function feedPositionPreserved(j,probe){
 if(!probe?.ok||!probe.pageInstance||!j.feedPageInstance||probe.pageInstance!==j.feedPageInstance)return false;
 const before=Number(j.feedAnchorScrollY),after=Number(probe.scrollY);
 if(!Number.isFinite(before)||before<1||!Number.isFinite(after))return true;
 const tolerance=Math.max(2500,Math.round(before*0.15));
 return after>=Math.max(0,before-tolerance);
}
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
 if(!r?.ready){try{await chrome.scripting.executeScript({target:{tabId},files:['core.js','feed-scroll.js','checkpoint-seek.js','content.js']});r=await chrome.tabs.sendMessage(tabId,{type:'burPing'});}catch(e){throw Error('Скрипт не подключился: '+safeError(e)+'. Обновите вкладку Facebook.');}}
 if(!r?.ready||r.version!==VERSION)throw Error('Не удалось подтвердить версию скрипта '+VERSION);
 return r;
}
function isRootFeedUrl(url,group){try{const u=new URL(url);return groupOf(url)===group&&u.pathname.replace(/\/+$/,'')==='/groups/'+group;}catch{return false;}}
function feedId(j){return j?.feedTabId??j?.tabId??null;}
function deepId(j){return j?.deepTabId??null;}
function senderRole(j,sender){const id=sender?.tab?.id;if(!j||!id)return null;if(id===feedId(j)&&groupOf(sender.tab?.url)===j.group)return 'feed';if(id===deepId(j)&&groupOf(sender.tab?.url)===j.group)return 'deep';return null;}
async function start({tabId,url,options={},replacePaused=false,startAfter=null,mode='history'}){
 const group=groupOf(url);
 if(!group||!isRootFeedUrl(url,group))throw Error('Откройте корень ленты нужной Facebook-группы');
 const feedReady=await ensureContent(tabId,group);
 const existing=await getJob();
 if(existing&&existing.stage!=='done'&&!(replacePaused&&existing.paused))throw Error('Сбор уже существует: нажмите «Продолжить» либо поставьте его на паузу перед запуском другой группы.');
 if(!['history','update'].includes(mode))throw Error('Неизвестный режим сбора');
 const saved=(await chrome.storage.local.get(SAVED_JOB_KEY))[SAVED_JOB_KEY]||{};
 const previous=saved[group]?.[mode];
 if(previous&&previous.stage!=='done'&&!startAfter){
  const restoring={...previous,feedTabId:tabId,tabId};
  if(feedId(previous)!==tabId)restoring.feedPageInstance='';
  await setJob(restoring);return resume(tabId,url);
 }
 if(previous&&previous.stage!=='done'&&startAfter&&(previous.discoveryOrder?.length||['deep','exporting'].includes(previous.stage)))throw Error('Сначала завершите сохранение текущего пакета');
 const opts={maxPosts:Math.max(5,Math.min(5000,Math.trunc(Number(options.maxPosts)||DEFAULTS.maxPosts))),maxSteps:Math.max(100,Math.min(50000,Math.trunc(Number(options.maxSteps)||DEFAULTS.maxSteps)))};
 const manual=String(startAfter||'').trim();if(manual&&!/^\d{8,30}$/.test(manual))throw Error('post_id должен состоять только из цифр');
 const checkpoint=mode==='update'?null:manual?await setCheckpoint(group,manual,{manual:true,source:'popup',algorithm:CHECKPOINT_ALGORITHM}):await checkpointForStart(group,existing,tabId);
 if(mode==='update'&&manual)throw Error('Режим пополнения использует сохранённую верхнюю границу');
 if(manual)await setPageCheckpoint(tabId,group,manual);
 const history=await historyFor(group,tabId);
 // Retain local snapshots across restarts and group switches.
 const archives=await archiveMap();let archive=archives[group]||A.empty(group);
 const legacy=(await getCheckpoints())[group];
 if(!archive.tail&&legacy?.post_id&&legacy.algorithm===CHECKPOINT_ALGORITHM){archive.tail=legacy.post_id;archive.tail_source='legacy_unverified';}
 if(mode==='update'&&!archive.head&&!archive.tail)throw Error('Сначала нужен первый сбор этой группы');
 archives[group]=archive;
 const hasCheckpoint=Boolean(checkpoint?.post_id),id=now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
 const j={id,sessionId:id,runMode:mode,archiveManaged:true,archiveRunStarted:false,archiveHead:archive.head,archiveTail:archive.tail,updateStopId:mode==='update'?(archive.head||archive.tail):null,updateBaseline:mode==='update'&&!archive.head,updateBoundaryReached:false,deferredRows:[],runStartsFromRoot:!hasCheckpoint,version:VERSION,checkpointAlgorithm:CHECKPOINT_ALGORITHM,group,tabId,feedTabId:tabId,deepTabId:null,exportTabId:null,
  stage:'discover',paused:false,startedAt:now(),lastSeen:now(),batchStartedAt:now(),batchNumber:1,completedBatches:0,sessionPosts:0,sessionDeepDone:0,sessionDeepErrors:0,
  steps:0,discovered:0,deepDone:0,deepErrors:0,queue:[],discoveryOrder:[],checkpointSeenIds:[],historyRejected:0,historyCount:history.size,index:0,options:opts,
  checkpointPostId:checkpoint?.post_id||null,checkpointPending:hasCheckpoint,checkpointFound:false,checkpointScanSteps:0,checkpointSource:manual?'manual':(checkpoint?.recovered_after_reinstall?'facebook_localstorage':'stored'),
  rewindPending:true,rewindVerified:false,rewindDiagnostics:null,liveBoundaryPending:false,liveBoundaryPostId:null,liveBoundaryScanSteps:0,
  feedPageInstance:String(feedReady?.pageInstance||''),feedAnchorScrollY:Number(feedReady?.scrollY)||0,feedAnchorAt:new Date().toISOString(),feedContinuationMode:'start',
  note:mode==='update'?(archive.head?'Собираю новые публикации до прежней верхней границы.':'Верхняя граница пока неизвестна. Связываю начало группы с прежней выгрузкой до сохранённого хвоста.'):hasCheckpoint?'Аварийный старт: возвращаю ленту наверх и ищу checkpoint '+checkpoint.post_id+'. После него сессия будет идти непрерывно.':'Непрерывная сессия: вкладка ленты остаётся на месте, deep выполняется отдельно.'};
 await setJob(j,{[ARCHIVE_KEY]:archives});
 if(hasCheckpoint){await chrome.tabs.reload(tabId);return j;}
 await notifyTab(tabId);return j;
}
async function pause(){const j=await getJob();if(!j)return null;j.paused=true;j.note='Сессия поставлена на паузу. Данные пакета сохранены.';if(j.archiveRunStarted)await archiveJob(j,state=>A.suspend(state,j.id));return setJob(j);}
async function resume(tabId,url){
 const j=await getJob();if(!j)throw Error('Нет задания');
 if(tabId!==feedId(j))throw Error('Сессия привязана к исходной вкладке ленты '+j.group+'. Вернитесь в неё.');
 if(groupOf(url)!==j.group)throw Error('Сессия привязана к группе '+j.group+'. Текущая вкладка открыта в другой группе.');
 if(j.archiveRunStarted)await archiveJob(j,state=>A.resume(state,j.id));
 j.paused=false;j.resumeCount=(j.resumeCount||0)+1;
 if(j.stage==='stalled'){j.stage=j.stall?.resumeStage||'discover';j.stall=null;}
 await setJob(j);
 if(j.readyForDeep){j.readyForDeep=false;await beginDeep(j,'сохранённый участок');}
 else if(j.stage==='deep')await navigateCurrent(j);
 else if(j.stage==='exporting')await openExport(j);
 else if(j.stage==='discover'){
  const probe=await probeFeedState(feedId(j),j.group);
  if(!probe.ok)await recoverFeedFromCheckpoint(j,'Вкладка ленты недоступна при возобновлении',probe);
  else if(!j.checkpointPending&&!j.rewindPending&&!feedPositionPreserved(j,probe)){
   await recoverFeedFromCheckpoint(j,'При возобновлении обнаружена реальная потеря живой feed-позиции',{
    expectedPageInstance:j.feedPageInstance,actualPageInstance:probe.pageInstance,
    anchorScrollY:j.feedAnchorScrollY??null,actualScrollY:probe.scrollY??null
   });
  }else await notifyTab(feedId(j));
 }
 return getJob();
}
async function ensureDeepTab(j){
 const id=j.queue?.[j.index];if(!id)return null;
 const url=C.canonicalUrl(j.group,id);let tab=null;
 if(j.deepTabId){try{tab=await chrome.tabs.get(j.deepTabId);}catch{}}
 if(!tab){
  tab=await chrome.tabs.create({url,active:false});
  if(!tab?.id)throw Error('Не удалось создать служебную deep-вкладку');
  j.deepTabId=tab.id;await setJob(j);return tab;
 }
 return tab;
}
async function beginDeep(j,reason){
 if(!j||!['discover','stalled'].includes(j.stage))return j;
 if(j.checkpointPending)throw Error('Контрольная точка ещё не найдена. До неё Бур только листает и ничего не сохраняет.');
 if(j.liveBoundaryPending)throw Error('Живая граница предыдущего пакета ещё не подтверждена.');
 const feedProbe=await probeFeedState(feedId(j),j.group);
 if(feedProbe.ok){j.feedPageInstance=feedProbe.pageInstance;j.feedAnchorScrollY=feedProbe.scrollY;j.feedAnchorAt=new Date().toISOString();j.feedContinuationMode='deep_anchor';}
 const all=await allPosts(j.group),byId=new Map(all.filter(p=>p.post_id).map(p=>[String(p.post_id),p]));
 let ids=(Array.isArray(j.discoveryOrder)?j.discoveryOrder:[]).map(String).filter(id=>byId.has(id));
 if(!j.archiveManaged&&!ids.length&&all.length)ids=all.filter(p=>p.post_id).sort((a,b)=>String(a.first_seen||'').localeCompare(String(b.first_seen||''))||String(a.key).localeCompare(String(b.key))).map(p=>String(p.post_id));
 j.queue=ids;j.batchDeepTotal=ids.length;j.index=0;j.stage='deep';j.paused=false;j.stall=null;j.batchDeepStartedAt=now();
 j.note='Пакет '+j.batchNumber+': разведка окончена ('+reason+'). Feed-вкладка остаётся на месте; deep идёт в отдельной вкладке.';
 await setJob(j);
 if(j.queue.length){await ensureDeepTab(j);await navigateCurrent(j);}else await finishBatch(j);
 return getJob();
}
async function collectFound(tabId,url){
 const j=await getJob();if(!j||!(j.stage==='discover'||j.stage==='stalled'&&j.stall?.resumeStage==='discover'))throw Error('Сначала запустите разведку');
 if(groupOf(url)!==j.group||tabId!==feedId(j))throw Error('Вернитесь в исходную вкладку группы '+j.group);
 if(j.checkpointPending||j.liveBoundaryPending)throw Error('Граница продолжения ещё не подтверждена; до неё Бур ничего не сохраняет.');
 return beginDeep(j,'нажата кнопка «Собрать найденные»');
}
async function stall(j,reason,details,resumeStage){j.stage='stalled';j.paused=true;j.stall={at:new Date().toISOString(),reason,details:details||null,resumeStage:resumeStage||j.stage};j.note='Приостановлено: '+reason+'. Данные не отмечены как завершённый пакет.';await setJob(j);return j;}
async function recoverFeedFromCheckpoint(j,reason,details=null){
 const boundary=String(j.lastCollectedPostId||j.checkpointPostId||'');
 const hasBoundary=/^\d{8,30}$/.test(boundary);
 const rows=await allPosts(j.group),byId=new Map(rows.map(p=>[String(p.post_id),p]));
 j.deferredRows=(j.discoveryOrder||[]).map(id=>byId.get(String(id))).filter(Boolean).concat(j.deferredRows||[]).map(row=>row._stopBoundary?row:{...row,is_pinned:j.feedPinById?.[String(row.post_id)]??row.is_pinned,_burRetainedDraft:true});
 // Re-discovery merges retained snapshots.
 j.stage='discover';j.paused=false;j.steps=0;j.discovered=0;j.headCandidates=[];j.feedPinById={};j.deepDone=0;j.deepErrors=0;j.batchDeepTotal=0;j.queue=[];j.index=0;j.discoveryOrder=[];j.checkpointSeenIds=[];j.historyRejected=0;
 j.checkpointPostId=hasBoundary?boundary:null;j.checkpointPending=hasBoundary;j.checkpointFound=false;j.checkpointScanSteps=0;j.checkpointSource='recovery';
 j.liveBoundaryPending=false;j.liveBoundaryPostId=null;j.liveBoundaryScanSteps=0;j.rewindPending=true;j.rewindVerified=false;j.rewindDiagnostics=null;
 j.feedRecoveryCount=(j.feedRecoveryCount||0)+1;j.resumeCount=(j.resumeCount||0)+1;
 j.note='Позиция живой ленты потеряна. Автовосстановление от checkpoint '+boundary+'; снимки незавершённого пакета сохранены локально для повторной обработки.';
 let tab=null;try{tab=await chrome.tabs.get(feedId(j));}catch{}
 const root='https://www.facebook.com/groups/'+encodeURIComponent(j.group)+'/';
 if(!tab){
  tab=await chrome.tabs.create({url:root,active:false});
  if(!tab?.id)return stall(j,'Не удалось восстановить вкладку ленты',{reason,details},'discover');
  j.feedTabId=tab.id;j.tabId=tab.id;
 }else if(!isRootFeedUrl(tab.url,j.group))await chrome.tabs.update(feedId(j),{url:root});
 else await chrome.tabs.reload(feedId(j));
 await setJob(j);return j;
}
async function resumeFeedAtLiveBoundary(j){
 const probe=await probeFeedState(feedId(j),j.group);
 if(!probe.ok)return recoverFeedFromCheckpoint(j,'Feed-вкладка недоступна после экспорта',probe);
 if(!feedPositionPreserved(j,probe)){
  return recoverFeedFromCheckpoint(j,'Feed-страница реально перезагрузилась или потеряла живую позицию',{
   expectedPageInstance:j.feedPageInstance||null,
   actualPageInstance:probe.pageInstance||null,
   anchorScrollY:j.feedAnchorScrollY??null,
   actualScrollY:probe.scrollY??null
  });
 }
 j.liveBoundaryPending=false;
 j.liveBoundaryPostId=j.lastCollectedPostId||j.checkpointPostId||null;
 j.liveBoundaryScanSteps=0;
 j.feedPageInstance=probe.pageInstance;
 j.feedAnchorScrollY=probe.scrollY;
 j.feedContinuationVerifiedAt=new Date().toISOString();
 j.feedContinuationMode='same_document';
 j.note='Пакет '+j.batchNumber+': живая feed-страница подтверждена; продолжаю с текущей позиции без повторного поиска checkpoint.';
 await setJob(j);await notifyTab(feedId(j));return j;
}
async function obstructed(msg,sender){
 const j=await getJob();if(!j||j.paused)return {ignored:true};const role=senderRole(j,sender);
 if(role==='deep'&&j.stage==='deep'){
  const id=j.queue[j.index];return failDeep({id,error:'Интерфейс Facebook перекрыл публикацию: '+String(msg.diagnostics?.phase||msg.diagnostics?.kind||'dialog'),details:msg.diagnostics||null},sender);
 }
 if(role!=='feed'||j.stage!=='discover')return {ignored:true};
 j.obstructionRecoveries=(j.obstructionRecoveries||0)+1;
 if(j.obstructionRecoveries>5){
  const probe=await probeFeedState(feedId(j),j.group);
  if(probe.ok&&feedPositionPreserved(j,probe))return stall(j,'Facebook более 5 раз подряд перекрыл ленту, но живая feed-страница сохранена; checkpoint recovery не запускаю',{diagnostics:msg.diagnostics,feed:probe},'discover');
  return recoverFeedFromCheckpoint(j,'Facebook более 5 раз подряд перекрыл ленту и живая feed-позиция потеряна',{diagnostics:msg.diagnostics,feed:probe});
 }
 j.note='Автовосстановление ленты после окна Facebook ('+j.obstructionRecoveries+'/5)';j.lastSeen=now();j.resumeCount=(j.resumeCount||0)+1;await setJob(j);await notifyTab(feedId(j));
 return {recovered:true};
}
async function rewindResult(msg,sender){
 const j=await getJob();if(!j||j.stage!=='discover'||j.paused||senderRole(j,sender)!=='feed')return {ignored:true};
 if(!j.rewindPending)return {ignored:true,alreadyDone:true};
 const r=msg.result||{};j.lastSeen=now();j.rewindDiagnostics=r;
 if(!r.ok)return stall(j,'Не удалось надёжно вернуть Facebook-ленту к самому верху; checkpoint не ищется',{rewind:r},'discover');
 j.rewindPending=false;j.rewindVerified=true;j.rewindDoneAt=new Date().toISOString();j.steps=0;j.checkpointScanSteps=0;j.checkpointSeenIds=[];j.note=j.checkpointPending?'Верх подтверждён. Ищу точку продолжения '+j.checkpointPostId+'.':j.runMode==='update'?'Верх подтверждён. Собираю до сохранённой границы '+j.updateStopId+'.':'Верх подтверждён. Начинаю сбор истории группы.';
 if(j.archiveManaged&&!j.archiveRunStarted){j.archiveRunStarted=true;await archiveJob(j,state=>A.begin(state,{runId:j.id,mode:j.runMode,fromRoot:j.runStartsFromRoot}));}
 await setJob(j);await notifyTab(feedId(j));return {ok:true,rewindVerified:true,checkpoint:j.checkpointPostId};
}
async function discovered(msg,sender){
 const j=await getJob();if(!j||j.stage!=='discover'||j.paused||senderRole(j,sender)!=='feed')return {ignored:true};
 if(j.rewindPending)return {ignored:true,rewinding:true,stage:j.stage,discovered:j.discovered};
 const observations=observationsFrom(msg),vh=Math.max(1,Number(msg.viewportHeight)||observations[0]?.viewportHeight||800);
 j.steps+=Math.min(1,Number(msg.step)||0);j.lastSeen=now();let candidateRows=[];
 if(j.liveBoundaryPending){
  j.liveBoundaryScanSteps=(j.liveBoundaryScanSteps||0)+1;
  const boundaryId=String(j.liveBoundaryPostId||j.checkpointPostId||'');
  const cp=observations.find(o=>String(o.post.post_id)===boundaryId&&Number.isFinite(o.top)&&o.top<vh);
  if(!cp){
   const historical=await historyFor(j.group,feedId(j));
   const reached=observations.filter(o=>Number.isFinite(o.top)&&o.top<vh).map(o=>String(o.post.post_id));
   const unknown=reached.filter(id=>id&&!historical.has(id));
   if(unknown.length)return recoverFeedFromCheckpoint(j,'Живая граница исчезла, а впереди появились неизвестные ID — возможен пропуск',{boundaryId,unknown:unknown.slice(0,10)});
   if(j.liveBoundaryScanSteps>=24||msg.exhausted)return recoverFeedFromCheckpoint(j,'Не удалось подтвердить живую границу после deep-прохода',{boundaryId,steps:j.liveBoundaryScanSteps});
   j.note='Пакет '+j.batchNumber+': подтверждаю живую границу '+boundaryId+'; до неё ничего не сохраняю.';
   await setJob(j);return {added:0,updated:0,stage:j.stage,discovered:0,seekingLiveBoundary:true,boundary:boundaryId};
  }
  const top=cp.top;j.liveBoundaryPending=false;j.liveBoundaryFoundAt=new Date().toISOString();j.liveBoundaryFoundTop=top;j.feedStallRecoveries=0;
  candidateRows=observations.filter(o=>Number.isFinite(o.top)&&Number.isFinite(o.bottom)&&o.top>top+4&&o.bottom>0).map(o=>o.post);
 }else if(j.checkpointPending){
  j.checkpointScanSteps=(j.checkpointScanSteps||0)+1;
  const cp=observations.find(o=>String(o.post.post_id)===String(j.checkpointPostId)&&Number.isFinite(o.top)&&Number.isFinite(o.bottom)&&o.bottom>0&&o.top<vh);
  if(!cp){
   rememberCheckpointSeen(j,observations.filter(o=>Number.isFinite(o.top)&&o.top<vh).map(o=>o.post.post_id));
   j.note='Аварийное восстановление: ищу checkpoint '+j.checkpointPostId+'; проходы '+j.checkpointScanSteps+'. До него ничего не сохранено.';
   if(j.steps>=j.options.maxSteps||msg.exhausted)return stall(j,'Checkpoint '+j.checkpointPostId+' не найден после полного лимита проходов',msg.diagnostics,'discover');
   await setJob(j);return {added:0,updated:0,stage:j.stage,discovered:j.discovered,seekingCheckpoint:true,checkpoint:j.checkpointPostId,seenBeforeCheckpoint:j.checkpointSeenIds.length};
  }
  const top=cp.top;rememberCheckpointSeen(j,observations.filter(o=>Number.isFinite(o.top)&&o.top<=top+4).map(o=>o.post.post_id));rememberCheckpointSeen(j,[j.checkpointPostId]);
  j.steps=0;j.checkpointPending=false;j.checkpointFound=true;j.checkpointFoundAt=new Date().toISOString();j.verifiedSeekPostId=j.checkpointPostId;j.checkpointFoundTop=top;j.feedStallRecoveries=0;
  j.historyCount=(await historyFor(j.group,feedId(j))).size; // observed is not archived
  candidateRows=observations.filter(o=>Number.isFinite(o.top)&&Number.isFinite(o.bottom)&&o.top>top+4&&o.bottom>0).map(o=>o.post);
 }else{
  candidateRows=(j.checkpointFound||j.completedBatches>0)
   ? observations.filter(o=>Number.isFinite(o.bottom)&&o.bottom>0).map(o=>o.post)
   : observations.map(o=>o.post);
 }
 if(j.runMode==='update'){
  const anyTarget=observations.find(o=>String(o.post.post_id)===j.updateStopId&&!o.post.is_pinned);
  const target=anyTarget&&Number.isFinite(anyTarget.top)&&Number.isFinite(anyTarget.bottom)&&anyTarget.bottom>0&&anyTarget.top<vh?anyTarget:null;
  candidateRows=candidateRows.filter(p=>String(p.post_id)!==j.updateStopId);
  if(anyTarget&&!target){if(anyTarget.bottom<=0)return stall(j,'Верхняя граница оказалась выше viewport без подтверждённого пересечения',null,'discover');candidateRows=candidateRows.filter(p=>{const o=observations.find(x=>x.post.post_id===p.post_id);return o&&o.top<anyTarget.top;});}
  if(target){
   candidateRows=candidateRows.filter(p=>{const o=observations.find(x=>x.post.post_id===p.post_id);return o&&Number.isFinite(o.top)&&o.top<target.top;});
   if(j.updateBaseline)candidateRows.push(target.post);
   candidateRows.push({_stopBoundary:true,id:j.updateStopId});
  }
 }
 const deferred=j.deferredRows||[];j.deferredRows=[];
 const r=await admitRows(j,deferred.concat(candidateRows));if(r.added){j.obstructionRecoveries=0;j.feedStallRecoveries=0;}
 j.note='Пакет '+j.batchNumber+': разведка '+j.discovered+'/'+j.options.maxPosts+'; завершено пакетов '+j.completedBatches+'; всего принято '+j.sessionPosts+'.';
 if(j.runMode==='update'&&j.updateBoundaryReached&&!j.discovered)return finishUpdate(j);
 if(j.discovered>=j.options.maxPosts||j.runMode==='update'&&j.updateBoundaryReached)await beginDeep(j,j.updateBoundaryReached?'достигнута прежняя верхняя граница':'достигнут размер пакета');
 else if(j.steps>=j.options.maxSteps){
  const probe=await probeFeedState(feedId(j),j.group);
  if(probe.ok&&feedPositionPreserved(j,probe))await stall(j,'Достигнут лимит проходов, но живая feed-страница сохранена; checkpoint recovery не запускаю',{steps:j.steps,feed:probe},'discover');
  else await recoverFeedFromCheckpoint(j,'Достигнут лимит проходов и живая feed-позиция потеряна',{steps:j.steps,feed:probe});
 }
 else await setJob(j);
 const latest=await getJob();return {...r,stage:latest.stage,discovered:latest.discovered,seekingCheckpoint:false,checkpointFound:latest.checkpointFound,checkpoint:latest.checkpointPostId,discoveryTail:latest.discoveryOrder.slice(-3)};
}
async function endDiscovery(msg,sender){
 const j=await getJob();if(!j||j.stage!=='discover'||j.paused||senderRole(j,sender)!=='feed')return j;
 if(j.checkpointPending)return stall(j,'Checkpoint '+j.checkpointPostId+' не подтверждён: '+(msg.reason||'лента остановилась')+'; сбор не начат, удаление поста не доказано',msg.diagnostics,'discover');
 j.feedStallRecoveries=(j.feedStallRecoveries||0)+1;
 if(j.feedStallRecoveries<=8){
  j.resumeCount=(j.resumeCount||0)+1;j.lastSeen=now();j.note='Лента временно не двигается. Автоповтор '+j.feedStallRecoveries+'/8 без потери позиции.';await setJob(j);await notifyTab(feedId(j));return j;
 }
 const probe=await probeFeedState(feedId(j),j.group);
 if(probe.ok&&feedPositionPreserved(j,probe)){
  return stall(j,'Лента не продвигается после 8 автоповторов, но живая feed-страница сохранена; checkpoint recovery не запускаю',{diagnostics:msg.diagnostics,feed:probe},'discover');
 }
 if(j.lastCollectedPostId||j.checkpointPostId)return recoverFeedFromCheckpoint(j,'Лента не продвигается после 8 автоповторов и живая feed-позиция потеряна',{diagnostics:msg.diagnostics,feed:probe});
 return stall(j,msg.reason||'Лента не продвигается',msg.diagnostics,'discover');
}
async function navigateCurrent(j){
 if(j.paused||j.stage!=='deep')return;
 const id=j.queue[j.index];if(!id){await finishBatch(j);return;}
 let tab;try{tab=await ensureDeepTab(j);}catch(e){return stall(j,'Не удалось создать deep-вкладку',{error:safeError(e)},'deep');}
 const url=C.canonicalUrl(j.group,id);
 if(j.redirectPostId!==id){j.redirectPostId=id;j.redirectRecoveries=0;}
 const already=postIdOf(tab.url,j.group)===id;j.navStartedAt=now();j.currentId=id;j.deepPhase=already?'READY':'NAVIGATING';j.note='Пакет '+j.batchNumber+': deep '+(j.index+1)+'/'+j.queue.length+'. Feed-вкладка остаётся на месте.';await setJob(j);
 if(!already)await chrome.tabs.update(j.deepTabId,{url});else {try{await ensureContent(j.deepTabId,j.group);}catch{}await notifyTab(j.deepTabId);}
}
async function recoverDeepRedirect(j,tabUrl){
 if(!j||j.paused||j.stage!=='deep')return false;const id=j.queue[j.index];if(!id)return false;
 if(postIdOf(tabUrl,j.group)===id){j.deepPhase='READY';j.navReadyAt=now();if(j.redirectPostId===id&&j.redirectRecoveries)j.redirectRecoveries=0;await setJob(j);return false;}
 if(j.redirectPostId!==id){j.redirectPostId=id;j.redirectRecoveries=0;}j.redirectRecoveries=(j.redirectRecoveries||0)+1;
 if(j.redirectRecoveries<=3){const url=C.canonicalUrl(j.group,id);j.deepPhase='NAVIGATING';j.navStartedAt=now();j.note='Пакет '+j.batchNumber+': deep '+(j.index+1)+'/'+j.queue.length+'; автовозврат '+j.redirectRecoveries+'/3';await setJob(j);await chrome.tabs.update(j.deepTabId,{url});return true;}
 j.redirectRecoveries=0;return failDeep({id,error:'Facebook 4 раза подряд перенаправил deep-вкладку'},{tab:{id:j.deepTabId,url:tabUrl}});
}
async function deepState(msg,sender,phase){const j=await getJob();if(!j||j.stage!=='deep'||j.paused||senderRole(j,sender)!=='deep')return {ignored:true};const id=j.queue[j.index];if(String(msg.id)!==String(id)||postIdOf(sender.tab?.url,j.group)!==id)return {ignored:true};j.deepPhase=phase;j.lastDeepProgressAt=now();if(phase==='READY')j.navReadyAt=now();await setJob(j);return j;}
async function deepMismatch(msg,sender){const j=await getJob();if(!j||j.stage!=='deep'||j.paused||senderRole(j,sender)!=='deep')return {ignored:true};const id=j.queue[j.index];if(String(msg.id)!==String(id))return {ignored:true};if(j.deepPhase==='NAVIGATING')return {waiting:true,expected:id,actual:msg.actual||null};return recoverDeepRedirect(j,sender.tab?.url||'');}
async function completeDeep(msg,sender){const j=await getJob();if(!j||j.stage!=='deep'||j.paused||senderRole(j,sender)!=='deep')return {ignored:true};const id=j.queue[j.index];if(String(msg.post?.post_id||'')!==String(id)||postIdOf(sender.tab?.url,j.group)!==id)return {ignored:true};const row=C.normalizePost(msg.post,j.group);await putMany([row],j.group);const merged=await getOne(row.key);merged.deep={status:'captured_unverified',at:new Date().toISOString(),visible_comment_count:merged.comments?.length||0,completeness:'unknown_not_all_threads_verified',scrolled:Number(msg.scrolled)||0,expanded:Number(msg.expanded)||0,fallback:msg.fallback||null};await putOne(merged);j.index++;j.deepDone++;j.lastSeen=now();await setJob(j);if(j.index>=j.queue.length)await finishBatch(j);else await navigateCurrent(j);return {ok:true,index:j.index};}
async function failDeep(msg,sender){const j=await getJob();if(!j||j.stage!=='deep'||j.paused||sender?.tab?.id!==deepId(j))return {ignored:true};const id=j.queue[j.index];if(String(msg.id)!==String(id))return {ignored:true};const p=await getOne(keyOf(j.group,id));if(p){p.deep={status:'failed',error:String(msg.error||'unknown').slice(0,240),at:new Date().toISOString(),diagnostics:msg.details||null};await putOne(p);}j.deepErrors++;j.index++;await setJob(j);if(j.index>=j.queue.length)await finishBatch(j);else await navigateCurrent(j);return {ok:true,index:j.index};}
async function openExport(j){const url=chrome.runtime.getURL('export.html')+'?auto=1&batch='+j.batchNumber+'&session='+j.id;let tab=null;if(j.exportTabId){try{tab=await chrome.tabs.get(j.exportTabId);}catch{}}if(tab)await chrome.tabs.update(j.exportTabId,{url,active:false});else{tab=await chrome.tabs.create({url,active:false});if(tab?.id)j.exportTabId=tab.id;}j.exportStartedAt=now();await setJob(j);return j;}
async function finishBatch(j){
 const order=j.discoveryOrder?.length?j.discoveryOrder:j.queue;j.lastCollectedPostId=order.length?String(order[order.length-1]):j.lastCollectedPostId||null;
 // Commit checkpoint only after the JSON download completes.
 j.stage='exporting';j.batchFinishedAt=now();j.note='Пакет '+j.batchNumber+' обработан. Автоматически сохраняю JSON; feed-вкладка не перемещалась.';await setJob(j);await openExport(j);return j;
}
async function exportComplete(msg){
 const j=await getJob();
 if(!j||j.stage!=='exporting'||Number(msg.batchNumber)!==Number(j.batchNumber)||msg.sessionId!==j.id)return {ignored:true};
 if(!Number.isInteger(msg.downloadId)||!chrome.downloads?.search)throw Error('Нет подтверждения скачивания');
 const downloaded=(await chrome.downloads.search({id:msg.downloadId}))[0];
 if(!downloaded||downloaded.state!=='complete'||downloaded.exists===false)throw Error('Скачивание JSON ещё не завершено');
 if(!/^[a-f0-9]{64}$/.test(msg.sha256||''))throw Error('Нет контрольной суммы JSON');
 const order=j.discoveryOrder?.length?j.discoveryOrder:j.queue||[];
 const receipts=(await chrome.storage.local.get(RECEIPT_KEY))[RECEIPT_KEY]||{};
 const key=j.group+'|'+j.id+'|'+j.batchNumber;
 if(receipts[key]&&receipts[key].sha256!==msg.sha256&&!receipts[key].incomplete)throw Error('Контрольная сумма пакета изменилась');
 const previousReceipt=receipts[key]||null;
 receipts[key]={group:j.group,sha256:msg.sha256,downloadId:msg.downloadId,filename:downloaded.filename||msg.filename,retained:true,import_verified:false,incomplete:Boolean(j.deepErrors),ids:order,at:new Date().toISOString(),previous:previousReceipt&&previousReceipt.sha256!==msg.sha256?previousReceipt:null};
 if(j.deepErrors){
  const rows=await allPosts(j.group),failed=new Set(rows.filter(p=>p.deep?.status==='failed').map(p=>String(p.post_id)));
  const retry=order.filter(id=>failed.has(String(id)));
  if(!retry.length)throw Error('Ошибки Deep не согласованы с локальным архивом');
  j.queue=retry;j.index=0;j.deepErrors=0;j.stage='stalled';j.paused=true;
  j.stall={at:new Date().toISOString(),reason:'JSON сохранён, но часть постов требует повторного Deep',resumeStage:'deep'};
  j.note='Неполный JSON сохранён. Checkpoint не сдвинут. Продолжить — повторить '+retry.length+' постов.';j.updatedAt=now();
  await setJob(j,{[RECEIPT_KEY]:receipts});return j;
 }
 const archives=await archiveMap();
 if(j.archiveManaged){
  let state=archives[j.group];if(state?.runs[j.id]?.status==='suspended')state=A.resume(state,j.id);if(!j.archiveRunStarted||!state?.runs[j.id])throw Error('Начало прохода не подтверждено');
  const headCandidate=(j.headCandidates||[]).find(id=>order.includes(id))||null;
  state=A.stage(state,{runId:j.id,batchId:key,ids:order,headCandidate,boundaryReached:j.updateBoundaryReached});
  state=A.acknowledge(state,{runId:j.id,batchId:key,sha256:msg.sha256});
  if(j.paused)state=A.suspend(state,j.id);archives[j.group]=state;j.archiveHead=state.head;j.archiveTail=state.tail;
 }
 const checkpoints=await getCheckpoints();
 if(j.runMode!=='update'&&j.lastCollectedPostId)checkpoints[j.group]={post_id:j.lastCollectedPostId,saved_at:new Date().toISOString(),source_job_id:j.id,batch_number:j.batchNumber,algorithm:CHECKPOINT_ALGORITHM,version:VERSION};
 const allHistory=(await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY]||{};
 allHistory[j.group]=[...new Set([...(allHistory[j.group]||[]),...order])].slice(-HISTORY_LIMIT);
 const count=order.length,boundary=j.lastCollectedPostId,wasPaused=Boolean(j.paused);j.completedBatches++;j.sessionPosts+=count;j.sessionDeepDone+=j.deepDone||0;j.sessionDeepErrors+=j.deepErrors||0;j.lastExport={at:new Date().toISOString(),batchNumber:j.batchNumber,downloadId:msg.downloadId??null,sha256:msg.sha256,filename:msg.filename||null,posts:count,boundary};j.batchNumber++;j.batchStartedAt=now();j.stage='discover';j.paused=wasPaused;j.steps=0;j.discovered=0;j.headCandidates=[];j.feedPinById={};j.deepDone=0;j.deepErrors=0;j.batchDeepTotal=0;j.queue=[];j.index=0;j.discoveryOrder=[];j.checkpointSeenIds=[];j.historyRejected=0;j.feedStallRecoveries=0;j.checkpointPostId=boundary;j.checkpointPending=false;j.checkpointFound=true;j.checkpointSource='live_session';j.liveBoundaryPostId=boundary;j.liveBoundaryPending=false;j.liveBoundaryScanSteps=0;j.resumeCount=(j.resumeCount||0)+1;j.deepPhase=null;j.currentId=null;j.note='Пакет '+(j.batchNumber-1)+' сохранён. '+(wasPaused?'Сессия остаётся на паузе.':'Продолжаю следующий пакет с живой позиции.');j.updatedAt=now();await setJob(j,{[CHECKPOINT_KEY]:checkpoints,[HISTORY_KEY]:allHistory,[RECEIPT_KEY]:receipts,[ARCHIVE_KEY]:archives});historyCache.set(j.group,new Set(allHistory[j.group]));confirmedCache.delete(j.group);if(j.runMode!=='update'&&j.lastCollectedPostId)await setPageCheckpoint(feedId(j),j.group,j.lastCollectedPostId);await setPageHistory(feedId(j),j.group,allHistory[j.group]);if(j.runMode==='update'&&j.updateBoundaryReached&&!j.deferredRows?.length)return finishUpdate(j);
 if(j.deferredRows?.length){const deferred=j.deferredRows;j.deferredRows=[];await admitRows(j,deferred);await setJob(j);if(j.runMode==='update'&&j.updateBoundaryReached&&!j.discovered)return finishUpdate(j);if(j.discovered>=j.options.maxPosts||j.runMode==='update'&&j.updateBoundaryReached){if(wasPaused){j.readyForDeep=true;await setJob(j);}else await beginDeep(j,'сохранённый остаток предыдущего участка');return getJob();}}
 if(!wasPaused)await resumeFeedAtLiveBoundary(j);return getJob();}
async function exportFailed(msg){const j=await getJob();if(!j||j.stage!=='exporting')return {ignored:true};return stall(j,'Не удалось автоматически сохранить JSON-пакет',{batch:j.batchNumber,error:msg.error||null},'exporting');}
let mutex=Promise.resolve();function serial(task){const next=mutex.then(task,task);mutex=next.catch(()=>{});return next;}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{serial(async()=>{
 if(sender.frameId&&sender.frameId!==0)return {ignored:true};
 const exportUrl=chrome.runtime.getURL('export.html'),isExport=sender.url?.split(/[?#]/,1)[0]===exportUrl;
 const j=await getJob();
 if(sender.tab&&!isExport){
  const role=senderRole(j,sender);
  if(msg.type==='status')return role?{...j,tabRole:role}:null;
  if(['discover','rewindResult','endDiscovery'].includes(msg.type)&&role!=='feed')return {ignored:true};
  if(['deepReady','deepExpanding','deepMismatch','deepSnapshot','deepError'].includes(msg.type)&&role!=='deep')return {ignored:true};
  if(msg.type==='obstructed'&&!role)return {ignored:true};
  if(['start','resume','collectFound','pause','resetCheckpoint','archiveStatus'].includes(msg.type))return {ignored:true};
 }
 switch(msg.type){
  case 'start':return start(msg);
  case 'pause':return pause();
  case 'resume':return resume(msg.tabId,msg.url);
  case 'collectFound':return collectFound(msg.tabId,msg.url);
  case 'resetCheckpoint':throw Error('Архив и сохранённые границы не сбрасываются. Выберите режим сбора.');
  case 'status':return j;
  case 'archiveStatus':return archiveFor(msg.group||j?.group);
  case 'rewindResult':return rewindResult(msg,sender);
  case 'discover':return discovered(msg,sender);
  case 'obstructed':return obstructed(msg,sender);
  case 'endDiscovery':return endDiscovery(msg,sender);
  case 'deepReady':return deepState(msg,sender,'READY');
  case 'deepExpanding':return deepState(msg,sender,'EXPANDING');
  case 'deepMismatch':return deepMismatch(msg,sender);
  case 'deepSnapshot':return completeDeep(msg,sender);
  case 'deepError':return failDeep(msg,sender);
  case 'exportSlice':{
   if(!isExport)return {ignored:true};if(!j)return {items:[],job:null,total:0};
   const batchIds=new Set((j.discoveryOrder?.length?j.discoveryOrder:j.queue||[]).map(String));
   const rows=(await allPosts(j.group)).filter(p=>batchIds.has(String(p.post_id))).sort((a,b)=>a.key.localeCompare(b.key)),start=Math.max(0,Number(msg.offset)||0);
   return {job:j,items:rows.slice(start,start+Math.min(100,Number(msg.limit)||100)),total:rows.length};
  }
  case 'exportComplete':if(!isExport)return {ignored:true};return exportComplete(msg);
  case 'exportFailed':if(!isExport)return {ignored:true};return exportFailed(msg);
  default:throw Error('Неизвестный запрос');
 }
}).then(r=>sendResponse({ok:true,result:r})).catch(e=>sendResponse({ok:false,error:safeError(e)}));return true;});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create(ALARM,{periodInMinutes:1}));
chrome.alarms.onAlarm.addListener(async a=>{if(a.name!==ALARM)return;try{const j=await getJob();if(!j||j.paused)return;
 if(j.stage==='deep'&&j.deepPhase==='NAVIGATING'&&now()-(j.navStartedAt||0)>150000){await serial(async()=>{const cur=await getJob();if(cur?.stage==='deep'&&!cur.paused&&cur.deepPhase==='NAVIGATING'&&now()-(cur.navStartedAt||0)>150000)await failDeep({id:cur.queue[cur.index],error:'Таймаут навигации deep >150 сек'},{tab:{id:deepId(cur)}});});}
 if(j.stage==='discover'&&now()-(j.lastSeen||j.startedAt)>180000){await serial(async()=>{const cur=await getJob();if(!cur||cur.stage!=='discover'||cur.paused)return;cur.watchdogRecoveries=(cur.watchdogRecoveries||0)+1;if(cur.watchdogRecoveries<=3){cur.resumeCount=(cur.resumeCount||0)+1;cur.lastSeen=now();cur.note='Feed молчит >180 сек: мягкий wake '+cur.watchdogRecoveries+'/3 без потери позиции.';await setJob(cur);await notifyTab(feedId(cur));return;}await recoverFeedFromCheckpoint(cur,'Feed не отвечает после 3 мягких wake',{watchdog:true});});}
 if(j.stage==='exporting'&&now()-(j.exportStartedAt||0)>120000){await serial(async()=>{const cur=await getJob();if(cur?.stage==='exporting'&&!cur.paused){cur.note='Экспорт не подтвердился за 120 сек — повторяю сохранение того же пакета.';await setJob(cur);await openExport(cur);}});}
}catch(e){console.warn('Bur watchdog',safeError(e));}});
chrome.tabs.onUpdated.addListener((tabId,changeInfo,updatedTab)=>{if(changeInfo.status!=='complete')return;setTimeout(()=>{void serial(async()=>{
 const j=await getJob();if(!j||j.paused)return;const tab=updatedTab?.url?updatedTab:await chrome.tabs.get(tabId);
 if(tabId===deepId(j)&&j.stage==='deep'){if(await recoverDeepRedirect(j,tab.url))return;await notifyTab(tabId);return;}
 if(tabId===feedId(j)&&j.stage==='discover'){if(!isRootFeedUrl(tab.url,j.group)){await recoverFeedFromCheckpoint(j,'Feed-вкладка ушла с корня группы',{url:tab.url});return;}await notifyTab(tabId);}
});},250);});
if(chrome.tabs.onRemoved?.addListener)chrome.tabs.onRemoved.addListener((tabId)=>{void serial(async()=>{const j=await getJob();if(!j)return;if(tabId===j.deepTabId){j.deepTabId=null;await setJob(j);if(j.stage==='deep'&&!j.paused)await navigateCurrent(j);}if(tabId===feedId(j)){
 j.feedTabId=null;j.tabId=null;await setJob(j);
 if(!j.paused&&j.stage==='discover')await recoverFeedFromCheckpoint(j,'Feed-вкладка была закрыта',{tabId});
 else if(!j.paused){
  // Keep the active deep/export phase and its retained batch; replacing the feed
  // document will trigger verified seek only after this batch is durable.
  const replacement=await chrome.tabs.create({url:'https://www.facebook.com/groups/'+encodeURIComponent(j.group)+'/',active:false});
  j.feedTabId=replacement.id;j.tabId=replacement.id;j.feedPageInstance='';await setJob(j);
 }
}if(tabId===j.exportTabId){j.exportTabId=null;await setJob(j);if(j.stage==='exporting'&&!j.paused)await openExport(j);}});});
