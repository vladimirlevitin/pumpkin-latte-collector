from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':470,'height':720})
 html=(root/'popup.html').read_text(encoding='utf-8').replace('<script src="popup.js"></script>','')
 page.set_content(html)
 page.evaluate('''() => {
 window.calls=[];window.job=null;window.activeUrl='https://www.facebook.com/groups/backpackIL/';window.lastStart=null;
 const result=(value)=>({ok:true,result:value});
 window.chrome={runtime:{getManifest:()=>({version_name:'0.5.9-alpha'}),sendMessage:async(msg)=>{
 window.calls.push(msg.type);
 if(msg.type==='status')return result(window.job);
 if(msg.type==='start'){window.lastStart=msg;const g=new URL(msg.url).pathname.split('/')[2];window.job={group:g,tabId:5,stage:'discover',discovered:0,deepDone:0,deepErrors:0,queue:[],steps:0,options:{maxPosts:20},paused:false};return result(window.job);}
 if(msg.type==='collectFound'){window.job.stage='deep';window.job.queue=['1','2','3'];window.job.paused=false;return result(window.job);}
 if(msg.type==='pause'){window.job.paused=true;return result(window.job);}
 if(msg.type==='resume'){window.job.paused=false;return result(window.job);}
 return result(null);
 },getURL:x=>'chrome-extension://test/'+x},
 tabs:{query:async()=>[{id:5,url:window.activeUrl}],create:async()=>{window.calls.push('exportTab');}}};
 }''')
 page.evaluate((root/'popup.js').read_text(encoding='utf-8'))
 page.click('#start');page.wait_for_function("window.calls.includes('start') && document.querySelector('#status').innerText.includes('Разведка')")
 page.click('#collect');page.wait_for_function("window.calls.includes('collectFound') && document.querySelector('#status').innerText.includes('Подробное')")
 assert page.evaluate("window.calls.filter(x=>x==='resume').length")==0,'Collect button must not require a second resume'
 page.click('#pause');page.wait_for_function("window.calls.includes('pause') && document.querySelector('#status').innerText.includes('пауза')")
 page.evaluate("window.activeUrl='https://www.facebook.com/groups/pumpkinlatte/'")
 page.click('#start');page.wait_for_function("window.job && window.job.group==='pumpkinlatte'")
 assert page.evaluate("window.lastStart.replacePaused===true"),'paused foreign-group job must be replaced, not resumed'
 assert page.evaluate("window.calls.filter(x=>x==='resume').length")==0,'cross-group Start must never resume old job'
 page.click('#export');page.wait_for_function("window.calls.includes('exportTab')")
 assert 'Gemini' not in page.content()
 print('PASS: popup buttons: Start->discover, Collect->deep with NO second Resume, Pause, Export')
 browser.close()
