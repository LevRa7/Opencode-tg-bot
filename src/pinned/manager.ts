import type { Api } from "grammy";
import { logger } from "../utils/logger.js";
import { opencodeClient } from "../opencode/client.js";
import { getCurrentSession } from "../session/manager.js";
import {
  getCurrentProject,
  getPinnedMessageId,
  setPinnedMessageId,
  clearPinnedMessageId,
} from "../settings/manager.js";
import { getStoredModel } from "../model/manager.js";
import { getModelContextLimit } from "../model/context-limit.js";
import type { FileChange, PinnedMessageState, TokensInfo } from "./types.js";
import { t } from "../i18n/index.js";
import { keyboardManager } from "../keyboard/manager.js";
import {
  DEFAULT_CONTEXT_LIMIT,
  formatContextLine,
  formatCostLine,
  formatDiffStats,
  formatLineRange,
  formatModelDisplayName,
} from "./format.js";
import {
  getCurrentTelegramConversationScope,
  getCurrentTelegramConversationScopeKey,
  runWithTelegramConversationScope,
} from "../telegram/scope.js";

interface ScopedPinnedRuntime {
  api: Api | null;
  chatId: number | null;
  state: PinnedMessageState;
  contextLimit: number | null;
  updateDebounceTimer: ReturnType<typeof setTimeout> | null;
  updateTask: Promise<void> | null;
  pendingUpdate: boolean;
  pendingForceUpdate: boolean;
  lastRenderedMessageText: string | null;
}

function createInitialPinnedMessageState(): PinnedMessageState {
  return {
    messageId: null,
    chatId: null,
    messageThreadId: undefined,
    createdInCurrentProcess: false,
    sessionId: null,
    sessionTitle: t("pinned.default_session_title"),
    projectName: "",
    tokensUsed: 0,
    tokensLimit: 0,
    lastUpdated: 0,
    changedFiles: [],
    cost: 0,
    cantEditFailCount: 0,
    cantEditFailMessageId: null,
  };
}

function createScopedPinnedRuntime(): ScopedPinnedRuntime {
  return {
    api: null,
    chatId: null,
    state: createInitialPinnedMessageState(),
    contextLimit: null,
    updateDebounceTimer: null,
    updateTask: null,
    pendingUpdate: false,
    pendingForceUpdate: false,
    lastRenderedMessageText: null,
  };
}

class PinnedMessageManager {
  private scopedRuntimes = new Map<string, ScopedPinnedRuntime>();

  private onKeyboardUpdateCallback?: (tokensUsed: number, tokensLimit: number) => void;
  private onTitleChangeCallback?: (newTitle: string) => void;

  private getScopeKey(): string {
    return getCurrentTelegramConversationScopeKey();
  }

  private getRuntime(scopeKey = this.getScopeKey()): ScopedPinnedRuntime {
    let runtime = this.scopedRuntimes.get(scopeKey);
    if (!runtime) {
      runtime = createScopedPinnedRuntime();
      this.scopedRuntimes.set(scopeKey, runtime);
    }
    return runtime;
  }

  private getSendMessageThreadOptions(
    runtime: ScopedPinnedRuntime,
  ): Parameters<Api["sendMessage"]>[2] {
    if (!runtime.state.messageThreadId || runtime.state.messageThreadId <= 0) {
      return undefined;
    }

    return {
      message_thread_id: runtime.state.messageThreadId,
    } as Parameters<Api["sendMessage"]>[2];
  }

  initialize(api: Api, chatId: number): void {
    const runtime = this.getRuntime();
    const scope = getCurrentTelegramConversationScope();
    runtime.api = api;
    runtime.chatId = chatId;
    runtime.state.chatId = chatId;
    runtime.state.messageThreadId = scope?.messageThreadId;

    const savedMessageId = getPinnedMessageId();
    if (savedMessageId) {
      runtime.state.messageId = savedMessageId;
      runtime.state.chatId = chatId;
      runtime.state.createdInCurrentProcess = false;
    }
  }

