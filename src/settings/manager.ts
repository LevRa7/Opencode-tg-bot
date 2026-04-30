import type { Locale } from "../i18n/index.js";
import type { ModelInfo } from "../model/types.js";
import { cloneScheduledTask, type ScheduledTask } from "../scheduled-task/types.js";
import {
  buildTelegramConversationScopeKey,
  getCurrentTelegramConversationScope,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

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

export interface LastRestartRequest {
  updateId: number;
  requestedAt: string;
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
  lastRestartRequest?: LastRestartRequest;
  threadContextBindings?: ThreadContextBinding[];
  attachedSessions?: Record<string, AttachedSessionSettings>;
  approvedTelegramUserIds?: number[];
  pendingAccessRequests?: AccessApprovalRequest[];
}

function cloneProjectInfo(project: ProjectInfo | undefined): ProjectInfo | undefined {
  return project ? { ...project } : undefined;
}

function cloneSessionInfo(session: SessionInfo | undefined): SessionInfo | undefined {
  return session ? { ...session } : undefined;
}

function cloneModelInfo(model: ModelInfo | undefined): ModelInfo | undefined {
  return model ? { ...model } : undefined;
}

function cloneServerProcessInfo(
  processInfo: ServerProcessInfo | undefined,
): ServerProcessInfo | undefined {
  return processInfo ? { ...processInfo } : undefined;
}

function cloneTenantRuntimeInfo(
  runtimeInfo: TenantRuntimeInfo | undefined,
): TenantRuntimeInfo | undefined {
  return runtimeInfo ? { ...runtimeInfo } : undefined;
}

function cloneTenantRuntimesMap(
  runtimes: Record<string, TenantRuntimeInfo> | undefined,
): Record<string, TenantRuntimeInfo> | undefined {
  if (!runtimes) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(runtimes).map(([userKey, runtimeInfo]) => [
      userKey,
      cloneTenantRuntimeInfo(runtimeInfo) ?? runtimeInfo,
    ]),
  );
}

function cloneSessionDirectoryCache(
  cache: SessionDirectoryCacheInfo | undefined,
): SessionDirectoryCacheInfo | undefined {
  return cache
    ? {
        version: cache.version,
        lastSyncedUpdatedAt: cache.lastSyncedUpdatedAt,
        directories: cache.directories.map((directory) => ({ ...directory })),
      }
    : undefined;
}

function cloneScopedSessionDirectoryCacheMap(
  cacheByUser: Record<string, SessionDirectoryCacheInfo> | undefined,
): Record<string, SessionDirectoryCacheInfo> | undefined {
  if (!cacheByUser) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(cacheByUser).map(([userKey, cache]) => [
      userKey,
      cloneSessionDirectoryCache(cache) ?? cache,
    ]),
  );
}

function cloneLastRestartRequest(
  request: LastRestartRequest | undefined,
): LastRestartRequest | undefined {
  return request ? { ...request } : undefined;
}

function cloneScheduledTasks(tasks: ScheduledTask[] | undefined): ScheduledTask[] | undefined {
  return tasks?.map((task) => cloneScheduledTask(task));
}

function cloneThreadContextBindings(
  bindings: ThreadContextBinding[] | undefined,
): ThreadContextBinding[] | undefined {
  return bindings?.map((binding) => ({
    contextKey: binding.contextKey,
    project: cloneProjectInfo(binding.project),
    session: cloneSessionInfo(binding.session),
    agent: binding.agent,
    model: cloneModelInfo(binding.model),
  }));
}

function cloneTelegramConversationScope(
  scope: TelegramConversationScope | undefined,
): TelegramConversationScope | undefined {
  return scope ? { ...scope } : undefined;
}

function cloneAttachedSessionSettings(
  settings: AttachedSessionSettings | undefined,
): AttachedSessionSettings | undefined {
  if (!settings) {
    return undefined;
  }

  return {
    scope: cloneTelegramConversationScope(settings.scope) ?? settings.scope,
    session: cloneSessionInfo(settings.session) ?? settings.session,
    attachedAt: settings.attachedAt,
    busy: settings.busy,
    lastEventId: settings.lastEventId,
  };
}

