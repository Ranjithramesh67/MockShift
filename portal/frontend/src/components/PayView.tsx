'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/portalApi';
import { openCashfreeCheckout } from '@/lib/cashfreeSdk';
import {
  fetchOrder,
  formatMoney,
  resumeCheckout,
  startCashfreeSession,
  type CashfreeSession,
  type OrderStatusResult,
} from '@/lib/checkoutApi';

type Phase =
  | { kind: 'loading' }
  | { kind: 'auth' }
  | { kind: 'ready'; session: CashfreeSession; order: OrderStatusResult }
  | { kind: 'error'; message: string };

function receiptUrl(orderId: string): string {
  return `/receipt/${encodeURIComponent(orderId)}`;
}

export default function PayView() {
  const params = useSearchParams();
  const router = useRouter();
  const orderId = params.get('orderId') || '';

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) {
      setPhase({ kind: 'error', message: 'No order was supplied to the payment page.' });
      return;
    }
    setPhase({ kind: 'loading' });
    setActionError(null);
    try {
      const session = await startCashfreeSession(orderId);
      if (session.alreadyProcessed || (session.order && session.order.status === 'PAID')) {
        router.replace(receiptUrl(orderId));
        return;
      }
      const order = await fetchOrder(orderId);
      if (order.order.status === 'PAID') {
        router.replace(receiptUrl(orderId));
        return;
      }
      setPhase({ kind: 'ready', session, order });
    } catch (err) {
      // No portal session yet — the customer proved ownership at signup but the
      // (gated) app login cannot mint one, so ask for their password here.
      if (err instanceof ApiError && err.status === 401) {
        setPhase({ kind: 'auth' });
        return;
      }
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not start the payment.',
      });
    }
  }, [orderId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    setAuthBusy(true);
    try {
      await resumeCheckout(email.trim(), password);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not verify your account.');
    } finally {
      setAuthBusy(false);
    }
  };

  const pay = useCallback(async () => {
    if (phase.kind !== 'ready') return;
    const sessionId = phase.session.payment_session_id;
    if (!sessionId) {
      setActionError('The gateway did not return a payment session. Please retry.');
      return;
    }
    setActionError(null);
    setProcessing(true);
    try {
      await openCashfreeCheckout({
        mode: phase.session.mode === 'production' ? 'production' : 'sandbox',
        paymentSessionId: sessionId,
      });
    } catch (err) {
      setProcessing(false);
      setActionError(err instanceof Error ? err.message : 'Could not open the payment gateway.');
    }
  }, [phase]);

  if (phase.kind === 'loading') {
    return (
      <div className="ck-loading" role="status" data-testid="pay-loading">
        Preparing your secure payment…
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="ck-panel" role="alert" data-testid="pay-error">
        <h1 className="ck-title">Payment unavailable</h1>
        <p className="ck-lede">{phase.message}</p>
        <div className="gw-actions">
          <a className="btn btn-primary" href="/#pricing">
            Back to pricing
          </a>
          <a className="btn btn-ghost" href="/account">
            Go to My subscription
          </a>
        </div>
      </div>
    );
  }

  if (phase.kind === 'auth') {
    return (
      <div className="ck-panel" data-testid="pay-auth">
        <div className="ck-head">
          <h1 className="ck-title">Confirm it&rsquo;s you</h1>
          <p className="ck-lede">
            Sign in with the account you created at checkout to finish paying.
          </p>
        </div>
        <form className="ck-form ck-stack" onSubmit={submitAuth}>
          <label className="ck-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="pay-email"
            />
          </label>
          <label className="ck-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="pay-password"
            />
          </label>
          {actionError && (
            <div className="ck-error" role="alert" data-testid="pay-auth-error">
              {actionError}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={authBusy}
            data-testid="pay-auth-submit"
          >
            {authBusy ? 'Checking…' : 'Continue to payment'}
          </button>
        </form>
      </div>
    );
  }

  const { order } = phase.order;
  const amount = formatMoney(order.amount);
  const bonusDays =
    phase.order.bonus && phase.order.bonus.firstRechargeEligible && phase.order.bonus.days > 0
      ? phase.order.bonus.days
      : 0;

  return (
    <div className="gw-card" data-testid="pay-view">
      <div className="ck-head">
        <a className="ck-back" href="/#pricing">
          ← Back to pricing
        </a>
        <h1 className="ck-title">Complete your payment</h1>
        <p className="ck-lede">
          Pay for your {order.plan_name} subscription. You&rsquo;ll be taken to Cashfree&rsquo;s
          secure checkout to pay by card, UPI or net banking.
        </p>
      </div>

      <dl className="gw-rows" data-testid="pay-summary">
        <div className="gw-row">
          <dt>Plan</dt>
          <dd>{order.plan_name}</dd>
        </div>
        <div className="gw-row">
          <dt>Billing</dt>
          <dd>{order.billing_cycle === 'YEARLY' ? 'Yearly' : 'Monthly'}</dd>
        </div>
        {phase.order.invoice && (
          <div className="gw-row">
            <dt>Invoice</dt>
            <dd data-testid="pay-invoice-number">{phase.order.invoice.number}</dd>
          </div>
        )}
        <div className="gw-row gw-total">
          <dt>Amount due</dt>
          <dd data-testid="pay-amount">{amount}</dd>
        </div>
      </dl>

      {bonusDays > 0 && (
        <p className="ck-bonus-note" data-testid="pay-bonus-preview">
          +{bonusDays} extra days of validity are included — that&rsquo;s your first-recharge bonus.
        </p>
      )}

      <p className="gw-sim-note">
        <svg
          className="gw-lock"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <path d="M4 11h16v11H4z" />
        </svg>
        Secured by Cashfree. Your card details never touch API Hub.
      </p>

      {actionError && (
        <div className="ck-error" role="alert" data-testid="pay-error-inline">
          {actionError}
        </div>
      )}

      <div className="gw-actions">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={pay}
          disabled={processing}
          data-testid="pay-submit"
        >
          {processing ? 'Opening secure checkout…' : `Pay ${amount ?? ''} securely`}
        </button>
        <a className="btn btn-ghost" href={receiptUrl(order.id)}>
          View order
        </a>
      </div>
    </div>
  );
}
