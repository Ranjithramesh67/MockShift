'use client';

// Portal B management shell: sidebar nav (role-filtered) + topbar. Consumed by
// app/manage/layout.tsx. Coordinator-owned; page owners do not edit.

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { apiLogout } from '@/lib/portalApi';
import { can, cn, type PortalRole } from './ui';

export type MeUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

type NavItem = {
  href: string;
  label: string;
  min: PortalRole;
  icon: ReactNode;
};

function Ic({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <span className="pm-nav-ic">
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        aria-hidden="true"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    </span>
  );
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/manage/dashboard',
    label: 'Dashboard',
    min: 'VIEWER',
    icon: (
      <Ic d="M3 3v18h18M8 17V9M13 17V5M18 17v-6" />
    ),
  },
  {
    href: '/manage/subscribers',
    label: 'Subscribers',
    min: 'VIEWER',
    icon: <Ic d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  },
  {
    href: '/manage/plans',
    label: 'Plans',
    min: 'VIEWER',
    icon: <Ic d="M12 2 4.5 5.5v6c0 4.6 3 8.4 7.5 10.5 4.5-2.1 7.5-5.9 7.5-10.5v-6L12 2zM12 2v21" />,
  },
  {
    href: '/manage/promo-codes',
    label: 'Promo Codes',
    min: 'VIEWER',
    icon: <Ic d="M20 12 9 3H3v6l9 9 8-6zM7 7h.01M3 21h18" />,
  },
  {
    href: '/manage/audit',
    label: 'Audit Log',
    min: 'SUPPORT',
    icon: <Ic d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2h-6zM9 12h6M9 16h6M9 8h6" />,
  },
];

function initials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export default function ManageShell({
  user,
  portalRole,
  children,
}: {
  user: MeUser;
  portalRole: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const role = portalRole || user.role;

  const items = NAV_ITEMS.filter((i) => can(role, i.min));
  const active = (href: string) =>
    pathname === href || pathname.startsWith(href.endsWith('/dashboard') ? href : href + '/');

  return (
    <div className="pm-shell">
      <aside className="pm-sidebar">
        <div className="pm-brand">
          <span className="pm-brand-mark" aria-hidden="true">
            AH
          </span>
          <span className="pm-brand-text">
            <div className="pm-brand-name">API Hub</div>
            <div className="pm-brand-sub">Management</div>
          </span>
        </div>

        <nav className="pm-nav" aria-label="Portal management">
          <span className="pm-nav-label">Portal B</span>
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(active(item.href) && 'pm-active')}
              aria-current={active(item.href) ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          ))}
          <span className="pm-nav-label">Public</span>
          <a href="/">
            <Ic d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            <span>Portal A site</span>
          </a>
        </nav>

        <div className="pm-role-chip">
          Signed in as <strong>{role}</strong>
        </div>
      </aside>

      <div className="pm-main">
        <header className="pm-topbar">
          <div className="pm-topbar-user">
            <span className="pm-avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className="pm-user-meta">
              <span className="pm-user-name">{user.name}</span>
              <br />
              <span className="pm-user-role">{user.email}</span>
            </span>
            <button
              type="button"
              className="pm-btn pm-btn-sm pm-btn-ghost"
              data-testid="logout-button"
              onClick={() => apiLogout()}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="pm-content">{children}</main>
      </div>
    </div>
  );
}
