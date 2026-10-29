from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
source=(root/'content.js').read_text(encoding='utf-8')
helper=source[source.index('async function harvestOwnedCommentDialog'):source.index('async function handleObstruction')]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page()
 for scenario in ['stuck','pause','detach']:
  page.set_content('<div id="dialog"><button id="more">View more replies</button><button aria-label="Close" onclick="this.parentNode.remove()">x</button><div role="article"><a href="/profile.php?id=12345678">Fixture Author</a><div data-testid="comment_message">Saved reply</div><a href="/groups/fixture/posts/1700000000000001/?comment_id=90000001">time</a></div></div>')
  page.evaluate((root/'core.js').read_text(encoding='utf-8'))
  result=page.evaluate('(async()=>{const C=FBBurCore;const delay=async()=>{};const F={advanceDialog:async()=>({moved:false})};const closeOwnedDialog=d=>d?.querySelector("button[aria-label]")?.click();let saved=[],paused=false;const job={id:"fixture",stage:"deep",group:"fixture",queue:["1700000000000001"],index:0};const send=async(type,msg)=>{if(type==="status")return {...job,paused};if(type==="deepProgress"){saved.push(msg.post);if('+repr(scenario)+'==="pause")paused=true;if('+repr(scenario)+'==="detach")document.querySelector("#dialog").remove();return {captured:true,paused,stage:"deep"};}};'+helper+';const result=await harvestOwnedCommentDialog(document.querySelector("#dialog"),job,job.queue[0]);return {result,saved,closed:!document.querySelector("#dialog")};})()')
  assert result['closed'] and result['saved'],result
  assert result['saved'][-1]['comments'][0]['id']=='90000001',result
  assert result['result']['paused']==(scenario=='pause'),result
  if scenario!='pause':assert result['result']['blocked'],result
 b.close()
print('PASS owned thread persists comments before pause/detach, closes only its dialog, and reports ineffective expansion as incomplete')
