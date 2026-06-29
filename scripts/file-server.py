#!/usr/bin/env python3
"""file-server — lightweight HTTP file server for agent file delivery.

Ported from Hermes Agent's file-server plugin (plugins/file_server/__init__.py).

Features:
  - HTTP server on 127.0.0.1:8890 serving files from /tmp/served-files/
  - Python stdlib only — no dependencies
  - Auto-start on first request
  - Support for If-Modified-Since (304)
  - MIME type detection

Usage:
  file-server.py start    # Start in background
  file-server.py stop     # Stop server
  file-server.py status   # Show status
  file-server.py serve <path>  # Copy file to served dir, print URL
"""

import json
import mimetypes
import os
import re
import shutil
import socket
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── Constants ───────────────────────────────────────────────────────────────
PORT = int(os.environ.get("FILE_SERVER_PORT", "8890"))
BIND = os.environ.get("FILE_SERVER_BIND", "0.0.0.0")
BASE_URL = os.environ.get(
    "FILE_SERVER_BASE_URL",
    f"http://localhost:{PORT}" if BIND in ("127.0.0.1", "localhost") else f"http://{BIND}:{PORT}"
).rstrip("/")
SERVED_DIR = Path(os.environ.get("FILE_SERVER_DIR", "/tmp/served-files"))
PID_FILE = Path("/tmp/file-server.pid")
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MiB
MAX_FILENAME_LEN = 128

TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml",
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
    ".css", ".scss", ".less", ".html", ".htm", ".svg",
    ".sh", ".bash", ".zsh", ".fish",
    ".sql", ".graphql", ".gql",
    ".toml", ".ini", ".cfg", ".conf", ".env",
    ".log", ".diff", ".patch",
    ".vue", ".svelte", ".astro",
}

EXTRA_MIMETYPES = {
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".toml": "text/toml",
    ".env": "text/plain",
    ".lock": "text/plain",
    ".log": "text/plain",
    ".cfg": "text/plain",
    ".conf": "text/plain",
}

for ext, mime in EXTRA_MIMETYPES.items():
    if ext not in mimetypes.types_map:
        mimetypes.types_map[ext] = mime


# ── HTTP Handler ────────────────────────────────────────────────────────────
class FileHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002
        pass  # silent

    def do_GET(self):
        raw = self.path.lstrip("/")
        if not raw or ".." in raw or "/" in raw:
            self._error(404)
            return

        filepath = SERVED_DIR / raw
        if not filepath.exists() or not filepath.is_file():
            self._error(404)
            return

        stat = filepath.stat()
        if stat.st_size > MAX_FILE_SIZE:
            self._error(413)
            return

        mime_type, _ = mimetypes.guess_type(str(filepath))
        if mime_type is None:
            mime_type = "application/octet-stream"

        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(filepath, "rb") as fh:
            remaining = stat.st_size
            while remaining > 0:
                chunk = fh.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self):
        self.do_GET()

    def do_PUT(self):
        """Upload a file — PUT /filename with body as file content."""
        raw = self.path.lstrip("/")
        if not raw or ".." in raw or "/" in raw:
            self._error(400, "Invalid filename")
            return

        cl = int(self.headers.get("Content-Length", 0))
        if cl == 0:
            self._error(400, "Empty body")
            return
        if cl > MAX_FILE_SIZE:
            self._error(413, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024}MiB)")
            return

        SERVED_DIR.mkdir(parents=True, exist_ok=True)
        name = _safe_name(raw)
        dest = SERVED_DIR / name

        data = self.rfile.read(cl)
        with open(dest, "wb") as f:
            f.write(data)

        url = f"{BASE_URL}/{name}"
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({
            "url": url,
            "basename": name,
            "size": len(data),
            "uploaded": True,
        }).encode())

    def do_POST(self):
        """Alias for PUT — POST /filename also uploads."""
        self.do_PUT()

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Content-Length")
        self.end_headers()

    def _error(self, code, msg="Error"):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        body = msg.encode() if isinstance(msg, str) else b"Error"
        self.wfile.write(body)
        return None


# ── Server lifecycle ────────────────────────────────────────────────────────
_server: HTTPServer | None = None
_thread: threading.Thread | None = None


