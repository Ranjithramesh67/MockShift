'use strict';

/**
 * cURL import/export.
 *
 * `parseCurl(input)` turns a pasted `curl ...` command into the editor's
 * request shape. `generateCurl(request)` serialises the editor state back
 * into a valid `curl` command.
 *
 * The parser is deliberately tolerant: it understands single/double quoting,
 * backslash line continuations, the common value-taking flags
 * (-X/-H/-d/--data-raw/--data-binary/-F/--url/-u/-G/-I) and ignores
 * presentation flags (--compressed, -s, -v, -k, --location, ...).
 */

const METHOD_FLAGS = new Set(['-X', '--request']);
const HEADER_FLAGS = new Set(['-H', '--header']);
const DATA_FLAGS = new Set([
  '-d',
  '--data',
  '--data-ascii',
  '--data-raw',
  '--data-binary',
  '--data-urlencode',
]);
const FORM_FLAGS = new Set(['-F', '--form']);
const URL_FLAGS = new Set(['--url']);
const USER_FLAGS = new Set(['-u', '--user']);
const FLAG_WITH_VALUE = new Set([
  '-o',
  '--output',
  '-b',
  '--cookie',
  '-c',
  '--cookie-jar',
  '--cert',
  '--key',
  '--cacert',
  '--proxy',
  '-w',
  '--write-out',
]);
const IGNORED_FLAGS = new Set([
  '-s',
  '-S',
  '--silent',
  '-v',
  '--verbose',
  '-i',
  '--include',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '--compressed',
  '--tlsv1.2',
  '--http1.1',
  '--http2',
  '-g',
  '--globoff',
  '-n',
  '--netrc',
]);

/**
 * Split a raw cURL command line into shell-like tokens, honouring single and
 * double quotes plus backslash escapes inside double quotes. Drops `\` line
 * continuation markers.
 *
 * @param {string} input
 * @returns {string[]}
 */
function tokenizeCurl(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < n) {
        const ch = input[j];
        if (quote === '"' && ch === '\\' && j + 1 < n && (input[j + 1] === '"' || input[j + 1] === '\\')) {
          value += input[j + 1];
          j += 2;
          continue;
        }
        if (ch === quote) {
          j += 1;
          break;
        }
        value += ch;
        j += 1;
      }
      tokens.push(value);
      i = j;
    } else {
      let j = i;
      while (j < n && !' \t\n\r'.includes(input[j])) j += 1;
      tokens.push(input.slice(i, j));
      i = j;
    }
  }
  // Drop backslash line continuations (standalone `\` tokens).
  return tokens.filter((t) => t !== '\\');
}

/**
 * True when the input looks like a cURL command (leading `curl` token) rather
 * than a plain URL.
 *
 * @param {string} input
 * @returns {boolean}
 */
function isCurlCommand(input) {
  return /^\s*(?:curl|curl\.exe)\b/i.test(String(input || '').trim());
}

function parseHeader(raw) {
  const colon = raw.indexOf(':');
  if (colon <= 0) {
    // Bare header without a value, or not a header at all.
    return null;
  }
  return {
    key: raw.slice(0, colon).trim(),
    value: raw.slice(colon + 1).trim(),
    enabled: true,
  };
}

