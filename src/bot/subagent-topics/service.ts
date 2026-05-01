import type { TelegramThreadTarget } from "../utils/message-thread.js";
import { logger } from "../../utils/logger.js";

export interface SubagentTopicDeliveryTarget extends TelegramThreadTarget {
  messageThreadId: number;
  disableNotification: true;
}

export interface SubagentTopicScope {
  kind: "topic";
  childSessionId: string;
  chatId: number;
  messageThreadId: number;
}

export interface SubagentFallbackScope {
  kind: "fallback";
  childSessionId: string;
  chatId: number;
}

export type SubagentSessionScope = SubagentTopicScope | SubagentFallbackScope;

export interface SyncSubagentTopicInput {
  childSessionId: string;
  topicName: string;
  parent: {
    chatId: number;
    isForum: boolean;
  };
}

export interface MarkFinalResponseDeliveredInput {
  terminalStatus: string;
  autoDeleteMinutes?: number;
}

export interface SubagentTopicDeletionHandle {
  cancel(): void;
}

export type SubagentTopicScheduler = (
  run: () => Promise<void>,
  delayMs: number,
) => SubagentTopicDeletionHandle;

export interface SubagentTopicServiceDependencies {
  createForumTopic: (input: { chatId: number; name: string }) => Promise<{ messageThreadId: number }>;
  deleteForumTopic: (input: { chatId: number; messageThreadId: number }) => Promise<void>;
  scheduleDeletion?: SubagentTopicScheduler;
}

interface SubagentTopicRegistryEntry {
  scope: SubagentSessionScope;
  target: SubagentTopicDeliveryTarget | null;
  deletionHandle: SubagentTopicDeletionHandle | null;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted", "cancelled", "errored"]);

function createDefaultDeletionScheduler(): SubagentTopicScheduler {
  return (run, delayMs) => {
    const timeout = setTimeout(() => {
      void run();
    }, Math.max(0, delayMs));

    return {
      cancel: () => clearTimeout(timeout),
    };
  };
}

function toDeletionDelayMs(autoDeleteMinutes: number | undefined): number | null {
  if (typeof autoDeleteMinutes !== "number" || !Number.isFinite(autoDeleteMinutes) || autoDeleteMinutes < 0) {
    return null;
  }

  return Math.floor(autoDeleteMinutes * 60 * 1000);
}

export class SubagentTopicService {
  private readonly createForumTopic: SubagentTopicServiceDependencies["createForumTopic"];
  private readonly deleteForumTopic: SubagentTopicServiceDependencies["deleteForumTopic"];
  private readonly scheduleDeletion: SubagentTopicScheduler;
  private readonly registry = new Map<string, SubagentTopicRegistryEntry>();

  constructor(dependencies: SubagentTopicServiceDependencies) {
    this.createForumTopic = dependencies.createForumTopic;
    this.deleteForumTopic = dependencies.deleteForumTopic;
    this.scheduleDeletion = dependencies.scheduleDeletion ?? createDefaultDeletionScheduler();
  }

  async syncSubagent(input: SyncSubagentTopicInput): Promise<SubagentSessionScope> {
    const existingEntry = this.registry.get(input.childSessionId);
    if (existingEntry && (existingEntry.scope.kind === "topic" || input.parent.isForum === false)) {
      return existingEntry.scope;
    }

    if (!input.parent.isForum) {
      const fallbackScope: SubagentFallbackScope = {
        kind: "fallback",
        childSessionId: input.childSessionId,
        chatId: input.parent.chatId,
      };

      this.registry.set(input.childSessionId, {
        scope: fallbackScope,
        target: null,
        deletionHandle: null,
      });

      return fallbackScope;
    }

    const createdTopic = await this.createForumTopic({
      chatId: input.parent.chatId,
      name: input.topicName,
    });

    const topicScope: SubagentTopicScope = {
      kind: "topic",
      childSessionId: input.childSessionId,
      chatId: input.parent.chatId,
      messageThreadId: createdTopic.messageThreadId,
    };

    this.registry.set(input.childSessionId, {
      scope: topicScope,
      target: {
        chatId: input.parent.chatId,
        messageThreadId: createdTopic.messageThreadId,
        disableNotification: true,
      },
      deletionHandle: null,
    });

    return topicScope;
  }

  getScopeForSession(sessionId: string): SubagentSessionScope | null {
    return this.registry.get(sessionId)?.scope ?? null;
  }

  getTargetForSession(sessionId: string): SubagentTopicDeliveryTarget | null {
    return this.registry.get(sessionId)?.target ?? null;
  }

  markFinalResponseDelivered(sessionId: string, input: MarkFinalResponseDeliveredInput): void {
    if (!TERMINAL_STATUSES.has(input.terminalStatus)) {
      logger.debug("[SubagentTopicService] markFinalResponseDelivered skipped: non-terminal status", {
        sessionId,
        terminalStatus: input.terminalStatus,
      });
      return;
    }

    const entry = this.registry.get(sessionId);
    if (!entry) {
      logger.debug("[SubagentTopicService] markFinalResponseDelivered skipped: no registry entry", {
        sessionId,
      });
      return;
    }

    if (entry.scope.kind !== "topic") {
      logger.debug("[SubagentTopicService] markFinalResponseDelivered skipped: not a topic scope", {
        sessionId,
        scopeKind: entry.scope.kind,
      });
      return;
    }

    if (entry.deletionHandle) {
      logger.debug("[SubagentTopicService] markFinalResponseDelivered skipped: deletion already scheduled", {
        sessionId,
      });
      return;
    }

    const delayMs = toDeletionDelayMs(input.autoDeleteMinutes);
    if (delayMs === null) {
      logger.debug("[SubagentTopicService] markFinalResponseDelivered skipped: null delay", {
        sessionId,
        autoDeleteMinutes: input.autoDeleteMinutes,
      });
      return;
    }

    logger.debug("[SubagentTopicService] Scheduling subagent topic deletion", {
      sessionId,
      chatId: entry.scope.chatId,
      messageThreadId: "messageThreadId" in entry.scope ? entry.scope.messageThreadId : undefined,
      delayMs,
    });

    const topicScope = entry.scope;
    entry.deletionHandle = this.scheduleDeletion(async () => {
      try {
        logger.debug("[SubagentTopicService] Deleting subagent topic", {
          sessionId,
          chatId: topicScope.chatId,
          messageThreadId: "messageThreadId" in topicScope ? topicScope.messageThreadId : undefined,
        });
        await this.deleteForumTopic({
          chatId: topicScope.chatId,
          messageThreadId: (topicScope as SubagentTopicScope).messageThreadId,
        });
        this.registry.delete(sessionId);
        logger.debug("[SubagentTopicService] Subagent topic deleted", { sessionId });
      } catch (error) {
        logger.error("[SubagentTopicService] Failed to delete scheduled subagent topic", {
          sessionId,
          chatId: topicScope.chatId,
          messageThreadId: "messageThreadId" in topicScope ? topicScope.messageThreadId : undefined,
          error,
        });
        entry.deletionHandle = null;
      }
    }, delayMs);
  }

  clearSession(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    entry?.deletionHandle?.cancel();
    this.registry.delete(sessionId);
  }

  cancelPendingDeletion(sessionId: string): void {
    const entry = this.registry.get(sessionId);
    if (!entry?.deletionHandle) {
      return;
    }

    entry.deletionHandle.cancel();
    entry.deletionHandle = null;
  }

  clearAll(): void {
    for (const sessionId of this.registry.keys()) {
      this.clearSession(sessionId);
    }
  }
}
