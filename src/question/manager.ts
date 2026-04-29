import { logger } from "../utils/logger.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";
import { Question, QuestionAnswer, QuestionState } from "./types.js";

interface InternalQuestionState extends QuestionState {
  sessionId: string | null;
}

interface QuestionRestorePlan {
  sessionId: string;
  sourceScopeKey: string;
  targetScopeKey: string;
  targetState: InternalQuestionState;
  previousTargetState: InternalQuestionState | null;
}

function cloneSelectedOptions(selectedOptions: Map<number, Set<number>>): Map<number, Set<number>> {
  const cloned = new Map<number, Set<number>>();
  for (const [questionIndex, selected] of selectedOptions.entries()) {
    cloned.set(questionIndex, new Set(selected));
  }

  return cloned;
}

function cloneQuestionState(state: InternalQuestionState): InternalQuestionState {
  return {
    questions: [...state.questions],
    currentIndex: state.currentIndex,
    selectedOptions: cloneSelectedOptions(state.selectedOptions),
    customAnswers: new Map(state.customAnswers),
    customInputQuestionIndex: state.customInputQuestionIndex,
    activeMessageId: state.activeMessageId,
    messageIds: [...state.messageIds],
    isActive: state.isActive,
    requestID: state.requestID,
    sessionId: state.sessionId,
  };
}

function createQuestionState(): InternalQuestionState {
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
    sessionId: null,
  };
}

class QuestionManager {
  private states = new Map<string, InternalQuestionState>();
  private scopeKeyBySessionId = new Map<string, string>();

  private getScopeState(scopeKey?: string): InternalQuestionState {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const existingState = this.states.get(resolvedScopeKey);
    if (existingState) {
      return existingState;
    }

    const nextState = createQuestionState();
    this.states.set(resolvedScopeKey, nextState);
    return nextState;
  }

  private clearSessionScope(scopeKey: string): void {
    const state = this.states.get(scopeKey);
    if (!state?.sessionId) {
      return;
    }

    if (this.scopeKeyBySessionId.get(state.sessionId) === scopeKey) {
      this.scopeKeyBySessionId.delete(state.sessionId);
    }
  }

  startQuestions(questions: Question[], requestID: string, scopeKey?: string, sessionId?: string): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const state = this.getScopeState(resolvedScopeKey);

    logger.debug(
      `[QuestionManager] startQuestions called: scope=${resolvedScopeKey}, isActive=${state.isActive}, currentQuestions=${state.questions.length}, newQuestions=${questions.length}, requestID=${requestID}`,
    );

    if (state.isActive) {
      logger.info(
        `[QuestionManager] Poll already active for scope=${resolvedScopeKey}. Forcing reset before starting new poll.`,
      );
      this.clear(resolvedScopeKey);
    }

    logger.info(
      `[QuestionManager] Starting new poll for scope=${resolvedScopeKey} with ${questions.length} questions, requestID=${requestID}`,
    );

    this.clearSessionScope(resolvedScopeKey);

    this.states.set(resolvedScopeKey, {
      questions,
      currentIndex: 0,
      selectedOptions: new Map(),
      customAnswers: new Map(),
      customInputQuestionIndex: null,
      activeMessageId: null,
      messageIds: [],
      isActive: true,
      requestID,
      sessionId: sessionId ?? null,
    });

