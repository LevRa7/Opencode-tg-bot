import { validateInitData, isUserAuthorized } from "./auth.js";
import { SubdomainManager } from "./subdomain-manager.js";
import { getSubdomainsRepository } from "../settings/manager.js";
import { resolveOpencodeRouteForUser } from "./route-resolver.js";

const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());

export interface AuthResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export async function handleAuthRequest(rawBody: string): Promise<AuthResponse> {
  let parsed: { initData?: string };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!parsed.initData) {
    return { status: 400, body: JSON.stringify({ error: "Missing initData" }) };
  }

  const data = validateInitData(parsed.initData);
  if (!data) {
    return { status: 400, body: JSON.stringify({ error: "Invalid or expired initData" }) };
  }

  if (!isUserAuthorized(data.user.id)) {
    return { status: 403, body: JSON.stringify({ error: "Access denied" }) };
  }

  const route = resolveOpencodeRouteForUser(data.user.id);

  // When SSH is active the subdomain is managed by ensureSshSubdomain().
  // Calling ensureSubdomain() with any other kind would overwrite the SSH
  // kind, hostname, and ssh_connection_id in the database.  Read the
  // existing record instead and leave it untouched.
  const isSshKind = route?.kind === "ssh-host" || route?.kind === "ssh-docker";

  let info: {
    userId: number;
    username: string;
    subdomain: string;
    kind: string;
    hostname?: string | null;
  };

  if (isSshKind) {
    const repo = getSubdomainsRepository();
    let row = repo.getByUserId(data.user.id);
    if (!row) {
      // Subdomain row missing — this can happen when the auth request
      // arrives before the SSH command handler has called ensureSshSubdomain,
      // or after a bot restart where SSH recovery failed.  Create the row
      // now so subsequent proxy lookups succeed.
      const conn = require("../utils/ssh-manager.js").sshManager.getActiveConnection(data.user.id);
      if (!conn) {
        return { status: 500, body: JSON.stringify({ error: "SSH connection lost" }) };
      }
      const effectiveUsername = data.user.username?.replace(/^@/, "") || `tg${data.user.id}`;
      const hostname = (conn.hostname || "unknown").toLowerCase();
      const kind = conn.deployTarget === "docker" ? "ssh-docker" : "ssh-host";
      const sshConnectionId = conn.id || "unknown";
      subdomainManager.ensureSshSubdomain(
        data.user.id,
        effectiveUsername,
        hostname,
        kind as "ssh-host" | "ssh-docker",
        sshConnectionId,
      );
      row = repo.getByUserId(data.user.id);
      if (!row) {
        return { status: 500, body: JSON.stringify({ error: "Failed to create subdomain for SSH user" }) };
      }
    }
    info = {
      userId: row.user_id,
      username: row.username,
      subdomain: row.subdomain,
      kind: route!.kind,
      hostname: row.hostname,
    };
  } else {
    const kind = route?.kind === "tenant" ? "tenant" : "host";
    info = subdomainManager.ensureSubdomain(data.user.id, data.user.username, kind);
  }

  return {
    status: 200,
    body: JSON.stringify({
      subdomain: `${info.subdomain}.smart-server.online`,
      username: info.username,
      password: route?.password || undefined,
      authenticated: true,
    }),
  };
}
