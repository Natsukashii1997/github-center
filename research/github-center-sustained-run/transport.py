"""Read-only GitHub transport for a finite, isolated collection experiment.

One owning worker process, at most four network calls concurrently.  Every get()
performs a real HTTP request.  A caller may reuse a completed unit by its saved
request_id through response(); that is NOT an HTTP 304 or a cross-day cache hit.

No credentials are read here.  gh uses its existing normal authentication.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import subprocess
import threading
import time
import zlib
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


class ApiError(RuntimeError):
    def __init__(self, status, reason, retry_at=None, request_id=None, fatal=False):
        self.status = status
        self.reason = reason
        self.retry_at = retry_at
        self.request_id = request_id
        self.fatal = fatal
        super().__init__(f"{reason}; HTTP status={status}; request_id={request_id}")


class StopRequested(RuntimeError):
    """Non-retryable cancellation or end of the authorized experiment."""
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def _iso(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


class Transport:
    CORE_CAP = 4000
    CORE_RESERVE = 1000
    SEARCH_RESERVE = 3
    ALL_INTERVAL = 0.25
    SEARCH_INTERVAL = 3.1
    TIMEOUT = 90
    GH = "/opt/homebrew/bin/gh"

    def __init__(self, root: Path, initial_usage_path: Path | None = None,
                 *, run=None, clock=None, sleep=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._run = run or subprocess.run
        self._clock = clock or time.time
        self._cancelled = threading.Event()
        self._sleep = sleep or self._cancelled.wait
        self._lock = threading.RLock()
        self._slots = threading.BoundedSemaphore(4)
        self.db = sqlite3.connect(self.root / "transport.sqlite", timeout=30,
                                  check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS blobs(
                hash TEXT PRIMARY KEY, compressed BLOB NOT NULL, raw_bytes INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS requests(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL, endpoint TEXT NOT NULL, resource TEXT NOT NULL,
                started REAL NOT NULL, finished REAL, status INTEGER, exit_code INTEGER,
                error TEXT, headers TEXT NOT NULL DEFAULT '{}', elapsed REAL,
                received_bytes INTEGER NOT NULL DEFAULT 0,
                body_hash TEXT, reused_request_id INTEGER,
                sent_etag TEXT, conditional_requested INTEGER NOT NULL,
                wait_seconds REAL NOT NULL DEFAULT 0,
                queue_wait_seconds REAL NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS requests_budget ON requests(resource, started);
            CREATE INDEX IF NOT EXISTS requests_job ON requests(job_id, id);
            CREATE TABLE IF NOT EXISTS cache(
                endpoint TEXT PRIMARY KEY, request_id INTEGER NOT NULL,
                etag TEXT, body_hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS external_usage(
                fingerprint TEXT PRIMARY KEY, started REAL NOT NULL, resource TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS external_usage_budget ON external_usage(resource, started);
            CREATE TABLE IF NOT EXISTS events(
                id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL,
                job_id TEXT NOT NULL, event TEXT NOT NULL, details TEXT NOT NULL);
        """)
        with self._lock:
            if initial_usage_path:
                self._bootstrap(Path(initial_usage_path))

    def recover_unknown_attempts(self) -> int:
        """Call ONCE after acquiring the worker's exclusive process lock.

        Never call from a concurrent status reader.  In-flight attempts from a
        terminated owner cannot be proved unsuccessful and are not successes.
        """
        with self._lock:
            pending = self.db.execute(
                "SELECT COUNT(*) FROM requests WHERE finished IS NULL AND error IS NULL").fetchone()[0]
            if pending:
                self.db.execute("UPDATE requests SET error='outcome_unknown_after_restart' "
                                "WHERE finished IS NULL AND error IS NULL")
                self.note("unknown_attempts_after_restart", "__transport__", {"count": pending})
            return pending

    def cancel_pending(self):
        """Wake waiting workers; already launched HTTP calls may finish (90s cap)."""
        self._cancelled.set()

    def _check_stop(self):
        if self._cancelled.is_set():
            raise StopRequested("cancel_pending")
        if (self.root / "STOP").exists():
            raise StopRequested("stop_file")
        plan = self.root / "plan.json"
        if plan.exists():
            try:
                value = json.loads(plan.read_text(encoding="utf-8")).get("stop_after")
                if value is not None:
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        deadline = float(value)
                    else:
                        date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                        if date.tzinfo is None:
                            raise ValueError("Timezone required")
                        deadline = date.timestamp()
                    if self._clock() >= deadline:
                        raise StopRequested("stop_after")
            except (ValueError, TypeError, OSError, AttributeError):
                raise StopRequested("invalid_stop_plan") from None
        with self._lock:
            fatal = self._meta("fatal_auth")
        if fatal:
            raise ApiError(fatal["status"], fatal["reason"], request_id=fatal["request_id"], fatal=True)

    @contextmanager
    def _slot(self):
        self._check_stop()
        while not self._slots.acquire(timeout=0.5):
            self._check_stop()
        try:
            self._check_stop()
            yield
        finally:
            self._slots.release()

    def _meta(self, key, default=None):
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def _setmeta(self, key, value):
        self.db.execute("INSERT INTO meta(key,value) VALUES(?,?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, json.dumps(value, ensure_ascii=False)))

    def _bootstrap(self, path):
        if not path.exists():
            raise FileNotFoundError(f"Explicit bootstrap evidence is missing: {path}")
        now = self._clock()
        imported = 0
        with path.open(encoding="utf-8") as source:
            for line in source:
                try:
                    item = json.loads(line)
                    started = datetime.fromisoformat(item["started_at"].replace("Z", "+00:00")).timestamp()
                    resource = item.get("headers", {}).get("x-ratelimit-resource")
                    if resource is None:
                        resource = "search" if item.get("endpoint", "").startswith("search/") else "core"
                    if resource != "core" or item.get("status") == 304 or not now - 3600 <= started <= now:
                        continue
                    fingerprint = hashlib.sha256(_canonical({"started": started, "endpoint": item.get("endpoint"),
                                                             "status": item.get("status")})).hexdigest()
                    cursor = self.db.execute("INSERT OR IGNORE INTO external_usage VALUES(?,?,?)",
                                             (fingerprint, started, resource))
                    imported += cursor.rowcount
                except (ValueError, TypeError, KeyError):
                    continue
        self.note("bootstrap_usage", "__transport__", {"imported_core_attempts": imported,
                  "window_seconds": 3600, "conservative_shared_budget": True})

    def note(self, event, job_id, details):
        with self._lock:
            self.db.execute("INSERT INTO events(at,job_id,event,details) VALUES(?,?,?,?)",
                            (self._clock(), str(job_id), str(event), json.dumps(details, ensure_ascii=False)))

    def _charged(self, now):
        own = self.db.execute("SELECT started FROM requests WHERE resource='core' AND started>? "
                              "AND (status IS NULL OR status<>304) ORDER BY started", (now-3600,)).fetchall()
        other = self.db.execute("SELECT started FROM external_usage WHERE resource='core' AND started>? "
                                "ORDER BY started", (now-3600,)).fetchall()
        values = [r[0] for r in own] + [r[0] for r in other]
        return sorted(values), len(own), len(other)

    def _reserve(self, endpoint, job_id, resource, conditional, etag, queue_wait):
        waited = 0.0
        last_reason = None
        while True:
            self._check_stop()
            with self._lock:
                now = self._clock()
                bounds = [(float(self._meta("last_request_at", 0)) + self.ALL_INTERVAL, "request_spacing"),
                          (float(self._meta("global_pause_until", 0)), "secondary_rate_pause"),
                          (float(self._meta(resource + "_pause_until", 0)), resource + "_rate_pause")]
                if resource == "search":
                    bounds.append((float(self._meta("last_search_at", 0)) + self.SEARCH_INTERVAL, "search_spacing"))
                else:
                    charged, _, _ = self._charged(now)
                    if len(charged) >= self.CORE_CAP:
                        # The request which would leave CAP-1 charges determines admission.
                        index = len(charged) - self.CORE_CAP
                        bounds.append((charged[index] + 3600.05, "rolling_core_budget"))
                until, reason = max(bounds)
                delay = max(0.0, until-now)
                if delay <= 0:
                    cursor = self.db.execute(
                        "INSERT INTO requests(job_id,endpoint,resource,started,sent_etag,conditional_requested,"
                        "wait_seconds,queue_wait_seconds) VALUES(?,?,?,?,?,?,?,?)",
                        (str(job_id), endpoint, resource, now, etag, int(conditional), waited, queue_wait))
                    request_id = cursor.lastrowid
                    self._setmeta("last_request_at", now)
                    if resource == "search":
                        self._setmeta("last_search_at", now)
                    if waited >= 1:
                        self.note("rate_wait_finished", job_id, {"request_id": request_id,
                                  "accumulated_worker_wait_seconds": round(waited, 3)})
                    return request_id, now
                if delay >= 1 and reason != last_reason:
                    self.note("rate_wait", job_id, {"reason": reason, "until": _iso(until),
                              "seconds_at_entry": round(delay, 3)})
                    last_reason = reason
                self._setmeta("last_wait", {"job_id": str(job_id), "resource": resource,
                              "reason": reason, "until": until, "observed_at": now})
            before = self._clock()
            self._sleep(min(delay, 60))
            waited += max(0, self._clock()-before)
            self._check_stop()

    @staticmethod
    def _parse(stdout):
        # gh normally emits only the final response; tolerate leading redirect blocks.
        value = stdout.replace("\r\n", "\n")
        parts = value.split("\n\n")
        head_index = 0
        while head_index + 1 < len(parts) and parts[head_index+1].startswith("HTTP/"):
            head_index += 1
        head = parts[head_index]
        first = head.splitlines()[0] if head else ""
        match = re.match(r"^HTTP/\S+\s+(\d{3})(?:\s|$)", first)
        status = int(match[1]) if match else None
        headers = {}
        for line in head.splitlines()[1:]:
            key, colon, val = line.partition(":")
            key = key.strip().lower()
            if colon and (key in {"date", "etag", "retry-after"} or key.startswith("x-ratelimit-")):
                headers[key] = val.strip()
        body = "\n\n".join(parts[head_index+1:])
        return status, headers, body

    @staticmethod
    def _compact_repo(repo):
        if not isinstance(repo, dict):
            raise ValueError("Repository metadata is not an object")
        return {key: repo.get(key) for key in ("id", "full_name", "stargazers_count", "fork", "private",
                                               "created_at", "updated_at", "description", "html_url")}

    def _project(self, endpoint, body):
        if endpoint.startswith("search/repositories"):
            if not isinstance(body, dict) or not isinstance(body.get("items"), list):
                raise ValueError("Malformed repository search")
            return {"total_count": body["total_count"], "incomplete_results": body["incomplete_results"],
                    "items": [self._compact_repo(x) for x in body["items"]]}
        if "/stargazers/history" in endpoint:
            return body
        bare = endpoint.split("?", 1)[0]
        if re.fullmatch(r"repos/[^/]+/[^/]+|repositories/\d+", bare):
            return self._compact_repo(body)
        return body

    @staticmethod
    def _number(value, default=None):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _apply_rate(self, resource, status, headers, now):
        actual = headers.get("x-ratelimit-resource", resource)
        if actual not in ("core", "search"):
            actual = resource
        remaining = self._number(headers.get("x-ratelimit-remaining"))
        reset = self._number(headers.get("x-ratelimit-reset"))
        self._setmeta("last_rate_" + actual, {"observed_at": now, "headers": headers})
        reserve = self.CORE_RESERVE if actual == "core" else self.SEARCH_RESERVE
        if remaining is not None and remaining < reserve:
            pause = max(now + 1, (reset + (5 if actual == "core" else 3)) if reset else now+60)
            self._setmeta(actual + "_pause_until", max(pause, self._meta(actual + "_pause_until", 0)))
        retry_at = None
        # Primary exhaustion waits for its reset. Other 403s use conservative
        # backoff; the caller still decides whether to retry a permission error.
        if status == 429 or (status == 403 and remaining != 0):
            failures = int(self._meta("throttle_streak", 0)) + 1
            self._setmeta("throttle_streak", failures)
            value = headers.get("retry-after")
            seconds = self._number(value)
            if seconds is not None:
                retry_at = now + max(1, seconds)
            elif value:
                try:
                    retry_at = parsedate_to_datetime(value).timestamp()
                except (ValueError, TypeError, OverflowError):
                    pass
            if retry_at is None:
                retry_at = now + min(900, 60 * (2 ** min(failures-1, 4)))
            retry_at = max(retry_at, now + 1)
            self._setmeta("global_pause_until", max(retry_at, self._meta("global_pause_until", 0)))
        elif status == 403 and remaining == 0:
            retry_at = self._meta(actual + "_pause_until", now+60)
        elif status in (200, 304):
            self._setmeta("throttle_streak", 0)
        return actual, retry_at

    def get(self, endpoint: str, job_id: str, conditional: bool = True, force: bool = False) -> dict:
        endpoint = endpoint.lstrip("/")
        if not endpoint or "://" in endpoint or any(x in endpoint for x in ("\n", "\r", "\x00")):
            raise ValueError("Expected a GitHub API path, not an absolute URL")
        resource = "search" if endpoint.startswith("search/") else "core"
        queued = self._clock()
        with self._slot():
            queue_wait = max(0, self._clock()-queued)
            with self._lock:
                cached = self.db.execute("SELECT * FROM cache WHERE endpoint=?", (endpoint,)).fetchone()
                cached = dict(cached) if cached else None
                used_cache = cached if resource == "core" and conditional and not force and cached and cached["etag"] else None
                etag = used_cache["etag"] if used_cache else None
            request_id, started = self._reserve(endpoint, job_id, resource, conditional and not force, etag, queue_wait)
            command = [self.GH, "api", "--hostname", "github.com", "--method", "GET", "--include"]
            if etag:
                command.extend(["-H", "If-None-Match: " + etag])
            command.append(endpoint)
            try:
                result = self._run(command, capture_output=True, text=True, timeout=self.TIMEOUT)
            except subprocess.TimeoutExpired:
                self._finish_failure(request_id, resource, started, None, None, {}, "timeout", 0)
                raise ApiError(None, "timeout", request_id=request_id) from None
            except OSError:
                self._finish_failure(request_id, resource, started, None, None, {}, "process_launch_failure", 0)
                raise ApiError(None, "process_launch_failure", request_id=request_id) from None
            status, headers, text = self._parse(result.stdout or "")
            size = len(text.encode("utf-8"))
            if status not in (200, 304):
                reason = "http_error" if status else "missing_http_response"
                fatal = status == 401
                if status == 403:
                    try:
                        message = json.loads(text).get("message", "").strip().lower().rstrip(".")
                    except (ValueError, AttributeError):
                        message = ""
                    # Do not treat a repository-specific permission failure or
                    # primary/secondary quota response as a global auth failure.
                    fatal = message in {"bad credentials", "requires authentication",
                                        "must authenticate to access this api",
                                        "this token has expired", "the access token has expired",
                                        "the access token has been revoked"}
                if fatal:
                    reason = "fatal_authentication_failure"
                retry_at = self._finish_failure(request_id, resource, started, status, result.returncode,
                                                headers, reason, size, fatal=fatal)
                raise ApiError(status, reason, retry_at, request_id, fatal=fatal)
            if status == 200 and result.returncode != 0:
                self._finish_failure(request_id, resource, started, status, result.returncode, headers,
                                     "nonzero_exit_with_200", size)
                raise ApiError(status, "nonzero_exit_with_200", request_id=request_id)
            if status == 304 and not used_cache:
                self._finish_failure(request_id, resource, started, status, result.returncode, headers,
                                     "not_modified_without_validated_cache", size)
                raise ApiError(status, "not_modified_without_validated_cache", request_id=request_id)
            if status == 304:
                with self._lock:
                    has_body = self.db.execute("SELECT 1 FROM blobs WHERE hash=?", (used_cache["body_hash"],)).fetchone()
                if not has_body:
                    self._finish_failure(request_id, resource, started, status, result.returncode, headers,
                                         "validated_cache_body_missing", size)
                    raise ApiError(status, "validated_cache_body_missing", request_id=request_id)
            if status == 200:
                try:
                    body = self._project(endpoint, json.loads(text))
                    canonical = _canonical(body)
                except (ValueError, TypeError, KeyError):
                    self._finish_failure(request_id, resource, started, status, result.returncode, headers,
                                         "malformed_json_or_shape", size)
                    raise ApiError(status, "malformed_json_or_shape", request_id=request_id) from None
                body_hash = hashlib.sha256(canonical).hexdigest()
                reused_id = None
            else:
                body_hash = used_cache["body_hash"]
                reused_id = used_cache["request_id"]
                canonical = None
            finished = self._clock()
            with self._lock:
                actual, _ = self._apply_rate(resource, status, headers, finished)
                self.db.execute("BEGIN IMMEDIATE")
                try:
                    if canonical is not None:
                        self.db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?,?)",
                                        (body_hash, zlib.compress(canonical), len(canonical)))
                    elif not self.db.execute("SELECT 1 FROM blobs WHERE hash=?", (body_hash,)).fetchone():
                        raise RuntimeError("Validated cache body is absent")
                    self.db.execute("UPDATE requests SET finished=?,status=?,exit_code=?,headers=?,elapsed=?,"
                                    "received_bytes=?,body_hash=?,reused_request_id=?,resource=? WHERE id=? AND finished IS NULL",
                                    (finished, status, result.returncode, json.dumps(headers), max(0, finished-started),
                                     size, body_hash, reused_id, actual, request_id))
                    new_etag = headers.get("etag") or (etag if status == 304 else None)
                    self.db.execute("INSERT INTO cache(endpoint,request_id,etag,body_hash) VALUES(?,?,?,?) "
                                    "ON CONFLICT(endpoint) DO UPDATE SET request_id=excluded.request_id, "
                                    "etag=excluded.etag,body_hash=excluded.body_hash",
                                    (endpoint, request_id, new_etag, body_hash))
                    self.db.execute("COMMIT")
                except BaseException:
                    self.db.execute("ROLLBACK")
                    raise
            return self.response(request_id)

    def _finish_failure(self, request_id, resource, started, status, exit_code, headers, reason, size, fatal=False):
        finished = self._clock()
        with self._lock:
            actual, retry_at = self._apply_rate(resource, status, headers, finished)
            if fatal:
                self._setmeta("fatal_auth", {"status": status, "reason": reason,
                                           "request_id": request_id, "observed_at": finished})
            self.db.execute("UPDATE requests SET finished=?,status=?,exit_code=?,headers=?,elapsed=?,"
                            "received_bytes=?,error=?,resource=? WHERE id=? AND finished IS NULL",
                            (finished, status, exit_code, json.dumps(headers), max(0, finished-started),
                             size, reason, actual, request_id))
            self.note("request_failed", self.db.execute("SELECT job_id FROM requests WHERE id=?", (request_id,)).fetchone()[0],
                      {"request_id": request_id, "status": status, "reason": reason, "retry_at": retry_at,
                       "fatal": fatal})
            return retry_at

    def response(self, request_id) -> dict:
        with self._lock:
            row = self.db.execute("SELECT * FROM requests WHERE id=?", (request_id,)).fetchone()
            if row is None:
                raise KeyError(request_id)
            if row["error"] or row["finished"] is None or not row["body_hash"]:
                raise ApiError(row["status"], row["error"] or "unfinished_request", request_id=request_id,
                               fatal=row["error"] == "fatal_authentication_failure")
            blob = self.db.execute("SELECT compressed FROM blobs WHERE hash=?", (row["body_hash"],)).fetchone()
            if blob is None:
                raise ApiError(row["status"], "missing_body", request_id=request_id)
            source = self.db.execute("SELECT job_id,finished FROM requests WHERE id=?",
                                     (row["reused_request_id"],)).fetchone() if row["reused_request_id"] else None
            return {"request_id": row["id"], "body": json.loads(zlib.decompress(blob[0])),
                    "status": row["status"], "cache_revalidated": row["status"] == 304,
                    "started_at": _iso(row["started"]), "finished_at": _iso(row["finished"]),
                    "elapsed_seconds": row["elapsed"], "body_hash": row["body_hash"],
                    "headers": json.loads(row["headers"]), "received_bytes": row["received_bytes"],
                    "reused_request_id": row["reused_request_id"],
                    "cache_source_job_id": source["job_id"] if source else None,
                    "cache_source_checked_at": _iso(source["finished"]) if source and source["finished"] else None,
                    "wait_seconds": row["wait_seconds"], "queue_wait_seconds": row["queue_wait_seconds"]}

    def stats(self, job_id) -> dict:
        with self._lock:
            rows = self.db.execute("SELECT r.*,s.job_id AS source_job,s.finished AS source_finished "
                                   "FROM requests r LEFT JOIN requests s ON s.id=r.reused_request_id "
                                   "WHERE r.job_id=? ORDER BY r.id", (str(job_id),)).fetchall()
            success = [r for r in rows if r["finished"] is not None and not r["error"]]
            hits = [r for r in success if r["status"] == 304]
            conditional_success = [r for r in success if r["sent_etag"] and r["status"] in (200, 304)]
            core_conditional = [r for r in conditional_success if r["resource"] == "core"]
            history_conditional = [r for r in conditional_success if "/stargazers/history" in r["endpoint"]]
            shanghai = ZoneInfo("Asia/Shanghai")
            cross_date = sum(bool(r["source_finished"] and
                datetime.fromtimestamp(r["source_finished"], shanghai).date() <
                datetime.fromtimestamp(r["finished"], shanghai).date()) for r in hits)
            return {"attempted": len(rows), "responses_200": sum(r["status"] == 200 for r in success),
                    "responses_304": len(hits), "cross_job_304": sum(r["source_job"] != str(job_id) for r in hits),
                    "cross_date_304_shanghai": cross_date,
                    "conditional_attempted": sum(bool(r["sent_etag"]) for r in rows),
                    "conditional_success_count": len(conditional_success),
                    "cache_hit_rate": len(hits) / len(conditional_success) if conditional_success else None,
                    "core_conditional_success_count": len(core_conditional),
                    "core_conditional_attempted": sum(bool(r["sent_etag"]) and r["resource"] == "core" for r in rows),
                    "core_304": sum(r["status"] == 304 for r in core_conditional),
                    "core_cache_hit_rate": sum(r["status"] == 304 for r in core_conditional) / len(core_conditional)
                        if core_conditional else None,
                    "history_conditional_success_count": len(history_conditional),
                    "history_conditional_attempted": sum(bool(r["sent_etag"]) and "/stargazers/history" in r["endpoint"] for r in rows),
                    "history_304": sum(r["status"] == 304 for r in history_conditional),
                    "history_cache_hit_rate": sum(r["status"] == 304 for r in history_conditional) / len(history_conditional)
                        if history_conditional else None,
                    "http_429": sum(r["status"] == 429 for r in rows),
                    "http_5xx": sum(r["status"] is not None and 500 <= r["status"] < 600 for r in rows),
                    "timeouts": sum(r["error"] == "timeout" for r in rows),
                    "errors": sum(bool(r["error"]) for r in rows),
                    "unfinished": sum(r["finished"] is None and not r["error"] for r in rows),
                    "unknown_outcomes": sum(r["error"] == "outcome_unknown_after_restart" for r in rows),
                    "core_attempts": sum(r["resource"] == "core" for r in rows),
                    "search_attempts": sum(r["resource"] == "search" for r in rows),
                    "bytes_received": sum(r["received_bytes"] for r in rows),
                    "bytes_200": sum(r["received_bytes"] for r in success if r["status"] == 200),
                    "bytes_304": sum(r["received_bytes"] for r in hits),
                    "network_elapsed_seconds": round(sum(r["elapsed"] or 0 for r in rows), 3),
                    "wait_seconds": round(sum(r["wait_seconds"] for r in rows), 3),
                    "queue_wait_seconds": round(sum(r["queue_wait_seconds"] for r in rows), 3),
                    "wait_seconds_semantics": "sum of worker waits; not wall-clock duration",
                    "local_checkpoint_reuse_is_not_304": True,
                    "first_attempt_at": _iso(rows[0]["started"]) if rows else None,
                    "last_finished_at": _iso(max(r["finished"] for r in rows if r["finished"] is not None))
                        if any(r["finished"] is not None for r in rows) else None}

    def status(self) -> dict:
        with self._lock:
            now = self._clock()
            charged, own, external = self._charged(now)
            return {"checked_at": _iso(now), "core_cap_per_rolling_hour": self.CORE_CAP,
                    "core_reserve": self.CORE_RESERVE, "recent_charged_core_attempts": len(charged),
                    "own_recent_charged_core_attempts": own, "external_recent_core_attempts": external,
                    "core_pause_until": self._meta("core_pause_until", 0),
                    "search_pause_until": self._meta("search_pause_until", 0),
                    "global_pause_until": self._meta("global_pause_until", 0),
                    "last_wait": self._meta("last_wait"),
                    "last_rate_core": self._meta("last_rate_core"),
                    "last_rate_search": self._meta("last_rate_search"),
                    "fatal_auth": self._meta("fatal_auth"),
                    "cancel_pending": self._cancelled.is_set(),
                    "unfinished_requests": self.db.execute(
                        "SELECT COUNT(*) FROM requests WHERE finished IS NULL AND error IS NULL").fetchone()[0],
                    "unknown_outcomes": self.db.execute(
                        "SELECT COUNT(*) FROM requests WHERE error='outcome_unknown_after_restart'").fetchone()[0]}

    def close(self):
        with self._lock:
            self.db.close()
