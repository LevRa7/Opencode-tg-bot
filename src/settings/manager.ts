import type { Locale } from "../i18n/index.js";
import type { ModelInfo } from "../model/types.js";
import type { ScheduledTask } from "../scheduled-task/types.js";
import {
  buildTelegramConversationScopeKey,
  getCurrentTelegramConversationScope,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import { config } from "../config.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { openDatabase, closeDatabase, SETTINGS_DDL } from "./db.js";
import { migrateIfNeeded } from "./migrate.js";
import {
  type UserPreferencesRepository,
  createUserPreferencesRepository,
} from "./repositories/user-preferences.js";
import {
  type ConversationBindingsRepository,
  createConversationBindingsRepository,
} from "./repositories/conversation-bindings.js";
import {
  type AccessControlRepository,
  createAccessControlRepository,
} from "./repositories/access-control.js";
import {
  type SchedulingRepository,
  createSchedulingRepository,
} from "./repositories/scheduling.js";
import {
  type RuntimeRepository,
  createRuntimeRepository,
} from "./repositories/runtime.js";
import {
  type SessionAttachmentsRepository,
  createSessionAttachmentsRepository,
} from "./repositories/session-attachments.js";
import {
  type ContextBindingsRepository,
  createContextBindingsRepository,
} from "./repositories/context-bindings.js";
import Database from "better-sqlite3";

// ====== TYPE EXPORTS (unchanged from original) ======

export interface ProjectInfo {
  id: string;
  worktree: string;
  name?: string;
}

export type ReasoningMode = 0 | 1 | 2;

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface ServerProcessInfo {
  pid: number;
  startTime: string;
}

export interface TenantRuntimeInfo {
  userId: number;
  chatId: number;
  port: number;
  baseUrl: string;
  pid?: number;
  startTime?: string;
  tenantId: string;
}

export interface SessionDirectoryCacheInfo {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: Array<{
    worktree: string;
    lastUpdated: number;
  }>;
}

export interface ScheduledTaskSessionIgnoreInfo {
  sessionId: string;
  createdAt: string;
}

export interface LastRestartRequest {
  updateId: number;
  requestedAt: string;
  chatId?: number;
  messageId?: number;
  locale?: string;
}

export interface ThreadContextBinding {
  contextKey: string;
  project?: ProjectInfo;
  session?: SessionInfo;
  agent?: string;
  model?: ModelInfo;
}

export interface AttachedSessionSettings {
  scope: TelegramConversationScope;
  session: SessionInfo;
  attachedAt: string;
  busy: boolean;
  lastEventId?: string;
}

export interface AccessApprovalRequest {
  userId: number;
  chatId: number;
  chatType?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  requestedAt: string;
  lastNotifiedAt?: string;
  adminChatId: number;
  adminMessageId?: number;
}

export interface ScopedConversationSettings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  currentAgent?: string;
  currentModel?: ModelInfo;
  pinnedMessageId?: number;
  reasoningMode?: ReasoningMode;
}

export interface ScopedUserSettings {
  ttsEnabled?: boolean;
  messageStreamingEnabled?: boolean;
  thinkingClearMode?: boolean;
  locale?: Locale;
  hideThinkingMessages?: boolean;
  hideToolCallMessages?: boolean;
  hideToolFileMessages?: boolean;
  telegraphTranslateEnabled?: boolean;
  subagentTopicsEnabled?: boolean;
  subagentTopicAutoDeleteMinutes?: number;
  defaultProject?: ProjectInfo;
  defaultAgent?: string;
  defaultModel?: ModelInfo;
}

interface DefaultSelectionOptions {
  persistAsUserDefault?: boolean;
}

