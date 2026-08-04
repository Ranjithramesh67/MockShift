'use strict';

// ---------------------------------------------------------------------------
// Multi-language request code generation. Consumes the frontend ApiRequest
// shape and produces ready-to-paste snippets for common clients/languages.
// ---------------------------------------------------------------------------

export type CodeLang =
  | 'nodejs'
  | 'axios'
  | 'javascript'
  | 'react'
  | 'react-native'
  | 'php'
  | 'laravel'
  | 'python'
  | 'go';

export interface CodeGenRequest {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string; enabled?: boolean }>;
  queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  bodyType?: string;
  bodyJson?: string | null;
  bodyText?: string | null;
  contentType?: string;
}

export const CODE_LANGS: Array<{ id: CodeLang; label: string }> = [
  { id: 'nodejs', label: 'Node.js (fetch)' },
  { id: 'axios', label: 'Axios' },
  { id: 'javascript', label: 'JavaScript (fetch)' },
  { id: 'react', label: 'React (fetch)' },
  { id: 'react-native', label: 'React Native (fetch)' },
  { id: 'php', label: 'PHP (cURL)' },
  { id: 'laravel', label: 'Laravel (Http)' },
  { id: 'python', label: 'Python (requests)' },
  { id: 'go', label: 'Go (net/http)' },
];

function q(str: string): string {
  return JSON.stringify(str);
}

function jsString(value: string): string {
  return q(value);
}

function hasBody(r: CodeGenRequest): boolean {
  const body = bodyPayload(r);
  return body !== null && body !== '';
}

function bodyPayload(r: CodeGenRequest): string | null {
  if (r.bodyType === 'JSON' && r.bodyJson) return r.bodyJson;
  if (r.bodyType === 'GRAPHQL' && r.bodyJson) return r.bodyJson;
  if (r.bodyText) return r.bodyText;
  return null;
}

function effectiveHeaders(r: CodeGenRequest): Array<{ key: string; value: string }> {
  const headers = (r.headers || [])
    .filter((h) => h && h.enabled !== false && h.key)
    .map((h) => ({ key: h.key, value: h.value }));
  if (hasBody(r) && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    const ct =
      r.contentType ||
      (r.bodyType === 'JSON' || r.bodyType === 'GRAPHQL' ? 'application/json' : 'text/plain');
    headers.unshift({ key: 'Content-Type', value: ct });
  }
  return headers;
}

function queryString(r: CodeGenRequest): string {
  const params = (r.queryParams || []).filter((p) => p && p.enabled !== false && p.key);
  if (params.length === 0) return '';
  const qs = params
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&');
  return r.url.includes('?') ? `&${qs}` : `?${qs}`;
}

function finalUrl(r: CodeGenRequest): string {
  return `${r.url}${queryString(r)}`;
}

const INDENT = '  ';

function generateNodeJs(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`const url = ${jsString(finalUrl(r))};`);
  const opts: string[] = [`method: ${q(r.method.toUpperCase())}`];
  const headers = effectiveHeaders(r);
  if (headers.length) {
    const entries = headers.map((h) => `${INDENT}${q(h.key)}: ${jsString(h.value)}`).join(',\n');
    opts.push(`headers: {\n${entries}\n}`);
  }
  const body = bodyPayload(r);
  if (body) {
    const parsed = tryParseJson(body);
    opts.push(`body: ${parsed !== null ? JSON.stringify(parsed, null, 2) : jsString(body)}`);
  }
  lines.push(`const options = {\n${opts.map((o, i) => (i === 0 ? o : INDENT + o)).join(',\n')}\n};`);
  lines.push('');
  lines.push(`const res = await fetch(url, options);`);
  lines.push(`const data = await res.json();`);
  lines.push(`console.log(res.status, data);`);
  return lines.join('\n');
}