function cloneAttachedSessionSettingsMap(
  settingsByScope: Record<string, AttachedSessionSettings> | undefined,
): Record<string, AttachedSessionSettings> | undefined {
  if (!settingsByScope) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(settingsByScope).map(([scopeKey, settings]) => [
      scopeKey,
      cloneAttachedSessionSettings(settings) ?? settings,
    ]),
  );
}

function cloneAccessApprovalRequests(
  requests: AccessApprovalRequest[] | undefined,
): AccessApprovalRequest[] | undefined {
  return requests?.map((request) => ({ ...request }));
}

function cloneScopedConversationSettings(
  settings: ScopedConversationSettings | undefined,
): ScopedConversationSettings | undefined {
  if (!settings) {
    return undefined;
  }

  return {
    currentProject: cloneProjectInfo(settings.currentProject),
    currentSession: cloneSessionInfo(settings.currentSession),
    currentAgent: settings.currentAgent,
    currentModel: cloneModelInfo(settings.currentModel),
    pinnedMessageId: settings.pinnedMessageId,
    reasoningMode: settings.reasoningMode,
  };
}

function cloneScopedConversationSettingsMap(
  settingsByScope: Record<string, ScopedConversationSettings> | undefined,
): Record<string, ScopedConversationSettings> | undefined {
  if (!settingsByScope) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(settingsByScope).map(([scopeKey, settings]) => [
      scopeKey,
      cloneScopedConversationSettings(settings) ?? {},
    ]),
  );
}

function cloneScopedUserSettings(
  settings: ScopedUserSettings | undefined,
): ScopedUserSettings | undefined {
  if (!settings) {
    return undefined;
  }

  return {
    ttsEnabled: settings.ttsEnabled,
    messageStreamingEnabled: settings.messageStreamingEnabled,
    thinkingClearMode: settings.thinkingClearMode,
    locale: settings.locale,
    hideThinkingMessages: settings.hideThinkingMessages,
    hideToolCallMessages: settings.hideToolCallMessages,
    hideToolFileMessages: settings.hideToolFileMessages,
  };
}

function cloneScopedUserSettingsMap(
  settingsByUser: Record<string, ScopedUserSettings> | undefined,
): Record<string, ScopedUserSettings> | undefined {
  if (!settingsByUser) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(settingsByUser).map(([userKey, settings]) => [
      userKey,
      cloneScopedUserSettings(settings) ?? {},
    ]),
  );
}

function isScopedConversationSettingsEmpty(
  settings: ScopedConversationSettings | undefined,
): boolean {
  return (
    !settings ||
    (settings.currentProject === undefined &&
      settings.currentSession === undefined &&
      settings.currentAgent === undefined &&
      settings.currentModel === undefined &&
      settings.pinnedMessageId === undefined &&
      settings.reasoningMode === undefined)
  );
}

function isScopedUserSettingsEmpty(settings: ScopedUserSettings | undefined): boolean {
  return (
    !settings ||
    (settings.ttsEnabled === undefined &&
      settings.messageStreamingEnabled === undefined &&
      settings.thinkingClearMode === undefined &&
      settings.locale === undefined &&
      settings.hideThinkingMessages === undefined &&
      settings.hideToolCallMessages === undefined &&
      settings.hideToolFileMessages === undefined)
  );
}

function getSettingsFilePath(): string {
  return getRuntimePaths().settingsFilePath;
}

async function readSettingsFile(): Promise<Settings> {
  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(getSettingsFilePath(), "utf-8");
    return JSON.parse(content) as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("[SettingsManager] Error reading settings file:", error);
    }
    return {};
  }
}

let settingsWriteQueue: Promise<void> = Promise.resolve();

