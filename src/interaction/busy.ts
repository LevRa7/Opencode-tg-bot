import type { InteractionKind } from "./types.js";

// Commands that replace/mutate the active session or stop the server. While the
// session is busy these must abort the in-flight run first; their handlers wrap the
// action in abortThenRun(). Adjustable list (spec C1).
export const SESSION_MUTATING_COMMANDS = [
  "/new",
  "/compact",
  "/restart",
  "/opencode_restart",
] as const;

const SESSION_MUTATING_COMMAND_SET = new Set<string>(SESSION_MUTATING_COMMANDS);

export function isSessionMutatingCommand(command?: string): boolean {
  return Boolean(command && SESSION_MUTATING_COMMAND_SET.has(command));
}

export function allowsBusyInteraction(kind: InteractionKind | undefined): boolean {
  return kind === "question" || kind === "permission" || kind === "inline";
}
