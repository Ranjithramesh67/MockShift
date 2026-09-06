'use client';

import { Suspense, useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, LoadingBlock } from '@/components/manage/ui';
import { apiFetch, apiLogout, ApiError, type MeResponse } from '@/lib/portalApi';

const DEFAULT_REDIRECT = '/manage/dashboard';

// Open-redirect hygiene: only accept same-origin relative paths that start
// with a single '/'. Anything else (protocol-relative '//', external URLs)
// falls back to the dashboard.
function safeNext(raw: string | null | undefined): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/manage/login')) {
    return raw;
  }
  return DEFAULT_REDIRECT;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const screenStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
};

const cardStyle: CSSProperties = { width: '100%', maxWidth: 420 };
const cardPad: CSSProperties = { padding: '30px' };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in with a portal role? Skip ahead to the requested page.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await apiFetch<MeResponse>('/api/me');
        if (alive && me.portalRole) {
          router.replace(safeNext(next));
        }
      } catch {
        // Not authenticated (or API unreachable) — stay on the sign-in form.
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, next]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    const errs: { email?: string; password?: string } = {};
    const emailValue = email.trim();
    if (!emailValue) {
      errs.email = 'Email is required.';
    } else if (!isEmail(emailValue)) {
      errs.email = 'Enter a valid email address.';
    }
    if (!password) {
      errs.password = 'Password is required.';
    }
    setFieldErrors(errs);
    if (errs.email || errs.password) return;

    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: emailValue, password },
      });

      const me = await apiFetch<MeResponse>('/api/me');
      if (me.portalRole) {
        router.replace(safeNext(next));
        return;
      }

      // Logged in, but the account is not a Portal B member — reject and clear.
      setFormError('This account does not have Portal B (management) access.');
      await apiLogout();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Could not reach the portal service. Please try again later.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={screenStyle}>
      <div className="pm-card" style={cardStyle}>
        <div style={cardPad}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <span className="pm-brand-mark" aria-hidden="true" style={{ width: 44, height: 44, fontSize: 17 }}>
              AH
            </span>
          </div>

          <h1 style={{ textAlign: 'center', fontSize: 21 }}>Portal Management — Sign in</h1>
          <p
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13.5,
              margin: '6px 0 22px',
              lineHeight: 1.6,
            }}
          >
            Staff access only (ADMIN / MANAGER / SUPPORT / VIEWER)
          </p>

          {formError ? (
            <div style={{ marginBottom: 16 }}>
              <Alert>{formError}</Alert>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} noValidate>
            <div className="pm-field">
              <label className="pm-label" htmlFor="login-email">
                Email
              </label>
              <input
                id="login-email"
                className="pm-input"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="staff@company.com"
                data-testid="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
              {fieldErrors.email ? <div className="pm-field-error">{fieldErrors.email}</div> : null}
            </div>

            <div className="pm-field" style={{ marginTop: 14 }}>
              <label className="pm-label" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                className="pm-input"
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                data-testid="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              {fieldErrors.password ? (
                <div className="pm-field-error">{fieldErrors.password}</div>
              ) : null}
            </div>

            <button
              type="submit"
              className="pm-btn pm-btn-primary pm-btn-lg"
              style={{ width: '100%', marginTop: 20 }}
              data-testid="login-submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18, fontSize: 13.5 }}>
            <a className="pm-text-btn" href="/">
              ← Back to API Hub site
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={screenStyle}>
          <LoadingBlock label="Loading…" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
