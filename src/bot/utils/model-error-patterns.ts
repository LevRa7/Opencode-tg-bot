const NON_MODEL_SESSION_ERROR_PATTERN =
  /context.{0,30}(length|size|too long|exceed|limit)/i;

const MODEL_UNAVAILABLE_PATTERNS: RegExp[] = [
  /forbidden/i,
  /unauthorized/i,
  /rate.?limit/i,
  /timeout/i,
  /upstream.*error/i,
  /bad.?gateway/i,
  /service.?unavailable/i,
  /not.?found/i,
  /not.?supported/i,
  /model.*not\s/i,
  /model.*unavailable/i,
  /invalid.*model/i,
  /unknown.*model/i,
  /request\sfailed/i,
  /auth.*error/i,
  /oauth.?2/i,
  /invalid.?request/i,
  /invalid.?credential/i,
  /client.?id/i,
  /could not determine/i,
  /provider.*returns?.*same.*error/i,
  /no\s+endpoints?\sfound/i,
  /endpoint/i,
  /tool.?use/i,
  /no\s+endpoint/i,
  /provider.?routing/i,
];

export function isModelUnavailableError(message: string): boolean {
  if (NON_MODEL_SESSION_ERROR_PATTERN.test(message)) {
    return false;
  }
  return MODEL_UNAVAILABLE_PATTERNS.some((p) => p.test(message));
}

const SSE_READ_TIMEOUT_PATTERN = /SSE read timed out/i;

export function isSseReadTimeoutError(message: string): boolean {
  return SSE_READ_TIMEOUT_PATTERN.test(message);
}
