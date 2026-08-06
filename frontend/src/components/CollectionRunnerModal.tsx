'use client';

import React from 'react';
import type { CollectionRunResult } from '@/lib/api';
import { assertionCounts } from '@/lib/assertions';
import { CheckIcon, XIcon, PlayIcon, AlertIcon } from './icons';

interface CollectionRunnerModalProps {
  open: boolean;
  running: boolean;
  collectionName: string;
  result: CollectionRunResult | null;
  onClose: () => void;
}

export function CollectionRunnerModal({
  open,
  running,
  collectionName,
  result,
  onClose,
}: CollectionRunnerModalProps) {
  if (!open) return null;
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
              </div>
              <ul className="collection-run-list" data-testid="collection-run-list">
                {result.results.map((r) => {
                  const counts = assertionCounts(r.assertions);
                  return (
                    <li
                      key={r.requestId}
                      className={`collection-run-row ${r.runStatus === 'SUCCESS' ? 'run-row-ok' : 'run-row-fail'}`}
                      data-testid={`collection-run-${r.name}`}
                    >
                      <span className="collection-run-status">
                        {r.runStatus === 'SUCCESS' ? <CheckIcon size={14} /> : <XIcon size={14} />}
                      </span>
                      <span className="collection-run-name">{r.name}</span>
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
