'use strict';
const $=id=>document.getElementById(id);
async function refresh(){
  try{
    const r=await chrome.runtime.sendMessage({type:'state'});
    if(r?.error)throw Error(r.error);
    if(document.activeElement!==$('target'))$('target').value=r.target||20;
    $('status').textContent='Состояние: '+(r.status||'unknown')+
      '\nАктивен: '+(r.running?'да':'нет')+
      '\nНачало: '+(r.started_at||'—')+
      '\nПоследний сигнал: '+(r.last_pulse||'—')+
      (r.last_error?'\nПроблема: '+r.last_error:'')+
      (r.last_stats?'\nНовых постов: '+r.last_stats.posts_new+'\nКомментариев: '+r.last_stats.comments_seen+'\nОшибок: '+r.last_stats.errors:'');
  }catch(e){$('status').textContent='Ошибка: '+e;}
}
$('start').onclick=async()=>{const r=await chrome.runtime.sendMessage({type:'start',target:Number($('target').value)});if(r?.error)alert(r.error);await refresh();};
$('stop').onclick=async()=>{const r=await chrome.runtime.sendMessage({type:'stop'});if(r?.error)alert(r.error);await refresh();};
refresh();setInterval(refresh,2500);
