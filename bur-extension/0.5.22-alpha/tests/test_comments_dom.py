from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
core=(root/'core.js').read_text(encoding='utf-8')
html='''<div role="article" id="post"><a href="/groups/backpackIL/posts/17777111999/">Дата</a>
<div data-ad-comet-preview="message">Карта маршрута и ночлега. Как добраться до озера?</div>
<div role="article" id="c1"><a href="/people/Marina/123456">Марина В</a>
<div data-testid="comment_message">Съезд с трассы у моста, дальше 2 км пешком.</div>
<a href="/groups/backpackIL/posts/17777111999/?comment_id=998877">2 дня назад</a>
<button id="more" role="button" onclick="document.getElementById('c2').style.display='block'">Смотреть другие комментарии</button>
</div><div role="article" id="c2" style="display:none"><a href="/people/Natalia/32333">Наталья К</a>
<div data-testid="comment_message">Остановка автобуса находится внизу у поворота.</div></div>
</div>'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True, args=['--no-sandbox']);page=b.new_page()
 page.set_content(html)
 page.evaluate(core)
 before=page.evaluate('''() => FBBurCore.extractCard(document.getElementById('post'),'backpackIL',location.href)''')
 assert before['post_text'].startswith('Карта маршрута'), before['post_text']
 assert len(before['comments'])==1,before['comments']
 c=before['comments'][0]
 assert c['author']=='Марина В',c
 assert c['id']=='998877' and 'comment_id=998877' in c['permalink'],c
 assert c['parent_id'] is None,c
 after_click=page.evaluate('''() => FBBurCore.expandVisible([document.getElementById('post')],3,'deep')''')
 assert after_click>=1,after_click
 after=page.evaluate('''() => FBBurCore.extractCard(document.getElementById('post'),'backpackIL',location.href)''')
 assert len(after['comments'])==2,after['comments']
 assert after['comments'][1]['author']=='Наталья К',after['comments']
 print('PASS: detailed DOM captures isolated text, visible author/link, expands more comments; no invented parent')
 b.close()
