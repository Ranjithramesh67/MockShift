'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchOrder, formatMoney, type OrderStatusResult, type Invoice, type Order, type Subscription } from '@/lib/checkoutApi';

type PayResult = {
  ok: true;
  order: Order;
  invoice: Invoice | null;
  subscription: Subscription | null;
  bonus: { firstRecharge: boolean; days: number } | null;
  gateway?: { provider: string; reference: string; paid_at: string | null };
  alreadyProcessed?: boolean;
};

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: OrderStatusResult }
  | { kind: 'processing'; data: OrderStatusResult };

async function gatewayPay(orderId: string): Promise<PayResult> {
  const res = await fetch(`/api/public/gateway/${orderId}/pay`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Payment request failed (${res.status})`;
    throw new Error(message);
  }
  return data as PayResult;
}

export default function GatewayView() {
  const params = useSearchParams();
  const router = useRouter();
  const orderId = params.get('orderId') || '';

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setLoad({ kind: 'error', message: 'No order was supplied to the gateway.' });
      return;
    }
    let alive = true;
    setLoad({ kind: 'loading' });
    setActionError(null);
    fetchOrder(orderId)
      .then((data) => {
        if (!alive) return;
        setLoad({ kind: 'ready', data });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : 'Could not load your order.';
        setLoad({ kind: 'error', message });
      });
    return () => {
      alive = false;
    };
  }, [orderId]);

  // Already-settled orders (refresh after paying, or a completed order that
  // landed back here) are sent straight to the receipt.
  const { order } = load.kind === 'ready' || load.kind === 'processing' ? load.data : { order: null as Order | null };
  useEffect(() => {
    if ((load.kind === 'ready' || load.kind === 'processing') && order && order.status === 'PAID') {
      router.replace(`/receipt/${encodeURIComponent(order.id)}`);
    }
  }, [load.kind, order, router]);

  const pay = useCallback(async () => {
    if (load.kind !== 'ready') return;
    setActionError(null);
    setLoad({ kind: 'processing', data: load.data });
    try {
      const result = await gatewayPay(orderId);
      const bonusDays = result.bonus && result.bonus.days > 0 ? result.bonus.days : 0;
      router.push(`/receipt/${encodeURIComponent(orderId)}?bonus=${bonusDays}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment could not be completed.');
      setLoad({ kind: 'ready', data: load.data });
    }
  }, [load, orderId, router]);

  if (load.kind === 'loading') {
    return (
      <div className="ck-loading" role="status" data-testid="gateway-loading">
        Loading your payment…
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="ck-panel" role="alert" data-testid="gateway-error">
        <h1 className="ck-title">Payment unavailable</h1>
        <p className="ck-lede">{load.message}</p>
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

  const data = load.data;
  const isFree = Number(data.order.amount) === 0;
  const payable = data.order.status === 'PENDING' && !isFree;
  const bonus = data.bonus && data.bonus.firstRechargeEligible && data.bonus.days > 0 ? data.bonus.days : 0;

  return (
    <div className="gw-card" data-testid="gateway-view">
      <div className="ck-head">
        <a className="ck-back" href="/#pricing">
          ← Back to pricing
        </a>
        <h1 className="ck-title">Complete your payment</h1>
        <p className="ck-lede">
          Pay for your {data.order.plan_name} subscription to activate it. This demo uses a
          simulated gateway — no real money moves.
        </p>
      </div>

      {data.order.status !== 'PENDING' ? (
        <div data-testid="gateway-pending-notice">
          <p className="ck-hint">This order is {data.order.status.toLowerCase()} — nothing to pay here.</p>
          <div className="gw-actions">
            <a className="btn btn-primary" href={`/receipt/${encodeURIComponent(data.order.id)}`}>
              View receipt
            </a>
            <a className="btn btn-ghost" href="/#pricing">
              Back to pricing
            </a>
          </div>
        </div>
      ) : payable ? (
        <>
          <dl className="gw-rows" data-testid="gateway-summary">
            <div className="gw-row">
              <dt>Plan</dt>
              <dd>{data.order.plan_name}</dd>
            </div>
            <div className="gw-row">
              <dt>Billing</dt>
              <dd>{data.order.billing_cycle === 'YEARLY' ? 'Yearly' : 'Monthly'}</dd>
            </div>
            {data.invoice && (
              <div className="gw-row">
                <dt>Invoice</dt>
                <dd data-testid="gateway-invoice-number">{data.invoice.number}</dd>
              </div>
            )}
            <div className="gw-row gw-total">
              <dt>Amount due</dt>
              <dd data-testid="gateway-amount">{formatMoney(data.order.amount)}</dd>
            </div>
          </dl>

          {bonus > 0 && (
            <p className="ck-bonus-note" data-testid="gateway-bonus-preview">
              +{bonus} extra days of validity are included — that&rsquo;s your first-recharge bonus.
            </p>
          )}

          <div className="gw-card" style={{ background: 'var(--bg-input)' }}>
            <span className="gw-method">
              <svg className="gw-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                <path d="M4 11h16v11H4z" />
              </svg>
              Card ending ···· 4242
            </span>
            <div className="gw-card-grid" aria-hidden="true">
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Expiry (MM/YY)</span>
                <div className="gw-card-input">12 / 29</div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CVV</span>
                <div className="gw-card-input">•••</div>
              </div>
            </div>
            <p className="gw-sim-note">
              <svg className="gw-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              This is a simulated payment gateway. Pressing “Pay now” runs a fake charge and
              finalizes your order through a demo webhook.
            </p>
          </div>

          {actionError && (
            <div className="ck-error" role="alert" data-testid="gateway-error-inline">
              {actionError}
            </div>
          )}

          <div className="gw-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={pay}
              disabled={load.kind === 'processing'}
              data-testid="gateway-pay"
            >
              {load.kind === 'processing' ? 'Processing payment…' : 'Pay now (simulated)'}
            </button>
            <a className="btn btn-ghost" href="/#pricing">
              Cancel
            </a>
          </div>
        </>
      ) : (
        <div data-testid="gateway-noop">
          <p className="ck-lede">Free plans activate instantly — no payment is needed.</p>
          <div className="gw-actions">
            <a className="btn btn-primary" href="/account">
              Go to My subscription
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
