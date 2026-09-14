# Mock UX + Formula Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mocks shareable and easy to pick from requests, add VS Code-style formula autocomplete, and restructure the mock server UI into a guided, understandable flow.

**Architecture:** Four independent slices: (1) a shareable mock link via a Next `/mock` proxy plus a copy button; (2) a reusable `MockRoutePicker` embedded in the add/edit request forms that lists the project's mock routes and fills method+URL; (3) a CodeMirror completion source for the formula editor; (4) a behavior-preserving extraction of the 1274-line `MockScenariosPanel` into a hook + tabbed presentational components with plain-language labels. Pure logic lives in CommonJS `.js` modules under `frontend/src/lib/` so the existing `node --test` frontend runner can cover it.

**Tech Stack:** Next.js 14 (App Router, client components), React 18, CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/autocomplete` 6.20.3 already present transitively), TypeScript for components, scoped `*.module.css`, node:test for pure helpers.

## Global Constraints

- Never edit `frontend/app/globals.css` from a component; add new classes to `frontend/src/components/mocks/mocks.module.css` (scoped). Reuse existing global classes (`compact-select`, `text-input`, `ghost-button`, `primary-button`, `hint`) where possible.
- FE conventions: `apiFetch`/`ApiError`, `data-testid` on interactive elements, `useApp().dispatch({ type: 'SHOW_TOAST', kind, message })` for feedback, `Modal` wrapper for dialogs.
- Frontend unit tests must be `.cjs` in `frontend/src/lib/__tests__/` and require a CommonJS `.js` module; run with `cd frontend && npm test`.
- Backend public mock URL is mounted at `/mock/:projectId/*` (`backend/src/api/server.js:113-115`); no slug/token exists.
- Do not change backend behavior in this plan. Do not stage `docs/superpowers/`. Do not commit `frontend/tsconfig.tsbuildinfo`.
- Each phase must leave `cd frontend && npx tsc --noEmit` clean.

## File Structure

**New**
- `frontend/src/lib/clipboard.ts` — `copyText` with clipboard API + legacy fallback.
- `frontend/src/lib/mockRoutes.js` — pure route→URL + filter helpers (CJS).
- `frontend/src/lib/formulaSnippets.js` — shared snippet list (CJS) extracted from `FormulaHelper`.
- `frontend/src/lib/formulaCompletions.js` — completion data + pure source (CJS).
- `frontend/src/components/mocks/MockServerLink.tsx` — base-URL display + copy button.
- `frontend/src/components/mocks/useProjectMockRoutes.ts` — lazy loader for a project's server+routes.
- `frontend/src/components/mocks/MockRoutePicker.tsx` — selectable route suggestion popover.
- `frontend/src/components/mocks/useMockServerAdmin.ts` — extracted state/actions for the mock page.
- `frontend/src/components/mocks/MockServerOverviewTab.tsx`
- `frontend/src/components/mocks/MockEndpointsTab.tsx`
- `frontend/src/components/mocks/MockScenariosTab.tsx`
- `frontend/src/components/mocks/MockResponsesTab.tsx`
- `frontend/src/components/mocks/MockCallLogTab.tsx`
- `frontend/src/lib/__tests__/mockRoutes.test.cjs`
- `frontend/src/lib/__tests__/formulaCompletions.test.cjs`

**Modified**
- `frontend/next.config.mjs` — add `/mock/:path*` rewrite.
- `frontend/src/lib/mockServer.js` — add `mockBasePath`, `mockBaseUrl(projectId, origin)`, `mockRequestBaseUrl`.
- `frontend/src/lib/__tests__/mockServer.test.cjs` — update `mockBaseUrl` expectations, add request-base test.
- `frontend/src/components/MockServersModal.tsx` — use `MockServerLink`.
- `frontend/src/components/mocks/mocks.module.css` — new classes.
- `frontend/src/components/CodeEditor.tsx` — optional `completions` prop.
- `frontend/src/components/FormulaHelper.tsx` — import shared snippets.
- `frontend/src/components/RequestConfigurator.tsx` — picker + formula completions.
- `frontend/src/components/CreateModal.tsx` — picker on the add-request form.
- `frontend/src/components/ScratchpadWorkspace.tsx`, `frontend/src/components/WorkflowBuilder.tsx` — formula completions.
- `frontend/src/components/mocks/MockScenariosPanel.tsx` — rewritten tabbed shell.
- `frontend/package.json` — declare `@codemirror/autocomplete`.

---

## Phase 1 — Shareable mock link + copy

### Task 1: Proxy `/mock` through Next and split the base-URL helpers

**Files:**
- Modify: `frontend/next.config.mjs`
- Modify: `frontend/src/lib/mockServer.js`
- Test: `frontend/src/lib/__tests__/mockServer.test.cjs`

**Interfaces:**
- Produces:
  - `mockBasePath(projectId: string): string` → `/mock/<projectId>` (SSR-safe, relative).
  - `mockBaseUrl(projectId: string, origin?: string): string` → origin-prefixed shareable URL, or the relative path when no origin.
  - `mockRequestBaseUrl(projectId: string): string` → `http://127.0.0.1:3001/mock/<projectId>` (backend origin the request runner can fetch), overridable by `NEXT_PUBLIC_MOCK_REQUEST_ORIGIN`.

- [ ] **Step 1: Update the failing test**

Replace the final test in `frontend/src/lib/__tests__/mockServer.test.cjs` and update the import:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMockHeaders, mockBasePath, mockBaseUrl, mockRequestBaseUrl } = require('../mockServer');

// ...keep the four parseMockHeaders tests unchanged...

test('mockBasePath is the relative dispatch path', () => {
  assert.equal(mockBasePath('proj-123'), '/mock/proj-123');
});

test('mockBaseUrl returns the relative path without an origin', () => {
  assert.equal(mockBaseUrl('proj-123'), '/mock/proj-123');
});

test('mockBaseUrl prefixes a browser origin and trims trailing slashes', () => {
  assert.equal(mockBaseUrl('proj-123', 'https://app.example.com/'), 'https://app.example.com/mock/proj-123');
});

test('mockRequestBaseUrl targets the backend origin the runner can fetch', () => {
  assert.equal(mockRequestBaseUrl('proj-123'), 'http://127.0.0.1:3001/mock/proj-123');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node --test src/lib/__tests__/mockServer.test.cjs`
Expected: FAIL — `mockBasePath`/`mockRequestBaseUrl` undefined; `mockBaseUrl('proj-123')` returns the old `http://127.0.0.1:3001/...`.

- [ ] **Step 3: Implement the helpers**

Replace the `mockBaseUrl` block in `frontend/src/lib/mockServer.js` with:

```js
const DEFAULT_MOCK_REQUEST_ORIGIN = 'http://127.0.0.1:3001';

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * Relative path a project's mock server is served at. Safe to render during
 * SSR (no `window`). The backend mounts the dispatcher at /mock/:projectId/*.
 */
