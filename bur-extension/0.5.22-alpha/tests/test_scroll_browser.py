from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
script=(root/'feed-scroll.js').read_text(encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1100,'height':700})
    page.set_content('''<!DOCTYPE html><html><head><style>
        body{height:700px;overflow:hidden;margin:0}
        main{height:600px;overflow:hidden}
        #feedHolder{height:400px;overflow-y:auto}
        #feed{padding:10px}
        article{height:240px;border:1px solid gray}
        </style></head><body><main role="main"><div id="feedHolder">
        <div role="feed" id="feed">''' + ''.join('<article role="article">Карточка '+str(i)+'</article>' for i in range(12)) + '''</div></div></main></body></html>''')
    page.evaluate(script)
    before=page.evaluate("document.querySelector('#feedHolder').scrollTop")
    result=page.evaluate("async () => window.BurFeedScroll.advance(document,window,ms=>new Promise(r=>setTimeout(r,ms)))")
    after=page.evaluate("document.querySelector('#feedHolder').scrollTop")
    assert result['moved'] and len(result['tries'])==1,(result,after)
    assert before==0 and after>0,(before,after)
    assert result['tries'][0]['container']=='DIV',result
    print(json.dumps({'chromium_real_scroll':'PASS','feed_scrolled_pixels':after,'container':'feed ancestor','not_document':True}))
    browser.close()
