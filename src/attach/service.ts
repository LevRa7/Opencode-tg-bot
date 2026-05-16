import type { SessionInfo } from "../settings/manager.js";
import type { Context } from "grammy";
import type { PermissionRequest } from "../permission/types.js";
import { permissionManager } from "../permission/manager.js";
import { questionManager } from "../question/manager.js";
import {
  buildTelegramConversationScopeKey,
  getCurrentTelegramConversationScope,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { ConversationContextKey } from "../thread/conversation-context-key.js";
import { threadContextManager } from "../thread/manager.js";
import { logger } from "../utils/logger.js";
import { attachManager } from "./manager.js";

export type AttachSessionReason = "new_session" | "selected_session" | "prompt" | "startup_restore";

export interface AttachUiRestorer {
  restoreQuestion: () => Promise<void>;
  restorePermission: (request: PermissionRequest) => Promise<void>;
}

function getUserIdFromScopeKey(scopeKey: string): number | null {
  return ConversationContextKey.parse(scopeKey)?.userId ?? null;
}

export async function attachSessionForScope(options: {
  scope: TelegramConversationScope;
  session: SessionInfo;
  reason: AttachSessionReason;
  botApi?: Context["api"];
  restoreQuestion?: () => Promise<void>;
  restorePermission?: (request: PermissionRequest) => Promise<void>;
}): Promise<void> {
  const scopeKey = buildTelegramConversationScopeKey(options.scope);

  attachManager.attach(options.scope, options.session);

  if (threadContextManager.isActiveScope(options.scope)) {
    threadContextManager.bindSessionToActiveContext(options.session);
  }

  logger.info(
    `[Attach] Session attached: reason=${options.reason}, sessionId=${options.session.id}, scope=${scopeKey}`,
  );

  const restoreQuestion = options.restoreQuestion;
  const restorePermission = options.restorePermission;

  if (!restoreQuestion || !restorePermission) {
    return;
  }

  permissionManager.clearMismatchedTargetScopeRequests(options.session.id, scopeKey);

  const questionRestorePlan = questionManager.previewSessionRestore(options.session.id, scopeKey);
  if (questionRestorePlan && getUserIdFromScopeKey(questionRestorePlan.sourceScopeKey) === options.scope.userId) {
    questionManager.stageSessionRestore(questionRestorePlan);

    try {
      await restoreQuestion();
      questionManager.commitSessionRestore(questionRestorePlan);
    } catch (error) {
      questionManager.rollbackSessionRestore(questionRestorePlan);
      throw error;
    }
  }

  const permissionRestorePlan = permissionManager.previewSessionRestore(options.session.id, scopeKey);
  const sameUserPermissionRestorePlan = {
    ...permissionRestorePlan,
    entries: permissionRestorePlan.entries.filter(
      (entry) => getUserIdFromScopeKey(entry.sourceScopeKey) === options.scope.userId,
    ),
  };
  const preservedPermissionMessageIds = new Set(permissionManager.getMessageIds(scopeKey));

  try {
    for (const entry of sameUserPermissionRestorePlan.entries) {
      await restorePermission(entry.request);
    }

    permissionManager.commitSessionRestore(sameUserPermissionRestorePlan);
  } catch (error) {
    for (const messageId of permissionManager.getMessageIds(scopeKey)) {
      if (preservedPermissionMessageIds.has(messageId)) {
        continue;
      }

      const request = permissionManager.getRequest(messageId, scopeKey);
      if (request?.sessionID === options.session.id) {
        permissionManager.removeByMessageId(messageId, scopeKey);
      }
    }

    throw error;
  }
}

export function detachAttachedSession(_reason: string): void {
  const scope = getCurrentTelegramConversationScope();
  if (!scope) {
    return;
  }

  const state = attachManager.getStateForScope(scope);
  if (!state) {
    return;
  }

  summaryAggregator.clear();
  attachManager.detach(scope);
}
