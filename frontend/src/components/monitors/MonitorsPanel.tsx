'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { workspaceApi, workflowApi, type StoredWorkflow } from '@/lib/api';
import {
  monitorsApi,
  type Monitor,
  type MonitorAggregate,
  type MonitorResult,
  type MonitorTargetType,
} from '@/lib/monitorsApi';
import { PlusIcon, PlayIcon, TrashIcon, RequestIcon, WorkflowIcon, CheckIcon, AlertIcon } from '@/components/icons';
import styles from './monitors.module.css';

interface ProjectOption {
  id: string;
  name: string;
}

interface RequestOption {
  id: string;
  name: string;
  method: string;
}

const DEFAULT_CRON = '*/5 * * * *';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function statusClass(status: Monitor['status']): string {
  if (status === 'UP') return styles.statusUp;
  if (status === 'DOWN') return styles.statusDown;
  return styles.statusUnknown;
}

function targetTypeLabel(type: MonitorTargetType): string {
  return type === 'REQUEST' ? 'Request' : 'Workflow';
}

export function MonitorsPanel() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [requestsByProject, setRequestsByProject] = useState<Record<string, RequestOption[]>>({});
  const [workflowsByProject, setWorkflowsByProject] = useState<Record<string, StoredWorkflow[]>>({});
  const [projectId, setProjectId] = useState('');
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [aggregates, setAggregates] = useState<Record<string, MonitorAggregate>>({});
  const [results, setResults] = useState<Record<string, MonitorResult[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    targetType: MonitorTargetType;
    requestId: string;
    workflowId: string;
    scheduleCron: string;
    failureThreshold: number;
    notifyWebhookUrl: string;
    enabled: boolean;
  }>({
    name: '',
    targetType: 'REQUEST',
    requestId: '',
    workflowId: '',
    scheduleCron: DEFAULT_CRON,
    failureThreshold: 1,
    notifyWebhookUrl: '',
    enabled: true,
  });

  // Bootstrap the project list + each project's stored requests (mirrors the
  // AutomationsView loader so the panel has no extra backend dependency).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { workspaces } = await workspaceApi.list();
        const collected: ProjectOption[] = [];
        const reqs: Record<string, RequestOption[]> = {};
        for (const w of workspaces) {
          const tree = await workspaceApi.content(w.id);
          for (const p of tree.projects) {
            if (!p.can_access) continue;
            collected.push({ id: p.id, name: p.name });
            const list: RequestOption[] = [];
            for (const c of tree.collections) {
              if (c.project_id !== p.id) continue;
              for (const r of tree.requests) {
                if (r.collection_id === c.id) list.push({ id: r.id, name: r.name, method: r.method });
              }
            }
            reqs[p.id] = list;
          }
        }
        if (cancelled) return;
        setProjects(collected);
        setRequestsByProject(reqs);
        if (collected[0]) setProjectId(collected[0].id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMonitors = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    setError('');
    try {
      const { monitors: list } = await monitorsApi.list(pid);
      setMonitors(list);
      const entries = await Promise.allSettled(list.map((m) => monitorsApi.get(m.id)));
      const next: Record<string, MonitorAggregate> = {};
      entries.forEach((entry) => {
        if (entry.status === 'fulfilled') next[entry.value.monitor.id] = entry.value.aggregate;
      });
      setAggregates(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMonitors(projectId);
  }, [projectId, loadMonitors]);

  const loadWorkflows = useCallback(async (pid: string) => {
    if (!pid) return;
    let alreadyLoaded = false;
    setWorkflowsByProject((prev) => {
      alreadyLoaded = Boolean(prev[pid]);
      return prev;
    });
    if (alreadyLoaded) return;
    try {
      const { workflows } = await workflowApi.list(pid);
      setWorkflowsByProject((prev) => ({ ...prev, [pid]: workflows }));
    } catch {
      setWorkflowsByProject((prev) => ({ ...prev, [pid]: [] }));
    }
  }, []);

  useEffect(() => {
    if (form.targetType === 'WORKFLOW' && projectId) loadWorkflows(projectId);
  }, [form.targetType, projectId, loadWorkflows]);

  const requestOptions = useMemo(
    () => (projectId ? requestsByProject[projectId] ?? [] : []),
    [projectId, requestsByProject]
  );
  const workflowOptions = useMemo(
    () => (projectId ? workflowsByProject[projectId] ?? [] : []),
    [projectId, workflowsByProject]
  );

  const loadResults = useCallback(async (monitorId: string) => {
    try {
      const res = await monitorsApi.results(monitorId, 25);
      setResults((prev) => ({ ...prev, [monitorId]: res.results }));
      setAggregates((prev) => ({ ...prev, [monitorId]: res.aggregate }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load results');
    }
  }, []);

  const toggleExpand = (monitor: Monitor) => {
    if (expanded === monitor.id) {
      setExpanded(null);
      return;
    }
    setExpanded(monitor.id);
    loadResults(monitor.id);
  };

  const create = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await monitorsApi.create({
        projectId,
        name: form.name.trim(),
        targetType: form.targetType,
        requestId: form.targetType === 'REQUEST' ? form.requestId : undefined,
        workflowId: form.targetType === 'WORKFLOW' ? form.workflowId : undefined,
        scheduleCron: form.scheduleCron.trim(),
        failureThreshold: Number(form.failureThreshold),
        notifyWebhookUrl: form.notifyWebhookUrl.trim() || undefined,
        enabled: form.enabled,
      });
      setNotice('Monitor created.');
      setCreateOpen(false);
      setForm({
        name: '',
        targetType: 'REQUEST',
        requestId: '',
        workflowId: '',
        scheduleCron: DEFAULT_CRON,
        failureThreshold: 1,
        notifyWebhookUrl: '',
        enabled: true,
      });
      await loadMonitors(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const checkNow = async (monitor: Monitor) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await monitorsApi.check(monitor.id);
      setNotice(`"${monitor.name}" ${res.check.passed ? 'passed' : 'failed'}.`);
      await loadMonitors(projectId);
      if (expanded === monitor.id) await loadResults(monitor.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (monitor: Monitor) => {
    setBusy(true);
    setError('');
    try {
      await monitorsApi.update(monitor.id, { enabled: !monitor.enabled });
      await loadMonitors(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (monitor: Monitor) => {
    if (!window.confirm(`Delete monitor "${monitor.name}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await monitorsApi.remove(monitor.id);
      if (expanded === monitor.id) setExpanded(null);
      await loadMonitors(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const targetName = (monitor: Monitor): string => {
    if (monitor.targetType === 'REQUEST') {
      return requestOptions.find((r) => r.id === monitor.requestId)?.name || 'Stored request';
    }
    return workflowOptions.find((w) => w.id === monitor.workflowId)?.name || 'Workflow';
  };

  const canCreate =
    Boolean(form.name.trim() && projectId) &&
    (form.targetType === 'REQUEST' ? Boolean(form.requestId) : Boolean(form.workflowId));

  return (
    <main className="admin-main" data-testid="monitors-page">
      <div className="admin-title-row">
        <div>
          <h1>Monitors</h1>
          <p className="admin-subtitle">
            Schedule synthetic checks for stored requests and workflows, track uptime and latency, and get alerted when
            checks start failing.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          data-testid="new-monitor"
          disabled={!projectId}
          onClick={() => setCreateOpen((v) => !v)}
        >
          <PlusIcon size={14} /> New monitor
        </button>
      </div>

      {error && (
        <p className="auth-error" role="alert" data-testid="monitor-error">
          {error}
        </p>
      )}
      {notice && <p className="test-result" data-testid="monitor-notice">{notice}</p>}

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span className={styles.label}>Project</span>
          <select className={styles.select} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {createOpen && (
        <section className={styles.form} data-testid="monitor-form">
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                value={form.name}
                placeholder="Homepage health"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Target</span>
              <select
                className={styles.select}
                value={form.targetType}
                onChange={(e) => setForm({ ...form, targetType: e.target.value as MonitorTargetType })}
              >
                <option value="REQUEST">Stored request</option>
                <option value="WORKFLOW">Workflow</option>
              </select>
            </label>
            {form.targetType === 'REQUEST' ? (
              <label className={styles.field}>
                <span className={styles.label}>Request</span>
                <select
                  className={styles.select}
                  value={form.requestId}
                  onChange={(e) => setForm({ ...form, requestId: e.target.value })}
                >
                  <option value="">Select a request…</option>
                  {requestOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.method} {r.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className={styles.field}>
                <span className={styles.label}>Workflow</span>
                <select
                  className={styles.select}
                  value={form.workflowId}
                  onChange={(e) => setForm({ ...form, workflowId: e.target.value })}
                >
                  <option value="">Select a workflow…</option>
                  {workflowOptions.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.field}>
              <span className={styles.label}>Schedule (cron, UTC)</span>
              <input
                className={styles.input}
                value={form.scheduleCron}
                placeholder="*/5 * * * *"
                onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Failure threshold</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={100}
                value={form.failureThreshold}
                onChange={(e) => setForm({ ...form, failureThreshold: Number(e.target.value) })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Alert webhook URL (optional)</span>
              <input
                className={styles.input}
                value={form.notifyWebhookUrl}
                placeholder="https://hooks.example.com/alert"
                onChange={(e) => setForm({ ...form, notifyWebhookUrl: e.target.value })}
              />
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <span>Enabled</span>
            </label>
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryBtn} onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" disabled={!canCreate || busy} onClick={create}>
              Create monitor
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className={styles.subtle}>Loading monitors…</p>
      ) : monitors.length === 0 ? (
        <p className={styles.subtle} data-testid="monitors-empty">
          No monitors yet for this project.
        </p>
      ) : (
        <ul className={styles.list}>
          {monitors.map((monitor) => {
            const aggregate = aggregates[monitor.id];
            const isOpen = expanded === monitor.id;
            return (
              <li key={monitor.id} className={styles.card} data-testid={`monitor-${monitor.id}`}>
                <div className={styles.cardHead}>
                  <div className={styles.cardTitleRow}>
                    <span className={`${styles.statusBadge} ${statusClass(monitor.status)}`}>
                      {monitor.status === 'UP' ? <CheckIcon size={12} /> : monitor.status === 'DOWN' ? <AlertIcon size={12} /> : null}
                      {monitor.status}
                    </span>
                    <span className={styles.cardTitle}>{monitor.name}</span>
                    <span className={styles.targetChip}>
                      {monitor.targetType === 'REQUEST' ? <RequestIcon size={12} /> : <WorkflowIcon size={12} />}
                      {targetTypeLabel(monitor.targetType)} · {targetName(monitor)}
                    </span>
                    {!monitor.enabled && <span className={styles.pausedChip}>Paused</span>}
                  </div>
                  <div className={styles.cardActions}>
                    <button type="button" className={styles.iconBtn} title="Run now" disabled={busy} onClick={() => checkNow(monitor)}>
                      <PlayIcon size={14} />
                    </button>
                    <button type="button" className={styles.iconBtn} disabled={busy} onClick={() => toggleEnabled(monitor)}>
                      {monitor.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button type="button" className={styles.iconBtn} title="Delete" disabled={busy} onClick={() => remove(monitor)}>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>

                <div className={styles.metaRow}>
                  <span className={styles.subtle}>cron: {monitor.scheduleCron}</span>
                  <span className={styles.subtle}>threshold: {monitor.failureThreshold}</span>
                  <span className={styles.subtle}>last checked: {fmtDate(monitor.lastCheckedAt)}</span>
                  {aggregate && (
                    <>
                      <span className={styles.subtle}>
                        uptime: {aggregate.uptimePct == null ? '—' : `${aggregate.uptimePct}%`}
                      </span>
                      <span className={styles.subtle}>
                        p95: {aggregate.p95DurationMs == null ? '—' : `${aggregate.p95DurationMs} ms`}
                      </span>
                      <span className={styles.subtle}>
                        streak: {aggregate.currentStreak.status} ×{aggregate.currentStreak.count}
                      </span>
                    </>
                  )}
                  <button type="button" className={styles.linkBtn} onClick={() => toggleExpand(monitor)}>
                    {isOpen ? 'Hide history' : 'View history'}
                  </button>
                </div>

                {isOpen && (
                  <div className={styles.resultsWrap}>
                    {(results[monitor.id] ?? []).length === 0 ? (
                      <p className={styles.subtle}>No checks recorded yet.</p>
                    ) : (
                      <table className={styles.resultsTable}>
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Result</th>
                            <th>HTTP</th>
                            <th>Duration</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(results[monitor.id] ?? []).map((r) => (
                            <tr key={r.id}>
                              <td>{fmtDate(r.checkedAt)}</td>
                              <td className={r.status === 'PASS' ? styles.resultPass : styles.resultFail}>{r.status}</td>
                              <td>{r.httpStatus ?? '—'}</td>
                              <td>{r.durationMs == null ? '—' : `${r.durationMs} ms`}</td>
                              <td className={styles.errorCell}>{r.error || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
