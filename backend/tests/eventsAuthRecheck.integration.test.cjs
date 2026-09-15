'use strict';

// LOW-6 — an SSE room must be re-authorized while the connection is open, so a
// permission change (share revoked, membership removed) closes the stream
// instead of leaking events for the connection's lifetime.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let app;

before(async () => {
  process.env.REALTIME_AUTH_RECHECK_MS = '150';
  app = await startApp();
});

after(async () => {
  delete process.env.REALTIME_AUTH_RECHECK_MS;
  if (app) await app.close();
});

function sseReader(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async until(predicate, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const chunk = await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('SSE read timeout')), remaining);
          reader.read().then(
            (c) => {
              clearTimeout(t);
              resolve(c);
            },
            (e) => {
              clearTimeout(t);
              reject(e);
            }
          );
        });
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (predicate(buffer)) return buffer;
      }
      throw new Error(`SSE predicate not met. Buffer: ${buffer}`);
    },
  };
}

test('SSE stream closes when room access is revoked', async () => {
  // First signup becomes the platform ADMIN (global read); keep it out of the way.
  await signupAndLogin(app.base, 'sse-bootstrap@test.io', 'bootstrap123', 'Bootstrap');
  const owner = await signupAndLogin(app.base, 'sse-owner@test.io', 'sseowner123', 'SSE Owner');
  const other = await signupAndLogin(app.base, 'sse-other@test.io', 'sseother123', 'SSE Other');

  const workspaces = await owner.client.api('GET', '/api/workspaces');
  const workspaceId = workspaces.json.workspaces[0].id;
  const content = await owner.client.api('GET', `/api/workspaces/${workspaceId}/content`);
  const projectId = content.json.projects[0].id;
  const collection = await owner.client.api('POST', '/api/collections', { projectId, name: 'Live' });
  const collectionId = collection.json.collection.id;
  const created = await owner.client.api('POST', '/api/requests', { collectionId, name: 'Stream me' });
  const requestId = created.json.request.id;

  const otherWorkspaces = await other.client.api('GET', '/api/workspaces');
  const otherProjectId = (
    await other.client.api('GET', `/api/workspaces/${otherWorkspaces.json.workspaces[0].id}/content`)
  ).json.projects[0].id;

  const controller = new AbortController();
  try {
    const res = await fetch(`${app.base}/api/events?room=request:${requestId}`, {
      headers: { Cookie: owner.cookie },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    const sse = sseReader(res);
    await sse.until((b) => b.includes('connected'), 2000);

    // Move the collection into a project the owner cannot read -> access revoked.
    psql(`UPDATE collections SET project_id = '${otherProjectId}' WHERE id = '${collectionId}'`);

    const buffer = await sse.until((b) => b.includes('unauthorized'), 4000);
    assert.match(buffer, /"type":"unauthorized"/);
  } finally {
    controller.abort();
  }
});
