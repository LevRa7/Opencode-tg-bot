import { Event } from "@opencode-ai/sdk/v2";
import {
  ensureCurrentOpencodeRouteReady,
  getCurrentOpencodeRuntimeKey,
  getOpencodeClientForCurrentScope,
} from "./client.js";
import { logger } from "../utils/logger.js";
import { opencodeReadyLifecycle } from "./ready-lifecycle.js";
import { isExpectedOpencodeUnavailableError } from "../utils/opencode-error.js";

type EventCallback = (event: Event) => void;
type EventStreamSource = "global" | "legacy";
type EventStreamSubscription = {
  source: EventStreamSource;
  stream: AsyncGenerator<unknown, unknown, unknown>;
};
type EventSubscriptionResult = {
  stream?: AsyncGenerator<unknown, unknown, unknown> | null;
};
type OptionalGlobalEventApi = {
  event?: (options?: { signal?: AbortSignal }) => Promise<EventSubscriptionResult>;
};
type OptionalGlobalEventClient = {
  global?: OptionalGlobalEventApi;
};

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";

interface EventListenerState {
  eventStream: AsyncGenerator<unknown, unknown, unknown> | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventLike(value: unknown): value is Event {
  return isRecord(value) && typeof value.type === "string" && isRecord(value.properties);
}

function normalizeDirectoryForComparison(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isSameDirectory(left: string, right: string): boolean {
  return normalizeDirectoryForComparison(left) === normalizeDirectoryForComparison(right);
}

function normalizeGlobalEvent(rawEvent: unknown, directory: string): Event | null {
  if (isEventLike(rawEvent)) {
    return rawEvent;
  }

  if (!isRecord(rawEvent) || !("payload" in rawEvent)) {
    logger.debug("[Events] Ignoring global event with unknown shape");
    return null;
  }

  const eventDirectory = typeof rawEvent.directory === "string" ? rawEvent.directory : null;
  if (eventDirectory && !isSameDirectory(eventDirectory, directory)) {
    return null;
  }

  if (!isEventLike(rawEvent.payload)) {
    logger.debug("[Events] Ignoring global event with unknown payload shape");
    return null;
  }

  return rawEvent.payload as Event;
}

function normalizeEvent(rawEvent: unknown, source: EventStreamSource, directory: string): Event | null {
  if (source === "global") {
    return normalizeGlobalEvent(rawEvent, directory);
  }

  if (!isEventLike(rawEvent)) {
    logger.debug("[Events] Ignoring legacy event with unknown shape");
    return null;
  }

  return rawEvent;
}

async function subscribeToGlobalEventStream(signal: AbortSignal): Promise<EventStreamSubscription> {
  const client = getOpencodeClientForCurrentScope();
  const globalEvents = (client as OptionalGlobalEventClient).global;
  if (!globalEvents?.event) {
    throw new Error("Global event subscription is not available");
  }

  const result = await globalEvents.event({ signal });
  if (!result.stream) {
    throw new Error(FATAL_NO_STREAM_ERROR);
  }

  return { source: "global", stream: result.stream };
}

async function subscribeToLegacyEventStream(
  directory: string,
  signal: AbortSignal,
): Promise<EventStreamSubscription> {
  const result = await getOpencodeClientForCurrentScope().event.subscribe(
    { directory },
    { signal },
  );

  if (!result.stream) {
    throw new Error(FATAL_NO_STREAM_ERROR);
  }

  return { source: "legacy", stream: result.stream };
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
    let useLegacyEventsOnce = false;

    while (state.isListening && !controller.signal.aborted) {
      try {
        await ensureCurrentOpencodeRouteReady();

        let subscription: EventStreamSubscription;
        if (useLegacyEventsOnce) {
          useLegacyEventsOnce = false;
          subscription = await subscribeToLegacyEventStream(directory, controller.signal);
        } else {
          try {
            subscription = await subscribeToGlobalEventStream(controller.signal);
            logger.debug(`Using global OpenCode event stream for ${listenerKey}`);
          } catch (error) {
            if (controller.signal.aborted || !state.isListening) {
              throw error;
            }

            if (isExpectedOpencodeUnavailableError(error)) {
              throw error;
            }

            logger.warn(
              `Global event stream unavailable for ${listenerKey}, falling back to project event stream`,
              error,
            );
            subscription = await subscribeToLegacyEventStream(directory, controller.signal);
          }
        }

        reconnectAttempt = 0;
        state.eventStream = subscription.stream;
        let usefulEventCount = 0;

        for await (const event of subscription.stream) {
          if (!state.isListening || controller.signal.aborted) {
            logger.debug(`Event listener stopped for ${listenerKey}, breaking loop`);
            break;
          }

          const normalizedEvent = normalizeEvent(event, subscription.source, directory);
          if (!normalizedEvent) {
            continue;
          }

          if (normalizedEvent.type !== "server.connected") {
            usefulEventCount++;
          }

          if (state.eventCallback) {
            const callbackSnapshot = state.eventCallback;
            queueMicrotask(() => callbackSnapshot(normalizedEvent));
          }
        }

        state.eventStream = null;

        if (!state.isListening || controller.signal.aborted) {
          break;
        }

        if (subscription.source === "global" && usefulEventCount === 0) {
          useLegacyEventsOnce = true;
          logger.warn(
            `Global event stream ended without project events for ${listenerKey}, falling back to project event stream`,
          );
          continue;
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
        const errorText = error instanceof Error ? error.message.toLowerCase() : "";
        if (errorText.includes("fetch failed") || errorText.includes("econnrefused")) {
          logger.warn(
            `Event stream unavailable for ${listenerKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
          );
        } else {
          logger.error(
            `Event stream error for ${listenerKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
            error,
          );
        }

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

    opencodeReadyLifecycle.notifyUnavailable("event_stream_error");
    const errorText = error instanceof Error ? error.message.toLowerCase() : "";
    if (errorText.includes("fetch failed") || errorText.includes("econnrefused")) {
      logger.warn("Event stream unavailable; listener stopped");
    } else {
      logger.error("Event stream error:", error);
    }
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