function writeSettingsFile(settings: Settings): Promise<void> {
  settingsWriteQueue = settingsWriteQueue
    .catch(() => {
      // Keep write queue alive after failed writes.
    })
    .then(async () => {
      try {
        const fs = await import("fs/promises");
        const settingsFilePath = getSettingsFilePath();
        await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
        await fs.writeFile(settingsFilePath, JSON.stringify(settings, null, 2));
      } catch (err) {
        logger.error("[SettingsManager] Error writing settings file:", err);
      }
    });

  return settingsWriteQueue;
}

let currentSettings: Settings = {};

function normalizeTelegramUserIds(userIds: number[] | undefined): number[] {
  if (!userIds) {
    return [];
  }

  const normalizedUserIds = new Set<number>();
  for (const userId of userIds) {
    if (Number.isInteger(userId) && userId > 0) {
      normalizedUserIds.add(userId);
    }
  }

  return Array.from(normalizedUserIds).sort((left, right) => left - right);
}

function getActiveConversationScopeKey(): string | null {
  const scope = getCurrentTelegramConversationScope();
  return scope ? buildTelegramConversationScopeKey(scope) : null;
}

function isMainThreadGlobalDefaultScope(): boolean {
  const scope = getCurrentTelegramConversationScope();
  return !!scope && (scope.messageThreadId ?? 0) <= 0;
}

function getActiveUserScopeKey(): string | null {
  const scope = getCurrentTelegramConversationScope();
  return scope ? String(scope.userId) : null;
}

function getConversationScopedSettings(): ScopedConversationSettings | undefined {
  const scopeKey = getActiveConversationScopeKey();
  return scopeKey ? currentSettings.scopedConversationSettings?.[scopeKey] : undefined;
}

function getOrCreateConversationScopedSettings(): ScopedConversationSettings | null {
  const scopeKey = getActiveConversationScopeKey();
  if (!scopeKey) {
    return null;
  }

  currentSettings.scopedConversationSettings ??= {};
  currentSettings.scopedConversationSettings[scopeKey] ??= {};
  return currentSettings.scopedConversationSettings[scopeKey];
}

function pruneConversationScopedSettings(): void {
  const scopeKey = getActiveConversationScopeKey();
  if (!scopeKey || !currentSettings.scopedConversationSettings) {
    return;
  }

  if (isScopedConversationSettingsEmpty(currentSettings.scopedConversationSettings[scopeKey])) {
    delete currentSettings.scopedConversationSettings[scopeKey];
  }

  if (Object.keys(currentSettings.scopedConversationSettings).length === 0) {
    currentSettings.scopedConversationSettings = undefined;
  }
}

function getUserScopedSettings(): ScopedUserSettings | undefined {
  const userKey = getActiveUserScopeKey();
  return userKey ? currentSettings.scopedUserSettings?.[userKey] : undefined;
}

function getOrCreateUserScopedSettings(): ScopedUserSettings | null {
  const userKey = getActiveUserScopeKey();
  if (!userKey) {
    return null;
  }

  currentSettings.scopedUserSettings ??= {};
  currentSettings.scopedUserSettings[userKey] ??= {};
  return currentSettings.scopedUserSettings[userKey];
}

function pruneUserScopedSettings(): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey || !currentSettings.scopedUserSettings) {
    return;
  }

  if (isScopedUserSettingsEmpty(currentSettings.scopedUserSettings[userKey])) {
    delete currentSettings.scopedUserSettings[userKey];
  }

  if (Object.keys(currentSettings.scopedUserSettings).length === 0) {
    currentSettings.scopedUserSettings = undefined;
  }
}

function pruneScopedSessionDirectoryCache(): void {
  const userKey = getActiveUserScopeKey();
  if (!userKey || !currentSettings.scopedSessionDirectoryCache) {
    return;
  }

  const currentCache = currentSettings.scopedSessionDirectoryCache[userKey];
  if (!currentCache || currentCache.directories.length === 0) {
    delete currentSettings.scopedSessionDirectoryCache[userKey];
  }

  if (Object.keys(currentSettings.scopedSessionDirectoryCache).length === 0) {
    currentSettings.scopedSessionDirectoryCache = undefined;
  }
}

