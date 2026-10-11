'use client';

// Portal B — Audit log (B5). SUPPORT+ read-only table with filters; ADMIN
// additionally gets CSV export. Content only; chrome comes from the shell.

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  LoadingBlock,
  PageHead,
  Pager,
  can,
  formatDateTime,
} from '@/components/manage/ui';
import { apiFetch, type MeResponse } from '@/lib/portalApi';

type AuditItem = {
  id: string;
  actor_user_id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_ref: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};

type AuditList = {
  total: number;
  page: number;
  pageSize: number;
  items: AuditItem[];
};

type Filters = { action: string; actor: string; targetType: string; from: string; to: string };

const EMPTY_FILTERS: Filters = { action: '', actor: '', targetType: '', from: '', to: '' };

const FILTER_KEYS: (keyof Filters)[] = ['action', 'actor', 'targetType', 'from', 'to'];

const TARGET_TYPES = ['plan', 'subscription', 'order', 'invoice', 'promo_code', 'user'];

function filterParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = f[k].trim();
    if (v) p.set(k, v);
  }
  return p;
}

function fmt(value: Record<string, unknown> | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

function roleTone(role: string): 'accent' | 'ok' | 'neutral' | 'warn' | 'muted' {
  if (role === 'ADMIN') return 'accent';
  if (role === 'MANAGER') return 'ok';
  if (role === 'SUPPORT') return 'warn';
  if (role === 'VIEWER') return 'muted';
  return 'neutral';
}

export default function AuditPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState<Filters & { page: number }>({ ...EMPTY_FILTERS, page: 1 });
  const [data, setData] = useState<AuditList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const isAdmin = can(role, 'ADMIN');

  useEffect(() => {
    apiFetch<MeResponse>('/api/me')
      .then((me) => setRole(me.portalRole))
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    const p = filterParams(query);
    p.set('page', String(query.page));
    p.set('pageSize', '20');
    apiFetch<AuditList>(`/api/audit?${p.toString()}`)
      .then((res) => {
        if (stale) return;
        setData(res);
      })
      .catch((e: unknown) => {
        if (stale) return;
        setError(e instanceof Error ? e.message : String(e));
        setData(null);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [query]);

  const updateFilter = (key: keyof Filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const handleApply = useCallback(() => {
    setQuery({ ...filters, page: 1 });
    setExportError(null);
  }, [filters]);

  const handleReset = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setQuery({ ...EMPTY_FILTERS, page: 1 });
    setExportError(null);
  }, []);

  const goToPage = useCallback((page: number) => {
    setQuery((q) => ({ ...q, page }));
  }, []);

  const toggleRow = useCallback((id: string) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  }, []);

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/audit/export?${filterParams(filters).toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* keep default message */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const filename = match?.[1] ?? `audit-export-${Date.now()}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [exporting, filters]);

  const items = data?.items ?? [];
  const hasFilters = FILTER_KEYS.some((k) => filters[k].trim() !== '');

  return (
    <>
      <PageHead
        title="Audit Log"
        description="Immutable record of administration actions in the portal. Filter by action, actor, target type or date range."
      />

      <Card>
        <div className="pm-toolbar">
          <input
            className="pm-input"
            placeholder="Action (e.g. plans.update)"
            aria-label="Action"
            value={filters.action}
            onChange={(e) => updateFilter('action', e.target.value)}
          />
          <input
            className="pm-input"
            placeholder="Actor name"
            aria-label="Actor"
            value={filters.actor}
            onChange={(e) => updateFilter('actor', e.target.value)}
          />
          <select
            className="pm-select"
            aria-label="Target type"
            value={filters.targetType}
            onChange={(e) => updateFilter('targetType', e.target.value)}
          >
            <option value="">All target types</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            className="pm-input"
            aria-label="From"
            value={filters.from}
            onChange={(e) => updateFilter('from', e.target.value)}
          />
          <input
            type="datetime-local"
            className="pm-input"
            aria-label="To"
            value={filters.to}
            onChange={(e) => updateFilter('to', e.target.value)}
          />
        </div>
        <div className="pm-toolbar">
          <button
            type="button"
            className="pm-btn pm-btn-primary pm-btn-sm"
            data-testid="audit-apply"
            onClick={handleApply}
          >
            Apply
          </button>
          <button
            type="button"
            className="pm-btn pm-btn-ghost pm-btn-sm"
            onClick={handleReset}
          >
            Reset
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="pm-btn pm-btn-outline pm-btn-sm"
              data-testid="audit-export"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          ) : null}
          {hasFilters && data ? (
            <span className="pm-hint" style={{ marginLeft: 'auto' }}>
              {data.total.toLocaleString('en-IN')} result{data.total === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        {exportError ? (
          <div className="pm-card-body">
            <Alert kind="error">{exportError}</Alert>
          </div>
        ) : null}
      </Card>

      {loading ? (
        <Card>
          <LoadingBlock label="Loading audit log…" />
        </Card>
      ) : error ? (
        <Card>
          <div className="pm-card-body">
            <Alert kind="error">{error}</Alert>
          </div>
        </Card>
      ) : !data || items.length === 0 ? (
        <Card>
          <EmptyState
            title="No audit entries"
            hint={
              hasFilters
                ? 'No rows match the current filters. Adjust or reset them and try again.'
                : 'There are no audit entries yet. Mutations made by portal staff will appear here.'
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th aria-label="Details" />
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>IP address</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const expanded = Boolean(open[item.id]);
                  const hasDiff =
                    item.before !== null ||
                    item.after !== null;
                  return (
                    <AuditRowGroup
                      key={item.id}
                      item={item}
                      expanded={expanded}
                      expandable={hasDiff}
                      onToggle={() => toggleRow(item.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager
            page={data.page}
            total={data.total}
            pageSize={data.pageSize}
            onPage={goToPage}
          />
        </Card>
      )}
    </>
  );
}

function AuditRowGroup({
  item,
  expanded,
  expandable,
  onToggle,
}: {
  item: AuditItem;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
}) {
  const targetLabel = item.target_ref ?? item.target_id;
  return (
    <>
      <tr data-testid="audit-row">
        <td>
          {expandable ? (
            <button
              type="button"
              className="pm-text-btn"
              aria-label={expanded ? 'Hide change details' : 'Show change details'}
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="pm-hint">·</span>
          )}
        </td>
        <td className="pm-cell-sub" style={{ whiteSpace: 'nowrap' }}>
          {formatDateTime(item.created_at)}
        </td>
        <td>
          <div className="pm-cell-main">{item.actor_name}</div>
          <Badge tone={roleTone(item.actor_role)}>{item.actor_role}</Badge>
        </td>
        <td>
          <span className="pm-cell-num">{item.action}</span>
        </td>
        <td>
          <div className="pm-cell-main">{item.target_type || '—'}</div>
          {targetLabel ? (
            <div className="pm-cell-sub" style={{ fontFamily: 'var(--font-mono)' }}>
              {targetLabel}
            </div>
          ) : null}
        </td>
        <td className="pm-cell-sub">{item.ip_address || '—'}</td>
      </tr>
      {expanded && expandable ? (
        <tr>
          <td colSpan={6} style={{ background: 'var(--bg-hover)' }}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 'min(340px, 60vw)' }}>
                <div className="pm-label">Before</div>
                <pre
                  className="pm-cell-num"
                  style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {fmt(item.before)}
                </pre>
              </div>
              <div style={{ minWidth: 'min(340px, 60vw)' }}>
                <div className="pm-label">After</div>
                <pre
                  className="pm-cell-num"
                  style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {fmt(item.after)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
