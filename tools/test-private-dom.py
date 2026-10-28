"""Offline real Facebook HTML comparison. Never executes saved scripts or network calls.

Private snapshots stay outside git; only aggregate diagnostics go to stdout.
"""
from pathlib import Path
import argparse,hashlib,json,re
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('files',nargs='+');args=parser.parse_args()
repo=Path(__file__).resolve().parents[1]
versions={'0522':repo/'bur-extension/0.5.22-alpha/core.js','0523':repo.parent/'reference-0523/core.js','candidate':repo/'bur-extension/candidate/core.js'}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for file in args.files:
  raw=Path(file).read_bytes();source=raw.decode('utf-8')
  groups=sorted(set(re.findall(r'href="[^"<>]*?/groups/([^/?"<>]+)/',source)))
  html=re.sub(r'<script\b[^>]*>.*?</script\s*>','',source,flags=re.I|re.S)
  html='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'+html
  context=browser.new_context();context.route('**/*',lambda route:route.abort());page=context.new_page()
  page.set_content(html,wait_until='domcontentloaded');page.wait_for_timeout(150)
  # No saved executable scripts survive the sanitizer.
  assert page.locator('script').count()==0
  results={}
  for label,core in versions.items():
   page.evaluate(core.read_text(encoding='utf-8-sig'))
   rows=page.evaluate('''groups=>{
    const records=[];
    for(const group of groups)for(const node of FBBurCore.postNodes(document,null)){
     const row=FBBurCore.extractCard(node,group,'https://www.facebook.com/groups/'+group+'/');
     if(row)records.push(row);
    }
    return records;
   }''',groups)
   comments=[c for row in rows for c in row['comments']]
   results[label]={'by_group':{g:sum(r['group']==g for r in rows) for g in groups},'posts':len(rows),'authors':sum(bool(r.get('author')) for r in rows),'timestamps':sum(bool(r.get('published_at')) for r in rows),'date_labels':sum(bool(r.get('published_label')) for r in rows),'comments':len(comments),'comment_authors':sum(bool(c.get('author')) for c in comments),'comment_links':sum(len(c.get('links',[])) for c in comments),'media':sum(len(r.get('media',[])) for r in rows)}
  assert results['candidate']['posts']>0,results
  assert results['candidate']['comments']>=results['0522']['comments'],results
  assert results['candidate']['authors']>=results['0522']['authors'],results
  print(json.dumps({'source_sha256':hashlib.sha256(raw).hexdigest(),'versions':results,'network':'blocked','saved_scripts':'removed'},indent=2))
  context.close()
 browser.close()
