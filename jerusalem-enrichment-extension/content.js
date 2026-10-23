(async()=>{
'use strict';
const group='374040476267868';
const match=location.pathname.match(/^\/groups\/374040476267868\/posts\/(\d+)\/?$/);
if(!match)return;const id=match[1];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const unavailable=()=>/content (?:isn't|is not) available|post (?:isn't|is not) available|контент недоступен|публикаци[яи] недоступн|пост недоступен|не можете получить доступ|לא ניתן לראות|התוכן הזה אינו זמין/i.test((document.body?.innerText||'').slice(0,16000));
await sleep(1800);
let job;try{job=await chrome.runtime.sendMessage({type:'ready',id})}catch{return}
if(!job?.run||job.id!==id)return;
if(unavailable()){await chrome.runtime.sendMessage({type:'result',id,status:'unavailable',error:'Post unavailable'});return}
let outcome;
try{
 const engine=globalThis.__JR_ENRICH_ARCHIVE;
 if(!engine?.enrichCurrentPost)throw Error('Enrichment engine missing');
 const r=await engine.enrichCurrentPost();
 if(!r?.ok){const error=String(r?.error||'Unknown error');outcome={status:unavailable()?'unavailable':/guard|target|identity|route/.test(error)?'skipped_guard':'failed',error}}
 else if(String(r.facebook_post_id)!==id||r.post_key!=='fb:'+group+':post:'+id){outcome={status:'skipped_guard',error:'Post identity mismatch'}}
 else{outcome={status:r.comments_complete?'enriched':'partial',comments:r.comments,expected_comments:r.expected_comments}}
}catch(e){outcome={status:unavailable()?'unavailable':'failed',error:String(e)}}
await chrome.runtime.sendMessage({type:'result',id,...outcome}).catch(()=>{});
})();
