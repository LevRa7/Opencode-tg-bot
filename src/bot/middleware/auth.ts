import { Context, InlineKeyboard, NextFunction } from "grammy";
import { config } from "../../config.js";
import {
  getApprovedTelegramUserIds,
  getPendingAccessRequests,
  setApprovedTelegramUserIds,
  setPendingAccessRequests,
  getUserDeployTarget,
  getUserLocale,
  type AccessApprovalRequest,
} from "../../settings/manager.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";
import { syncAuthorizedChatCommands } from "../utils/command-sync.js";

const ACCESS_REQUEST_COOLDOWN_MS = 60 * 60 * 1000;

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

function isAdmin(userId: number | undefined): boolean {
  return typeof userId === "number" && userId === config.telegram.adminUserId;
}

function isApprovedUser(userId: number | undefined): boolean {
  if (typeof userId !== "number") {
    return false;
  }

  if (isAdmin(userId)) {
    return true;
  }

  const approvedUserIds = new Set<number>([
    ...config.telegram.allowedUserIds,
    ...getApprovedTelegramUserIds(),
  ]);

  if (!approvedUserIds.has(config.telegram.adminUserId)) {
    approvedUserIds.add(config.telegram.adminUserId);
    void setApprovedTelegramUserIds(Array.from(approvedUserIds));
  }

  return approvedUserIds.has(userId);
}

function buildAccessRequestKeyboard(userId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("auth.button.approve"), `access:approve:${userId}`)
    .text(t("auth.button.deny"), `access:deny:${userId}`);
}

function formatUserLabel(ctx: Context): string {
  const firstName = ctx.from?.first_name?.trim();
  const lastName = ctx.from?.last_name?.trim();
  const username = ctx.from?.username?.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (fullName && username) {
    return `${fullName} (@${username})`;
  }

  if (fullName) {
    return fullName;
  }

  if (username) {
    return `@${username}`;
  }

  return t("common.unknown");
}

async function buildAccessRequestText(ctx: Context): Promise<string> {
  const lines = [
    t("auth.request.title"),
    t("auth.request.user", { user: formatUserLabel(ctx) }),
    t("auth.request.user_id", { userId: ctx.from?.id ?? "-" }),
    t("auth.request.chat_id", { chatId: ctx.chat?.id ?? "-" }),
    t("auth.request.chat_type", { chatType: ctx.chat?.type ?? "-" }),
    ctx.from?.language_code
      ? t("auth.request.language", { language: ctx.from.language_code })
      : null,
  ];
  // Include pending VM deployment info if available
  try {
    const userId = ctx.from?.id;
    if (userId) {
      const { getPendingVmDeployment } = await import("../handlers/onboarding-flow.js");
      const pending = getPendingVmDeployment(userId);
      if (pending) {
        const { VM_TIERS } = await import("../../vm/types.js");
        const spec = VM_TIERS[pending.tier];
        lines.push(`\n📋 VM: ${spec.ramMb / 1024}GB / ${spec.vcpus} vCPU / ${spec.diskGb}GB (${pending.tier})`);
        if (pending.ipv6) {
          lines.push(`🌐 IPv6: ${pending.ipv6}`);
        }
      }
    }
  } catch { /* ignore */ }
  return lines.filter(Boolean).join("\n");
}

async function hideCommandsForUnauthorizedPrivateChat(ctx: Context): Promise<void> {
  if (!ctx.chat?.id || !isPrivateChat(ctx)) {
    return;
  }

  try {
    await Promise.all([
      ctx.api.setMyCommands([], {
        scope: { type: "chat", chat_id: ctx.chat.id },
      }),
      ctx.api.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: { type: "default" },
      }),
    ]);
    logger.debug(`[Auth] Hid commands for unauthorized chat_id=${ctx.chat.id}`);
  } catch (err) {
    logger.debug(`[Auth] Could not hide commands for chat_id=${ctx.chat.id}: ${err}`);
  }
}

function isApprovalRequestCooldownActive(request: AccessApprovalRequest): boolean {
  const lastNotifiedAt = Date.parse(request.lastNotifiedAt ?? request.requestedAt);
  if (!Number.isFinite(lastNotifiedAt)) {
    return false;
  }

  return Date.now() - lastNotifiedAt < ACCESS_REQUEST_COOLDOWN_MS;
}