export interface Settings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  currentAgent?: string;
  currentModel?: ModelInfo;
  pinnedMessageId?: number;
  reasoningMode?: ReasoningMode;
  ttsEnabled?: boolean;
  messageStreamingEnabled?: boolean;
  scopedConversationSettings?: Record<string, ScopedConversationSettings>;
  scopedUserSettings?: Record<string, ScopedUserSettings>;
  serverProcess?: ServerProcessInfo;
  tenantRuntimes?: Record<string, TenantRuntimeInfo>;
  sessionDirectoryCache?: SessionDirectoryCacheInfo;
  scopedSessionDirectoryCache?: Record<string, SessionDirectoryCacheInfo>;
  scheduledTasks?: ScheduledTask[];
  scheduledTaskSessionIgnores?: ScheduledTaskSessionIgnoreInfo[];
  lastRestartRequest?: LastRestartRequest;
  threadContextBindings?: ThreadContextBinding[];
  attachedSessions?: Record<string, AttachedSessionSettings>;
  approvedTelegramUserIds?: number[];
  pendingAccessRequests?: AccessApprovalRequest[];
}

// ====== REPOSITORY INSTANCES ======

const _defaultDb = new Database(":memory:");
_defaultDb.exec(SETTINGS_DDL);

let userPrefs: UserPreferencesRepository = createUserPreferencesRepository(_defaultDb);
let convBindings: ConversationBindingsRepository = createConversationBindingsRepository(_defaultDb);
let accessCtrl: AccessControlRepository = createAccessControlRepository(_defaultDb);
let scheduling: SchedulingRepository = createSchedulingRepository(_defaultDb);
let runtime: RuntimeRepository = createRuntimeRepository(_defaultDb);
let sessionAttach: SessionAttachmentsRepository = createSessionAttachmentsRepository(_defaultDb);
let ctxBindings: ContextBindingsRepository = createContextBindingsRepository(_defaultDb);
let dbInstance: Database.Database | null = _defaultDb;

// ====== INITIALIZATION ======

export async function loadSettings(): Promise<void> {
  // Close the default in-memory DB before opening the real file-backed DB
  if (dbInstance) {
    closeDatabase(dbInstance);
    dbInstance = null;
  }

  const paths = getRuntimePaths();
  const dbPath = paths.settingsFilePath.replace(/\.json$/, ".db");
  const markerPath = paths.settingsFilePath.replace(/\.json$/, ".migrated-to-sqlite");

  dbInstance = openDatabase(dbPath);
  await migrateIfNeeded(dbInstance, paths.settingsFilePath, markerPath);

  userPrefs = createUserPreferencesRepository(dbInstance);
  convBindings = createConversationBindingsRepository(dbInstance);
  accessCtrl = createAccessControlRepository(dbInstance);
  scheduling = createSchedulingRepository(dbInstance);
  runtime = createRuntimeRepository(dbInstance);
  sessionAttach = createSessionAttachmentsRepository(dbInstance);
  ctxBindings = createContextBindingsRepository(dbInstance);
}

export function disposeDatabase(): void {
  if (dbInstance) {
    closeDatabase(dbInstance);
    dbInstance = null;
  }
  if (testDbInstance) {
    testDbInstance.close();
    testDbInstance = null;
  }
}

// ====== SCOPE HELPERS ======

function getActiveConversationScopeKey(): string | null {
  const scope = getCurrentTelegramConversationScope();
  return scope ? buildTelegramConversationScopeKey(scope) : null;
}

function getActiveUserScopeKey(): string | null {
  const scope = getCurrentTelegramConversationScope();
  return scope ? String(scope.userId) : null;
}

// ====== USER DEFAULTS (internal helpers) ======

function getUserDefaultProject(): ProjectInfo | undefined {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return undefined;
  const row = userPrefs.get(Number(userKey));
  if (!row?.default_project) return undefined;
  return JSON.parse(row.default_project) as ProjectInfo;
}

function setUserDefaultProject(projectInfo: ProjectInfo): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { default_project: JSON.stringify(projectInfo) });
}

function getUserDefaultAgent(): string | undefined {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return undefined;
  return userPrefs.get(Number(userKey))?.default_agent ?? undefined;
}

function setUserDefaultAgent(agentName: string): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { default_agent: agentName });
}

function getUserDefaultModel(): ModelInfo | undefined {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return undefined;
  const row = userPrefs.get(Number(userKey));
  if (!row?.default_model) return undefined;
  return JSON.parse(row.default_model) as ModelInfo;
}

