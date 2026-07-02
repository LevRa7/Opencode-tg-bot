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

function skillDelete(name: string, absorbedInto?: string): string {
  if (!name?.trim()) return JSON.stringify({ error: "Skill name is required." });
  name = name.trim();
  const skillsDir = getSkillsDir();

  const dirPath = path.join(skillsDir, name);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    try {
      fs.rmSync(dirPath, { recursive: true });
      const note = absorbedInto !== undefined
        ? `Skill '${name}' removed${absorbedInto ? ` — content absorbed into '${absorbedInto}'` : " (pruned, no forwarding target)"}.`
        : `Skill '${name}' removed.`;
      return JSON.stringify({ success: true, name, deleted: "directory", absorbed_into: absorbedInto ?? null, note });
    } catch (e) {
      return JSON.stringify({ error: `Failed to delete skill directory: ${e}` });
    }
  }

  const flatPath = path.join(skillsDir, `${name}.md`);
  if (fs.existsSync(flatPath)) {
    try {
      fs.unlinkSync(flatPath);
      const note = absorbedInto !== undefined
        ? `Skill '${name}' removed${absorbedInto ? ` — content absorbed into '${absorbedInto}'` : " (pruned, no forwarding target)"}.`
        : `Skill '${name}' removed.`;
      return JSON.stringify({ success: true, name, deleted: "file", absorbed_into: absorbedInto ?? null, note });
    } catch (e) {
      return JSON.stringify({ error: `Failed to delete skill file: ${e}` });
    }
  }

  return JSON.stringify({ error: `Skill '${name}' not found.` });
}

// ── Supporting file operations ───────────────────────────────

function writeFile(name: string, filePath: string, fileContent: string): string {
  if (!name?.trim()) return JSON.stringify({ error: "Skill name is required." });
  name = name.trim();
  if (!filePath?.trim()) return JSON.stringify({ error: "file_path is required. Must be under references/, templates/, scripts/, or assets/." });
  filePath = filePath.trim();
  if (fileContent === undefined || fileContent === null) return JSON.stringify({ error: "file_content is required." });
  if (!/^(references|templates|scripts|assets)\//.test(filePath)) {
    return JSON.stringify({ error: `file_path must start with references/, templates/, scripts/, or assets/. Got: '${filePath}'` });
  }

  const skillsDir = getSkillsDir();
  const skillDir = path.join(skillsDir, name);
  if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) {
    return JSON.stringify({ error: `Skill '${name}' does not exist. Use skill_create first.` });
  }

  const targetPath = path.join(skillDir, filePath);
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, fileContent, "utf-8");
    return JSON.stringify({ success: true, name, path: targetPath, note: `File '${filePath}' written under skill '${name}'.` });
  } catch (e) {
    return JSON.stringify({ error: `Failed to write file: ${e}` });
  }
}

function removeFile(name: string, filePath: string): string {
  if (!name?.trim()) return JSON.stringify({ error: "Skill name is required." });
  name = name.trim();
  if (!filePath?.trim()) return JSON.stringify({ error: "file_path is required." });
  filePath = filePath.trim();

  const skillsDir = getSkillsDir();
  const targetPath = path.join(skillsDir, name, filePath);
  if (!fs.existsSync(targetPath)) {
    return JSON.stringify({ error: `File '${filePath}' not found under skill '${name}'.` });
  }
  try {
    fs.unlinkSync(targetPath);
    return JSON.stringify({ success: true, name, path: targetPath, note: `File '${filePath}' removed from skill '${name}'.` });
  } catch (e) {
    return JSON.stringify({ error: `Failed to remove file: ${e}` });
  }
}

// ── Unified skill_manage dispatcher (Hermes-symmetric) ────────

