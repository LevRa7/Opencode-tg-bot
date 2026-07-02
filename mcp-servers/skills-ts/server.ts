#!/usr/bin/env node
/**
 * OpenCode Skills MCP Server — stdio transport (TypeScript).
 *
 * Scans /workspace/skills/ for SKILL.md files and surfaces metadata.
 * Full symmetry with Hermes skill_manage: create, patch, edit, delete.
 *
 * Tools:
 *   skills_list()              — list all available skills with descriptions
 *   skill_view(name)           — read full SKILL.md content
 *   skill_create(name, body)   — create a new skill (validates frontmatter)
 *   skill_patch(name, old_string, new_string) — targeted edit
 *   skill_edit(name, body)     — full rewrite of SKILL.md
 *   skill_delete(name)         — remove a skill directory/file
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Helpers ─────────────────────────────────────────────────

function getSkillsDir(): string {
  return process.env.SKILLS_DIR || "/workspace/skills";
}

interface SkillEntry {
  name: string;
  title: string;
  description: string;
  path: string;
  type: "directory" | "flat";
}

function parseMetadata(content: string): { name: string; description: string } {
  let name = "";
  let description = "";
  const lines = content.split("\n").slice(0, 40);
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith("# ") && !name) {
      name = stripped.slice(2).trim();
    } else if (
      stripped.startsWith("**When to use:**") ||
      stripped.startsWith("**Description:**") ||
      stripped.startsWith("**Описание:**")
    ) {
      const parts = stripped.split(":**", 2);
      if (parts.length > 1) description = parts[1].trim();
    }
  }
  return { name, description };
}

/** Parse YAML frontmatter. Returns null if invalid. */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---\n", 3);
  if (end === -1) return null;
  const fmText = content.slice(3, end);
  try {
    // Manual YAML parsing for name/description only (avoid yaml dep)
    const fm: Record<string, unknown> = {};
    const lines = fmText.split("\n");
    let currentKey = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0 && !trimmed.startsWith(" ")) {
        currentKey = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        fm[currentKey] = value;
      }
    }
    return fm;
  } catch {
    return null;
  }
}

/** Validate skill frontmatter: name ≤64, description ≤1024, starts with ---. */
function validateFrontmatter(body: string, name: string): string | null {
  if (!body.startsWith("---")) {
    return "Frontmatter must start with --- at byte 0.";
  }
  const fm = parseFrontmatter(body);
  if (!fm) return "Invalid YAML frontmatter.";
  if (!fm.name || String(fm.name).trim() === "") {
    return "Frontmatter must contain 'name' field.";
  }
  const fmName = String(fm.name).trim();
  if (fmName.length > 64) return `Skill name is too long (${fmName.length} > 64 chars).`;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(fmName)) {
    return "Skill name must be lowercase, hyphens, alphanumeric, ≤64 chars.";
  }
  if (fmName !== name) {
    return `Frontmatter name '${fmName}' does not match directory name '${name}'.`;
  }
  if (!fm.description || String(fm.description).trim() === "") {
    return "Frontmatter must contain 'description' field.";
  }
  const desc = String(fm.description).trim();
  if (desc.length > 1024) return `Description is too long (${desc.length} > 1024 chars).`;
  if (!desc.toLowerCase().startsWith("use when")) {
    return "Description should start with 'Use when ...' for Hermes compatibility.";
  }
  const bodyAfterFm = body.slice(body.indexOf("\n---\n", 3) + 5).trim();
  if (!bodyAfterFm) return "Body after frontmatter must not be empty.";
  return null;
}