function mockBasePath(projectId) {
  return `/mock/${projectId}`;
}

/**
 * Shareable absolute URL as seen by a browser (through the Next /mock proxy).
 * Falls back to the relative path when no origin is known yet.
 */
function mockBaseUrl(projectId, origin) {
  const host = trimTrailingSlashes(origin);
  return host ? `${host}${mockBasePath(projectId)}` : mockBasePath(projectId);
}

/**
 * Absolute URL the backend request runner can fetch directly when a request is
 * pointed at the mock server. Overridable for deployments.
 */
function mockRequestBaseUrl(projectId) {
  const origin = trimTrailingSlashes(
    process.env.NEXT_PUBLIC_MOCK_REQUEST_ORIGIN || DEFAULT_MOCK_REQUEST_ORIGIN
  );
  return `${origin}${mockBasePath(projectId)}`;
}

module.exports = { parseMockHeaders, mockBasePath, mockBaseUrl, mockRequestBaseUrl };
```

Add the rewrite to `frontend/next.config.mjs`:

```js
async rewrites() {
  return [
    {
      source: '/api/:path*',
      destination: 'http://127.0.0.1:3001/api/:path*',
    },
    {
      source: '/mock/:path*',
      destination: 'http://127.0.0.1:3001/mock/:path*',
    },
  ];
},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node --test src/lib/__tests__/mockServer.test.cjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/next.config.mjs frontend/src/lib/mockServer.js frontend/src/lib/__tests__/mockServer.test.cjs
git commit -m "feat(mock): proxy /mock through Next and split shareable/request base URLs"
```

### Task 2: Shared clipboard helper

**Files:**
- Create: `frontend/src/lib/clipboard.ts`

**Interfaces:**
- Produces: `copyText(text: string): Promise<boolean>`.

- [ ] **Step 1: Implement the helper**

```ts
'use client';

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available
 * (secure contexts) and falls back to a hidden textarea + execCommand.
 * Returns whether the copy succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/clipboard.ts
git commit -m "feat(mock): add shared copyText clipboard helper"
```

### Task 3: `MockServerLink` display + copy button

**Files:**
- Create: `frontend/src/components/mocks/MockServerLink.tsx`
- Modify: `frontend/src/components/mocks/mocks.module.css`
- Modify: `frontend/src/components/MockServersModal.tsx`
- Modify: `frontend/src/components/mocks/MockScenariosPanel.tsx` (header only; full rewrite happens in Task 11)

**Interfaces:**
- Consumes: `mockBasePath`, `mockBaseUrl` (Task 1), `copyText` (Task 2), `useApp` toast.
- Produces: `<MockServerLink projectId={string} />`.

- [ ] **Step 1: Create the component**

`frontend/src/components/mocks/MockServerLink.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { mockBasePath, mockBaseUrl } from '@/lib/mockServer';
import { copyText } from '@/lib/clipboard';
import { useApp } from '@/store/AppStore';
import styles from './mocks.module.css';

export function MockServerLink({ projectId }: { projectId: string }) {
  const { dispatch } = useApp();
  const [origin, setOrigin] = useState('');

  // Read the browser origin after mount so SSR and the first client render agree.
  useEffect(() => setOrigin(window.location.origin), []);

  const display = origin ? mockBaseUrl(projectId, origin) : mockBasePath(projectId);

  const onCopy = async () => {
    const ok = await copyText(mockBaseUrl(projectId, window.location.origin));
    dispatch({
      type: 'SHOW_TOAST',
      kind: ok ? 'success' : 'error',
      message: ok ? 'Mock server link copied.' : 'Could not copy the link.',
    });
  };

  return (
    <span className={styles.linkRow} data-testid="mock-server-link">
      <code className={styles.linkValue} title={display}>
        {display}
      </code>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        data-testid="mock-copy-link"
        onClick={onCopy}
      >
        Copy link
      </button>
    </span>
  );
}
```

- [ ] **Step 2: Add CSS**

Append to `frontend/src/components/mocks/mocks.module.css`:

```css
.linkRow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.linkValue {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}
```

- [ ] **Step 3: Use it in `MockServersModal`**

Add `import { MockServerLink } from './mocks/MockServerLink';`. Replace the `<code className="mock-base-url" data-testid="mock-base-url">{mockBaseUrlValue}</code>` block (around line 289-291) with `<MockServerLink projectId={projectId} />`. Remove the now-unused `const mockBaseUrlValue = mockBaseUrl(projectId);` if no other reference remains (the hint text at lines 261-262/314-318 uses it; keep it for those, or swap those `<code>` values to `mockBasePath(projectId)`). Use `mockBasePath` for the inline hint examples and delete `mockBaseUrlValue`.

- [ ] **Step 4: Use it in the panel header**

In `frontend/src/components/mocks/MockScenariosPanel.tsx`, import `MockServerLink` and replace `<code>{mockBaseUrl(projectId)}</code>` inside the subtitle (line 539) with `<MockServerLink projectId={projectId} />`. Keep the `X-Mock-Scenario` hint text.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/mocks/MockServerLink.tsx frontend/src/components/mocks/mocks.module.css frontend/src/components/MockServersModal.tsx frontend/src/components/mocks/MockScenariosPanel.tsx
git commit -m "feat(mock): show and copy the shareable mock server link"
```

