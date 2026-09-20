'use strict';

const STORAGE_KEY = 'apihub.activeProject.v1';

const ROLE_RANK = { ADMIN: 4, MANAGER: 3, EDITOR: 2, VIEWER: 1 };

function roleAtLeast(role, min) {
  if (!role) return false;
  return (ROLE_RANK[role] || 0) >= ROLE_RANK[min];
}

/**
 * True when the caller may create a project in the current workspace:
 * workspace MANAGER/ADMIN, or a platform MANAGER/ADMIN.
 *
 * @param {string | null | undefined} workspaceRole
 * @param {string | null | undefined} platformRole
 * @returns {boolean}
 */
function canCreateProject(workspaceRole, platformRole) {
  return roleAtLeast(workspaceRole, 'MANAGER') || roleAtLeast(platformRole, 'MANAGER');
}

/**
 * Pick which project should be the working context.
 * A still-present preferred id wins even if the user cannot access it (so a
 * pending-access project stays selected). Otherwise the first accessible
 * project, else the first project, else null.
 *
 * @param {{ projects?: Array<{ id: string, can_access?: boolean }> } | null | undefined} tree
 * @param {string | null | undefined} preferredId
 * @returns {string | null}
 */
function resolveActiveProject(tree, preferredId) {
  const projects = (tree && Array.isArray(tree.projects) ? tree.projects : []).filter(
    (p) => p && typeof p.id === 'string'
  );
  if (projects.length === 0) return null;
  if (preferredId && projects.some((p) => p.id === preferredId)) return preferredId;
  const accessible = projects.find((p) => p.can_access);
  return (accessible || projects[0]).id;
}

function readMap(storage) {
  if (!storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @param {string} workspaceId
 * @returns {string | null}
 */
function readPersistedProject(storage, workspaceId) {
  if (!workspaceId) return null;
  const value = readMap(storage)[workspaceId];
  return typeof value === 'string' && value ? value : null;
}

/**
 * @param {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void } | null | undefined} storage
 * @param {string} workspaceId
 * @param {string} projectId
 */
function persistActiveProject(storage, workspaceId, projectId) {
  if (!storage || typeof storage.setItem !== 'function' || !workspaceId || !projectId) return;
  const next = { ...readMap(storage), [workspaceId]: projectId };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — the in-memory selection still works.
  }
}

/**
 * @param {{ collections?: Array<{ id: string, project_id: string }> } | null | undefined} tree
 * @param {string | null | undefined} projectId
 * @returns {Array<{ id: string, project_id: string }>}
 */
function collectionsForProject(tree, projectId) {
  const collections = tree && Array.isArray(tree.collections) ? tree.collections : [];
  if (!projectId) return [];
  return collections.filter((c) => c && c.project_id === projectId);
}

module.exports = {
  STORAGE_KEY,
  canCreateProject,
  resolveActiveProject,
  readPersistedProject,
  persistActiveProject,
  collectionsForProject,
};
