'use strict';

function getErrorPosition(error, text) {
  const src = String(text || '');
  let m;
  if ((m = String(error && error.message).match(/at position (\d+)/))) {
    return Math.min(Number(m[1]), src.length);
  }
  if ((m = String(error && error.message).match(/at line (\d+) column (\d+)/))) {
    const line = Number(m[1]);
    const col = Number(m[2]);
    let pos = 0;
    const lines = src.split('\n');
    for (let i = 0; i < line - 1 && i < lines.length; i += 1) {
      pos += lines[i].length + 1;
    }
    return Math.min(pos + col - 1, src.length);
  }
  return 0;
}

/**
 * @param {string} text
 * @returns {{from: number, to: number, severity: 'error', message: string}[]}
 */
function jsonLintDiagnostics(text) {
  const src = String(text ?? '');
  if (!src.trim()) return [];
  try {
    JSON.parse(src);
    return [];
  } catch (err) {
    const withPlaceholders = src.replace(/\{\{[^}]+\}\}/g, 'null');
    if (withPlaceholders !== src) {
      try {
        JSON.parse(withPlaceholders);
        return [];
      } catch {
        // still invalid after substituting {{vars}}
      }
    }
    const from = getErrorPosition(err, src);
    return [
      {
        from,
        to: from,
        severity: /** @type {'error'} */ ('error'),
        message: err && err.message ? String(err.message) : 'Invalid JSON',
      },
    ];
  }
}

/**
 * @param {{state: {doc: {toString: () => string}}}} view
 * @returns {{from: number, to: number, severity: 'error', message: string}[]}
 */
function jsonLint(view) {
  return jsonLintDiagnostics(view.state.doc.toString());
}

module.exports = { jsonLintDiagnostics, jsonLint, getErrorPosition };