function skillsList(): string {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) {
    return JSON.stringify({
      skills: [],
      count: 0,
      path: skillsDir,
      note: "Skills directory does not exist. Create skills in /workspace/skills/",
    });
  }

  const skills: SkillEntry[] = [];
  const items = fs.readdirSync(skillsDir, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  );

  // Directory skills: <name>/SKILL.md
  for (const item of items) {
    if (item.isDirectory()) {
      const skillMd = path.join(skillsDir, item.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        try {
          const content = fs.readFileSync(skillMd, "utf-8");
          const meta = parseMetadata(content);
          skills.push({
            name: item.name,
            title: meta.name || item.name,
            description: meta.description,
            path: skillMd,
            type: "directory",
          });
        } catch { /* skip unreadable */ }
      }
    }
  }

  // Flat file skills: <name>.md
  for (const item of items) {
    if (item.isFile() && item.name.endsWith(".md")) {
      if (item.name === "README.md" || item.name === "SKILL.md") continue;
      try {
        const content = fs.readFileSync(path.join(skillsDir, item.name), "utf-8");
        const meta = parseMetadata(content);
        skills.push({
          name: item.name.replace(/\.md$/, ""),
          title: meta.name || item.name.replace(/\.md$/, ""),
          description: meta.description,
          path: path.join(skillsDir, item.name),
          type: "flat",
        });
      } catch { /* skip */ }
    }
  }

  return JSON.stringify({ skills, count: skills.length, path: skillsDir });
}

function skillView(name: string): string {
  if (!name?.trim()) {
    return JSON.stringify({ error: "Skill name is required." });
  }
  name = name.trim();
  const skillsDir = getSkillsDir();

  // Try directory skill
  const dirPath = path.join(skillsDir, name, "SKILL.md");
  if (fs.existsSync(dirPath)) {
    try {
      return fs.readFileSync(dirPath, "utf-8");
    } catch (e) {
      return JSON.stringify({ error: `Failed to read ${dirPath}: ${e}` });
    }
  }

  // Try flat file
  const filePath = path.join(skillsDir, `${name}.md`);
  if (fs.existsSync(filePath)) {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      return JSON.stringify({ error: `Failed to read ${filePath}: ${e}` });
    }
  }

  return JSON.stringify({
    error: `Skill '${name}' not found.`,
    searched: [dirPath, filePath],
    hint: "Use skills_list() to see available skills.",
  });
}

function skillCreate(name: string, body: string): string {
  if (!name?.trim()) return JSON.stringify({ error: "Skill name is required." });
  name = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!name) return JSON.stringify({ error: "Skill name became empty after sanitization." });
  if (name.length > 64) return JSON.stringify({ error: `Skill name too long (${name.length} > 64 chars).` });

  if (!body?.trim()) return JSON.stringify({ error: "Body is required." });

  const validationError = validateFrontmatter(body, name);
  if (validationError) {
    return JSON.stringify({ error: `Validation failed: ${validationError}` });
  }

  const skillsDir = getSkillsDir();
  const skillDir = path.join(skillsDir, name);
  const skillMd = path.join(skillDir, "SKILL.md");

  if (fs.existsSync(skillMd)) {
    return JSON.stringify({ error: `Skill '${name}' already exists. Use skill_edit or skill_patch to update.` });
  }

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillMd, body, "utf-8");
    return JSON.stringify({
      success: true,
      name,
      path: skillMd,
      note: `Skill '${name}' created. Use skills_list() to verify.`,
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to create skill: ${e}` });
  }
}

function skillPatch(name: string, oldString: string, newString: string): string {
  if (!name?.trim()) return JSON.stringify({ error: "Skill name is required." });
  name = name.trim();
  const skillsDir = getSkillsDir();
  const skillMd = path.join(skillsDir, name, "SKILL.md");

  if (!fs.existsSync(skillMd)) {
    // Try flat file
    const flatPath = path.join(skillsDir, `${name}.md`);
    if (fs.existsSync(flatPath)) {
      return applyPatch(flatPath, oldString, newString, name);
    }
    return JSON.stringify({ error: `Skill '${name}' not found.` });
  }

  return applyPatch(skillMd, oldString, newString, name);
}

function applyPatch(filePath: string, oldString: string, newString: string, name: string): string {
  if (!oldString) return JSON.stringify({ error: "old_string is required for patch." });

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const count = content.split(oldString).length - 1;

    if (count === 0) {
      return JSON.stringify({ error: "old_string not found in skill file." });
    }
    if (count > 1) {
      return JSON.stringify({
        error: `old_string appears ${count} times — must be unique. Provide more context.`,
      });
    }

    const updated = content.replace(oldString, newString ?? "");
    fs.writeFileSync(filePath, updated, "utf-8");
    return JSON.stringify({
      success: true,
      name,
      path: filePath,
      note: "Skill patched. Use skill_view() to verify.",
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to patch skill: ${e}` });
  }
}

