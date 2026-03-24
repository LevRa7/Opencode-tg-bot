import type { FilePartInput, Model } from "@opencode-ai/sdk/v2";
import { getModelCapabilities, supportsInput } from "./capabilities.js";
import type { ModelInfo } from "./types.js";

export type MediaInputType = "image" | "video" | "pdf" | "audio";

export const MEDIA_FALLBACK_MODEL: Readonly<Pick<ModelInfo, "providerID" | "modelID">> = {
  providerID: "google",
  modelID: "gemini-3-flash-preview",
};

export interface ResolvedPromptModel {
  model?: Pick<ModelInfo, "providerID" | "modelID">;
  variant?: string;
  fallbackUsed: boolean;
  missingMediaSupport: boolean;
}

function getMediaInputTypeForMime(mimeType: string): MediaInputType | null {
  const normalizedMimeType = mimeType.trim().toLowerCase();

  if (!normalizedMimeType) {
    return null;
  }

  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }

  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }

  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }

  if (normalizedMimeType === "application/pdf") {
    return "pdf";
  }

  return null;
}

export function getRequiredMediaInputs(fileParts: FilePartInput[]): MediaInputType[] {
  const requiredInputs = new Set<MediaInputType>();

  for (const filePart of fileParts) {
    const inputType = getMediaInputTypeForMime(filePart.mime);
    if (inputType) {
      requiredInputs.add(inputType);
    }
  }

  return Array.from(requiredInputs);
}

function supportsAllRequiredInputs(
  capabilities: Model["capabilities"] | null,
  requiredInputs: MediaInputType[],
): boolean {
  return requiredInputs.every((inputType) => supportsInput(capabilities, inputType));
}

export async function resolvePromptModelForMedia(params: {
  storedModel: ModelInfo;
  fileParts: FilePartInput[];
  getCapabilities?: (providerID: string, modelID: string) => Promise<Model["capabilities"] | null>;
}): Promise<ResolvedPromptModel> {
  const { storedModel, fileParts } = params;
  const getCapabilities = params.getCapabilities ?? getModelCapabilities;
  const requiredInputs = getRequiredMediaInputs(fileParts);
  const hasStoredModel = storedModel.providerID.length > 0 && storedModel.modelID.length > 0;

  if (requiredInputs.length === 0) {
    return {
      model: hasStoredModel
        ? {
            providerID: storedModel.providerID,
            modelID: storedModel.modelID,
          }
        : undefined,
      variant: storedModel.variant,
      fallbackUsed: false,
      missingMediaSupport: false,
    };
  }

  if (hasStoredModel) {
    const storedCapabilities = await getCapabilities(storedModel.providerID, storedModel.modelID);
    if (supportsAllRequiredInputs(storedCapabilities, requiredInputs)) {
      return {
        model: {
          providerID: storedModel.providerID,
          modelID: storedModel.modelID,
        },
        variant: storedModel.variant,
        fallbackUsed: false,
        missingMediaSupport: false,
      };
    }
  }

  const fallbackCapabilities = await getCapabilities(
    MEDIA_FALLBACK_MODEL.providerID,
    MEDIA_FALLBACK_MODEL.modelID,
  );

  if (supportsAllRequiredInputs(fallbackCapabilities, requiredInputs)) {
    return {
      model: MEDIA_FALLBACK_MODEL,
      fallbackUsed: true,
      missingMediaSupport: false,
    };
  }

  return {
    model: hasStoredModel
      ? {
          providerID: storedModel.providerID,
          modelID: storedModel.modelID,
        }
      : undefined,
    variant: storedModel.variant,
    fallbackUsed: false,
    missingMediaSupport: true,
  };
}
