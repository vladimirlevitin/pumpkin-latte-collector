'use strict';
const KEY='pla_longrun_config';
const isFeed=()=>/^\/groups\/pumpkinlatte\/?$/.test(location.pathname);
const core=()=>globalThis.__PLA_FB_ARCHIVE;
let everStarted=false;
async function launch(target){
  if(!isFeed())return {error:'Open the group feed, not an individual post'};
  const c=core();if(!c?.start)return {error:'Collector is not initialized'};
  const input=document.getElementById('pla-count');
  if(input)input.value=String(Math.min(50000,Math.max(1,Number(target)||5000)));
  if(!c.isRunning?.())c.start();
  everStarted=true;
  return {ok:true,ready:true,running:true};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 (async()=>{
   if(message.type==='start')return launch(message.target);
   if(message.type==='stop'){core()?.stop?.('Остановлено вручную');everStarted=false;return {ok:true};}
   if(message.type==='heartbeat'){
     const c=core();
     return {ready:!!c?.start,running:!!c?.isRunning?.(),version:c?.version||'',stats:c?.stats||null};
   }
   return {error:'unknown_action'};
 })().then(reply).catch(e=>reply({error:String(e)}));
 return true;
});
(async()=>{
  if(!isFeed())return;
  const state=(await chrome.storage.local.get(KEY))[KEY];
  if(state?.running)await launch(state.target);
})();
setInterval(async()=>{
  if(!everStarted)return;
  if(core()?.isRunning?.())return;
  everStarted=false;
  try{await chrome.runtime.sendMessage({type:'coreStopped'});}catch{}
},15000);
