'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  Card,
  EmptyState,
  LoadingBlock,
  PageHead,
  can,
} from '@/components/manage/ui';
import { apiFetch } from '@/lib/portalApi';
import type { MeResponse } from '@/lib/portalApi';

type CompanyDomain = {
  id: string;
  company_name: string;
  domain: string;
  organization_id: string | null;
  organization_name: string | null;
  member_count: number;
  created_at: string;
};

type CompaniesResponse = { domains: CompanyDomain[] };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed';
}

export default function CompaniesPage() {
  const [role, setRole] = useState<string | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [rows, setRows] = useState<CompanyDomain[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [saving, setSaving] = useState(false);

  const canManage = can(role, 'MANAGER');

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<CompaniesResponse>('/api/portal/companies');
      setRows(data.domains ?? []);
      setPageError(null);
    } catch (err) {
      setPageError(errMsg(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<MeResponse>('/api/me');
        if (cancelled) return;
        setRole(me.portalRole);
        if (can(me.portalRole, 'VIEWER')) await refresh();
      } catch (err) {
        if (!cancelled) setPageError(errMsg(err));
      } finally {
        if (!cancelled) setMeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setPageError(null);
    setNotice(null);
    try {
      const data = await apiFetch<CompaniesResponse>('/api/portal/companies', {
        method: 'POST',
        body: { company_name: companyName.trim(), domain: domain.trim() },
      });
      setRows(data.domains ?? []);
      setNotice(`Registered ${companyName.trim()} (${domain.trim()}).`);
      setCompanyName('');
      setDomain('');
    } catch (err) {
      setPageError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(row: CompanyDomain) {
    setSaving(true);
    setPageError(null);
    setNotice(null);
    try {
      const data = await apiFetch<CompaniesResponse>(`/api/portal/companies/${row.id}`, {
        method: 'DELETE',
      });
      setRows(data.domains ?? []);
      setNotice(`Removed ${row.domain}.`);
    } catch (err) {
      setPageError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) return <LoadingBlock label="Loading companies…" />;

  return (
    <>
      <PageHead
        title="Companies"
        description="Register company email domains. Anyone who signs up or logs in with a registered domain automatically joins that company's organization."
      />

      {pageError ? <Alert kind="error">{pageError}</Alert> : null}
      {notice ? <Alert kind="ok">{notice}</Alert> : null}

      {canManage ? (
        <Card title="Register a domain">
          <form className="pm-toolbar" onSubmit={onAdd}>
            <input
              className="pm-input"
              placeholder="Company name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              data-testid="company-name"
            />
            <input
              className="pm-input"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
              data-testid="company-domain"
            />
            <button
              type="submit"
              className="pm-btn pm-btn-primary"
              disabled={saving || !companyName.trim() || !domain.trim()}
              data-testid="company-add"
            >
              Register domain
            </button>
          </form>
        </Card>
      ) : null}

      <Card title="Registered domains" actions={<span className="pm-hint">{rows.length} domains</span>}>
        {rows.length === 0 ? (
          <EmptyState
            title="No company domains yet"
            hint="Add a company name and its email domain to create an organization network."
          />
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Domain</th>
                  <th>Organization</th>
                  <th>Members</th>
                  {canManage ? <th className="pm-table-actions">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`company-row-${row.id}`}>
                    <td className="pm-cell-main">{row.company_name}</td>
                    <td>@{row.domain}</td>
                    <td>{row.organization_name || <span className="pm-hint">Created on first login</span>}</td>
                    <td>{row.member_count}</td>
                    {canManage ? (
                      <td className="pm-table-actions">
                        <button
                          type="button"
                          className="pm-btn pm-btn-sm pm-btn-danger"
                          disabled={saving}
                          data-testid={`company-remove-${row.id}`}
                          onClick={() => void onRemove(row)}
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
