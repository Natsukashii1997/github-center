"""Finite local research run: one cold daily leaderboard + three real daily windows.

Not a production service. Public GitHub reads only. No uploads, installation, or AI calls.
"""
import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import math
import os
import sqlite3
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent
ALGORITHM = "daily-validation-v1"
UTC = timezone.utc
BJ = timezone(timedelta(hours=8))


class StopRun(RuntimeError):
    """Stop this finite experiment without advancing or retrying its batch."""


def source_hash(root):
    digest = hashlib.sha256()
    for name in ("runner.py", "transport.py"):
        digest.update(name.encode())
        digest.update((Path(root)/name).read_bytes())
    return digest.hexdigest()


def iso(ts=None):
    return datetime.fromtimestamp(ts or time.time(), UTC).isoformat()


def atomic(path, value):
    path = Path(path)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temp.replace(path)


def bucket(day):
    d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=UTC)
    index = (d.weekday() + 1) % 7
    return int((d - timedelta(days=index)).timestamp()), index


def daily_score(repo, body, day):
    week, index = bucket(day)
    seen = set()
    for row in body:
        ds = row.get("days")
        if not isinstance(ds, list) or len(ds) != 7 or any(type(x) is not int or x < 0 for x in ds):
            raise ValueError("Invalid day bucket structure")
        if sum(ds) != row["total"] or row["week"] in seen:
            raise ValueError("Week totals inconsistent or duplicated")
        seen.add(row["week"])
    for row in body:
        if row["week"] == week:
            return row["days"][index]
    created = repo.get("created_at")
    if created:
        created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        end = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=UTC) + timedelta(days=1)
        if created > end + timedelta(days=1):
            return 0  # Conservative pre-creation exclusion, with one-day mapping margin.
    raise ValueError("Required official day bucket absent; not zero-filled")


def member_in_shard(repo, shard):
    if repo.get("private") is not False or repo["stargazers_count"] < shard["lo"]:
        return False
    if shard["hi"] is not None and repo["stargazers_count"] > shard["hi"]:
        return False
    if shard["cl"]:
        try:
            created = datetime.fromisoformat(repo["created_at"].replace("Z", "+00:00")).astimezone(UTC).date().isoformat()
        except (KeyError, TypeError, ValueError):
            return False
        if not shard["cl"] <= created <= shard["ch"]:
            return False
    return True


