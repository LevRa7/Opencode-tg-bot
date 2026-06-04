/**
 * Goal judge — calls an auxiliary model to decide if a goal is satisfied.
 *
 * Uses the configured cliproxyapi/Antigravity API endpoint directly via HTTP.
 * Fail-open semantics: any error returns ("continue", reason) so a broken
 * judge doesn't wedge progress — the turn budget is the backstop.
 */

import type { GoalVerdict } from "./types.js";
import {
  DEFAULT_JUDGE_TIMEOUT_MS,
  JUDGE_RESPONSE_SNIPPET_CHARS,
  JUDGE_SYSTEM_PROMPT,
} from "./constants.js";
import { logger } from "../../utils/logger.js";

function truncate(text: string, limit: number): string {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit) + "… [truncated]";
}

function parseJudgeResponse(raw: string): { done: boolean; reason: string } {
  if (!raw) return { done: false, reason: "judge returned empty response" };

  let text = raw.trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
  }

  try {
    const data = JSON.parse(text);
    if (typeof data === "object" && data !== null) {
      const doneVal = data.done;
      const done =
        typeof doneVal === "string"
          ? ["true", "yes", "1", "done"].includes(doneVal.trim().toLowerCase())
          : Boolean(doneVal);
      const reason = String(data.reason || "no reason provided").trim();
      return { done, reason };
    }
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const json = text.slice(firstBrace, lastBrace + 1);
        const data = JSON.parse(json);
        if (typeof data === "object" && data !== null) {
          const doneVal = data.done;
          const done =
            typeof doneVal === "string"
              ? ["true", "yes", "1", "done"].includes(doneVal.trim().toLowerCase())
              : Boolean(doneVal);
          const reason = String(data.reason || "no reason provided").trim();
          return { done, reason };
        }
      } catch {
        // fall through
      }
    }
  }

  return { done: false, reason: `judge reply was not JSON: ${truncate(raw, 200)}` };
}

const JUDGE_API_URL = process.env.OPENCODE_API_JUDGE_URL ||
  "https://api.smart-server.online/agy/v1/chat/completions";
const JUDGE_API_KEY = process.env.OPENCODE_API_KEY || "sk-antigravity";
const JUDGE_MODEL = process.env.OPENCODE_MODEL_ID || "gemini-3-flash";

let _controller: AbortController | null = null;

export async function judgeGoal(
  goal: string,
  lastResponse: string,
): Promise<{ verdict: GoalVerdict; reason: string }> {
  if (!goal.trim()) {
    return { verdict: "skipped", reason: "empty goal" };
  }
  if (!lastResponse.trim()) {
    return { verdict: "continue", reason: "empty response (nothing to evaluate)" };
  }

  const prompt =
    `Goal:\n${truncate(goal, 2000)}\n\n` +
    `Agent's most recent response:\n${truncate(lastResponse, JUDGE_RESPONSE_SNIPPET_CHARS)}\n\n` +
    `Is the goal satisfied?`;

  const controller = new AbortController();
  _controller = controller;
  const timeout = setTimeout(() => controller.abort(), DEFAULT_JUDGE_TIMEOUT_MS);

  try {
    const response = await fetch(JUDGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JUDGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.info(`goal judge: API returned ${response.status}: ${errText.slice(0, 200)}`);
      return { verdict: "continue", reason: `judge API error: HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;
    const raw =
      data?.choices?.[0]?.message?.content ||
      data?.content ||
      data?.text ||
      "";
    const { done, reason } = parseJudgeResponse(raw);

    const verdict: GoalVerdict = done ? "done" : "continue";
    logger.info(`goal judge: verdict=${verdict} reason=${truncate(reason, 120)}`);
    return { verdict, reason };
  } catch (exc: any) {
    clearTimeout(timeout);
    if (exc?.name === "AbortError") {
      logger.info("goal judge: timed out — falling through to continue");
      return { verdict: "continue", reason: "judge timed out" };
    }
    logger.info(`goal judge: call failed (${exc?.message || exc}) — falling through to continue`);
    return { verdict: "continue", reason: `judge error: ${exc?.constructor?.name || "Error"}` };
  } finally {
    _controller = null;
  }
}
