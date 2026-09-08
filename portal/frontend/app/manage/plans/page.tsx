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
  limits: Record<string, string>;
  publicSharing: boolean;
  enforce: boolean;
  features: string[];
};

// Canonical per-plan usage limit keys surfaced in the editor (Portal B usage
// restrictions). Blank numeric fields are stored as null (unlimited).
const LIMIT_KEYS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'workspaces', label: 'Workspaces', hint: 'Per organization' },
  { key: 'projects', label: 'Projects', hint: 'Across the org workspaces' },
  { key: 'collections', label: 'Collections', hint: 'API collections' },
  { key: 'teams', label: 'Teams', hint: 'Org teams' },
  { key: 'seats', label: 'Seats', hint: 'Distinct people with access' },
  { key: 'storage_mb', label: 'Storage (MB)', hint: 'Reserved — not enforced' },
  { key: 'runs_per_month', label: 'Runs / month', hint: 'Metered API runs' },
];

function emptyLimits(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of LIMIT_KEYS) out[key] = '';
  return out;
}

function limitsFromRow(row: PlanRow | null): Record<string, string> {
  const out: Record<string, string> = {};
  const src = row?.limits && typeof row.limits === 'object' ? (row.limits as Record<string, unknown>) : {};
  for (const { key } of LIMIT_KEYS) {
    const v = src[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  }
  return out;
}

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
  limits: emptyLimits(),
  publicSharing: false,
  enforce: true,
  features: [],
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
  for (const { key, label } of LIMIT_KEYS) {
    const raw = (f.limits[key] ?? '').trim();
    if (raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      return `${label} must be a non-negative integer (or blank for unlimited)`;
    }
  }
  return null;
}

// Fold the editor's canonical fields into a complete `limits` object. Existing
// unknown keys on the plan row are preserved so saves never drop extras.
function buildLimits(f: PlanForm, base: Record<string, unknown> | null): Record<string, unknown> {
  const limits: Record<string, unknown> = { ...(base ?? {}) };
  for (const { key } of LIMIT_KEYS) {
    const raw = (f.limits[key] ?? '').trim();
    limits[key] = raw === '' ? null : Number(raw);
  }
  limits.public_sharing = f.publicSharing;
  limits.enforce = f.enforce;
  return limits;
}

function buildPayload(f: PlanForm, base: Record<string, unknown> | null) {
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
    limits: buildLimits(f, base),
    features: f.features.map((t) => t.trim()).filter((t) => t !== ''),
  };
}

