import { CommandContext, Context, InlineKeyboard, InputFile } from "grammy";
import type { Api } from "grammy";
import { spawn, execSync } from "child_process";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { promises as fs } from "fs";
import * as path from "path";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, getCurrentSession, type SessionInfo } from "../../session/manager.js";
import { getCurrentProject, setConversationCurrentProject, getVmRuntimeInfo, getUserDeployTarget } from "../../settings/manager.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { SessionType } from "../../keyboard/types.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getSystemInfo } from "../../utils/system-info.js";
import type { SystemInfo } from "../../utils/system-info.js";
import { VMPtyBridge, type PtySessionHandle } from "./terminal-bridge.js";

function getVmSystemInfo(userId: number): SystemInfo | null {
  try {
    const vmInfo = getVmRuntimeInfo(userId);
    if (!vmInfo?.bridgeIp) return null;
    const raw = execSync(
      `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 opencode@${vmInfo.bridgeIp} 'cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2- && cat /proc/meminfo | grep -E "MemTotal|MemAvailable"' 2>/dev/null`,
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();
    const lines = raw.split("\n");
    const cpuModel = lines[0]?.trim().slice(0, 35) || "VM CPU";
    // Parse MemTotal and MemAvailable in kB
    const totalMatch = lines[1]?.match(/\d+/);
    const availMatch = lines[2]?.match(/\d+/);
    const totalKb = totalMatch ? parseInt(totalMatch[0], 10) : 0;
    const availKb = availMatch ? parseInt(availMatch[0], 10) : 0;
    const usedKb = totalKb - availKb;
    const totalGB = Math.round((totalKb / (1024 * 1024)) * 10) / 10;
    const usedGB = Math.round((usedKb / (1024 * 1024)) * 10) / 10;
    const percentUsed = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;
    return {
      cpu: { model: cpuModel, usagePercent: 0 },
      ram: { usedGB, totalGB, percentUsed },
    };
  } catch {
    return null;
  }
}
import { processManager } from "../../process/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { threadContextManager } from "../../thread/manager.js";
import { getDefaultProject } from "../../project/manager.js";
import { attachSessionForScope } from "../../attach/service.js";
import { showPermissionRequest } from "../handlers/permission.js";
import { showCurrentQuestion } from "../handlers/question.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { keyboardManager as km } from "../../keyboard/manager.js";
import { sshManager } from "../../utils/ssh-manager.js";
import type { TelegramConversationScope } from "../../telegram/scope.js";

const TERMINAL_EXEC_TIMEOUT_MS = 30_000;
const TERMINAL_TOPICS_FILE = "terminal_topics.json";

export const terminalTopicIds = new Set<number>();
export const terminalProcesses = new Map<number, ReturnType<typeof spawn>>();

function getTerminalTopicsPath(): string {
  return path.join(process.cwd(), "data", TERMINAL_TOPICS_FILE);
}

export async function loadTerminalTopics(): Promise<void> {
  try {
    const data = await fs.readFile(getTerminalTopicsPath(), "utf-8");
    const ids: number[] = JSON.parse(data);
    for (const id of ids) {
      terminalTopicIds.add(id);
    }
    logger.info(`[Terminal] Loaded ${ids.length} terminal topics from disk`);
  } catch {
    // file doesn't exist yet — OK
  }
}

async function saveTerminalTopics(): Promise<void> {
  try {
    const dir = path.dirname(getTerminalTopicsPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      getTerminalTopicsPath(),
      JSON.stringify([...terminalTopicIds]),
    );
  } catch (err) {
    logger.warn("[Terminal] Failed to save terminal topics:", err);
  }
}

export function isTerminalTopic(messageThreadId?: number): boolean {
  return messageThreadId !== undefined && terminalTopicIds.has(messageThreadId);
}

export function isTerminalRunning(messageThreadId: number): boolean {
  return terminalProcesses.has(messageThreadId);
}

export function killTerminalProcess(messageThreadId: number): boolean {
  const child = terminalProcesses.get(messageThreadId);
  if (child) {
    child.kill("SIGTERM");
    terminalProcesses.delete(messageThreadId);
    return true;
  }
  return false;
}

async function getTerminalCmd(userId: number, sessionId: string, cols: number, rows: number, cwd: string): Promise<string[] | null> {
  const deployTarget = getUserDeployTarget(userId);
  const vmInfo = getVmRuntimeInfo(userId);
  // Use TERM=dumb to suppress ANSI color codes, --norc to skip .bashrc fancy prompts
  const agentCmd = `NODE_PATH=/usr/local/lib/node_modules TERM=dumb node /opt/terminal-agent.js ${sessionId} ${cols} ${rows} ${cwd}`;

  if (deployTarget === "vm" && vmInfo?.bridgeIp) {
    return ["ssh", "-q", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=5",
      `opencode@${vmInfo.bridgeIp}`, agentCmd];
  }

  if (deployTarget === "docker") {
    const { getActiveTenantContainerId } = await import("../../process/manager.js");
    const containerId = getActiveTenantContainerId(userId);
    if (containerId) {
      return ["docker", "exec", "-i", containerId, "sh", "-c", agentCmd];
    }
    return null;
  }

  if (deployTarget === "ssh") {
    try {
      const { sshManager } = await import("../../utils/ssh-manager.js");
      const connInfo = sshManager.getConnectionInfo(userId);
      if (connInfo) {
        return ["ssh", "-q", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=5",
          `${connInfo.username}@${connInfo.host}`, agentCmd];
      }
    } catch { /* SSH not available */ }
    return null;
  }

  // Local: spawn directly, use the host's npm global path
  return ["sh", "-c", `NODE_PATH="$(npm root -g 2>/dev/null || echo /usr/local/lib/node_modules)" TERM=dumb node /opt/terminal-agent.js ${sessionId} ${cols} ${rows} ${cwd}`];
}

export async function startPtySession(
  userId: number,
  sessionId: string,
  worktree: string,
  messageThreadId: number,
  api: Api,
  forumChatId: number,
): Promise<void> {
  if (ptySessions.has(messageThreadId)) return;

  const cmd = await getTerminalCmd(userId, sessionId, 80, 24, worktree);
  if (!cmd) return;

  const bridgeKey = userId; // reuse bridge per user
  let bridge = vmBridges.get(bridgeKey);
  if (!bridge) {
    bridge = new VMPtyBridge("generic"); // bridgeIp not used for non-VM — cmd is what matters
    vmBridges.set(bridgeKey, bridge);
  }

  const ptySession = bridge.spawnSessionWithCmd(sessionId, cmd);
  setPtySession(messageThreadId, ptySession);

  let outputBuf = ""; // cleaned for text display
  let rawOutputBuf = ""; // raw ANSI for xterm.js screenshots
  let screenshotTimer: ReturnType<typeof setTimeout> | null = null;

  const doScreenshot = async () => {
    if (!rawOutputBuf) return;
    try {
      const scrollOffset = terminalScrollOffsets.get(messageThreadId) ?? 0;
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const TERM_ROWS = 72; // 3x normal height
        const TERM_COLS = 80;
        await page.setViewportSize({ width: 860, height: TERM_ROWS * 18 + 40 });
        const escaped = JSON.stringify(rawOutputBuf);
        const xtermJs = await fs.readFile(require.resolve("xterm/lib/xterm.js"), "utf-8");
        const xtermCss = await fs.readFile(require.resolve("xterm/css/xterm.css"), "utf-8");
        await page.setContent(`
          <html><head><style>${xtermCss} body{margin:0;background:#1a1a2e}</style></head>
          <body><div id="terminal"></div></body>
          <script>${xtermJs}</script>
          <script>
            var term = new Terminal({ cols: ${TERM_COLS}, rows: ${TERM_ROWS}, scrollback: 5000,
              theme: { background: '#1a1a2e', foreground: '#e0e0e0' } });
            term.open(document.getElementById('terminal'));
            var data = ${escaped};
            term.write(data.replace(/\\n/g, '\\r\\n'));
            // Wait for write buffer to flush, then scroll
            setTimeout(function() {
              // Always start from bottom (latest output), then scroll up if needed
              term.scrollToBottom();
              var scrollUp = ${scrollOffset};
              if (scrollUp > 0) {
                term.scrollLines(-scrollUp);
              }
              document.title = 'READY';
            }, 300);
          </script>
          </html>
        `);
        await page.waitForFunction(() => document.title === 'READY', { timeout: 5000 });
        const buf = await page.screenshot({ type: "png" });
        // Delete old keyboard message if any
        const oldKeyboardMsg = terminalLastKeyboardMsgs.get(messageThreadId);
        if (oldKeyboardMsg) {
          api.deleteMessage(forumChatId, oldKeyboardMsg).catch(() => {});
        }
        // Send screenshot with inline keyboard
        const navKeyboard = new InlineKeyboard()
          .text("⬆ -20", `term:up:${messageThreadId}`)
          .text("🔄", `term:refresh:${messageThreadId}`)
          .text("⬇ +20", `term:down:${messageThreadId}`);
        const sent = await api.sendPhoto(forumChatId, new InputFile(buf, "terminal.png"), {
          message_thread_id: messageThreadId,
          reply_markup: navKeyboard,
          caption: `↑${scrollOffset} lines`,
        });
        terminalLastKeyboardMsgs.set(messageThreadId, sent.message_id);
      } finally {
        await browser.close();
      }
    } catch (err) {
      logger.warn("[Terminal] Screenshot failed:", err);
    }
  };

  ptySession.onData((data: string) => {
    // Strip ANSI escape sequences for clean output
    const cleanData = data
      .replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "")
      .replace(/\x1b\][^\x07]*\x07/g, "")
      .replace(/\x1b\][^\x1b]*\x1b\\/g, "")
      .replace(/\x1b[PX^_].*?\x1b\\/g, "")
      .replace(/\x1b[^a-zA-Z\[\]]/g, "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
    if (!cleanData && !data.includes("\n")) return;
    rawOutputBuf += data;
    outputBuf += (cleanData || data);
    terminalOutputs.set(messageThreadId, rawOutputBuf);
    // Update text display (always show latest portion)
    const safe = outputBuf.slice(-3800);
    const textMsg = terminalTextMsgs.get(messageThreadId);
    if (textMsg) {
      textMsg.api.editMessageText(textMsg.chatId, textMsg.msgId, `<pre>${safe}</pre>`, { parse_mode: "HTML" }).catch(() => {});
    } else {
      api.sendMessage(forumChatId, `<pre>${safe}</pre>`, { message_thread_id: messageThreadId, parse_mode: "HTML" })
        .then((msg) => { terminalTextMsgs.set(messageThreadId, { msgId: msg.message_id, api, chatId: forumChatId }); })
        .catch(() => {});
    }
    if (screenshotTimer) clearTimeout(screenshotTimer);
    screenshotTimer = setTimeout(doScreenshot, 500);
  });

  ptySession.onExit((code, signal) => {
    const exitMsg = signal ? `\n[Killed by ${signal}]` : `\n[Exited with code ${code}]`;
    const textMsg = terminalTextMsgs.get(messageThreadId);
    if (textMsg) {
      outputBuf += exitMsg;
      textMsg.api.editMessageText(textMsg.chatId, textMsg.msgId, `<pre>${(outputBuf).slice(-3800)}</pre>`, { parse_mode: "HTML" }).catch(() => {});
    }
    killPtySession(messageThreadId);
  });

  logger.info(`[Terminal] PTY session spawned for topic ${messageThreadId}`);
}