  async onSessionChange(sessionId: string, sessionTitle: string): Promise<void> {
    const runtime = this.getRuntime();
    logger.info(`[PinnedManager] Session changed: ${sessionId}, title: ${sessionTitle}`);

    runtime.state.tokensUsed = 0;
    runtime.state.cost = 0;
    runtime.state.sessionId = sessionId;
    runtime.state.sessionTitle = sessionTitle || t("pinned.default_session_title");

    const project = getCurrentProject();
    runtime.state.projectName =
      project?.name || this.extractProjectName(project?.worktree) || t("pinned.unknown");

    await this.fetchContextLimit();

    if (this.onKeyboardUpdateCallback && runtime.state.tokensLimit > 0) {
      this.onKeyboardUpdateCallback(runtime.state.tokensUsed, runtime.state.tokensLimit);
    }

    runtime.state.changedFiles = [];
    runtime.lastRenderedMessageText = null;
    runtime.pendingUpdate = false;
    runtime.pendingForceUpdate = false;

    await this.unpinOldMessage();
    await this.createPinnedMessage();
    await this.loadDiffsFromApi(sessionId);
  }

  async onSessionTitleUpdate(newTitle: string): Promise<void> {
    const runtime = this.getRuntime();
    if (runtime.state.sessionTitle !== newTitle && newTitle) {
      logger.debug(`[PinnedManager] Session title updated: ${newTitle}`);
      runtime.state.sessionTitle = newTitle;
      await this.updatePinnedMessage();
    }
  }

  async loadContextFromHistory(sessionId: string, directory: string): Promise<void> {
    const runtime = this.getRuntime();

    try {
      logger.debug(`[PinnedManager] Loading context from history for session: ${sessionId}`);

      const { data: messagesData, error } = await opencodeClient.session.messages({
        sessionID: sessionId,
        directory,
      });

      if (error || !messagesData) {
        logger.warn("[PinnedManager] Failed to load session history:", error);
        return;
      }

      let maxContextSize = 0;
      let totalCost = 0;
      logger.debug(`[PinnedManager] Processing ${messagesData.length} messages from history`);

      messagesData.forEach(({ info }) => {
        if (info.role === "assistant") {
          const assistantInfo = info as {
            summary?: boolean;
            tokens?: {
              input: number;
              cache?: { read: number };
            };
            cost?: number;
          };

          if (assistantInfo.summary) {
            return;
          }

          const input = assistantInfo.tokens?.input || 0;
          const cacheRead = assistantInfo.tokens?.cache?.read || 0;
          const contextSize = input + cacheRead;
          const cost = assistantInfo.cost || 0;

          if (contextSize > maxContextSize) {
            maxContextSize = contextSize;
          }

          totalCost += cost;
        }
      });

      runtime.state.tokensUsed = maxContextSize;
      runtime.state.cost = totalCost;
      runtime.state.sessionId = sessionId;

      logger.info(
        `[PinnedManager] Loaded context from history: ${runtime.state.tokensUsed} tokens, cost: $${runtime.state.cost.toFixed(2)}`,
      );

      await this.updatePinnedMessage();
    } catch (err) {
      logger.error("[PinnedManager] Error loading context from history:", err);
    }
  }

  async onSessionCompacted(sessionId: string, directory: string): Promise<void> {
    logger.info(`[PinnedManager] Session compacted, reloading context: ${sessionId}`);
    await this.loadContextFromHistory(sessionId, directory);
  }

  async onMessageComplete(tokens: TokensInfo): Promise<void> {
    const runtime = this.getRuntime();

    if (this.getContextLimit() === 0) {
      await this.fetchContextLimit();
    }

    runtime.state.tokensUsed = tokens.input + tokens.cacheRead;

    logger.debug(
      `[PinnedManager] Tokens updated: ${runtime.state.tokensUsed}/${runtime.state.tokensLimit}`,
    );

    await this.refreshSessionTitle();
    await this.updatePinnedMessage();
  }

