import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getCurrentOpencodeRoute } from "../../opencode/client.js";
import { getWorkspacesRoot } from "../../runtime/paths.js";
import { sshManager } from "../../utils/ssh-manager.js";
import { logger } from "../../utils/logger.js";

const TMP_UPLOAD_DIR = "/tmp/opencode-tg-uploads";

const CONTAINER_UPLOADS_DIR = "/workspace/uploads";
const HOST_UPLOADS_DIR = "opencode-uploads";

function resolveDownloadPath(): string {
  return process.env.DOWNLOAD_PATH || path.join(os.homedir(), "Downloads");
}

function detectMimeFromExtension(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".7z": "application/x-7z-compressed",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".yaml": "application/x-yaml",
    ".yml": "application/x-yaml",
    ".js": "application/javascript",
    ".ts": "text/typescript",
    ".py": "text/x-python",
    ".java": "text/x-java",
    ".cpp": "text/x-c++src",
    ".c": "text/x-csrc",
    ".h": "text/x-chdr",
    ".html": "text/html",
    ".css": "text/css",
    ".sh": "application/x-sh",
    ".exe": "application/x-msdownload",
    ".dmg": "application/x-apple-diskimage",
    ".iso": "application/x-iso9660-image",
    ".apk": "application/vnd.android.package-archive",
    ".deb": "application/vnd.debian.binary-package",
    ".rpm": "application/x-rpm",
  };
  return mimeMap[ext] || null;
}

function detectMimeFromMagic(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  const header = buffer.subarray(0, 16);

  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return "image/png";
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return "image/gif";
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) return "image/webp";
  if (header[0] === 0x42 && header[1] === 0x4d) return "image/bmp";
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) return "application/pdf";
  if (header[0] === 0x50 && header[1] === 0x4b) {
    if (buffer.length > 30) {
      const nameHint = header.subarray(30).toString().toLowerCase();
      if (nameHint.includes("[content_types].xml") || buffer.subarray(0, 20).includes("word/") || buffer.subarray(0, 20).includes("xl/")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    return "application/zip";
  }
  if (header[0] === 0x1f && header[1] === 0x8b) return "application/gzip";
  if (header[0] === 0x52 && header[1] === 0x61 && header[2] === 0x72 && header[3] === 0x21) return "application/vnd.rar";
  if (buffer[0] === 0x25 && header[1] === 0x21 && header.slice(2, 6).toString() === "PS-Ad") return "application/postscript";
  if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) return "audio/mpeg";
  if (header[0] === 0xff && header[1] === 0xfb) return "audio/mpeg";
  if (header.slice(0, 4).toString() === "OggS") return "audio/ogg";
  if (header.slice(0, 4).toString() === "RIFF" && header.slice(8, 12).toString() === "WAVE") return "audio/wav";
  if (header.slice(0, 4).toString() === "RIFF" && header.slice(8, 12).toString() === "AVI") return "video/x-msvideo";
  if (header.slice(4, 12).toString() === "ftypmp4" || header.slice(4, 12).toString() === "ftypisom" || header.slice(4, 12).toString() === "ftypavc1") return "video/mp4";
  if (header.slice(4, 12).toString() === "ftypM4A ") return "audio/mp4";
  if (header.slice(4, 12).toString() === "ftypM4V ") return "video/mp4";
  if (header.slice(0, 4).toString() === "\x1a\x45\xdf\xa3") return "video/webm";
  if (header.slice(4, 8).toString() === "moov" || header.slice(4, 8).toString() === "mdat") return "video/quicktime";
  if (header[0] === 0x4d && header[1] === 0x5a) return "application/x-msdownload";
  if (header[0] === 0x7b) return "application/json";
  if (header[0] === 0x3c) {
    const str = header.toString().toLowerCase();
    if (str.includes("<html") || str.includes("<!doc")) return "text/html";
    if (str.includes("<?xml")) return "application/xml";
    if (str.includes("<svg")) return "image/svg+xml";
  }

  return null;
}