function skillManage(action: string, skillName: string, params: Record<string, unknown>): string {
  if (!action || !skillName?.trim()) {
    return JSON.stringify({ success: false, error: "action and name are required." });
  }
  skillName = skillName.trim();

  switch (action) {
    case "create": {
      const content = (params.content as string) || "";
      const category = (params.category as string) || undefined;
      if (!content) return JSON.stringify({ success: false, error: "content is required for 'create'. Provide the full SKILL.md text (frontmatter + body)." });
      // skillCreate validates frontmatter, content size, name collisions
      const result = JSON.parse(skillCreate(skillName, content));
      if (result.success && category) {
        result.category = category;
      }
      return JSON.stringify(result);
    }
    case "patch": {
      const oldString = (params.old_string as string) || "";
      const newString = params.new_string !== undefined ? (params.new_string as string) : "";
      const filePath = (params.file_path as string) || undefined;
      const replaceAll = params.replace_all as boolean || false;
      if (!oldString) return JSON.stringify({ success: false, error: "old_string is required for 'patch'. Provide the text to find." });
      if (filePath) {
        return writeFilePatch(skillName, filePath, oldString, newString, replaceAll);
      }
      if (replaceAll) {
        return skillPatchAll(skillName, oldString, newString);
      }
      return skillPatch(skillName, oldString, newString);
    }
    case "edit": {
      const content = (params.content as string) || "";
      if (!content) return JSON.stringify({ success: false, error: "content is required for 'edit'. Provide the full updated SKILL.md text." });
      return skillEdit(skillName, content);
    }
    case "delete": {
      const absorbedInto = params.absorbed_into !== undefined ? (params.absorbed_into as string) : undefined;
      return skillDelete(skillName, absorbedInto);
    }
    case "write_file": {
      const fp = (params.file_path as string) || "";
      const fc = params.file_content !== undefined ? (params.file_content as string) : undefined;
      if (!fp) return JSON.stringify({ success: false, error: "file_path is required for 'write_file'. Example: 'references/api-guide.md'" });
      if (fc === undefined) return JSON.stringify({ success: false, error: "file_content is required for 'write_file'." });
      return writeFile(skillName, fp, fc);
    }
    case "remove_file": {
      const fp = (params.file_path as string) || "";
      if (!fp) return JSON.stringify({ success: false, error: "file_path is required for 'remove_file'." });
      return removeFile(skillName, fp);
    }
    default:
      return JSON.stringify({ success: false, error: `Unknown action '${action}'. Use: create, edit, patch, delete, write_file, remove_file` });
  }
}

// ── Replace-all patch helper ─────────────────────────────────

function skillPatchAll(name: string, oldString: string, newString: string): string {
  const skillsDir = getSkillsDir();
  const skillMd = path.join(skillsDir, name, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    const flatPath = path.join(skillsDir, `${name}.md`);
    if (fs.existsSync(flatPath)) {
      return applyPatchAll(flatPath, oldString, newString, name);
    }
    return JSON.stringify({ error: `Skill '${name}' not found.` });
  }
  return applyPatchAll(skillMd, oldString, newString, name);
}

function applyPatchAll(filePath: string, oldString: string, newString: string, name: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const count = content.split(oldString).length - 1;
    if (count === 0) return JSON.stringify({ error: "old_string not found in skill file." });
    const updated = content.split(oldString).join(newString ?? "");
    fs.writeFileSync(filePath, updated, "utf-8");
    return JSON.stringify({ success: true, name, path: filePath, replacements: count, note: `Replaced ${count} occurrence(s).` });
  } catch (e) {
    return JSON.stringify({ error: `Failed to patch skill: ${e}` });
  }
}

// ── Patch supporting file ────────────────────────────────────

