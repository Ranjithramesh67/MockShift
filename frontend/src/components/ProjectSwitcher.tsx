'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type GlobalProject } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canCreateProject } from '@/lib/activeProject';
import { useWorkspace } from '@/store/WorkspaceStore';
import { CreateModal } from './CreateModal';
import { CheckIcon, ChevronIcon, LayersIcon, PlusIcon } from './icons';

export function ProjectSwitcher() {
  const ws = useWorkspace();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const projects = ws.allProjects;
  const active = projects.find((p) => p.id === ws.activeProjectId) ?? null;
  const allowCreate = canCreateProject(ws.activeWorkspaceRole, user?.role);

  const groups = useMemo(() => {
    const byWorkspace = new Map<string, GlobalProject[]>();
    for (const p of projects) {
      const bucket = byWorkspace.get(p.workspace_name);
      if (bucket) bucket.push(p);
      else byWorkspace.set(p.workspace_name, [p]);
    }
    return Array.from(byWorkspace.entries());
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

  return (
    <div className="project-switcher" ref={wrapRef} data-testid="project-switcher">
      <button
        type="button"
        className="ghost-button project-switcher-button"
        data-testid="project-switcher-button"
        aria-label="Project"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <LayersIcon size={14} />
        <span className="project-switcher-name">{active?.name ?? 'Select project'}</span>
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className="project-dropdown" data-testid="project-dropdown" role="listbox">
          {projects.length === 0 && <p className="hint">No projects available.</p>}
          {groups.map(([workspaceName, items]) => (
            <div key={workspaceName} className="project-group">
              <div className="project-group-head" title={workspaceName}>
                {workspaceName}
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
    </div>
  );
}
