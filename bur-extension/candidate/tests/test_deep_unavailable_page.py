"""0.5.34: real content.js, post dialog showing Facebook's "Страница сейчас недоступна".

The page script must report it to the worker (deepUnavailable) right away instead of waiting out the
32 detail cycles and ending with permalink_card_unresolved; no Deep error and no snapshot is produced.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
url='https://www.facebook.com/groups/protocol-fixture/posts/1700000000000001/'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page()
 page.set_content('''<div role="feed"><div role="article"><a href="/groups/protocol-fixture/posts/1700000000000009/">Other</a><div data-ad-preview="message">Feed post behind the dialog</div></div></div>
<div role="dialog" aria-label="Публикация Elizabeth Spektor" style="position:fixed;top:20px;left:20px;width:520px;height:420px;background:#fff"><h2>Публикация Elizabeth Spektor</h2><a href="/groups/protocol-fixture/posts/1700000000000001/" style="display:block;height:1px;overflow:hidden">post link</a>
<div>Страница сейчас недоступна</div><div>Возможно, это связано с технической проблемой, которую мы уже решаем. Попробуйте обновить страницу.</div>
<a href="/">Перейти в Ленту</a><a href="/">Назад</a></div>''')
 for name in ['core.js','feed-scroll.js']:page.evaluate((root/name).read_text(encoding='utf-8'))
 page.evaluate('''()=>{
  window.testJob={id:'unavail',stage:'deep',tabRole:'deep',group:'protocol-fixture',paused:false,queue:['1700000000000001'],index:0,deepPhase:'READY'};
  window.seen=[];window.unavailable=[];
  window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async msg=>{
   window.seen.push(msg.type);
   if(msg.type==='status')return {ok:true,result:window.testJob};
   if(msg.type==='deepReady'||msg.type==='deepExpanding'){window.testJob.deepPhase=msg.type==='deepReady'?'READY':'EXPANDING';return {ok:true,result:window.testJob}};
   if(msg.type==='deepUnavailable'){window.unavailable.push(msg);window.testJob.paused=true;return {ok:true,result:{reloading:true}}};
   if(msg.type==='deepError'||msg.type==='deepSnapshot'||msg.type==='deepPassEnd')throw Error('unexpected '+msg.type);
   return {ok:true,result:{ready:true}};
  }}};
 }''')
 source=(root/'content.js').read_text(encoding='utf-8')
 source=source.replace('location.pathname',repr('/groups/protocol-fixture/posts/1700000000000001/')).replace('location.href',repr(url))
 source=source.replace('const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));','const delay=()=>Promise.resolve();').replace('setTimeout(tick,900)','setTimeout(tick,0)').replace('setInterval(tick,2600)','setInterval(tick,10)')
 page.evaluate(source);page.wait_for_function('window.unavailable.length>=1',timeout=15000)
 data=page.evaluate('({unavailable:window.unavailable,seen:window.seen})')
 assert data['unavailable'][0]['id']=='1700000000000001',data
 assert 'obstructed' not in data['seen'],data
 b.close()
print('PASS real content.js reports the unavailable notice in the post dialog immediately instead of waiting out the detail cycles')
