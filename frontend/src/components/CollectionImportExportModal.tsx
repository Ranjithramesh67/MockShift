'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { collectionExportApi } from '@/lib/api';
import { useWorkspace } from '@/store/WorkspaceStore';
import { useApp } from '@/store/AppStore';
import {
  collectionFileName,
  formatForDownload,
  parseCollectionFile,
} from '@/lib/collectionExport';
import { ExportIcon, ImportIcon, CollectionIcon, FileIcon } from './icons';

type Tab = 'export' | 'import';
type ExportFormat = 'json' | 'curl' | 'openapi';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  json: 'JSON (API Hub)',
  curl: 'cURL commands',
  openapi: 'OpenAPI 3.0',
};

export function CollectionImportExportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const { dispatch } = useApp();
  const [tab, setTab] = useState<Tab>('export');

  // ---- Export state
  const [exportCollectionId, setExportCollectionId] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  // ---- Import state
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [importName, setImportName] = useState('');
  const [importProjectId, setImportProjectId] = useState('');
  const [parsedFile, setParsedFile] = useState<unknown>(null);
  const [requestCount, setRequestCount] = useState<number | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab('export');
    setExportError('');
    setImportError('');
    setParsedFile(null);
    setRequestCount(null);
    setFileName('');
    setImportName('');
    setDragging(false);
    const collections = ws.tree?.collections ?? [];
    setExportCollectionId(ws.activeCollectionId || collections[0]?.id || '');
    const writeable = (ws.tree?.projects ?? []).filter((p) => p.can_access);
    setImportProjectId(writeable[0]?.id ?? '');
  }, [open, ws.tree, ws.activeCollectionId]);

  const clearFile = useCallback(() => {
    setFileName('');
    setParsedFile(null);
    setRequestCount(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  if (!open) return null;

  const collections = ws.tree?.collections ?? [];
  const projects = (ws.tree?.projects ?? []).filter((p) => p.can_access);

  const download = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onExport = async () => {
    setExportError('');
    if (!exportCollectionId) {
      setExportError('Select a collection to export.');
      return;
    }
    setExportBusy(true);
    try {
      const { collection } = await collectionExportApi.export(exportCollectionId);
      const collectionName =
        collections.find((c) => c.id === exportCollectionId)?.name ?? collection.name;
      const content = formatForDownload(exportFormat, collection);
      const ext = exportFormat === 'json' ? '.json' : exportFormat === 'openapi' ? '.openapi.json' : '.sh';
      download(`${collectionFileName(collectionName)}${ext}`, content, 'application/octet-stream');
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: `Exported "${collectionName}"` });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportBusy(false);
    }
  };

  const onFilePicked = async (file: File | null) => {
    setImportError('');
    setParsedFile(null);
    setRequestCount(null);
    if (!file) return;
    const text = await file.text().catch(() => '');
    try {
      const parsed = parseCollectionFile(text);
      setFileName(file.name);
      setParsedFile(parsed.data);
      setRequestCount(parsed.requestCount);
      setImportName(parsed.name);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid collection file');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.[0]) onFilePicked(e.dataTransfer.files[0]);
  };

  const onImport = async () => {
    setImportError('');
    if (!parsedFile) {
      setImportError('Choose a collection JSON file first.');
      return;
    }
    if (!importProjectId) {
      setImportError('Select a target project.');
      return;
    }
    if (!importName.trim()) {
      setImportError('Collection name is required.');
      return;
    }
    setImportBusy(true);
    try {
      await collectionExportApi.import({
        projectId: importProjectId,
        name: importName.trim(),
        collection: parsedFile as never,
      });
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: `Imported "${importName.trim()}"` });
      await ws.reloadTree();
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <Modal title="Import / export collections" onClose={onClose} testId="collection-import-export-modal">
      <div className="modal-tabs" data-testid="import-export-tabs">
        <button
          type="button"
          className={`modal-tab ${tab === 'export' ? 'active' : ''}`}
          data-testid="ie-tab-export"
          onClick={() => setTab('export')}
        >
          <ExportIcon size={13} />
          Export
        </button>
        <button
          type="button"
          className={`modal-tab ${tab === 'import' ? 'active' : ''}`}
          data-testid="ie-tab-import"
          onClick={() => setTab('import')}
        >
          <ImportIcon size={13} />
          Import
        </button>
      </div>

      {tab === 'export' ? (
        <div className="modal-form" data-testid="ie-export-pane">
          <div className="ie-col-grid">
            <label className="field">
              <span className="field-label">Collection</span>
              <select
                className="compact-select"
                data-testid="ie-export-collection"
                value={exportCollectionId}
                onChange={(e) => setExportCollectionId(e.target.value)}
              >
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Format</span>
              <select
                className="compact-select"
                data-testid="ie-export-format"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              >
                {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">
            JSON round-trips back into API Hub; cURL and OpenAPI are convenience exports for
            sharing with other tools.
          </p>
          {exportError && (
            <p className="auth-error" role="alert" data-testid="ie-export-error">
              {exportError}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              data-testid="ie-export-download"
              disabled={exportBusy || collections.length === 0}
              onClick={onExport}
            >
              <ExportIcon size={13} />
              {exportBusy ? 'Exporting…' : 'Download'}
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-form" data-testid="ie-import-pane">
          <label
            className={`ie-dropzone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              data-testid="ie-import-file"
              onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
            />
            {fileName ? (
              <span className="ie-dropzone-file" data-testid="ie-import-summary">
                <FileIcon size={16} />
                {fileName}
                <span className="ie-dropzone-meta">
                  {requestCount} request{requestCount === 1 ? '' : 's'}
                </span>
                <span className="ie-dropzone-action">Replace</span>
              </span>
            ) : (
              <span className="ie-dropzone-empty">
                <ImportIcon size={18} />
                <strong>Drop a collection file here</strong>
                <span>or click to browse (JSON from API Hub)</span>
              </span>
            )}
          </label>

          {importError && (
            <p className="auth-error" role="alert" data-testid="ie-import-error">
              {importError}
            </p>
          )}

          <div className="ie-col-grid">
            <label className="field">
              <span className="field-label">Collection name</span>
              <input
                type="text"
                className="text-input"
                data-testid="ie-import-name"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="Imported collection"
              />
            </label>
            <label className="field">
              <span className="field-label">Target project</span>
              <select
                className="compact-select"
                data-testid="ie-import-project"
                value={importProjectId}
                onChange={(e) => setImportProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {projects.length === 0 && (
            <p className="auth-error" role="alert">
              You need access to a project to import into.
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                clearFile();
                onClose();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              data-testid="ie-import-confirm"
              disabled={importBusy || !parsedFile || projects.length === 0}
              onClick={onImport}
            >
              <ImportIcon size={13} />
              {importBusy ? 'Importing…' : 'Import collection'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
