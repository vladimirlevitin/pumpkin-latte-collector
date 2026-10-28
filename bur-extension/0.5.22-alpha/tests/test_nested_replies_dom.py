from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
ID='1761136774998357'
html=f'''<!doctype html><html><body>
<div role="article" id="post">
 <a href="/groups/backpackIL/posts/{ID}/">post</a>
 <div data-ad-comet-preview="message">Пост про открытые дома</div>
 <div role="article" id="c1">
   <a href="/groups/backpackIL/user/100004442703181/">Наташа Островская</a>
   <div data-testid="comment_message">Основной комментарий</div>
   <a href="/groups/backpackIL/posts/{ID}/?comment_id=555">1 нед.</a>
   <div role="article" id="r1">
     <a href="/groups/backpackIL/user/100009991112223/">Рита Коган</a>
     <div data-testid="comment_message">Вложенный ответ</div>
     <a href="/groups/backpackIL/posts/{ID}/?comment_id=555&reply_comment_id=556">6 дн.</a>
   </div>
 </div>
</div>
</body></html>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=b.new_page();page.set_content(html);page.evaluate((root/'core.js').read_text(encoding='utf-8'))
 row=page.evaluate(f"FBBurCore.extractCard(document.getElementById('post'),'backpackIL','https://www.facebook.com/groups/backpackIL/posts/{ID}/')")
 by={c['id']:c for c in row['comments']}
 assert '555' in by, row['comments']
 assert '556' in by, row['comments']
 assert by['555']['author']=='Наташа Островская', by['555']
 assert by['556']['author']=='Рита Коган', by['556']
 assert by['556']['parent_id']=='555', by['556']
 print('PASS: group-user authors + reply_comment_id + parent_id')
 b.close()
