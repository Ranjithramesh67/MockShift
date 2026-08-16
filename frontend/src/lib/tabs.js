'use strict';

/**
 * Pure helpers for the open-request tab strip (M7).
 *
 * The workspace store keeps an ordered list of open request ids plus the id of
 * the active tab. These helpers keep the list invariants in one testable place:
 * - `openTab` adds an id once (dedupe) and keeps existing order.
 * - `closeTab` removes an id and, when the removed tab was the active one,
 *   activates the neighbour (the tab that was to its right, else the one to
 *   its left); returns the next active id (null when no tabs remain).
 */

function openTab(ids, id) {
  if (ids.includes(id)) return ids;
  return [...ids, id];
}

function closeTab(ids, activeId, id) {
  const idx = ids.indexOf(id);
  const next = ids.filter((x) => x !== id);
  if (activeId !== id) {
    return { ids: next, nextActiveId: activeId };
  }
  if (next.length === 0) {
    return { ids: [], nextActiveId: null };
  }
  const nextIndex = Math.min(idx, next.length - 1);
  return { ids: next, nextActiveId: next[nextIndex] };
}

module.exports = { openTab, closeTab };
