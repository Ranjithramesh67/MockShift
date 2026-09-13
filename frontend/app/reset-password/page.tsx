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
