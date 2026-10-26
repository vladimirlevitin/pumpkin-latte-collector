"""DOM fixtures based on the 0.5.4 export, not a live Facebook verification."""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from html import escape
import json
from playwright.sync_api import sync_playwright
r=Path(__file__).resolve().parents[1]
links=json.loads((r/'tests/live-054-reply-links.json').read_text(encoding='utf-8'))
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page(viewport={'width':1200,'height':800})
 # Replies are siblings, so DOM ancestry cannot supply their parent.
 page.set_content('<div id="root">'+''.join(f'<div role="article"><a href="/author.test"><span dir="auto">Автор Ответа</span></a><div dir="auto">Мицпор Викер</div><a href="{escape(u)}">1 дн.</a></div>' for u in links)+'</div>')
 page.evaluate((r/'core.js').read_text(encoding='utf-8'))
 rows=page.evaluate("FBBurCore.extractVisibleComments(document.querySelector('#root'))")
 assert len(rows)==218,len(rows)
 by={c['id']:c for c in rows}
 for u in links:
  q=parse_qs(urlparse(u).query);c=by[q['reply_comment_id'][0]]
  assert c['parent_id']==q['comment_id'][0],c
  assert c['text']=='Мицпор Викер' and c['author']=='Автор Ответа',c
 assert by['1759901381788563']['parent_id']=='1759557635156271'
 page.set_content('''<div id="root">
 <div role="article"><a href="/author.test"><span dir="auto">Шомер Саф на русском</span></a><div dir="auto">Мицпор Викер</div><a href="/groups/backpackIL/posts/123/?comment_id=1">1 дн.</a></div>
 <div role="article"><a href="/author.test"><span dir="auto">Шомер Саф на русском</span></a><a href="/groups/backpackIL/posts/123/?comment_id=2">1 дн.</a></div>
 <div role="article"><a href="/author.test">Шомер Саф на русском</a><div data-testid="comment_message">Шомер Саф на русском</div><a href="/groups/backpackIL/posts/123/?comment_id=3">1 дн.</a></div></div>''')
 rows=page.evaluate("FBBurCore.extractVisibleComments(document.querySelector('#root'))")
 assert [c['text'] for c in rows]==['Мицпор Викер','',''],rows
 assert all(c['author']=='Шомер Саф на русском' for c in rows),rows
 assert page.evaluate('FBBurCore.collector')=='fb-group-bur/'+json.loads((r/'manifest.json').read_text(encoding='utf-8'))['version_name']
 # A separate unexpected overlay must still block even when a valid post dialog exists.
 page.set_content('''<div role="dialog" id="post" style="position:fixed;inset:20px"><a href="/groups/backpackIL/posts/123/">post</a><div dir="auto">Короткий пост</div><button>Посмотреть 2 ответа</button></div><div role="dialog" id="foreign" style="position:fixed;inset:50px;z-index:999">Unexpected login or gallery</div>''')
 page.evaluate((r/'feed-scroll.js').read_text(encoding='utf-8'))
 page.evaluate("window.view={location:{pathname:'/groups/backpackIL/posts/123/'},innerWidth:1200,innerHeight:800,getComputedStyle:e=>getComputedStyle(e)}")
 assert page.evaluate("BurFeedScroll.detailDialog(document,view).id")=='post'
 assert page.evaluate("Boolean(BurFeedScroll.obstruction(document,view,BurFeedScroll.detailDialog(document,view)))")
 page.locator('#foreign').evaluate('(el)=>el.remove()')
 assert page.evaluate("BurFeedScroll.obstruction(document,view,BurFeedScroll.detailDialog(document,view))") is None
 page.locator('#post').evaluate("el=>el.insertAdjacentHTML('beforeend','<div role=\"dialog\" id=\"nestedForeign\" style=\"position:fixed;inset:60px\">Unexpected login</div>')")
 assert page.evaluate("Boolean(BurFeedScroll.obstruction(document,view,BurFeedScroll.detailDialog(document,view)))")
 page.locator('#nestedForeign').evaluate('(el)=>el.remove()')
 page.locator('#post a').evaluate("el=>el.href='/groups/backpackIL/posts/999/'")
 assert page.evaluate('BurFeedScroll.detailDialog(document,view)') is None
 # A real selected post may itself contain a link to ANOTHER post. That link must
 # not disqualify the surrounding selected-post dialog (0.5.5 live regression).
 page.set_content('''<div role="dialog" id="post" style="position:fixed;inset:20px">
 <div data-testid="post_message">Current selected post body</div>
 <a href="/groups/backpackIL/posts/999/">shared/related post link</a>
 </div>''')
 page.evaluate("window.view={location:{pathname:'/groups/backpackIL/posts/123/'},innerWidth:1200,innerHeight:800,getComputedStyle:e=>getComputedStyle(e)}")
 assert page.evaluate("BurFeedScroll.detailDialog(document,view).id")=='post'
 assert page.evaluate("BurFeedScroll.obstruction(document,view,BurFeedScroll.detailDialog(document,view))") is None
 b.close()
print('PASS: 218 real reply permalinks; exact parent/reply case; author/body/empty; version; safe target vs foreign dialog')
