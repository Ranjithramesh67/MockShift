'use strict';

// ---------------------------------------------------------------------------
// Portal backend shares the repo's DB + auth primitives with the main API Hub
// backend (same cookie session, same AUTH_SECRET, same scrypt password hashes,
// same users table). Keeping the portal code separate while reusing these
// modules avoids drifting crypto/session logic.
// ---------------------------------------------------------------------------

const { pool, query } = require('../../../backend/src/api/db');
const authLib = require('../../../backend/src/api/authLib');
const access = require('../../../backend/src/api/access');
const authRouter = require('../../../backend/src/api/routes/auth');

module.exports = { pool, query, authLib, access, authRouter };
