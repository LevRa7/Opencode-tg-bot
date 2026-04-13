import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildLocalFileFollowUpCaption,
  createLocalFileFollowUpTracker,
  extractLocalFilePaths,
  prepareLocalFileFollowUps,
  resolveTelegramFileKind,
} from "../../../src/bot/utils/telegram-local-file-follow-up.js";

const mockedFs = vi.hoisted(() => ({
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  stat: mockedFs.stat,
}));

describe("bot/utils/telegram-local-file-follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts unique local file paths from raw paths and supported local URI formats", () => {
    // Что тестируем:
    // - функцию extractLocalFilePaths
    // - свойство: она находит raw absolute paths, file:// и sandbox:/ ссылки,
    //   убирает дубликаты и сохраняет порядок первого появления.
    // Положительный результат:
    // - в ответе только уникальные локальные absolute paths в порядке появления.
    expect(
      extractLocalFilePaths(
        [
          "Artifacts:",
          "`/tmp/report.txt`",
          "[same file](file:///tmp/report.txt)",
          "sandbox:/home/me/output/image.png,",
          '"/home/me/output/image.png"',
          "See also file:///var/data/video.mp4.",
        ].join("\n"),
      ),
    ).toEqual(["/tmp/report.txt", "/home/me/output/image.png", "/var/data/video.mp4"]);
  });

  it("ignores non-file urls and relative paths", () => {
    // Что тестируем:
    // - свойство фильтрации: HTTP/TG ссылки и относительные пути не считаются локальными файлами.
    // Положительный результат:
    // - остаются только абсолютные локальные пути.
    expect(
      extractLocalFilePaths(
        [
          "https://example.com/file.png",
          "tg://login?token=123",
          "./relative.txt",
          "../up-one.mp3",
          "sandbox://not-local/file.txt",
          "/tmp/keep.me",
        ].join("\n"),
      ),
    ).toEqual(["/tmp/keep.me"]);
  });

  it("resolves Telegram media type from file extension", () => {
    // Что тестируем:
    // - функцию resolveTelegramFileKind
    // - свойство: известные расширения маршрутизируются в правильный Telegram media API.
    // Положительный результат:
    // - image/audio/video/document определяются предсказуемо.
    expect(resolveTelegramFileKind("/tmp/file.png")).toBe("photo");
    expect(resolveTelegramFileKind("/tmp/file.mp3")).toBe("audio");
    expect(resolveTelegramFileKind("/tmp/file.mp4")).toBe("video");
    expect(resolveTelegramFileKind("/tmp/file.pdf")).toBe("document");
  });

  it("formats local file reference as HTML monospace caption", () => {
    // Что тестируем:
    // - функцию buildLocalFileFollowUpCaption
    // - свойство: путь экранируется и оборачивается в HTML monospace для Telegram.
    // Положительный результат:
    // - caption содержит корректный <code>...</code> блок.
    expect(buildLocalFileFollowUpCaption("/tmp/a&b<1>.png")).toBe(
      "<code>/tmp/a&amp;b&lt;1&gt;.png</code>",
    );
  });

  it("keeps only existing files up to 20 MB and deduplicates repeated links", async () => {
    // Что тестируем:
    // - функцию prepareLocalFileFollowUps
    // - свойства: файл должен существовать, быть обычным файлом, быть <= 20 МБ,
    //   повторяющиеся ссылки не дублируются.
    // Положительный результат:
    // - возвращается только один допустимый файл с корректным типом и caption.
    mockedFs.stat.mockImplementation(async (filePath: string) => {
      if (filePath === "/tmp/ok.png") {
        return { isFile: () => true, size: 20 * 1024 * 1024 };
      }

      if (filePath === "/tmp/too-large.mp4") {
        return { isFile: () => true, size: 20 * 1024 * 1024 + 1 };
      }

      if (filePath === "/tmp/folder") {
        return { isFile: () => false, size: 100 };
      }

      throw new Error("missing");
    });

    const result = await prepareLocalFileFollowUps(
      [
        "file:///tmp/ok.png",
        "/tmp/ok.png",
        "sandbox:/tmp/too-large.mp4",
        "sandbox:/tmp/folder",
        "(/tmp/missing.txt).",
      ].join("\n"),
    );

    expect(result).toEqual([
      {
        path: "/tmp/ok.png",
        resolvedPath: "/tmp/ok.png",
        kind: "photo",
        size: 20 * 1024 * 1024,
        caption: "<code>/tmp/ok.png</code>",
      },
    ]);
  });

  it("supports resolving container-visible paths to host-visible files", async () => {
    mockedFs.stat.mockImplementation(async (filePath: string) => {
      if (filePath === "/home/me/Workspaces/tg-42/state/tg-cli/data/login.qr.png") {
        return { isFile: () => true, size: 512 };
      }

      throw new Error("missing");
    });

    const result = await prepareLocalFileFollowUps(
      "/state/tg-cli/data/login.qr.png",
      (filePath) =>
        filePath.replace(
          "/state",
          "/home/me/Workspaces/tg-42/state",
        ),
    );

    expect(result).toEqual([
      {
        path: "/state/tg-cli/data/login.qr.png",
        resolvedPath: "/home/me/Workspaces/tg-42/state/tg-cli/data/login.qr.png",
        kind: "photo",
        size: 512,
        caption: "<code>/state/tg-cli/data/login.qr.png</code>",
      },
    ]);
  });

  it("tracks sent and in-flight paths per session to prevent duplicate follow-ups", () => {
    const tracker = createLocalFileFollowUpTracker();

    expect(tracker.reserve("session-1", ["/tmp/a.txt", "/tmp/a.txt", "/tmp/b.txt"]))
      .toEqual(["/tmp/a.txt", "/tmp/b.txt"]);
    expect(tracker.reserve("session-1", ["/tmp/a.txt", "/tmp/c.txt"]))
      .toEqual(["/tmp/c.txt"]);

    tracker.markSent("session-1", ["/tmp/a.txt"]);
    tracker.release("session-1", ["/tmp/b.txt", "/tmp/c.txt"]);

    expect(tracker.reserve("session-1", ["/tmp/a.txt", "/tmp/b.txt", "/tmp/c.txt"]))
      .toEqual(["/tmp/b.txt", "/tmp/c.txt"]);
    expect(tracker.reserve("session-2", ["/tmp/a.txt"])).toEqual(["/tmp/a.txt"]);
  });

  it("clears tracker state for a session", () => {
    const tracker = createLocalFileFollowUpTracker();

    expect(tracker.reserve("session-1", ["/tmp/a.txt"])).toEqual(["/tmp/a.txt"]);
    tracker.clearSession("session-1");

    expect(tracker.reserve("session-1", ["/tmp/a.txt"])).toEqual(["/tmp/a.txt"]);
  });
});
