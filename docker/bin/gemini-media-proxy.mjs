import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const CONFIG_PATH = "/run/opencode-gemini-media/config.json";
const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 18124;
const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

function inferMimeType(filename) {
  const extension = path.extname(filename).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}

async function uploadFile({ baseUrl, token, filename, fileBuffer }) {
  const mimeType = inferMimeType(filename);
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", new Blob([fileBuffer], { type: mimeType }), filename);

  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? data?.error ?? "Upload failed");
  }

  return data.id;
}

async function requestCompletion({ baseUrl, token, model, prompt, fileId }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "input_file", input_file: { file_id: fileId } },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? data?.error ?? "Chat completion failed");
  }

  return data.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const rawConfig = await fs.readFile(CONFIG_PATH, "utf8");
  const config = JSON.parse(rawConfig);

  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method !== "POST" || request.url !== "/process") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    try {
      const payload = await readRequestJson(request);
      if (!payload?.filename || !payload?.prompt || !payload?.fileBase64) {
        sendJson(response, 400, { error: "filename, prompt, and fileBase64 are required" });
        return;
      }

      const fileBuffer = Buffer.from(payload.fileBase64, "base64");
      const fileId = await uploadFile({
        baseUrl: config.baseUrl,
        token: config.apiKey,
        filename: payload.filename,
        fileBuffer,
      });
      const output = await requestCompletion({
        baseUrl: config.baseUrl,
        token: config.apiKey,
        model: config.model || DEFAULT_MODEL,
        prompt: payload.prompt,
        fileId,
      });

      sendJson(response, 200, { output });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(LISTEN_PORT, LISTEN_HOST);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
