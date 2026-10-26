from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
ID='1777000011223344'
html=f'''<!doctype html><html><body>
<div id="shell">
 <div data-ad-comet-preview="message">Пост без role=article вокруг основной публикации, но с нормальным телом текста.</div>
 <div id="comments">
  <div role="article"><a href="/groups/backpackIL/user/12345/">Автор ответа</a><div data-testid="comment_message">Полезный комментарий</div><a href="/groups/backpackIL/posts/{ID}/?comment_id=901">1 дн.</a></div>
 </div>
 <div contenteditable="true" role="textbox">Комментировать</div>
</div>
</body></html>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);page=b.new_page();page.set_content(html);page.evaluate((root/'core.js').read_text(encoding='utf-8'))
 r=page.evaluate(f'''() => {{ const root=FBBurCore.permalinkPostRoot(document,'backpackIL','https://www.facebook.com/groups/backpackIL/posts/{ID}/'); return root ? FBBurCore.extractCard(root,'backpackIL','https://www.facebook.com/groups/backpackIL/posts/{ID}/') : null; }}''')
 assert r and r['post_id']==ID, r
 assert 'Пост без role=article' in r['post_text'], r
 assert any(c['id']=='901' for c in r['comments']), r['comments']
 print('PASS: permalink post without role=article still gets a fallback root and comments')
 b.close()
