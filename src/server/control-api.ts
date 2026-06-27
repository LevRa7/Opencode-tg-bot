/**
 * Bot Control API — HTTP handler for programmatic bot control.
 *
 * Provides REST endpoints for sending messages, managing inline keyboards,
 * querying state, triggering commands, and simulating interactions.
 * Designed for testing, automation, and external integrations.
 *
 * Auth: X-API-Key header, validated against BOT_CONTROL_API_KEY env var
 *       or a random key generated at startup (logged to console).
 *
 * Routes:
 *   GET  /api/control/health     — Bot + OpenCode health
 *   GET  /api/control/state      — Full bot state snapshot
 *   POST /api/control/state      — Set session/project/model/agent
 *   GET  /api/control/sessions   — List sessions
 *   POST /api/control/message    — Send message
 *   POST /api/control/edit       — Edit message
 *   DELETE /api/control/message  — Delete message
 *   POST /api/control/photo      — Send photo
 *   POST /api/control/document   — Send document
 *   POST /api/control/keyboard   — Send message with inline keyboard
 *   POST /api/control/poll       — Send poll
 *   POST /api/control/action     — Send chat action (typing, ...)
 *   POST /api/control/pin        — Pin message
 *   POST /api/control/unpin      — Unpin message
 *   POST /api/control/callback   — Simulate callback query
 *   POST /api/control/forward    — Forward message
 *   POST /api/control/copy       — Copy message
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bot, Context as GrammyContext } from "grammy";
import { randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";
import type {
  SendMessageRequest,
  EditMessageRequest,
  DeleteMessageRequest,
  SendPhotoRequest,
  SendDocumentRequest,
  SendKeyboardRequest,
  SendPollRequest,
  SendChatActionRequest,
  PinMessageRequest,
  UnpinMessageRequest,
  SimulateCallbackRequest,
  BotStateResponse,
  SetStateRequest,
  SessionListResponse,
  HealthResponse,
  ForwardMessageRequest,
  CopyMessageRequest,
} from "./control-api-types.js";

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _apiKey: string | null = null;

function getApiKey(): string {
  if (_apiKey) return _apiKey;
  _apiKey = process.env.BOT_CONTROL_API_KEY || randomBytes(16).toString("hex");
  if (!process.env.BOT_CONTROL_API_KEY) {
    logger.info(`[ControlAPI] No BOT_CONTROL_API_KEY set. Generated: ${_apiKey}`);
  }
  return _apiKey;
}

export function getControlApiKey(): string {
  return getApiKey();
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const provided = (req.headers["x-api-key"] as string) || "";
  const expected = getApiKey();
  if (!provided || provided !== expected) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Unauthorized. Provide X-API-Key header." }));
    return false;
  }
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { ok: false, error });
}

function sendOk(res: ServerResponse, result?: unknown): void {
  sendJson(res, 200, { ok: true, result });
}

// ─── Route handler type ───────────────────────────────────────────────────────

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  bot: Bot<GrammyContext>,
  body: string,
) => Promise<void>;

// ─── Handlers ─────────────────────────────────────────────────────────────────

const handleHealth: RouteHandler = async (_req, res, bot, _body) => {
  const startTime = Date.now();
  let botRunning = false;
  let botUsername: string | null = null;
  let opencodeReachable = false;
  let opencodeUrl: string | null = null;

  try {
    const me = await bot.api.getMe();
    botRunning = true;
    botUsername = me.username;
  } catch {
    botRunning = false;
  }

  try {
    const { processManager } = await import("../process/manager.js");
    opencodeReachable = processManager.isRunning();
    if (opencodeReachable) {
      opencodeUrl = `http://127.0.0.1:${process.env.OPENCODE_PORT || "4096"}`;
    }
  } catch {
    opencodeReachable = false;
  }

  const response: HealthResponse = {
    status: botRunning && opencodeReachable ? "ok" : botRunning ? "degraded" : "error",
    bot: { running: botRunning, username: botUsername },
    opencode: { reachable: opencodeReachable, url: opencodeUrl },
    uptime_ms: Date.now() - startTime,
  };

  sendOk(res, response);
};

const handleGetState: RouteHandler = async (_req, res, bot, _body) => {
  try {
    const { getCurrentSession, getCurrentProject, getCurrentAgent } =
      await import("../settings/manager.js");
    const { getStoredModel } = await import("../model/manager.js");

    let me = null;
    try {
      me = await bot.api.getMe();
    } catch {
      /* ignore */
    }

    const session = getCurrentSession();
    const project = getCurrentProject();
    const model = getStoredModel();
    const agent = getCurrentAgent();

    let keyboardActive = false;
    try {
      const { keyboardManager } = await import("../keyboard/manager.js");
      // Check if any scope has been initialized
      keyboardActive =
        (keyboardManager as unknown as { getScopeCount(): number }).getScopeCount() > 0;
    } catch {
      /* ignore */
    }

    let sessionsCount = 0;
    let opencodeHealthy = false;
    try {
      const { opencodeClient } = await import("../opencode/client.js");
      const sessions = await (opencodeClient as any).session.list();
      sessionsCount = (sessions.data || []).length;
      opencodeHealthy = true;
    } catch {
      /* ignore */
    }

    const result: BotStateResponse = {
      bot: me
        ? {
            username: me.username,
            id: me.id,
            can_join_groups: me.can_join_groups,
            can_read_all_group_messages: me.can_read_all_group_messages,
            supports_inline_queries: me.supports_inline_queries,
          }
        : null,
      session: session ? { id: session.id, title: session.title } : null,
      project: project
        ? { id: project.id, name: project.name ?? project.id, worktree: project.worktree }
        : null,
      model,
      agent: agent ?? null,
      keyboard_active: keyboardActive,
      sessions_count: sessionsCount,
      opencode_healthy: opencodeHealthy,
    };

    sendOk(res, result);
  } catch (err) {
    logger.error("[ControlAPI] getState error", err);
    sendError(res, 500, "Failed to get bot state");
  }
};

