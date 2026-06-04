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

  const info = subdomainManager.ensureSubdomain(
    data.user.id,
    data.user.username,
    "host",
  );

  const route = resolveOpencodeRouteForUser(data.user.id);

  return {
    status: 200,
    body: JSON.stringify({
      subdomain: `${info.subdomain}.smart-server.online`,
      username: info.username,
      password: info.password || undefined,
      apiPassword: route?.password || undefined,
      authenticated: true,
    }),
  };
}
