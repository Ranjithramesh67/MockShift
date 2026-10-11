'use strict';

// ---------------------------------------------------------------------------
// People / network routes (mounted at /api/network).
//
//   GET    /directory            org members (company) or contacts (personal)
//   GET    /directory/search     search org members, or all users when personal
//   GET    /invitations          incoming | outgoing invitations
//   POST   /invitations          invite someone by email
//   POST   /invitations/:id/accept
//   POST   /invitations/:id/decline
//   DELETE /invitations/:id      sender cancels a pending invite
//   GET    /contacts             accepted contacts
//   DELETE /contacts/:userId     remove a contact (both directions)
//
// Organizations are exempt from invitations: teammates already share a company
// organization and are scoped together by the directory. Personal accounts use
// email invitations to connect.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');
const { companyOrgForUser } = require('../companyNetwork');
const { normalizeEmailDomain, isPersonalDomain } = require('../emailDomain');
const email = require('../email');

const router = Router();
router.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PERSON_COLUMNS = `u.id, u.name, u.username, u.email, u.is_active`;

function inviteUrl() {
  return `${email.appUrl()}/network`;
}

function serializeInvitation(row) {
  return {
    id: row.id,
    email: row.invitee_email,
    message: row.message,
    kind: row.kind,
    status: row.status,
    organizationId: row.organization_id,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    inviter: {
      id: row.inviter_id,
      name: row.inviter_name,
      username: row.inviter_username,
      email: row.inviter_email,
    },
    invitee: row.invitee_id
      ? { id: row.invitee_id, name: row.invitee_name, username: row.invitee_username, email: row.invitee_email }
      : null,
  };
}

