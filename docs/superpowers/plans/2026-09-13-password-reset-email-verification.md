# Password Reset + Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-service "forgot password" and signup email verification to API Hub, with single-use hashed tokens, real SMTP delivery (env-configured), and a soft (non-blocking) verification state.

**Architecture:** A new `auth_tokens` table stores SHA-256 hashes of one-time tokens (kind = `password_reset` | `email_verification`, expiry, `used_at`). Auth routes issue tokens and send links through a small `email` module that wraps `nodemailer` behind an injectable transport and falls back to logging when SMTP is unconfigured. Reset sets `users.password_changed_at`, and sessions carry an `iat` so sessions issued before the reset are rejected. Verification is soft: accounts keep working while unverified, but the UI shows a resend banner and exposes `email_verified` on the user summary.

**Tech Stack:** Express 5, PostgreSQL 15, `node:crypto` (scrypt hashing, SHA-256 token hashes), `nodemailer` (new backend dependency), Next.js 14 App Router + TypeScript frontend, `node --test` for both backend unit and frontend unit tests, `node --test` integration suites against a scratch Postgres.

## Global Constraints

- Latest applied migration is `043_search_indexes.sql`; the new migration MUST be `db/migrations/044_auth_tokens.sql` and MUST be append-only (no edits to earlier migrations).
- Password hashing is `node:crypto` scrypt via `backend/src/api/authLib.js` (`hashPassword`/`verifyPassword`); never introduce bcrypt.
- Never store or log a raw token: only `sha256(raw)` is persisted; the raw value appears only in the emailed link.
- Raw SMTP credentials MUST NOT be committed. Read them from `process.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_URL`, `APP_URL`); commit placeholders only.
- Email delivery MUST be best-effort: a mail failure never fails a request path (`sendMail` resolves, never rejects into the route).
- Forgot-password MUST always return `200 { ok: true }` (no account enumeration).
- Backend raw SQL goes through `require('../db').query` / a pooled client; no ORM.
- Backend unit tests live in `backend/src/api/__tests__/*.test.cjs` and run with `npm run test:api:unit`. Integration tests live in `backend/tests/*.integration.test.cjs` and run with `PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test <file>` (scratch cluster on 5441; never wipe dev `apihub` on 5432).
- Frontend pure helpers are CommonJS (`'use strict'; ... module.exports = {...}`) under `frontend/src/lib/*.js` with matching `frontend/src/lib/__tests__/*.test.cjs`; `npm test` discovers only those. TypeScript/React files are validated with `npx tsc --noEmit`.
- Frontend API calls go through `apiFetch`/`ApiError` in `frontend/src/lib/api.ts`; kebab-case `data-testid` attributes on interactive elements.
- Commit style: Conventional Commits. A `prepare-commit-msg` hook appends the required `Co-authored-by:` trailer — never bypass hooks and never add the trailer manually.
- Never `git add -A`; never stage `docs/superpowers/` or `frontend/tsconfig.tsbuildinfo`.
- Do NOT gate login or existing app usage on `email_verified` (soft verification only) — this keeps self-service signup, the empty-DB ADMIN bootstrap, and all existing tests working.

---

## File Structure

**Backend**
- Create `backend/src/api/authTokens.js` — token generation/hash/expiry + a pure in-memory throttle factory.
- Create `backend/src/api/__tests__/authTokens.test.cjs` — unit tests for the above.
- Create `db/migrations/044_auth_tokens.sql` — `auth_tokens` table + `users.email_verified` + `users.password_changed_at`.
- Create `backend/src/api/email.js` — SMTP config, injectable transport, `sendMail`, message builders.
- Create `backend/src/api/__tests__/email.test.cjs` — unit tests with a fake transport.
- Modify `backend/src/api/authLib.js` — add `iat` to session tokens.
- Modify `backend/src/api/access.js` — load `email_verified`/`password_changed_at`; reject pre-reset sessions.
- Modify `backend/src/api/routes/auth.js` — verification + reset routes; signup sends verification.
- Create `backend/tests/authEmail.integration.test.cjs` — verification flow.
- Create `backend/tests/authReset.integration.test.cjs` — reset flow + session invalidation.
- Modify `backend/package.json` — add `nodemailer`.
- Create `backend/.env.example` — placeholder SMTP/app config.

**Frontend**
- Modify `frontend/src/lib/api.ts` — `User.email_verified` + `authApi` methods.
- Create `frontend/src/lib/authLinks.js` — token-from-URL and password-validation helpers.
- Create `frontend/src/lib/__tests__/authLinks.test.cjs` — helper unit tests.
- Modify `frontend/app/login/page.tsx` — "Forgot password?" link.
- Create `frontend/app/forgot-password/page.tsx`.
- Create `frontend/app/reset-password/page.tsx`.
- Create `frontend/app/verify-email/page.tsx`.
- Modify `frontend/src/components/AppShell.tsx` — unverified-email banner with resend.
- Modify `frontend/app/globals.css` — `.verify-banner` styles.
- Modify `docs/FEATURES.md` — §25 Password reset and email verification.
- Modify `session_v2.md` — details subsection.

---

## Task 1: Auth token primitives + throttle + migration

**Files:**
- Create: `backend/src/api/authTokens.js`
- Create: `backend/src/api/__tests__/authTokens.test.cjs`
- Create: `db/migrations/044_auth_tokens.sql`

**Interfaces:**
- Produces:
  - `generateToken(): string` — 32 random bytes, base64url.
  - `hashToken(raw: unknown): string` — lowercase sha256 hex of `String(raw)`.
  - `TOKEN_TTL_MS: { password_reset: number, email_verification: number }`.
  - `expiryFor(kind: string, now?: number): Date | null`.
  - `createThrottle({ windowMs, max }): { allow(key: string, now?: number): boolean }`.

