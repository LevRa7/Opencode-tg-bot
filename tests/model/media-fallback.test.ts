import { describe, expect, it, vi } from "vitest";
import type { FilePartInput, Model } from "@opencode-ai/sdk/v2";
import {
  getRequiredMediaInputs,
  MEDIA_FALLBACK_MODEL,
  resolvePromptModelForMedia,
} from "../../src/model/media-fallback.js";

function createCapabilities(
  overrides: Partial<Model["capabilities"]["input"]>,
): Model["capabilities"] {
  return {
    temperature: true,
    reasoning: false,
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
      ...overrides,
    },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  };
}

describe("model/media-fallback", () => {
  it("extracts unique required media inputs from file parts", () => {
    const fileParts: FilePartInput[] = [
      {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: "data:image/jpeg;base64,AA==",
      },
      { type: "file", mime: "video/mp4", filename: "clip.mp4", url: "data:video/mp4;base64,AA==" },
      {
        type: "file",
        mime: "application/pdf",
        filename: "doc.pdf",
        url: "data:application/pdf;base64,AA==",
      },
      { type: "file", mime: "image/png", filename: "shot.png", url: "data:image/png;base64,AA==" },
    ];

    expect(getRequiredMediaInputs(fileParts)).toEqual(["image", "video", "pdf"]);
  });

  it("keeps the stored model when it supports required media", async () => {
    const getCapabilities = vi
      .fn()
      .mockImplementation(async (providerID: string, modelID: string) => {
        if (providerID === "openai" && modelID === "gpt-5.4") {
          return createCapabilities({ image: true });
        }

        return createCapabilities({ image: true, video: true, pdf: true, audio: true });
      });

    const resolved = await resolvePromptModelForMedia({
      storedModel: { providerID: "openai", modelID: "gpt-5.4", variant: "high" },
      fileParts: [
        {
          type: "file",
          mime: "image/jpeg",
          filename: "photo.jpg",
          url: "data:image/jpeg;base64,AA==",
        },
      ],
      getCapabilities,
    });

    expect(resolved).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.4" },
      variant: "high",
      fallbackUsed: false,
      missingMediaSupport: false,
    });
  });

  it("switches to Gemini fallback when stored model lacks required media support", async () => {
    const getCapabilities = vi
      .fn()
      .mockImplementation(async (providerID: string, modelID: string) => {
        if (providerID === "openai" && modelID === "gpt-5.4") {
          return createCapabilities({ image: false });
        }

        if (
          providerID === MEDIA_FALLBACK_MODEL.providerID &&
          modelID === MEDIA_FALLBACK_MODEL.modelID
        ) {
          return createCapabilities({ image: true });
        }

        return null;
      });

    const resolved = await resolvePromptModelForMedia({
      storedModel: { providerID: "openai", modelID: "gpt-5.4", variant: "high" },
      fileParts: [
        {
          type: "file",
          mime: "image/jpeg",
          filename: "photo.jpg",
          url: "data:image/jpeg;base64,AA==",
        },
      ],
      getCapabilities,
    });

    expect(resolved).toEqual({
      model: MEDIA_FALLBACK_MODEL,
      variant: undefined,
      fallbackUsed: true,
      missingMediaSupport: false,
    });
  });

  it("reports missing media support when neither stored model nor fallback can handle the attachment", async () => {
    const getCapabilities = vi
      .fn()
      .mockResolvedValue(createCapabilities({ image: false, video: false }));

    const resolved = await resolvePromptModelForMedia({
      storedModel: { providerID: "openai", modelID: "gpt-5.4", variant: "high" },
      fileParts: [
        {
          type: "file",
          mime: "video/mp4",
          filename: "clip.mp4",
          url: "data:video/mp4;base64,AA==",
        },
      ],
      getCapabilities,
    });

    expect(resolved).toEqual({
      model: { providerID: "openai", modelID: "gpt-5.4" },
      variant: "high",
      fallbackUsed: false,
      missingMediaSupport: true,
    });
  });
});