function formatForumTopicUrl(chatId: number, messageThreadId: number): string {
  const rawId = String(chatId).replace(/^-100/, "");
  return `https://t.me/c/${rawId}/${messageThreadId}`;
}

export async function openTerminalTopic(
  api: Api,
  userId: number,
  forumChatId: number,
): Promise<{ topicUrl: string; messageThreadId: number; sessionId: string }> {
  let currentProject = getCurrentProject();
  if (!currentProject) {
    const defaultProject = await getDefaultProject();
    if (!defaultProject) {
      throw new Error("No project selected");
    }
    currentProject = defaultProject;
  }

  setConversationCurrentProject(currentProject);
  threadContextManager.bindProjectToActiveContext(currentProject);

  const { data: session, error } = await opencodeClient.session.create({
    directory: currentProject.worktree,
  });

  if (error || !session) {
    throw error || new Error("No data received from server");
  }

  const topicName = t("terminal.new_topic_name");

  const topicResult = await api.createForumTopic(forumChatId, topicName);
  const messageThreadId = topicResult.message_thread_id;

  const sessionInfo: SessionInfo = {
    id: session.id,
    title: session.title,
    directory: currentProject.worktree,
  };

  const previousSession = getCurrentSession();
  if (previousSession) {
    clearScopedSessionRuntime(previousSession.id, "new_session");
  }

  setCurrentSession(sessionInfo);

  const newScope: TelegramConversationScope = {
    userId,
    chatId: forumChatId,
    messageThreadId,
  };

  await attachSessionForScope({
    scope: newScope,
    session: sessionInfo,
    reason: "new_session",
    restoreQuestion: () =>
      showCurrentQuestion(api, forumChatId, messageThreadId),
    restorePermission: (request) =>
      showPermissionRequest(api, forumChatId, request, messageThreadId),
  });

  const isVm = !!getVmRuntimeInfo(userId);
  // Start persistent PTY session for VM users
  await startPtySession(userId, session.id, currentProject.worktree, messageThreadId, api, forumChatId);

  const sysInfo = isVm ? (getVmSystemInfo(userId) ?? getSystemInfo()) : getSystemInfo();
  const terminalKeyboard = createMainKeyboard(
    getStoredAgent(),
    getStoredModel(),
    undefined,
    undefined,
    {
      isRunning: processManager.isRunning(),
      cpuInfo: sysInfo.cpu,
      ramInfo: sysInfo.ram,
      isTerminalTopic: true,
    },
  );

  // keyboard init removed — handled by middleware and buildKeyboard fallback

  await api.sendMessage(
    forumChatId,
    t("bot.session_created", { title: session.title }),
    {
      message_thread_id: messageThreadId,
      reply_markup: terminalKeyboard,
    },
  );

  const topicUrl = formatForumTopicUrl(forumChatId, messageThreadId);

  terminalTopicIds.add(messageThreadId);
  await saveTerminalTopics();

  logger.info(
    `[Bot] Terminal topic created: session=${session.id}, topic=${messageThreadId}`,
  );

  return { topicUrl, messageThreadId, sessionId: session.id };
}

