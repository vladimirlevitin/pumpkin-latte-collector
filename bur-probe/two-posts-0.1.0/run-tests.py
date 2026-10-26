from pathlib import Path
import subprocess,sys
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
tests=sorted((root/'tests').glob('*'))
failed=[]
for p in tests:
 if p.suffix not in ('.py','.js'):continue
 r=subprocess.run([sys.executable,str(p)] if p.suffix=='.py' else ['node',str(p)],capture_output=True,text=True,encoding='utf-8',errors='replace')
 print(p.name,'PASS' if r.returncode==0 else 'FAIL',r.stdout,r.stderr,flush=True)
 if r.returncode:failed.append(p.name)
sys.exit(bool(failed))
