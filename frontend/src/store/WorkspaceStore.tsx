'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  contentApi,
  folderApi,
  teamApi,
  workspaceApi,
  type ApiType,
  type AssertionResult,
  type AuthProvider,
  type CollectionRunResult,
  type ContentTree,
  type Folder,
  type RunResult,
  type Team,
  type TeamMember,
  type UserRole,
  type Workspace,
} from '@/lib/api';
import type { ApiRequest, Assertion, BodyType, RequestContentType } from '@/lib/types';
import { useAuth } from '@/lib/auth';

function contentTypeForBodyType(bt: string): RequestContentType {
  switch (bt) {
    case 'JSON':
      return 'application/json';
    case 'FORM_URLENCODED':
      return 'application/x-www-form-urlencoded';
    case 'MULTIPART':
      return 'multipart/form-data';
    case 'GRAPHQL':
      return 'application/json';
    default:
      return 'text/plain';
  }
}

export function toEditorRequest(d: {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Array<{ key: string; value: string; enabled: boolean }>;
  queryParams?: Array<{ key: string; value: string; enabled: boolean }>;
  bodyType?: string;
  bodyJson?: unknown;
  bodyText?: string | null;
  apiType?: ApiType;
  formula?: string;
  assertions?: Assertion[];
}): ApiRequest {
  let bodyJson: string | null = null;
  if (d.bodyJson !== undefined && d.bodyJson !== null) {
    bodyJson = typeof d.bodyJson === 'string' ? d.bodyJson : JSON.stringify(d.bodyJson, null, 2);
  } else if (d.bodyText) {
    bodyJson = d.bodyText;
  }
  return {
    id: d.id,
    name: d.name,
    method: (d.method || 'GET') as ApiRequest['method'],
    url: d.url || '',
    headers: d.headers ?? [],
    queryParams: d.queryParams ?? [],
    bodyType: (d.bodyType || 'NONE') as BodyType,
    bodyJson,
    contentType: contentTypeForBodyType(d.bodyType || 'NONE'),
    formula: d.formula ?? '',
    apiType: (d.apiType || 'REST') as ApiType,
    assertions: Array.isArray(d.assertions) ? d.assertions : [],
  };
}

export function toServerPatch(r: ApiRequest): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: r.name,
    method: r.method,
    url: r.url,
    apiType: r.apiType,
    headers: r.headers,
    queryParams: r.queryParams,
    bodyType: r.bodyType,
    formula: r.formula || '',
    assertions: r.assertions ?? [],
  };
  if (r.bodyType === 'JSON') {
    if (r.bodyJson) {
      try {
        patch.bodyJson = JSON.parse(r.bodyJson);
      } catch {
        patch.bodyJson = null;
        patch.bodyText = r.bodyJson;
      }
    } else {
      patch.bodyJson = null;
      patch.bodyText = null;
    }
  } else {
    patch.bodyText = r.bodyJson ?? null;
    patch.bodyJson = null;
  }
  return patch;
}

const DIRTY_FIELDS = [
  'method',
  'url',
  'headers',
  'queryParams',
  'bodyType',
  'bodyJson',
  'formula',
  'assertions',
] as const;

function dirtySnapshot(r: ApiRequest): unknown[] {
  return DIRTY_FIELDS.map((k) => r[k]);
}

