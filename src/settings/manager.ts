import type { ModelInfo } from "../model/types.js";
import { cloneScheduledTask, type ScheduledTask } from "../scheduled-task/types.js";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";
import {
  getCurrentTelegramConversationScope,
  buildTelegramConversationScopeKey,
} from "../telegram/scope.js";
import { logger } from "../utils/logger.js";

export interface ProjectInfo {
  id: string;
  worktree: string;
  name?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface ServerProcessInfo {
  pid: number;
  startTime: string; // ISO string
}

export interface SessionDirectoryCacheInfo {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: Array<{
    worktree: string;
    lastUpdated: number;
  }>;
}

export interface ThreadContextBinding {
  contextKey: string;
  project?: ProjectInfo;
  session?: SessionInfo;
}

export interface ConversationSettings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  pinnedMessageId?: number;
}

export interface UserSettings {
  currentAgent?: string;
  currentModel?: ModelInfo;
  messageStreamingEnabled?: boolean;
}

export interface RestartRequestInfo {
  updateId: number;
  requestedAt: string;
}

export interface Settings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  currentAgent?: string;
  currentModel?: ModelInfo;
  messageStreamingEnabled?: boolean;
  serverProcess?: ServerProcessInfo;
  sessionDirectoryCache?: SessionDirectoryCacheInfo;
  lastRestartRequest?: RestartRequestInfo;
  threadContextBindings?: ThreadContextBinding[];
  scheduledTasks?: ScheduledTask[];
  conversations?: Record<string, ConversationSettings>;
  users?: Record<string, UserSettings>;
}

function cloneScheduledTasks(tasks: ScheduledTask[] | undefined): ScheduledTask[] | undefined {
  return tasks?.map((task) => cloneScheduledTask(task));
}

function cloneConversationSettings(
  conversationSettings: ConversationSettings | undefined,
): ConversationSettings | undefined {
  if (!conversationSettings) {
    return undefined;
  }

  return {
    currentProject: conversationSettings.currentProject
      ? { ...conversationSettings.currentProject }
      : undefined,
    currentSession: conversationSettings.currentSession
      ? { ...conversationSettings.currentSession }
      : undefined,
    pinnedMessageId: conversationSettings.pinnedMessageId,
  };
}

function cloneConversationMap(
  conversations: Record<string, ConversationSettings> | undefined,
): Record<string, ConversationSettings> | undefined {
  if (!conversations) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(conversations).map(([conversationKey, conversationSettings]) => [
      conversationKey,
      cloneConversationSettings(conversationSettings) ?? {},
    ]),
  );
}

function cloneUserSettings(userSettings: UserSettings | undefined): UserSettings | undefined {
  if (!userSettings) {
    return undefined;
  }

  return {
    currentAgent: userSettings.currentAgent,
    currentModel: userSettings.currentModel ? { ...userSettings.currentModel } : undefined,
    messageStreamingEnabled: userSettings.messageStreamingEnabled,
  };
}

function cloneUsers(
  users: Record<string, UserSettings> | undefined,
): Record<string, UserSettings> | undefined {
  if (!users) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(users).map(([userId, userSettings]) => [
      userId,
      cloneUserSettings(userSettings) ?? {},
    ]),
  );
}

function getScopedUserId(): string | null {
  const scope = getCurrentTelegramConversationScope();
  return scope ? String(scope.userId) : null;
}

function getScopedConversationKey(): string | null {
  const scope = getCurrentTelegramConversationScope();
  return scope ? buildTelegramConversationScopeKey(scope) : null;
}

function getConversationSettings(conversationKey: string | null): ConversationSettings | undefined {
  if (!conversationKey) {
    return undefined;
  }

  return currentSettings.conversations?.[conversationKey];
}

function ensureConversationSettings(conversationKey: string): ConversationSettings {
  currentSettings.conversations ??= {};
  currentSettings.conversations[conversationKey] ??= {};
  return currentSettings.conversations[conversationKey];
}

function cleanupConversationSettings(conversationKey: string): void {
  if (!currentSettings.conversations?.[conversationKey]) {
    return;
  }

  const conversationSettings = currentSettings.conversations[conversationKey];
  if (Object.values(conversationSettings).every((value) => value === undefined)) {
    delete currentSettings.conversations[conversationKey];
  }

  if (currentSettings.conversations && Object.keys(currentSettings.conversations).length === 0) {
    currentSettings.conversations = undefined;
  }
}

