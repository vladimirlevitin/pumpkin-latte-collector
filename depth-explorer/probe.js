(() => {
'use strict';
if(window.__depthExplorerProbe?.version==='0.1.2'&&window.__depthExplorerProbe.alive())return;
window.__depthExplorerProbe={version:'0.1.2',alive:()=>{try{return Boolean(chrome.runtime.id);}catch{return false;}}};
const D=window.DepthDOM;let busy=false,sortAttempted=false,menuPending=false,postToken='',idle=0,previous='',lastControl=null,repeats=0;
let pendingReply=null,ownedReplies=[];
async function send(type,data={}){const r=await chrome.runtime.sendMessage({type,page:D.identity(location.href),...data});if(!r?.ok)throw Error(r?.error||'Нет ответа');return r.result;}
async function event(kind,data={}){return send('event',{kind,data});}
async function check(){const error=D.signal();if(error){await send('fault',{error,snapshot:D.snapshot()});return true;}return false;}
async function tick(){if(busy)return;busy=true;let interval=3000;
 try{
  const s=await send('permission');if(!s?.allowed)return;interval=s.config.delay;
  if(await check())return;
  const snap=D.snapshot();await event('observation',snap);
  if(s.role==='feed'){
   const links=D.feedLinks();await send('feed',{links,snapshot:snap});
   const again=await send('permission');if(!again?.allowed||again.phase!=='seek')return;
   const movement=D.scrollOne();await event('feed_scroll',movement);
   const sig=JSON.stringify(links.map(x=>x.id));idle=!movement.moved&&sig===previous?idle+1:0;previous=sig;
   if(idle>=6)await send('halt',{reason:'Лента не меняется после шести попыток. Конец истории не подтверждён.'});
   return;
  }
  const actual=D.identity(location.href);if(actual?.post!==s.current){await send('halt',{reason:'Адрес открытой страницы не совпадает с проверяемым постом.'});return;}
  if(postToken!==s.token){postToken=s.token;idle=0;previous='';sortAttempted=false;menuPending=false;lastControl=null;repeats=0;pendingReply=null;ownedReplies=[];}
  if(pendingReply){const added=D.dialogs().filter(e=>!pendingReply.before.has(e));if(added.length){ownedReplies.push(...added);await event('reply_dialog_opened',{newDialogs:added.length});pendingReply=null;}else if(--pendingReply.cycles<=0)pendingReply=null;}
  if(s.actions>=s.config.clicks||Date.now()-s.postStarted>s.config.minutes*60000){await send('finished',{reason:'Достигнут заданный предел проверки поста',snapshot:snap});return;}
  if(menuPending){
   const all=[...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],button,[role="button"]')].find(e=>D.visible(e)&&/^(?:Все комментарии|All comments)$/iu.test(D.clean(e.innerText||e.textContent)));
   menuPending=false;
   if(all){if(!await send('intent',{action:'select_all_comments',before:snap}))return;all.click();await event('action_dispatched',{action:'select_all_comments'});return;}
   await send('halt',{reason:'Меню сортировки открыто, но пункт «Все комментарии» не найден. Нужно осмотреть страницу.'});return;
  }
  const controls=D.controls();let chosen=controls.find(x=>x.kind==='sort'&&!sortAttempted);
  if(chosen){sortAttempted=true;if(/^(?:Все комментарии|All comments)$/iu.test(chosen.label))chosen=null;}
  if(!chosen)chosen=controls.find(x=>x.kind!=='sort');
  if(chosen){
   const sig=JSON.stringify([snap.commentElements,snap.replyElements,chosen.kind,chosen.label]);repeats=sig===lastControl?repeats+1:0;lastControl=sig;
   if(repeats>=5){await send('halt',{reason:'Пять раскрытий подряд не изменили счётчики обсуждения. Нужен осмотр, полнота не подтверждена.'});return;}
   chosen.e.scrollIntoView({block:'center'});
   if(!await send('intent',{action:chosen.kind,label:chosen.label,before:snap}))return;
   if(chosen.kind==='replies')pendingReply={before:new Set(D.dialogs()),cycles:3};
   chosen.e.click();if(chosen.kind==='sort')menuPending=true;
   await event('action_dispatched',{action:chosen.kind,label:chosen.label});idle=0;return;
  }
  const movement=D.scrollOne();await event('detail_scroll',movement);
  const sig=JSON.stringify([snap.commentElements,snap.replyElements,snap.loading,snap.documentHeight,snap.controls]);
  idle=!movement.moved&&sig===previous&&!snap.loading?idle+1:0;previous=sig;
  if(idle>=6){
   // A separately opened reply dialog must be closed before continuing the post.
   if(ownedReplies.includes(D.root())){const close=[...D.root().querySelectorAll('button,[role="button"]')].find(e=>D.visible(e)&&/^(?:Закрыть|Close|סגור)$/iu.test(D.clean(e.getAttribute('aria-label')||e.innerText)));
    if(close){if(!await send('intent',{action:'close_reply_dialog',before:snap}))return;const closed=D.root();close.click();ownedReplies=ownedReplies.filter(e=>e!==closed&&e.isConnected);idle=0;previous='';return;}
    await send('halt',{reason:'Вложенное обсуждение остановилось; безопасная кнопка закрытия не найдена.'});return;
   }
   if(snap.dialogCount>1){await send('halt',{reason:'Нераспознанное дополнительное окно: нужен осмотр страницы.'});return;}
   if(!snap.postBodies&&!snap.commentElements){await send('halt',{reason:'Не найдены признаки загруженного поста или обсуждения. Успешное открытие не подтверждено.'});return;}
   await send('finished',{reason:'Состояние перестало меняться; полнота комментариев не проверяется',snapshot:snap});
  }
 }catch(e){try{await event('probe_exception',{name:e?.name||'Error'});await send('halt',{reason:'Ошибка диагностического сценария; см. журнал'});}catch{}}
 finally{busy=false;if(window.__depthExplorerProbe.alive())setTimeout(tick,interval);}
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.type==='ping'){reply({ready:true,version:'0.1.2'});return;}});
let observerPending=false;
new MutationObserver(()=>{if(observerPending)return;observerPending=true;setTimeout(async()=>{observerPending=false;try{const s=await send('permission');if(s?.allowed)await check();}catch{}},350);}).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
document.addEventListener('visibilitychange',()=>{void event('visibility',{state:document.visibilityState}).catch(()=>{});});
window.addEventListener('online',()=>{void event('connection',{online:true}).catch(()=>{});});
window.addEventListener('offline',()=>{void event('connection',{online:false}).catch(()=>{});});
window.addEventListener('pagehide',()=>{void event('pagehide').catch(()=>{});});
void event('document_ready',{identity:D.identity(location.href),ready:document.readyState}).catch(()=>{});
setTimeout(tick,1200);
})();
