import { describe, expect, it, vi, beforeEach } from "vitest";

describe("MEMORY.md", () => {
  const MEMORY_FILENAME = "MEMORY.md";
  const projectDir = "/root/Opencode-tg-bot";

  describe("readMemory", () => {
    it("reads MEMORY.md from project root", async () => {
      const readFile = vi.fn().mockResolvedValue("# Project Memory\nKey: value");
      const existsSync = vi.fn().mockReturnValue(true);

      const readMemory = async (dir: string): Promise<string> => {
        const path = `${dir}/${MEMORY_FILENAME}`;
        if (!existsSync(path)) return "";
        return readFile(path, "utf-8");
      };

      const content = await readMemory(projectDir);
      expect(content).toBe("# Project Memory\nKey: value");
      expect(readFile).toHaveBeenCalledWith(`${projectDir}/${MEMORY_FILENAME}`, "utf-8");
    });

    it("returns empty string when MEMORY.md does not exist", async () => {
      const existsSync = vi.fn().mockReturnValue(false);
      const readFile = vi.fn();

      const readMemory = async (dir: string): Promise<string> => {
        const path = `${dir}/${MEMORY_FILENAME}`;
        if (!existsSync(path)) return "";
        return readFile(path, "utf-8");
      };

      const content = await readMemory(projectDir);
      expect(content).toBe("");
      expect(readFile).not.toHaveBeenCalled();
    });
  });

  describe("writeMemory", () => {
    it("appends a section to MEMORY.md", async () => {
      const readFile = vi.fn().mockResolvedValue("# Existing\n");
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const existsSync = vi.fn().mockReturnValue(true);

      const appendMemory = async (dir: string, section: string): Promise<void> => {
        const path = `${dir}/${MEMORY_FILENAME}`;
        const existing = existsSync(path) ? await readFile(path, "utf-8") : "";
        const timestamp = new Date().toISOString().slice(0, 10);
        const entry = `\n## ${timestamp}\n${section}\n`;
        await writeFile(path, existing + entry);
      };

      await appendMemory(projectDir, "Added new feature X");

      expect(writeFile).toHaveBeenCalledWith(
        `${projectDir}/${MEMORY_FILENAME}`,
        expect.stringContaining("Added new feature X"),
      );
    });

    it("creates MEMORY.md if it does not exist", async () => {
      const readFile = vi.fn();
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const existsSync = vi.fn().mockReturnValue(false);

      const appendMemory = async (dir: string, section: string): Promise<void> => {
        const path = `${dir}/${MEMORY_FILENAME}`;
        const existing = existsSync(path) ? await readFile(path, "utf-8") : "";
        const timestamp = new Date().toISOString().slice(0, 10);
        const entry = `# Project Memory\n\n## ${timestamp}\n${section}\n`;
        await writeFile(path, entry);
      };

      await appendMemory(projectDir, "Initial memory");

      expect(writeFile).toHaveBeenCalledWith(
        `${projectDir}/${MEMORY_FILENAME}`,
        expect.stringContaining("Initial memory"),
      );
    });
  });

  describe("memory snippet for session context", () => {
    it("returns first 2000 chars of MEMORY.md", async () => {
      const longContent = "# Memory\n" + "x".repeat(3000);
      const readFile = vi.fn().mockResolvedValue(longContent);
      const existsSync = vi.fn().mockReturnValue(true);

      const getMemorySnippet = async (dir: string): Promise<string> => {
        const path = `${dir}/${MEMORY_FILENAME}`;
        if (!existsSync(path)) return "";
        const content = await readFile(path, "utf-8");
        return content.slice(0, 2000);
      };

      const snippet = await getMemorySnippet(projectDir);
      expect(snippet.length).toBe(2000);
      expect(snippet).toContain("# Memory");
    });

    it("returns empty when no MEMORY.md exists", async () => {
      const existsSync = vi.fn().mockReturnValue(false);
      const readFile = vi.fn();

      const getMemorySnippet = async (dir: string): Promise<string> => {
        const path = `${dir}/${MEMORY_FILENAME}`;
        if (!existsSync(path)) return "";
        return readFile(path, "utf-8");
      };

      const snippet = await getMemorySnippet(projectDir);
      expect(snippet).toBe("");
      expect(readFile).not.toHaveBeenCalled();
    });
  });
});
