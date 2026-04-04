import { logger } from "../utils/logger.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";
import type { ParsedTaskSchedule, ScheduledTaskModel, TaskCreationState } from "./types.js";
import { cloneParsedTaskSchedule, cloneScheduledTaskModel } from "./types.js";

function cloneState(state: TaskCreationState): TaskCreationState {
  return {
    ...state,
    model: cloneScheduledTaskModel(state.model),
    parsedSchedule: state.parsedSchedule ? cloneParsedTaskSchedule(state.parsedSchedule) : null,
  };
}

class TaskCreationManager {
  private states = new Map<string, TaskCreationState>();

  private getScopeState(scopeKey?: string): TaskCreationState | null {
    const state = this.states.get(resolveTelegramConversationScopeKey(scopeKey));
    return state ? cloneState(state) : null;
  }

  start(
    projectId: string,
    projectWorktree: string,
    model: ScheduledTaskModel,
    scopeKey?: string,
  ): TaskCreationState {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const nextState: TaskCreationState = {
      stage: "awaiting_schedule",
      projectId,
      projectWorktree,
      model: cloneScheduledTaskModel(model),
      scheduleText: null,
      parsedSchedule: null,
      scheduleRequestMessageId: null,
      previewMessageId: null,
      promptRequestMessageId: null,
    };

    this.states.set(resolvedScopeKey, nextState);

    logger.info(
      `[TaskCreationManager] Started task creation flow for scope=${resolvedScopeKey}, project=${projectWorktree}`,
    );

    return cloneState(nextState);
  }

  isActive(scopeKey?: string): boolean {
    return this.states.has(resolveTelegramConversationScopeKey(scopeKey));
  }

  isWaitingForSchedule(scopeKey?: string): boolean {
    return this.states.get(resolveTelegramConversationScopeKey(scopeKey))?.stage === "awaiting_schedule";
  }

  isParsingSchedule(scopeKey?: string): boolean {
    return this.states.get(resolveTelegramConversationScopeKey(scopeKey))?.stage === "parsing_schedule";
  }

  isWaitingForPrompt(scopeKey?: string): boolean {
    return this.states.get(resolveTelegramConversationScopeKey(scopeKey))?.stage === "awaiting_prompt";
  }

  getState(scopeKey?: string): TaskCreationState | null {
    return this.getScopeState(scopeKey);
  }

  setParsedSchedule(
    scheduleText: string,
    parsedSchedule: ParsedTaskSchedule,
    previewMessageId: number,
    scopeKey?: string,
  ): TaskCreationState | null {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const currentState = this.states.get(resolvedScopeKey);
    if (!currentState) {
      return null;
    }

    const nextState: TaskCreationState = {
      ...currentState,
      stage: "awaiting_prompt",
      scheduleText,
      parsedSchedule: cloneParsedTaskSchedule(parsedSchedule),
      scheduleRequestMessageId: null,
      previewMessageId,
      promptRequestMessageId: null,
    };

    this.states.set(resolvedScopeKey, nextState);

    logger.info(
      `[TaskCreationManager] Parsed schedule and switched flow to prompt input for scope=${resolvedScopeKey}`,
    );

    return cloneState(nextState);
  }

  markScheduleParsing(scopeKey?: string): TaskCreationState | null {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const currentState = this.states.get(resolvedScopeKey);
    if (!currentState) {
      return null;
    }

    const nextState: TaskCreationState = {
      ...currentState,
      stage: "parsing_schedule",
    };

    this.states.set(resolvedScopeKey, nextState);

    logger.info(`[TaskCreationManager] Schedule parsing started for scope=${resolvedScopeKey}`);

    return cloneState(nextState);
  }

  setPromptRequestMessageId(messageId: number, scopeKey?: string): TaskCreationState | null {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const currentState = this.states.get(resolvedScopeKey);
    if (!currentState) {
      return null;
    }

    const nextState: TaskCreationState = {
      ...currentState,
      promptRequestMessageId: messageId,
    };

    this.states.set(resolvedScopeKey, nextState);
    return cloneState(nextState);
  }

  setScheduleRequestMessageId(messageId: number, scopeKey?: string): TaskCreationState | null {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const currentState = this.states.get(resolvedScopeKey);
    if (!currentState) {
      return null;
    }

    const nextState: TaskCreationState = {
      ...currentState,
      scheduleRequestMessageId: messageId,
    };

    this.states.set(resolvedScopeKey, nextState);
    return cloneState(nextState);
  }

  resetSchedule(scopeKey?: string): TaskCreationState | null {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const currentState = this.states.get(resolvedScopeKey);
    if (!currentState) {
      return null;
    }

    const nextState: TaskCreationState = {
      ...currentState,
      stage: "awaiting_schedule",
      scheduleText: null,
      parsedSchedule: null,
      scheduleRequestMessageId: null,
      previewMessageId: null,
      promptRequestMessageId: null,
    };

    this.states.set(resolvedScopeKey, nextState);

    logger.info(
      `[TaskCreationManager] Reset task creation flow back to schedule input for scope=${resolvedScopeKey}`,
    );

    return cloneState(nextState);
  }

  clear(scopeKey?: string): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    if (!this.states.has(resolvedScopeKey)) {
      return;
    }

    logger.debug(`[TaskCreationManager] Clearing task creation state for scope=${resolvedScopeKey}`);
    this.states.delete(resolvedScopeKey);
  }

  clearAll(): void {
    this.states.clear();
  }
}

export const taskCreationManager = new TaskCreationManager();
