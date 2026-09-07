// Cross-app link to the Portal A (subscription showcase / purchase) frontend.
// The main API Hub app never creates accounts directly any more — self-service
// signup happens on the portal's plans page.
//
// Resolution order for the portal origin:
//   1. NEXT_PUBLIC_PORTAL_URL — explicit override when the portal is served
//      from a fixed origin (deploy/showcase).
//   2. The current request host, when it looks like a preview host of the
//      form `<port>-<session>.monkeycode-ai.live`: the sibling app is served
//      at `<other-port>-<session>.monkeycode-ai.live`, so the portal (local
//      dev port 3002) is derived from whatever host the main app is reached
//      through. This is what keeps "See plans & pricing" working in the
//      online preview without hardcoding a session-scoped hostname.
//   3. Local dev fallback: http://localhost:3002.
const PORTAL_DEV_PORT = 3002;

const PREVIEW_HOST_RE = /^(\d+)-(.+\.monkeycode-ai\.live)$/i;

export const PORTAL_PLANS_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3002/#pricing';

export function previewSiblingUrl(currentHost: string, targetPort: number): string | null {
  const match = PREVIEW_HOST_RE.exec(currentHost);
  if (!match) return null;
  return `https://${targetPort}-${match[2]}`;
}

// Runtime-safe (browser): same as PORTAL_PLANS_URL unless we are on a
// *.monkeycode-ai.live preview host, in which case the portal URL mirrors the
// current session instead of pointing at localhost.
export function portalPlansUrl(): string {
  if (process.env.NEXT_PUBLIC_PORTAL_URL) return PORTAL_PLANS_URL;
  if (typeof window !== 'undefined') {
    const origin = previewSiblingUrl(window.location.host, PORTAL_DEV_PORT);
    if (origin) return `${origin}/#pricing`;
  }
  return PORTAL_PLANS_URL;
}
