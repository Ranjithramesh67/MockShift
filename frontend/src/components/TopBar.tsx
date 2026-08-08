'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/store/AppStore';
import type { ViewMode } from '@/lib/types';
import { notificationApi, type Notification } from '@/lib/api';
import {
  ImportIcon,
  LayoutIcon,
  ResponsePaneIcon,
  RequestPaneIcon,
  SplitIcon,
  LogoutIcon,
  XIcon,
  BellIcon,
  ChevronIcon,
  CheckIcon,
} from './icons';

const VIEW_OPTIONS: Array<{ id: ViewMode; label: string; title: string; icon: typeof LayoutIcon }> = [
  { id: 'side', label: 'Side by side', title: 'Request on the left, response on the right', icon: LayoutIcon },
  { id: 'split', label: 'Split', title: 'Request on top, response below', icon: SplitIcon },
  { id: 'request', label: 'Request only', title: 'Request pane only', icon: RequestPaneIcon },
  { id: 'response', label: 'Response only', title: 'Response pane only', icon: ResponsePaneIcon },
];

function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const bellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const load = () => {
    if (!user) return;
    notificationApi
      .list()
      .then((res) => {
        setNotifications(res.notifications);
        setUnread(res.notifications.filter((n) => !n.read).length);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const markRead = async (id: string) => {
    await notificationApi.markRead(id).catch(() => undefined);
    load();
  };

  const markAll = async () => {
    await notificationApi.readAll().catch(() => undefined);
    load();
  };

  return (
    <div className="bell-wrap" ref={bellRef}>
      <button
        type="button"
        className="ghost-button icon-only"
        data-testid="notification-bell"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <BellIcon size={15} />
        {unread > 0 && <span className="bell-badge" data-testid="notification-unread">{unread}</span>}
      </button>
      {open && (
        <div className="bell-dropdown" data-testid="notification-dropdown">
          <div className="bell-header">
            <span>Notifications</span>
            {unread > 0 && (
              <button type="button" className="ghost-button small" data-testid="notification-read-all" onClick={markAll}>
                <CheckIcon size={12} />
                Mark all read
              </button>
            )}
          </div>
          <div className="bell-list">
            {notifications.length === 0 && <p className="hint">No notifications yet.</p>}
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`bell-item ${n.read ? '' : 'unread'}`}
                data-testid="notification-item"
                onClick={() => {
                  if (!n.read) markRead(n.id);
                }}
              >
                <div className="bell-title">
                  <span className={`bell-kind bell-kind-${n.kind}`} />
                  {n.title}
                </div>
                {n.body && <div className="bell-body">{n.body}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar({ onOpenCurl }: { onOpenCurl: () => void }) {
  const { user, logout } = useAuth();
  const { state, dispatch } = useApp();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node)) setViewsOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const onLogout = async () => {
    setMenuOpen(false);
    await logout();
    router.replace('/login');
  };

  const activeView = VIEW_OPTIONS.find((v) => v.id === state.viewMode) ?? VIEW_OPTIONS[0];
  const ActiveIcon = activeView.icon;

  return (
    <header className="top-bar" data-testid="top-bar">
      <div className="brand">
        <span className="brand-mark">AH</span>
        <span className="brand-name">API Hub</span>
        <span className="brand-env">
          {state.activeTab === 'request' ? 'Request Studio' : 'Workflow Builder'}
        </span>
      </div>
      <div className="top-bar-actions">
        <div className="views-menu" ref={viewsRef} data-testid="views-menu">
          <button
            type="button"
            className="ghost-button"
            data-testid="views-menu-button"
            aria-label="Change view"
            aria-expanded={viewsOpen}
            onClick={() => setViewsOpen((v) => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ActiveIcon size={14} />
            <span>{activeView.label}</span>
            <ChevronIcon size={12} />
          </button>
          {viewsOpen && (
            <div className="views-dropdown" data-testid="views-dropdown">
              {VIEW_OPTIONS.map((v) => (
                <button
                  type="button"
                  key={v.id}
                  className={`view-option ${state.viewMode === v.id ? 'active' : ''}`}
                  data-testid={`view-${v.id}`}
                  title={v.title}
                  onClick={() => {
                    dispatch({ type: 'SET_VIEW_MODE', mode: v.id });
                    setViewsOpen(false);
                  }}
                >
                  <v.icon size={14} />
                  <span>{v.label}</span>
                  {state.viewMode === v.id && <CheckIcon size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="ghost-button"
          data-testid="topbar-import-curl"
          onClick={onOpenCurl}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <ImportIcon size={14} />
          Import cURL
        </button>
        <NotificationBell />
        <div className="user-menu">
          <button
            type="button"
            className="user-chip"
            data-testid="user-menu"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
          >
            <span className="user-avatar">{user?.name?.charAt(0).toUpperCase() ?? '?'}</span>
            <span className="user-name">{user?.name}</span>
            <span className="role-badge">{user?.role}</span>
          </button>
          {menuOpen && (
            <div className="user-dropdown" data-testid="user-dropdown">
              <div className="user-dropdown-email">{user?.email}</div>
              <button
                type="button"
                className="ghost-button"
                data-testid="logout-button"
                onClick={onLogout}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <LogoutIcon size={14} />
                Sign out
              </button>
              <button
                type="button"
                className="ghost-button small danger-text"
                onClick={() => setMenuOpen(false)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <XIcon size={14} />
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
