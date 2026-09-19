'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../CodeEditor';
import { CompareIcon, SaveIcon, TrashIcon } from '../icons';
import {
  jsonCompareApi,
  type JsonCompareArrayMode,
  type JsonCompareDirection,
  type JsonCompareKeyMode,
  type JsonComparison,
} from '@/lib/api';
import { parseJsonInput, compareParsed, preview } from '@/lib/jsonDiff';
import { formatSorted, normalizeSortOptions } from '@/lib/jsonSort';

const KEY_MODE_OPTIONS: Array<{ value: JsonCompareKeyMode; label: string }> = [
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'alphanum', label: 'Alphanumeric' },
  { value: 'original', label: 'Original order' },
];

const ARRAY_MODE_OPTIONS: Array<{ value: JsonCompareArrayMode; label: string }> = [
  { value: 'none', label: 'Keep array order' },
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'alphanum', label: 'Alphanumeric' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'length', label: 'By length' },
  { value: 'type', label: 'By type' },
  { value: 'json', label: 'Canonical JSON' },
];

const DIRECTION_OPTIONS: Array<{ value: JsonCompareDirection; label: string }> = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

function kindLabel(kind: string): string {
  if (kind === 'added') return 'Added';
  if (kind === 'removed') return 'Removed';
  if (kind === 'type') return 'Type';
  return 'Changed';
}

