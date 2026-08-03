'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen" data-testid="auth-screen">
      <form className="auth-card" onSubmit={onSubmit} data-testid="login-form">
        <div className="auth-brand">
          <span className="brand-mark">AH</span>
          <span className="brand-name">API Hub</span>
        </div>
        <h1 className="auth-title">Sign in</h1>
        {error && (
          <p className="auth-error" role="alert" data-testid="auth-error">
            {error}
          </p>
        )}
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            data-testid="login-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            data-testid="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="primary-button auth-submit" disabled={busy} data-testid="login-submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="auth-alt">
          No account?{' '}
          <Link href="/signup" data-testid="goto-signup">
            Create one
          </Link>
        </p>
      </form>
    </div>
  );
}
