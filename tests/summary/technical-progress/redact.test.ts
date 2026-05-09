import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../src/summary/technical-progress/redact.js";

describe("redactSecrets", () => {
  it("redacts common tokens, credentials, and URL passwords", () => {
    const text = "TOKEN=abc123456789 password=hunter2 https://user:secret@example.com x-api-key: sk-abcdef123456";

    expect(redactSecrets(text)).toBe("TOKEN=[REDACTED] password=[REDACTED] https://user:[REDACTED]@example.com x-api-key: [REDACTED]");
  });

  it("redacts full authorization header credentials", () => {
    expect(redactSecrets("Authorization: Bearer abc.def")).toBe("Authorization: [REDACTED]");
  });

  it("redacts secret CLI flags and structured key values", () => {
    const text = "--token value --api-key=value {\"token\": \"json-secret\"}\ntoken: yaml-secret";

    expect(redactSecrets(text)).toBe("--token [REDACTED] --api-key=[REDACTED] {\"token\": \"[REDACTED]\"}\ntoken: [REDACTED]");
  });

  it("redacts unquoted YAML and header style secrets", () => {
    const examples = [
      ["password: hunter2", "hunter2"],
      ["secret: abc123", "abc123"],
      ["api_key: xyz", "xyz"],
      ["access_key: keyvalue", "keyvalue"],
    ] as const;

    for (const [text, secret] of examples) {
      const redacted = redactSecrets(text);

      expect(redacted).toContain("[REDACTED]");
      expect(redacted).not.toContain(secret);
    }
  });

  it("redacts private key blocks, cookies, and standalone token formats", () => {
    const text = [
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----",
      "Cookie: sid=session-secret; theme=dark",
      "Set-Cookie: refresh=refresh-secret; HttpOnly",
      "token ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "openai sk-abcdefghijklmnopqrstuvwxyz12345678901234567890",
    ].join("\n");

    const redacted = redactSecrets(text);

    expect(redacted).toContain("[REDACTED PRIVATE KEY]");
    expect(redacted).toContain("Cookie: [REDACTED]");
    expect(redacted).toContain("Set-Cookie: [REDACTED]");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("session-secret");
    expect(redacted).not.toContain("refresh-secret");
    expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(redacted).not.toContain("sk-abcdefghijklmnopqrstuvwxyz12345678901234567890");
  });
});
