"""Offline tests only.  subprocess and all waits are replaced by fixtures."""
import concurrent.futures
import json
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from transport import ApiError, StopRequested, Transport


START = datetime(2026, 10, 22, 10, 0, tzinfo=timezone.utc).timestamp()
ENDPOINT = "repositories/42976210/stargazers/history?per_page=6"
HISTORY = [{"week": 1792281600, "days": [7, 6, 4, 7, 2, 0, 0], "total": 26}]


class Clock:
    def __init__(self):
        self.value = START
        self.waits = []
        self.lock = threading.Lock()

    def now(self):
        with self.lock:
            return self.value

    def sleep(self, duration):
        with self.lock:
            self.waits.append(duration)
            self.value += duration

    def advance(self, duration):
        with self.lock:
            self.value += duration


def response(status=200, body=HISTORY, headers=None, code=None):
    base = {"Date": "Thu, 22 Oct 2026 10:00:00 GMT", "Etag": '"v1"',
            "X-RateLimit-Resource": "core", "X-RateLimit-Limit": "5000",
            "X-RateLimit-Remaining": "4900", "X-RateLimit-Reset": str(int(START + 3600)),
            "Set-Cookie": "fixture-not-to-persist", "X-OAuth-Scopes": "fixture-not-to-persist"}
    base.update(headers or {})
    head = f"HTTP/2.0 {status} Fixture\r\n" + "\r\n".join(f"{k}: {v}" for k, v in base.items())
    payload = "" if status == 304 else json.dumps(body)
    return SimpleNamespace(stdout=head + "\r\n\r\n" + payload,
                           stderr="fixture-secret-stderr-not-to-persist",
                           returncode=code if code is not None else (0 if status == 200 else 1))


class OfflineTransportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="github-transport-test-")
        self.root = Path(self.directory.name)
        self.clock = Clock()
        self.calls = []
        self.results = []
        self.call_lock = threading.Lock()

        def run(command, **kwargs):
            with self.call_lock:
                self.calls.append((command, kwargs))
                if not self.results:
                    raise AssertionError("Unconfigured fake request; real subprocess is never permitted")
                item = self.results.pop(0)
            if isinstance(item, BaseException):
                raise item
            return item

        self.fake_run = run
        self.transport = Transport(self.root, run=run, clock=self.clock.now, sleep=self.clock.sleep)

    def tearDown(self):
        self.transport.close()
        self.directory.cleanup()

    def test_200_and_immutable_response_and_header_projection(self):
        self.results.extend([response(), response(body=[{"changed": True}], headers={"Etag": '"v2"'})])
        first = self.transport.get(ENDPOINT, "cold", conditional=False)
        second = self.transport.get(ENDPOINT, "next", force=True)
        self.assertEqual(self.transport.response(first["request_id"])["body"], HISTORY)
        self.assertNotEqual(first["body_hash"], second["body_hash"])
        self.assertEqual(len(self.calls), 2)
        self.assertNotIn("set-cookie", first["headers"])
        self.assertNotIn("x-oauth-scopes", first["headers"])
        self.assertFalse(any("If-None-Match" in x for x in self.calls[0][0]))
        self.assertFalse(any("If-None-Match" in x for x in self.calls[1][0]))
        self.assertEqual(self.calls[0][0][0], "/opt/homebrew/bin/gh")
        self.assertNotIn("fixture-secret-stderr-not-to-persist", str(list(self.transport.db.execute("SELECT * FROM requests"))))

    def test_real_304_exit_one_and_cross_job_no_silent_hit(self):
        self.results.extend([response(), response(status=304, code=1)])
        first = self.transport.get(ENDPOINT, "cold", conditional=False)
        self.clock.advance(86400)
        second = self.transport.get(ENDPOINT, "day1")
        self.assertEqual(len(self.calls), 2)
        self.assertTrue(any(x == 'If-None-Match: "v1"' for x in self.calls[1][0]))
        self.assertEqual(second["status"], 304)
        self.assertTrue(second["cache_revalidated"])
        self.assertEqual(second["body_hash"], first["body_hash"])
        self.assertEqual(second["body"], HISTORY)
        self.assertEqual(second["cache_source_job_id"], "cold")
        self.assertEqual(second["received_bytes"], 0)
        stats = self.transport.stats("day1")
        self.assertEqual(stats["cross_job_304"], 1)
        self.assertEqual(stats["cross_date_304_shanghai"], 1)
        self.assertEqual(stats["responses_304"], 1)

    def test_same_day_cross_job_is_not_cross_date(self):
        self.results.extend([response(), response(status=304)])
        self.transport.get(ENDPOINT, "a")
        self.transport.get(ENDPOINT, "b")
        stats = self.transport.stats("b")
        self.assertEqual(stats["cross_job_304"], 1)
        self.assertEqual(stats["cross_date_304_shanghai"], 0)

    def test_response_reuse_is_not_network_304(self):
        self.results.append(response())
        first = self.transport.get(ENDPOINT, "a")
        for _ in range(4):
            self.assertEqual(self.transport.response(first["request_id"])["body"], HISTORY)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.transport.stats("a")["responses_304"], 0)

    def test_304_without_sent_validator_fails(self):
        self.results.append(response(status=304))
        with self.assertRaises(ApiError) as raised:
            self.transport.get(ENDPOINT, "cold", conditional=False)
        self.assertEqual(raised.exception.reason, "not_modified_without_validated_cache")
        self.assertEqual(self.transport.db.execute("SELECT COUNT(*) FROM cache").fetchone()[0], 0)
        self.assertEqual(self.transport.stats("cold")["errors"], 1)
        self.assertEqual(self.transport.stats("cold")["responses_304"], 0)

    def test_304_with_missing_body_does_not_become_success(self):
        self.results.extend([response(), response(status=304)])
        first = self.transport.get(ENDPOINT, "cold")
        self.transport.db.execute("DELETE FROM blobs WHERE hash=?", (first["body_hash"],))
        with self.assertRaises(ApiError) as raised:
            self.transport.get(ENDPOINT, "day1")
        self.assertEqual(raised.exception.reason, "validated_cache_body_missing")
        self.assertEqual(self.transport.stats("day1")["responses_304"], 0)
        self.assertEqual(self.transport.stats("day1")["errors"], 1)

    def test_304_does_not_consume_rolling_core_budget(self):
        self.transport.CORE_CAP = 2
        self.results.extend([response(), response(status=304), response(status=304)])
        self.transport.get(ENDPOINT, "cold")
        self.transport.get(ENDPOINT, "day1")
        self.transport.get(ENDPOINT, "day2")
        self.assertEqual(self.transport.status()["recent_charged_core_attempts"], 1)
        self.assertLess(self.clock.now()-START, 2)

    def test_429_preserves_previous_body_and_records_retry(self):
        self.results.extend([response(), response(status=429, body={"message": "limited"},
                             headers={"Retry-After": "120"})])
        first = self.transport.get(ENDPOINT, "cold")
        with self.assertRaises(ApiError) as raised:
            self.transport.get(ENDPOINT, "day1")
        self.assertEqual(raised.exception.status, 429)
        self.assertGreaterEqual(raised.exception.retry_at, START+120)
        cached = self.transport.db.execute("SELECT request_id FROM cache WHERE endpoint=?", (ENDPOINT,)).fetchone()[0]
        self.assertEqual(cached, first["request_id"])
        self.assertEqual(self.transport.response(first["request_id"])["body"], HISTORY)
        self.assertEqual(self.transport.stats("day1")["errors"], 1)
        self.assertEqual(self.transport.stats("day1")["responses_200"], 0)

    def test_timeout_attempt_is_durable_and_no_success_cache(self):
        self.results.append(subprocess.TimeoutExpired(["fake"], 90, output="not-to-persist"))
        with self.assertRaises(ApiError) as raised:
            self.transport.get(ENDPOINT, "cold")
        self.assertEqual(raised.exception.reason, "timeout")
        self.assertIsNotNone(raised.exception.request_id)
        self.assertEqual(self.transport.stats("cold")["attempted"], 1)
        self.assertEqual(self.transport.stats("cold")["errors"], 1)
        self.assertEqual(self.transport.db.execute("SELECT COUNT(*) FROM cache").fetchone()[0], 0)

    def test_search_projection_and_spacing(self):
        body = {"total_count": 1, "incomplete_results": False, "items": [{"id": 1, "full_name": "a/b",
                "private": False, "owner": {"unneeded": "not-to-persist"}, "sensitive_fixture": "not-to-persist"}]}
        self.results.extend([response(body=body, headers={"X-RateLimit-Resource": "search", "X-RateLimit-Remaining": "29"}),
                             response(body=body, headers={"X-RateLimit-Resource": "search", "X-RateLimit-Remaining": "28"})])
        first = self.transport.get("search/repositories?q=is%3Apublic", "a", conditional=False)
        second = self.transport.get("search/repositories?q=is%3Apublic&page=2", "a", conditional=False)
        self.assertEqual(first["body"]["items"][0]["id"], 1)
        self.assertNotIn("owner", first["body"]["items"][0])
        self.assertNotIn("sensitive_fixture", first["body"]["items"][0])
        started_a = datetime.fromisoformat(first["started_at"]).timestamp()
        started_b = datetime.fromisoformat(second["started_at"]).timestamp()
        self.assertGreaterEqual(started_b-started_a, 3.099)
        self.assertEqual(self.transport.status()["recent_charged_core_attempts"], 0)

    def test_rolling_budget_waits_in_at_most_60_second_slices(self):
        self.transport.CORE_CAP = 1
        self.results.extend([response(), response()])
        self.transport.get(ENDPOINT, "cold", conditional=False)
        second = self.transport.get(ENDPOINT+"&page=2", "cold", conditional=False)
        started = datetime.fromisoformat(second["started_at"]).timestamp()
        self.assertGreaterEqual(started, START+3600)
        self.assertTrue(self.clock.waits)
        self.assertLessEqual(max(self.clock.waits), 60)
        self.assertGreaterEqual(second["wait_seconds"], 3600)

    def test_low_remaining_preserves_reserve_until_reset(self):
        self.results.extend([response(headers={"X-RateLimit-Remaining": "999", "X-RateLimit-Reset": str(int(START+120))}),
                             response()])
        self.transport.get(ENDPOINT, "cold")
        second = self.transport.get(ENDPOINT+"&page=2", "cold")
        self.assertGreaterEqual(datetime.fromisoformat(second["started_at"]).timestamp(), START+125)

    def test_secondary_backoff_then_next_get_waits(self):
        self.results.extend([response(status=429, headers={"Retry-After": "120"}), response()])
        with self.assertRaises(ApiError):
            self.transport.get(ENDPOINT, "cold")
        second = self.transport.get(ENDPOINT, "cold")
        self.assertGreaterEqual(datetime.fromisoformat(second["started_at"]).timestamp(), START+120)
        self.assertEqual(self.transport.stats("cold")["errors"], 1)
        self.assertEqual(self.transport.stats("cold")["responses_200"], 1)

    def test_unknown_request_on_restart_never_becomes_success(self):
        self.transport.db.execute("INSERT INTO requests(job_id,endpoint,resource,started,conditional_requested) "
                                  "VALUES(?,?,?,?,?)", ("cold", ENDPOINT, "core", START, 0))
        self.transport.close()
        self.transport = Transport(self.root, run=self.fake_run, clock=self.clock.now, sleep=self.clock.sleep)
        self.assertEqual(self.transport.stats("cold")["unfinished"], 1)
        self.assertEqual(self.transport.recover_unknown_attempts(), 1)
        self.assertEqual(self.transport.stats("cold")["unknown_outcomes"], 1)
        self.assertEqual(self.transport.status()["recent_charged_core_attempts"], 1)
        self.assertEqual(self.transport.stats("cold")["responses_200"], 0)

    def test_bootstrap_is_conservative_recent_and_idempotent(self):
        values = []
        for age, status, resource in [(60, 200, "core"), (60, 200, "core"), (3700, 200, "core"),
                                       (30, 304, "core"), (20, 200, "search")]:
            values.append({"started_at": datetime.fromtimestamp(START-age, timezone.utc).isoformat(),
                           "endpoint": ENDPOINT, "status": status, "headers": {"x-ratelimit-resource": resource}})
        path = self.root / "usage.jsonl"
        path.write_text("\n".join(json.dumps(x) for x in values))
        self.transport.close()
        self.transport = Transport(self.root, path, run=self.fake_run, clock=self.clock.now, sleep=self.clock.sleep)
        self.assertEqual(self.transport.status()["external_recent_core_attempts"], 1)
        self.transport.close()
        self.transport = Transport(self.root, path, run=self.fake_run, clock=self.clock.now, sleep=self.clock.sleep)
        self.assertEqual(self.transport.status()["external_recent_core_attempts"], 1)

    def test_malformed_json_does_not_create_success(self):
        bad = response()
        bad.stdout = bad.stdout.split("\r\n\r\n")[0] + "\r\n\r\nnot json"
        self.results.append(bad)
        with self.assertRaises(ApiError):
            self.transport.get(ENDPOINT, "cold")
        self.assertEqual(self.transport.stats("cold")["responses_200"], 0)
        self.assertEqual(self.transport.stats("cold")["errors"], 1)

    def test_four_slots_and_thread_safe_request_ids(self):
        active = 0
        peak = 0
        lock = threading.Lock()

        def concurrent_run(command, **kwargs):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(.005)
            with lock:
                active -= 1
            return response()

        self.transport._run = concurrent_run
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda x: self.transport.get(f"repositories/{x}/stargazers/history?per_page=6", "cold"),
                                    range(20)))
        self.assertLessEqual(peak, 4)
        self.assertGreater(peak, 1)
        self.assertEqual(len({r["request_id"] for r in results}), 20)
        self.assertEqual(self.transport.stats("cold")["responses_200"], 20)
        stamps = [x[0] for x in self.transport.db.execute("SELECT started FROM requests ORDER BY started")]
        self.assertTrue(all(b-a >= .249 for a,b in zip(stamps,stamps[1:])))

    def test_stop_file_blocks_without_request_or_attempt(self):
        (self.root / "STOP").touch()
        with self.assertRaises(StopRequested) as error:
            self.transport.get(ENDPOINT, "cold")
        self.assertEqual(error.exception.reason, "stop_file")
        self.assertEqual(len(self.calls), 0)
        self.assertEqual(self.transport.stats("cold")["attempted"], 0)

    def test_deadline_blocks_without_request(self):
        (self.root / "plan.json").write_text(json.dumps({"stop_after": "2026-10-22T18:00:00+08:00"}))
        with self.assertRaises(StopRequested) as error:
            self.transport.get(ENDPOINT, "cold")
        self.assertEqual(error.exception.reason, "stop_after")
        self.assertEqual(len(self.calls), 0)

    def test_deadline_during_budget_wait_never_launches_next_request(self):
        self.transport.CORE_CAP = 1
        self.results.append(response())
        self.transport.get(ENDPOINT, "cold")
        (self.root / "plan.json").write_text(json.dumps({"stop_after": START+90}))
        with self.assertRaises(StopRequested) as error:
            self.transport.get(ENDPOINT+"&page=2", "cold")
        self.assertEqual(error.exception.reason, "stop_after")
        self.assertEqual(len(self.calls), 1)
        self.assertLessEqual(max(self.clock.waits), 60)
        self.assertLessEqual(self.clock.now(), START+150)

    def test_cancel_during_budget_wait(self):
        self.transport.CORE_CAP = 1
        self.results.append(response())
        self.transport.get(ENDPOINT, "cold")

        def stop_on_sleep(duration):
            self.clock.sleep(duration)
            self.transport.cancel_pending()

        self.transport._sleep = stop_on_sleep
        with self.assertRaises(StopRequested) as error:
            self.transport.get(ENDPOINT+"&page=2", "cold")
        self.assertEqual(error.exception.reason, "cancel_pending")
        self.assertEqual(len(self.calls), 1)

    def test_invalid_deadline_fails_closed(self):
        (self.root / "plan.json").write_text(json.dumps({"stop_after": "2026-10-22T19:00:00"}))
        with self.assertRaises(StopRequested) as error:
            self.transport.get(ENDPOINT, "cold")
        self.assertEqual(error.exception.reason, "invalid_stop_plan")

    def test_401_fatal_persists_across_restart(self):
        self.results.append(response(status=401, body={"message": "Bad credentials"}))
        with self.assertRaises(ApiError) as error:
            self.transport.get(ENDPOINT, "cold")
        self.assertTrue(error.exception.fatal)
        self.transport.close()
        self.transport = Transport(self.root, run=self.fake_run, clock=self.clock.now, sleep=self.clock.sleep)
        with self.assertRaises(ApiError) as restarted:
            self.transport.get(ENDPOINT, "cold")
        self.assertTrue(restarted.exception.fatal)
        self.assertEqual(len(self.calls), 1)

    def test_explicit_global_auth_403_fatal(self):
        self.results.append(response(status=403, body={"message": "The access token has expired."}))
        with self.assertRaises(ApiError) as error:
            self.transport.get(ENDPOINT, "cold")
        self.assertTrue(error.exception.fatal)

    def test_repo_permission_403_is_not_global_auth_failure(self):
        self.results.append(response(status=403, body={"message": "Resource not accessible by personal access token"}))
        with self.assertRaises(ApiError) as error:
            self.transport.get(ENDPOINT, "cold")
        self.assertFalse(error.exception.fatal)
        self.assertIsNone(self.transport.status()["fatal_auth"])

    def test_cache_denominators_and_error_counts(self):
        self.results.extend([response(), response(status=304), response(body=[{"updated": True}]),
                             response(status=429), response(status=503),
                             subprocess.TimeoutExpired("fixture", 90)])
        self.transport.get(ENDPOINT, "cold", conditional=False)
        self.transport.get(ENDPOINT, "next")
        self.transport.get(ENDPOINT, "next")
        for _ in range(3):
            with self.assertRaises(ApiError):
                self.transport.get(ENDPOINT, "next")
        stats = self.transport.stats("next")
        self.assertEqual(stats["conditional_attempted"], 5)
        self.assertEqual(stats["conditional_success_count"], 2)
        self.assertEqual(stats["cache_hit_rate"], 0.5)
        self.assertEqual(stats["core_conditional_success_count"], 2)
        self.assertEqual(stats["history_conditional_success_count"], 2)
        self.assertEqual(stats["history_304"], 1)
        self.assertEqual(stats["http_429"], 1)
        self.assertEqual(stats["http_5xx"], 1)
        self.assertEqual(stats["timeouts"], 1)

    def test_search_never_sends_conditional_header(self):
        data = {"total_count": 0, "incomplete_results": False, "items": []}
        self.results.extend([response(body=data), response(body=data)])
        for _ in range(2):
            self.transport.get("search/repositories?q=is%3Apublic", "search")
        self.assertFalse(any("If-None-Match" in arg for call, _ in self.calls for arg in call))
        self.assertEqual(self.transport.stats("search")["conditional_attempted"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
