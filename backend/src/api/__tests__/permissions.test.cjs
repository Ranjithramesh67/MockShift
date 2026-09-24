'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMISSION_GROUPS,
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  resolveSystemRolePermissions,
  isValidPermissionKey,
} = require('../permissions');

const EXPECTED_GROUPS = ['org', 'project', 'workspace', 'team', 'content'];

const EXPECTED_KEYS = [
  'org.manage_members',
  'org.manage_roles',
  'org.manage_billing',
  'org.view_audit',
  'project.view',
  'project.create',
  'project.update',
  'project.delete',
  'project.manage_members',
  'workspace.view',
  'workspace.create',
  'workspace.update',
  'workspace.delete',
  'workspace.manage_members',
  'workspace.write',
  'team.manage',
  'request.send',
  'mock.manage',
  'docs.manage',
  'automation.manage',
];

test('catalog exposes the exact groups, keys and labels', () => {
  assert.deepEqual(
    PERMISSION_GROUPS.map((g) => g.key),
    EXPECTED_GROUPS
  );
  assert.deepEqual(
    [...ALL_PERMISSION_KEYS].sort(),
    [...EXPECTED_KEYS].sort()
  );
  for (const group of PERMISSION_GROUPS) {
    assert.ok(group.label, `group ${group.key} has a label`);
    for (const permission of group.permissions) {
      assert.ok(permission.key, 'permission has a key');
      assert.ok(permission.label, `permission ${permission.key} has a label`);
      assert.ok(EXPECTED_KEYS.includes(permission.key));
    }
  }
});

test('isValidPermissionKey accepts catalog keys and rejects everything else', () => {
  for (const key of EXPECTED_KEYS) assert.equal(isValidPermissionKey(key), true);
  for (const bad of ['', 'bogus', 'org', '*', null, undefined, 42]) {
    assert.equal(isValidPermissionKey(bad), false);
  }
});

test('resolveSystemRolePermissions expands ADMIN to the whole catalog, no wildcard', () => {
  const admin = resolveSystemRolePermissions('ADMIN');
  assert.equal(admin.length, ALL_PERMISSION_KEYS.length);
  assert.ok(!admin.includes('*'));
  for (const key of ALL_PERMISSION_KEYS) assert.ok(admin.includes(key), key);
});

test('MANAGER covers every key except role and billing management', () => {
  const manager = resolveSystemRolePermissions('MANAGER');
  const expected = ALL_PERMISSION_KEYS.filter(
    (key) => key !== 'org.manage_roles' && key !== 'org.manage_billing'
  );
  assert.deepEqual([...manager].sort(), [...expected].sort());
  assert.ok(!manager.includes('org.manage_roles'));
  assert.ok(!manager.includes('org.manage_billing'));
});

test('EDITOR / VIEWER / SUPPORT resolve to their documented subsets', () => {
  assert.deepEqual(resolveSystemRolePermissions('EDITOR').sort(), [
    'request.send',
    'project.view',
    'workspace.view',
    'workspace.write',
    'docs.manage',
    'mock.manage',
  ].sort());
  assert.deepEqual(resolveSystemRolePermissions('VIEWER').sort(), ['project.view', 'workspace.view'].sort());
  assert.deepEqual(resolveSystemRolePermissions('SUPPORT').sort(), [
    'project.view',
    'workspace.view',
    'org.view_audit',
  ].sort());
});

test('unknown or missing system keys resolve to an empty list', () => {
  assert.deepEqual(resolveSystemRolePermissions('NOPE'), []);
  assert.deepEqual(resolveSystemRolePermissions(undefined), []);
});

test('SYSTEM_ROLE_PERMISSIONS is the documented source of each expansion', () => {
  assert.deepEqual(SYSTEM_ROLE_PERMISSIONS.ADMIN, ['*']);
  for (const key of ALL_PERMISSION_KEYS) {
    assert.ok(
      resolveSystemRolePermissions('ADMIN').includes(key) ||
        resolveSystemRolePermissions('MANAGER').includes(key),
      `${key} is covered by ADMIN or MANAGER`
    );
  }
});
