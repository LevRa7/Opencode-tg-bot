const { createOpencodeClient } = require("@opencode-ai/sdk");

const baseUrl = "http://localhost:4096";
const client = createOpencodeClient({ baseUrl });

async function test() {
  const authInfo = await client.provider.auth();
  console.log("Auth methods:", JSON.stringify(authInfo.data, null, 2));
  
  const providers = await client.provider.list();
  const all = (providers.data)?.all ?? [];
  console.log("Provider count:", all.length);
  for (const p of all) {
    console.log(" -", p.id, p.name);
  }
}
test().catch(e => console.error(e.message));
