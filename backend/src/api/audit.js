'use strict';

const { query } = require('./db');

/**
 * Append a governance/admin event to the audit trail.
 * Never throws: audit failures must not break the primary request.
 */
async function logAudit({ actorId, entityType, entityId, action, detail, ip }) {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, entity_type, entity_id, action, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actorId || null,
        entityType,
        entityId || null,
        action,
        detail === undefined || detail === null ? null : JSON.stringify(detail),
        ip || null,
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] log failed:', err.message);
  }
}

/**
 * Return audit-log scope for a manager: the ids of every project they manage.
 * Admins get an empty array meaning "no project scoping" (see routes).
 */
async function managedProjectIds(userId) {
  const { rows } = await query(
    `SELECT project_id FROM project_managers WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.project_id);
}

module.exports = { logAudit, managedProjectIds };
