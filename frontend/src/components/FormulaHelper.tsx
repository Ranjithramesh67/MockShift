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
    title: 'Date in 2 hours',
    code: '$utils.addHours($utils.now(), 2)',
    description: 'Adds (or subtracts) hours from an ISO timestamp',
  },
  {
    title: 'Date in 30 minutes',
    code: '$utils.addMinutes($utils.now(), 30)',
    description: 'Adds (or subtracts) minutes from an ISO timestamp',
  },
  {
    title: 'Date in 3 months',
    code: '$utils.addMonths($utils.now(), 3)',
    description: 'Adds (or subtracts) months, clamping to the end of month',
  },
  {
    title: 'Epoch milliseconds',
    code: '$utils.timestamp()',
    description: 'Current Unix time in milliseconds since the epoch',
  },
  {
    title: 'Capitalize a string',
    code: '$utils.capitalize("hello world")',
    description: 'Uppercases the first character of the string',
  },
  {
    title: 'Lowercase a string',
    code: '$utils.lower("HeLLo")',
    description: 'Converts the string to lowercase',
  },
  {
    title: 'Uppercase a string',
    code: '$utils.upper("HeLLo")',
    description: 'Converts the string to uppercase',
  },
  {
    title: 'Trim whitespace',
    code: '$utils.trim("  spaced  ")',
    description: 'Removes leading and trailing whitespace',
  },
  {
    title: 'Base64 encode',
    code: '$utils.base64Encode("text to encode")',
    description: 'Encodes a UTF-8 string to base64',
  },
  {
    title: 'Base64 decode',
    code: '$utils.base64Decode("dGV4dCB0byBlbmNvZGU=")',
    description: 'Decodes a base64 string back to UTF-8',
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
