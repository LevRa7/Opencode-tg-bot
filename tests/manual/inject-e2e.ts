/**
 * End-to-end test: injectVmContext with real VM
 * Runs injectVmContext() for a real VM user and prints the result.
 * Usage: npx tsx tests/manual/inject-e2e.ts <userId>
 */
import { injectVmContext } from "../../src/memory/vm-inject.js";

const userId = parseInt(process.argv[2], 10);
if (!userId || isNaN(userId)) {
  console.error("Usage: npx tsx tests/manual/inject-e2e.ts <userId>");
  process.exit(1);
}

console.log(`Testing injectVmContext for user ${userId}...`);

const result = await injectVmContext(userId, "TEST MESSAGE: hello from e2e test");

console.log("=== RESULT ===");
console.log(result === "TEST MESSAGE: hello from e2e test"
  ? "❌ No memory injected (unchanged)"
  : "✅ Memory injected!");
console.log(result);