export function executeTerminalCommand(
  command: string,
  messageThreadId: number,
  onChunk: (text: string) => void,
  userId?: number,
): Promise<{ code: number | null }> {
  // Determine execution target: VM → SSH to VM, SSH-remote → sshManager, else → local spawn
  const vmInfo = userId ? getVmRuntimeInfo(userId) : undefined;
  const isSsh = !!userId && sshManager.isSshActive(userId);

  if (vmInfo?.bridgeIp) {
    return executeTerminalCommandViaSsh(
      `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 opencode@${vmInfo.bridgeIp}`,
      command, messageThreadId, onChunk,
    );
  }

  if (isSsh && userId) {
    return executeTerminalCommandViaSshManager(userId, command, messageThreadId, onChunk);
  }

  // Default: local spawn
  return executeTerminalCommandLocal(command, messageThreadId, onChunk);
}

function executeTerminalCommandLocal(
  command: string,
  messageThreadId: number,
  onChunk: (text: string) => void,
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      shell: true,
      timeout: TERMINAL_EXEC_TIMEOUT_MS,
    });
    terminalProcesses.set(messageThreadId, child);
    child.stdout?.on("data", (data: Buffer) => onChunk(data.toString()));
    child.stderr?.on("data", (data: Buffer) => onChunk(data.toString()));
    child.on("close", (code) => {
      terminalProcesses.delete(messageThreadId);
      km.sendKeyboardUpdate().catch(() => {});
      resolve({ code });
    });
    child.on("error", (err) => {
      onChunk(`\nError: ${err.message}`);
      terminalProcesses.delete(messageThreadId);
      km.sendKeyboardUpdate().catch(() => {});
      resolve({ code: null });
    });
  });
}

