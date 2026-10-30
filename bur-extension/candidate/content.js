/* FB Bur 0.5.28-alpha: feed-order observations + structured comment threads + live page identity. */
(() => {
'use strict';
if(window.__burCollector0524)return;window.__burCollector0524=true;
const C=window.FBBurCore,F=window.BurFeedScroll;let busy=false,noNew=0,noMove=0,lastJobId=null;const PAGE_INSTANCE=String(Math.trunc(Number(globalThis.performance?.timeOrigin)||Date.now()))+'-'+Math.random().toString(36).slice(2);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const groupFromURL=()=>decodeURIComponent(location.pathname.match(/^\/groups\/([^/]+)/)?.[1]||'');
const isFeed=()=>/^\/groups\/[^/]+\/?$/.test(location.pathname);
const getPostId=()=>C.idFromPermalink(location.href,groupFromURL());
async function send(type,extra={}){try{const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error||'Нет ответа');return r.result;}catch(e){throw Error(String(e.message||e));}}
function currentCards(group,opts={}){
 const found=new Map();let nodes=C.postNodes(document,null,opts);
 if(opts.modalRoot){nodes=nodes.filter(n=>opts.modalRoot.contains(n));if(!nodes.length)nodes=[opts.modalRoot];}
 if(!nodes.length){const fallback=C.permalinkPostRoot(document,group,location.href);if(fallback)nodes=[fallback];}
 for(const node of nodes){const row=C.extractCard(node,group,location.href);if(row)found.set(row.key,row);}
 return [...found.values()];
}
function feedObservations(group){
 const found=new Map(),vh=Math.max(1,Number(window.innerHeight)||800);
 for(const node of C.postNodes(document)){
  const row=C.extractCard(node,group,location.href);if(!row?.post_id)continue;
  const rect=node.getBoundingClientRect?.();
  const top=Number.isFinite(rect?.top)?Number(rect.top):null,bottom=Number.isFinite(rect?.bottom)?Number(rect.bottom):null;
  const visible=top!==null&&bottom!==null&&bottom>0&&top<vh;
  const overlap=visible?Math.max(0,Math.min(vh,bottom)-Math.max(0,top)):0;
  const obs={post:row,top,bottom,visible,viewportHeight:vh};
  const prev=found.get(row.key);
  // A post can have nested/duplicate wrappers. Keep the geometry with the largest
  // actual viewport overlap; if neither is visible, keep the one nearest the viewport.
  const distance=visible?0:top===null?1e12:top>=vh?top-vh:Math.max(0,-bottom);
  const prevDistance=prev?prev.visible?0:prev.top===null?1e12:prev.top>=vh?prev.top-vh:Math.max(0,-prev.bottom):1e12;
  if(!prev||prev.post.is_pinned&&!row.is_pinned||Boolean(prev.post.is_pinned)===Boolean(row.is_pinned)&&(overlap>(prev._overlap||0)||(overlap===(prev._overlap||0)&&distance<prevDistance)))found.set(row.key,{...obs,_overlap:overlap});
 }
 return [...found.values()].map(({_overlap,...x})=>x).sort((a,b)=>{
  const at=Number.isFinite(a.top)?a.top:Number.POSITIVE_INFINITY,bt=Number.isFinite(b.top)?b.top:Number.POSITIVE_INFINITY;
  return at-bt||String(a.post.post_id).localeCompare(String(b.post.post_id));
 });
}
function closeOwnedDialog(dialog){
 if(!dialog?.isConnected)return true;
 const controls=[...dialog.querySelectorAll('button,[role="button"]')];
 for(const el of controls){
  const label=C.clean(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||el.textContent||'');
  if(/^(?:Закрыть|Close|סגור|×|x)$/iu.test(label)){try{el.click();return true;}catch{}}
 }
 try{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));}catch{}
 return !dialog.isConnected;
}
async function harvestOwnedCommentDialog(dialog,job,expected){
 let temp=null,unchanged=0,lastSignature='',paused=false,blocked=false,settled=false;
 while(dialog?.isConnected){
  const current=await send('status');
  if(!current||current.id!==job.id||current.paused||current.stage!=='deep'||current.queue?.[current.index]!==expected){paused=true;break;}
  const comments=C.extractVisibleComments(dialog);
  if(comments.length)temp=C.mergePosts(temp,{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments,collector:C.collector},job.group);
  const signature=JSON.stringify((temp?.comments||[]).map(c=>[c.id,c.text,c.text_is_partial,c.parent_id]));
  if(temp){const saved=await send('deepProgress',{id:expected,post:temp,source:'owned_reply_dialog'});if(saved?.paused||saved?.ignored||saved?.stage&&saved.stage!=='deep'){paused=true;break;}}
  const remaining=C.expandVisible([dialog],Number.MAX_SAFE_INTEGER,'deep',true);
  unchanged=signature===lastSignature?unchanged+1:0;lastSignature=signature;
  if(unchanged>=3){blocked=remaining>0;settled=!blocked;break;}
  const clicks=C.expandVisible([dialog],1,'deep');
  await delay(clicks?500:160);
  const movement=await F.advanceDialog(dialog,window,delay);
  if(movement.moved)unchanged=0;
 }
 if(!paused&&!settled)blocked=true;
 closeOwnedDialog(dialog);for(let i=0;i<8&&dialog?.isConnected;i++)await delay(120);
 if(dialog?.isConnected)blocked=true;
 return {comments:temp?.comments||[],paused,blocked};
}
async function handleObstruction(job,phase){
 const deep=job.stage==='deep',expected=deep?job.queue?.[job.index]:null,actual=deep?getPostId():null;
 if(deep&&actual!==expected)return false;
 const target=deep?F.detailDialog(document,window):null;
 const blocked=deep?F.deepObstruction(document,window,target):F.obstruction(document,window,target);
 if(!blocked)return false;
 await send('obstructed',{stage:job.stage,diagnostics:{...blocked,phase,current_url:location.href,target_found:Boolean(target)}});
 return true;
}
// Checkpoint-only scanner. A batch is 10/50 OBSERVED substeps, never a blind jump.
// Persisted worker state is authoritative; no ID ordering or replacement is used.
async function seekCheckpoint(initial){
 let job=initial;
 const S=window.BurCheckpointSeek;
 for(let i=0;i<50;i++){
  job=await send('status');
  if(!job||job.id!==initial.id||job.paused||job.stage!=='discover'||!job.checkpointPending||job.rewindPending)return;
  const order=C.inspectFeedOrder(document);
  if(!job.feedOrder?.verified||job.feedOrder.page_instance!==PAGE_INSTANCE||order.status==='other_order'){await send('feedOrderLost',{pageInstance:PAGE_INSTANCE,feed_order:order});return;}
  if(await handleObstruction(job,'поиск checkpoint'))return;
  const result=await S.step({job,doc:document,view:window,scroll:F,observe:()=>feedObservations(job.group),wait:delay,
   submit:observations=>send('discover',{observations,pageInstance:PAGE_INSTANCE,feed_order:C.inspectFeedOrder(document),step:1,viewportHeight:Math.max(1,Number(window.innerHeight)||800)}),
   stopped:async()=>{const j=await send('status');return !j||j.id!==initial.id||j.paused||j.stage!=='discover'||!j.checkpointPending;}});
  if(result.stop)return;
  if(result.stalled){await send('endDiscovery',{pageInstance:PAGE_INSTANCE,reason:'поиск остановился без подтверждённого продвижения',diagnostics:result.diagnostics});return;}
  if(i+1>=result.batchSize)return;
 }
}
async function discover(job){
 if(!isFeed())return;
 if(await handleObstruction(job,'разведка'))return;
 if(job.rewindPending){
  let result=await F.rewindToTop(document,window,delay);
  if(result.ok){
   const order=await C.ensureNewPosts(document,{wait:delay,stopped:async()=>{const current=await send('status');return !current||current.id!==job.id||current.paused||current.stage!=='discover';}});
   if(order.paused)return;
   if(order.status==='selected_new_posts')result=await F.rewindToTop(document,window,delay);
   result={...result,ok:Boolean(result.ok&&order.verified),feed_order:order};
  }
  await send('rewindResult',{result,pageInstance:PAGE_INSTANCE});
  noNew=0;noMove=0;
  return;
 }
 const order=C.inspectFeedOrder(document);
 if(!job.feedOrder?.verified||job.feedOrder.page_instance!==PAGE_INSTANCE||order.status==='other_order'){
  await send('feedOrderLost',{pageInstance:PAGE_INSTANCE,feed_order:order});return;
 }
 if(job.checkpointPending){await seekCheckpoint(job);return;}
 const group=job.group;
 // Bounded, user-visible interactions; no hidden endpoints or request interception.
 const nodes=C.postNodes(document);C.expandVisible(nodes,12,'post');await delay(450);
 if(await handleObstruction(job,'разведка после раскрытия'))return;
 const observations=feedObservations(group);
 const r=await send('discover',{observations,pageInstance:PAGE_INSTANCE,feed_order:C.inspectFeedOrder(document),step:1,viewportHeight:Math.max(1,Number(window.innerHeight)||800)});
 if(!r||r.stage!=='discover')return;
 if(r.seekingCheckpoint)noNew=0;else if(r.added)noNew=0;else noNew++;
 const movement=await F.advance(document,window,delay);
 if(movement.blocked){await send('obstructed',{stage:'discover',diagnostics:movement.blocked});return;}
 await delay(1400); // Facebook often loads the next feed slice asynchronously
 noMove=movement.moved?0:noMove+1;
 if(noMove===8||noMove===16){await delay(noMove===8?3000:7000);const probe=await F.advance(document,window,delay);if(probe.moved){noMove=0;noNew=0;return;}}
 if(noNew>=36||noMove>=24){
   await send('endDiscovery',{pageInstance:PAGE_INSTANCE,reason:`Недостаточно данных: без новых ${noNew}, без прокрутки ${noMove}`,
     diagnostics:{noNew,noMove,scroll:movement.tries,visibleCards:observations.filter(x=>x.visible).length,totalCards:observations.length,href:location.pathname}});
 }
}
async function deep(job){
 const expected=job.queue[job.index];if(!expected)return;
 const actual=getPostId();
 if(job.deepPhase==='NAVIGATING'){
  if(actual!==expected)return;
  job=await send('deepReady',{id:expected});
  if(!job||job.deepPhase!=='READY')return;
 }else if(actual!==expected){
  await send('deepMismatch',{id:expected,actual:actual||null});
  return;
 }
 if(!actual)return;
 if(!['READY','EXPANDING'].includes(job.deepPhase||'')){
  job=await send('deepReady',{id:expected});
  if(!job||job.deepPhase!=='READY')return;
 }
 if(await handleObstruction(job,'подробное извлечение'))return;
 try{
  job=await send('deepExpanding',{id:expected});
  if(!job||job.deepPhase!=='EXPANDING')return;
  // Exact publication time: Facebook shows it only in the timestamp's hover tooltip.
  let exactDate=null;
  try{const r=await C.hoverExactDate(C.permalinkPostRoot(document,job.group,location.href)||F.detailDialog(document,window),{wait:delay});if(r?.status==='ok')exactDate=r;}catch(_){}
  const withDate=p=>p&&exactDate?{...p,...C.betterDate(p,exactDate)}:p;
  let combined=null,expanded=0,scrolled=0,unchanged=0,supplemental=[],settled=false,commentSort={status:'not_exposed',verified:false};
  const MAX_DETAIL_CYCLES=32;
  for(let i=0;i<MAX_DETAIL_CYCLES;i++){
   const refreshed=await send('status');if(!refreshed||refreshed.paused||refreshed.stage!=='deep'||refreshed.queue[refreshed.index]!==expected||refreshed.deepPhase==='NAVIGATING')return;
   const modalRoot=F.detailDialog(document,window);
   const nodes=C.postNodes(document,null,{includeDialog:Boolean(modalRoot)}).filter(n=>!modalRoot||modalRoot.contains(n));
   const fallback=C.permalinkPostRoot(document,job.group,location.href);
   const sourceNodes=nodes.length?nodes:modalRoot?[modalRoot]:fallback?[fallback]:[];
   if(i===0){
    commentSort=await C.ensureAllComments(modalRoot||sourceNodes[0],{wait:delay,stopped:async()=>{const current=await send('status');return !current||current.id!==job.id||current.paused||current.stage!=='deep'||current.queue?.[current.index]!==expected;}});
    if(commentSort.paused)return;
    if(commentSort.known_incomplete){
     for(const row of currentCards(job.group,{includeDialog:Boolean(modalRoot),modalRoot}).filter(p=>p.post_id===expected))combined=C.mergePosts(combined,row,job.group);
     combined=combined||{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments:[],collector:C.collector};
     await send('deepPassEnd',{id:expected,post:withDate(combined),scrolled,expanded,coverage:{settled:true,known_incomplete:true,comment_sort:commentSort,total_completeness:'unknown'}});return;
    }
   }
   const dialogsBefore=new Set(F.visibleDialogs(document,window).map(x=>x.el));
   // One deep expansion per cycle. This avoids clicking several reply controls before
   // Facebook has finished opening the first thread UI.
   const newExpansions=C.expandVisible(sourceNodes,1,'deep');
   expanded+=newExpansions;
   await delay(i===0?1400:550);
   const ownedThread=F.commentThreadDialog(document,window,dialogsBefore);
   if(ownedThread){
    const extra=await harvestOwnedCommentDialog(ownedThread,job,expected);
    supplemental=supplemental.concat(extra.comments);
    if(extra.paused)return;
    if(extra.blocked){
     const partial=C.mergePosts(combined,{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments:supplemental,collector:C.collector},job.group);
     await send('deepPassEnd',{id:expected,post:withDate(partial),scrolled,expanded,coverage:{settled:true,known_incomplete:true,reason:'owned_reply_dialog_unresolved',total_completeness:'unknown'}});return;
    }
   }
   if(await handleObstruction(job,'подробное извлечение после раскрытия'))return;
   const activeRoot=F.detailDialog(document,window);
   const cards=currentCards(job.group,{includeDialog:Boolean(activeRoot),modalRoot:activeRoot}).filter(p=>p.post_id===expected);
   const beforeCount=combined?.comments?.length||0;
   for(const p of cards)combined=C.mergePosts(combined,p,job.group);
   if(supplemental.length)combined=C.mergePosts(combined,{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments:supplemental,collector:C.collector},job.group);
   const newComments=(combined?.comments?.length||0)-beforeCount;
   if(combined){const progress=await send('deepProgress',{id:expected,post:withDate(combined),cycle:i,scrolled,expanded});if(progress?.paused||progress?.ignored||progress?.stage&&progress.stage!=='deep')return;}
   const movement=activeRoot?await F.advanceDetail(document,window,delay):await F.advance(document,window,delay);
   if(movement.blocked){await send('obstructed',{stage:'deep',diagnostics:{...movement.blocked,phase:'подробное извлечение: прокрутка',current_url:location.href,target_found:Boolean(activeRoot)}});return;}
   if(movement.moved)scrolled++;
   unchanged=(newComments>0||newExpansions>0||movement.moved)?0:unchanged+1;
   if(i>=3 && unchanged>=3){settled=true;break;}
   if(i<MAX_DETAIL_CYCLES-1)await delay(850);
  }
  if(!combined||combined.post_id!==expected){
   combined={group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),
     post_text:'',comments:supplemental,collector:C.collector,
     warning:'Deep DOM card unavailable; preserved discovery record and merged any visible comments.'};
   // Structural-only diagnostics: no post text, author names, URLs or DOM HTML leave the page.
   const diagnostic={
    reason:'permalink_card_unresolved',
    article_count:document.querySelectorAll('[role="article"]').length,
    feed_unit_count:document.querySelectorAll('[data-pagelet^="FeedUnit_"]').length,
    post_body_count:document.querySelectorAll('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]').length,
    detail_dialog_present:Boolean(F.detailDialog(document,window)),
    candidate_count:C.postNodes(document,null,{includeDialog:Boolean(F.detailDialog(document,window))}).length,
    observed_cycles:MAX_DETAIL_CYCLES,scrolled,expanded
   };
   await send('deepSnapshot',{post:withDate(combined),scrolled,expanded,fallback:'url_identity_existing_discovery',coverage:{diagnostic}});
   return;
  }
  const finalModal=F.detailDialog(document,window);
  const finalNodes=C.postNodes(document,null,{includeDialog:Boolean(finalModal)}).filter(n=>(!finalModal||finalModal.contains(n))&&C.extractCard(n,job.group,location.href)?.post_id===expected);
  if(!finalNodes.length){const root=C.permalinkPostRoot(document,job.group,location.href);if(root&&C.extractCard(root,job.group,location.href)?.post_id===expected)finalNodes.push(root);}
  const remaining=C.expandVisible(finalNodes,Number.MAX_SAFE_INTEGER,'deep',true);
  const coverage={settled,remaining_controls:remaining,known_incomplete:remaining>0,comment_sort:commentSort,total_completeness:'unknown'};
  if(!settled||coverage.known_incomplete){await send('deepPassEnd',{id:expected,post:withDate(combined),scrolled,expanded,coverage});return;}
  await send('deepSnapshot',{post:withDate(combined),scrolled,expanded,coverage});
 }catch(e){try{await send('deepError',{id:expected,error:String(e.message||e)});}catch{}}
}
async function tick(){if(busy)return;busy=true;try{
 const j=await send('status');if(!j||j.paused||j.group!==groupFromURL())return;
 const cycle=j.id+'|'+(j.resumeCount||0)+'|'+(j.batchNumber||1);if(lastJobId!==cycle){noNew=0;noMove=0;lastJobId=cycle;}
 if(j.tabRole==='feed'&&j.stage==='discover')await discover(j);
 else if(j.tabRole==='deep'&&j.stage==='deep')await deep(j);
 }catch(e){console.warn('FB Бур (задание сохранено):',String(e.message||e).slice(0,200));}finally{busy=false;}}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(msg?.type==='burPing'){reply({ready:true,version:'0.5.28-alpha',location:location.pathname,href:location.href,pageInstance:PAGE_INSTANCE,scrollY:Number(window.scrollY)||0,obstruction:F.obstruction(document,window),detailPost:Boolean(F.detailDialog(document,window))});return;}
 if(msg?.type==='burCheckpointGet'){const group=groupFromURL();if(!group||msg.group!==group){reply({post_id:null});return;}reply({post_id:localStorage.getItem('fb-bur-checkpoint-v3:'+group)||null});return;}
 if(msg?.type==='burCheckpointSet'){const group=groupFromURL();if(!group||msg.group!==group){reply({ok:false});return;}const key='fb-bur-checkpoint-v3:'+group;if(msg.post_id)localStorage.setItem(key,String(msg.post_id));else localStorage.removeItem(key);reply({ok:true});return;}
 if(msg?.type==='burHistoryGet'){const group=groupFromURL();if(!group||msg.group!==group){reply({ids:[]});return;}try{const raw=JSON.parse(localStorage.getItem('fb-bur-history-v1:'+group)||'[]');reply({ids:Array.isArray(raw)?raw.filter(x=>/^\d{8,30}$/.test(String(x))).slice(-50000):[]});}catch{reply({ids:[]});}return;}
 if(msg?.type==='burHistorySet'){const group=groupFromURL();if(!group||msg.group!==group){reply({ok:false});return;}try{const ids=Array.isArray(msg.ids)?msg.ids.map(String).filter(x=>/^\d{8,30}$/.test(x)).slice(-50000):[];localStorage.setItem('fb-bur-history-v1:'+group,JSON.stringify(ids));reply({ok:true,count:ids.length});}catch{reply({ok:false});}return;}
 if(msg?.type==='burWake'){reply({ready:true});setTimeout(tick,300);return;}
});
setTimeout(tick,900);setInterval(tick,2600);
})();
