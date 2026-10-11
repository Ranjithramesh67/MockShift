'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  networkApi,
  teamApi,
  type NetworkDirectory,
  type NetworkInvitation,
  type NetworkPerson,
  type Team,
} from '@/lib/api';
import { NetworkIcon } from '../icons';

type Tab = 'incoming' | 'outgoing' | 'contacts' | 'directory';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'incoming', label: 'Invitations' },
  { id: 'outgoing', label: 'Sent' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'directory', label: 'Directory' },
];

function initials(name: string): string {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

function PersonRow({
  person,
  action,
}: {
  person: NetworkPerson;
  action?: React.ReactNode;
}) {
  return (
    <div className="network-row" data-testid={`network-person-${person.id}`}>
      <span className="network-avatar" aria-hidden="true">
        {initials(person.name)}
      </span>
      <div className="network-person">
        <strong>{person.name}</strong>
        <span className="network-person-meta">
          {person.email}
          {person.role ? ` · ${person.role}` : ''}
          {person.username ? ` · @${person.username}` : ''}
        </span>
      </div>
      {action ? <div className="network-row-action">{action}</div> : null}
    </div>
  );
}

function statusLabel(status: NetworkInvitation['status']): string {
  if (status === 'ACCEPTED') return 'Accepted';
  if (status === 'DECLINED') return 'Declined';
  if (status === 'CANCELLED') return 'Cancelled';
  return 'Pending';
}

function AddToTeam({
  person,
  disabled,
  onAdded,
  onError,
}: {
  person: NetworkPerson;
  disabled: boolean;
  onAdded: (teamName: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState('');
  const [adding, setAdding] = useState(false);

  const start = async () => {
    setOpen(true);
    setTeams(null);
    try {
      const res = await teamApi.list();
      setTeams(res.teams.filter((t) => t.myRole === 'ADMIN'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load your teams');
      setOpen(false);
    }
  };

  const add = async () => {
    const team = teams?.find((t) => t.id === teamId);
    if (!team) {
      onError('Choose a team');
      return;
    }
    setAdding(true);
    try {
      await teamApi.addMember(team.id, person.id, 'EDITOR');
      onAdded(team.name);
      setOpen(false);
      setTeamId('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not add to team');
    } finally {
      setAdding(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ghost-button small"
        disabled={disabled}
        data-testid={`network-add-to-team-${person.id}`}
        onClick={start}
      >
        Add to team
      </button>
    );
  }

  return (
    <div className="network-add-team" data-testid={`network-add-team-form-${person.id}`}>
      {teams === null ? (
        <span className="hint">Loading teams…</span>
      ) : teams.length === 0 ? (
        <span className="hint">You are not an admin of any team.</span>
      ) : (
        <>
          <select
            className="text-input"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            data-testid={`network-team-select-${person.id}`}
            aria-label={`Choose a team for ${person.name}`}
          >
            <option value="">Choose a team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button small"
            disabled={adding || !teamId}
            data-testid={`network-team-confirm-${person.id}`}
            onClick={add}
          >
            Add
          </button>
        </>
      )}
      <button
        type="button"
        className="ghost-button small"
        disabled={adding}
        data-testid={`network-team-cancel-${person.id}`}
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </div>
  );
}

export function NetworkView() {
  const [tab, setTab] = useState<Tab>('incoming');
  const [directory, setDirectory] = useState<NetworkDirectory | null>(null);
  const [incoming, setIncoming] = useState<NetworkInvitation[]>([]);
  const [outgoing, setOutgoing] = useState<NetworkInvitation[]>([]);
  const [contacts, setContacts] = useState<NetworkPerson[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NetworkPerson[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const isCompany = directory?.scope === 'company';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dir, inc, out, con] = await Promise.all([
        networkApi.directory(),
        networkApi.invitations('incoming'),
        networkApi.invitations('outgoing'),
        networkApi.contacts(),
      ]);
      setDirectory(dir);
      setIncoming(inc.invitations);
      setOutgoing(out.invitations);
      setContacts(con.contacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<void>, successMessage: string) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await fn();
      setStatus(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await networkApi.search(q);
      setSearchResults(res.people);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    await run(async () => {
      await networkApi.invite(email, inviteMessage.trim() || undefined);
      setInviteEmail('');
      setInviteMessage('');
    }, `Invitation sent to ${email}.`);
  };

  const directoryPeople = searchResults ?? directory?.people ?? [];

  const contactIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts]);

  return (
    <main className="admin-main network-view" data-testid="network-page">
      <div className="admin-title-row">
        <div>
          <h1>People</h1>
          <p className="admin-subtitle">
            {isCompany
              ? `Everyone with an @${directory?.organization?.domain || 'company'} email already works in ${directory?.organization?.name || 'your organization'}.`
              : 'Invite people by email to collaborate.'}
          </p>
        </div>
      </div>

      {isCompany ? (
        <div className="network-org-banner" data-testid="network-org-banner">
          <NetworkIcon size={16} />
          <span>
            <strong>{directory?.organization?.name}</strong> · organization directory
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="auth-error" role="alert" data-testid="network-error">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="hint" data-testid="network-status">
          {status}
        </p>
      ) : null}

      <form className="network-invite-form" onSubmit={onInvite} data-testid="network-invite-form">
        <input
          type="email"
          className="text-input"
          placeholder="teammate@example.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          data-testid="network-invite-email"
          required
        />
        <input
          type="text"
          className="text-input"
          placeholder="Optional message"
          value={inviteMessage}
          maxLength={500}
          onChange={(e) => setInviteMessage(e.target.value)}
          data-testid="network-invite-message"
        />
        <button type="submit" className="primary-button" disabled={busy} data-testid="network-invite-submit">
          Send invite
        </button>
      </form>

      <div className="network-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`network-tab ${tab === t.id ? 'active' : ''}`}
            data-testid={`network-tab-${t.id}`}
            onClick={() => {
              setTab(t.id);
              setSearchResults(null);
            }}
          >
            {t.label}
            {t.id === 'incoming' && incoming.length > 0 ? (
              <span className="network-badge">{incoming.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="hint" data-testid="network-loading">
          Loading…
        </p>
      ) : null}

      {!loading && tab === 'incoming' ? (
        <section className="network-card">
          {incoming.length === 0 ? (
            <p className="network-empty">No pending invitations.</p>
          ) : (
            incoming.map((inv) => (
              <PersonRow
                key={inv.id}
                person={{ id: inv.id, name: inv.inviter.name, email: inv.inviter.email, username: inv.inviter.username }}
                action={
                  <>
                    <button
                      type="button"
                      className="primary-button small"
                      disabled={busy}
                      data-testid={`network-accept-${inv.id}`}
                      onClick={() =>
                        run(async () => {
                          await networkApi.accept(inv.id);
                        }, `You are now connected with ${inv.inviter.name}.`)
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="ghost-button small"
                      disabled={busy}
                      data-testid={`network-decline-${inv.id}`}
                      onClick={() =>
                        run(async () => {
                          await networkApi.decline(inv.id);
                        }, `Declined ${inv.inviter.name}.`)
                      }
                    >
                      Decline
                    </button>
                  </>
                }
              />
            ))
          )}
        </section>
      ) : null}

      {!loading && tab === 'outgoing' ? (
        <section className="network-card">
          {outgoing.length === 0 ? (
            <p className="network-empty">You have not sent any invitations.</p>
          ) : (
            outgoing.map((inv) => (
              <div className="network-row" key={inv.id} data-testid={`network-sent-${inv.id}`}>
                <span className="network-avatar" aria-hidden="true">
                  {initials(inv.email)}
                </span>
                <div className="network-person">
                  <strong>{inv.email}</strong>
                  <span className="network-person-meta">
                    {statusLabel(inv.status)}
                    {inv.message ? ` · "${inv.message}"` : ''}
                  </span>
                </div>
                <div className="network-row-action">
                  {inv.status === 'PENDING' ? (
                    <button
                      type="button"
                      className="ghost-button small danger"
                      disabled={busy}
                      data-testid={`network-cancel-${inv.id}`}
                      onClick={() =>
                        run(async () => {
                          await networkApi.cancel(inv.id);
                        }, `Invitation to ${inv.email} cancelled.`)
                      }
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </section>
      ) : null}

      {!loading && tab === 'contacts' ? (
        <section className="network-card">
          {contacts.length === 0 ? (
            <p className="network-empty">No contacts yet. Send an invitation to get started.</p>
          ) : (
            contacts.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                action={
                  <>
                    <AddToTeam
                      person={person}
                      disabled={busy}
                      onAdded={(teamName) => {
                        setError('');
                        setStatus(`Added ${person.name} to ${teamName}.`);
                      }}
                      onError={setError}
                    />
                    <button
                      type="button"
                      className="ghost-button small danger"
                      disabled={busy}
                      data-testid={`network-remove-${person.id}`}
                      onClick={() =>
                        run(async () => {
                          await networkApi.removeContact(person.id);
                        }, `Removed ${person.name}.`)
                      }
                    >
                      Remove
                    </button>
                  </>
                }
              />
            ))
          )}
        </section>
      ) : null}

      {!loading && tab === 'directory' ? (
        <section className="network-card">
          {isCompany ? (
            <form className="network-search" onSubmit={onSearch}>
              <input
                type="search"
                className="text-input"
                placeholder="Search your organization"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="network-search"
              />
              <button type="submit" className="ghost-button" disabled={busy}>
                Search
              </button>
            </form>
          ) : (
            <form className="network-search" onSubmit={onSearch}>
              <input
                type="search"
                className="text-input"
                placeholder="Find people by name or email"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="network-search"
              />
              <button type="submit" className="ghost-button" disabled={busy}>
                Search
              </button>
            </form>
          )}
          {directoryPeople.length === 0 ? (
            <p className="network-empty">
              {isCompany
                ? 'No teammates match that search yet.'
                : searchResults
                  ? 'No people found. Check the spelling or invite them by email above.'
                  : 'Search to find people to invite.'}
            </p>
          ) : (
            directoryPeople.map((person) => {
              const alreadyContact = contactIds.has(person.id);
              return (
                <PersonRow
                  key={person.id}
                  person={person}
                  action={
                    isCompany ? null : alreadyContact ? (
                      <span className="hint">Connected</span>
                    ) : person.invite_pending ? (
                      <span className="hint">Invited</span>
                    ) : (
                      <button
                        type="button"
                        className="primary-button small"
                        disabled={busy}
                        data-testid={`network-invite-result-${person.id}`}
                        onClick={() =>
                          run(async () => {
                            await networkApi.invite(person.email);
                          }, `Invitation sent to ${person.email}.`)
                        }
                      >
                        Invite
                      </button>
                    )
                  }
                />
              );
            })
          )}
        </section>
      ) : null}
    </main>
  );
}
