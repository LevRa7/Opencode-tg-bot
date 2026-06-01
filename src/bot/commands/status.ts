import { CommandContext, Context } from "grammy";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentProject, isTtsEnabled } from "../../settings/manager.js";
import { fetchCurrentAgent } from "../../agent/manager.js";
import { getAgentDisplayName } from "../../agent/types.js";
import { fetchCurrentModel } from "../../model/manager.js";
import { processManager } from "../../process/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { getGitWorktreeContext } from "../../git/worktree.js";
import { sshManager } from "../../utils/ssh-manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { sendBotText } from "../utils/telegram-text.js";

export async function statusCommand(ctx: CommandContext<Context>) {
  const messageThreadId = extractMessageThreadIdFromContext(ctx);

  try {
    const { data, error } = await opencodeClient.global.health();

    if (error || !data) {
      throw error || new Error("No data received from server");
    }

    const runtimeInfo = processManager.getCurrentRuntimeInfo();

    let message = `${t("status.header_running")}\n\n`;
    const healthLabel = data.healthy ? t("status.health.healthy") : t("status.health.unhealthy");
    message += `${t("status.line.health", { health: healthLabel })}\n`;
    if (data.version) {
      message += `${t("status.line.version", { version: data.version })}\n`;
    }
    message += `${t("status.line.tts", {
      tts: isTtsEnabled() ? t("status.tts.on") : t("status.tts.off"),
    })}\n`;

    if (runtimeInfo.managed) {
      const uptime = runtimeInfo.uptimeMs ? Math.floor(runtimeInfo.uptimeMs / 1000) : 0;
      message += `${t("status.line.managed_yes")}\n`;
      message += `${t("status.line.pid", { pid: runtimeInfo.pid ?? "-" })}\n`;
      message += `${t("status.line.uptime_sec", { seconds: uptime })}\n`;
    }

    const userId = ctx.from?.id;

    if (userId && sshManager.isSshActive(userId)) {
      const conn = sshManager.getActiveConnection(userId);
      const details = conn?.details;
      if (details) {
        const targetLabel = conn?.deployTarget === "docker" ? "Docker" : "Host";
        message += `${t("status.runtime.ssh", {
          user: details.username,
          host: details.host,
          port: String(details.port ?? 22),
          target: targetLabel,
        })}\n`;
      }
    } else if (runtimeInfo.kind === "tenant") {
      message += `${t("status.runtime.tenant")}\n`;
      if (runtimeInfo.port) {
        message += `${t("status.line.port", { port: runtimeInfo.port })}\n`;
      }
      if (runtimeInfo.tenantId) {
        message += `${t("status.line.tenant", { tenantId: runtimeInfo.tenantId })}\n`;
      }
    } else {
      message += `${t("status.runtime.host")}\n`;
    }

    const currentAgent = await fetchCurrentAgent();
    const agentDisplay = currentAgent
      ? getAgentDisplayName(currentAgent)
      : t("status.agent_not_set");
    message += `${t("status.line.mode", { mode: agentDisplay })}\n`;

    const currentModel = fetchCurrentModel();
    const modelDisplay = `🤖 ${currentModel.providerID}/${currentModel.modelID}`;
    message += `${t("status.line.model", { model: modelDisplay })}\n`;

    const currentProject = getCurrentProject();
    if (currentProject) {
      const gitContext = await getGitWorktreeContext(currentProject.worktree);
      if (gitContext?.mainProjectPath && gitContext?.branch) {
        message += `\n${t("status.project_selected", { project: `${gitContext.mainProjectPath}: ${gitContext.branch}` })}\n`;
        if (gitContext.isLinkedWorktree && gitContext.activeWorktreePath) {
          message += `${t("status.worktree_selected", { worktree: gitContext.activeWorktreePath })}\n`;
        }
      } else {
        const projectName = currentProject.name || currentProject.worktree;
        message += `\n${t("status.project_selected", { project: projectName })}\n`;
      }
    } else {
      message += `\n${t("status.project_not_selected")}\n`;
      message += t("status.project_hint");
    }

    const currentSession = getCurrentSession();
    if (currentSession) {
      message += `\n${t("status.session_selected", { title: currentSession.title })}\n`;
    } else {
      message += `\n${t("status.session_not_selected")}\n`;
      message += t("status.session_hint");
    }

    if (ctx.chat) {
      if (!pinnedMessageManager.isInitialized()) {
        pinnedMessageManager.initialize(ctx.api, ctx.chat.id);
      }
      if (pinnedMessageManager.getContextLimit() === 0) {
        await pinnedMessageManager.refreshContextLimit();
      }
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    const contextInfo = pinnedMessageManager.getContextInfo();
    if (contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    }
    if (ctx.chat) {
      await sendBotText({
        api: ctx.api,
        chatId: ctx.chat.id,
        text: message,
        messageThreadId,
      });
    } else {
      await ctx.reply(message, withMessageThreadId(undefined, messageThreadId));
    }
  } catch (error) {
    logger.error("[Bot] Error checking server status:", error);
    await ctx.reply(
      t("status.server_unavailable"),
      withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
    );
  }
}
