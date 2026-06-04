import { describe, it, expect } from "vitest";
import http from "node:http";

function fetch(method: string, path: string, host?: string, body?: string, auth?: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      host: "127.0.0.1",
      port: 8080,
      path,
      method,
      headers: {} as Record<string, string>,
    };
    if (host) opts.headers!["Host"] = host;
    if (auth) opts.headers!["Authorization"] = auth;
    if (body) {
      opts.headers!["Content-Type"] = "application/json";
      opts.headers!["Content-Length"] = Buffer.byteLength(body).toString();
    }
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("Subdomain proxy", () => {
  it("returns 401 (unauthorized) for unauthenticated request", async () => {
    const res = await fetch("GET", "/", SUBDOMAIN_HOST);
    expect(res.status).toBe(401);
  });

  it("returns 200 for authenticated request with Basic Auth", async () => {
    const res = await fetch("GET", "/", SUBDOMAIN_HOST, undefined,
      "Basic " + Buffer.from("opencode:e38AXn4RzcLFKyD8").toString("base64"));
    expect(res.status).toBe(200);
    expect(res.body).toContain("OpenCode");
  });

  it("serves JS asset with Basic Auth", async () => {
    const res = await fetch("GET", "/assets/index-Celomlsk.js", SUBDOMAIN_HOST, undefined,
      "Basic " + Buffer.from("opencode:e38AXn4RzcLFKyD8").toString("base64"));
    expect(res.status).toBe(200);
    expect(Number(res.headers["content-length"])).toBeGreaterThan(10000);
  });

  it("returns 404 for unknown subdomain", async () => {
    const res = await fetch("GET", "/", UNKNOWN_HOST);
    expect(res.status).toBe(404);
    expect(res.body).toContain("Unknown subdomain");
  });
});

describe("Mini-app root domain", () => {
  it("serves mini-app HTML on root domain", async () => {
    const res = await fetch("GET", "/", "smart-server.online");
    expect(res.status).toBe(200);
    expect(res.body).toContain("telegram-web-app");
  });

  it("serves mini-app JS assets", async () => {
    const res = await fetch("GET", "/assets/index-BTnaWjPr.js", "smart-server.online");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });
});

describe("Auth API", () => {
  it("returns 400 for missing initData", async () => {
    const res = await fetch("POST", "/api/auth", "smart-server.online", "{}");
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toHaveProperty("error");
  });
});

const SUBDOMAIN_HOST = "lev.smart-server.online";
const UNKNOWN_HOST = "nonexistent.smart-server.online";
