'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './docs.module.css';
import { CheckIcon, CopyIcon } from '@/components/icons';

function CodeBlock({
  code,
  testId,
}: {
  code: string;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (insecure context); the code stays visible.
    }
  }, [code]);

  return (
    <div className={styles.apiRefCurlWrap}>
      <pre className={styles.apiRefCurl} data-testid={testId}>
        {code}
      </pre>
      <button
        type="button"
        className={styles.apiRefCopy}
        onClick={() => void copy()}
        aria-label="Copy snippet"
      >
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className={styles.sdkGuideStep} data-testid={`sdk-guide-step-${n}`}>
      <h2 className={styles.sdkGuideStepTitle}>
        <span className={styles.sdkGuideStepNum}>{n}</span>
        {title}
      </h2>
      <div className={styles.sdkGuideStepBody}>{children}</div>
    </section>
  );
}

const CONFIG_EXAMPLE = `{
  "token": "tkh_...",
  "baseUrl": "https://mockshift.example.com",
  "source": "express",
  "autoSync": true,
  "capture": { "enabled": true },
  "assertions": { "status": true, "json": true },
  "project": "My Project",
  "collection": "Backend"
}`;

const INSTALL = 'npm install mockshift-sdk';

const EXPRESS_CJS = `const express = require('express');
const { attach } = require('mockshift-sdk');

const app = express();

// Must run before routes / app.use(); reads ./mockshift.json
const hub = attach(app, { targetBaseUrl: 'http://localhost:4000' });

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/users/:id', (req, res) => res.json({ id: req.params.id }));

app.listen(4000);`;

const EXPRESS_ESM = `import express from 'express';
import { attach } from 'mockshift-sdk';

const app = express();
const hub = attach(app, { targetBaseUrl: 'http://localhost:4000' });

app.get('/api/users/:id', (req, res) => res.json({ id: req.params.id }));

app.listen(4000);`;

const HTTP_SERVER = `const http = require('http');
const { attachHttp } = require('mockshift-sdk');

const server = http.createServer(handler);
attachHttp(server, { apiKey: process.env.MOCKSHIFT_API_KEY, project: 'My Project' });
server.listen(4000);`;

const ROUTER = `const router = express.Router();
attach(router);
router.get('/users', listUsers);
app.use('/api', router);`;

const ENV_EXAMPLE = `MOCKSHIFT_API_KEY=tkh_...
MOCKSHIFT_BASE_URL=https://mockshift.example.com
MOCKSHIFT_PROJECT=My Project
MOCKSHIFT_COLLECTION=Backend`;

const CLI = 'npx mockshift-sdk sync --config ./mockshift.json';

