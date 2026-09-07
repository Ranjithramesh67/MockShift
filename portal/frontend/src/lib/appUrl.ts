// Cross-app link to the main API Hub app. Portal A is a public showcase; its
// "Open app" / "Sign in" CTAs point back at the running API Hub app.
//
// Resolution order for the app origin:
//   1. NEXT_PUBLIC_APP_URL — explicit override when the app is served from a
//      fixed origin (deploy/showcase).
//   2. The current request host, when it looks like a preview host of the
//      form `<port>-<session>.monkeycode-ai.live`: the sibling app is served
//      at `<other-port>-<session>.monkeycode-ai.live`, so the API Hub app
//      (local dev port 3000) is derived from whatever host the portal is
//      reached through. This is what keeps "Open app" pointing at the live
//      preview instead of a stale hardcoded session hostname.
//   3. Local dev fallback: http://localhost:3000.
import { headers } from 'next/headers';

const APP_DEV_PORT = 3000;

const PREVIEW_HOST_RE = /^(\d+)-(.+\.monkeycode-ai\.live)$/i;

export function previewSiblingUrl(currentHost: string, targetPort: number): string | null {
  const match = PREVIEW_HOST_RE.exec(currentHost);
  if (!match) return null;
  return `https://${targetPort}-${match[2]}`;
}

// Server-only: resolves the sibling API Hub app origin for the current request.
export function apiHubAppUrl(): string {
  const override = process.env.NEXT_PUBLIC_APP_URL;
  if (override) return override.replace(/\/+$/, '');
  const host = headers().get('host') || '';
  const origin = previewSiblingUrl(host, APP_DEV_PORT);
  if (origin) return origin;
  return 'http://localhost:3000';
}
