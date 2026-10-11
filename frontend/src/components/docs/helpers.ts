'use client';

import { teamApi, workspaceApi, adminApi, manageApi, type UserRole } from '@/lib/api';

export interface MemberOption {
  id: string;
  name: string;
  email?: string | null;
  username?: string;
  role?: string | null;
}

export interface ApiOption {
  id: string;
  name: string;
  method: string;
  projectId: string;
  projectName: string;
}

const ROLE_RANK: Record<string, number> = { ADMIN: 4, MANAGER: 3, EDITOR: 2, VIEWER: 1 };
export const workspaceRoleRank = (role: string | null | undefined): number =>
  role ? ROLE_RANK[role] ?? 0 : 0;

// Workspace member directory for the "+ Tag user" picker. There is no single
// "list workspace members" endpoint, so we derive members the same way the
// Sidebar/ManageView do: the members of the teams that share the workspace
// (GET /api/teams lists my teams with full members). Global managers/admins
// get an org-wide supplement so pickers stay useful on org-admin work.
export async function listWorkspaceMembers(
  workspaceId: string,
  viewer: { role?: UserRole | null } | null = null
): Promise<MemberOption[]> {
  const map = new Map<string, MemberOption>();
  const add = (m: MemberOption) => {
    if (!m.id || map.has(m.id)) return;
    map.set(m.id, m);
  };

  const myTeams = await teamApi.list().catch(() => ({ teams: [] }));
  const teamById = new Map(myTeams.teams.map((t) => [t.id, t]));

  try {
    const { teams: shares } = await workspaceApi.teams(workspaceId);
    const shareIds = new Set(shares.map((s) => s.team_id));
    let viaTeams = 0;
    for (const team of myTeams.teams) {
      if (!shareIds.has(team.id)) continue;
      viaTeams += team.members.length;
      team.members.forEach((m) =>
        add({ id: m.id, name: m.name, email: m.email ?? null, username: m.username, role: m.role })
      );
    }
    // Fallback: the workspace isn't shared with any team I belong to (direct
    // workspace grant / public) — still offer my own team members as a best
    // effort so the picker is never empty for a shared-org team.
    if (viaTeams === 0) {
      myTeams.teams.forEach((t) =>
        t.members.forEach((m) =>
          add({ id: m.id, name: m.name, email: m.email ?? null, username: m.username, role: m.role })
        )
      );
    }
  } catch {
    // workspace teams lookup failed — fall through to admin/org supplements.
  }

  // Global platform admin can read every workspace's direct members.
  if (viewer?.role === 'ADMIN') {
    try {
      const acc = await adminApi.access();
      const ws = acc.workspaces.find((w) => w.id === workspaceId);
      ws?.members.forEach((m) => add({ id: m.id, name: m.name, email: m.email ?? null, role: m.role }));
    } catch {
      // no admin access
    }
  }

  // Global manager/admin: org-wide user directory fallback (only when nothing
  // team-derived matched, e.g. a workspace granted directly to the caller).
  if ((viewer?.role === 'MANAGER' || viewer?.role === 'ADMIN') && map.size <= 1) {
    try {
      const { users } = await manageApi.users();
      users
        .filter((u) => u.is_active)
        .forEach((u) => add({ id: u.id, name: u.name, email: u.email ?? null, username: u.username, role: u.role }));
    } catch {
      // no manage access
    }
  }

  // Always keep at least the team directory when it exists.
  if (map.size === 0) {
    teamById.forEach((t) =>
      t.members.forEach((m) =>
        add({ id: m.id, name: m.name, email: m.email ?? null, username: m.username, role: m.role })
      )
    );
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// API request directory for the "+ Tag API" picker, fed from the same content
// tree endpoint the workspace sidebar uses (requests under collections of the
// projects the caller can access).
export async function listWorkspaceApis(workspaceId: string): Promise<ApiOption[]> {
  const tree = await workspaceApi.content(workspaceId);
  const collectionProject = new Map(tree.collections.map((c) => [c.id, c.project_id]));
  const projectName = new Map(tree.projects.map((p) => [p.id, p.name]));
  return tree.requests
    .map((r) => {
      const projectId = collectionProject.get(r.collection_id) ?? '';
      return { id: r.id, name: r.name, method: r.method, projectId, projectName: projectName.get(projectId) ?? '' };
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name));
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

// Pretty-print a code/body string when it is valid JSON, else return raw.
export function formatBody(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return raw;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}
