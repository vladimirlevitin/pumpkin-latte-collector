'use strict';
const $=id=>document.getElementById(id);let selected='',before=Number.MAX_SAFE_INTEGER,loading=false;
async function send(type,data={}){const r=await chrome.runtime.sendMessage({type,...data});if(!r?.ok)throw Error(r?.error||'Нет ответа');return r.result;}
async function tabs(){const all=await chrome.tabs.query({url:'https://www.facebook.com/groups/*'}),hint=new URL(location.href).searchParams.get('tab'),old=$('tab').value;$('tab').replaceChildren();for(const t of all){const o=document.createElement('option');o.value=t.id;const u=new URL(t.url);o.textContent=u.origin+u.pathname;$('tab').append(o);}if(old&&all.some(t=>String(t.id)===old))$('tab').value=old;else if(hint&&all.some(t=>String(t.id)===hint))$('tab').value=hint;}
async function runs(){const list=await send('runs'),old=$('runs').value;$('runs').replaceChildren();for(const r of list){const o=document.createElement('option');o.value=r.id;o.textContent=new Date(r.started).toLocaleString()+' — '+r.group+' — пауза '+r.config.delay/1000+' с';$('runs').append(o);}if(old&&list.some(r=>r.id===old))$('runs').value=old;}
async function update(){if(loading)return;loading=true;try{const s=await send('state');$('status').textContent=s?`${s.running?'Идёт проверка':'Остановлено'}: ${s.reason}\nГруппа: ${s.group}\nПост: ${s.current||'—'}\nПроверено постов: ${s.checked}; шагов ленты: ${s.feedSteps}; действий в посте: ${s.actions||0}\nПопытка: ${s.attempt}; пауза: ${s.config.delay/1000} с\nНачало: ${new Date(s.started).toLocaleString()}`:'Нет прогонов. Выберите вкладку и нажмите «Начать новый прогон».';
 const run=$('runs').value||s?.id;if(!run){$('journal').textContent='Журнал пуст.';return;}if(selected!==run){selected=run;before=Number.MAX_SAFE_INTEGER;}
 const rows=await send('journal',{run,before});$('count').textContent=`события ${rows[0]?.id||0}–${rows.at(-1)?.id||0}`;
 $('journal').textContent=rows.map(x=>`${x.id} ${x.time} ${x.kind}\n${JSON.stringify(x.data)}`).join('\n\n');$('older').disabled=!rows.length;$('older').dataset.before=rows[0]?.id||'';
 }catch(e){$('status').textContent=e.message;}finally{loading=false;}}
async function command(type,data={}){try{await send(type,data);if(type==='start'){await runs();$('runs').selectedIndex=0;before=Number.MAX_SAFE_INTEGER;}await update();}catch(e){$('status').textContent=e.message;}}
$('refresh').onclick=()=>void tabs();$('start').onclick=()=>void command('start',{tab:$('tab').value,mode:$('mode').value,delay:$('delay').value,posts:$('posts').value,clicks:$('clicks').value,minutes:$('minutes').value});
for(const type of ['pause','resume','retry'])$(type).onclick=()=>void command(type);
$('runs').onchange=()=>{before=Number.MAX_SAFE_INTEGER;selected=$('runs').value;void update();};$('older').onclick=()=>{before=Number($('older').dataset.before);void update();};
void (async()=>{await tabs();await runs();await update();setInterval(update,2500);})();
