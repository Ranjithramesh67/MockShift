'use client';

import React from 'react';

// Bundled preset avatars for the profile page. Backend PR-1 stores a preset key
// (e.g. "preset-1") on the user; the UI renders the matching local visual so no
// image fetch is needed. Visual language: a soft radial "orb" whose highlight is
// offset to the top-left, overlaid with a dark translucent geometric glyph. The
// palette follows the app's dark-green / mint design system.

const PRESET_KEYS = [
  'preset-1',
  'preset-2',
  'preset-3',
  'preset-4',
  'preset-5',
  'preset-6',
  'preset-7',
  'preset-8',
  'preset-9',
  'preset-10',
  'preset-11',
  'preset-12',
] as const;

export type PresetAvatarKey = (typeof PRESET_KEYS)[number];

export const PRESET_AVATAR_KEYS: readonly string[] = PRESET_KEYS;

export function isPresetAvatarKey(value: unknown): value is PresetAvatarKey {
  return typeof value === 'string' && (PRESET_KEYS as readonly string[]).includes(value);
}

const PRESET_BG: Record<PresetAvatarKey, string> = {
  'preset-1': 'radial-gradient(circle at 32% 28%, #e2ffe9 0%, #7cf29c 42%, #2ea269 78%, #124c2c 100%)',
  'preset-2': 'radial-gradient(circle at 32% 28%, #cffff8 0%, #37d3c0 42%, #159a90 76%, #0b4f4a 100%)',
  'preset-3': 'radial-gradient(circle at 32% 28%, #e9ffd1 0%, #a3e635 44%, #4d9e2c 78%, #1f4f12 100%)',
  'preset-4': 'radial-gradient(circle at 32% 28%, #dff4ff 0%, #5bc0f0 44%, #1f7fbf 78%, #0d3d63 100%)',
  'preset-5': 'radial-gradient(circle at 32% 28%, #ece8ff 0%, #8d82f2 44%, #4f42bf 78%, #241b66 100%)',
  'preset-6': 'radial-gradient(circle at 32% 28%, #f3e6ff 0%, #bd7ff0 44%, #7c35b8 80%, #3a1259 100%)',
  'preset-7': 'radial-gradient(circle at 32% 28%, #ffe4f4 0%, #ef70c0 44%, #b02e86 78%, #5c0f42 100%)',
  'preset-8': 'radial-gradient(circle at 32% 28%, #ffe3e0 0%, #f07872 44%, #c24038 78%, #6b140f 100%)',
  'preset-9': 'radial-gradient(circle at 32% 28%, #fff3d6 0%, #f4b942 44%, #c77f16 78%, #6b4306 100%)',
  'preset-10': 'radial-gradient(circle at 32% 28%, #ffe4d1 0%, #f78a4c 44%, #d15f1c 78%, #6e2c08 100%)',
  'preset-11': 'radial-gradient(circle at 32% 28%, #e4efff 0%, #5b8ce8 44%, #2c56a8 78%, #122652 100%)',
  'preset-12': 'radial-gradient(circle at 32% 28%, #eef5e0 0%, #9fc26a 46%, #5c8542 80%, #25401c 100%)',
};

const PRESET_LABEL: Record<PresetAvatarKey, string> = {
  'preset-1': 'Mint orb',
  'preset-2': 'Teal network',
  'preset-3': 'Lime bolt',
  'preset-4': 'Azure code',
  'preset-5': 'Indigo spark',
  'preset-6': 'Violet vault',
  'preset-7': 'Magenta hash',
  'preset-8': 'Coral wave',
  'preset-9': 'Amber play',
  'preset-10': 'Orange drop',
  'preset-11': 'Blue database',
  'preset-12': 'Sage compass',
};

function glyph(key: PresetAvatarKey) {
  switch (key) {
    case 'preset-1':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </>
      );
    case 'preset-2':
      return (
        <>
          <circle cx="7" cy="12" r="2.4" />
          <circle cx="17" cy="6" r="2.4" />
          <circle cx="17" cy="18" r="2.4" />
          <path d="M9.3 11 14.8 7M9.3 13 14.8 17" />
        </>
      );
    case 'preset-3':
      return <path d="M13 2 3.5 13.5H11L9.5 22 20 9.5h-7.5L13 2z" fill="currentColor" fillOpacity="0.9" stroke="none" />;
    case 'preset-4':
      return <path d="m8 6-5 6 5 6M16 6l5 6-5 6" />;
    case 'preset-5':
      return <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3z" fill="currentColor" fillOpacity="0.9" stroke="none" />;
    case 'preset-6':
      return (
        <>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </>
      );
    case 'preset-7':
      return <path d="M9 4 7 20M17 4l-2 16M4 9h16M4 15h16" />;
    case 'preset-8':
      return <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" />;
    case 'preset-9':
      return <path d="M8 5v14l11-7z" fill="currentColor" fillOpacity="0.9" stroke="none" />;
    case 'preset-10':
      return <path d="M12 3c3.5 4.5 6 7.4 6 10.4a6 6 0 0 1-12 0C6 10.4 8.5 7.5 12 3z" />;
    case 'preset-11':
      return (
        <>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </>
      );
    case 'preset-12':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
        </>
      );
  }
}

export function PresetAvatar({
  presetKey,
  size = 40,
  className,
  ariaLabel,
}: {
  presetKey: string;
  size?: number;
  className?: string;
  ariaLabel?: string;
}) {
  if (!isPresetAvatarKey(presetKey)) return null;
  return (
    <span
      className={`preset-avatar${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={ariaLabel || PRESET_LABEL[presetKey]}
      data-preset-key={presetKey}
      style={{ width: size, height: size, background: PRESET_BG[presetKey] }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {glyph(presetKey)}
      </svg>
    </span>
  );
}
