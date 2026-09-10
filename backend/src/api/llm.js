'use strict';

// ============================================================================
// AI copilot — provider abstraction.
//
// This module is BYO-key and project-scoped: it reads ONLY
//   USER_LLM_API_KEY, USER_LLM_BASE_URL, USER_LLM_MODEL
// and must never consult platform/agent credentials (MCAI_*, OPENAI_API_KEY,
// OPEN_CODE_API_KEY, ...) or any other ambient var. When the three vars are not
// all present the module is "unconfigured": callers get a clear 503 and the
// real implementation performs NO network I/O.
//
// The provider contract is the OpenAI-compatible chat-completions API. The
// network call is isolated in `defaultCallModel` and injectable via
// `setCallModel` so tests can stub it without touching the network.
//
// The API key is only ever read here and placed into an outbound Authorization
// header — it is never logged, returned or persisted.
// ============================================================================

const CONFIG_KEYS = Object.freeze({
  apiKey: 'USER_LLM_API_KEY',
  baseUrl: 'USER_LLM_BASE_URL',
  model: 'USER_LLM_MODEL',
});

const PROVIDER_LABEL = 'openai-compatible';
const DEFAULT_TIMEOUT_MS = 30000;

class LlmNotConfiguredError extends Error {
  constructor(message) {
    super(
      message ||
        'AI copilot is not configured. Set USER_LLM_API_KEY, USER_LLM_BASE_URL and USER_LLM_MODEL.'
    );
    this.name = 'LlmNotConfiguredError';
    this.code = 'LLM_NOT_CONFIGURED';
    this.status = 503;
  }
}

class LlmProviderError extends Error {
  constructor(message, status) {
    super(message || 'AI provider request failed');
    this.name = 'LlmProviderError';
    this.code = 'LLM_PROVIDER_ERROR';
    this.status = status || 502;
  }
}

// Read the project-scoped config. Only the three USER_LLM_* vars are consulted.
function readConfig(env = process.env) {
  const src = env || {};
  const apiKey = typeof src[CONFIG_KEYS.apiKey] === 'string' ? src[CONFIG_KEYS.apiKey].trim() : '';
  const baseUrl = typeof src[CONFIG_KEYS.baseUrl] === 'string' ? src[CONFIG_KEYS.baseUrl].trim() : '';
  const model = typeof src[CONFIG_KEYS.model] === 'string' ? src[CONFIG_KEYS.model].trim() : '';
  return { apiKey, baseUrl, model, configured: Boolean(apiKey && baseUrl && model) };
}

function isConfigured(env = process.env) {
  return readConfig(env).configured;
}

// Safe-to-serve description: never includes the API key.
function describeConfig(env = process.env) {
  const cfg = readConfig(env);
  return { configured: cfg.configured, model: cfg.model || null, provider: cfg.configured ? PROVIDER_LABEL : null };
}

// Accept a base URL with or without a trailing /chat/completions or /v1.
function chatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl).replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

async function defaultCallModel({
  system,
  prompt,
  temperature,
  maxTokens,
  json = true,
  env,
  signal,
  timeoutMs,
} = {}) {
  const cfg = readConfig(env);
  // Guard before any I/O: an unconfigured project must not reach the network.
  if (!cfg.configured) throw new LlmNotConfiguredError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const messages = [];
    if (system) messages.push({ role: 'system', content: String(system) });
    messages.push({ role: 'user', content: String(prompt == null ? '' : prompt) });

    const payload = {
      model: cfg.model,
      messages,
      temperature: typeof temperature === 'number' ? temperature : 0,
      max_tokens: typeof maxTokens === 'number' ? maxTokens : 1024,
    };
    if (json) payload.response_format = { type: 'json_object' };

    const res = await fetch(chatCompletionsUrl(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Never surface the provider body — it may echo request content.
      throw new LlmProviderError(`AI provider returned HTTP ${res.status}`, 502);
    }

    const data = await res.json();
    const message = data && data.choices && data.choices[0] && data.choices[0].message;
    const raw = message ? message.content : '';
    const usage = (data && data.usage) || {};
    return {
      text: typeof raw === 'string' ? raw : JSON.stringify(raw == null ? '' : raw),
      usage: {
        promptTokens: usage.prompt_tokens == null ? null : usage.prompt_tokens,
        completionTokens: usage.completion_tokens == null ? null : usage.completion_tokens,
        totalTokens: usage.total_tokens == null ? null : usage.total_tokens,
      },
      model: (data && data.model) || cfg.model,
      provider: PROVIDER_LABEL,
    };
  } catch (err) {
    if (err instanceof LlmNotConfiguredError || err instanceof LlmProviderError) throw err;
    if (err && err.name === 'AbortError') {
      throw new LlmProviderError('AI provider request timed out', 504);
    }
    throw new LlmProviderError('AI provider request failed', 502);
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Injectable seam. Tests call `setCallModel(fake)` (or replace the exported
// `callModel` property) so no real network/key is required.
let callModelImpl = defaultCallModel;

function setCallModel(fn) {
  callModelImpl = typeof fn === 'function' ? fn : defaultCallModel;
}

function resetCallModel() {
  callModelImpl = defaultCallModel;
}

async function callModel(input) {
  return callModelImpl(input);
}

module.exports = {
  CONFIG_KEYS,
  PROVIDER_LABEL,
  LlmNotConfiguredError,
  LlmProviderError,
  readConfig,
  isConfigured,
  describeConfig,
  chatCompletionsUrl,
  defaultCallModel,
  setCallModel,
  resetCallModel,
  callModel,
};