export function SdkGuide() {
  const router = useRouter();

  return (
    <div className={styles.apiRef} data-testid="sdk-guide">
      <button type="button" className="ghost-button" onClick={() => router.push('/docs')}>
        Back to docs
      </button>

      <header className={styles.apiRefHead}>
        <h1>Install Mockshift in your app</h1>
        <p className={styles.apiRefIntro}>
          Connect an existing Node.js backend to Mockshift with <code>mockshift-sdk</code>. Your
          routes appear as runnable requests, and live traffic teaches Mockshift the request and
          response shapes. About 10 minutes for the first sync.
        </p>
      </header>

      <section className={styles.sdkGuideBefore}>
        <h2 className={styles.apiRefGroupTitle}>Before you start</h2>
        <ul className={styles.rList}>
          <li>Node.js 18 or newer.</li>
          <li>An Express app (v4 or v5) or a plain <code>http.Server</code>.</li>
          <li>A Mockshift account that can create projects and API tokens.</li>
          <li>The Mockshift URL your app can reach, for example <code>https://mockshift.example.com</code>.</li>
        </ul>
      </section>

      <Step n={1} title="Create a project">
        <p>
          Sign in to Mockshift and create or open a project from the top bar. Routes sync into a
          collection inside that project; pick a short, stable name such as <code>Backend</code>.
        </p>
      </Step>

      <Step n={2} title="Create an SDK token">
        <p>
          Open <strong>Settings → API tokens</strong>, create a token, tick the <strong>SDK</strong>{' '}
          scope and choose the project it is bound to. The one-time reveal shows a ready-to-save{' '}
          <code>mockshift.json</code>:
        </p>
        <CodeBlock code={CONFIG_EXAMPLE} testId="sdk-guide-config" />
        <p className={styles.sdkGuideNote}>
          The reveal happens once. If you lose the token, revoke it and create a new one.
        </p>
      </Step>

      <Step n={3} title="Store the config safely">
        <p>
          Save the file next to your server entrypoint (the SDK looks for <code>./mockshift.json</code>),
          but keep it out of version control. If you cannot ship a file, use environment variables
          instead — they override the file, while code options override both.
        </p>
        <CodeBlock code={'# .gitignore\nmockshift.json'} testId="sdk-guide-gitignore" />
        <CodeBlock code={ENV_EXAMPLE} testId="sdk-guide-env" />
      </Step>

      <Step n={4} title="Install the SDK">
        <CodeBlock code={INSTALL} testId="sdk-guide-install" />
        <p className={styles.sdkGuideNote}>
          <code>express</code> is an optional peer dependency — install it only if you use the
          Express adapter.
        </p>
      </Step>

      <Step n={5} title="Attach it before your routes">
        <p>
          Call <code>attach(app)</code> before you define or mount routes, then start the server as
          usual.
        </p>
        <CodeBlock code={EXPRESS_CJS} testId="sdk-guide-express-cjs" />
        <h3 className={styles.sdkGuideSubhead}>ESM / TypeScript</h3>
        <CodeBlock code={EXPRESS_ESM} testId="sdk-guide-express-esm" />
        <h3 className={styles.sdkGuideSubhead}>Plain http.Server</h3>
        <CodeBlock code={HTTP_SERVER} testId="sdk-guide-http" />
        <h3 className={styles.sdkGuideSubhead}>Mounted routers</h3>
        <p>
          <code>app.use('/prefix', router)</code> is not introspected. Attach the router first, or
          call <code>hub.register(...)</code>.
        </p>
        <CodeBlock code={ROUTER} testId="sdk-guide-router" />
      </Step>

      <Step n={6} title="Verify the first sync">
        <p>
          Start your app, then open Mockshift → your project → <code>Backend</code> collection. There
          should be one request per route. To re-sync a running service without restarting it:
        </p>
        <CodeBlock code={CLI} testId="sdk-guide-cli" />
        <p className={styles.sdkGuideNote}>
          The command prints a summary such as{' '}
          <code>requests created: 3, updated: 0, folders created: 2</code>.
        </p>
      </Step>

      <Step n={7} title="Learn from real traffic">
        <p>
          With <code>capture.enabled</code> on, send a few normal requests. The SDK collapses{' '}
          <code>/api/users/42</code> to <code>/api/users/:id</code>, records an inferred response
          schema, and suggests a <code>status == 200</code> assertion plus field-level assertions.
          Explicit <code>hub.test(...)</code> assertions always win over suggestions.
        </p>
      </Step>

      <Step n={8} title="Pin assertions, formulas and scope">
        <CodeBlock
          code={`const hub = attach(app, {
  include: ['/api'],
  exclude: ['/health', '/*'],
  pathRules: [
    { pattern: '/orders/ORD-\\\\d+', replacement: '/orders/:orderId' },
  ],
});

hub.test('GET /api/users/:id', {
  status: 200,
  json: { name: 'Ada' },
  responseTimeMs: 500,
});

hub.register({
  method: 'POST',
  path: '/api/users',
  formula: 'req.body.id = $utils.uuid()',
});`}
          testId="sdk-guide-assertions"
        />
      </Step>

      <Step n={9} title="Production and CI">
        <ul className={styles.rList}>
          <li>Prefer <code>MOCKSHIFT_*</code> environment variables over a committed config file.</li>
          <li>
            <code>autoSync</code> is non-blocking and never crashes your app; route errors to{' '}
            <code>onError</code>.
          </li>
          <li>
            Keep <code>prune</code> off unless you intentionally want requests missing from the
            manifest deleted.
          </li>
          <li>
            In CI, run the CLI and fail the build on a non-zero exit to catch route drift.
          </li>
        </ul>
      </Step>

      <Step n={10} title="Keep it healthy">
        <table className={styles.sdkGuideTable}>
          <thead>
            <tr>
              <th>Symptom</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Missing API key error</td>
              <td>Save <code>mockshift.json</code> or set <code>MOCKSHIFT_API_KEY</code>.</td>
            </tr>
            <tr>
              <td>Sync returns 401</td>
              <td>Token revoked or wrong scope — create a new SDK-scoped token.</td>
            </tr>
            <tr>
              <td>Unknown project</td>
              <td>Set <code>project</code> (needed for a workspace-bound key) and <code>collection</code>.</td>
            </tr>
            <tr>
              <td>No routes synced</td>
              <td><code>attach()</code> ran after routes — move it to the top of your entrypoint.</td>
            </tr>
            <tr>
              <td><code>ALL /*</code> request appears</td>
              <td>A catch-all SPA fallback — add <code>exclude: ['/*']</code>.</td>
            </tr>
            <tr>
              <td>Nothing inferred</td>
              <td>Enable <code>capture</code> and send a few real requests.</td>
            </tr>
          </tbody>
        </table>
      </Step>
    </div>
  );
}

export default SdkGuide;