function dirtySnapshotsEqual(a: unknown[] | null, b: unknown[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((v, i) => JSON.stringify(v) === JSON.stringify(b[i]));
}

interface WorkspaceState {
  loading: boolean;
  error: string | null;
  workspaces: Workspace[];
  teams: Team[];
  activeWorkspaceId: string | null;
  activeWorkspaceRole: UserRole | null;
  tree: ContentTree | null;
  activeCollectionId: string | null;
  activeCollectionName: string;
  authProvider: AuthProvider | null;
  activeRequest: ApiRequest | null;
  isDirty: boolean;
  lastRun: RunResult | null;
  collectionRun: CollectionRunResult | null;
  collectionRunRunning: boolean;

  refresh: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  selectRequest: (requestId: string) => Promise<void>;
  selectCollection: (collectionId: string, collectionName: string) => Promise<void>;
  updateActiveRequest: (patch: Partial<ApiRequest>) => void;
  saveActiveRequest: () => Promise<void>;
  runActiveRequest: () => Promise<void>;
  runCollection: (collectionId: string) => Promise<CollectionRunResult>;
  clearCollectionRun: () => void;

  createWorkspace: (name: string, visibility?: Workspace['visibility']) => Promise<void>;
  createCollection: (name: string) => Promise<void>;
  createRequest: (input: { name: string; method: string; url: string; apiType: ApiType; folderId?: string | null }) => Promise<void>;
  createFolder: (input: { name: string; collectionId: string; parentId?: string | null }) => Promise<void>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  renameRequest: (requestId: string, name: string) => Promise<void>;

  deleteRequest: (requestId: string) => Promise<void>;
  deleteCollection: (collectionId: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;

  loadAuthProvider: (collectionId: string) => Promise<void>;
  saveAuthProvider: (provider: AuthProvider) => Promise<void>;
  testAuthProvider: () => Promise<{ resolvedHeader: { headerKey: string; headerValue: string } | null; tokenResponse: string } | null>;
  reloadTree: () => Promise<void>;

  inviteToTeam: (teamId: string, email: string, role: UserRole) => Promise<TeamMember[]>;
  shareWorkspace: (workspaceId: string, teamId: string, role: UserRole) => Promise<void>;
  unshareWorkspace: (workspaceId: string, teamId: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeWorkspaceRole, setActiveWorkspaceRole] = useState<UserRole | null>(null);
  const [tree, setTree] = useState<ContentTree | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeCollectionName, setActiveCollectionName] = useState('');
  const [authProvider, setAuthProvider] = useState<AuthProvider | null>(null);
  const [activeRequest, setActiveRequest] = useState<ApiRequest | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<unknown[] | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [collectionRun, setCollectionRun] = useState<CollectionRunResult | null>(null);
  const [collectionRunRunning, setCollectionRunRunning] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setTeams([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ws, tm] = await Promise.all([workspaceApi.list(), teamApi.list()]);
      setWorkspaces(ws.workspaces);
      setTeams(tm.teams);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    setError(null);
    setActiveWorkspaceId(workspaceId);
    setActiveRequest(null);
    setLastRun(null);
    const ws = workspaces.find((w) => w.id === workspaceId);
    setActiveWorkspaceRole(ws?.role ?? null);
    const t = await workspaceApi.content(workspaceId);
    setTree(t);
    setActiveCollectionId(t.collections[0]?.id ?? null);
    setActiveCollectionName(t.collections[0]?.name ?? '');
    setAuthProvider(null);
    if (t.collections[0]) {
      try {
        const { authProvider: p } = await contentApi.getAuthProvider(t.collections[0].id);
        setAuthProvider(p);
      } catch {
        setAuthProvider(null);
      }
    }
  }, [workspaces]);

  const selectCollection = useCallback(async (collectionId: string, collectionName: string) => {
    setActiveCollectionId(collectionId);
    setActiveCollectionName(collectionName);
    setActiveRequest(null);
    setLastRun(null);
    try {
      const { authProvider: p } = await contentApi.getAuthProvider(collectionId);
      setAuthProvider(p);
    } catch {
      setAuthProvider(null);
    }
  }, []);

  const selectRequest = useCallback(async (requestId: string) => {
    setError(null);
    const { request } = await contentApi.getRequest(requestId);
    const editorRequest = toEditorRequest(request);
    setActiveRequest(editorRequest);
    setSavedBaseline(dirtySnapshot(editorRequest));
    setLastRun(null);
  }, []);

  const updateActiveRequest = useCallback((patch: Partial<ApiRequest>) => {
    setActiveRequest((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const saveActiveRequest = useCallback(async () => {
    if (!activeRequest) return;
    await contentApi.updateRequest(activeRequest.id, toServerPatch(activeRequest));
    setSavedBaseline(dirtySnapshot(activeRequest));
    if (tree) {
      const t = { ...tree, requests: tree.requests.map((r) => (r.id === activeRequest.id ? { ...r, name: activeRequest.name, method: activeRequest.method, url: activeRequest.url, api_type: activeRequest.apiType } : r)) };
      setTree(t);
    }
  }, [activeRequest, tree]);

  const runActiveRequest = useCallback(async () => {
    if (!activeRequest) return;
    const result = await contentApi.runRequest(activeRequest.id);
    setLastRun(result);
  }, [activeRequest]);

  const runCollection = useCallback(async (collectionId: string) => {
    setCollectionRunRunning(true);
    setCollectionRun(null);
    try {
      const result = await contentApi.runCollection(collectionId);
      setCollectionRun(result);
      return result;
    } finally {
      setCollectionRunRunning(false);
    }
  }, []);

  const clearCollectionRun = useCallback(() => {
    setCollectionRun(null);
  }, []);

  const createWorkspace = useCallback(async (name: string, visibility?: Workspace['visibility']) => {
    const { workspace } = await workspaceApi.create({ name, visibility });
    const updated = await workspaceApi.list();
    setWorkspaces(updated.workspaces);
    await selectWorkspace(workspace.id);
  }, [selectWorkspace]);

  const createCollection = useCallback(async (name: string) => {
    if (!tree) return;
    const projectId = tree.projects[0]?.id;
    if (!projectId) return;
    const { collection } = await contentApi.createCollection(projectId, name);
    const t = await workspaceApi.content(tree.workspaceId);
    setTree(t);
    await selectCollection(collection.id, collection.name);
  }, [tree, selectCollection]);

  const createRequest = useCallback(async (input: { name: string; method: string; url: string; apiType: ApiType; folderId?: string | null }) => {
    if (!activeCollectionId) return;
    const { request } = await contentApi.createRequest({ collectionId: activeCollectionId, ...input });
    if (tree) {
      setTree({ ...tree, requests: [...tree.requests, request] });
    }
    await selectRequest(request.id);
  }, [activeCollectionId, tree, selectRequest]);

  const createFolder = useCallback(async (input: { name: string; collectionId: string; parentId?: string | null }) => {
    const { folder } = await folderApi.create(input);
    if (tree) {
      setTree({ ...tree, folders: [...tree.folders, folder] });
    }
  }, [tree]);

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    const { folder } = await folderApi.update(folderId, { name });
    if (tree) {
      setTree({
        ...tree,
        folders: tree.folders.map((f) => (f.id === folderId ? { ...f, name: folder.name } : f)),
      });
    }
  }, [tree]);

  const deleteFolder = useCallback(async (folderId: string) => {
    const target = tree?.folders.find((f) => f.id === folderId);
    await folderApi.remove(folderId);
    if (tree) {
      // Cascade: drop the folder and every descendant; requests inside it
      // resurface at the collection root (folder_id -> null).
      const removed = new Set<string>([folderId]);
      const removedIds = new Set<string>(tree.folders.map((f) => f.id));
      const findDescendants = (parentId: string) => {
        for (const f of tree.folders) {
          if (f.parent_id === parentId && removedIds.has(f.id) && !removed.has(f.id)) {
            removed.add(f.id);
            findDescendants(f.id);
          }
        }
      };
      findDescendants(folderId);
      const collectionId = target?.collection_id ?? null;
      setTree({
        ...tree,
        folders: tree.folders.filter((f) => !removed.has(f.id)),
        requests: tree.requests.map((r) =>
          removed.has(r.folder_id as string) ? { ...r, folder_id: null } : r
        ),
      });
      if (collectionId) {
        // Un-select if the active request lived inside the deleted folder.
        const activeInFolder =
          tree.requests.some((r) => r.id === activeRequest?.id && removed.has(r.folder_id as string));
        if (activeInFolder) {
          setActiveRequest(null);
          setLastRun(null);
        }
      }
    }
  }, [tree, activeRequest]);

  const renameRequest = useCallback(async (requestId: string, name: string) => {
    const { request } = await contentApi.updateRequest(requestId, { name });
    if (activeRequest?.id === requestId) {
      setActiveRequest((prev) => (prev ? { ...prev, name } : prev));
    }
    if (tree) {
      setTree({
        ...tree,
        requests: tree.requests.map((r) => (r.id === requestId ? { ...r, name: request.name ?? name } : r)),
      });
    }
  }, [tree, activeRequest]);

  const deleteRequest = useCallback(async (requestId: string) => {
    await contentApi.deleteRequest(requestId);
    setActiveRequest(null);
    setLastRun(null);
    if (tree) {
      setTree({ ...tree, requests: tree.requests.filter((r) => r.id !== requestId) });
    }
  }, [tree]);

  const deleteCollection = useCallback(async (collectionId: string) => {
    await contentApi.deleteCollection(collectionId);
    if (activeCollectionId === collectionId) {
      setActiveCollectionId(null);
      setActiveCollectionName('');
      setAuthProvider(null);
      setActiveRequest(null);
      setLastRun(null);
    }
    if (tree) {
      setTree({
        ...tree,
        collections: tree.collections.filter((c) => c.id !== collectionId),
        folders: tree.folders.filter((f) => f.collection_id !== collectionId),
        requests: tree.requests.filter((r) => r.collection_id !== collectionId),
      });
    }
  }, [tree, activeCollectionId]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    await workspaceApi.remove(workspaceId);
    if (activeWorkspaceId === workspaceId) {
      setActiveWorkspaceId(null);
      setActiveWorkspaceRole(null);
      setTree(null);
      setActiveCollectionId(null);
      setActiveCollectionName('');
      setAuthProvider(null);
      setActiveRequest(null);
      setLastRun(null);
    }
    const updated = await workspaceApi.list();
    setWorkspaces(updated.workspaces);
    if (activeWorkspaceId === workspaceId && updated.workspaces.length > 0) {
      await selectWorkspace(updated.workspaces[0].id);
    }
  }, [activeWorkspaceId, selectWorkspace]);

  const deleteTeam = useCallback(async (teamId: string) => {
    await teamApi.delete(teamId);
    const updated = await teamApi.list();
    setTeams(updated.teams);
  }, []);

  const loadAuthProvider = useCallback(async (collectionId: string) => {
    const { authProvider: p } = await contentApi.getAuthProvider(collectionId);
    setAuthProvider(p);
  }, []);

  const saveAuthProvider = useCallback(async (provider: AuthProvider) => {
    if (!activeCollectionId) return;
    const { authProvider: p } = await contentApi.setAuthProvider(activeCollectionId, provider);
    setAuthProvider(p);
    if (tree) {
      setTree({
        ...tree,
        collections: tree.collections.map((c) =>
          c.id === activeCollectionId ? { ...c, has_auth: p.authType === 'NONE' ? null : p.authType } : c
        ),
      });
    }
  }, [activeCollectionId, tree]);

  const testAuthProvider = useCallback(async () => {
    if (!activeCollectionId) return null;
    const res = await contentApi.testAuthProvider(activeCollectionId);
    return res;
  }, [activeCollectionId]);

  const reloadTree = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const t = await workspaceApi.content(activeWorkspaceId);
    setTree(t);
  }, [activeWorkspaceId]);

  const inviteToTeam = useCallback(async (teamId: string, email: string, role: UserRole) => {
    const { members } = await teamApi.invite(teamId, email, role);
    const updated = await teamApi.list();
    setTeams(updated.teams);
    return members;
  }, []);

  const shareWorkspace = useCallback(async (workspaceId: string, teamId: string, role: UserRole) => {
    await workspaceApi.share(workspaceId, teamId, role);
  }, []);

  const unshareWorkspace = useCallback(async (workspaceId: string, teamId: string) => {
    await workspaceApi.unshare(workspaceId, teamId);
  }, []);

  const isDirty = useMemo(
    () => (activeRequest ? !dirtySnapshotsEqual(dirtySnapshot(activeRequest), savedBaseline) : false),
    [activeRequest, savedBaseline]
  );

  const value = useMemo<WorkspaceState>(
    () => ({
      loading,
      error,
      workspaces,
      teams,
      activeWorkspaceId,
      activeWorkspaceRole,
      tree,
      activeCollectionId,
      activeCollectionName,
      authProvider,
      activeRequest,
      isDirty,
      lastRun,
      collectionRun,
      collectionRunRunning,
      refresh,
      selectWorkspace,
      selectRequest,
      selectCollection,
      updateActiveRequest,
      saveActiveRequest,
      runActiveRequest,
      runCollection,
      clearCollectionRun,
      createWorkspace,
      createCollection,
      createRequest,
      createFolder,
      renameFolder,
      deleteFolder,
      renameRequest,
      deleteRequest,
      deleteCollection,
      deleteWorkspace,
      deleteTeam,
      loadAuthProvider,
      saveAuthProvider,
      testAuthProvider,
      reloadTree,
      inviteToTeam,
      shareWorkspace,
      unshareWorkspace,
    }),
    [
      loading, error, workspaces, teams, activeWorkspaceId, activeWorkspaceRole, tree,
      activeCollectionId, activeCollectionName, authProvider, activeRequest, isDirty, lastRun,
      collectionRun, collectionRunRunning,
      refresh, selectWorkspace, selectRequest, selectCollection, updateActiveRequest,
      saveActiveRequest, runActiveRequest, runCollection, clearCollectionRun,
      createWorkspace, createCollection, createRequest,
      createFolder, renameFolder, deleteFolder, renameRequest,
      deleteRequest, deleteCollection, deleteWorkspace, deleteTeam,
      loadAuthProvider, saveAuthProvider, testAuthProvider, reloadTree, inviteToTeam, shareWorkspace, unshareWorkspace,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
