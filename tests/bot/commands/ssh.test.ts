import { describe, expect, it } from "vitest";
import { parseConnectionString, getSkillsToUpload } from "../../../src/bot/commands/ssh.js";

describe("bot/commands/ssh", () => {
  it("correctly parses SSH connection strings", () => {
    const result = parseConnectionString("root@192.168.1.100:2222");
    expect(result).toEqual({ username: "root", host: "192.168.1.100", port: 2222 });

    const resultDefaultPort = parseConnectionString("admin@example.com");
    expect(resultDefaultPort).toEqual({ username: "admin", host: "example.com", port: 22 });

    const invalidResult = parseConnectionString("invalid-string");
    expect(invalidResult).toBeNull();
  });

  it("returns base skills plus package skills from local docker directory", () => {
    const skills = getSkillsToUpload();
    expect(skills.length).toBeGreaterThanOrEqual(3);
    expect(skills).toContain("tg-cli");
    expect(skills).toContain("openai-media-transcriber");
    expect(skills).toContain("gpt-image-api");
    expect(skills).toContain("docker-management");
    expect(skills).toContain("web-pentest");
    expect(skills).toContain("tg-upload");
    expect(skills).toContain("screen-manager");
    expect(skills).toContain("whisper");
  });
});
