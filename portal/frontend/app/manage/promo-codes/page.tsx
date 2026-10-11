'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  LoadingBlock,
  PageHead,
  can,
  formatDate,
  formatMoney,
} from '@/components/manage/ui';
import { apiFetch } from '@/lib/portalApi';
import type { MeResponse } from '@/lib/portalApi';

type DiscountType = 'PERCENT' | 'FIXED';

type PromoRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: string;
  currency: string;
  plan_id: string | null;
  max_uses: number | null;
  used_count: number;
  active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type PlanLite = { id: string; key: string; name: string; currency: string };

type PromoCodesResponse = { promoCodes: PromoRow[] };
type PlansResponse = { plans: PlanLite[] };

type PromoStatus = 'active' | 'inactive' | 'expired';
type StatusFilter = 'all' | PromoStatus;

const CODE_RE = /^[A-Z0-9_-]{2,32}$/;
const CURRENCIES = ['INR', 'USD', 'EUR'];
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'expired', label: 'Expired' },
];

type PromoForm = {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: string;
  currency: string;
  planId: string;
  maxUses: string;
  active: boolean;
  startsAt: string;
  expiresAt: string;
};

const DEFAULT_FORM: PromoForm = {
  code: '',
  description: '',
  discountType: 'PERCENT',
  discountValue: '',
  currency: 'INR',
  planId: '',
  maxUses: '',
  active: true,
  startsAt: '',
  expiresAt: '',
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

function promoStatus(row: PromoRow): PromoStatus {
  if (row.expires_at) {
    const t = new Date(row.expires_at).getTime();
    if (Number.isFinite(t) && t <= Date.now()) return 'expired';
  }
  return row.active ? 'active' : 'inactive';
}

function StatusBadge({ row }: { row: PromoRow }) {
  const status = promoStatus(row);
  if (status === 'expired') return <Badge tone="neutral">Expired</Badge>;
  if (status === 'active') return <Badge tone="accent">Active</Badge>;
  return <Badge tone="muted">Inactive</Badge>;
}

function discountLabel(row: PromoRow): string {
  const n = Number(row.discount_value);
  const clean = Number.isFinite(n) ? String(Number(n.toFixed(2))) : row.discount_value;
  return row.discount_type === 'PERCENT' ? `${clean}%` : formatMoney(row.discount_value, row.currency);
}

function windowLabel(row: PromoRow): string {
  const a = row.starts_at ? formatDate(row.starts_at) : null;
  const b = row.expires_at ? formatDate(row.expires_at) : null;
  if (!a && !b) return '—';
  return [a, b].filter(Boolean).join(' → ');
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function validateForm(f: PromoForm): string | null {
  const code = f.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    return 'Code must be 2-32 characters using letters, digits, _ or - (stored uppercase)';
  }
  const rawValue = f.discountValue.trim();
  if (rawValue === '') return 'Discount value is required';
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return 'Discount value must be a number';
  if (f.discountType === 'PERCENT') {
    if (value <= 0 || value > 100) return 'Percent discount must be greater than 0 and at most 100';
  } else if (value < 0) {
    return 'Fixed discount must be a non-negative amount';
  }
  if (f.maxUses.trim() !== '') {
    const maxUses = Number(f.maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1) return 'Max uses must be a positive integer';
  }
  return null;
}

function buildPayload(f: PromoForm) {
  return {
    code: f.code.trim().toUpperCase(),
    description: f.description.trim() || null,
    discountType: f.discountType,
    discountValue: Number(f.discountValue),
    currency: f.currency,
    planId: f.planId === '' ? null : f.planId,
    maxUses: f.maxUses.trim() === '' ? null : Number(f.maxUses),
    active: f.active,
    startsAt: f.startsAt === '' ? null : new Date(f.startsAt).toISOString(),
    expiresAt: f.expiresAt === '' ? null : new Date(f.expiresAt).toISOString(),
  };
}

export default function PromoCodesPage() {
  const [meLoading, setMeLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [codes, setCodes] = useState<PromoRow[] | null>(null);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PromoRow | null>(null);
  const [form, setForm] = useState<PromoForm>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canRead = can(role, 'VIEWER');
  const canManage = can(role, 'MANAGER');
  const canAdmin = can(role, 'ADMIN');

  const loadData = useCallback(async () => {
    const [pc, pl] = await Promise.all([
      apiFetch<PromoCodesResponse>('/api/promo-codes'),
      apiFetch<PlansResponse>('/api/plans'),
    ]);
    setCodes(pc.promoCodes ?? []);
    setPlans(pl.plans ?? []);
    setPageError(null);
  }, []);

  const init = useCallback(async () => {
    setMeLoading(true);
    setPageError(null);
    try {
      const me = await apiFetch<MeResponse>('/api/me');
      setRole(me.portalRole);
      if (can(me.portalRole, 'VIEWER')) {
        await loadData();
      }
    } catch (err) {
      setPageError(errMsg(err));
    } finally {
      setMeLoading(false);
    }
  }, [loadData]);

  useEffect(() => {
    void init();
  }, [init]);

  function openCreate() {
    setEditing(null);
    setForm({ ...DEFAULT_FORM });
    setFormError(null);
    setEditorOpen(true);
  }

  function openEdit(row: PromoRow) {
    setEditing(row);
    setForm({
      code: row.code,
      description: row.description ?? '',
      discountType: row.discount_type,
      discountValue: String(Number(row.discount_value)),
      currency: row.currency || 'INR',
      planId: row.plan_id ?? '',
      maxUses: row.max_uses === null || row.max_uses === undefined ? '' : String(row.max_uses),
      active: row.active,
      startsAt: toLocalInput(row.starts_at),
      expiresAt: toLocalInput(row.expires_at),
    });
    setFormError(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
  }

  function setField(field: keyof PromoForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = buildPayload(form);
      if (editing) {
        await apiFetch(`/api/promo-codes/${editing.id}`, { method: 'PUT', body: payload });
      } else {
        await apiFetch('/api/promo-codes', { method: 'POST', body: payload });
      }
      closeEditor();
      await loadData();
    } catch (err) {
      setFormError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(row: PromoRow) {
    const confirmed = window.confirm(`Delete promo code "${row.code}"? This cannot be undone.`);
    if (!confirmed) return;
    setActionError(null);
    try {
      await apiFetch(`/api/promo-codes/${row.id}`, { method: 'DELETE' });
      await loadData();
    } catch (err) {
      setActionError(errMsg(err));
    }
  }

  const query = search.trim().toLowerCase();
  const visible = (codes ?? []).filter((row) => {
    if (statusFilter !== 'all' && promoStatus(row) !== statusFilter) return false;
    if (query) {
      const haystack = `${row.code} ${row.description ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const planName = useCallback(
    (planId: string | null): string => {
      if (!planId) return 'Any';
      const match = plans.find((p) => p.id === planId);
      return match ? match.name : '—';
    },
    [plans]
  );

  const planOptions = plans.length > 0 ? plans : [];

  let body: ReactNode;
  if (meLoading) {
    body = <LoadingBlock label="Loading…" />;
  } else if (pageError) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <Alert kind="error">{pageError}</Alert>
        <button type="button" className="pm-btn pm-btn-primary" onClick={() => void init()}>
          Retry
        </button>
      </div>
    );
  } else if (!role || !canRead) {
    body = <Alert kind="info">This account does not have Portal B access.</Alert>;
  } else if (codes === null) {
    body = <LoadingBlock label="Loading promo codes…" />;
  } else if (codes.length === 0) {
    body = (
      <EmptyState
        title="No promo codes yet"
        hint="Create discount codes to apply at checkout — percentage or fixed amounts, optionally restricted to one plan."
        action={
          canManage ? (
            <button
              type="button"
              data-testid="promo-create"
              className="pm-btn pm-btn-primary"
              onClick={openCreate}
            >
              New code
            </button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <Card title="Promo codes" actions={<span className="pm-hint">{codes.length} codes</span>}>
        <div className="pm-toolbar">
          <input
            className="pm-input pm-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code or description…"
            aria-label="Search promo codes"
          />
          <select
            className="pm-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Discount</th>
                <th>Plan</th>
                <th>Usage</th>
                <th>Status</th>
                <th>Window</th>
                <th>Created</th>
                {canManage ? <th className="pm-table-actions">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="pm-table-empty" colSpan={canManage ? 9 : 8}>
                    No promo codes match your filters.
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.id} data-testid="promo-row">
                    <td>
                      <span
                        data-testid="promo-code"
                        className="pm-cell-main"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                      >
                        {row.code}
                      </span>
                    </td>
                    <td>
                      {row.description ? (
                        <span className="pm-cell-sub">{row.description}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{discountLabel(row)}</td>
                    <td>{planName(row.plan_id)}</td>
                    <td>
                      {row.used_count} / {row.max_uses === null ? '∞' : row.max_uses}
                    </td>
                    <td>
                      <StatusBadge row={row} />
                    </td>
                    <td>
                      <span className="pm-cell-sub">{windowLabel(row)}</span>
                    </td>
                    <td>{formatDate(row.created_at)}</td>
                    {canManage ? (
                      <td>
                        <div className="pm-table-actions">
                          <button
                            type="button"
                            data-testid="promo-edit"
                            className="pm-btn pm-btn-sm pm-btn-ghost"
                            onClick={() => openEdit(row)}
                          >
                            Edit
                          </button>
                          {canAdmin ? (
                            <button
                              type="button"
                              data-testid="promo-delete"
                              className="pm-btn pm-btn-sm pm-btn-danger"
                              disabled={row.used_count > 0}
                              title={
                                row.used_count > 0
                                  ? 'This code has been used and cannot be deleted'
                                  : 'Delete this code'
                              }
                              onClick={() => onDelete(row)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  return (
    <div data-testid="promo-codes-page">
      <PageHead
        title="Promo Codes"
        description="Discount codes customers can apply at checkout — percentage or fixed amounts, optionally restricted to a single plan."
        actions={
          canManage && !meLoading ? (
            <button type="button" data-testid="promo-create" className="pm-btn pm-btn-primary" onClick={openCreate}>
              New code
            </button>
          ) : undefined
        }
      />

      {actionError ? (
        <div style={{ marginBottom: 18 }}>
          <Alert kind="error">{actionError}</Alert>
        </div>
      ) : null}

      {body}

      {editorOpen && canManage ? (
        <div
          className="pm-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditor();
          }}
        >
          <div
            className="pm-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? `Edit code ${editing.code}` : 'New promo code'}
          >
            <div className="pm-modal-head">
              <div className="pm-modal-title">
                {editing ? `Edit ${editing.code}` : 'New promo code'}
              </div>
              <button type="button" className="pm-modal-close" aria-label="Close" onClick={closeEditor}>
                ×
              </button>
            </div>
            <form onSubmit={onSubmit} noValidate>
              <div className="pm-modal-body">
                {formError ? (
                  <div style={{ marginBottom: 16 }}>
                    <Alert kind="error">{formError}</Alert>
                  </div>
                ) : null}
                <div className="pm-form-grid">
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-code">
                      Code <span className="pm-req">*</span>
                    </label>
                    <input
                      id="pc-code"
                      className="pm-input"
                      value={form.code}
                      onChange={(e) => setField('code', e.target.value)}
                      placeholder="LAUNCH20"
                      autoComplete="off"
                      spellCheck={false}
                      style={{ textTransform: 'uppercase' }}
                    />
                    <span className="pm-hint">Stored uppercase; 2-32 chars of A-Z, 0-9, _ or -.</span>
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-discountType">
                      Discount type <span className="pm-req">*</span>
                    </label>
                    <select
                      id="pc-discountType"
                      className="pm-select"
                      value={form.discountType}
                      onChange={(e) => setField('discountType', e.target.value)}
                    >
                      <option value="PERCENT">Percent (%)</option>
                      <option value="FIXED">Fixed amount</option>
                    </select>
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-discountValue">
                      Discount value <span className="pm-req">*</span>
                    </label>
                    <input
                      id="pc-discountValue"
                      className="pm-input"
                      type="number"
                      min={form.discountType === 'PERCENT' ? 0.01 : 0}
                      max={form.discountType === 'PERCENT' ? 100 : undefined}
                      step="0.01"
                      value={form.discountValue}
                      onChange={(e) => setField('discountValue', e.target.value)}
                      placeholder={form.discountType === 'PERCENT' ? '20' : '100'}
                    />
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-currency">
                      Currency
                    </label>
                    <select
                      id="pc-currency"
                      className="pm-select"
                      value={form.currency}
                      onChange={(e) => setField('currency', e.target.value)}
                      disabled={form.discountType === 'PERCENT'}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-plan">
                      Plan
                    </label>
                    <select
                      id="pc-plan"
                      className="pm-select"
                      value={form.planId}
                      onChange={(e) => setField('planId', e.target.value)}
                    >
                      <option value="">Any plan</option>
                      {planOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.key})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-maxUses">
                      Max uses
                    </label>
                    <input
                      id="pc-maxUses"
                      className="pm-input"
                      type="number"
                      min={1}
                      step={1}
                      value={form.maxUses}
                      onChange={(e) => setField('maxUses', e.target.value)}
                      placeholder="Unlimited"
                    />
                  </div>
                  <div className="pm-field pm-field-full">
                    <label className="pm-label" htmlFor="pc-description">
                      Description
                    </label>
                    <textarea
                      id="pc-description"
                      className="pm-textarea"
                      value={form.description}
                      onChange={(e) => setField('description', e.target.value)}
                      placeholder="What is this code for?"
                    />
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-startsAt">
                      Starts at
                    </label>
                    <input
                      id="pc-startsAt"
                      className="pm-input"
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) => setField('startsAt', e.target.value)}
                    />
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="pc-expiresAt">
                      Expires at
                    </label>
                    <input
                      id="pc-expiresAt"
                      className="pm-input"
                      type="datetime-local"
                      value={form.expiresAt}
                      onChange={(e) => setField('expiresAt', e.target.value)}
                    />
                  </div>
                  <div className="pm-field pm-field-full">
                    <label className="pm-check" htmlFor="pc-active">
                      <input
                        id="pc-active"
                        type="checkbox"
                        checked={form.active}
                        onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                      />
                      Code is active
                    </label>
                  </div>
                </div>
              </div>
              <div className="pm-modal-foot">
                <button type="button" className="pm-btn pm-btn-ghost" onClick={closeEditor} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="pm-btn pm-btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
