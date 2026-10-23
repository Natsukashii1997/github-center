"""Offline, additive coverage proof. Never imports or writes the live collector.

Run from any directory with the existing Python standard library. This is an
isolated experiment, not a migration or permission to start the collector.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
SNAPSHOT = HERE / "snapshot"
PROBES = HERE / "probes"
CONTEXT = {"job": "cold", "pass": 0, "generation": 0, "threshold": 1013}
EXPECTED = {
    "2014-07-20": (22038525, 1793),
    "2023-05-22": (643828814, 1690),
    "2023-08-08": (676089005, 1351),
    "2024-10-12": (871717382, 1283),
    "2014-07-01": (21400970, 1045),
    "2026-03-31": (1197182525, 1045),
    "2019-05-16": (187098112, 1015),
    "2014-09-08": (23805266, 1013),
}
KEY_FIELDS = ("id", "full_name", "created_at", "private", "fork")
PROJECTED = KEY_FIELDS + ("stargazers_count", "description", "html_url", "updated_at")
ORIGINAL_TABLES = ("jobs", "shards", "members", "pages", "scores", "score_versions", "events")


class Rejected(ValueError):
    pass


def require(condition, why):
    if not condition:
        raise Rejected(why)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def readonly(path):
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def table_hash(conn, table):
    # Table names are the fixed local whitelist above, never external input.
    rows = [dict(row) for row in conn.execute(f'SELECT * FROM "{table}" ORDER BY rowid')]
    return {"count": len(rows), "sha256": sha(canonical(rows).encode())}


def check_snapshot():
    manifest = json.loads((SNAPSHOT / "manifest.json").read_text())
    for label in ("runner", "transport", "runner.py", "transport.py", "plan.json"):
        name = label + ".sqlite" if label in ("runner", "transport") else label
        require(sha((SNAPSHOT / name).read_bytes()) == manifest[label], f"snapshot hash mismatch: {name}")
    conn = readonly(SNAPSHOT / "runner.sqlite")
    job = dict(conn.execute("SELECT * FROM jobs WHERE id='cold'").fetchone())
    require(job["threshold"] == 1013 and job["generation"] == 0, "snapshot context changed")
    require(job["stage"] == "enumerate_initial", "unexpected snapshot stage")
    require(conn.execute("SELECT count(*) FROM members").fetchone()[0] == 65935, "unexpected baseline count")
    require(conn.execute("SELECT count(DISTINCT id) FROM members").fetchone()[0] == 65935, "duplicate baseline IDs")
    return conn


def read_probe(path):
    envelope = json.loads(path.read_text())
    raw = path.with_suffix(".body").read_bytes()
    require(sha(raw) == envelope.get("body_sha256"), f"body hash mismatch: {path.name}")
    require(json.loads(raw) == envelope.get("body"), f"body/envelope disagreement: {path.name}")
    envelope["_file"] = str(path.relative_to(HERE))
    return envelope


def validate_read(envelope, day):
    query = f"is:public fork:true stars:>=1012 created:{day}..{day}"
    require(envelope.get("http_status") == 200 and envelope.get("exit_code") == 0, "HTTP attempt not successful")
    require(envelope.get("query") == query, "query not the complete day superset")
    endpoint = urlsplit(envelope.get("endpoint", ""))
    require(endpoint.path == "search/repositories" and not endpoint.netloc and not endpoint.fragment, "endpoint mismatch")
    require(parse_qs(endpoint.query) == {"q": [query], "sort": ["stars"], "order": ["desc"], "per_page": ["100"], "page": ["1"]}, "endpoint query mismatch")
    require(isinstance(envelope.get("finished"), (int, float)) and envelope["finished"] >= envelope["started"], "unfinished probe")
    body = envelope["body"]
    require(body.get("incomplete_results") is False, "incomplete search")
    count = body.get("total_count")
    require(type(count) is int and 0 <= count <= 100, "requires uncollected additional pages")
    items = body.get("items")
    require(isinstance(items, list) and len(items) == count, "count/list disagreement")
    seen = set()
    for item in items:
        rid = item.get("id")
        require(type(rid) is int and rid > 0 and rid not in seen, "invalid or duplicate ID")
        seen.add(rid)
        require(item.get("private") is False and type(item.get("fork")) is bool, "public/fork metadata invalid")
        require(isinstance(item.get("created_at"), str) and item["created_at"][:10] == day, "wrong creation day")
        require(type(item.get("stargazers_count")) is int and item["stargazers_count"] >= 1012, "outside superset star bound")
        require(isinstance(item.get("full_name"), str) and "/" in item["full_name"], "missing repository identity")
    return {item["id"]: item for item in items}


def validate_pair(first, second, day, context=CONTEXT):
    require(context == CONTEXT, "certificate context mismatch; no reuse across job/pass/generation/threshold")
    a, b = validate_read(first, day), validate_read(second, day)
    require(second["started"] > first["finished"], "not an independent later read")
    require(a.keys() == b.keys(), "two-read ID set changed")
    changes = []
    for rid in a:
        changed = {key: [a[rid].get(key), b[rid].get(key)] for key in KEY_FIELDS if a[rid].get(key) != b[rid].get(key)}
        if changed:
            changes.append({"id": rid, "changes": changed})
    require(not changes, "two-read key metadata changed: " + canonical(changes))
    require(all((a[rid]["stargazers_count"] >= context["threshold"]) == (b[rid]["stargazers_count"] >= context["threshold"]) for rid in a), "two-read candidate/exclusion classification changed across threshold")
    expected_id = EXPECTED[day][0]
    require(expected_id in b, "known drift object absent from complete day")
    return b


def make_certificate(conn, first, second, day, context=CONTEXT):
    items = validate_pair(first, second, day, context)
    original = {}
    for row in conn.execute("SELECT * FROM members WHERE job='cold' AND pass=0"):
        item = json.loads(row["data"])
        if item["created_at"][:10] == day:
            original[row["id"]] = item
    require(original.keys() <= items.keys(), "previous valid day member missing from replacement")
    explanations = []
    for rid, before in original.items():
        after = items[rid]
        require(all(before.get(key) == after.get(key) for key in ("id", "full_name", "created_at", "private", "fork")), "previous member identity/scope changed")
        require(after["stargazers_count"] >= context["threshold"], "previous valid member now outside candidate bound")
        changes = {key: [before.get(key), after.get(key)] for key in before if before.get(key) != after.get(key)}
        explanations.append({"id": rid, "status": "reobserved", "changes": changes})
    accepted = {rid: item for rid, item in items.items() if item["stargazers_count"] >= context["threshold"]}
    excluded = {rid: item for rid, item in items.items() if item["stargazers_count"] < context["threshold"]}
    expected_id = EXPECTED[day][0]
    require(set(items) - set(original) == {expected_id}, "unexplained new or missing objects")
    require(set(excluded) == ({23805266} if day == "2014-09-08" else set()), "unexpected threshold exclusion")
    outside_ids = {row[0] for row in conn.execute("SELECT id FROM members") if row[0] not in original}
    require(not (accepted.keys() & outside_ids), "cross-day or outside-overlay duplicate")
    cert = {
        "context": dict(context), "day": day, "proof_lower_bound": 1012,
        "source_files": [first["_file"], second["_file"]],
        "source_hashes": [first["body_sha256"], second["body_sha256"]],
        "star_changes": [{"id": a["id"], "before": a["stargazers_count"], "after": items[a["id"]]["stargazers_count"], "classification_unchanged": True} for a in first["body"]["items"] if a["stargazers_count"] != items[a["id"]]["stargazers_count"]],
        "first_finished": first["finished"], "second_finished": second["finished"],
        "query": first["query"], "original_count": len(original), "observed_count": len(items),
        "candidate_count": len(accepted), "new_candidate_ids": sorted(set(accepted) - set(original)),
        "exclusions": [{"id": rid, "stars": item["stargazers_count"], "reason": "observed below bound 1013; preserved in proof, never inserted as candidate"} for rid, item in excluded.items()],
        "old_member_explanations": explanations,
        "replacement_scope": "all current candidate repositories on this creation day; original rows remain immutable",
        "claim_limit": "two complete non-atomic search observations; no historical or atomic GitHub snapshot claim",
    }
    cert["accepted_items"] = [{key: item.get(key) for key in PROJECTED} for _, item in sorted(accepted.items())]
    cert["excluded_items"] = [{key: item.get(key) for key in PROJECTED} for _, item in sorted(excluded.items())]
    cert["certificate_id"] = sha(canonical(cert).encode())
    return cert


SCHEMA = (
    "CREATE TABLE coverage_certificates(certificate_id TEXT PRIMARY KEY, job TEXT NOT NULL, pass INTEGER NOT NULL, generation INTEGER NOT NULL, threshold INTEGER NOT NULL, day TEXT NOT NULL, certificate TEXT NOT NULL, UNIQUE(job,pass,generation,threshold,day))",
    "CREATE TABLE overlay_members(certificate_id TEXT NOT NULL REFERENCES coverage_certificates(certificate_id), job TEXT NOT NULL, pass INTEGER NOT NULL, day TEXT NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(certificate_id,id))",
    "CREATE TABLE exclusions(certificate_id TEXT NOT NULL REFERENCES coverage_certificates(certificate_id), id INTEGER NOT NULL, data TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(certificate_id,id))",
    """CREATE VIEW effective_members AS
       SELECT m.job,m.pass,m.id,m.data,'original' AS evidence_type,m.shard AS evidence_key
       FROM members m WHERE NOT EXISTS (
         SELECT 1 FROM coverage_certificates c JOIN jobs j ON j.id=c.job
         WHERE c.job=m.job AND c.pass=m.pass AND c.generation=j.generation
         AND c.threshold=j.threshold AND c.day=substr(json_extract(m.data,'$.created_at'),1,10))
       UNION ALL
       SELECT o.job,o.pass,o.id,o.data,'coverage',o.certificate_id
       FROM overlay_members o JOIN coverage_certificates c ON c.certificate_id=o.certificate_id
       JOIN jobs j ON j.id=c.job WHERE c.generation=j.generation AND c.threshold=j.threshold""",
)


def clone(destination):
    require(destination.parent.resolve() == HERE.resolve(), "isolation destination must be this evidence directory")
    require(not destination.exists(), "refuse to overwrite existing isolated proof")
    source = readonly(SNAPSHOT / "runner.sqlite")
    target = sqlite3.connect(destination)
    source.backup(target)
    source.close()
    target.close()


def apply_certificates(path, certificates, crash=False, interrupt=False):
    require(path.parent.resolve() == HERE.resolve() and path.name.startswith("coverage-"), "only local isolated coverage databases may be changed")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("BEGIN IMMEDIATE")
    try:
        for sql in SCHEMA:
            conn.execute(sql)
        for index, certificate in enumerate(certificates):
            ctx = certificate["context"]
            unsigned = {key:value for key,value in certificate.items() if key != "certificate_id"}
            require(sha(canonical(unsigned).encode()) == certificate["certificate_id"], "certificate content hash mismatch")
            sources = [HERE / name for name in certificate["source_files"]]
            require(all(source.parent.resolve() == PROBES.resolve() for source in sources), "certificate source outside preserved probe directory")
            reconstructed = make_certificate(conn, read_probe(sources[0]), read_probe(sources[1]), certificate["day"], ctx)
            require(canonical(certificate) == canonical(reconstructed), "certificate does not reconstruct from preserved responses and original members")
            job = conn.execute("SELECT * FROM jobs WHERE id=?", (ctx["job"],)).fetchone()
            require(ctx == CONTEXT and job["threshold"] == ctx["threshold"] and job["generation"] == ctx["generation"], "adoption context mismatch")
            require(certificate["day"] in EXPECTED, "unsupported coverage day")
            cid = certificate["certificate_id"]
            conn.execute("INSERT INTO coverage_certificates VALUES(?,?,?,?,?,?,?)", (cid, ctx["job"], ctx["pass"], ctx["generation"], ctx["threshold"], certificate["day"], canonical(certificate)))
            for item in certificate["accepted_items"]:
                require(item["stargazers_count"] >= ctx["threshold"], "subthreshold item cannot enter candidate overlay")
                require(item["private"] is False and item["created_at"][:10] == certificate["day"], "overlay member scope violation")
                conn.execute("INSERT INTO overlay_members VALUES(?,?,?,?,?,?)", (cid,ctx["job"],ctx["pass"],certificate["day"],item["id"],canonical(item)))
            for item in certificate["excluded_items"]:
                require(item["stargazers_count"] < ctx["threshold"], "invalid exclusion")
                conn.execute("INSERT INTO exclusions VALUES(?,?,?,?)", (cid,item["id"],canonical(item),"below candidate threshold; retained as coverage evidence"))
            if index == 0 and crash:
                os._exit(29)
            if index == 0 and interrupt:
                raise RuntimeError("injected interruption before atomic commit")
        duplicates = conn.execute("SELECT id FROM effective_members GROUP BY job,pass,id HAVING count(*)>1").fetchall()
        require(not duplicates, "effective membership duplicates")
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def assert_complete(conn, context=CONTEXT):
    require(context == CONTEXT, "completion context mismatch")
    unresolved = []
    for shard in conn.execute("SELECT * FROM shards WHERE job=? AND pass=? AND status NOT IN ('complete','split')", (context["job"],context["pass"])):
        cert = conn.execute("SELECT 1 FROM coverage_certificates WHERE job=? AND pass=? AND generation=? AND threshold=? AND day=?", (context["job"],context["pass"],context["generation"],context["threshold"],shard["cl"])).fetchone()
        if not (shard["cl"] == shard["ch"] and shard["cl"] in EXPECTED and cert):
            unresolved.append(shard["key"])
    require(not unresolved, "unresolved coverage still blocks completion: " + canonical(unresolved))


def negative_checks(conn, pairs, certificates):
    results = []
    day = "2014-07-20"
    first, second = pairs[day]

    def rejects(name, fn):
        try:
            fn()
        except (Rejected, sqlite3.IntegrityError) as exc:
            results.append({"name":name,"passed":True,"reason":str(exc)})
        else:
            raise AssertionError("negative test accepted invalid evidence: " + name)

    def mutate_both(mutator):
        a,b = copy.deepcopy(first),copy.deepcopy(second)
        mutator(a["body"]); mutator(b["body"])
        return a,b

    a,b=mutate_both(lambda x:x["items"].pop())
    rejects("missing item",lambda:validate_pair(a,b,day))
    def wrong_id(x):
        next(item for item in x["items"] if item["id"]==EXPECTED[day][0])["id"]=99999999999
    a,b=mutate_both(wrong_id)
    rejects("known ID replaced in both reads",lambda:validate_pair(a,b,day))
    a,b=mutate_both(lambda x:x["items"][0].update(created_at="2000-01-01T00:00:00Z"))
    rejects("wrong creation date",lambda:validate_pair(a,b,day))
    a,b=mutate_both(lambda x:x.update(total_count=x["total_count"]+1))
    rejects("total count contradiction",lambda:validate_pair(a,b,day))
    a,b=mutate_both(lambda x:x["items"][0].update(id=x["items"][1]["id"]))
    rejects("duplicate ID",lambda:validate_pair(a,b,day))
    for initial,changed in ((1012,1013),(1013,1012),(1012,1011)):
        a,b=copy.deepcopy(first),copy.deepcopy(second)
        a["body"]["items"][0]["stargazers_count"]=initial
        b["body"]["items"][0]["stargazers_count"]=changed
        rejects(f"stars cross bound {initial} to {changed}",lambda a=a,b=b:validate_pair(a,b,day))
    for delta in (-1,1):
        a,b=copy.deepcopy(first),copy.deepcopy(second)
        b["body"]["items"][0]["stargazers_count"]+=delta
        proof=make_certificate(conn,a,b,day)
        require(bool(proof["star_changes"]),"normal star movement accepted without audit delta")
        results.append({"name":f"high stars {delta:+d} preserves scope/classification and logged", "passed":True})
    a,b=mutate_both(lambda x:x.update(incomplete_results=True))
    rejects("incomplete results",lambda:validate_pair(a,b,day))
    for key,value in (("threshold",1012),("pass",1),("generation",1),("job","day1")):
        context=dict(CONTEXT);context[key]=value
        rejects("certificate context changes "+key,lambda context=context:validate_pair(first,second,day,context))
    # Never touch the true evidence files: a separate temporary envelope verifies tamper rejection.
    with tempfile.TemporaryDirectory(prefix="proof-test-",dir=HERE) as folder:
        fake=Path(folder)/"fake.json"
        fake.write_text(json.dumps(first));fake.with_suffix(".body").write_text("{}")
        rejects("body hash tampering",lambda:read_probe(fake))
    # SQLite interruption, real child-process termination and crash recovery.
    for mode in ("exception","crash","subthreshold"):
        path=HERE/f"coverage-test-{mode}.sqlite"
        require(not path.exists(),"unexpected previous test artifact")
        clone(path)
        if mode=="crash":
            child=subprocess.run([sys.executable,str(Path(__file__).resolve()),"--crash-child",str(path),canonical(certificates)],capture_output=True,text=True)
            require(child.returncode==29,"crash injection did not trigger")
        elif mode=="exception":
            try:apply_certificates(path,certificates,interrupt=True)
            except RuntimeError:pass
            else:raise AssertionError("expected injected interruption")
        else:
            bad=copy.deepcopy(certificates)
            bad[0]["accepted_items"][0]["stargazers_count"]=1012
            bad[0]["certificate_id"]=sha(canonical({key:value for key,value in bad[0].items() if key!="certificate_id"}).encode())
            rejects("1012 candidate insertion",lambda:apply_certificates(path,bad))
        check=sqlite3.connect(path)
        check.row_factory=sqlite3.Row
        require(not check.execute("SELECT 1 FROM sqlite_master WHERE name='coverage_certificates'").fetchone(),"partial adoption survived rollback/crash")
        require(check.execute("PRAGMA integrity_check").fetchone()[0]=="ok","crash recovery integrity failed")
        require(all(table_hash(check,t)==table_hash(conn,t) for t in ORIGINAL_TABLES),"original rows changed during failure")
        check.close();path.unlink()
        results.append({"name":mode+" atomic adoption rollback", "passed":True})
    return results


def main():
    conn=check_snapshot()
    before={table:table_hash(conn,table) for table in ORIGINAL_TABLES}
    pairs={};certificates=[];rejections=[];strict_failures=[]
    for day in EXPECTED:
        first_files=sorted(PROBES.glob("*-drift_day_"+day.replace("-","_")+".json"))
        second_files=sorted(PROBES.glob("*-confirm_day_"+day.replace("-","_")+".json"))
        try:
            require(len(first_files)==1 and len(second_files)==1,"requires exactly two specified day probes")
            first,second=read_probe(first_files[0]),read_probe(second_files[0])
            pairs[day]=(first,second)
            first_by_id={item["id"]:item for item in first["body"]["items"]}
            deltas=[{"id":item["id"],"before":first_by_id[item["id"]]["stargazers_count"],"after":item["stargazers_count"]} for item in second["body"]["items"] if item["id"] in first_by_id and item["stargazers_count"]!=first_by_id[item["id"]]["stargazers_count"]]
            if deltas:
                strict_failures.append({"day":day,"initial_strict_exact_star_comparison":"failed", "deltas":deltas,"raw_evidence_retained":[first["_file"],second["_file"]]})
            certificates.append(make_certificate(conn,first,second,day))
        except (Rejected,FileNotFoundError) as exc:
            rejections.append({"day":day,"reason":str(exc)})
    output={"generated_at":time.time(),"scope":"isolated coverage demonstration only; no production adoption", "context":CONTEXT,"baseline":before,"certificates":certificates,"rejections":rejections,"all_eight_day_proofs_pass":len(certificates)==8,"production_adopted":False,"collection_resumed":False}
    output["strict_comparison_first_failure_evidence"]=strict_failures
    output["comparison_contract"]={"required_equal":["total_count","ID set","ID","full_name","created_at","private","fork","candidate versus excluded classification"],"every_read_requires":"complete same-day public fork-inclusive stars >=1012 search, <=100 total, exact item count, unique IDs", "star_policy":"Exact total stars may move while remaining inside the same complete day query and same >=1013 candidate class. Every movement is retained; crossing 1012/1013 or dropping below 1012 is rejected.", "reason":"The day-wide proof removes internal star partition boundaries. Its purpose is complete candidate membership, not frozen total-star metadata. Fixed-day growth scores must still be collected separately and are currently absent.", "metadata_used":"second complete observation; both original response files preserved", "atomic_snapshot_claim":False}
    require(bool(certificates),"no valid certificate available for safety failure-path tests")
    output["negative_checks"]=negative_checks(conn,pairs,certificates)
    isolated=HERE/"coverage-isolated.sqlite"
    clone(isolated)
    apply_certificates(isolated,certificates)
    check=readonly(isolated)
    require(all(table_hash(check,t)==before[t] for t in ORIGINAL_TABLES),"original tables were modified")
    counts={"original":check.execute("SELECT count(*) FROM members").fetchone()[0],"effective":check.execute("SELECT count(*) FROM effective_members").fetchone()[0],"certificates":len(certificates),"retained_retry_pending":check.execute("SELECT count(*) FROM shards WHERE status='retry_pending'").fetchone()[0],"retained_anomaly_events":check.execute("SELECT count(*) FROM events WHERE event IN ('search_count_list_mismatch','search_leaf_drift_deferred')").fetchone()[0]}
    effective={row["id"]:row for row in check.execute("SELECT * FROM effective_members")}
    days=set(EXPECTED)
    outside=[row for row in conn.execute("SELECT * FROM members") if json.loads(row["data"])["created_at"][:10] not in days]
    require(len(outside)==65794,"outside-day baseline changed")
    require(all(effective[row["id"]]["data"]==row["data"] and effective[row["id"]]["evidence_key"]==row["shard"] and effective[row["id"]]["evidence_type"]=="original" for row in outside),"outside-day effective rows changed")
    require(23805266 not in effective,"1012 object was incorrectly accepted")
    counts["outside_eight_days_unchanged"]=len(outside)
    counts["old_eight_day_members"]=65935-len(outside)
    counts["new_candidate_ids"]=sorted(set(effective)-{row[0] for row in conn.execute("SELECT id FROM members")})
    output["isolated_counts"]=counts
    try:assert_complete(check)
    except Rejected as exc:
        output["completion_gate"]={"passed":False,"expected_rejection":True,"reason":str(exc)}
        output["negative_checks"].append({"name":"unresolved empty leaf blocks full completion","passed":True,"reason":str(exc)})
    else:raise AssertionError("unresolved empty item was silently bypassed")
    output["original_tables_unchanged"]=True
    snapshot_recheck=check_snapshot();snapshot_recheck.close()
    output["snapshot_hashes_unchanged"]=True
    output["isolated_database"]=str(isolated)
    check.close();conn.close()
    target=HERE/"coverage-validation.json"
    require(not target.exists(),"refuse overwriting prior verification report")
    target.write_text(json.dumps(output,ensure_ascii=False,indent=2))
    print(json.dumps({key:output[key] for key in ("all_eight_day_proofs_pass","rejections","isolated_counts","completion_gate","production_adopted","collection_resumed")},ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv)>1 and sys.argv[1]=="--crash-child":
        apply_certificates(Path(sys.argv[2]),json.loads(sys.argv[3]),crash=True)
    else:
        main()
