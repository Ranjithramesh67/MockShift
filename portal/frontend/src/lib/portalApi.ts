// Shared fetch helpers for Portal B (management). Coordinator-owned file —
// do not edit; page owners consume these helpers.

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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
    throw new ApiError(message, res.status);
  }

  return data as T;
}

/** Clear the session cookie and send the user to the portal login page. */
export async function apiLogout(redirect = '/manage/login'): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    // best effort — the cookie is cleared client-side anyway below
  }
  if (typeof window !== 'undefined') {
    window.location.assign(redirect);
  }
}
