import type { ClientRunResponse, PreparedRunRequest } from './api';
import { isLocalHostname, isLocalUrl, maybeLocal } from './localHost';

// Re-exported so callers (WorkspaceStore) have a single import point.
export { isLocalHostname, isLocalUrl, maybeLocal };

// Requests targeting the caller's own machine (loopback / RFC1918 private /
// IPv6 unique-local addresses) can only work when executed from the caller's
// network. The MockShift server runs in the cloud, so "localhost" there is the
// server itself, not the user's laptop. Running such requests from the browser
// makes them reach the user's machine instead.

export interface BrowserRunOutcome {
  clientResponse: ClientRunResponse | null;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

const BINARY_CONTENT_TYPE_RE =
  /application\/pdf|image\/|audio\/|video\/|application\/octet-stream|application\/zip|application\/x-(?:zip|tar|gzip|7z|rar)/i;
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/**
 * Perform a prepared request from the browser. Never throws: network/CORS
 * failures are returned as an actionable `error` string, mirroring the
 * server-side runner so the response pane renders both the same way.
 */
export async function executeInBrowser(prepared: PreparedRunRequest): Promise<BrowserRunOutcome> {
  const startedAt = new Date().toISOString();
  const fetchStarted = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const method = (prepared.method || 'GET').toUpperCase();
    const res = await fetch(prepared.url, {
      method,
      headers: prepared.headers,
      body: BODYLESS_METHODS.has(method) ? undefined : prepared.body ?? undefined,
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    let body: string;
    let bodyEncoding: 'text' | 'base64' = 'text';
    if (BINARY_CONTENT_TYPE_RE.test(contentType)) {
      body = bytesToBase64(new Uint8Array(await res.arrayBuffer()));
      bodyEncoding = 'base64';
    } else {
      body = await res.text();
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      clientResponse: {
        status: res.status,
        statusText: res.statusText,
        headers,
        body,
        bodyEncoding,
        durationMs: Date.now() - fetchStarted,
      },
      error: null,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      clientResponse: null,
      error: describeBrowserError(err),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeBrowserError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Request timed out after 15000ms (browser)';
  }
  if (err instanceof TypeError) {
    return 'Failed to fetch from the browser — the local server may be down, or it may not allow cross-origin (CORS) requests. See the browser console for details.';
  }
  return err instanceof Error ? err.message : String(err);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    for (let j = i; j < end; j++) {
      binary += String.fromCharCode(bytes[j]);
    }
  }
  return btoa(binary);
}
