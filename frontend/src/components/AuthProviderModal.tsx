'use client';

import React, { useState } from 'react';
import type { AuthProvider, AuthType } from '@/lib/api';
import { useWorkspace } from '@/store/WorkspaceStore';
import { Modal } from './Modal';

const AUTH_TYPES: Array<{ id: AuthType; label: string }> = [
  { id: 'NONE', label: 'No auth' },
  { id: 'BEARER_TOKEN', label: 'Bearer token' },
  { id: 'OAUTH2', label: 'OAuth2 (custom header)' },
  { id: 'BASIC', label: 'Basic auth (manual)' },
];

export function AuthProviderModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const provider = ws.authProvider ?? {
    authType: 'NONE' as AuthType,
    tokenRequestId: null,
    tokenPath: 'access_token',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer',
  };
  const [draft, setDraft] = useState<AuthProvider | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const current = draft ?? provider;
  const set = (patch: Partial<AuthProvider>) => setDraft({ ...current, ...patch });

  const authRequests = (ws.tree?.requests ?? []).filter((r) => r.api_type === 'AUTH');

  if (!open) return null;

  const onSave = async () => {
    setError('');
    setBusy(true);
    try {
      await ws.saveAuthProvider(current);
      setDraft(null);
      setTestResult(null);
      setTestError(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setTestResult(null);
    setTestError(null);
    try {
      const res = await ws.testAuthProvider();
      if (res && res.resolvedHeader) {
        setTestResult(`${res.resolvedHeader.headerKey}: ${res.resolvedHeader.headerValue}`);
      } else {
        setTestError('Provider returned no token header');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test failed');
    }
  };

  return (
    <Modal title={`Auth provider — ${ws.activeCollectionName || 'collection'}`} onClose={onClose} testId="auth-provider-modal">
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <p className="hint">
          Configure one AUTH-type request as the folder token source. Every request in this collection
          calls it first, extracts the token, and injects it as a header.
        </p>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <div className="auth-field">
          <span>Auth type</span>
          <select data-testid="auth-type-select" value={current.authType} onChange={(e) => set({ authType: e.target.value as AuthType })}>
            {AUTH_TYPES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {current.authType !== 'NONE' && (
          <>
            <div className="auth-field">
              <span>Token request (must be AUTH type)</span>
              <select
                data-testid="token-request-select"
                value={current.tokenRequestId ?? ''}
                onChange={(e) => set({ tokenRequestId: e.target.value || null })}
              >
                <option value="">— select token request —</option>
                {authRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.method})
                  </option>
                ))}
              </select>
              {authRequests.length === 0 && (
                <small className="hint">No AUTH-type request in this collection yet — create one with the + button.</small>
              )}
            </div>
            <label className="auth-field">
              <span>Token JSON path</span>
              <input
                type="text"
                data-testid="token-path"
                value={current.tokenPath}
                placeholder="access_token or data.access_token"
                onChange={(e) => set({ tokenPath: e.target.value })}
              />
            </label>
            <label className="auth-field">
              <span>Header key</span>
              <input
                type="text"
                data-testid="header-key"
                value={current.headerKey}
                onChange={(e) => set({ headerKey: e.target.value })}
              />
            </label>
            <label className="auth-field">
              <span>Header prefix</span>
              <input
                type="text"
                data-testid="header-prefix"
                value={current.headerPrefix}
                placeholder="Bearer"
                onChange={(e) => set({ headerPrefix: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-button" data-testid="test-auth-provider" onClick={onTest}>
                Test provider
              </button>
            </div>
            {testResult && (
              <p className="test-result" data-testid="auth-test-result">
                Token OK: <code>{testResult}</code>
              </p>
            )}
            {testError && (
              <p className="auth-error" role="alert" data-testid="auth-test-error">
                {testError}
              </p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy} data-testid="save-auth-provider">
            {busy ? 'Saving…' : 'Save provider'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
