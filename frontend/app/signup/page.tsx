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

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      await signup(email.trim(), password, name.trim());
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
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
          <form className="auth-card" onSubmit={onSubmit} data-testid="signup-form">
            <h1 className="auth-title">Create your account</h1>
            <p className="auth-hint">The first account on a fresh install becomes the platform administrator.</p>
            {error && (
              <p className="auth-error" role="alert" data-testid="auth-error">
                {error}
              </p>
            )}
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                data-testid="signup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                data-testid="signup-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="8+ characters"
                data-testid="signup-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="primary-button auth-submit"
              disabled={busy}
              data-testid="signup-submit"
            >
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <p className="auth-alt">
              Already have an account?{' '}
              <Link href="/login" data-testid="goto-login">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
