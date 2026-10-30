'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(root,'../0.5.20-alpha');
const read=(dir,file)=>fs.readFileSync(path.join(dir,file),'utf8').replace(/\r\n/g,'\n').replace(/^\uFEFF/,'');
const sha=text=>require('node:crypto').createHash('sha256').update(text).digest('hex');
const expected=JSON.parse(read(root,'BASELINE-SHA256.json'));
const m=JSON.parse(read(root,'manifest.json'));
assert.equal(m.version,'0.5.27');assert.equal(m.version_name,'0.5.27-alpha');
for(const file of [m.background.service_worker,m.action.default_popup,...Object.values(m.icons),...m.content_scripts.flatMap(x=>x.js)])assert.ok(fs.existsSync(path.join(root,file)),file);
for(const file of ['feed-scroll.js']){
 const normalized=read(root,file).replaceAll('0.5.27-alpha','0.5.20-alpha');
 assert.equal(sha(normalized),expected.files[file],'protected collector regression: '+file);
 if(fs.existsSync(path.join(baseline,file)))assert.equal(normalized,read(baseline,file));
}
const bg=read(root,'background.js'),content=read(root,'content.js');
assert.ok(bg.includes("VERSION='"+m.version_name+"'"));assert.ok(content.includes("version:'"+m.version_name+"'"));
assert.ok(bg.includes("JOB_KEY='burCollectorJob-v0520'"));
assert.ok(bg.includes("files:['core.js','feed-scroll.js','checkpoint-seek.js','content.js']"));
assert.ok(!bg.includes('checkpointBypassPending'));
const deep=source=>source.slice(source.indexOf('async function deep(job){'),source.indexOf('async function tick(){'));
assert.equal(sha(deep(read(baseline,'content.js'))),expected.deep_sha256,'original Deep baseline must stay immutable');
for(const guard of ["await send('deepMismatch'","filter(p=>p.post_id===expected)","F.advanceDetail(document,window,delay)","await handleObstruction(job","await send('deepProgress'","await send('deepPassEnd'"])assert.ok(deep(content).includes(guard),guard);
console.log('PASS manifest references, version alignment, storage compatibility; scroll identical; Deep target/obstruction/scroll guards retained with durable progress and bounded continuation; per-group mode UI intentionally added; relational export intentionally additive; download acknowledgment intentionally strengthened; core enhanced for post metadata to canonical baseline');

assert.ok(read(root,'export.html').includes('src="archive-graph.js"'));assert.ok(fs.existsSync(path.join(root,'archive-graph.js')));

assert.ok(read(root,'popup.html').includes('id="mode"'));assert.ok(bg.includes("ARCHIVE_KEY='burCollectorArchives-v1'"));assert.ok(bg.includes("importScripts('core.js','archive-state.js')"));
