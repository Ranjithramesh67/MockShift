'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/lib/profile';
import { profileApi, llmConfigApi, type Profile, type ProfileAvatar, type UserLlmConfig } from '@/lib/api';
import { isLlmConfigComplete } from '@/lib/llmConfig';
import { PORTAL_PLANS_URL, portalPlansUrl, portalUrlFor } from '@/lib/portalUrl';
import { PresetAvatar, PRESET_AVATAR_KEYS, isPresetAvatarKey } from './AvatarPresets';
import { UserAvatar } from './UserAvatar';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const SUB_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  TRIALING: 'Trial',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
};

const SUB_STATUS_TONE: Record<string, string> = {
  ACTIVE: 'active',
  TRIALING: 'trial',
  PAST_DUE: 'past-due',
  SUSPENDED: 'suspended',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function cycleLabel(cycle: string): string {
  if (cycle === 'YEARLY') return 'Yearly';
  if (cycle === 'MONTHLY') return 'Monthly';
  return cycle;
}

type AvatarKind = 'upload' | 'preset' | 'none';

function avatarKind(avatar: ProfileAvatar | null | undefined): AvatarKind {
  if (avatar?.uploaded) return 'upload';
  if (avatar?.preset_key && isPresetAvatarKey(avatar.preset_key)) return 'preset';
  return 'none';
}

function Msg({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null;
  return (
    <p className={`profile-msg profile-msg-${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
      {msg.text}
    </p>
  );
}

// Plan usage bars (restrictions programme L5). GET /api/profile carries an
// additive `plan` entitlement snapshot from the main backend:
//   plan = { key, name, enforced, reason, poolOrgId,
//            limits: { [key]: number|null },   // null = unlimited
//            usage:  { [key]: number } }
// Bars render for every counted resource; a numeric limit draws the meter,
// `null`/missing limit shows only the used count. Over-limit (enforced and
// used > limit) gets a "over limit" badge.
const USAGE_ROWS: Array<{ key: string; limitKey: string; label: string }> = [
  { key: 'workspaces', limitKey: 'workspaces', label: 'Workspaces' },
  { key: 'projects', limitKey: 'projects', label: 'Projects' },
  { key: 'collections', limitKey: 'collections', label: 'Collections' },
  { key: 'teams', limitKey: 'teams', label: 'Teams' },
  { key: 'seats', limitKey: 'seats', label: 'Seats' },
  { key: 'runs', limitKey: 'runs_per_month', label: 'Runs this month' },
];

function PlanUsage({ profile }: { profile: Profile }) {
  const plan = profile.plan;
  if (!plan || !plan.usage || typeof plan.usage !== 'object') return null;
  const usage = plan.usage as Record<string, number>;
  const limits = (plan.limits ?? {}) as Record<string, number | null>;
  const entries = USAGE_ROWS.map((row) => ({
    ...row,
    used: Number(usage[row.key]) || 0,
    limit: typeof limits[row.limitKey] === 'number' ? (limits[row.limitKey] as number) : null,
  })).filter((e) => e.limit !== null || e.used > 0);
  if (entries.length === 0) return null;
  return (
    <section className="profile-card" data-testid="profile-usage-section" aria-labelledby="profile-usage-title">
      <h2 className="profile-card-title" id="profile-usage-title">
        Plan usage
      </h2>
      <div className="profile-usage-list">
        {entries.map((e) => {
          const pct = e.limit !== null && e.limit > 0 ? Math.min(100, Math.round((e.used / e.limit) * 100)) : 0;
          const over = e.limit !== null && e.used > e.limit;
          const meter = e.limit !== null && e.limit > 0;
          return (
            <div
              className={`profile-usage-row${over ? ' over' : ''}`}
              key={e.key}
              data-testid={`profile-usage-bar-${e.key}`}
            >
              <div className="profile-usage-meta">
                <span className="profile-usage-label">{e.label}</span>
                <span className="profile-usage-value">
                  {e.used.toLocaleString()}
                  {e.limit !== null ? ` / ${e.limit.toLocaleString()}` : ''}
                  {over ? (
                    <span className="profile-usage-over" data-testid={`profile-usage-over-${e.key}`}>
                      over limit
                    </span>
                  ) : null}
                </span>
              </div>
              {meter ? (
                <div
                  className="profile-usage-track"
                  role="meter"
                  aria-valuenow={e.used}
                  aria-valuemin={0}
                  aria-valuemax={e.limit ?? undefined}
                  aria-label={`${e.label}: ${e.used} of ${e.limit}`}
                >
                  <span className={`profile-usage-fill${pct >= 100 ? ' full' : ''}`} style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SubscriptionCard({ profile }: { profile: Profile }) {
  const sub = profile.subscription;
  if (!sub) {
    return (
      <section className="profile-card profile-upsell" data-testid="profile-upsell" aria-labelledby="profile-upsell-title">
        <h2 className="profile-card-title" id="profile-upsell-title">
          Plan
        </h2>
        <div className="profile-upsell-body">
          <p className="profile-upsell-text">
            <strong>No active plan</strong> — you are using API Hub without a paid subscription. Pick a plan to unlock
            more requests, team seats and workflow runs.
          </p>
          <UpsellPlansLink />
        </div>
      </section>
    );
  }

  const status = String(sub.status).toUpperCase();
  const statusLabel = SUB_STATUS_LABEL[status] ?? status;
  const tone = SUB_STATUS_TONE[status] ?? 'neutral';
  const planName = sub.plan.name || sub.plan.key;
  const end = fmtDate(sub.current_period_end);
  const trialEnd = sub.status === 'TRIALING' ? fmtDate(sub.trial_ends_at) : '';
  const periodLabel = sub.cancel_at_period_end ? 'Valid through' : 'Renews on';
  const manageHref = portalUrlFor('/account');
  const changeHref = portalUrlFor(
    `/checkout?plan=${encodeURIComponent(sub.plan.key)}&cycle=${encodeURIComponent(sub.billing_cycle)}`
  );

  return (
    <section className="profile-card profile-sub-card" data-testid="profile-sub-card" aria-labelledby="profile-sub-title">
      <h2 className="profile-card-title" id="profile-sub-title">
        Subscription
      </h2>
      <div className="profile-sub-head">
        <div className="profile-sub-plan">
          <span className="profile-sub-plan-name">{planName}</span>
          <span className="profile-plan-key" data-testid="profile-sub-plan-key">
            {sub.plan.key}
          </span>
        </div>
        <span className={`profile-status profile-status-${tone}`} data-testid="profile-sub-status">
          {statusLabel}
        </span>
        {sub.cancel_at_period_end && (
          <span className="profile-cancel-chip" data-testid="profile-sub-cancel-chip">
            Cancel scheduled
          </span>
        )}
      </div>
      <dl className="profile-sub-details">
        <div className="profile-sub-row">
          <dt>Billing cycle</dt>
          <dd data-testid="profile-sub-cycle">{cycleLabel(sub.billing_cycle)}</dd>
        </div>
        {end && (
          <div className="profile-sub-row">
            <dt>{periodLabel}</dt>
            <dd data-testid="profile-sub-period">{end}</dd>
          </div>
        )}
        {trialEnd && (
          <div className="profile-sub-row">
            <dt>Trial ends on</dt>
            <dd data-testid="profile-sub-trial-end">{trialEnd}</dd>
          </div>
        )}
      </dl>
      {sub.cancel_at_period_end && (
        <p className="profile-cancel-note" data-testid="profile-sub-cancel-note">
          Cancellation scheduled — your {planName} plan stays active{end ? ` until ${end}` : ''}.
        </p>
      )}
      <p className="profile-sub-hint">
        Billing is managed from the subscription portal. Plan changes apply at your next renewal.
      </p>
      <div className="profile-sub-actions">
        <a className="ghost-button" data-testid="profile-manage-link" href={manageHref}>
          Manage subscription
        </a>
        <a className="primary-button" data-testid="profile-change-plan-link" href={changeHref}>
          Change plan
        </a>
      </div>
    </section>
  );
}

function UpsellPlansLink() {
  // SSR/hydration render the constant default; after mount the real portal
  // origin is resolved (env override or the *.monkeycode-ai.live sibling host).
  const [plansHref, setPlansHref] = useState<string>(PORTAL_PLANS_URL);
  useEffect(() => {
    setPlansHref(portalPlansUrl());
  }, []);
  return (
    <a className="primary-button" data-testid="profile-upsell-plans-link" href={plansHref}>
      See plans &amp; pricing
    </a>
  );
}

function PersonalDetailsForm({
  profile,
  onSaved,
  onMessage,
}: {
  profile: Profile;
  onSaved: () => void;
  onMessage: (msg: { kind: 'ok' | 'err'; text: string } | null) => void;
}) {
  const user = profile.user;
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile.user.name);
    setUsername(profile.user.username);
  }, [profile.user.id, profile.user.name, profile.user.username]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedUsername = username.trim();
    if (!trimmedName) {
      onMessage({ kind: 'err', text: 'Name is required' });
      return;
    }
    if (!trimmedUsername) {
      onMessage({ kind: 'err', text: 'Username is required' });
      return;
    }
    setBusy(true);
    onMessage(null);
    try {
      await profileApi.update({ name: trimmedName, username: trimmedUsername });
      onSaved();
      onMessage({ kind: 'ok', text: 'Profile details saved.' });
    } catch (err) {
      onMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to save profile' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="profile-form" onSubmit={onSubmit} data-testid="profile-details-form">
      <label className="auth-field profile-field">
        <span>Name</span>
        <input
          type="text"
          autoComplete="name"
          data-testid="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="auth-field profile-field">
        <span>Username</span>
        <input
          type="text"
          autoComplete="username"
          data-testid="profile-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <span className="profile-field-hint">Public handle used for team mentions and shared links.</span>
      </label>
      <label className="auth-field profile-field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          data-testid="profile-email"
          value={user.email}
          readOnly
          tabIndex={-1}
          aria-readonly="true"
        />
        <span className="profile-field-hint">Email is your login id and cannot be changed.</span>
      </label>
      <div className="profile-form-actions">
        <button type="submit" className="primary-button" data-testid="profile-save" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function PasswordForm({ onMessage }: { onMessage: (msg: { kind: 'ok' | 'err'; text: string } | null) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      onMessage({ kind: 'err', text: 'New password must be at least 8 characters' });
      return;
    }
    setBusy(true);
    onMessage(null);
    try {
      await profileApi.changePassword({ current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      onMessage({ kind: 'ok', text: 'Password updated.' });
    } catch (err) {
      onMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to change password' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="profile-form" onSubmit={onSubmit} data-testid="profile-password-form">
      <label className="auth-field profile-field">
        <span>Current password</span>
        <input
          type="password"
          autoComplete="current-password"
          data-testid="profile-pw-current"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </label>
      <label className="auth-field profile-field">
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          data-testid="profile-pw-new"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="8+ characters"
          required
        />
      </label>
      <div className="profile-form-actions">
        <button type="submit" className="ghost-button" data-testid="profile-pw-submit" disabled={busy}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  );
}

function AvatarSection({
  profile,
  reloadProfile,
  onMessage,
}: {
  profile: Profile;
  reloadProfile: () => Promise<void>;
  onMessage: (msg: { kind: 'ok' | 'err'; text: string } | null) => void;
}) {
  const avatar = profile.user.avatar;
  const kind = avatarKind(avatar);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true);
    onMessage(null);
    try {
      await fn();
      await reloadProfile();
      onMessage(okText ? { kind: 'ok', text: okText } : null);
    } catch (err) {
      onMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Avatar update failed' });
    } finally {
      setBusy(false);
    }
  };

  const pickPreset = (preset: string) => act(() => profileApi.setPreset(preset));

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      onMessage({ kind: 'err', text: 'Avatar image must be 2 MB or smaller' });
      return;
    }
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      onMessage({ kind: 'err', text: 'Use a PNG, JPEG, GIF or WebP image' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma === -1) {
        onMessage({ kind: 'err', text: 'Could not read that image' });
        return;
      }
      void act(() => profileApi.upload(dataUrl.slice(comma + 1), file.type), 'Avatar uploaded.');
    };
    reader.onerror = () => onMessage({ kind: 'err', text: 'Could not read that image' });
    reader.readAsDataURL(file);
  };

  const removeAvatar = () => act(() => profileApi.removeAvatar(), 'Avatar removed.');

  return (
    <div className="profile-avatar-body" data-testid="profile-avatar-section">
      <div className="profile-avatar-preview">
        <div className="profile-avatar-frame" data-testid="profile-avatar-current" data-avatar-kind={kind}>
          <UserAvatar avatar={avatar} name={profile.user.name} size={84} ariaLabel="Your avatar" />
        </div>
        <p className="profile-avatar-kind">
          {kind === 'upload' && 'Uploaded image'}
          {kind === 'preset' && `Preset — ${avatar?.preset_key ?? ''}`}
          {kind === 'none' && 'No avatar set'}
        </p>
      </div>

      <p className="profile-section-sub">Choose a preset avatar</p>
      <div className="profile-preset-grid">
        {PRESET_AVATAR_KEYS.map((key) => {
          const selected = kind === 'preset' && avatar?.preset_key === key;
          return (
            <button
              type="button"
              key={key}
              className={`profile-preset${selected ? ' selected' : ''}`}
              data-testid={`profile-preset-${key}`}
              aria-pressed={selected}
              aria-label={`Use ${key} avatar`}
              title={key}
              disabled={busy}
              onClick={() => void pickPreset(key)}
            >
              <PresetAvatar presetKey={key} size={44} ariaLabel={`${key} avatar`} />
              {selected && <span className="profile-preset-check">Selected</span>}
            </button>
          );
        })}
      </div>

      <div className="profile-avatar-actions">
        <input
          id="profile-avatar-file"
          type="file"
          accept={ALLOWED_AVATAR_TYPES.join(',')}
          className="profile-file-input"
          data-testid="profile-avatar-upload"
          onChange={onFileChange}
        />
        <label htmlFor="profile-avatar-file" className="ghost-button" data-testid="profile-avatar-upload-label">
          Upload image
        </label>
        {kind !== 'none' && (
          <button
            type="button"
            className="ghost-button danger-text"
            data-testid="profile-avatar-remove"
            disabled={busy}
            onClick={() => void removeAvatar()}
          >
            Remove
          </button>
        )}
      </div>
      <p className="profile-field-hint">PNG, JPEG, GIF or WebP, up to 2 MB.</p>
    </div>
  );
}

export function ProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading, logout, refresh } = useAuth();
  const { profile, loading: profileLoading, error, unauthorized, reload } = useProfile();
  const [sectionMsg, setSectionMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (unauthorized) {
      void logout();
      router.replace('/login');
    }
  }, [unauthorized, logout, router]);

  const signOut = async () => {
    await logout();
    router.replace('/login');
  };

  const showSectionMsg = (msg: { kind: 'ok' | 'err'; text: string } | null) => setSectionMsg(msg);

  if (authLoading) {
    return (
      <div className="loading-screen" data-testid="loading-splash">
        <span className="spinner" />
        Loading…
      </div>
    );
  }
  if (!user) return null;

  if (profileLoading && !profile) {
    return (
      <div className="loading-screen" data-testid="profile-loading">
        <span className="spinner" />
        Loading profile…
      </div>
    );
  }

  return (
    <div className="profile-screen" data-testid="profile-page">
      <header className="profile-topbar">
        <Link href="/" className="profile-topbar-brand" data-testid="profile-topbar-brand" aria-label="Back to workspace">
          <span className="brand-mark">AH</span>
          <span className="brand-name">API Hub</span>
        </Link>
        <span className="profile-topbar-divider" aria-hidden="true" />
        <span className="profile-topbar-title">Profile</span>
        <div className="profile-topbar-user">
          <UserAvatar avatar={profile?.user?.avatar ?? null} name={profile?.user?.name ?? user?.name ?? ''} size={28} />
          <span className="profile-topbar-name">{profile?.user?.name ?? user?.name}</span>
          <button type="button" className="ghost-button small" data-testid="profile-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {error && !profile && (
        <div className="profile-error" data-testid="profile-error" role="alert">
          <p>{error}</p>
          <button type="button" className="ghost-button" data-testid="profile-retry" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}

      {profile && (
        <main className="profile-main">
          <div className="profile-head">
            <UserAvatar avatar={profile.user.avatar} name={profile.user.name} size={72} ariaLabel="Your avatar" />
            <div className="profile-head-text">
              <h1 data-testid="profile-head-name">{profile.user.name}</h1>
              <p className="profile-head-meta">
                {profile.user.email} <span aria-hidden="true">·</span>{' '}
                <span className={`role-badge role-${profile.user.role}`}>{profile.user.role}</span>
              </p>
            </div>
          </div>

          <Msg msg={sectionMsg} />

          <SubscriptionCard profile={profile} />
          <PlanUsage profile={profile} />

          <section className="profile-card" aria-labelledby="profile-details-title">
            <h2 className="profile-card-title" id="profile-details-title">
              Personal details
            </h2>
            <PersonalDetailsForm
              profile={profile}
              onMessage={showSectionMsg}
              onSaved={() => {
                void refresh();
                void reload();
              }}
            />
          </section>

          <section className="profile-card" aria-labelledby="profile-avatar-title">
            <h2 className="profile-card-title" id="profile-avatar-title">
              Avatar
            </h2>
            <AvatarSection profile={profile} reloadProfile={reload} onMessage={showSectionMsg} />
          </section>

          <section className="profile-card" aria-labelledby="profile-llm-title">
            <h2 className="profile-card-title" id="profile-llm-title">
              AI model
            </h2>
            <LlmModelSection onMessage={showSectionMsg} />
          </section>

          <section className="profile-card" aria-labelledby="profile-password-title">
            <h2 className="profile-card-title" id="profile-password-title">
              Change password
            </h2>
            <PasswordForm onMessage={showSectionMsg} />
          </section>
        </main>
      )}
    </div>
  );
}

function LlmModelSection({ onMessage }: { onMessage: (msg: { kind: 'ok' | 'err'; text: string } | null) => void }) {
  const [state, setState] = useState<UserLlmConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');

  const load = async () => {
    try {
      const res = await llmConfigApi.get();
      setState(res);
      setBaseUrl(res.baseUrl ?? '');
      setModel(res.model ?? '');
    } catch {
      setState(null);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!loaded || !state || !state.allowed) return null;

  const save = async () => {
    if (!isLlmConfigComplete({ apiKey, baseUrl, model })) {
      onMessage({ kind: 'err', text: 'Enter an API key, an http(s) base URL and a model.' });
      return;
    }
    setBusy(true);
    try {
      await llmConfigApi.put({ apiKey, baseUrl, model });
      setApiKey('');
      onMessage({ kind: 'ok', text: 'AI model saved.' });
      await load();
    } catch (err) {
      onMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save model' });
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      await llmConfigApi.remove();
      setApiKey('');
      setBaseUrl('');
      setModel('');
      onMessage({ kind: 'ok', text: 'AI model removed. Falling back to the server default.' });
      await load();
    } catch (err) {
      onMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not remove model' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="profile-llm-section">
      <p className="profile-section-sub" data-testid="profile-llm-status">
        {state.configured && state.source === 'user'
          ? `Using your model (${state.model}).`
          : 'No personal model configured — the copilot uses the server default.'}
      </p>
      <div className="profile-form">
        <label className="field">
          <span className="field-label">API key</span>
          <input
            className="text-input"
            type="password"
            data-testid="profile-llm-key"
            placeholder={state.configured && state.source === 'user' ? 'Replace stored key' : 'sk-...'}
            value={apiKey}
            disabled={busy}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Base URL</span>
          <input
            className="text-input"
            data-testid="profile-llm-base-url"
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            disabled={busy}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <input
            className="text-input"
            data-testid="profile-llm-model"
            placeholder="gpt-4o-mini"
            value={model}
            disabled={busy}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <div className="profile-form-actions">
          <button type="button" className="primary-button" data-testid="profile-llm-save" disabled={busy} onClick={() => void save()}>
            Save model
          </button>
          {state.configured && state.source === 'user' && (
            <button type="button" className="ghost-button danger-text" data-testid="profile-llm-remove" disabled={busy} onClick={() => void forget()}>
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="profile-field-hint">The key is encrypted at rest and never shown again.</p>
    </div>
  );
}