function setUserDefaultModel(modelInfo: ModelInfo): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { default_model: JSON.stringify(modelInfo) });
}

// ====== PROJECT ======

export function getCurrentProject(): ProjectInfo | undefined {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) {
    const row = convBindings.get(scopeKey);
    if (row?.project) return JSON.parse(row.project) as ProjectInfo;
  }
  return getUserDefaultProject() ?? undefined;
}

export function setCurrentProject(projectInfo: ProjectInfo): void {
  setCurrentProjectSelection(projectInfo, { persistAsUserDefault: true });
}

export function setConversationCurrentProject(projectInfo: ProjectInfo): void {
  setCurrentProjectSelection(projectInfo, { persistAsUserDefault: false });
}

function setCurrentProjectSelection(
  projectInfo: ProjectInfo,
  options: DefaultSelectionOptions,
): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) {
    convBindings.upsert(scopeKey, { project: JSON.stringify(projectInfo) });
  }
  if (options.persistAsUserDefault) setUserDefaultProject(projectInfo);
}

export function clearProject(): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { project: null });
}

// ====== SESSION ======

export function getCurrentSession(): SessionInfo | undefined {
  const scopeKey = getActiveConversationScopeKey();
  if (!scopeKey) return undefined;
  const row = convBindings.get(scopeKey);
  if (!row?.session) return undefined;
  return JSON.parse(row.session) as SessionInfo;
}

export function setCurrentSession(sessionInfo: SessionInfo): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { session: JSON.stringify(sessionInfo) });
}

export function clearSession(): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { session: null });
}

// ====== TTS ======

export function isTtsEnabled(): boolean {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return false;
  return userPrefs.get(Number(userKey))?.tts_enabled === 1;
}

export function setTtsEnabled(enabled: boolean): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { tts_enabled: enabled ? 1 : 0 });
}

// ====== MESSAGE STREAMING ======

export function isMessageStreamingEnabled(): boolean {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    const row = userPrefs.get(Number(userKey));
    if (row && row.message_streaming_enabled !== undefined) return row.message_streaming_enabled === 1;
  }
  return config.bot.responseStreaming;
}

export function setMessageStreamingEnabled(enabled: boolean): Promise<void> {
  const userKey = getActiveUserScopeKey();
  if (userKey) userPrefs.upsert(Number(userKey), { message_streaming_enabled: enabled ? 1 : 0 });
  return Promise.resolve();
}

// ====== THINKING CLEAR MODE ======

export function getThinkingClearMode(): boolean {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return false;
  return userPrefs.get(Number(userKey))?.thinking_clear_mode === 1;
}

export function setThinkingClearMode(enabled: boolean): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { thinking_clear_mode: enabled ? 1 : 0 });
}

// ====== LOCALE ======

export function getUserLocale(): Locale | undefined {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return undefined;
  return (userPrefs.get(Number(userKey))?.locale as Locale) ?? undefined;
}

export function setUserLocale(locale: Locale): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { locale });
}

// ====== HIDE FLAGS ======

export function getHideThinkingMessages(): boolean {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    const row = userPrefs.get(Number(userKey));
    if (row?.hide_thinking_messages !== undefined) return row.hide_thinking_messages === 1;
  }
  return config.bot.hideThinkingMessages;
}

export function setHideThinkingMessages(enabled: boolean): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { hide_thinking_messages: enabled ? 1 : 0 });
}

export function getHideToolCallMessages(): boolean {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    const row = userPrefs.get(Number(userKey));
    if (row?.hide_tool_call_messages !== undefined) return row.hide_tool_call_messages === 1;
  }
  return config.bot.hideToolCallMessages;
}

export function setHideToolCallMessages(enabled: boolean): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { hide_tool_call_messages: enabled ? 1 : 0 });
}

export function getHideToolFileMessages(): boolean {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    const row = userPrefs.get(Number(userKey));
    if (row?.hide_tool_file_messages !== undefined) return row.hide_tool_file_messages === 1;
  }
  return config.bot.hideToolFileMessages;
}

