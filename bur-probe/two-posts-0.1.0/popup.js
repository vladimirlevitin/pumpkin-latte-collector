'use strict';
const run=document.getElementById('run'),status=document.getElementById('status');
async function ask(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'Ошибка');return r.result;}
async function refresh(){
 try{
  const s=await ask('probeStatus');
  run.disabled=Boolean(s?.running);
  status.textContent=s?.text||'Готов.';
 }catch(e){status.textContent='Ошибка: '+e.message;}
}
run.onclick=async()=>{
 run.disabled=true;
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  await ask('probeStart',{originTabId:tab?.id||null});
  await refresh();
 }catch(e){status.textContent='Ошибка: '+e.message;run.disabled=false;}
};
refresh();setInterval(refresh,1000);
