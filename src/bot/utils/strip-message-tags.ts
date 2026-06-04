const METADATA_TAG_RE = /^(?:\s*\[[^\]]*\]\s*)*/;

export function stripMessageTags(text: string): string {
  return text.replace(METADATA_TAG_RE, "").trim();
}
