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
  StatusBadge,
  can,
  formatDate,
  formatMoney,
} from '@/components/manage/ui';
import { apiFetch } from '@/lib/portalApi';
import type { MeResponse } from '@/lib/portalApi';

type PlanStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

type PlanRow = {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  description: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  currency: string;
  billing_cycles: string[];
  trial_days: number;
  sort_order: number;
  status: PlanStatus;
  limits: Record<string, unknown>;
  features: unknown[];
  created_at: string;
  updated_at: string;
};

type PlansResponse = { plans: PlanRow[] };

const STATUSES: PlanStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const CYCLES = ['MONTHLY', 'YEARLY', 'CUSTOM'] as const;
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type PlanForm = {
  key: string;
  name: string;
  tagline: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  currency: string;
  billingCycles: string[];
  trialDays: string;
  sortOrder: string;
  status: PlanStatus;
};

const DEFAULT_FORM: PlanForm = {
  key: '',
  name: '',
  tagline: '',
  description: '',
  priceMonthly: '',
  priceYearly: '',
  currency: 'INR',
  billingCycles: ['MONTHLY', 'YEARLY'],
  trialDays: '0',
  sortOrder: '0',
  status: 'DRAFT',
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

function moneyToNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  return Number(t);
}

function validateForm(f: PlanForm): string | null {
  if (!KEY_RE.test(f.key.trim())) {
    return 'Key must be a lowercase slug (letters, digits and hyphens, e.g. my-plan)';
  }
  if (!f.name.trim()) return 'Name is required';
  for (const [label, raw] of [
    ['Monthly price', f.priceMonthly],
    ['Yearly price', f.priceYearly],
  ] as const) {
    const t = raw.trim();
    if (t !== '') {
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) return `${label} must be a non-negative number`;
    }
  }
  if (f.trialDays.trim() === '' || !Number.isInteger(Number(f.trialDays)) || Number(f.trialDays) < 0) {
    return 'First-recharge bonus days must be a non-negative integer';
  }
  if (!Number.isInteger(Number(f.sortOrder))) return 'Sort order must be an integer';
  if (f.billingCycles.length === 0) return 'Select at least one billing cycle';
  if (!STATUSES.includes(f.status)) return 'Invalid status';
  return null;
}

function buildPayload(f: PlanForm) {
  return {
    key: f.key.trim(),
    name: f.name.trim(),
    tagline: f.tagline.trim() || null,
    description: f.description.trim() || null,
    priceMonthly: moneyToNumber(f.priceMonthly),
    priceYearly: moneyToNumber(f.priceYearly),
    currency: f.currency,
    billingCycles: f.billingCycles,
    trialDays: Number(f.trialDays),
    sortOrder: Number(f.sortOrder),
    status: f.status,
  };
}

function priceLabel(value: string | null, cycles: string[], currency: string): string {
  if (value === null || value === undefined || value === '') {
    return cycles.includes('CUSTOM') ? 'Custom' : '—';
  }
  return formatMoney(value, currency);
}

