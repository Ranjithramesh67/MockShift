'use client';

// Portal A (A5) — "My subscription" self-service view: current plan + status,
// cancel-at-period-end / reactivate, plan change (routes through the A4
// checkout), invoice history, account + sign out.

import { useCallback, useEffect, useState } from 'react';
import {
  cancelSubscription,
  fetchAccountOverview,
  fetchMe,
  fetchPlans,
  formatDate,
  formatMoney,
  reactivateSubscription,
  signOut,
  type AccountOverview,
  type CatalogPlan,
  type Subscription,
} from '@/lib/checkoutApi';

type Status = 'loading' | 'signed-out' | 'error' | 'ready';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  TRIALING: 'Trial',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
};

function cycleLabel(cycle: string): string {
  return cycle === 'YEARLY' ? 'Yearly' : 'Monthly';
}

export default function AccountView() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AccountOverview | null>(null);
  const [plans, setPlans] = useState<CatalogPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setMessage(null);
    try {
      const me = await fetchMe();
      if (!me) {
        setStatus('signed-out');
        return;
      }
      const overview = await fetchAccountOverview();
      setData(overview);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not load your subscription');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applySubscription = useCallback((sub: Subscription) => {
    setData((prev) => (prev ? { ...prev, current: sub } : prev));
  }, []);

  const onCancel = useCallback(async () => {
    const sub = data?.current;
    if (!sub) return;
    if (!window.confirm(`Cancel your ${sub.plan.name} plan at the end of its billing period? You keep access until then.`)) {
      return;
    }
    setBusy('cancel');
    setMessage(null);
    try {
      const result = await cancelSubscription(sub.id);
      applySubscription(result.subscription);
      setMessage({
        kind: 'ok',
        text: `Cancellation scheduled — ${result.subscription.plan.name} stays active until ${formatDate(result.subscription.current_period_end)}.`,
      });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not cancel' });
    } finally {
      setBusy(null);
    }
  }, [data, applySubscription]);

  const onReactivate = useCallback(async () => {
    const sub = data?.current;
    if (!sub) return;
    setBusy('reactivate');
    setMessage(null);
    try {
      const result = await reactivateSubscription(sub.id);
      applySubscription(result.subscription);
      setMessage({ kind: 'ok', text: 'Cancellation cancelled — your subscription continues as normal.' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not reactivate' });
    } finally {
      setBusy(null);
    }
  }, [data, applySubscription]);

  const openSwitcher = useCallback(async () => {
    if (!plans) {
      try {
        setPlans(await fetchPlans());
      } catch {
        setMessage({ kind: 'err', text: 'Could not load available plans' });
        return;
      }
    }
    setSwitcherOpen((open) => !open);
  }, [plans]);

  const onSignOut = useCallback(async () => {
    await signOut();
    window.location.assign('/');
  }, []);

  if (status === 'loading') {
    return (
      <div className="ac ac-center" data-testid="account-view">
        <span className="ac-spinner" aria-hidden="true" />
        <p className="ac-muted">Loading your subscription…</p>
      </div>
    );
  }

  if (status === 'signed-out') {
    return (
      <div className="ac" data-testid="account-view">
        <div className="ac-card ac-empty" data-testid="account-empty">
          <span className="ac-empty-icon" aria-hidden="true">
            AH
          </span>
          <h2>Sign in to see your subscription</h2>
          <p>
            Your account, current plan, invoices and cancel / change controls live here. Use the same
            credentials you chose at checkout.
          </p>
          <div className="ac-actions">
            <a className="ac-btn ac-btn-primary" href="/login?next=/account">
              Sign in
            </a>
            <a className="ac-btn ac-btn-ghost" href="/#pricing">
              Browse plans
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="ac" data-testid="account-view">
        <div className="ac-card">
          <h2>Something went wrong</h2>
          <p className="ac-muted">{error || 'Could not load your subscription.'}</p>
          <div className="ac-actions">
            <button type="button" className="ac-btn ac-btn-primary" onClick={load}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const current = data?.current ?? null;
  const canScheduleCancel =
    !!current &&
    (current.status === 'ACTIVE' || current.status === 'TRIALING') &&
    !current.cancel_at_period_end &&
    current.plan.key !== 'free';
  const canUndoCancel = !!current && current.cancel_at_period_end;
  const activeCycle =
    current && (current.billing_cycle === 'MONTHLY' || current.billing_cycle === 'YEARLY')
      ? current.billing_cycle
      : 'MONTHLY';

  return (
    <div className="ac" data-testid="account-view">
      {message ? (
        <div
          className={`ac-banner ac-banner-${message.kind}`}
          data-testid="account-msg"
          role={message.kind === 'err' ? 'alert' : 'status'}
        >
          {message.text}
        </div>
      ) : null}

      <section className="ac-head">
        <div>
          <h1>My subscription</h1>
          <p className="ac-muted">
            Signed in as <strong>{data?.account.name}</strong> · {data?.account.email}
          </p>
        </div>
        <button type="button" className="ac-btn ac-btn-ghost ac-signout" onClick={onSignOut} data-testid="account-signout">
          Sign out
        </button>
      </section>

      {!current ? (
        <div className="ac-card ac-empty" data-testid="account-empty">
          <h2>No active subscription</h2>
          <p className="ac-muted">
            You don’t have a current plan yet. Pick a plan to get started — paid plans add +5/+10/+15
            extra validity days on your first recharge.
          </p>
          <div className="ac-actions">
            <a className="ac-btn ac-btn-primary" href="/#pricing">
              See plans &amp; pricing
            </a>
          </div>
        </div>
      ) : (
        <>
          <section className="ac-card ac-plan-card" data-testid="account-plan-card">
            <div className="ac-plan-top">
              <div>
                <span className="ac-plan-name" data-testid="account-sub-plan">
                  {current.plan.name}
                </span>
                <span className={`ac-chip ac-chip-${current.status.toLowerCase()}`} data-testid="account-sub-status">
                  {STATUS_LABEL[current.status] ?? current.status}
                </span>
              </div>
              <button type="button" className="ac-btn ac-btn-outline" onClick={openSwitcher} data-testid="account-switch-toggle">
                {switcherOpen ? 'Hide plans' : current.plan.key === 'free' ? 'Choose a plan' : 'Change plan'}
              </button>
            </div>

            <dl className="ac-meta">
              <div>
                <dt>Billing cycle</dt>
                <dd>{cycleLabel(current.billing_cycle)}</dd>
              </div>
              <div>
                <dt>Renews on</dt>
                <dd data-testid="account-sub-renews">{current.current_period_end ? formatDate(current.current_period_end) : '—'}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatDate(current.created_at)}</dd>
              </div>
            </dl>

            {current.cancel_at_period_end ? (
              <div className="ac-cancel-note" data-testid="account-cancel-note">
                <p>
                  Your {current.plan.name} plan is scheduled to end on {formatDate(current.current_period_end)} — you
                  keep access until then.
                </p>
                <button
                  type="button"
                  className="ac-btn ac-btn-ghost"
                  onClick={onReactivate}
                  disabled={busy !== null}
                  data-testid="account-reactivate"
                >
                  {busy === 'reactivate' ? 'Keeping…' : 'Keep my subscription'}
                </button>
              </div>
            ) : null}

            {canScheduleCancel && !current.cancel_at_period_end ? (
              <div className="ac-danger-zone">
                <p className="ac-muted">No longer need {current.plan.name}? Cancel at the end of your billing period.</p>
                <button
                  type="button"
                  className="ac-btn ac-btn-danger"
                  onClick={onCancel}
                  disabled={busy !== null}
                  data-testid="account-cancel"
                >
                  {busy === 'cancel' ? 'Cancelling…' : 'Cancel at period end'}
                </button>
              </div>
            ) : null}

            {switcherOpen ? (
              <div className="ac-switcher" data-testid="account-switch-list">
                <p className="ac-switcher-title">
                  {current.plan.key === 'free'
                    ? 'Choose a paid plan — payment runs through the normal checkout.'
                    : 'Switching pays for the new plan through checkout and moves you immediately; your current plan is cancelled.'}
                </p>
                {plans === null ? (
                  <p className="ac-muted">Loading plans…</p>
                ) : (
                  <ul>
                    {plans
                      .filter((p) => p.key !== current.plan.key)
                      .map((p) => {
                        const price = p.price_monthly ? formatMoney(p.price_monthly) : null;
                        const href = price
                          ? `/checkout?plan=${encodeURIComponent(p.key)}&cycle=${p.billing_cycles.includes(activeCycle as 'MONTHLY' | 'YEARLY') ? activeCycle : 'MONTHLY'}`
                          : null;
                        return (
                          <li key={p.key} className="ac-switch-row">
                            <span>
                              <strong>{p.name}</strong>
                              <span className="ac-muted">{p.tagline}</span>
                            </span>
                            <span className="ac-switch-price">{price ? `${price}/mo` : 'Custom'}</span>
                            {href ? (
                              <a className="ac-btn ac-btn-primary ac-btn-sm" href={href} data-testid={`account-switch-plan-${p.key}`}>
                                {p.key === 'free' ? 'Switch to Free' : 'Choose'}
                              </a>
                            ) : (
                              <span className="ac-muted ac-contact-sales">Contact sales</span>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            ) : null}
          </section>

          <section className="ac-card" data-testid="account-invoices">
            <div className="ac-sec-head">
              <h2>Invoices</h2>
            </div>
            {!data?.invoices || data.invoices.length === 0 ? (
              <p className="ac-muted ac-none">No invoices yet — payments you make appear here.</p>
            ) : (
              <ul className="ac-invoice-list">
                {data.invoices.map((inv) => (
                  <li className="ac-invoice-row" key={inv.id} data-testid={`account-inv-${inv.number}`}>
                    <span className="ac-inv-left">
                      <span className="ac-inv-number">{inv.number}</span>
                      <span className="ac-inv-plan">
                        {inv.plan_name} · {cycleLabel(inv.billing_cycle)}
                      </span>
                    </span>
                    <span className={`ac-chip ac-chip-${inv.status.toLowerCase()}`}>{inv.status}</span>
                    <span className="ac-inv-date">{inv.paid_at ? `Paid ${formatDate(inv.paid_at)}` : formatDate(inv.created_at)}</span>
                    <strong className="ac-inv-amount">{formatMoney(inv.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
