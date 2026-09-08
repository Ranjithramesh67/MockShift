'use client';

import { useEffect, useState } from 'react';
import { fetchOrder, formatMoney, formatDate, type Order, type OrderStatusResult } from '@/lib/checkoutApi';

type GatewayFields = {
  status: string | null;
  provider: string | null;
  reference: string | null;
  paid_at: string | null;
};

type OrderWithGateway = Order & { gateway?: GatewayFields };

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: OrderStatusResult & { order: OrderWithGateway } };

export default function ReceiptView({ orderId, bonusDays }: { orderId: string; bonusDays: number }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    if (!orderId) {
      setLoad({ kind: 'error', message: 'No order was supplied.' });
      return;
    }
    let alive = true;
    setLoad({ kind: 'loading' });
    fetchOrder(orderId)
      .then((data) => {
        if (!alive) return;
        setLoad({ kind: 'ready', data });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load your order.' });
      });
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (load.kind === 'loading') {
    return (
      <div className="ck-loading" role="status" data-testid="receipt-loading">
        Loading your receipt…
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="ck-panel" role="alert" data-testid="receipt-error">
        <h1 className="ck-title">Receipt unavailable</h1>
        <p className="ck-lede">{load.message}</p>
        <div className="rc-actions">
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

  const { order, invoice, subscription } = load.data;
  const paid = order.status === 'PAID';
  const amount = formatMoney(order.amount);

  if (!paid) {
    return (
      <div className="rc-sheet" data-testid="receipt-view">
        <div className="ck-center">
          <h1 className="rc-title">This order is not paid yet</h1>
          <p className="rc-muted">
            {order.plan_name} · order {short(order.id)} is {order.status.toLowerCase()}.
          </p>
        </div>
        <div className="rc-actions">
          <a className="btn btn-primary" href={`/gateway?orderId=${encodeURIComponent(order.id)}`} data-testid="receipt-cta-gateway">
            Continue to payment
          </a>
          <a className="btn btn-ghost" href="/#pricing">
            Back to pricing
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rc-sheet" data-testid="receipt-view">
      <div className="rc-center">
        <div className="ck-result-icon" aria-hidden="true" style={{ margin: '0 auto 18px' }}>
          ✓
        </div>
        <span className="rc-badge">Payment received</span>
        <h1 className="rc-title">Thank you — you&rsquo;re on {order.plan_name}</h1>
        <p className="rc-muted" data-testid="receipt-plan">
          {order.plan_name} · {order.billing_cycle === 'YEARLY' ? 'Yearly billing' : 'Monthly billing'} ·{' '}
          {order.currency}
        </p>
      </div>

      {bonusDays > 0 && (
        <p className="ck-bonus-note" data-testid="receipt-bonus">
          +{bonusDays} extra days of validity were added — that was your first-recharge bonus.
        </p>
      )}

      <hr className="rc-sep" />

      <dl className="gw-rows">
        <div className="rc-row">
          <dt>Amount paid</dt>
          <dd data-testid="receipt-amount">{amount}</dd>
        </div>
        {invoice && (
          <div className="rc-row">
            <dt>Invoice</dt>
            <dd data-testid="receipt-invoice-number">
              {invoice.number} · <span style={{ color: 'var(--ok)' }}>Paid</span>
            </dd>
          </div>
        )}
        {order.gateway && order.gateway.reference && (
          <div className="rc-row">
            <dt>Provider reference</dt>
            <dd data-testid="receipt-reference">{order.gateway.reference}</dd>
          </div>
        )}
        {order.gateway && order.gateway.provider && (
          <div className="rc-row">
            <dt>Provider</dt>
            <dd>{order.gateway.provider}</dd>
          </div>
        )}
        {order.gateway && order.gateway.paid_at && (
          <div className="rc-row">
            <dt>Paid on</dt>
            <dd data-testid="receipt-paid-at">{formatDate(order.gateway.paid_at)}</dd>
          </div>
        )}
        <div className="rc-row">
          <dt>Order</dt>
          <dd data-testid="receipt-order-id">{short(order.id)}</dd>
        </div>
        {subscription && (
          <>
            <div className="rc-row">
              <dt>Status</dt>
              <dd>
                <span className="ck-badge ck-badge-ok">Active</span>
              </dd>
            </div>
            <div className="rc-row">
              <dt>Valid through</dt>
              <dd data-testid="receipt-valid-through">{formatDate(subscription.current_period_end)}</dd>
            </div>
          </>
        )}
      </dl>

      <div className="rc-actions">
        <a className="btn btn-primary" href="/account" data-testid="receipt-cta-account">
          Go to My subscription
        </a>
        <a className="btn btn-ghost" href="/#product">
          Explore features
        </a>
      </div>

      <p className="rc-note">
        This is a receipt for a simulated payment in the API Hub demo. No real charge was made.
      </p>
    </div>
  );
}

function short(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
