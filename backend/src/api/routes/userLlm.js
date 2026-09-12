'use strict';

// ============================================================================
// Per-user "bring your own LLM" config — mounted at /api/profile/llm.
//
//   GET    /  safe shape (never the key) + whether the admin toggle allows it
//   PUT    /  upsert { apiKey, baseUrl, model } (encrypted at rest); 403 when
//             the admin toggle is off
//   DELETE /  forget the stored config
//
// The actor is always req.user; there is no way to read or write another
// user's config. The API key is only ever in the encrypted column.
// ============================================================================

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');
const llm = require('../llm');

const router = Router();
router.use(requireAuth);

function safeShape({ allowed, cfg }) {
  return {
    allowed,
    configured: Boolean(cfg && cfg.configured),
    source: (cfg && cfg.source) || 'none',
    provider: cfg && cfg.configured ? llm.PROVIDER_LABEL : null,
    model: (cfg && cfg.model) || null,
    baseUrl: (cfg && cfg.baseUrl) || null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const allowed = await llm.individualLlmAllowed();
    const cfg = allowed ? await llm.loadUserConfig(req.user.id) : null;
    res.json(safeShape({ allowed, cfg }));
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const allowed = await llm.individualLlmAllowed();
    if (!allowed) {
      return res.status(403).json({
        error: 'Individual model configuration is disabled by an administrator.',
        code: 'individual_llm_disabled',
      });
    }
    const parsed = llm.validateUserConfig(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { apiKey, baseUrl, model } = parsed.value;
    await query(
      `INSERT INTO user_llm_configs (user_id, api_key_encrypted, base_url, model, updated_at)
       VALUES ($1, pgp_sym_encrypt($2, app.vault_key()), $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         api_key_encrypted = EXCLUDED.api_key_encrypted,
         base_url = EXCLUDED.base_url,
         model = EXCLUDED.model,
         updated_at = now()`,
      [req.user.id, apiKey, baseUrl, model],
      { userId: req.user.id }
    );
    const cfg = await llm.loadUserConfig(req.user.id);
    res.json(safeShape({ allowed, cfg }));
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    await query('DELETE FROM user_llm_configs WHERE user_id = $1', [req.user.id], {
      userId: req.user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
