'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/portalApi';
import { fetchCashfreeStatus, formatMoney, type CashfreeStatus } from '@/lib/checkoutApi';

type Phase = 'checking' | 'success' | 'pending' | 'failed' | 'error';

const MAX_ATTEMPTS = 6;
const POLL_MS = 2500;
// Once the provider confirms the payment, show the success state briefly before
// handing over to the receipt (the existing post-payment landing page).
const SUCCESS_REDIRECT_MS = 1800;

type SuccessInfo = { planName: string; amount: string | null; cycle: string };
type FailureInfo = { cancelled: boolean; reason: string | null; status: string | null };

const CANCELLED = ['CANCELLED', 'USER_DROPPED', 'VOID', 'TERMINATED', 'EXPIRED'];

// Cashfree returns the browser with our own `orderId` query param, but may also
// append its provider `order_id`. Our internal order id is the leading uuid.
function resolveOrderId(raw: string | null): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const candidate = value.slice(0, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : value;
}

function receiptUrl(orderId: string): string {
  return `/receipt/${encodeURIComponent(orderId)}`;
}

// Turn a provider status/message into a plain-language reason for the customer.
function failureCopy(info: FailureInfo): string {
  const { cancelled, reason, status } = info;
  const lead = cancelled ? 'Your payment was cancelled' : 'Your payment was not completed';
  if (reason) return `${lead}: ${reason}. No money was taken.`;
  if (status) return `${lead} (${status.replace(/_/g, ' ').toLowerCase()}). No money was taken.`;
  return `${lead}. No money was taken.`;
}

export default function PayReturnView() {
  const params = useSearchParams();
  const router = useRouter();
  const orderId = resolveOrderId(params.get('orderId') || params.get('order_id'));

  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [failure, setFailure] = useState<FailureInfo | null>(null);
  const [nonce, setNonce] = useState(0);

  const check = useCallback(async () => {
    if (!orderId) {
      setPhase('error');
      setMessage('No order was supplied.');
      return 'stop' as const;
    }
    try {
      const status: CashfreeStatus = await fetchCashfreeStatus(orderId);

      // Success — show the confirmation, then continue to the receipt.
      if (status.order.status === 'PAID') {
        setSuccess({
          planName: status.order.plan_name,
          amount: status.order.amount,
          cycle: status.order.billing_cycle,
        });
        setPhase('success');
        return 'stop' as const;
      }

      // A declined / dropped / expired attempt will never succeed on its own —
      // stop polling and tell the customer why, instead of hanging.
      if (status.order.status === 'FAILED' || status.gateway?.terminal) {
        const statusText = status.gateway?.payment_status || status.gateway?.status || null;
        const cancelled =
          Boolean(status.gateway?.cancelled) ||
          CANCELLED.includes(String(statusText || '').toUpperCase());
        setFailure({
          cancelled,
          reason: status.gateway?.payment_message || null,
          status: statusText,
        });
        setPhase('failed');
        return 'stop' as const;
      }

      // Still being confirmed by the bank/UPI — keep polling.
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

  // After a confirmed payment, continue to the receipt (the usual flow).
  useEffect(() => {
    if (phase !== 'success' || !orderId) return;
    const timer = setTimeout(() => router.replace(receiptUrl(orderId)), SUCCESS_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [phase, orderId, router]);

  if (phase === 'checking') {
    return (
      <div className="ck-loading" role="status" data-testid="pay-return-checking">
        Confirming your payment…
      </div>
    );
  }

  if (phase === 'success') {
    const amount = success ? formatMoney(success.amount) : null;
    return (
      <div className="ck-panel" role="status" data-testid="pay-return-success">
        <div className="ck-result-icon" aria-hidden="true">
          ✓
        </div>
        <h1 className="ck-title">Payment successful</h1>
        <p className="ck-lede">
          {success
            ? `You're on ${success.planName}${amount ? ` — ${amount} paid` : ''}. Taking you to your receipt…`
            : 'Your payment went through. Taking you to your receipt…'}
        </p>
        <div className="gw-actions">
          <a className="btn btn-primary" href={receiptUrl(orderId)} data-testid="pay-return-view-receipt">
            View your receipt
          </a>
          <a className="btn btn-ghost" href="/account">
            Go to My subscription
          </a>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    const info: FailureInfo = failure || { cancelled: false, reason: null, status: null };
    return (
      <div className="ck-panel" role="alert" data-testid="pay-return-failed">
        <h1 className="ck-title">
          {info.cancelled ? 'Payment cancelled' : 'Payment not completed'}
        </h1>
        <p className="ck-lede" data-testid="pay-return-failed-message">
          {failureCopy(info)}
        </p>
        <div className="gw-actions">
          <a className="btn btn-primary" href={`/pay?orderId=${encodeURIComponent(orderId)}`}>
            Try paying again
          </a>
          <a className="btn btn-ghost" href="/#pricing">
            Back to pricing
          </a>
          <a className="btn btn-ghost" href="/account">
            Go to My subscription
          </a>
        </div>
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
          <a className="btn btn-ghost" href={receiptUrl(orderId)}>
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
