'use client';

// Signed-in "My subscription" header link for Portal A pages. Renders nothing
// (and never a hydration mismatch) until the session check resolves; when
// signed out it stays hidden so the marketing nav is unchanged.

import { useEffect, useState } from 'react';
import { fetchMe } from '@/lib/checkoutApi';

export default function AccountLink({ className }: { className?: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((me) => {
        if (alive) setSignedIn(Boolean(me));
      })
      .catch(() => {
        if (alive) setSignedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (signedIn !== true) return null;
  return (
    <a className={className ?? 'btn btn-outline btn-sm'} href="/account" data-testid="account-link">
      My subscription
    </a>
  );
}
