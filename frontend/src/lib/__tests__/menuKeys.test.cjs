'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TOGGLEABLE_MENU_KEYS, defaultMenus, isMenuEnabled } = require('../menuKeys');

test('defaultMenus enables every toggleable key', () => {
  const menus = defaultMenus();
  for (const key of TOGGLEABLE_MENU_KEYS) assert.equal(menus[key], true);
  assert.equal('apis' in menus, false);
});

test('isMenuEnabled fails open for unknown keys and missing maps', () => {
  assert.equal(isMenuEnabled(undefined, 'docs'), true);
  assert.equal(isMenuEnabled({}, 'docs'), true);
  assert.equal(isMenuEnabled({ docs: false }, 'apis'), true);
});

test('isMenuEnabled respects explicit false', () => {
  assert.equal(isMenuEnabled({ docs: false }, 'docs'), false);
  assert.equal(isMenuEnabled({ docs: true }, 'docs'), true);
});
