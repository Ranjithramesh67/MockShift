'use client';

import React from 'react';
import { PresetAvatar, isPresetAvatarKey } from './AvatarPresets';
import type { ProfileAvatar } from '@/lib/api';

export interface UserAvatarProps {
  avatar?: ProfileAvatar | null;
  name?: string;
  size?: number;
  className?: string;
  ariaLabel?: string;
  'data-testid'?: string;
}

// Single renderer for the user's avatar everywhere it appears (top bar chip,
// top bar dropdown, profile page): uploaded image when one is stored, else the
// matching preset orb, else the initial-letter fallback already used in the top
// bar. Sizing stays fluid: callers pick the pixel size, the existing .user-avatar
// visual (round gradient disc) is reused as the container.
export function UserAvatar({
  avatar,
  name = '',
  size = 24,
  className = '',
  ariaLabel,
  'data-testid': testId,
}: UserAvatarProps) {
  const initial = (name || '').trim().charAt(0).toUpperCase() || '?';
  const cls = ['user-avatar', className].filter(Boolean).join(' ');
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(11, Math.round(size * 0.42)),
  };

  let kind: 'upload' | 'preset' | 'none' = 'none';
  let content: React.ReactNode;
  if (avatar?.uploaded) {
    kind = 'upload';
    const ts = avatar.updated_at ? `?t=${encodeURIComponent(avatar.updated_at)}` : '';
    content = <img src={`/api/profile/avatar${ts}`} alt="" className="user-avatar-img" />;
  } else if (avatar?.preset_key && isPresetAvatarKey(avatar.preset_key)) {
    kind = 'preset';
    content = <PresetAvatar presetKey={avatar.preset_key} size={size} ariaLabel={ariaLabel} />;
  } else {
    content = <span className="user-avatar-letter" aria-hidden="true">{initial}</span>;
  }

  const wrapperProps =
    kind === 'upload'
      ? { role: 'img', 'aria-label': ariaLabel || `${name || 'User'} avatar` }
      : kind === 'preset'
        ? {}
        : ariaLabel
          ? { role: 'img', 'aria-label': ariaLabel }
          : {};

  return (
    <span
      className={cls}
      style={style}
      data-testid={testId ?? 'user-avatar'}
      data-avatar-kind={kind}
      {...wrapperProps}
    >
      {content}
    </span>
  );
}
