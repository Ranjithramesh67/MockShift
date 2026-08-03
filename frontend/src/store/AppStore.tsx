'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { AppState, ApiRequest, MockResponse, ViewMode, Workflow } from '@/lib/types';
import { defaultState, makeId } from '@/lib/defaultState';

const STORAGE_KEY = 'apihub.state.v1';

type Action =
  | { type: 'SET_TAB'; tab: AppState['activeTab'] }
  | { type: 'SET_REQUEST_TAB'; tab: AppState['activeRequestTab'] }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'SELECT_REQUEST'; id: string }
  | { type: 'UPSERT_REQUEST'; request: ApiRequest }
  | { type: 'IMPORT_REQUEST'; request: ApiRequest }
  | { type: 'DELETE_REQUEST'; id: string }
  | { type: 'SELECT_WORKFLOW'; id: string }
  | { type: 'SAVE_WORKFLOW'; workflow: Workflow }
  | { type: 'SET_RESPONSE'; response: MockResponse | null }
  | { type: 'SHOW_TOAST'; kind: 'success' | 'error' | 'info'; message: string }
  | { type: 'DISMISS_TOAST' };

function loadInitialState(): AppState {
  if (typeof window === 'undefined') return defaultState() as AppState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState() as AppState;
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed } as AppState;
  } catch {
    return defaultState() as AppState;
  }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'SET_REQUEST_TAB':
      return { ...state, activeRequestTab: action.tab };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };
    case 'SELECT_REQUEST':
      return { ...state, activeRequestId: action.id, activeTab: 'request' };
    case 'UPSERT_REQUEST': {
      const exists = state.requests.some((r) => r.id === action.request.id);
      const requests = exists
        ? state.requests.map((r) => (r.id === action.request.id ? action.request : r))
        : [...state.requests, action.request];
      return { ...state, requests, activeRequestId: action.request.id, activeTab: 'request' };
    }
    case 'IMPORT_REQUEST':
      return {
        ...state,
        requests: [...state.requests, action.request],
        activeRequestId: action.request.id,
        activeTab: 'request',
      };
    case 'DELETE_REQUEST':
      return {
        ...state,
        requests: state.requests.filter((r) => r.id !== action.id),
        activeRequestId:
          state.activeRequestId === action.id ? state.requests[0]?.id ?? '' : state.activeRequestId,
      };
    case 'SELECT_WORKFLOW':
      return { ...state, activeWorkflowId: action.id, activeTab: 'workflow' };
    case 'SAVE_WORKFLOW': {
      const exists = state.workflows.some((w) => w.id === action.workflow.id);
      const workflows = exists
        ? state.workflows.map((w) => (w.id === action.workflow.id ? action.workflow : w))
        : [...state.workflows, action.workflow];
      return { ...state, workflows, activeWorkflowId: action.workflow.id };
    }
    case 'SET_RESPONSE':
      return { ...state, lastResponse: action.response };
    case 'SHOW_TOAST':
      return { ...state, toast: { id: Date.now(), kind: action.kind, message: action.message } };
    case 'DISMISS_TOAST':
      return { ...state, toast: null };
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage may be unavailable (private mode); persist best-effort.
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export { makeId };
