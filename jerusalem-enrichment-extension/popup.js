'use strict';
const $=id=>document.getElementById(id),group='374040476267868';
const send=m=>chrome.runtime.sendMessage(m);
const note=s=>{$('note').textContent=s};
async function refresh(){
 const s=await send({type:'state'});if(!s||s.error){$('status').textContent=String(s?.error||'Error');return}
 const counts={};for(const j of s.queue||[])counts[j.status]=(counts[j.status]||0)+1;
 $('status').textContent='Статус: '+(s.running?'РАБОТАЕТ':'ОСТАНОВЛЕН')+'\nВсего: '+s.queue.length+' · '+Object.entries(counts).map(x=>x.join(': ')).join(' · ')+
 '\nТекущий: '+(s.current||'—')+'\nФайл: '+(s.source||'—')+'\n\n'+(s.log||[]).slice(-8).map(x=>[x.at?.slice(11,19),x.id||'',x.status,x.detail||''].join(' · ')).join('\n');
}
$('load').onclick=async()=>{try{
 const file=$('file').files?.[0];if(!file)throw Error('Выберите JSON');
 const d=JSON.parse(await file.text());if(d.group?.identifier!==group||!Array.isArray(d.posts)||!Array.isArray(d.comments)||!String(d.collector_version).startsWith('jr-fb-archive'))throw Error('Неверный архив группы');
 const counts=new Map();for(const c of d.comments)counts.set(c.post_key,(counts.get(c.post_key)||0)+1);
 const ids=new Set();
 const posts=d.posts.filter(p=>{const id=String(p.facebook_post_id||'');if(!/^\d+$/.test(id)||p.key!=='fb:'+group+':post:'+id||ids.has(id))return false;ids.add(id);return p.raw_metadata?.needs_enrichment||p.comments_complete!==true||!String(p.text||'').trim()});
 posts.sort((a,b)=>((b.comments_complete===false?30:0)+(b.raw_metadata?.needs_enrichment?10:0)+(counts.get(b.key)||0))-((a.comments_complete===false?30:0)+(a.raw_metadata?.needs_enrichment?10:0)+(counts.get(a.key)||0)));
 const items=posts.slice(0,Number($('count').value)||20).map(p=>({id:p.facebook_post_id,old_comment_count:counts.get(p.key)||0}));
 if(!items.length)throw Error('Неполных постов не обнаружено');
 const r=await send({type:'load',items,source:file.name});if(r?.error)throw Error(r.error);
 note('Загружены '+items.length+' постов. Начинайте после завершения сбора ленты.');await refresh();
 }catch(e){note('Ошибка: '+String(e.message||e))}};
$('start').onclick=async()=>{const r=await send({type:'start'});note(r?.error||'Досбор запущен.');await refresh()};
$('stop').onclick=async()=>{const r=await send({type:'stop'});note(r?.error||'Остановка после текущего поста.');await refresh()};
$('report').onclick=async()=>{const s=await send({type:'state'});const data={version:'jr-enrichment-v0.1.0',group,exported_at:new Date().toISOString(),source:s.source,queue:s.queue,log:s.log};
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='jerusalem-enrichment-report-'+Date.now()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);note('Отчёт сохранён. Для архива используйте Экспорт JSON в основном коллекторе.');};
refresh();setInterval(refresh,2500);
