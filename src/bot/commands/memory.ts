import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { Context } from "grammy";
import { getCurrentProject } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const MEMORY_FILENAME = "MEMORY.md";
const SNIPPET_MAX_CHARS = 2000;

export function getMemoryFilePath(projectDir: string): string {
  return `${projectDir}/${MEMORY_FILENAME}`;
}

export async function readMemory(projectDir: string): Promise<string> {
  const path = getMemoryFilePath(projectDir);
  if (!existsSync(path)) return "";
  return readFile(path, "utf-8");
}

export async function appendMemory(projectDir: string, entry: string): Promise<void> {
  const path = getMemoryFilePath(projectDir);
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const section = `\n### ${timestamp}\n${entry}\n`;

  if (existsSync(path)) {
    const existing = await readFile(path, "utf-8");
    await writeFile(path, existing + section);
  } else {
    await writeFile(path, `# Project Memory\n${section}`);
  }

  logger.info(`[Memory] Appended to ${path}`);
}

export async function getMemorySnippet(projectDir: string): Promise<string> {
  const path = getMemoryFilePath(projectDir);
  if (!existsSync(path)) return "";
  const content = await readFile(path, "utf-8");
  return content.slice(0, SNIPPET_MAX_CHARS);
}

export async function memoryCommand(ctx: Context): Promise<void> {
  const project = getCurrentProject();
  if (!project?.worktree) {
    await ctx.reply(t("memory.usage"));
    return;
  }

  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  const subcommand = parts[1];

  if (subcommand === "add") {
    const entry = parts.slice(2).join(" ");
    if (!entry.trim()) {
      await ctx.reply(t("memory.usage"));
      return;
    }
    await appendMemory(project.worktree, entry);
    await ctx.reply(t("memory.added"));
    return;
  }

  // Default: show memory
  const snippet = await getMemorySnippet(project.worktree);
  if (!snippet) {
    await ctx.reply(t("memory.empty"));
    return;
  }

  const header = t("memory.show");
  const footer = snippet.length >= SNIPPET_MAX_CHARS ? `\n\n${t("memory.show_truncated")}` : "";
  await ctx.reply(`${header}\n\n${snippet}${footer}`);
}
