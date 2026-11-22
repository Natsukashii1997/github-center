"""Offline regression: an interrupted status write must not consume retry budget."""
import importlib.util
import json
import sqlite3
import tempfile
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('candidate', ROOT/'runner.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Offline:
    def stats(self,*args):return {}
    def status(self):return {}
with tempfile.TemporaryDirectory(dir=ROOT,prefix='atomic-case-') as directory:
    root=Path(directory)
    (root/'plan.json').write_text(json.dumps({'jobs':[{'id':'cold','day':'2026-10-20','due':time.time(),'deadline':time.time()+3600}], 'initial_threshold':1013,'stop_after':time.time()+3600,'code_hash':'offline','prior_usage_log':'unused'}))
    runner=module.Runner(root,Offline())
    runner.add_shard('cold',0,2051,2051,'2019-10-05','2019-10-05')
    shard=dict(runner.db.execute('SELECT * FROM shards').fetchone())
    response={'request_id':459,'body':{'total_count':1,'items':[]}}
    def reject_status_update(action, table, *args):
        return sqlite3.SQLITE_DENY if action==sqlite3.SQLITE_UPDATE and table=='shards' else sqlite3.SQLITE_OK
    runner.db.set_authorizer(reject_status_update)
    failed=False
    try:runner.defer_count_mismatch(shard,response,1)
    except sqlite3.DatabaseError:failed=True
    finally:runner.db.set_authorizer(None)
    attempts=runner.mismatch_attempts('cold',0,shard['key'])
    status=runner.db.execute('SELECT status FROM shards').fetchone()[0]
    print(json.dumps({'network_requests':0,'injected_status_write_failure':failed,'attempts_after_failed_transaction':attempts,'status':status,'passed':failed and attempts==0 and status=='pending'}))
    assert failed and attempts==0 and status=='pending'
    runner.defer_count_mismatch(shard,response,1)
    assert runner.mismatch_attempts('cold',0,shard['key'])==1
    assert runner.db.execute('SELECT status FROM shards').fetchone()[0]=='retry_pending'