    if (sessionId) {
      this.scopeKeyBySessionId.set(sessionId, resolvedScopeKey);
    }
  }

  private buildRestoreState(sourceState: InternalQuestionState, sessionId: string): InternalQuestionState {
    return {
      questions: [...sourceState.questions],
      currentIndex: sourceState.currentIndex,
      selectedOptions: cloneSelectedOptions(sourceState.selectedOptions),
      customAnswers: new Map(sourceState.customAnswers),
      customInputQuestionIndex: null,
      activeMessageId: null,
      messageIds: [],
      isActive: sourceState.isActive,
      requestID: sourceState.requestID,
      sessionId,
    };
  }

  previewSessionRestore(
    sessionId: string,
    targetScopeKey: string,
    sourceScopeKeyOverride?: string,
  ): QuestionRestorePlan | null {
    const sourceScopeKey = sourceScopeKeyOverride ?? this.scopeKeyBySessionId.get(sessionId);
    if (!sourceScopeKey || sourceScopeKey === targetScopeKey) {
      return null;
    }

    const sourceState = this.states.get(sourceScopeKey);
    if (!sourceState || !sourceState.isActive) {
      return null;
    }

    return {
      sessionId,
      sourceScopeKey,
      targetScopeKey,
      targetState: this.buildRestoreState(sourceState, sessionId),
      previousTargetState: this.states.get(targetScopeKey)
        ? cloneQuestionState(this.getScopeState(targetScopeKey))
        : null,
    };
  }

  stageSessionRestore(plan: QuestionRestorePlan): void {
    this.states.set(plan.targetScopeKey, cloneQuestionState(plan.targetState));
  }

  rollbackSessionRestore(plan: QuestionRestorePlan): void {
    this.states.set(plan.targetScopeKey, plan.previousTargetState ?? createQuestionState());

    if (plan.previousTargetState?.sessionId) {
      this.scopeKeyBySessionId.set(plan.previousTargetState.sessionId, plan.targetScopeKey);
    }
  }

  commitSessionRestore(plan: QuestionRestorePlan): void {
    if (
      plan.previousTargetState?.sessionId &&
      this.scopeKeyBySessionId.get(plan.previousTargetState.sessionId) === plan.targetScopeKey
    ) {
      this.scopeKeyBySessionId.delete(plan.previousTargetState.sessionId);
    }

    this.states.set(plan.sourceScopeKey, createQuestionState());
    const committedState = this.getScopeState(plan.targetScopeKey);
    committedState.sessionId = plan.sessionId;
    this.scopeKeyBySessionId.set(plan.sessionId, plan.targetScopeKey);

    logger.info(
      `[QuestionManager] Restored pending poll for session=${plan.sessionId} from scope=${plan.sourceScopeKey} to scope=${plan.targetScopeKey}`,
    );
  }

  restoreSessionToScope(sessionId: string, targetScopeKey: string): boolean {
    const plan = this.previewSessionRestore(sessionId, targetScopeKey);
    if (!plan) {
      return false;
    }

    this.stageSessionRestore(plan);
    this.commitSessionRestore(plan);
    return true;
  }

  getRequestID(scopeKey?: string): string | null {
    return this.getScopeState(scopeKey).requestID;
  }

  getCurrentQuestion(scopeKey?: string): Question | null {
    const state = this.getScopeState(scopeKey);
    if (state.currentIndex >= state.questions.length) {
      return null;
    }
    return state.questions[state.currentIndex];
  }

  selectOption(questionIndex: number, optionIndex: number, scopeKey?: string): void {
    const state = this.getScopeState(scopeKey);
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
      `[QuestionManager] Selected options for scope=${resolveTelegramConversationScopeKey(scopeKey)} question ${questionIndex}: ${Array.from(selected).join(", ")}`,
    );
  }

  getSelectedOptions(questionIndex: number, scopeKey?: string): Set<number> {
    return this.getScopeState(scopeKey).selectedOptions.get(questionIndex) || new Set();
  }

  getSelectedAnswer(questionIndex: number, scopeKey?: string): string {
    const state = this.getScopeState(scopeKey);
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

  setCustomAnswer(questionIndex: number, answer: string, scopeKey?: string): void {
    logger.debug(
      `[QuestionManager] Custom answer received for scope=${resolveTelegramConversationScopeKey(scopeKey)} question ${questionIndex}: ${answer}`,
    );
    this.getScopeState(scopeKey).customAnswers.set(questionIndex, answer);
  }

  getCustomAnswer(questionIndex: number, scopeKey?: string): string | undefined {
    return this.getScopeState(scopeKey).customAnswers.get(questionIndex);
  }

  hasCustomAnswer(questionIndex: number, scopeKey?: string): boolean {
    return this.getScopeState(scopeKey).customAnswers.has(questionIndex);
  }

  nextQuestion(scopeKey?: string): void {
    const state = this.getScopeState(scopeKey);
    state.currentIndex++;
    state.customInputQuestionIndex = null;
    state.activeMessageId = null;

    logger.debug(
      `[QuestionManager] Moving to next question for scope=${resolveTelegramConversationScopeKey(scopeKey)}: ${state.currentIndex}/${state.questions.length}`,
    );
  }

  hasNextQuestion(scopeKey?: string): boolean {
    const state = this.getScopeState(scopeKey);
    return state.currentIndex < state.questions.length;
  }

  getCurrentIndex(scopeKey?: string): number {
    return this.getScopeState(scopeKey).currentIndex;
  }

  getTotalQuestions(scopeKey?: string): number {
    return this.getScopeState(scopeKey).questions.length;
  }

  addMessageId(messageId: number, scopeKey?: string): void {
    this.getScopeState(scopeKey).messageIds.push(messageId);
  }

  setActiveMessageId(messageId: number, scopeKey?: string): void {
    this.getScopeState(scopeKey).activeMessageId = messageId;
  }

  getActiveMessageId(scopeKey?: string): number | null {
    return this.getScopeState(scopeKey).activeMessageId;
  }

  isActiveMessage(messageId: number | null, scopeKey?: string): boolean {
    const state = this.getScopeState(scopeKey);
    return state.isActive && state.activeMessageId !== null && messageId === state.activeMessageId;
  }

  startCustomInput(questionIndex: number, scopeKey?: string): void {
    const state = this.getScopeState(scopeKey);
    if (!state.isActive || !state.questions[questionIndex]) {
      return;
    }

    state.customInputQuestionIndex = questionIndex;
  }

  clearCustomInput(scopeKey?: string): void {
    this.getScopeState(scopeKey).customInputQuestionIndex = null;
  }

  isWaitingForCustomInput(questionIndex: number, scopeKey?: string): boolean {
    return this.getScopeState(scopeKey).customInputQuestionIndex === questionIndex;
  }

  getMessageIds(scopeKey?: string): number[] {
    return [...this.getScopeState(scopeKey).messageIds];
  }

  isActive(scopeKey?: string): boolean {
    const state = this.getScopeState(scopeKey);
    logger.debug(
      `[QuestionManager] isActive check: scope=${resolveTelegramConversationScopeKey(scopeKey)}, isActive=${state.isActive}, questions=${state.questions.length}, currentIndex=${state.currentIndex}`,
    );
    return state.isActive;
  }

  cancel(scopeKey?: string): void {
    const state = this.getScopeState(scopeKey);
    logger.info(
      `[QuestionManager] Poll cancelled for scope=${resolveTelegramConversationScopeKey(scopeKey)}`,
    );
    state.isActive = false;
    state.customInputQuestionIndex = null;
    state.activeMessageId = null;
  }

  clear(scopeKey?: string): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    this.clearSessionScope(resolvedScopeKey);
    this.states.set(resolvedScopeKey, createQuestionState());
  }

  clearAll(): void {
    this.states.clear();
    this.scopeKeyBySessionId.clear();
  }

  getAllAnswers(scopeKey?: string): QuestionAnswer[] {
    const state = this.getScopeState(scopeKey);
    const answers: QuestionAnswer[] = [];

    for (let i = 0; i < state.questions.length; i++) {
      const question = state.questions[i];
      const selectedAnswer = this.getSelectedAnswer(i, scopeKey);
      const customAnswer = this.getCustomAnswer(i, scopeKey);
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
}

export const questionManager = new QuestionManager();
