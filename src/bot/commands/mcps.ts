import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";

const MCPS_CALLBACK_PREFIX = "mcps:";
const MCPS_CALLBACK_SELECT_PREFIX = `${MCPS_CALLBACK_PREFIX}select:`;
const MCPS_CALLBACK_AUTH_PREFIX = `${MCPS_CALLBACK_PREFIX}auth:`;
const MCPS_CALLBACK_CANCEL = `${MCPS_CALLBACK_PREFIX}cancel`;
const MCPS_CALLBACK_BACK = `${MCPS_CALLBACK_PREFIX}back`;
const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

export interface McpServerView {
  id: string;
  name: string;
  status: string;
  enabled: boolean;
  connected: boolean;
  command?: string;
  url?: string;
  error?: string;
}

interface McpsListMetadata {
  flow: "mcps";
  stage: "list";
  messageId: number;
  projectDirectory: string;
  servers: McpServerView[];
}

interface McpsDetailMetadata {
  flow: "mcps";
  stage: "detail";
  messageId: number;
  projectDirectory: string;
  servers: McpServerView[];
  selectedIndex: number;
}

type McpsMetadata = McpsListMetadata | McpsDetailMetadata;

function getReplyThreadOptions(ctx: Context): { message_thread_id?: number } {
  return withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx));
}

function normalizeDirectoryForMcpApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatEnabledState(enabled: boolean): string {
  return enabled ? t("mcps.enabled.enabled") : t("mcps.enabled.disabled");
}

function formatConnectionState(connected: boolean): string {
  return connected ? t("mcps.connection.connected") : t("mcps.connection.disconnected");
}

function formatStatusLabel(status: string): string {
  switch (status) {
    case "connected":
      return t("mcps.status.connected");
    case "disabled":
      return t("mcps.status.disabled");
    case "failed":
      return t("mcps.status.failed");
    case "needs_auth":
      return t("mcps.status.needs_auth");
    case "needs_client_registration":
      return t("mcps.status.needs_client_registration");
    default:
      return status;
  }
}

function normalizeCommandValue(value: unknown): string | undefined {
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
    return value.join(" ");
  }

  return typeof value === "string" && value.trim() ? value : undefined;
}

function adaptMcpStatusMap(value: unknown): McpServerView[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([id, rawStatus]) => {
    if (!isRecord(rawStatus) || typeof rawStatus.status !== "string") {
      return [];
    }

    const status = rawStatus.status;
    const enabled =
      typeof rawStatus.enabled === "boolean" ? rawStatus.enabled : rawStatus.status !== "disabled";

    return [
      {
        id,
        name: typeof rawStatus.name === "string" && rawStatus.name.trim() ? rawStatus.name : id,
        status,
        enabled,
        connected: status === "connected",
        command: normalizeCommandValue(rawStatus.command),
        url: typeof rawStatus.url === "string" && rawStatus.url.trim() ? rawStatus.url : undefined,
        error:
          typeof rawStatus.error === "string" && rawStatus.error.trim() ? rawStatus.error : undefined,
      },
    ];
  });
}

function formatMcpButtonLabel(server: McpServerView): string {
  const rawLabel = `${server.name} - ${formatStatusLabel(server.status)}`;
  if (rawLabel.length <= MAX_INLINE_BUTTON_LABEL_LENGTH) {
    return rawLabel;
  }

  return `${rawLabel.slice(0, MAX_INLINE_BUTTON_LABEL_LENGTH - 3)}...`;
}

function buildMcpsListKeyboard(servers: McpServerView[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  servers.forEach((server, index) => {
    keyboard.text(formatMcpButtonLabel(server), `${MCPS_CALLBACK_SELECT_PREFIX}${index}`).row();
  });

  keyboard.text(t("mcps.button.cancel"), MCPS_CALLBACK_CANCEL);
  return keyboard;
}

function buildMcpsDetailKeyboard(serverName: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("mcps.button.oauth"), `${MCPS_CALLBACK_AUTH_PREFIX}${serverName}`)
    .row()
    .text(t("mcps.button.back"), MCPS_CALLBACK_BACK)
    .text(t("mcps.button.cancel"), MCPS_CALLBACK_CANCEL);
}

export function buildMcpServerListText(servers: McpServerView[]): string {
  const lines = [t("mcps.title")];

  for (const [index, server] of servers.entries()) {
    lines.push(
      `${index + 1}. ${server.name} - ${formatStatusLabel(server.status)} (${formatConnectionState(server.connected)})`,
    );
  }

  return lines.join("\n");
}

export function buildMcpServerDetailText(server: McpServerView): string {
  const lines = [
    `${t("mcps.detail_title")} ${server.name}`,
    t("mcps.detail_status", { status: formatStatusLabel(server.status) }),
    t("mcps.detail_enabled", { enabled: formatEnabledState(server.enabled) }),
    t("mcps.detail_connection", { connection: formatConnectionState(server.connected) }),
  ];

  if (server.command) {
    lines.push(t("mcps.detail_command", { command: server.command }));
  }

  if (server.url) {
    lines.push(t("mcps.detail_url", { url: server.url }));
  }

  if (server.error) {
    lines.push(t("mcps.detail_error", { error: server.error }));
  }

  return lines.join("\n");
}

function parseMcpServers(value: unknown): McpServerView[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const servers: McpServerView[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }

    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.status !== "string" ||
      typeof item.enabled !== "boolean" ||
      typeof item.connected !== "boolean"
    ) {
      return null;
    }

    servers.push({
      id: item.id,
      name: item.name,
      status: item.status,
      enabled: item.enabled,
      connected: item.connected,
      command: typeof item.command === "string" ? item.command : undefined,
      url: typeof item.url === "string" ? item.url : undefined,
      error: typeof item.error === "string" ? item.error : undefined,
    });
  }

  return servers;
}