export function getCurrentProject(): ProjectInfo | undefined {
  const scopedSettings = getConversationScopedSettings();
  if (scopedSettings) {
    return cloneProjectInfo(scopedSettings.currentProject);
  }

  if (getActiveConversationScopeKey()) {
    return undefined;
  }

  return cloneProjectInfo(currentSettings.currentProject);
}

export function setCurrentProject(projectInfo: ProjectInfo): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentProject = cloneProjectInfo(projectInfo);
  } else {
    currentSettings.currentProject = cloneProjectInfo(projectInfo);
  }

  void writeSettingsFile(currentSettings);
}

export function clearProject(): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentProject = undefined;
    pruneConversationScopedSettings();
  } else {
    currentSettings.currentProject = undefined;
  }

  void writeSettingsFile(currentSettings);
}

export function getCurrentSession(): SessionInfo | undefined {
  const scopedSettings = getConversationScopedSettings();
  if (scopedSettings) {
    return cloneSessionInfo(scopedSettings.currentSession);
  }

  if (getActiveConversationScopeKey()) {
    return undefined;
  }

  return cloneSessionInfo(currentSettings.currentSession);
}

export function setCurrentSession(sessionInfo: SessionInfo): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentSession = cloneSessionInfo(sessionInfo);
  } else {
    currentSettings.currentSession = cloneSessionInfo(sessionInfo);
  }

  void writeSettingsFile(currentSettings);
}

export function clearSession(): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentSession = undefined;
    pruneConversationScopedSettings();
  } else {
    currentSettings.currentSession = undefined;
  }

  void writeSettingsFile(currentSettings);
}

export function isTtsEnabled(): boolean {
  const scopedSettings = getUserScopedSettings();
  if (scopedSettings) {
    return scopedSettings.ttsEnabled === true;
  }

  return getActiveUserScopeKey() ? false : currentSettings.ttsEnabled === true;
}

export function setTtsEnabled(enabled: boolean): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (scopedSettings) {
    scopedSettings.ttsEnabled = enabled;
  } else {
    currentSettings.ttsEnabled = enabled;
  }

  void writeSettingsFile(currentSettings);
}

export function isMessageStreamingEnabled(): boolean {
  const scopedSettings = getUserScopedSettings();
  if (scopedSettings && scopedSettings.messageStreamingEnabled !== undefined) {
    return scopedSettings.messageStreamingEnabled;
  }

  return currentSettings.messageStreamingEnabled ?? config.bot.responseStreaming;
}

export function setMessageStreamingEnabled(enabled: boolean): Promise<void> {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (scopedSettings) {
    scopedSettings.messageStreamingEnabled = enabled;
  } else {
    currentSettings.messageStreamingEnabled = enabled;
  }

  return writeSettingsFile(currentSettings);
}

export function getThinkingClearMode(): boolean {
  const scopedSettings = getUserScopedSettings();
  if (scopedSettings) {
    return scopedSettings.thinkingClearMode ?? false;
  }

  return false;
}

export function setThinkingClearMode(enabled: boolean): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.thinkingClearMode = enabled;
  pruneUserScopedSettings();

  void writeSettingsFile(currentSettings);
}

export function getUserLocale(): Locale | undefined {
  return getUserScopedSettings()?.locale;
}

export function setUserLocale(locale: Locale): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.locale = locale;
  pruneUserScopedSettings();

  void writeSettingsFile(currentSettings);
}

export function getHideThinkingMessages(): boolean {
  return getUserScopedSettings()?.hideThinkingMessages ?? false;
}

export function setHideThinkingMessages(enabled: boolean): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.hideThinkingMessages = enabled;
  pruneUserScopedSettings();

  void writeSettingsFile(currentSettings);
}

export function getHideToolCallMessages(): boolean {
  return getUserScopedSettings()?.hideToolCallMessages ?? false;
}

export function setHideToolCallMessages(enabled: boolean): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.hideToolCallMessages = enabled;
  pruneUserScopedSettings();

  void writeSettingsFile(currentSettings);
}

