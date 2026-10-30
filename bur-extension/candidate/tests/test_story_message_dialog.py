"""Regression for 0.5.25 (found live on backpackIL, 30.10.2026).

1. Facebook now marks some post bodies only with data-ad-rendering-role="story_message"
   (no data-ad-comet-preview / post_message). Such cards used to stay unresolved.
2. A permalink opens the post in a role=dialog over the group feed. The fallback root
   must be the dialog post, never a background feed post that gets the expected ID.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
GROUP = 'backpackIL'
NUM_GROUP = '1234567890'
WANT = '1770984550680246'
OTHER = '1770000000000001'
LOC = f'https://www.facebook.com/groups/{GROUP}/posts/{WANT}/'
LONG = 'Ищем попутчиков на маршрут Израильской тропы в ноябре, нужен совет по снаряжению и воде. ' * 3

html = f'''<!doctype html><html><body>
<div role="feed">
 <div role="article" id="bg">
  <a href="/groups/{NUM_GROUP}/?multi_permalinks={OTHER}&amp;ref=share">2 ч.</a>
  <div data-ad-rendering-role="story_message">Фоновый пост из ленты, его нельзя принять за открытый пост. Достаточно длинный текст для карточки.</div>
 </div>
</div>
<div role="dialog" aria-modal="true" style="position:fixed;top:0;left:0;width:800px;height:700px;background:#fff;overflow:auto">
 <div role="article" id="want">
  <div data-ad-rendering-role="story_message">{LONG}</div>
  <div role="article"><a href="/groups/{GROUP}/user/555/">Комментатор</a><div>Возьмите фильтр для воды.</div><a href="/groups/{GROUP}/posts/{WANT}/?comment_id=901">1 дн.</a></div>
 </div>
</div>
</body></html>'''

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 1200, 'height': 900})
    page.set_content(html)
    page.evaluate((root / 'core.js').read_text(encoding='utf-8'))

    r = page.evaluate(f'''() => {{
      const root = FBBurCore.permalinkPostRoot(document, '{GROUP}', '{LOC}');
      return root ? {{inDialog: Boolean(root.closest('[role="dialog"]')),
                      card: FBBurCore.extractCard(root, '{GROUP}', '{LOC}')}} : null;
    }}''')
    assert r, 'no permalink root found for story_message-only post'
    assert r['inDialog'], 'fallback root taken from background feed instead of the post dialog'
    card = r['card']
    assert card and card['post_id'] == WANT, card
    assert 'Израильской тропы' in card['post_text'], card['post_text']
    assert 'Фоновый пост' not in card['post_text'], 'background feed text leaked into the post'
    assert any(c['id'] == '901' for c in card['comments']), card['comments']

    bg = page.evaluate(f'''() => FBBurCore.extractCard(document.getElementById('bg'), '{GROUP}', '{LOC}')''')
    assert not bg or bg.get('post_id') != WANT, f'background post received the permalink ID: {bg}'

    print('PASS: story_message-only body is read; permalink dialog wins over background feed post; feed post never gets the permalink ID')
    b.close()
