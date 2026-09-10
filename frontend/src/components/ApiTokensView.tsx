'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError, workspaceApi, type Workspace } from '@/lib/api';
import {
  tokensApi,
  API_TOKEN_SCOPES,
  API_TOKEN_SCOPE_LABEL,
  API_TOKEN_SCOPE_HINT,
  type ApiToken,
  type ApiTokenScope,
} from '@/lib/tokens';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Msg({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null;
  return (
    <p className={`profile-msg profile-msg-${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
      {msg.text}
    </p>
  );
}

interface TokenRowProps {
  token: ApiToken;
  onRevoke: (id: string) => void;
  revoking: boolean;
}

function TokenRow({ token, onRevoke, revoking }: TokenRowProps) {
  const expired = token.status === 'active' && token.expiresAt !== null && new Date(token.expiresAt).getTime() <= Date.now();
  const tone = token.status === 'revoked' ? 'revoked' : expired ? 'expired' : 'active';
  return (
    <li className="apitoken-row" data-testid={`apitoken-row-${token.id}`}>
      <div className="apitoken-row-main">
        <div className="apitoken-row-name">
          <span className="apitoken-name">{token.name}</span>
          <span className={`apitoken-status apitoken-status-${tone}`}>
            {token.status === 'revoked' ? 'Revoked' : expired ? 'Expired' : 'Active'}
          </span>
        </div>
        <div className="apitoken-meta">
          <code className="apitoken-prefix">{token.prefix}…</code>
          <span className="apitoken-scope">{token.scopes.map((s) => API_TOKEN_SCOPE_LABEL[s]).join(' · ')}</span>
          {token.projectId ? <span className="apitoken-badge">project key</span> : null}
          {token.workspaceId ? <span className="apitoken-badge">workspace key</span> : null}
        </div>
        <div className="apitoken-meta">
          <span>
            Created {fmtDate(token.createdAt)} · Last used {fmtDateTime(token.lastUsedAt)} · Expires{' '}
            {fmtDate(token.expiresAt)}
          </span>
        </div>
      </div>
      <div className="apitoken-row-actions">
        {token.status === 'active' ? (
          <button
            type="button"
            className="ghost-button danger small"
            disabled={revoking}
            data-testid={`apitoken-revoke-${token.id}`}
            onClick={() => {
              if (window.confirm(`Revoke API token "${token.name}"? Requests using it will stop working immediately.`)) {
                onRevoke(token.id);
              }
            }}
          >
            {revoking ? 'Revoking…' : 'Revoke'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function OneTimeReveal({ secret, name, onClose }: { secret: string; name: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="apitoken-reveal" data-testid="apitoken-reveal">
      <h3 className="apitoken-reveal-title">Token created</h3>
      <p className="profile-field-hint">
        <strong>{name}</strong> — copy this token now. For security it is shown only once and cannot be retrieved later.
      </p>
      <div className="apitoken-secret-row">
        <code className="apitoken-secret" data-testid="apitoken-secret" role="textbox" aria-readonly="true">
          {secret}
        </code>
        <button type="button" className="ghost-button" onClick={() => void copy()} data-testid="apitoken-copy">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="profile-field-hint">
        Use it as <code>Authorization: Bearer {secret.slice(0, 12)}…</code> when calling the API Hub API.
      </p>
      <button type="button" className="primary-button" onClick={onClose} data-testid="apitoken-reveal-done">
        Done
      </button>
    </div>
  );
}

function CreateTokenForm({ onCreated, onMessage }: { onCreated: (secret: string, name: string) => void; onMessage: (msg: { kind: 'ok' | 'err'; text: string } | null) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiTokenScope[]>(['read']);
  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [bindingKind, setBindingKind] = useState<'none' | 'project' | 'workspace'>('none');
  const [bindingTarget, setBindingTarget] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; workspaceId: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await workspaceApi.list();
        if (cancelled) return;
        setWorkspaces(res.workspaces);
        const perWorkspace = await Promise.all(
          res.workspaces.map(async (w) => {
            const content = await workspaceApi.content(w.id);
            return content.projects.map((p) => ({ id: p.id, name: p.name, workspaceId: w.id }));
          })
        );
        if (!cancelled) setProjects(perWorkspace.flat());
      } catch {
        /* binding is optional; ignore load errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleScope = (s: ApiTokenScope) => {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const submit = async () => {
    if (!name.trim()) {
      onMessage({ kind: 'err', text: 'Give the token a name so you can recognise it later.' });
      return;
    }
    setBusy(true);
    try {
      let expiresAt: string | null = null;
      if (expiryEnabled && expiryDate) {
        expiresAt = new Date(`${expiryDate}T23:59:59Z`).toISOString();
      }
      const input: Parameters<typeof tokensApi.create>[0] = { name: name.trim(), scopes, expiresAt };
      if (bindingKind === 'project' && bindingTarget) input.projectId = bindingTarget;
      if (bindingKind === 'workspace' && bindingTarget) input.workspaceId = bindingTarget;
      const created = await tokensApi.create(input);
      onMessage(null);
      setBusy(false);
      onCreated(created.token, created.apiToken.name);
    } catch (err) {
      setBusy(false);
      onMessage({
        kind: 'err',
        text: err instanceof ApiError ? err.message : 'Failed to create token',
      });
    }
  };

  return (
    <form
      className="profile-form apitoken-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="apitoken-create-form"
    >
      <div className="apitoken-field">
        <label className="apitoken-label" htmlFor="apitoken-name">
          Token name
        </label>
        <input
          id="apitoken-name"
          className="text-input apitoken-name-input"
          value={name}
          maxLength={120}
          placeholder="e.g. CI deploy"
          onChange={(e) => setName(e.target.value)}
          data-testid="apitoken-name-input"
        />
      </div>

      <div className="apitoken-field">
        <span className="apitoken-label">Scopes</span>
        <div className="apitoken-scope-grid">
          {API_TOKEN_SCOPES.map((s) => (
            <label className="apitoken-scope-option" key={s}>
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={() => toggleScope(s)}
                data-testid={`apitoken-scope-${s}`}
              />
              <span className="apitoken-scope-text">
                <strong>{API_TOKEN_SCOPE_LABEL[s]}</strong>
                <small>{API_TOKEN_SCOPE_HINT[s]}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="apitoken-field">
        <label className="apitoken-label" htmlFor="apitoken-binding-kind">
          Scope this key to
        </label>
        <select
          id="apitoken-binding-kind"
          className="text-input"
          value={bindingKind}
          data-testid="apitoken-binding-kind"
          onChange={(e) => {
            setBindingKind(e.target.value as 'none' | 'project' | 'workspace');
            setBindingTarget('');
          }}
        >
          <option value="none">Nothing (personal key)</option>
          <option value="project">A project</option>
          <option value="workspace">A workspace</option>
        </select>
        {bindingKind !== 'none' ? (
          <select
            className="text-input"
            value={bindingTarget}
            data-testid="apitoken-binding-target"
            onChange={(e) => setBindingTarget(e.target.value)}
          >
            <option value="">Select…</option>
            {bindingKind === 'project'
              ? projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              : workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
          </select>
        ) : null}
        <small className="apitoken-hint">
          Project/workspace keys let apihub-sdk sync routes without a personal key.
        </small>
      </div>

      <div className="apitoken-field">
        <span className="apitoken-label">Expiration</span>
        <label className="apitoken-expiry-toggle">
          <input
            type="checkbox"
            checked={expiryEnabled}
            onChange={(e) => setExpiryEnabled(e.target.checked)}
            data-testid="apitoken-expiry-toggle"
          />
          <span>Set an expiration date</span>
        </label>
        {expiryEnabled ? (
          <input
            type="date"
            className="text-input apitoken-date-input"
            value={expiryDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setExpiryDate(e.target.value)}
            data-testid="apitoken-expiry-date"
          />
        ) : null}
      </div>

      <div className="profile-form-actions">
        <button type="submit" className="primary-button" disabled={busy} data-testid="apitoken-create">
          {busy ? 'Creating…' : 'Create token'}
        </button>
      </div>
    </form>
  );
}

export function ApiTokensView() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [secret, setSecret] = useState<{ token: string; name: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await tokensApi.list();
      setTokens(res.tokens);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        void logout();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, [logout, router]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    void reload();
  }, [authLoading, user, router, reload]);

  const revoke = async (id: string) => {
    setRevokingId(id);
    try {
      await tokensApi.revoke(id);
      setMsg({ kind: 'ok', text: 'Token revoked.' });
      await reload();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Failed to revoke token' });
    } finally {
      setRevokingId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="loading-screen" data-testid="loading-splash">
        <span className="spinner" />
        Loading…
      </div>
    );
  }
  if (!user) return null;

  return (
    <main className="profile-main" data-testid="api-tokens-page">
      <div className="profile-head">
        <div className="profile-head-text">
          <h1>API tokens</h1>
          <p className="profile-head-meta">Personal tokens for machine authentication against the API Hub API.</p>
        </div>
        <button
          type="button"
          className="ghost-button"
          data-testid="api-tokens-api-reference"
          onClick={() => router.push('/docs/api-reference')}
        >
          API reference
        </button>
      </div>

      <Msg msg={msg} />
      {error && !loading ? (
        <div className="profile-error" role="alert">
          <p>{error}</p>
          <button type="button" className="ghost-button" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      ) : null}

      {secret ? (
        <section className="profile-card" aria-label="One-time token">
          <OneTimeReveal secret={secret.token} name={secret.name} onClose={() => setSecret(null)} />
        </section>
      ) : null}

      <section className="profile-card" aria-labelledby="apitoken-new-title">
        <h2 className="profile-card-title" id="apitoken-new-title">
          Create a token
        </h2>
        <CreateTokenForm
          onMessage={setMsg}
          onCreated={(token, name) => {
            void reload();
            setSecret({ token, name });
          }}
        />
      </section>

      <section className="profile-card" aria-labelledby="apitoken-list-title">
        <h2 className="profile-card-title" id="apitoken-list-title">
          Your tokens
        </h2>
        {loading ? (
          <p className="profile-field-hint">Loading tokens…</p>
        ) : tokens.length === 0 ? (
          <p className="profile-field-hint" data-testid="apitoken-empty">
            No tokens yet. Create one above to authenticate machine clients.
          </p>
        ) : (
          <ul className="apitoken-list" data-testid="apitoken-list">
            {tokens.map((t) => (
              <TokenRow key={t.id} token={t} revoking={revokingId === t.id} onRevoke={(id) => void revoke(id)} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