const handleSetState: RouteHandler = async (req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SetStateRequest;

    if (data.session_id) {
      const { setCurrentSession } = await import("../session/manager.js");
      setCurrentSession({ id: data.session_id, title: "", directory: "" });
    }

    if (data.project_id) {
      const { setCurrentProject } = await import("../settings/manager.js");
      setCurrentProject({ id: data.project_id, name: data.project_id, worktree: "" });
    }

    if (data.model_id) {
      const { selectModel } = await import("../model/manager.js");
      // Model ID format: "providerID/modelID" or "providerID/modelID@variant"
      const match = data.model_id.match(/^([^/]+)\/([^@]+)(?:@(.+))?$/);
      if (match) {
        selectModel({ providerID: match[1], modelID: match[2], variant: match[3] });
      }
    }

    if (data.agent_name) {
      const { setCurrentAgent } = await import("../settings/manager.js");
      setCurrentAgent(data.agent_name);
    }

    sendOk(res, { changed: Object.keys(data).filter((k) => data[k as keyof SetStateRequest]) });
  } catch (err) {
    logger.error("[ControlAPI] setState error", err);
    sendError(res, 500, "Failed to set bot state");
  }
};

const handleListSessions: RouteHandler = async (_req, res, _bot, _body) => {
  try {
    const { opencodeClient } = await import("../opencode/client.js");
    const { getCurrentSession } = await import("../settings/manager.js");

    const sessions = await (opencodeClient as any).session.list();

    const current = getCurrentSession();

    const result: SessionListResponse = {
      sessions: (sessions.data || []).map(
        (s: { id: string; title: string; updatedAt?: string }) => ({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
        }),
      ),
      current_session_id: current?.id ?? null,
      count: (sessions.data || []).length,
    };

    sendOk(res, result);
  } catch (err) {
    logger.error("[ControlAPI] listSessions error", err);
    sendError(res, 500, "Failed to list sessions");
  }
};

