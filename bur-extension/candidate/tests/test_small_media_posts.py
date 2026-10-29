"""Short, link-only and media-only posts must not disappear behind a text-length guard."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
group='media-fixture';base='https://www.facebook.com/groups/'+group+'/posts/'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page();page.route('**/*',lambda route:route.abort())
 def capture(body):
  page.set_content('<article role="article" id="post"><h3><a href="/profile.php?id=12345678">Li</a></h3><a href="'+base+'1700000000000001/">1 ч</a>'+body+'</article>')
  page.evaluate((root/'core.js').read_text(encoding='utf-8'))
  return page.evaluate("FBBurCore.extractCard(document.querySelector('#post'),'media-fixture','https://www.facebook.com/groups/media-fixture/')")
 photo=capture('<a href="/photo.php?fbid=999"><img src="https://cdn.example/large.jpg" width="600" height="400"></a>')
 assert photo is not None,'short media-only post was lost'
 assert photo['post_text']=='' and photo['post_text_quality']=='media_only',photo
 assert photo['media'][0]['kind']=='image' and photo['post_id']=='1700000000000001'
 page.evaluate("()=>{const post=document.querySelector('#post'),unit=document.createElement('div');unit.id='unit';unit.dataset.pagelet='FeedUnit_1';post.before(unit);unit.innerHTML='<span aria-label=\"Pinned post\"></span>';unit.append(post)}")
 wrapped=page.evaluate("FBBurCore.extractCard(document.querySelector('#unit'),'media-fixture','https://www.facebook.com/groups/media-fixture/')")
 assert wrapped and wrapped['post_id']==photo['post_id'] and wrapped['author']=='Li' and wrapped['is_pinned'],wrapped
 link=capture('<div data-ad-preview="message"><a href="https://example.org/x">K</a></div>')
 assert link is not None and link['post_text']=='K' and link['links'][0]['url']=='https://example.org/x',link
 preview=capture('<a href="https://example.org/preview">K</a>')
 assert [x['url'] for x in preview['links']]==['https://example.org/preview'],preview
 blob='blob:https://www.facebook.com/00000000-0000-4000-8000-000000000001'
 video=capture('<video src="'+blob+'" poster="https://cdn.example/poster.jpg"></video><div role="article"><a href="/profile.php?id=87654321">Bo</a><a href="'+base+'1700000000000001/?comment_id=99887766">1 ч</a><video src="blob:https://www.facebook.com/00000000-0000-4000-8000-000000000002"></video></div>')
 assert len(video['media'])==1 and video['media'][0]['kind']=='video',video
 media=video['media'][0];assert media['url'] is None and media['temporary_url']==blob and media['availability']=='temporary_blob_only',media
 assert media['source_url']==base+'1700000000000001/' and media['poster']=='https://cdn.example/poster.jpg',media
 c=video['comments'][0];assert c['id']=='99887766' and c['text']=='' and len(c['media'])==1,c
 assert 'comment_id=99887766' in c['media'][0]['source_url']
 merged=page.evaluate('(r)=>FBBurCore.mergePosts(r,r,r.group)',video)
 assert len(merged['media'])==1 and len(merged['comments'][0]['media'])==1
 page.set_content('<article role="article" id="post"><div data-ad-preview="message">Quoted publication <a href="'+base+'1700000000000999/">reference</a></div><div role="article"><a href="'+base+'1700000000000888/?comment_id=99887766">comment reference</a></div></article>')
 page.evaluate((root/'core.js').read_text(encoding='utf-8'))
 assert page.evaluate("FBBurCore.extractCard(document.querySelector('#post'),'media-fixture','https://www.facebook.com/groups/media-fixture/')") is None
 own=page.evaluate("FBBurCore.extractCard(document.querySelector('#post'),'media-fixture','https://www.facebook.com/groups/media-fixture/posts/1700000000000001/')")
 assert own['post_id']=='1700000000000001' and own['links'][0]['url'].endswith('/1700000000000999/'),own
 b.close()
print('PASS short photo-only/link-only posts, empty text preserved, blob video metadata without pretending it is a permanent URL, post/comment ownership and repeated snapshot retention')
