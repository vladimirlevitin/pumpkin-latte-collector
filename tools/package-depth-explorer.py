"""Package the diagnostic extension only; never edits Bur releases."""
from pathlib import Path
import argparse, hashlib, json, zipfile
p=argparse.ArgumentParser();p.add_argument('zip');p.add_argument('unpack');a=p.parse_args()
src=Path(__file__).resolve().parents[1]/'depth-explorer'
files=['manifest.json','background.js','dom.js','probe.js','panel.html','panel.js','panel.css','README-RU.txt','TEST-RESULT.txt']
m=json.loads((src/'manifest.json').read_text(encoding='utf-8'))
assert m['version']=='0.1.2'
needed=[m['background']['service_worker']]+[f for c in m['content_scripts'] for f in c['js']]
assert all(f in files and (src/f).is_file() for f in needed)
dest=Path(a.zip).resolve();dest.parent.mkdir(parents=True,exist_ok=True)
unpack=Path(a.unpack).resolve();assert not unpack.exists(),unpack
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
 for f in files:
  info=zipfile.ZipInfo(f,(2026,11,4,12,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,(src/f).read_bytes())
with zipfile.ZipFile(dest) as z:
 assert z.testzip() is None
 assert 'manifest.json' in z.namelist()
 assert set(z.namelist())==set(files)
 z.extractall(unpack)
 for f in files:assert z.read(f)==(unpack/f).read_bytes()==(src/f).read_bytes()
print(json.dumps({'zip':str(dest),'files':len(files),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'unpacked':str(unpack)},ensure_ascii=False))
