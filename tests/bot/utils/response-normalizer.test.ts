import { describe, expect, it } from "vitest";
import { normalizeResponseSnapshotToHtml } from "../../../src/bot/utils/response-normalizer.js";

describe("bot/utils/response-normalizer", () => {
  it("normalizes markdown headings into html titles", () => {
    const result = normalizeResponseSnapshotToHtml("## Final Answer\nBody line");

    expect(result).toContain("<b>Final Answer</b>");
    expect(result).toContain("Body line");
    expect(result).not.toContain("## Final Answer");
  });

  it("renders fenced code blocks as preformatted html", () => {
    const result = normalizeResponseSnapshotToHtml("Before\n```sh\nnpm test\nnode server.js\n```\nAfter");

    expect(result).toContain("Before");
    expect(result).toContain("<pre>npm test\nnode server.js</pre>");
    expect(result).toContain("After");
  });

  it("renders standalone shell commands in monospace html", () => {
    const result = normalizeResponseSnapshotToHtml(
      "Run this:\nnpm test\ngit status\nThen continue.",
    );

    expect(result).toContain("Run this:");
    expect(result).toContain("<pre>npm test\ngit status</pre>");
    expect(result).toContain("Then continue.");
  });

  it("keeps inline code as code tags", () => {
    const result = normalizeResponseSnapshotToHtml("Use `npm test` before deploy.");

    expect(result).toContain("Use <code>npm test</code> before deploy.");
  });
});