function skillEdit(name: string, body: string): string {
  if (!name?.trim()) return JSON.stringify({ error: "Skill name is required." });
  name = name.trim();
  if (!body?.trim()) return JSON.stringify({ error: "Body is required." });

  const skillsDir = getSkillsDir();
  const skillMd = path.join(skillsDir, name, "SKILL.md");
  let filePath = skillMd;

  if (!fs.existsSync(skillMd)) {
    const flatPath = path.join(skillsDir, `${name}.md`);
    if (fs.existsSync(flatPath)) {
      filePath = flatPath;
    } else {
      return JSON.stringify({ error: `Skill '${name}' not found. Use skill_create to create.` });
    }
  }

  const validationError = validateFrontmatter(body, name);
  if (validationError) {
    return JSON.stringify({ error: `Validation failed: ${validationError}` });
  }

  try {
    fs.writeFileSync(filePath, body, "utf-8");
    return JSON.stringify({
      success: true,
      name,
      path: filePath,
      note: "Skill updated. Use skill_view() to verify.",
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to edit skill: ${e}` });
  }
}

function skillDelete(name: string): string {
  if (!name?.trim()) return JSON.stringify({ error: "Skill name is required." });
  name = name.trim();
  const skillsDir = getSkillsDir();

  const dirPath = path.join(skillsDir, name);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    try {
      fs.rmSync(dirPath, { recursive: true });
      return JSON.stringify({ success: true, name, deleted: "directory", note: `Skill '${name}' removed.` });
    } catch (e) {
      return JSON.stringify({ error: `Failed to delete skill directory: ${e}` });
    }
  }

  const flatPath = path.join(skillsDir, `${name}.md`);
  if (fs.existsSync(flatPath)) {
    try {
      fs.unlinkSync(flatPath);
      return JSON.stringify({ success: true, name, deleted: "file", note: `Skill '${name}' removed.` });
    } catch (e) {
      return JSON.stringify({ error: `Failed to delete skill file: ${e}` });
    }
  }

  return JSON.stringify({ error: `Skill '${name}' not found.` });
}

// ── MCP Server ──────────────────────────────────────────────

const server = new Server(
  { name: "opencode-skills-ts", version: "1.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "skills_list",
      description: "List all available skills in the skills directory.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "skill_view",
      description: "Read full content of a skill's SKILL.md file. Args: name.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    {
      name: "skill_create",
      description: "Create a new skill. Args: name (lowercase, hyphens, ≤64), body (full SKILL.md with YAML frontmatter: name, description ≤1024). Validates frontmatter.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          body: { type: "string" },
        },
        required: ["name", "body"],
      },
    },
    {
      name: "skill_patch",
      description: "Targeted find-and-replace edit in SKILL.md. Args: name, old_string (unique), new_string.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["name", "old_string", "new_string"],
      },
    },
    {
      name: "skill_edit",
      description: "Full rewrite of a skill's SKILL.md. Args: name, body. Validates frontmatter.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          body: { type: "string" },
        },
        required: ["name", "body"],
      },
    },
    {
      name: "skill_delete",
      description: "Delete a skill. Args: name. Removes the directory or file.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = args as Record<string, unknown>;

  switch (name) {
    case "skills_list":
      return { content: [{ type: "text", text: skillsList() }] };
    case "skill_view":
      return { content: [{ type: "text", text: skillView((a.name as string) || "") }] };
    case "skill_create":
      return { content: [{ type: "text", text: skillCreate((a.name as string) || "", (a.body as string) || "") }] };
    case "skill_patch":
      return { content: [{ type: "text", text: skillPatch((a.name as string) || "", (a.old_string as string) || "", (a.new_string as string) ?? "") }] };
    case "skill_edit":
      return { content: [{ type: "text", text: skillEdit((a.name as string) || "", (a.body as string) || "") }] };
    case "skill_delete":
      return { content: [{ type: "text", text: skillDelete((a.name as string) || "") }] };
    default:
      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

// Export for testing
export { skillsList, skillView, skillCreate, skillPatch, skillEdit, skillDelete, parseMetadata, getSkillsDir, validateFrontmatter };
