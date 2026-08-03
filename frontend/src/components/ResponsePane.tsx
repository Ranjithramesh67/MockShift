'use client';

import React from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { CodeEditor } from './CodeEditor';

export function ResponsePane() {
  const ws = useWorkspace();
  const run = ws.lastRun;
  const response = run?.response ?? null;

  const language = (() => {
    if (!response) return 'json';
    const ct = Object.keys(response.headers).reduce(
      (acc, k) => (k.toLowerCase() === 'content-type' ? response.headers[k] : acc),
      ''
    );
    if (ct.includes('xml')) return 'xml';
    if (ct.includes('html')) return 'text';
    return 'json';
  })();

  return (
    <div className="response-pane" data-testid="response-pane">
      <div className="response-header">
        <span>Response</span>
        {run ? (
          <span className={`status-chip ${run.httpStatus >= 400 ? 'status-err' : 'status-ok'}`}>
            {run.httpStatus > 0 ? `${run.httpStatus} · ${response?.durationMs ?? 0}ms` : 'network error'}
          </span>
        ) : (
          <span className="hint">Press Send to execute the request.</span>
        )}
      </div>

      {run?.error && (
        <div className="run-error" data-testid="run-error">
          {run.error}
        </div>
      )}

      {run?.resolvedAuth && (
        <div className="auth-injected" data-testid="auth-injected">
          Auth injected: <code>{run.resolvedAuth.headerKey}: {run.resolvedAuth.headerValue}</code>
        </div>
      )}

      {response ? (
        <div className="response-body">
          <div className="response-tabs">
            <span className="response-tab">Body</span>
            <span className="response-tab muted">Headers</span>
          </div>
          <CodeEditor
            value={response.body}
            onChange={() => undefined}
            language={language}
            height="100%"
            readOnly
            ariaLabel="Response body"
          />
        </div>
      ) : (
        <div className="panel-empty">No response yet.</div>
      )}
    </div>
  );
}
