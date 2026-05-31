export interface UserPreferencesRow {
  user_id: number;
  tts_enabled: number;
  message_streaming_enabled: number;
  thinking_clear_mode: number;
  locale: string | null;
  hide_thinking_messages: number;
  hide_tool_call_messages: number;
  hide_tool_file_messages: number;
  telegraph_translate_enabled: number;
  subagent_topics_enabled: number;
  subagent_topic_auto_delete_minutes: number;
  default_project: string | null;
  default_agent: string | null;
  default_model: string | null;
}

export interface ConversationBindingsRow {
  scope_key: string;
  project: string | null;
  session: string | null;
  agent: string | null;
  model: string | null;
  pinned_message_id: number | null;
  reasoning_mode: number | null;
}

export interface ApprovedUserRow {
  user_id: number;
}

export interface AccessRequestRow {
  id: number;
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  requested_at: string;
}

export interface SchedulingDataRow {
  key: string;
  data: string;
}

export interface ServerProcessRow {
  key: string;
  data: string | null;
}

export interface TenantRuntimeRow {
  user_id: number;
  data: string;
}

export interface AttachedSessionRow {
  scope_key: string;
  session: string | null;
}

export interface SessionDirectoryCacheRow {
  scope_key: string;
  data: string;
}

export interface ThreadContextBindingRow {
  id: number;
  context_key: string;
  project: string | null;
  session: string | null;
  agent: string | null;
  model: string | null;
}

export interface LastRestartRequestRow {
  key: string;
  data: string;
}
