'use client';

import '../manage.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Card,
  EmptyState,
  LoadingBlock,
  PageHead,
  Pager,
  StatusBadge,
  can,
  formatDate,
  formatMoney,
} from '@/components/manage/ui';
import { apiFetch, ApiError } from '@/lib/portalApi';

const STATUS_OPTIONS = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
  'NONE',
];

type SubscriberRow = {
  user: { id: string; name: string; email: string | null };
  account?: {
    type: 'PERSONAL' | 'COMPANY';
    orgName: string | null;
    domain: string | null;
  };
  subscription: {
    id: string;
    status: string;
    billing_cycle: string;
    plan_id: string;
    plan_key: string | null;
    plan_name: string | null;
    current_period_end: string | null;
    trial_ends_at: string | null;
    cancel_at_period_end: boolean;
  } | null;
  totalOrders: number;
  totalPaid: string | null;
};

type ListResponse = {
  total: number;
  page: number;
  pageSize: number;
  subscribers: SubscriberRow[];
};

type PlanOption = { id: string; key: string; name: string; status: string };

type MeResponse = { portalRole: string | null };

type CreatedSubscriber = {
  user: { id: string; name: string; email: string; username: string | null };
  subscription: { id: string; status: string } | null;
  temporaryPassword?: string;
};

type Filters = { search: string; status: string; planId: string; accountType: string };

const ROLE_CHOICES = ['EDITOR', 'VIEWER'] as const;

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  role: 'EDITOR' as (typeof ROLE_CHOICES)[number],
  planId: '',
  billingCycle: 'MONTHLY',
};

