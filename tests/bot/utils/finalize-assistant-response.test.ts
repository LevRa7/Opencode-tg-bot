import { describe, expect, it, vi } from "vitest";
import { finalizeAssistantResponse } from "../../../src/bot/utils/finalize-assistant-response.js";

type PreparedLocalFileFollowUp = {
  path: string;
  resolvedPath?: string;
  kind: "photo" | "audio" | "video" | "document";
  size: number;
  caption: string;
};

describe("bot/utils/finalize-assistant-response", () => {
  it("flushes pending state, sends formatted text parts, and returns local file follow-ups from raw source text", async () => {
    // Что тестируем:
    // - функцию finalizeAssistantResponse
    // - свойства: основная отправка текста работает как раньше,
    //   а кандидаты на follow-up файлы собираются из сырого исходного текста.
    // Положительный результат:
    // - текст отправлен по частям,
    // - возвращён список follow-up файлов,
    // - источник для follow-up — raw source text.
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const prepareLocalFileFollowUps = vi
      .fn<(_: string) => Promise<PreparedLocalFileFollowUp[]>>()
      .mockResolvedValue([
        {
          path: "/tmp/report.png",
          resolvedPath: "/tmp/report.png",
          kind: "photo",
          size: 100,
          caption: "<code>/tmp/report.png</code>",
        },
      ]);

    const result = await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "final reply",
      sourceText: "See file: /tmp/report.png",
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["part 1", "part 2"]),
      formatRawSummary: vi.fn(() => ["part 1", "part 2"]),
      resolveFormat: vi.fn(() => "markdown_v2" as const),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      prepareLocalFileFollowUps,
      sendText,
    });

    expect(flushDraftStream).toHaveBeenCalledWith("s1");
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(prepareLocalFileFollowUps).toHaveBeenCalledWith("See file: /tmp/report.png");
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(
      1,
      "part 1",
      "part 1",
      { reply_markup: { keyboard: [[{ text: "A" }]] } },
      "markdown_v2",
    );
    expect(sendText).toHaveBeenNthCalledWith(
      2,
      "part 2",
      "part 2",
      { reply_markup: { keyboard: [[{ text: "A" }]] } },
      "markdown_v2",
    );
    expect(result.followUpFiles).toEqual([
      {
        path: "/tmp/report.png",
        resolvedPath: "/tmp/report.png",
        kind: "photo",
        size: 100,
        caption: "<code>/tmp/report.png</code>",
      },
    ]);
  });

  it("sends reply without keyboard when none is available", async () => {
    // Что тестируем:
    // - базовый happy path без клавиатуры.
    // Положительный результат:
    // - reply отправляется одним сообщением,
    // - follow-up кандидаты по умолчанию пустые.
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);

    const result = await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "reply",
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["reply"]),
      formatRawSummary: vi.fn(() => ["reply"]),
      resolveFormat: vi.fn(() => "raw" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      sendText,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("reply", "reply", undefined, "raw");
    expect(result.followUpFiles).toEqual([]);
  });

  it("skips follow-up file preparation when callback is not provided", async () => {
    // Что тестируем:
    // - отсутствие optional callback для follow-up файлов.
    // Положительный результат:
    // - текст всё равно отправляется,
    // - follow-up список пустой.
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);

    const result = await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "reply",
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["reply"]),
      formatRawSummary: vi.fn(() => ["reply"]),
      resolveFormat: vi.fn(() => "raw" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      sendText,
    });

    expect(sendText).toHaveBeenCalledWith("reply", "reply", undefined, "raw");
    expect(result.followUpFiles).toEqual([]);
  });

  it("still sends final chunks and prepares follow-up files only once", async () => {
    // Что тестируем:
    // - режим chunks + follow-up preparation.
    // Положительный результат:
    // - chunk отправляется как и раньше,
    // - follow-up подготовка вызывается ровно один раз для всего ответа.
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const prepareLocalFileFollowUps = vi.fn().mockResolvedValue([]);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "final",
      sourceText: "/tmp/final.png",
      chunks: ["final"],
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["final"]),
      formatRawSummary: vi.fn(() => ["final"]),
      resolveFormat: vi.fn(() => "html" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      prepareLocalFileFollowUps,
      sendText,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("final", undefined, undefined, "html");
    expect(prepareLocalFileFollowUps).toHaveBeenCalledTimes(1);
    expect(prepareLocalFileFollowUps).toHaveBeenCalledWith("/tmp/final.png");
  });

  it("still sends final chunks when draft previously failed", async () => {
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "final",
      chunks: ["final"],
      draftFailed: true,
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["final"]),
      formatRawSummary: vi.fn(() => ["final"]),
      resolveFormat: vi.fn(() => "html" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      sendText,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("final", undefined, undefined, "html");
  });

  it("does not treat thinking service messages as transient final response replacements", async () => {
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "<blockquote expandable><b>Done</b></blockquote>",
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["<blockquote expandable><b>Done</b></blockquote>"]),
      formatRawSummary: vi.fn(() => ["Done"]),
      resolveFormat: vi.fn(() => "html" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      sendText,
    });

    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      "<blockquote expandable><b>Done</b></blockquote>",
      undefined,
      undefined,
      "html",
    );
  });

  it("sends one-part html final response verbatim without reformatting it as plain text", async () => {
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const html =
      "<blockquote expandable><b>Исправил сообщения мыслей</b></blockquote>\n\n<blockquote expandable><b>Кратко</b></blockquote>";

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: html,
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["> *Исправил сообщения мыслей*", "> *Кратко*"]),
      formatRawSummary: vi.fn(() => ["> Исправил сообщения мыслей", "> Кратко"]),
      resolveFormat: vi.fn(() => "html" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      sendText,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(html, undefined, undefined, "html");
  });

  it("prefers raw source text over formatted html when preparing follow-up files", async () => {
    // Что тестируем:
    // - источник данных для поиска файлов.
    // Положительный результат:
    // - follow-up подготовка использует сырой текст, а не форматированный HTML.
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const prepareLocalFileFollowUps = vi.fn().mockResolvedValue([]);
    const formattedHtml =
      "<blockquote expandable><b>Artifacts</b></blockquote>\n\n<blockquote expandable><code>/tmp/formatted.png</code></blockquote>";
    const rawSourceText = "/tmp/raw-source.png";

    const result = await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: formattedHtml,
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => [formattedHtml]),
      formatRawSummary: vi.fn(() => [rawSourceText]),
      resolveFormat: vi.fn(() => "html" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      prepareLocalFileFollowUps,
      sendText,
      sourceText: rawSourceText,
    });

    expect(prepareLocalFileFollowUps).toHaveBeenCalledWith(rawSourceText);
    expect(sendText).toHaveBeenCalledWith(formattedHtml, undefined, undefined, "html");
    expect(result.followUpFiles).toEqual([]);
  });
});
