'''Offline browser end-to-end content.js: one post, automatic deep click + extraction + report.'''
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
ID='1700000000000001'
URL='http://127.0.0.1:18888/groups/backpackIL/posts/'+ID+'/'
html=f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{height:2800px}}#c2{{display:none}}
</style></head><body><div role="article" id="post">
<a href="/groups/backpackIL/posts/{ID}/">Дата</a>
<div data-ad-comet-preview="message">Проверка универсального коллектора: пешеходный маршрут 6 км по северу Израиля.</div>
<div role="article" id="c1"><a href="/people/Marina/123456">Марина</a><div data-testid="comment_message">Комментарий: есть парковка, на тропе хорошая маркировка.</div><a href="/groups/backpackIL/posts/{ID}/?comment_id=998877">2 дня назад</a></div>
<button role="button" id="more" onclick="document.getElementById('c2').style.display='block';this.remove()">Смотреть другие комментарии</button>
<div role="article" id="c2"><a href="/people/Natalia/32333">Наталья</a><div data-testid="comment_message">Второй комментарий после раскрытия: автобус 15 рядом.</div></div>
</div></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context()
 page=ctx.new_page();page.set_content(html)
 job={'id':'test-e2e','stage':'deep','group':'backpackIL','paused':False,'queue':[ID],'index':0}
 page.evaluate('''(job)=>{window.testJob=job;window.snapshots=[];
 window.chrome={runtime:{sendMessage:async(msg)=>{
 if(msg.type==='status')return {ok:true,result:window.testJob};
 if(msg.type==='deepReady'){window.testJob.deepPhase='READY';return {ok:true,result:window.testJob};}
 if(msg.type==='deepExpanding'){window.testJob.deepPhase='EXPANDING';return {ok:true,result:window.testJob};}
 if(msg.type==='deepMismatch')return {ok:true,result:{waiting:true}};
 if(msg.type==='deepSnapshot'){window.snapshots.push(msg);window.testJob.paused=true;return {ok:true,result:{ok:true}};}
 if(msg.type==='obstructed'||msg.type==='deepError')throw Error('unexpected '+msg.type);
 return {ok:true,result:{ready:true}};
 },onMessage:{addListener:()=>{}}}};
 }''',job)
 for f in ['core.js','feed-scroll.js','content.js']:
  source=(root/f).read_text(encoding='utf-8')
  # The test browser forbids navigation. Replace location references only in test script; parser is unchanged.
  if f=='content.js':
   source=source.replace('location.pathname',repr('/groups/backpackIL/posts/'+ID+'/'))
   source=source.replace('location.href',repr('https://www.facebook.com/groups/backpackIL/posts/'+ID+'/'))
  page.evaluate(source)
 page.wait_for_function('window.snapshots.length===1',timeout=45000)
 snapshot=page.evaluate('window.snapshots[0]')
 assert snapshot['type']=='deepSnapshot',snapshot
 assert snapshot['post']['post_id']==ID,snapshot
 comments=snapshot['post']['comments']
 assert len(comments)==2,comments
 assert comments[0]['author']=='Марина',comments
 assert comments[1]['author']=='Наталья',comments
 assert snapshot['expanded']>=1,snapshot
 assert 'парковка' in comments[0]['text'],comments
 assert page.evaluate('window.snapshots.length')==1
 print('PASS: real content.js in local Chromium navigated target post, clicked more comments, captured 2 authors/texts and sent deepSnapshot once')
 browser.close()
