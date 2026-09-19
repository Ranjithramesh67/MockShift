'use strict';

// ---------------------------------------------------------------------------
// Portal B — company domain registry (People / organization networks).
//
// Mirrors the main-app admin endpoints so portal staff can maintain the same
// registry. A registered domain makes every account on it a member of the
// linked company organization.
//
//   GET    /api/portal/companies   VIEWER+
//   POST   /api/portal/companies   MANAGER+
//   DELETE /api/portal/companies/:id  MANAGER+
// ---------------------------------------------------------------------------

const { Router } = require('express');
const { query } = require('../shared');
const { access, requirePortalRole } = require('../portalAccess');
const { logAudit } = require('../auditLog');
const { normalizeDomain, isSpecialUseDomain } = require('../../../../backend/src/api/emailDomain');

const router = Router();
router.use(access.requireAuth);
router.use(requirePortalRole('VIEWER'));

async function listDomains() {
  const { rows } = await query(
    `SELECT cd.id, cd.company_name, cd.domain, cd.organization_id, cd.created_at,
            o.name AS organization_name,
            (SELECT count(*)::int FROM organization_members om
              WHERE om.org_id = cd.organization_id) AS member_count
       FROM company_domains cd
       LEFT JOIN organizations o ON o.id = cd.organization_id
      ORDER BY cd.company_name, cd.domain`,
    []
  );
  return rows;
}

router.get('/companies', async (req, res, next) => {
  try {
    res.json({ domains: await listDomains() });
  } catch (err) {
    next(err);
  }
});

router.post('/companies', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const companyName = String(body.company_name || body.companyName || '').trim();
    const domain = normalizeDomain(body.domain || '');
    if (!companyName) return res.status(400).json({ error: 'company_name is required' });
    if (companyName.length > 160) return res.status(400).json({ error: 'company_name is too long' });
    if (!domain) return res.status(400).json({ error: 'A valid email domain is required' });
    if (isSpecialUseDomain(domain)) {
      return res.status(400).json({ error: 'Reserved and test domains cannot be registered' });
    }

    const org = await query(
      `SELECT id FROM organizations WHERE kind = 'COMPANY' AND domain = $1`,
      [domain]
    );
    const orgId = org.rows[0] ? org.rows[0].id : null;
    const inserted = await query(
      `INSERT INTO company_domains (company_name, domain, organization_id, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (domain) DO UPDATE
         SET company_name = EXCLUDED.company_name,
             organization_id = COALESCE(company_domains.organization_id, EXCLUDED.organization_id)
       RETURNING id`,
      [companyName, domain, orgId, req.user.id]
    );
    if (orgId) {
      await query(`UPDATE organizations SET name = $1 WHERE id = $2`, [companyName, orgId]);
    }
    await logAudit(req, {
      action: 'company_domain.register',
      targetType: 'company_domain',
      targetId: inserted.rows[0].id,
      targetRef: domain,
      before: null,
      after: { companyName, domain, organizationId: orgId },
    });
    res.status(201).json({ domains: await listDomains() });
  } catch (err) {
    next(err);
  }
});

router.delete('/companies/:id', requirePortalRole('MANAGER'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM company_domains WHERE id = $1 RETURNING id, company_name, domain`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Company domain not found' });
    await logAudit(req, {
      action: 'company_domain.remove',
      targetType: 'company_domain',
      targetId: rows[0].id,
      targetRef: rows[0].domain,
      before: { companyName: rows[0].company_name, domain: rows[0].domain },
      after: null,
    });
    res.json({ domains: await listDomains() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
