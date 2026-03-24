import { Question, QuestionState, QuestionAnswer } from "./types.js";
import type { TelegramConversationScope } from "../telegram/scope.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";
import { logger } from "../utils/logger.js";

function createInitialState(): QuestionState {
  return {
    questions: [],
    currentIndex: 0,
    selectedOptions: new Map(),
    customAnswers: new Map(),
    customInputQuestionIndex: null,
    activeMessageId: null,
    messageIds: [],
    isActive: false,
    requestID: null,
  };
}

class QuestionManager {
  private states = new Map<string, QuestionState>();

  private getScopeKey(scope?: TelegramConversationScope | null): string {
    return resolveTelegramConversationScopeKey(scope);
  }

  private getOrCreateState(scope?: TelegramConversationScope | null): QuestionState {
    const scopeKey = this.getScopeKey(scope);
    let state = this.states.get(scopeKey);
    if (!state) {
      state = createInitialState();
      this.states.set(scopeKey, state);
    }

    return state;
  }

  private getState(scope?: TelegramConversationScope | null): QuestionState {
    return this.states.get(this.getScopeKey(scope)) ?? createInitialState();
  }

  startQuestions(
    questions: Question[],
    requestID: string,
    scope?: TelegramConversationScope | null,
  ): void {
    const state = this.getOrCreateState(scope);
    const scopeKey = this.getScopeKey(scope);
    logger.debug(
      `[QuestionManager] startQuestions called: scope=${scopeKey}, isActive=${state.isActive}, currentQuestions=${state.questions.length}, newQuestions=${questions.length}, requestID=${requestID}`,
    );

    if (state.isActive) {
      logger.info(
        `[QuestionManager] Poll already active in scope ${scopeKey}! Forcing reset before starting new poll.`,
      );
      // Force-reset the previous poll before starting a new one
      this.clear(scope);
    }

    logger.info(
      `[QuestionManager] Starting new poll: scope=${scopeKey}, questions=${questions.length}, requestID=${requestID}`,
    );
    this.states.set(scopeKey, {
      questions,
      currentIndex: 0,
      selectedOptions: new Map(),
      customAnswers: new Map(),
      customInputQuestionIndex: null,
      activeMessageId: null,
      messageIds: [],
      isActive: true,
      requestID,
    });
  }

  getRequestID(scope?: TelegramConversationScope | null): string | null {
    return this.getState(scope).requestID;
  }

  getCurrentQuestion(scope?: TelegramConversationScope | null): Question | null {
    const state = this.getState(scope);
    if (state.currentIndex >= state.questions.length) {
      return null;
    }
    return state.questions[state.currentIndex];
  }

  selectOption(
    questionIndex: number,
    optionIndex: number,
    scope?: TelegramConversationScope | null,
  ): void {
    const state = this.getOrCreateState(scope);
    if (!state.isActive) {
      return;
    }

    const question = state.questions[questionIndex];
    if (!question) {
      return;
    }

    const selected = state.selectedOptions.get(questionIndex) || new Set();

    if (question.multiple) {
      if (selected.has(optionIndex)) {
        selected.delete(optionIndex);
      } else {
        selected.add(optionIndex);
      }
    } else {
      selected.clear();
      selected.add(optionIndex);
    }

    state.selectedOptions.set(questionIndex, selected);

    logger.debug(
      `[QuestionManager] Selected options for question ${questionIndex}: ${Array.from(selected).join(", ")}`,
    );
  }

  getSelectedOptions(questionIndex: number, scope?: TelegramConversationScope | null): Set<number> {
    return this.getState(scope).selectedOptions.get(questionIndex) || new Set();
  }

  getSelectedAnswer(questionIndex: number, scope?: TelegramConversationScope | null): string {
    const state = this.getState(scope);
    const question = state.questions[questionIndex];
    if (!question) {
      return "";
    }

    const selected = state.selectedOptions.get(questionIndex) || new Set();
    const options = Array.from(selected)
      .map((idx) => question.options[idx])
      .filter((opt) => opt)
      .map((opt) => `* ${opt.label}: ${opt.description}`);

    return options.join("\n");
  }

