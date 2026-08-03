'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

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
      <form className="auth-card" onSubmit={onSubmit} data-testid="signup-form">
        <div className="auth-brand">
          <span className="brand-mark">AH</span>
          <span className="brand-name">API Hub</span>
        </div>
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
            data-testid="signup-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="primary-button auth-submit" disabled={busy} data-testid="signup-submit">
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
  );
}