function getUserSettings(userId: string | null): UserSettings | undefined {
  if (!userId) {
    return undefined;
  }

  return currentSettings.users?.[userId];
}

function ensureUserSettings(userId: string): UserSettings {
  currentSettings.users ??= {};
  currentSettings.users[userId] ??= {};
  return currentSettings.users[userId];
}

function cleanupUserSettings(userId: string): void {
  if (!currentSettings.users?.[userId]) {
    return;
  }

  const userSettings = currentSettings.users[userId];
  if (Object.values(userSettings).every((value) => value === undefined)) {
    delete currentSettings.users[userId];
  }

  if (currentSettings.users && Object.keys(currentSettings.users).length === 0) {
    currentSettings.users = undefined;
  }
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

export function getCurrentProject(): ProjectInfo | undefined {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    return getConversationSettings(conversationKey)?.currentProject;
  }

  return currentSettings.currentProject;
}

export function setCurrentProject(projectInfo: ProjectInfo): void {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    ensureConversationSettings(conversationKey).currentProject = { ...projectInfo };
  } else {
    currentSettings.currentProject = { ...projectInfo };
  }
  void writeSettingsFile(currentSettings);
}

export function clearProject(): void {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    const conversationSettings = getConversationSettings(conversationKey);
    if (conversationSettings) {
      conversationSettings.currentProject = undefined;
      cleanupConversationSettings(conversationKey);
    }
  } else {
    currentSettings.currentProject = undefined;
  }
  void writeSettingsFile(currentSettings);
}

export function getCurrentSession(): SessionInfo | undefined {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    return getConversationSettings(conversationKey)?.currentSession;
  }

  return currentSettings.currentSession;
}

export function setCurrentSession(sessionInfo: SessionInfo): void {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    ensureConversationSettings(conversationKey).currentSession = { ...sessionInfo };
  } else {
    currentSettings.currentSession = { ...sessionInfo };
  }
  void writeSettingsFile(currentSettings);
}

export function clearSession(): void {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    const conversationSettings = getConversationSettings(conversationKey);
    if (conversationSettings) {
      conversationSettings.currentSession = undefined;
      cleanupConversationSettings(conversationKey);
    }
  } else {
    currentSettings.currentSession = undefined;
  }
  void writeSettingsFile(currentSettings);
}

export function getCurrentAgent(): string | undefined {
  const userId = getScopedUserId();
  return getUserSettings(userId)?.currentAgent ?? currentSettings.currentAgent;
}

export function setCurrentAgent(agentName: string): void {
  const userId = getScopedUserId();
  if (userId) {
    ensureUserSettings(userId).currentAgent = agentName;
  } else {
    currentSettings.currentAgent = agentName;
  }
  void writeSettingsFile(currentSettings);
}

export function clearCurrentAgent(): void {
  const userId = getScopedUserId();
  if (userId) {
    const userSettings = getUserSettings(userId);
    if (userSettings) {
      userSettings.currentAgent = undefined;
      cleanupUserSettings(userId);
    }
  } else {
    currentSettings.currentAgent = undefined;
  }
  void writeSettingsFile(currentSettings);
}

export function getCurrentModel(): ModelInfo | undefined {
  const userId = getScopedUserId();
  return getUserSettings(userId)?.currentModel ?? currentSettings.currentModel;
}

export function isMessageStreamingEnabled(): boolean {
  const userId = getScopedUserId();
  return (
    getUserSettings(userId)?.messageStreamingEnabled ??
    currentSettings.messageStreamingEnabled ??
    true
  );
}

export function setMessageStreamingEnabled(enabled: boolean): Promise<void> {
  const userId = getScopedUserId();
  if (userId) {
    ensureUserSettings(userId).messageStreamingEnabled = enabled;
  } else {
    currentSettings.messageStreamingEnabled = enabled;
  }
  return writeSettingsFile(currentSettings);
}

export function setCurrentModel(modelInfo: ModelInfo): void {
  const userId = getScopedUserId();
  if (userId) {
    ensureUserSettings(userId).currentModel = { ...modelInfo };
  } else {
    currentSettings.currentModel = { ...modelInfo };
  }
  void writeSettingsFile(currentSettings);
}

