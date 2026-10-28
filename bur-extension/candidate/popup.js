'use strict';const $=id=>document.getElementById(id);let tab=null;
$('version').textContent='v'+(chrome.runtime.getManifest().version_name||chrome.runtime.getManifest().version);
async function ask(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'Ошибка');return r.result;}
function state(j){if(!j)return 'Нет задания. Откройте ленту группы Facebook и нажмите «Начать».';
 const stage=({discover:'Разведка',deep:'Подробное извлечение',exporting:'Сохранение пакета',stalled:'Требуется вмешательство',done:'Завершено'})[j.stage]||j.stage;
 return `Группа: ${j.group}\nРежим: ${j.runMode==='update'?'Новые публикации':'История группы'}\nВерхняя граница: ${j.archiveHead||'ещё не установлена'}\nИсторический хвост: ${j.archiveTail||'ещё не установлен'}\nЭтап: ${stage}${j.paused?' · пауза':''}\nПакет: ${j.batchNumber||1} · завершено: ${j.completedBatches||0} · всего: ${j.sessionPosts||0}\n${j.checkpointPostId?`Граница: ${j.checkpointPostId}${j.checkpointPending?' · аварийный поиск':''}`:''}\nТекущий пакет: ${j.discovered} из ${j.options?.maxPosts||'?'} · шагов: ${j.steps}\nDeep: ${j.deepDone}/${j.batchDeepTotal??j.queue?.length??0} · ошибок: ${j.deepErrors||0}\n${j.note||''}`;
}
async function refresh(){try{$('status').textContent=state(await ask('status'));}catch(e){$('status').textContent='Ошибка: '+e.message;}}
function groupOf(url){try{return decodeURIComponent(new URL(url).pathname.match(/^\/groups\/([^/]+)/)?.[1]||'')||null;}catch{return null;}}
async function activeTab(){const t=(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!t?.id)throw Error('Откройте вкладку Facebook-группы');return t;}
async function op(button,fn){button.disabled=true;try{await fn();await refresh();}catch(e){$('status').textContent='Ошибка: '+e.message;}finally{button.disabled=false;}}
$('start').onclick=()=>op($('start'),async()=>{
 tab=await activeTab();const j=await ask('status'),group=groupOf(tab.url),mode=$('mode').value,startAfter=$('startAfter').value.trim();
 const same=j&&j.group===group&&(j.runMode||'history')===mode;
 if(j&&j.stage!=='done'&&same&&(j.feedTabId??j.tabId)===tab.id&&!startAfter){await ask('resume',{tabId:tab.id,url:tab.url});return;}
 if(j&&j.stage!=='done'&&!j.paused)throw Error('Сначала поставьте текущий сбор на паузу');
 await ask('start',{tabId:tab.id,url:tab.url,mode,replacePaused:Boolean(j?.paused),startAfter,options:{maxPosts:Number($('maxPosts').value)}});
});
$('pause').onclick=()=>op($('pause'),()=>ask('pause'));
$('collect').onclick=()=>op($('collect'),async()=>{tab=await activeTab();await ask('collectFound',{tabId:tab.id,url:tab.url});});
$('export').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('export.html')});
$('refresh').onclick=refresh;
refresh();setInterval(refresh,3500);