---

## Phase 2 — Mock route picker in Add/Edit request

### Task 4: Pure route helpers

**Files:**
- Create: `frontend/src/lib/mockRoutes.js`
- Test: `frontend/src/lib/__tests__/mockRoutes.test.cjs`

**Interfaces:**
- Produces:
  - `ensureLeadingSlash(path: string): string`
  - `pathToRequestPath(routePath: string): string` — `:id` → `{{id}}`.
  - `mockRouteUrl(baseUrl: string, routePath: string): string`
  - `filterMockRoutes(routes: Array<{method:string;path:string}>, query: string): typeof routes`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/__tests__/mockRoutes.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureLeadingSlash, pathToRequestPath, mockRouteUrl, filterMockRoutes } = require('../mockRoutes');

test('ensureLeadingSlash normalizes paths', () => {
  assert.equal(ensureLeadingSlash('users'), '/users');
  assert.equal(ensureLeadingSlash('/users'), '/users');
  assert.equal(ensureLeadingSlash('  '), '/');
});

test('pathToRequestPath converts :params to {{param}} placeholders', () => {
  assert.equal(pathToRequestPath('/users/:id'), '/users/{{id}}');
  assert.equal(pathToRequestPath('/orders/:orderId/items/:itemId'), '/orders/{{orderId}}/items/{{itemId}}');
  assert.equal(pathToRequestPath('users'), '/users');
});

test('mockRouteUrl joins base and converted path without double slashes', () => {
  assert.equal(
    mockRouteUrl('http://127.0.0.1:3001/mock/p1', '/users/:id'),
    'http://127.0.0.1:3001/mock/p1/users/{{id}}'
  );
  assert.equal(
    mockRouteUrl('http://127.0.0.1:3001/mock/p1/', 'users'),
    'http://127.0.0.1:3001/mock/p1/users'
  );
});

