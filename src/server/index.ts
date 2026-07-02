import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAuthRequest } from "./auth-handler.js";
import { handleProxyRequest, resolveProxyTarget } from "./proxy.js";
import { rewriteApiUrl, rewriteWsPath } from "./api-url-rewrite.js";
import { logger } from "../utils/logger.js";
import { randomBytes } from "node:crypto";
import { getActiveBotInstance } from "../bot/index.js";
import { handleControlApiRequest, getControlApiKey } from "./control-api.js";

const PORT = parseInt(process.env.HTTP_PORT || "8080", 10);
const OPENCHAMBER_SERVER = "http://127.0.0.1:8081";

type TelegramWebhookRequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

let telegramWebhookRoute: { path: string; handler: TelegramWebhookRequestHandler } | null = null;

export function setTelegramWebhookRequestHandler(
  routePath: string,
  handler: TelegramWebhookRequestHandler,
): void {
  const normalizedPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  telegramWebhookRoute = { path: normalizedPath, handler };
}

// In-memory token store for MiniApp URL tokens (OpenChamber-compatible).
// Keyed by token string, value contains user credentials and expiry.
const urlTokenStore = new Map<
  string,
  { userId: number; username: string; password: string; expiresAt: number }
>();

function generateUrlToken(): string {
  return "oc_url_" + randomBytes(24).toString("base64url");
}

function handleUrlToken(req: IncomingMessage, res: ServerResponse): void {
  const host = req.headers.host || "";

  // For the admin subdomain, let the request pass through to OpenChamber
  const hostPart = host.split(":")[0];
  const baseDomain = "smart-server.online";
  const subdomain = hostPart.endsWith(`.${baseDomain}`)
    ? hostPart.slice(0, -(baseDomain.length + 1)).toLowerCase()
    : "";

  if (subdomain === "levra7") {
    // Proxy to OpenChamber which handles its own /auth/url-token
    proxyToUrl(req, res, OPENCHAMBER_SERVER, host);
    return;
  }

  const target = resolveProxyTarget(host);
  if (!target) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unknown subdomain" }));
    return;
  }

  const token = generateUrlToken();
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h

  // The proxy adds Basic auth to all requests.  The MiniApp only needs a
  // non-empty token to satisfy its own auth flow; actual auth is handled
  // by the proxy layer.
  urlTokenStore.set(token, { userId: 0, username: "opencode", password: "", expiresAt });

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ token, expiresAt }));
}

// Path to Mini App built files (OpenChamber dist)
const MINIAPP_DIST = "/var/www/opencode-miniapp";
// Path to bot's own public assets
const PUBLIC_DIR = "/root/Opencode-tg-bot/public";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

// API paths that should be proxied to OpenChamber on root domain
const API_PATH_PREFIXES = ["/global/", "/v1/", "/api/", "/.well-known/"];
const API_EXACT_PATHS = new Set(["/health", "/settings", "/projects"]);

function isApiPath(url: string): boolean {
  return API_EXACT_PATHS.has(url) || API_PATH_PREFIXES.some((p) => url.startsWith(p));
}

