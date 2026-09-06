'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/portalApi';
import {
  Alert,
  Card,
  EmptyState,
  LoadingBlock,
  PageHead,
  StatCard,
  StatusBadge,
  formatDate,
  formatMoney,
  formatNumber,
  titleCase,
} from '@/components/manage/ui';

type PlanStat = {
  key: string;
  name: string;
  active: number;
  trialing: number;
  status: string;
};

type SummaryResponse = {
  scope: string;
  role: string;
  summary: {
    totalSubscriptions: number;
    active: number;
    trialing: number;
    pastDue: number;
    suspended: number;
    cancelled: number;
    trialsEndingSoon: number;
    expiringSoon: number;
    newThisMonth: number;
    churnThisMonth: number;
    mrr: string;
    revenue30d: string;
    totalOrders: number;
    paidOrders: number;
    freeSeats: number;
    plans: PlanStat[];
  };
};

type UserRef = { id: string; name: string; email: string };

type RecentSub = {
  id: string;
  user: UserRef;
  plan_key: string;
  plan_name: string;
  status: string;
  billing_cycle: string;
  created_at: string;
};

type RecentOrder = {
  id: string;
  user: UserRef;
  plan_key: string;
  plan_name: string;
  amount: string;
  currency: string;
  status: string;
  created_at: string;
};

type DashboardData = {
  summary: SummaryResponse['summary'];
  recentSubs: RecentSub[];
  recentOrders: RecentOrder[];
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, subsRes, ordersRes] = await Promise.all([
        apiFetch<SummaryResponse>('/api/dashboard/summary'),
        apiFetch<{ items: RecentSub[] }>('/api/dashboard/recent-subscriptions?limit=8'),
        apiFetch<{ items: RecentOrder[] }>('/api/dashboard/recent-orders?limit=8'),
      ]);
      setData({
        summary: summaryRes.summary,
        recentSubs: subsRes.items ?? [],
        recentOrders: ordersRes.items ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <>
        <PageHead title="Dashboard" description="Subscription, revenue and churn at a glance." />
        <LoadingBlock label="Loading dashboard…" />
      </>
    );
  }

  if (error && !data) {
    return (
      <>
        <PageHead title="Dashboard" description="Subscription, revenue and churn at a glance." />
        <Alert kind="error">{error}</Alert>
        <div className="pm-page-actions" style={{ marginTop: 14 }}>
          <button type="button" className="pm-btn pm-btn-primary" onClick={load}>
            Retry
          </button>
        </div>
      </>
    );
  }

  const s = data?.summary;

  return (
    <>
      <PageHead title="Dashboard" description="Subscription, revenue and churn at a glance." />

      <div data-testid="dashboard-kpi">
        <div className="pm-stat-grid">
          <StatCard label="Total subscriptions" value={formatNumber(s?.totalSubscriptions)} sub={`${formatNumber(s?.freeSeats)} free seats`} />
          <StatCard label="Active" value={formatNumber(s?.active)} tone="ok" />
          <StatCard label="Trialing" value={formatNumber(s?.trialing)} tone="warn" />
          <StatCard label="Past due" value={formatNumber(s?.pastDue)} tone="danger" />
          <StatCard label="Suspended" value={formatNumber(s?.suspended)} />
          <StatCard label="Cancelled" value={formatNumber(s?.cancelled)} tone="danger" />
        </div>
        <div className="pm-stat-grid">
          <StatCard label="MRR" value={formatMoney(s?.mrr)} tone="accent" sub="Monthly recurring revenue" />
          <StatCard label="Revenue 30d" value={formatMoney(s?.revenue30d)} tone="accent" sub="Paid orders, last 30 days" />
          <StatCard label="Trials ending ≤7d" value={formatNumber(s?.trialsEndingSoon)} tone="warn" />
          <StatCard label="Expiring ≤14d" value={formatNumber(s?.expiringSoon)} />
          <StatCard label="New this month" value={formatNumber(s?.newThisMonth)} />
          <StatCard label="Churn this month" value={formatNumber(s?.churnThisMonth)} tone="danger" />
          <StatCard label="Paid orders" value={formatNumber(s?.paidOrders)} tone="ok" sub={`of ${formatNumber(s?.totalOrders)} total orders`} />
        </div>
      </div>

      {error ? (
        <div style={{ marginBottom: 18 }}>
          <Alert kind="error">
            {error}{' '}
            <button type="button" className="pm-text-btn" onClick={load}>
              Retry
            </button>
          </Alert>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18, alignItems: 'start' }}>
        <Card title="Recent subscriptions">
          {data && data.recentSubs.length > 0 ? (
            <div className="pm-table-wrap">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Billing</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSubs.map((sub) => (
                    <tr key={sub.id} data-testid="recent-sub-row">
                      <td>
                        <Link className="pm-link pm-cell-main" href={`/manage/subscribers/${sub.user.id}`}>
                          {sub.user.name || '—'}
                        </Link>
                        <div className="pm-cell-sub">{sub.user.email}</div>
                      </td>
                      <td>
                        <div className="pm-cell-main">{sub.plan_name}</div>
                        <div className="pm-cell-sub">{sub.plan_key}</div>
                      </td>
                      <td>
                        <StatusBadge status={sub.status} />
                      </td>
                      <td>{titleCase(sub.billing_cycle)}</td>
                      <td>{formatDate(sub.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No recent subscriptions" hint="Subscriptions created will appear here." />
          )}
        </Card>

        <Card title="Recent orders">
          {data && data.recentOrders.length > 0 ? (
            <div className="pm-table-wrap">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Plan</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.map((order) => (
                    <tr key={order.id} data-testid="recent-order-row">
                      <td>
                        <Link className="pm-link pm-cell-main" href={`/manage/subscribers/${order.user.id}`}>
                          {order.user.name || '—'}
                        </Link>
                        <div className="pm-cell-sub">{order.user.email}</div>
                      </td>
                      <td>
                        <div className="pm-cell-main">{order.plan_name}</div>
                        <div className="pm-cell-sub">{order.plan_key}</div>
                      </td>
                      <td className="pm-cell-num">{formatMoney(order.amount, order.currency)}</td>
                      <td>
                        <StatusBadge status={order.status} />
                      </td>
                      <td>{formatDate(order.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No recent orders" hint="Paid orders will appear here." />
          )}
        </Card>
      </div>
    </>
  );
}
