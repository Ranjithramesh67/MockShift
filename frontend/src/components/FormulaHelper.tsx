'use client';

import React from 'react';
import { FormulaIcon } from './icons';

interface HelperSnippet {
  title: string;
  code: string;
  description: string;
}

const SNIPPETS: HelperSnippet[] = [
  {
    title: 'Current timestamp',
    code: '$utils.now()',
    description: 'ISO-8601 timestamp, e.g. 2026-08-04T12:00:00.000Z',
  },
  {
    title: 'Random UUID',
    code: '$utils.uuid()',
    description: 'Generates a random v4-style UUID string',
  },
  {
    title: 'Random integer',
    code: '$utils.randomInt(1, 100)',
    description: 'Random integer between min and max, inclusive',
  },
  {
    title: 'Round a number',
    code: '$utils.round(3.14159, 2)',
    description: 'Rounds to the given number of decimal places',
  },
  {
    title: 'Date in 7 days',
    code: '$utils.addDays($utils.now(), 7)',
    description: 'Adds (or subtracts) days from an ISO timestamp',
  },
  {
    title: 'Read request body',
    code: 'req.body',
    description: 'Access or mutate the outgoing request body',
  },
  {
    title: 'Set a request header',
    code: 'req.headers.XTraceId = $utils.uuid()',
    description: 'Read or mutate outgoing request headers',
  },
  {
    title: 'Read variables',
    code: '$vars',
    description: 'Variables collected from earlier request responses',
  },
  {
    title: 'Compute a value',
    code: '({ total: req.body.qty * 12, stamp: $utils.now() })',
    description: 'Return value is merged into the request context',
  },
];

export function FormulaHelper({ onInsert }: { onInsert: (code: string) => void }) {
  return (
    <div className="formula-helper" data-testid="formula-helper">
      <div className="formula-helper-title">
        <FormulaIcon size={13} />
        Formula helpers
      </div>
      <p className="hint">
        Pre-request formulas run in a sandbox before the request is sent. Click a helper to insert it
        at the cursor; the final expression&apos;s value becomes <code>returned</code>.
      </p>
      <div className="formula-helper-grid">
        {SNIPPETS.map((s) => (
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
  );
}
