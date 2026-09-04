'use strict';

/**
 * M14: structured MULTIPART body helpers.
 *
 * A structured multipart body is an array of `BodyFormPart` objects (see
 * `src/lib/types.ts`). On the wire it is called `bodyParts`. These helpers
 * build, sanitise and convert parts between the editor shape, the persisted
 * shape and the ephemeral run payload.
 *
 * Persisted parts NEVER carry base64 file bytes (`data`); `data` only ever
 * appears on enabled file parts inside a run payload, where the runner reads
 * the bytes to build a native FormData. Browser `File` objects are never part
 * of a part — they live in the WorkspaceStore keyed by request id + part id
 * and are re-read at send time.
 */

/** Stable unique-ish part id (never collides for practical purposes). */
function makePartId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A fresh enabled text part with an empty key and value. */
function newTextPart() {
  return { id: makePartId(), key: '', enabled: true, kind: 'text', value: '' };
}

/** A fresh enabled file part with an empty key and placeholder metadata. */
function newFilePart() {
  return {
    id: makePartId(),
    key: '',
    enabled: true,
    kind: 'file',
    fileName: '',
    fileType: '',
    fileSize: 0,
  };
}

/**
 * Sanitise an unknown value into a well-shaped BodyFormPart[].
 *
 * Always returns an array. Non-object / non-array junk entries are dropped,
 * ids are generated when missing, keys are coerced to strings, `enabled` is
 * boolean (`undefined` counts as enabled), and `kind` is coerced to 'text' or
 * 'file' (anything that is not exactly 'file' becomes 'text'). Any `data`
 * transport bytes are always stripped so the result is safe to persist.
 *
 * @param {unknown} parts
 * @returns {Array<{
 *   id: string, key: string, enabled: boolean, kind: 'text'|'file',
 *   value?: string, fileName?: string, fileType?: string, fileSize?: number,
 * }>}
 */
function normalizeParts(parts) {
  if (!Array.isArray(parts)) return [];
  const out = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const kind = raw.kind === 'file' ? 'file' : 'text';
    const part = {
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : makePartId(),
      key: typeof raw.key === 'string' ? raw.key : '',
      enabled: raw.enabled !== false,
      kind,
    };
    if (kind === 'text') {
      part.value = typeof raw.value === 'string' ? raw.value : '';
    } else {
      part.fileName = typeof raw.fileName === 'string' ? raw.fileName : '';
      part.fileType = typeof raw.fileType === 'string' ? raw.fileType : '';
      part.fileSize =
        typeof raw.fileSize === 'number' && Number.isFinite(raw.fileSize) ? raw.fileSize : 0;
    }
    out.push(part);
  }
  return out;
}

/**
 * Pure clone of a part list safe to persist — same as `normalizeParts`, given
 * an explicit name so save payload builders signal intent.
 *
 * @param {unknown} parts
 * @returns {ReturnType<typeof normalizeParts>}
 */
function stripTransportData(parts) {
  return normalizeParts(parts);
}

/**
 * Seed multipart text parts from the legacy raw multipart representation
 * (`k=v&k2=v2`, the old `bodyText` produced by cURL import).
 *
 * Non-strings, empty strings and strings that are not shaped like key/value
 * pairs return []. Never throws.
 *
 * @param {unknown} bodyText
 * @returns {Array<{ id: string, key: string, enabled: boolean, kind: 'text', value: string }>}
 */
function seedPartsFromLegacy(bodyText) {
  if (typeof bodyText !== 'string' || bodyText.length === 0) return [];
  const segments = bodyText.split('&');
  const parts = [];
  let sawEquals = false;
  for (const segment of segments) {
    const eq = segment.indexOf('=');
    if (eq < 0) continue;
    sawEquals = true;
    const key = segment.slice(0, eq);
    if (key.length === 0) continue;
    parts.push({
      id: makePartId(),
      key,
      enabled: true,
      kind: 'text',
      value: segment.slice(eq + 1),
    });
  }
  return sawEquals ? parts : [];
}

/**
 * Read a browser File into a base64 string WITHOUT the `data:*;base64,`
 * prefix. Rejects with 'FileReader unavailable' where FileReader is undefined.
 *
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader unavailable'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

module.exports = {
  makePartId,
  newTextPart,
  newFilePart,
  normalizeParts,
  stripTransportData,
  seedPartsFromLegacy,
  readFileAsBase64,
};
