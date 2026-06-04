import type { Api } from "grammy";
import { createMainKeyboard } from "../bot/utils/keyboard.js";
import type { ModelInfo } from "../model/types.js";
import { getStoredAgent } from "../agent/manager.js";
import { getStoredModel } from "../model/manager.js";
import { formatVariantForButton } from "../variant/manager.js";
import { logger } from "../utils/logger.js";
import { getSystemInfo } from "../utils/system-info.js";
import { processManager } from "../process/manager.js";
import { SessionType, type ContextInfo, type KeyboardState } from "./types.js";
import { t } from "../i18n/index.js";
import { getCurrentTelegramConversationScope, getCurrentTelegramConversationScopeKey } from "../telegram/scope.js";
import { isTerminalTopic, isTerminalRunning } from "../bot/commands/terminal.js";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";

interface ScopedKeyboardState {
  state: KeyboardState | null;
  api: Api | null;
  chatId: number | null;
  lastUpdateTime: number;
  keyboardMessageId?: number;
}

function createEmptyScopedKeyboardState(): ScopedKeyboardState {
  return {
    state: null,
    api: null,
    chatId: null,
    lastUpdateTime: 0,
  };
}

class KeyboardManager {
  private scopedStates = new Map<string, ScopedKeyboardState>();
  private autoUpdateInterval: ReturnType<typeof setInterval> | null = null;

  private readonly UPDATE_DEBOUNCE_MS = 2000;
  private readonly AUTO_UPDATE_MS = 3000;

  private getScopeKey(): string {
    return getCurrentTelegramConversationScopeKey();
  }

  private getScopedState(scopeKey = this.getScopeKey()): ScopedKeyboardState {
    let scopedState = this.scopedStates.get(scopeKey);
    if (!scopedState) {
      scopedState = createEmptyScopedKeyboardState();
      this.scopedStates.set(scopeKey, scopedState);
    }
    return scopedState;
  }

  private buildInitialKeyboardState(): KeyboardState {
    const currentModel = getStoredModel();
    return {
      currentAgent: getStoredAgent(),
      currentModel,
      contextInfo: null,
      variantName: formatVariantForButton(currentModel.variant || "default"),
      sessionMode: SessionType.NONE,
    };
  }