export async function upsertPendingApprovalRequest(ctx: Context, requesterMessageId?: number): Promise<boolean> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) {
    return false;
  }

  const pendingRequests = getPendingAccessRequests();
  const existingRequestIndex = pendingRequests.findIndex((request) => request.userId === userId);
  const existingRequest =
    existingRequestIndex >= 0 ? pendingRequests[existingRequestIndex] : undefined;

  if (existingRequest && isApprovalRequestCooldownActive(existingRequest)) {
    logger.debug(`[Auth] Approval request cooldown active for userId=${userId}`);
    return false;
  }

  const nowIso = new Date().toISOString();
  const nextRequest: AccessApprovalRequest = {
    userId,
    chatId,
    chatType: ctx.chat?.type,
    username: ctx.from?.username,
    firstName: ctx.from?.first_name,
    lastName: ctx.from?.last_name,
    languageCode: ctx.from?.language_code,
    requestedAt: existingRequest?.requestedAt ?? nowIso,
    lastNotifiedAt: nowIso,
    adminChatId: config.telegram.adminUserId,
    adminMessageId: existingRequest?.adminMessageId,
    requesterMessageId: requesterMessageId ?? existingRequest?.requesterMessageId,
  };

  const text = await buildAccessRequestText(ctx);
  const keyboard = buildAccessRequestKeyboard(userId);

  if (typeof existingRequest?.adminMessageId === "number") {
    try {
      await ctx.api.editMessageText(
        config.telegram.adminUserId,
        existingRequest.adminMessageId,
        text,
        {
          reply_markup: keyboard,
        },
      );
      pendingRequests[existingRequestIndex] = nextRequest;
      await setPendingAccessRequests(pendingRequests);
      return true;
    } catch (error) {
      logger.debug(`[Auth] Failed to update existing access request message: ${error}`);
    }
  }

  // Try to send a fresh admin message (best-effort — save request even on failure)
  try {
    const message = await ctx.api.sendMessage(config.telegram.adminUserId, text, {
      reply_markup: keyboard,
    });
    nextRequest.adminMessageId = message.message_id;
  } catch (sendError) {
    logger.error("[Auth] Failed to send admin approval request — saving for retry", sendError);
    // Clear adminMessageId so next attempt won't try to edit a stale message
    nextRequest.adminMessageId = undefined;
  }

  // Always persist the request so it can be retried — never dead-end
  if (existingRequestIndex >= 0) {
    pendingRequests[existingRequestIndex] = nextRequest;
  } else {
    pendingRequests.push(nextRequest);
  }

  await setPendingAccessRequests(pendingRequests);
  return true;
}

function getPendingApprovalRequest(userId: number): AccessApprovalRequest | undefined {
  return getPendingAccessRequests().find((request) => request.userId === userId);
}

async function removePendingApprovalRequest(userId: number): Promise<AccessApprovalRequest | null> {
  const pendingRequests = getPendingAccessRequests();
  const nextPendingRequests = pendingRequests.filter((request) => request.userId !== userId);

  if (nextPendingRequests.length === pendingRequests.length) {
    return null;
  }

  const removedRequest = pendingRequests.find((request) => request.userId === userId) ?? null;
  await setPendingAccessRequests(nextPendingRequests);
  return removedRequest;
}

async function approveTelegramUser(userId: number): Promise<void> {
  const approvedUserIds = new Set<number>([
    ...config.telegram.allowedUserIds,
    ...getApprovedTelegramUserIds(),
    config.telegram.adminUserId,
    userId,
  ]);

  await setApprovedTelegramUserIds(Array.from(approvedUserIds));
}

