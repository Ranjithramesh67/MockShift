'use client';

// Portal A (A5) — customer sign-in. Same cookie session as the main app /
// checkout. On success sends the customer to ?next= (default /account).

import { useCallback, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/checkoutApi';

export default function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/account';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await signIn(email.trim(), password);
        const target = next.startsWith('/') && !next.startsWith('//') ? next : '/account';
        router.push(target);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not sign in');
        setBusy(false);
      }
    },
    [email, password, next, router]
  );

  return (
    <div className="ac ac-center" data-testid="login-view">
      <form className="ac-card ac-login" onSubmit={onSubmit} data-testid="login-form">
        <span className="ac-login-mark" aria-hidden="true">
          AH
        </span>
        <h1>Sign in</h1>
        <p className="ac-muted">Manage your API Hub subscription — plan, invoices, cancel or change.</p>

        {error ? (
          <div className="ac-banner ac-banner-err" data-testid="login-error" role="alert">
            {error}
          </div>
        ) : null}

        <label className="ac-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            data-testid="login-email"
          />
        </label>
        <label className="ac-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            data-testid="login-password"
          />
        </label>

        <button type="submit" className="ac-btn ac-btn-primary ac-btn-block" disabled={busy} data-testid="login-submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="ac-login-foot">
          New to API Hub?{' '}
          <a href="/#pricing" className="ac-link">
            Start with a plan
          </a>{' '}
          — your account is created at checkout.
        </p>
      </form>
    </div>
  );
}
