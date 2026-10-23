'use strict';
const KEY='jr_longrun_config';
const ALARM='jr-longrun-heartbeat';
const DEFAULT={running:false,target:20,started_at:null,updated_at:null,last_pulse:null,status:'stopped',last_error:null};
const get=async()=>({...DEFAULT,...((await chrome.storage.local.get(KEY))[KEY]||{})});
const save=async state=>chrome.storage.local.set({[KEY]:state});
const isFeed=url=>/^https:\/\/www\.facebook\.com\/groups\/374040476267868\/?(?:\?.*)?$/.test(String(url||''));
async function groupTab(){
  const all=await chrome.tabs.query({url:'https://www.facebook.com/groups/374040476267868*'});
  return all.find(t=>isFeed(t.url)&&t.active)||all.find(t=>isFeed(t.url));
}
chrome.alarms.create(ALARM,{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(async a=>{
  if(a.name!==ALARM)return;
  const s=await get();if(!s.running)return;
  const tab=await groupTab();
  if(!tab){s.status='waiting_for_group_tab';s.last_error='Group feed tab not found';s.updated_at=new Date().toISOString();await save(s);return;}
  try{
    const result=await chrome.tabs.sendMessage(tab.id,{type:'heartbeat'});
    s.last_pulse=new Date().toISOString();s.updated_at=s.last_pulse;
    if(result?.ready){s.status=result.running?'running':'idle';s.last_error=null;s.last_stats=result.stats||null;}
    await save(s);
  }catch(e){
    s.status='waiting_for_page';
    s.last_error=String(e);
    s.updated_at=new Date().toISOString();await save(s);
  }
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  (async()=>{
    const s=await get();
    if(message.type==='state')return {ok:true,...s};
    if(message.type==='start'){
      const target=Math.min(50000,Math.max(1,Math.floor(Number(message.target)||20)));
      const tab=await groupTab();
      if(!tab)throw Error('Откройте ленту группы Иерусалим по-русски');
      s.running=true;s.target=target;s.status='starting';s.started_at=new Date().toISOString();
      s.updated_at=s.started_at;s.last_error=null;await save(s);
      try{const response=await chrome.tabs.sendMessage(tab.id,{type:'start',target});
        if(!response?.ok || response?.error)throw Error(response?.error || 'Collector did not acknowledge start');
      }catch(e){s.running=false;s.status='start_failed';s.last_error=String(e);s.updated_at=new Date().toISOString();await save(s);return {error:s.last_error,...s};}
      return {ok:true,...s};
    }
    if(message.type==='stop'){
      s.running=false;s.status='stopped';s.updated_at=new Date().toISOString();await save(s);
      const tab=await groupTab();
      if(tab)try{await chrome.tabs.sendMessage(tab.id,{type:'stop'});}catch{}
      return {ok:true,...s};
    }
    if(message.type==='coreStopped'){
      if(s.running){s.running=false;s.status='paused_by_collector';s.updated_at=new Date().toISOString();await save(s);}
      return {ok:true};
    }
    return {error:'unknown_action'};
  })().then(reply).catch(e=>reply({error:String(e)}));
  return true;
});