export function getHideToolFileMessages(): boolean {
  return getUserScopedSettings()?.hideToolFileMessages ?? false;
}

export function setHideToolFileMessages(enabled: boolean): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.hideToolFileMessages = enabled;
  pruneUserScopedSettings();

  void writeSettingsFile(currentSettings);
}

export function getCurrentAgent(): string | undefined {
  if (isMainThreadGlobalDefaultScope()) {
    return currentSettings.currentAgent;
  }

  const scopedSettings = getConversationScopedSettings();
  if (scopedSettings) {
    return scopedSettings.currentAgent;
  }

  return getActiveConversationScopeKey() ? undefined : currentSettings.currentAgent;
}

export function setCurrentAgent(agentName: string): void {
  if (isMainThreadGlobalDefaultScope()) {
    currentSettings.currentAgent = agentName;
    void writeSettingsFile(currentSettings);
    return;
  }

  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentAgent = agentName;
  } else {
    currentSettings.currentAgent = agentName;
  }

  void writeSettingsFile(currentSettings);
}

export function clearCurrentAgent(): void {
  if (isMainThreadGlobalDefaultScope()) {
    currentSettings.currentAgent = undefined;
    void writeSettingsFile(currentSettings);
    return;
  }

  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentAgent = undefined;
    pruneConversationScopedSettings();
  } else {
    currentSettings.currentAgent = undefined;
  }

  void writeSettingsFile(currentSettings);
}

export function getCurrentModel(): ModelInfo | undefined {
  if (isMainThreadGlobalDefaultScope()) {
    return cloneModelInfo(currentSettings.currentModel);
  }

  const scopedSettings = getConversationScopedSettings();
  if (scopedSettings) {
    return cloneModelInfo(scopedSettings.currentModel);
  }

  if (getActiveConversationScopeKey()) {
    return undefined;
  }

  return cloneModelInfo(currentSettings.currentModel);
}

export function setCurrentModel(modelInfo: ModelInfo): void {
  if (isMainThreadGlobalDefaultScope()) {
    currentSettings.currentModel = cloneModelInfo(modelInfo);
    void writeSettingsFile(currentSettings);
    return;
  }

  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentModel = cloneModelInfo(modelInfo);
  } else {
    currentSettings.currentModel = cloneModelInfo(modelInfo);
  }

  void writeSettingsFile(currentSettings);
}

export function clearCurrentModel(): void {
  if (isMainThreadGlobalDefaultScope()) {
    currentSettings.currentModel = undefined;
    void writeSettingsFile(currentSettings);
    return;
  }

  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentModel = undefined;
    pruneConversationScopedSettings();
  } else {
    currentSettings.currentModel = undefined;
  }

  void writeSettingsFile(currentSettings);
}

export function getPinnedMessageId(): number | undefined {
  const scopedSettings = getConversationScopedSettings();
  if (scopedSettings) {
    return scopedSettings.pinnedMessageId;
  }

  return getActiveConversationScopeKey() ? undefined : currentSettings.pinnedMessageId;
}

export function setPinnedMessageId(messageId: number): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.pinnedMessageId = messageId;
  } else {
    currentSettings.pinnedMessageId = messageId;
  }

  void writeSettingsFile(currentSettings);
}

export function clearPinnedMessageId(): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.pinnedMessageId = undefined;
    pruneConversationScopedSettings();
  } else {
    currentSettings.pinnedMessageId = undefined;
  }

  void writeSettingsFile(currentSettings);
}

export function getReasoningMode(): ReasoningMode {
  const scopedSettings = getConversationScopedSettings();
  if (scopedSettings && scopedSettings.reasoningMode !== undefined) {
    return scopedSettings.reasoningMode;
  }

  if (getActiveConversationScopeKey()) {
    return 2; // Default for new conversations
  }

  return currentSettings.reasoningMode ?? 2;
}

