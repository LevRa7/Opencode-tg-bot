import type { Context } from "grammy";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { abortCurrentOperation } from "../commands/abort.js";
import {
  extractTelegramConversationScopeFromContext,
  runWithTelegramConversationScope,
} from "../../telegram/scope.js";

/**
 * Runs a session-mutating action safely while a model response may be streaming.
 *
 * Purpose (abort-then-act): commands like /new or /compact must not race an
 * in-flight run. If the foreground session is busy, we abort the running prompt
 * first (abortCurrentOperation polls until the session is idle and releases the
 * busy state), and only then run the action. If nothing is running, we run the
 * action directly.
 *
 * Scope nuance: foreground busy state is marked under the conversation scope
 * derived from the originating ctx (see foregroundSessionState.markBusy(...) in
 * src/bot/handlers/prompt.ts). From a grammY command handler the *ambient*
 * AsyncLocalStorage scope is typically "global", so a bare isBusy() would read
 * the wrong (global) scope and could return a false negative, skipping the
 * needed abort. To avoid that, we resolve the conversation scope from ctx and
 * run both the busy check and the abort under that scope via
 * runWithTelegramConversationScope, so isBusy() resolves the same scope the run
 * was marked under, and abort sees the correct ambient scope too.
 */
export async function abortThenRun(
  ctx: Context,
  action: () => Promise<void>,
): Promise<void> {
  const scope = extractTelegramConversationScopeFromContext(ctx);

  await runWithTelegramConversationScope(scope, async () => {
    if (foregroundSessionState.isBusy()) {
      await abortCurrentOperation(ctx, { notifyUser: true });
    }
  });

  await action();
}
