'use client';

import React, { useRef } from 'react';
import type { BodyFormPart } from '@/lib/types';
import { newTextPart } from '@/lib/multipartParts';
import { XIcon, PlusIcon, FileIcon } from './icons';

interface MultipartRowsProps {
  parts: BodyFormPart[];
  onChange: (next: BodyFormPart[]) => void;
  files: Record<string, File>;
  onFileChange: (partId: string, file: File | null) => void;
  testIdPrefix?: string;
}

function formatFileSize(size: number | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rendered = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rendered} ${units[unit]}`;
}

export function MultipartRows({
  parts = [],
  onChange,
  files,
  onFileChange,
  testIdPrefix = 'multipart',
}: MultipartRowsProps) {
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const updateRow = (index: number, patch: Partial<BodyFormPart>) => {
    onChange(parts.map((part, i) => (i === index ? { ...part, ...patch } : part)));
  };

  const removeRow = (index: number) => {
    onChange(parts.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...parts, newTextPart() as BodyFormPart]);
  };

  const changeKind = (index: number, kind: BodyFormPart['kind']) => {
    onChange(
      parts.map((part, i) => {
        if (i !== index) return part;
        if (kind === 'file') {
          // Switching to a file part: clear the text value, keep id/key/enabled.
          return { ...part, kind: 'file', value: undefined };
        }
        // Switching to a text part: clear any persisted file reference fields.
        return { ...part, kind: 'text', fileName: undefined, fileType: undefined, fileSize: undefined };
      })
    );
  };

  const openPicker = (partId: string) => {
    fileInputs.current[partId]?.click();
  };

  // Write the chosen file's reference metadata into the part itself so that a
  // Save persists the fileName/type/size (the bytes never leave the in-memory
  // File map). Clearing removes the metadata again.
  const syncFileMetadata = (partId: string, file: File | null) => {
    onChange(
      parts.map((part) => {
        if (part.id !== partId) return part;
        if (!file) {
          return { ...part, fileName: undefined, fileType: undefined, fileSize: undefined };
        }
        return {
          ...part,
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
        };
      })
    );
  };

  const onPick = (partId: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      onFileChange(partId, file);
      syncFileMetadata(partId, file);
    }
    // Reset so choosing the same file again still fires onChange.
    e.target.value = '';
  };

  const clearFile = (partId: string) => {
    onFileChange(partId, null);
    syncFileMetadata(partId, null);
  };

  return (
    <div className="multipart-rows" data-testid={`${testIdPrefix}-rows`}>
      <div className="multipart-row multipart-row-header">
        <span className="multipart-check" />
        <span className="multipart-cell multipart-cell-label">Key</span>
        <span className="multipart-kind multipart-cell-label">Kind</span>
        <span className="multipart-cell multipart-cell-label">Value</span>
        <span className="multipart-actions" />
      </div>

      {parts.length === 0 && (
        <div className="multipart-empty" data-testid={`${testIdPrefix}-empty`}>
          <p className="multipart-empty-hint">Multipart form-data parts (text and files).</p>
        </div>
      )}

      {parts.map((part, index) => {
        const chosenFile = files[part.id];
        return (
          <div className="multipart-row" key={part.id} data-testid={`${testIdPrefix}-row-${index}`}>
            <label className="multipart-check">
              <input
                type="checkbox"
                checked={part.enabled}
                onChange={(e) => updateRow(index, { enabled: e.target.checked })}
                aria-label="Enabled"
                title="Toggle entry"
              />
            </label>
            <input
              className="multipart-cell"
              type="text"
              value={part.key}
              placeholder="Key"
              spellCheck={false}
              aria-label="Key"
              data-testid={`${testIdPrefix}-key-${index}`}
              onChange={(e) => updateRow(index, { key: e.target.value })}
            />
            <select
              className="multipart-kind"
              aria-label="Kind"
              data-testid={`${testIdPrefix}-kind-${index}`}
              value={part.kind}
              onChange={(e) => changeKind(index, e.target.value as BodyFormPart['kind'])}
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>

            {part.kind === 'file' ? (
              <div className="multipart-file-cell">
                <input
                  ref={(el) => {
                    fileInputs.current[part.id] = el;
                  }}
                  type="file"
                  className="multipart-file-input"
                  data-testid={`${testIdPrefix}-file-${index}`}
                  aria-label="Choose file"
                  onChange={onPick(part.id)}
                />
                <button
                  type="button"
                  className="multipart-file-button"
                  aria-label="Choose file"
                  onClick={() => openPicker(part.id)}
                >
                  <FileIcon size={12} />
                  Choose file
                </button>
                <div className="multipart-file-meta">
                  {chosenFile ? (
                    <>
                      <span className="multipart-file-name" title={chosenFile.name}>
                        {chosenFile.name}
                        <span className="multipart-file-size">({formatFileSize(chosenFile.size)})</span>
                      </span>
                      <button
                        type="button"
                        className="icon-button multipart-clear"
                        aria-label="Clear file"
                        title="Clear file"
                        data-testid={`${testIdPrefix}-clear-${index}`}
                        onClick={() => clearFile(part.id)}
                      >
                        <XIcon size={12} />
                      </button>
                    </>
                  ) : part.fileName ? (
                    <span className="multipart-file-persisted">
                      <span className="multipart-file-name" title={part.fileName}>
                        {part.fileName}
                      </span>
                      <span className="multipart-file-hint">Re-choose a file to send</span>
                    </span>
                  ) : (
                    <span className="multipart-file-none">No file chosen</span>
                  )}
                </div>
              </div>
            ) : (
              <input
                className="multipart-cell"
                type="text"
                value={part.value ?? ''}
                placeholder="Value"
                spellCheck={false}
                aria-label="Value"
                data-testid={`${testIdPrefix}-value-${index}`}
                onChange={(e) => updateRow(index, { value: e.target.value })}
              />
            )}

            <div className="multipart-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Remove row"
                title="Remove row"
                data-testid={`${testIdPrefix}-remove-${index}`}
                onClick={() => removeRow(index)}
              >
                <XIcon size={13} />
              </button>
            </div>
          </div>
        );
      })}

      <div>
        <button
          type="button"
          className="ghost-button small"
          data-testid={`${testIdPrefix}-add`}
          onClick={addRow}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <PlusIcon size={12} />
          Add row
        </button>
      </div>
    </div>
  );
}
