'use client';

// Shared Portal B (management) UI primitives + formatters. Coordinator-owned
// file — page owners import these; do not edit.

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/* ------------------------------------------------------------------ types */

export type PortalRole = 'ADMIN' | 'MANAGER' | 'SUPPORT' | 'VIEWER';

export type SubStatus =
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'NONE';

export const ROLE_RANK: Record<PortalRole, number> = {
  ADMIN: 4,
  MANAGER: 3,
  SUPPORT: 2,
  VIEWER: 1,
};

export const PORTAL_ROLES: PortalRole[] = ['ADMIN', 'MANAGER', 'SUPPORT', 'VIEWER'];

/** Role-aware gate: does `role` sit at or above `min` in the portal hierarchy? */
export function can(role: string | null | undefined, min: PortalRole): boolean {
  if (!role) return false;
  const r = role as PortalRole;
  return r in ROLE_RANK && ROLE_RANK[r] >= ROLE_RANK[min];
}

/* ------------------------------------------------------------------ utils */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const moneyFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const moneyFmtDec = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format money with Indian digit grouping. Handles numeric strings/rows. */
export function formatMoney(
  value: string | number | null | undefined,
  currency = 'INR'
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  if (currency && currency !== 'INR') return `${currency} ${n.toLocaleString('en-IN')}`;
  return Number.isInteger(n) ? moneyFmt.format(n) : moneyFmtDec.format(n);
}

/** Compact number with Indian grouping (for stat counts). */
export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : '—';
}

const dateShort = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateShort.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTime.format(d);
}

const SUB_TONES: Record<SubStatus, 'ok' | 'warn' | 'danger' | 'neutral' | 'muted'> = {
  ACTIVE: 'ok',
  TRIALING: 'warn',
  PAST_DUE: 'danger',
  SUSPENDED: 'muted',
  CANCELLED: 'danger',
  EXPIRED: 'muted',
  NONE: 'muted',
};

export function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'muted' {
  const s = (status ?? '').toUpperCase() as SubStatus;
  return SUB_TONES[s] ?? 'neutral';
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value)
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/* ------------------------------------------------------------------ atoms */

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'ok' | 'warn' | 'danger' | 'neutral' | 'muted' | 'accent';
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('pm-badge', `pm-badge-${tone}`, className)}>{children}</span>;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {titleCase(status)}
    </Badge>
  );
}

export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="pm-page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p className="pm-page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="pm-page-actions">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'accent';
  className?: string;
}) {
  return (
    <div className={cn('pm-stat', `pm-stat-${tone}`, className)}>
      <div className="pm-stat-label">{label}</div>
      <div className="pm-stat-value">{value}</div>
      {sub ? <div className="pm-stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  pad = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={cn('pm-card', className)}>
      {title || actions ? (
        <header className="pm-card-head">
          <div className="pm-card-title">{title}</div>
          {actions ? <div className="pm-card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={pad ? 'pm-card-body' : undefined}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="pm-empty">
      <div className="pm-empty-title">{title}</div>
      {hint ? <div className="pm-empty-hint">{hint}</div> : null}
      {action ? <div className="pm-empty-action">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="pm-loading" role="status">
      <span className="pm-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'ok';
  children: ReactNode;
}) {
  return <div className={cn('pm-alert', `pm-alert-${kind}`)}>{children}</div>;
}

export function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const range: number[] = [];
  const lo = Math.max(1, page - 2);
  const hi = Math.min(pages, page + 2);
  for (let i = lo; i <= hi; i += 1) range.push(i);
  return (
    <nav className="pm-pager" aria-label="Pagination">
      <button
        className="pm-btn pm-btn-sm pm-btn-ghost"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ‹ Prev
      </button>
      {range[0] > 1 ? <span className="pm-pager-ellipsis">…</span> : null}
      {range.map((p) => (
        <button
          key={p}
          className={cn('pm-btn pm-btn-sm', p === page ? 'pm-btn-primary' : 'pm-btn-ghost')}
          aria-current={p === page ? 'page' : undefined}
          onClick={() => onPage(p)}
        >
          {p}
        </button>
      ))}
      {range[range.length - 1] < pages ? <span className="pm-pager-ellipsis">…</span> : null}
      <button
        className="pm-btn pm-btn-sm pm-btn-ghost"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next ›
      </button>
      <span className="pm-pager-total">of {formatNumber(pages)} pages</span>
    </nav>
  );
}

/** Reusable “go back” link that calls router.back(). */
export function BackLink({ to, label = 'Back' }: { to: string; label?: string }) {
  const router = useRouter();
  return (
    <a
      href={to}
      className="pm-link"
      onClick={(e) => {
        e.preventDefault();
        router.push(to);
      }}
    >
      ← {label}
    </a>
  );
}

/** Format a status enum into a stable uppercase token (for select options). */
export function enumKey(value: string): string {
  return value.replace(/\s+/g, '_').toUpperCase();
}
