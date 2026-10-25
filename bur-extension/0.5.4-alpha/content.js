/* v0.5.3: structured comment threads + collector-owned reply dialogs. */
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
  if(comments.length)temp=C.mergePosts(temp,{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments},job.group);
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
 const blocked=F.obstruction(document,window);
 if(!blocked)return false;
 // Any dialog that contains the selected permalink post is part of the target UI.
 if(job.stage==='deep'&&getPostId()===job.queue?.[job.index]&&F.detailDialog(document,window))return false;
 // Background policy decides recovery: discovery returns to the feed; deep marks
 // only the current post failed and advances. Ordinary UI anomalies never require
 // a human to rescue the whole queue.
 await send('obstructed',{stage:job.stage,diagnostics:{...blocked,phase}});
 return true;
}
async function discover(job){
 if(!isFeed())return;
 if(await handleObstruction(job,'разведка'))return;
 const group=job.group;
 // Bounded, user-visible interactions; no hidden endpoints or request interception.
 const nodes=C.postNodes(document);C.expandVisible(nodes,12,'post');await delay(450);
 if(await handleObstruction(job,'разведка после раскрытия'))return;
 const cards=currentCards(group);const r=await send('discover',{posts:cards,step:1});
 if(!r||r.stage!=='discover')return;
 if(r.added)noNew=0;else noNew++;
 const movement=await F.advance(document,window,delay);
 if(movement.blocked){await send('obstructed',{stage:'discover',diagnostics:movement.blocked});return;}
 await delay(1400); // Facebook often loads the next feed slice asynchronously
 noMove=movement.moved?0:noMove+1;
 if(noNew>=14||noMove>=6){
   await send('endDiscovery',{reason:`Недостаточно данных: без новых ${noNew}, без прокрутки ${noMove}`,
     diagnostics:{noNew,noMove,scroll:movement.tries,visibleCards:cards.length,href:location.pathname}});
 }

}
async function deep(job){
 const expected=job.queue[job.index];if(!expected)return;
 if(await handleObstruction(job,'подробное извлечение'))return;
 const actual=getPostId();
 if(actual&&actual!==expected){await send('deepError',{id:expected,error:'Facebook перенаправил на другую публикацию: '+actual});return;}
 if(!actual){
  if(Date.now()-Number(job.navStartedAt||0)>30000)await send('deepError',{id:expected,error:'За 30 сек не открылась страница выбранной публикации'});
  return;
 }
 try{
  let combined=null,expanded=0,scrolled=0,unchanged=0,supplemental=[];
  const MAX_DETAIL_CYCLES=32;
  for(let i=0;i<MAX_DETAIL_CYCLES;i++){
   const refreshed=await send('status');if(!refreshed||refreshed.paused||refreshed.stage!=='deep'||refreshed.queue[refreshed.index]!==expected)return;
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
   if(supplemental.length)combined=C.mergePosts(combined,{group:job.group,post_id:expected,permalink:C.canonicalUrl(job.group,expected),post_text:'',comments:supplemental},job.group);
   const newComments=(combined?.comments?.length||0)-beforeCount;
   const movement=activeRoot?await F.advanceDetail(document,window,delay):await F.advance(document,window,delay);
   if(movement.blocked){await send('obstructed',{stage:'deep',diagnostics:movement.blocked});return;}
   if(movement.moved)scrolled++;
   unchanged=(newComments>0||newExpansions>0||movement.moved)?0:unchanged+1;
   if(i>=3 && unchanged>=3)break;
   if(i<MAX_DETAIL_CYCLES-1)await delay(850);
  }
  if(!combined||combined.post_id!==expected){await send('deepError',{id:expected,error:'Карточка публикации не обнаружена или не имеет permalink'});return;}
  await send('deepSnapshot',{post:combined,scrolled,expanded});
 }catch(e){try{await send('deepError',{id:expected,error:String(e.message||e)});}catch{}}
}
async function tick(){if(busy)return;busy=true;try{
 const j=await send('status');if(!j||j.paused||j.group!==groupFromURL()||!['discover','deep'].includes(j.stage))return;
 const cycle=j.id+'|'+(j.resumeCount||0);if(lastJobId!==cycle){noNew=0;noMove=0;lastJobId=cycle;}
 if(j.stage==='discover')await discover(j);else await deep(j);
 }catch(e){console.warn('FB Бур (задание сохранено):',String(e.message||e).slice(0,200));}finally{busy=false;}}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(msg?.type==='burPing'){reply({ready:true,version:'0.5.4-alpha',location:location.pathname,obstruction:F.obstruction(document,window),detailPost:Boolean(F.detailDialog(document,window))});return;}if(msg?.type==='burWake')setTimeout(tick,300);});
setTimeout(tick,900);setInterval(tick,2600);
})();
