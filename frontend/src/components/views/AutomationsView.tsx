'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  automationApi,
  workspaceApi,
  workflowApi,
  type Automation,
  type StoredWorkflow,
} from '@/lib/api';
import { BoltIcon, PlayIcon, TrashIcon, PlusIcon, CopyIcon, PlugIcon, ClockIcon } from '@/components/icons';

interface ProjectOption {
  id: string;
  name: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function AutomationsView() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [workflowsByProject, setWorkflowsByProject] = useState<Record<string, StoredWorkflow[]>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    projectId: '',
    workflowId: '',
    triggerType: 'SCHEDULE' as 'SCHEDULE' | 'WEBHOOK',
    scheduleCron: '0 8 * * *',
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
            }
          } catch {
            // skip inaccessible workspace
          }
        }
        setProjects(collected);
        setWorkflowsByProject(flows);
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
        notifyOnFailure: form.notifyOnFailure,
        enabled: form.enabled,
      });
      setNotice('Automation created.');
      setCreateOpen(false);
      setForm({ name: '', projectId: '', workflowId: '', triggerType: 'SCHEDULE', scheduleCron: '0 8 * * *', notifyOnFailure: true, enabled: true });
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
          <p className="admin-subtitle">Schedule workflow runs with cron or trigger them from a webhook.</p>
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
        {automations.length === 0 && <p className="hint">No automations yet. Create one to schedule or webhook-trigger a workflow.</p>}
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
                ) : (
                  <>
                    <PlugIcon size={13} /> Webhook: <code>{a.webhookUrl}</code>
                  </>
                )}
              </div>
              <div className="automation-meta">
                Notify on failure: <strong>{a.notifyOnFailure ? 'yes' : 'no'}</strong>
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
                    onChange={(e) => setForm({ ...form, triggerType: e.target.value as 'SCHEDULE' | 'WEBHOOK' })}
                  >
                    <option value="SCHEDULE">Schedule (cron)</option>
                    <option value="WEBHOOK">Webhook</option>
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
