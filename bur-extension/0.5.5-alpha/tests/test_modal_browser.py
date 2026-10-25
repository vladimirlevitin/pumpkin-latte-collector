"""Regression based on 25 Oct real screenshot: Facebook photo modal over feed,
'и ещё 17' photos, reply link. No automatic close or hidden scraping."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1200,'height':800})
    page.set_content('''<!doctype html><html><head><style>
      body{margin:0;overflow:hidden;height:800px}
      #holder{height:600px;overflow-y:scroll}
      #feed{height:2800px} article{margin:10px;height:280px}
      #overlay{position:fixed;left:70px;top:75px;width:950px;height:650px;background:white;z-index:999;box-shadow:0 0 0 200vw #0005}
    </style></head><body>
     <main role="main"><div id="holder"><div role="feed" id="feed">
       <article role="article" id="post1">
         <a href="/groups/backpackIL/posts/1769040074208027/">ссылка на пост</a>
         <div data-ad-preview="message">Маршрут по Махтеш-Рамон и Стене аммонитов <span id="textmore" role="button">Ещё</span></div>
         <button id="photos" aria-label="галерея фотографий">и ещё 17</button>
         <button id="reply" role="button">Посмотреть 1 ответ</button>
       </article>
       <article role="article" id="post2"><a href="/groups/backpackIL/posts/1768979234214111/">ссылка</a><div data-ad-preview="message">Другой маршрут</div></article>
     </div></div></main>
    <div id="overlay" role="dialog" aria-modal="true"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><div>и ещё 17</div><button>Посмотреть 1 ответ</button></div>
    <script>window.clicked={photos:0,replies:0,text:0};for(const [id,key] of [['photos','photos'],['reply','replies'],['textmore','text']])document.getElementById(id).addEventListener('click',()=>clicked[key]++);</script>
    </body></html>''')
    for f in ['core.js','feed-scroll.js']:
      page.evaluate((root/f).read_text(encoding='utf-8'))
    # Actual screenshot scenario: visible modal prevents scrolling and feed access.
    blocked=page.evaluate('window.BurFeedScroll.obstruction(document,window)')
    assert blocked and blocked['kind']=='facebook_dialog' and blocked['media'],blocked
    result=page.evaluate('async () => window.BurFeedScroll.advance(document,window,ms=>new Promise(r=>setTimeout(r,ms)))')
    assert result['blocked'] and not result['moved'] and result['tries']==[],result
    assert page.evaluate("document.getElementById('holder').scrollTop")==0
    rows=page.evaluate("window.FBBurCore.postNodes(document).map(x=>x.id)")
    assert 'overlay' not in rows
    # Mimic closing overlay by the user, NOT by collector.
    page.evaluate("document.getElementById('overlay').remove()")
    assert page.evaluate('window.BurFeedScroll.obstruction(document,window)') is None
    clicked=page.evaluate("window.FBBurCore.expandVisible(window.FBBurCore.postNodes(document),10,'post'); window.clicked")
    assert clicked=={'photos':0,'replies':0,'text':1},clicked
    moved=page.evaluate('async () => window.BurFeedScroll.advance(document,window,ms=>new Promise(r=>setTimeout(r,ms)))')
    assert moved['moved'] and page.evaluate("document.getElementById('holder').scrollTop")>0,moved
    # Second modal with no aria-modal but large visible overlay should be blocked.
    page.evaluate("document.body.insertAdjacentHTML('beforeend','<div role=\"dialog\" style=\"position:fixed;inset:10px;background:white\">Открыто окно</div>')")
    assert page.evaluate('window.BurFeedScroll.obstruction(document,window)') is not None
    # Small harmless dialog-like menu should not be taken for blocking full-screen photo modal.
    page.evaluate("document.querySelector('div[role=dialog]').remove();document.body.insertAdjacentHTML('beforeend','<div role=\"dialog\" style=\"position:fixed;left:10px;top:10px;width:50px;height:50px;background:white\">menu</div>')")
    assert page.evaluate('window.BurFeedScroll.obstruction(document,window)') is None
    print('PASS: Facebook photo modal => blocked, no background scroll; no image/reply clicks in discovery; feed resumes after user closes; small menu ignored')
    browser.close()