export function setHideToolFileMessages(enabled: boolean): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { hide_tool_file_messages: enabled ? 1 : 0 });
}

// ====== TELEGRAPH TRANSLATE ======

export function getTelegraphTranslateEnabled(): boolean {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    const row = userPrefs.get(Number(userKey));
    if (row?.telegraph_translate_enabled !== undefined) return row.telegraph_translate_enabled === 1;
  }
  return true;
}

export function setTelegraphTranslateEnabled(enabled: boolean): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { telegraph_translate_enabled: enabled ? 1 : 0 });
}

// ====== SUBAGENT TOPICS ======

export function getSubagentTopicsEnabled(): boolean {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    const row = userPrefs.get(Number(userKey));
    if (row) return row.subagent_topics_enabled === 1;
  }
  return true;
}

export function setSubagentTopicsEnabled(enabled: boolean): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { subagent_topics_enabled: enabled ? 1 : 0 });
}

export function getSubagentTopicAutoDeleteMinutes(): number {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    const row = userPrefs.get(Number(userKey));
    if (row) return row.subagent_topic_auto_delete_minutes;
  }
  return 1;
}

export function setSubagentTopicAutoDeleteMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error("Subagent topic auto-delete timeout must be a non-negative integer");
  }
  const userKey = getActiveUserScopeKey();
  if (!userKey) return;
  userPrefs.upsert(Number(userKey), { subagent_topic_auto_delete_minutes: minutes });
}

// ====== AGENT ======

export function getCurrentAgent(): string | undefined {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) {
    const row = convBindings.get(scopeKey);
    if (row?.agent) return row.agent;
  }
  return getUserDefaultAgent() ?? undefined;
}

export function setCurrentAgent(agentName: string): void {
  setCurrentAgentSelection(agentName, { persistAsUserDefault: true });
}

export function setConversationCurrentAgent(agentName: string): void {
  setCurrentAgentSelection(agentName, { persistAsUserDefault: false });
}

function setCurrentAgentSelection(agentName: string, options: DefaultSelectionOptions): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) {
    convBindings.upsert(scopeKey, { agent: agentName });
  }
  if (options.persistAsUserDefault) setUserDefaultAgent(agentName);
}

export function clearCurrentAgent(): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { agent: null });
}

// ====== MODEL ======

export function getCurrentModel(): ModelInfo | undefined {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) {
    const row = convBindings.get(scopeKey);
    if (row?.model) return JSON.parse(row.model) as ModelInfo;
  }
  return getUserDefaultModel() ?? undefined;
}

export function setCurrentModel(modelInfo: ModelInfo): void {
  setCurrentModelSelection(modelInfo, { persistAsUserDefault: true });
}

export function setConversationCurrentModel(modelInfo: ModelInfo): void {
  setCurrentModelSelection(modelInfo, { persistAsUserDefault: false });
}

export function setCurrentModelForScope(
  scope: TelegramConversationScope,
  modelInfo: ModelInfo,
): void {
  const scopeKey = buildTelegramConversationScopeKey(scope);
  userPrefs.upsert(scope.userId, { default_model: JSON.stringify(modelInfo) });
  convBindings.upsert(scopeKey, { model: JSON.stringify(modelInfo) });
}

function setCurrentModelSelection(modelInfo: ModelInfo, options: DefaultSelectionOptions): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) {
    convBindings.upsert(scopeKey, { model: JSON.stringify(modelInfo) });
  }
  if (options.persistAsUserDefault) setUserDefaultModel(modelInfo);
}

export function clearCurrentModel(): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { model: null });
}

// ====== PINNED MESSAGE ======

export function getPinnedMessageId(): number | undefined {
  const scopeKey = getActiveConversationScopeKey();
  if (!scopeKey) return undefined;
  return convBindings.get(scopeKey)?.pinned_message_id ?? undefined;
}

export function setPinnedMessageId(messageId: number): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { pinned_message_id: messageId });
}

export function clearPinnedMessageId(): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { pinned_message_id: null });
}

