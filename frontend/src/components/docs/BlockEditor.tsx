'use client';

import React, { useRef } from 'react';
import { useApp } from '@/store/AppStore';
import {
  blockNum,
  blockStrings,
  blockText,
  BLOCK_LABELS,
  IMAGE_SIZES,
  imageSizeOf,
  newBlock,
  TABLE_MAX_CELL,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  tableRows,
  type DocsBlock,
  type DocsBlockContent,
  type DocsBlockType,
} from '@/lib/docsApi';
import styles from './docs.module.css';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, XIcon } from '@/components/icons';

function setField(c: DocsBlockContent, field: string, value: unknown): DocsBlockContent {
  return { ...c, [field]: value };
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function EditorTextarea({
  value,
  onChange,
  mono,
  rows,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  rows?: number;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <textarea
      className={`${styles.editorTextarea} ${mono ? styles.monoArea : ''}`}
      rows={rows ?? 3}
      value={value}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EditorText({
  value,
  onChange,
  testId,
  large,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
  large?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      className={`${styles.editorInput} ${large ? styles.headingEditorInput : ''}`}
      value={value}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Image block editor: upload a local file (data: URL via FileReader, capped at
// 5 MB) or paste an http(s)/data URL, with optional alt text and caption.
function ImageBlockFields({
  content,
  onChange,
}: {
  content: DocsBlockContent;
  onChange: (content: DocsBlockContent) => void;
}) {
  const { dispatch } = useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const src = blockText(content, 'src');
  const alt = blockText(content, 'alt');
  const caption = blockText(content, 'caption');

  const onFile = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'error',
        message: 'Image is larger than 5 MB — choose a smaller file or paste an image URL instead.',
      });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange(setField(content, 'src', reader.result));
    };
    reader.onerror = () => {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: 'Could not read that image file.' });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <div className={styles.imgEditRow}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={styles.imgFileInput}
          data-testid="docs-field-image-file"
          aria-label="Upload image"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <button type="button" className="ghost-button small" data-testid="docs-field-image-upload" onClick={() => fileRef.current?.click()}>
          Choose image file…
        </button>
        <span className={styles.imgFileHint}>Max 5 MB — stored inline in the page</span>
      </div>
      <EditorText
        value={src.startsWith('data:') ? '' : src}
        onChange={(v) => onChange(setField(content, 'src', v))}
        placeholder="…or paste an image URL (https://…)"
        testId="docs-field-image-src"
      />
      {src.startsWith('data:') && src.length > 0 && (
        <span className={styles.imgEmbeddedNote}>Image embedded from file</span>
      )}
      <div className={styles.fieldRow}>
        <EditorText
          value={alt}
          onChange={(v) => onChange(setField(content, 'alt', v))}
          placeholder="Alt text (optional)"
          testId="docs-field-image-alt"
        />
        <EditorText
          value={caption}
          onChange={(v) => onChange(setField(content, 'caption', v))}
          placeholder="Caption (optional)"
          testId="docs-field-image-caption"
        />
      </div>
      <div className={styles.sizeCtl} role="group" aria-label="Image size">
        <span className={styles.sizeCtlLabel}>Size</span>
        {IMAGE_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.sizeCtlBtn} ${imageSizeOf(content) === s ? styles.sizeCtlBtnActive : ''}`}
            data-testid={`docs-image-size-${s}`}
            disabled={!src}
            onClick={() => onChange(setField(content, 'size', s))}
          >
            {s === 'full' ? 'Full' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {src && (
        <div className={styles.imgThumbWrap} data-testid="docs-field-image-thumb">
          <img className={styles.imgThumb} src={src} alt={alt || 'Image preview'} />
          {src.startsWith('data:') && (
            <button
              type="button"
              className="ghost-button small"
              data-testid="docs-field-image-remove"
              onClick={() => onChange(setField(content, 'src', ''))}
            >
              Remove image
            </button>
          )}
        </div>
      )}
    </>
  );
}

// Table block editor (DR6): a rectangular cell grid. The first row is the
// header row. Add/remove rows and columns within the backend guardrails
// (TABLE_MAX_ROWS/TABLE_MAX_COLS/TABLE_MAX_CELL).
function TableBlockFields({
  content,
  onChange,
}: {
  content: DocsBlockContent;
  onChange: (content: DocsBlockContent) => void;
}) {
  const rows = tableRows(content);
  const caption = blockText(content, 'caption');
  const cols = rows[0]?.length ?? 0;

  const setCell = (r: number, ci: number, value: string) => {
    const next = rows.map((row) => row.slice());
    next[r][ci] = value.slice(0, TABLE_MAX_CELL);
    onChange(setField(content, 'rows', next));
  };

  const addRow = () => {
    if (rows.length >= TABLE_MAX_ROWS) return;
    onChange(setField(content, 'rows', [...rows.map((r) => r.slice()), Array.from({ length: cols || 1 }, () => '')]));
  };

  const removeRow = (r: number) => {
    if (rows.length <= 1) return;
    onChange(setField(content, 'rows', rows.filter((_, i) => i !== r).map((row) => row.slice())));
  };

  const addCol = () => {
    if (cols >= TABLE_MAX_COLS) return;
    onChange(setField(content, 'rows', rows.map((row) => [...row, ''])));
  };

  const removeCol = (ci: number) => {
    if (cols <= 1) return;
    onChange(setField(content, 'rows', rows.map((row) => row.filter((_, i) => i !== ci))));
  };

  return (
    <div className={styles.tableEditor}>
      <div className={styles.tableScroll}>
        <table className={styles.tableGrid} data-testid="docs-field-table">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, ci) => (
                  <td key={ci} className={r === 0 ? styles.tableHeadCell : undefined}>
                    <div className={styles.tableCellWrap}>
                      <input
                        type="text"
                        className={styles.tableCellInput}
                        value={cell}
                        maxLength={TABLE_MAX_CELL}
                        placeholder={r === 0 ? `Header ${ci + 1}` : ''}
                        data-testid={`docs-field-table-cell-${r}-${ci}`}
                        onChange={(e) => setCell(r, ci, e.target.value)}
                      />
                      {r === 0 && (
                        <button
                          type="button"
                          className={styles.tableCtlBtn}
                          title={cols <= 1 ? 'A table needs at least one column' : 'Remove column'}
                          disabled={cols <= 1}
                          data-testid={`docs-table-remove-col-${ci}`}
                          onClick={() => removeCol(ci)}
                        >
                          <XIcon size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                ))}
                <td className={styles.tableCtlCell}>
                  <button
                    type="button"
                    className={styles.tableCtlBtn}
                    title={rows.length <= 1 ? 'A table needs at least one row' : 'Remove row'}
                    disabled={rows.length <= 1}
                    data-testid={`docs-table-remove-row-${r}`}
                    onClick={() => removeRow(r)}
                  >
                    <XIcon size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.tableEditBar}>
        <button
          type="button"
          className="ghost-button small"
          data-testid="docs-table-add-row"
          disabled={rows.length >= TABLE_MAX_ROWS}
          onClick={addRow}
        >
          <PlusIcon size={12} />
          Add row
        </button>
        <button
          type="button"
          className="ghost-button small"
          data-testid="docs-table-add-col"
          disabled={cols >= TABLE_MAX_COLS}
          onClick={addCol}
        >
          <PlusIcon size={12} />
          Add column
        </button>
        <span className={styles.imgFileHint}>
          Header row + {Math.max(rows.length - 1, 0)} body rows · max {TABLE_MAX_ROWS}×{TABLE_MAX_COLS}
        </span>
      </div>
      <EditorText
        value={caption}
        onChange={(v) => onChange(setField(content, 'caption', v))}
        placeholder="Caption (optional)"
        testId="docs-field-table-caption"
      />
    </div>
  );
}

function BlockFields({
  block,
  onChange,
}: {
  block: DocsBlock;
  onChange: (content: DocsBlockContent) => void;
}) {
  const c = block.content;
  switch (block.type) {
    case 'heading':
      return (
        <EditorText
          large
          value={blockText(c, 'text')}
          onChange={(v) => onChange(setField(c, 'text', v))}
          testId="docs-field-heading"
        />
      );
    case 'text':
      return (
        <EditorTextarea
          rows={4}
          value={blockText(c, 'text')}
          onChange={(v) => onChange(setField(c, 'text', v))}
          placeholder="Write some text…"
          testId="docs-field-text"
        />
      );
    case 'code':
      return (
        <>
          <EditorText value={blockText(c, 'language', 'text')} onChange={(v) => onChange(setField(c, 'language', v))} testId="docs-field-language" />
          <EditorTextarea
            mono
            rows={6}
            value={blockText(c, 'code')}
            onChange={(v) => onChange(setField(c, 'code', v))}
            placeholder="code"
            testId="docs-field-code"
          />
        </>
      );
    case 'payload':
      return (
        <>
          <div className={styles.fieldRow}>
            <EditorText value={blockText(c, 'method', 'GET')} onChange={(v) => onChange(setField(c, 'method', v))} testId="docs-field-method" />
            <EditorText value={blockText(c, 'contentType', 'application/json')} onChange={(v) => onChange(setField(c, 'contentType', v))} testId="docs-field-contenttype" />
          </div>
          <EditorTextarea
            mono
            rows={6}
            value={blockText(c, 'body')}
            onChange={(v) => onChange(setField(c, 'body', v))}
            placeholder="{ … request body … }"
            testId="docs-field-payload-body"
          />
        </>
      );
    case 'response': {
      const status = blockNum(c, 'status', 0);
      return (
        <>
          <EditorText
            value={String(status)}
            onChange={(v) => {
              const n = Number(v);
              onChange(setField(c, 'status', Number.isFinite(n) ? n : 0));
            }}
            testId="docs-field-status"
          />
          <EditorTextarea
            mono
            rows={6}
            value={blockText(c, 'body')}
            onChange={(v) => onChange(setField(c, 'body', v))}
            placeholder="{ … response body … }"
            testId="docs-field-response-body"
          />
        </>
      );
    }
    case 'schema':
      return (
        <>
          <EditorText value={blockText(c, 'language', 'json')} onChange={(v) => onChange(setField(c, 'language', v))} testId="docs-field-schema-language" />
          <EditorTextarea
            mono
            rows={6}
            value={blockText(c, 'definition')}
            onChange={(v) => onChange(setField(c, 'definition', v))}
            placeholder="{ … schema definition … }"
            testId="docs-field-schema"
          />
        </>
      );
    case 'list': {
      const items = blockStrings(c, 'items');
      const style = blockText(c, 'style', 'bullet');
      return (
        <>
          <select
            className="compact-select"
            data-testid="docs-field-list-style"
            value={style === 'number' ? 'number' : 'bullet'}
            onChange={(e) => onChange(setField(c, 'style', e.target.value as 'bullet' | 'number'))}
          >
            <option value="bullet">Bulleted</option>
            <option value="number">Numbered</option>
          </select>
          <EditorTextarea
            rows={5}
            value={items.join('\n')}
            onChange={(v) => onChange(setField(c, 'items', v.split('\n')))}
            placeholder={'One item per line'}
            testId="docs-field-list-items"
          />
        </>
      );
    }
    case 'image':
      return <ImageBlockFields content={c} onChange={onChange} />;
    case 'table':
      return <TableBlockFields content={c} onChange={onChange} />;
  }
}

export function BlocksEditor({
  blocks,
  onChange,
  testId,
}: {
  blocks: DocsBlock[];
  onChange: (next: DocsBlock[]) => void;
  testId?: string;
}) {
  const updateContent = (index: number, content: DocsBlockContent) => {
    onChange(blocks.map((b, i) => (i === index ? { ...b, content } : b)));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = blocks.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(blocks.filter((_, i) => i !== index));
  };

  const add = (type: DocsBlockType) => {
    onChange([...blocks, newBlock(type)]);
  };

  return (
    <div className={styles.blockList} data-testid={testId}>
      {blocks.map((b, i) => (
        <div key={b.id ?? `draft-${i}`} className={styles.blockCard} data-testid={`docs-block-editor-${i}`}>
          <div className={styles.blockCardHead}>
            <span className={styles.blockTypePill}>
              {BLOCK_LABELS.find((l) => l.type === b.type)?.label ?? b.type}
            </span>
            <div className={styles.blockTools}>
              <button type="button" className={styles.toolBtn} disabled={i === 0} title="Move up" onClick={() => move(i, -1)}>
                <ArrowUpIcon size={14} />
              </button>
              <button type="button" className={styles.toolBtn} disabled={i === blocks.length - 1} title="Move down" onClick={() => move(i, 1)}>
                <ArrowDownIcon size={14} />
              </button>
              <button type="button" className={`${styles.toolBtn} ${styles.danger}`} title="Remove block" onClick={() => remove(i)}>
                <TrashIcon size={14} />
              </button>
            </div>
          </div>
          <div className={styles.blockBody}>
            <BlockFields block={b} onChange={(content) => updateContent(i, content)} />
          </div>
        </div>
      ))}
      <div className={styles.addBlockBar}>
        {BLOCK_LABELS.map((l) => (
          <button key={l.type} type="button" className={styles.addTypeBtn} data-testid={`docs-add-${l.type}`} onClick={() => add(l.type)}>
            <PlusIcon size={12} />
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
