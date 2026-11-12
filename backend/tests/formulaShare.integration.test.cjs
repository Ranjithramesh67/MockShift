'use strict';

// Formula share links (migration 065): a snapshot of a custom formula that
// anyone with the unguessable token can read, then import onto their account.
//
//  - PUT still accepts multiline code (the create form is a code editor);
//  - POST /api/profile/formula-snippets/share snapshots title+code and returns
//    a token + /s/formula/:token url;
//  - GET /api/formula-shares/:token is public (no login) and returns the
//    snapshot, not a live pointer to the owner's later edits;
//  - POST /api/profile/formula-snippets/import copies the snapshot onto the
//    caller's account; unknown tokens 404; accounts stay isolated.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin } = require('./support/harness.cjs');

let base;
let closeApp;

const MULTILINE = [
  'const stamp = $utils.formatDate($utils.now(), "YYYY-MM-DD");',
  'req.body.stamp = stamp;',
  'req.body.id = $utils.uuid();',
].join('\n');

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;
});

after(async () => {
  if (closeApp) await closeApp();
});

test('PUT accepts multiline formula code', async () => {
  const { client } = await signupAndLogin(base, 'formula-ml@test.io', 'formulaml12345', 'Formula ML');
  const saved = await client.api('PUT', '/api/profile/formula-snippets', {
    snippets: [{ title: 'Stamp and id', code: MULTILINE }],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.snippets[0].code, MULTILINE);
  assert.equal(saved.json.snippets[0].code.includes('\n'), true);
});

test('share creates a public snapshot that survives later edits', async () => {
  const { client } = await signupAndLogin(base, 'formula-share@test.io', 'formulashare123', 'Formula Share');
  await client.api('PUT', '/api/profile/formula-snippets', {
    snippets: [{ title: 'Original', code: MULTILINE }],
  });

  const shared = await client.api('POST', '/api/profile/formula-snippets/share', {
    title: 'Original',
    code: MULTILINE,
  });
  assert.equal(shared.status, 201, JSON.stringify(shared.json));
  assert.ok(shared.json.share && shared.json.share.token, JSON.stringify(shared.json));
  assert.equal(shared.json.share.url, `/s/formula/${shared.json.share.token}`);
  assert.equal(shared.json.share.snippet.title, 'Original');
  assert.equal(shared.json.share.snippet.code, MULTILINE);

  await client.api('PUT', '/api/profile/formula-snippets', {
    snippets: [{ title: 'Original', code: 'req.body.changed = true' }],
  });

  const anon = makeClient(base);
  const pub = await anon.api('GET', `/api/formula-shares/${shared.json.share.token}`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(pub.json.snippet.title, 'Original');
  assert.equal(pub.json.snippet.code, MULTILINE);
});

test('import copies a shared formula onto another account', async () => {
  const a = await signupAndLogin(base, 'formula-from@test.io', 'formulafrom123', 'From');
  const b = await signupAndLogin(base, 'formula-to@test.io', 'formulato12345', 'To');

  const shared = await a.client.api('POST', '/api/profile/formula-snippets/share', {
    title: 'Shared stamp',
    code: MULTILINE,
    description: 'Adds stamp + uuid',
  });
  assert.equal(shared.status, 201, JSON.stringify(shared.json));

  const imported = await b.client.api('POST', '/api/profile/formula-snippets/import', {
    token: shared.json.share.token,
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.json));
  assert.equal(imported.json.snippets.length, 1);
  assert.equal(imported.json.snippets[0].title, 'Shared stamp');
  assert.equal(imported.json.snippets[0].code, MULTILINE);

  const viaUrl = await b.client.api('POST', '/api/profile/formula-snippets/import', {
    url: `https://mockshift.example/s/formula/${shared.json.share.token}`,
  });
  assert.equal(viaUrl.status, 200, JSON.stringify(viaUrl.json));
  assert.equal(viaUrl.json.snippets.length, 1, 'duplicate import is a no-op');
});

test('share and import reject bad input; unknown token is 404', async () => {
  const { client } = await signupAndLogin(base, 'formula-badshare@test.io', 'formulabadshare', 'Bad Share');

  const missing = await client.api('POST', '/api/profile/formula-snippets/share', { title: 'Nope' });
  assert.equal(missing.status, 400, JSON.stringify(missing.json));

  const notFound = await client.api('POST', '/api/profile/formula-snippets/import', {
    token: '00000000-0000-4000-8000-000000000000',
  });
  assert.equal(notFound.status, 404, JSON.stringify(notFound.json));

  const anon = makeClient(base);
  const pub = await anon.api('GET', '/api/formula-shares/00000000-0000-4000-8000-000000000000');
  assert.equal(pub.status, 404);

  const unauthShare = await anon.api('POST', '/api/profile/formula-snippets/share', {
    title: 'X',
    code: '$utils.now()',
  });
  assert.equal(unauthShare.status, 401);
});
