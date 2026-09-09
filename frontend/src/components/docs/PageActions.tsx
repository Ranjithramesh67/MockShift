'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useApp } from '@/store/AppStore';
import {
  docsApi,
  fetchDocExport,
  isApiError,
  type DocExportFormat,
  type DocsShareContext,
  type DocsShareGrant,
} from '@/lib/docsApi';
import styles from './docs.module.css';
import {
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  ExportIcon,
  GlobeIcon,
  LockIcon,
  PlusIcon,
  ShareIcon,
  TeamIcon,
  UserIcon,
  XIcon,
} from '@/components/icons';

// File-name helper: slug of the page title plus the right extension.
function fileNameFor(title: string, ext: string): string {
  const slug = (title || 'doc')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'doc'}.${ext}`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): Promise<void> {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

const EXPORT_FORMATS: Array<{ format: DocExportFormat; label: string; desc: string }> = [
  { format: 'markdown', label: 'Markdown', desc: '.md file' },
  { format: 'html', label: 'HTML', desc: 'standalone page' },
  { format: 'word', label: 'Word', desc: '.doc file' },
  { format: 'json', label: 'JSON', desc: 'structured data' },
];

function mimeFor(format: DocExportFormat): string {
  if (format === 'markdown') return 'text/markdown';
  if (format === 'word') return 'application/msword';
  if (format === 'html') return 'text/html';
  return 'application/json';
}

export function ExportMenu({ pageId, title }: { pageId: string; title: string }) {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<DocExportFormat | 'print' | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toastError = (err: unknown) => {
    dispatch({
      type: 'SHOW_TOAST',
      kind: 'error',
      message: err instanceof Error ? err.message : 'Failed to export page',
    });
  };

  const download = async (format: DocExportFormat) => {
    setBusy(format);
    setOpen(false);
    try {
      const text = await fetchDocExport(pageId, format);
      const ext = format === 'markdown' ? 'md' : format === 'word' ? 'doc' : format;
      const blob = new Blob([text], { type: `${mimeFor(format)};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFor(title, ext);
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Page exported.' });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  const printHtml = async () => {
    setBusy('print');
    setOpen(false);
    try {
      const html = await fetchDocExport(pageId, 'html');
      const win = window.open('', '_blank');
      if (!win) {
        dispatch({ type: 'SHOW_TOAST', kind: 'error', message: 'Your browser blocked the print window.' });
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      window.setTimeout(() => {
        try {
          win.print();
        } catch {
          // Cross-origin / closed popup — nothing else we can do.
        }
      }, 400);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.actionMenuWrap} ref={wrapRef}>
      <button
        type="button"
        className="ghost-button"
        data-testid="docs-export"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <ExportIcon size={13} />
        Export
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className={styles.actionMenu} data-testid="docs-export-menu" role="menu">
          {EXPORT_FORMATS.map((item) => (
            <button
              key={item.format}
              type="button"
              role="menuitem"
              className={styles.actionMenuItem}
              data-testid={`docs-export-${item.format === 'markdown' ? 'md' : item.format}`}
              disabled={busy !== null}
              onClick={() => download(item.format)}
            >
              {item.label}
              <span className={styles.actionMenuHint}>{item.desc}</span>
            </button>
          ))}
          <div className={styles.actionMenuSep} />
          <button
            type="button"
            role="menuitem"
            className={styles.actionMenuItem}
            data-testid="docs-export-print"
            disabled={busy !== null}
            onClick={printHtml}
          >
            Print or save as PDF
            <span className={styles.actionMenuHint}>Themed document — choose “Save as PDF” in the print dialog</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function DocShareButton({ pageId }: { pageId: string }) {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shares, setShares] = useState<DocsShareGrant[]>([]);
  const [context, setContext] = useState<DocsShareContext>({ organizationId: null, teams: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [personError, setPersonError] = useState('');
  const [teamId, setTeamId] = useState('');
  const [copied, setCopied] = useState(false);

  const toast = (kind: 'success' | 'error', message: string) =>
    dispatch({ type: 'SHOW_TOAST', kind, message });

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await docsApi.listShares(pageId);
      setShares(res.shares);
      setContext(res.context);
      setTeamId((cur) => cur || res.context.teams[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shares');
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setOpen(true);
    void refresh();
  };

  const publicShare = shares.find((s) => s.kind === 'public');
  const audience = shares.filter((s) => s.kind !== 'public');
  const sharedTeamIds = new Set(
    shares.filter((s) => s.kind === 'team').map((s) => s.target.id)
  );
  const hasOrgShare = shares.some((s) => s.kind === 'org');

  const addPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setPersonError('');
    setBusy('user');
    try {
      const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
      await docsApi.createShare(pageId, {
        kind: 'user',
        targetUser: isEmail ? { email: value } : { username: value },
      });
      setEmail('');
      toast('success', 'Access granted — the person will be notified.');
      await refresh();
    } catch (err) {
      setPersonError(err instanceof Error ? err.message : 'Could not share with that person');
    } finally {
      setBusy(null);
    }
  };

  const addTeam = async () => {
    if (!teamId) return;
    setBusy('team');
    setError('');
    try {
      await docsApi.createShare(pageId, { kind: 'team', teamId });
      toast('success', 'Team members will be notified.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share with that team');
    } finally {
      setBusy(null);
    }
  };

  const addOrg = async () => {
    setBusy('org');
    setError('');
    try {
      await docsApi.createShare(pageId, { kind: 'org' });
      toast('success', 'Your organization can now read this doc.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share with the organization');
    } finally {
      setBusy(null);
    }
  };

  const togglePublicLink = async () => {
    setBusy('public');
    setError('');
    try {
      if (publicShare) {
        await docsApi.unshare(pageId);
        toast('success', 'Public link removed.');
      } else {
        const res = await docsApi.share(pageId);
        toast('success', 'Anyone with the link can now view this doc.');
        setCopied(false);
      }
      await refresh();
    } catch (err) {
      const planGated = isApiError(err) && err.status === 403;
      if (planGated) {
        const msg = err.message;
        toast('error', /upgrade/i.test(msg) ? msg : `${msg} Upgrade to enable public sharing.`);
      } else {
        toast('error', err instanceof Error ? err.message : 'Failed to update the public link');
      }
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (grant: DocsShareGrant) => {
    setBusy(grant.id);
    setError('');
    try {
      await docsApi.revokeShare(pageId, grant.id);
      toast('success', 'Access revoked.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setBusy(null);
    }
  };

  const copyPublic = async () => {
    if (!publicShare) return;
    await copyText(`${window.location.origin}${publicShare.url}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const remainingTeams = context.teams.filter((t) => !sharedTeamIds.has(t.id));

  return (
    <>
      <button
        type="button"
        className="ghost-button"
        data-testid="docs-share"
        onClick={openModal}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <ShareIcon size={13} />
        Share
      </button>
      {open && (
        <Modal title="Share this doc" onClose={() => setOpen(false)} testId="docs-share-modal">
          <div className={styles.sharePanel}>
            {error && (
              <p className="auth-error" role="alert" data-testid="docs-share-error">
                {error}
              </p>
            )}

            <section className={styles.shareSection}>
              <div className={styles.shareSectionHead}>
                <GlobeIcon size={13} />
                <span>Public link</span>
              </div>
              <p className={styles.shareHint}>
                Anyone with the link can view the doc and its images — read-only, no login required.
              </p>
              {publicShare ? (
                <>
                  <div className="share-url-row">
                    <input
                      className="text-input"
                      type="text"
                      readOnly
                      value={`${window.location.origin}${publicShare.url}`}
                      data-testid="docs-share-url"
                      aria-label="Public share URL"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button type="button" className="ghost-button" data-testid="docs-share-copy" onClick={copyPublic}>
                      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ghost-button danger small"
                    data-testid="docs-share-public-off"
                    disabled={busy !== null}
                    onClick={togglePublicLink}
                  >
                    <LockIcon size={13} />
                    Turn off link
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="ghost-button"
                  data-testid="docs-share-public-on"
                  disabled={busy !== null}
                  onClick={togglePublicLink}
                >
                  <GlobeIcon size={13} />
                  {busy === 'public' ? 'Creating link…' : 'Create public link'}
                </button>
              )}
            </section>

            <section className={styles.shareSection}>
              <div className={styles.shareSectionHead}>
                <UserIcon size={13} />
                <span>People, teams &amp; organization</span>
              </div>
              {loading ? (
                <p className="hint" data-testid="docs-share-loading">
                  Loading access…
                </p>
              ) : (
                <>
                  {audience.length === 0 ? (
                    <p className={styles.shareHint} data-testid="docs-share-empty">
                      No one has been granted access yet.
                    </p>
                  ) : (
                    <ul className={styles.shareRows} data-testid="docs-share-list">
                      {audience.map((grant) => (
                        <li key={grant.id} className={styles.shareRow} data-testid={`docs-share-grant-${grant.id}`}>
                          <span className={styles.shareRowIcon}>
                            {grant.kind === 'user' ? (
                              <UserIcon size={14} />
                            ) : grant.kind === 'team' ? (
                              <TeamIcon size={14} />
                            ) : (
                              <GlobeIcon size={14} />
                            )}
                          </span>
                          <span className={styles.shareRowText}>
                            <span className={styles.shareRowName}>
                              {grant.kind === 'user' ? grant.target.name || grant.target.email : grant.target.name}
                            </span>
                            <span className={styles.shareRowMeta}>
                              {grant.kind === 'user'
                                ? 'Person'
                                : grant.kind === 'team'
                                  ? 'Team'
                                  : 'Organization'}
                              {grant.kind === 'user' && grant.target.email ? ` · ${grant.target.email}` : ''}
                            </span>
                          </span>
                          <button
                            type="button"
                            className={styles.shareRevoke}
                            data-testid={`docs-share-revoke-${grant.id}`}
                            title="Revoke access"
                            disabled={busy !== null}
                            onClick={() => revoke(grant)}
                          >
                            <XIcon size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>

            <section className={styles.shareSection}>
              <div className={styles.shareSectionHead}>
                <PlusIcon size={13} />
                <span>Grant access</span>
              </div>
              <form className={styles.shareAddRow} onSubmit={addPerson}>
                <input
                  className="text-input"
                  type="text"
                  placeholder="Email or username"
                  aria-label="Email or username"
                  data-testid="docs-share-person"
                  value={email}
                  disabled={busy !== null}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  type="submit"
                  className="ghost-button"
                  data-testid="docs-share-add-user"
                  disabled={busy !== null || email.trim().length === 0}
                >
                  {busy === 'user' ? 'Adding…' : 'Add person'}
                </button>
              </form>
              {personError && (
                <p className="auth-error" role="alert" data-testid="docs-share-person-error">
                  {personError}
                </p>
              )}
              <div className={styles.shareAddRow}>
                <select
                  className="compact-select"
                  data-testid="docs-share-team"
                  value={teamId}
                  disabled={busy !== null || remainingTeams.length === 0}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  {context.teams.length === 0 && <option value="">No teams in this organization</option>}
                  {context.teams.length > 0 && remainingTeams.length === 0 && (
                    <option value="">All teams already have access</option>
                  )}
                  {remainingTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ghost-button"
                  data-testid="docs-share-add-team"
                  disabled={busy !== null || remainingTeams.length === 0}
                  onClick={addTeam}
                >
                  {busy === 'team' ? 'Sharing…' : 'Add team'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  data-testid="docs-share-add-org"
                  title="Let every member of your organization read this doc"
                  disabled={busy !== null || hasOrgShare || !context.organizationId}
                  onClick={addOrg}
                >
                  {hasOrgShare ? 'Organization has access' : busy === 'org' ? 'Sharing…' : 'Share with organization'}
                </button>
              </div>
            </section>

            <div className={styles.shareActions}>
              <button type="button" className="primary-button" data-testid="docs-share-done" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
