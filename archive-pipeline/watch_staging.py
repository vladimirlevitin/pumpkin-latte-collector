"""Optional staging watcher: stable Bur JSON -> verified import -> index worker.

No deletion, renaming or reset of source files. No production destination.
Run --once for a bounded verification; credentials stay in environment variables.
"""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
from verified_import import Client,import_batch,target

class Watcher:
 def __init__(self,directory,state,client,index=False,node='node'):
  self.directory=Path(directory);self.state=Path(state);self.client=client;self.index=index;self.node=node
  self.observed={};self.done={};self.retry={}
  if self.state.exists():self.done=json.loads(self.state.read_text(encoding='utf-8'))
 def save(self):
  self.state.parent.mkdir(parents=True,exist_ok=True);temporary=self.state.with_suffix('.tmp')
  with temporary.open('w',encoding='utf-8') as f:
   json.dump(self.done,f,indent=2);f.flush();os.fsync(f.fileno())
  os.replace(temporary,self.state)
 def scan(self):
  outcomes=[]
  for file in sorted(self.directory.glob('bur-raw-*.json')):
   try:
    stat=file.stat();signature=(stat.st_size,stat.st_mtime_ns)
    if self.observed.get(str(file))!=signature:
     self.observed[str(file)]=signature;continue
    if self.retry.get(str(file),0)>time.monotonic():continue
    digest=hashlib.sha256(file.read_bytes()).hexdigest();key=self.client.base+'|'+digest
    if self.done.get(key,{}).get('ready'):continue
    receipt=import_batch(file,self.client,self.state.parent/'receipts')
    if receipt['sha256']!=digest:raise ValueError('file changed during scan')
    # Do not index a file that was edited after the exact imported bytes were read.
    if hashlib.sha256(file.read_bytes()).hexdigest()!=receipt['sha256']:raise ValueError('file changed after import')
    result={'import_verified':True,'index_ready':False,'ready':not self.index}
    if self.index:
     command=[self.node,str(Path(__file__).with_name('index-worker.mjs')),str(file.resolve()),'--apply','--url',self.client.base]
     indexed=subprocess.run(command,capture_output=True,text=True,timeout=1800,check=False)
     if indexed.returncode:raise RuntimeError('index worker failed; import receipt retained')
     status=json.loads(indexed.stdout);result['index_ready']=status.get('ready') is True;result['ready']=result['index_ready']
     if not result['ready']:self.retry[str(file)]=time.monotonic()+60
    self.done[key]=result;self.save();outcomes.append({'file':file.name,**result})
   except (ValueError,RuntimeError,OSError,subprocess.TimeoutExpired) as error:
    self.retry[str(file)]=time.monotonic()+60
    outcomes.append({'file':file.name,'ready':False,'error':type(error).__name__})
  return outcomes

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('directory');parser.add_argument('--url',required=True)
 parser.add_argument('--state',default='work/staging-watch.json');parser.add_argument('--once',action='store_true')
 parser.add_argument('--index',action='store_true');parser.add_argument('--node',default='node')
 args=parser.parse_args();base=target(args.url)
 key=os.environ.get('BUR_STAGING_SECRET','')
 if not key:parser.error('BUR_STAGING_SECRET required')
 if args.index and not os.environ.get('GEMINI_API_KEY'):parser.error('GEMINI_API_KEY required for --index')
 watcher=Watcher(args.directory,args.state,Client(base,key),args.index,args.node)
 if args.once:
  watcher.scan();time.sleep(2)
  for row in watcher.scan():print(json.dumps(row),flush=True)
  return
 while True:
  for row in watcher.scan():print(json.dumps(row),flush=True)
  time.sleep(2)

if __name__=='__main__':main()
