"""0.5.26: exact publication time from the timestamp hover tooltip.

Facebook shows only "3 дн." on the card; the exact moment appears in a role=tooltip
("Вторник, 27 октябрь 2026 г. в 13:46") when the timestamp link is hovered.
Checks: the post's own timestamp is hovered (not a comment's), the tooltip is parsed,
and the exact date survives merging with later approximate observations.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
ID = '1770984550680246'
html = f'''<!doctype html><html><body>
<div role="dialog" style="position:fixed;top:0;left:0;width:800px;height:700px">
 <div role="article" id="post">
  <a id="ts" href="/groups/1234/?multi_permalinks={ID}&ref=x" data-tip="Вторник, 27 октябрь 2026 г. в 13:46">3 дн.</a>
  <div data-ad-rendering-role="story_message">Тысячи пеликанов на пути в тёплые края. Достаточно длинный текст для карточки поста.</div>
  <div role="article"><a href="/groups/backpackIL/posts/{ID}/?comment_id=901" data-tip="Среда, 28 октябрь 2026 г. в 09:00">2 дн.</a><div>Комментарий</div></div>
 </div>
</div>
<script>
 // Facebook-like tooltip: appears on hover, disappears on leave.
 document.addEventListener('mouseover', e => {{
   const a = e.target.closest && e.target.closest('a[data-tip]'); if (!a) return;
   window.hovered = (window.hovered || []).concat(a.id || 'comment');
   setTimeout(() => {{ const t = document.createElement('div'); t.setAttribute('role','tooltip'); t.textContent = a.dataset.tip; t.className='tip'; document.body.appendChild(t); }}, 300);
 }});
 document.addEventListener('mouseout', e => {{ document.querySelectorAll('.tip').forEach(t => t.remove()); }});
</script>
</body></html>'''

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--no-sandbox'])
    page = b.new_page(timezone_id='Asia/Jerusalem')
    page.set_content(html)
    page.evaluate((root / 'core.js').read_text(encoding='utf-8'))
    r = page.evaluate('''async () => FBBurCore.hoverExactDate(document.getElementById('post'))''')
    assert r['status'] == 'ok', r
    assert page.evaluate('window.hovered') == ['ts'], 'hovered something other than the post timestamp'
    # 13:46 in Israel (UTC+2 on 27.10.2026) = 11:46 UTC
    assert r['published_at'] == '2026-10-27T11:46:00.000Z', r
    assert r['published_date'] == '2026-10-27' and r['date_precision'] == 'minute', r
    assert r['date_source'] == 'hover_tooltip' and r['published_label'] == '3 дн.', r
    assert r['date_timezone'] == 'Asia/Jerusalem', r
    assert page.evaluate("document.querySelectorAll('[role=tooltip]').length") == 0, 'tooltip left open'

    # Exact date beats a later approximate observation, in either merge order.
    m = page.evaluate('''(exact) => {
      const base = {group:'backpackIL', post_id:'%s', post_text:'x', comments:[]};
      const approx = {...base, ...FBBurCore.estimateRelativeDate('3 дн.'), published_label:'3 дн.'};
      const precise = {...base, ...exact};
      return [FBBurCore.mergePosts(precise, approx, 'backpackIL'), FBBurCore.mergePosts(approx, precise, 'backpackIL')];
    }''' % ID, r)
    for x in m:
        assert x['published_at'] == '2026-10-27T11:46:00.000Z' and x['date_precision'] == 'minute', x
        assert not x.get('published_estimated_at'), x

    # No tooltip -> honest failure, nothing invented.
    page.evaluate("document.getElementById('ts').removeAttribute('data-tip')")
    none = page.evaluate('''async () => FBBurCore.hoverExactDate(document.getElementById('post'))''')
    assert none['status'] == 'no_tooltip' and 'published_at' not in none, none

    print('PASS: post timestamp hovered (not a comment), tooltip parsed to exact UTC with timezone, exact date survives merges, no tooltip -> no invented date')
    b.close()
