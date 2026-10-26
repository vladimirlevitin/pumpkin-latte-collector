from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html='''<style>#d{position:fixed;inset:20px;background:white}</style>
<div role="dialog" id="d"><div>Публикация Daria Afonin Zolotina</div><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1200,'height':800})
 page.set_content(html)
 page.evaluate("""history.replaceState({},'', '/groups/backpackIL/posts/1761943778250990/photos/pcb.1761943778250990/')""")
 page.evaluate((root/'feed-scroll.js').read_text(encoding='utf-8'))
 page.evaluate("globalThis.__FB_BUR_PROBE_EXPECTED__='1761943778250990'")
 page.evaluate((root/'probe-page.js').read_text(encoding='utf-8'))
 r=page.evaluate("globalThis.__FB_BUR_PROBE_RESULT__")
 assert r['url_identity_loose']['id']=='1761943778250990',r
 assert r['old_strict_identity'] is None,r
 assert r['selected_post_identity']['id']=='1761943778250990',r
 assert r['target_found'] is True,r
 assert r['visible_dialog_count']==1,r
 assert r['dialogs'][0]['begins_publication'] is True,r
 assert r['dialogs'][0]['media'] is True,r
 assert 'comments' not in r and 'post_text' not in r,r
 print('PASS: probe exposes URL/dialog decision without collecting archive content')
 b.close()
