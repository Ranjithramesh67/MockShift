'use strict';

function envCompletionsFor(word, keys) {
  const text = String(word || '');
  const prefix = text.startsWith('{{') ? text.slice(2) : text;
  const needle = prefix.toLowerCase();
  return (keys || [])
    .filter((key) => String(key).toLowerCase().startsWith(needle))
    .map((label) => ({ label, type: 'variable', detail: 'env', apply: label, boost: 2 }));
}

function templateTokenBefore(text) {
  const m = String(text || '').match(/\{\{([A-Za-z0-9_\-\.]*)$/);
  return m ? m[0] : null;
}

function envCompletionSource(keys) {
  const list = Array.isArray(keys) ? keys : [];
  return (context) => {
    const before = context.matchBefore(/\{\{[A-Za-z0-9_\-\.]*$/);
    if (!before || !String(before.text).startsWith('{{')) return null;
    return { from: before.from + 2, options: envCompletionsFor(before.text, list) };
  };
}

module.exports = {
  envCompletionsFor,
  envCompletionSource,
  templateTokenBefore,
};