export function setReasoningMode(mode: ReasoningMode): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.reasoningMode = mode;
  } else {
    currentSettings.reasoningMode = mode;
  }

  void writeSettingsFile(currentSettings);
}

export function getServerProcess(): ServerProcessInfo | undefined {
  return cloneServerProcessInfo(currentSettings.serverProcess);
}

export function setServerProcess(processInfo: ServerProcessInfo): void {
  currentSettings.serverProcess = cloneServerProcessInfo(processInfo);
  void writeSettingsFile(currentSettings);
}

export function clearServerProcess(): void {
  currentSettings.serverProcess = undefined;
  void writeSettingsFile(currentSettings);
}

export function getTenantRuntimeInfo(userId: number): TenantRuntimeInfo | undefined {
  return cloneTenantRuntimeInfo(currentSettings.tenantRuntimes?.[String(userId)]);
}

export function getTenantRuntimes(): Record<string, TenantRuntimeInfo> {
  return cloneTenantRuntimesMap(currentSettings.tenantRuntimes) ?? {};
}

export function setTenantRuntimeInfo(
  userId: number,
  runtimeInfo: TenantRuntimeInfo,
): Promise<void> {
  currentSettings.tenantRuntimes ??= {};
  currentSettings.tenantRuntimes[String(userId)] =
    cloneTenantRuntimeInfo(runtimeInfo) ?? runtimeInfo;
  return writeSettingsFile(currentSettings);
}

export function clearTenantRuntimeInfo(userId: number): Promise<void> {
  if (!currentSettings.tenantRuntimes) {
    return writeSettingsFile(currentSettings);
  }

  delete currentSettings.tenantRuntimes[String(userId)];
  if (Object.keys(currentSettings.tenantRuntimes).length === 0) {
    currentSettings.tenantRuntimes = undefined;
  }

  return writeSettingsFile(currentSettings);
}

export function getSessionDirectoryCache(): SessionDirectoryCacheInfo | undefined {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    return cloneSessionDirectoryCache(currentSettings.scopedSessionDirectoryCache?.[userKey]);
  }

  return cloneSessionDirectoryCache(currentSettings.sessionDirectoryCache);
}

export function setSessionDirectoryCache(cache: SessionDirectoryCacheInfo): Promise<void> {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    currentSettings.scopedSessionDirectoryCache ??= {};
    currentSettings.scopedSessionDirectoryCache[userKey] =
      cloneSessionDirectoryCache(cache) ?? cache;
  } else {
    currentSettings.sessionDirectoryCache = cloneSessionDirectoryCache(cache);
  }

  return writeSettingsFile(currentSettings);
}

export function clearSessionDirectoryCache(): void {
  const userKey = getActiveUserScopeKey();
  if (userKey) {
    if (currentSettings.scopedSessionDirectoryCache) {
      delete currentSettings.scopedSessionDirectoryCache[userKey];
      pruneScopedSessionDirectoryCache();
    }
  } else {
    currentSettings.sessionDirectoryCache = undefined;
  }

  void writeSettingsFile(currentSettings);
}

export function getScheduledTasks(): ScheduledTask[] {
  return cloneScheduledTasks(currentSettings.scheduledTasks) ?? [];
}

export function setScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  currentSettings.scheduledTasks = cloneScheduledTasks(tasks);
  return writeSettingsFile(currentSettings);
}

export function getLastRestartRequest(): LastRestartRequest | undefined {
  return cloneLastRestartRequest(currentSettings.lastRestartRequest);
}

export function setLastRestartRequest(request: LastRestartRequest): Promise<void> {
  currentSettings.lastRestartRequest = cloneLastRestartRequest(request);
  return writeSettingsFile(currentSettings);
}

export function getThreadContextBindings(): ThreadContextBinding[] {
  return cloneThreadContextBindings(currentSettings.threadContextBindings) ?? [];
}

export function setThreadContextBindings(bindings: ThreadContextBinding[]): Promise<void> {
  currentSettings.threadContextBindings = cloneThreadContextBindings(bindings);
  return writeSettingsFile(currentSettings);
}

