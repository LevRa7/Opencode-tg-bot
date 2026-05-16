const EXTERNAL_USER_INPUT_MAX_DISPLAY_LENGTH = 2000;

function truncateExternalUserInputText(text: string): string {
  if (text.length <= EXTERNAL_USER_INPUT_MAX_DISPLAY_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXTERNAL_USER_INPUT_MAX_DISPLAY_LENGTH - 3)}...`;
}

function normalizeExternalUserInputText(text: string): string {
  return truncateExternalUserInputText(text.trim().replace(/\s+/g, " "));
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
