import { stopEventListening } from "../../opencode/events.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import {
  buildTelegramConversationScopeKey,
  type TelegramConversationScope,
} from "../../telegram/scope.js";
import { summaryAggregator } from "../../summary/aggregator.js";

export function clearScopedSessionRuntime(
  sessionId: string,
  reason: string,
  options?: { directory?: string; scope?: TelegramConversationScope },
): void {
  stopEventListening(options?.directory);
  clearAllInteractionState(
    reason,
    options?.scope ? buildTelegramConversationScopeKey(options.scope) : undefined,
  );
}

export async function clearSessionTreeRuntime(
  rootSessionId: string,
  reason: string,
  subagentTopicService: { clearSession(sessionId: string): void; markSubagentStopped(sessionId: string): void },
  options?: { directory?: string; scope?: TelegramConversationScope },
): Promise<void> {
  const tree = summaryAggregator.getSessionTree(rootSessionId);

  for (const childSessionId of tree.childSessionIds) {
    clearScopedSessionRuntime(childSessionId, reason, options);
    subagentTopicService.markSubagentStopped(childSessionId);
    subagentTopicService.clearSession(childSessionId);
  }

  clearScopedSessionRuntime(rootSessionId, reason, options);
}
