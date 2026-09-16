'use strict';

// ---------------------------------------------------------------------------
// Single place that mints an email-verification token and sends the link. The
// main-app signup route and the Portal A checkout (which creates a customer
// account in production) both issue verification mail, so the DB write and the
// message template must not drift between the two.
// ---------------------------------------------------------------------------

const { query } = require('./db');
const { generateToken, hashToken, expiryFor } = require('./authTokens');
const email = require('./email');

async function issueEmailVerification(userId, to) {
  const raw = generateToken();
  await query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
     VALUES ($1, 'email_verification', $2, $3)`,
    [userId, hashToken(raw), expiryFor('email_verification')]
  );
  const link = `${email.appUrl()}/verify-email?token=${encodeURIComponent(raw)}`;
  return email.sendMail({ to, ...email.verifyEmailMessage(link) });
}

module.exports = { issueEmailVerification };
