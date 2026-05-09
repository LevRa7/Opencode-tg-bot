# Diff Telegraph — веб-сервер для рендеринга diff'ов и публикации на Telegra.ph
#
# Архитектура:
#   Hermes (patch tool)
#       → transform_tool_result hook (plugins/diff_telegraph.py)
#           → POST /publish → FastAPI server
#               → Jinja2 render (light/dark theme)
#                   → Telegra.ph API
#                       → Telegram: "📄 Diff: https://telegra.ph/..."

from __future__ import annotations

import asyncio
import hashlib
import html
import htmldiff
import logging
import re
import textwrap
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
import jinja2
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

# =============================================================================
# Config
# =============================================================================

GATEWAY_PORT = 18797
GATEWAY_HOST = "127.0.0.1"
CACHE_DIR = Path("/tmp/diff-telegraph-cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

JINJA = jinja2.Environment(
    loader=jinja2.FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=jinja2.select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

logger = logging.getLogger("diff-telegraph")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# =============================================================================
# Telegra.ph client (raw requests, no extra lib needed)
# =============================================================================

TELEGRAPH_TOKEN: Optional[str] = None  # set via POST /auth or env TELEGRAPH_TOKEN

TELEGRAPH_API = "https://api.telegra.ph"


async def telegraph_create_page(
    title: str,
    content: str,
    author_name: str = "Diff Telegraph",
) -> dict:
    """Create a Telegra.ph page. Returns the created page dict."""
    if not TELEGRAPH_TOKEN:
        raise HTTPException(503, "Telegraph not authenticated — POST /auth first")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{TELEGRAPH_API}/createPage",
            data={
                "access_token": TELEGRAPH_TOKEN,
                "title": title,
                "html_content": content,
                "author_name": author_name,
                "return_content": "true",
            },
        )
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(502, f"Telegra.ph error: {data.get('error', 'unknown')}")
    return data["result"]


async def telegraph_create_account(
    short_name: str,
    author_name: str = "Diff Telegraph",
) -> dict:
    """Create a new Telegraph account and return the token."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{TELEGRAPH_API}/createAccount",
            data={"short_name": short_name, "author_name": author_name},
        )
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(502, f"Telegra.ph error: {data.get('error', 'unknown')}")
    return data["result"]


# =============================================================================
# Diff rendering
# =============================================================================

HEADER_RE = re.compile(r"^(---|\+\+\+|@@).*$", re.MULTILINE)


def _split_unified(diff: str) -> list[dict]:
    """Parse unified diff into structured hunks."""
    hunks = []
    current_file = ""
    lines = diff.splitlines()

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("--- ") or line.startswith("diff "):
            # Extract filename
            parts = line.split("\t")
            name = parts[0].replace("--- ", "").replace("diff ", "")
            current_file = name.strip(" ab/")
            i += 1
            continue
        if line.startswith("@@"):
            # @@ -start,len +start,len @@ context
            meta = line[3:].split("@@")[0].strip()
            parts = meta.split()
            old_range = parts[0] if parts else ""
            new_range = parts[1] if len(parts) > 1 else ""
            hunk_lines = [line]
            i += 1
            while i < len(lines) and not lines[i].startswith(("--- ", "+++ ", "diff ", "index ")):
                hunk_lines.append(lines[i])
                i += 1
            hunks.append({
                "file": current_file,
                "old_range": old_range,
                "new_range": new_range,
                "lines": hunk_lines,
            })
            continue
        i += 1
    return hunks


def _render_hunk(hunk: dict, theme: str = "dark") -> str:
    """Render a single hunk as an HTML table block."""
    lines = hunk["lines"]
    rows = ""
    for line in lines:
        if line.startswith("--- ") or line.startswith("+++ ") or line.startswith("diff ") or line.startswith("index "):
            continue
        if line.startswith("@@"):
            meta = html.escape(line)
            rows += f'<tr class="hunk-header"><td colspan="3">{meta}</td></tr>\n'
            continue
        if not line:
            content = "&nbsp;"
            cls = "ctx"
        else:
            prefix = line[0]
            content = html.escape(line[1:])
            if prefix == "-":
                cls = "del"
            elif prefix == "+":
                cls = "add"
            elif prefix == " ":
                cls = "ctx"
            elif prefix == "\\":
                # "\ No newline at end of file" — skip
                continue
            else:
                cls = "ctx"
                content = html.escape(line)
        rows += f'<tr class="{cls}"><td class="line-no"></td><td class="sign">{prefix if prefix not in (" ",) else " "}</td><td><code>{content}</code></td></tr>\n'
    return rows


def render_diff_html(diff: str, theme: str = "dark", title: str = "File Changes") -> str:
    """Render unified diff as a standalone HTML document (full page)."""
    theme = "light" if theme == "light" else "dark"
    tmpl = JINJA.get_template(f"diff_{theme}.html")
    hunks = _split_unified(diff)
    file_blocks = ""
    total_add = 0
    total_del = 0

    seen_files: dict[str, int] = {}

    for hunk in hunks:
        f = hunk["file"]
        seen_files[f] = seen_files.get(f, 0) + 1
        suffix = f" #{seen_files[f]}" if seen_files[f] > 1 else ""
        file_name = f"{f}{suffix}"

        add_count = sum(1 for l in hunk["lines"] if l.startswith("+") and not l.startswith("+++ "))
        del_count = sum(1 for l in hunk["lines"] if l.startswith("-") and not l.startswith("--- "))
        total_add += add_count
        total_del += del_count

        rows = _render_hunk(hunk, theme)
        file_blocks += f"""
        <div class="file-block">
            <div class="file-header">
                <span class="file-icon">📄</span>
                <span class="file-name">{html.escape(file_name)}</span>
                <span class="stats">
                    <span class="add-badge">+{add_count}</span>
                    <span class="del-badge">-{del_count}</span>
                </span>
            </div>
            <table class="diff-table">
                <tbody>
                {rows}
                </tbody>
            </table>
        </div>
        """

    stats = f'<span class="add-badge">+{total_add}</span> <span class="del-badge">-{total_del}</span>'

    return tmpl.render(
        title=title,
        theme=theme,
        file_blocks=file_blocks,
        stats=stats,
        timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )


# =============================================================================
# API models
# =============================================================================

class DiffRequest(BaseModel):
    diff: str = Field(..., description="Unified diff string")
    title: Optional[str] = Field(None, description="Page title override")
    theme: str = Field("dark", description="'dark' or 'light'")
    author_name: str = Field("Diff Telegraph", description="Author name on Telegraph")


class AuthRequest(BaseModel):
    access_token: str = Field(..., description="Telegraph access token")
    short_name: str = Field("Diff Viewer", description="Short name for new account creation")
    author_name: str = Field("Diff Telegraph", description="Author name")
    create_if_missing: bool = Field(False, description="Create a new account if token not provided")


class PageResponse(BaseModel):
    url: str
    title: str
    path: str


# =============================================================================
# FastAPI app
# =============================================================================

app = FastAPI(title="Diff Telegraph", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/auth", status_code=200)
async def auth(req: AuthRequest):
    """Set the Telegraph access token for this server instance."""
    global TELEGRAPH_TOKEN
    TELEGRAPH_TOKEN = req.access_token
    return {"status": "ok", "token_prefix": req.access_token[:8] + "..."}


@app.post("/preview", response_class=HTMLResponse)
async def preview(req: DiffRequest):
    """Render diff as HTML and return for preview (no Telegraph)."""
    html_content = render_diff_html(req.diff, theme=req.theme, title=req.title or "Diff Preview")
    return html_content


@app.post("/publish", response_model=PageResponse)
async def publish(req: DiffRequest):
    """Render diff → publish to Telegra.ph → return page URL."""
    title = req.title or "Code Changes"
    if len(title) > 256:
        title = title[:256]

    html_content = render_diff_html(req.diff, theme=req.theme, title=title)

    page = await telegraph_create_page(title, html_content, author_name=req.author_name)
    return PageResponse(url=page["url"], title=page["title"], path=page["path"])


@app.get("/health")
async def health():
    return {"status": "ok", "telegraph_authenticated": TELEGRAPH_TOKEN is not None}


# =============================================================================
# Main
# =============================================================================

def main():
    uvicorn.run(app, host=GATEWAY_HOST, port=GATEWAY_PORT, log_level="info")


if __name__ == "__main__":
    main()
