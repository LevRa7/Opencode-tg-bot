#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const rootDir = process.cwd();
const customRoot = resolve(rootDir, "custom-patches");
const customFilesRoot = resolve(customRoot, "files");
const backupRoot = resolve(customRoot, ".backup");
const backupFilesRoot = resolve(backupRoot, "files");
const backupManifestPath = resolve(backupRoot, "manifest.json");
const action = process.argv[2] ?? "apply";
const validActions = new Set(["apply", "disable"]);

const managedFiles = [
  "src/settings/manager.ts",
  "src/thread/manager.ts",
  "src/bot/index.ts",
  "src/bot/commands/definitions.ts",
  "src/bot/commands/restart.ts",
  "src/bot/commands/projects.ts",
  "src/bot/commands/sessions.ts",
  "src/bot/commands/new.ts",
  "src/bot/commands/start.ts",
  "src/bot/commands/commands.ts",
  "src/bot/handlers/prompt.ts",
  "src/bot/handlers/question.ts",
  "src/bot/handlers/permission.ts",
  "src/bot/handlers/video.ts",
  "src/bot/utils/send-with-markdown-fallback.ts",
  "src/bot/utils/telegram-text.ts",
  "src/bot/utils/send-tts-response.ts",
  "src/i18n/en.ts",
  "src/i18n/de.ts",
  "src/i18n/es.ts",
  "src/i18n/fr.ts",
  "src/i18n/ru.ts",
  "src/i18n/zh.ts",
];

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run patch:custom",
      "  npm run patch:custom -- apply",
      "  npm run patch:custom -- disable",
      "",
      "Actions:",
      "  apply    Save current managed files as backup and copy custom snapshots into place",
      "  disable  Restore the backup created by the last apply",
    ].join("\n") + "\n",
  );
}

function ensureFileExists(filePath, label) {
  if (!existsSync(filePath)) {
    process.stderr.write(`${label} not found: ${filePath}\n`);
    process.exit(1);
  }
}

function ensureManagedSnapshotsExist() {
  for (const relativePath of managedFiles) {
    ensureFileExists(resolve(customFilesRoot, relativePath), "Custom snapshot");
  }
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function readBackupManifest() {
  ensureFileExists(backupManifestPath, "Backup manifest");
  return JSON.parse(readFileSync(backupManifestPath, "utf8"));
}

function isBackupPresent() {
  return existsSync(backupManifestPath);
}

function applySnapshots() {
  if (isBackupPresent()) {
    process.stdout.write("Custom patch is already applied. Run `npm run patch:custom -- disable` first if needed.\n");
    return;
  }

  ensureManagedSnapshotsExist();

  rmSync(backupRoot, { recursive: true, force: true });
  mkdirSync(backupFilesRoot, { recursive: true });

  const manifest = {
    createdAt: new Date().toISOString(),
    managedFiles: [],
  };

  for (const relativePath of managedFiles) {
    const targetPath = resolve(rootDir, relativePath);
    const snapshotPath = resolve(customFilesRoot, relativePath);
    const backupPath = resolve(backupFilesRoot, relativePath);
    const existed = existsSync(targetPath);

    ensureParentDir(backupPath);
    if (existed) {
      copyFileSync(targetPath, backupPath);
    }

    ensureParentDir(targetPath);
    copyFileSync(snapshotPath, targetPath);

    manifest.managedFiles.push({
      path: relativePath,
      existed,
    });
  }

  writeFileSync(backupManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write("Applied custom bot snapshots.\n");
}

function disableSnapshots() {
  if (!isBackupPresent()) {
    process.stdout.write("Custom patch is already disabled.\n");
    return;
  }

  const manifest = readBackupManifest();
  const entries = Array.isArray(manifest.managedFiles) ? manifest.managedFiles : [];

  for (const entry of entries) {
    const relativePath = entry.path;
    const targetPath = resolve(rootDir, relativePath);
    const backupPath = resolve(backupFilesRoot, relativePath);

    if (entry.existed) {
      ensureFileExists(backupPath, "Backup file");
      ensureParentDir(targetPath);
      copyFileSync(backupPath, targetPath);
      continue;
    }

    rmSync(targetPath, { force: true });
  }

  rmSync(backupRoot, { recursive: true, force: true });
  process.stdout.write("Restored files from custom patch backup.\n");
}

if (action === "-h" || action === "--help") {
  printUsage();
  process.exit(0);
}

if (!validActions.has(action)) {
  process.stderr.write(`Unknown action: ${action}\n`);
  printUsage();
  process.exit(2);
}

if (!existsSync(customRoot)) {
  process.stderr.write(`custom-patches directory not found: ${customRoot}\n`);
  process.exit(1);
}

if (!existsSync(customFilesRoot) || readdirSync(customFilesRoot).length === 0) {
  process.stderr.write(`No custom snapshots found in: ${customFilesRoot}\n`);
  process.exit(1);
}

if (action === "apply") {
  applySnapshots();
} else {
  disableSnapshots();
}
