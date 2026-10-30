'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),posts=new Map(),storage={},pageCheckpoints={},pageHistories={};
const tabs=new Map([[5,{id:5,url:'https://www.facebook.com/groups/backpackIL/',active:true}],[6,{id:6,url:'https://www.facebook.com/groups/pumpkinlatte/',active:false}]]);
let nextTabId=7,sendListener,alarmListener,tabUpdatedListener,tabRemovedListener,injections=0,reloads=0,connected=false,requests=0,feedPageInstance='feed-doc-1',feedScrollY=12000;
function request(tx,run){const r={};tx.pending++;setImmediate(()=>{try{r.result=run();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();tx.onerror?.();}finally{tx.pending--;tx.completed();}});return r;}
class TX{constructor(){this.pending=0;this.complete=false;}completed(){if(!this.pending&&!this.complete)setImmediate(()=>{if(!this.pending&&!this.complete){this.complete=true;this.oncomplete?.();}});}objectStore(){return{get:key=>request(this,()=>posts.get(key)),put:o=>request(this,()=>posts.set(o.key,structuredClone(o))),delete:k=>request(this,()=>posts.delete(k)),index:()=>({getAll:r=>request(this,()=>[...posts.values()].filter(p=>p.group===r.group)),openKeyCursor:r=>{let keys=[...posts.values()].filter(p=>p.group===r.group).map(p=>p.key),ix=0,out={};const step=()=>{if(ix>=keys.length){out.result=null;out.onsuccess?.();return;}out.result={primaryKey:keys[ix++],continue:()=>setImmediate(step)};out.onsuccess?.();};this.pending++;setImmediate(()=>{step();this.pending--;this.completed();});return out;}})};}}
class DB{constructor(){this.objectStoreNames={contains:()=>true};}transaction(){return new TX();}close(){}createObjectStore(){return{createIndex(){}};}}
const indexedDB={open:()=>{const r={result:new DB()};setImmediate(()=>{r.onupgradeneeded?.();r.onsuccess?.();});return r;}},IDBKeyRange={only:group=>({group})};
const chrome={runtime:{onMessage:{addListener:cb=>sendListener=cb},onInstalled:{addListener(){}},getURL:s=>'chrome-extension://test/'+s},storage:{local:{get:async k=>({[k]:storage[k]}),set:async o=>Object.assign(storage,o)}},tabs:{
 get:async id=>{if(!tabs.has(id))throw Error('tab missing '+id);return tabs.get(id);},
 update:async(id,data)=>{const t=await chrome.tabs.get(id);Object.assign(t,data);return t;},
 create:async data=>{const t={id:nextTabId++,url:data.url||'about:blank',active:Boolean(data.active)};tabs.set(t.id,t);return t;},
 reload:async id=>{await chrome.tabs.get(id);reloads++;return tabs.get(id);},
 sendMessage:async(id,msg)=>{const t=await chrome.tabs.get(id);if(!connected)throw Error('no receiver');if(msg.type==='burPing')return {ready:true,version:'0.5.27-alpha',location:new URL(t.url).pathname,pageInstance:feedPageInstance,scrollY:feedScrollY,obstruction:null,detailPost:/\/posts\//.test(t.url)};if(msg.type==='burCheckpointGet')return {post_id:pageCheckpoints[msg.group]||null};if(msg.type==='burCheckpointSet'){if(msg.post_id)pageCheckpoints[msg.group]=String(msg.post_id);else delete pageCheckpoints[msg.group];return {ok:true};}if(msg.type==='burHistoryGet')return {ids:pageHistories[msg.group]||[]};if(msg.type==='burHistorySet'){pageHistories[msg.group]=Array.isArray(msg.ids)?msg.ids.map(String):[];return {ok:true};}return {ready:true};},
 onUpdated:{addListener:cb=>tabUpdatedListener=cb},onRemoved:{addListener:cb=>tabRemovedListener=cb}
},scripting:{executeScript:async()=>{injections++;connected=true;}},alarms:{create(){},onAlarm:{addListener:cb=>alarmListener=cb}}};
function spawn(){const context={chrome,indexedDB,IDBKeyRange,URL,console,setTimeout,clearTimeout,Date,structuredClone,fetch:()=>{requests++;throw Error('MUST NOT call model or API')}};context.globalThis=context;const ctx=vm.createContext(context);context.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});};vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx,{filename:'background.js'});}
function extCall(type,msg={},sender={}){if(['discover','rewindResult','endDiscovery','feedOrderLost'].includes(type)&&!Object.hasOwn(msg,'pageInstance'))msg={...msg,pageInstance:feedPageInstance};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout '+type)),8000);sendListener({type,...msg},sender,r=>{clearTimeout(timer);r.ok?resolve(r.result):reject(Error(r.error));});});}
function feedSender(){return {tab:{...tabs.get(5)},frameId:0};}
function deepSender(j){return {tab:{...tabs.get(j.deepTabId)},frameId:0};}
function exportSender(){return {url:'chrome-extension://test/export.html?auto=1',tab:{id:90,url:'chrome-extension://test/export.html?auto=1'}};}
function makePost(i){const id=String(1700000000000000+i);return {group:'backpackIL',post_id:id,permalink:'https://www.facebook.com/groups/backpackIL/posts/'+id+'/',post_text:'Post '+i,comments:[]};}
function obs(p,top){return {post:p,top,bottom:top+80,visible:top+80>0&&top<800,viewportHeight:800};}
async function deepAll(){let j=await extCall('status');while(j.stage==='deep'){const id=j.queue[j.index],p=makePost(Number(id)-1700000000000000);await extCall('deepSnapshot',{post:{...p,comments:[{id:'c'+id,text:'comment',author:'A'}]},expanded:1,scrolled:1},deepSender(j));j=await extCall('status');}}
(async()=>{
 spawn();
 const cp='1727687685009933';
 let j=await extCall('start',{tabId:5,url:tabs.get(5).url,startAfter:cp,options:{maxPosts:5,maxSteps:50000}});
 assert.equal(j.checkpointPostId,cp);assert.equal(j.checkpointPending,true);
 await extCall('rewindResult',{result:{ok:true,feed_order:{verified:true,order:'new_posts',source:'fixture_visible_sort'}}},feedSender());
 for(let i=0;i<2100;i++)await extCall('discover',{observations:[obs(makePost(i),100)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.discovered,0);assert.equal(j.checkpointPostId,cp);assert.equal(j.checkpointFound,false);
 await extCall('pause');spawn();
 j=await extCall('status');assert.equal(j.paused,true);assert.equal(j.checkpointScanSteps,2100);
 await extCall('resume',{tabId:5,url:tabs.get(5).url});
 await extCall('discover',{observations:[obs({...makePost(0),post_id:cp},-200)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.checkpointFound,false,'offscreen stale target must not certify boundary');
 await extCall('endDiscovery',{reason:'unverified gap'},feedSender());
 j=await extCall('status');assert.equal(j.stage,'stalled');assert.equal(j.checkpointPending,true);assert.equal(j.checkpointPostId,cp);assert.equal(j.discovered,0);
 await extCall('resume',{tabId:5,url:tabs.get(5).url});
 await extCall('discover',{observations:[obs({...makePost(0),post_id:cp},100),obs(makePost(2200),400)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.checkpointFound,true);assert.equal(j.checkpointPending,false);assert.equal(j.checkpointPostId,cp);assert.equal(j.steps,0);assert.equal(j.discovered,1);
 assert.equal(requests,0);
 console.log('PASS 2100 exact-ID observations, no 36-step bypass, worker restart, pause/resume, offscreen target, absent target safe stall, exact boundary');
})().catch(e=>{console.error(e);process.exitCode=1;});
