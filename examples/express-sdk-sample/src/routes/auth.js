'use strict';

const { Router } = require('express');

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  res.json({ token: 'sample-session-token', user: { email } });
});

module.exports = router;
