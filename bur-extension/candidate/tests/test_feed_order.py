"""Composite heading/dialog sort control matches the observed Facebook feed structure."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page()
 for scenario in ['already','select','unknown','foreign','ambiguous','unconfirmed','pause','missing','post_control']:
  page.set_content('<main><div id="sort" role="button" aria-haspopup="dialog" aria-expanded="false">сортировать ленту группы по параметру<h2>Новые действия</h2></div></main>')
  page.evaluate((root/'core.js').read_text(encoding='utf-8'))
  page.evaluate('''scenario=>{
   window.clicked=0;const control=document.querySelector('#sort');
   const panel=id=>{const d=document.createElement('div');d.id=id;d.setAttribute('role','dialog');d.innerHTML='<div role="button">Новые публикации<br>Сначала недавние публикации</div>';document.body.appendChild(d);d.firstChild.onclick=()=>{window.clicked++;if(scenario!=='unconfirmed'){control.querySelector('h2').textContent='Новые публикации';control.setAttribute('aria-expanded','false');d.remove();}};return d;};
   if(scenario==='already')control.querySelector('h2').textContent='Новые публикации';
   if(scenario==='unknown')control.querySelector('h2').textContent='Недокументированный порядок';
   if(scenario==='foreign'){panel('foreign');control.setAttribute('aria-controls','foreign');}
   if(scenario==='missing')control.remove();
   if(scenario==='post_control'){const post=document.createElement('div');post.setAttribute('role','article');document.querySelector('main').appendChild(post);post.appendChild(control);}
   control.onclick=()=>{if(control.getAttribute('aria-expanded')==='true'){control.setAttribute('aria-expanded','false');document.querySelector('#owned')?.remove();return;}control.setAttribute('aria-expanded','true');panel('owned');if(scenario==='ambiguous')panel('other');};
  }''',scenario)
  result=page.evaluate('''async scenario=>FBBurCore.ensureNewPosts(document,{wait:async()=>{},stopped:async()=>scenario==='pause'&&document.querySelector('#owned')!==null})''',scenario)
  clicks=page.evaluate('window.clicked')
  if scenario in ['already','select','unknown']:
   assert result['verified'] and result['order']=='new_posts',(scenario,result)
   assert clicks==(0 if scenario=='already' else 1),(scenario,clicks)
  else:
   assert not result['verified'],(scenario,result)
   assert clicks==(1 if scenario=='unconfirmed' else 0),(scenario,clicks)
  if scenario=='foreign':assert page.locator('#foreign').count()==1
 b.close()
print('PASS composite feed heading and owned dialog support verified New posts; foreign/ambiguous panels, pause, nested-post controls and unconfirmed selections fail closed')
