'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  platformApi,
  type PlatformOverviewCounts,
  type PlatformOrganization,
  type PlatformMockServer,
} from '@/lib/api';
import { StatGrid, type StatItem } from './AnalyticsCharts';

type Tab = 'overview' | 'organizations' | 'mock-servers';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'mock-servers', label: 'Mock servers' },
];

function fmtDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '—';
}

function fmtNum(value: number): string {
  return value.toLocaleString();
}

export function SuperadminView() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<PlatformOverviewCounts | null>(null);
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [mockServers, setMockServers] = useState<PlatformMockServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgLoading, setOrgLoading] = useState(false);
  const [mockLoading, setMockLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mockSearch, setMockSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  const loadOrganizations = async (term: string) => {
    setError('');
    setOrgLoading(true);
    try {
      const res = await platformApi.organizations(term || undefined);
      setOrganizations(res.organizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setOrgLoading(false);
    }
  };

  const loadMockServers = async (active: boolean, term: string) => {
    setError('');
    setMockLoading(true);
    try {
      const res = await platformApi.mockServers({ active, search: term || undefined });
      setMockServers(res.mockServers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setMockLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([platformApi.overview(), platformApi.organizations()])
      .then(([ov, orgs]) => {
        if (cancelled) return;
        setOverview(ov.counts);
        setOrganizations(orgs.organizations);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const orgSearchInit = useRef(false);
  useEffect(() => {
    if (!orgSearchInit.current) {
      orgSearchInit.current = true;
      return;
    }
    const handle = setTimeout(() => {
      loadOrganizations(search);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (tab !== 'mock-servers') return;
    const handle = setTimeout(
      () => {
        loadMockServers(activeOnly, mockSearch);
      },
      mockSearch ? 300 : 0
    );
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeOnly, mockSearch]);

  const stats = useMemo<StatItem[]>(() => {
    if (!overview) return [];
    return [
      { label: 'Organizations', value: fmtNum(overview.organizations) },
      { label: 'Users', value: fmtNum(overview.users) },
      { label: 'Workspaces', value: fmtNum(overview.workspaces) },
      { label: 'Projects', value: fmtNum(overview.projects) },
      { label: 'Collections', value: fmtNum(overview.collections) },
      { label: 'Requests', value: fmtNum(overview.requests) },
      { label: 'Mock servers', value: fmtNum(overview.mock_servers) },
      { label: 'Active mocks', value: fmtNum(overview.active_mock_servers) },
      { label: 'Runs', value: fmtNum(overview.runs) },
      { label: 'Audit entries', value: fmtNum(overview.audit_entries) },
      { label: 'New orgs (30d)', value: fmtNum(overview.organizations_30d) },
      { label: 'New users (30d)', value: fmtNum(overview.users_30d) },
    ];
  }, [overview]);

  const recentOrganizations = useMemo(
    () =>
      [...organizations]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 8),
    [organizations]
  );

  return (
    <div className="admin-main" data-testid="superadmin-page">
      <div className="admin-title-row">
        <div>
          <h1>Superadmin</h1>
          <p className="admin-subtitle">Platform-wide overview of every organization and mock server.</p>
        </div>
      </div>

      {error && (
        <div className="auth-error" role="alert" data-testid="superadmin-error">
          {error}
        </div>
      )}

      <div className="manage-tabs" data-testid="superadmin-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`manage-tab ${tab === t.id ? 'active' : ''}`}
            data-testid={`superadmin-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div data-testid="superadmin-overview">
          {loading ? (
            <div className="hint">Loading…</div>
          ) : !overview ? (
            <div className="hint">No overview data.</div>
          ) : (
            <>
              <StatGrid stats={stats} />

              <h2 className="manage-section-title">Recently created organizations</h2>
              {recentOrganizations.length === 0 ? (
                <p className="hint">No organizations yet.</p>
              ) : (
                <div className="table-wrap table-stack">
                  <table className="admin-table" data-testid="superadmin-recent-organizations">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Kind</th>
                        <th>Owner</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrganizations.map((o) => (
                        <tr key={o.id} data-testid={`superadmin-recent-org-${o.id}`}>
                          <td data-label="Name">{o.name}</td>
                          <td data-label="Kind">
                            <span className="role-badge">{o.kind}</span>
                          </td>
                          <td data-label="Owner">{o.owner_email ?? '—'}</td>
                          <td className="hint" data-label="Created">{fmtDay(o.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'organizations' && (
        <div data-testid="superadmin-organizations-section">
          <div className="admin-access-add" style={{ marginTop: 12 }}>
            <input
              type="search"
              className="text-input"
              placeholder="Search organizations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="superadmin-org-search"
            />
          </div>

          {orgLoading ? (
            <div className="hint">Loading…</div>
          ) : (
            <div className="table-wrap table-stack">
              <table className="admin-table" data-testid="superadmin-organizations-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>Domain</th>
                    <th>Owner</th>
                    <th>Members</th>
                    <th>Workspaces</th>
                    <th>Projects</th>
                    <th>Collections</th>
                    <th>Requests</th>
                    <th>Mock servers</th>
                    <th>Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((o) => (
                    <tr key={o.id} data-testid={`superadmin-org-${o.id}`}>
                      <td data-label="Name">{o.name}</td>
                      <td data-label="Kind">
                        <span className="role-badge">{o.kind}</span>
                      </td>
                      <td data-label="Domain">{o.domain ?? '—'}</td>
                      <td data-label="Owner">{o.owner_name ?? o.owner_email ?? '—'}</td>
                      <td data-label="Members">{fmtNum(o.members)}</td>
                      <td data-label="Workspaces">{fmtNum(o.workspaces)}</td>
                      <td data-label="Projects">{fmtNum(o.projects)}</td>
                      <td data-label="Collections">{fmtNum(o.collections)}</td>
                      <td data-label="Requests">{fmtNum(o.requests)}</td>
                      <td data-label="Mock servers">{fmtNum(o.mock_servers)}</td>
                      <td data-label="Runs">{fmtNum(o.runs)}</td>
                    </tr>
                  ))}
                  {organizations.length === 0 && (
                    <tr>
                      <td colSpan={11} className="hint">
                        No organizations found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'mock-servers' && (
        <div data-testid="superadmin-mock-servers-section">
          <div className="admin-access-add" style={{ marginTop: 12, alignItems: 'center' }}>
            <label className="field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                data-testid="superadmin-active-only"
              />
              <span>Active only</span>
            </label>
            <input
              type="search"
              className="text-input"
              placeholder="Search mock servers"
              value={mockSearch}
              onChange={(e) => setMockSearch(e.target.value)}
              data-testid="superadmin-mock-search"
            />
          </div>

          {mockLoading ? (
            <div className="hint">Loading…</div>
          ) : (
            <div className="table-wrap table-stack">
              <table className="admin-table" data-testid="superadmin-mock-servers-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Enabled</th>
                    <th>Project</th>
                    <th>Workspace</th>
                    <th>Organization</th>
                    <th>Creator</th>
                    <th>Routes</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {mockServers.map((s) => (
                    <tr key={s.id} data-testid={`superadmin-mock-server-${s.id}`}>
                      <td data-label="Name">{s.name}</td>
                      <td data-label="Enabled">
                        <span className={`vis-badge ${s.enabled ? 'vis-active' : 'vis-inactive'}`}>
                          {s.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </td>
                      <td data-label="Project">{s.project_name}</td>
                      <td data-label="Workspace">{s.workspace_name ?? '—'}</td>
                      <td data-label="Organization">{s.organization_name ?? '—'}</td>
                      <td data-label="Creator">
                        {s.created_by ? (
                          <>
                            {s.created_by_name ?? 'Unknown'}
                            {s.created_by_email ? ` · ${s.created_by_email}` : ''}
                          </>
                        ) : (
                          'Unknown'
                        )}
                      </td>
                      <td data-label="Routes">{fmtNum(s.route_count)}</td>
                      <td className="hint" data-label="Created">{fmtDay(s.created_at)}</td>
                    </tr>
                  ))}
                  {mockServers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="hint">
                        No mock servers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
