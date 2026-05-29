import fs from 'node:fs/promises';
import http from 'node:http';

const CONFIG_PATH = process.env.GPT_IMAGE_PROXY_CONFIG_PATH || '/run/opencode-gpt-image/config.json';
const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = Number(process.env.GPT_IMAGE_PROXY_PORT || 18125);
const DEFAULT_MODEL = 'gpt-image-2';
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_PROMPT_CHARS = 16000;

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
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

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function parseJsonResponse(response, fallbackMessage) {
  const responseText = await response.text();
  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error(`${fallbackMessage}: upstream HTTP ${response.status}`);
    throw new Error(fallbackMessage);
  }

  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error(`${fallbackMessage}: response did not include data[0].b64_json`);
  }

  return imageBase64;
}

async function generateImage({ config, prompt }) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODEL,
      prompt,
      response_format: 'b64_json',
    }),
  });

  return parseJsonResponse(response, 'Image generation failed');
}

async function editImage({ config, prompt, images }) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const form = new FormData();
  form.set('model', config.model || DEFAULT_MODEL);
  form.set('prompt', prompt);
  form.set('response_format', 'b64_json');

  for (const image of images) {
    const fileBuffer = Buffer.from(image.fileBase64, 'base64');
    if (fileBuffer.length > MAX_IMAGE_BYTES) {
      throw new RequestError(413, 'Image payload is too large');
    }
    form.append('image', new Blob([fileBuffer], { type: 'image/png' }), image.filename || 'image.png');
  }

  const response = await fetch(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  return parseJsonResponse(response, 'Image edit failed');
}

async function main() {
  const rawConfig = await fs.readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(rawConfig);

  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method !== 'POST' || !['/generate', '/edit'].includes(request.url)) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    try {
      const payload = await readRequestJson(request);

      if (request.url === '/generate') {
        if (!payload?.prompt || payload.prompt.length > MAX_PROMPT_CHARS) {
          sendJson(response, 400, { error: 'prompt is required' });
          return;
        }

        const imageBase64 = await generateImage({ config, prompt: payload.prompt });
        sendJson(response, 200, { imageBase64 });
        return;
      }

      if (!payload?.prompt || payload.prompt.length > MAX_PROMPT_CHARS || !Array.isArray(payload.images) || payload.images.length < 2 || payload.images.length > 6) {
        sendJson(response, 400, { error: 'prompt and 2-6 images are required' });
        return;
      }

      const imageBase64 = await editImage({
        config,
        prompt: payload.prompt,
        images: payload.images,
      });
      sendJson(response, 200, { imageBase64 });
    } catch (error) {
      const statusCode = error instanceof RequestError ? error.statusCode : 500;
      const message = error instanceof RequestError ? error.message : 'GPT image proxy request failed';
      if (!(error instanceof RequestError)) {
        console.error(error instanceof Error ? error.message : String(error));
      }
      sendJson(response, statusCode, { error: message });
    }
  });

  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.log(`GPT image proxy listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