export function getAttachedSessions(): Record<string, AttachedSessionSettings> {
  return cloneAttachedSessionSettingsMap(currentSettings.attachedSessions) ?? {};
}

export function setAttachedSessions(
  attachedSessions: Record<string, AttachedSessionSettings>,
): Promise<void> {
  currentSettings.attachedSessions = cloneAttachedSessionSettingsMap(attachedSessions);
  return writeSettingsFile(currentSettings);
}

export function getApprovedTelegramUserIds(): number[] {
  return normalizeTelegramUserIds(currentSettings.approvedTelegramUserIds);
}

export function setApprovedTelegramUserIds(userIds: number[]): Promise<void> {
  currentSettings.approvedTelegramUserIds = normalizeTelegramUserIds(userIds);
  return writeSettingsFile(currentSettings);
}

export function getPendingAccessRequests(): AccessApprovalRequest[] {
  return cloneAccessApprovalRequests(currentSettings.pendingAccessRequests) ?? [];
}

export function setPendingAccessRequests(requests: AccessApprovalRequest[]): Promise<void> {
  currentSettings.pendingAccessRequests = cloneAccessApprovalRequests(requests);
  return writeSettingsFile(currentSettings);
}

export function __resetSettingsForTests(): void {
  currentSettings = {};
  settingsWriteQueue = Promise.resolve();
}

export async function loadSettings(): Promise<void> {
  const loadedSettings = (await readSettingsFile()) as Settings & {
    toolMessagesIntervalSec?: unknown;
  };

  if ("toolMessagesIntervalSec" in loadedSettings) {
    delete loadedSettings.toolMessagesIntervalSec;
    void writeSettingsFile(loadedSettings);
  }

  currentSettings = {
    currentProject: cloneProjectInfo(loadedSettings.currentProject),
    currentSession: cloneSessionInfo(loadedSettings.currentSession),
    currentAgent: loadedSettings.currentAgent,
    currentModel: cloneModelInfo(loadedSettings.currentModel),
    pinnedMessageId: loadedSettings.pinnedMessageId,
    reasoningMode:
      typeof loadedSettings.reasoningMode === "number"
        ? loadedSettings.reasoningMode >= 2
          ? 2
          : loadedSettings.reasoningMode <= 0
            ? 0
            : 1
        : undefined,
    ttsEnabled:
      typeof loadedSettings.ttsEnabled === "boolean" ? loadedSettings.ttsEnabled : undefined,
    messageStreamingEnabled:
      typeof loadedSettings.messageStreamingEnabled === "boolean"
        ? loadedSettings.messageStreamingEnabled
        : undefined,
    scopedConversationSettings: cloneScopedConversationSettingsMap(
      loadedSettings.scopedConversationSettings,
    ),
    scopedUserSettings: cloneScopedUserSettingsMap(loadedSettings.scopedUserSettings),
    serverProcess: cloneServerProcessInfo(loadedSettings.serverProcess),
    tenantRuntimes: cloneTenantRuntimesMap(loadedSettings.tenantRuntimes),
    sessionDirectoryCache: cloneSessionDirectoryCache(loadedSettings.sessionDirectoryCache),
    scopedSessionDirectoryCache: cloneScopedSessionDirectoryCacheMap(
      loadedSettings.scopedSessionDirectoryCache,
    ),
    scheduledTasks: cloneScheduledTasks(loadedSettings.scheduledTasks) ?? [],
    lastRestartRequest: cloneLastRestartRequest(loadedSettings.lastRestartRequest),
    threadContextBindings: cloneThreadContextBindings(loadedSettings.threadContextBindings) ?? [],
    attachedSessions: cloneAttachedSessionSettingsMap(loadedSettings.attachedSessions),
    approvedTelegramUserIds: normalizeTelegramUserIds(loadedSettings.approvedTelegramUserIds),
    pendingAccessRequests: cloneAccessApprovalRequests(loadedSettings.pendingAccessRequests) ?? [],
  };
}
