'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { accessRequestApi, type GlobalProject } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canCreateProject } from '@/lib/activeProject';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import { CreateModal } from './CreateModal';
import { MockServersModal } from './MockServersModal';
import { CheckIcon, ChevronIcon, LayersIcon, LockIcon, PlusIcon, ServerIcon } from './icons';

// Mobile label for the project switcher: initials of each word (e.g.
// "Boss Payments API" -> "BPA"). A single-word name keeps its first few
// letters so it stays recognisable. The full name is always available in the
// dropdown, the button title and its aria-label.
function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  const letters = words
    .map((w) => w.match(/[a-z0-9]/i)?.[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();
  return letters || name.slice(0, 3).toUpperCase();
}

export function ProjectSwitcher() {
  const ws = useWorkspace();
  const { dispatch } = useApp();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mockProject, setMockProject] = useState<{ id: string; name: string } | null>(null);
  const [requestingProject, setRequestingProject] = useState<{ id: string; name: string } | null>(null);
  const [accessReason, setAccessReason] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const projects = ws.allProjects;
  const active = projects.find((p) => p.id === ws.activeProjectId) ?? null;
  const allowCreate = canCreateProject(ws.activeWorkspaceRole, user?.role);

  const submitAccessRequest = async () => {
    if (!requestingProject) return;
    setRequestBusy(true);
    try {
      await accessRequestApi.request(requestingProject.id, accessReason || undefined);
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'success',
        message: `Access requested for "${requestingProject.name}".`,
      });
      setRequestingProject(null);
      setAccessReason('');
      await ws.refresh();
    } catch (err) {
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'error',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setRequestBusy(false);
    }
  };

  const groups = useMemo(() => {
    const byOrganization = new Map<string, GlobalProject[]>();
    for (const p of projects) {
      const key = p.organization_name || p.workspace_name || 'Personal';
      const bucket = byOrganization.get(key);
      if (bucket) bucket.push(p);
      else byOrganization.set(key, [p]);
    }
    return Array.from(byOrganization.entries());
  }, [projects]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!ws.activeWorkspaceId && projects.length === 0) return null;

  const activeLabel = active?.name ?? 'Select project';

  return (
    <div className="project-switcher" ref={wrapRef} data-testid="project-switcher">
      <button
        type="button"
        className="ghost-button project-switcher-button"
        data-testid="project-switcher-button"
        aria-label={`Project: ${activeLabel}`}
        title={activeLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <LayersIcon size={14} />
        <span className="project-switcher-name">{activeLabel}</span>
        <span className="project-switcher-abbr" aria-hidden="true">
          {projectInitials(activeLabel)}
        </span>
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className="project-dropdown" data-testid="project-dropdown" role="listbox">
          {projects.length === 0 && <p className="hint">No projects available.</p>}
          {groups.map(([organizationName, items]) => (
            <div key={organizationName} className="project-group">
              <div className="project-group-head" title={organizationName}>
                {organizationName}
              </div>
              {items.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  role="option"
                  aria-selected={p.id === ws.activeProjectId}
                  className={`project-option ${p.id === ws.activeProjectId ? 'active' : ''}`}
                  data-testid={`project-option-${p.name}`}
                  onClick={() => {
                    ws.selectProjectById(p.id).catch(() => undefined);
                    setOpen(false);
                  }}
                >
                  <LayersIcon size={13} />
                  <span className="project-option-name">{p.name}</span>
                  {p.can_access ? (
                    <span className="vis-badge access-badge">MEMBER</span>
                  ) : p.access_status === 'PENDING' ? (
                    <span className="vis-badge pending-badge">PENDING</span>
                  ) : null}
                  {p.id === ws.activeProjectId && <CheckIcon size={13} />}
                </button>
              ))}
            </div>
          ))}
          {active && (
            <div className="project-actions" data-testid="project-actions">
              <button
                type="button"
                className="project-action"
                data-testid="project-overview"
                onClick={() => {
                  setOpen(false);
                  dispatch({ type: 'SET_TAB', tab: 'request' });
                  ws.selectProjectOverview({ id: active.id, name: active.name }).catch(() => undefined);
                }}
              >
                <LayersIcon size={13} />
                <span>Project overview</span>
              </button>
              {active.can_access && (
                <button
                  type="button"
                  className="project-action"
                  data-testid={`mock-server-${active.name}`}
                  onClick={() => {
                    setOpen(false);
                    setMockProject({ id: active.id, name: active.name });
                  }}
                >
                  <ServerIcon size={13} />
                  <span>Mock server</span>
                </button>
              )}
              {!active.can_access && active.access_status !== 'PENDING' && (
                <button
                  type="button"
                  className="project-action"
                  data-testid={`request-access-${active.name}`}
                  onClick={() => {
                    setOpen(false);
                    setRequestingProject({ id: active.id, name: active.name });
                  }}
                >
                  <LockIcon size={13} />
                  <span>Request access</span>
                </button>
              )}
            </div>
          )}
          {allowCreate && (
            <button
              type="button"
              className="project-option project-option-new"
              data-testid="new-project"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <PlusIcon size={13} />
              <span>New project</span>
            </button>
          )}
        </div>
      )}
      {creating && <CreateModal kind="project" onClose={() => setCreating(false)} />}
      {mockProject && (
        <MockServersModal
          open
          projectId={mockProject.id}
          projectName={mockProject.name}
          onClose={() => setMockProject(null)}
        />
      )}
      {requestingProject && (
        <div
          className="modal-overlay"
          data-testid="access-request-modal"
          onClick={() => setRequestingProject(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Request access</h2>
            </div>
            <div className="modal-body">
              <p className="hint">
                Request access to <strong>{requestingProject.name}</strong>. A project manager or
                admin will review your request.
              </p>
              <div className="modal-form">
                <label className="field">
                  <span className="field-label">Reason (optional)</span>
                  <textarea
                    className="text-input"
                    data-testid="access-request-reason"
                    rows={3}
                    placeholder="e.g. I need to view the mocked APIs for the payments team"
                    value={accessReason}
                    onChange={(e) => setAccessReason(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button"
                data-testid="access-request-cancel"
                onClick={() => setRequestingProject(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                data-testid="access-request-confirm"
                disabled={requestBusy}
                onClick={submitAccessRequest}
              >
                Request access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
