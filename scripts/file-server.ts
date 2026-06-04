#!/usr/bin/env -S npx tsx
/**
 * file-server — local web file browser with syntax highlighting and markdown rendering
 *
 * Usage:
 *   npx tsx scripts/file-server.ts [--port 4200] [--root /path/to/serve]
 *
 * Features:
 *   - Directory browsing with file tree
 *   - Syntax highlighting (highlight.js)
 *   - Markdown rendering (marked)
 *   - Dark/light theme with auto-switching
 *   - Full-text search (fuse.js)
 *   - ZIP archive download
 *   - Raw file download for Telegraph / external embedding
 */

import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import * as cp from "node:child_process";

// ---- config ----

const PORT = parseInt(process.argv[process.argv.indexOf("--port") + 1] ?? "4200", 10) || 4200;
const rootIdx = process.argv.indexOf("--root");
const ROOT = rootIdx >= 0 ? path.resolve(process.argv[rootIdx + 1] ?? process.cwd()) : process.cwd();

const MIME: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html",
  ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".xml": "application/xml",
  ".txt": "text/plain", ".md": "text/markdown",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
};

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml",
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".scss", ".less", ".html", ".htm", ".svg",
  ".sh", ".bash", ".zsh", ".sql", ".graphql", ".toml", ".ini", ".cfg",
  ".env", ".log", ".diff", ".patch", ".vue", ".svelte",
]);

