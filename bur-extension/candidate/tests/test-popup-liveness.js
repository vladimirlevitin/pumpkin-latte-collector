// 0.5.27: popup warns when the working tab's Bur script is gone (extension reloaded under an open tab).
const fs=require('fs'),path=require('path'),assert=require('assert');
const src=fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8');
const body=src.match(/async function liveness\(j\)\{[\s\S]*?\n\}/)[0];
function make(reply,status='complete',later){let n=0;const chrome={runtime:{getManifest:()=>({version:'0.5.29'})},tabs:{get:async()=>({status}),sendMessage:async(id,m)=>{n++;const r=later&&n>1?later:reply;if(r instanceof Error)throw r;return r;}}};
 return new Function('chrome','setTimeout',body+';return liveness;')(chrome,(f)=>f());}
(async()=>{
 const job={stage:'discover',paused:false,feedTabId:7};
 assert.strictEqual(await make({ready:true,version:'0.5.29-alpha'})(job),'');
 assert.match(await make(new Error('Could not establish connection. Receiving end does not exist.'))(job),/Связь со вкладкой ленты потеряна/);
 assert.match(await make({ready:true,version:'0.5.26-alpha'})(job),/потеряна/);
 assert.match(await make(new Error('x'))({...job,stage:'deep',deepTabId:9}),/подробного сбора/);
 assert.strictEqual(await make(new Error('x'))({...job,paused:true}),'');
 assert.strictEqual(await make(new Error('x'))({...job,stage:'done'}),'');
 // deep tab reloading between posts: no warning
 assert.strictEqual(await make(new Error('x'),'loading')({...job,stage:'deep',deepTabId:9}),'');
 // one missed ping, then answers: no warning
 assert.strictEqual(await make(new Error('x'),'complete',{ready:true,version:'0.5.29-alpha'})(job),'');
 console.log('PASS popup warns on lost/stale page script during discover/deep; silent when alive, paused, done, loading or after a single missed ping');
})().catch(e=>{console.error(e);process.exit(1);});
