// Shared fetch helpers for Portal B (management). Coordinator-owned file —
// do not edit; page owners consume these helpers.

export class ApiError extends Error {
  status: number;
  /** Machine-readable reason when the API supplies one (e.g. `cancel_required`). */
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    is_active: boolean;
    created_at: string;
  };
  portalRole: string | null;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Fetch against the portal API. `/api/*` is rewritten to the portal backend
 * (http://127.0.0.1:3102) by the Next dev server, so paths are relative.
 * Throws `ApiError(message, status)` on non-2xx.
 */
export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    const code =
      data && typeof data === 'object' && 'code' in data && typeof (data as { code?: unknown }).code === 'string'
        ? (data as { code: string }).code
        : undefined;
    throw new ApiError(message, res.status, code);
  }

  return data as T;
}

/**
 * Clear the session cookie. By default the caller is sent to the portal login
 * page; pass `null` to stay put (e.g. to keep an inline error message visible
 * after rejecting a non-portal account).
 */
export async function apiLogout(redirect: string | null = '/manage/login'): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    // best effort — the cookie is cleared client-side anyway below
  }
  if (redirect && typeof window !== 'undefined') {
    window.location.assign(redirect);
  }
}
