'use strict';

// Pure helpers for the Collection Runner's QA options (data-driven runs).
// Kept as plain CommonJS so the node:test unit suite can require() them,
// matching subscription.js / searchPalette.js / assertions.js.

const DEFAULT_RUN_OPTIONS = {
  stopOnError: false,
  delayMs: 0,
  retries: 0,
  iterations: 1,
};

const MAX_DATA_ROWS = 200;

// Minimal RFC4180-ish CSV: quoted fields, escaped double quotes and embedded
// newlines. Returns a grid of strings.
function parseCsvGrid(text) {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const grid = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      grid.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // swallow; \r\n handled by the \n branch
    } else {
      field += ch;
    }
  }
  row.push(field);
  grid.push(row);
  // Drop a trailing empty line produced by a final newline.
  if (grid.length > 1) {
    const last = grid[grid.length - 1];
    if (last.length === 1 && last[0].trim() === '') grid.pop();
  }
  return grid;
}

function rowsFromGrid(grid) {
  if (!grid.length) return [];
  const header = grid[0].map((h) => h.trim());
  const rows = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      obj[key] = (cells[c] == null ? '' : String(cells[c])).trim();
    }
    rows.push(obj);
  }
  return rows;
}

// Parse a JSON array of objects or a CSV with a header row. `format` is
// 'auto' (default), 'json' or 'csv'. Throws an Error with a user-facing
// message when the input cannot be understood.
function parseDataset(text, format = 'auto') {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return [];
  const kind = format === 'auto' ? (/^[[{]/.test(raw) ? 'json' : 'csv') : format;
  let rows;
  if (kind === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error('Data is not valid JSON.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('JSON data must be an array of objects (one per iteration).');
    }
    rows = parsed.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  } else {
    rows = rowsFromGrid(parseCsvGrid(raw));
  }
  if (rows.length > MAX_DATA_ROWS) rows = rows.slice(0, MAX_DATA_ROWS);
  return rows;
}

function datasetSummary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'No data rows';
  const keys = Object.keys(rows[0] || {});
  return `${rows.length} row${rows.length === 1 ? '' : 's'} · ${keys.length} column${keys.length === 1 ? '' : 's'}`;
}

module.exports = {
  DEFAULT_RUN_OPTIONS,
  MAX_DATA_ROWS,
  parseCsvGrid,
  parseDataset,
  datasetSummary,
};
