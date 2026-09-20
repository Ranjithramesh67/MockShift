'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/lib/profile';
import { subscriptionChip } from '@/lib/subscription';
import { useApp } from '@/store/AppStore';
import type { ViewMode } from '@/lib/types';
import { notificationApi, type Notification } from '@/lib/api';
import { roomFor } from '@/lib/realtime';
import { useRoomEvents } from './useRoomEvents';
import { UserAvatar } from './UserAvatar';
import { ProjectSwitcher } from './ProjectSwitcher';
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
  PlayIcon,
  MenuIcon,
  UserIcon,
  KeyIcon,
  SendIcon,
  SearchIcon,
  MaximizeIcon,
  MinimizeIcon,
} from './icons';

const VIEW_OPTIONS: Array<{ id: ViewMode; label: string; title: string; icon: typeof LayoutIcon }> = [
  { id: 'side', label: 'Side by side', title: 'Request on the left, response on the right', icon: LayoutIcon },
  { id: 'split', label: 'Split', title: 'Request on top, response below', icon: SplitIcon },
  { id: 'request', label: 'Request only', title: 'Request pane only', icon: RequestPaneIcon },
  { id: 'response', label: 'Response only', title: 'Response pane only', icon: ResponsePaneIcon },
];

function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
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

  useRoomEvents(roomFor('user', user?.id), (event) => {
    const notification = (event as { notification?: Notification }).notification;
    if (String(event.type || '') !== 'notification' || !notification) return;
    if (notifications.some((n) => n.id === notification.id)) return;
    setNotifications((prev) => [notification, ...prev].slice(0, 50));
    if (!notification.read) setUnread((prev) => prev + 1);
  });

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
                  void (async () => {
                    if (!n.read) await markRead(n.id);
                    if (n.link) {
                      router.push(n.link);
                      setOpen(false);
                    }
                  })();
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

export function TopBar({
  onOpenCurl,
  onOpenScratchpad,
  onOpenSearch,
  drawerOpen = false,
  onToggleDrawer,
}: {
  onOpenCurl: () => void;
  onOpenScratchpad: () => void;
  onOpenSearch: () => void;
  drawerOpen?: boolean;
  onToggleDrawer?: () => void;
}) {
  const { user, logout } = useAuth();
  const { profile: profileData } = useProfile();
  const { state, dispatch } = useApp();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen can be blocked by the browser or an embedding frame.
    }
  };

  const avatar = profileData?.user?.avatar ?? null;
  const planChip = subscriptionChip(profileData?.subscription ?? null);

  const goProfile = () => {
    setMenuOpen(false);
    router.push('/profile');
  };

  const goInbox = () => {
    setMenuOpen(false);
    router.push('/inbox');
  };

  const goTokens = () => {
    setMenuOpen(false);
    router.push('/settings/api-tokens');
  };

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
        <button
          type="button"
          className="mobile-drawer-toggle"
          data-testid="mobile-drawer-toggle"
          aria-label={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={drawerOpen}
          aria-controls="app-sidebar"
          onClick={onToggleDrawer}
        >
          {drawerOpen ? <XIcon size={18} /> : <MenuIcon size={18} />}
        </button>
        <span className="brand-mark">AH</span>
        <span className="brand-name">API Hub</span>
        <span className="brand-env">
          {state.activeTab === 'request' ? 'Request Studio' : 'Workflow Builder'}
        </span>
        <ProjectSwitcher />
      </div>
      <div className="top-bar-actions">
        <button
          type="button"
          className="ghost-button"
          data-testid="global-search-button"
          aria-label="Search (Ctrl+K)"
          title="Search"
          onClick={onOpenSearch}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <SearchIcon size={14} />
          <span className="btn-label">Search</span>
          <kbd className="global-search-kbd">{isMac ? 'Cmd K' : 'Ctrl K'}</kbd>
        </button>
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
            <span className="btn-label">{activeView.label}</span>
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
          aria-label="Import cURL"
          onClick={onOpenCurl}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <ImportIcon size={14} />
          Import cURL
        </button>
        <button
          type="button"
          className="ghost-button"
          data-testid="topbar-test-curl"
          aria-label="Test cURL"
          onClick={onOpenScratchpad}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <PlayIcon size={14} />
          Test cURL
        </button>
        <NotificationBell />
        <button
          type="button"
          className="ghost-button icon-only"
          data-testid="fullscreen-toggle"
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Full screen (focus mode)'}
          onClick={() => void toggleFullscreen()}
        >
          {isFullscreen ? <MinimizeIcon size={15} /> : <MaximizeIcon size={15} />}
        </button>
        <button
          type="button"
          className={`subscription-chip tone-${planChip.tone} ${planChip.urgent ? 'is-urgent' : ''}`}
          data-testid="subscription-chip"
          title={planChip.title}
          aria-label={planChip.title}
          onClick={goProfile}
        >
          {planChip.urgent && <span className="subscription-chip-dot" aria-hidden="true" />}
          <span className="subscription-chip-label">{planChip.label}</span>
        </button>
        <div className="user-menu">
          <button
            type="button"
            className="user-chip"
            data-testid="user-menu"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
          >
            <UserAvatar avatar={avatar} name={user?.name ?? ''} size={24} />
            <span className="user-name">{user?.name}</span>
            <span className="role-badge">{user?.role}</span>
          </button>
          {menuOpen && (
            <div className="user-dropdown" data-testid="user-dropdown">
              <div className="user-dropdown-head">
                <UserAvatar avatar={avatar} name={user?.name ?? ''} size={32} />
                <div className="user-dropdown-meta">
                  <span className="user-dropdown-name">{user?.name}</span>
                  <span className="user-dropdown-email">{user?.email}</span>
                </div>
              </div>
              <div
                className={`user-dropdown-plan tone-${planChip.tone} ${planChip.urgent ? 'is-urgent' : ''}`}
                data-testid="user-menu-plan"
              >
                <span className="user-dropdown-plan-name">{planChip.label}</span>
                <span className="user-dropdown-plan-status">
                  {profileData?.subscription ? planChip.status : 'FREE'}
                </span>
                {planChip.urgent && (
                  <span className="user-dropdown-plan-note">{planChip.title}</span>
                )}
              </div>
              <button
                type="button"
                className="ghost-button mobile-only-item"
                data-testid="import-curl-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenCurl();
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <ImportIcon size={14} />
                Import cURL
              </button>
              <button
                type="button"
                className="ghost-button mobile-only-item"
                data-testid="test-curl-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenScratchpad();
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <PlayIcon size={14} />
                Test cURL
              </button>
              <button
                type="button"
                className="ghost-button"
                data-testid="profile-menu-item"
                onClick={goProfile}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <UserIcon size={14} />
                Profile
              </button>
              <button
                type="button"
                className="ghost-button"
                data-testid="inbox-menu-item"
                onClick={goInbox}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <SendIcon size={14} />
                Inbox
              </button>
              <button
                type="button"
                className="ghost-button"
                data-testid="tokens-menu-item"
                onClick={goTokens}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <KeyIcon size={14} />
                API tokens
              </button>
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