const handleSendMessage: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SendMessageRequest;
    if (!data.chat_id || !data.text) {
      sendError(res, 400, "chat_id and text are required");
      return;
    }

    const msg = await bot.api.sendMessage(data.chat_id, data.text, {
      message_thread_id: data.message_thread_id,
      parse_mode: data.parse_mode,
      link_preview_options: data.disable_web_page_preview ? { is_disabled: true } : undefined,
      protect_content: data.protect_content,
      disable_notification: data.disable_notification,
      reply_markup: data.reply_markup as any,
    } as any);

    sendOk(res, {
      message_id: msg.message_id,
      chat: { id: msg.chat.id, type: msg.chat.type },
      date: msg.date,
    });
  } catch (err) {
    logger.error("[ControlAPI] sendMessage error", err);
    sendError(res, 500, `Failed to send message: ${(err as Error).message}`);
  }
};

const handleEditMessage: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as EditMessageRequest;
    if (!data.chat_id || !data.message_id || !data.text) {
      sendError(res, 400, "chat_id, message_id, and text are required");
      return;
    }

    const msg = await bot.api.editMessageText(data.chat_id, data.message_id, data.text, {
      message_thread_id: data.message_thread_id,
      parse_mode: data.parse_mode,
      link_preview_options: data.disable_web_page_preview ? { is_disabled: true } : undefined,
      reply_markup: data.reply_markup as any,
    } as any);

    sendOk(res, {
      message_id: typeof msg === "object" && "message_id" in msg ? msg.message_id : data.message_id,
    });
  } catch (err) {
    logger.error("[ControlAPI] editMessage error", err);
    sendError(res, 500, `Failed to edit message: ${(err as Error).message}`);
  }
};

const handleDeleteMessage: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as DeleteMessageRequest;
    if (!data.chat_id || !data.message_id) {
      sendError(res, 400, "chat_id and message_id are required");
      return;
    }

    await bot.api.deleteMessage(data.chat_id, data.message_id);
    sendOk(res);
  } catch (err) {
    logger.error("[ControlAPI] deleteMessage error", err);
    sendError(res, 500, `Failed to delete message: ${(err as Error).message}`);
  }
};

const handleSendPhoto: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SendPhotoRequest;
    if (!data.chat_id || !data.photo) {
      sendError(res, 400, "chat_id and photo are required");
      return;
    }

    let photo: string | Buffer = data.photo;

    // If base64 data URI, decode to Buffer
    if (data.photo.startsWith("data:")) {
      const base64 = data.photo.split(",")[1];
      if (base64) {
        photo = Buffer.from(base64, "base64");
      }
    }

    const msg = await bot.api.sendPhoto(data.chat_id, photo as string, {
      message_thread_id: data.message_thread_id,
      caption: data.caption,
      parse_mode: data.parse_mode,
      reply_markup: data.reply_markup as any,
    });

    sendOk(res, {
      message_id: msg.message_id,
      photo: msg.photo?.map((p) => ({ file_id: p.file_id, width: p.width, height: p.height })),
    });
  } catch (err) {
    logger.error("[ControlAPI] sendPhoto error", err);
    sendError(res, 500, `Failed to send photo: ${(err as Error).message}`);
  }
};

const handleSendDocument: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SendDocumentRequest;
    if (!data.chat_id || !data.document) {
      sendError(res, 400, "chat_id and document are required");
      return;
    }

    let document: string | Buffer = data.document;

    // If base64 data URI, decode to Buffer
    if (data.document.startsWith("data:")) {
      const base64 = data.document.split(",")[1];
      if (base64) {
        document = Buffer.from(base64, "base64");
      }
    }

    const msg = await bot.api.sendDocument(data.chat_id, document as string, {
      message_thread_id: data.message_thread_id,
      caption: data.caption,
      parse_mode: data.parse_mode,
      reply_markup: data.reply_markup as any,
    });

    sendOk(res, {
      message_id: msg.message_id,
      document: msg.document
        ? { file_id: msg.document.file_id, file_name: msg.document.file_name }
        : null,
    });
  } catch (err) {
    logger.error("[ControlAPI] sendDocument error", err);
    sendError(res, 500, `Failed to send document: ${(err as Error).message}`);
  }
};

