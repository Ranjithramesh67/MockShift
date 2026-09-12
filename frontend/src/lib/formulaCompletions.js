'use strict';

const { SNIPPETS } = require('./formulaSnippets');

const REQUEST_PROPERTIES = ['body', 'headers', 'query', 'queryParams', 'url', 'method', 'name'];

const UTILITIES = [
  'uuid', 'randomInt', 'now', 'timestamp', 'addDays', 'addHours', 'addMinutes',
  'addMonths', 'round', 'capitalize', 'lower', 'upper', 'trim', 'base64Encode',
  'base64Decode',
];

const JS_BUILTINS = [
  'JSON', 'Object', 'Array', 'Math', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Map', 'Set', 'Promise', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone',
];

function option(label, type, detail) {
  return { label, type, detail, boost: type === 'variable' ? 1 : 0 };
}

const REQUEST_OPTIONS = REQUEST_PROPERTIES.map((label) => option(label, 'property', 'req.'));
const UTILITY_OPTIONS = UTILITIES.map((label) => option(label, 'function', '$utils'));
const BUILTIN_OPTIONS = JS_BUILTINS.map((label) => option(label, 'class', 'JavaScript'));
const SNIPPET_OPTIONS = SNIPPETS.map((snippet) =>
  option(snippet.title, 'text', snippet.code)
);

const FORMULA_COMPLETIONS = [
  option('req', 'variable', 'Incoming request'),
  option('$vars', 'variable', 'Captured variables'),
  option('$utils', 'variable', 'Sandbox helpers'),
  ...BUILTIN_OPTIONS,
  ...SNIPPET_OPTIONS,
];

/** Options relevant to the token the caret is inside. */
function completionsFor(word) {
  const text = String(word || '');
  if (text.startsWith('$utils.')) return UTILITY_OPTIONS;
  if (text.startsWith('req.')) return REQUEST_OPTIONS;
  if (text.startsWith('$vars.')) return [];
  return FORMULA_COMPLETIONS;
}

// Matches the dotted identifier fragment before the caret, e.g. `req.hea`.
const TOKEN = /[\w$.]*/;

/**
 * CodeMirror completion source. Kept free of any CodeMirror import so it can be
 * unit tested with a small fake context.
 */
function formulaCompletionSource(context) {
  const before = context.matchBefore(TOKEN);
  if (!before || (before.from === before.to && !context.explicit)) return null;
  const word = before.text;
  const dot = word.lastIndexOf('.');
  const from = before.from + (dot >= 0 ? dot + 1 : 0);
  return { from, options: completionsFor(word) };
}

module.exports = {
  FORMULA_COMPLETIONS,
  REQUEST_OPTIONS,
  UTILITY_OPTIONS,
  completionsFor,
  formulaCompletionSource,
};
