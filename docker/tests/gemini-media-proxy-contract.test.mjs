import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dockerRoot = path.resolve(new URL('../', import.meta.url).pathname);
const proxyPath = path.join(dockerRoot, 'bin/gemini-media-proxy.mjs');
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-media-proxy-test-'));
const configPath = path.join(tmpDir, 'config.json');
const received = [];

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

const proxyPort = await reservePort();
const upstreamPort = await reservePort();

const upstream = http.createServer(async (request, response) => {
  const body = await readRequestBody(request);
  received.push({
    url: request.url,
    method: request.method,
    authorization: request.headers.authorization,
    contentType: request.headers['content-type'],
    body,
  });

  if (request.url === '/v1/files') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ id: 'file-123' }));
    return;
  }

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: 'described output' } }] }));
});

await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));

await fs.writeFile(
  configPath,
  JSON.stringify({
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: 'contract-secret',
    model: 'gemini-3.1-flash-lite-preview',
  })
);

const proxy = spawn(process.execPath, [proxyPath], {
  env: {
    ...process.env,
    GEMINI_MEDIA_PROXY_CONFIG_PATH: configPath,
    GEMINI_MEDIA_PROXY_PORT: String(proxyPort),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const health = await fetch(`http://127.0.0.1:${proxyPort}/health`);
      if (health.ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const processResponse = await fetch(`http://127.0.0.1:${proxyPort}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'photo.png',
      prompt: 'describe photo',
      fileBase64: Buffer.from('photo-bytes').toString('base64'),
    }),
  });
  assert.equal(processResponse.status, 200);
  assert.equal((await processResponse.json()).output, 'described output');

  assert.equal(received[0].url, '/v1/files');
  assert.equal(received[0].authorization, 'Bearer contract-secret');
  assert.match(received[0].contentType, /^multipart\/form-data/);
  assert.equal(received[1].url, '/v1/chat/completions');
  assert.equal(received[1].authorization, 'Bearer contract-secret');
  assert.match(received[1].body.toString('utf8'), /file-123/);
} finally {
  proxy.kill('SIGTERM');
  upstream.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
}

console.log('ok: gemini media proxy contract');
