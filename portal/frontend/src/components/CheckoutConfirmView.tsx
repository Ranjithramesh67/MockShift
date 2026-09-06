'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  fetchOrder,
  confirmOrder,
  formatMoney,
  formatDate,
  type OrderStatusResult,
  type ConfirmResult,
} from '@/lib/checkoutApi';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: OrderStatusResult }
  | { kind: 'confirming'; data: OrderStatusResult };

export default function CheckoutConfirmView() {
  const params = useSearchParams();
  const orderId = params.get('order') || '';

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [bonusApplied, setBonusApplied] = useState<{ days: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setLoad({ kind: 'error', message: 'No order was supplied.' });
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
        const message =
          err instanceof Error && /already exists/.test(err.message)
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not load your order.';
        setLoad({ kind: 'error', message });
      });
    return () => {
      alive = false;
    };
  }, [orderId]);

  const pay = useCallback(async () => {
    if (load.kind !== 'ready') return;
    setActionError(null);
    setLoad({ kind: 'confirming', data: load.data });
    try {
      const result: ConfirmResult = await confirmOrder(orderId);
      if (result.subscription) {
        setBonusApplied(result.bonus && result.bonus.days > 0 ? { days: result.bonus.days } : null);
      }
      setLoad({
        kind: 'ready',
        data: {
          order: result.order,
          invoice: result.invoice,
          subscription: result.subscription,
          bonus: null,
        },
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment could not be completed.');
      setLoad({ kind: 'ready', data: load.data });
    }
  }, [load, orderId]);

  if (load.kind === 'loading') {
    return (
      <div className="ck-loading" role="status" data-testid="confirm-loading">
        Loading your order…
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="ck-panel" role="alert" data-testid="confirm-error">
        <h1 className="ck-title">Could not load your order</h1>
        <p className="ck-lede">
          {load.message} Please return to the pricing page and try again.
        </p>
        <div className="ck-actions">
          <a className="btn btn-primary" href="/#pricing">
            Back to pricing
          </a>
        </div>
      </div>
    );
  }

  const { order, invoice, subscription } = load.data;
  const paid = order.status === 'PAID';
  const pending = order.status === 'PENDING';
  const isFree = Number(order.amount) === 0;
  const payable = pending && !isFree;

  return (
    <div className="ck-shell" data-testid="confirm-view">
      <div className="ck-head">
        <a className="ck-back" href="/#pricing">
          ← Back to pricing
        </a>
        <h1 className="ck-title">{paid ? 'Payment confirmed' : 'Confirm your payment'}</h1>
        <p className="ck-lede">
          {paid
            ? `Order ${short(order.id)} is paid and your ${order.plan_name} subscription is active.`
            : payable
              ? 'Finish the (simulated) payment to activate your subscription.'
              : 'Review your order below.'}
        </p>
      </div>

      <div className="ck-grid">
        <aside className="ck-summary" aria-label="Order summary" data-testid="confirm-order-summary">
          <div className="ck-summary-plan">
            <span className="ck-summary-name">{order.plan_name}</span>
            <span className="ck-summary-cycle">
              {order.billing_cycle === 'YEARLY' ? 'Yearly billing' : 'Monthly billing'}
            </span>
          </div>
          <div className="ck-summary-price-row">
            <span>{isFree ? 'Total' : 'Amount due'}</span>
            <strong>{formatMoney(order.amount)}</strong>
          </div>
          {invoice && (
            <dl className="ck-detail ck-detail-compact">
              <div>
                <dt>Invoice</dt>
                <dd data-testid="confirm-invoice-number">{invoice.number}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {invoice.status === 'PAID' ? (
                    <span className="ck-badge ck-badge-ok">Paid</span>
                  ) : (
                    <span className="ck-badge">Awaiting payment</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
          <p className="ck-fine">
            Demo checkout — the gateway is simulated. No real payment is taken.
          </p>
        </aside>

        <section className="ck-panel" aria-label="Payment confirmation">
          {subscription ? (
            <div data-testid="confirm-success">
              <div className="ck-result-icon" aria-hidden="true">
                ✓
              </div>
              <h2 className="ck-sub">Your {order.plan_name} subscription is active</h2>
              <dl className="ck-detail">
                <div>
                  <dt>Plan</dt>
                  <dd data-testid="confirm-success-plan">{order.plan_name}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className="ck-badge ck-badge-ok">Active</span>
                  </dd>
                </div>
                <div>
                  <dt>Paid</dt>
                  <dd>
                    {formatMoney(order.amount)} — invoice {invoice?.number}
                  </dd>
                </div>
                <div>
                  <dt>Valid through</dt>
                  <dd data-testid="confirm-valid-through">
                    {formatDate(subscription.current_period_end)}
                  </dd>
                </div>
              </dl>
              {bonusApplied && bonusApplied.days > 0 && (
                <p className="ck-bonus-note" data-testid="confirm-bonus-applied">
                  +{bonusApplied.days} extra validity days were added — that was your first
                  recharge bonus.
                </p>
              )}
              <div className="ck-actions">
                <a className="btn btn-primary" href="/account">
                  Go to My subscription
                </a>
                <a className="btn btn-ghost" href="/#product">
                  Explore features
                </a>
              </div>
            </div>
          ) : pending && !isFree ? (
            <div data-testid="confirm-pending">
              <h2 className="ck-sub">Complete the payment to activate {order.plan_name}</h2>
              <p className="ck-hint">
                In production a payment gateway (UPI / card) would open here. This demo simulates a
                successful payment for you.
              </p>
              {load.data.bonus && load.data.bonus.firstRechargeEligible && load.data.bonus.days > 0 && (
                <p className="ck-bonus-note" data-testid="confirm-bonus-preview">
                  +{load.data.bonus.days} extra days of validity are included — that&rsquo;s your
                  first-recharge bonus.
                </p>
              )}
              {actionError && (
                <div className="ck-error" role="alert" data-testid="confirm-error-inline">
                  {actionError}
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={pay}
                disabled={load.kind === 'confirming'}
                data-testid="confirm-pay"
              >
                {load.kind === 'confirming' ? 'Confirming payment…' : 'Simulate successful payment'}
              </button>
            </div>
          ) : (
            <div data-testid="confirm-noop">
              <p className="ck-lede">This order is {order.status.toLowerCase()}.</p>
              <div className="ck-actions">
                <a className="btn btn-primary" href="/#pricing">
                  Back to pricing
                </a>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function short(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