export function resolveMimeType(
  telegramMime: string | undefined,
  filename: string,
  buffer: Buffer,
): string {
  if (telegramMime && telegramMime.length > 0 && telegramMime !== "application/octet-stream") {
    return telegramMime;
  }

  const extMime = detectMimeFromExtension(filename);
  if (extMime) return extMime;

  const magicMime = detectMimeFromMagic(buffer);
  if (magicMime) return magicMime;

  return "application/octet-stream";
}

function formatTypeLabel(mimeType: string): string {
  const typeMap: Record<string, string> = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/gif": "GIF",
    "image/webp": "WebP",
    "image/bmp": "BMP",
    "image/svg+xml": "SVG",
    "video/mp4": "MP4",
    "video/x-msvideo": "AVI",
    "video/quicktime": "MOV",
    "video/x-matroska": "MKV",
    "video/webm": "WebM",
    "audio/mpeg": "MP3",
    "audio/mp4": "M4A",
    "audio/wav": "WAV",
    "audio/ogg": "OGG",
    "audio/flac": "FLAC",
    "application/pdf": "PDF",
    "application/zip": "ZIP",
    "application/gzip": "GZip",
    "application/vnd.rar": "RAR",
    "application/x-7z-compressed": "7z",
    "application/x-tar": "TAR",
    "application/json": "JSON",
    "application/xml": "XML",
    "application/x-yaml": "YAML",
    "text/html": "HTML",
    "text/css": "CSS",
    "text/plain": "Text",
    "text/csv": "CSV",
    "application/javascript": "JS",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "application/octet-stream": "Binary",
  };
  return typeMap[mimeType] || mimeType;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface SavedAttachment {
  absolutePath: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  typeLabel: string;
  sizeLabel: string;
}

async function uploadViaSsh(
  userId: number,
  buffer: Buffer,
  filename: string,
): Promise<SavedAttachment> {
  const remoteHome = await sshManager.getRemoteHomeDir(userId);

  await fs.mkdir(TMP_UPLOAD_DIR, { recursive: true });
  const localTmpPath = path.join(TMP_UPLOAD_DIR, filename);
  await fs.writeFile(localTmpPath, buffer);

  const conn = sshManager.getActiveConnection(userId);
  if (!conn) throw new Error("SSH connection lost");

  let remotePath: string;

  if (conn.deployTarget === "docker") {
    const containerName = `opencode-serve-tg-${userId}`;
    const containerUploadsDir = CONTAINER_UPLOADS_DIR;
    const remoteContainerPath = `${containerUploadsDir}/${filename}`;

    const remoteTmp = `/tmp/opencode-tg-upload-${userId}-${Date.now()}`;
    await new Promise<void>((resolve, reject) => {
      conn.client.sftp((err: any, sftp: any) => {
        if (err) return reject(err);
        sftp.fastPut(localTmpPath, remoteTmp, (e: any) => {
          if (e) return reject(e);
          resolve();
        });
      });
    });

    await sshManager.executeRemoteCommand(
      userId,
      `docker exec "${containerName}" mkdir -p "${containerUploadsDir}"`,
    );
    await sshManager.executeRemoteCommand(
      userId,
      `docker cp "${remoteTmp}" "${containerName}":"${remoteContainerPath}"`,
    );
    await sshManager.executeRemoteCommand(userId, `rm -f "${remoteTmp}"`).catch(() => {});
    remotePath = remoteContainerPath;
  } else {
    const uploadDir = `${remoteHome}/${HOST_UPLOADS_DIR}`;
    remotePath = `${uploadDir}/${filename}`;
    await sshManager.executeRemoteCommand(userId, `mkdir -p "${uploadDir}"`);
    await new Promise<void>((resolve, reject) => {
      conn.client.sftp((err: any, sftp: any) => {
        if (err) return reject(err);
        sftp.fastPut(localTmpPath, remotePath, (e: any) => {
          if (e) return reject(e);
          resolve();
        });
      });
    });
  }

  await fs.unlink(localTmpPath).catch(() => {});

  return {
    absolutePath: remotePath,
    filename,
    sizeBytes: buffer.length,
    mimeType: "",
    typeLabel: "",
    sizeLabel: "",
  };
}

