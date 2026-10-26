'use strict';
const VERSION='0.1.0';
const GROUP='backpackIL';
const TARGETS=[
 {id:'1761943778250990',label:'Daria Afonin Zolotina — Safe Haven for Donkeys'},
 {id:'1763939851384716',label:'Yevgeny Frenkel — Ориониды'}
];
const SAMPLE_DELAYS=[700,1200,2500];
const KEY='fbBurProbeState-v010';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const urlFor=id=>'https://www.facebook.com/groups/'+GROUP+'/posts/'+id+'/';
let running=false;

async function setState(patch){
 const old=(await chrome.storage.local.get(KEY))[KEY]||{};
 const next={...old,...patch,version:VERSION,updated_at:new Date().toISOString()};
 await chrome.storage.local.set({[KEY]:next});
 return next;
}
async function getState(){return (await chrome.storage.local.get(KEY))[KEY]||{running:false,text:'Готов.',version:VERSION};}

function waitForComplete(tabId,timeoutMs=45000){
 return new Promise(async(resolve,reject)=>{
  let done=false;
  const finish=(err,tab)=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);err?reject(err):resolve(tab);};
  const listener=(id,info,tab)=>{if(id===tabId&&info.status==='complete')finish(null,tab);};
  chrome.tabs.onUpdated.addListener(listener);
  const timer=setTimeout(()=>finish(Error('Таймаут загрузки Facebook >45 сек')),timeoutMs);
  try{const tab=await chrome.tabs.get(tabId);if(tab.status==='complete')finish(null,tab);}catch(e){finish(e);}
 });
}
async function navigate(tabId,url){
 const pending=waitForComplete(tabId);
 await chrome.tabs.update(tabId,{url,active:true});
 return pending;
}
async function snapshot(tabId,expectedId){
 await chrome.scripting.executeScript({target:{tabId},func:id=>{globalThis.__FB_BUR_PROBE_EXPECTED__=id;},args:[expectedId]});
 await chrome.scripting.executeScript({target:{tabId},files:['feed-scroll.js','probe-page.js']});
 const r=await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.__FB_BUR_PROBE_RESULT__||null});
 return r?.[0]?.result||null;
}
async function downloadJson(payload){
 const name='fb-bur-probe-2posts-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
 const data='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(payload,null,2));
 const id=await chrome.downloads.download({url:data,filename:name,saveAs:false,conflictAction:'uniquify'});
 return {download_id:id,filename:name};
}
async function runProbe(originTabId){
 if(running)throw Error('Проверка уже идёт');
 running=true;
 let probeTab=null;
 const started=new Date().toISOString(),results=[];
 try{
  await setState({running:true,text:'Запускаю диагностическую вкладку…',started_at:started,finished_at:null,error:null});
  probeTab=await chrome.tabs.create({url:'about:blank',active:true});
  for(let ti=0;ti<TARGETS.length;ti++){
   const target=TARGETS[ti];
   await setState({running:true,text:`Пост ${ti+1}/2
${target.label}
Загружаю…`});
   let navigation=null;
   try{
    const tab=await navigate(probeTab.id,urlFor(target.id));
    navigation={ok:true,url:tab.url||null};
   }catch(e){navigation={ok:false,error:String(e?.message||e)};}
   const samples=[];
   for(let si=0;si<SAMPLE_DELAYS.length;si++){
    await setState({running:true,text:`Пост ${ti+1}/2
${target.label}
Снимок ${si+1}/3…`});
    await sleep(SAMPLE_DELAYS[si]);
    try{samples.push({sample:si+1,wait_ms:SAMPLE_DELAYS.slice(0,si+1).reduce((a,b)=>a+b,0),data:await snapshot(probeTab.id,target.id)});}
    catch(e){samples.push({sample:si+1,error:String(e?.message||e)});}
   }
   results.push({...target,requested_url:urlFor(target.id),navigation,samples});
  }
  const payload={
   probe:'fb-bur-probe-two-posts',
   probe_version:VERSION,
   algorithm_snapshot:'FB Bur 0.5.13-alpha feed-scroll.js',
   group:GROUP,
   started_at:started,
   finished_at:new Date().toISOString(),
   purpose:'Диагностика двух воспроизводимых deep-obstruction ошибок. Не сбор архива.',
   targets:results
  };
  const dl=await downloadJson(payload);
  await setState({running:false,text:'Готово.
Диагностический JSON скачан автоматически.',finished_at:payload.finished_at,last_download:dl,error:null});
 }catch(e){
  await setState({running:false,text:'Ошибка щупа: '+String(e?.message||e),finished_at:new Date().toISOString(),error:String(e?.stack||e)});
 }finally{
  running=false;
  if(probeTab?.id){try{await chrome.tabs.remove(probeTab.id);}catch{}}
  if(originTabId){try{await chrome.tabs.update(originTabId,{active:true});}catch{}}
 }
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 (async()=>{
  if(msg?.type==='probeStatus')return getState();
  if(msg?.type==='probeStart'){void runProbe(msg.originTabId||null);return {started:true};}
  throw Error('Неизвестный запрос');
 })().then(x=>reply({ok:true,result:x})).catch(e=>reply({ok:false,error:String(e?.message||e)}));
 return true;
});
