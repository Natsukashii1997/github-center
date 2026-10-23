"""Offline count/list inconsistency checks. No live APIs or live DB writes."""
import hashlib, importlib.util, json, re, tempfile, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('candidate_runner',HERE/'runner.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
SOURCE=hashlib.sha256((HERE/'runner.py').read_bytes()).hexdigest()
waits=[]
runner.time.sleep=lambda seconds:waits.append(seconds)
def row(i,stars=2051):return {'id':i,'full_name':f'fixture/r{i}','stargazers_count':stars,'private':False,'fork':False,'created_at':'2019-10-05T10:00:00Z'}
class Fake:
 def __init__(self,mode):self.mode=mode;self.calls=[];self.misses=0
 def stats(self,job):return {'fake_requests':len(self.calls)}
 def status(self):return {'offline':True}
 def get(self,endpoint,job,conditional=True,force=False):
  params=parse_qs(urlparse('https://offline/'+endpoint).query);q=params['q'][0];page=int(params['page'][0]);bad='stars:2051..2051' in q
  self.calls.append(('bad' if bad else 'sibling',page));items=[row(1000+i) for i in range(150)] if bad and self.mode in ('page2','page2_good') else ([row(12)] if bad else [row(11,100)])
  returned=items[(page-1)*100:page*100]
  if bad and ((self.mode=='persistent') or (self.mode=='transient' and self.misses==0) or (self.mode=='page2' and page==2 and self.misses==0)):
   returned=[];self.misses+=1
  body={'total_count':len(items),'incomplete_results':False,'items':returned}
  return {'request_id':500+len(self.calls),'body':body,'body_hash':hashlib.sha256(json.dumps(body).encode()).hexdigest()}
def make(tmp,mode):
 (tmp/'plan.json').write_text(json.dumps({'jobs':[{'id':'cold','day':'2026-10-20','due':time.time()-1,'deadline':time.time()+2000}],'initial_threshold':1,'stop_after':time.time()+5000,'prior_usage_log':'unused','code_hash':SOURCE}))
 t=Fake(mode);r=runner.Runner(tmp,t);r.last_status=time.time();r.add_shard('cold',0,1);r.db.execute("update shards set status='split'")
 r.add_shard('cold',0,2051,2051,'2019-10-05','2019-10-05');r.add_shard('cold',0,1,2050);r.add_shard('cold',0,2052,None)
 key=json.dumps([2052,None,None,None],separators=(',',':'));r.db.execute("update shards set status='complete',page=2,expected=1 where key=?",(key,));r.db.execute('insert into pages values(?,?,?,?,?,?)',('cold',0,key,1,99999,1));r.db.execute('insert into members values(?,?,?,?,?,?)',('cold',0,key,999,json.dumps(row(999,9000)),99999));r.db.commit()
 return r,t,json.dumps([2051,2051,'2019-10-05','2019-10-05'],separators=(',',':'))
def completed_intact(r):
 assert r.db.execute('select request_id from members where id=999').fetchone()[0]==99999
 assert r.db.execute('select request_id from pages where request_id=99999').fetchone()[0]==99999

def transient(tmp):
 r,t,k=make(tmp,'transient');r.enumerate(r.job('cold'),0)
 assert t.calls==[('bad',1),('sibling',1),('bad',1)],t.calls
 assert len(r.members('cold',0))==3;completed_intact(r)
 assert r.db.execute('select status,error from shards where key=?',(k,)).fetchone()[:]==('complete',None)
 assert r.mismatch_attempts('cold',0,k)==1
 return {'calls':t.calls,'completed_checkpoint_preserved':True,'false_success_pages':0}

def persistent(tmp):
 r,t,k=make(tmp,'persistent');raised=False
 try:r.enumerate(r.job('cold'),0)
 except RuntimeError as e:raised=True;assert 'remain unresolved' in str(e)
 assert raised and t.calls==[('bad',1),('sibling',1),('bad',1),('bad',1)],t.calls
 assert r.mismatch_attempts('cold',0,k)==3
 assert r.db.execute('select status from shards where key=?',(k,)).fetchone()[0]=='retry_pending'
 assert not r.db.execute("select 1 from events where event='enumeration_complete'").fetchone()
 assert not (tmp/'results/cold/result.json').exists();completed_intact(r)
 before=len(t.calls);r.db.close();r=runner.Runner(tmp,t)
 try:r.enumerate(r.job('cold'),0)
 except RuntimeError:pass
 assert len(t.calls)==before
 return {'calls':t.calls,'other_pending_completed':True,'bounded_failure':True,'restart_does_not_reset_retry_budget':True}

def legacy(tmp):
 r,t,k=make(tmp,'good');r.db.execute('update shards set page=3,expected=1 where key=?',(k,))
 for page,request in ((1,459),(2,460)):r.db.execute('insert into pages values(?,?,?,?,?,?)',('cold',0,k,page,request,0))
 r.db.commit();r.enumerate(r.job('cold'),0)
 assert t.calls==[('bad',1),('sibling',1)]
 event=json.loads(r.db.execute("select details from events where event='invalid_page_checkpoint_repaired'").fetchone()[0]);assert [x['request_id'] for x in event['invalid_page_records']]==[459,460]
 assert r.db.execute('select status,page from shards where key=?',(k,)).fetchone()[:]==('complete',2)
 completed_intact(r)
 return {'legacy_cursor':3,'resumed_page':1,'original_request_ids_archived':[459,460],'completed_checkpoint_preserved':True}

def page2(tmp):
 r,t,k=make(tmp,'page2');r.enumerate(r.job('cold'),0)
 assert t.calls==[('bad',1),('bad',2),('sibling',1),('bad',2)],t.calls
 assert len(r.members('cold',0))==152;completed_intact(r)
 return {'calls':t.calls,'valid_page1_not_repeated':True,'members':152}

def legacy_page2(tmp):
 r,t,k=make(tmp,'page2_good');r.db.execute('update shards set page=3,expected=150 where key=?',(k,))
 for page,request,count in ((1,123,100),(2,124,0)):r.db.execute('insert into pages values(?,?,?,?,?,?)',('cold',0,k,page,request,count))
 for i in range(100):r.db.execute('insert into members values(?,?,?,?,?,?)',('cold',0,k,1000+i,json.dumps(row(1000+i)),123))
 r.db.commit();r.enumerate(r.job('cold'),0)
 assert t.calls==[('bad',2),('sibling',1)],t.calls
 assert r.db.execute('select request_id from pages where shard=? and page=1',(k,)).fetchone()[0]==123
 assert len(r.members('cold',0))==152;completed_intact(r)
 return {'calls':t.calls,'valid_page1_preserved':True,'members':152}

results=[]
for name,fn in [('transient_mismatch',transient),('persistent_mismatch_and_restart_bound',persistent),('existing_empty_page3_repair',legacy),('partial_valid_page_reuse',page2),('legacy_partial_page_reuse',legacy_page2)]:
 with tempfile.TemporaryDirectory(dir=HERE,prefix='offline-case-') as d:
  try:results.append({'name':name,'passed':True,'observed':fn(Path(d))})
  except Exception as e:results.append({'name':name,'passed':False,'error':repr(e)})
out={'source_sha256':SOURCE,'network_requests':0,'simulated_waits':waits,'results':results}
(HERE/'recovery-tests.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False,indent=2))
assert all(x['passed'] for x in results)
