"""
AI-Powered Bid Platform — Master startup script.
Set this as your startup file in Visual Studio 2022 and press F5.
"""

import sys
import os
import subprocess
import platform

# ── All paths derived from this file's location, never from cwd ───
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR  = SCRIPT_DIR
FRONTEND_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "frontend"))
VENV_DIR     = os.path.join(BACKEND_DIR, ".venv")
IS_WINDOWS   = platform.system() == "Windows"

VENV_PYTHON = os.path.join(VENV_DIR, "Scripts" if IS_WINDOWS else "bin",
                            "python.exe" if IS_WINDOWS else "python")
VENV_PIP    = os.path.join(VENV_DIR, "Scripts" if IS_WINDOWS else "bin",
                            "pip.exe" if IS_WINDOWS else "pip")
NPM         = "npm.cmd" if IS_WINDOWS else "npm"


def _in_venv():
    return (
        hasattr(sys, "real_prefix")
        or (hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix)
    )


def _print(tag, msg):
    print(f"[{tag:<6}] {msg}", flush=True)


# ══════════════════════════════════════════════════════════════════
# GATE: if we are NOT inside the venv, create it and re-launch.
# Nothing below this block imports any third-party package.
# ══════════════════════════════════════════════════════════════════
if not _in_venv():
    # Create the venv if it doesn't exist yet
    if not os.path.isfile(VENV_PYTHON):
        _print("setup", f"Creating virtual environment at: {VENV_DIR}")
        subprocess.check_call([sys.executable, "-m", "venv", VENV_DIR])
        _print("setup", "Virtual environment created.")

    # Install requirements before re-launching so the venv is complete
    req = os.path.join(BACKEND_DIR, "requirements.txt")
    if os.path.isfile(req) and os.path.isfile(VENV_PIP):
        _print("setup", "Installing dependencies (first run — may take a few minutes)...")
        result = subprocess.run(
            [VENV_PIP, "install", "-r", req, "--disable-pip-version-check"],
        )
        if result.returncode != 0:
            _print("setup", "ERROR: pip install failed — see errors above.")
            _print("setup", "Try deleting .venv and running again.")
            sys.exit(1)
        else:
            _print("setup", "Dependencies installed.")

    # Re-launch this same file using the venv Python, then exit
    _print("setup", "Re-launching inside virtual environment...")
    result = subprocess.run(
        [VENV_PYTHON, os.path.abspath(__file__)] + sys.argv[1:]
    )
    if result.returncode != 0:
        _print("setup", f"ERROR: Process exited with code {result.returncode}")
        _print("setup", "Check the output above for the actual error.")
        _print("setup", "Common fixes:")
        _print("setup", "  1. Delete .venv folder and try again")
        _print("setup", "  2. Check requirements.txt for incompatible packages")
        _print("setup", "  3. Run manually: .venv\\Scripts\\pip install -r requirements.txt")
    sys.exit(result.returncode)


# ══════════════════════════════════════════════════════════════════
# Everything below only runs when we ARE inside the venv.
# Third-party imports are safe here.
# ══════════════════════════════════════════════════════════════════

import time
import webbrowser
import signal
import atexit
import threading

