'use client';

import React, { useState } from 'react';
import { FormulaIcon, ChevronIcon } from './icons';
import { SNIPPETS } from '@/lib/formulaSnippets';

interface HelperSnippet {
  title: string;
  code: string;
  description: string;
}

export function FormulaHelper({ onInsert }: { onInsert: (code: string) => void }) {
  const [open, setOpen] = useState(true);

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
        <span className="formula-helper-count">{SNIPPETS.length} snippets</span>
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
            {SNIPPETS.map((s: HelperSnippet) => (
              <button
                key={s.title}
                type="button"
                className="formula-helper-item"
                data-testid="formula-helper-item"
                title={s.description}
                onClick={() => onInsert(s.code)}
              >
                <span className="formula-helper-name">{s.title}</span>
                <code className="formula-helper-code">{s.code}</code>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
