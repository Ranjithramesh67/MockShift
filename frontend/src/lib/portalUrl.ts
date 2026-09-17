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

// Runtime-safe (browser) portal *origin* (no path). Used to build the cross-app
// links on the profile page ("Manage subscription" -> /account, "Change plan"
// -> /checkout?plan=&cycle=). Resolution order mirrors the module comment.
function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0];
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

// When the portal env var was missed at build time, never send a visitor on a
// real HTTPS host to localhost:3002. On this product the portal lives at the
// `mockshift-portal` sibling of `mockshift` / `mockshift-admin`.
export function derivePortalOriginFromHost(host: string): string | null {
  const preview = previewSiblingUrl(host, PORTAL_DEV_PORT);
  if (preview) return preview;
  const hostname = host.split(':')[0];
  if (isLoopbackHost(hostname)) return null;
  const parts = hostname.split('.');
  if (parts.length < 2) return `https://${hostname}`;
  const sub = parts[0];
  if (sub !== 'mockshift-portal' && (sub === 'mockshift' || sub === 'mockshift-admin')) {
    parts[0] = 'mockshift-portal';
  }
  return `https://${parts.join('.')}`;
}

export function portalOrigin(): string {
  if (process.env.NEXT_PUBLIC_PORTAL_URL) {
    try {
      const u = new URL(process.env.NEXT_PUBLIC_PORTAL_URL);
      u.hash = '';
      u.search = '';
      const base = u.origin + u.pathname;
      return base.replace(/\/+$/, '') || u.origin;
    } catch {
      return process.env.NEXT_PUBLIC_PORTAL_URL;
    }
  }
  if (typeof window !== 'undefined') {
    const origin = derivePortalOriginFromHost(window.location.host);
    if (origin) return origin;
  }
  return `http://localhost:${PORTAL_DEV_PORT}`;
}

// Runtime-safe (browser) absolute URL on the Portal A origin, e.g.
// portalUrlFor('/account') or portalUrlFor('/checkout?plan=starter&cycle=MONTHLY').
export function portalUrlFor(path: string): string {
  const origin = portalOrigin();
  return origin + (path.startsWith('/') ? path : `/${path}`);
}

// Runtime-safe (browser): same as PORTAL_PLANS_URL unless we are on a
// *.monkeycode-ai.live preview host, in which case the portal URL mirrors the
// current session instead of pointing at localhost.
export function portalPlansUrl(): string {
  if (process.env.NEXT_PUBLIC_PORTAL_URL) return PORTAL_PLANS_URL;
  if (typeof window !== 'undefined') {
    const origin = derivePortalOriginFromHost(window.location.host);
    if (origin) return `${origin}/#pricing`;
  }
  return PORTAL_PLANS_URL;
}
