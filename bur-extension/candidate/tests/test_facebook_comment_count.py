"""0.5.28: Facebook's own comment total from the post's comment-button label (found live 31.10.2026:
"Comment on Misha Roo's post, 33 comments"). Reaction buttons and per-comment labels are ignored;
abbreviated totals ("1,2 тыс.") are not treated as exact."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
def page_with(btn):
    return f'''<!doctype html><div role="article" id="post">
 <div role="button" aria-label="Поставить Нравится публикации Misha Roo"><span>413</span></div>
 {btn}
 <div role="article"><div aria-label="Комментарий Liliya Litva 2 дня назад">x</div>
  <div role="button" aria-label="1 реакция: посмотрите, кто отреагировал на комментарий">1</div></div>
</div>'''
cases = [
  ('<div role="button" aria-label="Comment on Misha Roo\'s post, 33 comments"><span>33</span></div>', 33),
  ('<div role="button" aria-label="Комментировать публикацию Misha Roo, 1 234 комментария"></div>', 1234),
  ('<div role="button" aria-label="Комментарии: 1,2 тыс. комментариев"></div>', None),
  ('<div role="button" aria-label="Comment on Misha Roo\'s post"></div>', None),
]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--no-sandbox']); page = b.new_page()
    for html, want in cases:
        page.set_content(page_with(html)); page.evaluate((root/'core.js').read_text(encoding='utf-8'))
        got = page.evaluate("FBBurCore.facebookCommentCount(document.getElementById('post'))")
        assert got == want, (html, got, want)
    print('PASS: Facebook comment total read from the comment button; reactions/comment labels ignored; abbreviated totals not exact')
    b.close()