- [ ] **Step 1: Write the failing unit test**

Create `backend/src/api/__tests__/authTokens.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateToken,
  hashToken,
  TOKEN_TTL_MS,
  expiryFor,
  createThrottle,
} = require('../authTokens');

test('generateToken returns unique url-safe secrets', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.ok(a.length >= 40);
});

test('hashToken is a stable sha256 hex digest', () => {
  const h = hashToken('abc');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashToken('abc'));
  assert.notEqual(h, hashToken('abd'));
});

test('expiryFor applies the per-kind ttl', () => {
  const now = 1_700_000_000_000;
  assert.equal(expiryFor('password_reset', now).getTime(), now + TOKEN_TTL_MS.password_reset);
  assert.equal(
    expiryFor('email_verification', now).getTime(),
    now + TOKEN_TTL_MS.email_verification
  );
  assert.equal(expiryFor('nope', now), null);
});

test('createThrottle limits calls per key inside the window', () => {
  const throttle = createThrottle({ windowMs: 1000, max: 2 });
  const t0 = 1000;
  assert.equal(throttle.allow('a@x', t0), true);
  assert.equal(throttle.allow('a@x', t0 + 1), true);
  assert.equal(throttle.allow('a@x', t0 + 2), false);
  assert.equal(throttle.allow('b@x', t0 + 2), true);
  assert.equal(throttle.allow('a@x', t0 + 1001), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/api/__tests__/authTokens.test.cjs`
Expected: FAIL — `Cannot find module '../authTokens'`.

- [ ] **Step 3: Write `backend/src/api/authTokens.js`**

```js
'use strict';

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = {
  password_reset: 60 * 60 * 1000, // 1 hour
  email_verification: 24 * 60 * 60 * 1000, // 24 hours
};
const KINDS = Object.keys(TOKEN_TTL_MS);

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function ttlFor(kind) {
  return Object.prototype.hasOwnProperty.call(TOKEN_TTL_MS, kind) ? TOKEN_TTL_MS[kind] : null;
}

function expiryFor(kind, now = Date.now()) {
  const ttl = ttlFor(kind);
  return ttl === null ? null : new Date(now + ttl);
}

// Fixed-window in-memory throttle. Good enough to blunt forgot-password abuse
// on a single process; a multi-process deployment would need Redis.
function createThrottle({ windowMs, max }) {
  const hits = new Map();
  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

module.exports = { TOKEN_BYTES, TOKEN_TTL_MS, KINDS, generateToken, hashToken, ttlFor, expiryFor, createThrottle };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/api/__tests__/authTokens.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the migration**

Create `db/migrations/044_auth_tokens.sql`:

```sql
-- --------------------------------------------------------- Auth one-time tokens
-- Backs password reset and email verification. Only sha256(raw) is stored; the
-- raw secret lives only in the emailed link.
CREATE TABLE auth_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('password_reset', 'email_verification')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_kind_idx ON auth_tokens (user_id, kind);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);

-- Email verification state. Existing accounts are grandfathered as verified so
-- the migration cannot lock anyone out; accounts created after this migration
-- default to unverified (signup sets the flag explicitly via the column default).
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
UPDATE users SET email_verified = true;

-- Set when a password is reset/changed; sessions issued before this instant are
-- rejected (see requireAuth). Null means "no password change on record".
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
```

- [ ] **Step 6: Apply the migration to the dev database and verify**

Run: `cd /workspace && PGUSER=postgres PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=5432 psql -d apihub -v ON_ERROR_STOP=1 -f db/migrations/044_auth_tokens.sql`
Expected: `CREATE TABLE`, `CREATE INDEX` x2, `ALTER TABLE` x2, `UPDATE`.

Verify:

```bash
PGUSER=postgres PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=5432 psql -d apihub -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('email_verified','password_changed_at') ORDER BY column_name"
```

Expected output:

```
email_verified
password_changed_at
```

If `psql` needs credentials in this environment, use the same connection settings the running backend uses; if it cannot connect, report it and stop rather than skipping the migration.

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/authTokens.js backend/src/api/__tests__/authTokens.test.cjs db/migrations/044_auth_tokens.sql
git commit -m "feat(auth): add one-time token primitives and auth_tokens migration"
```

---

## Task 2: Email module (nodemailer, injectable, best-effort)

**Files:**
- Create: `backend/src/api/email.js`
- Create: `backend/src/api/__tests__/email.test.cjs`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `smtpConfig(): object | null` — non-null only when `SMTP_URL` or `SMTP_HOST` is set.
  - `appUrl(): string` — `APP_URL` without trailing slash, default `http://localhost:3000`.
  - `sendMail({ to, subject, text, html }): Promise<{ skipped: boolean, messageId?: string, error?: string }>` — never rejects.
  - `passwordResetMessage(link: string): { subject: string, text: string, html: string }`.
  - `verifyEmailMessage(link: string): { subject: string, text: string, html: string }`.
  - `setTransportForTest(transport: object | null): void` and `resetTransportForTest(): void`.

- [ ] **Step 1: Add the dependency**

Run: `cd backend && npm install nodemailer@^10`
Expected: `nodemailer` added to `backend/package.json` `dependencies` and `backend/package-lock.json` (if present) updated. If the registry is unreachable, report and stop — do not hand-edit a lockfile.

- [ ] **Step 2: Write the failing unit test**

