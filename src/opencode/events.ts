import { Event } from "@opencode-ai/sdk/v2";
import {
  getCurrentTelegramConversationScope,
  resolveTelegramConversationScopeKey,
  runWithTelegramConversationScope,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import { logger } from "../utils/logger.js";
import { getOpencodeClient } from "./client.js";

type EventCallback = (event: Event) => void;

interface EventListenerState {
  scope: TelegramConversationScope | null;
  directory: string;
  callback: EventCallback;
  stream: AsyncGenerator<Event, unknown, unknown> | null;
  isListening: boolean;
  controller: AbortController;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";

const listenerRegistry = new Map<string, EventListenerState>();

function getReconnectDelayMs(attempt: number): number {
  const exponentialDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponentialDelay, RECONNECT_MAX_DELAY_MS);
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function buildScopePrefix(scope: TelegramConversationScope | null | undefined): string {
  return `${resolveTelegramConversationScopeKey(scope)}:`;
}

function buildListenerKey(
  directory: string,
  scope: TelegramConversationScope | null | undefined,
): string {
  return `${resolveTelegramConversationScopeKey(scope)}:${directory}`;
}

function removeListenerState(listenerKey: string, state: EventListenerState): void {
  const currentState = listenerRegistry.get(listenerKey);
  if (currentState === state) {
    listenerRegistry.delete(listenerKey);
  }
}

function stopListenersByPrefix(prefix: string): void {
  for (const [listenerKey, state] of listenerRegistry.entries()) {
    if (!listenerKey.startsWith(prefix)) {
      continue;
    }

    state.controller.abort();
    state.isListening = false;
    state.stream = null;
    listenerRegistry.delete(listenerKey);
  }
}

export async function subscribeToEvents(directory: string, callback: EventCallback): Promise<void> {
  const scope = getCurrentTelegramConversationScope();
  const scopeKey = resolveTelegramConversationScopeKey(scope);
  const listenerKey = buildListenerKey(directory, scope);
  const existingState = listenerRegistry.get(listenerKey);

  if (existingState?.isListening) {
    existingState.callback = callback;
    logger.debug(`Event listener already running for ${directory} in scope ${scopeKey}`);
    return;
  }

  stopListenersByPrefix(buildScopePrefix(scope));

  const controller = new AbortController();
  const listenerState: EventListenerState = {
    scope,
    directory,
    callback,
    stream: null,
    isListening: true,
    controller,
  };

  listenerRegistry.set(listenerKey, listenerState);

  try {
    let reconnectAttempt = 0;

    while (listenerState.isListening && !controller.signal.aborted) {
      try {
        const result = await runWithTelegramConversationScope(scope, () =>
          getOpencodeClient().event.subscribe({ directory }, { signal: controller.signal }),
        );

        if (!result.stream) {
          throw new Error(FATAL_NO_STREAM_ERROR);
        }

        reconnectAttempt = 0;
        listenerState.stream = result.stream;

        for await (const event of result.stream) {
          if (!listenerState.isListening || controller.signal.aborted) {
            logger.debug(`Event listener stopped for ${directory} in scope ${scopeKey}`);
            break;
          }

          await new Promise<void>((resolve) => setImmediate(resolve));

          const callbackSnapshot = listenerState.callback;
          setImmediate(() => {
            void runWithTelegramConversationScope(scope, () => callbackSnapshot(event));
          });
        }

        listenerState.stream = null;

        if (!listenerState.isListening || controller.signal.aborted) {
          break;
        }

        reconnectAttempt++;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        logger.warn(
          `Event stream ended for ${directory} in scope ${scopeKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
        );

        const shouldContinue = await waitWithAbort(reconnectDelay, controller.signal);
        if (!shouldContinue) {
          break;
        }
      } catch (error) {
        listenerState.stream = null;

        if (controller.signal.aborted || !listenerState.isListening) {
          logger.info(`Event listener aborted for scope ${scopeKey}`);
          return;
        }

        if (error instanceof Error && error.message === FATAL_NO_STREAM_ERROR) {
          logger.error(`Event stream fatal error for scope ${scopeKey}:`, error);
          throw error;
        }

        reconnectAttempt++;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        logger.error(
          `Event stream error for ${directory} in scope ${scopeKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
          error,
        );

        const shouldContinue = await waitWithAbort(reconnectDelay, controller.signal);
        if (!shouldContinue) {
          break;
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      logger.info(`Event listener aborted for scope ${scopeKey}`);
      return;
    }

    logger.error(`Event stream error for scope ${scopeKey}:`, error);
    listenerState.isListening = false;
    listenerState.stream = null;
    removeListenerState(listenerKey, listenerState);
    throw error;
  } finally {
    listenerState.isListening = false;
    listenerState.stream = null;
    removeListenerState(listenerKey, listenerState);
  }
}

export function stopEventListening(): void {
  const scope = getCurrentTelegramConversationScope();
  if (scope) {
    stopListenersByPrefix(buildScopePrefix(scope));
    logger.info(`Event listener stopped for scope ${resolveTelegramConversationScopeKey(scope)}`);
    return;
  }

  stopAllEventListening();
}

export function stopAllEventListening(): void {
  for (const state of listenerRegistry.values()) {
    state.controller.abort();
    state.isListening = false;
    state.stream = null;
  }

  listenerRegistry.clear();
  logger.info("All event listeners stopped");
}

export function __resetEventListenersForTests(): void {
  stopAllEventListening();
}