function executeTerminalCommandViaSsh(
  sshPrefix: string,
  command: string,
  messageThreadId: number,
  onChunk: (text: string) => void,
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    // cd /workspace — use the OpenCode working directory as default
    // 2>/dev/null suppresses the SSH known_hosts warning
    const fullCmd = `${sshPrefix} "cd /workspace && ${command.replace(/"/g, '\\"')}" 2>/dev/null`;
    const child = spawn(fullCmd, [], {
      shell: true,
      timeout: TERMINAL_EXEC_TIMEOUT_MS,
    });
    terminalProcesses.set(messageThreadId, child);
    child.stdout?.on("data", (data: Buffer) => onChunk(data.toString()));
    child.stderr?.on("data", (data: Buffer) => onChunk(data.toString()));
    child.on("close", (code) => {
      terminalProcesses.delete(messageThreadId);
      km.sendKeyboardUpdate().catch(() => {});
      resolve({ code });
    });
    child.on("error", (err) => {
      onChunk(`\nError: ${err.message}`);
      terminalProcesses.delete(messageThreadId);
      km.sendKeyboardUpdate().catch(() => {});
      resolve({ code: null });
    });
  });
}

async function executeTerminalCommandViaSshManager(
  userId: number,
  command: string,
  messageThreadId: number,
  onChunk: (text: string) => void,
): Promise<{ code: number | null }> {
  try {
    const output = await sshManager.executeRemoteCommand(userId, command);
    onChunk(output);
    return { code: 0 };
  } catch (err) {
    onChunk(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    return { code: null };
  }
}

export async function terminalCommand(ctx: CommandContext<Context>) {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply(t("error.user_not_found"));
      return;
    }

    const forumChatId = threadContextManager.findForumChatIdForUser(userId);
    if (!forumChatId) {
      await ctx.reply(t("background.forum_not_found"));
      return;
    }

    const { topicUrl } = await openTerminalTopic(ctx.api, userId, forumChatId);

    const keyboard = new InlineKeyboard().url(
      t("terminal.open_button"),
      topicUrl,
    );

    await ctx.reply(
      t("terminal.created"),
      { reply_markup: keyboard },
    );

    clearAllInteractionState("terminal_created");
  } catch (err) {
    logger.error("[Bot] Error in /terminal command:", err);
    await ctx.reply(t("error.generic"));
  }
}

