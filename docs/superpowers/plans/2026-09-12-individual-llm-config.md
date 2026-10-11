# Individual Bring-Your-Own LLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform-admin global toggle (default OFF) lets each individual user store their own encrypted LLM config; when ON, the copilot prefers the user's config, when OFF the UI is hidden and the copilot falls back to the server `USER_LLM_*` environment variables.

**Architecture:** Migration 041 adds `portal_settings.allow_individual_llm` (default false) and `user_llm_configs` (one encrypted key per user). `backend/src/api/llm.js` gains an async `resolveConfig({ userId })` that returns the user's decrypted config when the toggle is on, else the environment config; the key is encrypted with the existing `app.vault_key()` (`pgp_sym_encrypt`) and is never returned to clients. Copilot routes resolve config per request; `GET/PUT/DELETE /api/profile/llm` manage the user's config; admin endpoints flip the global toggle; the Profile page renders the config UI only when allowed.

**Tech Stack:** PostgreSQL 15 + pgcrypto (`pgp_sym_encrypt`/`pgp_sym_decrypt` with `app.vault_key()`), Express (CommonJS), Node `node:test`, Next.js 14 / React 18 / TypeScript.

## Global Constraints

- Never wipe the dev `apihub` DB on 5432. Integration suites run on the scratch cluster at port 5441: `PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub`.
- Migrations are append-only; latest is `039_organizations_identity.sql` (and `040_menu_settings.sql` if the menus plan ran first). Add `041_individual_llm.sql` only.
- The copilot stays BYO-key and project-scoped: it reads ONLY `USER_LLM_*` env vars and the user's own stored config. NEVER consult `MCAI_*`, `OPENAI_API_KEY`, `OPEN_CODE_API_KEY` or any other ambient credential.
- The API key must be encrypted at rest with `app.vault_key()` (the `VAULT_KEY` env var, set on the connection by `query(..., { userId })`). It must never be logged, returned in an HTTP response, or written to `ai_copilot_usage`.
- Backend CommonJS; raw SQL via `require('../db').query`. Backend connects as privileged `postgres` so RLS is bypassed; add RLS DDL for defense in depth anyway.
- Commits use Conventional Commits (e.g. `feat(llm): ...`). Do NOT add the `Co-authored-by` trailer manually. Never stage `docs/superpowers/` or `frontend/tsconfig.tsbuildinfo`.
- Do not run `next build` while the frontend dev server owns `.next`.

---

### Task 1: `user_llm_configs` migration + encrypted per-user resolver in `llm.js`

**Files:**
- Create: `db/migrations/041_individual_llm.sql`
- Modify: `backend/src/api/llm.js`
- Test: `backend/src/api/__tests__/llm.test.cjs`

**Interfaces:**
- Consumes: `query` from `backend/src/api/db.js`; `readConfig`, `PROVIDER_LABEL` (existing in `llm.js`).
- Produces (all from `llm.js`):
  - `validateUserConfig({ apiKey, baseUrl, model }) => { ok: true, value: {apiKey,baseUrl,model} } | { ok: false, error: string }`
  - `individualLlmAllowed() => Promise<boolean>`
  - `loadUserConfig(userId) => Promise<{ apiKey, baseUrl, model, configured: true, source: 'user' } | null>`
  - `resolveConfig({ userId, env }) => Promise<{ apiKey, baseUrl, model, configured, source: 'user'|'env'|'none', provider }>`
  - `describeResolved(cfg) => { configured, model, provider, source }`
  - `defaultCallModel({ ..., config })` now accepts an explicit `config` override.

- [ ] **Step 1: Write the migration**

Create `db/migrations/041_individual_llm.sql`:

```sql
-- ============================================================================
-- API Hub — 041_individual_llm.sql
-- Individual "bring your own LLM" configuration, gated by a platform-admin
-- global toggle.
--
--   portal_settings.allow_individual_llm (default FALSE) is the master switch.
--     false -> the per-user config UI is hidden and the copilot uses the
--              server USER_LLM_* environment variables only.
--     true  -> a user may store THEIR OWN OpenAI-compatible config, and the
--              copilot prefers it over the environment.
--
--   user_llm_configs stores exactly one config per user. The API key is
--   encrypted at rest with pgp_sym_encrypt(value, app.vault_key()); the key is
--   never returned to clients and never written to ai_copilot_usage.
-- ============================================================================

ALTER TABLE portal_settings
  ADD COLUMN allow_individual_llm boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN portal_settings.allow_individual_llm IS
  'Master switch for per-user LLM configuration. Default FALSE: individuals cannot bring their own key and the copilot uses USER_LLM_* only.';

CREATE TABLE user_llm_configs (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key_encrypted bytea NOT NULL,
  base_url          text NOT NULL,
  model             text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_llm_configs IS
  'One OpenAI-compatible LLM config per user. api_key_encrypted is pgp_sym_encrypt(apiKey, app.vault_key()); the key is never returned to clients.';

-- Defense in depth: a user may only read/write their own row. The app connects
-- as a privileged role today, so the real authorization is in the route.
ALTER TABLE user_llm_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_llm_configs_select ON user_llm_configs FOR SELECT
  USING (user_id = app.current_user_id());
CREATE POLICY user_llm_configs_insert ON user_llm_configs FOR INSERT
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY user_llm_configs_update ON user_llm_configs FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY user_llm_configs_delete ON user_llm_configs FOR DELETE
  USING (user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_llm_configs TO app_user;
```

