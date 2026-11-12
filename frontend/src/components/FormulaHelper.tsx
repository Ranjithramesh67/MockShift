'use client';

import React, { useEffect, useState } from 'react';
import { FormulaIcon, ChevronIcon, XIcon } from './icons';
import { SNIPPETS } from '@/lib/formulaSnippets';
import { formulaSnippetsApi, type FormulaSnippet } from '@/lib/api';

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

export function FormulaHelper({ onInsert }: { onInsert: (code: string) => void }) {
  const [open, setOpen] = useState(true);
  const [custom, setCustom] = useState<HelperSnippet[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

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

  const onSave = () => {
    const title = name.trim();
    const body = code.trim();
    if (!title || !body) return;
    persist([...custom, { title, code: body, description: 'Custom formula', custom: true }]);
    setName('');
    setCode('');
    setCreating(false);
  };

  const onDelete = (title: string) => {
    persist(custom.filter((s) => s.title !== title));
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
            <code>returned</code>.
          </p>
          <div className="formula-helper-grid">
            {items.map((s: HelperSnippet) => (
              <div key={s.title} className="formula-helper-item-wrap">
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
                {s.custom && (
                  <button
                    type="button"
                    className="formula-helper-delete"
                    aria-label={`Delete ${s.title}`}
                    data-testid="formula-helper-delete"
                    onClick={() => onDelete(s.title)}
                  >
                    <XIcon size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {creating ? (
            <div className="formula-create" data-testid="formula-create-form">
              <input
                className="kv-cell"
                type="text"
                placeholder="Name"
                value={name}
                data-testid="formula-create-name"
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="kv-cell"
                type="text"
                placeholder={'req.body.stamp = $utils.formatDate($utils.now(), "YYYY-MM-DD")'}
                value={code}
                data-testid="formula-create-code"
                onChange={(e) => setCode(e.target.value)}
              />
              <div className="formula-create-actions">
                <button type="button" className="primary-button small" data-testid="formula-create-save" onClick={onSave}>
                  Save
                </button>
                <button
                  type="button"
                  className="ghost-button small"
                  data-testid="formula-create-cancel"
                  onClick={() => {
                    setCreating(false);
                    setName('');
                    setCode('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="ghost-button small formula-create-open"
              data-testid="formula-create-open"
              onClick={() => setCreating(true)}
            >
              Create formula
            </button>
          )}
        </div>
      )}
    </div>
  );
}
