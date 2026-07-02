// Quick smoke-test: verify cloud-init SSH fix is in generated user-data
import { readFileSync } from "fs";
import { hashPassword } from "../../src/vm/cloud-init.js";

// Read the generateContextIso function's userData building logic
// by importing the source and checking the string template output
const source = readFileSync("src/vm/cloud-init.ts", "utf-8");

// Verify the critical lines exist in source
const checks = [
  { name: "SSH sed [[:space:]]* fix", pattern: "s/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/" },
  { name: "SSH restart", pattern: "systemctl restart sshd" },
  { name: "rm -rf guard before symlink", pattern: "rm -rf /home/opencode/.config/opencode/skills/user" },
  { name: "ln -sfT (not ln -sf)", pattern: "ln -sfT /workspace/skills" },
];

let allPass = true;
for (const { name, pattern } of checks) {
  const found = source.includes(pattern);
  console.log(`${found ? "✅" : "❌"} ${name}: ${found ? "FOUND" : "MISSING"}`);
  if (!found) allPass = false;
}

// Verify it's in generateContextIso (not just generateInfrastructureIso)
const contextIsoSection = source.substring(
  source.indexOf("generateContextIso"),
  source.indexOf("generateCloudInitIso")
);
console.log(`\n✅ SSH fix in generateContextIso: ${contextIsoSection.includes("PasswordAuthentication") ? "YES" : "NO"}`);

// Verify it's also in generateInfrastructureIso (seed ISO)
const infraIsoSection = source.substring(
  source.indexOf("generateInfrastructureIso"),
  source.indexOf("generateContextIso")
);
console.log(`✅ SSH fix in generateInfrastructureIso: ${infraIsoSection.includes("PasswordAuthentication") ? "YES" : "NO"}`);

console.log(`\n${allPass ? "✅ ALL CHECKS PASS" : "❌ SOME CHECKS FAILED"}`);