async function saveLocal(
  buffer: Buffer,
  filename: string,
): Promise<SavedAttachment> {
  const downloadDir = resolveDownloadPath();
  await fs.mkdir(downloadDir, { recursive: true });
  const destPath = path.join(downloadDir, filename);
  await fs.writeFile(destPath, buffer);

  return {
    absolutePath: destPath,
    filename,
    sizeBytes: buffer.length,
    mimeType: "",
    typeLabel: "",
    sizeLabel: "",
  };
}

async function saveToVm(
  buffer: Buffer,
  filename: string,
): Promise<SavedAttachment> {
  const servedDir = process.env.FILE_SERVER_DIR || "/tmp/served-files";
  const baseUrl = (process.env.FILE_SERVER_BASE_URL || "http://localhost:8890").replace(/\/+$/, "");
  const safeName = path.posix.basename(filename.replace(/[\\/]+/g, "_"));
  const destPath = path.join(servedDir, safeName);
  const publicUrl = `${baseUrl}/${safeName}`;

  try {
    const { mkdirSync, copyFileSync, writeFileSync } = await import("node:fs");

    // Write buffer to served directory directly
    mkdirSync(servedDir, { recursive: true });
    writeFileSync(destPath, buffer);

    logger.debug("[Downloads] Served attachment for VM via HTTP", {
      url: publicUrl,
    });
    return {
      absolutePath: publicUrl,
      filename,
      sizeBytes: buffer.length,
      mimeType: "",
      typeLabel: "",
      sizeLabel: "",
    };
  } catch (error) {
    logger.error("[Downloads] Failed to serve attachment for VM, using local path", error);
    // Fallback to local save
    const downloadDir = resolveDownloadPath();
    await fs.mkdir(downloadDir, { recursive: true });
    const destPath = path.join(downloadDir, filename);
    await fs.writeFile(destPath, buffer);
    return {
      absolutePath: destPath,
      filename,
      sizeBytes: buffer.length,
      mimeType: "",
      typeLabel: "",
      sizeLabel: "",
    };
  }
}

async function saveToTenantWorkspace(
  buffer: Buffer,
  filename: string,
  tenantId: string,
): Promise<SavedAttachment> {
  const workspacesRoot = getWorkspacesRoot();
  const hostUploadsDir = path.join(workspacesRoot, tenantId, "workspace", "uploads");
  const hostDestPath = path.join(hostUploadsDir, filename);

  await fs.mkdir(hostUploadsDir, { recursive: true });
  await fs.writeFile(hostDestPath, buffer);

  return {
    absolutePath: path.posix.join(CONTAINER_UPLOADS_DIR, filename),
    filename,
    sizeBytes: buffer.length,
    mimeType: "",
    typeLabel: "",
    sizeLabel: "",
  };
}

export async function saveAttachment(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<SavedAttachment> {
  const route = getCurrentOpencodeRoute();
  const userId = route.userId;

  let saved: SavedAttachment;

  if (userId && sshManager.isSshActive(userId)) {
    saved = await uploadViaSsh(userId, buffer, filename);
  } else if (route.kind === "tenant" && route.tenantId) {
    saved = await saveToTenantWorkspace(buffer, filename, route.tenantId);
  } else if (route.kind === "vm" && userId) {
    saved = await saveToVm(buffer, filename);
  } else {
    saved = await saveLocal(buffer, filename);
  }

  saved.mimeType = mimeType || resolveMimeType(mimeType, filename, buffer);
  saved.typeLabel = formatTypeLabel(saved.mimeType);
  saved.sizeLabel = formatByteSize(saved.sizeBytes);

  return saved;
}

export function buildAttachmentsTag(attachments: SavedAttachment[]): string {
  if (attachments.length === 0) return "";

  const lines = attachments.map(
    (a) => `${a.absolutePath} (${a.typeLabel}, ${a.sizeLabel})`,
  );

  return `\n#ATTACHMENTS\n${lines.join("\n")}`;
}