Create `backend/src/api/__tests__/email.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const email = require('../email');

test('smtpConfig is null without SMTP env', () => {
  const saved = { ...process.env };
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  assert.equal(email.smtpConfig(), null);
  Object.assign(process.env, saved);
});

test('sendMail is a no-op that resolves when SMTP is unconfigured', async () => {
  const saved = { ...process.env };
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  email.resetTransportForTest();
  const result = await email.sendMail({ to: 'a@b.c', subject: 'x', text: 'y' });
  assert.equal(result.skipped, true);
  Object.assign(process.env, saved);
});

test('sendMail uses the injected transport and never throws on failure', async () => {
  const sent = [];
  email.setTransportForTest({
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: 'mid-1' };
    },
  });
  const ok = await email.sendMail({ to: 'a@b.c', subject: 's', text: 't' });
  assert.equal(ok.skipped, false);
  assert.equal(ok.messageId, 'mid-1');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].from);
  assert.equal(sent[0].to, 'a@b.c');

  email.setTransportForTest({
    sendMail: async () => {
      throw new Error('smtp down');
    },
  });
  const bad = await email.sendMail({ to: 'a@b.c', subject: 's', text: 't' });
  assert.equal(bad.error, 'smtp down');
  email.resetTransportForTest();
});

test('message builders include the link', () => {
  const link = 'http://localhost:3000/reset-password?token=abc';
  assert.ok(email.passwordResetMessage(link).text.includes(link));
  assert.ok(email.verifyEmailMessage(link).html.includes(link));
});

test('appUrl strips a trailing slash', () => {
  const saved = process.env.APP_URL;
  process.env.APP_URL = 'https://app.example.com/';
  assert.equal(email.appUrl(), 'https://app.example.com');
  if (saved === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = saved;
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && node --test src/api/__tests__/email.test.cjs`
Expected: FAIL — `Cannot find module '../email'`.

- [ ] **Step 4: Write `backend/src/api/email.js`**

```js
'use strict';

// ---------------------------------------------------------------------------
// Best-effort transactional email. Configured entirely from the environment so
// no credential is ever committed:
//   SMTP_URL                    e.g. smtp://user:pass@host:587 (alternative to host/port)
//   SMTP_HOST, SMTP_PORT        default 587
//   SMTP_SECURE=1               implicit TLS (usually port 465)
//   SMTP_USER, SMTP_PASS
//   SMTP_FROM                   default "API Hub <noreply@keerainnovations.com>"
//   APP_URL                     public base URL used to build links (default http://localhost:3000)
// ---------------------------------------------------------------------------

function smtpConfig() {
  const url = process.env.SMTP_URL;
  const host = process.env.SMTP_HOST;
  if (!url && !host) return null;
  return {
    url,
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  };
}

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function fromAddress() {
  return process.env.SMTP_FROM || 'API Hub <noreply@keerainnovations.com>';
}

let transportOverride;

function buildTransport(cfg) {
  // Lazy require keeps the server bootable if the optional dependency is absent.
  const nodemailer = require('nodemailer');
  if (cfg.url) return nodemailer.createTransport(cfg.url);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
  });
}

function getTransport() {
  if (transportOverride !== undefined) return transportOverride;
  const cfg = smtpConfig();
  if (!cfg) return null;
  try {
    return buildTransport(cfg);
  } catch (err) {
    console.error('[email] transport init failed:', err.message);
    return null;
  }
}

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    console.log(`[email] SMTP not configured; skipped "${subject}" to ${to}`);
    return { skipped: true };
  }
  try {
    const info = await transport.sendMail({ from: fromAddress(), to, subject, text, html });
    return { skipped: false, messageId: info && info.messageId };
  } catch (err) {
    console.error(`[email] send failed to ${to}:`, err.message);
    return { skipped: false, error: err.message };
  }
}

function passwordResetMessage(link) {
  return {
    subject: 'Reset your API Hub password',
    text: `We received a request to reset your API Hub password.\n\nOpen this link to choose a new password:\n${link}\n\nThis link expires in 1 hour. If you did not request it, you can ignore this email.`,
    html: `<p>We received a request to reset your API Hub password.</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If you did not request it, you can ignore this email.</p>`,
  };
}

function verifyEmailMessage(link) {
  return {
    subject: 'Verify your API Hub email',
    text: `Welcome to API Hub.\n\nConfirm your email address:\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome to API Hub.</p><p><a href="${link}">Confirm your email address</a></p><p>This link expires in 24 hours.</p>`,
  };
}

function setTransportForTest(transport) {
  transportOverride = transport;
}

function resetTransportForTest() {
  transportOverride = undefined;
}

module.exports = {
  smtpConfig,
  appUrl,
  fromAddress,
  sendMail,
  passwordResetMessage,
  verifyEmailMessage,
  setTransportForTest,
  resetTransportForTest,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && node --test src/api/__tests__/email.test.cjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/email.js backend/src/api/__tests__/email.test.cjs backend/package.json backend/package-lock.json
git commit -m "feat(auth): add best-effort SMTP email module"
```

If `backend/package-lock.json` does not exist, omit it from `git add`.

---

## Task 3: Email verification endpoints + expose `email_verified`

**Files:**
- Modify: `backend/src/api/access.js:18-25` (`loadUserById`)
- Modify: `backend/src/api/routes/auth.js`
- Create: `backend/tests/authEmail.integration.test.cjs`

