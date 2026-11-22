"""Run the five archived offline suites in an isolated temporary copy."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile

# 2026-11-22 随 research/ 移到 archive/research/（#112），源目录就在本文件旁边。
SOURCE = Path(__file__).resolve().parent / "github-center-sustained-run"
SUITES = ("test_runner.py", "tests_transport.py", "test_recovery.py", "test_atomic_mismatch.py", "test_leaf_drift.py")
JSON_CASES = {"test_runner.py": 8, "test_recovery.py": 5, "test_leaf_drift.py": 3}


def assess_result(name, result, runner_hash):
    if result.returncode:
        raise ValueError(f"process exit {result.returncode}")
    if name == "tests_transport.py":
        summary = result.stdout + result.stderr
        match = re.search(r"Ran (\d+) tests? in", summary)
        if not match or int(match[1]) < 1 or not re.search(r"^OK$", summary, re.MULTILINE):
            raise ValueError("missing successful unittest result")
        return int(match[1])
    report = json.loads(result.stdout)
    if report.get("network_requests") != 0:
        raise ValueError("offline suite did not confirm zero network requests")
    if name in JSON_CASES:
        cases = report.get("results")
        if (not isinstance(cases, list) or len(cases) != JSON_CASES[name]
                or any(not isinstance(case, dict) or case.get("passed") is not True for case in cases)):
            raise ValueError("one or more expected behavioral checks did not pass")
        if report.get("source_sha256") != runner_hash:
            raise ValueError("test result does not match this runner source")
        return len(cases)
    if name == "test_atomic_mismatch.py" and report.get("passed") is True:
        return 1
    raise ValueError("missing successful atomic check result")


def main():
    failures = []
    with tempfile.TemporaryDirectory(prefix="github-center-offline-") as directory:
        isolated = Path(directory)
        runner_hash = hashlib.sha256((SOURCE / "runner.py").read_bytes()).hexdigest()
        for name in ("runner.py", "transport.py", *SUITES):
            shutil.copy2(SOURCE / name, isolated / name)
        for name in SUITES:
            try:
                result = subprocess.run([sys.executable, str(isolated / name)], cwd=isolated,
                                        capture_output=True, text=True, timeout=150)
            except subprocess.TimeoutExpired:
                print(f"FAIL {name}: timed out")
                failures.append(name)
                continue
            try:
                checks = assess_result(name, result, runner_hash)
            except (ValueError, TypeError, AttributeError) as error:
                failures.append(name)
                print(f"FAIL {name}: {error}")
                print((result.stdout + result.stderr)[-5000:])
            else:
                print(f"PASS {name}: {checks} checks")
    print(f"{len(SUITES)-len(failures)}/{len(SUITES)} offline suites passed. No live collection was started.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
