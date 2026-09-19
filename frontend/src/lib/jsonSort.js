'use strict';

const KEY_MODES = ['alpha', 'alphanum', 'original'];
const ARRAY_MODES = ['none', 'alpha', 'alphanum', 'numeric', 'length', 'type', 'json'];
const DIRECTIONS = ['asc', 'desc'];

function chunkAlphanum(value) {
  const text = String(value);
  const parts = text.match(/(\d+)|(\D+)/g);
  if (!parts) return [{ s: text }];
  return parts.map((part) => (/^\d+$/.test(part) ? { n: Number(part), s: part } : { s: part }));
}

function alphanumCompare(left, right) {
  const a = chunkAlphanum(left);
  const b = chunkAlphanum(right);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const x = a[i];
    const y = b[i];
    if (x.n != null && y.n != null) {
      if (x.n !== y.n) return x.n - y.n;
      if (x.s.length !== y.s.length) return x.s.length - y.s.length;
      continue;
    }
    if (x.n != null) return -1;
    if (y.n != null) return 1;
    const cmp = x.s.localeCompare(y.s);
    if (cmp) return cmp;
  }
  return 0;
}

function typeRank(value) {
  if (value === null) return 0;
  if (Array.isArray(value)) return 4;
  switch (typeof value) {
    case 'boolean':
      return 1;
    case 'number':
      return 2;
    case 'string':
      return 3;
    case 'object':
      return 5;
    default:
      return 9;
  }
}

function valueLength(value) {
  if (value == null) return 0;
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return String(value).length;
}

function stableString(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableString(item)).join(',')}]`;
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
}

function stringifyScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'object') return stableString(value);
  return String(value);
}

function valueCompare(left, right, mode) {
  switch (mode) {
    case 'numeric': {
      const a = Number(left);
      const b = Number(right);
      const aOk = Number.isFinite(a);
      const bOk = Number.isFinite(b);
      if (aOk && bOk) return a - b;
      if (aOk) return -1;
      if (bOk) return 1;
      return stringifyScalar(left).localeCompare(stringifyScalar(right));
    }
    case 'length':
      return valueLength(left) - valueLength(right);
    case 'type': {
      const rank = typeRank(left) - typeRank(right);
      if (rank) return rank;
      return stableString(left).localeCompare(stableString(right));
    }
    case 'json':
      return stableString(left).localeCompare(stableString(right));
    case 'alphanum':
      return alphanumCompare(stringifyScalar(left), stringifyScalar(right));
    case 'alpha':
    default:
      return stringifyScalar(left).localeCompare(stringifyScalar(right));
  }
}

function applyDirection(cmp, direction) {
  return direction === 'desc' ? -cmp : cmp;
}

function normalizeSortOptions(options) {
  const raw = options && typeof options === 'object' ? options : {};
  return {
    keyMode: KEY_MODES.includes(raw.keyMode) ? raw.keyMode : 'alpha',
    keyDirection: DIRECTIONS.includes(raw.keyDirection) ? raw.keyDirection : 'asc',
    arrayMode: ARRAY_MODES.includes(raw.arrayMode) ? raw.arrayMode : 'none',
    arrayDirection: DIRECTIONS.includes(raw.arrayDirection) ? raw.arrayDirection : 'asc',
  };
}

function sortValue(value, options) {
  const opts = normalizeSortOptions(options);
  if (Array.isArray(value)) {
    const items = value.map((item) => sortValue(item, opts));
    if (opts.arrayMode !== 'none') {
      items.sort((a, b) => applyDirection(valueCompare(a, b, opts.arrayMode), opts.arrayDirection));
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (opts.keyMode !== 'original') {
      keys.sort((a, b) => {
        const cmp = opts.keyMode === 'alphanum' ? alphanumCompare(a, b) : a.localeCompare(b);
        return applyDirection(cmp, opts.keyDirection);
      });
    }
    const out = {};
    for (const key of keys) out[key] = sortValue(value[key], opts);
    return out;
  }
  return value;
}

function formatSorted(value, options) {
  return JSON.stringify(sortValue(value, options), null, 2);
}

module.exports = {
  KEY_MODES,
  ARRAY_MODES,
  DIRECTIONS,
  alphanumCompare,
  normalizeSortOptions,
  sortValue,
  formatSorted,
};
