"""Resume the finite local validator; the worker itself owns the exclusive lock."""
import fcntl
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON = "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"

if __name__ == "__main__":
    with (ROOT / "worker.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "already_running"}))
            raise SystemExit(0)
        fcntl.flock(lock, fcntl.LOCK_UN)
    with (ROOT / "worker.log").open("ab") as log:
        process = subprocess.Popen([PYTHON, str(ROOT / "runner.py"), "run"], cwd=ROOT,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   start_new_session=True, close_fds=True)
    print(json.dumps({"status": "spawned_needs_readback", "pid": process.pid}))
