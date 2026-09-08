'use strict';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '');
}

function colorEnabled(stream) {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.APIHUB_FORCE_COLOR !== undefined && process.env.APIHUB_FORCE_COLOR !== '') {
    return !['0', 'false'].includes(process.env.APIHUB_FORCE_COLOR);
  }
  if (process.env.TERM === 'dumb') return false;
  return Boolean(stream && stream.isTTY);
}

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
};

function paint(text, color, useColor) {
  const code = CODES[color];
  if (!useColor || code === undefined) return String(text);
  return `\x1b[${code}m${text}\x1b[0m`;
}

function makePainter(useColor) {
  return {
    useColor,
    red: (t) => paint(t, 'red', useColor),
    green: (t) => paint(t, 'green', useColor),
    yellow: (t) => paint(t, 'yellow', useColor),
    cyan: (t) => paint(t, 'cyan', useColor),
    magenta: (t) => paint(t, 'magenta', useColor),
    gray: (t) => paint(t, 'gray', useColor),
    dim: (t) => paint(t, 'dim', useColor),
    bold: (t) => paint(t, 'bold', useColor),
  };
}

function statusColor(status) {
  if (status === 'SUCCESS' || status === 'PASSED') return 'green';
  if (status === 'FAILED' || status === 'ERROR') return 'red';
  return 'yellow';
}

function visibleLength(text) {
  let length = 0;
  for (const ch of stripAnsi(String(text))) length += 1;
  return length;
}

function padEnd(text, width) {
  const value = String(text);
  const pad = Math.max(0, width - visibleLength(value));
  return value + ' '.repeat(pad);
}

function elide(text, maxWidth) {
  const value = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  if (visibleLength(value) <= maxWidth) return value;
  const suffix = '…';
  let out = '';
  for (const ch of value) {
    if (visibleLength(out) + visibleLength(suffix) >= maxWidth) break;
    out += ch;
  }
  return out + suffix;
}

function renderTable(rows, { header = null, paint: paintFn = null } = {}) {
  const all = [];
  if (header) all.push(header.map((h) => String(h)));
  for (const row of rows) {
    all.push(row.map((cell) => String(cell === undefined || cell === null ? '' : cell)));
  }
  if (all.length === 0) return '';

  const widths = [];
  for (const row of all) {
    for (let c = 0; c < row.length; c += 1) {
      widths[c] = Math.max(widths[c] || 0, visibleLength(row[c]));
    }
  }

  const lines = [];
  const render = (row) => {
    const cells = [];
    for (let c = 0; c < row.length; c += 1) {
      const isLast = c === row.length - 1;
      const cell = row[c];
      cells.push(isLast ? cell : padEnd(cell, widths[c] + 2));
    }
    return cells.join('').replace(/\s+$/, '');
  };

  if (header) {
    const rendered = header.map((h, c) =>
      paintFn && paintFn.bold ? paintFn.bold(h) : h
    );
    lines.push(render(rendered));
    const rule = widths.map((w) => '-'.repeat(w)).join('  ');
    lines.push(rule);
  }
  for (const row of all.slice(header ? 1 : 0)) {
    lines.push(render(row));
  }
  return lines.join('\n');
}

function isoNow() {
  return new Date().toISOString();
}

function friendlyBytes(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '?';
  const value = Number(n);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm || `${singular}s`}`;
}

module.exports = {
  colorEnabled,
  paint,
  makePainter,
  stripAnsi,
  visibleLength,
  padEnd,
  elide,
  renderTable,
  statusColor,
  isoNow,
  friendlyBytes,
  plural,
};