function parseMcpsMetadata(state: InteractionState | null): McpsMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const projectDirectory = state.metadata.projectDirectory;
  const servers = parseMcpServers(state.metadata.servers);

  if (
    flow !== "mcps" ||
    typeof stage !== "string" ||
    typeof messageId !== "number" ||
    typeof projectDirectory !== "string" ||
    !servers
  ) {
    return null;
  }

  if (stage === "list") {
    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      servers,
    };
  }

  if (stage === "detail") {
    const selectedIndex = state.metadata.selectedIndex;
    if (typeof selectedIndex !== "number" || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
      return null;
    }

    return {
      flow,
      stage,
      messageId,
      projectDirectory,
      servers,
      selectedIndex,
    };
  }

  return null;
}

function clearMcpsInteraction(reason: string): void {
  const metadata = parseMcpsMetadata(interactionManager.getSnapshot());
  if (metadata) {
    interactionManager.clear(reason);
  }
}

function parseSelectIndex(data: string): number | null {
  if (!data.startsWith(MCPS_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(MCPS_CALLBACK_SELECT_PREFIX.length);
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

export async function mcpsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const threadOptions = getReplyThreadOptions(ctx);
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"), threadOptions);
      return;
    }

    const { data, error } = await opencodeClient.mcp.status({
      directory: normalizeDirectoryForMcpApi(currentProject.worktree),
    });

    if (error || !data) {
      throw error || new Error("No MCP data received");
    }

    const servers = adaptMcpStatusMap(data);
    if (servers.length === 0) {
      await ctx.reply(t("mcps.empty"), threadOptions);
      return;
    }

    const message = await ctx.reply(
      buildMcpServerListText(servers),
      withMessageThreadId({ reply_markup: buildMcpsListKeyboard(servers) }, extractMessageThreadIdFromContext(ctx)),
    );

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: message.message_id,
        projectDirectory: currentProject.worktree,
        servers,
      },
    });
  } catch (error) {
    logger.error("[Mcps] Error fetching MCP status:", error);
    await ctx.reply(t("mcps.fetch_error"), getReplyThreadOptions(ctx));
  }
}

export async function handleMcpAuth(ctx: Context, serverName: string): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("bot.project_not_selected"), getReplyThreadOptions(ctx));
      return;
    }

    await ctx.answerCallbackQuery({ text: t("mcp.oauth_starting", { name: serverName }) });

    const { data, error } = await opencodeClient.mcp.auth.authenticate({
      name: serverName,
      directory: normalizeDirectoryForMcpApi(currentProject.worktree),
    });

    if (error) {
      throw error;
    }

    const statusText = data && typeof data === "object" && "status" in data
      ? `${formatStatusLabel(String((data as Record<string, unknown>).status))}`
      : "completed";

    await ctx.reply(
      t("mcp.oauth_success", { name: serverName, status: statusText }),
      getReplyThreadOptions(ctx),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[McpAuth] OAuth failed for ${serverName}:`, error);
    await ctx.reply(
      t("mcp.oauth_error", { error: message }),
      getReplyThreadOptions(ctx),
    ).catch(() => {});
  }
}

export async function handleMcpsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(MCPS_CALLBACK_PREFIX)) {
    return false;
  }

  if (data.startsWith(MCPS_CALLBACK_AUTH_PREFIX)) {
    const serverName = data.slice(MCPS_CALLBACK_AUTH_PREFIX.length);
    await handleMcpAuth(ctx, serverName);
    return true;
  }

  const metadata = parseMcpsMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);
  if (!metadata || callbackMessageId === null || metadata.messageId !== callbackMessageId) {
    await ctx.answerCallbackQuery({ text: t("mcps.inactive_callback"), show_alert: true });
    return true;
  }

  const currentProject = getCurrentProject();
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"), getReplyThreadOptions(ctx));
    return true;
  }

  try {
    if (data === MCPS_CALLBACK_CANCEL) {
      clearMcpsInteraction("mcps_cancelled");
      await ctx.answerCallbackQuery({ text: t("mcps.cancelled_callback") });
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data === MCPS_CALLBACK_BACK) {
      if (metadata.stage !== "detail") {
        await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
        return true;
      }

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(buildMcpServerListText(metadata.servers), {
        reply_markup: buildMcpsListKeyboard(metadata.servers),
      });

      interactionManager.transition({
        expectedInput: "callback",
        metadata: {
          flow: "mcps",
          stage: "list",
          messageId: metadata.messageId,
          projectDirectory: metadata.projectDirectory,
          servers: metadata.servers,
        },
      });
      return true;
    }

    const selectedIndex = parseSelectIndex(data);
    if (selectedIndex === null || metadata.stage !== "list") {
      await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
      return true;
    }

    const selectedServer = metadata.servers[selectedIndex];
    if (!selectedServer) {
      await ctx.answerCallbackQuery({ text: t("mcps.inactive_callback"), show_alert: true });
      return true;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(buildMcpServerDetailText(selectedServer), {
      reply_markup: buildMcpsDetailKeyboard(selectedServer.name),
    });

    interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "detail",
        messageId: metadata.messageId,
        projectDirectory: metadata.projectDirectory,
        servers: metadata.servers,
        selectedIndex,
      },
    });

    return true;
  } catch (error) {
    logger.error("[Mcps] Error handling MCP callback:", error);
    clearMcpsInteraction("mcps_callback_error");
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }
}