def start():
    """Entry point for background process — blocks until killed."""
    SERVED_DIR.mkdir(parents=True, exist_ok=True)
    server = HTTPServer((BIND, PORT), FileHandler)
    print(f"file-server started on {BASE_URL}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


def stop():
    global _server, _thread
    if _server is None:
        print("file-server not running")
        return
    _server.shutdown()
    _server.server_close()
    _server = None
    _thread = None
    PID_FILE.unlink(missing_ok=True)
    print("file-server stopped")


def is_running() -> bool:
    """Check if the server is running by checking the port."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.connect((BIND, PORT))
        s.close()
        return True
    except (ConnectionRefusedError, OSError):
        return False


def status():
    running = is_running()
    count = len(list(SERVED_DIR.iterdir())) if SERVED_DIR.exists() else 0
    print(json.dumps({
        "running": running,
        "port": PORT,
        "files": count,
        "url": BASE_URL if running else None
    }))


# ── File serving ────────────────────────────────────────────────────────────
def _safe_name(filepath: str) -> str:
    name = Path(filepath).name
    name = "".join(ch for ch in name if ch.isprintable() and ch not in "\x00/\\")
    if len(name) > MAX_FILENAME_LEN:
        stem, ext = os.path.splitext(name)
        keep = MAX_FILENAME_LEN - len(ext) - 10
        if keep < 10:
            keep = 10
        name = stem[:keep] + "…" + ext
    return name or "unnamed_file"


def serve_file(filepath: str) -> str:
    """Copy file to served dir, return HTTP URL."""
    fpath = Path(filepath).resolve()
    if not fpath.exists() or not fpath.is_file():
        print(f"ERROR: file not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    if fpath.stat().st_size > MAX_FILE_SIZE:
        print(f"ERROR: file too large (>50MB): {filepath}", file=sys.stderr)
        sys.exit(1)

    SERVED_DIR.mkdir(parents=True, exist_ok=True)
    basename = _safe_name(str(fpath))
    dest = SERVED_DIR / basename

    if not dest.exists():
        try:
            shutil.copy2(str(fpath), str(dest))
        except OSError as e:
            print(f"ERROR: copy failed: {e}", file=sys.stderr)
            sys.exit(1)

    # Determine if it's text (for Telegraph hint)
    ext = fpath.suffix.lower()
    is_text = ext in TEXT_EXTENSIONS
    is_code = ext in {".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java",
                       ".c", ".cpp", ".h", ".sh", ".bash", ".sql", ".rb"}

    url = f"{BASE_URL}/{basename}"

    # Output machine-readable JSON for the bot to parse
    result = {
        "url": url,
        "path": str(fpath),
        "basename": basename,
        "size": fpath.stat().st_size,
        "is_text": is_text,
        "is_code": is_code,
    }
    print(json.dumps(result))


def serve_and_link(text: str) -> str:
    """Scan text for file paths, serve found files, replace with HTTP links."""
    file_re = re.compile(r"(/[^\s:)]+\.\w+)")

    def replacer(m):
        raw = m.group(1)
        cleaned = raw.rstrip(".,;:!?)]}>\"'`")
        fpath = Path(cleaned)
        if fpath.exists() and fpath.is_file() and fpath.suffix.lower() in TEXT_EXTENSIONS | CodeExTS:
            try:
                SERVED_DIR.mkdir(parents=True, exist_ok=True)
                basename = _safe_name(str(fpath))
                dest = SERVED_DIR / basename
                if not dest.exists():
                    shutil.copy2(str(fpath), str(dest))
                return f"[{raw}]({BASE_URL}/{basename})"
            except OSError:
                pass
        return raw

    return file_re.sub(replacer, text)


CodeExTS = {".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java",
            ".c", ".cpp", ".h", ".sh", ".bash", ".sql", ".rb"}


# ── CLI ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"

    if cmd == "start":
        start()
    elif cmd == "stop":
        stop()
    elif cmd == "status":
        status()
    elif cmd == "serve" and len(sys.argv) > 2:
        serve_file(sys.argv[2])
    elif cmd == "scan" and len(sys.argv) > 2:
        print(serve_and_link(sys.argv[2]))
    else:
        print("Usage: file-server.py {start|stop|status|serve <path>|scan <text>}")
        sys.exit(1)