export function getTerminalOutput(messageThreadId: number): string | undefined {
  return terminalOutputs.get(messageThreadId);
}

export function getTerminalScrollOffset(messageThreadId: number): number {
  return terminalScrollOffsets.get(messageThreadId) ?? 0;
}

export function setTerminalScrollOffset(messageThreadId: number, offset: number): void {
  terminalScrollOffsets.set(messageThreadId, Math.max(0, offset));
}

export async function handleTerminalScrollButton(
  action: "up" | "down" | "refresh",
  messageThreadId: number,
  api: Api,
  chatId: number,
): Promise<void> {
  if (action === "refresh") {
    setTerminalScrollOffset(messageThreadId, 0);
  } else {
    const current = terminalScrollOffsets.get(messageThreadId) ?? 0;
    if (action === "up") {
      setTerminalScrollOffset(messageThreadId, current + 20);
    } else {
      setTerminalScrollOffset(messageThreadId, Math.max(0, current - 20));
    }
  }
  // Update text display to match scroll (show scrolled portion of clean output)
  refreshTerminalText(messageThreadId);
  await takeTerminalScreenshot(messageThreadId, api, chatId);
}

function refreshTerminalText(messageThreadId: number): void {
  const scrollOffset = terminalScrollOffsets.get(messageThreadId) ?? 0;
  const textInfo = terminalTextMsgs.get(messageThreadId);
  if (!textInfo) return;
  const raw = terminalOutputs.get(messageThreadId);
  if (!raw) return;
  // Clean ANSI for text display, show scrolled portion
  const clean = raw
    .replace(/\x1b\[[\d;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\][^\x1b]*\x1b\\/g, "")
    .replace(/\x1b[PX^_].*?\x1b\\/g, "")
    .replace(/\x1b[^a-zA-Z\[\]]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  // Show lines from scrollOffset to scrollOffset+72
  const lines = clean.split("\n");
  const visible = lines.slice(scrollOffset, scrollOffset + 72).join("\n");
  textInfo.api.editMessageText(textInfo.chatId, textInfo.msgId, `<pre>${visible.slice(-3800)}</pre>`, { parse_mode: "HTML" }).catch(() => {});
}

export async function takeTerminalScreenshot(
  messageThreadId: number,
  api: Api,
  chatId: number,
): Promise<void> {
  const output = terminalOutputs.get(messageThreadId);
  if (!output) {
    await api.sendMessage(chatId, "No terminal output yet", { message_thread_id: messageThreadId });
    return;
  }

  const scrollOffset = terminalScrollOffsets.get(messageThreadId) ?? 0;
  const TERM_ROWS = 72;
  const TERM_COLS = 80;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 860, height: TERM_ROWS * 18 + 40 });
    const escaped = JSON.stringify(output);
    const xtermJs = await fs.readFile(require.resolve("xterm/lib/xterm.js"), "utf-8");
    const xtermCss = await fs.readFile(require.resolve("xterm/css/xterm.css"), "utf-8");
        await page.setContent(`
          <html><head><style>${xtermCss} body{margin:0;background:#1a1a2e}</style></head>
          <body><div id="terminal"></div></body>
          <script>${xtermJs}</script>
          <script>
            var term = new Terminal({ cols: ${TERM_COLS}, rows: ${TERM_ROWS}, scrollback: 5000,
              theme: { background: '#1a1a2e', foreground: '#e0e0e0' } });
            term.open(document.getElementById('terminal'));
            var data = ${escaped};
            term.write(data.replace(/\\n/g, '\\r\\n'));
            setTimeout(function() {
              // Always start from bottom (latest output), then scroll up if needed
              term.scrollToBottom();
              var scrollUp = ${scrollOffset};
              if (scrollUp > 0) {
                term.scrollLines(-scrollUp);
              }
              document.title = 'READY';
            }, 300);
          </script>
          </html>
        `);
        await page.waitForFunction(() => document.title === 'READY', { timeout: 5000 });
    const buf = await page.screenshot({ type: "png" });
    const oldKeyboardMsg = terminalLastKeyboardMsgs.get(messageThreadId);
    if (oldKeyboardMsg) {
      api.deleteMessage(chatId, oldKeyboardMsg).catch(() => {});
    }
    const navKeyboard = new InlineKeyboard()
      .text("⬆ -20", `term:up:${messageThreadId}`)
      .text("🔄", `term:refresh:${messageThreadId}`)
      .text("⬇ +20", `term:down:${messageThreadId}`);
    const sent = await api.sendPhoto(chatId, new InputFile(buf, "terminal.png"), {
      message_thread_id: messageThreadId,
      reply_markup: navKeyboard,
      caption: `↑${scrollOffset} lines`,
    });
    terminalLastKeyboardMsgs.set(messageThreadId, sent.message_id);
  } finally {
    await browser.close();
  }
}

