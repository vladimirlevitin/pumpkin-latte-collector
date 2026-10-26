'use strict';const $=id=>document.getElementById(id);let tab=null;
$('version').textContent='v'+(chrome.runtime.getManifest().version_name||chrome.runtime.getManifest().version);
async function ask(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'Ошибка');return r.result;}
function state(j){if(!j)return 'Нет задания. Откройте ленту группы Facebook и нажмите «Начать».';
 const stage=({discover:'Разведка',deep:'Подробное извлечение',stalled:'Требуется вмешательство',done:'Завершено'})[j.stage]||j.stage;
 return `Группа: ${j.group}\nЭтап: ${stage}${j.paused?' · пауза':''}${j.checkpointPostId?`\nПродолжение после: ${j.checkpointPostId}${j.checkpointPending?' · ищу':''}`:''}\nПубликации: ${j.discovered} из ${j.options?.maxPosts||'?'} · шагов: ${j.steps}\nУспешно: ${j.deepDone}/${j.queue?.length||0} · ошибок: ${j.deepErrors||0}\n${j.note||''}`;
}
async function refresh(){try{$('status').textContent=state(await ask('status'));}catch(e){$('status').textContent='Ошибка: '+e.message;}}
function groupOf(url){try{return decodeURIComponent(new URL(url).pathname.match(/^\/groups\/([^/]+)/)?.[1]||'')||null;}catch{return null;}}
async function activeTab(){const t=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!t?.id)throw Error('Откройте вкладку Facebook-группы');return t;}
async function op(button,fn){button.disabled=true;try{await fn();await refresh();}catch(e){$('status').textContent='Ошибка: '+e.message;}finally{button.disabled=false;}}
$('start').onclick=()=>op($('start'),async()=>{tab=await activeTab();const j=await ask('status'),g=groupOf(tab.url);if(j&&j.stage!=='done'){if(j.tabId===tab.id&&j.group===g)await ask('resume',{tabId:tab.id,url:tab.url});else if(j.paused)await ask('start',{tabId:tab.id,url:tab.url,replacePaused:true,options:{maxPosts:Number($('maxPosts').value)}});else throw Error('Сейчас идёт сбор группы '+j.group+'. Сначала нажмите «Пауза», затем откройте нужную группу и снова нажмите «Начать / продолжить».');}else await ask('start',{tabId:tab.id,url:tab.url,options:{maxPosts:Number($('maxPosts').value)}});});
$('pause').onclick=()=>op($('pause'),()=>ask('pause'));
$('resetCheckpoint').onclick=()=>op($('resetCheckpoint'),async()=>{tab=await activeTab();const g=groupOf(tab.url);if(!g)throw Error('Откройте ленту Facebook-группы');await ask('resetCheckpoint',{group:g});});
$('collect').onclick=()=>op($('collect'),async()=>{tab=await activeTab();await ask('collectFound',{tabId:tab.id,url:tab.url});});
$('export').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('export.html')});
$('refresh').onclick=refresh;
refresh();setInterval(refresh,3500);
