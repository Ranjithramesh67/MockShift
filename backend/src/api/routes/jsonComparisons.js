'use strict';

const { Router } = require('express');
const { query } = require('../db');
const { requireAuth } = require('../access');

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_MODES = new Set(['alpha', 'alphanum', 'original']);
const ARRAY_MODES = new Set(['none', 'alpha', 'alphanum', 'numeric', 'length', 'type', 'json']);
const DIRECTIONS = new Set(['asc', 'desc']);
const MAX_JSON_CHARS = 400_000;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function toApi(row) {
  return {
    id: row.id,
    name: row.name,
    leftText: row.left_text,
    rightText: row.right_text,
    keyMode: row.key_mode,
    keyDirection: row.key_direction,
    arrayMode: row.array_mode,
    arrayDirection: row.array_direction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readName(raw) {
  const name = String(raw || '').trim();
  if (!name) return { error: 'name is required' };
  if (name.length > 120) return { error: 'name must be 120 characters or fewer' };
  return { name };
}

function readText(raw, label) {
  const text = raw == null ? '' : String(raw);
  if (text.length > MAX_JSON_CHARS) {
    return { error: `${label} must be ${MAX_JSON_CHARS} characters or fewer` };
  }
  return { text };
}

function readSort(body) {
  const keyMode = body.keyMode == null ? 'alpha' : String(body.keyMode);
  const keyDirection = body.keyDirection == null ? 'asc' : String(body.keyDirection);
  const arrayMode = body.arrayMode == null ? 'none' : String(body.arrayMode);
  const arrayDirection = body.arrayDirection == null ? 'asc' : String(body.arrayDirection);
  if (!KEY_MODES.has(keyMode)) return { error: 'keyMode is invalid' };
  if (!DIRECTIONS.has(keyDirection)) return { error: 'keyDirection is invalid' };
  if (!ARRAY_MODES.has(arrayMode)) return { error: 'arrayMode is invalid' };
  if (!DIRECTIONS.has(arrayDirection)) return { error: 'arrayDirection is invalid' };
  return { keyMode, keyDirection, arrayMode, arrayDirection };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, left_text, right_text, key_mode, key_direction, array_mode, array_direction, created_at, updated_at
         FROM json_comparisons
        WHERE user_id = $1
        ORDER BY updated_at DESC, name ASC`,
      [req.user.id]
    );
    res.json({ comparisons: rows.map(toApi) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const named = readName(body.name);
    if (named.error) return res.status(400).json({ error: named.error });
    const left = readText(body.leftText, 'leftText');
    if (left.error) return res.status(400).json({ error: left.error });
    const right = readText(body.rightText, 'rightText');
    if (right.error) return res.status(400).json({ error: right.error });
    const sort = readSort(body);
    if (sort.error) return res.status(400).json({ error: sort.error });

    const { rows } = await query(
      `INSERT INTO json_comparisons
         (user_id, name, left_text, right_text, key_mode, key_direction, array_mode, array_direction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, left_text, right_text, key_mode, key_direction, array_mode, array_direction, created_at, updated_at`,
      [
        req.user.id,
        named.name,
        left.text,
        right.text,
        sort.keyMode,
        sort.keyDirection,
        sort.arrayMode,
        sort.arrayDirection,
      ]
    );
    res.status(201).json({ comparison: toApi(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid comparison id' });
    const body = req.body || {};
    const named = readName(body.name);
    if (named.error) return res.status(400).json({ error: named.error });
    const left = readText(body.leftText, 'leftText');
    if (left.error) return res.status(400).json({ error: left.error });
    const right = readText(body.rightText, 'rightText');
    if (right.error) return res.status(400).json({ error: right.error });
    const sort = readSort(body);
    if (sort.error) return res.status(400).json({ error: sort.error });

    const { rows } = await query(
      `UPDATE json_comparisons
          SET name = $3,
              left_text = $4,
              right_text = $5,
              key_mode = $6,
              key_direction = $7,
              array_mode = $8,
              array_direction = $9,
              updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, name, left_text, right_text, key_mode, key_direction, array_mode, array_direction, created_at, updated_at`,
      [
        id,
        req.user.id,
        named.name,
        left.text,
        right.text,
        sort.keyMode,
        sort.keyDirection,
        sort.arrayMode,
        sort.arrayDirection,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Comparison not found' });
    res.json({ comparison: toApi(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid comparison id' });
    const { rows } = await query(
      `DELETE FROM json_comparisons WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Comparison not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
