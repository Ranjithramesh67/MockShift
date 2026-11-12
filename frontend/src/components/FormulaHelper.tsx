'use client';

import React, { useEffect, useState } from 'react';
import { FormulaIcon, ChevronIcon, XIcon, ShareIcon } from './icons';
import { SNIPPETS } from '@/lib/formulaSnippets';
import { formulaSnippetsApi, type FormulaSnippet } from '@/lib/api';
import { CodeEditor } from './CodeEditor';
import { copyText } from '@/lib/clipboard';

interface HelperSnippet {
  title: string;
  code: string;
  description: string;
  custom?: boolean;
}

const LEGACY_KEY = 'mockshift.formula.customSnippets';

function fromApi(items: FormulaSnippet[]): HelperSnippet[] {
  return items
    .filter((s) => s && typeof s.title === 'string' && typeof s.code === 'string')
    .map((s) => ({
      title: s.title,
      code: s.code,
      description: typeof s.description === 'string' && s.description ? s.description : 'Custom formula',
      custom: true,
    }));
}

function loadLegacy(): HelperSnippet[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return fromApi(parsed);
  } catch {
    return [];
  }
}

function clearLegacy() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

function absoluteShareUrl(path: string) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export function FormulaHelper({ onInsert }: { onInsert: (code: string) => void }) {
  const [open, setOpen] = useState(true);
  const [custom, setCustom] = useState<HelperSnippet[]>([]);
  const [mode, setMode] = useState<'list' | 'create' | 'import'>('list');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sharedUrl, setSharedUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await formulaSnippetsApi.get();
        if (cancelled) return;
        let items = fromApi(Array.isArray(res.snippets) ? res.snippets : []);
        const legacy = loadLegacy();
        if (items.length === 0 && legacy.length > 0) {
          try {
            const saved = await formulaSnippetsApi.save(legacy);
            if (cancelled) return;
            items = fromApi(saved.snippets);
            clearLegacy();
          } catch {
            items = legacy;
          }
        } else if (legacy.length) {
          clearLegacy();
        }
        setCustom(items);
      } catch {
        if (!cancelled) setCustom(loadLegacy());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = (items: HelperSnippet[]) => {
    setCustom(items);
    formulaSnippetsApi.save(items).catch(() => {
      /* keep the optimistic list; it will re-sync on the next load */
    });
  };

  const resetForm = () => {
    setName('');
    setCode('');
    setImportUrl('');
    setMode('list');
    setBusy(false);
  };

  const onSave = () => {
    const title = name.trim();
    const body = code.trim();
    if (!title || !body) return;
    persist([...custom, { title, code: body, description: 'Custom formula', custom: true }]);
    resetForm();
  };

  const onDelete = (index: number) => {
    persist(custom.filter((_, i) => i !== index));
  };

  const onShare = async (snippet: HelperSnippet) => {
    setNotice('');
    setSharedUrl('');
    try {
      const res = await formulaSnippetsApi.share({
        title: snippet.title,
        code: snippet.code,
        description: snippet.description,
      });
      const url = absoluteShareUrl(res.share.url);
      setSharedUrl(url);
      const copied = await copyText(url);
      setNotice(copied ? 'Share link copied' : url);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not share formula');
    }
  };

  const onImport = async () => {
    const raw = importUrl.trim();
    if (!raw) return;
    setBusy(true);
    setNotice('');
    try {
      const res = await formulaSnippetsApi.import({ url: raw, token: raw });
      setCustom(fromApi(res.snippets));
      resetForm();
      setNotice('Formula imported');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not import formula');
      setBusy(false);
    }
  };

  const items: HelperSnippet[] = [...SNIPPETS, ...custom.map((s) => ({ ...s, custom: true }))];

  return (
    <div className="formula-helper" data-testid="formula-helper" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="formula-helper-head"
        data-testid="formula-helper-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="formula-helper-title">
          <FormulaIcon size={13} />
          Formula helpers
        </span>
        <span className="formula-helper-count">{items.length} snippets</span>
        <ChevronIcon size={12} style={{ transform: `rotate(${open ? 0 : -90}deg)`, transition: 'transform 0.15s ease' }} />
      </button>
      {open && (
        <div className="formula-helper-body" data-testid="formula-helper-body">
          <p className="hint">
            Pre-request formulas run in a sandbox before the request is sent. Click a helper to
            insert it at the cursor; the final expression&apos;s value becomes{' '}
            <code>returned</code>. Share a link to import a complex formula on another account.
          </p>
          <div className="formula-helper-grid">
            {SNIPPETS.map((s) => (
              <div key={`b:${s.title}`} className="formula-helper-item-wrap">
                <button
                  type="button"
                  className="formula-helper-item"
                  data-testid="formula-helper-item"
                  title={s.description}
                  onClick={() => onInsert(s.code)}
                >
                  <span className="formula-helper-name">{s.title}</span>
                  <code className="formula-helper-code">{s.code}</code>
                </button>
              </div>
            ))}
            {custom.map((s, i) => (
              <div key={`c:${i}:${s.title}`} className="formula-helper-item-wrap">
                <button
                  type="button"
                  className="formula-helper-item"
                  data-testid="formula-helper-item"
                  title={s.description}
                  onClick={() => onInsert(s.code)}
                >
                  <span className="formula-helper-name">{s.title}</span>
                  <code className="formula-helper-code">{s.code}</code>
                </button>
                <button
                  type="button"
                  className="formula-helper-share"
                  aria-label={`Share ${s.title}`}
                  data-testid="formula-helper-share"
                  onClick={() => onShare(s)}
                >
                  <ShareIcon size={11} />
                </button>
                <button
                  type="button"
                  className="formula-helper-delete"
                  aria-label={`Delete ${s.title}`}
                  data-testid="formula-helper-delete"
                  onClick={() => onDelete(i)}
                >
                  <XIcon size={11} />
                </button>
              </div>
            ))}
          </div>
          {notice && (
            <p className="hint formula-helper-notice" data-testid="formula-helper-notice">
              {notice}
            </p>
          )}
          {sharedUrl && (
            <input
              className="kv-cell"
              readOnly
              value={sharedUrl}
              data-testid="formula-share-url"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          {mode === 'create' ? (
            <div className="formula-create" data-testid="formula-create-form">
              <input
                className="kv-cell"
                type="text"
                placeholder="Name"
                value={name}
                data-testid="formula-create-name"
                onChange={(e) => setName(e.target.value)}
              />
              <div className="formula-create-editor" data-testid="formula-create-code">
                <CodeEditor
                  value={code}
                  onChange={setCode}
                  language="javascript"
                  completions
                  height="140px"
                  placeholder={'const stamp = $utils.formatDate($utils.now(), "YYYY-MM-DD");\nreq.body.stamp = stamp;'}
                  ariaLabel="Formula code"
                />
              </div>
              <div className="formula-create-actions">
                <button type="button" className="primary-button small" data-testid="formula-create-save" onClick={onSave}>
                  Save
                </button>
                <button type="button" className="ghost-button small" data-testid="formula-create-cancel" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            </div>
          ) : mode === 'import' ? (
            <div className="formula-create" data-testid="formula-import-form">
              <input
                className="kv-cell"
                type="text"
                placeholder="Paste /s/formula/… link"
                value={importUrl}
                data-testid="formula-import-url"
                onChange={(e) => setImportUrl(e.target.value)}
              />
              <div className="formula-create-actions">
                <button
                  type="button"
                  className="primary-button small"
                  data-testid="formula-import-save"
                  disabled={busy}
                  onClick={onImport}
                >
                  Import
                </button>
                <button type="button" className="ghost-button small" data-testid="formula-import-cancel" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="formula-create-actions formula-create-open">
              <button
                type="button"
                className="ghost-button small"
                data-testid="formula-create-open"
                onClick={() => setMode('create')}
              >
                Create formula
              </button>
              <button
                type="button"
                className="ghost-button small"
                data-testid="formula-import-open"
                onClick={() => setMode('import')}
              >
                Import formula
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