function getMime(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function isText(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  return TEXT_EXTS.has(ext) || base === "Makefile" || base === "Dockerfile" || base === "LICENSE";
}

function safeJoin(base: string, target: string): string | null {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

// Extract relative path from query parameter 'p'
function getPathParam(req: express.Request): string {
  const p = (req.query.p as string) ?? "";
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

// ---- HTML template ----

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="auto">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>File Browser</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css" id="hljs-dark">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css" id="hljs-light">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/15.0.12/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/fuse.js/7.1.0/fuse.min.js"></script>
<style>
:root{--bg:#0d1117;--bg2:#161b22;--border:#30363d;--text:#c9d1d9;--text2:#8b949e;--accent:#58a6ff;--code-bg:#161b22;--hover:#1c2128}
[data-theme="light"]{--bg:#fff;--bg2:#f6f8fa;--border:#d0d7de;--text:#24292f;--text2:#57606a;--accent:#0969da;--code-bg:#f6f8fa;--hover:#f3f4f6}
@media (prefers-color-scheme:light){[data-theme="auto"]{--bg:#fff;--bg2:#f6f8fa;--border:#d0d7de;--text:#24292f;--text2:#57606a;--accent:#0969da;--code-bg:#f6f8fa;--hover:#f3f4f6}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;height:100vh;overflow:hidden}
.sidebar{width:320px;min-width:260px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.sidebar-header{padding:12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0}
.sidebar-header input{flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px;outline:none}
.sidebar-header button{padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text2);cursor:pointer;font-size:13px}
.sidebar-header button:hover{background:var(--hover);color:var(--text)}
.file-list{flex:1;overflow-y:auto;padding:4px 0}
.file-item{display:flex;align-items:center;padding:6px 12px;cursor:pointer;font-size:13px;gap:8px}
.file-item:hover{background:var(--hover)}
.file-item.selected{background:var(--accent);color:#fff}
.file-item .icon{width:16px;text-align:center;flex-shrink:0}
.file-item .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-item .size{font-size:11px;color:var(--text2);flex-shrink:0}
.file-item .zip-cb{margin-right:2px}
.dir-item{font-weight:600}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.toolbar{padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0;font-size:13px}
.toolbar .breadcrumb{flex:1;display:flex;gap:4px;align-items:center;overflow:hidden}
.toolbar .breadcrumb a{color:var(--accent);text-decoration:none;white-space:nowrap}
.toolbar .breadcrumb a:hover{text-decoration:underline}
.toolbar .breadcrumb span{color:var(--text2)}
.toolbar button{padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text);cursor:pointer;font-size:12px}
.toolbar button:hover{background:var(--hover)}
.content{flex:1;overflow:auto;padding:16px 24px}
.content pre{background:var(--code-bg);border:1px solid var(--border);border-radius:6px;padding:16px;overflow:auto;font-size:13px;line-height:1.5}
.content .markdown{line-height:1.7}
.content .markdown h1,.content .markdown h2,.content .markdown h3{margin:16px 0 8px}
.content .markdown p{margin:8px 0}
.content .markdown code{background:var(--code-bg);padding:2px 6px;border-radius:3px;font-size:90%}
.content .markdown pre{margin:12px 0}
.content .welcome{text-align:center;padding:60px 20px;color:var(--text2)}
.content .welcome h1{font-size:28px;margin-bottom:12px;color:var(--text)}
.empty{text-align:center;padding:40px;color:var(--text2);font-size:13px}
.media-view{text-align:center;padding:24px}
.media-view img,.media-view video{max-width:100%;max-height:70vh;border-radius:8px}
</style>
</head>
<body>
<div class="sidebar">
  <div class="sidebar-header">
    <input type="text" id="search" placeholder="Search files..." oninput="doSearch()">
    <button onclick="toggleTheme()" id="btn-theme">🌓</button>
    <button onclick="downloadSelectedZip()" title="Download selected as ZIP">📦</button>
  </div>
  <div class="file-list" id="fileList"></div>
</div>
<div class="main">
  <div class="toolbar">
    <div class="breadcrumb" id="breadcrumb"></div>
    <button onclick="downloadCurrent()">⬇ Download</button>
    <button onclick="downloadCurrentZip()">📦 ZIP</button>
  </div>
  <div class="content" id="content"><div class="welcome"><h1>📂 File Browser</h1></div></div>
</div>
<script>
var ROOT = "";
var currentPath = "";
var currentIsDir = true;
var fileData = [];
var fuse = null;

async function api(url) { var r = await fetch(url); if (!r.ok) throw new Error("err"); return r; }
async function apiJson(url) { return (await api(url)).json(); }

function themeIcon() {
  var t = document.documentElement.dataset.theme;
  if (t === "dark") return "☀";
  if (t === "light") return "🌙";
  return "🌓";
}

function toggleTheme() {
  var d = document.documentElement;
  var t = d.dataset.theme;
  d.dataset.theme = t === "dark" ? "light" : t === "light" ? "auto" : "dark";
  document.getElementById("btn-theme").textContent = themeIcon();
  updateHljsTheme();
}

function updateHljsTheme() {
  var useDark = document.documentElement.dataset.theme !== "light" &&
    (document.documentElement.dataset.theme === "dark" ||
     window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.getElementById("hljs-dark").disabled = !useDark;
  document.getElementById("hljs-light").disabled = useDark;
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateHljsTheme);
document.getElementById("btn-theme").textContent = themeIcon();
updateHljsTheme();

function esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function renderBreadcrumb(p) {
  var parts = p.replace(/^\\//,"").split("/").filter(Boolean);
  var html = '<a href="#" onclick="navigate(\\'\\');return false">🏠</a>';
  var cur = "";
  for (var i = 0; i < parts.length; i++) {
    cur += "/" + parts[i];
    html += ' <span>/</span> <a href="#" onclick="navigate(\\'' + esc(cur) + '\\');return false">' + esc(parts[i]) + '</a>';
  }
  document.getElementById("breadcrumb").innerHTML = html;
}

function guessIcon(name) {
  var ext = name.split(".").pop().toLowerCase();
  var map = {js:"📜",ts:"📘",py:"🐍",rs:"🦀",go:"🔵",java:"☕",c:"⚙",cpp:"⚙",h:"⚙",rb:"💎",css:"🎨",html:"🌐",json:"📋",md:"📝",yml:"⚙",yaml:"⚙",toml:"⚙",sql:"🗄",sh:"💻",png:"🖼",jpg:"🖼",jpeg:"🖼",gif:"🖼",svg:"🖼",webp:"🖼",mp4:"🎬",mp3:"🎵",wav:"🎵",pdf:"📕",zip:"📦",gz:"📦",tar:"📦"};
  return map[ext] || "📄";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/1048576).toFixed(1) + " MB";
}

function renderFileList(items) {
  var el = document.getElementById("fileList");
  el.innerHTML = items.length === 0 ? '<div class="empty">No files</div>' : "";
  if (currentPath !== "") {
    var parent = currentPath.substring(0, currentPath.lastIndexOf("/")) || "";
    if (parent === "") parent = "";
    el.innerHTML += '<div class="file-item dir-item" onclick="navigate(\\'' + esc(parent) + '\\')"><span class="icon">📁</span><span class="name">..</span></div>';
  }
  for (var i = 0; i < items.length; i++) {
    var f = items[i];
    var fullPath = currentPath ? currentPath + "/" + f.name : f.name;
    var isDir = f.type === "directory";
    var icon = isDir ? "📁" : guessIcon(f.name);
    var cls = fullPath === currentPath ? " selected" : "";
    el.innerHTML += '<div class="file-item' + cls + (isDir ? " dir-item" : "") + '" onclick="navigate(\\'' + esc(fullPath) + '\\')"><input type="checkbox" class="zip-cb" data-path="' + esc(fullPath) + '" data-dir="' + isDir + '" onclick="event.stopPropagation()"><span class="icon">' + icon + '</span><span class="name">' + esc(f.name) + '</span><span class="size">' + (isDir ? "" : formatSize(f.size)) + '</span></div>';
  }
}

async function navigate(p) {
  if (p === undefined) p = "";
  var info = await apiJson("/api/stat?p=" + encodeURIComponent(p));
  if (info.type === "directory") await loadDir(p);
  else await loadFile(p);
}

async function loadDir(dirPath) {
  currentPath = dirPath;
  currentIsDir = true;
  var data = await apiJson("/api/dir?p=" + encodeURIComponent(dirPath));
  fileData = data.entries || [];
  fuse = new Fuse(fileData, {keys:["name"],threshold:0.3});
  renderFileList(fileData);
  renderBreadcrumb(dirPath);
  document.getElementById("content").innerHTML = '<div class="empty">📁 ' + fileData.length + ' items</div>';
}

async function loadFile(filePath) {
  currentPath = filePath;
  currentIsDir = false;
  renderBreadcrumb(filePath);
  var ext = filePath.split(".").pop().toLowerCase();
  var isImg = ["png","jpg","jpeg","gif","webp","svg"].indexOf(ext) >= 0;
  var isVideo = ["mp4","webm","mov"].indexOf(ext) >= 0;
  var isAudio = ["mp3","wav","ogg","flac"].indexOf(ext) >= 0;
  var isMd = ["md","markdown"].indexOf(ext) >= 0;

  if (isImg) {
    document.getElementById("content").innerHTML = '<div class="media-view"><img src="/raw?p=' + encodeURIComponent(filePath) + '" alt=""></div>';
    return;
  }
  if (isVideo) {
    document.getElementById("content").innerHTML = '<div class="media-view"><video controls src="/raw?p=' + encodeURIComponent(filePath) + '"></video></div>';
    return;
  }
  if (isAudio) {
    document.getElementById("content").innerHTML = '<div class="media-view"><audio controls src="/raw?p=' + encodeURIComponent(filePath) + '"></audio></div>';
    return;
  }

  var info = await apiJson("/api/file?p=" + encodeURIComponent(filePath));
  if (isMd) {
    document.getElementById("content").innerHTML = '<div class="markdown">' + marked.parse(info.content) + '</div>';
    hljs.highlightAll();
  } else if (info.isText) {
    document.getElementById("content").innerHTML = '<pre><code>' + esc(info.content) + '</code></pre>';
    hljs.highlightAll();
  } else {
    document.getElementById("content").innerHTML = '<div class="empty">Binary file — <a href="/raw?p=' + encodeURIComponent(filePath) + '">Download</a></div>';
  }
}

function doSearch() {
  var q = document.getElementById("search").value.trim();
  if (!q || !fuse) { renderFileList(fileData); return; }
  var results = fuse.search(q).map(function(r) { return r.item; });
  renderFileList(results);
}

function downloadCurrent() {
  if (!currentPath && !currentIsDir) return;
  window.open("/raw?p=" + encodeURIComponent(currentPath), "_blank");
}

function downloadCurrentZip() {
  if (!currentPath) return;
  window.open("/api/zip?paths=" + encodeURIComponent(currentPath), "_blank");
}

function downloadSelectedZip() {
  var cbs = document.querySelectorAll(".zip-cb:checked");
  var paths = [];
  cbs.forEach(function(cb) { paths.push(cb.dataset.path); });
  if (paths.length === 0) { alert("Select files first"); return; }
  window.open("/api/zip?paths=" + paths.map(function(p) { return encodeURIComponent(p); }).join(","), "_blank");
}

// Init: go to root
loadDir("");
</script>
</body></html>`;

// ---- Express app ----

const app = express();

app.disable("x-powered-by");

// Main page
app.get("/", (_req, res) => res.type("html").send(INDEX_HTML));

// API: directory listing
app.get("/api/dir", (req, res) => {
  try {
    const rel = getPathParam(req);
    const dirPath = safeJoin(ROOT, rel);
    if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
      return res.status(404).json({ error: "Not found" });

    const entries: { name: string; type: string; size: number }[] = [];
    for (const name of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, name);
      try {
        const st = fs.statSync(full);
        entries.push({ name, type: st.isDirectory() ? "directory" : "file", size: st.size });
      } catch { /* skip permission errors */ }
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: file stat
app.get("/api/stat", (req, res) => {
  try {
    const rel = getPathParam(req);
    const fp = safeJoin(ROOT, rel);
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: "Not found" });
    const st = fs.statSync(fp);
    res.json({ type: st.isDirectory() ? "directory" : "file", size: st.size });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: file content (for text files)
app.get("/api/file", (req, res) => {
  try {
    const rel = getPathParam(req);
    const fp = safeJoin(ROOT, rel);
    if (!fp || !fs.existsSync(fp) || fs.statSync(fp).isDirectory())
      return res.status(404).json({ error: "Not found" });

    if (isText(fp)) {
      const content = fs.readFileSync(fp, "utf-8");
      res.json({ content, lines: content.split("\n").length, isText: true });
    } else {
      res.json({ content: "", lines: 0, isText: false });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Raw file download (for images, embedding, direct access)
app.get("/raw", (req, res) => {
  try {
    const rel = getPathParam(req);
    const fp = safeJoin(ROOT, rel);
    if (!fp || !fs.existsSync(fp) || fs.statSync(fp).isDirectory())
      return res.status(404).send("Not found");

    res.setHeader("Content-Type", getMime(fp));
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(fp)}"`);
    fs.createReadStream(fp).pipe(res);
  } catch {
    res.status(500).send("Error");
  }
});

// ZIP download
app.get("/api/zip", (req, res) => {
  try {
    const pathsParam = (req.query.paths as string) ?? "";
    if (!pathsParam) return res.status(400).send("Missing paths parameter");
    const entries = pathsParam.split(",").map(decodeURIComponent).filter(Boolean);

    // If a single directory, zip its contents
    const resolved: string[] = [];
    for (const e of entries) {
      const fp = safeJoin(ROOT, e);
      if (!fp || !fs.existsSync(fp)) continue;
      if (fs.statSync(fp).isDirectory()) {
        for (const name of fs.readdirSync(fp)) resolved.push(path.join(fp, name));
      } else {
        resolved.push(fp);
      }
    }

    if (resolved.length === 0) return res.status(404).send("No files to zip");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="files-${Date.now()}.zip"`);

    const zip = cp.spawn("zip", ["-j", "-", ...resolved], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    zip.stdout.pipe(res);
    zip.on("error", () => { if (!res.headersSent) res.status(500).end(); });
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// ---- start ----

app.listen(PORT, "0.0.0.0", () => {
  console.log(`File server: http://localhost:${PORT}`);
  console.log(`Root: ${ROOT}`);
});