function writeFilePatch(name: string, filePath: string, oldString: string, newString: string, replaceAll: boolean): string {
  const skillsDir = getSkillsDir();
  const targetPath = path.join(skillsDir, name, filePath);
  if (!fs.existsSync(targetPath)) {
    return JSON.stringify({ error: `File '${filePath}' not found under skill '${name}'.` });
  }
  try {
    const content = fs.readFileSync(targetPath, "utf-8");
    const count = content.split(oldString).length - 1;
    if (count === 0) return JSON.stringify({ error: `old_string not found in ${filePath}.` });
    if (!replaceAll && count > 1) {
      return JSON.stringify({ error: `old_string appears ${count} times in ${filePath} — must be unique. Set replace_all=true to replace all.` });
    }
    const updated = replaceAll ? content.split(oldString).join(newString ?? "") : content.replace(oldString, newString ?? "");
    fs.writeFileSync(targetPath, updated, "utf-8");
    return JSON.stringify({ success: true, name, path: targetPath, replacements: replaceAll ? count : 1, note: `Patched ${filePath}.` });
  } catch (e) {
    return JSON.stringify({ error: `Failed to patch ${filePath}: ${e}` });
  }
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
      name: "skill_manage",
      description:
        "Manage skills (create, update, delete). Skills are your procedural memory — reusable approaches for recurring task types. New skills go to /workspace/skills/.\\n\\n" +
        "Actions: create (full SKILL.md + optional category), patch (old_string/new_string — preferred for fixes), edit (full SKILL.md rewrite — major overhauls only), delete, write_file, remove_file.\\n\\n" +
        "On delete, pass `absorbed_into=<umbrella>` when merging this skill's content into another one, or `absorbed_into=\"\"` when pruning it with no forwarding target.\\n\\n" +
        "Create when: complex task succeeded (5+ calls), errors overcome, user-corrected approach worked, non-trivial workflow discovered, or user asks you to remember a procedure.\\n" +
        "Update when: instructions stale/wrong, OS-specific failures, missing steps or pitfalls found during use. If you used a skill and hit issues not covered by it, patch it immediately.\\n\\n" +
        "After difficult/iterative tasks, offer to save as a skill. Skip for simple one-offs. Confirm with user before creating/deleting.\\n\\n" +
        "Good skills: trigger conditions, numbered steps with exact commands, pitfalls section, verification steps. Use skill_view() to see format examples.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "patch", "edit", "delete", "write_file", "remove_file"],
            description: "The action to perform."
          },
          name: {
            type: "string",
            description: "Skill name (lowercase, hyphens/underscores, max 64 chars). Must match an existing skill for patch/edit/delete/write_file/remove_file."
          },
          content: {
            type: "string",
            description: "Full SKILL.md content (YAML frontmatter + markdown body). Required for 'create' and 'edit'. For 'edit', read the skill first with skill_view() and provide the complete updated text."
          },
          old_string: {
            type: "string",
            description: "Text to find in the file (required for 'patch'). Must be unique unless replace_all=true. Include enough surrounding context to ensure uniqueness."
          },
          new_string: {
            type: "string",
            description: "Replacement text (required for 'patch'). Can be empty string to delete the matched text."
          },
          replace_all: {
            type: "boolean",
            description: "For 'patch': replace all occurrences instead of requiring a unique match (default: false)."
          },
          category: {
            type: "string",
            description: "Optional category/domain for organizing the skill (e.g., 'devops', 'data-science', 'mlops'). Only used with 'create'."
          },
          file_path: {
            type: "string",
            description: "Path to a supporting file within the skill directory. For 'write_file'/'remove_file': required, must be under references/, templates/, scripts/, or assets/. For 'patch': optional, defaults to SKILL.md if omitted."
          },
          file_content: {
            type: "string",
            description: "Content for the file. Required for 'write_file'."
          },
          absorbed_into: {
            type: "string",
            description: "For 'delete' only — declares intent. Pass the umbrella skill name when this skill's content was merged into another (the target must already exist). Pass an empty string when the skill is truly stale and being pruned with no forwarding target."
          },
        },
        required: ["action", "name"],
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
    case "skill_manage":
      return { content: [{ type: "text", text: skillManage((a.action as string) || "", (a.name as string) || "", a) }] };
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
export { skillsList, skillView, skillManage, skillCreate, skillPatch, skillEdit, skillDelete, parseMetadata, getSkillsDir, validateFrontmatter };
