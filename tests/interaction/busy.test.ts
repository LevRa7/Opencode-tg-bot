import { describe, it, expect } from "vitest";
import {
  isSessionMutatingCommand,
  allowsBusyInteraction,
} from "../../src/interaction/busy.js";

describe("busy classification", () => {
  it("flags session-mutating commands", () => {
    expect(isSessionMutatingCommand("/new")).toBe(true);
    expect(isSessionMutatingCommand("/compact")).toBe(true);
    expect(isSessionMutatingCommand("/model")).toBe(false);
  });

  it("allows inline interaction during busy", () => {
    expect(allowsBusyInteraction("inline")).toBe(true);
    expect(allowsBusyInteraction("question")).toBe(true);
    expect(allowsBusyInteraction("rename")).toBe(false);
  });
});
