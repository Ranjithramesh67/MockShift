'use client';

// Generate the `mockshift.json` file that mockshift-sdk reads at startup.
// The portal knows the token plus its binding, so we can hand the user a
// ready-to-commit config (the token itself is only available once, at
// creation time).

export interface SdkConfigInput {
  token: string;
  baseUrl: string;
  project?: string | null;
  workspace?: string | null;
  collection?: string | null;
  include?: string[];
  exclude?: string[];
}

export interface SdkConfig {
  token: string;
  baseUrl: string;
  source: string;
  autoSync: boolean;
  capture: { enabled: boolean };
  assertions: { status: boolean; json: boolean };
  include?: string[];
  exclude?: string[];
  project?: string;
  workspace?: string;
  collection?: string;
}

// The SDK talks to the MockShift backend. When the portal is served from the
// same origin as the API (the usual deployment), the current origin is right.
export function defaultSdkBaseUrl(): string {
  const env = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_BASE_URL : undefined;
  if (env) return env.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3001';
}

export function buildSdkConfig(input: SdkConfigInput): SdkConfig {
  const config: SdkConfig = {
    token: input.token,
    baseUrl: (input.baseUrl || defaultSdkBaseUrl()).replace(/\/+$/, ''),
    source: 'express',
    autoSync: true,
    capture: { enabled: true },
    assertions: { status: true, json: true },
  };
  if (input.project) config.project = input.project;
  if (input.workspace) config.workspace = input.workspace;
  if (input.collection) config.collection = input.collection;
  if (input.include && input.include.length) config.include = input.include;
  if (input.exclude && input.exclude.length) config.exclude = input.exclude;
  return config;
}

export function renderSdkConfig(config: SdkConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function sdkInstallSnippet(): string {
  return [
    '$ npm install mockshift-sdk',
    '',
    '// server.js',
    "const { attach } = require('mockshift-sdk');",
    'attach(app); // reads ./mockshift.json and syncs registered routes',
    '',
    '$ npx mockshift-sdk sync --config mockshift.json',
  ].join('\n');
}
