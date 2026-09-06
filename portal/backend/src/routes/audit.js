'use strict';

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');

const router = Router();

// Portal B — audit trail reads. List is SUPPORT+, export is ADMIN only
// (see endpoint matrix in portalAccess.js). Mounted under /api/audit.

const AUDIT_COLUMNS = `id, actor_user_id, actor_name, actor_role, action,
  target_type, target_id, target_ref, before, after, ip_address, created_at`;

const CSV_HEADER =
  'id,actor_user_id,actor_name,actor_role,action,target_type,target_id,target_ref,before,after,ip_address,created_at';

const MAX_EXPORT_ROWS = 10000;

function qstr(value) {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

// Shared filter builder → SQL WHERE fragment + params. `actor` is an ILIKE
// substring on actor_name; action/targetType are exact; from/to clamp
// created_at. Unused or empty filters are dropped.
function buildFilters(q) {
  const conds = [];
  const params = [];

  const action = String(qstr(q.action) ?? '').trim();
  const actor = String(qstr(q.actor) ?? '').trim();
  const targetType = String(qstr(q.targetType) ?? '').trim();
  const from = String(qstr(q.from) ?? '').trim();
  const to = String(qstr(q.to) ?? '').trim();

  if (action) {
    params.push(action);
    conds.push(`action = $${params.length}`);
  }
  if (actor) {
    params.push(`%${actor}%`);
    conds.push(`actor_name ILIKE $${params.length}`);
  }
  if (targetType) {
    params.push(targetType);
    conds.push(`target_type = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conds.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    conds.push(`created_at <= $${params.length}::timestamptz`);
  }

  return { clause: conds.length ? ` WHERE ${conds.join(' AND ')}` : '', params };
}

function hasInvalidDateFilter(q) {
  for (const key of ['from', 'to']) {
    const v = String(qstr(q[key]) ?? '').trim();
    if (v && Number.isNaN(Date.parse(v))) return true;
  }
  return false;
}

/**
 * CSV-escape a single field. A field is double-quoted only when it contains a
 * comma, a quote, or a newline; embedded quotes are doubled. Objects/arrays
 * are serialized to JSON text first (control chars end up escaped, so no raw
 * newlines leak into a row). Null/undefined become the empty field.
 */
function csvField(value) {
  let s = '';
  if (value === null || value === undefined) {
    s = '';
  } else if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fileStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

router.use(access.requireAuth);
router.use(requirePortalRole('SUPPORT'));

// GET /api/audit — paginated, filterable list (SUPPORT+).
router.get('/', async (req, res, next) => {
  try {
    if (hasInvalidDateFilter(req.query)) {
      return res.status(400).json({ error: 'from/to must be valid ISO datetimes' });
    }
    const page = Math.max(1, parseInt(String(qstr(req.query.page) ?? ''), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(qstr(req.query.pageSize) ?? ''), 10) || 20)
    );
    const { clause, params } = buildFilters(req.query);

    const { rows: countRows } = await query(
      `SELECT count(*)::int AS total FROM audit_log${clause}`,
      params,
      { userId: req.user.id }
    );
    const { rows } = await query(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log${clause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
      { userId: req.user.id }
    );
    res.json({ total: countRows[0].total, page, pageSize, items: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/export — CSV export (ADMIN only), same filters, no paging.
router.get('/export', requirePortalRole('ADMIN'), async (req, res, next) => {
  try {
    if (hasInvalidDateFilter(req.query)) {
      return res.status(400).json({ error: 'from/to must be valid ISO datetimes' });
    }
    const { clause, params } = buildFilters(req.query);
    const { rows } = await query(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log${clause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1}`,
      [...params, MAX_EXPORT_ROWS],
      { userId: req.user.id }
    );

    const lines = rows.map((row) =>
      [
        row.id,
        row.actor_user_id,
        row.actor_name,
        row.actor_role,
        row.action,
        row.target_type,
        row.target_id,
        row.target_ref,
        row.before,
        row.after,
        row.ip_address,
        row.created_at,
      ]
        .map(csvField)
        .join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${fileStamp()}.csv"`
    );
    // Buffer body so Express does not append `; charset=utf-8`.
    res.send(Buffer.from(`${CSV_HEADER}\n${lines.join('\n')}\n`, 'utf8'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
