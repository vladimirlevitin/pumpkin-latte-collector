"""Real content protocol: ranked comments become visible, or the same post stalls."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
post_id='1700000000000001'
url='https://www.facebook.com/groups/sort-fixture/posts/'+post_id+'/'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for selected in [True,False]:
  page=browser.new_page()
  page.set_content('''<article role="article" id="post"><a href="/groups/sort-fixture/posts/1700000000000001/">Date</a><div data-ad-preview="message">Post with a ranked comment view and a hidden second comment.</div><button id="sort" aria-haspopup="menu" aria-expanded="false">Most relevant</button><div id="thread"></div></article>''')
  page.evaluate('''selected=>{
   const control=document.querySelector('#sort'),thread=document.querySelector('#thread');
   const row=n=>'<div role="article"><a href="/profile.php?id=12345678">Fixture Author</a><div data-testid="comment_message">Comment '+n+'</div><a href="/groups/sort-fixture/posts/1700000000000001/?comment_id='+(90000000+n)+'">time</a></div>';
   thread.innerHTML=row(1);
   control.onclick=()=>{if(control.getAttribute('aria-expanded')==='true'){document.querySelector('#menu')?.remove();control.setAttribute('aria-expanded','false');return;}control.setAttribute('aria-expanded','true');control.setAttribute('aria-controls','menu');const menu=document.createElement('div');menu.id='menu';menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitemradio">All comments</button>';document.body.appendChild(menu);menu.firstChild.onclick=()=>{if(selected){control.textContent='All comments';control.setAttribute('aria-expanded','false');thread.innerHTML=row(1)+row(2);menu.remove();}};};
   window.testJob={id:'sort-integration',stage:'deep',tabRole:'deep',group:'sort-fixture',paused:false,queue:['1700000000000001'],index:0,deepPhase:'READY'};
   window.snapshots=[];window.passEnds=[];window.saved=[];
   window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async msg=>{
    if(msg.type==='status')return {ok:true,result:window.testJob};
    if(msg.type==='deepReady'||msg.type==='deepExpanding'){window.testJob.deepPhase=msg.type==='deepReady'?'READY':'EXPANDING';return {ok:true,result:window.testJob};}
    if(msg.type==='deepProgress'){window.saved.push(msg.post);return {ok:true,result:{captured:true,stage:'deep'}};}
    if(msg.type==='deepSnapshot'||msg.type==='deepPassEnd'){(msg.type==='deepSnapshot'?window.snapshots:window.passEnds).push(msg);window.testJob.paused=true;return {ok:true,result:{ok:true}};}
    if(msg.type==='deepError'||msg.type==='obstructed')throw Error(JSON.stringify(msg));
    return {ok:true,result:{ready:true}};
   }}};
  }''',selected)
  for file in ['core.js','feed-scroll.js']:page.evaluate((root/file).read_text(encoding='utf-8'))
  page.evaluate('BurFeedScroll.advance=async()=>({moved:false,tries:[]})')
  source=(root/'content.js').read_text(encoding='utf-8').replace('location.pathname',repr('/groups/sort-fixture/posts/'+post_id+'/')).replace('location.href',repr(url))
  source=source.replace('const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));','const delay=()=>Promise.resolve();')
  page.evaluate(source)
  page.wait_for_function('window.snapshots.length+window.passEnds.length===1',timeout=15000)
  data=page.evaluate('({snapshots:window.snapshots,passes:window.passEnds,saved:window.saved})')
  if selected:
   assert not data['passes'] and len(data['snapshots'])==1,data
   snapshot=data['snapshots'][0]
   assert snapshot['coverage']['comment_sort']['verified'],snapshot
   assert {c['id'] for c in snapshot['post']['comments']}=={'90000001','90000002'},snapshot
   assert data['saved'],data
  else:
   assert not data['snapshots'] and len(data['passes'])==1,data
   assert data['passes'][0]['coverage']['known_incomplete'],data
   assert not data['passes'][0]['coverage']['comment_sort']['verified'],data
  page.close()
 browser.close()
print('PASS real content selects All comments and captures newly exposed data; unconfirmed selection produces incomplete pass, never final snapshot')
