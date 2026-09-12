'use strict';

// Framework-free menu helpers shared by the rail, the route guard and the unit
// tests. The backend is the source of truth; the frontend fails OPEN (unknown
// or not-yet-loaded keys are treated as enabled) so a slow fetch never hides a
// feature that is actually available.
const TOGGLEABLE_MENU_KEYS = [
  'teams',
  'automations',
  'history',
  'docs',
  'contracts',
  'monitors',
  'mock-scenarios',
  'copilot',
  'collab',
  'manage',
];

/** @returns {Record<string, boolean>} */
function defaultMenus() {
  const menus = {};
  for (const key of TOGGLEABLE_MENU_KEYS) menus[key] = true;
  return menus;
}

/**
 * @param {Record<string, boolean> | null | undefined} menus
 * @param {string} key
 * @returns {boolean}
 */
function isMenuEnabled(menus, key) {
  if (!TOGGLEABLE_MENU_KEYS.includes(key)) return true;
  if (!menus || typeof menus !== 'object') return true;
  return menus[key] !== false;
}

module.exports = { TOGGLEABLE_MENU_KEYS, defaultMenus, isMenuEnabled };
