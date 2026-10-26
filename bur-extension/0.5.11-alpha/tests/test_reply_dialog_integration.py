from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
ID='1760111475100887'
html=f'''<!doctype html><html><head><style>
body{{height:2400px}} #thread{{position:fixed;left:150px;top:80px;width:700px;height:520px;background:white;z-index:99}}
</style></head><body>
<div role="article" id="post">
 <a href="/groups/backpackIL/posts/{ID}/">post</a>
 <div data-ad-comet-preview="message">Пост про пеликанов</div>
 <div role="article" id="c1">
  <a href="/groups/backpackIL/user/10001/">Марина</a>
  <div data-testid="comment_message">Какую точку поставить в Waze?</div>
  <a href="/groups/backpackIL/posts/{ID}/?comment_id=555">1 нед.</a>
  <button id="replies" role="button">Посмотреть 2 ответа</button>
 </div>
</div>
<script>
document.getElementById('replies').onclick=function(){{ this.remove();
 const d=document.createElement('div');d.id='thread';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
 d.innerHTML=`<button id="close" aria-label="Закрыть">x</button>
 <div role="article" id="parentCopy"><a href="/groups/backpackIL/user/10001/">Марина</a><div data-testid="comment_message">Какую точку поставить в Waze?</div><a href="/groups/backpackIL/posts/{ID}/?comment_id=555">1 нед.</a>
  <div role="article" id="r1"><a href="/groups/backpackIL/user/10002/">Наташа</a><div data-testid="comment_message">Поставьте Мицпор Викер</div><a href="/groups/backpackIL/posts/{ID}/?comment_id=555&reply_comment_id=556">6 дн.</a></div>
  <div role="article" id="r2"><a href="/groups/backpackIL/user/10003/">Ирина</a><div data-testid="comment_message">Есть парковка рядом</div><a href="/groups/backpackIL/posts/{ID}/?comment_id=555&reply_comment_id=557">6 дн.</a></div>
 </div>`;
 document.body.appendChild(d);d.querySelector('#close').onclick=()=>d.remove();
}};
</script>
</body></html>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1200,'height':800});page.set_content(html)
 job={'id':'reply-dialog','stage':'deep','group':'backpackIL','paused':False,'queue':[ID],'index':0,'navStartedAt':0}
 page.evaluate('''(job)=>{window.testJob=job;window.snapshots=[];window.obstructions=[];window.errors=[];
 window.chrome={runtime:{sendMessage:async(msg)=>{
  if(msg.type==='status')return {ok:true,result:window.testJob};
 if(msg.type==='deepReady'){window.testJob.deepPhase='READY';return {ok:true,result:window.testJob};}
 if(msg.type==='deepExpanding'){window.testJob.deepPhase='EXPANDING';return {ok:true,result:window.testJob};}
 if(msg.type==='deepMismatch')return {ok:true,result:{waiting:true}};
  if(msg.type==='deepSnapshot'){window.snapshots.push(msg);window.testJob.paused=true;return {ok:true,result:{ok:true}};}
  if(msg.type==='obstructed'){window.obstructions.push(msg);window.testJob.paused=true;return {ok:true,result:{blocked:true}};}
  if(msg.type==='deepError'){window.errors.push(msg);window.testJob.paused=true;return {ok:true,result:{ok:true}};}
  return {ok:true,result:{ready:true}};
 },onMessage:{addListener:()=>{}}}};
 }''',job)
 for f in ['core.js','feed-scroll.js','content.js']:
  src=(root/f).read_text(encoding='utf-8')
  if f=='content.js':
   src=src.replace('location.pathname',repr('/groups/backpackIL/posts/'+ID+'/'))
   src=src.replace('location.href',repr('https://www.facebook.com/groups/backpackIL/posts/'+ID+'/'))
  page.evaluate(src)
 page.wait_for_function('window.snapshots.length===1 || window.obstructions.length>0 || window.errors.length>0',timeout=45000)
 assert not page.evaluate('window.obstructions.length'), page.evaluate('window.obstructions')
 assert not page.evaluate('window.errors.length'), page.evaluate('window.errors')
 assert page.evaluate('window.snapshots.length')==1, page.evaluate('({s:window.snapshots,o:window.obstructions,e:window.errors})')
 assert page.evaluate('window.snapshots[0].post.collector')=='fb-group-bur/0.5.10-alpha'
 comments=page.evaluate('window.snapshots[0].post.comments')
 by={c['id']:c for c in comments}
 assert '556' in by and '557' in by, comments
 assert by['556']['parent_id']=='555' and by['557']['parent_id']=='555', comments
 assert page.locator('#thread').count()==0, 'collector-opened reply dialog should be closed'
 print('PASS: collector-opened reply dialog harvested and closed without failing post')
 b.close()
