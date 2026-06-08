import { realpath, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "./reasoning-format.js";

const MAX_FOLLOW_UP_FILE_SIZE_BYTES = 2048 * 1024 * 1024;
const MAX_FOLLOW_UP_CAPTION_LENGTH = 900;

const PHOTO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".flac", ".ogg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm"]);
const LOCAL_FILE_REFERENCE_PATTERN = /(?:file:\/\/\/[^\s'"`<>]+|sandbox:\/[^\s'"`<>]+|(?:(?<=^)|(?<=[\s'"`(\[]))\/(?:[^\s'"`<>]+(?:\.[^\s'"`<>./]+)?)(?=$|[\s'"`)\]]|[.,;!?]))/gm;

// Что делает этот модуль:
// - находит в ответе ассистента абсолютные локальные пути,
// - фильтрует только реальные файлы размером до 2048 МБ,
// - заранее определяет правильный Telegram media type и caption.
// Почему выбрано это решение:
// - вся подготовка follow-up вложений сосредоточена в одном utility,
//   чтобы orchestration слой только отправлял уже готовые данные.
// Исправлено:
// - вместо legacy QR-специфичной логики появился общий путь для локальных файлов.
// Цель:
// - отправлять найденные файлы следующим сообщением без дублирования логики по проекту.

export type TelegramFileKind = "photo" | "audio" | "video" | "document";

export interface PreparedLocalFileFollowUp {
  path: string;
  resolvedPath?: string;
  kind: TelegramFileKind;
  size: number;
  caption: string;
}

interface LocalFileFollowUpSessionState {
  sentPaths: Set<string>;
  inFlightPaths: Set<string>;
}

export interface LocalFileFollowUpTracker {
  reserve(sessionId: string, filePaths: Iterable<string>): string[];
  markSent(sessionId: string, filePaths: Iterable<string>): void;
  release(sessionId: string, filePaths: Iterable<string>): void;
  clearSession(sessionId: string): void;
  clearAll(): void;
}

function normalizeLocalFileReference(rawReference: string): string | null {
  const normalizedReference = rawReference.trim().replace(/^['"`(\[]+|['"`\]).,;!?]+$/g, "");

  if (!normalizedReference) {
    return null;
  }

  if (normalizedReference.startsWith("file://")) {
    try {
      const normalizedPath = fileURLToPath(new URL(normalizedReference));
      return normalizedPath.startsWith("//") ? null : normalizedPath;
    } catch {
      return null;
    }
  }

  if (normalizedReference.startsWith("sandbox:/")) {
    const sandboxPath = normalizedReference.slice("sandbox:".length);
    return sandboxPath.startsWith("//") ? null : sandboxPath;
  }

  if (!normalizedReference.startsWith("/") || normalizedReference.startsWith("//")) {
    return null;
  }

  return normalizedReference;
}

export function extractLocalFilePaths(text: string): string[] {
  // Что делает этот код:
  // - извлекает из текста абсолютные локальные пути и file/sandbox ссылки,
  // - нормализует их в локальный absolute path,
  // - убирает дубликаты,
  // - сохраняет порядок первого появления.
  // Почему выбрано это решение:
  // - follow-up должен оставаться предсказуемым: один и тот же путь отправляется один раз
  //   и в том порядке, в котором ассистент впервые сослался на файл.
  if (!text) {
    return [];
  }

  const matches = text.match(LOCAL_FILE_REFERENCE_PATTERN) ?? [];
  const unique = new Map<string, string>();

  for (const rawMatch of matches) {
    const normalizedPath = normalizeLocalFileReference(rawMatch);
    if (!normalizedPath) {
      continue;
    }

    if (!unique.has(normalizedPath)) {
      unique.set(normalizedPath, normalizedPath);
    }
  }

  return [...unique.values()];
}

export function resolveTelegramFileKind(filePath: string): TelegramFileKind {
  // Что делает этот код:
  // - определяет Telegram media API по расширению файла.
  // Почему выбрано это решение:
  // - тип вложения лучше вычислить заранее, чтобы в момент отправки не анализировать файл повторно.
  const extension = extname(filePath).toLowerCase();

  if (PHOTO_EXTENSIONS.has(extension)) {
    return "photo";
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  return "document";
}

export function buildLocalFileFollowUpCaption(filePath: string): string {
  // Что делает этот код:
  // - готовит HTML monospace caption с экранированием спецсимволов.
  // Почему выбрано это решение:
  // - пользователь просил показывать ссылку на файл в monospace,
  //   а HTML-caption уже используется как безопасный Telegram-формат.
  const normalizedPath = filePath.trim();
  const displayPath =
    normalizedPath.length > MAX_FOLLOW_UP_CAPTION_LENGTH
      ? `${normalizedPath.slice(0, MAX_FOLLOW_UP_CAPTION_LENGTH - 3)}...`
      : normalizedPath;

  return `<code>${escapeHtml(displayPath)}</code>`;
}

export async function prepareLocalFileFollowUpsFromPaths(
  filePaths: Iterable<string>,
  resolveLocalFilePath?: (filePath: string) => string | null,
  isResolvedLocalFilePathAllowed?: (resolvedPath: string) => Promise<boolean> | boolean,
): Promise<PreparedLocalFileFollowUp[]> {
  const prepared: PreparedLocalFileFollowUp[] = [];

  for (const filePath of filePaths) {
    const resolvedPath = resolveLocalFilePath ? resolveLocalFilePath(filePath) : filePath;
    if (!resolvedPath) {
      continue;
    }

    try {
      if (isResolvedLocalFilePathAllowed && !(await isResolvedLocalFilePathAllowed(resolvedPath))) {
        continue;
      }

      const fileStat = await stat(resolvedPath);
      if (!fileStat.isFile()) {
        continue;
      }

      if (fileStat.size > MAX_FOLLOW_UP_FILE_SIZE_BYTES) {
        continue;
      }

      prepared.push({
        path: filePath,
        resolvedPath,
        kind: resolveTelegramFileKind(filePath),
        size: fileStat.size,
        caption: buildLocalFileFollowUpCaption(filePath),
      });
    } catch {
      continue;
    }
  }

  return prepared;
}

export async function prepareLocalFileFollowUps(
  text: string,
  resolveLocalFilePath?: (filePath: string) => string | null,
  isResolvedLocalFilePathAllowed?: (resolvedPath: string) => Promise<boolean> | boolean,
): Promise<PreparedLocalFileFollowUp[]> {
  // Что делает этот код:
  // - превращает текст ответа в список готовых follow-up вложений.
  // Положительный сценарий:
  // - остаются только существующие обычные файлы размером не больше 20 МБ.
  // Исправлено:
  // - oversized/missing/non-file пути отбрасываются до стадии Telegram API,
  //   чтобы не засорять асинхронную очередь follow-up отправок.
  return await prepareLocalFileFollowUpsFromPaths(
    extractLocalFilePaths(text),
    resolveLocalFilePath,
    isResolvedLocalFilePathAllowed,
  );
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = targetPath.replace(/[\\/]+$/g, "");
  const normalizedRoot = rootPath.replace(/[\\/]+$/g, "");

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

export async function isRealPathInsideRoot(targetPath: string, rootPath: string): Promise<boolean> {
  const [resolvedTarget, resolvedRoot] = await Promise.all([realpath(targetPath), realpath(rootPath)]);
  return isPathInsideRoot(resolvedTarget, resolvedRoot);
}

class InMemoryLocalFileFollowUpTracker implements LocalFileFollowUpTracker {
  private readonly states = new Map<string, LocalFileFollowUpSessionState>();

  reserve(sessionId: string, filePaths: Iterable<string>): string[] {
    if (!sessionId) {
      return [];
    }

    const state = this.getOrCreateState(sessionId);
    const reserved: string[] = [];
    const seenInBatch = new Set<string>();

    for (const filePath of filePaths) {
      if (!filePath || seenInBatch.has(filePath)) {
        continue;
      }
      seenInBatch.add(filePath);

      if (state.sentPaths.has(filePath) || state.inFlightPaths.has(filePath)) {
        continue;
      }

      state.inFlightPaths.add(filePath);
      reserved.push(filePath);
    }

    return reserved;
  }

  markSent(sessionId: string, filePaths: Iterable<string>): void {
    if (!sessionId) {
      return;
    }

    const state = this.getOrCreateState(sessionId);
    for (const filePath of filePaths) {
      if (!filePath) {
        continue;
      }

      state.sentPaths.add(filePath);
      state.inFlightPaths.delete(filePath);
    }
  }

  release(sessionId: string, filePaths: Iterable<string>): void {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    for (const filePath of filePaths) {
      state.inFlightPaths.delete(filePath);
    }

    this.pruneState(sessionId, state);
  }

  clearSession(sessionId: string): void {
    this.states.delete(sessionId);
  }

  clearAll(): void {
    this.states.clear();
  }

  private getOrCreateState(sessionId: string): LocalFileFollowUpSessionState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: LocalFileFollowUpSessionState = {
      sentPaths: new Set<string>(),
      inFlightPaths: new Set<string>(),
    };
    this.states.set(sessionId, created);
    return created;
  }

  private pruneState(sessionId: string, state: LocalFileFollowUpSessionState): void {
    if (state.sentPaths.size === 0 && state.inFlightPaths.size === 0) {
      this.states.delete(sessionId);
    }
  }
}

export function createLocalFileFollowUpTracker(): LocalFileFollowUpTracker {
  return new InMemoryLocalFileFollowUpTracker();
}
