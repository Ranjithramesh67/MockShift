'use strict';

// ---------------------------------------------------------------------------
// Run-history retention + purge (S3).
//
// Each workspace has a `run_history_retention_days` setting (default 90, min 7).
// The purge job nulls the request/response SNAPSHOT payloads on runs older than
// the retention window but KEEPS the aggregate run row (timestamp, user,
// request, status, duration, assertion results in test_results), so trend and
// audit data survives. Deletes are batched so a large workspace never locks the
// table; every purge writes an audit_logs entry per affected workspace.
//
// Note: a run whose parent request/workflow has been deleted loses its
// workspace linkage (run_history keeps NULL request/workflow ids), so it can no
// longer be attributed to a workspace and is intentionally left untouched.
// ---------------------------------------------------------------------------

const { query } = require('./db');
const { logAudit } = require('./audit');

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 7;
const PURGE_BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

// Pure: cut-off instant for a retention window. Anything started strictly
// before `cutoff` is expired.
function computeCutoff(days, now = Date.now()) {
  return new Date(now - days * DAY_MS);
}

async function getRetentionDays(workspaceId) {
  const { rows } = await query(
    `SELECT run_history_retention_days FROM workspace_settings WHERE workspace_id = $1`,
    [workspaceId]
  );
  return rows[0]?.run_history_retention_days ?? DEFAULT_RETENTION_DAYS;
}

// Workspaces that currently own at least one run_history row.
async function listWorkspacesWithRuns() {
  const { rows } = await query(
    `SELECT DISTINCT p.workspace_id AS id
       FROM run_history rh
       LEFT JOIN api_requests ar ON ar.id = rh.request_id
       LEFT JOIN collections c ON c.id = ar.collection_id
       LEFT JOIN projects p ON p.id = c.project_id
      WHERE p.workspace_id IS NOT NULL
     UNION
     SELECT DISTINCT p.workspace_id AS id
       FROM run_history rh
       LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
       LEFT JOIN projects p ON p.id = wc.project_id
      WHERE p.workspace_id IS NOT NULL`
  );
  return rows.map((r) => r.id);
}

// Null the snapshot payloads of up to `PURGE_BATCH_SIZE` expired runs in one
// workspace. Returns the number of rows changed in this batch.
async function purgeBatch(workspaceId, cutoff) {
  const { rows: target } = await query(
    `SELECT rh.id
       FROM run_history rh
      WHERE rh.started_at < $2
        AND (rh.request_snapshot IS NOT NULL OR rh.response_snapshot IS NOT NULL)
        AND (
          EXISTS (SELECT 1 FROM api_requests ar
                   JOIN collections c ON c.id = ar.collection_id
                   JOIN projects p ON p.id = c.project_id
                  WHERE ar.id = rh.request_id AND p.workspace_id = $1)
          OR
          EXISTS (SELECT 1 FROM workflow_chains wc
                   JOIN projects p ON p.id = wc.project_id
                  WHERE wc.id = rh.workflow_id AND p.workspace_id = $1)
        )
      LIMIT $3`,
    [workspaceId, cutoff.toISOString(), PURGE_BATCH_SIZE]
  );
  if (target.length === 0) return 0;
  const ids = target.map((r) => r.id);
  const { rowCount } = await query(
    `UPDATE run_history
        SET request_snapshot = NULL, response_snapshot = NULL
      WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return rowCount || 0;
}

/**
 * Run the retention purge across every workspace. Idempotent and safe to call
 * repeatedly: runs inside their window (or already purged) are skipped.
 *
 * @returns {Promise<{purgedWorkspaces: number, rowsAffected: number,
 *   detail: Array<{workspaceId: string, rowsAffected: number, cutoff: string}>}>}
 */
async function purgeExpiredRuns() {
  const workspaceIds = await listWorkspacesWithRuns();
  const detail = [];
  let rowsAffectedTotal = 0;

  for (const workspaceId of workspaceIds) {
    const days = await getRetentionDays(workspaceId);
    const cutoff = computeCutoff(days);

    let rows = await purgeBatch(workspaceId, cutoff);
    let workspaceTotal = 0;
    while (rows > 0) {
      workspaceTotal += rows;
      rows = await purgeBatch(workspaceId, cutoff);
    }
    if (workspaceTotal > 0) {
      rowsAffectedTotal += workspaceTotal;
      detail.push({ workspaceId, rowsAffected: workspaceTotal, cutoff: cutoff.toISOString() });
      await logAudit({
        actorId: null,
        entityType: 'workspace',
        entityId: workspaceId,
        action: 'run_history_purge',
        detail: { rowsAffected: workspaceTotal, cutoff: cutoff.toISOString() },
      });
    }
  }

  return { purgedWorkspaces: detail.length, rowsAffected: rowsAffectedTotal, detail };
}

// ------------------------------------------------------------ Scheduler
let schedulerTimer = null;
let schedulerRunning = false;

/**
 * Start a background interval that runs the purge. First tick fires after a
 * short boot delay; subsequent ticks every `intervalMs` (default 15 min, env
 * `RETENTION_PURGE_INTERVAL_MS`). Overlapping ticks are skipped. Safe to call
 * more than once (idempotent).
 */
function startRetentionScheduler({
  intervalMs = Number(process.env.RETENTION_PURGE_INTERVAL_MS || 15 * 60 * 1000),
  bootDelayMs = 5000,
} = {}) {
  if (schedulerTimer) return schedulerTimer;
  const tick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const result = await purgeExpiredRuns();
      if (result.rowsAffected > 0) {
        // eslint-disable-next-line no-console
        console.log(`[retention] purged ${result.rowsAffected} run snapshot(s) across ${result.purgedWorkspaces} workspace(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[retention] purge failed:', err.message);
    } finally {
      schedulerRunning = false;
    }
  };
  setTimeout(tick, bootDelayMs);
  schedulerTimer = setInterval(tick, intervalMs);
  schedulerTimer.unref?.();
  return schedulerTimer;
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  PURGE_BATCH_SIZE,
  computeCutoff,
  getRetentionDays,
  purgeExpiredRuns,
  startRetentionScheduler,
};
