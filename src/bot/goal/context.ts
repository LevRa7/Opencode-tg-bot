/**
 * Goal context — scoped GoalManager access.
 *
 * Resolves the scope key from a grammy context and returns a
 * GoalManager instance bound to that scope.
 */

import type { Context } from "grammy";
import { GoalManager } from "./manager.js";
import { createGoalsRepository } from "../../settings/repositories/goals.js";
import { openDatabase } from "../../settings/db.js";
import { extractScopeKey } from "../utils/scope.js";

// Per-process cache of managers keyed by scope key
const managers = new Map<string, GoalManager>();

export function getGoalManager(ctx: Context): GoalManager {
  const scopeKey = extractScopeKey(ctx);
  const cached = managers.get(scopeKey);
  if (cached) return cached;

  // Read the DB from the settings path
  // The bot's settings DB is at the configured path
  const { SETTINGS_DB_PATH } = process.env;
  const dbPath = SETTINGS_DB_PATH || "/root/Opencode-tg-bot/settings.db";
  const db = openDatabase(dbPath);

  const repo = createGoalsRepository(db);
  const manager = new GoalManager(repo, scopeKey);
  managers.set(scopeKey, manager);
  return manager;
}

/**
 * Get the GoalManager for a given scope key directly.
 */
export function getGoalManagerForScope(scopeKey: string): GoalManager {
  const cached = managers.get(scopeKey);
  if (cached) return cached;

  const { SETTINGS_DB_PATH } = process.env;
  const dbPath = SETTINGS_DB_PATH || "/root/Opencode-tg-bot/settings.db";
  const db = openDatabase(dbPath);

  const repo = createGoalsRepository(db);
  const manager = new GoalManager(repo, scopeKey);
  managers.set(scopeKey, manager);
  return manager;
}