function isJsonString(text) {
  if (typeof text !== 'string') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function splitQuery(rawUrl) {
  let url = rawUrl;
  let queryString = '';
  const hashIndex = rawUrl.indexOf('#');
  if (hashIndex >= 0) url = rawUrl.slice(0, hashIndex);
  const qIndex = url.indexOf('?');
  if (qIndex >= 0) {
    queryString = url.slice(qIndex + 1);
    url = url.slice(0, qIndex);
  }
  const params = [];
  if (queryString) {
    for (const pair of queryString.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = eq >= 0 ? pair.slice(0, eq) : pair;
      const value = eq >= 0 ? pair.slice(eq + 1) : '';
      try {
        params.push({ key: decodeURIComponent(key), value: decodeURIComponent(value), enabled: true });
      } catch {
        params.push({ key, value, enabled: true });
      }
    }
  }
  return { baseUrl: url, queryParams: params };
}

/**
 * Parse a cURL command into the editor request shape.
 *
 * @param {string} input
 * @returns {import('../lib/types').ApiRequest}
 */
function parseCurl(input) {
  const tokens = tokenizeCurl(input);

  let start = 0;
  if (tokens[0] && tokens[0].replace(/\.exe$/i, '').toLowerCase() === 'curl') {
    start = 1;
  }

  const headers = [];
  const dataParts = [];
  let explicitMethod = null;
  let url = null;
  let isGet = false;
  let isHead = false;
  let isForm = false;
  let user = null;

  const args = tokens.slice(start);
  for (let k = 0; k < args.length; k += 1) {
    const arg = args[k];
    const nextArg = () => args[k + 1];
    if (METHOD_FLAGS.has(arg)) {
      explicitMethod = (nextArg() || 'GET').toUpperCase();
      k += 1;
    } else if (HEADER_FLAGS.has(arg)) {
      const header = parseHeader(nextArg() || '');
      if (header) headers.push(header);
      k += 1;
    } else if (DATA_FLAGS.has(arg)) {
      const value = nextArg() || '';
      k += 1;
      if (value.startsWith('@')) {
        // File reference (@file) - cannot be represented in the editor.
        continue;
      }
      dataParts.push(value);
    } else if (FORM_FLAGS.has(arg)) {
      const value = nextArg() || '';
      k += 1;
      if (!value.startsWith('@')) dataParts.push(value);
      isForm = true;
    } else if (URL_FLAGS.has(arg)) {
      url = nextArg() || '';
      k += 1;
    } else if (USER_FLAGS.has(arg)) {
      user = nextArg() || '';
      k += 1;
    } else if (arg === '-G' || arg === '--get') {
      isGet = true;
    } else if (arg === '-I' || arg === '--head') {
      isHead = true;
    } else if (FLAG_WITH_VALUE.has(arg)) {
      k += 1; // value taken but not represented
    } else if (IGNORED_FLAGS.has(arg)) {
      // no-op
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Unknown bundled flag(s) such as -sk; skip.
      continue;
    } else if (url === null) {
      url = arg;
    }
    // else: extra positional argument, ignored.
  }

  // --- Method inference -----------------------------------------------------
  let method = explicitMethod;
  if (!method) {
    if (isHead) method = 'HEAD';
    else if (dataParts.length) method = isGet ? 'GET' : 'POST';
    else method = 'GET';
  }

  // --- Basic auth -----------------------------------------------------------
  if (user && !headers.some((h) => h.key.toLowerCase() === 'authorization')) {
    const encoded = typeof btoa === 'function' ? btoa(user) : Buffer.from(user).toString('base64');
    headers.unshift({ key: 'Authorization', value: `Basic ${encoded}`, enabled: true });
  }

  // --- Body -----------------------------------------------------------------
  let bodyType = 'NONE';
  let contentType = 'text/plain';
  let bodyJson = null;
  let bodyText = null;

  const ctHeader = headers.find((h) => h.key.toLowerCase() === 'content-type');
  const ctValue = ctHeader ? ctHeader.value.toLowerCase() : '';

  if (dataParts.length && !isGet) {
    const joined = dataParts.join('&');
    if (isForm || ctValue.startsWith('multipart/form-data')) {
      bodyType = 'MULTIPART';
      contentType = 'multipart/form-data';
      bodyText = joined;
    } else if (ctValue.includes('application/json') || isJsonString(joined)) {
      bodyType = 'JSON';
      contentType = 'application/json';
      bodyJson = prettyJson(joined) || joined;
    } else if (ctValue.includes('x-www-form-urlencoded') || (joined.includes('=') && joined.includes('&'))) {
      bodyType = 'FORM_URLENCODED';
      contentType = 'application/x-www-form-urlencoded';
      bodyText = joined;
    } else if (ctValue.includes('xml')) {
      bodyType = 'RAW_TEXT';
      contentType = 'application/xml';
      bodyText = joined;
    } else {
      bodyType = 'RAW_TEXT';
      contentType = 'text/plain';
      bodyText = joined;
    }
  }

  // --- URL / query params ---------------------------------------------------
  const { baseUrl, queryParams } = splitQuery(url || '');
  if (isGet && dataParts.length) {
    const queryFromData = dataParts.join('&');
    for (const pair of queryFromData.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      let key = eq >= 0 ? pair.slice(0, eq) : pair;
      let value = eq >= 0 ? pair.slice(eq + 1) : '';
      try {
        key = decodeURIComponent(key);
        value = decodeURIComponent(value);
      } catch {
        // keep raw
      }
      queryParams.push({ key, value, enabled: true });
    }
  }

  return {
    id: '',
    name: 'Imported request',
    method,
    url: baseUrl,
    headers,
    queryParams,
    bodyType,
    bodyJson,
    bodyText,
    contentType,
    formula: '',
  };
}

/**
 * Serialise the editor request state into a single-line cURL command.
 *
 * @param {import('../lib/types').ApiRequest} request
 * @returns {string}
 */
function generateCurl(request) {
  const parts = [];
  parts.push('curl');
  parts.push('-X', request.method);

  let url = request.url || '';
  const activeParams = (request.queryParams || []).filter((p) => p.enabled && p.key);
  if (activeParams.length) {
    const qs = activeParams
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value || '')}`)
      .join('&');
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  parts.push('--url', shellQuote(url));

  for (const header of (request.headers || []).filter((h) => h.enabled && h.key)) {
    parts.push('-H', shellQuote(`${header.key}: ${header.value}`));
  }

  const activeMultipartParts = (request.bodyParts || []).filter(
    (p) => p.enabled !== false && p.key
  );
  const isMultipartBody = request.bodyType === 'MULTIPART';
  const hasBody =
    request.bodyType !== 'NONE' &&
    (isMultipartBody ? activeMultipartParts.length > 0 : !!request.bodyJson);
  if (hasBody) {
    const hasCt = (request.headers || []).some(
      (h) => h.enabled && h.key.toLowerCase() === 'content-type'
    );
    if (!hasCt && request.contentType) {
      parts.push('-H', shellQuote(`Content-Type: ${request.contentType}`));
    }
    if (isMultipartBody) {
      for (const p of activeMultipartParts) {
        if (p.kind === 'file') {
          parts.push('--form', shellQuote(`${p.key}=@${p.fileName || 'file'}`));
        } else {
          parts.push('--form-string', shellQuote(`${p.key}=${p.value ?? ''}`));
        }
      }
    } else if (request.bodyType === 'JSON' || request.bodyType === 'FORM_URLENCODED') {
      parts.push('--data-raw', shellQuote(request.bodyJson));
    } else {
      parts.push('--data-binary', shellQuote(request.bodyJson));
    }
  }

  return parts.join(' ');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

module.exports = { tokenizeCurl, isCurlCommand, parseCurl, generateCurl, shellQuote };