function generateAxios(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`import axios from 'axios';`);
  lines.push('');
  const config: string[] = [`method: ${q(r.method.toUpperCase())}`];
  config.push(`url: ${jsString(r.url)}`);
  const headers = effectiveHeaders(r);
  if (headers.length) {
    config.push(`headers: {\n${INDENT}${headers.map((h) => `${q(h.key)}: ${jsString(h.value)}`).join(',\n${INDENT}')}\n}`);
  }
  const params = (r.queryParams || []).filter((p) => p && p.enabled !== false && p.key);
  if (params.length) {
    const entries = params.map((p) => `${INDENT}${q(p.key)}: ${jsString(p.value)}`).join(',\n');
    config.push(`params: {\n${entries}\n}`);
  }
  const body = bodyPayload(r);
  if (body) {
    const parsed = tryParseJson(body);
    config.push(`data: ${parsed !== null ? JSON.stringify(parsed, null, 2) : jsString(body)}`);
  }
  lines.push(`const response = await axios({`);
  lines.push(`${config.map((c) => INDENT + c).join(',\n')}`);
  lines.push(`});`);
  lines.push(`console.log(response.status, response.data);`);
  return lines.join('\n');
}

function generateJavaScript(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`const response = await fetch(${jsString(finalUrl(r))}, {`);
  lines.push(`${INDENT}method: ${q(r.method.toUpperCase())},`);
  const headers = effectiveHeaders(r);
  if (headers.length) {
    lines.push(`${INDENT}headers: {`);
    headers.forEach((h) => lines.push(`${INDENT}${INDENT}${q(h.key)}: ${jsString(h.value)},`));
    lines.push(`${INDENT}},`);
  }
  const body = bodyPayload(r);
  if (body) {
    const parsed = tryParseJson(body);
    lines.push(`${INDENT}body: ${parsed !== null ? JSON.stringify(parsed) : jsString(body)},`);
  }
  lines.push(`});`);
  lines.push(`const data = await response.json();`);
  lines.push(`console.log(response.status, data);`);
  return lines.join('\n');
}

