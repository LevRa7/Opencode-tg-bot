import { describe, expect, it } from "vitest";

import type { TranslateFn } from "../../src/media/batch-types.js";
import {
  createForwardedSourceTag,
  isDeferredMediaItem,
} from "../../src/media/batch-types.js";

function mockT(key: string, params?: Record<string, string | number>): string {
  if (key === "deferred.forwarded.from_display" && typeof params?.displayName === "string") {
    return `[Forwarded from: ${params.displayName}]`;
  }
  if (key === "deferred.forwarded.from_another_user") {
    return "[Forwarded from another user]";
  }
  return "[Forwarded message]";
}

describe("media/batch-types", () => {
  it("returns true for deferred-eligible media items", () => {
    expect(
      isDeferredMediaItem({
        correlationId: "corr-1",
        kind: "photo",
      }),
    ).toBe(true);
  });

  it("returns false for plain text items", () => {
    expect(
      isDeferredMediaItem({
        correlationId: "corr-2",
        kind: "text",
      }),
    ).toBe(false);
  });

  it("builds a forwarded tag from the source display name", () => {
    expect(
      createForwardedSourceTag(
        {
          displayName: "Channel Alpha",
        },
        mockT as TranslateFn,
      ),
    ).toBe("[Forwarded from: Channel Alpha]");
  });

  it("trims padded forwarded source display names", () => {
    expect(
      createForwardedSourceTag(
        {
          displayName: "  Channel Alpha  ",
        },
        mockT as TranslateFn,
      ),
    ).toBe("[Forwarded from: Channel Alpha]");
  });

  it("uses the another-user forwarded fallback when no display name is present", () => {
    expect(
      createForwardedSourceTag(
        {
          isFromAnotherUser: true,
        },
        mockT as TranslateFn,
      ),
    ).toBe("[Forwarded from another user]");
  });

  it("treats whitespace-only forwarded display names as missing", () => {
    expect(
      createForwardedSourceTag(
        {
          displayName: "   ",
        },
        mockT as TranslateFn,
      ),
    ).toBe("[Forwarded message]");
  });

  it("falls back to a generic forwarded tag when the source is unknown", () => {
    expect(createForwardedSourceTag({}, mockT as TranslateFn)).toBe("[Forwarded message]");
  });
});
