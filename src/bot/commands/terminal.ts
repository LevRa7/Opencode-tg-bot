import { CommandContext, Context, InlineKeyboard } from "grammy";
import type { Api } from "grammy";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, getCurrentSession, type SessionInfo } from "../../session/manager.js";
import { getCurrentProject, setConversationCurrentProject } from "../../settings/manager.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { SessionType } from "../../keyboard/types.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getSystemInfo } from "../../utils/system-info.js";
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

  const sysInfo = getSystemInfo();
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
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      shell: true,
      timeout: TERMINAL_EXEC_TIMEOUT_MS,
    });

    terminalProcesses.set(messageThreadId, child);

    child.stdout?.on("data", (data: Buffer) => {
      onChunk(data.toString());
    });

    child.stderr?.on("data", (data: Buffer) => {
      onChunk(data.toString());
    });

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
