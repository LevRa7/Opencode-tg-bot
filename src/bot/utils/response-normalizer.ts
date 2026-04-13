import { escapeHtml } from "./reasoning-format.js";

function isCommandLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /^(npm|pnpm|yarn|bun|git|node|python|pytest|npx|docker|kubectl|bash|sh)\b/.test(trimmed);
}

function normalizeInlineCode(line: string): string {
  return line.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${escapeHtml(code)}</code>`);
}

export function normalizeResponseSnapshotToHtml(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let inCodeFence = false;
  let codeFenceLines: string[] = [];
  let commandLines: string[] = [];

  const flushCommands = () => {
    if (commandLines.length === 0) {
      return;
    }

    result.push(`<pre>${escapeHtml(commandLines.join("\n"))}</pre>`);
    commandLines = [];
  };

  const flushCodeFence = () => {
    if (codeFenceLines.length === 0) {
      return;
    }

    result.push(`<pre>${escapeHtml(codeFenceLines.join("\n"))}</pre>`);
    codeFenceLines = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushCommands();
      if (inCodeFence) {
        flushCodeFence();
        inCodeFence = false;
      } else {
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      codeFenceLines.push(line);
      continue;
    }

    if (isCommandLine(line)) {
      commandLines.push(line.trim());
      continue;
    }

    flushCommands();

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      result.push(`<b>${escapeHtml(heading[1].trim())}</b>`);
      continue;
    }

    result.push(normalizeInlineCode(escapeHtml(line)));
  }

  flushCommands();
  flushCodeFence();

  return result.join("\n");
}