  public initialize(api: Api, chatId: number): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);

    scopedState.api = api;
    scopedState.chatId = chatId;

    if (!scopedState.state) {
      scopedState.state = this.buildInitialKeyboardState();
      logger.debug(
        `[KeyboardManager] Initialized scope=${scopeKey} with agent="${scopedState.state.currentAgent}", model="${scopedState.state.currentModel.providerID}/${scopedState.state.currentModel.modelID}", variant="${scopedState.state.currentModel.variant || "default"}", chatId=${chatId}`,
      );
    } else {
      logger.debug(`[KeyboardManager] Updated scope=${scopeKey} chatId=${chatId}`);
    }
  }

  public updateAgent(agent: string): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot update agent: not initialized");
      return;
    }
    scopedState.state.currentAgent = agent;
    logger.debug(`[KeyboardManager] Agent updated for scope=${scopeKey}: ${agent}`);
  }

  public updateModel(model: ModelInfo): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot update model: not initialized");
      return;
    }
    scopedState.state.currentModel = model;
    scopedState.state.variantName = formatVariantForButton(model.variant || "default");
    logger.debug(
      `[KeyboardManager] Model updated for scope=${scopeKey}: ${model.providerID}/${model.modelID}, variant: ${model.variant || "default"}`,
    );
  }

  public updateVariant(variantId: string): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot update variant: not initialized");
      return;
    }
    scopedState.state.variantName = formatVariantForButton(variantId);
    logger.debug(`[KeyboardManager] Variant updated for scope=${scopeKey}: ${variantId}`);
  }

  public updateContext(tokensUsed: number, tokensLimit: number): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot update context: not initialized");
      return;
    }
    scopedState.state.contextInfo = { tokensUsed, tokensLimit };
    logger.debug(
      `[KeyboardManager] Context updated for scope=${scopeKey}: ${tokensUsed}/${tokensLimit}`,
    );
  }

  public clearContext(): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot clear context: not initialized");
      return;
    }
    scopedState.state.contextInfo = null;
    logger.debug(`[KeyboardManager] Context cleared for scope=${scopeKey}`);
  }

  public updateRunningStatus(isRunning: boolean): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot update running status: not initialized");
      return;
    }
    scopedState.state.isRunning = isRunning;
    logger.debug(`[KeyboardManager] Running status updated for scope=${scopeKey}: ${isRunning}`);
  }

  public setSessionMode(mode: SessionType): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot set session mode: not initialized");
      return;
    }
    const oldMode = scopedState.state.sessionMode;
    if (oldMode === mode) return;
    scopedState.state.sessionMode = mode;
    scopedState.lastUpdateTime = 0;
    scopedState.keyboardMessageId = undefined;
    logger.debug(
      `[KeyboardManager] Session mode changed for scope=${scopeKey}: ${oldMode} -> ${mode}`,
    );
    if (scopedState.api && scopedState.chatId) {
      this.sendKeyboardUpdate(scopedState.chatId).catch(() => {});
    }
  }

  public refreshSystemInfo(): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot refresh system info: not initialized");
      return;
    }
    const info = getSystemInfo();
    scopedState.state.cpuInfo = info.cpu;
    scopedState.state.ramInfo = info.ram;
  }

  public getContextInfo(): ContextInfo | null {
    return this.getScopedState().state?.contextInfo ?? null;
  }

  private buildKeyboard() {
    const scopedState = this.getScopedState();
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot build keyboard: not initialized");
      return createMainKeyboard("build", { providerID: "", modelID: "" }, undefined);
    }
    this.refreshSystemInfo();
    const isRunning = processManager.isRunning();
    const scope = getCurrentTelegramConversationScope();
    const isTerminal = scopedState.state.sessionMode === SessionType.TERMINAL
      || (scopedState.state.sessionMode === SessionType.NONE && isTerminalTopic(scope?.messageThreadId));
    return createMainKeyboard(
      scopedState.state.currentAgent,
      scopedState.state.currentModel,
      scopedState.state.contextInfo ?? undefined,
      scopedState.state.variantName,
      {
        isRunning,
        isTerminalRunning: isTerminal ? ((scope?.messageThreadId !== undefined && isTerminalRunning(scope.messageThreadId)) || foregroundSessionState.isBusy()) : false,
        cpuInfo: scopedState.state.cpuInfo,
        ramInfo: scopedState.state.ramInfo,
        isTerminalTopic: isTerminal,
      },
    );
  }

  public async sendKeyboardUpdate(chatId?: number, scopeKey?: string): Promise<void> {
    const resolvedScopeKey = scopeKey ?? this.getScopeKey();
    const scopedState = this.getScopedState(resolvedScopeKey);
    if (!scopedState.api) {
      logger.warn("[KeyboardManager] API not initialized");
      return;
    }

    const targetChatId = chatId ?? scopedState.chatId;
    if (!targetChatId) {
      logger.warn("[KeyboardManager] No chatId available");
      return;
    }

    const now = Date.now();
    if (now - scopedState.lastUpdateTime < this.UPDATE_DEBOUNCE_MS) {
      logger.debug(`[KeyboardManager] Update debounced for scope=${scopeKey}`);
      return;
    }

    scopedState.lastUpdateTime = now;

    try {
      const keyboard = this.buildKeyboard();

      if (scopedState.keyboardMessageId) {
        await scopedState.api.editMessageReplyMarkup(targetChatId, scopedState.keyboardMessageId, {
          reply_markup: keyboard,
        } as any).catch(() => {
          scopedState.keyboardMessageId = undefined;
        });
      }
      logger.debug(`[KeyboardManager] Keyboard update sent for scope=${scopeKey}`);
    } catch (err) {
      logger.error("[KeyboardManager] Failed to send keyboard update:", err);
    }
  }

  public setKeyboardMessageId(messageId: number): void {
    const scopedState = this.getScopedState();
    scopedState.keyboardMessageId = messageId;
    logger.debug(`[KeyboardManager] Keyboard messageId set: ${messageId}`);
  }

  public getKeyboard() {
    const scopedState = this.getScopedState();
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot get keyboard: not initialized");
      return undefined;
    }
    return this.buildKeyboard();
  }

  public getState(): KeyboardState | undefined {
    return this.getScopedState().state ?? undefined;
  }

  public isInitialized(): boolean {
    return this.getScopedState().state !== null;
  }

  public startAutoUpdate(): void {
    if (this.autoUpdateInterval) return;
    this.autoUpdateInterval = setInterval(() => {
      for (const [scopeKey, scopedState] of this.scopedStates) {
        if (scopedState.api && scopedState.chatId) {
          this.sendKeyboardUpdate(scopedState.chatId, scopeKey).catch(() => {});
        }
      }
    }, this.AUTO_UPDATE_MS);
    logger.debug("[KeyboardManager] Auto-update started");
  }

  public stopAutoUpdate(): void {
    if (this.autoUpdateInterval) {
      clearInterval(this.autoUpdateInterval);
      this.autoUpdateInterval = null;
      logger.debug("[KeyboardManager] Auto-update stopped");
    }
  }
}

export function __resetKeyboardManagersForTests(): void {
  keyboardManager["scopedStates"] = new Map<string, ScopedKeyboardState>();
}

export const keyboardManager = new KeyboardManager();
