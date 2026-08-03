'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/store/AppStore';
import type { ViewMode } from '@/lib/types';

const VIEW_OPTIONS: Array<{ id: ViewMode; label: string; title: string }> = [
  { id: 'side', label: 'Side by side', title: 'Request on the left, response on the right' },
  { id: 'split', label: 'Split', title: 'Request on top, response below' },
  { id: 'request', label: 'Request', title: 'Request pane only' },
  { id: 'response', label: 'Response', title: 'Response pane only' },
];

export function TopBar({ onOpenCurl }: { onOpenCurl: () => void }) {
  const { user, logout } = useAuth();
  const { state, dispatch } = useApp();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const onLogout = async () => {
    setMenuOpen(false);
    await logout();
    router.replace('/login');
  };

  return (
    <header className="top-bar" data-testid="top-bar">
      <div className="brand">
        <span className="brand-mark">AH</span>
        <span className="brand-name">API Hub</span>
        <span className="brand-env">{state.activeTab === 'request' ? 'Request Studio' : 'Workflow Builder'}</span>
      </div>
      <div className="top-bar-actions">
        <div className="view-modifier" role="group" aria-label="View modifier" data-testid="view-modifier">
          {VIEW_OPTIONS.map((v) => (
            <button
              type="button"
              key={v.id}
              className={`view-option ${state.viewMode === v.id ? 'active' : ''}`}
              data-testid={`view-${v.id}`}
              title={v.title}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" className="ghost-button" data-testid="topbar-import-curl" onClick={onOpenCurl}>
          Import cURL
        </button>
        <div className="user-menu">
          {user?.role === 'ADMIN' && (
            <Link href="/admin" className="ghost-button" data-testid="admin-link">
              Admin
            </Link>
          )}
          <button
            type="button"
            className="user-chip"
            data-testid="user-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="user-avatar">{user?.name?.charAt(0).toUpperCase() ?? '?'}</span>
            <span className="user-name">{user?.name}</span>
            <span className="role-badge">{user?.role}</span>
          </button>
          {menuOpen && (
            <div className="user-dropdown" data-testid="user-dropdown">
              <div className="user-dropdown-email">{user?.email}</div>
              <button type="button" className="ghost-button" data-testid="logout-button" onClick={onLogout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