function generateReact(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`import { useEffect, useState } from 'react';`);
  lines.push('');
  lines.push(`function useApi() {`);
  lines.push(`${INDENT}const [data, setData] = useState(null);`);
  lines.push(`${INDENT}const [loading, setLoading] = useState(false);`);
  lines.push(`${INDENT}const [error, setError] = useState(null);`);
  lines.push('');
  lines.push(`${INDENT}useEffect(() => {`);
  lines.push(`${INDENT}${INDENT}async function run() {`);
  lines.push(`${INDENT}${INDENT}${INDENT}setLoading(true);`);
  lines.push(`${INDENT}${INDENT}${INDENT}try {`);
  lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}const res = await fetch(${jsString(finalUrl(r))}, {`);
  lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}${INDENT}method: ${q(r.method.toUpperCase())},`);
  const headers = effectiveHeaders(r);
  if (headers.length) {
    lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}${INDENT}headers: {`);
    headers.forEach((h) => lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}${INDENT}${INDENT}${q(h.key)}: ${jsString(h.value)},`));
    lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}${INDENT}},`);
  }
  const body = bodyPayload(r);
  if (body) {
    const parsed = tryParseJson(body);
    lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}${INDENT}body: ${parsed !== null ? JSON.stringify(parsed) : jsString(body)},`);
  }
  lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}});`);
  lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}const json = await res.json();`);
  lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}setData(json);`);
  lines.push(`${INDENT}${INDENT}${INDENT}} catch (err) {`);
  lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}setError(err);`);
  lines.push(`${INDENT}${INDENT}${INDENT}} finally {`);
  lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}setLoading(false);`);
  lines.push(`${INDENT}${INDENT}${INDENT}}`);
  lines.push(`${INDENT}${INDENT}}`);
  lines.push(`${INDENT}${INDENT}run();`);
  lines.push(`${INDENT}}, []);`);
  lines.push('');
  lines.push(`${INDENT}return { data, loading, error };`);
  lines.push(`}`);
  return lines.join('\n');
}

function generateReactNative(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`import React, { useEffect, useState } from 'react';`);
  lines.push(`import { Text, View } from 'react-native';`);
  lines.push('');
  lines.push(`export default function App() {`);
  lines.push(`${INDENT}const [result, setResult] = useState(null);`);
  lines.push('');
  lines.push(`${INDENT}useEffect(() => {`);
  lines.push(`${INDENT}${INDENT}fetch(${jsString(finalUrl(r))}, {`);
  lines.push(`${INDENT}${INDENT}${INDENT}method: ${q(r.method.toUpperCase())},`);
  const headers = effectiveHeaders(r);
  if (headers.length) {
    lines.push(`${INDENT}${INDENT}${INDENT}headers: {`);
    headers.forEach((h) => lines.push(`${INDENT}${INDENT}${INDENT}${INDENT}${q(h.key)}: ${jsString(h.value)},`));
    lines.push(`${INDENT}${INDENT}${INDENT}},`);
  }
  const body = bodyPayload(r);
  if (body) {
    const parsed = tryParseJson(body);
    lines.push(`${INDENT}${INDENT}${INDENT}body: ${parsed !== null ? JSON.stringify(parsed) : jsString(body)},`);
  }
  lines.push(`${INDENT}${INDENT}})`);
  lines.push(`${INDENT}${INDENT}${INDENT}.then((res) => res.json())`);
  lines.push(`${INDENT}${INDENT}${INDENT}.then(setResult)`);
  lines.push(`${INDENT}${INDENT}${INDENT}.catch(console.error);`);
  lines.push(`${INDENT}}, []);`);
  lines.push('');
  lines.push(`${INDENT}return <View><Text>{JSON.stringify(result)}</Text></View>;`);
  lines.push(`}`);
  return lines.join('\n');
}

function generatePhp(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`$url = ${q(finalUrl(r))};`);
  lines.push(`$curl = curl_init($url);`);
  lines.push(`curl_setopt($curl, CURLOPT_CUSTOMREQUEST, ${q(r.method.toUpperCase())});`);
  lines.push(`curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);`);
  const headers = effectiveHeaders(r);
  const headerLines = headers.map((h) => `${INDENT}${q(`${h.key}: ${h.value}`)},`).join('\n');
  lines.push(`$headers = [\n${headerLines}\n];`);
  lines.push(`curl_setopt($curl, CURLOPT_HTTPHEADER, $headers);`);
  const body = bodyPayload(r);
  if (body) {
    lines.push(`curl_setopt($curl, CURLOPT_POSTFIELDS, ${q(body)});`);
  }
  lines.push('');
  lines.push(`$response = curl_exec($curl);`);
  lines.push(`$status = curl_getinfo($curl, CURLINFO_HTTP_CODE);`);
  lines.push(`curl_close($curl);`);
  lines.push(`echo $status, PHP_EOL, $response;`);
  return lines.join('\n');
}

function generateLaravel(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`use Illuminate\\Support\\Facades\\Http;`);
  lines.push('');
  const headers = effectiveHeaders(r);
  if (headers.length) {
    const entries = headers.map((h) => `${INDENT}${q(h.key)} => ${q(h.value)},`).join('\n');
    lines.push(`$headers = [\n${entries}\n];`);
  }
  const body = bodyPayload(r);
  const method = r.method.toUpperCase();
  const params = (r.queryParams || []).filter((p) => p && p.enabled !== false && p.key);
  const chain = [`Http::withHeaders(${headers.length ? '$headers' : '[]'})`];
  if (body) {
    const parsed = tryParseJson(body);
    chain.push(`->withBody(${q(parsed !== null ? JSON.stringify(parsed) : body)}, ${q(r.contentType || 'application/json')})`);
  }
  if (params.length) {
    const entries = params.map((p) => `${q(p.key)} => ${q(p.value)},`).join('\n');
    chain.push(`->withQuery([\n${entries}\n])`);
  }
  const verb = method === 'GET' ? 'get' : method === 'POST' ? 'post' : method === 'PUT' ? 'put' : method === 'PATCH' ? 'patch' : method === 'DELETE' ? 'delete' : 'send';
  if (['GET', 'DELETE'].includes(method) || ['HEAD', 'OPTIONS'].includes(method)) {
    chain.push(`->${verb}(${q(r.url)})`);
  } else {
    chain.push(`->${verb}(${q(r.url)})`);
  }
  lines.push(`$response = ${chain.join('\n' + INDENT)};`);
  lines.push(`$status = $response->status();`);
  lines.push(`$body = $response->json();`);
  return lines.join('\n');
}

function generatePython(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`import requests`);
  lines.push('');
  const params = (r.queryParams || []).filter((p) => p && p.enabled !== false && p.key);
  const headers = effectiveHeaders(r);
  if (headers.length) {
    const entries = headers.map((h) => `${INDENT}${q(h.key)}: ${q(h.value)},`).join('\n');
    lines.push(`headers = {\n${entries}\n}`);
  }
  if (params.length) {
    const entries = params.map((p) => `${INDENT}${q(p.key)}: ${q(p.value)},`).join('\n');
    lines.push(`params = {\n${entries}\n}`);
  }
  const body = bodyPayload(r);
  let dataArg = '';
  if (body) {
    const parsed = tryParseJson(body);
    if (parsed !== null) {
      lines.push(`payload = ${formatPython(parsed)}`);
      dataArg = ', json=payload';
    } else {
      lines.push(`payload = ${q(body)}`);
      dataArg = ', data=payload';
    }
  }
  const args = [
    `url=${q(r.url)}`,
    `method=${q(r.method.toUpperCase())}`,
    headers.length ? 'headers=headers' : '',
    params.length ? 'params=params' : '',
  ]
    .filter(Boolean)
    .join(', ');
  lines.push(`response = requests.request(${args}${dataArg})`);
  lines.push(`print(response.status_code, response.text)`);
  return lines.join('\n');
}

function generateGo(r: CodeGenRequest): string {
  const lines: string[] = [];
  lines.push(`package main`);
  lines.push('');
  lines.push(`import (`);
  lines.push(`${INDENT}"bytes"`);
  lines.push(`${INDENT}"fmt"`);
  lines.push(`${INDENT}"io"`);
  lines.push(`${INDENT}"net/http"`);
  lines.push(`${INDENT}"os"`);
  lines.push(`)`);
  lines.push('');
  lines.push(`func main() {`);
  const body = bodyPayload(r);
  if (body) {
    lines.push(`${INDENT}payload := []byte(${q(body)})`);
  }
  lines.push(`${INDENT}req, _ := http.NewRequest(${q(r.method.toUpperCase())}, ${q(finalUrl(r))}, ${body ? 'bytes.NewReader(payload)' : 'nil'})`);
  const headers = effectiveHeaders(r);
  headers.forEach((h) => {
    lines.push(`${INDENT}req.Header.Set(${q(h.key)}, ${q(h.value)})`);
  });
  lines.push(`${INDENT}client := &http.Client{}`);
  lines.push(`${INDENT}resp, err := client.Do(req)`);
  lines.push(`${INDENT}if err != nil {`);
  lines.push(`${INDENT}${INDENT}fmt.Fprintln(os.Stderr, err)`);
  lines.push(`${INDENT}${INDENT}os.Exit(1)`);
  lines.push(`${INDENT}}`);
  lines.push(`${INDENT}defer resp.Body.Close()`);
  lines.push(`${INDENT}bodyBytes, _ := io.ReadAll(resp.Body)`);
  lines.push(`${INDENT}fmt.Printf("%d %s\\n", resp.StatusCode, bodyBytes)`);
  lines.push(`}`);
  return lines.join('\n');
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatPython(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent + 1);
  const padEnd = '  '.repeat(indent);
  if (value === null) return 'None';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = value.map((v) => `${pad}${formatPython(v, indent + 1)},`).join('\n');
    return `[\n${inner}\n${padEnd}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const inner = entries.map(([k, v]) => `${pad}${q(k)}: ${formatPython(v, indent + 1)},`).join('\n');
    return `{\n${inner}\n${padEnd}}`;
  }
  if (typeof value === 'string') return q(value);
  return String(value);
}

const GENERATORS: Record<CodeLang, (r: CodeGenRequest) => string> = {
  nodejs: generateNodeJs,
  axios: generateAxios,
  javascript: generateJavaScript,
  react: generateReact,
  'react-native': generateReactNative,
  php: generatePhp,
  laravel: generateLaravel,
  python: generatePython,
  go: generateGo,
};

export function generateCode(lang: CodeLang, request: CodeGenRequest): string {
  const fn = GENERATORS[lang];
  if (!fn) return '';
  return fn(request).replace(/\n{3,}/g, '\n\n');
}
