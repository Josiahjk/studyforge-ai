export function forwardedUrl(request: Request, path: string) {
  const headers = request.headers;
  const proto = headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "") || "http";
  const host = headers.get("x-forwarded-host") || headers.get("host") || new URL(request.url).host;
  return new URL(path, `${proto}://${host}`);
}