# Make sure 'app' package is importable regardless of cwd
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# ── Pre-load .env so pydantic-settings finds it regardless of cwd ─
env_file = os.path.join(BACKEND_DIR, ".env")
if os.path.isfile(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

from app.config import settings   # safe — pydantic_settings is installed

# ── Child process registry ────────────────────────────────────────
_procs: list = []


def _shutdown(signum=None, frame=None):
    _print("stop", "Stopping all services...")
    for p in _procs:
        try:
            if p.poll() is None:
                p.terminate()
                p.wait(timeout=5)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
    _print("stop", "All services stopped.")
    sys.exit(0)


atexit.register(_shutdown)
signal.signal(signal.SIGINT,  _shutdown)
signal.signal(signal.SIGTERM, _shutdown)


def _run_bg(tag, cmd, cwd=None):
    _print(tag, "Starting...")
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WINDOWS else 0
    p = subprocess.Popen(
        cmd,
        cwd=cwd or BACKEND_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
    )
    _procs.append(p)
    _print(tag, f"Running  (pid {p.pid})")
    return p


# ══════════════════════════════════════════════════════════════════
# STEP 1 — Ensure Redis
# ══════════════════════════════════════════════════════════════════
def _ensure_redis():
    _print("redis", "Checking Redis...")
    try:
        import redis as redis_lib
        r = redis_lib.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        _print("redis", "Redis is running ✓")
        return
    except Exception:
        pass

    _print("redis", "Not running — trying Docker...")
    try:
        r = subprocess.run(
            ["docker", "run", "-d", "--name", "bidplatform-redis",
             "-p", "6379:6379", "--rm", "redis:7-alpine"],
            capture_output=True, text=True, timeout=20
        )
        if r.returncode == 0 or "already in use" in r.stderr:
            time.sleep(2)
            _print("redis", "Started via Docker ✓")
            return
    except FileNotFoundError:
        pass
    except Exception as e:
        _print("redis", f"Docker error: {e}")

    _print("redis", "⚠  Redis unavailable.")
    _print("redis", "   Install Docker Desktop and restart, or run:")
    _print("redis", "   docker run -d -p 6379:6379 redis:alpine")


_ensure_redis()


# ══════════════════════════════════════════════════════════════════
# STEP 2 — Start Celery worker (only if Redis available)
# ══════════════════════════════════════════════════════════════════
def _start_celery():
    redis_ok = False
    try:
        import redis as _redis
        r = _redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        redis_ok = True
    except Exception:
        pass

    if not redis_ok:
        _print("celery", "Redis unavailable — Celery not started.")
        _print("celery", "Document ingestion will run synchronously instead.")
        _print("celery", "To enable background jobs: docker run -d -p 6379:6379 redis:alpine")
        return

    cmd = [VENV_PYTHON, "-m", "celery",
           "-A", "app.celery_app", "worker", "--loglevel=warning"]
    if IS_WINDOWS:
        cmd.append("--pool=solo")
    _run_bg("celery", cmd, cwd=BACKEND_DIR)


_start_celery()


# ══════════════════════════════════════════════════════════════════
# STEP 3 — Start React frontend
# ══════════════════════════════════════════════════════════════════
def _read_frontend_port():
    env_local = os.path.join(FRONTEND_DIR, ".env.local")
    if os.path.isfile(env_local):
        with open(env_local) as f:
            for line in f:
                line = line.strip()
                if line.startswith("VITE_PORT="):
                    try:
                        return int(line.split("=", 1)[1].strip())
                    except ValueError:
                        pass
    return 5180


FRONTEND_PORT = _read_frontend_port()
FRONTEND_URL  = f"http://localhost:{FRONTEND_PORT}"
BACKEND_URL   = f"http://localhost:{settings.PORT}"


def _start_frontend():
    if not os.path.isdir(FRONTEND_DIR):
        _print("front", f"Not found: {FRONTEND_DIR} — skipping.")
        return False

    _print("front", f"Directory: {FRONTEND_DIR}")

    # Clear Vite's cache so updated files are always picked up
    vite_cache = os.path.join(FRONTEND_DIR, "node_modules", ".vite")
    if os.path.isdir(vite_cache):
        import shutil
        shutil.rmtree(vite_cache, ignore_errors=True)
        _print("front", "Cleared Vite cache.")

    node_modules = os.path.join(FRONTEND_DIR, "node_modules")
    if not os.path.isdir(node_modules):
        _print("front", "Running npm install (first time — may take a minute)...")
        r = subprocess.run(
            [NPM, "install"],
            cwd=FRONTEND_DIR,
            capture_output=True, text=True
        )
        if r.returncode != 0:
            _print("front", "npm install failed — frontend will not start.")
            print(r.stderr[-800:], flush=True)
            return False
        _print("front", "npm install complete.")

    _print("front", f"Starting Vite on port {FRONTEND_PORT}...")

    log_file = os.path.join(BACKEND_DIR, "vite.log")

    # Open log file first, then pass the handle to Popen
    # Keeping it open avoids Windows file-handle timing issues
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WINDOWS else 0
    log_handle = open(log_file, "w")
    p = subprocess.Popen(
        [NPM, "run", "dev"],
        cwd=FRONTEND_DIR,
        stdout=log_handle,
        stderr=log_handle,
        creationflags=flags,
    )
    log_handle.close()   # close our copy — Popen has its own handle now
    _procs.append(p)
    _print("front", f"Vite process started (pid {p.pid})")

    import socket

    def _port_open(host: str, port: int) -> bool:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            return False

    deadline = time.time() + 120   # 120s — generous for slow first compile
    last_log_size = 0
    _print("front", f"Waiting up to 120s for Vite to be ready on port {FRONTEND_PORT}...")

    while time.time() < deadline:
        # Check if Vite process died unexpectedly
        if p.poll() is not None:
            _print("front", f"ERROR: Vite exited with code {p.poll()}")
            try:
                with open(log_file, encoding="utf-8", errors="replace") as lf:
                    content = lf.read()
                if content:
                    print("--- vite.log ---", flush=True)
                    print(content[-3000:], flush=True)
                    print("----------------", flush=True)
            except Exception:
                pass
            return False

        # Stream new log output to console as it arrives
        try:
            with open(log_file, encoding="utf-8", errors="replace") as lf:
                content = lf.read()
            if len(content) > last_log_size:
                new_output = content[last_log_size:]
                for line in new_output.splitlines():
                    if line.strip():
                        _print("vite ", line)
                last_log_size = len(content)
        except Exception:
            pass

        # Check port — try both IPv4 and IPv6 (Windows Vite sometimes binds to ::1)
        if _port_open("127.0.0.1", FRONTEND_PORT) or _port_open("::1", FRONTEND_PORT):
            _print("front", f"Vite is ready ✓  → {FRONTEND_URL}")
            return True

        time.sleep(1)

    # Timeout — print the full log so user can diagnose
    _print("front", f"WARNING: Vite did not respond on port {FRONTEND_PORT} within 120s.")
    try:
        with open(log_file, encoding="utf-8", errors="replace") as lf:
            content = lf.read()
        if content.strip():
            print("--- vite.log (last 3000 chars) ---", flush=True)
            print(content[-3000:], flush=True)
            print("----------------------------------", flush=True)
        else:
            print("[vite.log is empty — npm run dev may not have started]", flush=True)
    except Exception as e:
        print(f"[Could not read vite.log: {e}]", flush=True)

    _print("front", f"If Vite is running, try opening {FRONTEND_URL} manually.")
    _print("front", f"Or run manually: cd frontend && npm run dev")
    return False


_frontend_ready = _start_frontend()


# ══════════════════════════════════════════════════════════════════
# STEP 4 — Open browser (only once Vite confirmed ready)
# ══════════════════════════════════════════════════════════════════
def _open_browser():
    # Small extra delay to let Vite finish its initial HMR compilation
    time.sleep(2)
    try:
        webbrowser.open(FRONTEND_URL)
        _print("browse", f"Opened {FRONTEND_URL}")
    except Exception as e:
        _print("browse", f"Could not open browser automatically: {e}")
        _print("browse", f"Open manually: {FRONTEND_URL}")


if _frontend_ready:
    threading.Thread(target=_open_browser, daemon=True).start()
else:
    _print("browse", f"Open manually when ready: {FRONTEND_URL}")


# ══════════════════════════════════════════════════════════════════
# STEP 5 — Start FastAPI (blocks until Ctrl+C)
# ══════════════════════════════════════════════════════════════════
print(flush=True)
print("=" * 54, flush=True)
print("  AI-Powered Bid Platform",              flush=True)
print(f"  Frontend  →  {FRONTEND_URL}",          flush=True)
print(f"  Backend   →  {BACKEND_URL}",           flush=True)
print(f"  API docs  →  {BACKEND_URL}/api/docs",  flush=True)
print("  Ctrl+C to stop all services",          flush=True)
print("=" * 54, flush=True)
print(flush=True)

import uvicorn
uvicorn.run(
    "app.main:app",
    host=settings.HOST,
    port=settings.PORT,
    reload=False,
    log_level="info",
)
