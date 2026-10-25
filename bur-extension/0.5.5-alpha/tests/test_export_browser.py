from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=browser.new_page(accept_downloads=True)
 html=(root/'export.html').read_text(encoding='utf-8').replace('<script src="export.js"></script>','')
 script=(root/'export.js').read_text(encoding='utf-8')
 def setup(mode):
  page.set_content(html)
  page.evaluate('''mode => {
   window.calls=[];
   window.chrome={runtime:{getManifest:()=>({version_name:'0.5.5-alpha'}),sendMessage:async msg=>{
    window.calls.push(msg);
    if(mode==='ignored')return {ok:true,result:{ignored:true}};
    if(mode==='error')return {ok:false,error:'storage unavailable'};
    const count=mode==='empty'?0:53;
    return {ok:true,result:{job:{id:'saved',group:'backpackIL',stage:'done',options:{maxPosts:count},queue:Array(count).fill('id'),deepDone:count,deepErrors:0},total:count,items:Array.from({length:count},(_,i)=>({post_id:String(i),comments:[{text:'saved comment '+i}]})).slice(msg.offset,msg.offset+msg.limit)}};
   }}};
  }''',mode)
 setup('saved')
 with page.expect_download() as event:
  page.evaluate(script)
 download=event.value
 data=json.loads(Path(download.path()).read_text(encoding='utf-8'))
 assert len(data['posts'])==53 and data['posts'][-1]['comments'][0]['text']=='saved comment 52'
 assert data['collector_version']=='0.5.5-alpha'
 assert page.evaluate('window.calls.map(x=>x.offset)')==[0,50]
 assert download.suggested_filename.startswith('bur-raw-backpackIL-')
 with page.expect_download() as event: page.click('#again')
 assert json.loads(Path(event.value.path()).read_text(encoding='utf-8'))==data
 assert page.evaluate('window.calls.length')==2
 setup('empty')
 with page.expect_download() as event: page.evaluate(script)
 assert json.loads(Path(event.value.path()).read_text(encoding='utf-8'))['posts']==[]
 for mode in ['ignored','error']:
  setup(mode);page.evaluate(script)
  page.wait_for_function("document.querySelector('#status').textContent.startsWith('Ошибка:')")
  status=page.locator('#status').inner_text()
  assert 'is not iterable' not in status,status
  assert ('exportSlice' if mode=='ignored' else 'storage unavailable') in status,status
 print('PASS: export browser download, 53 posts/pagination/comments, repeat download, empty archive, ignored/malformed reply and API error')
 browser.close()
