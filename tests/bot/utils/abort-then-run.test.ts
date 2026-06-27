import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted is required so the mock factory below can reference the spy:
// vitest hoists vi.mock() above other statements, so a plain const would be
// in the temporal dead zone when the factory runs at import time.
const { abortCurrentOperation } = vi.hoisted(() => ({
  abortCurrentOperation: vi.fn(async () => {}),
}));
let busy = false;
vi.mock("../../../src/bot/commands/abort.js", () => ({ abortCurrentOperation }));
vi.mock("../../../src/bot/utils/busy-guard.js", () => ({ isForegroundBusy: () => busy }));

import { abortThenRun } from "../../../src/bot/utils/abort-then-run.js";

describe("abortThenRun", () => {
  beforeEach(() => {
    abortCurrentOperation.mockClear();
  });

  it("aborts then runs the action when busy", async () => {
    busy = true;
    const order: string[] = [];
    abortCurrentOperation.mockImplementation(async () => {
      order.push("abort");
    });
    await abortThenRun({} as any, async () => {
      order.push("action");
    });
    expect(order).toEqual(["abort", "action"]);
  });

  it("runs the action directly when idle", async () => {
    busy = false;
    const action = vi.fn(async () => {});
    await abortThenRun({} as any, action);
    expect(abortCurrentOperation).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledOnce();
  });
});
