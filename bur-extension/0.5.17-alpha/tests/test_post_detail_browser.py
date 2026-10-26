"""Regression: intended FB permalink modal is the POST, not an error. No gallery click."""
from pathlib import Path
from playwright.sync_api import sync_playwright
p=Path(__file__).resolve().parents[1]
url='https://www.facebook.com/groups/backpackIL/posts/1766750987770000/'
html='''<!doctype html><html><head><style>
body{margin:0;height:900px;overflow:hidden}
#feed{height:1900px;overflow:auto}#shell{height:600px;overflow:hidden}
#dialog{position:fixed;top:25px;left:120px;width:800px;height:650px;z-index:4;background:white;display:block}
#comments{height:300px;overflow-y:auto;border:2px solid grey}
#commentcontent{height:1100px}
</style></head><body><div id="shell"><div id="feed" role="feed">Background feed</div></div>
<div role="dialog" aria-modal="true" id="dialog">
<article role="article" id="post">
<a href="/groups/backpackIL/posts/1766750987770000/">Post link</a>
<div data-ad-preview="message">В прошлый шабат прошли интересный пеший маршрут в лесу А-Мегиним, с живописными точками.<button id="more" role="button">Ещё</button></div>
<button id="gallery" aria-label="галерея фотографий">и ещё 17</button>
<div id="comments"><div id="commentcontent"><article role="article" id="comment"><div dir="auto">Хороший маршрут. Где начало тропы? <button id="reply" role="button">Посмотреть 1 ответ</button></div></article></div></div>
</article><div contenteditable="true" role="textbox">Комментировать</div></div>
<script>window.clicks={more:0,gallery:0,reply:0};for(let id of ['more','gallery','reply'])document.getElementById(id).addEventListener('click',()=>window.clicks[id]++);</script>
</body></html>'''
with sync_playwright() as pl:
 browser=pl.chromium.launch(headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1200,'height':800})
 page.set_content(html)
 page.evaluate("""() => {window.__postView={location:{pathname:'/groups/backpackIL/posts/1766750987770000/'},innerWidth:window.innerWidth,innerHeight:window.innerHeight,getComputedStyle:e=>window.getComputedStyle(e),scrollY:0,scrollBy:(x,y)=>window.scrollBy(x,y)};}""")
 for f in ['core.js','feed-scroll.js']:
  page.evaluate((p/f).read_text(encoding='utf-8'))
 detail=page.evaluate('Boolean(window.BurFeedScroll.detailDialog(document,window.__postView))')
 assert detail, 'expected permalink post dialog must be recognized'
 assert page.evaluate('Boolean(window.BurFeedScroll.obstruction(document,window))'), 'feed is covered and should stay blocked'
 nodes=page.evaluate("window.FBBurCore.postNodes(document,null,{includeDialog:true}).map(e=>e.id)")
 assert 'post' in nodes and 'comment' not in nodes, nodes
 collected=page.evaluate("window.FBBurCore.extractCard(document.querySelector('#post'),'backpackIL',location.href)")
 assert collected and collected['post_id']=='1766750987770000',collected
 assert collected['comments'] and 'начало тропы' in collected['comments'][0]['text'], collected
 page.evaluate("window.FBBurCore.expandVisible([document.querySelector('#post')],10,'deep')")
 clicks=page.evaluate('window.clicks')
 assert clicks=={'more':1,'gallery':0,'reply':1},clicks
 movement=page.evaluate('async()=>await window.BurFeedScroll.advanceDetail(document,window.__postView,ms=>new Promise(r=>setTimeout(r,ms)))')
 assert movement['moved'],movement
 assert page.evaluate('document.querySelector("#feed").scrollTop')==0,'do not scroll blocked background feed'
 assert page.evaluate('document.querySelector("#comments").scrollTop')>0
 # Unrelated photo modal on permalink must remain blocked (no post text inside).
 page.evaluate('''() => {document.querySelector('#dialog').innerHTML='<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="/><button>и ещё 17</button>'; }''')
 assert not page.evaluate('Boolean(window.BurFeedScroll.detailDialog(document,window.__postView))')

 # Facebook may nest multiple dialog wrappers around the same selected post.
 # This was the real 25 Oct failure: one visual post, >1 visible role=dialog.
 page.set_content(html.replace('<div role="dialog" aria-modal="true" id="dialog">','<div role="dialog" aria-modal="true" id="outer"><div role="dialog" id="dialog">').replace('</article><div contenteditable="true" role="textbox">Комментировать</div></div>','</article><div contenteditable="true" role="textbox">Комментировать</div></div></div>'))
 page.evaluate("""() => {window.__postView={location:{pathname:'/groups/backpackIL/posts/1766750987770000/'},innerWidth:window.innerWidth,innerHeight:window.innerHeight,getComputedStyle:e=>window.getComputedStyle(e),scrollY:0,scrollBy:(x,y)=>window.scrollBy(x,y)};}""")
 for f in ['core.js','feed-scroll.js']:
  page.evaluate((p/f).read_text(encoding='utf-8'))
 assert page.evaluate('Boolean(window.BurFeedScroll.detailDialog(document,window.__postView))'), 'nested dialog wrappers around one post must be accepted'
 # Live 0.5.9 regression: Facebook can expose the selected post only as a
 # large localized "Публикация <author>" dialog, with no message/article/permalink
 # selectors. On an already verified permalink URL this MUST be the target dialog.
 page.set_content("""<div role="dialog" id="titleOnly" style="position:fixed;inset:4px;background:white">Публикация Альона Шанигіна</div>""")
 page.evaluate("""() => {window.__postView={location:{pathname:'/groups/backpackIL/posts/1766750987770000/'},innerWidth:window.innerWidth,innerHeight:window.innerHeight,getComputedStyle:e=>window.getComputedStyle(e),scrollY:0,scrollBy:(x,y)=>window.scrollBy(x,y)};}""")
 page.evaluate((p/'feed-scroll.js').read_text(encoding='utf-8'))
 assert page.evaluate('Boolean(window.BurFeedScroll.detailDialog(document,window.__postView))'), 'localized post-title dialog must be accepted as selected post'
 assert page.evaluate('window.BurFeedScroll.deepObstruction(document,window.__postView,window.BurFeedScroll.detailDialog(document,window.__postView))') is None
 # URL-identity regression: getPostId() already accepts these forms, so detailDialog
 # must not reject them and send the selected post into generic obstruction().
 page.evaluate("""() => {window.__postView={location:{pathname:'/groups/backpackIL/posts/1766750987770000/photos/pcb.1766750987770000/',href:'https://www.facebook.com/groups/backpackIL/posts/1766750987770000/photos/pcb.1766750987770000/'},innerWidth:window.innerWidth,innerHeight:window.innerHeight,getComputedStyle:e=>window.getComputedStyle(e),scrollY:0,scrollBy:(x,y)=>window.scrollBy(x,y)};}""")
 assert page.evaluate('window.BurFeedScroll.selectedPostIdentity(document,window.__postView).id')=='1766750987770000'
 assert page.evaluate('Boolean(window.BurFeedScroll.detailDialog(document,window.__postView))'), 'post URL with suffix must still identify selected post'
 page.evaluate("""() => {window.__postView={location:{pathname:'/permalink.php',href:'https://www.facebook.com/permalink.php?story_fbid=1766750987770000&id=12345'},innerWidth:window.innerWidth,innerHeight:window.innerHeight,getComputedStyle:e=>window.getComputedStyle(e),scrollY:0,scrollBy:(x,y)=>window.scrollBy(x,y)};}""")
 assert page.evaluate('window.BurFeedScroll.selectedPostIdentity(document,window.__postView).id')=='1766750987770000'
 assert page.evaluate('Boolean(window.BurFeedScroll.detailDialog(document,window.__postView))'), 'story_fbid URL must identify selected post'

 print('PASS: intended permalink dialog + nested wrappers allowed; photo-only overlay rejected')
 browser.close()
