'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import type { ApiRequest, Assertion, BodyFormPart, BodyType, RequestContentType } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { openTab, closeTab, insertTab } from '@/lib/tabs';
import {
  normalizeParts,
  seedPartsFromLegacy,
  stripTransportData,
  readFileAsBase64,
} from '@/lib/multipartParts';

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
  bodyParts?: BodyFormPart[];
  apiType?: ApiType;
  formula?: string;
  assertions?: Assertion[];
}): ApiRequest {
  const isMultipart = (d.bodyType || 'NONE') === 'MULTIPART';
  let bodyJson: string | null = null;
  if (!isMultipart) {
    if (d.bodyJson !== undefined && d.bodyJson !== null) {
      bodyJson = typeof d.bodyJson === 'string' ? d.bodyJson : JSON.stringify(d.bodyJson, null, 2);
    } else if (d.bodyText) {
      bodyJson = d.bodyText;
    }
  }
  let bodyParts = normalizeParts(d.bodyParts);
  if (isMultipart && bodyParts.length === 0 && typeof d.bodyText === 'string' && d.bodyText.length > 0) {
    bodyParts = seedPartsFromLegacy(d.bodyText);
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
    bodyParts,
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
  } else if (r.bodyType === 'MULTIPART') {
    patch.bodyParts = stripTransportData(r.bodyParts ?? []);
    patch.bodyJson = null;
    patch.bodyText = null;
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
  'bodyParts',
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
  requestRuns: Record<string, RunResult | null>;
  collectionRun: CollectionRunResult | null;
  collectionRunRunning: boolean;
  requestRunning: boolean;
  selectedFiles: Record<string, Record<string, File>>;
  setFileForPart: (requestId: string, partId: string, file: File | null) => void;

  openRequestIds: string[];
  activeRequestId: string | null;
  requestCopies: Record<string, ApiRequest>;
  activateRequestTab: (requestId: string) => Promise<void>;
  closeRequestTab: (requestId: string) => Promise<void>;
  reopenLastClosedTab: () => Promise<void>;
  isTabDirty: (requestId: string) => boolean;

  refresh: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  selectRequest: (requestId: string) => Promise<void>;
  selectCollection: (collectionId: string, collectionName: string) => Promise<void>;
  updateActiveRequest: (patch: Partial<ApiRequest>) => void;
  saveActiveRequest: () => Promise<void>;
  runActiveRequest: () => Promise<void>;
  runScratchpad: (input: {
    method: string;
    url: string;
    headers?: Array<{ key: string; value: string; enabled: boolean }>;
    queryParams?: Array<{ key: string; value: string; enabled: boolean }>;
    bodyType?: string;
    bodyJson?: unknown;
    bodyText?: string | null;
    bodyParts?: BodyFormPart[];
    formula?: string;
    assertions?: Assertion[];
    apiType?: ApiType;
  }) => Promise<void>;
  runCollection: (collectionId: string) => Promise<CollectionRunResult>;
  clearCollectionRun: () => void;
  clearScratchpadRun: () => void;

  createWorkspace: (name: string, visibility?: Workspace['visibility']) => Promise<void>;
  createCollection: (name: string) => Promise<void>;
  createRequest: (input: { name: string; method: string; url: string; apiType: ApiType; folderId?: string | null }) => Promise<void>;
  createFolder: (input: { name: string; collectionId: string; parentId?: string | null }) => Promise<void>;
  renameFolder: (folderId: string, name: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  renameRequest: (requestId: string, name: string) => Promise<void>;
  moveRequest: (requestId: string, folderId: string | null) => Promise<void>;
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  duplicateRequest: (requestId: string) => Promise<void>;
  duplicateFolder: (folderId: string) => Promise<void>;

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
  const [openRequestIds, setOpenRequestIds] = useState<string[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [requestCopies, setRequestCopies] = useState<Record<string, ApiRequest>>({});
  const [baselines, setBaselines] = useState<Record<string, unknown[]>>({});
  const [closedTabs, setClosedTabs] = useState<
    Array<{ requestId: string; index: number; request: ApiRequest; baseline: unknown[] | null }>
  >([]);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  // Last executed response per request id, kept in memory for the lifetime of
  // the page so closing a tab (Ctrl+Q) and reopening it (Ctrl+Shift+Q) or
  // switching back to it restores the previous response instead of dropping it.
  const [requestRuns, setRequestRuns] = useState<Record<string, RunResult | null>>({});
  const [collectionRun, setCollectionRun] = useState<CollectionRunResult | null>(null);
  const [collectionRunRunning, setCollectionRunRunning] = useState(false);
  // True while a single request (saved, working copy or scratchpad) is being
  // executed through the run pipeline — drives the send/execution loader.
  const [requestRunning, setRequestRunning] = useState(false);
  // Picked browser File objects for multipart file parts, keyed by request id
  // then part id. Files are never part of ApiRequest or the DB — they live here
  // in memory so they survive tab switches and are re-read at send time.
  const [selectedFiles, setSelectedFiles] = useState<Record<string, Record<string, File>>>({});
  const requestRunningRef = useRef(false);
  // Guards selectRequest against out-of-order responses: each selection bumps
  // the sequence and records the target id; a fetch that resolves after a newer
  // click (or a workspace/collection switch) is dropped instead of overwriting
  // the active request with a stale one.
  const selectSeqRef = useRef(0);
  const selectTargetRef = useRef<string | null>(null);

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

  // Keep the last-seen working copy of every open request so unsaved edits
  // survive tab switches. Runs on every activeRequest change.
  useEffect(() => {
    if (!activeRequest) return;
    setRequestCopies((copies) => ({ ...copies, [activeRequest.id]: activeRequest }));
  }, [activeRequest]);

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    setError(null);
    selectSeqRef.current += 1; // invalidate any in-flight request selection
    setActiveWorkspaceId(workspaceId);
    setActiveRequest(null);
    setActiveRequestId(null);
    setOpenRequestIds([]);
    setRequestCopies({});
    setBaselines({});
    setClosedTabs([]);
    setLastRun(null);
    setRequestRuns({});
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
    selectSeqRef.current += 1; // invalidate any in-flight request selection
    setActiveCollectionId(collectionId);
    setActiveCollectionName(collectionName);
    setActiveRequest(null);
    setActiveRequestId(null);
    setOpenRequestIds([]);
    setRequestCopies({});
    setBaselines({});
    setClosedTabs([]);
    setLastRun(null);
    setRequestRuns({});
    try {
      const { authProvider: p } = await contentApi.getAuthProvider(collectionId);
      setAuthProvider(p);
    } catch {
      setAuthProvider(null);
    }
  }, []);

  const selectRequest = useCallback(async (requestId: string) => {
    setError(null);
    // Record this selection as the latest intent; any earlier in-flight fetch
    // that resolves afterwards will be discarded below.
    const seq = ++selectSeqRef.current;
    selectTargetRef.current = requestId;
    // Restore the last stored response for this request if one exists.
    setLastRun(requestRuns[requestId] ?? null);
    if (openRequestIds.includes(requestId)) {
      // Already open: switch to it without refetching so the working copy
      // (with any unsaved edits) is restored.
      setActiveRequestId(requestId);
      const copy = requestCopies[requestId];
      if (copy) {
        setActiveRequest(copy);
        return;
      }
      // Fallback: open tab without a cached copy (should not happen normally).
    }
    const { request } = await contentApi.getRequest(requestId);
    if (selectSeqRef.current !== seq || selectTargetRef.current !== requestId) {
      // A newer sidebar/tab click (or workspace/collection switch) superseded
      // this selection — drop the stale response rather than clobbering the
      // request the user actually clicked last.
      return;
    }
    const editorRequest = toEditorRequest(request);
    setActiveRequest(editorRequest);
    setRequestCopies((c) => ({ ...c, [requestId]: editorRequest }));
    setBaselines((b) => ({ ...b, [requestId]: dirtySnapshot(editorRequest) }));
    setOpenRequestIds((ids) => openTab(ids, requestId));
    setActiveRequestId(requestId);
  }, [openRequestIds, requestCopies, requestRuns]);

  const updateActiveRequest = useCallback((patch: Partial<ApiRequest>) => {
    setActiveRequest((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const setFileForPart = useCallback((requestId: string, partId: string, file: File | null) => {
    setSelectedFiles((prev) => {
      if (!file) {
        const requestMap = prev[requestId];
        if (!requestMap) return prev;
        const nextRequestMap = { ...requestMap };
        delete nextRequestMap[partId];
        const next = { ...prev, [requestId]: nextRequestMap };
        if (Object.keys(nextRequestMap).length === 0) delete next[requestId];
        return next;
      }
      return { ...prev, [requestId]: { ...(prev[requestId] ?? {}), [partId]: file } };
    });
  }, []);

  const saveActiveRequest = useCallback(async () => {
    if (!activeRequest) return;
    await contentApi.updateRequest(activeRequest.id, toServerPatch(activeRequest));
    setBaselines((b) => ({ ...b, [activeRequest.id]: dirtySnapshot(activeRequest) }));
    if (tree) {
      const t = { ...tree, requests: tree.requests.map((r) => (r.id === activeRequest.id ? { ...r, name: activeRequest.name, method: activeRequest.method, url: activeRequest.url, api_type: activeRequest.apiType } : r)) };
      setTree(t);
    }
  }, [activeRequest, tree]);

  const isDirty = useMemo(
    () =>
      activeRequest
        ? !dirtySnapshotsEqual(dirtySnapshot(activeRequest), baselines[activeRequest.id] ?? null)
        : false,
    [activeRequest, baselines]
  );

  const activateRequestTab = useCallback(
    async (requestId: string) => {
      if (requestId === activeRequestId) return;
      setLastRun(requestRuns[requestId] ?? null);
      const copy = requestCopies[requestId];
      if (copy) {
        setActiveRequestId(requestId);
        setActiveRequest(copy);
        return;
      }
      await selectRequest(requestId);
    },
    [activeRequestId, requestCopies, requestRuns, selectRequest]
  );

  const closeRequestTab = useCallback(
    async (requestId: string, recordUndo = true) => {
      const idx = openRequestIds.indexOf(requestId);
      const { ids, nextActiveId } = closeTab(openRequestIds, activeRequestId, requestId);
      if (recordUndo) {
        const copy = requestCopies[requestId];
        if (copy) {
          setClosedTabs((stack) => [
            { requestId, index: idx, request: copy, baseline: baselines[requestId] ?? null },
            ...stack,
          ]);
        }
      }
      setOpenRequestIds(ids);
      setRequestCopies((c) => {
        const next = { ...c };
        delete next[requestId];
        return next;
      });
      setBaselines((b) => {
        const next = { ...b };
        delete next[requestId];
        return next;
      });
      // Drop any in-memory picked multipart files for this request so they are
      // not resurrected if the tab is re-opened for a different request.
      setSelectedFiles((prev) => {
        if (!(requestId in prev)) return prev;
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      if (nextActiveId === activeRequestId) return;
      if (nextActiveId === null) {
        setActiveRequestId(null);
        setActiveRequest(null);
        setLastRun(null);
        return;
      }
      const neighbourCopy = requestCopies[nextActiveId];
      if (neighbourCopy) {
        setActiveRequestId(nextActiveId);
        setActiveRequest(neighbourCopy);
        setLastRun(requestRuns[nextActiveId] ?? null);
        return;
      }
      setActiveRequestId(nextActiveId);
      await selectRequest(nextActiveId);
    },
    [openRequestIds, activeRequestId, requestCopies, requestRuns, baselines, selectRequest]
  );

  // Ctrl+Shift+Q: undo the last tab close — restore its working copy (including
  // any unsaved edits) at its original position in the strip.
  const reopenLastClosedTab = useCallback(async () => {
    const top = closedTabs[0];
    if (!top) return;
    setClosedTabs((stack) => stack.slice(1));
    setOpenRequestIds((ids) => insertTab(ids, top.requestId, top.index));
    setRequestCopies((c) => ({ ...c, [top.requestId]: top.request }));
    setBaselines((b) => {
      if (top.baseline === null) {
        const next = { ...b };
        delete next[top.requestId];
        return next;
      }
      return { ...b, [top.requestId]: top.baseline };
    });
    setActiveRequestId(top.requestId);
    setActiveRequest(top.request);
    // Restore the response that was shown when the tab was closed (kept in
    // requestRuns for the lifetime of the page).
    setLastRun(requestRuns[top.requestId] ?? null);
  }, [closedTabs, requestRuns]);

  const isTabDirty = useCallback(
    (requestId: string) => {
      const copy = requestCopies[requestId];
      if (!copy) return false;
      return !dirtySnapshotsEqual(dirtySnapshot(copy), baselines[requestId] ?? null);
    },
    [requestCopies, baselines]
  );

  const runActiveRequest = useCallback(async () => {
    if (!activeRequest) return;
    if (requestRunningRef.current) return;
    requestRunningRef.current = true;
    setRequestRunning(true);
    try {
      const req = activeRequest;
      const parts = req.bodyParts ?? [];
      const enabledFileParts = parts.filter((p) => p.enabled !== false && p.key && p.kind === 'file');
      let result: RunResult;
      if (req.bodyType === 'MULTIPART' && enabledFileParts.length > 0) {
        // Multipart with file parts: pick the in-memory File per part and embed
        // the bytes (base64) into the run payload only — never persisted.
        const files = selectedFiles[req.id] ?? {};
        for (const p of enabledFileParts) {
          if (!files[p.id]) {
            throw new Error(`Select a file for multipart part "${p.key}" before sending.`);
          }
        }
        const transportParts: BodyFormPart[] = [];
        for (const p of parts) {
          if (p.enabled === false) {
            transportParts.push({ ...p });
            continue;
          }
          if (p.kind === 'file') {
            const file = files[p.id]!;
            const data = await readFileAsBase64(file);
            transportParts.push({
              ...p,
              fileName: file.name,
              fileType: file.type || 'application/octet-stream',
              fileSize: file.size,
              data,
            });
          } else {
            transportParts.push({ ...p });
          }
        }
        result = await contentApi.runEphemeral({
          method: req.method,
          url: req.url,
          headers: req.headers,
          queryParams: req.queryParams,
          bodyType: 'MULTIPART',
          bodyJson: null,
          bodyParts: transportParts,
          formula: req.formula,
          assertions: req.assertions,
          apiType: req.apiType,
          collectionId: activeCollectionId,
          id: req.id,
          persistHistory: !isDirty,
        });
      } else if (isDirty) {
        result = await contentApi.runEphemeral({
          method: activeRequest.method,
          url: activeRequest.url,
          headers: activeRequest.headers,
          queryParams: activeRequest.queryParams,
          bodyType: activeRequest.bodyType,
          bodyJson: activeRequest.bodyJson,
          bodyParts:
            activeRequest.bodyType === 'MULTIPART'
              ? stripTransportData(activeRequest.bodyParts ?? [])
              : [],
          formula: activeRequest.formula,
          assertions: activeRequest.assertions,
          apiType: activeRequest.apiType,
          collectionId: activeCollectionId,
          persistHistory: false,
        });
      } else {
        result = await contentApi.runRequest(activeRequest.id);
      }
      setLastRun(result);
      // Keep the response for this request in memory so it can be restored when
      // the tab is closed and reopened (Ctrl+Q / Ctrl+Shift+Q) or switched to.
      setRequestRuns((runs) => ({ ...runs, [activeRequest.id]: result }));
    } finally {
      requestRunningRef.current = false;
      setRequestRunning(false);
    }
  }, [activeRequest, isDirty, activeCollectionId, selectedFiles]);

  // M8: scratchpad — execute an in-memory request shape (e.g. a pasted cURL)
  // via POST /api/runs without creating or saving a request. No history row.
  const runScratchpad = useCallback(
    async (input: {
      method: string;
      url: string;
      headers?: Array<{ key: string; value: string; enabled: boolean }>;
      queryParams?: Array<{ key: string; value: string; enabled: boolean }>;
      bodyType?: string;
      bodyJson?: unknown;
      bodyText?: string | null;
      bodyParts?: BodyFormPart[];
      formula?: string;
      assertions?: Assertion[];
      apiType?: ApiType;
    }) => {
      setError(null);
      setLastRun(null);
      if (requestRunningRef.current) return;
      requestRunningRef.current = true;
      setRequestRunning(true);
      try {
        const result = await contentApi.runEphemeral({
          ...input,
          collectionId: activeCollectionId,
          persistHistory: false,
        });
        setLastRun(result);
      } finally {
        requestRunningRef.current = false;
        setRequestRunning(false);
      }
    },
    [activeCollectionId]
  );

  const clearScratchpadRun = useCallback(() => {
    setLastRun(null);
  }, []);

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
        // Close tabs for requests that lived inside the deleted folder(s).
        const affectedIds = openRequestIds.filter((id) => {
          const r = tree.requests.find((x) => x.id === id);
          return r ? removed.has(r.folder_id as string) : false;
        });
        for (const id of affectedIds) {
          await closeRequestTab(id, false);
        }
      }
    }
  }, [tree, openRequestIds, closeRequestTab]);

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

  const moveRequest = useCallback(async (requestId: string, folderId: string | null) => {
    await contentApi.updateRequest(requestId, { folderId });
    if (tree) {
      setTree({
        ...tree,
        requests: tree.requests.map((r) => (r.id === requestId ? { ...r, folder_id: folderId } : r)),
      });
    }
  }, [tree]);

  const moveFolder = useCallback(async (folderId: string, parentId: string | null) => {
    await folderApi.update(folderId, { parentId });
    if (tree) {
      setTree({
        ...tree,
        folders: tree.folders.map((f) => (f.id === folderId ? { ...f, parent_id: parentId } : f)),
      });
    }
  }, [tree]);

  const duplicateRequest = useCallback(async (requestId: string) => {
    const { request } = await contentApi.duplicateRequest(requestId);
    if (tree) {
      const exists = tree.requests.some((r) => r.id === request.id);
      setTree({ ...tree, requests: exists ? tree.requests : [...tree.requests, request] });
    }
  }, [tree]);

  const duplicateFolder = useCallback(async (folderId: string) => {
    const { folders, requests } = await contentApi.duplicateFolder(folderId);
    if (tree) {
      const folderIds = new Set(tree.folders.map((f) => f.id));
      const requestIds = new Set(tree.requests.map((r) => r.id));
      setTree({
        ...tree,
        folders: [...tree.folders, ...folders.filter((f) => !folderIds.has(f.id))],
        requests: [...tree.requests, ...requests.filter((r) => !requestIds.has(r.id))],
      });
    }
  }, [tree]);

  const deleteRequest = useCallback(async (requestId: string) => {
    selectSeqRef.current += 1; // invalidate any in-flight selection of this request
    await contentApi.deleteRequest(requestId);
    await closeRequestTab(requestId, false);
    setRequestRuns((runs) => {
      const next = { ...runs };
      delete next[requestId];
      return next;
    });
    setSelectedFiles((prev) => {
      if (!(requestId in prev)) return prev;
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    if (tree) {
      setTree({ ...tree, requests: tree.requests.filter((r) => r.id !== requestId) });
    }
  }, [tree, closeRequestTab]);

  const deleteCollection = useCallback(async (collectionId: string) => {
    selectSeqRef.current += 1; // invalidate any in-flight request selection
    await contentApi.deleteCollection(collectionId);
    // Close tabs for requests that belonged to the deleted collection.
    const affectedIds = openRequestIds.filter((id) => {
      const r = tree?.requests.find((x) => x.id === id);
      return r ? r.collection_id === collectionId : false;
    });
    for (const id of affectedIds) {
      await closeRequestTab(id, false);
    }
    setRequestRuns((runs) => {
      const next = { ...runs };
      for (const r of tree?.requests ?? []) {
        if (r.collection_id === collectionId) delete next[r.id];
      }
      return next;
    });
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
  }, [tree, activeCollectionId, openRequestIds, closeRequestTab]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    selectSeqRef.current += 1; // invalidate any in-flight request selection
    await workspaceApi.remove(workspaceId);
    if (activeWorkspaceId === workspaceId) {
      setActiveWorkspaceId(null);
      setActiveWorkspaceRole(null);
      setTree(null);
      setActiveCollectionId(null);
      setActiveCollectionName('');
      setAuthProvider(null);
      setActiveRequest(null);
      setActiveRequestId(null);
      setOpenRequestIds([]);
      setRequestCopies({});
      setBaselines({});
      setClosedTabs([]);
      setLastRun(null);
      setRequestRuns({});
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
      requestRuns,
      collectionRun,
      collectionRunRunning,
      requestRunning,
      selectedFiles,
      setFileForPart,
      openRequestIds,
      activeRequestId,
      requestCopies,
      activateRequestTab,
      closeRequestTab,
      reopenLastClosedTab,
      isTabDirty,
      refresh,
      selectWorkspace,
      selectRequest,
      selectCollection,
      updateActiveRequest,
      saveActiveRequest,
      runActiveRequest,
      runScratchpad,
      runCollection,
      clearCollectionRun,
      clearScratchpadRun,
      createWorkspace,
      createCollection,
      createRequest,
      createFolder,
      renameFolder,
      deleteFolder,
      renameRequest,
      moveRequest,
      moveFolder,
      duplicateRequest,
      duplicateFolder,
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
      requestRuns,
      collectionRun, collectionRunRunning, requestRunning, selectedFiles, setFileForPart,
      openRequestIds, activeRequestId, requestCopies,
      activateRequestTab, closeRequestTab, reopenLastClosedTab, isTabDirty,
      refresh, selectWorkspace, selectRequest, selectCollection, updateActiveRequest,
      saveActiveRequest, runActiveRequest, runScratchpad, runCollection, clearCollectionRun, clearScratchpadRun,
      createWorkspace, createCollection, createRequest,
      createFolder, renameFolder, deleteFolder, renameRequest, moveRequest, moveFolder, duplicateRequest, duplicateFolder,
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
