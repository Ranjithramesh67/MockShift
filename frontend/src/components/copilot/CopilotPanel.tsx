'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  copilotApi,
  isCopilotNotConfigured,
  type CopilotAssertionResponse,
  type CopilotDocBlock,
  type CopilotDocsResponse,
  type CopilotExplainResponse,
  type CopilotResponseSnapshot,
  type CopilotStatus,
  type CopilotUsage,
} from '@/lib/copilotApi';
import type { Assertion } from '@/lib/types';
import styles from './copilot.module.css';

type CopilotTab = 'assertions' | 'explain' | 'docs';

function usageLabel(usage: CopilotUsage | undefined): string {
  if (!usage || usage.totalTokens == null) return '';
  return `${usage.totalTokens} tokens`;
}

function assertionLine(a: Assertion): string {
  const target = a.type === 'jsonPath' || a.type === 'header' ? ` ${a.path ?? ''}` : '';
  return `${a.type}${target} ${a.operator} ${a.expected ?? ''}`.trim();
}

export function CopilotPanel({
  requestId: initialRequestId = '',
  runId: initialRunId = '',
}: {
  requestId?: string | null;
  runId?: string | null;
}) {
  const [tab, setTab] = useState<CopilotTab>('assertions');
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [requestId, setRequestId] = useState(initialRequestId ?? '');
  const [runId, setRunId] = useState(initialRunId ?? '');
  const [responseText, setResponseText] = useState('');
  const [responseError, setResponseError] = useState('');

  const [assertionResult, setAssertionResult] = useState<CopilotAssertionResponse | null>(null);
  const [explainResult, setExplainResult] = useState<CopilotExplainResponse | null>(null);
  const [docsResult, setDocsResult] = useState<CopilotDocsResponse | null>(null);

  useEffect(() => setRequestId(initialRequestId ?? ''), [initialRequestId]);
  useEffect(() => setRunId(initialRunId ?? ''), [initialRunId]);

  useEffect(() => {
    let active = true;
    copilotApi
      .status()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const configured = status?.configured ?? false;

  const parseResponseSnapshot = useCallback((): { ok: true; value?: CopilotResponseSnapshot } | { ok: false } => {
    const text = responseText.trim();
    if (!text) return { ok: true };
    try {
      const parsed = JSON.parse(text) as CopilotResponseSnapshot;
      setResponseError('');
      return { ok: true, value: parsed };
    } catch {
      setResponseError('Response snapshot must be valid JSON.');
      return { ok: false };
    }
  }, [responseText]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      if (isCopilotNotConfigured(err)) {
        setError('AI copilot is not configured. Set USER_LLM_API_KEY, USER_LLM_BASE_URL and USER_LLM_MODEL on the backend, then reload.');
      } else {
        setError(err instanceof Error ? err.message : 'Copilot request failed');
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const onGenerateAssertions = useCallback(() => {
    if (!requestId.trim()) {
      setError('A request id is required.');
      return;
    }
    run(async () => {
      const parsed = parseResponseSnapshot();
      if (!parsed.ok) return;
      const res = await copilotApi.generateAssertions({
        requestId: requestId.trim(),
        response: parsed.value,
      });
      setAssertionResult(res);
    });
  }, [requestId, parseResponseSnapshot, run]);

  const onExplainRun = useCallback(() => {
    if (!runId.trim()) {
      setError('A run id is required.');
      return;
    }
    run(async () => {
      const res = await copilotApi.explainRun({ runId: runId.trim() });
      setExplainResult(res);
    });
  }, [runId, run]);

  const onGenerateDocs = useCallback(() => {
    if (!requestId.trim()) {
      setError('A request id is required.');
      return;
    }
    run(async () => {
      const res = await copilotApi.generateDocs({ requestId: requestId.trim() });
      setDocsResult(res);
    });
  }, [requestId, run]);

  const assertionsJson = useMemo(
    () => (assertionResult ? JSON.stringify(assertionResult.assertions, null, 2) : ''),
    [assertionResult]
  );
  const docsJson = useMemo(() => (docsResult ? JSON.stringify(docsResult.blocks, null, 2) : ''), [docsResult]);

  return (
    <div className={styles.copilotRoot} data-testid="copilot-panel">
      <header className={styles.copilotHeader}>
        <div>
          <h1 className={styles.copilotTitle}>AI copilot</h1>
          <p className={styles.copilotSubtitle}>
            Generate assertions, explain failures and draft docs. Inputs are redacted before leaving the server.
          </p>
        </div>
        <span
          className={`${styles.statusBadge} ${configured ? styles.statusOn : styles.statusOff}`}
          data-testid="copilot-status"
        >
          {status === null ? 'Checking provider…' : configured ? `Ready${status.model ? ` · ${status.model}` : ''}` : 'Not configured'}
        </span>
      </header>

      {!configured && status !== null && (
        <div className={styles.notice}>
          Configure a project-scoped model with <code>USER_LLM_API_KEY</code>, <code>USER_LLM_BASE_URL</code> and{' '}
          <code>USER_LLM_MODEL</code>. No platform-wide key is used.
        </div>
      )}

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'assertions'}
          className={`${styles.tab} ${tab === 'assertions' ? styles.tabActive : ''}`}
          onClick={() => setTab('assertions')}
        >
          Assertions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'explain'}
          className={`${styles.tab} ${tab === 'explain' ? styles.tabActive : ''}`}
          onClick={() => setTab('explain')}
        >
          Explain run
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'docs'}
          className={`${styles.tab} ${tab === 'docs' ? styles.tabActive : ''}`}
          onClick={() => setTab('docs')}
        >
          Docs
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {tab === 'assertions' && (
        <section className={styles.section}>
          <label className={styles.field}>
            <span className={styles.label}>Request id</span>
            <input
              className={styles.input}
              value={requestId}
              placeholder="uuid of a stored request"
              onChange={(e) => setRequestId(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Response snapshot (optional JSON; falls back to the latest run)</span>
            <textarea
              className={styles.textarea}
              value={responseText}
              placeholder='{"status":200,"headers":{},"body":"{}"}'
              onChange={(e) => setResponseText(e.target.value)}
            />
          </label>
          {responseError && <div className={styles.error}>{responseError}</div>}
          <button type="button" className={styles.primaryBtn} disabled={busy} onClick={onGenerateAssertions}>
            {busy ? 'Generating…' : 'Generate assertions'}
          </button>

          {assertionResult && (
            <div className={styles.result}>
              <div className={styles.resultHead}>
                <span className={styles.resultTitle}>Proposed assertions</span>
                <span className={styles.subtle}>{usageLabel(assertionResult.usage)}</span>
              </div>
              {assertionResult.assertions.length === 0 ? (
                <p className={styles.subtle}>No assertions were proposed.</p>
              ) : (
                <ul className={styles.list}>
                  {assertionResult.assertions.map((a) => (
                    <li key={a.id} className={styles.assertionRow}>
                      <code>{assertionLine(a)}</code>
                    </li>
                  ))}
                </ul>
              )}
              {assertionsJson && (
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => navigator.clipboard?.writeText(assertionsJson)}
                >
                  Copy JSON
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {tab === 'explain' && (
        <section className={styles.section}>
          <label className={styles.field}>
            <span className={styles.label}>Run id</span>
            <input
              className={styles.input}
              value={runId}
              placeholder="uuid of a run history record"
              onChange={(e) => setRunId(e.target.value)}
            />
          </label>
          <button type="button" className={styles.primaryBtn} disabled={busy} onClick={onExplainRun}>
            {busy ? 'Analyzing…' : 'Explain this run'}
          </button>

          {explainResult && (
            <div className={styles.result}>
              <div className={styles.resultHead}>
                <span className={styles.resultTitle}>Explanation</span>
                <span className={styles.subtle}>{usageLabel(explainResult.usage)}</span>
              </div>
              <p className={styles.explanation}>{explainResult.explanation || 'No explanation returned.'}</p>
            </div>
          )}
        </section>
      )}

      {tab === 'docs' && (
        <section className={styles.section}>
          <label className={styles.field}>
            <span className={styles.label}>Request id</span>
            <input
              className={styles.input}
              value={requestId}
              placeholder="uuid of a stored request"
              onChange={(e) => setRequestId(e.target.value)}
            />
          </label>
          <button type="button" className={styles.primaryBtn} disabled={busy} onClick={onGenerateDocs}>
            {busy ? 'Drafting…' : 'Generate docs blocks'}
          </button>

          {docsResult && (
            <div className={styles.result}>
              <div className={styles.resultHead}>
                <span className={styles.resultTitle}>Doc blocks</span>
                <span className={styles.subtle}>{usageLabel(docsResult.usage)}</span>
              </div>
              <div className={styles.blocks}>
                {docsResult.blocks.map((b, i) => (
                  <BlockPreview key={`${b.type}-${i}`} block={b} />
                ))}
              </div>
              {docsJson && (
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => navigator.clipboard?.writeText(docsJson)}
                >
                  Copy JSON
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function BlockPreview({ block }: { block: CopilotDocBlock }) {
  if (block.type === 'heading') return <h3 className={styles.blockHeading}>{String(block.content.text ?? '')}</h3>;
  if (block.type === 'text') return <p className={styles.blockText}>{String(block.content.text ?? '')}</p>;
  if (block.type === 'code') {
    return (
      <pre className={styles.blockCode}>
        <code>{String(block.content.code ?? '')}</code>
      </pre>
    );
  }
  if (block.type === 'list') {
    const items = Array.isArray(block.content.items) ? (block.content.items as unknown[]) : [];
    return (
      <ul className={styles.list}>
        {items.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }
  return null;
}

export default CopilotPanel;
