/**
 * Goal state types — ported from Hermes Agent "Ralph loop" (goals.py).
 *
 * A standing goal is a user objective that stays active across turns.
 * After each turn, a judge evaluates whether the goal is achieved.
 */

export type GoalStatus = "active" | "paused" | "done" | "cleared";

export type GoalVerdict = "done" | "continue" | "skipped" | "inactive";

export interface GoalState {
  /** The user's original goal text */
  goal: string;
  /** Current lifecycle status */
  status: GoalStatus;
  /** How many agent turns have been consumed */
  turnsUsed: number;
  /** Maximum turns before auto-pause (default 20) */
  maxTurns: number;
  /** Unix timestamp when the goal was created */
  createdAt: number;
  /** Unix timestamp of the last evaluated turn */
  lastTurnAt: number;
  /** Most recent judge verdict */
  lastVerdict: GoalVerdict | null;
  /** Judge's one-sentence rationale */
  lastReason: string | null;
  /** Why the goal was auto-paused (budget exhausted, etc.) */
  pausedReason: string | null;
}

export interface GoalRow {
  scope_key: string;
  state: string; // JSON-serialized GoalState
  updated_at: string;
}

export interface GoalDecision {
  /** Current goal status after evaluation */
  status: GoalStatus | null;
  /** Whether the caller should fire another turn */
  shouldContinue: boolean;
  /** The prompt to feed as next user message, or null */
  continuationPrompt: string | null;
  /** Judge's verdict */
  verdict: GoalVerdict;
  /** Judge's rationale */
  reason: string;
  /** User-visible one-liner message */
  message: string;
}
