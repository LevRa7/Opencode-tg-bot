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
  topicName?: string;
  lastKnownTitle?: string;
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
  createForumTopic: (input: {
    chatId: number;
    name: string;
  }) => Promise<{ messageThreadId: number }>;
  deleteForumTopic: (input: { chatId: number; messageThreadId: number }) => Promise<void>;
  scheduleDeletion?: SubagentTopicScheduler;
}

type TopicLifecycleState =
  | "active"
  | "terminal_pending_delivery"
  | "delivery_confirmed"
  | "cleanup_pending"
  | "deleted";

export interface SubagentTopicLifecycleSnapshot {
  lifecycleState: TopicLifecycleState;
  terminalStatus: string | null;
  finalDeliveryConfirmed: boolean;
}

interface SubagentTopicRegistryEntry {
  scope: SubagentSessionScope;
  target: SubagentTopicDeliveryTarget | null;
  deletionHandle: SubagentTopicDeletionHandle | null;
  lifecycleState: TopicLifecycleState;
  terminalStatus: string | null;
  finalDeliveryConfirmed: boolean;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted", "cancelled", "errored"]);
const SUBAGENT_TOPIC_PREFIX = "Agent: ";
const LEADING_AGENT_PREFIX = /^agent\s*:\s*/i;

function normalizeSubagentTopicName(name: string): string {
  const trimmedName = name.trim();
  const withoutPrefix = trimmedName.replace(LEADING_AGENT_PREFIX, "").trim();
  const canonicalName = withoutPrefix || "Subagent";
  return `${SUBAGENT_TOPIC_PREFIX}${canonicalName}`;
}

function createDefaultDeletionScheduler(): SubagentTopicScheduler {
  return (run, delayMs) => {
    const timeout = setTimeout(
      () => {
        void run();
      },
      Math.max(0, delayMs),
    );

    return {
      cancel: () => clearTimeout(timeout),
    };
  };
}

function toDeletionDelayMs(autoDeleteMinutes: number | undefined): number | null {
  if (
    typeof autoDeleteMinutes !== "number" ||
    !Number.isFinite(autoDeleteMinutes) ||
    autoDeleteMinutes < 0
  ) {
    return null;
  }

  return Math.floor(autoDeleteMinutes * 60 * 1000);
}

function deriveLifecycleStateAfterCleanupCancellation(
  entry: Pick<SubagentTopicRegistryEntry, "finalDeliveryConfirmed" | "terminalStatus">,
): Exclude<TopicLifecycleState, "cleanup_pending" | "deleted"> {
  if (entry.finalDeliveryConfirmed) {
    return "delivery_confirmed";
  }

  if (entry.terminalStatus) {
    return "terminal_pending_delivery";
  }

  return "active";
}

export class SubagentTopicService {
  private readonly createForumTopic: SubagentTopicServiceDependencies["createForumTopic"];
  private readonly deleteForumTopic: SubagentTopicServiceDependencies["deleteForumTopic"];
  private readonly scheduleDeletion: SubagentTopicScheduler;
  private readonly registry = new Map<string, SubagentTopicRegistryEntry>();
  private readonly stoppedSessionIds = new Set<string>();

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

