#!/usr/bin/env node
/**
 * OpenCode Memory MCP Server — stdio transport (TypeScript).
 *
 * Hermes-compatible §-delimited format, same char limits, same tool responses.
 *
 * Tools:
 *   memory_add(target, content?, operations?) — append or batch
 *   memory_search(query)                     — full-text search
 *   memory_remove(target, old_text)          — remove by substring
 *   memory_show(target?)                     — show entries + usage
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  memoryAdd,
  memorySearch,
  memoryRemove,
  memoryShow,
} from "./memory_store.js";

const server = new Server(
  { name: "opencode-memory-ts", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_add",
      description:
        "Save a fact to persistent memory or apply batch operations. " +
        "Args: target='memory'|'user', content: declarative fact, " +
        "operations: [{action:'add'|'replace'|'remove', content?, old_text?}]. " +
        "Limits: memory=2200, user=1375 chars.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["memory", "user"] },
          content: { type: "string", default: "" },
          operations: { type: "array" },
        },
        required: ["target"],
      },
    },
    {
      name: "memory_search",
      description: "Full-text search across all memory files (case-insensitive substring).",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "memory_remove",
      description: "Remove a memory entry by unique substring match.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["memory", "user"] },
          old_text: { type: "string" },
        },
        required: ["target", "old_text"],
      },
    },
    {
      name: "memory_show",
      description: "Show current memory entries with usage statistics.",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string", default: "" } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = args as Record<string, unknown>;

  switch (name) {
    case "memory_add": {
      const ops = Array.isArray(a.operations) ? a.operations as any[] : undefined;
      const result = memoryAdd(
        a.target as "memory" | "user",
        (a.content as string) || "",
        ops,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    case "memory_search": {
      const result = memorySearch((a.query as string) || "");
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    case "memory_remove": {
      const result = memoryRemove(
        a.target as "memory" | "user",
        (a.old_text as string) || "",
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    case "memory_show": {
      const target = (a.target as string) || "";
      const result = memoryShow(target as "memory" | "user" | "");
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    default:
      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
