'use client';

import React from 'react';
import { type MockCallLog } from '@/lib/mockScenariosApi';
import { formatTimestamp, prettyJson, type MockServerAdmin } from './useMockServerAdmin';
import styles from './mocks.module.css';

function CallLogDetail({ log }: { log: MockCallLog }) {
  const query = log.query && Object.keys(log.query).length > 0 ? prettyJson(log.query) : '';
  const reqHeaders =
    log.request_headers && Object.keys(log.request_headers).length > 0
      ? prettyJson(log.request_headers)
      : '';
  const resHeaders =
    log.response_headers && Object.keys(log.response_headers).length > 0
      ? prettyJson(log.response_headers)
      : '';
  const scenarioLabel = log.scenario_name ? ` · scenario ${log.scenario_name}` : '';
  return (
    <div className={styles.logDetail} data-testid="mock-call-log-detail">
      <div className={styles.logMeta}>
        <span>Triggered {formatTimestamp(log.created_at)}</span>
        <span>{log.duration_ms} ms</span>
        <span>status {log.status ?? '-'}</span>
        <span>
          source {log.source}
          {scenarioLabel}
        </span>
        <span>route {log.matched_route_path || '-'}</span>
        {log.replayed_from ? <span>replay of {log.replayed_from}</span> : null}
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Request query</span>
        <pre className={styles.pre}>{query || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Request headers</span>
        <pre className={styles.pre}>{reqHeaders || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Request body</span>
        <pre className={styles.pre}>{log.request_body || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Response headers</span>
        <pre className={styles.pre}>{resHeaders || '-'}</pre>
      </div>
      <div className={styles.logDetailSection}>
        <span className={styles.logDetailLabel}>Response body</span>
        <pre className={styles.pre}>{log.response_body || '-'}</pre>
      </div>
    </div>
  );
}

function sourceBadgeClass(source: string): string {
  if (source === 'scenario') return `${styles.badge} ${styles.badgeScenario}`;
  if (source === 'static') return `${styles.badge} ${styles.badgeStatic}`;
  return `${styles.badge} ${styles.badgeUnmatched}`;
}

export function MockCallLogTab({ admin }: { admin: MockServerAdmin }) {
  const { logs, busy, loading, replay, expandedLogId, setExpandedLogId } = admin;

  return (
    <section className={styles.section} data-testid="mock-call-log-tab">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Call log (recent requests)</h2>
        <div className={styles.actions}>
          <span className={styles.sectionHint}>
            Every request the mock served, newest first. Expand a row to see the full request and
            response.
          </span>
          <span className={styles.sectionHint}>{logs.length} captured</span>
          <button
            className={styles.btn}
            type="button"
            onClick={() => admin.load()}
            disabled={loading || busy}
          >
            Refresh
          </button>
          <button
            className={`${styles.btn} ${styles.btnDanger}`}
            type="button"
            onClick={admin.clearLogs}
            disabled={busy || logs.length === 0}
          >
            Clear log
          </button>
        </div>
      </div>
      {logs.length === 0 ? (
        <p className={styles.empty}>No calls captured yet. Hit the mock URL to record one.</p>
      ) : (
        <div className={styles.logTable}>
          {logs.map((log) => (
            <div key={log.id} className={styles.logEntry}>
              <div className={styles.logRow}>
                <span className={styles.logTime}>
                  {new Date(log.created_at).toLocaleTimeString()}
                </span>
                <span className={styles.logMethod}>{log.method}</span>
                <span className={styles.logPath} title={log.path}>
                  {log.path}
                </span>
                <span className={styles.badgeStatus}>{log.status ?? '-'}</span>
                <span className={sourceBadgeClass(log.source)}>
                  {log.source === 'scenario' && log.scenario_name
                    ? `scenario:${log.scenario_name}`
                    : log.source}
                </span>
                <span className={`${styles.itemMeta} ${styles.logScenario}`}>
                  {log.matched_route_path || '-'}
                </span>
                <span className={styles.logAction}>
                  <button
                    className={styles.btn}
                    type="button"
                    onClick={() =>
                      setExpandedLogId((current) => (current === log.id ? null : log.id))
                    }
                  >
                    {expandedLogId === log.id ? 'Hide' : 'Details'}
                  </button>
                  <button
                    className={styles.btn}
                    type="button"
                    onClick={() => admin.replayCall(log.id)}
                    disabled={busy}
                  >
                    Replay
                  </button>
                </span>
              </div>
              {expandedLogId === log.id ? <CallLogDetail log={log} /> : null}
            </div>
          ))}
        </div>
      )}
      {replay ? (
        <pre className={styles.pre}>{`HTTP ${replay.status}\n${replay.body}`}</pre>
      ) : null}
    </section>
  );
}
