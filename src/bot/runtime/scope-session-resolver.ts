import type { Context } from "grammy";
import type { SessionInfo } from "../../settings/manager.js";
import {
  extractTelegramConversationScopeFromContext,
  runWithTelegramConversationScope,
  type TelegramConversationScope,
} from "../../telegram/scope.js";
import { attachManager } from "../../attach/manager.js";
import { getCurrentSession } from "../../session/manager.js";

export interface ResolvedScopedSession {
  session: SessionInfo;
  scope: TelegramConversationScope;
}

export function resolveScopedSessionFromContext(
  ctx: Context,
): ResolvedScopedSession | null {
  const scope = extractTelegramConversationScopeFromContext(ctx);
  if (!scope) {
    return null;
  }

  const attached = attachManager.getAttachedSession(scope);
  if (attached) {
    return { session: attached, scope };
  }

  const fallback = runWithTelegramConversationScope(scope, () =>
    getCurrentSession(),
  );
  if (fallback) {
    return { session: fallback, scope };
  }

  return null;
}
