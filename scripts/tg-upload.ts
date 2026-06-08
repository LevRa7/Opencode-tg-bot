#!/usr/bin/env -S npx tsx
/**
 * tg-upload — send files, text, or Telegraph articles to a Telegram chat
 *
 * Resolves (chat_id, message_thread_id) by session ID via tg-chat-lookup.
 * Uses Telegram Bot API directly. Falls back to Telegraph for oversized files.
 * For text files, can also publish to Telegraph and include link in caption.
 *
 * Usage:
 *   npx tsx scripts/tg-upload.ts --auto --file <path>               # auto-detect session
 *   npx tsx scripts/tg-upload.ts --auto --telegraph-also --file <.> # file + Telegraph link
 *   npx tsx scripts/tg-upload.ts --session-id <id> --file <path>
 *   npx tsx scripts/tg-upload.ts --session-id <id> --text "message"
 *   npx tsx scripts/tg-upload.ts --session-id <id> --photo <path> [--caption "..."]
 *   npx tsx scripts/tg-upload.ts --session-id <id> --video <path> [--caption "..."]
 *   npx tsx scripts/tg-upload.ts --session-id <id> --audio <path> [--caption "..."]
 *   npx tsx scripts/tg-upload.ts --session-id <id> --telegraph --title "..." --body "..."
 *   npx tsx scripts/tg-upload.ts --session-id <id> --telegraph-files --title "..." f1 f2...
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN    — from .env (auto-loaded by tg-chat-lookup)
 *   TELEGRAPH_ACCESS_TOKEN — optional, for Telegraph publishing
 *   TELEGRAPH_AUTHOR_NAME  — optional, default "opencode-tg"
 *   TELEGRAPH_MAX_CHARS    — optional, default 25000
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_BOT_API_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_CAPTION_LENGTH = 1024;

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml",
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".scss", ".less", ".html", ".htm", ".svg",
  ".sh", ".bash", ".zsh", ".fish",
  ".sql", ".graphql", ".gql",
  ".toml", ".ini", ".cfg", ".conf", ".env",
  ".log", ".diff", ".patch",
  ".vue", ".svelte", ".astro",
  ".Dockerfile", ".Makefile", "Makefile",
]);

const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".scss", ".less",
  ".sh", ".bash", ".zsh", ".fish",
  ".sql", ".graphql", ".gql",
  ".toml",
  ".vue", ".svelte", ".astro",
  ".json", ".xml", ".yaml", ".yml",
  ".html", ".htm",
]);

// ---- argument parsing ----

interface CliArgs {
  sessionId: string;
  auto: boolean;
  telegraphAlso: boolean;
  server: string;
  file?: string;
  text?: string;
  qr?: string;
  qrFile?: string;
  photo?: string;
  video?: string;
  audio?: string;
  caption?: string;
  telegraph: boolean;
  telegraphFiles: boolean;
  title?: string;
  body?: string;
  responseFile?: string;
  responseText?: string;
  replyTo?: number;
  positionalFiles: string[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    sessionId: "",
    auto: false,
    telegraphAlso: false,
    server: "",
    telegraph: false,
    telegraphFiles: false,
    positionalFiles: [],
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--auto":
        result.auto = true;
        break;
      case "--telegraph-also":
        result.telegraphAlso = true;
        break;
      case "--server":
        result.server = args[++i] ?? "http://localhost:4200";
        break;
      case "--session-id":
        result.sessionId = args[++i] ?? "";
        break;
      case "--file":
        result.file = args[++i];
        break;
      case "--text":
        result.text = args[++i];
        break;
      case "--qr":
        result.qr = args[++i];
        break;
      case "--qr-file":
        result.qrFile = args[++i];
        break;
      case "--photo":
        result.photo = args[++i];
        break;
      case "--video":
        result.video = args[++i];
        break;
      case "--audio":
        result.audio = args[++i];
        break;
      case "--caption":
        result.caption = args[++i];
        break;
      case "--telegraph":
        result.telegraph = true;
        break;
      case "--telegraph-files":
        result.telegraphFiles = true;
        break;
      case "--title":
        result.title = args[++i];
        break;
      case "--body":
        result.body = args[++i];
        break;
      case "--response-file":
        result.responseFile = args[++i];
        break;
      case "--response-text":
        result.responseText = args[++i];
        break;
      case "--reply-to":
        result.replyTo = Number(args[++i]);
        break;
      default:
        if (!args[i].startsWith("--")) {
          result.positionalFiles.push(args[i]);
        }
    }
  }

  return result;
}

// ---- target lookup ----

interface Target {
  chatId: number;
  messageThreadId: number | null;
  token: string;
  sessionId: string;
  directory?: string;
}

function lookupTargetBySession(sessionId: string): Target {
  return execLookup(sessionId);
}

function lookupTargetAuto(): Target {
  // Check /tmp/tg-current-chat.json cache first (written by current-chat.ts)
  const cacheFile = "/tmp/tg-current-chat.json";
  try {
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const isFresh = Date.now() - stat.mtimeMs < 60 * 60 * 1000; // 1 hour TTL
      if (isFresh) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as {
          chatId: number;
          messageThreadId: number | null;
          sessionId: string;
        };
        if (cached.chatId && cached.sessionId) {
          // Resolve cached sessionId to get token
          try {
            const target = execLookup(cached.sessionId);
            return target;
          } catch { /* cache miss, fall through to --auto */ }
        }
      }
    }
  } catch { /* ignore cache errors */ }
  return execLookup("--auto");
}

