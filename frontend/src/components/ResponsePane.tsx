'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/store/WorkspaceStore';
import { CodeEditor } from './CodeEditor';
import { AlertIcon, ExportIcon } from './icons';
import {
  isPdf,
  isImage,
  isBinaryResponse,
  responseLanguage,
  prettify,
  responseBlob,
  filenameForResponse,
  downloadBlob,
} from '@/lib/responseView';

type ViewMode = 'pretty' | 'raw' | 'preview';

export function ResponsePane() {
  const ws = useWorkspace();
  const run = ws.lastRun;
  const response = run?.response ?? null;
  const [showHeaders, setShowHeaders] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('pretty');

  const language = response ? responseLanguage(response) : 'json';
  const isBinary = response ? isBinaryResponse(response) : false;
  const isPdfBody = response ? isPdf(response) : false;
  const isImageBody = response ? isImage(response) : false;
  const canFormat = !isBinary && (language === 'json' || language === 'xml' || language === 'html');

  // Binary responses (PDF, images) always render through the preview viewer.
  const effectiveView: ViewMode = isBinary ? 'preview' : viewMode;

  const prettyBody = useMemo(() => {
    if (!response || isBinary) return '';
    return prettify(response.body, language);
  }, [response, isBinary, language]);

  const size = useMemo(() => (response ? responseBlob(response).size : 0), [response]);
  const sizeLabel = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!response || !isBinary) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(responseBlob(response));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [response, isBinary]);

  const handleDownload = () => {
    if (!response) return;
    downloadBlob(
      responseBlob(response),
      filenameForResponse(response, run?.requestSnapshot?.url ?? undefined)
    );
  };

  const renderBody = () => {
    if (isPdfBody) {
      return previewUrl ? (
        <div className="response-viewer" data-testid="response-pdf-viewer">
          <iframe title="PDF preview" src={previewUrl} className="response-pdf-frame" />
        </div>
      ) : (
        <div className="panel-empty">PDF preview unavailable.</div>
      );
    }
    if (isImageBody) {
      return previewUrl ? (
        <div className="response-viewer" data-testid="response-image-viewer">
          <img src={previewUrl} alt="Response image" className="response-image" />
        </div>
      ) : (
        <div className="panel-empty">Image preview unavailable.</div>
      );
    }

    if (effectiveView === 'raw') {
      return (
        <CodeEditor
          value={response?.body ?? ''}
          onChange={() => undefined}
          language={language === 'html' ? 'text' : language}
          height="100%"
          readOnly
          ariaLabel="Response body"
        />
      );
    }

    if (effectiveView === 'preview') {
      if (language === 'html') {
        return (
          <div className="response-viewer" data-testid="response-html-preview">
            <iframe
              title="HTML preview"
              srcDoc={response?.body ?? ''}
              sandbox="allow-same-origin"
              className="response-html-frame"
            />
          </div>
        );
      }
      return <pre className="response-preview-text">{prettyBody || response?.body || ''}</pre>;
    }

    // Pretty
    return (
      <CodeEditor
        value={prettyBody}
        onChange={() => undefined}
        language={language === 'html' ? 'text' : language}
        height="100%"
        readOnly
        ariaLabel="Response body"
      />
    );
  };

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
            <>
              <div className="response-toolbar">
                {isBinary ? (
                  <span className="response-viewmode-label">
                    {isPdfBody ? 'PDF' : isImageBody ? 'Image' : 'Binary'} preview
                  </span>
                ) : (
                  <div className="response-viewmodes" role="group" aria-label="Body view mode">
                    {(['pretty', 'raw', 'preview'] as ViewMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`response-viewmode ${effectiveView === mode ? 'active' : ''}`}
                        onClick={() => setViewMode(mode)}
                      >
                        {mode === 'pretty' ? 'Pretty' : mode === 'raw' ? 'Raw' : 'Preview'}
                      </button>
                    ))}
                  </div>
                )}
                <div className="response-toolbar-actions">
                  {!isBinary && canFormat && (
                    <button
                      type="button"
                      className="response-action"
                      onClick={() => setViewMode('pretty')}
                    >
                      Prettify
                    </button>
                  )}
                  <button
                    type="button"
                    className="response-action"
                    onClick={handleDownload}
                    data-testid="response-download"
                  >
                    <ExportIcon size={13} />
                    Download
                  </button>
                </div>
              </div>
              {renderBody()}
            </>
          )}
        </div>
      ) : (
        <div className="panel-empty">No response yet.</div>
      )}
    </div>
  );
}