function serveIndexHtml(res: ServerResponse): void {
  try {
    let content = fs.readFileSync(path.join(MINIAPP_DIST, "index.html"), "utf-8");
    const injectHead = [
      '<link rel="stylesheet" href="/miniapp-theme.css">',
      '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
      '<script src="/miniapp-bootstrap.js" defer></script>',
    ].join("\n    ");
    content = content.replace("</head>", `  ${injectHead}\n  </head>`);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function serveStaticFile(res: ServerResponse, filePath: string): boolean {
  const safePath = filePath === "/" ? "index.html" : filePath.replace(/^\/+/, "");
  const ext = path.extname(safePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  // Try bot's public dir first (overrides)
  const publicPath = path.join(PUBLIC_DIR, safePath);
  try {
    const content = fs.readFileSync(publicPath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch {}

  // Fallback to MiniApp dist
  const fullPath = path.join(MINIAPP_DIST, safePath);
  try {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function setCors(res: ServerResponse, req: IncomingMessage): void {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
}

function proxyToUrl(
  req: IncomingMessage,
  res: ServerResponse,
  baseUrl: string,
  hostHeader?: string,
): void {
  const targetUrl = new URL(req.url || "/", baseUrl);

  const headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined && k !== "host") headers[k] = v;
  }
  headers["host"] = hostHeader ?? targetUrl.host;

  const proxyReq = http.request(
    targetUrl,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders["x-frame-options"];
      delete responseHeaders["content-security-policy"];
      delete responseHeaders["strict-transport-security"];

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

function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const requestPath = req.url?.split("?")[0] ?? "/";
    if (telegramWebhookRoute && req.method === "POST" && requestPath === telegramWebhookRoute.path) {
      await telegramWebhookRoute.handler(req, res);
      return;
    }

    setCors(res, req);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Control API (/api/control/*) — programmatic bot management ──
    const bot = getActiveBotInstance();
    if (bot) {
      const handled = await handleControlApiRequest(req, res, bot);
      if (handled) return;
    }

    // POST /api/auth — Telegram MiniApp authentication
    if (req.method === "POST" && req.url === "/api/auth") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", async () => {
        try {
          const body = Buffer.concat(chunks).toString("utf-8");
          const result = await handleAuthRequest(body);
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...result.headers,
          };
          res.writeHead(result.status, headers);
          res.end(result.body);
        } catch (err) {
          logger.error("[HTTP] Auth error", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
      return;
    }

    // POST /auth/url-token — OpenChamber-compatible URL token (needed by MiniApp)
    if (req.method === "POST" && req.url === "/auth/url-token") {
      handleUrlToken(req, res);
      return;
    }

    // POST /login — password authentication for web panel access.
    // Validates the password against the resolved proxy target and sets
    // a cookie so the SPA loads on subsequent requests.
    if (req.method === "POST" && req.url === "/login") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const password = body.password || "";
          const host = req.headers.host || "";
          const target = resolveProxyTarget(host);
          if (target) {
            const credentials = Buffer.from(
              target.authHeader.split(" ")[1] || "",
              "base64",
            ).toString();
            const [, expectedPassword] = credentials.split(":");
            if (password === expectedPassword) {
              const cookie = "oc_auth=1; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly";
              res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": cookie });
              res.end(JSON.stringify({ ok: true }));
              return;
            }
          }
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid password" }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad request" }));
        }
      });
      return;
    }

    const host = req.headers.host || "";
    const hostPart = host.split(":")[0];
    const baseDomain = "smart-server.online";
    const isSubdomain =
      hostPart !== "localhost" &&
      hostPart !== "127.0.0.1" &&
      hostPart.endsWith(`.${baseDomain}`) &&
      hostPart !== baseDomain;

    // Subdomain: proxy to OpenChamber (admin) or serve MiniApp SPA + route API
    if (isSubdomain) {
      // Extract subdomain from host
      const subdomain = hostPart.endsWith(`.${baseDomain}`)
        ? hostPart.slice(0, -(baseDomain.length + 1)).toLowerCase()
        : "";
      // Admin subdomain: proxy everything to OpenChamber server
      if (subdomain === "levra7") {
        proxyToUrl(req, res, OPENCHAMBER_SERVER, host);
        return;
      }
      // Tenant subdomains: serve MiniApp SPA for page load + static assets.
      // The MiniApp (OpenChamber) uses /api/ prefix for all API calls,
      // e.g. /api/session, /api/global/health.  Strip the prefix before
      // proxying to the OpenCode backend.

      // OpenChamber-specific endpoints the MiniApp expects as JSON.
      // These do not exist in the OpenCode backend; serve minimal defaults.
      if (req.method === "GET") {
        if (req.url === "/health" || req.url === "/health/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ status: "ok", runtime: "web", compatibility: { capabilities: [] } }),
          );
          return;
        }
        if (req.url === "/auth/session" || req.url === "/auth/session/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ authenticated: true, disabled: false }));
          return;
        }
        if (req.url === "/auth/passkey/status" || req.url === "/auth/passkey/status/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ enabled: false, hasPasskeys: false, passkeyCount: 0, rpID: null }),
          );
          return;
        }
        // /api/config/settings — OpenChamber-only settings (theme, projects)
        if (req.url === "/api/config/settings" || req.url === "/api/config/settings/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              themeId: "jetbrains-dark",
              themeVariant: "dark",
              useSystemTheme: false,
              projects: [],
            }),
          );
          return;
        }
        // /api/config/themes — OpenChamber-only theme definitions
        if (req.url === "/api/config/themes" || req.url === "/api/config/themes/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ themes: [] }));
          return;
        }
        // /api/fs/home — OpenChamber-only filesystem home
        if (req.url === "/api/fs/home" || req.url === "/api/fs/home/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ home: "/root" }));
          return;
        }
        // /api/session-folders — OpenChamber-only session folder list
        if (req.url === "/api/session-folders" || req.url === "/api/session-folders/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ version: 1, foldersMap: {} }));
          return;
        }
      }

      // PUT /api/config/settings — MiniApp saves settings; accept and ack
      if (
        (req.method === "PUT" || req.method === "PATCH") &&
        (req.url === "/api/config/settings" || req.url === "/api/config/settings/")
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const url = req.url || "/";

      // Rewrite /api/* paths for the OpenCode backend
      if (url.startsWith("/api/") || url.startsWith("/api?")) {
        req.url = rewriteApiUrl(url);
        try {
          await handleProxyRequest(req, res, host);
        } catch (err) {
          logger.error("[HTTP] Proxy error", err);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Proxy error");
          }
        }
        return;
      }

      if (req.method === "GET") {
        if (url === "/" || url === "/index.html") {
          serveIndexHtml(res);
          return;
        }
        if (serveStaticFile(res, url)) return;
        // Everything else: proxy to backend (covers non-prefixed API paths)
        try {
          await handleProxyRequest(req, res, host);
        } catch (err) {
          logger.error("[HTTP] Proxy error", err);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Proxy error");
          }
        }
        return;
      }
      // Non-GET: proxy API calls (POST, PUT, DELETE, etc.)
      try {
        await handleProxyRequest(req, res, host);
        return;
      } catch (err) {
        logger.error("[HTTP] Proxy error", err);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Proxy error");
        }
        return;
      }
    }

    // Root domain: serve redirect page that detects Telegram user and redirects to their subdomain
    const url = req.url || "/";

    if (req.method === "GET") {
      if (isApiPath(url)) {
        proxyToUrl(req, res, OPENCHAMBER_SERVER, host);
        return;
      }
      // Serve the redirect page instead of full SPA — user gets redirected to their subdomain
      if (url === "/" || url === "/index.html") {
        try {
          const redirectHtml = fs.readFileSync(path.join(MINIAPP_DIST, "redirect.html"));
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(redirectHtml);
          return;
        } catch {}
      }
      if (serveStaticFile(res, url)) return;
      serveIndexHtml(res);
      return;
    }

    // Root domain non-GET: proxy API paths
    if (isApiPath(url)) {
      proxyToUrl(req, res, OPENCHAMBER_SERVER, host);
      return;
    }

    res.writeHead(405);
    res.end("Method not allowed");
  });
}

let serverInstance: http.Server | null = null;

export function startHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (serverInstance) {
      resolve();
      return;
    }
    serverInstance = createServer();

    // WebSocket upgrade handler — proxy WS to the correct backend.
    // The MiniApp (OpenChamber) sends WS requests to /api/global/event/ws.
    // Strip /api/ prefix and /ws suffix before forwarding to the OpenCode
    // backend, and include Basic auth from the resolved proxy target.
    serverInstance.on("upgrade", (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
      const hostHeader = req.headers.host || "";
      const hostPart = hostHeader.split(":")[0];
      const baseDomain = "smart-server.online";
      const isSubdomain =
        hostPart !== "localhost" &&
        hostPart !== "127.0.0.1" &&
        hostPart.endsWith(`.${baseDomain}`) &&
        hostPart !== baseDomain;

      if (!isSubdomain) {
        socket.destroy();
        return;
      }

      const subdomain = hostPart.endsWith(`.${baseDomain}`)
        ? hostPart.slice(0, -(baseDomain.length + 1)).toLowerCase()
        : "";

      let wsTarget: string;
      let authHeader = "";

      if (subdomain === "levra7") {
        wsTarget = OPENCHAMBER_SERVER;
      } else {
        const target = resolveProxyTarget(hostHeader);
        if (!target) {
          socket.destroy();
          return;
        }
        wsTarget = target.baseUrl;
        authHeader = target.authHeader;
        req.url = rewriteWsPath(req.url || "/");
      }

      const targetUrl = new URL(req.url || "/", wsTarget);
      const targetHost = targetUrl.hostname;
      const targetPort = parseInt(targetUrl.port, 10) || 80;

      const headers: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined && k !== "host") headers[k] = v;
      }
      headers["host"] = hostHeader;
      if (authHeader) {
        headers["authorization"] = authHeader;
      }

      const proxySocket = net.connect(targetPort, targetHost, () => {
        proxySocket.write(
          `${req.method} ${targetUrl.pathname}${targetUrl.search ? "?" + targetUrl.search : ""} HTTP/1.1\r\n` +
            Object.entries(headers)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
              .join("\r\n") +
            "\r\n\r\n",
        );
        proxySocket.write(head);

        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
        );
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      });

      proxySocket.on("error", (err) => {
        logger.error("[WS Proxy] Error", err);
        socket.destroy();
      });

      socket.on("error", (err) => {
        logger.error("[WS Proxy] Client error", err);
        proxySocket.destroy();
      });
    });

    serverInstance.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        logger.warn(`[HTTP] Port ${PORT} in use, retrying in 5s...`);
        setTimeout(() => {
          serverInstance?.close();
          serverInstance = createServer();
          serverInstance.on("error", (err2: NodeJS.ErrnoException) => {
            logger.error("[HTTP] Retry failed", err2);
            reject(err2);
          });
          serverInstance.listen(PORT, () => {
            logger.info(`[HTTP] Server started on port ${PORT}`);
            resolve();
          });
        }, 5000);
      } else {
        logger.error("[HTTP] Server error", err);
        reject(err);
      }
    });
    serverInstance.listen(PORT, () => {
      logger.info(`[HTTP] Server started on port ${PORT}`);
      logger.info(`[HTTP] Control API key: ${getControlApiKey()}`);
      resolve();
    });
  });
}

export function stopHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverInstance) {
      resolve();
      return;
    }
    serverInstance.close(() => {
      logger.info("[HTTP] Server stopped");
      serverInstance = null;
      resolve();
    });
  });
}