const vmBridges = new Map<number, VMPtyBridge>();
const ptySessions = new Map<number, PtySessionHandle>();
const terminalOutputs = new Map<number, string>(); // messageThreadId → accumulated raw output
const terminalScrollOffsets = new Map<number, number>();
const terminalLastKeyboardMsgs = new Map<number, number>();
const terminalTextMsgs = new Map<number, { msgId: number; api: Api; chatId: number }>(); // for scroll-synced text updates // messageThreadId → scroll line offset

export async function ensureVMPtyBridge(userId: number, bridgeIp: string): Promise<VMPtyBridge> {
  const existing = vmBridges.get(userId);
  if (existing) return existing;

  const bridge = new VMPtyBridge(bridgeIp);
  vmBridges.set(userId, bridge);
  return bridge;
}

export function getPtySession(messageThreadId: number): PtySessionHandle | undefined {
  return ptySessions.get(messageThreadId);
}

export function setPtySession(messageThreadId: number, session: PtySessionHandle): void {
  ptySessions.set(messageThreadId, session);
}

export async function killPtySession(messageThreadId: number): Promise<void> {
  const session = ptySessions.get(messageThreadId);
  if (session) {
    session.kill();
    ptySessions.delete(messageThreadId);
  }
}

export async function disconnectVMBridge(userId: number): Promise<void> {
  const bridge = vmBridges.get(userId);
  if (bridge) {
    try { bridge.killAll(); } catch { /* ignore errors from mock/stale bridges */ }
    vmBridges.delete(userId);
    ptySessions.clear();
  }
}