export default function SubscribersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [accountType, setAccountType] = useState('');
  const [filters, setFilters] = useState<Filters>({
    search: '',
    status: '',
    planId: '',
    accountType: '',
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedSubscriber | null>(null);
  const [copied, setCopied] = useState(false);

  const canManage = can(meRole, 'MANAGER');

  useEffect(() => {
    apiFetch<{ plans: PlanOption[] }>('/api/plans')
      .then((res) => setPlans(res.plans ?? []))
      .catch(() => setPlans([]));
    apiFetch<MeResponse>('/api/me')
      .then((res) => setMeRole(res.portalRole ?? null))
      .catch(() => setMeRole(null));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.status) params.set('status', filters.status);
      if (filters.planId) params.set('planId', filters.planId);
      if (filters.accountType) params.set('accountType', filters.accountType);
      params.set('page', String(page));
      params.set('pageSize', '20');
      const res = await apiFetch<ListResponse>(`/api/subscribers?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load subscribers');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const apply = (next: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setCreated(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (saving) return;
    setCreateOpen(false);
    setCreated(null);
  };

  const submitCreate = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
      };
      if (form.password.trim()) payload.password = form.password;
      if (form.planId) {
        payload.planId = form.planId;
        payload.billingCycle = form.billingCycle;
      }
      const res = await apiFetch<CreatedSubscriber>('/api/subscribers', {
        method: 'POST',
        body: payload,
      });
      setCreated(res);
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create the subscriber');
    } finally {
      setSaving(false);
    }
  };

  const options = useMemo(
    () =>
      plans
        .filter((p) => p.status === 'PUBLISHED' || p.status === 'DRAFT')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [plans]
  );

  const grantPlans = useMemo(
    () =>
      plans
        .filter((p) => p.status === 'PUBLISHED')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [plans]
  );

  return (
    <div>
      <PageHead
        title="Subscribers"
        description="Users with a plan — search, filter by status or plan, and open a profile for lifecycle actions."
        actions={
          canManage ? (
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              data-testid="subscriber-create"
              onClick={openCreate}
            >
              New subscriber
            </button>
          ) : null
        }
      />

      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card>
        <form
          className="pm-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ search, status, planId, accountType });
          }}
        >
          <input
            data-testid="subscribers-search"
            className="pm-input pm-search"
            placeholder="Search name, email, username or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="pm-select"
            aria-label="Account type"
            data-testid="subscribers-account-type"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
          >
            <option value="">All accounts</option>
            <option value="PERSONAL">Individuals</option>
            <option value="COMPANY">Companies</option>
          </select>
          <select
            className="pm-select"
            aria-label="Subscription status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="pm-select"
            aria-label="Plan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">All plans</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="pm-btn pm-btn-primary">
            Apply
          </button>
          <button
            type="button"
            className="pm-btn pm-btn-ghost"
            onClick={() => {
              setSearch('');
              setStatus('');
              setPlanId('');
              setAccountType('');
              apply({ search: '', status: '', planId: '', accountType: '' });
            }}
          >
            Reset
          </button>
        </form>
      </Card>

      <Card>
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Account</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Cycle</th>
                <th>Renews / Trial ends</th>
                <th>Orders</th>
                <th>Paid total</th>
              </tr>
            </thead>
            {loading ? (
              <tbody>
                <tr>
                  <td colSpan={9} className="pm-table-empty">
                    <LoadingBlock />
                  </td>
                </tr>
              </tbody>
            ) : !data || data.subscribers.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9} className="pm-table-empty">
                    <EmptyState
                      title="No subscribers found"
                      hint="Try clearing the filters or adjusting the search term."
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody>
                {data.subscribers.map((s) => {
                  const ends = s.subscription
                    ? s.subscription.trial_ends_at ?? s.subscription.current_period_end
                    : null;
                  return (
                    <tr key={s.user.id} data-testid="subscriber-row">
                      <td>
                        <Link href={`/manage/subscribers/${s.user.id}`} className="pm-cell-main pm-link">
                          {s.user.name}
                        </Link>
                      </td>
                      <td className="pm-cell-sub">{s.user.email ?? '—'}</td>
                      <td>
                        <span className="pm-cell-main">
                          {s.account?.type === 'COMPANY' ? 'Company' : 'Individual'}
                        </span>
                        <div className="pm-cell-sub">
                          {s.account?.orgName ?? '—'}
                          {s.account?.domain ? ` · ${s.account.domain}` : ''}
                        </div>
                      </td>
                      <td>
                        {s.subscription?.plan_name ? (
                          <span>
                            <span className="pm-cell-main">{s.subscription.plan_name}</span>
                            <div className="pm-cell-sub">{s.subscription.plan_key}</div>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {s.subscription ? (
                          <StatusBadge status={s.subscription.status} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="pm-cell-sub">{s.subscription?.billing_cycle ?? '—'}</td>
                      <td className="pm-cell-sub">{formatDate(ends)}</td>
                      <td className="pm-cell-num">{s.totalOrders}</td>
                      <td className="pm-cell-num">{formatMoney(s.totalPaid)}</td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {data ? (
          <Pager
            page={data.page}
            total={data.total}
            pageSize={data.pageSize}
            onPage={setPage}
          />
        ) : null}
      </Card>

      {createOpen && canManage ? (
        <div
          className="pm-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCreate();
          }}
        >
          <div
            className="pm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="New subscriber"
          >
            <div className="pm-modal-head">
              <div className="pm-modal-title">
                {created ? 'Subscriber created' : 'New subscriber'}
              </div>
              <button type="button" className="pm-modal-close" aria-label="Close" onClick={closeCreate}>
                ×
              </button>
            </div>

            {created ? (
              <div className="pm-modal-body">
                <p className="pm-hint">
                  {created.user.name} ({created.user.email}) is ready
                  {created.subscription ? ' with a plan assigned' : ''}.
                </p>
                {created.temporaryPassword ? (
                  <div className="pm-field pm-field-full">
                    <span className="pm-label">Temporary password (shown once)</span>
                    <div className="pm-copy-row">
                      <input className="pm-input" readOnly value={created.temporaryPassword} />
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(created.temporaryPassword ?? '');
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        }}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <span className="pm-hint">
                      Share this with the user securely; it cannot be shown again.
                    </span>
                  </div>
                ) : null}
                <div className="pm-modal-foot">
                  <button type="button" className="pm-btn pm-btn-ghost" onClick={closeCreate}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="pm-btn pm-btn-primary"
                    data-testid="subscriber-created-open"
                    onClick={() => router.push(`/manage/subscribers/${created.user.id}`)}
                  >
                    Open profile
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submitCreate} noValidate>
                <div className="pm-modal-body">
                  {formError ? (
                    <div style={{ marginBottom: 16 }}>
                      <Alert kind="error">{formError}</Alert>
                    </div>
                  ) : null}
                  <div className="pm-form-grid">
                    <div className="pm-field pm-field-full">
                      <label className="pm-label" htmlFor="sub-name">
                        Name <span className="pm-req">*</span>
                      </label>
                      <input
                        id="sub-name"
                        className="pm-input"
                        data-testid="subscriber-create-name"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        autoComplete="off"
                      />
                    </div>
                    <div className="pm-field pm-field-full">
                      <label className="pm-label" htmlFor="sub-email">
                        Email <span className="pm-req">*</span>
                      </label>
                      <input
                        id="sub-email"
                        type="email"
                        className="pm-input"
                        data-testid="subscriber-create-email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <div className="pm-field pm-field-full">
                      <label className="pm-label" htmlFor="sub-password">
                        Password
                      </label>
                      <input
                        id="sub-password"
                        type="text"
                        className="pm-input"
                        data-testid="subscriber-create-password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="Leave blank to generate one"
                        autoComplete="new-password"
                        spellCheck={false}
                      />
                      <span className="pm-hint">At least 8 characters, or leave blank to auto-generate.</span>
                    </div>
                    <div className="pm-field">
                      <label className="pm-label" htmlFor="sub-role">
                        App role
                      </label>
                      <select
                        id="sub-role"
                        className="pm-select"
                        data-testid="subscriber-create-role"
                        value={form.role}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            role: e.target.value as (typeof ROLE_CHOICES)[number],
                          }))
                        }
                      >
                        {ROLE_CHOICES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="pm-field">
                      <label className="pm-label" htmlFor="sub-plan">
                        Plan (optional)
                      </label>
                      <select
                        id="sub-plan"
                        className="pm-select"
                        data-testid="subscriber-create-plan"
                        value={form.planId}
                        onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}
                      >
                        <option value="">No plan</option>
                        {grantPlans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {form.planId ? (
                      <div className="pm-field">
                        <label className="pm-label" htmlFor="sub-cycle">
                          Billing cycle
                        </label>
                        <select
                          id="sub-cycle"
                          className="pm-select"
                          data-testid="subscriber-create-cycle"
                          value={form.billingCycle}
                          onChange={(e) => setForm((f) => ({ ...f, billingCycle: e.target.value }))}
                        >
                          <option value="MONTHLY">Monthly</option>
                          <option value="YEARLY">Yearly</option>
                        </select>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="pm-modal-foot">
                  <button type="button" className="pm-btn pm-btn-ghost" onClick={closeCreate} disabled={saving}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="pm-btn pm-btn-primary"
                    data-testid="subscriber-create-submit"
                    disabled={saving}
                  >
                    {saving ? 'Creating…' : 'Create subscriber'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
