import { Event } from "@opencode-ai/sdk/v2";
import {
  ensureCurrentOpencodeRouteReady,
  getCurrentOpencodeRuntimeKey,
  getOpencodeClientForCurrentScope,
} from "./client.js";
import { logger } from "../utils/logger.js";

type EventCallback = (event: Event) => void;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";

interface EventListenerState {
  eventStream: AsyncGenerator<Event, unknown, unknown> | null;
  eventCallback: EventCallback | null;
  isListening: boolean;
  streamAbortController: AbortController | null;
}

const listenersByRuntimeAndDirectory = new Map<string, EventListenerState>();

function buildListenerKey(directory: string): string {
  return `${getCurrentOpencodeRuntimeKey()}::${directory}`;
}

function getListenerState(listenerKey: string): EventListenerState {
  const existingState = listenersByRuntimeAndDirectory.get(listenerKey);
  if (existingState) {
    return existingState;
  }

  const nextState: EventListenerState = {
    eventStream: null,
    eventCallback: null,
    isListening: false,
    streamAbortController: null,
  };
  listenersByRuntimeAndDirectory.set(listenerKey, nextState);
  return nextState;
}

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

export async function subscribeToEvents(directory: string, callback: EventCallback): Promise<void> {
  await ensureCurrentOpencodeRouteReady();

  const listenerKey = buildListenerKey(directory);
  const state = getListenerState(listenerKey);

  if (state.isListening) {
    state.eventCallback = callback;
    logger.debug(`Event listener already running for ${listenerKey}`);
    return;
  }

  const controller = new AbortController();

  state.eventCallback = callback;
  state.isListening = true;
  state.streamAbortController = controller;

  try {
    let reconnectAttempt = 0;

    while (state.isListening && !controller.signal.aborted) {
      try {
        await ensureCurrentOpencodeRouteReady();
        const result = await getOpencodeClientForCurrentScope().event.subscribe(
          { directory },
          { signal: controller.signal },
        );

        if (!result.stream) {
          throw new Error(FATAL_NO_STREAM_ERROR);
        }

        reconnectAttempt = 0;
        state.eventStream = result.stream;

        for await (const event of state.eventStream) {
          if (!state.isListening || controller.signal.aborted) {
            logger.debug(`Event listener stopped for ${listenerKey}, breaking loop`);
            break;
          }

          if (state.eventCallback) {
            const callbackSnapshot = state.eventCallback;
            queueMicrotask(() => callbackSnapshot(event));
          }
        }

        state.eventStream = null;

        if (!state.isListening || controller.signal.aborted) {
          break;
        }

        reconnectAttempt++;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        logger.warn(
          `Event stream ended for ${listenerKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
        );

        const shouldContinue = await waitWithAbort(reconnectDelay, controller.signal);
        if (!shouldContinue) {
          break;
        }
      } catch (error) {
        state.eventStream = null;

        if (controller.signal.aborted || !state.isListening) {
          logger.info(`Event listener aborted for ${listenerKey}`);
          return;
        }

        if (error instanceof Error && error.message === FATAL_NO_STREAM_ERROR) {
          logger.error("Event stream fatal error:", error);
          throw error;
        }

        reconnectAttempt++;
        const reconnectDelay = getReconnectDelayMs(reconnectAttempt);
        logger.error(
          `Event stream error for ${listenerKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
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
      logger.info(`Event listener aborted for ${listenerKey}`);
      return;
    }

    logger.error("Event stream error:", error);
    state.isListening = false;
    state.streamAbortController = null;
    throw error;
  } finally {
    if (state.streamAbortController === controller) {
      if (state.isListening && !controller.signal.aborted) {
        logger.warn(`Event stream ended for ${listenerKey}, listener marked as disconnected`);
      }

      state.streamAbortController = null;
      state.eventStream = null;
      state.eventCallback = null;
      state.isListening = false;
      listenersByRuntimeAndDirectory.delete(listenerKey);
    }
  }
}

export function stopEventListening(directory?: string): void {
  if (directory) {
    const listenerKey = buildListenerKey(directory);
    const state = listenersByRuntimeAndDirectory.get(listenerKey);
    if (!state) {
      return;
    }

    state.streamAbortController?.abort();
    state.streamAbortController = null;
    state.isListening = false;
    state.eventCallback = null;
    state.eventStream = null;
    listenersByRuntimeAndDirectory.delete(listenerKey);
    logger.info(`Event listener stopped for ${listenerKey}`);
    return;
  }

  for (const [activeKey, state] of listenersByRuntimeAndDirectory.entries()) {
    state.streamAbortController?.abort();
    state.streamAbortController = null;
    state.isListening = false;
    state.eventCallback = null;
    state.eventStream = null;
    logger.info(`Event listener stopped for ${activeKey}`);
  }

  listenersByRuntimeAndDirectory.clear();
}