export function clearCurrentModel(): void {
  const userId = getScopedUserId();
  if (userId) {
    const userSettings = getUserSettings(userId);
    if (userSettings) {
      userSettings.currentModel = undefined;
      cleanupUserSettings(userId);
    }
  } else {
    currentSettings.currentModel = undefined;
  }
  void writeSettingsFile(currentSettings);
}

export function getPinnedMessageId(): number | undefined {
  const conversationKey = getScopedConversationKey();
  if (!conversationKey) {
    return undefined;
  }

  return getConversationSettings(conversationKey)?.pinnedMessageId;
}

export function setPinnedMessageId(messageId: number): void {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    ensureConversationSettings(conversationKey).pinnedMessageId = messageId;
  }
  void writeSettingsFile(currentSettings);
}

export function clearPinnedMessageId(): void {
  const conversationKey = getScopedConversationKey();
  if (conversationKey) {
    const conversationSettings = getConversationSettings(conversationKey);
    if (conversationSettings) {
      conversationSettings.pinnedMessageId = undefined;
      cleanupConversationSettings(conversationKey);
    }
  }
  void writeSettingsFile(currentSettings);
}

export function getServerProcess(): ServerProcessInfo | undefined {
  return currentSettings.serverProcess;
}

export function setServerProcess(processInfo: ServerProcessInfo): void {
  currentSettings.serverProcess = processInfo;
  void writeSettingsFile(currentSettings);
}

export function clearServerProcess(): void {
  currentSettings.serverProcess = undefined;
  void writeSettingsFile(currentSettings);
}

export function getLastRestartRequest(): RestartRequestInfo | undefined {
  return currentSettings.lastRestartRequest
    ? { ...currentSettings.lastRestartRequest }
    : undefined;
}

export function setLastRestartRequest(restartRequest: RestartRequestInfo): Promise<void> {
  currentSettings.lastRestartRequest = { ...restartRequest };
  return writeSettingsFile(currentSettings);
}

export function getSessionDirectoryCache(): SessionDirectoryCacheInfo | undefined {
  return currentSettings.sessionDirectoryCache;
}

export function setSessionDirectoryCache(cache: SessionDirectoryCacheInfo): Promise<void> {
  currentSettings.sessionDirectoryCache = cache;
  return writeSettingsFile(currentSettings);
}

export function clearSessionDirectoryCache(): void {
  currentSettings.sessionDirectoryCache = undefined;
  void writeSettingsFile(currentSettings);
}

export function getScheduledTasks(): ScheduledTask[] {
  return cloneScheduledTasks(currentSettings.scheduledTasks) ?? [];
}

export function getThreadContextBindings(): ThreadContextBinding[] {
  return (
    currentSettings.threadContextBindings?.map((binding) => ({
      contextKey: binding.contextKey,
      project: binding.project ? { ...binding.project } : undefined,
      session: binding.session ? { ...binding.session } : undefined,
    })) ?? []
  );
}

export function setThreadContextBindings(bindings: ThreadContextBinding[]): Promise<void> {
  currentSettings.threadContextBindings = bindings.map((binding) => ({
    contextKey: binding.contextKey,
    project: binding.project ? { ...binding.project } : undefined,
    session: binding.session ? { ...binding.session } : undefined,
  }));

  if (currentSettings.threadContextBindings.length === 0) {
    currentSettings.threadContextBindings = undefined;
  }

  return writeSettingsFile(currentSettings);
}

export function setScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  currentSettings.scheduledTasks = cloneScheduledTasks(tasks);
  return writeSettingsFile(currentSettings);
}

export function __resetSettingsForTests(): void {
  currentSettings = {};
  settingsWriteQueue = Promise.resolve();
}

export async function loadSettings(): Promise<void> {
  const loadedSettings = (await readSettingsFile()) as Settings & {
    pinnedMessageId?: unknown;
    toolMessagesIntervalSec?: unknown;
  };

  if ("toolMessagesIntervalSec" in loadedSettings) {
    delete loadedSettings.toolMessagesIntervalSec;
    void writeSettingsFile(loadedSettings);
  }

  if ("pinnedMessageId" in loadedSettings) {
    delete loadedSettings.pinnedMessageId;
    void writeSettingsFile(loadedSettings);
  }

  currentSettings = {
    ...loadedSettings,
    conversations: cloneConversationMap(loadedSettings.conversations),
    users: cloneUsers(loadedSettings.users),
  };
  currentSettings.scheduledTasks = cloneScheduledTasks(loadedSettings.scheduledTasks) ?? [];
}
