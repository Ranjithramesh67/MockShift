'use strict';

// ---------------------------------------------------------------------------
// Per-plan usage entitlements (L1+ of the Portal B restrictions programme).
//
// Canonical limit keys (nullable value = unlimited):
//   workspaces, projects, collections, teams, seats (distinct people in the
//   org pool), storage_mb (reserved, NOT enforced), runs_per_month,
//   public_sharing (boolean; false blocks public exposure).
//
// Pool model (R1/R2 defaults):
//   - Usage is counted against an ORG pool. A pool org may carry a covering
//     plan = the newest non-terminal subscription (ACTIVE/TRIALING preferred,
//     else PAST_DUE/SUSPENDED, newest created_at first) held by any member of
//     that org. In practice a checkout buyer's own org contains exactly their
//     own subscription, so this is the same as "the plan-owning account's org
//     pool" while also making invited members create into the shared pool.
//   - When no pool org is given, resolveLimits picks the caller's primary org
//     (the org where they hold the highest role; stable id tiebreak).
//   - Plan-less accounts fall back to the Free plan (own personal org counts
//     against its own Free pool).
//
// Enforcement semantics (R3/R4/R7/R8):
//   - enforced = global portal_settings.restrictions_enforced AND the plan is
//     not exempt (enterprise/custom or limits.enforce === false). Every gate
//     short-circuits when enforced is false.
//   - 403 plan_limit { error, code, key, limit, usage, upgrade: true }.
//   - Only NEW creates are blocked; never edits/deletes (R4).
//   - Enterprise / custom plans are never limited (R8).
//
// Runs (R5): plan_usage holds calendar-month buckets per org. Runs are
// charged through chargeRuns() at the route choke points that invoke a stored
// request send, a collection runner invocation or a manual workflow run.
// ---------------------------------------------------------------------------

const { query, pool } = require('./db');

const CANONICAL_KEYS = [
  'workspaces',
  'projects',
  'collections',
  'teams',
  'seats',
  'storage_mb',
  'runs_per_month',
  'public_sharing',
];

const NON_TERMINAL = `s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'SUSPENDED')`;

// Free-plan fallback used only when the catalog has no PUBLISHED 'free' plan
// (mirrors migration 013 free row; collections/teams/runs default unlimited).
const FREE_FALLBACK_LIMITS = {
  workspaces: 1,
  projects: 1,
  collections: null,
  teams: null,
  seats: 1,
  storage_mb: 200,
  runs_per_month: null,
  public_sharing: false,
};

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Extract the canonical limit keys from a plans.limits jsonb object. Unknown
// / extra keys (sso, saml, enforce, …) are ignored here.
function canonicalLimits(planLimits, fallback = null) {
  const src = planLimits && typeof planLimits === 'object' ? planLimits : {};
  const out = {};
  for (const key of CANONICAL_KEYS) {
    if (key === 'public_sharing') {
      out.public_sharing = typeof src.public_sharing === 'boolean' ? src.public_sharing : fallback;
    } else {
      out[key] = num(src[key]) ?? (fallback ? fallback[key] : null);
    }
  }
  return out;
}

function defaultLimits() {
  const out = {};
  for (const key of CANONICAL_KEYS) {
    out[key] = FREE_FALLBACK_LIMITS[key] ?? null;
  }
  return out;
}

// The pool org a user "owns" / is resolved against when no explicit orgId is
// supplied: their highest-role membership, earliest-created org first. Neither
// organizations nor organization_members carry a created_at column, so the
// stable tiebreak is the org id.
async function primaryOrgFor(userId) {
  const { rows } = await query(
    `SELECT om.org_id
       FROM organization_members om
       JOIN organizations o ON o.id = om.org_id
      WHERE om.user_id = $1
      ORDER BY (om.role = 'ADMIN') DESC, (om.role = 'MANAGER') DESC,
               (om.role = 'EDITOR') DESC, om.org_id
      LIMIT 1`,
    [userId]
  );
  return rows[0]?.org_id || null;
}

