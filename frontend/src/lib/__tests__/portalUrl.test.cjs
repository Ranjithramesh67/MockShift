'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Mirrors frontend/src/lib/portalUrl.ts so a missed NEXT_PUBLIC_PORTAL_URL at
// build time cannot send a production visitor to localhost:3002.
const PORTAL_DEV_PORT = 3002;
const PREVIEW_HOST_RE = /^(\d+)-(.+\.monkeycode-ai\.live)$/i;

function previewSiblingUrl(currentHost, targetPort) {
  const match = PREVIEW_HOST_RE.exec(currentHost);
  if (!match) return null;
  return `https://${targetPort}-${match[2]}`;
}

function derivePortalOriginFromHost(host) {
  const preview = previewSiblingUrl(host, PORTAL_DEV_PORT);
  if (preview) return preview;
  const hostname = host.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;
  const parts = hostname.split('.');
  if (parts.length < 2) return `https://${hostname}`;
  const sub = parts[0];
  if (sub !== 'mockshift-portal' && (sub === 'mockshift' || sub === 'mockshift-admin')) {
    parts[0] = 'mockshift-portal';
  }
  return `https://${parts.join('.')}`;
}

test('preview sibling maps a monkeycode-ai.live host to the portal port', () => {
  assert.equal(
    previewSiblingUrl('3000-abc.monkeycode-ai.live', 3002),
    'https://3002-abc.monkeycode-ai.live'
  );
  assert.equal(previewSiblingUrl('mockshift.keerainnovations.com', 3002), null);
});

test('derivePortalOriginFromHost never returns localhost for a public host', () => {
  assert.equal(
    derivePortalOriginFromHost('mockshift.keerainnovations.com'),
    'https://mockshift-portal.keerainnovations.com'
  );
  assert.equal(
    derivePortalOriginFromHost('mockshift-admin.keerainnovations.com'),
    'https://mockshift-portal.keerainnovations.com'
  );
  assert.equal(
    derivePortalOriginFromHost('mockshift-portal.keerainnovations.com'),
    'https://mockshift-portal.keerainnovations.com'
  );
  assert.equal(derivePortalOriginFromHost('localhost:3000'), null);
});
