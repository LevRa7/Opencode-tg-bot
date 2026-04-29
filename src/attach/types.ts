import type { SessionInfo } from "../settings/manager.js";
import type { TelegramConversationScope } from "../telegram/scope.js";

export interface AttachedSessionState {
  scope: TelegramConversationScope;
  session: SessionInfo;
  attachedAt: string;
  busy: boolean;
  lastEventId?: string;
}
