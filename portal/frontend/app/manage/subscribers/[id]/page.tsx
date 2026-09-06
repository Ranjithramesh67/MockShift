'use client';

import '../../manage.css';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Alert,
  BackLink,
  Card,
  EmptyState,
  LoadingBlock,
  PageHead,
  StatusBadge,
  can,
  formatDate,
  formatDateTime,
  formatMoney,
  titleCase,
} from '@/components/manage/ui';
import { apiFetch, ApiError } from '@/lib/portalApi';

type PlanRef = { id: string; key: string; name: string; currency: string };

type SubscriptionDetail = {
  id: string;
  status: string;
  billing_cycle: string;
  plan: PlanRef;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  created_at: string;
};

type OrderDetail = {
  id: string;
  plan_key: string;
  plan_name: string;
  billing_cycle: string;
  amount: string;
  currency: string;
  status: string;
  payment_method: string;
  created_at: string;
};

type InvoiceDetail = {
  id: string;
  number: string;
  amount: string;
  currency: string;
  status: string;
  issued_at: string | null;
  paid_at: string | null;
};

type DetailResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    username: string | null;
    role: string;
    is_active: boolean;
    created_at: string;
  };
  subscriptions: SubscriptionDetail[];
  orders: OrderDetail[];
  invoices: InvoiceDetail[];
};

type MeResponse = {
  user: { id: string; name: string; role: string };
  portalRole: string | null;
};

type PlanOption = { id: string; key: string; name: string; status: string };

type AlertMsg = { kind: 'ok' | 'error'; text: string } | null;

