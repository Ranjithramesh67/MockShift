'use client';

import React, { useState } from 'react';
import type { CollectionRunOptions, CollectionRunResult } from '@/lib/api';
import { assertionCounts } from '@/lib/assertions';
import { buildReport, failedRequestIds, reportFilename, MIME } from '@/lib/collectionReport';
import { DEFAULT_RUN_OPTIONS, datasetSummary, parseDataset } from '@/lib/collectionRun';
import { CheckIcon, XIcon, PlayIcon, AlertIcon } from './icons';

type ReportFormat = 'json' | 'junit' | 'csv' | 'markdown' | 'html';

interface CollectionRunnerModalProps {
  open: boolean;
  running: boolean;
  /** The collection being run (enables re-run + export). */
  collectionId: string | null;
  collectionName: string;
  result: CollectionRunResult | null;
  onClose: () => void;
  /** Run the collection with the selected QA options. */
  onRun: (options: CollectionRunOptions) => void;
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CollectionRunnerModal({
  open,
  running,
  collectionId,
  collectionName,
  result,
  onClose,
  onRun,
}: CollectionRunnerModalProps) {
  const [stopOnError, setStopOnError] = useState(DEFAULT_RUN_OPTIONS.stopOnError);
  const [delayMs, setDelayMs] = useState(DEFAULT_RUN_OPTIONS.delayMs);
  const [retries, setRetries] = useState(DEFAULT_RUN_OPTIONS.retries);
  const [iterations, setIterations] = useState(DEFAULT_RUN_OPTIONS.iterations);
  const [dataText, setDataText] = useState('');
  const [dataError, setDataError] = useState<string | null>(null);

  if (!open) return null;

  const dataSummary = (() => {
    if (!dataText.trim()) return '';
    try {
      return datasetSummary(parseDataset(dataText));
    } catch {
      return '';
    }
  })();

  const run = () => {
    if (!collectionId) return;
    let data: Record<string, string>[] | undefined;
    if (dataText.trim()) {
      try {
        data = parseDataset(dataText);
      } catch (err) {
        setDataError(err instanceof Error ? err.message : 'Invalid data');
        return;
      }
    }
    setDataError(null);
    onRun({
      stopOnError,
      delayMs: Number(delayMs) || 0,
      retries: Number(retries) || 0,
      iterations: Number(iterations) || 1,
      ...(data ? { data } : {}),
    });
  };

  const failureCount = result ? failedRequestIds(result).length : 0;

  const rerunFailed = () => {
    if (!collectionId || !result) return;
    const ids = failedRequestIds(result);
    if (!ids.length) return;
    onRun({ requestIds: ids });
  };

  const exportReport = (format: ReportFormat) => {
    if (!result) return;
    downloadText(reportFilename(collectionName, format), buildReport(result, { format, collectionName }), MIME[format]);
  };

  return (
    <div className="modal-overlay" data-testid="collection-runner-modal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <PlayIcon size={14} /> Run collection
          </h2>
          <button type="button" className="icon-button" aria-label="Close" data-testid="collection-runner-close" onClick={onClose}>
            <XIcon size={14} />
          </button>
        </div>
        <div className="modal-body">
          <fieldset className="runner-options" data-testid="runner-options">
            <legend>Run options</legend>
            <label className="runner-option">
              <input
                type="checkbox"
                data-testid="runner-stop-on-error"
                checked={stopOnError}
                onChange={(e) => setStopOnError(e.target.checked)}
              />
              Stop on first failure
            </label>
            <label className="runner-option">
              Delay (ms)
              <input
                type="number"
                min={0}
                max={10000}
                step={50}
                data-testid="runner-delay"
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value) || 0)}
              />
            </label>
            <label className="runner-option">
              Retries
              <input
                type="number"
                min={0}
                max={5}
                data-testid="runner-retries"
                value={retries}
                onChange={(e) => setRetries(Number(e.target.value) || 0)}
              />
            </label>
            <label className="runner-option">
              Iterations
              <input
                type="number"
                min={1}
                max={50}
                data-testid="runner-iterations"
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value) || 1)}
              />
            </label>
          </fieldset>

          <div className="runner-data">
            <label htmlFor="runner-data-input">Data (CSV with a header row, or a JSON array of objects)</label>
            <textarea
              id="runner-data-input"
              data-testid="runner-data"
              rows={3}
              placeholder={'email,password\na@b.io,secret1\nc@d.io,secret2'}
              value={dataText}
              onChange={(e) => {
                setDataText(e.target.value);
                setDataError(null);
              }}
            />
            <div className="runner-data-meta">
              {dataSummary && <span data-testid="runner-data-summary">{dataSummary}</span>}
              <span className="hint">Each row runs the whole collection once; reference values with {'{{data.email}}'}.</span>
            </div>
            {dataError && (
              <p className="form-error" data-testid="runner-data-error">
                {dataError}
              </p>
            )}
          </div>

          <div className="runner-actions">
            <button
              type="button"
              className="primary-button"
              data-testid="runner-run"
              disabled={running || !collectionId}
              onClick={run}
            >
              <PlayIcon size={13} /> Run again
            </button>
            {failureCount > 0 && (
              <button
                type="button"
                className="ghost-button"
                data-testid="runner-rerun-failed"
                disabled={running}
                onClick={rerunFailed}
              >
                Re-run failed ({failureCount})
              </button>
            )}
          </div>

          {running && (
            <p className="hint" data-testid="collection-runner-running">
              <span className="spinner" /> Running {collectionName}…
            </p>
          )}
          {!running && !result && <p className="hint">No run started yet.</p>}
          {!running && result && (
            <>
              <div className="collection-run-summary" data-testid="collection-run-summary">
                <span>
                  Requests: <strong>{result.summary.total}</strong>
                </span>
                <span className="run-count-ok">
                  Passed: <strong>{result.summary.passed}</strong>
                </span>
                <span className="run-count-fail">
                  Failed: <strong>{result.summary.failed}</strong>
                </span>
                <span>
                  Assertions: <strong>
                    {result.summary.assertionsPassed}/{result.summary.assertionsTotal}
                  </strong>
                </span>
                {result.summary.stoppedEarly && (
                  <span className="run-count-fail" data-testid="collection-run-stopped">
                    stopped early
                  </span>
                )}
              </div>
              <div className="runner-exports" data-testid="runner-exports">
                <span className="hint">Export:</span>
                <button type="button" className="ghost-button" data-testid="runner-export-json" onClick={() => exportReport('json')}>
                  JSON
                </button>
                <button type="button" className="ghost-button" data-testid="runner-export-junit" onClick={() => exportReport('junit')}>
                  JUnit
                </button>
                <button type="button" className="ghost-button" data-testid="runner-export-html" onClick={() => exportReport('html')}>
                  HTML
                </button>
                <button type="button" className="ghost-button" data-testid="runner-export-csv" onClick={() => exportReport('csv')}>
                  CSV
                </button>
                <button type="button" className="ghost-button" data-testid="runner-export-markdown" onClick={() => exportReport('markdown')}>
                  Markdown
                </button>
              </div>
              <ul className="collection-run-list" data-testid="collection-run-list">
                {result.results.map((r, i) => {
                  const counts = assertionCounts(r.assertions);
                  const ok = r.runStatus === 'SUCCESS' && counts.failed === 0;
                  return (
                    <li
                      key={`${r.requestId}-${r.iteration ?? 0}-${i}`}
                      className={`collection-run-row ${ok ? 'run-row-ok' : 'run-row-fail'}`}
                      data-testid={`collection-run-${r.name}`}
                    >
                      <span className="collection-run-status">
                        {ok ? <CheckIcon size={14} /> : <XIcon size={14} />}
                      </span>
                      <span className="collection-run-name">
                        {r.name}
                        {r.iteration && r.iteration > 1 ? ` #${r.iteration}` : ''}
                      </span>
                      <span className={`status-chip ${r.httpStatus >= 400 ? 'status-err' : 'status-ok'}`}>
                        {r.httpStatus > 0 ? r.httpStatus : 'ERR'}
                      </span>
                      {r.durationMs != null && <span className="collection-run-time">{r.durationMs}ms</span>}
                      {r.assertions.length > 0 && (
                        <span
                          className={`collection-run-assertions ${counts.failed === 0 ? 'text-ok' : 'text-fail'}`}
                          title={r.assertions.map((a) => a.message).join('\n')}
                        >
                          {counts.passed}/{counts.total} assertions
                        </span>
                      )}
                      {r.error && (
                        <span className="collection-run-error">
                          <AlertIcon size={12} /> {r.error}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" data-testid="collection-runner-done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