const handleSendKeyboard: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SendKeyboardRequest;
    if (!data.chat_id || !data.keyboard) {
      sendError(res, 400, "chat_id and keyboard are required");
      return;
    }

    const msg = await bot.api.sendMessage(data.chat_id, data.text || ".", {
      message_thread_id: data.message_thread_id,
      parse_mode: data.parse_mode,
      reply_markup: { inline_keyboard: data.keyboard as any },
    });

    sendOk(res, {
      message_id: msg.message_id,
      chat: { id: msg.chat.id, type: msg.chat.type },
    });
  } catch (err) {
    logger.error("[ControlAPI] sendKeyboard error", err);
    sendError(res, 500, `Failed to send keyboard: ${(err as Error).message}`);
  }
};

const handleSendPoll: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SendPollRequest;
    if (!data.chat_id || !data.question || !data.options?.length) {
      sendError(res, 400, "chat_id, question, and options are required");
      return;
    }

    const msg = await bot.api.sendPoll(data.chat_id, data.question, data.options, {
      message_thread_id: data.message_thread_id,
      is_anonymous: data.is_anonymous ?? true,
      allows_multiple_answers: data.allows_multiple_answers ?? false,
    });

    sendOk(res, {
      message_id: msg.message_id,
      poll: msg.poll,
    });
  } catch (err) {
    logger.error("[ControlAPI] sendPoll error", err);
    sendError(res, 500, `Failed to send poll: ${(err as Error).message}`);
  }
};

const handleSendAction: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SendChatActionRequest;
    if (!data.chat_id || !data.action) {
      sendError(res, 400, "chat_id and action are required");
      return;
    }

    await bot.api.sendChatAction(data.chat_id, data.action, {
      message_thread_id: data.message_thread_id,
    });
    sendOk(res, { action: data.action });
  } catch (err) {
    logger.error("[ControlAPI] sendAction error", err);
    sendError(res, 500, `Failed to send chat action: ${(err as Error).message}`);
  }
};

const handlePinMessage: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as PinMessageRequest;
    if (!data.chat_id || !data.message_id) {
      sendError(res, 400, "chat_id and message_id are required");
      return;
    }

    await bot.api.pinChatMessage(data.chat_id, data.message_id, {
      disable_notification: data.disable_notification,
    });
    sendOk(res);
  } catch (err) {
    logger.error("[ControlAPI] pinMessage error", err);
    sendError(res, 500, `Failed to pin message: ${(err as Error).message}`);
  }
};

const handleUnpinMessage: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as UnpinMessageRequest;
    if (!data.chat_id) {
      sendError(res, 400, "chat_id is required");
      return;
    }

    await bot.api.unpinChatMessage(data.chat_id, data.message_id as any);
    sendOk(res);
  } catch (err) {
    logger.error("[ControlAPI] unpinMessage error", err);
    sendError(res, 500, `Failed to unpin message: ${(err as Error).message}`);
  }
};

const handleCallback: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as SimulateCallbackRequest;
    if (!data.chat_id || !data.data) {
      sendError(res, 400, "chat_id and data are required");
      return;
    }

    // Answer callback query if ID provided
    if (data.callback_query_id) {
      await bot.api.answerCallbackQuery(data.callback_query_id, {
        text: "Processed via control API",
      });
    }

    // NOTE: Full callback simulation requires creating a grammY Context object
    // with callback_query update. This is complex; the simple approach is
    // to just answer the query and let the user know the callback data.

    sendOk(res, {
      warning:
        "Callback query answered but not fully simulated. For full callback simulation, use grammY test helpers or send the callback via Telegram client.",
      callback_data: data.data,
    });
  } catch (err) {
    logger.error("[ControlAPI] callback error", err);
    sendError(res, 500, `Failed to handle callback: ${(err as Error).message}`);
  }
};

