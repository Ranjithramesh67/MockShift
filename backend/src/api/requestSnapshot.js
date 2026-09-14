'use strict';

// ============================================================================
// requestSnapshot — the canonical camelCase shape of a stored request.
//
// The keys match collabDiff.COMPARED_FIELDS so the same field diff works for
// per-request history and for collection version snapshots. api_requests has
// no workspace/project columns; callers resolve those separately.
// ============================================================================

const REQUEST_COLUMNS = [
  'id',
  'name',
  'method',
  'url',
  'headers',
  'query_params',
  'body_type',
  'body_json',
  'body_text',
  'body_parts',
  'api_type',
  'folder_id',
  'formula',
  'assertions',
];

// SQL column list for SELECTs that feed serializeRequest().
const REQUEST_SELECT = REQUEST_COLUMNS.join(', ');

function serializeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    url: row.url,
    headers: row.headers || [],
    queryParams: row.query_params || [],
    bodyType: row.body_type,
    bodyJson: row.body_json ?? null,
    bodyText: row.body_text ?? null,
    bodyParts: row.body_parts || [],
    apiType: row.api_type,
    folderId: row.folder_id ?? null,
    formula: row.formula || '',
    assertions: row.assertions || [],
  };
}

module.exports = { REQUEST_COLUMNS, REQUEST_SELECT, serializeRequest };
