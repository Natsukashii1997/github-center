"""Offline regression for a search leaf whose returned stars drift outside it.

Only an adjacent candidate runner and disposable local databases are used.
The fake transport cannot make network requests. The JSON evidence is bound to
the exact candidate source hash, preserving separate red and green runs.
"""
import hashlib
import importlib.util
import json
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('leaf_drift_candidate', HERE / 'runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
SOURCE = hashlib.sha256((HERE / 'runner.py').read_bytes()).hexdigest()
WAITS = []
runner.time.sleep = lambda seconds: WAITS.append(seconds)
BAD_KEY = '[1793,1793,"2014-07-20","2014-07-20"]'
SIBLING_KEY = '[1700,1792,null,null]'
LAST_TRANSPORT = None


def repository(repo_id, stars):
    return {'id': repo_id, 'full_name': f'offline-fixture/r{repo_id}',
            'stargazers_count': stars, 'private': False, 'fork': False,
            'created_at': '2014-07-20T10:00:00Z'}


class FakeTransport:
    def __init__(self, mode):
        self.mode = mode
        self.calls = []
        self.bad_calls = 0
        self.sibling_observation = None
        self.runner = None

    def stats(self, job):
        return {'offline_requests': len(self.calls)}

    def status(self):
        return {'offline': True}

    def get(self, endpoint, job, conditional=True, force=False):
        query = parse_qs(urlparse('https://offline.invalid/' + endpoint).query)
        is_bad = 'stars:1793..1793' in query['q'][0]
        page = int(query['page'][0])
        self.calls.append(('bad' if is_bad else 'sibling', page))
        assert page == 1, ('No failed leaf may advance its page', self.calls)
        if is_bad:
            self.bad_calls += 1
            assert self.bad_calls <= 3, ('Retry budget exceeded', self.calls)
            if self.mode == 'mixed_count_then_drift' and self.bad_calls == 1:
                items = []
            elif self.mode == 'transient' and self.bad_calls > 1:
                items = [repository(22038525, 1793)]
            else:
                items = [repository(22038525, 1792)]
        else:
            # Inspect the real Runner state at the moment it moves on to the
            # healthy sibling: drift must already be quarantined without a
            # success page or an incorrectly admitted repository.
            db = self.runner.db
            leaf = dict(db.execute('SELECT * FROM shards WHERE key=?', (BAD_KEY,)).fetchone())
            self.sibling_observation = {
                'bad_status': leaf['status'], 'bad_page': leaf['page'],
                'bad_members': db.execute('SELECT COUNT(*) FROM members WHERE shard=?', (BAD_KEY,)).fetchone()[0],
                'bad_pages': db.execute('SELECT COUNT(*) FROM pages WHERE shard=?', (BAD_KEY,)).fetchone()[0],
            }
            assert self.sibling_observation == {
                'bad_status': 'retry_pending', 'bad_page': 1,
                'bad_members': 0, 'bad_pages': 0,
            }, self.sibling_observation
            items = [repository(11, 1750)]
        body = {'total_count': 1, 'incomplete_results': False, 'items': items}
        return {'request_id': 700 + len(self.calls), 'body': body,
                'body_hash': hashlib.sha256(json.dumps(body).encode()).hexdigest()}


def setup(root, mode):
    global LAST_TRANSPORT
    (root / 'plan.json').write_text(json.dumps({
        'jobs': [{'id': 'cold', 'day': '2026-10-20',
                  'due': time.time() - 1, 'deadline': time.time() + 3600}],
        'initial_threshold': 1700, 'stop_after': time.time() + 3600,
        'code_hash': SOURCE, 'prior_usage_log': 'unused-offline',
    }))
    transport = FakeTransport(mode)
    LAST_TRANSPORT = transport
    instance = runner.Runner(root, transport)
    transport.runner = instance
    instance.last_status = time.time()
    instance.add_shard('cold', 0, 1700)
    instance.db.execute("UPDATE shards SET status='split'")
    instance.add_shard('cold', 0, 1700, 1792)
    instance.add_shard('cold', 0, 1793, 1793, '2014-07-20', '2014-07-20')
    instance.add_shard('cold', 0, 1794, None)
    complete_key = '[1794,null,null,null]'
    instance.db.execute("UPDATE shards SET status='complete',page=2,expected=1 WHERE key=?", (complete_key,))
    instance.db.execute('INSERT INTO pages VALUES(?,?,?,?,?,?)', ('cold', 0, complete_key, 1, 99999, 1))
    instance.db.execute('INSERT INTO members VALUES(?,?,?,?,?,?)',
                        ('cold', 0, complete_key, 999, json.dumps(repository(999, 9000)), 99999))
    instance.db.commit()
    return instance, transport


def assert_completed_preserved(instance):
    assert instance.db.execute('SELECT request_id FROM members WHERE id=999').fetchone()[0] == 99999
    assert instance.db.execute('SELECT request_id FROM pages WHERE request_id=99999').fetchone()[0] == 99999


def transient(root):
    instance, transport = setup(root, 'transient')
    instance.enumerate(instance.job('cold'), 0)
    assert transport.calls == [('bad', 1), ('sibling', 1), ('bad', 1)], transport.calls
    leaf = instance.db.execute('SELECT status,page,error FROM shards WHERE key=?', (BAD_KEY,)).fetchone()
    assert tuple(leaf) == ('complete', 2, None), tuple(leaf)
    item = instance.members('cold', 0)[22038525]
    assert item['stargazers_count'] == 1793
    stored = instance.db.execute('SELECT request_id FROM members WHERE id=22038525').fetchone()[0]
    assert stored == 703, 'Only the corrected response may enter members'
    assert instance.db.execute('SELECT COUNT(*) FROM pages WHERE shard=?', (BAD_KEY,)).fetchone()[0] == 1
    assert_completed_preserved(instance)
    return {'calls': transport.calls, 'before_sibling': transport.sibling_observation,
            'corrected_stars': item['stargazers_count'], 'bad_response_not_admitted': True,
            'completed_checkpoint_preserved': True}


def persistent(root, mode='persistent'):
    instance, transport = setup(root, mode)
    failure = None
    try:
        instance.enumerate(instance.job('cold'), 0)
    except RuntimeError as error:
        failure = str(error)
    assert failure and 'Dense same-star' not in failure, failure
    assert transport.calls == [('bad', 1), ('sibling', 1), ('bad', 1), ('bad', 1)], transport.calls
    assert tuple(instance.db.execute('SELECT status,page FROM shards WHERE key=?', (BAD_KEY,)).fetchone()) == ('retry_pending', 1)
    assert instance.db.execute('SELECT COUNT(*) FROM members WHERE shard=?', (BAD_KEY,)).fetchone()[0] == 0
    assert instance.db.execute('SELECT COUNT(*) FROM pages WHERE shard=?', (BAD_KEY,)).fetchone()[0] == 0
    assert instance.db.execute('SELECT status FROM shards WHERE key=?', (SIBLING_KEY,)).fetchone()[0] == 'complete'
    assert not instance.db.execute("SELECT 1 FROM events WHERE event='enumeration_complete'").fetchone()
    assert not (root / 'results/cold/result.json').exists()
    assert_completed_preserved(instance)
    before = len(transport.calls)
    instance.db.close()
    instance = runner.Runner(root, transport)
    transport.runner = instance
    second_failure = None
    try:
        instance.enumerate(instance.job('cold'), 0)
    except RuntimeError as error:
        second_failure = str(error)
    assert second_failure, 'Reopening must preserve the unresolved state'
    assert len(transport.calls) == before, 'Restart must not reset the shared retry budget'
    assert instance.db.execute('SELECT status FROM shards WHERE key=?', (BAD_KEY,)).fetchone()[0] == 'retry_pending'
    assert not instance.db.execute("SELECT 1 FROM events WHERE event='enumeration_complete'").fetchone()
    assert not (root / 'results/cold/result.json').exists()
    assert_completed_preserved(instance)
    return {'calls': transport.calls, 'before_sibling': transport.sibling_observation,
            'shared_anomaly_attempts': transport.bad_calls,
            'bounded_failure': failure, 'restart_extra_requests': len(transport.calls) - before,
            'bad_members': 0, 'bad_success_pages': 0, 'enumeration_complete': False,
            'completed_checkpoint_preserved': True}


results = []
for name, case in [
    ('transient_leaf_drift_then_recovery', transient),
    ('persistent_leaf_drift_and_restart_bound', persistent),
    ('count_mismatch_then_leaf_drift_share_budget', lambda root: persistent(root, 'mixed_count_then_drift')),
]:
    with tempfile.TemporaryDirectory(dir=HERE, prefix='offline-leaf-drift-') as directory:
        try:
            results.append({'name': name, 'passed': True, 'observed': case(Path(directory))})
        except Exception as error:
            results.append({'name': name, 'passed': False, 'error': repr(error),
                            'calls': LAST_TRANSPORT.calls if LAST_TRANSPORT else []})
output = {'source_sha256': SOURCE, 'network_requests': 0, 'simulated_waits': WAITS,
          'results': results}
evidence = HERE / f'leaf-drift-tests-{SOURCE[:10]}.json'
evidence.write_text(json.dumps(output, ensure_ascii=False, indent=2))
print(json.dumps(output, ensure_ascii=False, indent=2))
assert all(result['passed'] for result in results)