// ====== REASONING MODE ======

export function getReasoningMode(): ReasoningMode {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) {
    const row = convBindings.get(scopeKey);
    if (row?.reasoning_mode != null) return row.reasoning_mode as ReasoningMode;
  }
  return 2;
}

export function setReasoningMode(mode: ReasoningMode): void {
  const scopeKey = getActiveConversationScopeKey();
  if (scopeKey) convBindings.upsert(scopeKey, { reasoning_mode: mode });
}

// ====== SERVER PROCESS ======

export function getServerProcess(): ServerProcessInfo | undefined {
  const data = runtime.getServerProcess();
  if (!data) return undefined;
  return JSON.parse(data) as ServerProcessInfo;
}

export function setServerProcess(processInfo: ServerProcessInfo): void {
  runtime.setServerProcess(JSON.stringify(processInfo));
}

export function clearServerProcess(): void {
  runtime.clearServerProcess();
}

// ====== TENANT RUNTIMES ======

export function getTenantRuntimeInfo(userId: number): TenantRuntimeInfo | undefined {
  const data = runtime.getTenantRuntime(userId);
  if (!data) return undefined;
  return JSON.parse(data) as TenantRuntimeInfo;
}

export function getTenantRuntimes(): Record<string, TenantRuntimeInfo> {
  const rows = runtime.getAllTenantRuntimes();
  const result: Record<string, TenantRuntimeInfo> = {};
  for (const row of rows) {
    result[String(row.user_id)] = JSON.parse(row.data) as TenantRuntimeInfo;
  }
  return result;
}

export function setTenantRuntimeInfo(
  userId: number,
  runtimeInfo: TenantRuntimeInfo,
): Promise<void> {
  runtime.upsertTenantRuntime(userId, JSON.stringify(runtimeInfo));
  return Promise.resolve();
}

export function clearTenantRuntimeInfo(userId: number): Promise<void> {
  runtime.deleteTenantRuntime(userId);
  return Promise.resolve();
}

// ====== SESSION DIRECTORY CACHE ======

export function getSessionDirectoryCache(): SessionDirectoryCacheInfo | undefined {
  const userKey = getActiveUserScopeKey();
  if (!userKey) return undefined;
  const data = sessionAttach.getSessionDirectoryCache(userKey);
  if (!data) return undefined;
  return JSON.parse(data) as SessionDirectoryCacheInfo;
}

export function setSessionDirectoryCache(cache: SessionDirectoryCacheInfo): Promise<void> {
  const userKey = getActiveUserScopeKey();
  if (userKey) sessionAttach.setSessionDirectoryCache(userKey, JSON.stringify(cache));
  return Promise.resolve();
}

export function clearSessionDirectoryCache(): void {
  const userKey = getActiveUserScopeKey();
  if (userKey) sessionAttach.clearSessionDirectoryCache(userKey);
}

// ====== SCHEDULED TASKS ======

export function getScheduledTasks(): ScheduledTask[] {
  const data = scheduling.getScheduledTasks();
  if (!data) return [];
  return JSON.parse(data) as ScheduledTask[];
}

export function setScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  scheduling.setScheduledTasks(JSON.stringify(tasks));
  return Promise.resolve();
}

export function getScheduledTaskSessionIgnores(): ScheduledTaskSessionIgnoreInfo[] {
  const data = scheduling.getScheduledTaskSessionIgnores();
  if (!data) return [];
  return JSON.parse(data) as ScheduledTaskSessionIgnoreInfo[];
}

export function setScheduledTaskSessionIgnores(
  ignores: ScheduledTaskSessionIgnoreInfo[],
): Promise<void> {
  scheduling.setScheduledTaskSessionIgnores(JSON.stringify(ignores));
  return Promise.resolve();
}

// ====== LAST RESTART REQUEST ======

export function getLastRestartRequest(): LastRestartRequest | undefined {
  const data = runtime.getLastRestartRequest();
  if (!data) return undefined;
  return JSON.parse(data) as LastRestartRequest;
}

