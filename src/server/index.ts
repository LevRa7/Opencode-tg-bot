import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handleAuthRequest } from "./auth-handler.js";
import { handleProxyRequest } from "./proxy.js";
import { logger } from "../utils/logger.js";

const PORT = 8080;

// Path to Mini App built files (relative to project root)
const MINIAPP_DIST = path.resolve(process.cwd(), "..", "opencode-miniapp", "dist");

function serveStaticFile(res: http.ServerResponse, filePath: string): void {
  const safePath = filePath === "/" ? "index.html" : filePath.replace(/^\/+/, "");
  const fullPath = path.join(MINIAPP_DIST, safePath);

  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
  };
  const ext = path.extname(fullPath);
  const contentType = mimeTypes[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    // SPA fallback: serve index.html
    try {
      const indexContent = fs.readFileSync(path.join(MINIAPP_DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexContent);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  }
}

function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    // CORS for Mini App
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || "";
    const hostPart = host.split(":")[0];
    const baseDomain = "smart-server.online";
    if (hostPart !== "localhost" && hostPart !== "127.0.0.1" && hostPart.endsWith(`.${baseDomain}`)) {
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

    // POST /api/auth
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

    // GET — serve static files
    if (req.method === "GET") {
      const url = req.url || "/";
      serveStaticFile(res, url);
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
    serverInstance.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        logger.warn(`[HTTP] Port ${PORT} in use, retrying in 5s...`);
        setTimeout(() => {
          serverInstance?.close();
          serverInstance = createServer();
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