function formatApprovedUserLabel(request: AccessApprovalRequest): string {
  const fullName = [request.firstName?.trim(), request.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  const username = request.username?.trim();

  if (fullName && username) {
    return `${fullName} (@${username})`;
  }

  if (fullName) {
    return fullName;
  }

  if (username) {
    return `@${username}`;
  }

  return `${request.userId}`;
}

function buildAccessDecisionText(
  action: "approve" | "deny",
  request: AccessApprovalRequest,
  adminUserId: number | undefined,
): string {
  const emoji = action === "approve" ? "✅" : "❌";
  const actionLabel =
    action === "approve" ? t("auth.decision.approved") : t("auth.decision.denied");
  const decidedByLabel =
    typeof adminUserId === "number"
      ? t("auth.decision.decided_by", { adminUserId })
      : t("auth.decision.decided_by", { adminUserId: t("common.unknown") });

  return [
    `${emoji} ${actionLabel}`,
    t("auth.decision.user", { user: formatApprovedUserLabel(request) }),
    t("auth.decision.user_id", { userId: request.userId }),
    t("auth.decision.chat_id", { chatId: request.chatId }),
    request.chatType ? t("auth.decision.chat_type", { chatType: request.chatType }) : null,
    request.languageCode ? t("auth.decision.language", { language: request.languageCode }) : null,
    t("auth.decision.requested_at", { requestedAt: request.requestedAt }),
    decidedByLabel,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleAccessApprovalCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("access:")) {
    return false;
  }

  if (!isAdmin(ctx.from?.id)) {
    await ctx.answerCallbackQuery({ text: t("auth.error.admin_only"), show_alert: true });
    return true;
  }

  const [, action, userIdRaw] = data.split(":");
  const userId = Number(userIdRaw);
  if ((action !== "approve" && action !== "deny") || !Number.isInteger(userId) || userId <= 0) {
    await ctx.answerCallbackQuery({ text: t("callback.processing_error"), show_alert: true });
    return true;
  }

  const request = getPendingApprovalRequest(userId);
  if (!request) {
    await ctx.answerCallbackQuery({ text: t("auth.error.request_not_pending"), show_alert: true });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    return true;
  }

  if (action === "approve") {
    await approveTelegramUser(userId);
  }

  // Answer the callback immediately — do NOT await VM deployment inside the
  // callback handler. Telegram requires answerCallbackQuery within ~30s;
  // VM provisioning + health check takes 30–300s and would cause the button
  // to hang with a spinning indicator.
  await ctx.answerCallbackQuery({
    text: action === "approve" ? t("auth.decision.approved") : t("auth.decision.denied"),
  });

  await removePendingApprovalRequest(userId);

  const decisionText = buildAccessDecisionText(action, request, ctx.from?.id);
  await ctx.editMessageText(decisionText, { reply_markup: undefined }).catch(async () => {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  });

  if (request.chatId) {
    if (action === "approve" && request.chatType === "private") {
      await syncAuthorizedChatCommands(ctx.api, request.chatId, request.chatType, false).catch(
        (error) => {
          logger.warn(
            `[Auth] Failed to restore commands for approved user ${request.userId}: ${error}`,
          );
        },
      );
    }

    const requesterMessage =
      action === "approve" ? t("auth.requester.approved") : t("auth.requester.denied");

    // Always send approval confirmation as a NEW message so the user gets a notification.
    // Do not edit requesterMessageId — that was already used for the VM deployment message
    // and edits don't trigger push notifications in Telegram.
    if (request.chatId) {
      await ctx.api.sendMessage(request.chatId, requesterMessage).catch(() => {});
    }
  }

  // VM deployment is a long-running operation (provisioning 30–90s + health check up to 300s).
  // Offload to a background task so the callback returns immediately.
  if (action === "approve") {
    safeBackgroundTask({
      taskName: `vm-deploy-after-approval.${userId}`,
      task: async () => {
        try {
          const { getPendingVmDeployment, deployPendingVm, removePendingVmDeployment } =
            await import("../handlers/onboarding-flow.js");
          const pending = getPendingVmDeployment(userId);
          if (pending) {
            const result = await deployPendingVm(userId);
            const ipv6 = pending.ipv6 ?? "TBD";
            const vmMsg = result.success
              ? t("vm.onboarding.vm_ready", { ipv6 })
              : t("vm.onboarding.vm_failed", { error: result.error || "unknown error" });
            if (request.requesterMessageId && request.chatId) {
              await ctx.api.editMessageText(request.chatId, request.requesterMessageId, vmMsg).catch(() => {});
            } else if (request.chatId) {
              await ctx.api.sendMessage(request.chatId, vmMsg).catch(() => {});
            }
            removePendingVmDeployment(userId);
          }
        } catch (err) {
          logger.warn("[Auth] Failed to deploy VM after approval:", err);
        }
      },
    });
  }

  return true;
}

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  // Skip auth for the bot's own service messages (forum_topic_edited,
  // pinned_message, etc.) — these appear with the bot's ID as the sender
  // because the bot created the topic/pinned the message.
  if (userId === ctx.me?.id) {
    await next();
    return;
  }

  logger.debug(
    `[Auth] Checking access: userId=${userId}, adminUserId=${config.telegram.adminUserId}, hasCallbackQuery=${!!ctx.callbackQuery}, hasMessage=${!!ctx.message}`,
  );

  if (isApprovedUser(userId)) {
    logger.debug(`[Auth] Access granted for userId=${userId}`);
    await next();
    return;
  }

  logger.warn(`Unauthorized access attempt from user ID: ${userId}`);

  // Allow onboarding callbacks for unauthorized users (language/config selection)
  const data = (ctx.callbackQuery as { data?: string } | undefined)?.data;
  if (data && (data.startsWith("onboarding:") || data.startsWith("access:"))) {
    await next();
    return;
  }

  // New user without any settings — allow through for onboarding, then request access
  if (userId && isPrivateChat(ctx) && !ctx.callbackQuery) {
    const locale = getUserLocale();
    const deployTarget = getUserDeployTarget(userId);
    const needsOnboarding = !locale || !deployTarget;

    if (needsOnboarding) {
      await next();
      return;
    }
  }

  await hideCommandsForUnauthorizedPrivateChat(ctx);
  // Send approval request for ANY chat type (private, group, supergroup, forum)
  // where a real user is messaging. Previously restricted to private chats only,
  // which silently dropped forum messages from unauthorized users.
  const isMessagableChat = typeof ctx.from?.id === "number" && !!ctx.chat?.id;
  const approvalRequestSent = isMessagableChat ? await upsertPendingApprovalRequest(ctx) : false;

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: t("auth.callback.pending_approval") }).catch(() => {});
    return;
  }

  if (approvalRequestSent) {
    await ctx.reply(t("auth.requester.sent")).catch(() => {});
  }
}
