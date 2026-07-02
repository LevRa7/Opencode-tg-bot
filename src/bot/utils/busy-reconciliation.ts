import { opencodeClient } from "../../opencode/client.js";
import {
  foregroundSessionState,
  type ForegroundBusySession,
} from "../../scheduled-task/foreground-state.js";
import { scheduledTaskRuntime } from "../../scheduled-task/runtime.js";
import { attachManager } from "../../attach/manager.js";
import { markAttachedSessionBusy, markAttachedSessionIdle } from "../../attach/service.js";
import { assistantRunState } from "../assistant-run-state.js";
import { clearPromptResponseMode } from "../handlers/prompt.js";
import { logger } from "../../utils/logger.js";

const RECONCILE_MIN_INTERVAL_MS = 10_000;
const FOREGROUND_BUSY_RECONCILE_GRACE_MS = 15_000;
const FOREGROUND_NOT_FOUND_GRACE_MS = 30_000;
// 2026-07-02: after markFinalResponsePublished, the model may continue producing
// more messages in the same turn (tool calls, follow-up text). Reconciliation
// must not clear the run within this window — it would drop subsequent messages.
const FINALIZED_COOLDOWN_MS = 30_000;
const MAX_IN_FLIGHT_RECONCILES = 5;

type SessionStatus = {
  type?: string;
};

const inFlightDirectories = new Set<string>();
const lastReconcileAtByDirectory = new Map<string, number>();

function getReconciliationTargets(directory: string): {
  foregroundBusySessions: ForegroundBusySession[];
  attachedSessionForDirectory: { sessionId: string; directory: string } | null;
} {
  const foregroundBusySessions = foregroundSessionState
    .getBusySessions()
    .filter((session) => session.directory === directory);

  const allStates = attachManager.getAllStates();
  const matchingState = allStates.find((state) => state.session.directory === directory);
  const attachedSessionForDirectory = matchingState
    ? { sessionId: matchingState.session.id, directory: matchingState.session.directory }
    : null;

  return { foregroundBusySessions, attachedSessionForDirectory };
}

function getSessionStatus(statuses: unknown, sessionId: string): SessionStatus | null {
  if (!statuses || typeof statuses !== "object") {
    return null;
  }

  const status = (statuses as Record<string, SessionStatus | undefined>)[sessionId];
  return status ?? null;
}

function isTerminalStatus(status: SessionStatus | null): boolean {
  return !status || status.type === "idle" || status.type === "error";
}

function isWithinForegroundBusyGracePeriod(
  session: ForegroundBusySession,
  now: number,
): boolean {
  return now - session.markedAt < FOREGROUND_BUSY_RECONCILE_GRACE_MS;
}

// 2026-07-01: when the session is not found in the server's status response
// (status === null), the model may still be warming up (especially cold-start
// providers like godmode/deepseek-v4-flash-free). Use a longer grace period
// to avoid false-positive "stale" clears during model startup (see bug where
// BusyReconciliation cleared the run 6 seconds after promptAsync, 12 times
// in a 20-minute agent session).
function isWithinNotFoundGracePeriod(
  session: ForegroundBusySession,
  now: number,
): boolean {
  return now - session.markedAt < FOREGROUND_NOT_FOUND_GRACE_MS;
}

async function clearForegroundBusySession(sessionId: string, reason: string): Promise<void> {
  foregroundSessionState.markIdle(sessionId);
  assistantRunState.clearRun(sessionId, reason);
  clearPromptResponseMode(sessionId);
}

