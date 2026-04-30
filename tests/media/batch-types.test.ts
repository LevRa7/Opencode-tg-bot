import { describe, expect, it } from "vitest";
import { formatMetadataLine } from "../../src/media/batch-types.js";

describe("media/batch-types", () => {
  it("includes sender name followed by timestamp tag", () => {
    const line = formatMetadataLine(
      {
        senderFirstName: "Лев",
        timestamp: Date.UTC(2026, 3, 30, 1, 36, 0) / 1000,
      },
      "",
    );

    expect(line).toContain('[name="Лев"]');
    expect(line).toContain('datetime="2026-04-30 01:36:00 UTC"');
  });
});
