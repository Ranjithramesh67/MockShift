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
