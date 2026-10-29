"""Build one reproducible installable extension after the regression run.

No browser profiles, tests, private exports, backend SQL, or credentials enter ZIP.
"""
from pathlib import Path
import argparse,hashlib,json,re,shutil,zipfile

parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--extract-check',type=Path,required=True)
args=parser.parse_args()
repo=Path(__file__).resolve().parents[1];source=repo/'bur-extension/candidate'
manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
version=manifest['version_name'];target=repo/'bur-extension'/version
assert version=='0.5.24-alpha' and manifest['version']=='0.5.24'
assert args.output.is_absolute() and args.extract_check.is_absolute()
if target.exists() or args.output.exists() or args.extract_check.exists():raise FileExistsError('Release destination already exists')
files=sorted([p.name for p in source.iterdir() if p.is_file() and p.suffix in ('.js','.html')]+['manifest.json','README-RU.txt','CHANGELOG.txt','QA-REPORT.txt']+[p.relative_to(source).as_posix() for p in (source/'icons').glob('*.png')])
required=[manifest['background']['service_worker'],manifest['action']['default_popup'],*manifest['icons'].values()]
for script in manifest['content_scripts']:required.extend(script['js'])
for name in files:
 if name.endswith('.html'):required.extend(re.findall(r'(?:src|href)="([^"#]+)"',(source/name).read_text(encoding='utf-8')))
 if name.endswith('.js'):
  text=(source/name).read_text(encoding='utf-8')
  for group in re.findall(r'importScripts\(([^)]+)\)',text):required.extend(re.findall(r"['\"]([^'\"]+)['\"]",group))
assert set(required)<=set(files),set(required)-set(files)
assert manifest['host_permissions']==['https://www.facebook.com/*','https://web.facebook.com/*']
assert manifest['permissions']==['storage','tabs','scripting','alarms','unlimitedStorage','downloads']
target.mkdir()
for name in files:
 dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/name,dest)
checksums={name:hashlib.sha256((target/name).read_bytes()).hexdigest() for name in files}
(target/'SHA256.json').write_text(json.dumps(checksums,indent=2)+'\n',encoding='utf-8');files.append('SHA256.json')
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in sorted(files):
  info=zipfile.ZipInfo(name,(2026,10,29,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16
  z.writestr(info,(target/name).read_bytes(),compresslevel=9)
with zipfile.ZipFile(args.output) as z:
 assert z.testzip() is None and 'manifest.json' in z.namelist()
 assert set(z.namelist())==set(files)
 for name in z.namelist():assert not name.startswith('/') and '..' not in Path(name).parts
 z.extractall(args.extract_check)
 for name,digest in checksums.items():assert hashlib.sha256((args.extract_check/name).read_bytes()).hexdigest()==digest
repo_zip=repo/'releases'/args.output.name;shutil.copyfile(args.output,repo_zip)
sha=hashlib.sha256(args.output.read_bytes()).hexdigest()
latest={'product':'FB Бур Chrome extension','version':version,'branch':'fix/bur-comprehensive-regressions','source':target.relative_to(repo).as_posix(),'zip':repo_zip.relative_to(repo).as_posix(),'sha256':sha,'tests':'candidate/run-tests.py; archive-pipeline tests; isolated installed ZIP fixture checks recorded in docs/handoffs/BUR-0.5.24-REPORT.txt','live_facebook':'USER TEST PENDING; no claim of universal live completeness'}
(repo/'bur-extension/LATEST.json').write_text(json.dumps(latest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'zip':str(args.output),'sha256':sha,'files':len(files),'unpacked':str(args.extract_check),'canonical':str(target)},ensure_ascii=False,indent=2))
