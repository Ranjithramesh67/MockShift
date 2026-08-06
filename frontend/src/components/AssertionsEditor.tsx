'use client';

import React from 'react';
import type { Assertion, AssertionOperator, AssertionType } from '@/lib/types';
import { makeId } from '@/store/AppStore';
import { PlusIcon, XIcon, InfoIcon } from './icons';

export const ASSERTION_TYPES: Array<{ id: AssertionType; label: string }> = [
  { id: 'status', label: 'Status code' },
  { id: 'jsonPath', label: 'Body (JSON path)' },
  { id: 'header', label: 'Header' },
  { id: 'responseTime', label: 'Response time' },
];

export const ASSERTION_OPERATORS: Array<{ id: AssertionOperator; label: string }> = [
  { id: 'eq', label: 'equals' },
  { id: 'neq', label: 'not equals' },
  { id: 'contains', label: 'contains' },
  { id: 'gt', label: 'greater than' },
  { id: 'lt', label: 'less than' },
];

export function blankAssertion(): Assertion {
  return { id: makeId('asrt'), type: 'status', operator: 'eq', path: '', expected: '200' };
}

interface AssertionsEditorProps {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
}

export function AssertionsEditor({ assertions, onChange }: AssertionsEditorProps) {
  const update = (index: number, patch: Partial<Assertion>) => {
    onChange(assertions.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const remove = (index: number) => {
    onChange(assertions.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...assertions, blankAssertion()]);
  };

  const needsPath = (type: AssertionType) => type === 'jsonPath' || type === 'header';

  return (
    <div className="assertions-editor" data-testid="assertions-editor">
      <div className="assertions-help">
        <InfoIcon size={13} />
        Assertions run after each request. Failed assertions mark the run as failed in the response
        pane and in collection runs.
      </div>
      {assertions.length === 0 && <p className="hint">No assertions yet. Add one to validate the response.</p>}
      <div className="assertions-list">
        {assertions.map((a, index) => (
          <div className="assertion-row" key={a.id} data-testid={`assertion-row-${index}`}>
            <select
              className="compact-select"
              aria-label="Assertion type"
              data-testid={`assertion-type-${index}`}
              value={a.type}
              onChange={(e) => update(index, { type: e.target.value as AssertionType })}
            >
              {ASSERTION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              className="compact-select"
              aria-label="Assertion operator"
              data-testid={`assertion-operator-${index}`}
              value={a.operator}
              onChange={(e) => update(index, { operator: e.target.value as AssertionOperator })}
            >
              {ASSERTION_OPERATORS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {needsPath(a.type) && (
              <input
                className="text-input assertion-path"
                type="text"
                value={a.path ?? ''}
                placeholder={a.type === 'jsonPath' ? 'e.g. data.items.0.id' : 'e.g. content-type'}
                spellCheck={false}
                aria-label="Assertion path"
                data-testid={`assertion-path-${index}`}
                onChange={(e) => update(index, { path: e.target.value })}
              />
            )}
            <input
              className="text-input assertion-expected"
              type="text"
              value={a.expected ?? ''}
              placeholder="e.g. 200"
              spellCheck={false}
              aria-label="Assertion expected value"
              data-testid={`assertion-expected-${index}`}
              onChange={(e) => update(index, { expected: e.target.value })}
            />
            <button
              type="button"
              className="icon-button danger"
              aria-label="Remove assertion"
              title="Remove assertion"
              data-testid={`assertion-remove-${index}`}
              onClick={() => remove(index)}
            >
              <XIcon size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="ghost-button small"
        data-testid="assertion-add"
        onClick={add}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
      >
        <PlusIcon size={12} />
        Add assertion
      </button>
    </div>
  );
}
