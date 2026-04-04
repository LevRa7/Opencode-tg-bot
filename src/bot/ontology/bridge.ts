import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { OntologyProjectionPayload } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_ONTOLOGY_QUERY = "Ontology snapshot";
const DEFAULT_ONTOLOGY_CLI = "opencode-tg-cli";
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface StructuredOutputEnvelope<T> {
  ok?: boolean;
  schema_version?: string;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

function resolveOntologyCliBinary(): string {
  return process.env.OPENCODE_TG_CLI_BIN?.trim() || DEFAULT_ONTOLOGY_CLI;
}

function parseProjectionEnvelope(stdout: string): OntologyProjectionPayload {
  const parsed = JSON.parse(stdout) as StructuredOutputEnvelope<OntologyProjectionPayload>;
  if (!parsed || parsed.ok !== true || !parsed.data) {
    const errorMessage = parsed?.error?.message || "Unexpected ontology projection payload";
    throw new Error(errorMessage);
  }

  return parsed.data;
}

function formatProjectionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function loadOntologyProjection(
  chatId: number,
  question: string = DEFAULT_ONTOLOGY_QUERY,
): Promise<OntologyProjectionPayload> {
  const cliBin = resolveOntologyCliBinary();

  try {
    const { stdout } = await execFileAsync(
      cliBin,
      ["projection", String(chatId), question, "--json"],
      {
        env: process.env,
        maxBuffer: MAX_BUFFER_BYTES,
      },
    );

    return parseProjectionEnvelope(stdout.trim());
  } catch (error) {
    throw new Error(`Failed to load ontology projection via ${cliBin}: ${formatProjectionError(error)}`);
  }
}