**Interfaces:**
- Consumes: `authTokens.generateToken/hashToken/expiryFor`, `email.sendMail/verifyEmailMessage/appUrl`.
- Produces:
  - `POST /api/auth/verify-email` `{ token }` → `200 { ok: true }` or `400 { error }`.
  - `POST /api/auth/resend-verification` (auth) → `200 { ok: true, alreadyVerified?: true }`.
  - Signup sends a verification email after commit; the user summary now includes `email_verified`.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/authEmail.integration.test.cjs`:

```js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient } = require('./support/harness.cjs');
const email = require('../src/api/email');

let app;
const sent = [];

before(async () => {
  email.setTransportForTest({
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: `test-${sent.length}` };
    },
  });
  app = await startApp();
});

after(async () => {
  email.resetTransportForTest();
  await app.close();
});

function tokenFrom(message, path) {
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(message.text || '');
  assert.ok(match, `token link not found in: ${message.text}`);
  return match[1];
}

test('signup sends a verification email and verify-email flips the flag', async () => {
  const client = makeClient(app.base);
  const signup = await client.api('POST', '/api/auth/signup', {
    email: 'verify-me@example.com',
    password: 'password123',
    name: 'Verify Me',
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.json.user.user.email_verified, false);

  const message = sent.find((m) => m.to === 'verify-me@example.com');
  assert.ok(message, 'verification email was sent');
  const token = tokenFrom(message, '/verify-email');

  const verified = await client.api('POST', '/api/auth/verify-email', { token });
  assert.equal(verified.status, 200);
  assert.equal(verified.json.ok, true);

  const me = await client.api('GET', '/api/auth/me');
  assert.equal(me.json.user.email_verified, true);
});

test('verify-email rejects an unknown or reused token', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'verify-twice@example.com',
    password: 'password123',
  });
  const message = sent.find((m) => m.to === 'verify-twice@example.com');
  const token = tokenFrom(message, '/verify-email');

  assert.equal((await client.api('POST', '/api/auth/verify-email', { token })).status, 200);
  assert.equal((await client.api('POST', '/api/auth/verify-email', { token })).status, 400);
  assert.equal((await client.api('POST', '/api/auth/verify-email', { token: 'nope' })).status, 400);
});

test('resend-verification is a no-op for a verified user', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'resend-me@example.com',
    password: 'password123',
  });
  const token = tokenFrom(sent.find((m) => m.to === 'resend-me@example.com'), '/verify-email');
  await client.api('POST', '/api/auth/verify-email', { token });

  const before = sent.length;
  const res = await client.api('POST', '/api/auth/resend-verification', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.alreadyVerified, true);
  assert.equal(sent.length, before);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/authEmail.integration.test.cjs`
Expected: FAIL — `email_verified` is `undefined` / `verify-email` returns 404.

- [ ] **Step 3: Expose `email_verified` in `loadUserById`**

In `backend/src/api/access.js`, change the `loadUserById` SELECT (currently around line 18-25) to:

```js
async function loadUserById(userId) {
  const { rows } = await query(
    `SELECT id, email, username, name, role, is_active, email_verified, password_changed_at, created_at
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}
```

Then in `backend/src/api/routes/auth.js`, make `userSummary` omit the internal `password_changed_at` field:

```js
async function userSummary(userId) {
  const loaded = await loadUserById(userId);
  if (!loaded) return null;
  const { password_changed_at, ...user } = loaded;
  const { rows: orgs } = await query(
    `SELECT o.id, o.name, o.kind, o.domain,
            (SELECT role FROM organization_members om WHERE om.org_id = o.id AND om.user_id = $1) AS role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
      WHERE om.user_id = $1
      ORDER BY o.kind, o.name`,
    [userId]
  );
  return { user, organizations: orgs };
}
```

- [ ] **Step 4: Add the routes and signup hook to `backend/src/api/routes/auth.js`**

Add these requires near the top (after the existing requires):

```js
const { generateToken, hashToken, expiryFor } = require('../authTokens');
const email = require('../email');
```

Add a helper just before `router.post('/signup', ...)`:

```js
async function issueEmailVerification(userId, to) {
  const raw = generateToken();
  await query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
     VALUES ($1, 'email_verification', $2, $3)`,
    [userId, hashToken(raw), expiryFor('email_verification')]
  );
  const link = `${email.appUrl()}/verify-email?token=${encodeURIComponent(raw)}`;
  await email.sendMail({ to, ...email.verifyEmailMessage(link) });
}
```

In the signup handler, after `await client.query('COMMIT');` and before setting the session cookie, add a best-effort send (never fail signup):

```js
      await client.query('COMMIT');

      try {
        await issueEmailVerification(userId, email);
      } catch (err) {
        console.error('[auth] verification email failed:', err.message);
      }

      res.setHeader('Set-Cookie', sessionCookie(createSessionToken(userId)));
