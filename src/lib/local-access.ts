type LocalAccessOptions = { requireOrigin?: boolean };

export function localAccessError(request: Request, { requireOrigin = false }: LocalAccessOptions = {}) {
  const host = request.headers.get("host")?.trim().toLowerCase() || "";
  if (!isLoopbackAuthority(host)) return "此服务仅允许从本机访问。";

  const origin = request.headers.get("origin")?.trim() || "";
  if (requireOrigin && !origin) return "请求来源无效。";
  if (origin) {
    try {
      const parsed = new URL(origin);
      const expectedOrigin = new URL(`${new URL(request.url).protocol}//${host}`).origin;
      if (!isLoopbackHostname(parsed.hostname) || parsed.origin !== expectedOrigin) {
        return "请求来源无效。";
      }
    } catch {
      return "请求来源无效。";
    }
  }
  return "";
}

function isLoopbackAuthority(authority: string) {
  try {
    return isLoopbackHostname(new URL(`http://${authority}`).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
