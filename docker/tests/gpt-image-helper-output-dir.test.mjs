import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dockerRoot = path.resolve(new URL('../', import.meta.url).pathname);
const helperPath = path.join(dockerRoot, 'bin/opencode-gpt-image');
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-image-helper-test-'));
const workspaceDir = path.join(tmpDir, 'workspace');
const otherDir = path.join(tmpDir, 'other');
const proxyPort = 19127;

await fs.mkdir(workspaceDir);
await fs.mkdir(otherDir);

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ imageBase64: Buffer.from('png').toString('base64') }));
});

await new Promise((resolve) => server.listen(proxyPort, '127.0.0.1', resolve));

try {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [helperPath, 'generate', 'test prompt', 'relative-output.png'], {
      cwd: otherDir,
      env: {
        ...process.env,
        OPENCODE_GPT_IMAGE_PROXY_URL: `http://127.0.0.1:${proxyPort}`,
        GPT_IMAGE_OUTPUT_DIR: workspaceDir,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(workspaceDir, 'relative-output.png'));
  await fs.access(path.join(workspaceDir, 'relative-output.png'));
  await assert.rejects(fs.access(path.join(otherDir, 'relative-output.png')));
} finally {
  server.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
}

console.log('ok: gpt image helper writes relative outputs to workspace output dir');
