from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
html='''<div role="article" id="post">
<h3><a href="/groups/another-group/user/12345678/">Автор Поста</a></h3>
<a href="/groups/another-group/posts/123456789/" title="2026-10-28T10:30:00+03:00">28 октября</a>
<a href="/profile.php?id=12345678"><img width="200" height="200" src="https://cdn.example/avatar.jpg"></a>
<div data-ad-preview="message">Длинный текст публикации с полезными ссылками для поездки.
<a href="https://example.org/map?a=1">Карта</a></div>
<a href="/photo.php?fbid=900"><img width="600" height="400" src="https://cdn.example/photo.jpg?sig=old"></a>
<a href="/photo.php?fbid=900"><img width="600" height="400" src="https://cdn.example/photo.jpg?sig=new"></a>
<img width="16" height="16" src="https://cdn.example/emoji.png">
<video src="https://cdn.example/movie.mp4" poster="https://cdn.example/poster.jpg"></video>
<div role="article" id="comment"><a href="/writer">Автор Комментария</a>
<div dir="auto">Полезная <a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2Fguide%3Fx%3D1">инструкция</a> здесь</div>
<a href="/groups/another-group/posts/123456789/?comment_id=99887766"><time datetime="2026-10-29T10:00:00Z">вчера</time></a>
<a href="/photo.php?fbid=901"><img width="600" height="400" src="https://cdn.example/comment.jpg"></a>
</div></div>'''

with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 page=b.new_page();page.set_content(html);page.evaluate((root/'core.js').read_text(encoding='utf-8'))
 def card():
  return page.evaluate("FBBurCore.extractCard(document.querySelector('#post'),'another-group','https://www.facebook.com/groups/another-group/posts/123456789/')")
 row=card()
 assert row['is_pinned'] is False
 page.evaluate("()=>{const pin=document.createElement('span');pin.id='pin';pin.setAttribute('aria-label','Закреплённая публикация');document.querySelector('#post').prepend(pin)}")
 assert card()['is_pinned'] is True
 page.locator('#pin').evaluate('(el)=>el.remove()')
 assert row['author']=='Автор Поста',row
 assert row['author_url']=='https://www.facebook.com/profile.php?id=12345678'
 for name in ['王小明','أحمد محمد']:
  page.locator('#post > h3 a').evaluate('(el,name)=>el.textContent=name',name)
  assert card()['author']==name
 page.locator('#post > h3 a').evaluate("el=>el.textContent='Автор Поста'")
 assert row['published_at']=='2026-10-28T07:30:00.000Z',row
 assert len(row['links'])==1 and row['links'][0]['text']=='Карта',row['links']
 assert {m['kind'] for m in row['media']}=={'image','video'},row['media']
 assert len(row['media'])==2,row['media']
 c=row['comments'][0]
 assert c['text']=='Полезная инструкция здесь',c
 assert c['links']==[{'url':'https://example.org/guide?x=1','text':'инструкция','source_url':'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2Fguide%3Fx%3D1'}],c
 assert c['published_at']=='2026-10-29T10:00:00.000Z',c
 assert len(c['media'])==1 and 'comment.jpg' in c['media'][0]['url'],c
 # Never borrow a nested comment's timestamp or author for the post.
 page.locator('#post > a[title]').evaluate('(el)=>el.remove()')
 assert card()['published_at'] is None
 page.locator('#post > h3').evaluate('(el)=>el.remove()')
 assert card()['author'] is None
 page.evaluate("()=>{const h=document.createElement('h3');h.textContent='Анонимный участник';document.querySelector('#post').prepend(h)}")
 anonymous=card();assert anonymous['author']=='Анонимный участник' and anonymous['author_is_anonymous'] and anonymous['author_url'] is None
 changed=page.evaluate('([old,fresh])=>FBBurCore.mergePosts(old,fresh,fresh.group)',[row,anonymous])
 assert changed['author_is_anonymous'] and changed['author_url'] is None
 page.locator('#post > h3').evaluate('(el)=>el.remove()')
 # Missing timezone/year remains explicit uncertainty, never a fabricated instant.
 for label,precision,day in [('28 октября 2026 в 10:30','day','2026-10-28'),('28 октября','label',None),('2 дн.','label',None)]:
  page.evaluate('''label=>{const a=document.createElement('a');a.href='/groups/another-group/posts/123456789/';a.title=label;a.id='date';document.querySelector('#post').prepend(a)}''',label)
  r=card();assert r['published_at'] is None and r['date_precision']==precision and r['published_date']==day,r
  page.locator('#date').evaluate('(el)=>el.remove()')
 # A body link retains its label in fallback extraction; link-only comments survive.
 page.locator('#comment > [dir]').evaluate("el=>el.innerHTML='<a href=\"https://example.org/only\">https://example.org/only</a>'")
 c=card()['comments'][0];assert c['text']=='https://example.org/only' and c['links'][0]['url']=='https://example.org/only',c
 merged=page.evaluate('(r)=>FBBurCore.mergePosts(r,{...r,comments:r.comments.map(c=>({...c,links:[],media:[],published_at:null}))},r.group)',row)
 assert merged['comments'][0]['links']==row['comments'][0]['links']
 assert merged['comments'][0]['published_at']==row['comments'][0]['published_at']
 b.close()
print('PASS own post/comment authors, explicit date evidence, unknown date precision, links, link-only fallback, media ownership/filtering/deduplication/video and merge preservation')
