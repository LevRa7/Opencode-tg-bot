import { describe, expect, it } from "vitest";
import { composeDeferredMediaPrompt } from "../../src/media/prompt-composer.js";

const t = (key: string, params?: Record<string, string | number>) => {
  switch (key) {
    case "deferred.preview.label_one":
      return "item";
    case "deferred.preview.label_other":
      return "items";
    case "deferred.preview.header":
      return `Preview (${params?.count} ${params?.label})`;
    case "deferred.kind.photo":
      return "photo";
    case "deferred.kind.document":
      return "document";
    case "deferred.kind.audio":
      return "audio";
    case "deferred.kind.video":
      return "video";
    case "deferred.kind.text":
      return "text";
    case "deferred.forwarded.from_display":
      return `forwarded from ${String(params?.displayName ?? "")}`;
    case "deferred.forwarded.from_another_user":
      return "forwarded from another user";
    case "deferred.forwarded.generic":
      return "forwarded";
    default:
      return key;
  }
};

describe("media/prompt-composer", () => {
  it("does not prepend additional-context header when exactly one nested context block exists", () => {
    const result = composeDeferredMediaPrompt(
      [
        {
          correlationId: "1",
          kind: "text",
          directText: "follow-up text",
        },
      ],
      t,
    );

    expect(result.directText).toBe("follow-up text");
    expect(result.contextText).toBeUndefined();
  });

  it("prepends additional-context header only when multiple nested context blocks exist", () => {
    const result = composeDeferredMediaPrompt(
      [
        {
          correlationId: "1",
          kind: "text",
          directText: "latest request",
        },
        {
          correlationId: "2",
          kind: "photo",
          contextText: "first nested context",
        },
        {
          correlationId: "3",
          kind: "document",
          contextText: "second nested context",
        },
      ],
      t,
    );

    expect(result.contextText).toContain("Additional context for the user's previous request:");
    expect(result.contextText).toContain("first nested context");
    expect(result.contextText).toContain("second nested context");
  });
});