- [ ] **Step 2: Add the resolver to `llm.js`**

In `backend/src/api/llm.js`, add this require at the top (after `'use strict';`):

```js
const { query } = require('./db');
```

Change the signature of `defaultCallModel` (line 77) to accept an explicit `config` and use it instead of reading the env:

```js
async function defaultCallModel({
  system,
  prompt,
  temperature,
  maxTokens,
  json = true,
  env,
  signal,
  timeoutMs,
  config,
} = {}) {
  const cfg = config || readConfig(env);
```

The rest of `defaultCallModel` is unchanged (`cfg.configured`, `cfg.model`, etc. already work).

Then add these functions just before the `// Injectable seam.` comment (line 153):

```js
// ------------------------------------------------------- per-user ("BYO") config
// Pure validation for a user-supplied OpenAI-compatible config.
function validateUserConfig({ apiKey, baseUrl, model } = {}) {
  const key = String(apiKey || '').trim();
  const base = String(baseUrl || '').trim();
  const name = String(model || '').trim();
  if (!key || key.length > 400) return { ok: false, error: 'A valid apiKey is required' };
  if (!/^https?:\/\/.+/i.test(base) || base.length > 300) {
    return { ok: false, error: 'baseUrl must be an http(s) URL' };
  }
  if (!name || name.length > 120) return { ok: false, error: 'A valid model name is required' };
  return { ok: true, value: { apiKey: key, baseUrl: base, model: name } };
}

// Global admin toggle (portal_settings single row; default false).
async function individualLlmAllowed() {
  const { rows } = await query(
    'SELECT allow_individual_llm FROM portal_settings ORDER BY id LIMIT 1'
  );
  return rows.length > 0 && rows[0].allow_individual_llm === true;
}

// Decrypt the caller's stored config. `query` with { userId } sets
// app.current_user_id AND app.vault_key on the connection so pgp_sym_decrypt
// can run. Returns null when absent or undecryptable (never throws).
async function loadUserConfig(userId) {
  if (!userId) return null;
  try {
    const { rows } = await query(
      `SELECT pgp_sym_decrypt(api_key_encrypted, app.vault_key())::text AS api_key,
              base_url, model
         FROM user_llm_configs WHERE user_id = $1`,
      [userId],
      { userId }
    );
    const row = rows[0];
    if (!row) return null;
    const apiKey = String(row.api_key || '').trim();
    const baseUrl = String(row.base_url || '').trim();
    const model = String(row.model || '').trim();
    if (!apiKey || !baseUrl || !model) return null;
    return { apiKey, baseUrl, model, configured: true, source: 'user', provider: PROVIDER_LABEL };
  } catch {
    return null;
  }
}

// Resolve the effective config for a request: the user's own config when the
// admin toggle is on, otherwise the server environment. Never consults any
// other ambient credential.
async function resolveConfig({ userId = null, env = process.env } = {}) {
  if (userId && (await individualLlmAllowed())) {
    const userCfg = await loadUserConfig(userId);
    if (userCfg) return userCfg;
  }
  const cfg = readConfig(env);
  return {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    configured: cfg.configured,
    source: cfg.configured ? 'env' : 'none',
    provider: cfg.configured ? PROVIDER_LABEL : null,
  };
}

// Safe-to-serve description of a resolved config: never includes the API key.
function describeResolved(cfg) {
  return {
    configured: Boolean(cfg && cfg.configured),
    model: (cfg && cfg.model) || null,
    provider: cfg && cfg.configured ? PROVIDER_LABEL : null,
    source: (cfg && cfg.source) || 'none',
  };
}
```

Update the `module.exports` block (line 169) to add the new functions:

```js
module.exports = {
  CONFIG_KEYS,
  PROVIDER_LABEL,
  LlmNotConfiguredError,
  LlmProviderError,
  readConfig,
  isConfigured,
  describeConfig,
  chatCompletionsUrl,
  defaultCallModel,
  setCallModel,
  resetCallModel,
  callModel,
  validateUserConfig,
  individualLlmAllowed,
  loadUserConfig,
  resolveConfig,
  describeResolved,
};
```