function execLookup(arg: string): Target {
  const lookupScript = path.resolve(__dirname, "tg-chat-lookup.ts");
  let output: string;
  try {
    output = execSync(`npx tsx "${lookupScript}" ${arg}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const stderr = e.stderr?.toString() ?? "";
    for (const line of stderr.split("\n")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) throw new Error(parsed.error);
      } catch (innerErr) {
        if (innerErr instanceof SyntaxError) continue;
        throw innerErr;
      }
    }
    throw new Error(`tg-chat-lookup failed: ${e.message ?? String(err)}`);
  }

  const lines = output.trim().split("\n");
  let parsed: Target | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      parsed = JSON.parse(lines[i]) as Target;
      break;
    } catch {
      continue;
    }
  }
  if (!parsed)
    throw new Error(`tg-chat-lookup produced no valid JSON: ${output.slice(0, 200)}`);

  // Prefer .env token over settings.db token (settings.db may be stale)
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken && envToken !== parsed.token) {
    parsed.token = envToken;
  }

  if (!parsed.token) {
    throw new Error("TELEGRAM_BOT_TOKEN not found in .env");
  }

  return parsed;
}

// ---- Bot API helpers ----

const PHOTO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".flac", ".ogg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm"]);

function detectMediaType(filePath: string): "photo" | "video" | "audio" | "document" {
  const ext = path.extname(filePath).toLowerCase();
  if (PHOTO_EXTENSIONS.has(ext)) return "photo";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "document";
}

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(base);
}

function codeLang(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const map: Record<string, string> = {
    js: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript", jsx: "javascript",
    py: "python", rb: "ruby", rs: "rust", go: "go",
    java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    css: "css", scss: "scss", less: "less",
    html: "html", htm: "html", xml: "xml", svg: "xml",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    sql: "sql", graphql: "graphql", gql: "graphql",
    sh: "bash", bash: "bash", zsh: "bash",
    md: "markdown", markdown: "markdown",
    vue: "html", svelte: "html",
  };
  return map[ext] ?? "";
}

function apiUrlBase(target: Target): string {
  const envRoot = process.env.TELEGRAM_API_ROOT?.replace(/\/+$/, "") ?? "";
  return envRoot || "https://api.telegram.org";
}

function chatTarget(target: Target): Record<string, string> {
  const params: Record<string, string> = {
    chat_id: String(target.chatId),
  };
  if (target.messageThreadId && target.messageThreadId > 0) {
    params.message_thread_id = String(target.messageThreadId);
  }
  return params;
}

function formBase(target: Target, cli: CliArgs): Record<string, string> {
  const params: Record<string, string> = {
    chat_id: String(target.chatId),
  };
  if (target.messageThreadId && target.messageThreadId > 0) {
    params.message_thread_id = String(target.messageThreadId);
  }
  if (cli.replyTo && cli.replyTo > 0) {
    params.reply_to_message_id = String(cli.replyTo);
  }
  return params;
}

function appendFormFields(form: FormData, fields: Record<string, string>): void {
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
}

function sendMessage(
  target: Target,
  text: string,
  opts?: { disableLinkPreview?: boolean; replyTo?: number },
): Promise<{ message_id: number }> {
  return sendMessageRaw(target, text, opts);
}

async function sendMessageRaw(
  target: Target,
  text: string,
  opts?: { disableLinkPreview?: boolean; replyTo?: number },
): Promise<{ message_id: number }> {
  const params: Record<string, string> = {
    ...chatTarget(target),
    text,
    parse_mode: "HTML",
  };
  if (opts?.disableLinkPreview !== false) {
    params.link_preview_options = JSON.stringify({ is_disabled: true });
  }
  if (opts?.replyTo && opts.replyTo > 0) {
    params.reply_to_message_id = String(opts.replyTo);
  }

  const response = await fetch(
    `${apiUrlBase(target)}/bot${target.token}/sendMessage`,
    { method: "POST", body: new URLSearchParams(params) },
  );

  const json = (await response.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!json.ok) throw new Error(`sendMessage failed: ${json.description ?? "unknown"}`);
  return json.result ?? { message_id: 0 };
}

async function sendDocument(
  target: Target,
  filePath: string,
  caption?: string,
  replyTo?: number,
): Promise<{ message_id: number }> {
  const fileName = path.basename(filePath);
  const stat = fs.statSync(filePath);

  if (stat.size > MAX_BOT_API_FILE_SIZE) {
    throw new Error(
      `File "${fileName}" is ${(stat.size / 1024 / 1024).toFixed(1)}MB (max: 50MB). Use --telegraph-files for large files.`,
    );
  }

  const formData = new FormData();
  appendFormFields(formData, { chat_id: String(target.chatId) });
  if (target.messageThreadId && target.messageThreadId > 0) {
    formData.append("message_thread_id", String(target.messageThreadId));
  }
  if (replyTo && replyTo > 0) {
    formData.append("reply_to_message_id", String(replyTo));
  }
  formData.append("document", new Blob([fs.readFileSync(filePath)]), fileName);
  const finalCaption =
    caption ||
    `<code>${escapeHtml(fileName)}</code>\n${(stat.size / 1024).toFixed(1)} KB`;
  formData.append("caption", finalCaption.slice(0, MAX_CAPTION_LENGTH));
  formData.append("parse_mode", "HTML");

  const response = await fetch(
    `${apiUrlBase(target)}/bot${target.token}/sendDocument`,
    { method: "POST", body: formData },
  );

  const json = (await response.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!json.ok) throw new Error(`sendDocument failed: ${json.description ?? "unknown"}`);
  return json.result ?? { message_id: 0 };
}

async function sendPhoto(
  target: Target,
  filePath: string,
  caption?: string,
  replyTo?: number,
): Promise<{ message_id: number }> {
  const fileName = path.basename(filePath);
  const formData = new FormData();
  appendFormFields(formData, { chat_id: String(target.chatId) });
  if (target.messageThreadId && target.messageThreadId > 0) {
    formData.append("message_thread_id", String(target.messageThreadId));
  }
  if (replyTo && replyTo > 0) {
    formData.append("reply_to_message_id", String(replyTo));
  }
  formData.append("photo", new Blob([fs.readFileSync(filePath)]), fileName);
  if (caption) {
    formData.append("caption", caption.slice(0, MAX_CAPTION_LENGTH));
  }
  formData.append("parse_mode", "HTML");

  const response = await fetch(
    `${apiUrlBase(target)}/bot${target.token}/sendPhoto`,
    { method: "POST", body: formData },
  );

  const json = (await response.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!json.ok) throw new Error(`sendPhoto failed: ${json.description ?? "unknown"}`);
  return json.result ?? { message_id: 0 };
}

async function sendVideo(
  target: Target,
  filePath: string,
  caption?: string,
  replyTo?: number,
): Promise<{ message_id: number }> {
  const fileName = path.basename(filePath);
  const formData = new FormData();
  appendFormFields(formData, { chat_id: String(target.chatId) });
  if (target.messageThreadId && target.messageThreadId > 0) {
    formData.append("message_thread_id", String(target.messageThreadId));
  }
  if (replyTo && replyTo > 0) {
    formData.append("reply_to_message_id", String(replyTo));
  }
  formData.append("video", new Blob([fs.readFileSync(filePath)]), fileName);
  if (caption) {
    formData.append("caption", caption.slice(0, MAX_CAPTION_LENGTH));
  }
  formData.append("parse_mode", "HTML");

  const response = await fetch(
    `${apiUrlBase(target)}/bot${target.token}/sendVideo`,
    { method: "POST", body: formData },
  );

  const json = (await response.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!json.ok) throw new Error(`sendVideo failed: ${json.description ?? "unknown"}`);
  return json.result ?? { message_id: 0 };
}

async function sendAudio(
  target: Target,
  filePath: string,
  caption?: string,
  replyTo?: number,
): Promise<{ message_id: number }> {
  const fileName = path.basename(filePath);
  const formData = new FormData();
  appendFormFields(formData, { chat_id: String(target.chatId) });
  if (target.messageThreadId && target.messageThreadId > 0) {
    formData.append("message_thread_id", String(target.messageThreadId));
  }
  if (replyTo && replyTo > 0) {
    formData.append("reply_to_message_id", String(replyTo));
  }
  formData.append("audio", new Blob([fs.readFileSync(filePath)]), fileName);
  if (caption) {
    formData.append("caption", caption.slice(0, MAX_CAPTION_LENGTH));
  }
  formData.append("parse_mode", "HTML");

  const response = await fetch(
    `${apiUrlBase(target)}/bot${target.token}/sendAudio`,
    { method: "POST", body: formData },
  );

  const json = (await response.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
  if (!json.ok) throw new Error(`sendAudio failed: ${json.description ?? "unknown"}`);
  return json.result ?? { message_id: 0 };
}

async function uploadFile(
  target: Target,
  filePath: string,
  caption?: string,
  replyTo?: number,
): Promise<void> {
  const type = detectMediaType(filePath);
  switch (type) {
    case "photo":
      await sendPhoto(target, filePath, caption, replyTo);
      break;
    case "video":
      await sendVideo(target, filePath, caption, replyTo);
      break;
    case "audio":
      await sendAudio(target, filePath, caption, replyTo);
      break;
    default:
      await sendDocument(target, filePath, caption, replyTo);
  }
}

// ---- Telegraph helpers ----

function telegraphConfig() {
  return {
    accessToken: process.env.TELEGRAPH_ACCESS_TOKEN || "",
    authorName: process.env.TELEGRAPH_AUTHOR_NAME || "opencode-tg",
    maxChars: parseInt(process.env.TELEGRAPH_MAX_CHARS || "25000", 10),
  };
}

function wrapInCodeFence(body: string, lang: string): string {
  if (!lang) return body;
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

function buildTelegraphNodes(text: string, lang: string): object[] {
  // Convert text to Telegraph DOM nodes: code block if lang, else paragraphs.
  if (lang && CODE_EXTENSIONS.has(`.${lang}`)) {
    const truncated =
      text.length > 60000 ? text.slice(0, 59997) + "\n[truncated]" : text;
    return [{ tag: "pre", children: [{ tag: "code", children: [truncated] }] }];
  }

  // For markdown, just wrap in <pre> for now (Telegraph doesn't render markdown natively)
  if (lang === "markdown" || lang === "md") {
    const truncated =
      text.length > 60000 ? text.slice(0, 59997) + "\n[truncated]" : text;
    return [{ tag: "pre", children: [truncated] }];
  }

  // Plain text: split into paragraphs
  const truncated =
    text.length > 60000 ? text.slice(0, 59997) + "\n[truncated]" : text;
  const paras = truncated.split(/\n{2,}/);
  return paras.map((p) => ({
    tag: "p" as const,
    children: [p.trim()],
  }));
}

async function publishTelegraph(title: string, body: string, lang: string): Promise<string> {
  const cfg = telegraphConfig();
  if (!cfg.accessToken) {
    throw new Error("TELEGRAPH_ACCESS_TOKEN not set. Set it in .env to use Telegraph.");
  }

  const safeTitle = title.length > 256 ? title.slice(0, 253) + "..." : title;
  const nodes = buildTelegraphNodes(body, lang);

  const params = new URLSearchParams();
  params.set("access_token", cfg.accessToken);
  params.set("title", safeTitle);
  params.set("author_name", cfg.authorName);
  params.set("content", JSON.stringify(nodes));
  params.set("return_content", "false");

  const response = await fetch("https://api.telegra.ph/createPage", {
    method: "POST",
    body: params,
  });

  const json = (await response.json()) as {
    ok: boolean;
    error?: string;
    result?: { url?: string };
  };

  if (!json.ok || !json.result?.url) {
    throw new Error(`Telegraph publish failed: ${json.error ?? "unknown"}`);
  }

  return json.result.url;
}

async function sendTelegraphLink(
  target: Target,
  title: string,
  body: string,
  lang: string,
): Promise<string> {
  const url = await publishTelegraph(title, body, lang);
  await sendMessage(target, `<b>${escapeHtml(title)}</b>\n<a href="${url}">Read on Telegraph</a>`);
  return url;
}

async function publishFileAsTelegraph(
  target: Target,
  filePath: string,
  serverBaseUrl?: string,
): Promise<string | null> {
  const cfg = telegraphConfig();
  if (!cfg.accessToken) {
    console.error("Warning: TELEGRAPH_ACCESS_TOKEN not set — skipping Telegraph upload");
    return null;
  }

  const fileName = path.basename(filePath);
  const title = `📄 ${fileName}`;

  // If we have a local server, use it to embed the file
  if (serverBaseUrl) {
    const rawUrl = `${serverBaseUrl.replace(/\/+$/, "")}/raw?p=${encodeURIComponent(filePath)}`;
    let nodes: object[];
    const ext = path.extname(filePath).toLowerCase();

    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
      nodes = [
        { tag: "h3", children: [fileName] },
        { tag: "figure", children: [
          { tag: "img", attrs: { src: rawUrl } },
          { tag: "figcaption", children: [fileName] },
        ]},
        { tag: "p", children: [`Size: ${(fs.statSync(filePath).size / 1024).toFixed(1)} KB`] },
      ];
    } else if ([".mp4", ".webm", ".mov"].includes(ext)) {
      nodes = [
        { tag: "h3", children: [fileName] },
        { tag: "figure", children: [
          { tag: "video", attrs: { src: rawUrl } },
          { tag: "figcaption", children: [fileName] },
        ]},
      ];
    } else if ([".mp3", ".wav", ".ogg", ".flac"].includes(ext)) {
      nodes = [
        { tag: "h3", children: [fileName] },
        { tag: "p", children: [`🎵 <a href="${rawUrl}">${fileName}</a>`] },
      ];
    } else if (isTextFile(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lang = codeLang(filePath);
      return publishTelegraph(title, content, lang);
    } else {
      nodes = [
        { tag: "h3", children: [fileName] },
        { tag: "p", children: [`📎 <a href="${rawUrl}">Download ${fileName}</a>`] },
      ];
    }

    const cfg2 = telegraphConfig();
    const params = new URLSearchParams();
    params.set("access_token", cfg2.accessToken);
    params.set("title", title.length > 256 ? title.slice(0, 253) + "..." : title);
    params.set("author_name", cfg2.authorName);
    params.set("content", JSON.stringify(nodes));
    params.set("return_content", "false");

    const response = await fetch("https://api.telegra.ph/createPage", {
      method: "POST", body: params,
    });
    const json = (await response.json()) as { ok: boolean; error?: string; result?: { url?: string } };
    if (!json.ok || !json.result?.url)
      throw new Error(`Telegraph publish failed: ${json.error ?? "unknown"}`);
    return json.result.url;
  }

  // Without server: publish text content
  const content = fs.readFileSync(filePath, "utf-8");
  const lang = codeLang(filePath);
  return await publishTelegraph(title, content, lang);
}

function buildTelegraphCaption(fileName: string, telegraphUrl: string, filePath: string): string {
  const escaped = escapeHtml(fileName);
  const size = (fs.statSync(filePath).size / 1024).toFixed(1);
  return `<b>📄 <a href="${telegraphUrl}">${escaped}</a></b>\n${size} KB — <a href="${telegraphUrl}">View on Telegraph</a>`;
}

// ---- QR code generation ----

async function generateQrCode(data: string): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), `tg-qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const qrPath = path.join(tmpDir, `qr-${Date.now()}.png`);
  await QRCode.toFile(qrPath, data, {
    type: "png",
    width: 512,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return qrPath;
}

// ---- multi-file zip helper ----

function createZipSync(filePaths: string[], targetDir: string): string {
  const zipName = `files-${Date.now()}.zip`;
  const zipPath = path.join(targetDir, zipName);
  const files = filePaths.map((f) => `"${f}"`).join(" ");
  execSync(`zip -j "${zipPath}" ${files}`, { encoding: "utf-8", stdio: "ignore" });
  return zipPath;
}

async function sendTelegraphFiles(
  target: Target,
  title: string,
  filePaths: string[],
): Promise<void> {
  const fileList = filePaths
    .map((p) => {
      const name = path.basename(p);
      const size = fs.statSync(p).size;
      return `- <code>${escapeHtml(name)}</code> (${(size / 1024).toFixed(1)} KB)`;
    })
    .join("\n");

  const body = `<b>Files:</b>\n${fileList}\n\n<i>Use /download or request individual delivery.</i>`;
  await sendTelegraphLink(target, title, body, "");

  try {
    const tmpDir = path.join(os.tmpdir(), `tg-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const totalSize = filePaths.reduce((sum, p) => sum + fs.statSync(p).size, 0);
    if (totalSize < MAX_BOT_API_FILE_SIZE) {
      const zipPath = createZipSync(filePaths, tmpDir);
      await sendDocument(
        target,
        zipPath,
        `ZIP: ${escapeHtml(title)} (${filePaths.length} files)`,
      );
      fs.rmSync(zipPath, { force: true });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Zip delivery skipped: ${err}`);
  }
}

// ---- utilities ----

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

async function buildFileCaption(
  target: Target,
  filePath: string,
  responseText: string,
  userCaption?: string,
): Promise<string> {
  const fileName = path.basename(filePath);
  const size = (fs.statSync(filePath).size / 1024).toFixed(1);
  const fileInfo = `<code>${escapeHtml(fileName)}</code> (${size} KB)`;

  // Short response: send as caption together with file
  if (responseText.length <= 700) {
    const combined = userCaption
      ? `${fileInfo}\n\n${responseText}\n\n${userCaption}`
      : `${fileInfo}\n\n${responseText}`;
    return combined.slice(0, MAX_CAPTION_LENGTH);
  }

  // Long response: publish to Telegraph, link in caption
  const telegraphTitle = `📄 ${fileName}`;
  const telegraphBody = userCaption
    ? `# ${fileName}\n\n${stripHtml(responseText)}\n\n---\n${stripHtml(userCaption)}`
    : `# ${fileName}\n\n${stripHtml(responseText)}`;

  try {
    const url = await publishTelegraph(telegraphTitle, telegraphBody, "markdown");
    return `${fileInfo}\n\n<a href="${url}">📖 Читать полный ответ на Telegraph</a>`;
  } catch {
    // Telegraph failed: truncate and send as plain caption
    const fallback = truncate(stripHtml(responseText), 600);
    return userCaption
      ? `${fileInfo}\n\n${fallback}\n\n${userCaption}`
      : `${fileInfo}\n\n${fallback}`;
  }
}

function assertFile(p: string): void {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  if (!fs.statSync(p).isFile()) throw new Error(`Not a file: ${p}`);
}

// ---- main ----

async function main(): Promise<void> {
  const args = parseArgs();

  // Load .env so process.env.TELEGRAM_BOT_TOKEN is available
  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    dotenvConfig({ path: envPath, override: true });
  }

  let target: Target;
  if (args.auto && !args.sessionId) {
    // Auto-detect: check /tmp/tg-current-chat.json cache first, then settings.db
    try {
      target = lookupTargetAuto();
    } catch (err: unknown) {
      console.error(`Auto-detection failed: ${(err as Error).message}`);
      process.exit(1);
    }
  } else if (args.sessionId) {
    target = lookupTargetBySession(args.sessionId);
  } else {
    console.error("Error: --session-id is required (or use --auto)");
    process.exit(1);
  }

  try {
    // Telegraph-only mode
    if (args.telegraph) {
      if (!args.title || !args.body) {
        console.error("Error: --telegraph requires --title and --body");
        process.exit(1);
      }
      await sendTelegraphLink(target, args.title, args.body, "");
      console.log(`Telegraph link sent to chat ${target.chatId}`);
      process.exit(0);
    }

    // Telegraph files mode
    if (args.telegraphFiles) {
      const filePaths = args.positionalFiles;
      if (filePaths.length === 0) {
        console.error("Error: --telegraph-files requires at least one file path");
        process.exit(1);
      }
      const title = args.title || `Files (${filePaths.length})`;
      await sendTelegraphFiles(target, title, filePaths);
      console.log(`Telegraph article + files sent to chat ${target.chatId}`);
      process.exit(0);
    }

    // QR code generation
    if (args.qr || args.qrFile) {
      let data: string;
      if (args.qr) {
        data = args.qr;
      } else {
        assertFile(args.qrFile!);
        data = fs.readFileSync(args.qrFile!, "utf-8").trim();
      }
      const qrPath = await generateQrCode(data);
      const preview = data.length > 60 ? data.slice(0, 57) + "..." : data;
      await sendPhoto(target, qrPath, `<code>${escapeHtml(preview)}</code>`, args.replyTo);
      fs.unlinkSync(qrPath);
      fs.rmdirSync(path.dirname(qrPath));
      console.log(`QR code sent to chat ${target.chatId}`);
      process.exit(0);
    }

    // Text message
    if (args.text) {
      await sendMessage(target, args.text, { replyTo: args.replyTo });
      console.log(`Message sent to chat ${target.chatId}`);
      process.exit(0);
    }

    // File upload (auto-detect type)
    const filePath = args.file || args.photo || args.video || args.audio;
    if (filePath) {
      assertFile(filePath);

      // Read response text from --response-file or --response-text
      let responseText = args.responseText || "";
      if (args.responseFile) {
        responseText = fs.readFileSync(args.responseFile, "utf-8").trim();
      }

      // Build caption: file info + response text (or Telegraph link)
      let caption: string | undefined;
      if (responseText) {
        caption = await buildFileCaption(target, filePath, responseText, args.caption);
      } else if (args.telegraphAlso && isTextFile(filePath)) {
        const telegraphUrl = await publishFileAsTelegraph(target, filePath, args.server || undefined);
        caption = telegraphUrl
          ? buildTelegraphCaption(path.basename(filePath), telegraphUrl, filePath)
          : args.caption;
      } else {
        caption = args.caption;
      }

      await uploadFile(target, filePath, caption, args.replyTo);
      console.log(`File "${path.basename(filePath)}" sent to chat ${target.chatId}`);
      process.exit(0);
    }

    console.error("Error: specify --file, --text, --telegraph, or --telegraph-files");
    process.exit(1);
  } catch (err: unknown) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
