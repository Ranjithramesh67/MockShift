'use strict';

const { Router } = require('express');

const users = new Map([
  ['1', { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' }],
  ['2', { id: '2', name: 'Grace Hopper', email: 'grace@example.com' }],
]);

const router = Router();

router.get('/', (req, res) => {
  res.json({ users: [...users.values()] });
});

router.get('/:userId', (req, res) => {
  const user = users.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.post('/', (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  const id = String(users.size + 1);
  const user = { id, name, email };
  users.set(id, user);
  res.status(201).json(user);
});

module.exports = router;
