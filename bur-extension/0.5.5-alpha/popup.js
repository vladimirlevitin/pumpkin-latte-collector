'use strict';const $=id=>document.getElementById(id);let tab=null;
$('version').textContent='v'+(chrome.runtime.getManifest().version_name||chrome.runtime.getManifest().version);
async function ask(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'Ошибка');return r.result;}
function state(j){if(!j)return 'Нет задания. Откройте ленту группы Facebook и нажмите «Начать».';
 const stage=({discover:'Разведка',deep:'Подробное извлечение',stalled:'Требуется вмешательство',done:'Завершено'})[j.stage]||j.stage;
 return `Группа: ${j.group}\nЭтап: ${stage}${j.paused?' · пауза':''}\nПубликации: ${j.discovered} из ${j.options?.maxPosts||'?'} · шагов: ${j.steps}\nУспешно: ${j.deepDone}/${j.queue?.length||0} · ошибок: ${j.deepErrors||0}\n${j.note||''}`;
}
async function refresh(){try{$('status').textContent=state(await ask('status'));}catch(e){$('status').textContent='Ошибка: '+e.message;}}
async function activeTab(){const t=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!t?.id)throw Error('Откройте вкладку Facebook-группы');return t;}
async function op(button,fn){button.disabled=true;try{await fn();await refresh();}catch(e){$('status').textContent='Ошибка: '+e.message;}finally{button.disabled=false;}}
$('start').onclick=()=>op($('start'),async()=>{tab=await activeTab();const j=await ask('status');if(j&&j.stage!=='done')await ask('resume',{tabId:tab.id,url:tab.url});else await ask('start',{tabId:tab.id,url:tab.url,options:{maxPosts:Number($('maxPosts').value)}});});
$('pause').onclick=()=>op($('pause'),()=>ask('pause'));
$('collect').onclick=()=>op($('collect'),async()=>{tab=await activeTab();await ask('collectFound',{tabId:tab.id,url:tab.url});});
$('export').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('export.html')});
$('refresh').onclick=refresh;
refresh();setInterval(refresh,3500);
