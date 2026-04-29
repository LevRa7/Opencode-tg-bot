import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const CONFIG_PATH = process.env.GEMINI_MEDIA_PROXY_CONFIG_PATH || '/run/opencode-gemini-media/config.json';
const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = Number(process.env.GEMINI_MEDIA_PROXY_PORT || 18124);
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PROMPT_CHARS = 16000;

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function inferMimeType(filename) {
  const extension = path.extname(filename).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return 'image/jpeg';
    case ".png":
      return 'image/png';
    case ".webp":
      return 'image/webp';
    case ".gif":
      return 'image/gif';
    case ".pdf":
      return 'application/pdf';
    case ".mp3":
      return 'audio/mpeg';
    case ".wav":
      return 'audio/wav';
    case ".m4a":
      return 'audio/mp4';
    case ".ogg":
      return 'audio/ogg';
    case ".mp4":
      return 'video/mp4';
    case ".mov":
      return 'video/quicktime';
    case ".webm":
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function readRequestJson(request) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new RequestError(413, 'Request body is too large');
  }

  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      throw new RequestError(413, 'Request body is too large');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}');
}

async function uploadFile({ baseUrl, token, filename, fileBuffer }) {
  const mimeType = inferMimeType(filename);
  const form = new FormData();
  form.set('purpose', 'user_data');
  form.set('file', new Blob([fileBuffer], { type: mimeType }), filename);

  const response = await fetch(`${baseUrl}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    data = null;
  }
  if (!response.ok) {
    console.error(`Gemini media upload failed with upstream HTTP ${response.status}`);
    throw new Error('Upload failed');
  }

  return data.id;
}

async function requestCompletion({ baseUrl, token, model, prompt, fileId }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    data = null;
  }
  if (!response.ok) {
    console.error(`Gemini media completion failed with upstream HTTP ${response.status}`);
    throw new Error('Chat completion failed');
  }

  return data?.choices?.[0]?.message?.content ?? '';
}

async function main() {
  const rawConfig = await fs.readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(rawConfig);

  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method !== 'POST' || request.url !== '/process') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    try {
      const payload = await readRequestJson(request);
      if (!payload?.filename || !payload?.prompt || !payload?.fileBase64) {
        sendJson(response, 400, { error: 'filename, prompt, and fileBase64 are required' });
        return;
      }

      if (payload.prompt.length > MAX_PROMPT_CHARS) {
        sendJson(response, 400, { error: 'prompt is too long' });
        return;
      }

      const fileBuffer = Buffer.from(payload.fileBase64, 'base64');
      if (fileBuffer.length > MAX_FILE_BYTES) {
        sendJson(response, 413, { error: 'file payload is too large' });
        return;
      }

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
      const statusCode = error instanceof RequestError ? error.statusCode : 500;
      const message = error instanceof RequestError ? error.message : 'Media processing failed';
      if (!(error instanceof RequestError)) {
        console.error(error instanceof Error ? error.message : String(error));
      }
      sendJson(response, statusCode, { error: message });
    }
  });

  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.error(`Gemini media proxy listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
