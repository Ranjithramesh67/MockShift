'use strict';

// Framework-free helpers for the per-user LLM form.
function isLlmConfigComplete(input) {
  const src = input || {};
  const apiKey = String(src.apiKey || '').trim();
  const baseUrl = String(src.baseUrl || '').trim();
  const model = String(src.model || '').trim();
  if (!apiKey || !model) return false;
  return /^https?:\/\/.+/i.test(baseUrl);
}

function maskKey(key) {
  const value = String(key || '');
  if (value.length <= 4) return value ? '••••' : '';
  return `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

module.exports = { isLlmConfigComplete, maskKey };
