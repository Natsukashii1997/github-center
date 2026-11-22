"""Isolated monotone candidate proof, preserving every original admission.

This script neither imports the live collector nor starts it. It reuses the
previous offline validator's source checks and leaves its first failure intact.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

import validate_coverage as base

HERE = Path(__file__).resolve().parent
CTX = base.CONTEXT
Rejected = base.Rejected
require = base.require
canonical = base.canonical
sha = base.sha
EAIO = 643942082
COMMONMARK = 23805266


def make_certificate(conn, first, second, day, context=CTX):
    observed = base.validate_pair(first, second, day, context)
    original = {}
    for row in conn.execute("SELECT m.*,s.status AS shard_status FROM members m JOIN shards s ON s.job=m.job AND s.pass=m.pass AND s.key=m.shard WHERE m.job='cold' AND m.pass=0"):
        data = json.loads(row["data"])
        if data["created_at"][:10] == day:
            require(row["shard_status"] == "complete", "original admission was not from a completed shard")
            original[row["id"]] = (dict(row),data)
    require(original.keys() <= observed.keys(), "old day ID missing from complete re-observation")
    expected = base.EXPECTED[day][0]
    require(set(observed)-set(original) == {expected}, "unexpected new IDs in day proof")
    current_qualified = {rid:item for rid,item in observed.items() if item["stargazers_count"] >= context["threshold"]}
    current_below = {rid:item for rid,item in observed.items() if item["stargazers_count"] < context["threshold"]}
    additions = {rid:item for rid,item in current_qualified.items() if rid not in original}
    historical = {rid:item for rid,item in current_below.items() if rid in original}
    exclusions = {rid:item for rid,item in current_below.items() if rid not in original}
    require(set(historical) == ({EAIO} if day == "2023-05-22" else set()), "unexpected historical-only admission")
    require(set(exclusions) == ({COMMONMARK} if day == "2014-09-08" else set()), "unexpected never-admitted exclusion")
    all_old_ids = {row[0] for row in conn.execute("SELECT id FROM members")}
    require(not additions.keys() & all_old_ids, "overlay would duplicate an existing admitted ID")
    old_observations = []
    for rid,(row,before) in original.items():
        after = observed[rid]
        require(all(before.get(key)==after.get(key) for key in base.KEY_FIELDS), "old identity or public/day scope changed")
        require(before["stargazers_count"] >= context["threshold"], "original admission did not meet its bound")
        old_observations.append({
            "id":rid, "original_data_sha256":sha(row["data"].encode()),
            "original_request_id":row["request_id"], "original_shard":row["shard"],
            "admission_stars":before["stargazers_count"],
            "latest_observed_stars":after["stargazers_count"],
            "candidate_status":"retained_original_admission",
            "current_class":"qualified" if rid in current_qualified else "below_current_bound",
            "changes":{key:[before.get(key),after.get(key)] for key in before if before.get(key)!=after.get(key)},
        })
    first_by_id = {item["id"]:item for item in first["body"]["items"]}
    certificate = {
        "context":dict(context), "day":day, "query":first["query"],
        "proof_lower_bound":1012, "source_files":[first["_file"],second["_file"]],
        "source_hashes":[first["body_sha256"],second["body_sha256"]],
        "observation_times":[first["finished"],second["finished"]],
        "observed_count":len(observed), "current_qualified_count":len(current_qualified),
        "original_admitted_count":len(original), "conservative_candidate_count":len(original)+len(additions),
        "star_changes_between_reads":[{"id":rid,"before":first_by_id[rid]["stargazers_count"],"after":item["stargazers_count"]} for rid,item in observed.items() if first_by_id[rid]["stargazers_count"]!=item["stargazers_count"]],
        "old_member_observations":sorted(old_observations,key=lambda item:item["id"]),
        "overlay_items":[{key:item.get(key) for key in base.PROJECTED} for rid,item in sorted(additions.items())],
        "latest_items":[{key:item.get(key) for key in base.PROJECTED} for rid,item in sorted(observed.items())],
        "retained_despite_current_below":[{"id":rid,"admission_stars":original[rid][1]["stargazers_count"],"latest_stars":item["stargazers_count"],"reason":"keep original valid admission for conservative initial scoring; never present its admission value as the latest observation"} for rid,item in historical.items()],
        "exclusions":[{"id":rid,"latest_stars":item["stargazers_count"],"reason":"no previous valid admission and below threshold; never enter overlay"} for rid,item in exclusions.items()],
        "claim":"complete day re-observation plus monotone historical candidate union; not a latest-all-above-threshold or atomic snapshot claim",
    }
    certificate["certificate_id"] = sha(canonical(certificate).encode())
    return certificate


SCHEMA = (
    "CREATE TABLE coverage_certificates(certificate_id TEXT PRIMARY KEY,job TEXT NOT NULL,pass INTEGER NOT NULL,generation INTEGER NOT NULL,threshold INTEGER NOT NULL,day TEXT NOT NULL,certificate TEXT NOT NULL,UNIQUE(job,pass,generation,threshold,day))",
    "CREATE TABLE overlay_members(certificate_id TEXT NOT NULL REFERENCES coverage_certificates(certificate_id),job TEXT NOT NULL,pass INTEGER NOT NULL,id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(certificate_id,id))",
    "CREATE TABLE latest_observations(certificate_id TEXT NOT NULL REFERENCES coverage_certificates(certificate_id),id INTEGER NOT NULL,data TEXT NOT NULL,disposition TEXT NOT NULL,PRIMARY KEY(certificate_id,id))",
    "CREATE TABLE exclusions(certificate_id TEXT NOT NULL REFERENCES coverage_certificates(certificate_id),id INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(certificate_id,id))",
    """CREATE VIEW effective_members AS
       SELECT job,pass,id,data,'original_admission' AS evidence_type,shard AS evidence_key FROM members
       UNION ALL
       SELECT o.job,o.pass,o.id,o.data,'new_observation',o.certificate_id
       FROM overlay_members o JOIN coverage_certificates c ON c.certificate_id=o.certificate_id
       JOIN jobs j ON j.id=c.job WHERE c.generation=j.generation AND c.threshold=j.threshold""",
)


def clone(path):
    require(path.parent.resolve()==HERE and path.name.startswith("monotone-"),"only isolated monotone destination allowed")
    require(not path.exists(),"refuse overwriting prior proof")
    source=base.readonly(base.SNAPSHOT/"runner.sqlite");target=sqlite3.connect(path)
    source.backup(target);target.close();source.close()


def verify_monotonicity(conn, originals):
    effective={row["id"]:dict(row) for row in conn.execute("SELECT * FROM effective_members WHERE job='cold' AND pass=0")}
    require(all(rid in effective and effective[rid]["data"]==row["data"] and effective[rid]["evidence_type"]=="original_admission" and effective[rid]["evidence_key"]==row["shard"] for rid,row in originals.items()),"original admission deleted, replaced, or relabelled")
    require(COMMONMARK not in effective,"CommonMark 1012 is not an admitted candidate")
    return effective


def apply(path, certificates, crash=False, interrupt=False):
    require(path.parent.resolve()==HERE and path.name.startswith("monotone-"),"only isolated monotone database may be written")
    conn=sqlite3.connect(path);conn.row_factory=sqlite3.Row
    originals={row["id"]:dict(row) for row in conn.execute("SELECT * FROM members")}
    original_hashes={table:base.table_hash(conn,table) for table in base.ORIGINAL_TABLES}
    conn.execute("PRAGMA foreign_keys=ON");conn.execute("BEGIN IMMEDIATE")
    try:
        for sql in SCHEMA:conn.execute(sql)
        for index,cert in enumerate(certificates):
            ctx=cert["context"]
            require(ctx==CTX,"certificate cannot be reused across job/pass/generation/threshold")
            job=conn.execute("SELECT * FROM jobs WHERE id=?",(ctx["job"],)).fetchone()
            require(job["threshold"]==ctx["threshold"] and job["generation"]==ctx["generation"],"current job context changed")
            sources=[HERE/name for name in cert["source_files"]]
            require(len(sources)==2 and all(p.parent.resolve()==base.PROBES for p in sources),"source outside preserved probe set")
            expected=make_certificate(conn,base.read_probe(sources[0]),base.read_probe(sources[1]),cert["day"],ctx)
            require(canonical(expected)==canonical(cert),"certificate or latest observation differs from immutable raw reconstruction")
            cid=cert["certificate_id"]
            conn.execute("INSERT INTO coverage_certificates VALUES(?,?,?,?,?,?,?)",(cid,ctx["job"],ctx["pass"],ctx["generation"],ctx["threshold"],cert["day"],canonical(cert)))
            overlay_ids=set()
            for item in cert["overlay_items"]:
                require(item["id"] not in originals and item["stargazers_count"]>=ctx["threshold"],"invalid extra candidate admission")
                overlay_ids.add(item["id"])
                conn.execute("INSERT INTO overlay_members VALUES(?,?,?,?,?)",(cid,ctx["job"],ctx["pass"],item["id"],canonical(item)))
            excluded_ids={item["id"] for item in cert["exclusions"]}
            for item in cert["latest_items"]:
                disposition="new_admission" if item["id"] in overlay_ids else "never_admitted_excluded" if item["id"] in excluded_ids else "retained_original_admission"
                conn.execute("INSERT INTO latest_observations VALUES(?,?,?,?)",(cid,item["id"],canonical(item),disposition))
            for item in cert["exclusions"]:
                conn.execute("INSERT INTO exclusions VALUES(?,?,?)",(cid,item["id"],item["reason"]))
            if index==0 and crash:os._exit(29)
            if index==0 and interrupt:raise RuntimeError("injected interruption before full batch commit")
        require(not conn.execute("SELECT id FROM effective_members GROUP BY job,pass,id HAVING count(*)>1").fetchall(),"duplicate admitted IDs")
        verify_monotonicity(conn,originals)
        require(all(base.table_hash(conn,t)==original_hashes[t] for t in base.ORIGINAL_TABLES),"original table changed")
        conn.commit()
    except BaseException:
        conn.rollback();raise
    finally:conn.close()


def tests(conn,pairs,certificates):
    results=[]
    def rejected(name,fn):
        try:fn()
        except Rejected as exc:results.append({"name":name,"passed":True,"reason":str(exc)})
        else:raise AssertionError("invalid proof accepted: "+name)
    day="2014-07-20";first,second=pairs[day]
    for initial,changed in ((1012,1013),(1013,1012),(1012,1011)):
        a,b=copy.deepcopy(first),copy.deepcopy(second)
        a["body"]["items"][0]["stargazers_count"]=initial;b["body"]["items"][0]["stargazers_count"]=changed
        rejected(f"crosses bound {initial} to {changed}",lambda a=a,b=b:base.validate_pair(a,b,day))
    for delta in (-1,1):
        a,b=copy.deepcopy(first),copy.deepcopy(second);b["body"]["items"][0]["stargazers_count"]+=delta
        proof=make_certificate(conn,a,b,day)
        require(bool(proof["star_changes_between_reads"]),"accepted star movement missing audit evidence")
        results.append({"name":f"high star change {delta:+d} logged","passed":True})
    # Targeted revision checks supplement the existing source-integrity and coverage tests.
    for mode in ("omit_eaio","fake_latest","import_commonmark","pass","threshold","exception","crash"):
        path=HERE/f"monotone-test-{mode}.sqlite";clone(path)
        changed=copy.deepcopy(certificates)
        if mode=="omit_eaio":
            temp=sqlite3.connect(path);temp.row_factory=sqlite3.Row
            apply(path,certificates)
            originals={row["id"]:dict(row) for row in conn.execute("SELECT * FROM members")}
            # Only the disposable copy is damaged, to exercise the invariant.
            temp.execute("DELETE FROM members WHERE id=?",(EAIO,));temp.commit()
            rejected("cannot delete old eaio admission",lambda:verify_monotonicity(temp,originals));temp.close();path.unlink();continue
        if mode=="fake_latest":
            cert=next(c for c in changed if c["day"]=="2023-05-22")
            next(item for item in cert["latest_items"] if item["id"]==EAIO)["stargazers_count"]=1013
        if mode=="import_commonmark":
            cert=next(c for c in changed if c["day"]=="2014-09-08")
            cert["overlay_items"].append(next(item for item in cert["latest_items"] if item["id"]==COMMONMARK))
        if mode in ("pass","threshold"):changed[0]["context"][mode]=1 if mode=="pass" else 1012
        if mode=="exception":
            try:apply(path,certificates,interrupt=True)
            except RuntimeError:pass
            else:raise AssertionError("injected exception failed")
        elif mode=="crash":
            result=subprocess.run([sys.executable,str(Path(__file__).resolve()),"--crash",str(path),canonical(certificates)],capture_output=True,text=True)
            require(result.returncode==29,"child did not terminate before commit")
        else:rejected(mode+" certificate rejected",lambda:apply(path,changed))
        check=sqlite3.connect(path);check.row_factory=sqlite3.Row
        require(not check.execute("SELECT 1 FROM sqlite_master WHERE name='coverage_certificates'").fetchone(),"partial adoption survived rejection/crash")
        require(all(base.table_hash(check,t)==base.table_hash(conn,t) for t in base.ORIGINAL_TABLES),"original tables changed after failed adoption")
        require(check.execute("PRAGMA integrity_check").fetchone()[0]=="ok","database corruption after crash")
        check.close();path.unlink()
        results.append({"name":mode+" atomic rollback","passed":True})
    return results


def main():
    conn=base.check_snapshot();pairs={};certificates=[]
    for day in base.EXPECTED:
        first=base.read_probe(next(base.PROBES.glob("*-drift_day_"+day.replace("-","_")+".json")))
        second=base.read_probe(next(base.PROBES.glob("*-confirm_day_"+day.replace("-","_")+".json")))
        pairs[day]=(first,second);certificates.append(make_certificate(conn,first,second,day))
    checks=tests(conn,pairs,certificates)
    path=HERE/"monotone-isolated.sqlite";clone(path);apply(path,certificates)
    check=base.readonly(path)
    originals={row["id"]:dict(row) for row in conn.execute("SELECT * FROM members")}
    effective=verify_monotonicity(check,originals)
    added=sorted(set(effective)-set(originals))
    require(len(effective)==65942 and len(added)==7,"unexpected conservative candidate count")
    require(sum(c["observed_count"] for c in certificates)==149,"unexpected latest observation count")
    require(sum(c["current_qualified_count"] for c in certificates)==147,"unexpected currently qualified count")
    require(sum(c["original_admitted_count"] for c in certificates)==141,"old day member count mismatch")
    require(sum(c["conservative_candidate_count"] for c in certificates)==148,"day candidate union count mismatch")
    eaio_latest=json.loads(check.execute("SELECT data FROM latest_observations WHERE id=?",(EAIO,)).fetchone()[0])
    require(json.loads(effective[EAIO]["data"])["stargazers_count"]==1013 and eaio_latest["stargazers_count"]==1012,"eaio admission/latest observations conflated")
    try:base.assert_complete(check)
    except Rejected as exc:
        gate={"passed":False,"expected_rejection":True,"reason":str(exc)}
        require("2019-10-05" in str(exc),"expected empty leaf gate absent")
    else:raise AssertionError("unknown empty object incorrectly passed completion")
    original_equal=all(base.table_hash(check,t)==base.table_hash(conn,t) for t in base.ORIGINAL_TABLES)
    require(original_equal,"original table mutation")
    report={
        "generated_at":time.time(),"context":CTX,"scope":"isolated monotone candidate union only",
        "all_eight_day_proofs_pass":True,"certificates":certificates,"checks":checks,
        "counts":{"original_admissions":len(originals),"added_ids":added,"effective_initial_candidates":len(effective),"old_day_admissions_preserved":141,"outside_eight_days_unchanged":65794,"latest_day_observations":149,"latest_day_qualified":147,"latest_below_threshold":2,"conservative_day_candidates":148},
        "eaio":{"id":EAIO,"admission_stars":1013,"latest_observed_stars":1012,"retained_original":True,"reason":"original valid admission remains eligible for initial scoring, separately from current metadata"},
        "commonmark":{"id":COMMONMARK,"latest_observed_stars":1012,"previous_valid_admission":False,"excluded_from_candidates":True},
        "completion_gate":gate,"original_tables_unchanged":original_equal,
        "retained_retry_pending":check.execute("SELECT count(*) FROM shards WHERE status='retry_pending'").fetchone()[0],
        "retained_anomaly_events":check.execute("SELECT count(*) FROM events WHERE event IN ('search_count_list_mismatch','search_leaf_drift_deferred')").fetchone()[0],
        "previous_first_failure_report":"coverage-validation.json preserved unchanged; its replacement approach rejected the old member dropping below the latest bound",
        "comparison_contract":"same count, IDs, identity, creation day, public/fork status and candidate classification across two full reads; every read >=1012; exact total stars may change inside the same class and all changes are retained",
        "candidate_contract":"all original admissions retained byte-for-byte, plus only previously missing current >=1013 IDs; this is a conservative pending-scoring set, not a claim every member is currently >=1013",
        "algorithm_compatibility":"initial extra admission only adds normal fixed-day history work; final ranked/verify use independent fresh pass membership; no pass0 certificate reusable there",
        "source_sha256":sha(Path(__file__).read_bytes()),"base_validator_sha256":sha((HERE/"validate_coverage.py").read_bytes()),
        "production_adopted":False,"consumer_integrated":False,"collection_resumed":False,
        "direct_restart":"unchanged live runner still fails on the nine exhausted unresolved leaves; this isolated proof is not integrated",
        "fixed_day_scoring":"not started or verified; must use normal daily history collection and fresh-pass verification",
    }
    output=HERE/"monotone-validation.json";require(not output.exists(),"refuse replacing prior report")
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    check.close();conn.close()
    print(json.dumps({"proofs":8,"checks":len(checks),"counts":report["counts"],"completion_gate":gate,"production_adopted":False},ensure_ascii=False))


if __name__=="__main__":
    if len(sys.argv)>1 and sys.argv[1]=="--crash":apply(Path(sys.argv[2]),json.loads(sys.argv[3]),crash=True)
    else:main()