  setCustomAnswer(
    questionIndex: number,
    answer: string,
    scope?: TelegramConversationScope | null,
  ): void {
    logger.debug(
      `[QuestionManager] Custom answer received for question ${questionIndex}: ${answer}`,
    );
    this.getOrCreateState(scope).customAnswers.set(questionIndex, answer);
  }

  getCustomAnswer(
    questionIndex: number,
    scope?: TelegramConversationScope | null,
  ): string | undefined {
    return this.getState(scope).customAnswers.get(questionIndex);
  }

  hasCustomAnswer(questionIndex: number, scope?: TelegramConversationScope | null): boolean {
    return this.getState(scope).customAnswers.has(questionIndex);
  }

  nextQuestion(scope?: TelegramConversationScope | null): void {
    const state = this.getOrCreateState(scope);
    state.currentIndex++;
    state.customInputQuestionIndex = null;
    state.activeMessageId = null;

    logger.debug(
      `[QuestionManager] Moving to next question: ${state.currentIndex}/${state.questions.length}`,
    );
  }

  hasNextQuestion(scope?: TelegramConversationScope | null): boolean {
    const state = this.getState(scope);
    return state.currentIndex < state.questions.length;
  }

  getCurrentIndex(scope?: TelegramConversationScope | null): number {
    return this.getState(scope).currentIndex;
  }

  getTotalQuestions(scope?: TelegramConversationScope | null): number {
    return this.getState(scope).questions.length;
  }

  addMessageId(messageId: number, scope?: TelegramConversationScope | null): void {
    this.getOrCreateState(scope).messageIds.push(messageId);
  }

  setActiveMessageId(messageId: number, scope?: TelegramConversationScope | null): void {
    this.getOrCreateState(scope).activeMessageId = messageId;
  }

  getActiveMessageId(scope?: TelegramConversationScope | null): number | null {
    return this.getState(scope).activeMessageId;
  }

  isActiveMessage(messageId: number | null, scope?: TelegramConversationScope | null): boolean {
    const state = this.getState(scope);
    return state.isActive && state.activeMessageId !== null && messageId === state.activeMessageId;
  }

  startCustomInput(questionIndex: number, scope?: TelegramConversationScope | null): void {
    const state = this.getOrCreateState(scope);
    if (!state.isActive || !state.questions[questionIndex]) {
      return;
    }

    state.customInputQuestionIndex = questionIndex;
  }

  clearCustomInput(scope?: TelegramConversationScope | null): void {
    this.getOrCreateState(scope).customInputQuestionIndex = null;
  }

  isWaitingForCustomInput(
    questionIndex: number,
    scope?: TelegramConversationScope | null,
  ): boolean {
    return this.getState(scope).customInputQuestionIndex === questionIndex;
  }

  getMessageIds(scope?: TelegramConversationScope | null): number[] {
    return [...this.getState(scope).messageIds];
  }

  isActive(scope?: TelegramConversationScope | null): boolean {
    const state = this.getState(scope);
    logger.debug(
      `[QuestionManager] isActive check: isActive=${state.isActive}, questions=${state.questions.length}, currentIndex=${state.currentIndex}`,
    );
    return state.isActive;
  }

  cancel(scope?: TelegramConversationScope | null): void {
    const state = this.getOrCreateState(scope);
    logger.info("[QuestionManager] Poll cancelled");
    state.isActive = false;
    state.customInputQuestionIndex = null;
    state.activeMessageId = null;
  }

  clear(scope?: TelegramConversationScope | null): void {
    this.states.set(this.getScopeKey(scope), createInitialState());
  }

  getAllAnswers(scope?: TelegramConversationScope | null): QuestionAnswer[] {
    const state = this.getState(scope);
    const answers: QuestionAnswer[] = [];

    for (let i = 0; i < state.questions.length; i++) {
      const question = state.questions[i];
      const selectedAnswer = this.getSelectedAnswer(i, scope);
      const customAnswer = this.getCustomAnswer(i, scope);

      const finalAnswer = customAnswer || selectedAnswer;

      if (finalAnswer) {
        answers.push({
          question: question.question,
          answer: finalAnswer,
        });
      }
    }

    return answers;
  }

  __resetForTests(): void {
    this.states.clear();
  }
}

export const questionManager = new QuestionManager();