export function setLastRestartRequest(request: LastRestartRequest): Promise<void> {
  runtime.setLastRestartRequest(JSON.stringify(request));
  return Promise.resolve();
}

// ====== THREAD CONTEXT BINDINGS ======

export function getThreadContextBindings(): ThreadContextBinding[] {
  return ctxBindings.getAll().map((r) => ({
    contextKey: r.context_key,
    project: r.project ? JSON.parse(r.project) : undefined,
    session: r.session ? JSON.parse(r.session) : undefined,
    agent: r.agent ?? undefined,
    model: r.model ? JSON.parse(r.model) : undefined,
  }));
}

export function setThreadContextBindings(bindings: ThreadContextBinding[]): Promise<void> {
  ctxBindings.setBindings(
    bindings.map((b) => ({
      context_key: b.contextKey,
      project: b.project ? JSON.stringify(b.project) : null,
      session: b.session ? JSON.stringify(b.session) : null,
      agent: b.agent ?? null,
      model: b.model ? JSON.stringify(b.model) : null,
    })),
  );
  return Promise.resolve();
}

// ====== ATTACHED SESSIONS ======

export function getAttachedSessions(): Record<string, AttachedSessionSettings> {
  const rows = sessionAttach.getAttachedSessions();
  const result: Record<string, AttachedSessionSettings> = {};
  for (const [key, row] of Object.entries(rows)) {
    if (row.session) {
      result[key] = {
        scope: {} as TelegramConversationScope,
        session: JSON.parse(row.session) as SessionInfo,
        attachedAt: "",
        busy: false,
      };
    }
  }
  return result;
}

export function setAttachedSessions(
  attached: Record<string, AttachedSessionSettings>,
): Promise<void> {
  const record: Record<string, { scope_key: string; session: string | null }> = {};
  for (const [key, val] of Object.entries(attached)) {
    record[key] = {
      scope_key: key,
      session: val.session ? JSON.stringify(val.session) : null,
    };
  }
  sessionAttach.setAttachedSessions(record);
  return Promise.resolve();
}

// ====== APPROVED USERS ======

export function getApprovedTelegramUserIds(): number[] {
  return accessCtrl.getApprovedUserIds();
}

export function setApprovedTelegramUserIds(userIds: number[]): Promise<void> {
  accessCtrl.setApprovedUserIds(userIds);
  return Promise.resolve();
}

// ====== PENDING ACCESS REQUESTS ======

export function getPendingAccessRequests(): AccessApprovalRequest[] {
  return accessCtrl.getAccessRequests().map((r) => ({
    userId: r.user_id,
    chatId: 0,
    username: r.username ?? undefined,
    firstName: r.first_name ?? undefined,
    lastName: r.last_name ?? undefined,
    requestedAt: r.requested_at,
    adminChatId: 0,
  }));
}

export function setPendingAccessRequests(requests: AccessApprovalRequest[]): Promise<void> {
  accessCtrl.setAccessRequests(
    requests.map((r, idx) => ({
      id: idx + 1,
      user_id: r.userId,
      first_name: r.firstName ?? null,
      last_name: r.lastName ?? null,
      username: r.username ?? null,
      requested_at: r.requestedAt,
    })),
  );
  return Promise.resolve();
}

// ====== TEST HELPERS ======

let testDbInstance: Database.Database | null = null;

export async function __resetSettingsForTests(): Promise<void> {
  if (dbInstance) {
    closeDatabase(dbInstance);
    dbInstance = null;
  }
  testDbInstance = new Database(":memory:");
  testDbInstance.exec(SETTINGS_DDL);
  dbInstance = testDbInstance;

  userPrefs = createUserPreferencesRepository(dbInstance);
  convBindings = createConversationBindingsRepository(dbInstance);
  accessCtrl = createAccessControlRepository(dbInstance);
  scheduling = createSchedulingRepository(dbInstance);
  runtime = createRuntimeRepository(dbInstance);
  sessionAttach = createSessionAttachmentsRepository(dbInstance);
  ctxBindings = createContextBindingsRepository(dbInstance);
}