export async function reconcileBusyStateNow(directory: string, now: number = Date.now()): Promise<void> {
  if (!directory) {
    return;
  }

  const { foregroundBusySessions, attachedSessionForDirectory } =
    getReconciliationTargets(directory);

  if (foregroundBusySessions.length === 0 && !attachedSessionForDirectory) {
    return;
  }

  const { data: statuses, error } = await opencodeClient.session.status({ directory });
  if (error || !statuses) {
    logger.warn("[BusyReconciliation] Failed to load session status", error);
    return;
  }

  const freshForegroundSessionIds = new Set(
    foregroundBusySessions
      .filter((session) => isWithinForegroundBusyGracePeriod(session, now))
      .map((session) => session.sessionId),
  );

  if (attachedSessionForDirectory) {
    const attachedStatus = getSessionStatus(statuses, attachedSessionForDirectory.sessionId);

    if (attachedStatus?.type === "busy") {
      await markAttachedSessionBusy(attachedSessionForDirectory.sessionId);
    } else if (
      isTerminalStatus(attachedStatus) &&
      !freshForegroundSessionIds.has(attachedSessionForDirectory.sessionId)
    ) {
      await markAttachedSessionIdle(attachedSessionForDirectory.sessionId);
    }
  }

  let clearedForegroundSession = false;
  for (const session of foregroundBusySessions) {
    const status = getSessionStatus(statuses, session.sessionId);
    if (!isTerminalStatus(status)) {
      continue;
    }

    if (freshForegroundSessionIds.has(session.sessionId)) {
      logger.debug(
        `[BusyReconciliation] Skipping fresh foreground busy state: session=${session.sessionId}, directory=${session.directory}, status=${status?.type ?? "not-found"}`,
      );
      continue;
    }

    // 2026-07-01: server reports "not-found" during model startup / cold-start
    // warmup. Don't clear sessions that haven't been busy long enough to rule
    // out this warmup window — use a dedicated 30s grace period for not-found.
    if (!status && isWithinNotFoundGracePeriod(session, now)) {
      logger.debug(
        `[BusyReconciliation] Skipping clear, not-found within grace period: session=${session.sessionId}, directory=${session.directory}, elapsed=${now - session.markedAt}ms`,
      );
      continue;
    }

    // 2026-06-26: the server flips a session to idle as soon as the model stops
    // generating, but the bot's completion/finalization pipeline runs asynchronously
    // for a few more seconds. Clearing the run mid-finalization turns
    // markFinalResponsePublished into a no-op, which breaks the isFinalResponsePublished
    // guard that suppresses trailing partial deltas and leaves a duplicate streaming
    // draft next to the final message. Skip while finalization is in flight; the next
    // reconcile pass clears it once the final response has been published (or the run is
    // cleared on finalize failure).
    if (assistantRunState.isFinalizationInFlight(session.sessionId)) {
      logger.debug(
        `[BusyReconciliation] Skipping clear, finalization in flight: session=${session.sessionId}, directory=${session.directory}, status=${status?.type ?? "not-found"}`,
      );
      continue;
    }

    // 2026-07-02: after markFinalResponsePublished, the model may produce more
    // messages in the same turn (tool calls after tool execution, follow-up
    // text). Don't clear the run within FINALIZED_COOLDOWN_MS of the last
    // publication — the next message from the model would hit a dead run.
    const finalizedAt = assistantRunState.getFinalizedAt(session.sessionId);
    if (finalizedAt !== undefined && now - finalizedAt < FINALIZED_COOLDOWN_MS) {
      logger.debug(
        `[BusyReconciliation] Skipping clear, finalized cooldown: session=${session.sessionId}, directory=${session.directory}, elapsed=${now - finalizedAt}ms`,
      );
      continue;
    }

    logger.info(
      `[BusyReconciliation] Clearing stale foreground busy state: session=${session.sessionId}, directory=${session.directory}, status=${status?.type ?? "not-found"}`,
    );
    if (attachedSessionForDirectory?.sessionId !== session.sessionId) {
      await markAttachedSessionIdle(session.sessionId);
    }
    await clearForegroundBusySession(session.sessionId, "status_reconcile_idle");
    clearedForegroundSession = true;
  }

  if (clearedForegroundSession) {
    await scheduledTaskRuntime.flushDeferredDeliveries();
  }
}

export async function reconcileBusyState(directory: string, now: number = Date.now()): Promise<void> {
  if (!directory || inFlightDirectories.has(directory)) {
    return;
  }

  if (inFlightDirectories.size >= MAX_IN_FLIGHT_RECONCILES) {
    logger.warn("[BusyReconciliation] Too many in-flight reconciles, skipping");
    return;
  }

  const lastReconcileAt = lastReconcileAtByDirectory.get(directory);
  if (lastReconcileAt !== undefined && now - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) {
    return;
  }

  const { foregroundBusySessions, attachedSessionForDirectory } =
    getReconciliationTargets(directory);
  if (foregroundBusySessions.length === 0 && !attachedSessionForDirectory) {
    return;
  }

  lastReconcileAtByDirectory.set(directory, now);
  inFlightDirectories.add(directory);

  try {
    await reconcileBusyStateNow(directory, now);
  } catch (error) {
    logger.warn("[BusyReconciliation] Failed to reconcile busy state", error);
  } finally {
    inFlightDirectories.delete(directory);
  }
}

export function __resetBusyReconciliationForTests(): void {
  inFlightDirectories.clear();
  lastReconcileAtByDirectory.clear();
}