- [ ] **Step 3: Write the unit test**

Create `backend/src/api/__tests__/llm.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateUserConfig, describeResolved, readConfig } = require('../llm');

test('validateUserConfig accepts a well-formed config and trims it', () => {
  const res = validateUserConfig({
    apiKey: '  sk-abc  ',
    baseUrl: ' https://api.example.com/v1 ',
    model: ' gpt-4o-mini ',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, {
    apiKey: 'sk-abc',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
  });
});

test('validateUserConfig rejects bad base URLs, missing keys and long models', () => {
  assert.equal(validateUserConfig({ apiKey: 'k', baseUrl: 'ftp://x', model: 'm' }).ok, false);
  assert.equal(validateUserConfig({ apiKey: '', baseUrl: 'https://x', model: 'm' }).ok, false);
  assert.equal(
    validateUserConfig({ apiKey: 'k', baseUrl: 'https://x', model: 'm'.repeat(121) }).ok,
    false
  );
});

test('describeResolved never exposes the key and reports the source', () => {
  const desc = describeResolved({
    apiKey: 'sk-secret',
    baseUrl: 'https://x',
    model: 'm',
    configured: true,
    source: 'user',
  });
  assert.deepEqual(desc, { configured: true, model: 'm', provider: 'openai-compatible', source: 'user' });
  assert.equal('apiKey' in desc, false);
  assert.deepEqual(describeResolved(null), {
    configured: false,
    model: null,
    provider: null,
    source: 'none',
  });
});

test('readConfig stays environment-scoped', () => {
  const cfg = readConfig({
    USER_LLM_API_KEY: 'k',
    USER_LLM_BASE_URL: 'https://x',
    USER_LLM_MODEL: 'm',
    OPENAI_API_KEY: 'must-not-be-used',
  });
  assert.equal(cfg.apiKey, 'k');
  assert.equal(cfg.configured, true);
});
```

- [ ] **Step 4: Run the unit test**

Run: `cd backend && npm run test:api:unit`
Expected: all existing unit tests plus the 4 new `llm` tests pass.

- [ ] **Step 5: Commit**

```bash
cd /workspace
git add db/migrations/041_individual_llm.sql backend/src/api/llm.js backend/src/api/__tests__/llm.test.cjs
git commit -m "feat(llm): add encrypted per-user LLM config and resolver"
```

---

### Task 2: Profile LLM API, copilot integration, admin toggle + integration tests

**Files:**
- Create: `backend/src/api/routes/userLlm.js`
- Modify: `backend/src/api/routes/copilot.js`
- Modify: `backend/src/api/routes/admin.js` (individual-LLM settings endpoints)
- Modify: `backend/src/api/server.js` (mount `/api/profile/llm`)
- Test: `backend/tests/individualLlm.integration.test.cjs`

**Interfaces:**
- Consumes: `validateUserConfig`, `individualLlmAllowed`, `loadUserConfig`, `resolveConfig`, `describeResolved`, `PROVIDER_LABEL` from Task 1.
- Produces (HTTP):
  - `GET /api/profile/llm` → `{ allowed, configured, source, provider, model, baseUrl }` (never the key)
  - `PUT /api/profile/llm` `{ apiKey, baseUrl, model }` → same safe shape; 403 `individual_llm_disabled` when the toggle is off
  - `DELETE /api/profile/llm` → `{ ok: true }`
  - `GET /api/admin/settings/individual-llm` → `{ allowed }`
  - `PUT /api/admin/settings/individual-llm` `{ allowed }` → `{ allowed }`
  - `GET /api/copilot/status` now resolves per user and adds `source`.

- [ ] **Step 1: Create the profile LLM route**

Create `backend/src/api/routes/userLlm.js`:

```js
'use strict';

// ============================================================================
// Per-user "bring your own LLM" config — mounted at /api/profile/llm.
//
//   GET    /  safe shape (never the key) + whether the admin toggle allows it
//   PUT    /  upsert { apiKey, baseUrl, model } (encrypted at rest); 403 when
//             the admin toggle is off
//   DELETE /  forget the stored config
//
// The actor is always req.user; there is no way to read or write another
// user's config. The API key is only ever in the encrypted column.
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');
const llm = require('../llm');

const router = Router();
router.use(requireAuth);

function safeShape({ allowed, cfg }) {
  return {
    allowed,
    configured: Boolean(cfg && cfg.configured),
    source: (cfg && cfg.source) || 'none',
    provider: cfg && cfg.configured ? llm.PROVIDER_LABEL : null,
    model: (cfg && cfg.model) || null,
    baseUrl: (cfg && cfg.baseUrl) || null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const allowed = await llm.individualLlmAllowed();
    const cfg = allowed ? await llm.loadUserConfig(req.user.id) : null;
    res.json(safeShape({ allowed, cfg }));
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const allowed = await llm.individualLlmAllowed();
    if (!allowed) {
      return res.status(403).json({
        error: 'Individual model configuration is disabled by an administrator.',
        code: 'individual_llm_disabled',
      });
    }
    const parsed = llm.validateUserConfig(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { apiKey, baseUrl, model } = parsed.value;
    await query(
      `INSERT INTO user_llm_configs (user_id, api_key_encrypted, base_url, model, updated_at)
       VALUES ($1, pgp_sym_encrypt($2, app.vault_key()), $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         api_key_encrypted = EXCLUDED.api_key_encrypted,
         base_url = EXCLUDED.base_url,
         model = EXCLUDED.model,
         updated_at = now()`,
      [req.user.id, apiKey, baseUrl, model],
      { userId: req.user.id }
    );
    const cfg = await llm.loadUserConfig(req.user.id);
    res.json(safeShape({ allowed, cfg }));
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    await query('DELETE FROM user_llm_configs WHERE user_id = $1', [req.user.id], {
      userId: req.user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 2: Make copilot resolve per-user config**

In `backend/src/api/routes/copilot.js`, replace the `runCapability` function (line 208) so it accepts and forwards an explicit config:

```js
async function runCapability(capability, ctx, { system, prompt, config }) {
  try {
    const effective = config || (await llm.resolveConfig({ userId: ctx.userId, env: ctx.env }));
    const result = await llm.callModel({ system, prompt, json: true, config: effective });
    const text = typeof result === 'string' ? result : (result && result.text) || '';
    const usage = (result && result.usage) || {};
    const model = (result && result.model) || effective.model || null;
    const provider = (result && result.provider) || llm.PROVIDER_LABEL;
    await recordUsage({
      capability,
      status: 'ok',
      model,
      provider,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      requestId: ctx.requestId,
      runId: ctx.runId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
    return { text, usage, model, provider };
  } catch (err) {
    await recordUsage({
      capability,
      status: 'error',
      error: String((err && err.message) || err).slice(0, 500),
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      requestId: ctx.requestId,
      runId: ctx.runId,
    });
    throw err;
  }
}
```

Replace the `/status` handler (line 254) with an async per-user resolution:

```js
// GET /api/copilot/status -> { configured, model, provider, source } (never the key).
router.get('/status', async (req, res, next) => {
  try {
    const cfg = await llm.resolveConfig({ userId: req.user.id });
    res.json(llm.describeResolved(cfg));
  } catch (err) {
    next(err);
  }
});
```

In each of the three capability handlers (`/generate-assertions` line 259, `/explain-run` line 310, `/generate-docs` line 378) replace the guard line:

```js
    if (!llm.isConfigured()) return notConfigured(res);
```

with:

```js
    const config = await llm.resolveConfig({ userId: req.user.id });
    if (!config.configured) return notConfigured(res);
```

and update the corresponding `runCapability(...)` call to pass the config, e.g. for generate-assertions:

```js
    const result = await runCapability('generate-assertions', {
      userId: req.user.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      requestId,
    }, { system: ASSERTION_SYSTEM, prompt, config });
```

Apply the same `config` third-argument addition to the `runCapability('explain-run', ...)` and `runCapability('generate-docs', ...)` calls.

- [ ] **Step 3: Add the admin toggle**

In `backend/src/api/routes/admin.js`, insert these handlers immediately before `module.exports = router;`:

```js
// ------------------------------------------------- individual LLM master switch
// When false (default) the per-user LLM config UI is hidden and the copilot
// uses USER_LLM_* only. When true each user may store their own config.
router.get('/settings/individual-llm', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT allow_individual_llm FROM portal_settings ORDER BY id LIMIT 1'
    );
    res.json({ allowed: rows.length > 0 && rows[0].allow_individual_llm === true });
  } catch (err) {
    next(err);
  }
});

