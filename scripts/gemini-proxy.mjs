#!/usr/bin/env node
import { spawn } from "node:child_process";
import http from "node:http";

const PORT = Number(process.env.GEMINI_PROXY_PORT || 8125);
const TOKEN = process.env.GEMINI_PROXY_TOKEN || "29da73b5-0de0-495d-b535-617e721581a7";

const KNOWN_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function extractText(messages) {
  const last = messages[messages.length - 1];
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    const textParts = last.content.filter((p) => p.type === "text").map((p) => p.text);
    const text = textParts.join("\n");
    if (text) return text;
    // For media attachments, provide a description prompt
    const mediaTypes = last.content.filter((p) => p.type === "image_url" || p.type === "input_audio" || p.type === "file");
    if (mediaTypes.length > 0) {
      return `The user sent media. Describe what you see and transcribe any speech.`;
    }
  }
  return String(last.content || "");
}

function geminiCall(model, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("gemini", [
      "-p", prompt,
      "-m", model,
      "-y", "--skip-trust",
      "-o", "text",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });

    child.on("close", (code) => {
      if (code === 0) {
        // Strip ANSI and warning lines
        const clean = stdout
          .replace(/\x1b\[[0-9;]*m/g, "")
          .split("\n")
          .filter((l) => !l.startsWith("Warning:") && !l.startsWith("YOLO mode"))
          .join("\n")
          .trim();
        resolve(clean || "(empty response)");
      } else {
        reject(new Error(`gemini exited ${code}: ${stderr.slice(0, 500)}`));
      }
    });

    child.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Auth
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${TOKEN}`) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  // Health
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // List models
  if (req.method === "GET" && req.url === "/v1/models") {
    sendJson(res, 200, {
      object: "list",
      data: KNOWN_MODELS.map((id) => ({
        id,
        object: "model",
        created: 0,
        owned_by: "gemini-cli",
      })),
    });
    return;
  }

  // Chat completions
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const { model, messages, stream } = body;
    if (!model || !messages?.length) {
      sendJson(res, 400, { error: "model and messages are required" });
      return;
    }

    if (!KNOWN_MODELS.includes(model)) {
      sendJson(res, 400, { error: `Unknown model: ${model}` });
      return;
    }

    const prompt = extractText(messages);
    if (!prompt) {
      sendJson(res, 400, { error: "No text content in messages" });
      return;
    }

    try {
      const text = await geminiCall(model, prompt);
      const response = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };

      if (stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ ...response, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      } else {
        sendJson(res, 200, response);
      }
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Gemini proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`Token: Bearer ${TOKEN}`);
});
