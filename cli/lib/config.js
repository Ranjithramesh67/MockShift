'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_BASE_URL = 'http://localhost:3001';

function configDir() {
  return process.env.APIHUB_CONFIG_DIR || path.join(os.homedir(), '.config', 'apihub');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

function emptyConfig() {
  return { baseUrl: undefined, token: undefined, defaultWorkspaceId: undefined };
}

function loadConfig() {
  const file = configPath();
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      const fallback = path.join(configDir(), `config.json.invalid-${Date.now()}.bak`);
      try {
        fs.renameSync(file, fallback);
      } catch {
        return emptyConfig();
      }
    }
    return emptyConfig();
  }
  const cfg = emptyConfig();
  if (typeof raw.baseUrl === 'string' && raw.baseUrl.trim()) cfg.baseUrl = raw.baseUrl.trim();
  if (typeof raw.token === 'string' && raw.token.trim()) cfg.token = raw.token.trim();
  if (typeof raw.defaultWorkspaceId === 'string' && raw.defaultWorkspaceId.trim()) {
    cfg.defaultWorkspaceId = raw.defaultWorkspaceId.trim();
  }
  return cfg;
}

function saveConfig(cfg) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best effort */
  }
  const file = configPath();
  const cleaned = {
    baseUrl: cfg.baseUrl || undefined,
    token: cfg.token || undefined,
    defaultWorkspaceId: cfg.defaultWorkspaceId || undefined,
  };
  fs.writeFileSync(file, `${JSON.stringify(cleaned, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
  return file;
}

function normalizeBaseUrl(input) {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

function resolveBaseUrl({ flag, env, config } = {}) {
  const fromFlag = normalizeBaseUrl(flag);
  if (fromFlag) return fromFlag;
  const fromEnv = normalizeBaseUrl(env && process.env[env]);
  if (fromEnv) return fromEnv;
  const fromConfig = config ? normalizeBaseUrl(config.baseUrl) : undefined;
  return fromConfig || DEFAULT_BASE_URL;
}

function resolveToken({ flag, env, config } = {}) {
  if (flag && String(flag).trim()) return String(flag).trim();
  if (env && process.env[env] && String(process.env[env]).trim()) {
    return String(process.env[env]).trim();
  }
  if (config && config.token && String(config.token).trim()) return String(config.token).trim();
  return undefined;
}

function tokenPrefix(token) {
  if (!token) return '';
  return token.length > 12 ? token.slice(0, 12) : token;
}

module.exports = {
  DEFAULT_BASE_URL,
  configDir,
  configPath,
  loadConfig,
  saveConfig,
  resolveBaseUrl,
  resolveToken,
  tokenPrefix,
  normalizeBaseUrl,
  emptyConfig,
};
