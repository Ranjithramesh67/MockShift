'use client';

import React, { useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { CodeEditor } from './CodeEditor';
import { AlertIcon } from './icons';

export function ResponsePane() {
  const ws = useWorkspace();
  const run = ws.lastRun;
  const response = run?.response ?? null;
  const [showHeaders, setShowHeaders] = useState(false);

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

  const size = response ? new Blob([response.body]).size : 0;
  const sizeLabel = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;

  return (
    <div className="response-pane" data-testid="response-pane">
      <div className="response-header">
        <span>Response</span>
        {run ? (
          <span className={`status-chip ${run.httpStatus >= 400 ? 'status-err' : 'status-ok'}`}>
            {run.httpStatus > 0 ? `${run.httpStatus}` : 'network error'}
          </span>
        ) : (
          <span className="hint">Press Send to execute the request.</span>
        )}
      </div>

      {run?.error && (
        <div className="run-error" data-testid="run-error">
          <AlertIcon size={14} />
          {run.error}
        </div>
      )}

      {run?.resolvedAuth && (
        <div className="auth-injected" data-testid="auth-injected">
          Auth injected: <code>
            {run.resolvedAuth.headerKey}: {run.resolvedAuth.headerValue}
          </code>
        </div>
      )}

      {response ? (
        <div className="response-body">
          {run && (
            <div className="response-meta">
              {run.httpStatus > 0 && (
                <span>
                  Status: <strong>{run.httpStatus}</strong>
                </span>
              )}
              {response.durationMs != null && (
                <span>
                  Time: <strong>{response.durationMs}ms</strong>
                </span>
              )}
              <span>
                Size: <strong>{sizeLabel}</strong>
              </span>
            </div>
          )}
          <div className="response-tabs">
            <button
              type="button"
              className={`response-tab ${showHeaders ? 'muted' : ''}`}
              onClick={() => setShowHeaders(false)}
            >
              Body
            </button>
            <button
              type="button"
              className={`response-tab ${showHeaders ? '' : 'muted'}`}
              onClick={() => setShowHeaders(true)}
            >
              Headers
            </button>
          </div>
          {showHeaders ? (
            <div className="kv-rows" style={{ maxWidth: 'none' }}>
              {Object.entries(response.headers).map(([k, v]) => (
                <div className="kv-row" key={k}>
                  <span className="kv-cell" style={{ fontWeight: 600, maxWidth: '40%' }}>
                    {k}
                  </span>
                  <span className="kv-cell" style={{ wordBreak: 'break-all' }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <CodeEditor
              value={response.body}
              onChange={() => undefined}
              language={language}
              height="100%"
              readOnly
              ariaLabel="Response body"
            />
          )}
        </div>
      ) : (
        <div className="panel-empty">No response yet.</div>
      )}
    </div>
  );
}
