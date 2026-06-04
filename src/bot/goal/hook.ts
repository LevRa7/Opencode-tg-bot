/**
 * Post-turn goal hook — runs after every agent response to drive the
 * Ralph goal loop. Evaluates whether the goal is achieved and, if not,
 * feeds a continuation prompt back into the session.
 */

import { getGoalManagerForScope } from "./context.js";
import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";

/**
 * Call after the agent produces a finalized response. Evaluates whether the
 * active goal is satisfied and, if not, dispatches a continuation turn.
 *
 * Uses opencodeClient.session.promptAsync() directly to feed the
 * continuation prompt into the session.
 *
 * @param scopeKey - The scope key for the chat+thread
 * @param lastResponse - The agent's text response from the last turn
 */
export async function runPostTurnGoalHook(
  scopeKey: string,
  lastResponse: string,
): Promise<void> {
  try {
    const manager = getGoalManagerForScope(scopeKey);
    if (!manager.isActive()) return;

    const decision = await manager.evaluateAfterTurn(lastResponse);

    if (!decision.shouldContinue || !decision.continuationPrompt) return;

    const session = getCurrentSession();
    if (!session) {
      logger.warn("[Goal hook] No current session for continuation");
      manager.pause("no active session");
      return;
    }

    const project = getCurrentProject();
    if (!project) {
      logger.warn("[Goal hook] No current project");
      manager.pause("no project context");
      return;
    }

    const agent = getStoredAgent();
    const model = getStoredModel();

    logger.info(
      `[Goal hook] Dispatching continuation turn: ${decision.reason}`,
    );

    await opencodeClient.session.promptAsync({
      sessionID: session.id,
      directory: project.worktree,
      parts: [{ type: "text", text: decision.continuationPrompt }],
      ...(agent ? { agent } : {}),
      ...(model ? { model: { providerID: model.providerID, modelID: model.modelID }, variant: model.variant || "default" } : {}),
    });
  } catch (err) {
    logger.error("[Goal hook] Error in post-turn goal evaluation:", err);
  }
}
