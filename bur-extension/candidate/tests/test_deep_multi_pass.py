"""Controlled virtualized DOM/clock tests the real content protocol across the 32-cycle budget.

Physical scrolling has separate browser tests; this fixture deterministically replaces
the visible comment slice on each advance and accelerates only the test clock.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
url='https://www.facebook.com/groups/protocol-fixture/posts/1700000000000001/'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page()
 page.set_content('''<article role="article" id="post"><a href="/groups/protocol-fixture/posts/1700000000000001/">Date</a><div data-ad-preview="message">Long discussion protocol fixture with explicit verified post identity.<button onclick="window.expansionClicks++;this.remove()">See more</button></div><div id="thread"></div></article>''')
 for name in ['core.js','feed-scroll.js']:page.evaluate((root/name).read_text(encoding='utf-8'))
 page.evaluate('window.expansionClicks=0')
 assert page.evaluate("FBBurCore.expandVisible([document.querySelector('#post')],10,'deep',true)")==1
 assert page.evaluate('window.expansionClicks')==0,'inspection must not click controls'
 assert page.evaluate("FBBurCore.expandVisible([document.querySelector('#post')],1,'deep')")==1
 assert page.evaluate('window.expansionClicks')==1
 page.evaluate('''()=>{
  window.testJob={id:'multi-pass',stage:'deep',tabRole:'deep',group:'protocol-fixture',paused:false,queue:['1700000000000001'],index:0,deepPhase:'READY'};
  window.persisted=null;window.snapshots=[];window.passEnds=0;window.progressCount=0;window.slice=0;
  const render=()=>document.querySelector('#thread').innerHTML='<div role="article"><a href="/profile.php?id=12345678">Fixture Author</a><div data-testid="comment_message">Comment '+window.slice+'</div><a href="/groups/protocol-fixture/posts/1700000000000001/?comment_id='+(90000000+window.slice)+'">time</a></div>';
  render();BurFeedScroll.advance=async()=>{if(window.slice<69){window.slice++;render();return {moved:true,tries:[]}}return {moved:false,tries:[]}};
  const persist=post=>window.persisted=FBBurCore.mergePosts(window.persisted,post,'protocol-fixture');
  window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async msg=>{
   if(msg.type==='status')return {ok:true,result:window.testJob};
   if(msg.type==='deepReady'||msg.type==='deepExpanding'){window.testJob.deepPhase=msg.type==='deepReady'?'READY':'EXPANDING';return {ok:true,result:window.testJob}};
   if(msg.type==='deepProgress'){persist(msg.post);window.progressCount++;return {ok:true,result:{captured:true,stage:'deep'}}};
   if(msg.type==='deepPassEnd'){persist(msg.post);window.passEnds++;window.testJob.deepPhase='READY';return {ok:true,result:{continue:true}}};
   if(msg.type==='deepSnapshot'){persist(msg.post);window.snapshots.push(msg);window.testJob.paused=true;return {ok:true,result:{ok:true}}};
   if(msg.type==='deepError'||msg.type==='obstructed')throw Error('unexpected '+JSON.stringify(msg));
   return {ok:true,result:{ready:true}};
  }}};
 }''')
 source=(root/'content.js').read_text(encoding='utf-8')
 source=source.replace('location.pathname',repr('/groups/protocol-fixture/posts/1700000000000001/')).replace('location.href',repr(url))
 source=source.replace('const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));','const delay=()=>Promise.resolve();').replace('setTimeout(tick,900)','setTimeout(tick,0)').replace('setInterval(tick,2600)','setInterval(tick,10)')
 page.evaluate(source);page.wait_for_function('window.snapshots.length===1',timeout=20000)
 data=page.evaluate('({comments:window.persisted.comments,passes:window.passEnds,progress:window.progressCount,coverage:window.snapshots[0].coverage})')
 assert data['passes']>=2 and data['progress']>64,data
 assert {c['id'] for c in data['comments']}=={str(90000000+i) for i in range(70)},data
 assert data['coverage']['settled'] and data['coverage']['remaining_controls']==0,data
 b.close()
print('PASS real content protocol traverses 70 virtualized slices across multiple bounded passes, preserves every comment through durable snapshots, and dry-run inspection performs no clicks')
