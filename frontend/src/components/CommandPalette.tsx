'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchApi, type SearchResult } from '@/lib/api';
import { groupLabel, takeTop } from '@/lib/searchPalette';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useNav } from '@/store/NavStore';
import { SearchIcon, XIcon } from './icons';

const SEARCH_LIMIT = 20;
const PER_GROUP_LIMIT = 5;
const DEBOUNCE_MS = 200;

interface ResultGroup {
  type: string;
  rows: SearchResult[];
}

/**
 * Cmd/Ctrl+K global search palette. Results are fetched from `GET /api/search`,
 * grouped by entity type, and keyboard/click navigable. Querying is debounced
 * and every response is stamped with a sequence number so a slow earlier
 * request can never overwrite the results of a newer one.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const nav = useNav();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<Record<string, SearchResult[]>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);

  const orderedGroups = useMemo<ResultGroup[]>(
    () =>
      Object.entries(groups).map(([type, rows]) => ({
        type,
        rows: takeTop(rows, PER_GROUP_LIMIT) as SearchResult[],
      })),
    [groups]
  );
  const flat = useMemo(() => orderedGroups.flatMap((g) => g.rows), [orderedGroups]);

  // Reset query/selection and focus the input every time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setGroups({});
    setActiveIndex(0);
    setLoading(false);
    setErrored(false);
    inputRef.current?.focus();
  }, [open]);

  // Debounced search with out-of-order response protection.
  useEffect(() => {
    const seq = ++seqRef.current;
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setGroups({});
      setActiveIndex(0);
      setLoading(false);
      setErrored(false);
      return;
    }
    setLoading(true);
    setErrored(false);
    // A new query invalidates the previous highlight immediately, so Enter can
    // never open a row from the previous result set while this one loads.
    setActiveIndex(0);
    const timer = setTimeout(() => {
      searchApi
        .query(q, SEARCH_LIMIT)
        .then((res) => {
          if (seq !== seqRef.current) return;
          setGroups(res.groups ?? {});
          setActiveIndex(0);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setGroups({});
          setErrored(true);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query]);

  // Keep the active row in range as results change.
  useEffect(() => {
    setActiveIndex((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)));
  }, [flat.length]);

  const moveActive = (delta: number) => {
    setActiveIndex((i) => {
      if (flat.length === 0) return 0;
      return (i + delta + flat.length) % flat.length;
    });
  };

  const openResult = async (r: SearchResult) => {
    onClose();
    try {
      if (r.type === 'doc') {
        router.push(`/docs?p=${encodeURIComponent(r.id)}`);
        return;
      }
      if (r.type === 'workspace') {
        router.push('/');
        nav.setView('workspace');
        await ws.selectWorkspace(r.id);
        return;
      }
      if (r.type === 'project') {
        router.push('/');
        nav.setView('workspace');
        await ws.selectWorkspace(r.workspaceId!);
        await ws.selectProjectOverview({ id: r.id, name: r.name });
        return;
      }
      if (r.type === 'collection') {
        router.push('/');
        nav.setView('workspace');
        await ws.selectWorkspace(r.workspaceId!);
        await ws.selectCollection(r.id, r.name);
        return;
      }
      if (r.type === 'request') {
        router.push('/');
        nav.setView('workspace');
        await ws.selectWorkspace(r.workspaceId!);
        await ws.selectRequest(r.id);
        return;
      }
      if (r.type === 'folder') {
        router.push('/');
        nav.setView('workspace');
        await ws.selectWorkspace(r.workspaceId!);
        if (r.collectionId) await ws.selectCollection(r.collectionId, r.collectionName ?? '');
        return;
      }
      const route: Record<string, string> = {
        monitor: '/monitors',
        contract: '/contracts',
        mockScenario: '/mock-scenarios',
      };
      if (route[r.type]) router.push(route[r.type]);
    } catch {
      // Navigation failures are non-fatal; the palette is already closed.
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === 'Enter') {
      if (loading) return;
      const r = flat[activeIndex];
      if (r) {
        e.preventDefault();
        void openResult(r);
      }
    }
  };

  if (!open) return null;

  const trimmed = query.trim();
  const showEmpty = trimmed.length > 0 && !loading && flat.length === 0;

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        data-testid="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="command-palette-header">
          <SearchIcon size={15} className="command-palette-search-icon" />
          <input
            ref={inputRef}
            className="command-palette-input"
            data-testid="command-palette-input"
            type="text"
            autoFocus
            placeholder="Search workspaces, collections, requests, docs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
            aria-busy={loading}
          />
          <button
            type="button"
            className="icon-button"
            data-testid="command-palette-close"
            aria-label="Close search"
            onClick={onClose}
          >
            <XIcon size={15} />
          </button>
        </div>
        <div className="command-palette-results">
          {loading && (
            <p className="command-palette-empty" data-testid="command-palette-loading">
              Searching…
            </p>
          )}
          {showEmpty ? (
            <p className="command-palette-empty" data-testid="command-palette-empty">
              {errored ? 'Search failed. Try again.' : `No results for "${trimmed}".`}
            </p>
          ) : (
            orderedGroups.map((g) => (
              <div className="command-palette-group" key={g.type}>
                <div className="command-palette-group-label">{groupLabel(g.type)}</div>
                {g.rows.map((r) => {
                  const index = flat.indexOf(r);
                  const active = index === activeIndex;
                  return (
                    <button
                      type="button"
                      key={`${r.type}-${r.id}`}
                      className={`command-result${active ? ' command-result-active' : ''}`}
                      data-testid={`command-result-${r.type}-${r.id}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void openResult(r)}
                    >
                      <span className="command-result-main">
                        <span className="command-result-name">{r.name}</span>
                        {r.subtitle && <span className="command-result-subtitle">{r.subtitle}</span>}
                      </span>
                      {r.method && <span className="command-result-badge">{r.method}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
