// Cross-app link to the Portal A (subscription showcase / purchase) frontend.
// The main API Hub app never creates accounts directly any more — self-service
// signup happens on the portal's plans page. Override the default (local dev
// portal on :3002) with NEXT_PUBLIC_PORTAL_URL when the portal is served from
// a different origin (preview/deploy).
export const PORTAL_PLANS_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3002/#pricing';
