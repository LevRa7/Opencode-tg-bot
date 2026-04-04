import type { Api } from "grammy";
import { createMainKeyboard } from "../bot/utils/keyboard.js";
import type { ModelInfo } from "../model/types.js";
import { getStoredAgent } from "../agent/manager.js";
import { getStoredModel } from "../model/manager.js";
import { formatVariantForButton } from "../variant/manager.js";
import { logger } from "../utils/logger.js";
import type { ContextInfo, KeyboardState } from "./types.js";
import { t } from "../i18n/index.js";
import { getCurrentTelegramConversationScopeKey } from "../telegram/scope.js";

interface ScopedKeyboardState {
  state: KeyboardState | null;
  api: Api | null;
  chatId: number | null;
  lastUpdateTime: number;
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

  private readonly UPDATE_DEBOUNCE_MS = 2000;

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

  public getContextInfo(): ContextInfo | null {
    return this.getScopedState().state?.contextInfo ?? null;
  }

  private buildKeyboard() {
    const scopedState = this.getScopedState();
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot build keyboard: not initialized");
      return createMainKeyboard("build", { providerID: "", modelID: "" }, undefined);
    }
    return createMainKeyboard(
      scopedState.state.currentAgent,
      scopedState.state.currentModel,
      scopedState.state.contextInfo ?? undefined,
      scopedState.state.variantName,
    );
  }

  public async sendKeyboardUpdate(chatId?: number): Promise<void> {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
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
      await scopedState.api.sendMessage(targetChatId, t("keyboard.updated"), {
        reply_markup: keyboard,
      });
      logger.debug(`[KeyboardManager] Keyboard update sent for scope=${scopeKey}`);
    } catch (err) {
      logger.error("[KeyboardManager] Failed to send keyboard update:", err);
    }
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
}

export function __resetKeyboardManagersForTests(): void {
  keyboardManager["scopedStates"] = new Map<string, ScopedKeyboardState>();
}

export const keyboardManager = new KeyboardManager();