export function JsonCompareView() {
  const [leftText, setLeftText] = useState('{\n  "b": 2,\n  "a": 1\n}');
  const [rightText, setRightText] = useState('{\n  "a": 1,\n  "b": 2\n}');
  const [keyMode, setKeyMode] = useState<JsonCompareKeyMode>('alpha');
  const [keyDirection, setKeyDirection] = useState<JsonCompareDirection>('asc');
  const [arrayMode, setArrayMode] = useState<JsonCompareArrayMode>('none');
  const [arrayDirection, setArrayDirection] = useState<JsonCompareDirection>('asc');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saved, setSaved] = useState<JsonComparison[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnType<typeof compareParsed> | null>(null);

  const sortOptions = useMemo(
    () => normalizeSortOptions({ keyMode, keyDirection, arrayMode, arrayDirection }),
    [keyMode, keyDirection, arrayMode, arrayDirection]
  );

  const loadSaved = useCallback(async () => {
    try {
      const res = await jsonCompareApi.list();
      setSaved(res.comparisons);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved comparisons');
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  const runCompare = (leftRaw: string, rightRaw: string) => {
    setError('');
    setStatus('');
    const left = parseJsonInput(leftRaw);
    if (!left.ok) {
      setResult(null);
      setError(`Left JSON: ${left.error}`);
      return;
    }
    const right = parseJsonInput(rightRaw);
    if (!right.ok) {
      setResult(null);
      setError(`Right JSON: ${right.error}`);
      return;
    }
    const leftSorted = formatSorted(left.value, sortOptions);
    const rightSorted = formatSorted(right.value, sortOptions);
    setLeftText(leftSorted);
    setRightText(rightSorted);
    const compared = compareParsed(JSON.parse(leftSorted), JSON.parse(rightSorted));
    setResult(compared);
    setStatus(compared.equal ? 'Payloads match after sorting.' : `${compared.summary.total} difference${compared.summary.total === 1 ? '' : 's'} found.`);
  };

  const payload = () => ({
    name: saveName.trim(),
    leftText,
    rightText,
    keyMode,
    keyDirection,
    arrayMode,
    arrayDirection,
  });

  const onSave = async () => {
    const name = saveName.trim();
    if (!name) {
      setError('Enter a name to save this comparison.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (activeId) {
        const res = await jsonCompareApi.update(activeId, payload());
        setSaved((rows) => rows.map((row) => (row.id === activeId ? res.comparison : row)));
        setStatus(`Updated "${res.comparison.name}".`);
      } else {
        const res = await jsonCompareApi.create(payload());
        setSaved((rows) => [res.comparison, ...rows]);
        setActiveId(res.comparison.id);
        setStatus(`Saved "${res.comparison.name}".`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save comparison');
    } finally {
      setBusy(false);
    }
  };

  const onLoad = (row: JsonComparison) => {
    setActiveId(row.id);
    setSaveName(row.name);
    setLeftText(row.leftText);
    setRightText(row.rightText);
    setKeyMode(row.keyMode);
    setKeyDirection(row.keyDirection);
    setArrayMode(row.arrayMode);
    setArrayDirection(row.arrayDirection);
    setResult(null);
    setError('');
    setStatus(`Loaded "${row.name}".`);
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await jsonCompareApi.remove(id);
      setSaved((rows) => rows.filter((row) => row.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setSaveName('');
      }
      setStatus('Deleted saved comparison.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete comparison');
    } finally {
      setBusy(false);
    }
  };

  const onNew = () => {
    setActiveId(null);
    setSaveName('');
    setResult(null);
    setError('');
    setStatus('Started a new comparison.');
  };

  return (
    <main className="admin-main json-compare" data-testid="json-compare-page">
      <div className="admin-title-row">
        <div>
          <h1>JSON compare</h1>
          <p className="admin-subtitle">
            Sort two payloads, then diff them. Save a named snapshot when you want to keep the pair.
          </p>
        </div>
        <div className="admin-header-actions">
          <button type="button" className="ghost-button" data-testid="json-compare-new" onClick={onNew}>
            New
          </button>
          <button
            type="button"
            className="primary-button"
            data-testid="json-compare-run"
            onClick={() => runCompare(leftText, rightText)}
          >
            <CompareIcon size={14} />
            Compare
          </button>
        </div>
      </div>

      {error ? (
        <p className="auth-error" role="alert" data-testid="json-compare-error">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="hint" data-testid="json-compare-status">
          {status}
        </p>
      ) : null}

      <div className="json-compare-layout">
        <section className="json-compare-main">
          <div className="json-compare-toolbar">
            <label>
              Object keys
              <select
                className="compact-select"
                data-testid="json-compare-key-mode"
                value={keyMode}
                onChange={(e) => setKeyMode(e.target.value as JsonCompareKeyMode)}
              >
                {KEY_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Key order
              <select
                className="compact-select"
                data-testid="json-compare-key-direction"
                value={keyDirection}
                onChange={(e) => setKeyDirection(e.target.value as JsonCompareDirection)}
              >
                {DIRECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Arrays
              <select
                className="compact-select"
                data-testid="json-compare-array-mode"
                value={arrayMode}
                onChange={(e) => setArrayMode(e.target.value as JsonCompareArrayMode)}
              >
                {ARRAY_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Array order
              <select
                className="compact-select"
                data-testid="json-compare-array-direction"
                value={arrayDirection}
                onChange={(e) => setArrayDirection(e.target.value as JsonCompareDirection)}
              >
                {DIRECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="json-compare-editors">
            <div className="json-compare-pane">
              <div className="json-compare-pane-head">Left</div>
              <CodeEditor
                value={leftText}
                onChange={setLeftText}
                language="json"
                height="360px"
                ariaLabel="Left JSON payload"
              />
            </div>
            <div className="json-compare-pane">
              <div className="json-compare-pane-head">Right</div>
              <CodeEditor
                value={rightText}
                onChange={setRightText}
                language="json"
                height="360px"
                ariaLabel="Right JSON payload"
              />
            </div>
          </div>

          <div className="json-compare-save">
            <label htmlFor="json-compare-name">Save as</label>
            <input
              id="json-compare-name"
              className="text-input"
              data-testid="json-compare-name"
              placeholder="Checkout vs staging"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <button type="button" className="ghost-button" data-testid="json-compare-save" onClick={onSave} disabled={busy}>
              <SaveIcon size={14} />
              {activeId ? 'Update' : 'Save'}
            </button>
          </div>

          {result ? (
            <div className="json-compare-result" data-testid="json-compare-result">
              <div className="json-compare-summary">
                <span data-testid="json-compare-equal">{result.equal ? 'Match' : 'Different'}</span>
                <span>added {result.summary.added}</span>
                <span>removed {result.summary.removed}</span>
                <span>changed {result.summary.changed}</span>
                <span>type {result.summary.type}</span>
              </div>
              {result.changes.length === 0 ? (
                <p className="hint">No differences after the selected sort.</p>
              ) : (
                <ul className="json-compare-diff" data-testid="json-compare-diff">
                  {result.changes.map((change) => (
                    <li key={`${change.kind}:${change.path}`} className={`json-compare-diff-row is-${change.kind}`}>
                      <span className="json-compare-kind">{kindLabel(change.kind)}</span>
                      <code>{change.path}</code>
                      <span className="json-compare-values">
                        {change.kind !== 'added' ? <span>left {preview(change.left)}</span> : null}
                        {change.kind !== 'removed' ? <span>right {preview(change.right)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>

        <aside className="json-compare-saved" data-testid="json-compare-saved">
          <h2>Saved</h2>
          {saved.length === 0 ? (
            <p className="hint">No saved comparisons yet.</p>
          ) : (
            <ul>
              {saved.map((row) => (
                <li key={row.id} className={row.id === activeId ? 'is-active' : ''}>
                  <button
                    type="button"
                    className="json-compare-saved-item"
                    data-testid={`json-compare-saved-${row.name}`}
                    onClick={() => onLoad(row)}
                  >
                    <span>{row.name}</span>
                    <small>{new Date(row.updatedAt).toLocaleString()}</small>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete ${row.name}`}
                    data-testid={`json-compare-delete-${row.name}`}
                    onClick={() => onDelete(row.id)}
                    disabled={busy}
                  >
                    <TrashIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
