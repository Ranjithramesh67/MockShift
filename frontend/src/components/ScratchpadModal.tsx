'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { parseCurl, isCurlCommand } from '@/lib/curl';
import { scratchpadRequest } from '@/lib/scratchpad';
import { Modal } from './Modal';
import { PlayIcon } from './icons';

const MAX_PREVIEW_ROWS = 5;

/**
 * M8: scratchpad — paste a cURL command and run it immediately without
 * creating or saving a request (Postman scratchpad behaviour). The parsed
 * command is executed via the ephemeral `POST /api/runs` endpoint and the
 * response is surfaced in ResponsePane.
 */
export function ScratchpadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dispatch } = useApp();
  const ws = useWorkspace();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => {
    if (!isCurlCommand(value.trim())) return null;
    try {
      return parseCurl(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!open) return null;

  const onSend = async () => {
    if (!value.trim()) {
      setError('Paste a cURL command first.');
      return;
    }
    if (!parsed || !parsed.url) {
      setError('Could not find a URL in that cURL command.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ws.runScratchpad(scratchpadRequest(parsed));
      dispatch({ type: 'SET_VIEW_MODE', mode: 'side' });
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Scratchpad request executed (nothing saved).' });
      setValue('');
      onClose();
    } catch (err) {
      setError(`Could not run the cURL command: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const renderPreview = () => {
    if (!parsed || !parsed.url) {
      return (
        <p className="hint" data-testid="scratchpad-preview">
          Paste a curl command to see a structured preview.
        </p>
      );
    }
    return (
      <div className="scratchpad-preview" data-testid="scratchpad-preview">
        <div className="scratchpad-preview-line">
          <span className={`method-badge method-${parsed.method}`}>{parsed.method}</span>
          <span className="scratchpad-preview-url" title={parsed.url}>
            {parsed.url}
          </span>
        </div>
        {parsed.headers.length > 0 && (
          <div className="scratchpad-preview-group">
            <span className="scratchpad-preview-label">
              Headers ({parsed.headers.length})
            </span>
            <ul className="scratchpad-preview-list">
              {parsed.headers.slice(0, MAX_PREVIEW_ROWS).map((h, i) => (
                <li key={`${h.key}-${i}`}>
                  <strong>{h.key}</strong>
                  <span className="kv-sep">: </span>
                  <span className="kv-value">{h.value}</span>
                </li>
              ))}
              {parsed.headers.length > MAX_PREVIEW_ROWS && (
                <li className="scratchpad-preview-more">
                  +{parsed.headers.length - MAX_PREVIEW_ROWS} more
                </li>
              )}
            </ul>
          </div>
        )}
        {parsed.queryParams.length > 0 && (
          <div className="scratchpad-preview-group">
            <span className="scratchpad-preview-label">
              Query params ({parsed.queryParams.length})
            </span>
            <ul className="scratchpad-preview-list">
              {parsed.queryParams.slice(0, MAX_PREVIEW_ROWS).map((q, i) => (
                <li key={`${q.key}-${i}`}>
                  <strong>{q.key}</strong>
                  <span className="kv-sep">=</span>
                  <span className="kv-value">{q.value}</span>
                </li>
              ))}
              {parsed.queryParams.length > MAX_PREVIEW_ROWS && (
                <li className="scratchpad-preview-more">
                  +{parsed.queryParams.length - MAX_PREVIEW_ROWS} more
                </li>
              )}
            </ul>
          </div>
        )}
        {parsed.bodyType !== 'NONE' && (
          <div className="scratchpad-preview-group">
            <span className="scratchpad-preview-label">
              Body ({parsed.bodyType})
            </span>
            <pre className="scratchpad-preview-body">
              {typeof (parsed.bodyJson ?? parsed.bodyText) === 'string'
                ? String(parsed.bodyJson ?? parsed.bodyText)
                : JSON.stringify(parsed.bodyJson ?? parsed.bodyText ?? '', null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal title="Test cURL (scratchpad)" onClose={onClose} testId="scratchpad-modal">
      <p className="hint">
        Paste a full curl command and hit <strong>Send</strong> to run it right away — nothing is
        saved, no request is created.
      </p>
      <textarea
        className="curl-input"
        rows={6}
        spellCheck={false}
        placeholder={'curl -X POST \'https://api.example.com/orders\' \\\n  -H \'Content-Type: application/json\' \\\n  --data-raw \'{"sku": "A1"}\''}
        aria-label="cURL command"
        data-testid="scratchpad-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      {renderPreview()}
      {error && (
        <div className="validation-banner" data-testid="scratchpad-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          data-testid="scratchpad-send"
          onClick={onSend}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <PlayIcon size={14} />
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </Modal>
  );
}
