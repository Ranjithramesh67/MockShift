'use client';

import React, { useEffect, useState } from 'react';
import {
  ApiError,
  iamApi,
  orgAnalyticsApi,
  type IamOrg,
  type OrgAnalytics,
  type OrgAnalyticsMember,
  type OrgAnalyticsSummary,
} from '@/lib/api';
import { StatGrid, BarList, RunTrendBars, type BarListItem } from './AnalyticsCharts';

const FORBIDDEN_MESSAGE = 'You need organization admin access to view analytics.';

const KPI_FIELDS: Array<{ key: keyof OrgAnalyticsSummary; label: string }> = [
  { key: 'members', label: 'Members' },
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'projects', label: 'Projects' },
  { key: 'collections', label: 'Collections' },
  { key: 'folders', label: 'Folders' },
  { key: 'requests', label: 'Requests' },
  { key: 'mock_servers', label: 'Mock servers' },
  { key: 'active_mock_servers', label: 'Active mock servers' },
  { key: 'request_revisions', label: 'Request revisions' },
  { key: 'runs', label: 'Runs' },
  { key: 'runs_this_month', label: 'Runs this month' },
];

function fmtNumber(value: number): string {
  return value.toLocaleString();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function contributionScore(member: OrgAnalyticsMember): number {
  return (
    member.projects_created +
    member.workspaces_created +
    member.collections_created +
    member.folders_created +
    member.requests_created +
    member.mock_servers_created
  );
}

export function OrgAnalyticsView() {
  const [orgs, setOrgs] = useState<IamOrg[]>([]);
  const [orgId, setOrgId] = useState('');
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgError, setOrgError] = useState('');

  const [data, setData] = useState<OrgAnalytics | null>(null);
  const [members, setMembers] = useState<OrgAnalyticsMember[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOrgsLoading(true);
    iamApi
      .orgs()
      .then((res) => {
        if (cancelled) return;
        setOrgs(res.organizations);
        const preferred = res.organizations.find((o) => o.isAdmin) ?? res.organizations[0] ?? null;
        setOrgId(preferred ? preferred.id : '');
        setOrgsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setOrgError(err instanceof Error && err.message ? err.message : 'Failed to load organizations');
        setOrgsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!orgId) {
      setData(null);
      setMembers([]);
      return;
    }
    let cancelled = false;
    setDataLoading(true);
    setLoadError('');
    setForbidden(false);

    Promise.all([orgAnalyticsApi.summary(orgId), orgAnalyticsApi.members(orgId)])
      .then(([summaryRes, membersRes]) => {
        if (cancelled) return;
        setData(summaryRes);
        setMembers(membersRes.members);
      })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setMembers([]);
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          setLoadError(FORBIDDEN_MESSAGE);
        } else {
          setLoadError(err instanceof Error && err.message ? err.message : 'Failed to load analytics');
        }
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const mostTriggeredItems: BarListItem[] = data
    ? data.mostTriggered.map((item) => ({
        key: item.request_id,
        label: item.name,
        sublabel: `${item.method} ${item.url ?? item.collection_name ?? item.project_name ?? ''}`.trim(),
        value: item.runs,
      }))
    : [];

  const memberItems: BarListItem[] = members
    .map((member) => ({ member, score: contributionScore(member) }))
    .sort((a, b) => b.score - a.score)
    .map(({ member, score }) => ({
      key: member.user_id,
      label: member.name,
      sublabel: `${fmtNumber(member.runs)} runs`,
      value: score,
    }));

  const topMemberId = members.length > 1 ? members[0]?.user_id ?? null : null;

  return (
    <div className="admin-main" data-testid="org-analytics-page">
      <div className="admin-title-row">
        <div>
          <h1>Org analytics</h1>
          <p className="admin-subtitle">Performance and contribution analytics for your organization members.</p>
        </div>
        {orgs.length > 0 && (
          <label className="iam-org-picker">
            <span className="field-label">Organization</span>
            <select
              className="compact-select"
              data-testid="org-analytics-org-select"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {orgError && (
        <div className="auth-error" role="alert" data-testid="org-analytics-org-error">
          {orgError}
        </div>
      )}

      {orgsLoading ? (
        <div className="hint">Loading…</div>
      ) : orgs.length === 0 ? (
        <p className="hint">You are not a member of any organization yet.</p>
      ) : dataLoading ? (
        <div className="hint">Loading…</div>
      ) : forbidden ? (
        <div className="auth-error" role="alert" data-testid="org-analytics-forbidden">
          {FORBIDDEN_MESSAGE}
        </div>
      ) : loadError ? (
        <div className="auth-error" role="alert" data-testid="org-analytics-error">
          {loadError}
        </div>
      ) : data ? (
        <>
          <StatGrid
            stats={KPI_FIELDS.map(({ key, label }) => ({
              label,
              value: fmtNumber(data.summary[key]),
            }))}
          />

          <section data-testid="org-analytics-runs">
            <h2 className="manage-section-title">Runs (last 14 days)</h2>
            <RunTrendBars data={data.runTrend} />
          </section>

          <section data-testid="org-analytics-most-triggered">
            <h2 className="manage-section-title">Most triggered requests</h2>
            {data.mostTriggered.length === 0 ? (
              <p className="hint">No request runs recorded yet.</p>
            ) : (
              <>
                <BarList items={mostTriggeredItems} emptyText="No request runs recorded yet." />
                <div className="table-wrap table-stack">
                  <table className="admin-table" data-testid="org-analytics-most-triggered-table">
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Method</th>
                        <th>Collection</th>
                        <th>Project</th>
                        <th>Runs</th>
                        <th>Last run</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.mostTriggered.map((item) => (
                        <tr key={item.request_id}>
                          <td className="admin-user-name" data-label="Request">
                            {item.name}
                          </td>
                          <td data-label="Method">
                            <span className="role-badge">{item.method}</span>
                          </td>
                          <td className="hint" data-label="Collection">
                            {item.collection_name ?? '—'}
                          </td>
                          <td className="hint" data-label="Project">
                            {item.project_name ?? '—'}
                          </td>
                          <td data-label="Runs">{fmtNumber(item.runs)}</td>
                          <td className="hint" data-label="Last run">
                            {fmtDate(item.last_run_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section data-testid="org-analytics-member-contributions">
            <h2 className="manage-section-title">Member contributions</h2>
            {members.length === 0 ? (
              <p className="hint">No member activity yet.</p>
            ) : (
              <div className="table-wrap table-stack">
                <table className="admin-table" data-testid="org-analytics-members-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Projects</th>
                      <th>Workspaces</th>
                      <th>Collections</th>
                      <th>Folders</th>
                      <th>Requests</th>
                      <th>Mock servers</th>
                      <th>Revisions</th>
                      <th>Runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.user_id} data-testid="org-analytics-member-row">
                        <td data-label="Member">
                          <div className="admin-user-cell">
                            <span className="admin-avatar">
                              {(member.name || member.username || member.email || '?').charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <div className="admin-user-name">
                                {member.name}
                                {topMemberId === member.user_id && (
                                  <span className="vis-badge access-badge">Top</span>
                                )}
                              </div>
                              <div className="admin-user-email">{member.email || `@${member.username}`}</div>
                            </div>
                          </div>
                        </td>
                        <td data-label="Role">
                          <span className="role-badge">{member.role}</span>
                        </td>
                        <td data-label="Projects">{fmtNumber(member.projects_created)}</td>
                        <td data-label="Workspaces">{fmtNumber(member.workspaces_created)}</td>
                        <td data-label="Collections">{fmtNumber(member.collections_created)}</td>
                        <td data-label="Folders">{fmtNumber(member.folders_created)}</td>
                        <td data-label="Requests">{fmtNumber(member.requests_created)}</td>
                        <td data-label="Mock servers">{fmtNumber(member.mock_servers_created)}</td>
                        <td data-label="Revisions">{fmtNumber(member.revisions_created)}</td>
                        <td data-label="Runs">{fmtNumber(member.runs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section data-testid="org-analytics-most-active">
            <h2 className="manage-section-title">Most active members</h2>
            <BarList items={memberItems} emptyText="No member activity yet." />
          </section>
        </>
      ) : null}
    </div>
  );
}
