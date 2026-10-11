'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/store/AppStore';
import {
  fetchApiReference,
  isApiError,
  type OpenApiOperation,
  type OpenApiSpec,
} from '@/lib/docsApi';
import styles from './docs.module.css';
import { CheckIcon, CopyIcon } from '@/components/icons';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'query'] as const;
type Method = (typeof METHODS)[number];

interface RefOperation {
  method: Method;
  path: string;
  op: OpenApiOperation;
}

const METHOD_LABEL: Record<Method, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  query: 'QUERY',
};

function methodOf(item: Record<string, unknown>): Method | null {
  for (const m of METHODS) {
    if (item[m]) return m;
  }
  return null;
}

// First example (or the single `example`) of the JSON request body.
function requestExample(op: OpenApiOperation): unknown {
  const media = op.requestBody?.content?.['application/json'];
  if (!media) return null;
  if (media.examples) {
    const first = Object.values(media.examples)[0];
    if (first && first.value !== undefined) return first.value;
  }
  if (media.example !== undefined) return media.example;
  return null;
}

function pathParams(op: OpenApiOperation): string[] {
  return (op.parameters || [])
    .filter((p) => p.in === 'path')
    .map((p) => p.name);
}

function usesBearer(op: OpenApiOperation): boolean {
  return Boolean(op.security?.some((s) => 'bearerAuth' in s));
}

function curlFor(entry: RefOperation, base: string): string {
  const { method, path, op } = entry;
  let url = `${base}${path}`;
  for (const name of pathParams(op)) url = url.replace(`{${name}}`, `<${name}>`);
  const lines = [`curl -X ${METHOD_LABEL[method]} "${url}"`];
  const example = requestExample(op);
  if (example !== null) lines.push('  -H "Content-Type: application/json"');
  if (usesBearer(op)) lines.push('  -H "Authorization: Bearer $API_TOKEN"');
  else lines.push('  --cookie "ah.session=$SESSION"');
  if (example !== null) lines.push(`  -d '${JSON.stringify(example)}'`);
  return lines.join(' \\\n');
}

function baseForDisplay(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'http://localhost:3001';
}

function CurlBlock({ entry }: { entry: RefOperation }) {
  const { dispatch } = useApp();
  const [copied, setCopied] = useState(false);
  const curl = useMemo(() => curlFor(entry, baseForDisplay()), [entry]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: 'Could not copy the snippet.' });
    }
  }, [curl, dispatch]);

  return (
    <div className={styles.apiRefCurlWrap}>
      <pre className={styles.apiRefCurl} data-testid={`api-ref-curl-${entry.op.operationId || entry.path}`}>
        {curl}
      </pre>
      <button
        type="button"
        className={styles.apiRefCopy}
        onClick={() => void copy()}
        aria-label="Copy curl snippet"
      >
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function OperationCard({ entry }: { entry: RefOperation }) {
  const { method, path, op } = entry;
  const params = op.parameters || [];
  const responses = Object.entries(op.responses || {});
  return (
    <article
      className={styles.apiRefOp}
      data-testid={`api-ref-op-${op.operationId || path}`}
    >
      <header className={styles.apiRefOpHead}>
        <span className={styles.apiRefMethod} data-method={method}>
          {METHOD_LABEL[method]}
        </span>
        <code className={styles.apiRefPath}>{path}</code>
      </header>
      {op.summary ? <h3 className={styles.apiRefOpTitle}>{op.summary}</h3> : null}
      {op.description ? <p className={styles.apiRefOpDesc}>{op.description}</p> : null}

      {params.length > 0 ? (
        <div className={styles.apiRefSection}>
          <h4 className={styles.apiRefSectionTitle}>Parameters</h4>
          <ul className={styles.apiRefParamList}>
            {params.map((p) => (
              <li key={`${p.in}:${p.name}`} className={styles.apiRefParam}>
                <code>{p.name}</code>
                <span className={styles.apiRefParamIn}>{p.in}</span>
                {p.required ? <span className={styles.apiRefRequired}>required</span> : null}
                {p.description ? <span className={styles.apiRefParamDesc}>{p.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {op.requestBody ? (
        <div className={styles.apiRefSection}>
          <h4 className={styles.apiRefSectionTitle}>
            Request body{op.requestBody.required ? '' : ' (optional)'}
          </h4>
          <CurlBlock entry={entry} />
        </div>
      ) : (
        <div className={styles.apiRefSection}>
          <h4 className={styles.apiRefSectionTitle}>Example</h4>
          <CurlBlock entry={entry} />
        </div>
      )}

      {responses.length > 0 ? (
        <div className={styles.apiRefSection}>
          <h4 className={styles.apiRefSectionTitle}>Responses</h4>
          <ul className={styles.apiRefResponses}>
            {responses.map(([code, res]) => (
              <li key={code} className={styles.apiRefResponse}>
                <code className={styles.apiRefStatus} data-status={code.charAt(0)}>
                  {code}
                </code>
                <span>{res.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

export function ApiReference() {
  const router = useRouter();
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApiReference()
      .then((data) => {
        if (!cancelled) setSpec(data);
      })
      .catch((err) => {
        if (!cancelled) setError(isApiError(err) ? err.message : 'Failed to load the API reference.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    if (!spec) return [] as Array<{ tag: string; description?: string; entries: RefOperation[] }>;
    const byTag = new Map<string, RefOperation[]>();
    for (const [path, item] of Object.entries(spec.paths || {})) {
      const method = methodOf(item as Record<string, unknown>);
      if (!method) continue;
      const op = (item as Record<string, OpenApiOperation>)[method] as OpenApiOperation;
      const tag = op.tags?.[0] || 'Other';
      const list = byTag.get(tag) || [];
      list.push({ method, path, op });
      byTag.set(tag, list);
    }
    const order = (spec.tags || []).map((t) => t.name);
    const names = Array.from(byTag.keys()).sort(
      (a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
    );
    return names.map((tag) => ({
      tag,
      description: (spec.tags || []).find((t) => t.name === tag)?.description,
      entries: byTag.get(tag) || [],
    }));
  }, [spec]);

  return (
    <div className={styles.apiRef} data-testid="api-reference">
      <button type="button" className="ghost-button" onClick={() => router.push('/docs')}>
        Back to docs
      </button>

      {error ? (
        <div className={styles.apiRefError} role="alert">
          <p>{error}</p>
        </div>
      ) : !spec ? (
        <p className={styles.apiRefLoading}>Loading API reference…</p>
      ) : (
        <>
          <header className={styles.apiRefHead}>
            <h1>{spec.info.title}</h1>
            <span className={styles.apiRefVersion}>v{spec.info.version}</span>
            {spec.info.description ? (
              <p className={styles.apiRefIntro}>{spec.info.description}</p>
            ) : null}
          </header>

          {groups.map((group) => (
            <section
              key={group.tag}
              className={styles.apiRefGroup}
              data-testid={`api-ref-group-${group.tag}`}
            >
              <h2 className={styles.apiRefGroupTitle}>{group.tag}</h2>
              {group.description ? (
                <p className={styles.apiRefGroupDesc}>{group.description}</p>
              ) : null}
              {group.entries.map((entry) => (
                <OperationCard key={`${entry.method} ${entry.path}`} entry={entry} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