// Covering plan of an org pool = newest non-terminal subscription held by any
// member of the org (see header). Returns { key, name, limits } or null.
async function coveringPlan(orgId) {
  const { rows } = await query(
    `SELECT p.key, p.name, p.limits
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id IN (SELECT user_id FROM organization_members WHERE org_id = $1)
        AND ${NON_TERMINAL}
      ORDER BY (s.status IN ('ACTIVE', 'TRIALING')) DESC, s.created_at DESC
      LIMIT 1`,
    [orgId]
  );
  return rows[0] || null;
}

async function freePlan() {
  const { rows } = await query(
    `SELECT key, name, limits FROM plans WHERE key = 'free' LIMIT 1`
  );
  return rows[0] || null;
}

// Global master switch (portal_settings single row, default true).
async function globalEnforcement() {
  const { rows } = await query(
    `SELECT restrictions_enforced FROM portal_settings ORDER BY id LIMIT 1`
  );
  if (rows.length === 0) return true;
  return rows[0].restrictions_enforced !== false;
}

/**
 * Resolve the effective entitlement for a user acting inside an org pool.
 *
 * @param {string|null} userId authenticated actor
 * @param {string|null} orgId  pool org (workspace/team/etc org). When null the
 *        user's primary org is used.
 * @returns {Promise<{
 *   enforced: boolean,
 *   limits: {workspaces,projects,collections,teams,seats,storage_mb,runs_per_month,public_sharing},
 *   planKey: string|null, planName: string|null, reason: string,
 *   poolOrgId: string|null, poolScope: 'org'|'none'
 * }>}
 */
async function resolveLimits(userId, orgId = null) {
  let poolOrgId = orgId || null;
  if (!poolOrgId) poolOrgId = await primaryOrgFor(userId || null);
  const poolScope = poolOrgId ? 'org' : 'none';

  const cover = poolOrgId ? await coveringPlan(poolOrgId) : null;

  let plan = cover;
  let reason = plan ? `org_plan_${plan.key}` : 'fallback_free';

  if (!plan) {
    const free = await freePlan();
    if (free) {
      plan = { key: free.key, name: free.name, limits: free.limits };
      reason = 'fallback_free';
    } else {
      plan = { key: 'free', name: 'Free', limits: defaultLimits() };
      reason = 'fallback_free_defaults';
    }
  }

  // R8 — enterprise / custom plans are never limited.
  if (plan.key === 'enterprise') {
    return {
      enforced: false,
      limits: canonicalLimits(plan.limits, null),
      planKey: plan.key,
      planName: plan.name,
      reason: 'enterprise_exempt',
      poolOrgId,
      poolScope,
    };
  }

  const rawEnforce = plan.limits && typeof plan.limits === 'object' ? plan.limits.enforce : undefined;
  const planOverrideOff = rawEnforce === false;

  if (planOverrideOff) {
    return {
      enforced: false,
      limits: canonicalLimits(plan.limits, null),
      planKey: plan.key,
      planName: plan.name,
      reason: 'plan_override_off',
      poolOrgId,
      poolScope,
    };
  }

  const globalOn = await globalEnforcement();
  if (!globalOn) {
    return {
      enforced: false,
      limits: canonicalLimits(plan.limits, null),
      planKey: plan.key,
      planName: plan.name,
      reason: 'global_toggle_off',
      poolOrgId,
      poolScope,
    };
  }

  return {
    enforced: true,
    limits: canonicalLimits(plan.limits, null),
    planKey: plan.key,
    planName: plan.name,
    reason: reason === 'fallback_free' || reason === 'fallback_free_defaults' ? reason : `org_plan_${plan.key}`,
    poolOrgId,
    poolScope,
  };
}

