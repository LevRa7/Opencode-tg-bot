import { injectViaGuestfish, DEFAULT_GUESTFISH_FIXES } from "../src/vm/guestfish-inject.js";

async function main() {
  const qcow2Path = "/home/me/vm-images/opencode-tg-7408085157.qcow2";
  console.log("Testing guestfish injection on", qcow2Path);
  console.log("Commands:", DEFAULT_GUESTFISH_FIXES);
  
  const result = await injectViaGuestfish(qcow2Path, [...DEFAULT_GUESTFISH_FIXES]);
  console.log("Result:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
