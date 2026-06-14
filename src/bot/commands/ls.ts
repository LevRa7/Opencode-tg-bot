import { CommandContext, Context, InlineKeyboard } from "grammy";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
} from "../handlers/inline-menu.js";
import { interactionManager } from "../../interaction/manager.js";
import { isForegroundBusy, replyBusyBlocked } from "../utils/busy-guard.js";
import { getCurrentProject, getVmRuntimeInfo } from "../../settings/manager.js";
import { sendDownloadedFile } from "../utils/send-downloaded-file.js";
import { formatFileSize } from "../utils/file-download.js";
import { getTenantBrowserRoots, isWithinAllowedTenantRoot, isAllowedTenantRoot } from "../utils/browser-roots.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { sshManager } from "../../utils/ssh-manager.js";

const CALLBACK_PREFIX = "ls:";
const CALLBACK_NAV_PREFIX = "ls:nav:";
const CALLBACK_FILE_PREFIX = "ls:file:";
const CALLBACK_DOWNLOAD_PREFIX = "ls:download:";
const CALLBACK_BACK_PREFIX = "ls:back:";
const CALLBACK_PAGE_PREFIX = "ls:pg:";
const PAGE_SEPARATOR = "|";
const MAX_ENTRIES_PER_PAGE = 8;
const MAX_BUTTON_LABEL_LENGTH = 64;

const sessionDirectories = new Map<number, string>();
const pathIndex = new Map<string, string>();
let pathCounter = 0;

interface LsEntry {
  name: string;
  fullPath: string;
  type: "file" | "directory";
}

interface FileDetails {
  name: string;
  fullPath: string;
  size: number;
  modified: Date;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateLabel(label: string, maxLen: number = MAX_BUTTON_LABEL_LENGTH): string {
  if (label.length <= maxLen) {
    return label;
  }
  return `${label.slice(0, Math.max(0, maxLen - 3))}...`;
}

function pathToDisplayPath(absolutePath: string): string {
  const roots = getTenantBrowserRoots();
  const home = roots.length > 0 ? roots[0] : os.homedir();
  if (absolutePath === home) {
    return "~";
  }
  if (absolutePath.startsWith(home + path.sep)) {
    return `~${absolutePath.slice(home.length)}`;
  }
  return absolutePath;
}

function pathToDisplayPathRemote(absolutePath: string, remoteHome: string): string {
  if (absolutePath === remoteHome) {
    return "~";
  }
  if (absolutePath.startsWith(remoteHome + "/")) {
    return `~${absolutePath.slice(remoteHome.length)}`;
  }
  return absolutePath;
}

function usesWindowsPath(filePath: string): boolean {
  return /^[A-Za-z]:[\\\/]/.test(filePath) || filePath.startsWith("\\\\");
}

function getPathApi(filePath: string): typeof path.posix {
  return usesWindowsPath(filePath) ? path.win32 : path.posix;
}

function joinPath(parentPath: string, childName: string): string {
  return getPathApi(parentPath).join(parentPath, childName);
}

function getBaseName(filePath: string): string {
  return getPathApi(filePath).basename(filePath);
}

function getParentPath(filePath: string): string {
  return getPathApi(filePath).dirname(filePath);
}

function getRootPath(filePath: string): string {
  return getPathApi(filePath).parse(filePath).root;
}

/**
 * Basic path traversal prevention for SSH remote paths.
 * Rejects paths containing `..` segments.
 */
function isSafeRemotePath(remotePath: string): boolean {
  const segments = remotePath.split("/");
  return !segments.includes("..");
}

function getProjectRoot(): string | null {
  return getCurrentProject()?.worktree ?? null;
}



function buildLsHeader(displayPath: string, totalCount: number, page: number, totalPages: number): string {
  let header = `📁 ${t("ls.header")}\n<code>${escapeHtml(displayPath)}</code>`;
  if (totalPages > 1) {
    header += `\n(${page + 1}/${totalPages})`;
  }
  header += `\n${t("ls.total", { count: totalCount })}`;
  return header;
}

function buildFileDetailsText(fileDetails: FileDetails): string {
  return (
    `📄 ${t("ls.file.header")}\n<code>${escapeHtml(fileDetails.name)}</code>\n` +
    `${t("commands.download.size")}: ${formatFileSize(fileDetails.size)}\n` +
    `${t("commands.download.modified")}: ${fileDetails.modified.toLocaleDateString()}`
  );
}

function encodePathForCallback(prefix: string, fullPath: string, reserveBytes: number = 0): string {
  const naive = `${prefix}${fullPath}`;
  if (Buffer.byteLength(naive, "utf-8") + reserveBytes <= 64) {
    return naive;
  }
  const key = `#${pathCounter++}`;
  pathIndex.set(key, fullPath);
  return `${prefix}${key}`;
}

function decodePathFromCallback(prefix: string, data: string): string | null {
  if (!data.startsWith(prefix)) {
    return null;
  }
  const raw = data.slice(prefix.length);
  if (raw.startsWith("#")) {
    return pathIndex.get(raw) ?? null;
  }
  return raw;
}

function encodePathWithPageCallback(prefix: string, fullPath: string, page: number): string {
  const pageSuffix = `${PAGE_SEPARATOR}${page}`;
  const reserveBytes = Buffer.byteLength(pageSuffix, "utf-8");
  const pathRef = encodePathForCallback(prefix, fullPath, reserveBytes);
  return `${pathRef}${pageSuffix}`;
}

function decodePathWithPageCallback(data: string, prefix: string): { path: string; page: number } | null {
  if (!data.startsWith(prefix)) {
    return null;
  }
  const payload = data.slice(prefix.length);
  const separatorIndex = payload.lastIndexOf(PAGE_SEPARATOR);
  if (separatorIndex < 0) {
    return null;
  }
  const pathRef = payload.slice(0, separatorIndex);
  const page = Number.parseInt(payload.slice(separatorIndex + 1), 10);
  if (Number.isNaN(page)) {
    return null;
  }
  const resolvedPath = pathRef.startsWith("#") ? (pathIndex.get(pathRef) ?? null) : pathRef;
  if (resolvedPath === null) {
    return null;
  }
  return { path: resolvedPath, page };
}

function encodePaginationCallback(currentPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_PAGE_PREFIX, currentPath, page);
}

function decodePaginationCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_PAGE_PREFIX);
}

function encodeFileCallback(fullPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_FILE_PREFIX, fullPath, page);
}

function decodeFileCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_FILE_PREFIX);
}

function encodeBackCallback(directoryPath: string, page: number): string {
  return encodePathWithPageCallback(CALLBACK_BACK_PREFIX, directoryPath, page);
}

function decodeBackCallback(data: string): { path: string; page: number } | null {
  return decodePathWithPageCallback(data, CALLBACK_BACK_PREFIX);
}

function isVmActive(userId: number): string | null {
  const vmInfo = getVmRuntimeInfo(userId);
  if (!vmInfo?.bridgeIp) return null;
  return vmInfo.bridgeIp;
}

function executeVmCommand(bridgeIp: string, cmd: string): string {
  return execSync(
    `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 opencode@${bridgeIp} '${cmd}'`,
    { encoding: "utf-8", timeout: 10_000 },
  ).trim();
}

async function scanDirectoryRemote(
  userId: number,
  dirPath: string,
  page: number = 0,
): Promise<
  | {
      entries: LsEntry[];
      totalCount: number;
      currentPath: string;
      displayPath: string;
      hasParent: boolean;
      page: number;
    }
  | { error: string }
> {
  try {
    if (!isSafeRemotePath(dirPath)) {
      return { error: t("ls.access_denied") };
    }
    const output = await sshManager.executeRemoteCommand(userId, `ls -1aFL "${dirPath}" 2>/dev/null`);
    const lines = output.split("\n").filter((l) => l.length > 0);

    const entries: LsEntry[] = [];
    for (const line of lines) {
      const name = line.endsWith("/") ? line.slice(0, -1) : line.replace(/[*@=|]$/, "");
      if (name === "." || name === "..") continue;

      const isDir = line.endsWith("/");
      entries.push({
        name,
        fullPath: dirPath.endsWith("/") ? `${dirPath}${name}` : `${dirPath}/${name}`,
        type: isDir ? "directory" : "file",
      });
    }

    entries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

    const totalPages = Math.max(1, Math.ceil(entries.length / MAX_ENTRIES_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = safePage * MAX_ENTRIES_PER_PAGE;

    const remoteHome = await sshManager.getRemoteHomeDir(userId);

    return {
      entries: entries.slice(startIndex, startIndex + MAX_ENTRIES_PER_PAGE),
      totalCount: entries.length,
      currentPath: dirPath,
      displayPath: pathToDisplayPathRemote(dirPath, remoteHome),
      hasParent: dirPath !== "/",
      page: safePage,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function scanDirectoryVm(
  bridgeIp: string,
  dirPath: string,
  page: number = 0,
): Promise<
  | {
      entries: LsEntry[];
      totalCount: number;
      currentPath: string;
      displayPath: string;
      hasParent: boolean;
      page: number;
    }
  | { error: string }
> {
  try {
    if (!isSafeRemotePath(dirPath)) {
      return { error: t("ls.access_denied") };
    }
    const output = executeVmCommand(bridgeIp, `ls -1aFL "${dirPath}" 2>/dev/null`);
    const lines = output.split("\n").filter((l) => l.length > 0);

    const entries: LsEntry[] = [];
    for (const line of lines) {
      const name = line.endsWith("/") ? line.slice(0, -1) : line.replace(/[*@=|]$/, "");
      if (name === "." || name === "..") continue;

      const isDir = line.endsWith("/");
      entries.push({
        name,
        fullPath: dirPath.endsWith("/") ? `${dirPath}${name}` : `${dirPath}/${name}`,
        type: isDir ? "directory" : "file",
      });
    }

    entries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

    const totalPages = Math.max(1, Math.ceil(entries.length / MAX_ENTRIES_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const remoteHome = executeVmCommand(bridgeIp, "echo $HOME");

    return {
      entries: entries.slice(safePage * MAX_ENTRIES_PER_PAGE, (safePage + 1) * MAX_ENTRIES_PER_PAGE),
      totalCount: entries.length,
      currentPath: dirPath,
      displayPath: pathToDisplayPathRemote(dirPath, remoteHome),
      hasParent: dirPath !== "/",
      page: safePage,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function scanDirectory(
  dirPath: string,
  page: number = 0,
  userId?: number,
): Promise<
  | {
      entries: LsEntry[];
      totalCount: number;
      currentPath: string;
      displayPath: string;
      hasParent: boolean;
      page: number;
    }
  | { error: string }
> {
  if (userId && sshManager.isSshActive(userId)) {
    return scanDirectoryRemote(userId, dirPath, page);
  }

  if (userId) {
    const vmIp = isVmActive(userId);
    if (vmIp) {
      return scanDirectoryVm(vmIp, dirPath, page);
    }
  }

  try {
    if (!isWithinAllowedTenantRoot(dirPath)) {
      return { error: t("ls.access_denied") };
    }
    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
    const entries: LsEntry[] = dirEntries
      .map((entry): LsEntry => ({
        name: entry.name,
        fullPath: joinPath(dirPath, entry.name),
        type: entry.isDirectory() ? "directory" : "file",
      }))
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      });
    const totalPages = Math.max(1, Math.ceil(entries.length / MAX_ENTRIES_PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = safePage * MAX_ENTRIES_PER_PAGE;
    return {
      entries: entries.slice(startIndex, startIndex + MAX_ENTRIES_PER_PAGE),
      totalCount: entries.length,
      currentPath: dirPath,
      displayPath: pathToDisplayPath(dirPath),
      hasParent: dirPath !== getRootPath(dirPath),
      page: safePage,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

function buildBrowseKeyboard(
  entries: LsEntry[],
  currentPath: string,
  hasParent: boolean,
  page: number,
  totalCount: number,
  isRemote: boolean,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(totalCount / MAX_ENTRIES_PER_PAGE));
  for (const entry of entries) {
    const label = truncateLabel(buildEntryLabel(entry));
    const callbackData =
      entry.type === "directory"
        ? encodePathForCallback(CALLBACK_NAV_PREFIX, entry.fullPath)
        : encodeFileCallback(entry.fullPath, page);
    keyboard.text(label, callbackData).row();
  }
  if (isRemote) {
    if (hasParent && currentPath !== "/") {
      keyboard.text(t("open.back"), encodePathForCallback(CALLBACK_NAV_PREFIX, getParentPath(currentPath))).row();
    }
  } else {
    if (hasParent && !isAllowedTenantRoot(currentPath)) {
      keyboard.text(t("open.back"), encodePathForCallback(CALLBACK_NAV_PREFIX, getParentPath(currentPath))).row();
    }
  }
  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text(t("open.prev_page"), encodePaginationCallback(currentPath, page - 1));
    }
    if (page < totalPages - 1) {
      keyboard.text(t("open.next_page"), encodePaginationCallback(currentPath, page + 1));
    }
    keyboard.row();
  }
  appendInlineMenuCancelButton(keyboard, "ls");
  return keyboard;
}

function buildEntryLabel(entry: LsEntry): string {
  return `${entry.type === "directory" ? "📁" : "📄"} ${entry.name}`;
}

function buildFileDetailsKeyboard(filePath: string, page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const parentPath = getParentPath(filePath);
  keyboard.text(t("ls.file.download"), encodePathForCallback(CALLBACK_DOWNLOAD_PREFIX, filePath));
  keyboard.text(t("ls.file.back"), encodeBackCallback(parentPath, page));
  keyboard.row();
  appendInlineMenuCancelButton(keyboard, "ls");
  return keyboard;
}

function hasBrowseActions(currentPath: string, hasParent: boolean, totalCount: number, isRemote: boolean): boolean {
  if (totalCount > 0) {
    return true;
  }
  if (isRemote) {
    return hasParent && currentPath !== "/";
  }
  return hasParent && !isAllowedTenantRoot(currentPath);
}

async function renderBrowseView(dirPath: string, page: number = 0, userId?: number) {
  const result = await scanDirectory(dirPath, page, userId);
  if ("error" in result) {
    return result;
  }
  const isRemote = !!userId && (sshManager.isSshActive(userId) || !!isVmActive(userId));
  const totalPages = Math.max(1, Math.ceil(result.totalCount / MAX_ENTRIES_PER_PAGE));
  return {
    text: buildLsHeader(result.displayPath, result.totalCount, result.page, totalPages),
    hasActions: hasBrowseActions(result.currentPath, result.hasParent, result.totalCount, isRemote),
    keyboard: buildBrowseKeyboard(
      result.entries,
      result.currentPath,
      result.hasParent,
      result.page,
      result.totalCount,
      isRemote,
    ),
  };
}

async function getFileDetailsRemote(userId: number, filePath: string): Promise<FileDetails | { error: string }> {
  try {
    if (!isSafeRemotePath(filePath)) {
      return { error: t("ls.access_denied") };
    }
    const statOutput = await sshManager.executeRemoteCommand(userId, `stat -c '%s %Y' "${filePath}" 2>/dev/null`);
    const parts = statOutput.trim().split(" ");
    if (parts.length < 2) {
      return { error: t("commands.download.not_file") };
    }
    const size = parseInt(parts[0], 10);
    const mtime = parseInt(parts[1], 10);
    if (isNaN(size) || isNaN(mtime)) {
      return { error: t("commands.download.not_file") };
    }
    return {
      name: path.posix.basename(filePath),
      fullPath: filePath,
      size,
      modified: new Date(mtime * 1000),
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function getFileDetailsVm(bridgeIp: string, filePath: string): Promise<FileDetails | { error: string }> {
  try {
    if (!isSafeRemotePath(filePath)) {
      return { error: t("ls.access_denied") };
    }
    const statOutput = executeVmCommand(bridgeIp, `stat -c '%s %Y' "${filePath}" 2>/dev/null`);
    const parts = statOutput.trim().split(" ");
    if (parts.length < 2) {
      return { error: t("commands.download.not_file") };
    }
    const size = parseInt(parts[0], 10);
    const mtime = parseInt(parts[1], 10);
    if (isNaN(size) || isNaN(mtime)) {
      return { error: t("commands.download.not_file") };
    }
    return {
      name: path.posix.basename(filePath),
      fullPath: filePath,
      size,
      modified: new Date(mtime * 1000),
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function getFileDetails(filePath: string, userId?: number): Promise<FileDetails | { error: string }> {
  if (userId && sshManager.isSshActive(userId)) {
    return getFileDetailsRemote(userId, filePath);
  }

  if (userId) {
    const vmIp = isVmActive(userId);
    if (vmIp) {
      return getFileDetailsVm(vmIp, filePath);
    }
  }

  try {
    if (!isWithinAllowedTenantRoot(filePath)) {
      return { error: t("ls.access_denied") };
    }
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return { error: t("commands.download.not_file") };
    }
    return {
      name: getBaseName(filePath),
      fullPath: filePath,
      size: stat.size,
      modified: stat.mtime,
    };
  } catch (error) {
    return {
      error: `${t("ls.scan_error")}: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function renderFileDetailsView(filePath: string, page: number, userId?: number) {
  const fileDetails = await getFileDetails(filePath, userId);
  if ("error" in fileDetails) {
    return fileDetails;
  }
  return {
    text: buildFileDetailsText(fileDetails),
    keyboard: buildFileDetailsKeyboard(fileDetails.fullPath, page),
  };
}

async function resolveInitialDirectory(userId?: number): Promise<string | null> {
  if (userId && sshManager.isSshActive(userId)) {
    const cachedDirectory = sessionDirectories.get(userId);
    if (cachedDirectory) {
      return cachedDirectory;
    }
    return sshManager.getRemoteHomeDir(userId);
  }

  if (userId) {
    const vmIp = isVmActive(userId);
    if (vmIp) {
      // Don't use cached directory for VM — it may be stale from
      // a previous non-VM session. Always query the VM directly.
      return executeVmCommand(vmIp, "echo $HOME");
    }
  }

  const roots = getTenantBrowserRoots();
  const rootDir = roots.length > 0 ? roots[0] : getProjectRoot();
  if (!rootDir) {
    return null;
  }
  if (userId) {
    const cachedDirectory = sessionDirectories.get(userId);
    if (cachedDirectory && isWithinAllowedTenantRoot(cachedDirectory)) {
      return cachedDirectory;
    }
  }
  return rootDir;
}

export function clearLsPathIndex(): void {
  pathIndex.clear();
  pathCounter = 0;
}

export function clearSessionDirectories(): void {
  sessionDirectories.clear();
}

export async function lsCommand(ctx: CommandContext<Context>): Promise<void> {
  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return;
  }
  clearLsPathIndex();
  const userId = ctx.from?.id;
  const isRemote = !!userId && sshManager.isSshActive(userId);
  const isVm = !!userId && !!isVmActive(userId);

  if (!isRemote && !isVm) {
    const roots = getTenantBrowserRoots();
    if (roots.length === 0) {
      await ctx.reply(t("bot.project_not_selected"));
      return;
    }
  }

  const args = typeof ctx.match === "string" ? ctx.match.trim() : undefined;
  const targetDir = args || (await resolveInitialDirectory(userId));
  if (!targetDir) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  if (!isRemote && !isVm) {
    if (!isWithinAllowedTenantRoot(targetDir)) {
      await ctx.reply(`\u274C ${t("ls.access_denied")}`);
      return;
    }
  } else {
    if (!isSafeRemotePath(targetDir)) {
      await ctx.reply(`\u274C ${t("ls.access_denied")}`);
      return;
    }
  }

  const view = await renderBrowseView(targetDir, 0, userId);
  if ("error" in view) {
    await ctx.reply(`❌ ${view.error}`);
    return;
  }
  if (ctx.from) {
    sessionDirectories.set(ctx.from.id, targetDir);
  }
  if (!view.hasActions) {
    await ctx.reply(view.text, { parse_mode: "HTML" });
    return;
  }
  const message = await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "ls",
      messageId: message.message_id,
    },
  });
}

async function navigateTo(ctx: Context, dirPath: string, page: number = 0): Promise<void> {
  const userId = ctx.from?.id;
  const view = await renderBrowseView(dirPath, page, userId);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }
  if (ctx.from) {
    sessionDirectories.set(ctx.from.id, dirPath);
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function showFileDetails(ctx: Context, filePath: string, page: number): Promise<void> {
  const userId = ctx.from?.id;
  const view = await renderFileDetailsView(filePath, page, userId);
  if ("error" in view) {
    await ctx.answerCallbackQuery({ text: view.error });
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
}

async function downloadRemoteFileAndClose(ctx: Context, filePath: string, userId: number): Promise<void> {
  await ctx.answerCallbackQuery({ text: t("commands.download.downloading") });
  try {
    const tmpDir = os.tmpdir();
    const fileName = path.posix.basename(filePath);
    const localTmp = path.join(tmpDir, `ssh-download-${userId}-${Date.now()}-${fileName}`);
    await sshManager.downloadRemoteFile(userId, filePath, localTmp);
    const downloaded = await sendDownloadedFile(ctx, localTmp, { announce: false });
    await fs.unlink(localTmp).catch(() => {});
    if (!downloaded) {
      return;
    }
  } catch (error) {
    logger.error("[Ls] Error downloading remote file:", error);
    await ctx.reply(`\u274C ${t("commands.download.error")}`);
    return;
  }
  clearActiveInlineMenu("ls_downloaded");
  clearLsPathIndex();
  await ctx.deleteMessage().catch(() => {});
}

async function downloadVmFileAndClose(ctx: Context, filePath: string, bridgeIp: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: t("commands.download.downloading") });
  try {
    const tmpDir = os.tmpdir();
    const fileName = path.posix.basename(filePath);
    const localTmp = path.join(tmpDir, `vm-download-${Date.now()}-${fileName}`);
    execSync(
      `scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null opencode@${bridgeIp}:"${filePath}" "${localTmp}"`,
      { encoding: "utf-8", stdio: "ignore", timeout: 30_000 },
    );
    const downloaded = await sendDownloadedFile(ctx, localTmp, { announce: false });
    await fs.unlink(localTmp).catch(() => {});
    if (!downloaded) {
      return;
    }
  } catch (error) {
    logger.error("[Ls] Error downloading VM file:", error);
    await ctx.reply(`\u274C ${t("commands.download.error")}`);
    return;
  }
  clearActiveInlineMenu("ls_downloaded");
  clearLsPathIndex();
  await ctx.deleteMessage().catch(() => {});
}

async function downloadFileAndClose(ctx: Context, filePath: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: t("commands.download.downloading") });
  const downloaded = await sendDownloadedFile(ctx, filePath, { announce: false });
  if (!downloaded) {
    return;
  }
  clearActiveInlineMenu("ls_downloaded");
  clearLsPathIndex();
  await ctx.deleteMessage().catch(() => {});
}

function isAccessAllowed(targetPath: string, userId: number | undefined): boolean {
  if (userId && sshManager.isSshActive(userId)) {
    return isSafeRemotePath(targetPath);
  }
  if (userId && isVmActive(userId)) {
    return isSafeRemotePath(targetPath);
  }
  return isWithinAllowedTenantRoot(targetPath);
}

export async function handleLsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(CALLBACK_PREFIX)) {
    return false;
  }
  if (isForegroundBusy()) {
    await replyBusyBlocked(ctx);
    return true;
  }
  const isActiveMenu = await ensureActiveInlineMenu(ctx, "ls");
  if (!isActiveMenu) {
    return true;
  }
  const userId = ctx.from?.id;
  const isRemote = !!userId && sshManager.isSshActive(userId);
  try {
    const navPath = decodePathFromCallback(CALLBACK_NAV_PREFIX, data);
    if (navPath !== null) {
      if (!isAccessAllowed(navPath, userId)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, navPath);
      return true;
    }
    const pageInfo = decodePaginationCallback(data);
    if (pageInfo !== null) {
      if (!isAccessAllowed(pageInfo.path, userId)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, pageInfo.path, pageInfo.page);
      return true;
    }
    const fileInfo = decodeFileCallback(data);
    if (fileInfo !== null) {
      if (!isAccessAllowed(fileInfo.path, userId)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await showFileDetails(ctx, fileInfo.path, fileInfo.page);
      return true;
    }
    const downloadPath = decodePathFromCallback(CALLBACK_DOWNLOAD_PREFIX, data);
    if (downloadPath !== null) {
      if (!isAccessAllowed(downloadPath, userId)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      if (isRemote && userId) {
        await downloadRemoteFileAndClose(ctx, downloadPath, userId);
      } else {
        const vmIp = userId ? isVmActive(userId) : null;
        if (vmIp) {
          await downloadVmFileAndClose(ctx, downloadPath, vmIp);
        } else {
          await downloadFileAndClose(ctx, downloadPath);
        }
      }
      return true;
    }
    const backInfo = decodeBackCallback(data);
    if (backInfo !== null) {
      if (!isAccessAllowed(backInfo.path, userId)) {
        await ctx.answerCallbackQuery({ text: t("ls.access_denied") });
        return true;
      }
      await navigateTo(ctx, backInfo.path, backInfo.page);
      return true;
    }
    return false;
  } catch (error) {
    logger.error("[Ls] Error handling callback:", error);
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") });
    return true;
  }
}