export default function PlansPage() {
  const [meLoading, setMeLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [form, setForm] = useState<PlanForm>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canRead = can(role, 'VIEWER');
  const canManage = can(role, 'MANAGER');
  const canAdmin = can(role, 'ADMIN');

  const refreshPlans = useCallback(async () => {
    try {
      const data = await apiFetch<PlansResponse>('/api/plans');
      setPlans(data.plans ?? []);
      setPageError(null);
    } catch (err) {
      setPageError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<MeResponse>('/api/me');
        if (cancelled) return;
        setRole(me.portalRole);
        if (can(me.portalRole, 'VIEWER')) {
          await refreshPlans();
        }
      } catch (err) {
        if (!cancelled) setPageError(errMsg(err));
      } finally {
        if (!cancelled) setMeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshPlans]);

  function openCreate() {
    setEditing(null);
    setForm({ ...DEFAULT_FORM });
    setFormError(null);
    setEditorOpen(true);
  }

  function openEdit(plan: PlanRow) {
    setEditing(plan);
    setForm({
      key: plan.key,
      name: plan.name ?? '',
      tagline: plan.tagline ?? '',
      description: plan.description ?? '',
      priceMonthly: plan.price_monthly === null || plan.price_monthly === undefined ? '' : String(plan.price_monthly),
      priceYearly: plan.price_yearly === null || plan.price_yearly === undefined ? '' : String(plan.price_yearly),
      currency: plan.currency ?? 'INR',
      billingCycles: plan.billing_cycles?.length ? plan.billing_cycles : ['MONTHLY', 'YEARLY'],
      trialDays: String(plan.trial_days ?? 0),
      sortOrder: String(plan.sort_order ?? 0),
      status: plan.status,
    });
    setFormError(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
  }

  function setField(field: keyof PlanForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleCycle(cycle: string) {
    setForm((f) => ({
      ...f,
      billingCycles: f.billingCycles.includes(cycle)
        ? f.billingCycles.filter((c) => c !== cycle)
        : [...f.billingCycles, cycle],
    }));
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
        await apiFetch(`/api/plans/${editing.id}`, { method: 'PUT', body: payload });
      } else {
        await apiFetch('/api/plans', { method: 'POST', body: payload });
      }
      closeEditor();
      await refreshPlans();
    } catch (err) {
      setFormError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSetStatus(plan: PlanRow, status: PlanStatus) {
    setActionError(null);
    try {
      await apiFetch(`/api/plans/${plan.id}`, { method: 'PUT', body: { status } });
      await refreshPlans();
    } catch (err) {
      setActionError(errMsg(err));
    }
  }

  async function onDelete(plan: PlanRow) {
    const confirmed = window.confirm(
      `Delete plan "${plan.name}" (${plan.key})? This cannot be undone.`
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      await apiFetch(`/api/plans/${plan.id}`, { method: 'DELETE' });
      await refreshPlans();
    } catch (err) {
      setActionError(errMsg(err));
    }
  }

  let body: ReactNode;
  if (meLoading) {
    body = <LoadingBlock label="Loading…" />;
  } else if (!role || !canRead) {
    body = pageError ? (
      <Alert kind="error">{pageError}</Alert>
    ) : (
      <Alert kind="info">This account does not have Portal B access.</Alert>
    );
  } else if (plans === null) {
    body = <LoadingBlock label="Loading plans…" />;
  } else if (plans.length === 0) {
    body = (
      <EmptyState
        title="No plans yet"
        hint="Create your first plan to start selling subscriptions."
        action={
          canManage ? (
            <button type="button" data-testid="plan-create" className="pm-btn pm-btn-primary" onClick={openCreate}>
              New plan
            </button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <Card title="Plan catalog" actions={<span className="pm-hint">{plans.length} plans</span>}>
        <div className="pm-table-wrap">
          <table className="pm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Status</th>
                <th>Monthly</th>
                <th>Yearly</th>
                <th>Billing cycles</th>
                <th>First-recharge bonus</th>
                <th>Order</th>
                <th>Created</th>
                {canManage ? <th className="pm-table-actions">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} data-testid="plan-row">
                  <td>
                    <div className="pm-cell-main">{plan.name}</div>
                    {plan.tagline ? <div className="pm-cell-sub">{plan.tagline}</div> : null}
                  </td>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{plan.key}</span>
                  </td>
                  <td>
                    <StatusBadge status={plan.status} />
                  </td>
                  <td>{priceLabel(plan.price_monthly, plan.billing_cycles, plan.currency)}</td>
                  <td>{priceLabel(plan.price_yearly, plan.billing_cycles, plan.currency)}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      {plan.billing_cycles?.map((cycle) => (
                        <Badge key={cycle} tone="neutral">
                          {cycle}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td>{plan.trial_days > 0 ? `+${plan.trial_days} days validity` : '—'}</td>
                  <td>{plan.sort_order}</td>
                  <td>{formatDate(plan.created_at)}</td>
                  {canManage ? (
                    <td>
                      <div className="pm-table-actions">
                        <button
                          type="button"
                          data-testid="plan-edit"
                          className="pm-btn pm-btn-sm pm-btn-ghost"
                          onClick={() => openEdit(plan)}
                        >
                          Edit
                        </button>
                        {plan.status === 'DRAFT' ? (
                          <button
                            type="button"
                            data-testid="plan-status"
                            className="pm-btn pm-btn-sm pm-btn-ghost"
                            onClick={() => onSetStatus(plan, 'PUBLISHED')}
                          >
                            Publish
                          </button>
                        ) : null}
                        {plan.status === 'PUBLISHED' ? (
                          <button
                            type="button"
                            data-testid="plan-status"
                            className="pm-btn pm-btn-sm pm-btn-ghost"
                            onClick={() => onSetStatus(plan, 'ARCHIVED')}
                          >
                            Archive
                          </button>
                        ) : null}
                        {canAdmin ? (
                          <button
                            type="button"
                            data-testid="plan-delete"
                            className="pm-btn pm-btn-sm pm-btn-danger"
                            onClick={() => onDelete(plan)}
                          >
                            Delete
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
      </Card>
    );
  }

  return (
    <div data-testid="plans-page">
      <PageHead
        title="Plans"
        description="Manage the plan catalog customers see at checkout — pricing, billing cycles, first-recharge bonus days and publishing state."
        actions={
          canManage && !meLoading ? (
            <button type="button" data-testid="plan-create" className="pm-btn pm-btn-primary" onClick={openCreate}>
              New plan
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
          <div className="pm-modal" role="dialog" aria-modal="true" aria-label={editing ? 'Edit plan' : 'New plan'}>
            <div className="pm-modal-head">
              <div className="pm-modal-title">{editing ? `Edit ${editing.name}` : 'New plan'}</div>
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
                  <div className="pm-field pm-field-full">
                    <label className="pm-label" htmlFor="plan-key">
                      Key <span className="pm-req">*</span>
                    </label>
                    <input
                      id="plan-key"
                      className="pm-input"
                      value={form.key}
                      onChange={(e) => setField('key', e.target.value)}
                      placeholder="my-plan"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="pm-hint">Lowercase slug used in URLs (letters, digits, hyphens).</span>
                  </div>
                  <div className="pm-field pm-field-full">
                    <label className="pm-label" htmlFor="plan-name">
                      Name <span className="pm-req">*</span>
                    </label>
                    <input
                      id="plan-name"
                      className="pm-input"
                      value={form.name}
                      onChange={(e) => setField('name', e.target.value)}
                      placeholder="Pro"
                    />
                  </div>
                  <div className="pm-field pm-field-full">
                    <label className="pm-label" htmlFor="plan-tagline">
                      Tagline
                    </label>
                    <input
                      id="plan-tagline"
                      className="pm-input"
                      value={form.tagline}
                      onChange={(e) => setField('tagline', e.target.value)}
                      placeholder="For teams that live in their API workflow"
                    />
                  </div>
                  <div className="pm-field pm-field-full">
                    <label className="pm-label" htmlFor="plan-description">
                      Description
                    </label>
                    <textarea
                      id="plan-description"
                      className="pm-textarea"
                      value={form.description}
                      onChange={(e) => setField('description', e.target.value)}
                      placeholder="What is included in this plan?"
                    />
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="plan-priceMonthly">
                      Monthly price
                    </label>
                    <input
                      id="plan-priceMonthly"
                      className="pm-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.priceMonthly}
                      onChange={(e) => setField('priceMonthly', e.target.value)}
                      placeholder="299"
                    />
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="plan-priceYearly">
                      Yearly price
                    </label>
                    <input
                      id="plan-priceYearly"
                      className="pm-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.priceYearly}
                      onChange={(e) => setField('priceYearly', e.target.value)}
                      placeholder="2990"
                    />
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="plan-currency">
                      Currency
                    </label>
                    <select
                      id="plan-currency"
                      className="pm-select"
                      value={form.currency}
                      onChange={(e) => setField('currency', e.target.value)}
                    >
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <div className="pm-field pm-field-full">
                    <span className="pm-label">Billing cycles</span>
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', paddingTop: 2 }}>
                      {CYCLES.map((cycle) => (
                        <label className="pm-check" key={cycle}>
                          <input
                            type="checkbox"
                            checked={form.billingCycles.includes(cycle)}
                            onChange={() => toggleCycle(cycle)}
                          />
                          {cycle}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="plan-trialDays">
                      First-recharge bonus days
                    </label>
                    <input
                      id="plan-trialDays"
                      className="pm-input"
                      type="number"
                      min={0}
                      step={1}
                      value={form.trialDays}
                      onChange={(e) => setField('trialDays', e.target.value)}
                    />
                    <p className="pm-hint">
                      Extra validity days added to the first paid recharge (Starter +5, Pro +10, Team +15).
                    </p>
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="plan-sortOrder">
                      Sort order
                    </label>
                    <input
                      id="plan-sortOrder"
                      className="pm-input"
                      type="number"
                      step={1}
                      value={form.sortOrder}
                      onChange={(e) => setField('sortOrder', e.target.value)}
                    />
                  </div>
                  <div className="pm-field">
                    <label className="pm-label" htmlFor="plan-status">
                      Status
                    </label>
                    <select
                      id="plan-status"
                      className="pm-select"
                      value={form.status}
                      onChange={(e) => setField('status', e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="pm-modal-foot">
                <button type="button" className="pm-btn pm-btn-ghost" onClick={closeEditor} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="pm-btn pm-btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
