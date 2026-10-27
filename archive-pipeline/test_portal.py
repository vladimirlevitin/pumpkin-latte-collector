from pathlib import Path
import json,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent/'portal'
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='chromium',headless=True)
  ctx=browser.new_context(viewport={'width':390,'height':844})
  ctx.route('**/portal-config.js',lambda r:r.fulfill(body="window.BUR_CONFIG={supabaseUrl:'https://staging.example',publishableKey:'sb_publishable_test',apiUrl:'https://api.example/search'};",content_type='application/javascript'))
  ctx.route('https://staging.example/**',lambda r:r.fulfill(json={'access_token':'test-token'}))
  mode=['ok'];sent=[]
  def api(route):
   if route.request.method=='OPTIONS':route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type'});return
   sent.append(route.request.headers.get('authorization'))
   if mode[0]=='expired':route.fulfill(status=401,json={},headers={'access-control-allow-origin':'*'});return
   if mode[0]=='denied':route.fulfill(status=403,json={},headers={'access-control-allow-origin':'*'});return
   route.fulfill(json={'semantic_used':False,'warning':'fallback','results':[{'text':'<img src=x onerror="window.pwned=true"> camping','url':'javascript:alert(1)','capture_status':'unknown'},{'text':'route for families','url':'https://www.facebook.com/groups/one/posts/1700000000000001/','topics':['Camping'],'capture_status':'captured_unverified'}]},headers={'access-control-allow-origin':'*'})
  ctx.route('https://api.example/**',api)
  page=ctx.new_page();page.goto('http://127.0.0.1:'+str(server.server_port))
  expect(page.locator('#archive')).to_be_hidden()
  def login():
   page.fill('#email','test@example.com');page.fill('#password','test-password');page.click('#signIn');expect(page.locator('#archive')).to_be_visible()
  login();page.fill('#query','camping');page.click('#search')
  expect(page.locator('#results article')).to_have_count(2)
  assert not page.evaluate('window.pwned===true')
  assert page.locator('#results img').count()==0 and page.locator('#results a').count()==1
  assert sent[-1]=='Bearer test-token'
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  mode[0]='denied';page.fill('#group','other');page.click('#search');expect(page.locator('#message')).to_contain_text('нет доступа');expect(page.locator('#results article')).to_have_count(0)
  mode[0]='expired';page.click('#search');expect(page.locator('#login')).to_be_visible();expect(page.locator('#archive')).to_be_hidden()
  mode[0]='ok';login();page.click('#logout');expect(page.locator('#login')).to_be_visible();expect(page.locator('#results article')).to_have_count(0)
  browser.close()
 print('PASS portal mobile: login/search/logout, expired session, denied group, no XSS or unsafe source URL, no horizontal overflow')
finally:server.shutdown();server.server_close()
