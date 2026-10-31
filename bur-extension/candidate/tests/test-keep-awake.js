// 0.5.29: display stays awake only while a job actively runs (hidden pages do not lazy-load comments).
const fs=require('fs'),path=require('path'),assert=require('assert');
const src=fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8');
const body=src.match(/function keepAwake\(j\)\{[\s\S]*?catch\(_\)\{\}\}/)[0];
const calls=[];const chrome={power:{requestKeepAwake:l=>calls.push('on:'+l),releaseKeepAwake:()=>calls.push('off')}};
const keepAwake=new Function('chrome',body+';return keepAwake;')(chrome);
for(const stage of ['discover','deep','exporting'])keepAwake({stage,paused:false});
keepAwake({stage:'deep',paused:true});keepAwake({stage:'stalled',paused:true});keepAwake({stage:'done'});keepAwake(null);
assert.deepStrictEqual(calls,['on:display','on:display','on:display','off','off','off','off']);
const m=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));assert(m.permissions.includes('power'));
new Function('chrome',body+';return keepAwake;')({})({stage:'deep'}); // no power API: no throw
console.log('PASS display kept awake only while discover/deep/exporting runs; released on pause/stall/done; safe without chrome.power');
