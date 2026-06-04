/**
 * GoalManager — per-scope goal state + continuation decisions.
 *
 * Ported from Hermes Agent goals.py. The manager is bound to a scope key
 * (Telegram chat + thread) and uses a GoalsRepository for persistence.
 *
 * Call evaluateAfterTurn() after every agent response to drive the
 * Ralph goal loop: judge → continue → loop, until done or budget exhausted.
 */

import type { GoalsRepository } from "../../settings/repositories/goals.js";
import type { GoalDecision, GoalState, GoalStatus, GoalVerdict } from "./types.js";
import { CONTINUATION_PROMPT_TEMPLATE, DEFAULT_MAX_TURNS } from "./constants.js";
import { judgeGoal } from "./judge.js";
import { logger } from "../../utils/logger.js";

export class GoalManager {
  private repo: GoalsRepository;
  private scopeKey: string;
  private defaultMaxTurns: number;
  private _state: GoalState | undefined;

  constructor(
    repo: GoalsRepository,
    scopeKey: string,
    defaultMaxTurns: number = DEFAULT_MAX_TURNS,
  ) {
    this.repo = repo;
    this.scopeKey = scopeKey;
    this.defaultMaxTurns = defaultMaxTurns;
    this._state = repo.get(scopeKey);
  }

  // --- introspection ---

  get state(): GoalState | undefined {
    return this._state;
  }

  isActive(): boolean {
    return this._state !== undefined && this._state.status === "active";
  }

  hasGoal(): boolean {
    return this._state !== undefined && (this._state.status === "active" || this._state.status === "paused");
  }

  statusLine(): string {
    const s = this._state;
    if (!s || s.status === "cleared") {
      return "No active goal. Set one with /goal <text>.";
    }
    const turns = `${s.turnsUsed}/${s.maxTurns} turns`;
    if (s.status === "active") {
      return `⊙ Goal (active, ${turns}): ${s.goal}`;
    }
    if (s.status === "paused") {
      const extra = s.pausedReason ? ` — ${s.pausedReason}` : "";
      return `⏸ Goal (paused, ${turns}${extra}): ${s.goal}`;
    }
    if (s.status === "done") {
      return `✓ Goal done (${turns}): ${s.goal}`;
    }
    return `Goal (${s.status}, ${turns}): ${s.goal}`;
  }

  // --- mutation ---

  set(goal: string, maxTurns?: number): GoalState {
    const trimmed = (goal || "").trim();
    if (!trimmed) {
      throw new Error("goal text is empty");
    }
    const state: GoalState = {
      goal: trimmed,
      status: "active",
      turnsUsed: 0,
      maxTurns: maxTurns ?? this.defaultMaxTurns,
      createdAt: Date.now(),
      lastTurnAt: 0,
      lastVerdict: null,
      lastReason: null,
      pausedReason: null,
    };
    this._state = state;
    this.repo.upsert(this.scopeKey, state);
    return state;
  }

  pause(reason: string = "user-paused"): GoalState | undefined {
    if (!this._state) return undefined;
    this._state.status = "paused";
    this._state.pausedReason = reason;
    this.repo.upsert(this.scopeKey, this._state);
    return this._state;
  }

  resume(resetBudget: boolean = true): GoalState | undefined {
    if (!this._state) return undefined;
    this._state.status = "active";
    this._state.pausedReason = null;
    if (resetBudget) {
      this._state.turnsUsed = 0;
    }
    this.repo.upsert(this.scopeKey, this._state);
    return this._state;
  }

  clear(): void {
    if (!this._state) return;
    this._state.status = "cleared";
    this.repo.upsert(this.scopeKey, this._state);
    this._state = undefined;
  }

  markDone(reason: string): void {
    if (!this._state) return;
    this._state.status = "done";
    this._state.lastVerdict = "done";
    this._state.lastReason = reason;
    this.repo.upsert(this.scopeKey, this._state);
  }

  // --- the main entry point called after every turn ---

  async evaluateAfterTurn(
    lastResponse: string,
  ): Promise<GoalDecision> {
    const state = this._state;
    if (!state || state.status !== "active") {
      return {
        status: state?.status ?? null,
        shouldContinue: false,
        continuationPrompt: null,
        verdict: "inactive",
        reason: "no active goal",
        message: "",
      };
    }

    // Count the turn that just finished
    state.turnsUsed += 1;
    state.lastTurnAt = Date.now();

    const { verdict, reason } = await judgeGoal(state.goal, lastResponse);
    state.lastVerdict = verdict;
    state.lastReason = reason;

    if (verdict === "done") {
      state.status = "done";
      this.repo.upsert(this.scopeKey, state);
      return {
        status: "done",
        shouldContinue: false,
        continuationPrompt: null,
        verdict: "done",
        reason,
        message: `✓ Goal achieved: ${reason}`,
      };
    }

    if (state.turnsUsed >= state.maxTurns) {
      state.status = "paused";
      state.pausedReason = `turn budget exhausted (${state.turnsUsed}/${state.maxTurns})`;
      this.repo.upsert(this.scopeKey, state);
      return {
        status: "paused",
        shouldContinue: false,
        continuationPrompt: null,
        verdict: "continue",
        reason,
        message: `⏸ Goal paused — ${state.turnsUsed}/${state.maxTurns} turns used. Use /goal resume to keep going, or /goal clear to stop.`,
      };
    }

    this.repo.upsert(this.scopeKey, state);
    return {
      status: "active",
      shouldContinue: true,
      continuationPrompt: this.nextContinuationPrompt(),
      verdict: "continue",
      reason,
      message: `↻ Continuing toward goal (${state.turnsUsed}/${state.maxTurns}): ${reason}`,
    };
  }

  nextContinuationPrompt(): string | null {
    if (!this._state || this._state.status !== "active") return null;
    return CONTINUATION_PROMPT_TEMPLATE.replace("{goal}", this._state.goal);
  }
}
