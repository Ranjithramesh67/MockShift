'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  automationApi,
  workspaceApi,
  workflowApi,
  type Automation,
  type StoredWorkflow,
} from '@/lib/api';
import {
  BoltIcon,
  PlayIcon,
  TrashIcon,
  PlusIcon,
  CopyIcon,
  PlugIcon,
  ClockIcon,
  AlertIcon,
  RequestIcon,
} from '@/components/icons';

interface ProjectOption {
  id: string;
  name: string;
}

interface RequestOption {
  id: string;
  name: string;
  method: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function triggerLabel(type: string): string {
  switch (type) {
    case 'SCHEDULE':
      return 'Schedule (cron)';
    case 'WEBHOOK':
      return 'Webhook';
    case 'ON_REQUEST':
      return 'On request run';
    case 'ON_RUN_FAILURE':
      return 'On run failure';
    default:
      return type;
  }
}

export function AutomationsView() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [workflowsByProject, setWorkflowsByProject] = useState<Record<string, StoredWorkflow[]>>({});
  const [requestsByProject, setRequestsByProject] = useState<Record<string, RequestOption[]>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    projectId: '',
    workflowId: '',
    triggerType: 'SCHEDULE' as Automation['triggerType'],
    scheduleCron: '0 8 * * *',
    eventRequestId: '',
    sourceWorkflowId: '',
    notifyWebhookUrl: '',
    notifyOnFailure: true,
    enabled: true,
  });
  const [copied, setCopied] = useState<string | null>(null);

  const loadAutomations = () =>
    automationApi
      .list()
      .then((r) => setAutomations(r.automations))
      .catch(() => undefined);

  useEffect(() => {
    loadAutomations();

    (async () => {
      try {
        const { workspaces } = await workspaceApi.list();
        const collected: ProjectOption[] = [];
        const flows: Record<string, StoredWorkflow[]> = {};
        const reqs: Record<string, RequestOption[]> = {};
        for (const w of workspaces) {
          try {
            const tree = await workspaceApi.content(w.id);
            for (const p of tree.projects) {
              if (!p.can_access) continue;
              collected.push({ id: p.id, name: p.name });
              try {
                const wfRes = await workflowApi.list(p.id);
                flows[p.id] = wfRes.workflows;
              } catch {
                flows[p.id] = [];
              }
              for (const c of tree.collections) {
                if (c.project_id !== p.id) continue;
                for (const r of tree.requests) {
                  if (r.collection_id !== c.id) continue;
                  (reqs[p.id] ??= []).push({ id: r.id, name: r.name, method: r.method });
                }
              }
            }
          } catch {
            // skip inaccessible workspace
          }
        }
        setProjects(collected);
        setWorkflowsByProject(flows);
        setRequestsByProject(reqs);
      } catch {
        // workspaces list failed
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projectWorkflows = useMemo(
    () => (form.projectId ? workflowsByProject[form.projectId] ?? [] : []),
    [form.projectId, workflowsByProject]
  );

  const projectRequests = useMemo(
    () => (form.projectId ? requestsByProject[form.projectId] ?? [] : []),
    [form.projectId, requestsByProject]
  );

  const create = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await automationApi.create({
        name: form.name,
        projectId: form.projectId,
        workflowId: form.workflowId,
        triggerType: form.triggerType,
        scheduleCron: form.triggerType === 'SCHEDULE' ? form.scheduleCron : undefined,
        eventRequestId: form.triggerType === 'ON_REQUEST' ? form.eventRequestId || undefined : undefined,
        sourceWorkflowId: form.triggerType === 'ON_RUN_FAILURE' ? form.sourceWorkflowId || undefined : undefined,
        notifyWebhookUrl: form.notifyWebhookUrl.trim() || undefined,
        notifyOnFailure: form.notifyOnFailure,
        enabled: form.enabled,
      });
      setNotice('Automation created.');
      setCreateOpen(false);
      setForm({ name: '', projectId: '', workflowId: '', triggerType: 'SCHEDULE', scheduleCron: '0 8 * * *', eventRequestId: '', sourceWorkflowId: '', notifyWebhookUrl: '', notifyOnFailure: true, enabled: true });
      loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const trigger = async (a: Automation) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await automationApi.trigger(a.id);
      setNotice(`Triggered "${a.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trigger failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (a: Automation) => {
    setError('');
    setBusy(true);
    try {
      await automationApi.update(a.id, { enabled: !a.enabled });
      loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Automation) => {
    if (!window.confirm(`Delete automation "${a.name}"?`)) return;
    setError('');
    setBusy(true);
    try {
      await automationApi.remove(a.id);
      loadAutomations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const copyWebhook = async (a: Automation) => {
    if (!a.webhookUrl) return;
    const url = `${window.location.origin}${a.webhookUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(a.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('Clipboard unavailable');
    }
  };

  const canCreate = form.name.trim() && form.projectId && form.workflowId;

  return (
    <main className="admin-main" data-testid="automations-page">
      <div className="admin-title-row">
        <div>
          <h1>Automations</h1>
          <p className="admin-subtitle">Schedule workflow runs with cron, trigger them from a webhook, or react to request runs and failures.</p>
        </div>
        <button type="button" className="primary-button" data-testid="new-automation" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={14} /> New automation
        </button>
      </div>

      {error && (
        <p className="auth-error" role="alert" data-testid="automation-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="test-result" data-testid="automation-notice">
          {notice}
        </p>
      )}

      <div className="automation-list" data-testid="automation-list">
        {automations.length === 0 && <p className="hint">No automations yet. Create one to schedule or webhook-trigger a workflow, or react to request runs and failures.</p>}
        {automations.map((a) => (
          <div key={a.id} className="automation-card" data-testid={`automation-${a.name}`}>
            <div className="automation-card-head">
              <span className="automation-icon">
                <BoltIcon size={16} />
              </span>
              <div className="automation-card-title">
                <div className="admin-user-name">{a.name}</div>
                <div className="hint">
                  {a.projectName} · {a.workflowName}
                </div>
              </div>
              <span className={`vis-badge ${a.enabled ? 'vis-active' : 'vis-inactive'}`} data-testid={`automation-status-${a.name}`}>
                {a.enabled ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            <div className="automation-card-body">
              <div className="automation-meta">
                {a.triggerType === 'SCHEDULE' ? (
                  <>
                    <ClockIcon size={13} /> Cron: <code>{a.scheduleCron}</code>
                  </>
                ) : a.triggerType === 'WEBHOOK' ? (
                  <>
                    <PlugIcon size={13} /> Webhook: <code>{a.webhookUrl}</code>
                  </>
                ) : a.triggerType === 'ON_REQUEST' ? (
                  <>
                    <RequestIcon size={13} /> On request run
                    {a.eventRequestId ? (
                      <>
                        {' · '}request <code>{a.eventRequestId.slice(0, 8)}…</code>
                      </>
                    ) : (
                      <> · any request</>
                    )}
                  </>
                ) : (
                  <>
                    <AlertIcon size={13} /> On run failure
                    {a.sourceWorkflowId ? (
                      <>
                        {' · '}workflow <code>{a.sourceWorkflowId.slice(0, 8)}…</code>
                      </>
                    ) : (
                      <> · any run</>
                    )}
                  </>
                )}
              </div>
              <div className="automation-meta">
                Notify on failure: <strong>{a.notifyOnFailure ? 'yes' : 'no'}</strong>
                {a.notifyWebhookUrl && (
                  <>
                    {' · '}Webhook: <code>{a.notifyWebhookUrl}</code>
                  </>
                )}
                {a.lastRunAt && (
                  <>
                    {' · '}Last run: {fmtDate(a.lastRunAt)} ({a.lastStatus ?? '—'})
                  </>
                )}
              </div>
            </div>
            <div className="automation-card-actions">
              {a.triggerType === 'WEBHOOK' && (
                <button type="button" className="ghost-button small" data-testid={`copy-webhook-${a.name}`} onClick={() => copyWebhook(a)}>
                  <CopyIcon size={12} /> {copied === a.id ? 'Copied!' : 'Copy webhook URL'}
                </button>
              )}
              <button type="button" className="ghost-button small" data-testid={`trigger-${a.name}`} disabled={busy} onClick={() => trigger(a)}>
                <PlayIcon size={12} /> Run now
              </button>
              <button type="button" className="ghost-button small" data-testid={`toggle-${a.name}`} disabled={busy} onClick={() => toggleEnabled(a)}>
                {a.enabled ? 'Disable' : 'Enable'}
              </button>
              <button type="button" className="ghost-button small danger" data-testid={`delete-${a.name}`} disabled={busy} onClick={() => remove(a)}>
                <TrashIcon size={12} /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <div className="modal-overlay" data-testid="new-automation-modal" onClick={() => setCreateOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New automation</h2>
            </div>
            <div className="modal-body">
              <div className="modal-form">
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    className="text-input"
                    data-testid="automation-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Project</span>
                  <select
                    className="compact-select"
                    data-testid="automation-project"
                    value={form.projectId}
                    onChange={(e) => setForm({ ...form, projectId: e.target.value, workflowId: '' })}
                  >
                    <option value="" disabled>
                      Choose a project…
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Workflow</span>
                  <select
                    className="compact-select"
                    data-testid="automation-workflow"
                    value={form.workflowId}
                    disabled={!form.projectId}
                    onChange={(e) => setForm({ ...form, workflowId: e.target.value })}
                  >
                    <option value="" disabled>
                      {form.projectId ? (projectWorkflows.length ? 'Choose a workflow…' : 'No workflows in this project') : 'Choose a project first…'}
                    </option>
                    {projectWorkflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Trigger</span>
                  <select
                    className="compact-select"
                    data-testid="automation-trigger"
                    value={form.triggerType}
                    onChange={(e) => setForm({ ...form, triggerType: e.target.value as Automation['triggerType'] })}
                  >
                    <option value="SCHEDULE">Schedule (cron)</option>
                    <option value="WEBHOOK">Webhook</option>
                    <option value="ON_REQUEST">On request run</option>
                    <option value="ON_RUN_FAILURE">On run failure</option>
                  </select>
                </label>
                {form.triggerType === 'SCHEDULE' && (
                  <label className="field">
                    <span className="field-label">Cron expression</span>
                    <input
                      className="text-input"
                      data-testid="automation-cron"
                      value={form.scheduleCron}
                      onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
                    />
                  </label>
                )}
                {form.triggerType === 'ON_REQUEST' && (
                  <label className="field">
                    <span className="field-label">Watch request</span>
                    <select
                      className="compact-select"
                      data-testid="automation-event-request"
                      value={form.eventRequestId}
                      onChange={(e) => setForm({ ...form, eventRequestId: e.target.value })}
                    >
                      <option value="">Any request in this project</option>
                      {projectRequests.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.method} {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {form.triggerType === 'ON_RUN_FAILURE' && (
                  <label className="field">
                    <span className="field-label">Watch workflow</span>
                    <select
                      className="compact-select"
                      data-testid="automation-source-workflow"
                      value={form.sourceWorkflowId}
                      onChange={(e) => setForm({ ...form, sourceWorkflowId: e.target.value })}
                    >
                      <option value="">Any run in this project</option>
                      {projectWorkflows.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span className="field-label">Notify webhook URL (optional)</span>
                  <input
                    className="text-input"
                    data-testid="automation-webhook-url"
                    value={form.notifyWebhookUrl}
                    onChange={(e) => setForm({ ...form, notifyWebhookUrl: e.target.value })}
                    placeholder="https://hooks.example.com/notify"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Options</span>
                  <span className="checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        data-testid="automation-notify"
                        checked={form.notifyOnFailure}
                        onChange={(e) => setForm({ ...form, notifyOnFailure: e.target.checked })}
                      />{' '}
                      Notify on failure
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        data-testid="automation-enabled"
                        checked={form.enabled}
                        onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                      />{' '}
                      Enabled
                    </label>
                  </span>
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-button" data-testid="automation-cancel" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button" data-testid="automation-create" disabled={busy || !canCreate} onClick={create}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