// ---------------------------------------------------------------- Directory
router.get('/directory', async (req, res, next) => {
  try {
    const org = await companyOrgForUser(req.user.id);
    if (org) {
      const { rows } = await query(
        `SELECT ${PERSON_COLUMNS}, om.role, om.id AS membership_id, u.created_at AS joined_at
           FROM organization_members om
           JOIN users u ON u.id = om.user_id
          WHERE om.org_id = $1 AND om.user_id <> $2 AND u.is_active
          ORDER BY u.name`,
        [org.id, req.user.id]
      );
      return res.json({ scope: 'company', organization: org, people: rows });
    }
    const { rows } = await query(
      `SELECT ${PERSON_COLUMNS}, c.created_at AS connected_at
         FROM user_contacts c
         JOIN users u ON u.id = c.contact_id
        WHERE c.owner_id = $1 AND u.is_active
        ORDER BY u.name`,
      [req.user.id],
      { userId: req.user.id }
    );
    res.json({ scope: 'personal', organization: null, people: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/directory/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ scope: 'company', people: [] });
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const org = await companyOrgForUser(req.user.id);
    if (org) {
      const { rows } = await query(
        `SELECT ${PERSON_COLUMNS}, om.role, u.created_at AS joined_at
           FROM organization_members om
           JOIN users u ON u.id = om.user_id
          WHERE om.org_id = $1 AND om.user_id <> $2 AND u.is_active
            AND (u.name ILIKE $3 OR u.username ILIKE $3 OR u.email ILIKE $3)
          ORDER BY u.name
          LIMIT 50`,
        [org.id, req.user.id, like]
      );
      return res.json({ scope: 'company', organization: org, people: rows });
    }
    const { rows } = await query(
      `SELECT ${PERSON_COLUMNS},
              EXISTS (SELECT 1 FROM user_contacts c
                       WHERE c.owner_id = $1 AND c.contact_id = u.id) AS is_contact,
              EXISTS (SELECT 1 FROM invitations i
                       WHERE i.inviter_id = $1 AND i.invitee_email = lower(u.email)
                         AND i.status = 'PENDING') AS invite_pending
         FROM users u
        WHERE u.id <> $1 AND u.is_active
          AND (u.name ILIKE $2 OR u.username ILIKE $2 OR u.email ILIKE $2)
        ORDER BY u.name
        LIMIT 25`,
      [req.user.id, like]
    );
    res.json({ scope: 'personal', organization: null, people: rows });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------- Invitations
router.get('/invitations', async (req, res, next) => {
  try {
    const box = req.query.box === 'outgoing' ? 'outgoing' : 'incoming';
    const base = `SELECT i.*,
                         inv.name AS inviter_name, inv.username AS inviter_username, inv.email AS inviter_email,
                         iee.name AS invitee_name, iee.username AS invitee_username, iee.email AS invitee_email
                    FROM invitations i
                    JOIN users inv ON inv.id = i.inviter_id
                    LEFT JOIN users iee ON iee.id = i.invitee_id`;
    const { rows } =
      box === 'outgoing'
        ? await query(
            `${base} WHERE i.inviter_id = $1 ORDER BY (i.status = 'PENDING') DESC, i.created_at DESC`,
            [req.user.id],
            { userId: req.user.id }
          )
        : await query(
            `${base}
              WHERE i.status = 'PENDING'
                AND (i.invitee_id = $1
                     OR i.invitee_email = (SELECT lower(email) FROM users WHERE id = $1))
              ORDER BY i.created_at DESC`,
            [req.user.id],
            { userId: req.user.id }
          );
    res.json({ box, invitations: rows.map(serializeInvitation) });
  } catch (err) {
    next(err);
  }
});

router.post('/invitations', async (req, res, next) => {
  try {
    const body = req.body || {};
    const inviteeEmail = String(body.email || '').trim().toLowerCase();
    const message = body.message ? String(body.message).trim().slice(0, 500) : null;
    if (!EMAIL_RE.test(inviteeEmail)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (inviteeEmail === String(req.user.email).toLowerCase()) {
      return res.status(400).json({ error: 'You cannot invite yourself' });
    }

    // An organization teammate never needs an invitation.
    const org = await companyOrgForUser(req.user.id);
    if (org && org.domain && normalizeEmailDomain(inviteeEmail) === org.domain) {
      return res.status(409).json({
        error: 'That person is already in your organization — find them in the directory.',
        code: 'same_organization',
      });
    }

    const { rows: targetRows } = await query(
      `SELECT id, name FROM users WHERE lower(email) = $1`,
      [inviteeEmail]
    );
    const target = targetRows[0] || null;
    if (target) {
      const { rows: existing } = await query(
        `SELECT 1 FROM user_contacts WHERE owner_id = $1 AND contact_id = $2`,
        [req.user.id, target.id],
        { userId: req.user.id }
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: 'You are already connected with that person.', code: 'already_contacts' });
      }
    }

    const { rows: pending } = await query(
      `SELECT id FROM invitations
        WHERE inviter_id = $1 AND invitee_email = $2 AND status = 'PENDING'`,
      [req.user.id, inviteeEmail],
      { userId: req.user.id }
    );
    if (pending.length > 0) {
      return res.status(409).json({ error: 'You already have a pending invitation for that email.', code: 'invite_pending' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const { rows } = await query(
      `INSERT INTO invitations
         (inviter_id, invitee_email, invitee_id, organization_id, kind, message, token)
       VALUES ($1, $2, $3, $4, 'FRIEND', $5, $6)
       RETURNING *`,
      [req.user.id, inviteeEmail, target ? target.id : null, org ? org.id : null, message, token],
      { userId: req.user.id }
    );
    const invite = rows[0];

    // Best-effort email — the invitation row is already the source of truth and
    // the recipient will also see it in their People tab once they sign in.
    email
      .sendMail({
        to: inviteeEmail,
        ...email.invitationMessage({
          inviterName: req.user.name || req.user.email,
          message,
          link: inviteUrl(),
        }),
      })
      .catch((err) => console.error('[network] invitation email failed:', err.message));

    res.status(201).json({
      invitation: serializeInvitation({
        ...invite,
        inviter_name: req.user.name,
        inviter_username: req.user.username,
        inviter_email: req.user.email,
        invitee_name: target ? target.name : null,
        invitee_username: null,
        invitee_email: null,
      }),
    });
  } catch (err) {
    next(err);
  }
});

async function loadInvitationForRecipient(id, userId) {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await query(
    `SELECT i.*
       FROM invitations i
      WHERE i.id = $1
        AND i.status = 'PENDING'
        AND (i.invitee_id = $2
             OR i.invitee_email = (SELECT lower(email) FROM users WHERE id = $2))`,
    [id, userId],
    { userId }
  );
  return rows[0] || null;
}

async function respond(req, res, next, nextStatus) {
  try {
    const invite = await loadInvitationForRecipient(req.params.id, req.user.id);
    if (!invite) return res.status(404).json({ error: 'Invitation not found' });
    await query(
      `UPDATE invitations
          SET status = $1, invitee_id = COALESCE(invitee_id, $2), responded_at = now()
        WHERE id = $3`,
      [nextStatus, req.user.id, invite.id],
      { userId: req.user.id }
    );
    if (nextStatus === 'ACCEPTED') {
      await query(
        `INSERT INTO user_contacts (owner_id, contact_id) VALUES ($1, $2), ($2, $1)
         ON CONFLICT (owner_id, contact_id) DO NOTHING`,
        [req.user.id, invite.inviter_id],
        { userId: req.user.id }
      );
    }
    res.json({ ok: true, status: nextStatus });
  } catch (err) {
    next(err);
  }
}

router.post('/invitations/:id/accept', (req, res, next) => respond(req, res, next, 'ACCEPTED'));
router.post('/invitations/:id/decline', (req, res, next) => respond(req, res, next, 'DECLINED'));

router.delete('/invitations/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Invitation not found' });
    const { rows } = await query(
      `UPDATE invitations SET status = 'CANCELLED', responded_at = now()
        WHERE id = $1 AND inviter_id = $2 AND status = 'PENDING'
        RETURNING id`,
      [req.params.id, req.user.id],
      { userId: req.user.id }
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Invitation not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- Contacts
router.get('/contacts', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PERSON_COLUMNS}, c.created_at AS connected_at
         FROM user_contacts c
         JOIN users u ON u.id = c.contact_id
        WHERE c.owner_id = $1 AND u.is_active
        ORDER BY u.name`,
      [req.user.id],
      { userId: req.user.id }
    );
    res.json({ contacts: rows });
  } catch (err) {
    next(err);
  }
});

router.delete('/contacts/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!UUID_RE.test(userId)) return res.status(404).json({ error: 'Contact not found' });
    await query(
      `DELETE FROM user_contacts
        WHERE (owner_id = $1 AND contact_id = $2)
           OR (owner_id = $2 AND contact_id = $1)`,
      [req.user.id, userId],
      { userId: req.user.id }
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Exported for unit testing the email-domain exemption helper.
function isSameCompanyDomain(userDomain, inviteeEmail) {
  if (!userDomain) return false;
  return !isPersonalDomain(userDomain) && normalizeEmailDomain(inviteeEmail) === userDomain;
}

module.exports = router;
module.exports.isSameCompanyDomain = isSameCompanyDomain;
