/**
 * File-backed persistent memory store — Hermes-compatible §-delimited format.
 *
 * Two files:
 *   MEMORY.md — agent's personal notes (environment facts, conventions, tool quirks)
 *   USER.md   — what the agent knows about the user (preferences, style, corrections)
 *
 * Character limits (Hermes defaults):
 *   memory: 2,200 chars
 *   user:   1,375 chars
 *
 * Format:
 *   Entries separated by "\n§\n" (section sign on its own line)
 *   Atomic writes via temp file + fs.rename()
 *   SHA-256 checksums for drift detection
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";

// ── Constants ───────────────────────────────────────────────

const ENTRY_DELIMITER = "\n§\n";
const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;

// ── Path resolution ─────────────────────────────────────────

function getWorkspaceDir(): string {
  return process.env.OPENCODE_WORKSPACE || "/workspace";
}

function memoryDir(): string {
  return getWorkspaceDir();
}

function filePath(target: "memory" | "user"): string {
  const filename = target === "memory" ? "MEMORY.md" : "USER.md";
  return path.join(memoryDir(), filename);
}

function checksumPath(filepath: string): string {
  return filepath + ".sha256";
}

function charLimit(target: "memory" | "user"): number {
  return target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

// ── Threat patterns ─────────────────────────────────────────

interface ThreatPattern {
  regex: RegExp;
  id: string;
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // System prompt override
  { regex: /<\|im_start\|>system/i, id: "im_start_system" },
  { regex: /<system>.*?<\/system>/is, id: "xml_system_tag" },
  { regex: /\[system note:.*?\]/is, id: "system_note_spoof" },
  { regex: /<\s*?system\s*?>/i, id: "system_tag_isolated" },
  // Tool invocation spoofing
  { regex: /<function_call[>\s]|<invoke\s+name=/i, id: "tool_xml_spoof" },
  { regex: /<\/?memory-context>/i, id: "memory_context_fence" },
  { regex: /<\s*?tools\s*?>/i, id: "tools_tag_spoof" },
  // Conversation boundary manipulation
  { regex: /<\|im_end\|>/i, id: "im_end" },
  { regex: /\[end\s+of\s+(conversation|context|session)\]/i, id: "end_of_spoof" },
  { regex: /NEW\s+CONVERSATION/i, id: "new_conversation_spoof" },
  // Model directive injection
  { regex: /(?:ignore|forget|disregard)\s+(?:\w+\s+){0,3}(?:all\s+)?(?:previous|prior|above)\s+(?:\w+\s+){0,3}(?:instructions?|directives?|constraints?)/i, id: "ignore_previous" },
  { regex: /you\s+are\s+(?:\w+\s+){0,2}now\b/i, id: "you_are_now" },
  { regex: /your\s+new\s+(?:system\s+)?prompt\b/i, id: "new_prompt" },
  { regex: /(?:respond|answer|reply)\s+(?:\w+\s+){0,3}without\s+(?:\w+\s+){0,3}(?:restrictions|limitations|filters|safety)/i, id: "remove_filters" },
  { regex: /pretend\s+(?:\w+\s+){0,3}(?:you\s+are|to\s+be)/i, id: "role_pretend" },
  // Token/prompt leakage
  { regex: /\[INST\].*\[\/INST\]/is, id: "inst_tags" },
  { regex: /<\|user\|>.*<\|assistant\|>/is, id: "user_assistant_boundary" },
  { regex: /output\s+(?:\w+\s+){0,3}(?:system|initial)\s+prompt/i, id: "leak_system_prompt" },
  // Exfiltration
  { regex: /(?:send|post|upload|forward)\s+(?:\w+\s+){0,3}(?:this|my|our)\s+(?:\w+\s+){0,3}(?:conversation|context|memory|prompt|history)/i, id: "exfil_attempt" },
];

function scanContent(content: string): string | null {
  if (!content?.trim()) return null;
  for (const { regex, id } of THREAT_PATTERNS) {
    if (regex.test(content)) {
      return `Content blocked: detected threat pattern '${id}'. The content appears to contain prompt injection or system prompt manipulation. Remove any system-level directives and retry.`;
    }
  }
  return null;
}

// ── File I/O ────────────────────────────────────────────────

function readEntriesRaw(raw: string): string[] {
  if (!raw?.trim()) return [];
  return raw.split(ENTRY_DELIMITER)
    .map(e => e.trim())
    .filter(e => e.length > 0);
}

function readEntries(filepath: string): string[] {
  try {
    return readEntriesRaw(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return [];
  }
}

function formatEntries(entries: string[]): string {
  if (entries.length === 0) return "";
  return entries.join(ENTRY_DELIMITER) + "\n";
}

function writeEntries(filepath: string, entries: string[]): void {
  const dir = path.dirname(filepath);
  fs.mkdirSync(dir, { recursive: true });

  const content = formatEntries(entries);
  const tmpPath = filepath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filepath);

  // Write checksum
  writeChecksum(filepath);
}

// ── Checksums (drift detection) ─────────────────────────────

function computeChecksum(filepath: string): string | null {
  try {
    const data = fs.readFileSync(filepath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

function writeChecksum(filepath: string): void {
  const chk = computeChecksum(filepath);
  if (chk) {
    const cpath = checksumPath(filepath);
    fs.writeFileSync(cpath, chk + "\n", "utf-8");
  }
}

function verifyChecksum(filepath: string): boolean {
  const cpath = checksumPath(filepath);
  if (!fs.existsSync(cpath)) return true; // first write or legacy
  const stored = fs.readFileSync(cpath, "utf-8").trim();
  const current = computeChecksum(filepath);
  return stored === current;
}

function detectExternalDrift(filepath: string): string | null {
  if (!fs.existsSync(filepath)) return null;
  if (!verifyChecksum(filepath)) {
    const ts = Math.floor(Date.now() / 1000);
    const bakPath = filepath + ".bak." + ts;
    fs.renameSync(filepath, bakPath);
    return bakPath;
  }
  return null;
}

// ── Core CRUD ───────────────────────────────────────────────

export interface MemoryResult {
  success: boolean;
  done?: boolean;
  target?: string;
  error?: string;
  usage?: string;
  entry_count?: number;
  current_entries?: string[];
  drift_backup?: string;
  removed?: string;
  message?: string;
  note?: string;
}

export interface BatchOp {
  action: "add" | "replace" | "remove";
  content?: string;
  old_text?: string;
}

export function memoryAdd(
  target: "memory" | "user",
  content: string = "",
  operations?: BatchOp[],
): MemoryResult {
  // Batch mode
  if (operations) {
    return applyBatch(target, operations);
  }

  // Single add
  content = content.trim();
  if (!content) return { success: false, error: "Content cannot be empty." };

  const scanErr = scanContent(content);
  if (scanErr) return { success: false, error: scanErr };

  const fp = filePath(target);
  const bak = detectExternalDrift(fp);
  if (bak) {
    return {
      success: false,
      error: `Refusing to write ${path.basename(fp)}: file on disk was modified externally (patch tool, shell append, or concurrent session). Snapshot saved to ${bak}. Resolve the drift first.`,
      drift_backup: bak,
    };
  }

  const entries = readEntries(fp);
  const limit = charLimit(target);
  entries.push(content);
  // Deduplicate
  const unique = [...new Set(entries)];
  const current = unique.reduce((sum, e) => sum + e.length, 0);

  if (current > limit) {
    const pct = Math.min(100, Math.floor((current / limit) * 100));
    return {
      success: false,
      error: `Memory at ${current.toLocaleString()}/${limit.toLocaleString()} chars (${pct}%). Adding this entry (${content.length} chars) would exceed the limit. Consolidate now: use operations=[...] to merge overlapping entries into shorter ones or remove stale entries (see current_entries below), then retry — all in one call.`,
      current_entries: unique,
      usage: `${current.toLocaleString()}/${limit.toLocaleString()}`,
    };
  }

  writeEntries(fp, unique);
  const pct = Math.min(100, Math.floor((current / limit) * 100));
  return {
    success: true,
    done: true,
    target,
    usage: `${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars`,
    entry_count: unique.length,
    note: "Write saved. This update is complete — do not repeat it.",
  };
}

export function memorySearch(query: string): { matches: Array<{ source: string; text: string }>; count: number; query: string } {
  const results: Array<{ source: string; text: string }> = [];
  for (const tgt of ["memory", "user"] as const) {
    const fp = filePath(tgt);
    const entries = readEntries(fp);
    entries.forEach((entry, i) => {
      if (entry.toLowerCase().includes(query.toLowerCase())) {
        results.push({ source: `${tgt}#${i}`, text: entry.slice(0, 500) });
      }
    });
  }
  return { matches: results.slice(0, 10), count: results.length, query };
}

export function memoryRemove(target: "memory" | "user", oldText: string): MemoryResult {
  const fp = filePath(target);
  const bak = detectExternalDrift(fp);
  if (bak) {
    return { success: false, error: "External drift detected. Resolve and retry.", drift_backup: bak };
  }

  const entries = readEntries(fp);
  const limit = charLimit(target);
  const oldLower = oldText.toLowerCase().trim();
  const matches = entries
    .map((e, i) => (e.toLowerCase().includes(oldLower) ? i : -1))
    .filter(i => i >= 0);

  if (matches.length === 0) {
    return { success: false, error: `No entry matching '${oldText.slice(0, 80)}' found in ${target}.`, entry_count: entries.length };
  }
  if (matches.length > 1) {
    const unique = [...new Set(matches.map(i => entries[i]))];
    if (unique.length > 1) {
      return {
        success: false,
        error: `Multiple entries (${matches.length}) match '${oldText.slice(0, 80)}'. Use a more specific substring.`,
        current_entries: matches.map(i => entries[i].slice(0, 120)),
      };
    }
  }

  const removed = entries.splice(matches[0], 1)[0];
  writeEntries(fp, entries);
  const current = entries.reduce((sum, e) => sum + e.length, 0);
  const pct = Math.min(100, Math.floor((current / limit) * 100));
  return {
    success: true,
    done: true,
    target,
    removed: removed.slice(0, 200),
    usage: `${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars`,
    entry_count: entries.length,
  };
}

export function memoryShow(target?: "memory" | "user" | ""): Record<string, { entries: string[]; count: number; usage: string }> {
  const targets: Array<"memory" | "user"> = (target && target !== "") ? [target as "memory" | "user"] : ["memory", "user"];
  const result: Record<string, { entries: string[]; count: number; usage: string }> = {};

  for (const tgt of targets) {
    const fp = filePath(tgt);
    const entries = readEntries(fp);
    const limit = charLimit(tgt);
    const current = entries.reduce((sum, e) => sum + e.length, 0);
    const pct = Math.min(100, Math.floor((current / limit) * 100));
    result[tgt] = {
      entries,
      count: entries.length,
      usage: `${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars`,
    };
  }
  return result;
}

// ── Batch operations ────────────────────────────────────────

function applyBatch(target: "memory" | "user", operations: BatchOp[]): MemoryResult {
  if (!operations?.length) return { success: false, error: "operations list is empty." };

  // Phase 1: Scan all add/replace content for threats
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.action === "add" || op.action === "replace") {
      if (!op.content?.trim() && op.action === "add") {
        return { success: false, error: `Operation ${i + 1}: content required for add.` };
      }
      if (op.content) {
        const scanErr = scanContent(op.content);
        if (scanErr) {
          return { success: false, error: `Operation ${i + 1}: ${scanErr}` };
        }
      }
    }
  }

  // Phase 2: Drift check
  const fp = filePath(target);
  const bak = detectExternalDrift(fp);
  if (bak) {
    return { success: false, error: "External drift detected. Resolve and retry.", drift_backup: bak };
  }

  // Phase 3: Load and apply
  const entries = readEntries(fp);
  const working: string[] = [...entries];
  const limit = charLimit(target);

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const content = (op.content || "").trim();
    const oldText = (op.old_text || "").trim();
    const pos = `Operation ${i + 1}`;

    if (op.action === "add") {
      if (!content) return { success: false, error: `${pos}: content is required.` };
      if (!working.includes(content)) working.push(content);
    } else if (op.action === "replace") {
      if (!oldText) return { success: false, error: `${pos}: old_text is required.` };
      if (!content) return { success: false, error: `${pos}: content is required.` };
      const oldLower = oldText.toLowerCase();
      const matches = working.map((e, j) => e.toLowerCase().includes(oldLower) ? j : -1).filter(j => j >= 0);
      if (matches.length === 0) return { success: false, error: `${pos}: no entry matching '${oldText.slice(0, 60)}'.` };
      const uniqueTexts = new Set(matches.map(j => working[j]));
      if (uniqueTexts.size > 1) {
        return { success: false, error: `${pos}: multiple entries matched '${oldText.slice(0, 60)}'. Be more specific.`, current_entries: matches.map(j => working[j].slice(0, 80)) };
      }
      working[matches[0]] = content;
    } else if (op.action === "remove") {
      if (!oldText) return { success: false, error: `${pos}: old_text is required.` };
      const oldLower = oldText.toLowerCase();
      const matches = working.map((e, j) => e.toLowerCase().includes(oldLower) ? j : -1).filter(j => j >= 0);
      if (matches.length === 0) return { success: false, error: `${pos}: no entry matching '${oldText.slice(0, 60)}'.` };
      const uniqueTexts = new Set(matches.map(j => working[j]));
      if (uniqueTexts.size > 1) {
        return { success: false, error: `${pos}: multiple entries matched '${oldText.slice(0, 60)}'. Be more specific.`, current_entries: matches.map(j => working[j].slice(0, 80)) };
      }
      working.splice(matches[0], 1);
    } else {
      return { success: false, error: `${pos}: unknown action '${(op as any).action}'. Use add/remove/replace.` };
    }
  }

  // Phase 4: Budget check
  const newTotal = working.reduce((sum, e) => sum + e.length, 0);
  if (newTotal > limit) {
    return {
      success: false,
      error: `Batch result would be ${newTotal.toLocaleString()}/${limit.toLocaleString()} chars. Remove some entries first.`,
      current_entries: working,
      usage: `${newTotal.toLocaleString()}/${limit.toLocaleString()}`,
    };
  }

  // Phase 5: Commit
  writeEntries(fp, working);
  const pct = Math.min(100, Math.floor((newTotal / limit) * 100));
  return {
    success: true,
    done: true,
    target,
    message: `Applied ${operations.length} operation(s).`,
    usage: `${pct}% — ${newTotal.toLocaleString()}/${limit.toLocaleString()} chars`,
    entry_count: working.length,
    note: "Batch write complete. This update is done — do not repeat it.",
  };
}

// ── System prompt block ─────────────────────────────────────

export function buildSystemPromptBlock(target: "memory" | "user"): string {
  const fp = filePath(target);
  const entries = readEntries(fp);
  if (entries.length === 0) return "";

  const limit = charLimit(target);
  const content = entries.join(ENTRY_DELIMITER);
  const current = content.length;
  const pct = Math.min(100, Math.floor((current / limit) * 100));

  const header = target === "user"
    ? `USER PROFILE (who the user is) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`
    : `MEMORY (your personal notes) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`;

  const separator = "═".repeat(46);
  return `${separator}\n${header}\n${separator}\n${content}`;
}

// Export for tests
export const __test = {
  scanContent,
  detectExternalDrift,
  readEntries,
  writeEntries,
  readEntriesRaw,
  formatEntries,
  ENTRY_DELIMITER,
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
};
