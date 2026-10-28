import copy,hashlib,json,tempfile,threading,unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from unittest.mock import patch
import verified_import as imp

PAYLOAD={'schema':'bur-collector/1','collector_version':'0.5.22-alpha','group':'backpackIL',
 'job_summary':{'id':'session-b0001','stage':'done','discovery_order':['1700000000000001']},
 'posts':[{'post_id':'1700000000000001','post_text':'route','comments':[{'id':'c1','text':'A'*50000}]}]}

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,code,body):
  self.send_response(code);self.end_headers();self.wfile.write(body if isinstance(body,bytes) else json.dumps(body).encode())
 def do_GET(self):
  self.server.calls.append('read_raw')
  self.reply(200,b'corrupt' if self.server.mode=='corrupt' else self.server.raw)
 def do_POST(self):
  raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
  if self.path.startswith('/storage/'):
   self.server.calls.append('upload')
   if self.server.raw is not None:self.reply(409,{});return
   self.server.raw=raw;self.reply(200,{});return
  payload=json.loads(raw)
  if self.path.endswith('bur_import_archived_json'):
   self.server.calls.append('commit')
   if self.server.mode=='transient' and not self.server.retried:
    self.server.retried=True;self.reply(503,{});return
   # Simulate remote commit before lost/invalid response, then idempotent retry.
   self.server.commits.add(payload['source_file_sha256'])
   self.reply(200,{'ok':True,'crawl_run_id':'run-1','archived':True,
     'storage_path':payload['storage_path'],'source_file_sha256':payload['source_file_sha256'] if self.server.mode!='wrong_ack' else 'bad'})
  else:
   self.server.calls.append('read_db')
   self.reply(200,{'verified':self.server.mode!='readback_failed','post_count':1})

class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'batch.json';self.path.write_text(json.dumps(PAYLOAD),encoding='utf-8')
  self.receipts=Path(self.tmp.name)/'receipts'
  self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
  self.server.raw=None;self.server.mode='ok';self.server.calls=[];self.server.commits=set();self.server.retried=False
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.client=imp.Client('http://127.0.0.1:'+str(self.server.server_port),'test-key')
 def tearDown(self):self.server.shutdown();self.server.server_close();self.tmp.cleanup()
 def test_repeat_checks_remote_state(self):
  first=imp.import_batch(self.path,self.client,self.receipts);second=imp.import_batch(self.path,self.client,self.receipts)
  self.assertEqual(first,second);self.assertEqual(len(self.server.commits),1)
  self.assertEqual(self.server.calls,['upload','read_raw','commit','read_db']*2)
  self.assertTrue(self.path.exists());self.assertEqual(len(list(self.receipts.glob('*.json'))),1)
 def test_storage_corruption_never_imports(self):
  self.server.mode='corrupt'
  with self.assertRaisesRegex(ValueError,'checksum'):imp.import_batch(self.path,self.client,self.receipts)
  self.assertNotIn('commit',self.server.calls);self.assertFalse(self.receipts.exists())
 def test_wrong_ack_no_receipt(self):
  self.server.mode='wrong_ack'
  with self.assertRaisesRegex(ValueError,'acknowledgement'):imp.import_batch(self.path,self.client,self.receipts)
  self.assertFalse(self.receipts.exists())
 def test_readback_failure_retry_after_remote_commit(self):
  self.server.mode='readback_failed'
  with self.assertRaisesRegex(ValueError,'readback'):imp.import_batch(self.path,self.client,self.receipts)
  self.assertFalse(self.receipts.exists());self.server.mode='ok'
  result=imp.import_batch(self.path,self.client,self.receipts)
  self.assertTrue(result['verified']);self.assertEqual(len(self.server.commits),1)
 def test_retry_transient(self):
  self.server.mode='transient'
  with patch('verified_import.time.sleep'):result=imp.import_batch(self.path,self.client,self.receipts)
  self.assertTrue(result['verified']);self.assertTrue(self.server.retried)
 def test_validation_and_production_guard(self):
  for url in ('https://ltznpjfnkpydautbsrej.supabase.co','https://bybgnzeaoaxnxwdugnwo.supabase.co','https://metzia.store','http://example.com','https://u:p@example.com','https://example.com/path'):
   with self.assertRaises(ValueError):imp.target(url)
  for field,value in [('stage','deep'),('discovery_order',[]),('checkpoint_post_id','1727687685009933')]:
   payload=copy.deepcopy(PAYLOAD);payload['job_summary'][field]=value
   with self.assertRaises(ValueError):imp.validate(payload)
  payload=copy.deepcopy(PAYLOAD);payload['posts']*=2
  with self.assertRaises(ValueError):imp.validate(payload)

if __name__=='__main__':unittest.main()
