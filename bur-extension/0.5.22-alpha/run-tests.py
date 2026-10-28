from pathlib import Path
import subprocess,sys
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
failed=[]
for p in sorted((root/'tests').iterdir()):
 if p.suffix not in ('.js','.py'):continue
 result=subprocess.run(['node',str(p)] if p.suffix=='.js' else [sys.executable,str(p)],capture_output=True,text=True,encoding='utf-8',errors='replace')
 print(p.name, 'PASS' if result.returncode==0 else 'FAIL',result.stdout,result.stderr,flush=True)
 if result.returncode:failed.append(p.name)
sys.exit(bool(failed))
