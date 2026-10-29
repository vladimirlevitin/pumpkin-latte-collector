from pathlib import Path
import subprocess,sys
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
failed=[]
for p in sorted((root/'tests').iterdir()):
 if p.suffix not in ('.js','.py'):continue
 try:
  result=subprocess.run(['node',str(p)] if p.suffix=='.js' else [sys.executable,str(p)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=360)
 except subprocess.TimeoutExpired as error:
  print(p.name,'FAIL timeout after 360 seconds',error.stdout or '',error.stderr or '',flush=True);failed.append(p.name);continue
 print(p.name, 'PASS' if result.returncode==0 else 'FAIL',result.stdout,result.stderr,flush=True)
 if result.returncode:failed.append(p.name)
sys.exit(bool(failed))