class Runner:
    def __init__(self, root=ROOT, transport=None):
        self.root = Path(root)
        self.plan = json.loads((self.root / "plan.json").read_text())
        self.db = sqlite3.connect(self.root / "runner.sqlite", timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, day TEXT, due REAL, deadline REAL,
          status TEXT, stage TEXT, threshold INTEGER, generation INTEGER DEFAULT 0,
          started REAL, finished REAL, error TEXT, retry_at REAL DEFAULT 0, failures INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS shards(job TEXT, pass INTEGER, key TEXT, lo INTEGER, hi INTEGER,
          cl TEXT, ch TEXT, status TEXT, page INTEGER DEFAULT 1, expected INTEGER,
          attempts INTEGER DEFAULT 0, error TEXT, PRIMARY KEY(job,pass,key));
        CREATE TABLE IF NOT EXISTS members(job TEXT, pass INTEGER, shard TEXT, id INTEGER,
          data TEXT, request_id INTEGER, PRIMARY KEY(job,pass,shard,id));
        CREATE TABLE IF NOT EXISTS pages(job TEXT, pass INTEGER, shard TEXT, page INTEGER,
          request_id INTEGER, count INTEGER, PRIMARY KEY(job,pass,shard,page));
        CREATE TABLE IF NOT EXISTS scores(job TEXT,id INTEGER,repo TEXT,value INTEGER,
          request_id INTEGER,body_hash TEXT,checked REAL,error TEXT,attempts INTEGER DEFAULT 0,
          PRIMARY KEY(job,id));
        CREATE TABLE IF NOT EXISTS score_versions(job TEXT,id INTEGER,value INTEGER,
          request_id INTEGER,body_hash TEXT,checked REAL,reason TEXT);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at REAL,event TEXT,job TEXT,details TEXT);
        """)
        for j in self.plan["jobs"]:
            self.db.execute("INSERT OR IGNORE INTO jobs(id,day,due,deadline,status,stage,threshold) VALUES(?,?,?,?,?,?,?)",
                            (j["id"], j["day"], j["due"], j["deadline"], "pending", "enumerate_initial", self.plan["initial_threshold"]))
        self.db.commit()
        if transport is None:
            from transport import Transport
            transport = Transport(self.root, Path(self.plan["prior_usage_log"]))
        self.t = transport
        self.last_status = 0

    def event(self, event, job=None, **details):
        self.db.execute("INSERT INTO events(at,event,job,details) VALUES(?,?,?,?)",
                        (time.time(), event, job, json.dumps(details, ensure_ascii=False)))
        self.db.commit()

    def job(self, key):
        return dict(self.db.execute("SELECT * FROM jobs WHERE id=?", (key,)).fetchone())

    def update(self, job_id, **values):
        fields = ",".join(k+"=?" for k in values)
        self.db.execute("UPDATE jobs SET "+fields+" WHERE id=?", (*values.values(), job_id))
        self.db.commit()

    def state(self):
        jobs = [dict(x) for x in self.db.execute("SELECT * FROM jobs ORDER BY due")]
        for j in jobs:
            j["successful_scores"] = self.db.execute("SELECT COUNT(*) FROM scores WHERE job=? AND error IS NULL", (j["id"],)).fetchone()[0]
            j["unresolved_scores"] = self.db.execute("SELECT COUNT(*) FROM scores WHERE job=? AND error IS NOT NULL", (j["id"],)).fetchone()[0]
            j["completed_shards"] = self.db.execute("SELECT COUNT(*) FROM shards WHERE job=? AND status='complete'", (j["id"],)).fetchone()[0]
            j["enumerated_unique"] = self.db.execute("SELECT COUNT(DISTINCT id) FROM members WHERE job=? AND pass=?", (j["id"], 2*j["generation"])).fetchone()[0]
            j["api"] = self.t.stats(j["id"])
        state = {"updated_at": iso(), "pid": os.getpid(), "algorithm": ALGORITHM,
                 "jobs": jobs, "transport": self.t.status(),
                 "all_complete": all(j["status"] == "complete" for j in jobs),
                 "scope": "one cold run then three fixed windows; no public repository or paid service"}
        atomic(self.root / "status.json", state)
        self.last_status = time.time()
        return state

    def add_shard(self, j, p, lo, hi=None, cl=None, ch=None):
        key = json.dumps([lo, hi, cl, ch], separators=(",", ":"))
        self.db.execute("INSERT OR IGNORE INTO shards(job,pass,key,lo,hi,cl,ch,status) VALUES(?,?,?,?,?,?,?,?)",
                        (j, p, key, lo, hi, cl, ch, "pending"))
        self.db.commit()

    def split(self, shard, first=None):
        lo, hi = shard["lo"], shard["hi"]
        if hi is None or lo < hi:
            maximum = hi if hi is not None else max([x["stargazers_count"] for x in (first or {}).get("items", [])] + [lo*2])
            mid = (lo + maximum) // 2
            self.add_shard(shard["job"], shard["pass"], lo, mid, shard["cl"], shard["ch"])
            self.add_shard(shard["job"], shard["pass"], mid+1, hi, shard["cl"], shard["ch"])
        else:
            cl = date.fromisoformat(shard["cl"] or "2007-01-01")
            ch = date.fromisoformat(shard["ch"] or (datetime.now(UTC).date()+timedelta(days=1)).isoformat())
            if cl >= ch:
                raise RuntimeError("Dense same-star/same-day shard exceeds search capacity")
            mid = cl + (ch-cl)//2
            self.add_shard(shard["job"], shard["pass"], lo, hi, cl.isoformat(), mid.isoformat())
            self.add_shard(shard["job"], shard["pass"], lo, hi, (mid+timedelta(days=1)).isoformat(), ch.isoformat())
        self.db.execute("DELETE FROM members WHERE job=? AND pass=? AND shard=?", (shard["job"],shard["pass"],shard["key"]))
        self.db.execute("UPDATE shards SET status='split' WHERE job=? AND pass=? AND key=?", (shard["job"],shard["pass"],shard["key"]))
        self.db.commit()

    def mismatch_attempts(self, job, pass_no, key):
        # A separate event count avoids conflating response retries with the
        # existing cross-shard drift repair counter. Persists across restarts.
        rows = self.db.execute("SELECT details FROM events WHERE job=? AND event IN ('search_count_list_mismatch','search_leaf_drift_deferred')", (job,))
        return sum(json.loads(x[0]).get("pass_no") == pass_no and json.loads(x[0]).get("shard") == key for x in rows)

    def defer_count_mismatch(self, shard, response, expected_size):
        details = dict(pass_no=shard["pass"], shard=shard["key"], page=shard["page"],
                       request_id=response["request_id"], expected_page_size=expected_size,
                       actual_page_size=len(response["body"]["items"]),
                       reported_total=response["body"]["total_count"])
        self.defer_search_anomaly(shard, "search_count_list_mismatch", details,
                                  "Count/list inconsistent; no successful checkpoint advanced")

    def defer_leaf_drift(self, shard, response):
        details = dict(pass_no=shard["pass"], shard=shard["key"], page=shard["page"],
                       request_id=response["request_id"], reported_total=response["body"]["total_count"],
                       prior_expected=shard["expected"],
                       returned_members=[{k: x.get(k) for k in ("id","stargazers_count","private","created_at")}
                                         for x in response["body"]["items"]])
        self.defer_search_anomaly(shard, "search_leaf_drift_deferred", details,
                                  "Unsplittable search leaf drift; no successful checkpoint advanced")

    def defer_search_anomaly(self, shard, event_name, details, error):
        # The retry count and deferred state must survive (or roll back) together.
        # event() commits on its own, so both writes belong in this transaction.
        with self.db:
            self.db.execute("INSERT INTO events(at,event,job,details) VALUES(?,?,?,?)",
                            (time.time(), event_name, shard["job"],
                             json.dumps(details, ensure_ascii=False)))
            self.db.execute("UPDATE shards SET status='retry_pending',error=? WHERE job=? AND pass=? AND key=?",
                            (error, shard["job"], shard["pass"], shard["key"]))

    def repair_invalid_page_checkpoints(self, job, pass_no):
        # Compatibility with the old bug: it committed a short/empty page and
        # advanced the cursor before discovering a leaf count mismatch.
        shards = self.db.execute("SELECT * FROM shards WHERE job=? AND pass=? AND status IN ('pending','retry_pending') AND expected IS NOT NULL", (job,pass_no)).fetchall()
        for raw in shards:
            s = dict(raw)
            pages = [dict(x) for x in self.db.execute("SELECT * FROM pages WHERE job=? AND pass=? AND shard=? ORDER BY page",(job,pass_no,s["key"]))]
            invalid = [p for p in pages if p["count"] != min(100,max(0,s["expected"]-100*(p["page"]-1)))]
            if not invalid:
                continue
            first_bad = invalid[0]["page"]
            discarded = [p for p in pages if p["page"] >= first_bad]
            self.event("invalid_page_checkpoint_repaired", job, pass_no=pass_no, shard=s["key"],
                       previous_cursor=s["page"], restart_page=first_bad, invalid_page_records=discarded,
                       source_responses_preserved=True)
            with self.db:
                for page in discarded:
                    self.db.execute("DELETE FROM members WHERE job=? AND pass=? AND shard=? AND request_id=?",(job,pass_no,s["key"],page["request_id"]))
                self.db.execute("DELETE FROM pages WHERE job=? AND pass=? AND shard=? AND page>=?",(job,pass_no,s["key"],first_bad))
                self.db.execute("UPDATE shards SET page=?,expected=?,status='pending',error=? WHERE job=? AND pass=? AND key=?",
                                (first_bad,None if first_bad==1 else s["expected"],"Rewound invalid short-page checkpoint; see repair event",job,pass_no,s["key"]))

    def enumerate(self, job, pass_no):
        jid = job["id"]
        self.add_shard(jid, pass_no, job["threshold"])
        self.repair_invalid_page_checkpoints(jid,pass_no)
        while True:
            self.check_deadline()
            raw = self.db.execute("SELECT * FROM shards WHERE job=? AND pass=? AND status='pending' ORDER BY lo DESC LIMIT 1", (jid,pass_no)).fetchone()
            if raw is None:
                break
            s = dict(raw)
            q = "is:public fork:true stars:" + (f"{s['lo']}..{s['hi']}" if s["hi"] is not None else f">={s['lo']}")
            if s["cl"]:
                q += f" created:{s['cl']}..{s['ch']}"
            endpoint = "search/repositories?"+urlencode({"q":q,"sort":"stars","order":"desc","per_page":100,"page":s["page"]})
            response = self.t.get(endpoint, jid, conditional=False)
            result = response["body"]
            if s["page"] == 1 and (result["incomplete_results"] or result["total_count"] > 900):
                self.split(s, result)
                continue
            expected = result["total_count"] if s["page"] == 1 else s["expected"]
            items = result["items"]
            expected_page_size = min(100,max(0,expected-100*(s["page"]-1)))
            if not result["incomplete_results"] and result["total_count"] == expected and len(items) != expected_page_size:
                self.defer_count_mismatch(s,response,expected_page_size)
                continue
            valid = (not result["incomplete_results"] and result["total_count"] == expected
                     and len(items) <= 100 and all(member_in_shard(x,s) for x in items))
            if not valid:
                if s["hi"] == s["lo"] and s["cl"] is not None and s["cl"] == s["ch"]:
                    self.defer_leaf_drift(s, response)
                    continue
                self.event("search_partition_drift", jid, pass_no=pass_no, shard=s["key"], page=s["page"], request_id=response["request_id"])
                self.split(s, result)
                continue
            try:
                with self.db:
                    for x in items:
                        self.db.execute("INSERT INTO members(job,pass,shard,id,data,request_id) VALUES(?,?,?,?,?,?)",
                                        (jid,pass_no,s["key"],x["id"],json.dumps(x,ensure_ascii=False),response["request_id"]))
                    self.db.execute("INSERT INTO pages VALUES(?,?,?,?,?,?)", (jid,pass_no,s["key"],s["page"],response["request_id"],len(items)))
                    self.db.execute("UPDATE shards SET page=page+1,expected=? WHERE job=? AND pass=? AND key=?",(expected,jid,pass_no,s["key"]))
            except sqlite3.IntegrityError:
                self.event("duplicate_page_member",jid,shard=s["key"],request_id=response["request_id"])
                self.split(s,result)
                continue
            if s["page"] >= max(1, math.ceil(expected/100)):
                count = self.db.execute("SELECT COUNT(*) FROM members WHERE job=? AND pass=? AND shard=?", (jid,pass_no,s["key"])).fetchone()[0]
                if count != expected:
                    self.split(s,result)
                else:
                    self.db.execute("UPDATE shards SET status='complete',error=NULL WHERE job=? AND pass=? AND key=?", (jid,pass_no,s["key"]))
                    self.db.commit()
            if time.time()-self.last_status >= 30:
                self.state()
        unresolved = [dict(x) for x in self.db.execute("SELECT * FROM shards WHERE job=? AND pass=? AND status='retry_pending'",(jid,pass_no))]
        retryable = [s for s in unresolved if self.mismatch_attempts(jid,pass_no,s["key"]) < 3]
        if retryable:
            # Other normal pending partitions have all been processed first.
            # This bounded delay is responsive to STOP/deadline at <= 60s.
            self.check_deadline();self.state();time.sleep(60);self.check_deadline()
            with self.db:
                for s in retryable:
                    self.db.execute("UPDATE shards SET status='pending' WHERE job=? AND pass=? AND key=?",(jid,pass_no,s["key"]))
            return self.enumerate(job,pass_no)
        if unresolved:
            raise RuntimeError(f"{len(unresolved)} search shards remain unresolved after bounded search consistency retries; no complete enumeration")
        duplicates = self.db.execute("SELECT id,COUNT(*) AS n FROM members WHERE job=? AND pass=? GROUP BY id HAVING n>1", (jid,pass_no)).fetchall()
        if duplicates:
            # Do not silently deduplicate a moving live partition and declare completeness.
            ids = [x["id"] for x in duplicates]
            for rid in ids:
                shards = self.db.execute("SELECT shard FROM members WHERE job=? AND pass=? AND id=?", (jid,pass_no,rid)).fetchall()
                for row in shards:
                    key = row[0]
                    self.db.execute("DELETE FROM members WHERE job=? AND pass=? AND shard=?", (jid,pass_no,key))
                    self.db.execute("DELETE FROM pages WHERE job=? AND pass=? AND shard=?", (jid,pass_no,key))
                    self.db.execute("UPDATE shards SET status='pending',page=1,expected=NULL,attempts=attempts+1 WHERE job=? AND pass=? AND key=?", (jid,pass_no,key))
            self.db.commit()
            attempts = self.db.execute("SELECT MAX(attempts) FROM shards WHERE job=? AND pass=?", (jid,pass_no)).fetchone()[0]
            if attempts > 2:
                raise RuntimeError("Persistent cross-shard membership drift")
            self.event("repair_cross_shard_duplicates",jid,pass_no=pass_no,count=len(ids))
            return self.enumerate(job,pass_no)
        self.event("enumeration_complete",jid,pass_no=pass_no,unique_count=len(self.members(jid,pass_no)))

    def members(self,jid,pass_no):
        return {x["id"]:json.loads(x["data"]) for x in self.db.execute("SELECT id,data FROM members WHERE job=? AND pass=?",(jid,pass_no))}

    def fetch_score(self, job, repo, force=False):
        self.check_deadline()
        endpoint = f"repositories/{repo['id']}/stargazers/history?per_page=6"
        response = self.t.get(endpoint,job["id"],conditional=job["id"]!="cold",force=force)
        value = daily_score(repo,response["body"],job["day"])
        return repo,value,response

    def record_score(self, job, repo, value, response, reason):
        now = time.time()
        with self.db:
            self.db.execute("INSERT INTO score_versions VALUES(?,?,?,?,?,?,?)",
                            (job["id"],repo["id"],value,response["request_id"],response["body_hash"],now,reason))
            self.db.execute("INSERT OR REPLACE INTO scores VALUES(?,?,?,?,?,?,?,?,?)",
                            (job["id"],repo["id"],repo["full_name"],value,response["request_id"],response["body_hash"],now,None,0))

    def collect(self, job, pass_no):
        repos = self.members(job["id"],pass_no)
        done = {x[0] for x in self.db.execute("SELECT id FROM scores WHERE job=? AND error IS NULL",(job["id"],))}
        pending = sorted([x for rid,x in repos.items() if rid not in done],key=lambda x:-x["stargazers_count"])
        self.event("history_stage",job["id"],pass_no=pass_no,candidates=len(repos),same_job_checkpoint_reuse=len(set(repos)&done),pending=len(pending))
        # Bounded queue: never submit tens of thousands of pending futures.
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            iterator = iter(pending)
            futures = {}
            def replenish():
                while len(futures)<4:
                    item=next(iterator,None)
                    if item is None:return
                    futures[pool.submit(self.fetch_score,job,item)] = item
            replenish()
            while futures:
                self.check_deadline()
                completed,_ = concurrent.futures.wait(futures,timeout=30,return_when=concurrent.futures.FIRST_COMPLETED)
                for future in completed:
                    repo=futures.pop(future)
                    try:
                        rp,value,response=future.result()
                        self.record_score(job,rp,value,response,"initial_or_new_candidate")
                    except Exception as e:
                        old=self.db.execute("SELECT attempts FROM scores WHERE job=? AND id=?",(job["id"],repo["id"])).fetchone()
                        attempts=(old[0] if old else 0)+1
                        self.db.execute("INSERT OR REPLACE INTO scores VALUES(?,?,?,?,?,?,?,?,?)",
                          (job["id"],repo["id"],repo["full_name"],None,None,None,time.time(),str(e)[:500],attempts))
                        self.db.commit()
                        self.event("history_unresolved",job["id"],repository_id=repo["id"],error=str(e)[:500])
                        if isinstance(e, StopRun) or getattr(e, "fatal", False) or getattr(e, "status", None)==401 or type(e).__name__=="StopRequested":
                            if hasattr(self.t,"cancel_pending"):self.t.cancel_pending()
                            raise StopRun(str(e)) from e
                    replenish()
                if time.time()-self.last_status>=30:self.state()

    def ranked(self, job, pass_no):
        repos=self.members(job["id"],pass_no)
        valid=[];missing=[]
        for rid,repo in repos.items():
            r=self.db.execute("SELECT * FROM scores WHERE job=? AND id=?",(job["id"],rid)).fetchone()
            if r is None or r["error"] is not None:missing.append(rid)
            else:valid.append(dict(r))
        return sorted(valid,key=lambda x:(-x["value"],x["repo"])),missing,repos

    def verify(self, job, pass_no):
        self.check_deadline()
        ranked,missing,repos=self.ranked(job,pass_no)
        if missing:
            raise RuntimeError(f"{len(missing)} current candidates unresolved; no complete leaderboard")
        if len(ranked)<20:raise RuntimeError("Fewer than twenty candidates")
        fresh=set()
        for iteration in range(3):
            ranked,missing,repos=self.ranked(job,pass_no)
            cutoff=ranked[19]["value"]
            # Check leaders and nearby upper bounds; old day counts can decrease.
            frontier=[x for x in ranked if x["value"] >= cutoff]
            needed=[x for x in frontier if x["id"] not in fresh]
            if not needed:break
            for row in needed:
                self.check_deadline()
                rp,value,response=self.fetch_score(job,repos[row["id"]],force=True)
                self.record_score(job,rp,value,response,"fresh_frontier_recheck")
                fresh.add(row["id"])
        ranked,missing,repos=self.ranked(job,pass_no)
        cutoff=ranked[19]["value"]
        if cutoff<=0:raise RuntimeError("Zero cutoff: cannot exclude all zero-star ties")
        if cutoff<job["threshold"]:
            self.event("expand_candidate_bound",job["id"],old=job["threshold"],cutoff=cutoff)
            self.update(job["id"],threshold=max(1,math.floor(cutoff*.9)),generation=job["generation"]+1,stage="enumerate_initial")
            return False
        leaders=[x for x in ranked if x["value"]>=cutoff]
        if any(x["id"] not in fresh for x in leaders):
            raise RuntimeError("Ranking frontier did not stabilize within three rechecks")
        # Strong inconsistency requires investigation, not a silent adjustment.
        anomalies=[x for x in ranked if x["value"]>repos[x["id"]]["stargazers_count"]]
        if anomalies:raise RuntimeError(f"{len(anomalies)} score/total-star bound inconsistencies")
        initial=self.members(job["id"],pass_no-1)
        self.check_deadline()
        finished=time.time()
        result={"job_id":job["id"],"statistical_day_label":job["day"],"bucket":bucket(job["day"]),
          "boundary_mode":"observed_utc_mapping","completed_day_verified":False,
          "scope":"GitHub indexed public repositories including forks; non-atomic batch sample",
          "algorithm":ALGORITHM,"planned_start":iso(job["due"]),"started_at":iso(job["started"]),
          "finished_at":iso(finished),"wall_seconds":round(finished-job["started"],2),
          "start_delay_seconds":max(0,round(job["started"]-job["due"],2)),
          "within_24h_observation_cycle":finished<=job["deadline"],
          "initial_candidates":len(initial),"final_candidates":len(repos),
          "added_candidates":sorted(set(repos)-set(initial)),"removed_candidates":sorted(set(initial)-set(repos)),
          "valid_scores":len(ranked),"unresolved":0,"cutoff":cutoff,"candidate_threshold":job["threshold"],
          "bound_condition":True,"top20_plus_ties":leaders,"complete_with_index_and_time_caveats":True,
          "api":self.t.stats(job["id"]),"code_hash":self.plan["code_hash"]}
        folder=self.root/"results"/job["id"];folder.mkdir(parents=True,exist_ok=True)
        atomic(folder/"result.json",result)
        lines=[f"# {job['day']} 日榜验证结果","", "范围：GitHub可检索公开仓库，含fork；固定官方日桶的观察映射，不是同一瞬间的全站快照。","",
               f"候选 {len(repos):,}，有效评分 {len(ranked):,}，未解决 0。第20名 {cutoff:,}；包含末位并列。","","|排名|项目|新增存续Star|","|---:|---|---:|"]
        last=None;rank=0
        for i,row in enumerate(leaders,1):
            if row["value"]!=last:rank=i
            last=row["value"]
            lines.append(f"|{rank}|[{row['repo']}](https://github.com/{row['repo']})|{row['value']:,}|")
        (folder/"榜单.md").write_text("\n".join(lines)+"\n")
        self.update(job["id"],status="complete",stage="complete",finished=finished,error=None)
        self.event("job_complete",job["id"],cutoff=cutoff,candidates=len(repos))
        return True

    def check_deadline(self):
        if (self.root/"STOP").exists():raise StopRun("User/local STOP marker present")
        if time.time()>self.plan["stop_after"]:raise StopRun("Finite validation deadline reached; do not extend automatically")

    def run_job(self, job):
        jid=job["id"]
        if job["started"] is None:
            previous=self.db.execute("SELECT id FROM jobs WHERE status='complete' ORDER BY due DESC LIMIT 1").fetchone()
            if previous:
                prev=json.loads((self.root/"results"/previous[0]/"result.json").read_text())
                self.update(jid,threshold=max(1,math.floor(prev["cutoff"]*.8)))
            self.update(jid,started=time.time(),status="running",error=None)
        else:self.update(jid,status="running",error=None)
        while True:
            self.check_deadline();job=self.job(jid)
            p=2*job["generation"]
            stage=job["stage"]
            if stage=="enumerate_initial":
                self.enumerate(job,p);self.update(jid,stage="collect_initial")
            elif stage=="collect_initial":
                self.collect(job,p);self.update(jid,stage="enumerate_fresh")
            elif stage=="enumerate_fresh":
                self.enumerate(job,p+1);self.update(jid,stage="collect_fresh_members")
            elif stage=="collect_fresh_members":
                self.collect(job,p+1);self.update(jid,stage="verify")
            elif stage=="verify":
                # Retry unresolved reads only, never erase successful same-job checkpoints.
                self.collect(job,p+1)
                if self.verify(job,p+1):return
            elif stage=="complete":return
            else:raise RuntimeError("Unknown stage "+stage)
            self.state()

    def run(self):
        self.event("process_started",pid=os.getpid())
        while True:
            self.check_deadline()
            jobs=[dict(x) for x in self.db.execute("SELECT * FROM jobs ORDER BY due")]
            pending=next((j for j in jobs if j["status"]!="complete"),None)
            if pending is None:
                self.event("finite_experiment_collection_finished")
                self.state();return
            wait_until=max(pending["due"],pending["retry_at"] or 0)
            if time.time()<wait_until:
                self.state();time.sleep(min(60,wait_until-time.time()));continue
            try:
                self.run_job(pending)
            except Exception as e:
                current=self.job(pending["id"])
                failures=current["failures"]+1
                self.update(pending["id"],status="attention",error=str(e)[:500],failures=failures,retry_at=time.time()+600)
                self.event("job_attention",pending["id"],error=str(e)[:500],failures=failures)
                self.state()
                if failures>=3 or isinstance(e,StopRun) or getattr(e,"fatal",False) or type(e).__name__=="StopRequested" or getattr(e,"status",None)==401:raise
            self.state()


def main():
    parser=argparse.ArgumentParser();parser.add_argument("command",choices=["run","status"])
    args=parser.parse_args()
    if args.command=="status":
        path=ROOT/"status.json"
        print(path.read_text() if path.exists() else '{"status":"not_started"}')
        return
    with (ROOT/"worker.lock").open("a") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another validator already owns the lock",flush=True);return
        atomic(ROOT/"process.json",{"pid":os.getpid(),"started_at":iso(),"command":"runner.py run"})
        runner=Runner()
        if source_hash(ROOT)!=runner.plan["code_hash"]:
            raise StopRun("Source version differs from frozen plan; preserve evidence and review before resuming")
        runner.t.recover_unknown_attempts()
        try:runner.run()
        except BaseException as e:
            runner.event("process_stopped",error=str(e)[:500]);runner.state();raise


if __name__=="__main__":main()
