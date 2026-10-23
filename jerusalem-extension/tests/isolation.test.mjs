import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const directory=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,directory),'utf8');
const core=read('core.js'),bg=read('background.js'),content=read('content.js');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'0.1.0');
assert.equal(manifest.content_scripts[0].matches[0],'https://www.facebook.com/groups/374040476267868*');
assert.deepEqual(manifest.host_permissions,['https://www.facebook.com/*']);
assert.ok(core.includes("const DB_NAME='jerusalem_ru_archive';"));
assert.ok(core.includes("const GROUP_PATH='374040476267868';"));
assert.ok(core.includes("const SERVER_SAFE_INGEST_READY=false;"));
assert.ok(core.includes("const INGEST_URL='';"));
assert.ok(core.includes("const PUBLISHABLE_KEY='';"));
assert.ok(core.includes('if(!isTargetFeed())return;'));
assert.ok(core.includes('if(!running||!isTargetFeed())return null;'));
assert.ok(core.includes("if(result.postStatus==='new'&&SERVER_SAFE_INGEST_READY)"));
assert.ok(core.includes('window.__JR_FB_ARCHIVE='));
assert.ok(content.includes('globalThis.__JR_FB_ARCHIVE'));
assert.ok(bg.includes('/groups/374040476267868'));
for(const data of [core,bg,content,read('popup.html'),read('popup.js')]){
 assert.ok(!data.includes('pumpkin_latte_archive'),'old IndexedDB leaked');
 assert.ok(!data.includes('__PLA_FB_ARCHIVE'),'old global leaked');
 assert.ok(!data.includes('ltznpjfnkpydautbsrej'),'old Supabase project leaked');
}
console.log('Jerusalem isolation contract PASS');