  updateTokensSilent(tokens: TokensInfo): void {
    const runtime = this.getRuntime();
    runtime.state.tokensUsed = tokens.input + tokens.cacheRead;
    logger.debug(
      `[PinnedManager] Tokens updated (silent): ${runtime.state.tokensUsed}/${runtime.state.tokensLimit}`,
    );
  }

  async refresh(): Promise<void> {
    await this.updatePinnedMessage(true);
  }

  async onCostUpdate(cost: number): Promise<void> {
    const runtime = this.getRuntime();

    if (!Number.isFinite(cost) || cost === 0) {
      logger.debug("[PinnedManager] Ignoring non-impacting cost update");
      return;
    }

    const currentCost = runtime.state.cost || 0;
    runtime.state.cost = currentCost + cost;
    logger.debug(
      `[PinnedManager] Cost added: $${cost.toFixed(2)}, total session: $${(runtime.state.cost || 0).toFixed(2)}`,
    );
    await this.updatePinnedMessage();
  }

  setOnKeyboardUpdate(callback: (tokensUsed: number, tokensLimit: number) => void): void {
    this.onKeyboardUpdateCallback = callback;
    logger.debug("[PinnedManager] Keyboard update callback registered");

    const runtime = this.getRuntime();
    const limit =
      runtime.state.tokensLimit > 0 ? runtime.state.tokensLimit : (runtime.contextLimit ?? 0);
    if (limit > 0) {
      callback(runtime.state.tokensUsed, limit);
    }
  }

  setOnTitleChange(callback: (newTitle: string) => void): void {
    this.onTitleChangeCallback = callback;
    logger.debug(`[PinnedManager] Title change callback registered`);
  }

  getContextInfo(): { tokensUsed: number; tokensLimit: number } | null {
    const runtime = this.getRuntime();
    const limit =
      runtime.state.tokensLimit > 0 ? runtime.state.tokensLimit : (runtime.contextLimit ?? 0);
    if (limit === 0) {
      return null;
    }
    return {
      tokensUsed: runtime.state.tokensUsed,
      tokensLimit: limit,
    };
  }

  getContextLimit(): number {
    const runtime = this.getRuntime();
    return runtime.contextLimit || runtime.state.tokensLimit || 0;
  }

  async refreshContextLimit(): Promise<void> {
    await this.fetchContextLimit();
  }

  async onSessionDiff(diffs: FileChange[]): Promise<void> {
    const runtime = this.getRuntime();

    if (diffs.length === 0 && runtime.state.changedFiles.length > 0) {
      logger.debug("[PinnedManager] Ignoring empty session.diff, keeping tool-collected data");
      return;
    }

    if (this.areFileDiffsEqual(runtime.state.changedFiles, diffs)) {
      logger.debug("[PinnedManager] Ignoring unchanged session.diff");
      return;
    }

    runtime.state.changedFiles = diffs;
    logger.debug(`[PinnedManager] Session diff updated: ${diffs.length} files`);
    await this.updatePinnedMessage();
  }

  addFileChange(change: FileChange): void {
    const runtime = this.getRuntime();
    const existing = runtime.state.changedFiles.find((f) => f.file === change.file);
    if (existing) {
      existing.additions += change.additions;
      existing.deletions += change.deletions;
      if (change.tool) existing.tool = change.tool;
      if (change.readOffset) existing.readOffset = change.readOffset;
      if (change.readLimit) existing.readLimit = change.readLimit;
    } else {
      runtime.state.changedFiles.push({ ...change });
    }
    logger.debug(
      `[PinnedManager] File change added: ${change.file} (+${change.additions} -${change.deletions}), total: ${runtime.state.changedFiles.length}`,
    );

    this.scheduleDebouncedUpdate();
  }

