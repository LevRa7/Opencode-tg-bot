/**
 * Bot Control API — request/response types.
 *
 * All endpoints accept JSON bodies and return JSON responses.
 * Auth: X-API-Key header matching BOT_CONTROL_API_KEY env var.
 */

// ─── Common ───────────────────────────────────────────────────────────────────

export interface ControlTarget {
  /** Telegram chat ID (required for all messaging endpoints) */
  chat_id: number;
  /** Message thread ID for forum topics */
  message_thread_id?: number;
}

export interface ControlResponse {
  ok: boolean;
  error?: string;
  result?: unknown;
}

// ─── POST /api/control/message ────────────────────────────────────────────────

export interface SendMessageRequest extends ControlTarget {
  /** Message text (MarkdownV2 supported) */
  text: string;
  /** Parse mode: "MarkdownV2", "HTML", or undefined for plain text */
  parse_mode?: "MarkdownV2" | "HTML";
  /** Disable web page preview */
  disable_web_page_preview?: boolean;
  /** Protect from forwarding/copying */
  protect_content?: boolean;
  /** Send silently (no notification) */
  disable_notification?: boolean;
  /** Inline keyboard markup */
  reply_markup?: InlineKeyboardMarkup;
}

export interface SendMessageResponse {
  message_id: number;
  chat: { id: number; type: string };
  date: number;
}

// ─── POST /api/control/edit ───────────────────────────────────────────────────

export interface EditMessageRequest extends ControlTarget {
  /** ID of the message to edit */
  message_id: number;
  /** New text */
  text: string;
  parse_mode?: "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
  reply_markup?: InlineKeyboardMarkup;
}

// ─── DELETE /api/control/message ──────────────────────────────────────────────

export interface DeleteMessageRequest extends ControlTarget {
  message_id: number;
}

// ─── POST /api/control/photo ──────────────────────────────────────────────────

export interface SendPhotoRequest extends ControlTarget {
  /** Photo as base64-encoded data, URL, or file_id */
  photo: string;
  /** Caption text */
  caption?: string;
  parse_mode?: "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboardMarkup;
}

// ─── POST /api/control/document ───────────────────────────────────────────────

export interface SendDocumentRequest extends ControlTarget {
  /** Document as base64-encoded data, URL, or file_id */
  document: string;
  /** Optional filename when sending raw data */
  filename?: string;
  caption?: string;
  parse_mode?: "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboardMarkup;
}

// ─── POST /api/control/keyboard ───────────────────────────────────────────────

export interface SendKeyboardRequest extends ControlTarget {
  /** Message text */
  text: string;
  /** Inline keyboard */
  keyboard: InlineKeyboard;
  parse_mode?: "MarkdownV2" | "HTML";
}

// ─── POST /api/control/poll ───────────────────────────────────────────────────

export interface SendPollRequest extends ControlTarget {
  question: string;
  options: string[];
  is_anonymous?: boolean;
  allows_multiple_answers?: boolean;
}

// ─── POST /api/control/action ─────────────────────────────────────────────────

export interface SendChatActionRequest extends ControlTarget {
  action:
    | "typing"
    | "upload_photo"
    | "record_video"
    | "upload_video"
    | "record_voice"
    | "upload_voice"
    | "upload_document"
    | "choose_sticker"
    | "find_location"
    | "record_video_note"
    | "upload_video_note";
}

// ─── POST /api/control/pin ────────────────────────────────────────────────────

export interface PinMessageRequest extends ControlTarget {
  message_id: number;
  disable_notification?: boolean;
}

// ─── POST /api/control/unpin ──────────────────────────────────────────────────

export interface UnpinMessageRequest extends ControlTarget {
  message_id?: number;
}

// ─── POST /api/control/callback ───────────────────────────────────────────────

export interface SimulateCallbackRequest extends ControlTarget {
  /** Callback data string */
  data: string;
  /** Optional callback query ID to answer */
  callback_query_id?: string;
}

// ─── GET /api/control/state ───────────────────────────────────────────────────

export interface BotStateResponse {
  bot: {
    username: string;
    id: number;
    can_join_groups: boolean;
    can_read_all_group_messages: boolean;
    supports_inline_queries: boolean;
  } | null;
  session: {
    id: string;
    title: string;
    project?: string;
  } | null;
  project: {
    id: string;
    name: string;
    worktree?: string;
  } | null;
  model: {
    providerID: string;
    modelID: string;
    variant?: string;
  } | null;
  agent: string | null;
  keyboard_active: boolean;
  sessions_count: number;
  opencode_healthy: boolean;
}

// ─── POST /api/control/state ──────────────────────────────────────────────────

export interface SetStateRequest {
  session_id?: string;
  project_id?: string;
  model_id?: string;
  agent_name?: string;
}

// ─── GET /api/control/sessions ────────────────────────────────────────────────

export interface SessionListResponse {
  sessions: Array<{
    id: string;
    title: string;
    project?: string;
    updatedAt?: string;
  }>;
  current_session_id: string | null;
  count: number;
}

// ─── GET /api/control/health ──────────────────────────────────────────────────

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  bot: {
    running: boolean;
    username: string | null;
  };
  opencode: {
    reachable: boolean;
    url: string | null;
  };
  uptime_ms: number;
}

// ─── POST /api/control/forward ────────────────────────────────────────────────

export interface ForwardMessageRequest {
  /** Source chat ID */
  from_chat_id: number;
  /** Message ID to forward */
  message_id: number;
  /** Target (sent to chat_id in ControlTarget) */
  chat_id: number;
  message_thread_id?: number;
  disable_notification?: boolean;
  protect_content?: boolean;
}

// ─── POST /api/control/copy ───────────────────────────────────────────────────

export interface CopyMessageRequest {
  from_chat_id: number;
  message_id: number;
  chat_id: number;
  message_thread_id?: number;
  caption?: string;
  parse_mode?: "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboardMarkup;
  disable_notification?: boolean;
  protect_content?: boolean;
}

// ─── Keyboard types ───────────────────────────────────────────────────────────

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
  login_url?: {
    url: string;
    forward_text?: string;
    bot_username?: string;
    request_write_access?: boolean;
  };
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
  switch_inline_query_chosen_chat?: {
    query?: string;
    allow_bot_chats?: boolean;
    allow_user_chats?: boolean;
    allow_group_chats?: boolean;
  };
  copy_text?: { text: string };
  pay?: boolean;
}

export type InlineKeyboard = InlineKeyboardButton[][];

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboard;
}

// ─── Route map ────────────────────────────────────────────────────────────────

export type ControlApiRoute =
  | "message"
  | "edit"
  | "delete"
  | "photo"
  | "document"
  | "keyboard"
  | "poll"
  | "action"
  | "pin"
  | "unpin"
  | "callback"
  | "state"
  | "sessions"
  | "health"
  | "forward"
  | "copy";
