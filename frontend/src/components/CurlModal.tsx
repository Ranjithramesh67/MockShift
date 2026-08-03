'use client';

import React, { useState } from 'react';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { contentApi } from '@/lib/api';
import { parseCurl } from '@/lib/curl';
import { Modal } from './Modal';

export function CurlModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dispatch } = useApp();
  const ws = useWorkspace();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const onImport = async () => {
    if (!value.trim()) {
      setError('Paste a cURL command first.');
      return;
    }
    if (!ws.activeCollectionId) {
      setError('Select a collection in the sidebar first.');
      return;
    }
    setBusy(true);
    try {
      const parsed = parseCurl(value);
      if (!parsed.url) {
        setError('Could not find a URL in that cURL command.');
        return;
      }
      const { request } = await contentApi.createRequest({
        collectionId: ws.activeCollectionId,
        name: 'Imported request',
        method: parsed.method,
        url: parsed.url,
        apiType: 'REST',
      });
      await contentApi.updateRequest(request.id, {
        headers: parsed.headers,
        queryParams: parsed.queryParams,
        bodyType: parsed.bodyType,
        bodyJson: parsed.bodyJson ?? parsed.bodyText ?? null,
      });
      await ws.reloadTree();
      await ws.selectRequest(request.id);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'cURL imported into the current collection.' });
      setValue('');
      setError(null);
      onClose();
    } catch (err) {
      setError(`Could not import the cURL command: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import from cURL" onClose={onClose} testId="curl-modal">
      <p className="hint">Paste a full curl command. Headers, method, URL, query params and body are parsed.</p>
      <textarea
        className="curl-input"
        rows={8}
        spellCheck={false}
        placeholder={'curl -X POST \'https://api.example.com/orders\' \\\n  -H \'Content-Type: application/json\' \\\n  -H \'Authorization: Bearer token123\' \\\n  --data-raw \'{"sku": "A1"}\''}
        aria-label="cURL command"
        data-testid="curl-paste-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      {error && (
        <div className="validation-banner" data-testid="curl-import-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary-button" disabled={busy} data-testid="curl-import-confirm" onClick={onImport}>
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
