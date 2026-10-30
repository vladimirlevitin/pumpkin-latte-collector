// 0.5.27: popup warns when the working tab's Bur script is gone (extension reloaded under an open tab).
const fs=require('fs'),path=require('path'),assert=require('assert');
const src=fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8');
const body=src.match(/async function liveness\(j\)\{[\s\S]*?\n\}/)[0];
function make(reply){const chrome={runtime:{getManifest:()=>({version:'0.5.27'})},tabs:{sendMessage:async(id,m)=>{if(reply instanceof Error)throw reply;return reply;}}};
 return new Function('chrome',body+';return liveness;')(chrome);}
(async()=>{
 const job={stage:'discover',paused:false,feedTabId:7};
 assert.strictEqual(await make({ready:true,version:'0.5.27-alpha'})(job),'');
 assert.match(await make(new Error('Could not establish connection. Receiving end does not exist.'))(job),/Связь со вкладкой ленты потеряна/);
 assert.match(await make({ready:true,version:'0.5.26-alpha'})(job),/потеряна/);
 assert.match(await make(new Error('x'))({...job,stage:'deep',deepTabId:9}),/подробного сбора/);
 assert.strictEqual(await make(new Error('x'))({...job,paused:true}),'');
 assert.strictEqual(await make(new Error('x'))({...job,stage:'done'}),'');
 console.log('PASS popup warns on lost/stale page script during discover/deep; silent when alive, paused or done');
})().catch(e=>{console.error(e);process.exit(1);});