    const normalizedTopicName = normalizeSubagentTopicName(input.topicName);

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
        lifecycleState: "active",
        terminalStatus: null,
        finalDeliveryConfirmed: false,
      });

      return fallbackScope;
    }

    const createdTopic = await this.createForumTopic({
      chatId: input.parent.chatId,
      name: normalizedTopicName,
    });

    const topicScope: SubagentTopicScope = {
      kind: "topic",
      childSessionId: input.childSessionId,
      chatId: input.parent.chatId,
      messageThreadId: createdTopic.messageThreadId,
      topicName: normalizedTopicName,
    };

    this.registry.set(input.childSessionId, {
      scope: topicScope,
      target: {
        chatId: input.parent.chatId,
        messageThreadId: createdTopic.messageThreadId,
        disableNotification: true,
      },
      deletionHandle: null,
      lifecycleState: "active",
      terminalStatus: null,
      finalDeliveryConfirmed: false,
    });

    return topicScope;
  }

  getScopeForSession(sessionId: string): SubagentSessionScope | null {
    return this.registry.get(sessionId)?.scope ?? null;
  }

  getTargetForSession(sessionId: string): SubagentTopicDeliveryTarget | null {
    return this.registry.get(sessionId)?.target ?? null;
  }

  getLifecycleStateForSession(sessionId: string): SubagentTopicLifecycleSnapshot | null {
    const entry = this.registry.get(sessionId);
    if (!entry) {
      return null;
    }

    return {
      lifecycleState: entry.lifecycleState,
      terminalStatus: entry.terminalStatus,
      finalDeliveryConfirmed: entry.finalDeliveryConfirmed,
    };
  }

  markTerminalStatus(sessionId: string, terminalStatus: string): void {
    if (!TERMINAL_STATUSES.has(terminalStatus)) {
      logger.debug("[SubagentTopicService] markTerminalStatus skipped: non-terminal status", {
        sessionId,
        terminalStatus,
      });
      return;
    }

    const entry = this.registry.get(sessionId);
    if (!entry) {
      logger.debug("[SubagentTopicService] markTerminalStatus skipped: no registry entry", {
        sessionId,
      });
      return;
    }

    if (entry.scope.kind !== "topic") {
      logger.debug("[SubagentTopicService] markTerminalStatus skipped: not a topic scope", {
        sessionId,
        scopeKind: entry.scope.kind,
      });
      return;
    }

    entry.terminalStatus = terminalStatus;
    entry.lifecycleState = "terminal_pending_delivery";
  }

  confirmFinalDelivery(sessionId: string, autoDeleteMinutes?: number): void {
    const entry = this.registry.get(sessionId);
    if (!entry) {
      logger.debug("[SubagentTopicService] confirmFinalDelivery skipped: no registry entry", {
        sessionId,
      });
      return;
    }

    if (entry.scope.kind !== "topic") {
      logger.debug("[SubagentTopicService] confirmFinalDelivery skipped: not a topic scope", {
        sessionId,
        scopeKind: entry.scope.kind,
      });
      return;
    }

    if (!entry.terminalStatus || !TERMINAL_STATUSES.has(entry.terminalStatus)) {
      logger.debug("[SubagentTopicService] confirmFinalDelivery skipped: terminal status missing", {
        sessionId,
        terminalStatus: entry.terminalStatus,
      });
      return;
    }

    if (entry.deletionHandle) {
      entry.finalDeliveryConfirmed = true;
      entry.lifecycleState = "cleanup_pending";
      logger.debug(
        "[SubagentTopicService] confirmFinalDelivery skipped: deletion already scheduled",
        {
          sessionId,
        },
      );
      return;
    }

    entry.finalDeliveryConfirmed = true;
    entry.lifecycleState = "delivery_confirmed";

    const delayMs = toDeletionDelayMs(autoDeleteMinutes);
    if (delayMs === null) {
      logger.debug("[SubagentTopicService] confirmFinalDelivery skipped: null delay", {
        sessionId,
        autoDeleteMinutes,
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
    entry.lifecycleState = "cleanup_pending";
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
        entry.lifecycleState = "deleted";
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
        entry.lifecycleState = "delivery_confirmed";
      }
    }, delayMs);
  }

  markDeliveryCleanupPending(sessionId: string, terminalStatus: string): void {
    if (!TERMINAL_STATUSES.has(terminalStatus)) {
      logger.debug(
        "[SubagentTopicService] markDeliveryCleanupPending skipped: non-terminal status",
        {
          sessionId,
          terminalStatus,
        },
      );
      return;
    }

    const entry = this.registry.get(sessionId);
    if (!entry) {
      logger.debug("[SubagentTopicService] markDeliveryCleanupPending skipped: no registry entry", {
        sessionId,
      });
      return;
    }

    if (entry.scope.kind !== "topic") {
      logger.debug(
        "[SubagentTopicService] markDeliveryCleanupPending skipped: not a topic scope",
        {
          sessionId,
          scopeKind: entry.scope.kind,
        },
      );
      return;
    }

    entry.terminalStatus = terminalStatus;
    entry.lifecycleState = "cleanup_pending";
  }

  markFinalResponseDelivered(sessionId: string, input: MarkFinalResponseDeliveredInput, telegraphUrl?: string): void {
    this.markTerminalStatus(sessionId, input.terminalStatus);
    if (telegraphUrl) {
      const entry = this.registry.get(sessionId);
      if (entry) {
        (entry as any).formattedStatus = `✅ ${input.terminalStatus} — [Отчёт](${telegraphUrl})`;
      }
    }
    this.confirmFinalDelivery(sessionId, input.autoDeleteMinutes);
  }

  markSubagentStopped(sessionId: string): void {
    this.stoppedSessionIds.add(sessionId);
    this.clearSession(sessionId);
  }

  getLinkState(sessionId: string): { kind: "active"; url: string } | { kind: "stopped" } | null {
    if (this.stoppedSessionIds.has(sessionId)) {
      return { kind: "stopped" };
    }

    const entry = this.registry.get(sessionId);
    if (!entry || entry.scope.kind !== "topic") {
      return null;
    }

    return {
      kind: "active",
      url: `https://t.me/c/${entry.scope.chatId}/${entry.scope.messageThreadId}`,
    };
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
    entry.lifecycleState = deriveLifecycleStateAfterCleanupCancellation(entry);
  }

  clearAll(): void {
    for (const sessionId of this.registry.keys()) {
      this.clearSession(sessionId);
    }
  }
}
