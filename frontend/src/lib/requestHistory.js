'use strict';

// Pure formatting helpers for the request "History" tab. Kept CommonJS so the
// node --test suite can require() them.

const FIELD_LABELS = {
  name: 'Name',
  method: 'Method',
  url: 'URL',
  folderId: 'Folder',
  headers: 'Headers',
  queryParams: 'Query params',
  bodyType: 'Body type',
  bodyJson: 'Body (JSON)',
  bodyText: 'Body (text)',
  bodyParts: 'Body parts',
  apiType: 'API type',
  formula: 'Formula',
  assertions: 'Assertions',
};

function fieldLabel(field) {
  return FIELD_LABELS[field] || String(field);
}

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function revisionSummary(revision) {
  if (revision.changeKind === 'create') return 'Created';
  if (revision.changeKind === 'rollback') return 'Restored an earlier version';
  const fields = (revision.changedFields || []).map((f) => fieldLabel(f.field));
  if (fields.length === 0) return 'No field changes';
  if (fields.length <= 3) return fields.join(', ');
  return `${fields.slice(0, 3).join(', ')} +${fields.length - 3} more`;
}

function formatChange(change) {
  return { label: fieldLabel(change.field), before: formatValue(change.from), after: formatValue(change.to) };
}

module.exports = { FIELD_LABELS, fieldLabel, formatValue, revisionSummary, formatChange };
