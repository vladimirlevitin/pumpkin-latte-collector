'use strict';
const GROUP='374040476267868', KEY='jr_enrichment_v010_state', WATCH='jr_enrichment_watchdog', NEXT='jr_enrichment_next';
const fresh=()=>({running:false,queue:[],current:null,tab_id:null,source:null,log:[]});
const url=id=>'https://www.facebook.com/groups/'+GROUP+'/posts/'+id+'/';
const now=()=>new Date().toISOString();
async function get(){return(await chrome.storage.local.get(KEY))[KEY]||fresh()}
async function put(s){await chrome.storage.local.set({[KEY]:s})}
function log(s,id,status,detail=''){s.log.push({at:now(),id,status,detail});s.log=s.log.slice(-150)}
function later(){chrome.alarms.create(NEXT,{when:Date.now()+5000})}
async function next(s){
 if(!s.running||s.current)return;
 const j=s.queue.find(x=>x.status==='pending');
 if(!j){s.running=false;log(s,null,'complete','Queue finished');await put(s);return}
 j.status='processing';j.started_at=now();j.ready_at=null;j.attempts=(j.attempts||0)+1;s.current=j.id;await put(s);
 try{
  let t=null;if(s.tab_id){try{t=await chrome.tabs.get(s.tab_id)}catch{}}
  if(t)await chrome.tabs.update(t.id,{url:url(j.id),active:true});
  else{t=await chrome.tabs.create({url:url(j.id),active:true});s.tab_id=t.id;await put(s)}
 }catch(e){j.status='failed';j.error=String(e);j.finished_at=now();s.current=null;log(s,j.id,'failed',j.error);await put(s);later()}
}
async function finish(s,j,status,error='',count=null){
 j.status=status;j.error=error;j.finished_at=now();
 if(Number.isInteger(count)&&count>=0)j.new_comment_count=count;
 log(s,j.id,status,error);s.current=null;await put(s);if(s.running)later();
}
async function watchdog(){
 const s=await get();if(!s.running||!s.current)return;
 const j=s.queue.find(x=>x.id===s.current);if(!j){s.current=null;await put(s);later();return}
 const t=Date.parse(j.ready_at||j.started_at||'');if(!Number.isFinite(t))return;
 if(Date.now()-t>(j.ready_at?480000:105000))await finish(s,j,'failed',j.ready_at?'collection_timeout':'navigation_timeout');
}
chrome.alarms.create(WATCH,{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===NEXT)get().then(next).catch(()=>{});if(a.name===WATCH)watchdog().catch(()=>{})});
chrome.tabs.onRemoved.addListener(async id=>{const s=await get();if(s.tab_id!==id)return;s.tab_id=null;if(s.running){s.running=false;log(s,s.current,'paused','Working tab closed')}await put(s)});
chrome.tabs.onUpdated.addListener(async(id,change)=>{
 if(!change.url)return;const s=await get();if(!s.running||!s.current||s.tab_id!==id)return;
 let u;try{u=new URL(change.url)}catch{return}
 const j=s.queue.find(x=>x.id===s.current);if(!j)return;
 if(u.hostname!=='facebook.com'&&u.hostname!=='www.facebook.com'){s.running=false;log(s,j.id,'paused','Unexpected host');await put(s);return}
 if(u.pathname==='/groups/'+GROUP||u.pathname==='/groups/'+GROUP+'/'){await finish(s,j,'unavailable','Redirect to group feed');return}
 if(/\/login|\/checkpoint|\/recover|\/two_factor/.test(u.pathname)){s.running=false;log(s,j.id,'paused','Facebook login/checkpoint');await put(s)}
});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 (async()=>{
 const s=await get();
 if(m.type==='state')return s;
 if(m.type==='load'){
  if(s.running||s.current)throw Error('Остановите текущую серию перед загрузкой новой');
  if(!Array.isArray(m.items)||m.items.length<1||m.items.length>50)throw Error('От 1 до 50 постов');
  const used=new Set(),nextState=fresh();nextState.source=String(m.source||'').slice(0,160);
  nextState.queue=m.items.map(x=>{const id=String(x.id||'');if(!/^\d+$/.test(id)||used.has(id))throw Error('Неверный или повторный ID');used.add(id);return{id,status:'pending',old_comment_count:Math.max(0,Number(x.old_comment_count)||0),new_comment_count:null,attempts:0,error:null}});
  log(nextState,null,'loaded',nextState.queue.length+' posts');await put(nextState);return{ok:true};
 }
 if(m.type==='start'){
  if(!s.queue.length)throw Error('Сначала выберите JSON и загрузите очередь');
  if(s.running)return{ok:true};s.running=true;log(s,s.current,'started');await put(s);if(!s.current)await next(s);return{ok:true};
 }
 if(m.type==='stop'){s.running=false;log(s,s.current,'paused','Finish current post before pause');await put(s);return{ok:true}}
 if(m.type==='ready'){
  if(!sender.tab||!s.running||!s.current||s.tab_id!==sender.tab.id||m.id!==s.current||sender.tab.url?.split('?')[0]!==url(s.current))return{run:false};
  const j=s.queue.find(x=>x.id===s.current);if(!j||j.status!=='processing')return{run:false};
  j.ready_at=now();await put(s);return{run:true,id:s.current};
 }
 if(m.type==='result'){
  if(!sender.tab||s.tab_id!==sender.tab.id||s.current!==m.id)return{ok:false};
  const j=s.queue.find(x=>x.id===s.current);if(!j)return{ok:false};
  const status=['enriched','partial','skipped_guard','unavailable','failed'].includes(m.status)?m.status:'failed';
  await finish(s,j,status,String(m.error||'').slice(0,450),Number.isInteger(m.comments)?m.comments:null);return{ok:true};
 }
 throw Error('Unknown action');
 })().then(reply).catch(e=>reply({error:String(e)}));return true;
});
