function normalizeExternalUserInputText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function extractExternalUserInputText(event: {
  properties?: {
    info?: {
      parts?: Array<{ type?: string; text?: string }>;
    };
  };
}): string | null {
  const parts = event.properties?.info?.parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();

  return text ? text : null;
}

export function formatExternalUserInputMessage(text: string, label: string): string {
  return `${label}\n${normalizeExternalUserInputText(text)}`;
}
