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
  'json-compare',
  'network',
];

// Every rail item a user may reposition. A superset of TOGGLEABLE_MENU_KEYS:
// `apis`, `workflow` and `admin` cannot be hidden but can still be moved. Kept
// in sync with backend RAIL_ORDER_KEYS (backend/src/api/menuAccess.js).
const RAIL_ORDER_KEYS = [
  'apis',
  'workflow',
  'teams',
  'automations',
  'history',
  'docs',
  'contracts',
  'monitors',
  'mock-scenarios',
  'copilot',
  'collab',
  'json-compare',
  'network',
  'manage',
  'admin',
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

/**
 * Normalize a saved rail order into a full, duplicate-free permutation of
 * `availableKeys`: known saved keys keep their relative order, anything missing
 * is appended in the default order. A null/garbage input yields the default
 * order, so the rail always has a complete ordering to render.
 *
 * @param {unknown} saved
 * @param {string[]} [availableKeys]
 * @returns {string[]}
 */
function normalizeRailOrder(saved, availableKeys) {
  const allowed =
    Array.isArray(availableKeys) && availableKeys.length > 0 ? availableKeys : RAIL_ORDER_KEYS;
  const set = new Set(allowed);
  const seen = new Set();
  const out = [];
  if (Array.isArray(saved)) {
    for (const raw of saved) {
      if (typeof raw !== 'string' || !set.has(raw) || seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw);
    }
  }
  for (const key of allowed) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Map each key to its position, for use as a CSS flex `order` value.
 * @param {string[]} order
 * @returns {Record<string, number>}
 */
function orderIndexMap(order) {
  const map = {};
  if (Array.isArray(order)) {
    order.forEach((key, index) => {
      map[key] = index;
    });
  }
  return map;
}

module.exports = {
  TOGGLEABLE_MENU_KEYS,
  RAIL_ORDER_KEYS,
  defaultMenus,
  isMenuEnabled,
  normalizeRailOrder,
  orderIndexMap,
};
