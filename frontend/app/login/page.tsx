'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { BoltIcon, CheckIcon, LockIcon, TeamIcon } from '@/components/icons';

const FEATURES = [
  { icon: BoltIcon, text: 'Build and test requests with REST, SOAP, GraphQL and Auth' },
  { icon: TeamIcon, text: 'Share workspaces and collaborate with your team' },
  { icon: CheckIcon, text: 'Chain requests into automated workflows' },
];

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
      <div className="auth-shell">
        <div className="auth-brand-panel">
          <div className="auth-brand">
            <span className="brand-mark">AH</span>
            <span className="brand-name">API Hub</span>
          </div>
          <div className="auth-brand-tagline">
            <h2>
              Test your APIs, <span>on autopilot.</span>
            </h2>
            <p>
              A collaborative workspace for designing, testing and automating API requests —
              with teams, shared collections and folder-level auth providers.
            </p>
          </div>
          <ul className="auth-feature-list">
            {FEATURES.map((f) => (
              <li key={f.text}>
                <f.icon />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="auth-card-wrap">
          <form className="auth-card" onSubmit={onSubmit} data-testid="login-form">
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-hint">Sign in to continue to your workspaces.</p>
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
                placeholder="you@company.com"
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
                placeholder="••••••••"
                data-testid="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="primary-button auth-submit"
              disabled={busy}
              data-testid="login-submit"
            >
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
      </div>
    </div>
  );
}
