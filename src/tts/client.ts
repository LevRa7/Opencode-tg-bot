import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { toString } from "mdast-util-to-string";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const TTS_REQUEST_TIMEOUT_MS = 60_000;
const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

export interface TtsResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export function isTtsConfigured(): boolean {
  if (config.tts.provider === "google") {
    return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
  }

  return Boolean(config.tts.apiUrl && config.tts.apiKey);
}

export function stripMarkdownForSpeech(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  const tree = markdownProcessor.parse(normalized) as Root;

  return tree.children
    .map((node) => toString(node).trim())
    .filter(Boolean)
    .join("\n\n");
}

function createMp3Result(buffer: Buffer): TtsResult {
  return {
    buffer,
    filename: "assistant-reply.mp3",
    mimeType: "audio/mpeg",
  };
}

async function synthesizeOpenAiSpeech(input: string): Promise<TtsResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

  try {
    const url = `${config.tts.apiUrl}/audio/speech`;

    logger.debug(
      `[TTS] Sending OpenAI speech synthesis request: url=${url}, model=${config.tts.model}, voice=${config.tts.voice}, chars=${input.length}`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.tts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.tts.model,
        voice: config.tts.voice,
        input,
        response_format: "mp3",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`TTS API returned HTTP ${response.status}: ${errorBody || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("TTS API returned an empty audio response");
    }

    logger.debug(`[TTS] Generated OpenAI speech audio: ${buffer.length} bytes`);
    return createMp3Result(buffer);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TTS request timed out after ${TTS_REQUEST_TIMEOUT_MS}ms`);
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeGoogleSpeech(input: string): Promise<TtsResult> {
  logger.debug(
    `[TTS] Sending Google speech synthesis request: voice=${config.tts.voice}, chars=${input.length}`,
  );

  const client = new TextToSpeechClient();
  const [response] = await client.synthesizeSpeech({
    input: { text: input },
    voice: { name: config.tts.voice },
    audioConfig: { audioEncoding: "MP3" },
  });

  const audioContent = response.audioContent;
  const buffer = Buffer.isBuffer(audioContent)
    ? audioContent
    : audioContent instanceof Uint8Array
      ? Buffer.from(audioContent)
      : typeof audioContent === "string"
        ? Buffer.from(audioContent, "base64")
        : Buffer.alloc(0);

  if (buffer.length === 0) {
    throw new Error("Google TTS returned an empty audio response");
  }

  logger.debug(`[TTS] Generated Google speech audio: ${buffer.length} bytes`);
  return createMp3Result(buffer);
}

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  if (!isTtsConfigured()) {
    throw new Error("TTS is not configured: set TTS API credentials");
  }

  const input = stripMarkdownForSpeech(text);
  if (!input) {
    throw new Error("TTS input text is empty");
  }

  if (config.tts.provider === "google") {
    return synthesizeGoogleSpeech(input);
  }

  return synthesizeOpenAiSpeech(input);
}