const handleForwardMessage: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as ForwardMessageRequest;
    if (!data.chat_id || !data.from_chat_id || !data.message_id) {
      sendError(res, 400, "chat_id, from_chat_id, and message_id are required");
      return;
    }

    const msg = await bot.api.forwardMessage(data.chat_id, data.from_chat_id, data.message_id, {
      message_thread_id: data.message_thread_id,
      disable_notification: data.disable_notification,
      protect_content: data.protect_content,
    });

    sendOk(res, {
      message_id: msg.message_id,
      chat: { id: msg.chat.id, type: msg.chat.type },
    });
  } catch (err) {
    logger.error("[ControlAPI] forwardMessage error", err);
    sendError(res, 500, `Failed to forward message: ${(err as Error).message}`);
  }
};

const handleCopyMessage: RouteHandler = async (_req, res, bot, body) => {
  try {
    const data = JSON.parse(body) as CopyMessageRequest;
    if (!data.chat_id || !data.from_chat_id || !data.message_id) {
      sendError(res, 400, "chat_id, from_chat_id, and message_id are required");
      return;
    }

    const result = await bot.api.copyMessage(data.chat_id, data.from_chat_id, data.message_id, {
      message_thread_id: data.message_thread_id,
      caption: data.caption,
      parse_mode: data.parse_mode,
      reply_markup: data.reply_markup as any,
      disable_notification: data.disable_notification,
      protect_content: data.protect_content,
    });

    sendOk(res, {
      message_id: result.message_id,
    });
  } catch (err) {
    logger.error("[ControlAPI] copyMessage error", err);
    sendError(res, 500, `Failed to copy message: ${(err as Error).message}`);
  }
};

// ─── Route table ──────────────────────────────────────────────────────────────

const ROUTES: Record<string, { method: string; handler: RouteHandler }> = {
  "GET /api/control/health": { method: "GET", handler: handleHealth },
  "GET /api/control/state": { method: "GET", handler: handleGetState },
  "POST /api/control/state": { method: "POST", handler: handleSetState },
  "GET /api/control/sessions": { method: "GET", handler: handleListSessions },
  "POST /api/control/message": { method: "POST", handler: handleSendMessage },
  "POST /api/control/edit": { method: "POST", handler: handleEditMessage },
  "DELETE /api/control/message": { method: "DELETE", handler: handleDeleteMessage },
  "POST /api/control/photo": { method: "POST", handler: handleSendPhoto },
  "POST /api/control/document": { method: "POST", handler: handleSendDocument },
  "POST /api/control/keyboard": { method: "POST", handler: handleSendKeyboard },
  "POST /api/control/poll": { method: "POST", handler: handleSendPoll },
  "POST /api/control/action": { method: "POST", handler: handleSendAction },
  "POST /api/control/pin": { method: "POST", handler: handlePinMessage },
  "POST /api/control/unpin": { method: "POST", handler: handleUnpinMessage },
  "POST /api/control/callback": { method: "POST", handler: handleCallback },
  "POST /api/control/forward": { method: "POST", handler: handleForwardMessage },
  "POST /api/control/copy": { method: "POST", handler: handleCopyMessage },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** Regex to match /api/control/* paths */
const CONTROL_API_PREFIX = /^\/api\/control(\/|$)/;

export function isControlApiPath(url: string): boolean {
  return CONTROL_API_PREFIX.test(url || "/");
}

/**
 * Handle a control API request.
 * Returns true if the request was handled, false if it's not a control API path.
 */
export async function handleControlApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bot: Bot<GrammyContext>,
): Promise<boolean> {
  const url = req.url || "/";
  if (!isControlApiPath(url)) return false;

  // Auth check
  if (!checkAuth(req, res)) return true; // Auth failed, but handled

  const routeKey = `${req.method} ${url}`;
  const route = ROUTES[routeKey];

  if (!route) {
    sendError(res, 404, `Unknown control API route: ${req.method} ${url}`);
    return true;
  }

  // Read body (empty for GET requests)
  let body = "";
  if (req.method !== "GET") {
    body = await readBody(req);
  }

  try {
    await route.handler(req, res, bot, body);
  } catch (err) {
    logger.error(`[ControlAPI] Unhandled error in ${routeKey}`, err);
    if (!res.headersSent) {
      sendError(res, 500, "Internal server error");
    }
  }

  return true;
}
