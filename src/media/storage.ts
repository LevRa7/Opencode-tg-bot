import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimePaths, getWorkspacesRoot } from "../runtime/paths.js";
import type { MediaStorageOwner, StoredMediaFile, StoredMediaType } from "./types.js";

interface SaveIncomingMediaFileParams {
  owner: MediaStorageOwner;
  telegramFileId: string;
  originalFileName?: string;
  fallbackFileName: string;
  mimeType: string;
  mediaType: StoredMediaType;
  buffer: Buffer;
  now?: Date;
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

function sanitizeFileStem(value: string): string {
  const safeValue = sanitizePathSegment(value);
  return safeValue.length > 0 ? safeValue : "file";
}

function sanitizeExtension(value: string): string {
  const safeValue = sanitizePathSegment(value);
  return safeValue.length > 0 ? safeValue.toLowerCase() : "";
}

function splitFileNameParts(fileName: string): { stem: string; extension: string } {
  const baseName = path.basename(fileName);
  const parsedName = path.parse(baseName);

  return {
    stem: parsedName.name,
    extension: parsedName.ext.startsWith(".") ? parsedName.ext.slice(1) : parsedName.ext,
  };
}

function buildStoredFileName(params: {
  timestamp: string;
  telegramFileId: string;
  originalFileName?: string;
  fallbackFileName: string;
}): string {
  const sourceFileName = params.originalFileName ?? params.fallbackFileName;
  const { stem, extension } = splitFileNameParts(sourceFileName);
  const timestamp = params.timestamp.replace(/[:.]/g, "-");
  const safeTelegramFileId = sanitizeFileStem(params.telegramFileId);
  const safeStem = sanitizeFileStem(stem);
  const safeExtension = sanitizeExtension(extension);
  const fileName = `${timestamp}-${safeTelegramFileId}-${safeStem}`;

  return safeExtension.length > 0 ? `${fileName}.${safeExtension}` : fileName;
}

function isSafeTenantPathSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && path.basename(value) === value;
}

function resolveHostMediaRoot(owner: MediaStorageOwner): { hostRoot: string; runtimeRoot: string } {
  if (owner.runtimeKind === "tenant") {
    if (owner.tenantId.trim().length === 0) {
      throw new Error("Tenant media storage requires tenantId");
    }

    if (!isSafeTenantPathSegment(owner.tenantId)) {
      throw new Error("Tenant media storage requires a safe tenantId path segment");
    }

    const workspacesRoot = getWorkspacesRoot();
    return {
      hostRoot: path.join(workspacesRoot, owner.tenantId, "state", "media"),
      runtimeRoot: "/state/media",
    };
  }

  const runtimePaths = getRuntimePaths();
  const mediaRoot = path.join(runtimePaths.appHome, "media");
  return {
    hostRoot: mediaRoot,
    runtimeRoot: mediaRoot,
  };
}

export async function saveIncomingMediaFile(
  params: SaveIncomingMediaFileParams,
): Promise<StoredMediaFile> {
  const now = params.now ?? new Date();
  const fileName = buildStoredFileName({
    timestamp: now.toISOString(),
    telegramFileId: params.telegramFileId,
    originalFileName: params.originalFileName,
    fallbackFileName: params.fallbackFileName,
  });
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const { hostRoot, runtimeRoot } = resolveHostMediaRoot(params.owner);
  const relativeParts = [String(params.owner.userId), year, month, day, fileName];
  const hostAbsolutePath = path.join(hostRoot, ...relativeParts);
  const runtimeVisiblePath = params.owner.runtimeKind === "tenant"
    ? path.posix.join(runtimeRoot, ...relativeParts)
    : path.join(runtimeRoot, ...relativeParts);

  await fs.mkdir(path.dirname(hostAbsolutePath), { recursive: true });
  await fs.writeFile(hostAbsolutePath, params.buffer);

  return {
    hostAbsolutePath,
    runtimeVisiblePath,
    fileName,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.byteLength,
    mediaType: params.mediaType,
  };
}
