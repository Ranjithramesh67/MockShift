'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { tokenFromSearch } from '@/lib/authLinks';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = tokenFromSearch(params.toString());
  const ran = useRef(false);
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState('');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState('error');
      setError('This verification link is missing its token.');
      return;
    }
    authApi
      .verifyEmail(token)
      .then(() => setState('done'))
      .catch((err) => {
        setState('error');
        setError(err instanceof Error ? err.message : 'Could not verify this email');
      });
  }, [token]);

  return (
    <div className="auth-screen" data-testid="auth-screen">
      <div className="auth-shell auth-center">
        <div className="auth-card-wrap">
          <div className="auth-card" data-testid="verify-status">
            <h1 className="auth-title">Email verification</h1>
            {state === 'working' && <p className="auth-hint">Verifying your email…</p>}
            {state === 'done' && (
              <p className="auth-hint">Your email is verified. You are all set.</p>
            )}
            {state === 'error' && (
              <p className="auth-error" role="alert" data-testid="verify-error">
                {error}
              </p>
            )}
            <p className="auth-alt">
              <Link href="/">Continue to API Hub</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="auth-screen" />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
