'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MENU_KEYS,
  isMenuKey,
  mergeMenuRows,
  menuDisabledBody,
  setEffectiveMenus,
  resetEffectiveMenus,
  requireMenuEnabled,
} = require('../menuAccess');

test('MENU_KEYS excludes core and admin', () => {
  assert.ok(MENU_KEYS.includes('docs'));
  assert.ok(MENU_KEYS.includes('mock-scenarios'));
  assert.ok(!MENU_KEYS.includes('apis'));
  assert.ok(!MENU_KEYS.includes('admin'));
  assert.equal(isMenuKey('docs'), true);
  assert.equal(isMenuKey('bogus'), false);
});

test('mergeMenuRows defaults every key on and lets project override org', () => {
  const menus = mergeMenuRows([
    { menu_key: 'docs', scope: 'org', enabled: false },
    { menu_key: 'docs', scope: 'project', enabled: true },
    { menu_key: 'copilot', scope: 'org', enabled: false },
  ]);
  for (const key of MENU_KEYS) assert.equal(typeof menus[key], 'boolean');
  assert.equal(menus.docs, true);
  assert.equal(menus.copilot, false);
  assert.equal(menus.contracts, true);
});

test('mergeMenuRows ignores unknown keys and malformed rows', () => {
  const menus = mergeMenuRows([{ menu_key: 'bogus', scope: 'org', enabled: false }, null]);
  assert.ok(!('bogus' in menus));
});

test('menuDisabledBody names the scope', () => {
  assert.equal(menuDisabledBody('docs', { projectId: 'p1' }).code, 'menu_disabled');
  assert.equal(
    menuDisabledBody('docs', { projectId: 'p1' }).error,
    'The "docs" feature is disabled for this project.'
  );
  assert.equal(
    menuDisabledBody('docs', {}).error,
    'The "docs" feature is disabled for this organization.'
  );
});

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('gate blocks with 403 when the resolver disables the menu', async () => {
  setEffectiveMenus(async () => ({ menus: { docs: false }, projectId: null, orgId: 'o1' }));
  const mw = requireMenuEnabled('docs');
  const res = fakeRes();
  let nextCalled = false;
  await mw({ user: { id: 'u1' }, params: {}, query: {}, body: {} }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'menu_disabled');
  resetEffectiveMenus();
});

test('gate passes when enabled and ignores unknown keys', async () => {
  setEffectiveMenus(async () => ({ menus: { docs: true }, projectId: null, orgId: 'o1' }));
  const mw = requireMenuEnabled('docs');
  const res = fakeRes();
  let nextCalled = false;
  await mw({ user: { id: 'u1' }, params: {}, query: {}, body: {} }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);

  const unknown = requireMenuEnabled('bogus');
  let unknownNext = false;
  await unknown({}, fakeRes(), () => {
    unknownNext = true;
  });
  assert.equal(unknownNext, true);
  resetEffectiveMenus();
});
