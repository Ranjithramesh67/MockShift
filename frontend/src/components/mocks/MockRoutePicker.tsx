'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { HttpMethod } from '@/lib/types';
import type { MockRoute } from '@/lib/api';
import { mockRequestBaseUrl } from '@/lib/mockServer';
import { filterMockRoutes, mockRouteUrl } from '@/lib/mockRoutes';
import { useProjectMockRoutes } from './useProjectMockRoutes';
import styles from './mocks.module.css';

export interface MockRoutePick {
  method?: HttpMethod;
  url: string;
}

export function MockRoutePicker({
  projectId,
  disabled,
  onPick,
}: {
  projectId: string;
  disabled?: boolean;
  onPick: (pick: MockRoutePick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { server, routes, loading, error } = useProjectMockRoutes(projectId, open);

  const visible = useMemo<MockRoute[]>(
    () => filterMockRoutes(routes, query) as MockRoute[],
    [routes, query]
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setHighlight(0), [query, open]);

  const choose = (index: number) => {
    const route = visible[index];
    if (!route) return;
    onPick({
      method: route.method === '*' ? undefined : (route.method as HttpMethod),
      url: mockRouteUrl(mockRequestBaseUrl(projectId), route.path),
    });
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(highlight);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const noServer = !loading && !server;

  return (
    <div className={styles.picker} ref={boxRef}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        data-testid="mock-route-picker-open"
        disabled={disabled || !projectId}
        onClick={() => setOpen((value) => !value)}
        title="Pick a mock server route to fill the method and URL"
      >
        Mock route
      </button>
      {open ? (
        <div className={styles.pickerPop} role="listbox" data-testid="mock-route-picker-pop">
          {noServer ? (
            <p className={styles.pickerEmpty}>
              This project has no mock server. Create one in Mock server, then come back.
            </p>
          ) : (
            <>
              <input
                autoFocus
                className={styles.input}
                placeholder="Search routes (e.g. users, POST)"
                aria-label="Search mock routes"
                data-testid="mock-route-picker-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
              />
              {loading ? <p className={styles.pickerEmpty}>Loading…</p> : null}
              {error ? <p className={styles.pickerEmpty}>{error}</p> : null}
              {!loading && !error && visible.length === 0 ? (
                <p className={styles.pickerEmpty}>No routes match “{query}”.</p>
              ) : null}
              <ul className={styles.pickerList}>
                {visible.map((route, index) => (
                  <li key={route.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      className={`${styles.pickerOption} ${index === highlight ? styles.pickerOptionActive : ''}`}
                      data-testid={`mock-route-picker-option-${index}`}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(index)}
                    >
                      <span className={styles.pickerMethod}>{route.method}</span>
                      <code className={styles.pickerPath}>{route.path}</code>
                      <span className={styles.pickerStatus}>{route.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
