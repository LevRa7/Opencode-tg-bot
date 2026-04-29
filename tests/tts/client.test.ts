import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockTts = vi.hoisted(() => ({
  provider: "openai",
  apiUrl: "",
  apiKey: "",
  model: "gpt-4o-mini-tts",
  voice: "alloy",
}));

const googleSynthesizeSpeechMock = vi.hoisted(() => vi.fn());
const googleClientConstructorMock = vi.hoisted(() =>
  vi.fn(() => ({
    synthesizeSpeech: googleSynthesizeSpeechMock,
  })),
);

vi.mock("@google-cloud/text-to-speech", () => ({
  TextToSpeechClient: googleClientConstructorMock,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    tts: mockTts,
    telegram: { token: "test", allowedUserId: 0, proxyUrl: "" },
    opencode: {
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
      model: { provider: "test", modelId: "test" },
    },
    server: { logLevel: "error" },
    bot: {
      sessionsListLimit: 10,
      projectsListLimit: 10,
      commandsListLimit: 10,
      taskLimit: 10,
      locale: "en",
      serviceMessagesIntervalSec: 5,
      hideThinkingMessages: false,
      hideToolCallMessages: false,
      responseStreaming: true,
      messageFormatMode: "markdown",
    },
    files: { maxFileSizeKb: 100 },
    stt: {
      apiUrl: "",
      apiKey: "",
      model: "whisper-large-v3-turbo",
      language: "",
    },
  },
}));

import { isTtsConfigured, stripMarkdownForSpeech, synthesizeSpeech } from "../../src/tts/client.js";

describe("stripMarkdownForSpeech", () => {
  it("removes markdown syntax while preserving readable text", () => {
    expect(
      stripMarkdownForSpeech("# Title\n\nUse `npm test` and **check** [docs](https://example.com)."),
    ).toBe("Title\n\nUse npm test and check docs.");
  });
});

describe("isTtsConfigured", () => {
  beforeEach(() => {
    mockTts.provider = "openai";
    mockTts.apiUrl = "";
    mockTts.apiKey = "";
    mockTts.model = "gpt-4o-mini-tts";
    mockTts.voice = "alloy";
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when credentials are missing", () => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    expect(isTtsConfigured()).toBe(false);
  });

  it("returns true when credentials are set", () => {
    mockTts.apiUrl = "https://api.openai.com/v1";
    mockTts.apiKey = "sk-test-key";
    expect(isTtsConfigured()).toBe(true);
  });

  it("returns true for google when application credentials are configured", () => {
    mockTts.provider = "google";
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/google-tts.json");

    expect(isTtsConfigured()).toBe(true);
  });

  it("returns false for google when application credentials are missing", () => {
    mockTts.provider = "google";

    expect(isTtsConfigured()).toBe(false);
  });
});

describe("synthesizeSpeech", () => {
  beforeEach(() => {
    mockTts.provider = "openai";
    mockTts.apiUrl = "https://api.openai.com/v1";
    mockTts.apiKey = "sk-test-key";
    mockTts.model = "gpt-4o-mini-tts";
    mockTts.voice = "alloy";
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    googleSynthesizeSpeechMock.mockReset();
    googleClientConstructorMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when TTS is not configured", async () => {
    mockTts.apiKey = "";

    await expect(synthesizeSpeech("hello")).rejects.toThrow("TTS is not configured");
  });

  it("sends a stripped OpenAI request and returns audio bytes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    const result = await synthesizeSpeech("Hello **world**");

    expect(result.filename).toBe("assistant-reply.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(options?.method).toBe("POST");
    expect((options?.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk-test-key",
    );
    expect((options?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(options?.body))).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: "Hello world",
      response_format: "mp3",
    });
  });

  it("sends a stripped Google TTS request and returns audio bytes", async () => {
    mockTts.provider = "google";
    mockTts.voice = "en-US-Standard-A";
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/google-tts.json");
    googleSynthesizeSpeechMock.mockResolvedValue([
      {
        audioContent: Uint8Array.from([4, 5, 6]),
      },
    ]);

    const result = await synthesizeSpeech("# Title\n\nRead [docs](https://example.com)");

    expect(result.filename).toBe("assistant-reply.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.buffer).toEqual(Buffer.from([4, 5, 6]));
    expect(googleClientConstructorMock).toHaveBeenCalledOnce();
    expect(googleSynthesizeSpeechMock).toHaveBeenCalledWith({
      input: { text: "Title\n\nRead docs" },
      voice: { name: "en-US-Standard-A" },
      audioConfig: { audioEncoding: "MP3" },
    });
  });

  it("uses the provider-specific Google voice default", async () => {
    mockTts.provider = "google";
    mockTts.voice = "en-US-Standard-A";
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/google-tts.json");
    googleSynthesizeSpeechMock.mockResolvedValue([
      {
        audioContent: Uint8Array.from([7, 8, 9]),
      },
    ]);

    await synthesizeSpeech("Hello from google");

    expect(googleSynthesizeSpeechMock).toHaveBeenCalledWith({
      input: { text: "Hello from google" },
      voice: { name: "en-US-Standard-A" },
      audioConfig: { audioEncoding: "MP3" },
    });
  });

  it("throws on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    await expect(synthesizeSpeech("Hello world")).rejects.toThrow(
      "TTS API returned HTTP 400: Bad request",
    );
  });
});
