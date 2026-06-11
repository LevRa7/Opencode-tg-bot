import { logger } from "../utils/logger.js";
import type { TelegraphKeyPool } from "./key-pool.js";
import type { createFileArchiveRepository } from "../settings/repositories/file-archive.js";
import { createHash } from "crypto";

type FileArchiveRepo = ReturnType<typeof createFileArchiveRepository>;

interface ParsedHunk {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  lines: Array<{ kind: "add" | "del" | "ctx"; text: string }>;
}

interface ChangeRecord {
  sessionId: string | null;
  description: string | null;
  oldStart: number | null;
  oldEnd: number | null;
  newStart: number | null;
  newEnd: number | null;
  createdAt: number;
}

const ARTICLE_SIZE_LIMIT = 60_000;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseUnifiedDiff(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  for (const line of diff.split("\n")) {
    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkMatch) {
      if (current) hunks.push(current);
      current = {
        oldStart: parseInt(hunkMatch[1]!, 10),
        oldEnd: parseInt(hunkMatch[1]!, 10) + (parseInt(hunkMatch[2] || "1", 10) - 1),
        newStart: parseInt(hunkMatch[3]!, 10),
        newEnd: parseInt(hunkMatch[3]!, 10) + (parseInt(hunkMatch[4] || "1", 10) - 1),
        lines: [],
      };
    } else if (current) {
      if (line.startsWith("+")) current.lines.push({ kind: "add", text: line.slice(1) });
      else if (line.startsWith("-")) current.lines.push({ kind: "del", text: line.slice(1) });
      else if (line.startsWith(" ") || line === "") current.lines.push({ kind: "ctx", text: line.slice(1) || "" });
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function applyDiff(currentContent: string, hunks: ParsedHunk[]): string {
  const lines = currentContent.split("\n");
  const newLines: string[] = [];
  let lineIdx = 0;
  let hunkIdx = 0;

  while (lineIdx < lines.length || hunkIdx < hunks.length) {
    const hunk = hunks[hunkIdx];
    const hunkSrcEnd = hunk?.oldStart ? hunk.oldStart - 1 : -1;

    while (hunkSrcEnd > -1 && lineIdx < hunkSrcEnd && lineIdx < lines.length) {
      newLines.push(lines[lineIdx]!);
      lineIdx++;
    }

    if (!hunk) {
      while (lineIdx < lines.length) { newLines.push(lines[lineIdx]!); lineIdx++; }
      break;
    }

    for (const hl of hunk.lines) {
      if (hl.kind === "ctx") { newLines.push(hl.text); lineIdx++; }
      else if (hl.kind === "del") { lineIdx++; }
      else if (hl.kind === "add") { newLines.push(hl.text); }
    }
    hunkIdx++;
  }
  return newLines.join("\n");
}

function buildTelegraphArticleBody(filePath: string, content: string, changes: ChangeRecord[]): string {
  const lines = content.split("\n");
  const parts: string[] = [];

  parts.push(`<h3>${escapeXml(filePath)}</h3>`);
  const lastUpdated = changes.length > 0
    ? new Date(changes[0]!.createdAt).toISOString().replace("T", " ").slice(0, 19)
    : "—";
  parts.push(`<p><i>Last updated: ${lastUpdated} UTC · Total changes: ${changes.length}</i></p>`);
  parts.push("<hr/>");

  const changeMap = new Map<number, ChangeRecord>();
  for (const ch of changes) {
    if (ch.newStart) {
      for (let i = ch.newStart; i <= (ch.newEnd ?? ch.newStart); i++) {
        if (!changeMap.has(i)) {
          changeMap.set(i, ch);
        }
      }
    }
  }

  let inBlockquote = false;
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const change = changeMap.get(lineNum);
    const line = lines[i]!;

    if (change && !inBlockquote) {
      if (parts.length > 2) parts.push("</blockquote>");
      const dateStr = new Date(change.createdAt).toISOString().replace("T", " ").slice(0, 19);
      const desc = change.description ?? "Change";
      parts.push(`<blockquote>📅 ${dateStr}<br/>`);
      parts.push(`<b><code>${escapeXml(line)}</code></b><br/>`);
      parts.push(`<i>${escapeXml(desc)}</i><br/>`);
      inBlockquote = true;
    } else if (!change && inBlockquote) {
      parts.push(`<code>${escapeXml(line)}</code>`);
      const nextLineHasChange = (i + 1 < lines.length) && changeMap.has(lineNum + 1);
      if (!nextLineHasChange) {
        parts.push("</blockquote>");
        inBlockquote = false;
      }
    } else if (change && inBlockquote) {
      parts.push(`<code>${escapeXml(line)}</code>`);
    } else {
      parts.push(`<code>${escapeXml(line)}</code>`);
    }
  }
  if (inBlockquote) parts.push("</blockquote>");

  const full = parts.join("\n");
  if (full.length > ARTICLE_SIZE_LIMIT) {
    return full.slice(0, ARTICLE_SIZE_LIMIT - 100) + "\n<p><i>[truncated — use /open to view full file]</i></p>";
  }
  return full;
}

export class FileDiffLogger {
  private mutexes = new Map<string, Promise<void>>();
  private readonly maxMutexEntries = 500;

  constructor(
    private readonly keyPool: TelegraphKeyPool,
    private readonly archiveRepo: FileArchiveRepo,
  ) {}

  async logDiff(
    userId: number,
    sessionId: string,
    filePath: string,
    diffContent: string,
    description?: string,
  ): Promise<string | null> {
    return this.withMutex(filePath, async () => {
      if (!diffContent || diffContent.trim().length === 0) return null;

      // Binary diff detection
      if (diffContent.startsWith("Binary files")) {
        logger.debug(`[FileDiffLogger] Skipping binary diff for ${filePath}`);
        return null;
      }

      const hunks = parseUnifiedDiff(diffContent);
      if (hunks.length === 0) {
        logger.debug(`[FileDiffLogger] No parseable hunks in diff for ${filePath}`);
        return null;
      }

      // Get or initialize file archive
      let archive = this.archiveRepo.get(filePath);
      let currentContent: string;
      if (archive) {
        currentContent = archive.content;
      } else {
        const { promises: fs } = await import("fs");
        try {
          currentContent = await fs.readFile(filePath, "utf-8");
        } catch {
          logger.warn(`[FileDiffLogger] Cannot read file for archiving: ${filePath}`);
          return null;
        }
      }

      // Apply diff
      let newContent: string;
      try {
        newContent = applyDiff(currentContent, hunks);
      } catch {
        logger.warn(`[FileDiffLogger] Failed to apply diff to ${filePath}`);
        newContent = currentContent;
      }

      const lineCount = newContent.split("\n").length;
      this.archiveRepo.upsert({
        file_path: filePath,
        content: newContent,
        content_hash: hashContent(newContent),
        line_count: lineCount,
      });

      // Build ChangeRecord from hunks
      const createdAt = Date.now();
      const changes: ChangeRecord[] = [
        {
          sessionId,
          description: description ?? null,
          oldStart: hunks[0]?.oldStart ?? null,
          oldEnd: hunks[hunks.length - 1]?.oldEnd ?? null,
          newStart: hunks[0]?.newStart ?? null,
          newEnd: hunks[hunks.length - 1]?.newEnd ?? null,
          createdAt,
        },
      ];

      // Build and publish Telegraph article
      const body = buildTelegraphArticleBody(filePath, newContent, changes);
      const title = `📄 ${filePath}`;

      try {
        const key = this.keyPool.selectKey();
        if (!key) {
          logger.warn(`[FileDiffLogger] No available Telegraph key for ${filePath}`);
          return null;
        }

        if (archive?.telegraph_path) {
          const archiveKeyId = archive.key_id;
          const client = archiveKeyId ? this.keyPool.getClient(archiveKeyId) : null;
          if (client) {
            await client.editPage(archive.telegraph_path, title, body);
          } else {
            const result = await key.client.createPage(title, body);
            if (result) {
              this.archiveRepo.updateTelegraphInfo(filePath, result.url, result.path, key.keyId);
            }
          }
        } else {
          const result = await key.client.createPage(title, body);
          if (result) {
            this.archiveRepo.updateTelegraphInfo(filePath, result.url, result.path, key.keyId);
          }
        }
        return archive?.telegraph_url ?? this.archiveRepo.get(filePath)?.telegraph_url ?? null;
      } catch (err) {
        logger.error("[FileDiffLogger] Failed to publish Telegraph article:", err);
        return null;
      }
    });
  }

  getTelegraphUrl(filePath: string): string | null {
    return this.archiveRepo.get(filePath)?.telegraph_url ?? null;
  }

  reset(): void {
    this.mutexes.clear();
  }

  private async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.mutexes.size >= this.maxMutexEntries) {
      const firstKey = this.mutexes.keys().next().value;
      if (firstKey) this.mutexes.delete(firstKey);
    }
    const prev = this.mutexes.get(key) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.mutexes.set(key, prev.then(() => undefined));
    try {
      await prev;
      return await fn();
    } finally {
      release!();
    }
  }
}
