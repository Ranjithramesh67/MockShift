'use strict';

// ============================================================================
// collabDiff — pure helpers for comparing two collection version snapshots.
//
// A snapshot is the JSON stored in collection_versions.snapshot:
//   {
//     collection: { id, name, projectId },
//     requests: [
//       { id, name, method, url, headers, queryParams, bodyType, bodyJson,
//         bodyText, bodyParts, apiType, folderId, formula, assertions },
//       ...
//     ]
//   }
//
// Requests are matched by id. A request present only in `to` is "added", only
// in `from` is "removed", and in both but with any compared field differing is
// "changed". Field values are compared with a stable (key-sorted) stringify so
// JSON object key order never produces a false positive.
//
// No database access: the route layer loads the snapshots and hands them here.
// ============================================================================

// Fields that participate in change detection. Order defines the order of the
// `fields` array on each changed request.
const COMPARED_FIELDS = [
  'name',
  'method',
  'url',
  'folderId',
  'headers',
  'queryParams',
  'bodyType',
  'bodyJson',
  'bodyText',
  'bodyParts',
  'apiType',
  'formula',
  'assertions',
];

function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function requestList(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const list = Array.isArray(snapshot.requests) ? snapshot.requests : [];
  return list.filter((r) => r && typeof r === 'object' && r.id);
}

function requestSummary(request) {
  return {
    id: request.id,
    name: request.name ?? null,
    method: request.method ?? null,
    url: request.url ?? null,
    folderId: request.folderId ?? null,
  };
}

function changedFields(from, to) {
  const fields = [];
  for (const field of COMPARED_FIELDS) {
    const a = from[field];
    const b = to[field];
    if (stableStringify(a) !== stableStringify(b)) {
      fields.push({ field, from: a === undefined ? null : a, to: b === undefined ? null : b });
    }
  }
  return fields;
}

/**
 * Compare two snapshots.
 * @returns {{
 *   added: Array, removed: Array, changed: Array,
 *   counts: { added:number, removed:number, changed:number, unchanged:number,
 *             fromTotal:number, toTotal:number }
 * }}
 */
function diffSnapshots(fromSnapshot, toSnapshot) {
  const fromList = requestList(fromSnapshot);
  const toList = requestList(toSnapshot);
  const fromById = new Map(fromList.map((r) => [r.id, r]));
  const toById = new Map(toList.map((r) => [r.id, r]));

  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const [id, request] of toById) {
    if (!fromById.has(id)) {
      added.push(requestSummary(request));
    }
  }
  for (const [id, request] of fromById) {
    if (!toById.has(id)) {
      removed.push(requestSummary(request));
    }
  }
  for (const [id, toRequest] of toById) {
    const fromRequest = fromById.get(id);
    if (!fromRequest) continue;
    const fields = changedFields(fromRequest, toRequest);
    if (fields.length === 0) {
      unchanged += 1;
    } else {
      changed.push({
        id,
        name: toRequest.name ?? fromRequest.name ?? null,
        from: requestSummary(fromRequest),
        to: requestSummary(toRequest),
        fields,
      });
    }
  }

  const byName = (a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id));
  added.sort(byName);
  removed.sort(byName);
  changed.sort((a, b) => byName(a.to, b.to));

  return {
    added,
    removed,
    changed,
    counts: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged,
      fromTotal: fromList.length,
      toTotal: toList.length,
    },
  };
}

module.exports = { diffSnapshots, stableStringify, COMPARED_FIELDS };