// Live usage counters for an org pool (single query). seats = distinct people
// with any access inside the org (org members + workspace/team/project members
// of the org's resources).
async function countPoolUsage(orgId) {
  if (!orgId) {
    return { workspaces: 0, projects: 0, collections: 0, teams: 0, seats: 0 };
  }
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM workspaces WHERE organization_id = $1) AS workspaces,
       (SELECT count(*)::int
          FROM projects p JOIN workspaces w ON w.id = p.workspace_id
         WHERE w.organization_id = $1) AS projects,
       (SELECT count(*)::int
          FROM collections c
          JOIN projects p ON p.id = c.project_id
          JOIN workspaces w ON w.id = p.workspace_id
         WHERE w.organization_id = $1) AS collections,
       (SELECT count(*)::int FROM teams WHERE organization_id = $1) AS teams,
       (SELECT count(DISTINCT uid)::int FROM (
          SELECT user_id AS uid FROM organization_members WHERE org_id = $1
          UNION ALL
          SELECT wm.user_id FROM workspace_members wm
            JOIN workspaces w ON w.id = wm.workspace_id AND w.organization_id = $1
          UNION ALL
          SELECT tm.user_id FROM team_members tm
            JOIN teams t ON t.id = tm.team_id AND t.organization_id = $1
          UNION ALL
          SELECT pm.user_id FROM project_members pm
            JOIN projects p ON p.id = pm.project_id
            JOIN workspaces w ON w.id = p.workspace_id AND w.organization_id = $1
        ) seat_ids) AS seats`,
    [orgId]
  );
  return rows[0] || { workspaces: 0, projects: 0, collections: 0, teams: 0, seats: 0 };
}

function monthBucket(now = new Date()) {
  return now.toISOString().slice(0, 7) + '-01';
}

// Current calendar-month run counter for an org (0 when none yet).
async function currentRunUsage(orgId, now = new Date()) {
  if (!orgId) return 0;
  const { rows } = await query(
    `SELECT runs FROM plan_usage WHERE org_id = $1 AND month = $2`,
    [orgId, monthBucket(now)]
  );
  return rows[0]?.runs ?? 0;
}

/**
 * Build a 403 `plan_limit` response body for a count-limit block.
 */
function planLimitBody({ key, limit, used, planKey, planName, label }) {
  const n = limit === null ? 'unlimited' : String(limit);
  const human =
    label || key.replace(/_/g, ' ');
  const message = planName
    ? `Plan limit reached: this plan allows ${n} ${human} and you have used ${used}. Upgrade to ${planName} for more.`
    : `Plan limit reached: this plan allows ${n} ${human} and you have used ${used}.`;
  return {
    error: message,
    code: 'plan_limit',
    key,
    label: human,
    limit,
    usage: used,
    upgrade: true,
    plan: planKey,
  };
}

/**
 * For a count resource (workspaces/projects/collections/teams): returns a 403
 * body when the org pool is at/over the (enforced) limit and creating `extra`
 * more would exceed it; else null.
 */
async function checkCountGate({ userId, orgId, key, extra = 1 }) {
  const en = await resolveLimits(userId, orgId);
  if (!en.enforced) return null;
  const limit = en.limits[key];
  if (limit === null || limit === undefined) return null;
  const usage = await countPoolUsage(orgId);
  const used = usage[key];
  if (used === undefined) return null;
  if (used + extra > limit) {
    return planLimitBody({ key, limit, used, planKey: en.planKey, planName: en.planName });
  }
  return null;
}

// Count usage for a workspace->org mapping when only an object's workspace is
// known (project/collection/share gates).
async function orgOfWorkspace(workspaceId) {
  if (!workspaceId) return null;
  const { rows } = await query(
    `SELECT organization_id FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  return rows[0]?.organization_id || null;
}

async function orgOfProject(projectId) {
  if (!projectId) return null;
  const { rows } = await query(
    `SELECT w.organization_id FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = $1`,
    [projectId]
  );
  return rows[0]?.organization_id || null;
}

async function orgOfCollection(collectionId) {
  if (!collectionId) return null;
  const { rows } = await query(
    `SELECT w.organization_id
       FROM collections c
       JOIN projects p ON p.id = c.project_id
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE c.id = $1`,
    [collectionId]
  );
  return rows[0]?.organization_id || null;
}

/**
 * Seats gate: returns a 403 body when `targetUserId` is a NEW distinct person
 * in the org pool and the org pool is already at/over its enforced seats
 * limit. Returning an existing member's upsert is always allowed (R4).
 */