export default function SubscriberDetailPage() {
  const params = useParams();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const userId = rawId ?? '';

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [alert, setAlert] = useState<AlertMsg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [changePlanFor, setChangePlanFor] = useState<string | null>(null);

  const canManage = can(meRole, 'MANAGER');
  const canAdmin = can(meRole, 'ADMIN');

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setFatal(null);
    try {
      const [d, me, planRes] = await Promise.all([
        apiFetch<DetailResponse>(`/api/subscribers/${encodeURIComponent(userId)}`),
        apiFetch<MeResponse>('/api/me').catch(() => null),
        apiFetch<{ plans: PlanOption[] }>('/api/plans').catch(() => ({ plans: [] })),
      ]);
      setDetail(d);
      setMeRole(me?.portalRole ?? null);
      setPlans(planRes.plans ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        setFatal(err.message);
      } else {
        setFatal('Failed to load subscriber');
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (key: string, path: string, confirmText?: string) => {
      if (confirmText && !window.confirm(confirmText)) return;
      setBusy(key);
      setAlert(null);
      try {
        await apiFetch(path, { method: 'POST', body: {} });
        setAlert({ kind: 'ok', text: 'Done.' });
        setChangePlanFor(null);
        await load();
      } catch (err) {
        setAlert({
          kind: 'error',
          text: err instanceof ApiError ? err.message : 'Request failed',
        });
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const changePlan = useCallback(
    async (subscriptionId: string, planId: string) => {
      setBusy(`plan-${subscriptionId}`);
      setAlert(null);
      try {
        await apiFetch(`/api/subscribers/subscriptions/${subscriptionId}/change-plan`, {
          method: 'POST',
          body: { planId },
        });
        setAlert({ kind: 'ok', text: 'Plan changed.' });
        setChangePlanFor(null);
        await load();
      } catch (err) {
        setAlert({
          kind: 'error',
          text: err instanceof ApiError ? err.message : 'Request failed',
        });
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  if (loading && !detail) {
    return <LoadingBlock label="Loading subscriber…" />;
  }

  if (fatal && !detail) {
    return (
      <div>
        <BackLink to="/manage/subscribers" label="All subscribers" />
        <Alert kind="error">{fatal}</Alert>
        <EmptyState
          title="Subscriber unavailable"
          hint="The profile may not exist or your role does not allow viewing it."
          action={
            <a className="pm-btn pm-btn-outline" href="/manage/subscribers">
              Back to subscribers
            </a>
          }
        />
      </div>
    );
  }

  if (!detail) return null;

  const user = detail.user;
  const changeablePlans = plans.filter((p) => p.status === 'PUBLISHED');

  return (
    <div data-testid="subscriber-detail">
      <BackLink to="/manage/subscribers" label="All subscribers" />
      <PageHead
        title={user.name}
        description={`${user.email} · ${titleCase(user.role)}`}
      />

      {alert ? <Alert kind={alert.kind}>{alert.text}</Alert> : null}

      <Card>
        <div className="pm-kv">
          <div className="pm-kv-item">
            <div className="pm-kv-label">Name</div>
            <div className="pm-kv-value">{user.name}</div>
          </div>
          <div className="pm-kv-item">
            <div className="pm-kv-label">Email</div>
            <div className="pm-kv-value">{user.email}</div>
          </div>
          <div className="pm-kv-item">
            <div className="pm-kv-label">Role</div>
            <div className="pm-kv-value">{titleCase(user.role)}</div>
          </div>
          <div className="pm-kv-item">
            <div className="pm-kv-label">Username</div>
            <div className="pm-kv-value">{user.username ?? '—'}</div>
          </div>
          <div className="pm-kv-item">
            <div className="pm-kv-label">Member since</div>
            <div className="pm-kv-value">{formatDate(user.created_at)}</div>
          </div>
          <div className="pm-kv-item">
            <div className="pm-kv-label">Account</div>
            <div className="pm-kv-value">{user.is_active ? 'Active' : 'Disabled'}</div>
          </div>
        </div>
      </Card>

      <Card title={`Subscriptions (${detail.subscriptions.length})`}>
        {detail.subscriptions.length === 0 ? (
          <EmptyState title="No subscriptions" />
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Cycle</th>
                  <th>Period start</th>
                  <th>Period end</th>
                  <th>Trial ends</th>
                  <th>Cancel at period end</th>
                  {canManage ? <th className="pm-table-actions">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {detail.subscriptions.map((sub) => (
                  <SubscriptionRow
                    key={sub.id}
                    sub={sub}
                    canManage={canManage}
                    busy={busy}
                    plans={changeablePlans}
                    changePlanOpen={changePlanFor === sub.id}
                    onToggleChangePlan={() =>
                      setChangePlanFor((cur) => (cur === sub.id ? null : sub.id))
                    }
                    onActivate={() =>
                      runAction(
                        `activate-${sub.id}`,
                        `/api/subscribers/subscriptions/${sub.id}/activate`
                      )
                    }
                    onSuspend={() =>
                      runAction(
                        `suspend-${sub.id}`,
                        `/api/subscribers/subscriptions/${sub.id}/suspend`
                      )
                    }
                    onCancel={() =>
                      runAction(
                        `cancel-${sub.id}`,
                        `/api/subscribers/subscriptions/${sub.id}/cancel`,
                        `Cancel the ${sub.plan.name} subscription immediately?`
                      )
                    }
                    onChangePlan={(planId) => changePlan(sub.id, planId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Orders (${detail.orders.length})`}>
        {detail.orders.length === 0 ? (
          <EmptyState title="No orders" />
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Plan</th>
                  <th>Cycle</th>
                  <th>Amount</th>
                  <th>Payment method</th>
                  <th>Status</th>
                  {canAdmin ? <th className="pm-table-actions">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="pm-cell-sub">{formatDateTime(o.created_at)}</td>
                    <td>
                      <span className="pm-cell-main">{o.plan_name}</span>
                      <div className="pm-cell-sub">{o.plan_key}</div>
                    </td>
                    <td className="pm-cell-sub">{o.billing_cycle}</td>
                    <td className="pm-cell-num">{formatMoney(o.amount, o.currency)}</td>
                    <td className="pm-cell-sub">{titleCase(o.payment_method)}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    {canAdmin ? (
                      <td>
                        <div className="pm-table-actions">
                          {o.status === 'PAID' ? (
                            <button
                              type="button"
                              data-testid="order-action-refund"
                              className="pm-btn pm-btn-sm pm-btn-outline"
                              disabled={busy !== null}
                              onClick={() =>
                                runAction(
                                  `refund-${o.id}`,
                                  `/api/subscribers/orders/${o.id}/refund`,
                                  `Refund ${formatMoney(o.amount, o.currency)} for this order? Linked paid invoices will be voided.`
                                )
                              }
                            >
                              Refund
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Invoices (${detail.invoices.length})`}>
        {detail.invoices.length === 0 ? (
          <EmptyState title="No invoices" />
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Issued</th>
                  <th>Paid</th>
                  {canAdmin ? <th className="pm-table-actions">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {detail.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="pm-cell-main">{inv.number}</td>
                    <td className="pm-cell-num">{formatMoney(inv.amount, inv.currency)}</td>
                    <td>
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="pm-cell-sub">{formatDateTime(inv.issued_at)}</td>
                    <td className="pm-cell-sub">{formatDateTime(inv.paid_at)}</td>
                    {canAdmin ? (
                      <td>
                        <div className="pm-table-actions">
                          {inv.status === 'ISSUED' || inv.status === 'PAID' ? (
                            <button
                              type="button"
                              data-testid="invoice-action-void"
                              className="pm-btn pm-btn-sm pm-btn-outline"
                              disabled={busy !== null}
                              onClick={() =>
                                runAction(
                                  `void-${inv.id}`,
                                  `/api/subscribers/invoices/${inv.id}/void`,
                                  `Void invoice ${inv.number}?`
                                )
                              }
                            >
                              Void
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SubscriptionRow({
  sub,
  canManage,
  busy,
  plans,
  changePlanOpen,
  onToggleChangePlan,
  onActivate,
  onSuspend,
  onCancel,
  onChangePlan,
}: {
  sub: SubscriptionDetail;
  canManage: boolean;
  busy: string | null;
  plans: PlanOption[];
  changePlanOpen: boolean;
  onToggleChangePlan: () => void;
  onActivate: () => void;
  onSuspend: () => void;
  onCancel: () => void;
  onChangePlan: (planId: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const rowBusy = busy !== null;

  useEffect(() => {
    if (!changePlanOpen) setSelected('');
  }, [changePlanOpen]);

  return (
    <>
      <tr>
        <td>
          <span className="pm-cell-main">{sub.plan.name}</span>
          <div className="pm-cell-sub">{sub.plan.key}</div>
        </td>
        <td>
          <StatusBadge status={sub.status} />
        </td>
        <td className="pm-cell-sub">{sub.billing_cycle}</td>
        <td className="pm-cell-sub">{formatDate(sub.current_period_start)}</td>
        <td className="pm-cell-sub">{formatDate(sub.current_period_end)}</td>
        <td className="pm-cell-sub">{formatDate(sub.trial_ends_at)}</td>
        <td className="pm-cell-sub">{sub.cancel_at_period_end ? 'Yes' : 'No'}</td>
        {canManage ? (
          <td>
            <div className="pm-table-actions">
              {sub.status !== 'ACTIVE' ? (
                <button
                  type="button"
                  data-testid="sub-action-activate"
                  className="pm-btn pm-btn-sm"
                  disabled={rowBusy}
                  onClick={onActivate}
                >
                  Activate
                </button>
              ) : null}
              {sub.status !== 'SUSPENDED' && sub.status !== 'CANCELLED' ? (
                <button
                  type="button"
                  data-testid="sub-action-suspend"
                  className="pm-btn pm-btn-sm pm-btn-ghost"
                  disabled={rowBusy}
                  onClick={onSuspend}
                >
                  Suspend
                </button>
              ) : null}
              {sub.status !== 'CANCELLED' ? (
                <button
                  type="button"
                  data-testid="sub-action-cancel"
                  className="pm-btn pm-btn-sm pm-btn-danger"
                  disabled={rowBusy}
                  onClick={onCancel}
                >
                  Cancel
                </button>
              ) : null}
              {sub.status !== 'CANCELLED' && sub.status !== 'EXPIRED' ? (
                <button
                  type="button"
                  className="pm-btn pm-btn-sm pm-btn-ghost"
                  disabled={rowBusy}
                  onClick={onToggleChangePlan}
                >
                  Change plan
                </button>
              ) : null}
            </div>
          </td>
        ) : null}
      </tr>
      {changePlanOpen ? (
        <tr>
          <td colSpan={canManage ? 8 : 7}>
            <div className="pm-toolbar">
              <select
                className="pm-select"
                aria-label="Target plan"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose a plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pm-btn pm-btn-sm pm-btn-primary"
                disabled={!selected || rowBusy}
                onClick={() => selected && onChangePlan(selected)}
              >
                Apply
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-sm pm-btn-ghost"
                onClick={onToggleChangePlan}
              >
                Close
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
