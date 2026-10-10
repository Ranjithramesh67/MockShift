'use strict';

// Regression: an undecryptable secret (wrong/rotated VAULT_KEY, corrupt value)
// must not abort the whole variable cascade. app.try_decrypt returns NULL, and
// app.resolve_variables uses it, so one bad secret no longer 500s a request.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, psql } = require('./support/harness.cjs');

const KEY = 'test-vault-key-do-not-use-in-prod';

let app;

before(async () => {
  app = await startApp();
});

after(async () => {
  if (app) await app.close();
});

test('app.try_decrypt returns NULL for corrupt data instead of raising', () => {
  const out = psql(
    `SET app.vault_key = '${KEY}';
     SELECT coalesce(app.try_decrypt('\\xdeadbeef'::bytea, '${KEY}'), '<NULL>') AS v;`
  );
  assert.match(out, /<NULL>/);
});

test('app.try_decrypt still decrypts valid ciphertext', () => {
  const out = psql(
    `SET app.vault_key = '${KEY}';
     SELECT app.try_decrypt(pgp_sym_encrypt('s3cr3t', '${KEY}'), '${KEY}') AS v;`
  );
  assert.match(out, /s3cr3t/);
});

test('resolve_variables tolerates a corrupt secret (returns NULL, does not throw)', () => {
  const out = psql(
    `SET app.vault_key = '${KEY}';
     DELETE FROM variables WHERE scope = 'GLOBAL' AND key IN ('ZZ_GOOD_SECRET', 'ZZ_BAD_SECRET');
     INSERT INTO variables (scope, key, is_secret, value_encrypted, value_plain) VALUES
       ('GLOBAL', 'ZZ_GOOD_SECRET', true, pgp_sym_encrypt('resolved-ok', current_setting('app.vault_key')), NULL),
       ('GLOBAL', 'ZZ_BAD_SECRET',  true, '\\xdeadbeef'::bytea, NULL);
     SELECT string_agg(key || '=' || coalesce(value, 'NULL'), ',' ORDER BY key) AS resolved
       FROM app.resolve_variables(NULL, NULL)
      WHERE key IN ('ZZ_GOOD_SECRET', 'ZZ_BAD_SECRET');`
  );
  assert.match(out, /ZZ_BAD_SECRET=NULL/);
  assert.match(out, /ZZ_GOOD_SECRET=resolved-ok/);
});
