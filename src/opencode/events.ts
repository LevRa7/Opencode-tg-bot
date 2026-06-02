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
let sseIdleTimeoutMs = 120_000;
const FATAL_NO_STREAM_ERROR = "No stream returned from event subscription";
const SSE_IDLE_TIMEOUT_ERROR = "SSE stream idle timeout";

type StreamReadResult =
  | { type: "next"; result: IteratorResult<unknown, unknown> }
  | { type: "error"; error: unknown }
  | { type: "aborted" }
  | { type: "timeout" };

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

function createAttemptAbortController(parentSignal: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();

  if (parentSignal.aborted) {
    controller.abort();
    return { controller, cleanup: () => {} };
  }

  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });

  return {
    controller,
    cleanup: () => parentSignal.removeEventListener("abort", onAbort),
  };
}

function readStreamWithIdleTimeout(
  stream: AsyncGenerator<unknown, unknown, unknown>,
  signal: AbortSignal,
): Promise<StreamReadResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StreamReadResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => finish({ type: "aborted" });
    const timeout = setTimeout(() => finish({ type: "timeout" }), sseIdleTimeoutMs);

    if (signal.aborted) {
      finish({ type: "aborted" });
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });

    stream.next().then(
      (result) => finish({ type: "next", result }),
      (error) => finish({ type: "error", error }),
    );
  });
}

function isEventStreamIdleTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === SSE_IDLE_TIMEOUT_ERROR;
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
  logger.warn(`[Events] subscribeToEvents called: directory=${directory}, key=${getCurrentOpencodeRuntimeKey()}`);

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
      let attemptAbort: ReturnType<typeof createAttemptAbortController> | null = null;
      try {
        await ensureCurrentOpencodeRouteReady();
  logger.warn(`[Events] subscribeToEvents called: directory=${directory}, key=${getCurrentOpencodeRuntimeKey()}`);

        let subscription: EventStreamSubscription;
        attemptAbort = createAttemptAbortController(controller.signal);
        if (useLegacyEventsOnce) {
          useLegacyEventsOnce = false;
          subscription = await subscribeToLegacyEventStream(directory, attemptAbort.controller.signal);
        } else {
          try {
            subscription = await subscribeToGlobalEventStream(attemptAbort.controller.signal);
            logger.warn(`[Events] Using GLOBAL stream for ${listenerKey}`);
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
            logger.warn(`[Events] Using LEGACY stream for ${listenerKey}`);
            subscription = await subscribeToLegacyEventStream(directory, attemptAbort.controller.signal);
          }
        }

        reconnectAttempt = 0;
        state.eventStream = subscription.stream;
        logger.warn(`[Events] Stream connected for ${listenerKey} (source=${subscription.source})`);
        let usefulEventCount = 0;

        try {
          while (state.isListening && !controller.signal.aborted) {

            const readResult = await readStreamWithIdleTimeout(
              state.eventStream,
              attemptAbort.controller.signal,
            );

            if (readResult.type === "aborted") {
              logger.debug(`Event listener stopped for ${listenerKey}, breaking loop`);
              break;
            }

            if (readResult.type === "timeout") {
              attemptAbort.controller.abort();
              const closeStream = state.eventStream.return?.(undefined);
              void closeStream?.catch(() => undefined);
              throw new Error(SSE_IDLE_TIMEOUT_ERROR);
            }

            if (readResult.type === "error") {
              throw readResult.error;
            }

            if (readResult.result.done) {
              break;
            }

            const event = readResult.result.value;

            const normalizedEvent = normalizeEvent(event, subscription.source, directory);
            if (!normalizedEvent) {
              continue;
            }

            if (usefulEventCount === 0) {
              logger.warn(`[Events] First useful event: type=${normalizedEvent.type}`);
            }
            if (normalizedEvent.type !== "server.connected") {
              usefulEventCount++;
            }

            if (state.eventCallback) {
              const callbackSnapshot = state.eventCallback;
              queueMicrotask(() => {
                if (
                  controller.signal.aborted ||
                  !state.isListening
                ) {
                  return;
                }

                try {
                  callbackSnapshot(normalizedEvent);
                } catch (error) {
                  logger.error("[Events] Callback failed:", error);
                }
              });
            }
          }
        } finally {
          attemptAbort.cleanup();
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
        attemptAbort?.cleanup();
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
        if (isEventStreamIdleTimeoutError(error)) {
          logger.warn(
            `Event stream idle timeout for ${listenerKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
          );
        } else if (isExpectedOpencodeUnavailableError(error)) {
          logger.warn(
            `Event stream unavailable for ${listenerKey}, reconnecting in ${reconnectDelay}ms (attempt=${reconnectAttempt})`,
          );
        } else {
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

export function __setSseIdleTimeoutForTests(timeoutMs: number): void {
  sseIdleTimeoutMs = timeoutMs;
}