async function checkSeatGate({ userId, orgId, targetUserId }) {
  if (!orgId || !targetUserId) return null;
  const en = await resolveLimits(userId, orgId);
  if (!en.enforced) return null;
  const limit = en.limits.seats;
  if (limit === null || limit === undefined) return null;
  const usage = await countPoolUsage(orgId);
  const used = usage.seats;
  const { rows } = await query(
    `SELECT 1 WHERE EXISTS (
       SELECT 1 FROM organization_members WHERE org_id = $1 AND user_id = $2
       UNION ALL
       SELECT 1 FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
         WHERE w.organization_id = $1 AND wm.user_id = $2
       UNION ALL
       SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
         WHERE t.organization_id = $1 AND tm.user_id = $2
       UNION ALL
       SELECT 1 FROM project_members pm
         JOIN projects p ON p.id = pm.project_id
         JOIN workspaces w ON w.id = p.workspace_id
        WHERE w.organization_id = $1 AND pm.user_id = $2
     ) LIMIT 1`,
    [orgId, targetUserId]
  );
  if (rows.length > 0) return null; // already seated → upsert/role change is fine
  if (used + 1 > limit) {
    return planLimitBody({ key: 'seats', limit, used, planKey: en.planKey, planName: en.planName });
  }
  return null;
}

/**
 * Public-sharing gate: returns a 403 body when enforced and the plan forbids
 * public sharing. Returns null when allowed (true / absent / not enforced).
 */
async function checkPublicSharingGate({ userId, orgId }) {
  const en = await resolveLimits(userId, orgId);
  if (!en.enforced) return null;
  if (en.limits.public_sharing === false) {
    return {
      error: `Your current plan does not allow public sharing. Upgrade to enable public workspaces and share links.`,
      code: 'plan_limit',
      key: 'public_sharing',
      label: 'public sharing',
      limit: false,
      usage: 1,
      upgrade: true,
      plan: en.planKey,
    };
  }
  return null;
}

/**
 * Runs budget — atomically reserve `n` runs in the current calendar-month
 * bucket of the org pool.
 *
 *  - Always counts (even when not enforced) so usage bars reflect real
 *    consumption and the toggle can be flipped on later.
 *  - When enforced and the bucket is at/over runs_per_month it ROLLS BACK and
 *    returns { ok:false, body } where `body` is the 403 plan_limit payload
 *    (uniform with the count/seat/share gates). Route handlers respond
 *    `res.status(403).json(charge.body)`.
 *
 * Returns { ok, used, limit, enforced } after a successful charge.
 */
async function chargeRuns({ userId, orgId, n = 1 }) {
  const bucket = monthBucket();
  if (!orgId) {
    // No pool org (e.g. an orphaned target) — nothing to meter against.
    return { ok: true, used: 0, limit: null, enforced: false, orgId: null };
  }
  const en = await resolveLimits(userId, orgId);
  const limit = en.limits.runs_per_month;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO plan_usage (org_id, month, runs) VALUES ($1, $2, 0)
       ON CONFLICT (org_id, month) DO NOTHING`,
      [orgId, bucket]
    );
    const { rows } = await client.query(
      `SELECT runs FROM plan_usage WHERE org_id = $1 AND month = $2 FOR UPDATE`,
      [orgId, bucket]
    );
    const used = rows[0]?.runs ?? 0;
    if (en.enforced && limit !== null && limit !== undefined && used + n > limit) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        used,
        limit,
        enforced: en.enforced,
        orgId,
        body: planLimitBody({ key: 'runs_per_month', limit, used, planKey: en.planKey, planName: en.planName }),
      };
    }
    await client.query(
      `UPDATE plan_usage SET runs = runs + $3 WHERE org_id = $1 AND month = $2`,
      [orgId, bucket, n]
    );
    await client.query('COMMIT');
    return { ok: true, used: used + n, limit, enforced: en.enforced, orgId };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  CANONICAL_KEYS,
  canonicalLimits,
  resolveLimits,
  countPoolUsage,
  currentRunUsage,
  checkCountGate,
  checkSeatGate,
  checkPublicSharingGate,
  chargeRuns,
  orgOfWorkspace,
  orgOfProject,
  orgOfCollection,
  planLimitBody,
};
