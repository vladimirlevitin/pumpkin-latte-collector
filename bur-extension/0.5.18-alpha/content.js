/* FB Bur 0.5.18-alpha: feed-order observations + structured comment threads. */
(() => {
'use strict';
if(window.__burCollector052)return;window.__burCollector052=true;
const C=window.FBBurCore,F=window.BurFeedScroll;let busy=false,noNew=0,noMove=0,lastJobId=null;
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
  if(!prev||overlap>(prev._overlap||0)||(overlap===(prev._overlap||0)&&distance<prevDistance))found.set(row.key,{...obs,_overlap:overlap});
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
 let temp=null,unchanged=0,lastCount=0;
 for(let i=0;i<10&&dialog?.isConnected;i++){
  const comments=C.extractVisibleComments(dialog);
  if(comments.length)temp=C.mergePosts(temp,{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments,collector:C.collector},job.group);
  const count=temp?.comments?.length||0;
  const clicks=C.expandVisible([dialog],4,'deep');
  await delay(clicks?500:160);
  const movement=await F.advanceDialog(dialog,window,delay);
  unchanged=(count>lastCount||clicks>0||movement.moved)?0:unchanged+1;lastCount=count;
  if(unchanged>=2)break;
 }
 closeOwnedDialog(dialog);for(let i=0;i<8&&dialog?.isConnected;i++)await delay(120);
 return temp?.comments||[];
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
async function discover(job){
 if(!isFeed())return;
 if(await handleObstruction(job,'разведка'))return;
 if(job.rewindPending){
  const result=await F.rewindToTop(document,window,delay);
  await send('rewindResult',{result});
  noNew=0;noMove=0;
  return;
 }
 const group=job.group;
 // Bounded, user-visible interactions; no hidden endpoints or request interception.
 const nodes=C.postNodes(document);C.expandVisible(nodes,12,'post');await delay(450);
 if(await handleObstruction(job,'разведка после раскрытия'))return;
 const observations=feedObservations(group);
 const r=await send('discover',{observations,step:1,viewportHeight:Math.max(1,Number(window.innerHeight)||800)});
 if(!r||r.stage!=='discover')return;
 if(r.seekingCheckpoint)noNew=0;else if(r.added)noNew=0;else noNew++;
 const movement=await F.advance(document,window,delay);
 if(movement.blocked){await send('obstructed',{stage:'discover',diagnostics:movement.blocked});return;}
 await delay(1400); // Facebook often loads the next feed slice asynchronously
 noMove=movement.moved?0:noMove+1;
 if(noNew>=14||noMove>=6){
   await send('endDiscovery',{reason:`Недостаточно данных: без новых ${noNew}, без прокрутки ${noMove}`,
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
  let combined=null,expanded=0,scrolled=0,unchanged=0,supplemental=[];
  const MAX_DETAIL_CYCLES=32;
  for(let i=0;i<MAX_DETAIL_CYCLES;i++){
   const refreshed=await send('status');if(!refreshed||refreshed.paused||refreshed.stage!=='deep'||refreshed.queue[refreshed.index]!==expected||refreshed.deepPhase==='NAVIGATING')return;
   const modalRoot=F.detailDialog(document,window);
   const nodes=C.postNodes(document,null,{includeDialog:Boolean(modalRoot)}).filter(n=>!modalRoot||modalRoot.contains(n));
   const fallback=C.permalinkPostRoot(document,job.group,location.href);
   const sourceNodes=nodes.length?nodes:modalRoot?[modalRoot]:fallback?[fallback]:[];
   const dialogsBefore=new Set(F.visibleDialogs(document,window).map(x=>x.el));
   // One deep expansion per cycle. This avoids clicking several reply controls before
   // Facebook has finished opening the first thread UI.
   const newExpansions=C.expandVisible(sourceNodes,1,'deep');
   expanded+=newExpansions;
   await delay(i===0?1400:550);
   const ownedThread=F.commentThreadDialog(document,window,dialogsBefore);
   if(ownedThread){
    const extra=await harvestOwnedCommentDialog(ownedThread,job,expected);
    supplemental=supplemental.concat(extra);
   }
   if(await handleObstruction(job,'подробное извлечение после раскрытия'))return;
   const activeRoot=F.detailDialog(document,window);
   const cards=currentCards(job.group,{includeDialog:Boolean(activeRoot),modalRoot:activeRoot}).filter(p=>p.post_id===expected);
   const beforeCount=combined?.comments?.length||0;
   for(const p of cards)combined=C.mergePosts(combined,p,job.group);
   if(supplemental.length)combined=C.mergePosts(combined,{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments:supplemental,collector:C.collector},job.group);
   const newComments=(combined?.comments?.length||0)-beforeCount;
   const movement=activeRoot?await F.advanceDetail(document,window,delay):await F.advance(document,window,delay);
   if(movement.blocked){await send('obstructed',{stage:'deep',diagnostics:{...movement.blocked,phase:'подробное извлечение: прокрутка',current_url:location.href,target_found:Boolean(activeRoot)}});return;}
   if(movement.moved)scrolled++;
   unchanged=(newComments>0||newExpansions>0||movement.moved)?0:unchanged+1;
   if(i>=3 && unchanged>=3)break;
   if(i<MAX_DETAIL_CYCLES-1)await delay(850);
  }
  if(!combined||combined.post_id!==expected){
   combined={group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),
     post_text:'',comments:supplemental,collector:C.collector,
     warning:'Deep DOM card unavailable; preserved discovery record and merged any visible comments.'};
   await send('deepSnapshot',{post:combined,scrolled,expanded,fallback:'url_identity_existing_discovery'});
   return;
  }
  await send('deepSnapshot',{post:combined,scrolled,expanded});
 }catch(e){try{await send('deepError',{id:expected,error:String(e.message||e)});}catch{}}
}
async function tick(){if(busy)return;busy=true;try{
 const j=await send('status');if(!j||j.paused||j.group!==groupFromURL()||!['discover','deep'].includes(j.stage))return;
 const cycle=j.id+'|'+(j.resumeCount||0);if(lastJobId!==cycle){noNew=0;noMove=0;lastJobId=cycle;}
 if(j.stage==='discover')await discover(j);else await deep(j);
 }catch(e){console.warn('FB Бур (задание сохранено):',String(e.message||e).slice(0,200));}finally{busy=false;}}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(msg?.type==='burPing'){reply({ready:true,version:'0.5.18-alpha',location:location.pathname,obstruction:F.obstruction(document,window),detailPost:Boolean(F.detailDialog(document,window))});return;}
 if(msg?.type==='burCheckpointGet'){const group=groupFromURL();if(!group||msg.group!==group){reply({post_id:null});return;}reply({post_id:localStorage.getItem('fb-bur-checkpoint-v3:'+group)||null});return;}
 if(msg?.type==='burCheckpointSet'){const group=groupFromURL();if(!group||msg.group!==group){reply({ok:false});return;}const key='fb-bur-checkpoint-v3:'+group;if(msg.post_id)localStorage.setItem(key,String(msg.post_id));else localStorage.removeItem(key);reply({ok:true});return;}
 if(msg?.type==='burHistoryGet'){const group=groupFromURL();if(!group||msg.group!==group){reply({ids:[]});return;}try{const raw=JSON.parse(localStorage.getItem('fb-bur-history-v1:'+group)||'[]');reply({ids:Array.isArray(raw)?raw.filter(x=>/^\\d{8,30}$/.test(String(x))).slice(-50000):[]});}catch{reply({ids:[]});}return;}
 if(msg?.type==='burHistorySet'){const group=groupFromURL();if(!group||msg.group!==group){reply({ok:false});return;}try{const ids=Array.isArray(msg.ids)?msg.ids.map(String).filter(x=>/^\\d{8,30}$/.test(x)).slice(-50000):[];localStorage.setItem('fb-bur-history-v1:'+group,JSON.stringify(ids));reply({ok:true,count:ids.length});}catch{reply({ok:false});}return;}
 if(msg?.type==='burWake')setTimeout(tick,300);
});
setTimeout(tick,900);setInterval(tick,2600);
})();
