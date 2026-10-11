'use client';

import React from 'react';
import type { KeyValueEntry } from '@/lib/types';
import { XIcon, PlusIcon } from './icons';

interface KeyValueRowsProps {
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  testIdPrefix: string;
}

export function KeyValueRows({
  entries,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  testIdPrefix,
}: KeyValueRowsProps) {
  const update = (index: number, patch: Partial<KeyValueEntry>) => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  const remove = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...entries, { key: '', value: '', enabled: true }]);
  };

  return (
    <div className="kv-rows" data-testid={`${testIdPrefix}-rows`}>
      <div className="kv-row kv-row-header">
        <span className="kv-check" />
        <span className="kv-cell">Key</span>
        <span className="kv-cell">Value</span>
        <span className="kv-actions" />
      </div>
      {entries.map((entry, index) => (
        <div className="kv-row" key={index} data-testid={`${testIdPrefix}-row-${index}`}>
          <label className="kv-check">
            <input
              type="checkbox"
              checked={entry.enabled}
              onChange={(e) => update(index, { enabled: e.target.checked })}
              aria-label="Enabled"
              title="Toggle entry"
            />
          </label>
          <input
            className="kv-cell"
            type="text"
            value={entry.key}
            placeholder={keyPlaceholder}
            spellCheck={false}
            aria-label="Key"
            onChange={(e) => update(index, { key: e.target.value })}
          />
          <input
            className="kv-cell"
            type="text"
            value={entry.value}
            placeholder={valuePlaceholder}
            spellCheck={false}
            aria-label="Value"
            onChange={(e) => update(index, { value: e.target.value })}
          />
          <div className="kv-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Remove row"
              title="Remove row"
              onClick={() => remove(index)}
            >
              <XIcon size={13} />
            </button>
          </div>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="ghost-button small"
          onClick={add}
          data-testid={`${testIdPrefix}-add`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <PlusIcon size={12} />
          Add row
        </button>
      </div>
    </div>
  );
}
