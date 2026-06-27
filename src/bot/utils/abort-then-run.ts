import type { Context } from "grammy";
import { isForegroundBusy } from "./busy-guard.js";
import { abortCurrentOperation } from "../commands/abort.js";

/**
 * Run a session-mutating action safely while a response may be streaming.
 * If the foreground session is busy (checked under the ctx's conversation scope via
 * isForegroundBusy), abort the in-flight run first (abortCurrentOperation aborts +
 * polls until idle + releases busy state), then run the action; else run it directly.
 * action() runs with the handler's normal ambient scope and resolves its own scope
 * from ctx, so it is intentionally not wrapped.
 */
export async function abortThenRun(
  ctx: Context,
  action: () => Promise<void>,
): Promise<void> {
  if (isForegroundBusy(ctx)) {
    await abortCurrentOperation(ctx, { notifyUser: true });
  }
  await action();
}
