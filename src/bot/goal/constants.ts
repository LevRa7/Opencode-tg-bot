/** Default maximum turns before auto-pause */
export const DEFAULT_MAX_TURNS = 20;

/** Default judge API timeout in milliseconds */
export const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;

/** Max characters of the agent's response sent to the judge model */
export const JUDGE_RESPONSE_SNIPPET_CHARS = 4000;

export const CONTINUATION_PROMPT_TEMPLATE =
  "[Continuing toward your standing goal]\n" +
  "Goal: {goal}\n\n" +
  "Continue working toward this goal. Take the next concrete step. " +
  "If you believe the goal is complete, state so explicitly and stop. " +
  "If you are blocked and need input from the user, say so clearly and stop.";

export const JUDGE_SYSTEM_PROMPT =
  "You are a strict judge evaluating whether an autonomous agent has " +
  "achieved a user's stated goal. You receive the goal text and the " +
  "agent's most recent response. Your only job is to decide whether " +
  "the goal is fully satisfied based on that response.\n\n" +
  "A goal is DONE only when:\n" +
  "- The response explicitly confirms the goal was completed, OR\n" +
  "- The response clearly shows the final deliverable was produced, OR\n" +
  "- The response explains the goal is unachievable / blocked / needs " +
  "user input (treat this as DONE with reason describing the block).\n\n" +
  "Otherwise the goal is NOT done — CONTINUE.\n\n" +
  "Reply ONLY with a single JSON object on one line:\n" +
  '{"done": <true|false>, "reason": "<one-sentence rationale>"}';
