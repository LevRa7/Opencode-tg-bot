import type { Context } from "grammy";
import {
  getCurrentAgent,
  getCurrentModel,
  getCurrentProject,
  getThreadContextBindings,
  setCurrentAgent,
  setCurrentModel,
  setCurrentProject,
  setThreadContextBindings,
  type ProjectInfo as SettingsProjectInfo,
  type ThreadContextBinding,
} from "../settings/manager.js";
import {
  clearSession,
  getCurrentSession,
  setCurrentSession,
  type SessionInfo as SettingsSessionInfo,
} from "../session/manager.js";
import {
  extractThreadTargetFromContext,
  type TelegramThreadTarget,
} from "../bot/utils/message-thread.js";
import {
  buildTelegramConversationScopeKey,
  extractTelegramConversationScopeFromContext,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import { logger } from "../utils/logger.js";
import type { ModelInfo } from "../model/types.js";
import type { ProjectInfo, SessionInfo } from "../settings/manager.js";

function cloneProject(project: ProjectInfo): SettingsProjectInfo {
  return { ...project };
}

function cloneSession(session: SessionInfo): SettingsSessionInfo {
  return { ...session };
}

function cloneModel(model: ModelInfo): ModelInfo {
  return { ...model };
}

interface ParsedContextKey {
  userId: number | null;
  chatId: number;
  messageThreadId?: number;
}

function buildContextKey(scope: TelegramConversationScope): string {
  return buildTelegramConversationScopeKey(scope);
}

class ThreadContextManager {
  private activeScope: TelegramConversationScope | null = null;
  private activeContextKey: string | null = null;
  private projectByContext = new Map<string, SettingsProjectInfo>();
  private sessionByContext = new Map<string, SettingsSessionInfo>();
  private agentByContext = new Map<string, string>();
  private modelByContext = new Map<string, ModelInfo>();
  private scopeBySessionId = new Map<string, TelegramConversationScope>();
  private hydratedFromSettings = false;

  private ensureHydrated(): void {
    if (this.hydratedFromSettings) {
      return;
    }

    const bindings = getThreadContextBindings();
    for (const binding of bindings) {
      if (binding.project) {
        this.projectByContext.set(binding.contextKey, { ...binding.project });
      }

      if (binding.session) {
        this.sessionByContext.set(binding.contextKey, { ...binding.session });
        const target = this.parseContextKey(binding.contextKey);
        if (target && target.userId !== null) {
          this.scopeBySessionId.set(binding.session.id, {
            userId: target.userId,
            chatId: target.chatId,
            messageThreadId: target.messageThreadId,
          });
        }
      }

      if (binding.agent) {
        this.agentByContext.set(binding.contextKey, binding.agent);
      }

      if (binding.model) {
        this.modelByContext.set(binding.contextKey, cloneModel(binding.model));
      }
    }

    this.hydratedFromSettings = true;
  }

  private parseContextKey(contextKey: string): ParsedContextKey | null {
    const parts = contextKey.split(":");
    if (parts.length !== 2 && parts.length !== 3) {
      return null;
    }

    if (parts.length === 2) {
      const [chatIdRaw, messageThreadIdRaw] = parts;
      const chatId = Number(chatIdRaw);
      const messageThreadId = Number(messageThreadIdRaw);

      if (!Number.isInteger(chatId) || !Number.isInteger(messageThreadId)) {
        return null;
      }

      return {
        userId: null,
        chatId,
        messageThreadId: messageThreadId > 0 ? messageThreadId : undefined,
      };
    }

    const [userIdRaw, chatIdRaw, messageThreadIdRaw] = parts;
    const userId = Number(userIdRaw);
    const chatId = Number(chatIdRaw);
    const messageThreadId = Number(messageThreadIdRaw);

    if (
      !Number.isInteger(userId) ||
      !Number.isInteger(chatId) ||
      !Number.isInteger(messageThreadId)
    ) {
      return null;
    }

    return {
      userId,
      chatId,
      messageThreadId: messageThreadId > 0 ? messageThreadId : undefined,
    };
  }

  private persistBindings(): void {
    const contextKeys = new Set<string>([
      ...this.projectByContext.keys(),
      ...this.sessionByContext.keys(),
      ...this.agentByContext.keys(),
      ...this.modelByContext.keys(),
    ]);

    const bindings: ThreadContextBinding[] = [];
    for (const contextKey of contextKeys) {
      const project = this.projectByContext.get(contextKey);
      const session = this.sessionByContext.get(contextKey);
      const agent = this.agentByContext.get(contextKey);
      const model = this.modelByContext.get(contextKey);

      if (!project && !session && !agent && !model) {
        continue;
      }

      bindings.push({
        contextKey,
        project: project ? { ...project } : undefined,
        session: session ? { ...session } : undefined,
        agent,
        model: model ? cloneModel(model) : undefined,
      });
    }

    void setThreadContextBindings(bindings);
  }

  private findRecoverableContextKey(scope: TelegramConversationScope): string | null {
    const exactCandidates = new Set<string>();

    const registerCandidate = (contextKey: string): void => {
      const target = this.parseContextKey(contextKey);
      if (!target) {
        return;
      }

      if (
        target.userId === scope.userId &&
        target.chatId === scope.chatId &&
        target.messageThreadId === scope.messageThreadId
      ) {
        exactCandidates.add(contextKey);
      }
    };

    for (const contextKey of this.projectByContext.keys()) {
      registerCandidate(contextKey);
    }

    for (const contextKey of this.sessionByContext.keys()) {
      registerCandidate(contextKey);
    }

    for (const contextKey of this.agentByContext.keys()) {
      registerCandidate(contextKey);
    }

    for (const contextKey of this.modelByContext.keys()) {
      registerCandidate(contextKey);
    }

    if (exactCandidates.size === 1) {
      return [...exactCandidates][0];
    }

    return null;
  }

  private findSessionContextKey(sessionId: string): string | null {
    for (const [contextKey, session] of this.sessionByContext.entries()) {
      if (session.id === sessionId) {
        return contextKey;
      }
    }

    return null;
  }

  private migrateContextBinding(fromContextKey: string, toContextKey: string): void {
    if (fromContextKey === toContextKey) {
      return;
    }

    const project = this.projectByContext.get(fromContextKey);
    if (project) {
      this.projectByContext.set(toContextKey, project);
      this.projectByContext.delete(fromContextKey);
    }

    const session = this.sessionByContext.get(fromContextKey);
    if (session) {
      this.sessionByContext.set(toContextKey, session);
      this.sessionByContext.delete(fromContextKey);
    }

    const agent = this.agentByContext.get(fromContextKey);
    if (agent) {
      this.agentByContext.set(toContextKey, agent);
      this.agentByContext.delete(fromContextKey);
    }

    const model = this.modelByContext.get(fromContextKey);
    if (model) {
      this.modelByContext.set(toContextKey, model);
      this.modelByContext.delete(fromContextKey);
    }

    this.persistBindings();
  }

  activateFromContext(ctx: Context): TelegramThreadTarget | null {
    this.ensureHydrated();

    const scope = extractTelegramConversationScopeFromContext(ctx);
    const target = extractThreadTargetFromContext(ctx);
    if (!target || !scope) {
      return null;
    }

    this.activeScope = { ...scope };
    this.activeContextKey = buildContextKey(scope);

    if (
      target.messageThreadId !== undefined &&
      !this.projectByContext.has(this.activeContextKey) &&
      !this.sessionByContext.has(this.activeContextKey) &&
      !this.agentByContext.has(this.activeContextKey) &&
      !this.modelByContext.has(this.activeContextKey)
    ) {
      const recoverableContextKey = this.findRecoverableContextKey(scope);
      if (recoverableContextKey) {
        logger.info(
          `[ThreadContext] Recovering topic binding by scope: ${recoverableContextKey} -> ${this.activeContextKey}`,
        );
        this.migrateContextBinding(recoverableContextKey, this.activeContextKey);
      }
    }

    const boundProject = this.projectByContext.get(this.activeContextKey);
    const currentProject = getCurrentProject();

    if (
      boundProject &&
      (!currentProject ||
        currentProject.id !== boundProject.id ||
        currentProject.worktree !== boundProject.worktree)
    ) {
      setCurrentProject(cloneProject(boundProject));
    }

    if (!boundProject && currentProject && target.messageThreadId !== undefined) {
      this.projectByContext.set(this.activeContextKey, cloneProject(currentProject));
      this.persistBindings();
    }

    const boundSession = this.sessionByContext.get(this.activeContextKey);
    const currentSession = getCurrentSession();
    const effectiveProject = boundProject ?? currentProject;
    const boundAgent = this.agentByContext.get(this.activeContextKey);
    const currentAgent = getCurrentAgent();
    const boundModel = this.modelByContext.get(this.activeContextKey);
    const currentModel = getCurrentModel();

    if (boundAgent && currentAgent !== boundAgent) {
      setCurrentAgent(boundAgent);
    }

    if (!boundAgent && currentAgent && target.messageThreadId !== undefined) {
      this.agentByContext.set(this.activeContextKey, currentAgent);
      this.persistBindings();
    }

    if (
      boundModel &&
      (!currentModel ||
        currentModel.providerID !== boundModel.providerID ||
        currentModel.modelID !== boundModel.modelID ||
        currentModel.variant !== boundModel.variant)
    ) {
      setCurrentModel(cloneModel(boundModel));
    }

    if (!boundModel && currentModel && target.messageThreadId !== undefined) {
      this.modelByContext.set(this.activeContextKey, cloneModel(currentModel));
      this.persistBindings();
    }

    if (boundSession) {
      if (
        !currentSession ||
        currentSession.id !== boundSession.id ||
        currentSession.directory !== boundSession.directory
      ) {
        setCurrentSession(cloneSession(boundSession));
      }

      this.scopeBySessionId.set(boundSession.id, { ...scope });
      return { ...target };
    }

    if (currentSession) {
      if (effectiveProject && currentSession.directory !== effectiveProject.worktree) {
        clearSession();
        return { ...target };
      }

      this.sessionByContext.set(this.activeContextKey, cloneSession(currentSession));
      this.scopeBySessionId.set(currentSession.id, { ...scope });
      this.persistBindings();
      return { ...target };
    }

    return { ...target };
  }

  bindProjectToActiveContext(project: ProjectInfo): void {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return;
    }

    this.projectByContext.set(this.activeContextKey, cloneProject(project));
    this.persistBindings();
  }

  canAutoAssignProjectForActiveContext(): boolean {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return true;
    }

    return !this.projectByContext.has(this.activeContextKey);
  }

  bindSessionToActiveContext(session: SessionInfo): void {
    this.ensureHydrated();

    if (!this.activeContextKey || !this.activeScope) {
      return;
    }

    const previousSession = this.sessionByContext.get(this.activeContextKey);
    if (previousSession && previousSession.id !== session.id) {
      this.scopeBySessionId.delete(previousSession.id);
    }

    this.sessionByContext.set(this.activeContextKey, cloneSession(session));
    this.scopeBySessionId.set(session.id, { ...this.activeScope });
    this.persistBindings();
  }

  bindAgentToActiveContext(agent: string): void {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return;
    }

    this.agentByContext.set(this.activeContextKey, agent);
    this.persistBindings();
  }

  bindModelToActiveContext(model: ModelInfo): void {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return;
    }

    this.modelByContext.set(this.activeContextKey, cloneModel(model));
    this.persistBindings();
  }

  canAutoAssignSessionForActiveContext(): boolean {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return true;
    }

    return !this.sessionByContext.has(this.activeContextKey);
  }

  clearSessionForActiveContext(): void {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return;
    }

    const previousSession = this.sessionByContext.get(this.activeContextKey);
    if (previousSession) {
      this.scopeBySessionId.delete(previousSession.id);
    }

    this.sessionByContext.delete(this.activeContextKey);
    this.persistBindings();
  }

  clearModelForActiveContext(): void {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return;
    }

    this.modelByContext.delete(this.activeContextKey);
    this.persistBindings();
  }

  clearAgentForActiveContext(): void {
    this.ensureHydrated();

    if (!this.activeContextKey) {
      return;
    }

    this.agentByContext.delete(this.activeContextKey);
    this.persistBindings();
  }

  getSessionTarget(sessionId: string): TelegramThreadTarget | null {
    this.ensureHydrated();

    const scope = this.scopeBySessionId.get(sessionId);
    if (scope) {
      return {
        chatId: scope.chatId,
        messageThreadId: scope.messageThreadId,
      };
    }

    const contextKey = this.findSessionContextKey(sessionId);
    const target = contextKey ? this.parseContextKey(contextKey) : null;
    return target
      ? {
          chatId: target.chatId,
          messageThreadId: target.messageThreadId,
        }
      : null;
  }

  getSessionScope(sessionId: string): TelegramConversationScope | null {
    this.ensureHydrated();

    const scope = this.scopeBySessionId.get(sessionId);
    if (scope) {
      return { ...scope };
    }

    if (!this.activeScope || !this.activeContextKey) {
      return null;
    }

    const contextKey = this.findSessionContextKey(sessionId);
    return contextKey === this.activeContextKey ? { ...this.activeScope } : null;
  }

  getSessionDirectory(sessionId: string): string | null {
    this.ensureHydrated();

    const contextKey = this.findSessionContextKey(sessionId);
    if (!contextKey) {
      return null;
    }

    return this.sessionByContext.get(contextKey)?.directory ?? null;
  }

  getActiveTarget(): TelegramThreadTarget | null {
    return this.activeScope
      ? { chatId: this.activeScope.chatId, messageThreadId: this.activeScope.messageThreadId }
      : null;
  }

  getActiveScope(): TelegramConversationScope | null {
    return this.activeScope ? { ...this.activeScope } : null;
  }

  clearAll(reason: string): void {
    this.ensureHydrated();

    if (
      this.projectByContext.size === 0 &&
      this.sessionByContext.size === 0 &&
      this.scopeBySessionId.size === 0
    ) {
      return;
    }

    logger.info(
      `[ThreadContext] Clearing all thread bindings: reason=${reason}, projects=${this.projectByContext.size}, sessions=${this.sessionByContext.size}`,
    );

    this.projectByContext.clear();
    this.sessionByContext.clear();
    this.agentByContext.clear();
    this.modelByContext.clear();
    this.scopeBySessionId.clear();
    this.activeScope = null;
    this.activeContextKey = null;
    this.hydratedFromSettings = true;
    void setThreadContextBindings([]);
  }

  __resetForTests(): void {
    this.projectByContext.clear();
    this.sessionByContext.clear();
    this.agentByContext.clear();
    this.modelByContext.clear();
    this.scopeBySessionId.clear();
    this.activeScope = null;
    this.activeContextKey = null;
    this.hydratedFromSettings = false;
  }
}

export const threadContextManager = new ThreadContextManager();