// Compact catalog summary of the stored canonical caps.
function limitSummary(limits: unknown): string {
  if (!limits || typeof limits !== 'object') return '—';
  const l = limits as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof l.workspaces === 'number') parts.push(`${l.workspaces} ws`);
  if (typeof l.projects === 'number') parts.push(`${l.projects} proj`);
  if (typeof l.collections === 'number') parts.push(`${l.collections} coll`);
  if (typeof l.teams === 'number') parts.push(`${l.teams} teams`);
  if (typeof l.seats === 'number') parts.push(`${l.seats} seat${l.seats === 1 ? '' : 's'}`);
  if (typeof l.runs_per_month === 'number') parts.push(`${l.runs_per_month} runs/mo`);
  if (typeof l.storage_mb === 'number') parts.push(`${l.storage_mb} MB`);
  const sharing = l.public_sharing === true ? 'public ok' : l.public_sharing === false ? 'no public' : null;
  if (sharing) parts.push(sharing);
  const base = parts.length ? parts.join(' · ') : 'unlimited';
  return l.enforce === false ? `${base} · not enforced` : base;
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

  const [restrictions, setRestrictions] = useState<boolean | null>(null);
  const [restrictionsBusy, setRestrictionsBusy] = useState(false);

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
          try {
            const s = await apiFetch<{ settings: { restrictions_enforced: boolean } }>('/api/portal/settings');
            if (!cancelled) setRestrictions(s.settings.restrictions_enforced);
          } catch {
            // Optional surface — plan editing remains usable without it.
          }
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
    const planLimits = plan.limits && typeof plan.limits === 'object' ? (plan.limits as Record<string, unknown>) : {};
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
      limits: limitsFromRow(plan),
      publicSharing: planLimits.public_sharing === true,
      enforce: planLimits.enforce !== false,
      features: Array.isArray(plan.features)
        ? plan.features.map((x) => String(x)).filter((s) => s.trim() !== '')
        : [],
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

  function setLimit(key: string, value: string) {
    setForm((f) => ({ ...f, limits: { ...f.limits, [key]: value } }));
  }

  function setFlag(flag: 'publicSharing' | 'enforce', value: boolean) {
    setForm((f) => ({ ...f, [flag]: value }));
  }

  function setFeature(index: number, value: string) {
    setForm((f) => {
      const features = [...f.features];
      features[index] = value;
      return { ...f, features };
    });
  }

  function addFeature() {
    setForm((f) => ({ ...f, features: [...f.features, ''] }));
  }

  function removeFeature(index: number) {
    setForm((f) => ({
      ...f,
      features: f.features.filter((_, i) => i !== index),
    }));
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
      const payload = buildPayload(form, editing ? editing.limits : null);
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

  async function onToggleRestrictions(next: boolean) {
    setActionError(null);
    setRestrictionsBusy(true);
    try {
      const s = await apiFetch<{ settings: { restrictions_enforced: boolean } }>('/api/portal/settings', {
        method: 'PUT',
        body: { restrictions_enforced: next },
      });
      setRestrictions(s.settings.restrictions_enforced);
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setRestrictionsBusy(false);
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
                <th>Usage limits</th>
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
                  <td>
                    <span className="pm-cell-sub" style={{ whiteSpace: 'nowrap' }}>
                      {limitSummary(plan.limits)}
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

      {role && canRead && !meLoading ? (
        <div style={{ marginBottom: 18 }} data-testid="restrictions-card">
          <Card
            title="Usage restrictions"
            actions={
              restrictions === false ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">Enforcing</Badge>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {restrictions === false ? (
                <Alert kind="info">
                  Per-plan usage limits are paused globally. Workspace, project, collection, team, seat,
                  public-sharing and run gates are <strong>not enforced</strong> until this is turned back on.
                </Alert>
              ) : (
                <p className="pm-hint" style={{ margin: 0 }}>
                  Master switch for the per-plan usage gates (Portal B). When ON, every org is limited by its
                  covering plan&apos;s limits below. Enterprise and custom plans stay exempt.
                </p>
              )}
              {canManage ? (
                <label className="pm-check" style={{ paddingTop: 2 }}>
                  <input
                    type="checkbox"
                    data-testid="restrictions-toggle"
                    checked={restrictions !== false}
                    disabled={restrictionsBusy}
                    onChange={(e) => onToggleRestrictions(e.target.checked)}
                  />
                  Enforce per-plan usage restrictions
                </label>
              ) : (
                <span className="pm-hint">MANAGER or ADMIN access is required to change enforcement.</span>
              )}
            </div>
          </Card>
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
                <div style={{ marginTop: 6 }}>
                  <div
                    style={{
                      borderTop: '1px solid rgba(148,163,184,0.3)',
                      paddingTop: 14,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      className="pm-label"
                      style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                    >
                      Usage limits &amp; restrictions
                    </span>
                    <p className="pm-hint" style={{ margin: '2px 0 0' }}>
                      An organization is limited by these caps (Portal B gates). Blank a field for unlimited;
                      enterprise / custom plans are always exempt.
                    </p>
                  </div>
                  <div className="pm-form-grid">
                    {LIMIT_KEYS.map(({ key, label, hint }) => (
                      <div className="pm-field" key={key}>
                        <label className="pm-label" htmlFor={`plan-lim-${key}`}>
                          {label}
                        </label>
                        <input
                          id={`plan-lim-${key}`}
                          className="pm-input"
                          type="number"
                          min={0}
                          step={1}
                          value={form.limits[key] ?? ''}
                          onChange={(e) => setLimit(key, e.target.value)}
                          placeholder="unlimited"
                        />
                        <p className="pm-hint">{hint}</p>
                      </div>
                    ))}
                    <div className="pm-field">
                      <span className="pm-label">Public sharing</span>
                      <label className="pm-check" style={{ paddingTop: 2 }}>
                        <input
                          type="checkbox"
                          checked={form.publicSharing}
                          onChange={(e) => setFlag('publicSharing', e.target.checked)}
                        />
                        Allow public workspaces &amp; share links
                      </label>
                    </div>
                    <div className="pm-field">
                      <span className="pm-label">Plan override</span>
                      <label className="pm-check" style={{ paddingTop: 2 }}>
                        <input
                          type="checkbox"
                          checked={form.enforce}
                          onChange={(e) => setFlag('enforce', e.target.checked)}
                        />
                        Enforce limits on this plan (off = plan is exempt)
                      </label>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      borderTop: '1px solid rgba(148,163,184,0.3)',
                      paddingTop: 14,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      className="pm-label"
                      style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                    >
                      Feature bullets
                    </span>
                    <p className="pm-hint" style={{ margin: '2px 0 0' }}>
                      Shown as the check-marked list on the Portal A pricing grid (and in checkout). Add one item
                      per row, e.g. &ldquo;25 workspaces&rdquo;. Empty rows are dropped on save.
                    </p>
                  </div>
                  {form.features.length === 0 ? (
                    <p className="pm-hint" style={{ margin: '2px 0 10px' }}>
                      No bullets yet — add one below.
                    </p>
                  ) : null}
                  {form.features.map((feature, index) => (
                    <div key={`${index}-${feature.length > 0 ? feature.slice(0, 12) : 'empty'}`} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input
                        className="pm-input"
                        aria-label={`Feature ${index + 1}`}
                        value={feature}
                        onChange={(e) => setFeature(index, e.target.value)}
                        placeholder="e.g. 5 workspaces"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="pm-btn pm-btn-ghost pm-btn-sm"
                        aria-label={`Remove feature ${index + 1}`}
                        onClick={() => removeFeature(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button type="button" className="pm-btn pm-btn-outline pm-btn-sm" onClick={addFeature}>
                    + Add feature
                  </button>
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
