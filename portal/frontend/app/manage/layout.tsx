'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import './manage.css';
import ManageShell from '@/components/manage/ManageShell';
import type { MeUser } from '@/components/manage/ManageShell';
import { Alert, LoadingBlock } from '@/components/manage/ui';
import { apiFetch, apiLogout, ApiError, type MeResponse } from '@/lib/portalApi';

const LOGIN_TARGET = '/manage/login?next=/manage';

type AuthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'authed'; user: MeUser; portalRole: string }
  | { status: 'denied'; user: MeUser }
  | { status: 'error'; message: string };

const centerStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  gap: '14px',
};

const cardStyle: CSSProperties = { width: '100%', maxWidth: 440 };
const cardPad: CSSProperties = { padding: '26px' };

function DeniedScreen({ user }: { user: MeUser }) {
  return (
    <div style={centerStyle} data-testid="portal-denied">
      <div className="pm-card" style={cardStyle}>
        <div className="pm-card-body" style={cardPad}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <span className="pm-brand-mark" aria-hidden="true">
              AH
            </span>
          </div>
          <h1 style={{ textAlign: 'center', fontSize: 21 }}>No portal access</h1>
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
            Your role <strong style={{ color: 'var(--text)' }}>{user.role}</strong> is not a Portal B
            (management) role. Portal B is restricted to ADMIN, MANAGER, SUPPORT and VIEWER staff
            accounts.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
            <a className="pm-btn pm-btn-ghost" href="/">
              Back to API Hub site
            </a>
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={() => apiLogout('/manage/login')}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ManageLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // '/manage/login' lives under this layout too — render it without the guard shell.
  const isLoginRoute = pathname.startsWith('/manage/login');
  const guarded = !isLoginRoute;

  const [auth, setAuth] = useState<AuthState>({ status: 'idle' });
  const prevGuarded = useRef<boolean | null>(null);

  const checkSession = useCallback(async () => {
    setAuth({ status: 'loading' });
    try {
      const me = await apiFetch<MeResponse>('/api/me');
      if (me.portalRole) {
        setAuth({ status: 'authed', user: me.user, portalRole: me.portalRole });
      } else {
        setAuth({ status: 'denied', user: me.user });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setAuth({ status: 'idle' });
        router.replace(LOGIN_TARGET);
      } else {
        const message =
          err instanceof Error && err.message ? err.message : 'Could not reach the portal API.';
        setAuth({ status: 'error', message });
      }
    }
  }, [router]);

  // Run the session check when entering a guarded page (first load of a guarded
  // route, or coming back from /manage/login). Skipped for navigation that stays
  // inside the guarded area (the shell is already authed).
  useEffect(() => {
    const prev = prevGuarded.current;
    prevGuarded.current = guarded;
    if (guarded && prev !== true) {
      checkSession();
    }
  }, [guarded, checkSession]);

  if (isLoginRoute) {
    return <>{children}</>;
  }

  switch (auth.status) {
    case 'authed':
      return (
        <ManageShell user={auth.user} portalRole={auth.portalRole}>
          {children}
        </ManageShell>
      );
    case 'denied':
      return <DeniedScreen user={auth.user} />;
    case 'error':
      return (
        <div style={centerStyle}>
          <div className="pm-card" style={cardStyle}>
            <div className="pm-card-body" style={cardPad}>
              <Alert>Unable to load your session — {auth.message}</Alert>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
                <button
                  type="button"
                  className="pm-btn pm-btn-primary"
                  onClick={() => checkSession()}
                >
                  Retry
                </button>
                <a className="pm-btn pm-btn-ghost" href={LOGIN_TARGET}>
                  Go to sign in
                </a>
              </div>
            </div>
          </div>
        </div>
      );
    default:
      return (
        <div style={centerStyle}>
          <div data-testid="manage-loading">
            <LoadingBlock label="Checking your session…" />
          </div>
          <a className="pm-text-btn" href={LOGIN_TARGET}>
            Go to sign in
          </a>
        </div>
      );
  }
}