```

Add the two routes before `router.post('/logout', ...)`:

```js
router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    const { rows } = await query(
      `SELECT id, user_id FROM auth_tokens
        WHERE token_hash = $1 AND kind = 'email_verification'
          AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) {
      return res.status(400).json({ error: 'This verification link is invalid or has expired' });
    }
    await query('UPDATE users SET email_verified = true WHERE id = $1', [row.user_id]);
    await query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', requireAuth, async (req, res, next) => {
  try {
    if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true });
    await query(
      `UPDATE auth_tokens SET used_at = now()
        WHERE user_id = $1 AND kind = 'email_verification' AND used_at IS NULL`,
      [req.user.id]
    );
    await issueEmailVerification(req.user.id, req.user.email);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `cd /workspace/backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/authEmail.integration.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Run backend unit + a regression integration suite**

Run: `cd /workspace/backend && npm run test:api:unit`
Expected: PASS (all).

Run: `cd /workspace/backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/apiAuth.integration.test.cjs`
Expected: PASS (no auth regressions).

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/access.js backend/src/api/routes/auth.js backend/tests/authEmail.integration.test.cjs
git commit -m "feat(auth): send and confirm email verification links"
```

---

## Task 4: Password reset + session invalidation

**Files:**
- Modify: `backend/src/api/authLib.js:75-77` (`createSessionToken`)
- Modify: `backend/src/api/access.js` (`requireAuth`)
- Modify: `backend/src/api/routes/auth.js`
- Create: `backend/tests/authReset.integration.test.cjs`

**Interfaces:**
- Consumes: `authTokens.generateToken/hashToken/expiryFor/createThrottle`, `email.sendMail/passwordResetMessage/appUrl`, `authLib.hashPassword`.
- Produces:
  - `createSessionToken(userId)` payload gains `iat: number`.
  - `requireAuth` rejects a session whose `iat` predates `users.password_changed_at` (missing `iat` is grandfathered).
  - `POST /api/auth/forgot-password` `{ email }` → always `200 { ok: true }`; rate-limited per email.
  - `POST /api/auth/reset-password` `{ token, new_password }` → `200 { ok: true }` or `400 { error }`.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/authReset.integration.test.cjs`:

```js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient } = require('./support/harness.cjs');
const email = require('../src/api/email');

let app;
const sent = [];

before(async () => {
  email.setTransportForTest({
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: `test-${sent.length}` };
    },
  });
  app = await startApp();
});

after(async () => {
  email.resetTransportForTest();
  await app.close();
});

function resetTokenFor(address) {
  const message = [...sent].reverse().find((m) => m.to === address && m.subject.includes('Reset'));
  assert.ok(message, `reset email sent to ${address}`);
  const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(match, `token link not found in: ${message.text}`);
  return match[1];
}

test('forgot-password does not reveal whether an account exists', async () => {
  const client = makeClient(app.base);
  const missing = await client.api('POST', '/api/auth/forgot-password', { email: 'nobody@example.com' });
  assert.equal(missing.status, 200);
  assert.equal(missing.json.ok, true);
  assert.equal(sent.length, 0);
});

test('reset-password sets a new password usable for login', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'reset-me@example.com',
    password: 'oldpassword1',
  });

  const forgot = await client.api('POST', '/api/auth/forgot-password', {
    email: 'reset-me@example.com',
  });
  assert.equal(forgot.status, 200);

  const token = resetTokenFor('reset-me@example.com');
  const reset = await client.api('POST', '/api/auth/reset-password', {
    token,
    new_password: 'newpassword2',
  });
  assert.equal(reset.status, 200);

  const badLogin = makeClient(app.base);
  assert.equal(
    (await badLogin.api('POST', '/api/auth/login', { email: 'reset-me@example.com', password: 'oldpassword1' })).status,
    401
  );
  const goodLogin = makeClient(app.base);
  assert.equal(
    (await goodLogin.api('POST', '/api/auth/login', { email: 'reset-me@example.com', password: 'newpassword2' })).status,
    200
  );
});

test('reset tokens are single-use and short-password is rejected', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'reset-once@example.com',
    password: 'oldpassword1',
  });
  await client.api('POST', '/api/auth/forgot-password', { email: 'reset-once@example.com' });
  const token = resetTokenFor('reset-once@example.com');

  assert.equal(
    (await client.api('POST', '/api/auth/reset-password', { token, new_password: 'short' })).status,
    400
  );
  assert.equal(
    (await client.api('POST', '/api/auth/reset-password', { token, new_password: 'newpassword2' })).status,
    200
  );
  assert.equal(
    (await client.api('POST', '/api/auth/reset-password', { token, new_password: 'anotherpass3' })).status,
    400
  );
});

test('a password reset invalidates sessions issued before it', async () => {
  const client = makeClient(app.base);
  await client.api('POST', '/api/auth/signup', {
    email: 'reset-session@example.com',
    password: 'oldpassword1',
  });
  assert.equal((await client.api('GET', '/api/auth/me')).status, 200);

  await client.api('POST', '/api/auth/forgot-password', { email: 'reset-session@example.com' });
  const token = resetTokenFor('reset-session@example.com');

  // Ensure the reset timestamp is strictly after the session's iat (ms clock).
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const resetter = makeClient(app.base);
  assert.equal(
    (await resetter.api('POST', '/api/auth/reset-password', { token, new_password: 'newpassword2' })).status,
    200
  );

  assert.equal((await client.api('GET', '/api/auth/me')).status, 401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/authReset.integration.test.cjs`
Expected: FAIL — `forgot-password` returns 404.

- [ ] **Step 3: Add `iat` to session tokens**

In `backend/src/api/authLib.js`, change `createSessionToken`:

```js
function createSessionToken(userId) {
  return signSession({ userId, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });
}
```

- [ ] **Step 4: Reject pre-reset sessions in `requireAuth`**

In `backend/src/api/access.js`, inside `requireAuth`, immediately after `req.user = user;` in the session branch (before `return next();`), insert:

```js
      // Sessions issued before the last password change are no longer valid.
      // Tokens minted before this feature existed have no `iat` and are kept.
      if (typeof sessionPayload.iat === 'number' && user.password_changed_at) {
        const changedAt = new Date(user.password_changed_at).getTime();
        if (sessionPayload.iat < changedAt) {
          return res.status(401).json({ error: 'Session expired — please sign in again' });
        }
      }
```

- [ ] **Step 5: Add the reset routes to `backend/src/api/routes/auth.js`**

Extend the authTokens import to include `createThrottle`:

```js
const { generateToken, hashToken, expiryFor, createThrottle } = require('../authTokens');
```

Add a module-level throttle near the other constants:

```js
const forgotThrottle = createThrottle({ windowMs: 15 * 60 * 1000, max: 5 });
```

Add both routes after `router.post('/resend-verification', ...)`:

```js
router.post('/forgot-password', async (req, res, next) => {
  try {
    const address = String((req.body || {}).email || '').trim();
    if (!EMAIL_RE.test(address)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    // Always answer the same way, and only send/act within the throttle, so the
    // endpoint cannot be used to enumerate accounts or spam a mailbox.
    if (forgotThrottle.allow(address.toLowerCase())) {
      const { rows } = await query(
        'SELECT id, email FROM users WHERE email = $1 AND is_active = true',
        [address]
      );
      if (rows[0]) {
        await query(
          `UPDATE auth_tokens SET used_at = now()
            WHERE user_id = $1 AND kind = 'password_reset' AND used_at IS NULL`,
          [rows[0].id]
        );
        const raw = generateToken();
        await query(
          `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
           VALUES ($1, 'password_reset', $2, $3)`,
          [rows[0].id, hashToken(raw), expiryFor('password_reset')]
        );
        const link = `${email.appUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
        await email.sendMail({ to: rows[0].email, ...email.passwordResetMessage(link) });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, new_password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    if (!new_password || String(new_password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const { rows } = await query(
      `SELECT id, user_id FROM auth_tokens
        WHERE token_hash = $1 AND kind = 'password_reset'
          AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2',
        [await hashPassword(new_password), row.user_id]
      );
      await client.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id]);
      await client.query(
        `UPDATE auth_tokens SET used_at = now()
          WHERE user_id = $1 AND kind = 'password_reset' AND used_at IS NULL`,
        [row.user_id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `cd /workspace/backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/authReset.integration.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 7: Run backend unit + auth regression suites**

Run: `cd /workspace/backend && npm run test:api:unit`
Expected: PASS (all; `authLib.test.cjs` still passes).

Run: `cd /workspace/backend && PGPORT=5441 INTEGRATION_PGPORT=5441 INTEGRATION_PGDATABASE=apihub ALLOW_SELF_SIGNUP=1 node --test tests/authEmail.integration.test.cjs tests/apiAuth.integration.test.cjs`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add backend/src/api/authLib.js backend/src/api/access.js backend/src/api/routes/auth.js backend/tests/authReset.integration.test.cjs
git commit -m "feat(auth): add password reset and invalidate old sessions"
```

---

## Task 5: Frontend API client, User type, and URL helpers

**Files:**
- Modify: `frontend/src/lib/api.ts:95-103` (`User`), `:285-292` (`authApi`)
- Create: `frontend/src/lib/authLinks.js`
- Create: `frontend/src/lib/__tests__/authLinks.test.cjs`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` in `api.ts`.
- Produces:
  - `User.email_verified?: boolean`.
  - `authApi.forgotPassword(email)`, `authApi.resetPassword(token, newPassword)`, `authApi.verifyEmail(token)`, `authApi.resendVerification()`.
  - `frontend/src/lib/authLinks.js`: `tokenFromSearch(search: string): string | null`, `passwordProblem(password: string, confirm: string): string | null`.

- [ ] **Step 1: Write the failing helper unit test**

Create `frontend/src/lib/__tests__/authLinks.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tokenFromSearch, passwordProblem } = require('../authLinks');

test('tokenFromSearch reads a token, with or without a leading ?', () => {
  assert.equal(tokenFromSearch('?token=abc_123-XYZ'), 'abc_123-XYZ');
  assert.equal(tokenFromSearch('foo=1&token=abc_123-XYZ'), 'abc_123-XYZ');
  assert.equal(tokenFromSearch('?foo=1'), null);
  assert.equal(tokenFromSearch(''), null);
});

test('passwordProblem enforces length and confirmation', () => {
  assert.equal(passwordProblem('longenough', 'longenough'), null);
  assert.equal(passwordProblem('short', 'short'), 'Password must be at least 8 characters');
  assert.equal(passwordProblem('longenough', 'different1'), 'Passwords do not match');
  assert.equal(passwordProblem('', ''), 'Password must be at least 8 characters');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/frontend && node --test src/lib/__tests__/authLinks.test.cjs`
Expected: FAIL — `Cannot find module '../authLinks'`.

- [ ] **Step 3: Write `frontend/src/lib/authLinks.js`**

```js
'use strict';

function tokenFromSearch(search) {
  const raw = String(search || '').replace(/^\?/, '');
  if (!raw) return null;
  for (const part of raw.split('&')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    if (part.slice(0, idx) === 'token') {
      const value = decodeURIComponent(part.slice(idx + 1));
      return value || null;
    }
  }
  return null;
}

function passwordProblem(password, confirm) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value !== String(confirm || '')) return 'Passwords do not match';
  return null;
}

module.exports = { tokenFromSearch, passwordProblem };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/frontend && node --test src/lib/__tests__/authLinks.test.cjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Update `User` and `authApi` in `frontend/src/lib/api.ts`**

In the `User` interface (around lines 95-103), add:

```ts
  email_verified?: boolean;
```

In the `authApi` object (around lines 285-292), add:

```ts
  forgotPassword: (email: string) =>
    apiFetch<{ ok: true }>('/api/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token: string, new_password: string) =>
    apiFetch<{ ok: true }>('/api/auth/reset-password', {
      method: 'POST',
      body: { token, new_password },
    }),
  verifyEmail: (token: string) =>
    apiFetch<{ ok: true }>('/api/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: () =>
    apiFetch<{ ok: true; alreadyVerified?: boolean }>('/api/auth/resend-verification', {
      method: 'POST',
    }),
```

- [ ] **Step 6: Run frontend unit tests + typecheck**

Run: `cd /workspace/frontend && npm test`
Expected: PASS (existing + 2 new).

Run: `cd /workspace/frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/authLinks.js frontend/src/lib/__tests__/authLinks.test.cjs
git commit -m "feat(auth): add frontend reset/verification API and helpers"
```

---

## Task 6: Forgot/reset/verify pages + login link + unverified banner

**Files:**
- Create: `frontend/app/forgot-password/page.tsx`
- Create: `frontend/app/reset-password/page.tsx`
- Create: `frontend/app/verify-email/page.tsx`
- Modify: `frontend/app/login/page.tsx`
- Modify: `frontend/src/components/AppShell.tsx:183-192`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `authApi.forgotPassword/resetPassword/verifyEmail/resendVerification`, `tokenFromSearch`/`passwordProblem`, `useAuth().user.email_verified`, `useAuth().refresh`.
- Produces: three public routes plus an in-app resend banner.

- [ ] **Step 1: Create the forgot-password page**

Create `frontend/app/forgot-password/page.tsx`. Match the login page's `auth-screen`/`auth-shell`/`auth-card` structure (`frontend/app/login/page.tsx:37-110`) and use these test ids: `forgot-form`, `forgot-email`, `forgot-submit`, `forgot-done`, `forgot-error`.

```tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { authApi } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await authApi.forgotPassword(email.trim());
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen" data-testid="auth-screen">
      <div className="auth-shell auth-center">
        <div className="auth-card-wrap">
          <form className="auth-card" onSubmit={onSubmit} data-testid="forgot-form">
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-hint">Enter your account email and we will send a reset link.</p>
            {error && (
              <p className="auth-error" role="alert" data-testid="forgot-error">
                {error}
              </p>
            )}
            {done ? (
              <p className="auth-hint" data-testid="forgot-done">
                If an account exists for that email, a reset link is on its way.
              </p>
            ) : (
              <>
                <label className="auth-field">
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    data-testid="forgot-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="primary-button auth-submit"
                  disabled={busy}
                  data-testid="forgot-submit"
                >
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </>
            )}
            <p className="auth-alt">
              <Link href="/login" data-testid="goto-login">Back to sign in</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the reset-password page**

Create `frontend/app/reset-password/page.tsx`. `useSearchParams()` requires a Suspense boundary in Next 14, so split an inner client component and wrap it. Test ids: `reset-form`, `reset-password`, `reset-confirm`, `reset-submit`, `reset-error`, `reset-invalid`.

```tsx
'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { tokenFromSearch, passwordProblem } from '@/lib/authLinks';

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = tokenFromSearch(params.toString());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      router.replace('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen" data-testid="auth-screen">
      <div className="auth-shell auth-center">
        <div className="auth-card-wrap">
          {!token ? (
            <div className="auth-card" data-testid="reset-invalid">
              <h1 className="auth-title">Link not valid</h1>
              <p className="auth-hint">This reset link is missing its token. Request a new one.</p>
              <p className="auth-alt">
                <Link href="/forgot-password">Request a new link</Link>
              </p>
            </div>
          ) : (
            <form className="auth-card" onSubmit={onSubmit} data-testid="reset-form">
              <h1 className="auth-title">Choose a new password</h1>
              {error && (
                <p className="auth-error" role="alert" data-testid="reset-error">
                  {error}
                </p>
              )}
              <label className="auth-field">
                <span>New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  data-testid="reset-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <label className="auth-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  data-testid="reset-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                className="primary-button auth-submit"
                disabled={busy}
                data-testid="reset-submit"
              >
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-screen" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
```

- [ ] **Step 3: Create the verify-email page**

Create `frontend/app/verify-email/page.tsx`. It reads the token, POSTs it once on mount, and shows success or failure. Test ids: `verify-status`, `verify-error`. Use a `useRef` guard so React strict-mode double-invocation does not consume the token twice.

```tsx
'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { tokenFromSearch } from '@/lib/authLinks';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = tokenFromSearch(params.toString());
  const ran = useRef(false);
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState('');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState('error');
      setError('This verification link is missing its token.');
      return;
    }
    authApi
      .verifyEmail(token)
      .then(() => setState('done'))
      .catch((err) => {
        setState('error');
        setError(err instanceof Error ? err.message : 'Could not verify this email');
      });
  }, [token]);

  return (
    <div className="auth-screen" data-testid="auth-screen">
      <div className="auth-shell auth-center">
        <div className="auth-card-wrap">
          <div className="auth-card" data-testid="verify-status">
            <h1 className="auth-title">Email verification</h1>
            {state === 'working' && <p className="auth-hint">Verifying your email…</p>}
            {state === 'done' && (
              <p className="auth-hint">Your email is verified. You are all set.</p>
            )}
            {state === 'error' && (
              <p className="auth-error" role="alert" data-testid="verify-error">
                {error}
              </p>
            )}
            <p className="auth-alt">
              <Link href="/">Continue to API Hub</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="auth-screen" />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: Add the "Forgot password?" link to the login page**

In `frontend/app/login/page.tsx`, inside the `<form>` after the password field's closing `</label>` and before the submit button, add:

```tsx
        <p className="auth-alt">
          <Link href="/forgot-password" data-testid="goto-forgot">Forgot password?</Link>
        </p>
```

- [ ] **Step 5: Add the unverified banner to `AppShell.tsx`**

In `frontend/src/components/AppShell.tsx`, the component already has `const { user } = useAuth();` (via `useAuth()` around line 137). Add `refresh` to that destructure if not present, plus local state. Insert the banner between `<TopBar ... />` (ends line 191) and `<div className="app-body">` (line 192):

```tsx
      {user && user.email_verified === false && (
        <div className="verify-banner" data-testid="verify-banner">
          <span>Please verify your email address.</span>
          <button
            type="button"
            className="ghost-button small"
            data-testid="verify-resend"
            onClick={async () => {
              try {
                await authApi.resendVerification();
              } catch {
                /* best-effort; the banner persists until verified */
              }
            }}
          >
            Resend email
          </button>
        </div>
      )}
```

Import `authApi` from `@/lib/api` in `AppShell.tsx` (extend the existing `import type { MenuKey } from '@/lib/api';` line to also import the value: `import { authApi } from '@/lib/api';` as a separate import).

- [ ] **Step 6: Add `.verify-banner` styles to `frontend/app/globals.css`**

Append near the other status/banner styles:

```css
.verify-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text, #e6edf3);
  background: var(--warning-bg, rgba(210, 153, 34, 0.14));
  border-bottom: 1px solid var(--warning-border, rgba(210, 153, 34, 0.4));
}
```

- [ ] **Step 7: Typecheck and run unit tests**

Run: `cd /workspace/frontend && npx tsc --noEmit`
Expected: clean.

Run: `cd /workspace/frontend && npm test`
Expected: PASS (all).

- [ ] **Step 8: Manual smoke via the dev server (optional but recommended)**

With the frontend dev server already running on :3000, open `/forgot-password`, `/reset-password?token=x`, and `/verify-email?token=x` and confirm they render without runtime errors. Do not start a new server if one is already running.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/forgot-password/page.tsx frontend/app/reset-password/page.tsx frontend/app/verify-email/page.tsx frontend/app/login/page.tsx frontend/src/components/AppShell.tsx frontend/app/globals.css
git commit -m "feat(auth): add forgot/reset/verify pages and unverified banner"
```

---

## Task 7: Documentation + env example + session log

**Files:**
- Create: `backend/.env.example`
- Modify: `docs/FEATURES.md`
- Modify: `session_v2.md`

- [ ] **Step 1: Create `backend/.env.example`**

```
# Copy to .env (or export) and fill in. Never commit real credentials.
APP_URL=http://localhost:3000
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=noreply@keerainnovations.com
SMTP_PASS=replace-with-the-smtp-password
SMTP_FROM=API Hub <noreply@keerainnovations.com>
```

- [ ] **Step 2: Add a FEATURES.md section**

Append `## 25. Password reset and email verification` after the last section in `docs/FEATURES.md`, covering:
- Endpoints: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`, and the `### Events`-style addition to the §20 endpoint reference if one exists.
- Token model: `auth_tokens` stores `sha256(raw)`, kind, expiry, single use; reset link valid 1 hour, verification link 24 hours.
- No account enumeration on forgot-password; per-email forgot throttle (5 per 15 minutes, in-process).
- `users.email_verified` (existing accounts grandfathered true) and the soft-verification policy (login is never blocked).
- Session invalidation: reset bumps `users.session_epoch` in the same transaction; session tokens carry the epoch as `sv`, and `requireAuth` rejects a token whose `sv` does not match the user's current epoch. This avoids comparing Node and Postgres clocks. Tokens minted before the feature (no `sv`) and API bearer tokens are not affected.
- SMTP configuration via environment variables, and the dev fallback that logs instead of sending when unconfigured.
- v1 limitations: throttle and hub-like state are in-process; expired `auth_tokens` rows are not garbage-collected automatically; API tokens survive a password reset.

- [ ] **Step 3: Append to `session_v2.md`**

Add a `### Password reset + email verification (details)` subsection in the existing style, listing the new files (`authTokens.js`, `email.js`, migration `044_auth_tokens.sql`, the new routes, the new integration tests, and the frontend pages/helpers), the test commands, and the v1 limitations.

- [ ] **Step 4: Commit**

```bash
git add backend/.env.example docs/FEATURES.md session_v2.md
git commit -m "docs: record password reset and email verification"
```

(Push is handled by the controller after the whole-branch review.)

---

## Self-Review

- **Spec coverage:** token storage (T1), SMTP delivery (T2), verification issue/confirm/resend + `email_verified` exposure (T3), forgot/reset + session invalidation (T4), frontend client/helpers (T5), pages + login link + banner (T6), docs/env (T7). No account-enumeration, soft verification, and best-effort email requirements are each implemented in the listed tasks. ✅
- **Placeholder scan:** every code step contains complete code; commands include expected outcomes. No TBD/TODO. ✅
- **Type consistency:** `hashToken`/`generateToken`/`expiryFor`/`createThrottle` names and signatures are identical across T1 (definition), T3, and T4 (use). `email.sendMail`/`verifyEmailMessage`/`passwordResetMessage`/`appUrl`/`setTransportForTest`/`resetTransportForTest` match T2 ↔ T3/T4. `authApi.forgotPassword/resetPassword/verifyEmail/resendVerification` match T5 ↔ T6. `tokenFromSearch`/`passwordProblem` match T5 ↔ T6. `users.email_verified` and `password_changed_at` match migration T1 ↔ access.js T3/T4. ✅
- **Known integration point to watch:** T3 changes `loadUserById` to include `password_changed_at`; `userSummary` strips it, and the only other consumers (`serverRuns.js`, `tokenAuth.js`) attach it to `req.user` without serializing, so no client leak.
