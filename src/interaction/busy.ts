import type { InteractionKind } from "./types.js";

// Commands that replace/mutate the active session or stop the server. While the
// session is busy these must abort the in-flight run first; their handlers wrap the
// action in abortThenRun(). Adjustable list (spec C1).
export const SESSION_MUTATING_COMMANDS = [
  "/new",
  "/compact",
  "/restart",
  "/opencode_start",
  "/opencode_stop",
] as const;

const SESSION_MUTATING_COMMAND_SET = new Set<string>(SESSION_MUTATING_COMMANDS);

export function isSessionMutatingCommand(command?: string): boolean {
  return Boolean(command && SESSION_MUTATING_COMMAND_SET.has(command));
}

// All user commands are allowed through the guard while busy. Session-mutating
// commands self-manage abort-then-act in their handlers (see abortThenRun).
export function isBusyAllowedCommand(_command?: string): boolean {
  return true;
}

export function allowsBusyInteraction(kind: InteractionKind | undefined): boolean {
  return kind === "question" || kind === "permission" || kind === "inline";
}
