import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAuthRequest } from "./auth-handler.js";
import { handleProxyRequest } from "./proxy.js";
import { logger } from "../utils/logger.js";

const PORT = 8080;
const OPENCHAMBER_SERVER = "http://127.0.0.1:8081";

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
    setCors(res, req);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
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

    const host = req.headers.host || "";
    const hostPart = host.split(":")[0];
    const baseDomain = "smart-server.online";
    const isSubdomain =
      hostPart !== "localhost" &&
      hostPart !== "127.0.0.1" &&
      hostPart.endsWith(`.${baseDomain}`) &&
      hostPart !== baseDomain;

    // Subdomain: proxy to OpenChamber (admin) or serve OpenChamber SPA + route API
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
      // Tenant subdomains: proxy directly to tenant's opencode serve (OpenCode built-in UI)
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

    // WebSocket upgrade handler — proxy WS to OpenChamber
    serverInstance.on("upgrade", (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
      const host = req.headers.host || "";
      const hostPart = host.split(":")[0];
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

      const targetUrl = new URL(req.url || "/", OPENCHAMBER_SERVER);
      const targetHost = targetUrl.hostname;
      const targetPort = parseInt(targetUrl.port, 10) || 80;

      const headers: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined && k !== "host") headers[k] = v;
      }
      headers["host"] = host;

      const proxySocket = net.connect(targetPort, targetHost, () => {
        proxySocket.write(
          `${req.method} ${targetUrl.pathname}${targetUrl.search ? "?" + targetUrl.search : ""} HTTP/1.1\r\n` +
          Object.entries(headers)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join("\r\n") +
          "\r\n\r\n"
        );
        proxySocket.write(head);

        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
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