test('filterMockRoutes matches method and path case-insensitively', () => {
  const routes = [
    { method: 'GET', path: '/users' },
    { method: 'POST', path: '/orders' },
  ];
  assert.equal(filterMockRoutes(routes, '').length, 2);
  assert.equal(filterMockRoutes(routes, 'post').length, 1);
  assert.equal(filterMockRoutes(routes, 'users').length, 1);
  assert.equal(filterMockRoutes(routes, 'orders').length, 1);
  assert.equal(filterMockRoutes(routes, 'nope').length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test src/lib/__tests__/mockRoutes.test.cjs`
Expected: FAIL — cannot find module `../mockRoutes`.

- [ ] **Step 3: Implement**

`frontend/src/lib/mockRoutes.js`:

```js
'use strict';

function ensureLeadingSlash(path) {
  const value = String(path == null ? '' : path).trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * Express-style route paths use `:name` segments; the repository's request
 * runner substitutes `{{name}}` from variables, so convert on insert.
 */
function pathToRequestPath(routePath) {
  return ensureLeadingSlash(routePath).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{{$1}}');
}

function mockRouteUrl(baseUrl, routePath) {
  return `${trimTrailingSlashes(baseUrl)}${pathToRequestPath(routePath)}`;
}

function filterMockRoutes(routes, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return routes;
  return routes.filter((route) => `${route.method} ${route.path}`.toLowerCase().includes(q));
}

module.exports = { ensureLeadingSlash, pathToRequestPath, mockRouteUrl, filterMockRoutes };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node --test src/lib/__tests__/mockRoutes.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/mockRoutes.js frontend/src/lib/__tests__/mockRoutes.test.cjs
git commit -m "feat(mock): add route-to-request path helpers"
```

### Task 5: `useProjectMockRoutes` + `MockRoutePicker`

**Files:**
- Create: `frontend/src/components/mocks/useProjectMockRoutes.ts`
- Create: `frontend/src/components/mocks/MockRoutePicker.tsx`
- Modify: `frontend/src/components/mocks/mocks.module.css`

**Interfaces:**
- Consumes: `mockServerApi` (`@/lib/api`), `mockBaseUrl`/`mockRequestBaseUrl` (Task 1), `mockRouteUrl`/`filterMockRoutes` (Task 4).
- Produces:
  - `useProjectMockRoutes(projectId, enabled)` → `{ server, routes, loading, error }`.
  - `<MockRoutePicker projectId disabled onPick={({ method, url }) => void} />` where `method` is `HttpMethod | undefined` (undefined when the route matches any method).

- [ ] **Step 1: Create the hook**

`frontend/src/components/mocks/useProjectMockRoutes.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { mockServerApi, type MockRoute, type MockServer } from '@/lib/api';

export function useProjectMockRoutes(
  projectId: string | null | undefined,
  enabled: boolean
): { server: MockServer | null; routes: MockRoute[]; loading: boolean; error: string } {
  const [server, setServer] = useState<MockServer | null>(null);
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!projectId) {
      setServer(null);
      setRoutes([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { mockServer } = await mockServerApi.get(projectId);
      setServer(mockServer);
      if (!mockServer) {
        setRoutes([]);
        return;
      }
      const { routes: list } = await mockServerApi.routes(mockServer.id);
      setRoutes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mock routes');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return { server, routes, loading, error };
}
```

- [ ] **Step 2: Create the picker**

`frontend/src/components/mocks/MockRoutePicker.tsx`:

```tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { HttpMethod } from '@/lib/types';
import { mockRequestBaseUrl } from '@/lib/mockServer';
import { filterMockRoutes, mockRouteUrl } from '@/lib/mockRoutes';
import { useProjectMockRoutes } from './useProjectMockRoutes';
import styles from './mocks.module.css';

export interface MockRoutePick {
  method?: HttpMethod;
  url: string;
}

export function MockRoutePicker({
  projectId,
  disabled,
  onPick,
}: {
  projectId: string;
  disabled?: boolean;
  onPick: (pick: MockRoutePick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { server, routes, loading, error } = useProjectMockRoutes(projectId, open);

  const visible = useMemo(() => filterMockRoutes(routes, query), [routes, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setHighlight(0), [query, open]);

  const choose = (index: number) => {
    const route = visible[index];
    if (!route) return;
    onPick({
      method: route.method === '*' ? undefined : (route.method as HttpMethod),
      url: mockRouteUrl(mockRequestBaseUrl(projectId), route.path),
    });
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(highlight);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const noServer = !loading && !server;

  return (
    <div className={styles.picker} ref={boxRef}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        data-testid="mock-route-picker-open"
        disabled={disabled || !projectId}
        onClick={() => setOpen((value) => !value)}
        title="Pick a mock server route to fill the method and URL"
      >
        Mock route
      </button>
      {open ? (
        <div className={styles.pickerPop} role="listbox" data-testid="mock-route-picker-pop">
          {noServer ? (
            <p className={styles.pickerEmpty}>
              This project has no mock server. Create one in Mock server, then come back.
            </p>
          ) : (
            <>
              <input
                autoFocus
                className={styles.input}
                placeholder="Search routes (e.g. users, POST)"
                aria-label="Search mock routes"
                data-testid="mock-route-picker-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
              />
              {loading ? <p className={styles.pickerEmpty}>Loading…</p> : null}
              {error ? <p className={styles.pickerEmpty}>{error}</p> : null}
              {!loading && !error && visible.length === 0 ? (
                <p className={styles.pickerEmpty}>No routes match “{query}”.</p>
              ) : null}
              <ul className={styles.pickerList}>
                {visible.map((route, index) => (
                  <li key={route.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      className={`${styles.pickerOption} ${index === highlight ? styles.pickerOptionActive : ''}`}
                      data-testid={`mock-route-picker-option-${index}`}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(index)}
                    >
                      <span className={styles.pickerMethod}>{route.method}</span>
                      <code className={styles.pickerPath}>{route.path}</code>
                      <span className={styles.pickerStatus}>{route.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Add CSS**

Append to `frontend/src/components/mocks/mocks.module.css`:

```css
.picker {
  position: relative;
  display: inline-flex;
}

.pickerPop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: 340px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 10px;
  background: var(--panel, #12161d);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
}

.pickerList {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
}

.pickerOption {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.pickerOptionActive {
  background: rgba(57, 217, 138, 0.14);
}

.pickerMethod {
  font-size: 11px;
  font-weight: 700;
  min-width: 52px;
  color: #39d98a;
}

.pickerPath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pickerStatus {
  font-size: 11px;
  opacity: 0.7;
}

.pickerEmpty {
  margin: 8px 0 0;
  font-size: 12px;
  opacity: 0.75;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/mocks/useProjectMockRoutes.ts frontend/src/components/mocks/MockRoutePicker.tsx frontend/src/components/mocks/mocks.module.css
git commit -m "feat(mock): add project mock-route suggestion picker"
```

### Task 6: Wire the picker into the edit request bar

**Files:**
- Modify: `frontend/src/components/RequestConfigurator.tsx`

**Interfaces:**
- Consumes: `MockRoutePicker` (Task 5), `useWorkspace().tree`/`activeCollectionId`.

- [ ] **Step 1: Derive the active project id**

After `const request = ws.activeRequest;` add:

```tsx
const activeCollection = ws.tree?.collections.find((c) => c.id === ws.activeCollectionId);
const mockProjectId = activeCollection?.project_id ?? ws.tree?.projects?.[0]?.id ?? '';
```

- [ ] **Step 2: Render the picker**

Import `import { MockRoutePicker } from './mocks/MockRoutePicker';`. Insert immediately after the `url-input` element (line 193) and before `request-bar-actions`:

```tsx
<MockRoutePicker
  projectId={mockProjectId}
  disabled={ws.requestRunning}
  onPick={({ method: pickedMethod, url: pickedUrl }) =>
    update(pickedMethod ? { method: pickedMethod, url: pickedUrl } : { url: pickedUrl })
  }
/>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RequestConfigurator.tsx
git commit -m "feat(mock): pick a mock route when editing a request"
```

### Task 7: Wire the picker into the create-request modal

**Files:**
- Modify: `frontend/src/components/CreateModal.tsx`

**Interfaces:**
- Consumes: `MockRoutePicker` (Task 5). `CreateModal` already calls `useWorkspace()` and receives `collectionId?: string`.

- [ ] **Step 1: Derive the project id**

Near the other state in `CreateModal`, add:

```tsx
const mockProjectId = collectionId
  ? ws.tree?.collections.find((c) => c.id === collectionId)?.project_id ?? ''
  : '';
```

- [ ] **Step 2: Render the picker under the URL field**

Import `import { MockRoutePicker } from './mocks/MockRoutePicker';`. Inside the `mode === 'form'` branch, immediately after the `create-method-url` div (line 380), add:

```tsx
<div className="create-mock-route">
  <MockRoutePicker
    projectId={mockProjectId}
    onPick={({ method: pickedMethod, url: pickedUrl }) => {
      if (pickedMethod) setMethod(pickedMethod);
      onUrlChange(pickedUrl);
    }}
  />
  <span className="hint">Fill the method and URL from a route on this project&apos;s mock server.</span>
</div>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CreateModal.tsx
git commit -m "feat(mock): pick a mock route when creating a request"
```

---

## Phase 3 — Formula autocomplete

### Task 8: Shared snippets + completion source

**Files:**
- Create: `frontend/src/lib/formulaSnippets.js`
- Create: `frontend/src/lib/formulaCompletions.js`
- Test: `frontend/src/lib/__tests__/formulaCompletions.test.cjs`
- Modify: `frontend/src/components/FormulaHelper.tsx`

**Interfaces:**
- Produces:
  - `formulaSnippets.SNIPPETS: Array<{title:string;code:string;description:string}>`
  - `formulaCompletions.FORMULA_COMPLETIONS: Array<{label,type,detail,info?,boost?}>`
  - `formulaCompletions.completionsFor(word: string): typeof FORMULA_COMPLETIONS`
  - `formulaCompletions.formulaCompletionSource(context): { from:number; options } | null`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/__tests__/formulaCompletions.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { completionsFor, formulaCompletionSource, FORMULA_COMPLETIONS } = require('../formulaCompletions');

test('top-level completions expose sandbox globals and JS built-ins', () => {
  const labels = FORMULA_COMPLETIONS.map((c) => c.label);
  for (const expected of ['req', '$vars', '$utils', 'JSON', 'Object', 'Math']) {
    assert.ok(labels.includes(expected), `missing ${expected}`);
  }
});

test('req. suggests request properties', () => {
  const labels = completionsFor('req.').map((c) => c.label);
  assert.ok(labels.includes('body'));
  assert.ok(labels.includes('headers'));
});

test('$utils. suggests utility helpers', () => {
  const labels = completionsFor('$utils.').map((c) => c.label);
  assert.ok(labels.includes('uuid'));
  assert.ok(labels.includes('now'));
});

test('explicit completion after a bare dot returns options', () => {
  const context = { pos: 4, explicit: false, matchBefore: () => ({ from: 0, to: 4, text: 'req.' }) };
  const result = formulaCompletionSource(context);
  assert.ok(result);
  assert.equal(result.from, 4);
  assert.ok(result.options.some((o) => o.label === 'body'));
});

test('no match and not explicit returns null', () => {
  const context = { pos: 0, explicit: false, matchBefore: () => null };
  assert.equal(formulaCompletionSource(context), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test src/lib/__tests__/formulaCompletions.test.cjs`
Expected: FAIL — cannot find module `../formulaCompletions`.

- [ ] **Step 3: Extract the snippets**

Create `frontend/src/lib/formulaSnippets.js` by moving the current `SNIPPETS` array verbatim from `frontend/src/components/FormulaHelper.tsx:12-108`:

```js
'use strict';

// Shared between the Formula helper panel and the editor's autocomplete so a
// snippet only needs to be maintained once.
const SNIPPETS = [
  // ...paste the existing 19 snippet objects unchanged...
];

module.exports = { SNIPPETS };
```

Then in `frontend/src/components/FormulaHelper.tsx`, delete the local `SNIPPETS`/`HelperSnippet` definitions and add:

```tsx
import { SNIPPETS } from '@/lib/formulaSnippets';
```

Keep `interface HelperSnippet` only if still referenced; otherwise remove it.

- [ ] **Step 4: Implement the completion source**

`frontend/src/lib/formulaCompletions.js`:

```js
'use strict';

const { SNIPPETS } = require('./formulaSnippets');

const REQUEST_PROPERTIES = ['body', 'headers', 'query', 'queryParams', 'url', 'method', 'name'];

const UTILITIES = [
  'uuid', 'randomInt', 'now', 'timestamp', 'addDays', 'addHours', 'addMinutes',
  'addMonths', 'round', 'capitalize', 'lower', 'upper', 'trim', 'base64Encode',
  'base64Decode',
];

const JS_BUILTINS = [
  'JSON', 'Object', 'Array', 'Math', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Map', 'Set', 'Promise', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone',
];

function option(label, type, detail) {
  return { label, type, detail, boost: type === 'variable' ? 1 : 0 };
}

const REQUEST_OPTIONS = REQUEST_PROPERTIES.map((label) => option(label, 'property', 'req.'));
const UTILITY_OPTIONS = UTILITIES.map((label) => option(label, 'function', '$utils'));
const BUILTIN_OPTIONS = JS_BUILTINS.map((label) => option(label, 'class', 'JavaScript'));
const SNIPPET_OPTIONS = SNIPPETS.map((snippet) =>
  option(snippet.title, 'text', snippet.code)
);

const FORMULA_COMPLETIONS = [
  option('req', 'variable', 'Incoming request'),
  option('$vars', 'variable', 'Captured variables'),
  option('$utils', 'variable', 'Sandbox helpers'),
  ...BUILTIN_OPTIONS,
  ...SNIPPET_OPTIONS,
];

/** Options relevant to the token the caret is inside. */
function completionsFor(word) {
  const text = String(word || '');
  if (text.startsWith('$utils.')) return UTILITY_OPTIONS;
  if (text.startsWith('req.')) return REQUEST_OPTIONS;
  if (text.startsWith('$vars.')) return [];
  return FORMULA_COMPLETIONS;
}

// Matches the dotted identifier fragment before the caret, e.g. `req.hea`.
const TOKEN = /[\w$.]*/;

/**
 * CodeMirror completion source. Kept free of any CodeMirror import so it can be
 * unit tested with a small fake context.
 */
function formulaCompletionSource(context) {
  const before = context.matchBefore(TOKEN);
  if (!before || (before.from === before.to && !context.explicit)) return null;
  const word = before.text;
  const dot = word.lastIndexOf('.');
  const from = before.from + (dot >= 0 ? dot + 1 : 0);
  return { from, options: completionsFor(word) };
}

module.exports = {
  FORMULA_COMPLETIONS,
  REQUEST_OPTIONS,
  UTILITY_OPTIONS,
  completionsFor,
  formulaCompletionSource,
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && node --test src/lib/__tests__/formulaCompletions.test.cjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/formulaSnippets.js frontend/src/lib/formulaCompletions.js frontend/src/lib/__tests__/formulaCompletions.test.cjs frontend/src/components/FormulaHelper.tsx
git commit -m "feat(formula): add shared snippets and completion source"
```

### Task 9: Enable completions in CodeEditor and the three formula editors

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/components/CodeEditor.tsx`
- Modify: `frontend/src/components/RequestConfigurator.tsx`
- Modify: `frontend/src/components/ScratchpadWorkspace.tsx`
- Modify: `frontend/src/components/WorkflowBuilder.tsx`

**Interfaces:**
- Consumes: `formulaCompletionSource` (Task 8).
- Produces: `CodeEditor` prop `completions?: boolean`.

- [ ] **Step 1: Declare the dependency**

Add to `dependencies` in `frontend/package.json` (already installed at 6.20.3):

```json
"@codemirror/autocomplete": "^6.20.3",
```

Run `cd frontend && npm install` so the lockfile records it.

- [ ] **Step 2: Add the `completions` prop**

In `frontend/src/components/CodeEditor.tsx`:

```tsx
import { autocompletion } from '@codemirror/autocomplete';
import { formulaCompletionSource } from '@/lib/formulaCompletions';
```

Add `completions?: boolean;` to `CodeEditorProps` and `completions = false,` to the destructured params. Build extensions as an array instead of the current ternary:

```tsx
const extensions = [
  ...baseExtensions,
  ...(completions ? [autocompletion({ override: [formulaCompletionSource] })] : []),
  ...(onModEnter
    ? [
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onModEnter();
                return true;
              },
            },
          ])
        ),
      ]
    : []),
];
```

- [ ] **Step 3: Turn completions on for the formula editors**

In `frontend/src/components/RequestConfigurator.tsx`, add `completions` to the formula `CodeEditor` (line 321). Also add `completions` to the request-body editor only if desired — leave the body editor off. In `frontend/src/components/ScratchpadWorkspace.tsx` (around line 305) and `frontend/src/components/WorkflowBuilder.tsx` (around line 484), add `completions` to the formula `CodeEditor` props.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/CodeEditor.tsx frontend/src/components/RequestConfigurator.tsx frontend/src/components/ScratchpadWorkspace.tsx frontend/src/components/WorkflowBuilder.tsx
git commit -m "feat(formula): add in-editor autocomplete suggestions"
```

---

## Phase 4 — Guided mock UI redesign

The redesign is behavior-preserving: every API call and piece of state currently in `MockScenariosPanel.tsx:218-529` moves into `useMockServerAdmin`. The render is split into tabs with plain-language labels and inline guidance.

### Task 10: Extract `useMockServerAdmin`

**Files:**
- Create: `frontend/src/components/mocks/useMockServerAdmin.ts`
- Modify: `frontend/src/components/mocks/MockScenariosPanel.tsx` (temporarily import the hook; full shell rewrite in Task 11)

**Interfaces:**
- Produces: `useMockServerAdmin(projectId)` returning all current state, derived values, and actions used by the panel:
  `{ server, scenarios, routes, logs, scenarioLinks, linksByScenario, selectedRouteId, responses, loading, busy, error, notice, newScenarioName, setNewScenarioName, newServerName, setNewServerName, showForm, setShowForm, showRouteForm, editingRouteId, routeDraft, setRouteDraft, draft, setDraft, replay, expandedLogId, setExpandedLogId, expandedScenarioId, setExpandedScenarioId, showDefaultOverrides, setShowDefaultOverrides, load, handleRouteSelect, createScenario, createServer, deleteScenario, startAddRoute, startEditRoute, cancelRouteForm, submitRoute, deleteRoute, updateCondition, addCondition, removeCondition, submitResponse, deleteResponse, resetSequence, clearLogs, replayCall, scenarioName, groupLinksByRoute, CallLogDetail }`.

- [ ] **Step 1: Move state and actions**

Create the hook and move, unchanged, from `MockScenariosPanel.tsx`:
- state declarations and refs: lines 219-245;
- `refreshResponses`, `refreshLinks`, `load`: lines 247-314;
- `linksByScenario` memo: 316-329;
- `handleRouteSelect`: 331-337;
- `withBusy`, `createScenario`, `createServer`, `deleteScenario`, `cancelRouteForm`, `startAddRoute`, `startEditRoute`, `submitRoute`, `deleteRoute`, `updateCondition`, `addCondition`, `removeCondition`, `submitResponse`, `deleteResponse`, `resetSequence`, `clearLogs`, `replayCall`, `scenarioName`: 339-529.

Also move the pure helpers `emptyDraft`, `emptyRouteDraft`, `toRouteDraft`, `parseHeaders`, `toConditionPayload`, `groupLinksByRoute`, `prettyJson`, `formatTimestamp`, `CallLogDetail` into the hook module (export `groupLinksByRoute`, `prettyJson`, `formatTimestamp`, `CallLogDetail`, and the draft types/helpers so tab components can use them).

The hook signature and return:

```ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// ...existing imports...

export function useMockServerAdmin(projectId: string) {
  // ...moved state + actions...
  return {
    server, scenarios, routes, logs, scenarioLinks, linksByScenario,
    selectedRouteId, responses, loading, busy, error, notice,
    newScenarioName, setNewScenarioName, newServerName, setNewServerName,
    showForm, setShowForm, showRouteForm, editingRouteId, routeDraft, setRouteDraft,
    draft, setDraft, replay, expandedLogId, setExpandedLogId,
    expandedScenarioId, setExpandedScenarioId, showDefaultOverrides, setShowDefaultOverrides,
    load, handleRouteSelect, createScenario, createServer, deleteScenario,
    startAddRoute, startEditRoute, cancelRouteForm, submitRoute, deleteRoute,
    updateCondition, addCondition, removeCondition, submitResponse, deleteResponse,
    resetSequence, clearLogs, replayCall, scenarioName,
  };
}
```

- [ ] **Step 2: Export the shared helpers**

From `useMockServerAdmin.ts` add named exports:

```ts
export {
  emptyDraft, emptyRouteDraft, toRouteDraft, parseHeaders, toConditionPayload,
  groupLinksByRoute, prettyJson, formatTimestamp, CallLogDetail,
};
export type { ResponseDraft, RouteDraft };
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0 (the panel still uses its own inline copies until Task 11; the hook is not yet imported anywhere, which is fine).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/mocks/useMockServerAdmin.ts
git commit -m "refactor(mock): extract mock server admin state and actions into a hook"
```

### Task 11: New tabbed shell + Overview tab

**Files:**
- Create: `frontend/src/components/mocks/MockServerOverviewTab.tsx`
- Modify: `frontend/src/components/mocks/MockScenariosPanel.tsx`
- Modify: `frontend/src/components/mocks/mocks.module.css`

**Interfaces:**
- Consumes: `useMockServerAdmin` (Task 10), `MockServerLink` (Task 3).
- Produces: `<MockScenariosPanel projectId className />` that renders a tab strip: **Overview**, **Endpoints**, **Scenarios**, **Responses**, **Call log**, defaulting to Overview. Renders `<MockServerOverviewTab admin={admin} projectId={projectId} />` for the Overview tab.

- [ ] **Step 1: Create the overview tab**

`frontend/src/components/mocks/MockServerOverviewTab.tsx` renders, in plain language:
- the shareable base URL via `<MockServerLink projectId={projectId} />`;
- an enable/disable toggle bound to `server.enabled` via `mockServerApi.update(server.id, { enabled })` (call through a small local handler then `admin.load()`);
- a “How it works” ordered list: `1. Add an endpoint (method + path). 2. Give it a response. 3. Send a request to the URL above. 4. Use a scenario to switch responses.`;
- three stat tiles: endpoints (`admin.routes.length`), scenarios (`admin.scenarios.length`), captured calls (`admin.logs.length`);
- the activation hint: `Add header X-Mock-Scenario: <name> or ?__scenario=<name>`.

Use `styles.section`, `styles.sectionTitle`, `styles.empty`, `styles.badge` and `data-testid="mock-overview-tab"`.

- [ ] **Step 2: Rewrite the panel shell**

Replace the body of `MockScenariosPanel` (lines 218-1274) with:

```tsx
type MockTab = 'overview' | 'endpoints' | 'scenarios' | 'responses' | 'call-log';

const TABS: Array<{ id: MockTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'responses', label: 'Responses' },
  { id: 'call-log', label: 'Call log' },
];

export function MockScenariosPanel({ projectId, className }: MockScenariosPanelProps) {
  const admin = useMockServerAdmin(projectId);
  const [tab, setTab] = useState<MockTab>('overview');

  if (!admin.server && !admin.loading) {
    return (
      <div className={[styles.panel, className].filter(Boolean).join(' ')} data-testid="mock-scenarios-panel">
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Mock server</h1>
            <p className={styles.subtitle}>Serve fake API responses for this project without a backend.</p>
          </div>
        </div>
        <div className={styles.section}>
          <p className={styles.empty}>This project has no mock server yet. Create one to get started.</p>
          <div className={styles.inlineForm}>
            <div className={`${styles.field} ${styles.fieldGrow}`}>
              <label className={styles.label} htmlFor="new-mock-server-name">Name</label>
              <input
                id="new-mock-server-name"
                className={styles.input}
                value={admin.newServerName}
                data-testid="mock-scenarios-server-name"
                onChange={(event) => admin.setNewServerName(event.target.value)}
              />
            </div>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={admin.createServer}
              disabled={admin.busy || !projectId}
              data-testid="mock-scenarios-create-server"
            >
              Create mock server
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={[styles.panel, className].filter(Boolean).join(' ')} data-testid="mock-scenarios-panel">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{admin.server?.name || 'Mock server'}</h1>
          <p className={styles.subtitle}>A guided place to define endpoints, responses and scenarios.</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btn} type="button" onClick={admin.load} disabled={admin.loading || admin.busy}>
            Refresh
          </button>
        </div>
      </div>

      {admin.error ? <div className={styles.error}>{admin.error}</div> : null}
      {admin.notice ? <div className={styles.success}>{admin.notice}</div> : null}

      <nav className={styles.tabs} role="tablist" data-testid="mock-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
            data-testid={`mock-tab-${item.id}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {admin.server ? (
        tab === 'overview' ? (
          <MockServerOverviewTab admin={admin} projectId={projectId} />
        ) : tab === 'endpoints' ? (
          <MockEndpointsTab admin={admin} />
        ) : tab === 'scenarios' ? (
          <MockScenariosTab admin={admin} />
        ) : tab === 'responses' ? (
          <MockResponsesTab admin={admin} />
        ) : (
          <MockCallLogTab admin={admin} />
        )
      ) : null}
    </div>
  );
}
```

Import the tab components and `useMockServerAdmin`. `MockScenariosPanelProps` keeps `projectId`, `mockServerId?`, `className?`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0 only after Tasks 12-15 exist. To keep commits green, create stub files in each of Tasks 12-15 with the correct named export before wiring, or reorder: implement Tasks 12-15 components first, then wire the shell. **Do the latter:** implement Tasks 12-15 first as standalone components, then apply Step 2.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/mocks/MockScenariosPanel.tsx frontend/src/components/mocks/MockServerOverviewTab.tsx frontend/src/components/mocks/mocks.module.css
git commit -m "feat(mock): tabbed shell with guided overview"
```

### Task 12: Endpoints tab

**Files:**
- Create: `frontend/src/components/mocks/MockEndpointsTab.tsx`

**Interfaces:**
- Consumes: `admin` from `useMockServerAdmin`; helpers `emptyRouteDraft`, `toRouteDraft` exported in Task 10.
- Produces: `<MockEndpointsTab admin={admin} />` rendering `data-testid="mock-endpoints-tab"`.

- [ ] **Step 1: Move the endpoints UI and relabel**

Move the current Routes section JSX (`MockScenariosPanel.tsx:772-927`) into the new component. Relabel:
- section title **Routes** → **Endpoints** (`styles.sectionTitle`), hint: `An endpoint is a method + path the mock server answers.`;
- empty state: `No endpoints yet. Add the first one below.`;
- per-row: show `METHOD path` with status/delay badges, plus a **Responses** button that calls `admin.handleRouteSelect(route.id)` and switches the parent tab to Responses — pass a `onOpenResponses(routeId)` prop from the shell. Add `onOpenResponses` to the shell's `<MockEndpointsTab admin={admin} onOpenResponses={(id) => { admin.handleRouteSelect(id); setTab('responses'); }} />`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0 (component not yet wired).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/mocks/MockEndpointsTab.tsx
git commit -m "feat(mock): recognizable endpoints tab"
```

### Task 13: Scenarios tab

**Files:**
- Create: `frontend/src/components/mocks/MockScenariosTab.tsx`

**Interfaces:**
- Consumes: `admin`, exported `groupLinksByRoute`.
- Produces: `<MockScenariosTab admin={admin} onOpenResponses={(routeId)=>void} />` rendering `data-testid="mock-scenarios-tab"`.

- [ ] **Step 1: Move the scenarios UI and relabel**

Move `MockScenariosPanel.tsx:589-770` into the new component. Relabel:
- title **Scenarios** → **Scenarios (response presets)** with hint: `A scenario is a named set of responses. Activate one per request to switch what the mock returns without editing your request.`;
- add a one-line activation example with a copy affordance reusing `copyText`: `X-Mock-Scenario: maintenance`;
- keep the expandable per-scenario route groups; clicking a route group calls `onOpenResponses(group.routeId)` instead of only selecting it;
- empty state: `No scenarios yet. Create one below, then override an endpoint's response inside it.`

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/mocks/MockScenariosTab.tsx
git commit -m "feat(mock): explain scenarios with presets and activation example"
```

### Task 14: Responses tab

**Files:**
- Create: `frontend/src/components/mocks/MockResponsesTab.tsx`

**Interfaces:**
- Consumes: `admin`; `MOCK_CONDITION_*`, `operatorNeedsValue`, `emptyCondition` from `@/lib/mockScenariosApi`.
- Produces: `<MockResponsesTab admin={admin} />` rendering `data-testid="mock-responses-tab"`.

- [ ] **Step 1: Move the route-responses UI and relabel**

Move `MockScenariosPanel.tsx:929-1193` into the component. Relabel and restructure:
- title **Route responses** → **Responses for** + an endpoint `<select>` (the existing selector) ;
- add a plain-language explainer: `Default responses answer every call. Conditional responses answer only when their conditions match. Sequences rotate through responses in order.`;
- give the response form labeled groups: **When should this response be used?** (scenario + conditions), **What should it return?** (status, delay, body, headers), and **Advanced: sequence** (index + mode);
- keep `data-testid` values already used for the tests where present; add `data-testid="mock-response-form"`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/mocks/MockResponsesTab.tsx
git commit -m "feat(mock): clarify responses with grouped form and explainer"
```

### Task 15: Call log tab + wire the shell

**Files:**
- Create: `frontend/src/components/mocks/MockCallLogTab.tsx`
- Modify: `frontend/src/components/mocks/MockScenariosPanel.tsx`

**Interfaces:**
- Consumes: `admin`, exported `CallLogDetail`, `prettyJson`, `formatTimestamp`.
- Produces: `<MockCallLogTab admin={admin} />` rendering `data-testid="mock-call-log-tab"`.

- [ ] **Step 1: Move the call-log UI**

Move `MockScenariosPanel.tsx:1195-1269` into the component, keeping `CallLogDetail`, replay output, refresh, and clear. Relabel title to **Call log (recent requests)** with hint `Every request the mock served, newest first. Expand a row to see the full request and response.`

- [ ] **Step 2: Wire the shell imports**

In `MockScenariosPanel.tsx`, import all four tab components and apply the Task 11 Step 2 shell, adding the `onOpenResponses` props described in Tasks 12-13.

- [ ] **Step 3: Remove dead code**

Delete any now-unused imports/helpers left in `MockScenariosPanel.tsx` so `npx tsc --noEmit` and eslint are clean.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/mocks/MockCallLogTab.tsx frontend/src/components/mocks/MockScenariosPanel.tsx
git commit -m "feat(mock): tabbed call log and complete guided redesign"
```

---

## Phase 5 — Verification

### Task 16: Verify and document

**Files:**
- Modify: `docs/SESSION.md`, `session.md`

- [ ] **Step 1: Run the full frontend unit suite**

Run: `cd frontend && npm test`
Expected: PASS — includes the updated `mockServer.test.cjs`, new `mockRoutes.test.cjs`, new `formulaCompletions.test.cjs`, and all pre-existing suites.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 3: Manual smoke**

With `frontend` dev running: open a project → **Mock server** → confirm the tabbed layout, the copy-link button copies the current-origin `/mock/<projectId>` URL, **Endpoints** add/edit works, opening a request shows **Mock route** suggestions that fill method+URL, and the formula editor shows suggestions for `req.`, `$utils.`, and top-level globals.

- [ ] **Step 4: Update session docs and commit**

Add a short entry to `docs/SESSION.md` and a bullet under `## Completed` in `session.md` describing the mock link/picker, formula autocomplete, and the guided redesign.

```bash
git add docs/SESSION.md session.md
git commit -m "docs(session): mock UX and formula autocomplete"
```

---

## Self-Review

- **Spec coverage:** copy mock link (Tasks 1-3); mock server selection + route suggestions in add/edit request (Tasks 4-7); formula suggestions (Tasks 8-9); scenarios/routes/responses UX redesign (Tasks 10-15); verification/docs (Task 16).
- **Placeholder scan:** no TODOs; every new module has full code. Refactor tasks move exact existing line ranges and list every relabel/copy change, so they are actionable without re-deriving behavior.
- **Type consistency:** `mockBaseUrl(projectId, origin?)`, `mockRequestBaseUrl(projectId)`, `mockRouteUrl(baseUrl, routePath)`, `filterMockRoutes(routes, query)`, `formulaCompletionSource(context)`, `useProjectMockRoutes(projectId, enabled)`, `useMockServerAdmin(projectId)`, and `MockRoutePicker` props are named identically wherever referenced.
- **Known risk:** Task 11 depends on Tasks 12-15 existing; execute Tasks 12-15 before applying the Task 11 shell wiring, as noted in Task 11 Step 3.
