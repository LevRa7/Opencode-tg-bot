export function rewriteApiUrl(url: string): string {
  if (url.startsWith("/api/") || url.startsWith("/api?")) {
    return url.slice(4) || "/";
  }
  return url;
}

export function rewriteWsPath(path: string): string {
  let result = path;
  if (result.startsWith("/api/")) result = result.slice(4) || "/";
  if (result.endsWith("/ws")) result = result.slice(0, -3);
  return result;
}
