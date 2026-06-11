import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SubdomainManager } from "./subdomain-manager.js";
import { getSubdomainsRepository } from "../settings/manager.js";
import { resolveOpencodeRouteForUser } from "./route-resolver.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const subdomainManager = new SubdomainManager(() => getSubdomainsRepository());

interface ProxyTarget {
  baseUrl: string;
  authHeader: string;
}

export function resolveProxyTarget(host: string): ProxyTarget | null {
  const hostPart = host.split(":")[0];
  if (!hostPart || hostPart === "localhost" || hostPart === "127.0.0.1") {
    return null;
  }

  const baseDomain = "smart-server.online";
  let subdomain: string;
  if (hostPart.endsWith(`.${baseDomain}`)) {
    subdomain = hostPart.slice(0, -(baseDomain.length + 1)).toLowerCase();
  } else {
    subdomain = hostPart;
  }

  // Root domain: use admin route as fallback
  if (!subdomain || subdomain === "www" || subdomain === baseDomain) {
    const adminRoute = resolveOpencodeRouteForUser(config.telegram.adminUserId);
    if (adminRoute) {
      const credentials = adminRoute.password
        ? Buffer.from(`opencode:${adminRoute.password}`).toString("base64")
        : undefined;
      return {
        baseUrl: adminRoute.baseUrl,
        authHeader: credentials ? `Basic ${credentials}` : "",
      };
    }
    return null;
  }

  const resolved = subdomainManager.resolveSubdomain(subdomain);
  if (!resolved) return null;

  const route = resolveOpencodeRouteForUser(resolved.userId);
  if (!route) return null;

  const credentials = route.password
    ? Buffer.from(`opencode:${route.password}`).toString("base64")
    : undefined;

  return {
    baseUrl: route.baseUrl,
    authHeader: credentials ? `Basic ${credentials}` : "",
  };
}

export async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  host: string,
): Promise<void> {
  const target = resolveProxyTarget(host);
  if (!target) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Unknown subdomain");
    return;
  }

  const targetUrl = new URL(req.url || "/", target.baseUrl);

  const proxyHeaders: Record<string, string | string[] | undefined> = {
    ...Object.fromEntries(
      Object.entries(req.headers).filter(([, v]) => v !== undefined) as [string, string | string[]][]
    ),
    host: targetUrl.host,
  };

  if (target.authHeader) {
    proxyHeaders["authorization"] = target.authHeader;
  }

  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers: proxyHeaders,
    },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders["x-frame-options"];
      delete responseHeaders["content-security-policy"];

      res.writeHead(proxyRes.statusCode ?? 200, responseHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    logger.error("[Proxy] Upstream error", err);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    }
  });

  req.pipe(proxyReq);
}
