"""Offline runner behavioral checks. Fake transport only; no network calls."""
import hashlib
import importlib.util
import json
import re
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("review_runner", HERE / "runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
SOURCE_HASH = hashlib.sha256((HERE / "runner.py").read_bytes()).hexdigest()
EVIDENCE = HERE / "review-evidence"
EVIDENCE.mkdir(exist_ok=True)


def repo(i, stars=10000):
    return {"id": i, "full_name": f"fixture/repo-{i}", "stargazers_count": stars,
            "private": False, "created_at": "2010-01-01T00:00:00Z", "fork": False}


class Unauthorized(RuntimeError):
    status = 401


class FakeTransport:
    def __init__(self, rows, mode="normal", root=None):
        self.rows, self.mode, self.root = rows, mode, root
        self.calls = []
        self.search_count = {}
        self.interrupted = False

    def stats(self, job):
        return {"requests": sum(x["job"] == job for x in self.calls)}

    def status(self):
        return {"fake": True}

    def get(self, endpoint, job, conditional=True, force=False):
        self.calls.append({"endpoint": endpoint, "job": job, "conditional": conditional, "force": force})
        rid = len(self.calls)
        if endpoint.startswith("search/"):
            params = parse_qs(urlparse("https://local.invalid/" + endpoint).query)
            q = params["q"][0]
            page = int(params["page"][0])
            if self.mode == "page_interrupt" and page == 2 and not self.interrupted:
                self.interrupted = True
                raise KeyboardInterrupt("planned offline interruption")
            n = self.search_count.get(job, 0)
            self.search_count[job] = n + 1
            items = self.rows
            if self.mode == "fresh_change" and n > 0:
                items = self.rows[1:] + [repo(22)]
            match = re.search(r"stars:(?:>=(\d+)|(\d+)\.\.(\d+))", q)
            lo = int(match[1] or match[2]); hi = int(match[3]) if match[3] else None
            items = [r for r in items if r["stargazers_count"] >= lo and (hi is None or r["stargazers_count"] <= hi)]
            items = sorted(items, key=lambda r: (-r["stargazers_count"], r["id"]))
            body = {"total_count": len(items), "incomplete_results": False,
                    "items": items[(page-1)*100:page*100]}
        else:
            if self.mode == "unauthorized":
                raise Unauthorized("fake global authentication failure")
            identifier = int(endpoint.split("/")[1])
            if self.mode == "missing" and identifier == 21:
                body = []
            else:
                values = [0, 0, 100+identifier, 200+identifier, 300+identifier, 400+identifier, 0]
                if self.mode == "ties":
                    values[2] = 100 if identifier <= 19 else (50 if identifier <= 22 else 1)
                body = [{"week": 1792281600, "total": sum(values), "days": values}]
            if self.mode == "stop_during_verify" and force:
                (self.root / "STOP").write_text("offline controlled stop")
        return {"body": body, "request_id": rid,
                "body_hash": hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()}


def environment(tmp, rows, mode="normal", four=False):
    jobs = []
    for i, name in enumerate(["cold", "day1", "day2", "day3"] if four else ["cold"]):
        jobs.append({"id": name, "day": f"2026-10-{20+i}", "due": time.time()-100+i,
                     "deadline": time.time()+1000})
    plan = {"jobs": jobs, "initial_threshold": 1, "prior_usage_log": "unused",
            "stop_after": time.time()+2000, "code_hash": SOURCE_HASH}
    (tmp / "plan.json").write_text(json.dumps(plan))
    transport = FakeTransport(rows, mode, tmp)
    r = runner.Runner(tmp, transport)
    r.last_status = time.time()
    return r, transport


results = []
def check(name, function):
    with tempfile.TemporaryDirectory(dir=EVIDENCE, prefix="case-") as temp:
        try:
            observed = function(Path(temp))
            results.append({"name": name, "passed": True, "observed": observed})
        except Exception as e:
            results.append({"name": name, "passed": False, "error": str(e)})


def split_coverage(tmp):
    r, t = environment(tmp, [repo(i, 9001-i) for i in range(1,1002)])
    r.enumerate(r.job("cold"), 0)
    assert len(r.members("cold",0)) == 1001
    leaves = [dict(x) for x in r.db.execute("SELECT * FROM shards WHERE status='complete' ORDER BY lo")]
    assert leaves[0]["lo"] == 1 and leaves[-1]["hi"] is None
    assert all(a["hi"]+1 == b["lo"] for a,b in zip(leaves,leaves[1:]))
    return {"members":1001, "leaves":len(leaves), "contiguous":True, "requests":len(t.calls)}


def page_resume(tmp):
    r,t = environment(tmp,[repo(i) for i in range(1,151)],"page_interrupt")
    try:r.enumerate(r.job("cold"),0)
    except KeyboardInterrupt:pass
    assert len(r.members("cold",0)) == 100
    r.db.close()
    r = runner.Runner(tmp,t)
    r.enumerate(r.job("cold"),0)
    pages = [parse_qs(urlparse("https://local.invalid/"+x["endpoint"]).query)["page"][0] for x in t.calls]
    assert pages == ["1","2","2"] and len(r.members("cold",0)) == 150
    return {"pages_requested":pages, "final_members":150, "successful_page_not_repeated":True}


def fresh_change(tmp):
    r,t=environment(tmp,[repo(i) for i in range(1,22)],"fresh_change")
    r.run()
    out=json.loads((tmp/"results/cold/result.json").read_text())
    assert out["added_candidates"] == [22] and out["removed_candidates"] == [1]
    assert 22 in [x["id"] for x in out["top20_plus_ties"]] and 1 not in [x["id"] for x in out["top20_plus_ties"]]
    return {"added":out["added_candidates"], "removed":out["removed_candidates"], "complete":True}


def missing_not_zero(tmp):
    r,t=environment(tmp,[repo(i) for i in range(1,22)],"missing")
    try:r.run_job(r.job("cold"))
    except RuntimeError as e:
        assert "unresolved" in str(e)
    else:raise AssertionError("Missing history silently completed")
    assert not (tmp/"results/cold/result.json").exists()
    return {"complete":False, "missing_repo_error_retained":r.db.execute("SELECT error FROM scores WHERE id=21").fetchone()[0]}


def windows_order(tmp):
    r,t=environment(tmp,[repo(i) for i in range(1,22)],four=True)
    r.run()
    runs=[json.loads((tmp/f"results/{name}/result.json").read_text()) for name in ("cold","day1","day2","day3")]
    assert [x["bucket"][1] for x in runs] == [2,3,4,5]
    assert [x["cutoff"] for x in runs] == [102,202,302,402]
    sequence=list(dict.fromkeys(x["job"] for x in t.calls))
    assert sequence == ["cold","day1","day2","day3"]
    before=len(t.calls);r.run();assert len(t.calls)==before
    assert all(not x["conditional"] for x in t.calls if x["job"]=="cold" and not x["endpoint"].startswith("search/"))
    return {"job_order":sequence, "cutoffs":[x["cutoff"] for x in runs], "rerun_requests":0}


def ties(tmp):
    r,t=environment(tmp,[repo(i) for i in range(1,24)],"ties")
    r.run()
    out=json.loads((tmp/"results/cold/result.json").read_text())
    assert out["cutoff"]==50 and len(out["top20_plus_ties"])==22
    return {"cutoff":50,"ranked_rows":22}


def auth_stop(tmp):
    r,t=environment(tmp,[repo(i) for i in range(1,41)],"unauthorized")
    r.enumerate(r.job("cold"),0)
    raised=False
    try:r.collect(r.job("cold"),0)
    except Exception:raised=True
    requests=sum(not x["endpoint"].startswith("search/") for x in t.calls)
    assert raised and requests <= 4, f"Global 401 swallowed; history requests={requests}, raised={raised}"
    return {"history_requests":requests,"batch_aborted":raised}


def stop_during_verify(tmp):
    r,t=environment(tmp,[repo(i) for i in range(1,22)],"stop_during_verify")
    try:r.run_job(r.job("cold"))
    except RuntimeError:pass
    forced=sum(x["force"] for x in t.calls)
    assert forced<=1 and not (tmp/"results/cold/result.json").exists(), f"STOP ignored: forced_requests={forced}, result_written={(tmp/'results/cold/result.json').exists()}"
    return {"forced_reads":forced,"result_written":False}


for name, fn in [("split_coverage",split_coverage),("page_resume",page_resume),("fresh_membership",fresh_change),
                 ("missing_not_zero",missing_not_zero),("job_window_order_and_stop",windows_order),
                 ("last_place_ties",ties),("global_auth_failure_stop",auth_stop),("stop_during_verify",stop_during_verify)]:
    check(name,fn)
output={"source_sha256":SOURCE_HASH,"network_requests":0,"results":results}
path=EVIDENCE/("runner-tests-"+SOURCE_HASH[:10]+".json")
path.write_text(json.dumps(output,ensure_ascii=False,indent=2))
print(json.dumps(output,ensure_ascii=False,indent=2))
