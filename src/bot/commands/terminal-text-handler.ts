// Terminal text input handler — called by index.ts for messages in terminal topics.
// Separated from terminal.ts to enable unit testing of intra-module dependencies.

import type { PtySessionHandle } from "./terminal-bridge.js";
import { getPtySession } from "./terminal.js";
import { executeTerminalCommand } from "./terminal.js";

export async function handleTerminalTextInput(
  text: string,
  messageThreadId: number,
  userId: number,
  ctx: {
    reply(text: string, opts?: any): Promise<any>;
    api: { editMessageText(...args: any[]): any; editForumTopic(...args: any[]): any };
    chat: { id: number };
  },
): Promise<boolean> {
  const session = getPtySession(messageThreadId);
  const cleanText = text.length > 128 ? text.slice(0, 125) + "..." : text;

  if (session) {
    // Write to persistent PTY
    try {
      if (text.startsWith("^")) {
        const ctrl = text.slice(1).toUpperCase();
        if (ctrl === "C") { session.write("\x03"); }
        else if (ctrl === "D") { session.write("\x04"); }
        else { session.write(text + "\n"); }
      } else {
        session.write(text + "\n");
      }
    } catch { /* PTY write may fail */ }

    // Rename topic
    try {
      await ctx.api.editForumTopic(ctx.chat.id, messageThreadId, { name: cleanText });
    } catch { /* ignore */ }

    // Acknowledge
    const statusMsg = await ctx.reply(`<pre>$ ${cleanText}</pre>`, { parse_mode: "HTML" });
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `<pre>$ ${cleanText}\n[Sent to terminal]</pre>`,
        { parse_mode: "HTML" },
      );
    } catch { /* ignore */ }

    return true;
  }

  // Fallback: stateless spawn via executeTerminalCommand
  try {
    await ctx.api.editForumTopic(ctx.chat.id, messageThreadId, { name: cleanText });
  } catch { /* ignore */ }

  const statusMsg = await ctx.reply(`<pre>$ ${text}</pre>`, { parse_mode: "HTML" });

  let accumulated = "";
  let lastEdit = Date.now();
  const EDIT_DEBOUNCE_MS = 200;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const doEdit = async () => {
    pendingTimer = null;
    const safe = accumulated.slice(-3800);
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `<pre>$ ${text}\n${safe}</pre>`,
        { parse_mode: "HTML" },
      );
    } catch { /* ignore */ }
  };

  try {
    await executeTerminalCommand(text, messageThreadId, (chunk: string) => {
      accumulated += chunk;
      const now = Date.now();
      if (now - lastEdit >= EDIT_DEBOUNCE_MS) {
        lastEdit = now;
        doEdit();
      } else if (!pendingTimer) {
        pendingTimer = setTimeout(doEdit, EDIT_DEBOUNCE_MS);
      }
    }, userId);
  } catch { /* executeTerminalCommand may reject */ }

  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  doEdit();

  return true;
}
