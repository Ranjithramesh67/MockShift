'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');
const { redactSnapshot, redactUrl, DEFAULT_MARKER } = require('../redact');

const router = Router();
router.use(requireAuth);

// ------------------------------------------------------------------ Own runs
// Privacy rule: every user only ever sees THEIR OWN runs. There is deliberately
// no admin/team bypass here — team-wide run history lives in the Manage view.
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await query(
      `SELECT rh.id, rh.trigger, rh.status, rh.started_at, rh.finished_at,
              rh.request_id, rh.workflow_id,
              round(EXTRACT(EPOCH FROM (rh.finished_at - rh.started_at)) * 1000)::int AS duration_ms,
              COALESCE(ar.name, wc.name, '(deleted)') AS name,
              rh.request_snapshot->>'method' AS method,
              rh.request_snapshot->>'url' AS url
         FROM run_history rh
         LEFT JOIN api_requests ar ON ar.id = rh.request_id
         LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
        WHERE rh.user_id = $1
        ORDER BY rh.started_at DESC
        LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({
      runs: rows.map((r) => ({ ...r, url: redactUrl(r.url, [], [], DEFAULT_MARKER) })),
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------- Run detail (own)
router.get('/:runId', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const { rows } = await query(
      `SELECT rh.id, rh.trigger, rh.status, rh.started_at, rh.finished_at,
              rh.request_id, rh.workflow_id, rh.request_snapshot, rh.response_snapshot,
              COALESCE(ar.name, wc.name, '(deleted)') AS name
         FROM run_history rh
         LEFT JOIN api_requests ar ON ar.id = rh.request_id
         LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
        WHERE rh.id = $1 AND rh.user_id = $2`,
      [runId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Run not found' });
    const run = rows[0];
    const { rows: tests } = await query(
      `SELECT test_name, passed, assertions, error
         FROM test_results WHERE run_id = $1 ORDER BY test_name`,
      [runId]
    );
    res.json({
      run: {
        id: run.id,
        name: run.name,
        trigger: run.trigger,
        status: run.status,
        started_at: run.started_at,
        finished_at: run.finished_at,
        request_id: run.request_id,
        workflow_id: run.workflow_id,
        request_snapshot: run.request_snapshot ? redactSnapshot(run.request_snapshot, {}) : null,
        response_snapshot: run.response_snapshot ? redactSnapshot(run.response_snapshot, {}) : null,
        test_results: tests,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
