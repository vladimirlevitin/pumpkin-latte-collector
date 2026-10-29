module.exports=function(){
'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),posts=new Map(),storage={},pageCheckpoints={},pageHistories={};
const tabs=new Map([[5,{id:5,url:'https://www.facebook.com/groups/backpackIL/',active:true}],[6,{id:6,url:'https://www.facebook.com/groups/pumpkinlatte/',active:false}]]);
let nextTabId=7,sendListener,alarmListener,tabUpdatedListener,tabRemovedListener,injections=0,reloads=0,connected=false,requests=0,feedPageInstance='feed-doc-1',feedScrollY=12000;
function request(tx,run){const r={};tx.pending++;setImmediate(()=>{try{r.result=run();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();tx.onerror?.();}finally{tx.pending--;tx.completed();}});return r;}
class TX{constructor(){this.pending=0;this.complete=false;}completed(){if(!this.pending&&!this.complete)setImmediate(()=>{if(!this.pending&&!this.complete){this.complete=true;this.oncomplete?.();}});}objectStore(){return{get:key=>request(this,()=>posts.get(key)),put:o=>request(this,()=>posts.set(o.key,structuredClone(o))),delete:k=>request(this,()=>posts.delete(k)),index:()=>({getAll:r=>request(this,()=>[...posts.values()].filter(p=>p.group===r.group)),openKeyCursor:r=>{let keys=[...posts.values()].filter(p=>p.group===r.group).map(p=>p.key),ix=0,out={};const step=()=>{if(ix>=keys.length){out.result=null;out.onsuccess?.();return;}out.result={primaryKey:keys[ix++],continue:()=>setImmediate(step)};out.onsuccess?.();};this.pending++;setImmediate(()=>{step();this.pending--;this.completed();});return out;}})};}}
class DB{constructor(){this.objectStoreNames={contains:()=>true};}transaction(){return new TX();}close(){}createObjectStore(){return{createIndex(){}};}}
const indexedDB={open:()=>{const r={result:new DB()};setImmediate(()=>{r.onupgradeneeded?.();r.onsuccess?.();});return r;}},IDBKeyRange={only:group=>({group})};
let downloadState='complete',failCommit=false;
const chrome={downloads:{search:async({id})=>[{id,state:downloadState,exists:true,filename:'batch.json'}]},runtime:{onMessage:{addListener:cb=>sendListener=cb},onInstalled:{addListener(){}},getURL:s=>'chrome-extension://test/'+s},storage:{local:{get:async k=>structuredClone({[k]:storage[k]}),set:async o=>{if(failCommit&&o['burCollectorExportReceipts-v1']&&o['burCollectorArchives-v1']){failCommit=false;throw Error('fixture storage failure');}return Object.assign(storage,structuredClone(o));}}},tabs:{
 get:async id=>{if(!tabs.has(id))throw Error('tab missing '+id);return tabs.get(id);},
 update:async(id,data)=>{const t=await chrome.tabs.get(id);Object.assign(t,data);return t;},
 create:async data=>{const t={id:nextTabId++,url:data.url||'about:blank',active:Boolean(data.active)};tabs.set(t.id,t);return t;},
 reload:async id=>{await chrome.tabs.get(id);reloads++;return tabs.get(id);},
 sendMessage:async(id,msg)=>{const t=await chrome.tabs.get(id);if(!connected)throw Error('no receiver');if(msg.type==='burPing')return {ready:true,version:'0.5.23-alpha',location:new URL(t.url).pathname,pageInstance:feedPageInstance,scrollY:feedScrollY,obstruction:null,detailPost:/\/posts\//.test(t.url)};if(msg.type==='burCheckpointGet')return {post_id:pageCheckpoints[msg.group]||null};if(msg.type==='burCheckpointSet'){if(msg.post_id)pageCheckpoints[msg.group]=String(msg.post_id);else delete pageCheckpoints[msg.group];return {ok:true};}if(msg.type==='burHistoryGet')return {ids:pageHistories[msg.group]||[]};if(msg.type==='burHistorySet'){pageHistories[msg.group]=Array.isArray(msg.ids)?msg.ids.map(String):[];return {ok:true};}return {ready:true};},
 onUpdated:{addListener:cb=>tabUpdatedListener=cb},onRemoved:{addListener:cb=>tabRemovedListener=cb}
},scripting:{executeScript:async()=>{injections++;connected=true;}},alarms:{create(){},onAlarm:{addListener:cb=>alarmListener=cb}}};
function spawn(){const context={chrome,indexedDB,IDBKeyRange,URL,console,setTimeout,clearTimeout,Date,structuredClone,fetch:()=>{requests++;throw Error('MUST NOT call model or API')}};context.globalThis=context;const ctx=vm.createContext(context);context.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});};vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx,{filename:'background.js'});}
function extCall(type,msg={},sender={}){if(['discover','rewindResult','endDiscovery','feedOrderLost'].includes(type)&&!Object.hasOwn(msg,'pageInstance'))msg={...msg,pageInstance:feedPageInstance};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout '+type)),8000);sendListener({type,...msg},sender,r=>{clearTimeout(timer);r.ok?resolve(r.result):reject(Error(r.error));});});}
function feedSender(){return {tab:{...tabs.get(5)},frameId:0};}
function deepSender(j){return {tab:{...tabs.get(j.deepTabId)},frameId:0};}
function exportSender(){return {url:'chrome-extension://test/export.html?auto=1',tab:{id:90,url:'chrome-extension://test/export.html?auto=1'}};}
function makePost(i){const id=String(1700000000000000+i);return {group:'backpackIL',post_id:id,permalink:'https://www.facebook.com/groups/backpackIL/posts/'+id+'/',post_text:'Post '+i,comments:[]};}
function obs(p,top){return {post:p,top,bottom:top+80,visible:top+80>0&&top<800,viewportHeight:800};}
async function deepAll(){let j=await extCall('status');while(j.stage==='deep'){const id=j.queue[j.index],p={...makePost(Number(id)-1700000000000000),group:j.group,permalink:'https://www.facebook.com/groups/'+j.group+'/posts/'+id+'/'};await extCall('deepSnapshot',{post:{...p,comments:[{id:'c'+id,text:'comment',author:'A'}]},expanded:1,scrolled:1},deepSender(j));j=await extCall('status');}}

async function rewind(tab=5){return extCall('rewindResult',{result:{ok:true,feed_order:{verified:true,order:'new_posts',source:'fixture_visible_sort'}}},{tab:{...tabs.get(tab)},frameId:0});}
return {rewind,spawn,extCall,storage,posts,tabs,makePost,obs,deepAll,feedSender,deepSender,exportSender,setFeedPosition:(id,y)=>{feedPageInstance=id;feedScrollY=y;},setDownloadState:s=>{downloadState=s;},failNextCommit:()=>{failCommit=true;}};
};