router.put('/settings/individual-llm', async (req, res, next) => {
  try {
    const { allowed } = req.body || {};
    if (typeof allowed !== 'boolean') return res.status(400).json({ error: 'allowed must be boolean' });
    await query(
      `UPDATE portal_settings
          SET allow_individual_llm = $1, updated_by = $2, updated_at = now()`,
      [allowed, req.user.id]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'portal_settings',
      entityId: null,
      action: 'set_individual_llm',
      detail: { setting: 'individual_llm', allowed },
      ip: req.ip,
    });
    res.json({ allowed });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Mount the route in `server.js`**

In `backend/src/api/server.js`, add the require with the other route requires:

```js
const userLlmRoutes = require('./routes/userLlm');
```

Mount it before the general profile router (around line 81):

```js
  app.use('/api/profile/llm', userLlmRoutes);
  app.use('/api/profile', profileRoutes);
```

- [ ] **Step 5: Write the integration test**

Create `backend/tests/individualLlm.integration.test.cjs`:

```js
'use strict';

// Integration tests for per-user BYO LLM config:
//   - admin toggle defaults off and blocks user writes
//   - when enabled, a user stores an encrypted config; GET never returns the key
//   - copilot prefers the user config over an unconfigured environment
//   - DELETE forgets the config
//
// The model is always stubbed via llm.setCallModel — no network is used.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ROOT = path.resolve(__dirname, '..', '..');
const PGENV = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: process.env.INTEGRATION_PGPORT || '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGDATABASE: process.env.INTEGRATION_PGDATABASE || 'apihub',
  AUTH_SECRET: 'test-auth-secret-for-integration',
  VAULT_KEY: 'test-vault-key-do-not-use-in-prod',
};

function psqlRun(sql) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlFile(file) {
  return execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-f', file], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function psqlScalar(sql) {
  return execFileSync('psql', ['-t', '-A', '-c', sql], {
    env: PGENV,
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
}

let server;
let base;
let llm;
let captured;

function makeClient() {
  let cookie = '';
  async function api(method, url, body) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /ah\.session=([^;]+)/.exec(setCookie);
      if (m) cookie = `ah.session=${m[1]}`;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  return { api };
}

let admin;
let userId;
let requestId;

const RESPONSE_SNAPSHOT = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ data: { id: 123 } }),
  durationMs: 12,
};

function clearEnvConfig() {
  delete process.env.USER_LLM_API_KEY;
  delete process.env.USER_LLM_BASE_URL;
  delete process.env.USER_LLM_MODEL;
}

before(async () => {
  psqlRun('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
  for (const file of fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    psqlFile(path.join(ROOT, 'db', 'migrations', file));
  }
  psqlRun('UPDATE portal_settings SET restrictions_enforced = false;');

  clearEnvConfig();
  process.env.ALLOW_SELF_SIGNUP = '1';
  process.env.PGDATABASE = process.env.INTEGRATION_PGDATABASE || 'apihub';
  process.env.AUTH_SECRET = 'test-auth-secret-for-integration';
  process.env.VAULT_KEY = 'test-vault-key-do-not-use-in-prod';

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/auth', require('../src/api/routes/auth'));
  app.use('/api/profile/llm', require('../src/api/routes/userLlm'));
  app.use('/api/admin', require('../src/api/routes/admin'));
  app.use('/api/workspaces', require('../src/api/routes/workspaces'));
  app.use('/api', require('../src/api/routes/content'));
  app.use('/api/copilot', require('../src/api/routes/copilot'));

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  admin = makeClient();
  const signup = await admin.api('POST', '/api/auth/signup', {
    email: 'llmadmin@test.io',
    password: 'adminpass123',
    name: 'LLM Admin',
  });
  assert.equal(signup.status, 201);
  userId = signup.json.user.user.id;

  const ws = await admin.api('GET', '/api/workspaces');
  const myWs = ws.json.workspaces.find((w) => w.name === 'My Workspace');
  const content = await admin.api('GET', `/api/workspaces/${myWs.id}/content`);
  const projectId = content.json.projects.find((p) => p.name === 'Default Project').id;
  const col = await admin.api('POST', '/api/collections', { projectId, name: 'LLM Col' });
  const created = await admin.api('POST', '/api/requests', {
    collectionId: col.json.collection.id,
    name: 'Ping',
    method: 'GET',
    url: 'https://example.test/ping',
  });
  requestId = created.json.request.id;

  llm = require('../src/api/llm');
  captured = [];
  llm.setCallModel(async (input) => {
    captured.push(input);
    return {
      text: JSON.stringify({ assertions: [{ type: 'status', operator: 'eq', expected: '200' }] }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: input.config ? input.config.model : 'stub',
      provider: 'openai-compatible',
    };
  });
});

after(async () => {
  llm.resetCallModel();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('toggle defaults off; GET reports not allowed; PUT is rejected', async () => {
  const toggle = await admin.api('GET', '/api/admin/settings/individual-llm');
  assert.equal(toggle.status, 200);
  assert.equal(toggle.json.allowed, false);

  const info = await admin.api('GET', '/api/profile/llm');
  assert.equal(info.status, 200);
  assert.equal(info.json.allowed, false);

  const put = await admin.api('PUT', '/api/profile/llm', {
    apiKey: 'sk-user',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
  });
  assert.equal(put.status, 403);
  assert.equal(put.json.code, 'individual_llm_disabled');
});

test('non-admin cannot flip the toggle', async () => {
  const res = await admin.api('GET', '/api/admin/settings/individual-llm');
  assert.equal(res.status, 200);
  // A second signup is a global EDITOR, not an admin.
  const other = makeClient();
  await other.api('POST', '/api/auth/signup', {
    email: 'llmeditor@test.io',
    password: 'editorpass123',
    name: 'LLM Editor',
  });
  const forbidden = await other.api('PUT', '/api/admin/settings/individual-llm', { allowed: true });
  assert.equal(forbidden.status, 403);
});

test('when enabled a user config is stored encrypted and never returned', async () => {
  const on = await admin.api('PUT', '/api/admin/settings/individual-llm', { allowed: true });
  assert.equal(on.status, 200);
  assert.equal(on.json.allowed, true);

  const put = await admin.api('PUT', '/api/profile/llm', {
    apiKey: 'sk-super-secret',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o-mini',
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.configured, true);
  assert.equal(put.json.source, 'user');
  assert.equal(put.json.model, 'gpt-4o-mini');
  assert.equal('apiKey' in put.json, false);
  assert.equal(JSON.stringify(put.json).includes('sk-super-secret'), false);

  // Stored as ciphertext, not plaintext.
  const stored = psqlScalar(
    `SELECT encode(api_key_encrypted, 'escape') FROM user_llm_configs WHERE user_id = '${userId}'`
  );
  assert.equal(stored.includes('sk-super-secret'), false);

  const info = await admin.api('GET', '/api/profile/llm');
  assert.equal(info.json.allowed, true);
  assert.equal(info.json.configured, true);
  assert.equal(info.json.source, 'user');
  assert.equal(JSON.stringify(info.json).includes('sk-super-secret'), false);
});

test('copilot uses the user config when the env is unconfigured', async () => {
  clearEnvConfig();
  captured.length = 0;
  const res = await admin.api('POST', '/api/copilot/generate-assertions', {
    requestId,
    response: RESPONSE_SNAPSHOT,
  });
  assert.equal(res.status, 200);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].config.model, 'gpt-4o-mini');
  assert.equal(captured[0].config.source, 'user');
});

test('DELETE forgets the config and status falls back to unconfigured', async () => {
  const del = await admin.api('DELETE', '/api/profile/llm');
  assert.equal(del.status, 200);
  const info = await admin.api('GET', '/api/profile/llm');
  assert.equal(info.json.configured, false);
  const status = await admin.api('GET', '/api/copilot/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.configured, false);
  assert.equal(status.json.source, 'none');
});
```

- [ ] **Step 6: Run the integration test**

Run:
```bash
cd /workspace/backend
PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/individualLlm.integration.test.cjs
```
Expected: all tests pass.

- [ ] **Step 7: Confirm the existing copilot suite still passes**

Run:
```bash
cd /workspace/backend
PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/copilot.integration.test.cjs
```
Expected: all tests pass (the 503-unconfigured behavior is preserved).

- [ ] **Step 8: Commit**

```bash
cd /workspace
git add backend/src/api/routes/userLlm.js backend/src/api/routes/copilot.js backend/src/api/routes/admin.js backend/src/api/server.js backend/tests/individualLlm.integration.test.cjs
git commit -m "feat(llm): per-user LLM config API, copilot resolution and admin toggle"
```

---

### Task 3: Frontend — profile LLM section, admin toggle, API client

**Files:**
- Create: `frontend/src/lib/llmConfig.js`
- Test: `frontend/src/lib/__tests__/llmConfig.test.cjs`
- Modify: `frontend/src/lib/api.ts` (`llmConfigApi`, admin methods, types)
- Modify: `frontend/src/components/ProfilePage.tsx` (conditional AI model section)
- Modify: `frontend/src/components/views/AdminView.tsx` (AI tab with the global toggle)

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/profile/llm`, `GET/PUT /api/admin/settings/individual-llm`.
- Produces:
  - `frontend/src/lib/llmConfig.js`: `isLlmConfigComplete(input)`, `maskKey(key)`
  - `llmConfigApi.get/put/remove`
  - `adminApi.individualLlm()`, `adminApi.setIndividualLlm({ allowed })`
  - types `UserLlmConfig`, `AdminIndividualLlm`

- [ ] **Step 1: Add the pure helper module**

Create `frontend/src/lib/llmConfig.js`:

```js
'use strict';

// Framework-free helpers for the per-user LLM form.
function isLlmConfigComplete(input) {
  const src = input || {};
  const apiKey = String(src.apiKey || '').trim();
  const baseUrl = String(src.baseUrl || '').trim();
  const model = String(src.model || '').trim();
  if (!apiKey || !model) return false;
  return /^https?:\/\/.+/i.test(baseUrl);
}

function maskKey(key) {
  const value = String(key || '');
  if (value.length <= 4) return value ? '••••' : '';
  return `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

module.exports = { isLlmConfigComplete, maskKey };
```

- [ ] **Step 2: Write the failing helper test**

Create `frontend/src/lib/__tests__/llmConfig.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isLlmConfigComplete, maskKey } = require('../llmConfig');

test('isLlmConfigComplete requires a key, an http(s) base URL and a model', () => {
  assert.equal(isLlmConfigComplete({ apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' }), true);
  assert.equal(isLlmConfigComplete({ apiKey: '', baseUrl: 'https://x/v1', model: 'm' }), false);
  assert.equal(isLlmConfigComplete({ apiKey: 'k', baseUrl: 'ftp://x', model: 'm' }), false);
  assert.equal(isLlmConfigComplete({ apiKey: 'k', baseUrl: 'https://x/v1', model: '' }), false);
  assert.equal(isLlmConfigComplete(null), false);
});

test('maskKey keeps only the last four characters', () => {
  assert.equal(maskKey('sk-abcdef'), '•••••cdef');
  assert.equal(maskKey('abcd'), '••••');
  assert.equal(maskKey(''), '');
});
```

- [ ] **Step 3: Run the test**

Run: `cd frontend && npm test`
Expected: the new `llmConfig` tests pass.

- [ ] **Step 4: Add the API client and types**

In `frontend/src/lib/api.ts`, add after the `profileApi` object (line 1002):

```ts
export interface UserLlmConfig {
  allowed: boolean;
  configured: boolean;
  source: 'user' | 'env' | 'none';
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
}

export const llmConfigApi = {
  get: () => apiFetch<UserLlmConfig>('/api/profile/llm'),
  put: (input: { apiKey: string; baseUrl: string; model: string }) =>
    apiFetch<UserLlmConfig>('/api/profile/llm', { method: 'PUT', body: input }),
  remove: () => apiFetch<{ ok: true }>('/api/profile/llm', { method: 'DELETE' }),
};
```

Add to `adminApi` (after `deleteMenu` from the menus plan, or after `revokeWorkspaceMember`):

```ts
  individualLlm: () => apiFetch<{ allowed: boolean }>('/api/admin/settings/individual-llm'),
  setIndividualLlm: (input: { allowed: boolean }) =>
    apiFetch<{ allowed: boolean }>('/api/admin/settings/individual-llm', { method: 'PUT', body: input }),
```

- [ ] **Step 5: Add the Profile "AI model" section**

In `frontend/src/components/ProfilePage.tsx`, update the import (line 8):

```tsx
import { profileApi, llmConfigApi, type Profile, type ProfileAvatar, type UserLlmConfig } from '@/lib/api';
```

Append this component to the end of the file (after `ProfilePage`):

```tsx
function LlmModelSection({ onMessage }: { onMessage: (msg: { kind: 'ok' | 'err'; text: string } | null) => void }) {
  const [state, setState] = useState<UserLlmConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');

  const load = async () => {
    try {
      const res = await llmConfigApi.get();
      setState(res);
      setBaseUrl(res.baseUrl ?? '');
      setModel(res.model ?? '');
    } catch {
      setState(null);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!loaded || !state || !state.allowed) return null;

  const save = async () => {
    if (!isLlmConfigComplete({ apiKey, baseUrl, model })) {
      onMessage({ kind: 'err', text: 'Enter an API key, an http(s) base URL and a model.' });
      return;
    }
    setBusy(true);
    try {
      await llmConfigApi.put({ apiKey, baseUrl, model });
      setApiKey('');
      onMessage({ kind: 'ok', text: 'AI model saved.' });
      await load();
    } catch (err) {
      onMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save model' });
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      await llmConfigApi.remove();
      setApiKey('');
      setBaseUrl('');
      setModel('');
      onMessage({ kind: 'ok', text: 'AI model removed. Falling back to the server default.' });
      await load();
    } catch (err) {
      onMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not remove model' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="profile-llm-section">
      <p className="profile-section-sub" data-testid="profile-llm-status">
        {state.configured && state.source === 'user'
          ? `Using your model (${state.model}).`
          : 'No personal model configured — the copilot uses the server default.'}
      </p>
      <div className="profile-form">
        <label className="field">
          <span className="field-label">API key</span>
          <input
            className="text-input"
            type="password"
            data-testid="profile-llm-key"
            placeholder={state.configured && state.source === 'user' ? 'Replace stored key' : 'sk-...'}
            value={apiKey}
            disabled={busy}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Base URL</span>
          <input
            className="text-input"
            data-testid="profile-llm-base-url"
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            disabled={busy}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <input
            className="text-input"
            data-testid="profile-llm-model"
            placeholder="gpt-4o-mini"
            value={model}
            disabled={busy}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <div className="profile-form-actions">
          <button type="button" className="primary-button" data-testid="profile-llm-save" disabled={busy} onClick={() => void save()}>
            Save model
          </button>
          {state.configured && state.source === 'user' && (
            <button type="button" className="ghost-button danger-text" data-testid="profile-llm-remove" disabled={busy} onClick={() => void forget()}>
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="profile-field-hint">The key is encrypted at rest and never shown again.</p>
    </div>
  );
}
```

Add `isLlmConfigComplete` to the ProfilePage imports:

```tsx
import { isLlmConfigComplete } from '@/lib/llmConfig';
```

Render the section in the profile main list, after the Avatar section (line 617) and before the password section:

```tsx
          <section className="profile-card" aria-labelledby="profile-llm-title">
            <h2 className="profile-card-title" id="profile-llm-title">
              AI model
            </h2>
            <LlmModelSection onMessage={showSectionMsg} />
          </section>
```

- [ ] **Step 6: Add the admin AI toggle**

In `frontend/src/components/views/AdminView.tsx`, extend the tab union and list (lines 15-20) to include an `ai` tab:

```tsx
type Tab = 'users' | 'access' | 'menus' | 'ai';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'access', label: 'Access' },
  { id: 'menus', label: 'Menus' },
  { id: 'ai', label: 'AI' },
];
```

Add the render next to the other tab renders:

```tsx
      {tab === 'ai' && <AiSettingsTab busy={busy} onRun={run} />}
```

Append the component to the end of the file:

```tsx
function AiSettingsTab({ busy, onRun }: {
  busy: boolean;
  onRun: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    adminApi
      .individualLlm()
      .then((res) => setAllowed(res.allowed))
      .catch(() => setAllowed(null));
  }, []);

  if (allowed === null) return <p className="hint">Loading AI settings…</p>;

  return (
    <div data-testid="admin-ai-section">
      <p className="hint">
        When enabled, each user may store their own LLM API key. The key is encrypted at rest and
        never returned to the browser. When disabled (default) the copilot uses the server's
        USER_LLM_* environment configuration only.
      </p>
      <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <input
          type="checkbox"
          data-testid="admin-individual-llm-toggle"
          checked={allowed}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            onRun(
              next ? 'Individual model configuration enabled.' : 'Individual model configuration disabled.',
              async () => {
                const res = await adminApi.setIndividualLlm({ allowed: next });
                setAllowed(res.allowed);
              }
            );
          }}
        />
        <span>Allow individuals to bring their own LLM</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and unit test**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: `tsc` clean; unit suite passes including `llmConfig`.

- [ ] **Step 8: Commit**

```bash
cd /workspace
git add frontend/src/lib/llmConfig.js frontend/src/lib/__tests__/llmConfig.test.cjs frontend/src/lib/api.ts frontend/src/components/ProfilePage.tsx frontend/src/components/views/AdminView.tsx
git commit -m "feat(llm): profile model form and admin individual-LLM toggle"
```

---

### Task 4: Session docs

**Files:**
- Modify: `docs/SESSION.md`
- Modify: `session.md`

- [ ] **Step 1: Update `docs/SESSION.md`**

Append a subsection (next free `10.x` number) describing: migration 041 (`portal_settings.allow_individual_llm` default false + `user_llm_configs` with `pgp_sym_encrypt(..., app.vault_key())`), `resolveConfig` precedence (user config only when the toggle is on, else `USER_LLM_*`), `describeResolved`/safe shapes never returning the key, the `/api/profile/llm` endpoints, the admin `/api/admin/settings/individual-llm` toggle, and that the key is never written to `ai_copilot_usage`.

- [ ] **Step 2: Update `session.md`**

Add under `## Completed`:

```markdown
- Individual BYO LLM: admin toggle `portal_settings.allow_individual_llm` (default off), encrypted per-user `user_llm_configs`, `resolveConfig` precedence (user config when enabled, else `USER_LLM_*`), profile model form and admin AI tab.
```

- [ ] **Step 3: Commit**

```bash
cd /workspace
git add docs/SESSION.md session.md
git commit -m "docs(session): individual bring-your-own LLM"
```

---

## Self-Review

**Spec coverage:**
- Admin global toggle default OFF: Task 1 migration, Task 2 admin endpoints, Task 3 admin UI.
- When ON each personal user may add their own config: Task 2 `/api/profile/llm`, Task 3 profile form.
- When OFF config UI hidden and copilot falls back to server env: Task 2 `resolveConfig` + `allowed` gating, Task 3 `if (!state.allowed) return null`.
- Encrypted per-user key, never returned: Task 1 `pgp_sym_encrypt`/`loadUserConfig`, Task 2 safe shapes, Task 2 integration test asserts ciphertext at rest and absence in responses.

**Placeholder scan:** no `TBD`/`TODO`; all code and commands are complete.

**Type consistency:** `resolveConfig` returns `source: 'user'|'env'|'none'` and `describeResolved`/`UserLlmConfig` expose the same union; `validateUserConfig` value keys (`apiKey`, `baseUrl`, `model`) match the route body and the frontend `llmConfigApi.put` input.
