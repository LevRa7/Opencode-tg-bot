import type { Context } from "grammy";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";
import { interactionManager } from "./manager.js";
import { allowsBusyInteraction } from "./busy.js";
import type {
  BlockReason,
  ExpectedInput,
  GuardDecision,
  IncomingInputType,
  InteractionState,
} from "./types.js";

function normalizeIncomingCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const token = trimmed.split(/\s+/)[0];
  const withoutMention = token.split("@")[0].toLowerCase();

  if (withoutMention.length <= 1) {
    return null;
  }

  return withoutMention;
}

function classifyIncomingInput(ctx: Context): {
  inputType: IncomingInputType;
  command?: string;
} {
  if (ctx.callbackQuery?.data) {
    return { inputType: "callback" };
  }

  const text = ctx.message?.text;
  if (typeof text === "string") {
    const command = normalizeIncomingCommand(text);
    if (command) {
      return { inputType: "command", command };
    }

    return { inputType: "text" };
  }

  if (ctx.message?.photo) {
    return { inputType: "other" };
  }

  return { inputType: "other" };
}

function getExpectedInputBlockReason(expectedInput: ExpectedInput): BlockReason {
  switch (expectedInput) {
    case "callback":
      return "expected_callback";
    case "command":
      return "expected_command";
    case "text":
    case "mixed":
      return "expected_text";
  }
}

function createAllowDecision(
  inputType: IncomingInputType,
  state: InteractionState | null,
  command?: string,
  busy?: boolean,
): GuardDecision {
  return {
    allow: true,
    inputType,
    state,
    command,
    busy,
  };
}

function createBlockDecision(
  inputType: IncomingInputType,
  state: InteractionState,
  reason: BlockReason,
  command?: string,
  busy?: boolean,
): GuardDecision {
  return {
    allow: false,
    inputType,
    state,
    reason,
    command,
    busy,
  };
}

function createBusyBlockDecision(
  inputType: IncomingInputType,
  state: InteractionState | null,
  reason: BlockReason,
  command?: string,
): GuardDecision {
  return {
    allow: false,
    inputType,
    state,
    reason,
    command,
    busy: true,
  };
}

function isAllowedRenameCancelCallback(ctx: Context, state: InteractionState): boolean {
  return (
    state.kind === "rename" &&
    state.expectedInput === "text" &&
    ctx.callbackQuery?.data === "rename:cancel"
  );
}

function isAllowedTaskCallback(ctx: Context, state: InteractionState): boolean {
  return (
    state.kind === "task" &&
    (ctx.callbackQuery?.data === "task:cancel" || ctx.callbackQuery?.data === "task:retry-schedule")
  );
}

function isAllowedAccessApprovalCallback(ctx: Context): boolean {
  return ctx.callbackQuery?.data?.startsWith("access:") === true;
}

export function resolveInteractionGuardDecision(ctx: Context): GuardDecision {
  const state = interactionManager.getSnapshot();
  const { inputType, command } = classifyIncomingInput(ctx);
  const isBusy = foregroundSessionState.isBusy();

  if (isAllowedAccessApprovalCallback(ctx)) {
    return createAllowDecision(inputType, state, command, isBusy);
  }

  if (state && interactionManager.isExpired()) {
    interactionManager.clear("expired");
    return createBlockDecision(inputType, state, "expired", command, isBusy);
  }

  if (isBusy) {
    if (inputType === "command") {
      // While busy, all commands are allowed. Session-mutating commands abort the
      // in-flight run first via abortThenRun() in their handlers (see ./busy.ts).
      return createAllowDecision(inputType, state, command, true);
    }

    // When no interaction state is active and the session is busy, allow all
    // input types through. The handlers themselves check foregroundSessionState
    // and defer media/text to the batch mechanism, rather than being blocked here
    // with a confusing "finish current interaction" message.
    if (!state) {
      return createAllowDecision(inputType, null, command, true);
    }

    if (allowsBusyInteraction(state.kind)) {
      if (state.expectedInput === "mixed") {
        if (inputType === "callback" || inputType === "text") {
          return createAllowDecision(inputType, state, command, true);
        }

        return createBusyBlockDecision(inputType, state, "expected_text", command);
      }

      if (state.expectedInput === inputType) {
        return createAllowDecision(inputType, state, command, true);
      }

      return createBusyBlockDecision(
        inputType,
        state,
        getExpectedInputBlockReason(state.expectedInput),
        command,
      );
    }

    return createBusyBlockDecision(inputType, state, "expected_text", command);
  }

  if (!state) {
    return createAllowDecision(inputType, null, command);
  }

  if (inputType === "command") {
    if (command === "/start") {
      return createAllowDecision(inputType, state, command);
    }

    if (command && state.allowedCommands.includes(command)) {
      return createAllowDecision(inputType, state, command);
    }

    return createBlockDecision(inputType, state, "command_not_allowed", command);
  }

  if (state.expectedInput === "mixed") {
    if (inputType === "callback" || inputType === "text") {
      return createAllowDecision(inputType, state, command);
    }

    return createBlockDecision(inputType, state, "expected_text", command);
  }

  if (inputType === "callback" && isAllowedRenameCancelCallback(ctx, state)) {
    return createAllowDecision(inputType, state, command);
  }

  if (inputType === "callback" && isAllowedTaskCallback(ctx, state)) {
    return createAllowDecision(inputType, state, command);
  }

  if (state.expectedInput === inputType) {
    return createAllowDecision(inputType, state, command);
  }

  return createBlockDecision(
    inputType,
    state,
    getExpectedInputBlockReason(state.expectedInput),
    command,
  );
}
