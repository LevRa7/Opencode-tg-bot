#!/usr/bin/env node
/**
 * Update all VMs to current golden image fixes.
 * Usage: npx tsx scripts/update-all.ts [--dry-run]
 */

import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateAllOptions {
  dryRun: boolean;
}

export interface UpdateAllVmResult {
  userId: number;
  success: boolean;
  method: string;
  error?: string;
}

export interface UpdateAllResult {
  total: number;
  successes: number;
  failures: number;
  dryRun: boolean;
  results: UpdateAllVmResult[];
}

// ---------------------------------------------------------------------------
// Core logic (exported for testing)
// ---------------------------------------------------------------------------

export async function runUpdateAll(
  options: UpdateAllOptions = { dryRun: false },
): Promise<UpdateAllResult> {
  const results: UpdateAllVmResult[] = [];

  // List VMs matching opencode-tg prefix
  let vmListOutput: string;
  try {
    vmListOutput = execSync(
      "virsh list --all --name | grep opencode-tg",
      { encoding: "utf-8" },
    ) as string;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }

  // Parse userId from each line: "opencode-tg-{userId}"
  const userIds: number[] = [];
  for (const line of vmListOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^opencode-tg-(\d+)$/);
    if (!match) continue;

    const userId = parseInt(match[1], 10);
    // parseInt returns NaN for empty capture, but regex ensures digits only
    if (isNaN(userId)) continue;

    userIds.push(userId);
  }

  // Process each VM sequentially
  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];

    if (options.dryRun) {
      console.log(`[DRY RUN] Would update VM opencode-tg-${userId}`);
      results.push({
        userId,
        success: true,
        method: "skipped (dry-run)",
      });
      continue;
    }

    process.stdout.write(`Updating VM opencode-tg-${userId}... `);

    try {
      // Dynamic import so the dep is only loaded when not in dry-run mode
      const { vmManager } = await import("../src/vm/manager.js");
      const updateResult = await vmManager.updateVm(userId);

      if (updateResult.success) {
        console.log(`✅ ${updateResult.method}`);
        results.push({
          userId,
          success: true,
          method: updateResult.method,
        });
      } else {
        console.log(`❌ ${updateResult.error ?? "unknown error"}`);
        results.push({
          userId,
          success: false,
          method: updateResult.method,
          error: updateResult.error,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`❌ ${message}`);
      results.push({
        userId,
        success: false,
        method: "error",
        error: message,
      });
    }
  }

  const successes = results.filter((r) => r.success).length;
  const failures = results.filter((r) => !r.success).length;

  return {
    total: userIds.length,
    successes,
    failures,
    dryRun: options.dryRun,
    results,
  };
}

// ---------------------------------------------------------------------------
// Summary table printer
// ---------------------------------------------------------------------------

function printSummary(result: UpdateAllResult): void {
  console.log();
  console.log("═══════════════════════════════════════════");
  console.log("              UPDATE SUMMARY               ");
  console.log("═══════════════════════════════════════════");
  console.log(`  Total VMs:     ${result.total}`);
  console.log(`  Successful:    ${result.successes}`);
  console.log(`  Failed:        ${result.failures}`);
  console.log(`  Dry run:       ${result.dryRun ? "YES" : "NO"}`);
  console.log("───────────────────────────────────────────");

  if (result.results.length > 0) {
    console.log();
    console.log("  Details:");
    for (const r of result.results) {
      const status = r.success ? "✅" : "❌";
      const errorDetail = r.error ? ` — ${r.error}` : "";
      console.log(
        `    ${status} opencode-tg-${r.userId}  method=${r.method}${errorDetail}`,
      );
    }
  }
  console.log("═══════════════════════════════════════════");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  if (dryRun) {
    console.log("🔍 DRY RUN MODE — no changes will be made\n");
  }

  try {
    const result = await runUpdateAll({ dryRun });
    printSummary(result);
    process.exit(result.failures > 0 ? 1 : 0);
  } catch (err) {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

// Only call main() when this file is executed directly, not when imported
const isDirect = process.argv[1] && (
  process.argv[1].endsWith("update-all.ts") ||
  process.argv[1].endsWith("update-all.js")
);

if (isDirect) {
  main();
}
