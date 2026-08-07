'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth, roleAtLeast, getWorkspaceRole, canReadWorkspace, canMutateWorkspace } = require('../access');

const router = Router();
router.use(requireAuth);

// Ensure only one environment is active per workspace.
async function clearActive(client, workspaceId) {
  await client.query('UPDATE environments SET is_active = false WHERE workspace_id = $1', [workspaceId]);
}

// ------------------------------------------------------------------ List / create
router.get('/workspaces/:workspaceId/environments', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    if (!(await canReadWorkspace(req.user.id, workspaceId))) {
      return res.status(403).json({ error: 'No access to this workspace' });
    }
    const { rows } = await query(
      `SELECT e.id, e.name, e.is_active,
              (SELECT count(*) FROM variables v WHERE v.scope = 'ENVIRONMENT' AND v.environment_id = e.id) AS variable_count
         FROM environments e
        WHERE e.workspace_id = $1
        ORDER BY e.name`,
      [workspaceId]
    );
    res.json({ environments: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/workspaces/:workspaceId/environments', async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    if (!(await canMutateWorkspace(req.user.id, workspaceId))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const makeActive = req.body?.makeActive === true;

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      if (makeActive) await clearActive(client, workspaceId);
      const { rows } = await client.query(
        `INSERT INTO environments (workspace_id, name, is_active)
         VALUES ($1, $2, $3)
         RETURNING id, name, is_active`,
        [workspaceId, name, makeActive]
      );
      await client.query('COMMIT');
      res.status(201).json({ environment: { ...rows[0], variable_count: 0 } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Update / delete
router.patch('/environments/:environmentId', async (req, res, next) => {
  try {
    const { environmentId } = req.params;
    const { rows } = await query(`SELECT id, workspace_id FROM environments WHERE id = $1`, [environmentId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Environment not found' });
    const workspaceId = rows[0].workspace_id;
    const role = await getWorkspaceRole(req.user.id, workspaceId);
    if (!roleAtLeast(role, 'EDITOR')) return res.status(403).json({ error: 'Editor or admin access required' });

    const { name, isActive } = req.body || {};
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      if (isActive === true) await clearActive(client, workspaceId);
      const sets = [];
      const params = [environmentId];
      if (name !== undefined) {
        sets.push(`name = $${params.length + 1}`);
        params.push(String(name).trim());
      }
      if (isActive !== undefined) {
        sets.push(`is_active = $${params.length + 1}`);
        params.push(isActive === true);
      }
      if (sets.length > 0) {
        await client.query(`UPDATE environments SET ${sets.join(', ')} WHERE id = $1`, params);
      }
      const updated = await client.query(`SELECT id, name, is_active FROM environments WHERE id = $1`, [environmentId]);
      await client.query('COMMIT');
      res.json({ environment: { ...updated.rows[0], variable_count: 0 } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.delete('/environments/:environmentId', async (req, res, next) => {
  try {
    const { environmentId } = req.params;
    const { rows } = await query(`SELECT id, workspace_id FROM environments WHERE id = $1`, [environmentId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Environment not found' });
    const role = await getWorkspaceRole(req.user.id, rows[0].workspace_id);
    if (!roleAtLeast(role, 'EDITOR')) return res.status(403).json({ error: 'Editor or admin access required' });
    await query(`DELETE FROM environments WHERE id = $1`, [environmentId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Variables
router.get('/environments/:environmentId/variables', async (req, res, next) => {
  try {
    const { environmentId } = req.params;
    const { rows: envs } = await query(`SELECT id, workspace_id FROM environments WHERE id = $1`, [environmentId]);
    if (envs.length === 0) return res.status(404).json({ error: 'Environment not found' });
    if (!(await canReadWorkspace(req.user.id, envs[0].workspace_id))) {
      return res.status(403).json({ error: 'No access to this workspace' });
    }
    const { rows } = await query(
      `SELECT id, key, is_secret,
              CASE WHEN is_secret THEN pgp_sym_decrypt(value_encrypted, app.vault_key()) ELSE value_plain END AS value
         FROM variables
        WHERE scope = 'ENVIRONMENT' AND environment_id = $1
        ORDER BY key`,
      [environmentId],
      { userId: req.user.id }
    );
    res.json({ variables: rows });
  } catch (err) {
    next(err);
  }
});

async function getOrCheckEnvironment(environmentId) {
  const { rows } = await query(`SELECT id, workspace_id FROM environments WHERE id = $1`, [environmentId]);
  return rows[0] || null;
}

router.post('/environments/:environmentId/variables', async (req, res, next) => {
  try {
    const { environmentId } = req.params;
    const env = await getOrCheckEnvironment(environmentId);
    if (!env) return res.status(404).json({ error: 'Environment not found' });
    const role = await getWorkspaceRole(req.user.id, env.workspace_id);
    if (!roleAtLeast(role, 'EDITOR')) return res.status(403).json({ error: 'Editor or admin access required' });

    const key = String(req.body?.key || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_\-\.]*$/.test(key)) {
      return res.status(400).json({ error: 'Invalid variable key (letters, numbers, _, -, .)' });
    }
    const isSecret = req.body?.isSecret === true;
    const rawValue = req.body?.value;
    if (rawValue === undefined) return res.status(400).json({ error: 'value is required' });
    const value = String(rawValue);

    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', req.user.id]);
      await client.query('SELECT set_config($1, $2, true)', [
        'app.vault_key',
        process.env.VAULT_KEY || 'dev-vault-key-do-not-use-in-prod',
      ]);
      const { rows } = await client.query(
        `INSERT INTO variables (key, scope, is_secret, value_encrypted, value_plain, environment_id)
         VALUES ($1, 'ENVIRONMENT', $2,
                 CASE WHEN $2 THEN pgp_sym_encrypt($3, app.vault_key()) ELSE NULL END,
                 CASE WHEN $2 THEN NULL ELSE $3 END,
                 $4)
         ON CONFLICT (environment_id, key) WHERE scope = 'ENVIRONMENT'
         DO UPDATE SET
           is_secret = EXCLUDED.is_secret,
           value_encrypted = EXCLUDED.value_encrypted,
           value_plain = EXCLUDED.value_plain,
           updated_at = now()
         RETURNING id, key, is_secret`,
        [key, isSecret, value, environmentId]
      );
      await client.query('COMMIT');
      res.status(201).json({ variable: { ...rows[0], value: isSecret ? undefined : value } });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.delete('/environments/:environmentId/variables/:variableId', async (req, res, next) => {
  try {
    const { environmentId, variableId } = req.params;
    const env = await getOrCheckEnvironment(environmentId);
    if (!env) return res.status(404).json({ error: 'Environment not found' });
    const role = await getWorkspaceRole(req.user.id, env.workspace_id);
    if (!roleAtLeast(role, 'EDITOR')) return res.status(403).json({ error: 'Editor or admin access required' });
    await query(
      `DELETE FROM variables WHERE id = $1 AND scope = 'ENVIRONMENT' AND environment_id = $2`,
      [variableId, environmentId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