  private scheduleDebouncedUpdate(): void {
    const runtime = this.getRuntime();
    if (runtime.updateDebounceTimer) {
      clearTimeout(runtime.updateDebounceTimer);
    }
    const updateScope = getCurrentTelegramConversationScope();
    runtime.updateDebounceTimer = setTimeout(() => {
      runtime.updateDebounceTimer = null;
      runWithTelegramConversationScope(updateScope, () => {
        void this.updatePinnedMessage();
      });
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async loadDiffsFromApi(sessionId: string): Promise<void> {
    const runtime = this.getRuntime();

    try {
      const project = getCurrentProject();
      if (!project) {
        logger.debug("[PinnedManager] loadDiffsFromApi: no project");
        return;
      }

      const { data, error } = await opencodeClient.session.diff({
        sessionID: sessionId,
        directory: project.worktree,
      });

      if (!error && data && data.length > 0) {
        runtime.state.changedFiles = data.map((d) => ({
          file: d.file,
          additions: d.additions,
          deletions: d.deletions,
        }));
        logger.info(
          `[PinnedManager] Loaded ${runtime.state.changedFiles.length} file diffs from session.diff()`,
        );
        await this.updatePinnedMessage();
        return;
      }

      logger.debug("[PinnedManager] session.diff() empty, trying loadDiffsFromMessages()");
      await this.loadDiffsFromMessages(sessionId, project.worktree);
    } catch (err) {
      logger.debug("[PinnedManager] Could not load diffs from API:", err);
    }
  }

  private async loadDiffsFromMessages(sessionId: string, directory: string): Promise<void> {
    const runtime = this.getRuntime();

    try {
      const { data: messagesData, error } = await opencodeClient.session.messages({
        sessionID: sessionId,
        directory,
      });

      if (error || !messagesData) {
        return;
      }

      const filesMap = new Map<string, FileChange>();

      for (const { parts } of messagesData) {
        for (const part of parts) {
          if (part.type !== "tool") continue;

          const toolPart = part as {
            tool: string;
            state: {
              status: string;
              input?: { [key: string]: unknown };
              metadata?: { [key: string]: unknown };
            };
          };

          if (toolPart.state.status !== "completed") continue;

          if (
            (toolPart.tool === "edit" || toolPart.tool === "apply_patch") &&
            toolPart.state.metadata &&
            "filediff" in toolPart.state.metadata
          ) {
            const filediff = toolPart.state.metadata.filediff as {
              file?: string;
              additions?: number;
              deletions?: number;
            };
            if (filediff.file) {
              const existing = filesMap.get(filediff.file);
              if (existing) {
                existing.additions += filediff.additions || 0;
                existing.deletions += filediff.deletions || 0;
                existing.tool = toolPart.tool;
              } else {
                filesMap.set(filediff.file, {
                  file: filediff.file,
                  additions: filediff.additions || 0,
                  deletions: filediff.deletions || 0,
                  tool: toolPart.tool,
                });
              }
            }
          } else if (
            toolPart.tool === "write" &&
            toolPart.state.input &&
            "filePath" in toolPart.state.input &&
            "content" in toolPart.state.input
          ) {
            const filePath = toolPart.state.input.filePath as string;
            const content = toolPart.state.input.content as string;
            const lines = content.split("\n").length;
            const existing = filesMap.get(filePath);
            if (existing) {
              existing.additions += lines;
              existing.tool = "write";
            } else {
              filesMap.set(filePath, {
                file: filePath,
                additions: lines,
                deletions: 0,
                tool: "write",
              });
            }
          } else if (
            toolPart.tool === "read" &&
            toolPart.state.input &&
            "filePath" in toolPart.state.input
          ) {
            const filePath = toolPart.state.input.filePath as string;
            const offset = typeof toolPart.state.input.offset === "number" ? toolPart.state.input.offset : undefined;
            const limit = typeof toolPart.state.input.limit === "number" ? toolPart.state.input.limit : undefined;
            const existing = filesMap.get(filePath);
            if (existing) {
              existing.tool = "read";
              if (offset) existing.readOffset = offset;
              if (limit) existing.readLimit = limit;
            } else {
              filesMap.set(filePath, {
                file: filePath,
                additions: 0,
                deletions: 0,
                tool: "read",
                readOffset: offset,
                readLimit: limit,
              });
            }
          }
        }
      }

      if (filesMap.size > 0) {
        runtime.state.changedFiles = Array.from(filesMap.values());
        logger.info(
          `[PinnedManager] Loaded ${runtime.state.changedFiles.length} file diffs from messages`,
        );
        await this.updatePinnedMessage();
      }
    } catch (err) {
      logger.debug("[PinnedManager] Could not load diffs from messages:", err);
    }
  }

  private async refreshSessionTitle(): Promise<void> {
    const runtime = this.getRuntime();
    const session = getCurrentSession();
    const project = getCurrentProject();

    if (!session || !project) {
      return;
    }

    try {
      const { data: sessionData } = await opencodeClient.session.get({
        sessionID: session.id,
        directory: project.worktree,
      });

      if (sessionData && sessionData.title !== runtime.state.sessionTitle) {
        runtime.state.sessionTitle = sessionData.title;
        logger.debug(`[PinnedManager] Session title refreshed: ${sessionData.title}`);
      }
    } catch (err) {
      logger.debug("[PinnedManager] Could not refresh session title:", err);
    }
  }

  private extractProjectName(worktree: string | undefined): string {
    if (!worktree) return "";
    const parts = worktree.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
  }

  private makeRelativePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const project = getCurrentProject();

    if (project?.worktree) {
      const worktree = project.worktree.replace(/\\/g, "/");
      if (normalized.startsWith(worktree)) {
        let relative = normalized.slice(worktree.length);
        if (relative.startsWith("/")) {
          relative = relative.slice(1);
        }
        return relative || normalized;
      }
    }

    const segments = normalized.split("/");
    if (segments.length <= 3) return normalized;
    return ".../" + segments.slice(-3).join("/");
  }

  private areFileDiffsEqual(current: FileChange[], next: FileChange[]): boolean {
    if (current.length !== next.length) {
      return false;
    }

    for (let index = 0; index < current.length; index++) {
      const left = current[index];
      const right = next[index];
      if (
        left.file !== right.file ||
        left.additions !== right.additions ||
        left.deletions !== right.deletions
      ) {
        return false;
      }
    }

    return true;
  }

  private async fetchContextLimit(): Promise<void> {
    const runtime = this.getRuntime();

    try {
      const model = getStoredModel();
      runtime.contextLimit = await getModelContextLimit(model.providerID, model.modelID);
      runtime.state.tokensLimit = runtime.contextLimit;
      logger.debug(`[PinnedManager] Context limit: ${runtime.contextLimit}`);
    } catch (err) {
      logger.error("[PinnedManager] Error fetching context limit:", err);
      runtime.contextLimit = DEFAULT_CONTEXT_LIMIT;
      runtime.state.tokensLimit = runtime.contextLimit;
    }
  }

  private formatMessage(): string {
    const runtime = this.getRuntime();
    const currentModel = getStoredModel();
    const modelName = formatModelDisplayName(currentModel.providerID, currentModel.modelID);

    const lines = [
      `${runtime.state.sessionTitle}`,
      t("pinned.line.project", { project: runtime.state.projectName }),
      t("pinned.line.model", { model: modelName }),
      formatContextLine(runtime.state.tokensUsed, runtime.state.tokensLimit),
    ];

    if (runtime.state.cost !== undefined && runtime.state.cost !== null) {
      lines.push(formatCostLine(runtime.state.cost));
    }

    if (runtime.state.changedFiles.length > 0) {
      const maxFiles = 10;
      const total = runtime.state.changedFiles.length;
      const filesToShow = runtime.state.changedFiles.slice(0, maxFiles);

      lines.push("");
      lines.push(t("pinned.files.title", { count: total }));

      for (const f of filesToShow) {
        const relativePath = this.makeRelativePath(f.file);
        const { emoji, action } = this.fileActionLabel(f);
        const stats =
          f.tool === "read" ? formatLineRange(f) : formatDiffStats(f);
        lines.push(`${emoji} ${action} — \`${relativePath}\` ${stats}`);
      }

      if (total > maxFiles) {
        lines.push(t("pinned.files.more", { count: total - maxFiles }));
      }
    }

    return lines.join("\n");
  }

  private fileActionLabel(change: FileChange): { emoji: string; action: string } {
    switch (change.tool) {
      case "read":
        return { emoji: "📄", action: t("pinned.file_action.read") };
      case "write":
        return { emoji: "✍️", action: t("pinned.file_action.write") };
      case "edit":
        return { emoji: "✏️", action: t("pinned.file_action.edit") };
      case "apply_patch":
        return { emoji: "🧩", action: t("pinned.file_action.patch") };
      case "bash":
        return { emoji: "💻", action: t("pinned.file_action.command") };
      default:
        if (change.additions > 0 && change.deletions > 0) {
          return { emoji: "✏️", action: t("pinned.file_action.edit") };
        }
        if (change.additions > 0) {
          return { emoji: "✍️", action: t("pinned.file_action.write") };
        }
        return { emoji: "📄", action: t("pinned.file_action.read") };
    }
  }

  private async createPinnedMessage(): Promise<void> {
    const runtime = this.getRuntime();

    if (!runtime.api || !runtime.chatId) {
      logger.warn("[PinnedManager] API or chatId not initialized");
      return;
    }

    try {
      const text = this.formatMessage();
      const keyboard = keyboardManager.getKeyboard();
      const sendOptions = this.getSendMessageThreadOptions(runtime) ?? {};
      if (keyboard) {
        (sendOptions as Record<string, unknown>).reply_markup = keyboard;
      }
      const sentMessage = await runtime.api.sendMessage(
        runtime.chatId,
        text,
        sendOptions as any,
      );

      runtime.state.messageId = sentMessage.message_id;
      runtime.state.chatId = runtime.chatId;
      runtime.state.createdInCurrentProcess = true;
      runtime.state.lastUpdated = Date.now();
      runtime.lastRenderedMessageText = text;
      runtime.state.cantEditFailCount = 0;

      setPinnedMessageId(sentMessage.message_id);
      keyboardManager.setKeyboardMessageId(sentMessage.message_id);

      await runtime.api.pinChatMessage(runtime.chatId, sentMessage.message_id, {
        disable_notification: true,
      });

      if (this.onKeyboardUpdateCallback && runtime.state.tokensLimit > 0) {
        this.onKeyboardUpdateCallback(runtime.state.tokensUsed, runtime.state.tokensLimit);
      }

      logger.info(`[PinnedManager] Created and pinned message: ${sentMessage.message_id}`);
    } catch (err) {
      logger.error("[PinnedManager] Error creating pinned message:", err);
    }
  }

  private async updatePinnedMessage(forceUpdate: boolean = false): Promise<void> {
    const runtime = this.getRuntime();

    if (!runtime.api || !runtime.chatId || !runtime.state.messageId) {
      return;
    }

    runtime.pendingUpdate = true;
    if (forceUpdate) {
      runtime.pendingForceUpdate = true;
    }

    if (runtime.updateTask) {
      await runtime.updateTask;
      return;
    }

    runtime.updateTask = this.flushPendingPinnedUpdates().finally(() => {
      runtime.updateTask = null;
    });

    await runtime.updateTask;
  }

  private async flushPendingPinnedUpdates(): Promise<void> {
    const runtime = this.getRuntime();

    while (runtime.pendingUpdate) {
      runtime.pendingUpdate = false;
      const shouldForceUpdate = runtime.pendingForceUpdate;
      runtime.pendingForceUpdate = false;

      if (!runtime.api || !runtime.chatId || !runtime.state.messageId) {
        return;
      }

      const text = this.formatMessage();

      if (!shouldForceUpdate && text === runtime.lastRenderedMessageText) {
        logger.debug("[PinnedManager] Skipping pinned update: message content unchanged");
        continue;
      }

      try {
        await runtime.api.editMessageText(runtime.chatId, runtime.state.messageId, text);
        runtime.state.lastUpdated = Date.now();
        runtime.lastRenderedMessageText = text;

        logger.debug(`[PinnedManager] Updated pinned message: ${runtime.state.messageId}`);

        if (this.onKeyboardUpdateCallback && runtime.state.tokensLimit > 0) {
          const keyboardUpdateScope = getCurrentTelegramConversationScope();
          setImmediate(() => {
            runWithTelegramConversationScope(keyboardUpdateScope, () => {
              this.onKeyboardUpdateCallback?.(runtime.state.tokensUsed, runtime.state.tokensLimit);
            });
          });
        }
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

        if (errorMessage.includes("message is not modified")) {
          runtime.lastRenderedMessageText = text;
          continue;
        }

        if (errorMessage.includes("message to edit not found")) {
          logger.warn("[PinnedManager] Pinned message was deleted, recreating...");
          runtime.state.messageId = null;
          runtime.lastRenderedMessageText = null;
          runtime.pendingForceUpdate = false;
          clearPinnedMessageId();
          await this.createPinnedMessage();
          continue;
        }

        logger.error("[PinnedManager] Error updating pinned message:", err);
      }
    }
  }

  private async unpinOldMessage(): Promise<void> {
    const runtime = this.getRuntime();

    if (!runtime.api || !runtime.chatId) {
      return;
    }

    try {
      // Unpin all chat messages for a clean state before creating new pinned message.
      // Using unpinAllChatMessages ensures no stale pins remain.
      await runtime.api.unpinAllChatMessages(runtime.chatId).catch(() => {});

      runtime.state.messageId = null;
      runtime.lastRenderedMessageText = null;
      runtime.pendingUpdate = false;
      runtime.pendingForceUpdate = false;
      clearPinnedMessageId();

      logger.debug("[PinnedManager] Unpinned old messages");
    } catch (err) {
      logger.error("[PinnedManager] Error unpinning messages:", err);
    }
  }

  getState(): PinnedMessageState {
    const runtime = this.getRuntime();
    return {
      ...runtime.state,
      changedFiles: runtime.state.changedFiles.map((change) => ({ ...change })),
    };
  }

  isInitialized(): boolean {
    const runtime = this.getRuntime();
    return runtime.api !== null && runtime.chatId !== null;
  }

  async clear(): Promise<void> {
    const runtime = this.getRuntime();

    if (!runtime.api || !runtime.chatId) {
      runtime.state = createInitialPinnedMessageState();
      runtime.lastRenderedMessageText = null;
      runtime.pendingUpdate = false;
      runtime.pendingForceUpdate = false;
      clearPinnedMessageId();
      return;
    }

    try {
      await this.unpinOldMessage();

      runtime.state = createInitialPinnedMessageState();
      runtime.lastRenderedMessageText = null;
      runtime.pendingUpdate = false;
      runtime.pendingForceUpdate = false;
      clearPinnedMessageId();

      logger.info("[PinnedManager] Cleared pinned message state");
    } catch (err) {
      logger.error("[PinnedManager] Error clearing pinned message:", err);
    }
  }
}

export function __resetPinnedMessageManagersForTests(): void {
  for (const runtime of pinnedMessageManager["scopedRuntimes"].values()) {
    if (runtime.updateDebounceTimer) {
      clearTimeout(runtime.updateDebounceTimer);
    }
  }
  pinnedMessageManager["scopedRuntimes"] = new Map<string, ScopedPinnedRuntime>();
  pinnedMessageManager["onKeyboardUpdateCallback"] = undefined;
}

export const pinnedMessageManager = new PinnedMessageManager();
