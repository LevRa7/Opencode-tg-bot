const SECRET_KEY_PATTERN = /(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|ACCESS_KEY)[A-Z0-9_]*|api-key)/i;
const SECRET_ASSIGNMENT_PATTERN = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi;
const SECRET_CLI_EQUALS_PATTERN = /(--(?:token|secret|password|pass|api-key|access-key))=([^\s]+)/gi;
const SECRET_CLI_SPACE_PATTERN = /(--(?:token|secret|password|pass|api-key|access-key))\s+([^\s]+)/gi;
const SECRET_STRUCTURED_QUOTED_PATTERN = /(["'])([^"']+)\1\s*:\s*(["'])([^"']+)\3/gi;
const AUTHORIZATION_HEADER_PATTERN = /\b(authorization)\s*:\s*([^\n\r]+)/gi;
const COOKIE_HEADER_PATTERN = /\b((?:set-)?cookie)\s*:\s*([^\n\r]+)/gi;
const SECRET_HEADER_PATTERN = /\b((?:x-)?api-key|token)\s*:\s*([^\s]+)/gi;
const SECRET_UNQUOTED_COLON_PATTERN = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*:\s*([^\s]+)/gi;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/gi;
const STANDALONE_TOKEN_PATTERN = /\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g;

export function redactSecrets(text: string): string {
  return text
    .replace(PRIVATE_KEY_BLOCK_PATTERN, "[REDACTED PRIVATE KEY]")
    .replace(URL_CREDENTIAL_PATTERN, "$1[REDACTED]$3")
    .replace(STANDALONE_TOKEN_PATTERN, "[REDACTED]")
    .replace(SECRET_CLI_EQUALS_PATTERN, "$1=[REDACTED]")
    .replace(SECRET_CLI_SPACE_PATTERN, "$1 [REDACTED]")
    .replace(SECRET_STRUCTURED_QUOTED_PATTERN, (match, openKeyQuote: string, key: string, valueQuote: string) =>
      SECRET_KEY_PATTERN.test(key) ? `${openKeyQuote}${key}${openKeyQuote}: ${valueQuote}[REDACTED]${valueQuote}` : match,
    )
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
    .replace(SECRET_UNQUOTED_COLON_PATTERN, "$1: [REDACTED]")
    .replace(AUTHORIZATION_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(COOKIE_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(SECRET_HEADER_PATTERN, "$1: [REDACTED]");
}
