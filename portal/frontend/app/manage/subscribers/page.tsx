'use client';

import '../manage.css';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Card,
  EmptyState,
  LoadingBlock,
  PageHead,
  Pager,
  StatusBadge,
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

type Filters = { search: string; status: string; planId: string };

export default function SubscribersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [filters, setFilters] = useState<Filters>({ search: '', status: '', planId: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ plans: PlanOption[] }>('/api/plans')
      .then((res) => setPlans(res.plans ?? []))
      .catch(() => setPlans([]));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.status) params.set('status', filters.status);
      if (filters.planId) params.set('planId', filters.planId);
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

  const options = useMemo(
    () =>
      plans
        .filter((p) => p.status === 'PUBLISHED' || p.status === 'DRAFT')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [plans]
  );

  return (
    <div>
      <PageHead
        title="Subscribers"
        description="Users with a plan — search, filter by status or plan, and open a profile for lifecycle actions."
      />

      {error ? <Alert kind="error">{error}</Alert> : null}

      <Card>
        <form
          className="pm-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ search, status, planId });
          }}
        >
          <input
            data-testid="subscribers-search"
            className="pm-input pm-search"
            placeholder="Search name, email or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
              apply({ search: '', status: '', planId: '' });
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
                  <td colSpan={8} className="pm-table-empty">
                    <LoadingBlock />
                  </td>
                </tr>
              </tbody>
            ) : !data || data.subscribers.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8} className="pm-table-empty">
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
    </div>
  );
}
