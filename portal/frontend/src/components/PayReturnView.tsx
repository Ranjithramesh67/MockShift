'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/portalApi';
import { fetchCashfreeStatus } from '@/lib/checkoutApi';

type Phase = 'checking' | 'pending' | 'error';

const MAX_ATTEMPTS = 10;
const POLL_MS = 3000;

export default function PayReturnView() {
  const params = useSearchParams();
  const router = useRouter();
  const orderId = params.get('orderId') || '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const check = useCallback(async () => {
    if (!orderId) {
      setPhase('error');
      setMessage('No order was supplied.');
      return 'stop' as const;
    }
    try {
      const status = await fetchCashfreeStatus(orderId);
      if (status.order.status === 'PAID') {
        router.replace(`/receipt/${encodeURIComponent(orderId)}`);
        return 'stop' as const;
      }
      return 'again' as const;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Session lost — send them back to the pay page to prove ownership.
        router.replace(`/pay?orderId=${encodeURIComponent(orderId)}`);
        return 'stop' as const;
      }
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Could not confirm your payment.');
      return 'stop' as const;
    }
  }, [orderId, router]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    const poll = async () => {
      setPhase('checking');
      setMessage(null);
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        const result = await check();
        if (cancelled || result === 'stop') return;
        if (attempt < MAX_ATTEMPTS - 1) await wait(POLL_MS);
      }
      if (!cancelled) setPhase('pending');
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [check, nonce]);

  if (phase === 'checking') {
    return (
      <div className="ck-loading" role="status" data-testid="pay-return-checking">
        Confirming your payment…
      </div>
    );
  }

  if (phase === 'pending') {
    return (
      <div className="ck-panel" data-testid="pay-return-pending">
        <h1 className="ck-title">Payment is being confirmed</h1>
        <p className="ck-lede">
          Your bank or UPI app has not confirmed the payment yet. This can take a moment — check
          again, or view the order for its latest status.
        </p>
        <div className="gw-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setNonce((n) => n + 1)}
            data-testid="pay-return-recheck"
          >
            Check again
          </button>
          <a className="btn btn-ghost" href={`/receipt/${encodeURIComponent(orderId)}`}>
            View order
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="ck-panel" role="alert" data-testid="pay-return-error">
      <h1 className="ck-title">We could not confirm your payment</h1>
      <p className="ck-lede">{message}</p>
      <div className="gw-actions">
        <a className="btn btn-primary" href={`/pay?orderId=${encodeURIComponent(orderId)}`}>
          Try paying again
        </a>
        <a className="btn btn-ghost" href="/account">
          Go to My subscription
        </a>
      </div>
    </div>
  );
}
