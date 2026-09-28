/**
 * Minimal API client. All requests go to same-origin /api (proxied to the
 * backend), with the session cookie and the per-session CSRF token.
 */
let csrfToken: string | null = null;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function setCsrf(token: string | null) {
  csrfToken = token;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  if (json && typeof json === "object" && "csrfToken" in json) setCsrf((json as { csrfToken: string }).csrfToken);
  return json as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function withProfile(path: string, profileId?: string | null): string {
  if (!profileId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}profileId=${encodeURIComponent(profileId)}`;
}
