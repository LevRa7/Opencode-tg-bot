import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dockerRoot = path.resolve(new URL('../', import.meta.url).pathname);
const proxyPath = path.join(dockerRoot, 'bin/gpt-image-proxy.mjs');
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-image-proxy-test-'));
const configPath = path.join(tmpDir, 'config.json');
const proxyPort = 19125;
const upstreamPort = 19126;
const received = [];

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const upstream = http.createServer(async (request, response) => {
  const body = await readRequestBody(request);
  received.push({
    url: request.url,
    method: request.method,
    authorization: request.headers.authorization,
    contentType: request.headers['content-type'],
    body,
  });

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }));
});

await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));

await fs.writeFile(
  configPath,
  JSON.stringify({
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: 'contract-secret',
    model: 'gpt-image-2',
  })
);

const proxy = spawn(process.execPath, [proxyPath], {
  env: {
    ...process.env,
    GPT_IMAGE_PROXY_CONFIG_PATH: configPath,
    GPT_IMAGE_PROXY_PORT: String(proxyPort),
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

  const generateResponse = await fetch(`http://127.0.0.1:${proxyPort}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'test prompt' }),
  });
  assert.equal(generateResponse.status, 200);
  assert.equal((await generateResponse.json()).imageBase64, Buffer.from('png').toString('base64'));

  const editResponse = await fetch(`http://127.0.0.1:${proxyPort}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'edit prompt',
      images: [
        { filename: 'base.png', fileBase64: Buffer.from('base').toString('base64') },
        { filename: 'ref.png', fileBase64: Buffer.from('ref').toString('base64') },
      ],
    }),
  });
  assert.equal(editResponse.status, 200);

  assert.equal(received[0].url, '/v1/images/generations');
  assert.equal(received[0].authorization, 'Bearer contract-secret');
  assert.match(received[0].body.toString('utf8'), /"prompt":"test prompt"/);

  assert.equal(received[1].url, '/v1/images/edits');
  assert.equal(received[1].authorization, 'Bearer contract-secret');
  assert.match(received[1].contentType, /^multipart\/form-data/);
  const editBody = received[1].body.toString('latin1');
  assert.match(editBody, /name="image"; filename="base.png"/);
  assert.match(editBody, /name="image"; filename="ref.png"/);
} finally {
  proxy.kill('SIGTERM');
  upstream.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
}

console.log('ok: gpt image proxy contract');
