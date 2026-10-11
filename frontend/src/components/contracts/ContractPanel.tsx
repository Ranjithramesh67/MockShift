'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { workspaceApi, type Workspace } from '@/lib/api';
import {
  contractsApi,
  type ContractDiff,
  type ContractOperation,
  type ContractSpec,
  type ContractSpecDetail,
  type ContractValidationResult,
} from '@/lib/contractsApi';
import styles from './contracts.module.css';

interface ProjectOption {
  id: string;
  name: string;
}

const SAMPLE_SPEC = JSON.stringify(
  {
    openapi: '3.0.3',
    info: { title: 'Pets API', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          tags: ['Pets'],
          summary: 'List pets',
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['items'],
                    properties: { items: { type: 'array', items: { type: 'object' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  null,
  2
);

const CHANGE_LABEL: Record<string, string> = {
  path_removed: 'Path removed',
  method_removed: 'Method removed',
  field_removed: 'Field removed',
  required_field_removed: 'Required field removed',
  field_type_changed: 'Field type changed',
  request_body_removed: 'Request body removed',
  response_removed: 'Response removed',
  path_added: 'Path added',
  method_added: 'Method added',
  required_field_added: 'Required field added',
  request_body_added: 'Request body added',
  response_added: 'Response added',
};

function changeTitle(change: { kind: string }) {
  return CHANGE_LABEL[change.kind] || change.kind;
}

export function ContractPanel({ projectId }: { projectId?: string | null }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>(projectId || '');
  const [specs, setSpecs] = useState<ContractSpec[]>([]);
  const [selectedSpecId, setSelectedSpecId] = useState<string>('');
  const [detail, setDetail] = useState<ContractSpecDetail | null>(null);
  const [baseSpecId, setBaseSpecId] = useState<string>('');
  const [headSpecId, setHeadSpecId] = useState<string>('');
  const [diff, setDiff] = useState<ContractDiff | null>(null);
  const [importName, setImportName] = useState('');
  const [importText, setImportText] = useState(SAMPLE_SPEC);
  const [operationIndex, setOperationIndex] = useState(0);
  const [responseBody, setResponseBody] = useState('{ "items": [] }');
  const [validation, setValidation] = useState<ContractValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    workspaceApi
      .list()
      .then((res) => {
        setWorkspaces(res.workspaces);
        if (res.workspaces.length && !workspaceId) setWorkspaceId(res.workspaces[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load workspaces'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    workspaceApi
      .content(workspaceId)
      .then((tree) => {
        const accessible = tree.projects.filter((p) => p.can_access).map((p) => ({ id: p.id, name: p.name }));
        setProjects(accessible);
        if (!projectId && accessible.length) setActiveProjectId(accessible[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load projects'));
  }, [workspaceId, projectId]);

  const refreshSpecs = useCallback(async (targetProjectId: string) => {
    if (!targetProjectId) {
      setSpecs([]);
      return;
    }
    const res = await contractsApi.list(targetProjectId);
    setSpecs(res.specs);
  }, []);

  useEffect(() => {
    refreshSpecs(activeProjectId).catch((err) =>
      setError(err instanceof Error ? err.message : 'Failed to load specs')
    );
  }, [activeProjectId, refreshSpecs]);

  const openSpec = useCallback(async (specId: string) => {
    setSelectedSpecId(specId);
    setValidation(null);
    setDiff(null);
    try {
      const res = await contractsApi.get(specId);
      setDetail(res);
      setOperationIndex(0);
      const firstOp = res.operations[0];
      if (firstOp) setResponseBody(suggestBody(firstOp));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load spec');
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!activeProjectId) {
      setError('Select a project first');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setError('Import text must be valid JSON');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await contractsApi.importSpec({
        projectId: activeProjectId,
        spec: parsed,
        name: importName.trim() || undefined,
      });
      setNotice(`Imported "${res.spec.name}" — ${res.requests.length} request(s) generated`);
      await refreshSpecs(activeProjectId);
      await openSpec(res.spec.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, importText, importName, refreshSpecs, openSpec]);

  const handleDiff = useCallback(async () => {
    if (!baseSpecId || !headSpecId) {
      setError('Choose a base and a head spec');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await contractsApi.diff({ baseSpecId, headSpecId });
      setDiff(res.diff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diff failed');
    } finally {
      setBusy(false);
    }
  }, [baseSpecId, headSpecId]);

  const handleValidate = useCallback(async () => {
    if (!detail) return;
    const operation = detail.operations[operationIndex];
    if (!operation) return;
    let body: unknown;
    try {
      body = JSON.parse(responseBody);
    } catch {
      setError('Response body must be valid JSON');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await contractsApi.validate({
        specId: detail.spec.id,
        method: operation.method,
        path: operation.path,
        statusCode: operation.responseCodes.find((code) => /^2\d\d$/.test(code)) || operation.responseCodes[0],
        response: { status: 200, body: JSON.stringify(body) },
      });
      setValidation(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setBusy(false);
    }
  }, [detail, operationIndex, responseBody]);

  const currentOperation = useMemo(
    () => (detail ? detail.operations[operationIndex] || null : null),
    [detail, operationIndex]
  );

  return (
    <main className="admin-main" data-testid="contracts-view">
      <div className={styles.root}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Contracts</h1>
            <p className={styles.subtitle}>
              Import an OpenAPI 3.x document, validate live responses against its schemas, and diff versions for
              breaking changes.
            </p>
          </div>
          <div className={styles.scopeRow}>
            <select
              className={styles.select}
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setSelectedSpecId('');
                setDetail(null);
              }}
              aria-label="Workspace"
            >
              <option value="">Select workspace</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={activeProjectId}
              onChange={(e) => {
                setActiveProjectId(e.target.value);
                setSelectedSpecId('');
                setDetail(null);
              }}
              aria-label="Project"
              disabled={Boolean(projectId)}
            >
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        {error && <div className={styles.error}>{error}</div>}
        {notice && <div className={styles.notice}>{notice}</div>}

        <div className={styles.layout}>
          <section className={styles.panel}>
            <h2 className={styles.sectionTitle}>Imported specs</h2>
            {specs.length === 0 ? (
              <p className={styles.empty}>No specs imported for this project yet.</p>
            ) : (
              <ul className={styles.list}>
                {specs.map((spec) => (
                  <li key={spec.id}>
                    <button
                      type="button"
                      className={`${styles.listItem} ${spec.id === selectedSpecId ? styles.active : ''}`}
                      onClick={() => openSpec(spec.id)}
                    >
                      <span className={styles.specName}>{spec.name}</span>
                      <span className={styles.badge}>v{spec.version || '—'}</span>
                      <span className={styles.muted}>{spec.operationCount} ops</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h2 className={styles.sectionTitle}>Import spec</h2>
            <input
              className={styles.input}
              placeholder="Display name (optional)"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
            <textarea
              className={styles.textarea}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              spellCheck={false}
              aria-label="OpenAPI JSON"
            />
            <button type="button" className={styles.primary} onClick={handleImport} disabled={busy || !activeProjectId}>
              {busy ? 'Working…' : 'Import & generate requests'}
            </button>
          </section>

          <section className={styles.panelWide}>
            <h2 className={styles.sectionTitle}>Operations</h2>
            {!detail ? (
              <p className={styles.empty}>Select a spec to inspect its operations.</p>
            ) : (
              <>
                <div className={styles.opGrid}>
                  {detail.operations.map((operation, index) => (
                    <button
                      type="button"
                      key={`${operation.method}-${operation.path}`}
                      className={`${styles.opItem} ${index === operationIndex ? styles.active : ''}`}
                      onClick={() => {
                        setOperationIndex(index);
                        setValidation(null);
                        setResponseBody(suggestBody(operation));
                      }}
                    >
                      <span className={`${styles.method} ${styles[operation.method.toLowerCase()] || ''}`}>
                        {operation.method}
                      </span>
                      <span className={styles.mono}>{operation.path}</span>
                    </button>
                  ))}
                </div>

                {currentOperation && (
                  <div className={styles.validateBox}>
                    <h3 className={styles.sectionTitle}>Validate response body</h3>
                    <p className={styles.muted}>
                      {currentOperation.summary || currentOperation.operationId || currentOperation.path} — responses:{' '}
                      {currentOperation.responseCodes.join(', ') || 'none'}
                    </p>
                    <textarea
                      className={styles.textarea}
                      value={responseBody}
                      onChange={(e) => setResponseBody(e.target.value)}
                      spellCheck={false}
                      aria-label="Response body JSON"
                    />
                    <button type="button" className={styles.primary} onClick={handleValidate} disabled={busy}>
                      Validate against schema
                    </button>
                    {validation && (
                      <div className={validation.valid ? styles.pass : styles.fail}>
                        {validation.valid
                          ? `Passes the ${validation.statusKey} response schema.`
                          : `Fails the contract: ${validation.errors.slice(0, 4).join('; ')}`}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className={styles.panel}>
            <h2 className={styles.sectionTitle}>Version diff</h2>
            <select className={styles.select} value={baseSpecId} onChange={(e) => setBaseSpecId(e.target.value)}>
              <option value="">Base spec</option>
              {specs.map((spec) => (
                <option key={spec.id} value={spec.id}>
                  {spec.name} v{spec.version || '—'}
                </option>
              ))}
            </select>
            <select className={styles.select} value={headSpecId} onChange={(e) => setHeadSpecId(e.target.value)}>
              <option value="">Head spec</option>
              {specs.map((spec) => (
                <option key={spec.id} value={spec.id}>
                  {spec.name} v{spec.version || '—'}
                </option>
              ))}
            </select>
            <button type="button" className={styles.primary} onClick={handleDiff} disabled={busy}>
              Compare versions
            </button>

            {diff && (
              <div className={styles.diffBox}>
                <div className={diff.hasBreaking ? styles.fail : styles.pass}>
                  {diff.hasBreaking
                    ? `${diff.breaking.length} breaking change(s) detected`
                    : 'No breaking changes detected'}
                </div>
                {diff.breaking.map((change, index) => (
                  <div key={`b-${index}`} className={styles.diffRow}>
                    <span className={styles.breakingTag}>BREAKING</span>
                    <span>{changeTitle(change)}</span>
                    <span className={styles.muted}>{change.detail}</span>
                  </div>
                ))}
                {diff.nonBreaking.map((change, index) => (
                  <div key={`n-${index}`} className={styles.diffRow}>
                    <span className={styles.safeTag}>SAFE</span>
                    <span>{changeTitle(change)}</span>
                    <span className={styles.muted}>{change.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

// A small, schema-aware starting body: enough to make the validate box useful
// without pretending to be a full example generator.
function suggestBody(operation: ContractOperation): string {
  const schema = operation.requestSchema;
  if (!schema) return '{}\n';
  return JSON.stringify(exampleFromSchema(schema), null, 2);
}

function exampleFromSchema(schema: Record<string, unknown>): unknown {
  const type = schema.type;
  if (Array.isArray(type)) return exampleFromSchema({ ...schema, type: type.find((t) => t !== 'null') });
  if (type === 'array') return schema.items ? [exampleFromSchema(schema.items as Record<string, unknown>)] : [];
  if (type === 'object' || schema.properties) {
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) out[key] = exampleFromSchema(value);
    return out;
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return true;
  if (type === 'string') return '';
  return null;
}

export default ContractPanel;
