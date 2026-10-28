import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from watch_staging import Watcher
class Tests(unittest.TestCase):
 def test_production_guard_even_with_custom_client(self):
  with tempfile.TemporaryDirectory() as tmp:
   with self.assertRaisesRegex(ValueError,'production'):
    Watcher(tmp,Path(tmp)/'state.json',type('Client',(),{'base':'https://ltznpjfnkpydautbsrej.supabase.co'})())
 def test_enable_index_after_import_only_restart(self):
  with tempfile.TemporaryDirectory() as tmp:
   import hashlib
   p=Path(tmp);source=p/'bur-raw-test.json';source.write_text('{}');client=type('Client',(),{'base':'https://staging.example'})()
   receipt={'sha256':hashlib.sha256(b'{}').hexdigest()}
   with patch('watch_staging.import_batch',return_value=receipt),patch('watch_staging.subprocess.run',return_value=type('Result',(),{'returncode':0,'stdout':'{"ready":true}'})()) as index:
    w=Watcher(p,p/'state.json',client);w.scan();self.assertTrue(w.scan()[0]['ready'])
    w=Watcher(p,p/'state.json',client,index=True);w.scan();self.assertTrue(w.scan()[0]['index_ready']);self.assertEqual(index.call_count,1)
 def test_file_changed_while_indexing_is_not_acknowledged(self):
  with tempfile.TemporaryDirectory() as tmp:
   import hashlib
   p=Path(tmp);source=p/'bur-raw-test.json';source.write_text('{}');client=type('Client',(),{'base':'https://staging.example'})()
   def mutate(*args,**kwargs):
    source.write_text('{"changed":true}');return type('Result',(),{'returncode':0,'stdout':'{"ready":true}'})()
   with patch('watch_staging.import_batch',return_value={'sha256':hashlib.sha256(b'{}').hexdigest()}),patch('watch_staging.subprocess.run',side_effect=mutate):
    w=Watcher(p,p/'state.json',client,index=True);w.scan();self.assertFalse(w.scan()[0]['ready']);self.assertEqual(w.done,{})
 def test_stable_ack_restart_no_delete(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);source=p/'bur-raw-test.json';source.write_text('{}')
   client=type('Client',(),{'base':'https://staging.example'})()
   w=Watcher(p,p/'state.json',client)
   with patch('watch_staging.import_batch') as call:
    import hashlib
    call.return_value={'sha256':hashlib.sha256(b'{}').hexdigest()}
    self.assertEqual(w.scan(),[]);self.assertEqual(call.call_count,0)
    self.assertTrue(w.scan()[0]['ready']);self.assertEqual(call.call_count,1)
    w2=Watcher(p,p/'state.json',client);w2.scan();w2.scan();self.assertEqual(call.call_count,1)
    self.assertTrue(source.exists());self.assertEqual(source.read_text(),'{}')
 def test_failed_import_is_not_acknowledged(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'bur-raw-test.json').write_text('{}');client=type('Client',(),{'base':'https://staging.example'})()
   w=Watcher(p,p/'state.json',client)
   with patch('watch_staging.import_batch',side_effect=RuntimeError('failed')):
    w.scan();result=w.scan();self.assertFalse(result[0]['ready']);self.assertEqual(w.done,{})
 def test_index_failure_preserves_receipt_and_source(self):
  with tempfile.TemporaryDirectory() as tmp:
   import hashlib
   p=Path(tmp);source=p/'bur-raw-test.json';source.write_text('{}');client=type('Client',(),{'base':'https://staging.example'})()
   w=Watcher(p,p/'state.json',client,index=True)
   with patch('watch_staging.import_batch',return_value={'sha256':hashlib.sha256(b'{}').hexdigest()}),patch('watch_staging.subprocess.run',return_value=type('Result',(),{'returncode':1})()):
    w.scan();self.assertFalse(w.scan()[0]['ready']);self.assertTrue(source.exists());self.assertEqual(w.done,{})
if __name__=='__main__':unittest.main()
