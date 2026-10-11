'use strict';

/**
 * Assertion-result helpers for the response pane and the collection runner.
 *
 * Pure helpers are written as plain CommonJS so they can be unit-tested with
 * node:test, matching `responseView.js`, `curl.js` and `workflowValidation.js`.
 */

function assertionCounts(results) {
  const total = Array.isArray(results) ? results.length : 0;
  const passed = Array.isArray(results) ? results.filter((r) => r.passed).length : 0;
  return { total, passed, failed: total - passed };
}

function allAssertionsPassed(results) {
  return Array.isArray(results) && results.length > 0 && results.every((r) => r.passed);
}

module.exports = { assertionCounts, allAssertionsPassed };
