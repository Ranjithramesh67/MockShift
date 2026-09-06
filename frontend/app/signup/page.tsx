'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { PORTAL_PLANS_URL } from '@/lib/portalUrl';
import { BoltIcon, CheckIcon, LockIcon, TeamIcon } from '@/components/icons';

const FEATURES = [
  { icon: BoltIcon, text: 'Build and test requests with REST, SOAP, GraphQL and Auth' },
  { icon: TeamIcon, text: 'Share workspaces and collaborate with your team' },
  { icon: CheckIcon, text: 'Chain requests into automated workflows' },
];

type SignupState = 'loading' | 'open' | 'closed';

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [state, setState] = useState<SignupState>('loading');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/signup-status')
      .then((r) => r.json())
      .then((data) => {
        if (alive) setState(data && data.open ? 'open' : 'closed');
      })
      .catch(() => {
        if (alive) setState('closed');
      });
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      await signup(email.trim(), password, name.trim(), username.trim());
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="auth-screen" data-testid="auth-screen">
        <div className="auth-shell auth-center">Checking signup availability…</div>
      </div>
    );
  }

  if (state === 'closed') {
    // Self-service signup now lives on the Portal A plans page (a plan — Free
    // or paid — is chosen before the account is created, and the org +
    // workspace are provisioned with it).
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
            <div className="auth-card" data-testid="signup-gateway">
              <h1 className="auth-title">Choose a plan to get started</h1>
              <p className="auth-hint">
                Accounts are created through the API Hub plans page — pick a plan
                (Free or paid) and your workspace is set up automatically.
              </p>
              <a
                className="primary-button auth-submit"
                href={PORTAL_PLANS_URL}
                data-testid="goto-plans"
              >
                See plans &amp; pricing
              </a>
              <p className="auth-alt">
                Already have an account?{' '}
                <Link href="/login" data-testid="goto-login">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                placeholder="adalovelace"
                data-testid="signup-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
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
