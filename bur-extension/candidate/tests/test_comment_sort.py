"""Rendered sorting menus: ownership, selection proof, pause, and unknown layouts."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page()
 for scenario in ['linked','fresh','replacement','foreign','ambiguous','unconfirmed','pause','no_selector','multiple','already']:
  page.set_content('<article id="post"><button id="sort" aria-haspopup="menu" aria-expanded="false">Most relevant</button></article>')
  page.evaluate((root/'core.js').read_text(encoding='utf-8'))
  page.evaluate('''scenario=>{
   window.optionClicks=0;window.controlClicks=0;
   const root=document.querySelector('#post'),control=document.querySelector('#sort');
   const menu=(id)=>{const el=document.createElement('div');el.id=id;el.setAttribute('role','menu');el.innerHTML='<button role="menuitemradio">All comments</button>';document.body.appendChild(el);el.firstChild.onclick=()=>{window.optionClicks++;if(scenario!=='unconfirmed'){control.textContent='All comments';control.setAttribute('aria-expanded','false');if(scenario==='replacement')control.replaceWith(control.cloneNode(true));el.remove();}};return el;};
   if(scenario==='already')control.textContent='All comments';
   if(scenario==='no_selector')control.removeAttribute('aria-haspopup');
   if(scenario==='multiple')root.appendChild(control.cloneNode(true));
   if(scenario==='foreign'){menu('foreign');control.setAttribute('aria-controls','foreign');}
   control.onclick=()=>{window.controlClicks++;if(control.getAttribute('aria-expanded')==='true'){control.setAttribute('aria-expanded','false');document.querySelector('#owned')?.remove();return;}control.setAttribute('aria-expanded','true');if(scenario==='linked')control.setAttribute('aria-controls','owned');menu('owned');if(scenario==='ambiguous')menu('other');};
  }''',scenario)
  result=page.evaluate('''async scenario=>FBBurCore.ensureAllComments(document.querySelector('#post'),{wait:async()=>{},stopped:async()=>scenario==='pause'&&window.controlClicks>0})''',scenario)
  clicks=page.evaluate('({options:window.optionClicks,controls:window.controlClicks})')
  if scenario in ['linked','fresh','replacement','already']:
   assert result['verified'],(scenario,result)
   assert clicks['options']==(0 if scenario=='already' else 1),(scenario,clicks)
  elif scenario=='no_selector':
   assert result['status']=='not_exposed' and not result['verified'] and not clicks['controls'],result
  elif scenario=='pause':
   assert result['paused'] and not clicks['options'],result
  else:
   assert result['known_incomplete'] and not result['verified'],(scenario,result)
   assert clicks['options']==(1 if scenario=='unconfirmed' else 0),(scenario,clicks)
  assert not page.locator('#owned').count(),(scenario,'collector-owned menu must close before returning')
  if scenario=='foreign':assert page.locator('#foreign').count()==1,'foreign preexisting menu must survive'
 b.close()
print('PASS comment sorting requires an owned visible menu and observed selection; foreign/ambiguous menus, pause and unsupported layout never claim all-comments coverage')
