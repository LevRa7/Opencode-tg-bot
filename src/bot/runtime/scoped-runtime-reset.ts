import { clearAllInteractionState } from "../../interaction/cleanup.js";
import {
  buildTelegramConversationScopeKey,
  type TelegramConversationScope,
} from "../../telegram/scope.js";
import { summaryAggregator } from "../../summary/aggregator.js";

export function clearScopedSessionRuntime(
  sessionId: string,
  reason: string,
  options?: { scope?: TelegramConversationScope },
): void {
  summaryAggregator.clearSession(sessionId);
  clearAllInteractionState(
    reason,
    options?.scope ? buildTelegramConversationScopeKey(options.scope) : undefined,
  );
}

export function clearSessionTreeRuntime(
  rootSessionId: string,
  reason: string,
  subagentTopicService: {
    clearSession(sessionId: string): void;
    markSubagentStopped(sessionId: string): void;
  },
  options?: { scope?: TelegramConversationScope },
): void {
  const tree = summaryAggregator.getSessionTree(rootSessionId);

  for (const childSessionId of tree.childSessionIds) {
    clearScopedSessionRuntime(childSessionId, reason, options);
    subagentTopicService.markSubagentStopped(childSessionId);
    subagentTopicService.clearSession(childSessionId);
  }

  clearScopedSessionRuntime(rootSessionId, reason, options);
}
